/**
 * Alle eerder opgestelde signaleringen van één profiel, nieuwste eerst.
 *
 * Dit is een leeslijst, geen scangeschiedenis: scans waarin niets relevants
 * gevonden werd hebben geen synthese en staan hier dus niet. De nieuwste staat
 * open, de rest ingeklapt — anders scrol je door een muur tekst voordat je bij
 * de tweede bent.
 */

import { Msg, send } from '../../../core/messages.js';
import { el, sourceReferences, formatDateTime } from '../../shared/dom.js';

export async function renderSyntheses(profileId) {
  const [profile, syntheses] = await Promise.all([
    send(Msg.GET_PROFILE, { profileId }),
    send(Msg.LIST_SYNTHESES, { profileId }),
  ]);

  if (!profile) throw new Error('Profiel niet gevonden');

  const root = el('div');

  root.append(
    el('div', { class: 'breadcrumb' }, [
      el('button', {
        class: 'icon',
        text: '← Profielen',
        onclick: () => {
          location.hash = '#profielen';
        },
      }),
    ]),
    el('h2', { text: `Signaleringen — ${profile.name || '(naamloos)'}` }),
  );

  if (syntheses.length === 0) {
    root.append(
      el('div', { class: 'empty' }, [
        el('p', { text: 'Nog geen signaleringen opgesteld voor dit profiel.' }),
        el('p', {
          class: 'muted',
          text: 'Een signalering ontstaat bij een scan waarin relevante publicaties gevonden worden.',
        }),
      ]),
    );
    return root;
  }

  root.append(
    el('p', {
      class: 'muted',
      text: `${syntheses.length} signalering${syntheses.length === 1 ? '' : 'en'} bewaard. Er blijven maximaal 5 scans per profiel bewaard; oudere signaleringen worden opgeruimd.`,
    }),
  );

  syntheses.forEach((synthesis, index) => {
    root.append(synthesisCard(synthesis, profile, index === 0));
  });

  return root;
}

function synthesisCard(synthesis, profile, expanded) {
  const details = el('details', { class: 'synthesis-entry' });
  if (expanded) details.setAttribute('open', '');

  const summary = el('summary', {}, [
    el('span', { class: 'synthesis-date', text: formatDateTime(synthesis.createdAt) }),
    el('span', {
      class: 'badge ok',
      text: `${synthesis.relevantCount} relevant`,
    }),
    synthesis.newCount
      ? el('span', { class: 'badge', text: `${synthesis.newCount} nieuw` })
      : null,
    expanded ? el('span', { class: 'badge', text: 'recentste' }) : null,
  ]);

  details.append(
    summary,
    ...(synthesis.warnings ?? []).map((warning) => el('p', { class: 'error', text: `⚠ ${warning}` })),
    el('div', { class: 'synthesis', text: synthesis.text }),
    el('div', { class: 'actions', style: 'margin-top:10px' }, [
      el('button', {
        text: 'Kopiëren',
        onclick: (event) => copy(synthesis, profile, event.currentTarget),
      }),
      el('button', {
        text: 'Naar de publicaties',
        onclick: () => {
          location.hash = `#profiel/${profile.id}/scan/${synthesis.scanId}`;
        },
      }),
    ]),
    sourceReferences(synthesis.sources),
  );

  return details;
}

async function copy(synthesis, profile, button) {
  const lines = [
    `Signalering: ${profile.name}`,
    formatDateTime(synthesis.createdAt),
    '',
    synthesis.text,
    '',
  ];
  if (synthesis.sources.length > 0) {
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
