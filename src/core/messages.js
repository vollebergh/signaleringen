/**
 * Berichtcontract tussen de UI-vlakken (popup, dashboard, side panel) en de
 * service worker. Alle langlopende operaties draaien in de worker, zodat het
 * sluiten van een popup nooit een scan afbreekt.
 */

export const Msg = Object.freeze({
  // Profielen
  LIST_PROFILES: 'profiles/list',
  GET_PROFILE: 'profiles/get',
  SAVE_PROFILE: 'profiles/save',
  DELETE_PROFILE: 'profiles/delete',
  DUPLICATE_PROFILE: 'profiles/duplicate',
  IMPORT_OPML: 'profiles/importOpml',
  TEST_SOURCE: 'profiles/testSource',
  ADD_PAGE_AS_SOURCE: 'profiles/addPageAsSource',
  GET_SOURCE_OVERVIEW: 'profiles/sourceOverview',

  // Scannen — op verzoek van de gebruiker, of periodiek als dat aan staat
  START_SCAN: 'scan/start',
  SCAN_PROGRESS: 'scan/progress',
  GET_SCAN_STATE: 'scan/state',
  GET_LATEST_SCAN: 'scan/latest',
  GET_SCAN_RESULTS: 'scan/results',
  TOGGLE_BOOKMARK: 'scan/toggleBookmark',
  MARK_AS_READ: 'scan/markAsRead',
  // Antwoord op "doorgaan?" bij een grote scan (B-45)
  CONFIRM_SCAN: 'scan/confirm',
  LIST_BOOKMARKS: 'scan/bookmarks',

  // Syntheses
  LIST_SYNTHESES: 'synthesis/list',
  GET_LATEST_SYNTHESIS: 'synthesis/latest',
  // Ongelezen signaleringen van de automatische synthese (B-54)
  LIST_UNREAD: 'synthesis/unread',
  MARK_SYNTHESIS_READ: 'synthesis/markRead',

  // Export en import
  EXPORT_PROFILES: 'data/export',
  IMPORT_PREVIEW: 'data/importPreview',
  IMPORT_PROFILES: 'data/import',

  // Instellingen
  GET_SETTINGS: 'settings/get',
  SAVE_SETTINGS: 'settings/save',
  TEST_CONNECTION: 'settings/testConnection',
  TEST_PREFILTER: 'settings/testPrefilter',
  APPLY_SCHEDULE: 'settings/applySchedule',

  // Vault voor de API-key (B-49)
  VAULT_STATUS: 'vault/status',
  VAULT_ENABLE: 'vault/enable',
  VAULT_UNLOCK: 'vault/unlock',
  VAULT_LOCK: 'vault/lock',
  VAULT_DISABLE: 'vault/disable',
});

/** Verstuurt een bericht naar de service worker en gooit bij een foutantwoord. */
export async function send(type, payload = {}) {
  let response;
  try {
    response = await chrome.runtime.sendMessage({ type, payload });
  } catch (err) {
    // Stopt de worker terwijl hij nog moet antwoorden, dan sluit Edge het
    // kanaal met een kale Engelse fout (B-46).
    if (/message (channel|port) closed/i.test(err?.message ?? '')) {
      const stopped = new Error('De achtergrondservice van de extensie stopte voordat er antwoord kwam.');
      stopped.workerStopped = true;
      throw stopped;
    }
    throw err;
  }
  if (!response) {
    throw new Error('Geen antwoord van de achtergrondservice');
  }
  if (response.ok === false) {
    const error = new Error(response.error ?? 'Onbekende fout');
    if (response.cancelled) error.cancelled = true;
    throw error;
  }
  return response.data;
}
