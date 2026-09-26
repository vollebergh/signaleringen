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
  LIST_BOOKMARKS: 'scan/bookmarks',

  // Syntheses
  LIST_SYNTHESES: 'synthesis/list',
  GET_LATEST_SYNTHESIS: 'synthesis/latest',

  // Export en import
  EXPORT_PROFILES: 'data/export',
  IMPORT_PREVIEW: 'data/importPreview',
  IMPORT_PROFILES: 'data/import',

  // Instellingen
  GET_SETTINGS: 'settings/get',
  SAVE_SETTINGS: 'settings/save',
  TEST_CONNECTION: 'settings/testConnection',
  APPLY_SCHEDULE: 'settings/applySchedule',
});

/** Verstuurt een bericht naar de service worker en gooit bij een foutantwoord. */
export async function send(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, payload });
  if (!response) {
    throw new Error('Geen antwoord van de achtergrondservice');
  }
  if (response.ok === false) {
    throw new Error(response.error ?? 'Onbekende fout');
  }
  return response.data;
}
