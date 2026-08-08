/* ============================================================
   Where the site looks for its API.

   The site and the API are deployed to two different hosts, so the
   front-end has to be told where the API lives. One file, one line, no
   build step.

   The address is chosen from the page's own origin, so the same commit
   works locally and in production without anyone editing a value before
   pushing.

   Read by assets/js/data.js as window.SOT_API_BASE.
   ============================================================ */
(function () {
  'use strict';

  /* Which API this page talks to, decided by where the page itself came
     from rather than by a value someone has to remember to change.

     A single hardcoded address would be wrong half the time: point it at
     production and local development writes test data into the real
     database; point it at localhost and every visitor of the published
     site gets nothing, because nothing is listening on their machine. */
  const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  window.SOT_API_BASE = LOCAL
    ? 'http://localhost:8787'
    : 'https://sot-tracker-api-8vqc.onrender.com';

  /* An HTTPS page cannot call http://localhost — browsers block it as
     mixed content. That combination can only come from a misedit here,
     and it fails silently, so name it. */
  if (location.protocol === 'https:' && /^http:/.test(window.SOT_API_BASE)) {
    console.warn(
      '[SoT Tracker] This HTTPS page points at an http:// API (' +
      window.SOT_API_BASE + '). Browsers block that as mixed content.'
    );
  }
})();
