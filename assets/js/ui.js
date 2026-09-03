/* SotTracker — sottracker.fr
   Creator: Vyros__
   https://github.com/Elock-exe/SeaOfThieves-Trackers */
/* Shared chrome: topbar, subnav, footer, search wiring. */
(function (global) {
  'use strict';

  const LOGO_SVG = `
    <svg width="30" height="30" viewBox="0 0 26 26" xmlns="http://www.w3.org/2000/svg">
      <circle cx="13" cy="13" r="12.5" fill="var(--teal)"/>
      <path d="M16,13 L22,13 M15.1,15.1 L19.4,19.4 M13,16 L13,22 M10.9,15.1 L6.6,19.4 M10,13 L4,13 M10.9,10.9 L6.6,6.6 M13,10 L13,4 M15.1,10.9 L19.4,6.6" stroke="#0f1923" stroke-width="1.5" stroke-linecap="round"/>
      <circle cx="13" cy="13" r="3.1" fill="#0f1923"/>
    </svg>`;

  const SEARCH_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M21 21l-4.3-4.3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

  const GLOBE_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.8 2.6 2.8 15.4 0 18M12 3c-2.8 2.6-2.8 15.4 0 18"/></svg>`;

  function langPickerHTML() {
    const opts = I18N.LANGS.map(
      (l) => `<button type="button" class="lang-option" data-lang="${l.code}">${l.label}</button>`
    ).join('');
    return `
      <div class="lang-picker">
        <button type="button" class="lang-toggle" aria-haspopup="true" aria-expanded="false">
          ${GLOBE_SVG}<span class="lang-current"></span>
          <svg class="lang-caret" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <div class="lang-menu">${opts}</div>
      </div>`;
  }

  /* One bar, not two.

     The site had a topbar for the brand and a subnav for the links, stacked,
     eating 108px before any content. Rare puts everything on one line: mark
     left, passage centre, actions right. It is the shape every game site
     settles on, and it gives back half the height.

     The nav is the middle column of a three-column grid rather than a
     flex child, so it stays centred on the page no matter how wide the
     brand or the actions grow — with flex, a long gamertag in the corner
     would push the whole menu off-centre. */
  function headerHTML(active) {
    const items = [
      { href: '/', label: 'Home', key: 'nav.home' },
      { href: '/import', label: 'Import account', key: 'nav.import' },
      { href: '/leaderboards', label: 'Leaderboards', key: 'nav.leaderboards' },
      { href: '/#community', label: 'Community', key: 'nav.community' }
    ];

    const links = items.map((it) => {
      const isActive = it.label === active;
      return `<a href="${it.href}" class="${isActive ? 'active' : ''}" data-i18n="${it.key}">${it.label}</a>`;
    }).join('');

    return `
    <header class="topbar">
      <div class="topbar-inner">

        <a class="brand" href="/">${LOGO_SVG}<span>Sea of Thieves <span class="brand-sub">Tracker</span></span></a>

        <nav class="topnav">${links}</nav>

        <div class="topbar-actions">
          <a class="topbar-icon" href="/#search" aria-label="Search">${SEARCH_SVG}</a>
          ${langPickerHTML()}
          <a class="btn-track" href="/#search" data-i18n="top.track">Track a Pirate</a>
          <span id="topbar-me"></span>
        </div>

      </div>
    </header>`;
  }

  function footerHTML() {
    return `
    <footer>
      <div class="container">
        <div class="footer-grid">
          <div class="footer-brand">
            <a class="brand" href="/">${LOGO_SVG}<span>Sea of Thieves Tracker</span></a>
            <p data-i18n="footer.tagline">Unofficial stats, leaderboards and voyage guides for Sea of Thieves pirates. Not affiliated with Rare or Microsoft.</p>
          </div>
          <div class="footer-cols">
            <div class="footer-col">
              <h4 data-i18n="footer.explore">Explore</h4>
              <a href="/" data-i18n="nav.home">Home</a>
              <a href="/leaderboards" data-i18n="nav.leaderboards">Leaderboards</a>
              <a href="/profile" data-i18n="footer.profile">Player Profile</a>
              <a href="/privacy" data-i18n="footer.privacy">Privacy</a>
            </div>
            <div class="footer-col">
              <h4 data-i18n="footer.guides">Guides</h4>
              <a href="/#voyages" data-i18n="footer.voyageTypes">Voyage Types</a>
              <a href="/#companies" data-i18n="nav.companies">Trading Companies</a>
            </div>
            <div class="footer-col">
              <h4 data-i18n="footer.official">Official</h4>
              <a href="https://www.seaofthieves.com" target="_blank" rel="noopener">Sea of Thieves</a>
              <a href="https://www.xbox.com" target="_blank" rel="noopener">Xbox</a>
            </div>
          </div>
        </div>
        <div class="footer-bottom">
          <span>&copy; ${new Date().getFullYear()} Sea of Thieves Tracker &middot; <span data-i18n="footer.copy">Fan-made project</span></span>
          <span class="demo-badge" data-i18n="footer.demo">Real data from Steam, Xbox Live and — if you link it — your own Sea of Thieves account. Nothing here is generated.</span>
        </div>
        <div class="footer-legal">
          Sea of Thieves &copy; Microsoft Corporation. Sea of Thieves Tracker was created under
          Microsoft&rsquo;s <a href="https://www.xbox.com/en-US/developers/rules" target="_blank" rel="noopener">&ldquo;Game Content Usage Rules&rdquo;</a>
          using assets from Sea of Thieves, and it is not endorsed by or affiliated with Microsoft.
        </div>
      </div>
    </footer>`;
  }

  function wireLangPicker() {
    const picker = document.querySelector('.lang-picker');
    if (!picker) return;
    const toggle = picker.querySelector('.lang-toggle');
    const label = picker.querySelector('.lang-current');

    function syncLabel() {
      const match = I18N.LANGS.find((l) => l.code === I18N.get());
      label.textContent = match ? match.label : 'English';
      picker.querySelectorAll('.lang-option').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.lang === I18N.get());
      });
    }

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = picker.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });

    picker.querySelectorAll('.lang-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        I18N.set(btn.dataset.lang);
        picker.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });

    document.addEventListener('click', () => {
      picker.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    });

    document.addEventListener('sot:langchange', syncLabel);
    syncLabel();
  }


  /* The pirate this browser has claimed, shown top-right the way every
     account-bearing site does it.

     Drawn from localStorage alone, with initials rather than a fetched
     avatar: the header renders on every page, and one network request per
     page load to draw a 28px circle is a bad trade. The real avatar is
     already on the profile page, which is one click away.

     Re-rendered on sot:claim so the chip appears the moment someone
     presses "This is my pirate", without a reload. */
  function renderMe() {
    const slot = document.getElementById('topbar-me');
    if (!slot || typeof SOT === 'undefined') return;

    const name = SOT.syncedOwner();
    if (!name) { slot.innerHTML = ''; return; }

    const url = '/profile?player=' + encodeURIComponent(name);
    slot.innerHTML =
      '<a class="topbar-me" href="' + url + '" title="' + esc(name) + '">' +
        '<span class="topbar-me-av" style="background:' + SOT.avatarColor(name) + '">' +
          esc(SOT.initials(name)) +
        '</span>' +
        '<span class="topbar-me-name">' + esc(name) + '</span>' +
      '</a>';
  }

  /* The name comes from the pirate's own gamertag, so it goes through the
     same escaping as anything else a stranger chose. */
  function esc(v) {
    return String(v).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }
  function mount(activeNav) {
    document.body.insertAdjacentHTML('afterbegin', headerHTML(activeNav));
    document.body.insertAdjacentHTML('beforeend', footerHTML());

    I18N.init();
    wireLangPicker();
    renderMe();
    document.addEventListener('sot:claim', renderMe);

    const form = document.getElementById('nav-search-form');
    if (form) {
      form.addEventListener('submit', function (e) {
        const input = form.querySelector('input');
        if (!input.value.trim()) {
          e.preventDefault();
        }
      });
    }
  }

  global.SOTUI = { mount, LOGO_SVG };
})(window);
