/**
 * Scanresultaat: eerst de gebundelde signalering, daarna de publicaties waarop
 * die is gebaseerd, daarna wat is weggefilterd.
 *
 * De volgorde is de kern van het verschil met de Android-app: daar is het
 * eindproduct een lijst, hier is het één gesynthetiseerd bericht met de lijst
 * als onderbouwing.
 */

import { AppConfig } from '../../../core/config.js';
import { Msg, send } from '../../../core/messages.js';
import { FULLTEXT_ORIGIN } from '../../../core/origins.js';
import { log } from '../../../core/logger.js';
import {
  el,
  clear,
  sourceReferences,
  formatDate,
  formatDateTime,
  openUrl,
  markSynthesisRead,
  explainScanFailure,
} from '../../shared/dom.js';
import { publicationRow } from '../../shared/publication-row.js';

export async function renderScan(profileId, scanId) {
  const [profile, results] = await Promise.all([
    send(Msg.GET_PROFILE, { profileId }),
    send(Msg.GET_SCAN_RESULTS, { scanId }),
  ]);

  if (!results) throw new Error('Scan niet gevonden');

  const { scan, relevant, possible = [], filtered, unjudged = [], synthesis } = results;
  const root = el('div');
  const reader = Boolean(scan.readerMode);

  // Element.append() maakt van null de tekst "null"; daarom eerst filteren.
  root.append(
    ...[
      el('div', { class: 'breadcrumb' }, [
        el('button', {
          class: 'icon',
          text: '← Profielen',
          onclick: () => {
            location.hash = '#profielen';
          },
        }),
      ]),
      el('h2', { text: profile?.name ?? 'Scan' }),
      el('div', { class: 'scan-meta' }, [
        el('span', { class: 'badge', text: formatDateTime(scan.scanDate) }),
        el('span', { class: 'badge', text: `${scan.totalFetched} opgehaald` }),
        scan.lookbackDays
          ? el('span', { class: 'badge', title: 'Terugkijktijd van het profiel bij deze scan', text: `${scan.lookbackDays} dagen terug` })
          : null,
        el('span', { class: reader ? 'badge ok' : 'badge', text: `${scan.newCount ?? 0} nieuw` }),
        reader ? null : el('span', { class: 'badge ok', text: `${relevant.length} relevant` }),
        !reader && possible.length > 0 ? el('span', { class: 'badge', text: `${possible.length} mogelijk` }) : null,
        reader ? null : el('span', { class: 'badge', text: `${filtered.length} weggefilterd` }),
      ].filter(Boolean)),
      reader
        ? el('p', {
            class: 'muted',
            text: 'Gescand zonder taalmodel: de publicaties zijn opgehaald, niet beoordeeld, en er is geen signalering. Stel bij Instellingen een taalmodel in; de eerste scan daarna beoordeelt ook wat hier al stond, zolang het nog in de bron staat.',
          })
        : scan.onlyNewPublications
        ? el('p', {
            class: 'muted',
            text: `Beoordeeld: alleen de ${scan.evaluatedCount ?? 0} publicatie(s) die dit profiel nog niet eerder ophaalde. De rest was al bekend.`,
          })
        : el('p', {
            class: 'muted',
            text: `Beoordeeld: alle ${scan.evaluatedCount ?? scan.totalFetched} opgehaalde publicaties, ook eerder geziene.`,
          }),
      fullTextNote(scan),
      prefilterNote(scan),
      scan.unjudgedCount
        ? el('p', {
            class: 'error',
            text: `${scan.unjudgedCount} publicatie(s) kregen geen oordeel: het model gaf ook na nieuwe pogingen geen leesbaar antwoord. Ze staan niet bij de resultaten en worden bij de volgende scan opnieuw aangeboden.`,
          })
        : null,
      sourceStatusSection(scan.sourceStatuses ?? []),
    ].filter(Boolean),
  );

  // ── Leesmodus (B-82): alleen de lijst ─────────────────────────────────────
  if (reader) {
    root.append(el('h3', { class: 'section-title', text: `Publicaties (${unjudged.length})` }));
    if (unjudged.length === 0) {
      root.append(el('p', { class: 'muted', text: 'Geen publicaties gevonden binnen de terugkijktijd.' }));
    } else {
      unjudged.forEach((result) => root.append(resultRow(result)));
    }
    return root;
  }

  // ── Signalering ───────────────────────────────────────────────────────────
  root.append(el('h3', { class: 'section-title', text: 'Signalering' }));

  if (synthesis?.error && relevant.length > 0) {
    root.append(
      el('p', { class: 'error', text: `Synthese mislukt: ${synthesis.error}` }),
      synthesizeAction(root, profileId, scanId, relevant.length, 'Opnieuw proberen'),
    );
  } else if (synthesis?.text) {
    markSynthesisRead(profileId, synthesis.createdAt);
    root.append(
      ...[
        // Waarschuwingen over de bronverwijzingen (B-44), zoals in de lijst
        // met signaleringen en het zijpaneel (CR-11).
        ...(synthesis.warnings ?? []).map((warning) => el('p', { class: 'error', text: `⚠ ${warning}` })),
        synthesis.selection && synthesis.selection.used < synthesis.selection.relevant
          ? el('p', { class: 'muted', text: `Gebaseerd op de ${synthesis.selection.used} hoogst scorende van ${synthesis.selection.relevant} relevante publicaties.` })
          : null,
        el('div', { class: 'synthesis', text: synthesis.text }),
        el('div', { class: 'actions', style: 'margin-top:10px' }, [
          el('button', {
            text: 'Kopiëren',
            onclick: (event) => copySynthesis(synthesis, profile, event.currentTarget),
          }),
        ]),
        sourceReferences(synthesis.sources),
      ].filter(Boolean),
    );
  } else if (relevant.length > 0) {
    // Geen signalering bij relevante publicaties: de scan is tijdens het
    // opstellen gestopt, bijvoorbeeld doordat de browser sloot (B-74).
    root.append(
      el('p', {
        class: 'muted',
        text: 'Er is geen signalering opgesteld, bijvoorbeeld omdat de browser sloot terwijl hij werd gemaakt. De relevante publicaties hieronder zijn al beoordeeld en komen bij een volgende scan niet opnieuw langs.',
      }),
      synthesizeAction(root, profileId, scanId, relevant.length, 'Signalering opstellen'),
    );
  } else {
    root.append(
      el('p', { class: 'muted', text: 'Geen relevante publicaties gevonden, dus geen signalering opgesteld.' }),
    );
  }

  // ── Publicaties ───────────────────────────────────────────────────────────
  root.append(el('h3', { class: 'section-title', text: `Relevant (${relevant.length})` }));
  if (relevant.length === 0) {
    root.append(el('p', { class: 'muted', text: 'Geen relevante publicaties in deze scan.' }));
  } else {
    relevant.forEach((result) => root.append(resultRow(result)));
  }

  if (possible.length > 0) {
    root.append(
      el('h3', { class: 'section-title', text: `Mogelijk relevant (${possible.length})` }),
      el('p', {
        class: 'muted',
        text: 'Twijfelgevallen: het model kon niet goed beoordelen of deze publicaties over je vraag gaan, vaak omdat er weinig tekst beschikbaar was. Ze staan niet in de signalering. Open ze om zelf te kijken.',
      }),
    );
    possible.forEach((result) => root.append(resultRow(result)));
  }

  if (filtered.length > 0) {
    const details = el('details', { style: 'margin-top:24px' }, [
      el('summary', { text: `Weggefilterd (${filtered.length})` }),
    ]);
    filtered.forEach((result) => details.append(resultRow(result)));
    root.append(details);
  }

  return root;
}

/**
 * Knop die de signalering alsnog laat opstellen (B-74): één modelaanroep over
 * de al beoordeelde publicaties. Daarna wordt de hele weergave opnieuw
 * opgebouwd, met de signalering of de nieuwe foutmelding.
 */
function synthesizeAction(root, profileId, scanId, relevantCount, label) {
  const status = el('span', { class: 'muted' });
  const button = el('button', {
    class: 'primary',
    text: label,
    title: `Eén modelaanroep over de ${relevantCount} relevante publicatie(s) van deze scan`,
    onclick: async () => {
      button.disabled = true;
      status.classList.remove('error');
      clear(status);
      status.append(el('span', { class: 'spinner' }), el('span', { text: ' Signalering opstellen…' }));
      try {
        await send(Msg.SYNTHESIZE_SCAN, { profileId, scanId });
        root.replaceWith(await renderScan(profileId, scanId));
      } catch (err) {
        status.classList.add('error');
        status.textContent = await explainScanFailure(profileId, err);
        button.disabled = false;
      }
    },
  });
  return el('div', { class: 'actions' }, [button, status]);
}

/**
 * Volledige tekst voor publicaties zonder fragment (B-60): hoeveel aangevuld,
 * of — zonder toestemming — een knop om die te geven. De knop werkt vanaf de
 * volgende scan.
 */
function fullTextSummary({ attempted = 0, enriched = 0, pdfAttempted = 0, pdfEnriched = 0 }) {
  const total = attempted + pdfAttempted;
  const done = enriched + pdfEnriched;
  const pdf = pdfAttempted > 0 ? `, waarvan ${pdfEnriched} uit een PDF-bijlage` : '';
  return `Volledige tekst: bij ${done} van de ${total} publicatie(s) zonder fragment een passage rond de zoekterm toegevoegd uit officielebekendmakingen.nl${pdf}.`;
}

function fullTextNote(scan) {
  if (scan.fullText?.status === 'used') {
    return el('p', {
      class: 'muted',
      text: fullTextSummary(scan.fullText),
    });
  }
  if (scan.fullText?.status === 'no-permission') {
    const status = el('span', { class: 'muted' });
    return el('div', { class: 'permission-warning' }, [
      el('p', {
        text: `${scan.fullText.count} publicatie(s) hadden geen tekstfragment; het model zag alleen titel en omschrijving. Met toegang tot officielebekendmakingen.nl haalt de extensie bij de volgende scan de passage rond de zoekterm erbij.`,
      }),
      el('div', { class: 'actions' }, [
        el('button', {
          class: 'primary',
          text: 'Toegang geven',
          onclick: async (event) => {
            const button = event.currentTarget; // na een await is currentTarget leeg
            const granted = await chrome.permissions.request({ origins: [FULLTEXT_ORIGIN] });
            button.disabled = granted;
            status.textContent = granted ? 'Gegeven. Geldt vanaf de volgende scan.' : 'Geen toegang gegeven.';
          },
        }),
        status,
      ]),
    ]);
  }
  return null;
}

/** Wat de voorfilter (Jev, B-58) deed, als die aan stond. */
function prefilterNote(scan) {
  if (scan.prefilter?.status === 'used') {
    return el('p', {
      class: 'muted',
      text: `Voorfilter (Jev): ${scan.prefilteredCount ?? 0} van de ${scan.evaluatedCount ?? 0} publicatie(s) vielen al vóór de relevantiestap af. Ze staan bij Weggefilterd, met het label "voorfilter".`,
    });
  }
  if (scan.prefilter?.status === 'fallback') {
    return el('p', {
      class: 'muted',
      text: 'Voorfilter (Jev) was niet bereikbaar of gaf geen bruikbaar antwoord; alle publicaties gingen naar het model.',
    });
  }
  return null;
}

/**
 * Per bron: wat er is opgehaald, hoeveel daarvan nieuw was, en een knop om de
 * bron zelf in een tabblad te openen.
 */
function sourceStatusSection(statuses) {
  if (statuses.length === 0) return el('div');

  return el('div', { style: 'margin-bottom:16px' }, [
    el('p', { class: 'muted', style: 'margin-bottom:4px', text: 'Bronnen in deze scan' }),
    ...statuses.map((status) =>
      el('div', { class: 'source-row' }, [
        el('span', {
          class: status.success ? 'badge ok' : 'badge fail',
          text: status.success ? 'opgehaald' : 'mislukt',
        }),
        el('span', { class: 'source-row-name', text: status.name || status.url }),
        el('span', {
          class: 'muted',
          text: status.success
            ? `${status.publicationCount} publicatie(s), ${status.newCount ?? 0} nieuw`
            : (status.errorMessage ?? 'onbekende fout'),
        }),
        status.url
          ? el('button', {
              class: 'icon',
              text: 'Openen',
              title: status.url,
              onclick: () => openUrl(status.url),
            })
          : null,
      ]),
    ),
  ]);
}

/** Publicatieregel met score, herkomst, gelezen en bewaren. */
function resultRow(result) {
  const pub = result.publication;
  const bookmarkButton = el('button', {
    class: 'icon',
    text: result.isBookmarked ? '★ Bewaard' : '☆ Bewaren',
    onclick: async () => {
      const next = !result.isBookmarked;
      try {
        await send(Msg.TOGGLE_BOOKMARK, { publicationId: result.id, bookmarked: next });
        result.isBookmarked = next;
        bookmarkButton.textContent = next ? '★ Bewaard' : '☆ Bewaren';
      } catch {
        bookmarkButton.textContent = 'Bewaren mislukt';
      }
    },
  });

  const heading = el('div', { class: 'row', style: 'gap:6px; flex-wrap:wrap' }, [
    el('span', { class: 'title', text: pub.title || '(zonder titel)' }),
    typeof result.score === 'number'
      ? el('span', { class: 'badge', title: 'Relevantiescore van het model (0–100)', text: `score ${result.score}` })
      : null,
    typeof result.prefilterScore === 'number'
      ? el('span', {
          class: 'badge',
          title: 'Weggefilterd door de voorfilter (Jev), vóór de relevantiestap. Score 0–100.',
          text: `voorfilter · score ${result.prefilterScore}`,
        })
      : null,
    result.isNew
      ? el('span', { class: 'badge ok', text: 'nieuw' })
      : el('span', {
          class: 'badge',
          title: result.previousSynthesisAt
            ? `Verwerkt in de signalering van ${formatDateTime(result.previousSynthesisAt)}`
            : 'Deze publicatie kwam in een eerdere scan al langs',
          text: result.previousSynthesisScanId
            ? `eerder verwerkt · ${formatDate(result.previousSynthesisAt)}`
            : 'eerder gezien',
        }),
  ]);

  return publicationRow(result, {
    className: result.isRead ? 'publication read' : 'publication',
    heading,
    onOpen: (row) => {
      if (result.isRead) return;
      send(Msg.MARK_AS_READ, { publicationId: result.id })
        .then(() => {
          result.isRead = true;
          row.classList.add('read');
        })
        .catch((err) => log.warn('Publicatie als gelezen markeren mislukt', err));
    },
    actions: () => [bookmarkButton],
  });
}

async function copySynthesis(synthesis, profile, button) {
  const lines = [`Signalering: ${profile?.name ?? ''}`, '', synthesis.text, ''];
  if (synthesis.sources?.length) {
    lines.push('Bronnen:');
    synthesis.sources.forEach((s) => lines.push(`[${s.index}] ${s.title} — ${s.url}`));
  }

  try {
    await navigator.clipboard.writeText(lines.join('\n').trim());
    const original = button.textContent;
    button.textContent = 'Gekopieerd';
    setTimeout(() => {
      button.textContent = original;
    }, AppConfig.UI_CONFIRMATION_MS);
  } catch {
    button.textContent = 'Kopiëren mislukt';
  }
}
