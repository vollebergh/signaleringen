/**
 * Scangeschiedenis, publicaties en syntheses. Tegenhanger van ScanHistoryDao.kt.
 *
 * Let op de vlaggen: `isBookmarked` en `isRead` staan als 0/1 in de store.
 * IndexedDB accepteert booleans niet als sleutelwaarde, dus een index erop
 * werkt alleen met getallen — net zoals Room booleans als INTEGER opslaat.
 * De mappers hieronder zijn de enige plek waar die conversie plaatsvindt.
 */

import { AppConfig } from '../core/config.js';
import { Store, getAllByIndex, getByKey, transaction } from './db.js';
import { log } from '../core/logger.js';

/** Recordvorm → domeinvorm (0/1 wordt true/false). */
/** Nieuw eerst, daarna de nieuwste publicatie eerst. */
const newestFirst = (a, b) =>
  Number(b.isNew) - Number(a.isNew) || (b.publication?.publishedDate ?? 0) - (a.publication?.publishedDate ?? 0);

/** `relevance` van een publicatie uit een scan zonder taalmodel (B-82). */
export const UNJUDGED = 'unjudged';

function toResult(record) {
  return {
    ...record,
    isRelevant: Boolean(record.isRelevant),
    isBookmarked: Boolean(record.isBookmarked),
    isRead: Boolean(record.isRead),
    isNew: Boolean(record.isNew),
  };
}

/** Domeinvorm → recordvorm (true/false wordt 0/1). */
export function toPublicationRecord(result) {
  return {
    ...result,
    isRelevant: result.isRelevant ? 1 : 0,
    isBookmarked: result.isBookmarked ? 1 : 0,
    isRead: result.isRead ? 1 : 0,
    isNew: result.isNew ? 1 : 0,
  };
}

/**
 * Slaat een scan met bijbehorende publicaties op in één transactie, zodat een
 * afgebroken schrijfactie nooit een scan zonder publicaties achterlaat.
 */
export async function saveScan(scan, publications) {
  const records = publications.map(toPublicationRecord);
  await transaction([Store.SCANS, Store.PUBLICATIONS], 'readwrite', (stores) => {
    stores[Store.SCANS].put(scan);
    records.forEach((p) => stores[Store.PUBLICATIONS].put(p));
  });
  log.debug(`Scan ${scan.id} opgeslagen met ${records.length} publicaties`);
}

export async function saveSynthesis(synthesis) {
  await transaction(Store.SYNTHESES, 'readwrite', (store) => {
    store.put(synthesis);
  });
}

export async function getSynthesis(scanId) {
  return getByKey(Store.SYNTHESES, scanId);
}

export async function getScansForProfile(profileId) {
  const scans = await getAllByIndex(Store.SCANS, 'profileId', profileId);
  return scans.sort((a, b) => b.scanDate - a.scanDate);
}

export async function getLatestScan(profileId) {
  const scans = await getScansForProfile(profileId);
  return scans[0] ?? null;
}

export async function getPublicationsForScan(scanId) {
  const records = await getAllByIndex(Store.PUBLICATIONS, 'scanId', scanId);
  // Relevant eerst, daarna op score (hoog → laag), daarna nieuwste eerst.
  // Scans van vóór de scores (B-59) hebben geen score; die vallen terug op datum.
  return records.map(toResult).sort((a, b) => {
    if (a.isRelevant !== b.isRelevant) return a.isRelevant ? -1 : 1;
    const byScore = (b.score ?? -1) - (a.score ?? -1);
    if (byScore !== 0) return byScore;
    return b.publication.publishedDate - a.publication.publishedDate;
  });
}

/** Volledig resultaat van één scan: metadata, publicaties en synthese. */
export async function getScanResults(scanId) {
  const [scan, publications, synthesis] = await Promise.all([
    getByKey(Store.SCANS, scanId),
    getPublicationsForScan(scanId),
    getSynthesis(scanId),
  ]);
  if (!scan) return null;
  return {
    scan,
    relevant: publications.filter((p) => p.isRelevant),
    possible: publications.filter((p) => !p.isRelevant && p.relevance === 'mogelijk'),
    filtered: publications.filter((p) => !p.isRelevant && p.relevance !== 'mogelijk' && p.relevance !== UNJUDGED),
    // Leesmodus zonder taalmodel (B-82): opgehaald, niet beoordeeld.
    unjudged: publications.filter((p) => p.relevance === UNJUDGED).sort(newestFirst),
    synthesis: synthesis ?? null,
  };
}

/**
 * Read-modify-write op één publicatie. Bewust twee transacties: een `await`
 * binnen een IndexedDB-transactie loopt het risico dat die tussentijds sluit.
 */
async function updatePublication(publicationId, patch) {
  const record = await getByKey(Store.PUBLICATIONS, publicationId);
  if (!record) return null;
  const updated = { ...record, ...patch };
  await transaction(Store.PUBLICATIONS, 'readwrite', (store) => {
    store.put(updated);
  });
  return toResult(updated);
}

export function setBookmarked(publicationId, bookmarked) {
  return updatePublication(publicationId, { isBookmarked: bookmarked ? 1 : 0 });
}

export function markAsRead(publicationId) {
  return updatePublication(publicationId, { isRead: 1 });
}

export async function getBookmarkedPublications() {
  const records = await getAllByIndex(Store.PUBLICATIONS, 'isBookmarked', 1);
  return records
    .map(toResult)
    .sort((a, b) => b.publication.publishedDate - a.publication.publishedDate);
}

/**
 * Houdt per profiel de nieuwste N scans en verwijdert de rest inclusief
 * publicaties en synthese. Tegenhanger van `pruneOldScans`.
 */
export async function pruneOldScans(profileId, keep = AppConfig.SCANS_TO_KEEP_PER_PROFILE) {
  const scans = await getScansForProfile(profileId);
  const stale = scans.slice(keep);
  if (stale.length === 0) return;

  const publicationIds = [];
  for (const scan of stale) {
    const pubs = await getAllByIndex(Store.PUBLICATIONS, 'scanId', scan.id);
    publicationIds.push(...pubs.map((p) => p.id));
  }

  await transaction([Store.SCANS, Store.PUBLICATIONS, Store.SYNTHESES], 'readwrite', (stores) => {
    stale.forEach((scan) => {
      stores[Store.SCANS].delete(scan.id);
      stores[Store.SYNTHESES].delete(scan.id);
    });
    publicationIds.forEach((id) => stores[Store.PUBLICATIONS].delete(id));
  });
  log.debug(`${stale.length} oude scan(s) opgeruimd voor profiel ${profileId}`);
}

/**
 * Alle syntheses van één profiel, nieuwste eerst, met de scan-metadata erbij.
 * Scans zonder synthese (niets relevants gevonden) vallen weg — dit is een
 * leeslijst van opgestelde signaleringen, geen scangeschiedenis.
 */
export async function getSynthesesForProfile(profileId) {
  const scans = await getScansForProfile(profileId);
  const entries = [];

  for (const scan of scans) {
    const synthesis = await getSynthesis(scan.id);
    if (!synthesis?.text) continue;
    entries.push({
      scanId: scan.id,
      profileId,
      createdAt: synthesis.createdAt ?? scan.scanDate,
      scanDate: scan.scanDate,
      text: synthesis.text,
      sources: synthesis.sources ?? [],
      warnings: synthesis.warnings ?? [],
      selection: synthesis.selection ?? null,
      relevantCount: scan.relevantCount ?? 0,
      totalFetched: scan.totalFetched ?? 0,
      newCount: scan.newCount ?? 0,
    });
  }

  return entries;
}

/** De nieuwste synthese van een profiel, of null als die er nog niet is. */
export async function getLatestSynthesis(profileId) {
  const all = await getSynthesesForProfile(profileId);
  return all[0] ?? null;
}

/** Alle scan-, publicatie- en synthese-id's van één profiel. Voor cascade-delete. */
export async function collectProfileData(profileId) {
  const scans = await getAllByIndex(Store.SCANS, 'profileId', profileId);
  const publicationIds = [];
  for (const scan of scans) {
    const pubs = await getAllByIndex(Store.PUBLICATIONS, 'scanId', scan.id);
    publicationIds.push(...pubs.map((p) => p.id));
  }
  return { scanIds: scans.map((s) => s.id), publicationIds };
}
