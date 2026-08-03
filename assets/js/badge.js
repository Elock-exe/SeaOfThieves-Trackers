/* ============================================================
   Status badge — the shadcn/lucide "status-badge" component, rebuilt
   for this project's stack.

   The original is React + Tailwind + TypeScript. Adding those here
   would mean a bundler and a rewrite of four pages, the i18n layer and
   the whole stylesheet, to end up with the same pill. So the design is
   kept and the implementation is plain DOM.

   Two deliberate changes from the source:

   1. Colours. The original pairs a light tint (bg-orange-50) with a
      mid-tone text (#EAA65D) — a light-mode palette. On this near-black
      background that tint would glow white. Each variant instead uses a
      low-alpha wash of its own hue, keeping the text colour, which holds
      the 4.5:1 contrast the light version had.

   2. Icons are inlined rather than imported from lucide-react: same
      paths, same 3px stroke, no npm dependency for six glyphs.
   ============================================================ */
(function (global) {
  'use strict';

  /* Lucide paths, 24x24, traced from the icons the component imports. */
  const ICONS = {
    check:    '<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>',
    dashed:   '<path d="M10.1 2.182a10 10 0 0 1 3.8 0"/><path d="M13.9 21.818a10 10 0 0 1-3.8 0"/><path d="M17.609 3.721a10 10 0 0 1 2.69 2.7"/><path d="M2.182 13.9a10 10 0 0 1 0-3.8"/><path d="M20.279 17.609a10 10 0 0 1-2.7 2.69"/><path d="M21.818 10.1a10 10 0 0 1 0 3.8"/><path d="M3.721 6.391a10 10 0 0 1 2.7-2.69"/><path d="M6.391 20.279a10 10 0 0 1-2.69-2.7"/>',
    x:        '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
    clock:    '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l3.5 2"/>',
    scan:     '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3"/><path d="m16 16-1.9-1.9"/>',
    warning:  '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    star:     '<path d="M11.5 2.5a.5.5 0 0 1 1 0l2.6 5.3 5.8.8a.5.5 0 0 1 .3.9l-4.2 4.1 1 5.8a.5.5 0 0 1-.8.5L12 17.2l-5.2 2.7a.5.5 0 0 1-.8-.5l1-5.8-4.2-4.1a.5.5 0 0 1 .3-.9l5.8-.8z"/>'
  };

  /* Variant → icon. The names follow the source component so the mapping
     stays obvious; the site's own meanings are layered on top. */
  const VARIANTS = {
    success:  'check',
    progress: 'dashed',
    failed:   'x',
    pending:  'warning',
    review:   'scan',
    expired:  'clock',
    submitted: 'clock',
    star:     'star'
  };

  /**
   * @param {string} label   visible text
   * @param {string} variant one of VARIANTS
   * @param {object} [opts]  { title, icon }
   */
  function badge(label, variant, opts) {
    const o = opts || {};
    const icon = ICONS[o.icon || VARIANTS[variant] || 'check'];
    const title = o.title ? ` title="${String(o.title).replace(/"/g, '&quot;')}"` : '';
    return `<span class="badge badge-${variant}"${title}>` +
      `<svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
      `stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>` +
      `<span class="badge-text">${label}</span></span>`;
  }

  global.SOTBadge = { badge, ICONS, VARIANTS };
})(window);
