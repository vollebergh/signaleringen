/**
 * Tests voor de scanvoortgang in de sessieopslag (B-46), met een nagebootste
 * `chrome.storage.session`. Draaien met:
 *   node --test test/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const store = {};
const broadcasts = [];
globalThis.chrome = {
  storage: {
    session: {
      async get(key) {
        if (key === null) return { ...store };
        return key in store ? { [key]: store[key] } : {};
      },
      async set(items) {
        Object.assign(store, structuredClone(items));
      },
    },
  },
  runtime: {
    async sendMessage(message) {
      broadcasts.push(message);
    },
  },
};

const { setProgress, getProgress, recoverInterruptedScans } = await import('../src/background/scan-progress.js');

test('voortgang blijft bewaard en telt als lopend', async () => {
  setProgress('a', { phase: 'analyzing', done: 2, total: 5 });
  const state = await getProgress('a');
  assert.equal(state.phase, 'analyzing');
  assert.equal(state.active, true);
  assert.equal(broadcasts.at(-1).payload.profileId, 'a');
});

test('onbekend profiel geeft idle', async () => {
  assert.deepEqual(await getProgress('onbekend'), { phase: 'idle', active: false });
});

test('herstart: lopende scan wordt afgebroken, afgeronde en nog draaiende niet', async () => {
  setProgress('lopend', { phase: 'fetching', current: 1, total: 3 });
  setProgress('klaar', { phase: 'done', scanId: 'x' });
  setProgress('draait', { phase: 'analyzing', done: 0, total: 4 });

  const interrupted = await recoverInterruptedScans((profileId) => profileId === 'draait');
  assert.deepEqual(interrupted.sort(), ['a', 'lopend']);

  const state = await getProgress('lopend');
  assert.equal(state.phase, 'interrupted');
  assert.equal(state.active, false);
  assert.equal(state.interruptedPhase, 'fetching');
  assert.match(state.message, /afgebroken/);

  assert.equal((await getProgress('klaar')).phase, 'done');
  assert.equal((await getProgress('draait')).phase, 'analyzing');
});

test('een nieuwe scan overschrijft de afgebroken status', async () => {
  setProgress('lopend', { phase: 'starting' });
  assert.equal((await getProgress('lopend')).phase, 'starting');
  assert.deepEqual(await recoverInterruptedScans(() => true), []);
});
