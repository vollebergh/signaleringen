/**
 * Met wat voor endpoint praat de extensie? Bepaalt hoe een verzoek wordt
 * opgebouwd (B-79). Afgeleid uit de Base-URL, zodat er geen tweede instelling
 * is die ermee in tegenspraak kan zijn. Pure functies, ook in Node te testen.
 *
 * - `openrouter`: OpenRouter, met provider-routing, presets, uitwijkroute en
 *   het `reasoning`-veld. Ook de proxy-route: die stuurt volgens het
 *   proxy-contract door naar OpenRouter.
 * - `anthropic`: de Claude API (Messages API, eigen headers en antwoordvorm).
 * - `openai`: de OpenAI API (`max_completion_tokens`, geen `temperature`:
 *   redeneermodellen weigeren een andere waarde dan de standaard).
 * - `local`: een lokaal model (B-67), OpenAI-compatibel, zonder key.
 * - `other`: elk ander OpenAI-compatibel endpoint; alleen de gemeenschappelijke
 *   velden.
 */

import { isLocalBaseUrl } from './models.js';

export const ApiKind = Object.freeze({
  OPENROUTER: 'openrouter',
  ANTHROPIC: 'anthropic',
  OPENAI: 'openai',
  LOCAL: 'local',
  OTHER: 'other',
});

/** Hostnaam van een adres, in kleine letters; `null` als het geen geldig adres is. */
export function hostOf(url) {
  try {
    return new URL(String(url ?? '').trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Soort endpoint bij een Base-URL (route `direct`). */
export function apiKindOfUrl(url) {
  const host = hostOf(url);
  if (!host) return ApiKind.OTHER;
  if (isLocalBaseUrl(url)) return ApiKind.LOCAL;
  if (host === 'openrouter.ai') return ApiKind.OPENROUTER;
  if (host === 'api.anthropic.com') return ApiKind.ANTHROPIC;
  if (host === 'api.openai.com') return ApiKind.OPENAI;
  return ApiKind.OTHER;
}

/** Soort endpoint bij de instellingen; de proxy-route telt als OpenRouter. */
export function apiKind(settings) {
  if (settings?.transport === 'proxy') return ApiKind.OPENROUTER;
  return apiKindOfUrl(settings?.directBaseUrl);
}

/** Werken provider-routing, presets en de uitwijkroute? Alleen bij OpenRouter. */
export const supportsOpenRouterFeatures = (settings) => apiKind(settings) === ApiKind.OPENROUTER;

/**
 * Is er een adres ingevuld: het proxy-adres, of de Base-URL? Zonder werkt de
 * extensie als feedlezer (B-82).
 */
export function hasEndpoint(settings) {
  const value = settings?.transport === 'proxy' ? settings.proxyUrl : settings?.directBaseUrl;
  return Boolean(String(value ?? '').trim());
}

/**
 * Tonen en controleren we provider-routing en uitwijkroute? Bij OpenRouter, en
 * zolang er nog geen adres is: dan toont het scherm ze met het voorbeeld van
 * OpenRouter (CR-36). Eén afweging voor het scherm en voor `validateRouting`.
 */
export const routingFieldsApply = (settings) => supportsOpenRouterFeatures(settings) || !hasEndpoint(settings);

/**
 * Hoort de key van het taalmodel bij de huidige Base-URL (S-16)? De key wordt
 * bij het opslaan aan de host van de Base-URL gebonden (`directApiKeyHost`).
 * Verandert de Base-URL daarna naar een andere host, dan gaat de key niet mee:
 * anders belandt bijvoorbeeld een OpenRouter-key bij een willekeurig adres.
 * Zonder vastgelegde host is de key ongebonden en gaat hij nergens heen.
 */
export function keyBelongsToBaseUrl(settings) {
  const host = hostOf(settings?.directBaseUrl);
  const keyHost = String(settings?.directApiKeyHost ?? '').trim().toLowerCase();
  return Boolean(host) && host === keyHost;
}

/** Waarom de key niet meegaat, in mensentaal (S-16). */
export function keyHostMessage(settings) {
  const keyHost = String(settings?.directApiKeyHost ?? '').trim();
  const host = hostOf(settings?.directBaseUrl) ?? 'dit adres';
  return keyHost
    ? `De API-key hoort bij ${keyHost}, niet bij ${host}. Vul bij Instellingen een key in voor ${host}, of zet de Base-URL terug.`
    : `Onbekend bij welk adres deze API-key hoort. Vul de key opnieuw in bij Instellingen en sla op.`;
}
