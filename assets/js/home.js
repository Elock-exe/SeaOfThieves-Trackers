/* SotTracker — sottracker.fr
   Creator: Vyros__
   https://github.com/Elock-exe/SeaOfThieves-Trackers */
(function () {
  'use strict';

  SOTUI.mount('Home');

  document.getElementById('hero-search-form').addEventListener('submit', function (e) {
    const input = this.querySelector('input[name="player"]');
    if (!input.value.trim()) e.preventDefault();
  });

  /* When the season actually ends.

     This used to compute the next Monday at 10:00 UTC — the weekly reset —
     and print it under the label "Season ends". It was therefore never more
     than seven days out, while a season runs about three months. The number
     was always wrong, and nothing on screen said so.

     The real date comes from Rare, through /api/stats. If it is not known,
     the line is hidden rather than filled with a guess: a stat panel with a
     gap in it is honest, and a confident wrong number is not. */
  (async function seasonCountdown() {
    const el = document.getElementById('season-countdown');
    if (!el) return;

    const item = el.closest('.hs-item');
    let stats = null;
    try { stats = await SOT.projectStats(); } catch (e) { /* traite plus bas */ }

    const endsAt = stats && stats.season && stats.season.endsAt;
    if (!endsAt) { if (item) item.style.display = 'none'; return; }

    function paint() {
      const diff = new Date(endsAt) - new Date();
      if (diff <= 0) { if (item) item.style.display = 'none'; return; }

      const jours = Math.floor(diff / 86400000);
      const heures = Math.floor((diff % 86400000) / 3600000);
      /* Au-dela d'une semaine, l'heure pres n'apprend rien a personne. */
      el.textContent = jours >= 7 ? jours + 'd' : jours + 'd ' + heures + 'h';
    }

    paint();
    setInterval(paint, 60000);
  })();

  /* The status line that used to live here announced plumbing ("live
     search available: steam, xbox") to people who only wanted to search,
     and was removed. Filling the promo card was tangled up in the same
     function, behind a guard on the element that no longer exists — so
     removing the line silently left an empty box in the hero.

     The card is its own concern now, and does not care whether some
     other element is on the page. */
  /* Qui est lie, vu d'ici.

     La carte interrogeait /api/health et lisait son champ "linked" : celui-ci
     dit si le SERVEUR a un compte Rare configure, l'ancien mecanisme par
     cookie. Il vaut false en permanence depuis que chacun synchronise le
     sien, donc la carte proposait de lier son compte a des gens deja lies.

     Ce qui compte est local : le pirate que ce navigateur a revendique. */
  renderLinkCard();
  document.addEventListener('sot:claim', renderLinkCard);

  /* The promo slot doubles as the account-linking entry point: it either
     invites you to link, or takes you to your own profile. */
  function renderLinkCard() {
    const card = document.getElementById('promo-card');
    if (!card) return;

    const owner = SOT.syncedOwner();

    function paint() {
      card.innerHTML = owner
        ? `<span class="promo-tag promo-tag-on">${I18N.t('promo.linkedTag')}</span>
           <h3>${I18N.t('promo.linkedTitle')}</h3>
           <p>${I18N.t('promo.linkedBody')}</p>
           <a class="btn-red" href="/profile?player=${encodeURIComponent(owner)}">${I18N.t('promo.linkedCta')}</a>`
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
  /* The Hourglass allegiance, both sides of it. Gold and doubloons rank
     whoever has played longest, which says little; allegiance is the one
     board that ranks PvP results, so it is the one worth leading with.
     Every other metric is a click away in the picker. */
  const DEFAULT_METRICS = ['servants', 'guardians'];
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

  /* Shown while the boards load. The block used to stay hidden until the
     data arrived, and on a sleeping free host that is several seconds of
     nothing at all — which reads as a broken page rather than a slow one.
     Placeholder rows keep the space, and the layout does not jump when the
     real ones land. */
  function showSkeleton(count) {
    const block = document.getElementById('top3-block');
    const list = document.getElementById('top3-list');
    if (!block || !list) return;
    list.innerHTML = Array.from({ length: count || 2 }, () => `
      <div class="top3 is-loading">
        <span class="top3-title skel skel-title"></span>
        ${'<span class="top3-row skel skel-row"></span>'.repeat(3)}
      </div>`).join('');
    block.hidden = false;
  }

  async function renderPodiums() {
    const block = document.getElementById('top3-block');
    const list = document.getElementById('top3-list');
    if (!block || !list) return;

    const chosen = picked().filter((k) => allMetrics.some((m) => m.key === k));
    if (!chosen.length) { block.hidden = true; return; }

    showSkeleton(chosen.length);

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
          .map((r) => ({ name: r.handle, value: r.value, avatar: r.avatar }))
          .filter((r) => r.name);
        return rows.length ? { key, rows } : null;
      } catch (e) {
        return null;
      }
    }));

    const live = boards.filter(Boolean);
    if (!live.length) { block.hidden = true; return; }

    list.innerHTML = live.map((b) => `
      <div class="top3">
        <a class="top3-title" href="/leaderboards?metric=${encodeURIComponent(b.key)}">${metricLabel(b.key)}</a>
        ${b.rows.map((r, i) => {
          /* Same fallback the recent cards use: initials on a colour derived
             from the name, so a row is never a blank circle. */
          const pic = r.avatar
            ? `<span class="top3-pic" style="background:center/cover no-repeat url('${r.avatar}')"></span>`
            : `<span class="top3-pic" style="background:${SOT.avatarColor(r.name)}">${SOT.initials(r.name)}</span>`;
          return `
          <a class="top3-row" href="/profile?player=${encodeURIComponent(r.name)}">
            <span class="top3-rank r${i + 1}">${i + 1}</span>
            ${pic}
            <span class="top3-name">${r.name}</span>
            <span class="top3-value">${SOT.formatCompact(r.value)}</span>
          </a>`;
        }).join('')}
      </div>`).join('');
    block.hidden = false;
  }

  function renderMenu() {
    const menu = document.getElementById('top3-menu');
    if (!menu) return;
    const chosen = picked();

    menu.innerHTML = allMetrics.map((m) => {
      const on = chosen.includes(m.key);
      // At the cap, the unchecked ones go quiet rather than silently doing nothing.
      const full = !on && chosen.length >= MAX_PICKED;
      return `<label class="top3-opt${full ? ' is-full' : ''}">
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

    const btn = document.getElementById('top3-pick');
    const menu = document.getElementById('top3-menu');
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
