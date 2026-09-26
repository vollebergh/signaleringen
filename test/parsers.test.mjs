/**
 * Tests voor de pure parseerlogica. Draaien met:
 *   node --test test/
 *
 * Bewust beperkt tot code zonder chrome-API's: de XML-pull-parser, de
 * feed-mapping, datumherkenning, OPML-import en de JSON-reparatie zijn de
 * onderdelen waar een stille fout tot lege scanresultaten leidt.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseXml, decodeEntities } from '../src/network/xml-parser.js';
import { parseFeed, parseDate, stripHtml } from '../src/network/feed-fetcher.js';
import { repairJsonArray, emptyContentMessage } from '../src/network/llm-client.js';
import { parseOpml } from '../src/background/opml.js';
import { validateSourceUrl, createProfile } from '../src/core/models.js';
import { assertValidBundle, exportFilename } from '../src/data/transfer-repository.js';
import { isDue } from '../src/background/scheduler.js';
import { formatInterval } from '../src/ui/dashboard/views/profiles.js';
import { AppConfig, DefaultSettings } from '../src/core/config.js';
import { mergeSettings } from '../src/data/settings-repository.js';

test('decodeEntities vertaalt named, decimale en hexadecimale entities', () => {
  assert.equal(decodeEntities('a &amp; b'), 'a & b');
  assert.equal(decodeEntities('&lt;tag&gt;'), '<tag>');
  assert.equal(decodeEntities('caf&#233;'), 'café');
  assert.equal(decodeEntities('&#x2014;'), '—');
  assert.equal(decodeEntities('&onbekend;'), '&onbekend;');
});

test('parseXml herkent attributen, zelfsluitende tags en CDATA', () => {
  const events = [];
  parseXml(
    `<root><link href="https://example.com/a" rel="alternate"/><t><![CDATA[ruwe <b>tekst</b>]]></t></root>`,
    {
      onStart: (name, attrs) => events.push(['start', name, attrs]),
      onEnd: (name) => events.push(['end', name]),
      onText: (text) => events.push(['text', text]),
    },
  );

  assert.deepEqual(events[1], ['start', 'link', { href: 'https://example.com/a', rel: 'alternate' }]);
  assert.deepEqual(events[2], ['end', 'link']);
  assert.deepEqual(events[4], ['text', 'ruwe <b>tekst</b>']);
});

test('parseXml laat een > binnen een attribuutwaarde staan', () => {
  const names = [];
  parseXml(`<a title="1 > 0"><b/></a>`, { onStart: (n) => names.push(n) });
  assert.deepEqual(names, ['a', 'b']);
});

test('parseFeed leest RSS 2.0 met CDATA en HTML in de beschrijving', () => {
  const xml = `<?xml version="1.0"?>
  <rss version="2.0"><channel>
    <title>Kanaal</title>
    <item>
      <title>Nieuwe regeling gepubliceerd</title>
      <description><![CDATA[<p>Een <b>toelichting</b> met opmaak.</p>]]></description>
      <link>https://example.nl/artikel-1</link>
      <pubDate>Mon, 15 Jan 2024 10:30:00 +0100</pubDate>
    </item>
    <item>
      <title>Tweede bericht</title>
      <description>Platte tekst &amp; entities</description>
      <link>https://example.nl/artikel-2</link>
      <pubDate>Tue, 16 Jan 2024 08:00:00 GMT</pubDate>
    </item>
  </channel></rss>`;

  const items = parseFeed(xml, 'Voorbeeldbron', 0);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Nieuwe regeling gepubliceerd');
  assert.equal(items[0].description, 'Een toelichting met opmaak.');
  assert.equal(items[0].url, 'https://example.nl/artikel-1');
  assert.equal(items[0].sourceName, 'Voorbeeldbron');
  assert.equal(items[1].description, 'Platte tekst & entities');
});

test('parseFeed leest Atom en pakt de alternate-link', () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
    <entry>
      <title>Atom-bericht</title>
      <link rel="self" href="https://example.nl/self"/>
      <link rel="alternate" href="https://example.nl/artikel"/>
      <summary>Korte samenvatting</summary>
      <published>2024-03-01T09:00:00Z</published>
    </entry>
  </feed>`;

  const items = parseFeed(xml, 'Atombron', 0);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://example.nl/artikel');
  assert.equal(items[0].publishedDate, Date.parse('2024-03-01T09:00:00Z'));
});

test('parseFeed filtert op datum maar laat onbekende datums door', () => {
  const since = Date.parse('2024-02-01T00:00:00Z');
  const xml = `<rss><channel>
    <item><title>Oud</title><pubDate>Mon, 15 Jan 2024 10:30:00 +0000</pubDate></item>
    <item><title>Nieuw</title><pubDate>Fri, 01 Mar 2024 10:30:00 +0000</pubDate></item>
    <item><title>Zonder datum</title></item>
  </channel></rss>`;

  const titles = parseFeed(xml, 'Bron', since).map((p) => p.title);
  assert.deepEqual(titles, ['Nieuw', 'Zonder datum']);
});

test('parseDate ondersteunt ISO, RFC-822 en kale datums', () => {
  assert.equal(parseDate('2024-01-15T10:30:00Z'), Date.parse('2024-01-15T10:30:00Z'));
  assert.equal(parseDate('Mon, 15 Jan 2024 10:30:00 +0100'), Date.parse('2024-01-15T09:30:00Z'));
  assert.equal(parseDate('2024-01-15'), Date.parse('2024-01-15'));
  assert.equal(parseDate(''), 0);
  assert.equal(parseDate('gisteren'), 0);
});

test('stripHtml verwijdert scripts, styles en tags', () => {
  const html = `<html><head><style>b{color:red}</style><script>alert('x')</script></head>
    <body><h1>Kop</h1><p>Alinea met <a href="#">link</a>.</p></body></html>`;
  const text = stripHtml(html);
  assert.ok(!text.includes('alert'));
  assert.ok(!text.includes('color:red'));
  assert.equal(text, 'Kop Alinea met link .');
});

test('parseOpml leest xmlUrl-outlines en ontdubbelt', () => {
  const opml = `<opml version="1.0"><body>
    <outline text="Map">
      <outline type="rss" text="Bron A" xmlUrl="https://a.example.nl/rss"/>
      <outline type="rss" title="Bron B" xmlUrl="https://b.example.nl/rss"/>
      <outline type="rss" text="Duplicaat" xmlUrl="https://a.example.nl/rss"/>
      <outline text="Geen feed"/>
    </outline>
  </body></opml>`;

  const sources = parseOpml(opml);
  assert.equal(sources.length, 2);
  assert.equal(sources[0].name, 'Bron A');
  assert.equal(sources[1].name, 'Bron B');
  assert.equal(sources[1].url, 'https://b.example.nl/rss');
});

test('repairJsonArray knipt een afgekapt antwoord tot het laatste hele object', () => {
  assert.equal(repairJsonArray('[{"a":1}]'), '[{"a":1}]');
  assert.equal(repairJsonArray('[{"a":1},{"a":2},{"a'), '[{"a":1},{"a":2}]');
  assert.equal(repairJsonArray('[{"a":1}'), '[{"a":1}]');
  assert.equal(repairJsonArray('rommel'), '[]');

  const repaired = repairJsonArray('[{"index":0,"relevant":true},{"index":1,"rele');
  assert.deepEqual(JSON.parse(repaired), [{ index: 0, relevant: true }]);
});

test('emptyContentMessage benoemt de oorzaak van een leeg antwoord', () => {
  // Het geval dat de verbindingstest liet mislukken: een reasoning-model dat
  // zijn tokenlimiet opmaakt aan een gedachtegang en niets overhoudt.
  const reasoningOnly = emptyContentMessage(
    { finish_reason: 'length', message: { content: null, reasoning: 'Laat me denken…' } },
    { usage: { completion_tokens: 16 } },
  );
  assert.match(reasoningOnly, /gedachtegang/);
  assert.match(reasoningOnly, /tokenlimiet was al op/);

  const truncated = emptyContentMessage(
    { finish_reason: 'length', message: { content: '' } },
    { usage: { completion_tokens: 4096 } },
  );
  assert.match(truncated, /afgekapt/);
  assert.match(truncated, /4096 tokens/);

  assert.match(
    emptyContentMessage({ finish_reason: 'content_filter', message: {} }, {}),
    /inhoudsfilter/,
  );
  assert.match(emptyContentMessage(undefined, {}), /zonder resultaten/);
  assert.match(emptyContentMessage({ message: {} }, {}), /finish_reason: onbekend/);
});

test('validateSourceUrl weigert niet-http-schemas', () => {
  assert.equal(validateSourceUrl('https://example.nl/rss'), null);
  assert.equal(validateSourceUrl(''), null);
  assert.ok(validateSourceUrl('javascript:alert(1)'));
  assert.ok(validateSourceUrl('ftp://example.nl'));
  assert.ok(validateSourceUrl('zomaar tekst'));
});

test('assertValidBundle weigert alles wat geen eigen exportbestand is', () => {
  const geldig = {
    format: AppConfig.EXPORT_FORMAT,
    formatVersion: AppConfig.EXPORT_FORMAT_VERSION,
    profiles: [],
  };
  assert.doesNotThrow(() => assertValidBundle(geldig));

  assert.throws(() => assertValidBundle(null), /geen bruikbare gegevens/);
  assert.throws(() => assertValidBundle({ profiles: [] }), /geen exportbestand van Signaleringen/);
  assert.throws(
    () => assertValidBundle({ ...geldig, formatVersion: undefined }),
    /geen versienummer/,
  );
  assert.throws(
    () => assertValidBundle({ ...geldig, formatVersion: AppConfig.EXPORT_FORMAT_VERSION + 1 }),
    /nieuwere versie/,
  );
  assert.throws(() => assertValidBundle({ ...geldig, profiles: 'nee' }), /geen profielen/);
});

test('exportFilename maakt een leesbare naam per bereik', () => {
  const bundle = (names) => ({
    exportedAt: Date.parse('2026-08-15T10:00:00Z'),
    profiles: names.map((name) => ({ profile: { name } })),
  });

  assert.equal(
    exportFilename(bundle(['Omgevingswet'])),
    'signaleringen-omgevingswet-2026-08-15.json',
  );
  assert.equal(exportFilename(bundle(['A', 'B'])), 'signaleringen-2-profielen-2026-08-15.json');
  // Diakrieten en leestekens worden platgeslagen, niet doorgelaten.
  assert.equal(
    exportFilename(bundle(['Café & Terras!'])),
    'signaleringen-cafe-terras-2026-08-15.json',
  );
  assert.equal(exportFilename(bundle([''])), 'signaleringen-profiel-2026-08-15.json');
});

test('isDue bepaalt of een profiel aan de beurt is', () => {
  const nu = Date.parse('2026-08-15T12:00:00Z');
  const uur = 60 * 60 * 1000;
  const profiel = (extra) =>
    createProfile({
      name: 'Test',
      sources: [{ name: 'bron', url: 'https://example.nl/rss' }],
      autoScanEnabled: true,
      autoScanIntervalMinutes: 360,
      ...extra,
    });

  // Nog nooit gescand → meteen aan de beurt.
  assert.equal(isDue(profiel(), null, nu), true);
  // 7 uur geleden bij een interval van 6 uur → aan de beurt.
  assert.equal(isDue(profiel(), nu - 7 * uur, nu), true);
  // 2 uur geleden → nog niet.
  assert.equal(isDue(profiel(), nu - 2 * uur, nu), false);

  // Uitgeschakeld of zonder bronnen doet nooit mee.
  assert.equal(isDue(profiel({ autoScanEnabled: false }), null, nu), false);
  assert.equal(isDue(profiel({ sources: [] }), null, nu), false);

  // Een te kort interval wordt opgetrokken naar de ondergrens van een uur,
  // zodat een handmatig aangepaste waarde de planner niet laat rammen.
  const teKort = profiel({ autoScanIntervalMinutes: 5 });
  assert.equal(isDue(teKort, nu - 30 * 60 * 1000, nu), false);
  assert.equal(isDue(teKort, nu - 2 * uur, nu), true);
});

test('formatInterval schrijft minuten uit als leesbare periode', () => {
  assert.equal(formatInterval(30), '30 min');
  assert.equal(formatInterval(60), '1 uur');
  assert.equal(formatInterval(90), '1 uur 30 min');
  assert.equal(formatInterval(1440), '1 dag');
  assert.equal(formatInterval(4320), '3 dagen');
  assert.equal(formatInterval(10080), '7 dagen');
});

test('mergeSettings: key-veld is leeg zonder lokaal bestand', () => {
  assert.equal(mergeSettings(DefaultSettings, {}, undefined).directApiKey, '');
});

test('mergeSettings: lokaal bestand vult de key voor, opgeslagen waarde wint', () => {
  const local = { directApiKey: 'lokaal' };
  assert.equal(mergeSettings(DefaultSettings, local, undefined).directApiKey, 'lokaal');
  assert.equal(mergeSettings(DefaultSettings, local, { directApiKey: 'eigen' }).directApiKey, 'eigen');
});

test('mergeSettings: onbekende sleutels en lege waarden uit het lokale bestand tellen niet', () => {
  const merged = mergeSettings(DefaultSettings, { onzin: 1, model: '' }, undefined);
  assert.equal('onzin' in merged, false);
  assert.equal(merged.model, DefaultSettings.model);
});

// ── open.overheid.nl (B-57) ──────────────────────────────────────────────────

import {
  isOpenOverheidSearchUrl,
  toApiUrl,
  formatApiDate,
  mapResults,
} from '../src/network/open-overheid.js';

const LVVN = 'ministerie van Landbouw, Visserij, Voedselzekerheid en Natuur';
const SITE_URL =
  'https://open.overheid.nl/zoeken?zoeken=stikstof&pagina=3&aantal=10&sort=relevantie' +
  '&organisatie=ministerie+van+Landbouw%2C+Visserij%2C+Voedselzekerheid+en+Natuur' +
  '&organisatie=Tweede+Kamer&documentsoort=Kamerbrief&publicatiedatumVan=01-01-2020';

test('isOpenOverheidSearchUrl herkent alleen de zoekpagina van open.overheid.nl', () => {
  assert.equal(isOpenOverheidSearchUrl(SITE_URL), true);
  assert.equal(isOpenOverheidSearchUrl('https://open.overheid.nl/zoeken/'), true);
  assert.equal(isOpenOverheidSearchUrl('https://open.overheid.nl/details/abc'), false);
  assert.equal(isOpenOverheidSearchUrl('https://example.nl/zoeken?zoeken=x'), false);
  assert.equal(isOpenOverheidSearchUrl('geen url'), false);
});

test('formatApiDate geeft DD-MM-JJJJ', () => {
  assert.equal(formatApiDate(new Date(2026, 8, 5, 12).getTime()), '05-09-2026');
});

test('toApiUrl codeert filters dubbel en komma-gescheiden, en negeert UI-paginering en -periode', () => {
  const api = new URL(toApiUrl(SITE_URL, { since: new Date(2026, 8, 20, 12).getTime(), start: 50 }));
  assert.equal(api.origin + api.pathname, 'https://open.overheid.nl/overheid/openbaarmakingen/api/v0/zoek');

  const raw = api.search;
  const expectedOrg = `${encodeURIComponent(encodeURIComponent(LVVN))},Tweede%2520Kamer`;
  assert.ok(raw.includes(`organisatie=${expectedOrg}`), raw);
  assert.ok(raw.includes('documentsoort=Kamerbrief'));
  assert.ok(raw.includes('zoektekst=stikstof'));
  assert.ok(raw.includes('start=50'));
  assert.ok(raw.includes('aantalResultaten=50'));
  assert.ok(raw.includes('sort=publicatiedatum'));
  assert.ok(raw.includes('publicatiedatumVan=20-09-2026'));
  assert.ok(!raw.includes('pagina='));
  assert.ok(!raw.includes('01-01-2020'));
});

test('toApiUrl zonder venster laat de datum weg', () => {
  assert.ok(!toApiUrl(SITE_URL).includes('publicatiedatumVan'));
});

test('mapResults: fragment gaat voor omschrijving, publisher als context, pid als link', () => {
  const pubs = mapResults(
    {
      totaal: 2,
      resultaten: [
        {
          document: {
            titel: 'Kamerbrief over stikstof',
            omschrijving: 'Standaardzin',
            pid: 'https://open.overheid.nl/documenten/abc',
            openbaarmakingsdatum: '2026-09-25',
            publisher: LVVN,
          },
          highlightedText: 'over de <b>rekenkundige ondergrens</b>',
        },
        { document: { titel: '', pid: 'https://open.overheid.nl/documenten/leeg' } },
      ],
    },
    'LVVN',
  );
  assert.equal(pubs.length, 1);
  assert.equal(pubs[0].url, 'https://open.overheid.nl/documenten/abc');
  assert.equal(pubs[0].description, `${LVVN} — over de rekenkundige ondergrens`);
  assert.equal(pubs[0].publishedDate, Date.parse('2026-09-25'));
  assert.equal(pubs[0].sourceName, 'LVVN');
});
