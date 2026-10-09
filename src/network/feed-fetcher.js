/**
 * Haalt publicaties op uit RSS/Atom-feeds, webpagina's en zoekopdrachten op
 * open.overheid.nl (die laatste in open-overheid.js).
 * Directe port van FeedFetcher.kt, inclusief de datumvarianten en de
 * retry-strategie.
 */

import { AppConfig } from '../core/config.js';
import { Result } from '../core/result.js';
import { SourceType, createPublication } from '../core/models.js';
import { log } from '../core/logger.js';
import { parseXml, decodeEntities } from './xml-parser.js';
import { fetchWithTimeout, withRetry, isTransientStatus, classifyFetchError } from './http.js';
// Wederzijdse import: open-overheid.js gebruikt stripHtml hieronder. Veilig,
// omdat beide kanten de ander pas bij een aanroep nodig hebben.
import { fetchOpenOverheid } from './open-overheid.js';

/**
 * @param {import('../core/models.js').Source} source
 * @param {number} since epoch-millis; oudere publicaties worden overgeslagen
 */
export function fetchPublications(source, since) {
  return withRetry(source.name || source.url, () => {
    if (source.type === SourceType.OPEN_OVERHEID) return fetchOpenOverheid(source, since);
    return source.type === SourceType.WEB ? fetchWeb(source) : fetchRss(source, since);
  });
}

async function fetchBody(source) {
  const response = await fetchWithTimeout(
    source.url,
    { headers: { Accept: 'application/rss+xml, application/xml, text/xml, text/html;q=0.8' } },
    AppConfig.FEED_TIMEOUT_MS,
  );

  if (!response.ok) {
    const message = `HTTP ${response.status} voor ${source.name || source.url}`;
    return isTransientStatus(response.status)
      ? { error: Result.networkError(message) }
      : { error: Result.error(message) };
  }

  const text = decodeBody(new Uint8Array(await response.arrayBuffer()), response.headers.get('content-type'));
  if (!text) {
    return { error: Result.error(`Lege response voor ${source.name || source.url}`) };
  }
  return { text, finalUrl: response.url || source.url };
}

/**
 * Decodeert de response met de juiste tekenset (B-66). `response.text()` gaat
 * altijd uit van UTF-8, terwijl een feed in bijv. ISO-8859-1 of windows-1252
 * dat in de `Content-Type` of de XML-declaratie aangeeft. Volgorde: header,
 * dan declaratie, dan UTF-8.
 */
export function decodeBody(bytes, contentType) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
  const charset =
    /charset=["']?([\w.:-]+)/i.exec(contentType ?? '')?.[1] ??
    /<\?xml[^>]*encoding=["']([\w.:-]+)["']/i.exec(head)?.[1] ??
    'utf-8';
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes); // onbekende tekenset
  }
}

/** Begint het document als RSS, RSS 1.0 (RDF) of Atom? */
export function looksLikeFeed(text) {
  const start = text.slice(0, 4000).replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>/gi, '').trimStart();
  return /^<(?:[\w-]+:)?(?:rss|feed|RDF)\b/i.test(start);
}

/**
 * Het eerste feedadres dat een webpagina aankondigt
 * (`<link rel="alternate" type="application/rss+xml" href="…">`), of null.
 */
export function discoverFeedUrl(html, pageUrl) {
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/rel=["']?alternate/i.test(tag) || !/(rss|atom)\+xml/i.test(tag)) continue;
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) continue;
    try {
      return new URL(decodeEntities(href), pageUrl).href;
    } catch {
      /* volgende proberen */
    }
  }
  return null;
}

async function fetchRss(source, since) {
  try {
    const { text, finalUrl, error } = await fetchBody(source);
    if (error) return error;
    // Een webpagina als RSS-bron gaf eerder stil 0 publicaties (B-66).
    if (!looksLikeFeed(text)) {
      const feedUrl = discoverFeedUrl(text, finalUrl);
      return Result.error(
        feedUrl
          ? `${source.name || source.url} is een webpagina, geen feed. De pagina noemt deze feed: ${feedUrl}`
          : `${source.name || source.url} is een webpagina, geen RSS- of Atom-feed. Gebruik het feedadres, of kies het type Webpagina.`,
      );
    }
    return Result.success(parseFeed(text, source.name, since, finalUrl));
  } catch (err) {
    return classifyFetchError(err, source.name || source.url);
  }
}

async function fetchWeb(source) {
  try {
    const { text, error } = await fetchBody(source);
    if (error) return error;

    const content = stripHtml(text).slice(0, AppConfig.WEB_CONTENT_MAX_CHARS);
    return Result.success([
      createPublication({
        title: `Webpagina: ${source.name}`,
        description: content,
        url: source.url,
        publishedDate: Date.now(),
        sourceName: source.name,
      }),
    ]);
  } catch (err) {
    return classifyFetchError(err, source.name || source.url);
  }
}

/** Verwijdert scripts, styles en tags; laat leesbare tekst over. */
export function stripHtml(html) {
  return decodeEntities(
    html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Velden van een item/entry, per elementnaam (zonder prefix). Tekst wordt
 * verzameld tot het element sluit, ook over geneste elementen en meerdere
 * tekst- of CDATA-stukken heen (B-66: Atom `content type="xhtml"` heeft een
 * `<div>` erin). Per veld telt het eerste niet-lege element.
 */
const ENTRY_FIELDS = {
  title: 'title',
  description: 'description',
  summary: 'description',
  content: 'description',
  encoded: 'description',
  link: 'link',
  guid: 'guid',
  id: 'guid',
  pubDate: 'published',
  pubdate: 'published',
  published: 'published',
  updated: 'published',
  date: 'published',
  issued: 'published',
};

/** Blokelementen in xhtml-inhoud: daartussen een spatie, anders plakken alinea's aan elkaar. */
const BLOCK_ELEMENTS = new Set(['p', 'div', 'br', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'td', 'blockquote']);

/** Prefixen waarvan de elementen geen eigen velden van het item zijn. */
const IGNORED_PREFIXES = new Set(['media', 'itunes', 'georss', 'slash', 'wfw', 'sy']);

/**
 * Parseert RSS 2.0, RSS 1.0 (`<item>`) en Atom (`<entry>`) in één doorloop.
 * @param {string} [baseUrl] adres van de feed, om relatieve links op te lossen
 * @returns {import('../core/models.js').Publication[]}
 */
export function parseFeed(xml, sourceName, since, baseUrl) {
  const publications = [];

  let inEntry = false;
  let fields = {};
  let guidIsPermaLink = true;
  // Het veld dat nu tekst verzamelt, met diepte voor geneste elementen.
  let capture = null; // { field, name, depth, text }

  parseXml(xml, {
    onStart(name, attrs, rawName) {
      if (name === 'item' || name === 'entry') {
        inEntry = true;
        fields = {};
        guidIsPermaLink = true;
        capture = null;
        return;
      }
      if (!inEntry) return;
      if (capture) {
        capture.depth += 1;
        if (BLOCK_ELEMENTS.has(name)) capture.text += ' ';
        return;
      }

      const prefix = rawName.includes(':') ? rawName.slice(0, rawName.indexOf(':')) : '';
      // Behalve media:description: YouTube zet de omschrijving alleen daar.
      if (IGNORED_PREFIXES.has(prefix) && !(prefix === 'media' && name === 'description')) return;

      // Atom zet de URL in het href-attribuut; alternate heeft voorrang.
      if (name === 'link' && attrs.href) {
        const rel = attrs.rel ?? 'alternate';
        if (rel === 'alternate' && !fields.alternate) fields.alternate = attrs.href;
        else if (!fields.otherLink) fields.otherLink = attrs.href;
        return;
      }
      if (name === 'guid' && attrs.ispermalink === 'false') guidIsPermaLink = false;

      const field = ENTRY_FIELDS[name];
      if (field && !fields[field]) capture = { field, name, depth: 0, text: '' };
    },

    onText(text) {
      if (capture) capture.text += text;
    },

    onEnd(name) {
      if (capture) {
        if (capture.depth > 0) {
          capture.depth -= 1;
          if (BLOCK_ELEMENTS.has(name)) capture.text += ' ';
          return;
        }
        if (name === capture.name) {
          const value = capture.text.trim();
          if (value && !fields[capture.field]) fields[capture.field] = value;
          capture = null;
        }
        return;
      }
      if (name !== 'item' && name !== 'entry') return;
      inEntry = false;

      const publishedDate = parseDate(fields.published);
      // Een onparseerbare datum (0) laten we door: liever te veel aanbieden aan
      // het model dan een publicatie missen omdat de feed een raar formaat heeft.
      if (publishedDate !== 0 && publishedDate < since) return;

      // Geen link? Dan een guid die een URL is (RSS zonder <link>).
      const guidUrl = guidIsPermaLink && /^https?:\/\//i.test(fields.guid ?? '') ? fields.guid : '';
      const link = fields.alternate ?? fields.link ?? fields.otherLink ?? guidUrl;

      publications.push(
        createPublication({
          title: stripHtml(fields.title ?? ''),
          description: truncate(stripHtml(fields.description ?? ''), AppConfig.RSS_DESCRIPTION_MAX_CHARS),
          url: resolveUrl(link, baseUrl),
          publishedDate,
          sourceName,
        }),
      );
    },
  });

  log.debug(`Feed '${sourceName}': ${publications.length} publicaties na datumfilter`);
  return publications;
}

/** Relatieve link → absoluut, ten opzichte van het feedadres (B-66). */
function resolveUrl(link, baseUrl) {
  const value = (link ?? '').trim();
  if (!value || !baseUrl) return value;
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return value;
  }
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

const RFC822 =
  /^(?:\w{3},\s*)?(\d{1,2})\s+(\w{3})\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s*(.*)$/;

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Ondersteunt ISO-8601/RFC-3339, RFC-822/2822 en kale datums.
 * @returns {number} epoch-millis, of 0 als het formaat onbekend is
 */
export function parseDate(value) {
  if (!value || !value.trim()) return 0;
  const trimmed = value.trim();

  // Date.parse dekt ISO-8601 en de meeste RFC-822-varianten in V8.
  const native = Date.parse(trimmed);
  if (Number.isFinite(native)) return native;

  const match = RFC822.exec(trimmed);
  if (match) {
    const [, day, monthName, year, hour, minute, second, zone] = match;
    const month = MONTHS[monthName.slice(0, 3).toLowerCase()];
    if (month !== undefined) {
      const base = Date.UTC(
        Number(year),
        month,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second ?? 0),
      );
      return base - zoneOffsetMs(zone);
    }
  }

  return 0;
}

/** `+0100` / `-0500` / `GMT` → offset in milliseconden. */
function zoneOffsetMs(zone) {
  if (!zone) return 0;
  const numeric = /^([+-])(\d{2}):?(\d{2})$/.exec(zone.trim());
  if (numeric) {
    const sign = numeric[1] === '-' ? -1 : 1;
    return sign * (Number(numeric[2]) * 60 + Number(numeric[3])) * 60_000;
  }
  return 0; // GMT/UT/UTC en onbekende afkortingen behandelen we als UTC
}
