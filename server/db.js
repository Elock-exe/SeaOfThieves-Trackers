/* ============================================================
   Storage driver.

   Two backends behind one interface:

     file      — data/*.jsonl on disk. The default, used for local
                 development. Zero setup.
     supabase  — a hosted Postgres, used when SUPABASE_URL and
                 SUPABASE_KEY are set.

   Why Supabase's REST API and not a Postgres driver: this project has no
   npm dependencies, and adding `pg` for two tables would mean a build
   step, a lockfile and a native-ish install on every host. PostgREST
   speaks plain HTTP, so `fetch` is enough.

   Why a hosted database at all: free hosting tiers have ephemeral disks.
   Render wipes the filesystem on every redeploy and after each idle
   sleep — which would delete every account and every snapshot, and force
   testers to start over. Persistence is the whole reason this file
   exists.
   ============================================================ */

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data');
const SNAPSHOTS = path.join(DIR, 'snapshots.jsonl');
const ACCOUNTS = path.join(DIR, 'accounts.json');
const VIEWS = path.join(DIR, 'views.json');
const PLAYERS = path.join(DIR, 'players.json');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const REMOTE = !!(SUPABASE_URL && SUPABASE_KEY);

/* ---------------- file driver ---------------- */

function ensureDir() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
}

const fileDriver = {
  name: 'file',

  async appendSnapshot(rec) {
    ensureDir();
    fs.appendFileSync(SNAPSHOTS, JSON.stringify(rec) + '\n', 'utf8');
    return (await this.snapshotsFor(rec.handle)).length;
  },

  async snapshotsFor(handle) {
    if (!fs.existsSync(SNAPSHOTS)) return [];
    const all = fs.readFileSync(SNAPSHOTS, 'utf8')
      .split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } })
      .filter(Boolean);
    if (!handle) return all;
    const want = String(handle).toLowerCase();
    return all.filter((r) => String(r.handle || '').toLowerCase() === want);
  },

  async getAccount(id) {
    try {
      return JSON.parse(fs.readFileSync(ACCOUNTS, 'utf8'))[id] || null;
    } catch (e) {
      return null;
    }
  },

  async findAccountByHandle(handle) {
    let map = {};
    try {
      map = JSON.parse(fs.readFileSync(ACCOUNTS, 'utf8'));
    } catch (e) {
      return null;
    }
    const want = String(handle).toLowerCase();
    const hit = Object.entries(map)
      .find(([, v]) => String(v.handle || '').toLowerCase() === want);
    return hit ? Object.assign({ id: hit[0] }, hit[1]) : null;
  },

  async putAccount(id, rec) {
    ensureDir();
    let map = {};
    try {
      map = JSON.parse(fs.readFileSync(ACCOUNTS, 'utf8'));
    } catch (e) { /* first account */ }
    map[id] = rec;
    fs.writeFileSync(ACCOUNTS, JSON.stringify(map, null, 2), 'utf8');
    return rec;
  },

  /* Views are keyed lower-case for the same reason snapshots are matched
     with ilike: Rare treats gamertags case-insensitively, and a counter
     that splits "Vyros" from "vyros" would quietly halve itself. */
  async bumpViews(handle) {
    ensureDir();
    let map = {};
    try {
      map = JSON.parse(fs.readFileSync(VIEWS, 'utf8'));
    } catch (e) { /* first view ever */ }
    const key = String(handle).toLowerCase();
    map[key] = (Number(map[key]) || 0) + 1;
    fs.writeFileSync(VIEWS, JSON.stringify(map, null, 2), 'utf8');
    return map[key];
  },

  async viewsFor(handle) {
    try {
      const map = JSON.parse(fs.readFileSync(VIEWS, 'utf8'));
      return Number(map[String(handle).toLowerCase()]) || 0;
    } catch (e) {
      return 0;
    }
  },

  /* Public Steam/Xbox stats, remembered from lookups.

     Why this exists: the leaderboards rank snapshots, and snapshots come
     from the extension — so every board was closed to anyone who cannot
     run it, which is every console player. Playtime and achievements are
     the only two numbers this project can read for anybody, and they were
     being fetched, displayed, and thrown away.

     Only what the platform already publishes is kept, and only for
     gamertags someone has actually looked up. */
  async putPublicPlayer(rec) {
    ensureDir();
    let map = {};
    try {
      map = JSON.parse(fs.readFileSync(PLAYERS, 'utf8'));
    } catch (e) { /* first lookup */ }
    map[String(rec.handle).toLowerCase()] = rec;
    fs.writeFileSync(PLAYERS, JSON.stringify(map, null, 2), 'utf8');
    return rec;
  },

  async allPublicPlayers() {
    try {
      return Object.values(JSON.parse(fs.readFileSync(PLAYERS, 'utf8')));
    } catch (e) {
      return [];
    }
  },

  /** Distinct pirates who have ever published — the "how far along is this"
   *  number, not a row count. */
  async countPirates() {
    const all = await this.snapshotsFor(null);
    return new Set(all.map((r) => String(r.handle || '').toLowerCase()).filter(Boolean)).size;
  },

  /** The newest snapshot for one pirate. */
  async latestFor(handle) {
    const all = await this.snapshotsFor(handle);
    return all.length ? all[all.length - 1] : null;
  },

  /** Just the numbers the history chart plots, oldest first. */
  async historyFor(handle, limit) {
    const all = await this.snapshotsFor(handle);
    const rows = limit ? all.slice(-limit) : all;
    return rows.map((r) => ({
      capturedAt: r.capturedAt,
      currencies: (r.snapshot && r.snapshot.currencies) || null,
      hourglass: (r.snapshot && r.snapshot.hourglass) || null
    }));
  },

  /** One row per pirate: their most recent snapshot. */
  async latestPerHandle() {
    const all = await this.snapshotsFor(null);
    const latest = new Map();
    for (const rec of all) {
      if (!rec || !rec.handle) continue;
      const key = String(rec.handle).toLowerCase();
      const prev = latest.get(key);
      if (!prev || String(rec.capturedAt || '') >= String(prev.capturedAt || '')) {
        latest.set(key, rec);
      }
    }
    return [...latest.values()];
  }
};

/* ---------------- supabase driver ---------------- */

async function rest(pathAndQuery, options) {
  const o = options || {};
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + pathAndQuery, {
    method: o.method || 'GET',
    headers: Object.assign({
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json'
    }, o.headers || {}),
    body: o.body ? JSON.stringify(o.body) : undefined
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`Supabase ${res.status}: ${detail.slice(0, 300)}`);
    err.code = 'store_unavailable';
    throw err;
  }
  /* An empty body is a normal answer here, not an edge case: writes are
     sent with Prefer: return=minimal, and PostgREST then replies 201 with
     nothing in it. Calling res.json() on that throws "Unexpected end of
     JSON input" — after the row has already been written, so the data
     lands and the caller still sees a failure.

     Read the body as text and only parse it when there is something to
     parse. This covers 200, 201 and 204 alike, instead of special-casing
     the one status a stand-in server happened to return during testing. */
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    const err = new Error('Supabase sent a non-JSON body: ' + text.slice(0, 200));
    err.code = 'store_unavailable';
    throw err;
  }
}

/* How many rows match, without fetching any of them.

   PostgREST answers `Content-Range: 0-0/42` when asked to count, so an
   empty page and a header replace the whole result set. This exists
   because counting used to mean downloading: appendSnapshot read every
   snapshot a pirate had ever made just to return their length. */
async function count(pathAndQuery) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + pathAndQuery, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY,
      Prefer: 'count=exact',
      Range: '0-0'
    }
  });
  if (!res.ok) {
    const err = new Error(`Supabase ${res.status} while counting`);
    err.code = 'store_unavailable';
    throw err;
  }
  const range = res.headers.get('content-range') || '';
  const total = Number(range.split('/')[1]);
  return Number.isFinite(total) ? total : 0;
}

const supabaseDriver = {
  name: 'supabase',

  async appendSnapshot(rec) {
    await rest('snapshots', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: {
        handle: rec.handle,
        captured_at: rec.capturedAt,
        snapshot: rec.snapshot
      }
    });
    /* A count, not a download. This line used to be
       `(await this.snapshotsFor(rec.handle)).length` — every snapshot that
       pirate had ever made, roughly a megabyte each, fetched and parsed so
       the reply could say "you now have 41". The most loyal user was the
       one whose syncs failed first, and eventually they timed out. */
    return count('snapshots?handle=ilike.' + encodeURIComponent(rec.handle) + '&select=handle');
  },

  async snapshotsFor(handle) {
    /* ilike, not eq: Rare treats gamertags case-insensitively, and so does
       the file driver. Two drivers that disagree on this would mean stats
       visible locally and missing in production. */
    const q = handle
      ? `snapshots?handle=ilike.${encodeURIComponent(handle)}&order=captured_at.asc`
      : 'snapshots?order=captured_at.asc';
    const rows = await rest(q);
    return (rows || []).map((r) => ({
      handle: r.handle,
      capturedAt: r.captured_at,
      snapshot: r.snapshot
    }));
  },

  async getAccount(id) {
    const rows = await rest(`accounts?id=eq.${encodeURIComponent(id)}&limit=1`);
    return (rows && rows[0]) || null;
  },

  async findAccountByHandle(handle) {
    const rows = await rest(`accounts?handle=ilike.${encodeURIComponent(handle)}&limit=1`);
    return (rows && rows[0]) || null;
  },

  async putAccount(id, rec) {
    await rest('accounts', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: Object.assign({ id }, rec)
    });
    return rec;
  },

  /* Read then upsert, because PostgREST cannot express "count = count + 1"
     without a stored procedure, and this project keeps its schema to plain
     tables. Two views landing in the same instant can therefore cost one
     of them — an acceptable trade for a view counter, and not one for
     anything that must balance.

     A missing `views` table is treated as "no views yet" rather than an
     error: the rest of the profile is worth more than the counter, and a
     deployment that has not run the migration should degrade, not break. */
  async bumpViews(handle) {
    const key = String(handle).toLowerCase();
    try {
      const rows = await rest(`views?handle=eq.${encodeURIComponent(key)}&limit=1`);
      const next = (Number(rows && rows[0] && rows[0].count) || 0) + 1;
      await rest('views', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: { handle: key, count: next }
      });
      return next;
    } catch (e) {
      return null;
    }
  },

  async viewsFor(handle) {
    try {
      const rows = await rest(
        `views?handle=eq.${encodeURIComponent(String(handle).toLowerCase())}&limit=1`);
      return Number(rows && rows[0] && rows[0].count) || 0;
    } catch (e) {
      // null, not 0: a table we cannot read is not a pirate nobody opened.
      return null;
    }
  },

  /* Same "missing table is not an error" rule as views: a deployment that
     has not run the migration loses the playtime board, not the site. */
  async putPublicPlayer(rec) {
    try {
      await rest('players', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: {
          handle: String(rec.handle).toLowerCase(),
          display_handle: rec.handle,
          playtime_hours: rec.playtimeHours,
          avatar: rec.avatar,
          source: rec.source,
          seen_at: rec.seenAt
        }
      });
      return rec;
    } catch (e) {
      return null;
    }
  },

  async allPublicPlayers() {
    try {
      const rows = await rest('players?select=display_handle,playtime_hours,avatar,source,seen_at');
      return (rows || []).map((r) => ({
        handle: r.display_handle,
        playtimeHours: r.playtime_hours,
        avatar: r.avatar,
        source: r.source,
        seenAt: r.seen_at
      }));
    } catch (e) {
      return [];
    }
  },

  async countPirates() {
    // Only the handle column travels: the snapshots themselves are large.
    const rows = await rest('snapshots?select=handle');
    return new Set((rows || [])
      .map((r) => String(r.handle || '').toLowerCase())
      .filter(Boolean)).size;
  },

  /* The newest snapshot for one pirate, fetched as one row.

     store.latest() used to pull a pirate's entire history and keep the last
     element. At roughly a megabyte a snapshot and one sync an hour, the most
     active account was also the slowest to open — and eventually the one
     that timed out. Ordering in the database and taking a single row costs
     the same whether a pirate synced twice or ten thousand times. */
  async latestFor(handle) {
    const rows = await rest('snapshots?handle=ilike.' + encodeURIComponent(handle) +
      '&order=captured_at.desc&limit=1');
    const r = rows && rows[0];
    return r ? { handle: r.handle, capturedAt: r.captured_at, snapshot: r.snapshot } : null;
  },

  /* The history chart plots three numbers — gold, doubloons, Hourglass
     level — and this used to fetch up to a hundred whole snapshots to find
     them. At a megabyte each that is a hundred megabytes crossing the
     Atlantic to draw a line.

     PostgREST can reach inside the JSON, so only those keys travel. The
     rows come back newest first, because that is what a limit should keep,
     and are reversed here for a chart that reads left to right. */
  async historyFor(handle, limit) {
    const rows = await rest('snapshots?handle=ilike.' + encodeURIComponent(handle) +
      '&select=captured_at,snapshot->currencies,snapshot->hourglass' +
      '&order=captured_at.desc&limit=' + Math.max(1, Math.min(Number(limit) || 100, 500)));
    return (rows || [])
      .map((r) => ({
        capturedAt: r.captured_at,
        currencies: r.currencies || null,
        hourglass: r.hourglass || null
      }))
      .reverse();
  },

  /* One row per pirate, their newest.

     The leaderboards used to read every snapshot ever written and pick the
     latest per handle in memory. Each row is around a megabyte — the
     reputation payload alone is a thousand kilobytes — and a sync adds one
     per pirate per hour, so the query grew by megabytes a day until Postgres
     started cancelling it: 57014, statement timeout. Every board 500'd, and
     the database reported itself unhealthy under the load.

     Now the size of the answer follows the number of pirates, not the length
     of their history. The handle list is fetched first because that column
     alone is tiny, then one bounded query each — N small reads instead of one
     unbounded one. */
  async latestPerHandle() {
    const index = await rest('snapshots?select=handle');
    const handles = [...new Set((index || [])
      .map((r) => String(r.handle || '').trim())
      .filter(Boolean)
      .map((h) => h.toLowerCase()))];

    const rows = await Promise.all(handles.map(async (h) => {
      try {
        const hit = await rest('snapshots?handle=ilike.' + encodeURIComponent(h) +
          '&order=captured_at.desc&limit=1');
        const r = hit && hit[0];
        return r ? { handle: r.handle, capturedAt: r.captured_at, snapshot: r.snapshot } : null;
      } catch (e) {
        return null;   // one unreadable pirate must not empty the board
      }
    }));

    return rows.filter(Boolean);
  }
};

const driver = REMOTE ? supabaseDriver : fileDriver;

function describe() {
  return REMOTE
    ? `supabase (${SUPABASE_URL.replace(/^https?:\/\//, '')})`
    : 'local files in data/  — NOT persistent on free hosting';
}

module.exports = Object.assign({}, driver, { describe, REMOTE });
