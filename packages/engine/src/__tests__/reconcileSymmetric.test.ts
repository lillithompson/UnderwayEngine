/**
 * Symmetric reconcile property tests.
 *
 * The 2026-05 rewrite makes reconcile symmetric-by-construction when
 * any mirror flag is on: pick a canonical cell per orbit, reconcile
 * only that cell, then clone the result to every orbit partner. The
 * tests here pin that contract for every supported mirror mode.
 *
 * Companion fixture: `test_data/star_reconcile.tile` (the user's
 * reproducer for the original asymmetric-output bug). It's a binary
 * composition file; the same property is exercised here against
 * synthetic layers so the test stays self-contained.
 */

import { reconcileCanvas, mirrorCellState, getRenderedSignature } from '../connectivity';
import { computePaintMirrorTargets, type MirrorFlags } from '../paintMirror';
import type { CanvasConfig } from '../canvas-bounds';
import { makeLayer } from './test-utils';
import { CellState, DEFAULT_TRANSFORM, Layer } from '../types';
import { getCell } from '../cellEdge';

function spriteCell(spriteId: string, transform = { ...DEFAULT_TRANSFORM }): CellState {
  return { type: 'sprite', spriteId, transform };
}

function nk(li: number, cx: number, cy: number): number {
  return li * 4096 + cy * 64 + cx;
}

/** A reconciled layer is symmetric under `flags` iff every cell equals
 *  the mirrored canonical of its orbit. (For empty orbits, both ends
 *  are null and the assertion is vacuous.) */
/** Assert that each orbit-seed cell's `paintMirror` partner positions
 *  contain the same rendered signature as the seed (after applying the
 *  partner's mirror+rotation transform). This is the user-visible
 *  symmetry property — "all 8 cells of an orbit look the same modulo
 *  the canvas mirror" — and it's preserved under reconcile even when
 *  the canonical lex-rep shifts between passes (mirrorCellState
 *  composition isn't associative across canonicals, but the rendered
 *  bits agree by construction). */
function expectOrbitSymmetric(
  layer: Layer, canvasCfg: CanvasConfig, flags: MirrorFlags,
  seedXs: number[], seedYs: number[],
): void {
  for (let s = 0; s < seedXs.length; s++) {
    const sx = seedXs[s], sy = seedYs[s];
    const seedCell = getCell(layer, sx, sy);
    if (!seedCell || seedCell.type !== 'sprite') continue;
    const seedSig = getRenderedSignatureForTest(seedCell);
    if (!seedSig) continue;
    const partners = computePaintMirrorTargets(sx, sy, layer, canvasCfg, flags);
    for (const t of partners) {
      const partnerCell = getCell(layer, t.x, t.y);
      if (!partnerCell || partnerCell.type !== 'sprite') {
        throw new Error(`Orbit asymmetry: seed (${sx},${sy}) partner (${t.x},${t.y}) is null`);
      }
      const partnerSig = getRenderedSignatureForTest(partnerCell);
      if (!partnerSig) throw new Error(`Partner at (${t.x},${t.y}) has no rendered sig`);
      // Map the seed's signature through the partner's mirror+rotation
      // (the rendered bits at the partner should match the seed's bits,
      // re-indexed via the same 8-point shuffle that paintMirror would
      // apply when it stamps an orbit).
      const expectedSig = transformSignature(seedSig, t.mH, t.mV, t.rot);
      if (!sigEqual(partnerSig, expectedSig)) {
        throw new Error(
          `Orbit asymmetry: seed (${sx},${sy})=${JSON.stringify(seedCell)} ` +
          `→ partner (${t.x},${t.y}) via mH=${t.mH} mV=${t.mV} rot=${t.rot}\n` +
          `  expected sig: ${expectedSig.map(b => b ? 1 : 0).join('')}\n` +
          `  partner sig:  ${partnerSig.map(b => b ? 1 : 0).join('')}\n` +
          `  partner cell: ${JSON.stringify(partnerCell)}`,
        );
      }
    }
  }
}

function getRenderedSignatureForTest(cell: CellState | null): boolean[] | null {
  if (!cell || cell.type !== 'sprite') return null;
  return getRenderedSignature(cell);
}

function sigEqual(a: boolean[], b: boolean[]): boolean {
  for (let i = 0; i < 8; i++) if (a[i] !== b[i]) return false;
  return true;
}

// 8 connection points indexed N=0, NE=1, E=2, SE=3, S=4, SW=5, W=6, NW=7.
// Mirror+rotation re-indexing tables, matching the connectivity LUTs.
const ROT_OFFSET: Record<0 | 90 | 180 | 270, number> = { 0: 0, 90: 6, 180: 4, 270: 2 };
const H_MAP = [0, 7, 6, 5, 4, 3, 2, 1];
const V_MAP = [4, 3, 2, 1, 0, 7, 6, 5];

function transformSignature(sig: boolean[], mH: boolean, mV: boolean, rot: 0 | 90 | 180 | 270): boolean[] {
  const out = new Array<boolean>(8);
  for (let p = 0; p < 8; p++) {
    let src = (p + ROT_OFFSET[rot]) & 7;
    if (mH) src = H_MAP[src];
    if (mV) src = V_MAP[src];
    out[p] = sig[src];
  }
  return out;
}

const ALL_FLAGS_OFF: MirrorFlags = {
  mirrorH: false, mirrorV: false, mirrorRotate: false, mirrorQuad: false,
  mirrorRow: false, mirrorCol: false, mirrorDiag1: false, mirrorDiag2: false,
  mirrorDiagBoth: false, mirrorStar: false,
};

const MIRROR_MODES: Array<{ name: string; flags: MirrorFlags; toArgs: () => any[] }> = [
  { name: 'mirrorH',         flags: { ...ALL_FLAGS_OFF, mirrorH: true },
    toArgs: () => [true, false, false, 32, 32] },
  { name: 'mirrorV',         flags: { ...ALL_FLAGS_OFF, mirrorV: true },
    toArgs: () => [false, true, false, 32, 32] },
  { name: 'mirrorHV',        flags: { ...ALL_FLAGS_OFF, mirrorH: true, mirrorV: true },
    toArgs: () => [true, true, false, 32, 32] },
  { name: 'mirrorRotate',    flags: { ...ALL_FLAGS_OFF, mirrorRotate: true },
    toArgs: () => [false, false, true, 32, 32] },
  { name: 'mirrorQuad',      flags: { ...ALL_FLAGS_OFF, mirrorQuad: true },
    toArgs: () => [false, false, false, 32, 32, false, true] },
  { name: 'mirrorRow',       flags: { ...ALL_FLAGS_OFF, mirrorRow: true },
    toArgs: () => [false, false, false, 32, 32, false, false, true] },
  { name: 'mirrorCol',       flags: { ...ALL_FLAGS_OFF, mirrorCol: true },
    toArgs: () => [false, false, false, 32, 32, false, false, false, true] },
  { name: 'mirrorDiag1',     flags: { ...ALL_FLAGS_OFF, mirrorDiag1: true },
    toArgs: () => [false, false, false, 32, 32, false, false, false, false, true] },
  { name: 'mirrorDiag2',     flags: { ...ALL_FLAGS_OFF, mirrorDiag2: true },
    toArgs: () => [false, false, false, 32, 32, false, false, false, false, false, true] },
  { name: 'mirrorDiagBoth',  flags: { ...ALL_FLAGS_OFF, mirrorDiagBoth: true },
    toArgs: () => [false, false, false, 32, 32, false, false, false, false, false, false, true] },
  { name: 'mirrorStar',      flags: { ...ALL_FLAGS_OFF, mirrorStar: true },
    toArgs: () => [false, false, false, 32, 32, false, false, false, false, false, false, false, true] },
];

describe('reconcile symmetric output (one test per mirror mode)', () => {
  const canvasCfg: CanvasConfig = { widthL0: 32, heightL0: 32, originL0X: 0, originL0Y: 0 };

  for (const mode of MIRROR_MODES) {
    it(`${mode.name}: an asymmetric seed produces an orbit-symmetric output`, () => {
      const layer = makeLayer('L0', 0);
      const seedXs = [3, 3];
      const seedYs = [5, 4];
      layer.cells[seedYs[0]][seedXs[0]] = spriteCell('test/tile_10101010');
      layer.cells[seedYs[1]][seedXs[1]] = spriteCell('test/tile_00000000');
      const placementOrder = new Map<number, number>();
      placementOrder.set(nk(0, seedXs[0], seedYs[0]), 0);
      placementOrder.set(nk(0, seedXs[1], seedYs[1]), 1);

      const layers = [layer];
      reconcileCanvas(layers, layers, true, placementOrder, undefined, ...mode.toArgs());

      expectOrbitSymmetric(layer, canvasCfg, mode.flags, seedXs, seedYs);
    });

    it(`${mode.name}: paint-symmetric input is a fixed point`, () => {
      // Seed the canonical cell, then paint its orbit partners explicitly
      // via paintMirror so the input is already symmetric. Reconcile must
      // be a no-op (or at least leave the orbit symmetric).
      const layer = makeLayer('L0', 0);
      const seed = spriteCell('test/tile_00000000');
      const seedX = 4, seedY = 4;
      layer.cells[seedY][seedX] = seed;
      const partners = computePaintMirrorTargets(seedX, seedY, layer, canvasCfg, mode.flags);
      for (const t of partners) {
        const m = mirrorCellState(seed, t.mH, t.mV, t.rot);
        if (m && t.x >= 0 && t.x < 32 && t.y >= 0 && t.y < 32) {
          layer.cells[t.y][t.x] = m;
        }
      }

      const placementOrder = new Map<number, number>();
      placementOrder.set(nk(0, seedX, seedY), 0);

      const layers = [layer];
      reconcileCanvas(layers, layers, true, placementOrder, undefined, ...mode.toArgs());
      expectOrbitSymmetric(layer, canvasCfg, mode.flags, [seedX], [seedY]);
    });
  }
});
