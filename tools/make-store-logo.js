/* SotTracker — sottracker.fr
   Creator: Vyros__
   https://github.com/Elock-exe/SeaOfThieves-Trackers */
/* Render the site's compass mark to a 300x300 PNG for the Edge store listing.

   Written as a rasteriser rather than a canvas export on purpose: the base64
   round trip through a chat corrupted the image once already. This produces
   the file deterministically, and can be re-run to prove the same bytes. */

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const SIZE = 300;
const SS = 4;                       // supersampling factor, for smooth edges
const BG   = [0x0f, 0x19, 0x23];    // --bg, the site's navy
const RED  = [0xff, 0x46, 0x55];    // --red
const DARK = [0x0f, 0x19, 0x23];    // spokes and hub

/* Geometry mapped from LOGO_SVG's 26x26 viewBox into a padded 300px tile,
   so the mark keeps the proportions it has everywhere else on the site. */
const PAD = 34;
const K = (SIZE - PAD * 2) / 26;    // viewBox units -> pixels
const CX = PAD + 13 * K;
const CY = PAD + 13 * K;
const R_DISC = 12.5 * K;
const R_HUB  = 3.1 * K;
const SPOKE_HALF = (1.5 * K) / 2;   // stroke-width 1.5, round caps
const SPOKE_IN  = 3 * K;
const SPOKE_OUT = 9 * K;

const SPOKES = [];
for (let i = 0; i < 8; i++) {
  const a = (i * Math.PI) / 4;
  SPOKES.push({
    x1: CX + Math.cos(a) * SPOKE_IN,  y1: CY + Math.sin(a) * SPOKE_IN,
    x2: CX + Math.cos(a) * SPOKE_OUT, y2: CY + Math.sin(a) * SPOKE_OUT
  });
}

/** Distance from a point to a segment — round caps fall out of this for free. */
function distToSegment(px, py, s) {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy;
  let t = ((px - s.x1) * dx + (py - s.y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = s.x1 + t * dx, cy = s.y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Colour of one sample point, painted back to front. */
function sample(x, y) {
  const d = Math.hypot(x - CX, y - CY);
  if (d > R_DISC) return BG;
  if (d < R_HUB) return DARK;
  for (const s of SPOKES) if (distToSegment(x, y, s) < SPOKE_HALF) return DARK;
  return RED;
}

// ---- rasterise, averaging SS*SS samples per pixel ----
const raw = Buffer.alloc(SIZE * (SIZE * 3 + 1));   // +1 filter byte per row
let p = 0;
for (let y = 0; y < SIZE; y++) {
  raw[p++] = 0;                                    // filter type: none
  for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, b = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const c = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
        r += c[0]; g += c[1]; b += c[2];
      }
    }
    const n = SS * SS;
    raw[p++] = Math.round(r / n);
    raw[p++] = Math.round(g / n);
    raw[p++] = Math.round(b / n);
  }
}

// ---- encode PNG (8-bit truecolour, no alpha: a store tile is never see-through) ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;    // bit depth
ihdr[9] = 2;    // colour type 2 = truecolour RGB
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

/* Destination comes in as an argument: counting `..` back out of a temp
   directory got it wrong once, and silently wrote the file somewhere nobody
   would look for it. */
const out = process.argv[2];
if (!out) { console.error('usage: node make-store-logo.js <chemin-de-sortie.png>'); process.exit(1); }
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);

console.log('écrit      :', out);
console.log('dimensions :', png.readUInt32BE(16) + ' x ' + png.readUInt32BE(20));
console.log('taille     :', Math.round(png.length / 1024) + ' KB');
console.log('type       :', png[25] === 2 ? 'RGB opaque' : 'autre');
