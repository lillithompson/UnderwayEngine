import { ElementFactory, createPaintPreviewCanvas, paintCanvasStyle } from '../paintOverlayPreview';
import { createImagePaintOverlay } from '@/engine/imagePaintOverlay';
import { overlayImageData } from '@/engine/overlayCanvas';

// Node has neither ImageData nor a DOM; the builder needs only the
// (data, width, height) constructor and an element factory, stubbed here.
class FakeImageData {
  constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
}
beforeAll(() => { (globalThis as unknown as { ImageData: unknown }).ImageData = FakeImageData; });
afterAll(() => { delete (globalThis as unknown as { ImageData?: unknown }).ImageData; });

interface FakeEl {
  tag: string;
  attrs: Record<string, string>;
  style: Record<string, string>;
  width: number;
  height: number;
  puts: Array<{ data: unknown; dx: number; dy: number }>;
  getContext(id: string): { putImageData(data: unknown, dx: number, dy: number): void } | null;
}

function fakeDoc(): ElementFactory & { created: FakeEl[] } {
  const created: FakeEl[] = [];
  return {
    created,
    createElement(tag: 'canvas') {
      const el: FakeEl = {
        tag, attrs: {}, style: {}, width: 0, height: 0, puts: [],
        getContext(id) {
          return id === '2d' ? { putImageData: (data, dx, dy) => { el.puts.push({ data, dx, dy }); } } : null;
        },
      };
      created.push(el);
      return el as unknown as HTMLCanvasElement;
    },
  };
}

const overlay = createImagePaintOverlay(4, 3, 'multiply'); // 16 × 12 texels

describe('paintCanvasStyle — the one styling a paint canvas wears, committed or previewed', () => {
  test('fills the host, composites with the overlay blend, and is cut with the clip it is given', () => {
    expect(paintCanvasStyle(overlay, 'paintclip_svg_1')).toEqual({
      position: 'absolute', inset: '0', width: '100%', height: '100%',
      pointerEvents: 'none', userSelect: 'none',
      mixBlendMode: 'multiply', clipPath: 'url(#paintclip_svg_1)',
    });
  });

  test('no clip (an image, a shape with no closed outline) → no clip-path at all', () => {
    expect(paintCanvasStyle(overlay)).not.toHaveProperty('clipPath');
    expect(paintCanvasStyle(overlay, null)).not.toHaveProperty('clipPath');
    expect(paintCanvasStyle({ blend: 'normal' }).mixBlendMode).toBe('normal');
  });
});

describe('createPaintPreviewCanvas', () => {
  test('a canvas at the overlay texel size, styled as the committed layer, drawn once', () => {
    const doc = fakeDoc();
    const el = createPaintPreviewCanvas(doc, overlay) as unknown as FakeEl;
    expect(el.tag).toBe('canvas');
    expect([el.width, el.height]).toEqual([overlay.cols, overlay.rows]);
    expect(el.style).toEqual(paintCanvasStyle(overlay));
    expect(el.puts).toHaveLength(1);
    expect(el.puts[0].data).toBe(overlayImageData(overlay));
    // The whole point: no pixel-carrying URL anywhere on the element.
    expect(el.attrs.src).toBeUndefined();
    expect(JSON.stringify(el.attrs)).not.toContain('data:');
  });

  test('a shape preview is the same canvas cut with the shape’s outline clip — no foreignObject', () => {
    const doc = fakeDoc();
    const el = createPaintPreviewCanvas(doc, overlay, 'paintclip_svg_1') as unknown as FakeEl;
    expect(doc.created).toEqual([el]);
    expect(el.tag).toBe('canvas');
    expect(el.style.clipPath).toBe('url(#paintclip_svg_1)');
    expect(el.style.mixBlendMode).toBe('multiply');
  });
});
