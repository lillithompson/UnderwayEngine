import { collectFigureColors, packColor } from '../figureColors';
import { CellState, DEFAULT_TRANSFORM, Layer } from '../types';
import { makeLayer } from './test-utils';

const color = (r: number, g: number, b: number): CellState => ({
  type: 'color',
  r, g, b,
  transform: DEFAULT_TRANSFORM,
});

const tintedSprite = (r: number, g: number, b: number): CellState => ({
  type: 'sprite',
  spriteId: 'test/tile',
  transform: DEFAULT_TRANSFORM,
  tintR: r, tintG: g, tintB: b,
});

const plainSprite = (): CellState => ({
  type: 'sprite',
  spriteId: 'test/tile',
  transform: DEFAULT_TRANSFORM,
});

function layerWithCells(cells: Array<{ x: number; y: number; state: CellState }>): Layer {
  const layer = makeLayer('L', 2, 0);
  for (const c of cells) {
    layer.cells[c.y][c.x] = c.state;
  }
  return layer;
}

describe('collectFigureColors', () => {
  test('returns empty for no layers', () => {
    expect(collectFigureColors([])).toEqual([]);
  });

  test('returns empty for layers with no colored cells', () => {
    const layer = makeLayer('a', 2, 0);
    expect(collectFigureColors([layer])).toEqual([]);
  });

  test('collects unique color cells', () => {
    const layer = layerWithCells([
      { x: 0, y: 0, state: color(10, 20, 30) },
      { x: 1, y: 0, state: color(40, 50, 60) },
    ]);
    expect(collectFigureColors([layer])).toEqual([
      [10, 20, 30],
      [40, 50, 60],
    ]);
  });

  test('deduplicates repeated colors across cells and layers', () => {
    const a = layerWithCells([
      { x: 0, y: 0, state: color(10, 20, 30) },
      { x: 1, y: 0, state: color(10, 20, 30) },
    ]);
    const b = layerWithCells([
      { x: 0, y: 0, state: color(10, 20, 30) },
      { x: 1, y: 1, state: color(40, 50, 60) },
    ]);
    expect(collectFigureColors([a, b])).toEqual([
      [10, 20, 30],
      [40, 50, 60],
    ]);
  });

  test('includes tinted sprite colors', () => {
    const layer = layerWithCells([
      { x: 0, y: 0, state: tintedSprite(200, 100, 50) },
    ]);
    expect(collectFigureColors([layer])).toEqual([[200, 100, 50]]);
  });

  test('ignores untinted sprite cells', () => {
    const layer = layerWithCells([
      { x: 0, y: 0, state: plainSprite() },
    ]);
    expect(collectFigureColors([layer])).toEqual([]);
  });

  test('ignores null cells', () => {
    const layer = layerWithCells([
      { x: 0, y: 0, state: color(10, 20, 30) },
    ]);
    layer.cells[5][5] = null;
    expect(collectFigureColors([layer])).toEqual([[10, 20, 30]]);
  });

  test('excludeSet filters out matching colors', () => {
    const layer = layerWithCells([
      { x: 0, y: 0, state: color(10, 20, 30) },
      { x: 1, y: 0, state: color(40, 50, 60) },
    ]);
    const exclude = new Set<number>([packColor(10, 20, 30)]);
    expect(collectFigureColors([layer], exclude)).toEqual([[40, 50, 60]]);
  });

  test('includes edge cells (edgeRowTop, edgeColLeft, edgeCorner)', () => {
    const layer = makeLayer('edge', 2, 0);
    layer.edgeRowTop = [color(1, 2, 3), null];
    layer.edgeColLeft = [color(4, 5, 6), null];
    layer.edgeCorner = color(7, 8, 9);
    expect(collectFigureColors([layer])).toEqual([
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ]);
  });

  test('order is deterministic by first occurrence', () => {
    const layer = layerWithCells([
      { x: 0, y: 0, state: color(30, 30, 30) },
      { x: 1, y: 0, state: color(10, 10, 10) },
      { x: 2, y: 0, state: color(20, 20, 20) },
      { x: 0, y: 1, state: color(10, 10, 10) },
    ]);
    expect(collectFigureColors([layer])).toEqual([
      [30, 30, 30],
      [10, 10, 10],
      [20, 20, 20],
    ]);
  });

  test('mixes color cells and tinted sprite cells, deduping across both', () => {
    const layer = layerWithCells([
      { x: 0, y: 0, state: color(200, 100, 50) },
      { x: 1, y: 0, state: tintedSprite(200, 100, 50) },
      { x: 2, y: 0, state: tintedSprite(1, 2, 3) },
    ]);
    expect(collectFigureColors([layer])).toEqual([
      [200, 100, 50],
      [1, 2, 3],
    ]);
  });
});
