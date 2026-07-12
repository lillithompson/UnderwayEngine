import { PathSegment } from '../types';
import { properCrossings } from '../outlineUnion';

/**
 * Count proper (transversal) self-crossings among a set of outline segments.
 * A clean simple boundary has zero. Collinear / co-circular overlaps are
 * deliberately ignored by `properCrossings` and so are not counted here.
 */
export function countProperSelfCrossings(outline: PathSegment[]): number {
  let count = 0;
  for (let i = 0; i < outline.length; i++) {
    for (let j = i + 1; j < outline.length; j++) {
      count += properCrossings(outline[i], outline[j]);
    }
  }
  return count;
}
