/* ============================================================
   Sea of Thieves Tracker — data layer

   Everything here is real. There is no generated data.

   Three sources, each with a badge shown on the profile:

     'public'    → Steam / Xbox Live. Playtime + achievements for any
                   player with a public profile. No signup needed.
     'connected' → Rare's internal API, and only for the account whose
                   session cookie is in .env. Gold, Hourglass rank,
                   reputation, commendations. Rare never serves anyone
                   else's data, so this can only ever be *your* pirate.
     'calculated'→ derived locally from stored lookups over time.

   NOTE ON PVP: Sea of Thieves exposes no kill count and no K/D —
   Rare deliberately withholds them. Hourglass allegiance is the
   game's actual PvP rank and is presented as such.
   ============================================================ */
(function (global) {
  'use strict';

  const API_BASE = window.SOT_API_BASE || 'http://localhost:8787';

  /* The six trading companies tracked in-game. */
  const COMPANIES = [
    { key: 'goldHoarders',     name: 'Gold Hoarders',     max: 75 },
    { key: 'orderOfSouls',     name: 'Order of Souls',    max: 75 },
    { key: 'merchantAlliance', name: 'Merchant Alliance', max: 75 },
    { key: 'athenaFortune',    name: "Athena's Fortune",  max: 30 },
    { key: 'reapersBones',     name: "Reaper's Bones",    max: 75 },
    { key: 'huntersCall',      name: "Hunter's Call",     max: 75 }
  ];

  const MILESTONE_KEYS = [
    'shipsSunk', 'skeletonShipsSunk', 'krakensDefeated', 'megalodonsDefeated',
    'fortsLooted', 'chestsSold', 'nauticalMiles', 'islandsVisited', 'fishCaught'
  ];

  /* ---------------- query helpers ---------------- */

  function playerFromQuery() {
    return new URLSearchParams(window.location.search).get('player') || '';
  }

  /* 'auto' lets the API try every configured source at once, so nobody
     has to know whether a name is a gamertag or a Steam handle. */
  function platformFromQuery() {
    const p = (new URLSearchParams(window.location.search).get('platform') || '').toLowerCase();
    return (p === 'steam' || p === 'xbox') ? p : 'auto';
  }

  /* ---------------- API ---------------- */

  async function apiHealth() {
    try {
      const res = await fetch(API_BASE + '/api/health', { cache: 'no-store' });
      return res.ok ? res.json() : null;
    } catch (e) {
      return null; // API not running
    }
  }

  function apiError(body, status) {
    const err = new Error((body.error && body.error.message) || `Request failed (${status})`);
    err.code = (body.error && body.error.code) || 'upstream';
    return err;
  }

  /* The API sleeps when idle — free hosting — and the first request after a
     quiet spell wakes it, which can take the better part of a minute. An
     unbounded fetch turns that into a spinner with no end and no
     explanation, which reads as a broken site rather than a slow one.
     So: a ceiling above the cold start, and a nudge to whoever is waiting
     once it stops looking instantaneous. */
  const WAKE_BUDGET_MS = 70000;
  const SLOW_AFTER_MS = 2500;

  async function apiFetch(path, opts) {
    const o = opts || {};
    const ctl = new AbortController();
    const cap = setTimeout(() => ctl.abort(), o.timeout || WAKE_BUDGET_MS);
    const slow = o.onSlow ? setTimeout(o.onSlow, SLOW_AFTER_MS) : null;
    try {
      return await fetch(API_BASE + path, { cache: 'no-store', signal: ctl.signal });
    } finally {
      clearTimeout(cap);
      if (slow) clearTimeout(slow);
    }
  }

  async function call(path) {
    let res;
    try {
      res = await apiFetch(path);
    } catch (e) {
      const err = new Error('The local API is not running');
      err.code = 'api_down';
      throw err;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw apiError(body, res.status);
    return body;
  }

  /** Public lookup — any player, from Steam or Xbox. */
  async function lookupPlayer(platform, id) {
    const q = new URLSearchParams({ id });
    if (platform && platform !== 'auto') q.set('platform', platform);
    const snap = await call('/api/player?' + q.toString());
    return normalize(snap, id);
  }

  /** The linked account — always the signed-in pirate.
   *
   *  Two ways to be linked, tried in order:
   *    /api/me     — the session cookie pasted into .env by hand
   *    /api/synced — the browser extension's last sync
   *
   *  The extension replaced the manual cookie, but nothing here ever read
   *  its data, so a perfectly good sync still showed as "not linked". */
  async function lookupLinked() {
    try {
      return normalize(await call('/api/me'), null);
    } catch (e) {
      if (e.code === 'api_down') throw e;
      const owner = syncedOwner();
      if (!owner) throw e;
      return normalize(await call('/api/synced?handle=' + encodeURIComponent(owner)), null);
    }
  }

  /** Published stats for one pirate, or null if nobody has synced them.
   *  Public by design — that is what a tracker is. */
  async function syncedFor(handle) {
    if (!handle) return null;
    try {
      return await call('/api/synced?handle=' + encodeURIComponent(handle));
    } catch (e) {
      return null;
    }
  }

  /* Rare's payloads carry no gamertag, and reading it off the page is
     best-effort at best. Rather than leave a good sync unattachable, let the
     owner say which pirate it belongs to — they are the authority on that,
     and this is their own machine. */
  const OWNER_KEY = 'sot-synced-owner';

  function syncedOwner() {
    try {
      return localStorage.getItem(OWNER_KEY) || null;
    } catch (e) {
      return null;
    }
  }

  /* Sent to the API, not just this browser: a claim made in Chrome should
     hold in Firefox too, and should survive clearing site data. The local
     copy is only a mirror so the page can decide without a round trip. */
  async function claimSynced(name) {
    if (!name) return false;
    try { localStorage.setItem(OWNER_KEY, String(name)); } catch (e) { /* mirror only */ }
    try {
      const res = await fetch(API_BASE + '/api/synced/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ handle: String(name) })
      });
      return res.ok;
    } catch (e) {
      return false; // API down — the local mirror still works for this browser
    }
  }

  function unclaimSynced() {
    try {
      localStorage.removeItem(OWNER_KEY);
    } catch (e) { /* nothing to undo */ }
  }

  /** This browser's own synced pirate, or null. Used to tell a searched
   *  pirate apart from the one whose account is actually linked here.
   *
   *  Asks by name. It used to call /api/synced bare, from the days when the
   *  server would hand back "the most recent snapshot" — which could only
   *  ever be right on a machine with one account. That endpoint now requires
   *  a handle and answers 400 without one, so every call was failing and the
   *  link page told people they were not linked no matter how many times
   *  they synced. */
  async function syncedIdentity() {
    const owner = syncedOwner();
    if (!owner) return null;   // nothing claimed here: we cannot know who you are
    try {
      const snap = await call('/api/synced?handle=' + encodeURIComponent(owner));
      return {
        handle: (snap.identity && snap.identity.handle) || owner,
        snapshot: snap
      };
    } catch (e) {
      return null;
    }
  }

  /* ---------------- normalization ----------------
     Every source is folded into one shape, with null where a source
     simply cannot provide something. The profile page reads that shape
     and renders whatever is present — no per-source branching. */

  /* Rare's reputation payload is a flat map keyed by faction — GoldHoarders,
     OrderOfSouls, … — each with Rank/Level/Progress. The profile page reads
     { companies: [...] }, so a raw payload made it call .map on undefined
     and the whole render died halfway, taking the page down with it. */
  const RARE_FACTIONS = {
    GoldHoarders:     'goldHoarders',
    OrderOfSouls:     'orderOfSouls',
    MerchantAlliance: 'merchantAlliance',
    AthenasFortune:   'athenaFortune',
    ReapersBones:     'reapersBones',
    HuntersCall:      'huntersCall'
  };

  /* No hardcoded level caps. The old table claimed Athena's Fortune stopped
     at 30 while the account is at 38, and rendered Reaper's Bones as
     "242/75" — a number that reads as a bug. Rare already sends what is
     needed: Level, Progress toward the next level, and DistinctionLevel for
     the resets past the cap. Guessing the maximum was the mistake. */
  function faction(raw, key, name) {
    if (!raw || typeof raw !== 'object') return null;
    const level = raw.Level != null ? Number(raw.Level) : null;
    const emblems = {
      unlocked: Number(raw.EmblemsUnlocked || 0),
      total: Number(raw.EmblemsTotal || 0)
    };
    return {
      key,
      name,
      level,
      // 0–1 from Rare; percentage here, because that is what gets displayed.
      progress: Math.round(Number(raw.Progress || 0) * 1000) / 10,
      distinction: Number(raw.DistinctionLevel || 0),
      emblems,
      motto: raw.Motto || null,
      items: { unlocked: Number(raw.ItemsUnlocked || 0), total: Number(raw.ItemsTotal || 0) }
    };
  }

  function reputationOf(snap) {
    const rep = snap.reputation;
    if (!rep) return null;
    if (Array.isArray(rep.companies)) return rep; // already in tracker shape

    const companies = COMPANIES.map((c) => {
      const rareKey = Object.keys(RARE_FACTIONS).find((k) => RARE_FACTIONS[k] === c.key);
      // Localised name: a French player looks for "Fortune d'Athéna".
      const name = (global.I18N && I18N.t('company.' + c.key)) || c.name;
      return rareKey ? faction(rep[rareKey], c.key, name) : null;
    }).filter((f) => f && f.level != null);

    /* Tall Tales, Bilge Rats and the Creator Crew have no level — they are
       campaign trackers, and Rare sends emblem and campaign counts for them
       instead. Filtering them out for lacking a "Level" threw away 207 of
       762 unlocked emblems and 49 campaigns of real progress. */
    const CAMPAIGN_FACTIONS = {
      TallTales: 'Tall Tales',
      BilgeRats: 'Bilge Rats',
      CreatorCrew: 'Creator Crew'
    };
    const campaigns = Object.entries(CAMPAIGN_FACTIONS).map(([rareKey, label]) => {
      const raw = rep[rareKey];
      if (!raw || typeof raw !== 'object') return null;
      const f = faction(raw, rareKey, label);
      f.campaigns = Array.isArray(raw.Campaigns) ? raw.Campaigns.length
        : (raw.Campaigns ? Object.keys(raw.Campaigns).length : 0);
      return f;
    }).filter((f) => f && (f.emblems.total > 0 || f.campaigns > 0));

    if (!companies.length && !campaigns.length) return null;
    return { source: 'connected', companies, campaigns };
  }

  /** Total emblems across every faction — the one number that says how much
   *  of the game's collection has actually been finished. */
  function emblemTotals(snap) {
    const rep = snap.reputation;
    if (!rep) return null;
    let unlocked = 0;
    let total = 0;
    for (const f of Object.values(rep)) {
      if (!f || typeof f !== 'object') continue;
      unlocked += Number(f.EmblemsUnlocked || 0);
      total += Number(f.EmblemsTotal || 0);
    }
    return total ? { unlocked, total } : null;
  }

  /** Season progress, from the fields Rare actually sends. */
  function seasonsOf(snap) {
    const list = Array.isArray(snap.season) ? snap.season : (snap.season ? [snap.season] : []);
    if (!list.length) return null;

    return list.map((s) => {
      /* LevelProgress is the level reached, not a fraction: Season 20 reads
         50 with Levels.length 50, i.e. finished. Treating it as a 0–1
         fraction produced "5000%". */
      const level = Number(s.LevelProgress || 0);
      const levels = Array.isArray(s.Levels) ? s.Levels.length : null;
      return {
        id: s.Id || null,
        title: s.Title || null,
        copy: s.Copy || null,
        active: !!s.IsActive,
        tier: s.Tier != null ? Number(s.Tier) : null,
        tiers: Array.isArray(s.Tiers) ? s.Tiers.length : null,
        level,
        levels,
        progress: levels ? Math.min(100, Math.round((level / levels) * 1000) / 10) : 0,
        challenges: {
          done: Number(s.CompleteChallenges || 0),
          total: Number(s.TotalChallenges || 0)
        }
      };
    });
  }

  /* The two Hourglass sides, with everything Rare actually sends about
     them. Deliberately no win/loss counts: they are in none of the
     payloads, and a hardcoded 0 reads as "you have never won". */
  function hourglassOf(snap) {
    const rep = snap.reputation || {};
    const name = (key, fallback) =>
      (global.I18N && I18N.t('hourglass.' + key)) || fallback;

    const sides = [
      faction(rep.Flameheart, 'servants', name('servants', 'Servants of the Flame')),
      faction(rep.PirateLord, 'guardians', name('guardians', 'Guardians of Fortune'))
    ].filter(Boolean);

    if (!sides.length) return snap.hourglass || null;

    const top = sides.reduce((a, b) => ((b.level || 0) > (a.level || 0) ? b : a));
    return {
      source: 'connected',
      faction: top.key,
      factionName: top.name,
      level: top.level || 0,
      progress: top.progress,
      sides
    };
  }

  function normalize(snap, fallbackName) {
    const ach = snap.achievements || null;
    const linked = snap.source === 'rare';

    const platformLabel =
      snap.source === 'steam' ? 'Steam' :
      snap.source === 'xbox' ? 'Xbox' : 'Sea of Thieves';

    return {
      name: (snap.identity && snap.identity.handle) || fallbackName || 'Pirate',
      tag: null,
      region: null,
      platform: platformLabel,
      source: snap.source,
      foundOn: snap.foundOn || [snap.source],
      linked,
      live: true,
      avatar: (snap.identity && snap.identity.avatar) || null,
      gamerscore: snap.gamerscore || null,
      lastPlayed: snap.lastPlayed || null,

      playtime: snap.playtime ? Object.assign({ source: 'public' }, snap.playtime) : null,
      achievements: ach ? Object.assign({ source: 'public' }, ach) : null,

      pirateLegend: !!(ach && ach.items && ach.items.some(
        (a) => a.unlocked && /pirate legend/i.test(a.name)
      )),

      currencies: snap.currencies ? Object.assign({ source: 'connected' }, snap.currencies) : null,
      hourglass: hourglassOf(snap),
      reputation: reputationOf(snap),
      milestones: snap.milestones ? Object.assign({ source: 'connected' }, snap.milestones) : null,
      commendations: snap.commendations || null,
      season: seasonsOf(snap),
      emblems: emblemTotals(snap),
      session: null,
      probes: snap._probes || null
    };
  }

  /* ---------------- recently viewed ----------------
     A real, honest substitute for a global leaderboard: the players
     this browser has actually looked up. Grows as the site is used. */

  const RECENT_KEY = 'sot-recent';
  const RECENT_MAX = 50;

  function recentPlayers() {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function rememberPlayer(p) {
    if (!p || !p.name) return;
    try {
      const list = recentPlayers().filter(
        (x) => x.name.toLowerCase() !== p.name.toLowerCase()
      );
      list.unshift({
        name: p.name,
        platform: p.platform,
        source: p.source,
        avatar: p.avatar,
        gamerscore: p.gamerscore ? p.gamerscore.earned : null,
        gamerscoreTotal: p.gamerscore ? p.gamerscore.total : null,
        achUnlocked: p.achievements ? p.achievements.unlockedCount : null,
        achTotal: p.achievements ? p.achievements.totalCount : null,
        playtimeHours: p.playtime ? p.playtime.totalHours : null,
        pirateLegend: p.pirateLegend,
        seenAt: new Date().toISOString()
      });
      localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
    } catch (e) {
      /* storage full or disabled — not worth failing a page render over */
    }
  }

  function forgetPlayers() {
    try { localStorage.removeItem(RECENT_KEY); } catch (e) {}
  }

  /* ---------------- formatting ---------------- */

  function formatNumber(n) {
    return Number(n || 0).toLocaleString('en-US');
  }
  function formatGold(n) {
    return formatNumber(n) + 'g';
  }
  function formatCompact(n) {
    const v = Number(n || 0);
    if (v >= 1000000) return (v / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (v >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(v);
  }

  const AVATAR_PALETTE = [
    '#2f8f6e', '#34a894', '#8f6a24', '#c9954a',
    '#6a4b8f', '#3f6a8f', '#a4552f', '#4b7a3f'
  ];
  function avatarColor(seedStr) {
    let h = 2166136261;
    const s = String(seedStr || '').toLowerCase();
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return AVATAR_PALETTE[(h >>> 0) % AVATAR_PALETTE.length];
  }

  function initials(name) {
    return String(name || '?').slice(0, 2).toUpperCase();
  }

  /* Counted once per browser session per pirate. Without the guard a
     refresh, a back button or a language switch would each read as another
     visitor, and the number would measure reloads rather than interest. */
  const VIEWED_KEY = 'sot-viewed';

  async function countView(handle) {
    if (!handle) return null;
    const key = String(handle).toLowerCase();
    let seen = [];
    try { seen = JSON.parse(sessionStorage.getItem(VIEWED_KEY) || '[]'); } catch (e) { /* first view */ }

    const method = seen.includes(key) ? 'GET' : 'POST';
    if (method === 'POST') {
      seen.push(key);
      try { sessionStorage.setItem(VIEWED_KEY, JSON.stringify(seen)); } catch (e) { /* private mode */ }
    }

    try {
      const res = await fetch(
        API_BASE + '/api/views?handle=' + encodeURIComponent(handle),
        { method, cache: 'no-store' });
      if (!res.ok) return null;
      const body = await res.json();
      return typeof body.views === 'number' ? body.views : null;
    } catch (e) {
      return null;   // a missing counter must never cost the profile
    }
  }

  /** How many pirates have ever published. Null when the API cannot say. */
  async function projectStats() {
    try {
      const body = await call('/api/stats');
      return { pirates: Number(body.pirates) || 0 };
    } catch (e) {
      return null;
    }
  }

  global.SOT = {
    API_BASE,
    apiFetch,
    countView,
    projectStats,
    playerFromQuery,
    platformFromQuery,
    apiHealth,
    lookupPlayer,
    lookupLinked,
    syncedIdentity,
    syncedFor,
    syncedOwner,
    claimSynced,
    unclaimSynced,
    /* Folds a raw synced snapshot into the same shape as a lookup, so the
       profile page can merge it without knowing where it came from. */
    normalizeSynced: (snap) => normalize(snap, null),
    recentPlayers,
    rememberPlayer,
    forgetPlayers,
    formatNumber,
    formatGold,
    formatCompact,
    avatarColor,
    initials,
    COMPANIES,
    MILESTONE_KEYS
  };
})(window);
