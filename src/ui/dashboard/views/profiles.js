/**
 * Profieloverzicht. Tegenhanger van ProfileListScreen.kt: zoeken, filteren op
 * categorie, scannen, dupliceren en verwijderen.
 */

import { Msg, send } from '../../../core/messages.js';
import { el, clear, formatDateTime, progressLabel, explainScanFailure } from '../../shared/dom.js';

export async function renderProfileList() {
  const profiles = await send(Msg.LIST_PROFILES);
  const root = el('div');

  const categories = [...new Set(profiles.map((p) => p.category).filter(Boolean))].sort();

  const search = el('input', {
    type: 'search',
    placeholder: 'Zoek op naam, onderwerp of bron…',
    'aria-label': 'Zoeken',
  });

  const categoryFilter = el(
    'select',
    { 'aria-label': 'Filter op categorie' },
    [
      el('option', { value: '', text: 'Alle categorieën' }),
      ...categories.map((c) => el('option', { value: c, text: c })),
    ],
  );

  const list = el('div');

  const apply = () => {
    const term = search.value.trim().toLowerCase();
    const category = categoryFilter.value;

    const visible = profiles.filter((profile) => {
      if (category && profile.category !== category) return false;
      if (!term) return true;
      return (
        profile.name.toLowerCase().includes(term) ||
        profile.userQuery.toLowerCase().includes(term) ||
        profile.sources.some(
          (s) => s.name.toLowerCase().includes(term) || s.url.toLowerCase().includes(term),
        )
      );
    });

    clear(list);
    if (visible.length === 0) {
      list.append(
        el('div', { class: 'empty' }, [
          el('p', {
            text: profiles.length === 0 ? 'Nog geen profielen.' : 'Geen profielen gevonden.',
          }),
        ]),
      );
      return;
    }
    visible.forEach((profile) => list.append(profileCard(profile)));
  };

  search.addEventListener('input', apply);
  categoryFilter.addEventListener('change', apply);

  root.append(
    el('div', { class: 'toolbar' }, [
      search,
      categories.length > 0 ? categoryFilter : null,
      el('button', {
        class: 'primary',
        text: 'Nieuw profiel',
        onclick: () => {
          location.hash = '#profiel/nieuw';
        },
      }),
    ]),
    list,
  );

  apply();
  return root;
}

function profileCard(profile) {
  const status = el('div', { class: 'muted' });

  // De knop naar de recentste signalering is het hoofdgebaar van deze kaart:
  // meestal wil je lezen wat er ligt, niet meteen opnieuw scannen. Hij blijft
  // uitgeschakeld tot vaststaat dát er een signalering is.
  const readButton = el('button', {
    class: 'primary read-synthesis',
    text: 'Lees signalering',
    disabled: true,
    title: 'Laden…',
  });

  const scanButton = el('button', {
    text: 'Scan nu',
    onclick: () => runScan(profile.id, scanButton, status),
  });

  const card = el('div', { class: 'profile-card' }, [
    el('div', { class: 'title-row' }, [
      el('h2', { text: profile.name || '(naamloos)' }),
      el('div', { class: 'row' }, [
        profile.autoScanEnabled
          ? el('span', {
              class: 'badge',
              title: `Automatisch elke ${formatInterval(profile.autoScanIntervalMinutes)}`,
              text: '⟳ automatisch',
            })
          : null,
        profile.category ? el('span', { class: 'badge', text: profile.category }) : null,
      ]),
    ]),
    el('p', { class: 'query', text: profile.userQuery || 'Nog geen onderwerpomschrijving' }),
    status,
    el('div', { class: 'actions' }, [
      readButton,
      scanButton,
      el('button', {
        text: 'Alle signaleringen',
        onclick: () => {
          location.hash = `#profiel/${profile.id}/signaleringen`;
        },
      }),
      el('button', {
        text: 'Bewerken',
        onclick: () => {
          location.hash = `#profiel/${profile.id}`;
        },
      }),
      el('button', {
        text: 'Dupliceren',
        onclick: async (event) => {
          event.currentTarget.disabled = true;
          await send(Msg.DUPLICATE_PROFILE, { profileId: profile.id });
          location.reload();
        },
      }),
      el('button', {
        class: 'danger',
        text: 'Verwijderen',
        onclick: async () => {
          const confirmed = confirm(
            `Profiel "${profile.name}" verwijderen? De scangeschiedenis gaat mee.`,
          );
          if (!confirmed) return;
          await send(Msg.DELETE_PROFILE, { profileId: profile.id });
          location.reload();
        },
      }),
    ]),
  ]);

  // Laatste scan en recentste signalering laden zonder de kaartopbouw te
  // blokkeren; de kaart staat er dan al, de details vullen zich aan.
  Promise.all([
    send(Msg.GET_LATEST_SCAN, { profileId: profile.id }),
    send(Msg.GET_LATEST_SYNTHESIS, { profileId: profile.id }),
    send(Msg.GET_SCAN_STATE, { profileId: profile.id }),
  ])
    .then(([latest, synthesis, scanState]) => {
      clear(status);

      if (synthesis) {
        readButton.disabled = false;
        readButton.title = `Signalering van ${formatDateTime(synthesis.createdAt)}`;
        readButton.addEventListener('click', () => {
          location.hash = `#profiel/${profile.id}/signaleringen`;
        });
      } else {
        readButton.title = 'Nog geen signalering — draai eerst een scan';
      }

      // Loopt er al een scan, of is de vorige afgebroken (B-46)?
      if (scanState.isScanning) {
        runScan(profile.id, scanButton, status, progressLabel(scanState, { withSource: true }) ?? undefined);
        return;
      }
      if (scanState.phase === 'interrupted') {
        showInterrupted(profile.id, scanButton, status, scanState.message);
        return;
      }

      if (!latest) {
        status.append(
          el('span', {
            text: `${profile.sources.length} bron${profile.sources.length === 1 ? '' : 'nen'} · nog niet gescand`,
          }),
        );
        return;
      }

      status.append(
        el('span', {
          text: `${latest.relevant.length} relevant van ${latest.scan.totalFetched} · ${formatDateTime(latest.scan.scanDate)} · `,
        }),
        el('button', {
          class: 'icon',
          text: 'publicaties bekijken',
          onclick: () => {
            location.hash = `#profiel/${profile.id}/scan/${latest.scan.id}`;
          },
        }),
      );
    })
    .catch(() => {
      clear(status);
      status.append(el('span', { text: 'Scangeschiedenis niet beschikbaar' }));
      readButton.title = 'Scangeschiedenis niet beschikbaar';
    });

  return card;
}

/** 90 → "1 uur 30 min", 1440 → "1 dag". Voor de tooltip op de automaat-badge. */
export function formatInterval(minutes) {
  const total = Number(minutes) || 0;
  if (total < 60) return `${total} min`;

  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;

  const parts = [];
  if (days) parts.push(`${days} dag${days === 1 ? '' : 'en'}`);
  if (hours) parts.push(`${hours} uur`);
  if (mins) parts.push(`${mins} min`);
  return parts.join(' ');
}

/** Afgebroken scan: melding plus een knop om opnieuw te scannen. */
function showInterrupted(profileId, button, status, message) {
  clear(status);
  status.classList.add('error');
  status.append(
    el('span', { text: `${message} ` }),
    el('button', { class: 'icon', text: 'Opnieuw scannen', onclick: () => runScan(profileId, button, status) }),
  );
}

/**
 * Start een scan, of haakt aan bij de lopende: de worker geeft dan diezelfde
 * run terug.
 */
async function runScan(profileId, button, status, initialLabel = 'Scan gestart…') {
  button.disabled = true;
  clear(status);
  status.classList.remove('error');
  status.append(el('span', { class: 'spinner' }), el('span', { text: ` ${initialLabel}` }));

  const onProgress = (message) => {
    if (message?.type !== Msg.SCAN_PROGRESS || message.payload.profileId !== profileId) return;
    const label = progressLabel(message.payload, { withSource: true });
    if (!label) return;
    clear(status);
    status.append(el('span', { class: 'spinner' }), el('span', { text: ` ${label}` }));
  };

  chrome.runtime.onMessage.addListener(onProgress);

  try {
    const { scanId, relevantCount } = await send(Msg.START_SCAN, { profileId });
    clear(status);
    status.append(
      el('span', { text: `${relevantCount} relevant · ` }),
      el('button', {
        class: 'icon',
        text: 'resultaat bekijken',
        onclick: () => {
          location.hash = `#profiel/${profileId}/scan/${scanId}`;
        },
      }),
    );
  } catch (err) {
    const message = await explainScanFailure(profileId, err);
    if (err.workerStopped) {
      showInterrupted(profileId, button, status, message);
    } else {
      clear(status);
      status.classList.add('error');
      status.textContent = message;
    }
  } finally {
    chrome.runtime.onMessage.removeListener(onProgress);
    button.disabled = false;
  }
}
