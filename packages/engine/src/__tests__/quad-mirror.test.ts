import { computePaintMirrorTargets, type MirrorFlags } from '../paintMirror';
import type { CanvasConfig } from '../canvas-bounds';
import { makeLayer } from './test-utils';

/**
 * Helper: call the shared orbit helper and shape its result like the
 * legacy `mirrorTargets` buffer that this test file was written against.
 *
 * (maxX, maxY) cell counts are mapped to a layer at level 0 with
 * `widthL0 = maxX`, `heightL0 = maxY`; the edge-cell (-1) machinery in
 * `canvasCellWindow` lights up the same way for shift=0.5 as the legacy
 * cell-count-based math did.
 */
function getTargets(
  x: number, y: number,
  mirrorH: boolean, mirrorV: boolean, mirrorRotate: boolean,
  maxX: number, maxY: number,
  mirrorQuad: boolean,
  mirrorRow: boolean = false,
  mirrorCol: boolean = false,
  mirrorDiag1: boolean = false,
  mirrorDiag2: boolean = false,
  mirrorDiagBoth: boolean = false,
  mirrorStar: boolean = false,
  shiftX: number = 0,
  shiftY: number = 0,
) {
  const layer = makeLayer('test', 0);
  layer.shiftX = shiftX as 0 | 0.5;
  layer.shiftY = shiftY as 0 | 0.5;
  const canvasCfg: CanvasConfig = { widthL0: maxX, heightL0: maxY, originL0X: 0, originL0Y: 0 };
  const flags: MirrorFlags = {
    mirrorH, mirrorV, mirrorRotate, mirrorQuad,
    mirrorRow, mirrorCol, mirrorDiag1, mirrorDiag2, mirrorDiagBoth, mirrorStar,
  };
  const partners = computePaintMirrorTargets(x, y, layer, canvasCfg, flags);
  return partners.map(t => ({ x: t.x, y: t.y, mirrorH: t.mH, mirrorV: t.mV, rotateOffset: t.rot }));
}

// ── Test 1: Quad target computation ─────────────────────────────────

describe('quad mirror target computation', () => {
  test('8×8 grid at (1,1) produces 15 targets', () => {
    const targets = getTargets(1, 1, false, false, false, 8, 8, true);
    expect(targets.length).toBe(15);

    // All targets should be in bounds
    for (const t of targets) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThan(8);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeLessThan(8);
    }

    // Primary cell (1,1) should not appear in targets
    expect(targets.some(t => t.x === 1 && t.y === 1)).toBe(false);

    // All targets should be unique
    const coords = new Set(targets.map(t => `${t.x},${t.y}`));
    expect(coords.size).toBe(targets.length);
  });
});

// ── Test 2: Fallback for small grids ────────────────────────────────

describe('quad mirror fallback', () => {
  test('2×2 grid falls back to H+V producing 3 targets', () => {
    const targets = getTargets(0, 0, false, false, false, 2, 2, true);
    expect(targets.length).toBe(3);

    // Should produce the same positions as H+V mirror
    const hvTargets = getTargets(0, 0, true, true, false, 2, 2, false);
    expect(hvTargets.length).toBe(3);

    const quadCoords = new Set(targets.map(t => `${t.x},${t.y}`));
    const hvCoords = new Set(hvTargets.map(t => `${t.x},${t.y}`));
    expect(quadCoords).toEqual(hvCoords);
  });

  test('3×3 grid also falls back to H+V', () => {
    const targets = getTargets(0, 0, false, false, false, 3, 3, true);
    expect(targets.length).toBe(3);
  });
});

// ── Test 3: Axis dedup ──────────────────────────────────────────────

describe('quad mirror axis dedup', () => {
  test('target count is always <= 15 for any position on 8×8', () => {
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 8; y++) {
        const targets = getTargets(x, y, false, false, false, 8, 8, true);
        expect(targets.length).toBeLessThanOrEqual(15);
        expect(targets.length).toBeGreaterThan(0);
        // No duplicates
        const coords = new Set(targets.map(t => `${t.x},${t.y}`));
        expect(coords.size).toBe(targets.length);
      }
    }
  });

  test('positions on quadrant boundary may produce fewer targets', () => {
    // On an 8×8 grid, qw=4. Position x=0 in TL quadrant has mqx=3.
    // Position (0,0): local mirrors are (0,0),(3,0),(0,3),(3,3).
    // In all 4 quadrants: TL (0,0)(3,0)(0,3)(3,3), TR (4,0)(7,0)(4,3)(7,3),
    // BL (0,4)(3,4)(0,7)(3,7), BR (4,4)(7,4)(4,7)(7,7).
    // That's 16 unique positions minus primary (0,0) = 15.
    const targets = getTargets(0, 0, false, false, false, 8, 8, true);
    expect(targets.length).toBe(15);
  });
});

// ── Test 4: Cycle order ─────────────────────────────────────────────

// ── Test 5: Mirror flag composition ─────────────────────────────────

describe('quad mirror flag composition', () => {
  test('TL quadrant local mirrors have correct flags', () => {
    const targets = getTargets(1, 1, false, false, false, 8, 8, true);

    // For (1,1) on 8×8: qw=4, qh=4, qx=1, qy=1, mqx=2, mqy=2.
    // TL quadrant (ox=0, oy=0, qH=false, qV=false):
    //   local (2,1): lH=true, lV=false → mirrorH = true XOR false = true, mirrorV = false XOR false = false
    //   local (1,2): lH=false, lV=true → mirrorH = false, mirrorV = true
    //   local (2,2): lH=true, lV=true → mirrorH = true, mirrorV = true
    const tl_21 = targets.find(t => t.x === 2 && t.y === 1);
    expect(tl_21).toBeDefined();
    expect(tl_21!.mirrorH).toBe(true);
    expect(tl_21!.mirrorV).toBe(false);

    const tl_12 = targets.find(t => t.x === 1 && t.y === 2);
    expect(tl_12).toBeDefined();
    expect(tl_12!.mirrorH).toBe(false);
    expect(tl_12!.mirrorV).toBe(true);

    const tl_22 = targets.find(t => t.x === 2 && t.y === 2);
    expect(tl_22).toBeDefined();
    expect(tl_22!.mirrorH).toBe(true);
    expect(tl_22!.mirrorV).toBe(true);
  });

  test('TR quadrant mirrors have XORed H flag with swapped positions', () => {
    const targets = getTargets(1, 1, false, false, false, 8, 8, true);

    // TR quadrant (ox=4, oy=0, qH=true, qV=false):
    // With position swap fix, positions within reflected quadrant are swapped
    // so that transforms align correctly with the H-reflected layout:
    //   (5,1): mirrorH=false (no flip — this is the "right" position in TR, mirroring "left" in TL)
    //   (6,1): mirrorH=true (H-flipped — "left" in TR mirrors "right" in TL)
    //   (5,2): mirrorH=false, mirrorV=true
    //   (6,2): mirrorH=true, mirrorV=true
    const tr_51 = targets.find(t => t.x === 5 && t.y === 1);
    expect(tr_51).toBeDefined();
    expect(tr_51!.mirrorH).toBe(false);
    expect(tr_51!.mirrorV).toBe(false);

    const tr_61 = targets.find(t => t.x === 6 && t.y === 1);
    expect(tr_61).toBeDefined();
    expect(tr_61!.mirrorH).toBe(true);
    expect(tr_61!.mirrorV).toBe(false);

    const tr_52 = targets.find(t => t.x === 5 && t.y === 2);
    expect(tr_52).toBeDefined();
    expect(tr_52!.mirrorH).toBe(false);
    expect(tr_52!.mirrorV).toBe(true);

    const tr_62 = targets.find(t => t.x === 6 && t.y === 2);
    expect(tr_62).toBeDefined();
    expect(tr_62!.mirrorH).toBe(true);
    expect(tr_62!.mirrorV).toBe(true);
  });

  test('all quad targets have rotateOffset = 0', () => {
    const targets = getTargets(1, 1, false, false, false, 8, 8, true);
    for (const t of targets) {
      expect(t.rotateOffset).toBe(0);
    }
  });
});

// ── Test 6: Row symmetry target computation ─────────────────────────

describe('Row symmetry target computation', () => {
  it('produces up to 3 targets on 8×8 grid (2 halves, no left/right)', () => {
    const targets = getTargets(1, 1, false, false, false, 8, 8, false, true, false);
    expect(targets.length).toBe(3);

    // All unique positions (including primary)
    const positions = new Set<string>();
    positions.add('1,1'); // primary
    for (const t of targets) {
      positions.add(`${t.x},${t.y}`);
    }
    expect(positions.size).toBe(4);
  });

  it('falls back to single-axis mirror on small grids', () => {
    const targets = getTargets(0, 0, false, false, false, 2, 2, false, true, false);
    expect(targets.length).toBe(1); // single Y-flip only
  });

  it('produces no X-flip within half', () => {
    // For row symmetry at (1,1) on 8×8: only Y mirrors, no X changes
    const targets = getTargets(1, 1, false, false, false, 8, 8, false, true, false);
    for (const t of targets) {
      // All targets should have the same X coordinate as the primary
      expect(t.x).toBe(1);
    }
    // Y-flip within top half of (1,1) → (1,2) should be present
    const targetStrs = targets.map(t => `${t.x},${t.y}`);
    expect(targetStrs).toContain('1,2');
  });
});

// ── Test 7: Column symmetry target computation ──────────────────────

describe('Column symmetry target computation', () => {
  it('produces up to 3 targets on 8×8 grid (2 halves, no top/bottom)', () => {
    const targets = getTargets(1, 1, false, false, false, 8, 8, false, false, true);
    expect(targets.length).toBe(3);

    const positions = new Set<string>();
    positions.add('1,1');
    for (const t of targets) {
      positions.add(`${t.x},${t.y}`);
    }
    expect(positions.size).toBe(4);
  });

  it('falls back to single-axis mirror on small grids', () => {
    const targets = getTargets(0, 0, false, false, false, 2, 2, false, false, true);
    expect(targets.length).toBe(1); // single X-flip only
  });

  it('produces no Y-flip within half', () => {
    const targets = getTargets(1, 1, false, false, false, 8, 8, false, false, true);
    for (const t of targets) {
      // All targets should have the same Y coordinate as the primary
      expect(t.y).toBe(1);
    }
    // X-flip within left half of (1,1) → (2,1) should be present
    const targetStrs = targets.map(t => `${t.x},${t.y}`);
    expect(targetStrs).toContain('2,1');
  });
});

// ── Test 8: Row vs Column vs Quad target counts ─────────────────────

describe('Row vs Column vs Quad target counts', () => {
});

// ── Test 9: Diagonal \ symmetry ─────────────────────────────────────

describe('Diagonal \\ symmetry', () => {
  it('produces 1 target on 8×8 grid', () => {
    // (1,2) → (2,1)
    const targets = getTargets(1, 2, false, false, false, 8, 8, false, false, false, true, false, false);
    expect(targets.length).toBe(1);
    expect(targets[0].x).toBe(2);
    expect(targets[0].y).toBe(1);
    expect(targets[0].mirrorH).toBe(true);
    expect(targets[0].mirrorV).toBe(false);
    expect(targets[0].rotateOffset).toBe(270);
  });

  it('produces 0 targets on the diagonal (x === y)', () => {
    const targets = getTargets(3, 3, false, false, false, 8, 8, false, false, false, true, false, false);
    expect(targets.length).toBe(0);
  });
});

// ── Test 10: Diagonal / symmetry ────────────────────────────────────

describe('Diagonal / symmetry', () => {
  it('produces 1 target on 8×8 grid', () => {
    const targets = getTargets(1, 2, false, false, false, 8, 8, false, false, false, false, true, false);
    expect(targets.length).toBe(1);
    // (1,2) → (8-1-2, 8-1-1) = (5, 6)
    expect(targets[0].x).toBe(5);
    expect(targets[0].y).toBe(6);
    expect(targets[0].rotateOffset).toBe(90);
  });

  it('produces 0 targets on the anti-diagonal (x + y === maxX - 1)', () => {
    const targets = getTargets(3, 4, false, false, false, 8, 8, false, false, false, false, true, false);
    expect(targets.length).toBe(0);
  });
});

// ── Test 11: Both diagonals symmetry ────────────────────────────────

describe('Both diagonals symmetry', () => {
  it('produces 3 targets (\\, /, 180°)', () => {
    const targets = getTargets(1, 2, false, false, false, 8, 8, false, false, false, false, false, true);
    expect(targets.length).toBe(3);
    const flat = targets.map(t => ({ x: t.x, y: t.y, rot: t.rotateOffset }));
    expect(flat).toContainEqual({ x: 2, y: 1, rot: 270 });
    expect(flat).toContainEqual({ x: 5, y: 6, rot: 90 });
    expect(flat).toContainEqual({ x: 6, y: 5, rot: 180 });
  });

  it('produces fewer targets when on a diagonal', () => {
    const targets = getTargets(3, 3, false, false, false, 8, 8, false, false, false, false, false, true);
    expect(targets.length).toBeLessThan(3);
  });
});

// ── Shift-aware mirror targets ──────────────────────────────────────

describe('mirrorTargets with layer shift', () => {
  it('rotation on 3-cell shifted layer centers correctly', () => {
    // 6x6 L1 canvas -> L2 has 3 cells, shift=0.5
    // With shift: cx2 = 3-1-1 = 1, center at 0.5
    const targets = getTargets(0, 0, false, false, true, 3, 3, false, false, false, false, false, false, false, 0.5, 0.5);
    const rot90 = targets.find(t => t.rotateOffset === 90);
    expect(rot90).toBeDefined();
    expect(rot90!.x).toBe(1);
    expect(rot90!.y).toBe(0);
    const rot180 = targets.find(t => t.rotateOffset === 180);
    expect(rot180!.x).toBe(1);
    expect(rot180!.y).toBe(1);
    const rot270 = targets.find(t => t.rotateOffset === 270);
    expect(rot270!.x).toBe(0);
    expect(rot270!.y).toBe(1);
  });

  it('H mirror on shifted layer uses shift-adjusted center', () => {
    // maxX=3, shiftX=0.5: mirror of x=0 -> Math.floor(3-1-1-0) = 1
    const targets = getTargets(0, 0, true, false, false, 3, 3, false, false, false, false, false, false, false, 0.5, 0.5);
    expect(targets.length).toBe(1);
    expect(targets[0].x).toBe(1);
    expect(targets[0].y).toBe(0);
  });

  it('V mirror on shifted layer uses shift-adjusted center', () => {
    const targets = getTargets(0, 0, false, true, false, 3, 3, false, false, false, false, false, false, false, 0.5, 0.5);
    expect(targets.length).toBe(1);
    expect(targets[0].x).toBe(0);
    expect(targets[0].y).toBe(1);
  });

  it('zero shift produces same results as unshifted', () => {
    const withShift = getTargets(1, 1, true, true, false, 4, 4, false, false, false, false, false, false, false, 0, 0);
    const withoutShift = getTargets(1, 1, true, true, false, 4, 4, false);
    expect(withShift).toEqual(withoutShift);
  });

  it('quad fallback on small shifted grid uses shift-adjusted center', () => {
    const targets = getTargets(0, 0, false, false, false, 3, 3, true, false, false, false, false, false, false, 0.5, 0.5);
    expect(targets.length).toBe(3);
    expect(targets.some(t => t.x === 1 && t.y === 0)).toBe(true);
    expect(targets.some(t => t.x === 0 && t.y === 1)).toBe(true);
    expect(targets.some(t => t.x === 1 && t.y === 1)).toBe(true);
  });

  // Removed 2026-05: the cx2Override-based tests targeted a positional
  // override on the legacy `mirrorTargets`. Non-aligned origins are now
  // handled by passing `originL0X / originL0Y` through `CanvasConfig` to
  // `computePaintMirrorTargets`, which is exercised by the .facet snapshot
  // tests in `engine/__tests__/mirroring.test.ts` (MirrorStar_test2.facet
  // covers the 32x22 origin-Y=4 case in particular).
});

// ── Star (8-fold D4) symmetry ─────────────────────────────────────────

describe('Star symmetry', () => {
  it('produces 7 targets on 8×8 grid at (1,2)', () => {
    const targets = getTargets(1, 2, false, false, false, 8, 8, false, false, false, false, false, false, true);
    expect(targets.length).toBe(7);
    // All targets unique
    const coords = new Set(targets.map(t => `${t.x},${t.y}`));
    expect(coords.size).toBe(7);
    // Primary cell not in targets
    expect(targets.some(t => t.x === 1 && t.y === 2)).toBe(false);
    // All in bounds
    for (const t of targets) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThan(8);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeLessThan(8);
    }
  });

  it('includes H mirror target', () => {
    const targets = getTargets(1, 2, false, false, false, 8, 8, false, false, false, false, false, false, true);
    expect(targets.some(t => t.x === 6 && t.y === 2 && t.mirrorH)).toBe(true);
  });

  it('includes V mirror target', () => {
    const targets = getTargets(1, 2, false, false, false, 8, 8, false, false, false, false, false, false, true);
    expect(targets.some(t => t.x === 1 && t.y === 5 && t.mirrorV)).toBe(true);
  });

  it('includes diagonal targets', () => {
    const targets = getTargets(1, 2, false, false, false, 8, 8, false, false, false, false, false, false, true);
    // Diag \ : (y, x) = (2, 1)
    expect(targets.some(t => t.x === 2 && t.y === 1 && t.rotateOffset === 270)).toBe(true);
    // Diag / : (maxX-1-y, maxY-1-x) = (5, 6)
    expect(targets.some(t => t.x === 5 && t.y === 6 && t.rotateOffset === 90)).toBe(true);
  });

  it('produces fewer targets at exact center', () => {
    // On a 7×7 grid, center is (3, 3)
    const targets = getTargets(3, 3, false, false, false, 7, 7, false, false, false, false, false, false, true);
    // At center, all transforms map back to (3,3), producing 0 targets
    expect(targets.length).toBe(0);
  });

  it('deduplicates on symmetry axes', () => {
    // Cell (0, 0) on 8×8: H mirror gives (7,0), V mirror gives (0,7), etc.
    const targets = getTargets(0, 0, false, false, false, 8, 8, false, false, false, false, false, false, true);
    // Check no duplicate coordinates
    const coords = new Set(targets.map(t => `${t.x},${t.y}`));
    expect(coords.size).toBe(targets.length);
  });
});
