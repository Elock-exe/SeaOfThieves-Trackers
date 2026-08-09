/* ============================================================
   Local API for the SoT Tracker.

   Zero npm dependencies — Node 20.6+ only (native fetch, --env-file).
   Run it with:   npm start        (see package.json)

   Routes
     GET /api/health
     GET /api/player?id=<name>[&platform=steam|xbox]   public lookup, any player
     GET /api/me                                       the linked account (Rare)
     GET /api/me/diagnose                              which Rare endpoints answer

   Keys and the session cookie stay in this process. They are never sent
   to the browser and never appear in a response or a log line.
   ============================================================ */

const http = require('http');
const steam = require('./providers/steam');
const xbox = require('./providers/xbox');
const rare = require('./providers/rare');
const store = require('./store');
const accounts = require('./accounts');
const leaderboard = require('./leaderboard');

/* Only the public sources are searchable by name — Rare's API can never
   return anyone but the authenticated account, so it stays out of this map. */
const PROVIDERS = { steam, xbox };
const PORT = Number(process.env.PORT || 8787);

/* The front-end runs on a different port in development, and the
   browser extension posts from its own origin, so both need an
   explicit allowance. Local pages and extension origins only. */
/* Local development plus the browser extension. In production the
   deployed site's origin has to be added too — it arrives as SITE_ORIGIN,
   comma-separated, because hardcoding a domain here would mean editing
   source to deploy. */
const EXTRA_ORIGINS = String(process.env.SITE_ORIGIN || '')
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const ALLOWED_ORIGIN = /^(http:\/\/(localhost|127\.0\.0\.1)(:\d+)?|moz-extension:\/\/.+|chrome-extension:\/\/.+)$/;

function originAllowed(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGIN.test(origin)) return true;
  return EXTRA_ORIGINS.includes(origin.replace(/\/+$/, ''));
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (originAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Account-Key');

  /* Private Network Access: Chrome treats an extension reaching localhost as
     a public origin touching a private address, and blocks it unless the
     preflight is answered with this. Only ever sent to origins that already
     passed the check above, so it widens nothing. */
  if (req.headers['access-control-request-private-network'] === 'true' &&
      res.hasHeader('Access-Control-Allow-Origin')) {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
}

function readJSON(req, limitBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let over = false;
    req.on('data', (c) => {
      if (over) return;
      size += c.length;
      if (size > limitBytes) {
        over = true;
        /* Drain, don't destroy. Killing the socket here means the client
           never receives the 413 — it sees the connection vanish and reports
           a bare network failure, which is indistinguishable from the server
           being down. Draining lets the response through. */
        req.resume();
        reject(Object.assign(
          new Error(`Payload too large (over ${Math.round(limitBytes / 1024)} KB)`),
          { code: 'too_large' }
        ));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(Object.assign(new Error('Body was not valid JSON'), { code: 'bad_body' }));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    'Cache-Control': 'no-store'
  });
  res.end(json);
}

/* Map a provider error onto an HTTP status the front can branch on. */
const STATUS_BY_CODE = {
  not_configured: 503,
  not_found: 404,
  private: 403,
  rate_limited: 429,
  upstream: 502
};

function fail(res, err) {
  const code = err && err.code ? err.code : 'upstream';
  const status = STATUS_BY_CODE[code] || 500;
  // log the shape, never the key or the raw upstream payload
  console.error(`[api] ${code} (${status}) — ${err && err.message}`);
  send(res, status, { error: { code, message: err && err.message } });
}

async function lookupOne(provider, id) {
  const identity = await provider.resolveIdentity(id);
  return provider.fetchSnapshot(identity);
}

/** How useful a snapshot is, for picking a winner when both platforms answer. */
function richness(snap) {
  let n = 0;
  if (snap.achievements && snap.achievements.totalCount) n += 2;
  if (snap.playtime && snap.playtime.totalHours) n += 2;
  if (snap.gamerscore) n += 1;
  return n;
}

/* "Found but hidden" is more actionable than "no such name", so it wins
   when the two providers disagree about why they failed. */
const ERROR_RANK = { private: 3, rate_limited: 2, upstream: 1, not_found: 0, not_configured: 0 };

function bestError(errors) {
  return errors.slice().sort(
    (a, b) => (ERROR_RANK[b.code] || 0) - (ERROR_RANK[a.code] || 0)
  )[0];
}

async function handlePlayer(req, res, url) {
  const requested = String(url.searchParams.get('platform') || 'auto').toLowerCase();
  const id = url.searchParams.get('id');

  if (!id) {
    return send(res, 400, { error: { code: 'missing_id', message: 'id is required' } });
  }
  if (requested !== 'auto' && !PROVIDERS[requested]) {
    return send(res, 400, {
      error: { code: 'bad_platform', message: 'platform must be "steam", "xbox" or "auto"' }
    });
  }

  const names = requested === 'auto' ? Object.keys(PROVIDERS) : [requested];
  const usable = names.filter((n) => PROVIDERS[n].isConfigured());

  if (!usable.length) {
    return send(res, 503, {
      error: {
        code: 'not_configured',
        message: 'No provider key is set — add one to .env and restart the API'
      }
    });
  }

  const started = Date.now();
  const settled = await Promise.allSettled(
    usable.map((n) => lookupOne(PROVIDERS[n], id))
  );

  const hits = [];
  const errors = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') hits.push(r.value);
    else errors.push(r.reason && r.reason.code ? r.reason : { code: 'upstream', message: String(r.reason) });
  });

  if (!hits.length) {
    console.log(`[api] ${id} — no match on ${usable.join('/')} (${Date.now() - started}ms)`);
    return fail(res, bestError(errors));
  }

  hits.sort((a, b) => richness(b) - richness(a));
  const winner = hits[0];
  winner.foundOn = hits.map((h) => h.source);

  console.log(`[api] ${id} → ${winner.source} (${Date.now() - started}ms)`);
  return send(res, 200, winner);
}

const server = http.createServer(async (req, res) => {
  cors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/health') {
    return send(res, 200, {
      ok: true,
      providers: {
        steam: steam.isConfigured(),
        xbox: xbox.isConfigured()
      },
      linked: rare.isConfigured(),
      /* Whether stats survive a restart. A deployed instance answering
         false is storing to a disk the host wipes, and every account
         will be gone by tomorrow — worth being able to check without
         shell access to the logs.

         A boolean, not the backend's address: which database is in use
         is nobody else's business. */
      persistent: require('./db').REMOTE
    });
  }

  if (url.pathname === '/api/player') {
    return handlePlayer(req, res, url);
  }

  /* The linked account. Returns only the signed-in pirate — by design,
     Rare's API cannot serve anyone else. */
  if (url.pathname === '/api/me') {
    if (!rare.isConfigured()) {
      return send(res, 503, {
        error: {
          code: 'not_linked',
          message: 'No Sea of Thieves account linked — add SOT_RAT_COOKIE to .env and restart'
        }
      });
    }
    const t0 = Date.now();
    try {
      const snap = await rare.fetchSnapshot();
      console.log(`[api] /me ok — ${Date.now() - t0}ms`);
      return send(res, 200, snap);
    } catch (err) {
      return fail(res, err);
    }
  }

  /* The browser extension posts here.
     It sends STATS ONLY — the player's session cookie stays in their
     browser and is never transmitted, so nothing sensitive is stored. */
  if (url.pathname === '/api/sync' && req.method === 'POST') {
    let bundle;
    try {
      /* 512 KB was too tight: Rare's reputation payload alone can exceed it,
         so a real profile was rejected while every hand-made test passed. */
      bundle = await readJSON(req, 8 * 1024 * 1024);
    } catch (err) {
      return send(res, err.code === 'too_large' ? 413 : 400, {
        error: { code: err.code || 'bad_body', message: err.message }
      });
    }

    if (!bundle || !bundle.payloads || typeof bundle.payloads !== 'object') {
      return send(res, 400, {
        error: { code: 'bad_body', message: 'Expected { payloads, probes }' }
      });
    }

    /* Refuse anything that looks like a credential — the extension has no
       reason to send one, so its presence means something is wrong. */
    const asText = JSON.stringify(bundle);
    if (/"(rat|cookie|authorization|token|password)"\s*:/i.test(asText)) {
      console.warn('[api] /sync rejected — payload contained a credential-like field');
      return send(res, 400, {
        error: {
          code: 'credential_in_payload',
          message: 'Payload contained a credential field. Stats only, please.'
        }
      });
    }

    /* Field NAMES only, never values. normalizePayloads guesses at Rare's
       shape from a list of candidate keys, and when every guess misses there
       is no way to tell what the payload actually looked like — the raw
       bodies are deliberately not stored. Logging the key names makes the
       shape fixable without keeping anyone's stats around. */
    for (const [group, payload] of Object.entries(bundle.payloads)) {
      if (payload && typeof payload === 'object') {
        const keys = Object.keys(payload).slice(0, 25);
        console.log(`[api] /sync shape — ${group}: ${keys.join(', ') || '(no keys)'}`);

        // One level deeper: the top-level names alone did not say where the
        // gamertag or the Hourglass rank live.
        for (const k of keys.slice(0, 8)) {
          const v = payload[k];
          if (v && typeof v === 'object' && !Array.isArray(v)) {
            console.log(`[api]   ${group}.${k}: ${Object.keys(v).slice(0, 15).join(', ')}`);
          } else if (Array.isArray(v) && v.length && typeof v[0] === 'object') {
            console.log(`[api]   ${group}.${k}[0]: ${Object.keys(v[0]).slice(0, 15).join(', ')}`);
          }
        }
      }
    }

    try {
      const snapshot = rare.normalizePayloads(bundle.payloads, bundle.probes);

      /* The pirate these stats belong to: whatever the extension read off
         the page, or what its owner typed. Without it there is nothing to
         file the snapshot under, and every account would land in the same
         bucket — which is exactly how a single-user prototype leaks into
         a multi-user service. */
      const handle = snapshot.identity.handle || bundle.handle || null;

      // Header first; the body copy is the fallback when a preflight is
      // blocked and the custom header never arrives.
      const key = req.headers['x-account-key'] || bundle.accountKey;
      const auth = await accounts.authorize(key, handle);
      if (!auth.ok) {
        console.warn(`[api] /sync refused — ${auth.code} (${handle || 'no handle'})`);
        return send(res, auth.code === 'handle_taken' ? 409 : 401, {
          error: { code: auth.code, message: auth.message }
        });
      }

      snapshot.identity.handle = handle;
      const count = await store.append({
        handle,
        capturedAt: bundle.collectedAt || snapshot.capturedAt,
        snapshot
      });

      console.log(`[api] /sync ok — ${handle} (${count} snapshots${auth.first ? ', new account' : ''})`);
      return send(res, 200, { ok: true, handle, snapshots: count, probes: bundle.probes });
    } catch (err) {
      return fail(res, err);
    }
  }

  /* What the presenting key owns. Used by the extension popup to show
     which pirate it publishes as. Reveals nothing about other accounts. */
  if (url.pathname === '/api/account') {
    const me = await accounts.describe(req.headers['x-account-key']);
    if (!me) {
      return send(res, 404, {
        error: { code: 'no_account', message: 'This key has never published stats' }
      });
    }
    return send(res, 200, me);
  }

  /* Published stats for one pirate. Public to read — that is what a
     tracker is — but always scoped to a named handle.

     It used to fall back to "the most recent snapshot on the server" when
     no handle was given. On one machine that was convenient; with more
     than one account it means the first visitor sees whoever synced last.
     The handle is now required. */
  /* Rankings across every published pirate. Public, like the profiles
     they are built from. */
  /* How far along the project is, in one number. Cheap enough to answer
     on every homepage load, and the only figure a visitor can use to judge
     whether the leaderboards are worth reading yet. */
  if (url.pathname === '/api/stats') {
    try {
      return send(res, 200, { pirates: await require('./db').countPirates() });
    } catch (err) {
      return fail(res, err);
    }
  }

  /* A view is a POST because it changes something. GET would let a link
     preview, a prefetch or a crawler inflate the count without a human
     ever seeing the page. */
  if (url.pathname === '/api/views') {
    const handle = url.searchParams.get('handle');
    if (!handle) {
      return send(res, 400, {
        error: { code: 'handle_required', message: 'Name the pirate: /api/views?handle=YourPirate' }
      });
    }
    try {
      const db = require('./db');
      const views = req.method === 'POST'
        ? await db.bumpViews(handle)
        : await db.viewsFor(handle);
      return send(res, 200, { handle, views: views == null ? 0 : views });
    } catch (err) {
      return fail(res, err);
    }
  }

  if (url.pathname === '/api/leaderboard/metrics') {
    return send(res, 200, { metrics: leaderboard.metrics() });
  }

  if (url.pathname === '/api/leaderboard') {
    const metric = url.searchParams.get('metric') || 'gold';
    const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200);
    try {
      return send(res, 200, await leaderboard.rank(metric, limit));
    } catch (err) {
      if (err.code === 'bad_metric') {
        return send(res, 400, {
          error: {
            code: 'bad_metric',
            message: err.message,
            available: leaderboard.metrics().map((m) => m.key)
          }
        });
      }
      return fail(res, err);
    }
  }

  if (url.pathname === '/api/synced') {
    const handle = url.searchParams.get('handle');
    if (!handle) {
      return send(res, 400, {
        error: {
          code: 'handle_required',
          message: 'Name the pirate: /api/synced?handle=YourPirate'
        }
      });
    }

    const rec = await store.latest(handle);
    if (!rec) {
      return send(res, 404, {
        error: { code: 'no_sync', message: `No published stats for "${handle}" yet` }
      });
    }
    return send(res, 200, rec.snapshot);
  }

  if (url.pathname === '/api/synced/history') {
    const handle = url.searchParams.get('handle');
    const limit = Number(url.searchParams.get('limit') || 100);
    return send(res, 200, {
      handle: handle || null,
      points: (await store.history(handle, limit)).map((r) => ({
        at: r.capturedAt,
        gold: r.snapshot.currencies ? r.snapshot.currencies.gold : null,
        doubloons: r.snapshot.currencies ? r.snapshot.currencies.doubloons : null,
        hourglassLevel: r.snapshot.hourglass ? r.snapshot.hourglass.level : null
      }))
    });
  }

  /* Rare moves these undocumented endpoints occasionally; this says which
     ones still answer, so a blank profile can be diagnosed instead of guessed at. */
  if (url.pathname === '/api/me/diagnose') {
    if (!rare.isConfigured()) {
      return send(res, 503, { error: { code: 'not_linked', message: 'No account linked' } });
    }
    try {
      return send(res, 200, await rare.diagnose());
    } catch (err) {
      return fail(res, err);
    }
  }

  send(res, 404, { error: { code: 'not_found', message: 'Unknown route' } });
});

server.listen(PORT, () => {
  const cfg = [
    `steam ${steam.isConfigured() ? 'ok' : 'MISSING KEY'}`,
    `xbox ${xbox.isConfigured() ? 'ok' : 'MISSING KEY'}`,
    `linked account ${rare.isConfigured() ? 'ok' : 'none'}`
  ].join(' · ');
  console.log(`\n  SoT Tracker API  →  http://localhost:${PORT}`);
  console.log(`  providers: ${cfg}`);
  console.log(`  storage:   ${store.describe()}`);

  /* Saying this out loud at boot is the point: on a free host the disk is
     wiped on every restart, and the first anyone would learn of it is a
     tester reporting that their account vanished. */
  if (!require('./db').REMOTE && process.env.SITE_ORIGIN) {
    console.warn('  WARNING: deployed without SUPABASE_URL/SUPABASE_KEY —');
    console.warn('           accounts and stats will be lost on every restart.');
  }
  console.log('');
});
