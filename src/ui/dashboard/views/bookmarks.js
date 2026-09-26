/**
 * Bewaarde publicaties, over alle profielen en scans heen.
 */

import { Msg, send } from '../../../core/messages.js';
import { el, formatDate, openUrl } from '../../shared/dom.js';

export async function renderBookmarks() {
  const bookmarks = await send(Msg.LIST_BOOKMARKS);
  const root = el('div');

  if (bookmarks.length === 0) {
    root.append(
      el('div', { class: 'empty' }, [
        el('p', { text: 'Nog niets bewaard.' }),
        el('p', { class: 'muted', text: 'Bewaar publicaties vanuit een scanresultaat.' }),
      ]),
    );
    return root;
  }

  root.append(el('h2', { text: `Bladwijzers (${bookmarks.length})` }));

  for (const result of bookmarks) {
    const pub = result.publication;
    const row = el('div', { class: 'publication' });

    row.append(
      el('div', { class: 'title', text: pub.title || '(zonder titel)' }),
      el('div', { class: 'muted', text: result.shortDescription }),
      el('div', { class: 'links' }, [
        el('span', { class: 'muted', text: `${pub.sourceName} · ${formatDate(pub.publishedDate)}` }),
        pub.url
          ? el('button', { class: 'icon', text: 'Openen', onclick: () => openUrl(pub.url) })
          : null,
        el('button', {
          class: 'icon',
          text: 'Verwijderen',
          onclick: async () => {
            await send(Msg.TOGGLE_BOOKMARK, { publicationId: result.id, bookmarked: false });
            row.remove();
          },
        }),
      ]),
    );

    root.append(row);
  }

  return root;
}
