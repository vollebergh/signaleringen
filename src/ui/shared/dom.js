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
