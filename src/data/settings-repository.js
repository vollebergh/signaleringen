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

export async function getSettings() {
  const stored = await chrome.storage.local.get(KEY);
  return { ...DefaultSettings, ...(stored[KEY] ?? {}) };
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
