/* ============================================================
   Background worker — coordinates the sync.

   It does NOT call Rare itself: the session cookie is SameSite, so a
   request from here would be cross-site and the cookie withheld. The
   actual reads happen in the content script running on the
   seaofthieves.com page, which is same-origin.

   Flow:
     find (or open) a seaofthieves.com tab
       → ask its content script to collect
         → POST stats only to the tracker
   ============================================================ */

const api = typeof browser !== 'undefined' ? browser : chrome;
const isFirefox = typeof browser !== 'undefined' && !!browser.runtime;

const DEFAULT_TRACKER = 'https://sot-tracker-api-ssi7.onrender.com';
const SOT_URL = 'https://www.seaofthieves.com/profile';

class SyncError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function trackerBase() {
  const stored = await api.storage.local.get('trackerBase');
  return (stored && stored.trackerBase) || DEFAULT_TRACKER;
}

/* The account key. Generated here, on this machine, and never shown to
   the page or sent anywhere but the tracker: it is what proves later
   syncs for a pirate come from the same install. Without it, the first
   person to type someone's gamertag could publish stats as them. */
async function accountKey() {
  const stored = await api.storage.local.get('accountKey');
  if (stored && stored.accountKey) return stored.accountKey;

  const key = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)) +
    '-' + Date.now().toString(36);
  await api.storage.local.set({ accountKey: key });
  return key;
}

/* The pirate these stats get published under. The page usually tells us;
   when it does not, the popup lets the owner type it once. */
async function pirateHandle(bundle) {
  const fromPage = bundle && bundle.payloads && bundle.payloads.page;
  const stored = await api.storage.local.get('pirateHandle');
  const typed = stored && stored.pirateHandle;
  if (typed) return typed;
  if (fromPage && fromPage.name) return fromPage.name;
  return null;
}

/* The API and the static site are two different servers on two different
   ports, and package.json's "site" script makes 5501 an easy thing to paste
   in here by mistake. A wrong port costs a whole sync — the stats are read,
   then thrown away at the last step. So prove the address answers before
   trusting it, and fall back to the ones that plausibly do. */
/* Free hosts put idle services to sleep; the first request after that wakes
   the machine and can take the better part of a minute. A 2s probe called
   that "unreachable" and failed the sync on a server that was merely
   waking. Local addresses answer instantly, so they keep the short
   timeout — only remote ones get the long one. */
function healthTimeout(base) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)/.test(base) ? 2000 : 60000;
}

async function healthy(base, onSlow) {
  const ctl = new AbortController();
  const budget = healthTimeout(base);
  const timer = setTimeout(() => ctl.abort(), budget);

  /* Tell the popup once the wait stops looking instantaneous, so a cold
     start reads as "waking up" rather than a frozen button. */
  const slow = onSlow ? setTimeout(() => onSlow(base), 3000) : null;

  try {
    const res = await fetch(base + '/api/health', { signal: ctl.signal });
    return res.ok;
  } catch (e) {
    return false;
  } finally {
    clearTimeout(timer);
    if (slow) clearTimeout(slow);
  }
}

async function resolveTrackerBase(onSlow) {
  const configured = await trackerBase();
  const candidates = [configured];

  /* Only guess at ports for local addresses. A deployed tracker is on
     :443 behind a name, and probing "https://host:8787" there just burns
     a minute of cold-start budget on a port nothing listens to. */
  if (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(configured)) {
    const onApiPort = configured.replace(/:\d+$/, '') + ':8787';
    if (!candidates.includes(onApiPort)) candidates.push(onApiPort);
    if (!candidates.includes(DEFAULT_TRACKER)) candidates.push(DEFAULT_TRACKER);
  }

  for (const base of candidates) {
    if (await healthy(base, onSlow)) {
      return { base, corrected: base !== configured ? configured : null, probeOk: true };
    }
  }
  /* Nothing answered a plain GET. That is a different failure from "the POST
     was rejected", and the two need different fixes — so say which. */
  return { base: configured, corrected: null, probeOk: false };
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* Every await below is a place the sync could hang. A hang is worse than a
   failure: the popup has nothing to show and the user has nothing to do.
   So nothing is allowed to run unbounded. */
function withTimeout(promise, ms, code, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new SyncError(code, message)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

/** Resolves once the tab reports status "complete", or throws. */
/* Best effort only. "complete" is a poor readiness signal on this site: it
   is a heavy app that keeps requests open, so the tab can sit at "loading"
   long after the document is usable — while the content script attaches at
   document_idle, much earlier. Waiting for "complete" therefore times out on
   a page that was ready all along. The real readiness test is a ping, so
   this just gives the tab a moment and hands back whatever state it is in;
   it only throws if the tab is gone. */
async function waitForLoad(tabId, attempts = 40) {
  let t = null;
  for (let i = 0; i < attempts; i++) {
    try {
      t = await api.tabs.get(tabId);
    } catch (e) {
      throw new SyncError('tab_closed', 'The Sea of Thieves tab was closed');
    }
    if (t.status === 'complete') return t;
    await wait(250);
  }
  return t;
}

/* Chrome's Memory Saver unloads background tabs. A discarded tab still
   reports its URL and status "complete", but has no renderer behind it —
   nothing to message, nothing to inject into. It has to be woken first. */
async function revive(tab) {
  // Only a discarded tab needs waking. A tab merely stuck at "loading" is
  // usually fine — reloading it on every sync would be a pointless churn,
  // and ensureContentScript already handles a page that stays silent.
  if (!tab || !tab.discarded) return tab;
  await api.tabs.reload(tab.id);
  await wait(250);
  return waitForLoad(tab.id, 20);
}

/* The site is locale-prefixed, so the profile lives at /profile or
   /fr/profile depending on where it redirected. */
const PROFILE_RE = /^https:\/\/www\.seaofthieves\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?profile/i;

/** An existing SoT tab if there is one, otherwise a freshly opened one. */
async function getSotTab() {
  const existing = await api.tabs.query({ url: 'https://www.seaofthieves.com/*' });
  if (existing && existing.length) {
    /* Prefer a tab already on the profile. Any page on the origin can serve
       the absolute /api paths, but only the profile page calls the profile
       endpoints itself — which is what makes discovery worth anything. */
    const onProfile = existing.find((t) => !t.discarded && PROFILE_RE.test(t.url || ''));
    if (onProfile) {
      return { tab: await revive(await waitForLoad(onProfile.id)), opened: false };
    }
    // Otherwise open our own profile tab rather than read from the homepage.
  }

  const created = await api.tabs.create({ url: SOT_URL, active: false });
  return { tab: await waitForLoad(created.id), opened: true };
}

let lastGroups = null;

async function ping(tabId) {
  try {
    // A listener that acknowledges but never replies would hang this
    // forever; an unanswered ping just means "not there".
    const r = await withTimeout(
      api.tabs.sendMessage(tabId, { type: 'ping' }),
      1000, 'ping_timeout', 'ping went unanswered');
    if (r && r.groups) lastGroups = r.groups;
    return !!(r && r.pong);
  } catch (e) {
    return false;
  }
}

/* A tab that was already open when the extension was installed or reloaded
   has no content script in it — the manifest only injects into navigations
   that happen afterwards. Rather than telling the user to reload the tab,
   inject the script ourselves and carry on. */
async function inject(tabId) {
  if (!api.scripting) return false;
  try {
    await withTimeout(
      api.scripting.executeScript({ target: { tabId }, files: ['src/content.js'] }),
      5000, 'inject_timeout', 'executeScript stalled');
    return true;
  } catch (e) {
    return false;
  }
}

async function pingFor(tabId, attempts) {
  for (let i = 0; i < attempts; i++) {
    if (await ping(tabId)) return true;
    await wait(250);
  }
  return false;
}

/* Opening the profile in a fresh tab kicks off a silent re-auth: the tab
   leaves for the identity provider and comes back a moment later. Judging
   the URL mid-flight reads that round trip as "signed out" — so give the
   redirect chain time to land before concluding anything. */
async function waitForOrigin(tabId, attempts = 40) {
  let last = '';
  for (let i = 0; i < attempts; i++) {
    const t = await api.tabs.get(tabId).catch(() => null);
    if (!t) throw new SyncError('tab_closed', 'The Sea of Thieves tab was closed');
    last = t.url || '';
    if (/^https:\/\/www\.seaofthieves\.com\//.test(last)) return t;
    await wait(500);
  }
  return { url: last, stillAway: true };
}

async function ensureContentScript(tab) {
  if (await ping(tab.id)) return;

  if (!/^https:\/\/www\.seaofthieves\.com\//.test(tab.url || '')) {
    const back = await waitForOrigin(tab.id);
    if (back.stillAway) {
      let host = back.url || 'another site';
      try { host = new URL(back.url).host; } catch (e) { /* keep raw */ }
      throw new SyncError('signed_out',
        `The tab is still at ${host} after 20s — the sign-in did not complete. ` +
        'Open seaofthieves.com, sign in, then sync again.');
    }
    tab = back;
  }

  // 1. inject into the page as it stands
  if (await inject(tab.id)) {
    if (await pingFor(tab.id, 4)) return;
  }

  /* 2. Still silent. The renderer may be in a state injection can't reach
     (unloaded, crashed, or mid-restore). Reloading gives the page a fresh
     document, which the manifest content script attaches to on its own —
     doing for the user what the old error message asked them to do. */
  try {
    await api.tabs.reload(tab.id);
  } catch (e) {
    throw new SyncError('no_content_script',
      'Could not reload the Sea of Thieves tab: ' + (e.message || e));
  }

  // Poll the ping rather than the load state — it answers as soon as the
  // script is live, and it keeps answering if the page loads slowly.
  await wait(500);
  if (await pingFor(tab.id, 12)) return;
  if (await inject(tab.id) && await pingFor(tab.id, 4)) return;

  const t = await api.tabs.get(tab.id).catch(() => null);
  throw new SyncError('no_content_script',
    'The page stays silent after a reload' +
    (t ? ` (status=${t.status}, discarded=${t.discarded}, url=${(t.url || '').slice(0, 60)})` : ''));
}

/* The site redirects to a locale path (/profile → /fr) on its own. That
   navigation kills the content script, so starting a collect before the URL
   stops moving means reading from a page that is about to vanish. Wait for
   two identical readings before trusting it. */
async function waitForUrlSettled(tabId, attempts = 12) {
  let previous = null;
  for (let i = 0; i < attempts; i++) {
    const t = await api.tabs.get(tabId).catch(() => null);
    if (!t) throw new SyncError('tab_closed', 'The Sea of Thieves tab was closed');
    if (t.url && t.url === previous && t.status === 'complete') return t;
    previous = t.url;
    await wait(500);
  }
  return api.tabs.get(tabId).catch(() => null);
}

/* Drives the collect one group at a time. A group that stalls costs its own
   12s and is reported by name, instead of swallowing the whole budget and
   coming back as an unexplained silence. */
async function collectByGroup(tabId) {
  const groups = lastGroups || ['overview', 'reputation', 'ledger'];
  const payloads = {};
  const probes = {};
  const tried = [];
  let signedOut = null;

  const askGroup = (name) => withTimeout(
    api.tabs.sendMessage(tabId, { type: 'collectOne', name }),
    10000, 'group_timeout', `${name} did not answer in 10s`);

  /* The script can die between groups — the page navigates, the renderer is
     replaced — and then every remaining group waits out its timeout against
     a listener that no longer exists. Checking it is still there costs one
     ping; not checking it cost four groups. */
  let repairs = 0;
  async function repairIfDead() {
    if (repairs >= 2) return false;
    if (await ping(tabId)) return false;
    repairs++;
    const t = await api.tabs.get(tabId).catch(() => null);
    if (!t) throw new SyncError('tab_closed', 'The Sea of Thieves tab was closed');
    await inject(tabId);
    return pingFor(tabId, 4);
  }

  /* Reading one group's reply. Kept apart from the asking so the first pass
     and the retry pass can share it verbatim. */
  function record(name, r) {
    if (!r) { probes[name] = 'no reply'; tried.push(`${name}: empty reply`); return; }

    /* One endpoint refusing is not a verdict on the session. Some of these
       are gated differently, and treating a single 401 as "signed out" used
       to abort the pass and discard groups that had already succeeded on the
       very same cookie. Record it and keep going; the judgement about the
       session belongs at the end, where the whole picture is visible. */
    if (r.error === 'signed_out') {
      signedOut = r.message;
      probes[name] = 'auth denied';
      tried.push(`${name}: ${r.message}`);
      return;
    }

    if (r.data !== undefined) { payloads[name] = r.data; probes[name] = r.path; return; }

    probes[name] = 'failed';
    if (r.tried) tried.push(...r.tried);
  }

  /* The groups read three independent endpoints, so waiting for each one
     before starting the next spent three timeouts end to end when the whole
     set could have been in flight at once. This is not extra load on Rare —
     it is the same three reads, and the profile page itself issues them
     concurrently on load. It only stops the sync idling between them. */
  const first = await Promise.all(groups.map(async (name) => {
    try {
      return { name, r: await askGroup(name) };
    } catch (e) {
      if (!(e instanceof SyncError)) throw e;
      return { name, stalled: true };
    }
  }));

  const stalled = [];
  for (const entry of first) {
    if (entry.stalled) stalled.push(entry.name);
    else record(entry.name, entry.r);
  }

  /* Silence usually means the listener is gone, not that the endpoint is
     slow — and if it is gone, every group went quiet together. So repair
     once for the whole batch rather than once per group, then retry only
     what actually stalled. */
  if (stalled.length) {
    // A tab_closed thrown in here is fatal and is meant to propagate.
    const recovered = await repairIfDead();

    for (const name of stalled) {
      if (!recovered) {
        probes[name] = 'timeout';
        tried.push(`${name}: no answer in 10s`);
        continue;
      }
      try {
        record(name, await askGroup(name));
      } catch (e2) {
        if (!(e2 instanceof SyncError)) throw e2;
        probes[name] = 'timeout';
        tried.push(`${name}: no answer, even after re-attaching`);
      }
    }
  }

  /* The gamertag lives in the page, not the payloads — grab it alongside. */
  if (Object.keys(payloads).length) {
    try {
      const m = await withTimeout(
        api.tabs.sendMessage(tabId, { type: 'meta' }),
        3000, 'meta_timeout', 'meta went unanswered');
      if (m && m.meta) payloads.page = m.meta;
    } catch (e) { /* a missing name never fails a sync */ }
  }

  /* Something failed, so ask the page which /api/ paths it actually called.
     That list is what a fix has to be built from. */
  if (Object.values(probes).some((v) => v === 'failed' || v === 'timeout')) {
    try {
      const d = await withTimeout(
        api.tabs.sendMessage(tabId, { type: 'discover' }),
        5000, 'discover_timeout', 'discovery went unanswered');
      if (d && d.paths && d.paths.length) {
        tried.push('page actually calls: ' + d.paths.join(' '));
      }
    } catch (e) { /* diagnostics only — never fail a sync over this */ }
  }

  /* Only call the session dead when nothing at all came back. If any group
     returned data, the cookie plainly works and the refusals are about those
     specific endpoints, not about being signed out. */
  if (!Object.keys(payloads).length) {
    if (signedOut) return { error: 'signed_out', message: signedOut, probes, tried };
    return { error: 'no_data', message: 'No endpoint answered', probes, tried };
  }
  return { collectedAt: new Date().toISOString(), payloads, probes, tried };
}

async function askContentScript(tabId) {
  try {
    return await withTimeout(
      collectByGroup(tabId),
      100000, 'no_reply',
      'The Sea of Thieves page stopped answering mid-collect');
  } catch (e) {
    if (e instanceof SyncError) throw e;

    /* The port only dies mid-collect if the page went away under it. Where
       the tab ended up says why — and the usual answer is the sign-in
       redirect, which "reload the tab" would never fix. */
    const t = await api.tabs.get(tabId).catch(() => null);
    const url = (t && t.url) || '';

    if (!t) {
      throw new SyncError('tab_closed', 'The Sea of Thieves tab closed during the sync');
    }
    if (url && !/^https:\/\/www\.seaofthieves\.com\//.test(url)) {
      let host = url;
      try { host = new URL(url).host; } catch (err) { /* keep the raw string */ }
      throw new SyncError('signed_out',
        `The tab left for ${host} mid-collect — that is the sign-in redirect, ` +
        'so the session is not active. Sign in there, then sync again.');
    }
    throw new SyncError('no_content_script',
      `The page reloaded under the sync (now at ${url.slice(0, 60)}). Try again.`);
  }
}

function postSync(base, bundle, key) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), key ? 60000 : 10000);

  /* The key travels in a header AND in the body. X-Account-Key is not a
     CORS-safelisted header, so on its own it would force the preflight
     this request was rewritten to avoid; carrying it in the body too
     means a blocked or stripped preflight cannot cost a whole sync. */
  const headers = { 'Content-Type': 'text/plain;charset=UTF-8' };
  if (key) headers['X-Account-Key'] = key;
  /* text/plain, not application/json, and deliberately so: application/json
     is not a CORS-safelisted content type, so it forces a preflight OPTIONS.
     That preflight is what was failing here — the GET health probe sails
     through while the POST dies instantly. The body is still JSON and the
     server parses it from the raw bytes without consulting this header. */
  return fetch(base + '/api/sync', {
    method: 'POST',
    headers,
    body: JSON.stringify(bundle),
    signal: ctl.signal
  }).finally(() => clearTimeout(timer));
}

async function pushToTracker(bundle, notify) {
  const { base, corrected, probeOk } = await resolveTrackerBase((b) => {
    if (notify) notify({ type: 'waking', base: b });
  });

  // Persist the working address so the next sync goes straight there.
  if (corrected) await api.storage.local.set({ trackerBase: base });

  /* Identify the account and the pirate before publishing anything: the
     server files stats under a handle and refuses one that belongs to a
     different install. */
  const key = await accountKey();
  const handle = await pirateHandle(bundle);
  if (!handle) {
    throw new SyncError('no_handle',
      'No pirate name found on the page. Open the extension and set it once.');
  }
  bundle.handle = handle;
  bundle.accountKey = key;

  /* Chrome resolves "localhost" to ::1 first on Windows. If anything in
     that path is unhappy, the same server is still reachable over IPv4,
     so try the literal address before declaring the tracker down. */
  const fallback = /^http:\/\/localhost(:\d+)?$/.test(base)
    ? base.replace('//localhost', '//127.0.0.1')
    : null;

  let res;
  let firstError;
  try {
    res = await postSync(base, bundle, key);
  } catch (e) {
    firstError = e;
    if (fallback) {
      try {
        res = await postSync(fallback, bundle, key);
      } catch (e2) { /* both failed — report the original */ }
    }
  }

  if (!res) {
    // Carry the underlying reason: "Failed to fetch" and a blocked-by-policy
    // error look identical from the popup otherwise.
    const why = (firstError && firstError.message) || 'unknown error';
    throw new SyncError(
      probeOk ? 'post_blocked' : 'tracker_down',
      probeOk
        // GET got through on this very address, so the server is up and
        // reachable — the POST specifically is being refused.
        ? `GET ${base}/api/health succeeded but POST /api/sync failed (${why}). ` +
          'The server is up and reachable; the POST itself is being blocked.'
        : `Nothing answered at ${base} — not even GET /api/health (${why}). ` +
          'The extension cannot reach localhost at all.');
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new SyncError(
      (body.error && body.error.code) || 'tracker_error',
      (body.error && body.error.message) || `Tracker returned ${res.status}`
    );
  }
  return Object.assign({}, body, { base, corrected });
}

/* Which phase ate the clock. Attached to both success and failure, because
   "it took 75s" is not actionable without knowing where. */
function makeTimer() {
  const phases = {};
  let mark = Date.now();
  return {
    phases,
    lap(name) {
      const now = Date.now();
      phases[name] = (now - mark) + 'ms';
      mark = now;
    }
  };
}

/* The global cap rejects from outside runSync, so its error carries no
   phases of its own — and a timeout is precisely when they matter. The
   live object is mutated by lap(), so it holds whatever got done. */
let currentPhases = null;

async function runSync() {
  const timer = makeTimer();
  currentPhases = timer.phases;

  let tab, opened;
  try {
    ({ tab, opened } = await getSotTab());
  } catch (e) {
    timer.lap('find_tab');
    e.phases = timer.phases;
    throw e;
  }
  timer.lap('find_tab');

  let bundle;
  try {
    // Let the site finish its own locale redirect before reading anything.
    const settled = await withTimeout(waitForUrlSettled(tab.id), 8000, 'no_reply',
      'The page kept navigating and never settled');
    timer.lap('settle');

    // Generous: this budget now includes reviving a tab, not just injecting.
    await withTimeout(ensureContentScript(settled || tab), 40000, 'no_content_script',
      'Could not get the page to answer, even after reloading it');
    timer.lap('inject');

    try {
      bundle = await askContentScript(tab.id);
    } catch (e) {
      /* A navigation that lands back on seaofthieves.com is the site doing
         its own thing, not a broken tab — re-attach and read once more
         rather than making the user click again. */
      if (e.code !== 'no_content_script') throw e;
      timer.lap('collect_lost');
      const again = await withTimeout(waitForUrlSettled(tab.id), 8000, 'no_reply',
        'The page kept navigating and never settled');
      await withTimeout(ensureContentScript(again || tab), 15000, 'no_content_script',
        'The page would not answer after it navigated');
      bundle = await withTimeout(collectByGroup(tab.id),
        100000, 'no_reply', 'The page stopped answering on the second try');
    }
    timer.lap('collect');
  } catch (e) {
    timer.lap('failed_in_page');
    e.phases = timer.phases;
    throw e;
  } finally {
    // don't leave a tab behind that we opened ourselves
    if (opened) { try { await api.tabs.remove(tab.id); } catch (e) {} }
  }

  if (!bundle) {
    const err = new SyncError('no_reply', 'The Sea of Thieves page did not respond');
    err.phases = timer.phases;
    throw err;
  }
  if (bundle.error) {
    const err = new SyncError(bundle.error, bundle.message);
    err.probes = bundle.probes;
    err.tried = bundle.tried;
    err.phases = timer.phases;
    throw err;
  }

  let saved;
  try {
    saved = await pushToTracker(bundle);
  } catch (e) {
    timer.lap('push');
    e.phases = timer.phases;
    e.probes = bundle.probes;
    e.tried = bundle.tried;

    /* The stats were read successfully — losing them because the worker's
       own POST was refused would be a waste. The popup is an extension page
       rather than a service worker, and its requests do not go through the
       same restrictions, so hand it the bundle and let it try. */
    if (e.code === 'post_blocked') {
      e.pending = bundle;
      e.base = (await resolveTrackerBase()).base;
    }
    throw e;
  }
  timer.lap('push');

  await api.storage.local.set({
    lastSync: {
      at: new Date().toISOString(),
      handle: saved.handle || null,
      probes: bundle.probes,
      phases: timer.phases
    }
  });

  return {
    ok: true,
    handle: saved.handle || null,
    probes: bundle.probes,
    // Carried on success too: the groups that failed are exactly what needs
    // fixing next, and a successful sync is when you find out about them.
    tried: bundle.tried || null,
    phases: timer.phases,
    base: saved.base || null,
    corrected: saved.corrected || null
  };
}

/* One sync at a time. A second click used to start a whole second run,
   which meant a second hidden tab and two writes racing each other. The
   timer shares this lock with the button, so an auto-sync that lands while
   someone is clicking joins the run in progress instead of racing it. */
let inFlight = null;

function startSync() {
  if (!inFlight) {
    inFlight = withTimeout(runSync(), 240000, 'timeout',
      'Sync gave up after 4 minutes — nothing was left half-written')
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

/* ---------- automatic refresh ----------

   Stats only move while the account is actually playing, so no amount of
   extra requests per sync makes the numbers fresher — re-reading the same
   endpoints twice in a row returns the same payload. What keeps a profile
   current is syncing again later, which is what this does.

   Off by default, and floored well above the alarms API minimum: this
   drives an undocumented endpoint on Rare's own site with the player's
   session, and a tight loop there earns a 429 (which the content script
   already reports) or worse. */
const AUTO_ALARM = 'sot-auto-sync';
const DEFAULT_INTERVAL_MIN = 30;
const MIN_INTERVAL_MIN = 15;

async function autoSyncSettings() {
  const stored = await api.storage.local.get(['autoSync', 'autoSyncMinutes']);
  const minutes = Number(stored && stored.autoSyncMinutes);
  return {
    enabled: Boolean(stored && stored.autoSync),
    minutes: Number.isFinite(minutes) && minutes >= MIN_INTERVAL_MIN
      ? Math.round(minutes)
      : DEFAULT_INTERVAL_MIN
  };
}

async function applyAutoSync() {
  if (!api.alarms) return null; // permission not granted in this build
  const { enabled, minutes } = await autoSyncSettings();

  await api.alarms.clear(AUTO_ALARM).catch(() => {});
  if (!enabled) return { enabled: false, minutes };

  api.alarms.create(AUTO_ALARM, { periodInMinutes: minutes, delayInMinutes: minutes });
  return { enabled: true, minutes };
}

if (api.alarms) {
  api.alarms.onAlarm.addListener((alarm) => {
    if (!alarm || alarm.name !== AUTO_ALARM) return;
    /* A background run has nobody watching it, so a failure must not surface
       as an unhandled rejection — the last attempt is recorded in storage
       either way and the popup shows it on open. */
    startSync().catch(() => {});
  });
}

// Re-arm after an update or a browser restart; alarms do not survive either.
if (api.runtime.onInstalled) api.runtime.onInstalled.addListener(() => { applyAutoSync(); });
if (api.runtime.onStartup) api.runtime.onStartup.addListener(() => { applyAutoSync(); });
applyAutoSync();

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  /* Settings changes are answered here rather than written straight from the
     popup, so the alarm is always re-armed by the same code that reads it. */
  if (msg && msg.type === 'setAutoSync') {
    const job = (async () => {
      await api.storage.local.set({
        autoSync: Boolean(msg.enabled),
        autoSyncMinutes: Math.max(MIN_INTERVAL_MIN, Number(msg.minutes) || DEFAULT_INTERVAL_MIN)
      });
      const applied = await applyAutoSync();
      return Object.assign({ ok: true, min: MIN_INTERVAL_MIN }, applied || await autoSyncSettings());
    })();

    if (isFirefox) return job;
    job.then(sendResponse);
    return true;
  }

  if (msg && msg.type === 'getAutoSync') {
    const job = autoSyncSettings().then((s) => Object.assign({ min: MIN_INTERVAL_MIN }, s));
    if (isFirefox) return job;
    job.then(sendResponse);
    return true;
  }

  if (!msg || msg.type !== 'sync') return false;

  const job = startSync().catch((err) => ({
    ok: false,
    code: err.code || 'unknown',
    message: err.message || String(err),
    probes: err.probes || null,
    tried: err.tried || null,
    phases: err.phases || currentPhases || null,
    pending: err.pending || null,
    base: err.base || null
  }));

  // Firefox resolves a returned Promise; Chromium needs sendResponse.
  if (isFirefox) return job;
  job.then(sendResponse);
  return true;
});
