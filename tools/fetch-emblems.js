/* SotTracker — sottracker.fr
   Creator: Vyros__
   https://github.com/Elock-exe/SeaOfThieves-Trackers */
/* ============================================================
   Game artwork — emblems and chest cosmetics — imported from Rare rather
   than collected by hand.

   Every emblem in a reputation payload carries the URL of its own picture,
   so nothing here is scraped or guessed — the addresses come from the data
   the tracker already stores.

   What they cannot do is be used as they are. Rare serves each emblem as a
   1024x1024 PNG of about 350 KB, and the CDN refuses every resize parameter
   with a 403, so a page showing one company's 28 emblems would make a
   visitor download 10 MB. Fetched once and reduced to 96px they are 9 KB
   each, which is the difference between a feature and a regression.

   An emblem's picture is the same for every pirate, so this is a shared
   catalogue: downloaded once, reused by every profile.

     node tools/fetch-emblems.js            every emblem found locally
     node tools/fetch-emblems.js --limit 50 the first 50, to try it out
     node tools/fetch-emblems.js --force    re-download what is already there

   Re-runs are cheap: an emblem already on disk is skipped without a request.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const https = require('https');
const png = require('./png');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'img', 'emblems');
const SIZE = 96;
const CONCURRENCY = 6;      // polite: this is Rare's CDN, not an API of ours

const args = process.argv.slice(2);
const flag = (name) => args.indexOf(name) >= 0;
const value = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : dflt;
};

/* Every emblem in every snapshot on disk, deduplicated by file name.

   Walked rather than read by path: emblems sit at
   reputation.<Faction>.Emblems.Emblems[], and that shape is Rare's to
   change. Anything carrying an image URL and a display name is an emblem
   as far as this is concerned. */
function collect() {
  const file = path.join(ROOT, 'data', 'snapshots.jsonl');
  if (!fs.existsSync(file)) return [];

  const found = new Map();

  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }

    /* Two shapes, because the two payloads are stored differently.

       An emblem in an untrimmed snapshot still carries its absolute URL. A
       chest summary carries one artBase for the whole payload and a file
       name per item — 60 KB lighter per snapshot, and rejoined here. */
    const url = typeof node.image === 'string' ? node.image : null;
    const name = node.DisplayName || node['#Name'] || null;
    if (url && name && /^https:\/\//.test(url) && /\.png$/i.test(url)) {
      const base = url.split('/').pop().split('?')[0];
      if (!found.has(base)) found.set(base, { base, url, name });
    }

    if (typeof node.artBase === 'string' && Array.isArray(node.categories)) {
      for (const cat of node.categories) {
        for (const it of (cat && cat.items) || []) {
          if (!it || !it.i || found.has(it.i)) continue;
          found.set(it.i, { base: it.i, url: node.artBase + it.i, name: it.n || it.i });
        }
      }
    }

    for (const k of Object.keys(node)) walk(node[k]);
  };

  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { walk(JSON.parse(line)); } catch (e) { /* a torn line is not fatal */ }
  }
  return [...found.values()];
}

function download(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const parts = [];
      res.on('data', (d) => parts.push(d));
      res.on('end', () => resolve(Buffer.concat(parts)));
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

async function one(item) {
  const dest = path.join(OUT, item.base);
  if (!flag('--force') && fs.existsSync(dest)) return 'skipped';

  const buf = await download(item.url);
  const img = png.decode(buf);
  const small = png.resize(img, SIZE, SIZE);
  fs.writeFileSync(dest, png.encode(small.w, small.h, small.rgba));
  return 'written';
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  let items = collect();
  const limit = value('--limit', 0);
  if (limit > 0) items = items.slice(0, limit);

  if (!items.length) {
    console.log('\n  No emblems found in data/snapshots.jsonl.');
    console.log('  Sync an account first — the artwork addresses come from the payload.\n');
    return;
  }

  console.log('\n  Importing emblem artwork from Rare');
  console.log('  ' + items.length + ' to consider, ' + SIZE + 'px, ' + CONCURRENCY + ' at a time\n');

  const tally = { written: 0, skipped: 0, failed: 0 };
  const failures = [];
  let next = 0;
  let bytesIn = 0;

  /* A fixed pool rather than Promise.all over everything: 1500 parallel
     requests to someone else's CDN is a denial of service with good
     intentions. */
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      const item = items[i];
      try {
        const before = fs.existsSync(path.join(OUT, item.base));
        const r = await one(item);
        tally[r]++;
        if (r === 'written' && !before) bytesIn += 350 * 1024;   // rough
      } catch (e) {
        tally.failed++;
        failures.push(item.base + ': ' + e.message);
      }
      const done = tally.written + tally.skipped + tally.failed;
      if (done % 25 === 0 || done === items.length) {
        process.stdout.write('\r  ' + done + '/' + items.length +
          '   written ' + tally.written + '  skipped ' + tally.skipped +
          '  failed ' + tally.failed + '   ');
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  let onDisk = 0;
  for (const f of fs.readdirSync(OUT)) onDisk += fs.statSync(path.join(OUT, f)).size;

  console.log('\n');
  console.log('  written : ' + tally.written);
  console.log('  skipped : ' + tally.skipped + ' (already imported)');
  console.log('  failed  : ' + tally.failed);
  console.log('  on disk : ' + (onDisk / 1024 / 1024).toFixed(1) + ' MB in assets/img/emblems/');

  /* Named, not counted. "3 failed" tells nobody which three, and a missing
     emblem shows up much later as a blank square on someone's profile. */
  if (failures.length) {
    console.log('\n  Failures:');
    for (const f of failures.slice(0, 20)) console.log('    ' + f);
    if (failures.length > 20) console.log('    ... and ' + (failures.length - 20) + ' more');
  }
  console.log('');
})();
