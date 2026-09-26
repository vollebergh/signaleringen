/**
 * OpenAI-compatibele client. Tegenhanger van LlmClient.kt, uitgebreid met de
 * synthesestap die de Android-app niet heeft.
 *
 * Twee verantwoordelijkheden:
 *   1. `filterPublications` — beoordeelt publicaties op relevantie (per batch).
 *   2. `synthesizeProfile`  — bundelt de relevante publicaties van één profiel
 *      tot één samenhangende signalering over het profielonderwerp.
 *
 * Transport: standaard via de eigen proxy, zodat de provider-key nooit in de
 * browser staat. `direct` is er alleen voor lokaal testen zonder proxy.
 */

import { AppConfig } from '../core/config.js';
import { log } from '../core/logger.js';
import { fetchWithTimeout, isTransientStatus } from './http.js';

/**
 * Provider-routing voor OpenRouter: uitsluitend DeepInfra, geen fallback.
 *
 * Bewust géén `quantizations`-filter. DeepInfra serveert DeepSeek V4 Flash 0731
 * als fp8, niet fp4 (gecontroleerd 2026-08-15 via `/models/…/endpoints`); de
 * aanname `deepinfra/fp4` uit besluit B-D06 klopt niet voor dit model. Beide
 * tegelijk vastzetten levert nul beschikbare endpoints en dus een harde fout
 * bij elk verzoek.
 *
 * Wordt overgeslagen zodra het model een preset is (`@preset/...`) — dan zit
 * de routing al in de preset.
 */
const PROVIDER_ROUTING = {
  order: ['deepinfra'],
  allow_fallbacks: false,
};

function usesPreset(model) {
  return typeof model === 'string' && model.includes('@preset/');
}

/** Bouwt endpoint en headers op basis van de gekozen transportmodus. */
function resolveEndpoint(settings) {
  if (settings.transport === 'proxy') {
    const base = settings.proxyUrl.trim().replace(/\/+$/, '');
    const headers = { 'Content-Type': 'application/json' };
    if (settings.proxyToken?.trim()) {
      headers.Authorization = `Bearer ${settings.proxyToken.trim()}`;
    }
    return { url: `${base}/chat/completions`, headers };
  }

  const base = settings.directBaseUrl.trim().replace(/\/+$/, '');
  return {
    url: `${base}/chat/completions`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.directApiKey.trim()}`,
    },
  };
}

/** Eén chat-completion. Gooit bij een niet-2xx antwoord. */
async function complete(settings, { system, user, maxTokens, temperature }) {
  const { url, headers } = resolveEndpoint(settings);

  const body = {
    model: settings.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature,
    max_tokens: maxTokens,
  };

  if (!usesPreset(settings.model)) {
    body.provider = PROVIDER_ROUTING;
  }

  // Eén veld voor de redeneerinspanning; 'none' zet het uit. Zie AppConfig.
  body.reasoning = { effort: AppConfig.LLM_REASONING_EFFORT };

  const response = await fetchWithTimeout(
    url,
    { method: 'POST', headers, body: JSON.stringify(body) },
    AppConfig.LLM_TIMEOUT_MS,
  );

  const text = await response.text();
  if (!response.ok) {
    log.error(`LLM-fout (${response.status}): ${text.slice(0, 500)}`);
    const hint = isTransientStatus(response.status) ? ' — probeer het zo nog eens' : '';
    throw new Error(`LLM-API gaf ${response.status}${hint}: ${apiErrorMessage(text)}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Antwoord van de LLM-API was geen geldige JSON');
  }

  // OpenRouter geeft fouten soms met status 200 en een `error` in de body.
  if (parsed?.error) {
    const message = parsed.error.message ?? JSON.stringify(parsed.error);
    log.error('LLM-fout in een 200-antwoord', parsed.error);
    throw new Error(`LLM-API: ${message}`);
  }

  const choice = parsed?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === 'string' && content.trim()) {
    return content;
  }

  // Leeg antwoord: zeg wát er misging in plaats van "geen tekst". De twee
  // gevallen die in de praktijk voorkomen zijn een op redeneertokens
  // opgebrande limiet en een afgekapt antwoord.
  throw new Error(emptyContentMessage(choice, parsed));
}

/** Leest de foutmelding uit een niet-2xx antwoordtekst, of geeft de tekst zelf. */
function apiErrorMessage(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed?.error?.message ?? text.slice(0, 200);
  } catch {
    return text.slice(0, 200);
  }
}

/** Verklaart waarom er geen bruikbare tekst in het antwoord zat. Geëxporteerd voor de tests. */
export function emptyContentMessage(choice, parsed) {
  const finish = choice?.finish_reason ?? choice?.native_finish_reason;
  const reasoning = choice?.message?.reasoning;
  const used = parsed?.usage?.completion_tokens;

  if (reasoning) {
    return `Het model gaf alleen een gedachtegang terug, geen antwoord${
      finish === 'length' ? ' — de tokenlimiet was al op' : ''
    }. Zet redeneren uit of verhoog max_tokens.`;
  }
  if (finish === 'length') {
    return `Het antwoord werd afgekapt door de tokenlimiet${
      used ? ` (${used} tokens gebruikt)` : ''
    }.`;
  }
  if (finish === 'content_filter') {
    return 'Het antwoord is door een inhoudsfilter van de provider geblokkeerd.';
  }
  if (!choice) {
    return 'De LLM-API gaf een antwoord zonder resultaten terug.';
  }
  return `De LLM-API gaf een leeg antwoord terug (finish_reason: ${finish ?? 'onbekend'}).`;
}

// ── Relevantiefilter ────────────────────────────────────────────────────────

const FILTER_SYSTEM_PROMPT = `Je bent een assistent die publicaties beoordeelt op relevantie voor een gebruikersvraag.
Je antwoordt ALLEEN met een valide JSON-array, zonder extra tekst of uitleg.

Elke publicatie moet beoordeeld worden. Geef voor elke publicatie een JSON-object met:
- "index": het nummer van de publicatie (begint bij 0)
- "relevant": true of false
- "samenvatting": een korte beschrijving van maximaal 15 woorden in het Nederlands

Antwoord ALLEEN met de JSON-array.`;

/**
 * Beoordeelt publicaties op relevantie. Verwerkt in batches zodat een lange
 * lijst niet in één afgekapte response eindigt (backlogitem B-20 in de app).
 *
 * @param {import('../core/models.js').Publication[]} publications
 * @param {string} userQuery
 * @param {object} settings
 * @param {(done: number, total: number) => void} [onBatch]
 * @returns {Promise<Array<{publication: object, shortDescription: string, isRelevant: boolean}>>}
 */
export async function filterPublications(publications, userQuery, settings, onBatch) {
  if (publications.length === 0) return [];

  const results = [];
  const batchSize = AppConfig.LLM_BATCH_SIZE;

  for (let start = 0; start < publications.length; start += batchSize) {
    const batch = publications.slice(start, start + batchSize);
    const list = batch
      .map((pub, index) => `${index}. [${pub.sourceName}] ${pub.title}\n   ${pub.description}`)
      .join('\n\n');

    const content = await complete(settings, {
      system: FILTER_SYSTEM_PROMPT,
      user: `Beoordeel de volgende publicaties op relevantie voor deze vraag:\n\nVRAAG: ${userQuery}\n\nPUBLICATIES:\n${list}`,
      maxTokens: AppConfig.LLM_MAX_TOKENS,
      temperature: AppConfig.LLM_TEMPERATURE,
    });

    results.push(...mapBatch(content, batch));
    onBatch?.(Math.min(start + batchSize, publications.length), publications.length);
  }

  return results;
}

function mapBatch(content, batch) {
  const verdicts = new Map();
  try {
    const array = JSON.parse(repairJsonArray(stripCodeFence(content)));
    for (const item of array) {
      if (typeof item?.index === 'number') {
        verdicts.set(item.index, {
          isRelevant: Boolean(item.relevant),
          shortDescription: String(item.samenvatting ?? ''),
        });
      }
    }
  } catch (err) {
    // Onparseerbaar antwoord mag de hele scan niet slopen: de batch valt terug
    // op "niet relevant" en de gebruiker ziet de publicaties bij de rest.
    log.warn('Kon LLM-antwoord niet parseren, batch valt terug op niet-relevant', err);
  }

  return batch.map((publication, index) => {
    const verdict = verdicts.get(index);
    return {
      publication,
      shortDescription: verdict?.shortDescription || publication.title,
      isRelevant: verdict?.isRelevant ?? false,
    };
  });
}

function stripCodeFence(text) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

/**
 * Repareert een afgekapte JSON-array door tot het laatste complete object te
 * knippen. Port van `repairTruncatedJson` uit LlmClient.kt.
 */
export function repairJsonArray(json) {
  const trimmed = json.trim();
  if (trimmed.endsWith(']')) return trimmed;

  const lastPair = trimmed.lastIndexOf('},');
  if (lastPair !== -1) return `${trimmed.slice(0, lastPair + 1)}]`;

  const lastBrace = trimmed.lastIndexOf('}');
  if (lastBrace !== -1) return `${trimmed.slice(0, lastBrace + 1)}]`;

  return '[]';
}

// ── Synthese ────────────────────────────────────────────────────────────────

const SYNTHESIS_SYSTEM_PROMPT = `Je stelt signaleringen op. Je krijgt publicaties die relevant zijn bevonden voor één onderwerp en schrijft daarover één samenhangend bericht in het Nederlands.

Richtlijnen:
- Begin met de kern: wat is er nieuw of veranderd rond dit onderwerp?
- Groepeer publicaties die over hetzelfde gaan; herhaal niets.
- Verwijs naar bronnen met het nummer tussen blokhaken, bijvoorbeeld [3].
- Noem expliciet wanneer bronnen elkaar tegenspreken.
- Verzin niets dat niet in de aangeleverde publicaties staat.
- Geen inleidende beleefdheden, geen afsluitende samenvatting van jezelf.

Antwoord in platte tekst met korte alinea's. Gebruik geen markdown-koppen.`;

/**
 * Bundelt de relevante publicaties van één profiel tot één signalering.
 *
 * @param {object} profile het profiel, inclusief eventuele `synthesisPrompt`
 * @param {Array<{publication: object, shortDescription: string}>} relevant
 * @param {object} settings
 * @returns {Promise<{text: string, sources: Array<{index: number, title: string, url: string, sourceName: string}>}>}
 */
export async function synthesizeProfile(profile, relevant, settings) {
  if (relevant.length === 0) {
    return { text: '', sources: [] };
  }

  const sources = relevant.map((result, index) => ({
    index: index + 1,
    title: result.publication.title,
    url: result.publication.url,
    sourceName: result.publication.sourceName,
  }));

  const list = relevant
    .map((result, index) => {
      const pub = result.publication;
      const date = pub.publishedDate ? new Date(pub.publishedDate).toISOString().slice(0, 10) : 'datum onbekend';
      return `[${index + 1}] ${pub.title}\n    bron: ${pub.sourceName} — ${date}\n    ${result.shortDescription}\n    ${pub.description}`;
    })
    .join('\n\n');

  const instruction = profile.synthesisPrompt?.trim()
    ? `\n\nAANVULLENDE INSTRUCTIE VAN DE GEBRUIKER:\n${profile.synthesisPrompt.trim()}`
    : '';

  const text = await complete(settings, {
    system: SYNTHESIS_SYSTEM_PROMPT,
    user: `ONDERWERP: ${profile.name}\nWAAR DE GEBRUIKER OP LET: ${profile.userQuery}${instruction}\n\nPUBLICATIES:\n${list}`,
    maxTokens: AppConfig.SYNTHESIS_MAX_TOKENS,
    temperature: AppConfig.SYNTHESIS_TEMPERATURE,
  });

  return { text: text.trim(), sources };
}

/**
 * Kleine testaanroep om endpoint, key, model en routing te verifiëren.
 *
 * De tokenlimiet staat ruim genoeg voor een model dat toch redeneertokens
 * produceert: met een krappe limiet komt er een leeg antwoord terug en lijkt de
 * verbinding stuk terwijl die het gewoon doet.
 */
export async function testConnection(settings) {
  const reply = await complete(settings, {
    system: 'Antwoord met exact het woord: ok. Geen uitleg.',
    user: 'ok',
    maxTokens: 256,
    temperature: 0,
  });
  return reply.trim().slice(0, 100);
}
