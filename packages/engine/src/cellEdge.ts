import { Layer, CellState } from './types';

/**
 * Shift-aware cell read that handles the edge slots (x=-1 / y=-1 / corner)
 * used by half-shifted layers. Split out from `cells.ts` so the pure
 * SVG-export path can import this without dragging in the GL/atlas
 * runtime that `cells.ts` depends on.
 */
export function getCell(layer: Layer, cellX: number, cellY: number): CellState | null {
  if (cellX === -1 && cellY === -1) return layer.edgeCorner;
  if (cellY === -1) return layer.edgeRowTop ? layer.edgeRowTop[cellX] : null;
  if (cellX === -1) return layer.edgeColLeft ? layer.edgeColLeft[cellY] : null;
  return layer.cells[cellY][cellX];
}

export function setCell(layer: Layer, cellX: number, cellY: number, state: CellState | null): void {
  if (cellX === -1 && cellY === -1) { layer.edgeCorner = state; return; }
  if (cellY === -1) { if (layer.edgeRowTop) layer.edgeRowTop[cellX] = state; return; }
  if (cellX === -1) { if (layer.edgeColLeft) layer.edgeColLeft[cellY] = state; return; }
  layer.cells[cellY][cellX] = state;
}
