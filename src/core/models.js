/**
 * Domeinmodellen. Tegenhanger van `data/Models.kt`.
 *
 * Verschil met de Android-app: een profiel draagt hier ook een
 * `synthesisPrompt` — de eigen instructie waarmee de LLM de relevante
 * publicaties tot één signalering over het profielonderwerp bundelt.
 */

import { AppConfig, DefaultSettings } from './config.js';

export const SourceType = Object.freeze({
  RSS: 'RSS',
  WEB: 'WEB',
  // Zoekopdracht op open.overheid.nl, via de JSON-API achter de site (B-57)
  OPEN_OVERHEID: 'OPEN_OVERHEID',
});

const newId = () => crypto.randomUUID();

/**
 * @typedef {{ id: string, name: string, url: string, type: string }} Source
 * @typedef {{ id: string, name: string, userQuery: string, category: string,
 *             synthesisPrompt: string, sources: Source[], createdAt: number }} Profile
 * @typedef {{ title: string, description: string, url: string,
 *             publishedDate: number, sourceName: string }} Publication
 * @typedef {{ id: string, scanId: string, publication: Publication,
 *             shortDescription: string, isRelevant: boolean,
 *             score: number | null, relevance: 'relevant' | 'mogelijk' | 'niet',
 *             isBookmarked: boolean, isRead: boolean }} PublicationResult
 */

/** @returns {Source} */
export function createSource(partial = {}) {
  return {
    id: partial.id ?? newId(),
    name: partial.name ?? '',
    url: partial.url ?? '',
    type: partial.type ?? SourceType.RSS,
  };
}

/**
 * Terugkijktijd in hele dagen, 1 tot en met het maximum; iets anders wordt de
 * standaard.
 */
export function normalizeLookbackDays(value) {
  const days = Math.round(Number(value));
  if (!Number.isFinite(days) || days < 1) return AppConfig.DEFAULT_LOOKBACK_DAYS;
  return Math.min(days, AppConfig.MAX_LOOKBACK_DAYS);
}

/**
 * Maximaal aantal artikelen in de synthese (B-45): een heel getal vanaf 1,
 * zonder bovengrens — de gebruiker gaat over zijn eigen tokenbudget. Iets
 * anders wordt de standaard.
 */
export function normalizeSynthesisMaxArticles(value) {
  const count = Math.round(Number(value));
  if (!Number.isFinite(count) || count < 1) return DefaultSettings.synthesisMaxArticles;
  return count;
}

/** @returns {Profile} */
export function createProfile(partial = {}) {
  return {
    id: partial.id ?? newId(),
    name: partial.name ?? '',
    userQuery: partial.userQuery ?? '',
    category: partial.category ?? '',
    synthesisPrompt: partial.synthesisPrompt ?? '',
    // Standaard alleen publicaties beoordelen die dit profiel nog niet zag.
    // Scheelt tokens en maakt "nieuw" in de resultaten betekenisvol.
    onlyNewPublications: partial.onlyNewPublications ?? true,
    // Hoe ver een scan terugkijkt, in dagen (B-51). Ook voor profielen uit
    // een export van vóór dit veld: dan de standaard.
    lookbackDays: normalizeLookbackDays(partial.lookbackDays),
    // Periodiek automatisch scannen en synthetiseren. Werkt alleen als de
    // hoofdschakelaar in de instellingen aan staat; het interval is per profiel.
    autoScanEnabled: partial.autoScanEnabled ?? false,
    autoScanIntervalMinutes:
      partial.autoScanIntervalMinutes ?? AppConfig.AUTO_SCAN_DEFAULT_INTERVAL_MINUTES,
    sources: (partial.sources ?? []).map(createSource),
    createdAt: partial.createdAt ?? Date.now(),
  };
}

/** @returns {Publication} */
export function createPublication(partial) {
  return {
    title: partial.title ?? '',
    description: partial.description ?? '',
    url: partial.url ?? '',
    publishedDate: partial.publishedDate ?? 0,
    sourceName: partial.sourceName ?? '',
  };
}

/**
 * Valideert een bron-URL. Tegenhanger van `validateSourceUrl` in
 * ProfileEditScreen.kt — retourneert een foutmelding of null.
 * @returns {string | null}
 */
export function validateSourceUrl(url) {
  if (!url || !url.trim()) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return 'Ongeldige URL';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'URL moet beginnen met http:// of https://';
  }
  if (!parsed.hostname.includes('.')) {
    return 'Ongeldige URL';
  }
  return null;
}

/**
 * Wijst de Base-URL naar een lokaal model (B-67)? Localhost, een privé-adres,
 * een adres in 100.x.x.x (o.a. Tailscale) of een `.local`-naam. Zo'n server vraagt geen API-key en kent de
 * OpenRouter-velden (provider-routing, uitwijkroute, redeneren) niet.
 */
export function isLocalBaseUrl(url) {
  let host;
  try {
    host = new URL(String(url ?? '').trim()).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1') return true;
  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = octets;
  return a === 127 || a === 10 || a === 100 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/** Dupliceert een profiel met nieuwe id's, inclusief bronnen. */
export function duplicateProfile(profile) {
  return createProfile({
    ...profile,
    id: newId(),
    name: `${profile.name} (kopie)`,
    sources: profile.sources.map((s) => ({ ...s, id: newId() })),
    createdAt: Date.now(),
  });
}
