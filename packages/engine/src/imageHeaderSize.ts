/**
 * The intrinsic pixel size a PNG or JPEG declares, read from its HEADER —
 * no decode.
 *
 * The import pipeline needs the source's dimensions before it can choose a
 * resize ratio (compositionImageImport's decodeAndDownsample), and it used to
 * get them by calling `createImageBitmap(blob)` with no resize options and
 * reading `.width` / `.height` off the result — a full decode of a 12 MP
 * photo, ~48 MB of RGBA, thrown away on the next line, and then a SECOND
 * decode at the target size. Picking one photo did that twice over (once for
 * the export master, once for the display copy): four decodes, two of them
 * full resolution.
 *
 * A few dozen bytes of header answer the same question. Both parsers are
 * pure and byte-oriented so they test under node.
 */

/** A source's declared pixel size, or null when the bytes are neither a PNG
 *  nor a JPEG this can read (a truncated file, an exotic marker layout, a
 *  format the platform decodes but this does not) — the caller falls back to
 *  decoding, which is what it used to do unconditionally. */
export interface ImageHeaderSize {
  width: number;
  height: number;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** PNG: the IHDR chunk is mandated to be first, at a fixed offset — 8 bytes
 *  of signature, a 4-byte length, the 4-byte type, then width and height as
 *  big-endian u32. */
function pngSize(bytes: Uint8Array): ImageHeaderSize | null {
  if (bytes.length < 24) return null;
  for (let i = 0; i < PNG_MAGIC.length; i++) if (bytes[i] !== PNG_MAGIC[i]) return null;
  if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== 'IHDR') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * JPEG: walk the marker segments from SOI to the first Start Of Frame, whose
 * payload carries the size as `precision, height(u16BE), width(u16BE)`.
 *
 * Every SOF variant counts — baseline (C0), extended (C1), progressive (C2,
 * which phone cameras and every "save for web" pipeline emit), lossless (C3)
 * and the arithmetic-coded twins (C9–CB, CD–CF). C4 (Huffman tables), C8
 * (reserved) and CC (arithmetic conditioning) share the range and are NOT
 * frame headers, so they are skipped like any other segment.
 */
function jpegSize(bytes: Uint8Array): ImageHeaderSize | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 2;
  while (pos + 3 < bytes.length) {
    // Segments are 0xFF-prefixed; a run of fill bytes between them is legal.
    if (bytes[pos] !== 0xff) { pos++; continue; }
    let marker = bytes[pos + 1];
    let markerAt = pos + 1;
    while (marker === 0xff && markerAt + 1 < bytes.length) { markerAt++; marker = bytes[markerAt]; }
    // Standalone markers carry no length: padding (FF00), restart (D0–D7),
    // SOI/EOI (D8/D9).
    if (marker === 0x00 || marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos = markerAt + 1;
      continue;
    }
    // Start of Scan: the entropy-coded data follows and there is no frame
    // header left to find.
    if (marker === 0xda) return null;
    const lenAt = markerAt + 1;
    if (lenAt + 1 >= bytes.length) return null;
    const segLen = view.getUint16(lenAt, false);
    if (segLen < 2) return null;
    const isSOF = marker >= 0xc0 && marker <= 0xcf
      && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF) {
      if (lenAt + 7 >= bytes.length) return null;
      const height = view.getUint16(lenAt + 3, false);
      const width = view.getUint16(lenAt + 5, false);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    pos = lenAt + segLen;
  }
  return null;
}

/**
 * The pixel size these bytes declare, PNG or JPEG, or null when the header
 * cannot be read. Sniffs the format off the bytes rather than trusting a
 * caller-supplied mime, because a picker's mime is routinely absent or wrong.
 */
export function imageHeaderSize(bytes: Uint8Array): ImageHeaderSize | null {
  return pngSize(bytes) ?? jpegSize(bytes);
}
