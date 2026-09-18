/**
 * The one copy of a figure's art layout (§5 item 7 of
 * docs/transform-refactor-next.md).
 *
 * The un-swap, the uniform scale, the centre and the mirrors-then-rotate
 * order used to be written out three times — once in the exporter's markup,
 * once (in part) in its tiled variant, and once in the bake to path segments
 * — kept in step by hand and by comments saying so. The second block here is
 * the point of the file: it drives the EXPORT and the BAKE over every pose a
 * figure has and checks they land the art's four corners on the same points.
 * That is the agreement the copies were supposed to maintain, and nothing
 * before this asserted it.
 */

import {
  figureArtLayout, figureArtPoint, rotateMirrorAround,
  uniformArtScale, unswapQuarter,
} from '../figureArtLayout';
import { convertCachedSVGToColoredSegments } from '../figureToPaths';
import { SVG_UNITS_PER_L0_CELL as U } from '../svgExport';
import { buildFigureSVGContent, type CachedFigureSVG } from '../svgFigureBuilders';
import { matApplyPoint, matMul, type Mat2D } from '../sceneTransform';
import type { CompositionFigure } from '../types';
import { parseSvgTransform } from './exportPose.test-utils';

/**
 * A 5 × 3 source, deliberately non-square so a missing un-swap shows up as a
 * changed aspect, and deliberately an L rather than a rectangle: a rectangle
 * is point-symmetric, so a corner comparison against one cannot tell a pose
 * from that pose turned 180°, and mirror-then-rotate differs from
 * rotate-then-mirror by exactly that. The L spans the full box (so it still
 * pins the bounds) and no symmetry of it fixes its vertices.
 *
 *   (0,0) ┌───────────┐ (W,0)
 *         │           │
 *   (0,h) └─────┐     │ (W,h)
 *      (w,h)    └─────┘ (W,H)
 */
const W = 5 * U;
const H = 3 * U;
/** The L's vertices in source order — the oracle both routes are read against. */
const MARKER: Array<[number, number]> = [
  [0, 0], [W, 0], [W, H], [W / 2, H], [W / 2, H / 2], [0, H / 2],
];
const cached: CachedFigureSVG = {
  elements: [
    `<path d="M ${MARKER.map(([x, y]) => `${x} ${y}`).join(' L ')} Z" `
    + `stroke="red" fill="none"/>`,
  ],
  svgWidth: W,
  svgHeight: H,
};

/** A 5 × 3 figure at (10, 20), its box stored post-turn as the reducer
 *  writes it. */
function figure(overrides: Partial<CompositionFigure> = {}): CompositionFigure {
  const rotation = overrides.rotation ?? 0;
  const swap = rotation === 90 || rotation === 270;
  return {
    id: 'fig', figureKey: 'k', fileId: 'file-1',
    resolutionX: 1, resolutionY: 1,
    cellX: 10, cellY: 20,
    cellWidth: swap ? 3 : 5, cellHeight: swap ? 5 : 3,
    ...overrides,
  };
}

// ── The helper itself ──────────────────────────────────────────────────

describe('the four steps', () => {
  test('a quarter turn un-swaps the box, the other two leave it alone', () => {
    expect(unswapQuarter(3, 5, 90)).toEqual([5, 3]);
    expect(unswapQuarter(3, 5, 270)).toEqual([5, 3]);
    expect(unswapQuarter(5, 3, 0)).toEqual([5, 3]);
    expect(unswapQuarter(5, 3, 180)).toEqual([5, 3]);
  });

  test('a mismatched aspect letterboxes on the tighter axis, never skews', () => {
    // 5 × 3 art into a 2 × 1 box: 0.4 across, 0.333 down — the art fits the
    // height and leaves margin at the sides.
    expect(uniformArtScale(2, 1, 5, 3)).toBeCloseTo(1 / 3, 10);
    expect(uniformArtScale(1, 2, 5, 3)).toBeCloseTo(0.2, 10);
  });

  test('a matching aspect keeps the x ratio verbatim', () => {
    // Not `min` of two floats that ought to be equal: the epsilon guard is
    // what keeps an exact fit emitting the byte-identical scale it always
    // did, which is why every unrotated figure's markup is unchanged.
    expect(uniformArtScale(10, 6, 5, 3)).toBe(2);
  });

  test('the art centres in the box it was scaled into', () => {
    const l = figureArtLayout({ cellX: 10, cellY: 20, cellWidth: 5, cellHeight: 3 }, 0, cached, 1);
    expect(l.scale).toBe(1 / U);
    expect(l.cx).toBe(12.5);
    expect(l.cy).toBe(21.5);
    expect(l.posX).toBe(10);
    expect(l.posY).toBe(20);
  });

  test('a quarter-turned box scales the art to its UN-swapped size', () => {
    // The stored box is 3 × 5; the art is still laid out 5 wide, and the
    // turn below puts it into the 3 × 5 box.
    const l = figureArtLayout({ cellX: 10, cellY: 20, cellWidth: 3, cellHeight: 5 }, 90, cached, 1);
    expect(l.scale).toBe(1 / U);
    expect(l.posX).toBe(9);   // centre 11.5, half-width 2.5
    expect(l.posY).toBe(21);  // centre 22.5, half-height 1.5
  });

  test('unitsPerCell carries the whole layout into SVG units', () => {
    const box = { cellX: 10, cellY: 20, cellWidth: 5, cellHeight: 3 };
    const cells = figureArtLayout(box, 0, cached, 1);
    const units = figureArtLayout(box, 0, cached, U);
    expect(units.cx).toBeCloseTo(cells.cx * U, 6);
    expect(units.posY).toBeCloseTo(cells.posY * U, 6);
    expect(units.scale).toBeCloseTo(cells.scale * U, 10);
  });

  test('mirrors run BEFORE the quarter, not after', () => {
    // The distinguishing case: (1, 0) about the origin. Mirror-then-rotate
    // sends it to (0, -1); rotate-then-mirror would send it to (0, 1).
    expect(rotateMirrorAround(1, 0, 0, 0, 90, true, false)).toEqual([0, -1]);
    expect(rotateMirrorAround(1, 0, 0, 0, 90, false, false)).toEqual([0, 1]);
  });

  test('a mirror is its own inverse and the quarters close the circle', () => {
    const once = rotateMirrorAround(3, 7, 1, 2, 0, true, true);
    expect(rotateMirrorAround(once[0], once[1], 1, 2, 0, true, true)).toEqual([3, 7]);
    let p: [number, number] = [3, 7];
    for (let i = 0; i < 4; i++) p = rotateMirrorAround(p[0], p[1], 1, 2, 90, false, false);
    expect(p[0]).toBeCloseTo(3, 10);
    expect(p[1]).toBeCloseTo(7, 10);
  });
});

// ── The agreement the three copies existed to maintain ─────────────────

/** Where the EXPORT puts the marker's vertices, in L0 cells: the builder
 *  writes a transform chain per element, so compose it and push the source
 *  vertices through. Divided by U because the markup is in SVG units. */
function exportedVertices(fig: CompositionFigure): string[] {
  const markup = buildFigureSVGContent(fig, cached);
  const m = [...markup.matchAll(/\stransform="([^"]*)"/g)]
    .map((x) => x[1])
    .reduce<Mat2D>((acc, a) => matMul(acc, parseSvgTransform(a)),
      { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  return MARKER.map(([x, y]) => {
    const [wx, wy] = matApplyPoint(m, x, y);
    return key(wx / U, wy / U);
  });
}

/** Where the BAKE puts them: the L is one closed path, so its segments come
 *  back in source order and each segment's START is a vertex. Compared IN
 *  ORDER — a set would be blind to a pose and that pose turned 180°, which
 *  is exactly how the mirror/rotate order can go wrong. */
function bakedVertices(fig: CompositionFigure): string[] {
  const groups = convertCachedSVGToColoredSegments(cached, fig);
  const segs = groups.flatMap((g) => g.segments);
  return segs.map((s) => key(s.start[0], s.start[1]));
}

function key(x: number, y: number): string {
  // -0 and 0 must not read as different vertices.
  return `${(x + 0).toFixed(4)},${(y + 0).toFixed(4)}`;
}

/** Every point the bake emits, for the bounds assertions. */
function bakedPoints(fig: CompositionFigure): Array<[number, number]> {
  return convertCachedSVGToColoredSegments(cached, fig)
    .flatMap((g) => g.segments)
    .flatMap((s) => [
      [s.start[0], s.start[1]] as [number, number],
      [s.end[0], s.end[1]] as [number, number],
    ]);
}

describe('the bake and the export lay the art in the same place', () => {
  const poses: Array<[string, Partial<CompositionFigure>]> = [
    ['upright', {}],
    ['90', { rotation: 90 }],
    ['180', { rotation: 180 }],
    ['270', { rotation: 270 }],
    ['mirrorH', { mirrorH: true }],
    ['mirrorV', { mirrorV: true }],
    ['both mirrors', { mirrorH: true, mirrorV: true }],
    ['90 + mirrorH', { rotation: 90, mirrorH: true }],
    ['270 + mirrorV', { rotation: 270, mirrorV: true }],
    ['90 + both mirrors', { rotation: 90, mirrorH: true, mirrorV: true }],
  ];

  for (const [label, pose] of poses) {
    test(label, () => {
      const fig = figure(pose);
      expect(bakedVertices(fig)).toEqual(exportedVertices(fig));
    });
  }

  test('a letterboxed figure agrees too — the margin is where a skew would hide', () => {
    // 5 × 3 art in a 2 × 2 box: both routes must letterbox the same way, and
    // an axis scale slipping into either one shows up here and nowhere else.
    const fig = figure({ cellWidth: 2, cellHeight: 2 });
    expect(bakedVertices(fig)).toEqual(exportedVertices(fig));
  });

  test('the corners land inside the stored box, quarter turn and all', () => {
    // The un-swap is only correct if the turned art ends up filling the box
    // the reducer stored — this is that, stated without reference to either
    // route's spelling.
    const fig = figure({ rotation: 90 });
    const xs = bakedPoints(fig).map((p) => p[0]);
    const ys = bakedPoints(fig).map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(fig.cellX, 6);
    expect(Math.max(...xs)).toBeCloseTo(fig.cellX + fig.cellWidth, 6);
    expect(Math.min(...ys)).toBeCloseTo(fig.cellY, 6);
    expect(Math.max(...ys)).toBeCloseTo(fig.cellY + fig.cellHeight, 6);
  });
});

describe('figureArtPoint is the layout and the turn in one', () => {
  test('it agrees with applying the two by hand', () => {
    const fig = figure({ rotation: 270, mirrorH: true });
    const l = figureArtLayout(fig, 270, cached, 1);
    const byHand = rotateMirrorAround(
      100 * l.scale + l.posX, 40 * l.scale + l.posY, l.cx, l.cy, 270, true, false,
    );
    expect(figureArtPoint(l, 100, 40, 270, true, false)).toEqual(byHand);
  });
});
