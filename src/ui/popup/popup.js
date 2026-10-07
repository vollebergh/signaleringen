/**
 * Popup — snelle acties: scan starten en de laatste signalering per profiel
 * inzien. Alles wat langer duurt draait in de service worker, zodat het sluiten
 * van de popup een lopende scan niet afbreekt.
 */

import { Msg, send } from '../../core/messages.js';
import { $, el, clear, applyTheme, formatDateTime, showError } from '../shared/dom.js';

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
    const [profiles, settings, vault] = await Promise.all([
      send(Msg.LIST_PROFILES),
      send(Msg.GET_SETTINGS),
      send(Msg.VAULT_STATUS),
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
      content.append(await profileCard(profile));
    }
  } catch (err) {
    showError(content, err);
  }
}

async function profileCard(profile) {
  const status = el('div', { class: 'status' });
  statusNodes.set(profile.id, status);

  const card = el('div', { class: 'profile' }, [
    el('div', { class: 'row-between' }, [
      el('div', {}, [
        el('div', { class: 'name', text: profile.name || '(naamloos)' }),
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
    const [latest, synthesis] = await Promise.all([
      send(Msg.GET_LATEST_SCAN, { profileId: profile.id }),
      send(Msg.GET_LATEST_SYNTHESIS, { profileId: profile.id }),
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
  } catch (err) {
    status.textContent = err.message;
    status.classList.add('error');
  }

  return card;
}

function openDashboard(hash) {
  chrome.tabs.create({ url: chrome.runtime.getURL(`src/ui/dashboard/dashboard.html${hash}`) });
  window.close();
}

const openSyntheses = (profileId) => openDashboard(`#profiel/${profileId}/signaleringen`);
const openScan = (profileId, scanId) =>
  openDashboard(`#profiel/${profileId}/scan/${scanId}`);

async function startScan(profileId, button) {
  const status = statusNodes.get(profileId);
  button.disabled = true;
  if (status) {
    clear(status);
    status.classList.remove('error');
    status.append(el('span', { class: 'spinner' }), el('span', { text: ' Scan gestart…' }));
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
      clear(status);
      status.classList.add('error');
      status.textContent = err.message;
    }
  } finally {
    button.disabled = false;
  }
}

// Voortgangsberichten uit de service worker.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== Msg.SCAN_PROGRESS) return;
  const { profileId, phase } = message.payload;
  const status = statusNodes.get(profileId);
  if (!status) return;

  const label = {
    fetching: `Bronnen ophalen (${message.payload.current}/${message.payload.total})…`,
    prefiltering: `Voorfilteren (${message.payload.total})…`,
    analyzing: `Beoordelen (${message.payload.done}/${message.payload.total})…`,
    synthesizing: 'Signalering opstellen…',
  }[phase];

  if (label) {
    clear(status);
    status.classList.remove('error');
    status.append(el('span', { class: 'spinner' }), el('span', { text: ` ${label}` }));
  }
});

init();
