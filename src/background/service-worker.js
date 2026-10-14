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
 * niet: een nieuwe signalering van de automaat zet een teller op het
 * pictogram (B-54), de inhoud zie je bij het openen van de extensie.
 *
 * De UI-vlakken bevatten zelf geen netwerk- of opslaglogica. Dat houdt de
 * popup wegwerpbaar: hem sluiten breekt nooit een lopende scan af.
 */

import { AppConfig } from '../core/config.js';
import { Msg } from '../core/messages.js';
import { log } from '../core/logger.js';
import { assertValidSource, createProfile, createSource, SourceType } from '../core/models.js';
import { Result } from '../core/result.js';

import * as profiles from '../data/profile-repository.js';
import * as scans from '../data/scan-repository.js';
import { getSourceOverview } from '../data/history-repository.js';
import { getSettings, saveSettings, isConfigured } from '../data/settings-repository.js';
import { withApiKey, getVaultStatus, enableVault, unlock, lock, disableVault } from '../data/vault-repository.js';
import { markRead } from '../data/unread-repository.js';
import { exportProfiles, exportFilename, previewImport, importProfiles } from '../data/transfer-repository.js';

import { fetchPublications } from '../network/feed-fetcher.js';
import { testConnection } from '../network/llm-transport.js';
import { testPrefilter } from '../network/prefilter.js';
import { connectionErrors } from '../core/routing.js';

import { runScan, getProgress, isScanning, confirmScan } from './scan-runner.js';
import { applySchedule, runDueScans, ALARM_NAME } from './scheduler.js';
import { parseOpml } from './opml.js';
import { updateBadge, getUnreadProfileIds } from './badge.js';
import { createMessageListener } from './router.js';

// ── Levenscyclus ────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  log.info(`Geïnstalleerd/bijgewerkt: ${details.reason}`);
  registerContextMenus();
  applySchedule().catch((err) => log.warn('Planner instellen mislukt', err));
  updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  registerContextMenus();
  applySchedule().catch((err) => log.warn('Planner instellen mislukt', err));
  // De badge zelf overleeft een herstart van de browser niet (B-54).
  updateBadge();
});

// De permissie kan buiten de instellingen om worden ingetrokken (via
// edge://extensions). Zonder de permissie vuurt het alarm niet meer en is
// `chrome.alarms` weg; hier staat alleen de logregel daarvan.
chrome.permissions.onRemoved?.addListener((removed) => {
  if (removed.permissions?.includes('alarms')) {
    log.info('alarms-permissie ingetrokken, planner gestopt');
  }
});

// `chrome.alarms` bestaat alleen zodra de optionele permissie verleend is.
// Is ze er bij het laden nog niet, dan registreren we de listener alsnog bij
// het verlenen: zonder listener wekt de browser een gestopte worker niet voor
// het alarm en blijft de planner stil tot de worker opnieuw start.
let alarmListenerRegistered = false;
function registerAlarmListener() {
  if (alarmListenerRegistered || !chrome.alarms) return;
  alarmListenerRegistered = true;
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM_NAME) return;
    runDueScans().catch((err) => log.error('Automatische synthese mislukt', err));
  });
}

chrome.permissions.onAdded?.addListener((added) => {
  if (added.permissions?.includes('alarms')) {
    registerAlarmListener();
    applySchedule().catch((err) => log.warn('Planner instellen mislukt', err));
  }
});

registerAlarmListener();

// Instellingen en keys alleen leesbaar voor extensiepagina's en de worker,
// niet voor content scripts, mocht er ooit een bijkomen (S-12). Firefox kent
// `setAccessLevel` niet.
chrome.storage.local
  .setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' })
  .catch((err) => log.warn('Opslag afschermen voor content scripts mislukt', err));

// Klik op het extensiepictogram opent de popup; het side panel is los te openen.
if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch((err) => log.warn('Gedrag van het zijpaneel instellen mislukt', err));
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
    params.set('selectie', (info.selectionText ?? '').slice(0, AppConfig.CONTEXT_SELECTION_MAX_CHARS));
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

  // Bron-URL's ook hier controleren, niet alleen in de UI (S-05).
  [Msg.SAVE_PROFILE]: ({ profile }) => {
    const normalised = createProfile(profile);
    normalised.sources.forEach(assertValidSource);
    return profiles.saveProfile(normalised);
  },

  [Msg.DELETE_PROFILE]: async ({ profileId }) => {
    await profiles.deleteProfile(profileId);
    await updateBadge();
    return true;
  },

  [Msg.DUPLICATE_PROFILE]: ({ profileId }) => profiles.duplicateProfile(profileId),

  [Msg.IMPORT_OPML]: ({ content }) => parseOpml(content),

  [Msg.TEST_SOURCE]: async ({ source }) => {
    assertValidSource(source);
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
    assertValidSource({ url, name, type: type ?? SourceType.WEB });
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

  [Msg.GET_SCAN_STATE]: async ({ profileId }) => ({
    ...(await getProgress(profileId)),
    isScanning: isScanning(profileId),
  }),

  [Msg.GET_LATEST_SCAN]: async ({ profileId }) => {
    const scan = await scans.getLatestScan(profileId);
    return scan ? scans.getScanResults(scan.id) : null;
  },

  [Msg.CONFIRM_SCAN]: async ({ profileId, proceed }) => confirmScan(profileId, proceed),

  [Msg.GET_SCAN_RESULTS]: ({ scanId }) => scans.getScanResults(scanId),

  [Msg.TOGGLE_BOOKMARK]: ({ publicationId, bookmarked }) =>
    scans.setBookmarked(publicationId, bookmarked),

  [Msg.MARK_AS_READ]: ({ publicationId }) => scans.markAsRead(publicationId),

  [Msg.LIST_BOOKMARKS]: () => scans.getBookmarkedPublications(),

  [Msg.LIST_SYNTHESES]: ({ profileId }) => scans.getSynthesesForProfile(profileId),

  [Msg.GET_LATEST_SYNTHESIS]: ({ profileId }) => scans.getLatestSynthesis(profileId),

  [Msg.LIST_UNREAD]: () => getUnreadProfileIds(),

  [Msg.MARK_SYNTHESIS_READ]: async ({ profileId, createdAt }) => {
    if (await markRead(profileId, createdAt ?? Infinity)) await updateBadge();
    return true;
  },

  [Msg.EXPORT_PROFILES]: async ({ profileIds }) => {
    const bundle = await exportProfiles(profileIds);
    return { bundle, filename: exportFilename(bundle) };
  },

  [Msg.IMPORT_PREVIEW]: ({ bundle }) => previewImport(bundle),

  [Msg.IMPORT_PROFILES]: async ({ bundle, profileIds, mode }) => {
    const result = await importProfiles(bundle, { profileIds, mode });
    await updateBadge(); // vervangen profielen kunnen een ongelezen signalering kwijt zijn
    return result;
  },

  [Msg.GET_SETTINGS]: () => getSettings(),
  [Msg.IS_CONFIGURED]: () => isConfigured(),

  [Msg.SAVE_SETTINGS]: async ({ patch }) => {
    // Geen key of token over http naar een niet-lokale host (S-02).
    const [problem] = connectionErrors({ ...(await getSettings()), ...patch });
    if (problem) throw new Error(problem);
    const next = await saveSettings(patch);
    await applySchedule();
    return next;
  },

  [Msg.APPLY_SCHEDULE]: () => applySchedule(),

  [Msg.TEST_CONNECTION]: async ({ route } = {}) => {
    const settings = await withApiKey(await getSettings());
    return testConnection(settings, route);
  },

  [Msg.TEST_PREFILTER]: async () => {
    const stored = await getSettings();
    // Ook met het vinkje uit testen: de key uit de vault is dan wel nodig.
    return testPrefilter(await withApiKey({ ...stored, jevPrefilterEnabled: true }));
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

chrome.runtime.onMessage.addListener(createMessageListener(handlers, chrome.runtime.id));
