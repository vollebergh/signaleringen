/**
 * Beoordeelt publicaties op relevantie voor de gebruikersvraag, per batch,
 * met een score van 0–100 (B-59). Gesplitst uit llm-client.js (CR-14).
 */

import { AppConfig } from '../core/config.js';
import { log } from '../core/logger.js';
import { complete, isLocal } from './llm-transport.js';
import { fencePublication, newMarker, sanitizeUntrusted, untrustedDataRule } from './prompt-safety.js';

const FILTER_SYSTEM_PROMPT = `Je bent een assistent die publicaties beoordeelt op relevantie voor een gebruikersvraag.
Je antwoordt ALLEEN met een valide JSON-array, zonder extra tekst of uitleg.

Elke publicatie moet beoordeeld worden. Geef voor elke publicatie een JSON-object met:
- "index": het nummer uit nr="…" van de publicatie (begint bij 0)
- "score": een geheel getal van 0 tot en met 100 voor de relevantie voor de vraag
- "samenvatting": een korte beschrijving van maximaal 15 woorden in het Nederlands

Schaal voor "score":
- 80–100: de publicatie gaat aantoonbaar over wat de vraag zoekt
- 60–79: waarschijnlijk relevant
- 30–59: twijfel — de tekst is te kort om het te beoordelen, of de publicatie raakt de vraag maar zijdelings
- 0–29: niet relevant, bijvoorbeeld een ander onderwerp of een andere betekenis van een zoekterm

Gebruik de hele schaal. Geef een lage score als de tekst laat zien dat het om iets anders gaat dan de vraag; geef een middenscore als de tekst te weinig zegt om het te weten.

Antwoord ALLEEN met de JSON-array.`;

/**
 * Deelt een score in. Geëxporteerd voor de tests.
 * @returns {'relevant' | 'mogelijk' | 'niet'}
 */
export function classifyScore(score) {
  if (score >= AppConfig.RELEVANCE_THRESHOLD) return 'relevant';
  if (score >= AppConfig.POSSIBLE_RELEVANCE_THRESHOLD) return 'mogelijk';
  return 'niet';
}

/**
 * Score uit één oordeel: een getal 0–100, of een getal als tekst. Een oud
 * of afwijkend antwoord met alleen `relevant: true/false` telt als 100/0.
 * Iets anders is geen oordeel.
 */
function readScore(item) {
  const raw = typeof item.score === 'string' ? Number(item.score.trim()) : item.score;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.min(100, Math.max(0, Math.round(raw)));
  if (item.relevant === true) return 100;
  if (item.relevant === false) return 0;
  return null;
}

/**
 * Beoordeelt publicaties op relevantie. Verwerkt in batches zodat een lange
 * lijst niet in één afgekapte response eindigt (backlogitem B-20 in de app).
 *
 * @param {import('../core/models.js').Publication[]} publications
 * @param {string} userQuery
 * @param {object} settings
 * @param {(done: number, total: number) => void} [onBatch]
 * @returns {Promise<Array<{publication: object, shortDescription: string, isRelevant: boolean, isJudged: boolean}>>}
 *   `isJudged` is false als het model voor die publicatie, ook na nieuwe
 *   pogingen, geen bruikbaar oordeel gaf. De aanroeper legt zulke
 *   publicaties niet vast als gezien, zodat een volgende scan ze opnieuw
 *   aanbiedt.
 */
export async function filterPublications(publications, userQuery, settings, onBatch) {
  if (publications.length === 0) return [];

  const results = [];
  const batchSize = isLocal(settings) ? AppConfig.LOCAL_LLM_BATCH_SIZE : AppConfig.LLM_BATCH_SIZE;

  for (let start = 0; start < publications.length; start += batchSize) {
    const batch = publications.slice(start, start + batchSize);
    const marker = newMarker();
    const list = batch
      .map((pub, index) =>
        fencePublication(
          index,
          [
            ['bron', sanitizeUntrusted(pub.sourceName, AppConfig.PROMPT_SOURCE_NAME_MAX_CHARS)],
            ['titel', sanitizeUntrusted(pub.title, AppConfig.PROMPT_TITLE_MAX_CHARS)],
            ['tekst', sanitizeUntrusted(pub.description, AppConfig.PROMPT_FILTER_TEXT_MAX_CHARS)],
          ],
          marker,
        ),
      )
      .join('\n\n');

    const request = {
      system: `${FILTER_SYSTEM_PROMPT}\n\n${untrustedDataRule(marker)}`,
      user: `Beoordeel de volgende publicaties op relevantie voor deze vraag:\n\nVRAAG: ${userQuery}\n\nPUBLICATIES:\n${list}`,
      maxTokens: AppConfig.LLM_MAX_TOKENS,
      temperature: AppConfig.LLM_TEMPERATURE,
    };

    // Een onleesbaar antwoord is meestal eenmalig: opnieuw vragen.
    let verdicts = null;
    for (let attempt = 1; attempt <= AppConfig.LLM_PARSE_ATTEMPTS && !verdicts; attempt += 1) {
      verdicts = parseVerdicts(await complete(settings, request));
      if (!verdicts) {
        log.warn(`Batch ${start / batchSize + 1}: antwoord niet leesbaar (poging ${attempt} van ${AppConfig.LLM_PARSE_ATTEMPTS})`);
      }
    }

    results.push(...mapBatch(verdicts, batch));
    onBatch?.(Math.min(start + batchSize, publications.length), publications.length);
  }

  return results;
}

/**
 * Leest de oordelen uit een modelantwoord. Tekst vóór de eerste `[` of na
 * de laatste `]` wordt genegeerd; een afgekapte array wordt gerepareerd.
 * Geëxporteerd voor de tests.
 * @returns {Map<number, {score: number, relevance: string, isRelevant: boolean, shortDescription: string}> | null}
 *   null als er geen bruikbare array in staat
 */
export function parseVerdicts(content) {
  const text = stripCodeFence(content ?? '');
  const open = text.indexOf('[');
  if (open === -1) return null;
  const close = text.lastIndexOf(']');
  const candidate = close > open ? text.slice(open, close + 1) : text.slice(open);

  let array;
  try {
    array = JSON.parse(repairJsonArray(candidate));
  } catch {
    return null;
  }
  if (!Array.isArray(array)) return null;

  const verdicts = new Map();
  for (const item of array) {
    if (typeof item?.index !== 'number') continue;
    // Alleen een getal (of een echte true/false) telt. Een string als
    // "ja, zeker" is geen antwoord volgens het formaat — mogelijk door
    // bronmateriaal uitgelokt.
    const score = readScore(item);
    if (score === null) continue;
    const relevance = classifyScore(score);
    verdicts.set(item.index, {
      score,
      relevance,
      isRelevant: relevance === 'relevant',
      shortDescription: String(item.samenvatting ?? ''),
    });
  }
  // Een lege array is geen antwoord op een niet-lege batch: opnieuw vragen.
  return verdicts.size > 0 ? verdicts : null;
}

/**
 * Koppelt de oordelen aan de publicaties van de batch. Zonder oordeel (geen
 * leesbaar antwoord, of een index die ontbreekt) is een publicatie niet
 * beoordeeld — dat is iets anders dan "niet relevant".
 */
function mapBatch(verdicts, batch) {
  return batch.map((publication, index) => {
    const verdict = verdicts?.get(index);
    return {
      publication,
      shortDescription: verdict?.shortDescription || publication.title,
      score: verdict?.score ?? null,
      relevance: verdict?.relevance ?? 'niet',
      isRelevant: verdict?.isRelevant ?? false,
      isJudged: Boolean(verdict),
    };
  });
}

function stripCodeFence(text) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

/**
 * Repareert een afgekapte JSON-array door tot het laatste complete object te
 * knippen. Port van `repairTruncatedJson` uit LlmClient.kt.
 */
export function repairJsonArray(json) {
  const trimmed = json.trim();
  if (trimmed.endsWith(']')) return trimmed;

  const lastPair = trimmed.lastIndexOf('},');
  if (lastPair !== -1) return `${trimmed.slice(0, lastPair + 1)}]`;

  const lastBrace = trimmed.lastIndexOf('}');
  if (lastBrace !== -1) return `${trimmed.slice(0, lastBrace + 1)}]`;

  return '[]';
}
