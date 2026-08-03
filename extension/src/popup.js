const api = typeof browser !== 'undefined' ? browser : chrome;

const btn = document.getElementById('sync');
const grantBtn = document.getElementById('grant');
const grantNote = document.getElementById('grant-note');
const statusEl = document.getElementById('status');
const probesEl = document.getElementById('probes');
const trackerInput = document.getElementById('tracker');
const saveBtn = document.getElementById('save-tracker');
const pirateInput = document.getElementById('pirate');
const savePirateBtn = document.getElementById('save-pirate');

const DEFAULT_TRACKER = 'https://sot-tracker-api-ssi7.onrender.com';
const SOT_ORIGIN = 'https://www.seaofthieves.com/*';

/* Every failure names the thing the user can actually do about it. */
const HINTS = {
  no_permission: 'Click "Allow access to seaofthieves.com" above, then sync again.',
  signed_out: 'Open seaofthieves.com and sign in, then sync again.',
  no_content_script: 'Reload the seaofthieves.com tab (F5), then sync again.',
  no_handle: 'Set your pirate name above, then sync again.',
  handle_taken: 'That pirate is already published by another install. Use your own name, or clear the extension data if this is you.',
  no_account_key: 'The extension could not identify itself. Reload it on chrome://extensions.',
  no_reply: 'Reload the seaofthieves.com tab and try again.',
  timeout: 'Sync ran too long and was stopped. Try again; if it repeats, check the service worker console.',
  popup_timeout: 'The extension never answered. Reload it on chrome://extensions, then sync again.',
  tab_closed: 'Keep the Sea of Thieves tab open while syncing.',
  tracker_down: 'Check the API is running (npm start). The reason in brackets says what fetch hit.',
  post_blocked: 'The server is up — something is blocking the POST specifically. Check the service worker console for the net:: error.',
  rate_limited: 'Too many requests. Wait a minute and try again.',
  no_data: "Rare's API answered nothing. Open Advanced and send me the endpoint list.",
  missing: 'That endpoint is gone — the tracker needs updating.',
  upstream: 'Sea of Thieves returned an unexpected response.',
  credential_in_payload: 'The tracker refused the payload. This is a bug — tell me.',
  unknown: 'Open Advanced for details, or check the extension console.'
};

function show(kind, html) {
  statusEl.hidden = false;
  statusEl.className = 'status ' + kind;
  statusEl.innerHTML = html;
}

function renderProbes(probes, phases) {
  const rows = [];

  if (probes) {
    rows.push(...Object.entries(probes).map(([k, v]) => `
      <div class="probe-row">
        <span class="k">${k}</span>
        <span class="v ${v === 'failed' ? 'bad' : 'ok'}">${v}</span>
      </div>`));
  }

  /* Timings say which step is slow. Without them a timeout is just a number. */
  if (phases) {
    rows.push(...Object.entries(phases).map(([k, v]) => `
      <div class="probe-row">
        <span class="k">⏱ ${k}</span>
        <span class="v ${parseInt(v, 10) > 5000 ? 'bad' : 'ok'}">${v}</span>
      </div>`));
  }

  if (rows.length) probesEl.innerHTML = rows.join('');
}

/* Firefox MV3 hands out host permissions only on request, and the request
   must come from a click. Chromium grants them at install time, so this
   simply reports true there. */
/* Both origins are needed for a sync to complete: the game site to read
   the stats, and the tracker to publish them. Checking only the first
   passed the button as ready on Firefox and then failed at the last
   step, with the collected stats already in hand. */
async function requiredOrigins() {
  const stored = await api.storage.local.get('trackerBase');
  const base = (stored && stored.trackerBase) || DEFAULT_TRACKER;
  const origins = [SOT_ORIGIN];
  try {
    if (/^https:\/\//.test(base)) origins.push(new URL(base).origin + '/*');
  } catch (e) { /* a malformed address is reported when saving */ }
  return origins;
}

async function hasSiteAccess() {
  try {
    return await api.permissions.contains({ origins: await requiredOrigins() });
  } catch (e) {
    return true; // no permissions API — assume install-time grant
  }
}

async function refreshGrantUI() {
  const granted = await hasSiteAccess();
  grantBtn.hidden = granted;
  grantNote.hidden = granted;
  btn.disabled = !granted;
  return granted;
}

grantBtn.addEventListener('click', async () => {
  try {
    const ok = await api.permissions.request({ origins: await requiredOrigins() });
    if (ok) {
      show('ok', 'Access granted. You can sync now.');
      await refreshGrantUI();
    } else {
      show('err', 'Permission declined<span class="hint">The extension can\'t read your profile without it.</span>');
    }
  } catch (e) {
    show('err', `Could not request permission<span class="hint">${e.message}</span>`);
  }
});

async function probe(base) {
  try {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 2000);
    const res = await fetch(base + '/api/health', { signal: ctl.signal });
    return res.ok;
  } catch (e) {
    return false;
  }
}

/* Repair a wrong address on open rather than at push time. A bad port
   otherwise costs a full sync to discover: everything is read, then thrown
   away at the last step. */
async function healTrackerBase(configured) {
  if (await probe(configured)) return { base: configured, corrected: null };

  const onApiPort = configured.replace(/:\d+$/, '') + ':8787';
  for (const candidate of [onApiPort, DEFAULT_TRACKER]) {
    if (candidate === configured) continue;
    if (await probe(candidate)) {
      await api.storage.local.set({ trackerBase: candidate });
      return { base: candidate, corrected: configured };
    }
  }
  return { base: configured, corrected: null };
}

async function init() {
  const stored = await api.storage.local.get(['trackerBase', 'lastSync', 'pirateHandle']);
  trackerInput.value = stored.trackerBase || DEFAULT_TRACKER;
  pirateInput.value = stored.pirateHandle || '';

  await refreshGrantUI();

  const healed = await healTrackerBase(trackerInput.value);
  trackerInput.value = healed.base;
  if (healed.corrected) {
    show('ok', `Tracker address fixed<span class="hint">${healed.corrected} has no API — now using ${healed.base}.</span>`);
  }

  if (stored.lastSync) {
    // Don't clobber the correction notice — it is the more useful message.
    if (!healed.corrected) {
      const when = new Date(stored.lastSync.at).toLocaleString();
      show('', `Last synced ${when}${stored.lastSync.handle ? ' — ' + stored.lastSync.handle : ''}`);
    }
    renderProbes(stored.lastSync.probes, stored.lastSync.phases);
  }
}

btn.addEventListener('click', async () => {
  if (!(await refreshGrantUI())) {
    show('err', 'Permission needed<span class="hint">' + HINTS.no_permission + '</span>');
    return;
  }

  btn.disabled = true;
  show('', '<span class="spin"></span>Syncing…');

  try {
    /* Chrome can kill the service worker mid-sync, and then sendMessage
       settles never. Without this the spinner runs until the popup closes. */
    const res = await Promise.race([
      api.runtime.sendMessage({ type: 'sync' }),
      new Promise((resolve) => setTimeout(() => resolve({
        ok: false,
        code: 'popup_timeout',
        message: 'No answer from the extension after 160s'
      }), 160000))
    ]);

    // A missing reply means the background worker never answered — say so
    // rather than falling through to a vague "try again".
    if (res === undefined || res === null) {
      show('err', 'No reply from the extension<span class="hint">Reload the extension and try again.</span>');
      return;
    }

    if (res.ok) {
      /* If the configured address was wrong, say so plainly rather than
         quietly using a different one. */
      const note = res.corrected
        ? `<span class="hint">${res.corrected} had no API — switched to ${res.base} and saved it.</span>`
        : '';
      show('ok', `Synced${res.handle ? ' — ' + res.handle : ''}.${note}`);
      if (res.base) trackerInput.value = res.base;
      renderProbes(res.probes, res.phases);
      if (res.tried && res.tried.length) {
        probesEl.innerHTML += '<div class="probe-row"><span class="k">tried</span>' +
          '<span class="v bad">' + res.tried.join(', ') + '</span></div>';
      }
    } else if (res.code === 'post_blocked' && res.pending && res.base) {
      /* The worker read the stats but could not post them. This page is a
         document, not a service worker, so the same request may well go
         through from here. Retry before calling it a failure. */
      show('', '<span class="spin"></span>Worker POST refused — retrying from the popup…');
      try {
        const r = await fetch(res.base + '/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: JSON.stringify(res.pending)
        });
        const body = await r.json().catch(() => ({}));
        if (r.ok) {
          show('ok', `Synced${body.handle ? ' — ' + body.handle : ''}.` +
            '<span class="hint">The worker\'s POST was blocked; sent from the popup instead.</span>');
          await api.storage.local.set({
            lastSync: { at: new Date().toISOString(), handle: body.handle || null, probes: res.probes, phases: res.phases }
          });
        } else {
          show('err', `Tracker refused the data (HTTP ${r.status})` +
            `<span class="hint">${(body.error && body.error.message) || ''}</span>`);
        }
      } catch (e) {
        show('err', `${res.message}<span class="hint">The popup could not post either: ${e.message}</span>` +
          '<span class="hint">code: post_blocked</span>');
      }
      renderProbes(res.probes, res.phases);
      if (res.tried && res.tried.length) {
        probesEl.innerHTML += '<div class="probe-row"><span class="k">tried</span>' +
          '<span class="v bad">' + res.tried.join(', ') + '</span></div>';
      }
    } else {
      const code = res.code || 'unknown';
      show('err',
        `${res.message || 'Sync failed'}<span class="hint">${HINTS[code] || HINTS.unknown}</span>` +
        `<span class="hint">code: ${code}</span>`);
      if (res.probes || res.phases) renderProbes(res.probes, res.phases);
      if (res.tried && res.tried.length) {
        probesEl.innerHTML += '<div class="probe-row"><span class="k">tried</span>' +
          '<span class="v bad">' + res.tried.join(', ') + '</span></div>';
      }
    }
  } catch (e) {
    show('err', `Sync failed<span class="hint">${e.message}</span>`);
  } finally {
    btn.disabled = false;
  }
});

savePirateBtn.addEventListener('click', async () => {
  const value = pirateInput.value.trim();
  if (!value) {
    await api.storage.local.remove('pirateHandle');
    show('', 'Pirate name cleared — the page name will be used instead.');
    return;
  }
  await api.storage.local.set({ pirateHandle: value });
  show('ok', `Publishing as ${value}.`);
});

saveBtn.addEventListener('click', async () => {
  const value = (trackerInput.value.trim() || DEFAULT_TRACKER).replace(/\/+$/, '');

  /* A deployed tracker is on a domain the manifest cannot know in advance.
     Chrome only lets an extension reach it once its owner grants that
     origin — and the request has to come from a click, which is this one. */
  if (/^https:\/\//.test(value)) {
    try {
      const origin = new URL(value).origin + '/*';
      const already = await api.permissions.contains({ origins: [origin] });
      if (!already) {
        const granted = await api.permissions.request({ origins: [origin] });
        if (!granted) {
          show('err', 'Access to that address was declined' +
            '<span class="hint">The extension cannot publish stats there without it.</span>');
          return;
        }
      }
    } catch (e) {
      show('err', `That address could not be used<span class="hint">${e.message}</span>`);
      return;
    }
  }

  await api.storage.local.set({ trackerBase: value });

  // Saving an address that answers nothing costs a whole sync to discover.
  show('', '<span class="spin"></span>Saved — checking it answers…');
  try {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 3000);
    const res = await fetch(value + '/api/health', { signal: ctl.signal });
    if (res.ok) show('ok', `Tracker address saved — API answered at ${value}.`);
    else show('err', `Saved, but ${value} replied ${res.status}<span class="hint">The API listens on 8787.</span>`);
  } catch (e) {
    show('err', `Saved, but nothing answered at ${value}` +
      '<span class="hint">The API is on port 8787; 5501 is the static site, which has no /api routes.</span>');
  }
});

init();
