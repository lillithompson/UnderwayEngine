import { selectTargetLayers, multiresFillAsync } from '../multires-fill';
import { makeLayer } from './test-utils';
import { CELL_COUNTS, DEFAULT_TRANSFORM } from '../types';
import { applyCellEdit } from '../cells';

describe('selectTargetLayers', () => {
  test('groups by level and picks first by order', () => {
    const l3a = makeLayer('l3a', 3, 2);
    const l3b = makeLayer('l3b', 3, 1);
    const l1 = makeLayer('l1', 1, 0);
    const result = selectTargetLayers([l3a, l3b, l1]);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(2);
    // Coarsest first (level 3), then finer (level 1)
    expect(result![0].level).toBe(3);
    expect(result![0].layer.id).toBe('l3b'); // lower order wins
    expect(result![1].level).toBe(1);
    expect(result![1].layer.id).toBe('l1');
  });

  test('returns null with only 1 distinct level', () => {
    const l1a = makeLayer('a', 2, 0);
    const l1b = makeLayer('b', 2, 1);
    expect(selectTargetLayers([l1a, l1b])).toBeNull();
  });

  test('excludes hidden and locked layers', () => {
    const hidden = makeLayer('h', 3, 0);
    hidden.visible = false;
    const locked = makeLayer('k', 2, 0);
    locked.locked = true;
    const vis = makeLayer('v', 1, 0);
    // Only 1 visible+unlocked level -> null
    expect(selectTargetLayers([hidden, locked, vis])).toBeNull();
  });

  test('sorts by level descending (coarsest first)', () => {
    const l0 = makeLayer('l0', 0, 0);
    const l2 = makeLayer('l2', 2, 0);
    const l3 = makeLayer('l3', 3, 0);
    const result = selectTargetLayers([l0, l2, l3]);
    expect(result).not.toBeNull();
    expect(result!.map(t => t.level)).toEqual([3, 2, 0]);
  });
});

describe('multiresFillAsync', () => {
  test('fills cells across multiple layers with no L0 overlap', async () => {
    const l3 = makeLayer('l3', 3, 0); // 4x4 cells
    const l1 = makeLayer('l1', 1, 1); // 16x16 cells
    const layers = [l3, l1];

    const result = await multiresFillAsync({
      layers,
      activeLayerId: 'l3',
      tool: { type: 'random' },
      mirrorH: false,
      mirrorV: false,
      mirrorRotate: false,
      mirrorQuad: false,
      mirrorRow: false,
      mirrorCol: false,
      mirrorDiag1: false,
      mirrorDiag2: false,
      mirrorDiagBoth: false,
      mirrorStar: false,
      allowBorderConnections: true,
      canvasWidthL0: 32,
      canvasHeightL0: 32,
    });

    expect(result.ops.length).toBeGreaterThan(0);
    expect(result.affectedLayers.length).toBeGreaterThan(0);

    // Verify no L0 overlap: collect all L0 indices from both layers
    const l0Indices = new Set<number>();
    for (const layer of layers) {
      const scale = CELL_COUNTS[0] / CELL_COUNTS[layer.level];
      const maxY = CELL_COUNTS[layer.level];
      const maxX = CELL_COUNTS[layer.level];
      for (let y = 0; y < maxY; y++) {
        for (let x = 0; x < maxX; x++) {
          if (layer.cells[y][x] != null) {
            for (let dy = 0; dy < scale; dy++) {
              for (let dx = 0; dx < scale; dx++) {
                const idx = (y * scale + dy) * 32 + (x * scale + dx);
                expect(l0Indices.has(idx)).toBe(false);
                l0Indices.add(idx);
              }
            }
          }
        }
      }
    }
  });

  test('25/25/rest distribution with min-1 guarantee', async () => {
    const l3 = makeLayer('l3', 3, 0); // 4x4 = 16 cells
    const l2 = makeLayer('l2', 2, 1); // 8x8 = 64 cells
    const l1 = makeLayer('l1', 1, 2); // 16x16 = 256 cells
    const layers = [l3, l2, l1];

    await multiresFillAsync({
      layers,
      activeLayerId: 'l3',
      tool: { type: 'random' },
      mirrorH: false,
      mirrorV: false,
      mirrorRotate: false,
      mirrorQuad: false,
      mirrorRow: false,
      mirrorCol: false,
      mirrorDiag1: false,
      mirrorDiag2: false,
      mirrorDiagBoth: false,
      mirrorStar: false,
      allowBorderConnections: true,
      canvasWidthL0: 32,
      canvasHeightL0: 32,
    });

    // L3 should have some cells filled (25% of 16 = 4, min 1)
    let l3Filled = 0;
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        if (l3.cells[y][x] != null) l3Filled++;
      }
    }
    expect(l3Filled).toBeGreaterThanOrEqual(1);
    expect(l3Filled).toBeLessThanOrEqual(4); // 25% of 16

    // L2 should have some cells filled too
    let l2Filled = 0;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        if (l2.cells[y][x] != null) l2Filled++;
      }
    }
    expect(l2Filled).toBeGreaterThanOrEqual(1);
  });

  test('mirror divides fill count: 12x12 L1 with H+V places 1 primary on L3', async () => {
    // 12x12 in L1 units → canvasWidthL0 = 12 * (32/16) = 24
    // L3 editableCells(24, 3) = floor(24 * 4 / 32) = 3 → 3x3 = 9 candidates
    // 25% of 9 = 2.25 → floor = 2, /4 (H+V mirror) = 0.5 → floor = 0, max(1,0) = 1
    const l3 = makeLayer('l3', 3, 0);
    const l1 = makeLayer('l1', 1, 1);

    const result = await multiresFillAsync({
      layers: [l3, l1],
      activeLayerId: 'l3',
      tool: { type: 'random' },
      mirrorH: true,
      mirrorV: true,
      mirrorRotate: false,
      mirrorQuad: false,
      mirrorRow: false,
      mirrorCol: false,
      mirrorDiag1: false,
      mirrorDiag2: false,
      mirrorDiagBoth: false,
      mirrorStar: false,
      allowBorderConnections: true,
      canvasWidthL0: 24,
      canvasHeightL0: 24,
    });

    // Count primary placements on L3 (ops where layerId is l3 and came from fillCell, not clear)
    const l3Ops = result.ops.filter(op => op.op === 'cell' && op.layerId === 'l3' && op.newState != null);
    // With H+V mirror, 1 primary → up to 4 cells total on L3
    // The primary placement count should be small; specifically 1 placement * up to 4 mirror copies
    expect(l3Ops.length).toBeGreaterThanOrEqual(1);
    expect(l3Ops.length).toBeLessThanOrEqual(4);
  });

  test('mirror divides fill count: rotational mirror same as H+V', async () => {
    const l3 = makeLayer('l3', 3, 0);
    const l1 = makeLayer('l1', 1, 1);

    const result = await multiresFillAsync({
      layers: [l3, l1],
      activeLayerId: 'l3',
      tool: { type: 'random' },
      mirrorH: false,
      mirrorV: false,
      mirrorRotate: true,
      mirrorQuad: false,
      mirrorRow: false,
      mirrorCol: false,
      mirrorDiag1: false,
      mirrorDiag2: false,
      mirrorDiagBoth: false,
      mirrorStar: false,
      allowBorderConnections: true,
      canvasWidthL0: 24,
      canvasHeightL0: 24,
    });

    const l3Ops = result.ops.filter(op => op.op === 'cell' && op.layerId === 'l3' && op.newState != null);
    expect(l3Ops.length).toBeGreaterThanOrEqual(1);
    expect(l3Ops.length).toBeLessThanOrEqual(4);
  });

  test('all occupied by non-target layer returns empty ops', async () => {
    const l3 = makeLayer('l3', 3, 0);
    const l1 = makeLayer('l1', 1, 1);
    // A locked layer whose cells won't be cleared (not a target)
    const blocker = makeLayer('blocker', 0, 2);
    blocker.locked = true;

    // Fill all L0 cells on the locked blocker layer
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        applyCellEdit(blocker, x, y, { type: 'color', r: 255, g: 0, b: 0, transform: DEFAULT_TRANSFORM });
      }
    }

    await multiresFillAsync({
      layers: [l3, l1, blocker],
      activeLayerId: 'l3',
      tool: { type: 'random' },
      mirrorH: false,
      mirrorV: false,
      mirrorRotate: false,
      mirrorQuad: false,
      mirrorRow: false,
      mirrorCol: false,
      mirrorDiag1: false,
      mirrorDiag2: false,
      mirrorDiagBoth: false,
      mirrorStar: false,
      allowBorderConnections: true,
      canvasWidthL0: 32,
      canvasHeightL0: 32,
    });

    // No candidates should exist since all L0 cells are occupied via locked blocker
    let l3Filled = 0;
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        if (l3.cells[y][x] != null) l3Filled++;
      }
    }
    expect(l3Filled).toBe(0);
    let l1Filled = 0;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if (l1.cells[y][x] != null) l1Filled++;
      }
    }
    expect(l1Filled).toBe(0);
  });

  // Regression: with non-zero canvas origin, fill must land inside the
  // canvas window — not in the layer's upper-left quadrant. Previously
  // collectCandidates / buildL0Occupancy iterated [0, maxCellX) so a
  // centred 16×16 canvas (origin (8,8)) only filled the layer top-left.
  test('non-zero canvas origin fills inside the canvas window', async () => {
    const l3 = makeLayer('l3', 3, 0); // 4x4 layer cells, scale 8
    const l1 = makeLayer('l1', 1, 1); // 16x16 layer cells, scale 2

    const result = await multiresFillAsync({
      layers: [l3, l1],
      activeLayerId: 'l3',
      tool: { type: 'random' },
      mirrorH: false,
      mirrorV: false,
      mirrorRotate: false,
      mirrorQuad: false,
      mirrorRow: false,
      mirrorCol: false,
      mirrorDiag1: false,
      mirrorDiag2: false,
      mirrorDiagBoth: false,
      mirrorStar: false,
      allowBorderConnections: true,
      canvasWidthL0: 16,
      canvasHeightL0: 16,
      originL0X: 8,
      originL0Y: 8,
    });

    // Canvas at L3 (scale 8) covers cells [1, 3); at L1 (scale 2) [4, 12).
    // No primary placements should land outside those windows.
    const placeOps = result.ops.filter(op => op.op === 'cell' && op.newState != null);
    expect(placeOps.length).toBeGreaterThan(0);
    for (const op of placeOps) {
      if (op.op !== 'cell') continue;
      if (op.layerId === 'l3') {
        expect(op.cellX).toBeGreaterThanOrEqual(1);
        expect(op.cellX).toBeLessThan(3);
        expect(op.cellY).toBeGreaterThanOrEqual(1);
        expect(op.cellY).toBeLessThan(3);
      } else if (op.layerId === 'l1') {
        expect(op.cellX).toBeGreaterThanOrEqual(4);
        expect(op.cellX).toBeLessThan(12);
        expect(op.cellY).toBeGreaterThanOrEqual(4);
        expect(op.cellY).toBeLessThan(12);
      }
    }

    // L1 finest-tier should fill all candidates inside the canvas window.
    let l1FilledInside = 0;
    for (let y = 4; y < 12; y++) {
      for (let x = 4; x < 12; x++) {
        if (l1.cells[y][x] != null) l1FilledInside++;
      }
    }
    // Some L1 cells may be claimed by L3 placements first. Just assert that
    // at least one L1 cell inside the window was filled — i.e., the right
    // half / bottom half of the canvas didn't fall victim to the bug.
    expect(l1FilledInside).toBeGreaterThan(0);
    // And that nothing leaked into the layer top-left (canvas origin shift
    // would put cells there if the bug regressed).
    let l1OutsideCount = 0;
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 16; x++) {
        if (l1.cells[y][x] != null) l1OutsideCount++;
      }
    }
    for (let y = 4; y < 16; y++) {
      for (let x = 0; x < 4; x++) {
        if (l1.cells[y][x] != null) l1OutsideCount++;
      }
    }
    expect(l1OutsideCount).toBe(0);
  });

  test('region bounds constrains fill', async () => {
    const l3 = makeLayer('l3', 3, 0);
    const l1 = makeLayer('l1', 1, 1);

    // Fill only top-left quadrant (first 512px of 2048px canvas)
    await multiresFillAsync({
      layers: [l3, l1],
      activeLayerId: 'l3',
      tool: { type: 'random' },
      mirrorH: false,
      mirrorV: false,
      mirrorRotate: false,
      mirrorQuad: false,
      mirrorRow: false,
      mirrorCol: false,
      mirrorDiag1: false,
      mirrorDiag2: false,
      mirrorDiagBoth: false,
      mirrorStar: false,
      allowBorderConnections: true,
      canvasWidthL0: 32,
      canvasHeightL0: 32,
      fillRegion: { pxMinX: 0, pxMinY: 0, pxMaxX: 512, pxMaxY: 512 },
    });

    // Check that no cells were filled outside the region
    // L3 cells: each is 512px, so only cell (0,0) center is at 256px which is inside 0-512
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        if (x > 0 || y > 0) {
          expect(l3.cells[y][x]).toBeNull();
        }
      }
    }
    // L1 cells: each is 128px, so cells with center < 512px are 0..3
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if (x >= 4 || y >= 4) {
          expect(l1.cells[y][x]).toBeNull();
        }
      }
    }
  });

  test('excludePartialTiles skips the partial right column on a shifted L2 layer', async () => {
    // Shifted L2 (cellsPerL0=4, shiftX=0.5): cell 7 spans L0 [30..34],
    // partial. With the flag on, multires fill should never touch it.
    const l2 = makeLayer('l2-shift', 2, 0);
    l2.shiftX = 0.5;
    const l1 = makeLayer('l1', 1, 1);
    const layers = [l2, l1];

    const result = await multiresFillAsync({
      layers,
      activeLayerId: 'l2-shift',
      tool: { type: 'random' },
      mirrorH: false, mirrorV: false, mirrorRotate: false, mirrorQuad: false,
      mirrorRow: false, mirrorCol: false, mirrorDiag1: false, mirrorDiag2: false,
      mirrorDiagBoth: false, mirrorStar: false,
      allowBorderConnections: true,
      canvasWidthL0: 32,
      canvasHeightL0: 32,
      excludePartialTiles: true,
    });

    expect(result.ops.length).toBeGreaterThan(0);
    // Column 7 on the shifted L2 layer must stay null.
    for (let y = 0; y < CELL_COUNTS[2]; y++) {
      expect(l2.cells[y][7]).toBeNull();
    }
  });
});
