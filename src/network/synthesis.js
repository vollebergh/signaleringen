/**
 * De signalering: de hoogst scorende relevante publicaties van één profiel tot
 * één samenhangend bericht, met controle van de bronverwijzingen (B-44, B-45).
 * Gesplitst uit llm-client.js (CR-14).
 */

import { AppConfig } from '../core/config.js';
import { complete } from './llm-transport.js';
import { fencePublication, newMarker, sanitizeUntrusted, untrustedDataRule } from './prompt-safety.js';

const SYNTHESIS_SYSTEM_PROMPT = `Je stelt signaleringen op. Je krijgt publicaties die relevant zijn bevonden voor één onderwerp en schrijft daarover één samenhangend bericht in het Nederlands.

Richtlijnen:
- Begin met de kern: wat is er nieuw of veranderd rond dit onderwerp?
- Groepeer publicaties die over hetzelfde gaan; herhaal niets.
- Verwijs naar bronnen met het nummer uit nr="…" tussen blokhaken, bijvoorbeeld [3]. Elke inhoudelijke bewering krijgt een verwijzing.
- Noem expliciet wanneer bronnen elkaar tegenspreken.
- Verzin niets dat niet in de aangeleverde publicaties staat.
- Geen inleidende beleefdheden, geen afsluitende samenvatting van jezelf.

Antwoord in platte tekst met korte alinea's. Gebruik geen markdown-koppen.`;

/**
 * Kiest de publicaties voor de synthese (B-45): de hoogst scorende, bij
 * gelijke score de nieuwste. Zonder score (oudere scans) telt alleen de datum.
 */
export function selectForSynthesis(relevant, max) {
  return [...relevant]
    .sort((a, b) => {
      const byScore = (b.score ?? -1) - (a.score ?? -1);
      if (byScore !== 0) return byScore;
      return (b.publication.publishedDate ?? 0) - (a.publication.publishedDate ?? 0);
    })
    .slice(0, max);
}

/**
 * Bundelt de relevante publicaties van één profiel tot één signalering.
 *
 * @param {object} profile het profiel, inclusief eventuele `synthesisPrompt`
 * @param {Array<{publication: object, shortDescription: string}>} relevant
 * @param {object} settings
 * @returns {Promise<{text: string, sources: Array<{index: number, title: string, url: string, sourceName: string}>, warnings: string[]}>}
 */
export async function synthesizeProfile(profile, relevant, settings) {
  if (relevant.length === 0) {
    return { text: '', sources: [] };
  }

  const sources = relevant.map((result, index) => ({
    index: index + 1,
    title: result.publication.title,
    url: result.publication.url,
    sourceName: result.publication.sourceName,
  }));

  const marker = newMarker();
  const list = relevant
    .map((result, index) => {
      const pub = result.publication;
      const date = pub.publishedDate ? new Date(pub.publishedDate).toISOString().slice(0, 10) : 'datum onbekend';
      return fencePublication(
        index + 1,
        [
          ['titel', sanitizeUntrusted(pub.title, AppConfig.PROMPT_TITLE_MAX_CHARS)],
          ['bron', `${sanitizeUntrusted(pub.sourceName, AppConfig.PROMPT_SOURCE_NAME_MAX_CHARS)} — ${date}`],
          ['kern', sanitizeUntrusted(result.shortDescription, AppConfig.PROMPT_SYNTHESIS_SUMMARY_MAX_CHARS)],
          ['tekst', sanitizeUntrusted(pub.description, AppConfig.PROMPT_SYNTHESIS_TEXT_MAX_CHARS)],
        ],
        marker,
      );
    })
    .join('\n\n');

  const instruction = profile.synthesisPrompt?.trim()
    ? `\n\nAANVULLENDE INSTRUCTIE VAN DE GEBRUIKER:\n${profile.synthesisPrompt.trim()}`
    : '';

  const text = await complete(settings, {
    system: `${SYNTHESIS_SYSTEM_PROMPT}\n\n${untrustedDataRule(marker)}`,
    user: `ONDERWERP: ${profile.name}\nWAAR DE GEBRUIKER OP LET: ${profile.userQuery}${instruction}\n\nPUBLICATIES:\n${list}`,
    maxTokens: AppConfig.SYNTHESIS_MAX_TOKENS,
    temperature: AppConfig.SYNTHESIS_TEMPERATURE,
  });

  const trimmed = text.trim();
  return { text: trimmed, sources, warnings: checkCitations(trimmed, sources.length) };
}

/**
 * Controleert de bronverwijzingen in een signalering. Een signalering zonder
 * verwijzingen, of met nummers die niet bestaan, wijst op een model dat van
 * het bronmateriaal is afgedwaald — door prompt-injectie of gewoon door
 * hallucinatie. Het resultaat blijft bewaard; de waarschuwing wordt getoond.
 * Geëxporteerd voor de tests.
 * @returns {string[]} waarschuwingen, leeg als alles klopt
 */
export function checkCitations(text, sourceCount) {
  if (!text) return [];
  const cited = [...text.matchAll(/\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g)]
    .flatMap((m) => m[1].split(/[,–-]/).map((n) => Number(n.trim())));
  const warnings = [];
  if (cited.length === 0) {
    warnings.push('De signalering bevat geen bronverwijzingen. Controleer de inhoud aan de hand van de publicaties.');
  }
  const unknown = [...new Set(cited.filter((n) => n < 1 || n > sourceCount))];
  if (unknown.length > 0) {
    warnings.push(`De signalering verwijst naar bronnen die niet bestaan: [${unknown.join('], [')}].`);
  }
  return warnings;
}
