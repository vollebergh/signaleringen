/**
 * Berichtrouter: koppelt een bericht uit een UI-vlak aan zijn handler en
 * stuurt het antwoord terug als `{ ok, data }` of `{ ok: false, error }`.
 *
 * Los van `service-worker.js`, zodat hij zonder de rest van de worker te
 * testen is (CR-01).
 */

import { log } from '../core/logger.js';

/**
 * @param {Record<string, (payload: any) => any>} handlers per berichttype; een
 *   handler mag een promise of een gewone waarde teruggeven, en mag gooien
 * @param {string} extensionId alleen berichten van deze extensie worden
 *   behandeld (S-12). Zonder content scripts en `externally_connectable` kan
 *   er nu niets anders binnenkomen; dit houdt dat zo als dat ooit verandert.
 * @returns {(message: any, sender: any, sendResponse: (response: any) => void) => boolean}
 */
export function createMessageListener(handlers, extensionId) {
  return (message, sender, sendResponse) => {
    if (sender?.id !== extensionId) return false;
    const handler = handlers[message?.type];
    if (!handler) return false;

    // Via `Promise.resolve().then` wordt ook een synchrone handler (bijv.
    // `parseOpml`) of een synchrone fout een gewoon antwoord. Zonder dat gooit
    // `.then` op een array en sluit het kanaal zonder antwoord (CR-01).
    Promise.resolve()
      .then(() => handler(message.payload ?? {}))
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => {
        if (!err?.cancelled) log.error(`Bericht '${message.type}' mislukt`, err);
        // `cancelled`: de gebruiker stopte een grote scan (B-45) — geen storing.
        sendResponse({ ok: false, error: err?.message ?? String(err), cancelled: Boolean(err?.cancelled) });
      });

    // true houdt het antwoordkanaal open voor de asynchrone afhandeling.
    return true;
  };
}
