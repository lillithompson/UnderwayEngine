import type { ImageFraming } from './imageFraming';
export type { ImageFraming, ImageFramingMode, ImageCropRatio } from './imageFraming';

/** Pixel resolution of every layer texture */
export const LAYER_PX = 2048;

/** Discriminator for scene-object kinds. Lives in types.ts so the undo
 *  op union can reference it without creating an import cycle with
 *  compositionOps.ts (which is where the per-kind adapters live). */
export type CompItemKind = 'figure' | 'svg' | 'image' | 'text' | 'paint' | 'pattern';

/** Grid level determines cell count: L0=32, L1=16, L2=8, L3=4, L4=2, L5=1, L6=0.5 */
export type GridLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Highest grid level that corresponds to an actual layer/texture. Levels
 *  5–6 are composition-editor snap levels only — no file layer exists at
 *  those resolutions. */
export const MAX_LAYER_LEVEL: GridLevel = 4;

/** Grid levels that have an actual layer/texture/atlas (0..MAX_LAYER_LEVEL). */
export type LayerGridLevel = 0 | 1 | 2 | 3 | 4;

/** Cell counts per grid level */
export const CELL_COUNTS: Record<GridLevel, number> = {
  0: 32,
  1: 16,
  2: 8,
  3: 4,
  4: 2,
  5: 1,
  6: 0.5,
};

/** Human-readable name for each grid level */
export const LEVEL_LABELS: Record<GridLevel, string> = {
  0: 'Base',
  1: 'Fine',
  2: 'Medium',
  3: 'Coarse',
  4: 'Huge',
  5: 'Macro',
  6: 'Canvas',
};

/** Pixel size of one cell at a given grid level */
export function cellPx(level: GridLevel): number {
  return LAYER_PX / CELL_COUNTS[level];
}

/** Clip box in L0 cell coordinates (absolute, same space as originL0X/Y). */
export interface ClipBox {
  clipL0X: number;
  clipL0Y: number;
  clipL0W: number;
  clipL0H: number;
}

export interface FileConfig {
  id: string;
  name: string;
  widthL0?: number;
  heightL0?: number;
  /** Offset of the canvas window within the 32 L0 layer coordinate space.
   *  The canvas occupies [originL0X, originL0X + widthL0) on the X axis.
   *  Default 0 for backward compat; new files may center for symmetric resize room. */
  originL0X?: number;
  originL0Y?: number;
  /** Optional clip region — when set, baking/export clips to this sub-rect
   *  instead of the full canvas dimensions. */
  clipBox?: ClipBox;
}

/** Resolve the effective visible canvas dimensions from a FileConfig.
 *  When a clip box is set, it defines the visible area; otherwise
 *  the raw widthL0/heightL0/origin values are used.
 *  Pass forceFullCanvas=true during resize mode to show the full layer. */
export function effectiveCanvasDims(fc: FileConfig, forceFullCanvas?: boolean): {
  widthL0: number; heightL0: number; originL0X: number; originL0Y: number;
} {
  if (fc.clipBox && !forceFullCanvas) {
    return {
      widthL0: fc.clipBox.clipL0W,
      heightL0: fc.clipBox.clipL0H,
      originL0X: fc.clipBox.clipL0X,
      originL0Y: fc.clipBox.clipL0Y,
    };
  }
  return {
    widthL0: fc.widthL0 ?? 32,
    heightL0: fc.heightL0 ?? 32,
    originL0X: fc.originL0X ?? 0,
    originL0Y: fc.originL0Y ?? 0,
  };
}

/** Max editable cell index for a file dimension at a given grid level */
export function editableCells(fileDimL0: number, level: GridLevel): number {
  return Math.ceil(fileDimL0 * CELL_COUNTS[level] / 32);
}

export interface Layer {
  id: string;
  name: string;
  level: GridLevel;
  visible: boolean;
  opacity: number;
  order: number;
  /** Grid shift as fraction of cell size: 0 = aligned, 0.5 = half-cell offset */
  shiftX: 0 | 0.5;
  shiftY: 0 | 0.5;
  /** RGBA pixel data, always LAYER_PX * LAYER_PX * 4 bytes */
  data: Uint8Array;
  /** Uint32 view of `data` — cached to avoid per-call typed-array construction */
  dataU32: Uint32Array;
  /** Pre-allocated pool of dirty rect slots. Use dirtyRectCount for active count. */
  dirtyRects: DirtyRect[];
  /** Number of active dirty rects (0 = clean). */
  dirtyRectCount: number;
  /** Whether this layer is locked (immune to edits) */
  locked: boolean;
  /** Per-cell semantic state grid */
  cells: (CellState | null)[][];
  /** Monotonically increasing counter bumped on every in-place cell mutation */
  cellsGeneration: number;
  /** Row of cells at y=-1 for shiftY layers (length = count), null otherwise */
  edgeRowTop: (CellState | null)[] | null;
  /** Column of cells at x=-1 for shiftX layers (length = count), null otherwise */
  edgeColLeft: (CellState | null)[] | null;
  /** Corner cell at (-1,-1) when both shiftX and shiftY active */
  edgeCorner: CellState | null;
}

export const COLOR_PALETTE: readonly [number, number, number][] = [
  [255, 255, 255], // #FFFFFF (white — default active color)
  [244,  63,  94], // #F43F5E
  [251, 146,  60], // #FB923C
  [250, 204,  21], // #FACC15
  [163, 230,  53], // #A3E635
  [ 52, 211, 153], // #34D399
  [ 34, 211, 238], // #22D3EE
  [167, 139, 250], // #A78BFA
  [232, 121, 249], // #E879F9
];

export const MAX_PALETTE_SIZE = 50;

export function getPaletteColor(index: number): [number, number, number] {
  return COLOR_PALETTE[index % COLOR_PALETTE.length];
}

export interface Camera {
  offsetX: number;
  offsetY: number;
  zoom: number;
}

export interface CellCoord {
  cellX: number;
  cellY: number;
}

export interface DirtyRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
  topInset: number;
  rightInset: number;
  bottomInset: number;
  leftInset: number;
}

export interface ViewportInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function makeViewport(width: number, height: number): Viewport {
  return { width, height, topInset: 0, rightInset: 0, bottomInset: 0, leftInset: 0 };
}

export function viewportInsets(v: Viewport): ViewportInsets {
  return { top: v.topInset, right: v.rightInset, bottom: v.bottomInset, left: v.leftInset };
}

/** Max individual dirty rects before merging into a single bounding rect */
export const MAX_DIRTY_RECTS = 8;

/**
 * Mark a layer's large backing buffers as non-enumerable. React 19's dev build
 * recursively walks state-object properties via `addObjectDiffToProperties` on
 * every passive-mount effect to log component renders; with 16 MB `data` /
 * `dataU32` views on every layer that walk blows the heap to multi-GB and
 * crashes the tab. Hiding these from enumeration (JSON.stringify / Object.keys
 * / for…in) keeps property access working while the dev walker skips them.
 */
export function hideHeavyLayerFields(layer: Layer): Layer {
  Object.defineProperty(layer, 'data', { enumerable: false, writable: true, configurable: true, value: layer.data });
  Object.defineProperty(layer, 'dataU32', { enumerable: false, writable: true, configurable: true, value: layer.dataU32 });
  Object.defineProperty(layer, 'dirtyRects', { enumerable: false, writable: true, configurable: true, value: layer.dirtyRects });
  return layer;
}

/**
 * Spread-clone a Layer, carrying the non-enumerable `data` / `dataU32` /
 * `dirtyRects` fields across. Plain `{ ...layer }` drops them because
 * `hideHeavyLayerFields` makes them non-enumerable; use this helper anywhere
 * a shallow Layer copy is needed (reducers, flood-fill scratch layers, undo
 * apply/revert). Overrides are applied after the spread, and the heavy
 * fields are re-hidden on the result.
 */
export function cloneLayer(layer: Layer, overrides?: Partial<Layer>): Layer {
  const clone = { ...layer, ...overrides } as Layer;
  clone.data = overrides && 'data' in overrides ? overrides.data! : layer.data;
  clone.dataU32 = overrides && 'dataU32' in overrides ? overrides.dataU32! : layer.dataU32;
  clone.dirtyRects = overrides && 'dirtyRects' in overrides ? overrides.dirtyRects! : layer.dirtyRects;
  return hideHeavyLayerFields(clone);
}

/** Create a pre-allocated dirty rect pool for a layer. */
export function initDirtyRects(): DirtyRect[] {
  const rects: DirtyRect[] = [];
  for (let i = 0; i < MAX_DIRTY_RECTS; i++) {
    rects.push({ x: 0, y: 0, width: 0, height: 0 });
  }
  return rects;
}

/** Push a dirty rect onto a layer (scalar args, mutates pre-allocated pool).
 *  Also accepts the legacy object form for backward compatibility. */
export function pushDirtyRect(layer: Layer, x: number | DirtyRect, y?: number, w?: number, h?: number): void {
  let rx: number, ry: number, rw: number, rh: number;
  if (typeof x === 'object') {
    rx = x.x; ry = x.y; rw = x.width; rh = x.height;
  } else {
    rx = x; ry = y!; rw = w!; rh = h!;
  }
  const rects = layer.dirtyRects;
  const count = layer.dirtyRectCount;
  if (count < MAX_DIRTY_RECTS) {
    const slot = rects[count];
    slot.x = rx; slot.y = ry; slot.width = rw; slot.height = rh;
    layer.dirtyRectCount = count + 1;
  } else {
    // Merge all into bounding rect
    let x0 = rx, y0 = ry;
    let x1 = rx + rw, y1 = ry + rh;
    for (let i = 0; i < count; i++) {
      const r = rects[i];
      if (r.x < x0) x0 = r.x;
      if (r.y < y0) y0 = r.y;
      const rx1 = r.x + r.width;
      const ry1 = r.y + r.height;
      if (rx1 > x1) x1 = rx1;
      if (ry1 > y1) y1 = ry1;
    }
    const slot = rects[0];
    slot.x = x0; slot.y = y0; slot.width = x1 - x0; slot.height = y1 - y0;
    layer.dirtyRectCount = 1;
  }
}

/** Mark a layer as fully dirty (single full-layer rect). */
export function markFullDirty(layer: Layer): void {
  const slot = layer.dirtyRects[0];
  slot.x = 0; slot.y = 0; slot.width = LAYER_PX; slot.height = LAYER_PX;
  layer.dirtyRectCount = 1;
}

/** Coalesce adjacent/overlapping dirty rects to reduce texture uploads.
 *  Sorts by Y then X, merges horizontally-adjacent rects with same Y and height. */
export function coalesceDirtyRects(layer: Layer): void {
  const count = layer.dirtyRectCount;
  if (count <= 1) return;
  const rects = layer.dirtyRects;

  // Simple insertion sort (max 8 elements)
  for (let i = 1; i < count; i++) {
    const ky = rects[i].y, kx = rects[i].x;
    const kw = rects[i].width, kh = rects[i].height;
    let j = i - 1;
    while (j >= 0 && (rects[j].y > ky || (rects[j].y === ky && rects[j].x > kx))) {
      const dst = rects[j + 1], src = rects[j];
      dst.x = src.x; dst.y = src.y; dst.width = src.width; dst.height = src.height;
      j--;
    }
    const dst = rects[j + 1];
    dst.x = kx; dst.y = ky; dst.width = kw; dst.height = kh;
  }

  // Merge horizontally-adjacent rects (same y, same height, touching/overlapping x ranges)
  let write = 0;
  for (let i = 1; i < count; i++) {
    const prev = rects[write];
    const cur = rects[i];
    if (cur.y === prev.y && cur.height === prev.height && cur.x <= prev.x + prev.width) {
      // Merge: extend prev to cover cur
      const newEnd = Math.max(prev.x + prev.width, cur.x + cur.width);
      prev.width = newEnd - prev.x;
    } else {
      write++;
      if (write !== i) {
        const dst = rects[write];
        dst.x = cur.x; dst.y = cur.y; dst.width = cur.width; dst.height = cur.height;
      }
    }
  }
  layer.dirtyRectCount = write + 1;
}

// ── Cell Metadata ─────────────────────────────────────────────────────

export type CellTransform = {
  mirrorH: boolean;
  mirrorV: boolean;
  rotation: 0 | 90 | 180 | 270;
};

export const DEFAULT_TRANSFORM: CellTransform = {
  mirrorH: false,
  mirrorV: false,
  rotation: 0,
};

/** Fast modulo-360 lookup for rotation values (avoids Hermes fmod). */
export const MOD_360: Record<number, 0 | 90 | 180 | 270> = {
  0: 0, 90: 90, 180: 180, 270: 270, 360: 0, 450: 90, 540: 180,
};

/** Left-compose a visual mirror onto an existing cell transform. */
export function applyVisualMirror(
  t: CellTransform,
  axis: 'h' | 'v',
): CellTransform {
  return {
    rotation: MOD_360[360 - t.rotation],
    mirrorH: axis === 'h' ? !t.mirrorH : t.mirrorH,
    mirrorV: axis === 'v' ? !t.mirrorV : t.mirrorV,
  };
}

export type CellState =
  | null
  | { type: 'color'; r: number; g: number; b: number; transform: CellTransform }
  | { type: 'sprite'; spriteId: string; transform: CellTransform; tintR?: number; tintG?: number; tintB?: number };

/** A cell rewrite, as connectivity's reconcile sweep reports its fixes.
 *  (The layered tile-editor undo model this union used to carry went with
 *  that editor; the 'cell' variant is the one shape still produced.) */
export type UndoOp =
  | { op: 'cell'; layerId: string; cellX: number; cellY: number; oldState: CellState; newState: CellState };

// ── Composition Types ────────────────────────────────────────────────

export interface FigureQuad {
  offsetX: number;  // relative to parent figure's cellX
  offsetY: number;  // relative to parent figure's cellY
  cellWidth: number;
  cellHeight: number;
}

export interface CompositionFigure {
  id: string;
  name?: string;       // user-assigned instance name
  figureKey: string;   // sprite key resolved via the atlas registry (assets/images/atlases/) or fileId
  cellX: number;       // position in L0 cells
  cellY: number;
  resolutionX: number; // base resolution in L0 cells (default 2)
  resolutionY: number; // base resolution in L0 cells (default 2)
  cellWidth: number;   // actual width in L0 cells (scaled by grid level at placement)
  cellHeight: number;  // actual height in L0 cells (scaled by grid level at placement)
  rotation?: 0 | 90 | 180 | 270;
  mirrorH?: boolean;
  mirrorV?: boolean;
  /** File ID referencing this figure's source data in storage */
  fileId?: string;
  /** Grid level at which this figure was placed (determines which baked variant to use) */
  placementLevel?: GridLevel;
  /** Multi-quad mesh: each quad is positioned relative to cellX/cellY */
  quads?: FigureQuad[];
  /** When true, figure cannot be selected by tapping on the canvas */
  locked?: boolean;
  /** When true, the figure is not rendered on the canvas and not
   *  hit-testable. Toggled via the eye icon in the Scene Outline. */
  hidden?: boolean;
  /**
   * Per-instance color tint. When set, the renderer multiplies the figure's
   * sampled RGB by this color (preserving alpha) on both the WebGL tile path
   * and the SVG path. White (255,255,255) is identity; cleared also renders
   * the source sprite as-is. Set by the composition Color tool; undoable via
   * `recolorFigure`.
   */
  colorOverride?: RGBColor;
  /**
   * Blend mode used when rendering `colorOverride` against the figure's
   * source fills/strokes. When set, `blendColor(fill, override, mode, 1)`
   * is used instead of the default luminance-weighted recolor.
   *
   * Undefined means legacy luminance recolor (backward compat for files
   * saved before v22). Only "compositional" modes are stored here —
   * `invert`, `rotate`, and `randomize` pre-bake their result into
   * `colorOverride` directly and leave this field undefined.
   */
  colorOverrideBlendMode?: BlendMode;
  /** Position in the double-tap transform cycle (0–6) */
  transformCycleStep?: number;
  /** Original position before any transforms (prevents rounding drift) */
  identityCellX?: number;
  identityCellY?: number;
  /** When 'repeat', this figure tiles/repeats within its region (block mode) */
  tileMode?: 'repeat';
  /** Intrinsic tile width in L0 cells (independent of region size) */
  tileWidthL0?: number;
  /** Intrinsic tile height in L0 cells (independent of region size) */
  tileHeightL0?: number;
  /** Tile-grid offset in L0 cells. Compensates for origin-side resize so
   *  the pattern stays fixed in world space. Default 0. */
  tileOffsetXL0?: number;
  tileOffsetYL0?: number;
  groupId?: string;
  preGroupName?: string;
  /**
   * Local transform of this member within its group, expressed in the
   * group's pre-transform L0-cell space. World coords (cellX/Y/W/H) =
   * group transform applied to these. Only meaningful when `groupId` is
   * set; populated by `groupFigures` and the migration helper.
   */
  localCellX?: number;
  localCellY?: number;
  localCellWidth?: number;
  localCellHeight?: number;
  /**
   * Tile-mode members carry their tile dim through the hierarchy the
   * same way as cellWidth/Height: world tile = local tile * group scale
   * on each axis. Set on `groupFigures` for tile members; cleared on
   * `ungroupFigures`.
   */
  localTileWidthL0?: number;
  localTileHeightL0?: number;
  /** Local-space tile offset, preserved through group/ungroup. */
  localTileOffsetXL0?: number;
  localTileOffsetYL0?: number;
  /**
   * Pre-group-transform orientation. World `rotation` / `mirrorH` /
   * `mirrorV` / `quads` are derived by composing these with the group's
   * own rotation / mirror at materialize time — same pattern as
   * `localCellX/Y/Width/Height`. Without this, a figure inside a rotated
   * group would have its bbox rotated by `applyGroupTransform` but its
   * sprite render would stay un-rotated. Seeded by `groupFigures` from
   * the figure's current world orientation; cleared by `ungroupFigures`.
   */
  localRotation?: 0 | 90 | 180 | 270;
  localMirrorH?: boolean;
  localMirrorV?: boolean;
  localQuads?: FigureQuad[];
}

/**
 * A scene-graph group node. Members of the group reference it by `groupId`
 * matching this node's `id`. Their world coords are derived as
 *
 *   world.x = translateX + transformedLocal.x * scaleX
 *   world.y = translateY + transformedLocal.y * scaleY
 *
 * where `transformedLocal` is the member's `localCellX/Y/Width/Height`
 * after the group's mirror flips and 90° rotation are applied. Member
 * `cellX/Y/Width/Height` are kept in sync with this materialization so
 * existing read sites (rendering, hit-test, export) continue to work.
 */
export interface GroupNode {
  id: string;
  name: string;
  parentGroupId?: string;
  preGroupName?: string;
  translateX: number;
  translateY: number;
  scaleX: number;
  scaleY: number;
  rotation: 0 | 90 | 180 | 270;
  mirrorH: boolean;
  mirrorV: boolean;
  /** When true, this group is a Figma-style frame: its back-most rect
   *  `isMask` member clips the group's children (rendering + hit testing)
   *  and the group's rect defines the exported region exactly (fixed page
   *  dims), rather than the tight bounds of visible content. Stored as
   *  true/undefined, never false (mirrors the `isMask` convention). */
  isFrame?: boolean;
  /** When true, this group is locked: its members act as locked (can't be
   *  tap-selected, moved, edited, or deleted) WITHOUT their own per-leaf
   *  `locked` flag being touched — the lock is inherited, not propagated.
   *  A leaf's *effective* lock is its own `locked` OR any ancestor group's
   *  `locked` (see isItemLocked / isGroupChainLocked in compositionOps).
   *  Stored true/undefined, never false. */
  locked?: boolean;
  /** When true, this group is hidden: nothing inside it draws or hit-tests,
   *  WITHOUT the members' own per-leaf `hidden` flags being touched — the
   *  hide is inherited, not propagated, so un-hiding the group restores each
   *  member's individual visibility exactly as it was. A leaf's *effective*
   *  visibility is its own `hidden` OR any ancestor group's `hidden` (see
   *  isItemHidden / isGroupChainHidden in compositionOps). Mirrors `locked`.
   *  Stored true/undefined, never false. */
  hidden?: boolean;
}

export interface CompositionEntry {
  id: string;
  name: string;
  isSample?: boolean;
  /** Banner text to display at the top of the editor. Set on copies made
   *  from a dynamic sample so the activity prompt survives independently
   *  of the manifest. */
  bannerText?: string;
  /** Resolved example image URLs snapshotted at copy time. */
  exampleImageUrls?: string[];
  /** Just-created dynamic-sample copy that the user hasn't yet edited.
   *  Hidden from the User Files list and deleted when the Compositions
   *  list next regains focus; the editor clears the flag on first
   *  content edit so a touched copy persists like any other comp. */
  tentative?: boolean;
  /** Manifest id this entry was copied from. Used to surface a
   *  work-in-progress prompt when the user taps the same sample card
   *  again, so they can return to their prior copy instead of accumulating
   *  duplicates. */
  sourceDynamicSampleId?: string;
}

/**
 * RGB color in the 0–255 range. Mirrors the activeColor triple used by the
 * figure editor so that the "last chosen color" can flow between editors
 * unchanged.
 */
export interface RGBColor { r: number; g: number; b: number; }

// LineObject has been merged into SVGObject. Lines are now SVGObjects
// whose segments are all `kind: 'line'`. The `lineDirection` and
// `creationBox` fields on SVGObject support H/V line special editing.

/**
 * The in-progress line while the Line tool is active. Stores the two
 * corners of the bounding-box drag so the SVG layer can draw a preview
 * line and the overlay can show the bounding rectangle. Cleared on
 * tool toggle-off or pointer-up.
 */
export interface LineDraft {
  startVertex: [number, number];
  currentEnd: [number, number];
  color: RGBColor;
}

/**
 * A single segment in a path stroke chain.
 *
 * `kind: 'arc'` is a quarter-circle arc; three points in L0-cell space
 * fully determine it (radius = dist(center, start) = dist(center, end);
 * sweepCW = cross(S-C, E-C) > 0 in screen-y-down coords).
 *
 * `kind: 'line'` is a straight segment between `start` and `end`.
 */
export interface CurveSegment {
  kind: 'arc';
  start: [number, number];
  end: [number, number];
  center: [number, number];
}
export interface LineSegment {
  kind: 'line';
  start: [number, number];
  end: [number, number];
}
export type PathSegment = CurveSegment | LineSegment;

/**
 * A generic SVG scene node storing stroke/fill geometry as path segments.
 * This is the unified type for all vector data in compositions (replaces
 * the former separate line and arc types). Segments can be straight (`kind:
 * 'line'`) or curved (`kind: 'arc'`).
 *
 * The bbox `cellX/Y/Width/Height` is the world-space frame and is the
 * source of truth for scale and move. When grouped, `localSegments` holds
 * pre-group-transform segments and world `segments` are recomputed via
 * `materializeGroupMembers`.
 */
/** A colored sub-path within an SVGObject. Used when join merges objects
 *  with different colors — each original color becomes a subpath. */
export interface SVGSubpath {
  segments: PathSegment[];
  color: RGBColor;
  /** When true the subpath renders as FILLED closed loops (chained via
   *  `buildClosedFillPathD`, nonzero fill rule) instead of a stroked path.
   *  Fill subpaths render beneath stroke subpaths. Used by figure→SVG baking
   *  where color-painted cells are filled rects while sprite art is strokes.
   *  Persisted from binary format v37 (per-subpath flags byte). */
  fill?: boolean;
}

/**
 * Per-object stroke settings for an {@link SVGObject} — the Stroke bar's
 * Width / Radius / Position / Dash rows. The stroke COLOR is not here: an SVG
 * object's stroke color is its own `color` field (what the color tool, join
 * and export already read), so duplicating it would give the same stroke two
 * sources of truth.
 *
 * Every field is optional and absent means "unchanged from the default": no
 * `width` strokes at the composition-wide `strokeScale`, no `dash` strokes
 * solid, and so on. That keeps an untouched object's record byte-identical to
 * what it was before this block existed.
 */
export interface SVGStroke {
  /** Stroke width in world cells (design pt ÷ 16). Undefined = the
   *  composition-wide `strokeScale`. */
  width?: number;
  /** Corner rounding at the path's own joins, as a 0–0.5 fraction of the
   *  shorter bbox side (0 = sharp). Only line→line joins round; a join that
   *  already meets an arc is left alone. */
  radius?: number;
  /** Stroke alignment vs. the path. Meaningful only for a CLOSED path (a
   *  rectangle, circle or preset shape) — an open path like a line, arc or
   *  freehand stroke has no inside, so this is inert there. Undefined =
   *  'center' (the stroke straddles the path, i.e. today's rendering). */
  position?: BorderPosition;
  /** Dash density 0–10; 0 / undefined = solid. Shares `borderDashPattern`
   *  with the border effect so a dashed stroke and a dashed border match. */
  dash?: number;
}

/** What sits AT one loose end of an open path — the Endpoints bar's first two
 *  rows. 'none' (the default) leaves the end bare. */
export type SVGEndMarker = 'none' | 'circle' | 'arrow';

/** How one loose end of an open path is capped. 'round' is the default (and
 *  what every path has always been drawn with); 'square' extends the stroke
 *  half its width past the endpoint, the SVG `stroke-linecap` definitions. */
export type SVGEndCap = 'round' | 'square';

/**
 * Per-END decoration for an OPEN path — a line, an arc, or a freehand stroke
 * (see `svgSubtype`). A closed path has no loose end, so this is inert there.
 *
 * The two ends are independent: `start` is the beginning of the chain as drawn
 * (`segments[0].start`) and `end` its finish (`segments[n-1].end`). Every field
 * is optional and absent means the default — no marker, round cap — so an
 * object that has never visited the Endpoints bar carries nothing at all.
 */
export interface SVGEndpoints {
  startMarker?: SVGEndMarker;
  endMarker?: SVGEndMarker;
  startCap?: SVGEndCap;
  endCap?: SVGEndCap;
}

export interface SVGObject {
  id: string;
  name?: string;
  /** Geometric shape kind at creation time. Persists through duplication
   *  and renaming so scaling/selection behavior stays correct. */
  shapeKind?: 'rectangle' | 'polygon';
  segments: PathSegment[];
  color: RGBColor;
  /** Additional colored sub-paths. When present, the object renders multiple
   *  strokes: the primary `segments` at `color`, plus each subpath at its own
   *  color. Created by join of different-colored objects. */
  subpaths?: SVGSubpath[];
  groupId?: string;
  preGroupName?: string;
  locked?: boolean;
  /** When true, the object is not rendered on the canvas and not
   *  hit-testable. Toggled via the eye icon in the Scene Outline. */
  hidden?: boolean;
  /** Pre-group-transform segments; only set while groupId is set. */
  localSegments?: PathSegment[];
  /** Pre-group-transform subpaths; only set while `groupId` is set AND the
   *  object has world `subpaths`. Mirrors the localSegments invariant: the
   *  group transform pass (`materializeSVGMember`) rebuilds world `subpaths`
   *  from `localSubpaths` so per-color-group geometry survives group moves /
   *  scales / rotations alongside the main `segments`. Each entry's color
   *  matches the corresponding world subpath's color; only its `segments`
   *  are in local space. */
  localSubpaths?: SVGSubpath[];
  /** World bbox. Always equal to the AABB of all segment endpoints (and
   *  arc centers). Maintained by every reducer site that writes `segments`. */
  cellX: number;
  cellY: number;
  cellWidth: number;
  cellHeight: number;
  /** Pre-group-transform bbox; only set while groupId is set. */
  localCellX?: number;
  localCellY?: number;
  localCellWidth?: number;
  localCellHeight?: number;
  /** Segments at identity (rotation=0, no mirror). Stored on first
   *  rotate/mirror so repeated transforms pivot around a stable center
   *  and 360° returns to the exact original position. Cleared on move. */
  identitySegments?: PathSegment[];
  /** Region position at identity. Tile-mode only — stashed on first
   *  tile-mode rotation so the region's W/H swap stays stable across a
   *  360° cycle (mirrors `CompositionFigure.identityCellX/Y`). Cleared
   *  on resize. Non-tile SVGs derive identity from `identitySegments`
   *  and don't read these fields. */
  identityCellX?: number;
  identityCellY?: number;
  rotation?: 0 | 90 | 180 | 270;
  /** Free (continuous) rotation in degrees, clockwise, applied about the
   *  bbox center ON TOP OF the discrete `rotation`/`mirror`. Authored by the
   *  two-finger twist gesture; undefined or 0 means no free rotation. Unlike
   *  `rotation` the bbox is NOT swapped — the AABB stays axis-aligned and the
   *  angle is layered at render/export/hit-test time. */
  angleDeg?: number;
  mirrorH?: boolean;
  mirrorV?: boolean;
  /** When 'repeat', this path tiles within its bounding region. */
  tileMode?: 'repeat';
  /** Intrinsic tile width in L0 cells (independent of region size). */
  tileWidthL0?: number;
  /** Intrinsic tile height in L0 cells (independent of region size). */
  tileHeightL0?: number;
  /** Tile-grid offset in L0 cells — same as CompositionFigure.tileOffsetXL0. */
  tileOffsetXL0?: number;
  tileOffsetYL0?: number;
  /** Sparse per-instance segment color overrides for a `tileMode: 'repeat'`
   *  object. Key packs `(tileCol, tileRow, flatSegmentIndex)`; value is the
   *  override color for that segment in that repeated copy. Absent key ⇒ base
   *  color. Lets the user recolor individual copies (and segments within them)
   *  without expanding the pattern into a giant flat SVG. See
   *  `engine/tileSegmentOverrides.ts`. */
  segmentOverrides?: Map<number, RGBColor>;
  /** Solid fill color for closed shapes. When set, the closed path is
   *  rendered as a filled polygon before the stroke paths are drawn. */
  fillColor?: RGBColor;
  /** Fill opacity (0–1). Undefined means fully opaque. */
  fillOpacity?: number;
  /** Gradient (or explicit solid) fill paint (v29+). When set, takes
   *  precedence over `fillColor`/`fillOpacity` at render and export time;
   *  the legacy fields stay populated with a representative solid so v28
   *  readers and untouched render paths degrade gracefully. Coordinates
   *  are in the unit bbox space of the shape (0..1). */
  fillPaint?: Paint;
  /** The shape's own editable fill — what the Fill bar authors (v40+).
   *
   *  Outranks `fillPaint` and `fillColor`/`fillOpacity` wherever a fill is
   *  drawn: it is the EDITABLE record (it keeps the stops a Solid fill isn't
   *  currently using, the angle a Radial one isn't, and the blend mode none of
   *  the older fields can express), while those are the flattened forms. Absent
   *  on every object that has never visited the Fill bar, so an untouched
   *  record — and every legacy fill — is byte-identical to what it was.
   *
   *  Only closed shapes offer it (a rectangle or a circle); see `svgSubtype`. */
  fill?: ShapeFill;
  /** Color-tool brushwork (v49+): a hidden low-resolution RGBA layer the
   *  drag-paint brush colors into, spanning the bbox and MASKED to the
   *  shape's closed outline at render, composited with one blend mode.
   *  Only the fill-bar shapes take it (rectangle / circle / polygon —
   *  the same `svgHasFill` split as `fill`). See {@link ImagePaintOverlay}
   *  (imagePaintOverlay.ts). */
  paintOverlay?: ImagePaintOverlay;
  /** Cached-texture effects: drop shadow, glow, border (v29+). Rendered
   *  as pre-blurred texture passes, never live SVG filters at runtime;
   *  SVG export emits real `<filter>` defs. */
  effects?: NodeEffects;
  /** Per-object stroke overrides — width / corner radius / alignment / dash
   *  for the path's OWN stroke (v35+). Distinct from `effects.border`, which
   *  would draw a separate rect around the bbox. Undefined = stroke at the
   *  composition-wide `strokeScale`, sharp joins, centered, solid. */
  stroke?: SVGStroke;
  /** What the path's two loose ends carry — the Endpoints bar (v41+).
   *
   *  A separate block from `stroke` rather than a field inside it, so the two
   *  bars can never overwrite each other's work: the Stroke bar rebuilds the
   *  whole `stroke` record from its four rows on every edit.
   *
   *  Only OPEN paths offer it (a line, an arc, a freehand stroke); see
   *  `svgSubtype` and `svgHasEndpoints`. Undefined = bare ends, round caps,
   *  which is how every path has always been drawn. */
  endpoints?: SVGEndpoints;
  /** Whole-object render opacity in [0, 1] — the Opacity bar's Opacity row
   *  (v42+). Applies to everything the object draws (fill, stroke, subpaths,
   *  endpoint decorations) as one layer. Undefined = fully opaque, so an
   *  untouched record stays byte-identical to what it was. Distinct from the
   *  fill layer's own `fill.opacity`, which dims only the interior. */
  opacity?: number;
  /** Edge soften in [0, 1] — the Opacity bar's Soften row (v42+). 0 /
   *  undefined = hard edges; the edge itself is always at 0 opacity when set,
   *  with the fade completing `edgeSoften × half the shorter side` inward (at
   *  1 the shape fades from its center out). Rendered as an eroded-then-
   *  blurred silhouette mask (never a live filter on the shape itself); only
   *  the closed shapes offer the control — see `svgHasOpacity` in editor-ui. */
  edgeSoften?: number;
  /** Direction at creation time. Persists through scaling and rotation
   *  so an H/V line never becomes diagonal after creation. Stripped on
   *  join — only original creation-tool lines carry this. */
  lineDirection?: 'horizontal' | 'vertical' | 'diagonal';
  /** When true and this closed shape is a direct group member, it clips its
   *  group siblings (rendering + hit testing). Inert when the shape is not
   *  closed or not grouped. Stored as true/undefined, never false. */
  isMask?: boolean;
  /** When true, this closed shape was turned into a pattern fill: it masks a
   *  sibling `tileMode:'repeat'` figure that fills its bbox (built by
   *  `buildPatternFillScene`). Implies `isMask`. Used so Edit Shape re-enters
   *  pattern-fill mode rather than the generic mask-edit mode. The shape's solid
   *  `fillColor`/`fillOpacity` are preserved but NOT rendered as the shape's own
   *  fill; instead render paths paint that color as the tiled figure's
   *  background (beneath the pattern, framed by the outline) so a shape with a
   *  background color shows both the color and the pattern. */
  isPatternFill?: boolean;
  /** Bounding box at creation time. When present, the overlay and scale
   *  logic use this instead of the tight AABB of segments. Only set for
   *  lines created via the bounding-box drag UX. Cleared on join. */
  creationBox?: { minX: number; minY: number; width: number; height: number };
  /** The figure-file id this object was baked from (a pattern tile drawn in
   *  the tile editor). Presence marks the object as a pattern object: it
   *  scales uniformly (aspect-locked) and offers an Edit action that reopens
   *  the tile editor on the source file and rebakes in place. Persisted from
   *  binary format v38 (flags4 bit 0x01 + string-table ref). */
  patternFileId?: string;
}

/** A saved SVG design template, stored globally so it can be reused
 *  across compositions and exported/imported as part of a .facet file. */
export interface SVGDesignTemplate {
  id: string;
  name: string;
  /** Segments normalized so the bounding box starts at (0, 0). */
  segments: PathSegment[];
  color: RGBColor;
  subpaths?: SVGSubpath[];
  /** Design extent in L0 cells. */
  width: number;
  height: number;
  /** PNG thumbnail as a data URI. */
  thumbnail?: string;
}

/**
 * The in-progress arc while the Arc tool is active. Lives on the reducer
 * state so the SVG layer can draw it as it grows.
 */
export interface ArcDraft {
  startVertex: [number, number];
  currentEnd: [number, number];
  center: [number, number];
  color: RGBColor;
}

/** Blend modes for the Color tool's drag-paint brush. */
export type BlendMode = 'normal' | 'multiply' | 'dodge' | 'lighten' | 'darken' | 'burn' | 'invert' | 'rotate' | 'randomize' | 'hue' | 'color';

/**
 * Snapshot of an SVGObject captured at the start of a paint stroke. Used
 * to (a) freeze segment identity (flat indices stay stable across moves)
 * and (b) supply the exact pre-stroke shape for the undo entry.
 */
export interface PaintStrokeSVGSnapshot {
  color: RGBColor;
  segments: PathSegment[];
  subpaths?: SVGSubpath[];
  localSegments?: PathSegment[];
  localSubpaths?: SVGSubpath[];
  fillColor?: RGBColor;
  /** Group membership at first touch, so the paint-preview overlay can resolve
   *  the object's mask clip without waiting for the committed render — needed
   *  for mid-stroke figure expansions whose rendered entry doesn't exist yet. */
  groupId?: string;
}

/**
 * In-flight paint stroke. Mirrors the lineDraft / arcDraft pattern: the
 * GL textures are *not* mutated mid-stroke; the SVG overlay reads from
 * this draft to render the preview, and a single finalize action on
 * pointer-up builds and pushes the undo entry.
 *
 * The accumulator's flat segment index is computed once on first touch
 * of a given SVG as `[...svg.segments, ...(svg.subpaths ?? []).flatMap(s => s.segments)]`
 * and stays stable for the rest of the stroke.
 */
export interface PaintStrokeDraft {
  brushColor: RGBColor;
  blendMode: BlendMode;
  opacity: number;
  /** Per-SVG, the effective color each painted segment will end up at.
   *  Keyed by flat segment index. */
  paintedSegments: Map<string, Map<number, RGBColor>>;
  /** Per-tiled-SVG, the effective color each painted (copy, segment) will end
   *  up at. Keyed by the packed `(col,row,segIdx)` key from
   *  `engine/tileSegmentOverrides.ts`. Populated only in sparse per-copy paint
   *  mode (the `expandFiguresOnRecolor` toggle off); kept separate from
   *  `paintedSegments` so the single-tile live preview path is undisturbed. */
  paintedTileSegments?: Map<string, Map<number, RGBColor>>;
  /** Per-figure, the brushed color override. Figures recolor as a whole. */
  paintedFigures: Map<string, RGBColor>;
  /** Per-SVG, the brushed fill color (only for SVGs that already had fillColor). */
  paintedFills: Map<string, RGBColor>;
  /** SVG snapshots, populated on first touch of each SVG. */
  svgSnapshots: Map<string, PaintStrokeSVGSnapshot>;
  /** Figure snapshots — pre-stroke `colorOverride`. */
  figureSnapshots: Map<string, RGBColor | undefined>;
}

/**
 * A reference image placed on the composition canvas. Bbox-only scene
 * node — `cellX/Y/Width/Height` is the source of truth for move/scale.
 * Bytes live off-node in `CompositionState.imageBlobs` keyed by
 * `imageId` so duplicates share pixel data and undo entries stay cheap.
 *
 * Behavior mirrors `SVGObject` for selection, grouping, and transforms —
 * registers in `SCENE_ADAPTERS` so generic ops (delete, duplicate, lock,
 * send-to-back, reorder, undo) work uniformly.
 */
export interface ImageObject {
  id: string;
  name?: string;
  /** Stable key into `CompositionState.imageBlobs`; shared across
   *  duplicates so cloning an image doesn't double the bytes. Addresses the
   *  *display* bitmap (downsampled to keep the canvas within the iOS bitmap
   *  budget). */
  imageId: string;
  /** Optional key into the same `CompositionState.imageBlobs` map addressing
   *  a higher-resolution *original* copy (bounded at import), kept solely so
   *  export/rasterization can emit full detail while the canvas keeps using
   *  the smaller `imageId` bitmap. Absent when the source already fit the
   *  display cap (then `imageId` is already full resolution) and on saves
   *  made before this field existed — export falls back to `imageId`. */
  originalImageId?: string;
  mimeType: 'image/png' | 'image/jpeg';
  /** Intrinsic pixel dimensions of the *stored* (post-downsample)
   *  bitmap. Used for aspect ratio; not changed by scale handles. */
  pixelWidth: number;
  pixelHeight: number;
  /** World bbox — single source of truth for move/scale. Always equal
   *  to the rectangle the image is rendered into. */
  cellX: number;
  cellY: number;
  cellWidth: number;
  cellHeight: number;
  rotation?: 0 | 90 | 180 | 270;
  /** Free (continuous) rotation in degrees, clockwise, about the bbox
   *  center, layered on top of the discrete `rotation`/`mirror`. Authored by
   *  the two-finger twist gesture; undefined/0 = none. See
   *  {@link SVGObject.angleDeg}. */
  angleDeg?: number;
  mirrorH?: boolean;
  mirrorV?: boolean;
  /** Render opacity in [0, 1]. Reference images often want to fade for
   *  trace-over use; default (undefined) = fully opaque so older saves
   *  and newly imported images render unchanged. */
  opacity?: number;
  /** Edge soften in [0, 1] — the Opacity bar's Soften row (v42+). 0 /
   *  undefined = hard edges; the frame edge itself is always at 0 opacity
   *  when set, with the fade completing `edgeSoften × half the shorter side`
   *  inward (at 1 the image fades from its center out). Rendered as a
   *  gradient / eroded-then-blurred mask over the framed content (following
   *  any corner rounding), never a live filter. */
  edgeSoften?: number;
  /** Shader-time recolor (v29+): applied at draw time from the original
   *  bitmap — zero extra memory, no re-encode. Export bakes the tint
   *  when rasterizing and emits `feColorMatrix` in SVG. */
  tint?: ImageTint;
  /** Gradient tint overlay (v35+): a solid / linear / radial fill composited
   *  over the image with a blend mode + layer opacity (the "Tint" bar,
   *  design 6a). Distinct from the shader `tint` above — this is a
   *  non-destructive overlay layer. See {@link ImageTintFill}. */
  tintFill?: ImageTintFill;
  /** Color-tool brushwork (v48+): a hidden low-resolution RGBA layer the
   *  drag-paint brush colors into, composited over the image with one blend
   *  mode. Lives in the image's inner content frame (the box the bitmap
   *  fills), so it rides rotation/mirror with the pixels and stretches with
   *  the bbox. See {@link ImagePaintOverlay} (imagePaintOverlay.ts). */
  paintOverlay?: ImagePaintOverlay;
  /** Cached-texture effects (v29+); see `SVGObject.effects`. */
  effects?: NodeEffects;
  /** Corner rounding as a fraction (0–0.5) of the shorter side. Undefined /
   *  0 = square corners; 0.5 = fully rounded (circle/pill). Applied as a
   *  rounded clip on the canvas and a `clipPath` rounded rect in SVG export.
   *  Persisted in the composition JSON. */
  cornerRadius?: number;
  /** How the bitmap fills the frame (bbox) — the "Crop" bar. Undefined = the
   *  legacy stretch-to-fill (`object-fit: fill`). See {@link ImageFraming}. */
  framing?: ImageFraming;
  locked?: boolean;
  /** When true, the image is not rendered on the canvas and not
   *  hit-testable. Toggled via the eye icon in the Scene Outline. */
  hidden?: boolean;
  groupId?: string;
  preGroupName?: string;
  /** Pre-group-transform bbox; only set while groupId is set. */
  localCellX?: number;
  localCellY?: number;
  localCellWidth?: number;
  localCellHeight?: number;
  /** Bbox at identity (rotation=0, no mirror). Stored on first
   *  rotate/mirror so repeated transforms pivot around a stable center
   *  and 360° returns to the exact original position. Cleared on move
   *  or scale. Same stabilization pattern as `SVGObject.identitySegments`
   *  but for bbox-only geometry. */
  identityCellX?: number;
  identityCellY?: number;
  identityCellWidth?: number;
  identityCellHeight?: number;
}

/**
 * A paint island: the raster brush's editable-image scene node (v52+). A
 * cluster of strokes from one paint session, held as SPARSE raster tiles
 * with a transparent background. Unlike the retired global canvas layer it
 * replaces, an island lives in `sceneOrder` — it can be selected, dragged,
 * reordered, renamed, hidden, locked, grouped, and merged with other
 * islands. Bbox-only scene node; registers in `SCENE_ADAPTERS` /
 * `GEOMETRY_ADAPTERS` (id prefix `pnt_`) so generic ops work uniformly.
 *
 * ## Tile space vs world space
 *
 * `tiles` live in the object's own TILE SPACE — the world-cell frame the
 * island was painted in. `contentX/Y/W/H` is the rect in tile space that
 * maps onto the world bbox (`cellX/Y/Width/Height`): rendering stretches
 * contentRect → bbox exactly like `ImagePaintOverlay` stretches with its
 * frame, so resize changes `cell*` only and never resamples texels.
 *
 * At creation, and for as long as the island can still take session
 * strokes, tile space == world space: bbox == contentRect, no
 * rotation/mirror/angle, 1:1 scale (`paintObjectIsUntransformed`). Any
 * transform requires leaving the paint tool group, which ends the session —
 * so in-session bbox growth (contentRect == fresh ink bounds) only ever
 * happens at 1:1, and brush math never needs the general inverse map.
 *
 * Tiles are immutable-by-convention like committed islands always were:
 * strokes clone-on-touch via `CanvasPaintWorking`, commits swap the whole
 * `tiles` array, and undo entries hold the old array by reference.
 */
export interface PaintObject {
  id: string;
  name?: string;
  /** World bbox — single source of truth for move/scale. */
  cellX: number;
  cellY: number;
  cellWidth: number;
  cellHeight: number;
  rotation?: 0 | 90 | 180 | 270;
  /** Free rotation, degrees clockwise about the bbox center, layered on the
   *  discrete `rotation`/`mirror`. See {@link SVGObject.angleDeg}. */
  angleDeg?: number;
  mirrorH?: boolean;
  mirrorV?: boolean;
  /** Render opacity in [0, 1]; undefined = opaque. The island's ONLY
   *  type-specific edit option (no Stroke/Fill — it is raster brushwork). */
  opacity?: number;
  /** Edge soften in [0, 1] — rides the shared Opacity bar like images. */
  edgeSoften?: number;
  locked?: boolean;
  hidden?: boolean;
  groupId?: string;
  preGroupName?: string;
  /** Pre-group-transform bbox; only set while groupId is set. */
  localCellX?: number;
  localCellY?: number;
  localCellWidth?: number;
  localCellHeight?: number;
  /** Bbox at identity — same stabilization pattern as ImageObject. */
  identityCellX?: number;
  identityCellY?: number;
  identityCellWidth?: number;
  identityCellHeight?: number;
  /** Sparse raster content: 16-cell / 128-texel tiles on the shared
   *  allocation grid (see canvasPaint.ts), in TILE SPACE. Never empty — an
   *  island erased to no ink is removed from the scene instead. */
  tiles: CanvasPaintIsland[];
  /** The tile-space rect mapped onto the bbox (the ink bounds at the last
   *  in-session stroke). */
  contentX: number;
  contentY: number;
  contentW: number;
  contentH: number;
}

// ── Pattern objects (v54) ───────────────────────────────────────────

/**
 * Symmetry flags for pattern-cell painting. Structurally identical to
 * paintMirror's MirrorFlags (defined here so types.ts stays import-free);
 * exactly one mode is active at a time — the symmetry picker grid is
 * exclusive. All-false = symmetry off.
 */
export interface PatternSymmetry {
  mirrorH: boolean;
  mirrorV: boolean;
  mirrorRotate: boolean;
  mirrorQuad: boolean;
  mirrorRow: boolean;
  mirrorCol: boolean;
  mirrorDiag1: boolean;
  mirrorDiag2: boolean;
  mirrorDiagBoth: boolean;
  mirrorStar: boolean;
}

export const PATTERN_SYMMETRY_OFF: PatternSymmetry = {
  mirrorH: false, mirrorV: false, mirrorRotate: false, mirrorQuad: false,
  mirrorRow: false, mirrorCol: false, mirrorDiag1: false, mirrorDiag2: false,
  mirrorDiagBoth: false, mirrorStar: false,
};

/**
 * A tile-pattern scene node (v54+): a single-resolution grid of tile cells
 * (≤ 16×16) edited inline on the main canvas — no separate editor, no
 * layers, no tile-file store. Cells live directly on the object; the
 * renderer bakes them to SVG markup on edit (see patternObject.ts).
 *
 * Before any cell is filled the object renders as nothing (an empty
 * rectangle with no fill and no border); hit testing is bbox-definitive
 * regardless, so an empty pattern is still tappable/selectable.
 */
export interface PatternObject {
  id: string;
  name?: string;
  /** World bbox. In repeat mode this is the repeating REGION; the intrinsic
   *  tile size lives in tileWidthL0/tileHeightL0 (same model as SVGObject). */
  cellX: number;
  cellY: number;
  cellWidth: number;
  cellHeight: number;
  /** Grid resolution — number of tile cells per axis, 1..16. Fixed at
   *  creation from the dragged region. */
  cols: number;
  rows: number;
  /** Row-major cell states, length cols*rows. CellState already includes
   *  null (empty). Reuses the tile-editor cell model so connectivity and
   *  the SVG bake operate on it unchanged. */
  cells: CellState[];
  /** Painting symmetry (the Symmetry properties bar). Undefined = off. */
  symmetry?: PatternSymmetry;
  /** Border-connection rule for connectivity (the Tools bar switch).
   *  Undefined = true (borders may connect), matching the old editor. */
  allowBorderConnections?: boolean;
  /** When 'repeat', the cols×rows tile block repeats within the bbox
   *  region. Same fields + semantics as SVGObject's tile mode so toggle /
   *  resize / render logic is shared. */
  tileMode?: 'repeat';
  tileWidthL0?: number;
  tileHeightL0?: number;
  tileOffsetXL0?: number;
  tileOffsetYL0?: number;
  rotation?: 0 | 90 | 180 | 270;
  /** Free rotation, degrees CW about the bbox center. See SVGObject.angleDeg. */
  angleDeg?: number;
  mirrorH?: boolean;
  mirrorV?: boolean;
  /** Whole-object render opacity in [0, 1]; undefined = opaque. */
  opacity?: number;
  /** Per-object stroke overrides — width / dash for the baked tile paths,
   *  the same block SVGObject carries (the Stroke bar authors it). Always
   *  seeded with an explicit world-cell `width` at creation: an authored
   *  width renders through the same world-based formula in BOTH the flat
   *  and the tiled (repeat) markup, so toggling repeat can never change
   *  the drawn line weight. Undefined (older records) falls back to the
   *  composition-wide strokeScale, exactly like an SVGObject. */
  stroke?: SVGStroke;
  locked?: boolean;
  hidden?: boolean;
  groupId?: string;
  preGroupName?: string;
  /** Pre-group-transform bbox; only set while groupId is set. */
  localCellX?: number;
  localCellY?: number;
  localCellWidth?: number;
  localCellHeight?: number;
  /** Bbox at identity — same stabilization pattern as ImageObject. */
  identityCellX?: number;
  identityCellY?: number;
  identityCellWidth?: number;
  identityCellHeight?: number;
}

// ── Paint, effects, tint, text (v29 additions) ──────────────────────

export interface GradientStop {
  /** Position along the gradient in [0, 1]. */
  offset: number;
  color: RGBColor;
  /** Stop alpha in [0, 1]; undefined = opaque. */
  alpha?: number;
}

/**
 * Fill paint for shapes and the canvas background: solid or a 2–4 stop
 * gradient. Gradient geometry is expressed in the unit bbox space of the
 * painted region ((0,0) top-left → (1,1) bottom-right) so paints survive
 * move/scale without rewrites. Rendered in the fragment shader; exported
 * as `<linearGradient>/<radialGradient>` defs.
 */
export type Paint =
  | { kind: 'solid'; color: RGBColor; alpha?: number }
  | { kind: 'linear'; stops: GradientStop[]; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'radial'; stops: GradientStop[]; cx: number; cy: number; r: number };

export interface ShadowEffect { dx: number; dy: number; blur: number; color: RGBColor; alpha: number;
  /** Dilation of the shadow shape before blur, in world cells (CSS box-shadow
   *  "spread"). Undefined / 0 = the plain drop shadow. */
  spread?: number }
export interface GlowEffect { radius: number; color: RGBColor; alpha: number }
/** Stroke alignment relative to the node's bbox edge. */
export type BorderPosition = 'inside' | 'center' | 'outside';
export interface BorderEffect { width: number; color: RGBColor; radius?: number;
  /** Stroke alignment vs. the bbox edge. Undefined = 'center' (stroke
   *  straddles the edge). 'inside' sits fully within the bbox, 'outside'
   *  fully outside. */
  position?: BorderPosition;
  /** Dash density 0–10; 0 / undefined = solid. Higher = shorter dashes,
   *  ending at dots at 10 (see `borderDashPattern`). */
  dash?: number;
  /** Border color opacity in [0, 1]; undefined = opaque (v55+). */
  alpha?: number }

/**
 * Per-node visual effects. Shadows/glows render as a pre-blurred texture
 * pass cached per node, invalidated only when the node's raster content
 * changes — never during move/scale (90 fps rule). Borders are stroked
 * rounded rects drawn in the compositor.
 */
export interface NodeEffects {
  shadow?: ShadowEffect;
  glow?: GlowEffect;
  border?: BorderEffect;
}

export type ImageTintMode = 'tint' | 'duotone' | 'wash';

/** Shader-time image recolor; `amount` in [0, 1] blends toward the tinted
 *  result. See `applyImageTint` (imageTint.ts) for the per-mode math. */
export interface ImageTint {
  color: RGBColor;
  amount: number;
  mode: ImageTintMode;
}

/** Fill type of the gradient tint overlay (the Tint bar's Type control). */
export type ImageTintFillType = 'solid' | 'linear' | 'radial';

/** Compositing mode for the gradient tint overlay. These are the CSS
 *  `mix-blend-mode` keywords (and map onto Core Image's blend filters), so the
 *  web preview + SVG export need no lookup. This is the Tint design's own
 *  8-mode set — deliberately NOT the generative {@link BlendMode} (which lacks
 *  soft-light / saturation). */
export type ImageTintBlend =
  | 'normal' | 'multiply' | 'darken' | 'lighten'
  | 'soft-light' | 'color' | 'hue' | 'saturation';

/**
 * The color tool's brushwork on an image or a solid shape: a low-resolution
 * straight-alpha RGBA bitmap spanning the node's bbox frame (an image's
 * inner content frame; a shape's bbox, masked to its outline at render),
 * upscaled smoothly at render and composited with ONE blend mode for the
 * whole layer (per-stroke modes can't mix inside a single bitmap; a stroke
 * in a new mode re-modes the layer). The texel grid is sized once from the
 * frame at first paint ({@link OVERLAY_TEXELS_PER_CELL}, clamped) and never
 * re-sampled — the layer stretches with the bbox like the content does.
 * Rendered by the DOM node layer and the SVG export from the SAME
 * engine-encoded PNG (`overlayPngDataUri`), so the two can't drift.
 */
export interface ImagePaintOverlay {
  cols: number;
  rows: number;
  /** Straight-alpha RGBA texels, row-major, `cols × rows × 4` bytes. */
  rgba: Uint8Array;
  /** Blend mode of the whole layer; CSS mapping via `paintBlendCss`. The
   *  unary brush modes never paint images, so they don't appear here. */
  blend: BlendMode;
}

/**
 * One sparse raster island of the paint tool's canvas layer (v51+): an
 * {@link ImagePaintOverlay} bitmap anchored at (x, y) world cells, covering
 * `widthCells` horizontally — the covered height follows from the texel grid
 * being square (see canvasPaint.ts `islandHeightCells`). The canvas layer is
 * a LIST of these, so paint can land anywhere in world space and only
 * regions that actually hold ink are allocated. Islands the allocator
 * creates sit on a fixed tile grid and never overlap; loaders normalize
 * anything else onto it (canvasPaint.ts `normalizeCanvasPaintIslands`).
 */
export interface CanvasPaintIsland {
  /** Origin, world cells. */
  x: number;
  y: number;
  /** Width covered, world cells. */
  widthCells: number;
  overlay: ImagePaintOverlay;
}

/** A gradient tint overlay composited onto an image (design 6a). The overlay
 *  is clipped to the image frame and flattened at export. Non-active fields are
 *  retained so switching Type back restores them (a Solid tint remembers its
 *  gradient, a Radial one its angle). Convert to a {@link Paint} for rendering
 *  / export via `tintFillToPaint` (imageTintFill.ts). */
export interface ImageTintFill {
  type: ImageTintFillType;
  /** Solid-mode color. */
  solid: RGBColor;
  /** Gradient stops (min 2), offset 0..1 — used by linear / radial. */
  stops: GradientStop[];
  /** Linear gradient angle in degrees, 0..360 (90 = top→bottom). */
  angle: number;
  /** Whole-layer opacity 0..1, applied after the blend. */
  opacity: number;
  blend: ImageTintBlend;
}

/** A closed shape's own editable fill — the Fill bar (see {@link SVGObject.fill}).
 *
 *  It is the SAME editable spec as the image tint overlay, aliased rather than
 *  re-declared so the two menus (and the single `tintFillToPaint` converter they
 *  share) can't drift: both are "solid / linear / radial, with the non-active
 *  fields retained, composited at an opacity and a blend mode". The difference
 *  is only what the paint lands on — an overlay over a bitmap vs. the interior
 *  of a path. */
export type ShapeFill = ImageTintFill;

export type TextAlign = 'left' | 'center' | 'right';
/** Vertical alignment of the text block within its bbox height (top default;
 *  only visible when the box is taller than the laid-out lines, e.g. a
 *  corner-resized text box). */
export type TextVAlign = 'top' | 'middle' | 'bottom';

/** Named font weights, mapped to the closest available face of the family
 *  by the renderer (see `effectiveFontWeight`). Supersedes the legacy `bold`
 *  boolean when present; `bold` is kept for back-compat reads. */
export type FontWeight = 'light' | 'regular' | 'semibold' | 'bold';

export interface TextStroke { width: number; color: RGBColor }

/** Style block for a text node. Split from TextObject so `setTextStyle`
 *  undo ops can swap the whole block atomically. */
export interface TextStyle {
  /** Font id from the app's registered font pack (the engine ships no
   *  fonts; apps register them, mirroring `registerBuiltInContent`). */
  fontId: string;
  /** Font size in L0 cell units (world units), so text scales with the
   *  composition like every other node. */
  size: number;
  /** Named weight (light/regular/semibold/bold). When set it supersedes
   *  `bold`; absent falls back to `bold` for compositions saved before the
   *  weight control existed. See {@link effectiveFontWeight}. */
  weight?: FontWeight;
  bold?: boolean;
  italic?: boolean;
  color: RGBColor;
  /** Ink opacity in [0, 1] for the whole text (fill, per-char brush colors
   *  and outline stroke together); undefined = opaque (v55+). */
  alpha?: number;
  /** Extra letter spacing in em units. */
  letterSpacing?: number;
  /** Line height as a multiple of size (default 1.2). */
  lineHeight?: number;
  align?: TextAlign;
  /** Vertical alignment within the bbox height (default 'top'). */
  vAlign?: TextVAlign;
  /** Optional outline stroke drawn behind the fill. */
  stroke?: TextStroke;
  /**
   * Per-character color overrides (the color tool's brush on text), indexed
   * by code point into `content` (the `Array.from` walk every layout and
   * spacing computation uses). `null`/absent entries inherit `color`; the
   * array may be shorter than the content. Setting the font color as a whole
   * replaces the brushwork: writers of `color` drop this field. Indices are
   * positional — a content edit does not remap them.
   */
  charColors?: (RGBColor | null)[];
}

/**
 * First-class text scene node (`CompItemKind: 'text'`, id namespace
 * `txt_…`). Same bbox/transform model as `ImageObject`: `cell*` is the
 * world bbox, rotation/mirror are discrete, moving or rotating text is a
 * pure transform — glyph rasters are cached and only invalidated on
 * content/style change. Editing happens through committed `setText` /
 * `setTextStyle` ops (a hidden DOM textarea drives input/IME app-side)
 * so undo entries stay coarse and replayable.
 */
export interface TextObject {
  id: string;
  name?: string;
  content: string;
  style: TextStyle;
  /** Word-sticker preset (magnetic poetry): padded rounded-rect
   *  background, slight shadow, content not editable in place. A style
   *  preset, not a separate node kind. */
  sticker?: boolean;
  /** Sticker-only: invert the card's color scheme (dark card + light text
   *  instead of the default light card + dark text). The single
   *  type-specific option a word sticker exposes; ignored when `sticker`
   *  is not set. */
  invert?: boolean;
  cellX: number;
  cellY: number;
  cellWidth: number;
  cellHeight: number;
  /** Figma-style sizing mode. Absent = auto-size: the bbox hugs the content
   *  and re-measures (anchored by align/vAlign) whenever content or a
   *  metric-affecting style field changes. Set once the user explicitly
   *  authors the box (drag-to-place with a box, corner-handle resize); from
   *  then on content/style edits leave the bbox alone and text reflows
   *  within it. Alignment changes never touch the bbox in either mode. */
  fixedSize?: boolean;
  rotation?: 0 | 90 | 180 | 270;
  /** Free (continuous) rotation in degrees, clockwise, about the bbox
   *  center, layered on top of the discrete `rotation`/`mirror`. Authored by
   *  the two-finger twist gesture; undefined/0 = none. See
   *  {@link SVGObject.angleDeg}. */
  angleDeg?: number;
  mirrorH?: boolean;
  mirrorV?: boolean;
  locked?: boolean;
  hidden?: boolean;
  groupId?: string;
  preGroupName?: string;
  /** Pre-group-transform bbox; only set while groupId is set. */
  localCellX?: number;
  localCellY?: number;
  localCellWidth?: number;
  localCellHeight?: number;
  /** Bbox at identity; same stabilization pattern as `ImageObject`. */
  identityCellX?: number;
  identityCellY?: number;
  identityCellWidth?: number;
  identityCellHeight?: number;
  effects?: NodeEffects;
}

export type CompToolType = 'place' | 'select' | 'rotate' | 'mirror' | 'create' | 'line' | 'arc' | 'color';

export interface CreateRegion {
  startCellX: number;
  startCellY: number;
  endCellX: number;
  endCellY: number;
}

export interface CompositionState {
  id: string;
  name: string;
  figures: CompositionFigure[];
  /**
   * All vector stroke/fill scene nodes (lines, arcs, and joined paths).
   * Selection state shared via `selectedFigureIds` (svg ids are namespaced
   * `svg_…`).
   */
  svgObjects: SVGObject[];
  /**
   * Reference image scene nodes. Pixel bytes live in `imageBlobs` keyed
   * by each node's `imageId`.
   */
  images?: ImageObject[];
  /**
   * Pixel-byte registry for `images`. Keyed by `imageId` (which can be
   * shared across multiple `ImageObject` instances when one is
   * duplicated). Also holds each image's optional higher-resolution
   * `originalImageId` copy under its own key — same map, distinct id, used
   * only at export time. Populated on import and on .tile load. Persisted
   * inline in the .tile file so compositions stay self-contained.
   */
  imageBlobs?: Record<string, Uint8Array>;
  /**
   * Text scene nodes (v29+). Optional so pre-text fixtures and loaders
   * treat absent and empty the same, mirroring `images`.
   */
  texts?: TextObject[];
  /**
   * Canvas background paint (v29+). Undefined = the renderer's default
   * dark clear color, preserving pre-v29 appearance.
   */
  background?: Paint;
  /**
   * Paint island scene nodes (v52+): the raster brush's strokes, grouped
   * into editable-image objects that live in `sceneOrder` like any other
   * node. Replaces the retired v50/v51 global `canvasPaint` layer (which
   * was deliberately outside the scene graph); old saves' canvasPaint is
   * dropped on load. Optional so pre-paint fixtures and loaders treat
   * absent and empty the same, mirroring `images`/`texts`.
   */
  paintObjects?: PaintObject[];
  /**
   * Tile-pattern scene nodes (v54+): single-resolution tile grids edited
   * inline on the canvas. Optional so pre-pattern fixtures and loaders
   * treat absent and empty the same, mirroring `images`/`texts`.
   */
  patternObjects?: PatternObject[];
  /**
   * The in-progress line currently being drawn while `compTool === 'line'`.
   * On tool toggle-off, finalized into `svgObjects` if valid.
   */
  lineDraft: LineDraft | null;
  /**
   * The in-progress arc while `compTool === 'arc'`. On tool toggle-off
   * or pointer-up, finalized into `svgObjects` if the start and end
   * differ, else discarded.
   */
  arcDraft: ArcDraft | null;
  /**
   * The in-progress paint stroke while the user drags with the Color tool.
   * Null / absent when not painting. The overlay layer reads from this;
   * svgObjects and figures are *not* mutated until pointer-up, when a
   * single undo entry commits all the per-segment recolors at once. See
   * `PaintStrokeDraft`. Optional so existing fixtures and persistence
   * loaders don't need to spell out `null` — treat absent and null the
   * same.
   */
  paintStroke?: PaintStrokeDraft | null;
  /**
   * The SVG object whose segments are draggable via the Object Properties
   * **Edit** action. `null` when not in segment-edit mode.
   */
  editingLineId: string | null;
  /**
   * Index into the editing SVG object's segments that the user has grabbed
   * (or null if none). Cleared whenever edit mode ends.
   */
  selectedVertexIndex: number | null;
  /**
   * The most recent color picked in the figure editor's color picker, or
   * the line color picker. Seeds new `SVGObject.color` on creation. Not
   * undoable — this is editor-session ergonomics, not document content.
   */
  lastChosenColor: RGBColor;
  /**
   * Custom colors saved with this composition. Populated when the user
   * picks a non-default color via the composer's color tool or line color
   * picker; shown as extra swatches alongside the hardcoded defaults.
   * Excludes the 9 entries of COLOR_PALETTE. Append-only via ADD_CUSTOM_COLOR;
   * long-press on a swatch removes via REMOVE_CUSTOM_COLOR.
   */
  customColors: RGBColor[];
  /**
   * Scene-graph group nodes. Each member's `groupId` references one of
   * these. Empty by default; populated by `groupFigures` ops.
   */
  groups: GroupNode[];
  /**
   * Unified back→front paint order for every scene object. Source of truth
   * for both rendering and hit-test. Members of the same group are
   * guaranteed contiguous.
   */
  sceneOrder: string[];
  /**
   * Composition snap grid level. Unbounded integer (may be negative or
   * exceed 6) — the composition's snap grid can be subdivided arbitrarily.
   * step = 2^gridLevel in L0 units. Distinct from layer-level `GridLevel`
   * unions used for figure / SVG / path resolutions, which remain discrete
   * `0..MAX_LAYER_LEVEL`.
   */
  gridLevel: number;
  strokeScale: number;
  gridIntensity: number;
  camera: Camera;
  viewport: Viewport;
  selectedFigureIds: Set<string>;
  activeFigureKey: string | null;
  compTool: CompToolType;
  createRegion: CreateRegion | null;
  renderGeneration: number;
  /**
   * Scene-graph node map (transform hierarchy refactor). Derived from the
   * legacy arrays (figures, svgObjects, images, groups) via syncNodeMap().
   * Consumers can read world coordinates from this via WorldTransformCache
   * instead of the legacy cellX/Y fields. Populated lazily — undefined
   * until first sync.
   */
  nodeMap?: Map<string, AnySceneNode>;
}

// ── Composition Undo Types ───────────────────────────────────────────

export type CompUndoOp =
  | { op: 'placeFigure'; figure: CompositionFigure }
  /**
   * Translate any selectable node by `(dx, dy)`. Apply: shift the node's
   * bbox and geometry by the delta; clear identity / rotation / mirror
   * state. Revert: shift by `(-dx, -dy)` and restore the identity /
   * rotation / mirror fields from the captured `old*`.
   */
  | { op: 'moveNode'; nodeId: string; dx: number; dy: number;
      // Figure-only: identity / cycle anchors that move clears.
      oldIdentityCellX?: number; oldIdentityCellY?: number; oldTransformCycleStep?: number;
      // SVG: identity-geometry and rotation / mirror cleared by move.
      oldIdentitySegments?: PathSegment[];
      oldRotation?: 0 | 90 | 180 | 270;
      oldMirrorH?: boolean;
      oldMirrorV?: boolean }
  | { op: 'rotateFigure'; figureId: string;
      oldRotation: 0 | 90 | 180 | 270; newRotation: 0 | 90 | 180 | 270;
      oldCellX: number; oldCellY: number; newCellX: number; newCellY: number;
      oldCellWidth: number; oldCellHeight: number; newCellWidth: number; newCellHeight: number;
      oldQuads?: FigureQuad[]; newQuads?: FigureQuad[];
      oldIdentityCellX?: number; oldIdentityCellY?: number; oldTransformCycleStep?: number;
      newIdentityCellX?: number; newIdentityCellY?: number }
  | { op: 'mirrorFigure'; figureId: string; axis: 'h' | 'v'; oldValue: boolean; newValue: boolean;
      oldQuads?: FigureQuad[]; newQuads?: FigureQuad[] }
  /** Generic place for any scene-object kind. Apply: append the item to
   *  the kind's array. When `sceneOrderIndex` is provided, the id is
   *  spliced into sceneOrder at that index (clamped); otherwise it's
   *  appended to the front of paint. Revert: filter it out. */
  | { op: 'placeObject'; kind: CompItemKind;
      item: CompositionFigure | SVGObject | ImageObject | TextObject | PaintObject | PatternObject;
      sceneOrderIndex?: number }
  /** Generic delete for any scene-object kind. Apply: filter the kind's
   *  array by id. `sceneOrderIndex` records the item's original position
   *  in sceneOrder so revert can splice it back at the same z-position.
   *  Revert: append the captured item back into the kind's array at the
   *  recorded sceneOrder index. */
  | { op: 'removeObject'; kind: CompItemKind;
      item: CompositionFigure | SVGObject | ImageObject | TextObject | PaintObject | PatternObject;
      sceneOrderIndex?: number }
  /** Generic lock toggle for any scene-object kind. Apply: set
   *  `item.locked = newValue` for the matching id in whichever array
   *  contains it (resolved via SCENE_ADAPTERS). Replaces per-kind
   *  `lockFigure` / `lockLine` / `lockArc`. */
  | { op: 'lockObject'; id: string; oldValue: boolean; newValue: boolean }
  /** Lock toggle for a GROUP (frame or plain group). Apply: set
   *  `group.locked = newValue` for the matching group id. The group's members
   *  are NOT touched — they inherit the lock via isItemLocked's ancestor walk,
   *  so unlocking the group restores each member's own lock state exactly. */
  | { op: 'lockGroup'; id: string; oldValue: boolean; newValue: boolean }
  /** Free (continuous) rotation of any bbox/svg scene-object kind, in
   *  degrees CW about the bbox center. Apply sets `item.angleDeg = newAngleDeg`
   *  for the matching id in whichever array contains it (resolved via
   *  SCENE_ADAPTERS); revert restores `oldAngleDeg`. Authored by the
   *  two-finger twist gesture. `undefined` clears free rotation. */
  | { op: 'setNodeRotation'; id: string; oldAngleDeg?: number; newAngleDeg?: number }
  /** Generic visibility toggle for any scene-object kind. Apply: set
   *  `item.hidden = newValue` for the matching id in whichever array
   *  contains it (resolved via SCENE_ADAPTERS). Replaces the prior
   *  image-only `setImageHidden`. */
  | { op: 'setObjectHidden'; id: string; oldValue: boolean; newValue: boolean }
  /** Visibility toggle for a GROUP (frame or plain group). Apply: set
   *  `group.hidden = newValue` for the matching group id. The group's members
   *  are NOT touched — they inherit the hide via isItemHidden's ancestor walk,
   *  so un-hiding the group restores each member's own visibility exactly.
   *  Mirror of `lockGroup`. */
  | { op: 'hideGroup'; id: string; oldValue: boolean; newValue: boolean }
  /** Generic z-order change for any number of scene-object kinds.
   *  `oldOrder` / `newOrder` map kind → id list. Apply uses newOrder,
   *  revert uses oldOrder. Adding a new CompItemKind extends the keys
   *  with no op-shape change. */
  | { op: 'reorderObjects'; oldOrder: string[]; newOrder: string[] }
  | { op: 'renameFigure'; figureId: string; oldName: string | undefined; newName: string | undefined }
  | { op: 'scaleFigure'; figureId: string;
      oldCellX: number; oldCellY: number; oldCellWidth: number; oldCellHeight: number;
      newCellX: number; newCellY: number; newCellWidth: number; newCellHeight: number;
      oldTileWidthL0?: number; oldTileHeightL0?: number;
      newTileWidthL0?: number; newTileHeightL0?: number;
      oldIdentityCellX?: number; oldIdentityCellY?: number; oldTransformCycleStep?: number }
  | { op: 'toggleRepeat'; figureId: string;
      oldTileMode: 'repeat' | undefined;
      oldTileWidthL0: number | undefined; oldTileHeightL0: number | undefined;
      oldCellX: number; oldCellY: number;
      oldCellWidth: number; oldCellHeight: number;
      newTileMode: 'repeat' | undefined;
      newTileWidthL0: number | undefined; newTileHeightL0: number | undefined;
      newCellX: number; newCellY: number;
      newCellWidth: number; newCellHeight: number }
  | { op: 'syncDimensions'; figureId: string;
      oldResolutionX: number; oldResolutionY: number;
      newResolutionX: number; newResolutionY: number;
      oldCellWidth?: number; oldCellHeight?: number;
      newCellWidth?: number; newCellHeight?: number }
  | { op: 'groupFigures'; figureIds: string[]; groupId: string; groupName: string; oldNames: (string | undefined)[]; childGroupIds?: string[]; isFrame?: boolean }
  | { op: 'ungroupFigures'; figureIds: string[]; groupId: string; groupName: string; childGroupIds?: string[];
      /** Saved transform so undo can restore the group at its pre-ungroup state
       *  instead of recreating it at identity. */
      savedTranslateX?: number; savedTranslateY?: number;
      savedScaleX?: number; savedScaleY?: number;
      savedRotation?: 0 | 90 | 180 | 270;
      savedMirrorH?: boolean; savedMirrorV?: boolean;
      savedParentGroupId?: string;
      /** Direct svg members that were masks before ungroup, so undo restores isMask. */
      maskedSvgIds?: string[];
      /** Whether the ungrouped group was a Figma-style frame, so undo restores
       *  the `isFrame` flag (the regroup path defaults to a plain group). */
      savedIsFrame?: boolean }
  /** Reparent a node (leaf or group) into `newParentGroupId` (undefined =
   *  top level) and set the new back→front `newSceneOrder`. Forward changes
   *  membership + reconciles the moved subtree's local coords from its
   *  (unchanged) world coords, so nothing jumps. Undo restores the exact prior
   *  records + `oldSceneOrder`. `prev*` snapshot every record the forward pass
   *  may touch (the moved node, and for a group its whole subtree). */
  | { op: 'reparentNode'; nodeId: string; newParentGroupId?: string;
      newSceneOrder: string[]; oldSceneOrder: string[];
      prevFigures?: CompositionFigure[]; prevSVGs?: SVGObject[];
      prevImages?: ImageObject[]; prevTexts?: TextObject[]; prevGroups?: GroupNode[];
      prevPaints?: PaintObject[]; prevPatterns?: PatternObject[] }
  | { op: 'renameGroup'; groupId: string; oldName: string; newName: string }
  /** Drop a GroupNode whose member set went empty. Emitted alongside
   *  removeObject ops by `buildRemoveObjectOps` so undo can restore the
   *  full GroupNode (transform, name, parent chain). Forward: filter the
   *  group out of state.groups. Revert: append it back. */
  | { op: 'removeGroup'; group: GroupNode }
  /**
   * Scene-graph group transform change (translate / scale / rotation /
   * mirror). Apply: set group's transform to `new*` and re-materialize
   * member world coords. Revert: set transform to `old*` and re-materialize.
   * Member `localCell*` are unchanged — the whole point of the hierarchy
   * is that locals are stable across group transforms.
   */
  | { op: 'transformGroup'; groupId: string;
      oldTranslateX: number; oldTranslateY: number;
      oldScaleX: number; oldScaleY: number;
      oldRotation: 0 | 90 | 180 | 270;
      oldMirrorH: boolean; oldMirrorV: boolean;
      newTranslateX: number; newTranslateY: number;
      newScaleX: number; newScaleY: number;
      newRotation: 0 | 90 | 180 | 270;
      newMirrorH: boolean; newMirrorV: boolean }
  | { op: 'cleanupLibrary'; removedFileIds: string[]; oldGroups: { id: string; name: string; fileIds: string[] }[] }
  // ── SVG ops ───────────────────────────────────────────────────────────
  | { op: 'createSVG'; svg: SVGObject }
  /** Edit tile cells of a PatternObject. Apply: for each edit, set
   *  `cells[index] = newState`. Revert: set `cells[index] = oldState`.
   *  One op carries a whole stroke (or a reconcile/clear sweep) so it
   *  round-trips as a single undo step. */
  | { op: 'editPatternCells'; patternId: string;
      edits: { index: number; oldState: CellState; newState: CellState }[] }
  /** Change a PatternObject's editing settings (symmetry mode and/or the
   *  border-connections rule). Full before/after snapshots of both fields;
   *  `undefined` symmetry = off, `undefined` allowBorderConnections = true. */
  | { op: 'setPatternSettings'; patternId: string;
      oldSymmetry: PatternSymmetry | undefined; newSymmetry: PatternSymmetry | undefined;
      oldAllowBorderConnections: boolean | undefined; newAllowBorderConnections: boolean | undefined }
  | { op: 'editSVGSegments'; svgId: string;
      oldSegments: PathSegment[]; newSegments: PathSegment[];
      /** null = clear localSegments; undefined = don't touch; array = set */
      oldLocalSegments?: PathSegment[] | null; newLocalSegments?: PathSegment[] | null;
      oldCreationBox?: { minX: number; minY: number; width: number; height: number };
      newCreationBox?: { minX: number; minY: number; width: number; height: number };
      /** H/V line orientation metadata, kept in step with the segment
       *  rewrite (a 90° rotation swaps horizontal ↔ vertical). `undefined`
       *  = don't touch — these ops never clear the field. */
      oldLineDirection?: 'horizontal' | 'vertical' | 'diagonal';
      newLineDirection?: 'horizontal' | 'vertical' | 'diagonal';
      /** Subpath set. `null` = clear subpaths (return to single-color path);
       *  `undefined` = don't touch; array = set. Captured by rotate/mirror so
       *  joined-SVG transforms round-trip through undo/redo. */
      oldSubpaths?: SVGSubpath[] | null; newSubpaths?: SVGSubpath[] | null;
      /** When set, overrides the AABB-from-segments bbox the reducer would
       *  otherwise compute. Used by tile-mode rotate/mirror where segments
       *  carry only one tile and the region bbox must be preserved. All
       *  four cell-bbox fields must be set together or none. */
      oldCellX?: number; oldCellY?: number; oldCellWidth?: number; oldCellHeight?: number;
      newCellX?: number; newCellY?: number; newCellWidth?: number; newCellHeight?: number;
      /** When `preserveOrientation` is true, the reducer applies these
       *  orientation / identity fields instead of clearing them. `undefined`
       *  is itself a meaningful value here (= reset to default), so the
       *  boolean flag is required to disambiguate "preserve as undefined"
       *  from "don't override the legacy clear". */
      preserveOrientation?: boolean;
      oldRotation?: 0 | 90 | 180 | 270; newRotation?: 0 | 90 | 180 | 270;
      oldMirrorH?: boolean; newMirrorH?: boolean;
      oldMirrorV?: boolean; newMirrorV?: boolean;
      oldIdentitySegments?: PathSegment[]; newIdentitySegments?: PathSegment[];
      oldIdentityCellX?: number; oldIdentityCellY?: number;
      newIdentityCellX?: number; newIdentityCellY?: number;
      /** Tile-grid metadata for `tileMode: 'repeat'` objects, kept in step
       *  with the segment rewrite (a 90° rotation swaps the tile W/H and
       *  remaps the offsets; a mirror reflects the offsets). `undefined` =
       *  don't touch — clearing the grid is `toggleRepeat`'s job. Offsets are
       *  carried as plain numbers; the reducer normalizes 0 back to the
       *  field's absent form. */
      oldTileWidthL0?: number; newTileWidthL0?: number;
      oldTileHeightL0?: number; newTileHeightL0?: number;
      oldTileOffsetXL0?: number; newTileOffsetXL0?: number;
      oldTileOffsetYL0?: number; newTileOffsetYL0?: number }
  | { op: 'renameSVG'; svgId: string; oldName: string | undefined; newName: string | undefined }
  /**
   * Recolor an SVGObject. Two shapes coexist:
   *  - Simple recolor (tap-and-confirm Color tool): only `newColor` is set;
   *    apply replaces `color` and clears `subpaths`. Revert restores
   *    `oldColor` + `oldSubpaths`.
   *  - Paint-stroke recolor: `newSegments` / `newSubpaths` (and
   *    `oldSegments` / `newLocalSegments` for group-member SVGs) are also
   *    present, so apply/revert restore the exact pre- and post-paint
   *    segment shape — drag-paint can move segments between main and
   *    subpaths as colors regroup.
   */
  | { op: 'recolorSVG'; svgId: string; oldColor: RGBColor; newColor: RGBColor;
      oldSubpaths?: SVGSubpath[];
      oldSegments?: PathSegment[];
      newSegments?: PathSegment[];
      newSubpaths?: SVGSubpath[];
      /** Group-member parity: when the SVG has a groupId, drag-paint must
       *  also rewrite localSegments AND localSubpaths in the same order so
       *  the next group transform pass doesn't snap the colors back. */
      oldLocalSegments?: PathSegment[];
      newLocalSegments?: PathSegment[];
      oldLocalSubpaths?: SVGSubpath[];
      newLocalSubpaths?: SVGSubpath[];
      oldFillColor?: RGBColor;
      newFillColor?: RGBColor }
  | { op: 'recolorFigure'; figureId: string; oldColor?: RGBColor; newColor?: RGBColor; oldBlendMode?: BlendMode; newBlendMode?: BlendMode }
  /** Sparse per-copy paint on a tiled SVG object. Each change records a packed
   *  `(col,row,segIdx)` key with its old/new override color; `undefined` color
   *  means "unset" (no override → base color). Undo entry size is O(touched
   *  copies·segments), independent of region size. See
   *  `engine/tileSegmentOverrides.ts`. */
  | { op: 'paintTileSegments'; svgId: string; changes: Array<{ key: number; oldColor?: RGBColor; newColor?: RGBColor }> }
  | { op: 'setFillColor'; svgId: string; oldFillColor?: RGBColor; newFillColor?: RGBColor;
      oldFillOpacity?: number; newFillOpacity?: number }
  | { op: 'setMaskMode'; svgId: string; oldValue?: boolean; newValue?: boolean }
  // ── Image ops ─────────────────────────────────────────────────────────
  | { op: 'editImage'; imageId: string;
      oldCellX: number; oldCellY: number;
      oldCellWidth: number; oldCellHeight: number;
      newCellX: number; newCellY: number;
      newCellWidth: number; newCellHeight: number;
      oldRotation?: 0 | 90 | 180 | 270; newRotation?: 0 | 90 | 180 | 270;
      oldMirrorH?: boolean; newMirrorH?: boolean;
      oldMirrorV?: boolean; newMirrorV?: boolean;
      oldOpacity?: number; newOpacity?: number;
      oldIdentityCellX?: number; oldIdentityCellY?: number;
      oldIdentityCellWidth?: number; oldIdentityCellHeight?: number;
      newIdentityCellX?: number; newIdentityCellY?: number;
      newIdentityCellWidth?: number; newIdentityCellHeight?: number;
      oldLocalCellX?: number; oldLocalCellY?: number;
      oldLocalCellWidth?: number; oldLocalCellHeight?: number;
      newLocalCellX?: number; newLocalCellY?: number;
      newLocalCellWidth?: number; newLocalCellHeight?: number }
  // ── Join ops ──────────────────────────────────────────────────────────
  /**
   * Merge of N selected SVGObjects (and optionally figures) into a single
   * SVGObject. Apply: remove every source from its array and insert
   * `result` into svgObjects. Revert: remove result and restore sources.
   */
  | { op: 'joinObjects';
      sourceSVGs: SVGObject[];
      sourceSVGIndices: number[];
      sourceFigures?: CompositionFigure[];
      sourceFigureIndices?: number[];
      result: SVGObject;
      resultInsertIndex: number;
      oldSceneOrder: string[] }
  | { op: 'unionObjects';
      sourceSVGs: SVGObject[];
      sourceSVGIndices: number[];
      result: SVGObject;
      resultInsertIndex: number;
      oldSceneOrder: string[] }
  | { op: 'mergeTile';
      addedFigures: CompositionFigure[];
      addedSVGs: SVGObject[];
      addedImages: ImageObject[];
      addedGroups: GroupNode[];
      addedSceneOrder: string[];
      oldSceneOrder: string[] }
  /**
   * Wholesale swap of the scene-content collections. Used when an interaction
   * accumulates arbitrary transient edits that can't be expressed as granular
   * ops — e.g. mask-setting mode, where the user may move / scale / rotate the
   * mask AND any number of other objects before confirming. Captures old/new
   * for every collection a transform or grouping can touch, so a single op
   * round-trips the entire interaction (revert→old, apply→new).
   */
  | { op: 'replaceScene';
      oldFigures: CompositionFigure[]; newFigures: CompositionFigure[];
      oldSVGObjects: SVGObject[]; newSVGObjects: SVGObject[];
      oldImages: ImageObject[]; newImages: ImageObject[];
      oldGroups: GroupNode[]; newGroups: GroupNode[];
      oldSceneOrder: string[]; newSceneOrder: string[];
      // Text collections (v29+); optional so pre-text entries replay.
      oldTexts?: TextObject[]; newTexts?: TextObject[];
      // Paint island collections (v52+); optional so older entries replay.
      oldPaints?: PaintObject[]; newPaints?: PaintObject[];
      // Pattern collections (v54+); optional on the same rule.
      oldPatterns?: PatternObject[]; newPatterns?: PatternObject[] }
  /**
   * Committed text-content change (v29+). The editor's hidden textarea
   * commits on blur/confirm; the engine never sees per-keystroke edits.
   * Content changes re-run layout, so the bbox old/new rides along.
   */
  | { op: 'setText'; textId: string; oldContent: string; newContent: string;
      oldCellWidth: number; oldCellHeight: number;
      newCellWidth: number; newCellHeight: number;
      // Auto-size re-measures anchor the box by align/vAlign, so the origin
      // can move too. Optional: absent (pre-anchor entries) leaves cellX/Y put.
      oldCellX?: number; oldCellY?: number;
      newCellX?: number; newCellY?: number }
  /** Committed text-style change (v29+). Swaps the whole style block;
   *  size-affecting changes carry the resulting bbox like `setText`. */
  | { op: 'setTextStyle'; textId: string; oldStyle: TextStyle; newStyle: TextStyle;
      oldCellWidth: number; oldCellHeight: number;
      newCellWidth: number; newCellHeight: number;
      oldCellX?: number; oldCellY?: number;
      newCellX?: number; newCellY?: number }
  /** Set/replace/clear a node's effects block (v29+). Resolved via
   *  SCENE_ADAPTERS like lockObject — any kind that carries `effects`. */
  | { op: 'setNodeEffects'; id: string; oldEffects?: NodeEffects; newEffects?: NodeEffects }
  /** Set/replace/clear an SVG object's gradient fill paint (v29+). */
  | { op: 'setFillPaint'; svgId: string; oldPaint?: Paint; newPaint?: Paint }
  /** Set/replace/clear an image's shader-time tint (v29+). */
  | { op: 'setImageTint'; nodeId: string; oldTint?: ImageTint; newTint?: ImageTint }
  /** Set/replace/clear the canvas background paint (v29+). */
  | { op: 'setBackground'; oldPaint?: Paint; newPaint?: Paint };

export type CompUndoEntry = CompUndoOp[];

// ── Scene-graph node types (transform hierarchy refactor) ───────────

import type { Transform2D, Bbox } from './transform2d';

/**
 * Discriminator for scene-graph node kinds. Extends CompItemKind with
 * 'group' for pure transform containers.
 */
export type SceneNodeKind = CompItemKind | 'group';

/**
 * Base interface for all scene-graph nodes. Every node has a local
 * transform and an optional parent pointer. World coordinates are
 * derived by composing the ancestor chain — never stored on the node.
 */
export interface SceneNodeBase {
  readonly id: string;
  readonly kind: SceneNodeKind;
  readonly name?: string;
  /** Parent group id. Undefined for root-level nodes. */
  readonly parentId?: string;
  readonly locked?: boolean;
  /** Local-to-parent transform. World = ancestorChain . transform. */
  readonly transform: Transform2D;
}

/**
 * A figure (pixel-art tile) scene node. Geometry is always in local
 * space — the transform positions/scales/rotates it in the parent's
 * coordinate system.
 */
export interface FigureNode extends SceneNodeBase {
  readonly kind: 'figure';
  readonly figureKey: string;
  readonly fileId?: string;
  readonly placementLevel?: GridLevel;
  readonly resolutionX: number;
  readonly resolutionY: number;
  /** Local-space bounding box (typically origin-based after conversion). */
  readonly localBbox: Bbox;
  readonly quads?: readonly FigureQuad[];
  readonly tileMode?: 'repeat';
  readonly tileWidthL0?: number;
  readonly tileHeightL0?: number;
  readonly tileOffsetXL0?: number;
  readonly tileOffsetYL0?: number;
}

/**
 * An SVG vector object (line, arc, or joined path). Segments are
 * always in local space. World segments are derived at render time
 * by transforming through the ancestor chain.
 */
export interface SVGNode extends SceneNodeBase {
  readonly kind: 'svg';
  readonly color: RGBColor;
  /** Segments in local space (the single source of truth). */
  readonly segments: readonly PathSegment[];
  readonly subpaths?: readonly SVGSubpath[];
  readonly lineDirection?: 'horizontal' | 'vertical' | 'diagonal';
  readonly creationBox?: { readonly minX: number; readonly minY: number; readonly width: number; readonly height: number };
  readonly tileMode?: 'repeat';
  readonly tileWidthL0?: number;
  readonly tileHeightL0?: number;
  readonly tileOffsetXL0?: number;
  readonly tileOffsetYL0?: number;
}

/**
 * A reference image scene node.
 */
export interface ImageNode extends SceneNodeBase {
  readonly kind: 'image';
  readonly imageId: string;
  readonly mimeType: 'image/png' | 'image/jpeg';
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  /** Local-space bounding box. */
  readonly localBbox: Bbox;
  readonly opacity?: number;
}

/**
 * A pure transform container (group). Has no geometry of its own —
 * just adds a transform node to the hierarchy. Children reference
 * this node via `parentId`.
 */
export interface GroupNode2 extends SceneNodeBase {
  readonly kind: 'group';
}

/** Union of all scene-graph node types. */
export type AnySceneNode = FigureNode | SVGNode | ImageNode | GroupNode2;
