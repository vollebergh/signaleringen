/**
 * Controle van de verbindings- en routing-instellingen. Pure functies, gebruikt
 * door het instellingenscherm, de worker (bij opslaan) en de LLM-client (bij
 * elke aanroep) — daarom in de kern (CR-13).
 */

import { isLocalBaseUrl } from './models.js';
import { hasEndpoint, routingFieldsApply } from './api-kind.js';

/**
 * Controleert het adres van het taalmodel of de proxy (S-02): https, of http
 * alleen naar een lokaal adres (B-67). Anders gaat de key of het proxy-token
 * leesbaar over het netwerk. Een leeg adres is hier geen fout; dat meldt
 * `isConfigured`. Gebruikt door het instellingenscherm, de worker en de LLM-client.
 * @returns {string[]} foutmeldingen, leeg als het adres in orde is
 */
export function connectionErrors(settings) {
  const label = settings?.transport === 'proxy' ? 'Proxy-adres' : 'Base-URL';
  const value = String((settings?.transport === 'proxy' ? settings.proxyUrl : settings?.directBaseUrl) ?? '').trim();
  if (!value) return [];
  let url;
  try {
    url = new URL(value);
  } catch {
    return [`${label}: geen geldig adres`];
  }
  if (url.protocol === 'https:') return [];
  if (url.protocol === 'http:' && isLocalBaseUrl(value)) return [];
  return [`${label}: gebruik https. Alleen een lokaal adres (localhost, privénetwerk, Tailscale) mag http; anders gaat de key onversleuteld over het netwerk.`];
}

/** Kwantisaties die OpenRouter kent; als achtervoegsel in een providertag. */
export const QUANTIZATIONS = ['int4', 'int8', 'fp4', 'fp6', 'fp8', 'fp16', 'bf16', 'fp32', 'unknown'];

/** "deepinfra/fp8, Novita" → ['deepinfra/fp8', 'novita']. Geëxporteerd voor de tests. */
export function parseList(value) {
  return String(value ?? '')
    .split(/[\s,]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Controleert de routing-instellingen; geeft foutmeldingen terug, leeg als
 * alles klopt. Elke tag is `provider` of `provider/kwantisatie`.
 * Geëxporteerd voor de tests en het instellingenscherm.
 */
export function validateRouting(settings) {
  const errors = [];
  const check = (label, routing) => {
    for (const tag of parseList(routing)) {
      const [provider, quantization, ...rest] = tag.split('/');
      if (!/^[a-z0-9][a-z0-9._-]*$/.test(provider) || rest.length > 0) {
        errors.push(`${label}: "${tag}" is geen providertag (vorm: provider of provider/kwantisatie, bijv. deepinfra/fp8)`);
      } else if (quantization !== undefined && !QUANTIZATIONS.includes(quantization)) {
        errors.push(`${label}: kwantisatie "${quantization}" bestaat niet (kies uit ${QUANTIZATIONS.join(', ')})`);
      }
    }
  };
  errors.push(...connectionErrors(settings));
  // Zonder adres geen taalmodel (leesmodus, B-82): dan hoeft er ook geen model.
  if (hasEndpoint(settings) && !String(settings.model ?? '').trim()) errors.push('Model: vul een model in');
  // Provider-routing en uitwijkroute gelden alleen bij OpenRouter; bij een
  // andere aanbieder verbergt het instellingenscherm ze en gebruikt
  // `routesFor` ze niet. Dan ook niet controleren, anders blokkeert Opslaan
  // op een veld dat niet te zien is (CR-28). Zolang er geen adres is, toont het
  // scherm ze wel, dus controleren we ze dan ook (CR-36).
  if (routingFieldsApply(settings)) {
    check('Provider-routing', settings.providerRouting);
    if (settings.fallbackEnabled) {
      if (!String(settings.fallbackModel ?? '').trim()) errors.push('Uitwijkroute: vul een model in, of zet de uitwijkroute uit');
      check('Uitwijkroute', settings.fallbackProviderRouting);
    }
  }
  if (settings.jevPrefilterEnabled) {
    let endpointOk = false;
    try {
      endpointOk = new URL(String(settings.prefilterEndpoint ?? '').trim()).protocol === 'https:';
    } catch {
      endpointOk = false;
    }
    if (!endpointOk) errors.push('Voorfilter: het endpoint moet een https-adres zijn');
    if (!String(settings.prefilterModel ?? '').trim()) errors.push('Voorfilter: vul een model in');
    check('Voorfilter', settings.prefilterProviderRouting);
  }
  return errors;
}
