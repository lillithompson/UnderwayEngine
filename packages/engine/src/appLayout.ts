const COMPACT_WIDTH_THRESHOLD = 600;

export function isCompactWidth(width: number): boolean {
  return width < COMPACT_WIDTH_THRESHOLD;
}
