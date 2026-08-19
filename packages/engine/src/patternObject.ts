/**
 * PatternObject — the inline tile-pattern scene node.
 *
 * A pattern is a single-resolution grid of tile cells (≤ 16×16) stored
 * directly on the object and edited in place on the main canvas. This
 * module is the whole engine surface for the kind:
 *
 *  - grid logic: applying the pattern sub-tools (random / erase / a
 *    specific tile) at a cell, with symmetry mirroring and the same
 *    connectivity rules as the old tile editor (connectivity.ts is called
 *    with a single fixed-resolution layer view);
 *  - reconcile / clear sweeps, returned as cell-edit lists that ride one
 *    undo op each. (The SVG bake lives in patternObjectRender.ts.)
 *
 * The grid maps onto GridLevel 1: CELL_COUNTS[1] = 16 cells across a
 * 32-L0 canvas, i.e. one pattern cell = 2 L0 units and the 16×16 maximum
 * is exactly the full layer grid. Connectivity, mirror math, and the SVG
 * export all consume that layer view unchanged.
 */

import {
  CellState,
  CellTransform,
  DEFAULT_TRANSFORM,
  GridLevel,
  Layer,
  PatternObject,
  PatternSymmetry,
  PATTERN_SYMMETRY_OFF,
  RGBColor,
} from './types';
import {
  cellStatesEqual,
  pickRandomCompatibleSprite,
  reconcileCanvas,
  mirrorCellState,
} from './connectivity';
import {
  computePaintMirrorTargets,
  computeMirrorSymmetry,
} from './paintMirror';
import type { CanvasConfig } from './canvas-bounds';

// ── Grid constants ──────────────────────────────────────────────────

/** Maximum pattern grid size per axis (cells). */
export const MAX_PATTERN_GRID = 16;

/** The fixed layer level pattern grids live at (16 cells / 32 L0). */
export const PATTERN_GRID_LEVEL: GridLevel = 1;

/** L0 units per pattern cell at PATTERN_GRID_LEVEL. */
export const PATTERN_CELL_L0 = 2;

// ── Id minting ──────────────────────────────────────────────────────
// The 'pat_' namespace is load-bearing: SCENE_ADAPTERS, adapterForId and
// persistence resolve node kind by id prefix (the mintPaintObjectId
// pattern).

let mintCounter = 0;

export function mintPatternObjectId(): string {
  return `pat_${Date.now().toString(36)}_${(mintCounter++).toString(36)}`;
}

// ── Cell addressing ─────────────────────────────────────────────────

export function patternCellIndex(p: PatternObject, x: number, y: number): number {
  return y * p.cols + x;
}

export function patternCellAt(p: PatternObject, x: number, y: number): CellState {
  if (x < 0 || y < 0 || x >= p.cols || y >= p.rows) return null;
  return p.cells[patternCellIndex(p, x, y)] ?? null;
}

/** One cell change; index is row-major into `cells`. */
export interface PatternCellEdit {
  index: number;
  oldState: CellState;
  newState: CellState;
}

/** Immutable cell update — returns a new object with the edits applied.
 *  `direction` picks newState (apply) or oldState (revert). */
export function applyPatternCellEdits(
  p: PatternObject,
  edits: PatternCellEdit[],
  direction: 'apply' | 'revert' = 'apply',
): PatternObject {
  if (edits.length === 0) return p;
  const cells = p.cells.slice();
  for (const e of edits) {
    cells[e.index] = direction === 'apply' ? e.newState : e.oldState;
  }
  return { ...p, cells };
}

export function patternSymmetryFlags(p: PatternObject): PatternSymmetry {
  return p.symmetry ?? PATTERN_SYMMETRY_OFF;
}

export function patternAllowsBorderConnections(p: PatternObject): boolean {
  return p.allowBorderConnections !== false;
}

export function patternIsEmpty(p: PatternObject): boolean {
  return !p.cells.some((c) => c != null);
}

// ── Layer view ──────────────────────────────────────────────────────
// connectivity.ts / paintMirror.ts / svgExport.ts all operate on Layer +
// CanvasConfig. A pattern presents itself as one full 16×16 layer at
// PATTERN_GRID_LEVEL with the canvas window sized to cols×rows cells;
// slots beyond cols/rows stay null and sit outside the canvas window.

export function patternCanvasCfg(p: PatternObject): CanvasConfig {
  return {
    widthL0: p.cols * PATTERN_CELL_L0,
    heightL0: p.rows * PATTERN_CELL_L0,
    originL0X: 0,
    originL0Y: 0,
  };
}

const EMPTY_BYTES = new Uint8Array(0);
const EMPTY_WORDS = new Uint32Array(0);

/** Build a mutable Layer view of the pattern's cells. The `data` pixel
 *  buffers are empty stand-ins — every engine function this module calls
 *  reads/writes `cells` only (the GL pixel pipeline is gone). */
export function buildPatternLayerView(p: PatternObject): Layer {
  const count = 16; // CELL_COUNTS[PATTERN_GRID_LEVEL]
  const cells: (CellState | null)[][] = new Array(count);
  for (let y = 0; y < count; y++) {
    const row: (CellState | null)[] = new Array(count).fill(null);
    if (y < p.rows) {
      for (let x = 0; x < p.cols; x++) {
        row[x] = p.cells[y * p.cols + x] ?? null;
      }
    }
    cells[y] = row;
  }
  return {
    id: p.id,
    name: '',
    level: PATTERN_GRID_LEVEL,
    visible: true,
    opacity: 1,
    order: 0,
    shiftX: 0,
    shiftY: 0,
    data: EMPTY_BYTES,
    dataU32: EMPTY_WORDS,
    dirtyRects: [],
    dirtyRectCount: 0,
    locked: false,
    cells,
    cellsGeneration: 0,
    edgeRowTop: null,
    edgeColLeft: null,
    edgeCorner: null,
  };
}

// ── Sub-tools ───────────────────────────────────────────────────────

export type PatternSubTool =
  | { kind: 'random' }
  | { kind: 'erase' }
  | { kind: 'tile'; spriteId: string };

const IDENTITY: CellTransform = DEFAULT_TRANSFORM;

/**
 * Compute the cell edits for applying `tool` at pattern cell (x, y):
 * the primary cell plus its symmetry partners (mirrored copies via
 * mirrorCellState). Random picks respect connectivity against the
 * pattern's own single-resolution grid and the border-connection rule,
 * and self-symmetry when the cell sits on an active mirror axis.
 *
 * The edits are relative to `p` as passed — during a drag stroke the
 * caller applies each batch to a working copy and hands the updated
 * object to the next call, so later picks see earlier stamps.
 *
 * `excludedFamilies` narrows what the random brush may pick (the app's
 * tile-set filter); stamping a specific tile ignores it.
 *
 * `tint` is the ink the laid tile draws in — the editor's active colour,
 * so a tile arrives in the colour the user is working in rather than
 * always in the base ink. It rides on the cell (see tintedPatternCell), so
 * the mirror partners inherit it for free: mirrorCellState rewrites only
 * the transform. Omit it (or pass the base ink) to lay an untinted tile.
 */
export function patternApplyToolAt(
  p: PatternObject,
  x: number,
  y: number,
  tool: PatternSubTool,
  excludedFamilies?: Set<string>,
  tint?: RGBColor | null,
): PatternCellEdit[] {
  if (x < 0 || y < 0 || x >= p.cols || y >= p.rows) return [];
  const layer = buildPatternLayerView(p);
  const cfg = patternCanvasCfg(p);
  const flags = patternSymmetryFlags(p);

  let primary: CellState;
  switch (tool.kind) {
    case 'erase':
      primary = null;
      break;
    case 'tile':
      primary = { type: 'sprite', spriteId: tool.spriteId, transform: IDENTITY };
      break;
    case 'random': {
      const symmetry = computeMirrorSymmetry(x, y, layer, cfg, flags);
      primary = pickRandomCompatibleSprite(
        x, y, layer, [layer],
        patternAllowsBorderConnections(p),
        excludedFamilies, undefined,
        cfg.widthL0, cfg.heightL0,
        undefined, symmetry,
      );
      break;
    }
  }
  if (tint) primary = tintedPatternCell(primary, tint);

  const edits: PatternCellEdit[] = [];
  const seen = new Set<number>();
  const push = (cx: number, cy: number, next: CellState) => {
    if (cx < 0 || cy < 0 || cx >= p.cols || cy >= p.rows) return;
    const index = cy * p.cols + cx;
    if (seen.has(index)) return;
    seen.add(index);
    edits.push({ index, oldState: patternCellAt(p, cx, cy), newState: next });
  };

  push(x, y, primary);
  const targets = computePaintMirrorTargets(x, y, layer, cfg, flags);
  for (const t of targets) {
    push(t.x, t.y, primary == null ? null : mirrorCellState(primary, t.mH, t.mV, t.rot));
  }
  // Drop no-op edits (e.g. erasing an already-empty cell) so an idle tap
  // doesn't commit an empty undo step.
  return edits.filter((e) => !cellStatesEqual(e.oldState, e.newState));
}

/**
 * Reconcile the whole pattern grid: iteratively replace mismatched tiles
 * until every same-resolution connection agrees (reconcileCanvas, called
 * with the pattern's single layer). `borderOnly` restricts fixes to the
 * grid border, mirroring the old "hold for Border" behavior.
 */
export function patternReconcileEdits(
  p: PatternObject,
  borderOnly: boolean = false,
  excludedFamilies?: Set<string>,
): PatternCellEdit[] {
  const layer = buildPatternLayerView(p);
  const flags = patternSymmetryFlags(p);
  const cfg = patternCanvasCfg(p);
  const ops = reconcileCanvas(
    [layer], [layer],
    patternAllowsBorderConnections(p),
    new Map(),
    excludedFamilies,
    flags.mirrorH, flags.mirrorV, flags.mirrorRotate,
    cfg.widthL0, cfg.heightL0,
    borderOnly,
    flags.mirrorQuad, flags.mirrorRow, flags.mirrorCol,
    flags.mirrorDiag1, flags.mirrorDiag2, flags.mirrorDiagBoth, flags.mirrorStar,
  );
  const edits: PatternCellEdit[] = [];
  for (const op of ops) {
    if (op.op !== 'cell') continue;
    if (op.cellX < 0 || op.cellY < 0 || op.cellX >= p.cols || op.cellY >= p.rows) continue;
    // Reconcile swaps a tile for a better-connecting one; it is not a
    // repaint. The replacement is minted fresh from the sprite registry, so
    // it arrives untinted — carry the cell's own ink across, or healing a
    // seam would quietly strip the colour the user painted there.
    const ink = patternCellTint(op.oldState);
    const newState = ink ? tintedPatternCell(op.newState, ink) : op.newState;
    edits.push({
      index: op.cellY * p.cols + op.cellX,
      oldState: op.oldState,
      newState,
    });
  }
  return edits.filter((e) => !cellStatesEqual(e.oldState, e.newState));
}

/**
 * Flood the grid: REPLACE it wholesale with the armed sub-tool. The grid
 * is cleared first and then filled from empty, so what comes out is the
 * armed tool's own pattern rather than a fill that had to fit itself
 * around whatever happened to be there — a specific armed tile gives a
 * grid of that tile, and the random brush re-rolls the whole thing.
 *
 * Anything that isn't a specific tile (the eraser included) floods random:
 * an eraser flood would just be Clear, which is its own button.
 *
 * Filling runs in scan order against a working grid, so each random pick
 * honors the connectivity constraints of the picks before it and the
 * finished grid is self-consistent. Symmetry rides along through
 * patternApplyToolAt — mirror partners take mirrored states, and are
 * restricted to still-empty cells so a partner already filled this pass
 * keeps the state its own turn gave it.
 *
 * The returned edits are relative to `p`, diffed at the end: a cell the
 * flood happens to leave exactly as it found it contributes nothing, so
 * re-flooding with the same tile in the same ink is a no-op (and builds no
 * undo step).
 *
 * `tint` is the ink to lay, as in patternApplyToolAt — a flood is the
 * painting of every cell at once, so it lays what the brush would.
 */
export function patternFloodEdits(
  p: PatternObject,
  tool: PatternSubTool,
  excludedFamilies?: Set<string>,
  tint?: RGBColor | null,
): PatternCellEdit[] {
  const effective: PatternSubTool = tool.kind === 'tile' ? tool : { kind: 'random' };
  let working = applyPatternCellEdits(p, patternClearEdits(p));
  for (let y = 0; y < p.rows; y++) {
    for (let x = 0; x < p.cols; x++) {
      if (patternCellAt(working, x, y) != null) continue;
      const fillable = patternApplyToolAt(working, x, y, effective, excludedFamilies, tint)
        .filter((e) => e.oldState == null);
      if (fillable.length === 0) continue;
      working = applyPatternCellEdits(working, fillable);
    }
  }
  const edits: PatternCellEdit[] = [];
  for (let i = 0; i < p.cells.length; i++) {
    const oldState = p.cells[i] ?? null;
    const newState = working.cells[i] ?? null;
    if (cellStatesEqual(oldState, newState)) continue;
    edits.push({ index: i, oldState, newState });
  }
  return edits;
}

/** Re-ink every sprite cell, keeping its tile and transform — what the
 *  Stroke bar's swatch does to a pattern, and the pattern's answer to
 *  recolouring a vector object. 'color' cells are left alone: one IS a
 *  colour rather than a tile drawn in one, so re-inking would replace the
 *  thing instead of colouring it. Cells already drawing in `color` drop
 *  out, so re-picking the same ink builds no undo step. */
export function patternRecolorEdits(p: PatternObject, color: RGBColor): PatternCellEdit[] {
  const edits: PatternCellEdit[] = [];
  for (let i = 0; i < p.cells.length; i++) {
    const cell = p.cells[i] ?? null;
    if (!cell || cell.type !== 'sprite') continue;
    const newState = tintedPatternCell(cell, color);
    if (cellStatesEqual(cell, newState)) continue;
    edits.push({ index: i, oldState: cell, newState });
  }
  return edits;
}

/** The colour cell `index` draws in — its own tint where it has one, else
 *  the base ink the bake gives an untinted tile. */
export function effectivePatternCellColor(p: PatternObject, index: number): RGBColor {
  return patternCellTint(p.cells[index] ?? null) ?? PATTERN_BASE_INK;
}

/** The one colour the whole pattern draws in, or null when its cells
 *  disagree (or it holds no sprite cell at all). What a swatch showing
 *  "the pattern's colour" can honestly display. */
export function patternInkColor(p: PatternObject): RGBColor | null {
  let ink: RGBColor | null = null;
  for (let i = 0; i < p.cells.length; i++) {
    const cell = p.cells[i] ?? null;
    if (!cell || cell.type !== 'sprite') continue;
    const c = effectivePatternCellColor(p, i);
    if (ink == null) ink = c;
    else if (ink.r !== c.r || ink.g !== c.g || ink.b !== c.b) return null;
  }
  return ink;
}

/** Clear every filled cell. */
export function patternClearEdits(p: PatternObject): PatternCellEdit[] {
  const edits: PatternCellEdit[] = [];
  for (let i = 0; i < p.cells.length; i++) {
    const cell = p.cells[i] ?? null;
    if (cell == null) continue;
    edits.push({ index: i, oldState: cell, newState: null });
  }
  return edits;
}

// ── World point → pattern cell ──────────────────────────────────────

/**
 * Map a world point (already un-rotated by any free `angleDeg` — the
 * caller applies `unrotatePointForNode` first, same as hit testing) to the
 * pattern grid cell under it, or null when the point misses the grid.
 *
 * Handles the two bake-time transforms in inverse:
 *  - repeat mode: the point is taken modulo the tile grid (anchored at
 *    `cellX + tileOffset`), so a tap anywhere in the region edits the
 *    underlying tile cell it shows;
 *  - the discrete rotation/mirror flags: the bake renders mirrors first,
 *    then rotation (figureToPaths' toL0), so the inverse applies the
 *    reverse rotation, then the mirrors (self-inverse), in bbox-centered
 *    coordinates — for 90°/270° the world box is the swapped one.
 */
export function patternCellAtWorldPoint(
  p: PatternObject,
  worldX: number,
  worldY: number,
): { x: number; y: number } | null {
  // Resolve the box one drawn tile occupies (world, post-rotation dims).
  const repeat = p.tileMode === 'repeat' && p.tileWidthL0 != null && p.tileHeightL0 != null;
  let boxX: number, boxY: number, boxW: number, boxH: number;
  let lx: number, ly: number;
  if (repeat) {
    const ax = p.cellX + (p.tileOffsetXL0 ?? 0);
    const ay = p.cellY + (p.tileOffsetYL0 ?? 0);
    boxW = p.tileWidthL0!;
    boxH = p.tileHeightL0!;
    boxX = ax;
    boxY = ay;
    // Region gate first, then wrap into the tile box.
    if (worldX < p.cellX || worldX >= p.cellX + p.cellWidth) return null;
    if (worldY < p.cellY || worldY >= p.cellY + p.cellHeight) return null;
    lx = ((worldX - ax) % boxW + boxW) % boxW;
    ly = ((worldY - ay) % boxH + boxH) % boxH;
  } else {
    boxX = p.cellX; boxY = p.cellY;
    boxW = p.cellWidth; boxH = p.cellHeight;
    lx = worldX - boxX;
    ly = worldY - boxY;
    if (lx < 0 || ly < 0 || lx >= boxW || ly >= boxH) return null;
  }

  // Undo the discrete rotation/mirror about the box center. The bake maps
  // content → world as R(M(pt)); invert as M(R⁻¹(pt)).
  const rot = p.rotation ?? 0;
  let u = lx - boxW / 2;
  let v = ly - boxH / 2;
  if (rot === 90) { const t = u; u = v; v = -t; }
  else if (rot === 180) { u = -u; v = -v; }
  else if (rot === 270) { const t = u; u = -v; v = t; }
  if (p.mirrorH) u = -u;
  if (p.mirrorV) v = -v;
  // Content dims: un-swap for the quarter turns.
  const swapped = rot === 90 || rot === 270;
  const contentW = swapped ? boxH : boxW;
  const contentH = swapped ? boxW : boxH;
  const cx = (u + contentW / 2) / contentW;
  const cy = (v + contentH / 2) / contentH;
  const x = Math.floor(cx * p.cols);
  const y = Math.floor(cy * p.rows);
  if (x < 0 || y < 0 || x >= p.cols || y >= p.rows) return null;
  return { x, y };
}

/** How finely {@link patternCellsInBrush} samples the brush disc, as a
 *  fraction of its radius, and the ceiling on samples per axis. Fine enough
 *  that no cell the brush meaningfully covers is missed; capped so a brush
 *  spanning a whole grid stays bounded arithmetic. */
const BRUSH_SAMPLE_STEPS = 6;
const BRUSH_SAMPLE_MAX = 32;

/**
 * The pattern cells a round brush of `radiusCells` centred on
 * (worldX, worldY) covers — the pattern's answer to `brushHitsSegments`,
 * and in the same shape: a flat cell index plus the squared world distance
 * from the brush centre, which the caller turns into the Gaussian falloff.
 *
 * Works by SAMPLING the disc and mapping each sample with
 * {@link patternCellAtWorldPoint}, rather than mapping cells forward into
 * the world. That keeps ONE implementation of a mapping that is not simple —
 * it inverts a discrete rotation, two mirrors, and (in repeat mode) the tile
 * wrap that makes one cell appear all over the region. A forward twin would
 * be the thing that drifts.
 *
 * The distance recorded for a cell is the nearest sample that landed in it,
 * so a cell straddling the brush edge reads as the near edge it really is.
 * Sampling can clip a cell the disc only grazes; there the falloff is
 * already ~0, so nothing visible is lost.
 */
export function patternCellsInBrush(
  p: PatternObject,
  worldX: number,
  worldY: number,
  radiusCells: number,
): { index: number; distSq: number }[] {
  if (!(radiusCells > 0)) {
    const hit = patternCellAtWorldPoint(p, worldX, worldY);
    return hit ? [{ index: hit.y * p.cols + hit.x, distSq: 0 }] : [];
  }
  // One sample per BRUSH_SAMPLE_STEPS of the radius, refined so a cell
  // smaller than that still gets sampled — capped either way.
  const cellW = (p.tileMode === 'repeat' ? p.tileWidthL0 ?? p.cellWidth : p.cellWidth) / p.cols;
  const cellH = (p.tileMode === 'repeat' ? p.tileHeightL0 ?? p.cellHeight : p.cellHeight) / p.rows;
  const fine = Math.max(Math.min(cellW, cellH) / 2, (2 * radiusCells) / BRUSH_SAMPLE_MAX);
  const step = Math.max(Math.min(radiusCells / BRUSH_SAMPLE_STEPS, fine), 1e-6);
  const nearest = new Map<number, number>();
  const consider = (x: number, y: number) => {
    const dx = x - worldX;
    const dy = y - worldY;
    const distSq = dx * dx + dy * dy;
    if (distSq > radiusCells * radiusCells) return;
    const hit = patternCellAtWorldPoint(p, x, y);
    if (!hit) return;
    const index = hit.y * p.cols + hit.x;
    const prev = nearest.get(index);
    if (prev === undefined || distSq < prev) nearest.set(index, distSq);
  };
  consider(worldX, worldY);
  for (let y = worldY - radiusCells; y <= worldY + radiusCells; y += step) {
    for (let x = worldX - radiusCells; x <= worldX + radiusCells; x += step) {
      consider(x, y);
    }
  }
  return [...nearest].map(([index, distSq]) => ({ index, distSq }));
}

/** The ink an UNTINTED pattern cell draws in: the bake leaves a tile's
 *  `stroke="white"` alone unless the cell carries a tint (see
 *  exportLayersToSVGInner), so white is the base every tint departs from
 *  and every blend starts at. */
export const PATTERN_BASE_INK: RGBColor = { r: 255, g: 255, b: 255 };

/** The same cell with an ink on it — the one way a pattern cell carries a
 *  colour of its own. Only a SPRITE cell can be tinted: a 'color' cell
 *  already is a colour, and would be recoloured outright.
 *
 *  The base ink is stored as NO tint rather than as an explicit white.
 *  They draw identically, so leaving both spellings in play would mean two
 *  cells that look the same and compare unequal — a phantom edit in every
 *  diff, three needless bytes per cell in every saved file, and a
 *  same-tile flood that no longer settles to a no-op. */
export function tintedPatternCell(cell: CellState, color: RGBColor): CellState {
  if (!cell || cell.type !== 'sprite') return cell;
  if (color.r === PATTERN_BASE_INK.r && color.g === PATTERN_BASE_INK.g
    && color.b === PATTERN_BASE_INK.b) {
    return { ...cell, tintR: undefined, tintG: undefined, tintB: undefined };
  }
  return { ...cell, tintR: color.r, tintG: color.g, tintB: color.b };
}

/** The colour a cell currently draws in, or null when it draws in the
 *  object's own ink (an untinted sprite). */
export function patternCellTint(cell: CellState): RGBColor | null {
  if (!cell) return null;
  if (cell.type === 'color') return { r: cell.r, g: cell.g, b: cell.b };
  return cell.tintR != null
    ? { r: cell.tintR, g: cell.tintG ?? 0, b: cell.tintB ?? 0 }
    : null;
}

// The SVG bake (cells → derived SVGObject view for render/export) lives in
// patternObjectRender.ts — it pulls in the figure-bake pipeline, whose
// import chain reaches persistence/compositionOps, and compositionOps
// imports THIS module for op application. Keeping the bake separate keeps
// the module graph acyclic.
