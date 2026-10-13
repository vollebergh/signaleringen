/**
 * Orkestreert één scan: bronnen ophalen → nieuw bepalen → relevantie filteren
 * → synthetiseren → opslaan. Op verzoek van de gebruiker, of via de planner
 * als automatisch synthetiseren aan staat.
 *
 * De extensie houdt per profiel bij welke publicaties eerder langskwamen en
 * welke daarvan al in een signalering zijn verwerkt. Dat bepaalt wat er als
 * "nieuw" telt en — als het profiel dat wil — wat er aan het model wordt
 * voorgelegd.
 */

import { AppConfig } from '../core/config.js';
import { Result } from '../core/result.js';
import { log } from '../core/logger.js';
import { fetchPublications } from '../network/feed-fetcher.js';
import {
  filterPublications,
  isPrefilterActive,
  prefilterPublications,
  selectForSynthesis,
  synthesizeProfile,
} from '../network/llm-client.js';
import { getSettings, isConfigured, missingConfigMessage, withApiKey } from '../data/settings-repository.js';
import { getProfile } from '../data/profile-repository.js';
import { normalizeLookbackDays, normalizeSynthesisMaxArticles } from '../core/models.js';
import { saveScan, saveSynthesis, pruneOldScans } from '../data/scan-repository.js';
import { markUnread } from '../data/unread-repository.js';
import {
  loadSeen,
  recordSeen,
  markSynthesised,
  recordSourceFetch,
} from '../data/history-repository.js';
import { withKeepalive } from './keepalive.js';
import { addFetched } from './scan-collect.js';
import { hasPermissionFor, missingOrigins } from './permissions.js';
import { FULLTEXT_ORIGIN, enrichWithFullText } from '../network/open-overheid.js';
import { extractPdfText } from '../network/pdf-text.js';

import { setProgress, getProgress, recoverInterruptedScans } from './scan-progress.js';

/**
 * Scans die in déze worker lopen, per profiel-id. Voorkomt dubbel werk. Staat
 * bewust in geheugen: sterft de worker, dan loopt de scan ook niet meer.
 */
const running = new Map();

export { getProgress };

export function isScanning(profileId) {
  return running.has(profileId);
}

/**
 * Scans die wachten op "doorgaan?" (B-45), per profiel-id: de functie die het
 * antwoord doorgeeft. Net als `running` in geheugen; sterft de worker, dan
 * meldt B-46 de scan als afgebroken.
 */
const awaitingConfirmation = new Map();

/** Antwoord van de gebruiker op de vraag of een grote scan door mag. */
export function confirmScan(profileId, proceed) {
  const answer = awaitingConfirmation.get(profileId);
  if (!answer) return false;
  answer(Boolean(proceed));
  return true;
}

/**
 * Pauzeert de scan tot de gebruiker kiest. De vraag gaat via de voortgang naar
 * elk open UI-vlak; wie als eerste antwoordt, beslist. Geen antwoord binnen de
 * time-out telt als annuleren.
 */
function askToProceed(profileId, count) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(false), AppConfig.SCAN_CONFIRM_TIMEOUT_MS);
    function finish(proceed) {
      clearTimeout(timer);
      awaitingConfirmation.delete(profileId);
      resolve(proceed);
    }
    awaitingConfirmation.set(profileId, finish);
    setProgress(profileId, { phase: 'confirm', count, threshold: AppConfig.SCAN_CONFIRM_THRESHOLD });
  });
}

/** Fout voor een scan die de gebruiker niet door liet gaan. */
function cancelledError(profileId, count) {
  const message = `Scan gestopt: ${count} publicaties niet beoordeeld. Ze komen bij een volgende scan opnieuw langs.`;
  setProgress(profileId, { phase: 'cancelled', message });
  const err = new Error(message);
  err.cancelled = true;
  return err;
}

// Bij het laden van de worker: een scan die volgens de sessieopslag nog liep,
// is met de vorige worker meegestorven (B-46).
recoverInterruptedScans(isScanning).catch((err) => log.warn('Afgebroken scans nalopen mislukt', err));

/**
 * Start een scan of geeft de lopende terug.
 * @param {string} profileId
 * @param {{ sourceIds?: string[], automatic?: boolean }} [options]
 *   `sourceIds` beperkt de scan tot deze bronnen; `automatic` (de planner)
 *   zet een nieuwe signalering op ongelezen (B-54) en vraagt bij een grote
 *   scan niet om bevestiging (B-45)
 * @returns {Promise<{scanId: string, relevantCount: number, newCount: number}>}
 */
export function runScan(profileId, options = {}) {
  const existing = running.get(profileId);
  if (existing) {
    log.debug(`Scan voor ${profileId} loopt al, hergebruik de lopende run`);
    return existing;
  }

  setProgress(profileId, { phase: 'starting' });
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
    // Terugkijktijd per profiel (B-51).
    const lookbackDays = normalizeLookbackDays(profile.lookbackDays);
    const since = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
    const seen = await loadSeen(profileId);

    const fetched = []; // { publication, key, isNew, seenRecord }
    const keysInScan = new Set(); // ontdubbelen over bronnen heen (CR-02)
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
        const { newCount, duplicates } = addFetched(fetched, result.data, seen, keysInScan);
        if (duplicates > 0) {
          log.debug(`Bron '${source.name}': ${duplicates} publicatie(s) stonden al in deze scan`);
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
        lookbackDays,
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

    // ── 1a. Grote scan? Eerst vragen (B-45) ───────────────────────────────
    // Na het ophalen, want pas dan is het aantal bekend, en vóór alles wat
    // tokens kost. Annuleren legt niets vast als gezien, dus er gaat niets
    // verloren.
    if (!options.automatic && toEvaluate.length > AppConfig.SCAN_CONFIRM_THRESHOLD) {
      const proceed = await askToProceed(profileId, toEvaluate.length);
      if (!proceed) throw cancelledError(profileId, toEvaluate.length);
    }

    // ── 1b. Volledige tekst bij publicaties zonder fragment (B-60) ────────
    // Alleen voor wat beoordeeld wordt. Zonder toestemming voor de host gaat
    // de scan gewoon door; het scanresultaat biedt dan een knop aan.
    let fullText = null;
    const withoutFragment = toEvaluate.map((item) => item.publication).filter((pub) => pub.fullTextUrl);
    if (withoutFragment.length > 0) {
      if (await hasPermissionFor(FULLTEXT_ORIGIN)) {
        const total = Math.min(withoutFragment.length, AppConfig.FULLTEXT_MAX_PER_SCAN);
        setProgress(profileId, { phase: 'fulltext', done: 0, total });
        const outcome = await enrichWithFullText(
          withoutFragment,
          (done) => setProgress(profileId, { phase: 'fulltext', done, total }),
          { extractPdfText },
        );
        fullText = { status: 'used', ...outcome };
      } else {
        fullText = { status: 'no-permission', count: withoutFragment.length };
      }
    }

    // ── 2a. Voorfilter (optioneel, B-58) ──────────────────────────────────
    // Jev zeeft vóór DeepSeek. Wat eronder valt, telt als beoordeeld en
    // weggefilterd. Lukt de voorfilter niet, dan gaat alles naar het model.
    let toJudge = toEvaluate;
    let prefiltered = [];
    let prefilter = null;
    if (isPrefilterActive(settings)) {
      setProgress(profileId, { phase: 'prefiltering', total: toEvaluate.length });
      const started = Date.now();
      const scores = await prefilterPublications(
        toEvaluate.map((item) => item.publication),
        profile.userQuery,
        settings,
      );
      if (scores) {
        toJudge = toEvaluate.filter((_, index) => scores[index].passes);
        prefiltered = toEvaluate
          .map((item, index) => ({ item, score: scores[index].score }))
          .filter((_, index) => !scores[index].passes);
        prefilter = { status: 'used', durationMs: Date.now() - started };
        log.info(`Voorfilter: ${prefiltered.length} van ${toEvaluate.length} weggefilterd`);
      } else {
        prefilter = { status: 'fallback' };
      }
    }

    // ── 2b. Relevantie beoordelen ─────────────────────────────────────────
    setProgress(profileId, { phase: 'analyzing', done: 0, total: toJudge.length });

    const verdicts = await filterPublications(
      toJudge.map((item) => item.publication),
      profile.userQuery,
      settings,
      (done, total) => setProgress(profileId, { phase: 'analyzing', done, total }),
    );

    // Vastleggen wat het model beoordeeld heeft, ook wat het wegfiltert —
    // anders komt hetzelfde artikel elke scan terug als nieuw. Bewust ná het
    // filter en alleen met oordeel: mislukt het filter of geeft het voor een
    // batch geen leesbaar antwoord, dan biedt de volgende scan die
    // publicaties opnieuw aan in plaats van ze stil kwijt te raken. Wat de
    // voorfilter wegfiltert, is wél beoordeeld.
    const judged = verdicts
      .map((verdict, index) => ({ verdict, item: toJudge[index] }))
      .filter(({ verdict }) => verdict.isJudged)
      .concat(
        prefiltered.map(({ item, score }) => ({
          item,
          verdict: {
            publication: item.publication,
            shortDescription: item.publication.title,
            score: null,
            relevance: 'niet',
            isRelevant: false,
            prefilterScore: score,
          },
        })),
      );
    const unjudgedCount = verdicts.filter((verdict) => !verdict.isJudged).length;
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
        // Gezet als de voorfilter (Jev) deze publicatie wegfilterde; 0–100.
        prefilterScore: verdict.prefilterScore ?? null,
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
      prefilteredCount: prefiltered.length,
      prefilter,
      fullText,
      sourceStatuses,
      scannedSourceIds: sources.map((s) => s.id),
      onlyNewPublications: profile.onlyNewPublications,
      lookbackDays,
    };
    await saveScan(scan, results);

    // ── 3. Synthese ───────────────────────────────────────────────────────
    // Bewust ná het opslaan van de scan: mislukt de synthese, dan blijven de
    // beoordeelde publicaties gewoon staan.
    if (relevant.length > 0) {
      // Alleen de hoogst scorende gaan mee (B-45); de rest blijft relevant
      // in het scanresultaat staan, maar telt niet als verwerkt.
      const forSynthesis = selectForSynthesis(
        relevant,
        normalizeSynthesisMaxArticles(settings.synthesisMaxArticles),
      );
      setProgress(profileId, { phase: 'synthesizing', count: forSynthesis.length });
      try {
        const synthesis = await synthesizeProfile(profile, forSynthesis, settings);
        const createdAt = Date.now();
        await saveSynthesis({
          scanId,
          profileId,
          createdAt,
          text: synthesis.text,
          sources: synthesis.sources,
          warnings: synthesis.warnings,
          selection: { used: forSynthesis.length, relevant: relevant.length },
        });
        if (options.automatic && synthesis.text) {
          await markUnread(profileId, scanId, createdAt);
        }
        if (synthesis.warnings.length > 0) {
          log.warn(`Synthese voor '${profile.name}' met waarschuwingen`, synthesis.warnings);
        }
        await markSynthesised(
          profileId,
          scanId,
          forSynthesis.map((r) => r.dedupeKey),
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
    if (err.cancelled) {
      log.info(`Scan '${profile.name}' gestopt door de gebruiker`);
      throw err;
    }
    log.error(`Scan mislukt voor '${profile.name}'`, err);
    setProgress(profileId, { phase: 'error', message: err.message ?? String(err) });
    throw err;
  }
}
