/* SotTracker — sottracker.fr
   Creator: Vyros__
   https://github.com/Elock-exe/SeaOfThieves-Trackers */
/* ============================================================
   Build the torn-paper edge that separates sections.

     npm run build:edge

   A straight line between two blocks of colour reads as a web page. An
   irregular one reads as something painted, which is the whole point of
   the Sea of Thieves look.

   Generated rather than drawn by hand for two reasons. It has to TILE:
   the path starts and ends at exactly the same height, so repeating it
   horizontally leaves no seam at any viewport width. And the randomness
   is seeded, so the same edge comes out every run — a shape that changed
   on every build would be impossible to review.

   The result is a mask, not a picture. The colour comes from CSS, so one
   file serves every section whatever its background.
   ============================================================ */

const fs = require('fs');

const W = 480;          // tile width
const H = 58;           // tile height
const BASE = 38;        // resting height of the tear
const WOBBLE = 11;      // how far the baseline drifts
const SPIKES = 5;       // tall drips per tile

/* Mulberry32: a seeded PRNG in six lines. Math.random would give a
   different edge on every build and nobody could review the diff. */
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function build(seed) {
  const rand = rng(seed);
  const STEP = 13;
  const n = Math.round(W / STEP);

  // where the tall drips go, never at the very edges so tiles still meet
  const spikeAt = new Set();
  while (spikeAt.size < SPIKES) spikeAt.add(2 + Math.floor(rand() * (n - 4)));

  const pts = [];
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * W;
    /* First and last point share a height, otherwise the tile shows a
       step every 480px — the one flaw a repeating edge cannot hide. */
    let y = (i === 0 || i === n) ? BASE : BASE + (rand() - 0.5) * 2 * WOBBLE;
    if (spikeAt.has(i)) y = 3 + rand() * 8;
    pts.push([x, y]);
  }

  /* Quadratic segments through the midpoints: the curve stays smooth
     between points while the spikes keep their sharpness. */
  let d = 'M0,' + H + ' L0,' + pts[0][1].toFixed(1);
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    d += ' Q' + x1.toFixed(1) + ',' + y1.toFixed(1) +
         ' ' + ((x1 + x2) / 2).toFixed(1) + ',' + ((y1 + y2) / 2).toFixed(1);
  }
  d += ' L' + W + ',' + pts[pts.length - 1][1].toFixed(1) +
       ' L' + W + ',' + H + ' Z';
  return d;
}

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H +
  '" viewBox="0 0 ' + W + ' ' + H + '" fill="none">' +
  '<path d="' + build(20260902) + '" fill="#000"/></svg>';

const out = process.argv[2] || 'assets/img/torn-edge.svg';
fs.writeFileSync(out, svg);

console.log('  écrit    : ' + out);
console.log('  tuile    : ' + W + ' x ' + H + ' px, répétable sans raccord');
console.log('  taille   : ' + svg.length + ' octets');
console.log('  data-uri : ' + encodeURIComponent(svg).length + ' caractères une fois encodé');

/* ---------------- the brush stroke behind buttons ---------------- */

/* A clean silhouette with wobbly edges still reads as a shape, not as
   paint. What sells it is the dry-brush texture: streaks where the bristles
   ran out, and ends that taper off at an angle instead of stopping square.

   The mask is alpha-based, so the stroke is built from horizontal bands
   rather than one path. A band at less than full opacity lets the page
   show through, which is exactly what a thin patch of paint does. Bands
   also make the tapering ends free: the outer ones simply start later and
   finish earlier.
*/
function brush(seed) {
  const rand = rng(seed);
  const BW = 320, BH = 56;
  const BANDS = 9;
  const jitter = (amp) => (rand() - 0.5) * 2 * amp;

  const bands = [];
  for (let b = 0; b < BANDS; b++) {
    const t = b / (BANDS - 1);              // 0 en haut, 1 en bas
    const y0 = 2 + t * (BH - 6);
    const h = (BH - 6) / BANDS + 1.6;       // les bandes se chevauchent un peu

    /* Les bords du trait sont plus secs que le centre : moins d'encre en
       haut et en bas, d'ou une opacite plus faible et un retrait lateral. */
    const edge = Math.abs(t - 0.5) * 2;     // 0 au centre, 1 aux extremites
    const alpha = 1 - edge * 0.14 - rand() * 0.06;

    const left = 2 + edge * 4 + rand() * 3;
    const right = BW - 2 - edge * 5 - rand() * 4;

    const pts = [];
    const n = 7;
    for (let i = 0; i <= n; i++) {
      const x = left + (i / n) * (right - left);
      pts.push([x, y0 + jitter(1.1)]);
    }

    let d = 'M' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1);
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      d += ' Q' + x1.toFixed(1) + ',' + y1.toFixed(1) + ' ' +
           ((x1 + x2) / 2).toFixed(1) + ',' + ((y1 + y2) / 2).toFixed(1);
    }
    d += ' L' + pts[pts.length - 1][0].toFixed(1) + ',' + (pts[pts.length - 1][1] + h).toFixed(1);
    for (let i = pts.length - 1; i > 0; i--) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i - 1];
      d += ' Q' + x1.toFixed(1) + ',' + (y1 + h).toFixed(1) + ' ' +
           ((x1 + x2) / 2).toFixed(1) + ',' + ((y1 + y2) / 2 + h).toFixed(1);
    }
    d += ' Z';

    bands.push('<path d="' + d + '" fill="#000" fill-opacity="' +
               Math.max(0.78, Math.min(1, alpha)).toFixed(2) + '"/>');
  }

  /* Deux ou trois manques francs, comme une bulle d'air sous le pinceau. */
  const gaps = [];
  for (let g = 0; g < 2; g++) {
    const cx = 40 + rand() * (BW - 90);
    const cy = 8 + rand() * (BH - 18);
    gaps.push('<ellipse cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) +
              '" rx="' + (5 + rand() * 9).toFixed(1) + '" ry="' + (0.9 + rand() * 1.2).toFixed(1) +
              '" fill="#fff"/>');
  }

  return { BW, BH, body: bands.join(''), gaps: gaps.join('') };
}

const b = brush(19091109);

/* Les manques sont retires par un <mask> : dessiner du blanc par-dessus ne
   baisserait pas l'alpha, il faut le decouper. */
const brushSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="' + b.BW + '" height="' + b.BH +
  '" viewBox="0 0 ' + b.BW + ' ' + b.BH + '">' +
  '<mask id="g" maskUnits="userSpaceOnUse" x="0" y="0" width="' + b.BW + '" height="' + b.BH + '">' +
  '<rect width="' + b.BW + '" height="' + b.BH + '" fill="#fff"/>' +
  b.gaps.split('fill="#fff"').join('fill="#000"') +
  '</mask>' +
  '<g mask="url(#g)">' + b.body + '</g>' +
  '</svg>';

fs.writeFileSync('assets/img/brush.svg', brushSvg);
console.log('  écrit    : assets/img/brush.svg  (' + b.BW + ' x ' + b.BH + ', ' + brushSvg.length + ' octets)');
console.log('             9 bandes, opacité variable, 3 manques découpés');

/* ---------------- the painted ground ---------------- */

/* This was an SVG: 384 stroked paths under a feGaussianBlur, used as a mask
   in eight places — including a fixed, full-viewport layer behind the whole
   page. A browser has to rasterise that filter, and a fixed masked layer is
   re-rasterised as content scrolls under it. The site crawled.
   
   It is a bitmap now. The strokes are drawn here, blurred here, and shipped
   as pixels, so the browser uploads a texture once and never computes
   anything again. Same picture, none of the cost.

   Half resolution, scaled up by CSS: this is a soft blurred texture with no
   edge anyone can focus on, and halving each side quarters the bytes.
*/
function paintBitmap(seed) {
  const W = 450, H = 360;          // affiche a 900x720
  const rand = rng(seed);
  const a = new Float32Array(W * H);

  /* Un disque doux estampe le long de la courbe : c'est ce qui donne le
     poil, la ou un trait plein donnerait un ruban. */
  const stamp = (cx, cy, r, force) => {
    const x0 = Math.max(0, (cx - r) | 0), x1 = Math.min(W - 1, (cx + r) | 0);
    const y0 = Math.max(0, (cy - r) | 0), y1 = Math.min(H - 1, (cy + r) | 0);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - cx, y - cy) / r;
        if (d >= 1) continue;
        const v = force * (1 - d * d);
        const i = y * W + x;
        if (v > a[i]) a[i] = v;
      }
    }
  };

  const COUPS = 4;
  for (let s = 0; s < COUPS; s++) {
    const cx = rand() * W, cy = rand() * H;
    const angle = ((rand() - 0.5) * 44) * Math.PI / 180;
    const len = (210 + rand() * 280);
    const largeur = 35 + rand() * 60;
    const poils = 16 + Math.floor(rand() * 22);
    const courbe = (rand() - 0.5) * 13;

    for (let b = 0; b < poils; b++) {
      const t = b / (poils - 1) - 0.5;
      const bord = Math.abs(t) * 2;
      const off = t * largeur;

      /* Chaque poil demarre et s'arrete ou il veut : c'est ce qui effile
         les bouts au lieu de les couper net. */
      const d0 = (rand() * 0.2 + bord * 0.16) * len;
      const d1 = len - (rand() * 0.22 + bord * 0.18) * len;
      if (d1 - d0 < 16) continue;

      const force = (0.5 + rand() * 0.5) * (1 - bord * 0.34);
      const ep = 1 + rand() * 2.6;

      for (let d = d0; d <= d1; d += 1.1) {
        const p = (d - d0) / (d1 - d0);
        const o = off + Math.sin(p * Math.PI) * courbe;
        const x = cx + Math.cos(angle) * (d - len / 2) - Math.sin(angle) * o;
        const y = cy + Math.sin(angle) * (d - len / 2) + Math.cos(angle) * o;

        /* Repete sur les tuiles voisines pour que le motif se raccorde. */
        for (const dx of [-W, 0, W]) {
          for (const dy of [-H, 0, H]) {
            const px = x + dx, py = y + dy;
            if (px < -20 || px > W + 20 || py < -20 || py > H + 20) continue;
            stamp(px, py, ep, force);
          }
        }
      }
    }
  }

  /* Flou par boite, deux passes : approche un gaussien pour une fraction du
     cout, et personne ne peut faire la difference sur une texture. */
  const flou = (r) => {
    const tmp = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let s = 0, n = 0;
        for (let k = -r; k <= r; k++) { const xx = x + k; if (xx < 0 || xx >= W) continue; s += a[y * W + xx]; n++; }
        tmp[y * W + x] = s / n;
      }
    }
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        let s = 0, n = 0;
        for (let k = -r; k <= r; k++) { const yy = y + k; if (yy < 0 || yy >= H) continue; s += tmp[yy * W + x]; n++; }
        a[y * W + x] = s / n;
      }
    }
  };
  flou(2); flou(2);

  return { W, H, a };
}

/* Encodage PNG en niveaux de gris + alpha. Seul l'alpha compte pour un
   masque CSS, mais PNG n'a pas de type "alpha seul" : le gris reste a zero
   et se compresse a rien. */
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const zlib = require('zlib');
const p = paintBitmap(31071842);

/* Filtre 1 (Sub) sur chaque ligne : les valeurs voisines se ressemblent sur
   une texture floue, donc les differences compressent bien mieux que les
   valeurs brutes. */
const raw = Buffer.alloc(p.H * (p.W * 2 + 1));
let q = 0;
for (let y = 0; y < p.H; y++) {
  raw[q++] = 1;
  let precG = 0, precA = 0;
  for (let x = 0; x < p.W; x++) {
    const alpha = Math.round(Math.min(1, p.a[y * p.W + x]) * 255);
    raw[q++] = (0 - precG) & 0xff;
    raw[q++] = (alpha - precA) & 0xff;
    precG = 0; precA = alpha;
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(p.W, 0); ihdr.writeUInt32BE(p.H, 4);
ihdr[8] = 8; ihdr[9] = 4;            // 8 bits, niveaux de gris + alpha

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

fs.writeFileSync('assets/img/paint.png', png);
try { fs.unlinkSync('assets/img/paint.svg'); } catch (e) { /* deja parti */ }

console.log('  écrit    : assets/img/paint.png  (' + p.W + ' x ' + p.H +
            ', ' + Math.round(png.length / 1024) + ' Ko)');
console.log('             bitmap : plus aucun filtre a recalculer');
