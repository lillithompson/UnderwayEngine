import type { Camera, CompositionState, PatternSymmetry, Viewport } from '@/engine/types';
import { PATTERN_SYMMETRY_OFF } from '@/engine/types';
import { computeBoxMirrorTargets, type MirrorTarget } from '@/engine/paintMirror';
import type { MirrorSymmetry } from '@/engine/connectivity';
import { compSnapStep } from '@/engine/compositionCellMath';
import { screenToWorld } from './cameraMath';
import { drawnBox } from './transformGestures';
import type { CellBbox } from './resizeMath';
import { patternSymmetryEqual } from './editorSession';

// ── Canvas-level symmetry (the Free Play Symmetry control) ──────────
// The Facet tile editor's mirror feature, ported to the composition
// canvas: a toolbar button (press cycles Off → H → H+V → V, long press
// opens the mode modal), axis lines drawn over the page, and Tile-tool
// stamps mirrored about the axes.
//
// Facet derives its axes from the canvas — a bounded grid whose center is
// simply the canvas center. The composition page has no such bound, so the
// missing piece is a FRAME: chosen from the visible view at the moment
// symmetry toggles on, its center snapped to the half-step lattice of the
// current grid (the axis bisects a grid cell or rides an edge — the same
// two positions Facet's axes take), then FIXED. Panning afterwards moves
// the view, not the axes; toggling off and on again picks a fresh frame.
// The frame PLACES the axes — it does not fence them: a stamp anywhere on
// the canvas, however far the view has moved, mirrors about the same
// origin. Its extent matters only to quad / row / col, whose within-half
// block structure exists inside it (outside, they keep their center
// mirror), and to the quarter lines the overlay draws for those modes.
//
// All mirror-partner math is the engine's own computeBoxMirrorTargets —
// computeImpl with the layer machinery stripped — so the ten modes behave
// cell-for-cell as Facet's do on a canvas of the frame's size.

/**
 * The mirror a pattern paints under: its OWN stored mode, or undefined
 * when it has none.
 *
 * A pattern's symmetry is a property of the object, set on its Symmetry
 * property page like every other thing about it, and it is the ONLY mirror
 * its grid answers to. The toolbar's Symmetry menu is the canvas mirror —
 * it moves vectors, paint dabs and stamps laid outside any grid — and it
 * neither writes itself onto a selected pattern nor reads that pattern's
 * mode back onto itself. (It did both until 2026-09-19: the toolbar was
 * the pattern's symmetry UI, so the menu flapped with the selection and
 * picking a canvas mirror silently rewrote the grid in hand.)
 *
 * Undefined for anything that is not a pattern.
 */
export function patternOwnSymmetry(
  item: { symmetry?: PatternSymmetry } | null | undefined,
): PatternSymmetry | undefined {
  const flags = item?.symmetry;
  return canvasSymmetryOn(flags) ? flags : undefined;
}

/** Whether a flag set means symmetry is ON at all. */
export function canvasSymmetryOn(flags: PatternSymmetry | undefined): boolean {
  if (!flags) return false;
  return flags.mirrorH || flags.mirrorV || flags.mirrorRotate || flags.mirrorQuad
    || flags.mirrorRow || flags.mirrorCol || flags.mirrorDiag1 || flags.mirrorDiag2
    || flags.mirrorDiagBoth || flags.mirrorStar;
}

// ── The toolbar's symmetry mode menu ────────────────────────────────
// The symmetry button behaves like the other tool groups: a tap opens a
// floating mode capsule (ToolModeCapsule, None leading) instead of
// cycling, and the capsule dismisses on a canvas press or any other tool.
// The offered set is the curated five — None, H, V, HV, Star (Quad was
// retired from the capsule; it lives on in the full modal, and a page
// saved under it still mirrors by it — see symmetryMenuKeyOf).

export type SymmetryMenuKey =
  | 'none' | 'h' | 'v' | 'hv' | 'star';

export const SYMMETRY_MENU_MODES: readonly {
  key: SymmetryMenuKey;
  label: string;
  flags: PatternSymmetry | undefined;
}[] = [
  { key: 'none', label: 'None', flags: undefined },
  { key: 'h', label: 'H', flags: { ...PATTERN_SYMMETRY_OFF, mirrorH: true } },
  { key: 'v', label: 'V', flags: { ...PATTERN_SYMMETRY_OFF, mirrorV: true } },
  { key: 'hv', label: 'HV', flags: { ...PATTERN_SYMMETRY_OFF, mirrorH: true, mirrorV: true } },
  { key: 'star', label: 'Star', flags: { ...PATTERN_SYMMETRY_OFF, mirrorStar: true } },
];

/** The menu row's label for a key. */
export function symmetryMenuLabel(key: SymmetryMenuKey): string {
  return SYMMETRY_MENU_MODES.find((m) => m.key === key)?.label ?? 'None';
}

/** The flags a menu pick sets (None clears them). */
export function symmetryMenuFlags(key: SymmetryMenuKey): PatternSymmetry | undefined {
  const flags = SYMMETRY_MENU_MODES.find((m) => m.key === key)?.flags;
  return flags ? { ...flags } : undefined;
}

/** The menu key the CURRENT flags light — 'none' when the mirror is off,
 *  and also for any stored mode the menu no longer offers (a page saved
 *  under a retired mode still mirrors by it; the menu just has no segment
 *  to light for it, so nothing is claimed). */
export function symmetryMenuKeyOf(flags: PatternSymmetry | undefined): SymmetryMenuKey {
  if (!canvasSymmetryOn(flags)) return 'none';
  for (const m of SYMMETRY_MENU_MODES) {
    if (m.flags && patternSymmetryEqual(m.flags, flags)) return m.key;
  }
  return 'none';
}

/** The MaterialCommunityIcons glyph the toolbar button wears for a flag
 *  set — Facet's priority chain, one glyph per mode (`mirrorIcon` marks
 *  the one glyph drawn flipped, Diag \'s). Off shares H's glyph, unlit. */
export function symmetryToolbarIcon(
  flags: PatternSymmetry | undefined,
): { icon: string; mirrorIcon?: boolean } {
  if (flags?.mirrorStar) return { icon: 'star-four-points-outline' };
  if (flags?.mirrorRow) return { icon: 'table-column' };
  if (flags?.mirrorCol) return { icon: 'table-row' };
  if (flags?.mirrorDiagBoth) return { icon: 'close-thick' };
  if (flags?.mirrorDiag2) return { icon: 'arrow-top-right-bottom-left' };
  if (flags?.mirrorDiag1) return { icon: 'arrow-top-right-bottom-left', mirrorIcon: true };
  if (flags?.mirrorQuad) return { icon: 'view-grid' };
  if (flags?.mirrorRotate) return { icon: 'rotate-right' };
  if (flags?.mirrorH && flags?.mirrorV) return { icon: 'arrow-all' };
  if (flags?.mirrorV) return { icon: 'flip-vertical' };
  return { icon: 'flip-horizontal' };
}

// ── The frame ───────────────────────────────────────────────────────

/** Whole-step counts must share the center's lattice parity so the frame's
 *  EDGES land on the grid proper (see pickSymmetryFrame). */
const parityMatched = (steps: number, c2: number): number =>
  (steps & 1) === (((c2 % 2) + 2) % 2) ? steps : steps + 1;

/** Modes whose orbit carries a 45° axis or a quarter turn. For these the
 *  frame's TWO center coordinates must share half-step parity: a diagonal
 *  reflection (or 90° turn) about a mixed-parity center sends every cell
 *  center to a lattice corner, so no stamp has a cell to land in — the
 *  engine could only snap the axis half a cell off the drawn line, and
 *  partners came out one cell wrong of the mirror the overlay showed.
 *  H/V axes act per-coordinate and never meet this: each may bisect a
 *  cell or ride an edge independently. */
export function symmetryNeedsUniformCenter(flags: PatternSymmetry | undefined): boolean {
  return !!flags && !!(flags.mirrorDiag1 || flags.mirrorDiag2 || flags.mirrorDiagBoth
    || flags.mirrorStar || flags.mirrorRotate);
}

/** `c2y` nudged onto `c2x`'s parity when `uniform` demands it — to the
 *  matching half-step nearest the RAW center (`cyHalf` = cy / half). */
function uniformC2Y(c2x: number, c2y: number, cyHalf: number, uniform: boolean): number {
  if (!uniform || ((c2x ^ c2y) & 1) === 0) return c2y;
  return c2y + (cyHalf >= c2y ? 1 : -1);
}

/** The frame around a half-lattice center (`c2x`/`c2y` in half-steps),
 *  sized to `wCells`×`hCells` rounded to whole steps — at least the 4 the
 *  quad modes need — with the parity rule applied. */
function frameAroundCenter(
  c2x: number, c2y: number, wCells: number, hCells: number, step: number,
): CellBbox {
  const half = step / 2;
  const wSteps = parityMatched(Math.max(4, Math.round(wCells / step)), c2x);
  const hSteps = parityMatched(Math.max(4, Math.round(hCells / step)), c2y);
  return {
    cellX: c2x * half - wSteps * half,
    cellY: c2y * half - hSteps * half,
    cellWidth: wSteps * step,
    cellHeight: hSteps * step,
  };
}

/**
 * Pick the symmetry frame from the CURRENT view — or, with something
 * selected, from that: centered on the selection's centre (else the visible
 * one) snapped to the half-step lattice (so the axis bisects a grid cell
 * or rides an edge), sized to the view rounded to whole grid steps. The
 * step parity is matched to the center's lattice position so the frame's
 * EDGES land on the grid proper — a center mid-cell gets an odd step
 * count, a center on an edge an even one — which is what keeps every
 * mirrored stamp grid-aligned.
 */
export function pickSymmetryFrame(
  camera: Camera,
  viewport: Viewport,
  gridLevel: number,
  /** The selection's box, when there is one: the axes land on ITS centre
   *  rather than the view's. Turning the mirror on with something selected
   *  is asking to mirror THAT — a view-centred axis would cut wherever the
   *  page happened to be scrolled to and put the reflection somewhere the
   *  object has nothing to do with. The frame keeps the view's SIZE either
   *  way: the axes run canvas-wide (symmetryAxesScreen), so the size only
   *  sets the within-half quarter lines of the block modes. */
  around?: CellBbox,
  /** The mode the frame will serve: diagonal / rotational modes need the
   *  two center coordinates on ONE parity (symmetryNeedsUniformCenter). */
  flags?: PatternSymmetry,
): CellBbox {
  const step = compSnapStep(gridLevel);
  const half = step / 2;
  const tl = screenToWorld(0, 0, camera, viewport);
  const br = screenToWorld(viewport.width, viewport.height, camera, viewport);
  // Center of the selection if there is one, else of the view — in
  // half-steps of the current grid.
  const cx = around ? around.cellX + around.cellWidth / 2 : (tl.cellX + br.cellX) / 2;
  const cy = around ? around.cellY + around.cellHeight / 2 : (tl.cellY + br.cellY) / 2;
  const c2x = Math.round(cx / half);
  const c2y = uniformC2Y(
    c2x, Math.round(cy / half), cy / half, symmetryNeedsUniformCenter(flags),
  );
  return frameAroundCenter(
    c2x, c2y,
    br.cellX - tl.cellX, br.cellY - tl.cellY, step,
  );
}

/**
 * Re-validate the frame for a NEW grid level: the axes must still land on
 * an edge of the new grid or perfectly bisect one of its cells (the
 * half-step lattice), and the frame's edges must sit on the grid proper.
 * A finer grid always contains the old lattice, so the frame passes
 * through untouched; a coarser one may not — then the center snaps to the
 * nearest valid position and the frame rebuilds around it at its old
 * size. Called on every grid-level change.
 */
export function resnapSymmetryFrame(
  frame: CellBbox,
  gridLevel: number,
  /** The active mode: diagonal / rotational modes additionally demand ONE
   *  parity across the two center coordinates (symmetryNeedsUniformCenter)
   *  — a frame planted for H/V and switched to a diagonal re-snaps here. */
  flags?: PatternSymmetry,
): CellBbox {
  const step = compSnapStep(gridLevel);
  const half = step / 2;
  const eps = step * 1e-9;
  const cx = frame.cellX + frame.cellWidth / 2;
  const cy = frame.cellY + frame.cellHeight / 2;
  const uniform = symmetryNeedsUniformCenter(flags);
  const c2x = Math.round(cx / half);
  const c2y = uniformC2Y(c2x, Math.round(cy / half), cy / half, uniform);
  const valid = Math.abs(cx - c2x * half) <= eps
    && Math.abs(cy - c2y * half) <= eps
    && Math.abs(frame.cellX / step - Math.round(frame.cellX / step)) <= eps
    && Math.abs(frame.cellWidth / step - Math.round(frame.cellWidth / step)) <= eps
    && Math.abs(frame.cellY / step - Math.round(frame.cellY / step)) <= eps
    && Math.abs(frame.cellHeight / step - Math.round(frame.cellHeight / step)) <= eps;
  if (valid) return frame;
  return frameAroundCenter(c2x, c2y, frame.cellWidth, frame.cellHeight, step);
}

// ── Mirrored stamps ─────────────────────────────────────────────────

/** A canvas symmetry setting as painting consumes it: the mode flags plus
 *  the frame they mirror within. */
export interface CanvasSymmetrySpec {
  flags: PatternSymmetry;
  frame: CellBbox;
  /** Set when the mirror is scoped to ONE pattern object — the selected
   *  one (see canvasSymmetrySpecOf): `frame` is then that pattern's own
   *  box, the axes sit on its centre and stop at its edges, and the
   *  symmetry applies to that pattern ALONE: tile stamps mirror inside
   *  its grid and nowhere else, and the canvas-wide consumers — vector
   *  copies of a drawn shape, paint dabs, the reflection of a move — stand
   *  down (canvasWideSymmetry). */
  only?: string;
  /** The turn the scoped pattern is DRAWN at, degrees CW about `frame`'s
   *  centre (absent for none): the axes turn with the grid they mirror
   *  within. One continuous turn off the graph, not the legacy model's
   *  quarter channel plus free angle. */
  angleDeg?: number;
}

/** The composition's symmetry setting as one spec, or undefined when the
 *  mirror is off (or the frame was never picked). The single reading every
 *  consumer — tile stamps, paint dabs, vector copies, edit reflection —
 *  shares.
 *
 *  With a PATTERN object selected (`selectedId`), the mirror is that
 *  pattern's ENTIRELY — its own stored flags (patternOwnSymmetry), about
 *  its own box, with `only` naming it. A selected pattern is the thing
 *  being worked on — the tile tool and the pattern brush both edit its grid
 *  — so the mirror it paints under is the one set on its Symmetry page, and
 *  a frame planted wherever the view happened to be would put the partners
 *  outside the very object in hand. The canvas mirror does not reach into a
 *  grid, and a grid's does not reach out of it: a pattern with no symmetry
 *  of its own paints unmirrored however the toolbar stands.
 *
 *  Any other selection (or none) is the canvas mirror on the canvas frame. */
export function canvasSymmetrySpecOf(
  state: CompositionState,
  selectedId?: string | null,
): CanvasSymmetrySpec | undefined {
  const pattern = selectedId ? (state.patternObjects ?? []).find((p) => p.id === selectedId) : undefined;
  // The pattern as it is DRAWN: its own grid through its world matrix
  // (transformGestures.drawnBox), so the axes sit on the centre the cells
  // are actually mirrored about and lean at the angle they are drawn at.
  // The legacy box and `angleDeg` said neither: a pattern spells a quarter
  // turn in a channel of its own, so a pattern turned 90 kept upright axes,
  // and inside a bound group the box is the group's word, not the grid's.
  const drawn = pattern && !pattern.hidden ? drawnBox(state, pattern.id) : null;
  if (pattern && drawn) {
    const flags = patternOwnSymmetry(pattern);
    if (!flags) return undefined;
    return {
      flags, frame: drawn.bbox, only: pattern.id,
      ...(drawn.angleDeg ? { angleDeg: drawn.angleDeg } : null),
    };
  }
  if (!canvasSymmetryOn(state.symmetry)) return undefined;
  return state.symmetryFrame
    ? { flags: state.symmetry!, frame: state.symmetryFrame }
    : undefined;
}

/**
 * Does a scoped mirror DRAW its axes? A pattern in repeat mode does not.
 *
 * Repeat fills the pattern's box with copies of one tile, so the box on
 * screen is not one grid but many. The axes belong to the source grid —
 * one pair, on the box's centre, running its full width and height — and
 * laid over a repeating region they read as lines ruled across every copy,
 * naming a centre none of them has.
 *
 * The MIRROR itself stands: stamps still land in their orbits, the flags
 * are untouched. Only the drawing goes.
 */
export function symmetryAxesShown(
  spec: CanvasSymmetrySpec | undefined,
  patternObjects: readonly { id: string; tileMode?: string }[] | undefined,
): boolean {
  if (!spec) return false;
  if (!spec.only) return true;
  return (patternObjects ?? []).find((p) => p.id === spec.only)?.tileMode !== 'repeat';
}

/**
 * The axes a spec draws, or null when it draws none — the ONE reading the
 * canvas builds its overlay from, whether it is rendering the committed
 * state or riding a drag (`frame` overrides the spec's own box for the
 * live preview).
 */
export function symmetryOverlayFor(
  spec: CanvasSymmetrySpec | undefined,
  patternObjects: readonly { id: string; tileMode?: string }[] | undefined,
  gridLevel: number,
  frame?: CellBbox,
): SymmetryOverlayModel | null {
  if (!symmetryAxesShown(spec, patternObjects)) return null;
  return symmetryOverlayModel(spec!.flags, frame ?? spec!.frame, gridLevel, !!spec!.only, spec!.angleDeg);
}

/** The spec for the consumers that mirror the CANVAS — a drawn shape's
 *  copies, a raster dab's orbit, the reflection of a moved object: the
 *  spec as given, or undefined while it is scoped to one pattern. */
export function canvasWideSymmetry(spec: CanvasSymmetrySpec | undefined): CanvasSymmetrySpec | undefined {
  return spec && !spec.only ? spec : undefined;
}

/** Is the grid cell at (`x`, `y`) — its origin — inside `frame`? */
function cellInFrame(x: number, y: number, step: number, frame: CellBbox): boolean {
  const eps = step * 1e-6;
  return x >= frame.cellX - eps && x + step <= frame.cellX + frame.cellWidth + eps
    && y >= frame.cellY - eps && y + step <= frame.cellY + frame.cellHeight + eps;
}

export interface CanvasSymmetryStamp {
  /** World-cell origin of the partner's grid cell. */
  x: number;
  y: number;
  mH: boolean;
  mV: boolean;
  rot: 0 | 90 | 180 | 270;
}

/**
 * The mirror partners of a stamp whose grid cell starts at (`x`, `y`) and
 * spans `step`, about `spec`'s frame — plus the axis-membership record
 * when the stamp sits ON an axis (the pick is then constrained to
 * self-symmetric tiles, as the pattern grid's own brush is). The frame
 * places the axes without fencing them: stamps and partners may lie
 * anywhere on the canvas.
 */
export function canvasSymmetryStamps(
  x: number,
  y: number,
  step: number,
  spec: CanvasSymmetrySpec,
): { partners: CanvasSymmetryStamp[]; self: MirrorSymmetry | undefined } {
  const { frame, flags } = spec;
  // Scoped to one pattern: a stamp outside its box is not that pattern's
  // and mirrors nowhere; partners are fenced to the box (the frame IS the
  // pattern's grid, so an in-box partner is a cell of it).
  if (spec.only && !cellInFrame(x, y, step, frame)) return { partners: [], self: undefined };
  const { targets, symmetry } = computeBoxMirrorTargets(
    (x - frame.cellX) / step,
    (y - frame.cellY) / step,
    frame.cellWidth / step,
    frame.cellHeight / step,
    flags,
  );
  const partners = targets.map((t: MirrorTarget) => ({
    x: frame.cellX + t.x * step,
    y: frame.cellY + t.y * step,
    mH: t.mH,
    mV: t.mV,
    rot: t.rot,
  }));
  return {
    partners: spec.only ? partners.filter((t) => cellInFrame(t.x, t.y, step, frame)) : partners,
    self: symmetry,
  };
}

// ── Continuous orbit (strokes, shapes, paint dabs) ──────────────────
// Tiles mirror through the engine's CELL math; everything continuous — a
// freehand polyline's points, a shape's segments, a raster brush dab —
// mirrors through the same orbit expressed as affine isometries about the
// frame. Every map's linear part is diagonal or a swap (reflections,
// quarter-turns), so one representation covers all ten modes.

/** One orbit transform: p' = (a·x + b·y + tx, c·x + d·y + ty). The linear
 *  part is an isometry (a reflection / quarter-turn matrix), so vectors —
 *  a push dab's smear direction — transform through it without the
 *  translation. */
export interface SymmetryAffine {
  kind: string;
  a: number; b: number; c: number; d: number; tx: number; ty: number;
}

export function applySymmetryAffine(
  m: SymmetryAffine, x: number, y: number,
): [number, number] {
  return [m.a * x + m.b * y + m.tx, m.c * x + m.d * y + m.ty];
}

export function applySymmetryAffineVec(
  m: SymmetryAffine, dx: number, dy: number,
): [number, number] {
  return [m.a * dx + m.b * dy, m.c * dx + m.d * dy];
}

const reflectX = (kind: string, axis: number): SymmetryAffine =>
  ({ kind, a: -1, b: 0, c: 0, d: 1, tx: 2 * axis, ty: 0 });
const reflectY = (kind: string, axis: number): SymmetryAffine =>
  ({ kind, a: 1, b: 0, c: 0, d: -1, tx: 0, ty: 2 * axis });
const rot180 = (kind: string, cx: number, cy: number): SymmetryAffine =>
  ({ kind, a: -1, b: 0, c: 0, d: -1, tx: 2 * cx, ty: 2 * cy });
const rot90 = (kind: string, cx: number, cy: number): SymmetryAffine =>
  ({ kind, a: 0, b: -1, c: 1, d: 0, tx: cx + cy, ty: cy - cx });
const rot270 = (kind: string, cx: number, cy: number): SymmetryAffine =>
  ({ kind, a: 0, b: 1, c: -1, d: 0, tx: cx - cy, ty: cx + cy });
const diag1 = (kind: string, cx: number, cy: number): SymmetryAffine =>
  ({ kind, a: 0, b: 1, c: 1, d: 0, tx: cx - cy, ty: cy - cx });
const diag2 = (kind: string, cx: number, cy: number): SymmetryAffine =>
  ({ kind, a: 0, b: -1, c: -1, d: 0, tx: cx + cy, ty: cx + cy });

/**
 * The orbit's non-identity transforms for `spec` at the current grid
 * `step`, in world cells. (`refX`, `refY`) anchors quad / row / col: their
 * within-half structure depends on WHICH half-block the source sits in
 * (the engine's cell math normalizes by half the same way), and outside
 * the frame's block grid they keep only their center mirror — exactly the
 * tile behaviour. The center-axis modes ignore the ref entirely.
 */
export function symmetryAffineMaps(
  spec: CanvasSymmetrySpec,
  step: number,
  refX: number,
  refY: number,
): SymmetryAffine[] {
  const { flags, frame } = spec;
  const cx = frame.cellX + frame.cellWidth / 2;
  const cy = frame.cellY + frame.cellHeight / 2;
  if (flags.mirrorStar) {
    return [
      reflectX('h', cx), reflectY('v', cy), rot180('180', cx, cy),
      diag1('d1', cx, cy), diag2('d2', cx, cy),
      rot90('r90', cx, cy), rot270('r270', cx, cy),
    ];
  }
  if (flags.mirrorQuad || flags.mirrorRow || flags.mirrorCol) {
    // Half-block structure, floor-based like the cell math: qwc/qhc is a
    // whole number of steps, and a remainder strip on an odd frame stays
    // outside the block grid.
    const qwc = Math.floor(frame.cellWidth / step / 2) * step;
    const qhc = Math.floor(frame.cellHeight / step / 2) * step;
    const xForms = (ref: number): SymmetryAffine[] => {
      const rel = ref - frame.cellX;
      if (qwc <= 0 || rel < 0 || rel >= 2 * qwc) return [reflectX('h', cx)];
      const half = rel < qwc ? 0 : 1;
      const ownAxis = frame.cellX + half * qwc + qwc / 2;
      const shift = half === 0 ? qwc : -qwc;
      return [
        reflectX('hq', ownAxis),
        { kind: 'tx', a: 1, b: 0, c: 0, d: 1, tx: shift, ty: 0 },
        reflectX('hc', frame.cellX + qwc),
      ];
    };
    const yForms = (ref: number): SymmetryAffine[] => {
      const rel = ref - frame.cellY;
      if (qhc <= 0 || rel < 0 || rel >= 2 * qhc) return [reflectY('v', cy)];
      const half = rel < qhc ? 0 : 1;
      const ownAxis = frame.cellY + half * qhc + qhc / 2;
      const shift = half === 0 ? qhc : -qhc;
      return [
        reflectY('vq', ownAxis),
        { kind: 'ty', a: 1, b: 0, c: 0, d: 1, tx: 0, ty: shift },
        reflectY('vc', frame.cellY + qhc),
      ];
    };
    if (flags.mirrorRow) return yForms(refY);
    if (flags.mirrorCol) return xForms(refX);
    // Quad: outside the block grid on EITHER axis the quadrant structure
    // does not apply — the center mirror does (the tile math's own rule).
    const xOut = qwc <= 0 || refX < frame.cellX || refX >= frame.cellX + 2 * qwc;
    const yOut = qhc <= 0 || refY < frame.cellY || refY >= frame.cellY + 2 * qhc;
    if (xOut || yOut) {
      return [reflectX('h', cx), reflectY('v', cy), rot180('180', cx, cy)];
    }
    // Every x-form × y-form combination, identity included on each axis,
    // minus the overall identity — 15 maps on a full block grid.
    const xs = [{ kind: 'x0', a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }, ...xForms(refX)];
    const ys = [{ kind: 'y0', a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }, ...yForms(refY)];
    const out: SymmetryAffine[] = [];
    for (const xf of xs) {
      for (const yf of ys) {
        if (xf.kind === 'x0' && yf.kind === 'y0') continue;
        out.push({
          kind: `${xf.kind}+${yf.kind}`,
          a: xf.a, b: 0, c: 0, d: yf.d, tx: xf.tx, ty: yf.ty,
        });
      }
    }
    return out;
  }
  if (flags.mirrorDiag1 || flags.mirrorDiag2 || flags.mirrorDiagBoth) {
    const out: SymmetryAffine[] = [];
    if (flags.mirrorDiag1 || flags.mirrorDiagBoth) out.push(diag1('d1', cx, cy));
    if (flags.mirrorDiag2 || flags.mirrorDiagBoth) out.push(diag2('d2', cx, cy));
    if (flags.mirrorDiagBoth) out.push(rot180('180', cx, cy));
    return out;
  }
  if (flags.mirrorRotate) {
    return [rot90('r90', cx, cy), rot180('180', cx, cy), rot270('r270', cx, cy)];
  }
  const out: SymmetryAffine[] = [];
  if (flags.mirrorH) out.push(reflectX('h', cx));
  if (flags.mirrorV) out.push(reflectY('v', cy));
  if (flags.mirrorH && flags.mirrorV) out.push(rot180('180', cx, cy));
  return out;
}

// ── Overlay geometry ────────────────────────────────────────────────

/** One straight axis line of the overlay, in world cells. */
export interface SymmetryAxisLine {
  kind: 'v' | 'h';
  /** The axis coordinate — x for a vertical line, y for a horizontal. */
  at: number;
  /** Dashed = the axis runs through cell CENTERS at the current grid
   *  (cells self-mirror); solid = it rides a cell border (cells swap
   *  across). Facet's semantic, carried over. */
  dashed: boolean;
  /** A dimmer within-half axis (quad / row / col), not the center. */
  quarter?: boolean;
}

export interface SymmetryOverlayModel {
  frame: CellBbox;
  lines: SymmetryAxisLine[];
  /** Diagonals through the center — always dashed, like Facet's. */
  diag1: boolean;
  diag2: boolean;
  /** Dash rhythm in world cells — CONSTANT (half a base cell, exactly
   *  Facet's half-an-L0-cell period), so regridding never changes how
   *  dotted the lines look; only solid-vs-dashed reads the grid. */
  dashPeriod: number;
  /** The mirror is one pattern's (CanvasSymmetrySpec.only): every line —
   *  the centre axes and the diagonals included — stops at the frame's
   *  edges instead of running across the view. */
  bounded: boolean;
  /** A bounded model's turn, degrees CW about the frame's centre — the
   *  scoped pattern's own free rotation: every line turns with the grid. */
  angleDeg?: number;
}

/** The overlay's dash rhythm, in world cells. */
export const SYMMETRY_DASH_PERIOD = 0.5;

/** Whether an axis at world coordinate `at` rides a cell border of the
 *  current grid (solid) or bisects a cell (dashed). */
function axisDashed(at: number, step: number): boolean {
  return ((Math.round(at / (step / 2)) % 2) + 2) % 2 !== 0;
}

/**
 * What the overlay draws for a symmetry setting at the current grid level
 * — the same flag → line mapping Facet's renderer uses: a vertical center
 * line for H / rotate / quad / col / star, a horizontal one for V /
 * rotate / quad / row / star, within-half quarter lines for quad / row /
 * col (at the centers of the halves the stamp math actually mirrors
 * within, floor(W/2) steps each), and the diagonals for diag modes and
 * star. Null when symmetry is off.
 */
export function symmetryOverlayModel(
  flags: PatternSymmetry | undefined,
  frame: CellBbox | undefined,
  gridLevel: number,
  /** Keep every line to the frame (a pattern-scoped mirror). */
  bounded = false,
  /** …turned with it, degrees CW about its centre. */
  angleDeg = 0,
): SymmetryOverlayModel | null {
  if (!flags || !frame || !canvasSymmetryOn(flags)) return null;
  const step = compSnapStep(gridLevel);
  const cx = frame.cellX + frame.cellWidth / 2;
  const cy = frame.cellY + frame.cellHeight / 2;
  const lines: SymmetryAxisLine[] = [];
  const vCenter = flags.mirrorH || flags.mirrorRotate || flags.mirrorQuad
    || flags.mirrorCol || flags.mirrorStar;
  const hCenter = flags.mirrorV || flags.mirrorRotate || flags.mirrorQuad
    || flags.mirrorRow || flags.mirrorStar;
  if (vCenter) lines.push({ kind: 'v', at: cx, dashed: axisDashed(cx, step) });
  if (hCenter) lines.push({ kind: 'h', at: cy, dashed: axisDashed(cy, step) });
  if (flags.mirrorQuad || flags.mirrorCol) {
    // The halves are [0, qw) and [qw, 2qw) steps — each mirrors about its
    // own center, so that is where the quarter lines go.
    const qw = Math.floor(frame.cellWidth / step / 2) * step;
    for (const at of [frame.cellX + qw / 2, frame.cellX + qw + qw / 2]) {
      lines.push({ kind: 'v', at, dashed: axisDashed(at, step), quarter: true });
    }
  }
  if (flags.mirrorQuad || flags.mirrorRow) {
    const qh = Math.floor(frame.cellHeight / step / 2) * step;
    for (const at of [frame.cellY + qh / 2, frame.cellY + qh + qh / 2]) {
      lines.push({ kind: 'h', at, dashed: axisDashed(at, step), quarter: true });
    }
  }
  return {
    frame,
    lines,
    diag1: flags.mirrorDiag1 || flags.mirrorDiagBoth || flags.mirrorStar,
    diag2: flags.mirrorDiag2 || flags.mirrorDiagBoth || flags.mirrorStar,
    dashPeriod: SYMMETRY_DASH_PERIOD,
    bounded,
    ...(bounded && angleDeg ? { angleDeg } : null),
  };
}
