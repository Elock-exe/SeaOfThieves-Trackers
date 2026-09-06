/* SotTracker — sottracker.fr
   Creator: Vyros__
   https://github.com/Elock-exe/SeaOfThieves-Trackers */
/* ============================================================
   Shrink a snapshot to what the site actually reads.

   Rare's profile payload is 1.18 MB, and 1.17 MB of that is never
   displayed anywhere:

     Campaigns[]  802 KB — only its length is used
     Emblems[]    204 KB — never read at all
     season       171 KB — ChallengeGroups, ProgressionPaths,
                           AvailablePaths and Images, none of them read

   Storing it whole was not just wasteful. `latestPerHandle` fetches one
   snapshot per pirate in parallel to build the leaderboards, and JSON.parse
   holds several times the text size in live objects — so the boards alone
   allocated hundreds of megabytes, and Render killed the process for it
   (exit 137, SIGKILL: out of memory on a 512 MB instance).

   Arrays whose length is the only thing anyone wants become that length.
   The readers accept a number or an array, so snapshots written before
   this existed still render.
   ============================================================ */

/** Length of an array or object; a number is already a count. */
function count(v) {
  if (Array.isArray(v)) return v.length;
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object') return Object.keys(v).length;
  return 0;
}

/* Everything the profile page and the boards read out of a faction. Rare
   adds keys over time — new event factions arrive as bare UUIDs — so this
   drops the two known-heavy ones rather than allowlisting, and a field we
   have not seen yet survives instead of vanishing silently. */
/* One emblem, cut down to what a card shows.

   Rare sends about 700 bytes each: a description, a taxonomy of tags, an
   absolute artwork URL, internal type markers. Across every company that is
   1009 KB of a 1182 KB snapshot — the weight that took the API down with an
   out-of-memory kill, and the reason these used to be dropped whole.

   Kept instead: the picture's file name, the name shown, and the pirate's
   standing in it. The artwork itself is imported once by
   tools/fetch-emblems.js and served from this site, so the URL is not worth
   storing per pirate per sync; the file name is enough to find it.

   Emblems with no progress are dropped. A pirate holds a few hundred of the
   game's fifteen hundred, and a row reading 0/250 is not a merit, it is a
   list of everything not done yet. */
function trimEmblem(e) {
  if (!e || typeof e !== 'object') return null;

  const url = typeof e.image === 'string' ? e.image : (e.Image || '');
  const file = String(url).split('/').pop().split('?')[0];
  const grade = Number(e.Grade) || 0;
  const value = Number(e.Value) || 0;
  if (!file || (!grade && !value)) return null;

  return {
    i: file,
    n: e.DisplayName || e['#Name'] || '',
    g: grade,
    m: Number(e.MaxGrade) || 0,
    v: value,
    t: Number(e.Threshold) || 0
  };
}

function trimEmblems(block) {
  if (!block || typeof block !== 'object') return null;
  const list = Array.isArray(block.Emblems) ? block.Emblems
    : Array.isArray(block) ? block : null;
  if (!list) return null;

  const kept = list.map(trimEmblem).filter(Boolean);
  return {
    total: Number(block.EmblemsTotal) || list.length,
    unlocked: Number(block.EmblemsUnlocked) || kept.filter((e) => e.g > 0).length,
    items: kept
  };
}

function trimFaction(f) {
  if (!f || typeof f !== 'object') return f;
  const out = {};
  for (const [k, v] of Object.entries(f)) {
    if (k === 'Emblems') {
      const em = trimEmblems(v);
      if (em && em.items.length) out.Emblems = em;
      continue;
    }
    if (k === 'Campaigns') { out.Campaigns = count(v); continue; }
    out[k] = v;
  }
  return out;
}

function trimReputation(rep) {
  if (!rep || typeof rep !== 'object') return rep;
  const out = {};
  for (const [key, f] of Object.entries(rep)) out[key] = trimFaction(f);
  return out;
}

/* seasonsOf() in data.js reads exactly these, plus the length of Tiers and
   of Levels. The rest of a season object is presentation Rare sends for its
   own page — banners, challenge trees, unlock paths. */
/* ActiveFrom et ActiveUntil ne sont pas de la decoration : c'est la seule
   source qui dise quand la saison en cours se termine. La page d'accueil
   affichait une fausse echeance faute de les avoir. */
const SEASON_KEEP = ['Id', 'Title', 'Copy', 'IsActive', 'Tier',
  'ActiveFrom', 'ActiveUntil',
  'LevelProgress', 'CompleteChallenges', 'TotalChallenges'];

function trimOneSeason(s) {
  if (!s || typeof s !== 'object') return s;
  const out = {};
  for (const k of SEASON_KEEP) if (s[k] !== undefined) out[k] = s[k];
  if (s.Tiers !== undefined) out.Tiers = count(s.Tiers);
  if (s.Levels !== undefined) out.Levels = count(s.Levels);
  return out;
}

function trimSeason(season) {
  if (Array.isArray(season)) return season.map(trimOneSeason);
  if (season && typeof season === 'object') return trimOneSeason(season);
  return season;
}

/** A snapshot carrying the same information, minus what nothing displays. */
function trim(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  return Object.assign({}, snapshot, {
    reputation: trimReputation(snapshot.reputation),
    season: trimSeason(snapshot.season)
  });
}

module.exports = { trim };
