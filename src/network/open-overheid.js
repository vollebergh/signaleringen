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
import { fetchWithTimeout, isTransientStatus, classifyFetchError } from './http.js';
import { stripHtml } from './feed-fetcher.js';

const SITE_HOST = 'open.overheid.nl';
const API_BASE = 'https://open.overheid.nl/overheid/openbaarmakingen/api/v0/zoek';
const PAGE_SIZE = 50;

/** Filters die de site als herhaalde sleutel in de adresbalk zet. */
const FILTER_PARAMS = ['organisatie', 'documentsoort', 'informatiecategorie', 'thema'];

/** Is dit een zoek-URL van open.overheid.nl, zoals een gebruiker die kopieert? */
export function isOpenOverheidSearchUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === SITE_HOST && parsed.pathname.replace(/\/+$/, '') === '/zoeken';
  } catch {
    return false;
  }
}

/** Datum in het formaat dat de API verwacht: DD-MM-JJJJ, in lokale tijd. */
export function formatApiDate(epochMillis) {
  const d = new Date(epochMillis);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

const doubleEncode = (value) => encodeURIComponent(encodeURIComponent(value));

/**
 * Vertaalt een zoek-URL van de site naar een API-URL.
 *
 * Paginering, paginagrootte, sortering en periode uit de adresbalk worden
 * bewust genegeerd: de extensie haalt altijd de nieuwste publicaties op
 * vanaf haar eigen venster.
 *
 * @param {string} siteUrl URL uit de adresbalk, bijv. https://open.overheid.nl/zoeken?zoeken=stikstof&organisatie=…
 * @param {{ since?: number, start?: number }} [options] since in epoch-millis; 0 = geen datumfilter
 */
export function toApiUrl(siteUrl, { since = 0, start = 0 } = {}) {
  const params = new URL(siteUrl).searchParams;
  const parts = [
    `zoektekst=${encodeURIComponent(params.get('zoeken') ?? '')}`,
    `start=${start}`,
    `aantalResultaten=${PAGE_SIZE}`,
    'sort=publicatiedatum',
  ];
  if (params.get('zoekveld') === 'titel') parts.push('zoekveld=titel');
  if (since > 0) parts.push(`publicatiedatumVan=${formatApiDate(since)}`);

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
export function mapResults(json, sourceName) {
  return (json?.resultaten ?? [])
    .map((item) => {
      const doc = item?.document ?? {};
      const text = stripHtml(item?.highlightedText || doc.omschrijving || '');
      const publisher = doc.publisher && doc.publisher !== 'Onbekend' ? doc.publisher : '';
      const description = [publisher, text].filter(Boolean).join(' — ');
      return createPublication({
        title: (doc.titel ?? '').trim(),
        description:
          description.length > AppConfig.RSS_DESCRIPTION_MAX_CHARS
            ? `${description.slice(0, AppConfig.RSS_DESCRIPTION_MAX_CHARS)}...`
            : description,
        url: doc.pid || doc.weblocatie || '',
        publishedDate: doc.openbaarmakingsdatum ? Date.parse(doc.openbaarmakingsdatum) || 0 : 0,
        sourceName,
      });
    })
    .filter((pub) => pub.title && pub.url);
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

  try {
    for (let start = 0; start < max; start += PAGE_SIZE) {
      const response = await fetchWithTimeout(
        toApiUrl(source.url, { since, start }),
        { headers: { Accept: 'application/json' } },
        AppConfig.FEED_TIMEOUT_MS,
      );
      if (!response.ok) {
        const message = `HTTP ${response.status} voor ${label}`;
        return isTransientStatus(response.status) ? Result.networkError(message) : Result.error(message);
      }

      const json = await response.json();
      const page = mapResults(json, source.name);
      publications.push(...page);

      const total = Number(json?.totaal ?? 0);
      if (page.length < PAGE_SIZE || start + PAGE_SIZE >= total) break;
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
