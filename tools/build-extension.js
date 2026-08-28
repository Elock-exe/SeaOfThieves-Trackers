/* SotTracker — sottracker.fr
   Creator: Vyros__
   https://github.com/Elock-exe/SeaOfThieves-Trackers */
/* ============================================================
   Package the extension for both browsers.

       npm run build:ext

   Produces dist/sot-tracker-chrome.zip and dist/sot-tracker-firefox.zip.

   The two stores need different manifests — Firefox wants an add-on id
   and a background script list, Chrome wants a service worker — and both
   insist the file be called manifest.json. Zipping extension/ by hand
   shipped manifest.firefox.json alongside the Chrome one, which Firefox
   ignores: the add-on then failed to load with no obvious reason.

   Archiving uses tools/zip.js rather than the platform's zip tool:
   PowerShell's Compress-Archive writes Windows path separators into the
   entry names, and addons.mozilla.org rejects the result with "Invalid
   file name in archive".
   ============================================================ */

const fs = require('fs');
const path = require('path');
const { zipDir } = require('./zip');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'extension');
const DIST = path.join(ROOT, 'dist');

/* Everything the browser needs, and nothing else: the two manifests are
   handled separately, and README is documentation for humans. */
const INCLUDE = ['icons', 'src'];

const LOCAL_HEADER = 0x04034B50;
/* As a char code because every layer of quoting between an editor and
   Node wants to eat it — which is how the original bug travelled. */
const BACKSLASH = String.fromCharCode(92);

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, entry.name);
    const b = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
}

/* Check the archive, not the folder it was made from — the archive is
   what a store validator opens. A backslash in an entry name got past a
   build and past a manual listing, and was caught only by Mozilla's
   linter refusing the upload. */
function verify(file, expected) {
  const buf = fs.readFileSync(file);
  const names = [];

  for (let i = 0; i + 30 <= buf.length; i++) {
    if (buf.readUInt32LE(i) !== LOCAL_HEADER) continue;
    const len = buf.readUInt16LE(i + 26);
    names.push(buf.toString('utf8', i + 30, i + 30 + len));
  }

  const label = path.basename(file);
  const bad = names.filter((n) => n.includes(BACKSLASH));
  if (bad.length) {
    throw new Error(`${label}: ZIP entries must use forward slashes — ${bad.join(', ')}`);
  }
  if (names.length !== expected) {
    throw new Error(`${label}: expected ${expected} entries, archive holds ${names.length}`);
  }
  if (!names.includes('manifest.json')) {
    throw new Error(`${label}: no manifest.json at the archive root`);
  }
  return names;
}

function build(target, manifestName) {
  const stage = path.join(DIST, target);
  rmrf(stage);
  fs.mkdirSync(stage, { recursive: true });

  for (const name of INCLUDE) copyDir(path.join(SRC, name), path.join(stage, name));

  // Whichever manifest this browser needs, under the name it expects.
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC, manifestName), 'utf8'));
  fs.writeFileSync(
    path.join(stage, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8'
  );

  const out = path.join(DIST, `sot-tracker-${target}.zip`);
  rmrf(out);
  const count = zipDir(stage, out);
  rmrf(stage);
  verify(out, count);

  const kb = Math.round(fs.statSync(out).size / 1024);
  console.log(`  ${path.basename(out).padEnd(30)} ${String(kb).padStart(4)} KB   ` +
              `v${manifest.version}   ${count} files`);
  return manifest;
}

fs.mkdirSync(DIST, { recursive: true });
console.log('\n  Packaging the browser extension\n');

const chrome = build('chrome', 'manifest.json');
const firefox = build('firefox', 'manifest.firefox.json');

/* A version mismatch between the two stores is the kind of thing nobody
   notices until a user reports a bug that was fixed in the other build. */
if (chrome.version !== firefox.version) {
  console.warn(`\n  WARNING: versions differ — chrome ${chrome.version}, firefox ${firefox.version}`);
}

console.log('\n  Chrome  → chrome://extensions, Developer mode, Load unpacked (unzip first)');
console.log('  Firefox → about:debugging, This Firefox, Load Temporary Add-on (pick the zip)\n');
