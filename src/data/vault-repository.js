/**
 * De wachtwoordkluis (B-49; in de code `vault`): de keys versleuteld met een wachtwoordzin. Gesplitst uit
 * settings-repository.js (CR-16); de versleuteling zelf staat in
 * core/vault.js.
 *
 * Optioneel. De blob staat in `chrome.storage.local`, de afgeleide sleutel in
 * `chrome.storage.session` (geheugen; weg bij een herstart van de browser).
 * Zolang de wachtwoordkluis bestaat zijn de keys in de instellingen leeg — een lege
 * opgeslagen waarde wint ook van een key in local-settings.json, zie
 * `mergeSettings`.
 */

import { log } from '../core/logger.js';
import { createVault, decryptVault, unlockVault } from '../core/vault.js';
import { isLocalBaseUrl } from '../core/models.js';
import { VAULT_STORAGE_KEY, getSettings, saveSettings, loadLocalDefaults } from './settings-repository.js';

const SESSION_KEY = 'vaultSessionKey';

/** De geheimen die in de wachtwoordkluis gaan: de key van het taalmodel en die van de voorfilter. */
const VAULTED = ['directApiKey', 'prefilterApiKey'];

/**
 * Inhoud van de wachtwoordkluis → geheimen. Sinds de voorfilter een eigen key kan
 * hebben, is dat JSON met beide; een oudere kluis bevat alleen de kale key.
 * Geëxporteerd voor de tests.
 */
export function parseVaultSecret(secret) {
  try {
    const parsed = JSON.parse(secret);
    if (parsed && typeof parsed === 'object' && 'directApiKey' in parsed) {
      return Object.fromEntries(VAULTED.map((field) => [field, String(parsed[field] ?? '')]));
    }
  } catch {
    // geen JSON: een kluis van vóór de voorfilter-key
  }
  return { directApiKey: secret, prefilterApiKey: '' };
}

async function readVault() {
  return (await chrome.storage.local.get(VAULT_STORAGE_KEY))[VAULT_STORAGE_KEY] ?? null;
}

async function readSessionKey() {
  return (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] ?? null;
}

/**
 * Stand van de wachtwoordkluis voor de UI. `localFileHasKey` waarschuwt dat
 * local-settings.json nog een leesbare key bevat: die beschermt de wachtwoordkluis niet.
 */
export async function getVaultStatus() {
  const [vault, sessionKey, local] = await Promise.all([readVault(), readSessionKey(), loadLocalDefaults()]);
  return {
    exists: Boolean(vault),
    unlocked: Boolean(vault && sessionKey),
    localFileHasKey: VAULTED.some((field) => Boolean(local?.[field]?.trim())),
  };
}

/** Versleutelt de huidige keys en haalt de leesbare versies uit de instellingen. */
export async function enableVault(passphrase) {
  const settings = await getSettings();
  const secrets = Object.fromEntries(VAULTED.map((field) => [field, settings[field] ?? '']));
  const { vault, sessionKey } = await createVault(JSON.stringify(secrets), passphrase);
  await chrome.storage.local.set({ [VAULT_STORAGE_KEY]: vault });
  await chrome.storage.session.set({ [SESSION_KEY]: sessionKey });
  await saveSettings(Object.fromEntries(VAULTED.map((field) => [field, ''])));
  log.info('Wachtwoordkluis aangemaakt; key staat niet meer leesbaar in de instellingen');
}

export async function unlock(passphrase) {
  const vault = await readVault();
  if (!vault) throw new Error('Er is geen wachtwoordkluis');
  await chrome.storage.session.set({ [SESSION_KEY]: await unlockVault(vault, passphrase) });
  log.info('Wachtwoordkluis ontgrendeld');
}

export async function lock() {
  await chrome.storage.session.remove(SESSION_KEY);
  log.info('Wachtwoordkluis vergrendeld');
}

/** Heft de wachtwoordkluis op en zet de key weer leesbaar in de instellingen. Vereist een ontgrendelde wachtwoordkluis. */
export async function disableVault() {
  const vault = await readVault();
  if (!vault) return;
  const sessionKey = await readSessionKey();
  if (!sessionKey) throw new Error('Ontgrendel de wachtwoordkluis eerst');
  await saveSettings(parseVaultSecret(await decryptVault(vault, sessionKey)));
  await chrome.storage.local.remove(VAULT_STORAGE_KEY);
  await lock();
  log.info('Wachtwoordkluis opgeheven');
}

/**
 * Zit de wachtwoordkluis op slot terwijl de key nodig is? Dezelfde afweging
 * als in `withApiKey`, maar zonder iets te ontsleutelen: voor het slotje op het
 * extensiepictogram. Een lokaal model of een leesbare key heeft geen kluis nodig.
 */
export async function isKeyLocked(settings) {
  const needsDirect =
    settings.transport === 'direct' &&
    !settings.directApiKey?.trim() &&
    !isLocalBaseUrl(settings.directBaseUrl);
  if (!needsDirect) return false;
  const [vault, sessionKey] = await Promise.all([readVault(), readSessionKey()]);
  return Boolean(vault) && !sessionKey;
}

export class VaultLockedError extends Error {
  constructor() {
    super('De API-key is vergrendeld. Open Instellingen en ontgrendel de wachtwoordkluis met je wachtwoordzin.');
    this.name = 'VaultLockedError';
  }
}

/**
 * Instellingen met de bruikbare key erin, voor de LLM-aanroep. Haalt de key
 * uit de wachtwoordkluis als die bestaat; gooit `VaultLockedError` als hij op slot zit.
 * De ontsleutelde key blijft in het geheugen van deze aanroep en wordt
 * nergens weggeschreven.
 */
export async function withApiKey(settings) {
  // Alleen de wachtwoordkluis openen als er een key nodig is die er niet leesbaar staat.
  // Een lokaal model heeft geen key nodig (B-67): een vergrendelde kluis
  // houdt de scan dan niet tegen.
  const needsDirect =
    settings.transport === 'direct' &&
    !settings.directApiKey?.trim() &&
    !isLocalBaseUrl(settings.directBaseUrl);
  const needsPrefilter = Boolean(settings.jevPrefilterEnabled) && !settings.prefilterApiKey?.trim();
  if (!needsDirect && !needsPrefilter) return settings;
  const vault = await readVault();
  if (!vault) return settings;
  const sessionKey = await readSessionKey();
  if (!sessionKey) {
    // Zonder key geen taalmodel: stoppen. Alleen de voorfilter-key missen is
    // geen reden om te stoppen; de voorfilter valt dan terug (B-58).
    if (needsDirect) throw new VaultLockedError();
    return settings;
  }
  const secrets = parseVaultSecret(await decryptVault(vault, sessionKey));
  const filled = { ...settings };
  for (const field of VAULTED) {
    if (!filled[field]?.trim()) filled[field] = secrets[field];
  }
  return filled;
}
