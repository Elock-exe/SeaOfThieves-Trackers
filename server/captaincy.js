/* SotTracker — sottracker.fr
   Creator: Vyros__
   https://github.com/Elock-exe/SeaOfThieves-Trackers */
/* ============================================================
   Hourglass record, read out of the captaincy accolades.

   Rare never reports a defeat. It reports how many battles were completed
   and how many were won, and the difference is the answer:

     battles = Battles Completed (as Guardians) + (as Servants)
     wins    = the four "Battles Won ... by Seeking/Repelling Foe"
     losses  = battles - wins

   Checked against a real profile: 546 + 1106 = 1652 battles, 318 + 11 + 628
   + 10 = 967 wins, 685 losses, 58.5%. Those are the same four numbers
   another tracker prints for that pirate, which is how this was confirmed
   rather than assumed.

   Two things worth knowing before trusting the number:

   Only captained ships count. Accolades are recorded per named ship, so
   battles fought on an unnamed sloop are in nobody's total. This is a win
   rate on captained ships, not a win rate.

   The record lives per ship and is summed here, which is why a pirate with
   no named ship gets a 404 from the endpoint and no record at all.
   ============================================================ */

/* The accolade titles that matter. Rare localises these — a payload
   fetched under /fr/ comes back in French — so the collector asks for the
   unprefixed path first for this group specifically, which answers in
   English. A French payload still parses for everything else; it just
   yields no Hourglass record, which is why the record is optional and its
   absence is never treated as a failure. */
const TITLES = {
  battlesGuardians: 'Battles Completed (as Guardians)',
  battlesServants: 'Battles Completed (as Servants)',
  wonVsServantsSeeking: 'Battles Won Against Servants by Seeking Foe',
  wonVsServantsRepelling: 'Battles Won Against Servants by Repelling Foe',
  wonVsGuardiansSeeking: 'Battles Won Against Guardians by Seeking Foe',
  wonVsGuardiansRepelling: 'Battles Won Against Guardians by Repelling Foe',
  servantShipsSunk: 'Servants of the Flame Ships Sunk',
  guardianShipsSunk: 'Guardians of Fortune Ships Sunk'
};

function norm(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
}

/* Walked rather than indexed by path.

   The payload nests accolades under categories ("The Guardian", "The
   Servant"), and that nesting is Rare's to change. Searching by title
   survives a container being renamed or a level being added; a hardcoded
   path does not, and this project has already lost an afternoon to
   guessing at Rare's URL shapes. */
function findByTitle(node, wanted, seen) {
  if (!node || typeof node !== 'object') return null;
  seen = seen || new Set();
  if (seen.has(node)) return null;   // payloads are trees, but be safe
  seen.add(node);

  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findByTitle(item, wanted, seen);
      if (hit != null) return hit;
    }
    return null;
  }

  const title = node.Title != null ? node.Title
    : node.title != null ? node.title
      : node.Name != null ? node.Name : node.name;

  if (title != null && norm(title) === wanted) {
    const v = node.Value != null ? node.Value
      : node.value != null ? node.value
        : node.Total != null ? node.Total : node.total;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }

  for (const k of Object.keys(node)) {
    const hit = findByTitle(node[k], wanted, seen);
    if (hit != null) return hit;
  }
  return null;
}

function read(payload, key) {
  const n = findByTitle(payload, norm(TITLES[key]));
  return n == null ? null : n;
}

/** The Hourglass record, or null when the payload carries none. */
function hourglassRecord(captaincy) {
  if (!captaincy || typeof captaincy !== 'object') return null;

  const g = read(captaincy, 'battlesGuardians');
  const s = read(captaincy, 'battlesServants');
  if (g == null && s == null) return null;   // not a captaincy payload

  const battlesGuardians = g || 0;
  const battlesServants = s || 0;

  const wonGuardians = (read(captaincy, 'wonVsServantsSeeking') || 0) +
    (read(captaincy, 'wonVsServantsRepelling') || 0);
  const wonServants = (read(captaincy, 'wonVsGuardiansSeeking') || 0) +
    (read(captaincy, 'wonVsGuardiansRepelling') || 0);

  const battles = battlesGuardians + battlesServants;
  const wins = wonGuardians + wonServants;

  /* Clamped at zero. Wins above battles would mean Rare's two counters
     disagree, and a negative defeat count on a profile is worse than a
     zero: one looks broken, the other looks quiet. */
  const losses = Math.max(0, battles - wins);

  const side = (played, won) => ({
    battles: played,
    wins: won,
    losses: Math.max(0, played - won),
    winRate: played > 0 ? Math.round((won / played) * 1000) / 10 : null
  });

  return {
    battles,
    wins,
    losses,
    /* One decimal, like the game's own figures. A rate over zero battles is
       null, not 0% — "no data" and "lost everything" are not the same. */
    winRate: battles > 0 ? Math.round((wins / battles) * 1000) / 10 : null,
    shipsSunk: (read(captaincy, 'servantShipsSunk') || 0) +
      (read(captaincy, 'guardianShipsSunk') || 0),
    guardians: side(battlesGuardians, wonGuardians),
    servants: side(battlesServants, wonServants),
    /* Said on the page, not buried in a tooltip: the number excludes every
       battle fought on a ship without a name. */
    captainedOnly: true
  };
}

/* The headline counters, by the same title lookup. Everything here is a
   single number the profile can print; the payload's real weight is in the
   breakdowns underneath them — "Treasures Sold" carries a line per treasure
   type, hundreds of them, and "Islands Visited" one per island. Reading the
   totals and dropping the rest is what keeps a snapshot small enough to
   store, which is the whole reason trim.js exists. */
const COUNTERS = {
  goldEarned: 'Gold Earned',
  treasuresSold: 'Treasures Sold',
  voyagesCompleted: 'Voyage Quests Completed',
  daysAtSea: 'Days at Sea',
  nauticalMiles: 'Nautical Miles Sailed',
  cannonsFired: 'Cannons Fired',
  krakens: 'Krakens Vanquished',
  timesSunk: 'Times Sunk',
  repairs: 'Repairs Made',
  tallTales: 'Tall Tales Completed'
};

function counters(captaincy) {
  if (!captaincy || typeof captaincy !== 'object') return null;
  const out = {};
  let found = 0;
  for (const key of Object.keys(COUNTERS)) {
    const n = findByTitle(captaincy, norm(COUNTERS[key]));
    if (n != null) { out[key] = n; found++; }
  }
  return found ? out : null;
}

module.exports = { hourglassRecord, counters, TITLES, COUNTERS };
