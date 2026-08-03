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

  /* What the API can actually do right now, stated plainly. */
  (async function apiStatus() {
    /* The status line was removed from the page: it announced plumbing
       ("live search available: steam, xbox") to people who only want to
       search. Failures still surface where they matter — on the result. */
    const el = document.getElementById('api-status');
    if (!el) return;
    if (!el) return;

    const health = await SOT.apiHealth();

    function paint() {
      if (!health) {
        el.className = 'api-status off';
        el.textContent = I18N.t('api.offline');
        return;
      }
      const live = Object.keys(health.providers).filter((k) => health.providers[k]);
      if (!live.length) {
        el.className = 'api-status off';
        el.textContent = I18N.t('api.noKeys');
      } else {
        el.className = 'api-status on';
        el.textContent = I18N.t('api.online', { list: live.join(', ') });
      }
      renderLinkCard(health.linked);
    }

    paint();
    document.addEventListener('sot:langchange', paint);
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
           <a class="btn-red" href="profile.html?player=me">${I18N.t('promo.linkedCta')}</a>`
        : `<span class="promo-tag">${I18N.t('promo.tag')}</span>
           <h3>${I18N.t('promo.title')}</h3>
           <p>${I18N.t('promo.body')}</p>
           <a class="btn-red" href="link.html">${I18N.t('promo.cta')}</a>`;
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
        <a class="trio-card" href="profile.html?player=${encodeURIComponent(r.name)}">
          ${avatar}
          <div class="trio-name">${r.name}</div>
          <div class="trio-label">${label}</div>
          <div class="trio-value">${stat}</div>
        </a>`;
    }).join('');
  }

  renderRecent();
  document.addEventListener('sot:langchange', renderRecent);
})();
