/* ============================================================
   Players this browser has looked up.

   A global leaderboard would need a shared database and many linked
   accounts — neither exists yet. So rather than inventing rankings,
   this ranks the players actually searched from this machine. It's
   real data, it grows with use, and it's labelled for what it is.
   ============================================================ */
(function () {
  'use strict';

  SOTUI.mount('Leaderboards');

  const METRICS = {
    achievements: {
      key: 'metric.achievements',
      get: (p) => (p.achTotal ? p.achUnlocked : null),
      fmt: (v, p) => v + '/' + p.achTotal
    },
    gamerscore: {
      key: 'metric.gamerscore',
      get: (p) => p.gamerscore,
      fmt: (v) => SOT.formatNumber(v)
    },
    playtimeHours: {
      key: 'metric.playtimeHours',
      get: (p) => p.playtimeHours,
      fmt: (v) => SOT.formatNumber(v) + 'h'
    },
    seenAt: {
      key: 'metric.lastSeen',
      get: (p) => (p.seenAt ? Date.parse(p.seenAt) : null),
      fmt: (v) => new Date(v).toISOString().slice(0, 10)
    }
  };

  const state = { metric: 'achievements', filter: '' };

  function rows() {
    const m = METRICS[state.metric];
    return SOT.recentPlayers()
      .filter((p) => p.name.toLowerCase().includes(state.filter.toLowerCase()))
      .sort((a, b) => {
        const av = m.get(a), bv = m.get(b);
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return bv - av;
      });
  }

  function render() {
    const t = I18N.t;
    const m = METRICS[state.metric];
    const list = rows();

    const head = document.querySelector('th[data-sort="metric"]');
    if (head) head.textContent = t(m.key);

    const tbody = document.getElementById('lb-body');

    if (!list.length) {
      tbody.innerHTML = `
        <tr><td colspan="6" class="lb-empty">
          <strong>${t('lb.emptyTitle')}</strong>
          <span>${t('lb.emptyBody')}</span>
        </td></tr>`;
      const pag = document.getElementById('lb-pagination');
      if (pag) pag.innerHTML = '';
      return;
    }

    tbody.innerHTML = list.map((p, i) => {
      const rank = i + 1;
      const rankClass = rank === 1 ? 'top1' : rank === 2 ? 'top2' : rank === 3 ? 'top3' : '';
      const v = m.get(p);
      const avatar = p.avatar
        ? `<span class="avatar" style="background:center/cover no-repeat url('${p.avatar}')"></span>`
        : `<span class="avatar" style="background:${SOT.avatarColor(p.name)}">${SOT.initials(p.name)}</span>`;

      return `
        <tr onclick="location.href='profile.html?player=${encodeURIComponent(p.name)}'">
          <td class="lb-rank ${rankClass}">#${rank}</td>
          <td>
            <div class="lb-player">
              ${avatar}
              <span>
                <span class="name">${p.name}</span>
                ${p.pirateLegend ? '<span class="pl-badge">★ Legend</span>' : ''}
              </span>
            </div>
          </td>
          <td><span class="region-tag">${p.platform || '—'}</span></td>
          <td class="stat-strong">${v == null ? '—' : m.fmt(v, p)}</td>
          <td>${p.gamerscore != null ? SOT.formatNumber(p.gamerscore) : '—'}</td>
          <td>${p.seenAt ? p.seenAt.slice(0, 10) : '—'}</td>
        </tr>`;
    }).join('');

    const pag = document.getElementById('lb-pagination');
    if (pag) {
      pag.innerHTML = `<button class="page-btn" id="lb-clear">${t('lb.clear')}</button>`;
      document.getElementById('lb-clear').addEventListener('click', () => {
        SOT.forgetPlayers();
        render();
      });
    }
  }

  document.getElementById('metric-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip-tab');
    if (!btn) return;
    document.querySelectorAll('.chip-tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.metric = btn.dataset.metric;
    render();
  });

  document.getElementById('lb-search').addEventListener('input', (e) => {
    state.filter = e.target.value;
    render();
  });

  render();
  document.addEventListener('sot:langchange', render);
})();
