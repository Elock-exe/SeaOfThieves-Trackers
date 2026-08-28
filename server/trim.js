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
function trimFaction(f) {
  if (!f || typeof f !== 'object') return f;
  const out = {};
  for (const [k, v] of Object.entries(f)) {
    if (k === 'Emblems') continue;              // never read
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
const SEASON_KEEP = ['Id', 'Title', 'Copy', 'IsActive', 'Tier',
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
