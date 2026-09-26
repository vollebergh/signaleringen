/**
 * Haalt publicaties op uit RSS/Atom-feeds en webpagina's.
 * Directe port van FeedFetcher.kt, inclusief de datumvarianten en de
 * retry-strategie.
 */

import { AppConfig } from '../core/config.js';
import { Result } from '../core/result.js';
import { SourceType, createPublication } from '../core/models.js';
import { log } from '../core/logger.js';
import { parseXml, decodeEntities } from './xml-parser.js';
import { fetchWithTimeout, withRetry, isTransientStatus, classifyFetchError } from './http.js';

/**
 * @param {import('../core/models.js').Source} source
 * @param {number} since epoch-millis; oudere publicaties worden overgeslagen
 */
export function fetchPublications(source, since) {
  return withRetry(source.name || source.url, () =>
    source.type === SourceType.WEB ? fetchWeb(source) : fetchRss(source, since),
  );
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

  const text = await response.text();
  if (!text) {
    return { error: Result.error(`Lege response voor ${source.name || source.url}`) };
  }
  return { text };
}

async function fetchRss(source, since) {
  try {
    const { text, error } = await fetchBody(source);
    if (error) return error;
    return Result.success(parseFeed(text, source.name, since));
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
 * Parseert RSS 2.0 (`<item>`) en Atom (`<entry>`) in één doorloop.
 * @returns {import('../core/models.js').Publication[]}
 */
export function parseFeed(xml, sourceName, since) {
  const publications = [];

  let inEntry = false;
  let currentTag = '';
  let title = '';
  let description = '';
  let link = '';
  let published = '';

  const reset = () => {
    title = '';
    description = '';
    link = '';
    published = '';
  };

  parseXml(xml, {
    onStart(name, attrs) {
      currentTag = name;
      if (name === 'item' || name === 'entry') {
        inEntry = true;
        reset();
        return;
      }
      // Atom zet de URL in het href-attribuut; alternate heeft voorrang op self.
      if (inEntry && name === 'link' && attrs.href) {
        const rel = attrs.rel ?? 'alternate';
        if (rel === 'alternate' || !link) link = attrs.href;
      }
    },

    onText(text) {
      if (!inEntry) return;
      const value = text.trim();
      if (!value) return;

      switch (currentTag) {
        case 'title':
          if (!title) title = value;
          break;
        case 'description':
        case 'summary':
        case 'content':
        case 'encoded':
          if (!description) description = value;
          break;
        case 'link':
          if (!link) link = value;
          break;
        case 'pubDate':
        case 'pubdate':
        case 'published':
        case 'updated':
        case 'date':
          if (!published) published = value;
          break;
        default:
          break;
      }
    },

    onEnd(name) {
      if (name !== 'item' && name !== 'entry') {
        currentTag = '';
        return;
      }
      inEntry = false;
      currentTag = '';

      const cleanDescription = truncate(
        stripHtml(description),
        AppConfig.RSS_DESCRIPTION_MAX_CHARS,
      );
      const publishedDate = parseDate(published);

      // Een onparseerbare datum (0) laten we door: liever te veel aanbieden aan
      // het model dan een publicatie missen omdat de feed een raar formaat heeft.
      if (publishedDate === 0 || publishedDate >= since) {
        publications.push(
          createPublication({
            title: stripHtml(title),
            description: cleanDescription,
            url: link,
            publishedDate,
            sourceName,
          }),
        );
      }
    },
  });

  log.debug(`Feed '${sourceName}': ${publications.length} publicaties na datumfilter`);
  return publications;
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
