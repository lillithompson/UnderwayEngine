import { imageHeaderSize } from '../imageHeaderSize';

// The size a PNG or JPEG declares, read from the header — the decode the
// import pipeline used to do for two numbers (compositionImageImport).

function png(w: number, h: number, opts?: { type?: string; short?: boolean }): Uint8Array {
  const bytes = new Uint8Array(opts?.short ? 20 : 33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13, false);
  const type = opts?.type ?? 'IHDR';
  for (let i = 0; i < 4; i++) bytes[12 + i] = type.charCodeAt(i);
  if (!opts?.short) {
    view.setUint32(16, w, false);
    view.setUint32(20, h, false);
  }
  return bytes;
}

/** SOI, an APP0 to step over, then a frame header of the given marker. */
function jpeg(w: number, h: number, marker = 0xc0, lead: number[] = []): Uint8Array {
  const head = [
    ...lead,
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, marker, 0x00, 0x11, 0x08, 0, 0, 0, 0,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ];
  const bytes = new Uint8Array(head);
  // The frame segment is [0xFF, marker, len(u16), precision, h(u16), w(u16)],
  // and it starts right after SOI (2) and the APP0 segment (6).
  const sof = lead.length + 8;
  const view = new DataView(bytes.buffer);
  view.setUint16(sof + 5, h, false);
  view.setUint16(sof + 7, w, false);
  return bytes;
}

describe('imageHeaderSize', () => {
  it('reads a PNG from its IHDR', () => {
    expect(imageHeaderSize(png(4032, 3024))).toEqual({ width: 4032, height: 3024 });
  });

  it('reads a baseline JPEG from its SOF0, stepping over the segments before it', () => {
    expect(imageHeaderSize(jpeg(4032, 3024))).toEqual({ width: 4032, height: 3024 });
  });

  it('reads every SOF variant a camera or an exporter emits', () => {
    // C2 progressive above all — phone cameras and every "save for web"
    // pipeline emit it, so treating C0 as the only frame header would send
    // the common case back to a full decode.
    for (const marker of [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]) {
      expect(imageHeaderSize(jpeg(640, 480, marker))).toEqual({ width: 640, height: 480 });
    }
  });

  it('skips the markers that share the SOF range but are not frame headers', () => {
    // C4 Huffman tables, C8 reserved, CC arithmetic conditioning: a segment
    // read as a frame header would hand back whatever bytes followed.
    for (const marker of [0xc4, 0xc8, 0xcc]) {
      const bytes = jpeg(640, 480, marker);
      expect(imageHeaderSize(bytes)).toBeNull();
    }
  });

  it('tolerates fill bytes between segments', () => {
    const bytes = jpeg(320, 200);
    const padded = new Uint8Array(bytes.length + 3);
    padded.set(bytes.subarray(0, 8), 0);
    padded.set([0xff, 0xff, 0xff], 8); // fill before the frame header
    padded.set(bytes.subarray(8), 11);
    expect(imageHeaderSize(padded)).toEqual({ width: 320, height: 200 });
  });

  it('is null for anything it cannot read, rather than a guess', () => {
    expect(imageHeaderSize(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(imageHeaderSize(new Uint8Array(0))).toBeNull();
    // A PNG whose first chunk is not IHDR is malformed; do not read past it.
    expect(imageHeaderSize(png(10, 10, { type: 'sRGB' }))).toBeNull();
    // Truncated before the dimensions.
    expect(imageHeaderSize(png(10, 10, { short: true }))).toBeNull();
    // A zero dimension is not a size.
    expect(imageHeaderSize(png(0, 10))).toBeNull();
    expect(imageHeaderSize(jpeg(0, 10))).toBeNull();
    // SVG markup: the import pipeline handles it long before this.
    expect(imageHeaderSize(new TextEncoder().encode('<svg width="10"/>'))).toBeNull();
  });

  it('stops at the scan rather than walking entropy-coded data', () => {
    // SOI, APP0, SOS — no frame header, and past SOS the bytes are not
    // segments at all, so a walk that kept going would read noise.
    const bytes = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
      0xff, 0xda, 0x00, 0x08, 1, 2, 3, 4, 5, 6,
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x00, 0x01, 0x00,
    ]);
    expect(imageHeaderSize(bytes)).toBeNull();
  });

  it('reads a view into a larger buffer, not just a whole one', () => {
    // The picker hands over subarrays; a parser that read from byte 0 of the
    // underlying ArrayBuffer would see the wrong header entirely.
    const inner = png(128, 64);
    const backing = new Uint8Array(inner.length + 16);
    backing.set(inner, 16);
    expect(imageHeaderSize(backing.subarray(16))).toEqual({ width: 128, height: 64 });
  });
});

// ── EXIF orientation ──────────────────────────────────────────────────
//
// A portrait phone photo is STORED landscape with an orientation tag, and
// createImageBitmap applies that rotation by default. Reading the stored
// numbers and sizing a resize from them asks for the wrong aspect ratio, and
// the decoder honours it — which is how photos came out skewed on import
// while screenshots (no Exif) looked fine.

/** A JPEG carrying a SOF0 of w x h and, optionally, an Exif APP1 whose
 *  orientation tag is `orientation`. */
function jpegWithOrientation(w: number, h: number, orientation?: number): Uint8Array {
  const parts: number[] = [0xff, 0xd8];
  if (orientation !== undefined) {
    // APP1: length(2) "Exif\0\0" TIFF(8) IFD0 count(2) entry(12) next(4)
    const tiff = [
      0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // MM, 42, IFD0 @ 8
      0x00, 0x01,                                     // one entry
      0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, // tag 0x0112, SHORT, 1
      (orientation >> 8) & 0xff, orientation & 0xff, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,                         // no next IFD
    ];
    const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // "Exif\0\0"
    const len = payload.length + 2;
    parts.push(0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, ...payload);
  }
  parts.push(0xff, 0xc0, 0x00, 0x11, 0x08,
    (h >> 8) & 0xff, h & 0xff, (w >> 8) & 0xff, w & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01);
  return new Uint8Array(parts);
}

describe('imageHeaderSize reports DISPLAY size, not stored size', () => {
  it('leaves an unrotated photo alone', () => {
    expect(imageHeaderSize(jpegWithOrientation(4032, 3024, 1)))
      .toEqual({ width: 4032, height: 3024 });
  });

  it('swaps the axes for the quarter turns (5-8)', () => {
    // Orientation 6 is the ordinary portrait phone photo.
    for (const o of [5, 6, 7, 8]) {
      expect(imageHeaderSize(jpegWithOrientation(4032, 3024, o)))
        .toEqual({ width: 3024, height: 4032 });
    }
  });

  it('leaves the flips and half turn alone (2-4)', () => {
    for (const o of [2, 3, 4]) {
      expect(imageHeaderSize(jpegWithOrientation(4032, 3024, o)))
        .toEqual({ width: 4032, height: 3024 });
    }
  });

  it('treats a JPEG with no Exif at all as unrotated', () => {
    expect(imageHeaderSize(jpegWithOrientation(1200, 800)))
      .toEqual({ width: 1200, height: 800 });
  });

  it('refuses rather than guesses when an Exif block is unreadable', () => {
    // Truncated mid-Exif: better to decode for the size than to size a
    // resize from numbers that may be the wrong way round.
    const full = jpegWithOrientation(4032, 3024, 6);
    const cut = full.slice(0, 14);
    expect(imageHeaderSize(cut)).toBeNull();
  });

  it('still reads a PNG, which carries no orientation', () => {
    const png = new Uint8Array(33);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    new DataView(png.buffer).setUint32(8, 13, false);
    png.set([0x49, 0x48, 0x44, 0x52], 12);
    new DataView(png.buffer).setUint32(16, 1206, false);
    new DataView(png.buffer).setUint32(20, 2622, false);
    expect(imageHeaderSize(png)).toEqual({ width: 1206, height: 2622 });
  });
});
