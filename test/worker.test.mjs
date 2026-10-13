/**
 * Tests voor de fixes uit de code review van 2026-10-13 (ronde A): de
 * berichtrouter (CR-01), ontdubbelen binnen een scan (CR-02), wat er van de
 * instellingen wordt opgeslagen (CR-03), bladeren bij open.overheid (CR-06)
 * en de time-out van berichten vanuit de UI (CR-08). Draaien met:
 *   node --test test/
 */

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const { createMessageListener } = await import('../src/background/router.js');
const { addFetched } = await import('../src/background/scan-collect.js');
const { dedupeKey } = await import('../src/data/history-repository.js');
const { settingsToStore } = await import('../src/data/settings-repository.js');
const { DefaultSettings } = await import('../src/core/config.js');
const { fetchOpenOverheid } = await import('../src/network/open-overheid.js');
const { Msg, send, SEND_TIMEOUT_MS } = await import('../src/core/messages.js');

/** Roept de listener aan en wacht op het antwoord. */
const OWN_ID = 'eigen-extensie';

function dispatch(listener, message, sender = { id: OWN_ID }) {
  return new Promise((resolve) => {
    const keepsOpen = listener(message, sender, resolve);
    if (!keepsOpen) resolve(undefined);
  });
}

// ── CR-01: router ───────────────────────────────────────────────────────────

test('router: een synchrone handler (zoals parseOpml) geeft gewoon antwoord', async () => {
  const listener = createMessageListener({ sync: ({ n }) => [n, n + 1] }, OWN_ID);
  assert.deepEqual(await dispatch(listener, { type: 'sync', payload: { n: 1 } }), { ok: true, data: [1, 2] });
});

test('router: een asynchrone handler geeft zijn waarde terug', async () => {
  const listener = createMessageListener({ async: async () => 'klaar' }, OWN_ID);
  assert.deepEqual(await dispatch(listener, { type: 'async' }), { ok: true, data: 'klaar' });
});

test('router: een synchrone fout wordt een foutantwoord, geen gesloten kanaal', async () => {
  const listener = createMessageListener(
    {
      boom: () => {
        throw new Error('kapot');
      },
    },
    OWN_ID,
  );
  const response = await dispatch(listener, { type: 'boom' });
  assert.equal(response.ok, false);
  assert.equal(response.error, 'kapot');
  assert.equal(response.cancelled, false);
});

test('router: een gestopte scan (B-45) gaat door als cancelled', async () => {
  const listener = createMessageListener(
    {
      scan: async () => {
        const err = new Error('Scan gestopt');
        err.cancelled = true;
        throw err;
      },
    },
    OWN_ID,
  );
  const response = await dispatch(listener, { type: 'scan' });
  assert.equal(response.cancelled, true);
});

test('router: een onbekend bericht laat het kanaal dicht', () => {
  const listener = createMessageListener({}, OWN_ID);
  assert.equal(listener({ type: 'onbekend' }, { id: OWN_ID }, () => {}), false);
});

test('router: een bericht van een andere afzender wordt genegeerd (S-12)', () => {
  let called = false;
  const listener = createMessageListener({ geheim: () => (called = true) }, OWN_ID);
  assert.equal(listener({ type: 'geheim' }, { id: 'andere-extensie' }, () => {}), false);
  assert.equal(listener({ type: 'geheim' }, {}, () => {}), false);
  assert.equal(called, false);
});

// ── CR-02: ontdubbelen binnen een scan ─────────────────────────────────────

const pub = (url, title = 'Titel') => ({ title, description: '', url, publishedDate: 0, sourceName: 'Bron' });

test('addFetched: hetzelfde artikel uit twee bronnen telt één keer', () => {
  const fetched = [];
  const keys = new Set();
  const seen = new Map();

  const first = addFetched(fetched, [pub('https://a.nl/1'), pub('https://a.nl/2')], seen, keys);
  // Tweede bron levert artikel 1 opnieuw, nu met trackingparameter.
  const second = addFetched(fetched, [pub('https://a.nl/1?utm_source=rss'), pub('https://b.nl/3')], seen, keys);

  assert.deepEqual(first, { added: 2, newCount: 2, duplicates: 0 });
  assert.deepEqual(second, { added: 1, newCount: 1, duplicates: 1 });
  assert.deepEqual(fetched.map((f) => f.publication.url), ['https://a.nl/1', 'https://a.nl/2', 'https://b.nl/3']);
});

test('addFetched: binnen één feed dubbel telt ook één keer', () => {
  const fetched = [];
  const result = addFetched(fetched, [pub('https://a.nl/1'), pub('https://a.nl/1/')], new Map(), new Set());
  assert.deepEqual(result, { added: 1, newCount: 1, duplicates: 1 });
});

test('addFetched: eerder gezien blijft eerder gezien, met het seen-record erbij', () => {
  const record = { key: dedupeKey(pub('https://a.nl/1')), synthesisScanId: 'scan-1' };
  const seen = new Map([[record.key, record]]);
  const fetched = [];
  const result = addFetched(fetched, [pub('https://a.nl/1'), pub('https://a.nl/2')], seen, new Set());
  assert.deepEqual(result, { added: 2, newCount: 1, duplicates: 0 });
  assert.equal(fetched[0].isNew, false);
  assert.equal(fetched[0].seenRecord, record);
  assert.equal(fetched[1].isNew, true);
});

// ── CR-03: alleen afwijkingen opslaan ──────────────────────────────────────

test('settingsToStore: een key uit local-settings.json wordt niet opgeslagen', () => {
  const local = { directApiKey: 'sk-uit-bestand' };
  const next = { ...DefaultSettings, directApiKey: 'sk-uit-bestand', theme: 'dark' };
  assert.deepEqual(settingsToStore(DefaultSettings, local, next), { theme: 'dark' });
});

test('settingsToStore: een lege key wint van het bestand (vault)', () => {
  const local = { directApiKey: 'sk-uit-bestand' };
  const next = { ...DefaultSettings, directApiKey: '' };
  assert.deepEqual(settingsToStore(DefaultSettings, local, next), { directApiKey: '' });
});

test('settingsToStore: een eigen key zonder bestand wordt opgeslagen', () => {
  const next = { ...DefaultSettings, directApiKey: 'sk-eigen' };
  assert.deepEqual(settingsToStore(DefaultSettings, {}, next), { directApiKey: 'sk-eigen' });
});

test('settingsToStore: onbekende sleutels en standaardwaarden vallen weg', () => {
  const next = { ...DefaultSettings, onbekend: 1, synthesisMaxArticles: 25 };
  assert.deepEqual(settingsToStore(DefaultSettings, {}, next), {});
});

// ── CR-06: bladeren bij open.overheid ──────────────────────────────────────

test('fetchOpenOverheid: een resultaat zonder titel stopt het bladeren niet', async () => {
  const item = (n) => ({ document: { titel: n === 3 ? '' : `Document ${n}`, pid: `https://open.overheid.nl/doc/${n}`, openbaarmakingsdatum: '2026-10-01' }, highlightedText: 'fragment' });
  const pages = [
    { totaal: 70, resultaten: Array.from({ length: 50 }, (_, i) => item(i)) },
    { totaal: 70, resultaten: Array.from({ length: 20 }, (_, i) => item(50 + i)) },
  ];
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify(pages[calls.length - 1]), { status: 200 });
  };
  try {
    const source = { name: 'OO', url: 'https://open.overheid.nl/zoeken?zoeken=stikstof', type: 'OPEN_OVERHEID' };
    const result = await fetchOpenOverheid(source, Date.now() - 7 * 86_400_000);
    assert.equal(calls.length, 2, 'tweede pagina opgehaald');
    assert.equal(result.data.length, 69, '70 resultaten min de ene zonder titel');
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ── CR-08: time-out van berichten vanuit de UI ─────────────────────────────

test('send: zonder antwoord volgt na de time-out een duidelijke fout', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.chrome = { runtime: { sendMessage: () => new Promise(() => {}) } };
  try {
    const pending = send(Msg.GET_PROFILE, { profileId: 'x' });
    mock.timers.tick(SEND_TIMEOUT_MS);
    await assert.rejects(pending, (err) => err.timedOut === true && /Geen antwoord/.test(err.message));
  } finally {
    mock.timers.reset();
    delete globalThis.chrome;
  }
});

test('send: een scan heeft geen time-out', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  let answer;
  globalThis.chrome = {
    runtime: { sendMessage: () => new Promise((resolve) => { answer = resolve; }) },
  };
  try {
    const pending = send(Msg.START_SCAN, { profileId: 'x' });
    mock.timers.tick(10 * 60_000);
    answer({ ok: true, data: { scanId: 's' } });
    assert.deepEqual(await pending, { scanId: 's' });
  } finally {
    mock.timers.reset();
    delete globalThis.chrome;
  }
});
