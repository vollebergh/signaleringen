/**
 * Tests voor het inpakscript (B-73): de allowlist, het manifest per browser,
 * de eigen controle op keys en de zip zelf. Draaien met:
 *   node --test test/
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const { isAllowed, manifestFor, manifestPaths, findSecrets, writeZip } = await import('../scripts/package.mjs');

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

/** Leest de namen en inhoud terug uit de centrale directory van een zip. */
function readZip(zip) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let pos = zip.readUInt32LE(end + 16);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    const size = zip.readUInt32LE(pos + 20);
    const nameLength = zip.readUInt16LE(pos + 28);
    const local = zip.readUInt32LE(pos + 42);
    const name = zip.toString('utf8', pos + 46, pos + 46 + nameLength);
    const dataStart = local + 30 + zip.readUInt16LE(local + 26);
    out.set(name, inflateRawSync(zip.subarray(dataStart, dataStart + size)));
    pos += 46 + nameLength;
  }
  return out;
}

test('allowlist: code, manifest, pdf.js en iconen wel', () => {
  for (const path of ['manifest.json', 'src/core/config.js', 'src/ui/popup/popup.html', 'vendor/pdfjs/pdf.mjs', 'vendor/pdfjs/LICENSE', 'icons/icon-128.png']) {
    assert.ok(isAllowed(path), path);
  }
});

test('allowlist: local-settings, tests, node_modules, git en ontwikkelbestanden nooit', () => {
  for (const path of [
    'local-settings.json', 'local-settings.example.json', 'src/local-settings.json', 'src/data/local-settings.json',
    'test/scan.test.mjs', 'node_modules/fake-indexeddb/index.js', 'src/node_modules/x.js', '.git/config',
    '.gitignore', '.npmrc', 'package.json', 'package-lock.json', 'README.md', 'PRIVACY.md', 'scripts/package.mjs',
    'icons/icon-300.png', 'dist/signaleringen.zip', 'src/.env',
  ]) {
    assert.equal(isAllowed(path), false, path);
  }
});

test('Chromium-manifest zonder Firefox-sleutels', () => {
  const m = manifestFor('chromium', manifest);
  assert.equal(m.background.scripts, undefined);
  assert.equal(m.sidebar_action, undefined);
  assert.equal(m.browser_specific_settings, undefined);
  assert.ok(m.background.service_worker);
  assert.equal(m.version, manifest.version);
});

test('Firefox-manifest zonder Chromium-sleutels', () => {
  const m = manifestFor('firefox', manifest);
  assert.equal(m.background.service_worker, undefined);
  assert.equal(m.side_panel, undefined);
  assert.equal(m.minimum_chrome_version, undefined);
  assert.equal(m.permissions.includes('sidePanel'), false);
  assert.ok(m.background.scripts.length);
  assert.ok(m.browser_specific_settings.gecko.id);
});

test('zijpaneel verborgen: niet in het manifest, wel terug te zetten', () => {
  // AppConfig.SIDE_PANEL_ENABLED staat uit; dan ook geen side_panel,
  // sidebar_action of sidePanel-permissie, anders biedt de browser het toch aan.
  assert.equal(manifest.side_panel, undefined);
  assert.equal(manifest.sidebar_action, undefined);
  assert.equal(manifest.permissions.includes('sidePanel'), false);
  // Met de sleutels terug haalt manifestFor ze per browser nog steeds goed weg.
  const full = { ...manifest, side_panel: { default_path: 'x.html' }, sidebar_action: { default_panel: 'x.html' }, permissions: [...manifest.permissions, 'sidePanel'] };
  assert.equal(manifestFor('chromium', full).sidebar_action, undefined);
  assert.equal(manifestFor('firefox', full).side_panel, undefined);
  assert.equal(manifestFor('firefox', full).permissions.includes('sidePanel'), false);
});

test('gedeeld manifest blijft ongewijzigd', () => {
  const before = JSON.stringify(manifest);
  manifestFor('chromium', manifest);
  manifestFor('firefox', manifest);
  assert.equal(JSON.stringify(manifest), before);
  assert.throws(() => manifestFor('safari', manifest), /Onbekende browser/);
});

test('alles waar het manifest naar verwijst valt binnen de allowlist', () => {
  for (const browser of ['chromium', 'firefox']) {
    for (const path of manifestPaths(manifestFor(browser, manifest))) assert.ok(isAllowed(path), `${browser}: ${path}`);
  }
});

test('eigen keycontrole: OpenRouter-key en letterlijk geheim', () => {
  const key = `sk-or-v1-${'a1'.repeat(32)}`;
  const files = [
    ['src/a.js', Buffer.from(`const k = '${key}';`)],
    ['src/b.js', Buffer.from('const placeholder = "sk-or-…";')],
    ['src/c.js', Buffer.from('const x = "eigen-geheim-1234567890";')],
  ];
  assert.deepEqual(findSecrets(files), ['src/a.js']);
  assert.deepEqual(findSecrets(files, ['eigen-geheim-1234567890', 'kort']), ['src/a.js', 'src/c.js']);
});

test('zip: namen in vaste volgorde, inhoud terug te lezen', () => {
  const files = [
    ['src/b.js', Buffer.from('export const b = 2;\n')],
    ['manifest.json', Buffer.from('{"manifest_version":3}\n')],
    ['icons/x.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3])],
  ];
  const date = new Date('2026-10-15T12:00:00Z');
  const zip = writeZip(files, date);
  const back = readZip(zip);
  assert.deepEqual([...back.keys()], ['icons/x.png', 'manifest.json', 'src/b.js']);
  for (const [path, data] of files) assert.deepEqual(back.get(path), data);
  assert.deepEqual(writeZip(files, date), zip, 'zelfde invoer, zelfde pakket');
});
