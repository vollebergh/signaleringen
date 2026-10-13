/**
 * Eén publicatie als regel: kop, korte beschrijving, bron en datum, *Openen*
 * en eventuele eigen knoppen. Gedeeld door het scanresultaat, de bladwijzers
 * en het zijpaneel (CR-18); wat een vlak extra toont, geeft het mee.
 */

import { el, formatDate, openUrl } from './dom.js';

/**
 * @param {object} result  publicatie-record (`publication`, `shortDescription`)
 * @param {object} [options]
 * @param {string} [options.className]
 * @param {HTMLElement} [options.heading]  eigen kop; standaard alleen de titel
 * @param {(row: HTMLElement) => void} [options.onOpen]  na het openen van de link
 * @param {(row: HTMLElement) => Array<HTMLElement | null>} [options.actions]  extra knoppen
 */
export function publicationRow(result, { className = 'publication', heading, onOpen, actions } = {}) {
  const pub = result.publication;
  const row = el('div', { class: className });
  row.append(
    heading ?? el('div', { class: 'title', text: pub.title || '(zonder titel)' }),
    el('div', { class: 'muted', text: result.shortDescription }),
    el('div', { class: 'links' }, [
      el('span', { class: 'muted', text: `${pub.sourceName} · ${formatDate(pub.publishedDate)}` }),
      pub.url
        ? el('button', {
            class: 'icon',
            text: 'Openen',
            onclick: () => {
              // Eerst openen: wat daarna komt, mag de link niet tegenhouden.
              openUrl(pub.url);
              onOpen?.(row);
            },
          })
        : null,
      ...(actions?.(row) ?? []),
    ]),
  );
  return row;
}
