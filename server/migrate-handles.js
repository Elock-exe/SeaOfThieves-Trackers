/* ============================================================
   One-off migration: give every snapshot a pirate name.

   Snapshots written before accounts existed have handle: null, because
   the server filed them under "the only user on this machine". Reads are
   now scoped to a handle, so those rows would simply vanish from the
   site — the data is still there, nothing can find it.

   The name comes from data/claim.json, which is exactly what the old
   single-user claim recorded. Run once:

       node server/migrate-handles.js

   Safe to re-run: rows that already have a handle are left alone.
   ============================================================ */

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'snapshots.jsonl');
const CLAIM = path.join(DIR, 'claim.json');

function main() {
  if (!fs.existsSync(FILE)) {
    console.log('No snapshots file — nothing to migrate.');
    return;
  }

  const handle = process.argv[2] || (() => {
    try {
      return JSON.parse(fs.readFileSync(CLAIM, 'utf8')).handle;
    } catch (e) {
      return null;
    }
  })();

  if (!handle) {
    console.error('No pirate name. Pass one: node server/migrate-handles.js YourPirate');
    process.exitCode = 1;
    return;
  }

  const lines = fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean);
  let changed = 0;

  const out = lines.map((line) => {
    let rec;
    try {
      rec = JSON.parse(line);
    } catch (e) {
      return line; // leave anything unparseable untouched
    }
    if (rec.handle) return line;

    rec.handle = handle;
    if (rec.snapshot && rec.snapshot.identity) rec.snapshot.identity.handle = handle;
    changed++;
    return JSON.stringify(rec);
  });

  if (!changed) {
    console.log(`All ${lines.length} snapshots already have a handle. Nothing to do.`);
    return;
  }

  fs.copyFileSync(FILE, FILE + '.bak');
  fs.writeFileSync(FILE, out.join('\n') + '\n', 'utf8');
  console.log(`Assigned "${handle}" to ${changed} of ${lines.length} snapshots.`);
  console.log(`Backup written to ${path.basename(FILE)}.bak`);
}

main();
