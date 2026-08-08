(function () {
  'use strict';

  SOTUI.mount('');

  const stateEl = document.getElementById('link-state');
  const diagEl = document.getElementById('link-diagnose');

  function banner(kind, strongKey, bodyKey, extraHTML) {
    return `
      <div class="demo-banner ${kind}">
        ${kind === 'live-banner'
          ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>'
          : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>'}
        <div>
          <strong>${I18N.t(strongKey)}</strong> ${I18N.t(bodyKey)}
          ${extraHTML || ''}
        </div>
      </div>`;
  }

  async function paint() {
    const health = await SOT.apiHealth();

    if (!health) {
      stateEl.innerHTML = banner('', 'link.apiDownStrong', 'link.apiDownBody');
      return;
    }

    /* health.linked only reports the cookie pasted into .env. The extension
       is the other way in, and it was never consulted here — so a working
       sync still showed as "no account linked". */
    if (!health.linked) {
      const synced = await SOT.syncedIdentity();
      if (synced) {
        const me = SOT.normalizeSynced(synced.snapshot);
        const who = synced.handle ? ` — ${synced.handle}`
          : (SOT.syncedOwner() ? ` — ${SOT.syncedOwner()}` : '');
        stateEl.innerHTML = `
          <div class="demo-banner live-banner">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
            <div>
              <strong>Compte lié via l'extension${who}</strong>
              Or, rang Sablier et réputation synchronisés depuis ton navigateur — aucun cookie à copier.
              ${(synced.handle || SOT.syncedOwner()) ? '' : '<div class="link-detail">Cette synchronisation n\'a pas de gamertag. Ouvre ton profil et clique « C\'est mon pirate » pour la rattacher.</div>'}
              <div class="link-actions">
                <a class="btn-red" href="/profile?player=me">${I18N.t('link.viewProfile')}</a>
              </div>
            </div>
          </div>`;
        if (me.probes) renderProbes(me.probes);
        return;
      }

      stateEl.innerHTML = banner('', 'link.notLinkedStrong', 'link.notLinkedBody');
      return;
    }

    // A cookie is present — prove it actually works before claiming success.
    stateEl.innerHTML = `<div class="demo-banner"><span class="spinner spinner-sm"></span>
      <div>${I18N.t('link.checking')}</div></div>`;

    try {
      const me = await SOT.lookupLinked();
      stateEl.innerHTML = banner(
        'live-banner', 'link.okStrong', 'link.okBody',
        `<div class="link-actions">
           <a class="btn-red" href="/profile?player=me">${I18N.t('link.viewProfile')}</a>
         </div>`
      );
      if (me.probes) renderProbes(me.probes);
    } catch (err) {
      const KEY = {
        auth_expired: 'link.expiredBody',
        not_linked: 'link.notLinkedBody',
        rate_limited: 'error.rateLimited'
      };
      stateEl.innerHTML = banner('', 'link.failStrong', KEY[err.code] || 'link.failBody',
        `<div class="link-detail">${err.message}</div>
         <div class="link-actions">
           <button class="btn-outline" id="run-diagnose">${I18N.t('link.diagnose')}</button>
         </div>`);
      const btn = document.getElementById('run-diagnose');
      if (btn) btn.addEventListener('click', runDiagnose);
    }
  }

  /* Which of Rare's undocumented endpoints still answer. Without this a
     moved endpoint just looks like an empty profile. */
  function renderProbes(probes) {
    const rows = Object.entries(probes).map(([name, path]) => `
      <div class="stat-row">
        <span class="stat-row-label">${name}</span>
        <span class="stat-row-value ${path === 'failed' ? 'probe-bad' : 'probe-ok'}">${path}</span>
      </div>`).join('');

    diagEl.style.display = 'block';
    diagEl.innerHTML = `
      <div class="panel">
        <div class="panel-head"><span>${I18N.t('link.endpoints')}</span></div>
        <div class="panel-body padded">${rows}</div>
      </div>`;
  }

  async function runDiagnose() {
    diagEl.style.display = 'block';
    diagEl.innerHTML = `<div class="panel"><div class="panel-body padded">${I18N.t('link.checking')}</div></div>`;
    try {
      const res = await fetch(SOT.API_BASE + '/api/me/diagnose', { cache: 'no-store' });
      const data = await res.json();
      const groups = Object.entries(data).map(([name, tries]) => `
        <div class="diag-group">
          <div class="diag-name">${name}</div>
          ${tries.map((t) => `
            <div class="stat-row">
              <span class="stat-row-label"><code>${t.path}</code></span>
              <span class="stat-row-value ${t.ok ? 'probe-ok' : 'probe-bad'}">
                ${t.ok ? (t.keys || []).slice(0, 6).join(', ') || 'ok' : t.code}
              </span>
            </div>`).join('')}
        </div>`).join('');
      diagEl.innerHTML = `
        <div class="panel">
          <div class="panel-head"><span>${I18N.t('link.endpoints')}</span></div>
          <div class="panel-body padded">${groups}</div>
        </div>`;
    } catch (e) {
      diagEl.innerHTML = `<div class="panel"><div class="panel-body padded">${I18N.t('error.apiDown')}</div></div>`;
    }
  }

  paint();
  document.addEventListener('sot:langchange', paint);
})();
