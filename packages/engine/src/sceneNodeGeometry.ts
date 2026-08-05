/**
 * Geometry adapter layer: provides a uniform interface for transform
 * operations across the scene-object kinds (figure, svg, image, text).
 *
 * Each adapter wraps existing per-type functions so the algorithm
 * (translate, rotate, mirror, rescale, hitTest) lives in one place
 * while geometry specifics are encapsulated per-kind.
 *
 * These methods run only during user-initiated operations (gestures),
 * never in the per-frame render loop.
 */

import { CompositionFigure, SVGObject, ImageObject, TextObject, PathSegment, CompItemKind } from './types';
import { lineHitsCell } from './compositionLineHitTest';
import { arcBoundingBox } from './compositionArcHitTest';

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

function rescaleSegs(
  segments: ReadonlyArray<PathSegment>,
  oldBbox: Bbox, newBbox: Bbox,
): PathSegment[] {
  const sx = oldBbox.cellWidth > 0 ? newBbox.cellWidth / oldBbox.cellWidth : 1;
  const sy = oldBbox.cellHeight > 0 ? newBbox.cellHeight / oldBbox.cellHeight : 1;
  const mapPt = (pt: [number, number]): [number, number] => [
    newBbox.cellX + (pt[0] - oldBbox.cellX) * sx,
    newBbox.cellY + (pt[1] - oldBbox.cellY) * sy,
  ];
  return segments.map(seg => seg.kind === 'arc'
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

// ── Image adapter ───────────────────────────────────────────────────

const imageAdapter: GeometryAdapter<ImageObject> = {
  kind: 'image',

  computeBbox(img) {
    return { cellX: img.cellX, cellY: img.cellY, cellWidth: img.cellWidth, cellHeight: img.cellHeight };
  },

  translate(img, dx, dy) {
    const next: ImageObject = {
      ...img,
      cellX: img.cellX + dx, cellY: img.cellY + dy,
      identityCellX: undefined, identityCellY: undefined,
      identityCellWidth: undefined, identityCellHeight: undefined,
      rotation: undefined, mirrorH: undefined, mirrorV: undefined,
    };
    if (img.localCellX !== undefined && img.localCellY !== undefined) {
      next.localCellX = img.localCellX + dx;
      next.localCellY = img.localCellY + dy;
    }
    return next;
  },

  rotate90CW(img) {
    const curRot = img.rotation ?? 0;
    const newRot = ((curRot + 90) % 360) as 0 | 90 | 180 | 270;
    const idX = img.identityCellX ?? img.cellX;
    const idY = img.identityCellY ?? img.cellY;
    const idW = img.identityCellWidth ?? img.cellWidth;
    const idH = img.identityCellHeight ?? img.cellHeight;
    const cx = idX + idW / 2;
    const cy = idY + idH / 2;
    const swap = newRot === 90 || newRot === 270;
    const newW = swap ? idH : idW;
    const newH = swap ? idW : idH;
    const atIdentity = newRot === 0;
    return {
      ...img,
      cellX: cx - newW / 2, cellY: cy - newH / 2,
      cellWidth: newW, cellHeight: newH,
      rotation: newRot,
      identityCellX: atIdentity ? undefined : idX,
      identityCellY: atIdentity ? undefined : idY,
      identityCellWidth: atIdentity ? undefined : idW,
      identityCellHeight: atIdentity ? undefined : idH,
    };
  },

  mirror(img, screenAxis) {
    return { ...img, [screenAxis === 'h' ? 'mirrorH' : 'mirrorV']: !(img[screenAxis === 'h' ? 'mirrorH' : 'mirrorV'] ?? false) };
  },

  rescale(img, _old, newBbox) {
    return { ...img, ...newBbox };
  },

  hitTest(img, cellX, cellY, ignoreLock) {
    if (img.hidden) return false;
    if (img.locked && !ignoreLock) return false;
    return cellX >= img.cellX && cellX < img.cellX + img.cellWidth
      && cellY >= img.cellY && cellY < img.cellY + img.cellHeight;
  },
};

// ── Text adapter ────────────────────────────────────────────────────
//
// Bbox-only geometry, same transform model as images: `cell*` is the
// world rect, rotation/mirror are discrete flags, and translate clears
// the identity stash. Glyph rasters are cached off-node, so none of
// these operations touch text layout.

const textAdapter: GeometryAdapter<TextObject> = {
  kind: 'text',

  computeBbox(txt) {
    return { cellX: txt.cellX, cellY: txt.cellY, cellWidth: txt.cellWidth, cellHeight: txt.cellHeight };
  },

  translate(txt, dx, dy) {
    const next: TextObject = {
      ...txt,
      cellX: txt.cellX + dx, cellY: txt.cellY + dy,
      identityCellX: undefined, identityCellY: undefined,
      identityCellWidth: undefined, identityCellHeight: undefined,
      rotation: undefined, mirrorH: undefined, mirrorV: undefined,
    };
    if (txt.localCellX !== undefined && txt.localCellY !== undefined) {
      next.localCellX = txt.localCellX + dx;
      next.localCellY = txt.localCellY + dy;
    }
    return next;
  },

  rotate90CW(txt) {
    const curRot = txt.rotation ?? 0;
    const newRot = ((curRot + 90) % 360) as 0 | 90 | 180 | 270;
    const idX = txt.identityCellX ?? txt.cellX;
    const idY = txt.identityCellY ?? txt.cellY;
    const idW = txt.identityCellWidth ?? txt.cellWidth;
    const idH = txt.identityCellHeight ?? txt.cellHeight;
    const cx = idX + idW / 2;
    const cy = idY + idH / 2;
    const swap = newRot === 90 || newRot === 270;
    const newW = swap ? idH : idW;
    const newH = swap ? idW : idH;
    const atIdentity = newRot === 0;
    return {
      ...txt,
      cellX: cx - newW / 2, cellY: cy - newH / 2,
      cellWidth: newW, cellHeight: newH,
      rotation: newRot,
      identityCellX: atIdentity ? undefined : idX,
      identityCellY: atIdentity ? undefined : idY,
      identityCellWidth: atIdentity ? undefined : idW,
      identityCellHeight: atIdentity ? undefined : idH,
    };
  },

  mirror(txt, screenAxis) {
    return { ...txt, [screenAxis === 'h' ? 'mirrorH' : 'mirrorV']: !(txt[screenAxis === 'h' ? 'mirrorH' : 'mirrorV'] ?? false) };
  },

  rescale(txt, _old, newBbox) {
    return { ...txt, ...newBbox };
  },

  hitTest(txt, cellX, cellY, ignoreLock) {
    if (txt.hidden) return false;
    if (txt.locked && !ignoreLock) return false;
    return cellX >= txt.cellX && cellX < txt.cellX + txt.cellWidth
      && cellY >= txt.cellY && cellY < txt.cellY + txt.cellHeight;
  },
};

// ── Registry + lookup ───────────────────────────────────────────────

export const GEOMETRY_ADAPTERS: Record<CompItemKind, GeometryAdapter<any>> = {
  figure: figureAdapter,
  svg: svgAdapter,
  image: imageAdapter,
  text: textAdapter,
};

/** Resolve the geometry adapter for a given node id. */
export function adapterForId(id: string): GeometryAdapter<any> {
  if (id.startsWith('svg_')) return GEOMETRY_ADAPTERS.svg;
  if (id.startsWith('img_')) return GEOMETRY_ADAPTERS.image;
  if (id.startsWith('txt_')) return GEOMETRY_ADAPTERS.text;
  return GEOMETRY_ADAPTERS.figure;
}

// Generic operations (translateNodeByDelta, findSceneObjectAtCell) live
// in compositionOps.ts and use adapterForId() to dispatch per-kind.
