/**
 * Instellingen in `chrome.storage.local`. Tegenhanger van SettingsRepository.kt.
 *
 * ⚠️ Browseropslag is niet versleuteld. Een API-key die leesbaar in de
 * instellingen staat, is leesbaar voor wie bij het browserprofiel kan, en gaat
 * mee in een backup of profielsynchronisatie. Aanvaardbaar bij een persoonlijke
 * key met uitgavenlimiet (B-D09). Wie dat niet wil, zet de key in de wachtwoordkluis
 * (vault-repository.js, B-49). Zie de architectuurnotitie in de Obsidian-vault.
 */

import { DefaultSettings, SuggestedConnection } from '../core/config.js';
import { log } from '../core/logger.js';
import { isLocalBaseUrl } from '../core/models.js';
import { hostOf } from '../core/api-kind.js';

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
 * een lege waarde: die wint van het bestand (wachtwoordkluis, zie vault-repository.js).
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
  // Een nieuwe key hoort bij de Base-URL waarmee hij wordt opgeslagen (S-16).
  // Wie alleen de Base-URL verandert, houdt de binding: de key gaat dan niet
  // mee naar de nieuwe host. Een expliciete `directApiKeyHost` in de patch
  // (het opheffen van de wachtwoordkluis) wint.
  const newKey = String(next.directApiKey ?? '').trim();
  if (newKey && newKey !== String(current.directApiKey ?? '').trim() && !Object.hasOwn(patch, 'directApiKeyHost')) {
    next.directApiKeyHost = hostOf(next.directBaseUrl) ?? '';
  }
  // Key opgeslagen toen er nog geen Base-URL was: binden aan het eerste adres.
  else if (newKey && !next.directApiKeyHost && !hostOf(current.directBaseUrl)) {
    next.directApiKeyHost = hostOf(next.directBaseUrl) ?? '';
  }
  await chrome.storage.local.set({ [KEY]: settingsToStore(DefaultSettings, local, next) });
  log.info('Instellingen opgeslagen');
  return next;
}

// De wachtwoordkluis zelf (B-49) staat in vault-repository.js; die bouwt hierop voort.
// Hier alleen de opslagsleutel, zodat `isConfigured` een kluis kan zien
// zonder dat de import de andere kant op loopt (CR-16).
export const VAULT_STORAGE_KEY = 'vault';

async function hasVault() {
  return Boolean((await chrome.storage.local.get(VAULT_STORAGE_KEY))[VAULT_STORAGE_KEY]);
}

/**
 * Is er genoeg geconfigureerd om een scan te kunnen draaien?
 * Tegenhanger van `isConfigured()`. Een vergrendelde kluis telt als
 * geconfigureerd; `withApiKey` meldt daarna dat hij op slot zit.
 */
export async function isConfigured(settings) {
  const s = settings ?? (await getSettings());
  // Zonder model geen taalmodel (sinds 0.25.6 is het standaard leeg).
  if (!s.model?.trim()) return false;
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
  return 'Vul eerst Base-URL, model en API-key in bij Instellingen.';
}

/** De versie waarin Base-URL, model en routing standaard leeg werden. */
export const CONNECTION_DEFAULTS_EMPTIED_IN = '0.25.6';

/** De versie waarin de key aan de host van de Base-URL werd gebonden (S-16). */
export const KEY_HOST_BOUND_IN = '0.26.0';

/** Is versie `a` ouder dan `b`? Alleen cijfers met punten, zoals in het manifest. */
export function versionBefore(a, b) {
  const pa = String(a ?? '').split('.').map(Number);
  const pb = String(b ?? '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0;
  }
  return false;
}

/**
 * Zet de standaarden van vóór 0.25.6 vast voor een installatie die erop
 * leunde (0.25.6 maakte Base-URL, model en routing leeg). `saveSettings`
 * bewaart alleen afwijkingen (CR-03), dus wie de oude standaard gebruikte, had
 * die velden niet opgeslagen en zou na de update zonder taalmodel staan.
 * Alleen bij een installatie die al in gebruik was: opgeslagen instellingen,
 * een wachtwoordkluis, of een key in `local-settings.json` (CR-35). Een verse
 * installatie begint leeg. Idempotent, maar alleen aanroepen bij een update
 * vanaf een versie vóór `CONNECTION_DEFAULTS_EMPTIED_IN`: daarna betekent een
 * ontbrekend veld dat de gebruiker het bewust leeg liet.
 * @returns {Promise<string[]>} de velden die zijn vastgezet
 */
export async function migrateConnectionDefaults() {
  const stored = await chrome.storage.local.get([KEY, VAULT_STORAGE_KEY]);
  const settings = stored[KEY];
  const local = await loadLocalDefaults();
  if (!settings && !stored[VAULT_STORAGE_KEY] && !local?.directApiKey?.trim()) return [];
  const pinned = Object.fromEntries(
    Object.entries(SuggestedConnection).filter(([field]) => !Object.hasOwn(settings ?? {}, field)),
  );
  if (Object.keys(pinned).length === 0) return [];
  await chrome.storage.local.set({ [KEY]: { ...(settings ?? {}), ...pinned } });
  log.info(`Standaarden van vóór 0.25.6 vastgezet: ${Object.keys(pinned).join(', ')}`);
  return Object.keys(pinned);
}

/**
 * Bindt een bestaande key aan de host van de huidige Base-URL (S-16). Vóór
 * 0.26.0 was een key nergens aan gebonden; zonder deze migratie zou hij na de
 * update nergens meer heen gaan. Draait na `migrateConnectionDefaults`, zodat
 * wie op de oude standaard leunde aan openrouter.ai wordt gebonden. Alleen bij
 * een key (opgeslagen, in de wachtwoordkluis of in `local-settings.json`) en
 * een geldige Base-URL; een al vastgelegde host blijft staan. Alleen aanroepen
 * bij een update vanaf een versie vóór `KEY_HOST_BOUND_IN`.
 * @returns {Promise<string>} de vastgelegde host, of '' als er niets te doen was
 */
export async function migrateKeyHost() {
  const stored = await chrome.storage.local.get([KEY, VAULT_STORAGE_KEY]);
  const settings = stored[KEY] ?? {};
  if (settings.directApiKeyHost) return '';
  const effective = await getSettings();
  const hasKey = Boolean(effective.directApiKey?.trim()) || Boolean(stored[VAULT_STORAGE_KEY]);
  const host = hostOf(effective.directBaseUrl);
  if (!hasKey || !host) return '';
  await chrome.storage.local.set({ [KEY]: { ...settings, directApiKeyHost: host } });
  log.info(`Key gebonden aan ${host} (S-16)`);
  return host;
}
