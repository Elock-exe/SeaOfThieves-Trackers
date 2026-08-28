/* SotTracker — sottracker.fr
   Creator: Vyros__
   https://github.com/Elock-exe/SeaOfThieves-Trackers */
/* ============================================================
   Lightweight i18n engine. Translation tables live in
   translations.js (loaded first).

   Markup opts in with:
     data-i18n="key"                     → sets textContent
     data-i18n-attr="placeholder:key"    → sets an attribute
     data-i18n-vars='{"region":"EU"}'    → {placeholders} in the string

   Choice persists in localStorage and applies across pages.
   ============================================================ */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'sot-lang';
  const LANGS = global.SOT_LANGS;
  const STRINGS = global.SOT_STRINGS;

  // Spanish-speaking Latin American regions map to the es-419 table.
  const LATAM = ['MX', 'AR', 'CO', 'CL', 'PE', 'VE', 'EC', 'GT', 'CU', 'BO',
                 'DO', 'HN', 'PY', 'SV', 'NI', 'CR', 'PA', 'UY', 'PR'];

  let current = 'en';

  function normalize(tag) {
    if (!tag) return null;
    const raw = tag.replace('_', '-');
    const [base, region] = raw.split('-');
    const lower = base.toLowerCase();

    // exact table hit (zh-TW, es-419)
    const exact = Object.keys(STRINGS).find((c) => c.toLowerCase() === raw.toLowerCase());
    if (exact) return exact;

    if (lower === 'es' && region && LATAM.includes(region.toUpperCase())) return 'es-419';
    if (lower === 'zh') return 'zh-TW';           // only Traditional is shipped
    if (STRINGS[lower]) return lower;
    return null;
  }

  function detect() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && STRINGS[saved]) return saved;

    const candidates = navigator.languages && navigator.languages.length
      ? navigator.languages
      : [navigator.language];

    for (const tag of candidates) {
      const hit = normalize(tag);
      if (hit) return hit;
    }
    return 'en';
  }

  function isRTL(code) {
    const entry = LANGS.find((l) => l.code === code);
    return !!(entry && entry.rtl);
  }

  function interpolate(str, vars) {
    if (!vars) return str;
    return str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  }

  function t(key, vars) {
    const table = STRINGS[current] || STRINGS.en;
    const val = table[key] != null ? table[key] : STRINGS.en[key];
    return val == null ? key : interpolate(val, vars);
  }

  function parseVars(el) {
    const raw = el.getAttribute('data-i18n-vars');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function apply(root) {
    const scope = root || document;

    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'), parseVars(el));
    });

    scope.querySelectorAll('[data-i18n-attr]').forEach((el) => {
      el.getAttribute('data-i18n-attr').split(';').forEach((pair) => {
        const idx = pair.indexOf(':');
        if (idx < 0) return;
        const attr = pair.slice(0, idx).trim();
        const key = pair.slice(idx + 1).trim();
        if (attr && key) el.setAttribute(attr, t(key, parseVars(el)));
      });
    });

    document.documentElement.lang = current;
    document.documentElement.dir = isRTL(current) ? 'rtl' : 'ltr';
  }

  function set(code) {
    if (!STRINGS[code]) return;
    current = code;
    localStorage.setItem(STORAGE_KEY, code);
    apply();
    document.dispatchEvent(new CustomEvent('sot:langchange', { detail: { lang: code } }));
  }

  function get() { return current; }

  function init() {
    current = detect();
    apply();
  }

  global.I18N = { init, apply, set, get, t, isRTL, LANGS };
})(window);
