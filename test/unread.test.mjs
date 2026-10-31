/**
 * Tests voor de ongelezen-status van de automatische synthese en de
 * badgetekst (B-54), met een nagebootste `chrome.storage.local`. Draaien met:
 *   node --test test/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const store = {};
globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        return key in store ? { [key]: structuredClone(store[key]) } : {};
      },
      async set(items) {
        Object.assign(store, structuredClone(items));
      },
    },
  },
};

const { getUnread, markUnread, markRead, forget } = await import('../src/data/unread-repository.js');
const { badgeText, badgeTitle, updateBadge, LOCKED_BADGE_TEXT } = await import('../src/background/badge.js');

test('zonder opgeslagen status is er niets ongelezen', async () => {
  assert.deepEqual(await getUnread(), {});
});

test('markUnread houdt per profiel alleen de nieuwste bij', async () => {
  await markUnread('p1', 'scan-a', 100);
  await markUnread('p1', 'scan-b', 200);
  await markUnread('p2', 'scan-c', 150);
  assert.deepEqual(await getUnread(), {
    p1: { scanId: 'scan-b', createdAt: 200 },
    p2: { scanId: 'scan-c', createdAt: 150 },
  });
});

test('een oudere signalering bekijken laat de nieuwere ongelezen', async () => {
  assert.equal(await markRead('p1', 100), false);
  assert.ok((await getUnread()).p1);
});

test('de ongelezen of een nieuwere signalering bekijken maakt hem gelezen', async () => {
  assert.equal(await markRead('p1', 200), true);
  assert.equal((await getUnread()).p1, undefined);
  assert.equal(await markRead('p2', 300), true);
  assert.deepEqual(await getUnread(), {});
});

test('markRead zonder datum en op een gelezen profiel', async () => {
  await markUnread('p3', 'scan-d', 400);
  assert.equal(await markRead('p3'), true);
  assert.equal(await markRead('p3'), false);
});

test('forget ruimt verdwenen profielen op', async () => {
  await markUnread('p4', 'scan-e', 1);
  await markUnread('p5', 'scan-f', 2);
  await forget(['p4']);
  assert.deepEqual(Object.keys(await getUnread()), ['p5']);
});

test('badgetekst en titel', () => {
  assert.equal(badgeText(0), '');
  assert.equal(badgeText(3), '3');
  assert.equal(badgeText(120), '99+');
  assert.equal(badgeTitle(0), 'Signaleringen');
  assert.match(badgeTitle(1), /1 profiel met/);
  assert.match(badgeTitle(2), /2 profielen met/);
});

test('slotje op het pictogram zolang de wachtwoordkluis vergrendeld is', async () => {
  const session = {};
  const badge = { text: null, title: null };
  chrome.runtime = { getURL: (path) => `chrome-extension://test-extension/${path}` };
  chrome.storage.session = {
    async get(key) {
      return key in session ? { [key]: session[key] } : {};
    },
    async set(items) {
      Object.assign(session, items);
    },
  };
  chrome.action = {
    async setBadgeText({ text }) {
      badge.text = text;
    },
    async setTitle({ title }) {
      badge.title = title;
    },
    async setBadgeBackgroundColor() {},
  };
  // Standaardinstellingen: route 'direct', geen leesbare key; de kluis ligt er wel.
  store.settings = { transport: 'direct', directApiKey: '', directBaseUrl: 'https://openrouter.ai/api/v1' };
  store.vault = { version: 1 };
  for (const k of Object.keys(store)) if (k.startsWith('unread')) delete store[k];

  await updateBadge();
  assert.equal(badge.text, LOCKED_BADGE_TEXT);
  assert.match(badge.title, /wachtwoordkluis vergrendeld/);

  session.vaultSessionKey = 'sleutel';
  await updateBadge();
  assert.equal(badge.text, '');
  assert.equal(badge.title, 'Signaleringen');

  delete session.vaultSessionKey;
  store.settings.directBaseUrl = 'http://localhost:11434/v1';
  await updateBadge();
  assert.equal(badge.text, '', 'een lokaal model heeft geen key nodig');
});

test('titel bij vergrendelde kluis noemt ook een nieuwe signalering', () => {
  assert.match(badgeTitle(2, true), /vergrendeld.*2 profielen met een nieuwe signalering/);
  assert.equal(badgeTitle(0, false), 'Signaleringen');
});
