/**
 * De voorfilter (B-58): een ruime zeef vóór het relevantiefilter, via een
 * decisions-endpoint. Gesplitst uit llm-client.js (CR-14).
 */

import { AppConfig } from '../core/config.js';
import { log } from '../core/logger.js';
import { keyBelongsToBaseUrl } from '../core/api-kind.js';
import { apiErrorMessage, post, providerRouting } from './llm-transport.js';
import { sanitizeUntrusted } from './prompt-safety.js';

// Jev (TypeSafe) is een beslismodel achter OpenRouters alpha-endpoint
// `/api/alpha/decisions`. Het schrijft geen tekst maar geeft per vraag een
// kans ("noul"). Snel (± 1 s per 150 publicaties) en goedkoop, maar als
// eindoordeel te grof (B-D10); daarom alleen als ruime zeef vóór DeepSeek.
//
// Het endpoint is alpha: elke fout, of één ontbrekend antwoord, betekent dat
// de voorfilter voor de hele scan vervalt en alles naar DeepSeek gaat.

/**
 * De verbinding voor de voorfilter: eigen endpoint, model en routing; de key
 * is die van de voorfilter, of anders die van het taalmodel (alleen in de
 * route `direct` — via een proxy staat er geen key in de browser).
 * Geëxporteerd voor de tests.
 */
export function prefilterConnection(settings) {
  const ownKey = settings?.prefilterApiKey?.trim() ?? '';
  // De key van het taalmodel gaat alleen mee naar dezelfde host als de
  // Base-URL (standaard openrouter.ai). Een ander endpoint krijgt hem niet
  // (S-10): daar is een eigen voorfilter-key voor nodig.
  const sameHost = hostOf(settings?.prefilterEndpoint) !== null && hostOf(settings?.prefilterEndpoint) === hostOf(settings?.directBaseUrl);
  // En alleen als die key ook bij de Base-URL hoort (S-16).
  const sharedKey =
    settings?.transport === 'direct' && sameHost && keyBelongsToBaseUrl(settings) ? (settings.directApiKey?.trim() ?? '') : '';
  return {
    url: String(settings?.prefilterEndpoint ?? '').trim(),
    key: ownKey || sharedKey,
    model: String(settings?.prefilterModel ?? '').trim(),
    provider: providerRouting(settings?.prefilterProviderRouting),
  };
}

function hostOf(url) {
  try {
    return new URL(String(url ?? '').trim()).host;
  } catch {
    return null;
  }
}

/**
 * Voorfilter gebruiken? Vinkje aan, en een endpoint, model en key. In de
 * proxy-route dus alleen met een eigen key voor de voorfilter.
 */
export function isPrefilterActive(settings) {
  if (!settings?.jevPrefilterEnabled) return false;
  const { url, key, model } = prefilterConnection(settings);
  return Boolean(url && key && model);
}

/**
 * Het verzoek voor één batch. De publicaties staan als JSON in `state`; elke
 * vraag verwijst naar haar publicatie met de sleutel, zodat tekst van derden
 * nooit in de instructies zelf staat. Lengtegrenzen als bij het
 * relevantiefilter (B-44).
 *
 * De gebruikersvraag staat wél letterlijk in de instructie ("Gaat
 * `publicaties.p0` over …?"). Gemeten 2026-10-07: een verwijzing naar de vraag
 * in de state ("relevant voor `gebruikersvraag`?") scheidt veel slechter — 135
 * van 151 en 166 van 200 boven de drempel, tegen 73 en 39 zo.
 * Geëxporteerd voor de tests.
 */
export function buildDecisionsRequest(batch, userQuery, connection = {}) {
  const query = String(userQuery ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[?.!\s]+$/, '')
    .slice(0, AppConfig.JEV_QUERY_MAX_CHARS);
  const publicaties = {};
  const questions = {};
  batch.forEach((pub, index) => {
    const key = `p${index}`;
    publicaties[key] = {
      bron: sanitizeUntrusted(pub.sourceName, AppConfig.PROMPT_SOURCE_NAME_MAX_CHARS),
      titel: sanitizeUntrusted(pub.title, AppConfig.PROMPT_TITLE_MAX_CHARS),
      tekst: sanitizeUntrusted(pub.description, AppConfig.PROMPT_FILTER_TEXT_MAX_CHARS),
    };
    questions[key] = { type: 'noul', instructions: `Gaat \`publicaties.${key}\` over ${query}?` };
  });
  return {
    model: connection.model,
    ...(connection.provider ? { provider: connection.provider } : {}),
    state: { publicaties },
    questions,
  };
}

/**
 * Leest de scores uit een decisions-antwoord, in de volgorde van de batch
 * (0–100). Gooit als er een antwoord ontbreekt of geen kans 0–1 is.
 * Geëxporteerd voor de tests.
 */
export function readDecisions(parsed, size) {
  if (parsed?.error) {
    throw new Error(parsed.error.message ?? JSON.stringify(parsed.error));
  }
  return Array.from({ length: size }, (_, index) => {
    const noul = parsed?.answers?.[`p${index}`]?.noul;
    if (typeof noul !== 'number' || !Number.isFinite(noul) || noul < 0 || noul > 1) {
      throw new Error(`geen bruikbaar antwoord voor p${index}`);
    }
    return Math.round(noul * 100);
  });
}

function postDecisions(connection, body) {
  return post(
    connection.url,
    { 'Content-Type': 'application/json', Authorization: `Bearer ${connection.key}` },
    body,
    AppConfig.JEV_TIMEOUT_MS,
  );
}

async function decideBatch(batch, userQuery, connection) {
  const { response, text } = await postDecisions(connection, buildDecisionsRequest(batch, userQuery, connection));
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${apiErrorMessage(text)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('antwoord was geen geldige JSON');
  }
  return readDecisions(parsed, batch.length);
}

/**
 * Zeeft publicaties met Jev vóór de relevantiestap.
 *
 * @param {import('../core/models.js').Publication[]} publications
 * @param {string} userQuery
 * @param {object} settings
 * @returns {Promise<Array<{score: number, passes: boolean}> | null>}
 *   per publicatie de Jev-score (0–100) en of ze door mag; `null` als de
 *   voorfilter niet bruikbaar was — dan gaat alles naar het model.
 */
export async function prefilterPublications(publications, userQuery, settings) {
  if (publications.length === 0) return [];

  const connection = prefilterConnection(settings);
  const scores = [];
  try {
    for (let start = 0; start < publications.length; start += AppConfig.JEV_BATCH_SIZE) {
      const batch = publications.slice(start, start + AppConfig.JEV_BATCH_SIZE);
      scores.push(...(await decideBatch(batch, userQuery, connection)));
    }
  } catch (err) {
    const reason = err?.message ?? String(err);
    log.warn(`Voorfilter (Jev) niet bruikbaar, alles gaat naar het model: ${reason}`);
    return null;
  }

  return scores.map((score) => ({ score, passes: score >= AppConfig.JEV_PREFILTER_THRESHOLD }));
}

/**
 * Testaanroep voor de voorfilter: één vraag over een vaste, onschuldige
 * publicatie. Geeft de kans terug, plus model en provider die antwoordden.
 * @returns {Promise<{noul: number, model: string, provider: string | null}>}
 */
export async function testPrefilter(settings) {
  const connection = prefilterConnection(settings);
  if (!connection.url || !connection.model) throw new Error('Vul endpoint en model van de voorfilter in');
  if (!connection.key) throw new Error('Geen key voor de voorfilter: vul er een in, of gebruik de route met een eigen API-key');
  const { response, text } = await postDecisions(connection, {
    model: connection.model,
    ...(connection.provider ? { provider: connection.provider } : {}),
    state: { publicaties: { p0: { titel: 'Kamerbrief over stikstofdepositie in Natura 2000-gebieden' } } },
    questions: { p0: { type: 'noul', instructions: 'Gaat `publicaties.p0` over stikstof?' } },
  });
  if (!response.ok) throw new Error(`Voorfilter gaf ${response.status}: ${apiErrorMessage(text)}`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Het antwoord van de voorfilter was geen JSON — is dit een decisions-endpoint?');
  }
  const [score] = readDecisions(parsed, 1);
  return { noul: score / 100, model: parsed.model ?? connection.model, provider: parsed.provider ?? null };
}
