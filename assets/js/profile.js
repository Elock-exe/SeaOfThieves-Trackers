/* SotTracker — sottracker.fr
   Creator: Vyros__
   https://github.com/Elock-exe/SeaOfThieves-Trackers */
(function () {
  'use strict';

  SOTUI.mount('');

  const rawQuery = SOT.playerFromQuery();
  const platform = SOT.platformFromQuery();

  /* The profile being rendered. Declared up front so `start()` can assign
     it whether it's reached synchronously (sample data) or after an
     await (live lookup). */
  let p;
  // which Hourglass allegiance is being shown; survives re-renders
  let hgActive = null;

  document.getElementById('empty-search-form').addEventListener('submit', function (e) {
    const input = this.querySelector('input');
    if (!input.value.trim()) e.preventDefault();
  });

  if (!rawQuery.trim()) {
    document.getElementById('profile-empty').style.display = 'block';
    return;
  }

  /* The whole name, suffix included. This used to cut at the '#' and keep
     only what came before, on the assumption that "#9267" was decoration —
     it is not. On Xbox that suffix is part of the gamertag, and the search
     fails without it: "mrhossam#9267" resolves, "mrhossam" does not.

     So the site never worked for the very format its own search box offers
     as an example. */
  const rawName = rawQuery;

  /* Show a failure the visitor can act on, rather than a blank page. */
  function showError(code, query) {
    const box = document.getElementById('profile-not-found');
    const titleEl = box.querySelector('h2');
    const nameEl = document.getElementById('not-found-name');
    const helpEl = box.querySelector('p[style]');

    const KEY = {
      api_down: 'error.apiDown',
      not_configured: 'error.notConfigured',
      not_found: 'error.notFound',
      private: 'error.private',
      rate_limited: 'error.rateLimited',
      not_linked: 'error.notLinked',
      auth_expired: 'error.authExpired'
    };
    const helpKey = KEY[code] || 'error.upstream';

    titleEl.removeAttribute('data-i18n');
    titleEl.textContent = I18N.t('error.title');
    nameEl.textContent = query ? I18N.t('error.query', { q: query }) : '';
    helpEl.innerHTML = I18N.t(helpKey);

    box.style.display = 'block';
    document.getElementById('not-found-search-form').addEventListener('submit', function (e) {
      const input = this.querySelector('input');
      if (!input.value.trim()) e.preventDefault();
    });
  }

  /* A live lookup hits two APIs, so say something while it runs. */
  function showLoading(name) {
    const el = document.getElementById('profile-loading');
    if (!el) return;
    el.querySelector('.loading-name').textContent = name;
    el.querySelector('.loading-text').textContent = I18N.t('profile.searching');
    el.style.display = 'flex';
  }
  function hideLoading() {
    const el = document.getElementById('profile-loading');
    if (el) el.style.display = 'none';
  }

  /* Dispatch runs at the very bottom of this file — everything render()
     depends on has to be initialised before the first call. */
  function dispatch() {
    const name = rawName.trim();
    // `?player=me` reads the linked account instead of searching by name
    if (name.toLowerCase() === 'me') return bootLinked();
    boot(platform, name);
  }

  /* A public lookup (Steam/Xbox) gives playtime and achievements. If the
     pirate being viewed is the one whose account is synced here, the Rare
     data — gold, Hourglass, reputation — belongs on the same page instead
     of a "this pirate has not linked their account" notice sitting on top
     of data we already hold. */
  async function mergeSynced(profile) {
    /* Ask for this pirate by name. The old version fetched "the latest
       snapshot on the server" and then tried to work out whose it was —
       which, with more than one account, meant showing whoever synced
       last. The server now answers per handle, so there is nothing to
       guess and nothing to leak. */
    const snapshot = await SOT.syncedFor(profile.name);
    if (!snapshot) return profile;

    const rare = SOT.normalizeSynced(snapshot);
    return Object.assign({}, profile, rare, {
      name: profile.name,
      playtime: profile.playtime != null ? profile.playtime : rare.playtime,
      achievements: profile.achievements || rare.achievements
    });
  }

  /* Two independent sources, and either one is enough to draw a profile.
     This used to give up the moment the public lookup threw, so a pirate
     whose Steam or Xbox profile is private became unreachable — including
     from the leaderboards they were sitting on, with their gold on screen
     one click earlier. The published stats were there the whole time;
     nothing asked for them.

     Only a pirate with neither is genuinely not found. */
  async function boot(plat, id) {
    showLoading(id);

    let profile = null;
    let publicErr = null;

    try {
      profile = await SOT.lookupPlayer(plat, id);
    } catch (err) {
      publicErr = err;
    }

    try {
      if (profile) {
        profile = await mergeSynced(profile);
      } else {
        const snapshot = await SOT.syncedFor(id);
        if (snapshot) {
          // No playtime or achievements here — those are the public half.
          profile = Object.assign(SOT.normalizeSynced(snapshot), { name: id });
        }
      }
    } catch (e) {
      /* The synced half is a bonus when the public half already worked, and
         the last hope when it did not. Either way it must not throw away a
         profile we can already render. */
    }

    hideLoading();

    if (!profile) return showError(publicErr && publicErr.code, id);

    SOT.rememberPlayer(profile);
    start(profile);
  }

  async function bootLinked() {
    showLoading(I18N.t('profile.yourAccount'));
    try {
      const profile = await SOT.lookupLinked();
      // Rare sends no gamertag, so fall back to the pirate the owner claimed
      // rather than labelling their own account "Pirate".
      if (profile.name === 'Pirate') {
        const owner = SOT.syncedOwner();
        if (owner) profile.name = owner;
      }
      hideLoading();
      start(profile);
    } catch (err) {
      hideLoading();
      showError(err.code, null);
    }
  }

  function start(profile) {
    p = profile;

    document.getElementById('profile-content').style.display = 'block';
    document.title = `${p.name}${p.tag ? '#' + p.tag : ''} — Sea of Thieves Tracker`;

    /* Live profiles carry a real avatar; sample ones get initials. */
    const avatar = document.getElementById('p-avatar');
    if (p.avatar) {
      avatar.style.background = `center/cover no-repeat url("${p.avatar}")`;
      avatar.textContent = '';
    } else {
      avatar.style.background = SOT.avatarColor(p.name);
      avatar.textContent = SOT.initials(p.name);
    }

    document.getElementById('p-name').textContent = p.name;
    document.getElementById('p-tag').textContent = p.tag ? '#' + p.tag : '';

    renderAll();
    renderClaim();
    document.addEventListener('sot:langchange', () => { renderAll(); renderClaim(); });
  }

  /* Which pirate belongs to this browser.

     The site needs it because a snapshot carries a handle, not an identity —
     nothing in it says "this is the person reading". The extension knows, but
     it cannot tell the page: separate storage, separate origin.

     This button was removed once as redundant, and that quietly broke the
     link page: it asks syncedIdentity() who you are, syncedIdentity() reads
     the claimed owner, and nothing had written one since. The page could not
     say "linked" to anybody, and told them to click a button that no longer
     existed. */
  function renderClaim() {
    const btn = document.getElementById('p-claim');
    if (!btn || !p) return;

    // Only worth offering on a pirate that has actually published something,
    // and only when this browser does not already call them its own.
    const owner = SOT.syncedOwner();
    const already = owner && owner.toLowerCase() === String(p.name).toLowerCase();
    btn.hidden = !p.linked || already;
    btn.querySelector('span').textContent = I18N.t('profile.claim');
  }

  document.getElementById('p-claim').addEventListener('click', async () => {
    const btn = document.getElementById('p-claim');
    btn.disabled = true;
    await SOT.claimSynced(p.name);
    btn.querySelector('span').textContent = I18N.t('profile.claimed');
    setTimeout(() => { btn.hidden = true; btn.disabled = false; }, 1500);
  });

  /* The tabs are built from what the sections rendered, so they have to run
     after them — and again on a language change, since the labels move. */
  function renderAll() {
    render();
    renderKeyStats();
    renderSeasons();
    buildTabs();
  }

  const SHARE_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 8a3 3 0 1 0-2.83-4H15a3 3 0 0 0 .05 3.9L9.09 11.51a3 3 0 1 0 0 .98l5.96 3.61A3 3 0 1 0 18 16a2.98 2.98 0 0 0-.91.14l-5.96-3.61a3.01 3.01 0 0 0 0-1.06l5.96-3.61A2.98 2.98 0 0 0 18 8z" fill="currentColor"/></svg>';

  document.getElementById('p-share').addEventListener('click', async () => {
    const btn = document.getElementById('p-share');
    try {
      await navigator.clipboard.writeText(window.location.href);
      btn.innerHTML = I18N.t('profile.copied');
      setTimeout(() => { btn.innerHTML = SHARE_ICON + I18N.t('profile.copyLink'); }, 1500);
    } catch (err) {
      btn.textContent = window.location.href;
    }
  });

  /* Every block states where its data can actually come from. */
  function sourceBadge(source) {
    // 'connected' is verified account data; 'public' comes from Steam/Xbox.
    const variant = source === 'connected' ? 'success' : 'progress';
    return SOTBadge.badge(I18N.t('source.' + source), variant,
      { title: I18N.t('source.' + source + 'Hint') });
  }

  /* `source` is optional now. Stamping "CONNECTED" on all four sections of
     a page whose header already says the account is linked was four
     repetitions of one fact — noise crowding out the numbers. */
  function panel(titleKey, source, bodyHTML, extraClass) {
    return `
      <div class="panel ${extraClass || ''}">
        <div class="panel-head">
          <span>${I18N.t(titleKey)}</span>
          ${source ? sourceBadge(source) : ''}
        </div>
        <div class="panel-body padded">${bodyHTML}</div>
      </div>`;
  }

  function render() {
    const t = I18N.t;

    document.getElementById('p-share').innerHTML = SHARE_ICON + t('profile.copyLink');

    /* ---------- identity meta (fields absent from live lookups are skipped) ---------- */
    const pills = [];
    if (p.region) pills.push(`<span class="meta-pill">${p.region}</span>`);
    if (p.platform) pills.push(`<span class="meta-pill">${p.platform}</span>`);
    if (p.gamerscore) {
      pills.push(`<span class="meta-pill">${SOT.formatNumber(p.gamerscore.earned)}/${SOT.formatNumber(p.gamerscore.total)} G</span>`);
    }
    /* Hours belong up here next to the gamerscore, not only in the panel
       further down: it is the first number people compare, and it reads as
       missing when the header shows everything else about the account.
       Only Steam and Xbox report it, so it stays absent rather than zero
       for a pirate we know only through their linked Rare account. */
    if (p.playtime && p.playtime.totalHours) {
      pills.push(`<span class="meta-pill" title="${t('profile.totalPlaytime')}">` +
        `${SOT.formatNumber(p.playtime.totalHours)} h</span>`);
    }
    if (p.pirateLegend) {
      pills.push(`<span class="meta-pill meta-legend">★ ${t('profile.pirateLegend')}</span>`);
    }
    /* Filled in once the count comes back, so a slow or missing counter
       never delays the rest of the header. */
    pills.push(`<span class="meta-pill" id="p-views" hidden></span>`);
    // Status badges, so linked/unlinked reads the same everywhere.
    pills.push(p.linked
      ? SOTBadge.badge(t('profile.linked'), 'success')
      : SOTBadge.badge(t('profile.notLinked'), 'expired'));
    document.getElementById('p-meta').innerHTML = pills.join('');

    /* Deliberately not awaited: the count is the least important thing on
       this page, and the header should not wait on a write. */
    SOT.countView(p.name).then((views) => {
      const el = document.getElementById('p-views');
      /* Zero is shown; unknown is not. A pirate nobody has opened yet is a
         fact worth printing, and it is the honest starting point for a
         counter — but null means the counter could not be read at all, and
         printing "0" for that would state something untrue. */
      if (!el || typeof views !== 'number') return;
      el.textContent = SOT.formatNumber(views) + ' ' +
        t(views === 1 ? 'profile.viewOne' : 'profile.views');
      el.title = t('profile.viewsHint');
      el.hidden = false;
    });

    /* ---------- unlinked: explain rather than show nothing ---------- */
    const cta = document.getElementById('link-cta');

    /* The "claim this pirate" flow is gone: stats are published under a
       handle by the extension, which owns the account key, so the website
       never has to guess whose snapshot it is looking at. */
    if (!p.linked) {
      cta.style.display = 'flex';
      cta.innerHTML = `
        <div class="link-cta-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>
        </div>
        <div class="link-cta-text">
          <strong>${t('profile.notLinkedTitle')}</strong>
          <p>${t('profile.notLinkedBody')}</p>
        </div>
        <a class="btn-red" href="/">${t('profile.notLinkedCta')}</a>`;
    } else {
      cta.style.display = 'none';
      cta.innerHTML = '';
    }

    /* ---------- Hourglass: the actual PvP rank ---------- */
    const hgEl = document.getElementById('hourglass-section');
    if (p.hourglass) {
      const h = p.hourglass;
      const sides = h.sides && h.sides.length ? h.sides : [h];
      /* Which side is on screen is the reader's choice — both allegiances
         are levelled on the same account and there is no reason to hide
         one behind the other. */
      if (!hgActive || !sides.some((s) => s.key === hgActive)) hgActive = h.faction;

      const paintHourglass = () => {
        const s = sides.find((x) => x.key === hgActive) || sides[0];
        hgEl.innerHTML = `
          <div class="hourglass-card hg-${s.key}">
            <div class="hg-emblem">
              <!-- Real faction emblem when the file exists; the generic
                   hourglass outline when it does not. -->
              <img class="hg-emblem-img" alt="${s.name}"
                   src="assets/img/hourglass-${s.key}.png"
                   onerror="this.parentNode.classList.add('hg-emblem-fallback');this.remove();" />
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 2h12M6 22h12"/><path d="M8 2v3.5c0 2 4 4.5 4 6.5s-4 4.5-4 6.5V22"/><path d="M16 2v3.5c0 2-4 4.5-4 6.5s4 4.5 4 6.5V22"/>
              </svg>
              ${s.level != null
                ? `<span class="hg-emblem-level">${SOT.formatNumber(s.level)}</span>`
                : ''}
            </div>

            <div class="hg-body">
              <div class="hg-label">${t('profile.pvpRank')}</div>
              <div class="hg-faction">${s.name}</div>
              ${s.motto ? `<div class="hg-motto">${s.motto}</div>` : ''}

              <div class="hg-bar" role="progressbar" aria-valuenow="${Math.round(s.progress)}" aria-valuemin="0" aria-valuemax="100">
                <div class="hg-bar-fill" style="width:${s.progress}%"></div>
              </div>
              <div class="hg-progress-note">${t('profile.towardNext')} — ${s.progress}%</div>

              <div class="hg-stats">
                <div class="hg-stat">
                  <span class="hg-stat-value">${SOT.formatNumber(s.level)}</span>
                  <span class="hg-stat-label">${t('profile.hourglassLevel')}</span>
                </div>
                <div class="hg-stat">
                  <span class="hg-stat-value">${s.emblems.unlocked}<span class="hg-stat-of">/${s.emblems.total}</span></span>
                  <span class="hg-stat-label">${t('profile.emblems')}</span>
                </div>
                <div class="hg-stat">
                  <span class="hg-stat-value">${s.items.unlocked}<span class="hg-stat-of">/${s.items.total}</span></span>
                  <span class="hg-stat-label">${t('profile.cosmetics')}</span>
                </div>
              </div>
            </div>

            ${sides.length > 1 ? `
              <div class="hg-switch" role="tablist" aria-label="${t('profile.allegiance')}">
                ${sides.map((x) => `
                  <button class="hg-switch-btn${x.key === hgActive ? ' is-active' : ''}"
                          role="tab" aria-selected="${x.key === hgActive}" data-side="${x.key}">
                    <span class="hg-switch-name">${x.name}</span>
                    <span class="hg-switch-level">${SOT.formatNumber(x.level)}</span>
                  </button>`).join('')}
              </div>` : ''}

            <div class="hg-note">${t('profile.noKdNote')}</div>
          </div>`;

        hgEl.querySelectorAll('.hg-switch-btn').forEach((b) => {
          b.addEventListener('click', () => { hgActive = b.dataset.side; paintHourglass(); });
        });
      };

      paintHourglass();
    } else {
      hgEl.innerHTML = '';
    }

    /* ---------- currencies ---------- */
    const curEl = document.getElementById('currencies-section');
    if (p.currencies) {
      const c = p.currencies;
      /* Gold leads. Three equal cards gave 79 ancient coins the same weight
         as 1.6M gold, which is not how any of this reads in game. */
      curEl.innerHTML = `
        <div class="section-label">${t('profile.currencies')}</div>
        <div class="currency-grid">
          <div class="currency-card coin-gold currency-lead">
            ${SOTIcons.mark('coins')}
            <div class="currency-label">${t('currency.gold')}</div>
            <div class="currency-value">${SOT.formatNumber(c.gold)}</div>
          </div>
          <div class="currency-stack">
            <div class="currency-card coin-doubloon">
              <!-- Real artwork where it exists; the line mark stays as the
                   fallback and is hidden once the image loads. -->
              <img class="currency-art" src="assets/img/coin-doubloon.webp" alt=""
                   loading="lazy" onerror="this.remove()" />
              ${SOTIcons.mark('doubloon')}
              <div class="currency-label">${t('currency.doubloons')}</div>
              <div class="currency-value">${SOT.formatNumber(c.doubloons)}</div>
            </div>
            <div class="currency-card coin-ancient">
              ${SOTIcons.mark('ancient')}
              <div class="currency-label">${t('currency.ancientCoins')}</div>
              <div class="currency-value">${SOT.formatNumber(c.ancientCoins)}</div>
            </div>
          </div>
        </div>`;
    } else {
      curEl.innerHTML = '';
    }

    /* ---------- last session (calculated) ---------- */
    const sesEl = document.getElementById('session-section');
    if (p.session) {
      const s = p.session;
      const hrs = Math.floor(s.durationMinutes / 60);
      const mins = s.durationMinutes % 60;
      const items = [
        { label: t('session.gold'), value: '+' + SOT.formatGold(s.goldGained) },
        { label: t('session.levels'), value: '+' + s.hourglassLevels },
        { label: t('session.ships'), value: s.shipsSunk },
        { label: t('session.chests'), value: s.chestsSold }
      ];
      sesEl.innerHTML = `
        <div class="session-card">
          <div class="session-head">
            <span class="session-title">${t('profile.lastSession')} ${sourceBadge('calculated')}</span>
            <span class="session-when">${s.endedAt} · ${hrs}h ${mins}m</span>
          </div>
          <div class="session-items">
            ${items.map((i) => `
              <div class="session-item">
                <span class="session-value">${i.value}</span>
                <span class="session-label">${i.label}</span>
              </div>`).join('')}
          </div>
        </div>`;
    } else {
      sesEl.innerHTML = '';
    }

    /* ---------- milestones ---------- */
    const msEl = document.getElementById('milestones-section');
    if (p.milestones) {
      const rows = SOT.MILESTONE_KEYS.map((k) => `
        <div class="stat-row">
          <span class="stat-row-label">${t('milestone.' + k)}</span>
          <span class="stat-row-value">${SOT.formatNumber(p.milestones[k])}</span>
        </div>`).join('');
      msEl.innerHTML = panel('profile.milestones', 'connected', rows);
    } else {
      msEl.innerHTML = '';
    }

    /* ---------- reputation ---------- */
    const repEl = document.getElementById('reputation-section');
    if (p.reputation) {
      /* Rare keeps counting past the cap once distinctions start, so 242
         against a max of 75 is real. Showing it as "242/75" reads as a
         broken number; naming the distinctions explains it instead. */
      /* The bar is progress toward the NEXT level, which is what Rare
         measures. It used to be level/madeUpMaximum, which produced
         "242/75" and a bar pinned at 100% for anyone past the cap. */
      /* Crest slot: drop assets/img/company-<key>.png in and it appears.
         Missing files simply remove themselves — no broken-image icon, no
         empty gap, so the page never depends on assets being there. */
      const crest = (key) =>
        `<img class="rep-crest" src="assets/img/company-${key}.png" alt="" loading="lazy"
              onerror="this.remove()" />`;

      /* Une ligne par compagnie avec une barre de progression, c'etait la
         forme d'un tableau : on comparait des compagnies au lieu de regarder
         la sienne. Rare presente chacune comme une carte, et affiche quatre
         nombres que l'API renvoyait deja sans que rien ne les lise —
         promotions, commendations, titres, objets.

         Le rang porte ("Master Gold Hoarder") passe devant le niveau : 67 ne
         veut rien dire pour qui ne connait pas les paliers, le titre si. */
      const compte = (o) => o && o.total
        ? `<span class="repc-n">${SOT.formatNumber(o.unlocked)}<i>/${SOT.formatNumber(o.total)}</i></span>`
        : '<span class="repc-n repc-none">—</span>';

      const rows = p.reputation.companies.map((c) => `
          <article class="repc repc-${c.key}${c.distinction > 0 ? ' repc-maxed' : ''}">
            <img class="repc-watermark" src="assets/img/company-${c.key}.png" alt="" aria-hidden="true" loading="lazy" onerror="this.remove()" />
            <div class="repc-crest">
              ${crest(c.key)}
              <span class="repc-level">${SOT.formatNumber(c.level)}</span>
            </div>

            <div class="repc-body">
              <h3 class="repc-name">${c.name}</h3>
              ${c.rank ? `<p class="repc-rank">${c.rank}</p>` : ''}

              <dl class="repc-grid">
                <div><dt>${t('profile.promotions')}</dt><dd>${compte(c.promotions)}</dd></div>
                <div><dt>${t('profile.emblems')}</dt><dd>${compte(c.emblems)}</dd></div>
                <div><dt>${t('profile.titlesLabel')}</dt><dd>${compte(c.titles)}</dd></div>
                <div><dt>${t('profile.items')}</dt><dd>${compte(c.items)}</dd></div>
              </dl>

              ${c.distinction > 0
                ? `<p class="repc-dist">${SOTBadge.badge(String(c.distinction), 'star', { title: t('profile.distinctionHint') })}</p>`
                : `<div class="repc-bar" role="progressbar" aria-valuenow="${Math.round(c.progress)}" aria-valuemin="0" aria-valuemax="100">
                     <span style="width:${c.progress}%"></span>
                   </div>`}
            </div>
          </article>`).join('');
      /* Campaign factions have no level, only emblems and campaigns. They
         were dropped entirely for lacking a level, which hid 207 unlocked
         emblems and 49 campaigns of real progress. */
      const camps = p.reputation.campaigns || [];
      /* Meme carte que les compagnies, sans ce qu'une campagne n'a pas.

         Le gros chiffre du medaillon est le NIVEAU. Une campagne n'en a
         pas, et y mettre son compte d'emblemes a la place donnait un "2"
         ou un "207" isole que rien n'expliquait. Il disparait quand il n'y
         a pas de niveau — la faction a cle UUID en a un, elle le garde.

         Les compteurs sont ceux du jeu : titres et commendations.

         Rare fait exactement cela sur sa propre page : les Gardiens de la
         Fortune n'ont ni rang ni promotions, leur carte affiche deux
         compteurs au lieu de quatre et rien ne manque a l'oeil. Une carte
         qui s'adapte vaut mieux qu'une seconde mise en page a maintenir. */
      const campRows = camps.map((c) => {
        const pct = c.emblems.total
          ? Math.round((c.emblems.unlocked / c.emblems.total) * 100) : 0;
        return `
          <article class="repc repc-campaign">
            <img class="repc-watermark" src="assets/img/company-${c.key}.png" alt="" aria-hidden="true" loading="lazy" onerror="this.remove()" />
            <div class="repc-crest">
              ${crest(c.key)}
              ${c.level != null ? `<span class="repc-level">${SOT.formatNumber(c.level)}</span>` : ''}
            </div>

            <div class="repc-body">
              <h3 class="repc-name">${c.name}</h3>

              <dl class="repc-grid">
                <div><dt>${t('profile.titlesLabel')}</dt><dd>${compte(c.titles)}</dd></div>
                <div><dt>${t('profile.emblems')}</dt><dd>${compte(c.emblems)}</dd></div>
              </dl>

              <div class="repc-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
                <span style="width:${pct}%"></span>
              </div>
            </div>
          </article>`;
      }).join('');

      repEl.innerHTML =
        /* Les cartes se rangent en grille ; les anciennes lignes s empilaient
           d elles-memes et n avaient besoin d aucun conteneur. */
        panel('profile.reputation', null, '<div class="rep-cards">' + rows + '</div>') +
        (campRows ? panel('profile.campaigns', null, '<div class="rep-cards">' + campRows + '</div>', 'panel-gap') : '');
    } else {
      repEl.innerHTML = '';
    }

    /* ---------- commendations ---------- */
    const comEl = document.getElementById('commendations-section');
    if (p.commendations) {
      const rows = p.commendations.items.map((c) => {
        const pct = Math.round((c.value / c.max) * 100);
        return `
          <div class="rep-row" style="grid-template-columns: 150px 1fr 62px;">
            <div class="rep-name">${t('commendation.' + c.key)}</div>
            <div class="rep-bar-track"><div class="rep-bar-fill" style="width:${pct}%"></div></div>
            <div class="rep-count">${c.value}/${c.max}</div>
          </div>`;
      }).join('');
      comEl.innerHTML = panel('profile.commendations', 'connected', rows);
    } else {
      comEl.innerHTML = '';
    }

    /* ---------- public sources ----------
       A real lookup can legitimately return one without the other
       (Xbox exposes no 2-week window; a private profile hides both),
       so each figure falls back to a dash rather than crashing. */
    const pubEl = document.getElementById('public-section');
    const ach = p.achievements;
    const pt = p.playtime;

    if (!ach && !pt) {
      pubEl.innerHTML = panel('profile.playtimeAch', 'public',
        `<p class="empty-note">${t('profile.noPublicData')}</p>`);
      return;
    }

    const achHTML = ach ? ach.items.map((a) => `
      <span class="ach-chip ${a.unlocked ? '' : 'locked'}">
        ${a.unlocked ? '★' : '–'} ${a.name}
      </span>`).join('') : '';

    pubEl.innerHTML = `
      <div class="panel">
        <div class="panel-head">
          <span>${t('profile.playtimeAch')}</span>
          ${sourceBadge('public')}
        </div>
        <div class="panel-body padded">
          <div class="playtime-row">
            <div>
              <div class="pt-value">${pt ? SOT.formatNumber(pt.totalHours) + 'h' : '—'}</div>
              <div class="pt-label">${t('profile.totalPlaytime')}</div>
            </div>
            <div>
              <div class="pt-value">${pt && pt.recentHours != null ? pt.recentHours + 'h' : '—'}</div>
              <div class="pt-label">${t('profile.recentPlaytime')}</div>
            </div>
            <div>
              <div class="pt-value">${ach ? ach.unlockedCount + '/' + ach.totalCount : '—'}</div>
              <div class="pt-label">${t('profile.achievements')}</div>
            </div>
          </div>
          <div class="ach-grid">${achHTML}</div>
        </div>
      </div>`;
  }

  /* ---------- key stats ----------
     The headline numbers as one dense grid rather than a card each: label,
     value, and the one line of context that makes the value mean something.
     Reading six numbers should not take six scroll gestures. */
  function renderKeyStats() {
    const t = I18N.t;
    const el = document.getElementById('keystats-section');
    if (!el) return;

    const tiles = [];
    const c = p.currencies;
    const hg = p.hourglass;
    const rep = p.reputation;
    const ach = p.achievements;

    if (hg) {
      tiles.push({ label: t('profile.pvpRank'), value: hg.level, sub: hg.factionName, accent: 'red', deco: 'hourglass' });
      if (hg.sides && hg.sides.length === 2) {
        const other = hg.sides.find((s) => (s.key || s.faction) !== hg.faction);
        if (other) tiles.push({ label: other.name, value: other.level, sub: t('profile.otherSide'), accent: 'steel', deco: 'shield' });
      }
    }
    if (c) tiles.push({ label: t('currency.gold'), value: SOT.formatCompact(c.gold), sub: SOT.formatNumber(c.gold), accent: 'gold', deco: 'coins' });

    if (rep && rep.companies) {
      // "Past the cap" is what DistinctionLevel records — no cap table needed.
      const maxed = rep.companies.filter((x) => x.distinction > 0).length;
      const total = rep.companies.reduce((s, x) => s + x.level, 0);
      tiles.push({ label: t('profile.companiesMaxed'), value: `${maxed}/${rep.companies.length}`, sub: t('profile.atCap'), accent: 'gold', deco: 'wheel' });
      tiles.push({ label: t('profile.totalLevels'), value: SOT.formatNumber(total), sub: t('profile.acrossCompanies'), accent: 'steel', deco: 'compass' });
    }
    if (p.emblems) {
      const pct = Math.round((p.emblems.unlocked / p.emblems.total) * 100);
      tiles.push({
        label: t('profile.emblems'),
        value: SOT.formatNumber(p.emblems.unlocked),
        sub: `${t('profile.outOf')} ${SOT.formatNumber(p.emblems.total)} — ${pct}%`,
        accent: 'gold',
        deco: 'ancient'
      });
    }
    const activeSeason = (p.season || []).find((s) => s.active);
    if (activeSeason && activeSeason.tier != null) {
      tiles.push({
        label: activeSeason.title || t('profile.season'),
        value: `${activeSeason.tier}${activeSeason.tiers ? '/' + activeSeason.tiers : ''}`,
        sub: t('profile.tier'),
        accent: 'red',
        deco: 'anchor'
      });
    }
    if (ach) {
      const pct = Math.round((ach.unlockedCount / ach.totalCount) * 100);
      tiles.push({ label: t('profile.achievements'), value: `${ach.unlockedCount}/${ach.totalCount}`, sub: pct + '%', accent: 'steel', deco: 'trophy' });
    }

    if (!tiles.length) { el.innerHTML = ''; return; }

    el.innerHTML = `
      <div class="stat-tiles">
        ${tiles.map((x) => `
          <div class="stat-tile tile-${x.accent}">
            ${x.deco ? SOTIcons.mark(x.deco) : ''}
            <div class="stat-tile-label">${x.label}</div>
            <div class="stat-tile-value">${x.value}</div>
            <div class="stat-tile-sub">${x.sub}</div>
          </div>`).join('')}
      </div>`;
  }

  /* ---------- seasons ---------- */
  function renderSeasons() {
    const t = I18N.t;
    const el = document.getElementById('season-section');
    if (!el) return;

    const list = p.season || [];
    if (!list.length) { el.innerHTML = ''; return; }

    /* A season is a card, not a table row: it has a name, a tier out of ten,
       challenges done, and a blurb Rare writes itself. */
    const cards = list.map((s) => `
      <div class="season-card${s.active ? ' season-active' : ''}">
        <!-- Banner slot: assets/img/season-<n>.jpg, removed if absent. -->
        ${s.title ? `<img class="season-banner" alt="" loading="lazy"
             src="assets/img/season-${String(s.title).replace(/\D+/g, '') || 'x'}.jpg"
             onerror="this.remove()" />` : ''}
        <div class="season-head">
          <div>
            <div class="season-name">${s.title || t('profile.season')}</div>
            ${s.copy ? `<div class="season-copy">${s.copy}</div>` : ''}
          </div>
          ${s.active ? SOTBadge.badge(t('profile.activeSeason'), 'progress') : ''}
        </div>

        <div class="season-tier">
          <span class="season-tier-value">${s.tier != null ? s.tier : '—'}</span>
          ${s.tiers ? `<span class="season-tier-of">/ ${s.tiers}</span>` : ''}
          <span class="season-tier-label">${t('profile.tier')}</span>
        </div>

        <div class="rep-bar-track" role="progressbar" aria-valuenow="${Math.round(s.progress)}" aria-valuemin="0" aria-valuemax="100">
          <div class="rep-bar-fill" style="width:${s.progress}%"></div>
        </div>
        <div class="season-note">${
          s.levels
            ? `${t('profile.level')} ${SOT.formatNumber(s.level)} / ${SOT.formatNumber(s.levels)} — ${s.progress}%`
            : `${s.progress}%`
        }</div>

        ${s.challenges.total ? `
          <div class="season-challenges">
            <span class="season-ch-value">${s.challenges.done}<span class="season-ch-of">/${s.challenges.total}</span></span>
            <span class="season-ch-label">${t('profile.challenges')}</span>
          </div>` : ''}
      </div>`).join('');

    el.innerHTML = `<div class="season-grid">${cards}</div>`;
  }

  /* ---------- tabs ----------
     Only for panels that actually hold something: an empty "Seasons" tab
     is a dead end, and a tab bar of one item is just decoration. */
  function buildTabs() {
    const t = I18N.t;
    const nav = document.getElementById('profile-tabs');
    if (!nav) return;

    const defs = [
      { id: 'tab-overview', key: 'profile.tabOverview' },
      { id: 'tab-companies', key: 'profile.tabCompanies' },
      { id: 'tab-achievements', key: 'profile.tabAchievements' },
      { id: 'tab-seasons', key: 'profile.tabSeasons' }
    ].filter((d) => {
      const panelEl = document.getElementById(d.id);
      return panelEl && panelEl.textContent.trim().length > 0;
    });

    if (defs.length < 2) { nav.innerHTML = ''; return; }

    nav.innerHTML = defs.map((d, i) => `
      <button class="profile-tab${i === 0 ? ' is-active' : ''}" role="tab"
              aria-selected="${i === 0}" data-panel="${d.id}">${t(d.key)}</button>`).join('');

    const show = (id) => {
      defs.forEach((d) => {
        const el = document.getElementById(d.id);
        if (el) el.hidden = d.id !== id;
      });
      nav.querySelectorAll('.profile-tab').forEach((b) => {
        const on = b.dataset.panel === id;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', String(on));
      });
    };

    nav.querySelectorAll('.profile-tab').forEach((b) => {
      b.addEventListener('click', () => show(b.dataset.panel));
    });
    show(defs[0].id);
  }

  dispatch();
})();
