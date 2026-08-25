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
});
