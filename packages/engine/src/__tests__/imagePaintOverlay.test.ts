/**
 * The color tool's image paint layer ({@link ImagePaintOverlay}): the texel
 * grid + stamp math both renderers and the brush share, the engine-encoded
 * PNG the layer renders from, the v48 binary payload, and the SVG export's
 * blended <image> overlay.
 */

import {
  clonePaintOverlay,
  createImagePaintOverlay,
  overlayPngDataUri,
  paintBlendCss,
  paintOverlayHasInk,
  stampImagePaintOverlay,
  OVERLAY_TEXELS_PER_CELL,
} from '../imagePaintOverlay';
import { gaussianFalloff } from '../colorBlend';
import {
  CompositionBundle,
  deserializeComposition,
  serializeComposition,
} from '../compositionBinaryFormat';
import { generateCompositionSVGCore, type CompositionSVGInputs } from '../compositionSVGCore';
import { ImageObject, ImagePaintOverlay, RGBColor } from '../types';

const RED: RGBColor = { r: 255, g: 0, b: 0 };

describe('createImagePaintOverlay', () => {
  test('sizes the grid at OVERLAY_TEXELS_PER_CELL, clamped to [4, 64]', () => {
    const o = createImagePaintOverlay(8, 6, 'normal');
    expect(o.cols).toBe(8 * OVERLAY_TEXELS_PER_CELL);
    expect(o.rows).toBe(6 * OVERLAY_TEXELS_PER_CELL);
    expect(o.rgba.length).toBe(o.cols * o.rows * 4);
    expect(createImagePaintOverlay(0.5, 100, 'normal')).toMatchObject({ cols: 4, rows: 64 });
  });
});

describe('stampImagePaintOverlay', () => {
  test('a dead-center dab writes the brush color with falloff-scaled alpha', () => {
    const o = createImagePaintOverlay(8, 6, 'normal');
    // Center of texel (16, 12) is (4.125, 3.125); stamp exactly there.
    const changed = stampImagePaintOverlay(o, 8, 6, 4.125, 3.125, 1, RED, 1);
    expect(changed).toBe(true);
    const i = (12 * o.cols + 16) * 4;
    expect([o.rgba[i], o.rgba[i + 1], o.rgba[i + 2], o.rgba[i + 3]]).toEqual([255, 0, 0, 255]);
    // A texel half a cell out carries the gaussian falloff as its alpha.
    const j = (12 * o.cols + 18) * 4; // center (4.625, 3.125), 0.5 away
    expect(o.rgba[j + 3]).toBe(Math.round(gaussianFalloff(0.25) * 255));
    // Outside the radius: untouched.
    expect(o.rgba[3]).toBe(0);
  });

  test('repeat dabs accumulate source-over toward full alpha', () => {
    const o = createImagePaintOverlay(8, 6, 'normal');
    stampImagePaintOverlay(o, 8, 6, 4.125, 3.125, 1, RED, 0.5);
    const i = (12 * o.cols + 16) * 4;
    const once = o.rgba[i + 3];
    expect(once).toBe(128); // round(0.5 × 255)
    stampImagePaintOverlay(o, 8, 6, 4.125, 3.125, 1, RED, 0.5);
    // Source-over on the quantized stored alpha: 0.5 + (128/255) × 0.5.
    expect(o.rgba[i + 3]).toBe(Math.round((0.5 + (128 / 255) * 0.5) * 255));
  });

  test('a dab entirely off the disc changes nothing', () => {
    const o = createImagePaintOverlay(8, 6, 'normal');
    expect(stampImagePaintOverlay(o, 8, 6, -5, -5, 1, RED, 1)).toBe(false);
    expect(paintOverlayHasInk(o)).toBe(false);
  });

  test('clonePaintOverlay detaches the byte buffer', () => {
    const o = createImagePaintOverlay(8, 6, 'normal');
    const copy = clonePaintOverlay(o);
    stampImagePaintOverlay(copy, 8, 6, 4.125, 3.125, 1, RED, 1);
    expect(paintOverlayHasInk(copy)).toBe(true);
    expect(paintOverlayHasInk(o)).toBe(false);
  });
});

describe('overlayPngDataUri', () => {
  test('emits a valid RGBA PNG of the grid dimensions', () => {
    const o = createImagePaintOverlay(8, 6, 'normal');
    const uri = overlayPngDataUri(o);
    expect(uri.startsWith('data:image/png;base64,')).toBe(true);
    const bytes = Uint8Array.from(
      Buffer.from(uri.slice('data:image/png;base64,'.length), 'base64'),
    );
    // PNG signature, then IHDR width/height (u32 BE at offsets 16 / 20).
    expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const be32 = (off: number) =>
      (bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3];
    expect(be32(16)).toBe(o.cols);
    expect(be32(20)).toBe(o.rows);
  });
});

describe('paintBlendCss', () => {
  test('maps compositing modes and rejects the unary ones', () => {
    expect(paintBlendCss('normal')).toBe('normal');
    expect(paintBlendCss('dodge')).toBe('color-dodge');
    expect(paintBlendCss('burn')).toBe('color-burn');
    expect(paintBlendCss('invert')).toBeNull();
    expect(paintBlendCss('rotate')).toBeNull();
    expect(paintBlendCss('randomize')).toBeNull();
  });
});

// ── Binary round-trip (v48) ─────────────────────────────────────────

function makeImage(overrides: Partial<ImageObject> = {}): ImageObject {
  return {
    id: 'img_1',
    imageId: 'blob1',
    mimeType: 'image/png',
    pixelWidth: 4, pixelHeight: 4,
    cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 6,
    ...overrides,
  };
}

function makeBundle(images: ImageObject[]): CompositionBundle {
  return {
    name: 'PaintOverlay Comp',
    gridLevel: 1,
    strokeScale: 0.5,
    gridIntensity: 0.3,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    figures: [],
    images,
    imageBlobs: { blob1: new Uint8Array([1, 2, 3]) },
  };
}

function paintedOverlay(): ImagePaintOverlay {
  const o = createImagePaintOverlay(8, 6, 'multiply');
  stampImagePaintOverlay(o, 8, 6, 4.125, 3.125, 1, RED, 1);
  return o;
}

describe('paintOverlay binary round-trip (v48)', () => {
  test('the layer round-trips byte-for-byte with its blend mode', () => {
    const overlay = paintedOverlay();
    const rt = deserializeComposition(
      serializeComposition(makeBundle([makeImage({ paintOverlay: overlay })]), []),
    );
    const back = rt.meta.images?.[0].paintOverlay;
    expect(back?.cols).toBe(overlay.cols);
    expect(back?.rows).toBe(overlay.rows);
    expect(back?.blend).toBe('multiply');
    expect(Array.from(back!.rgba)).toEqual(Array.from(overlay.rgba));
  });

  test('absent paintOverlay stays absent, alongside the other flags2 payloads', () => {
    const rt = deserializeComposition(
      serializeComposition(makeBundle([makeImage({ edgeSoften: 0.5 })]), []),
    );
    const img = rt.meta.images?.[0];
    expect(img?.paintOverlay).toBeUndefined();
    expect(img?.edgeSoften).toBeCloseTo(0.5, 2);
  });
});

// ── SVG export ──────────────────────────────────────────────────────

function makeInputs(partial: Partial<CompositionSVGInputs>): CompositionSVGInputs {
  return {
    name: 'PaintOverlay',
    figures: [],
    svgObjects: [],
    images: [],
    imageBlobs: {},
    strokeScale: 0.04,
    loadFigure: async () => null,
    ...partial,
  };
}

describe('SVG export of paintOverlay', () => {
  test('emits the layer as a blended, stretched <image> in an isolated group', async () => {
    const overlay = paintedOverlay();
    const svg = await generateCompositionSVGCore(makeInputs({
      images: [makeImage({ paintOverlay: overlay })],
      imageBlobs: { blob1: new Uint8Array([1, 2, 3]) },
      sceneOrder: ['img_1'],
    }));
    expect(svg).toContain(`href="${overlayPngDataUri(overlay)}"`);
    expect(svg).toContain('style="mix-blend-mode:multiply"');
    expect(svg).toContain('<g style="isolation:isolate">');
  });

  test('an image without a layer exports no overlay markup', async () => {
    const svg = await generateCompositionSVGCore(makeInputs({
      images: [makeImage()],
      imageBlobs: { blob1: new Uint8Array([1, 2, 3]) },
      sceneOrder: ['img_1'],
    }));
    expect(svg).not.toContain('isolation:isolate');
  });
});
