/**
 * Bewaarde publicaties, over alle profielen en scans heen.
 */

import { Msg, send } from '../../../core/messages.js';
import { el } from '../../shared/dom.js';
import { publicationRow } from '../../shared/publication-row.js';

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
    const actions = (row) => [
      el('button', {
        class: 'icon',
        text: 'Verwijderen',
        onclick: async (event) => {
          const button = event.currentTarget; // na een await is currentTarget leeg
          try {
            await send(Msg.TOGGLE_BOOKMARK, { publicationId: result.id, bookmarked: false });
            row.remove();
          } catch {
            button.textContent = 'Verwijderen mislukt';
          }
        },
      }),
    ];
    root.append(publicationRow(result, { actions }));
  }

  return root;
}
