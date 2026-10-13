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
import { originPattern, missingOf } from '../core/origins.js';

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
export function missingOrigins(urls) {
  return missingOf([...new Set(urls.map(originPattern).filter(Boolean))]);
}
