import {
  CompositionFigure,
  GroupNode,
  ImageObject,
  Paint,
  PaintObject,
  PathSegment,
  PatternObject,
  SVGObject,
  SVGSubpath,
  TextObject,
} from './types';
import { arcBoundingBox } from './compositionArcHitTest';
import { frameGroupIdForNode } from './compositionFrame';
import { hiddenGroupIds } from './compositionOps';

/** Canonical canvas axis length in L0 cells. Soft target — the
 *  normalizer aims to fit content into a `[0, CANONICAL_SIZE]` box
 *  when possible, but allows content to exceed it for fine-grid
 *  compositions where the precision constraint (`MIN_GRID_LEVEL_FOR_ENCODING`)
 *  demands a larger scale. */
export const CANONICAL_SIZE = 32;

/** Lowest gridLevel whose snap step (= 2^level L0 units) is ≥ the
 *  quarter-cell encoding precision used by `encodeFixed` in
 *  `compositionBinaryFormat.ts` (which rounds to multiples of 0.25 L0).
 *  At gridLevel = -2 the snap step is exactly 0.25, so content drawn
 *  on the grid lands on the encoding grid; at gridLevel < -2 it doesn't.
 *  `normalizeComposition` picks its scale factor so the new gridLevel
 *  is always ≥ this value, preventing the silent precision loss that
 *  produced collapsed segments in older fine-grid files (Castle). */
export const MIN_GRID_LEVEL_FOR_ENCODING = -2;

/** Safety cap on the scale exponent. With `i16` quarter-cell encoding the
 *  representable range is ±8191.75 L0. Note the cap is heuristic, not
 *  sufficient on its own: 2^10 on a full 32-L0 bbox would yield ~32,768 L0,
 *  4× past the encoding limit (k=8 is the exact ceiling for a full-canvas
 *  bbox) — but reaching k=10 at all would require authoring at
 *  gridLevel ≤ -12 with content filling the canonical canvas, far past any
 *  realistic use, and kFit keeps real content much smaller. The cap is a
 *  defensive last line, not a proof of fit. */
export const MAX_PRECISION_K = 10;

export interface ContentBBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * AABB of every visible scene node in world (L0) coordinates. Walks
 * figures + SVG segments + images. Returns null when there is no content.
 *
 * Locked and grouped items are included — group members carry world
 * `cellX/Y/Width/Height` that's already the materialized world bbox, so
 * we don't need to walk into group transforms separately.
 *
 * Frame-aware when `groups` is supplied: a Figma-style frame (an `isFrame`
 * group) is the composition's page — content that overhangs it is clipped
 * away and invisible, so it must NOT drive the normalization anchor. We
 * therefore anchor to the frame's own boundary rect (its `isMask` member,
 * included even though it's a hidden clip-only shape) and SKIP the frame's
 * other members. Without this, dragging a framed photo past the frame edge
 * grew the content bbox, so `normalizeComposition` re-anchored the whole
 * scene — sliding the frame's clip rect off the fixed page background on
 * reopen (the photo then "clipped in a different place"). Omitting `groups`
 * keeps the legacy behavior (all visible content), so non-framed
 * compositions and the direct unit-tests are unaffected.
 */
export function computeContentBBox(
  figures: CompositionFigure[],
  svgObjects: SVGObject[],
  images: ImageObject[] | undefined,
  texts?: TextObject[],
  groups?: readonly GroupNode[],
  paints?: PaintObject[],
  patterns?: PatternObject[],
): ContentBBox | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let any = false;

  // Nearest `isFrame` ancestor of a node's group, or undefined. When there
  // are no frames (or `groups` is omitted) this is always undefined, so every
  // branch below collapses to the legacy "include all visible content" path.
  const frameOf = (groupId: string | undefined): string | undefined =>
    groups ? frameGroupIdForNode(groups, groupId) : undefined;

  // Inherited hide: a member of a hidden group is invisible even though its
  // own `hidden` flag is clear, so it must not drive the anchor either. A
  // hidden FRAME still anchors through its boundary rect (below), so hiding a
  // frame never re-anchors the page.
  const hiddenGroups = groups ? hiddenGroupIds(groups) : null;
  const inHiddenGroup = (groupId: string | undefined): boolean =>
    !!hiddenGroups && groupId !== undefined && hiddenGroups.has(groupId);

  for (const f of figures) {
    if (f.hidden || inHiddenGroup(f.groupId) || frameOf(f.groupId)) continue;
    any = true;
    if (f.cellX < minX) minX = f.cellX;
    if (f.cellY < minY) minY = f.cellY;
    if (f.cellX + f.cellWidth > maxX) maxX = f.cellX + f.cellWidth;
    if (f.cellY + f.cellHeight > maxY) maxY = f.cellY + f.cellHeight;
  }

  for (const s of svgObjects) {
    // A frame's boundary rect (an `isMask` member of an `isFrame` group) is
    // the page extent: keep it even though it's hidden. Any OTHER framed
    // member is clipped to that boundary, so it can't extend the anchor.
    const inFrame = frameOf(s.groupId);
    const isFrameBoundary = !!inFrame && !!s.isMask;
    if (!isFrameBoundary && (s.hidden || inHiddenGroup(s.groupId) || inFrame)) continue;
    any = true;
    const acc = (bb: { minX: number; minY: number; maxX: number; maxY: number } | null) => {
      if (!bb) return;
      if (bb.minX < minX) minX = bb.minX;
      if (bb.minY < minY) minY = bb.minY;
      if (bb.maxX > maxX) maxX = bb.maxX;
      if (bb.maxY > maxY) maxY = bb.maxY;
    };
    acc(arcBoundingBox(s.segments));
    if (s.subpaths) for (const sp of s.subpaths) acc(arcBoundingBox(sp.segments));
    // creationBox may extend beyond the segment AABB (it's the original drag
    // rectangle; for H/V lines the thin axis is wider than the segments).
    if (s.creationBox) {
      const cb = s.creationBox;
      if (cb.minX < minX) minX = cb.minX;
      if (cb.minY < minY) minY = cb.minY;
      if (cb.minX + cb.width > maxX) maxX = cb.minX + cb.width;
      if (cb.minY + cb.height > maxY) maxY = cb.minY + cb.height;
    }
  }

  if (images) {
    for (const img of images) {
      if (img.hidden || inHiddenGroup(img.groupId) || frameOf(img.groupId)) continue;
      any = true;
      if (img.cellX < minX) minX = img.cellX;
      if (img.cellY < minY) minY = img.cellY;
      if (img.cellX + img.cellWidth > maxX) maxX = img.cellX + img.cellWidth;
      if (img.cellY + img.cellHeight > maxY) maxY = img.cellY + img.cellHeight;
    }
  }

  if (texts) {
    for (const t of texts) {
      if (t.hidden || inHiddenGroup(t.groupId) || frameOf(t.groupId)) continue;
      any = true;
      if (t.cellX < minX) minX = t.cellX;
      if (t.cellY < minY) minY = t.cellY;
      if (t.cellX + t.cellWidth > maxX) maxX = t.cellX + t.cellWidth;
      if (t.cellY + t.cellHeight > maxY) maxY = t.cellY + t.cellHeight;
    }
  }

  if (paints) {
    for (const p of paints) {
      if (p.hidden || inHiddenGroup(p.groupId) || frameOf(p.groupId)) continue;
      any = true;
      if (p.cellX < minX) minX = p.cellX;
      if (p.cellY < minY) minY = p.cellY;
      if (p.cellX + p.cellWidth > maxX) maxX = p.cellX + p.cellWidth;
      if (p.cellY + p.cellHeight > maxY) maxY = p.cellY + p.cellHeight;
    }
  }

  if (patterns) {
    for (const p of patterns) {
      if (p.hidden || inHiddenGroup(p.groupId) || frameOf(p.groupId)) continue;
      any = true;
      if (p.cellX < minX) minX = p.cellX;
      if (p.cellY < minY) minY = p.cellY;
      if (p.cellX + p.cellWidth > maxX) maxX = p.cellX + p.cellWidth;
      if (p.cellY + p.cellHeight > maxY) maxY = p.cellY + p.cellHeight;
    }
  }

  if (!any || !Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

interface AffineTransform {
  /** out = (in - origin) * scale + offset */
  originX: number;
  originY: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

function applyTransformXY(tr: AffineTransform, x: number, y: number): [number, number] {
  return [(x - tr.originX) * tr.scale + tr.offsetX, (y - tr.originY) * tr.scale + tr.offsetY];
}

function applyTransformSegments(tr: AffineTransform, segments: PathSegment[]): PathSegment[] {
  return segments.map(seg => {
    if (seg.kind === 'arc') {
      const start = applyTransformXY(tr, seg.start[0], seg.start[1]);
      const end = applyTransformXY(tr, seg.end[0], seg.end[1]);
      const center = applyTransformXY(tr, seg.center[0], seg.center[1]);
      return { kind: 'arc', start, end, center };
    }
    const start = applyTransformXY(tr, seg.start[0], seg.start[1]);
    const end = applyTransformXY(tr, seg.end[0], seg.end[1]);
    return { kind: 'line', start, end };
  });
}

function applyTransformSubpaths(tr: AffineTransform, subpaths: SVGSubpath[]): SVGSubpath[] {
  return subpaths.map(sp => ({
    color: sp.color,
    segments: applyTransformSegments(tr, sp.segments),
  }));
}

function transformFigure(tr: AffineTransform, fig: CompositionFigure): CompositionFigure {
  const [cellX, cellY] = applyTransformXY(tr, fig.cellX, fig.cellY);
  const out: CompositionFigure = {
    ...fig,
    cellX,
    cellY,
    cellWidth: fig.cellWidth * tr.scale,
    cellHeight: fig.cellHeight * tr.scale,
  };
  if (fig.localCellX !== undefined && fig.localCellY !== undefined) {
    const [lx, ly] = applyTransformXY(tr, fig.localCellX, fig.localCellY);
    out.localCellX = lx;
    out.localCellY = ly;
  }
  if (fig.localCellWidth !== undefined) out.localCellWidth = fig.localCellWidth * tr.scale;
  if (fig.localCellHeight !== undefined) out.localCellHeight = fig.localCellHeight * tr.scale;
  if (fig.identityCellX !== undefined && fig.identityCellY !== undefined) {
    const [ix, iy] = applyTransformXY(tr, fig.identityCellX, fig.identityCellY);
    out.identityCellX = ix;
    out.identityCellY = iy;
  }
  if (fig.tileWidthL0 !== undefined) out.tileWidthL0 = fig.tileWidthL0 * tr.scale;
  if (fig.tileHeightL0 !== undefined) out.tileHeightL0 = fig.tileHeightL0 * tr.scale;
  if (fig.tileOffsetXL0 !== undefined) out.tileOffsetXL0 = fig.tileOffsetXL0 * tr.scale;
  if (fig.tileOffsetYL0 !== undefined) out.tileOffsetYL0 = fig.tileOffsetYL0 * tr.scale;
  if (fig.localTileWidthL0 !== undefined) out.localTileWidthL0 = fig.localTileWidthL0 * tr.scale;
  if (fig.localTileHeightL0 !== undefined) out.localTileHeightL0 = fig.localTileHeightL0 * tr.scale;
  if (fig.localTileOffsetXL0 !== undefined) out.localTileOffsetXL0 = fig.localTileOffsetXL0 * tr.scale;
  if (fig.localTileOffsetYL0 !== undefined) out.localTileOffsetYL0 = fig.localTileOffsetYL0 * tr.scale;
  return out;
}

function transformSVGObject(tr: AffineTransform, svg: SVGObject): SVGObject {
  const [cellX, cellY] = applyTransformXY(tr, svg.cellX, svg.cellY);
  const out: SVGObject = {
    ...svg,
    cellX,
    cellY,
    cellWidth: svg.cellWidth * tr.scale,
    cellHeight: svg.cellHeight * tr.scale,
    segments: applyTransformSegments(tr, svg.segments),
  };
  if (svg.subpaths) out.subpaths = applyTransformSubpaths(tr, svg.subpaths);
  if (svg.localSegments) out.localSegments = applyTransformSegments(tr, svg.localSegments);
  if (svg.localSubpaths) out.localSubpaths = applyTransformSubpaths(tr, svg.localSubpaths);
  if (svg.identitySegments) out.identitySegments = applyTransformSegments(tr, svg.identitySegments);
  if (svg.localCellX !== undefined && svg.localCellY !== undefined) {
    const [lx, ly] = applyTransformXY(tr, svg.localCellX, svg.localCellY);
    out.localCellX = lx;
    out.localCellY = ly;
  }
  if (svg.localCellWidth !== undefined) out.localCellWidth = svg.localCellWidth * tr.scale;
  if (svg.localCellHeight !== undefined) out.localCellHeight = svg.localCellHeight * tr.scale;
  if (svg.identityCellX !== undefined && svg.identityCellY !== undefined) {
    const [ix, iy] = applyTransformXY(tr, svg.identityCellX, svg.identityCellY);
    out.identityCellX = ix;
    out.identityCellY = iy;
  }
  if (svg.tileWidthL0 !== undefined) out.tileWidthL0 = svg.tileWidthL0 * tr.scale;
  if (svg.tileHeightL0 !== undefined) out.tileHeightL0 = svg.tileHeightL0 * tr.scale;
  if (svg.tileOffsetXL0 !== undefined) out.tileOffsetXL0 = svg.tileOffsetXL0 * tr.scale;
  if (svg.tileOffsetYL0 !== undefined) out.tileOffsetYL0 = svg.tileOffsetYL0 * tr.scale;
  if (svg.creationBox) {
    const [cx, cy] = applyTransformXY(tr, svg.creationBox.minX, svg.creationBox.minY);
    out.creationBox = {
      minX: cx,
      minY: cy,
      width: svg.creationBox.width * tr.scale,
      height: svg.creationBox.height * tr.scale,
    };
  }
  return out;
}

/** Bbox-only node transform, shared by images, texts, and paint islands.
 *  All three carry world, local, and identity bboxes but no free-form
 *  geometry. Content payloads (image pixels, glyph rasters, paint tiles +
 *  their object-local contentRect) are not touched: they are laid out
 *  against the node bbox at render time, so they ride the transform. */
function transformBboxNode<T extends {
  cellX: number; cellY: number; cellWidth: number; cellHeight: number;
  localCellX?: number; localCellY?: number; localCellWidth?: number; localCellHeight?: number;
  identityCellX?: number; identityCellY?: number; identityCellWidth?: number; identityCellHeight?: number;
}>(tr: AffineTransform, node: T): T {
  const [cellX, cellY] = applyTransformXY(tr, node.cellX, node.cellY);
  const out: T = {
    ...node,
    cellX,
    cellY,
    cellWidth: node.cellWidth * tr.scale,
    cellHeight: node.cellHeight * tr.scale,
  };
  if (node.localCellX !== undefined && node.localCellY !== undefined) {
    const [lx, ly] = applyTransformXY(tr, node.localCellX, node.localCellY);
    out.localCellX = lx;
    out.localCellY = ly;
  }
  if (node.localCellWidth !== undefined) out.localCellWidth = node.localCellWidth * tr.scale;
  if (node.localCellHeight !== undefined) out.localCellHeight = node.localCellHeight * tr.scale;
  if (node.identityCellX !== undefined && node.identityCellY !== undefined) {
    const [ix, iy] = applyTransformXY(tr, node.identityCellX, node.identityCellY);
    out.identityCellX = ix;
    out.identityCellY = iy;
  }
  if (node.identityCellWidth !== undefined) out.identityCellWidth = node.identityCellWidth * tr.scale;
  if (node.identityCellHeight !== undefined) out.identityCellHeight = node.identityCellHeight * tr.scale;
  return out;
}

/** Pattern node transform: the bbox rides transformBboxNode; the repeat
 *  tile size / offset are world-cell lengths, so they scale like the SVG
 *  tile fields. The cell grid itself is object-local (cols/rows/cells)
 *  and passes through untouched. */
function transformPatternObject(tr: AffineTransform, p: PatternObject): PatternObject {
  const out = transformBboxNode(tr, p);
  if (p.tileWidthL0 !== undefined) out.tileWidthL0 = p.tileWidthL0 * tr.scale;
  if (p.tileHeightL0 !== undefined) out.tileHeightL0 = p.tileHeightL0 * tr.scale;
  if (p.tileOffsetXL0 !== undefined) out.tileOffsetXL0 = p.tileOffsetXL0 * tr.scale;
  if (p.tileOffsetYL0 !== undefined) out.tileOffsetYL0 = p.tileOffsetYL0 * tr.scale;
  return out;
}

function transformGroup(tr: AffineTransform, group: GroupNode): GroupNode {
  // translateX/Y are world-space positions of the group origin — go
  // through the affine. scaleX/Y are dimensionless multipliers applied
  // to local coords; the local coords are themselves scaled by `tr` in
  // transformFigure / transformSVGObject, so the group's scaleX/Y do
  // NOT change.
  const [translateX, translateY] = applyTransformXY(tr, group.translateX, group.translateY);
  return {
    ...group,
    translateX,
    translateY,
  };
}

export interface NormalizableInput {
  figures: CompositionFigure[];
  svgObjects: SVGObject[];
  images?: ImageObject[];
  /** Text scene nodes (v29+). Bboxes normalize like image bboxes. */
  texts?: TextObject[];
  /** Paint island scene nodes (v52+). Bboxes normalize like image bboxes;
   *  tiles and contentRect are object-local and pass through untouched. */
  paintObjects?: PaintObject[];
  /** Pattern scene nodes (v54+). Bboxes normalize like image bboxes; the
   *  cell grid is object-local; repeat-mode tile fields scale like the
   *  SVG tile fields. */
  patternObjects?: PatternObject[];
  groups: GroupNode[];
  gridLevel: number;
  strokeScale: number;
  /** Canvas background paint (v29+). Unit-bbox space, so normalization
   *  passes it through untouched; threaded here so load/save flows can
   *  hand the whole content bundle to one call. */
  background?: Paint;
}

export interface NormalizeResult {
  figures: CompositionFigure[];
  svgObjects: SVGObject[];
  images: ImageObject[] | undefined;
  texts: TextObject[] | undefined;
  paintObjects: PaintObject[] | undefined;
  patternObjects: PatternObject[] | undefined;
  groups: GroupNode[];
  gridLevel: number;
  strokeScale: number;
  background: Paint | undefined;
  /** Power-of-2 scale factor applied (2^k). 1 means no scaling. */
  scale: number;
  /** Exponent k. New gridLevel = old gridLevel + k. */
  k: number;
}

/**
 * Normalize composition content into the canonical 32×32 L0 box.
 *
 *   1. Compute world bbox of visible content.
 *   2. Pick scale factor `s = 2^k`, where k starts from
 *      floor(log2(32 / maxAxis)) but is clamped to k ≥ 0 (never downscale —
 *      content wider than 32 L0 simply stays wide) and may be raised by the
 *      precision constraint (kPrecision), pushing the scaled bbox past 32.
 *      Power-of-2 preserves grid alignment: content snapped at step `2^L`
 *      becomes snapped at step `2^(L+k)` after the transform.
 *   3. Translate content so bbox.min (floored to the grid step, so the
 *      translation is always a whole number of grid steps) is at origin,
 *      scale by `s`, then center within the canonical canvas when the
 *      scaled content fits; otherwise anchor at the origin.
 *   4. Bump `gridLevel` by `k`.
 *   5. Scale `strokeScale` by `s` so visual line width is preserved.
 *
 * Invariants:
 *   - Grid-preserving: the affine maps grid points to grid points (scale is
 *     a power of two; translation is a multiple of the new grid step), so
 *     normalizing can never change any object's alignment to the grid —
 *     even when an off-grid freehand stroke defines the content bbox.
 *   - Stable: when no transform is needed (k = 0 and content already in
 *     canonical position) the input arrays are returned untouched, so a
 *     save → load round trip reproduces coordinates bit-exactly.
 *
 * Pure: returns new arrays (or the untouched inputs when the transform is
 * an exact identity); the input arrays are not mutated.
 *
 * Camera is NOT touched by this function — callers reset / reframe as
 * appropriate (`saveCompositionState` resets the camera written to disk
 * to a placeholder, and the editor's mount path frames content after
 * the viewport is known).
 */
export function normalizeComposition(input: NormalizableInput): NormalizeResult {
  const bbox = computeContentBBox(input.figures, input.svgObjects, input.images, input.texts, input.groups, input.paintObjects, input.patternObjects);

  if (!bbox) {
    return {
      figures: input.figures,
      svgObjects: input.svgObjects,
      images: input.images,
      texts: input.texts,
      paintObjects: input.paintObjects,
      patternObjects: input.patternObjects,
      groups: input.groups,
      gridLevel: input.gridLevel,
      strokeScale: input.strokeScale,
      background: input.background,
      scale: 1,
      k: 0,
    };
  }

  const bboxW = bbox.maxX - bbox.minX;
  const bboxH = bbox.maxY - bbox.minY;
  const maxAxis = Math.max(bboxW, bboxH);

  // The scale factor `s = 2^k` is the larger of two power-of-2 exponents:
  //
  //   k_fit:       largest k such that maxAxis × 2^k ≤ CANONICAL_SIZE — the
  //                tightest scale that still fits content in the canonical
  //                box. This is the original normalize behavior.
  //   k_precision: smallest k such that the new gridLevel = oldLevel + k
  //                is ≥ MIN_GRID_LEVEL_FOR_ENCODING. Picking this floor
  //                keeps the post-normalize content snug to the quarter-cell
  //                encoding grid, preventing the precision loss that
  //                collapsed segments in fine-grid files (Castle).
  //
  // `max(k_fit, k_precision)` lets the precision constraint *upscale* past
  // the canonical canvas when needed. Fine-grid compositions then occupy
  // a larger absolute coord range (e.g., a Castle-like file would jump
  // from ~22 to ~360 L0), but rendering, camera, and thumbnail viewBox
  // all frame the content bbox so the visual is unchanged. MAX_PRECISION_K
  // caps `k_precision` so we never push content past the i16 encoding range.
  let k: number;
  let scale: number;
  if (maxAxis <= 0) {
    k = 0;
    scale = 1;
  } else {
    const kFit = Math.floor(Math.log2(CANONICAL_SIZE / maxAxis));
    // kPrecision is the *minimum* k that keeps the new gridLevel ≥ the
    // encoding floor. May be negative when input.gridLevel has precision
    // headroom (e.g., gridLevel=2 → kPrecision=-4 means we can safely
    // shrink content by up to 16× without losing precision). The cap
    // prevents the upscale direction from blowing past the i16 encoding
    // range; downward there's no analogous limit because kFit naturally
    // floors the shrink.
    const kPrecision = Math.min(MAX_PRECISION_K, MIN_GRID_LEVEL_FOR_ENCODING - input.gridLevel);
    // Never downscale (k < 0). Downscaling shifts 0.25-grid coordinates
    // off the quarter-cell encoding grid, and the subsequent encodeFixed
    // round-trip introduces up to ±0.125 L0 drift per coordinate — enough
    // to visibly misalign line endpoints in detailed compositions.
    // Content wider than CANONICAL_SIZE simply stays wide; the renderer
    // and camera frame it by bbox so the visual is unchanged.
    k = Math.max(kFit, kPrecision, 0);
    scale = Math.pow(2, k);
  }

  // Stability: once a file is saved in canonical position, reloading it must
  // be a bit-exact no-op. When no rescale is needed and the content already
  // sits inside the canonical box, skip the transform entirely — even an
  // identity affine ((x - o) * 1 + o) re-rounds every coordinate by a float
  // ulp, which would make coordinates drift across save/load cycles.
  if (
    k === 0 &&
    bbox.minX >= 0 && bbox.minY >= 0 &&
    bbox.maxX <= CANONICAL_SIZE && bbox.maxY <= CANONICAL_SIZE
  ) {
    return {
      figures: input.figures,
      svgObjects: input.svgObjects,
      images: input.images,
      texts: input.texts,
      paintObjects: input.paintObjects,
      patternObjects: input.patternObjects,
      groups: input.groups,
      gridLevel: input.gridLevel,
      strokeScale: input.strokeScale,
      background: input.background,
      scale: 1,
      k: 0,
    };
  }

  const scaledW = bboxW * scale;
  const scaledH = bboxH * scale;
  // Position the scaled content. Center within the canonical canvas when
  // it fits; otherwise anchor at origin so upscaled (precision-driven)
  // content occupies [0, scaled] rather than spanning negative coords.
  // Snap the offset to the new grid step so non-square bboxes don't break
  // grid alignment; floor (vs round) keeps content's maxX/Y inside the
  // canonical box when centering, and at origin otherwise.
  const snapDown = (v: number, step: number): number =>
    step > 0 ? Math.floor(v / step) * step : v;
  const newStep = Math.pow(2, input.gridLevel + k);
  const idealOffsetX = scaledW <= CANONICAL_SIZE ? (CANONICAL_SIZE - scaledW) / 2 : 0;
  const idealOffsetY = scaledH <= CANONICAL_SIZE ? (CANONICAL_SIZE - scaledH) / 2 : 0;
  const offsetX = snapDown(idealOffsetX, newStep);
  const offsetY = snapDown(idealOffsetY, newStep);

  // Anchor the transform at the bbox min FLOORED to the old grid step, not
  // the raw bbox min. The raw min is off-grid whenever any freehand stroke
  // defines it, and translating by an off-grid amount knocks every
  // grid-aligned object in the scene off the grid (the Reimagine "reload
  // misaligns the seed squiggle" bug). With a snapped origin the net
  // translation (offset - origin·scale) is always a multiple of the new
  // grid step, so both grid alignment and sub-grid phase are preserved for
  // all content. Content may overhang the ideal placement by < 1 step.
  const oldStep = Math.pow(2, input.gridLevel);
  const originX = snapDown(bbox.minX, oldStep);
  const originY = snapDown(bbox.minY, oldStep);

  // Exact identity — same rationale as the in-box early return above:
  // never rewrite coordinates through a no-op affine.
  if (scale === 1 && offsetX === originX && offsetY === originY) {
    return {
      figures: input.figures,
      svgObjects: input.svgObjects,
      images: input.images,
      texts: input.texts,
      paintObjects: input.paintObjects,
      patternObjects: input.patternObjects,
      groups: input.groups,
      gridLevel: input.gridLevel,
      strokeScale: input.strokeScale,
      background: input.background,
      scale: 1,
      k: 0,
    };
  }

  const tr: AffineTransform = {
    originX,
    originY,
    scale,
    offsetX,
    offsetY,
  };

  return {
    figures: input.figures.map(f => transformFigure(tr, f)),
    svgObjects: input.svgObjects.map(s => transformSVGObject(tr, s)),
    images: input.images ? input.images.map(i => transformBboxNode(tr, i)) : input.images,
    texts: input.texts ? input.texts.map(t => transformBboxNode(tr, t)) : input.texts,
    paintObjects: input.paintObjects ? input.paintObjects.map(p => transformBboxNode(tr, p)) : input.paintObjects,
    patternObjects: input.patternObjects ? input.patternObjects.map(p => transformPatternObject(tr, p)) : input.patternObjects,
    groups: input.groups.map(g => transformGroup(tr, g)),
    gridLevel: input.gridLevel + k,
    strokeScale: input.strokeScale * scale,
    background: input.background,
    scale,
    k,
  };
}
