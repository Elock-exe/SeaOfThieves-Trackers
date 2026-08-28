/* SotTracker — sottracker.fr
   Creator: Vyros__
   https://github.com/Elock-exe/SeaOfThieves-Trackers */
/* ============================================================
   The bookmarklet importer — runs INSIDE the seaofthieves.com page.

   Same job as the browser extension's content script, without the
   extension. A bookmarklet needs no store, no review, and no
   permissions dialog, which removes the single biggest reason people
   never try this at all: being asked to install something that says
   it can read their data on every site.

   What it costs is automation. The extension re-syncs on its own every
   hour; this runs when it is clicked and not otherwise. So the two are
   not rivals — this is the way in, and the extension is for whoever
   decides they want it kept up to date without thinking about it.

   Why it has to run here rather than on sottracker.fr: Rare's session
   cookie is SameSite, so a request made from anywhere else counts as
   cross-site and the browser withholds it. From inside this page the
   request is same-origin and the cookie is attached exactly as it is
   for the page itself.

   This script only reads. The cookie is never read, copied or sent —
   the browser attaches it and we never see its value. Nothing outside
   seaofthieves.com is touched, and only the game stats are sent on.
   ============================================================ */

(function () {
  'use strict';

  var API = (window.__SOT_API || 'https://sot-tracker-api-8vqc.onrender.com')
    .replace(/\/+$/, '');
  var SITE = 'https://sottracker.fr';
  var KEY_STORAGE = 'sot-tracker-key';

  /* Clicking the bookmark twice should not start a second import on top of
     the first — both would POST, and the second would race the first. */
  if (window.__sotImportRunning) return;
  window.__sotImportRunning = true;
  var done = function () { window.__sotImportRunning = false; };

  if (!/(^|\.)seaofthieves\.com$/.test(location.hostname)) {
    alert('Open seaofthieves.com and sign in first, then click the bookmark from there.');
    done();
    return;
  }

  /* ---------------- the overlay ---------------- */

  var box, msg, sub, bar;

  function ui() {
    var wrap = document.createElement('div');
    wrap.id = 'sot-import-overlay';
    wrap.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483647',
      'background:rgba(6,10,15,.82)', 'display:flex',
      'align-items:center', 'justify-content:center',
      'font-family:system-ui,Segoe UI,Roboto,sans-serif'
    ].join(';');

    box = document.createElement('div');
    box.style.cssText = [
      'background:#0f1923', 'color:#e8e8ee', 'border:1px solid #26323f',
      'border-radius:14px', 'padding:26px 28px', 'width:min(420px,92vw)',
      'box-shadow:0 20px 60px rgba(0,0,0,.55)', 'text-align:center'
    ].join(';');

    var h = document.createElement('div');
    h.textContent = 'SotTracker';
    h.style.cssText = 'font-weight:700;letter-spacing:.08em;color:#ff4655;font-size:13px;margin-bottom:14px';

    msg = document.createElement('div');
    msg.style.cssText = 'font-size:16px;line-height:1.45;margin-bottom:8px';
    msg.textContent = 'Reading your profile…';

    sub = document.createElement('div');
    sub.style.cssText = 'font-size:13px;line-height:1.5;color:#8fa0b3;min-height:19px';

    var track = document.createElement('div');
    track.style.cssText = 'height:4px;background:#1b2733;border-radius:3px;margin-top:18px;overflow:hidden';
    bar = document.createElement('div');
    bar.style.cssText = 'height:100%;width:8%;background:#ff4655;border-radius:3px;transition:width .35s ease';
    track.appendChild(bar);

    box.appendChild(h);
    box.appendChild(msg);
    box.appendChild(sub);
    box.appendChild(track);
    wrap.appendChild(box);
    document.body.appendChild(wrap);
    return wrap;
  }

  var overlay = ui();

  function step(pct, main, detail) {
    if (bar) bar.style.width = pct + '%';
    if (main != null) msg.textContent = main;
    if (detail != null) sub.textContent = detail;
  }

  function finish(title, detail, link, isError) {
    step(100, title, detail || '');
    if (bar) bar.style.background = isError ? '#c9414d' : '#3fb950';

    if (link) {
      var a = document.createElement('a');
      a.href = link;
      a.textContent = 'Open my profile';
      a.target = '_blank';
      a.rel = 'noopener';
      a.style.cssText = [
        'display:inline-block', 'margin-top:18px', 'padding:10px 20px',
        'background:#ff4655', 'color:#fff', 'border-radius:8px',
        'text-decoration:none', 'font-weight:600', 'font-size:14px'
      ].join(';');
      box.appendChild(a);
    }

    var close = document.createElement('button');
    close.textContent = 'Close';
    close.style.cssText = [
      'display:block', 'margin:14px auto 0', 'padding:7px 16px',
      'background:transparent', 'color:#8fa0b3', 'border:1px solid #26323f',
      'border-radius:8px', 'cursor:pointer', 'font-size:13px'
    ].join(';');
    close.onclick = function () { overlay.remove(); done(); };
    box.appendChild(close);
  }

  /* ---------------- reading Rare's endpoints ---------------- */

  /* The site calls these under its locale prefix (/fr/api/profilev2/...).
     The unprefixed form answers too, so try the locale first and keep the
     bare path as a fallback. Identical to the extension's content script,
     deliberately: two copies that drift apart would mean the bookmarklet
     and the extension quietly collect different things. */
  var LOCALE = (location.pathname.match(/^\/([a-z]{2}(?:-[a-z]{2})?)\//) || [])[1] || '';
  function p(path) { return LOCALE ? ['/' + LOCALE + path, path] : [path]; }

  var ENDPOINTS = {
    overview:   p('/api/profilev2/overview').concat(['/api/profilev2/summary']),
    reputation: p('/api/profilev2/reputation'),
    ledger:     p('/api/profilev2/balance').concat(['/api/profilev2/ledger'])
  };

  var FETCH_TIMEOUT_MS = 8000;

  function getJSON(path) {
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, FETCH_TIMEOUT_MS);

    return fetch(path, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json, text/plain, */*' },
      signal: ctl.signal
    }).then(function (res) {
      /* Rare bounces signed-out requests to an identity provider. That lands
         as a redirect off this origin, which reads as a network failure
         rather than the "please sign in" it actually is. */
      if (res.redirected && !/^https:\/\/www\.seaofthieves\.com\//.test(res.url)) {
        return { error: 'signed_out' };
      }
      if (res.status === 401 || res.status === 403) return { error: 'signed_out' };
      if (res.status === 429) return { error: 'rate_limited' };
      if (!res.ok) return { error: 'http_' + res.status };

      return res.text().then(function (text) {
        // The login page is HTML, and arrives with a 200.
        if (/^\s*</.test(text)) return { error: 'signed_out' };
        try { return { data: JSON.parse(text) }; }
        catch (e) { return { error: 'not_json' }; }
      });
    }).catch(function (e) {
      return { error: e && e.name === 'AbortError' ? 'timeout' : 'network' };
    }).then(function (r) {
      clearTimeout(timer);
      return r;
    });
  }

  /* One group at a time, first path that answers wins. Sequential on
     purpose: this is not a public API, so it does not get hammered. */
  function firstThatWorks(paths) {
    var signedOut = false;
    return paths.reduce(function (chain, path) {
      return chain.then(function (acc) {
        if (acc && acc.data !== undefined) return acc;
        return getJSON(path).then(function (r) {
          if (r.data !== undefined) return { data: r.data, path: path };
          if (r.error === 'signed_out') signedOut = true;
          return null;
        });
      });
    }, Promise.resolve(null)).then(function (hit) {
      return hit || { signedOut: signedOut };
    });
  }

  /* The gamertag is in none of the three payloads, but the page displays
     it. Text only: no ids, nothing from the session. */
  function pageMeta() {
    var out = { title: document.title || '', path: location.pathname };
    try {
      var el = document.querySelector(
        '[class*="gamertag" i], [class*="playerName" i], [data-gamertag], .profile-name, h1');
      var text = el && el.textContent ? el.textContent.trim() : '';
      if (text && text.length <= 40) out.name = text;
    } catch (e) { /* the title alone is enough to work with */ }
    return out;
  }

  /* ---------------- the account key ---------------- */

  /* Which pirate this browser publishes as. The server only ever sees its
     hash, so this value staying here is the whole security model: whoever
     holds it owns that pirate's entry, and nobody else can overwrite it.

     Kept in this origin's localStorage because that is the only storage a
     bookmarklet has — it cannot reach sottracker.fr's. Clearing site data
     for seaofthieves.com loses it, which is why it is shown at the end for
     anyone who wants to keep a copy. */
  function accountKey() {
    var k = null;
    try { k = localStorage.getItem(KEY_STORAGE); } catch (e) { /* private mode */ }
    if (k) return k;

    var bytes = new Uint8Array(24);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    k = Array.prototype.map.call(bytes, function (b) {
      return ('0' + b.toString(16)).slice(-2);
    }).join('');

    try { localStorage.setItem(KEY_STORAGE, k); } catch (e) { /* not fatal */ }
    return k;
  }

  /* ---------------- run ---------------- */

  var GROUPS = Object.keys(ENDPOINTS);
  var LABEL = { overview: 'seasons and achievements', reputation: 'reputation', ledger: 'gold and doubloons' };

  var payloads = {};
  var probes = {};
  var signedOut = false;

  GROUPS.reduce(function (chain, name, i) {
    return chain.then(function () {
      step(10 + Math.round((i / GROUPS.length) * 55), null, 'Reading ' + (LABEL[name] || name) + '…');
      return firstThatWorks(ENDPOINTS[name]).then(function (r) {
        if (r && r.data !== undefined) { payloads[name] = r.data; probes[name] = r.path; }
        else { probes[name] = 'failed'; if (r && r.signedOut) signedOut = true; }
      });
    });
  }, Promise.resolve()).then(function () {

    if (!Object.keys(payloads).length) {
      if (signedOut) {
        return finish('You are not signed in',
          'Sign in on seaofthieves.com, open your profile overview, then click the bookmark again.',
          null, true);
      }
      return finish('Nothing answered',
        'Rare returned no data. Make sure you are on your profile overview page and try again.',
        null, true);
    }

    var meta = pageMeta();
    var handle = meta.name || null;
    payloads.page = meta;

    step(75, 'Sending your stats…', handle ? 'Publishing as ' + handle : '');

    var key = accountKey();

    return fetch(API + '/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Account-Key': key },
      body: JSON.stringify({
        handle: handle,
        collectedAt: new Date().toISOString(),
        source: 'bookmarklet',
        payloads: payloads,
        probes: probes,
        accountKey: key
      })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        return { status: res.status, body: body };
      });
    }).then(function (r) {
      if (r.status === 200 && r.body && r.body.ok) {
        var name = r.body.handle || handle;
        finish('Imported',
          name ? name + ' is up to date on SotTracker.' : 'Your stats are up to date.',
          SITE + '/profile?player=' + encodeURIComponent(name || ''));
        showKey(key);
        return;
      }

      /* The one failure worth explaining properly: this pirate already
         belongs to a different key. That is the protection working, not a
         bug — but it looks like a bug unless it says so. */
      if (r.status === 409) {
        return finish('That pirate is already taken',
          'Another browser already publishes ' + (handle || 'this pirate') +
          '. If that was you, run this from that browser, or paste its account key here first.',
          null, true);
      }

      var err = (r.body && r.body.error) || {};
      finish('Could not send', err.message || ('The server answered ' + r.status), null, true);
    }).catch(function (e) {
      finish('Could not reach SotTracker',
        'The API did not answer. It sleeps when unused and can take up to a minute to wake — try again shortly.',
        null, true);
    });

  }).catch(function (e) {
    finish('Something went wrong', (e && e.message) || String(e), null, true);
  });

  /* The key is shown once, folded away, for anyone who wants to keep it or
     move to another browser. Never sent anywhere but the sync request. */
  function showKey(key) {
    var wrap = document.createElement('details');
    wrap.style.cssText = 'margin-top:16px;text-align:left;font-size:12px;color:#8fa0b3';

    var head = document.createElement('summary');
    head.textContent = 'Your account key';
    head.style.cssText = 'cursor:pointer;outline:none';

    var body = document.createElement('div');
    body.style.cssText = 'margin-top:8px;line-height:1.5';
    body.textContent = 'Keep this if you want to publish the same pirate from another browser. ' +
      'Anyone who has it can update your entry, so do not post it anywhere.';

    var code = document.createElement('input');
    code.readOnly = true;
    code.value = key;
    code.onclick = function () { code.select(); };
    code.style.cssText = [
      'width:100%', 'margin-top:8px', 'padding:7px 9px', 'font-family:monospace',
      'font-size:12px', 'background:#0a121a', 'color:#e8e8ee',
      'border:1px solid #26323f', 'border-radius:6px', 'box-sizing:border-box'
    ].join(';');

    wrap.appendChild(head);
    wrap.appendChild(body);
    wrap.appendChild(code);
    box.appendChild(wrap);
  }
})();
