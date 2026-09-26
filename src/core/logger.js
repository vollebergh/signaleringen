/**
 * Minimale leveled logger. Tegenhanger van Timber in de Android-app.
 * Debug-output staat uit zodra de extensie niet meer uitgepakt geladen is,
 * zodat een geïnstalleerde build de console niet volschrijft.
 */

const isUnpacked = (() => {
  try {
    return !('update_url' in chrome.runtime.getManifest());
  } catch {
    return false;
  }
})();

const PREFIX = '[Signaleringen]';

export const log = {
  debug(...args) {
    if (isUnpacked) console.debug(PREFIX, ...args);
  },
  info(...args) {
    console.info(PREFIX, ...args);
  },
  warn(...args) {
    console.warn(PREFIX, ...args);
  },
  error(...args) {
    console.error(PREFIX, ...args);
  },
};
