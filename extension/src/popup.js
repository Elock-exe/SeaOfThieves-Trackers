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
const autoBox = document.getElementById('auto');
const autoDetail = document.getElementById('auto-detail');
const autoMins = document.getElementById('auto-mins');

const DEFAULT_TRACKER = 'https://sot-tracker-api-8vqc.onrender.com';
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

/* Builds nodes rather than parsing a string. Almost everything shown
   here started life on the Sea of Thieves page or in a server reply —
   pirate names, endpoint paths, error text — and the popup runs with the
   extension's privileges, including access to the stored account key. A
   gamertag containing markup would have been executed, not displayed.

   @param kind   '' | 'ok' | 'err'
   @param text   the message
   @param opts   { hints: string[], spinner: boolean }
*/
function show(kind, text, opts) {
  const o = opts || {};
  statusEl.hidden = false;
  statusEl.className = 'status ' + kind;
  statusEl.replaceChildren();

  if (o.spinner) {
    const spin = document.createElement('span');
    spin.className = 'spin';
    statusEl.appendChild(spin);
  }

  statusEl.appendChild(document.createTextNode(text));

  for (const hint of o.hints || []) {
    if (!hint) continue;
    const el = document.createElement('span');
    el.className = 'hint';
    el.textContent = hint;          // textContent, never innerHTML
    statusEl.appendChild(el);
  }
}

/** One "label: value" row for the Advanced panel. */
function probeRow(label, value, bad) {
  const row = document.createElement('div');
  row.className = 'probe-row';

  const k = document.createElement('span');
  k.className = 'k';
  k.textContent = label;

  const v = document.createElement('span');
  v.className = 'v ' + (bad ? 'bad' : 'ok');
  v.textContent = value;

  row.append(k, v);
  return row;
}

function renderProbes(probes, phases, tried) {
  const rows = [];

  if (probes) {
    for (const [k, v] of Object.entries(probes)) {
      rows.push(probeRow(k, String(v), v === 'failed' || v === 'timeout'));
    }
  }

  /* Timings say which step is slow. Without them a timeout is just a number. */
  if (phases) {
    for (const [k, v] of Object.entries(phases)) {
      rows.push(probeRow('\u23F1 ' + k, String(v), parseInt(v, 10) > 5000));
    }
  }

  if (tried && tried.length) {
    rows.push(probeRow('tried', tried.join(', '), true));
  }

  if (rows.length) probesEl.replaceChildren(...rows);
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
      show('err', 'Permission declined', { hints: ["The extension can't read your profile without it."] });
    }
  } catch (e) {
    show('err', 'Could not request permission', { hints: [e.message] });
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

/* The worker owns the schedule — it is the only place that can arm an alarm,
   and having the popup write the setting itself would let the two disagree
   whenever the popup was closed before the worker read it. */
async function pushAutoSync() {
  const enabled = autoBox.checked;
  const minutes = Number(autoMins.value) || 30;
  autoDetail.hidden = !enabled;

  try {
    const res = await api.runtime.sendMessage({ type: 'setAutoSync', enabled, minutes });
    if (res && res.enabled) {
      show('ok', `Automatic sync on — every ${res.minutes} minutes.`);
    } else {
      show('', 'Automatic sync off. Use the button whenever you want an update.');
    }
  } catch (e) {
    show('err', 'Could not save the schedule', { hints: [e.message] });
  }
}

async function initAutoSync() {
  try {
    const s = await api.runtime.sendMessage({ type: 'getAutoSync' });
    if (!s) return;
    autoBox.checked = Boolean(s.enabled);
    // A stored interval the dropdown doesn't offer would silently reset to
    // its first option, so put it back only when it is one of the choices.
    if ([...autoMins.options].some((o) => Number(o.value) === Number(s.minutes))) {
      autoMins.value = String(s.minutes);
    }
    autoDetail.hidden = !s.enabled;
  } catch (e) {
    /* An older worker without the handler simply leaves the box unchecked. */
  }
}

autoBox.addEventListener('change', pushAutoSync);
autoMins.addEventListener('change', () => { if (autoBox.checked) pushAutoSync(); });

async function init() {
  await initAutoSync();
  const stored = await api.storage.local.get(
    ['trackerBase', 'lastSync', 'lastAttempt', 'pirateHandle']);
  trackerInput.value = stored.trackerBase || DEFAULT_TRACKER;
  pirateInput.value = stored.pirateHandle || '';

  await refreshGrantUI();

  const healed = await healTrackerBase(trackerInput.value);
  trackerInput.value = healed.base;
  if (healed.corrected) {
    show('ok', 'Tracker address fixed',
      { hints: [healed.corrected + ' has no API — now using ' + healed.base + '.'] });
  }

  /* A failed run that is newer than the last success is the thing worth
     saying. Showing "last synced <old date>" on its own is how an hourly
     sync could break and still look healthy for a day. */
  const attempt = stored.lastAttempt;
  const failedSince = attempt && !attempt.ok &&
    (!stored.lastSync || attempt.at > stored.lastSync.at);

  if (failedSince && !healed.corrected) {
    const when = new Date(attempt.at).toLocaleString();
    show('err', 'Automatic sync is failing — last tried ' + when, {
      hints: [
        attempt.message || '',
        HINTS[attempt.code] || HINTS.unknown,
        stored.lastSync
          ? 'Stats on the tracker are from ' + new Date(stored.lastSync.at).toLocaleString() + '.'
          : ''
      ]
    });
    if (stored.lastSync) renderProbes(stored.lastSync.probes, stored.lastSync.phases);
  } else if (stored.lastSync) {
    // Don't clobber the correction notice — it is the more useful message.
    if (!healed.corrected) {
      const when = new Date(stored.lastSync.at).toLocaleString();
      show('', 'Last synced ' + when + (stored.lastSync.handle ? ' — ' + stored.lastSync.handle : ''));
    }
    renderProbes(stored.lastSync.probes, stored.lastSync.phases);
  }
}

btn.addEventListener('click', async () => {
  if (!(await refreshGrantUI())) {
    show('err', 'Permission needed', { hints: [HINTS.no_permission] });
    return;
  }

  btn.disabled = true;
  show('', 'Syncing…', { spinner: true });

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
      show('err', 'No reply from the extension', { hints: ['Reload the extension and try again.'] });
      return;
    }

    if (res.ok) {
      /* If the configured address was wrong, say so plainly rather than
         quietly using a different one. */
      const hints = res.corrected
        ? [res.corrected + ' had no API — switched to ' + res.base + ' and saved it.']
        : [];
      show('ok', 'Synced' + (res.handle ? ' — ' + res.handle : '') + '.', { hints });
      if (res.base) trackerInput.value = res.base;
      renderProbes(res.probes, res.phases, res.tried);
    } else if (res.code === 'post_blocked' && res.pending && res.base) {
      /* The worker read the stats but could not post them. This page is a
         document, not a service worker, so the same request may well go
         through from here. Retry before calling it a failure. */
      show('', 'Worker POST refused — retrying from the popup…', { spinner: true });
      try {
        const r = await fetch(res.base + '/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: JSON.stringify(res.pending)
        });
        const body = await r.json().catch(() => ({}));
        if (r.ok) {
          show('ok', 'Synced' + (body.handle ? ' — ' + body.handle : '') + '.',
            { hints: ["The worker's POST was blocked; sent from the popup instead."] });
          await api.storage.local.set({
            lastSync: { at: new Date().toISOString(), handle: body.handle || null, probes: res.probes, phases: res.phases }
          });
        } else {
          show('err', 'Tracker refused the data (HTTP ' + r.status + ')',
            { hints: [(body.error && body.error.message) || ''] });
        }
      } catch (e) {
        show('err', res.message,
          { hints: ['The popup could not post either: ' + e.message, 'code: post_blocked'] });
      }
      renderProbes(res.probes, res.phases, res.tried);
    } else {
      const code = res.code || 'unknown';
      show('err', res.message || 'Sync failed',
        { hints: [HINTS[code] || HINTS.unknown, 'code: ' + code] });
      if (res.probes || res.phases || res.tried) renderProbes(res.probes, res.phases, res.tried);
    }
  } catch (e) {
    show('err', 'Sync failed', { hints: [e.message] });
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
        /* Only the origins in the manifest can be granted. A published
           add-on that asked for every HTTPS site to support self-hosting
           would be answering a reviewer's first question badly, so the
           list is explicit and a custom address says so plainly. */
        const granted = await api.permissions.request({ origins: [origin] }).catch(() => false);
        if (!granted) {
          show('err', 'This build cannot reach that address', {
            hints: ['It ships with access to the official tracker only. ' +
                    'Self-hosting? Add your origin to host_permissions in the manifest and reload.']
          });
          return;
        }
      }
    } catch (e) {
      show('err', 'That address could not be used', { hints: [e.message] });
      return;
    }
  }

  await api.storage.local.set({ trackerBase: value });

  // Saving an address that answers nothing costs a whole sync to discover.
  show('', 'Saved — checking it answers…', { spinner: true });
  try {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 3000);
    const res = await fetch(value + '/api/health', { signal: ctl.signal });
    if (res.ok) show('ok', 'Tracker address saved — API answered at ' + value + '.');
    else show('err', 'Saved, but ' + value + ' replied ' + res.status,
      { hints: ['The API listens on 8787.'] });
  } catch (e) {
    show('err', 'Saved, but nothing answered at ' + value,
      { hints: ['The API is on port 8787; 5501 is the static site, which has no /api routes.'] });
  }
});

init();
