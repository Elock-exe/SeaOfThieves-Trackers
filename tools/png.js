/* SotTracker — sottracker.fr
   Creator: Vyros__
   https://github.com/Elock-exe/SeaOfThieves-Trackers */
/* ============================================================
   PNG decode, encode and downscale, in plain Node.

   The project ships no dependencies, and sharp or jimp would each pull in
   more code than this whole site to do one thing: turn a 367 KB emblem into
   a 96px thumbnail. zlib is in the standard library and does the hard part.

   Decoding already existed twice — once in make-og-image.js, once in
   make-torn-edge.js — reading from a file path. Emblems arrive over the
   network as buffers, so it lives here now and takes a buffer.
   ============================================================ */

const zlib = require('zlib');

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** Decode an 8-bit, non-interlaced PNG buffer to { w, h, rgba }. */
function decode(buf) {
  if (buf.length < 26 || buf.readUInt32BE(0) !== 0x89504e47) {
    throw new Error('not a PNG');
  }
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const depth = buf[24];
  const colour = buf[25];
  const interlace = buf[28];

  /* Rare's emblems are all 8-bit RGBA. Anything else is refused rather than
     half-decoded: a wrong stride does not throw, it produces a skewed image,
     and a skewed image is a bug someone finds much later. */
  if (depth !== 8) throw new Error('only 8-bit PNGs, got depth ' + depth);
  if (interlace) throw new Error('interlaced PNGs are not supported');
  const ch = CHANNELS[colour];
  if (!ch) throw new Error('unsupported colour type ' + colour);

  const parts = [];
  let p = 8;
  let palette = null;
  let trns = null;
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    if (type === 'IDAT') parts.push(buf.subarray(p + 8, p + 8 + len));
    else if (type === 'PLTE') palette = buf.subarray(p + 8, p + 8 + len);
    else if (type === 'tRNS') trns = buf.subarray(p + 8, p + 8 + len);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (colour === 3 && !palette) throw new Error('indexed PNG without a palette');

  const raw = zlib.inflateSync(Buffer.concat(parts));
  const stride = w * ch;
  const flat = Buffer.alloc(h * stride);

  /* Undo the per-scanline filter. Each row names its filter and refers to
     the pixel on its left (a) and the one above (b); Paeth also needs the
     one above-left (c). This is the part no decoder gets to skip. */
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= ch ? flat[dst + i - ch] : 0;
      const b = y > 0 ? flat[dst - stride + i] : 0;
      const c = (i >= ch && y > 0) ? flat[dst - stride + i - ch] : 0;
      let v;
      if (ft === 0) v = x;
      else if (ft === 1) v = x + a;
      else if (ft === 2) v = x + b;
      else if (ft === 3) v = x + ((a + b) >> 1);
      else if (ft === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        v = x + (pa <= pb && pa <= pc ? a : (pb <= pc ? b : c));
      } else throw new Error('unknown filter ' + ft);
      flat[dst + i] = v & 0xff;
    }
  }

  /* Everything is widened to RGBA so the caller has one shape to handle. */
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0, n = w * h; i < n; i++) {
    let r, g, b, a = 255;
    if (colour === 0) { r = g = b = flat[i]; }
    else if (colour === 4) { r = g = b = flat[i * 2]; a = flat[i * 2 + 1]; }
    else if (colour === 2) { r = flat[i * 3]; g = flat[i * 3 + 1]; b = flat[i * 3 + 2]; }
    else if (colour === 6) {
      r = flat[i * 4]; g = flat[i * 4 + 1]; b = flat[i * 4 + 2]; a = flat[i * 4 + 3];
    } else {                                   // colour === 3, indexed
      const ix = flat[i];
      r = palette[ix * 3]; g = palette[ix * 3 + 1]; b = palette[ix * 3 + 2];
      if (trns && ix < trns.length) a = trns[ix];
    }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = a;
  }

  return { w, h, rgba };
}

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
  let c = -1;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** Encode RGBA to an 8-bit colour-type-6 PNG. */
function encode(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;               // filter 0: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* Box filter, and premultiplied while averaging.

   Averaging straight RGBA blends the colour of fully transparent pixels
   into their neighbours. Emblems are cut-outs on transparency, and Rare
   leaves black under the transparent part, so a naive average draws a grey
   halo around every icon. Weighting colour by alpha is what removes it. */
function resize(src, tw, th) {
  const { w, h, rgba } = src;
  const out = Buffer.alloc(tw * th * 4);
  const sx = w / tw;
  const sy = h / th;

  for (let y = 0; y < th; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.min(h, Math.ceil((y + 1) * sy)));
    for (let x = 0; x < tw; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.min(w, Math.ceil((x + 1) * sx)));

      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * w + xx) * 4;
          const al = rgba[i + 3];
          r += rgba[i] * al; g += rgba[i + 1] * al; b += rgba[i + 2] * al;
          a += al; n++;
        }
      }
      const o = (y * tw + x) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
        out[o + 3] = Math.round(a / n);
      }
    }
  }
  return { w: tw, h: th, rgba: out };
}

module.exports = { decode, encode, resize };
