/**
 * Side panel — de signalering naast de pagina die je leest.
 * Bewust smal in functie: profiel kiezen, signalering lezen, doorklikken.
 * Beheer gebeurt in het dashboard.
 */

import { Msg, send } from '../../core/messages.js';
import { $, el, clear, sourceReferences, applyTheme, formatDate, formatDateTime, openUrl, showError, progressLabel, explainScanFailure } from '../shared/dom.js';

const content = $('#content');
const profileSelect = $('#profile-select');
const refreshButton = $('#refresh');

const LAST_PROFILE_KEY = 'sidepanelLastProfile';

async function init() {
  await applyTheme();

  try {
    const profiles = await send(Msg.LIST_PROFILES);
    if (profiles.length === 0) {
      profileSelect.style.display = 'none';
      refreshButton.disabled = true;
      clear(content);
      content.append(
        el('div', { class: 'empty' }, [
          el('p', { text: 'Nog geen profielen.' }),
          el('button', {
            class: 'primary',
            text: 'Dashboard openen',
            onclick: () => chrome.runtime.openOptionsPage(),
          }),
        ]),
      );
      return;
    }

    clear(profileSelect);
    profiles.forEach((p) =>
      profileSelect.append(el('option', { value: p.id, text: p.name || '(naamloos)' })),
    );

    const stored = await chrome.storage.session.get(LAST_PROFILE_KEY);
    const last = stored[LAST_PROFILE_KEY];
    if (last && profiles.some((p) => p.id === last)) profileSelect.value = last;

    profileSelect.addEventListener('change', () => {
      chrome.storage.session.set({ [LAST_PROFILE_KEY]: profileSelect.value });
      loadLatest();
    });

    refreshButton.addEventListener('click', () => scanNow());

    await loadLatest();
  } catch (err) {
    showError(content, err);
  }
}

async function loadLatest() {
  const profileId = profileSelect.value;
  clear(content);
  content.append(el('p', { class: 'muted', text: 'Laden…' }));

  try {
    const [latest, scanState] = await Promise.all([
      send(Msg.GET_LATEST_SCAN, { profileId }),
      send(Msg.GET_SCAN_STATE, { profileId }),
    ]);
    clear(content);

    // Loopt er al een scan, dan aanhaken; is de vorige afgebroken, dan dat
    // melden boven de laatste signalering (B-46).
    if (scanState.isScanning) {
      scanNow(progressLabel(scanState) ?? undefined);
      return;
    }
    if (scanState.phase === 'interrupted') {
      content.append(
        el('div', { class: 'card' }, [
          el('p', { class: 'error', text: scanState.message }),
          el('button', { class: 'primary', text: 'Opnieuw scannen', onclick: () => scanNow() }),
        ]),
      );
    }

    if (!latest) {
      content.append(
        el('div', { class: 'empty' }, [
          el('p', { text: 'Nog niet gescand.' }),
          el('button', { class: 'primary', text: 'Nu scannen', onclick: () => scanNow() }),
        ]),
      );
      return;
    }

    content.append(
      el('p', {
        class: 'muted',
        text: `${latest.relevant.length} relevant · ${formatDateTime(latest.scan.scanDate)}`,
      }),
    );

    if (latest.synthesis?.text) {
      for (const warning of latest.synthesis.warnings ?? []) {
        content.append(el('p', { class: 'error', text: `⚠ ${warning}` }));
      }
      content.append(el('div', { class: 'synthesis', text: latest.synthesis.text }));
      send(Msg.MARK_SYNTHESIS_READ, { profileId, createdAt: latest.synthesis.createdAt }).catch(() => {});
      const references = sourceReferences(latest.synthesis.sources);
      if (references) content.append(references);
    } else if (latest.synthesis?.error) {
      content.append(el('p', { class: 'error', text: `Synthese mislukt: ${latest.synthesis.error}` }));
    }

    // Met een signalering staan de publicaties al genummerd in de
    // bronverwijzingen; alleen zonder signalering de losse lijst.
    if (latest.relevant.length > 0 && !latest.synthesis?.sources?.length) {
      content.append(el('div', { class: 'section-title', text: 'Publicaties' }));
      latest.relevant.forEach((result) => content.append(publicationRow(result)));
    }

    content.append(
      el('div', { class: 'actions', style: 'margin-top:16px' }, [
        el('button', {
          class: 'icon',
          text: 'Alle signaleringen →',
          onclick: () => openDashboard(`#profiel/${profileId}/signaleringen`),
        }),
        el('button', {
          class: 'icon',
          text: 'Publicaties →',
          onclick: () => openDashboard(`#profiel/${profileId}/scan/${latest.scan.id}`),
        }),
      ]),
    );
  } catch (err) {
    showError(content, err);
  }
}

function openDashboard(hash) {
  chrome.tabs.create({ url: chrome.runtime.getURL(`src/ui/dashboard/dashboard.html${hash}`) });
}

function publicationRow(result) {
  const pub = result.publication;
  return el('div', { class: 'publication' }, [
    el('div', { class: 'title', text: pub.title || '(zonder titel)' }),
    el('div', { class: 'muted', text: result.shortDescription }),
    el('div', { class: 'links' }, [
      el('span', { class: 'muted', text: `${pub.sourceName} · ${formatDate(pub.publishedDate)}` }),
      pub.url ? el('button', { class: 'icon', text: 'Openen', onclick: () => openUrl(pub.url) }) : null,
    ]),
  ]);
}

/** Start een scan, of haakt aan bij de lopende. */
async function scanNow(initialLabel = 'Scan gestart…') {
  const profileId = profileSelect.value;
  refreshButton.disabled = true;
  clear(content);
  const status = el('p', { class: 'row' }, [
    el('span', { class: 'spinner' }),
    el('span', { text: ` ${initialLabel}` }),
  ]);
  content.append(status);

  try {
    await send(Msg.START_SCAN, { profileId });
    await loadLatest();
  } catch (err) {
    if (err.workerStopped) {
      // Toont de melding over de afgebroken scan met een knop om opnieuw te scannen.
      await explainScanFailure(profileId, err);
      await loadLatest();
    } else {
      showError(content, err);
    }
  } finally {
    refreshButton.disabled = false;
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== Msg.SCAN_PROGRESS) return;
  if (message.payload.profileId !== profileSelect.value) return;

  const label = progressLabel(message.payload);
  if (!label) return;

  clear(content);
  content.append(
    el('p', { class: 'row' }, [el('span', { class: 'spinner' }), el('span', { text: ` ${label}` })]),
  );
});

init();
