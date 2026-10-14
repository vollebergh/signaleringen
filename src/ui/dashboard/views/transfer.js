/**
 * Exporteren en importeren van profielen.
 *
 * Export levert één JSON-bestand met de geselecteerde profielen en alles wat
 * eronder hangt. Import laat eerst zien wát er in het bestand zit voordat er
 * iets weggeschreven wordt — een import die stilzwijgend bestaande profielen
 * overschrijft is niet terug te draaien.
 */

import { AppConfig } from '../../../core/config.js';
import { Msg, send } from '../../../core/messages.js';
import { el, clear, formatDateTime } from '../../shared/dom.js';

export async function renderTransfer() {
  const root = el('div');
  root.append(el('h2', { text: 'Exporteren en importeren' }));
  root.append(await exportSection());
  root.append(el('h3', { class: 'section-title', text: 'Importeren' }));
  root.append(importSection());
  return root;
}

// ── Export ──────────────────────────────────────────────────────────────────

async function exportSection() {
  const profiles = await send(Msg.LIST_PROFILES);
  const section = el('div');
  const status = el('p', { class: 'muted' });

  if (profiles.length === 0) {
    section.append(el('p', { class: 'muted', text: 'Nog geen profielen om te exporteren.' }));
    return section;
  }

  const checkboxes = new Map();
  const list = el('div', { class: 'transfer-list' });

  for (const profile of profiles) {
    const box = el('input', { type: 'checkbox' });
    box.checked = true;
    box.style.width = 'auto';
    checkboxes.set(profile.id, box);

    list.append(
      el('label', { class: 'transfer-row' }, [
        box,
        el('span', { class: 'transfer-name', text: profile.name || '(naamloos)' }),
        el('span', {
          class: 'muted',
          text: `${profile.sources.length} bron${profile.sources.length === 1 ? '' : 'nen'}${
            profile.category ? ` · ${profile.category}` : ''
          }`,
        }),
      ]),
    );
  }

  const toggleAll = (checked) => {
    for (const box of checkboxes.values()) box.checked = checked;
  };

  section.append(
    el('p', {
      class: 'muted',
      text: 'Het bestand bevat per profiel: het onderwerp, de gebruikersvraag, de synthese-instructie, de bronnen, de beoordeelde publicaties, de eerdere signaleringen en de administratie van wat al eens is opgehaald en verwerkt.',
    }),
    el('div', { class: 'actions', style: 'margin-bottom:8px' }, [
      el('button', { class: 'icon', text: 'Alles selecteren', onclick: () => toggleAll(true) }),
      el('button', { class: 'icon', text: 'Niets selecteren', onclick: () => toggleAll(false) }),
    ]),
    list,
    el('div', { class: 'actions', style: 'margin-top:12px' }, [
      el('button', {
        class: 'primary',
        text: 'Exporteren',
        onclick: (event) => doExport(event.currentTarget),
      }),
      status,
    ]),
  );

  async function doExport(button) {
    const selected = [...checkboxes.entries()]
      .filter(([, box]) => box.checked)
      .map(([id]) => id);

    if (selected.length === 0) {
      status.className = 'error';
      status.textContent = 'Selecteer minstens één profiel.';
      return;
    }

    button.disabled = true;
    status.className = 'muted';
    status.textContent = 'Exporteren…';

    try {
      const { bundle, filename } = await send(Msg.EXPORT_PROFILES, { profileIds: selected });
      downloadJson(bundle, filename);
      status.className = 'badge ok';
      status.textContent = `${selected.length} profiel(en) geëxporteerd naar ${filename}`;
    } catch (err) {
      status.className = 'error';
      status.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  }

  return section;
}

/**
 * Zet de bundel als bestand klaar. Een blob-URL met een `download`-attribuut is
 * hier de juiste weg: de `downloads`-permissie zou een extra recht vragen voor
 * iets wat de browser zelf al kan.
 */
function downloadJson(bundle, filename) {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  // Pas vrijgeven nadat de browser de download heeft opgepakt.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ── Import ──────────────────────────────────────────────────────────────────

function importSection() {
  const section = el('div');
  const status = el('p', { class: 'muted' });
  const preview = el('div');

  /** @type {object | null} */
  let loadedBundle = null;

  const fileInput = el('input', {
    type: 'file',
    accept: '.json,application/json',
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    clear(preview);
    status.className = 'muted';
    status.textContent = 'Bestand lezen…';

    try {
      const text = await file.text();
      const bundle = JSON.parse(text);
      const summary = await send(Msg.IMPORT_PREVIEW, { bundle });
      loadedBundle = bundle;
      status.textContent = '';
      preview.append(renderPreview(summary));
    } catch (err) {
      loadedBundle = null;
      status.className = 'error';
      status.textContent =
        err instanceof SyntaxError ? 'Dit bestand bevat geen geldige JSON.' : err.message;
    } finally {
      fileInput.value = '';
    }
  });

  function renderPreview(summary) {
    const wrapper = el('div');
    const checkboxes = new Map();
    const rows = el('div', { class: 'transfer-list' });

    for (const entry of summary.profiles) {
      const box = el('input', { type: 'checkbox' });
      box.checked = true;
      box.style.width = 'auto';
      checkboxes.set(entry.id, box);

      rows.append(
        el('label', { class: 'transfer-row' }, [
          box,
          el('span', { class: 'transfer-name', text: entry.name || '(naamloos)' }),
          el('span', {
            class: 'muted',
            text: `${entry.sourceCount} bronnen · ${entry.scanCount} scans · ${entry.synthesisCount} signaleringen · ${entry.publicationCount} publicaties`,
          }),
          entry.idExists
            ? el('span', { class: 'badge fail', text: 'bestaat al' })
            : entry.nameExists
              ? el('span', { class: 'badge', text: 'zelfde naam' })
              : null,
        ]),
      );
    }

    const anyExisting = summary.profiles.some((p) => p.idExists);

    const modeSelect = el('select', {}, [
      el('option', { value: 'copy', text: 'Toevoegen als kopie (bestaande profielen blijven)' }),
      el('option', { value: 'replace', text: 'Bestaande profielen vervangen' }),
    ]);

    const importStatus = el('p', { class: 'muted' });

    wrapper.append(
      el('p', {
        class: 'muted',
        text: `Bestand van ${formatDateTime(summary.exportedAt)}${
          summary.generator ? ` · ${summary.generator.name} ${summary.generator.version}` : ''
        } · formaatversie ${summary.formatVersion}`,
      }),
      rows,
      anyExisting
        ? el('div', { class: 'field', style: 'margin-top:12px' }, [
            el('label', { text: 'Bij een profiel dat al bestaat' }),
            modeSelect,
            el('div', {
              class: 'hint',
              text: 'Vervangen wist het bestaande profiel inclusief zijn scangeschiedenis en signaleringen. Dat is niet terug te draaien.',
            }),
          ])
        : null,
      el('div', { class: 'actions', style: 'margin-top:12px' }, [
        el('button', {
          class: 'primary',
          text: 'Importeren',
          onclick: (event) => doImport(event.currentTarget),
        }),
        importStatus,
      ]),
    );

    async function doImport(button) {
      const selected = [...checkboxes.entries()]
        .filter(([, box]) => box.checked)
        .map(([id]) => id);

      if (selected.length === 0) {
        importStatus.className = 'error';
        importStatus.textContent = 'Selecteer minstens één profiel.';
        return;
      }

      const mode = anyExisting ? modeSelect.value : 'copy';
      if (mode === 'replace') {
        const overlapping = summary.profiles.filter(
          (p) => p.idExists && selected.includes(p.id),
        );
        if (overlapping.length > 0) {
          const names = overlapping.map((p) => p.name).join(', ');
          if (
            !confirm(
              `${overlapping.length} bestaand profiel wordt gewist en vervangen: ${names}.\n\nDe scangeschiedenis en signaleringen daarvan gaan verloren. Doorgaan?`,
            )
          ) {
            return;
          }
        }
      }

      button.disabled = true;
      importStatus.className = 'muted';
      importStatus.textContent = 'Importeren…';

      try {
        const result = await send(Msg.IMPORT_PROFILES, {
          bundle: loadedBundle,
          profileIds: selected,
          mode,
        });
        importStatus.className = 'badge ok';
        importStatus.textContent = `${result.imported} toegevoegd, ${result.replaced} vervangen.`;
        setTimeout(() => {
          location.hash = '#profielen';
        }, AppConfig.UI_REDIRECT_AFTER_IMPORT_MS);
      } catch (err) {
        importStatus.className = 'error';
        importStatus.textContent = err.message;
      } finally {
        button.disabled = false;
      }
    }

    return wrapper;
  }

  section.append(
    el('p', {
      class: 'muted',
      text: 'Kies een eerder geëxporteerd JSON-bestand. Je ziet eerst wat erin zit en kiest daarna wat er geïmporteerd wordt.',
    }),
    el('div', { class: 'field' }, [fileInput]),
    status,
    preview,
  );

  return section;
}
