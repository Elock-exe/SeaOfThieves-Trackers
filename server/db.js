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
    return (await this.snapshotsFor(rec.handle)).length;
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
  }
};

const driver = REMOTE ? supabaseDriver : fileDriver;

function describe() {
  return REMOTE
    ? `supabase (${SUPABASE_URL.replace(/^https?:\/\//, '')})`
    : 'local files in data/  — NOT persistent on free hosting';
}

module.exports = Object.assign({}, driver, { describe, REMOTE });
