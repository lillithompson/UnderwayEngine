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
 */
export function patternApplyToolAt(
  p: PatternObject,
  x: number,
  y: number,
  tool: PatternSubTool,
  excludedFamilies?: Set<string>,
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
    edits.push({
      index: op.cellY * p.cols + op.cellX,
      oldState: op.oldState,
      newState: op.newState,
    });
  }
  return edits;
}

/**
 * Flood the grid: fill every EMPTY cell, leaving placed tiles alone. A
 * specific armed tile stamps into each empty; anything else floods with
 * the random brush — each pick made against the working grid in scan
 * order, so connectivity constraints from placed tiles AND earlier flood
 * picks are honored, and the finished grid is consistent. Symmetry rides
 * along through patternApplyToolAt (mirror partners are filled with
 * mirrored states), restricted to still-empty partners so the flood never
 * overwrites what was already there.
 */
export function patternFloodEdits(
  p: PatternObject,
  tool: PatternSubTool,
  excludedFamilies?: Set<string>,
): PatternCellEdit[] {
  const effective: PatternSubTool = tool.kind === 'tile' ? tool : { kind: 'random' };
  let working = p;
  const all: PatternCellEdit[] = [];
  for (let y = 0; y < p.rows; y++) {
    for (let x = 0; x < p.cols; x++) {
      if (patternCellAt(working, x, y) != null) continue;
      const fillable = patternApplyToolAt(working, x, y, effective, excludedFamilies)
        .filter((e) => e.oldState == null);
      if (fillable.length === 0) continue;
      working = applyPatternCellEdits(working, fillable);
      // Each edit fills a distinct empty cell (filled cells are skipped and
      // never re-visited), so indices never collide — plain append.
      all.push(...fillable);
    }
  }
  return all;
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

// The SVG bake (cells → derived SVGObject view for render/export) lives in
// patternObjectRender.ts — it pulls in the figure-bake pipeline, whose
// import chain reaches persistence/compositionOps, and compositionOps
// imports THIS module for op application. Keeping the bake separate keeps
// the module graph acyclic.
