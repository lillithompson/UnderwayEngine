import { PathSegment } from './types';
import { SVG_UNITS_PER_L0_CELL } from './svgExport';
import { getFlattenedClosedPath } from './compositionPathHitTest';
import { chainSegmentsLoops } from './compositionArcMath';
import { buildClosedFillPathD } from './svgPathBuilder';

/**
 * CSS `clip-path` construction for "Use as mask" shapes applied to
 * tile-mode objects — the DOM tile path renders CSS `background-repeat`
 * `<div>`s, which can't reference the SVG `<clipPath>` defs the non-tile
 * path uses. Logic-only (string-producing); active-mask resolution lives
 * in `compositionMask.ts`. Kept separate from `compositionMaskSVG.ts`
 * (SVG-markup output, depends on `svgPathBuilder`).
 *
 * The polygon is emitted in world SVG units (L0-cell verts ×
 * `SVG_UNITS_PER_L0_CELL`). Applied to an UNTRANSFORMED wrapper anchored at
 * the layer-container origin, so the coords are the wrapper's local space
 * and the container's camera transform co-transforms the clip with the
 * content — the same invariant the SVG `userSpaceOnUse` clip relies on.
 */

/**
 * A CSS `clip-path` string for the closed region of `segments`, or null when
 * the path is open / unchainable / degenerate (caller then applies no clip —
 * consistent with the SVG path skipping a broken mask).
 *
 * Single loop → `polygon(...)` (arcs flattened densely so a curved mask's tile
 * edge matches the SVG member's exact-arc boundary). Multiple loops — disjoint
 * regions and/or holes produced by a geometric union — can't be expressed by a
 * single `polygon()` ring, so emit `clip-path: path()` with the same
 * multi-subpath geometry the SVG `<clipPath>` uses (`buildClosedFillPathD`) and
 * a nonzero fill-rule, so holes subtract and disjoint regions each show.
 */
export function maskPolygonCSS(segments: readonly PathSegment[]): string | null {
  const loops = chainSegmentsLoops(segments);
  if (loops && loops.length > 1) {
    const d = buildClosedFillPathD(segments);
    return d ? `path(nonzero, '${d}')` : null;
  }
  const poly = getFlattenedClosedPath(segments, true);
  if (!poly || poly.length < 6) return null;
  const U = SVG_UNITS_PER_L0_CELL;
  let s = '';
  for (let i = 0; i < poly.length; i += 2) {
    if (i) s += ', ';
    s += `${poly[i] * U}px ${poly[i + 1] * U}px`;
  }
  return `polygon(${s})`;
}
