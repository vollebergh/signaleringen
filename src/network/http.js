/**
 * HTTP-hulpmiddelen: timeout, retry met exponential backoff en het
 * onderscheid transiënt/definitief. Tegenhanger van HttpClient.kt plus
 * `fetchWithRetry` uit FeedFetcher.kt.
 */

import { AppConfig } from '../core/config.js';
import { Result } from '../core/result.js';
import { log } from '../core/logger.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 429 en 5xx zijn tijdelijk; de rest is een fout van onze kant. */
export function isTransientStatus(status) {
  return status === 429 || (status >= 500 && status < 600);
}

/** Antwoord groter dan toegestaan (CR-04). Definitief: opnieuw proberen helpt niet. */
export class ResponseTooLargeError extends Error {
  constructor(maxBytes) {
    super(`Antwoord groter dan ${Math.round(maxBytes / 1024 / 1024)} MB; niet verwerkt`);
    this.name = 'ResponseTooLargeError';
  }
}

/**
 * `fetch` plus het lezen van de body, onder één deadline en met een maximale
 * grootte (CR-04, S-03). Eerder gold de deadline alleen tot de headers binnen
 * waren: een trage of eindeloze body hield de scan dan onbeperkt vast.
 *
 * Ook bij een status buiten 2xx wordt de body gelezen (daar staat vaak de
 * foutmelding in); de aanroeper kijkt zelf naar `response.ok`.
 *
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {{ timeoutMs?: number, maxBytes?: number }} [limits]
 * @returns {Promise<{ response: Response, bytes: Uint8Array }>}
 */
export async function fetchBytes(url, options = {}, { timeoutMs = AppConfig.FEED_TIMEOUT_MS, maxBytes = AppConfig.RESPONSE_MAX_BYTES } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, redirect: 'follow' });
    // De server noemt de grootte vaak vooraf; dan hoeft er niets binnen te komen.
    if (Number(response.headers.get('content-length')) > maxBytes) {
      controller.abort();
      throw new ResponseTooLargeError(maxBytes);
    }
    return { response, bytes: await readLimited(response, maxBytes, controller) };
  } finally {
    clearTimeout(timer);
  }
}

/** Leest de body in stukken en breekt af boven `maxBytes`. */
async function readLimited(response, maxBytes, controller) {
  if (!response.body?.getReader) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      controller.abort();
      throw new ResponseTooLargeError(maxBytes);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Body als UTF-8-tekst (JSON en HTML van bekende hosts). */
export const utf8 = (bytes) => new TextDecoder('utf-8').decode(bytes);

/**
 * Voert `block` uit tot het slaagt of het aantal pogingen op is. Alleen
 * `networkError` wordt opnieuw geprobeerd; een definitieve fout stopt meteen.
 * @param {string} label naam voor logging
 * @param {() => Promise<import('../core/result.js').NetworkResult>} block
 */
export async function withRetry(label, block) {
  let last = null;
  let delayMs = AppConfig.RETRY_INITIAL_DELAY_MS;

  for (let attempt = 1; attempt <= AppConfig.MAX_RETRIES; attempt += 1) {
    const result = await block();
    if (Result.isSuccess(result)) return result;

    last = result;
    if (!Result.isRetryable(result) || attempt === AppConfig.MAX_RETRIES) {
      log.warn(`'${label}' mislukt na poging ${attempt}: ${Result.message(result)}`);
      return result;
    }

    log.debug(`'${label}' poging ${attempt} mislukt, opnieuw over ${delayMs}ms`);
    await sleep(delayMs);
    delayMs *= AppConfig.RETRY_BACKOFF_FACTOR;
  }

  return last;
}

/** Vertaalt een uitzondering van `fetch` naar het juiste resultaattype. */
export function classifyFetchError(error, label) {
  if (error instanceof ResponseTooLargeError) {
    return Result.error(`${error.message}: ${label}`, error);
  }
  if (error?.name === 'AbortError') {
    return Result.networkError(`Timeout voor ${label}`, error);
  }
  if (error instanceof TypeError) {
    // TypeError uit fetch betekent netwerkfout, DNS-fout of een geblokkeerde
    // request — allemaal het proberen waard.
    return Result.networkError(`Netwerkfout voor ${label}: ${error.message}`, error);
  }
  return Result.error(`Fout bij verwerken van ${label}: ${error?.message ?? error}`, error);
}
