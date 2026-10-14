/**
 * Tests voor de scan als geheel (CR-23, punt 2 en 3): `runScan` tegen een
 * echte IndexedDB (`fake-indexeddb`), met nagebootste `chrome.*`, feeds en
 * taalmodel. Legt het gedrag vast vóór de structuurwijzigingen van ronde C
 * (CR-15 knipt `executeScan` in fasen): wat er wordt opgeslagen, in welke
 * volgorde, en wat als "gezien" telt.
 *
 * Draaien met (eenmalig `npm ci` voor fake-indexeddb):
 *   node --test test/
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

// ── Nagebootste browser ─────────────────────────────────────────────────────

function memoryArea() {
  const data = new Map();
  return {
    data,
    async get(keys) {
      if (keys == null) return Object.fromEntries(data);
      const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      return Object.fromEntries(list.filter((k) => data.has(k)).map((k) => [k, structuredClone(data.get(k))]));
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) data.set(k, structuredClone(v));
    },
    async remove(keys) {
      for (const k of [keys].flat()) data.delete(k);
    },
  };
}

const progressMessages = [];
globalThis.chrome = {
  runtime: {
    id: 'test-extension',
    // Met update_url: de logger schrijft dan geen debugregels.
    getManifest: () => ({ version: '0.0.0', update_url: 'https://example.invalid/' }),
    getURL: (path) => `chrome-extension://test-extension/${path}`,
    getPlatformInfo: async () => ({}),
    async sendMessage(message) {
      progressMessages.push(message.payload);
      throw new Error('Could not establish connection. Receiving end does not exist.');
    },
  },
  storage: { local: memoryArea(), session: memoryArea() },
  permissions: { contains: async () => true },
  action: {
    setBadgeText: async () => {},
    setTitle: async () => {},
    setBadgeBackgroundColor: async () => {},
  },
};

// ── Nagebootst netwerk: feeds en taalmodel ─────────────────────────────────

const HOUR = 60 * 60 * 1000;
const feeds = new Map(); // url → { status, items }
const llm = { calls: [], synthesisFails: false };

function rss(items) {
  const entries = items
    .map(
      (item) =>
        `<item><title>${item.title}</title><link>${item.link}</link>` +
        `<description>${item.title} – tekst</description>` +
        `<pubDate>${new Date(item.date ?? Date.now() - HOUR).toUTCString()}</pubDate></item>`,
    )
    .join('');
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${entries}</channel></rss>`;
}

/** Oordeel op de titel: "relevant" → 90, "onleesbaar" → geen bruikbaar antwoord, anders 10. */
function judge(user) {
  const blocks = [...user.matchAll(/<publicatie nr="(\d+)"[^>]*>([\s\S]*?)<\/publicatie/g)];
  if (blocks.some(([, , body]) => body.includes('onleesbaar'))) return 'Daar kan ik niets over zeggen.';
  return JSON.stringify(
    blocks.map(([, nr, body]) => ({
      index: Number(nr),
      score: body.includes('relevant') ? 90 : 10,
      samenvatting: `samenvatting ${nr}`,
    })),
  );
}

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url.startsWith('chrome-extension://')) return new Response('', { status: 404 });
  if (url.startsWith('https://openrouter.ai/') || url.startsWith('http://localhost:11434/')) {
    const body = JSON.parse(init.body);
    const user = body.messages[1].content;
    const isFilter = user.startsWith('Beoordeel de volgende publicaties');
    llm.calls.push({ kind: isFilter ? 'filter' : 'synthesis', user });
    if (!isFilter && llm.synthesisFails) {
      return new Response(JSON.stringify({ error: { message: 'kapot' } }), { status: 400 });
    }
    const content = isFilter ? judge(user) : 'Er gebeurde iets [1].';
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), {
      headers: { 'content-type': 'application/json' },
    });
  }
  const feed = feeds.get(url);
  if (!feed) return new Response('niet gevonden', { status: 404 });
  return new Response(rss(feed.items), { headers: { 'content-type': 'application/rss+xml; charset=utf-8' } });
};

// ── Modules pas na de nabootsing laden ─────────────────────────────────────

const { AppConfig, DefaultSettings } = await import('../src/core/config.js');
const { createProfile } = await import('../src/core/models.js');
const { saveSettings } = await import('../src/data/settings-repository.js');
const { saveProfile } = await import('../src/data/profile-repository.js');
const { getScansForProfile, getPublicationsForScan, getSynthesis } = await import('../src/data/scan-repository.js');
const { loadSeen, recordSeen, refreshSeen, pruneSeen, markSynthesised } = await import('../src/data/history-repository.js');
const { getUnread } = await import('../src/data/unread-repository.js');
const { runScan, synthesizeScan } = await import('../src/background/scan-runner.js');
const { Store, transaction } = await import('../src/data/db.js');

await saveSettings({ directApiKey: 'sk-test' });

let feedCounter = 0;
function feed(items, status = 200) {
  feedCounter += 1;
  const url = `https://feed${feedCounter}.example/rss`;
  feeds.set(url, { status, items });
  return url;
}

async function profileWith(sourceUrls, partial = {}) {
  const profile = createProfile({
    name: `Test ${feedCounter}`,
    userQuery: 'iets relevants',
    sources: sourceUrls.map((url, i) => ({ name: `Bron ${i + 1}`, url })),
    ...partial,
  });
  await saveProfile(profile);
  return profile;
}

const item = (slug, title = slug) => ({ title, link: `https://nieuws.example/${slug}` });

// ── CR-23 punt 2: executeScan ──────────────────────────────────────────────

test('scan: ophalen, ontdubbelen over bronnen, beoordelen, opslaan en synthese', async () => {
  const a = feed([item('a1', 'a1 relevant'), item('gedeeld', 'gedeeld relevant'), item('a2')]);
  // In bron 2 staat "gedeeld" ook, en a1 via een campagne-URL (zelfde dedupeKey).
  const b = feed([item('gedeeld', 'gedeeld relevant'), item('b1'), { title: 'a1 relevant', link: 'https://nieuws.example/a1?utm_source=rss' }]);
  const profile = await profileWith([a, b]);
  llm.calls.length = 0;

  const outcome = await runScan(profile.id);

  assert.deepEqual(
    { totalFetched: outcome.totalFetched, newCount: outcome.newCount, relevantCount: outcome.relevantCount },
    { totalFetched: 4, newCount: 4, relevantCount: 2 },
  );
  // Eén beoordelingsronde met vier publicaties, één synthese.
  assert.deepEqual(llm.calls.map((c) => c.kind), ['filter', 'synthesis']);
  assert.equal([...llm.calls[0].user.matchAll(/<publicatie nr=/g)].length, 4);

  const [scan] = await getScansForProfile(profile.id);
  assert.equal(scan.id, outcome.scanId);
  assert.deepEqual(
    scan.sourceStatuses.map((s) => [s.success, s.publicationCount, s.newCount]),
    [[true, 3, 3], [true, 3, 1]],
    'per bron telt opgehaald gewoon; nieuw alleen wat nog niet in deze scan zat',
  );
  const publications = await getPublicationsForScan(scan.id);
  assert.equal(publications.length, 4);
  assert.equal(new Set(publications.map((p) => p.dedupeKey)).size, 4, 'geen publicatie dubbel opgeslagen');

  const synthesis = await getSynthesis(scan.id);
  assert.equal(synthesis.text, 'Er gebeurde iets [1].');
  assert.deepEqual(synthesis.selection, { used: 2, relevant: 2 });
  assert.deepEqual(synthesis.warnings, []);

  const seen = await loadSeen(profile.id);
  assert.equal(seen.size, 4);
  const synthesised = [...seen.values()].filter((r) => r.synthesisScanId === scan.id).map((r) => r.title).sort();
  assert.deepEqual(synthesised, ['a1 relevant', 'gedeeld relevant']);
  for (const record of seen.values()) assert.equal(typeof record.lastSeenAt, 'number');

  // Handmatige scan: geen ongelezen-teller (B-54).
  assert.equal((await getUnread())[profile.id], undefined);
  assert.equal(progressMessages.at(-1).phase, 'done');
});

test('scan: een tweede scan met alleen nieuwe publicaties vraagt het model niets', async () => {
  const a = feed([item('c1', 'c1 relevant'), item('c2')]);
  const profile = await profileWith([a]);
  await runScan(profile.id);
  llm.calls.length = 0;

  const outcome = await runScan(profile.id);

  assert.deepEqual({ newCount: outcome.newCount, relevantCount: outcome.relevantCount, totalFetched: outcome.totalFetched }, {
    newCount: 0,
    relevantCount: 0,
    totalFetched: 2,
  });
  assert.equal(llm.calls.length, 0);
  const scans = await getScansForProfile(profile.id);
  assert.equal(scans.length, 2);
  assert.equal((await getPublicationsForScan(outcome.scanId)).length, 0);
});

test('scan: "gezien" pas ná het filter — zonder oordeel komt een publicatie de volgende keer terug', async () => {
  const a = feed([item('d1', 'd1 onleesbaar'), item('d2', 'd2 onleesbaar')]);
  const profile = await profileWith([a]);
  llm.calls.length = 0;

  const first = await runScan(profile.id);

  assert.equal(llm.calls.filter((c) => c.kind === 'filter').length, AppConfig.LLM_PARSE_ATTEMPTS, 'opnieuw gevraagd');
  assert.equal(first.relevantCount, 0);
  assert.equal((await loadSeen(profile.id)).size, 0, 'niets als gezien vastgelegd');
  const [scan] = await getScansForProfile(profile.id);
  assert.equal(scan.unjudgedCount, 2);

  // Nu geeft het model wel antwoord: de volgende scan biedt ze opnieuw aan.
  feeds.get(a).items = [item('d1', 'd1 relevant'), item('d2', 'd2')];
  const second = await runScan(profile.id);
  assert.equal(second.newCount, 2);
  assert.equal(second.relevantCount, 1);
  assert.equal((await loadSeen(profile.id)).size, 2);
});

test('scan: een mislukte bron houdt de rest niet tegen', async () => {
  const good = feed([item('e1', 'e1 relevant')]);
  const bad = feed([], 404);
  feeds.delete(bad); // 404 van de nagebootste server
  const profile = await profileWith([bad, good]);

  const outcome = await runScan(profile.id);

  assert.equal(outcome.relevantCount, 1);
  const [scan] = await getScansForProfile(profile.id);
  assert.equal(scan.sourceStatuses[0].success, false);
  assert.match(scan.sourceStatuses[0].errorMessage, /HTTP 404/);
  assert.equal(scan.sourceStatuses[1].success, true);
});

test('scan: een mislukte synthese laat de beoordeelde publicaties staan', async () => {
  const a = feed([item('f1', 'f1 relevant'), item('f2')]);
  const profile = await profileWith([a]);
  llm.synthesisFails = true;
  try {
    const outcome = await runScan(profile.id);
    assert.equal(outcome.relevantCount, 1);
    const synthesis = await getSynthesis(outcome.scanId);
    assert.equal(synthesis.text, '');
    assert.match(synthesis.error, /400/);
    assert.equal((await getPublicationsForScan(outcome.scanId)).length, 2, 'scan is vóór de synthese opgeslagen');
    const seen = await loadSeen(profile.id);
    assert.equal(seen.size, 2);
    assert.ok([...seen.values()].every((r) => r.synthesisScanId === null), 'niet als verwerkt gemarkeerd');
  } finally {
    llm.synthesisFails = false;
  }
});

test('scan: een automatische scan zet de signalering op ongelezen (B-54)', async () => {
  const a = feed([item('g1', 'g1 relevant')]);
  const profile = await profileWith([a]);

  const outcome = await runScan(profile.id, { automatic: true });

  assert.equal((await getUnread())[profile.id]?.scanId, outcome.scanId);
});

test('scan: twee keer starten geeft dezelfde lopende scan', async () => {
  const a = feed([item('h1')]);
  const profile = await profileWith([a]);

  const [one, two] = await Promise.all([runScan(profile.id), runScan(profile.id)]);

  assert.equal(one.scanId, two.scanId);
  assert.equal((await getScansForProfile(profile.id)).length, 1);
});

test('scan: zonder bronnen of zonder toestemming stopt de scan vóór het ophalen', async () => {
  const empty = await profileWith([]);
  await assert.rejects(runScan(empty.id), /nog geen bronnen/);
  assert.equal(progressMessages.at(-1).phase, 'error');

  const a = feed([item('i1')]);
  const profile = await profileWith([a]);
  const real = chrome.permissions.contains;
  chrome.permissions.contains = async () => false;
  try {
    await assert.rejects(runScan(profile.id), /Geen toestemming voor 1 host/);
    assert.deepEqual(progressMessages.at(-1).blockedOrigins, ['https://feed' + feedCounter + '.example/*']);
  } finally {
    chrome.permissions.contains = real;
  }
  assert.equal((await getScansForProfile(profile.id)).length, 0);
});

// ── B-74: signalering alsnog opstellen ─────────────────────────────────────

test('synthesizeScan: zonder signalering (browser dicht tijdens het opstellen) alsnog opstellen', async () => {
  const a = feed([item('j1', 'j1 relevant'), item('j2', 'j2 relevant'), item('j3')]);
  const profile = await profileWith([a]);
  const { scanId } = await runScan(profile.id);
  // Zoals na het sluiten van de browser in de synthesefase: de scan staat er,
  // de signalering niet. (Dat "verwerkt" klopt, dekt de test hieronder.)
  await transaction(Store.SYNTHESES, 'readwrite', (store) => store.delete(scanId));
  llm.calls.length = 0;

  const outcome = await synthesizeScan(profile.id, scanId);

  assert.deepEqual(outcome, { scanId, relevantCount: 2, error: null });
  assert.deepEqual(llm.calls.map((c) => c.kind), ['synthesis'], 'alleen de synthese, niet opnieuw beoordelen');
  const synthesis = await getSynthesis(scanId);
  assert.equal(synthesis.text, 'Er gebeurde iets [1].');
  assert.deepEqual(synthesis.selection, { used: 2, relevant: 2 });
  assert.equal((await getUnread())[profile.id], undefined, 'op verzoek: niet op ongelezen');
  assert.equal(progressMessages.at(-1).phase, 'done');
  assert.equal((await getScansForProfile(profile.id)).length, 1, 'geen nieuwe scan');

  await assert.rejects(synthesizeScan(profile.id, scanId), /al een signalering/);
});

test('synthesizeScan: na een mislukte synthese opnieuw proberen markeert als verwerkt', async () => {
  const a = feed([item('k1', 'k1 relevant'), item('k2')]);
  const profile = await profileWith([a]);
  llm.synthesisFails = true;
  let scanId;
  try {
    ({ scanId } = await runScan(profile.id));
    const failed = await synthesizeScan(profile.id, scanId);
    assert.match(failed.error, /400/);
    assert.match((await getSynthesis(scanId)).error, /400/);
  } finally {
    llm.synthesisFails = false;
  }

  const outcome = await synthesizeScan(profile.id, scanId);

  assert.equal(outcome.error, null);
  const synthesis = await getSynthesis(scanId);
  assert.equal(synthesis.text, 'Er gebeurde iets [1].');
  assert.equal(synthesis.error, undefined);
  const synthesised = [...(await loadSeen(profile.id)).values()].filter((r) => r.synthesisScanId === scanId);
  assert.deepEqual(synthesised.map((r) => r.title), ['k1 relevant']);
});

test('synthesizeScan: niet tijdens een scan, niet zonder relevante publicaties, niet voor een ander profiel', async () => {
  const a = feed([item('l1')]);
  const profile = await profileWith([a]);
  const { scanId } = await runScan(profile.id);
  await assert.rejects(synthesizeScan(profile.id, scanId), /geen relevante publicaties/);
  await assert.rejects(synthesizeScan('ander-profiel', scanId), /Scan niet gevonden/);

  const pending = runScan(profile.id);
  await assert.rejects(synthesizeScan(profile.id, scanId), /loopt al een scan/);
  await pending;
});

// ── CR-23 punt 3: seen-administratie tegen een echte store ─────────────────

test('recordSeen: bestaande records blijven staan, firstSeenAt verschuift niet', async () => {
  const profileId = 'seen-profiel';
  await recordSeen(profileId, 'scan-1', [{ key: 'url:x', url: 'https://x', title: 'X' }]);
  const first = (await loadSeen(profileId)).get('url:x');

  await recordSeen(profileId, 'scan-2', [
    { key: 'url:x', url: 'https://x', title: 'X anders' },
    { key: 'url:y', url: 'https://y', title: 'Y' },
  ]);

  const seen = await loadSeen(profileId);
  assert.equal(seen.size, 2);
  assert.deepEqual(seen.get('url:x'), first);
  assert.equal(seen.get('url:y').firstScanId, 'scan-2');
});

test('markSynthesised: alleen de eerste synthese telt', async () => {
  const profileId = 'synth-profiel';
  await recordSeen(profileId, 'scan-1', [{ key: 'url:z', title: 'Z' }]);
  await markSynthesised(profileId, 'scan-1', ['url:z', 'url:bestaat-niet']);
  await markSynthesised(profileId, 'scan-2', ['url:z']);
  assert.equal((await loadSeen(profileId)).get('url:z').synthesisScanId, 'scan-1');
});

test('refreshSeen en pruneSeen: weg na 180 dagen niet meer gezien, alleen voor dit profiel', async () => {
  const day = 24 * HOUR;
  const now = Date.now();
  await recordSeen('prune-a', 's', [{ key: 'url:oud' }, { key: 'url:terug' }, { key: 'url:vers' }]);
  await recordSeen('prune-b', 's', [{ key: 'url:oud' }]);

  // 200 dagen later: "terug" stond weer in een bron, de rest niet.
  const later = now + 200 * day;
  const seenA = await loadSeen('prune-a');
  assert.equal(await refreshSeen([seenA.get('url:terug')], later), 1);
  // "vers" is net gezien binnen de termijn: een refresh binnen SEEN_REFRESH_MS doet niets.
  assert.equal(await refreshSeen([seenA.get('url:vers')], now), 0);

  assert.equal(await pruneSeen('prune-a', later), 2);
  assert.deepEqual([...(await loadSeen('prune-a')).keys()], ['url:terug']);
  assert.equal((await loadSeen('prune-b')).size, 1, 'ander profiel ongemoeid');
  assert.equal(await pruneSeen('prune-a', later), 0);
});

// ── Vault en instellingen samen (CR-16 splitst ze) ────────────────────────

test('vault: aanzetten, vergrendelen, ontgrendelen en opheffen', async () => {
  const { getSettings, isConfigured } = await import('../src/data/settings-repository.js');
  const { enableVault, lock, unlock, disableVault, withApiKey, getVaultStatus, VaultLockedError } = await import(
    '../src/data/vault-repository.js'
  );
  await saveSettings({ directApiKey: 'sk-vault' });

  await enableVault('lange wachtwoordzin');
  const stored = await getSettings();
  assert.equal(stored.directApiKey, '', 'key niet meer leesbaar in de instellingen');
  assert.equal(await isConfigured(stored), true, 'een vault telt als geconfigureerd');
  assert.equal((await withApiKey(stored)).directApiKey, 'sk-vault');

  await lock();
  assert.deepEqual(await getVaultStatus(), { exists: true, unlocked: false, localFileHasKey: false });
  await assert.rejects(withApiKey(stored), VaultLockedError);

  await unlock('lange wachtwoordzin');
  await disableVault();
  assert.equal((await getSettings()).directApiKey, 'sk-vault');
  assert.equal((await getVaultStatus()).exists, false);
  await saveSettings({ directApiKey: 'sk-test' });
});

// ── Planner en vault (CR-18) ───────────────────────────────────────────────

test('planner: een vergrendelde vault houdt een lokaal model niet tegen, OpenRouter wel', async () => {
  const { enableVault, lock, unlock, disableVault } = await import('../src/data/vault-repository.js');
  const { runDueScans } = await import('../src/background/scheduler.js');
  const a = feed([item('j1', 'j1 relevant')]);
  const profile = await profileWith([a], { autoScanEnabled: true, autoScanIntervalMinutes: 60 });

  await saveSettings({ directApiKey: 'sk-vault' });
  await enableVault('lange wachtwoordzin');
  await lock();
  try {
    await saveSettings({ autoScanEnabled: true });
    assert.deepEqual(await runDueScans(), { ran: 0, skipped: 'locked' });

    await saveSettings({ directBaseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:3b' });
    const outcome = await runDueScans();
    assert.equal(outcome.ran, 1);
    assert.equal((await getScansForProfile(profile.id)).length, 1);
  } finally {
    await saveSettings({ autoScanEnabled: false, directBaseUrl: DefaultSettings.directBaseUrl, model: DefaultSettings.model });
    await unlock('lange wachtwoordzin');
    await disableVault();
    await saveSettings({ directApiKey: 'sk-test' });
  }
});
