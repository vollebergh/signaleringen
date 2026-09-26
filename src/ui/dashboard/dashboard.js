/**
 * Dashboard-router. Elke weergave is een module die een DOM-node teruggeeft;
 * de router bepaalt welke er getoond wordt op basis van de hash.
 *
 * Routes:
 *   #profielen                          overzicht
 *   #profiel/<id>                       bewerken
 *   #profiel/nieuw                      aanmaken
 *   #profiel/<id>/signaleringen         alle eerdere syntheses
 *   #profiel/<id>/scan/<scanId>         scanresultaat + publicaties
 *   #bladwijzers                        opgeslagen publicaties
 *   #gegevens                           exporteren en importeren
 *   #instellingen                       verbinding, thema, automatische synthese
 *   #bron-toevoegen                     vanuit het contextmenu
 */

import { $, $$, clear, applyTheme, showError, el } from '../shared/dom.js';
import { renderProfileList } from './views/profiles.js';
import { renderProfileEdit } from './views/profile-edit.js';
import { renderScan } from './views/scan.js';
import { renderSyntheses } from './views/syntheses.js';
import { renderBookmarks } from './views/bookmarks.js';
import { renderSettings } from './views/settings.js';
import { renderAddSource } from './views/add-source.js';
import { renderTransfer } from './views/transfer.js';

const view = $('#view');

const ROUTES = [
  { pattern: /^profielen$/, render: () => renderProfileList(), tab: 'profielen' },
  { pattern: /^profiel\/nieuw$/, render: () => renderProfileEdit(null), tab: 'profielen' },
  {
    pattern: /^profiel\/([^/]+)\/signaleringen$/,
    render: (id) => renderSyntheses(id),
    tab: 'profielen',
  },
  {
    pattern: /^profiel\/([^/]+)\/scan\/([^/]+)$/,
    render: (id, scanId) => renderScan(id, scanId),
    tab: 'profielen',
  },
  { pattern: /^profiel\/([^/]+)$/, render: (id) => renderProfileEdit(id), tab: 'profielen' },
  { pattern: /^bladwijzers$/, render: () => renderBookmarks(), tab: 'bladwijzers' },
  { pattern: /^gegevens$/, render: () => renderTransfer(), tab: 'gegevens' },
  { pattern: /^instellingen$/, render: () => renderSettings(), tab: 'instellingen' },
  { pattern: /^bron-toevoegen$/, render: () => renderAddSource(), tab: 'profielen' },
];

async function route() {
  const hash = location.hash.replace(/^#/, '') || 'profielen';

  for (const { pattern, render, tab } of ROUTES) {
    const match = pattern.exec(hash);
    if (!match) continue;

    markActiveTab(tab);
    clear(view);
    view.append(el('p', { class: 'muted', text: 'Laden…' }));

    try {
      const node = await render(...match.slice(1));
      clear(view);
      view.append(node);
      window.scrollTo(0, 0);
    } catch (err) {
      showError(view, err);
    }
    return;
  }

  location.hash = '#profielen';
}

function markActiveTab(tab) {
  for (const button of $$('nav.tabs button')) {
    if (button.dataset.route === tab) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}

for (const button of $$('nav.tabs button')) {
  button.addEventListener('click', () => {
    location.hash = `#${button.dataset.route}`;
  });
}

window.addEventListener('hashchange', route);

applyTheme().then(route);
