/**
 * Instellingen: verbinding, model en thema. Tegenhanger van SettingsScreen.kt.
 *
 * Standaardroute is `direct`: iedere gebruiker voert zijn eigen API-key in.
 * `proxy` blijft beschikbaar voor de situatie waarin één key door meerdere
 * mensen gebruikt wordt — dan hoort de key niet in de browser thuis.
 */

import { Msg, send } from '../../../core/messages.js';
import { el, clear } from '../../shared/dom.js';
import { originPattern } from '../../../background/permissions.js';

/**
 * Modelvoorstellen. De preset draagt zijn eigen provider-routing
 * (`order: ["deepinfra"]`, `allow_fallbacks: false`) en is daarom de
 * aanbevolen keuze — zie [[Referentie - OpenRouter workspace en provider-routing]].
 */
const MODEL_PRESETS = [
  { label: 'OpenRouter-preset (aanbevolen)', value: '@preset/signaleringen' },
  { label: 'DeepSeek V4 Flash 0731', value: 'deepseek/deepseek-v4-flash-0731' },
  { label: 'Claude Haiku 4.5', value: 'anthropic/claude-haiku-4.5' },
];

export async function renderSettings() {
  const settings = await send(Msg.GET_SETTINGS);
  const root = el('div');
  const status = el('span', { class: 'muted' });

  const draft = { ...settings };

  // ── Transport ─────────────────────────────────────────────────────────────
  const transportSelect = el('select', {}, [
    el('option', { value: 'direct', text: 'Eigen API-key in deze browser' }),
    el('option', { value: 'proxy', text: 'Via een eigen proxy' }),
  ]);
  transportSelect.value = draft.transport;

  const proxyFields = el('div');
  const directFields = el('div');

  const proxyUrl = input('url', draft.proxyUrl, (v) => {
    draft.proxyUrl = v;
  });
  const proxyToken = input('password', draft.proxyToken, (v) => {
    draft.proxyToken = v;
  });

  proxyFields.append(
    field('Proxy-adres', proxyUrl, 'Bijv. https://hp-mini.tailnet.ts.net/signaleringen — de extensie voegt zelf /chat/completions toe.'),
    field('Proxy-token (optioneel)', proxyToken, 'Gedeeld token om de proxy af te schermen. Dit is géén provider-key.'),
  );

  const directBaseUrl = input('url', draft.directBaseUrl, (v) => {
    draft.directBaseUrl = v;
  });
  const directApiKey = input('password', draft.directApiKey, (v) => {
    draft.directApiKey = v;
  });

  directFields.append(
    field('API-key', directApiKey, 'Je eigen OpenRouter-key uit de workspace signaleringen.'),
    field('Base-URL', directBaseUrl, 'Bijv. https://openrouter.ai/api/v1'),
    el('div', { class: 'permission-warning' }, [
      el('p', {
        text: 'Browseropslag is niet versleuteld: deze key staat leesbaar op schijf en gaat mee in een profielbackup of -synchronisatie. Gebruik daarom een key die alleen van jou is, met een uitgavenlimiet — geen key die je met anderen deelt.',
      }),
    ]),
  );

  const syncTransport = () => {
    proxyFields.style.display = draft.transport === 'proxy' ? '' : 'none';
    directFields.style.display = draft.transport === 'direct' ? '' : 'none';
  };
  transportSelect.addEventListener('change', () => {
    draft.transport = transportSelect.value;
    syncTransport();
  });
  syncTransport();

  // ── Model ─────────────────────────────────────────────────────────────────
  const modelInput = input('text', draft.model, (v) => {
    draft.model = v;
  });

  const presetRow = el(
    'div',
    { class: 'actions', style: 'margin-bottom:8px' },
    MODEL_PRESETS.map((preset) =>
      el('button', {
        text: preset.label,
        onclick: () => {
          draft.model = preset.value;
          modelInput.value = preset.value;
        },
      }),
    ),
  );

  // ── Automatisch synthetiseren ─────────────────────────────────────────────
  // Hoofdschakelaar. Het interval staat per profiel — verschillende onderwerpen
  // hebben verschillende tempo's, en één globaal interval zou dat platslaan.
  const autoCheckbox = el('input', { type: 'checkbox' });
  autoCheckbox.checked = Boolean(draft.autoScanEnabled);
  autoCheckbox.style.width = 'auto';

  const autoStatus = el('div', { class: 'hint' });

  const refreshAutoStatus = async () => {
    if (!autoCheckbox.checked) {
      autoStatus.className = 'hint';
      autoStatus.textContent =
        'Uit: er wordt alleen gescand wanneer je op Scan klikt bij een profiel.';
      return;
    }
    const granted = await chrome.permissions.contains({ permissions: ['alarms'] });
    autoStatus.className = granted ? 'hint' : 'hint error';
    autoStatus.textContent = granted
      ? 'Aan: profielen waarbij je dit hebt ingeschakeld worden op hun eigen interval gescand en gesynthetiseerd. De extensie controleert elk kwartier wie aan de beurt is. Stel het interval per profiel in bij Bewerken.'
      : 'De permissie voor achtergrondtaken is nog niet verleend — sla op om die te vragen.';
  };

  autoCheckbox.addEventListener('change', async () => {
    // Toestemming vragen vanuit deze klik; een `await` ervoor zou het
    // gebruikersgebaar verspelen dat de browser voor de prompt eist.
    if (autoCheckbox.checked) {
      const granted = await chrome.permissions.request({ permissions: ['alarms'] });
      if (!granted) {
        autoCheckbox.checked = false;
        draft.autoScanEnabled = false;
        autoStatus.className = 'hint error';
        autoStatus.textContent =
          'Zonder de permissie voor achtergrondtaken kan de extensie niet zelf scannen.';
        return;
      }
    }
    draft.autoScanEnabled = autoCheckbox.checked;
    refreshAutoStatus();
  });

  const autoField = el('div', { class: 'field' }, [
    el('label', { class: 'row', style: 'color:var(--text)' }, [
      autoCheckbox,
      el('span', { text: 'Profielen automatisch scannen en synthetiseren' }),
    ]),
    autoStatus,
    el('div', {
      class: 'hint',
      text: 'Dit vraagt de optionele permissie voor achtergrondtaken. Zolang deze schakelaar uit staat, gebruikt de extensie die permissie niet en scant ze nooit uit zichzelf.',
    }),
  ]);
  refreshAutoStatus();

  // ── Thema ─────────────────────────────────────────────────────────────────
  const themeSelect = el('select', {}, [
    el('option', { value: 'system', text: 'Systeem' }),
    el('option', { value: 'light', text: 'Licht' }),
    el('option', { value: 'dark', text: 'Donker' }),
  ]);
  themeSelect.value = draft.theme;
  themeSelect.addEventListener('change', () => {
    draft.theme = themeSelect.value;
    if (draft.theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = draft.theme;
  });

  root.append(
    el('h2', { text: 'Instellingen' }),

    el('h3', { class: 'section-title', text: 'Verbinding' }),
    field('Route', transportSelect),
    proxyFields,
    directFields,

    el('h3', { class: 'section-title', text: 'Model' }),
    presetRow,
    field(
      'Model of preset',
      modelInput,
      'Een preset (@preset/…) draagt zijn eigen provider-routing. Bij een kaal model-id stuurt de extensie zelf provider "deepinfra" mee, zonder fallback.',
    ),

    el('h3', { class: 'section-title', text: 'Weergave' }),
    field('Thema', themeSelect),

    el('h3', { class: 'section-title', text: 'Automatisch synthetiseren' }),
    autoField,

    el('div', { class: 'sticky-save' }, [
      el('button', { class: 'primary', text: 'Opslaan', onclick: (e) => save(e.currentTarget) }),
      el('button', { text: 'Verbinding testen', onclick: (e) => test(e.currentTarget) }),
      status,
    ]),
  );

  async function save(button) {
    button.disabled = true;
    status.className = 'muted';
    status.textContent = 'Opslaan…';
    try {
      // De proxy is een host als elke andere: zonder toestemming blokkeert de
      // browser de fetch vanuit de service worker.
      if (draft.transport === 'proxy' && draft.proxyUrl.trim()) {
        const origin = originPattern(draft.proxyUrl);
        if (origin && !(await chrome.permissions.contains({ origins: [origin] }))) {
          const granted = await chrome.permissions.request({ origins: [origin] });
          if (!granted) {
            status.className = 'error';
            status.textContent = 'Zonder toestemming voor de proxy-host werkt de verbinding niet.';
            button.disabled = false;
            return;
          }
        }
      }

      await send(Msg.SAVE_SETTINGS, { patch: draft });
      status.className = 'muted';
      status.textContent = 'Opgeslagen.';
    } catch (err) {
      status.className = 'error';
      status.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  }

  async function test(button) {
    button.disabled = true;
    status.className = 'muted';
    status.textContent = 'Testen…';
    try {
      const { reply } = await send(Msg.TEST_CONNECTION);
      status.className = 'badge ok';
      status.textContent = `Verbinding werkt — antwoord: "${reply}"`;
    } catch (err) {
      status.className = 'error';
      status.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  }

  return root;
}

function input(type, value, onChange) {
  const node = el('input', { type, value: value ?? '' });
  node.addEventListener('input', () => onChange(node.value));
  return node;
}

function field(label, control, hint) {
  return el('div', { class: 'field' }, [
    el('label', { text: label }),
    control,
    hint ? el('div', { class: 'hint', text: hint }) : null,
  ]);
}

