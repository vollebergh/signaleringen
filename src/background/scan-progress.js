/**
 * Scanvoortgang per profiel, bewaard in `chrome.storage.session` (B-46).
 *
 * Een MV3-service-worker kan halverwege een scan sterven (update, geheugendruk,
 * crash). Stond de voortgang alleen in geheugen, dan verloor de UI het spoor:
 * een heropend venster kreeg `idle` en de scan leek nooit te hebben bestaan.
 * Nu blijft "deze scan loopt" bewaard; start de worker opnieuw en staat er
 * een lopende scan die niet meer draait, dan wordt die *afgebroken*.
 *
 * Alle opslag loopt via één wachtrij, zodat het opruimen bij het opstarten
 * altijd vóór de eerste schrijfactie van een nieuwe scan gebeurt.
 */

import { Msg } from '../core/messages.js';
import { log } from '../core/logger.js';

const PREFIX = 'scanProgress:';

/** Fasen waarin een scan klaar is; alle andere betekenen "loopt". */
const FINAL_PHASES = new Set(['idle', 'done', 'error', 'interrupted', 'cancelled']);

export const INTERRUPTED_MESSAGE =
  'De scan is afgebroken: de achtergrondservice van de extensie stopte onderweg. ' +
  'Er is niets verloren gegaan; wat nog niet beoordeeld was, komt bij de volgende scan opnieuw langs.';

let queue = Promise.resolve();

function enqueue(task) {
  const next = queue.then(task);
  queue = next.catch((err) => log.warn('Scanvoortgang opslaan mislukt', err));
  return next;
}

const keyFor = (profileId) => `${PREFIX}${profileId}`;

/** Geen open UI-vlak dat luistert: de gewone toestand, geen fout. */
export const isNoReceiverError = (err) => /Receiving end does not exist/i.test(err?.message ?? '');

function broadcast(profileId, state) {
  chrome.runtime
    .sendMessage({ type: Msg.SCAN_PROGRESS, payload: { profileId, ...state } })
    .catch((err) => {
      if (!isNoReceiverError(err)) log.warn('Scanvoortgang melden mislukt', err);
    });
}

/** Legt de voortgang vast en meldt hem aan open UI-vlakken. */
export function setProgress(profileId, state) {
  const stored = { ...state, active: !FINAL_PHASES.has(state.phase), updatedAt: Date.now() };
  broadcast(profileId, stored);
  // Niet wachten en niet gooien: een mislukte schrijfactie is al gelogd en
  // mag de scan zelf niet hinderen.
  enqueue(() => chrome.storage.session.set({ [keyFor(profileId)]: stored })).catch(() => {});
}

/** @returns {Promise<object>} laatst bekende voortgang, of `{ phase: 'idle' }` */
export function getProgress(profileId) {
  return enqueue(async () => {
    const key = keyFor(profileId);
    const stored = await chrome.storage.session.get(key);
    return stored[key] ?? { phase: 'idle', active: false };
  });
}

/**
 * Markeert achtergebleven lopende scans als afgebroken. Aan te roepen bij het
 * laden van de worker; `isRunning` sluit scans uit die intussen al gestart zijn.
 * @param {(profileId: string) => boolean} isRunning
 * @returns {Promise<string[]>} profiel-id's waarvan de scan afgebroken is
 */
export function recoverInterruptedScans(isRunning) {
  return enqueue(async () => {
    const all = await chrome.storage.session.get(null);
    const updates = {};
    for (const [key, state] of Object.entries(all)) {
      if (!key.startsWith(PREFIX) || !state?.active) continue;
      const profileId = key.slice(PREFIX.length);
      if (isRunning(profileId)) continue;
      updates[key] = {
        phase: 'interrupted',
        message: INTERRUPTED_MESSAGE,
        interruptedPhase: state.phase,
        active: false,
        updatedAt: Date.now(),
      };
    }

    const profileIds = Object.keys(updates).map((key) => key.slice(PREFIX.length));
    if (profileIds.length === 0) return profileIds;

    await chrome.storage.session.set(updates);
    for (const profileId of profileIds) {
      log.warn(`Scan voor ${profileId} afgebroken door een herstart van de service worker`);
      broadcast(profileId, updates[keyFor(profileId)]);
    }
    return profileIds;
  });
}
