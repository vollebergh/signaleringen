/**
 * Tests voor de punten uit de JavaScript-track van het reviewprotocol
 * (2026-10-13, Deel 1c en checklist B25–B32) die de eerste review niet
 * toetste: sleutels uit een feed of URL die op het prototype van een object
 * vallen (J4, CR-25), en fouten die niet stil verdwijnen (J10, CR-24).
 * Draaien met:
 *   node --test test/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { decodeEntities, parseXml } = await import('../src/network/xml-parser.js');
const { parseFeed, parseDate } = await import('../src/network/feed-fetcher.js');
const { periodFromSiteUrl } = await import('../src/network/open-overheid.js');
const { isNoReceiverError } = await import('../src/background/scan-progress.js');

// ── J4 / CR-25: prototype-sleutels ─────────────────────────────────────────

test('decodeEntities: &constructor; en &toString; blijven tekst', () => {
  assert.equal(decodeEntities('a &constructor; b &toString; c &__proto__;'), 'a &constructor; b &toString; c &__proto__;');
  assert.equal(decodeEntities('&eacute;&amp;&#233;'), 'é&é');
});

test('parseXml: een attribuut __proto__ wordt een gewoon attribuut', () => {
  let attrs;
  parseXml('<link __proto__="x" href="https://example.com/"/>', {
    onStart(name, a) {
      attrs = a;
    },
    onText() {},
    onEnd() {},
  });
  assert.equal(attrs.href, 'https://example.com/');
  assert.equal(Object.getPrototypeOf(attrs), null);
  assert.equal(attrs.__proto__, 'x');
});

test('parseFeed: elementen als <constructor> en <__proto__> leveren geen rare velden', () => {
  const xml = `<rss><channel><item>
    <constructor>x</constructor><__proto__>y</__proto__><toString>z</toString>
    <title>Titel</title><link>https://example.com/a</link><pubDate>Mon, 12 Oct 2026 10:00:00 +0200</pubDate>
  </item></channel></rss>`;
  const [pub] = parseFeed(xml, 'Test', 0, 'https://example.com/feed');
  assert.equal(pub.title, 'Titel');
  assert.equal(pub.url, 'https://example.com/a');
  assert.ok(pub.publishedDate > 0);
});

test('periodFromSiteUrl: een beschikbaarSinds als hasOwnProperty geeft geen fout', () => {
  for (const value of ['hasOwnProperty', 'constructor', 'toString', '__proto__']) {
    const url = `https://open.overheid.nl/zoekresultaten?zoeken=x&beschikbaarSinds=${value}`;
    assert.equal(periodFromSiteUrl(url, Date.UTC(2026, 9, 13)), null, value);
  }
  const week = periodFromSiteUrl('https://open.overheid.nl/zoekresultaten?beschikbaarSinds=Afgelopen%20week', Date.UTC(2026, 9, 13));
  assert.equal(week.since, Date.UTC(2026, 9, 6));
});

test('parseDate: een maand die op het prototype valt telt niet', () => {
  assert.equal(parseDate('12 pro 2026 10:00:00 +0000'), 0);
  assert.equal(parseDate('12 Oct 2026 10:00:00 +0000'), Date.UTC(2026, 9, 12, 10));
});

// ── J10 / CR-24: geen stille fouten ────────────────────────────────────────

test('isNoReceiverError: alleen "geen luisteraar" is de gewone toestand', () => {
  assert.equal(isNoReceiverError(new Error('Could not establish connection. Receiving end does not exist.')), true);
  assert.equal(isNoReceiverError(new Error('Extension context invalidated.')), false);
  assert.equal(isNoReceiverError(undefined), false);
});
