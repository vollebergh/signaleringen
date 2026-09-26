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

/** `fetch` met een harde deadline via AbortController. */
export async function fetchWithTimeout(url, options = {}, timeoutMs = AppConfig.FEED_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

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
