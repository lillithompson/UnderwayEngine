/**
 * The scene graph's transform math (docs/transform-refactor.md §3.2).
 *
 * Most of this is property-style: build a lot of transforms, push points
 * through them both ways, and require the answers to agree. The cases
 * worth naming individually are the ones the legacy system got wrong or
 * could not express at all — pivoted gestures, shear, and the fact that a
 * rotated rectangle is not a rectangle.
 */

import {
  LOCAL_IDENTITY, LocalTransform, MAT_IDENTITY, Mat2D,
  composeLocal, decomposeMatrix, fromTransform2D, localEquals, localMatrix,
  localTranslate, matApplyBbox, matApplyCorners, matApplyDelta, matApplyPoint,
  matDet, matInvert, matIsSimilarity, matMul, matShear, normalizeDeg,
  transformAboutPivot,
} from '../sceneTransform';
import { applyToBbox, Transform2D } from '../transform2d';

// ── Fixtures ───────────────────────────────────────────────────────────

/** A spread of transforms: turns on and off the axes, flips, uneven
 *  scales, and angles that are not multiples of 90. */
function sampleTransforms(): LocalTransform[] {
  const out: LocalTransform[] = [];
  for (const rotationDeg of [0, 30, 90, 137.5, 180, 270, 315]) {
    for (const [sx, sy] of [[1, 1], [2, 2], [2, 0.5], [0.25, 3]]) {
      for (const [tx, ty] of [[0, 0], [7, -3]]) {
        for (const mirror of [{}, { mirrorH: true }, { mirrorV: true }]) {
          out.push({ tx, ty, sx, sy, rotationDeg, ...mirror });
        }
      }
    }
  }
  return out;
}

const POINTS: [number, number][] = [[0, 0], [1, 0], [0, 1], [3, -5], [-2.25, 8.5]];

function closeTo(a: number, b: number, eps = 1e-9): void {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(eps * Math.max(1, Math.abs(a), Math.abs(b)));
}

// ── Matrix ─────────────────────────────────────────────────────────────

describe('matrix algebra', () => {
  test('identity is neutral on both sides', () => {
    for (const t of sampleTransforms()) {
      const m = localMatrix(t);
      expect(matMul(MAT_IDENTITY, m)).toEqual(m);
      expect(matMul(m, MAT_IDENTITY)).toEqual(m);
    }
  });

  test('a matrix times its inverse is the identity', () => {
    for (const t of sampleTransforms()) {
      const m = localMatrix(t);
      const back = matMul(m, matInvert(m));
      closeTo(back.a, 1); closeTo(back.b, 0);
      closeTo(back.c, 0); closeTo(back.d, 1);
      closeTo(back.e, 0); closeTo(back.f, 0);
    }
  });

  test('inverting maps a point back to where it came from', () => {
    for (const t of sampleTransforms()) {
      const m = localMatrix(t);
      const inv = matInvert(m);
      for (const [x, y] of POINTS) {
        const [wx, wy] = matApplyPoint(m, x, y);
        const [bx, by] = matApplyPoint(inv, wx, wy);
        closeTo(bx, x); closeTo(by, y);
      }
    }
  });

  test('a singular matrix is refused, not silently collapsed', () => {
    expect(() => matInvert({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 })).toThrow(/singular/);
    expect(() => matInvert(localMatrix({ ...LOCAL_IDENTITY, sx: 0 }))).toThrow(/singular/);
  });

  test('multiplication is composition: outer applied after inner', () => {
    for (const outer of sampleTransforms().slice(0, 12)) {
      for (const inner of sampleTransforms().slice(0, 12)) {
        const mo = localMatrix(outer), mi = localMatrix(inner);
        const product = matMul(mo, mi);
        for (const [x, y] of POINTS) {
          const [ix, iy] = matApplyPoint(mi, x, y);
          const [ox, oy] = matApplyPoint(mo, ix, iy);
          const [px, py] = matApplyPoint(product, x, y);
          closeTo(px, ox); closeTo(py, oy);
        }
      }
    }
  });

  test('a delta ignores translation, a point does not', () => {
    const m = localMatrix({ ...LOCAL_IDENTITY, tx: 100, ty: 50, rotationDeg: 90 });
    expect(matApplyPoint(m, 1, 0)).toEqual([100, 51]);
    expect(matApplyDelta(m, 1, 0)).toEqual([0, 1]);
  });

  test('determinant is negative exactly when handedness flips', () => {
    expect(matDet(localMatrix(LOCAL_IDENTITY))).toBeGreaterThan(0);
    expect(matDet(localMatrix({ ...LOCAL_IDENTITY, mirrorH: true }))).toBeLessThan(0);
    expect(matDet(localMatrix({ ...LOCAL_IDENTITY, mirrorV: true }))).toBeLessThan(0);
    // Two flips is a half turn, which does not flip handedness.
    expect(matDet(localMatrix({ ...LOCAL_IDENTITY, mirrorH: true, mirrorV: true }))).toBeGreaterThan(0);
  });
});

// ── Bbox under a matrix ────────────────────────────────────────────────

describe('a rotated rectangle is not a rectangle', () => {
  const unit = { x: 0, y: 0, width: 2, height: 1 };

  test('an axis-aligned transform keeps the box exact', () => {
    const m = localMatrix({ ...LOCAL_IDENTITY, tx: 5, ty: 6, sx: 3, sy: 4 });
    expect(matApplyBbox(m, unit)).toEqual({ x: 5, y: 6, width: 6, height: 4 });
  });

  test('a quarter turn swaps the box dimensions', () => {
    const m = localMatrix({ ...LOCAL_IDENTITY, rotationDeg: 90 });
    const b = matApplyBbox(m, unit);
    closeTo(b.width, 1); closeTo(b.height, 2);
  });

  test('a 45 degree turn gives an AABB larger than the shape', () => {
    const m = localMatrix({ ...LOCAL_IDENTITY, rotationDeg: 45 });
    const square = { x: 0, y: 0, width: 1, height: 1 };
    const b = matApplyBbox(m, square);
    closeTo(b.width, Math.SQRT2);
    closeTo(b.height, Math.SQRT2);
    // ...but the corners are still a unit square, side by side.
    const [p0, p1, , p3] = matApplyCorners(m, square);
    closeTo(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), 1);
    closeTo(Math.hypot(p3[0] - p0[0], p3[1] - p0[1]), 1);
  });

  test('corners come back in drawing order', () => {
    const b = { x: 1, y: 2, width: 4, height: 8 };
    expect(matApplyCorners(MAT_IDENTITY, b)).toEqual([[1, 2], [5, 2], [5, 10], [1, 10]]);
  });
});

// ── Decomposition ──────────────────────────────────────────────────────

describe('decomposeMatrix', () => {
  test('round-trips every shear-free transform exactly', () => {
    for (const t of sampleTransforms()) {
      const m = localMatrix(t);
      const back = decomposeMatrix(m);
      expect(localEquals(back, t)).toBe(true);
    }
  });

  test('reports a flip as a negative scale, not a flag', () => {
    const back = decomposeMatrix(localMatrix({ ...LOCAL_IDENTITY, mirrorV: true }));
    expect(back.mirrorH).toBeUndefined();
    expect(back.mirrorV).toBeUndefined();
    expect(back.sy).toBeLessThan(0);
  });

  test('a sheared matrix has no exact form, and says so', () => {
    // A non-uniform scale over a rotated child: the case the plan says
    // the legacy model could not store and approximated by "the nearest
    // rotated rectangle".
    const child = localMatrix({ ...LOCAL_IDENTITY, rotationDeg: 45 });
    const parent = localMatrix({ ...LOCAL_IDENTITY, sx: 3, sy: 1 });
    const world = matMul(parent, child);

    expect(matShear(world)).not.toBeCloseTo(0, 6);
    expect(matIsSimilarity(world)).toBe(false);
    // The decomposition is a genuine approximation here — it does not
    // reproduce the matrix — which is exactly why readers that must keep
    // the shear carry the matrix instead.
    expect(localEquals(decomposeMatrix(world), decomposeMatrix(world))).toBe(true);
    const round = localMatrix(decomposeMatrix(world));
    expect(Math.abs(round.c - world.c) + Math.abs(round.d - world.d)).toBeGreaterThan(1e-6);
    // Area is preserved even so, which is what keeps a sheared node the
    // right size rather than merely the right shape.
    closeTo(matDet(round), matDet(world));
  });

  test('shear is zero for anything built from a LocalTransform', () => {
    for (const t of sampleTransforms()) {
      expect(Math.abs(matShear(localMatrix(t)))).toBeLessThan(1e-9);
    }
  });

  test('similarity is uniform scale, turn and flip — and nothing else', () => {
    expect(matIsSimilarity(localMatrix({ ...LOCAL_IDENTITY, rotationDeg: 37, sx: 2, sy: 2 }))).toBe(true);
    expect(matIsSimilarity(localMatrix({ ...LOCAL_IDENTITY, rotationDeg: 37, mirrorH: true }))).toBe(true);
    expect(matIsSimilarity(localMatrix({ ...LOCAL_IDENTITY, sx: 2, sy: 3 }))).toBe(false);
  });
});

// ── Composition ────────────────────────────────────────────────────────

describe('composeLocal', () => {
  test('identity is neutral', () => {
    for (const t of sampleTransforms()) {
      expect(localEquals(composeLocal(LOCAL_IDENTITY, t), t)).toBe(true);
      expect(localEquals(composeLocal(t, LOCAL_IDENTITY), t)).toBe(true);
    }
  });

  test('agrees with applying the two in sequence', () => {
    for (const outer of sampleTransforms().slice(0, 20)) {
      for (const inner of sampleTransforms().slice(0, 20)) {
        // Uniform outer scale keeps the composition shear-free, so the
        // decomposed result is exact and comparable point for point.
        if (outer.sx !== outer.sy) continue;
        const composed = localMatrix(composeLocal(outer, inner));
        const sequential = matMul(localMatrix(outer), localMatrix(inner));
        for (const [x, y] of POINTS) {
          const [ax, ay] = matApplyPoint(composed, x, y);
          const [bx, by] = matApplyPoint(sequential, x, y);
          closeTo(ax, bx); closeTo(ay, by);
        }
      }
    }
  });

  test('a chain of translates adds up', () => {
    const chain = [localTranslate(1, 2), localTranslate(10, 20), localTranslate(100, 200)];
    const total = chain.reduce((acc, t) => composeLocal(acc, t), LOCAL_IDENTITY);
    expect(total.tx).toBe(111);
    expect(total.ty).toBe(222);
  });
});

// ── Pivoted gestures ───────────────────────────────────────────────────

describe('transformAboutPivot', () => {
  test('the pivot itself does not move', () => {
    const pivots: [number, number][] = [[0, 0], [10, 4], [-3.5, 7.25]];
    for (const t of sampleTransforms().slice(0, 24)) {
      for (const pivot of pivots) {
        for (const delta of [{ rotateDeg: 37 }, { scaleX: 2, scaleY: 2 }, { rotateDeg: 90, scaleX: 0.5, scaleY: 0.5 }]) {
          const moved = transformAboutPivot(t, pivot, delta);
          const before = matApplyPoint(localMatrix(t), 0, 0);
          const after = matApplyPoint(localMatrix(moved), 0, 0);
          // The node's origin moves...
          void before; void after;
          // ...but the pivot, read through the gesture, does not.
          const g = matMul(localMatrix(moved), matInvert(localMatrix(t)));
          const [px, py] = matApplyPoint(g, pivot[0], pivot[1]);
          closeTo(px, pivot[0], 1e-8);
          closeTo(py, pivot[1], 1e-8);
        }
      }
    }
  });

  test('no delta is no change', () => {
    for (const t of sampleTransforms()) {
      expect(localEquals(transformAboutPivot(t, [5, 5], {}), t)).toBe(true);
    }
  });

  test('a quarter turn about a box centre keeps the box centred', () => {
    // The gesture the legacy frame path needed a probe materialize for.
    const box = { x: 10, y: 20, width: 6, height: 2 };
    const centre: [number, number] = [box.x + box.width / 2, box.y + box.height / 2];
    const turned = transformAboutPivot(LOCAL_IDENTITY, centre, { rotateDeg: 90 });
    const after = matApplyBbox(localMatrix(turned), box);
    closeTo(after.x + after.width / 2, centre[0]);
    closeTo(after.y + after.height / 2, centre[1]);
    closeTo(after.width, 2);
    closeTo(after.height, 6);
  });

  test('a resize about the opposite corner pins that corner', () => {
    const box = { x: 0, y: 0, width: 4, height: 3 };
    const opposite: [number, number] = [box.x, box.y + box.height];  // bottom-left
    const scaled = transformAboutPivot(LOCAL_IDENTITY, opposite, { scaleX: 2, scaleY: 2 });
    const after = matApplyBbox(localMatrix(scaled), box);
    closeTo(after.x, opposite[0]);
    closeTo(after.y + after.height, opposite[1]);
    closeTo(after.width, 8);
    closeTo(after.height, 6);
  });

  test('successive turns accumulate on one transform, not per gesture', () => {
    // Four quarter turns about a fixed pivot return to the start exactly.
    // Under the legacy model this was N per-member orbits, each rounding.
    const pivot: [number, number] = [3, 7];
    let t: LocalTransform = { tx: 1, ty: 2, sx: 1.5, sy: 1.5, rotationDeg: 0 };
    const start = t;
    for (let i = 0; i < 4; i++) t = transformAboutPivot(t, pivot, { rotateDeg: 90 });
    expect(localEquals(t, start, 1e-9)).toBe(true);
  });
});

// ── Interop with the legacy model ──────────────────────────────────────

describe('fromTransform2D', () => {
  const legacy = (o: Partial<Transform2D>): Transform2D => ({
    tx: 0, ty: 0, sx: 1, sy: 1, rotation: 0, mirrorH: false, mirrorV: false, ...o,
  });

  test('reproduces the legacy bbox transform for every quarter turn', () => {
    const box = { x: 2, y: 3, width: 4, height: 6 };
    for (const rotation of [0, 90, 180, 270] as const) {
      for (const [sx, sy] of [[1, 1], [2, 3]]) {
        for (const mirrorH of [false, true]) {
          for (const mirrorV of [false, true]) {
            const t = legacy({ rotation, sx, sy, mirrorH, mirrorV, tx: 5, ty: -1 });
            const expected = applyToBbox(t, box);
            const actual = matApplyBbox(localMatrix(fromTransform2D(t)), box);
            const label = `r=${rotation} s=(${sx},${sy}) mH=${mirrorH} mV=${mirrorV}`;
            expect({ label, ...actual }).toEqual({
              label,
              x: expect.closeTo(expected.x, 9),
              y: expect.closeTo(expected.y, 9),
              width: expect.closeTo(expected.width, 9),
              height: expect.closeTo(expected.height, 9),
            });
          }
        }
      }
    }
  });

  test('swaps the axis scales on a quarter turn, and only then', () => {
    expect(fromTransform2D(legacy({ rotation: 0, sx: 2, sy: 3 }))).toMatchObject({ sx: 2, sy: 3 });
    expect(fromTransform2D(legacy({ rotation: 90, sx: 2, sy: 3 }))).toMatchObject({ sx: 3, sy: 2 });
    expect(fromTransform2D(legacy({ rotation: 180, sx: 2, sy: 3 }))).toMatchObject({ sx: 2, sy: 3 });
    expect(fromTransform2D(legacy({ rotation: 270, sx: 2, sy: 3 }))).toMatchObject({ sx: 3, sy: 2 });
  });
});

describe('normalizeDeg', () => {
  test('folds into [0, 360)', () => {
    expect(normalizeDeg(0)).toBe(0);
    expect(normalizeDeg(360)).toBe(0);
    expect(normalizeDeg(-90)).toBe(270);
    expect(normalizeDeg(450)).toBe(90);
    expect(normalizeDeg(-450)).toBe(270);
  });
});

describe('localMatrix cleans float noise', () => {
  test('a quarter turn has exact zeros', () => {
    const m: Mat2D = localMatrix({ ...LOCAL_IDENTITY, rotationDeg: 90 });
    expect(m.a).toBe(0);
    expect(m.d).toBe(0);
    expect(m.b).toBe(1);
    expect(m.c).toBe(-1);
  });
});
