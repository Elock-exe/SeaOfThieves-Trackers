/* ============================================================
   Decorative marks.

   Every stat card was a bare rectangle: a label, a number, and a lot of
   flat background. These sit behind the number as a large, low-opacity
   watermark — the card reads as "gold" or "reputation" before the text
   is parsed, and the page stops looking like an unstyled form.

   Deliberately monochrome and drawn from currentColor: each card already
   carries an accent colour, and the mark inherits it rather than adding
   a second palette to keep in sync.
   ============================================================ */
(function (global) {
  'use strict';

  const MARKS = {
    coins: '<circle cx="9" cy="9" r="6"/><path d="M15.5 4.2a6 6 0 0 1 0 11.6"/><path d="M18 7.5a6 6 0 0 1 0 9"/>',
    doubloon: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10h5M9.5 14h5"/>',
    ancient: '<path d="M12 3l2.4 5.4 5.6.6-4.2 3.9 1.2 5.6L12 15.7 7 18.5l1.2-5.6L4 9l5.6-.6z"/>',
    hourglass: '<path d="M6 2h12M6 22h12"/><path d="M8 2v3.5c0 2 4 4.5 4 6.5s-4 4.5-4 6.5V22"/><path d="M16 2v3.5c0 2-4 4.5-4 6.5s4 4.5 4 6.5V22"/>',
    shield: '<path d="M12 2l8 3.5v6c0 5-3.4 9.3-8 10.5-4.6-1.2-8-5.5-8-10.5v-6z"/>',
    trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3"/><path d="M10 14h4v3h-4z"/><path d="M8 20h8"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    skull: '<path d="M12 3a7 7 0 0 0-7 7c0 3 1.5 4.8 2.5 6h9c1-1.2 2.5-3 2.5-6a7 7 0 0 0-7-7z"/><circle cx="9.3" cy="10" r="1.2"/><circle cx="14.7" cy="10" r="1.2"/><path d="M9 16v3M12 16v4M15 16v3"/>',
    anchor: '<circle cx="12" cy="5" r="2.5"/><path d="M12 7.5V21"/><path d="M5 13a7 7 0 0 0 14 0"/><path d="M8 11H4M20 11h-4"/>',
    wheel: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2.1 2.1M16.9 16.9L19 19M19 5l-2.1 2.1M7.1 16.9L5 19"/>'
  };

  /** A big faint mark for a card corner. */
  function mark(name, cls) {
    const d = MARKS[name];
    if (!d) return '';
    return `<svg class="deco-mark ${cls || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
      `stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  }

  global.SOTIcons = { mark, MARKS };
})(window);
