/**
 * OPML-import. Tegenhanger van `parseOpml` in ProfileEditScreen.kt.
 * Leest alle `<outline>`-elementen met een `xmlUrl` en maakt daar bronnen van.
 */

import { parseXml } from '../network/xml-parser.js';
import { createSource, SourceType, validateSourceUrl } from '../core/models.js';
import { log } from '../core/logger.js';

/**
 * @param {string} content inhoud van een OPML-bestand
 * @returns {import('../core/models.js').Source[]}
 */
export function parseOpml(content) {
  const sources = [];
  const seen = new Set();

  try {
    parseXml(content, {
      onStart(name, attrs) {
        if (name.toLowerCase() !== 'outline') return;

        const url = attrs.xmlurl;
        if (!url || validateSourceUrl(url) !== null) return;
        if (seen.has(url)) return;
        seen.add(url);

        sources.push(
          createSource({
            name: attrs.text || attrs.title || url,
            url,
            type: SourceType.RSS,
          }),
        );
      },
    });
  } catch (err) {
    log.warn('OPML-parsing mislukt', err);
  }

  return sources;
}
