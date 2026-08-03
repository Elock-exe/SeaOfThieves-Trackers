/* ============================================================
   Steam provider — public data, no signup required.

   Gives: total playtime, last-2-weeks playtime, achievements.
   Needs: STEAM_API_KEY + a public Steam profile.

   Steam has no CORS headers and the key must stay secret, which
   is why this runs server-side and never in the browser.
   ============================================================ */

const SOT_APPID = 1172620; // Sea of Thieves on Steam
const BASE = 'https://api.steampowered.com';

class ProviderError extends Error {
  constructor(code, message, httpStatus) {
    super(message);
    this.code = code;             // 'not_configured' | 'not_found' | 'private' | 'rate_limited' | 'upstream'
    this.httpStatus = httpStatus || null;
  }
}

function key() {
  const k = process.env.STEAM_API_KEY;
  if (!k) throw new ProviderError('not_configured', 'STEAM_API_KEY is not set');
  return k;
}

async function get(path, params) {
  const url = new URL(BASE + path);
  url.searchParams.set('key', key());
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url, { headers: { 'User-Agent': 'sot-tracker/0.1' } });

  if (res.status === 429) throw new ProviderError('rate_limited', 'Steam rate limit hit', 429);
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError('not_configured', 'Steam rejected the API key', res.status);
  }
  if (!res.ok) throw new ProviderError('upstream', `Steam returned ${res.status}`, res.status);

  return res.json();
}

/** A 17-digit string is already a SteamID64; anything else is a vanity name. */
async function resolveIdentity(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new ProviderError('not_found', 'No Steam identifier given');

  if (/^\d{17}$/.test(raw)) {
    return { externalId: raw, handle: null };
  }

  // accept a full profile URL too
  const vanity = raw.replace(/^https?:\/\/steamcommunity\.com\/id\//i, '').replace(/\/+$/, '');

  const data = await get('/ISteamUser/ResolveVanityURL/v1/', { vanityurl: vanity });
  if (!data.response || data.response.success !== 1) {
    throw new ProviderError('not_found', `No Steam user named "${vanity}"`);
  }
  return { externalId: data.response.steamid, handle: vanity };
}

async function fetchPersona(steamId) {
  try {
    const data = await get('/ISteamUser/GetPlayerSummaries/v2/', { steamids: steamId });
    const p = data.response && data.response.players && data.response.players[0];
    return p ? { handle: p.personaname, avatar: p.avatarfull, visibility: p.communityvisibilitystate } : null;
  } catch (e) {
    return null; // persona is a nicety, never fatal
  }
}

async function fetchPlaytime(steamId) {
  const data = await get('/IPlayerService/GetOwnedGames/v1/', {
    steamid: steamId,
    include_appinfo: 1,
    appids_filter: SOT_APPID
  });

  const games = (data.response && data.response.games) || [];
  const sot = games.find((g) => g.appid === SOT_APPID);

  // An empty response means either "doesn't own it" or "profile is private" —
  // Steam doesn't distinguish, so we report the ambiguity honestly upstream.
  if (!sot) return null;

  return {
    totalHours: Math.round((sot.playtime_forever || 0) / 60),
    recentHours: Math.round((sot.playtime_2weeks || 0) / 60)
  };
}

let schemaCache = null;
async function fetchSchema() {
  if (schemaCache) return schemaCache;
  try {
    const data = await get('/ISteamUserStats/GetSchemaForGame/v2/', { appid: SOT_APPID });
    const list = (((data.game || {}).availableGameStats || {}).achievements) || [];
    schemaCache = new Map(list.map((a) => [a.name, a.displayName]));
  } catch (e) {
    schemaCache = new Map();
  }
  return schemaCache;
}

async function fetchAchievements(steamId) {
  let data;
  try {
    data = await get('/ISteamUserStats/GetPlayerAchievements/v1/', {
      steamid: steamId,
      appid: SOT_APPID
    });
  } catch (e) {
    return null; // private profile or no stats
  }

  const list = (data.playerstats && data.playerstats.achievements) || [];
  if (!list.length) return null;

  const schema = await fetchSchema();

  const items = list.map((a) => ({
    id: a.apiname,
    name: schema.get(a.apiname) || a.apiname,
    unlocked: a.achieved === 1,
    unlockedAt: a.unlocktime ? new Date(a.unlocktime * 1000).toISOString().slice(0, 10) : null
  }));

  return {
    items,
    unlockedCount: items.filter((i) => i.unlocked).length,
    totalCount: items.length
  };
}

/** Returns the normalized snapshot shape shared by every provider. */
async function fetchSnapshot(account) {
  const steamId = account.externalId;
  const [persona, playtime, achievements] = await Promise.all([
    fetchPersona(steamId),
    fetchPlaytime(steamId).catch(() => null),
    fetchAchievements(steamId)
  ]);

  // visibility 3 = public; anything less means Steam is hiding the details
  const isPrivate = persona && persona.visibility !== undefined && persona.visibility < 3;
  if (isPrivate && !playtime && !achievements) {
    throw new ProviderError('private', 'This Steam profile is private');
  }

  return {
    source: 'steam',
    capturedAt: new Date().toISOString(),
    identity: {
      externalId: steamId,
      handle: (persona && persona.handle) || account.handle || null,
      avatar: (persona && persona.avatar) || null
    },
    // Steam can't provide any of these — the shape stays, the values are null
    currencies: null,
    hourglass: null,
    reputation: null,
    milestones: null,
    commendations: null,
    season: null,
    playtime,
    achievements
  };
}

module.exports = {
  name: 'steam',
  requiresCredential: false,
  isConfigured: () => Boolean(process.env.STEAM_API_KEY),
  resolveIdentity,
  fetchSnapshot,
  ProviderError,
  SOT_APPID
};
