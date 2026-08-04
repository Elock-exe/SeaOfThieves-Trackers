/* ============================================================
   Leaderboards.

   This page used to rank the profiles this browser had looked up. The
   note at the top of the old file explained why: a real ranking needs a
   shared database and linked accounts, and neither existed.

   Both exist now. It reads /api/leaderboard, which ranks every published
   pirate on one number. The metric list comes from the API as well, so a
   ranking added on the server appears here without an edit.
   ============================================================ */
(function () {
  'use strict';

  SOTUI.mount('Leaderboards');

  const metricsEl = document.getElementById('lb-metrics');
  const stateEl = document.getElementById('lb-state');
  const podiumEl = document.getElementById('lb-podium');
  const tableWrap = document.getElementById('lb-table-wrap');
  const bodyEl = document.getElementById('lb-body');
  const headEl = document.getElementById('lb-metric-head');

  /* Grouping and decoration per metric: which crest sits beside a name,
     and which colour the board takes. A Reaper's Bones ranking should
     not look identical to a gold one. */
  const GROUPS = [
    {
      key: 'lb.group.currencies',
      fallback: 'Monnaies',
      metrics: {
        gold: { i18n: 'currency.gold', tone: 'gold' },
        doubloons: { i18n: 'currency.doubloons', tone: 'steel' },
        ancientCoins: { i18n: 'currency.ancientCoins', tone: 'violet' }
      }
    },
    {
      key: 'lb.group.hourglass',
      fallback: 'Sablier',
      metrics: {
        servants: { i18n: 'hourglass.servants', tone: 'red', crest: 'hourglass-servants' },
        guardians: { i18n: 'hourglass.guardians', tone: 'teal', crest: 'hourglass-guardians' }
      }
    },
    {
      key: 'lb.group.companies',
      fallback: 'Compagnies',
      metrics: {
        reapersBones: { i18n: 'company.reapersBones', tone: 'red', crest: 'company-reapersBones' },
        athenaFortune: { i18n: 'company.athenaFortune', tone: 'gold', crest: 'company-athenaFortune' },
        goldHoarders: { i18n: 'company.goldHoarders', tone: 'gold', crest: 'company-goldHoarders' },
        orderOfSouls: { i18n: 'company.orderOfSouls', tone: 'violet', crest: 'company-orderOfSouls' },
        merchantAlliance: { i18n: 'company.merchantAlliance', tone: 'teal', crest: 'company-merchantAlliance' },
        huntersCall: { i18n: 'company.huntersCall', tone: 'steel', crest: 'company-huntersCall' }
      }
    },
    {
      key: 'lb.group.collection',
      fallback: 'Collection',
      metrics: {
        emblems: { i18n: 'profile.emblems', tone: 'gold' },
        totalLevels: { i18n: 'profile.totalLevels', tone: 'steel' }
      }
    }
  ];

  function describe(metric) {
    for (const g of GROUPS) if (g.metrics[metric]) return g.metrics[metric];
    return {};
  }

  /* I18N.t returns the key itself when there is no translation, so a
     missing string would print "company.reapersBones" on the button. */
  function translate(key, fallback) {
    if (!key) return fallback;
    const t = I18N.t(key);
    return t && t !== key ? t : fallback;
  }

  function label(metric, fallback) {
    return translate(describe(metric).i18n, fallback);
  }

  const state = { metric: readMetric(), available: [] };

  function readMetric() {
    return new URLSearchParams(location.search).get('metric') || 'gold';
  }

  /* ---------- rendering ---------- */

  function crestImg(metric, cls) {
    const d = describe(metric);
    if (!d.crest) return null;
    const img = document.createElement('img');
    img.className = cls || 'lb-crest';
    img.alt = '';
    img.loading = 'lazy';
    img.src = 'assets/img/' + d.crest + '.png';
    img.addEventListener('error', () => img.remove());
    return img;
  }

  function pirateLink(handle, cls) {
    const link = document.createElement('a');
    if (cls) link.className = cls;
    link.href = 'profile.html?player=' + encodeURIComponent(handle);
    link.textContent = handle;      // textContent: a pirate name is user data
    return link;
  }

  /* The player's Xbox picture. It was in the API response all along and
     simply never rendered, which is why the board looked like a
     spreadsheet. Falls back to initials on a colour derived from the
     name, so a row is never a blank circle. */
  function avatar(entry, size) {
    const el = document.createElement('span');
    el.className = 'lb-avatar' + (size === 'lg' ? ' lb-avatar-lg' : '');

    if (entry.avatar) {
      const img = document.createElement('img');
      img.src = entry.avatar;
      img.alt = '';
      img.loading = 'lazy';
      // A dead image URL should leave initials, not a broken icon.
      img.addEventListener('error', () => {
        img.remove();
        el.style.background = SOT.avatarColor(entry.handle);
        el.textContent = SOT.initials(entry.handle);
      });
      el.appendChild(img);
    } else {
      el.style.background = SOT.avatarColor(entry.handle);
      el.textContent = SOT.initials(entry.handle);
    }
    return el;
  }

  function when(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? '—' : d.toLocaleDateString();
  }

  function renderPodium(entries) {
    podiumEl.replaceChildren();
    if (entries.length < 3) return;          // a podium of one is just a label

    const tone = describe(state.metric).tone || 'red';
    // Visual order second, first, third: the winner belongs in the middle.
    for (const i of [1, 0, 2]) {
      const e = entries[i];
      const card = document.createElement('div');
      card.className = 'podium-step podium-' + e.rank + ' tone-' + tone;

      const medal = document.createElement('div');
      medal.className = 'podium-medal';
      medal.textContent = e.rank;

      card.appendChild(avatar(e, 'lg'));

      const crest = crestImg(state.metric, 'podium-crest');
      if (crest) card.appendChild(crest);

      const value = document.createElement('div');
      value.className = 'podium-value';
      value.textContent = SOT.formatNumber(e.value);

      card.append(medal, pirateLink(e.handle, 'podium-name'), value);
      podiumEl.appendChild(card);
    }
  }

  function renderTable(entries) {
    bodyEl.replaceChildren();

    for (const e of entries) {
      const tr = document.createElement('tr');

      const rank = document.createElement('td');
      rank.className = 'lb-rank';
      if (e.rank <= 3) rank.classList.add('lb-rank-top');
      rank.textContent = e.rank;

      const who = document.createElement('td');
      const wrap = document.createElement('div');
      wrap.className = 'lb-pirate';
      wrap.appendChild(avatar(e));
      const crest = crestImg(state.metric);
      if (crest) wrap.appendChild(crest);
      wrap.appendChild(pirateLink(e.handle));
      who.appendChild(wrap);

      const val = document.createElement('td');
      val.className = 'lb-value';
      val.textContent = SOT.formatNumber(e.value);

      const upd = document.createElement('td');
      upd.className = 'lb-when';
      upd.textContent = when(e.capturedAt);

      tr.append(rank, who, val, upd);
      bodyEl.appendChild(tr);
    }
  }

  function setState(text, hint) {
    stateEl.replaceChildren();
    if (!text) { stateEl.hidden = true; return; }
    stateEl.hidden = false;

    const strong = document.createElement('strong');
    strong.textContent = text;
    stateEl.appendChild(strong);

    if (hint) {
      const p = document.createElement('p');
      p.textContent = hint;
      stateEl.appendChild(p);
    }
  }

  /* ---------- metric tabs ---------- */

  function renderMetrics() {
    metricsEl.replaceChildren();

    for (const group of GROUPS) {
      const keys = Object.keys(group.metrics).filter((k) => state.available.includes(k));
      if (!keys.length) continue;

      const box = document.createElement('div');
      box.className = 'lb-group';

      const title = document.createElement('div');
      title.className = 'lb-group-title';
      title.textContent = translate(group.key, group.fallback);
      box.appendChild(title);

      const row = document.createElement('div');
      row.className = 'lb-group-tabs';

      for (const key of keys) {
        const btn = document.createElement('button');
        btn.className = 'lb-tab tone-' + (group.metrics[key].tone || 'red');
        if (key === state.metric) btn.classList.add('is-active');
        btn.type = 'button';
        btn.dataset.metric = key;
        btn.textContent = label(key, key);
        btn.addEventListener('click', () => select(key));
        row.appendChild(btn);
      }

      box.appendChild(row);
      metricsEl.appendChild(box);
    }
  }

  function select(metric) {
    if (metric === state.metric) return;
    state.metric = metric;
    // Shareable: a ranking someone sends should open on that ranking.
    history.replaceState(null, '', '?metric=' + encodeURIComponent(metric));
    renderMetrics();
    load();
  }

  /* ---------- data ---------- */

  async function load() {
    setState(translate('lb.loading', 'Chargement…'));
    podiumEl.replaceChildren();
    bodyEl.replaceChildren();
    tableWrap.hidden = true;

    let data;
    try {
      const res = await fetch(SOT.API_BASE + '/api/leaderboard?metric=' +
        encodeURIComponent(state.metric) + '&limit=50', { cache: 'no-store' });
      data = await res.json();
      if (!res.ok) throw new Error((data.error && data.error.message) || 'HTTP ' + res.status);
    } catch (e) {
      setState(translate('error.apiDown', 'Classements indisponibles'), e.message);
      return;
    }

    headEl.textContent = label(state.metric, data.label);

    if (!data.entries.length) {
      setState(
        translate('lb.emptyTitle', 'Personne dans ce classement'),
        translate('lb.emptyBody',
          'Aucun pirate publié n’a encore de valeur ici. Synchronise ton profil avec l’extension pour y figurer.'));
      return;
    }

    setState('');
    tableWrap.hidden = false;

    /* The podium takes the top three; repeating them in the table below
       would be the same information twice. */
    const top = data.entries.slice(0, 3);
    const hasPodium = top.length === 3;
    renderPodium(top);
    renderTable(hasPodium ? data.entries.slice(3) : data.entries);

    if (hasPodium && data.entries.length === 3) tableWrap.hidden = true;

    // Let the reveal animation pick up rows that did not exist at load.
    document.dispatchEvent(new CustomEvent('sot:rendered'));
  }

  async function init() {
    try {
      const res = await fetch(SOT.API_BASE + '/api/leaderboard/metrics', { cache: 'no-store' });
      const data = await res.json();
      state.available = (data.metrics || []).map((m) => m.key);
    } catch (e) {
      state.available = [];
    }

    if (!state.available.length) {
      setState(translate('error.apiDown', 'API injoignable'),
               'Les classements viennent du serveur — il ne répond pas.');
      return;
    }
    if (!state.available.includes(state.metric)) state.metric = state.available[0];

    renderMetrics();
    load();
  }

  init();
  document.addEventListener('sot:langchange', () => { renderMetrics(); load(); });
})();
