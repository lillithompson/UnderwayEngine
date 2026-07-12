import { bakeFigureToSegments, transformSegmentAroundCenter, figureToTiledSVGObject } from '../figureToPaths';
import { CompositionFigure, PathSegment } from '../types';
import * as cache from '../svgFigureCache';

// Mock the SVG figure cache
jest.mock('../svgFigureCache', () => ({
  getFigureSVGSync: jest.fn(),
}));

const mockGetSync = cache.getFigureSVGSync as jest.Mock;

function makeFig(overrides?: Partial<CompositionFigure>): CompositionFigure {
  return {
    id: 'fig1',
    figureKey: 'test',
    cellX: 0, cellY: 0,
    cellWidth: 2, cellHeight: 2,
    resolutionX: 2, resolutionY: 2,
    ...overrides,
  };
}

describe('bakeFigureToSegments', () => {
  afterEach(() => mockGetSync.mockReset());

  test('returns null when SVG is not cached', () => {
    mockGetSync.mockReturnValue(null);
    expect(bakeFigureToSegments(makeFig())).toBeNull();
  });

  test('converts <rect> to 4 line segments', () => {
    mockGetSync.mockReturnValue({
      elements: ['<rect x="0" y="0" width="512" height="512" fill="red"/>'],
      svgWidth: 512,
      svgHeight: 512,
    });
    const fig = makeFig({ cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2 });
    const segs = bakeFigureToSegments(fig);
    expect(segs).not.toBeNull();
    expect(segs!.length).toBe(4);
    expect(segs![0]).toEqual({ kind: 'line', start: [0, 0], end: [2, 0] });
    expect(segs![1]).toEqual({ kind: 'line', start: [2, 0], end: [2, 2] });
    expect(segs![2]).toEqual({ kind: 'line', start: [2, 2], end: [0, 2] });
    expect(segs![3]).toEqual({ kind: 'line', start: [0, 2], end: [0, 0] });
  });

  test('converts <path d="M...L..."> to line segments', () => {
    mockGetSync.mockReturnValue({
      elements: ['<path d="M 0,0 L 256,0 L 256,256" fill="none" stroke="white"/>'],
      svgWidth: 256,
      svgHeight: 256,
    });
    const fig = makeFig({ cellX: 1, cellY: 1, cellWidth: 1, cellHeight: 1 });
    const segs = bakeFigureToSegments(fig);
    expect(segs).not.toBeNull();
    expect(segs!.length).toBe(2);
    expect(segs![0]).toEqual({ kind: 'line', start: [1, 1], end: [2, 1] });
    expect(segs![1]).toEqual({ kind: 'line', start: [2, 1], end: [2, 2] });
  });

  test('handles Z (closepath) command', () => {
    mockGetSync.mockReturnValue({
      elements: ['<path d="M 0,0 L 256,0 L 256,256 Z"/>'],
      svgWidth: 256,
      svgHeight: 256,
    });
    const fig = makeFig({ cellX: 0, cellY: 0, cellWidth: 1, cellHeight: 1 });
    const segs = bakeFigureToSegments(fig);
    expect(segs!.length).toBe(3);
    expect(segs![2]).toEqual({ kind: 'line', start: [1, 1], end: [0, 0] });
  });

  test('handles H and V commands', () => {
    mockGetSync.mockReturnValue({
      elements: ['<path d="M 0,0 H 256 V 256"/>'],
      svgWidth: 256,
      svgHeight: 256,
    });
    const fig = makeFig({ cellX: 0, cellY: 0, cellWidth: 1, cellHeight: 1 });
    const segs = bakeFigureToSegments(fig);
    expect(segs!.length).toBe(2);
    expect(segs![0]).toEqual({ kind: 'line', start: [0, 0], end: [1, 0] });
    expect(segs![1]).toEqual({ kind: 'line', start: [1, 0], end: [1, 1] });
  });

  test('applies element transform attribute', () => {
    // A path at (0,0)→(256,0) translated by (0, 256) in SVG units
    mockGetSync.mockReturnValue({
      elements: ['<path id="t" transform="translate(0,256)" d="M 0,0 L 256,0"/>'],
      svgWidth: 256,
      svgHeight: 256,
    });
    const fig = makeFig({ cellX: 0, cellY: 0, cellWidth: 1, cellHeight: 1 });
    const segs = bakeFigureToSegments(fig);
    expect(segs!.length).toBe(1);
    // After translate(0,256): points become (0,256)→(256,256)
    // After L0 mapping (÷256): (0,1)→(1,1)
    expect(segs![0]).toEqual({ kind: 'line', start: [0, 1], end: [1, 1] });
  });

  test('applies scale transform', () => {
    mockGetSync.mockReturnValue({
      elements: ['<path id="s" transform="translate(0,0) scale(0.5)" d="M 0,0 L 256,256"/>'],
      svgWidth: 256,
      svgHeight: 256,
    });
    const fig = makeFig({ cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2 });
    const segs = bakeFigureToSegments(fig);
    expect(segs!.length).toBe(1);
    // scale(0.5): (256,256)→(128,128). Then L0: (128/256)*2=1
    expect(segs![0]).toEqual({ kind: 'line', start: [0, 0], end: [1, 1] });
  });

  test('maps coordinates through figure placement transform', () => {
    mockGetSync.mockReturnValue({
      elements: ['<path d="M 0,0 L 128,128"/>'],
      svgWidth: 256,
      svgHeight: 256,
    });
    const fig = makeFig({ cellX: 4, cellY: 6, cellWidth: 2, cellHeight: 2 });
    const segs = bakeFigureToSegments(fig);
    expect(segs!.length).toBe(1);
    expect(segs![0]).toEqual({ kind: 'line', start: [4, 6], end: [5, 7] });
  });

  test('handles multiple elements', () => {
    mockGetSync.mockReturnValue({
      elements: [
        '<rect x="0" y="0" width="128" height="128" fill="red"/>',
        '<path d="M 128,128 L 256,256"/>',
      ],
      svgWidth: 256,
      svgHeight: 256,
    });
    const fig = makeFig({ cellX: 0, cellY: 0, cellWidth: 1, cellHeight: 1 });
    const segs = bakeFigureToSegments(fig);
    // 4 rect segments + 1 path segment
    expect(segs!.length).toBe(5);
  });

  // ── Figure-level rotation/mirror baking ─────────────────────────────
  // These cover the join bug: a rotated/mirrored figure's segments must
  // be baked at the same orientation buildFigureSVGContent draws, otherwise
  // joining the figure with arcs produces an un-rotated/un-mirrored shape.

  test('rotation 90 rotates the figure 90° CW around its center', () => {
    // Top edge of a 2×2 cell, fig at (0,0)..(2,2), center (1,1).
    mockGetSync.mockReturnValue({
      elements: ['<path d="M 0,0 L 256,0"/>'],
      svgWidth: 256,
      svgHeight: 256,
    });
    const fig = makeFig({ cellWidth: 2, cellHeight: 2, rotation: 90 });
    const segs = bakeFigureToSegments(fig)!;
    expect(segs.length).toBe(1);
    // Top edge → right edge after 90° CW around (1,1).
    expect(segs[0].start[0]).toBeCloseTo(2);
    expect(segs[0].start[1]).toBeCloseTo(0);
    expect(segs[0].end[0]).toBeCloseTo(2);
    expect(segs[0].end[1]).toBeCloseTo(2);
  });

  test('rotation 180 rotates the figure 180° around its center', () => {
    mockGetSync.mockReturnValue({
      elements: ['<path d="M 0,0 L 256,0"/>'],
      svgWidth: 256,
      svgHeight: 256,
    });
    const fig = makeFig({ cellWidth: 2, cellHeight: 2, rotation: 180 });
    const segs = bakeFigureToSegments(fig)!;
    // Top edge → bottom edge (reversed) after 180° around (1,1).
    expect(segs[0].start[0]).toBeCloseTo(2);
    expect(segs[0].start[1]).toBeCloseTo(2);
    expect(segs[0].end[0]).toBeCloseTo(0);
    expect(segs[0].end[1]).toBeCloseTo(2);
  });

  test('rotation 270 rotates the figure 90° CCW around its center', () => {
    mockGetSync.mockReturnValue({
      elements: ['<path d="M 0,0 L 256,0"/>'],
      svgWidth: 256,
      svgHeight: 256,
    });
    const fig = makeFig({ cellWidth: 2, cellHeight: 2, rotation: 270 });
    const segs = bakeFigureToSegments(fig)!;
    // Top edge → left edge after 270° CW (= 90° CCW) around (1,1).
    expect(segs[0].start[0]).toBeCloseTo(0);
    expect(segs[0].start[1]).toBeCloseTo(2);
    expect(segs[0].end[0]).toBeCloseTo(0);
    expect(segs[0].end[1]).toBeCloseTo(0);
  });

  test('mirrorH reflects the figure across its vertical center axis', () => {
    mockGetSync.mockReturnValue({
      elements: ['<path d="M 0,0 L 128,128"/>'],
      svgWidth: 256,
      svgHeight: 256,
    });
    const fig = makeFig({ cellWidth: 2, cellHeight: 2, mirrorH: true });
    const segs = bakeFigureToSegments(fig)!;
    // Diagonal (0,0)→(1,1) flipped horizontally about x=1 → (2,0)→(1,1).
    expect(segs[0].start[0]).toBeCloseTo(2);
    expect(segs[0].start[1]).toBeCloseTo(0);
    expect(segs[0].end[0]).toBeCloseTo(1);
    expect(segs[0].end[1]).toBeCloseTo(1);
  });

  test('mirrorV reflects the figure across its horizontal center axis', () => {
    mockGetSync.mockReturnValue({
      elements: ['<path d="M 0,0 L 128,128"/>'],
      svgWidth: 256,
      svgHeight: 256,
    });
    const fig = makeFig({ cellWidth: 2, cellHeight: 2, mirrorV: true });
    const segs = bakeFigureToSegments(fig)!;
    // Diagonal (0,0)→(1,1) flipped vertically about y=1 → (0,2)→(1,1).
    expect(segs[0].start[0]).toBeCloseTo(0);
    expect(segs[0].start[1]).toBeCloseTo(2);
    expect(segs[0].end[0]).toBeCloseTo(1);
    expect(segs[0].end[1]).toBeCloseTo(1);
  });

  test('rotation + mirrorH compose like buildFigureSVGContent (mirror then rotate)', () => {
    // The original join bug: rotated AND mirrored figure baked as identity.
    // Verify the composed transform takes (0,0) where the SVG render does.
    mockGetSync.mockReturnValue({
      elements: ['<path d="M 0,0 L 256,0"/>'],
      svgWidth: 256,
      svgHeight: 256,
    });
    const fig = makeFig({ cellWidth: 2, cellHeight: 2, rotation: 90, mirrorH: true });
    const segs = bakeFigureToSegments(fig)!;
    // (0,0) → mirrorH about x=1 → (2,0) → rotate 90 CW about (1,1) → (2,2).
    expect(segs[0].start[0]).toBeCloseTo(2);
    expect(segs[0].start[1]).toBeCloseTo(2);
    // (2,0) → mirrorH about x=1 → (0,0) → rotate 90 CW about (1,1) → (2,0).
    expect(segs[0].end[0]).toBeCloseTo(2);
    expect(segs[0].end[1]).toBeCloseTo(0);
  });

  test('rotation 90 swaps non-square content size correctly', () => {
    // 2×1 figure (svg 512×256) rotated 90° CW becomes a 1×2 bounding box.
    // Reducer stores cellWidth=1, cellHeight=2 (post-rotation BB).
    mockGetSync.mockReturnValue({
      elements: ['<path d="M 0,0 L 512,0"/>'], // top edge of original 2×1
      svgWidth: 512,
      svgHeight: 256,
    });
    const fig = makeFig({
      cellX: 0, cellY: 0, cellWidth: 1, cellHeight: 2, rotation: 90,
    });
    const segs = bakeFigureToSegments(fig)!;
    // Original top edge (0,0)→(2,0) (in unrotated L0) rotated 90 CW about
    // figure center (0.5, 1) → right edge of the 1×2 BB.
    expect(segs[0].start[0]).toBeCloseTo(1);
    expect(segs[0].start[1]).toBeCloseTo(0);
    expect(segs[0].end[0]).toBeCloseTo(1);
    expect(segs[0].end[1]).toBeCloseTo(2);
  });

  test('arc center transforms with rotation', () => {
    // Quarter-arc in the top-left quadrant, rotated 90 CW.
    mockGetSync.mockReturnValue({
      elements: ['<path d="M 0,128 Q 0,0 128,0"/>'],
      svgWidth: 256,
      svgHeight: 256,
    });
    const fig = makeFig({ cellWidth: 2, cellHeight: 2, rotation: 90 });
    const segs = bakeFigureToSegments(fig)!;
    expect(segs.length).toBe(1);
    expect(segs[0].kind).toBe('arc');
    if (segs[0].kind !== 'arc') return;
    // (0, 1) rotated 90 CW about (1,1) → (1, 0)
    expect(segs[0].start[0]).toBeCloseTo(1);
    expect(segs[0].start[1]).toBeCloseTo(0);
    // True quarter-circle center = start + end − corner = (1,1), which is
    // the rotation pivot here, so it stays (1,1). (The pre-fix code stored
    // the control corner (0,0) as the center, bowing the arc the wrong way.)
    expect(segs[0].center[0]).toBeCloseTo(1);
    expect(segs[0].center[1]).toBeCloseTo(1);
    // (1, 0) → (2, 1)
    expect(segs[0].end[0]).toBeCloseTo(2);
    expect(segs[0].end[1]).toBeCloseTo(1);
  });
});

describe('transformSegmentAroundCenter', () => {
  const line = (s: [number, number], e: [number, number]): PathSegment =>
    ({ kind: 'line', start: s, end: e });
  const arc = (s: [number, number], e: [number, number], c: [number, number]): PathSegment =>
    ({ kind: 'arc', start: s, end: e, center: c });

  test('identity (no rotation, no mirror) is a no-op modulo cloning', () => {
    const seg = line([1, 2], [3, 4]);
    const out = transformSegmentAroundCenter(seg, 0, 0, 0, false, false);
    expect(out).toEqual(seg);
  });

  test('rotates a line 90 CW around the given center', () => {
    const seg = line([0, 0], [2, 0]);
    const out = transformSegmentAroundCenter(seg, 1, 1, 90, false, false);
    expect(out.kind).toBe('line');
    if (out.kind !== 'line') return;
    expect(out.start[0]).toBeCloseTo(2); expect(out.start[1]).toBeCloseTo(0);
    expect(out.end[0]).toBeCloseTo(2);   expect(out.end[1]).toBeCloseTo(2);
  });

  test('mirrorV before rotation matches SVG transform composition', () => {
    // SVG transform list "translate(cx,cy) rotate(90) scale(1,-1) translate(-cx,-cy)"
    // applies, for a child point p, in right-to-left order:
    //   p → translate(-cx,-cy) → scale(1,-1) → rotate(90) → translate(cx,cy)
    // i.e. mirrorV first, then rotate.
    const seg = line([0, 0], [2, 0]);
    const out = transformSegmentAroundCenter(seg, 1, 1, 90, false, true);
    if (out.kind !== 'line') throw new Error('expected line');
    // (0,0) → mirrorV about y=1 → (0,2) → rot90CW about (1,1) → (0,0).
    expect(out.start[0]).toBeCloseTo(0);
    expect(out.start[1]).toBeCloseTo(0);
    // (2,0) → (2,2) → (0,2).
    expect(out.end[0]).toBeCloseTo(0);
    expect(out.end[1]).toBeCloseTo(2);
  });

  test('preserves arc center under rotation', () => {
    const seg = arc([0, 0], [1, 1], [0, 1]);
    const out = transformSegmentAroundCenter(seg, 0, 0, 180, false, false);
    if (out.kind !== 'arc') throw new Error('expected arc');
    expect(out.start[0]).toBeCloseTo(0);  expect(out.start[1]).toBeCloseTo(0);
    expect(out.end[0]).toBeCloseTo(-1);   expect(out.end[1]).toBeCloseTo(-1);
    expect(out.center[0]).toBeCloseTo(0); expect(out.center[1]).toBeCloseTo(-1);
  });

  test('four 90° rotations return to the original', () => {
    const seg = line([3, 7], [5, 11]);
    let out = seg;
    for (let i = 0; i < 4; i++) {
      out = transformSegmentAroundCenter(out, 4, 9, 90, false, false);
    }
    if (out.kind !== 'line') throw new Error('expected line');
    expect(out.start[0]).toBeCloseTo(3); expect(out.start[1]).toBeCloseTo(7);
    expect(out.end[0]).toBeCloseTo(5);   expect(out.end[1]).toBeCloseTo(11);
  });
});

// ── Clip-boundary handling ──────────────────────────────────────────
// Segments are clipped to the figure's placement bounds.
// Lines are clipped via Liang-Barsky. Arcs are trimmed to the
// portion of the circle inside the bounds (same center, shorter arc).

describe('bakeFigureToSegments — clip-boundary clipping', () => {
  afterEach(() => mockGetSync.mockReset());

  test('preserves arc segments fully inside bounds', () => {
    mockGetSync.mockReturnValue({
      elements: ['<path d="M 0,128 Q 0,0 128,0" stroke="rgb(255,255,255)"/>'],
      svgWidth: 256,
      svgHeight: 256,
    });
    const fig = makeFig({ cellX: 0, cellY: 0, cellWidth: 1, cellHeight: 1 });
    const segs = bakeFigureToSegments(fig);
    expect(segs).not.toBeNull();
    expect(segs!.length).toBe(1);
    expect(segs![0].kind).toBe('arc');
  });

  test('drops arcs entirely outside figure bounds', () => {
    mockGetSync.mockReturnValue({
      elements: ['<circle cx="768" cy="768" r="64" fill="rgb(0,255,0)"/>'],
      svgWidth: 512,
      svgHeight: 512,
    });
    const fig = makeFig({ cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2 });
    const segs = bakeFigureToSegments(fig);
    expect(segs).not.toBeNull();
    expect(segs!.length).toBe(0);
  });

  test('clips overflow lines to figure bounds', () => {
    // Rect extends from (0,0) to (4,2) in L0 space.
    // Line segments are clipped to [0,0,2,2].
    mockGetSync.mockReturnValue({
      elements: ['<rect x="0" y="0" width="1024" height="512" fill="rgb(255,0,0)"/>'],
      svgWidth: 512,
      svgHeight: 512,
    });
    const fig = makeFig({ cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2 });
    const segs = bakeFigureToSegments(fig);
    expect(segs).not.toBeNull();
    // Top edge (0,0)→(4,0) is clipped to (0,0)→(2,0); right edge is fully
    // clipped. Bottom and left edges also clipped at x=2 boundary.
    for (const seg of segs!) {
      expect(seg.kind).toBe('line');
      if (seg.kind === 'line') {
        expect(seg.start[0]).toBeGreaterThanOrEqual(-0.01);
        expect(seg.start[0]).toBeLessThanOrEqual(2.01);
        expect(seg.end[0]).toBeGreaterThanOrEqual(-0.01);
        expect(seg.end[0]).toBeLessThanOrEqual(2.01);
      }
    }
  });

  test('trims arcs to the portion inside bounds (preserves curve)', () => {
    // Large arc that extends well beyond a small figure.
    // After clipping, the arc should be trimmed (still an arc, same center).
    mockGetSync.mockReturnValue({
      elements: ['<path d="M 0,-1024 C 0,107 917,1024 2048,1024" stroke="rgb(255,255,255)" stroke-width="5"/>'],
      svgWidth: 1024,
      svgHeight: 1024,
    });
    const fig = makeFig({ cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2 });
    const segs = bakeFigureToSegments(fig);
    expect(segs).not.toBeNull();
    if (!segs || segs.length === 0) return;
    // The result should be an arc (not converted to a line)
    const arc = segs.find(s => s.kind === 'arc');
    expect(arc).toBeDefined();
    if (!arc || arc.kind !== 'arc') return;
    // Its endpoints should be within (or very near) the figure bounds
    expect(arc.start[0]).toBeGreaterThanOrEqual(-0.1);
    expect(arc.start[1]).toBeGreaterThanOrEqual(-0.1);
    expect(arc.end[0]).toBeLessThanOrEqual(2.1);
    expect(arc.end[1]).toBeLessThanOrEqual(2.1);
  });

  test('preserves segments fully inside bounds', () => {
    mockGetSync.mockReturnValue({
      elements: ['<rect x="64" y="64" width="128" height="128" fill="rgb(0,0,255)"/>'],
      svgWidth: 512,
      svgHeight: 512,
    });
    const fig = makeFig({ cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2 });
    const segs = bakeFigureToSegments(fig);
    expect(segs).not.toBeNull();
    expect(segs!.length).toBe(4);
    expect(segs![0]).toEqual({ kind: 'line', start: [0.25, 0.25], end: [0.75, 0.25] });
  });
});

describe('figureToTiledSVGObject', () => {
  afterEach(() => mockGetSync.mockReset());

  const tiledFig = (overrides?: Partial<CompositionFigure>): CompositionFigure => ({
    id: 'figT', figureKey: 'k',
    cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 8,
    resolutionX: 2, resolutionY: 2,
    tileMode: 'repeat', tileWidthL0: 2, tileHeightL0: 2,
    ...overrides,
  });

  test('returns null for a non-tiled figure', () => {
    mockGetSync.mockReturnValue({ elements: ['<rect x="0" y="0" width="256" height="256"/>'], svgWidth: 256, svgHeight: 256 });
    expect(figureToTiledSVGObject(makeFig(), 'svg_x')).toBeNull();
  });

  test('returns null for a rotated/mirrored tiled figure (caller flat-expands)', () => {
    mockGetSync.mockReturnValue({ elements: ['<rect x="0" y="0" width="256" height="256"/>'], svgWidth: 256, svgHeight: 256 });
    expect(figureToTiledSVGObject(tiledFig({ rotation: 90 }), 'svg_x')).toBeNull();
    expect(figureToTiledSVGObject(tiledFig({ mirrorH: true }), 'svg_x')).toBeNull();
  });

  test('returns null when the figure SVG is not cached', () => {
    mockGetSync.mockReturnValue(null);
    expect(figureToTiledSVGObject(tiledFig(), 'svg_x')).toBeNull();
  });

  test('produces a tiled SVGObject with one tile of geometry + the tile grid', () => {
    // One 256-unit-square tile of line art → baked into a 2×2 L0 tile.
    mockGetSync.mockReturnValue({
      elements: ['<path d="M 0,0 L 256,0" fill="none" stroke="rgb(10,20,30)"/>'],
      svgWidth: 256, svgHeight: 256,
    });
    const obj = figureToTiledSVGObject(tiledFig(), 'svg_t')!;
    expect(obj).not.toBeNull();
    expect(obj.id).toBe('svg_t');
    expect(obj.tileMode).toBe('repeat');
    expect(obj.tileWidthL0).toBe(2);
    expect(obj.tileHeightL0).toBe(2);
    // Region bbox carried over from the figure.
    expect(obj.cellWidth).toBe(8);
    expect(obj.cellHeight).toBe(8);
    // One tile of geometry (not the whole 4×4-tile region).
    expect(obj.segments.length).toBe(1);
    expect(obj.color).toEqual({ r: 10, g: 20, b: 30 });
  });

  test('positions the tile at the grid anchor (cellX + tileOffset)', () => {
    mockGetSync.mockReturnValue({
      elements: ['<path d="M 0,0 L 256,0" fill="none" stroke="white"/>'],
      svgWidth: 256, svgHeight: 256,
    });
    // Offset shifts the anchor; the baked tile sits at the anchor so the
    // SVG-object tile renderer (minX = cellX + tileOffset) lines up.
    const obj = figureToTiledSVGObject(tiledFig({ cellX: 3, cellY: 5, tileOffsetXL0: 1, tileOffsetYL0: 1 }), 'svg_t')!;
    expect(obj.tileOffsetXL0).toBe(1);
    expect(obj.tileOffsetYL0).toBe(1);
    // anchor = cellX + offset = 4,6 → tile spans [4..6]×[6..8].
    expect(obj.segments[0]).toEqual({ kind: 'line', start: [4, 6], end: [6, 6] });
  });

  test('preserves multi-color geometry as subpaths', () => {
    mockGetSync.mockReturnValue({
      elements: [
        '<path d="M 0,0 L 256,0" fill="none" stroke="rgb(255,0,0)"/>',
        '<path d="M 0,128 L 256,128" fill="none" stroke="rgb(0,0,255)"/>',
      ],
      svgWidth: 256, svgHeight: 256,
    });
    const obj = figureToTiledSVGObject(tiledFig(), 'svg_t')!;
    expect(obj.subpaths).toBeDefined();
    expect(obj.subpaths!.length).toBe(2);
    expect(obj.subpaths!.map(s => s.color)).toEqual([{ r: 255, g: 0, b: 0 }, { r: 0, g: 0, b: 255 }]);
  });
});
