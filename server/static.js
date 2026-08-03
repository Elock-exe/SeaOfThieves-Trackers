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
const PORT = Number(process.env.SITE_PORT || 5501);

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

  fs.readFile(full, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found: ' + rel);
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache'
    });
    res.end(buf);
  });
});

server.listen(PORT, () => {
  console.log(`\n  SoT Tracker site  →  http://localhost:${PORT}`);
  console.log('  no-store: every reload serves what is on disk\n');
});
