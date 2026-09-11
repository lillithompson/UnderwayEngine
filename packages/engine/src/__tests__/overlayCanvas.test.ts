import {
  PAINT_OVERLAY_CANVAS_ATTR,
  OverlayCanvasLike,
  drawOverlayToCanvas,
  drawPaintOverlaySlots,
  overlayImageData,
} from '../overlayCanvas';
import { createImagePaintOverlay } from '../imagePaintOverlay';
import type { ImagePaintOverlay } from '../types';

// Node has no ImageData; the helper only needs the (data, width, height)
// constructor contract, which this stub honours.
class FakeImageData {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}

beforeAll(() => {
  (globalThis as unknown as { ImageData: unknown }).ImageData = FakeImageData;
});
afterAll(() => {
  delete (globalThis as unknown as { ImageData?: unknown }).ImageData;
});

/** A canvas double that records puts and bitmap resets. */
function fakeCanvas(width = 0, height = 0, withContext = true) {
  const puts: Array<{ data: ImageData; dx: number; dy: number }> = [];
  const resets: string[] = [];
  const canvas = {
    _w: width,
    _h: height,
    get width() { return this._w; },
    set width(v: number) { this._w = v; resets.push(`w=${v}`); },
    get height() { return this._h; },
    set height(v: number) { this._h = v; resets.push(`h=${v}`); },
    getContext: (id: '2d') => (withContext && id === '2d'
      ? { putImageData: (data: ImageData, dx: number, dy: number) => { puts.push({ data, dx, dy }); } }
      : null),
  };
  return { canvas: canvas as unknown as OverlayCanvasLike, puts, resets };
}

function painted(cols = 8, rows = 6): ImagePaintOverlay {
  const o = createImagePaintOverlay(cols / 4, rows / 4, 'multiply');
  o.rgba[0] = 255; o.rgba[3] = 255;
  return o;
}

describe('overlayImageData', () => {
  test('wraps the overlay bytes without copying, at the overlay dims', () => {
    const o = painted(8, 6);
    const img = overlayImageData(o) as unknown as FakeImageData;
    expect(img.width).toBe(8);
    expect(img.height).toBe(6);
    expect(img.data.length).toBe(8 * 6 * 4);
    expect(img.data.buffer).toBe(o.rgba.buffer);
    // Aliasing: a working overlay mutated in place reads current.
    o.rgba[7] = 128;
    expect(img.data[7]).toBe(128);
  });

  test('is cached per byte-array, and re-wrapped when the array changes', () => {
    const o = painted();
    const first = overlayImageData(o);
    expect(overlayImageData(o)).toBe(first);
    const swapped = { ...o, rgba: new Uint8Array(o.rgba) };
    expect(overlayImageData(swapped)).not.toBe(first);
    expect(overlayImageData(swapped)).toBe(overlayImageData(swapped));
  });

  test('honours a byte offset into a larger buffer', () => {
    const backing = new Uint8Array(4 + 4 * 4);
    const o: ImagePaintOverlay = { cols: 2, rows: 2, rgba: backing.subarray(4), blend: 'normal' };
    backing[4] = 9;
    const img = overlayImageData(o) as unknown as FakeImageData;
    expect(img.data.length).toBe(16);
    expect(img.data[0]).toBe(9);
  });
});

describe('drawOverlayToCanvas', () => {
  test('sizes the bitmap to the overlay and puts the view at the origin', () => {
    const o = painted(8, 6);
    const { canvas, puts, resets } = fakeCanvas();
    expect(drawOverlayToCanvas(canvas, o)).toBe(true);
    expect(resets).toEqual(['w=8', 'h=6']);
    expect(puts).toHaveLength(1);
    expect(puts[0].data).toBe(overlayImageData(o));
    expect(puts[0]).toMatchObject({ dx: 0, dy: 0 });
  });

  test('leaves an already-sized bitmap alone (no reset) and only re-puts', () => {
    const o = painted(8, 6);
    const { canvas, puts, resets } = fakeCanvas(8, 6);
    drawOverlayToCanvas(canvas, o);
    drawOverlayToCanvas(canvas, o);
    expect(resets).toEqual([]);
    expect(puts).toHaveLength(2);
  });

  test('resizes when the overlay dims change', () => {
    const { canvas, resets } = fakeCanvas(8, 6);
    drawOverlayToCanvas(canvas, painted(4, 6));
    expect(resets).toEqual(['w=4']);
  });

  test('reports a missing 2D context', () => {
    const { canvas, puts } = fakeCanvas(0, 0, false);
    expect(drawOverlayToCanvas(canvas, painted())).toBe(false);
    expect(puts).toHaveLength(0);
  });
});

describe('drawPaintOverlaySlots', () => {
  function slot(id: string | null) {
    const { canvas, puts } = fakeCanvas();
    const el = Object.assign(canvas, { getAttribute: (name: string) => (name === PAINT_OVERLAY_CANVAS_ATTR ? id : null) });
    return { el, puts };
  }

  test('draws each slot from the overlay its id resolves to, skipping the rest', () => {
    const a = slot('svg_a');
    const b = slot('svg_b');
    const unknown = slot('svg_zzz');
    const bare = slot(null);
    const selectors: string[] = [];
    const root = {
      querySelectorAll: (sel: string) => { selectors.push(sel); return [a.el, b.el, unknown.el, bare.el]; },
    };
    const overlays: Record<string, ImagePaintOverlay> = { svg_a: painted(4, 4), svg_b: painted(8, 4) };
    expect(drawPaintOverlaySlots(root, (id) => overlays[id])).toBe(2);
    expect(selectors).toEqual([`canvas[${PAINT_OVERLAY_CANVAS_ATTR}]`]);
    expect(a.puts[0].data).toBe(overlayImageData(overlays.svg_a));
    expect(b.puts[0].data).toBe(overlayImageData(overlays.svg_b));
    expect(unknown.puts).toHaveLength(0);
    expect(bare.puts).toHaveLength(0);
  });
});
