/**
 * Domeinmodellen. Tegenhanger van `data/Models.kt`.
 *
 * Verschil met de Android-app: een profiel draagt hier ook een
 * `synthesisPrompt` — de eigen instructie waarmee de LLM de relevante
 * publicaties tot één signalering over het profielonderwerp bundelt.
 */

import { AppConfig } from './config.js';

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
