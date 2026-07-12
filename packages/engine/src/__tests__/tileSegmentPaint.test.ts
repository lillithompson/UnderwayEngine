import {
  buildPaintStrokeOps,
  applyCompOps,
  revertCompOps,
  rotateSVG90CW,
  mirrorSVG,
  SCENE_ADAPTERS,
} from '@/engine/compositionOps';
import { makeViewport } from '@/engine/types';
import type { CompositionState, PaintStrokeDraft, PathSegment, RGBColor, SVGObject } from '@/engine/types';
import { packKey, unpackKey, countPaintedInstances } from '@/engine/tileSegmentOverrides';
import { buildExpandedTileSVGObjectContent } from '@/engine/svgPathBuilder';

const rgb = (r: number, g: number, b: number): RGBColor => ({ r, g, b });
const RED = rgb(255, 0, 0);
const BLUE = rgb(0, 0, 255);

function line(start: [number, number], end: [number, number]): PathSegment {
  return { kind: 'line', start, end };
}

/** A 4×4-tile square pattern (tile 10×10, region 40×40 at origin). */
function tiledSquare(extras: Partial<SVGObject> = {}): SVGObject {
  return {
    id: 'svg1',
    segments: [line([0, 0], [10, 0]), line([10, 0], [10, 10])],
    color: rgb(255, 255, 255),
    cellX: 0, cellY: 0, cellWidth: 40, cellHeight: 40,
    tileMode: 'repeat', tileWidthL0: 10, tileHeightL0: 10,
    ...extras,
  };
}

function makeState(svgs: SVGObject[]): CompositionState {
  return {
    id: 'test', name: 'test', figures: [], svgObjects: svgs, images: [], imageBlobs: {},
    lineDraft: null, arcDraft: null, paintStroke: null, editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: rgb(255, 255, 255), customColors: [], groups: [], sceneOrder: svgs.map(s => s.id),
    gridLevel: 2, strokeScale: 1, gridIntensity: 0.3, camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(1024, 768), selectedFigureIds: new Set(), activeFigureKey: null,
    compTool: 'color', createRegion: null, renderGeneration: 0,
  } as CompositionState;
}

function draftWithTilePaint(svgId: string, painted: Map<number, RGBColor>): PaintStrokeDraft {
  return {
    brushColor: rgb(0, 0, 0), blendMode: 'normal', opacity: 1,
    paintedSegments: new Map(), paintedFigures: new Map(), paintedFills: new Map(),
    svgSnapshots: new Map(), figureSnapshots: new Map(),
    paintedTileSegments: new Map([[svgId, painted]]),
  };
}

describe('paintTileSegments op (apply / revert)', () => {
  it('applies sparse overrides and reverts to nothing', () => {
    const state = makeState([tiledSquare()]);
    const ops = buildPaintStrokeOps(state, draftWithTilePaint('svg1', new Map([
      [packKey(0, 0, 0)!, RED],
      [packKey(2, 1, 1)!, BLUE],
    ])));
    expect(ops).toHaveLength(1);
    expect(ops[0].op).toBe('paintTileSegments');

    const applied = applyCompOps(state, ops);
    const ov = applied.svgObjects[0].segmentOverrides!;
    expect(ov.size).toBe(2);
    expect(ov.get(packKey(0, 0, 0)!)).toEqual(RED);
    expect(ov.get(packKey(2, 1, 1)!)).toEqual(BLUE);

    const reverted = revertCompOps(applied, ops);
    expect(reverted.svgObjects[0].segmentOverrides).toBeUndefined();
  });

  it('merges with existing overrides and restores prior on revert', () => {
    const start = makeState([tiledSquare({
      segmentOverrides: new Map([[packKey(0, 0, 0)!, RED]]),
    })]);
    // Repaint (0,0,0) BLUE and add (1,1,0) RED.
    const ops = buildPaintStrokeOps(start, draftWithTilePaint('svg1', new Map([
      [packKey(0, 0, 0)!, BLUE],
      [packKey(1, 1, 0)!, RED],
    ])));
    const applied = applyCompOps(start, ops);
    const ov = applied.svgObjects[0].segmentOverrides!;
    expect(ov.get(packKey(0, 0, 0)!)).toEqual(BLUE);
    expect(ov.get(packKey(1, 1, 0)!)).toEqual(RED);

    const reverted = revertCompOps(applied, ops);
    const rov = reverted.svgObjects[0].segmentOverrides!;
    expect(rov.size).toBe(1);
    expect(rov.get(packKey(0, 0, 0)!)).toEqual(RED); // back to the pre-stroke color
  });

  it('emits no op when repainting a segment its existing color', () => {
    const start = makeState([tiledSquare({ segmentOverrides: new Map([[packKey(0, 0, 0)!, RED]]) })]);
    const ops = buildPaintStrokeOps(start, draftWithTilePaint('svg1', new Map([[packKey(0, 0, 0)!, RED]])));
    expect(ops).toHaveLength(0);
  });

  it('skips locked objects', () => {
    const start = makeState([tiledSquare({ locked: true })]);
    const ops = buildPaintStrokeOps(start, draftWithTilePaint('svg1', new Map([[packKey(0, 0, 0)!, RED]])));
    expect(ops).toHaveLength(0);
  });
});

describe('transform re-keying through the reducers', () => {
  it('rotateSVG90CW 4× returns overrides to their original keys', () => {
    const ov = new Map<number, RGBColor>([
      [packKey(0, 0, 0)!, RED],
      [packKey(2, 1, 1)!, BLUE],
    ]);
    let obj = tiledSquare({ segmentOverrides: ov });
    for (let i = 0; i < 4; i++) obj = rotateSVG90CW(obj);
    const out = obj.segmentOverrides!;
    expect(out.size).toBe(2);
    expect(out.get(packKey(0, 0, 0)!)).toEqual(RED);
    expect(out.get(packKey(2, 1, 1)!)).toEqual(BLUE);
  });

  it('mirror twice on the same axis is identity for overrides', () => {
    const ov = new Map<number, RGBColor>([[packKey(1, 2, 0)!, RED]]);
    let obj = tiledSquare({ segmentOverrides: ov });
    obj = mirrorSVG(obj, 'h');
    obj = mirrorSVG(obj, 'h');
    expect(obj.segmentOverrides!.get(packKey(1, 2, 0)!)).toEqual(RED);
    expect(countPaintedInstances(obj.segmentOverrides)).toBe(1);
  });

  it('a single rotation moves a painted copy to a different key but keeps the count + segment index', () => {
    const ov = new Map<number, RGBColor>([[packKey(0, 0, 3)!, RED]]);
    const rotated = rotateSVG90CW(tiledSquare({ segmentOverrides: ov }));
    const keys = [...rotated.segmentOverrides!.keys()];
    expect(keys).toHaveLength(1);
    expect(unpackKey(keys[0]).segIdx).toBe(3); // segment index preserved
    expect(rotated.segmentOverrides!.get(keys[0])).toEqual(RED);
  });
});

describe('buildExpandedTileSVGObjectContent (export / overlay)', () => {
  it('emits one <g> per visible copy with the override color applied to only that copy', () => {
    // 2×1 region (tile 10×10, region 20×10) → copies col 0 and col 1.
    const obj = tiledSquare({
      cellWidth: 20, cellHeight: 10,
      segmentOverrides: new Map([[packKey(1, 0, 0)!, RED]]), // paint copy (1,0) segment 0
    });
    const out = buildExpandedTileSVGObjectContent(obj, 1);
    const groups = out.match(/<g[ >]/g) ?? [];
    expect(groups.length).toBe(2);
    // The painted copy carries red; the base color (white) still appears for
    // the unpainted segment / copy.
    expect(out).toContain('stroke="rgb(255,0,0)"');
    expect(out).toContain('stroke="rgb(255,255,255)"');
    // Copy col 1 is translated by one tile width in SVG units.
    expect(out).toContain('translate(');
  });

  it('returns empty for an object with no geometry', () => {
    expect(buildExpandedTileSVGObjectContent({ ...tiledSquare(), segments: [] }, 1)).toBe('');
  });

  it('onlyPainted emits a <g> for painted copies only (overlay mode)', () => {
    // 4×4 region, paint one copy. onlyPainted → exactly one group.
    const obj = tiledSquare({ segmentOverrides: new Map([[packKey(2, 1, 0)!, RED]]) });
    const out = buildExpandedTileSVGObjectContent(obj, 1, { onlyPainted: true });
    expect((out.match(/<g[ >]/g) ?? []).length).toBe(1);
    expect(out).toContain('stroke="rgb(255,0,0)"');
  });

  it('onlyPainted with no overrides emits nothing', () => {
    expect(buildExpandedTileSVGObjectContent(tiledSquare(), 1, { onlyPainted: true })).toBe('');
  });

  it('opaqueBg draws a full tile-sized backing rect per emitted copy (seam fix)', () => {
    const obj = tiledSquare({ segmentOverrides: new Map([[packKey(0, 0, 0)!, RED]]) });
    const out = buildExpandedTileSVGObjectContent(obj, 1, { onlyPainted: true, opaqueBg: 'rgb(1,2,3)' });
    expect(out).toContain('<rect');
    expect(out).toContain('fill="rgb(1,2,3)"');
  });

  it('places a painted copy at its absolute world position (anchor + col·tile)', () => {
    // u = SVG_UNITS_PER_L0_CELL = 256. Pattern not at origin: cellX=3,cellY=5,
    // tile 10 → anchor (3,5). Painting copy (col 0,row 0) → world top-left
    // (3,5)·256 = translate(768,1280). A regression that drops the anchor term
    // would render the copy at translate(0,0) (off the region viewBox).
    const obj = tiledSquare({
      cellX: 3, cellY: 5, cellWidth: 20, cellHeight: 20, tileWidthL0: 10, tileHeightL0: 10,
      segmentOverrides: new Map([[packKey(0, 0, 0)!, RED]]),
    });
    const out = buildExpandedTileSVGObjectContent(obj, 1, { onlyPainted: true });
    expect(out).toContain('translate(768,1280)');
  });

  it('places copy (col 1) one tile-width right of the anchor', () => {
    const obj = tiledSquare({
      cellX: 3, cellY: 5, cellWidth: 20, cellHeight: 20, tileWidthL0: 10, tileHeightL0: 10,
      segmentOverrides: new Map([[packKey(1, 0, 0)!, RED]]),
    });
    const out = buildExpandedTileSVGObjectContent(obj, 1, { onlyPainted: true });
    // (anchorX + 1·10)·256 = 13·256 = 3328 ; anchorY·256 = 1280
    expect(out).toContain('translate(3328,1280)');
  });
});

describe('duplicate deep-copies overrides', () => {
  it('painting the duplicate does not bleed into the original map', () => {
    const adapter = SCENE_ADAPTERS.find((a: any) => a.kind === 'svg')!;
    const original = tiledSquare({ segmentOverrides: new Map([[packKey(0, 0, 0)!, RED]]) });
    const dup = adapter.cloneItem(adapter.cloneWithOffset(original, 1, 1, 'svg2', undefined)) as SVGObject;
    expect(dup.segmentOverrides).not.toBe(original.segmentOverrides);
    dup.segmentOverrides!.set(packKey(3, 3, 0)!, BLUE);
    expect(original.segmentOverrides!.size).toBe(1);
  });
});
