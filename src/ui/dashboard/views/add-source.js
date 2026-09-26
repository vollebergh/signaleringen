/**
 * Bestemming van het contextmenu: "Deze pagina toevoegen als bron" en
 * "Selectie signaleren". Het contextmenu zelf schrijft niets weg — de gebruiker
 * kiest hier bij welk profiel de bron hoort en bevestigt.
 */

import { Msg, send } from '../../../core/messages.js';
import { SourceType, validateSourceUrl } from '../../../core/models.js';
import { el, clear } from '../../shared/dom.js';
import { originPattern } from '../../../background/permissions.js';
import { isOpenOverheidSearchUrl } from '../../../network/open-overheid.js';

export async function renderAddSource() {
  const params = new URLSearchParams(location.search);
  const url = params.get('bronUrl') ?? '';
  const suggestedName = params.get('bronNaam') ?? '';
  const selection = params.get('selectie') ?? '';

  const profiles = await send(Msg.LIST_PROFILES);
  const root = el('div');
  const status = el('p', { class: 'muted' });

  if (!url || validateSourceUrl(url) !== null) {
    root.append(el('p', { class: 'error', text: 'Geen bruikbare URL meegegeven.' }));
    return root;
  }

  if (profiles.length === 0) {
    root.append(
      el('div', { class: 'empty' }, [
        el('p', { text: 'Maak eerst een profiel aan om een bron aan toe te voegen.' }),
        el('button', {
          class: 'primary',
          text: 'Profiel aanmaken',
          onclick: () => {
            location.hash = '#profiel/nieuw';
          },
        }),
      ]),
    );
    return root;
  }

  const nameInput = el('input', { type: 'text', value: suggestedName || url });
  const profileSelect = el(
    'select',
    {},
    profiles.map((p) => el('option', { value: p.id, text: p.name || '(naamloos)' })),
  );
  const typeSelect = el('select', {}, [
    el('option', { value: SourceType.WEB, text: 'Webpagina (tekst van de pagina)' }),
    el('option', { value: SourceType.RSS, text: 'RSS/Atom-feed' }),
    el('option', { value: SourceType.OPEN_OVERHEID, text: 'Zoekopdracht op open.overheid.nl' }),
  ]);
  if (isOpenOverheidSearchUrl(url)) typeSelect.value = SourceType.OPEN_OVERHEID;

  root.append(
    el('h2', { text: 'Bron toevoegen' }),
    el('p', { class: 'muted', text: url }),
    selection
      ? el('div', { class: 'card' }, [
          el('p', { class: 'muted', text: 'Geselecteerde tekst' }),
          el('p', { text: selection }),
          el('p', {
            class: 'hint',
            text: 'De selectie wordt niet opgeslagen — de bron wordt bij elke scan opnieuw opgehaald.',
          }),
        ])
      : null,
    el('div', { class: 'field' }, [el('label', { text: 'Naam' }), nameInput]),
    el('div', { class: 'field' }, [el('label', { text: 'Toevoegen aan profiel' }), profileSelect]),
    el('div', { class: 'field' }, [el('label', { text: 'Type bron' }), typeSelect]),
    el('div', { class: 'actions' }, [
      el('button', {
        class: 'primary',
        text: 'Toevoegen',
        onclick: (event) => addSource(event.currentTarget),
      }),
      el('button', {
        text: 'Annuleren',
        onclick: () => {
          location.hash = '#profielen';
        },
      }),
    ]),
    status,
  );

  async function addSource(button) {
    button.disabled = true;
    clear(status);
    status.className = 'muted';

    // Toestemming vragen vanuit deze klik; daarna pas opslaan.
    const origin = originPattern(url);
    if (origin && !(await chrome.permissions.contains({ origins: [origin] }))) {
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (!granted) {
        status.className = 'error';
        status.textContent = 'Zonder toestemming voor deze host kan de bron niet worden opgehaald.';
        button.disabled = false;
        return;
      }
    }

    try {
      const result = await send(Msg.ADD_PAGE_AS_SOURCE, {
        profileId: profileSelect.value,
        url,
        name: nameInput.value.trim() || url,
        type: typeSelect.value,
      });
      status.textContent = result.added
        ? 'Bron toegevoegd.'
        : 'Deze bron stond al in het profiel.';
      setTimeout(() => {
        location.hash = `#profiel/${profileSelect.value}`;
      }, 800);
    } catch (err) {
      status.className = 'error';
      status.textContent = err.message;
      button.disabled = false;
    }
  }

  return root;
}
