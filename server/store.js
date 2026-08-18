/* ============================================================
   Snapshot storage.

   A thin layer over server/db.js, which decides where the rows actually
   live: local files while developing, a hosted Postgres in production.
   Nothing above this file knows or cares which.

   Only stats are ever written here. No tokens, no cookies.

   Every function is async — the remote driver does HTTP. That is the one
   thing callers had to change when free hosting turned out to wipe the
   disk on every restart.
   ============================================================ */

const db = require('./db');

/** Append one snapshot. Returns how many are now stored for that pirate. */
async function append(record) {
  return db.appendSnapshot(record);
}

async function readAll() {
  return db.snapshotsFor(null);
}

/** Most recent snapshot for one pirate. */
async function latest(handle) {
  return db.latestFor(handle);
}

/** Chronological history, for progression curves. */
async function history(handle, limit) {
  return db.historyFor(handle, limit);
}

/** One row per pirate, newest first. Bounded by the number of pirates
    rather than by how long they have been syncing. */
async function standings() {
  return db.latestPerHandle();
}

module.exports = { append, latest, history, readAll, standings, describe: db.describe };
