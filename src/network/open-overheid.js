/**
 * Bron-type open.overheid.nl (B-57).
 *
 * open.overheid.nl heeft geen RSS en de pagina's zijn een React-app zonder
 * serverzijdige HTML. De zoekpagina haalt haar resultaten op met een GET naar
 * een openbare JSON-API. De gebruiker stelt op de site een zoekopdracht samen
 * (met "Uitgebreid zoeken") en plakt de URL uit de adresbalk als bron; deze
 * module vertaalt die URL naar een API-aanroep.
 *
 * De API is niet gedocumenteerd — alles hieronder is waargenomen gedrag
 * (2026-09-26). Zie "Referentie - open.overheid.nl zoek-API" in de vault.
 * Periode: kiest de gebruiker op de site een periode ("Afgelopen jaar", of
 * zelf datums), dan geldt die (`periodFromSiteUrl`). Anders de terugkijktijd
 * van het profiel (B-51).
 *
 * Valkuilen die hier worden afgevangen:
 *   - filterwaarden moeten dubbel URL-gecodeerd en komma-gescheiden zijn;
 *     enkel gecodeerd geeft geen fout maar 0 resultaten;
 *   - datums als DD-MM-JJJJ, een ISO-datum geeft HTTP 400;
 *   - `aantalResultaten` alleen 10, 20 of 50; `start` is een offset.
 */

import { AppConfig } from '../core/config.js';
import { createPublication } from '../core/models.js';
import { Result } from '../core/result.js';
import { log } from '../core/logger.js';
import { fetchBytes, utf8, isTransientStatus, classifyFetchError } from './http.js';
import { stripHtml } from './text.js';
import { FULLTEXT_HOST } from '../core/origins.js';

const API_BASE = 'https://open.overheid.nl/overheid/openbaarmakingen/api/v0/zoek';
const PAGE_SIZE = 50;

/** Filters die de site als herhaalde sleutel in de adresbalk zet. */
const FILTER_PARAMS = ['organisatie', 'documentsoort', 'informatiecategorie', 'thema'];

/** Datum in het formaat dat de API verwacht: DD-MM-JJJJ, in lokale tijd. */
export function formatApiDate(epochMillis) {
  const d = new Date(epochMillis);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

const doubleEncode = (value) => encodeURIComponent(encodeURIComponent(value));

/** `DD-MM-JJJJ` → epoch-millis (lokale middernacht), of null. */
export function parseApiDate(text) {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(text ?? '').trim());
  if (!match) return null;
  const date = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

/** Meeschuivende periodes zoals de site ze aanbiedt, terug vanaf `now`. */
const RELATIVE_PERIODS = {
  __proto__: null, // de sleutel komt uit de URL
  'Afgelopen week': (d) => d.setDate(d.getDate() - 7),
  'Afgelopen maand': (d) => d.setMonth(d.getMonth() - 1),
  'Afgelopen jaar': (d) => d.setFullYear(d.getFullYear() - 1),
};

/**
 * De periode die de gebruiker op de site koos, of null als er geen is.
 *
 * - "Afgelopen week/maand/jaar" schuift mee: de site zet er weliswaar een
 *   vaste `publicatiedatumVan` bij, maar een profiel van "het afgelopen jaar"
 *   bedoelt over een maand nog steeds het afgelopen jaar.
 * - "Kies zelf een periode" (of alleen datums) geldt letterlijk, inclusief
 *   een einddatum.
 *
 * @returns {{ since: number, until: number | null } | null}
 */
export function periodFromSiteUrl(siteUrl, now = Date.now()) {
  let params;
  try {
    params = new URL(siteUrl).searchParams;
  } catch {
    return null;
  }
  const relative = RELATIVE_PERIODS[params.get('beschikbaarSinds') ?? ''];
  if (relative) {
    const d = new Date(now);
    relative(d);
    return { since: d.getTime(), until: null };
  }
  const since = parseApiDate(params.get('publicatiedatumVan'));
  const until = parseApiDate(params.get('publicatiedatumTot'));
  if (since === null && until === null) return null;
  return { since: since ?? 0, until };
}

/**
 * Vertaalt een zoek-URL van de site naar een API-URL.
 *
 * Paginering, paginagrootte en sortering uit de adresbalk worden genegeerd:
 * de extensie haalt altijd de nieuwste publicaties eerst op. De periode geeft
 * de aanroeper mee (zie `periodFromSiteUrl`).
 *
 * @param {string} siteUrl URL uit de adresbalk, bijv. https://open.overheid.nl/zoeken?zoeken=stikstof&organisatie=…
 * @param {{ since?: number, until?: number | null, start?: number }} [options]
 *   since/until in epoch-millis; since 0 = geen ondergrens
 */
export function toApiUrl(siteUrl, { since = 0, until = null, start = 0 } = {}) {
  const params = new URL(siteUrl).searchParams;
  const parts = [
    `zoektekst=${encodeURIComponent(params.get('zoeken') ?? '')}`,
    `start=${start}`,
    `aantalResultaten=${PAGE_SIZE}`,
    'sort=publicatiedatum',
  ];
  if (params.get('zoekveld') === 'titel') parts.push('zoekveld=titel');
  if (since > 0) parts.push(`publicatiedatumVan=${formatApiDate(since)}`);
  if (until) parts.push(`publicatiedatumTot=${formatApiDate(until)}`);

  for (const name of FILTER_PARAMS) {
    const values = params.getAll(name).map((v) => v.trim()).filter(Boolean);
    if (values.length > 0) parts.push(`${name}=${values.map(doubleEncode).join(',')}`);
  }
  return `${API_BASE}?${parts.join('&')}`;
}

/**
 * Zet één antwoordpagina om in publicaties. `highlightedText` (het fragment
 * rond de zoekterm) heeft voorrang op `omschrijving`, die bij bijvoorbeeld
 * beslisnota's een standaardzin is.
 */
export function mapResults(json, sourceName, terms = []) {
  return (json?.resultaten ?? [])
    .map((item) => {
      const doc = item?.document ?? {};
      const text = stripHtml(item?.highlightedText || doc.omschrijving || '');
      const publisher = doc.publisher && doc.publisher !== 'Onbekend' ? doc.publisher : '';
      const description = [publisher, text].filter(Boolean).join(' — ');
      const publication = createPublication({
        title: (doc.titel ?? '').trim(),
        description:
          description.length > AppConfig.RSS_DESCRIPTION_MAX_CHARS
            ? `${description.slice(0, AppConfig.RSS_DESCRIPTION_MAX_CHARS)}...`
            : description,
        url: doc.pid || doc.weblocatie || '',
        publishedDate: doc.openbaarmakingsdatum ? Date.parse(doc.openbaarmakingsdatum) || 0 : 0,
        sourceName,
      });
      // Geen fragment, wel de volledige tekst bij officielebekendmakingen.nl:
      // de scan kan die er later bij halen (B-60).
      // Bijlagen bestaan alleen als PDF (B-63); die lezen we als de grootte
      // het toelaat.
      if (!item?.highlightedText) {
        const url = fullTextUrlFor(doc.weblocatie) ?? pdfUrlFor(doc.weblocatie, item);
        if (url) {
          publication.fullTextUrl = url;
          publication.fullTextTerms = terms;
        }
      }
      return publication;
    })
    .filter((pub) => pub.title && pub.url);
}

/**
 * De weblocatie als https-URL op officielebekendmakingen.nl, of null.
 * Bijlagen (`blg-…`) slaan we over: die pagina is een stub ("niet beschikbaar
 * als Webversie"), de inhoud staat alleen in een PDF. Kamerstukken (`kst-`) en
 * Aanhangsels (`ah-`, Kamervragen met antwoord) hebben de hele tekst.
 */
function fullTextUrlFor(weblocatie) {
  try {
    const url = new URL(weblocatie);
    if (url.hostname !== FULLTEXT_HOST || url.pathname.startsWith('/blg-')) return null;
    url.protocol = 'https:';
    return url.href;
  } catch {
    return null;
  }
}

/**
 * De PDF-URL van een bijlage (`blg-…`), of null. Alleen als de zoek-API zegt
 * dat het een PDF is en de grootte en het aantal pagina's binnen de grens
 * blijven: de server doet geen Range-verzoeken, dus het bestand komt helemaal
 * binnen. Zonder bekende grootte (`bestandsgrootte`) laten we het liggen.
 */
function pdfUrlFor(weblocatie, item) {
  if (item?.bestandsType !== 'application/pdf') return null;
  const megabytes = Number.parseFloat(String(item.bestandsgrootte ?? '').replace(',', '.'));
  if (!(megabytes > 0) || megabytes > AppConfig.FULLTEXT_PDF_MAX_MB) return null;
  if (Number(item.aantalPaginas) > AppConfig.FULLTEXT_PDF_MAX_PAGES) return null;
  try {
    const url = new URL(weblocatie);
    if (url.hostname !== FULLTEXT_HOST || !/^\/blg-\d+\.html$/.test(url.pathname)) return null;
    url.protocol = 'https:';
    url.pathname = url.pathname.replace(/\.html$/, '.pdf');
    return url.href;
  } catch {
    return null;
  }
}

/** Wijst een `fullTextUrl` naar een PDF (bijlage) in plaats van een webpagina? */
export function isPdfUrl(url) {
  try {
    return new URL(url).pathname.endsWith('.pdf');
  } catch {
    return false;
  }
}

/**
 * Zoektermen uit de zoek-URL: losse woorden van ten minste 3 tekens, zonder
 * AND/OR/NOT, aanhalingstekens of jokertekens. Geëxporteerd voor de tests.
 */
export function searchTerms(siteUrl) {
  let query = '';
  try {
    query = new URL(siteUrl).searchParams.get('zoeken') ?? '';
  } catch {
    return [];
  }
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}-]+/u)
    .map((w) => w.replace(/^-+|-+$/g, ''))
    .filter((w) => w.length >= 3 && !['and', 'or', 'not'].includes(w));
  return [...new Set(words)];
}

/**
 * De documenttekst uit een pagina van officielebekendmakingen.nl: alles in
 * `<div id="broodtekst">` tot het einde van het artikel, zonder menu's en
 * zijbalk. Leeg als de pagina die opbouw niet heeft. Geëxporteerd voor de tests.
 */
export function extractBodyText(html) {
  const start = html.indexOf('id="broodtekst"');
  if (start === -1) return '';
  const open = html.indexOf('>', start);
  const end = html.indexOf('</article>', open);
  return stripHtml(html.slice(open + 1, end === -1 ? undefined : end));
}

/**
 * Fragmenten rond de eerste treffers van de zoektermen, samen hooguit
 * `maxChars` tekens, gescheiden door " … ". Leeg zonder treffer: liever de
 * oude beschrijving houden dan een willekeurig stuk tekst geven.
 * Geëxporteerd voor de tests.
 */
export function snippetAround(text, terms, side = AppConfig.FULLTEXT_SNIPPET_CHARS, maxChars = AppConfig.FULLTEXT_MAX_CHARS) {
  if (!text || terms.length === 0) return '';
  const lower = text.toLowerCase();
  const hits = [];
  for (const term of terms) {
    for (let at = lower.indexOf(term); at !== -1; at = lower.indexOf(term, at + term.length)) hits.push(at);
  }
  hits.sort((a, b) => a - b);

  const parts = [];
  let used = 0;
  let coveredUntil = -1;
  for (const at of hits) {
    if (at < coveredUntil) continue;
    // Op woordgrenzen knippen, zodat het fragment leesbaar begint en eindigt.
    let from = Math.max(0, at - side);
    let to = Math.min(text.length, at + side);
    if (from > 0) from = text.indexOf(' ', from) + 1 || from;
    if (to < text.length) to = text.lastIndexOf(' ', to) > at ? text.lastIndexOf(' ', to) : to;
    const part = text.slice(from, to).trim();
    if (used + part.length > maxChars) break;
    parts.push(`${from > 0 ? '…' : ''}${part}${to < text.length ? '…' : ''}`);
    used += part.length;
    coveredUntil = to;
  }
  return parts.join(' ');
}

/**
 * Haalt voor publicaties met een `fullTextUrl` de tekst op en zet een fragment
 * rond de zoekterm achter de beschrijving. Een pagina die niet lukt of geen
 * treffer heeft, laat de publicatie zoals ze was. Nooit een fout naar boven:
 * dit is een verbetering, geen voorwaarde voor de scan.
 *
 * Webpagina's (Kamerstukken) en PDF-bijlagen lopen in twee wachtrijen met een
 * eigen aantal tegelijk. PDF's alleen als de aanroeper een `extractPdfText`
 * meegeeft (de achtergrondscan; `pdf-text.js`).
 *
 * @param {import('../core/models.js').Publication[]} publications
 * @param {(done: number) => void} [onProgress]
 * @param {{ extractPdfText?: (data: Uint8Array, terms: string[]) => Promise<string> }} [options]
 * @returns {Promise<{attempted: number, enriched: number, pdfAttempted: number, pdfEnriched: number}>}
 */
export async function enrichWithFullText(publications, onProgress, { extractPdfText } = {}) {
  const pending = publications.filter((p) => p.fullTextUrl).slice(0, AppConfig.FULLTEXT_MAX_PER_SCAN);
  const pageQueue = pending.filter((p) => !isPdfUrl(p.fullTextUrl));
  const pdfQueue = extractPdfText
    ? pending.filter((p) => isPdfUrl(p.fullTextUrl)).slice(0, AppConfig.FULLTEXT_PDF_MAX_PER_SCAN)
    : [];
  const attempted = pageQueue.length;
  const pdfAttempted = pdfQueue.length;
  let done = 0;
  let enriched = 0;
  let pdfEnriched = 0;

  const addSnippet = (pub, text) => {
    const snippet = snippetAround(text, pub.fullTextTerms ?? []);
    if (!snippet) return false;
    pub.description = [pub.description, snippet].filter(Boolean).join(' — ');
    return true;
  };

  // `no-store`: het document is alleen nodig voor het fragment en mag niet in
  // de HTTP-cache van de browser blijven staan. De server zegt dat zelf ook
  // (`cache-control: no-store`), maar daar leunen we niet op. De tekst zelf
  // wordt nergens bewaard; alleen het fragment.
  const fetchPage = async (pub) => {
    const { response, bytes } = await fetchBytes(
      pub.fullTextUrl,
      { headers: { Accept: 'text/html' }, cache: 'no-store' },
      { timeoutMs: AppConfig.FEED_TIMEOUT_MS },
    );
    return response.ok && addSnippet(pub, extractBodyText(utf8(bytes)));
  };

  const fetchPdf = async (pub) => {
    // De zoek-API gaf een grootte vooraf; de server weet het zelf beter, en
    // `fetchBytes` breekt af boven de grens.
    const { response, bytes } = await fetchBytes(
      pub.fullTextUrl,
      { headers: { Accept: 'application/pdf' }, cache: 'no-store' },
      { timeoutMs: AppConfig.FULLTEXT_PDF_TIMEOUT_MS, maxBytes: AppConfig.FULLTEXT_PDF_MAX_MB * 1024 * 1024 },
    );
    if (!response.ok) return false;
    return addSnippet(pub, await extractPdfText(bytes, pub.fullTextTerms ?? []));
  };

  const worker = (queue, fetchOne, onEnriched) => async () => {
    for (let pub = queue.shift(); pub; pub = queue.shift()) {
      try {
        if (await fetchOne(pub)) onEnriched();
      } catch (err) {
        log.debug(`Volledige tekst niet opgehaald voor ${pub.fullTextUrl}: ${err.message}`);
      }
      done += 1;
      onProgress?.(done);
    }
  };

  const pageWorker = worker(pageQueue, fetchPage, () => (enriched += 1));
  const pdfWorker = worker(pdfQueue, fetchPdf, () => (pdfEnriched += 1));
  await Promise.all([
    ...Array.from({ length: AppConfig.FULLTEXT_CONCURRENCY }, pageWorker),
    ...Array.from({ length: AppConfig.FULLTEXT_PDF_CONCURRENCY }, pdfWorker),
  ]);
  log.info(
    `Volledige tekst: ${enriched} van ${attempted} pagina('s) en ${pdfEnriched} van ${pdfAttempted} PDF-bijlage(n) zonder fragment aangevuld`,
  );
  return { attempted, enriched, pdfAttempted, pdfEnriched };
}

/**
 * Haalt de publicaties van een open.overheid-bron op, nieuwste eerst, en
 * bladert door tot het venster uitgeput is of het plafond bereikt.
 *
 * Zonder venster (`since` = 0, zoals bij "Testen") blijft het bij één pagina;
 * `total` geeft dan het totaal aantal treffers.
 *
 * @returns {Promise<import('../core/result.js').NetworkResult>}
 */
export async function fetchOpenOverheid(source, since) {
  const label = source.name || source.url;
  const publications = [];
  const max = since > 0 ? AppConfig.OPEN_OVERHEID_MAX_RESULTS : PAGE_SIZE;

  // Een periode uit de URL gaat voor de terugkijktijd van het profiel, behalve bij "Testen"
  // (since 0), dat alleen één pagina en het totaal wil zien.
  const period = since > 0 ? periodFromSiteUrl(source.url) : null;
  const range = period ? { since: period.since, until: period.until } : { since, until: null };
  const terms = searchTerms(source.url);

  try {
    for (let start = 0; start < max; start += PAGE_SIZE) {
      const { response, bytes } = await fetchBytes(
        toApiUrl(source.url, { ...range, start }),
        { headers: { Accept: 'application/json' } },
        { timeoutMs: AppConfig.FEED_TIMEOUT_MS },
      );
      if (!response.ok) {
        const message = `HTTP ${response.status} voor ${label}`;
        return isTransientStatus(response.status) ? Result.networkError(message) : Result.error(message);
      }

      const json = JSON.parse(utf8(bytes));
      const page = mapResults(json, source.name, terms);
      publications.push(...page);

      // Aantal op deze pagina vóór het filter op titel en URL: één resultaat
      // zonder titel mag het bladeren niet stoppen (CR-06).
      const onPage = json?.resultaten?.length ?? 0;
      const total = Number(json?.totaal ?? 0);
      if (onPage < PAGE_SIZE || start + PAGE_SIZE >= total) break;
    }

    if (publications.length >= max && since > 0) {
      log.warn(`'${label}': plafond van ${max} publicaties bereikt; oudere treffers overgeslagen`);
    }
    log.debug(`open.overheid '${label}': ${publications.length} publicaties`);
    return Result.success(publications);
  } catch (err) {
    return classifyFetchError(err, label);
  }
}
