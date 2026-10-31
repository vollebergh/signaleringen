/**
 * Migratie naar 0.25.6 (Base-URL, model en routing standaard leeg) voor een
 * installatie die alleen op `local-settings.json` leunt (CR-35): geen
 * opgeslagen instellingen en geen wachtwoordkluis, wel een key in het bestand.
 * Eigen bestand, omdat het lokale bestand per module één keer wordt ingelezen.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.chrome = {
  runtime: { getURL: (path) => `chrome-extension://test-extension/${path}` },
  storage: {
    local: {
      async get(keys) {
        const list = [keys].flat();
        return Object.fromEntries(list.filter((k) => store.has(k)).map((k) => [k, structuredClone(store.get(k))]));
      },
      async set(items) {
        for (const [k, v] of Object.entries(items)) store.set(k, structuredClone(v));
      },
    },
  },
};
globalThis.fetch = async () => ({ ok: true, json: async () => ({ directApiKey: 'sk-uit-bestand' }) });

const { migrateConnectionDefaults, getSettings, isConfigured } = await import('../src/data/settings-repository.js');
const { SuggestedConnection } = await import('../src/core/config.js');

test('migratie: een key alleen in local-settings.json telt als een installatie in gebruik', async () => {
  assert.deepEqual(await migrateConnectionDefaults(), Object.keys(SuggestedConnection));
  const settings = await getSettings();
  assert.equal(settings.directBaseUrl, SuggestedConnection.directBaseUrl);
  assert.equal(settings.directApiKey, 'sk-uit-bestand', 'de key blijft uit het bestand komen');
  assert.equal(await isConfigured(settings), true);
});
