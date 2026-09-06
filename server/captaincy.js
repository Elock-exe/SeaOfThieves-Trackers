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

/* The sum of an accolade's breakdown, whatever shape its entries take:
   bare numbers, { Value }, or { Name, Value } as the Hourglass endpoints
   use. Null when there is nothing to add, so the caller falls through to
   the single-field candidates rather than reading zero as an answer. */
function statsTotal(stats) {
  if (!Array.isArray(stats) || !stats.length) return null;
  let sum = 0;
  let seen = 0;
  for (const st of stats) {
    const raw = st && typeof st === 'object'
      ? (st.Value != null ? st.Value : (st.value != null ? st.value : st.CurrentProgress))
      : st;
    const n = Number(raw);
    if (raw != null && Number.isFinite(n)) { sum += n; seen++; }
  }
  return seen ? sum : null;
}

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

  /* Every spelling seen so far, and a few not yet.

     The first version read Title, title, Name and name, and found nothing
     at all in a real captaincy payload — not one of the ten counters, which
     is how a wrong assumption announces itself. Alignments use Title beside
     LocalisedTitle, so accolades plausibly do too, and #Name is how Rare
     labels items elsewhere in the same document. */
  const TITLE_KEYS = ['Title', 'title', 'LocalisedTitle', 'localisedTitle',
    'DisplayName', 'displayName', 'Name', 'name', '#Name'];
  /* CurrentProgress first, because that is what a captaincy accolade
     actually calls its number — confirmed from a live payload, whose
     accolades read { ProgressId, LocalisedTitle, IsPinned, MilestoneLevel,
     LevelReachedAt, CurrentProgress, Threshold, Stats }.

     That single missing name is why every lookup failed. The titles were
     matching all along: the search found "Gold Earned", looked for a value
     under eleven other spellings, found none, and moved on as though the
     title had never matched. */
  const VALUE_KEYS = ['CurrentProgress', 'Value', 'value', 'Total', 'total',
    'Count', 'count', 'Progress', 'progress', 'Amount', 'amount', 'MilestoneSum'];

  let title = null;
  for (const k of TITLE_KEYS) {
    if (node[k] != null && typeof node[k] !== 'object') { title = node[k]; break; }
  }

  if (title != null && norm(title) === wanted) {
    /* Stats before CurrentProgress.

       CurrentProgress is progress toward the milestone in hand, not a
       career total — it sits beside MilestoneLevel, LevelReachedAt and
       Threshold, which is what those four are for. Reading it gave a pirate
       holding 2.38M gold a "Gold Earned" of 54,000: the part earned since
       the last milestone.

       The lifetime figure is the breakdown underneath. Another tracker
       prints "Battles Completed (as Guardians) 546" over Galleons 499,
       Brigantines 27 and Sloops 20 — the total is the sum of its parts. */
    const total = statsTotal(node.Stats);
    if (total != null) return total;

    for (const k of VALUE_KEYS) {
      const n = Number(node[k]);
      if (node[k] != null && Number.isFinite(n)) return n;
    }
  }

  for (const k of Object.keys(node)) {
    const hit = findByTitle(node[k], wanted, seen);
    if (hit != null) return hit;
  }
  return null;
}

/* The pirate's total, not the first ship that happens to carry the title.

   captaincy is { Favourites, Ships, Pirate, Paths } — Ships comes first, so
   a walk of the whole object reached a single vessel's accolades before the
   career ones and stopped there. A pirate at Hourglass 165 published two
   battles: the two fought aboard whichever ship the walk met first.

   Pirate.Alignments carries the career figures — its MilestoneSum is the
   sum across every vessel — so that is where a total is read. Ships are the
   fallback, summed rather than sampled, for a payload that ever arrives
   without the career block. */
function careerFirst(captaincy, wanted) {
  const pirate = captaincy && captaincy.Pirate;
  if (pirate) {
    const n = findByTitle(pirate, wanted);
    if (n != null) return n;
  }

  const ships = captaincy && Array.isArray(captaincy.Ships) ? captaincy.Ships : [];
  let sum = null;
  for (const ship of ships) {
    const n = findByTitle(ship, wanted);
    if (n != null) sum = (sum || 0) + n;
  }
  return sum;
}

function read(payload, key) {
  const n = careerFirst(payload, norm(TITLES[key]));
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
    const n = careerFirst(captaincy, norm(COUNTERS[key]));
    if (n != null) { out[key] = n; found++; }
  }
  return found ? out : null;
}


/* Ships, as Rare files them: captaincy.Ships[], each with a name, a hull
   type and one Alignment per milestone path — The Gold Seeker, The Voyager,
   The Feared and so on — carrying that path's MilestoneSum.

   The number a captain recognises is the sum across paths: it is what the
   game shows on the ship's plaque, and what other trackers print under the
   ship's name. Kept with the three biggest paths, because a galleon with
   twelve thousand milestones says nothing about how they were earned and
   "The Ill-Fated 2801" says it immediately. */
function ships(captaincy) {
  const list = captaincy && Array.isArray(captaincy.Ships) ? captaincy.Ships : null;
  if (!list || !list.length) return null;

  return list.map((sh) => {
    const al = Array.isArray(sh.Alignments) ? sh.Alignments : [];
    const paths = al
      .map((a) => ({
        title: a.LocalisedTitle || a.Title || '',
        sum: Number(a.MilestoneSum) || 0
      }))
      .filter((p) => p.title && p.sum > 0)
      .sort((a, b) => b.sum - a.sum);

    return {
      name: sh.Name || '',
      type: sh.Type || '',
      /* Summed here rather than on the page: the client would have to carry
         every alignment to do it, and this is the only figure it draws. */
      milestones: paths.reduce((n, p) => n + p.sum, 0),
      top: paths.slice(0, 3)
    };
  }).filter((sh) => sh.name).sort((a, b) => b.milestones - a.milestones);
}

/* The pirate's own milestone paths, the same shape as a ship's. This is the
   Captaincy tab: totals across every ship ever sailed, not just the named
   ones. */
function paths(captaincy) {
  const al = captaincy && captaincy.Pirate && Array.isArray(captaincy.Pirate.Alignments)
    ? captaincy.Pirate.Alignments : null;
  if (!al || !al.length) return null;

  const out = al
    .map((a) => ({
      title: a.LocalisedTitle || a.Title || '',
      sum: Number(a.MilestoneSum) || 0,
      accolades: Array.isArray(a.Accolades) ? a.Accolades.length : 0
    }))
    .filter((p) => p.title)
    .sort((a, b) => b.sum - a.sum);

  return out.length ? out : null;
}

/* The chest is a count per category and nothing more.

   Each entry carries a title, a subtitle and an artwork URL, and there are
   six hundred of them — 257 KB for a page that prints eight numbers and a
   total. The names are the game's, identical for every pirate, so storing
   them per pirate per sync would be the emblem mistake again. */
/* Which sub-type an item belongs to — a cannon, a figurehead, a hull
   livery — read by matching rather than by a known field.

   categoryMap names the sub-types Rare uses for each category, and every
   item carries a Taxonomy whose tags say which one it is. The tag objects'
   own shape was never visible in what came back, so instead of guessing at
   a key name this collects every string in the taxonomy and keeps the one
   that matches a name already declared in categoryMap.

   Underscores are Rare's ("Bone_Colour"); spaces are what a reader
   expects. */
function labelOf(name) {
  return String(name || '').replace(/_/g, ' ').trim();
}

function collectStrings(node, out, depth) {
  if (!node || (depth || 0) > 4) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (typeof node !== 'object') return out;
  for (const v of Object.values(node)) collectStrings(v, out, (depth || 0) + 1);
  return out;
}

/* Every cosmetic's artwork sits on the same CDN under the same versioned
   folder, so the address is one prefix plus a file name. Storing the prefix
   once and the file name per item costs about 60 KB less per snapshot than
   storing six hundred absolute URLs, and the importer can rebuild any of
   them from the two. */
function splitUrl(url) {
  const u = String(url || '');
  const cut = u.lastIndexOf('/');
  if (u.indexOf('https://') !== 0 || cut < 0) return null;
  return { base: u.slice(0, cut + 1), file: u.slice(cut + 1).split('?')[0] };
}

function knownMap(known) {
  if (!Array.isArray(known) || !known.length) return null;
  const m = new Map();
  for (const k of known) m.set(labelOf(k).toLowerCase(), labelOf(k));
  return m;
}

function subTypeOf(item, wanted) {
  if (!wanted) return null;
  for (const str of collectStrings(item && item.Taxonomy, [], 0)) {
    const hit = wanted.get(labelOf(str).toLowerCase());
    if (hit) return hit;
  }
  return null;
}

function subTypes(items, known) {
  const wanted = knownMap(known);
  if (!wanted) return null;

  const tally = new Map();
  for (const item of items) {
    const hit = subTypeOf(item, wanted);
    if (hit) tally.set(hit, (tally.get(hit) || 0) + 1);
  }

  const out = [...tally.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  return out.length ? out : null;
}

function chest(payload) {
  const data = payload && payload.chestData;
  if (!data || typeof data !== 'object') return null;
  const map = (payload && payload.categoryMap) || {};

  const categories = [];
  let total = 0;
  let artBase = null;

  for (const [key, items] of Object.entries(data)) {
    if (!Array.isArray(items) || !items.length) continue;
    /* The breakdown is what makes this worth opening: "Ship cosmetics 109"
       says how much, "Figurehead 67, Mast 63" says what kind of captain. */
    const sub = subTypes(items, map[key]);

    /* The pieces themselves, so the page can show them rather than only
       count them. Name and file name and nothing else: the description is
       a sentence of flavour text per item, six hundred of them, and the
       artwork is fetched once by tools/fetch-emblems.js and served from
       here — the pirate's copy of a figurehead looks like everyone's. */
    const wanted = knownMap(map[key]);
    const owned = [];
    for (const it of items) {
      const parts = splitUrl(it && it.image);
      const name = (it && (it.title || it['#Name'])) || '';
      if (!parts || !name) continue;
      if (!artBase) artBase = parts.base;
      const kind = subTypeOf(it, wanted);
      owned.push(kind ? { i: parts.file, n: name, s: kind } : { i: parts.file, n: name });
    }

    const entry = { key, count: items.length };
    if (sub) entry.sub = sub;
    if (owned.length) entry.items = owned;
    categories.push(entry);
    total += items.length;
  }
  if (!categories.length) return null;

  categories.sort((a, b) => b.count - a.count);
  return artBase ? { total, artBase, categories } : { total, categories };
}


/* The key names of one accolade, and nothing else.

   Three attempts at reading the Hourglass record found nothing, and each
   time the only way forward was asking someone to run a probe in their own
   browser and paste the result back. That is a poor way to learn the shape
   of a payload this service receives thousands of times a day.

   So one sync now carries the field names — names only, no values, about a
   hundred bytes — and the next failure explains itself. */
/* The two Hourglass alignments, listed by identifier rather than by name.

   An accolade carries LocalisedTitle and nothing else — no English original
   beside it, unlike the alignment one level up. So a French account's
   "Or gagné" can never match "Gold Earned", and no Accept-Language header
   changes that: Rare localises to the account, not the request.

   ProgressId does not move. It reads
   <alignment uuid>:<accolade uuid>:<index>, and the middle part names the
   accolade itself in every language. Matching on that ends the problem for
   good — but the identifiers have to be learned once, from a payload, which
   is what this reports.

   Only the two Hourglass paths, only ids and titles, and only while the
   record is still not being found. */
function hourglassIds(captaincy) {
  const out = [];
  const seen = new Set();

  const scan = (alignments) => {
    for (const a of alignments || []) {
      const name = String(a.Title || a.LocalisedTitle || '');
      if (!/guardian|servant|gardien|serviteur/i.test(name)) continue;
      for (const acc of a.Accolades || []) {
        const id = String(acc.ProgressId || '');
        const mid = id.split(':')[1] || id;
        if (!mid || seen.has(mid)) continue;
        seen.add(mid);
        const st = Array.isArray(acc.Stats) && acc.Stats[0] ? acc.Stats[0].Value : null;
        out.push(mid + ' | ' + String(acc.LocalisedTitle || '').slice(0, 48) + ' | ' + st);
        if (out.length >= 20) return;
      }
    }
  };

  if (captaincy && captaincy.Pirate) scan(captaincy.Pirate.Alignments);
  if (!out.length && captaincy && Array.isArray(captaincy.Ships)) {
    for (const sh of captaincy.Ships) { scan(sh.Alignments); if (out.length) break; }
  }
  return out.length ? out : null;
}

function shapeOf(captaincy) {
  const al = captaincy && captaincy.Pirate && captaincy.Pirate.Alignments;
  if (!Array.isArray(al)) return null;
  for (const a of al) {
    const acc = a && a.Accolades;
    if (Array.isArray(acc) && acc.length && acc[0] && typeof acc[0] === 'object') {
      /* One accolade whole, values included, capped at 700 characters.
         These are game statistics the profile publishes anyway, and reading
         the field names alone was not enough: it showed CurrentProgress
         existed without showing that it counts the wrong thing. */
      const full = JSON.stringify(acc[0]);
      return {
        alignment: Object.keys(a).slice(0, 12),
        accolade: Object.keys(acc[0]).slice(0, 14),
        sample: full.length > 700 ? full.slice(0, 700) + '…' : full
      };
    }
  }
  return null;
}

module.exports = { hourglassRecord, counters, ships, paths, chest, shapeOf, hourglassIds, TITLES, COUNTERS };
