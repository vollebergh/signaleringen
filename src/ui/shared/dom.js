/**
 * Kleine DOM-helpers. Bewust geen framework: het Edge-beleid verbiedt extern
 * gehoste scripts en leest een minifier al snel als obfuscatie, dus alle code
 * blijft leesbaar en zonder buildstap.
 */

import { Msg, send } from '../../core/messages.js';

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/**
 * Maakt een element. Tekst gaat altijd via textContent — nooit innerHTML met
 * data uit een feed, anders is de extensie zelf het XSS-gat.
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value !== null && value !== undefined && value !== false) {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/**
 * Info-knopje met toelichting die bij hover of toetsenbordfocus verschijnt.
 * Puur CSS (`.info-tip` in theme.css); de tekst staat in de DOM, zodat een
 * schermlezer hem via `aria-describedby` voorleest.
 */
let infoTipCounter = 0;
export function infoTip(text) {
  const id = `info-tip-${++infoTipCounter}`;
  return el('span', { class: 'info-tip', tabindex: '0', role: 'button', 'aria-label': 'Toelichting', 'aria-describedby': id }, [
    el('span', { class: 'info-tip-icon', 'aria-hidden': 'true', text: 'i' }),
    el('span', { class: 'info-tip-text', role: 'tooltip', id, text }),
  ]);
}

/** Label met optioneel info-knopje erachter, buiten het `<label>` zodat een klik erop niets aanvinkt. */
export function labelRow(label, hint) {
  return el('div', { class: 'label-row' }, [label, hint ? infoTip(hint) : null]);
}

/**
 * Tekst bij een voortgangsbericht van een scan, of null als de fase niet
 * "bezig" is.
 * @param {object} p voortgang uit SCAN_PROGRESS of GET_SCAN_STATE
 * @param {{ withSource?: boolean }} [options] bronnaam tonen bij het ophalen
 */
export function progressLabel(p, { withSource = false } = {}) {
  switch (p?.phase) {
    case 'starting':
      return 'Scan gestart…';
    case 'fetching':
      return withSource
        ? `Bronnen ophalen (${p.current}/${p.total}) — ${p.sourceName ?? ''}`
        : `Bronnen ophalen (${p.current}/${p.total})…`;
    case 'fulltext':
      return `Tekst ophalen (${p.done}/${p.total})…`;
    case 'prefiltering':
      return `Voorfilteren (${p.total})…`;
    case 'analyzing':
      return `Beoordelen (${p.done}/${p.total})…`;
    case 'synthesizing':
      return 'Signalering opstellen…';
    default:
      return null;
  }
}

/**
 * Vraagt de scanstatus op nadat START_SCAN zonder antwoord bleef omdat de
 * worker stopte. Het verzoek wekt de worker, die de scan dan als afgebroken
 * markeert (B-46). Geeft de foutmelding die de UI moet tonen.
 */
export async function explainScanFailure(profileId, error) {
  if (!error?.workerStopped) return error?.message ?? String(error);
  try {
    const state = await send(Msg.GET_SCAN_STATE, { profileId });
    if (state.phase === 'interrupted') return state.message;
  } catch {
    /* val terug op de oorspronkelijke melding */
  }
  return error.message;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Toont de foutmelding in het aangewezen vlak in plaats van in de console. */
export function showError(container, error) {
  clear(container);
  container.append(el('p', { class: 'error', text: error?.message ?? String(error) }));
}

/** Past het opgeslagen thema toe op het document. */
export async function applyTheme() {
  try {
    const settings = await send(Msg.GET_SETTINGS);
    if (settings.theme === 'light' || settings.theme === 'dark') {
      document.documentElement.dataset.theme = settings.theme;
    } else {
      delete document.documentElement.dataset.theme;
    }
    return settings;
  } catch {
    return null;
  }
}

const DATE_FORMAT = new Intl.DateTimeFormat('nl-NL', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const DATETIME_FORMAT = new Intl.DateTimeFormat('nl-NL', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDate(millis) {
  if (!millis) return 'datum onbekend';
  return DATE_FORMAT.format(new Date(millis));
}

export function formatDateTime(millis) {
  if (!millis) return '';
  return DATETIME_FORMAT.format(new Date(millis));
}

/**
 * Opent een URL in een nieuw tabblad. Alleen http(s) — een `javascript:`-URL
 * uit een feed mag nooit doorgegeven worden aan `tabs.create`.
 */
export function openUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
    chrome.tabs.create({ url: parsed.href });
  } catch {
    /* ongeldige URL wordt genegeerd */
  }
}

/**
 * Bronverwijzingen onder een signalering: elk nummer staat er letterlijk als
 * "[n]", zoals in de tekst. Niet via de nummering van een `<ol>`: die hangt
 * af van `list-style`, en `.source-list` zet die uit — de nummers vielen
 * daardoor weg.
 * @param {Array<{index: number, title: string, url: string, sourceName: string}>} sources
 */
export function sourceReferences(sources) {
  if (!sources?.length) return null;
  return el('div', {}, [
    el('p', { class: 'muted', style: 'margin-bottom:0', text: 'Bronverwijzingen' }),
    el(
      'ul',
      { class: 'source-references' },
      sources.map((source) =>
        el('li', {}, [
          el('span', { class: 'source-ref-nr', text: `[${source.index}]` }),
          el('span', {}, [
            source.url
            ? el('a', {
                href: source.url,
                text: source.title,
                onclick: (event) => {
                  event.preventDefault();
                  openUrl(source.url);
                },
              })
              : el('span', { text: source.title }),
            el('span', { class: 'muted', text: ` — ${source.sourceName}` }),
          ]),
        ]),
      ),
    ),
  ]);
}
