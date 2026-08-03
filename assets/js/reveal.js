/* ============================================================
   Scroll reveal.

   The page had no motion at all: every section was simply there, which
   makes a long page read as a wall. Cards now rise into place as they
   come into view, once, and stay put.

   Three rules this follows, and they are the reason it is short:

     - Motion conveys arrival, nothing else. No parallax, no loops, no
       decoration that repeats while you read.
     - 150–400ms, ease-out. Long enough to notice, short enough not to
       wait for.
     - prefers-reduced-motion is honoured by not running at all — the
       elements are visible from the start, so nothing depends on the
       animation having finished.

   If IntersectionObserver is missing, everything is revealed
   immediately. A page that hides its content behind a feature the
   browser lacks is worse than a page that never animated.
   ============================================================ */
(function () {
  'use strict';

  const SELECTOR = [
    '.ref-row',
    '.news-featured',
    '.news-row',
    '.card',
    '.stat-tile',
    '.currency-card',
    '.season-card',
    '.panel',
    '.hourglass-card'
  ].join(',');

  const reduced = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function reveal(el, delay) {
    if (delay) el.style.transitionDelay = delay + 'ms';
    el.classList.add('is-revealed');
  }

  function run() {
    const items = document.querySelectorAll(SELECTOR);
    if (!items.length) return;

    if (reduced || !('IntersectionObserver' in window)) return;

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        /* Stagger by position within the row, not by index in the whole
           document: a grid should ripple, but the twentieth card should
           not wait two seconds for its turn. */
        reveal(entry.target, Math.min(entry.target.dataset.revealIndex * 60, 240));
        observer.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -40px 0px', threshold: 0.05 });

    const watched = [];
    let group = null;
    let index = 0;
    for (const el of items) {
      if (el.classList.contains('reveal')) continue;   // already handled
      if (el.parentElement !== group) { group = el.parentElement; index = 0; }
      el.dataset.revealIndex = index++;
      el.classList.add('reveal');
      observer.observe(el);
      watched.push(el);
    }

    /* The failsafe, and the reason this function is not just the observer.
       Hiding content at opacity 0 and waiting for a callback means that if
       the callback never comes — a background tab, a restored session, a
       browser that throttles observers on an unpainted page — the content
       is not merely unanimated, it is gone.

       Anything still hidden after a second is shown regardless. Motion is
       a nicety; the text is the point. */
    setTimeout(() => {
      for (const el of watched) {
        if (el.classList.contains('is-revealed')) continue;
        el.style.transitionDelay = '0ms';
        reveal(el);
        observer.unobserve(el);
      }
    }, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }

  /* Sections rendered later — a profile, a leaderboard — are not in the
     DOM when this first runs. */
  document.addEventListener('sot:rendered', run);
})();
