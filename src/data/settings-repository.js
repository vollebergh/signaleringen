/**
 * Instellingen in `chrome.storage.local`. Tegenhanger van SettingsRepository.kt.
 *
 * ⚠️ Browseropslag is niet versleuteld. Een API-key die leesbaar in de
 * instellingen staat, is leesbaar voor wie bij het browserprofiel kan, en gaat
 * mee in een backup of profielsynchronisatie. Aanvaardbaar bij een persoonlijke
 * key met uitgavenlimiet (B-D09). Wie dat niet wil, zet de key in de vault
 * (vault-repository.js, B-49). Zie de architectuurnotitie in de Obsidian-vault.
 */

import { DefaultSettings } from '../core/config.js';
import { log } from '../core/logger.js';
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

export async function loadLocalDefaults() {
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
 * een lege waarde: die wint van het bestand (vault, zie vault-repository.js).
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

// De vault zelf (B-49) staat in vault-repository.js; die bouwt hierop voort.
// Hier alleen de opslagsleutel, zodat `isConfigured` een vault kan zien
// zonder dat de import de andere kant op loopt (CR-16).
export const VAULT_STORAGE_KEY = 'vault';

async function hasVault() {
  return Boolean((await chrome.storage.local.get(VAULT_STORAGE_KEY))[VAULT_STORAGE_KEY]);
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
  return Boolean(s.directApiKey?.trim()) || (await hasVault());
}

/** Beschrijft in mensentaal wat er ontbreekt. */
export function missingConfigMessage(settings) {
  if (settings.transport === 'proxy') {
    return 'Stel eerst het proxy-adres in bij Instellingen.';
  }
  return 'Vul eerst je API-key in bij Instellingen.';
}
