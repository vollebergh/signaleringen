/**
 * Procescontrole: overleven opgeslagen gegevens een update van de extensie?
 *
 * Bij een update blijft `chrome.storage.local` staan en wordt
 * `chrome.storage.session` gewist. Deze tests zetten opgeslagen gegevens uit
 * oudere versies (test/fixtures/) in een verse opslag, met een lege sessie,
 * en kijken of de huidige code ze nog leest.
 *
 * De fixtures worden NOOIT gewijzigd of opnieuw gegenereerd. Breekt een test
 * hier, dan verliezen gebruikers bij de update hun gegevens: voeg een migratie
 * toe in plaats van de fixture aan te passen. Een nieuw formaat krijgt een
 * eigen, nieuw item in de fixture. Zie DEVELOPMENT.md, *Updates en opgeslagen
 * gegevens*. Draaien met:
 *   node --test test/
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

globalThis.chrome = {
  runtime: {
    id: 'test-extension',
    getManifest: () => ({ version: '0.0.0', update_url: 'https://example.invalid/' }),
    getURL: (path) => `chrome-extension://test-extension/${path}`,
  },
  storage: { local: memoryArea(), session: memoryArea() },
};

const { getSettings } = await import('../src/data/settings-repository.js');
const { getVaultStatus, unlock, withApiKey, VaultLockedError } = await import('../src/data/vault-repository.js');

const fixture = JSON.parse(readFileSync(new URL('./fixtures/vault-formats.json', import.meta.url), 'utf8'));

/** Een opslag zoals na een update: local van de oude versie, session leeg. */
function afterUpdate(storageLocal) {
  chrome.storage.local.data.clear();
  chrome.storage.session.data.clear();
  for (const [k, v] of Object.entries(storageLocal)) chrome.storage.local.data.set(k, structuredClone(v));
}

for (const c of fixture.cases) {
  test(`update: vault ${c.name} (${c.since}) is vergrendeld en gaat open met de wachtwoordzin`, async () => {
    afterUpdate(c.storageLocal);

    assert.deepEqual(await getVaultStatus(), { exists: true, unlocked: false, localFileHasKey: false });
    const settings = await getSettings();
    await assert.rejects(withApiKey(settings), VaultLockedError, 'na een update eerst ontgrendelen');

    await assert.rejects(unlock('verkeerde wachtwoordzin'), /Onjuiste wachtwoordzin/);
    await unlock(fixture.passphrase);

    const keys = await withApiKey(settings);
    assert.equal(keys.directApiKey, c.expected.directApiKey);
    assert.equal(keys.prefilterApiKey ?? '', c.expected.prefilterApiKey);
  });
}

test('update: de opslagsleutel van de vault is niet veranderd', async () => {
  const { VAULT_STORAGE_KEY } = await import('../src/data/settings-repository.js');
  assert.equal(VAULT_STORAGE_KEY, 'vault', 'een andere sleutel laat bestaande vaults onvindbaar achter');
});
