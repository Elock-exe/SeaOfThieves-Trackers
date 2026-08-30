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

  /* Two checks, not one.

     The host test alone passed on support.seaofthieves.com — a subdomain,
     so it matched — and every profile path 404'd from there, because a
     relative fetch resolves against the page you are standing on. Someone
     clicked the bookmark while reading their own support ticket and got
     five dead ends and no idea why.

     So the host has to be the www one, and the path has to be a profile
     page. Anything else is refused with the address to go to, rather than
     being allowed to fail five requests later. */
  var ON_SITE = /^(www\.)?seaofthieves\.com$/.test(location.hostname);
  var ON_PROFILE = location.pathname.indexOf('/profile') !== -1;
  var PROFILE_URL = 'https://www.seaofthieves.com/profile/overview';

  /* Not an alert, and not a refusal. A relative fetch resolves against the
     page you are standing on, so the profile endpoints only answer from the
     profile page — that is a browser rule, not a choice. But being told to
     go somewhere is worse than being taken there, so this offers the trip. */
  if (!ON_SITE || !ON_PROFILE) {
    wrongPage();
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

  /* Reached before the main overlay exists, so it builds its own. A function
     declaration, so the guard above can call it before this line is read. */
  function wrongPage() {
    var wrap = ui();
    msg.textContent = 'Wrong page';
    sub.textContent = 'This only works from your Sea of Thieves profile, because that ' +
      'is the only page allowed to read your stats.';
    if (bar) { bar.style.width = '100%'; bar.style.background = '#d8a13a'; }

    var go = document.createElement('button');
    go.textContent = 'Take me there';
    go.style.cssText = 'display:block;margin:18px auto 0;padding:10px 24px;' +
      'background:#ff4655;color:#fff;border:0;border-radius:8px;font-weight:600;' +
      'font-size:14px;cursor:pointer';
    go.onclick = function () { location.href = PROFILE_URL; };

    var note = document.createElement('div');
    note.textContent = 'Then click the bookmark once more.';
    note.style.cssText = 'font-size:12px;color:#8fa0b3;margin-top:10px';

    var close = document.createElement('button');
    close.textContent = 'Close';
    close.style.cssText = 'display:block;margin:14px auto 0;padding:7px 16px;' +
      'background:transparent;color:#8fa0b3;border:1px solid #26323f;' +
      'border-radius:8px;cursor:pointer;font-size:13px';
    close.onclick = function () { wrap.remove(); done(); };

    box.appendChild(go);
    box.appendChild(note);
    box.appendChild(close);
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
    var tried = [];
    return paths.reduce(function (chain, path) {
      return chain.then(function (acc) {
        if (acc && acc.data !== undefined) return acc;
        return getJSON(path).then(function (r) {
          if (r.data !== undefined) return { data: r.data, path: path };
          tried.push(path + ' -> ' + r.error);
          if (r.error === 'signed_out') signedOut = true;
          return null;
        });
      });
    }, Promise.resolve(null)).then(function (hit) {
      return hit || { signedOut: signedOut, tried: tried };
    });
  }

  /* When the guessed paths all miss, the page itself is the authority: it
     has already called the real ones, and the browser kept a list. Reading
     its own resource timings turns "which endpoint is it now?" from
     guesswork into observation — and Rare can rename these whenever they
     like without telling anybody.

     This is lifted from the extension's content script, which has had it
     from the start. Leaving it out of the importer is why a failure here
     was a dead end rather than a diagnosis. */
  function discover() {
    try {
      var seen = performance.getEntriesByType('resource')
        .map(function (e) { return e.name; })
        .filter(function (n) { return n.indexOf('/api/') !== -1; })
        .map(function (n) { try { return new URL(n).pathname; } catch (e) { return n; } });
      return seen.filter(function (v, i) { return seen.indexOf(v) === i; }).slice(0, 40);
    } catch (e) {
      return [];
    }
  }

  /* The gamertag is in none of the three payloads, so it has to come off
     the page — and guessing it was wrong.

     The old selector ended in a bare `h1`, and on Rare's profile the first
     h1 is a news heading, not a pirate. People were publishing their stats
     under "Dernieres publications".

     The extension never had this problem because it never guesses: its
     popup asks for the pirate name once and reuses it (background.js,
     saved.handle). The bookmarklet has no popup, so it asks here instead —
     once, then remembers. A suggestion is still offered, but nothing is
     published on the strength of it alone. */
  var NAME_STORAGE = 'sot-tracker-handle';

  function storedHandle() {
    try { return localStorage.getItem(NAME_STORAGE) || ''; } catch (e) { return ''; }
  }

  function rememberHandle(name) {
    try { localStorage.setItem(NAME_STORAGE, name); } catch (e) { /* private mode */ }
  }

  /* Only the places a gamertag actually lives. No `h1` fallback: a wrong
     suggestion is worse than none, because it is the one people accept
     without reading. */
  function suggestName() {
    var picks = ['[data-gamertag]', '[class*="gamertag" i]', '[class*="playerName" i]', '.profile-name'];
    for (var i = 0; i < picks.length; i++) {
      try {
        var el = document.querySelector(picks[i]);
        var text = el && el.textContent ? el.textContent.trim() : '';
        if (text && text.length <= 40) return text;
      } catch (e) { /* selector unsupported here, try the next */ }
    }
    return '';
  }

  function pageMeta(name) {
    return { title: document.title || '', path: location.pathname, name: name };
  }

  /* Asked once, then never again on this browser. The whole point is that
     nothing is published under a name nobody confirmed — one wrong guess
     claims a pirate entry that then has to be untangled by hand. */
  function askHandle(suggestion) {
    return new Promise(function (resolve) {
      step(70, 'Which pirate is this?', '');

      var form = document.createElement('div');
      form.style.cssText = 'margin-top:14px';

      var input = document.createElement('input');
      input.type = 'text';
      input.value = suggestion || '';
      input.placeholder = 'Your pirate name';
      input.maxLength = 40;
      input.autocomplete = 'off';
      input.style.cssText = 'width:100%;padding:11px 12px;font-size:15px;text-align:center;' +
        'background:#0a121a;color:#e8e8ee;border:1px solid #2c3f52;border-radius:8px;' +
        'box-sizing:border-box;outline:none';

      var note = document.createElement('div');
      note.textContent = 'Exactly as it appears in game, suffix included.';
      note.style.cssText = 'font-size:12px;color:#8fa0b3;margin-top:8px';

      var go = document.createElement('button');
      go.textContent = 'Publish';
      go.style.cssText = 'margin-top:14px;padding:10px 26px;background:#ff4655;color:#fff;' +
        'border:0;border-radius:8px;font-weight:600;font-size:14px;cursor:pointer';

      function submit() {
        var v = input.value.trim();
        if (!v) { input.style.borderColor = '#ff4655'; input.focus(); return; }
        rememberHandle(v);
        form.remove();
        resolve(v);
      }

      go.onclick = submit;
      input.onkeydown = function (e) { if (e.key === 'Enter') submit(); };

      form.appendChild(input);
      form.appendChild(note);
      form.appendChild(go);
      box.appendChild(form);
      input.focus();
      input.select();
    });
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

  var tried = [];

  function collectGroup(name, paths, pct) {
    step(pct, null, 'Reading ' + (LABEL[name] || name) + '…');
    return firstThatWorks(paths).then(function (r) {
      if (r && r.data !== undefined) { payloads[name] = r.data; probes[name] = r.path; return true; }
      probes[name] = 'failed';
      if (r && r.signedOut) signedOut = true;
      if (r && r.tried) tried = tried.concat(r.tried);
      return false;
    });
  }

  GROUPS.reduce(function (chain, name, i) {
    return chain.then(function () {
      return collectGroup(name, ENDPOINTS[name], 10 + Math.round((i / GROUPS.length) * 45));
    });
  }, Promise.resolve()).then(function () {

    /* Nothing from the paths we guessed. Before giving up, ask the page
       which ones IT called — those are the real ones by definition. Rare
       renames these without notice, and a guessed list is only ever right
       until they do. */
    if (Object.keys(payloads).length || signedOut) return null;

    /* 'profile' alone: every candidate path contains it, and a pattern
       with no escapes cannot be broken by one. */
    var real = discover().filter(function (p) { return /profile/i.test(p); });
    if (!real.length) return null;

    step(58, null, 'Trying other paths…');

    return GROUPS.reduce(function (chain, name) {
      return chain.then(function () {
        if (payloads[name]) return null;
        /* Match a discovered path to the group by name: the overview call
           contains 'overview', and so on. Anything unmatched is left alone
           rather than posted to a group it does not belong to. */
        var hint = { overview: /overview|summary/i, reputation: /reputation/i, ledger: /balance|ledger/i }[name];
        var candidates = real.filter(function (p) { return hint.test(p); });
        if (!candidates.length) return null;
        return collectGroup(name, candidates, 62);
      });
    }, Promise.resolve());

  }).then(function () {

    if (!Object.keys(payloads).length) {
      if (signedOut) {
        return finish('You are not signed in',
          'Sign in, open your profile, and click the bookmark again.',
          null, true);
      }
      finish('Nothing answered',
        'You are signed in, but Rare returned nothing.',
        null, true);
      showDiagnosis(tried, discover());
      return null;
    }

    /* Known already? Then straight through — asking every time would make
       a one-click tool a two-click one for no gain. */
    var known = storedHandle();
    var ask = known ? Promise.resolve(known) : askHandle(suggestName());

    return ask.then(function (handle) {
      payloads.page = pageMeta(handle);
      step(80, 'Sending…', handle);
      return send(handle);
    });
  }).catch(function (e) {
    finish('Something went wrong', (e && e.message) || String(e), null, true);
  });

  function send(handle) {

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
          name ? name + ' is up to date.' : 'Your stats are up to date.',
          SITE + '/profile?player=' + encodeURIComponent(name || ''));
        showKey(key);
        return;
      }

      /* The one failure worth explaining properly: this pirate already
         belongs to a different key. That is the protection working, not a
         bug — but it looks like a bug unless it says so. */
      if (r.status === 409) {
        return finish('That pirate is already taken',
          'Another browser already publishes ' + (handle || 'this pirate') + '.',
          null, true);
      }

      var err = (r.body && r.body.error) || {};
      finish('Could not send', err.message || ('The server answered ' + r.status), null, true);
    }).catch(function (e) {
      finish('Could not reach SotTracker',
        'The server may be waking up. Try again in a minute.',
        null, true);
    });
  }

  /* Folded shut on purpose. Somebody whose import failed wants to know what
     to do next, not read a list of HTTP paths. But if the problem reaches
     us, that list is the only thing that makes it fixable — so it is here,
     one click away, with a button that copies it. */
  function showDiagnosis(tried, seen) {
    var lines = []
      .concat(tried.length ? ['Tried:'] : [], tried)
      .concat(seen.length ? ['', 'This page called:'] : [], seen.slice(0, 20));
    if (!lines.length) return;

    var wrap = document.createElement('details');
    wrap.style.cssText = 'margin-top:16px;text-align:left;font-size:12px;color:#8fa0b3';

    var head = document.createElement('summary');
    head.textContent = 'Details';
    head.style.cssText = 'cursor:pointer;outline:none';

    var pre = document.createElement('textarea');
    pre.readOnly = true;
    var NL = String.fromCharCode(10);
    pre.value = location.pathname + NL + NL + lines.join(NL);
    pre.rows = 8;
    pre.onclick = function () { pre.select(); };
    pre.style.cssText = 'width:100%;margin-top:8px;padding:8px;font-family:monospace;' +
      'font-size:11px;background:#0a121a;color:#e8e8ee;border:1px solid #26323f;' +
      'border-radius:6px;box-sizing:border-box;resize:vertical';

    wrap.appendChild(head);
    wrap.appendChild(pre);
    box.appendChild(wrap);
  }

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
    body.textContent = 'Needed to publish the same pirate from another browser. Do not share it.';

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
