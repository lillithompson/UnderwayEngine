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
/**
 * The EXIF orientation of a JPEG: 1-8, or null when there is an Exif block
 * this cannot read. Absent Exif is orientation 1, which is the common case
 * and needs no parsing.
 *
 * APP1 → "Exif\0\0" → a TIFF header (II/MM byte order, then 42, then the
 * offset of IFD0 relative to the TIFF header) → IFD0's entries, each 12
 * bytes, the orientation being tag 0x0112 with its SHORT value in the first
 * two bytes of the entry's value field.
 */
function jpegOrientation(bytes: Uint8Array): number | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 2;
  while (pos + 3 < bytes.length) {
    if (bytes[pos] !== 0xff) { pos++; continue; }
    let marker = bytes[pos + 1];
    let markerAt = pos + 1;
    while (marker === 0xff && markerAt + 1 < bytes.length) { markerAt++; marker = bytes[markerAt]; }
    if (marker === 0x00 || marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos = markerAt + 1;
      continue;
    }
    // Start of Scan: no Exif was found before the image data, so there is
    // none. An unrotated image is the overwhelmingly common case.
    if (marker === 0xda) return 1;
    const lenAt = markerAt + 1;
    if (lenAt + 1 >= bytes.length) return 1;
    const segLen = view.getUint16(lenAt, false);
    if (segLen < 2) return 1;
    if (marker === 0xe1) {
      const tiff = lenAt + 2 + 6; // past the length and "Exif\0\0"
      if (tiff + 8 > bytes.length) return null;
      const exifTag = String.fromCharCode(bytes[lenAt + 2], bytes[lenAt + 3],
        bytes[lenAt + 4], bytes[lenAt + 5]);
      if (exifTag !== 'Exif') { pos = lenAt + segLen; continue; }
      const le = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
      const be = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d;
      if (!le && !be) return null;
      const ifd0 = tiff + view.getUint32(tiff + 4, !le ? false : true);
      if (ifd0 + 2 > bytes.length) return null;
      const count = view.getUint16(ifd0, le);
      for (let i = 0; i < count; i++) {
        const entry = ifd0 + 2 + i * 12;
        if (entry + 12 > bytes.length) return null;
        if (view.getUint16(entry, le) === 0x0112) {
          const value = view.getUint16(entry + 8, le);
          return value >= 1 && value <= 8 ? value : null;
        }
      }
      // Exif present, no orientation entry: unrotated.
      return 1;
    }
    pos = lenAt + segLen;
  }
  return 1;
}

/**
 * The pixel size these bytes declare, PNG or JPEG, or null when the header
 * cannot be read. Sniffs the format off the bytes rather than trusting a
 * caller-supplied mime, because a picker's mime is routinely absent or wrong.
 *
 * These are DISPLAY dimensions — what a decoder hands back — not the stored
 * ones. A portrait phone photo is stored landscape with EXIF orientation 6,
 * and `createImageBitmap` applies that rotation by default, so a caller that
 * sized a resize from the stored numbers asked for the wrong aspect and got
 * a squashed image. An Exif block whose orientation cannot be read returns
 * null, which sends the caller back to decoding for the size: slower, and
 * right.
 */
export function imageHeaderSize(bytes: Uint8Array): ImageHeaderSize | null {
  const png = pngSize(bytes);
  if (png) return png; // PNG carries no orientation
  const jpeg = jpegSize(bytes);
  if (!jpeg) return null;
  const orientation = jpegOrientation(bytes);
  if (orientation === null) return null;
  // 5-8 are the transposed quarter turns; the decoded bitmap is the stored
  // one with its axes swapped.
  return orientation >= 5
    ? { width: jpeg.height, height: jpeg.width }
    : jpeg;
}
