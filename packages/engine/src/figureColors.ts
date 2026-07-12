import { Layer, CellState } from './types';

function pack(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b;
}

function addFromCell(
  cell: CellState,
  seen: Set<number>,
  excludeSet: Set<number> | undefined,
  out: [number, number, number][],
): void {
  if (cell === null) return;
  let r: number, g: number, b: number;
  if (cell.type === 'color') {
    r = cell.r;
    g = cell.g;
    b = cell.b;
  } else if (cell.type === 'sprite' && cell.tintR !== undefined && cell.tintG !== undefined && cell.tintB !== undefined) {
    r = cell.tintR;
    g = cell.tintG;
    b = cell.tintB;
  } else {
    return;
  }
  const key = pack(r, g, b);
  if (seen.has(key)) return;
  if (excludeSet && excludeSet.has(key)) return;
  seen.add(key);
  out.push([r, g, b]);
}

export function collectFigureColors(
  layers: Layer[],
  excludeSet?: Set<number>,
): [number, number, number][] {
  const seen = new Set<number>();
  const out: [number, number, number][] = [];
  for (const layer of layers) {
    const rows = layer.cells;
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y];
      if (!row) continue;
      for (let x = 0; x < row.length; x++) {
        addFromCell(row[x], seen, excludeSet, out);
      }
    }
    if (layer.edgeRowTop) {
      for (const c of layer.edgeRowTop) addFromCell(c, seen, excludeSet, out);
    }
    if (layer.edgeColLeft) {
      for (const c of layer.edgeColLeft) addFromCell(c, seen, excludeSet, out);
    }
    if (layer.edgeCorner) {
      addFromCell(layer.edgeCorner, seen, excludeSet, out);
    }
  }
  return out;
}

export function packColor(r: number, g: number, b: number): number {
  return pack(r, g, b);
}
