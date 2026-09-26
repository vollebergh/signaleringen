/**
 * Profiel bewerken. Tegenhanger van ProfileEditScreen.kt, uitgebreid met het
 * veld `synthesisPrompt` — de eigen instructie voor de signalering — en met de
 * runtime-toestemming per bron-host.
 */

import { AppConfig } from '../../../core/config.js';
import { Msg, send } from '../../../core/messages.js';
import { createProfile, createSource, SourceType, validateSourceUrl } from '../../../core/models.js';
import { el, clear, formatDateTime, openUrl } from '../../shared/dom.js';
import { originPattern } from '../../../background/permissions.js';
import { isOpenOverheidSearchUrl } from '../../../network/open-overheid.js';

/**
 * Keuzes voor het scaninterval. Een select met vaste stappen in plaats van een
 * vrij getalveld: het minimum van een uur is een harde ondergrens en met een
 * open veld typt iemand vroeg of laat "5".
 */
const INTERVAL_CHOICES = [
  { minutes: 60, label: 'Elk uur' },
  { minutes: 180, label: 'Elke 3 uur' },
  { minutes: 360, label: 'Elke 6 uur' },
  { minutes: 720, label: 'Elke 12 uur' },
  { minutes: 1440, label: 'Elke dag' },
  { minutes: 4320, label: 'Elke 3 dagen' },
  { minutes: 10080, label: 'Elke week' },
];

/** Rondt een opgeslagen waarde af op de dichtstbijzijnde keuze in de lijst. */
function nearestInterval(minutes) {
  const target = Math.max(AppConfig.AUTO_SCAN_MIN_INTERVAL_MINUTES, Number(minutes) || 0);
  return INTERVAL_CHOICES.reduce((best, choice) =>
    Math.abs(choice.minutes - target) < Math.abs(best.minutes - target) ? choice : best,
  ).minutes;
}

export async function renderProfileEdit(profileId) {
  const [profile, settings] = await Promise.all([
    profileId
      ? send(Msg.GET_PROFILE, { profileId })
      : Promise.resolve(createProfile({ name: '', sources: [] })),
    send(Msg.GET_SETTINGS),
  ]);

  if (!profile) throw new Error('Profiel niet gevonden');

  const globalAutoOff = !settings.autoScanEnabled;

  // Per bron: wanneer voor het laatst opgehaald en hoeveel daarvan in een
  // signalering is verwerkt. Alleen zinvol bij een bestaand profiel.
  const overview = profileId
    ? new Map(
        (await send(Msg.GET_SOURCE_OVERVIEW, { profileId })).map((entry) => [
          entry.source.id,
          entry,
        ]),
      )
    : new Map();

  // Werkkopie: pas bij Opslaan gaat er iets naar de opslag.
  const draft = createProfile(profile);
  const root = el('div');
  const sourceList = el('div');
  const permissionNotice = el('div');

  const nameField = textField('Profielnaam', draft.name, (v) => {
    draft.name = v;
  });
  const categoryField = textField(
    'Categorie',
    draft.category,
    (v) => {
      draft.category = v;
    },
    'Bijv. Werk, Hobby, Nieuws (optioneel)',
  );
  const queryField = textArea(
    'Waar let je op?',
    draft.userQuery,
    (v) => {
      draft.userQuery = v;
    },
    'Beschrijf welke publicaties over dit onderwerp relevant zijn. Dit stuurt de relevantiefilter.',
  );
  const synthesisField = textArea(
    'Instructie voor de signalering (optioneel)',
    draft.synthesisPrompt,
    (v) => {
      draft.synthesisPrompt = v;
    },
    'Bijv. "Schrijf voor beleidsadviseurs, maximaal 300 woorden, benoem consequenties voor gemeenten."',
  );

  const onlyNewCheckbox = el('input', { type: 'checkbox' });
  onlyNewCheckbox.checked = Boolean(draft.onlyNewPublications);
  onlyNewCheckbox.style.width = 'auto';
  onlyNewCheckbox.addEventListener('change', () => {
    draft.onlyNewPublications = onlyNewCheckbox.checked;
  });

  const onlyNewField = el('div', { class: 'field' }, [
    el('label', { class: 'row', style: 'color:var(--text)' }, [
      onlyNewCheckbox,
      el('span', { text: 'Alleen nieuwe publicaties beoordelen' }),
    ]),
    el('div', {
      class: 'hint',
      text: 'Aan: publicaties die dit profiel eerder al ophaalde worden overgeslagen bij het beoordelen en synthetiseren. Uit: elke scan beoordeelt alles opnieuw — meer tokens, maar bruikbaar als je de vraagstelling hebt gewijzigd.',
    }),
  ]);

  // ── Automatisch synthetiseren ─────────────────────────────────────────────
  const autoCheckbox = el('input', { type: 'checkbox' });
  autoCheckbox.checked = Boolean(draft.autoScanEnabled);
  autoCheckbox.style.width = 'auto';

  const intervalSelect = el(
    'select',
    {},
    INTERVAL_CHOICES.map((choice) =>
      el('option', { value: String(choice.minutes), text: choice.label }),
    ),
  );
  intervalSelect.value = String(
    nearestInterval(draft.autoScanIntervalMinutes ?? AppConfig.AUTO_SCAN_DEFAULT_INTERVAL_MINUTES),
  );
  intervalSelect.addEventListener('change', () => {
    draft.autoScanIntervalMinutes = Number(intervalSelect.value);
  });

  const autoHint = el('div', { class: 'hint' });
  const syncAutoState = () => {
    intervalSelect.disabled = !autoCheckbox.checked;
    autoHint.textContent = autoCheckbox.checked
      ? `Dit profiel wordt hooguit elke ${intervalSelect.selectedOptions[0].textContent.toLowerCase()} automatisch gescand en gesynthetiseerd. De klok loopt vanaf de laatste scan, dus een handmatige scan schuift hem mee.`
      : 'Dit profiel wordt alleen gescand als je op Scan klikt.';
  };
  autoCheckbox.addEventListener('change', () => {
    draft.autoScanEnabled = autoCheckbox.checked;
    syncAutoState();
  });
  intervalSelect.addEventListener('change', syncAutoState);

  const autoField = el('div', { class: 'field' }, [
    el('label', { class: 'row', style: 'color:var(--text)' }, [
      autoCheckbox,
      el('span', { text: 'Automatisch synthetiseren' }),
    ]),
    intervalSelect,
    autoHint,
    globalAutoOff
      ? el('div', {
          class: 'hint error',
          text: 'Let op: de hoofdschakelaar voor automatisch synthetiseren staat uit bij Instellingen. Zolang die uit staat gebeurt hier niets.',
        })
      : null,
  ]);
  syncAutoState();

  const opmlInput = el('input', {
    type: 'file',
    accept: '.opml,.xml,text/xml,application/xml',
    style: 'display:none',
  });
  opmlInput.addEventListener('change', async () => {
    const file = opmlInput.files?.[0];
    if (!file) return;
    const content = await file.text();
    const imported = await send(Msg.IMPORT_OPML, { content });
    const known = new Set(draft.sources.map((s) => s.url));
    const added = imported.filter((s) => !known.has(s.url));
    draft.sources.push(...added);
    opmlInput.value = '';
    renderSources();
    setStatus(
      added.length > 0
        ? `${added.length} bron(nen) geïmporteerd uit OPML`
        : 'Geen nieuwe bronnen gevonden in dit OPML-bestand',
    );
  });

  function renderSources() {
    clear(sourceList);
    if (draft.sources.length === 0) {
      sourceList.append(
        el('p', { class: 'muted', text: 'Nog geen bronnen. Voeg een RSS-feed, webpagina of zoekopdracht op open.overheid.nl toe.' }),
      );
    }
    draft.sources.forEach((source, index) => {
      sourceList.append(sourceCard(source, index));
    });
    refreshPermissions();
  }

  function sourceCard(source, index) {
    const urlError = el('div', { class: 'hint error' });
    const testResult = el('span', { class: 'muted' });

    const urlInput = el('input', {
      type: 'url',
      value: source.url,
      placeholder: 'https://…',
    });
    urlInput.addEventListener('input', () => {
      source.url = urlInput.value.trim();
      urlError.textContent = validateSourceUrl(source.url) ?? '';
      // Een geplakte zoek-URL van open.overheid.nl is geen feed en geen
      // gewone webpagina — die herkennen we meteen.
      if (isOpenOverheidSearchUrl(source.url)) {
        source.type = SourceType.OPEN_OVERHEID;
        syncType();
      }
      refreshPermissions();
    });
    urlError.textContent = validateSourceUrl(source.url) ?? '';

    const nameInput = el('input', { type: 'text', value: source.name, placeholder: 'Naam' });
    nameInput.addEventListener('input', () => {
      source.name = nameInput.value;
    });

    const typeButtons = [
      [SourceType.RSS, 'RSS/Atom'],
      [SourceType.WEB, 'Webpagina'],
      [SourceType.OPEN_OVERHEID, 'open.overheid.nl'],
    ].map(([type, text]) => {
      const button = el('button', { text });
      button.addEventListener('click', () => {
        source.type = type;
        syncType();
      });
      return { type, button };
    });
    function syncType() {
      for (const { type, button } of typeButtons) {
        button.setAttribute('aria-pressed', String(source.type === type));
      }
      openOverheidHint.style.display = source.type === SourceType.OPEN_OVERHEID ? '' : 'none';
    }
    const openOverheidHint = el('div', {
      class: 'hint',
      text: 'Stel de zoekopdracht samen op open.overheid.nl (Uitgebreid zoeken: ministerie, documentsoort, eventueel een zoekterm) en plak de URL uit de adresbalk. De extensie haalt steeds de nieuwste publicaties op; periode en sortering uit de URL worden genegeerd.',
    });
    syncType();

    return el('div', { class: 'source-card' }, [
      el('div', { class: 'grid' }, [nameInput, urlInput]),
      urlError,
      openOverheidHint,
      sourceHistoryLine(source),
      el('div', { class: 'row-between', style: 'margin-top:8px' }, [
        el('div', { class: 'type-toggle' }, typeButtons.map((t) => t.button)),
        el('div', { class: 'row' }, [
          el('button', {
            text: 'Openen',
            title: 'Open deze bron in een nieuw tabblad',
            onclick: () => openUrl(source.url),
          }),
          el('button', {
            text: 'Testen',
            onclick: (event) => testSource(source, event.currentTarget, testResult),
          }),
          testResult,
          el('button', {
            class: 'icon danger',
            text: 'Verwijderen',
            onclick: () => {
              draft.sources.splice(index, 1);
              renderSources();
            },
          }),
        ]),
      ]),
    ]);
  }

  /** Toont wanneer deze bron voor het laatst is opgehaald en wat ermee gebeurde. */
  function sourceHistoryLine(source) {
    const entry = overview.get(source.id);
    if (!entry || entry.neverFetched) {
      return el('div', { class: 'hint', text: 'Nog niet opgehaald' });
    }

    const parts = [];
    if (entry.lastFetchedAt) {
      parts.push(`Laatst opgehaald ${formatDateTime(entry.lastFetchedAt)}`);
      if (entry.lastFetchedCount !== null) {
        parts.push(`${entry.lastFetchedCount} publicatie(s), waarvan ${entry.lastNewCount} nieuw`);
      }
    }
    parts.push(`${entry.synthesisedCount} verwerkt in een signalering`);

    const line = el('div', { class: 'hint', text: parts.join(' · ') });
    if (entry.lastAttemptOk === false) {
      line.append(
        el('span', {
          class: 'error',
          text: ` — laatste poging mislukt: ${entry.lastErrorMessage ?? 'onbekende fout'}`,
        }),
      );
    }
    return line;
  }

  async function testSource(source, button, output) {
    const error = validateSourceUrl(source.url);
    if (error) {
      output.textContent = error;
      output.className = 'error';
      return;
    }

    // Zonder host-toestemming faalt de fetch met een generieke netwerkfout —
    // dus die vragen we eerst, vanuit deze klik (een gebruikersgebaar).
    const origin = originPattern(source.url);
    if (origin && !(await chrome.permissions.contains({ origins: [origin] }))) {
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (!granted) {
        output.textContent = 'Geen toestemming voor deze host';
        output.className = 'error';
        refreshPermissions();
        return;
      }
      refreshPermissions();
    }

    button.disabled = true;
    output.className = 'muted';
    output.textContent = 'Testen…';
    try {
      const result = await send(Msg.TEST_SOURCE, { source });
      if (result.ok) {
        output.className = 'badge ok';
        output.textContent = `${result.count} item(s) gevonden`;
      } else {
        output.className = 'error';
        output.textContent = result.message;
      }
    } catch (err) {
      output.className = 'error';
      output.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  }

  /** Toont welke hosts nog toestemming missen, met één knop om die te vragen. */
  async function refreshPermissions() {
    const urls = draft.sources.map((s) => s.url).filter((u) => validateSourceUrl(u) === null && u);
    const origins = [...new Set(urls.map(originPattern).filter(Boolean))];

    const missing = [];
    for (const origin of origins) {
      if (!(await chrome.permissions.contains({ origins: [origin] }))) missing.push(origin);
    }

    clear(permissionNotice);
    if (missing.length === 0) return;

    permissionNotice.append(
      el('div', { class: 'permission-warning' }, [
        el('p', {
          text: `${missing.length} host(s) hebben nog geen toestemming. Zonder toestemming kan de extensie deze bronnen niet ophalen.`,
        }),
        el('ul', { class: 'source-list' }, missing.map((o) => el('li', { text: o }))),
        el('button', {
          class: 'primary',
          text: 'Toestemming vragen',
          onclick: async () => {
            await chrome.permissions.request({ origins: missing });
            refreshPermissions();
          },
        }),
      ]),
    );
  }

  const status = el('span', { class: 'muted' });
  const setStatus = (text, isError = false) => {
    status.textContent = text;
    status.className = isError ? 'error' : 'muted';
  };

  async function save() {
    if (!draft.name.trim()) {
      setStatus('Geef het profiel een naam', true);
      return;
    }
    const invalid = draft.sources.find((s) => s.url && validateSourceUrl(s.url) !== null);
    if (invalid) {
      setStatus('Corrigeer de ongeldige URL voor het opslaan', true);
      return;
    }
    draft.sources = draft.sources.filter((s) => s.url.trim());
    await send(Msg.SAVE_PROFILE, { profile: draft });
    location.hash = '#profielen';
  }

  root.append(
    el('div', { class: 'breadcrumb' }, [
      el('button', {
        class: 'icon',
        text: '← Profielen',
        onclick: () => {
          location.hash = '#profielen';
        },
      }),
    ]),
    el('h2', { text: profileId ? 'Profiel bewerken' : 'Nieuw profiel' }),
    nameField,
    categoryField,
    queryField,
    synthesisField,
    onlyNewField,
    autoField,
    el('div', { class: 'row-between section-title' }, [
      el('h3', { text: 'Bronnen' }),
      el('div', { class: 'row' }, [
        el('button', { text: 'OPML importeren', onclick: () => opmlInput.click() }),
        el('button', {
          text: 'Bron toevoegen',
          onclick: () => {
            draft.sources.push(createSource());
            renderSources();
          },
        }),
      ]),
    ]),
    permissionNotice,
    sourceList,
    opmlInput,
    el('div', { class: 'sticky-save' }, [
      el('button', { class: 'primary', text: 'Opslaan', onclick: save }),
      el('button', {
        text: 'Annuleren',
        onclick: () => {
          location.hash = '#profielen';
        },
      }),
      status,
    ]),
  );

  renderSources();
  return root;
}

function textField(label, value, onChange, hint) {
  const input = el('input', { type: 'text', value });
  input.addEventListener('input', () => onChange(input.value));
  return el('div', { class: 'field' }, [
    el('label', { text: label }),
    input,
    hint ? el('div', { class: 'hint', text: hint }) : null,
  ]);
}

function textArea(label, value, onChange, hint) {
  const input = el('textarea', { rows: 3 });
  input.value = value ?? '';
  input.addEventListener('input', () => onChange(input.value));
  return el('div', { class: 'field' }, [
    el('label', { text: label }),
    input,
    hint ? el('div', { class: 'hint', text: hint }) : null,
  ]);
}
