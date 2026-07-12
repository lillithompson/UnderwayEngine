// ── CRC-32 for PNG ──────────────────────────────────────────────────────

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

function crc32(data: Uint8Array, start = 0, end = data.length): number {
  let crc = 0xFFFFFFFF;
  for (let i = start; i < end; i++) {
    crc = crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── Adler-32 for zlib ───────────────────────────────────────────────────

function adler32(data: Uint8Array): number {
  let a = 1, b = 0;
  const len = data.length;
  const NMAX = 5552; // max iterations before modulo needed to avoid overflow
  let i = 0;
  while (i < len) {
    const end = Math.min(i + NMAX, len);
    for (; i < end; i++) {
      a += data[i];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

// ── Base64 encoding ─────────────────────────────────────────────────────

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Pre-compute ASCII code lookup table for base64 characters
const B64_CODES = new Uint8Array(64);
for (let i = 0; i < 64; i++) B64_CODES[i] = B64.charCodeAt(i);

export function toBase64(bytes: Uint8Array): string {
  const len = bytes.length;
  const outLen = Math.ceil(len / 3) * 4;
  const codes = new Uint8Array(outLen);
  let j = 0;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    codes[j++] = B64_CODES[(b0 >> 2) & 0x3F];
    codes[j++] = B64_CODES[((b0 << 4) | (b1 >> 4)) & 0x3F];
    codes[j++] = i + 1 < len ? B64_CODES[((b1 << 2) | (b2 >> 6)) & 0x3F] : 61; // '='
    codes[j++] = i + 2 < len ? B64_CODES[b2 & 0x3F] : 61;
  }
  // Convert in chunks to stay under apply()'s argument-count limit
  const CHUNK = 8192;
  const parts: string[] = [];
  for (let i = 0; i < outLen; i += CHUNK) {
    parts.push(String.fromCharCode.apply(null, codes.subarray(i, Math.min(i + CHUNK, outLen)) as any));
  }
  return parts.join('');
}

// ── Minimal PNG encoder (uncompressed DEFLATE) ──────────────────────────

function write32BE(arr: Uint8Array, offset: number, val: number) {
  arr[offset] = (val >>> 24) & 0xFF;
  arr[offset + 1] = (val >>> 16) & 0xFF;
  arr[offset + 2] = (val >>> 8) & 0xFF;
  arr[offset + 3] = val & 0xFF;
}

const DEFAULT_SIZE = 128;

export function encodePNG(rgba: Uint8Array, w: number = DEFAULT_SIZE, h: number = DEFAULT_SIZE): Uint8Array {

  // Raw image data: filter byte (0) + RGBA per row
  const rawRowLen = 1 + w * 4;
  const rawLen = rawRowLen * h;
  const rawData = new Uint8Array(rawLen);
  for (let y = 0; y < h; y++) {
    rawData[y * rawRowLen] = 0; // no filter
    rawData.set(
      rgba.subarray(y * w * 4, (y + 1) * w * 4),
      y * rawRowLen + 1,
    );
  }

  // Build uncompressed DEFLATE store blocks (max 65535 bytes per block)
  const MAX_BLOCK = 65535;
  const numBlocks = Math.ceil(rawLen / MAX_BLOCK);
  // zlib header (2) + blocks (5 header + data each) + adler32 (4)
  let deflateLen = 2;
  for (let i = 0; i < numBlocks; i++) {
    const blockLen = Math.min(MAX_BLOCK, rawLen - i * MAX_BLOCK);
    deflateLen += 5 + blockLen;
  }
  deflateLen += 4;

  const deflate = new Uint8Array(deflateLen);
  let dOff = 0;

  // zlib header: CMF=0x78 (deflate, window 32K), FLG=0x01 (no dict, check bits)
  deflate[dOff++] = 0x78;
  deflate[dOff++] = 0x01;

  for (let i = 0; i < numBlocks; i++) {
    const start = i * MAX_BLOCK;
    const blockLen = Math.min(MAX_BLOCK, rawLen - start);
    const isLast = i === numBlocks - 1;
    deflate[dOff++] = isLast ? 1 : 0; // BFINAL + BTYPE=00 (store)
    deflate[dOff++] = blockLen & 0xFF;
    deflate[dOff++] = (blockLen >> 8) & 0xFF;
    deflate[dOff++] = ~blockLen & 0xFF;
    deflate[dOff++] = (~blockLen >> 8) & 0xFF;
    deflate.set(rawData.subarray(start, start + blockLen), dOff);
    dOff += blockLen;
  }

  // Adler-32 of raw data
  const adler = adler32(rawData);
  write32BE(deflate, dOff, adler);

  // PNG file structure
  const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR: 13 bytes data
  const ihdrData = new Uint8Array(13);
  write32BE(ihdrData, 0, w);
  write32BE(ihdrData, 4, h);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // color type: RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const ihdrChunk = makeChunk('IHDR', ihdrData);
  const idatChunk = makeChunk('IDAT', deflate);
  const iendChunk = makeChunk('IEND', new Uint8Array(0));

  // Concatenate
  const totalLen = PNG_SIG.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const png = new Uint8Array(totalLen);
  let off = 0;
  png.set(PNG_SIG, off); off += PNG_SIG.length;
  png.set(ihdrChunk, off); off += ihdrChunk.length;
  png.set(idatChunk, off); off += idatChunk.length;
  png.set(iendChunk, off);

  return png;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  // length (4) + type (4) + data + crc (4)
  const chunk = new Uint8Array(12 + data.length);
  write32BE(chunk, 0, data.length);
  chunk[4] = type.charCodeAt(0);
  chunk[5] = type.charCodeAt(1);
  chunk[6] = type.charCodeAt(2);
  chunk[7] = type.charCodeAt(3);
  chunk.set(data, 8);
  // CRC covers type + data
  const crc = crc32(chunk, 4, 8 + data.length);
  write32BE(chunk, 8 + data.length, crc);
  return chunk;
}
