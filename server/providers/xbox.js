/* ============================================================
   Xbox Live provider (via OpenXBL) — public data, no signup.

   Gives: gamerscore + achievements for Sea of Thieves, and the
   playtime Xbox exposes through the title history.
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

async function get(path) {
  const res = await fetch(BASE + path, {
    headers: {
      'X-Authorization': key(),
      'Accept': 'application/json',
      // Xbox Live rejects requests whose locale it can't parse, and OpenXBL
      // forwards the header verbatim — so it has to be a real locale.
      'Accept-Language': 'en-US',
      'User-Agent': 'sot-tracker/0.1'
    }
  });

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
  const minutes = Number(
    (title.stats && title.stats.find && (title.stats.find((s) => s.name === 'MinutesPlayed') || {}).value) || 0
  );

  return {
    titleId: title.titleId,
    gamerscore: {
      earned: Number(stats.currentGamerscore || 0),
      total: Number(stats.totalGamerscore || 0)
    },
    progress: Number(stats.progressPercentage || 0),
    minutesPlayed: minutes || null,
    lastPlayed: title.titleHistory && title.titleHistory.lastTimePlayed
      ? String(title.titleHistory.lastTimePlayed).slice(0, 10)
      : null
  };
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

  const achievements = await fetchAchievements(xuid, title.titleId);

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
    playtime: title.minutesPlayed
      ? { totalHours: Math.round(title.minutesPlayed / 60), recentHours: null }
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
