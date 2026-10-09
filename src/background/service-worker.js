/**
 * Service worker — het enige langlevende onderdeel van de extensie.
 *
 * Verantwoordelijkheden:
 *   - alle berichten van popup, dashboard en side panel afhandelen;
 *   - scans draaien, op verzoek van de gebruiker of periodiek;
 *   - het contextmenu en het side panel bedienen.
 *
 * Standaard start een scan alleen door een klik. Zet je automatisch
 * synthetiseren aan, dan komt daar een alarm bij — de `alarms`-permissie is
 * optioneel en wordt pas op dat moment gevraagd. Meldingen vraagt de extensie
 * niet: wat de automaat oplevert zie je bij het openen van de extensie.
 *
 * De UI-vlakken bevatten zelf geen netwerk- of opslaglogica. Dat houdt de
 * popup wegwerpbaar: hem sluiten breekt nooit een lopende scan af.
 */

import { Msg } from '../core/messages.js';
import { log } from '../core/logger.js';
import { createProfile, createSource, SourceType } from '../core/models.js';
import { Result } from '../core/result.js';

import * as profiles from '../data/profile-repository.js';
import * as scans from '../data/scan-repository.js';
import { getSourceOverview } from '../data/history-repository.js';
import {
  getSettings,
  saveSettings,
  withApiKey,
  getVaultStatus,
  enableVault,
  unlock,
  lock,
  disableVault,
} from '../data/settings-repository.js';
import { exportProfiles, exportFilename, previewImport, importProfiles } from '../data/transfer-repository.js';

import { fetchPublications } from '../network/feed-fetcher.js';
import { testConnection } from '../network/llm-client.js';

import { runScan, getProgress, isScanning } from './scan-runner.js';
import { applySchedule, runDueScans, ALARM_NAME } from './scheduler.js';
import { parseOpml } from './opml.js';

// ── Levenscyclus ────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  log.info(`Geïnstalleerd/bijgewerkt: ${details.reason}`);
  registerContextMenus();
  applySchedule().catch((err) => log.warn('Planner instellen mislukt', err));
});

chrome.runtime.onStartup.addListener(() => {
  registerContextMenus();
  applySchedule().catch((err) => log.warn('Planner instellen mislukt', err));
});

// De permissie kan buiten de instellingen om worden ingetrokken (via
// edge://extensions). Dan moet het alarm mee verdwijnen.
chrome.permissions.onRemoved?.addListener((removed) => {
  if (removed.permissions?.includes('alarms')) {
    log.info('alarms-permissie ingetrokken, planner gestopt');
  }
});

chrome.permissions.onAdded?.addListener((added) => {
  if (added.permissions?.includes('alarms')) {
    applySchedule().catch((err) => log.warn('Planner instellen mislukt', err));
  }
});

// `chrome.alarms` bestaat alleen zodra de optionele permissie verleend is.
if (chrome.alarms) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM_NAME) return;
    runDueScans().catch((err) => log.error('Automatische synthese mislukt', err));
  });
}

// Klik op het extensiepictogram opent de popup; het side panel is los te openen.
if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
}

// ── Contextmenu ─────────────────────────────────────────────────────────────

const MENU_ADD_PAGE = 'signaleringen-pagina-als-bron';
const MENU_ADD_SELECTION = 'signaleringen-selectie';

function registerContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ADD_PAGE,
      title: 'Deze pagina toevoegen als bron…',
      contexts: ['page', 'link'],
    });
    chrome.contextMenus.create({
      id: MENU_ADD_SELECTION,
      title: 'Selectie signaleren…',
      contexts: ['selection'],
    });
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // De keuze van het profiel gebeurt in het dashboard, niet hier: een
  // contextmenu mag geen stille wijziging aan opgeslagen data maken.
  const params = new URLSearchParams();

  if (info.menuItemId === MENU_ADD_PAGE) {
    params.set('bronUrl', info.linkUrl ?? info.pageUrl ?? tab?.url ?? '');
    params.set('bronNaam', tab?.title ?? '');
  } else if (info.menuItemId === MENU_ADD_SELECTION) {
    params.set('selectie', (info.selectionText ?? '').slice(0, 2000));
    params.set('bronUrl', info.pageUrl ?? tab?.url ?? '');
    params.set('bronNaam', tab?.title ?? '');
  } else {
    return;
  }

  await chrome.tabs.create({
    url: chrome.runtime.getURL(`src/ui/dashboard/dashboard.html?${params}#bron-toevoegen`),
  });
});

// ── Berichtafhandeling ──────────────────────────────────────────────────────

/** @type {Record<string, (payload: any) => Promise<any>>} */
const handlers = {
  [Msg.LIST_PROFILES]: () => profiles.loadProfiles(),

  [Msg.GET_PROFILE]: ({ profileId }) => profiles.getProfile(profileId),

  [Msg.SAVE_PROFILE]: ({ profile }) => profiles.saveProfile(createProfile(profile)),

  [Msg.DELETE_PROFILE]: async ({ profileId }) => {
    await profiles.deleteProfile(profileId);
    return true;
  },

  [Msg.DUPLICATE_PROFILE]: ({ profileId }) => profiles.duplicateProfile(profileId),

  [Msg.IMPORT_OPML]: ({ content }) => parseOpml(content),

  [Msg.TEST_SOURCE]: async ({ source }) => {
    const result = await fetchPublications(createSource(source), 0);
    return Result.isSuccess(result)
      ? { ok: true, count: result.data.length }
      : { ok: false, message: Result.message(result) };
  },

  [Msg.GET_SOURCE_OVERVIEW]: async ({ profileId }) => {
    const profile = await profiles.getProfile(profileId);
    if (!profile) throw new Error('Profiel niet gevonden');
    return getSourceOverview(profile);
  },

  [Msg.ADD_PAGE_AS_SOURCE]: async ({ profileId, url, name, type }) => {
    const profile = await profiles.getProfile(profileId);
    if (!profile) throw new Error('Profiel niet gevonden');
    if (profile.sources.some((s) => s.url === url)) {
      return { profile, added: false };
    }
    profile.sources.push(createSource({ url, name, type: type ?? SourceType.WEB }));
    const saved = await profiles.saveProfile(profile);
    return { profile: saved, added: true };
  },

  [Msg.START_SCAN]: ({ profileId, sourceIds }) => runScan(profileId, { sourceIds }),

  [Msg.GET_SCAN_STATE]: ({ profileId }) => ({
    ...getProgress(profileId),
    isScanning: isScanning(profileId),
  }),

  [Msg.GET_LATEST_SCAN]: async ({ profileId }) => {
    const scan = await scans.getLatestScan(profileId);
    return scan ? scans.getScanResults(scan.id) : null;
  },

  [Msg.GET_SCAN_RESULTS]: ({ scanId }) => scans.getScanResults(scanId),

  [Msg.TOGGLE_BOOKMARK]: ({ publicationId, bookmarked }) =>
    scans.setBookmarked(publicationId, bookmarked),

  [Msg.MARK_AS_READ]: ({ publicationId }) => scans.markAsRead(publicationId),

  [Msg.LIST_BOOKMARKS]: () => scans.getBookmarkedPublications(),

  [Msg.LIST_SYNTHESES]: ({ profileId }) => scans.getSynthesesForProfile(profileId),

  [Msg.GET_LATEST_SYNTHESIS]: ({ profileId }) => scans.getLatestSynthesis(profileId),

  [Msg.EXPORT_PROFILES]: async ({ profileIds }) => {
    const bundle = await exportProfiles(profileIds);
    return { bundle, filename: exportFilename(bundle) };
  },

  [Msg.IMPORT_PREVIEW]: ({ bundle }) => previewImport(bundle),

  [Msg.IMPORT_PROFILES]: ({ bundle, profileIds, mode }) =>
    importProfiles(bundle, { profileIds, mode }),

  [Msg.GET_SETTINGS]: () => getSettings(),

  [Msg.SAVE_SETTINGS]: async ({ patch }) => {
    const next = await saveSettings(patch);
    await applySchedule();
    return next;
  },

  [Msg.APPLY_SCHEDULE]: () => applySchedule(),

  [Msg.TEST_CONNECTION]: async ({ route } = {}) => {
    const settings = await withApiKey(await getSettings());
    return testConnection(settings, route);
  },

  [Msg.VAULT_STATUS]: () => getVaultStatus(),
  [Msg.VAULT_ENABLE]: ({ passphrase }) => enableVault(passphrase),
  [Msg.VAULT_UNLOCK]: async ({ passphrase }) => {
    await unlock(passphrase);
    await applySchedule();
  },
  [Msg.VAULT_LOCK]: () => lock(),
  [Msg.VAULT_DISABLE]: () => disableVault(),
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler) return false;

  handler(message.payload ?? {})
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => {
      log.error(`Bericht '${message.type}' mislukt`, err);
      sendResponse({ ok: false, error: err?.message ?? String(err) });
    });

  // true houdt het antwoordkanaal open voor de asynchrone afhandeling.
  return true;
});
