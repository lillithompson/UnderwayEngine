import { bakeFigureToSegments, transformSegmentAroundCenter, figureToTiledSVGObject } from '../figureToPaths';
import { CompositionFigure, PathSegment } from '../types';
import * as cache from '../svgFigureCache';
import { simplifySVG } from '../simplifySVG';

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

  test('reads relative commands as the absolute ones they stand for', () => {
    // A figure's paths come from simplifySVG, which writes absolute commands
    // only, and the bake's own reader skipped a relative one without moving
    // the pen; it reads path data with the engine's one reader now
    // (svgPathData.ts, report ed8ff7f1), which reads both.
    const bake = (d: string) => {
      mockGetSync.mockReturnValue({ elements: [`<path d="${d}"/>`], svgWidth: 256, svgHeight: 256 });
      return bakeFigureToSegments(makeFig({ cellX: 0, cellY: 0, cellWidth: 1, cellHeight: 1 }));
    };
    const absolute = bake('M 0,0 L 256,0 V 256 Q 128,256 128,128 A 64,64 0 0 1 0,128 Z');
    // The A is a half circle: two quarter arcs.
    expect(absolute!.map((s) => s.kind)).toEqual(['line', 'line', 'arc', 'arc', 'arc', 'line']);
    expect(bake('m 0,0 l 256,0 v 256 q -128,0 -128,-128 a 64,64 0 0 1 -128,0 z')).toEqual(absolute);
  });

  test('bakes path data that breaks the grammar up to its first error', () => {
    // Report 44c95c77: a command short of numbers took the next command
    // letter as a number and read on; SVG draws the path up to the error,
    // and so does the bake (svgPathData.ts).
    const bake = (d: string) => {
      mockGetSync.mockReturnValue({ elements: [`<path d="${d}"/>`], svgWidth: 256, svgHeight: 256 });
      return bakeFigureToSegments(makeFig({ cellX: 0, cellY: 0, cellWidth: 1, cellHeight: 1 }));
    };
    const good = bake('M 0,0 L 256,0 L 256,256');
    expect(good).toHaveLength(2);
    expect(bake('M 0,0 L 256,0 L 256,256 L 5')).toEqual(good);
    expect(bake('M 0,0 L 256,0 L 256,256 L 5 Z')).toEqual(good);
    expect(bake('M 0,0 L 256,0 L 256,256 Q 1,1 # 2,2')).toEqual(good);
    // The close is drawn; the number after it is the error.
    expect(bake('M 0,0 L 256,0 L 256,256 Z 7 8 L 0,256')).toEqual(bake('M 0,0 L 256,0 L 256,256 Z'));
    expect(bake('L 256,0 L 256,256')).toEqual([]);
  });

  describe('an arc (A)', () => {
    // Report bed5d6cd: an A was one start/end/centre segment, which the
    // engine draws as the minor arc about the circle through its ends, and a
    // negative radius made it a line. It is drawn from the engine's one arc
    // conversion now (svgArc.ts).
    const bake = (d: string) => {
      mockGetSync.mockReturnValue({ elements: [`<path d="${d}"/>`], svgWidth: 256, svgHeight: 256 });
      return bakeFigureToSegments(makeFig({ cellX: 0, cellY: 0, cellWidth: 1, cellHeight: 1 }))!;
    };
    const near = (p: readonly number[], q: readonly number[]) => {
      expect(p[0]).toBeCloseTo(q[0], 9);
      expect(p[1]).toBeCloseTo(q[1], 9);
    };

    test('a large arc goes the long way round, in quarter arcs about its centre', () => {
      // Three quarters of the circle of radius 64 about (128, 128).
      const segs = bake('M 192,128 A 64,64 0 1 1 128,64');
      expect(segs.map((s) => s.kind)).toEqual(['arc', 'arc', 'arc']);
      const ends = [[0.75, 0.5], [0.5, 0.75], [0.25, 0.5], [0.5, 0.25]];
      segs.forEach((s, i) => {
        if (s.kind !== 'arc') throw new Error('expected arc');
        near(s.start, ends[i]);
        near(s.end, ends[i + 1]);
        near(s.center, [0.5, 0.5]);
      });
    });

    test('a small arc is one quarter arc, the way its sweep flag says', () => {
      const cw = bake('M 192,128 A 64,64 0 0 1 128,192');
      expect(cw).toHaveLength(1);
      if (cw[0].kind !== 'arc') throw new Error('expected arc');
      near(cw[0].center, [0.5, 0.5]);
      // The other sweep is the other circle through the same two points.
      const ccw = bake('M 192,128 A 64,64 0 0 0 128,192');
      if (ccw[0].kind !== 'arc') throw new Error('expected arc');
      near(ccw[0].center, [0.75, 0.75]);
    });

    test('an elliptical arc is lines on its ellipse, as the engine draws every ellipse', () => {
      // Half the ellipse of radii 64 and 32 about (128, 128), over its top.
      const segs = bake('M 64,128 A 64,32 0 0 1 192,128');
      expect(segs).toHaveLength(16); // 32 to a whole turn
      expect(segs.every((s) => s.kind === 'line')).toBe(true);
      near(segs[0].start, [0.25, 0.5]);
      near(segs[15].end, [0.75, 0.5]);
      near(segs[7].end, [0.5, 0.375]);
      for (let i = 0; i < segs.length; i++) {
        const [x, y] = segs[i].end;
        expect(((x - 0.5) / 0.25) ** 2 + ((y - 0.5) / 0.125) ** 2).toBeCloseTo(1, 9);
        if (i > 0) expect(segs[i].start).toEqual(segs[i - 1].end);
      }
    });

    test('a negative radius is read as its positive, as the spec has it, not as a line', () => {
      const positive = bake('M 192,128 A 64,64 0 0 1 128,192');
      expect(positive.map((s) => s.kind)).toEqual(['arc']);
      expect(bake('M 192,128 A -64,-64 0 0 1 128,192')).toEqual(positive);
    });

    test('an arc with no curve to it is the line to its end', () => {
      expect(bake('M 0,0 A 0,64 0 0 1 128,128')).toEqual([{ kind: 'line', start: [0, 0], end: [0.5, 0.5] }]);
    });
  });

  describe('a cubic (C)', () => {
    // Report b452acb8: every cubic was baked as a circular arc about where
    // its end normals meet. simplifySVG writes an arc as cubics (report
    // 7f84afc7), so an elliptical arc reached the bake as cubics whose ends
    // are not one distance from that centre, an arc segment drawn broken.
    const bake = (d: string) => {
      mockGetSync.mockReturnValue({ elements: [`<path d="${d}"/>`], svgWidth: 256, svgHeight: 256 });
      return bakeFigureToSegments(makeFig({ cellX: 0, cellY: 0, cellWidth: 1, cellHeight: 1 }))!;
    };
    /** The path's d as simplifySVG writes it. */
    const simplified = (d: string) => simplifySVG([`<path d="${d}"/>`])[0].match(/ d="([^"]*)"/)![1];

    test("a circle's quarter, as simplifySVG writes it, is still one arc about its centre", () => {
      const d = simplified('M 64,128 A 64,64 0 0 1 128,64');
      expect(d).toContain('C');
      const segs = bake(d);
      expect(segs).toHaveLength(1);
      if (segs[0].kind !== 'arc') throw new Error('expected arc');
      expect(segs[0].center[0]).toBeCloseTo(0.5, 6);
      expect(segs[0].center[1]).toBeCloseTo(0.5, 6);
    });

    test("an ellipse's quarter, as simplifySVG writes it, is lines on its ellipse, as its A is", () => {
      // The quarter of the ellipse of radii 64 and 32 about (128, 128) from
      // its left to its top.
      const d = simplified('M 64,128 A 64,32 0 0 1 128,96');
      expect(d).toContain('C');
      const segs = bake(d);
      expect(segs).toHaveLength(8); // 32 to a whole turn, as the A bakes
      expect(segs.every((s) => s.kind === 'line')).toBe(true);
      expect(segs[0].start).toEqual([0.25, 0.5]);
      expect(segs[7].end).toEqual([0.5, 0.375]);
      for (let i = 0; i < segs.length; i++) {
        const [x, y] = segs[i].end;
        // On the ellipse to within the cubic's own approximation of it.
        expect(Math.abs(((x - 0.5) / 0.25) ** 2 + ((y - 0.5) / 0.125) ** 2 - 1)).toBeLessThan(2e-3);
        if (i > 0) expect(segs[i].start).toEqual(segs[i - 1].end);
      }
      expect(bake('M 64,128 A 64,32 0 0 1 128,96')).toHaveLength(8);
    });
  });

  test("reads an arc's flags run on into its end point, as a minifier writes them", () => {
    // Report 1f5ff91e: `01-128 0` is the flags 0 and 1 and then -128 0.
    const bake = (d: string) => {
      mockGetSync.mockReturnValue({ elements: [`<path d="${d}"/>`], svgWidth: 256, svgHeight: 256 });
      return bakeFigureToSegments(makeFig({ cellX: 0, cellY: 0, cellWidth: 1, cellHeight: 1 }));
    };
    expect(bake('M128 128a64 64 0 01-128 0')).toEqual(bake('M128 128 a64 64 0 0 1 -128 0'));
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
