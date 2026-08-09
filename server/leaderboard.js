/* ============================================================
   Leaderboards.

   The page called "Leaderboards" used to list the profiles this browser
   had looked up, ranked by achievements. That is a history, not a
   ranking: it changed per visitor and nobody appeared on it unless you
   had searched for them.

   A real ranking needs every published pirate compared on one number.
   The snapshots hold that already — one row per sync, so the latest per
   handle is the current standing.

   Ranking is done here rather than in SQL to keep the two storage
   drivers behaving identically: the file driver has no query language,
   and a leaderboard that only worked in production would be a trap.
   With tens of players that costs nothing; past a few thousand this
   becomes an indexed query, and this comment becomes the reason it
   moved.
   ============================================================ */

const store = require('./store');

/* Every metric the front-end can rank by. `pick` reads one number out of
   a snapshot; a pirate missing that number is left out of that board
   rather than ranked as a zero — a crew with no Hourglass rank has not
   "lost", they have not played it. */
const METRICS = {
  gold:            { label: 'Gold',              pick: (s) => cur(s, 'gold') },
  doubloons:       { label: 'Doubloons',         pick: (s) => cur(s, 'doubloons') },
  ancientCoins:    { label: 'Ancient Coins',     pick: (s) => cur(s, 'ancientCoins') },

  servants:        { label: 'Servants of the Flame', pick: (s) => faction(s, 'Flameheart') },
  guardians:       { label: 'Guardians of Fortune',  pick: (s) => faction(s, 'PirateLord') },

  reapersBones:    { label: "Reaper's Bones",     pick: (s) => faction(s, 'ReapersBones') },
  athenaFortune:   { label: "Athena's Fortune",   pick: (s) => faction(s, 'AthenasFortune') },
  goldHoarders:    { label: 'Gold Hoarders',      pick: (s) => faction(s, 'GoldHoarders') },
  orderOfSouls:    { label: 'Order of Souls',     pick: (s) => faction(s, 'OrderOfSouls') },
  merchantAlliance:{ label: 'Merchant Alliance',  pick: (s) => faction(s, 'MerchantAlliance') },
  huntersCall:     { label: "Hunter's Call",      pick: (s) => faction(s, 'HuntersCall') },

  emblems:         { label: 'Emblems unlocked',   pick: emblems },
  totalLevels:     { label: 'Total company levels', pick: totalLevels },

  /* The only board a console player can reach. Every metric above is read
     from a snapshot, and snapshots come from the extension — so a pirate
     who cannot run it could not appear anywhere, however much they played.
     Playtime is public Steam/Xbox data, remembered from lookups, so it
     ranks anyone the site has ever been asked about. */
  playtimeHours:   { label: 'Playtime (hours)', source: 'public' }
};

function cur(snap, key) {
  const c = snap && snap.currencies;
  return c && typeof c[key] === 'number' ? c[key] : null;
}

function faction(snap, key) {
  const f = snap && snap.reputation && snap.reputation[key];
  if (!f || typeof f !== 'object' || f.Level == null) return null;
  return Number(f.Level);
}

function emblems(snap) {
  const rep = snap && snap.reputation;
  if (!rep) return null;
  let n = 0;
  let seen = false;
  for (const f of Object.values(rep)) {
    if (!f || typeof f !== 'object') continue;
    n += Number(f.EmblemsUnlocked || 0);
    seen = true;
  }
  return seen ? n : null;
}

/* The six trading companies only: Tall Tales and the Hourglass factions
   are not company levels, and adding them would make the number mean
   nothing. */
const COMPANY_KEYS = ['GoldHoarders', 'OrderOfSouls', 'MerchantAlliance',
                      'AthenasFortune', 'ReapersBones', 'HuntersCall'];

function totalLevels(snap) {
  const rep = snap && snap.reputation;
  if (!rep) return null;
  let n = 0;
  let seen = false;
  for (const key of COMPANY_KEYS) {
    const f = rep[key];
    if (f && typeof f === 'object' && f.Level != null) { n += Number(f.Level); seen = true; }
  }
  return seen ? n : null;
}

/** The most recent snapshot for each pirate. */
async function currentStandings() {
  const all = await store.readAll();
  const latest = new Map();

  for (const rec of all) {
    if (!rec || !rec.handle) continue;
    const key = String(rec.handle).toLowerCase();
    const prev = latest.get(key);
    // Rows arrive in insertion order; keep the last one seen per pirate.
    if (!prev || String(rec.capturedAt || '') >= String(prev.capturedAt || '')) {
      latest.set(key, rec);
    }
  }
  return [...latest.values()];
}

/**
 * @param {string} metric  a key of METRICS
 * @param {number} limit
 * @returns {{metric, label, entries: Array, total: number}}
 */
async function rank(metric, limit) {
  const def = METRICS[metric];
  if (!def) {
    const err = new Error(`Unknown metric "${metric}"`);
    err.code = 'bad_metric';
    throw err;
  }

  /* Two different populations, so two different reads. The snapshot boards
     rank pirates who published; the public boards rank everyone the site
     has been asked about, linked or not. `total` counts the population the
     board was drawn from, not the whole site. */
  const rows = def.source === 'public'
    ? await require('./db').allPublicPlayers()
    : await currentStandings();

  const entries = rows
    .map((rec) => (def.source === 'public'
      ? {
        handle: rec.handle,
        value: typeof rec.playtimeHours === 'number' ? rec.playtimeHours : null,
        capturedAt: rec.seenAt || null,
        avatar: rec.avatar || null
      }
      : {
        handle: rec.handle,
        value: def.pick(rec.snapshot),
        capturedAt: rec.capturedAt,
        avatar: (rec.snapshot && rec.snapshot.identity && rec.snapshot.identity.avatar) || null
      }))
    .filter((e) => e.value != null && e.handle)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit || 100)
    .map((e, i) => Object.assign({ rank: i + 1 }, e));

  return { metric, label: def.label, entries, total: rows.length };
}

function metrics() {
  return Object.entries(METRICS).map(([key, m]) => ({ key, label: m.label }));
}

module.exports = { rank, metrics, METRICS };
