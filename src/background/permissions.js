/**
 * Host-permissies worden pas gevraagd wanneer ze nodig zijn.
 *
 * De extensie declareert géén host-permissies in het manifest, alleen
 * `optional_host_permissions`. Dat is bewust: het Edge-beleid eist dat elke
 * permissie los te verantwoorden is en verbiedt permissies "voor later"
 * aanvragen. De gebruiker geeft toestemming per host, op het moment dat er een
 * bron of proxy wordt toegevoegd.
 */

import { log } from '../core/logger.js';
import { SourceType } from '../core/models.js';
import { FULLTEXT_ORIGIN, isOpenOverheidSearchUrl } from '../network/open-overheid.js';

/** `https://example.com/nieuws/rss` → `https://example.com/*` */
export function originPattern(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}/*`;
  } catch {
    return null;
  }
}

export async function hasPermissionFor(url) {
  const origin = originPattern(url);
  if (!origin) return false;
  return chrome.permissions.contains({ origins: [origin] });
}

/**
 * Vraagt toestemming voor de host van `url`. Moet vanuit een gebruikersgebaar
 * worden aangeroepen (klik in het dashboard) — vanuit de service worker weigert
 * de browser de prompt.
 */
export async function requestPermissionFor(url) {
  const origin = originPattern(url);
  if (!origin) return false;
  const granted = await chrome.permissions.request({ origins: [origin] });
  log.info(`Toestemming voor ${origin}: ${granted ? 'verleend' : 'geweigerd'}`);
  return granted;
}

/** De hosts waarvoor nog geen toestemming is, gegeven een lijst URL's. */
export async function missingOrigins(urls) {
  const origins = [...new Set(urls.map(originPattern).filter(Boolean))];
  const missing = [];
  for (const origin of origins) {
    const granted = await chrome.permissions.contains({ origins: [origin] });
    if (!granted) missing.push(origin);
  }
  return missing;
}

/**
 * De hosts die een bron nodig heeft. Een open.overheid-zoekopdracht ook
 * officielebekendmakingen.nl, voor de volledige tekst van publicaties zonder
 * fragment (B-60). Zo vraagt de UI beide in één keer; die tweede is voor de
 * scan geen voorwaarde — zonder toestemming blijft de tekst gewoon weg.
 * @param {Array<{url: string, type?: string}>} sources
 */
export function originsForSources(sources) {
  const origins = new Set();
  for (const source of sources) {
    const origin = originPattern(source.url);
    if (!origin) continue;
    origins.add(origin);
    if (source.type === SourceType.OPEN_OVERHEID || isOpenOverheidSearchUrl(source.url)) {
      origins.add(FULLTEXT_ORIGIN);
    }
  }
  return [...origins];
}

/** Welke van deze host-patronen nog geen toestemming hebben. */
export async function missingOf(origins) {
  const missing = [];
  for (const origin of origins) {
    if (!(await chrome.permissions.contains({ origins: [origin] }))) missing.push(origin);
  }
  return missing;
}
