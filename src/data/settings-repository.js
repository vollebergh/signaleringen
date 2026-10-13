/**
 * Instellingen in `chrome.storage.local`. Tegenhanger van SettingsRepository.kt.
 *
 * ⚠️ Browseropslag is niet versleuteld. Een API-key die leesbaar in de
 * instellingen staat, is leesbaar voor wie bij het browserprofiel kan, en gaat
 * mee in een backup of profielsynchronisatie. Aanvaardbaar bij een persoonlijke
 * key met uitgavenlimiet (B-D09). Wie dat niet wil, zet de key in de vault
 * (hieronder, B-49). Zie de architectuurnotitie in de Obsidian-vault.
 */

import { DefaultSettings } from '../core/config.js';
import { log } from '../core/logger.js';
import { createVault, decryptVault, unlockVault } from '../core/vault.js';
import { isLocalBaseUrl } from '../core/models.js';

const KEY = 'settings';

/**
 * Optioneel bestand in de extensiemap met lokale standaardwaarden, bijvoorbeeld
 * een vooringevulde API-key tijdens eigen gebruik. Staat in `.gitignore` en
 * zit dus niet in een pakket dat met `git archive` gemaakt wordt: collega's
 * krijgen een leeg key-veld en vullen hun eigen key in (B-D09).
 */
const LOCAL_SETTINGS_FILE = 'local-settings.json';

let localDefaults;

async function loadLocalDefaults() {
  localDefaults ??= fetch(chrome.runtime.getURL(LOCAL_SETTINGS_FILE))
    .then((response) => (response.ok ? response.json() : {}))
    .catch(() => ({})); // bestand ontbreekt: gewone situatie in een uitrolpakket
  return localDefaults;
}

/**
 * Standaardwaarden ← lokaal bestand ← opgeslagen instellingen. Uit het lokale
 * bestand tellen alleen bekende sleutels, en alleen als het geen lege waarde
 * is — een lege `directApiKey` in het bestand laat de standaard staan.
 */
export function mergeSettings(defaults, local, stored) {
  const known = Object.fromEntries(
    Object.entries(local ?? {}).filter(
      ([key, value]) => Object.hasOwn(defaults, key) && value !== '' && value != null,
    ),
  );
  return { ...defaults, ...known, ...(stored ?? {}) };
}

export async function getSettings() {
  const [stored, local] = await Promise.all([chrome.storage.local.get(KEY), loadLocalDefaults()]);
  return mergeSettings(DefaultSettings, local, stored[KEY]);
}

/**
 * Wat er van `next` opgeslagen moet worden: alleen bekende sleutels die
 * afwijken van standaard ← lokaal bestand (CR-03). Zo komt een key uit
 * local-settings.json niet in de browseropslag terecht, en verdwijnt hij weer
 * als hij uit het bestand gaat. Een bewuste afwijking blijft wel staan, ook
 * een lege waarde: die wint van het bestand (vault, zie hieronder).
 * Geëxporteerd voor de tests.
 */
export function settingsToStore(defaults, local, next) {
  const base = mergeSettings(defaults, local, {});
  return Object.fromEntries(
    Object.entries(next).filter(
      ([key, value]) => Object.hasOwn(defaults, key) && JSON.stringify(value) !== JSON.stringify(base[key]),
    ),
  );
}

export async function saveSettings(patch) {
  const [current, local] = await Promise.all([getSettings(), loadLocalDefaults()]);
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [KEY]: settingsToStore(DefaultSettings, local, next) });
  log.info('Instellingen opgeslagen');
  return next;
}

// ── Vault (B-49) ────────────────────────────────────────────────────────────
//
// Optioneel: de key versleuteld met een wachtwoordzin. De blob staat in
// `chrome.storage.local`, de afgeleide sleutel in `chrome.storage.session`
// (geheugen; weg bij een herstart van de browser). Zolang de vault bestaat is
// `directApiKey` in de instellingen leeg — een lege opgeslagen waarde wint ook
// van een key in local-settings.json, zie `mergeSettings`.

const VAULT_KEY = 'vault';
const SESSION_KEY = 'vaultSessionKey';

/** De geheimen die in de vault gaan: de key van het taalmodel en die van de voorfilter. */
const VAULTED = ['directApiKey', 'prefilterApiKey'];

/**
 * Inhoud van de vault → geheimen. Sinds de voorfilter een eigen key kan
 * hebben, is dat JSON met beide; een oudere vault bevat alleen de kale key.
 * Geëxporteerd voor de tests.
 */
export function parseVaultSecret(secret) {
  try {
    const parsed = JSON.parse(secret);
    if (parsed && typeof parsed === 'object' && 'directApiKey' in parsed) {
      return Object.fromEntries(VAULTED.map((field) => [field, String(parsed[field] ?? '')]));
    }
  } catch {
    // geen JSON: een vault van vóór de voorfilter-key
  }
  return { directApiKey: secret, prefilterApiKey: '' };
}

async function readVault() {
  return (await chrome.storage.local.get(VAULT_KEY))[VAULT_KEY] ?? null;
}

async function readSessionKey() {
  return (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] ?? null;
}

/**
 * Stand van de vault voor de UI. `localFileHasKey` waarschuwt dat
 * local-settings.json nog een leesbare key bevat: die beschermt de vault niet.
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
  await chrome.storage.local.set({ [VAULT_KEY]: vault });
  await chrome.storage.session.set({ [SESSION_KEY]: sessionKey });
  await saveSettings(Object.fromEntries(VAULTED.map((field) => [field, ''])));
  log.info('Vault aangemaakt; key staat niet meer leesbaar in de instellingen');
}

export async function unlock(passphrase) {
  const vault = await readVault();
  if (!vault) throw new Error('Er is geen vault');
  await chrome.storage.session.set({ [SESSION_KEY]: await unlockVault(vault, passphrase) });
  log.info('Vault ontgrendeld');
}

export async function lock() {
  await chrome.storage.session.remove(SESSION_KEY);
  log.info('Vault vergrendeld');
}

/** Heft de vault op en zet de key weer leesbaar in de instellingen. Vereist een ontgrendelde vault. */
export async function disableVault() {
  const vault = await readVault();
  if (!vault) return;
  const sessionKey = await readSessionKey();
  if (!sessionKey) throw new Error('Ontgrendel de vault eerst');
  await saveSettings(parseVaultSecret(await decryptVault(vault, sessionKey)));
  await chrome.storage.local.remove(VAULT_KEY);
  await lock();
  log.info('Vault opgeheven');
}

export class VaultLockedError extends Error {
  constructor() {
    super('De API-key is vergrendeld. Open Instellingen en ontgrendel de vault met je wachtwoordzin.');
    this.name = 'VaultLockedError';
  }
}

/**
 * Instellingen met de bruikbare key erin, voor de LLM-aanroep. Haalt de key
 * uit de vault als die bestaat; gooit `VaultLockedError` als hij op slot zit.
 * De ontsleutelde key blijft in het geheugen van deze aanroep en wordt
 * nergens weggeschreven.
 */
export async function withApiKey(settings) {
  // Alleen de vault openen als er een key nodig is die er niet leesbaar staat.
  // Een lokaal model heeft geen key nodig (B-67): een vergrendelde vault
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

/**
 * Is er genoeg geconfigureerd om een scan te kunnen draaien?
 * Tegenhanger van `isConfigured()`. Een vergrendelde vault telt als
 * geconfigureerd; `withApiKey` meldt daarna dat hij op slot zit.
 */
export async function isConfigured(settings) {
  const s = settings ?? (await getSettings());
  if (s.transport === 'proxy') return Boolean(s.proxyUrl?.trim());
  if (!s.directBaseUrl?.trim()) return false;
  if (isLocalBaseUrl(s.directBaseUrl)) return true;
  return Boolean(s.directApiKey?.trim()) || Boolean(await readVault());
}

/** Beschrijft in mensentaal wat er ontbreekt. */
export function missingConfigMessage(settings) {
  if (settings.transport === 'proxy') {
    return 'Stel eerst het proxy-adres in bij Instellingen.';
  }
  return 'Vul eerst je API-key in bij Instellingen.';
}
