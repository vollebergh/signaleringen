/**
 * Instellingen in `chrome.storage.local`. Tegenhanger van SettingsRepository.kt.
 *
 * ⚠️ Browseropslag is niet versleuteld — anders dan EncryptedSharedPreferences
 * op Android. Een API-key die hier staat is leesbaar voor wie bij het
 * browserprofiel kan, en gaat mee in een backup of profielsynchronisatie.
 * Aanvaardbaar bij een persoonlijke key met uitgavenlimiet; niet bij een key
 * die meerdere mensen delen — daarvoor is de proxy-route. Zie de
 * architectuurnotitie in de vault voor de afweging.
 */

import { DefaultSettings } from '../core/config.js';
import { log } from '../core/logger.js';

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

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  log.info('Instellingen opgeslagen');
  return next;
}

/**
 * Is er genoeg geconfigureerd om een scan te kunnen draaien?
 * Tegenhanger van `isConfigured()`.
 */
export async function isConfigured(settings) {
  const s = settings ?? (await getSettings());
  if (s.transport === 'proxy') return Boolean(s.proxyUrl?.trim());
  return Boolean(s.directApiKey?.trim() && s.directBaseUrl?.trim());
}

/** Beschrijft in mensentaal wat er ontbreekt. */
export function missingConfigMessage(settings) {
  if (settings.transport === 'proxy') {
    return 'Stel eerst het proxy-adres in bij Instellingen.';
  }
  return 'Vul eerst je API-key in bij Instellingen.';
}
