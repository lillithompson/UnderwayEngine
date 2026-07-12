import { computeInverseRotMirror } from '../gl/compositionRenderer';

/** Apply a column-major mat2 [c0.x, c0.y, c1.x, c1.y] to a vec2. */
function applyMat2(m: [number, number, number, number], v: [number, number]): [number, number] {
  // result = c0*v.x + c1*v.y
  return [
    m[0] * v[0] + m[2] * v[1],
    m[1] * v[0] + m[3] * v[1],
  ];
}

/** Forward transform matching the SVG side (engine/svgFigureCache.ts:
 *  buildBlockSVGContent). The transform string is
 *  `translate(c) rotate(R) scale(-1,1) scale(1,-1) translate(-c)`, so in
 *  center-relative coords the matrix is `R * S_h * S_v` — mirror is
 *  applied first, then rotation. */
function applyForward(
  rotation: number,
  mirrorH: boolean,
  mirrorV: boolean,
  v: [number, number],
): [number, number] {
  let m: [number, number] = [
    mirrorH ? -v[0] : v[0],
    mirrorV ? -v[1] : v[1],
  ];
  switch (rotation) {
    case 90:  return [-m[1], m[0]];
    case 180: return [-m[0], -m[1]];
    case 270: return [m[1], -m[0]];
    default:  return m;
  }
}

function expectVec2Close(a: [number, number], b: [number, number]) {
  expect(a[0]).toBeCloseTo(b[0], 9);
  expect(a[1]).toBeCloseTo(b[1], 9);
}

describe('computeInverseRotMirror', () => {
  const cases: Array<{ rot: number; h: boolean; v: boolean }> = [];
  for (const rot of [0, 90, 180, 270]) {
    for (const h of [false, true]) {
      for (const v of [false, true]) {
        cases.push({ rot, h, v });
      }
    }
  }

  for (const { rot, h, v } of cases) {
    test(`inverse undoes forward (rot=${rot}, mirrorH=${h}, mirrorV=${v})`, () => {
      const inv = computeInverseRotMirror(rot, h, v);
      const probes: Array<[number, number]> = [
        [1, 0],
        [0, 1],
        [0.3, 0.7],
        [-0.5, 0.25],
      ];
      for (const p of probes) {
        const forwardThenInverse = applyMat2(inv, applyForward(rot, h, v, p));
        expectVec2Close(forwardThenInverse, p);
      }
    });
  }

  test('rotation=0, no mirror is the identity', () => {
    expect(computeInverseRotMirror(0, false, false)).toEqual([1, 0, 0, 1]);
  });

});
