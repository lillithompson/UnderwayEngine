import {
  decodeLevelBytes, decodeLevelEdge, decodeLevelKey, dropDecodeLevels,
  ensureDecodeLevel, peekDecodeLevel, purgeDecodeLevels,
} from '../imageDecodeLevels';
import { perfDelta } from '../debug/perfCounters';

// What the compositor allocates for a drawn photo is width × height × 4 off
// the SOURCE's pixels, not the box it is drawn in. The display copy is
// capped at MAX_EDGE_PX = 1024, sized for a photo that FILLS a page; a photo
// in a 4x3 collage cell is drawn at a quarter of the page's width, where
// 256 px is indistinguishable and costs a sixteenth of the decode.

describe('decodeLevelEdge', () => {
  it('rounds the drawn size up to a power of two, so zooms share a level', () => {
    expect(decodeLevelEdge(200, 1024)).toBe(256);
    expect(decodeLevelEdge(256, 1024)).toBe(256);
    expect(decodeLevelEdge(257, 1024)).toBe(512);
    expect(decodeLevelEdge(500, 1024)).toBe(512);
  });

  it('gives back the source itself when a level would buy nothing', () => {
    // The page-filling photo the display cap was sized for.
    expect(decodeLevelEdge(1024, 1024)).toBe(1024);
    expect(decodeLevelEdge(4000, 1024)).toBe(1024);
    // …and an image already small enough that re-encoding is pure cost.
    expect(decodeLevelEdge(100, 128)).toBe(128);
  });

  it('has a floor: below it the saving stops being worth a re-encode', () => {
    expect(decodeLevelEdge(20, 1024)).toBe(128);
    expect(decodeLevelEdge(1, 1024)).toBe(128);
  });

  it('degrades to the source for a size it cannot read', () => {
    expect(decodeLevelEdge(0, 1024)).toBe(1024);
    expect(decodeLevelEdge(-5, 1024)).toBe(1024);
    expect(decodeLevelEdge(200, 0)).toBe(0);
  });

  it('defaults the source to the import cap for a node that records none', () => {
    expect(decodeLevelEdge(4000)).toBe(1024);
  });
});

describe('the level cache', () => {
  const created: string[] = [];
  const revoked: string[] = [];
  let nextUrl = 0;

  /** A fake re-encoder: bitmaps that report a size, a canvas that "encodes"
   *  to bytes proportional to it, and object URLs we can count. */
  function installFakes(nativeEdge = 2048): void {
    const g = globalThis as Record<string, unknown>;
    g.createImageBitmap = async (src: unknown) => {
      const c = src as { width?: number; height?: number };
      if (typeof c.width === 'number' && typeof c.height === 'number' && !(src instanceof Blob)) {
        return { width: c.width, height: c.height, close: () => {} };
      }
      return { width: nativeEdge, height: nativeEdge / 2, close: () => {} };
    };
    class FakeOffscreenCanvas {
      width: number;
      height: number;
      constructor(width: number, height: number) { this.width = width; this.height = height; }
      getContext(): unknown { return { drawImage: () => {} }; }
      convertToBlob(opts?: { type?: string }): Promise<Blob> {
        return Promise.resolve(new Blob([new Uint8Array(this.width)], { type: opts?.type ?? 'image/png' }));
      }
    }
    g.OffscreenCanvas = FakeOffscreenCanvas;
    g.URL = {
      createObjectURL: (_b: Blob) => { const u = `blob:${nextUrl++}`; created.push(u); return u; },
      revokeObjectURL: (u: string) => { revoked.push(u); },
    };
  }

  beforeEach(() => {
    purgeDecodeLevels();
    created.length = 0;
    revoked.length = 0;
    nextUrl = 0;
    installFakes();
  });

  afterEach(() => {
    purgeDecodeLevels();
    for (const k of ['createImageBitmap', 'OffscreenCanvas', 'URL']) {
      delete (globalThis as Record<string, unknown>)[k];
    }
  });

  const PHOTO = new Uint8Array([1, 2, 3, 4]);

  it('keys a level by asset AND size — an id is its bytes, so the pair is exact', () => {
    expect(decodeLevelKey('imgblob_a', 256)).toBe('imgblob_a@256');
  });

  it('makes a level once and serves it after, budgeted in DECODED bytes', async () => {
    expect(peekDecodeLevel('imgblob_a', 256)).toBeNull();
    const level = await ensureDecodeLevel('imgblob_a', 256, PHOTO, 'image/jpeg');
    expect(level).not.toBeNull();
    expect(peekDecodeLevel('imgblob_a', 256)?.url).toBe(level!.url);
    // 256 × 256 × 4 — what the bitmap costs, not what the JPEG compresses to.
    expect(decodeLevelBytes()).toBe(256 * 256 * 4);
    await ensureDecodeLevel('imgblob_a', 256, PHOTO, 'image/jpeg');
    expect(created).toHaveLength(1);
  });

  it('costs one FULL-resolution decode per level made, and none per level served', async () => {
    // generateLevel probes the source with a bare createImageBitmap to learn
    // its dimensions, then resizes — so every new level materializes every
    // pixel of the photo first. The import path stopped doing this (it reads
    // imageHeaderSize instead); this path has not been moved over, and the
    // number below is what that costs. Serving a made level is free, which
    // is the half that matters for a per-tick budget.
    const first = await perfDelta(() => ensureDecodeLevel('imgblob_a', 256, PHOTO, 'image/jpeg'));
    expect(first.counters.decodeFullCount).toBe(1);

    const second = await perfDelta(() => ensureDecodeLevel('imgblob_a', 256, PHOTO, 'image/jpeg'));
    expect(second.counters.decodeFullCount).toBe(0);
  });

  it('collapses concurrent asks for one level', async () => {
    await Promise.all([
      ensureDecodeLevel('imgblob_a', 256, PHOTO, 'image/jpeg'),
      ensureDecodeLevel('imgblob_a', 256, PHOTO, 'image/jpeg'),
      ensureDecodeLevel('imgblob_a', 256, PHOTO, 'image/jpeg'),
    ]);
    expect(created).toHaveLength(1);
  });

  it('revokes a level’s object URL when it leaves the cache, however it leaves', async () => {
    // A leaked URL per photo per zoom level visited is exactly the kind of
    // thing a long collage session accumulates.
    const level = await ensureDecodeLevel('imgblob_a', 256, PHOTO, 'image/jpeg');
    expect(dropDecodeLevels('imgblob_a')).toBe(1);
    expect(revoked).toEqual([level!.url]);
    expect(peekDecodeLevel('imgblob_a', 256)).toBeNull();

    revoked.length = 0;
    const again = await ensureDecodeLevel('imgblob_b', 512, PHOTO, 'image/jpeg');
    purgeDecodeLevels();
    expect(revoked).toEqual([again!.url]);
  });

  it('evicts under the budget, revoking as it goes', async () => {
    // 24 MB of budget; a 2048 level is 2048² × 4 = 16 MB, so two do not fit.
    installFakes(8192); // a source big enough that a 2048 level is real
    const first = await ensureDecodeLevel('imgblob_a', 2048, PHOTO, 'image/jpeg');
    await ensureDecodeLevel('imgblob_b', 2048, PHOTO, 'image/jpeg');
    expect(peekDecodeLevel('imgblob_a', 2048)).toBeNull();
    expect(peekDecodeLevel('imgblob_b', 2048)).not.toBeNull();
    expect(revoked).toEqual([first!.url]);
  });

  it('never levels an SVG — its markup IS full resolution at every size', async () => {
    expect(await ensureDecodeLevel('imgblob_v', 256, PHOTO, 'image/svg+xml')).toBeNull();
    expect(created).toHaveLength(0);
  });

  it('makes no level for a source already at or under the size asked for', async () => {
    installFakes(200); // a 200 px source, asked for at 256
    expect(await ensureDecodeLevel('imgblob_small', 256, PHOTO, 'image/jpeg')).toBeNull();
    expect(decodeLevelBytes()).toBe(0);
  });

  it('is null where the environment cannot re-encode — the caller keeps the display copy', async () => {
    delete (globalThis as Record<string, unknown>).OffscreenCanvas;
    expect(await ensureDecodeLevel('imgblob_a', 256, PHOTO, 'image/jpeg')).toBeNull();
    delete (globalThis as Record<string, unknown>).createImageBitmap;
    expect(await ensureDecodeLevel('imgblob_a', 256, PHOTO, 'image/jpeg')).toBeNull();
  });

  it('a source that will not decode is null, not a throw', async () => {
    (globalThis as Record<string, unknown>).createImageBitmap = async () => { throw new Error('bad jpeg'); };
    await expect(ensureDecodeLevel('imgblob_a', 256, PHOTO, 'image/jpeg')).resolves.toBeNull();
  });
});
