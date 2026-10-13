/**
 * Tekst uit HTML en feeds klaarmaken. Los van de ophalers, zodat
 * feed-fetcher.js en open-overheid.js elkaar niet hoeven te importeren (CR-17).
 */

import { decodeEntities } from './xml-parser.js';

/** Verwijdert scripts, styles en tags; laat leesbare tekst over. */
export function stripHtml(html) {
  return decodeEntities(
    html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Kapt af op `max` tekens, met "..." erachter als er iets wegvalt. */
export function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}
