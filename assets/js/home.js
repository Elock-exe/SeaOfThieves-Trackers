(function () {
  'use strict';

  SOTUI.mount('Home');

  document.getElementById('hero-search-form').addEventListener('submit', function (e) {
    const input = this.querySelector('input[name="player"]');
    if (!input.value.trim()) e.preventDefault();
  });

  // Season countdown — cosmetic, derived from the weekly reset cadence.
  (function seasonCountdown() {
    const now = new Date();
    const end = new Date(now);
    end.setUTCDate(now.getUTCDate() + ((8 - now.getUTCDay()) % 7 || 7));
    end.setUTCHours(10, 0, 0, 0);
    const diff = end - now;
    document.getElementById('season-countdown').textContent =
      Math.floor(diff / 86400000) + 'd ' + Math.floor((diff % 86400000) / 3600000) + 'h';
  })();

  /* The status line that used to live here announced plumbing ("live
     search available: steam, xbox") to people who only wanted to search,
     and was removed. Filling the promo card was tangled up in the same
     function, behind a guard on the element that no longer exists — so
     removing the line silently left an empty box in the hero.

     The card is its own concern now, and does not care whether some
     other element is on the page. */
  (async function linkCard() {
    const health = await SOT.apiHealth();
    renderLinkCard(!!(health && health.linked));
  })();

  /* The promo slot doubles as the account-linking entry point: it either
     invites you to link, or takes you to your own profile. */
  function renderLinkCard(isLinked) {
    const card = document.getElementById('promo-card');
    if (!card) return;

    function paint() {
      card.innerHTML = isLinked
        ? `<span class="promo-tag promo-tag-on">${I18N.t('promo.linkedTag')}</span>
           <h3>${I18N.t('promo.linkedTitle')}</h3>
           <p>${I18N.t('promo.linkedBody')}</p>
           <a class="btn-red" href="/profile?player=me">${I18N.t('promo.linkedCta')}</a>`
        : `<span class="promo-tag">${I18N.t('promo.tag')}</span>
           <h3>${I18N.t('promo.title')}</h3>
           <p>${I18N.t('promo.body')}</p>
           <a class="btn-red" href="/link">${I18N.t('promo.cta')}</a>`;
    }

    paint();
    document.addEventListener('sot:langchange', paint);
  }

  /* Players this browser has looked up. Empty until the first search —
     that's honest, and it fills up as the site gets used. */
  function renderRecent() {
    const grid = document.getElementById('top-trio');
    if (!grid) return;

    const recent = SOT.recentPlayers().slice(0, 3);

    if (!recent.length) {
      grid.innerHTML = `<p class="recent-empty">${I18N.t('recent.empty')}</p>`;
      return;
    }

    grid.innerHTML = recent.map((r) => {
      const avatar = r.avatar
        ? `<span class="avatar" style="background:center/cover no-repeat url('${r.avatar}')"></span>`
        : `<span class="avatar" style="background:${SOT.avatarColor(r.name)}">${SOT.initials(r.name)}</span>`;
      const stat = r.achTotal
        ? `${r.achUnlocked}/${r.achTotal}`
        : (r.playtimeHours != null ? SOT.formatNumber(r.playtimeHours) + 'h' : '—');
      const label = r.achTotal ? I18N.t('profile.achievements') : I18N.t('profile.totalPlaytime');

      return `
        <a class="trio-card" href="/profile?player=${encodeURIComponent(r.name)}">
          ${avatar}
          <div class="trio-name">${r.name}</div>
          <div class="trio-label">${label}</div>
          <div class="trio-value">${stat}</div>
        </a>`;
    }).join('');
  }

  renderRecent();

  /* ---------------- how far along the project is ----------------
     Hidden until it answers, and hidden again at zero: "0 linked pirates"
     is worse than saying nothing at all. */
  (async function pirateCount() {
    const stats = await SOT.projectStats();
    if (!stats || !stats.pirates) return;
    document.getElementById('hs-pirates-value').textContent = SOT.formatNumber(stats.pirates);
    document.getElementById('hs-pirates').hidden = false;
    document.getElementById('hs-pirates-divider').hidden = false;
  })();

  /* ---------------- top 3 of the chosen leaderboards ----------------
     The metric list comes from the API, so a ranking added on the server
     shows up here without touching this file. Which ones are on screen is
     the reader's choice, kept in this browser. */
  const PICKED_KEY = 'sot-podium-metrics';
  const DEFAULT_METRICS = ['gold', 'doubloons', 'servants'];
  const MAX_PICKED = 4;

  let allMetrics = [];

  function picked() {
    try {
      const raw = JSON.parse(localStorage.getItem(PICKED_KEY) || 'null');
      if (Array.isArray(raw) && raw.length) return raw.slice(0, MAX_PICKED);
    } catch (e) { /* never chosen */ }
    return DEFAULT_METRICS;
  }

  function savePicked(list) {
    try { localStorage.setItem(PICKED_KEY, JSON.stringify(list)); } catch (e) { /* private mode */ }
  }

  function metricLabel(key) {
    const m = allMetrics.find((x) => x.key === key);
    return (m && m.label) || key;
  }

  async function renderPodiums() {
    const block = document.getElementById('podium-block');
    const list = document.getElementById('podium-list');
    if (!block || !list) return;

    const chosen = picked().filter((k) => allMetrics.some((m) => m.key === k));
    if (!chosen.length) { block.hidden = true; return; }

    /* One request per board, in parallel. A board that fails is dropped
       rather than replaced by an error — the others are still worth
       showing, and the homepage is not the place to explain a 500. */
    const boards = await Promise.all(chosen.map(async (key) => {
      try {
        const res = await fetch(SOT.API_BASE + '/api/leaderboard?metric=' +
          encodeURIComponent(key) + '&limit=3', { cache: 'no-store' });
        if (!res.ok) return null;
        const body = await res.json();
        /* The API names this field `handle`, not `name` — the leaderboard
           page reads it too. Guessing wrong here rendered three podiums of
           "undefined" while every request came back 200. */
        const rows = (body.entries || []).slice(0, 3)
          .map((r) => ({ name: r.handle, value: r.value }))
          .filter((r) => r.name);
        return rows.length ? { key, rows } : null;
      } catch (e) {
        return null;
      }
    }));

    const live = boards.filter(Boolean);
    if (!live.length) { block.hidden = true; return; }

    list.innerHTML = live.map((b) => `
      <div class="podium">
        <a class="podium-title" href="/leaderboards?metric=${encodeURIComponent(b.key)}">${metricLabel(b.key)}</a>
        ${b.rows.map((r, i) => `
          <a class="podium-row" href="/profile?player=${encodeURIComponent(r.name)}">
            <span class="podium-rank r${i + 1}">${i + 1}</span>
            <span class="podium-name">${r.name}</span>
            <span class="podium-value">${SOT.formatCompact(r.value)}</span>
          </a>`).join('')}
      </div>`).join('');
    block.hidden = false;
  }

  function renderMenu() {
    const menu = document.getElementById('podium-menu');
    if (!menu) return;
    const chosen = picked();

    menu.innerHTML = allMetrics.map((m) => {
      const on = chosen.includes(m.key);
      // At the cap, the unchecked ones go quiet rather than silently doing nothing.
      const full = !on && chosen.length >= MAX_PICKED;
      return `<label class="podium-opt${full ? ' is-full' : ''}">
          <input type="checkbox" value="${m.key}" ${on ? 'checked' : ''} ${full ? 'disabled' : ''} />
          <span>${m.label}</span>
        </label>`;
    }).join('');

    menu.querySelectorAll('input').forEach((box) => {
      box.addEventListener('change', () => {
        const now = picked().slice();
        const i = now.indexOf(box.value);
        if (box.checked && i === -1) now.push(box.value);
        if (!box.checked && i !== -1) now.splice(i, 1);
        savePicked(now.slice(0, MAX_PICKED));
        renderMenu();
        renderPodiums();
      });
    });
  }

  (async function podiums() {
    try {
      const res = await fetch(SOT.API_BASE + '/api/leaderboard/metrics', { cache: 'no-store' });
      if (!res.ok) return;
      allMetrics = (await res.json()).metrics || [];
    } catch (e) {
      return;   // no metrics, no panel — nothing to explain
    }
    if (!allMetrics.length) return;

    renderMenu();
    await renderPodiums();

    const btn = document.getElementById('podium-pick');
    const menu = document.getElementById('podium-menu');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    // Clicking away closes it; clicking inside must not.
    menu.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => { menu.hidden = true; });
  })();

  document.addEventListener('sot:langchange', () => {
    renderRecent();
    renderMenu();
    renderPodiums();
  });
})();
