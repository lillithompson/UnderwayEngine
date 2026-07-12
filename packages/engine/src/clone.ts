/**
 * Clone tool offset algorithm.
 * Pure logic — no JSX.
 */

/**
 * Compute the mapped source index for clone painting using toroidal wrapping.
 *
 * Given a source cell, an anchor cell (first paint location), and a destination
 * cell, returns the flat index of the tile that should be copied to the
 * destination. The offset from anchor→dest is applied to the source with
 * wrap-around (double modulo for negative values).
 */
export function computeCloneMappedIndex(
  sourceIndex: number,
  anchorIndex: number,
  destIndex: number,
  rows: number,
  cols: number,
): number {
  const anchorRow = Math.floor(anchorIndex / cols);
  const anchorCol = anchorIndex % cols;
  const sourceRow = Math.floor(sourceIndex / cols);
  const sourceCol = sourceIndex % cols;
  const destRow = Math.floor(destIndex / cols);
  const destCol = destIndex % cols;

  const rowOffset = destRow - anchorRow;
  const colOffset = destCol - anchorCol;

  const mappedRow = ((sourceRow + rowOffset) % rows + rows) % rows;
  const mappedCol = ((sourceCol + colOffset) % cols + cols) % cols;

  return mappedRow * cols + mappedCol;
}
