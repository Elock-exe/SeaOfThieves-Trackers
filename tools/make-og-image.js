/* Build the 1200x630 card that Discord, Reddit and Twitter show when someone
   shares a link.
 *
 *   npm run build:og
 *
 * Until now those links arrived bare: no title, no image, no description —
 * which on a Discord server reads as spam rather than as content, and is a
 * fair part of why the site is hard to promote.
 *
 * Written as a rasteriser rather than a canvas export for the reason the
 * store logo was: a base64 round trip corrupted that image once, and this
 * way the bytes are produced deterministically and can be re-checked.
 */

const fs = require('fs');
const zlib = require('zlib');

const W = 1200, H = 630;
const BG   = [0x0f, 0x19, 0x23];
const RED  = [0xff, 0x46, 0x55];
const DARK = [0x0f, 0x19, 0x23];

/* ---------------- PNG reading (the wordmark) ---------------- */

/** Decode a non-interlaced 8-bit PNG into {w, h, get(x,y) -> [r,g,b,a]}. */
function decodePNG(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(file + ' is not a PNG');

  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const depth = buf[24], colour = buf[25], interlace = buf[28];
  if (depth !== 8) throw new Error('only 8-bit PNGs, got ' + depth);
  if (interlace) throw new Error('interlaced PNGs are not supported');

  const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };
  const ch = CHANNELS[colour];
  if (!ch) throw new Error('unsupported colour type ' + colour);

  // Concatenate every IDAT, then inflate.
  const parts = [];
  let p = 8;
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    if (type === 'IDAT') parts.push(buf.subarray(p + 8, p + 8 + len));
    if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(parts));

  /* Undo the per-scanline filter. Each row is prefixed by its filter type and
     refers to the pixel to its left (a) and the row above (b) — this is the
     part a decoder cannot skip, and where a wrong stride shows up as skew. */
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= ch ? out[dst + i - ch] : 0;
      const b = y > 0 ? out[dst - stride + i] : 0;
      const c = (i >= ch && y > 0) ? out[dst - stride + i - ch] : 0;
      let v;
      switch (ft) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {                       // Paeth
          const pp = a + b - c;
          const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          v = x + (pa <= pb && pa <= pc ? a : (pb <= pc ? b : c));
          break;
        }
        default: throw new Error('unknown filter ' + ft);
      }
      out[dst + i] = v & 0xff;
    }
  }

  return {
    w, h,
    get(x, y) {
      if (x < 0 || y < 0 || x >= w || y >= h) return [0, 0, 0, 0];
      const i = y * stride + x * ch;
      if (ch === 4) return [out[i], out[i + 1], out[i + 2], out[i + 3]];
      if (ch === 3) return [out[i], out[i + 1], out[i + 2], 255];
      if (ch === 2) return [out[i], out[i], out[i], out[i + 1]];
      return [out[i], out[i], out[i], 255];
    }
  };
}

/* ---------------- the compass, same geometry as LOGO_SVG ---------------- */

function compass(cx, cy, size) {
  const k = size / 26;
  const spokes = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    spokes.push({
      x1: cx + Math.cos(a) * 3 * k, y1: cy + Math.sin(a) * 3 * k,
      x2: cx + Math.cos(a) * 9 * k, y2: cy + Math.sin(a) * 9 * k
    });
  }
  return { cx, cy, rDisc: 12.5 * k, rHub: 3.1 * k, half: (1.5 * k) / 2, spokes };
}

function distToSeg(px, py, s) {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
  let t = ((px - s.x1) * dx + (py - s.y1) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy));
}

/* ---------------- compose ---------------- */

const mark = compass(W / 2, 215, 150);
const word = decodePNG('assets/img/logo-wordmark.png');

// The wordmark, centred below the compass.
const WORD_W = 640, WORD_H = Math.round(WORD_W * word.h / word.w);
const WORD_X = Math.round((W - WORD_W) / 2), WORD_Y = 355;

function sample(x, y) {
  // wordmark first: it sits on top
  if (x >= WORD_X && x < WORD_X + WORD_W && y >= WORD_Y && y < WORD_Y + WORD_H) {
    const sx = Math.floor((x - WORD_X) * word.w / WORD_W);
    const sy = Math.floor((y - WORD_Y) * word.h / WORD_H);
    const [, , , a] = word.get(sx, sy);
    if (a > 8) {
      // Recoloured, not copied: the art is one flat tone and the card wants
      // a brighter one against this background.
      const f = a / 255;
      return [
        Math.round(0xe8 * f + BG[0] * (1 - f)),
        Math.round(0xe8 * f + BG[1] * (1 - f)),
        Math.round(0xee * f + BG[2] * (1 - f))
      ];
    }
  }

  const d = Math.hypot(x - mark.cx, y - mark.cy);
  if (d <= mark.rDisc) {
    if (d < mark.rHub) return DARK;
    for (const s of mark.spokes) if (distToSeg(x, y, s) < mark.half) return DARK;
    return RED;
  }

  /* A faint chart grid, so the card is not a flat slab. Same idea as the
     hero's background, at a scale that survives Discord's thumbnailing. */
  const grid = (x % 60 === 0 || y % 60 === 0) ? 6 : 0;
  return [BG[0] + grid, BG[1] + grid, BG[2] + grid];
}

const SS = 2;
const raw = Buffer.alloc(H * (W * 3 + 1));
let p = 0;
for (let y = 0; y < H; y++) {
  raw[p++] = 0;
  for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const c = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
        r += c[0]; g += c[1]; b += c[2];
      }
    }
    const n = SS * SS;
    raw[p++] = Math.round(r / n); raw[p++] = Math.round(g / n); raw[p++] = Math.round(b / n);
  }
}

/* ---------------- PNG writing ---------------- */

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

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 2;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

const out = process.argv[2] || 'assets/img/og-card.png';
fs.writeFileSync(out, png);
console.log('  écrit      :', out);
console.log('  dimensions :', W + ' x ' + H);
console.log('  taille     :', Math.round(png.length / 1024) + ' KB');
