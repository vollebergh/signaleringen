/**
 * Tekst uit een PDF-bijlage halen (B-63).
 *
 * Bijlagen (`blg-…`) van officielebekendmakingen.nl bestaan alleen als PDF.
 * Deze module leest zo'n PDF met pdf.js (`vendor/pdfjs`, onveranderd) en geeft
 * de tekst van de pagina's waarop een zoekterm staat. Het document zelf wordt
 * nergens bewaard; de aanroeper knipt er een fragment uit.
 *
 * Staat los van `open-overheid.js`, zodat die module (en haar tests) de
 * bibliotheek niet laadt. Alleen de achtergrondscan importeert dit bestand.
 *
 * Geen web worker en geen dynamische import: een MV3-service worker staat
 * geen van beide toe. De worker-code wordt statisch geladen en via
 * `globalThis.pdfjsWorker` aan pdf.js gegeven, dat dan in dezelfde thread
 * draait. Voor tekstextractie is dat snel genoeg (± 0,01 s per pagina).
 */

import { AppConfig } from '../core/config.js';
import * as pdfjs from '../../vendor/pdfjs/pdf.mjs';
import * as pdfjsWorker from '../../vendor/pdfjs/pdf.worker.mjs';

globalThis.pdfjsWorker = pdfjsWorker;
pdfjs.GlobalWorkerOptions.workerSrc = 'pdf.worker.mjs'; // niet gebruikt, maar pdf.js eist een waarde

/**
 * @param {Uint8Array} data inhoud van de PDF
 * @param {string[]} terms zoektermen, kleine letters
 * @param {{ maxPages?: number, maxHitPages?: number }} [options]
 * @returns {Promise<string>} tekst van de pagina's met een treffer, gescheiden
 *   door een spatie; leeg zonder treffer of als de PDF niet te lezen is
 */
export async function extractPdfText(data, terms, { maxPages = AppConfig.FULLTEXT_PDF_MAX_PAGES, maxHitPages = AppConfig.FULLTEXT_PDF_MAX_HIT_PAGES } = {}) {
  if (!data?.length || !terms?.length) return '';
  const doc = await pdfjs.getDocument({
    data,
    verbosity: 0,
    isEvalSupported: false, // geen eval/Function: past bij de CSP van de extensie
    useWorkerFetch: false,
    disableFontFace: true,
    useSystemFonts: false,
  }).promise;
  try {
    const parts = [];
    const last = Math.min(doc.numPages, maxPages);
    for (let number = 1; number <= last && parts.length < maxHitPages; number += 1) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      const text = content.items.map((item) => item.str ?? '').join(' ').replace(/\s+/g, ' ').trim();
      page.cleanup();
      const lower = text.toLowerCase();
      if (terms.some((term) => lower.includes(term))) parts.push(text);
    }
    return parts.join(' ');
  } finally {
    await doc.destroy();
  }
}
