# pdf.js (vendored)

Mozilla pdf.js `pdfjs-dist@4.10.38`, licentie Apache-2.0 (zie `LICENSE`).
Onveranderd uit `pdfjs-dist/build/` (`pdf.mjs`, `pdf.worker.mjs`), alleen de
verwijzing naar de source map is weggelaten. Leesbare, niet-geminificeerde
bouwversie, zoals het Edge-beleid vraagt.

Gebruikt door `src/network/pdf-text.js` om tekst uit PDF-bijlagen van
officielebekendmakingen.nl te lezen (B-63). Geen remote code: de bibliotheek
wordt uit het pakket geladen en de worker draait in dezelfde thread.

Bijwerken: nieuwe `pdfjs-dist` installeren buiten de repo, de twee bestanden
kopiëren, de versie hierboven aanpassen en `node --test test/*.test.mjs`
draaien.
