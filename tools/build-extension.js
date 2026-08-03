/* ============================================================
   Package the extension for both browsers.

       node tools/build-extension.js

   Produces dist/sot-tracker-chrome.zip and dist/sot-tracker-firefox.zip.

   The two stores need different manifests — Firefox wants an add-on id
   and a background script list, Chrome wants a service worker — and both
   insist the file be called manifest.json. Zipping extension/ by hand
   shipped manifest.firefox.json alongside the Chrome one, which Firefox
   ignores: the add-on then failed to load with no obvious reason.

   Node has no zip built in, so the archiving is done by the platform:
   PowerShell's Compress-Archive on Windows, `zip` elsewhere.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'extension');
const DIST = path.join(ROOT, 'dist');

/* Everything the browser needs, and nothing else: the two manifests are
   handled separately, and README is documentation for humans. */
const INCLUDE = ['icons', 'src'];

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

function zip(dir, outFile) {
  rmrf(outFile);
  if (process.platform === 'win32') {
    execFileSync('powershell', [
      '-NoProfile', '-Command',
      `Compress-Archive -Path '${dir}\\*' -DestinationPath '${outFile}' -Force`
    ], { stdio: 'pipe' });
  } else {
    execFileSync('zip', ['-qr', outFile, '.'], { cwd: dir, stdio: 'pipe' });
  }
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
  zip(stage, out);
  rmrf(stage);

  const kb = Math.round(fs.statSync(out).size / 1024);
  console.log(`  ${path.basename(out).padEnd(30)} ${String(kb).padStart(4)} KB   v${manifest.version}`);
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
