import {
  Transform2D, Bbox, Orientation, IDENTITY,
  applyToBbox, applyToPoint, invertBbox, invertPoint,
  orientationToMatrix, matrixToOrientation, composeOrientation,
  compose, composeChain,
  translate, fromGroupNode, bboxFromCells, bboxToCells,
} from '../transform2d';

// ── Helpers ────────────────────────────────────────────────────────────

const ROTATIONS: (0 | 90 | 180 | 270)[] = [0, 90, 180, 270];
const BOOLS = [false, true];

/** All 16 orientation triples (only 8 are distinct matrices). */
function allOrientations(): Orientation[] {
  const out: Orientation[] = [];
  for (const r of ROTATIONS) {
    for (const mh of BOOLS) {
      for (const mv of BOOLS) {
        out.push({ rotation: r, mirrorH: mh, mirrorV: mv });
      }
    }
  }
  return out;
}

/** Build a transform from an orientation + optional translate/scale. */
function t(
  ori: Orientation,
  tx = 0, ty = 0, sx = 1, sy = 1,
): Transform2D {
  return { tx, ty, sx, sy, ...ori };
}

function closeTo(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps;
}

function bboxClose(a: Bbox, b: Bbox, eps = 1e-9): boolean {
  return closeTo(a.x, b.x, eps) && closeTo(a.y, b.y, eps)
    && closeTo(a.width, b.width, eps) && closeTo(a.height, b.height, eps);
}

const R0: Orientation = { rotation: 0, mirrorH: false, mirrorV: false };
const R90: Orientation = { rotation: 90, mirrorH: false, mirrorV: false };
const R180: Orientation = { rotation: 180, mirrorH: false, mirrorV: false };
const R270: Orientation = { rotation: 270, mirrorH: false, mirrorV: false };
const MH: Orientation = { rotation: 0, mirrorH: true, mirrorV: false };
const MV: Orientation = { rotation: 0, mirrorH: false, mirrorV: true };

// ── applyToBbox / invertBbox round-trip ────────────────────────────────

describe('applyToBbox + invertBbox round-trip', () => {
  const testBbox: Bbox = { x: 3, y: 5, width: 4, height: 7 };

  for (const ori of allOrientations()) {
    for (const [sx, sy] of [[1, 1], [2, 3], [0.5, 1.5]]) {
      for (const [tx, ty] of [[0, 0], [10, -5]]) {
        const label = `r=${ori.rotation} mH=${ori.mirrorH} mV=${ori.mirrorV} s=(${sx},${sy}) t=(${tx},${ty})`;
        test(label, () => {
          const xf = t(ori, tx, ty, sx, sy);
          const world = applyToBbox(xf, testBbox);
          const recovered = invertBbox(xf, world);
          expect(bboxClose(recovered, testBbox)).toBe(true);
        });
      }
    }
  }
});

// ── applyToPoint / invertPoint round-trip ──────────────────────────────

describe('applyToPoint + invertPoint round-trip', () => {
  const points: [number, number][] = [[0, 0], [3, 5], [-2, 7], [1.5, -0.5]];

  for (const ori of allOrientations()) {
    for (const [sx, sy] of [[1, 1], [2, 3]]) {
      for (const [px, py] of points) {
        const label = `r=${ori.rotation} mH=${ori.mirrorH} mV=${ori.mirrorV} s=(${sx},${sy}) pt=(${px},${py})`;
        test(label, () => {
          const xf = t(ori, 10, -5, sx, sy);
          const [wx, wy] = applyToPoint(xf, px, py);
          const [rx, ry] = invertPoint(xf, wx, wy);
          expect(closeTo(rx, px)).toBe(true);
          expect(closeTo(ry, py)).toBe(true);
        });
      }
    }
  }
});

// ── Identity transform ─────────────────────────────────────────────────

describe('IDENTITY', () => {
  test('applyToBbox with IDENTITY returns input', () => {
    const bbox: Bbox = { x: 3, y: 5, width: 4, height: 7 };
    expect(applyToBbox(IDENTITY, bbox)).toEqual(bbox);
  });

  test('applyToPoint with IDENTITY returns input', () => {
    expect(applyToPoint(IDENTITY, 3, 5)).toEqual([3, 5]);
  });

  test('compose(IDENTITY, t) === t', () => {
    const xf: Transform2D = { tx: 10, ty: -5, sx: 2, sy: 3, rotation: 90, mirrorH: true, mirrorV: false };
    const result = compose(IDENTITY, xf);
    // Apply both to a test point and verify equivalence
    const pt: [number, number] = [3, 7];
    const [ex, ey] = applyToPoint(xf, ...pt);
    const [rx, ry] = applyToPoint(result, ...pt);
    expect(closeTo(rx, ex)).toBe(true);
    expect(closeTo(ry, ey)).toBe(true);
  });

  test('compose(t, IDENTITY) === t', () => {
    const xf: Transform2D = { tx: 10, ty: -5, sx: 2, sy: 3, rotation: 270, mirrorH: false, mirrorV: true };
    const result = compose(xf, IDENTITY);
    const pt: [number, number] = [3, 7];
    const [ex, ey] = applyToPoint(xf, ...pt);
    const [rx, ry] = applyToPoint(result, ...pt);
    expect(closeTo(rx, ex)).toBe(true);
    expect(closeTo(ry, ey)).toBe(true);
  });
});

// ── Orientation composition ────────────────────────────────────────────

describe('orientation composition', () => {
  test('4x 90 CW rotation = identity', () => {
    let o: Orientation = R0;
    for (let i = 0; i < 4; i++) o = composeOrientation(R90, o);
    expect(o.rotation).toBe(0);
    expect(o.mirrorH).toBe(false);
    expect(o.mirrorV).toBe(false);
  });

  test('mirrorH is self-inverse', () => {
    const result = composeOrientation(MH, MH);
    expect(result).toEqual(R0);
  });

  test('mirrorV is self-inverse', () => {
    const result = composeOrientation(MV, MV);
    expect(result).toEqual(R0);
  });

  test('180 = mirrorH + mirrorV', () => {
    const result = composeOrientation(MH, MV);
    expect(result.rotation).toBe(180);
    expect(result.mirrorH).toBe(false);
    expect(result.mirrorV).toBe(false);
  });

  test('matrixToOrientation(orientationToMatrix(o)) is canonical', () => {
    for (const ori of allOrientations()) {
      const m = orientationToMatrix(ori);
      const recovered = matrixToOrientation(m);
      // The recovered form may differ (e.g. mirrorH+mirrorV+R0 == R180),
      // but the matrix must be numerically identical (treating -0 === 0).
      const m2 = orientationToMatrix(recovered);
      for (let i = 0; i < 4; i++) {
        expect(m2[i] === m[i] || (m2[i] === 0 && m[i] === 0)).toBe(true);
      }
    }
  });

  test('all 16 triples produce exactly 8 distinct matrices', () => {
    const seen = new Set<string>();
    for (const ori of allOrientations()) {
      seen.add(JSON.stringify(orientationToMatrix(ori)));
    }
    expect(seen.size).toBe(8);
  });
});

// ── compose correctness ────────────────────────────────────────────────

describe('compose', () => {
  test('compose matches sequential application on bbox', () => {
    const a: Transform2D = { tx: 5, ty: 3, sx: 2, sy: 1.5, rotation: 90, mirrorH: false, mirrorV: false };
    const b: Transform2D = { tx: 1, ty: -1, sx: 1, sy: 1, rotation: 0, mirrorH: true, mirrorV: false };
    const bbox: Bbox = { x: 2, y: 3, width: 4, height: 5 };

    const sequential = applyToBbox(a, applyToBbox(b, bbox));
    const composed = applyToBbox(compose(a, b), bbox);

    expect(bboxClose(composed, sequential)).toBe(true);
  });

  test('compose matches sequential application on point', () => {
    const a: Transform2D = { tx: 5, ty: 3, sx: 2, sy: 1.5, rotation: 90, mirrorH: false, mirrorV: false };
    const b: Transform2D = { tx: 1, ty: -1, sx: 1, sy: 1, rotation: 0, mirrorH: true, mirrorV: false };
    const [px, py] = [3, 7];

    const [ix, iy] = applyToPoint(b, px, py);
    const [sx, sy] = applyToPoint(a, ix, iy);
    const composed = compose(a, b);
    const [cx, cy] = applyToPoint(composed, px, py);

    expect(closeTo(cx, sx)).toBe(true);
    expect(closeTo(cy, sy)).toBe(true);
  });

  test('compose is correct for all D4 orientation pairs', () => {
    const oris: Orientation[] = [R0, R90, R180, R270, MH, MV,
      { rotation: 90, mirrorH: true, mirrorV: false },
      { rotation: 270, mirrorH: false, mirrorV: true },
    ];
    const bbox: Bbox = { x: 1, y: 2, width: 3, height: 5 };

    for (const outerOri of oris) {
      for (const innerOri of oris) {
        const outer = t(outerOri, 10, 5, 2, 3);
        const inner = t(innerOri, -3, 7, 1.5, 0.5);
        const sequential = applyToBbox(outer, applyToBbox(inner, bbox));
        const composed = applyToBbox(compose(outer, inner), bbox);
        if (!bboxClose(composed, sequential, 1e-6)) {
          fail(`Mismatch for outer=${JSON.stringify(outerOri)} inner=${JSON.stringify(innerOri)}: ` +
            `sequential=${JSON.stringify(sequential)} composed=${JSON.stringify(composed)}`);
        }
      }
    }
  });

  test('compose is associative: compose(a, compose(b, c)) === compose(compose(a, b), c)', () => {
    const a: Transform2D = { tx: 5, ty: 3, sx: 2, sy: 1.5, rotation: 90, mirrorH: false, mirrorV: true };
    const b: Transform2D = { tx: 1, ty: -1, sx: 1, sy: 0.5, rotation: 270, mirrorH: true, mirrorV: false };
    const c: Transform2D = { tx: -2, ty: 4, sx: 3, sy: 2, rotation: 180, mirrorH: false, mirrorV: false };
    const bbox: Bbox = { x: 1, y: 2, width: 3, height: 5 };

    const left = compose(a, compose(b, c));
    const right = compose(compose(a, b), c);

    expect(bboxClose(applyToBbox(left, bbox), applyToBbox(right, bbox))).toBe(true);
  });
});

// ── composeChain ───────────────────────────────────────────────────────

describe('composeChain', () => {
  test('empty chain = IDENTITY', () => {
    const result = composeChain([]);
    expect(result).toEqual(IDENTITY);
  });

  test('single-element chain = that element', () => {
    const xf: Transform2D = { tx: 5, ty: 3, sx: 2, sy: 1, rotation: 90, mirrorH: true, mirrorV: false };
    const result = composeChain([xf]);
    const bbox: Bbox = { x: 1, y: 2, width: 3, height: 4 };
    expect(bboxClose(applyToBbox(result, bbox), applyToBbox(xf, bbox))).toBe(true);
  });

  test('chain matches sequential application (innermost first)', () => {
    const inner: Transform2D = { tx: 1, ty: 2, sx: 1, sy: 1, rotation: 0, mirrorH: false, mirrorV: false };
    const middle: Transform2D = { tx: 0, ty: 0, sx: 2, sy: 2, rotation: 90, mirrorH: false, mirrorV: false };
    const outer: Transform2D = { tx: 10, ty: 10, sx: 1, sy: 1, rotation: 0, mirrorH: true, mirrorV: false };
    const bbox: Bbox = { x: 0, y: 0, width: 1, height: 1 };

    // Sequential: inner first, then middle, then outer
    const step1 = applyToBbox(inner, bbox);
    const step2 = applyToBbox(middle, step1);
    const step3 = applyToBbox(outer, step2);

    const composed = composeChain([inner, middle, outer]);
    const result = applyToBbox(composed, bbox);

    expect(bboxClose(result, step3)).toBe(true);
  });
});

// ── Specific transform cases ───────────────────────────────────────────

describe('specific transform cases', () => {
  test('translate-only transform', () => {
    const xf = translate(10, 20);
    expect(applyToBbox(xf, { x: 1, y: 2, width: 3, height: 4 }))
      .toEqual({ x: 11, y: 22, width: 3, height: 4 });
  });

  test('90 CW rotation swaps width and height', () => {
    const xf = t(R90);
    const result = applyToBbox(xf, { x: 0, y: 0, width: 3, height: 5 });
    expect(closeTo(result.width, 5)).toBe(true);
    expect(closeTo(result.height, 3)).toBe(true);
  });

  test('mirrorH negates x', () => {
    const xf = t(MH);
    const result = applyToBbox(xf, { x: 2, y: 3, width: 4, height: 5 });
    expect(closeTo(result.x, -6)).toBe(true); // -(2+4)
    expect(closeTo(result.y, 3)).toBe(true);
  });

  test('mirrorV negates y', () => {
    const xf = t(MV);
    const result = applyToBbox(xf, { x: 2, y: 3, width: 4, height: 5 });
    expect(closeTo(result.x, 2)).toBe(true);
    expect(closeTo(result.y, -8)).toBe(true); // -(3+5)
  });
});

// ── Legacy interop ─────────────────────────────────────────────────────

describe('fromGroupNode', () => {
  test('converts GroupNode fields to Transform2D', () => {
    const g = { translateX: 10, translateY: 20, scaleX: 2, scaleY: 3, rotation: 90 as const, mirrorH: true, mirrorV: false };
    const xf = fromGroupNode(g);
    expect(xf).toEqual({ tx: 10, ty: 20, sx: 2, sy: 3, rotation: 90, mirrorH: true, mirrorV: false });
  });
});

describe('bboxFromCells / bboxToCells round-trip', () => {
  test('round-trips correctly', () => {
    const cells = { cellX: 3, cellY: 5, cellWidth: 4, cellHeight: 7 };
    expect(bboxToCells(bboxFromCells(cells))).toEqual(cells);
  });
});

// ── Matches legacy applyGroupTransform behavior ────────────────────────

describe('matches legacy applyGroupTransform', () => {
  // Replicate the exact behavior of the existing compositionOps function
  function legacyApplyGroupTransform(
    group: { translateX: number; translateY: number; scaleX: number; scaleY: number; rotation: 0 | 90 | 180 | 270; mirrorH: boolean; mirrorV: boolean },
    local: { cellX: number; cellY: number; cellWidth: number; cellHeight: number },
  ): { cellX: number; cellY: number; cellWidth: number; cellHeight: number } {
    let { cellX: x, cellY: y, cellWidth: w, cellHeight: h } = local;
    if (group.mirrorH) x = -(x + w);
    if (group.mirrorV) y = -(y + h);
    if (group.rotation === 90) {
      const nx = -(y + h), ny = x, nw = h, nh = w;
      x = nx; y = ny; w = nw; h = nh;
    } else if (group.rotation === 180) {
      const nx = -(x + w), ny = -(y + h);
      x = nx; y = ny;
    } else if (group.rotation === 270) {
      const nx = y, ny = -(x + w), nw = h, nh = w;
      x = nx; y = ny; w = nw; h = nh;
    }
    return {
      cellX: group.translateX + x * group.scaleX,
      cellY: group.translateY + y * group.scaleY,
      cellWidth: w * group.scaleX,
      cellHeight: h * group.scaleY,
    };
  }

  const groups = [
    { translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0 as const, mirrorH: false, mirrorV: false },
    { translateX: 10, translateY: -5, scaleX: 2, scaleY: 3, rotation: 90 as const, mirrorH: false, mirrorV: false },
    { translateX: 5, translateY: 5, scaleX: 1, scaleY: 1, rotation: 180 as const, mirrorH: true, mirrorV: false },
    { translateX: -3, translateY: 7, scaleX: 0.5, scaleY: 2, rotation: 270 as const, mirrorH: false, mirrorV: true },
    { translateX: 1, translateY: 1, scaleX: 1, scaleY: 1, rotation: 0 as const, mirrorH: true, mirrorV: true },
  ];

  const locals = [
    { cellX: 0, cellY: 0, cellWidth: 1, cellHeight: 1 },
    { cellX: 3, cellY: 5, cellWidth: 4, cellHeight: 7 },
    { cellX: -2, cellY: 1, cellWidth: 6, cellHeight: 3 },
  ];

  for (const group of groups) {
    for (const local of locals) {
      const label = `group=(t=${group.translateX},${group.translateY} s=${group.scaleX},${group.scaleY} r=${group.rotation} mH=${group.mirrorH} mV=${group.mirrorV}) local=(${local.cellX},${local.cellY},${local.cellWidth},${local.cellHeight})`;
      test(label, () => {
        const legacy = legacyApplyGroupTransform(group, local);
        const xf = fromGroupNode(group);
        const bbox = bboxFromCells(local);
        const result = bboxToCells(applyToBbox(xf, bbox));
        expect(closeTo(result.cellX, legacy.cellX)).toBe(true);
        expect(closeTo(result.cellY, legacy.cellY)).toBe(true);
        expect(closeTo(result.cellWidth, legacy.cellWidth)).toBe(true);
        expect(closeTo(result.cellHeight, legacy.cellHeight)).toBe(true);
      });
    }
  }
});
