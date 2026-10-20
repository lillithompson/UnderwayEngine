/**
 * Host gestures on the scene graph (CozyJournal's docs/transform-refactor.md §3.5, P4).
 *
 * Every gesture the editor makes on a selection — a drag, a twist, a
 * corner resize, a flip, a quarter turn — is one world-space affine
 * applied to the selection's ROOT nodes, and each root takes it as one
 * `setTransform`. A group moves as one node and its members are not
 * touched; a leaf three groups deep takes the same matrix through its
 * inverse parent. The builders in editorSession.ts are thin: they name
 * the pivot and the matrix, and this module turns that into an entry.
 *
 * Nothing here reads a pose out of the legacy fields. A turn is read off
 * the node's transform, a box off its world matrix — which is what lets
 * the whole editor edit through the graph without caring how the legacy
 * view happens to spell a pose.
 */

import type { CompUndoEntry, CompUndoOp, CompositionState } from '@/engine/types';
import {
  SceneGraph, descendants, getNode, segmentsBbox, worldMatrix,
} from '@/engine/sceneGraph';
import {
  SceneEntry, applySceneOps, buildWorldGesture, gestureRoots,
} from '@/engine/sceneGraphOps';
import {
  Bbox, LOCAL_IDENTITY, LocalTransform, Mat2D, decomposeMatrix, localEquals, localMatrix,
  matAbout, matApplyPoint, matInvert, matMul, matTranslate, matrixString, normalizeDeg,
} from '@/engine/sceneTransform';
import { findItem, isGroupChainLocked, isItemLocked } from '@/engine/compositionOps';
import { graphOf } from '@/engine/sceneHitFrame';
import type { CellBbox } from '@/editor/resizeMath';

/** An axis-aligned box in L0 cells, as the host spells one. Declared in
 *  `resizeMath` — with `angleDeg` it is the drawn rectangle {@link drawnBox}
 *  answers in, and the corner readers there take the same type. Re-exported
 *  so a caller of `drawnBox` need not know which of the two files it came
 *  from. */

/** The composition's graph, built on the spot for a state that carries
 *  none — a builder handed a bare state (a test fixture, an import) still
 *  answers, at the price of one conversion. The engine's, re-exported:
 *  every reader in the refactor asks the same question, and two copies of
 *  the answer is how a graph and a hit test start disagreeing about which
 *  scene they are describing. */
export { graphOf };

// ── What a gesture acts on ─────────────────────────────────────────────

/**
 * The nodes a gesture over `ids` should actually move.
 *
 * A selection is a list of LEAF ids — the host selects a group by
 * selecting every leaf in it — so the group has to be recovered here: a
 * plain group whose every leaf is selected is lifted to the group node,
 * and `gestureRoots` then keeps only the outermost of the lot, so nothing
 * is moved twice. A frame is never lifted (it is a Scene Outline
 * selection with builders of its own), and neither is a group with a
 * locked member — that member stays put, so the others move on their own.
 *
 * Locked and unknown ids drop out, as they always have; `skip` drops any
 * further kind a gesture refuses (figures, for anything that is not a
 * move — plan Q1).
 */
export function selectionRoots(
  state: CompositionState,
  ids: readonly string[],
  skip?: (id: string) => boolean,
): string[] {
  const graph = graphOf(state);
  const wanted = new Set<string>();
  for (const id of ids) {
    if (!graph.nodes.has(id) || isItemLocked(state, id)) continue;
    if (skip?.(id)) continue;
    wanted.add(id);
  }
  if (wanted.size === 0) return [];

  const lifted = new Set(wanted);
  for (const node of graph.nodes.values()) {
    if (node.kind !== 'group' || node.isFrame) continue;
    if (isGroupChainLocked(state, node.id)) continue;
    const leaves = descendants(graph, node.id).filter((n) => n.kind !== 'group');
    if (leaves.length > 0 && leaves.every((n) => wanted.has(n.id))) lifted.add(node.id);
  }
  return gestureRoots(graph, lifted);
}

/** True for a figure leaf — the kind that only takes quarter turns and
 *  uniform scale, and so sits out of every free gesture (plan Q1). */
export function isFigureId(state: CompositionState, id: string): boolean {
  return findItem(state, id)?.kind === 'figure';
}

// ── Building the entry ─────────────────────────────────────────────────

/**
 * `gesture`, a world-space affine, applied to every one of `roots` as one
 * `setTransform` each — one undo entry for the whole selection. Roots
 * that would not change are left out; null when none would.
 *
 * `flags`, when given, names the mirror spelling every root should read
 * back with (a flip the user asked for by axis); otherwise each root keeps
 * its own.
 */
export function buildGestureEntry(
  state: CompositionState,
  roots: readonly string[],
  gesture: Mat2D,
  flags?: (id: string, current: LocalTransform) => { mirrorH?: boolean; mirrorV?: boolean },
): CompUndoEntry | null {
  const graph = graphOf(state);
  const entry: CompUndoOp[] = [];
  for (const id of roots) {
    const node = getNode(graph, id);
    if (!node) continue;
    const op = buildWorldGesture(graph, id, gesture, flags?.(id, node.transform));
    if (!op || op.op !== 'setTransform') continue;
    const to = snapNoise(op.to);
    if (localEquals(op.from, to)) continue;
    entry.push({ op: 'setTransform', nodeId: id, from: op.from, to });
  }
  return entry.length > 0 ? entry : null;
}

/**
 * Fold float noise out of a transform a gesture produced: any field
 * within 1e-9 of an integer is that integer.
 *
 * A turn of 45 and back, or a resize doubled and halved, lands on
 * `1.0000000000000002` where it started at `1`. Nothing on screen can
 * tell, but a no-op check, a snapshot and a persisted file all can, and
 * the legacy model kept whole identity stashes to avoid exactly this.
 * The engine already snaps its matrix entries the same way (`clean` in
 * sceneTransform); this is that rule applied once more, at the one place
 * the host writes a transform.
 */
export function snapNoise(t: LocalTransform): LocalTransform {
  const snap = (n: number) => {
    const r = Math.round(n);
    return (Math.abs(n - r) < 1e-9 ? r : n) || 0;
  };
  return {
    ...t,
    tx: snap(t.tx), ty: snap(t.ty), sx: snap(t.sx), sy: snap(t.sy),
    rotationDeg: normalizeDeg(snap(t.rotationDeg)),
  };
}

// ── The gestures ───────────────────────────────────────────────────────

/** Move the selection by a world delta — snapped once by the caller, in
 *  world space (plan Q6). */
export function dragDelta(
  state: CompositionState, ids: readonly string[], dx: number, dy: number,
): CompUndoEntry | null {
  if (dx === 0 && dy === 0) return null;
  return buildGestureEntry(state, selectionRoots(state, ids), matTranslate(dx, dy));
}

/** A rotation and a uniform scale about a world point: the twist, the
 *  pinch, and — at 90 — the quarter turn. */
export function twistAbout(
  state: CompositionState, ids: readonly string[],
  pivot: readonly [number, number], deltaDeg: number, factor = 1,
): CompUndoEntry | null {
  if (!(factor > 0)) return null;
  const roots = selectionRoots(state, ids, (id) => isFigureId(state, id));
  return buildGestureEntry(state, roots, aboutPoint(pivot, deltaDeg, factor, factor));
}

/** The linear part of a flip: `'h'` reflects left for right, `'v'` top for
 *  bottom — across the world's axes, or, at `angleDeg`, across the axes of
 *  a box drawn at that turn (turn into them, reflect, turn back). */
export function mirrorLinear(axis: 'h' | 'v', angleDeg = 0): Mat2D {
  const flip: Mat2D = axis === 'h'
    ? { a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 }
    : { a: 1, b: 0, c: 0, d: -1, e: 0, f: 0 };
  if (!angleDeg) return flip;
  const turn = localMatrix({ ...LOCAL_IDENTITY, rotationDeg: angleDeg });
  return matMul(turn, matMul(flip, matInvert(turn)));
}

/** A flip across an axis through `pivot` ({@link mirrorLinear}): the
 *  world's by default — the Mirror buttons — or, at `angleDeg`, a turned
 *  box's own, which is the flip a corner dragged past its pinned corner
 *  asks for. Every root reads back with the named flag toggled, so a flip
 *  stays spelled as the flip it was. */
export function mirrorAbout(
  state: CompositionState, ids: readonly string[],
  pivot: readonly [number, number], axis: 'h' | 'v', angleDeg = 0,
): CompUndoEntry | null {
  const roots = selectionRoots(state, ids, (id) => isFigureId(state, id));
  const linear = mirrorLinear(axis, angleDeg);
  return buildGestureEntry(state, roots, matAbout(pivot, linear), (_id, t) => ({
    mirrorH: axis === 'h' ? !t.mirrorH : !!t.mirrorH,
    mirrorV: axis === 'v' ? !t.mirrorV : !!t.mirrorV,
  }));
}

/**
 * Carry a box onto another: the corner-drag resize. Both boxes are drawn
 * at `angleDeg` about their own centres (see resizeMath.computeCornerResize,
 * which pins the opposite corner in world space), so the map is a scale
 * along the box's own axes, seated so the old centre lands on the new.
 */
export function resizeBox(
  state: CompositionState, ids: readonly string[],
  oldBox: CellBbox, newBox: CellBbox, angleDeg = 0,
): CompUndoEntry | null {
  if (!(oldBox.cellWidth > 0) || !(oldBox.cellHeight > 0)) return null;
  if (!(newBox.cellWidth > 0) || !(newBox.cellHeight > 0)) return null;
  const roots = selectionRoots(state, ids, (id) => isFigureId(state, id));
  return buildGestureEntry(state, roots, boxToBoxGesture(oldBox, newBox, angleDeg));
}

/** The world affine that carries `oldBox` onto `newBox`, both drawn at
 *  `angleDeg` about their centres. */
export function boxToBoxGesture(oldBox: CellBbox, newBox: CellBbox, angleDeg = 0): Mat2D {
  const c0: [number, number] = [oldBox.cellX + oldBox.cellWidth / 2, oldBox.cellY + oldBox.cellHeight / 2];
  const c1: [number, number] = [newBox.cellX + newBox.cellWidth / 2, newBox.cellY + newBox.cellHeight / 2];
  const sx = newBox.cellWidth / oldBox.cellWidth;
  const sy = newBox.cellHeight / oldBox.cellHeight;
  // Scale along the box's own axes: turn into them, scale, turn back.
  const turn = localMatrix({ ...LOCAL_IDENTITY, rotationDeg: angleDeg });
  const scaled = matMul(turn, matMul({ a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 }, matInvert(turn)));
  return matMul(matTranslate(c1[0] - c0[0], c1[1] - c0[1]), matAbout(c0, scaled));
}

/** A turn by `deltaDeg` and a per-axis scale, about a world point. */
export function aboutPoint(
  pivot: readonly [number, number], deltaDeg: number, sx: number, sy: number,
): Mat2D {
  const turn = localMatrix({ ...LOCAL_IDENTITY, rotationDeg: deltaDeg });
  return matAbout(pivot, matMul(turn, { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 }));
}

// ── Reading a pose ─────────────────────────────────────────────────────

/** The centre of a node's content, in its own space. */
export function localCentre(graph: SceneGraph, id: string): [number, number] | null {
  const node = getNode(graph, id);
  if (!node) return null;
  const box = node.localBox ?? (node.localSegments ? segmentsBbox(node.localSegments) : null);
  if (!box) return null;
  return [box.x + box.width / 2, box.y + box.height / 2];
}

/** Where a node's content centre sits in the world. */
export function worldCentre(state: CompositionState, id: string): [number, number] | null {
  const graph = graphOf(state);
  const c = localCentre(graph, id);
  return c ? matApplyPoint(worldMatrix(graph, id), c[0], c[1]) : null;
}

/**
 * The turn a node is drawn at, in degrees clockwise, folded into
 * (-180, 180] the way the rotate slider reads it. The discrete quarter
 * turn and the free angle of the legacy fields are one number here.
 */
export function worldTurnDeg(state: CompositionState, id: string): number {
  const graph = graphOf(state);
  if (!graph.nodes.has(id)) return 0;
  return signedDeg(decomposeMatrix(worldMatrix(graph, id)).rotationDeg);
}

/** A node's own turn relative to its parent, folded into (-180, 180]. */
export function localTurnDeg(state: CompositionState, id: string): number {
  const node = getNode(graphOf(state), id);
  return node ? signedDeg(node.transform.rotationDeg) : 0;
}

/** Fold into (-180, 180]. */
export function signedDeg(deg: number): number {
  const d = normalizeDeg(deg);
  return d > 180 ? d - 360 : d;
}

/**
 * The rectangle a leaf's selection outline is drawn as: `local` — its
 * content box, or another box of the caller's in the SAME space (a line's
 * straddle box, a pattern's grid) — scaled by the node's world scale,
 * centred where its world matrix puts that box's centre, turned by the
 * matrix's one rotation. The nearest rotated rectangle to the matrix: an
 * outline IS a rectangle, while a member of a stretched bound group is
 * drawn with its exact shear and wears this rectangle around it.
 *
 * One reading for every kind, svg included. The legacy view has no
 * rotated-rectangle spelling for a path: it bakes the ancestors' turns
 * into the vertices and reports only the node's OWN spin, so a path inside
 * a turned group came back as a loose axis-aligned box around the turned
 * path. Null for an unknown id, a group, or a node with no box to name.
 */
export function drawnBox(
  state: CompositionState, id: string, local?: Bbox,
): { bbox: CellBbox; angleDeg: number } | null {
  const graph = graphOf(state);
  const node = getNode(graph, id);
  if (!node || node.kind === 'group') return null;
  const box = local ?? node.localBox;
  if (!box) return null;
  const m = worldMatrix(graph, id);
  const t = decomposeMatrix(m);
  const w = box.width * Math.abs(t.sx);
  const h = box.height * Math.abs(t.sy);
  const [cx, cy] = matApplyPoint(m, box.x + box.width / 2, box.y + box.height / 2);
  return {
    bbox: { cellX: cx - w / 2, cellY: cy - h / 2, cellWidth: w, cellHeight: h },
    angleDeg: signedDeg(t.rotationDeg),
  };
}

// ── Live preview ───────────────────────────────────────────────────────

/** Where a live gesture puts one leaf: both spellings of the same pose. */
export interface PreviewPose {
  /** The CSS matrix to set on the leaf's positioned element, about its own
   *  centre — the RELATIVE map from where the element already stands. `e`
   *  and `f` are in L0 cells; the canvas scales them to px. */
  readonly css: Mat2D;
  /** The leaf's new WORLD matrix — what the node layer would draw it by if
   *  the entry were committed. A caller that cannot compose the relative
   *  map on top of the element (an off-square one reaches the strokes)
   *  re-draws the leaf through this instead. */
  readonly world: Mat2D;
}

/**
 * What a live preview of `entry` should draw, per leaf.
 *
 * The graph is advanced by the proposed ops without committing, and each
 * affected leaf's new world matrix is compared with its current one. The
 * element already stands at the current pose, so `css` is the RELATIVE map
 * between the two — which, for a member of a group being turned or
 * stretched, is the ride the commit will give it. The node layer draws
 * every leaf through its exact world matrix (drawnPose.ts), so the preview
 * is exact too: what it shows is what the release renders.
 *
 * `world` is that same pose said absolutely, for the one case the relative
 * map cannot draw: composed as a CSS transform it sits ABOVE everything
 * the leaf is drawn with, so an off-square map stretches the leaf's stroke
 * weights, which a re-draw at the world matrix does not (the split
 * `svgLocalGeometry` makes keeps a stroke even in any frame).
 */
export function previewGesture(
  state: CompositionState, entry: CompUndoEntry,
): Map<string, PreviewPose> {
  const graph = graphOf(state);
  const ops: SceneEntry = [];
  const rootIds: string[] = [];
  for (const op of entry) {
    if (op.op !== 'setTransform') continue;
    ops.push({ op: 'setTransform', nodeId: op.nodeId, from: op.from, to: op.to });
    rootIds.push(op.nodeId);
  }
  const out = new Map<string, PreviewPose>();
  if (ops.length === 0) return out;
  const next = applySceneOps(graph, ops);
  for (const rootId of rootIds) {
    const root = getNode(graph, rootId);
    if (!root) continue;
    const leaves = root.kind === 'group'
      ? descendants(graph, rootId).filter((n) => n.kind !== 'group').map((n) => n.id)
      : [rootId];
    for (const id of leaves) {
      const c = localCentre(graph, id);
      if (!c) continue;
      const was = worldMatrix(graph, id);
      const now = worldMatrix(next, id);
      let rel: Mat2D;
      try { rel = matMul(now, matInvert(was)); } catch { continue; }
      const [x0, y0] = matApplyPoint(was, c[0], c[1]);
      const [x1, y1] = matApplyPoint(now, c[0], c[1]);
      out.set(id, {
        css: { a: rel.a, b: rel.b, c: rel.c, d: rel.d, e: x1 - x0, f: y1 - y0 },
        world: now,
      });
    }
  }
  return out;
}

/**
 * The world affine `entry` lands on ONE node: the map from where it stands
 * to where the entry puts it.
 *
 * {@link previewGesture} per leaf for a preview that moves the leaves;
 * this for one that moves a whole subtree with a single element — the
 * frame clip, whose members ride its transform (drawnPose.drawnClip). It
 * is the same reading, taken once: the graph advanced by the proposed ops,
 * and the node's new world matrix against its old.
 *
 * Null for an unknown node, an entry with no transform in it, or a pose
 * nothing can be mapped back through (a subtree squashed flat).
 */
export function previewWorldGesture(
  state: CompositionState, entry: CompUndoEntry, nodeId: string,
): Mat2D | null {
  const graph = graphOf(state);
  if (!graph.nodes.has(nodeId)) return null;
  const ops: SceneEntry = [];
  for (const op of entry) {
    if (op.op === 'setTransform') ops.push({ op: 'setTransform', nodeId: op.nodeId, from: op.from, to: op.to });
  }
  if (ops.length === 0) return null;
  const was = worldMatrix(graph, nodeId);
  const now = worldMatrix(applySceneOps(graph, ops), nodeId);
  try { return matMul(now, matInvert(was)); } catch { return null; }
}

/** `matrix(...)` for a map whose translation is in cells, scaled to px.
 *
 *  The engine's {@link matrixString}, which the SVG export writes the same
 *  poses with — one spelling, so the screen and the export cannot disagree
 *  about a matrix. Kept under this name because the layers read as CSS. */
export function cssMatrix(m: Mat2D, pxPerCell: number): string {
  return matrixString(m, pxPerCell);
}

/**
 * A world gesture as the CSS transform of an element whose transform
 * origin is `origin` (the selection outline, about its centre): the
 * gesture's linear part, and the move that origin takes.
 */
export function gestureAbout(gesture: Mat2D, origin: readonly [number, number]): Mat2D {
  const [x1, y1] = matApplyPoint(gesture, origin[0], origin[1]);
  return { a: gesture.a, b: gesture.b, c: gesture.c, d: gesture.d, e: x1 - origin[0], f: y1 - origin[1] };
}
