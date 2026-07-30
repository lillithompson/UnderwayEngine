import type { ImageFraming } from './imageFraming';
export type { ImageFraming, ImageFramingMode, ImageCropRatio } from './imageFraming';

/** Pixel resolution of every layer texture */
export const LAYER_PX = 2048;

/** Discriminator for scene-object kinds. Lives in types.ts so the undo
 *  op union can reference it without creating an import cycle with
 *  compositionOps.ts (which is where the per-kind adapters live). */
export type CompItemKind = 'figure' | 'svg' | 'image' | 'text';

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

export type SelectionMode = 'rect' | 'path';

export type ToolType = 'random' | 'erase' | 'sprite' | 'color' | 'select' | 'pattern' | 'draw' | 'clone';

export type SelectionSubTool = 'move' | 'zoom' | 'rotate' | 'mirrorH' | 'mirrorV';

export interface Selection {
  startCellX: number;
  startCellY: number;
  endCellX: number;
  endCellY: number;
  level: GridLevel;
}

export interface MovePreview {
  deltaCellX: number;
  deltaCellY: number;
}

export interface RotatePreview {
  rotation: 0 | 90 | 180 | 270;
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

export interface Tool {
  type: ToolType;
  /** For color tool: index into COLOR_PALETTE */
  colorIndex?: number;
  /** For sprite tool: which sprite to stamp */
  spriteId?: string;
  /** For sprite tool: rotation in degrees */
  rotation?: 0 | 90 | 180 | 270;
  /** For sprite tool: horizontal mirror */
  mirrorH?: boolean;
  /** For sprite tool: vertical mirror */
  mirrorV?: boolean;
  /** Custom RGB from color picker (overrides colorIndex when present) */
  customColorR?: number;
  customColorG?: number;
  customColorB?: number;
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

export interface PatternEntry {
  level: GridLevel;
  pxOffX: number;
  pxOffY: number;
  state: CellState; // non-null
}

export interface Pattern {
  id: string;
  name: string;
  coarsestLevel: GridLevel;
  pxWidth: number;
  pxHeight: number;
  entries: PatternEntry[];
  thumbnail?: string;
}

export interface EditorState {
  fileConfig: FileConfig;
  layers: Layer[];
  activeLayerId: string;
  tool: Tool;
  /** The active drawing tool, preserved across select/pattern mode switches */
  drawTool: Tool;
  camera: Camera;
  viewport: Viewport;
  /** Incremented on every state change to trigger re-render */
  renderGeneration: number;
  /** Incremented only when sprite atlases upgrade — used for thumbnail cache invalidation */
  atlasGeneration: number;
  /** Cell edits produced by the last APPLY_TOOL action */
  lastCellEdits: CellEdit[];
  /** Mirror drawing: horizontal axis (left/right) */
  mirrorH: boolean;
  /** Mirror drawing: vertical axis (top/bottom) */
  mirrorV: boolean;
  /** Rotate drawing: 4-fold rotational symmetry (each quadrant rotated 90°) */
  mirrorRotate: boolean;
  /** Quad symmetry: 4 internally-symmetric quadrants reflected to each other */
  mirrorQuad: boolean;
  /** Row symmetry: 4 quadrants, each with V-axis mirror only, reflected to all quadrants */
  mirrorRow: boolean;
  /** Column symmetry: 4 quadrants, each with H-axis mirror only, reflected to all quadrants */
  mirrorCol: boolean;
  /** Diagonal symmetry: main diagonal (top-left to bottom-right) */
  mirrorDiag1: boolean;
  /** Diagonal symmetry: anti-diagonal (top-right to bottom-left) */
  mirrorDiag2: boolean;
  /** Diagonal symmetry: both diagonals */
  mirrorDiagBoth: boolean;
  /** Star symmetry: 8-fold D4 (H + V + both diagonals + rotations) */
  mirrorStar: boolean;
  /** Current region selection */
  selection: Selection | null;
  /** Active sub-tool for selection mode */
  selectionSubTool: SelectionSubTool | null;
  /** Preview offset for move operation */
  movePreview: MovePreview | null;
  /** Preview for rotate operation */
  rotatePreview: RotatePreview | null;
  /** When true, selection ops affect active layer + finer layers; when false, only active layer */
  deepEdit: boolean;
  /** When true, selection move/rotate preserve source cells and write to destinations (copy instead of move) */
  copySelection: boolean;
  /** When true, selecting a layer automatically sets it as the highlighted layer */
  autoHighlight: boolean;
  /** Saved patterns */
  patterns: Pattern[];
  /** Currently selected pattern for painting */
  activePatternId: string | null;
  /** Rotation applied when painting with active pattern */
  activePatternRotation: 0 | 90 | 180 | 270;
  /** Origin cell for pattern tiling alignment */
  patternOrigin: { cellX: number; cellY: number } | null;
  /** Whether border/empty cells allow connections (true = unconstrained, false = forced 00000000) */
  allowBorderConnections: boolean;
  /** When true, random flood fill distributes across multiple resolution layers */
  multiresFill: boolean;
  /** Tile families excluded from random tool selection */
  excludedFamilies: Set<string>;
  /** Clone tool: visible-grid index of the source cell */
  cloneSourceIndex: number | null;
  /** Clone tool: visible-grid index of the currently sampled cell */
  cloneSampleIndex: number | null;
  /** Clone tool: visible-grid index of the anchor point */
  cloneAnchorIndex: number | null;
  /** Clone tool: visible-grid index of the paint cursor */
  cloneCursorIndex: number | null;
  /** Which selection sub-mode is active: rect (default) or path */
  selectionMode: SelectionMode;
  /** Flat cell indices (y * cellCount + x) at pathLevel for path selection */
  pathIndices: Set<number>;
  /** Resolution at which path indices are stored */
  pathLevel: GridLevel;
  /** Bumped when pathIndices changes, to avoid re-uploading GPU texture every frame */
  pathGeneration: number;
  /** Cached L0 expansion of pathIndices for GPU overlay */
  pathL0Indices: Set<number> | null;
  /** Whether a canvas resize drag is in progress */
  resizingCanvas: boolean;
  /** Active color RGB — applied as default tint when placing sprites */
  activeColorR: number;
  activeColorG: number;
  activeColorB: number;
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

export type CellEdit = {
  layerId: string;
  cellX: number;
  cellY: number;
  oldState: CellState;
  newState: CellState;
};

export type LayerSnapshot = {
  id: string;
  name: string;
  level: GridLevel;
  visible: boolean;
  opacity: number;
  order: number;
  shiftX: 0 | 0.5;
  shiftY: 0 | 0.5;
  locked: boolean;
  cells: (CellState | null)[][];
  edgeRowTop: (CellState | null)[] | null;
  edgeColLeft: (CellState | null)[] | null;
  edgeCorner: CellState | null;
};

export type UndoOp =
  | { op: 'cell'; layerId: string; cellX: number; cellY: number; oldState: CellState; newState: CellState }
  | { op: 'addLayer'; layer: LayerSnapshot }
  | { op: 'removeLayer'; layer: LayerSnapshot; index: number }
  | { op: 'renameLayer'; layerId: string; oldName: string; newName: string }
  | { op: 'reorderLayer'; layerId: string; oldOrder: number; newOrder: number }
  | { op: 'toggleVisibility'; layerId: string; oldVisible: boolean }
  | { op: 'setActiveLayer'; oldActiveId: string; newActiveId: string }
  | { op: 'renameFile'; oldName: string; newName: string }
  | { op: 'clearAll'; layerSnapshots: LayerSnapshot[] }
  | { op: 'setShift'; layerId: string; oldShiftX: 0|0.5; oldShiftY: 0|0.5; newShiftX: 0|0.5; newShiftY: 0|0.5 }
  | { op: 'toggleLock'; layerId: string; oldLocked: boolean }
  | { op: 'clearLayer'; layerId: string; layerSnapshot: LayerSnapshot }
  | { op: 'shrinkwrap'; oldWidthL0: number; oldHeightL0: number; newWidthL0: number; newHeightL0: number; oldOriginL0X: number; oldOriginL0Y: number; newOriginL0X: number; newOriginL0Y: number; layerCellsBefore: { layerId: string; cells: (CellState | null)[][] }[]; layerShiftsBefore?: { layerId: string; shiftX: 0 | 0.5; shiftY: 0 | 0.5 }[] }
  | { op: 'resizeCanvas'; oldWidthL0: number; oldHeightL0: number; newWidthL0: number; newHeightL0: number; oldOriginL0X: number; oldOriginL0Y: number; newOriginL0X: number; newOriginL0Y: number; layerCellsBefore?: { layerId: string; cells: (CellState | null)[][] }[]; shiftL0X?: number; shiftL0Y?: number }
  | { op: 'upscale'; oldWidthL0: number; oldHeightL0: number; newWidthL0: number; newHeightL0: number; oldOriginL0X: number; oldOriginL0Y: number; newOriginL0X: number; newOriginL0Y: number; oldClipBox: ClipBox | null; newClipBox: ClipBox | null; shiftL0X: number; shiftL0Y: number; layerSnapshotsBefore: LayerSnapshot[]; activeLayerIdBefore: string }
  | { op: 'setClipBox'; oldClipBox: ClipBox | null; newClipBox: ClipBox | null };

export type UndoEntry = UndoOp[];

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
}

export interface SVGObject {
  id: string;
  name?: string;
  /** Geometric shape kind at creation time. Persists through duplication
   *  and renaming so scaling/selection behavior stays correct. */
  shapeKind?: 'rectangle';
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
  /** Cached-texture effects: drop shadow, glow, border (v29+). Rendered
   *  as pre-blurred texture passes, never live SVG filters at runtime;
   *  SVG export emits real `<filter>` defs. */
  effects?: NodeEffects;
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
   *  duplicates so cloning an image doesn't double the bytes. */
  imageId: string;
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
  /** Shader-time recolor (v29+): applied at draw time from the original
   *  bitmap — zero extra memory, no re-encode. Export bakes the tint
   *  when rasterizing and emits `feColorMatrix` in SVG. */
  tint?: ImageTint;
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
  dash?: number }

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

export type TextAlign = 'left' | 'center' | 'right';

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
  bold?: boolean;
  italic?: boolean;
  color: RGBColor;
  /** Extra letter spacing in em units. */
  letterSpacing?: number;
  /** Line height as a multiple of size (default 1.2). */
  lineHeight?: number;
  align?: TextAlign;
  /** Optional outline stroke drawn behind the fill. */
  stroke?: TextStroke;
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
   * duplicated). Populated on import and on .tile load. Persisted
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
  | { op: 'placeObject'; kind: CompItemKind; item: CompositionFigure | SVGObject | ImageObject | TextObject;
      sceneOrderIndex?: number }
  /** Generic delete for any scene-object kind. Apply: filter the kind's
   *  array by id. `sceneOrderIndex` records the item's original position
   *  in sceneOrder so revert can splice it back at the same z-position.
   *  Revert: append the captured item back into the kind's array at the
   *  recorded sceneOrder index. */
  | { op: 'removeObject'; kind: CompItemKind; item: CompositionFigure | SVGObject | ImageObject | TextObject;
      sceneOrderIndex?: number }
  /** Generic lock toggle for any scene-object kind. Apply: set
   *  `item.locked = newValue` for the matching id in whichever array
   *  contains it (resolved via SCENE_ADAPTERS). Replaces per-kind
   *  `lockFigure` / `lockLine` / `lockArc`. */
  | { op: 'lockObject'; id: string; oldValue: boolean; newValue: boolean }
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
      maskedSvgIds?: string[] }
  /** Reparent a node (leaf or group) into `newParentGroupId` (undefined =
   *  top level) and set the new back→front `newSceneOrder`. Forward changes
   *  membership + reconciles the moved subtree's local coords from its
   *  (unchanged) world coords, so nothing jumps. Undo restores the exact prior
   *  records + `oldSceneOrder`. `prev*` snapshot every record the forward pass
   *  may touch (the moved node, and for a group its whole subtree). */
  | { op: 'reparentNode'; nodeId: string; newParentGroupId?: string;
      newSceneOrder: string[]; oldSceneOrder: string[];
      prevFigures?: CompositionFigure[]; prevSVGs?: SVGObject[];
      prevImages?: ImageObject[]; prevTexts?: TextObject[]; prevGroups?: GroupNode[] }
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
  | { op: 'editSVGSegments'; svgId: string;
      oldSegments: PathSegment[]; newSegments: PathSegment[];
      /** null = clear localSegments; undefined = don't touch; array = set */
      oldLocalSegments?: PathSegment[] | null; newLocalSegments?: PathSegment[] | null;
      oldCreationBox?: { minX: number; minY: number; width: number; height: number };
      newCreationBox?: { minX: number; minY: number; width: number; height: number };
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
      newIdentityCellX?: number; newIdentityCellY?: number }
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
      oldTexts?: TextObject[]; newTexts?: TextObject[] }
  /**
   * Committed text-content change (v29+). The editor's hidden textarea
   * commits on blur/confirm; the engine never sees per-keystroke edits.
   * Content changes re-run layout, so the bbox old/new rides along.
   */
  | { op: 'setText'; textId: string; oldContent: string; newContent: string;
      oldCellWidth: number; oldCellHeight: number;
      newCellWidth: number; newCellHeight: number }
  /** Committed text-style change (v29+). Swaps the whole style block;
   *  size-affecting changes carry the resulting bbox like `setText`. */
  | { op: 'setTextStyle'; textId: string; oldStyle: TextStyle; newStyle: TextStyle;
      oldCellWidth: number; oldCellHeight: number;
      newCellWidth: number; newCellHeight: number }
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
