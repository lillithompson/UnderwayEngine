/**
 * Draw-stroke geometry helpers.
 * Pure logic — no JSX.
 */

// ── Direction Mapping ────────────────────────────────────────────────
// Connection point indices: N=0, NE=1, E=2, SE=3, S=4, SW=5, W=6, NW=7
// Grid delta (dx, dy) for each direction (row increases downward):
//   N=(0,-1), NE=(1,-1), E=(1,0), SE=(1,1), S=(0,1), SW=(-1,1), W=(-1,0), NW=(-1,-1)

const DIR_DELTAS: [number, number][] = [
  [0, -1],  // 0 = N
  [1, -1],  // 1 = NE
  [1, 0],   // 2 = E
  [1, 1],   // 3 = SE
  [0, 1],   // 4 = S
  [-1, 1],  // 5 = SW
  [-1, 0],  // 6 = W
  [-1, -1], // 7 = NW
];

/**
 * Get the 8-direction index from one cell to an adjacent cell.
 * Returns -1 if cells are not 8-adjacent.
 */
export function getDirectionFromTo(
  fromCell: number,
  toCell: number,
  columns: number,
): number {
  const fromRow = Math.floor(fromCell / columns);
  const fromCol = fromCell % columns;
  const toRow = Math.floor(toCell / columns);
  const toCol = toCell % columns;
  const dx = toCol - fromCol;
  const dy = toRow - fromRow;
  if (dx < -1 || dx > 1 || dy < -1 || dy > 1 || (dx === 0 && dy === 0)) return -1;
  for (let d = 0; d < 8; d++) {
    if (DIR_DELTAS[d][0] === dx && DIR_DELTAS[d][1] === dy) return d;
  }
  return -1;
}

/** Opposite direction: N↔S, NE↔SW, etc. */
export function oppositeDirection(dir: number): number {
  return (dir + 4) & 7;
}

// ── Bresenham Line ───────────────────────────────────────────────────

/**
 * Bresenham's line algorithm on grid cells.
 * Returns all cell indices from start to end (inclusive).
 * Each consecutive pair is 8-adjacent.
 */
export function getLineCells(
  fromCell: number,
  toCell: number,
  columns: number,
): number[] {
  let x0 = fromCell % columns;
  let y0 = Math.floor(fromCell / columns);
  const x1 = toCell % columns;
  const y1 = Math.floor(toCell / columns);

  const cells: number[] = [];
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    cells.push(y0 * columns + x0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
  return cells;
}

// ── Stroke Neighbor Directions ───────────────────────────────────────

/**
 * Returns the direction(s) from stroke[index] toward its neighbors.
 * For the first cell: [dirToNext]
 * For intermediate cells: [dirToPrev, dirToNext]
 * For the last cell: [dirToPrev]
 * For single-cell stroke: []
 */
export function getStrokeNeighborDirections(
  stroke: number[],
  index: number,
  columns: number,
): number[] {
  const dirs: number[] = [];
  if (index > 0) {
    dirs.push(getDirectionFromTo(stroke[index], stroke[index - 1], columns));
  }
  if (index < stroke.length - 1) {
    dirs.push(getDirectionFromTo(stroke[index], stroke[index + 1], columns));
  }
  return dirs;
}
