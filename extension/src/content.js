/* ============================================================
   Content script — runs INSIDE the seaofthieves.com page.

   Why here and not in the background worker: Rare's session cookie
   is SameSite, so a fetch from the extension's own context counts as
   cross-site and the browser withholds it. From this script the
   request is same-origin, so the cookie is attached exactly as it is
   for the page itself.

   This script only ever reads. It hands raw JSON back to the
   background worker, which forwards stats to the tracker. The cookie
   is never read, copied, or transmitted — the browser attaches it and
   we never see its value.
   ============================================================ */

(function () {
  'use strict';

  const api = typeof browser !== 'undefined' ? browser : chrome;

  /* This file can end up in a page more than once: the manifest injects it
     on navigation, and the worker re-injects it into tabs that predate the
     extension. Two live listeners would answer every message twice.

     A "already loaded, bail out" flag is wrong here though. Reloading the
     extension leaves the previous copy in the page, orphaned — its runtime
     is dead so it can never answer — while its flag survives in this
     isolated world. Bailing out on that flag means no listener registers at
     all, and the tab goes permanently silent.

     So every copy registers, stamps itself as the current one, and any
     older copy sees it has been superseded and stays quiet. */
  const TOKEN = Math.random().toString(36).slice(2);
  window.__sotTrackerActive = TOKEN;
  const superseded = () => window.__sotTrackerActive !== TOKEN;

  /* The site calls these under its locale prefix (/fr/api/profilev2/...),
     which is what its own resource timings show. The unprefixed form answers
     too, so try the locale first and keep the bare path as a fallback.

     No "season" group: the overview payload already contains a "seasons"
     key, so the season endpoint we used to probe never existed. Likewise
     nothing is guessed for hourglass any more — see the sweep below. */
  const LOCALE = (location.pathname.match(/^\/([a-z]{2}(?:-[a-z]{2})?)\//) || [])[1] || '';
  const p = (path) => (LOCALE ? [`/${LOCALE}${path}`, path] : [path]);

  const ENDPOINTS = {
    overview:   [...p('/api/profilev2/overview'), '/api/profilev2/summary'],
    reputation: [...p('/api/profilev2/reputation')],
    ledger:     [...p('/api/profilev2/balance'), '/api/profilev2/ledger']
  };

  /* No hourglass group: the sweep ruled out sixteen candidate paths, and the
     reputation payload turned out to carry both sides already (Flameheart
     and PirateLord). The server reads them from there. */

  /* Two candidate paths per group have to fit inside the worker's 10s
     budget for that group, so 6s each was one path too many. */
  const FETCH_TIMEOUT_MS = 4000;

  async function getJSON(path) {
    /* The timer has to cover the body too, not just the headers. Clearing it
       as soon as fetch() resolves leaves res.text() unbounded, so a response
       whose headers arrive but whose body stalls hangs forever — which is
       exactly how the whole collect blew past its own budget. */
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    const timedOut = () =>
      ({ error: 'timeout', message: `No answer in ${FETCH_TIMEOUT_MS / 1000}s: ${path}` });

    try {
      const res = await fetch(path, {
        method: 'GET',
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json, text/plain, */*' },
        signal: ctl.signal
      });

      /* Rare bounces signed-out requests to an identity provider. That lands
         as a redirect off this origin, which reads as a network failure
         rather than the "please sign in" it actually is. */
      if (res.redirected && !/^https:\/\/www\.seaofthieves\.com\//.test(res.url)) {
        return { error: 'signed_out', message: 'Redirected to sign-in — not signed in' };
      }

      if (res.status === 401 || res.status === 403) {
        return { error: 'signed_out', message: 'Session rejected — sign in again' };
      }
      if (res.status === 429) return { error: 'rate_limited', message: 'Rate limited' };
      if (res.status === 404) return { error: 'missing', message: `Gone: ${path}` };
      if (!res.ok) return { error: 'upstream', message: `HTTP ${res.status}` };

      const text = await res.text();
      if (/^\s*</.test(text)) {
        return { error: 'signed_out', message: 'Got the login page — not signed in' };
      }
      try {
        return { data: JSON.parse(text) };
      } catch (e) {
        return { error: 'upstream', message: 'Response was not JSON' };
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return timedOut();
      return { error: 'network', message: e.message };
    } finally {
      clearTimeout(timer);
    }
  }

  async function firstThatWorks(paths, deadline) {
    const tried = [];
    let refused = null;
    for (const path of paths) {
      // Checking the budget only between groups let a group that started
      // just under the line run well past it.
      if (Date.now() > deadline) {
        tried.push(`${path}: skipped (budget spent)`);
        continue;
      }
      const r = await getJSON(path);
      if (r.data !== undefined) return { path, data: r.data };
      // A refusal on one path is no reason to skip the alternative — they
      // are not always gated the same way. Remember it and try the next.
      if (r.error === 'signed_out') {
        refused = r.message;
        tried.push(`${path}: ${r.error}`);
        continue;
      }
      tried.push(`${path}: ${r.error}`);
    }
    if (refused) return { signedOut: true, message: refused, failed: tried };
    return { failed: tried };
  }

  const COLLECT_BUDGET_MS = 30000;

  /* One group per message. Asking for all five in a single round trip means
     that if anything stalls, the worker waits out its whole budget and
     learns nothing — not which group, not which path. Split the work and a
     stall costs one group and names itself. */
  async function collectOne(name) {
    const paths = ENDPOINTS[name];
    if (!paths) return { error: 'unknown_group', message: name };

    const r = await firstThatWorks(paths, Date.now() + COLLECT_BUDGET_MS);
    if (r.data !== undefined) return { data: r.data, path: r.path };
    if (r.signedOut) return { error: 'signed_out', message: r.message, tried: r.failed || [] };
    return { error: 'failed', tried: r.failed || [] };
  }

  /* The gamertag is in none of the three payloads — overview carries only
     stats/achievements/seasons, and stats is empty. The page displays it
     though, so read it from there. Text only: no ids, no session data. */
  function pageMeta() {
    const out = { title: document.title || '', path: location.pathname };
    try {
      const el = document.querySelector(
        '[class*="gamertag" i], [class*="playerName" i], [data-gamertag], .profile-name, h1');
      const text = el && el.textContent ? el.textContent.trim() : '';
      if (text && text.length <= 40) out.name = text;
    } catch (e) { /* the title alone is enough to work with */ }
    return out;
  }

  /* When our guessed paths 404, the page itself is the authority: it has
     already called the real ones. Reading its own resource timings turns
     "which endpoint is it now?" from guesswork into observation. */
  function discover() {
    try {
      const seen = performance.getEntriesByType('resource')
        .map((e) => e.name)
        .filter((n) => n.indexOf('/api/') !== -1)
        .map((n) => { try { return new URL(n).pathname; } catch (e) { return n; } });
      return seen.filter((v, i) => seen.indexOf(v) === i).slice(0, 40);
    } catch (e) {
      return [];
    }
  }

  async function collect() {
    const names = Object.keys(ENDPOINTS);
    const results = [];
    // Per-request timeouts still add up across ten probes, so the whole
    // pass gets its own budget: return what we have rather than stall.
    const deadline = Date.now() + COLLECT_BUDGET_MS;
    // sequential: Rare is not a public API, so don't hammer it
    for (const n of names) {
      if (Date.now() > deadline) {
        results.push({ failed: [`${n}: skipped (budget spent)`] });
        continue;
      }
      results.push(await firstThatWorks(ENDPOINTS[n], deadline));
    }

    const signedOut = results.find((r) => r.signedOut);
    if (signedOut) {
      return { error: 'signed_out', message: signedOut.message };
    }

    const payloads = {};
    const probes = {};
    names.forEach((name, i) => {
      const r = results[i];
      if (r.data !== undefined) {
        payloads[name] = r.data;
        probes[name] = r.path;
      } else {
        probes[name] = 'failed';
      }
    });

    if (!Object.keys(payloads).length) {
      return {
        error: 'no_data',
        message: 'No endpoint answered',
        probes,
        tried: results.map((r) => r.failed).filter(Boolean).flat()
      };
    }

    return { collectedAt: new Date().toISOString(), payloads, probes };
  }

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // A newer copy has taken over — let it do the answering.
    if (superseded()) return false;

    if (msg && msg.type === 'ping') {
      // The group list travels with the pong so the worker never keeps its
      // own copy of it and cannot drift out of step with this file.
      const reply = { pong: true, groups: Object.keys(ENDPOINTS) };
      if (typeof browser !== 'undefined' && browser.runtime) return Promise.resolve(reply);
      sendResponse(reply);
      return false;
    }
    if (msg && msg.type === 'meta') {
      const reply = { meta: pageMeta() };
      if (typeof browser !== 'undefined' && browser.runtime) return Promise.resolve(reply);
      sendResponse(reply);
      return false;
    }
    if (msg && msg.type === 'discover') {
      const reply = { paths: discover() };
      if (typeof browser !== 'undefined' && browser.runtime) return Promise.resolve(reply);
      sendResponse(reply);
      return false;
    }
    if (!msg || (msg.type !== 'collect' && msg.type !== 'collectOne')) return false;

    const work = msg.type === 'collectOne' ? collectOne(msg.name) : collect();
    const job = work.catch((err) => ({
      error: 'unknown',
      message: err && err.message ? err.message : String(err)
    }));

    if (typeof browser !== 'undefined' && browser.runtime) return job;
    job.then(sendResponse);
    return true;
  });
})();
