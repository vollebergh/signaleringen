/**
 * Profieloverzicht. Tegenhanger van ProfileListScreen.kt: zoeken, filteren op
 * categorie, scannen, dupliceren en verwijderen.
 */

import { Msg, send } from '../../../core/messages.js';
import { el, clear, formatDateTime, progressLabel, showProgress } from '../../shared/dom.js';
import { runScanInStatus, showInterrupted } from '../../shared/scan-control.js';

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
          const button = event.currentTarget; // na een await is currentTarget leeg
          button.disabled = true;
          try {
            await send(Msg.DUPLICATE_PROFILE, { profileId: profile.id });
            location.reload();
          } catch (err) {
            showActionError(status, `Dupliceren mislukt: ${err.message}`);
            button.disabled = false;
          }
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
          try {
            await send(Msg.DELETE_PROFILE, { profileId: profile.id });
            location.reload();
          } catch (err) {
            showActionError(status, `Verwijderen mislukt: ${err.message}`);
          }
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
        // Wacht de scan op "doorgaan?" (B-45), dan de vraag opnieuw tonen.
        if (scanState.phase === 'confirm') showProgress(status, { ...scanState, profileId: profile.id });
        return;
      }
      if (scanState.phase === 'interrupted') {
        showInterrupted(status, scanState.message, () => runScan(profile.id, scanButton, status));
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

/** Foutmelding van een kaartactie in de statusregel van de kaart. */
function showActionError(status, message) {
  clear(status);
  status.classList.add('error');
  status.textContent = message;
}

/** Start een scan, of haakt aan bij de lopende, met de voortgang in de statusregel van de kaart. */
function runScan(profileId, button, status, initialLabel) {
  return runScanInStatus({
    profileId,
    button,
    status,
    initialLabel,
    resultText: 'resultaat bekijken',
    openResult: (scanId) => {
      location.hash = `#profiel/${profileId}/scan/${scanId}`;
    },
    progress: { withSource: true },
  });
}
