/**
 * Host-permissies worden pas gevraagd wanneer ze nodig zijn.
 *
 * De extensie declareert géén host-permissies in het manifest, alleen
 * `optional_host_permissions`. Dat is bewust: het Edge-beleid eist dat elke
 * permissie los te verantwoorden is en verbiedt permissies "voor later"
 * aanvragen. De gebruiker geeft toestemming per host, op het moment dat er een
 * bron of proxy wordt toegevoegd.
 */

import { originPattern, missingOf } from '../core/origins.js';

export async function hasPermissionFor(url) {
  const origin = originPattern(url);
  if (!origin) return false;
  return chrome.permissions.contains({ origins: [origin] });
}

/** De hosts waarvoor nog geen toestemming is, gegeven een lijst URL's. */
export function missingOrigins(urls) {
  return missingOf([...new Set(urls.map(originPattern).filter(Boolean))]);
}
