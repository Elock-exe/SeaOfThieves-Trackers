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

/* Soft ellipses gave blobs, not brushwork. What makes a stroke read as a
   stroke is the bristles: a dozen thin filaments running parallel, of
   unequal length, thinning out at both ends where the brush lands and
   lifts. A blurred oval has none of that, and no amount of opacity fixes it.
*/
function stroke(rand, cx, cy, angle) {
  const len = 420 + rand() * 560;
  const width = 70 + rand() * 120;
  const bristles = 16 + Math.floor(rand() * 22);
  const sag = (rand() - 0.5) * 26;        // a brush is dragged, not ruled
  const out = [];

  for (let b = 0; b < bristles; b++) {
    /* Spread across the width, denser in the middle: the outer bristles
       carry less ink, which is what frays the edge of a real stroke. */
    const t = b / (bristles - 1) - 0.5;
    const off = t * width;
    const edge = Math.abs(t) * 2;

    /* Each filament starts and stops at its own point. Bristles that lift
       early are what make the ends taper instead of stopping square. */
    const a0 = (rand() * 0.22 + edge * 0.16) * len;
    const a1 = len - (rand() * 0.24 + edge * 0.18) * len;
    if (a1 - a0 < 22) continue;

    const pt = (d, o) => {
      const x = cx + Math.cos(angle) * (d - len / 2) - Math.sin(angle) * o;
      const y = cy + Math.sin(angle) * (d - len / 2) + Math.cos(angle) * o;
      return [x, y];
    };

    const [x0, y0] = pt(a0, off + (rand() - 0.5) * 4);
    const [xm, ym] = pt((a0 + a1) / 2, off + sag + (rand() - 0.5) * 6);
    const [x1, y1] = pt(a1, off + (rand() - 0.5) * 4);

    const op = (0.55 + rand() * 0.45) * (1 - edge * 0.34);
    const w = (1.8 + rand() * 5.4).toFixed(1);

    out.push('<path d="M' + x0.toFixed(1) + ',' + y0.toFixed(1) +
      ' Q' + xm.toFixed(1) + ',' + ym.toFixed(1) + ' ' + x1.toFixed(1) + ',' + y1.toFixed(1) +
      '" stroke="#000" stroke-width="' + w + '" stroke-linecap="round" fill="none"' +
      ' stroke-opacity="' + Math.max(0.12, op).toFixed(2) + '"/>');
  }
  return out.join('');
}

function paint(seed) {
  const rand = rng(seed);
  const PW = 900, PH = 720;
  const marks = [];

  for (let i = 0; i < 4; i++) {
    const cx = rand() * PW;
    const cy = rand() * PH;
    /* Shallow angles only. Strokes near vertical read as scratches, and a
       page is scanned horizontally — the paint should follow that. */
    const angle = ((rand() - 0.5) * 44) * Math.PI / 180;

    /* A stroke that crosses a tile edge has to come back on the other side,
       or the repeat shows up as a grid — the exact thing this texture was
       brought in to replace. But only strokes NEAR an edge need the copy:
       duplicating all nine positions blindly made the file seven times
       bigger for shapes that never appeared. */
    const REACH = 560;
    const xs = [0];
    if (cx < REACH) xs.push(PW); else if (cx > PW - REACH) xs.push(-PW);
    const ys = [0];
    if (cy < REACH) ys.push(PH); else if (cy > PH - REACH) ys.push(-PH);

    for (const dx of xs) {
      for (const dy of ys) {
        marks.push(stroke(rng(seed + i * 977), cx + dx, cy + dy, angle));
      }
    }
  }

  return { PW, PH, marks: marks.join('') };
}

const p = paint(31071842);
const paintSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="' + p.PW + '" height="' + p.PH +
  '" viewBox="0 0 ' + p.PW + ' ' + p.PH + '">' +
  '<defs><filter id="s" x="-5%" y="-5%" width="110%" height="110%">' +
  '<feGaussianBlur stdDeviation="0.7"/></filter></defs>' +
  '<g filter="url(#s)">' + p.marks + '</g></svg>';

fs.writeFileSync('assets/img/paint.svg', paintSvg);
console.log('  écrit    : assets/img/paint.svg  (' + p.PW + ' x ' + p.PH +
            ', ' + Math.round(paintSvg.length / 1024) + ' Ko, répétable)');
console.log('             16 coups de pinceau, filaments de poils, bouts effilés');

/* ---------------- torn cards ---------------- */

/* A card torn on all four sides, not just the top. The section separators
   are a single wavy line; this is a closed shape, and it has to survive
   being stretched over cards of wildly different proportions — a stat chip
   is wide and short, a company card is tall.

   Which is why it is built for `mask-border` (nine-slice): the four corners
   keep their size and the four edges repeat between them. Stretching the
   whole thing instead would smear the tear on a wide card and crush it on a
   narrow one, and the raggedness would stop looking like paper.
*/
function tornCard(seed) {
  const rand = rng(seed);
  const S = 220;          // tile side
  const IN = 16;          // how far the tear bites inward
  const STEP = 11;

  /* Points along one edge, from (0,0) toward (S,0), pushed inward by a
     random amount. Corners stay put so the four sides meet. */
  function edge(len, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const corner = Math.min(t, 1 - t) * 4;        // 0 aux coins, 1 au milieu
      const bite = i === 0 || i === n ? 0 : (0.3 + rand() * 0.7) * IN * Math.min(1, corner);
      pts.push([t * len, bite]);
    }
    return pts;
  }

  const n = Math.round(S / STEP);
  const top = edge(S, n);
  const right = edge(S, n);
  const bottom = edge(S, n);
  const left = edge(S, n);

  /* Chaque bord est decrit dans son propre repere puis pivote a sa place. */
  const map = {
    top:    ([x, y]) => [x, y],
    right:  ([x, y]) => [S - y, x],
    bottom: ([x, y]) => [S - x, S - y],
    left:   ([x, y]) => [y, S - x]
  };

  let d = '';
  [['top', top], ['right', right], ['bottom', bottom], ['left', left]].forEach(([nom, pts], idx) => {
    pts.forEach((p, i) => {
      const [x, y] = map[nom](p);
      if (idx === 0 && i === 0) d += 'M' + x.toFixed(1) + ',' + y.toFixed(1);
      else d += ' L' + x.toFixed(1) + ',' + y.toFixed(1);
    });
  });
  d += ' Z';

  return { S, IN, d };
}

const tc = tornCard(70518823);
const cardSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + tc.S + '" height="' + tc.S +
  '" viewBox="0 0 ' + tc.S + ' ' + tc.S + '"><path d="' + tc.d + '" fill="#000"/></svg>';

fs.writeFileSync('assets/img/torn-card.svg', cardSvg);
console.log('  écrit    : assets/img/torn-card.svg  (' + tc.S + ' x ' + tc.S +
            ', découpe à ' + (tc.IN + 8) + 'px, ' + cardSvg.length + ' octets)');
