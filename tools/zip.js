/* SotTracker — sottracker.fr
   Creator: Vyros__
   https://github.com/Elock-exe/SeaOfThieves-Trackers */
/* ============================================================
   A minimal ZIP writer.

   Written rather than shelled out to because the platform tools get the
   one detail that matters wrong: PowerShell's Compress-Archive stores
   Windows path separators, so entries come out as "icons\icon-48.png".
   The ZIP spec requires forward slashes, and addons.mozilla.org rejects
   the archive outright — "Invalid file name in archive".

   Deflate comes from zlib, which is built in. No zip64: these packages
   are tens of kilobytes, nowhere near the 4 GB where it would matter.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* CRC-32, computed here because zlib.crc32 only exists on newer Node and
   this file has to run wherever the project does. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** Every file under `dir`, as { name, data } with ZIP-legal names. */
function collect(dir, prefix, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    // Forward slashes, always — this is the whole reason this file exists.
    const name = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) collect(full, name, out);
    else out.push({ name, data: fs.readFileSync(full) });
  }
  return out;
}

function dosTime(date) {
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() / 2)) & 0xFFFF;
  const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xFFFF;
  return { time, day };
}

/**
 * Zip the contents of `dir` into `outFile`.
 * @returns {number} number of entries written
 */
function zipDir(dir, outFile) {
  const files = collect(dir, '', []);
  const now = dosTime(new Date());
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const crc = crc32(file.data);
    const deflated = zlib.deflateRawSync(file.data, { level: 9 });

    /* Store rather than deflate when compression makes it bigger, which
       happens with already-compressed payloads like PNG. */
    const useDeflate = deflated.length < file.data.length;
    const body = useDeflate ? deflated : file.data;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034B50, 0);   // local file header
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0x0800, 6);       // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(now.time, 10);
    local.writeUInt16LE(now.day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014B50, 0); // central directory header
    central.writeUInt16LE(20, 4);         // version made by
    central.writeUInt16LE(20, 6);         // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(now.time, 12);
    central.writeUInt16LE(now.day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(0, 38);         // external attributes
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0);       // end of central directory
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  fs.writeFileSync(outFile, Buffer.concat([...locals, centralBuf, end]));
  return files.length;
}

module.exports = { zipDir, crc32 };
