import {
  detectImageMimeType, looksLikeSvg, placementBbox, prepareImageImport,
  prepareImageReplacement, SVG_MIME_TYPE, svgIntrinsicSize, svgNominalPixelSize,
} from '../compositionImageImport';
import { perfDelta } from '../debug/perfCounters';

describe('placementBbox', () => {
  it('sizes to 8 L0 cells at grid level 0', () => {
    const result = placementBbox(1024, 512, 16, 16, 0);
    expect(result.cellWidth).toBe(8);
    expect(result.cellHeight).toBe(4);
    expect(result.cellX).toBe(12);
    expect(result.cellY).toBe(14);
  });

  it('sizes to 8 L1 cells (16 L0 cells) at grid level 1', () => {
    const result = placementBbox(1024, 512, 16, 16, 1);
    expect(result.cellWidth).toBe(16);
    expect(result.cellHeight).toBe(8);
  });

  it('sizes to 8 L2 cells (32 L0 cells) at grid level 2', () => {
    const result = placementBbox(1024, 512, 16, 16, 2);
    expect(result.cellWidth).toBe(32);
    expect(result.cellHeight).toBe(16);
  });

  it('sizes to 8 L3 cells (64 L0 cells) at grid level 3', () => {
    const result = placementBbox(1024, 512, 16, 16, 3);
    expect(result.cellWidth).toBe(64);
    expect(result.cellHeight).toBe(32);
  });

  it('handles square images', () => {
    const result = placementBbox(500, 500, 10, 10, 0);
    expect(result.cellWidth).toBe(8);
    expect(result.cellHeight).toBe(8);
  });

  it('handles portrait images', () => {
    const result = placementBbox(512, 1024, 16, 16, 0);
    expect(result.cellWidth).toBe(4);
    expect(result.cellHeight).toBe(8);
  });

  it('centers the bbox on the given cell', () => {
    const result = placementBbox(1024, 512, 20, 10, 1);
    // 16 wide, 8 tall at L1
    expect(result.cellX).toBe(20 - 16 / 2);
    expect(result.cellY).toBe(10 - 8 / 2);
  });

  it('defaults to L0 when gridLevel is omitted', () => {
    const result = placementBbox(1024, 768, 16, 16);
    expect(result.cellWidth).toBe(8);
    expect(result.cellHeight).toBe(6);
  });
});

// An SVG is a first-class import source, and it STAYS a vector: the markup
// is stored verbatim under mime image/svg+xml (binary v56), never decoded,
// downsampled, or re-encoded — the browser re-rasterizes it at whatever
// scale it is drawn, so it is sharp at every zoom. The whole SVG path is
// pure, so it runs here end to end.
describe('SVG import sources', () => {
  const bytes = (s: string) => new TextEncoder().encode(s);
  const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  describe('looksLikeSvg', () => {
    it('trusts a supplied SVG mime type without reading the bytes', () => {
      expect(looksLikeSvg(new Uint8Array(), SVG_MIME_TYPE)).toBe(true);
    });

    it('never second-guesses a real raster mime — even over SVG-shaped bytes', () => {
      expect(looksLikeSvg(PNG_MAGIC, 'image/png')).toBe(false);
      expect(looksLikeSvg(bytes('<svg viewBox="0 0 4 4"/>'), 'image/jpeg')).toBe(false);
    });

    it('sniffs untyped bytes: every way an SVG document can open', () => {
      for (const mime of ['', 'application/octet-stream']) {
        expect(looksLikeSvg(bytes('<svg xmlns="…"></svg>'), mime)).toBe(true);
        expect(looksLikeSvg(bytes('<?xml version="1.0"?>\n<svg/>'), mime)).toBe(true);
        expect(looksLikeSvg(bytes('<!DOCTYPE svg PUBLIC "…">\n<svg/>'), mime)).toBe(true);
        expect(looksLikeSvg(bytes('<!-- exported --><svg/>'), mime)).toBe(true);
        // A leading BOM and whitespace are stripped before the sniff.
        expect(looksLikeSvg(bytes('﻿  \n<svg/>'), mime)).toBe(true);
      }
    });

    it('rejects untyped bytes that are not SVG', () => {
      expect(looksLikeSvg(PNG_MAGIC, '')).toBe(false);
      expect(looksLikeSvg(bytes('{"figure": true}'), '')).toBe(false);
      expect(looksLikeSvg(bytes('<?xml version="1.0"?><figure/>'), '')).toBe(false);
    });
  });

  describe('svgIntrinsicSize (aspect only — the raster renders at the cap)', () => {
    it('reads plain width/height attributes, px suffix included', () => {
      expect(svgIntrinsicSize('<svg width="24" height="12"/>')).toEqual({ width: 24, height: 12 });
      expect(svgIntrinsicSize("<svg width='300px' height='150px'/>")).toEqual({ width: 300, height: 150 });
    });

    it('falls back to the viewBox extent — how icon SVGs usually size', () => {
      expect(svgIntrinsicSize('<svg viewBox="0 0 300 150"/>')).toEqual({ width: 300, height: 150 });
      // Comma-separated, with offsets: only the extent matters.
      expect(svgIntrinsicSize('<svg viewBox="10, 20, 4, 3"/>')).toEqual({ width: 4, height: 3 });
    });

    it('lets a relative width/height (100%) fall through to the viewBox', () => {
      expect(svgIntrinsicSize('<svg width="100%" height="100%" viewBox="0 0 4 3"/>'))
        .toEqual({ width: 4, height: 3 });
    });

    it('prefers explicit width/height over the viewBox', () => {
      expect(svgIntrinsicSize('<svg width="8" height="2" viewBox="0 0 4 4"/>'))
        .toEqual({ width: 8, height: 2 });
    });

    it('squares up a document that declares nothing usable', () => {
      expect(svgIntrinsicSize('<svg xmlns="http://www.w3.org/2000/svg"/>')).toEqual({ width: 1, height: 1 });
      expect(svgIntrinsicSize('<svg viewBox="0 0 0 4"/>')).toEqual({ width: 1, height: 1 });
      expect(svgIntrinsicSize('not svg at all')).toEqual({ width: 1, height: 1 });
    });
  });

  it('routes .svg filenames through the image pipeline, like .png/.jpg', () => {
    expect(detectImageMimeType('icon.svg')).toBe(SVG_MIME_TYPE);
    expect(detectImageMimeType('ICON.SVG')).toBe(SVG_MIME_TYPE);
    expect(detectImageMimeType('figure.json')).toBeNull();
  });

  describe('an imported SVG stays a vector', () => {
    const MARKUP = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 12"><rect width="24" height="12"/></svg>';

    it('stores the markup VERBATIM — no decode, no re-encode, no original copy', async () => {
      const raw = bytes(MARKUP);
      const { image, bytes: stored, originalBytes } = await prepareImageImport(raw, SVG_MIME_TYPE, 16, 16);
      expect(stored).toBe(raw);
      expect(originalBytes).toBeUndefined();
      expect(image.originalImageId).toBeUndefined();
      expect(image.mimeType).toBe(SVG_MIME_TYPE);
    });

    it('places at the declared aspect, sized like any other import', async () => {
      const { image } = await prepareImageImport(bytes(MARKUP), SVG_MIME_TYPE, 16, 16);
      // 24×12 viewBox → 2:1; longest edge 8 L0 cells, centered on the tap.
      expect(image.cellWidth).toBe(8);
      expect(image.cellHeight).toBe(4);
      expect(image.cellX).toBe(12);
      expect(image.cellY).toBe(14);
      // Nominal pixel dims: the declared size normalized to the display cap,
      // so nothing downstream mistakes a 24-unit icon for a 24px image.
      expect(image.pixelWidth).toBe(1024);
      expect(image.pixelHeight).toBe(512);
      expect(svgNominalPixelSize(MARKUP)).toEqual({ width: 1024, height: 512 });
    });

    it('is sniffed from untyped bytes on this path too', async () => {
      const { image } = await prepareImageImport(bytes(MARKUP), '', 16, 16);
      expect(image.mimeType).toBe(SVG_MIME_TYPE);
    });

    it('replaces verbatim as well, into the node’s existing box', async () => {
      const raw = bytes(MARKUP);
      const rep = await prepareImageReplacement(raw, SVG_MIME_TYPE);
      expect(rep.bytes).toBe(raw);
      expect(rep.mimeType).toBe(SVG_MIME_TYPE);
      expect(rep.pixelWidth).toBe(1024);
      expect(rep.pixelHeight).toBe(512);
      expect(rep.originalImageId).toBeUndefined();
      expect(rep.originalBytes).toBeUndefined();
    });
  });
});

// ── The raster path: decodes it does, and decodes it doesn't ──────────
//
// The pipeline's cost is decodes, and it used to do four per picked photo —
// two of them at full resolution — plus a full-size alpha scan per scale.
// These drive it against fakes for the two environment APIs it needs
// (`createImageBitmap`, `OffscreenCanvas`) and count the work.

/** A PNG header declaring `w`×`h`: signature, IHDR length/type, then the
 *  two big-endian u32s. Nothing past the header matters here. */
function pngHeader(w: number, h: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  new DataView(bytes.buffer).setUint32(8, 13, false);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // 'IHDR'
  new DataView(bytes.buffer).setUint32(16, w, false);
  new DataView(bytes.buffer).setUint32(20, h, false);
  return bytes;
}

/** A JPEG header declaring `w`×`h`: SOI, an APP0 segment to step over, then
 *  a baseline SOF0 carrying the size. */
function jpegHeader(w: number, h: number): Uint8Array {
  const bytes = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,             // APP0, length 4
    0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0,       // SOF0, length 17, 8-bit
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]);
  const view = new DataView(bytes.buffer);
  view.setUint16(13, h, false);
  view.setUint16(15, w, false);
  return bytes;
}

interface FakeEnv {
  /** Every `createImageBitmap` call: the size it was asked for, or null when
   *  it was asked for a NATIVE (full-resolution) decode. */
  decodes: (({ width: number; height: number } | null))[];
  /** How many times a canvas was read for transparency. */
  alphaScans: number;
}

/** Install fakes for the two environment APIs the raster path uses, sized so
 *  a native decode reports `nativeW`×`nativeH`. Returns the work log. */
function installFakeDecoder(nativeW: number, nativeH: number): FakeEnv {
  const env: FakeEnv = { decodes: [], alphaScans: 0 };
  const g = globalThis as Record<string, unknown>;
  g.createImageBitmap = async (src: unknown, opts?: { resizeWidth?: number; resizeHeight?: number }) => {
    // A re-decode of an OffscreenCanvas is the platform fallback path, not a
    // decode of the source; it reports the canvas's own size.
    const fromCanvas = typeof src === 'object' && src !== null && 'width' in (src as object)
      && !(typeof Blob !== 'undefined' && src instanceof Blob);
    if (fromCanvas) {
      const c = src as { width: number; height: number };
      return { width: c.width, height: c.height, close: () => {} };
    }
    if (opts?.resizeWidth && opts?.resizeHeight) {
      env.decodes.push({ width: opts.resizeWidth, height: opts.resizeHeight });
      return { width: opts.resizeWidth, height: opts.resizeHeight, close: () => {} };
    }
    env.decodes.push(null);
    return { width: nativeW, height: nativeH, close: () => {} };
  };
  class FakeOffscreenCanvas {
    width: number;
    height: number;
    constructor(width: number, height: number) { this.width = width; this.height = height; }
    getContext(): unknown {
      return {
        drawImage: () => {},
        getImageData: (_x: number, _y: number, w: number, h: number) => {
          env.alphaScans++;
          // Fully opaque, so the scan has to read every band to say so.
          const data = new Uint8ClampedArray(w * h * 4).fill(255);
          return { data };
        },
      };
    }
    convertToBlob(opts?: { type?: string }): Promise<Blob> {
      // Bytes that vary with the encode, so two scales of one photo are two
      // different assets — which is what content addressing then sees.
      const bytes = new Uint8Array(8);
      const view = new DataView(bytes.buffer);
      view.setUint32(0, this.width, false);
      view.setUint32(4, this.height, false);
      return Promise.resolve(new Blob([bytes], { type: opts?.type ?? 'image/png' }));
    }
  }
  g.OffscreenCanvas = FakeOffscreenCanvas;
  return env;
}

describe('the import pipeline reads the source size from its HEADER', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).createImageBitmap;
    delete (globalThis as Record<string, unknown>).OffscreenCanvas;
  });

  it('a photo above both caps decodes ONCE PER SCALE and never at full resolution', async () => {
    // 6000×4500: a 4096 master and a 1024 display copy, each decoded
    // straight to the size wanted. It used to be four decodes — every scale
    // preceded by a throwaway full-resolution one read for two numbers.
    const env = installFakeDecoder(6000, 4500);
    const out = await prepareImageImport(jpegHeader(6000, 4500), 'image/jpeg', 0, 0);
    expect(env.decodes).toEqual([
      { width: 4096, height: 3072 },
      { width: 1024, height: 768 },
    ]);
    expect(env.decodes).not.toContain(null);
    expect(out.image.pixelWidth).toBe(1024);
    expect(out.image.pixelHeight).toBe(768);
    expect(out.originalBytes).toBeDefined();
  });

  it('a photo inside the master cap decodes it once, and the display copy straight to size', async () => {
    // 4000×3000 fits ORIGINAL_MAX_EDGE_PX, so the master IS the native
    // decode — there is no smaller size to ask for. The display copy still
    // skips the second one (two decodes, where it used to be three).
    const env = installFakeDecoder(4000, 3000);
    await prepareImageImport(jpegHeader(4000, 3000), 'image/jpeg', 0, 0);
    expect(env.decodes).toEqual([null, { width: 1024, height: 768 }]);
  });

  it('a JPEG source is never scanned for alpha it cannot hold', async () => {
    // bitmapHasAlpha draws the whole bitmap into an OffscreenCanvas and reads
    // every pixel back — ~64 MB of RGBA for a 4096 px master, to discover
    // what the format already guarantees.
    const env = installFakeDecoder(4000, 3000);
    const out = await prepareImageImport(jpegHeader(4000, 3000), 'image/jpeg', 0, 0);
    expect(env.alphaScans).toBe(0);
    expect(out.image.mimeType).toBe('image/jpeg');
  });

  it('a PNG source IS scanned — its alpha is a real question', async () => {
    const env = installFakeDecoder(4000, 3000);
    const out = await prepareImageImport(pngHeader(4000, 3000), 'image/png', 0, 0);
    expect(env.alphaScans).toBeGreaterThan(0);
    // Opaque throughout, per the fake, so it re-encodes as JPEG.
    expect(out.image.mimeType).toBe('image/jpeg');
  });

  it('falls back to a native decode when the header cannot be read', async () => {
    const env = installFakeDecoder(4000, 3000);
    await prepareImageImport(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 'image/jpeg', 0, 0);
    expect(env.decodes[0]).toBeNull();
  });

  it('a source already inside the display cap keeps one copy and one decode', async () => {
    const env = installFakeDecoder(800, 600);
    const out = await prepareImageImport(jpegHeader(800, 600), 'image/jpeg', 0, 0);
    expect(out.originalBytes).toBeUndefined();
    expect(out.image.originalImageId).toBeUndefined();
    // Under both caps, so nothing is resized: one native decode, reused.
    expect(env.decodes).toEqual([null]);
  });

  it('the replacement pipeline reads the header too', async () => {
    const env = installFakeDecoder(6000, 4500);
    const out = await prepareImageReplacement(jpegHeader(6000, 4500), 'image/jpeg');
    expect(env.decodes).toEqual([
      { width: 4096, height: 3072 },
      { width: 1024, height: 768 },
    ]);
    expect(env.alphaScans).toBe(0);
    expect(out.pixelWidth).toBe(1024);
  });

  // `env.decodes` above is this file's own bookkeeping. The two below pin the
  // SHIPPED counters (docs/image_refactor.md §5) against it, which is what
  // lets every other test — and the running app — read a decode count
  // without installing a fake of its own.
  it('counts a decode straight to size as scaled, not full', async () => {
    installFakeDecoder(6000, 4500);
    const { counters } = await perfDelta(
      () => prepareImageImport(jpegHeader(6000, 4500), 'image/jpeg', 0, 0),
    );
    // A master and a display copy, each asked for at its size. This is the
    // budget row "full-resolution decodes per tick: 0" holding.
    expect(counters.decodeFullCount).toBe(0);
    expect(counters.decodeScaledCount).toBe(2);
  });

  it('records whether the header was readable, so a miss is visible not inferred', async () => {
    // A readable header is the difference between one full decode per import
    // and two. When a device shows two, this says which it was.
    installFakeDecoder(6000, 4500);
    const ok = await perfDelta(
      () => prepareImageImport(jpegHeader(6000, 4500), 'image/jpeg', 0, 0),
    );
    expect(ok.counters.headerHitCount).toBe(2);   // one per scale
    expect(ok.counters.headerMissCount).toBe(0);

    installFakeDecoder(4000, 3000);
    const bad = await perfDelta(
      () => prepareImageImport(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 'image/jpeg', 0, 0),
    );
    expect(bad.counters.headerHitCount).toBe(0);
    expect(bad.counters.headerMissCount).toBeGreaterThan(0);
  });

  it('a PNG source under the master cap costs ONE full decode, not two', async () => {
    // The shape a screenshot import takes: 1206x2622, inside the 4096 master
    // cap and outside the 1024 display cap. The master IS the native decode;
    // the display copy is asked for at size. A second full decode here means
    // the header was not read.
    installFakeDecoder(1206, 2622);
    const { counters } = await perfDelta(
      () => prepareImageImport(pngHeader(1206, 2622), 'image/png', 0, 0),
    );
    expect(counters.headerMissCount).toBe(0);
    expect(counters.decodeFullCount).toBe(1);
    expect(counters.decodeScaledCount).toBe(1);
  });

  it('counts the header fallback as the full-resolution decode it is', async () => {
    installFakeDecoder(4000, 3000);
    const { counters } = await perfDelta(
      () => prepareImageImport(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 'image/jpeg', 0, 0),
    );
    // A source whose header cannot be read still pays for decodes read for
    // two numbers — the cost imageHeaderSize exists to avoid.
    expect(counters.decodeFullCount).toBeGreaterThan(0);
  });
});

describe('an image\u2019s id is a hash of its own bytes', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).createImageBitmap;
    delete (globalThis as Record<string, unknown>).OffscreenCanvas;
  });

  it('the same photo picked twice converges on one id, display copy and master alike', async () => {
    // Random ids meant the same photo stored its bytes twice, a duplicated
    // page duplicated every blob, and a page imported from a friend who had
    // the same photo stored a third copy.
    installFakeDecoder(6000, 4500);
    const source = jpegHeader(6000, 4500);
    const first = await prepareImageImport(source, 'image/jpeg', 0, 0);
    const second = await prepareImageImport(new Uint8Array(source), 'image/jpeg', 12, 12);
    expect(second.image.imageId).toBe(first.image.imageId);
    expect(second.image.originalImageId).toBe(first.image.originalImageId);
    // The NODE ids are still distinct — two placements of one photo.
    expect(second.image.id).not.toBe(first.image.id);
    expect(first.image.imageId).toMatch(/^imgblob_[A-Za-z0-9_-]{22}$/);
  });

  it('the display copy and the master are addressed separately', async () => {
    installFakeDecoder(6000, 4500);
    const out = await prepareImageImport(jpegHeader(6000, 4500), 'image/jpeg', 0, 0);
    expect(out.image.originalImageId).toBeDefined();
    expect(out.image.originalImageId).not.toBe(out.image.imageId);
  });

  it('an SVG is addressed by its markup, and replacement agrees with import', async () => {
    const svg = new TextEncoder().encode('<svg width="24" height="24"></svg>');
    const imported = await prepareImageImport(svg, SVG_MIME_TYPE, 0, 0);
    const replaced = await prepareImageReplacement(new Uint8Array(svg), SVG_MIME_TYPE);
    expect(replaced.imageId).toBe(imported.image.imageId);
  });

  it('different bytes get different ids', async () => {
    installFakeDecoder(6000, 4500);
    const a = await prepareImageImport(jpegHeader(6000, 4500), 'image/jpeg', 0, 0);
    const b = await prepareImageImport(jpegHeader(5000, 4000), 'image/jpeg', 0, 0);
    expect(b.image.imageId).not.toBe(a.image.imageId);
  });
});
