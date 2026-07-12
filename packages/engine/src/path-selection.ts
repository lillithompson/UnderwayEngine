/**
 * Path selection logic — pure functions, no JSX.
 */
import { GridLevel, CELL_COUNTS, Selection } from './types';

/**
 * Check if a cell at targetLevel is within the path selection.
 * Empty set → true (no constraint).
 * Same level → direct lookup.
 * Target coarser (higher level): true only if ALL sub-cells at pathLevel are selected.
 * Target finer (lower level): true if the containing pathLevel cell is selected.
 */
export function isCellInPathSelection(
  pathIndices: Set<number>,
  pathLevel: GridLevel,
  targetLevel: GridLevel,
  cellX: number,
  cellY: number,
): boolean {
  if (pathIndices.size === 0) return true;

  const pathCount = CELL_COUNTS[pathLevel];
  const targetCount = CELL_COUNTS[targetLevel];

  if (targetLevel === pathLevel) {
    return pathIndices.has(cellY * pathCount + cellX);
  }

  if (targetLevel > pathLevel) {
    // Target is coarser — each target cell covers multiple path-level cells
    // ratio = pathCount / targetCount (e.g. L0=32 target L1=16 → ratio=2)
    const ratio = pathCount / targetCount;
    const startX = cellX * ratio;
    const startY = cellY * ratio;
    for (let dy = 0; dy < ratio; dy++) {
      for (let dx = 0; dx < ratio; dx++) {
        if (!pathIndices.has((startY + dy) * pathCount + (startX + dx))) {
          return false;
        }
      }
    }
    return true;
  }

  // Target is finer — find which pathLevel cell contains it
  const ratio = targetCount / pathCount;
  const pathX = Math.floor(cellX / ratio);
  const pathY = Math.floor(cellY / ratio);
  return pathIndices.has(pathY * pathCount + pathX);
}

/**
 * Convert path indices at any level to L0 coordinate space for overlay rendering.
 * L0 pass-through; coarser levels expand each index to constituent L0 cells.
 */
export function pathIndicesToL0(
  pathIndices: Set<number>,
  pathLevel: GridLevel,
): Set<number> {
  const l0Count = CELL_COUNTS[0]; // 32
  if (pathLevel === 0) return new Set(pathIndices);

  const pathCount = CELL_COUNTS[pathLevel];
  const ratio = l0Count / pathCount;
  const result = new Set<number>();

  for (const idx of pathIndices) {
    const px = idx % pathCount;
    const py = Math.floor(idx / pathCount);
    const startX = px * ratio;
    const startY = py * ratio;
    for (let dy = 0; dy < ratio; dy++) {
      for (let dx = 0; dx < ratio; dx++) {
        result.add((startY + dy) * l0Count + (startX + dx));
      }
    }
  }

  return result;
}

/**
 * Compute bounding-rect Selection from path indices.
 * Returns null if the set is empty.
 */
export function pathBoundsToSelection(
  pathIndices: Set<number>,
  pathLevel: GridLevel,
): Selection | null {
  if (pathIndices.size === 0) return null;
  const pathCount = CELL_COUNTS[pathLevel];
  let minX = pathCount, minY = pathCount, maxX = 0, maxY = 0;
  for (const idx of pathIndices) {
    const cx = idx % pathCount;
    const cy = Math.floor(idx / pathCount);
    if (cx < minX) minX = cx;
    if (cx > maxX) maxX = cx;
    if (cy < minY) minY = cy;
    if (cy > maxY) maxY = cy;
  }
  return { startCellX: minX, startCellY: minY, endCellX: maxX, endCellY: maxY, level: pathLevel };
}

/**
 * Shift all path indices by (dx, dy). Indices that fall out of bounds are dropped.
 */
export function translatePathIndices(
  pathIndices: Set<number>,
  pathLevel: GridLevel,
  dx: number,
  dy: number,
): Set<number> {
  const pathCount = CELL_COUNTS[pathLevel];
  const result = new Set<number>();
  for (const idx of pathIndices) {
    const cx = idx % pathCount + dx;
    const cy = Math.floor(idx / pathCount) + dy;
    if (cx >= 0 && cx < pathCount && cy >= 0 && cy < pathCount) {
      result.add(cy * pathCount + cx);
    }
  }
  return result;
}

/**
 * Rotate path indices around the selection center.
 * Uses the same rotation convention as rotateOffset in cells.ts.
 */
export function rotatePathIndices(
  pathIndices: Set<number>,
  pathLevel: GridLevel,
  rotation: 0 | 90 | 180 | 270,
  selection: Selection,
): Set<number> {
  if (rotation === 0) return new Set(pathIndices);
  const pathCount = CELL_COUNTS[pathLevel];
  const cx0 = (selection.startCellX + selection.endCellX + 1) / 2;
  const cy0 = (selection.startCellY + selection.endCellY + 1) / 2;
  const result = new Set<number>();
  for (const idx of pathIndices) {
    const x = idx % pathCount;
    const y = Math.floor(idx / pathCount);
    const dx = x + 0.5 - cx0;
    const dy = y + 0.5 - cy0;
    let rx: number, ry: number;
    switch (rotation) {
      case 90:  rx = -dy; ry = dx;  break;
      case 180: rx = -dx; ry = -dy; break;
      case 270: rx = dy;  ry = -dx; break;
      default:  rx = dx;  ry = dy;  break;
    }
    const nx = Math.floor(rx + cx0);
    const ny = Math.floor(ry + cy0);
    if (nx >= 0 && nx < pathCount && ny >= 0 && ny < pathCount) {
      result.add(ny * pathCount + nx);
    }
  }
  return result;
}

/**
 * Mirror path indices within the selection bounding rect.
 * 'h' flips left/right, 'v' flips top/bottom.
 */
export function mirrorPathIndices(
  pathIndices: Set<number>,
  pathLevel: GridLevel,
  axis: 'h' | 'v',
  selection: Selection,
): Set<number> {
  const pathCount = CELL_COUNTS[pathLevel];
  const result = new Set<number>();
  for (const idx of pathIndices) {
    const x = idx % pathCount;
    const y = Math.floor(idx / pathCount);
    let nx: number, ny: number;
    if (axis === 'h') {
      nx = selection.startCellX + selection.endCellX - x;
      ny = y;
    } else {
      nx = x;
      ny = selection.startCellY + selection.endCellY - y;
    }
    if (nx >= 0 && nx < pathCount && ny >= 0 && ny < pathCount) {
      result.add(ny * pathCount + nx);
    }
  }
  return result;
}
