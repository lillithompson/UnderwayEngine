/**
 * Path-segment utilities: clone, offset, and the two defensive mappers.
 *
 * Pure geometry-free plumbing over `PathSegment` / `SVGSubpath` — no
 * composition state, no scene graph, no imports but the types. That is the
 * point: it has no cycle with anything, so every module that needs to copy
 * or shift a segment can reach it directly instead of inlining its own.
 * `sceneNodeGeometry` carried a byte-identical private `offsetSeg` for
 * exactly that reason until this module existed.
 *
 * Split out of `compositionOps` in P7, unchanged. `compositionOps`
 * re-exports all four, so existing importers are unaffected.
 */

import { PathSegment, SVGSubpath } from './types';

/** Shift a path segment by (dx, dy), arc centre included. */
export function offsetPathSegment(seg: PathSegment, dx: number, dy: number): PathSegment {
  return seg.kind === 'arc'
    ? { kind: 'arc', start: [seg.start[0] + dx, seg.start[1] + dy], end: [seg.end[0] + dx, seg.end[1] + dy], center: [seg.center[0] + dx, seg.center[1] + dy] }
    : { kind: 'line', start: [seg.start[0] + dx, seg.start[1] + dy], end: [seg.end[0] + dx, seg.end[1] + dy] };
}

/**
 * Deep-clone a path segment, preserving its `kind` discriminator. Used at
 * grouping boundaries where world segments are snapshotted into
 * `localSegments`.
 */
export function clonePathSegment(seg: PathSegment): PathSegment {
  if (seg.kind === 'arc') {
    return {
      kind: 'arc',
      start: [seg.start[0], seg.start[1]],
      end: [seg.end[0], seg.end[1]],
      center: [seg.center[0], seg.center[1]],
    };
  }
  return {
    kind: 'line',
    start: [seg.start[0], seg.start[1]],
    end: [seg.end[0], seg.end[1]],
  };
}

/** Map a PathSegment array, tolerating undefined and (defensively) any
 *  non-array shape that a corrupt save or partial deserialize might
 *  surface here. Real arrays go through `.map(fn)` exactly as before;
 *  any other defined-but-non-array value coerces to `[]` and emits a
 *  one-shot warn so we have a breadcrumb the next time it surfaces.
 *  Returns undefined when input is undefined so optional fields
 *  (`localSegments`, `identitySegments`) stay optional. */
export function safeMapSegments(
  segs: ReadonlyArray<PathSegment> | undefined,
  fn: (seg: PathSegment) => PathSegment,
): PathSegment[] | undefined {
  if (segs === undefined) return undefined;
  if (!Array.isArray(segs)) {
    if (typeof console !== 'undefined') console.warn('[pathSegmentUtils] expected PathSegment[], got', segs);
    return [];
  }
  return segs.map(fn);
}

/** Map an SVGSubpath array, applying `fn` to each subpath's segments via
 *  `safeMapSegments`. Same defensive contract: undefined in â†’ undefined
 *  out; non-array in â†’ undefined out (the SVG had a bad subpaths shape;
 *  drop it rather than synthesize one). */
export function safeMapSubpaths(
  subs: SVGSubpath[] | undefined,
  fn: (seg: PathSegment) => PathSegment,
): SVGSubpath[] | undefined {
  if (subs === undefined) return undefined;
  if (!Array.isArray(subs)) {
    if (typeof console !== 'undefined') console.warn('[pathSegmentUtils] expected SVGSubpath[], got', subs);
    return undefined;
  }
  return subs.map(sub => ({ ...sub, segments: safeMapSegments(sub.segments, fn) ?? [] }));
}
