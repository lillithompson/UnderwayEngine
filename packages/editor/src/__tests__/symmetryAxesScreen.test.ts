import { makeViewport } from '@/engine/types';
import {
  AXIS_COLOR, AXIS_STROKE_PX, AxisGroupElement, AxisLineElement, AxisSegment, DIAG_COLOR, QUARTER_COLOR,
  symmetryAxisSegments, writeSymmetryAxes,
} from '../symmetryAxesScreen';
import { BASE_CELL_PX } from '../cameraMath';
import type { SymmetryOverlayModel } from '../canvasSymmetry';
import { HAIRLINE_PX } from '../selectionOutline';

// The mirror axes drawn in screen space (see the module header for why
// they left the world layer): world cells → screen px through the world
// transform, clipped to the view, dashes phased to the grid.

const VIEW = makeViewport(400, 800);
/** World px = cells × 16; screen = translate + world px × scale. */
const T = { translateX: 40, translateY: 100, scale: 0.5 };
const px = (cells: number) => cells * BASE_CELL_PX * T.scale;

function model(over: Partial<SymmetryOverlayModel> = {}): SymmetryOverlayModel {
  return {
    frame: { cellX: 4, cellY: 6, cellWidth: 8, cellHeight: 10 },
    lines: [], diag1: false, diag2: false, dashPeriod: 0.5, bounded: false,
    ...over,
  };
}

describe('symmetryAxisSegments', () => {
  test('a solid vertical center axis spans the whole view at the axis x', () => {
    const [s] = symmetryAxisSegments(model({ lines: [{ kind: 'v', at: 8, dashed: false }] }), T, VIEW);
    expect(s).toEqual({ x1: 40 + px(8), y1: 0, x2: 40 + px(8), y2: 800, color: AXIS_COLOR, dash: null, dashOffset: 0 });
  });

  test('a horizontal axis spans the view width; a quarter line keeps to the frame and is dimmer', () => {
    const segs = symmetryAxisSegments(model({ lines: [
      { kind: 'h', at: 11, dashed: false },
      { kind: 'h', at: 8.5, dashed: false, quarter: true },
    ] }), T, VIEW);
    expect(segs[0]).toMatchObject({ x1: 0, x2: 400, y1: 100 + px(11), color: AXIS_COLOR });
    expect(segs[1]).toMatchObject({ x1: 40 + px(4), x2: 40 + px(12), y1: 100 + px(8.5), color: QUARTER_COLOR });
  });

  test('dashed axes carry the world dash period in screen px, phased from the world origin', () => {
    const [v, h] = symmetryAxisSegments(model({ lines: [
      { kind: 'v', at: 8, dashed: true },
      { kind: 'h', at: 3, dashed: true, quarter: true },
    ] }), T, VIEW);
    const period = 0.5 * BASE_CELL_PX * T.scale; // 4 px
    expect(v.dash).toBe(period);
    // The vertical axis starts at screen y = 0, which is 100 px above the
    // world's y = 0: the pattern is 100 px "before" the origin, mod 4 → 0.
    expect(v.dashOffset).toBe(0);
    // The quarter line starts at the frame's left edge, world x = 4 → 32 px
    // past the origin, mod 4 → 0; move the frame by a half cell and it phases.
    expect(h.dashOffset).toBe(0);
    const [h2] = symmetryAxisSegments(model({
      frame: { cellX: 4.25, cellY: 6, cellWidth: 8, cellHeight: 10 },
      lines: [{ kind: 'h', at: 3, dashed: true, quarter: true }],
    }), T, VIEW);
    expect(h2.dashOffset).toBeCloseTo(px(4.25) % period, 9);
  });

  test('axes that miss the view are dropped', () => {
    const segs = symmetryAxisSegments(model({ lines: [
      { kind: 'v', at: -100, dashed: false },
      { kind: 'h', at: 500, dashed: false },
      { kind: 'v', at: 8, dashed: false },
    ] }), T, VIEW);
    expect(segs).toHaveLength(1);
  });

  test('diagonals run through the frame center at ±45°, clipped to the view, always dashed', () => {
    const segs = symmetryAxisSegments(model({ diag1: true, diag2: true }), T, VIEW);
    expect(segs).toHaveLength(2);
    const cx = 40 + px(8);
    const cy = 100 + px(11);
    for (const s of segs) {
      expect(s.color).toBe(DIAG_COLOR);
      expect(s.dash).toBeCloseTo(0.5 * BASE_CELL_PX * T.scale * Math.SQRT2, 9);
      // ±45°: |dy| = |dx|, and the center lies on the line.
      expect(Math.abs(s.y2 - s.y1)).toBeCloseTo(Math.abs(s.x2 - s.x1), 9);
      const slope = (s.y2 - s.y1) / (s.x2 - s.x1);
      expect(cy).toBeCloseTo(s.y1 + slope * (cx - s.x1), 9);
      // Inside the view.
      for (const v of [s.x1, s.x2]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(400); }
      for (const v of [s.y1, s.y2]) { expect(v).toBeGreaterThanOrEqual(-1e-9); expect(v).toBeLessThanOrEqual(800 + 1e-9); }
    }
    expect(segs[0].y2 > segs[0].y1).toBe(true);  // diag1 descends to the right
    expect(segs[1].y2 < segs[1].y1).toBe(true);  // diag2 rises to the right
  });

  test('a diagonal whose line misses the view is dropped; a non-positive scale draws nothing', () => {
    const far = model({ diag1: true, frame: { cellX: 10000, cellY: 6, cellWidth: 8, cellHeight: 10 } });
    expect(symmetryAxisSegments(far, T, VIEW)).toEqual([]);
    expect(symmetryAxisSegments(model({ lines: [{ kind: 'v', at: 8, dashed: false }] }), { ...T, scale: 0 }, VIEW)).toEqual([]);
  });

  test('the stroke is the chrome hairline, in screen px', () => {
    expect(AXIS_STROKE_PX).toBe(HAIRLINE_PX);
  });
});

describe('writeSymmetryAxes', () => {
  function fakeGroup() {
    const lines: Array<AxisLineElement & { attrs: Record<string, string> }> = [];
    let created = 0;
    const group: AxisGroupElement & { created: () => number } = {
      get children() { return lines; },
      appendChild: (el) => { lines.push(el as typeof lines[number]); },
      createLine: () => {
        created++;
        const el = { attrs: {} as Record<string, string>, setAttribute(n: string, v: string) { el.attrs[n] = v; }, remove() { lines.splice(lines.indexOf(el), 1); } };
        return el;
      },
      created: () => created,
    };
    return { group, lines };
  }
  const seg = (o: Partial<AxisSegment> = {}): AxisSegment => ({ x1: 1, y1: 2, x2: 3, y2: 4, color: 'c', dash: null, dashOffset: 0, ...o });

  test('creates lines up to the count, reuses them on the next write, removes extras', () => {
    const { group, lines } = fakeGroup();
    writeSymmetryAxes(group, [seg(), seg({ dash: 8, dashOffset: 3 })]);
    expect(lines).toHaveLength(2);
    expect(lines[0].attrs).toEqual({ x1: '1', y1: '2', x2: '3', y2: '4', stroke: 'c', 'stroke-width': String(AXIS_STROKE_PX), 'stroke-dasharray': 'none', 'stroke-dashoffset': '0' });
    expect(lines[1].attrs).toMatchObject({ 'stroke-dasharray': '4 4', 'stroke-dashoffset': '3' });
    writeSymmetryAxes(group, [seg({ x1: 9 })]);
    expect(lines).toHaveLength(1);
    expect(lines[0].attrs.x1).toBe('9');
    expect(group.created()).toBe(2); // nothing allocated for the rewrite
    writeSymmetryAxes(group, []);
    expect(lines).toHaveLength(0);
  });
});

describe('a bounded model — the mirror of one selected pattern — keeps every line to the frame', () => {
  // Frame (4,6)-(12,16) cells → screen x 72..136, y 148..228 under T.
  const bounded = (over: Partial<SymmetryOverlayModel> = {}) => model({ bounded: true, ...over });

  test('the centre axes stop at the frame’s edges instead of crossing the view', () => {
    const segs = symmetryAxisSegments(bounded({ lines: [
      { kind: 'v', at: 8, dashed: false },
      { kind: 'h', at: 11, dashed: false },
    ] }), T, VIEW);
    expect(segs[0]).toMatchObject({ x1: 40 + px(8), x2: 40 + px(8), y1: 100 + px(6), y2: 100 + px(16), color: AXIS_COLOR });
    expect(segs[1]).toMatchObject({ y1: 100 + px(11), y2: 100 + px(11), x1: 40 + px(4), x2: 40 + px(12), color: AXIS_COLOR });
    // …and still clip to the view when the frame runs past it.
    const wide = symmetryAxisSegments(bounded({
      frame: { cellX: -100, cellY: 6, cellWidth: 400, cellHeight: 10 },
      lines: [{ kind: 'h', at: 11, dashed: false }],
    }), T, VIEW);
    expect(wide[0]).toMatchObject({ x1: 0, x2: 400 });
  });

  test('the diagonals stop at the frame too, phased from its centre', () => {
    const segs = symmetryAxisSegments(bounded({ diag1: true, diag2: true }), T, VIEW);
    expect(segs).toHaveLength(2);
    for (const s of segs) {
      for (const x of [s.x1, s.x2]) expect(x).toBeGreaterThanOrEqual(40 + px(4) - 1e-6);
      for (const x of [s.x1, s.x2]) expect(x).toBeLessThanOrEqual(40 + px(12) + 1e-6);
      for (const y of [s.y1, s.y2]) expect(y).toBeGreaterThanOrEqual(100 + px(6) - 1e-6);
      for (const y of [s.y1, s.y2]) expect(y).toBeLessThanOrEqual(100 + px(16) + 1e-6);
      expect(s.color).toBe(DIAG_COLOR);
    }
    // The frame is taller than wide, so each diagonal spans the full width.
    expect(segs[0].x1).toBeCloseTo(40 + px(4));
    expect(segs[0].x2).toBeCloseTo(40 + px(12));
  });

  test('an axis outside the frame is dropped, and a frame off-screen draws nothing', () => {
    expect(symmetryAxisSegments(bounded({ lines: [{ kind: 'v', at: 2, dashed: false }] }), T, VIEW)).toEqual([]);
    expect(symmetryAxisSegments(bounded({
      frame: { cellX: 10000, cellY: 6, cellWidth: 8, cellHeight: 10 },
      lines: [{ kind: 'h', at: 11, dashed: false }], diag1: true,
    }), T, VIEW)).toEqual([]);
  });

  test('unbounded, the same lines cross the whole view as before', () => {
    const [v] = symmetryAxisSegments(model({ lines: [{ kind: 'v', at: 8, dashed: false }] }), T, VIEW);
    expect(v).toMatchObject({ y1: 0, y2: 800 });
  });
});

describe('a bounded model TURNED with its pattern draws its lines turned about the frame centre', () => {
  // Frame (4,6)-(12,16), centre (8,11). A quarter turn CW takes the
  // vertical centre axis (x = 8, y 6→16) onto the horizontal through the
  // centre: (8,6) → (13,11) and (8,16) → (3,11) in world cells.
  const turned = (over: Partial<SymmetryOverlayModel> = {}) => model({ bounded: true, angleDeg: 90, ...over });

  test('the centre axis lies across the turned grid, edge to edge, nothing clipped to the view', () => {
    const [v] = symmetryAxisSegments(turned({ lines: [{ kind: 'v', at: 8, dashed: false }] }), T, VIEW);
    expect(v.x1).toBeCloseTo(40 + px(13));
    expect(v.y1).toBeCloseTo(100 + px(11));
    expect(v.x2).toBeCloseTo(40 + px(3));
    expect(v.y2).toBeCloseTo(100 + px(11));
    expect(v.color).toBe(AXIS_COLOR);
    expect(v.dash).toBeNull();
  });

  test('quarter lines keep to the frame, diagonals reach the box, and a line off the frame is dropped', () => {
    const segs = symmetryAxisSegments(turned({
      lines: [{ kind: 'h', at: 8.5, dashed: true, quarter: true }, { kind: 'v', at: 2, dashed: false }],
      diag1: true,
    }), T, VIEW);
    expect(segs).toHaveLength(2);
    expect(segs[0].color).toBe(QUARTER_COLOR);
    expect(segs[0].dash).toBeCloseTo(0.5 * BASE_CELL_PX * T.scale);
    // The diagonal: the shorter half-extent (4) each way from the centre,
    // then turned — its length is 4·√2·2 cells on screen either way.
    const d = segs[1];
    expect(d.color).toBe(DIAG_COLOR);
    expect(Math.hypot(d.x2 - d.x1, d.y2 - d.y1)).toBeCloseTo(px(8 * Math.SQRT2));
  });

  test('unturned, the bounded model takes the axis-aligned path as before', () => {
    const [v] = symmetryAxisSegments(model({ bounded: true, lines: [{ kind: 'v', at: 8, dashed: false }] }), T, VIEW);
    expect(v).toMatchObject({ x1: 40 + px(8), x2: 40 + px(8), y1: 100 + px(6), y2: 100 + px(16) });
  });
});
