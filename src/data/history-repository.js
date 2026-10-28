/**
 * Bijhouden wat een profiel eerder al heeft gezien.
 *
 * Twee vragen moeten na elke scan te beantwoorden zijn:
 *   1. Is deze publicatie nieuw, of kwam hij eerder al langs?
 *   2. Is hij al eens in een signalering verwerkt, en zo ja in welke?
 *
 * Daarvoor twee stores:
 *   - `seen`        één record per publicatie per profiel, met de scan waarin
 *                   hij voor het eerst opdook en de synthese die hem gebruikte.
 *   - `sourceState` één record per bron per profiel: wanneer voor het laatst
 *                   opgehaald, met welk resultaat, hoeveel daarvan nieuw was.
 */

import { AppConfig } from '../core/config.js';
import { Store, getAllByIndex, getByKey, transaction } from './db.js';
import { log } from '../core/logger.js';

/**
 * Identificeert een publicatie over scans heen. De URL is leidend; feeds die
 * geen link meegeven vallen terug op bron + titel. Zoekparameters die alleen
 * herkomst bijhouden worden weggelaten, anders telt hetzelfde artikel via een
 * andere campagne-URL als nieuw.
 */
export function dedupeKey(publication) {
  const url = (publication.url ?? '').trim();
  if (url) {
    try {
      const parsed = new URL(url);
      for (const param of [...parsed.searchParams.keys()]) {
        if (/^(utm_|fbclid|gclid|mc_|ref$|source$)/i.test(param)) {
          parsed.searchParams.delete(param);
        }
      }
      parsed.hash = '';
      return `url:${parsed.toString().replace(/\/$/, '').toLowerCase()}`;
    } catch {
      return `url:${url.toLowerCase()}`;
    }
  }
  return `titel:${publication.sourceName}|${(publication.title ?? '').trim().toLowerCase()}`;
}

const seenId = (profileId, key) => `${profileId}::${key}`;
const sourceStateId = (profileId, sourceId) => `${profileId}::${sourceId}`;

/**
 * Alle eerder geziene publicaties van één profiel, als Map op dedupe-sleutel.
 * @returns {Promise<Map<string, object>>}
 */
export async function loadSeen(profileId) {
  const records = await getAllByIndex(Store.SEEN, 'profileId', profileId);
  return new Map(records.map((record) => [record.key, record]));
}

/**
 * Legt vast dat deze publicaties in deze scan zijn gezien. Records die al
 * bestaan blijven staan — het eerste-keer-gezien-moment mag niet verschuiven.
 * @param {Map<string, object>} [existing] de al geladen `seen` van dit profiel;
 *   scheelt een tweede keer alles laden (CR-05)
 */
export async function recordSeen(profileId, scanId, entries, existing = null) {
  if (entries.length === 0) return;
  const now = Date.now();
  existing ??= await loadSeen(profileId);

  const records = entries
    .filter((entry) => !existing.has(entry.key))
    .map((entry) => ({
      id: seenId(profileId, entry.key),
      profileId,
      key: entry.key,
      url: entry.url ?? '',
      title: entry.title ?? '',
      sourceName: entry.sourceName ?? '',
      firstSeenAt: now,
      lastSeenAt: now,
      firstScanId: scanId,
      synthesisScanId: null,
      synthesisAt: null,
      // Opgehaald in een scan zonder taalmodel (leesmodus, B-82): gezien,
      // maar nog niet beoordeeld. Records zonder dit veld zijn beoordeeld.
      ...(entry.unjudged ? { unjudged: true } : {}),
    }));

  if (records.length === 0) return;
  await transaction(Store.SEEN, 'readwrite', (store) => {
    records.forEach((record) => store.put(record));
  });
  log.debug(`${records.length} nieuwe publicatie(s) vastgelegd voor profiel ${profileId}`);
}

/**
 * Haalt de markering "nog niet beoordeeld" weg (B-82): het model heeft deze
 * publicaties nu beoordeeld.
 * @param {object[]} records seen-records met `unjudged: true`
 */
export async function markJudged(records) {
  const pending = records.filter((record) => record?.unjudged);
  if (pending.length === 0) return 0;
  await transaction(Store.SEEN, 'readwrite', (store) => {
    pending.forEach(({ unjudged, ...record }) => store.put(record));
  });
  return pending.length;
}

/**
 * Werkt `lastSeenAt` bij van eerder geziene publicaties die nu weer in een bron
 * stonden, hooguit één keer per `SEEN_REFRESH_MS` per record (CR-05).
 * @param {object[]} records seen-records uit `loadSeen`
 * @returns {Promise<number>} aantal bijgewerkte records
 */
export async function refreshSeen(records, now = Date.now()) {
  const stale = records.filter((record) => (record.lastSeenAt ?? record.firstSeenAt ?? 0) < now - AppConfig.SEEN_REFRESH_MS);
  if (stale.length === 0) return 0;
  await transaction(Store.SEEN, 'readwrite', (store) => {
    stale.forEach((record) => store.put({ ...record, lastSeenAt: now }));
  });
  return stale.length;
}

/**
 * Welke seen-records weg mogen: langer dan de bewaartermijn niet meer in een
 * bron gezien. Records van vóór `lastSeenAt` vallen terug op `firstSeenAt`.
 * Geëxporteerd voor de tests.
 */
export function expiredSeen(records, now = Date.now(), retentionDays = AppConfig.SEEN_RETENTION_DAYS) {
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  return records.filter((record) => (record.lastSeenAt ?? record.firstSeenAt ?? 0) < cutoff);
}

/** Ruimt verlopen seen-records van een profiel op (CR-05). */
export async function pruneSeen(profileId, now = Date.now()) {
  const expired = expiredSeen(await getAllByIndex(Store.SEEN, 'profileId', profileId), now);
  if (expired.length === 0) return 0;
  await transaction(Store.SEEN, 'readwrite', (store) => {
    expired.forEach((record) => store.delete(record.id));
  });
  log.debug(`${expired.length} verlopen seen-record(s) opgeruimd voor profiel ${profileId}`);
  return expired.length;
}

/**
 * Markeert publicaties als verwerkt in een synthese. Alleen de eerste synthese
 * die een publicatie gebruikt wordt vastgelegd; daarna blijft die verwijzing staan.
 */
export async function markSynthesised(profileId, scanId, keys) {
  if (keys.length === 0) return;
  const now = Date.now();

  const records = [];
  for (const key of keys) {
    const record = await getByKey(Store.SEEN, seenId(profileId, key));
    if (record && !record.synthesisScanId) {
      records.push({ ...record, synthesisScanId: scanId, synthesisAt: now });
    }
  }

  if (records.length === 0) return;
  await transaction(Store.SEEN, 'readwrite', (store) => {
    records.forEach((record) => store.put(record));
  });
  log.debug(`${records.length} publicatie(s) gemarkeerd als verwerkt in synthese ${scanId}`);
}

// ── Bronstatus ──────────────────────────────────────────────────────────────

/** Alle bronstatussen van een profiel, als Map op bron-id. */
async function loadSourceStates(profileId) {
  const records = await getAllByIndex(Store.SOURCE_STATE, 'profileId', profileId);
  return new Map(records.map((record) => [record.sourceId, record]));
}

/**
 * Werkt de status van één bron bij na een ophaalpoging.
 * @param {{ profileId: string, source: object, success: boolean,
 *           fetchedCount?: number, newCount?: number, errorMessage?: string,
 *           scanId?: string }} update
 */
export async function recordSourceFetch(update) {
  const { profileId, source, success, fetchedCount, newCount, errorMessage, scanId } = update;
  const id = sourceStateId(profileId, source.id);
  const previous = (await getByKey(Store.SOURCE_STATE, id)) ?? {};

  const record = {
    id,
    profileId,
    sourceId: source.id,
    sourceName: source.name,
    url: source.url,
    lastAttemptAt: Date.now(),
    lastAttemptOk: success,
    lastErrorMessage: success ? null : (errorMessage ?? null),
    // Een mislukte poging mag de laatste geslaagde ophaling niet wissen.
    lastFetchedAt: success ? Date.now() : (previous.lastFetchedAt ?? null),
    lastFetchedCount: success ? fetchedCount : (previous.lastFetchedCount ?? null),
    lastNewCount: success ? newCount : (previous.lastNewCount ?? null),
    lastScanId: success ? (scanId ?? previous.lastScanId ?? null) : (previous.lastScanId ?? null),
    totalFetches: (previous.totalFetches ?? 0) + 1,
  };

  await transaction(Store.SOURCE_STATE, 'readwrite', (store) => {
    store.put(record);
  });
  return record;
}

/**
 * Overzicht per bron voor de UI: gecombineerde bron + status + hoeveel van die
 * bron ooit in een synthese is verwerkt.
 */
export async function getSourceOverview(profile) {
  const [states, seen] = await Promise.all([loadSourceStates(profile.id), loadSeen(profile.id)]);

  const synthesisedPerSource = new Map();
  for (const record of seen.values()) {
    if (!record.synthesisScanId) continue;
    const count = synthesisedPerSource.get(record.sourceName) ?? 0;
    synthesisedPerSource.set(record.sourceName, count + 1);
  }

  return profile.sources.map((source) => {
    const state = states.get(source.id);
    return {
      source,
      lastFetchedAt: state?.lastFetchedAt ?? null,
      lastAttemptAt: state?.lastAttemptAt ?? null,
      lastAttemptOk: state?.lastAttemptOk ?? null,
      lastErrorMessage: state?.lastErrorMessage ?? null,
      lastFetchedCount: state?.lastFetchedCount ?? null,
      lastNewCount: state?.lastNewCount ?? null,
      synthesisedCount: synthesisedPerSource.get(source.name) ?? 0,
      neverFetched: !state,
    };
  });
}

/** Ruimt de geschiedenis van een profiel op. Onderdeel van de cascade-delete. */
export async function deleteHistoryForProfile(profileId) {
  const [seen, states] = await Promise.all([
    getAllByIndex(Store.SEEN, 'profileId', profileId),
    getAllByIndex(Store.SOURCE_STATE, 'profileId', profileId),
  ]);

  if (seen.length === 0 && states.length === 0) return;
  await transaction([Store.SEEN, Store.SOURCE_STATE], 'readwrite', (stores) => {
    seen.forEach((record) => stores[Store.SEEN].delete(record.id));
    states.forEach((record) => stores[Store.SOURCE_STATE].delete(record.id));
  });
}
