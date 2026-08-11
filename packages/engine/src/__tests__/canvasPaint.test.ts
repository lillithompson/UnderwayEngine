/**
 * The paint tool's canvas raster layer (canvasPaint.ts): layer sizing, the
 * stamp/erase brush passes, and the occlusion mask — visible vector objects
 * silhouette themselves out of a dab (fill state and stroke widths
 * respected, transparency and hidden objects ignored) — plus the
 * setCanvasPaint undo op and the v50 binary round trip.
 */

import {
  CANVAS_PAINT_TEXELS_PER_CELL, CANVAS_PAINT_WIDTH_CELLS,
  canvasPaintHeightCells, createCanvasPaint, createCanvasPaintMask,
  eraseCanvasPaint, stampCanvasPaint,
} from '../canvasPaint';
import { paintOverlayHasInk } from '../imagePaintOverlay';
import { applyCompOps, revertCompOps } from '../compositionOps';
import { serializeComposition, deserializeComposition } from '../compositionBinaryFormat';
import {
  CompositionState, ImagePaintOverlay, PathSegment, RGBColor, SVGObject, makeViewport,
} from '../types';

const RED: RGBColor = { r: 255, g: 0, b: 0 };
const BLACK: RGBColor = { r: 0, g: 0, b: 0 };

const line = (start: [number, number], end: [number, number]): PathSegment =>
  ({ kind: 'line', start, end });

/** A closed 8×8 rectangle outline at (8, 8). */
function rect(id: string, extras: Partial<SVGObject> = {}): SVGObject {
  return {
    id,
    segments: [
      line([8, 8], [16, 8]),
      line([16, 8], [16, 16]),
      line([16, 16], [8, 16]),
      line([8, 16], [8, 8]),
    ],
    color: BLACK,
    cellX: 8, cellY: 8, cellWidth: 8, cellHeight: 8,
    ...extras,
  };
}

function makeState(svgObjects: SVGObject[], extras: Partial<CompositionState> = {}): CompositionState {
  return {
    id: 'test',
    name: 'test',
    figures: [],
    svgObjects,
    lineDraft: null,
    arcDraft: null,
    editingLineId: null,
    selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
    customColors: [],
    groups: [],
    sceneOrder: svgObjects.map((s) => s.id),
    gridLevel: 0,
    strokeScale: 1,
    gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(),
    activeFigureKey: null,
    compTool: 'select',
    createRegion: null,
    renderGeneration: 0,
    ...extras,
  };
}

/** Alpha of the texel whose center is nearest world-cell (x, y). */
function alphaAt(layer: ImagePaintOverlay, x: number, y: number): number {
  const texW = CANVAS_PAINT_WIDTH_CELLS / layer.cols;
  const c = Math.min(layer.cols - 1, Math.max(0, Math.floor(x / texW)));
  const r = Math.min(layer.rows - 1, Math.max(0, Math.floor(y / texW)));
  return layer.rgba[(r * layer.cols + c) * 4 + 3];
}

describe('createCanvasPaint', () => {
  it('sizes the layer to the page at the canvas texel density', () => {
    const layer = createCanvasPaint(44.4);
    expect(layer.cols).toBe(CANVAS_PAINT_WIDTH_CELLS * CANVAS_PAINT_TEXELS_PER_CELL);
    expect(layer.rows).toBe(Math.round(44.4 * CANVAS_PAINT_TEXELS_PER_CELL));
    expect(layer.rgba.length).toBe(layer.cols * layer.rows * 4);
    expect(paintOverlayHasInk(layer)).toBe(false);
  });

  it('derives the covered height back from the texel grid', () => {
    const layer = createCanvasPaint(48);
    expect(canvasPaintHeightCells(layer)).toBeCloseTo(48);
  });

  it('clamps degenerate heights to a sane texel grid', () => {
    expect(createCanvasPaint(0.01).rows).toBe(CANVAS_PAINT_TEXELS_PER_CELL);
    expect(createCanvasPaint(100000).rows).toBe(4096);
  });
});

describe('stampCanvasPaint', () => {
  it('deposits full alpha at the dab center, fading with the gaussian edge', () => {
    const layer = createCanvasPaint(32);
    // 16.0625 is a texel center at density 8 (texel = 1/8 cell), so the
    // centermost texel sits at distance 0 → falloff exactly 1.
    expect(stampCanvasPaint(layer, 16.0625, 16.0625, 2, RED, 1)).toBe(true);
    expect(alphaAt(layer, 16.0625, 16.0625)).toBe(255);
    // Outside the radius: untouched.
    expect(alphaAt(layer, 20, 16)).toBe(0);
    // The color lands as the brush color.
    const texW = CANVAS_PAINT_WIDTH_CELLS / layer.cols;
    const i = (Math.floor(16 / texW) * layer.cols + Math.floor(16 / texW)) * 4;
    expect(layer.rgba[i]).toBe(255);
    expect(layer.rgba[i + 1]).toBe(0);
  });

  it('floors a sub-texel radius so a dab still lands', () => {
    const layer = createCanvasPaint(32);
    // Radius 1/64 cell ≪ one texel (1/8 cell at density 8): without the
    // floor, no texel center falls inside the disc and nothing paints.
    expect(stampCanvasPaint(layer, 16.0625, 16.0625, 1 / 64, RED, 1)).toBe(true);
    expect(paintOverlayHasInk(layer)).toBe(true);
  });

  it('erases back out', () => {
    const layer = createCanvasPaint(32);
    stampCanvasPaint(layer, 16.0625, 16.0625, 2, RED, 1);
    expect(eraseCanvasPaint(layer, 16.0625, 16.0625, 2, 1)).toBe(true);
    expect(alphaAt(layer, 16.0625, 16.0625)).toBe(0);
  });
});

describe('createCanvasPaintMask', () => {
  it('a filled shape blocks its interior; an unfilled one only its stroke band', () => {
    const layer = createCanvasPaint(32);
    const filled = createCanvasPaintMask(makeState([rect('a', { fillColor: RED })]), layer);
    expect(filled.blockedAt(12, 12)).toBe(true);   // interior
    expect(filled.blockedAt(4, 4)).toBe(false);    // outside

    const outline = createCanvasPaintMask(makeState([rect('a')]), layer);
    expect(outline.blockedAt(12, 12)).toBe(false); // interior of an UNFILLED shape paints
    expect(outline.blockedAt(12, 8)).toBe(true);   // on the stroke centerline
  });

  it('respects the stroke width: a wider stroke blocks a wider band', () => {
    const layer = createCanvasPaint(32);
    // Default width is 5/16 cell (SVG_STROKE_WIDTH / DOM_PX_PER_CELL at
    // strokeScale 1) → half-width ≈ 0.156: a point 0.5 cells off the edge
    // is clear of it.
    const thin = createCanvasPaintMask(makeState([rect('a')]), layer);
    expect(thin.blockedAt(12, 8.5)).toBe(false);
    // A 2-cell-wide authored stroke reaches a full cell either side.
    const thick = createCanvasPaintMask(
      makeState([rect('a', { stroke: { width: 2 } })]), layer,
    );
    expect(thick.blockedAt(12, 8.5)).toBe(true);
    expect(thick.blockedAt(12, 9.5)).toBe(false);
  });

  it('ignores hidden objects and members of hidden groups', () => {
    const layer = createCanvasPaint(32);
    const hiddenObj = createCanvasPaintMask(
      makeState([rect('a', { fillColor: RED, hidden: true })]), layer,
    );
    expect(hiddenObj.blockedAt(12, 12)).toBe(false);

    const hiddenGroup = createCanvasPaintMask(
      makeState(
        [rect('a', { fillColor: RED, groupId: 'g1' })],
        {
          groups: [{
            id: 'g1', name: 'g', hidden: true,
            translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
            rotation: 0, mirrorH: false, mirrorV: false,
          }],
        },
      ),
      layer,
    );
    expect(hiddenGroup.blockedAt(12, 12)).toBe(false);
  });

  it('ignores transparency: a fully transparent fill still blocks', () => {
    const layer = createCanvasPaint(32);
    const mask = createCanvasPaintMask(
      makeState([rect('a', { fillColor: RED, fillOpacity: 0, opacity: 0 })]), layer,
    );
    expect(mask.blockedAt(12, 12)).toBe(true);
  });

  it('memoizes per texel through blockedTexel', () => {
    const layer = createCanvasPaint(32);
    const mask = createCanvasPaintMask(makeState([rect('a', { fillColor: RED })]), layer);
    const texW = CANVAS_PAINT_WIDTH_CELLS / layer.cols;
    const c = Math.floor(12 / texW);
    const i = (c * layer.cols + c) * 4;
    expect(mask.blockedTexel(i, 12, 12)).toBe(true);
    // Cached: even a lying coordinate returns the memoized answer.
    expect(mask.blockedTexel(i, 0, 0)).toBe(true);
  });

  it('masks a stamp: the dab paints around the shape, not under it', () => {
    const layer = createCanvasPaint(32);
    const state = makeState([rect('a', { fillColor: RED })]);
    const mask = createCanvasPaintMask(state, layer);
    // Dab centered on the shape's left edge: half in, half out.
    stampCanvasPaint(layer, 8, 12, 2, RED, 1, mask);
    expect(alphaAt(layer, 6.5, 12)).toBeGreaterThan(0);  // outside the shape
    expect(alphaAt(layer, 9, 12)).toBe(0);               // occluded interior
  });
});

describe('setCanvasPaint op', () => {
  it('applies and reverts the layer swap', () => {
    const state = makeState([]);
    const layer = createCanvasPaint(32);
    stampCanvasPaint(layer, 16, 16, 2, RED, 1);
    const entry = [{ op: 'setCanvasPaint' as const, oldLayer: undefined, newLayer: layer }];
    const applied = applyCompOps(state, entry);
    expect(applied.canvasPaint).toBe(layer);
    const reverted = revertCompOps(applied, entry);
    expect(reverted.canvasPaint).toBeUndefined();
  });
});

describe('binary v50 round trip', () => {
  it('round-trips the canvas paint layer through serialize/deserialize', () => {
    const layer = createCanvasPaint(48);
    stampCanvasPaint(layer, 16, 16, 2, RED, 1);
    const state = makeState([], { canvasPaint: layer });
    const bytes = serializeComposition(
      {
        name: state.name, gridLevel: state.gridLevel, strokeScale: state.strokeScale,
        gridIntensity: state.gridIntensity, camera: state.camera, figures: [],
        svgObjects: [], groups: [], sceneOrder: [], canvasPaint: state.canvasPaint,
      },
      [],
    );
    const back = deserializeComposition(bytes);
    expect(back.meta.canvasPaint).toBeDefined();
    expect(back.meta.canvasPaint!.cols).toBe(layer.cols);
    expect(back.meta.canvasPaint!.rows).toBe(layer.rows);
    expect(Array.from(back.meta.canvasPaint!.rgba)).toEqual(Array.from(layer.rgba));
  });

  it('omits the section cleanly when there is no layer', () => {
    const bytes = serializeComposition(
      {
        name: 'x', gridLevel: 0, strokeScale: 1, gridIntensity: 0.5,
        camera: { offsetX: 0, offsetY: 0, zoom: 1 }, figures: [],
        svgObjects: [], groups: [], sceneOrder: [],
      },
      [],
    );
    expect(deserializeComposition(bytes).meta.canvasPaint).toBeUndefined();
  });
});
