import storage from './storage';
import { Layer, CellState, CellTransform, GridLevel, LAYER_PX, Pattern, CompositionEntry, CompositionState, CompositionFigure, Camera, FileConfig, CanvasPaintIsland, ClipBox, GroupNode, SVGObject, SVGSubpath, ImageObject, ImagePaintOverlay, BlendMode, PaintObject, PathSegment, RGBColor, SVGDesignTemplate, TextObject, Paint, makeViewport, initDirtyRects, markFullDirty, hideHeavyLayerFields } from './types';
import { normalizeCanvasPaintIslands, paintTilesContentRect } from './canvasPaint';
import { mintPaintObjectId } from './paintObject';
import { createCellGrid, rebuildPixelData } from './cells';
import { bakeFile } from './bake';
import { exportToSVG } from './svgExport';
import { serializeFile, deserializeFile, evictCacheForFile } from './binaryFormat';
import { logToNative } from '@/native-shell/bridge/webBridge';
import { deriveSceneOrderFromKindArrays, repairSceneOrder } from './compositionOps';
import { normalizeStrokeScale } from './strokeScale';
import { normalizeComposition } from './compositionNormalize';
import { fromBase64, toBase64 } from './pngcodec';

// ── Storage Keys ────────────────────────────────────────────────────

function metaKey(fileId: string): string {
  return `file_meta_${fileId}`;
}

// ── Layer Metadata (JSON-safe) ──────────────────────────────────────

export interface LayerMeta {
  id: string;
  name: string;
  level: GridLevel;
  visible: boolean;
  opacity: number;
  order: number;
  shiftX?: 0 | 0.5;
  shiftY?: 0 | 0.5;
  locked?: boolean;
  cells: (CellState | null)[][];
  cellsGeneration?: number;
  edgeRowTop?: (CellState | null)[] | null;
  edgeColLeft?: (CellState | null)[] | null;
  edgeCorner?: CellState | null;
}

export interface FileMeta {
  activeLayerId: string;
  layers: LayerMeta[];
  widthL0?: number;
  heightL0?: number;
  originL0X?: number;
  originL0Y?: number;
  clipBox?: ClipBox;
}

// ── Save ────────────────────────────────────────────────────────────

export async function saveFileState(
  fileId: string,
  layers: Layer[],
  activeLayerId: string,
  widthL0?: number,
  heightL0?: number,
  originL0X: number = 0,
  originL0Y: number = 0,
  clipBox?: ClipBox | null,
): Promise<void> {
  const layerMetas: LayerMeta[] = layers.map((l) => ({
    id: l.id,
    name: l.name,
    level: l.level,
    visible: l.visible,
    opacity: l.opacity,
    order: l.order,
    shiftX: l.shiftX,
    shiftY: l.shiftY,
    locked: l.locked,
    cells: l.cells,
    cellsGeneration: l.cellsGeneration,
    edgeRowTop: l.edgeRowTop,
    edgeColLeft: l.edgeColLeft,
    edgeCorner: l.edgeCorner,
  }));

  const bytes = serializeFile(layerMetas, activeLayerId, widthL0 ?? 32, heightL0 ?? 32, fileId, originL0X, originL0Y, clipBox);
  await storage.setBinary(metaKey(fileId), bytes);
}

// ── Layer Reconstruction ─────────────────────────────────────────────

/** Shared 0-byte buffer reused by metaToLayersLite to avoid per-layer allocations. */
const EMPTY_U8 = new Uint8Array(0);
const EMPTY_U32 = new Uint32Array(0);

export function metaToLayers(meta: FileMeta): Layer[] {
  const layers: Layer[] = [];
  for (const lm of meta.layers) {
    const data = new Uint8Array(LAYER_PX * LAYER_PX * 4);
    const layer: Layer = hideHeavyLayerFields({
      id: lm.id,
      name: lm.name,
      level: lm.level,
      visible: lm.visible,
      opacity: lm.opacity,
      order: lm.order,
      shiftX: (lm.shiftX ?? 0) as 0 | 0.5,
      shiftY: (lm.shiftY ?? 0) as 0 | 0.5,
      locked: lm.locked ?? false,
      data,
      dataU32: new Uint32Array(data.buffer),
      dirtyRects: initDirtyRects(),
      dirtyRectCount: 0,
      cells: lm.cells ?? createCellGrid(lm.level),
      cellsGeneration: 0,
      edgeRowTop: lm.edgeRowTop ?? null,
      edgeColLeft: lm.edgeColLeft ?? null,
      edgeCorner: lm.edgeCorner ?? null,
    });
    rebuildPixelData(layer);
    markFullDirty(layer);
    layers.push(layer);
  }
  return layers;
}

/**
 * Lightweight layer reconstruction that skips 16 MB pixel buffer allocation
 * and rebuildPixelData. Suitable for SVG export which only reads cell data.
 */
function metaToLayersLite(meta: FileMeta): Layer[] {
  const layers: Layer[] = [];
  for (const lm of meta.layers) {
    const layer: Layer = hideHeavyLayerFields({
      id: lm.id,
      name: lm.name,
      level: lm.level,
      visible: lm.visible,
      opacity: lm.opacity,
      order: lm.order,
      shiftX: (lm.shiftX ?? 0) as 0 | 0.5,
      shiftY: (lm.shiftY ?? 0) as 0 | 0.5,
      locked: lm.locked ?? false,
      data: EMPTY_U8,
      dataU32: EMPTY_U32,
      dirtyRects: initDirtyRects(),
      dirtyRectCount: 0,
      cells: lm.cells ?? createCellGrid(lm.level),
      cellsGeneration: 0,
      edgeRowTop: lm.edgeRowTop ?? null,
      edgeColLeft: lm.edgeColLeft ?? null,
      edgeCorner: lm.edgeCorner ?? null,
    });
    layers.push(layer);
  }
  return layers;
}

// ── Load ────────────────────────────────────────────────────────────

export async function loadFileState(
  fileId: string,
): Promise<{ layers: Layer[]; activeLayerId: string; widthL0: number; heightL0: number; originL0X: number; originL0Y: number } | null> {
  const bytes = await storage.getBinary(metaKey(fileId));
  if (!bytes) return null;

  const fileMeta = deserializeFile(bytes);
  evictCacheForFile(fileId);
  const layers = metaToLayers(fileMeta);

  return {
    layers,
    activeLayerId: fileMeta.activeLayerId,
    widthL0: fileMeta.widthL0 ?? 32,
    heightL0: fileMeta.heightL0 ?? 32,
    originL0X: fileMeta.originL0X ?? 0,
    originL0Y: fileMeta.originL0Y ?? 0,
  };
}

/**
 * Lightweight variant of loadFileState that skips pixel buffer allocation.
 * Returns layers with cell data but empty pixel buffers — suitable for
 * SVG export and other paths that only read layer.cells.
 */
export async function loadFileStateLite(
  fileId: string,
): Promise<{ layers: Layer[]; activeLayerId: string; widthL0: number; heightL0: number; originL0X: number; originL0Y: number } | null> {
  const bytes = await storage.getBinary(metaKey(fileId));
  if (!bytes) return null;

  const fileMeta = deserializeFile(bytes);
  const layers = metaToLayersLite(fileMeta);

  return {
    layers,
    activeLayerId: fileMeta.activeLayerId,
    widthL0: fileMeta.widthL0 ?? 32,
    heightL0: fileMeta.heightL0 ?? 32,
    originL0X: fileMeta.originL0X ?? 0,
    originL0Y: fileMeta.originL0Y ?? 0,
  };
}

// ── Clip Box ────────────────────────────────────────────────────────

function clipBoxKey(fileId: string): string {
  return `clip_box_${fileId}`;
}

export async function saveClipBox(fileId: string, clipBox: ClipBox | null): Promise<void> {
  if (clipBox) {
    await storage.setItem(clipBoxKey(fileId), JSON.stringify(clipBox));
  } else {
    await storage.removeItem(clipBoxKey(fileId));
  }
}

export async function loadClipBox(fileId: string): Promise<ClipBox | null> {
  const raw = await storage.getItem(clipBoxKey(fileId));
  if (!raw) return null;
  return JSON.parse(raw);
}

// ── Global Patterns ─────────────────────────────────────────────────

const PATTERNS_KEY = 'app_patterns';

export async function saveGlobalPatterns(patterns: Pattern[]): Promise<void> {
  await storage.setItem(PATTERNS_KEY, JSON.stringify(patterns));
}

export async function loadGlobalPatterns(): Promise<Pattern[]> {
  const raw = await storage.getItem(PATTERNS_KEY);
  if (!raw) return [];
  return JSON.parse(raw);
}

// ── Excluded Families (App-Level) ────────────────────────────────────

const EXCLUDED_FAMILIES_KEY = 'app_excluded_families';

export async function saveExcludedFamilies(excluded: Set<string>): Promise<void> {
  await storage.setItem(EXCLUDED_FAMILIES_KEY, JSON.stringify(Array.from(excluded)));
}

export async function loadExcludedFamilies(): Promise<Set<string> | null> {
  const raw = await storage.getItem(EXCLUDED_FAMILIES_KEY);
  if (!raw) return null;
  return new Set(JSON.parse(raw));
}

// ── Allow Border Connections (App-Level) ─────────────────────────────

const ALLOW_BORDER_KEY = 'app_allow_border_connections';

export async function saveAllowBorderConnections(value: boolean): Promise<void> {
  await storage.setItem(ALLOW_BORDER_KEY, JSON.stringify(value));
}

export async function loadAllowBorderConnections(): Promise<boolean | null> {
  const raw = await storage.getItem(ALLOW_BORDER_KEY);
  if (raw == null) return null;
  return JSON.parse(raw);
}

// ── Multires Fill ────────────────────────────────────────────────────

const MULTIRES_FILL_KEY = 'app_multires_fill';

export async function saveMultiresFill(value: boolean): Promise<void> {
  await storage.setItem(MULTIRES_FILL_KEY, JSON.stringify(value));
}

export async function loadMultiresFill(): Promise<boolean | null> {
  const raw = await storage.getItem(MULTIRES_FILL_KEY);
  if (raw == null) return null;
  return JSON.parse(raw);
}

// ── Deep Edit ───────────────────────────────────────────────────────

const DEEP_EDIT_KEY = 'app_deep_edit';

export async function saveDeepEdit(value: boolean): Promise<void> {
  await storage.setItem(DEEP_EDIT_KEY, JSON.stringify(value));
}

export async function loadDeepEdit(): Promise<boolean | null> {
  const raw = await storage.getItem(DEEP_EDIT_KEY);
  if (raw == null) return null;
  return JSON.parse(raw);
}

// ── Copy Selection ──────────────────────────────────────────────────

const COPY_SELECTION_KEY = 'app_copy_selection';

export async function saveCopySelection(value: boolean): Promise<void> {
  await storage.setItem(COPY_SELECTION_KEY, JSON.stringify(value));
}

export async function loadCopySelection(): Promise<boolean | null> {
  const raw = await storage.getItem(COPY_SELECTION_KEY);
  if (raw == null) return null;
  return JSON.parse(raw);
}

// ── Auto Highlight ──────────────────────────────────────────────────

const AUTO_HIGHLIGHT_KEY = 'app_auto_highlight';

export async function saveAutoHighlight(value: boolean): Promise<void> {
  await storage.setItem(AUTO_HIGHLIGHT_KEY, JSON.stringify(value));
}

export async function loadAutoHighlight(): Promise<boolean | null> {
  const raw = await storage.getItem(AUTO_HIGHLIGHT_KEY);
  if (raw == null) return null;
  return JSON.parse(raw);
}

// ── Expand Figures on Recolor ───────────────────────────────────────

const EXPAND_FIGURES_ON_RECOLOR_KEY = 'app_expand_figures_on_recolor';

export async function saveExpandFiguresOnRecolor(value: boolean): Promise<void> {
  await storage.setItem(EXPAND_FIGURES_ON_RECOLOR_KEY, JSON.stringify(value));
}

export async function loadExpandFiguresOnRecolor(): Promise<boolean | null> {
  const raw = await storage.getItem(EXPAND_FIGURES_ON_RECOLOR_KEY);
  if (raw == null) return null;
  return JSON.parse(raw);
}


// ── Mirror Settings (App-Level) ──────────────────────────────────────

const MIRROR_KEY = 'app_mirror_settings';

export interface MirrorSettings {
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

export async function saveMirrorSettings(settings: MirrorSettings): Promise<void> {
  await storage.setItem(MIRROR_KEY, JSON.stringify(settings));
}

export async function loadMirrorSettings(): Promise<MirrorSettings | null> {
  const raw = await storage.getItem(MIRROR_KEY);
  if (raw == null) return null;
  return JSON.parse(raw);
}

// ── Compositions ─────────────────────────────────────────────────────

const COMPOSITIONS_KEY = 'compositions';

function compMetaKey(id: string): string {
  return `comp_meta_${id}`;
}

function compThumbKey(id: string): string {
  return `comp_thumb_${id}`;
}

export async function saveCompositionList(entries: CompositionEntry[]): Promise<void> {
  await storage.setItem(COMPOSITIONS_KEY, JSON.stringify(entries));
}

export async function loadCompositionList(): Promise<CompositionEntry[]> {
  const raw = await storage.getItem(COMPOSITIONS_KEY);
  if (!raw) return [];
  return JSON.parse(raw);
}

// Eagerly prefetch the composition list so it's ready before the screen mounts
let _prefetchedList: Promise<CompositionEntry[]> | null = null;

export function prefetchCompositionList(): void {
  if (!_prefetchedList) {
    _prefetchedList = loadCompositionList();
  }
}

export function getPrefetchedCompositionList(): Promise<CompositionEntry[]> {
  if (_prefetchedList) {
    const p = _prefetchedList;
    _prefetchedList = null;
    return p;
  }
  return loadCompositionList();
}

interface CompMeta {
  name: string;
  figures: CompositionFigure[];
  groups?: GroupNode[];
  /** SVG scene nodes (lines, arcs, and joined paths). */
  svgObjects?: SVGObject[];
  /** Reference-image scene nodes; absent on compositions saved before
   *  images existed. Pixel bytes are stored separately by `imageId` in
   *  binary keys (see `imgBlobKey`) so the JSON stays small and a
   *  duplicate node doesn't multiply storage. */
  images?: ImageObject[];
  /** Text scene nodes (v29+); absent on compositions saved before text
   *  existed. JSON-safe as-is (no Maps / binary payloads). */
  texts?: TextObject[];
  /** Canvas background paint (v29+); absent = renderer default. */
  background?: Paint;
  /** Paint island scene nodes (v52+): each object's SCALAR fields only —
   *  the tile bytes live in their own binary key per object (see
   *  `pntBlobKey`), so the debounced autosave never re-stringifies
   *  megabytes of raster into this JSON. Older saves' retired global
   *  `canvasPaint` layer is deliberately ignored on load (breaking
   *  change: the layer model was replaced by these scene objects). */
  paintObjects?: unknown[];
  /** Unified back→front paint order across every scene-object kind.
   *  Absent on older saves; the loader derives it from the kind arrays in
   *  the legacy fixed paint order. */
  sceneOrder?: string[];
  /** Last RGB color picked in the figure editor / line color picker. */
  lastChosenColor?: RGBColor;
  /** Custom colors saved with this composition; populated as the user picks
   *  non-default colors via the composer's color tool. Absent on older saves. */
  customColors?: RGBColor[];
  camera: Camera;
  /** Composition snap grid level — unbounded integer. */
  gridLevel?: number;
  strokeScale?: number;
  gridIntensity?: number;
}

/** Storage key for an image's raw bytes. Keyed by `imageId` only (not
 *  by composition id) so duplicates and cross-composition uses share
 *  the same blob. NOTE: nothing deletes these — deleteCompositionData
 *  removes only comp_meta_/comp_thumb_ keys, so orphaned image blobs
 *  accumulate until a janitor pass exists. */
function imgBlobKey(imageId: string): string {
  return `imgblob_${imageId}`;
}

/** Storage key for a paint island's packed tile bytes. Keyed by the paint
 *  object's own id — unlike image blobs the bytes are MUTABLE (every stroke
 *  swaps the tile array), so they are never shared across objects and a
 *  duplicate must copy under a fresh id. Same janitor caveat as imgblob_:
 *  deleteCompositionData does not remove these. */
function pntBlobKey(paintId: string): string {
  return `pntblob_${paintId}`;
}

// ── Paint tile pack (binary form of PaintObject.tiles) ─────────────
//
// Little-endian: u8 version(1), u16 tileCount, then per tile
// f32 x, f32 y, f32 widthCells, u16 cols, u16 rows, cols×rows×4 rgba.
// Tile blend is not stored: island tiles are always 'normal' (brush blend
// modes bake destructively at stamp time — see canvasPaint.ts).

const PAINT_TILE_PACK_VERSION = 1;

function packPaintTiles(tiles: readonly CanvasPaintIsland[]): Uint8Array {
  let size = 1 + 2;
  for (const t of tiles) size += 4 * 3 + 2 + 2 + t.overlay.rgba.length;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let pos = 0;
  view.setUint8(pos, PAINT_TILE_PACK_VERSION); pos += 1;
  view.setUint16(pos, tiles.length, true); pos += 2;
  for (const t of tiles) {
    view.setFloat32(pos, t.x, true); pos += 4;
    view.setFloat32(pos, t.y, true); pos += 4;
    view.setFloat32(pos, t.widthCells, true); pos += 4;
    view.setUint16(pos, t.overlay.cols, true); pos += 2;
    view.setUint16(pos, t.overlay.rows, true); pos += 2;
    out.set(t.overlay.rgba, pos); pos += t.overlay.rgba.length;
  }
  return out;
}

function unpackPaintTiles(bytes: Uint8Array): CanvasPaintIsland[] | undefined {
  if (bytes.length < 3) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;
  const version = view.getUint8(pos); pos += 1;
  if (version !== PAINT_TILE_PACK_VERSION) return undefined;
  const count = view.getUint16(pos, true); pos += 2;
  const tiles: CanvasPaintIsland[] = [];
  for (let i = 0; i < count; i++) {
    if (pos + 16 > bytes.length) return undefined;
    const x = view.getFloat32(pos, true); pos += 4;
    const y = view.getFloat32(pos, true); pos += 4;
    const widthCells = view.getFloat32(pos, true); pos += 4;
    const cols = view.getUint16(pos, true); pos += 2;
    const rows = view.getUint16(pos, true); pos += 2;
    const len = cols * rows * 4;
    if (cols <= 0 || rows <= 0 || pos + len > bytes.length) return undefined;
    tiles.push({
      x, y, widthCells,
      overlay: { cols, rows, rgba: bytes.slice(pos, pos + len), blend: 'normal' },
    });
    pos += len;
  }
  return tiles;
}

// Skip-if-unchanged cache for paint blob writes: paintId → the tiles array
// reference last written. Commits swap the array (tiles are
// immutable-by-convention), so reference equality is exactly "bytes
// unchanged" — the debounced autosave then skips untouched islands.
// globalThis-hosted for the same chunk-duplication reason as the meta cache.
function _getPaintBlobCache(): Map<string, readonly CanvasPaintIsland[]> {
  const w = globalThis as any;
  if (!w.__facetPaintBlobCache) w.__facetPaintBlobCache = new Map<string, readonly CanvasPaintIsland[]>();
  return w.__facetPaintBlobCache;
}

/** A paint object's JSON-safe meta form: scalar fields only, tiles omitted
 *  (they go to the object's own binary key). */
function serializePaintForMeta(p: PaintObject): unknown {
  const { tiles: _tiles, ...scalar } = p;
  return scalar;
}

/** Revive one paint object's scalar fields from meta. Tiles are hydrated
 *  separately (loadCompositionState); anything structurally unusable →
 *  undefined so the object is dropped rather than poisoning the scene. */
function migratePaintObjectMeta(v: any): Omit<PaintObject, 'tiles'> | undefined {
  if (!v || typeof v !== 'object') return undefined;
  if (typeof v.id !== 'string' || !v.id.startsWith('pnt_')) return undefined;
  const nums = [v.cellX, v.cellY, v.cellWidth, v.cellHeight];
  if (!nums.every((n: any) => Number.isFinite(n))) return undefined;
  return v as Omit<PaintObject, 'tiles'>;
}

/** Legacy format with layers — used for migration */
interface CompMetaLegacy {
  name: string;
  layers?: { id: string; name: string; level: number; visible: boolean; order: number; figures: any[] }[];
  activeLayerId?: string;
  camera: Camera;
}

// Write-through cache so a load that races an in-flight save always sees
// the latest composition metadata (the IndexedDB write is async).
// Stored on `globalThis` to guarantee a single shared instance even when
// the module is duplicated across lazy-loaded chunks.
function _getCompMetaCache(): Map<string, string> {
  const w = globalThis as any;
  if (!w.__facetCompMetaCache) w.__facetCompMetaCache = new Map<string, string>();
  return w.__facetCompMetaCache;
}

/** `SVGObject.segmentOverrides` is a `Map`, which `JSON.stringify` silently
 *  flattens to `{}` — that both loses the sparse per-copy paint AND produces a
 *  non-Map that crashes the paint/render loop (`.get`/`.size`) on reload. The
 *  routine composition save/load uses JSON (only import/export bundles go
 *  through the Map-aware binary format), so the Map must be converted here.
 *  Serialize it as a JSON-safe entries array; `migrateSegmentOverrides`
 *  rebuilds the Map on load. Objects without overrides pass through untouched.
 *  The color tool's `paintOverlay` has the same problem with its Uint8Array
 *  texels (stringify turns it into a bloated index→byte object whose
 *  `.subarray` crashes the PNG encoder on reload) — same treatment, via
 *  {@link serializePaintOverlayForMeta} / {@link migratePaintOverlay}. */
function serializeSVGForMeta(svg: SVGObject): SVGObject {
  let out = svg;
  if (out.segmentOverrides) {
    if (out.segmentOverrides.size > 0) {
      out = { ...out, segmentOverrides: Array.from(out.segmentOverrides.entries()) as any };
    } else {
      // Drop an empty Map so it doesn't serialize as a stray `{}`.
      const { segmentOverrides: _omit, ...rest } = out;
      out = rest as SVGObject;
    }
  }
  if (out.paintOverlay) {
    out = { ...out, paintOverlay: serializePaintOverlayForMeta(out.paintOverlay) as any };
  }
  return out;
}

/** The image half of the same rule: only `paintOverlay` needs converting. */
function serializeImageForMeta(img: ImageObject): ImageObject {
  return img.paintOverlay
    ? { ...img, paintOverlay: serializePaintOverlayForMeta(img.paintOverlay) as any }
    : img;
}

/** JSON-safe paint overlay: the RGBA texels ride as base64 (a third the size
 *  of JSON.stringify's index→byte object form, and unambiguous to revive). */
function serializePaintOverlayForMeta(po: ImagePaintOverlay): unknown {
  return { cols: po.cols, rows: po.rows, blend: po.blend, rgba: toBase64(po.rgba) };
}

/** Revive a paint overlay from its JSON form. New saves store base64 texels;
 *  saves from the window before this converter existed stored the Uint8Array
 *  flattened to an index→byte object — those revive too, rather than
 *  crashing the render on reopen. Anything unrecognized → undefined, so the
 *  field is always a real overlay (Uint8Array texels of the exact grid
 *  size) or absent. */
function migratePaintOverlay(v: any): ImagePaintOverlay | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const cols = Number(v.cols);
  const rows = Number(v.rows);
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) return undefined;
  const len = cols * rows * 4;
  let rgba: Uint8Array | undefined;
  if (typeof v.rgba === 'string') {
    rgba = fromBase64(v.rgba);
  } else if (v.rgba instanceof Uint8Array) {
    rgba = v.rgba;
  } else if (v.rgba && typeof v.rgba === 'object') {
    rgba = new Uint8Array(len);
    for (const [k, val] of Object.entries(v.rgba)) {
      const i = Number(k);
      if (Number.isInteger(i) && i >= 0 && i < len && typeof val === 'number') rgba[i] = val & 0xff;
    }
  }
  if (!rgba) return undefined;
  if (rgba.length !== len) {
    const fixed = new Uint8Array(len);
    fixed.set(rgba.subarray(0, Math.min(len, rgba.length)));
    rgba = fixed;
  }
  const blend: BlendMode = typeof v.blend === 'string' ? (v.blend as BlendMode) : 'normal';
  return { cols, rows, blend, rgba };
}


/** Rebuild the sparse per-copy paint Map from its JSON form. New saves store an
 *  entries array (`[[key, {r,g,b}], …]`); older buggy saves stored the Map
 *  flattened to a plain object (data already lost — those yield no overrides).
 *  Anything unrecognized → undefined, so the field is always a Map or absent
 *  and never a non-Map that would crash `.get`/`.size`. */
function migrateSegmentOverrides(v: any): Map<number, RGBColor> | undefined {
  if (!v) return undefined;
  const m = new Map<number, RGBColor>();
  const add = (k: any, val: any) => {
    const nk = Number(k);
    if (Number.isFinite(nk) && val && typeof val === 'object'
        && typeof val.r === 'number' && typeof val.g === 'number' && typeof val.b === 'number') {
      m.set(nk >>> 0, { r: val.r, g: val.g, b: val.b });
    }
  };
  if (Array.isArray(v)) {
    for (const e of v) if (Array.isArray(e) && e.length === 2) add(e[0], e[1]);
  } else if (typeof v === 'object') {
    for (const [k, val] of Object.entries(v)) add(k, val);
  }
  return m.size > 0 ? m : undefined;
}

/**
 * Options for the composition JSON save/load pair. They MUST be passed
 * consistently to both — `saveCompositionState` and `loadCompositionState`
 * each normalize independently, so opting one out alone accomplishes nothing.
 */
export interface CompositionIOOptions {
  /**
   * Rescale + recenter content into the canonical 32×32 L0 box (default true).
   *
   * That is right for a free-floating composition (the tile editor's model:
   * the artwork IS the document, so its absolute placement carries no
   * meaning). It is WRONG for a PAGE-ANCHORED composition, where coordinates
   * are positions on a fixed page: normalization power-of-2 upscales any
   * content smaller than the canonical box and re-anchors it to the snapped
   * grid origin, which moves objects relative to the page they were placed
   * on. A journal page holding one small drawing would come back 4× larger
   * and half off the page. Pass `false` for those and store page coordinates
   * verbatim.
   */
  normalize?: boolean;
}

export async function saveCompositionState(
  state: CompositionState,
  opts?: CompositionIOOptions,
): Promise<void> {
  // Persist image bytes alongside the JSON meta. Each unique imageId
  // gets its own binary key so duplicate ImageObjects don't double-store.
  // Bytes are immutable per imageId, so we skip the write when the key
  // already exists (saves IDB churn during high-frequency autosave).
  const images = state.images ?? [];
  const blobs = state.imageBlobs ?? {};
  if (images.length > 0) {
    const seen = new Set<string>();
    // Persist the display blob and, when present, the higher-res original —
    // both live in `imageBlobs` under distinct ids and each gets its own
    // binary key so the original survives reload and export stays full-res.
    for (const img of images) {
      for (const id of [img.imageId, img.originalImageId]) {
        if (id == null || seen.has(id)) continue;
        seen.add(id);
        const bytes = blobs[id];
        if (!bytes) continue;
        const existing = await storage.getBinary(imgBlobKey(id));
        if (!existing || existing.length !== bytes.length) {
          await storage.setBinary(imgBlobKey(id), bytes);
        }
      }
    }
  }

  // Persist paint island tile bytes, one binary key per object. Unlike
  // image bytes these are mutable, but commits swap the whole tiles array,
  // so a reference-equality cache is exactly "unchanged since last write" —
  // the debounced autosave then rewrites only islands the user painted.
  const paintObjects = state.paintObjects ?? [];
  if (paintObjects.length > 0) {
    const cache = _getPaintBlobCache();
    for (const p of paintObjects) {
      if (cache.get(p.id) === p.tiles) continue;
      await storage.setBinary(pntBlobKey(p.id), packPaintTiles(p.tiles));
      cache.set(p.id, p.tiles);
    }
  }

  // Normalize content into the canonical 32×32 L0 box before serializing
  // (unless the caller opted out — see CompositionIOOptions.normalize).
  // Power-of-2 scaling preserves grid alignment; gridLevel is bumped by k and
  // strokeScale by s so visual content is preserved across the transform.
  // The in-memory state is NOT mutated — the caller keeps its working camera
  // and (possibly drifted) content. On next load the disk copy comes back
  // canonical.
  const input = {
    figures: state.figures,
    svgObjects: state.svgObjects,
    images,
    texts: state.texts,
    paintObjects,
    groups: state.groups,
    gridLevel: state.gridLevel,
    strokeScale: state.strokeScale,
    background: state.background,
  };
  // A page-anchored caller opts out: coordinates go to disk exactly as the
  // page holds them (and `scale === 1 && k === 0` keeps the camera below).
  const normalized = opts?.normalize === false
    ? { ...input, scale: 1, k: 0 }
    : normalizeComposition(input);

  const meta: CompMeta = {
    name: state.name,
    figures: normalized.figures,
    groups: normalized.groups,
    svgObjects: normalized.svgObjects.length > 0 ? normalized.svgObjects.map(serializeSVGForMeta) : undefined,
    images: normalized.images && normalized.images.length > 0
      ? normalized.images.map(serializeImageForMeta)
      : undefined,
    texts: normalized.texts && normalized.texts.length > 0 ? normalized.texts : undefined,
    background: normalized.background,
    paintObjects: normalized.paintObjects && normalized.paintObjects.length > 0
      ? normalized.paintObjects.map(serializePaintForMeta)
      : undefined,
    sceneOrder: state.sceneOrder.length > 0 ? state.sceneOrder : undefined,
    lastChosenColor: state.lastChosenColor,
    customColors: state.customColors.length > 0 ? state.customColors : undefined,
    // Camera on disk references the normalized coordinate space. We write
    // a placeholder; the editor reframes content when the viewport is set.
    camera: normalized.scale === 1 && normalized.k === 0 ? state.camera : { offsetX: 0, offsetY: 0, zoom: 1 },
    gridLevel: normalized.gridLevel,
    strokeScale: normalized.strokeScale,
    gridIntensity: state.gridIntensity,
  };
  const json = JSON.stringify(meta);
  _getCompMetaCache().set(compMetaKey(state.id), json);
  await storage.setItem(compMetaKey(state.id), json);
}

export async function loadCompositionState(
  id: string,
  opts?: CompositionIOOptions,
): Promise<Partial<CompositionState> | null> {
  const cached = _getCompMetaCache().get(compMetaKey(id));
  const raw = cached ?? await storage.getItem(compMetaKey(id));
  if (!raw) return null;
  const parsed: CompMeta & CompMetaLegacy = JSON.parse(raw);

  // Migration: legacy layer-based format
  if (parsed.layers && !parsed.figures) {
    const figures: CompositionFigure[] = parsed.layers.flatMap((l) =>
      l.figures.map((f: any) => ({
        ...f,
        resolutionX: 2,
        resolutionY: 2,
        cellWidth: f.cellWidth ?? 2,
        cellHeight: f.cellHeight ?? 2,
      }))
    );
    return {
      name: parsed.name,
      figures,
      camera: parsed.camera,
      gridLevel: parsed.gridLevel,
      strokeScale: normalizeStrokeScale(undefined),
      gridIntensity: 0.3,
    };
  }

  // Migration: sourceFileId/liveContentHash/detachedHash → fileId
  const figures = (parsed.figures ?? []).map((f: any) => {
    if (f.sourceFileId && !f.fileId) {
      const migrated = { ...f, fileId: f.sourceFileId };
      delete migrated.sourceFileId;
      delete migrated.liveContentHash;
      delete migrated.detachedHash;
      // Update figureKey prefix from live_ to file_
      if (typeof migrated.figureKey === 'string' && migrated.figureKey.startsWith('live_')) {
        migrated.figureKey = 'file_' + migrated.figureKey.slice(5);
      }
      return migrated;
    }
    return f;
  });

  // Migration: arc segments saved before the discriminated union default
  // to `kind: 'arc'`. Same for `localSegments` / `identitySegments` if
  // populated. New saves naturally include `kind` via JSON.stringify.
  const migrateSegment = (seg: any): any =>
    seg && typeof seg === 'object' && !seg.kind ? { kind: 'arc', ...seg } : seg;
  // A non-array `segments` value would crash later spread/iterate sites
  // ("object is not iterable"); coerce to [] on load. Optional-array
  // fields (`localSegments` / `identitySegments`) likewise coerce — if
  // present but malformed, drop to undefined so callers see "no
  // identity / no local snapshot" rather than a poisoned shape.
  const migrateSegArray = (v: any): PathSegment[] =>
    Array.isArray(v) ? v.map(migrateSegment) : [];
  const migrateOptSegArray = (v: any): PathSegment[] | undefined =>
    v === undefined ? undefined : (Array.isArray(v) ? v.map(migrateSegment) : undefined);
  const migrateSubpaths = (v: any): SVGSubpath[] | undefined => {
    if (v === undefined) return undefined;
    if (!Array.isArray(v)) return undefined;
    return v.map((sub: any) => ({ ...sub, segments: migrateSegArray(sub?.segments) }));
  };
  const svgObjects: SVGObject[] = (parsed.svgObjects ?? []).map((s: any) => ({
    ...s,
    segments: migrateSegArray(s.segments),
    localSegments: migrateOptSegArray(s.localSegments),
    identitySegments: migrateOptSegArray(s.identitySegments),
    subpaths: migrateSubpaths(s.subpaths),
    segmentOverrides: migrateSegmentOverrides(s.segmentOverrides),
    paintOverlay: migratePaintOverlay(s.paintOverlay),
  }));

  // Hydrate image blobs from their binary keys. Missing keys (corrupt
  // storage / partial copy) are silently skipped — the renderer will
  // log a warning and skip those wrappers, which is preferable to
  // throwing during composition open.
  const images: ImageObject[] = (parsed.images ?? []).map((img: any) => ({
    ...img,
    paintOverlay: migratePaintOverlay(img.paintOverlay),
  }));
  const imageBlobs: Record<string, Uint8Array> = {};
  if (images.length > 0) {
    const fetched = new Set<string>();
    // Rehydrate both the display blob and the original (when the node
    // references one) so export can reach full resolution after a reload.
    for (const img of images) {
      for (const id of [img.imageId, img.originalImageId]) {
        if (id == null || fetched.has(id)) continue;
        fetched.add(id);
        const bytes = await storage.getBinary(imgBlobKey(id));
        if (bytes) imageBlobs[id] = bytes;
      }
    }
  }

  // Hydrate paint island tiles from their per-object binary keys. A missing
  // or unreadable blob drops the object (an island with no tiles has nothing
  // to show and violates the never-empty invariant) — same corrupt-storage
  // tolerance as missing image blobs. The stored contentRect is trusted when
  // sane; otherwise it is re-derived from the tiles' ink bounds.
  const paintBlobCache = _getPaintBlobCache();
  const paintObjects: PaintObject[] = [];
  for (const raw of parsed.paintObjects ?? []) {
    const scalar = migratePaintObjectMeta(raw);
    if (!scalar) continue;
    const bytes = await storage.getBinary(pntBlobKey(scalar.id));
    const tiles = bytes ? normalizeCanvasPaintIslands(unpackPaintTiles(bytes)) : undefined;
    if (!tiles || tiles.length === 0) continue;
    const contentOk = [scalar.contentX, scalar.contentY, scalar.contentW, scalar.contentH]
      .every((n) => Number.isFinite(n)) && scalar.contentW > 0 && scalar.contentH > 0;
    const rect = contentOk ? null : paintTilesContentRect(tiles);
    if (!contentOk && !rect) continue;
    const p: PaintObject = contentOk
      ? { ...scalar, tiles }
      : { ...scalar, tiles, contentX: rect!.x, contentY: rect!.y, contentW: rect!.w, contentH: rect!.h };
    paintObjects.push(p);
    paintBlobCache.set(p.id, p.tiles);
  }

  // Migration: pre-normalization (legacy) JSON records may have content
  // outside the canonical 32×32 L0 box. Normalize idempotently — content
  // already in canonical position passes through unchanged (scale=1, k=0).
  // Skipped for a page-anchored caller (CompositionIOOptions.normalize):
  // there the stored coordinates ARE page coordinates, and re-anchoring them
  // to the content bbox would move objects around the page on every open.
  const groups = parsed.groups ?? [];
  const texts: TextObject[] = parsed.texts ?? [];
  const normalizeInput = {
    figures,
    svgObjects,
    images,
    texts,
    paintObjects,
    groups,
    gridLevel: parsed.gridLevel ?? 1,
    strokeScale: normalizeStrokeScale(parsed.strokeScale),
    background: parsed.background,
  };
  const r = opts?.normalize === false
    ? { ...normalizeInput, scale: 1, k: 0 }
    : normalizeComposition(normalizeInput);

  return {
    name: parsed.name,
    figures: r.figures,
    groups: r.groups,
    svgObjects: r.svgObjects,
    images: r.images ?? [],
    imageBlobs,
    texts: r.texts ?? [],
    background: r.background,
    paintObjects: r.paintObjects ?? [],
    sceneOrder: parsed.sceneOrder
      ? repairSceneOrder({ figures: r.figures, svgObjects: r.svgObjects, images: r.images ?? [], texts: r.texts ?? [], paintObjects: r.paintObjects ?? [], sceneOrder: parsed.sceneOrder })
      : deriveSceneOrderFromKindArrays({ figures: r.figures, svgObjects: r.svgObjects, images: r.images ?? [], texts: r.texts ?? [], paintObjects: r.paintObjects ?? [] }),
    lastChosenColor: parsed.lastChosenColor ?? { r: 255, g: 255, b: 255 },
    customColors: parsed.customColors ?? [],
    // Camera placeholder when content was rescaled — the editor frames
    // content after the viewport is known. For idempotent loads (already
    // canonical), keep the stored camera.
    camera: r.scale === 1 && r.k === 0 ? parsed.camera : { offsetX: 0, offsetY: 0, zoom: 1 },
    gridLevel: r.gridLevel,
    strokeScale: r.strokeScale,
    gridIntensity: parsed.gridIntensity ?? 0.5,
  };
}

export async function saveCompositionThumbnail(id: string, dataUri: string): Promise<void> {
  await storage.setItem(compThumbKey(id), dataUri);
}

export async function deleteCompositionData(id: string): Promise<void> {
  _getCompMetaCache().delete(compMetaKey(id));
  await storage.multiRemove([compMetaKey(id), compThumbKey(id)]);
}

export async function duplicateCompositionData(
  sourceId: string,
  newId: string,
  newName: string,
): Promise<string | null> {
  const raw = await storage.getItem(compMetaKey(sourceId));
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  parsed.name = newName;

  // Figures belong to the composition they live in. Deep-clone every
  // referenced figure file so the duplicate has independent storage.
  const figures: CompositionFigure[] = Array.isArray(parsed.figures) ? parsed.figures : [];
  const sourceFileIds: string[] = [];
  const seen = new Set<string>();
  for (const fig of figures) {
    if (fig?.fileId && !seen.has(fig.fileId)) {
      seen.add(fig.fileId);
      sourceFileIds.push(fig.fileId);
    }
  }

  if (sourceFileIds.length > 0) {
    const filesRaw = await storage.getItem(FILES_KEY);
    const filesList: { id: string; name: string }[] = filesRaw ? JSON.parse(filesRaw) : [];
    const nameByFileId = new Map<string, string>();
    for (const entry of filesList) nameByFileId.set(entry.id, entry.name);

    const embeddedFiles: { id: string; name: string; widthL0: number; heightL0: number; data: Uint8Array }[] = [];
    for (const oldId of sourceFileIds) {
      const data = await storage.getBinary(metaKey(oldId));
      if (!data) continue;
      const fileMeta = deserializeFile(data);
      const fallbackName = figures.find(f => f.fileId === oldId)?.name ?? 'Figure';
      embeddedFiles.push({
        id: oldId,
        name: nameByFileId.get(oldId) ?? fallbackName,
        widthL0: fileMeta.widthL0 ?? 32,
        heightL0: fileMeta.heightL0 ?? 32,
        data,
      });
    }

    if (embeddedFiles.length > 0) {
      const idRemap = await importEmbeddedFigureFiles(embeddedFiles);
      parsed.figures = figures.map(fig => {
        if (!fig?.fileId) return fig;
        const newFileId = idRemap.get(fig.fileId);
        if (!newFileId) return fig;
        const oldFileId = fig.fileId;
        return {
          ...fig,
          fileId: newFileId,
          figureKey: typeof fig.figureKey === 'string'
            ? fig.figureKey.replace(oldFileId, newFileId)
            : fig.figureKey,
        };
      });
    }
  }

  // Paint islands: re-mint each object's id and copy its tile blob under
  // the fresh key. Unlike image blobs (immutable, shareable by design),
  // tile bytes are mutable — if the duplicate kept the source ids, the
  // first stroke in either composition would overwrite the other's paint.
  if (Array.isArray(parsed.paintObjects) && parsed.paintObjects.length > 0) {
    const remapped: any[] = [];
    const idRemap = new Map<string, string>();
    for (const p of parsed.paintObjects) {
      if (!p || typeof p !== 'object' || typeof p.id !== 'string') continue;
      const freshId = mintPaintObjectId();
      idRemap.set(p.id, freshId);
      const bytes = await storage.getBinary(pntBlobKey(p.id));
      if (!bytes) continue;
      await storage.setBinary(pntBlobKey(freshId), bytes);
      remapped.push({ ...p, id: freshId });
    }
    parsed.paintObjects = remapped.length > 0 ? remapped : undefined;
    if (Array.isArray(parsed.sceneOrder)) {
      parsed.sceneOrder = parsed.sceneOrder.map((id: string) => idRemap.get(id) ?? id);
    }
  }

  await storage.setItem(compMetaKey(newId), JSON.stringify(parsed));
  const thumb = await storage.getItem(compThumbKey(sourceId));
  if (thumb) {
    await storage.setItem(compThumbKey(newId), thumb);
  }
  return thumb;
}

// ── Tile Prefs (Favorites & Per-Tile Transforms) ─────────────────────

const TILE_PREFS_KEY = 'app_tile_prefs';

export interface TilePrefs {
  favorites: string[];
  transforms: Record<string, CellTransform>;
}

export async function saveTilePrefs(prefs: TilePrefs): Promise<void> {
  await storage.setItem(TILE_PREFS_KEY, JSON.stringify(prefs));
}

export async function loadTilePrefs(): Promise<TilePrefs | null> {
  const raw = await storage.getItem(TILE_PREFS_KEY);
  if (!raw) return null;
  return JSON.parse(raw);
}

// ── App-Level Color Palette ─────────────────────────────────────────

const APP_PALETTE_KEY = 'app_color_palette';

export async function saveAppPalette(palette: [number, number, number][]): Promise<void> {
  await storage.setItem(APP_PALETTE_KEY, JSON.stringify(palette));
}

export async function loadAppPalette(): Promise<[number, number, number][] | null> {
  const raw = await storage.getItem(APP_PALETTE_KEY);
  if (!raw) return null;
  return JSON.parse(raw);
}

// ── Developer Mode ──────────────────────────────────────────────────

const DEV_MODE_KEY = 'app_dev_mode';

export async function saveDevMode(enabled: boolean): Promise<void> {
  await storage.setItem(DEV_MODE_KEY, JSON.stringify(enabled));
}

export async function loadDevMode(): Promise<boolean> {
  const raw = await storage.getItem(DEV_MODE_KEY);
  if (!raw) return false;
  return JSON.parse(raw) === true;
}

// ── Thumbnail Line Width ───────────────────────────────────────────

const THUMBNAIL_LINE_WIDTH_KEY = 'app_thumb_line_width';
/** Default thumbnail composition stroke target — 0.4× the previous
 *  hardcoded 8 px so existing tiles look less bloated. */
export const DEFAULT_THUMBNAIL_LINE_WIDTH = 3.2;

export async function saveThumbnailLineWidth(px: number): Promise<void> {
  await storage.setItem(THUMBNAIL_LINE_WIDTH_KEY, JSON.stringify(px));
}

export async function loadThumbnailLineWidth(): Promise<number> {
  const raw = await storage.getItem(THUMBNAIL_LINE_WIDTH_KEY);
  if (!raw) return DEFAULT_THUMBNAIL_LINE_WIDTH;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_THUMBNAIL_LINE_WIDTH;
}

// ── Show Dimensions ─────────────────────────────────────────────────

const SHOW_DIMENSIONS_KEY = 'app_show_dimensions';

export async function saveShowDimensions(enabled: boolean): Promise<void> {
  await storage.setItem(SHOW_DIMENSIONS_KEY, JSON.stringify(enabled));
}

export async function loadShowDimensions(): Promise<boolean> {
  const raw = await storage.getItem(SHOW_DIMENSIONS_KEY);
  if (!raw) return true;
  return JSON.parse(raw) === true;
}

// ── Grid Snap ──────────────────────────────────────────────────────

const GRID_SNAP_KEY = 'app_grid_snap';

export async function saveGridSnap(enabled: boolean): Promise<void> {
  await storage.setItem(GRID_SNAP_KEY, JSON.stringify(enabled));
}

/** null when the user has never set the toggle — the caller (gridSnapStore)
 *  then falls back to whatever default the open format asks for. */
export async function loadGridSnap(): Promise<boolean | null> {
  const raw = await storage.getItem(GRID_SNAP_KEY);
  if (!raw) return null;
  return JSON.parse(raw) === true;
}

// ── Grid Weight ────────────────────────────────────────────────────

const GRID_WEIGHT_KEY = 'app_grid_weight';

export async function saveGridWeight(value: number): Promise<void> {
  await storage.setItem(GRID_WEIGHT_KEY, JSON.stringify(value));
}

/** null when nothing is stored, so the store keeps its own default rather
 *  than treating an absent value as 0 (an invisible grid). */
export async function loadGridWeight(): Promise<number | null> {
  const raw = await storage.getItem(GRID_WEIGHT_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
}

// ── Show Touches ───────────────────────────────────────────────────

const SHOW_TOUCHES_KEY = 'app_show_touches';

export async function saveShowTouches(enabled: boolean): Promise<void> {
  await storage.setItem(SHOW_TOUCHES_KEY, JSON.stringify(enabled));
}

export async function loadShowTouches(): Promise<boolean> {
  const raw = await storage.getItem(SHOW_TOUCHES_KEY);
  if (!raw) return false;
  return JSON.parse(raw) === true;
}

// ── File Removal ──────────────────────────────────────────────────

const FILES_KEY = 'files';

export async function removeFileEntry(fileId: string): Promise<void> {
  const filesRaw = await storage.getItem(FILES_KEY);
  if (filesRaw) {
    const files: { id: string; name: string }[] = JSON.parse(filesRaw);
    const updated = files.filter(f => f.id !== fileId);
    await storage.setItem(FILES_KEY, JSON.stringify(updated));
  }
  await storage.removeItem(metaKey(fileId));
  await storage.removeItem(`thumb_${fileId}`);
}

// ── File Export / Import ────────────────────────────────────────────

export async function exportFileData(
  fileId: string,
): Promise<{ name: string; meta: FileMeta; thumbnail?: string } | null> {
  const bytes = await storage.getBinary(metaKey(fileId));
  if (!bytes) return null;

  const meta: FileMeta = deserializeFile(bytes);

  // Read file name from files list
  const filesRaw = await storage.getItem(FILES_KEY);
  let name = 'Untitled';
  if (filesRaw) {
    const files: { id: string; name: string }[] = JSON.parse(filesRaw);
    const entry = files.find((f) => f.id === fileId);
    if (entry) name = entry.name;
  }

  // Read thumbnail
  const thumb = await storage.getItem(`thumb_${fileId}`);

  const result: { name: string; meta: FileMeta; thumbnail?: string } = { name, meta };
  if (thumb) result.thumbnail = thumb;
  return result;
}

export async function importFileData(data: {
  name: string;
  meta: FileMeta;
  thumbnail?: string;
  skipBake?: boolean;
}): Promise<string> {
  const id = Date.now().toString() + '_' + Math.random().toString(36).slice(2, 8);

  // Save file meta as binary
  const layerMetas: LayerMeta[] = data.meta.layers;
  const importBytes = serializeFile(
    layerMetas,
    data.meta.activeLayerId,
    data.meta.widthL0 ?? 32,
    data.meta.heightL0 ?? 32,
    id,
    data.meta.originL0X ?? 0,
    data.meta.originL0Y ?? 0,
    data.meta.clipBox,
  );
  logToNative('log', 'import', `setBinary meta start: id=${id} bytes=${importBytes.byteLength}`);
  await storage.setBinary(metaKey(id), importBytes);
  logToNative('log', 'import', `setBinary meta end: id=${id}`);

  // Mirror clipBox into the sidecar key so runtime readers (bake, SVG
  // cache, composition load) see it without a second binary parse.
  await saveClipBox(id, data.meta.clipBox ?? null);

  // Save thumbnail if present
  if (data.thumbnail) {
    logToNative('log', 'import', `setItem thumb start: id=${id} len=${data.thumbnail.length}`);
    await storage.setItem(`thumb_${id}`, data.thumbnail);
    logToNative('log', 'import', `setItem thumb end: id=${id}`);
  }

  // Add to files list
  logToNative('log', 'import', `files-list read start: id=${id}`);
  const filesRaw = await storage.getItem(FILES_KEY);
  const files: { id: string; name: string }[] = filesRaw ? JSON.parse(filesRaw) : [];
  files.unshift({ id, name: data.name });
  await storage.setItem(FILES_KEY, JSON.stringify(files));
  logToNative('log', 'import', `files-list write end: id=${id} total=${files.length}`);

  // Bake imported file so its figure is immediately available in compositions.
  // Awaited so callers can reload the baked-figure index and see the new entry.
  // Callers that already have a usable baked artifact to copy (e.g. duplicate)
  // can pass skipBake to avoid the slow rasterization here.
  if (!data.skipBake) {
    const layers = metaToLayers(data.meta);
    logToNative('log', 'import', `bake start: id=${id} layers=${layers.length}`);
    await bakeFile(id, layers, data.meta.widthL0, data.meta.heightL0);
    logToNative('log', 'import', `bake end: id=${id}`);
  }

  return id;
}

// ── SVG Export ───────────────────────────────────────────────────────

export async function exportFileAsSVG(fileId: string): Promise<string | null> {
  const fileState = await loadFileState(fileId);
  if (!fileState) return null;

  // Read file name from files list
  const filesRaw = await storage.getItem(FILES_KEY);
  let name = 'Untitled';
  if (filesRaw) {
    const files: { id: string; name: string }[] = JSON.parse(filesRaw);
    const entry = files.find((f) => f.id === fileId);
    if (entry) name = entry.name;
  }

  const fileConfig: FileConfig = {
    id: fileId,
    name,
    widthL0: fileState.widthL0,
    heightL0: fileState.heightL0,
  };

  return exportToSVG(fileState.layers, fileConfig);
}

// ── PNG Export ──────────────────────────────────────────────────────

export async function exportFileAsPNG(fileId: string, maxSize: number = 1024): Promise<{ dataUri: string; name: string } | null> {
  const fileState = await loadFileState(fileId);
  if (!fileState) return null;

  const filesRaw = await storage.getItem(FILES_KEY);
  let name = 'Untitled';
  if (filesRaw) {
    const files: { id: string; name: string }[] = JSON.parse(filesRaw);
    const entry = files.find((f) => f.id === fileId);
    if (entry) name = entry.name;
  }

  const fileConfig: FileConfig = {
    id: fileId,
    name,
    widthL0: fileState.widthL0,
    heightL0: fileState.heightL0,
  };

  const svg = exportToSVG(fileState.layers, fileConfig);
  const { svgToThumbnailDataUri } = await import('./thumbnail');
  const dataUri = await svgToThumbnailDataUri(svg, fileState.widthL0, fileState.heightL0, maxSize, () => false);
  if (!dataUri) return null;
  return { dataUri, name };
}

// ── Composition Bundle Export / Import ─────────────────────────────

export async function exportCompositionBundle(compId: string): Promise<Uint8Array | null> {
  const { serializeComposition } = await import('./compositionBinaryFormat');
  const { compressTile } = await import('./tileIO');

  const partial = await loadCompositionState(compId);
  if (!partial || !partial.figures) return null;

  const figures = partial.figures;

  // Gather unique file IDs
  const figureFileIds = new Set<string>();
  for (const fig of figures) {
    if (fig.fileId) figureFileIds.add(fig.fileId);
  }

  // Load embedded files
  const filesRaw = await storage.getItem(FILES_KEY);
  const filesList: { id: string; name: string; widthL0?: number; heightL0?: number }[] = filesRaw ? JSON.parse(filesRaw) : [];

  const embeddedFiles: { id: string; name: string; widthL0: number; heightL0: number; data: Uint8Array }[] = [];
  for (const fileId of figureFileIds) {
    const fcetData = await storage.getBinary(metaKey(fileId));
    if (!fcetData) continue;
    const entry = filesList.find(f => f.id === fileId);
    const fileMeta = deserializeFile(fcetData);
    embeddedFiles.push({
      id: fileId,
      name: entry?.name ?? 'Untitled',
      widthL0: fileMeta.widthL0 ?? 32,
      heightL0: fileMeta.heightL0 ?? 32,
      data: fcetData,
    });
  }

  const payload = serializeComposition(
    {
      name: partial.name ?? 'Untitled',
      gridLevel: partial.gridLevel ?? 1,
      strokeScale: normalizeStrokeScale(partial.strokeScale),
      gridIntensity: partial.gridIntensity ?? 0.5,
      camera: partial.camera ?? { offsetX: 0, offsetY: 0, zoom: 1 },
      figures,
      groups: partial.groups ?? [],
      svgObjects: partial.svgObjects ?? [],
      // Bundle reference images and their bytes inline so the .tile
      // file is self-contained — same model as embedded figure files.
      images: partial.images ?? [],
      imageBlobs: partial.imageBlobs ?? {},
      texts: partial.texts ?? [],
      background: partial.background,
      paintObjects: partial.paintObjects ?? [],
      sceneOrder: partial.sceneOrder,
      customColors: partial.customColors ?? [],
    },
    embeddedFiles,
  );

  return compressTile(payload);
}

export async function importCompositionBundle(data: Uint8Array, fileName?: string, entryFields?: Partial<CompositionEntry>): Promise<string> {
  const { deserializeComposition } = await import('./compositionBinaryFormat');
  const { decompressTile } = await import('./tileIO');

  const payload = await decompressTile(data);
  const { meta, embeddedFiles } = deserializeComposition(payload);

  // Use file name (sans extension) if provided, otherwise fall back to embedded name
  const compName = fileName
    ? fileName.replace(/\.(tile|json)$/i, '')
    : meta.name;

  // Import embedded files with new IDs (sequential to avoid OOM)
  const idRemap = await importEmbeddedFigureFiles(embeddedFiles);

  // Remap figure references
  const remappedFigures = meta.figures.map(fig => {
    const updated = { ...fig };
    if (updated.fileId && idRemap.has(updated.fileId)) {
      const oldId = updated.fileId;
      const newId = idRemap.get(oldId)!;
      updated.fileId = newId;
      updated.figureKey = updated.figureKey.replace(oldId, newId);
    }
    return updated;
  });

  // Create new composition
  const compId = Date.now().toString();
  const svgObjects: SVGObject[] = meta.svgObjects ?? [];
  const images = meta.images ?? [];
  const texts = meta.texts ?? [];
  // Re-mint paint island ids: their tile bytes land in per-id binary keys
  // on save, and an imported copy keeping the source ids would share (and
  // later clobber) an existing composition's paint blobs.
  const importedPaints = (meta.paintObjects ?? []).map((p) => ({ ...p, id: mintPaintObjectId() }));
  const paintIdRemap = new Map((meta.paintObjects ?? []).map((p, i) => [p.id, importedPaints[i].id]));
  const compState: CompositionState = {
    id: compId,
    name: compName,
    figures: remappedFigures,
    svgObjects,
    images,
    imageBlobs: meta.imageBlobs ?? {},
    texts,
    paintObjects: importedPaints,
    background: meta.background,
    lineDraft: null,
    arcDraft: null,
    editingLineId: null,
    selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
    customColors: meta.customColors ?? [],
    groups: meta.groups ?? [],
    // v11+ bundles carry sceneOrder; older bundles get it derived from
    // the kind arrays in the legacy fixed paint order so the loaded
    // composition is visually identical to the source. Bundles saved by
    // a buggy version may have a partial sceneOrder — `repairSceneOrder`
    // backfills any missing ids so the loaded scene matches the data.
    sceneOrder: meta.sceneOrder
      ? repairSceneOrder({
          figures: remappedFigures, svgObjects, images, texts, paintObjects: importedPaints,
          sceneOrder: meta.sceneOrder.map((id) => paintIdRemap.get(id) ?? id),
        })
      : deriveSceneOrderFromKindArrays({ figures: remappedFigures, svgObjects, images, texts, paintObjects: importedPaints }),
    gridLevel: meta.gridLevel,
    strokeScale: meta.strokeScale,
    gridIntensity: meta.gridIntensity ?? 0.5,
    camera: meta.camera,
    viewport: makeViewport(0, 0),
    selectedFigureIds: new Set<string>(),
    activeFigureKey: null,
    compTool: 'place',
    createRegion: null,
    renderGeneration: 0,
  };
  await saveCompositionState(compState);

  // Add to composition list
  const compList = await loadCompositionList();
  compList.unshift({ id: compId, name: compName, ...entryFields });
  await saveCompositionList(compList);

  return compId;
}

/**
 * Import embedded figure files into storage with new IDs and bake each one.
 * Returns a map from old file IDs to new file IDs. Sequential to avoid OOM.
 */
export async function importEmbeddedFigureFiles(
  embeddedFiles: { id: string; name: string; widthL0: number; heightL0: number; data: Uint8Array }[],
): Promise<Map<string, string>> {
  const idRemap = new Map<string, string>();
  const baseTime = Date.now();

  const filesRaw = await storage.getItem(FILES_KEY);
  const filesList: { id: string; name: string }[] = filesRaw ? JSON.parse(filesRaw) : [];

  for (let i = 0; i < embeddedFiles.length; i++) {
    const ef = embeddedFiles[i];
    const newId = (baseTime + i).toString();
    idRemap.set(ef.id, newId);

    await storage.setBinary(metaKey(newId), ef.data);
    filesList.unshift({ id: newId, name: ef.name });

    const fileMeta = deserializeFile(ef.data);
    // Mirror any clipBox from the embedded binary into the sidecar so
    // bake (and other runtime readers) see it for the new ID.
    await saveClipBox(newId, fileMeta.clipBox ?? null);
    const layers = metaToLayersLite(fileMeta);
    await bakeFile(newId, layers, ef.widthL0, ef.heightL0);
  }

  await storage.setItem(FILES_KEY, JSON.stringify(filesList));
  return idRemap;
}

// ── SVG Design Storage ─────────────────────────────────────────────

const SVG_DESIGNS_KEY = 'svg_designs';

function svgDesignKey(id: string): string {
  return `svg_design_${id}`;
}

export async function loadSVGDesignList(): Promise<{ id: string; name: string }[]> {
  const raw = await storage.getItem(SVG_DESIGNS_KEY);
  if (!raw) return [];
  return JSON.parse(raw);
}

export async function loadSVGDesign(id: string): Promise<SVGDesignTemplate | null> {
  const raw = await storage.getItem(svgDesignKey(id));
  if (!raw) return null;
  return JSON.parse(raw);
}

export async function saveSVGDesign(design: SVGDesignTemplate): Promise<void> {
  await storage.setItem(svgDesignKey(design.id), JSON.stringify(design));
  const list = await loadSVGDesignList();
  if (!list.some(e => e.id === design.id)) {
    list.push({ id: design.id, name: design.name });
    await storage.setItem(SVG_DESIGNS_KEY, JSON.stringify(list));
  }
}

export async function deleteSVGDesign(id: string): Promise<void> {
  await storage.removeItem(svgDesignKey(id));
  const list = await loadSVGDesignList();
  const filtered = list.filter(e => e.id !== id);
  await storage.setItem(SVG_DESIGNS_KEY, JSON.stringify(filtered));
}

export async function renameSVGDesign(id: string, name: string): Promise<void> {
  const design = await loadSVGDesign(id);
  if (!design) return;
  design.name = name;
  await storage.setItem(svgDesignKey(id), JSON.stringify(design));
  const list = await loadSVGDesignList();
  const entry = list.find(e => e.id === id);
  if (entry) {
    entry.name = name;
    await storage.setItem(SVG_DESIGNS_KEY, JSON.stringify(list));
  }
}

