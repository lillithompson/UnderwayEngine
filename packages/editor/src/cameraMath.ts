import { compSnapStep } from '@/engine/compositionCellMath';
import { buildFrameRectMap } from '@/engine/compositionFrame';
import { computeContentBBox } from '@/engine/compositionNormalize';
import { descendantGroupIds } from '@/engine/compositionOps';
import { Camera, CompositionState, Viewport } from '@/engine/types';
import type { CellBbox } from '@/editor/resizeMath';

// Pure screen↔world camera math for the editor's DOM overlay + gestures.
// Uses the ENGINE's camera convention (see compositionCellMath.ts:
// screenToNearestGridIntersection) so the DOM world container stays
// pixel-aligned with the GL grid pass underneath:
//
//   uvX = (screenX / vw - 0.5) / zoom - offsetX / vw + 0.5
//   uvY = ((screenY - vh / 2) / vw) / zoom - offsetY / vw + 0.5
//   cell = uv * 32          (canonical 0..32 L0 cell space)
//
// Everything here is pure — gesture handlers feed results straight into
// style mutations (90 fps rule: no React re-render per pointermove) and
// commit the final Camera to state on gesture end.

/** Cells across the canonical composition box (uv 0..1 spans 32 cells). */
export const WORLD_CELLS = 32;

/** Pixels per L0 cell at CSS scale 1 inside the world container. Children
 *  are laid out at `cell * BASE_CELL_PX` px and the container is scaled by
 *  `worldLayerTransform().scale`; 16 px keeps font sizes / stroke widths in
 *  a range browsers rasterize crisply.
 *
 *  Must stay in step with the engine's `DOM_PX_PER_CELL` (svgStroke.ts): the
 *  composition-wide stroke width is authored in this unit, and the exporter
 *  converts out of it to draw a line at the same WORLD width the canvas does.
 *  `strokeWidthParity.test.ts` measures both paths and fails if they part. */
export const BASE_CELL_PX = 16;

/** Editor zoom clamps. Deliberately much narrower than the engine's
 *  MIN_ZOOM/MAX_ZOOM (0.001..10000, sized for unbounded grid subdivision):
 *  a journal page has no reason to zoom past ~1/4 page-per-screen or
 *  ~1 cell-per-screen. */
export const EDITOR_MIN_ZOOM = 0.2;
export const EDITOR_MAX_ZOOM = 24;

export interface ScreenPoint {
  x: number;
  y: number;
}

export function clampZoom(zoom: number): number {
  return Math.min(EDITOR_MAX_ZOOM, Math.max(EDITOR_MIN_ZOOM, zoom));
}

/** Screen px → world cell coordinates (float, unsnapped). */
export function screenToWorld(
  screenX: number,
  screenY: number,
  camera: Camera,
  viewport: Viewport,
): { cellX: number; cellY: number } {
  const vw = viewport.width;
  const vh = viewport.height;
  const uvX = (screenX / vw - 0.5) / camera.zoom - camera.offsetX / vw + 0.5;
  const uvY = ((screenY - vh / 2) / vw) / camera.zoom - camera.offsetY / vw + 0.5;
  return { cellX: uvX * WORLD_CELLS, cellY: uvY * WORLD_CELLS };
}

/** An axis-aligned box in world cells, min/max corners. */
export interface WorldRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The world-cell rect the viewport shows. The camera never rotates, so the
 *  visible region is exactly the box between the two screen corners —
 *  less `inset`, the bands the chrome covers, when given (DrawBot's bug
 *  a0177e98: the arena Play fits to the view stops at the toolbars). */
export function visibleWorldRect(camera: Camera, viewport: Viewport, inset: ViewInset = {}): WorldRect {
  const tl = screenToWorld(inset.left ?? 0, inset.top ?? 0, camera, viewport);
  const br = screenToWorld(
    viewport.width - (inset.right ?? 0), viewport.height - (inset.bottom ?? 0), camera, viewport,
  );
  return { minX: tl.cellX, minY: tl.cellY, maxX: br.cellX, maxY: br.cellY };
}

/** World cell coordinates → screen px. Inverse of {@link screenToWorld}. */
export function worldToScreen(
  cellX: number,
  cellY: number,
  camera: Camera,
  viewport: Viewport,
): ScreenPoint {
  const vw = viewport.width;
  const vh = viewport.height;
  const uvX = cellX / WORLD_CELLS;
  const uvY = cellY / WORLD_CELLS;
  return {
    x: vw / 2 + camera.zoom * (camera.offsetX + vw * (uvX - 0.5)),
    y: vh / 2 + camera.zoom * (camera.offsetY + vw * (uvY - 0.5)),
  };
}

/**
 * {@link worldToScreen} as an affine matrix, written into `out` at
 * `offset` in the engine's `Mat2D` order (a, b, c, d, e, f) and scaled by
 * `scale` (a device pixel ratio, for a canvas in device pixels). For a
 * loop that maps many points per frame and may allocate nothing (Sol's
 * reveal overlay): the camera never rotates, so the matrix is a uniform
 * scale and a shift.
 */
export function cameraMatrixInto(
  out: Float64Array, offset: number, camera: Camera, viewport: Viewport, scale: number,
): void {
  const vw = viewport.width;
  const vh = viewport.height;
  const s = (camera.zoom * vw) / WORLD_CELLS;
  out[offset] = s * scale;
  out[offset + 1] = 0;
  out[offset + 2] = 0;
  out[offset + 3] = s * scale;
  out[offset + 4] = (vw / 2 + camera.zoom * (camera.offsetX - vw / 2)) * scale;
  out[offset + 5] = (vh / 2 + camera.zoom * (camera.offsetY - vw / 2)) * scale;
}

/**
 * CSS transform for the absolutely-positioned world container: children sit
 * at `cell * BASE_CELL_PX` px inside it, `transform-origin: 0 0`, and
 * `translate(${translateX}px, ${translateY}px) scale(${scale})` maps them
 * onto the same screen pixels as {@link worldToScreen}.
 */
export function worldLayerTransform(
  camera: Camera,
  viewport: Viewport,
): { translateX: number; translateY: number; scale: number } {
  const origin = worldToScreen(0, 0, camera, viewport);
  return {
    translateX: origin.x,
    translateY: origin.y,
    // 32 cells span `zoom * vw` px on screen and `32 * BASE_CELL_PX` px in
    // the container's untransformed layout.
    scale: (camera.zoom * viewport.width) / (WORLD_CELLS * BASE_CELL_PX),
  };
}

/** Pixels per L0 cell at the current camera — for converting drag deltas. */
export function pxPerCell(camera: Camera, viewport: Viewport): number {
  return (camera.zoom * viewport.width) / WORLD_CELLS;
}

/** Pan by a screen-px delta (content follows the finger 1:1). */
export function panBy(camera: Camera, dxPx: number, dyPx: number): Camera {
  return {
    offsetX: camera.offsetX + dxPx / camera.zoom,
    offsetY: camera.offsetY + dyPx / camera.zoom,
    zoom: camera.zoom,
  };
}

/**
 * Multiply zoom by `factor` (clamped) while keeping the world point under
 * `(screenX, screenY)` fixed on screen — wheel zoom and pinch both anchor
 * this way. Derivation: `screenX = vw/2 + zoom*(offsetX + k)` for constant
 * `k`, so holding screenX fixed across zoom→zoom' gives
 * `offset' = (screen - center)/zoom' - (screen - center)/zoom + offset`.
 */
export function zoomAboutPoint(
  camera: Camera,
  viewport: Viewport,
  screenX: number,
  screenY: number,
  factor: number,
): Camera {
  const zoom = clampZoom(camera.zoom * factor);
  if (zoom === camera.zoom) return camera;
  const ax = screenX - viewport.width / 2;
  const ay = screenY - viewport.height / 2;
  return {
    offsetX: ax / zoom - ax / camera.zoom + camera.offsetX,
    offsetY: ay / zoom - ay / camera.zoom + camera.offsetY,
    zoom,
  };
}

/**
 * Two-pointer pinch: distance ratio scales zoom, midpoint travel pans.
 * All four points are screen px; `start` is the camera captured when the
 * second pointer went down. Pure — call per move with the latest points.
 */
export function pinchCamera(
  start: Camera,
  viewport: Viewport,
  a0: ScreenPoint,
  b0: ScreenPoint,
  a1: ScreenPoint,
  b1: ScreenPoint,
): Camera {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y);
  const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  const mid0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
  const mid1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  // Zoom about the START midpoint, then pan by the midpoint travel. Guard
  // the degenerate zero-distance case (pointers reported at the same px).
  const factor = d0 > 0 ? d1 / d0 : 1;
  const zoomed = zoomAboutPoint(start, viewport, mid0.x, mid0.y, factor);
  return panBy(zoomed, mid1.x - mid0.x, mid1.y - mid0.y);
}

/** Wheel delta → zoom factor. Trackpads report small deltas continuously,
 *  wheels report ±~100 per notch; exp keeps both smooth and symmetric. */
export function wheelZoomFactor(deltaY: number): number {
  return Math.exp(-deltaY * 0.002);
}

/** Signed angle of the a→b vector in degrees (atan2, y-down so positive is
 *  clockwise — matches CSS `rotate()`). Drives the two-finger twist. */
export function pairAngleDeg(a: ScreenPoint, b: ScreenPoint): number {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

/** Shortest signed difference `to - from`, wrapped to (-180, 180]. Lets the
 *  per-move twist accumulate smoothly across the atan2 ±180 seam even when a
 *  fast rotation jumps more than 180° would suggest between samples. */
export function shortestAngleDeltaDeg(from: number, to: number): number {
  let d = (to - from) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Page height in cells for a format aspect (width/height): the page is
 *  cells (0,0)–(32, 32/aspect). Shared with the scaffold layouts in
 *  web/formats/configs so slot rects and the camera agree on the page. */
export function pageHeightCells(aspect: number): number {
  return WORLD_CELLS / aspect;
}

/** Default share of the viewport a framed bbox fills — a little breathing
 *  room around a single object so it doesn't run to the screen edges. */
export const FRAME_OBJECT_FIT = 0.8;

/** "Frame Page" brings every mark as close as the screen allows, but not
 *  flush to the edges: a drawing touching the rim reads as cropped even when
 *  all of it is there, and a stroke's own width would genuinely clip. */
export const FRAME_CONTENT_FIT = 0.9;

/**
 * The chrome covering the canvas, in px per side. The canvas is full-bleed
 * beneath the title band and toolbar (nothing reflows when the band is swiped
 * away), so its viewport is the whole window and the top of it is not
 * somewhere a framed object may land.
 */
export interface ViewInset {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

/**
 * Frame a cell bbox centered in the viewport's USABLE box at a fit zoom — one
 * object for Scene Outline double-tap-to-frame, or the whole scene's content
 * for "Frame Page". Framing stays app-side (plan §6.2): the shared panel only
 * calls `onFrame(id)`; the shell resolves the bbox and hands the camera here.
 * The offset formulas invert {@link worldToScreen} to pin the bbox center to
 * the usable box's center (both axes use `vw` as the world span, matching the
 * camera convention above). Tiny objects clamp to a 0.5-cell minimum so a dot
 * doesn't zoom to the moon.
 *
 * `fit` is the share of each USABLE axis the bbox fills. `inset` is the chrome
 * over the canvas ({@link ViewInset}); without it the whole viewport is
 * usable, which is what the formulas reduce to.
 */
export function computeFrameCellBboxCamera(
  viewport: Viewport,
  bbox: { cellX: number; cellY: number; cellWidth: number; cellHeight: number },
  fit: number = FRAME_OBJECT_FIT,
  inset?: ViewInset,
): Camera {
  const vw = viewport.width;
  const vh = viewport.height;
  if (vw <= 0 || vh <= 0) return { offsetX: 0, offsetY: 0, zoom: 1 };
  const left = inset?.left ?? 0;
  const right = inset?.right ?? 0;
  const top = inset?.top ?? 0;
  const bottom = inset?.bottom ?? 0;
  // The box actually in view, and its center — what the bbox is fitted and
  // centered to. Chrome deeper than the canvas leaves a sliver rather than an
  // inside-out box.
  const usableW = Math.max(vw - left - right, 1);
  const usableH = Math.max(vh - top - bottom, 1);
  const centerX = left + usableW / 2;
  const centerY = top + usableH / 2;
  const uvW = Math.max(bbox.cellWidth, 0.5) / WORLD_CELLS;
  const uvH = Math.max(bbox.cellHeight, 0.5) / WORLD_CELLS;
  const uvCx = (bbox.cellX + bbox.cellWidth / 2) / WORLD_CELLS;
  const uvCy = (bbox.cellY + bbox.cellHeight / 2) / WORLD_CELLS;
  // Fit the bbox to fit*usable on each axis (screen px of the bbox is
  // zoom*vw*uv on both), then clamp to the editor zoom range.
  const zoom = clampZoom(Math.min((fit * usableW) / vw / uvW, (fit * usableH) / vw / uvH));
  // Pin the bbox center to the usable center: the plain viewport-centered
  // offset, plus the shift from viewport center to usable center in world px.
  return {
    offsetX: vw * (0.5 - uvCx) + (centerX - vw / 2) / zoom,
    offsetY: vw * (0.5 - uvCy) + (centerY - vh / 2) / zoom,
    zoom,
  };
}

/** The scene fields {@link computeFrameContentCamera} measures. */
export type FramableScene = Pick<
  CompositionState,
  'figures' | 'svgObjects' | 'images' | 'texts' | 'groups' | 'paintObjects' | 'patternObjects'
> & {
  /** Paint order, when the caller has it: it decides which of several
   *  `isMask` members bounds a frame (sceneFrameRect). Omitted → the first
   *  in `svgObjects` wins, which is the only one there ever is. */
  sceneOrder?: readonly string[];
};

/**
 * The rect of the scene's frame — its `isFrame` group's clipping boundary —
 * or undefined when the scene has none. The FIRST frame when there are
 * several (a page has one). Takes a partial scene, so a composition still
 * being assembled (a template instance before the editor holds it) can ask
 * the same question the opening camera asks.
 */
export function sceneFrameRect(scene?: {
  groups?: readonly CompositionState['groups'][number][];
  svgObjects?: readonly CompositionState['svgObjects'][number][];
  sceneOrder?: readonly string[];
}): CellBbox | undefined {
  const groups = scene?.groups ?? [];
  if (!groups.some((g) => g.isFrame)) return undefined;
  for (const mask of buildFrameRectMap({
    groups,
    svgObjects: scene?.svgObjects ?? [],
    sceneOrder: scene?.sceneOrder ?? [],
  }).values()) {
    return { cellX: mask.cellX, cellY: mask.cellY, cellWidth: mask.cellWidth, cellHeight: mask.cellHeight };
  }
  return undefined;
}

/**
 * The camera that puts every mark on the page exactly in view and as close as
 * the screen allows — "Frame Page". Null when there is nothing drawn, so the
 * caller can fall back to the page fit.
 *
 * The extent is the ENGINE's own content bbox (`computeContentBBox`, what
 * normalization anchors to), not a private union, so the two can't drift.
 * It measures inked extents — an SVG object's segment AABB, not its node
 * rect — and is frame-aware: a format with a Figma-style frame anchors to the
 * board's own rect rather than to whatever overhangs it. Brush marks are
 * paint island scene nodes now, and an island's bbox IS its ink bounds, so
 * the same call sees them — no separate texel scan. Tile patterns are
 * ordinary pattern scene nodes and count too: a page stamped only from
 * tiles still frames on open.
 */
export function computeFrameContentCamera(
  scene: FramableScene,
  viewport: Viewport,
  inset?: ViewInset,
): Camera | null {
  const bb = computeContentBBox(
    scene.figures, scene.svgObjects, scene.images, scene.texts, scene.groups,
    scene.paintObjects, scene.patternObjects,
  );
  if (!bb) return null;
  return computeFrameCellBboxCamera(viewport, {
    cellX: bb.minX,
    cellY: bb.minY,
    cellWidth: bb.maxX - bb.minX,
    cellHeight: bb.maxY - bb.minY,
  }, FRAME_CONTENT_FIT, inset);
}

/** A cell rect the camera can be pointed at — {@link CellBbox}. */

/** The smallest rect holding both. */
function unionCellBbox(a: CellBbox, b: CellBbox): CellBbox {
  const x0 = Math.min(a.cellX, b.cellX);
  const y0 = Math.min(a.cellY, b.cellY);
  const x1 = Math.max(a.cellX + a.cellWidth, b.cellX + b.cellWidth);
  const y1 = Math.max(a.cellY + a.cellHeight, b.cellY + b.cellHeight);
  return { cellX: x0, cellY: y0, cellWidth: x1 - x0, cellHeight: y1 - y0 };
}

/**
 * The rect that frames a handful of world POINTS — Creature's unmet
 * connection points, which the camera flies to when a turn is refused
 * over them (CozyJournal's docs/social_game_spec.md §7.3). Points have no size, and a
 * zero rect framed at {@link FRAME_OBJECT_FIT} would zoom to the moon,
 * so the union of them is grown to `pad` cells on every side: what the
 * reader needs to see is the point AND the paper around it they have to
 * draw a line through. Null for no points at all.
 */
export function cellBboxAroundPoints(
  points: readonly { x: number; y: number }[],
  pad: number,
): CellBbox | null {
  if (points.length === 0) return null;
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const { x, y } of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    cellX: minX - pad,
    cellY: minY - pad,
    cellWidth: maxX - minX + pad * 2,
    cellHeight: maxY - minY + pad * 2,
  };
}

/**
 * The world bbox of a group row as the Scene Outline frames it on a
 * double-tap: the union of every leaf in the group or any group under it
 * (world coordinates — a leaf's cell rect is already world). Null for a
 * group holding nothing. Shared by the outline's double-tap (EditorShell
 * onFrameObject) and the `'frame'` opening camera, so a page opens on
 * exactly the view double-tapping its frame row would give.
 */
export function groupCellBbox(
  scene: Partial<FramableScene> & { groups?: readonly CompositionState['groups'][number][] },
  groupId: string,
): CellBbox | null {
  const groups = scene.groups ?? [];
  const inGroup = new Set([groupId, ...descendantGroupIds(groups, groupId)]);
  let bbox: CellBbox | null = null;
  const leaves: readonly (readonly { groupId?: string; cellX: number; cellY: number; cellWidth: number; cellHeight: number }[])[] = [
    scene.figures ?? [], scene.svgObjects ?? [], scene.images ?? [], scene.texts ?? [],
    scene.paintObjects ?? [], scene.patternObjects ?? [],
  ];
  for (const list of leaves) {
    for (const leaf of list) {
      if (!leaf.groupId || !inGroup.has(leaf.groupId)) continue;
      bbox = bbox ? unionCellBbox(bbox, leaf) : {
        cellX: leaf.cellX, cellY: leaf.cellY, cellWidth: leaf.cellWidth, cellHeight: leaf.cellHeight,
      };
    }
  }
  return bbox;
}

/** The bbox the Scene Outline frames for the scene's frame row — the frame
 *  group (the first, when there are several) with everything it holds:
 *  its boundary and every node adopted into it. Undefined without a frame. */
export function sceneFrameGroupBbox(scene?: FramableScene): CellBbox | undefined {
  if (!scene || !(scene.groups ?? []).some((g) => g.isFrame)) return undefined;
  for (const groupId of buildFrameRectMap({
    groups: scene.groups,
    svgObjects: scene.svgObjects,
    sceneOrder: scene.sceneOrder ?? [],
  }).keys()) {
    return groupCellBbox(scene, groupId) ?? undefined;
  }
  return undefined;
}

/**
 * The camera the editor OPENS a page on, per the format's `canvas.initialFit`
 * (see EditorConfig):
 *  - `'page'` (default) — the format's page, so a new activity reads as the
 *    sheet it is;
 *  - `'frame'` — the page's frame, framed exactly as double-tapping its
 *    row in the Scene Outline frames it (magnetic poetry): the frame group
 *    with everything it holds, at the object fit, inside the same inset.
 *    The SCENE's own frame when it has one — a page minted from a template
 *    carries the board its author drew, wherever they drew it, and the
 *    words played onto it — else the config's frame rect;
 *  - `'content'` — what is actually drawn, the same answer the Outline
 *    header's Frame Page gives, for a format whose seeded marks sit wherever
 *    the generator put them (Reimagine).
 *
 * Both non-page fits fall back to the page: `'frame'` without a frame rect
 * has nothing to fit, and `'content'` on a page with nothing drawn would be
 * framing emptiness.
 *
 * `cellsWide` (canvas.initialCellsWide) short-circuits all three: a format
 * that opens at CELL scale is not fitting a rect at all, it is choosing how
 * big a grid cell reads on the screen.
 *
 * `fitRect` is a rect the FORMAT names (canvas.initialFitRect — the band
 * a Creature turn may draw in): framed like the focus below, under it and
 * over everything else.
 *
 * `focus` overrides everything: a page whose template drew a "Focus"
 * rectangle (pageTemplate's takeTemplateFocus) opens framed on it exactly
 * as the Scene Outline's double-tap frames a row — the object fit, inside
 * the same inset — so the author of the template chooses the first view.
 *
 * `fitNode` is the bbox of the node a format names to open on
 * (canvas.initialFitName, resolved by the shell — Adrift's Mask, the shape
 * its words are floated into): framed the way the focus is, on every open
 * of the page rather than the first alone, and ahead of the fits below.
 * Undefined when the page carries no node of that name, so the fit falls
 * through.
 *
 * A PAGE open keeps what was drawn in view when the page reopens: a page
 * whose content spills past the page — the user zoomed out and drew off it —
 * opens on the page view widened to hold that content too (see
 * {@link widenToContent}). Content on the page changes nothing, so a fresh
 * page opens exactly as its format asks. The other fits are left alone on
 * purpose: a `'frame'` or named-node open IS the thing to look at (Adrift's
 * word bank sits outside its Mask by design), a cells-wide open is a chosen
 * scale for working a band a few cells at a time, and a `'content'` open
 * already frames every mark.
 */
export function computeOpeningCamera(
  viewport: Viewport,
  open: {
    aspect: number;
    initialFit?: 'page' | 'frame' | 'content';
    frame?: CellBbox;
    scene?: FramableScene;
    inset?: ViewInset;
    cellsWide?: number;
    gridLevel?: number;
    focus?: CellBbox;
    fitRect?: CellBbox;
    fitNode?: CellBbox;
  },
): Camera {
  if (open.focus) {
    return computeFrameCellBboxCamera(viewport, open.focus, FRAME_OBJECT_FIT, open.inset);
  }
  // A rect the FORMAT names (canvas.initialFitRect): Creature's turn opens
  // on the band this move may draw in rather than on the whole board.
  // Framed exactly as a focus is, and ahead of the fits below for the same
  // reason — it IS the thing to look at.
  if (open.fitRect) {
    return computeFrameCellBboxCamera(viewport, open.fitRect, FRAME_OBJECT_FIT, open.inset);
  }
  if (open.cellsWide && open.cellsWide > 0) {
    return computeCellsWideCamera(viewport, open.aspect, open.cellsWide, open.gridLevel ?? 0);
  }
  if (open.fitNode) {
    return computeFrameCellBboxCamera(viewport, open.fitNode, FRAME_OBJECT_FIT, open.inset);
  }
  const frame = open.initialFit === 'frame' ? sceneFrameGroupBbox(open.scene) ?? open.frame : undefined;
  if (frame) {
    return computeFrameCellBboxCamera(viewport, frame, FRAME_OBJECT_FIT, open.inset);
  }
  if (open.initialFit === 'content' && open.scene) {
    const camera = computeFrameContentCamera(open.scene, viewport, open.inset);
    if (camera) return camera;
  }
  return widenToContent(computeInitialCamera(viewport, open.aspect), viewport, open.scene, open.inset);
}

/** The world rect the viewport's USABLE box (inside the chrome inset) shows
 *  under `camera` — what the person opening the page can actually see. */
function usableWorldRect(camera: Camera, viewport: Viewport, inset?: ViewInset): CellBbox {
  const tl = screenToWorld(inset?.left ?? 0, inset?.top ?? 0, camera, viewport);
  const br = screenToWorld(
    viewport.width - (inset?.right ?? 0), viewport.height - (inset?.bottom ?? 0), camera, viewport,
  );
  return { cellX: tl.cellX, cellY: tl.cellY, cellWidth: br.cellX - tl.cellX, cellHeight: br.cellY - tl.cellY };
}

/** Slack for the containment test below: a stroke ending exactly on the
 *  page edge is in view, not spilling. */
const SPILL_EPS = 1e-6;

/**
 * `camera` as it stands when everything drawn is already in view; otherwise
 * the view it shows, grown to hold the drawn content as well, at the
 * Frame Page fit. The complaint this answers: zoom out, draw past the page,
 * close — and the page reopened on the page view with the work off screen,
 * as if the page were empty. The page view is kept as the anchor rather than
 * framing the content alone, so the page is still where the eye lands; the
 * content is simply not cut off.
 */
function widenToContent(
  camera: Camera,
  viewport: Viewport,
  scene: FramableScene | undefined,
  inset?: ViewInset,
): Camera {
  if (!scene || viewport.width <= 0 || viewport.height <= 0) return camera;
  const bb = computeContentBBox(
    scene.figures, scene.svgObjects, scene.images, scene.texts, scene.groups,
    scene.paintObjects, scene.patternObjects,
  );
  if (!bb) return camera;
  const shown = usableWorldRect(camera, viewport, inset);
  const inside = bb.minX >= shown.cellX - SPILL_EPS
    && bb.minY >= shown.cellY - SPILL_EPS
    && bb.maxX <= shown.cellX + shown.cellWidth + SPILL_EPS
    && bb.maxY <= shown.cellY + shown.cellHeight + SPILL_EPS;
  if (inside) return camera;
  const content = { cellX: bb.minX, cellY: bb.minY, cellWidth: bb.maxX - bb.minX, cellHeight: bb.maxY - bb.minY };
  return computeFrameCellBboxCamera(viewport, unionCellBbox(shown, content), FRAME_CONTENT_FIT, inset);
}

/**
 * The camera that puts exactly `cellsWide` GRID cells across the screen,
 * centred on the page like a `'page'` open (see computeInitialCamera — same
 * centring, a different zoom).
 *
 * A grid cell is `compSnapStep(gridLevel)` canonical cells wide, and the
 * screen spans `WORLD_CELLS / zoom` canonical cells by construction (see
 * screenToWorld), so the zoom falls straight out. Clamped like every other
 * camera, so a count finer than EDITOR_MAX_ZOOM allows lands as close as the
 * limit permits rather than being silently ignored.
 */
export function computeCellsWideCamera(
  viewport: Viewport,
  aspect: number,
  cellsWide: number,
  gridLevel: number,
): Camera {
  const vw = viewport.width;
  const vh = viewport.height;
  if (vw <= 0 || vh <= 0) return { offsetX: 0, offsetY: 0, zoom: 1 };
  const pageUvH = 1 / aspect;
  const zoom = clampZoom(WORLD_CELLS / (cellsWide * compSnapStep(gridLevel)));
  return { offsetX: 0, offsetY: vw * (0.5 - pageUvH / 2), zoom };
}

/**
 * Frame the format's page (cells (0,0)–(32, 32/aspect)) centered in the
 * viewport with a little breathing room. `aspect` is width/height (§4.3).
 */
export function computeInitialCamera(viewport: Viewport, aspect: number): Camera {
  const vw = viewport.width;
  const vh = viewport.height;
  if (vw <= 0 || vh <= 0) return { offsetX: 0, offsetY: 0, zoom: 1 };
  const pageUvH = 1 / aspect; // page width is uv 1 by construction
  // Fit width (zoom ≤ 1) and height (zoom ≤ aspect * vh / vw), padded.
  const zoom = clampZoom(0.92 * Math.min(1, (vh / vw) / pageUvH));
  // Center the page: x-center is uv 0.5 (offsetX 0); y-center uv 0.5/aspect.
  return { offsetX: 0, offsetY: vw * (0.5 - pageUvH / 2), zoom };
}
