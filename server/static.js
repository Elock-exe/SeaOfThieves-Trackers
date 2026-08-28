/* SotTracker — sottracker.fr
   Creator: Vyros__
   https://github.com/Elock-exe/SeaOfThieves-Trackers */
/* ============================================================
   Static file server for the front-end.

   This replaces `python -m http.server`, which sends no cache headers
   at all. Chrome then caches the HTML and the scripts on its own terms,
   so an edited page keeps serving the old version — including the old
   copies of data.js and profile.js. Every fix looked like it had not
   been applied.

   Development wants the opposite of caching: always serve what is on
   disk. Hence no-store on everything.
   ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
/* PORT first: tooling that assigns a free port sets that one. SITE_PORT
   stays for running the site and the API side by side by hand, and 5501
   is the fallback the docs quote. */
const PORT = Number(process.env.PORT || process.env.SITE_PORT || 5501);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';

  /* Resolve inside ROOT only — a path like /../.env must not escape it. */
  const full = path.resolve(ROOT, '.' + rel);
  if (!full.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  /* .env sits in this directory and holds API keys. It is never part of
     the site, so it is refused outright rather than relying on nobody
     guessing the name. */
  if (path.basename(full) === '.env' || rel.startsWith('/data/')) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  /* Clean URLs, matching what Netlify does in production: /profile serves
     profile.html. Without this every internal link 404s locally while
     working perfectly once deployed — the worst way round to find a bug.
     Only extensionless paths are tried this way, so a genuinely missing
     asset still 404s as itself instead of being masked by a stray page. */
  function send(file, buf) {
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache'
    });
    res.end(buf);
  }

  fs.readFile(full, (err, buf) => {
    if (!err) { send(full, buf); return; }

    if (path.extname(full)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found: ' + rel);
      return;
    }

    fs.readFile(full + '.html', (err2, buf2) => {
      if (err2) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found: ' + rel);
        return;
      }
      send(full + '.html', buf2);
    });
  });
});

server.listen(PORT, () => {
  console.log(`\n  SoT Tracker site  →  http://localhost:${PORT}`);
  console.log('  no-store: every reload serves what is on disk\n');
});
