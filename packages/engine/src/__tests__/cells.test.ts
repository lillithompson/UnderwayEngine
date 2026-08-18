import {
  createCellGrid,
  rebuildPixelData,
  renderCellToBuffer,
  sharedCellBuf,
} from '../cells';
import { CellState, CELL_COUNTS, LAYER_PX, cellPx, GridLevel } from '../types';
import { makeLayer } from './test-utils';

const RED: CellState = { type: 'color', r: 200, g: 10, b: 30, transform: { mirrorH: false, mirrorV: false, rotation: 0 } };

describe('createCellGrid', () => {
  it.each([0, 1, 2, 3, 4] as GridLevel[])('creates a %i-level grid with CELL_COUNTS dimensions', (level) => {
    const grid = createCellGrid(level);
    const count = CELL_COUNTS[level];
    expect(grid).toHaveLength(count);
    for (const row of grid) {
      expect(row).toHaveLength(count);
      expect(row.every((c) => c === null)).toBe(true);
    }
  });
});

describe('renderCellToBuffer', () => {
  it('fills sharedCellBuf with a solid color cell', () => {
    const size = cellPx(2); // 256
    const byteLen = renderCellToBuffer(RED, size, 2);
    expect(byteLen).toBe(size * size * 4);
    // First and last pixel of the rendered region
    expect(Array.from(sharedCellBuf.slice(0, 4))).toEqual([200, 10, 30, 255]);
    expect(Array.from(sharedCellBuf.slice(byteLen - 4, byteLen))).toEqual([200, 10, 30, 255]);
  });

  it('returns 0 for a null cell state', () => {
    expect(renderCellToBuffer(null, cellPx(0), 0)).toBe(0);
  });

  it('returns 0 for a sprite cell when the atlas has no tile (mocked loadTile)', () => {
    const sprite: CellState = {
      type: 'sprite',
      spriteId: 'test/tile_00000000',
      transform: { mirrorH: false, mirrorV: false, rotation: 0 },
    };
    expect(renderCellToBuffer(sprite, cellPx(0), 0)).toBe(0);
  });
});

describe('rebuildPixelData', () => {
  function pixelAt(data: Uint8Array, px: number, py: number): number[] {
    const idx = (py * LAYER_PX + px) * 4;
    return Array.from(data.slice(idx, idx + 4));
  }

  it('rasterizes a color cell into the layer pixel buffer', () => {
    const layer = makeLayer('l1', 0);
    layer.cells[3][5] = RED;
    rebuildPixelData(layer);

    const size = cellPx(0); // 64
    // Inside the cell
    expect(pixelAt(layer.data, 5 * size, 3 * size)).toEqual([200, 10, 30, 255]);
    expect(pixelAt(layer.data, 5 * size + size - 1, 3 * size + size - 1)).toEqual([200, 10, 30, 255]);
    // Just outside the cell stays empty
    expect(pixelAt(layer.data, 5 * size - 1, 3 * size)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(layer.data, 5 * size + size, 3 * size)).toEqual([0, 0, 0, 0]);
  });

  it('clears stale pixel data for cells that are now empty', () => {
    const layer = makeLayer('l1', 0);
    layer.data.fill(123); // garbage from a previous state
    rebuildPixelData(layer);
    expect(layer.data.every((b) => b === 0)).toBe(true);
  });

  it('applies half-cell shift when rasterizing shifted layers', () => {
    const layer = makeLayer('l1', 0);
    layer.shiftX = 0.5;
    layer.shiftY = 0.5;
    layer.cells[0][0] = RED;
    rebuildPixelData(layer);

    const size = cellPx(0); // 64, so shift is 32px
    const half = size / 2;
    // Origin area (before the shift) is empty
    expect(pixelAt(layer.data, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(layer.data, half - 1, half - 1)).toEqual([0, 0, 0, 0]);
    // Shifted cell region is filled
    expect(pixelAt(layer.data, half, half)).toEqual([200, 10, 30, 255]);
    expect(pixelAt(layer.data, half + size - 1, half + size - 1)).toEqual([200, 10, 30, 255]);
  });

  it('rasterizes edge cells (index -1) on shifted layers', () => {
    const layer = makeLayer('l1', 0);
    layer.shiftX = 0.5;
    const count = CELL_COUNTS[0];
    layer.edgeColLeft = new Array<CellState>(count).fill(null);
    layer.edgeColLeft[0] = RED;
    rebuildPixelData(layer);

    const size = cellPx(0);
    const half = size / 2;
    // Edge cell at cellX=-1 occupies pixels [0, half) horizontally (clipped)
    expect(pixelAt(layer.data, 0, 0)).toEqual([200, 10, 30, 255]);
    expect(pixelAt(layer.data, half - 1, size - 1)).toEqual([200, 10, 30, 255]);
    expect(pixelAt(layer.data, half, 0)).toEqual([0, 0, 0, 0]);
  });
});
