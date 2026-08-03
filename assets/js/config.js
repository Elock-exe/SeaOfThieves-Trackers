/* ============================================================
   Where the site looks for its API.

   Local development needs nothing: the default is localhost:8787.

   When the tracker is deployed, the site and the API live on two
   different hosts, so the front-end has to be told the API's address.
   Putting it here — one line, no build step — means deploying does not
   require editing source files scattered across the project.

   The value is read by assets/js/data.js as window.SOT_API_BASE.
   ============================================================ */
(function () {
  'use strict';

  /* Set this to the deployed API when going live, e.g.
       window.SOT_API_BASE = 'https://sot-tracker-api.onrender.com';
     Leave it undefined and the site talks to localhost, which is what
     you want while developing. */
  // window.SOT_API_BASE = 'https://your-api.onrender.com';

  /* A deployed page served over HTTPS cannot call http://localhost —
     browsers block it as mixed content. Saying so here turns a silent
     "nothing loads" into an explanation. */
  if (location.protocol === 'https:' && !window.SOT_API_BASE) {
    console.warn(
      '[SoT Tracker] This page is served over HTTPS but no API address is set. ' +
      'Edit assets/js/config.js and set window.SOT_API_BASE to your deployed API.'
    );
  }
})();
