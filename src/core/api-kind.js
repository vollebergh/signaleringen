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

/** Bekende aanbieders: Base-URL en een voorbeeldmodel voor het instellingenscherm. */
export const KnownProviders = Object.freeze({
  [ApiKind.OPENROUTER]: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  [ApiKind.ANTHROPIC]: { label: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-haiku-5-5' },
  [ApiKind.OPENAI]: { label: 'OpenAI (ChatGPT)', baseUrl: 'https://api.openai.com/v1' },
  [ApiKind.LOCAL]: { label: 'Lokaal model (Ollama, LM Studio)', baseUrl: 'http://localhost:11434/v1' },
  [ApiKind.OTHER]: { label: 'Ander endpoint (OpenAI-compatibel)', baseUrl: '' },
});

function hostOf(url) {
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
