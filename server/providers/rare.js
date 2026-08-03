/* ============================================================
   Rare provider — the linked Sea of Thieves account.

   This is the only source for gold, Hourglass rank, reputation,
   commendations and career milestones. Rare's internal API serves
   ONLY the authenticated account, so there is no way to look up
   someone else — this always returns *your* pirate.

   Auth is the `rat` session cookie from seaofthieves.com. It lives
   in .env on this machine and is never sent to the browser.

   NOTE: this API is undocumented and unofficial. Endpoints can move
   or disappear without warning, which is why every field is probed
   independently and a failure degrades to null instead of throwing.
   ============================================================ */

const BASE = 'https://www.seaofthieves.com';

class ProviderError extends Error {
  constructor(code, message, httpStatus) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus || null;
  }
}

function token() {
  const t = process.env.SOT_RAT_COOKIE;
  if (!t) throw new ProviderError('not_configured', 'SOT_RAT_COOKIE is not set');
  return t.trim();
}

async function get(path) {
  const res = await fetch(BASE + path, {
    headers: {
      'Cookie': 'rat=' + token(),
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-GB,en;q=0.9',
      'Referer': BASE + '/profile',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
    },
    redirect: 'manual'
  });

  // An expired cookie bounces to the login page instead of 401-ing.
  if (res.status >= 300 && res.status < 400) {
    throw new ProviderError('auth_expired', 'Session cookie expired — sign in again and copy a fresh one', res.status);
  }
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError('auth_expired', 'Sea of Thieves rejected the session cookie', res.status);
  }
  if (res.status === 429) throw new ProviderError('rate_limited', 'Rate limited by seaofthieves.com', 429);
  if (res.status === 404) throw new ProviderError('not_found', `Endpoint ${path} no longer exists`, 404);
  if (!res.ok) throw new ProviderError('upstream', `seaofthieves.com returned ${res.status}`, res.status);

  const text = await res.text();

  // Getting HTML back means we were served the login page, not the API.
  if (/^\s*</.test(text)) {
    throw new ProviderError('auth_expired', 'Got the login page instead of data — the cookie is not valid', res.status);
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    throw new ProviderError('upstream', 'Response was not JSON', res.status);
  }
}

/** Probe an endpoint without letting one dead path kill the whole profile. */
async function tryGet(path) {
  try {
    return { ok: true, path, data: await get(path) };
  } catch (e) {
    return { ok: false, path, code: e.code, message: e.message };
  }
}

/* Candidate paths, most-likely first. Rare has moved these before, so
   each group is probed until one answers. */
const ENDPOINTS = {
  overview:   ['/api/profilev2/overview', '/api/profilev2/summary'],
  reputation: ['/api/profilev2/reputation', '/api/profilev2/reputation-v2'],
  season:     ['/api/profilev2/season-progress', '/api/profilev2/seasons'],
  hourglass:  ['/api/profilev2/allegiance', '/api/profilev2/hourglass'],
  ledger:     ['/api/profilev2/ledger', '/api/profilev2/balance']
};

async function firstThatWorks(paths) {
  const failures = [];
  for (const p of paths) {
    const r = await tryGet(p);
    if (r.ok) return r;
    // an auth failure is fatal for every endpoint, no point continuing
    if (r.code === 'auth_expired') throw new ProviderError(r.code, r.message);
    failures.push(r);
  }
  return { ok: false, failures };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* Rare sends progress as a 0–1 fraction (0.5338 for 53%), but the tracker
   displays percentages. Values above 1 are already percentages, so leave
   them alone rather than multiplying twice if the shape ever changes. */
function asPercent(v) {
  if (v == null) return 0;
  return v <= 1 ? Math.round(v * 1000) / 10 : v;
}

/** Pull a value from whichever of several shapes the payload happens to use. */
function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) {
    const parts = k.split('.');
    let cur = obj;
    let ok = true;
    for (const part of parts) {
      if (cur && typeof cur === 'object' && part in cur) cur = cur[part];
      else { ok = false; break; }
    }
    if (ok && cur != null && typeof cur !== 'object') return cur;
  }
  return null;
}

/**
 * Turn raw Rare payloads into the tracker's shared snapshot shape.
 *
 * Kept separate from fetching so the browser extension can post raw
 * payloads and get the same normalisation — meaning a shape change at
 * Rare is fixed here, on the server, with no extension update and no
 * store review.
 */
/* No payload carries the gamertag, so the extension reads it off the page.
   The document title is the fallback: Rare renders it as "<name> - Sea of
   Thieves" or the reverse, so strip the site name and keep what remains. */
function handleFromPage(payloads) {
  const page = (payloads && payloads.page) || null;
  if (!page) return null;

  if (page.name && !/sea of thieves/i.test(page.name)) return page.name;

  const title = String(page.title || '');
  const stripped = title
    .replace(/\s*[-|–]\s*Sea of Thieves\s*$/i, '')
    .replace(/^\s*Sea of Thieves\s*[-|–]\s*/i, '')
    .trim();

  if (!stripped || /^sea of thieves$/i.test(stripped)) return null;
  return stripped.length <= 40 ? stripped : null;
}

function normalizePayloads(payloads, probes) {
  const ov = (payloads && payloads.overview) || {};
  const h = (payloads && payloads.hourglass) || null;

  /* Currencies live in the ledger (/profilev2/balance), not the overview:
     { title, ancientCoins, doubloons, doubloonsLimit, gold, image }. Reading
     them from the overview is why gold came back as 0 on a real account.
     The overview stays as a fallback in case the shape moves again. */
  const led = (payloads && payloads.ledger) || {};

  const gold = num(pick(led, ['gold', 'coins'])) ??
    num(pick(ov, ['gold', 'coins', 'balance.gold', 'stats.gold']));
  const doubloons = num(pick(led, ['doubloons'])) ??
    num(pick(ov, ['doubloons', 'balance.doubloons', 'stats.doubloons']));
  const ancientCoins = num(pick(led, ['ancientCoins', 'ancient_coins'])) ??
    num(pick(ov, ['ancientCoins', 'ancient_coins', 'balance.ancientCoins']));

  const currencies = (gold != null || doubloons != null || ancientCoins != null)
    ? { gold: gold || 0, doubloons: doubloons || 0, ancientCoins: ancientCoins || 0 }
    : null;

  /* Hourglass allegiance is not a separate endpoint — it never was. The two
     sides ride along in the reputation payload as ordinary factions:
     Flameheart (Servants of the Flame) and PirateLord (Guardians of
     Fortune). Sixteen probes for a URL that does not exist; the data was in
     hand the whole time. */
  const rep = (payloads && payloads.reputation) || {};
  const SIDES = [
    { key: 'Flameheart', faction: 'servants', name: 'Servants of the Flame' },
    { key: 'PirateLord', faction: 'guardians', name: 'Guardians of Fortune' }
  ];

  let hg = null;
  const sides = SIDES
    .map((s) => ({ ...s, raw: rep[s.key] }))
    .filter((s) => s.raw && typeof s.raw === 'object')
    .map((s) => ({ ...s, level: num(pick(s.raw, ['Level', 'level', 'Rank', 'rank'])) || 0 }));

  if (sides.length) {
    // Show the side actually being played: the further-progressed one.
    const top = sides.reduce((a, b) => (b.level > a.level ? b : a));
    hg = {
      faction: top.faction,
      factionName: top.name,
      level: top.level,
      // Rare reports this as a 0–1 fraction; the tracker shows percentages.
      progress: asPercent(num(pick(top.raw, ['Progress', 'progress', 'percent']))),
      wins: num(pick(top.raw, ['Wins', 'wins', 'victories'])) || 0,
      sides: sides.map((s) => ({ faction: s.faction, name: s.name, level: s.level }))
    };
  } else if (h) {
    // Fallback: a real hourglass payload, should one ever turn up.
    const faction = pick(h, ['faction', 'allegiance', 'name']);
    const level = num(pick(h, ['level', 'rank', 'allegianceLevel']));
    if (faction || level != null) {
      hg = {
        faction: /servant|flame/i.test(String(faction)) ? 'servants' : 'guardians',
        factionName: String(faction || 'Hourglass Allegiance'),
        level: level || 0,
        progress: num(pick(h, ['progress', 'percent'])) || 0,
        wins: num(pick(h, ['wins', 'victories'])) || 0
      };
    }
  }

  return {
    source: 'rare',
    capturedAt: new Date().toISOString(),
    identity: {
      externalId: String(pick(ov, ['id', 'accountId', 'userId']) || 'me'),
      handle: pick(ov, ['name', 'gamertag', 'displayName']) || handleFromPage(payloads),
      // The ledger's "image" is the pirate portrait the profile page shows.
      avatar: pick(ov, ['avatar', 'image', 'portrait']) || pick(led, ['image']) || null
    },
    currencies,
    hourglass: hg,
    reputation: (payloads && payloads.reputation) || null,
    /* The overview already carries "seasons" — the separate season endpoint
       we kept probing (and 404ing on) never needed to exist. */
    season: (payloads && payloads.season) || ov.seasons || null,
    milestones: null,
    commendations: null,
    playtime: null,
    achievements: null,
    _probes: probes || null
  };
}

async function fetchSnapshot() {
  token(); // fail fast if unconfigured

  const [overview, reputation, season, hourglass] = await Promise.all([
    firstThatWorks(ENDPOINTS.overview),
    firstThatWorks(ENDPOINTS.reputation),
    firstThatWorks(ENDPOINTS.season),
    firstThatWorks(ENDPOINTS.hourglass)
  ]);

  if (!overview.ok) {
    const detail = (overview.failures || []).map((f) => `${f.path}: ${f.code}`).join(', ');
    throw new ProviderError('upstream',
      `Rare's profile endpoint did not answer (${detail}). The internal API may have moved.`);
  }

  return normalizePayloads(
    {
      overview: overview.data,
      reputation: reputation.ok ? reputation.data : null,
      season: season.ok ? season.data : null,
      hourglass: hourglass.ok ? hourglass.data : null
    },
    /* Which probes answered — makes a shifted endpoint obvious instead of
       silently blanking the profile. */
    {
      overview: overview.ok ? overview.path : 'failed',
      reputation: reputation.ok ? reputation.path : 'failed',
      season: season.ok ? season.path : 'failed',
      hourglass: hourglass.ok ? hourglass.path : 'failed'
    }
  );
}

/** Raw probe results, for diagnosing a moved endpoint. */
async function diagnose() {
  const out = {};
  for (const [name, paths] of Object.entries(ENDPOINTS)) {
    out[name] = [];
    for (const p of paths) {
      const r = await tryGet(p);
      out[name].push(r.ok
        ? { path: p, ok: true, keys: Object.keys(r.data || {}).slice(0, 25) }
        : { path: p, ok: false, code: r.code, message: r.message });
    }
  }
  return out;
}

module.exports = {
  name: 'rare',
  requiresCredential: true,
  isConfigured: () => Boolean(process.env.SOT_RAT_COOKIE),
  resolveIdentity: async () => ({ externalId: 'me', handle: null }),
  fetchSnapshot,
  normalizePayloads,
  diagnose,
  ProviderError
};
