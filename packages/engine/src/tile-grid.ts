/**
 * Spiral cell ordering for draw-mode fill operations.
 * Pure logic — no JSX.
 */

/**
 * Returns cell indices in spiral order (outside-in) for a grid.
 * All cells are visited exactly once. Consecutive pairs are 8-adjacent.
 */
export function getSpiralCellOrder(columns: number, rows: number): number[] {
  return getSpiralCellOrderInRect(0, 0, rows - 1, columns - 1, columns);
}

/**
 * Returns cell indices in spiral order within a rectangular region.
 * Spirals inward from the boundary. Each cell index = row * gridColumns + col.
 */
export function getSpiralCellOrderInRect(
  minRow: number,
  minCol: number,
  maxRow: number,
  maxCol: number,
  gridColumns: number,
): number[] {
  const cells: number[] = [];
  let top = minRow;
  let bottom = maxRow;
  let left = minCol;
  let right = maxCol;

  while (top <= bottom && left <= right) {
    // Top row: left to right
    for (let col = left; col <= right; col++) {
      cells.push(top * gridColumns + col);
    }
    top++;

    // Right column: top to bottom
    for (let row = top; row <= bottom; row++) {
      cells.push(row * gridColumns + right);
    }
    right--;

    // Bottom row: right to left
    if (top <= bottom) {
      for (let col = right; col >= left; col--) {
        cells.push(bottom * gridColumns + col);
      }
      bottom--;
    }

    // Left column: bottom to top
    if (left <= right) {
      for (let row = bottom; row >= top; row--) {
        cells.push(row * gridColumns + left);
      }
      left++;
    }
  }

  return cells;
}
