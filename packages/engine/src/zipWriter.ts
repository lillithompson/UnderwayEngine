/**
 * Minimal stored-mode (uncompressed) ZIP writer.
 *
 * Used by multi-select composition export — the per-file payloads (PNG, deflated
 * .tile, small SVG text) don't benefit from another deflate pass, so we skip
 * compression and stay dependency-free.
 *
 * Implements the PKZIP layout: a local file header + raw bytes per entry,
 * followed by a central directory and end-of-central-directory record.
 */

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  crcTable = table;
  return table;
}

export function crc32(data: Uint8Array): number {
  const table = getCrcTable();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = table[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const utf8 = new TextEncoder();

export function buildZip(entries: ZipEntry[]): Uint8Array {
  const fileParts: Uint8Array[] = [];
  const central: { nameBytes: Uint8Array; crc: number; size: number; offset: number }[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = utf8.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    // Local file header (30 bytes + name)
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // signature
    lv.setUint16(4, 20, true);          // version needed (2.0)
    lv.setUint16(6, 0x0800, true);      // flags: bit 11 = UTF-8 filename
    lv.setUint16(8, 0, true);           // method: stored
    lv.setUint16(10, 0, true);          // mod time
    lv.setUint16(12, 0, true);          // mod date
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);       // compressed size
    lv.setUint32(22, size, true);       // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);          // extra length
    local.set(nameBytes, 30);

    fileParts.push(local, entry.data);
    central.push({ nameBytes, crc, size, offset });
    offset += local.length + size;
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const e of central) {
    const rec = new Uint8Array(46 + e.nameBytes.length);
    const cv = new DataView(rec.buffer);
    cv.setUint32(0, 0x02014b50, true); // signature
    cv.setUint16(4, 20, true);          // version made by
    cv.setUint16(6, 20, true);          // version needed
    cv.setUint16(8, 0x0800, true);      // flags
    cv.setUint16(10, 0, true);          // method
    cv.setUint16(12, 0, true);          // mod time
    cv.setUint16(14, 0, true);          // mod date
    cv.setUint32(16, e.crc, true);
    cv.setUint32(20, e.size, true);     // compressed size
    cv.setUint32(24, e.size, true);     // uncompressed size
    cv.setUint16(28, e.nameBytes.length, true);
    cv.setUint16(30, 0, true);          // extra length
    cv.setUint16(32, 0, true);          // comment length
    cv.setUint16(34, 0, true);          // disk start
    cv.setUint16(36, 0, true);          // internal attrs
    cv.setUint32(38, 0, true);          // external attrs
    cv.setUint32(42, e.offset, true);   // local header offset
    rec.set(e.nameBytes, 46);
    fileParts.push(rec);
    cdSize += rec.length;
  }

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);    // signature
  ev.setUint16(4, 0, true);              // disk number
  ev.setUint16(6, 0, true);              // disk where CD starts
  ev.setUint16(8, central.length, true); // CD records on this disk
  ev.setUint16(10, central.length, true);// total CD records
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdStart, true);
  ev.setUint16(20, 0, true);             // comment length
  fileParts.push(eocd);

  let total = 0;
  for (const p of fileParts) total += p.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of fileParts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}
