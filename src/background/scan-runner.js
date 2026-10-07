/**
 * Orkestreert één scan: bronnen ophalen → nieuw bepalen → relevantie filteren
 * → synthetiseren → opslaan. Draait uitsluitend op verzoek van de gebruiker;
 * er is geen achtergrondplanning.
 *
 * De extensie houdt per profiel bij welke publicaties eerder langskwamen en
 * welke daarvan al in een signalering zijn verwerkt. Dat bepaalt wat er als
 * "nieuw" telt en — als het profiel dat wil — wat er aan het model wordt
 * voorgelegd.
 */

import { AppConfig } from '../core/config.js';
import { Result } from '../core/result.js';
import { Msg } from '../core/messages.js';
import { log } from '../core/logger.js';
import { fetchPublications } from '../network/feed-fetcher.js';
import { filterPublications, synthesizeProfile } from '../network/llm-client.js';
import { getSettings, isConfigured, missingConfigMessage, withApiKey } from '../data/settings-repository.js';
import { getProfile } from '../data/profile-repository.js';
import { saveScan, saveSynthesis, pruneOldScans } from '../data/scan-repository.js';
import {
  dedupeKey,
  loadSeen,
  recordSeen,
  markSynthesised,
  recordSourceFetch,
} from '../data/history-repository.js';
import { withKeepalive } from './keepalive.js';
import { missingOrigins } from './permissions.js';

/** Scans die op dit moment lopen, per profiel-id. Voorkomt dubbel werk. */
const running = new Map();

/** Laatst bekende voortgang per profiel, zodat een heropende popup bijraakt. */
const progress = new Map();

export function getProgress(profileId) {
  return progress.get(profileId) ?? { phase: 'idle' };
}

export function isScanning(profileId) {
  return running.has(profileId);
}

function setProgress(profileId, state) {
  progress.set(profileId, state);
  // Broadcast naar open UI-vlakken. Faalt stil als er niets luistert.
  chrome.runtime
    .sendMessage({ type: Msg.SCAN_PROGRESS, payload: { profileId, ...state } })
    .catch(() => {});
}

/**
 * Start een scan of geeft de lopende terug.
 * @param {string} profileId
 * @param {{ sourceIds?: string[] }} [options] beperk de scan tot deze bronnen
 * @returns {Promise<{scanId: string, relevantCount: number, newCount: number}>}
 */
export function runScan(profileId, options = {}) {
  const existing = running.get(profileId);
  if (existing) {
    log.debug(`Scan voor ${profileId} loopt al, hergebruik de lopende run`);
    return existing;
  }

  const run = withKeepalive(() => executeScan(profileId, options)).finally(() => {
    running.delete(profileId);
  });
  running.set(profileId, run);
  return run;
}

async function executeScan(profileId, options) {
  const profile = await getProfile(profileId);
  if (!profile) throw new Error('Profiel niet gevonden');

  const stored = await getSettings();
  if (!(await isConfigured(stored))) {
    const message = missingConfigMessage(stored);
    setProgress(profileId, { phase: 'error', message });
    throw new Error(message);
  }

  // Key uit de vault halen vóór er iets opgehaald wordt: een vergrendelde
  // vault moet de scan tegenhouden, niet pas halverwege laten stranden.
  let settings;
  try {
    settings = await withApiKey(stored);
  } catch (err) {
    setProgress(profileId, { phase: 'error', message: err.message });
    throw err;
  }

  // Een scan kan tot een deelverzameling bronnen beperkt worden, zodat je één
  // bron los kunt bijwerken zonder de rest opnieuw op te halen.
  const sources = options.sourceIds?.length
    ? profile.sources.filter((s) => options.sourceIds.includes(s.id))
    : profile.sources;

  if (sources.length === 0) {
    const message = profile.sources.length === 0
      ? 'Dit profiel heeft nog geen bronnen'
      : 'Geen van de gekozen bronnen bestaat nog';
    setProgress(profileId, { phase: 'error', message });
    throw new Error(message);
  }

  const blocked = await missingOrigins(sources.map((s) => s.url));
  if (blocked.length > 0) {
    const message = `Geen toestemming voor ${blocked.length} host(s). Open het dashboard en geef toegang.`;
    setProgress(profileId, { phase: 'error', message, blockedOrigins: blocked });
    throw new Error(message);
  }

  const scanId = crypto.randomUUID();

  try {
    // ── 1. Bronnen ophalen ────────────────────────────────────────────────
    const since = Date.now() - AppConfig.PUBLICATION_AGE_MILLIS;
    const seen = await loadSeen(profileId);

    const fetched = []; // { publication, key, isNew, seenRecord }
    const sourceStatuses = [];

    for (const [index, source] of sources.entries()) {
      setProgress(profileId, {
        phase: 'fetching',
        current: index + 1,
        total: sources.length,
        sourceName: source.name || source.url,
      });

      const result = await fetchPublications(source, since);

      if (Result.isSuccess(result)) {
        let newCount = 0;
        for (const publication of result.data) {
          const key = dedupeKey(publication);
          const seenRecord = seen.get(key) ?? null;
          if (!seenRecord) newCount += 1;
          fetched.push({ publication, key, isNew: !seenRecord, seenRecord });
        }

        sourceStatuses.push({
          sourceId: source.id,
          name: source.name,
          url: source.url,
          success: true,
          publicationCount: result.data.length,
          newCount,
        });

        await recordSourceFetch({
          profileId,
          source,
          success: true,
          fetchedCount: result.data.length,
          newCount,
          scanId,
        });
      } else {
        const message = Result.message(result);
        sourceStatuses.push({
          sourceId: source.id,
          name: source.name,
          url: source.url,
          success: false,
          errorMessage: message,
        });
        await recordSourceFetch({ profileId, source, success: false, errorMessage: message });
        log.warn(`Bron '${source.name}' mislukt: ${message}`);
      }
    }

    const scanDate = Date.now();
    const newItems = fetched.filter((item) => item.isNew);

    // Wat gaat er naar het model? Standaard alleen wat dit profiel nog niet zag.
    const toEvaluate = profile.onlyNewPublications ? newItems : fetched;

    if (toEvaluate.length === 0) {
      const scan = {
        id: scanId,
        profileId,
        scanDate,
        totalFetched: fetched.length,
        newCount: 0,
        relevantCount: 0,
        filteredCount: 0,
        sourceStatuses,
        scannedSourceIds: sources.map((s) => s.id),
        onlyNewPublications: profile.onlyNewPublications,
      };
      await saveScan(scan, []);
      await pruneOldScans(profileId);
      setProgress(profileId, {
        phase: 'done',
        scanId,
        relevantCount: 0,
        newCount: 0,
        totalFetched: fetched.length,
      });
      return { scanId, relevantCount: 0, newCount: 0, totalFetched: fetched.length };
    }

    // ── 2. Relevantie beoordelen ──────────────────────────────────────────
    setProgress(profileId, { phase: 'analyzing', done: 0, total: toEvaluate.length });

    const verdicts = await filterPublications(
      toEvaluate.map((item) => item.publication),
      profile.userQuery,
      settings,
      (done, total) => setProgress(profileId, { phase: 'analyzing', done, total }),
    );

    // Vastleggen wat het model beoordeeld heeft, ook wat het wegfiltert —
    // anders komt hetzelfde artikel elke scan terug als nieuw. Bewust ná het
    // filter en alleen met oordeel: mislukt het filter of geeft het voor een
    // batch geen leesbaar antwoord, dan biedt de volgende scan die
    // publicaties opnieuw aan in plaats van ze stil kwijt te raken.
    const judged = verdicts
      .map((verdict, index) => ({ verdict, item: toEvaluate[index] }))
      .filter(({ verdict }) => verdict.isJudged);
    const unjudgedCount = verdicts.length - judged.length;
    if (unjudgedCount > 0) {
      log.warn(`${unjudgedCount} publicatie(s) zonder oordeel; de volgende scan biedt ze opnieuw aan`);
    }

    await recordSeen(
      profileId,
      scanId,
      judged
        .filter(({ item }) => item.isNew)
        .map(({ item }) => ({
          key: item.key,
          url: item.publication.url,
          title: item.publication.title,
          sourceName: item.publication.sourceName,
        })),
    );

    const results = judged.map(({ verdict, item }) => {
      return {
        id: crypto.randomUUID(),
        scanId,
        dedupeKey: item.key,
        publication: verdict.publication,
        shortDescription: verdict.shortDescription,
        isRelevant: verdict.isRelevant,
        score: verdict.score,
        relevance: verdict.relevance,
        isNew: item.isNew,
        // Zat deze publicatie al eerder in een signalering? Dan verwijst dit
        // naar die scan, zodat de UI dat kan tonen.
        previousSynthesisScanId: item.seenRecord?.synthesisScanId ?? null,
        previousSynthesisAt: item.seenRecord?.synthesisAt ?? null,
        isBookmarked: false,
        isRead: false,
      };
    });

    const relevant = results.filter((r) => r.isRelevant);
    const possible = results.filter((r) => r.relevance === 'mogelijk');
    const filtered = results.filter((r) => !r.isRelevant && r.relevance !== 'mogelijk');

    const scan = {
      id: scanId,
      profileId,
      scanDate,
      totalFetched: fetched.length,
      newCount: newItems.length,
      evaluatedCount: toEvaluate.length,
      unjudgedCount,
      relevantCount: relevant.length,
      possibleCount: possible.length,
      filteredCount: filtered.length,
      sourceStatuses,
      scannedSourceIds: sources.map((s) => s.id),
      onlyNewPublications: profile.onlyNewPublications,
    };
    await saveScan(scan, results);

    // ── 3. Synthese ───────────────────────────────────────────────────────
    // Bewust ná het opslaan van de scan: mislukt de synthese, dan blijven de
    // beoordeelde publicaties gewoon staan.
    if (relevant.length > 0) {
      setProgress(profileId, { phase: 'synthesizing', count: relevant.length });
      try {
        const synthesis = await synthesizeProfile(profile, relevant, settings);
        await saveSynthesis({
          scanId,
          profileId,
          createdAt: Date.now(),
          text: synthesis.text,
          sources: synthesis.sources,
          warnings: synthesis.warnings,
        });
        if (synthesis.warnings.length > 0) {
          log.warn(`Synthese voor '${profile.name}' met waarschuwingen`, synthesis.warnings);
        }
        await markSynthesised(
          profileId,
          scanId,
          relevant.map((r) => r.dedupeKey),
        );
      } catch (err) {
        log.error('Synthese mislukt, scanresultaten blijven bewaard', err);
        await saveSynthesis({
          scanId,
          profileId,
          createdAt: Date.now(),
          text: '',
          sources: [],
          error: err.message ?? String(err),
        });
      }
    }

    await pruneOldScans(profileId);

    log.info(
      `Scan '${profile.name}': ${fetched.length} opgehaald, ${newItems.length} nieuw, ${relevant.length} relevant`,
    );
    setProgress(profileId, {
      phase: 'done',
      scanId,
      relevantCount: relevant.length,
      newCount: newItems.length,
      totalFetched: fetched.length,
    });
    return {
      scanId,
      relevantCount: relevant.length,
      newCount: newItems.length,
      totalFetched: fetched.length,
    };
  } catch (err) {
    log.error(`Scan mislukt voor '${profile.name}'`, err);
    setProgress(profileId, { phase: 'error', message: err.message ?? String(err) });
    throw err;
  }
}
