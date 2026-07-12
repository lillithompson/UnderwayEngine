import {
  gatherConstraints,
  getRenderedSignature,
  reconcileCanvas,
} from '../connectivity';
import { SPRITE_ENTRIES } from '../loadTile';
import { makeLayer } from './test-utils';
import { CellState, DEFAULT_TRANSFORM, CELL_COUNTS, GridLevel, Layer } from '../types';

// ── Helpers ─────────────────────────────────────────────────────────

function snapshotCells(layer: Layer): string {
  return JSON.stringify(layer.cells);
}

function spriteCell(spriteId: string, transform = { ...DEFAULT_TRANSFORM }): CellState {
  return { type: 'sprite', spriteId, transform };
}

/**
 * Assert that no occupied sprite cell on any visible layer has a mismatch
 * between its rendered signature and the constraints from its neighbors.
 */
function assertNoMismatches(layers: Layer[], allowBorderConnections: boolean) {
  for (const layer of layers) {
    if (!layer.visible) continue;
    const count = CELL_COUNTS[layer.level];
    for (let cy = 0; cy < count; cy++) {
      for (let cx = 0; cx < count; cx++) {
        const cell = layer.cells[cy][cx];
        if (!cell || cell.type !== 'sprite') continue;
        const sig = getRenderedSignature(cell);
        if (!sig) continue;
        const constraints = gatherConstraints(cx, cy, layer, layers, allowBorderConnections);
        for (let p = 0; p < 8; p++) {
          if (constraints[p] !== null && constraints[p] !== sig[p]) {
            fail(
              `Mismatch at layer=${layer.id} (${cx},${cy}) point=${p}: ` +
              `rendered=${sig[p]} constraint=${constraints[p]} ` +
              `spriteId=${(cell as any).spriteId}`,
            );
          }
        }
      }
    }
  }
}

// ── getRenderedSignature ────────────────────────────────────────────

describe('getRenderedSignature', () => {
  it('returns raw signature for identity transform', () => {
    // tile_10101010: N=1,NE=0,E=1,SE=0,S=1,SW=0,W=1,NW=0
    const cell = spriteCell('test/tile_10101010');
    expect(getRenderedSignature(cell)).toEqual(
      [true, false, true, false, true, false, true, false],
    );
  });

  it('90° rotation shifts points correctly', () => {
    // tile_10100000: raw = [1,0,1,0,0,0,0,0] (N=1,E=1)
    // 90° rotation: rendered point p → raw point (p+6)%8
    // rendered[0]=raw[6]=0, rendered[1]=raw[7]=0, rendered[2]=raw[0]=1,
    // rendered[3]=raw[1]=0, rendered[4]=raw[2]=1, rendered[5]=raw[3]=0,
    // rendered[6]=raw[4]=0, rendered[7]=raw[5]=0
    const cell = spriteCell('test/tile_10100000', {
      mirrorH: false, mirrorV: false, rotation: 90,
    });
    expect(getRenderedSignature(cell)).toEqual(
      [false, false, true, false, true, false, false, false],
    );
  });

  it('mirrorH swaps E/W sides', () => {
    // tile_10100000: raw = [1,0,1,0,0,0,0,0] (N=1,NE=0,E=1)
    // mirrorH: rendered point p → raw MIRROR_H_MAP[p]
    // MIRROR_H_MAP = [0,7,6,5,4,3,2,1]
    // rendered[0]=raw[0]=1, rendered[1]=raw[7]=0, rendered[2]=raw[6]=0,
    // rendered[3]=raw[5]=0, rendered[4]=raw[4]=0, rendered[5]=raw[3]=0,
    // rendered[6]=raw[2]=1, rendered[7]=raw[1]=0
    const cell = spriteCell('test/tile_10100000', {
      mirrorH: true, mirrorV: false, rotation: 0,
    });
    expect(getRenderedSignature(cell)).toEqual(
      [true, false, false, false, false, false, true, false],
    );
  });

  it('returns null for color cells', () => {
    const cell: CellState = { type: 'color', r: 255, g: 0, b: 0, transform: { ...DEFAULT_TRANSFORM } };
    expect(getRenderedSignature(cell)).toBeNull();
  });

  it('returns null for null cells', () => {
    expect(getRenderedSignature(null)).toBeNull();
  });

  it('returns null for unconstrained sprites', () => {
    const cell = spriteCell('test/unconstrained');
    expect(getRenderedSignature(cell)).toBeNull();
  });
});

// ── reconcileCanvas ─────────────────────────────────────────────────

// Numeric key helper matching the convention in reconcileCanvas:
// layerIndex * 4096 + cy * 64 + cx
function nk(layerIndex: number, cx: number, cy: number): number {
  return layerIndex * 4096 + cy * 64 + cx;
}

describe('reconcileCanvas', () => {
  it('basic cardinal mismatch', () => {
    const layer = makeLayer('L0', 0);
    // tile_10101010: N=1,NE=0,E=1,SE=0,S=1,SW=0,W=1,NW=0
    layer.cells[5][5] = spriteCell('test/tile_10101010');
    // tile_00000000: all false
    layer.cells[4][5] = spriteCell('test/tile_00000000');
    // Mismatch: (5,5) N=1 but (4,5) S=0

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 5, 5), 1); // newer — wins
    placementOrder.set(nk(0, 5, 4), 0); // older — loses

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder);
    expect(ops.length).toBeGreaterThan(0);

    // With treatEmptyAsFalse, tiles with connections facing empty cells also
    // get reconciled. The key invariant is no mismatches remain.
    assertNoMismatches(layers, true);
  });

  it('newer tile wins, older gets replaced', () => {
    const layer = makeLayer('L0', 0);
    // (5,5) has S=1 via tile_10101010
    layer.cells[5][5] = spriteCell('test/tile_10101010');
    // (6,5) has N=0 via tile_00000000 — mismatch on S(5,5)/N(6,5)
    layer.cells[6][5] = spriteCell('test/tile_00000000');

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 5, 5), 0); // older
    placementOrder.set(nk(0, 5, 6), 1); // newer — wins

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder);
    expect(ops.length).toBeGreaterThan(0);

    // (6,5) has higher ordinal, should be unchanged
    expect((layer.cells[6][5] as any).spriteId).toBe('test/tile_00000000');

    // (5,5) should have been replaced to match
    const replaced = layer.cells[5][5];
    expect(replaced).not.toBeNull();

    assertNoMismatches(layers, true);
  });

  it('locked layer tiles are never modified', () => {
    const lockedLayer = makeLayer('locked', 0, 0);
    lockedLayer.locked = true;
    lockedLayer.cells[5][5] = spriteCell('test/tile_10101010');
    const snapshot = snapshotCells(lockedLayer);

    const unlockedLayer = makeLayer('unlocked', 0, 1);
    unlockedLayer.cells[4][5] = spriteCell('test/tile_00000000');

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 5, 5), 0);
    placementOrder.set(nk(1, 5, 4), 1);

    const layers = [lockedLayer, unlockedLayer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder);

    expect(snapshotCells(lockedLayer)).toBe(snapshot);

    for (const op of ops) {
      if (op.op === 'cell') {
        expect(op.layerId).not.toBe('locked');
      }
    }
  });

  it('locked layer with same-layer mismatches is never modified', () => {
    const lockedLayer = makeLayer('locked', 0, 0);
    lockedLayer.locked = true;
    lockedLayer.cells[5][5] = spriteCell('test/tile_10101010');
    lockedLayer.cells[4][5] = spriteCell('test/tile_00000000');
    const snapshot = snapshotCells(lockedLayer);

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 5, 5), 1);
    placementOrder.set(nk(0, 5, 4), 0);

    const layers = [lockedLayer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder);

    expect(snapshotCells(lockedLayer)).toBe(snapshot);
    for (const op of ops) {
      if (op.op === 'cell') {
        expect(op.layerId).not.toBe('locked');
      }
    }
  });

  it('hidden layer tiles are never modified', () => {
    const hiddenLayer = makeLayer('hidden', 0, 0);
    hiddenLayer.visible = false;
    hiddenLayer.cells[5][5] = spriteCell('test/tile_10101010');
    hiddenLayer.cells[4][5] = spriteCell('test/tile_00000000');
    const snapshot = snapshotCells(hiddenLayer);

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 5, 5), 1);
    placementOrder.set(nk(0, 5, 4), 0);

    const layers = [hiddenLayer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder);

    expect(snapshotCells(hiddenLayer)).toBe(snapshot);
    for (const op of ops) {
      if (op.op === 'cell') {
        expect(op.layerId).not.toBe('hidden');
      }
    }
  });

  it('hidden layer does not contribute constraints', () => {
    const hiddenLayer = makeLayer('hidden', 0, 0);
    hiddenLayer.visible = false;
    hiddenLayer.cells[5][5] = spriteCell('test/tile_10101010');

    const visibleLayer = makeLayer('visible', 0, 1);
    visibleLayer.cells[4][5] = spriteCell('test/tile_00000000');

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 5, 5), 0);
    placementOrder.set(nk(1, 5, 4), 1);

    const layers = [hiddenLayer, visibleLayer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder);

    for (const op of ops) {
      if (op.op === 'cell') {
        expect(op.layerId).not.toBe('hidden');
      }
    }

    const constraints = gatherConstraints(5, 4, visibleLayer, layers, true);
    for (let p = 0; p < 8; p++) {
      if (constraints[p] !== null) {
        expect(constraints[p]).toBe(false);
      }
    }
  });

  it('locked + hidden layer is never modified', () => {
    const protectedLayer = makeLayer('protected', 0, 0);
    protectedLayer.locked = true;
    protectedLayer.visible = false;
    protectedLayer.cells[5][5] = spriteCell('test/tile_10101010');
    protectedLayer.cells[4][5] = spriteCell('test/tile_00000000');
    const snapshot = snapshotCells(protectedLayer);

    const normalLayer = makeLayer('normal', 0, 1);
    normalLayer.cells[5][5] = spriteCell('test/tile_00000000');

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 5, 5), 0);
    placementOrder.set(nk(0, 5, 4), 0);
    placementOrder.set(nk(1, 5, 5), 1);

    const layers = [protectedLayer, normalLayer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder);

    expect(snapshotCells(protectedLayer)).toBe(snapshot);
    for (const op of ops) {
      if (op.op === 'cell') {
        expect(op.layerId).not.toBe('protected');
      }
    }
  });

  it('already-matching canvas returns no ops', () => {
    const layer = makeLayer('L0', 0);
    // All tile_00000000 — no connections, no mismatches with allowBorderConnections=false
    layer.cells[5][5] = spriteCell('test/tile_00000000');
    layer.cells[5][6] = spriteCell('test/tile_00000000');
    layer.cells[6][5] = spriteCell('test/tile_00000000');

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, false, new Map());
    expect(ops).toEqual([]);

    assertNoMismatches(layers, false);
  });

  it('cascading fix — 3 tiles in a row', () => {
    const layer = makeLayer('L0', 0);
    // A at (5,5): E=1 via tile_10101010
    layer.cells[5][5] = spriteCell('test/tile_10101010');
    // B at (5,6): mismatch W with A, E mismatch with C
    layer.cells[5][6] = spriteCell('test/tile_00000000');
    // C at (5,7): W=0 via tile_00000000, mismatch with B.E
    layer.cells[5][7] = spriteCell('test/tile_10101010');

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 5, 5), 0); // oldest
    placementOrder.set(nk(0, 6, 5), 1);
    placementOrder.set(nk(0, 7, 5), 2); // newest — wins

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder);
    expect(ops.length).toBeGreaterThan(0);

    // C (highest ordinal) should stay — but only if ordinal keys match
    assertNoMismatches(layers, true);
  });

  it('corner vertex mismatch', () => {
    const layer = makeLayer('L0', 0);
    // (5,5): NE=0 via tile_10001000 [N=1,NE=0,E=0,SE=0,S=1,SW=0,W=0,NW=0]
    layer.cells[5][5] = spriteCell('test/tile_10001000');
    // (4,6): diagonal neighbor — SW point
    // tile_01010101 has [NE=1,SE=1,SW=1,NW=1] — SW=1
    layer.cells[4][6] = spriteCell('test/tile_01010101');

    // (5,5).NE at L0 = corner shared with (4,6).SW
    // (5,5) NE=0, (4,6) SW=1 — unmatched corner (1 true → must reciprocate)

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 5, 5), 1); // newer — wins
    placementOrder.set(nk(0, 6, 4), 0); // older — loses

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder);
    expect(ops.length).toBeGreaterThan(0);

    // With treatEmptyAsFalse, all connected edges facing empty are also
    // reconciled. The key invariant is no mismatches remain.
    assertNoMismatches(layers, true);
  });

  it('minimal change preserves unconstrained edges', () => {
    const layer = makeLayer('L0', 0);
    // tile_11111111: all connections true
    layer.cells[5][5] = spriteCell('test/tile_11111111');
    // North neighbor at (4,5): S=0 via tile_00000000
    layer.cells[4][5] = spriteCell('test/tile_00000000');

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 5, 5), 0); // older — gets fixed
    placementOrder.set(nk(0, 5, 4), 1); // newer — wins

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder);
    expect(ops.length).toBeGreaterThan(0);

    // The replacement should still match as many of the original's unconstrained points
    const replaced = layer.cells[5][5];
    expect(replaced).not.toBeNull();
    const sig = getRenderedSignature(replaced);
    // N point should now be false (to match neighbor's S=0)
    expect(sig![0]).toBe(false);
  });

  it('same family preferred', () => {
    // Temporarily replace SPRITE_ENTRIES with two families
    const saved = [...SPRITE_ENTRIES];
    SPRITE_ENTRIES.length = 0;
    SPRITE_ENTRIES.push(
      { id: 'alpha/tile_00000000', label: 'tile_00000000', family: 'alpha', connectionCount: 0 },
      { id: 'alpha/tile_10101010', label: 'tile_10101010', family: 'alpha', connectionCount: 4 },
      { id: 'beta/tile_00000000', label: 'tile_00000000', family: 'beta', connectionCount: 0 },
      { id: 'beta/tile_10101010', label: 'tile_10101010', family: 'beta', connectionCount: 4 },
    );

    try {
      const layer = makeLayer('L0', 0);
      // Place alpha family tile that will mismatch
      layer.cells[5][5] = spriteCell('alpha/tile_10101010');
      // Neighbor forces N=0
      layer.cells[4][5] = spriteCell('alpha/tile_00000000');

      const placementOrder = new Map<number, number>();
      placementOrder.set(nk(0, 5, 5), 0); // older — gets fixed
      placementOrder.set(nk(0, 5, 4), 1); // newer

      const layers = [layer];
      reconcileCanvas(layers, layers, true, placementOrder);

      const replaced = layer.cells[5][5];
      expect(replaced).not.toBeNull();
      // Should prefer alpha family
      expect((replaced as any).spriteId).toMatch(/^alpha\//);
    } finally {
      SPRITE_ENTRIES.length = 0;
      SPRITE_ENTRIES.push(...saved);
    }
  });

  it('transforms respected', () => {
    const layer = makeLayer('L0', 0);
    // tile_10100000 with rotation=90: rendered = [0,0,1,0,1,0,0,0] (E=1,S=1)
    layer.cells[5][5] = spriteCell('test/tile_10100000', {
      mirrorH: false, mirrorV: false, rotation: 90,
    });
    // S neighbor at (6,5): N=0 via tile_00000000 — mismatch with (5,5).S=1
    layer.cells[6][5] = spriteCell('test/tile_00000000');

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 5, 5), 1); // newer — wins
    placementOrder.set(nk(0, 5, 6), 0); // older — gets fixed

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder);
    expect(ops.length).toBeGreaterThan(0);

    // With treatEmptyAsFalse, tiles with connections facing empty cells are
    // also reconciled. The key invariant is no mismatches remain.
    assertNoMismatches(layers, true);
  });

  it('cross-layer mismatch', () => {
    const l0 = makeLayer('L0', 0, 0);
    const l1 = makeLayer('L1', 0, 1);

    // Shared vertex: place tiles that share an L0 point
    l0.cells[5][5] = spriteCell('test/tile_10101010'); // N=1,E=1,S=1,W=1
    l1.cells[4][5] = spriteCell('test/tile_00000000'); // all false — S=0 mismatches with l0 N=1

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 5, 5), 1); // newer — wins (L0 = index 0)
    placementOrder.set(nk(1, 5, 4), 0); // older (L1 = index 1)

    const layers = [l0, l1];
    const ops = reconcileCanvas(layers, layers, true, placementOrder);
    expect(ops.length).toBeGreaterThan(0);

    // With treatEmptyAsFalse, tiles with connections facing empty cells are
    // also reconciled. The key invariant is no mismatches remain.
    assertNoMismatches(layers, true);
  });

  it('empty canvas is a no-op', () => {
    const layer = makeLayer('L0', 0);
    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, new Map());
    expect(ops).toEqual([]);
  });

  // ── Mirror Tests ────────────────────────────────────────────────

  it('mirrorH — fix is mirrored horizontally', () => {
    const layer = makeLayer('L0', 0);
    const count = 32; // L0 = 32 cells
    const mirrorX = count - 1 - 5; // 26

    // Place a mismatch at (5,5): tile has N=1, neighbor at (4,5) has S=0
    layer.cells[5][5] = spriteCell('test/tile_10101010');
    layer.cells[4][5] = spriteCell('test/tile_00000000');
    // Also place tiles at mirror positions so mirror target is occupied
    layer.cells[5][mirrorX] = spriteCell('test/tile_10101010');
    layer.cells[4][mirrorX] = spriteCell('test/tile_00000000');

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 5, 5), 0); // older — gets fixed
    placementOrder.set(nk(0, 5, 4), 1); // newer — wins
    placementOrder.set(nk(0, mirrorX, 5), 0);
    placementOrder.set(nk(0, mirrorX, 4), 1);

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder, undefined,
      true, false, false, 32, 32);

    expect(ops.length).toBeGreaterThan(0);

    // Primary cell (5,5) was fixed
    const primaryReplacement = layer.cells[5][5];
    expect(primaryReplacement).not.toBeNull();

    // Mirror position: (count - 1 - 5, 5) = (26, 5) should also have been written
    const mirrorCell = layer.cells[5][mirrorX];
    expect(mirrorCell).not.toBeNull();

    // The mirror cell should have mirrorH transform
    if (mirrorCell && mirrorCell.type === 'sprite' && primaryReplacement && primaryReplacement.type === 'sprite') {
      expect(mirrorCell.spriteId).toBe(primaryReplacement.spriteId);
      expect(mirrorCell.transform.mirrorH).toBe(true);
    }
  });

  it('mirrorV — fix is mirrored vertically', () => {
    const layer = makeLayer('L0', 0);
    const count = 32;
    const mirrorY = count - 1 - 5; // 26

    layer.cells[5][5] = spriteCell('test/tile_10101010');
    layer.cells[4][5] = spriteCell('test/tile_00000000');
    // Also place tiles at mirror positions so mirror target is occupied
    layer.cells[mirrorY][5] = spriteCell('test/tile_10101010');
    layer.cells[mirrorY - 1][5] = spriteCell('test/tile_00000000');

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 5, 5), 0);
    placementOrder.set(nk(0, 5, 4), 1);
    placementOrder.set(nk(0, 5, mirrorY), 0);
    placementOrder.set(nk(0, 5, mirrorY - 1), 1);

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder, undefined,
      false, true, false, 32, 32);

    expect(ops.length).toBeGreaterThan(0);

    // Mirror position: (5, count - 1 - 5) = (5, 26)
    const mirrorCell = layer.cells[mirrorY][5];
    expect(mirrorCell).not.toBeNull();

    const primaryReplacement = layer.cells[5][5];
    if (mirrorCell && mirrorCell.type === 'sprite' && primaryReplacement && primaryReplacement.type === 'sprite') {
      expect(mirrorCell.spriteId).toBe(primaryReplacement.spriteId);
      expect(mirrorCell.transform.mirrorV).toBe(true);
    }
  });

  it('mirrorH + mirrorV — fix is mirrored in both axes', () => {
    const layer = makeLayer('L0', 0);
    const count = 32;
    const mx = count - 1 - 5; // 26

    layer.cells[5][5] = spriteCell('test/tile_10101010');
    layer.cells[4][5] = spriteCell('test/tile_00000000');
    // Place tiles at all mirror positions so they are occupied
    layer.cells[5][mx] = spriteCell('test/tile_10101010');
    layer.cells[4][mx] = spriteCell('test/tile_00000000');
    layer.cells[mx][5] = spriteCell('test/tile_10101010');
    layer.cells[mx - 1][5] = spriteCell('test/tile_00000000');
    layer.cells[mx][mx] = spriteCell('test/tile_10101010');
    layer.cells[mx - 1][mx] = spriteCell('test/tile_00000000');

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 5, 5), 0);
    placementOrder.set(nk(0, 5, 4), 1);
    placementOrder.set(nk(0, mx, 5), 0);
    placementOrder.set(nk(0, mx, 4), 1);
    placementOrder.set(nk(0, 5, mx), 0);
    placementOrder.set(nk(0, 5, mx - 1), 1);
    placementOrder.set(nk(0, mx, mx), 0);
    placementOrder.set(nk(0, mx, mx - 1), 1);

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder, undefined,
      true, true, false, 32, 32);

    expect(ops.length).toBeGreaterThan(0);

    // Should have mirror ops at 3 positions: H, V, H+V
    const mirrorHCell = layer.cells[5][mx];
    const mirrorVCell = layer.cells[mx][5];
    const mirrorHVCell = layer.cells[mx][mx];

    expect(mirrorHCell).not.toBeNull();
    expect(mirrorVCell).not.toBeNull();
    expect(mirrorHVCell).not.toBeNull();
  });

  it('mirrorRotate — fix is rotated 4-fold', () => {
    const layer = makeLayer('L0', 0);

    // Place tiles at all 4-fold rotation positions so targets are occupied
    // Primary (5,5), 90° (26,5), 180° (26,26), 270° (5,26)
    layer.cells[5][5] = spriteCell('test/tile_10101010');
    layer.cells[4][5] = spriteCell('test/tile_00000000');
    layer.cells[5][26] = spriteCell('test/tile_10101010');
    layer.cells[4][26] = spriteCell('test/tile_00000000');
    layer.cells[26][26] = spriteCell('test/tile_10101010');
    layer.cells[26][5] = spriteCell('test/tile_10101010');

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 5, 5), 0);
    placementOrder.set(nk(0, 5, 4), 1);
    placementOrder.set(nk(0, 26, 5), 0);
    placementOrder.set(nk(0, 26, 4), 1);
    placementOrder.set(nk(0, 26, 26), 0);
    placementOrder.set(nk(0, 5, 26), 0);

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder, undefined,
      false, false, true, 32, 32);

    expect(ops.length).toBeGreaterThan(0);

    // Should have written 90°, 180°, 270° rotated copies
    // Verify at least 3 mirror ops were created (primary + 3 rotations = 4 total cells)
    const cellOps = ops.filter(op => op.op === 'cell');
    expect(cellOps.length).toBeGreaterThanOrEqual(4);
  });

  it('mirror does not overwrite cells handled by earlier fix', () => {
    const layer = makeLayer('L0', 0);
    const count = 32;

    // Place mismatches at both (5,5) and its horizontal mirror (26,5)
    layer.cells[5][5] = spriteCell('test/tile_10101010');
    layer.cells[4][5] = spriteCell('test/tile_00000000');
    layer.cells[5][count - 1 - 5] = spriteCell('test/tile_10101010');
    layer.cells[4][count - 1 - 5] = spriteCell('test/tile_00000000');

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 5, 5), 0);
    placementOrder.set(nk(0, 5, 4), 1);
    placementOrder.set(nk(0, count - 1 - 5, 5), 0);
    placementOrder.set(nk(0, count - 1 - 5, 4), 1);

    const layers = [layer];
    // With mirrorH, fixing (5,5) should also mirror to (26,5),
    // and (26,5) should not be processed again independently
    const ops = reconcileCanvas(layers, layers, true, placementOrder, undefined,
      true, false, false, 32, 32);

    // Count how many times each position appears in ops
    const posCount = new Map<string, number>();
    for (const op of ops) {
      if (op.op === 'cell') {
        const key = `${op.cellX},${op.cellY}`;
        posCount.set(key, (posCount.get(key) ?? 0) + 1);
      }
    }

    // Each position should appear at most once per pass
    for (const [, c] of posCount) {
      expect(c).toBe(1);
    }
  });

  it('empty cells force false constraints during reconcile', () => {
    const layer = makeLayer('L0', 0);
    // tile_10101010 has connections on all cardinal edges.
    // With treatEmptyAsFalse, empty neighbors force those edges to false,
    // creating mismatches that reconcile must fix.
    layer.cells[5][5] = spriteCell('test/tile_10101010');

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 5, 5), 0);

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder);

    // The tile has connections facing empty cells, so reconcile must replace it
    expect(ops.length).toBeGreaterThan(0);

    // After reconcile, the tile should have no connections facing empty cells
    const result = layer.cells[5][5];
    const sig = getRenderedSignature(result);
    if (sig) {
      // All edges face empty → all should be false
      for (let p = 0; p < 8; p++) {
        expect(sig[p]).toBe(false);
      }
    }
  });

  it('tile_00000000 is stable when surrounded by empty cells', () => {
    const layer = makeLayer('L0', 0);
    // tile_00000000 has no connections — matches empty neighbors' forced-false
    layer.cells[5][5] = spriteCell('test/tile_00000000');

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 5, 5), 0);

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder);

    // No mismatch — tile_00000000 is already compatible with all-false constraints
    expect(ops).toEqual([]);
    expect((layer.cells[5][5] as any).spriteId).toBe('test/tile_00000000');
  });

  // ── Mirror Correctness ───────────────────────────────────────────

  it('mirrorH — empty mirror partner is populated with mirrored fix', () => {
    // Bug fix: previously reconcile skipped writing to empty mirror partner positions,
    // leaving the canvas asymmetric under the active mirror.
    const layer = makeLayer('L0', 0);
    const count = 32;
    const mirrorX = count - 1 - 5; // 26

    // Mismatched primary at (5,5); its mirror partner (26,5) is left empty.
    layer.cells[5][5] = spriteCell('test/tile_10101010');
    layer.cells[4][5] = spriteCell('test/tile_00000000');

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 5, 5), 0);
    placementOrder.set(nk(0, 5, 4), 1);

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder, undefined,
      true, false, false, 32, 32);

    expect(ops.length).toBeGreaterThan(0);

    const mirrorCell = layer.cells[5][mirrorX];
    expect(mirrorCell).not.toBeNull();

    const primaryReplacement = layer.cells[5][5];
    if (mirrorCell && mirrorCell.type === 'sprite' && primaryReplacement && primaryReplacement.type === 'sprite') {
      expect(mirrorCell.spriteId).toBe(primaryReplacement.spriteId);
      expect(mirrorCell.transform.mirrorH).toBe(true);
    }

    // Op for mirror partner should record its previous empty state.
    const mirrorOp = ops.find(op => op.op === 'cell' && op.cellX === mirrorX && op.cellY === 5);
    expect(mirrorOp).toBeDefined();
    if (mirrorOp && mirrorOp.op === 'cell') {
      expect(mirrorOp.oldState).toBeNull();
      expect(mirrorOp.newState).not.toBeNull();
    }
  });

  it('mirrorH — partner-equality guard suppresses no-op rewrite on second reconcile', () => {
    // A reconciled canvas should be a fixed point of reconcileCanvas: a second
    // pass against the same state must produce no ops. Without the partner-equality
    // guard, the new "always run partner writes" path would push redundant cell
    // ops every pass and burn the MAX_PASSES budget on identical writes.
    const layer = makeLayer('L0', 0);
    const count = 32;
    const mirrorX = count - 1 - 5;

    layer.cells[5][5] = spriteCell('test/tile_10101010');
    layer.cells[4][5] = spriteCell('test/tile_00000000');

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 5, 5), 0);
    placementOrder.set(nk(0, 5, 4), 1);

    const layers = [layer];
    // First pass: produces fixes (primary + mirror partner population).
    const firstOps = reconcileCanvas(layers, layers, true, placementOrder, undefined,
      true, false, false, 32, 32);
    expect(firstOps.length).toBeGreaterThan(0);
    // Canvas is now symmetric under mirrorH.
    const primary = layer.cells[5][5];
    const partner = layer.cells[5][mirrorX];
    expect(primary).not.toBeNull();
    expect(partner).not.toBeNull();

    // Second pass: nothing should change — primary is unmismatched, partner is
    // already in sync, and the partner-equality guard prevents a redundant write.
    const beforeSnap = snapshotCells(layer);
    const secondOps = reconcileCanvas(layers, layers, true, placementOrder, undefined,
      true, false, false, 32, 32);
    expect(secondOps).toEqual([]);
    expect(snapshotCells(layer)).toEqual(beforeSnap);
  });

  it('mirrorH — overwrites well-connected partner to keep orbit symmetric', () => {
    // When a mismatched primary is fixed, the mirror partner is overwritten
    // with the mirrored copy of the fix so the orbit stays symmetric — even
    // if the partner was internally well-connected with different content.
    // (Cascade is avoided because the merge ensures mirroredState satisfies
    // the partner's own neighbor constraints.)
    const layer = makeLayer('L0', 0);
    const count = 32;
    const mirrorX = count - 1 - 5;

    layer.cells[5][5] = spriteCell('test/tile_10101010');
    layer.cells[4][5] = spriteCell('test/tile_00000000');
    layer.cells[5][mirrorX] = spriteCell('test/tile_00000000');

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 5, 5), 0);
    placementOrder.set(nk(0, 5, 4), 1);
    placementOrder.set(nk(0, mirrorX, 5), 2);

    const layers = [layer];
    reconcileCanvas(layers, layers, true, placementOrder, undefined,
      true, false, false, 32, 32);

    const primaryReplacement = layer.cells[5][5];
    const partnerReplacement = layer.cells[5][mirrorX];
    expect(primaryReplacement).not.toBeNull();
    expect(partnerReplacement).not.toBeNull();
    if (primaryReplacement && primaryReplacement.type === 'sprite' &&
        partnerReplacement && partnerReplacement.type === 'sprite') {
      expect(partnerReplacement.spriteId).toBe(primaryReplacement.spriteId);
      expect(partnerReplacement.transform.mirrorH).toBe(true);
    }
  });

  it('well-connected canvas with mirror on gets symmetrized by reconcile', () => {
    // 2026-05 strict-symmetric reconcile: even if every cell is
    // well-connected with its neighbours, a mirror-asymmetric canvas
    // is *not* a fixed point. Reconcile clones each canonical cell to
    // its orbit partners so the output is symmetric under the active
    // mirror. (Previously the same setup was a no-op — that legacy
    // behaviour conflicted with the user-visible "reconcile honours
    // mirroring" contract.)
    const layer = makeLayer('L0', 0);
    layer.cells[5][3] = spriteCell('test/tile_00000000');
    layer.cells[10][7] = spriteCell('test/tile_00000000');
    layer.cells[20][12] = spriteCell('test/tile_00000000');

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 3, 5), 0);
    placementOrder.set(nk(0, 7, 10), 1);
    placementOrder.set(nk(0, 12, 20), 2);

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder, undefined,
      true, false, false, 32, 32);

    // mirrorH partner of x=3 is x=28; of x=7 is x=24; of x=12 is x=19.
    expect(ops.length).toBeGreaterThan(0);
    expect(layer.cells[5][28]).not.toBeNull();
    expect(layer.cells[10][24]).not.toBeNull();
    expect(layer.cells[20][19]).not.toBeNull();
  });

  it('mirrorH — replacement satisfies partner constraints (no oscillation)', () => {
    // Bug fix: the chosen replacement must satisfy not only the primary cell's
    // constraints but also every mirror partner's neighbor constraints (translated
    // back into the primary's frame). Otherwise the mirrored result is mismatched
    // at the partner, the next pass re-fixes the partner with a different sprite,
    // and the result drifts asymmetric.
    const layer = makeLayer('L0', 0);
    const count = 32;
    const mirrorX = count - 1 - 5;

    // Primary at (5,5) with the W-edge constrained by (4,5) tile_00000000 → W=false.
    layer.cells[5][5] = spriteCell('test/tile_10101010');
    layer.cells[4][5] = spriteCell('test/tile_00000000');
    // Mirror partner (26,5) with E-edge constrained by (27,5) tile_00000000 → E=false.
    // Under H mirror, partner.E corresponds to primary.W — same constraint, so they agree.
    layer.cells[5][mirrorX] = spriteCell('test/tile_10101010');
    layer.cells[5][mirrorX + 1] = spriteCell('test/tile_00000000');

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 5, 5), 0);
    placementOrder.set(nk(0, 5, 4), 1);
    placementOrder.set(nk(0, mirrorX, 5), 0);
    placementOrder.set(nk(0, mirrorX + 1, 5), 1);

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder, undefined,
      true, false, false, 32, 32);

    expect(ops.length).toBeGreaterThan(0);
    // After reconcile, no cell on the canvas should be mismatched with its neighbors —
    // including the partner cell. (Pre-fix behavior could leave the partner mismatched.)
    assertNoMismatches(layers, true);

    // Result is symmetric: primary and partner have the same spriteId, partner has mirrorH transform.
    const primary = layer.cells[5][5];
    const partner = layer.cells[5][mirrorX];
    if (primary && primary.type === 'sprite' && partner && partner.type === 'sprite') {
      expect(partner.spriteId).toBe(primary.spriteId);
      expect(partner.transform.mirrorH).toBe(true);
    }
  });

  it('mirrorH — cell on H-axis (shifted layer) gets self-symmetric replacement', () => {
    // With shiftX=0.5 on a 32-wide layer, cx2 = 30, so cell at x=15 maps to itself
    // under H mirror. The chosen replacement must therefore have a self-H-symmetric
    // rendered signature, otherwise the cell is asymmetric under the active mirror.
    const layer = makeLayer('L0', 0);
    layer.shiftX = 0.5;
    // Place a non-self-symmetric tile at the H-axis center (x=15) with a mismatch.
    layer.cells[5][15] = spriteCell('test/tile_10000010'); // N=1, NW=1 — NOT H-sym (NW≠NE)
    // Force a mismatch at the N edge (4,15) tile_00000000 → forces N=false.
    layer.cells[4][15] = spriteCell('test/tile_00000000');

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 15, 5), 0);
    placementOrder.set(nk(0, 15, 4), 1);

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder, undefined,
      true, false, false, 32, 32);

    expect(ops.length).toBeGreaterThan(0);

    const result = layer.cells[5][15];
    expect(result).not.toBeNull();
    if (result && result.type === 'sprite') {
      const sig = getRenderedSignature(result);
      expect(sig).not.toBeNull();
      if (sig) {
        // Self-H-symmetric: NE === NW, E === W, SE === SW
        expect(sig[1]).toBe(sig[7]); // NE === NW
        expect(sig[2]).toBe(sig[6]); // E === W
        expect(sig[3]).toBe(sig[5]); // SE === SW
      }
    }
  });

  it('mirrorQuad — output is symmetric across the whole orbit even when some partners hold well-connected content', () => {
    // With quad, every cell has up to 15 partners (3 cross-quadrant × 4 intra-
    // quadrant arrangements). If reconcile selectively skipped partners that
    // happened to be well-connected on their own, the orbit could come out
    // asymmetric. Regression: fixing a single mismatched primary at (5,5)
    // must yield identical mirrored content across the full 4-quadrant orbit.
    const layer = makeLayer('L0', 0);
    // Mismatched primary in NW quadrant.
    layer.cells[5][5] = spriteCell('test/tile_10101010');
    layer.cells[4][5] = spriteCell('test/tile_00000000');
    // Pre-seed two cross-quadrant partners with a different well-connected
    // sprite (tile_00000000 surrounded by empty cells satisfies forced-false
    // constraints from its neighbors). Pre-fix behavior would have preserved
    // these and produced an asymmetric orbit.
    layer.cells[5][26] = spriteCell('test/tile_00000000');
    layer.cells[26][26] = spriteCell('test/tile_00000000');

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 5, 5), 0);
    placementOrder.set(nk(0, 5, 4), 1);
    placementOrder.set(nk(0, 26, 5), 2);
    placementOrder.set(nk(0, 26, 26), 3);

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder, undefined,
      false, false, false, 32, 32, false, true);
    expect(ops.length).toBeGreaterThan(0);

    // All four cross-quadrant orbit cells must hold the same spriteId after reconcile.
    const c1 = layer.cells[5][5];
    const c2 = layer.cells[5][26];
    const c3 = layer.cells[26][5];
    const c4 = layer.cells[26][26];
    expect(c1).not.toBeNull();
    expect(c2).not.toBeNull();
    expect(c3).not.toBeNull();
    expect(c4).not.toBeNull();
    if (c1 && c1.type === 'sprite' && c2 && c2.type === 'sprite' &&
        c3 && c3.type === 'sprite' && c4 && c4.type === 'sprite') {
      expect(c2.spriteId).toBe(c1.spriteId);
      expect(c3.spriteId).toBe(c1.spriteId);
      expect(c4.spriteId).toBe(c1.spriteId);
    }
  });

  it('mirror — compound mode overwrites conflicting orbit partners to preserve symmetry', () => {
    // 2026-05 strict-symmetric reconcile: when a mirror flag is on the
    // canonical cell is reconciled against its own neighbours and then
    // cloned to every orbit partner. Any pre-existing content at a
    // non-canonical position that disagrees with the clone is
    // overwritten — symmetry is non-negotiable. (Previously reconcile
    // fell back to H+V and left intra-quad partners alone; that path
    // is gone.)
    const layer = makeLayer('L0', 0);
    const pureS = (): CellState => ({ type: 'sprite', spriteId: 'test/tile_10000000', transform: { rotation: 180, mirrorH: false, mirrorV: false } });
    const pureN = (): CellState => ({ type: 'sprite', spriteId: 'test/tile_10000000', transform: { rotation: 0, mirrorH: false, mirrorV: false } });

    layer.cells[5][5] = spriteCell('test/tile_10101010');
    layer.cells[5][4] = spriteCell('test/tile_00000000');
    layer.cells[9][5] = pureS();
    layer.cells[10][5] = spriteCell('test/tile_10001000');
    layer.cells[11][5] = pureN();

    const placementOrder = new Map<number, number>();
    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder, undefined,
      false, false, false, 32, 32, false, /* mirrorQuad */ true);

    expect(ops.length).toBeGreaterThan(0);
    // (5,10) is in the same quad-orbit as (5,5); the clone overwrites
    // whatever was there — the orbit is symmetric afterwards.
    const a = layer.cells[5][5];
    const b = layer.cells[10][5];
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    if (a && a.type === 'sprite' && b && b.type === 'sprite') {
      expect(b.spriteId).toBe(a.spriteId);
    }
  });

  it('mirror — strict-symmetric reconcile overwrites the H partner even when its constraints conflict', () => {
    // Strict policy: no fallback to "asymmetric fix". When the canonical
    // cell's chosen replacement conflicts with a partner's existing
    // neighbours, the partner is still overwritten with the clone — the
    // orbit ends symmetric. The partner's "well-connected island" is
    // sacrificed because reconcile prioritises mirror invariants when a
    // mirror is on.
    const layer = makeLayer('L0', 0);
    const count = 32;
    const mirrorX = count - 1 - 5;
    const pureS = (): CellState => ({ type: 'sprite', spriteId: 'test/tile_10000000', transform: { rotation: 180, mirrorH: false, mirrorV: false } });
    const pureN = (): CellState => ({ type: 'sprite', spriteId: 'test/tile_10000000', transform: { rotation: 0, mirrorH: false, mirrorV: false } });

    layer.cells[5][5] = spriteCell('test/tile_10101010');
    layer.cells[4][5] = pureS();
    layer.cells[5][mirrorX] = spriteCell('test/tile_10001000');
    layer.cells[4][mirrorX] = pureS();
    layer.cells[6][mirrorX] = pureN();

    const placementOrder = new Map<number, number>();
    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder, undefined,
      true, false, false, 32, 32);

    expect(ops.length).toBeGreaterThan(0);
    const primary = layer.cells[5][5];
    const partner = layer.cells[5][mirrorX];
    expect(primary).not.toBeNull();
    expect(partner).not.toBeNull();
    if (primary && primary.type === 'sprite' && partner && partner.type === 'sprite') {
      expect(partner.spriteId).toBe(primary.spriteId);
      expect(partner.transform.mirrorH).toBe(true);
    }
  });

  it('mirrorQuad — fix propagates to all 3 quadrant partners', () => {
    const layer = makeLayer('L0', 0);
    // Quad partitions canvas into 4 quadrants; (5,5) in the NW quadrant
    // has partners in the NE, SW, SE quadrants.
    // qw = qh = 16 (floor(32/2))
    // Primary (5,5) in NW quadrant: qx=5, qy=5; mqx=qw-1-5=10, mqy=10
    // NE partner: (qw + 10, 5) = (26, 5)
    // SW partner: (5, qh + 10) = (5, 26)
    // SE partner: (26, 26)
    layer.cells[5][5] = spriteCell('test/tile_10101010');
    layer.cells[4][5] = spriteCell('test/tile_00000000');

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 5, 5), 0);
    placementOrder.set(nk(0, 5, 4), 1);

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder, undefined,
      false, false, false, 32, 32, false, true);

    expect(ops.length).toBeGreaterThan(0);

    // Empty partners must now be populated.
    expect(layer.cells[5][26]).not.toBeNull();
    expect(layer.cells[26][5]).not.toBeNull();
    expect(layer.cells[26][26]).not.toBeNull();
  });

  it('mirrorRow — fix propagates to row partners', () => {
    const layer = makeLayer('L0', 0);
    layer.cells[5][5] = spriteCell('test/tile_10101010');
    layer.cells[4][5] = spriteCell('test/tile_00000000');

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 5, 5), 0);
    placementOrder.set(nk(0, 5, 4), 1);

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder, undefined,
      false, false, false, 32, 32, false, false, true);

    expect(ops.length).toBeGreaterThan(0);
    // Row mode subdivides vertically (top/bottom halves with a within-half V-flip).
    // (5,5) at qy=5 in top half → mqy=qh-1-5 = 10. Within-half partner: (5, 10).
    // Cross-half partners: (5, 16+5)=(5,21), (5, 16+10)=(5,26).
    expect(layer.cells[10][5]).not.toBeNull();
    expect(layer.cells[21][5]).not.toBeNull();
    expect(layer.cells[26][5]).not.toBeNull();
  });

  it('mirrorCol — fix propagates to col partners', () => {
    const layer = makeLayer('L0', 0);
    layer.cells[5][5] = spriteCell('test/tile_10101010');
    layer.cells[4][5] = spriteCell('test/tile_00000000');

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 5, 5), 0);
    placementOrder.set(nk(0, 5, 4), 1);

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder, undefined,
      false, false, false, 32, 32, false, false, false, true);

    expect(ops.length).toBeGreaterThan(0);
    // Col mode subdivides horizontally (left/right halves with a within-half H-flip).
    expect(layer.cells[5][10]).not.toBeNull();
    expect(layer.cells[5][21]).not.toBeNull();
    expect(layer.cells[5][26]).not.toBeNull();
  });

  it('mirrorDiag1 — fix propagates to \\\\ diagonal partner', () => {
    const layer = makeLayer('L0', 0);
    // Place primary off the diagonal so partner exists.
    layer.cells[5][3] = spriteCell('test/tile_10101010');
    layer.cells[4][3] = spriteCell('test/tile_00000000');

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 3, 5), 0);
    placementOrder.set(nk(0, 3, 4), 1);

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder, undefined,
      false, false, false, 32, 32, false, false, false, false, true);

    expect(ops.length).toBeGreaterThan(0);
    // \\ diagonal: (x,y) → (y,x). So (3,5) → (5,3).
    expect(layer.cells[3][5]).not.toBeNull();
  });

  it('mirrorDiag2 — fix propagates to / diagonal partner', () => {
    const layer = makeLayer('L0', 0);
    layer.cells[5][3] = spriteCell('test/tile_10101010');
    layer.cells[4][3] = spriteCell('test/tile_00000000');

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 3, 5), 0);
    placementOrder.set(nk(0, 3, 4), 1);

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder, undefined,
      false, false, false, 32, 32, false, false, false, false, false, true);

    expect(ops.length).toBeGreaterThan(0);
    // / diagonal: (x,y) → (max-1-y, max-1-x) = (26, 28) for (3,5).
    expect(layer.cells[28][26]).not.toBeNull();
  });

  it('mirrorDiagBoth — fix propagates to both diagonal partners', () => {
    const layer = makeLayer('L0', 0);
    layer.cells[5][3] = spriteCell('test/tile_10101010');
    layer.cells[4][3] = spriteCell('test/tile_00000000');

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 3, 5), 0);
    placementOrder.set(nk(0, 3, 4), 1);

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder, undefined,
      false, false, false, 32, 32, false, false, false, false, false, false, true);

    expect(ops.length).toBeGreaterThan(0);
    // Both diagonals + composition (180°) → 3 partner positions.
    expect(layer.cells[3][5]).not.toBeNull();
    expect(layer.cells[28][26]).not.toBeNull();
  });

  it('mirrorStar — fix propagates to all 7 D4 partners', () => {
    const layer = makeLayer('L0', 0);
    layer.cells[5][3] = spriteCell('test/tile_10101010');
    layer.cells[4][3] = spriteCell('test/tile_00000000');

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 3, 5), 0);
    placementOrder.set(nk(0, 3, 4), 1);

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder, undefined,
      false, false, false, 32, 32, false, false, false, false, false, false, false, true);

    expect(ops.length).toBeGreaterThan(0);
    // Count distinct cells written.
    const cellOps = ops.filter(op => op.op === 'cell');
    const distinct = new Set<string>();
    for (const op of cellOps) {
      if (op.op === 'cell') distinct.add(`${op.cellX},${op.cellY}`);
    }
    // Star = 8-fold D4 → up to 8 cells (primary + 7 partners).
    expect(distinct.size).toBeGreaterThanOrEqual(4);
  });
});

// ── reconcileCanvas borderOnly ──────────────────────────────────────

describe('reconcileCanvas borderOnly', () => {
  it('interior tiles are NOT modified', () => {
    const layer = makeLayer('L0', 0);
    // Fill a 3x3 block at (5,5)-(7,7) with mismatched tiles
    // Interior cell at (6,6) has all 4 neighbors occupied
    for (let cy = 5; cy <= 7; cy++) {
      for (let cx = 5; cx <= 7; cx++) {
        layer.cells[cy][cx] = spriteCell('test/tile_10101010');
      }
    }
    // Force a mismatch: put a zero-connection tile at center
    layer.cells[6][6] = spriteCell('test/tile_00000000');

    const placementOrder = new Map<number, number>();
    for (let cy = 5; cy <= 7; cy++) {
      for (let cx = 5; cx <= 7; cx++) {
        placementOrder.set(cy * 64 + cx, cy * 10 + cx);
      }
    }

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder,
      undefined, false, false, false, 32, 32, true);

    // Interior cell (6,6) should NOT be modified — it has all 4 neighbors occupied
    const interiorModified = ops.some(op =>
      op.op === 'cell' && op.cellX === 6 && op.cellY === 6);
    expect(interiorModified).toBe(false);
  });

  it('edge tiles adjacent to empty cells ARE fixed', () => {
    const layer = makeLayer('L0', 0);
    // Place a single tile with connections facing empty neighbors
    layer.cells[10][10] = spriteCell('test/tile_10101010');

    const placementOrder = new Map<number, number>();
    placementOrder.set(10 * 64 + 10, 0);

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder,
      undefined, false, false, false, 32, 32, true);

    // The tile borders empty cells, so it qualifies as a border tile
    expect(ops.length).toBeGreaterThan(0);
  });

  it('canvas-edge tiles ARE fixed', () => {
    const layer = makeLayer('L0', 0);
    // Place a mismatched tile at canvas edge (0,0)
    layer.cells[0][0] = spriteCell('test/tile_10101010');
    // Place a neighbor so (0,0) has a mismatch
    layer.cells[0][1] = spriteCell('test/tile_00000000');

    const placementOrder = new Map<number, number>();
    placementOrder.set(0 * 64 + 0, 0);
    placementOrder.set(0 * 64 + 1, 1);

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder,
      undefined, false, false, false, 32, 32, true);

    // Canvas edge tiles should be processed
    const edgeModified = ops.some(op =>
      op.op === 'cell' && op.cellX === 0 && op.cellY === 0);
    expect(edgeModified).toBe(true);
  });

  it('mirror support works with border mode', () => {
    const layer = makeLayer('L0', 0);
    const mirrorX = 32 - 1 - 5; // 26
    // Place a border tile with mismatch at both primary and mirror positions
    layer.cells[5][5] = spriteCell('test/tile_10101010');
    layer.cells[5][mirrorX] = spriteCell('test/tile_10101010');

    const placementOrder = new Map<number, number>();
    placementOrder.set(nk(0, 5, 5), 0);
    placementOrder.set(nk(0, mirrorX, 5), 0);

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, placementOrder,
      undefined, true, false, false, 32, 32, true);

    // Should produce ops for both the primary and mirror positions
    expect(ops.length).toBeGreaterThan(0);

    const hasMirrorOp = ops.some(op =>
      op.op === 'cell' && op.cellX === mirrorX && op.cellY === 5);
    expect(hasMirrorOp).toBe(true);
  });

  it('full reconcile still fixes all tiles (borderOnly=false)', () => {
    const layer = makeLayer('L0', 0);
    // Fill a 3x3 block with mismatched tiles
    for (let cy = 5; cy <= 7; cy++) {
      for (let cx = 5; cx <= 7; cx++) {
        layer.cells[cy][cx] = spriteCell('test/tile_10101010');
      }
    }
    layer.cells[6][6] = spriteCell('test/tile_00000000');

    const placementOrder = new Map<number, number>();
    for (let cy = 5; cy <= 7; cy++) {
      for (let cx = 5; cx <= 7; cx++) {
        placementOrder.set(cy * 64 + cx, cy * 10 + cx);
      }
    }

    const layers = [layer];
    reconcileCanvas(layers, layers, true, placementOrder,
      undefined, false, false, false, 32, 32, false);

    // Regular reconcile should fix everything including interior
    assertNoMismatches(layers, true);
  });
});

// ── reconcileCanvas partial-tile erasure ────────────────────────────

function makeShiftedLayer(id: string, level: GridLevel = 0, order: number = 0, shiftX: 0 | 0.5 = 0, shiftY: 0 | 0.5 = 0.5): Layer {
  const layer = makeLayer(id, level, order);
  layer.shiftX = shiftX;
  layer.shiftY = shiftY;
  const count = CELL_COUNTS[level];
  if (shiftY === 0.5) layer.edgeRowTop = new Array(count).fill(null);
  if (shiftX === 0.5) layer.edgeColLeft = new Array(count).fill(null);
  return layer;
}

describe('reconcileCanvas partial-tile erasure', () => {
  it('erases populated edgeRowTop / edgeColLeft / edgeCorner and emits undo ops', () => {
    const layer = makeShiftedLayer('shifted', 0, 0, 0.5, 0.5);
    layer.edgeRowTop![2] = spriteCell('test/tile_10101010');
    layer.edgeColLeft![3] = spriteCell('test/tile_11111111');
    layer.edgeCorner = spriteCell('test/tile_00000000');

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, new Map());

    expect(layer.edgeRowTop![2]).toBeNull();
    expect(layer.edgeColLeft![3]).toBeNull();
    expect(layer.edgeCorner).toBeNull();

    // All three partial slots should appear in ops with newState=null and matching oldState spriteIds.
    const eraseOps = ops.filter(op =>
      op.op === 'cell' && op.newState === null && (op.cellX === -1 || op.cellY === -1));
    expect(eraseOps.length).toBe(3);

    const row = eraseOps.find(op => op.op === 'cell' && op.cellX === 2 && op.cellY === -1);
    const col = eraseOps.find(op => op.op === 'cell' && op.cellX === -1 && op.cellY === 3);
    const corner = eraseOps.find(op => op.op === 'cell' && op.cellX === -1 && op.cellY === -1);
    expect(row).toBeDefined();
    expect(col).toBeDefined();
    expect(corner).toBeDefined();
    if (row && row.op === 'cell') expect((row.oldState as any)?.spriteId).toBe('test/tile_10101010');
    if (col && col.op === 'cell') expect((col.oldState as any)?.spriteId).toBe('test/tile_11111111');
    if (corner && corner.op === 'cell') expect((corner.oldState as any)?.spriteId).toBe('test/tile_00000000');
  });

  it('partial tile no longer constrains interior neighbor', () => {
    const layer = makeShiftedLayer('shifted', 0, 0, 0, 0.5);
    // Partial tile at (2,-1) with S=1 (so its connection point at L0 y=0.5
    // would constrain interior (2,0)'s N to be true).
    layer.edgeRowTop![2] = spriteCell('test/tile_00001000'); // S=1 only
    // Interior tile at (2,0) currently matches that pull (N=1).
    layer.cells[0][2] = spriteCell('test/tile_10000000'); // N=1 only

    const layers = [layer];
    // Allow border so the canvas top edge doesn't force everything to false
    // on its own — we want to verify the partial-tile constraint specifically.
    reconcileCanvas(layers, layers, true, new Map());

    // Partial tile gone.
    expect(layer.edgeRowTop![2]).toBeNull();

    // Interior tile reconciled: with the partial erased and treatEmptyAsFalse,
    // its N constraint is now false, so it must be replaced with N=false.
    const interior = layer.cells[0][2];
    expect(interior).not.toBeNull();
    if (interior && interior.type === 'sprite') {
      const sig = getRenderedSignature(interior);
      if (sig) expect(sig[0]).toBe(false); // N must now be false
    }

    assertNoMismatches(layers, true);
  });

  it('empty edge arrays yield no erase ops', () => {
    const layer = makeShiftedLayer('shifted', 0, 0, 0.5, 0.5);
    // edgeRowTop / edgeColLeft are initialised arrays of null, edgeCorner is null.
    layer.cells[5][5] = spriteCell('test/tile_00000000');

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, new Map());

    const eraseOps = ops.filter(op =>
      op.op === 'cell' && op.newState === null && (op.cellX === -1 || op.cellY === -1));
    expect(eraseOps.length).toBe(0);
  });

  it('borderOnly mode also erases partial tiles', () => {
    const layer = makeShiftedLayer('shifted', 0, 0, 0.5, 0.5);
    layer.edgeRowTop![1] = spriteCell('test/tile_10101010');
    layer.edgeColLeft![1] = spriteCell('test/tile_10101010');
    layer.edgeCorner = spriteCell('test/tile_10101010');

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, new Map(),
      undefined, false, false, false, 32, 32, /*borderOnly=*/true);

    expect(layer.edgeRowTop![1]).toBeNull();
    expect(layer.edgeColLeft![1]).toBeNull();
    expect(layer.edgeCorner).toBeNull();
    const eraseOps = ops.filter(op =>
      op.op === 'cell' && op.newState === null && (op.cellX === -1 || op.cellY === -1));
    expect(eraseOps.length).toBe(3);
  });

  it('mirrorH — partial tiles on both halves are erased', () => {
    const layer = makeShiftedLayer('shifted', 0, 0, 0, 0.5);
    layer.edgeRowTop![3] = spriteCell('test/tile_10101010');
    layer.edgeRowTop![28] = spriteCell('test/tile_10101010');

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, new Map(),
      undefined, true, false, false, 32, 32);

    expect(layer.edgeRowTop![3]).toBeNull();
    expect(layer.edgeRowTop![28]).toBeNull();
    const eraseOps = ops.filter(op =>
      op.op === 'cell' && op.newState === null && op.cellY === -1);
    expect(eraseOps.length).toBe(2);
  });

  it('locked layer — partial tiles are NOT erased', () => {
    const layer = makeShiftedLayer('locked', 0, 0, 0, 0.5);
    layer.locked = true;
    layer.edgeRowTop![2] = spriteCell('test/tile_10101010');

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, new Map());

    expect(layer.edgeRowTop![2]).not.toBeNull();
    expect((layer.edgeRowTop![2] as any).spriteId).toBe('test/tile_10101010');
    const eraseOps = ops.filter(op =>
      op.op === 'cell' && op.newState === null && op.cellY === -1);
    expect(eraseOps.length).toBe(0);
  });

  it('hidden layer — partial tiles are NOT erased', () => {
    const layer = makeShiftedLayer('hidden', 0, 0, 0, 0.5);
    layer.visible = false;
    layer.edgeRowTop![2] = spriteCell('test/tile_10101010');

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, new Map());

    expect(layer.edgeRowTop![2]).not.toBeNull();
    const eraseOps = ops.filter(op =>
      op.op === 'cell' && op.newState === null && op.cellY === -1);
    expect(eraseOps.length).toBe(0);
  });

  it('main-grid cell straddling clip-right boundary is erased', () => {
    // L1 cells are 2 L0 units wide. With clip widthL0 = 31 (not a multiple
    // of 2), the right-edge L1 cell at cx=15 spans L0 [30, 32] — straddles
    // the clip-right at L0 x=31 → partial → must be erased.
    const layer = makeLayer('L1', 1);
    // L1 has 16x16 cells. cells[0][15] is the right-edge cell of row 0.
    layer.cells[0][15] = spriteCell('test/tile_10101010');
    // Place a fully-inside cell at cx=14 (L0 [28, 30]) so we can verify it
    // is NOT erased and only the partial gets removed.
    layer.cells[0][14] = spriteCell('test/tile_10101010');

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, new Map(),
      undefined, false, false, false, /*widthL0=*/31, /*heightL0=*/31);

    // Partial at (15, 0) erased.
    expect(layer.cells[0][15]).toBeNull();
    // Fully-inside (14, 0) preserved (though it may be reconciled to a
    // non-connecting variant by the main loop).
    expect(layer.cells[0][14]).not.toBeNull();

    const eraseOps = ops.filter(op =>
      op.op === 'cell' && op.newState === null && op.cellX === 15 && op.cellY === 0);
    expect(eraseOps.length).toBe(1);
  });

  it('cell fully outside the clip is NOT erased (preserved)', () => {
    // With clip widthL0=10 on an L0 unshifted layer, cells at cx>=10 are
    // fully outside the clip and must not be touched (the user may have
    // placed them before shrinking the clip box).
    const layer = makeLayer('L0', 0);
    layer.cells[5][15] = spriteCell('test/tile_10101010'); // L0 [15,16] — outside clip [0,10]
    layer.cells[5][5] = spriteCell('test/tile_10101010');  // L0 [5,6] — inside clip [0,10]

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, new Map(),
      undefined, false, false, false, /*widthL0=*/10, /*heightL0=*/10);

    expect(layer.cells[5][15]).not.toBeNull();
    // The inside-clip cell may be reconciled (connections facing empty), but
    // shouldn't be erased by Phase 0.
    const phase0Erase = ops.find(op =>
      op.op === 'cell' && op.newState === null && op.cellX === 15 && op.cellY === 5);
    expect(phase0Erase).toBeUndefined();
  });

  it('shifted layer trailing-edge main-grid cell is partial and erased', () => {
    // L0 layer with shiftX=0.5, clip widthL0=32, originL0X=0.
    // Cell at cx=31 spans L0 [31.5, 32.5] — straddles clipR=32 → partial.
    const layer = makeShiftedLayer('shifted-x', 0, 0, 0.5, 0);
    layer.cells[5][31] = spriteCell('test/tile_10101010');
    // Cell at cx=0 spans L0 [0.5, 1.5] — fully inside → kept.
    layer.cells[5][0] = spriteCell('test/tile_10101010');

    const layers = [layer];
    reconcileCanvas(layers, layers, true, new Map());

    expect(layer.cells[5][31]).toBeNull();
    // cells[5][0] may be reconciled but not erased by Phase 0.
    // (its own reconciliation behaviour is covered by other tests)
  });

  it('non-zero clip origin — cells fully inside the shifted clip are NOT partial', () => {
    // Clip at originL0X=4, widthL0=24 (so clip x in [4, 28]).
    // L1 unshifted: cell cx=2 spans L0 [4, 6] — fully inside.
    const layer = makeLayer('L1', 1);
    layer.cells[2][2] = spriteCell('test/tile_10101010');
    // Cell cx=1 spans L0 [2, 4] — touches clipL=4 but cellR=4=clipL → not overlapping (xR > clipL is 4 > 4 = false), so fully outside.
    layer.cells[2][1] = spriteCell('test/tile_10101010');
    // Cell cx=0 spans L0 [0, 2] — fully outside.
    layer.cells[2][0] = spriteCell('test/tile_10101010');

    const layers = [layer];
    const ops = reconcileCanvas(layers, layers, true, new Map(),
      undefined, false, false, false, 24, 24, false, false, false, false, false, false, false, false, /*originL0X=*/4, /*originL0Y=*/4);

    // No Phase 0 erasures: nothing is partial.
    const phase0Erase = ops.filter(op => op.op === 'cell' && op.newState === null);
    expect(phase0Erase.length).toBe(0);
    expect(layer.cells[2][2]).not.toBeNull();
    expect(layer.cells[2][1]).not.toBeNull();
    expect(layer.cells[2][0]).not.toBeNull();
  });
});
