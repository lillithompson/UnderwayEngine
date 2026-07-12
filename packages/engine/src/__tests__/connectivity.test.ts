import {
  parseConnectionSignature,
  connectionPointL0,
  gatherConstraints,
  filterCompatibleSprites,
  pickRandomCompatibleSprite,
  getRenderedSignature,
  mirrorCellState,
  RegionBoundsL0,
  ensureMirrorSigLookups,
  renderedSigPacked,
} from '../connectivity';
import { SpriteEntry, SPRITE_ENTRIES } from '../loadTile';
import { makeLayer } from './test-utils';
import { CellState, DEFAULT_TRANSFORM } from '../types';

// Test sprite entries matching the mock at engine/__mocks__/loadTile.ts
const TEST_ENTRIES: SpriteEntry[] = [
  { id: 'test/tile_00000000', label: 'tile_00000000', family: 'test', connectionCount: 0 },
  { id: 'test/tile_11111111', label: 'tile_11111111', family: 'test', connectionCount: 8 },
  { id: 'test/tile_10101010', label: 'tile_10101010', family: 'test', connectionCount: 4 },
  { id: 'test/tile_01010101', label: 'tile_01010101', family: 'test', connectionCount: 4 },
  { id: 'test/tile_10001000', label: 'tile_10001000', family: 'test', connectionCount: 2 },
  { id: 'test/tile_00100010', label: 'tile_00100010', family: 'test', connectionCount: 2 },
  { id: 'test/unconstrained', label: 'unconstrained', family: 'test', connectionCount: 0 },
];

function spriteCell(spriteId: string): CellState {
  return { type: 'sprite', spriteId, transform: { ...DEFAULT_TRANSFORM } };
}

// ── Signature Parsing ────────────────────────────────────────────────

describe('parseConnectionSignature', () => {
  it('parses a valid tile ID', () => {
    expect(parseConnectionSignature('angular/tile_00101010')).toEqual(
      [false, false, true, false, true, false, true, false],
    );
  });

  it('parses all-ones', () => {
    expect(parseConnectionSignature('test/tile_11111111')).toEqual(
      [true, true, true, true, true, true, true, true],
    );
  });

  it('parses all-zeros', () => {
    expect(parseConnectionSignature('test/tile_00000000')).toEqual(
      [false, false, false, false, false, false, false, false],
    );
  });

  it('returns null for non-conforming names', () => {
    expect(parseConnectionSignature('test/unconstrained')).toBeNull();
    expect(parseConnectionSignature('tile_0010')).toBeNull();
    expect(parseConnectionSignature('test/tile_00101012')).toBeNull();
  });

  it('parses non-tile_ prefixed names with _XXXXXXXX suffix', () => {
    // All sprites end with _XXXXXXXX; names like curve_10101010,
    // connectors_5_10101010, Caution_22_10101010 must be parsed.
    expect(parseConnectionSignature('curved/curve_10101010')).toEqual(
      [true, false, true, false, true, false, true, false],
    );
    expect(parseConnectionSignature('cloud/connectors_5_10101010')).toEqual(
      [true, false, true, false, true, false, true, false],
    );
    expect(parseConnectionSignature('angular/tileAA_10100000')).toEqual(
      [true, false, true, false, false, false, false, false],
    );
    expect(parseConnectionSignature('craftsman/squareConnector_10101010')).toEqual(
      [true, false, true, false, true, false, true, false],
    );
  });

  it('returns null for empty string', () => {
    expect(parseConnectionSignature('')).toBeNull();
  });
});

// ── L0 Coordinate Mapping ────────────────────────────────────────────

describe('connectionPointL0', () => {
  it('maps L0 cell (0,0) points correctly', () => {
    expect(connectionPointL0(0, 0, 0, 0, 0, 0)).toEqual({ x: 0.5, y: 0 });  // N
    expect(connectionPointL0(0, 0, 1, 0, 0, 0)).toEqual({ x: 1, y: 0 });     // NE
    expect(connectionPointL0(0, 0, 2, 0, 0, 0)).toEqual({ x: 1, y: 0.5 });   // E
    expect(connectionPointL0(0, 0, 3, 0, 0, 0)).toEqual({ x: 1, y: 1 });     // SE
    expect(connectionPointL0(0, 0, 4, 0, 0, 0)).toEqual({ x: 0.5, y: 1 });   // S
    expect(connectionPointL0(0, 0, 5, 0, 0, 0)).toEqual({ x: 0, y: 1 });     // SW
    expect(connectionPointL0(0, 0, 6, 0, 0, 0)).toEqual({ x: 0, y: 0.5 });   // W
    expect(connectionPointL0(0, 0, 7, 0, 0, 0)).toEqual({ x: 0, y: 0 });     // NW
  });

  it('maps L1 cell (0,0) points correctly', () => {
    expect(connectionPointL0(0, 0, 0, 1, 0, 0)).toEqual({ x: 1, y: 0 });    // N
    expect(connectionPointL0(0, 0, 1, 1, 0, 0)).toEqual({ x: 2, y: 0 });    // NE
    expect(connectionPointL0(0, 0, 2, 1, 0, 0)).toEqual({ x: 2, y: 1 });    // E
    expect(connectionPointL0(0, 0, 3, 1, 0, 0)).toEqual({ x: 2, y: 2 });    // SE
    expect(connectionPointL0(0, 0, 4, 1, 0, 0)).toEqual({ x: 1, y: 2 });    // S
  });

  it('maps L1 cell with shift correctly', () => {
    expect(connectionPointL0(0, 0, 0, 1, 0.5, 0)).toEqual({ x: 2, y: 0 });  // N
    expect(connectionPointL0(0, 0, 7, 1, 0.5, 0)).toEqual({ x: 1, y: 0 });  // NW
  });

  it('maps higher cell positions', () => {
    expect(connectionPointL0(5, 3, 0, 0, 0, 0)).toEqual({ x: 5.5, y: 3 });  // N
    expect(connectionPointL0(5, 3, 4, 0, 0, 0)).toEqual({ x: 5.5, y: 4 });  // S
  });
});

// ── Cardinal Matching ────────────────────────────────────────────────

describe('gatherConstraints – cardinal matching', () => {
  it('N constraint = true when north neighbor has S=true', () => {
    const layer = makeLayer('test', 0);
    layer.cells[4][5] = spriteCell('test/tile_00001000');
    const constraints = gatherConstraints(5, 5, layer, [layer], true);
    expect(constraints[0]).toBe(true);
  });

  it('N constraint = false when north neighbor has S=false', () => {
    const layer = makeLayer('test', 0);
    layer.cells[4][5] = spriteCell('test/tile_10100010');
    const constraints = gatherConstraints(5, 5, layer, [layer], true);
    expect(constraints[0]).toBe(false);
  });

  it('E constraint matches west neighbor W value', () => {
    const layer = makeLayer('test', 0);
    layer.cells[5][6] = spriteCell('test/tile_00000010');
    const constraints = gatherConstraints(5, 5, layer, [layer], true);
    expect(constraints[2]).toBe(true);
  });
});

// ── Corner Matching ──────────────────────────────────────────────────

describe('gatherConstraints – corner matching', () => {
  it('corner with 0 true neighbors is unconstrained (allowBorder=true)', () => {
    const layer = makeLayer('test', 0);
    const constraints = gatherConstraints(5, 5, layer, [layer], true);
    expect(constraints[1]).toBeNull();
    expect(constraints[3]).toBeNull();
  });

  it('corner with exactly 1 true = constraint true (needs reciprocation)', () => {
    const layer = makeLayer('test', 0);
    // NE diagonal (6,4) with SW(point 5)=true
    layer.cells[4][6] = spriteCell('test/tile_00000100');
    const constraints = gatherConstraints(5, 5, layer, [layer], true);
    expect(constraints[1]).toBe(true);
  });

  it('corner with 2+ true = matched (unconstrained)', () => {
    const layer = makeLayer('test', 0);
    layer.cells[4][6] = spriteCell('test/tile_00000100'); // NE diagonal SW=true
    layer.cells[4][5] = spriteCell('test/tile_00010000'); // N neighbor SE=true
    const constraints = gatherConstraints(5, 5, layer, [layer], true);
    expect(constraints[1]).toBeNull();
  });
});

// ── Border Behavior ──────────────────────────────────────────────────

describe('gatherConstraints – border behavior', () => {
  it('allowBorderConnections=true leaves border points unconstrained', () => {
    const layer = makeLayer('test', 0);
    const constraints = gatherConstraints(0, 0, layer, [layer], true);
    expect(constraints[0]).toBeNull();
    expect(constraints[6]).toBeNull();
    expect(constraints[7]).toBeNull();
  });
});

// ── Region Border ────────────────────────────────────────────────────

describe('gatherConstraints – region border behavior', () => {
  it('forces region-border points to false when allowBorderConnections=false', () => {
    const layer = makeLayer('test', 0);
    // Region L0 bounds: x=[4,8], y=[4,8].
    // Cell (4,5): W (point 6) at L0 x=4 equals minX → at region border.
    const regionBoundsL0: RegionBoundsL0 = { minX: 4, minY: 4, maxX: 8, maxY: 8 };
    const constraints = gatherConstraints(4, 5, layer, [layer], false, regionBoundsL0);
    expect(constraints[6]).toBe(false); // W at region border
    expect(constraints[7]).toBe(false); // NW at region border (x=4)
    expect(constraints[5]).toBe(false); // SW at region border (x=4)
  });

  it('does not force interior points to false', () => {
    const layer = makeLayer('test', 0);
    const regionBoundsL0: RegionBoundsL0 = { minX: 4, minY: 4, maxX: 8, maxY: 8 };
    // Cell (5,5) is interior: all connection points are within (4,8) range.
    const constraints = gatherConstraints(5, 5, layer, [layer], false, regionBoundsL0);
    // Interior points should not be forced false by region border logic.
    // N (point 0) at (5.5, 5): within bounds → unconstrained (null).
    expect(constraints[0]).toBeNull();
    expect(constraints[2]).toBeNull();
    expect(constraints[4]).toBeNull();
    expect(constraints[6]).toBeNull();
  });

  it('allowBorderConnections=true ignores region bounds', () => {
    const layer = makeLayer('test', 0);
    const regionBoundsL0: RegionBoundsL0 = { minX: 4, minY: 4, maxX: 8, maxY: 8 };
    // Cell (4,5): W (point 6) at region border, but border connections allowed.
    const constraints = gatherConstraints(4, 5, layer, [layer], true, regionBoundsL0);
    expect(constraints[6]).toBeNull(); // not forced false
  });

  it('no regionBoundsL0 means only canvas border is checked', () => {
    const layer = makeLayer('test', 0);
    // Cell (4,5) with no region bounds: W at x=4 is interior to canvas → unconstrained.
    const constraints = gatherConstraints(4, 5, layer, [layer], false);
    expect(constraints[6]).toBeNull();
  });
});

// ── Custom Canvas Dimensions ─────────────────────────────────────────

describe('gatherConstraints – custom canvas dimensions', () => {
  it('forces border at x/y=16 on a 16×16 canvas', () => {
    const layer = makeLayer('test', 0);
    // Cell (15,10): E (point 2) at L0 x=16, S (point 4) at y=11 — E should be at border
    const constraints = gatherConstraints(15, 10, layer, [layer], false, undefined, 16, 16);
    expect(constraints[2]).toBe(false); // E at x=16 = canvasWidthL0
  });

  it('forces border at y=16 on a 16×16 canvas', () => {
    const layer = makeLayer('test', 0);
    // Cell (10,15): S (point 4) at L0 y=16 — should be at border
    const constraints = gatherConstraints(10, 15, layer, [layer], false, undefined, 16, 16);
    expect(constraints[4]).toBe(false); // S at y=16 = canvasHeightL0
  });

  it('interior cell on 16×16 canvas is unconstrained', () => {
    const layer = makeLayer('test', 0);
    // Cell (10,10) is well inside a 16×16 canvas
    const constraints = gatherConstraints(10, 10, layer, [layer], false, undefined, 16, 16);
    for (let p = 0; p < 8; p++) {
      expect(constraints[p]).toBeNull();
    }
  });

  it('default params (32) keep existing behavior', () => {
    const layer = makeLayer('test', 0);
    // Cell (31,15): E at x=32 is at the default 32-wide border
    const withDefault = gatherConstraints(31, 15, layer, [layer], false);
    const withExplicit = gatherConstraints(31, 15, layer, [layer], false, undefined, 32, 32);
    for (let p = 0; p < 8; p++) {
      expect(withDefault[p]).toBe(withExplicit[p]);
    }
  });

  it('does not force border at x=32 on a 64×64 canvas', () => {
    const layer = makeLayer('test', 0);
    // Cell (31,15): E at L0 x=32 — on a 64-wide canvas this is interior
    const constraints = gatherConstraints(31, 15, layer, [layer], false, undefined, 64, 64);
    // E (point 2) should NOT be forced false since 32 < 64
    expect(constraints[2]).toBeNull();
  });
});

// ── Non-Zero Canvas Origin ───────────────────────────────────────────

describe('gatherConstraints – non-zero canvas origin', () => {
  it('does not flag interior cell as border when canvas window is shifted', () => {
    const layer = makeLayer('test', 0);
    // Canvas window: 16×16 starting at L0 (8, 8) → spans [8, 24).
    // Cell (15, 12): its E point (2) is at L0 (16, 12.5), interior to [8, 24).
    const constraints = gatherConstraints(
      15, 12, layer, [layer], false,
      undefined, 16, 16, false, undefined, 8, 8,
    );
    expect(constraints[2]).toBeNull(); // E interior, not border
    expect(constraints[1]).toBeNull(); // NE interior
    expect(constraints[3]).toBeNull(); // SE interior
  });

  it('flags shifted-window left edge as border', () => {
    const layer = makeLayer('test', 0);
    // Canvas window: 16×16 starting at L0 (8, 8). Cell (8, 12)'s W point is at x=8 = origin.
    const constraints = gatherConstraints(
      8, 12, layer, [layer], false,
      undefined, 16, 16, false, undefined, 8, 8,
    );
    expect(constraints[6]).toBe(false); // W at canvas-window left edge
    expect(constraints[5]).toBe(false); // SW at left edge
    expect(constraints[7]).toBe(false); // NW at left edge
  });

  it('flags shifted-window right edge as border', () => {
    const layer = makeLayer('test', 0);
    // Canvas window: 16×16 at origin (8, 8) → right edge at x = 24.
    // Cell (23, 12)'s E (point 2) is at L0 x=24.
    const constraints = gatherConstraints(
      23, 12, layer, [layer], false,
      undefined, 16, 16, false, undefined, 8, 8,
    );
    expect(constraints[2]).toBe(false); // E at canvas-window right edge
  });

  it('flags shifted-window top edge as border', () => {
    const layer = makeLayer('test', 0);
    // Cell (12, 8) at canvas origin Y → N (point 0) at y=8 = originL0Y.
    const constraints = gatherConstraints(
      12, 8, layer, [layer], false,
      undefined, 16, 16, false, undefined, 8, 8,
    );
    expect(constraints[0]).toBe(false); // N at top edge
  });

  it('zero origin keeps legacy behavior identical', () => {
    const layer = makeLayer('test', 0);
    // Default origin (0,0) and explicit origin (0,0) must produce the same result.
    const defaultOrigin = gatherConstraints(
      0, 0, layer, [layer], false,
    );
    const explicitOrigin = gatherConstraints(
      0, 0, layer, [layer], false,
      undefined, 32, 32, false, undefined, 0, 0,
    );
    for (let p = 0; p < 8; p++) {
      expect(defaultOrigin[p]).toBe(explicitOrigin[p]);
    }
  });

  it('regression: cell outside upper-left quadrant is no longer wrongly flagged as border', () => {
    // Bug: when canvas origin moved from upper-left to a shifted position,
    // the border check assumed the canvas always sat at [0, width) × [0, height),
    // so every cell beyond the upper-left quadrant was treated as a border cell.
    const layer = makeLayer('test', 0);
    // 16×16 canvas at origin (8, 8): cell (20, 20) is interior to the canvas,
    // but with the old assumption (origin always 0) it would lie outside
    // the implicit 16×16 upper-left window and be wrongly forced to false.
    const constraints = gatherConstraints(
      20, 20, layer, [layer], false,
      undefined, 16, 16, false, undefined, 8, 8,
    );
    for (let p = 0; p < 8; p++) {
      expect(constraints[p]).toBeNull();
    }
  });
});

// ── Cross-Layer ──────────────────────────────────────────────────────

describe('gatherConstraints – cross-layer', () => {
  it('L0 cell constrained by adjacent L1 cell', () => {
    const l0 = makeLayer('l0', 0, 0);
    const l1 = makeLayer('l1', 1, 1);
    // L1 cell (0,0) spans L0 (0,0)-(1,1). Its E(point 2) maps to L0 coords (2, 1).
    l1.cells[0][0] = spriteCell('test/tile_00100000');
    // L0 cell (2, 0): its W(point 6) maps to L0 coords (2, 0.5).
    // But L1's E point is at (2, 1), not (2, 0.5).
    // The correct L0 cell whose W point aligns with L1's E at (2,1) is (2, 1):
    // W of (2,1) = (2, 1.5) — no, that's wrong.
    // W of L0 cell (cx,cy) = (cx, cy+0.5). We need cy+0.5 = 1, so cy=0.5 — not integer.
    // Actually, the L1 E point is at (2, 1). For an L0 cell to have a point there:
    // NE(1) of (1,1) = (2, 1) ✓  (corner point)
    // NW(7) of (2,1) = (2, 1) ✓  (corner point)
    // SE(3) of (1,0) = (2, 1) ✓  (corner point)
    // SW(5) of (2,0) = (2, 1) ✓  (corner point)
    // So the L1 E midpoint (2,1) is at a corner vertex for L0 cells, not a cardinal.
    // This is the cross-layer shared vertex case.
    // L0 cell (1,0) SE corner: (2,1). L1 cell E: (2,1) with value true.
    // That means 1 true at this vertex → constraint = true (needs reciprocation)
    const constraints = gatherConstraints(1, 0, l0, [l0, l1], true);
    expect(constraints[3]).toBe(true); // SE of (1,0) at vertex (2,1)
  });
});

// ── Filtering ────────────────────────────────────────────────────────

describe('filterCompatibleSprites', () => {
  it('returns all sprites when all constraints are null', () => {
    const constraints: (boolean | null)[] = [null, null, null, null, null, null, null, null];
    const result = filterCompatibleSprites(TEST_ENTRIES, constraints);
    expect(result.length).toBe(TEST_ENTRIES.length);
  });

  it('filters out incompatible sprites', () => {
    const constraints: (boolean | null)[] = [true, null, null, null, null, null, null, null];
    const result = filterCompatibleSprites(TEST_ENTRIES, constraints);
    expect(result.some((e) => e.id === 'test/tile_10101010')).toBe(true);
    expect(result.some((e) => e.id === 'test/tile_11111111')).toBe(true);
    expect(result.some((e) => e.id === 'test/tile_10001000')).toBe(true);
    expect(result.some((e) => e.id === 'test/tile_00000000')).toBe(false);
    expect(result.some((e) => e.id === 'test/tile_01010101')).toBe(false);
    expect(result.some((e) => e.id === 'test/unconstrained')).toBe(true);
  });

  it('filters with multiple constraints', () => {
    const constraints: (boolean | null)[] = [true, null, false, null, null, null, null, null];
    const result = filterCompatibleSprites(TEST_ENTRIES, constraints);
    expect(result.some((e) => e.id === 'test/tile_10101010')).toBe(false);
    expect(result.some((e) => e.id === 'test/tile_10001000')).toBe(true);
  });

  it('always includes unconstrained sprites', () => {
    const constraints: (boolean | null)[] = [true, true, true, true, true, true, true, true];
    const result = filterCompatibleSprites(TEST_ENTRIES, constraints);
    expect(result.some((e) => e.id === 'test/unconstrained')).toBe(true);
    expect(result.some((e) => e.id === 'test/tile_11111111')).toBe(true);
    expect(result.some((e) => e.id === 'test/tile_00000000')).toBe(false);
  });
});

// ── Integration: pickRandomCompatibleSprite ──────────────────────────

describe('pickRandomCompatibleSprite', () => {
  it('returns a sprite CellState', () => {
    const layer = makeLayer('test', 0);
    const result = pickRandomCompatibleSprite(5, 5, layer, [layer], true);
    expect(result).not.toBeNull();
    // The mock SPRITE_ENTRIES (via moduleNameMapper) has entries, so should return sprite
    expect(result!.type).toBe('sprite');
  });

  it('returns a compatible sprite when neighbors constrain', () => {
    const layer = makeLayer('test', 0);
    layer.cells[4][5] = spriteCell('test/tile_00001000'); // N neighbor S=true
    layer.cells[6][5] = spriteCell('test/tile_10000000'); // S neighbor N=true
    layer.cells[5][6] = spriteCell('test/tile_00000000'); // E neighbor W=false
    layer.cells[5][4] = spriteCell('test/tile_00000000'); // W neighbor E=false

    for (let i = 0; i < 20; i++) {
      const result = pickRandomCompatibleSprite(5, 5, layer, [layer], true);
      if (result && result.type === 'sprite') {
        const rendered = getRenderedSignature(result);
        if (rendered) {
          expect(rendered[0]).toBe(true);
          expect(rendered[4]).toBe(true);
          expect(rendered[2]).toBe(false);
          expect(rendered[6]).toBe(false);
        }
      }
    }
  });

  it('falls back when no compatible sprites exist', () => {
    const layer = makeLayer('test', 0);
    layer.cells[4][5] = spriteCell('test/tile_00001000');
    layer.cells[6][5] = spriteCell('test/tile_00000000');
    layer.cells[5][6] = spriteCell('test/tile_00000010');
    layer.cells[5][4] = spriteCell('test/tile_00000000');

    const result = pickRandomCompatibleSprite(5, 5, layer, [layer], true);
    expect(result).not.toBeNull();
  });

  it('fallback still respects cardinal constraints when no sprite matches all 8', () => {
    // tile_10000101: N=1, NE=0, E=0, SE=0, S=0, SW=1, W=0, NW=1
    // East neighbor (6,5) constraints: W(6)=false, SW(5)=false, NW(7)=false
    //
    // When the tile set has no sprite satisfying all 3 constraints simultaneously,
    // the fallback must still respect the cardinal W=false — never pick W=true.
    //
    // BUG: current fallback picks from ALL sprites, ignoring constraints entirely.

    // Temporarily replace SPRITE_ENTRIES with a set where no tile has SW=0,W=0,NW=0
    const saved = SPRITE_ENTRIES.splice(0, SPRITE_ENTRIES.length);
    SPRITE_ENTRIES.push(
      // W=0 but NW=1 → fails NW=false corner constraint
      { id: 'test/tile_10000001', label: 'tile_10000001', family: 'test', connectionCount: 2 },
      // W=0 but SW=1 → fails SW=false corner constraint
      { id: 'test/tile_00000100', label: 'tile_00000100', family: 'test', connectionCount: 1 },
      // W=1 → fails cardinal W=false constraint
      { id: 'test/tile_10101010', label: 'tile_10101010', family: 'test', connectionCount: 4 },
      { id: 'test/tile_01010101', label: 'tile_01010101', family: 'test', connectionCount: 4 },
    );

    try {
      const layer = makeLayer('test', 0);
      layer.cells[5][5] = spriteCell('test/tile_10000101');

      for (let i = 0; i < 50; i++) {
        const result = pickRandomCompatibleSprite(6, 5, layer, [layer], true);
        if (result && result.type === 'sprite') {
          const rendered = getRenderedSignature(result);
          if (rendered) {
            // Cardinal constraint: W(6) must be false (from source E=0)
            expect(rendered[6]).toBe(false);
          }
        }
      }
    } finally {
      SPRITE_ENTRIES.splice(0, SPRITE_ENTRIES.length);
      SPRITE_ENTRIES.push(...saved);
    }
  });
});

// ── Transform Test Helpers ─────────────────────────────────────────────

// Mirror maps for 8-point connection indices (N=0, NE=1, E=2, SE=3, S=4, SW=5, W=6, NW=7)
const MIRROR_H_MAP = [0, 7, 6, 5, 4, 3, 2, 1]; // swap 1↔7, 2↔6, 3↔5
const MIRROR_V_MAP = [4, 3, 2, 1, 0, 7, 6, 5]; // swap 0↔4, 1↔3, 5↔7

/**
 * Given a rendered connection point index and a transform, return the raw
 * signature index that maps to that rendered point.
 *
 * Inverse of render pipeline (render = rotate → mirrorH → mirrorV):
 *   un-mirrorV → un-mirrorH → un-rotate
 * Mirrors are self-inverse, so un-mirror = mirror.
 */
function transformPointToRaw(
  point: number,
  rotation: 0 | 90 | 180 | 270,
  mirrorH: boolean,
  mirrorV: boolean,
): number {
  let p = point;
  // Inverse order: un-rotate → un-mirrorH → un-mirrorV
  const unrotateOffset: Record<number, number> = { 0: 0, 90: 6, 180: 4, 270: 2 };
  p = (p + unrotateOffset[rotation]) % 8;
  if (mirrorH) p = MIRROR_H_MAP[p];
  if (mirrorV) p = MIRROR_V_MAP[p];
  return p;
}

/**
 * Compute the effective (rendered) connection signature for a sprite with a
 * given transform. Returns an 8-element boolean array indexed by rendered point.
 */
function getEffectiveSignature(
  spriteId: string,
  transform: { rotation: 0 | 90 | 180 | 270; mirrorH: boolean; mirrorV: boolean },
): boolean[] | null {
  const raw = parseConnectionSignature(spriteId);
  if (!raw) return null;
  return Array.from({ length: 8 }, (_, i) =>
    raw[transformPointToRaw(i, transform.rotation, transform.mirrorH, transform.mirrorV)],
  );
}

function spriteCellWithTransform(
  spriteId: string,
  rotation: 0 | 90 | 180 | 270 = 0,
  mirrorH = false,
  mirrorV = false,
): CellState {
  return { type: 'sprite', spriteId, transform: { rotation, mirrorH, mirrorV } };
}

// ── Transform Helper Self-Tests ─────────────────────────────────────────

// ── User's Bug Report (Identity Transform) ──────────────────────────────

describe('gatherConstraints – user bug report (identity transform)', () => {
  it('east neighbor of 11001101 must have W=false (sig[6]=0)', () => {
    // tile_11001101: N=1, NE=1, E=0, SE=0, S=1, SW=1, W=0, NW=1
    // E(point 2) = 0, so the east neighbor's W must be false
    const layer = makeLayer('test', 0);
    layer.cells[5][5] = spriteCell('test/tile_11001101');
    const constraints = gatherConstraints(6, 5, layer, [layer], true);
    // W of (6,5) = point 6. Neighbor (5,5)'s E = sig[2] = 0 → constraint = false
    expect(constraints[6]).toBe(false);
  });

  it('tile_10101010 should be rejected as east neighbor of 11001101', () => {
    // tile_10101010: W(point 6) = 1, but constraint for W is false
    const layer = makeLayer('test', 0);
    layer.cells[5][5] = spriteCell('test/tile_11001101');
    const constraints = gatherConstraints(6, 5, layer, [layer], true);
    const compatible = filterCompatibleSprites(TEST_ENTRIES, constraints);
    expect(compatible.some((e) => e.id === 'test/tile_10101010')).toBe(false);
  });
});

// ── Rotation Tests (expected to FAIL with current code) ──────────────────

describe('gatherConstraints – rotation transforms', () => {
  it('90° CW: tile_10100000 at (5,4) — S constraint for (5,5) should be true', () => {
    // tile_10100000: raw N=1, E=1
    // After 90° CW: rendered S = raw[(4+6)%8] = raw[2] = E = true
    // So (5,5)'s N constraint (looking at (5,4)'s S) should be true
    // BUG: code reads sig[4] = S = false → wrong
    const layer = makeLayer('test', 0);
    layer.cells[4][5] = spriteCellWithTransform('test/tile_10100000', 90);
    const constraints = gatherConstraints(5, 5, layer, [layer], true);
    expect(constraints[0]).toBe(true); // N of (5,5) = S of (5,4) after rotation
  });

  it('180°: tile_11000000 at (5,6) — N constraint for (5,5) should be false', () => {
    // tile_11000000: raw N=1, NE=1
    // After 180°: rendered N = raw[(0+4)%8] = raw[4] = S = false
    // So (5,5)'s S constraint (looking at (5,6)'s N) should be false
    // BUG: code reads sig[0] = N = true → wrong
    const layer = makeLayer('test', 0);
    layer.cells[6][5] = spriteCellWithTransform('test/tile_11000000', 180);
    const constraints = gatherConstraints(5, 5, layer, [layer], true);
    expect(constraints[4]).toBe(false); // S of (5,5) = N of (5,6) after rotation
  });

  it('270° CW: tile_00001010 at (6,5) — W constraint for (5,5) should be false', () => {
    // tile_00001010: raw S=1, W=1
    // After 270°: rendered W = raw[(6+2)%8] = raw[0] = N = false
    // So (5,5)'s E constraint (looking at (6,5)'s W) should be false
    // BUG: code reads sig[6] = W = true → wrong
    const layer = makeLayer('test', 0);
    layer.cells[5][6] = spriteCellWithTransform('test/tile_00001010', 270);
    const constraints = gatherConstraints(5, 5, layer, [layer], true);
    expect(constraints[2]).toBe(false); // E of (5,5) = W of (6,5) after rotation
  });

  it('90° CW: tile_10000000 at (5,4) — rendered S should be false', () => {
    // tile_10000000: raw N=1 only
    // After 90° CW: rendered S = raw[(4+6)%8] = raw[2] = E = false
    // So (5,5)'s N constraint should be false
    // NOTE: code reads sig[4] = false which happens to match — this is a control test
    const layer = makeLayer('test', 0);
    layer.cells[4][5] = spriteCellWithTransform('test/tile_10000000', 90);
    const constraints = gatherConstraints(5, 5, layer, [layer], true);
    expect(constraints[0]).toBe(false);
  });

  it('90° CW: all cardinal constraints verified for tile_10100000 at center', () => {
    // Place rotated tile_10100000 (raw N=1,E=1) at (5,5) with rotation=90
    // Effective: N=0, E=1, S=1, W=0
    // Check all four cardinal neighbors' constraints
    const layer = makeLayer('test', 0);
    layer.cells[5][5] = spriteCellWithTransform('test/tile_10100000', 90);

    // North neighbor (5,4): its S(4) looks at (5,5)'s N. Rendered N=false → S should be false
    const northConstraints = gatherConstraints(5, 4, layer, [layer], true);
    expect(northConstraints[4]).toBe(false);

    // East neighbor (6,5): its W(6) looks at (5,5)'s E. Rendered E=true → W should be true
    const eastConstraints = gatherConstraints(6, 5, layer, [layer], true);
    expect(eastConstraints[6]).toBe(true);

    // South neighbor (5,6): its N(0) looks at (5,5)'s S. Rendered S=true → N should be true
    const southConstraints = gatherConstraints(5, 6, layer, [layer], true);
    expect(southConstraints[0]).toBe(true);

    // West neighbor (4,5): its E(2) looks at (5,5)'s W. Rendered W=false → E should be false
    const westConstraints = gatherConstraints(4, 5, layer, [layer], true);
    expect(westConstraints[2]).toBe(false);
  });
});

// ── Mirror Tests (expected to FAIL with current code) ────────────────────

describe('gatherConstraints – mirror transforms', () => {
  it('mirrorH: tile_00100000 at (4,5) — E should be false after flip', () => {
    // tile_00100000: raw E=1 only
    // After mirrorH: rendered E = raw[MIRROR_H_MAP[2]] = raw[6] = W = false
    // So (5,5)'s W constraint (looking at (4,5)'s E) should be false
    // BUG: code reads sig[2] = E = true → wrong
    const layer = makeLayer('test', 0);
    layer.cells[5][4] = spriteCellWithTransform('test/tile_00100000', 0, true, false);
    const constraints = gatherConstraints(5, 5, layer, [layer], true);
    expect(constraints[6]).toBe(false); // W of (5,5) = E of (4,5) after mirrorH
  });

  it('mirrorV: tile_10000000 at (5,6) — N should be false after flip', () => {
    // tile_10000000: raw N=1 only
    // After mirrorV: rendered N = raw[MIRROR_V_MAP[0]] = raw[4] = S = false
    // So (5,5)'s S constraint (looking at (5,6)'s N) should be false
    // BUG: code reads sig[0] = N = true → wrong
    const layer = makeLayer('test', 0);
    layer.cells[6][5] = spriteCellWithTransform('test/tile_10000000', 0, false, true);
    const constraints = gatherConstraints(5, 5, layer, [layer], true);
    expect(constraints[4]).toBe(false); // S of (5,5) = N of (5,6) after mirrorV
  });

  it('mirrorH: all cardinal constraints verified for tile_10100000', () => {
    // tile_10100000: raw N=1, E=1
    // After mirrorH: rendered N=raw[0]=N=1, rendered E=raw[6]=W=0,
    //               rendered S=raw[4]=S=0, rendered W=raw[2]=E=1
    const layer = makeLayer('test', 0);
    layer.cells[5][5] = spriteCellWithTransform('test/tile_10100000', 0, true, false);

    const northConstraints = gatherConstraints(5, 4, layer, [layer], true);
    expect(northConstraints[4]).toBe(true); // S of north neighbor = N of center = true

    const eastConstraints = gatherConstraints(6, 5, layer, [layer], true);
    expect(eastConstraints[6]).toBe(false); // W of east neighbor = E of center = false

    const southConstraints = gatherConstraints(5, 6, layer, [layer], true);
    expect(southConstraints[0]).toBe(false); // N of south neighbor = S of center = false

    const westConstraints = gatherConstraints(4, 5, layer, [layer], true);
    expect(westConstraints[2]).toBe(true); // E of west neighbor = W of center = true
  });
});

// ── Combined Rotation + Mirror Tests (expected to FAIL) ──────────────────

describe('gatherConstraints – combined rotation + mirror', () => {
  it('90° + mirrorV: tile_10100000 at (5,4)', () => {
    // tile_10100000: raw N=1, E=1
    // Render pipeline: rotate 90° → mirrorV
    // Effective sig computed via getEffectiveSignature helper
    const transform = { rotation: 90 as const, mirrorH: false, mirrorV: true };
    const effective = getEffectiveSignature('test/tile_10100000', transform)!;

    const layer = makeLayer('test', 0);
    layer.cells[4][5] = spriteCellWithTransform('test/tile_10100000', 90, false, true);
    const constraints = gatherConstraints(5, 5, layer, [layer], true);

    // N of (5,5) = S of (5,4). Rendered S = effective[4]
    expect(constraints[0]).toBe(effective[4]);
  });

  it('180° + mirrorH: tile_10100000 at (6,5)', () => {
    const transform = { rotation: 180 as const, mirrorH: true, mirrorV: false };
    const effective = getEffectiveSignature('test/tile_10100000', transform)!;

    const layer = makeLayer('test', 0);
    layer.cells[5][6] = spriteCellWithTransform('test/tile_10100000', 180, true, false);
    const constraints = gatherConstraints(5, 5, layer, [layer], true);

    // E of (5,5) = W of (6,5). Rendered W = effective[6]
    expect(constraints[2]).toBe(effective[6]);
  });

  it('270° + mirrorH + mirrorV: tile_10100000 at (5,6)', () => {
    const transform = { rotation: 270 as const, mirrorH: true, mirrorV: true };
    const effective = getEffectiveSignature('test/tile_10100000', transform)!;

    const layer = makeLayer('test', 0);
    layer.cells[6][5] = spriteCellWithTransform('test/tile_10100000', 270, true, true);
    const constraints = gatherConstraints(5, 5, layer, [layer], true);

    // S of (5,5) = N of (5,6). Rendered N = effective[0]
    expect(constraints[4]).toBe(effective[0]);
  });
});

// ── Cross-Layer with Transforms (expected to FAIL) ───────────────────────

describe('gatherConstraints – cross-layer with transforms', () => {
  it('L1 tile with 180° rotation affects L0 constraints correctly', () => {
    // L1 cell (0,0): tile_00100000 (raw E=1 only) with rotation=180
    // After 180°: rendered E = raw[(2+4)%8] = raw[6] = W = false
    // L1 E point at L0 (2,1). This is a corner vertex for L0 cells.
    // With rendered E=false, any L0 cell sharing that vertex should see false.
    // BUG: code reads sig[2] = E = true → wrong
    const l0 = makeLayer('l0', 0, 0);
    const l1 = makeLayer('l1', 1, 1);
    l1.cells[0][0] = spriteCellWithTransform('test/tile_00100000', 180);

    // L0 cell (1,0) SE corner = (2,1) = L1 E point
    const constraints = gatherConstraints(1, 0, l0, [l0, l1], true);
    // With correct transform: L1 E=false → only 0 trues at vertex → all false
    expect(constraints[3]).toBe(false); // SE of (1,0)
  });
});

// ── Cross-Layer Blocking (L0 points between L1 connection points) ─────────

describe('gatherConstraints – cross-layer edge blocking', () => {
  // L1 cell (0,0) spans L0 (0,0)-(1,1). East edge at x=2 has L1 connection
  // points at NE(2,0), E(2,1), SE(2,2). Two L0 cells are to the east:
  // (2,0) and (2,1). Their W(6) points fall at (2,0.5) and (2,1.5) — positions
  // on the L1 edge with NO L1 connection point. These must be forced false.

  it('L0 NE neighbor W(6) blocked by L1 east edge at non-connection-point', () => {
    // L1 tile_11111111 at (0,0): all connections true.
    // L0 cell (2,0) W(6) at L0 coords (2, 0.5): no L1 connection point here.
    // Constraint must be false — the L1 edge is solid wall at this position.
    const l0 = makeLayer('l0', 0, 0);
    const l1 = makeLayer('l1', 1, 1);
    l1.cells[0][0] = spriteCell('test/tile_11111111');
    const constraints = gatherConstraints(2, 0, l0, [l0, l1], true);
    expect(constraints[6]).toBe(false); // W must be false — blocked by L1 edge
  });

  it('L0 SE neighbor W(6) blocked by L1 east edge at non-connection-point', () => {
    // Same L1 tile. L0 cell (2,1) W(6) at L0 coords (2, 1.5): no L1 point.
    const l0 = makeLayer('l0', 0, 0);
    const l1 = makeLayer('l1', 1, 1);
    l1.cells[0][0] = spriteCell('test/tile_11111111');
    const constraints = gatherConstraints(2, 1, l0, [l0, l1], true);
    expect(constraints[6]).toBe(false); // W blocked
  });

  it('L0 points AT L1 connection points are NOT blocked', () => {
    // L1 tile_00100000 (E=1) at (0,0). L1 E at L0 (2,1).
    // L0 cell (2,0) SW(5) at (2,1): this IS an L1 connection point (E).
    // Should see L1 E=true, NOT be blocked.
    const l0 = makeLayer('l0', 0, 0);
    const l1 = makeLayer('l1', 1, 1);
    l1.cells[0][0] = spriteCell('test/tile_00100000');
    const constraints = gatherConstraints(2, 0, l0, [l0, l1], true);
    expect(constraints[5]).toBe(true); // SW = L1 E = true (not blocked)
    expect(constraints[6]).toBe(false); // W at (2,0.5) blocked (no L1 point)
    expect(constraints[7]).toBe(false); // NW at (2,0) = L1 NE = false
  });

  it('L0 north edge of L1 cell also blocks non-connection-points', () => {
    // L1 tile_11111111 at (0,0). North edge at y=0 from x=0 to x=2.
    // L0 cell (0,0) N(0) at (0.5, 0): no L1 connection point at x=0.5
    // (L1 N is at x=1, NW at x=0, NE at x=2).
    // But L0 (0,0) is INSIDE the L1 cell area... need a cell above the L1 cell.
    // L0 cell (0, -1) doesn't exist. Use a different geometry.
    // L1 cell (0,1). North edge at y=2. L0 cell (0,2) S(4) at (0.5, 2).
    // Wait, that's at L1 NW+S boundary... let me think.
    // L1 cell (0,1): spans L0 (0,2)-(1,3). North edge at y=2.
    // L0 cell (0,1) S(4) at (0.5, 2): L1 N is at (1, 2). 0.5 ≠ 1 → blocked.
    const l0 = makeLayer('l0', 0, 0);
    const l1 = makeLayer('l1', 1, 1);
    l1.cells[1][0] = spriteCell('test/tile_11111111');
    const constraints = gatherConstraints(0, 1, l0, [l0, l1], true);
    expect(constraints[4]).toBe(false); // S at (0.5, 2) blocked by L1 N edge
  });

  it('blocking works with L1 tile that has partial connections', () => {
    // L1 tile_10100000 (N=1, E=1) at (0,0).
    // L0 cell (2,0): W(6) at (2, 0.5) blocked (no L1 point) → false
    // L0 cell (2,0): SW(5) at (2, 1) = L1 E = true → true
    // L0 cell (2,0): NW(7) at (2, 0) = L1 NE = false → false
    const l0 = makeLayer('l0', 0, 0);
    const l1 = makeLayer('l1', 1, 1);
    l1.cells[0][0] = spriteCell('test/tile_10100000');
    const constraints = gatherConstraints(2, 0, l0, [l0, l1], true);
    expect(constraints[6]).toBe(false); // W blocked
    expect(constraints[5]).toBe(true);  // SW = L1 E = true
    expect(constraints[7]).toBe(false); // NW = L1 NE = false
  });
});

// ── User Bug Report: 01110111 east neighbor 00010101 ─────────────────────

describe('gatherConstraints – 01110111 east neighbor must match *****111', () => {
  it('east neighbor of 01110111 must have W=true, SW=true, NW=true', () => {
    // tile_01110111: N=0, NE=1, E=1, SE=1, S=0, SW=1, W=1, NW=1
    // East neighbor sees: W constraint = E of source = sig[2] = 1 → true
    // Plus corner constraints from SE and NE
    const layer = makeLayer('test', 0);
    layer.cells[5][5] = spriteCell('test/tile_01110111');
    const constraints = gatherConstraints(6, 5, layer, [layer], true);
    // W(6) of east neighbor = E(2) of (5,5) = true
    expect(constraints[6]).toBe(true);
  });

  it('tile_00010101 must be rejected as east neighbor of 01110111', () => {
    // tile_00010101: N=0, NE=0, E=0, SE=1, S=0, SW=1, W=0, NW=1
    // W(6) = 0, but constraint requires W=true → incompatible
    const layer = makeLayer('test', 0);
    layer.cells[5][5] = spriteCell('test/tile_01110111');
    const constraints = gatherConstraints(6, 5, layer, [layer], true);
    // Manually check: tile_00010101 sig[6]=0 but constraint[6]=true
    const sig00010101 = [false, false, false, true, false, true, false, true];
    for (let i = 0; i < 8; i++) {
      if (constraints[i] !== null && sig00010101[i] !== constraints[i]) {
        // Found incompatibility — test passes concept, now verify via filter
        break;
      }
    }
    // Add 00010101 to entries for filtering
    const entries: SpriteEntry[] = [
      ...TEST_ENTRIES,
      { id: 'test/tile_00010101', label: 'tile_00010101', family: 'test', connectionCount: 3 },
    ];
    const compatible = filterCompatibleSprites(entries, constraints);
    expect(compatible.some((e) => e.id === 'test/tile_00010101')).toBe(false);
  });

  it('east neighbor with rotation: 01110111 rotated 90° then check east', () => {
    // tile_01110111 with rotation=90: raw 01110111
    // Effective after 90° CW:
    //   rendered[i] = raw[(i+6)%8]
    //   rendered: raw[6]=W=1, raw[7]=NW=1, raw[0]=N=0, raw[1]=NE=1,
    //             raw[2]=E=1, raw[3]=SE=1, raw[4]=S=0, raw[5]=SW=1
    //   = [1, 1, 0, 1, 1, 1, 0, 1] → effective E(2) = 0
    // So east neighbor's W constraint should be false
    // BUG: code reads raw sig[2] = E = 1 → true (wrong!)
    const layer = makeLayer('test', 0);
    layer.cells[5][5] = spriteCellWithTransform('test/tile_01110111', 90);
    const constraints = gatherConstraints(6, 5, layer, [layer], true);
    // With correct transform handling, rendered E=0 → east neighbor W should be false
    expect(constraints[6]).toBe(false);
  });
});

// ── User Bug Report: 10000101 east neighbor 10101010 ─────────────────────

describe('gatherConstraints – 10000101 east neighbor must be *****000', () => {
  // tile_10000101: N=1, NE=0, E=0, SE=0, S=0, SW=1, W=0, NW=1
  // East neighbor constraints:
  //   W(6)  = E(2) of source = 0 → false (cardinal)
  //   SW(5) = corner vertex: source SE(3)=0 → 1 occupied, 0 true → false
  //   NW(7) = corner vertex: source NE(1)=0 → 1 occupied, 0 true → false
  // So constraints = [null, null, null, null, null, false, false, false]

  it('identity: east neighbor constraints are *****000', () => {
    const layer = makeLayer('test', 0);
    layer.cells[5][5] = spriteCell('test/tile_10000101');
    const constraints = gatherConstraints(6, 5, layer, [layer], true);
    expect(constraints[5]).toBe(false); // SW
    expect(constraints[6]).toBe(false); // W
    expect(constraints[7]).toBe(false); // NW
  });

  it('identity: tile_10101010 rejected as east neighbor of 10000101', () => {
    // tile_10101010: W(6)=1, violates W=false constraint
    const layer = makeLayer('test', 0);
    layer.cells[5][5] = spriteCell('test/tile_10000101');
    const constraints = gatherConstraints(6, 5, layer, [layer], true);
    const entries: SpriteEntry[] = [
      ...TEST_ENTRIES,
      { id: 'test/tile_10000101', label: 'tile_10000101', family: 'test', connectionCount: 3 },
    ];
    const compatible = filterCompatibleSprites(entries, constraints);
    expect(compatible.some((e) => e.id === 'test/tile_10101010')).toBe(false);
  });

  it('rotated source: 10000101 at 90° makes effective E=SW=1, east neighbor W must be true', () => {
    // raw 10000101 rotated 90° CW:
    //   rendered[i] = raw[(i+6)%8]
    //   = [raw[6]=0, raw[7]=1, raw[0]=1, raw[1]=0, raw[2]=0, raw[3]=0, raw[4]=0, raw[5]=1]
    //   = 01100001 → effective E(2)=1
    // East neighbor W constraint should now be true (not false)
    const layer = makeLayer('test', 0);
    layer.cells[5][5] = spriteCellWithTransform('test/tile_10000101', 90);
    const constraints = gatherConstraints(6, 5, layer, [layer], true);
    expect(constraints[6]).toBe(true); // W must match effective E=1
  });

  it('rotated source 90°: tile_10101010 still rejected (NW mismatch)', () => {
    // After 90° rotation, effective = 01100001:
    //   E=1 → W constraint=true, NE=1 → NW constraint=true, SE=0 → SW constraint=false
    // tile_10101010: W(6)=1 ✓, NW(7)=0 ✗ → still rejected
    const layer = makeLayer('test', 0);
    layer.cells[5][5] = spriteCellWithTransform('test/tile_10000101', 90);
    const constraints = gatherConstraints(6, 5, layer, [layer], true);
    expect(constraints[6]).toBe(true);  // W (effective E=1)
    expect(constraints[7]).toBe(true);  // NW (effective NE=1, 1 true → reciprocate)
    expect(constraints[5]).toBe(false); // SW (effective SE=0, 1 occupied 0 true → false)
    const compatible = filterCompatibleSprites(TEST_ENTRIES, constraints);
    expect(compatible.some((e) => e.id === 'test/tile_10101010')).toBe(false);
  });

  it('mirrorH source: 10000101 with mirrorH, east neighbor constraints change', () => {
    // raw 10000101 with mirrorH:
    //   MIRROR_H_MAP = [0,7,6,5,4,3,2,1]
    //   rendered[i] = raw[MIRROR_H_MAP[i]]
    //   = [raw[0]=1, raw[7]=1, raw[6]=0, raw[5]=1, raw[4]=0, raw[3]=0, raw[2]=0, raw[1]=0]
    //   = 11010000 → effective E(2)=0, NE(1)=1, SE(3)=1
    // East neighbor:
    //   W(6) = effective E = 0 → false
    //   NW(7): source NE(1) effective = 1 → 1 true → constraint = true
    //   SW(5): source SE(3) effective = 1 → 1 true → constraint = true
    const layer = makeLayer('test', 0);
    layer.cells[5][5] = spriteCellWithTransform('test/tile_10000101', 0, true, false);
    const constraints = gatherConstraints(6, 5, layer, [layer], true);
    expect(constraints[6]).toBe(false); // W
    expect(constraints[7]).toBe(true);  // NW (effective NE=1)
    expect(constraints[5]).toBe(true);  // SW (effective SE=1)
  });
});

// ── Combined Rotation+Mirror: getRenderedSignature verification ──────────

describe('getRenderedSignature – combined rotation+mirror', () => {
  it('rotation=270, mirrorH=true on tile_10000101 → [0,1,0,0,0,0,1,1]', () => {
    const cell = spriteCellWithTransform('test/tile_10000101', 270, true, false);
    const rendered = getRenderedSignature(cell);
    expect(rendered).toEqual([false, true, false, false, false, false, true, true]);
  });

  it('rotation=90, mirrorH=true on tile_10100000 → expected combined result', () => {
    // raw: N=1, E=1. rotate 90 CW then mirrorH.
    // Use test helper to compute expected:
    const expected = getEffectiveSignature('test/tile_10100000', { rotation: 90, mirrorH: true, mirrorV: false });
    const cell = spriteCellWithTransform('test/tile_10100000', 90, true, false);
    const rendered = getRenderedSignature(cell);
    expect(rendered).toEqual(expected);
  });
});

// ── Combined Rotation+Mirror: constraint satisfaction ────────────────────

describe('pickRandomCompatibleSprite – combined rotation+mirror neighbor', () => {
  it('neighbor of combined-transform tile satisfies cardinal constraints', () => {
    const layer = makeLayer('test', 0);
    // Place tile_10000101 with rotation=270, mirrorH=true at (5,5)
    // rendered = [0,1,0,0,0,0,1,1] → E(2)=0
    layer.cells[5][5] = spriteCellWithTransform('test/tile_10000101', 270, true, false);

    // East neighbor (6,5) must have W=false (rendered E=0)
    const constraints = gatherConstraints(6, 5, layer, [layer], true);
    expect(constraints[6]).toBe(false);

    for (let i = 0; i < 30; i++) {
      const result = pickRandomCompatibleSprite(6, 5, layer, [layer], true);
      if (result && result.type === 'sprite') {
        const rendered = getRenderedSignature(result);
        if (rendered) {
          expect(rendered[6]).toBe(false); // W must be 0
        }
      }
    }
  });
});

// ── 2x2 Grid: 4th tile NW corner must respect shared vertex ──────────────

describe('pickRandomCompatibleSprite – 2x2 grid NW corner constraint', () => {
  it('4th tile NW corner must be 0 when all 3 neighbors are 0 at shared vertex', () => {
    // 2x2 grid:
    //   (0,0)=10000000  (1,0)=11101001
    //   (0,1)=00010001  (1,1)=?
    // Shared vertex at SE of (0,0), SW of (1,0), NE of (0,1), NW of (1,1):
    //   (0,0) SE=sig[3]=0, (1,0) SW=sig[5]=0, (0,1) NE=sig[1]=0
    //   → 3 occupied, 0 true → NW constraint for (1,1) must be false
    const layer = makeLayer('test', 0);
    layer.cells[0][0] = spriteCell('test/tile_10000000');
    layer.cells[0][1] = spriteCell('test/tile_11101001');
    layer.cells[1][0] = spriteCell('test/tile_00010001');

    // Verify constraint
    const constraints = gatherConstraints(1, 1, layer, [layer], true);
    expect(constraints[7]).toBe(false); // NW must be false

    // Random selection: NW must never be 1
    for (let i = 0; i < 50; i++) {
      const result = pickRandomCompatibleSprite(1, 1, layer, [layer], true);
      if (result && result.type === 'sprite') {
        const rendered = getRenderedSignature(result);
        if (rendered) {
          expect(rendered[7]).toBe(false); // NW must be 0
        }
      }
    }
  });
});

// ── mirrorCellState ─────────────────────────────────────────────────

describe('mirrorCellState', () => {
  it('returns non-sprite states unchanged', () => {
    expect(mirrorCellState(null as any, true, false, 0)).toBe(null);
    const colorState: CellState = { type: 'color', r: 255, g: 0, b: 0, transform: { ...DEFAULT_TRANSFORM } };
    expect(mirrorCellState(colorState, true, false, 0)).toBe(colorState);
  });

  it('negates rotation when mirrorH only (mH !== mV)', () => {
    const state: CellState = { type: 'sprite', spriteId: 'test/tile_10101010', transform: { rotation: 90, mirrorH: false, mirrorV: false } };
    const result = mirrorCellState(state, true, false, 0);
    expect(result).not.toBeNull();
    if (result && result.type === 'sprite') {
      expect(result.transform.mirrorH).toBe(true);
      expect(result.transform.mirrorV).toBe(false);
      expect(result.transform.rotation).toBe(270); // (360 - 90) % 360
    }
  });

  it('negates rotation when mirrorV only (mH !== mV)', () => {
    const state: CellState = { type: 'sprite', spriteId: 'test/tile_10101010', transform: { rotation: 90, mirrorH: false, mirrorV: false } };
    const result = mirrorCellState(state, false, true, 0);
    expect(result).not.toBeNull();
    if (result && result.type === 'sprite') {
      expect(result.transform.mirrorV).toBe(true);
      expect(result.transform.rotation).toBe(270);
    }
  });

  it('preserves rotation when both mirrorH and mirrorV (mH === mV)', () => {
    const state: CellState = { type: 'sprite', spriteId: 'test/tile_10101010', transform: { rotation: 90, mirrorH: false, mirrorV: false } };
    const result = mirrorCellState(state, true, true, 0);
    expect(result).not.toBeNull();
    if (result && result.type === 'sprite') {
      expect(result.transform.mirrorH).toBe(true);
      expect(result.transform.mirrorV).toBe(true);
      expect(result.transform.rotation).toBe(90); // preserved
    }
  });

  it('adds rotateOffset when rotateOffset != 0', () => {
    const state: CellState = { type: 'sprite', spriteId: 'test/tile_10101010', transform: { rotation: 90, mirrorH: false, mirrorV: false } };
    const result = mirrorCellState(state, false, false, 180);
    expect(result).not.toBeNull();
    if (result && result.type === 'sprite') {
      expect(result.transform.rotation).toBe(270); // (90 + 180) % 360
    }
  });

  it('wraps rotation past 360', () => {
    const state: CellState = { type: 'sprite', spriteId: 'test/tile_10101010', transform: { rotation: 270, mirrorH: false, mirrorV: false } };
    const result = mirrorCellState(state, false, false, 180);
    expect(result).not.toBeNull();
    if (result && result.type === 'sprite') {
      expect(result.transform.rotation).toBe(90); // (270 + 180) % 360
    }
  });

  it('XOR-composes with existing mirrorH: applying mirrorH to already-mirrored cancels', () => {
    const state: CellState = { type: 'sprite', spriteId: 'test/tile_10101010', transform: { rotation: 90, mirrorH: true, mirrorV: false } };
    const result = mirrorCellState(state, true, false, 0);
    expect(result).not.toBeNull();
    if (result && result.type === 'sprite') {
      // mirrorH XOR mirrorH = false (cancels)
      expect(result.transform.mirrorH).toBe(false);
      expect(result.transform.mirrorV).toBe(false);
      expect(result.transform.rotation).toBe(270); // rotation still negated because canvas mH !== mV
    }
  });

  it('XOR-composes with existing mirrorV: canvas mirrorH toggles H, keeps V', () => {
    const state: CellState = { type: 'sprite', spriteId: 'test/tile_10101010', transform: { rotation: 0, mirrorH: false, mirrorV: true } };
    const result = mirrorCellState(state, true, false, 0);
    expect(result).not.toBeNull();
    if (result && result.type === 'sprite') {
      expect(result.transform.mirrorH).toBe(true);   // false XOR true
      expect(result.transform.mirrorV).toBe(true);    // true XOR false (unchanged)
      expect(result.transform.rotation).toBe(0);      // (360-0)%360 = 0
    }
  });

  it('XOR-composes mirrorH+V on base with existing flags', () => {
    const state: CellState = { type: 'sprite', spriteId: 'test/tile_10101010', transform: { rotation: 90, mirrorH: true, mirrorV: false } };
    const result = mirrorCellState(state, true, true, 0);
    expect(result).not.toBeNull();
    if (result && result.type === 'sprite') {
      expect(result.transform.mirrorH).toBe(false);  // true XOR true
      expect(result.transform.mirrorV).toBe(true);   // false XOR true
      expect(result.transform.rotation).toBe(90);    // both canvas mirrors → rotation preserved
    }
  });

  it('rendered signature of mirrorH sprite is horizontally flipped', () => {
    // tile_10001000 = N, S connected (positions 0, 4)
    const state: CellState = { type: 'sprite', spriteId: 'test/tile_10001000', transform: { rotation: 0, mirrorH: false, mirrorV: false } };
    const mirrored = mirrorCellState(state, true, false, 0);
    const origSig = getRenderedSignature(state);
    const mirSig = getRenderedSignature(mirrored);
    // For mirrorH, E and W swap: sig[2]<->sig[6], sig[1]<->sig[7], sig[3]<->sig[5]
    // N(0) and S(4) stay the same
    if (origSig && mirSig) {
      expect(mirSig[0]).toBe(origSig[0]); // N
      expect(mirSig[4]).toBe(origSig[4]); // S
      expect(mirSig[2]).toBe(origSig[6]); // E <- W
      expect(mirSig[6]).toBe(origSig[2]); // W <- E
    }
  });
});

// ── Border Constraints ──────────────────────────────────────────────────

// Updated test entries including the new border-specific sprites
const BORDER_TEST_ENTRIES: SpriteEntry[] = [
  { id: 'test/tile_00000000', label: 'tile_00000000', family: 'test', connectionCount: 0 },
  { id: 'test/tile_11111111', label: 'tile_11111111', family: 'test', connectionCount: 8 },
  { id: 'test/tile_10101010', label: 'tile_10101010', family: 'test', connectionCount: 4 },
  { id: 'test/tile_01010101', label: 'tile_01010101', family: 'test', connectionCount: 4 },
  { id: 'test/tile_10001000', label: 'tile_10001000', family: 'test', connectionCount: 2 },
  { id: 'test/tile_00100010', label: 'tile_00100010', family: 'test', connectionCount: 2 },
  { id: 'test/unconstrained', label: 'unconstrained', family: 'test', connectionCount: 0 },
  { id: 'test/tile_10000010', label: 'tile_10000010', family: 'test', connectionCount: 2 },
  { id: 'test/tile_00001010', label: 'tile_00001010', family: 'test', connectionCount: 2 },
];

describe('gatherConstraints — border constraints override corner neighbors', () => {
  it('NE corner of (0,0) forced false even when neighbor (1,0) has NW=true', () => {
    const layer = makeLayer('test', 0);
    // tile_11111111 at (1,0) — NW (point 7) = true
    layer.cells[0][1] = spriteCell('test/tile_11111111');
    // (0,0) is top-left corner: NE (point 1) is at border (y=0)
    const constraints = gatherConstraints(0, 0, layer, [layer], false);
    expect(constraints[1]).toBe(false); // NE at border must be false
  });

  it('SE corner of east-border cell forced false even with neighbor sharing that corner', () => {
    const layer = makeLayer('test', 0);
    // tile_11111111 at (31,1) — SW (point 5) = true, shares SE corner of (31,0)
    layer.cells[1][31] = spriteCell('test/tile_11111111');
    const constraints = gatherConstraints(31, 0, layer, [layer], false);
    expect(constraints[3]).toBe(false); // SE at east border
  });

  it('SW corner of south-border cell forced false even with neighbor', () => {
    const layer = makeLayer('test', 0);
    // tile_11111111 at (0,31) — NE (point 1) = true, shares SW corner of (1,31)
    layer.cells[31][0] = spriteCell('test/tile_11111111');
    const constraints = gatherConstraints(1, 31, layer, [layer], false);
    expect(constraints[5]).toBe(false); // SW at south border
  });

  it('NW corner of west-border cell forced false even with neighbor', () => {
    const layer = makeLayer('test', 0);
    // tile_11111111 at (0,0) — SW (point 5) = true, shares NW corner of (0,1)
    layer.cells[0][0] = spriteCell('test/tile_11111111');
    const constraints = gatherConstraints(0, 1, layer, [layer], false);
    expect(constraints[7]).toBe(false); // NW at west border
  });
});

describe('border constraint patterns across grid levels', () => {
  const levels: (0 | 1 | 2 | 3 | 4)[] = [0, 1, 2, 3, 4];
  const COUNTS: Record<number, number> = { 0: 32, 1: 16, 2: 8, 3: 4, 4: 2 };

  for (const level of levels) {
    const count = COUNTS[level];
    const mid = Math.floor(count / 2);

    describe(`L${level} (${count}x${count})`, () => {
      it('top-edge middle cell: N, NE, NW are false', () => {
        const layer = makeLayer('test', level);
        const constraints = gatherConstraints(mid, 0, layer, [layer], false);
        expect(constraints[0]).toBe(false);  // N
        expect(constraints[1]).toBe(false);  // NE
        expect(constraints[7]).toBe(false);  // NW
      });

      it('east-edge middle cell: NE, E, SE are false', () => {
        const layer = makeLayer('test', level);
        const constraints = gatherConstraints(count - 1, mid, layer, [layer], false);
        expect(constraints[1]).toBe(false);  // NE
        expect(constraints[2]).toBe(false);  // E
        expect(constraints[3]).toBe(false);  // SE
      });

      it('south-edge middle cell: SE, S, SW are false', () => {
        const layer = makeLayer('test', level);
        const constraints = gatherConstraints(mid, count - 1, layer, [layer], false);
        expect(constraints[3]).toBe(false);  // SE
        expect(constraints[4]).toBe(false);  // S
        expect(constraints[5]).toBe(false);  // SW
      });

      it('west-edge middle cell: SW, W, NW are false', () => {
        const layer = makeLayer('test', level);
        const constraints = gatherConstraints(0, mid, layer, [layer], false);
        expect(constraints[5]).toBe(false);  // SW
        expect(constraints[6]).toBe(false);  // W
        expect(constraints[7]).toBe(false);  // NW
      });

      it('corner cell (0,0): N, NE, W, NW all false', () => {
        const layer = makeLayer('test', level);
        const constraints = gatherConstraints(0, 0, layer, [layer], false);
        expect(constraints[0]).toBe(false);  // N
        expect(constraints[1]).toBe(false);  // NE
        expect(constraints[6]).toBe(false);  // W
        expect(constraints[7]).toBe(false);  // NW
      });
    });
  }
});

describe('pickRandomCompatibleSprite respects border constraints', () => {
  const levelConfigs: { level: 0 | 1 | 2 | 3 | 4; count: number }[] = [
    { level: 0, count: 32 },
    { level: 2, count: 8 },
  ];

  for (const { level, count } of levelConfigs) {
    describe(`L${level}`, () => {
      // Border indices that must be false for each position type
      const positions: { name: string; x: number; y: number; falseBits: number[] }[] = [
        { name: 'top-edge', x: Math.floor(count / 2), y: 0, falseBits: [0, 1, 7] },
        { name: 'east-edge', x: count - 1, y: Math.floor(count / 2), falseBits: [1, 2, 3] },
        { name: 'south-edge', x: Math.floor(count / 2), y: count - 1, falseBits: [3, 4, 5] },
        { name: 'west-edge', x: 0, y: Math.floor(count / 2), falseBits: [5, 6, 7] },
        { name: 'top-left corner', x: 0, y: 0, falseBits: [0, 1, 6, 7] },
        { name: 'top-right corner', x: count - 1, y: 0, falseBits: [0, 1, 2, 3, 7] },
        { name: 'bottom-right corner', x: count - 1, y: count - 1, falseBits: [1, 2, 3, 4, 5] },
        { name: 'bottom-left corner', x: 0, y: count - 1, falseBits: [3, 4, 5, 6, 7] },
      ];

      for (const pos of positions) {
        it(`${pos.name} (${pos.x},${pos.y}): border points are false in picked sprite`, () => {
          const saved = SPRITE_ENTRIES.slice();
          SPRITE_ENTRIES.splice(0, SPRITE_ENTRIES.length);
          SPRITE_ENTRIES.push(...BORDER_TEST_ENTRIES);
          try {
            const layer = makeLayer('test', level);
            for (let i = 0; i < 10; i++) {
              const result = pickRandomCompatibleSprite(pos.x, pos.y, layer, [layer], false);
              if (result && result.type === 'sprite') {
                const rendered = getRenderedSignature(result);
                if (rendered) {
                  for (const bit of pos.falseBits) {
                    expect(rendered[bit]).toBe(false);
                  }
                }
              }
            }
          } finally {
            SPRITE_ENTRIES.splice(0, SPRITE_ENTRIES.length);
            SPRITE_ENTRIES.push(...saved);
          }
        });
      }
    });
  }
});

// ── treatEmptyAsFalse ────────────────────────────────────────────────

describe('gatherConstraints – treatEmptyAsFalse', () => {
  it('returns false (not null) for empty cardinal neighbors when treatEmptyAsFalse=true', () => {
    const layer = makeLayer('L0', 0);
    // Place a single tile at (5,5) — all neighbors are empty
    layer.cells[5][5] = spriteCell('test/tile_10101010');

    const constraints = gatherConstraints(5, 5, layer, [layer], true, undefined, 32, 32, true);

    // All 8 points face empty neighbors → should all be false, not null
    for (let p = 0; p < 8; p++) {
      expect(constraints[p]).toBe(false);
    }
  });

  it('returns null for empty cardinal neighbors when treatEmptyAsFalse=false (default)', () => {
    const layer = makeLayer('L0', 0);
    // Place a single tile at (5,5) — all neighbors are empty
    layer.cells[5][5] = spriteCell('test/tile_10101010');

    const constraints = gatherConstraints(5, 5, layer, [layer], true);

    // All 8 points face empty neighbors → should all be null (unconstrained)
    for (let p = 0; p < 8; p++) {
      expect(constraints[p]).toBeNull();
    }
  });

  it('occupied neighbors still constrain normally with treatEmptyAsFalse=true', () => {
    const layer = makeLayer('L0', 0);
    // (5,5) tile_10101010: N=1
    layer.cells[5][5] = spriteCell('test/tile_10101010');
    // (4,5) tile_00000000: S=0
    layer.cells[4][5] = spriteCell('test/tile_00000000');

    const constraints = gatherConstraints(5, 5, layer, [layer], true, undefined, 32, 32, true);

    // N (point 0): neighbor (4,5) has S=0 → constraint=false
    expect(constraints[0]).toBe(false);
    // E (point 2): no neighbor → treatEmptyAsFalse → false
    expect(constraints[2]).toBe(false);
  });
});

// ── Bitmask Signature Table ────────────────────────────────────────

describe('bitmask signature optimization', () => {
});

// ── Mirror Signature Lookup Tables ──────────────────────────────────

describe('ensureMirrorSigLookups', () => {
  it('builds 256-element lookup tables', () => {
    const { h, v } = ensureMirrorSigLookups();
    expect(h).toBeInstanceOf(Uint8Array);
    expect(v).toBeInstanceOf(Uint8Array);
    expect(h.length).toBe(256);
    expect(v.length).toBe(256);
  });

  it('maps 0 to 0 (no connections → no connections)', () => {
    const { h, v } = ensureMirrorSigLookups();
    expect(h[0]).toBe(0);
    expect(v[0]).toBe(0);
  });

  it('maps 0xFF to 0xFF (all connections → all connections)', () => {
    const { h, v } = ensureMirrorSigLookups();
    expect(h[0xFF]).toBe(0xFF);
    expect(v[0xFF]).toBe(0xFF);
  });

  it('H-mirror swaps E↔W (bits 2↔6) and NE↔NW, SE↔SW', () => {
    const { h } = ensureMirrorSigLookups();
    // Signature with only N (bit 0) set — N is on the H-mirror axis, should map to itself
    // MIRROR_H_MAP[0] = 0, so bit 0 → bit 0
    expect(h[1]).toBe(1);
    // Signature with only E (bit 2) set — should map to W (bit 6)
    // MIRROR_H_MAP[2] = 6
    expect(h[1 << 2]).toBe(1 << 6);
    // Signature with only W (bit 6) set — should map to E (bit 2)
    expect(h[1 << 6]).toBe(1 << 2);
  });

  it('V-mirror swaps N↔S (bits 0↔4) and NE↔SE, NW↔SW', () => {
    const { v } = ensureMirrorSigLookups();
    // Signature with only N (bit 0) set — should map to S (bit 4)
    // MIRROR_V_MAP[0] = 4
    expect(v[1]).toBe(1 << 4);
    // Signature with only S (bit 4) set — should map to N (bit 0)
    expect(v[1 << 4]).toBe(1);
  });

  it('H-symmetric signature maps to itself', () => {
    const { h } = ensureMirrorSigLookups();
    // 10101010 = N,E,S,W — symmetric about H axis
    // Bits: 0(N)=1, 1(NE)=0, 2(E)=1, 3(SE)=0, 4(S)=1, 5(SW)=0, 6(W)=1, 7(NW)=0
    const cardinals = (1 << 0) | (1 << 2) | (1 << 4) | (1 << 6); // 0b01010101 = 85
    expect(h[cardinals]).toBe(cardinals);
  });

  it('returns same object on repeated calls', () => {
    const first = ensureMirrorSigLookups();
    const second = ensureMirrorSigLookups();
    expect(first.h).toBe(second.h);
    expect(first.v).toBe(second.v);
  });
});

// ── renderedSigPacked ───────────────────────────────────────────────

describe('renderedSigPacked', () => {
  it('returns packed sig for a known sprite with default transform', () => {
    // tile_10101010 → bits 0,2,4,6 set = 0b01010101 = 85
    const sig = renderedSigPacked('test/tile_10101010', DEFAULT_TRANSFORM);
    expect(sig).toBe(85);
  });

  it('returns 0 for all-zeros sprite', () => {
    const sig = renderedSigPacked('test/tile_00000000', DEFAULT_TRANSFORM);
    expect(sig).toBe(0);
  });

  it('returns 0xFF for all-ones sprite', () => {
    const sig = renderedSigPacked('test/tile_11111111', DEFAULT_TRANSFORM);
    expect(sig).toBe(0xFF);
  });

  it('returns UNCONSTRAINED (0xFFFF) for unconstrained sprites', () => {
    const sig = renderedSigPacked('test/unconstrained', DEFAULT_TRANSFORM);
    expect(sig).toBe(0xFFFF);
  });
});

// ── pickRandomCompatibleSprite with symmetry ────────────────────────

describe('pickRandomCompatibleSprite with mirror symmetry', () => {
  it('with h-symmetry, picks only H-symmetric tiles', () => {
    // On an empty canvas with no constraints, all tiles are candidates.
    // With h-symmetry, only tiles whose rendered sig is H-symmetric should be chosen.
    const layer = makeLayer('test');
    const { h: hLookup } = ensureMirrorSigLookups();
    const results = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const state = pickRandomCompatibleSprite(0, 0, layer, [layer], true, undefined, undefined, 32, 32, undefined, { h: true, v: false, d1: false, d2: false });
      if (state && state.type === 'sprite') {
        const sig = renderedSigPacked(state.spriteId, state.transform);
        if (sig !== 0xFFFF) {
          expect(hLookup[sig]).toBe(sig);
        }
        results.add(state.spriteId);
      }
    }
    // Should have picked at least one sprite
    expect(results.size).toBeGreaterThan(0);
  });

  it('with v-symmetry, picks only V-symmetric tiles', () => {
    const layer = makeLayer('test');
    const { v: vLookup } = ensureMirrorSigLookups();
    for (let i = 0; i < 100; i++) {
      const state = pickRandomCompatibleSprite(0, 0, layer, [layer], true, undefined, undefined, 32, 32, undefined, { h: false, v: true, d1: false, d2: false });
      if (state && state.type === 'sprite') {
        const sig = renderedSigPacked(state.spriteId, state.transform);
        if (sig !== 0xFFFF) {
          expect(vLookup[sig]).toBe(sig);
        }
      }
    }
  });

  it('with both h+v symmetry, picks only doubly-symmetric tiles', () => {
    const layer = makeLayer('test');
    const { h: hLookup, v: vLookup } = ensureMirrorSigLookups();
    for (let i = 0; i < 100; i++) {
      const state = pickRandomCompatibleSprite(0, 0, layer, [layer], true, undefined, undefined, 32, 32, undefined, { h: true, v: true, d1: false, d2: false });
      if (state && state.type === 'sprite') {
        const sig = renderedSigPacked(state.spriteId, state.transform);
        if (sig !== 0xFFFF) {
          expect(hLookup[sig]).toBe(sig);
          expect(vLookup[sig]).toBe(sig);
        }
      }
    }
  });
});
