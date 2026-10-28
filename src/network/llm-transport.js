/**
 * Transport naar het taalmodel: endpoint en headers per route (direct, proxy,
 * lokaal), het verzoek zelf, opnieuw proberen bij een tijdelijke fout en de
 * uitwijkroute. OpenAI-compatibel. Tegenhanger van LlmClient.kt.
 *
 * Gesplitst uit llm-client.js (CR-14), samen met prompt-safety.js,
 * relevance-filter.js, prefilter.js en synthesis.js.
 *
 * Transport: standaard `direct` met een persoonlijke key per gebruiker (B-D09);
 * `proxy` voor een key die server-side blijft (organisatiefase).
 */

import { AppConfig } from '../core/config.js';
import { isLocalBaseUrl } from '../core/models.js';
import { ApiKind, apiKind, supportsOpenRouterFeatures } from '../core/api-kind.js';
import { log } from '../core/logger.js';
import { connectionErrors, parseList } from '../core/routing.js';
import { fetchBytes, utf8, isTransientStatus } from './http.js';

/** Praat de extensie rechtstreeks met een lokaal model? (B-67) */
export function isLocal(settings) {
  return settings?.transport !== 'proxy' && isLocalBaseUrl(settings?.directBaseUrl);
}

function usesPreset(model) {
  return typeof model === 'string' && model.includes('@preset/');
}

/** Bouwt endpoint en headers op basis van de gekozen transportmodus. */
function resolveEndpoint(settings) {
  // Ook hier, niet alleen bij het opslaan: oudere instellingen kunnen nog een
  // http-adres bevatten (S-02).
  const [problem] = connectionErrors(settings);
  if (problem) throw new Error(problem);

  if (settings.transport === 'proxy') {
    const base = settings.proxyUrl.trim().replace(/\/+$/, '');
    const headers = { 'Content-Type': 'application/json' };
    if (settings.proxyToken?.trim()) {
      headers.Authorization = `Bearer ${settings.proxyToken.trim()}`;
    }
    return { url: `${base}/chat/completions`, headers };
  }

  const base = settings.directBaseUrl.trim().replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json' };
  const key = settings.directApiKey?.trim();

  // De Claude API heeft een eigen route en eigen headers (B-79). De laatste
  // header is nodig omdat het verzoek uit een browser(extensie) komt.
  if (apiKind(settings) === ApiKind.ANTHROPIC) {
    if (key) headers['x-api-key'] = key;
    headers['anthropic-version'] = AppConfig.ANTHROPIC_API_VERSION;
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
    return { url: `${base}/messages`, headers };
  }

  // Een lokaal model draait zonder key (B-67); dan geen lege Bearer meesturen.
  if (key) headers.Authorization = `Bearer ${key}`;
  return { url: `${base}/chat/completions`, headers };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Fout die het waard is opnieuw te proberen: 429, 5xx of een netwerkfout. */
class TransientLlmError extends Error {
  constructor(message, retryAfterMs = null) {
    super(message);
    this.name = 'TransientLlmError';
    this.retryAfterMs = retryAfterMs;
  }
}

/** `Retry-After` in seconden of als datum → milliseconden, of null. */
export function parseRetryAfter(value, now = Date.now()) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

/**
 * Wachttijd vóór poging `attempt` (vanaf 2): exponentieel vanaf de
 * beginwaarde, of de `Retry-After` van de server, altijd tot het plafond.
 * Geëxporteerd voor de tests.
 */
export function retryDelay(attempt, retryAfterMs = null) {
  const backoff = AppConfig.LLM_RETRY_INITIAL_DELAY_MS * 2 ** (attempt - 2);
  return Math.min(retryAfterMs ?? backoff, AppConfig.LLM_RETRY_MAX_DELAY_MS);
}

/**
 * Alleen wat als tijdelijk is aangemerkt: 429, 5xx en fouten van het netwerk
 * zelf (zie `post`). Eerder telde elke `TypeError`, ook een programmeerfout,
 * en die werd dan zes keer herhaald (CR-09).
 */
const isTransient = (err) => err instanceof TransientLlmError;

/**
 * POST met JSON; geeft het antwoord en de body als tekst. Een time-out of
 * netwerkfout wordt een `TransientLlmError`; al het andere gooit gewoon door.
 */
export async function post(url, headers, body, timeoutMs) {
  let result;
  try {
    result = await fetchBytes(url, { method: 'POST', headers, body: JSON.stringify(body) }, { timeoutMs });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new TransientLlmError(`Geen antwoord binnen ${Math.round(timeoutMs / 1000)} s`);
    }
    if (err instanceof TypeError) throw new TransientLlmError(`Netwerkfout: ${err.message}`);
    throw err;
  }
  return { response: result.response, text: utf8(result.bytes) };
}

/**
 * Het `provider`-blok voor OpenRouter: de tags in volgorde, en nooit
 * uitwijken naar een niet-gekozen provider. OpenRouter accepteert
 * `provider/kwantisatie` rechtstreeks in `order` (gecontroleerd 2026-10-09:
 * `deepinfra/fp8` → DeepInfra, `decart/fp4` → Decart, `deepinfra/fp4` → 404
 * "No endpoints found"). Leeg: geen blok, OpenRouter kiest.
 */
export function providerRouting(routing) {
  const order = parseList(routing);
  return order.length > 0 ? { order, allow_fallbacks: false } : null;
}

/**
 * De routes die na elkaar geprobeerd worden: de ingestelde (bij een preset
 * zonder provider-blok, de preset draagt zijn eigen routing), en als die aan
 * staat de uitwijkroute. Geëxporteerd voor de tests.
 */
export function routesFor(settings) {
  // Alleen OpenRouter kent provider-routing en de uitwijkroute; die wijst naar
  // een OpenRouter-model dat elders niet bestaat (B-67, B-79).
  if (!supportsOpenRouterFeatures(settings)) return [{ model: settings.model, provider: null }];
  const primary = {
    model: settings.model,
    provider: usesPreset(settings.model) ? null : providerRouting(settings.providerRouting),
  };
  const fallbackModel = String(settings.fallbackModel ?? '').trim();
  if (!settings.fallbackEnabled || !fallbackModel) return [primary];
  return [
    primary,
    {
      model: fallbackModel,
      provider: usesPreset(fallbackModel)
        ? null
        : providerRouting(settings.fallbackProviderRouting),
    },
  ];
}

/**
 * Eén chat-completion. Per route opnieuw proberen bij een tijdelijke fout;
 * blijft de primaire route tijdelijk weigeren, dan de uitwijkroute. Gooit bij
 * een definitieve fout, of als ook de laatste poging tijdelijk mislukt.
 */
export async function complete(settings, request) {
  const routes = routesFor(settings);
  let lastError;

  for (const [index, route] of routes.entries()) {
    if (index > 0) {
      log.warn(`Uitwijken naar ${route.model} (${route.provider?.order?.join(', ') ?? 'standaard'}) na: ${lastError.message}`);
    }
    for (let attempt = 1; attempt <= AppConfig.LLM_ATTEMPTS_PER_ROUTE; attempt += 1) {
      try {
        return (await completeOnce(settings, route, request)).content;
      } catch (err) {
        if (!isTransient(err)) throw err;
        lastError = err;
        if (attempt === AppConfig.LLM_ATTEMPTS_PER_ROUTE) break;
        const delay = retryDelay(attempt + 1, err.retryAfterMs ?? null);
        log.warn(`LLM-aanroep (${route.model}) poging ${attempt} mislukt (${err.message}); opnieuw over ${Math.round(delay / 1000)} s`);
        await sleep(delay);
      }
    }
  }

  const tried = routes.length * AppConfig.LLM_ATTEMPTS_PER_ROUTE;
  const via = routes.length > 1 ? ', ook via de uitwijkroute' : '';
  throw new Error(`${lastError.message} — ook na ${tried} pogingen${via}; probeer het later nog eens`);
}

/**
 * De body van één verzoek, per soort endpoint (B-79). Geëxporteerd voor de tests.
 */
export function buildRequestBody(kind, route, { system, user, maxTokens, temperature }) {
  if (kind === ApiKind.ANTHROPIC) {
    // Messages API: systeemprompt los, geen `temperature` (geweigerd sinds API-
    // versie 2026-10-21). Denken staat bij de huidige modellen altijd aan en
    // telt mee in `max_tokens`: daarom ruimte erbij en een lage inspanning.
    return {
      model: route.model,
      max_tokens: maxTokens + AppConfig.LLM_THINKING_HEADROOM_TOKENS,
      system,
      messages: [{ role: 'user', content: user }],
      output_config: { effort: AppConfig.ANTHROPIC_EFFORT },
    };
  }

  const body = {
    model: route.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };

  if (kind === ApiKind.OPENAI) {
    // Redeneermodellen van OpenAI kennen alleen `max_completion_tokens`, en
    // weigeren een andere `temperature` dan de standaard.
    body.max_completion_tokens = maxTokens + AppConfig.LLM_THINKING_HEADROOM_TOKENS;
    return body;
  }

  body.temperature = temperature;
  body.max_tokens = maxTokens;

  if (kind === ApiKind.OPENROUTER) {
    if (route.provider) body.provider = route.provider;
    // Eén veld voor de redeneerinspanning; 'none' zet het uit. Zie AppConfig.
    body.reasoning = { effort: AppConfig.LLM_REASONING_EFFORT };
  }
  return body;
}

async function completeOnce(settings, route, request) {
  const { url, headers } = resolveEndpoint(settings);
  const kind = apiKind(settings);
  const body = buildRequestBody(kind, route, request);

  const { response, text } = await post(url, headers, body, AppConfig.LLM_TIMEOUT_MS);
  if (!response.ok) {
    log.error(`LLM-fout (${response.status}): ${text.slice(0, AppConfig.API_ERROR_LOG_MAX_CHARS)}`);
    if (isTransientStatus(response.status)) {
      throw new TransientLlmError(
        `LLM-API gaf ${response.status}: ${apiErrorMessage(text)}`,
        parseRetryAfter(response.headers.get('retry-after')),
      );
    }
    throw new Error(`LLM-API gaf ${response.status}: ${apiErrorMessage(text)}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Antwoord van de LLM-API was geen geldige JSON');
  }

  if (kind === ApiKind.ANTHROPIC) return parseAnthropicResponse(parsed, route);

  // OpenRouter geeft fouten soms met status 200 en een `error` in de body.
  if (parsed?.error) {
    const message = parsed.error.message ?? JSON.stringify(parsed.error);
    log.error('LLM-fout in een 200-antwoord', parsed.error);
    if (isTransientStatus(Number(parsed.error.code))) {
      throw new TransientLlmError(`LLM-API: ${message}`);
    }
    throw new Error(`LLM-API: ${message}`);
  }

  const choice = parsed?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === 'string' && content.trim()) {
    return { content, provider: parsed.provider ?? null, model: parsed.model ?? route.model };
  }

  // Leeg antwoord: zeg wát er misging in plaats van "geen tekst". De twee
  // gevallen die in de praktijk voorkomen zijn een op redeneertokens
  // opgebrande limiet en een afgekapt antwoord.
  throw new Error(emptyContentMessage(choice, parsed));
}

/**
 * Tekst uit een antwoord van de Claude API: de `text`-blokken achter elkaar;
 * denkblokken tellen niet mee. Geëxporteerd voor de tests.
 */
export function parseAnthropicResponse(parsed, route) {
  if (parsed?.type === 'error') {
    throw new Error(`LLM-API: ${parsed.error?.message ?? JSON.stringify(parsed.error)}`);
  }
  if (parsed?.stop_reason === 'refusal') {
    throw new Error('Het model weigerde dit verzoek (veiligheidsfilter van de aanbieder).');
  }
  const content = (parsed?.content ?? [])
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
  if (content.trim()) return { content, provider: null, model: parsed.model ?? route.model };
  if (parsed?.stop_reason === 'max_tokens') {
    const used = parsed?.usage?.output_tokens;
    throw new Error(`Het antwoord werd afgekapt door de tokenlimiet${used ? ` (${used} tokens gebruikt)` : ''}.`);
  }
  throw new Error(`De LLM-API gaf een leeg antwoord terug (stop_reason: ${parsed?.stop_reason ?? 'onbekend'}).`);
}

/** Leest de foutmelding uit een niet-2xx antwoordtekst, of geeft de tekst zelf. */
export function apiErrorMessage(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed?.error?.message ?? text.slice(0, AppConfig.API_ERROR_MESSAGE_MAX_CHARS);
  } catch {
    return text.slice(0, AppConfig.API_ERROR_MESSAGE_MAX_CHARS);
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

/**
 * Kleine testaanroep om endpoint, key, model en routing te verifiëren: één
 * route, één poging, zonder uitwijk — anders ziet een kapotte route er goed
 * uit omdat de andere antwoordt.
 *
 * De tokenlimiet staat ruim genoeg voor een model dat toch redeneertokens
 * produceert: met een krappe limiet komt er een leeg antwoord terug en lijkt de
 * verbinding stuk terwijl die het gewoon doet.
 *
 * @param {'primary' | 'fallback'} [which]
 * @returns {Promise<{reply: string, provider: string | null, model: string}>}
 */
export async function testConnection(settings, which = 'primary') {
  const routes = routesFor(settings);
  const route = which === 'fallback' ? routes[1] : routes[0];
  if (!route) throw new Error('De uitwijkroute staat uit');
  const result = await completeOnce(settings, route, {
    system: 'Antwoord met exact het woord: ok. Geen uitleg.',
    user: 'ok',
    maxTokens: 256,
    temperature: 0,
  });
  return { reply: result.content.trim().slice(0, 100), provider: result.provider, model: result.model };
}
