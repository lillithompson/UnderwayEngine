import { L0PointIndex } from '../spatialIndex';
import { connectionPointL0, getRenderedSignature } from '../connectivity';
import { makeLayer } from './test-utils';
import { CellState, DEFAULT_TRANSFORM } from '../types';

function spriteCell(spriteId: string, transform = DEFAULT_TRANSFORM): CellState {
  return { type: 'sprite', spriteId, transform };
}

// ── Basic Insert + Query ────────────────────────────────────────────

describe('L0PointIndex', () => {
  it('inserts and queries a single cell', () => {
    const layer = makeLayer('a', 0);
    const cell = spriteCell('test/tile_10101010');
    layer.cells[0][0] = cell;

    const index = new L0PointIndex();
    index.buildFromLayers([layer]);

    // The N connection point of cell (0,0) at L0 is (0.5, 0)
    const cp = connectionPointL0(0, 0, 0, 0, 0, 0);
    index.queryPoint(cp.x, cp.y, layer, 99, 99); // exclude a non-existent cell
    expect(index.queryResultsCount).toBeGreaterThan(0);

    // Should find the cell at (0,0) with pointIndex 0
    let found = false;
    for (let i = 0; i < index.queryResultsCount; i++) {
      const r = index.queryResults[i];
      if (r.layer === layer && r.cellX === 0 && r.cellY === 0 && r.pointIndex === 0) {
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it('excludes the source cell from query results', () => {
    const layer = makeLayer('a', 0);
    layer.cells[0][0] = spriteCell('test/tile_10101010');

    const index = new L0PointIndex();
    index.buildFromLayers([layer]);

    const cp = connectionPointL0(0, 0, 0, 0, 0, 0);
    index.queryPoint(cp.x, cp.y, layer, 0, 0); // exclude cell (0,0)
    // No other cells at this point, so results should be empty
    expect(index.queryResultsCount).toBe(0);
  });

  it('finds multiple cells sharing the same L0 point', () => {
    const layer = makeLayer('a', 0);
    // cell (0,0) has S connection point at (0.5, 1)
    // cell (0,1) has N connection point at (0.5, 1)
    layer.cells[0][0] = spriteCell('test/tile_10101010');
    layer.cells[1][0] = spriteCell('test/tile_10101010');

    const index = new L0PointIndex();
    index.buildFromLayers([layer]);

    // Query the shared point (0.5, 1)
    const cp = connectionPointL0(0, 0, 4, 0, 0, 0); // S of (0,0)
    index.queryPoint(cp.x, cp.y, layer, 99, 99);
    expect(index.queryResultsCount).toBeGreaterThanOrEqual(2);
  });

  it('handles multi-layer overlapping points', () => {
    const l0 = makeLayer('l0', 0);
    const l1 = makeLayer('l1', 1);
    // L1 cell (0,0) covers L0 cells (0,0)-(1,1). Its N point is at (1, 0) in L0 space.
    l1.cells[0][0] = spriteCell('test/tile_11111111');
    // L0 cell (1,0) has NW point at (1, 0)
    l0.cells[0][1] = spriteCell('test/tile_10101010');

    const index = new L0PointIndex();
    index.buildFromLayers([l0, l1]);

    // Query (1, 0) — should find entries from both layers
    index.queryPoint(1, 0, l0, 99, 99);
    const layers = new Set<string>();
    for (let i = 0; i < index.queryResultsCount; i++) {
      layers.add(index.queryResults[i].layer.id);
    }
    expect(layers.has('l0')).toBe(true);
    expect(layers.has('l1')).toBe(true);
  });

  it('correctly removes a cell', () => {
    const layer = makeLayer('a', 0);
    layer.cells[0][0] = spriteCell('test/tile_10101010');

    const index = new L0PointIndex();
    index.buildFromLayers([layer]);

    // Verify it's there
    const cp = connectionPointL0(0, 0, 0, 0, 0, 0);
    index.queryPoint(cp.x, cp.y, layer, 99, 99);
    expect(index.queryResultsCount).toBeGreaterThan(0);

    // Remove it
    index.removeCell(layer, 0, 0);

    // Verify it's gone from all 8 connection points
    for (let p = 0; p < 8; p++) {
      const pt = connectionPointL0(0, 0, p, 0, 0, 0);
      index.queryPoint(pt.x, pt.y, layer, 99, 99);
      for (let i = 0; i < index.queryResultsCount; i++) {
        const r = index.queryResults[i];
        expect(r.layer === layer && r.cellX === 0 && r.cellY === 0).toBe(false);
      }
    }
  });

  it('handles half-integer coordinates (shifted layers)', () => {
    const layer = makeLayer('shifted', 0);
    layer.shiftX = 0.5;
    layer.shiftY = 0.5;
    layer.cells[0][0] = spriteCell('test/tile_11111111');

    const index = new L0PointIndex();
    index.buildFromLayers([layer]);

    // N point of shifted (0,0): baseX = (0 + 0.5)*1 = 0.5, baseY = (0+0.5)*1 = 0.5
    // N = (baseX + S/2, baseY) = (1.0, 0.5)
    const cp = connectionPointL0(0, 0, 0, 0, 0.5, 0.5);
    index.queryPoint(cp.x, cp.y, layer, 99, 99);
    expect(index.queryResultsCount).toBeGreaterThan(0);
  });

  it('handles boundary coordinates (0 and 32)', () => {
    const layer = makeLayer('a', 0);
    // Cell at (0,0): NW point is at (0, 0) which is a boundary
    layer.cells[0][0] = spriteCell('test/tile_11111111');
    // Cell at (31,31): SE point is at (32, 32)
    layer.cells[31][31] = spriteCell('test/tile_11111111');

    const index = new L0PointIndex();
    index.buildFromLayers([layer]);

    // Query boundary points
    index.queryPoint(0, 0, layer, 99, 99);
    expect(index.queryResultsCount).toBeGreaterThan(0);

    index.queryPoint(32, 32, layer, 99, 99);
    expect(index.queryResultsCount).toBeGreaterThan(0);
  });

  it('returns correct connection values', () => {
    const layer = makeLayer('a', 0);
    // tile_10101010 has: N=true, NE=false, E=true, SE=false, S=true, SW=false, W=true, NW=false
    layer.cells[0][0] = spriteCell('test/tile_10101010');

    const index = new L0PointIndex();
    index.buildFromLayers([layer]);

    const sig = getRenderedSignature(layer.cells[0][0]!);
    expect(sig).not.toBeNull();

    for (let p = 0; p < 8; p++) {
      const cp = connectionPointL0(0, 0, p, 0, 0, 0);
      index.queryPoint(cp.x, cp.y, layer, 99, 99);
      let foundValue: boolean | undefined;
      for (let i = 0; i < index.queryResultsCount; i++) {
        const r = index.queryResults[i];
        if (r.layer === layer && r.cellX === 0 && r.cellY === 0 && r.pointIndex === p) {
          foundValue = r.value;
        }
      }
      expect(foundValue).toBe(sig![p]);
    }
  });

  it('handles empty layers', () => {
    const layer = makeLayer('empty', 0);
    const index = new L0PointIndex();
    index.buildFromLayers([layer]);

    index.queryPoint(1, 1, layer, 0, 0);
    expect(index.queryResultsCount).toBe(0);
  });

  it('skips invisible layers', () => {
    const layer = makeLayer('hidden', 0);
    layer.visible = false;
    layer.cells[0][0] = spriteCell('test/tile_10101010');

    const index = new L0PointIndex();
    index.buildFromLayers([layer]);

    const cp = connectionPointL0(0, 0, 0, 0, 0, 0);
    index.queryPoint(cp.x, cp.y, layer, 99, 99);
    expect(index.queryResultsCount).toBe(0);
  });

  it('clear resets the index', () => {
    const layer = makeLayer('a', 0);
    layer.cells[0][0] = spriteCell('test/tile_10101010');

    const index = new L0PointIndex();
    index.buildFromLayers([layer]);

    index.clear();

    const cp = connectionPointL0(0, 0, 0, 0, 0, 0);
    index.queryPoint(cp.x, cp.y, layer, 99, 99);
    expect(index.queryResultsCount).toBe(0);
  });

  it('incremental insertCell works after buildFromLayers', () => {
    const layer = makeLayer('a', 0);

    const index = new L0PointIndex();
    index.buildFromLayers([layer]); // empty

    // Now add a cell and insert it
    layer.cells[2][3] = spriteCell('test/tile_11111111');
    index.insertCell(layer, 3, 2);

    const cp = connectionPointL0(3, 2, 0, 0, 0, 0);
    index.queryPoint(cp.x, cp.y, layer, 99, 99);
    expect(index.queryResultsCount).toBeGreaterThan(0);
  });

  it('removeCell + insertCell handles cell replacement', () => {
    const layer = makeLayer('a', 0);
    layer.cells[0][0] = spriteCell('test/tile_10101010');

    const index = new L0PointIndex();
    index.buildFromLayers([layer]);

    // Replace with a different cell
    index.removeCell(layer, 0, 0);
    layer.cells[0][0] = spriteCell('test/tile_01010101');
    index.insertCell(layer, 0, 0);

    // Check that the new values are correct
    const sig = getRenderedSignature(layer.cells[0][0]!);
    for (let p = 0; p < 8; p++) {
      const cp = connectionPointL0(0, 0, p, 0, 0, 0);
      index.queryPoint(cp.x, cp.y, layer, 99, 99);
      for (let i = 0; i < index.queryResultsCount; i++) {
        const r = index.queryResults[i];
        if (r.layer === layer && r.cellX === 0 && r.cellY === 0 && r.pointIndex === p) {
          expect(r.value).toBe(sig![p]);
        }
      }
    }
  });

  it('handles mixed grid levels', () => {
    const l0 = makeLayer('l0', 0); // 32x32, S=1
    const l2 = makeLayer('l2', 2); // 8x8, S=4

    l0.cells[0][0] = spriteCell('test/tile_11111111');
    l2.cells[0][0] = spriteCell('test/tile_11111111');

    const index = new L0PointIndex();
    index.buildFromLayers([l0, l2]);

    // L2 cell (0,0) N point: S=4, baseX=0, baseY=0, N = (2, 0)
    // L0 cell at (2,0) has NW point at (2, 0) — same spot
    l0.cells[0][2] = spriteCell('test/tile_10101010');
    index.insertCell(l0, 2, 0);

    index.queryPoint(2, 0, l0, 99, 99);
    const layerIds = new Set<string>();
    for (let i = 0; i < index.queryResultsCount; i++) {
      layerIds.add(index.queryResults[i].layer.id);
    }
    expect(layerIds.has('l0')).toBe(true);
    expect(layerIds.has('l2')).toBe(true);
  });
});
