/* SotTracker — sottracker.fr
   Creator: Vyros__
   https://github.com/Elock-exe/SeaOfThieves-Trackers */
/* ============================================================
   Xbox Live provider (via OpenXBL) — public data, no signup.

   Gives: gamerscore + achievements for Sea of Thieves, and the
   lifetime playtime Xbox keeps as the MinutesPlayed user stat.
   Needs: OPENXBL_API_KEY + the player's privacy settings allowing it.

   The Sea of Thieves title id is discovered from the player's own
   title list rather than hardcoded, so a wrong constant can't
   silently break this.
   ============================================================ */

const BASE = 'https://xbl.io/api/v2';
const TITLE_NAME = 'sea of thieves';

class ProviderError extends Error {
  constructor(code, message, httpStatus) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus || null;
  }
}

function key() {
  const k = process.env.OPENXBL_API_KEY;
  if (!k) throw new ProviderError('not_configured', 'OPENXBL_API_KEY is not set');
  return k;
}

async function request(path, init) {
  /* The headers are merged LAST and on purpose. Spreading `init` over an
     object that already held them let a caller passing Content-Type replace
     the whole header set — taking X-Authorization with it, so the request
     went out unauthenticated and OpenXBL answered as if nothing was there. */
  const res = await fetch(BASE + path, Object.assign({}, init, {
    headers: Object.assign({
      'X-Authorization': key(),
      'Accept': 'application/json',
      // Xbox Live rejects requests whose locale it can't parse, and OpenXBL
      // forwards the header verbatim — so it has to be a real locale.
      'Accept-Language': 'en-US',
      'User-Agent': 'sot-tracker/0.1'
    }, (init && init.headers) || {})
  }));

  if (res.status === 429) throw new ProviderError('rate_limited', 'OpenXBL rate limit hit', 429);
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError('not_configured', 'OpenXBL rejected the API key', res.status);
  }
  if (res.status === 404) throw new ProviderError('not_found', 'Not found on Xbox Live', 404);
  if (!res.ok) throw new ProviderError('upstream', `OpenXBL returned ${res.status}`, res.status);

  const body = await res.json();

  // OpenXBL can answer 200 while relaying an upstream failure in the body.
  if (body && typeof body.code === 'number' && body.code >= 400) {
    const detail = typeof body.content === 'string' ? body.content : '';
    if (body.code === 403) throw new ProviderError('private', 'Xbox Live denied access to this data', 403);
    if (body.code === 404) throw new ProviderError('not_found', 'Not found on Xbox Live', 404);
    throw new ProviderError('upstream', `Xbox Live error ${body.code} ${detail}`.trim(), body.code);
  }

  // Some endpoints wrap the payload in `content`, others don't.
  return body && body.content !== undefined ? body.content : body;
}

function get(path) {
  return request(path);
}

function post(path, payload) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

/** Gamertag → XUID. A pure-digit input is treated as an XUID already. */
async function resolveIdentity(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new ProviderError('not_found', 'No gamertag given');

  if (/^\d{16,}$/.test(raw)) return { externalId: raw, handle: null };

  const data = await get('/search/' + encodeURIComponent(raw));
  const person = data && Array.isArray(data.people) ? data.people[0] : null;
  if (!person) throw new ProviderError('not_found', `No Xbox player named "${raw}"`);

  return {
    externalId: person.xuid,
    handle: person.gamertag || raw,
    avatar: person.displayPicRaw || null
  };
}

function pickSotTitle(titles) {
  if (!Array.isArray(titles)) return null;
  return titles.find((t) => String(t.name || '').toLowerCase().includes(TITLE_NAME)) || null;
}

async function fetchTitleData(xuid) {
  let data;
  try {
    data = await get(`/achievements/player/${encodeURIComponent(xuid)}`);
  } catch (e) {
    if (e.code === 'not_found') return null;
    throw e;
  }

  const title = pickSotTitle(data && data.titles);
  if (!title) return null;

  const stats = title.achievement || {};

  return {
    titleId: title.titleId,
    gamerscore: {
      earned: Number(stats.currentGamerscore || 0),
      total: Number(stats.totalGamerscore || 0)
    },
    progress: Number(stats.progressPercentage || 0),
    lastPlayed: title.titleHistory && title.titleHistory.lastTimePlayed
      ? String(title.titleHistory.lastTimePlayed).slice(0, 10)
      : null
  };
}

/* Playtime is NOT on the title object. Reading it from `title.stats` — as
   this did — could never work: that field is the object {sourceVersion: 3},
   so `.find` is undefined and the whole expression collapsed to 0, which
   then became a null playtime. Every Xbox profile has reported "no hours"
   since the provider was written.

   The real source is the user-stats endpoint, which has to be POSTed: the
   stat names are a request body, not a path. It answers with
     statlistscollection[0].stats[] = [{ name: 'MinutesPlayed', value: '33373' }]
   and `value` is a STRING even though `type` says Integer. */
async function fetchMinutesPlayed(xuid, titleId) {
  if (!titleId) return null;

  let data;
  try {
    data = await post('/player/stats', {
      xuids: [String(xuid)],
      stats: [{ name: 'MinutesPlayed', titleId: String(titleId) }]
    });
  } catch (e) {
    return null; // hours are a nicety; never fail a whole snapshot over them
  }

  const collection = (data && data.statlistscollection) || [];
  for (const group of collection) {
    const stat = (group.stats || []).find(
      (s) => String(s.name || '').toLowerCase() === 'minutesplayed'
    );
    // A title that simply doesn't report the stat comes back with no `value`.
    if (stat && stat.value != null && stat.value !== '') {
      const n = Number(stat.value);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

async function fetchAchievements(xuid, titleId) {
  if (!titleId) return null;
  let data;
  try {
    data = await get(`/achievements/player/${encodeURIComponent(xuid)}/${encodeURIComponent(titleId)}`);
  } catch (e) {
    return null;
  }

  const list = (data && data.achievements) || [];
  if (!list.length) return null;

  const items = list.map((a) => {
    const unlocked = String(a.progressState || '').toLowerCase() === 'achieved';
    const when = a.progression && a.progression.timeUnlocked;
    return {
      id: String(a.id),
      name: a.name || String(a.id),
      unlocked,
      unlockedAt: unlocked && when ? String(when).slice(0, 10) : null
    };
  });

  return {
    items,
    unlockedCount: items.filter((i) => i.unlocked).length,
    totalCount: items.length
  };
}

async function fetchSnapshot(account) {
  const xuid = account.externalId;
  const title = await fetchTitleData(xuid);

  if (!title) {
    throw new ProviderError('private', 'No Sea of Thieves data visible for this gamertag');
  }

  const [achievements, minutesPlayed] = await Promise.all([
    fetchAchievements(xuid, title.titleId),
    fetchMinutesPlayed(xuid, title.titleId)
  ]);

  return {
    source: 'xbox',
    capturedAt: new Date().toISOString(),
    identity: {
      externalId: xuid,
      handle: account.handle || null,
      avatar: account.avatar || null
    },
    currencies: null,
    hourglass: null,
    reputation: null,
    milestones: null,
    commendations: null,
    season: null,
    // Xbox reports a lifetime total only — there is no 2-week window here,
    // which is why recentHours stays null where Steam can fill it.
    playtime: minutesPlayed
      ? { totalHours: Math.round(minutesPlayed / 60), recentHours: null }
      : null,
    achievements,
    gamerscore: title.gamerscore,
    lastPlayed: title.lastPlayed
  };
}

module.exports = {
  name: 'xbox',
  requiresCredential: false,
  isConfigured: () => Boolean(process.env.OPENXBL_API_KEY),
  resolveIdentity,
  fetchSnapshot,
  ProviderError
};
