/**
 * Scanresultaat: eerst de gebundelde signalering, daarna de publicaties waarop
 * die is gebaseerd, daarna wat is weggefilterd.
 *
 * De volgorde is de kern van het verschil met de Android-app: daar is het
 * eindproduct een lijst, hier is het één gesynthetiseerd bericht met de lijst
 * als onderbouwing.
 */

import { Msg, send } from '../../../core/messages.js';
import { FULLTEXT_ORIGIN } from '../../../network/open-overheid.js';
import { el, sourceReferences, formatDate, formatDateTime, openUrl } from '../../shared/dom.js';

export async function renderScan(profileId, scanId) {
  const [profile, results] = await Promise.all([
    send(Msg.GET_PROFILE, { profileId }),
    send(Msg.GET_SCAN_RESULTS, { scanId }),
  ]);

  if (!results) throw new Error('Scan niet gevonden');

  const { scan, relevant, possible = [], filtered, synthesis } = results;
  const root = el('div');

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
        el('span', { class: 'badge', text: `${scan.newCount ?? 0} nieuw` }),
        el('span', { class: 'badge ok', text: `${relevant.length} relevant` }),
        possible.length > 0 ? el('span', { class: 'badge', text: `${possible.length} mogelijk` }) : null,
        el('span', { class: 'badge', text: `${filtered.length} weggefilterd` }),
      ]),
      scan.onlyNewPublications
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

  // ── Signalering ───────────────────────────────────────────────────────────
  root.append(el('h3', { class: 'section-title', text: 'Signalering' }));

  if (synthesis?.error) {
    root.append(
      el('p', { class: 'error', text: `Synthese mislukt: ${synthesis.error}` }),
      el('button', {
        text: 'Opnieuw scannen',
        onclick: () => {
          location.hash = `#profielen`;
        },
      }),
    );
  } else if (synthesis?.text) {
    send(Msg.MARK_SYNTHESIS_READ, { profileId, createdAt: synthesis.createdAt }).catch(() => {});
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
  } else {
    root.append(
      el('p', {
        class: 'muted',
        text:
          relevant.length === 0
            ? 'Geen relevante publicaties gevonden, dus geen signalering opgesteld.'
            : 'Nog geen signalering beschikbaar voor deze scan.',
      }),
    );
  }

  // ── Publicaties ───────────────────────────────────────────────────────────
  root.append(el('h3', { class: 'section-title', text: `Relevant (${relevant.length})` }));
  if (relevant.length === 0) {
    root.append(el('p', { class: 'muted', text: 'Geen relevante publicaties in deze scan.' }));
  } else {
    relevant.forEach((result) => root.append(publicationRow(result)));
  }

  if (possible.length > 0) {
    root.append(
      el('h3', { class: 'section-title', text: `Mogelijk relevant (${possible.length})` }),
      el('p', {
        class: 'muted',
        text: 'Twijfelgevallen: het model kon niet goed beoordelen of deze publicaties over je vraag gaan, vaak omdat er weinig tekst beschikbaar was. Ze staan niet in de signalering. Open ze om zelf te kijken.',
      }),
    );
    possible.forEach((result) => root.append(publicationRow(result)));
  }

  if (filtered.length > 0) {
    const details = el('details', { style: 'margin-top:24px' }, [
      el('summary', { text: `Weggefilterd (${filtered.length})` }),
    ]);
    filtered.forEach((result) => details.append(publicationRow(result)));
    root.append(details);
  }

  return root;
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

function publicationRow(result) {
  const pub = result.publication;
  const row = el('div', { class: result.isRead ? 'publication read' : 'publication' });

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

  row.append(
    el('div', { class: 'row', style: 'gap:6px; flex-wrap:wrap' }, [
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
    ]),
    el('div', { class: 'muted', text: result.shortDescription }),
    el('div', { class: 'links' }, [
      el('span', { class: 'muted', text: `${pub.sourceName} · ${formatDate(pub.publishedDate)}` }),
      pub.url
        ? el('button', {
            class: 'icon',
            text: 'Openen',
            onclick: () => {
              // Eerst openen: een mislukte markering mag de link niet tegenhouden.
              openUrl(pub.url);
              if (result.isRead) return;
              send(Msg.MARK_AS_READ, { publicationId: result.id })
                .then(() => {
                  result.isRead = true;
                  row.classList.add('read');
                })
                .catch(() => {});
            },
          })
        : null,
      bookmarkButton,
    ]),
  );

  return row;
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
    }, 1500);
  } catch {
    button.textContent = 'Kopiëren mislukt';
  }
}
