/**
 * Hosts en host-patronen voor toestemmingen. Pure functies, gebruikt door de
 * UI (welke toestemming vragen) en de worker (mag deze scan) — daarom in de
 * kern en niet in `background/` of `network/` (CR-13).
 */

import { SourceType } from './models.js';

/** De site waarvan de gebruiker een zoek-URL kopieert. */
const OPEN_OVERHEID_SITE_HOST = 'open.overheid.nl';

/** Host met de volledige tekst van Kamerstukken (B-60). */
export const FULLTEXT_HOST = 'zoek.officielebekendmakingen.nl';
export const FULLTEXT_ORIGIN = `https://${FULLTEXT_HOST}/*`;

/** Is dit een zoek-URL van open.overheid.nl, zoals een gebruiker die kopieert? */
export function isOpenOverheidSearchUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === OPEN_OVERHEID_SITE_HOST && parsed.pathname.replace(/\/+$/, '') === '/zoeken';
  } catch {
    return false;
  }
}

/** `https://example.com/nieuws/rss` → `https://example.com/*` */
export function originPattern(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}/*`;
  } catch {
    return null;
  }
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

/**
 * Welke van deze host-patronen nog geen toestemming hebben. Een dunne laag
 * over `chrome.permissions`, die in de worker en in extensiepagina's gelijk
 * werkt.
 */
export async function missingOf(origins) {
  const missing = [];
  for (const origin of origins) {
    if (!(await chrome.permissions.contains({ origins: [origin] }))) missing.push(origin);
  }
  return missing;
}
