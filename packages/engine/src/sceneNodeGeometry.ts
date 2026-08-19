/**
 * Geometry adapter layer: provides a uniform interface for transform
 * operations across the scene-object kinds (figure, svg, image, text,
 * paint).
 *
 * Each adapter wraps existing per-type functions so the algorithm
 * (translate, rotate, mirror, rescale, hitTest) lives in one place
 * while geometry specifics are encapsulated per-kind.
 *
 * These methods run only during user-initiated operations (gestures),
 * never in the per-frame render loop.
 */

import { CompositionFigure, SVGObject, ImageObject, PaintObject, PatternObject, TextObject, PathSegment, CompItemKind } from './types';
import { lineHitsCell } from './compositionLineHitTest';
import { arcBoundingBox } from './compositionArcHitTest';
import { flattenArcSegment } from './compositionArcMath';

// Lazy-loaded to break circular dependency with compositionOps.ts
function getCompositionOps() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('./compositionOps') as typeof import('./compositionOps');
}

// ── Inline utilities (to avoid circular imports) ────────────────────

function offsetSeg(seg: PathSegment, dx: number, dy: number): PathSegment {
  return seg.kind === 'arc'
    ? { kind: 'arc', start: [seg.start[0] + dx, seg.start[1] + dy], end: [seg.end[0] + dx, seg.end[1] + dy], center: [seg.center[0] + dx, seg.center[1] + dy] }
    : { kind: 'line', start: [seg.start[0] + dx, seg.start[1] + dy], end: [seg.end[0] + dx, seg.end[1] + dy] };
}

function svgBbox(segments: ReadonlyArray<PathSegment>): { cellX: number; cellY: number; cellWidth: number; cellHeight: number } {
  const bb = arcBoundingBox(segments);
  if (!bb) return { cellX: 0, cellY: 0, cellWidth: 0, cellHeight: 0 };
  return { cellX: bb.minX, cellY: bb.minY, cellWidth: bb.maxX - bb.minX, cellHeight: bb.maxY - bb.minY };
}

/** Relative slack on "both axes scaled by the same factor" — the two
 *  factors are float quotients of coordinates that have themselves been
 *  through float scaling, so an exactly-uniform resize can land a few ulps
 *  apart and must not be read as a stretch. */
const UNIFORM_SCALE_EPS = 1e-9;

/**
 * Map a segment chain from `oldBbox` onto `newBbox` with independent x/y
 * factors. THE one implementation — the geometry adapters map `segments`
 * and each subpath through it, and `compositionOps.rescaleSVGToBbox` is a
 * re-export of it, so a stretch cannot mean two different things depending
 * on which door it came through.
 */
export function rescaleSegs(
  segments: ReadonlyArray<PathSegment>,
  oldBbox: Bbox, newBbox: Bbox,
): PathSegment[] {
  const sx = oldBbox.cellWidth > 0 ? newBbox.cellWidth / oldBbox.cellWidth : 1;
  const sy = oldBbox.cellHeight > 0 ? newBbox.cellHeight / oldBbox.cellHeight : 1;
  const mapPt = (pt: [number, number]): [number, number] => [
    newBbox.cellX + (pt[0] - oldBbox.cellX) * sx,
    newBbox.cellY + (pt[1] - oldBbox.cellY) * sy,
  ];
  // A STRETCH can't keep an arc an arc: its three points infer one radius,
  // and per-axis mapping leaves that radius disagreeing with the endpoints
  // (see flattenArcSegment). Shed the arcs into the polyline of the curve
  // they already are first, and the stretch turns them into true elliptical
  // arcs instead of kinked ones — which is what lets a MERGED object, whose
  // concatenated segments are a mix no uniform-scale rule guards, be
  // stretched smoothly at all.
  //
  // A uniform scale maps all three points by one factor, so the radius
  // stays honest: those arcs are kept exact, and a circle is still a circle.
  const uniform = Math.abs(sx - sy) <= Math.max(Math.abs(sx), Math.abs(sy)) * UNIFORM_SCALE_EPS;
  const source = uniform ? segments : segments.flatMap(flattenArcSegment);
  return source.map(seg => seg.kind === 'arc'
    ? { kind: 'arc', start: mapPt(seg.start), end: mapPt(seg.end), center: mapPt(seg.center) }
    : { kind: 'line', start: mapPt(seg.start), end: mapPt(seg.end) }
  );
}

// ── Shared types ────────────────────────────────────────────────────

export interface Bbox {
  cellX: number; cellY: number; cellWidth: number; cellHeight: number;
}

export interface SceneNodeBase {
  id: string;
  name?: string;
  cellX: number;
  cellY: number;
  cellWidth: number;
  cellHeight: number;
  rotation?: 0 | 90 | 180 | 270;
  /** Free (continuous) rotation in degrees CW about the bbox center,
   *  layered on top of the discrete `rotation`/`mirror`. */
  angleDeg?: number;
  mirrorH?: boolean;
  mirrorV?: boolean;
  locked?: boolean;
  groupId?: string;
  tileMode?: 'repeat';
  tileWidthL0?: number;
  tileHeightL0?: number;
}

// ── Geometry adapter interface ──────────────────────────────────────

export interface GeometryAdapter<T extends SceneNodeBase = SceneNodeBase> {
  kind: CompItemKind;

  /** Compute world bbox from the node's current geometry. */
  computeBbox(node: T): Bbox;

  /** Translate all geometry by (dx, dy). Returns a new node with shifted
   *  geometry and cleared identity/rotation/mirror state. */
  translate(node: T, dx: number, dy: number): T;

  /** Rotate 90 CW using the identity-stash stabilization pattern. */
  rotate90CW(node: T): T;

  /** Mirror on a screen axis (leaf adapters may simply toggle flags
   *  rather than use the identity-stash pattern). */
  mirror(node: T, screenAxis: 'h' | 'v'): T;

  /** Rescale geometry to fit within newBbox. */
  rescale(node: T, oldBbox: Bbox, newBbox: Bbox): T;

  /** Hit-test: does this node accept a click at (cellX, cellY)?
   *  When `ignoreLock` is true, locked nodes are still hit-testable. */
  hitTest(node: T, cellX: number, cellY: number, ignoreLock?: boolean): boolean;
}

// ── Figure adapter ──────────────────────────────────────────────────

const figureAdapter: GeometryAdapter<CompositionFigure> = {
  kind: 'figure',

  computeBbox(fig) {
    return { cellX: fig.cellX, cellY: fig.cellY, cellWidth: fig.cellWidth, cellHeight: fig.cellHeight };
  },

  translate(fig, dx, dy) {
    return {
      ...fig,
      cellX: fig.cellX + dx, cellY: fig.cellY + dy,
      identityCellX: undefined, identityCellY: undefined,
      transformCycleStep: undefined,
    };
  },

  rotate90CW(fig) {
    return getCompositionOps().rotateFigureIndividual90CW(fig);
  },

  mirror(fig, screenAxis) {
    return getCompositionOps().mirrorFigureIndividual(fig, screenAxis);
  },

  rescale(fig, _old, newBbox) {
    return {
      ...fig, ...newBbox,
      identityCellX: undefined, identityCellY: undefined,
      transformCycleStep: undefined,
    };
  },

  hitTest(fig, cellX, cellY, ignoreLock) {
    if (fig.hidden) return false;
    if (fig.locked && !ignoreLock) return false;
    if (fig.quads) {
      return fig.quads.some(q => {
        const qx = fig.cellX + q.offsetX, qy = fig.cellY + q.offsetY;
        return cellX >= qx && cellX < qx + q.cellWidth && cellY >= qy && cellY < qy + q.cellHeight;
      });
    }
    return cellX >= fig.cellX && cellX < fig.cellX + fig.cellWidth
      && cellY >= fig.cellY && cellY < fig.cellY + fig.cellHeight;
  },
};

// ── SVG adapter ─────────────────────────────────────────────────────

const svgAdapter: GeometryAdapter<SVGObject> = {
  kind: 'svg',

  computeBbox(svg) {
    return svgBbox(svg.segments);
  },

  translate(svg, dx, dy) {
    const offset = (seg: PathSegment) => offsetSeg(seg, dx, dy);
    const newSegs = Array.isArray(svg.segments) ? svg.segments.map(offset) : [];
    const newLocal = Array.isArray(svg.localSegments) ? svg.localSegments.map(offset) : undefined;
    const newSubs = Array.isArray(svg.subpaths)
      ? svg.subpaths.map(sub => ({ ...sub, segments: Array.isArray(sub.segments) ? sub.segments.map(offset) : [] }))
      : undefined;
    const next: SVGObject = {
      ...svg,
      segments: newSegs,
      subpaths: newSubs,
      identitySegments: undefined, rotation: undefined, mirrorH: undefined, mirrorV: undefined,
      cellX: svg.cellX + dx, cellY: svg.cellY + dy,
    };
    if (newLocal) {
      next.localSegments = newLocal;
      if (svg.localCellX !== undefined && svg.localCellY !== undefined) {
        next.localCellX = svg.localCellX + dx;
        next.localCellY = svg.localCellY + dy;
      }
    }
    if (svg.creationBox) {
      next.creationBox = { minX: svg.creationBox.minX + dx, minY: svg.creationBox.minY + dy, width: svg.creationBox.width, height: svg.creationBox.height };
    }
    return next;
  },

  rotate90CW(svg) {
    return getCompositionOps().rotateSVG90CW(svg);
  },

  mirror(svg, screenAxis) {
    return getCompositionOps().mirrorSVG(svg, screenAxis);
  },

  rescale(svg, oldBbox, newBbox) {
    if (svg.tileMode === 'repeat') {
      // Pattern mode: the region resizes, the tile does not — the segments
      // (one pattern unit) stay put and the renderer repeats them across the
      // new bbox. When the ORIGIN edge moves, shift the tile-grid offset the
      // opposite way so the pattern stays fixed in world space (Facet's
      // SCALE_FIGURE tile branch); a bottom/right-edge resize leaves it 0.
      const dx = newBbox.cellX - svg.cellX;
      const dy = newBbox.cellY - svg.cellY;
      const newOx = (svg.tileOffsetXL0 ?? 0) - dx;
      const newOy = (svg.tileOffsetYL0 ?? 0) - dy;
      return { ...svg, ...newBbox,
        tileOffsetXL0: newOx === 0 ? undefined : newOx,
        tileOffsetYL0: newOy === 0 ? undefined : newOy };
    }
    const newSegs = Array.isArray(svg.segments) ? rescaleSegs(svg.segments, oldBbox, newBbox) : [];
    const newSubpaths = Array.isArray(svg.subpaths)
      ? svg.subpaths.map(sub => ({ ...sub, segments: Array.isArray(sub.segments) ? rescaleSegs(sub.segments, oldBbox, newBbox) : [] }))
      : undefined;
    const next: SVGObject = {
      ...svg, segments: newSegs, subpaths: newSubpaths, ...newBbox,
      identitySegments: undefined, rotation: undefined, mirrorH: undefined, mirrorV: undefined,
    };
    // creationBox rides the same affine as the segments (degenerate old
    // axes fall back to scale 1, matching rescaleSegs), so an H/V line's
    // selection box and hit target stay glued to its stroke after a scale.
    if (svg.creationBox) {
      const sx = oldBbox.cellWidth > 0 ? newBbox.cellWidth / oldBbox.cellWidth : 1;
      const sy = oldBbox.cellHeight > 0 ? newBbox.cellHeight / oldBbox.cellHeight : 1;
      next.creationBox = {
        minX: newBbox.cellX + (svg.creationBox.minX - oldBbox.cellX) * sx,
        minY: newBbox.cellY + (svg.creationBox.minY - oldBbox.cellY) * sy,
        width: svg.creationBox.width * sx,
        height: svg.creationBox.height * sy,
      };
    }
    return next;
  },

  hitTest(svg, cellX, cellY, ignoreLock) {
    return lineHitsCell(svg, cellX, cellY, ignoreLock);
  },
};

// ── Bbox-only adapters (image, text, paint) ─────────────────────────
//
// Images, texts, and paint islands share one transform model: `cell*` is
// the world rect, rotation/mirror are discrete flags, translate clears
// the identity stash, and rescale swaps the bbox (content stretches with
// it — image bitmaps, glyph rasters, and paint tiles are all mapped
// through their frame at render time). One implementation, typed per
// kind at the registry.
//
// Paint hit-testing note: this bbox test is deliberately coarse — the
// selected-node sticky re-grab needs the whole bbox to accept. The
// precise ink-only refinement (so a sparse island's blank space falls
// through to objects behind it) lives in `findSceneObjectAtCell` via
// `paintObjectAlphaHitTest`, mirroring how svg path-distance refinement
// is layered over this adapter's bbox gate.

interface BboxOnlyNode extends SceneNodeBase {
  hidden?: boolean;
  localCellX?: number;
  localCellY?: number;
  identityCellX?: number;
  identityCellY?: number;
  identityCellWidth?: number;
  identityCellHeight?: number;
}

function makeBboxAdapter<T extends BboxOnlyNode>(kind: CompItemKind): GeometryAdapter<T> {
  return {
    kind,

    computeBbox(node) {
      return { cellX: node.cellX, cellY: node.cellY, cellWidth: node.cellWidth, cellHeight: node.cellHeight };
    },

    translate(node, dx, dy) {
      const next: T = {
        ...node,
        cellX: node.cellX + dx, cellY: node.cellY + dy,
        identityCellX: undefined, identityCellY: undefined,
        identityCellWidth: undefined, identityCellHeight: undefined,
        rotation: undefined, mirrorH: undefined, mirrorV: undefined,
      };
      if (node.localCellX !== undefined && node.localCellY !== undefined) {
        next.localCellX = node.localCellX + dx;
        next.localCellY = node.localCellY + dy;
      }
      return next;
    },

    rotate90CW(node) {
      const curRot = node.rotation ?? 0;
      const newRot = ((curRot + 90) % 360) as 0 | 90 | 180 | 270;
      const idX = node.identityCellX ?? node.cellX;
      const idY = node.identityCellY ?? node.cellY;
      const idW = node.identityCellWidth ?? node.cellWidth;
      const idH = node.identityCellHeight ?? node.cellHeight;
      const cx = idX + idW / 2;
      const cy = idY + idH / 2;
      const swap = newRot === 90 || newRot === 270;
      const newW = swap ? idH : idW;
      const newH = swap ? idW : idH;
      const atIdentity = newRot === 0;
      return {
        ...node,
        cellX: cx - newW / 2, cellY: cy - newH / 2,
        cellWidth: newW, cellHeight: newH,
        rotation: newRot,
        identityCellX: atIdentity ? undefined : idX,
        identityCellY: atIdentity ? undefined : idY,
        identityCellWidth: atIdentity ? undefined : idW,
        identityCellHeight: atIdentity ? undefined : idH,
      };
    },

    mirror(node, screenAxis) {
      return { ...node, [screenAxis === 'h' ? 'mirrorH' : 'mirrorV']: !(node[screenAxis === 'h' ? 'mirrorH' : 'mirrorV'] ?? false) };
    },

    rescale(node, _old, newBbox) {
      return { ...node, ...newBbox };
    },

    hitTest(node, cellX, cellY, ignoreLock) {
      if (node.hidden) return false;
      if (node.locked && !ignoreLock) return false;
      return cellX >= node.cellX && cellX < node.cellX + node.cellWidth
        && cellY >= node.cellY && cellY < node.cellY + node.cellHeight;
    },
  };
}

const imageAdapter: GeometryAdapter<ImageObject> = makeBboxAdapter<ImageObject>('image');
const textAdapter: GeometryAdapter<TextObject> = makeBboxAdapter<TextObject>('text');
const paintAdapter: GeometryAdapter<PaintObject> = makeBboxAdapter<PaintObject>('paint');

// Patterns are bbox-shaped, with two repeat-mode wrinkles.
//
// RESIZE resizes the REGION while the intrinsic tile stays put, so an
// origin-edge resize compensates the tile-grid offset to keep the pattern
// fixed in world space (same rule as the SVG adapter's tileMode branch):
// dragging an edge reveals more or less of a tiling that doesn't move.
//
// ROTATE is the opposite case, and used to be missed. Turning the region
// turns the whole thing — region AND tiling, rigidly — so the sub-section
// showing through must be the same picture, just on its side. The bbox
// adapter swings the box about its centre and leaves the tile grid alone,
// which slid the tiling under the region and brought a different part of
// it into view. So the tile box goes round with the region: its dimensions
// swap on a quarter turn, and its anchor is carried to where the rotation
// takes it.
const patternBboxAdapter = makeBboxAdapter<PatternObject>('pattern');

/** Is this pattern actually tiling? Both dims are needed to define the
 *  tile box; without them `repeat` is inert and the bake ignores it. */
function isRepeating(node: PatternObject): boolean {
  return node.tileMode === 'repeat' && node.tileWidthL0 != null && node.tileHeightL0 != null;
}

const patternAdapter: GeometryAdapter<PatternObject> = {
  ...patternBboxAdapter,

  rotate90CW(node) {
    const turned = patternBboxAdapter.rotate90CW(node) as PatternObject;
    if (!isRepeating(node)) return turned;
    const tw = node.tileWidthL0!;
    const th = node.tileHeightL0!;
    // The centre the box swung about — the same one makeBboxAdapter used,
    // which is the IDENTITY box's centre, not the current one.
    const idX = node.identityCellX ?? node.cellX;
    const idY = node.identityCellY ?? node.cellY;
    const cx = idX + (node.identityCellWidth ?? node.cellWidth) / 2;
    const cy = idY + (node.identityCellHeight ?? node.cellHeight) / 2;
    // The tile box's top-left after a clockwise quarter turn is the image
    // of its BOTTOM-left corner: (x, y) → (cx + (cy − y), cy + (x − cx)).
    const ax = node.cellX + (node.tileOffsetXL0 ?? 0);
    const ay = node.cellY + (node.tileOffsetYL0 ?? 0);
    const newAx = cx + (cy - (ay + th));
    const newAy = cy + (ax - cx);
    const newOx = newAx - turned.cellX;
    const newOy = newAy - turned.cellY;
    return {
      ...turned,
      // The tile turned with everything else, so its box stands on end.
      tileWidthL0: th,
      tileHeightL0: tw,
      tileOffsetXL0: newOx === 0 ? undefined : newOx,
      tileOffsetYL0: newOy === 0 ? undefined : newOy,
    };
  },

  mirror(node, screenAxis) {
    const flipped = patternBboxAdapter.mirror(node, screenAxis) as PatternObject;
    if (!isRepeating(node)) return flipped;
    // Reflect the tile box within the region it sits in, about the same
    // axis through the region's centre that the mirror flag reflects the
    // artwork about — otherwise the picture flips and its grid does not.
    const horizontal = screenAxis === 'h';
    const span = horizontal ? node.cellWidth : node.cellHeight;
    const tile = horizontal ? node.tileWidthL0! : node.tileHeightL0!;
    const off = (horizontal ? node.tileOffsetXL0 : node.tileOffsetYL0) ?? 0;
    const next = span - (off + tile);
    return {
      ...flipped,
      [horizontal ? 'tileOffsetXL0' : 'tileOffsetYL0']: next === 0 ? undefined : next,
    };
  },

  rescale(node, oldBbox, newBbox) {
    if (node.tileMode === 'repeat') {
      const dx = newBbox.cellX - node.cellX;
      const dy = newBbox.cellY - node.cellY;
      const newOx = (node.tileOffsetXL0 ?? 0) - dx;
      const newOy = (node.tileOffsetYL0 ?? 0) - dy;
      return { ...node, ...newBbox,
        tileOffsetXL0: newOx === 0 ? undefined : newOx,
        tileOffsetYL0: newOy === 0 ? undefined : newOy };
    }
    return patternBboxAdapter.rescale(node, oldBbox, newBbox);
  },
};

// ── Registry + lookup ───────────────────────────────────────────────

export const GEOMETRY_ADAPTERS: Record<CompItemKind, GeometryAdapter<any>> = {
  figure: figureAdapter,
  svg: svgAdapter,
  image: imageAdapter,
  text: textAdapter,
  paint: paintAdapter,
  pattern: patternAdapter,
};

/** Resolve the geometry adapter for a given node id. */
export function adapterForId(id: string): GeometryAdapter<any> {
  if (id.startsWith('svg_')) return GEOMETRY_ADAPTERS.svg;
  if (id.startsWith('img_')) return GEOMETRY_ADAPTERS.image;
  if (id.startsWith('txt_')) return GEOMETRY_ADAPTERS.text;
  if (id.startsWith('pnt_')) return GEOMETRY_ADAPTERS.paint;
  if (id.startsWith('pat_')) return GEOMETRY_ADAPTERS.pattern;
  return GEOMETRY_ADAPTERS.figure;
}

// Generic operations (translateNodeByDelta, findSceneObjectAtCell) live
// in compositionOps.ts and use adapterForId() to dispatch per-kind.
