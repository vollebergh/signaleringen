/**
 * Popup — snelle acties: scan starten en de laatste signalering per profiel
 * inzien. Alles wat langer duurt draait in de service worker, zodat het sluiten
 * van de popup een lopende scan niet afbreekt.
 */

import { Msg, send } from '../../core/messages.js';
import { log } from '../../core/logger.js';
import { AppConfig } from '../../core/config.js';
import { $, el, clear, applyTheme, formatDateTime, showError, progressLabel, showProgress, dashboardUrl } from '../shared/dom.js';
import { runScanInStatus, showInterrupted } from '../shared/scan-control.js';

const content = $('#content');

/** @type {Map<string, HTMLElement>} statusregel per profiel */
const statusNodes = new Map();

/**
 * Het venster-id wordt vooraf opgehaald: `sidePanel.open()` eist een
 * gebruikersgebaar, en een `await` binnen de klik-handler verspeelt dat.
 */
let currentWindowId = null;

async function init() {
  await applyTheme();

  chrome.windows
    .getCurrent()
    .then((win) => {
      currentWindowId = win.id;
    })
    // Zonder venster-id opent de knop voor het zijpaneel niets; de rest van
    // de popup werkt gewoon.
    .catch((err) => log.warn('Huidig venster onbekend', err));

  $('#open-dashboard').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  // Zijpaneel verborgen (AppConfig.SIDE_PANEL_ENABLED): knop weg.
  if (!AppConfig.SIDE_PANEL_ENABLED) $('#open-panel').remove();
  else $('#open-panel').addEventListener('click', () => {
    // Firefox kent geen side panel maar een sidebar (B-65). Beide eisen een
    // gebruikersgebaar, dus geen `await` vóór de aanroep.
    const sidebar = globalThis.browser?.sidebarAction;
    if (!chrome.sidePanel && sidebar) {
      sidebar.open().catch((err) => log.warn('Zijbalk openen mislukt', err));
    } else {
      if (currentWindowId === null) return;
      chrome.sidePanel.open({ windowId: currentWindowId });
    }
    window.close();
  });

  await render();
}

async function render() {
  try {
    // Of er genoeg is ingesteld, beslist de worker (CR-18): dezelfde regel
    // als vóór een scan.
    const [profiles, settings, vault, unread, configured] = await Promise.all([
      send(Msg.LIST_PROFILES),
      send(Msg.GET_SETTINGS),
      send(Msg.VAULT_STATUS),
      send(Msg.LIST_UNREAD),
      send(Msg.IS_CONFIGURED),
    ]);

    clear(content);
    statusNodes.clear();

    // Zonder taalmodel werkt de extensie als gewone feedlezer (B-82): scannen
    // haalt op, zonder beoordeling of signalering. Een melding, geen blokkade.
    if (!configured) {
      content.append(
        el('div', { class: 'card' }, [
          el('p', { text: 'Geen taalmodel ingesteld.' }),
          el('p', {
            class: 'muted',
            text: 'Een scan haalt nu alleen de nieuwste publicaties op. Stel een taalmodel in voor beoordeling en signaleringen.',
          }),
          el('button', {
            text: 'Naar instellingen',
            onclick: () => {
              chrome.runtime.openOptionsPage();
              window.close();
            },
          }),
        ]),
      );
    }

    if (settings.transport === 'direct' && vault.exists && !vault.unlocked) {
      content.append(
        el('div', { class: 'card' }, [
          el('p', { text: 'De API-key is vergrendeld.' }),
          el('p', { class: 'muted', text: 'Ontgrendel de vault met je wachtwoordzin om te kunnen scannen.' }),
          el('button', {
            class: 'primary',
            text: 'Ontgrendelen',
            onclick: () => {
              chrome.runtime.openOptionsPage();
              window.close();
            },
          }),
        ]),
      );
    }

    if (profiles.length === 0) {
      content.append(
        el('div', { class: 'empty' }, [
          el('p', { text: 'Nog geen profielen.' }),
          el('button', {
            class: 'primary',
            text: 'Profiel aanmaken',
            onclick: () => {
              chrome.runtime.openOptionsPage();
              window.close();
            },
          }),
        ]),
      );
      return;
    }

    for (const profile of profiles) {
      content.append(await profileCard(profile, unread.includes(profile.id)));
    }
  } catch (err) {
    showError(content, err);
  }
}

async function profileCard(profile, isUnread) {
  const status = el('div', { class: 'status' });
  statusNodes.set(profile.id, status);

  const card = el('div', { class: 'profile' }, [
    el('div', { class: 'row-between' }, [
      el('div', {}, [
        el('div', { class: 'name' }, [
          profile.name || '(naamloos)',
          // Nieuwe signalering van de automatische synthese (B-54); gelezen
          // zodra je hem in het dashboard of side panel opent.
          isUnread ? el('span', { class: 'badge unread', text: 'nieuw' }) : null,
        ]),
        el('div', {
          class: 'meta',
          text: `${profile.sources.length} bron${profile.sources.length === 1 ? '' : 'nen'}${
            profile.category ? ` · ${profile.category}` : ''
          }`,
        }),
      ]),
      el('button', {
        class: 'primary',
        text: 'Scan',
        dataset: { profileId: profile.id },
        onclick: (event) => startScan(profile.id, event.currentTarget),
      }),
    ]),
    status,
  ]);

  // Laatste resultaat tonen zodat de popup ook zonder nieuwe scan nut heeft.
  try {
    const [latest, synthesis, scanState] = await Promise.all([
      send(Msg.GET_LATEST_SCAN, { profileId: profile.id }),
      send(Msg.GET_LATEST_SYNTHESIS, { profileId: profile.id }),
      send(Msg.GET_SCAN_STATE, { profileId: profile.id }),
    ]);

    if (latest) {
      status.textContent = `${latest.scan.readerMode ? `${latest.scan.newCount ?? 0} nieuw` : `${latest.relevant.length} relevant`} · ${formatDateTime(
        latest.scan.scanDate,
      )}`;
    } else {
      status.textContent = 'Nog niet gescand';
    }

    if (synthesis) {
      card.append(el('div', { class: 'synthesis-preview', text: synthesis.text }));
      card.append(
        el('button', {
          class: 'primary read-synthesis',
          text: 'Lees signalering',
          title: `Signalering van ${formatDateTime(synthesis.createdAt)}`,
          onclick: () => openSyntheses(profile.id),
        }),
      );
    }

    // Loopt er al een scan, of is de vorige afgebroken (B-46)?
    const scanButton = card.querySelector('button.primary[data-profile-id]');
    if (scanState.isScanning) {
      startScan(profile.id, scanButton, progressLabel(scanState) ?? undefined); // haakt aan bij de lopende scan
      // Wacht de scan op "doorgaan?" (B-45), dan de vraag opnieuw tonen.
      if (scanState.phase === 'confirm') showProgress(status, { ...scanState, profileId: profile.id });
    } else if (scanState.phase === 'interrupted') {
      showInterrupted(status, scanState.message, () => startScan(profile.id, scanButton));
    }
  } catch (err) {
    status.textContent = err.message;
    status.classList.add('error');
  }

  return card;
}

function openDashboard(hash) {
  chrome.tabs.create({ url: dashboardUrl(hash) });
  window.close();
}

const openSyntheses = (profileId) => openDashboard(`#profiel/${profileId}/signaleringen`);

/**
 * Start een scan, of haakt aan bij de lopende. De voortgang komt binnen via
 * de luisteraar onderaan, die ook scans toont die elders zijn gestart.
 */
function startScan(profileId, button, initialLabel) {
  return runScanInStatus({
    profileId,
    button,
    status: statusNodes.get(profileId),
    initialLabel,
    resultText: 'bekijken',
    openResult: (scanId) => openDashboard(`#profiel/${profileId}/scan/${scanId}`),
  });
}

// Voortgangsberichten uit de service worker.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== Msg.SCAN_PROGRESS) return;
  const { profileId } = message.payload;
  const status = statusNodes.get(profileId);
  if (!status) return;

  if (showProgress(status, message.payload)) status.classList.remove('error');
});

init();
