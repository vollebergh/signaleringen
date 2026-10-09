/**
 * Popup — snelle acties: scan starten en de laatste signalering per profiel
 * inzien. Alles wat langer duurt draait in de service worker, zodat het sluiten
 * van de popup een lopende scan niet afbreekt.
 */

import { Msg, send } from '../../core/messages.js';
import { $, el, clear, applyTheme, formatDateTime, showError, progressLabel, explainScanFailure } from '../shared/dom.js';

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
    .catch(() => {});

  $('#open-dashboard').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  $('#open-panel').addEventListener('click', () => {
    if (currentWindowId === null) return;
    chrome.sidePanel.open({ windowId: currentWindowId });
    window.close();
  });

  await render();
}

async function render() {
  try {
    const [profiles, settings, vault, unread] = await Promise.all([
      send(Msg.LIST_PROFILES),
      send(Msg.GET_SETTINGS),
      send(Msg.VAULT_STATUS),
      send(Msg.LIST_UNREAD),
    ]);

    clear(content);
    statusNodes.clear();

    const configured =
      settings.transport === 'proxy'
        ? Boolean(settings.proxyUrl?.trim())
        : Boolean(settings.directApiKey?.trim()) || vault.exists;

    if (!configured) {
      content.append(
        el('div', { class: 'card' }, [
          el('p', { text: 'Nog niet geconfigureerd.' }),
          el('p', {
            class: 'muted',
            text:
              settings.transport === 'proxy'
                ? 'Stel het proxy-adres in voordat je kunt scannen.'
                : 'Stel een API-key en base-URL in voordat je kunt scannen.',
          }),
          el('button', {
            class: 'primary',
            text: 'Naar instellingen',
            onclick: () => {
              chrome.runtime.openOptionsPage();
              window.close();
            },
          }),
        ]),
      );
      return;
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
      status.textContent = `${latest.relevant.length} relevant · ${formatDateTime(
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
    } else if (scanState.phase === 'interrupted') {
      showInterrupted(profile.id, status, scanState.message, scanButton);
    }
  } catch (err) {
    status.textContent = err.message;
    status.classList.add('error');
  }

  return card;
}

/** Afgebroken scan: melding plus een knop om opnieuw te scannen. */
function showInterrupted(profileId, status, message, scanButton) {
  clear(status);
  status.classList.add('error');
  status.append(
    el('span', { text: `${message} ` }),
    el('button', { class: 'icon', text: 'Opnieuw scannen', onclick: () => startScan(profileId, scanButton) }),
  );
}

function openDashboard(hash) {
  chrome.tabs.create({ url: chrome.runtime.getURL(`src/ui/dashboard/dashboard.html${hash}`) });
  window.close();
}

const openSyntheses = (profileId) => openDashboard(`#profiel/${profileId}/signaleringen`);
const openScan = (profileId, scanId) =>
  openDashboard(`#profiel/${profileId}/scan/${scanId}`);

/**
 * Start een scan, of haakt aan bij de lopende: de worker geeft dan diezelfde
 * run terug.
 */
async function startScan(profileId, button, initialLabel = 'Scan gestart…') {
  const status = statusNodes.get(profileId);
  button.disabled = true;
  if (status) {
    clear(status);
    status.classList.remove('error');
    status.append(el('span', { class: 'spinner' }), el('span', { text: ` ${initialLabel}` }));
  }

  try {
    const { scanId, relevantCount } = await send(Msg.START_SCAN, { profileId });
    if (status) {
      clear(status);
      status.append(
        el('span', { text: `${relevantCount} relevant · ` }),
        el('button', {
          class: 'icon',
          text: 'bekijken',
          onclick: () => openScan(profileId, scanId),
        }),
      );
    }
  } catch (err) {
    if (status) {
      const message = await explainScanFailure(profileId, err);
      if (err.workerStopped) {
        showInterrupted(profileId, status, message, button);
      } else {
        clear(status);
        status.classList.add('error');
        status.textContent = message;
      }
    }
  } finally {
    button.disabled = false;
  }
}

// Voortgangsberichten uit de service worker.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== Msg.SCAN_PROGRESS) return;
  const { profileId } = message.payload;
  const status = statusNodes.get(profileId);
  if (!status) return;

  const label = progressLabel(message.payload);

  if (label) {
    clear(status);
    status.classList.remove('error');
    status.append(el('span', { class: 'spinner' }), el('span', { text: ` ${label}` }));
  }
});

init();
