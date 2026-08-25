import {
  computeBoxMirrorTargets,
  computePaintMirrorTargets,
  computeMirrorSymmetry,
  type MirrorFlags,
} from '../paintMirror';
import type { CanvasConfig } from '../canvas-bounds';
import { makeLayer } from './test-utils';

// computeBoxMirrorTargets is computeImpl with the layer machinery stripped
// away, for hosts whose window is a plain box. On any window BOTH can
// express (level 0, unshifted, origin 0 — where a layer cell IS a box
// cell), the two must agree exactly, mode by mode. That agreement is the
// contract that keeps the port from drifting.
//
// One deliberate difference: the box variant never CLIPS to the window —
// on an unbounded canvas the window places the axes rather than fencing
// the mirrored area — so the agreement compare filters the box results to
// the window the layer implementation is bound to.

const OFF: MirrorFlags = {
  mirrorH: false, mirrorV: false, mirrorRotate: false, mirrorQuad: false,
  mirrorRow: false, mirrorCol: false, mirrorDiag1: false, mirrorDiag2: false,
  mirrorDiagBoth: false, mirrorStar: false,
};

const MODES: [string, Partial<MirrorFlags>][] = [
  ['h', { mirrorH: true }],
  ['v', { mirrorV: true }],
  ['hv', { mirrorH: true, mirrorV: true }],
  ['rotate', { mirrorRotate: true }],
  ['quad', { mirrorQuad: true }],
  ['row', { mirrorRow: true }],
  ['col', { mirrorCol: true }],
  ['diag1', { mirrorDiag1: true }],
  ['diag2', { mirrorDiag2: true }],
  ['diagBoth', { mirrorDiagBoth: true }],
  ['star', { mirrorStar: true }],
];

function layerTargets(
  x: number, y: number, w: number, h: number, flags: MirrorFlags,
): string[] {
  const layer = makeLayer('test', 0);
  const cfg: CanvasConfig = { widthL0: w, heightL0: h, originL0X: 0, originL0Y: 0 };
  return computePaintMirrorTargets(x, y, layer, cfg, flags)
    .map((t) => `${t.x},${t.y},${t.mH},${t.mV},${t.rot}`)
    .sort();
}

function boxTargets(
  x: number, y: number, w: number, h: number, flags: MirrorFlags,
): string[] {
  return computeBoxMirrorTargets(x, y, w, h, flags).targets
    .filter((t) => t.x >= 0 && t.x < w && t.y >= 0 && t.y < h)
    .map((t) => `${t.x},${t.y},${t.mH},${t.mV},${t.rot}`)
    .sort();
}

describe('computeBoxMirrorTargets agrees with the layer implementation', () => {
  const windows: [number, number][] = [[8, 8], [7, 8], [8, 5], [3, 3], [16, 12]];
  const cells: [number, number][] = [[0, 0], [1, 1], [2, 3], [3, 2], [5, 4]];

  for (const [name, mode] of MODES) {
    test(`${name}: identical targets on every shared window`, () => {
      const flags = { ...OFF, ...mode };
      for (const [w, h] of windows) {
        for (const [x, y] of cells) {
          if (x >= w || y >= h) continue;
          expect(boxTargets(x, y, w, h, flags)).toEqual(layerTargets(x, y, w, h, flags));
        }
      }
    });
  }

  test('axis membership matches computeMirrorSymmetry', () => {
    const layer = makeLayer('test', 0);
    const cfg: CanvasConfig = { widthL0: 8, heightL0: 8, originL0X: 0, originL0Y: 0 };
    for (const [, mode] of MODES) {
      const flags = { ...OFF, ...mode };
      for (let x = 0; x < 8; x++) {
        for (let y = 0; y < 8; y++) {
          expect(computeBoxMirrorTargets(x, y, 8, 8, flags).symmetry)
            .toEqual(computeMirrorSymmetry(x, y, layer, cfg, flags));
        }
      }
    }
  });

  test('windows beyond the 32-cell layer cap still mirror', () => {
    // The whole point of the box variant: a 100-cell window (a fine
    // composition grid) is out of the layer entry points' reach, but the
    // box math has no cap. H partner of column 10 in a 100-wide window is
    // column 89.
    const { targets } = computeBoxMirrorTargets(10, 3, 100, 50, { ...OFF, mirrorH: true });
    expect(targets).toEqual([{ x: 89, y: 3, mH: true, mV: false, rot: 0 }]);
  });

  test('no flags → no targets, no symmetry', () => {
    const r = computeBoxMirrorTargets(2, 2, 8, 8, OFF);
    expect(r.targets).toEqual([]);
    expect(r.symmetry).toBeUndefined();
  });

  test('the mirror applies OUTSIDE the window — the axes, not the fence', () => {
    // H about an 8-wide window's center (axis at 3.5): a cell way out at
    // x = 20 still reflects, to 7 − 20 = −13.
    expect(computeBoxMirrorTargets(20, 2, 8, 8, { ...OFF, mirrorH: true }).targets)
      .toEqual([{ x: -13, y: 2, mH: true, mV: false, rot: 0 }]);
    // …and a negative cell reflects back across.
    expect(computeBoxMirrorTargets(-5, 2, 8, 8, { ...OFF, mirrorH: true }).targets)
      .toEqual([{ x: 12, y: 2, mH: true, mV: false, rot: 0 }]);
    // Rotate keeps its full orbit about the same pivot.
    const rot = computeBoxMirrorTargets(10, 2, 8, 8, { ...OFF, mirrorRotate: true }).targets;
    expect(rot).toHaveLength(3);
    expect(rot).toContainEqual({ x: -3, y: 5, mH: false, mV: false, rot: 180 });
  });

  test('quad / row / col fall back to the center mirror outside their block grid', () => {
    // Quad's quadrant structure exists only inside the window; beyond it
    // the press still mirrors H+V about the center.
    const quad = computeBoxMirrorTargets(10, 2, 8, 8, { ...OFF, mirrorQuad: true }).targets;
    expect(quad).toEqual([
      { x: -3, y: 2, mH: true, mV: false, rot: 0 },
      { x: 10, y: 5, mH: false, mV: true, rot: 0 },
      { x: -3, y: 5, mH: true, mV: true, rot: 0 },
    ]);
    const row = computeBoxMirrorTargets(2, 12, 8, 8, { ...OFF, mirrorRow: true }).targets;
    expect(row).toEqual([{ x: 2, y: -5, mH: false, mV: true, rot: 0 }]);
    const col = computeBoxMirrorTargets(12, 2, 8, 8, { ...OFF, mirrorCol: true }).targets;
    expect(col).toEqual([{ x: -5, y: 2, mH: true, mV: false, rot: 0 }]);
  });
});
