/**
 * Tests voor ronde B van de code review en de security audit (2026-10-13):
 * grenzen op antwoorden (CR-04/S-03), https voor de verbinding (S-02),
 * tijdelijke fouten (CR-09), lokale adressen (CR-10), bronvalidatie (S-05),
 * import (S-06), voorfilter-key (S-10), links (S-11), bewaartermijn van
 * "gezien" (CR-05) en het plafond per feed (S-04). Draaien met:
 *   node --test test/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { fetchBytes, ResponseTooLargeError, classifyFetchError } = await import('../src/network/http.js');
const { testConnection } = await import('../src/network/llm-transport.js');
const { prefilterConnection } = await import('../src/network/prefilter.js');
const { connectionErrors, validateRouting } = await import('../src/core/routing.js');
const { isLocalBaseUrl, assertValidSource } = await import('../src/core/models.js');
const { assertValidBundle, buildEntryRecords } = await import('../src/data/transfer-repository.js');
const { expiredSeen } = await import('../src/data/history-repository.js');
const { newestFirst } = await import('../src/network/feed-fetcher.js');
const { isHttpUrl } = await import('../src/ui/shared/dom.js');
const { AppConfig, DefaultSettings, SuggestedConnection } = await import('../src/core/config.js');
// Sinds 0.25.6 zijn Base-URL, model en routing standaard leeg; de tests gaan uit
// van een ingestelde verbinding met OpenRouter.
const Connected = { ...DefaultSettings, ...SuggestedConnection, directApiKeyHost: 'openrouter.ai' };

/** Vervangt `fetch` tijdens `body`. */
async function withFetch(fake, body) {
  const real = globalThis.fetch;
  globalThis.fetch = fake;
  try {
    return await body();
  } finally {
    globalThis.fetch = real;
  }
}

/** Een body die in stukken binnenkomt. */
function streamOf(chunks, { delayMs = 0 } = {}) {
  return new ReadableStream({
    async pull(controller) {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      const next = chunks.shift();
      if (next) controller.enqueue(next);
      else controller.close();
    },
  });
}

// ── CR-04 / S-03: grenzen op antwoorden ────────────────────────────────────

test('fetchBytes: leest een gewone body', async () => {
  const result = await withFetch(
    async () => new Response(streamOf([new Uint8Array([1, 2]), new Uint8Array([3])])),
    () => fetchBytes('https://a.nl', {}, { maxBytes: 10, timeoutMs: 1000 }),
  );
  assert.deepEqual([...result.bytes], [1, 2, 3]);
});

test('fetchBytes: breekt af boven de grootte, ook zonder content-length', async () => {
  await withFetch(
    async () => new Response(streamOf([new Uint8Array(6), new Uint8Array(6)])),
    () => assert.rejects(fetchBytes('https://a.nl', {}, { maxBytes: 10, timeoutMs: 1000 }), ResponseTooLargeError),
  );
});

test('fetchBytes: weigert meteen bij een te grote content-length', async () => {
  await withFetch(
    async () => new Response('x', { headers: { 'content-length': '999999' } }),
    () => assert.rejects(fetchBytes('https://a.nl', {}, { maxBytes: 10, timeoutMs: 1000 }), ResponseTooLargeError),
  );
});

test('fetchBytes: de deadline geldt ook voor de body', async () => {
  // Headers meteen, daarna een body die nooit afkomt.
  const fake = async (_url, { signal }) =>
    new Response(
      new ReadableStream({
        start(controller) {
          signal.addEventListener('abort', () => controller.error(signal.reason ?? new DOMException('aborted', 'AbortError')));
        },
      }),
    );
  await withFetch(fake, () =>
    assert.rejects(fetchBytes('https://a.nl', {}, { maxBytes: 10, timeoutMs: 50 }), (err) => err.name === 'AbortError'),
  );
});

test('fetchBytes: leest ook de body van een foutantwoord (foutmelding van de API)', async () => {
  const result = await withFetch(
    async () => new Response('{"error":{"message":"op"}}', { status: 429 }),
    () => fetchBytes('https://a.nl', {}, { timeoutMs: 1000 }),
  );
  assert.equal(result.response.status, 429);
  assert.match(new TextDecoder().decode(result.bytes), /op/);
});

test('classifyFetchError: te groot is definitief, geen herhaling', () => {
  const result = classifyFetchError(new ResponseTooLargeError(10 * 1024 * 1024), 'Feed');
  assert.equal(result.kind, 'error');
  assert.match(result.message, /groter dan 10 MB/);
});

// ── S-02: https voor de verbinding ─────────────────────────────────────────

test('connectionErrors: https en lokaal http zijn in orde', () => {
  assert.deepEqual(connectionErrors({ transport: 'direct', directBaseUrl: 'https://openrouter.ai/api/v1' }), []);
  assert.deepEqual(connectionErrors({ transport: 'direct', directBaseUrl: 'http://localhost:11434/v1' }), []);
  assert.deepEqual(connectionErrors({ transport: 'proxy', proxyUrl: 'http://100.101.1.2/signaleringen' }), []);
  assert.deepEqual(connectionErrors({ transport: 'proxy', proxyUrl: '' }), [], 'leeg meldt isConfigured');
});

test('connectionErrors: http naar een niet-lokale host wordt geweigerd', () => {
  const [direct] = connectionErrors({ transport: 'direct', directBaseUrl: 'http://example.com/v1' });
  assert.match(direct, /Base-URL: gebruik https/);
  const [proxy] = connectionErrors({ transport: 'proxy', proxyUrl: 'http://proxy.example.com' });
  assert.match(proxy, /Proxy-adres: gebruik https/);
  assert.equal(connectionErrors({ transport: 'direct', directBaseUrl: 'ftp://x.nl' }).length, 1);
});

test('validateRouting: neemt de verbindingscontrole mee', () => {
  const errors = validateRouting({ ...Connected, directBaseUrl: 'http://example.com/v1' });
  assert.equal(errors.length, 1);
});

test('testConnection: weigert een http-Base-URL zonder verzoek te doen', async () => {
  let called = false;
  await withFetch(
    async () => {
      called = true;
      return new Response('{}');
    },
    () =>
      assert.rejects(
        testConnection({ ...Connected, directBaseUrl: 'http://example.com/v1', directApiKey: 'sk-test' }),
        /gebruik https/,
      ),
  );
  assert.equal(called, false, 'de key ging niet over de lijn');
});

// ── CR-09: alleen netwerkfouten zijn tijdelijk ─────────────────────────────

test('testConnection: een netwerkfout wordt een duidelijke melding', async () => {
  await withFetch(
    async () => {
      throw new TypeError('Failed to fetch');
    },
    () => assert.rejects(testConnection({ ...Connected, directApiKey: 'sk-test' }), /Netwerkfout: Failed to fetch/),
  );
});

// ── CR-10: lokale adressen ─────────────────────────────────────────────────

test('isLocalBaseUrl: alleen 100.64.0.0/10, niet heel 100.x', () => {
  assert.equal(isLocalBaseUrl('http://100.64.0.1/v1'), true);
  assert.equal(isLocalBaseUrl('http://100.127.255.1/v1'), true);
  assert.equal(isLocalBaseUrl('http://100.1.2.3/v1'), false);
  assert.equal(isLocalBaseUrl('http://100.128.0.1/v1'), false);
});

test('isLocalBaseUrl: IPv6 ULA en link-local', () => {
  assert.equal(isLocalBaseUrl('http://[fd12:3456::1]:11434/v1'), true);
  assert.equal(isLocalBaseUrl('http://[fe80::1]/v1'), true);
  assert.equal(isLocalBaseUrl('http://[::1]/v1'), true);
  assert.equal(isLocalBaseUrl('http://[2001:db8::1]/v1'), false);
});

// ── S-05 / S-06: bronnen en import ─────────────────────────────────────────

test('assertValidSource: alleen http(s) met een bekend type', () => {
  assert.doesNotThrow(() => assertValidSource({ name: 'NOS', url: 'https://feeds.nos.nl/x', type: 'RSS' }));
  assert.throws(() => assertValidSource({ name: 'x', url: 'chrome-extension://abc/local-settings.json', type: 'WEB' }), /http/);
  assert.throws(() => assertValidSource({ name: 'x', url: 'javascript:alert(1)' }), /http/);
  assert.throws(() => assertValidSource({ name: 'x', url: '' }), /Lege URL/);
  assert.throws(() => assertValidSource({ name: 'x', url: 'https://a.nl', type: 'SCRIPT' }), /onbekend type/);
});

const bundle = (sources) => ({
  format: AppConfig.EXPORT_FORMAT,
  formatVersion: AppConfig.EXPORT_FORMAT_VERSION,
  profiles: [{ profile: { id: 'p1', name: 'P', sources }, scans: [] }],
});

test('assertValidBundle: een bron met een verkeerd schema blokkeert de import', () => {
  assert.doesNotThrow(() => assertValidBundle(bundle([{ id: 's1', name: 'a', url: 'https://a.nl/feed', type: 'RSS' }])));
  assert.throws(() => assertValidBundle(bundle([{ id: 's1', name: 'a', url: 'file:///etc/passwd', type: 'WEB' }])), /http/);
});

test('buildEntryRecords: scans en publicaties krijgen altijd nieuwe id\'s, verwijzingen gaan mee', () => {
  let n = 0;
  const makeId = () => `nieuw-${++n}`;
  const entry = {
    profile: { id: 'p1', name: 'P', sources: [{ id: 's1', name: 'a', url: 'https://a.nl/feed', type: 'RSS' }] },
    scans: [
      {
        scan: { id: 'scan-van-ander-profiel', profileId: 'p1', scannedSourceIds: ['s1'], sourceStatuses: [{ sourceId: 's1' }] },
        publications: [{ id: 'pub-van-ander-profiel', previousSynthesisScanId: 'scan-van-ander-profiel' }],
        synthesis: { scanId: 'scan-van-ander-profiel', text: 't' },
      },
    ],
    seen: [{ key: 'k', firstScanId: 'scan-van-ander-profiel', synthesisScanId: 'opgeruimd' }],
    sourceStates: [{ sourceId: 's1', lastScanId: 'scan-van-ander-profiel' }],
  };

  // Zonder remap (nieuw profiel of vervangen): profiel en bronnen houden hun id.
  const r = buildEntryRecords(entry, { remap: false, makeId });
  const scanId = r.scans[0].id;
  assert.equal(r.profile.id, 'p1');
  assert.notEqual(scanId, 'scan-van-ander-profiel');
  assert.notEqual(r.publications[0].id, 'pub-van-ander-profiel');
  assert.equal(r.publications[0].scanId, scanId);
  assert.equal(r.publications[0].previousSynthesisScanId, scanId);
  assert.equal(r.syntheses[0].scanId, scanId);
  assert.equal(r.seen[0].firstScanId, scanId);
  assert.equal(r.seen[0].synthesisScanId, null, 'verwijzing naar een scan buiten de bundel wordt leeg');
  assert.equal(r.seen[0].id, 'p1::k');
  assert.equal(r.sourceStates[0].lastScanId, scanId);
  assert.equal(r.sourceStates[0].id, 'p1::s1');

  // Met remap: ook profiel en bronnen nieuw.
  const c = buildEntryRecords(entry, { remap: true, makeId });
  assert.notEqual(c.profile.id, 'p1');
  assert.notEqual(c.profile.sources[0].id, 's1');
  assert.equal(c.scans[0].scannedSourceIds[0], c.profile.sources[0].id);
});

// ── S-10: voorfilter-key ───────────────────────────────────────────────────

test('prefilterConnection: de key van het taalmodel alleen naar dezelfde host', () => {
  const base = { ...Connected, directApiKey: 'sk-or', jevPrefilterEnabled: true, prefilterEndpoint: 'https://openrouter.ai/api/alpha/decisions' };
  assert.equal(prefilterConnection(base).key, 'sk-or', 'standaard: openrouter.ai bij beide');
  assert.equal(prefilterConnection({ ...base, prefilterEndpoint: 'https://ander.example/decisions' }).key, '');
  assert.equal(
    prefilterConnection({ ...base, prefilterEndpoint: 'https://ander.example/decisions', prefilterApiKey: 'eigen' }).key,
    'eigen',
  );
});

// ── S-11: links ────────────────────────────────────────────────────────────

test('isHttpUrl: alleen http(s)', () => {
  assert.equal(isHttpUrl('https://a.nl'), true);
  assert.equal(isHttpUrl('http://a.nl'), true);
  assert.equal(isHttpUrl('javascript:alert(1)'), false);
  assert.equal(isHttpUrl('data:text/html,x'), false);
  assert.equal(isHttpUrl('geen url'), false);
});

// ── CR-05: bewaartermijn van "gezien" ──────────────────────────────────────

test('expiredSeen: weg na 180 dagen niet meer gezien; lastSeenAt gaat voor', () => {
  const day = 24 * 60 * 60 * 1000;
  const now = 1_000 * day;
  const records = [
    { id: 'oud', firstSeenAt: now - 200 * day },
    { id: 'oud-maar-nog-in-feed', firstSeenAt: now - 300 * day, lastSeenAt: now - day },
    { id: 'recent', firstSeenAt: now - 10 * day, lastSeenAt: now - 10 * day },
    { id: 'net-verlopen', firstSeenAt: now - 400 * day, lastSeenAt: now - 181 * day },
  ];
  assert.deepEqual(expiredSeen(records, now, 180).map((r) => r.id), ['oud', 'net-verlopen']);
});

// ── S-04: plafond per feed ─────────────────────────────────────────────────

test('newestFirst: houdt de nieuwste items tot het plafond', () => {
  const pubs = Array.from({ length: 5 }, (_, i) => ({ title: `t${i}`, publishedDate: i }));
  assert.equal(newestFirst(pubs, {}, 10), pubs, 'onder het plafond ongewijzigd');
  assert.deepEqual(newestFirst(pubs, {}, 2).map((p) => p.publishedDate), [4, 3]);
});

// ── S-16: de key gaat alleen naar de host waarvoor hij is ingevuld ──────────

test('S-16: de key gaat alleen naar de gebonden host; elders een fout zonder verzoek', async () => {
  const seen = [];
  const fake = async (url, init) => {
    seen.push([String(url), init.headers.Authorization ?? init.headers['x-api-key'] ?? null]);
    throw new TypeError('Failed to fetch');
  };
  const bound = { ...Connected, model: 'm', directApiKey: 'sk-or-geheim', directApiKeyHost: 'openrouter.ai' };
  await withFetch(fake, async () => {
    await assert.rejects(testConnection(bound), /Netwerkfout/);
    await assert.rejects(testConnection({ ...bound, directBaseUrl: 'https://llm.example.org/v1' }), /hoort bij openrouter\.ai, niet bij llm\.example\.org/);
    await assert.rejects(testConnection({ ...bound, directBaseUrl: 'https://api.anthropic.com/v1' }), /hoort bij openrouter\.ai/);
    // Lokaal model: werkt zonder key, dus het verzoek gaat wél, maar zonder key.
    await assert.rejects(testConnection({ ...bound, directBaseUrl: 'http://192.168.1.20:11434/v1' }), /Netwerkfout/);
    // Ongebonden key (geen host vastgelegd): nergens heen.
    await assert.rejects(testConnection({ ...bound, directApiKeyHost: '' }), /Onbekend bij welk adres/);
  });
  assert.deepEqual(seen, [
    ['https://openrouter.ai/api/v1/chat/completions', 'Bearer sk-or-geheim'],
    ['http://192.168.1.20:11434/v1/chat/completions', null],
  ]);
});

test('S-16: de voorfilter krijgt de key van het taalmodel alleen als die bij de Base-URL hoort', () => {
  const base = {
    ...Connected,
    directApiKey: 'sk-or',
    directApiKeyHost: 'openrouter.ai',
    jevPrefilterEnabled: true,
    prefilterEndpoint: 'https://openrouter.ai/api/alpha/decisions',
  };
  assert.equal(prefilterConnection(base).key, 'sk-or');
  // Base-URL en endpoint op dezelfde vreemde host: de key hoort daar niet.
  const elsewhere = { ...base, directBaseUrl: 'https://ander.example/v1', prefilterEndpoint: 'https://ander.example/decisions' };
  assert.equal(prefilterConnection(elsewhere).key, '');
});
