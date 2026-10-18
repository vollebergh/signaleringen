/**
 * Inpakscript voor de store (B-73, security audit S-08).
 *
 *   npm run package                 # Chromium (Edge) en Firefox
 *   npm run package -- chromium     # alleen één browser
 *
 * Neemt alleen gecommitte bestanden uit HEAD die op de allowlist staan, nooit
 * de werkmap: zo kan `local-settings.json` met een eigen key er niet in komen,
 * ook niet als hij per ongeluk gecommit zou zijn (die staat bovendien op de
 * denylist). Per browser een eigen manifest. Na het samenstellen draait
 * `gitleaks dir` op de inhoud, plus een eigen controle op OpenRouter-keys en
 * op de key uit `local-settings.json`; bij een treffer komt er geen pakket.
 *
 * Geen afhankelijkheden: de zip wordt hier zelf geschreven (deflate en crc32
 * uit `node:zlib`).
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Wat in het pakket mag: hele mappen (eindigen op /) of losse bestanden. */
export const ALLOWLIST = [
  'manifest.json',
  'src/',
  'vendor/pdfjs/',
  'icons/icon-16.png',
  'icons/icon-32.png',
  'icons/icon-48.png',
  'icons/icon-128.png',
];

/** Komt er nooit in, ook niet als het binnen de allowlist zou vallen. */
const DENYLIST = [/(^|\/)local-settings[^/]*\.json$/, /(^|\/)\.env/, /(^|\/)\.git(\/|$)/, /(^|\/)node_modules\//];

export const BROWSERS = ['chromium', 'firefox'];

export function isAllowed(path) {
  if (DENYLIST.some((re) => re.test(path))) return false;
  return ALLOWLIST.some((entry) => (entry.endsWith('/') ? path.startsWith(entry) : path === entry));
}

/**
 * Het manifest voor één browser. De gedeelde versie bevat sleutels voor
 * beide (B-65); Chromium meldt de Firefox-sleutels als fout, Firefox de
 * Chromium-sleutels als waarschuwing.
 */
export function manifestFor(browser, manifest) {
  const m = structuredClone(manifest);
  if (browser === 'chromium') {
    delete m.background.scripts;
    delete m.sidebar_action;
    delete m.browser_specific_settings;
  } else if (browser === 'firefox') {
    delete m.background.service_worker;
    delete m.side_panel;
    delete m.minimum_chrome_version;
    m.permissions = m.permissions.filter((p) => p !== 'sidePanel');
  } else {
    throw new Error(`Onbekende browser: ${browser}`);
  }
  return m;
}

/** Paden uit het manifest die in het pakket moeten zitten. */
export function manifestPaths(m) {
  return [
    ...Object.values(m.icons ?? {}),
    m.background?.service_worker,
    ...(m.background?.scripts ?? []),
    m.action?.default_popup,
    m.options_page,
    m.side_panel?.default_path,
    m.sidebar_action?.default_panel,
    m.sidebar_action?.default_icon,
  ].filter(Boolean);
}

const KEY_PATTERNS = [/sk-or-v1-[0-9a-f]{32,}/, /sk-or-[A-Za-z0-9_-]{30,}/];

/**
 * Eigen controle naast gitleaks: OpenRouter-keys en letterlijk de opgegeven
 * geheimen (de key uit local-settings.json). Geeft de paden met een treffer.
 */
export function findSecrets(files, secrets = []) {
  const hits = [];
  const needles = secrets.filter((s) => typeof s === 'string' && s.length >= 12).map((s) => Buffer.from(s));
  for (const [path, data] of files) {
    const text = data.toString('latin1');
    if (KEY_PATTERNS.some((re) => re.test(text)) || needles.some((n) => data.includes(n))) hits.push(path);
  }
  return hits;
}

/** DOS-datum en -tijd voor de zip-headers. */
function dosDateTime(date) {
  const time = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1);
  const day = ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  return { time, day };
}

/**
 * Een zip met deflate, in vaste volgorde en met één vaste datum, zodat
 * hetzelfde commit hetzelfde pakket geeft.
 *
 * @param {Array<[string, Buffer]>} files
 * @param {Date} date
 */
export function writeZip(files, date) {
  const { time, day } = dosDateTime(date);
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const [path, data] of [...files].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const name = Buffer.from(path, 'utf8');
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versie nodig
    local.writeUInt16LE(0x0800, 6); // utf-8-namen
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function git(args, options = {}) {
  return execFileSync('git', args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, ...options });
}

/** Gecommitte bestanden uit HEAD die op de allowlist staan. */
function committedFiles() {
  const paths = git(['ls-tree', '-r', '-z', '--name-only', 'HEAD']).toString('utf8').split('\0').filter(Boolean);
  return paths.filter(isAllowed).map((path) => [path, git(['show', `HEAD:${path}`])]);
}

/** Niet-gecommitte wijzigingen binnen de allowlist zouden stilletjes ontbreken. */
function assertClean() {
  const dirty = git(['status', '--porcelain', '--', ...ALLOWLIST]).toString('utf8').trim();
  if (dirty) {
    throw new Error(`Niet-gecommitte wijzigingen in wat wordt ingepakt; commit eerst:\n${dirty}`);
  }
}

function localSecrets() {
  const file = join(ROOT, 'local-settings.json');
  if (!existsSync(file)) return [];
  try {
    return Object.values(JSON.parse(readFileSync(file, 'utf8'))).filter((v) => typeof v === 'string');
  } catch {
    return [];
  }
}

/** `gitleaks dir` op de uitgepakte inhoud; gooit bij een treffer of als gitleaks ontbreekt. */
function runGitleaks(files) {
  const dir = mkdtempSync(join(tmpdir(), 'signaleringen-pakket-'));
  try {
    for (const [path, data] of files) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), data);
    }
    const result = spawnSync('gitleaks', ['dir', dir, '--no-banner', '--redact', '--exit-code', '1'], { encoding: 'utf8' });
    if (result.error?.code === 'ENOENT') {
      throw new Error('gitleaks niet gevonden; installeer het (https://github.com/gitleaks/gitleaks) en probeer opnieuw.');
    }
    if (result.status !== 0) {
      throw new Error(`gitleaks vond iets in het pakket:\n${result.stdout}${result.stderr}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main(argv) {
  const browsers = argv.length ? argv : BROWSERS;
  for (const b of browsers) if (!BROWSERS.includes(b)) throw new Error(`Onbekende browser: ${b} (kies uit ${BROWSERS.join(', ')})`);

  assertClean();
  const files = committedFiles();
  const shared = JSON.parse(files.find(([p]) => p === 'manifest.json')[1].toString('utf8'));
  const commitDate = new Date(git(['log', '-1', '--format=%cI']).toString('utf8').trim());
  const secrets = localSecrets();
  mkdirSync(join(ROOT, 'dist'), { recursive: true });

  for (const browser of browsers) {
    const manifest = manifestFor(browser, shared);
    const content = files.map(([p, d]) => (p === 'manifest.json' ? [p, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)] : [p, d]));

    const present = new Set(content.map(([p]) => p));
    const missing = manifestPaths(manifest).filter((p) => !present.has(p));
    if (missing.length) throw new Error(`Manifest verwijst naar bestanden die niet in het pakket zitten: ${missing.join(', ')}`);

    const hits = findSecrets(content, secrets);
    if (hits.length) throw new Error(`Mogelijke API-key in: ${hits.join(', ')}; geen pakket gemaakt.`);
    runGitleaks(content);

    const out = join(ROOT, 'dist', `signaleringen-${shared.version}-${browser}.zip`);
    writeFileSync(out, writeZip(content, commitDate));
    console.log(`${out}  (${content.length} bestanden)`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`Inpakken mislukt: ${err.message}`);
    process.exit(1);
  }
}
