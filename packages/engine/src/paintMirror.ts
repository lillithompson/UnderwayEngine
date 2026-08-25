/**
 * Single source of truth for mirror-target math.
 *
 * Replaces the prior `regionMirrorCellPx` + `forEachMirrorTarget` pair in
 * cells.ts (which used pixel-space math and explicitly skipped axis cells
 * for MirrorRow/Col) and folds the paint path into it. Every caller —
 * tap-to-paint, draw-tool single cells, flood fill, multires fill, and
 * selection-transform op expansion — now resolves mirror partners through
 * this module.
 *
 * History: paint used to live inside a React useCallback that captured
 * editor state and called a hoisted `_drawAddMirror` helper. That made
 * paint untestable in isolation, and a subtle bug — the bounds check
 * used `editableCells` (origin-oblivious) so partial right-edge cells
 * silently dropped their mirrors — went uncaught until reported by the
 * MirrorV_tests2 scenario. Extracting the math here means future bugs
 * in this code path are caught by the .facet-driven tests.
 */

import { Layer, CELL_COUNTS } from './types';
import { isCellFullyInsideCanvas, type CanvasConfig } from './canvas-bounds';
import type { MirrorSymmetry } from './connectivity';

export interface MirrorFlags {
  readonly mirrorH: boolean;
  readonly mirrorV: boolean;
  readonly mirrorRotate: boolean;
  readonly mirrorQuad: boolean;
  readonly mirrorRow: boolean;
  readonly mirrorCol: boolean;
  readonly mirrorDiag1: boolean;
  readonly mirrorDiag2: boolean;
  readonly mirrorDiagBoth: boolean;
  readonly mirrorStar: boolean;
}

export interface MirrorTarget {
  /** Absolute layer cell X. May be -1 for shifted-X edge cell. */
  x: number;
  /** Absolute layer cell Y. May be -1 for shifted-Y edge cell. */
  y: number;
  /** Whether to flip the source's H mirror when stamping. */
  mH: boolean;
  /** Whether to flip the source's V mirror when stamping. */
  mV: boolean;
  /** Rotation offset to apply to the source when stamping. */
  rot: 0 | 90 | 180 | 270;
}

/** Cell-index window used to clip mirror targets to the canvas extent.
 *  Half-open `[minCellX, endCellX)` × `[minCellY, endCellY)`. */
export interface MirrorCellWindow {
  readonly minCellX: number;
  readonly endCellX: number;
  readonly minCellY: number;
  readonly endCellY: number;
}

// Module-level scratch buffer — every compute writes here so the hot path
// (flood fill, multires fill) stays allocation-free. Size 16 covers the
// maximum target count (MirrorQuad: 16 quadrant×local positions, minus the
// primary). Callers must consume the buffer before the next compute call.
const _mirrorTargets: MirrorTarget[] = Array.from({ length: 16 }, () => ({
  x: 0, y: 0, mH: false, mV: false, rot: 0 as 0 | 90 | 180 | 270,
}));
export let _mirrorTargetCount = 0;

// Scratch symmetry record, refreshed at the start of every compute. Holds
// axis-membership flags accumulated when a candidate target would have
// landed on the primary cell. Read by `computeMirrorSymmetry` (which copies
// it before returning, since this struct is shared).
const _scratchSymmetry: MirrorSymmetry = { h: false, v: false, d1: false, d2: false };

/**
 * Core mirror-target compute. Writes results into `_mirrorTargets` /
 * `_mirrorTargetCount` and updates `_scratchSymmetry`. The returned buffer
 * may contain stale slots past `_mirrorTargetCount`; callers iterate up to
 * the count or use one of the wrapper helpers below.
 */
function computeImpl(
  cellX: number,
  cellY: number,
  layer: Layer,
  canvasCfg: CanvasConfig,
  flags: MirrorFlags,
): void {
  _mirrorTargetCount = 0;
  _scratchSymmetry.h = false;
  _scratchSymmetry.v = false;
  _scratchSymmetry.d1 = false;
  _scratchSymmetry.d2 = false;

  const count = CELL_COUNTS[layer.level];
  const cellsPerL0 = 32 / count;
  const doL0X = canvasCfg.originL0X ?? 0;
  const doL0Y = canvasCfg.originL0Y ?? 0;
  const dwL0 = canvasCfg.widthL0;
  const dhL0 = canvasCfg.heightL0;
  // Canvas-relative origin for this layer: which layer cell contains the
  // canvas origin point.
  const ocx = Math.floor(doL0X * count / 32);
  const ocy = Math.floor(doL0Y * count / 32);
  const relX = cellX - ocx;
  const relY = cellY - ocy;

  // Pixel-based mirror axis (canvas-relative). Used for rotation /
  // diagonal math where the axis needs to be a continuous coordinate.
  const cx2 = (2 * doL0X + dwL0) / cellsPerL0 - 2 * ocx - 2 * layer.shiftX - 1;
  const cy2 = (2 * doL0Y + dhL0) / cellsPerL0 - 2 * ocy - 2 * layer.shiftY - 1;

  // Cell-window-based mirror axis: leftmost+rightmost cell indices in
  // canvas-relative coords. For partial canvases (widthL0 not divisible
  // by cell size, or non-cell-aligned origin) this matters — pixel
  // midpoint math snaps via floor and orphans partial-edge cells.
  const sL0X = layer.shiftX * cellsPerL0;
  const sL0Y = layer.shiftY * cellsPerL0;
  const absStartCellX = Math.floor((doL0X - sL0X) / cellsPerL0);
  const absStartCellY = Math.floor((doL0Y - sL0Y) / cellsPerL0);
  const absEndCellX = Math.min(count, Math.ceil((doL0X + dwL0 - sL0X) / cellsPerL0));
  const absEndCellY = Math.min(count, Math.ceil((doL0Y + dhL0 - sL0Y) / cellsPerL0));
  const absLeftmostX = (layer.shiftX === 0.5 && absStartCellX <= -1) ? -1 : Math.max(0, absStartCellX);
  const absLeftmostY = (layer.shiftY === 0.5 && absStartCellY <= -1) ? -1 : Math.max(0, absStartCellY);
  const cellCx2 = (absLeftmostX - ocx) + (absEndCellX - 1 - ocx);
  const cellCy2 = (absLeftmostY - ocy) + (absEndCellY - 1 - ocy);

  // Editable-cell counts (origin-oblivious). Used by the diag / quad /
  // row / col branches for diagDim/qw/qh offset math. Matches the
  // editableCells helper the production paint code passes in.
  const maxCellX = Math.ceil(dwL0 * count / 32);
  const maxCellY = Math.ceil(dhL0 * count / 32);

  // Bounds + dedup + self-target → symmetry capture. The buffer holds
  // only non-primary, non-duplicate, in-bounds targets; self-targets
  // accumulate axis flags into `_scratchSymmetry` instead.
  const addTarget = (
    mx: number, my: number,
    mH: boolean, mV: boolean,
    rot: 0 | 90 | 180 | 270,
  ): void => {
    if (mx < absLeftmostX || mx >= absEndCellX || my < absLeftmostY || my >= absEndCellY) return;
    if (mx >= count || my >= count) return;
    if (mx === cellX && my === cellY) {
      // Cell sits on this op's axis — capture which axis(es) for the
      // symmetry consumer. Self-targets are never written to the buffer
      // (paint would no-op on its own primary cell anyway).
      if (mH) _scratchSymmetry.h = true;
      if (mV) _scratchSymmetry.v = true;
      if (rot === 270) _scratchSymmetry.d1 = true;
      else if (rot === 90) _scratchSymmetry.d2 = true;
      else if (rot !== 0) { _scratchSymmetry.h = true; _scratchSymmetry.v = true; }
      return;
    }
    // Linear dedup against existing buffer entries. Buffer size <= 16 so
    // this stays cheaper than Set allocation.
    for (let i = 0; i < _mirrorTargetCount; i++) {
      const e = _mirrorTargets[i];
      if (e.x === mx && e.y === my) return;
    }
    const s = _mirrorTargets[_mirrorTargetCount++];
    s.x = mx; s.y = my; s.mH = mH; s.mV = mV; s.rot = rot;
  };

  if (flags.mirrorStar) {
    // 8-fold D4 symmetry. Priority: the 8 cells must be H/V/180 symmetric
    // as a whole, so place the 4 "diagonal" cells at the H/V mirror
    // positions of the / diag instead of computing each rotation /
    // diagonal independently. For square canvases this is identical to
    // the original D4 layout; for non-square canvases this gives a star
    // pattern that's symmetric about both axes (which the prior layout
    // wasn't — diagonals and 90° rotations landed at asymmetric cells).
    //
    // Op mapping (derived by brute-force against the desired transforms):
    //   / diag         → (mH=T, mV=F, rot=90)
    //   H mirror of /  → (mH=F, mV=F, rot=270)
    //   V mirror of /  → (mH=F, mV=F, rot=90)
    //   180   of /     → (mH=T, mV=F, rot=270)
    const mhX = cellCx2 - relX;
    const mvY = cellCy2 - relY;
    addTarget(mhX + ocx, relY + ocy, true, false, 0);            // H mirror
    addTarget(relX + ocx, mvY + ocy, false, true, 0);            // V mirror
    addTarget(mhX + ocx, mvY + ocy, false, false, 180);          // 180

    // Diag partner: reflect the primary cell's L0 center through the
    // canvas H/V crossing point — the same pivot the overlay's H and V
    // lines pass through. This keeps the diag visually meeting the H/V
    // crossing on every canvas, including those whose L0 width or
    // height doesn't divide cleanly into the active layer's cell size
    // (e.g. 11x13 at L2/L3, where the cell-window midpoint drifts off
    // canvas geometric center but the diag still has to meet H/V at
    // *that* drifted point). Equivalent to the prior L0-square pivot
    // for divisible canvases, so the 12x14 shifted-layer fix from the
    // earlier commit is preserved.
    const pivotL0X = ((cellCx2 + 1) / 2 + ocx + layer.shiftX) * cellsPerL0;
    const pivotL0Y = ((cellCy2 + 1) / 2 + ocy + layer.shiftY) * cellsPerL0;
    const primL0X = (cellX + layer.shiftX + 0.5) * cellsPerL0;
    const primL0Y = (cellY + layer.shiftY + 0.5) * cellsPerL0;
    const sumL0 = pivotL0X + pivotL0Y;
    const diagL0X = sumL0 - primL0Y;
    const diagL0Y = sumL0 - primL0X;
    const diagAbsX = Math.round(diagL0X / cellsPerL0 - layer.shiftX - 0.5);
    const diagAbsY = Math.round(diagL0Y / cellsPerL0 - layer.shiftY - 0.5);
    const diagX = diagAbsX - ocx;
    const diagY = diagAbsY - ocy;
    const diagMhX = cellCx2 - diagX;
    const diagMvY = cellCy2 - diagY;
    addTarget(diagX + ocx, diagY + ocy, true, false, 90);                  // / diag
    addTarget(diagMhX + ocx, diagY + ocy, false, false, 270);              // H mirror of /
    addTarget(diagX + ocx, diagMvY + ocy, false, false, 90);               // V mirror of /
    addTarget(diagMhX + ocx, diagMvY + ocy, true, false, 270);             // 180  of /
  } else if (flags.mirrorQuad) {
    if (maxCellX < 4 || maxCellY < 4) {
      // Fallback H+V on small canvases.
      const mhX = cellCx2 - relX;
      const mvY = cellCy2 - relY;
      addTarget(mhX + ocx, relY + ocy, true, false, 0);
      addTarget(relX + ocx, mvY + ocy, false, true, 0);
      addTarget(mhX + ocx, mvY + ocy, true, true, 0);
    } else {
      const qw = Math.floor(maxCellX / 2);
      const qh = Math.floor(maxCellY / 2);
      const qx = relX < qw ? relX : relX - qw;
      const qy = relY < qh ? relY : relY - qh;
      const mqx = qw - 1 - qx;
      const mqy = qh - 1 - qy;
      for (let qi = 0; qi < 4; qi++) {
        const ox = (qi & 1) ? qw : 0;
        const oy = (qi & 2) ? qh : 0;
        const qH = (qi & 1) !== 0;
        const qV = (qi & 2) !== 0;
        for (let li = 0; li < 4; li++) {
          const lx = ((li & 1) !== 0) !== qH ? mqx : qx;
          const ly = ((li & 2) !== 0) !== qV ? mqy : qy;
          const lH = (li & 1) !== 0;
          const lV = (li & 2) !== 0;
          const tx = lx + ox;
          const ty = ly + oy;
          addTarget(tx + ocx, ty + ocy, lH !== qH, lV !== qV, 0);
        }
      }
    }
  } else if (flags.mirrorRow || flags.mirrorCol) {
    if (maxCellX < 4 || maxCellY < 4) {
      if (flags.mirrorRow) {
        const mvY = cellCy2 - relY;
        addTarget(cellX, mvY + ocy, false, true, 0);
      } else {
        const mhX = cellCx2 - relX;
        addTarget(mhX + ocx, cellY, true, false, 0);
      }
    } else if (flags.mirrorRow) {
      const qh = Math.floor(maxCellY / 2);
      const qy = relY < qh ? relY : relY - qh;
      const mqy = qh - 1 - qy;
      for (let hi = 0; hi < 2; hi++) {
        const oy = hi * qh;
        const hV = hi !== 0;
        for (let li = 0; li < 2; li++) {
          const ly = (li !== 0) !== hV ? mqy : qy;
          const lV = li !== 0;
          const tx = relX;
          const ty = ly + oy;
          addTarget(tx + ocx, ty + ocy, false, lV !== hV, 0);
        }
      }
    } else {
      const qw = Math.floor(maxCellX / 2);
      const qx = relX < qw ? relX : relX - qw;
      const mqx = qw - 1 - qx;
      for (let hi = 0; hi < 2; hi++) {
        const ox = hi * qw;
        const hH = hi !== 0;
        for (let li = 0; li < 2; li++) {
          const lx = (li !== 0) !== hH ? mqx : qx;
          const lH = li !== 0;
          const tx = lx + ox;
          const ty = relY;
          addTarget(tx + ocx, ty + ocy, lH !== hH, false, 0);
        }
      }
    }
  } else if (flags.mirrorDiag1 || flags.mirrorDiag2 || flags.mirrorDiagBoth) {
    const diagDim = Math.min(maxCellX, maxCellY);
    const diagOffX = Math.floor((maxCellX - diagDim) / 2);
    const diagOffY = Math.floor((maxCellY - diagDim) / 2);
    const dx = relX - diagOffX;
    const dy = relY - diagOffY;
    if (flags.mirrorDiag1 || flags.mirrorDiagBoth) {
      addTarget(dy + diagOffX + ocx, dx + diagOffY + ocy, true, false, 270);
    }
    if (flags.mirrorDiag2 || flags.mirrorDiagBoth) {
      addTarget(diagDim - 1 - dy + diagOffX + ocx, diagDim - 1 - dx + diagOffY + ocy, true, false, 90);
    }
    if (flags.mirrorDiagBoth) {
      addTarget(diagDim - 1 - dx + diagOffX + ocx, diagDim - 1 - dy + diagOffY + ocy, false, false, 180);
    }
  } else if (flags.mirrorRotate) {
    const dx2 = 2 * relX - cx2;
    const dy2 = 2 * relY - cy2;
    addTarget(Math.round((cx2 - dy2) / 2) + ocx, Math.round((cy2 + dx2) / 2) + ocy, false, false, 90);
    // 180° rotation = H+V; cell-window axis so partial canvas-edge cells get partners.
    addTarget((cellCx2 - relX) + ocx, (cellCy2 - relY) + ocy, false, false, 180);
    addTarget(Math.round((cx2 + dy2) / 2) + ocx, Math.round((cy2 - dx2) / 2) + ocy, false, false, 270);
  } else {
    // Plain H / V / HV — cell-window axis so partial canvas-edge tiles
    // get symmetric partners.
    const mhX = cellCx2 - relX;
    const mvY = cellCy2 - relY;
    if (flags.mirrorH) addTarget(mhX + ocx, cellY, true, false, 0);
    if (flags.mirrorV) addTarget(cellX, mvY + ocy, false, true, 0);
    if (flags.mirrorH && flags.mirrorV) addTarget(mhX + ocx, mvY + ocy, true, true, 0);
  }
}

/**
 * Compute the mirror targets a paint at `(cellX, cellY)` should produce
 * given the canvas + layer geometry and the active mirror flags. Returns
 * a fresh array of in-bounds non-primary non-duplicate targets. Self-
 * targets (axis cells) are absorbed into the symmetry record instead.
 *
 * One-shot callers (tap-to-paint, draw tool, selection-op expansion,
 * tests) use this entry point. Per-cell hot-path callers (flood fill,
 * multires fill) should use {@link forEachMirrorTarget} to avoid the
 * per-call array allocation.
 */
export function computePaintMirrorTargets(
  cellX: number,
  cellY: number,
  layer: Layer,
  canvasCfg: CanvasConfig,
  flags: MirrorFlags,
): MirrorTarget[] {
  computeImpl(cellX, cellY, layer, canvasCfg, flags);
  const out: MirrorTarget[] = new Array(_mirrorTargetCount);
  for (let i = 0; i < _mirrorTargetCount; i++) {
    const s = _mirrorTargets[i];
    out[i] = { x: s.x, y: s.y, mH: s.mH, mV: s.mV, rot: s.rot };
  }
  return out;
}

/**
 * Visit each in-window mirror target of `(cellX, cellY)`. Consolidates the
 * `compute → iterate → bounds & partial-tile filter` boilerplate that every
 * flood-fill main loop used to open-code (a pattern that drifted in 4
 * places and produced the selection-center mirror bug). Allocate the
 * closure once per fill (at function scope) and update any per-cell
 * context via a captured mutable variable so the inner loop stays
 * allocation-free.
 */
export function forEachMirrorTarget(
  cellX: number, cellY: number,
  layer: Layer,
  canvasCfg: CanvasConfig,
  flags: MirrorFlags,
  window: MirrorCellWindow,
  partialTileCfg: CanvasConfig | null,
  fn: (tx: number, ty: number, mH: boolean, mV: boolean, rot: 0 | 90 | 180 | 270) => void,
): void {
  computeImpl(cellX, cellY, layer, canvasCfg, flags);
  for (let mi = 0; mi < _mirrorTargetCount; mi++) {
    const t = _mirrorTargets[mi];
    if (t.x < window.minCellX || t.x >= window.endCellX || t.y < window.minCellY || t.y >= window.endCellY) continue;
    if (partialTileCfg && !isCellFullyInsideCanvas(layer, t.x, t.y, partialTileCfg)) continue;
    fn(t.x, t.y, t.mH, t.mV, t.rot);
  }
}

/**
 * Detect whether `(cellX, cellY)` sits on one or more of the active mirror
 * axes, returning a {@link MirrorSymmetry} flag bag (or `undefined` when no
 * axis applies). Used by connectivity-aware fills to filter candidate
 * tiles down to those whose rendered signature respects the cell's
 * required symmetry.
 */
export function computeMirrorSymmetry(
  cellX: number, cellY: number,
  layer: Layer,
  canvasCfg: CanvasConfig,
  flags: MirrorFlags,
): MirrorSymmetry | undefined {
  computeImpl(cellX, cellY, layer, canvasCfg, flags);
  const s = _scratchSymmetry;
  if (!s.h && !s.v && !s.d1 && !s.d2) return undefined;
  return { h: s.h, v: s.v, d1: s.d1, d2: s.d2 };
}

/**
 * Mirror targets over a PLAIN cell window — {@link computeImpl}'s math with
 * the layer machinery stripped away: no Layer, no CanvasConfig, no 32-cell
 * clamp. The window is `[0, width) × [0, height)` in whatever cell unit the
 * caller works in, origin-aligned and unshifted; `(cellX, cellY)` is the
 * painted cell in those units.
 *
 * This exists for hosts whose painting surface is not a layer grid — a
 * composition canvas mirroring stamps about a stored symmetry frame, say —
 * where the window can be any size (the layer entry points top out at the
 * L0 grid's 32 cells) and cells may sit at fractional offsets when the
 * host's grid has moved since the frame was chosen. The branch bodies are
 * kept line-for-line with computeImpl (with ocx/ocy = 0, shiftX/Y = 0,
 * cellsPerL0 = 1 folded through), so the two cannot drift semantically —
 * the paintMirror agreement suite pins them to each other on windows both
 * can express.
 *
 * UNLIKE computeImpl, the window does not CLIP: on an unbounded canvas the
 * window's job is to place the axes (and quad/row/col's block structure),
 * not to fence the mirrored area, so cells and their partners may lie
 * anywhere — a paint far outside still reflects about the same axes. The
 * center-axis modes (H/V, rotate, the diagonals, star) extrapolate
 * exactly; quad, row and col — whose within-half translation structure
 * only exists inside the window's 2×2 (or 2×1) block grid — fall back to
 * their plain center mirror for cells outside it.
 *
 * Returns fresh arrays (this is a tap-time API, not the 120 Hz fill path)
 * plus the axis-membership record a self-targeting cell accumulates —
 * exactly what {@link computeMirrorSymmetry} reports, so connectivity picks
 * can demand self-symmetric tiles on axis cells.
 */
export function computeBoxMirrorTargets(
  cellX: number,
  cellY: number,
  width: number,
  height: number,
  flags: MirrorFlags,
): { targets: MirrorTarget[]; symmetry: MirrorSymmetry | undefined } {
  const targets: MirrorTarget[] = [];
  const self: MirrorSymmetry = { h: false, v: false, d1: false, d2: false };

  const endX = Math.ceil(width);
  const endY = Math.ceil(height);
  // Pixel axis (continuous) and cell-window axis — identical for integer
  // windows, exactly as in computeImpl.
  const cx2 = width - 1;
  const cy2 = height - 1;
  const cellCx2 = endX - 1;
  const cellCy2 = endY - 1;
  const maxCellX = endX;
  const maxCellY = endY;

  const addTarget = (
    mx: number, my: number,
    mH: boolean, mV: boolean,
    rot: 0 | 90 | 180 | 270,
  ): void => {
    // Deliberately NO window clip — see the doc comment: the window
    // places the axes, it does not fence the mirrored area.
    if (mx === cellX && my === cellY) {
      if (mH) self.h = true;
      if (mV) self.v = true;
      if (rot === 270) self.d1 = true;
      else if (rot === 90) self.d2 = true;
      else if (rot !== 0) { self.h = true; self.v = true; }
      return;
    }
    for (let i = 0; i < targets.length; i++) {
      if (targets[i].x === mx && targets[i].y === my) return;
    }
    targets.push({ x: mx, y: my, mH, mV, rot });
  };

  if (flags.mirrorStar) {
    const mhX = cellCx2 - cellX;
    const mvY = cellCy2 - cellY;
    addTarget(mhX, cellY, true, false, 0);
    addTarget(cellX, mvY, false, true, 0);
    addTarget(mhX, mvY, false, false, 180);
    const pivotX = (cellCx2 + 1) / 2;
    const pivotY = (cellCy2 + 1) / 2;
    const primX = cellX + 0.5;
    const primY = cellY + 0.5;
    const sum = pivotX + pivotY;
    const diagX = Math.round(sum - primY - 0.5);
    const diagY = Math.round(sum - primX - 0.5);
    const diagMhX = cellCx2 - diagX;
    const diagMvY = cellCy2 - diagY;
    addTarget(diagX, diagY, true, false, 90);
    addTarget(diagMhX, diagY, false, false, 270);
    addTarget(diagX, diagMvY, false, false, 90);
    addTarget(diagMhX, diagMvY, true, false, 270);
  } else if (flags.mirrorQuad) {
    if (maxCellX < 4 || maxCellY < 4) {
      const mhX = cellCx2 - cellX;
      const mvY = cellCy2 - cellY;
      addTarget(mhX, cellY, true, false, 0);
      addTarget(cellX, mvY, false, true, 0);
      addTarget(mhX, mvY, true, true, 0);
    } else if (
      cellX < 0 || cellX >= maxCellX || cellY < 0 || cellY >= maxCellY
    ) {
      // Outside the window the quadrant structure does not exist — the
      // center axes still do, so fall back to H+V.
      const mhX = cellCx2 - cellX;
      const mvY = cellCy2 - cellY;
      addTarget(mhX, cellY, true, false, 0);
      addTarget(cellX, mvY, false, true, 0);
      addTarget(mhX, mvY, true, true, 0);
    } else {
      const qw = Math.floor(maxCellX / 2);
      const qh = Math.floor(maxCellY / 2);
      const qx = cellX < qw ? cellX : cellX - qw;
      const qy = cellY < qh ? cellY : cellY - qh;
      const mqx = qw - 1 - qx;
      const mqy = qh - 1 - qy;
      for (let qi = 0; qi < 4; qi++) {
        const ox = (qi & 1) ? qw : 0;
        const oy = (qi & 2) ? qh : 0;
        const qH = (qi & 1) !== 0;
        const qV = (qi & 2) !== 0;
        for (let li = 0; li < 4; li++) {
          const lx = ((li & 1) !== 0) !== qH ? mqx : qx;
          const ly = ((li & 2) !== 0) !== qV ? mqy : qy;
          const lH = (li & 1) !== 0;
          const lV = (li & 2) !== 0;
          addTarget(lx + ox, ly + oy, lH !== qH, lV !== qV, 0);
        }
      }
    }
  } else if (flags.mirrorRow || flags.mirrorCol) {
    if (maxCellX < 4 || maxCellY < 4) {
      if (flags.mirrorRow) {
        addTarget(cellX, cellCy2 - cellY, false, true, 0);
      } else {
        addTarget(cellCx2 - cellX, cellY, true, false, 0);
      }
    } else if (flags.mirrorRow && (cellY < 0 || cellY >= maxCellY)) {
      // Outside the window the within-half structure does not exist — the
      // center axis still does (same rule as quad above).
      addTarget(cellX, cellCy2 - cellY, false, true, 0);
    } else if (flags.mirrorCol && (cellX < 0 || cellX >= maxCellX)) {
      addTarget(cellCx2 - cellX, cellY, true, false, 0);
    } else if (flags.mirrorRow) {
      const qh = Math.floor(maxCellY / 2);
      const qy = cellY < qh ? cellY : cellY - qh;
      const mqy = qh - 1 - qy;
      for (let hi = 0; hi < 2; hi++) {
        const oy = hi * qh;
        const hV = hi !== 0;
        for (let li = 0; li < 2; li++) {
          const ly = (li !== 0) !== hV ? mqy : qy;
          const lV = li !== 0;
          addTarget(cellX, ly + oy, false, lV !== hV, 0);
        }
      }
    } else {
      const qw = Math.floor(maxCellX / 2);
      const qx = cellX < qw ? cellX : cellX - qw;
      const mqx = qw - 1 - qx;
      for (let hi = 0; hi < 2; hi++) {
        const ox = hi * qw;
        const hH = hi !== 0;
        for (let li = 0; li < 2; li++) {
          const lx = (li !== 0) !== hH ? mqx : qx;
          const lH = li !== 0;
          addTarget(lx + ox, cellY, lH !== hH, false, 0);
        }
      }
    }
  } else if (flags.mirrorDiag1 || flags.mirrorDiag2 || flags.mirrorDiagBoth) {
    const diagDim = Math.min(maxCellX, maxCellY);
    const diagOffX = Math.floor((maxCellX - diagDim) / 2);
    const diagOffY = Math.floor((maxCellY - diagDim) / 2);
    const dx = cellX - diagOffX;
    const dy = cellY - diagOffY;
    if (flags.mirrorDiag1 || flags.mirrorDiagBoth) {
      addTarget(dy + diagOffX, dx + diagOffY, true, false, 270);
    }
    if (flags.mirrorDiag2 || flags.mirrorDiagBoth) {
      addTarget(diagDim - 1 - dy + diagOffX, diagDim - 1 - dx + diagOffY, true, false, 90);
    }
    if (flags.mirrorDiagBoth) {
      addTarget(diagDim - 1 - dx + diagOffX, diagDim - 1 - dy + diagOffY, false, false, 180);
    }
  } else if (flags.mirrorRotate) {
    const dx2 = 2 * cellX - cx2;
    const dy2 = 2 * cellY - cy2;
    addTarget(Math.round((cx2 - dy2) / 2), Math.round((cy2 + dx2) / 2), false, false, 90);
    addTarget(cellCx2 - cellX, cellCy2 - cellY, false, false, 180);
    addTarget(Math.round((cx2 + dy2) / 2), Math.round((cy2 - dx2) / 2), false, false, 270);
  } else {
    const mhX = cellCx2 - cellX;
    const mvY = cellCy2 - cellY;
    if (flags.mirrorH) addTarget(mhX, cellY, true, false, 0);
    if (flags.mirrorV) addTarget(cellX, mvY, false, true, 0);
    if (flags.mirrorH && flags.mirrorV) addTarget(mhX, mvY, true, true, 0);
  }

  // Same rule as computeMirrorSymmetry: only a record with a named axis
  // counts — a self-target with no axis flag (quad's own quadrant slot,
  // say) is not symmetry the caller can act on.
  const any = self.h || self.v || self.d1 || self.d2;
  return { targets, symmetry: any ? self : undefined };
}
