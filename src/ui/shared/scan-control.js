/**
 * Een scan starten vanuit een statusregel, voor de popup en het
 * profieloverzicht (CR-18). Gedeeld is de logica — knop uit, spinner,
 * voortgang, resultaat, afgebroken of gestopt —, niet de opmaak van het vlak
 * eromheen. Het zijpaneel vervangt bij een scan de hele inhoud en houdt zijn
 * eigen variant.
 */

import { Msg, send } from '../../core/messages.js';
import { el, clear, showProgress, explainScanFailure } from './dom.js';

/** Spinner met tekst in de statusregel. */
export function showScanStarting(status, label = 'Scan gestart…') {
  clear(status);
  status.classList.remove('error');
  status.append(el('span', { class: 'spinner' }), el('span', { text: ` ${label}` }));
}

/** Afgebroken scan (B-46): melding plus een knop om opnieuw te scannen. */
export function showInterrupted(status, message, onRetry) {
  clear(status);
  status.classList.add('error');
  status.append(
    el('span', { text: `${message} ` }),
    el('button', { class: 'icon', text: 'Opnieuw scannen', onclick: onRetry }),
  );
}

/**
 * Start een scan, of haakt aan bij de lopende: de worker geeft dan diezelfde
 * run terug. Toont het verloop in `status`.
 *
 * @param {object} options
 * @param {string} options.profileId
 * @param {HTMLButtonElement} options.button  uit tijdens de scan
 * @param {HTMLElement} options.status
 * @param {string} [options.initialLabel]
 * @param {string} options.resultText  tekst van de knop naar het resultaat
 * @param {(scanId: string) => void} options.openResult
 * @param {object} [options.progress]  luister zelf naar de voortgang van deze
 *   scan, met deze opties voor `showProgress`; weglaten als het vlak al een
 *   eigen luisteraar heeft
 */
export async function runScanInStatus({ profileId, button, status, initialLabel, resultText, openResult, progress }) {
  button.disabled = true;
  showScanStarting(status, initialLabel);

  const onProgress = (message) => {
    if (message?.type !== Msg.SCAN_PROGRESS || message.payload.profileId !== profileId) return;
    showProgress(status, message.payload, progress);
  };
  if (progress) chrome.runtime.onMessage.addListener(onProgress);

  const retry = () => runScanInStatus({ profileId, button, status, resultText, openResult, progress });

  try {
    const { scanId, relevantCount } = await send(Msg.START_SCAN, { profileId });
    clear(status);
    status.append(
      el('span', { text: `${relevantCount} relevant · ` }),
      el('button', { class: 'icon', text: resultText, onclick: () => openResult(scanId) }),
    );
  } catch (err) {
    const message = await explainScanFailure(profileId, err);
    if (err.workerStopped) {
      showInterrupted(status, message, retry);
    } else {
      clear(status);
      status.classList.toggle('error', !err.cancelled);
      status.textContent = message;
    }
  } finally {
    if (progress) chrome.runtime.onMessage.removeListener(onProgress);
    button.disabled = false;
  }
}
