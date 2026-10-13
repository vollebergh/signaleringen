/**
 * Verzamelt de opgehaalde publicaties van één scan, ontdubbeld (CR-02).
 *
 * Staat hetzelfde artikel in twee feeds, of twee keer in één feed, dan telt
 * het één keer: de eerste bron wint. Anders ging het twee keer naar het model
 * en kon het twee keer als bron in de signalering staan.
 */

import { dedupeKey } from '../data/history-repository.js';

/**
 * Voegt de publicaties van één bron toe aan `fetched`.
 * @param {Array<{publication: object, key: string, isNew: boolean, seenRecord: object | null}>} fetched
 *   wordt aangevuld
 * @param {object[]} publications van deze bron
 * @param {Map<string, object>} seen eerder geziene publicaties van het profiel
 * @param {Set<string>} keysInScan sleutels die deze scan al heeft; wordt aangevuld
 * @returns {{ added: number, newCount: number, duplicates: number }}
 */
export function addFetched(fetched, publications, seen, keysInScan) {
  let added = 0;
  let newCount = 0;
  let duplicates = 0;
  for (const publication of publications) {
    const key = dedupeKey(publication);
    if (keysInScan.has(key)) {
      duplicates += 1;
      continue;
    }
    keysInScan.add(key);
    const seenRecord = seen.get(key) ?? null;
    if (!seenRecord) newCount += 1;
    fetched.push({ publication, key, isNew: !seenRecord, seenRecord });
    added += 1;
  }
  return { added, newCount, duplicates };
}
