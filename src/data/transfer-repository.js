/**
 * Export en import van profielen, inclusief alles wat eronder hangt: bronnen,
 * beoordeelde publicaties, scangeschiedenis, syntheses en de administratie van
 * wat eerder is gezien en verwerkt.
 *
 * **Waarom JSON en geen XML.** De data staat al als JavaScript-objecten in
 * IndexedDB; JSON is daar een directe afbeelding van. XML zou een schema, een
 * escaping-regime voor de artikelteksten en een parser-heen-en-weer toevoegen
 * zonder dat er iets tegenover staat — de extensie heeft al een eigen
 * XML-parser voor feeds, maar die is bewust minimaal en niet bedoeld om een
 * eigen exportformaat mee rond te pompen.
 *
 * **Vorm van het bestand.** Eén envelop met een `format` en `formatVersion`,
 * zodat een import van een toekomstige versie herkend wordt in plaats van
 * halverwege stuk te lopen op een ontbrekend veld.
 */

import { AppConfig } from '../core/config.js';
import { createProfile } from '../core/models.js';
import { log } from '../core/logger.js';
import { Store, getAllByIndex, getByKey, transaction } from './db.js';
import { loadProfiles, getProfile } from './profile-repository.js';
import { toPublicationRecord } from './scan-repository.js';

const newId = () => crypto.randomUUID();

// ── Export ──────────────────────────────────────────────────────────────────

/**
 * Bouwt een exportbundel voor de opgegeven profielen.
 * @param {string[]} profileIds leeg of weggelaten betekent: alle profielen
 */
export async function exportProfiles(profileIds) {
  const all = await loadProfiles();
  const selected =
    profileIds?.length > 0 ? all.filter((p) => profileIds.includes(p.id)) : all;

  const profiles = [];
  for (const profile of selected) {
    profiles.push(await collectProfile(profile));
  }

  const manifest = chrome.runtime.getManifest();
  return {
    format: AppConfig.EXPORT_FORMAT,
    formatVersion: AppConfig.EXPORT_FORMAT_VERSION,
    exportedAt: Date.now(),
    generator: { name: manifest.name, version: manifest.version },
    profiles,
  };
}

async function collectProfile(profile) {
  const [scans, seen, sourceStates] = await Promise.all([
    getAllByIndex(Store.SCANS, 'profileId', profile.id),
    getAllByIndex(Store.SEEN, 'profileId', profile.id),
    getAllByIndex(Store.SOURCE_STATE, 'profileId', profile.id),
  ]);

  const scanBundles = [];
  for (const scan of scans.sort((a, b) => b.scanDate - a.scanDate)) {
    const [publications, synthesis] = await Promise.all([
      getAllByIndex(Store.PUBLICATIONS, 'scanId', scan.id),
      getByKey(Store.SYNTHESES, scan.id),
    ]);
    scanBundles.push({ scan, publications, synthesis: synthesis ?? null });
  }

  return { profile, scans: scanBundles, seen, sourceStates };
}

/** Bestandsnaam met datum, zodat meerdere exports naast elkaar leesbaar blijven. */
export function exportFilename(bundle) {
  const date = new Date(bundle.exportedAt).toISOString().slice(0, 10);
  const count = bundle.profiles.length;
  const scope = count === 1 ? slug(bundle.profiles[0].profile.name) : `${count}-profielen`;
  return `signaleringen-${scope}-${date}.json`;
}

function slug(text) {
  // NFD splitst "é" in "e" + een combining accent; die accenten zijn
  // niet-alfanumeriek en sneuvelen daarna vanzelf in de tweede replace.
  // Daarom is er geen aparte regex voor het diakrieten-bereik nodig.
  return (
    (text ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'profiel'
  );
}

// ── Import ──────────────────────────────────────────────────────────────────

/**
 * Controleert een bundel en vat samen wat erin zit, zonder iets weg te
 * schrijven. Zo kan de gebruiker kiezen vóórdat er data verandert.
 */
export async function previewImport(bundle) {
  assertValidBundle(bundle);
  const existing = await loadProfiles();
  const existingIds = new Set(existing.map((p) => p.id));
  const existingNames = new Map(existing.map((p) => [p.name.toLowerCase(), p]));

  return {
    formatVersion: bundle.formatVersion,
    exportedAt: bundle.exportedAt,
    generator: bundle.generator ?? null,
    profiles: bundle.profiles.map((entry) => {
      const profile = entry.profile;
      const publicationCount = entry.scans.reduce(
        (total, s) => total + (s.publications?.length ?? 0),
        0,
      );
      return {
        id: profile.id,
        name: profile.name,
        category: profile.category ?? '',
        sourceCount: profile.sources?.length ?? 0,
        scanCount: entry.scans.length,
        publicationCount,
        synthesisCount: entry.scans.filter((s) => s.synthesis?.text).length,
        seenCount: entry.seen?.length ?? 0,
        idExists: existingIds.has(profile.id),
        nameExists: existingNames.has((profile.name ?? '').toLowerCase()),
      };
    }),
  };
}

/**
 * Controleert de envelop van een exportbestand. Geëxporteerd voor de tests —
 * dit is de enige plek waar een bestand van buiten wordt vertrouwd, dus het is
 * de moeite om de afwijzingen vast te leggen.
 */
export function assertValidBundle(bundle) {
  if (!bundle || typeof bundle !== 'object') {
    throw new Error('Dit bestand bevat geen bruikbare gegevens.');
  }
  if (bundle.format !== AppConfig.EXPORT_FORMAT) {
    throw new Error('Dit is geen exportbestand van Signaleringen.');
  }
  if (typeof bundle.formatVersion !== 'number') {
    throw new Error('Het exportbestand heeft geen versienummer.');
  }
  if (bundle.formatVersion > AppConfig.EXPORT_FORMAT_VERSION) {
    throw new Error(
      `Dit bestand komt uit een nieuwere versie (formaat ${bundle.formatVersion}, deze extensie kent ${AppConfig.EXPORT_FORMAT_VERSION}). Werk de extensie bij.`,
    );
  }
  if (!Array.isArray(bundle.profiles)) {
    throw new Error('Het exportbestand bevat geen profielen.');
  }
}

/**
 * Schrijft een bundel weg.
 *
 * @param {object} bundle
 * @param {{ profileIds?: string[], mode?: 'copy' | 'replace' }} options
 *   `copy` (standaard) geeft alles nieuwe id's en laat bestaande profielen met
 *   rust. `replace` overschrijft een profiel met dezelfde id, inclusief de
 *   geschiedenis eronder — dat is destructief, dus de UI vraagt er apart om.
 */
export async function importProfiles(bundle, options = {}) {
  assertValidBundle(bundle);
  const mode = options.mode === 'replace' ? 'replace' : 'copy';
  const wanted = options.profileIds;

  const entries = wanted?.length
    ? bundle.profiles.filter((e) => wanted.includes(e.profile.id))
    : bundle.profiles;

  const result = { imported: 0, replaced: 0, skipped: 0, names: [] };

  for (const entry of entries) {
    const existing = await getProfile(entry.profile.id);

    if (existing && mode === 'replace') {
      await deleteProfileData(entry.profile.id);
      await writeEntry(entry, { remap: false });
      result.replaced += 1;
    } else if (existing) {
      await writeEntry(entry, { remap: true });
      result.imported += 1;
    } else {
      await writeEntry(entry, { remap: false });
      result.imported += 1;
    }
    result.names.push(entry.profile.name);
  }

  log.info(`Import klaar: ${result.imported} toegevoegd, ${result.replaced} vervangen`);
  return result;
}

/**
 * Schrijft één profiel met alles eronder weg.
 *
 * Bij `remap` krijgt élke id een nieuwe waarde — profiel, bronnen, scans,
 * publicaties, seen-records en bronstatussen — en worden de verwijzingen
 * daartussen meegetrokken. Zonder dat zou een geïmporteerde kopie de scans van
 * het origineel overschrijven, want die delen dan dezelfde sleutels.
 */
async function writeEntry(entry, { remap }) {
  const profileId = remap ? newId() : entry.profile.id;

  const sourceIdMap = new Map();
  const sources = (entry.profile.sources ?? []).map((source) => {
    const id = remap ? newId() : source.id;
    sourceIdMap.set(source.id, id);
    return { ...source, id };
  });

  const profile = createProfile({
    ...entry.profile,
    id: profileId,
    name: remap ? `${entry.profile.name} (geïmporteerd)` : entry.profile.name,
    sources,
  });

  // Eerst alle scan-id's: publicaties en seen-records verwijzen naar de scan
  // van een eerdere synthese, en die kan later in de bundel staan.
  const scanIdMap = new Map(
    (entry.scans ?? []).map((bundleScan) => [bundleScan.scan.id, remap ? newId() : bundleScan.scan.id]),
  );
  // Een verwijzing naar een scan die niet in de bundel zit (al opgeruimd)
  // wordt bij een kopie leeg: anders wijst de kopie naar het origineel.
  const mapScanRef = (id) => (id && remap ? (scanIdMap.get(id) ?? null) : (id ?? null));

  const scans = [];
  const publications = [];
  const syntheses = [];

  for (const bundleScan of entry.scans ?? []) {
    const scanId = scanIdMap.get(bundleScan.scan.id);

    scans.push({
      ...bundleScan.scan,
      id: scanId,
      profileId,
      scannedSourceIds: (bundleScan.scan.scannedSourceIds ?? []).map(
        (id) => sourceIdMap.get(id) ?? id,
      ),
      sourceStatuses: (bundleScan.scan.sourceStatuses ?? []).map((status) => ({
        ...status,
        sourceId: sourceIdMap.get(status.sourceId) ?? status.sourceId,
      })),
    });

    for (const publication of bundleScan.publications ?? []) {
      publications.push(
        toPublicationRecord({
          ...publication,
          id: remap ? newId() : publication.id,
          scanId,
          previousSynthesisScanId: mapScanRef(publication.previousSynthesisScanId),
          // Booleans normaliseren: een oudere export kan hier true/false hebben
          // staan in plaats van 0/1.
          isRelevant: Boolean(publication.isRelevant),
          isBookmarked: Boolean(publication.isBookmarked),
          isRead: Boolean(publication.isRead),
          isNew: Boolean(publication.isNew),
        }),
      );
    }

    if (bundleScan.synthesis) {
      syntheses.push({ ...bundleScan.synthesis, scanId, profileId });
    }
  }

  // `seen` en `sourceState` hebben samengestelde sleutels; die moeten opnieuw
  // gebouwd worden met het nieuwe profiel-id, anders wijzen ze naar het origineel.
  const seen = (entry.seen ?? []).map((record) => ({
    ...record,
    id: `${profileId}::${record.key}`,
    profileId,
    synthesisScanId: mapScanRef(record.synthesisScanId),
    synthesisAt: record.synthesisAt ?? null,
  }));

  const sourceStates = (entry.sourceStates ?? []).map((record) => {
    const sourceId = sourceIdMap.get(record.sourceId) ?? record.sourceId;
    return { ...record, id: `${profileId}::${sourceId}`, profileId, sourceId };
  });

  await transaction(
    [Store.PROFILES, Store.SCANS, Store.PUBLICATIONS, Store.SYNTHESES, Store.SEEN, Store.SOURCE_STATE],
    'readwrite',
    (stores) => {
      stores[Store.PROFILES].put(profile);
      scans.forEach((s) => stores[Store.SCANS].put(s));
      publications.forEach((p) => stores[Store.PUBLICATIONS].put(p));
      syntheses.forEach((s) => stores[Store.SYNTHESES].put(s));
      seen.forEach((s) => stores[Store.SEEN].put(s));
      sourceStates.forEach((s) => stores[Store.SOURCE_STATE].put(s));
    },
  );
}

/** Verwijdert alle data van één profiel. Gebruikt bij `replace`. */
async function deleteProfileData(profileId) {
  const [scans, seen, sourceStates] = await Promise.all([
    getAllByIndex(Store.SCANS, 'profileId', profileId),
    getAllByIndex(Store.SEEN, 'profileId', profileId),
    getAllByIndex(Store.SOURCE_STATE, 'profileId', profileId),
  ]);

  const publicationIds = [];
  for (const scan of scans) {
    const pubs = await getAllByIndex(Store.PUBLICATIONS, 'scanId', scan.id);
    publicationIds.push(...pubs.map((p) => p.id));
  }

  await transaction(
    [Store.PROFILES, Store.SCANS, Store.PUBLICATIONS, Store.SYNTHESES, Store.SEEN, Store.SOURCE_STATE],
    'readwrite',
    (stores) => {
      stores[Store.PROFILES].delete(profileId);
      scans.forEach((s) => {
        stores[Store.SCANS].delete(s.id);
        stores[Store.SYNTHESES].delete(s.id);
      });
      publicationIds.forEach((id) => stores[Store.PUBLICATIONS].delete(id));
      seen.forEach((r) => stores[Store.SEEN].delete(r.id));
      sourceStates.forEach((r) => stores[Store.SOURCE_STATE].delete(r.id));
    },
  );
}
