/**
 * Legacy ops, expressed as scene-graph ops (docs/transform-refactor.md
 * §6.4).
 *
 * The legacy model has nine ways to change a pose — `moveNode`,
 * `rotateFigure`, `mirrorFigure`, `scaleFigure`, `setNodeRotation`,
 * `editSVGSegments`, `editImage`, the three `replaceScene` edits, and
 * `transformGroup` — each with its own undo fields and its own rules
 * about which caches it remembers to update. The graph has one:
 * `setTransform`.
 *
 * This is the translation between them, and the bridge that lets the host
 * keep speaking the old vocabulary while the engine stops. Nothing here
 * decides policy; it reads what a legacy op says the world should look
 * like and says the same thing in transforms.
 *
 * Ops that do not touch pose — recolour, rename, text content, pattern
 * cells — are not here. They travel as content, unchanged.
 */

import {
  SceneGraph, SceneNode, fromLegacy, getNode, segmentsBbox, worldMatrix,
} from './sceneGraph';
import {
  SceneEntry, SceneOp, applySceneOps, buildGroup, buildMoveBy, buildSetParent,
  buildSetTransform, buildUngroup, indexOfChild,
} from './sceneGraphOps';
import {
  LocalTransform, decomposeMatrix, localMatrix, matApplyPoint, matInvert, matMul,
  normalizeDeg, transformAboutPivot,
} from './sceneTransform';
import type { CompUndoOp, CompositionState, GroupNode } from './types';

// ── Group transform ────────────────────────────────────────────────────

/** A legacy `GroupNode`'s transform fields, as a `LocalTransform`. The
 *  legacy order scales after rotating, so a quarter turn swaps the axes. */
export function groupFieldsToTransform(g: {
  translateX: number; translateY: number;
  scaleX: number; scaleY: number;
  rotation: 0 | 90 | 180 | 270;
  mirrorH: boolean; mirrorV: boolean;
}): LocalTransform {
  const swap = g.rotation === 90 || g.rotation === 270;
  return {
    tx: g.translateX, ty: g.translateY,
    sx: swap ? g.scaleY : g.scaleX,
    sy: swap ? g.scaleX : g.scaleY,
    rotationDeg: g.rotation,
    ...(g.mirrorH ? { mirrorH: true } : {}),
    ...(g.mirrorV ? { mirrorV: true } : {}),
  };
}

// ── Leaf pose ──────────────────────────────────────────────────────────

/**
 * The transform that puts a leaf's local box at a given world pose.
 *
 * The legacy pose fields describe the renderer's own composition: the
 * content box centred in the world bbox, flipped, quarter-turned, then
 * given its free angle, every step about that centre. So the rotation is
 * the sum of the two channels and the translation is what puts the
 * content box's centre on the bbox's — the same derivation `fromLegacy`
 * makes, reused here so the two cannot drift apart.
 */
export function poseToWorldTransform(
  pose: {
    cellX: number; cellY: number; cellWidth: number; cellHeight: number;
    rotation?: 0 | 90 | 180 | 270;
    mirrorH?: boolean; mirrorV?: boolean; angleDeg?: number;
  },
  localBox: { width: number; height: number },
): LocalTransform {
  const rotationDeg = normalizeDeg((pose.rotation ?? 0) + (pose.angleDeg ?? 0));
  const linear = localMatrix({
    tx: 0, ty: 0, sx: 1, sy: 1, rotationDeg,
    ...(pose.mirrorH ? { mirrorH: true } : {}),
    ...(pose.mirrorV ? { mirrorV: true } : {}),
  });
  const cx = pose.cellX + pose.cellWidth / 2;
  const cy = pose.cellY + pose.cellHeight / 2;
  // Scale so the local box covers the (un-turned) content box.
  const swap = rotationIsQuarterSwap(pose.rotation);
  const contentW = swap ? pose.cellHeight : pose.cellWidth;
  const contentH = swap ? pose.cellWidth : pose.cellHeight;
  const sx = localBox.width ? contentW / localBox.width : 1;
  const sy = localBox.height ? contentH / localBox.height : 1;
  const hw = (localBox.width * sx) / 2, hh = (localBox.height * sy) / 2;
  return {
    tx: cx - (linear.a * hw + linear.c * hh),
    ty: cy - (linear.b * hw + linear.d * hh),
    sx, sy, rotationDeg,
    ...(pose.mirrorH ? { mirrorH: true } : {}),
    ...(pose.mirrorV ? { mirrorV: true } : {}),
  };
}

function rotationIsQuarterSwap(rotation?: 0 | 90 | 180 | 270): boolean {
  return rotation === 90 || rotation === 270;
}

/** The local transform a node needs to land at a given WORLD transform. */
function localForWorld(
  graph: SceneGraph, nodeId: string, world: LocalTransform,
): LocalTransform {
  const parentId = getNode(graph, nodeId)?.parentId;
  if (!parentId) return world;
  try {
    return decomposeMatrix(matMul(
      matInvert(worldMatrix(graph, parentId)), localMatrix(world),
    ));
  } catch {
    return world;
  }
}

/** Re-pose a leaf so its world bbox and orientation match `pose`. */
function setLeafPose(
  graph: SceneGraph, nodeId: string,
  pose: {
    cellX: number; cellY: number; cellWidth: number; cellHeight: number;
    rotation?: 0 | 90 | 180 | 270;
    mirrorH?: boolean; mirrorV?: boolean; angleDeg?: number;
  },
): SceneOp | null {
  const node = getNode(graph, nodeId);
  if (!node?.localBox) return null;
  const world = poseToWorldTransform(pose, node.localBox);
  return buildSetTransform(graph, nodeId, localForWorld(graph, nodeId, world));
}

/** The node's own centre, in its parent's space. */
export function centreInParent(
  graph: SceneGraph, nodeId: string,
): [number, number] | null {
  const node = getNode(graph, nodeId);
  if (!node) return null;
  const box = node.localBox ?? (node.localSegments
    ? segmentsBbox(node.localSegments)
    : null);
  if (!box) return null;
  return matApplyPoint(
    localMatrix(node.transform),
    box.x + box.width / 2, box.y + box.height / 2,
  );
}

/** Turn a node about its own centre, leaving it where it sits. */
function rotateAboutOwnCentre(
  graph: SceneGraph, nodeId: string, deltaDeg: number,
): SceneOp | null {
  const node = getNode(graph, nodeId);
  const pivot = centreInParent(graph, nodeId);
  if (!node || !pivot) return null;
  return buildSetTransform(
    graph, nodeId,
    transformAboutPivot(node.transform, pivot, { rotateDeg: deltaDeg }),
  );
}

// ── Translation ────────────────────────────────────────────────────────

/**
 * A legacy op as scene-graph ops, or `null` when it does not touch pose
 * and should travel as content.
 *
 * Returns the ops for the FORWARD direction; undo comes from the scene
 * ops themselves, which carry both sides.
 */
export function legacyOpToSceneOps(
  graph: SceneGraph, op: CompUndoOp,
): SceneEntry | null {
  switch (op.op) {
    case 'moveNode': {
      const move = buildMoveBy(graph, op.nodeId, op.dx, op.dy);
      return move ? [move] : [];
    }

    case 'transformGroup': {
      // The whole point of the refactor in one line: a group transform is
      // a group's transform. No materialize pass, no probe, no members
      // touched.
      const set = buildSetTransform(graph, op.groupId, groupFieldsToTransform({
        translateX: op.newTranslateX, translateY: op.newTranslateY,
        scaleX: op.newScaleX, scaleY: op.newScaleY,
        rotation: op.newRotation, mirrorH: op.newMirrorH, mirrorV: op.newMirrorV,
      }));
      return set ? [set] : [];
    }

    case 'setNodeRotation': {
      // A free angle turns about the node's own CENTRE — where the
      // renderer applied it and where the user watched it happen. A
      // transform rotates about the node's local origin, which is a
      // corner, so the pivot has to be named explicitly or the node
      // swings away instead of spinning in place.
      const delta = normalizeDeg((op.newAngleDeg ?? 0) - (op.oldAngleDeg ?? 0));
      const set = rotateAboutOwnCentre(graph, op.id, delta);
      return set ? [set] : [];
    }

    case 'editImage': {
      const set = setLeafPose(graph, op.imageId, {
        cellX: op.newCellX, cellY: op.newCellY,
        cellWidth: op.newCellWidth, cellHeight: op.newCellHeight,
        rotation: op.newRotation, mirrorH: op.newMirrorH, mirrorV: op.newMirrorV,
        angleDeg: op.newAngleDeg,
      });
      return set ? [set] : [];
    }

    case 'groupFigures':
      return buildGroup(
        graph,
        [...op.figureIds, ...(op.childGroupIds ?? [])],
        op.groupId, op.groupName,
        op.isFrame ? { isFrame: true } : undefined,
      );

    case 'ungroupFigures':
      return buildUngroup(graph, op.groupId);

    case 'reparentNode': {
      const set = buildSetParent(
        graph, op.nodeId, op.newParentGroupId,
        indexOfChild(graph, op.newParentGroupId, op.nodeId),
      );
      return set ? [set] : [];
    }

    default:
      return null;
  }
}

/**
 * Apply a legacy entry through the graph where it touches pose.
 *
 * Ops this does not know how to translate return `null` and are skipped;
 * the caller keeps applying those the legacy way. That split is what
 * makes the migration one op at a time rather than one commit.
 */
export function applyLegacyEntryToGraph(
  graph: SceneGraph, entry: readonly CompUndoOp[],
): SceneGraph {
  let out = graph;
  for (const op of entry) {
    const ops = legacyOpToSceneOps(out, op);
    if (ops) out = applySceneOps(out, ops);
  }
  return out;
}

/** True when the graph can express this op's effect on pose. */
export function isPoseOp(op: CompUndoOp): boolean {
  return POSE_OPS.has(op.op);
}

const POSE_OPS: ReadonlySet<string> = new Set([
  'moveNode', 'transformGroup', 'setNodeRotation', 'editImage',
  'groupFigures', 'ungroupFigures', 'reparentNode',
]);

// ── Rebuild ────────────────────────────────────────────────────────────

/** A graph from the state's arrays — the fallback for an op the bridge
 *  does not translate, which the legacy path has already applied. */
export function regraph(state: CompositionState): SceneGraph {
  return fromLegacy(state);
}

/** Group records as the legacy view wants them, for a caller that has a
 *  graph and needs `state.groups`. */
export function graphGroups(graph: SceneGraph): GroupNode[] {
  const out: GroupNode[] = [];
  for (const node of graph.nodes.values()) {
    if (node.kind !== 'group') continue;
    out.push(groupNodeOf(node));
  }
  return out;
}

function groupNodeOf(node: SceneNode): GroupNode {
  const t = node.transform;
  const quarter = (Math.round(normalizeDeg(t.rotationDeg) / 90) * 90) % 360 as 0 | 90 | 180 | 270;
  const swap = quarter === 90 || quarter === 270;
  return {
    id: node.id, name: node.name ?? 'Group',
    translateX: t.tx, translateY: t.ty,
    scaleX: swap ? t.sy : t.sx,
    scaleY: swap ? t.sx : t.sy,
    rotation: quarter,
    mirrorH: !!t.mirrorH, mirrorV: !!t.mirrorV,
    ...(node.parentId ? { parentGroupId: node.parentId } : {}),
    ...(node.locked ? { locked: true } : {}),
    ...(node.hidden ? { hidden: true } : {}),
    ...(node.isFrame ? { isFrame: true } : {}),
  };
}

// ── Undo ───────────────────────────────────────────────────────────────

/**
 * The legacy op that undoes `op`, or `null` when this bridge cannot
 * express it.
 *
 * The graph's own ops carry both sides and revert themselves, but an undo
 * stack holds LEGACY entries, and by the time one is reverted the state
 * that produced the translation is gone. So the inverse is built from
 * what the legacy op itself carries — which is enough for all seven pose
 * ops, because each already records what it needs to undo: a delta to
 * negate, an old-and-new pair to swap, or, for the structural ones, the
 * group's saved transform and the snapshot of who used to parent what.
 */
export function invertLegacyOp(op: CompUndoOp): CompUndoOp | null {
  switch (op.op) {
    case 'moveNode':
      return { ...op, dx: -op.dx, dy: -op.dy };

    case 'transformGroup':
      return {
        ...op,
        oldTranslateX: op.newTranslateX, oldTranslateY: op.newTranslateY,
        oldScaleX: op.newScaleX, oldScaleY: op.newScaleY,
        oldRotation: op.newRotation,
        oldMirrorH: op.newMirrorH, oldMirrorV: op.newMirrorV,
        newTranslateX: op.oldTranslateX, newTranslateY: op.oldTranslateY,
        newScaleX: op.oldScaleX, newScaleY: op.oldScaleY,
        newRotation: op.oldRotation,
        newMirrorH: op.oldMirrorH, newMirrorV: op.oldMirrorV,
      };

    case 'setNodeRotation':
      return { ...op, oldAngleDeg: op.newAngleDeg, newAngleDeg: op.oldAngleDeg };

    case 'editImage':
      return {
        ...op,
        oldCellX: op.newCellX, oldCellY: op.newCellY,
        oldCellWidth: op.newCellWidth, oldCellHeight: op.newCellHeight,
        oldRotation: op.newRotation, oldMirrorH: op.newMirrorH,
        oldMirrorV: op.newMirrorV, oldAngleDeg: op.newAngleDeg,
        newCellX: op.oldCellX, newCellY: op.oldCellY,
        newCellWidth: op.oldCellWidth, newCellHeight: op.oldCellHeight,
        newRotation: op.oldRotation, newMirrorH: op.oldMirrorH,
        newMirrorV: op.oldMirrorV, newAngleDeg: op.oldAngleDeg,
      };

    case 'groupFigures':
      // Undoing a group is dissolving it. The members go back where they
      // were because the group was born at the identity.
      return {
        op: 'ungroupFigures',
        groupId: op.groupId, groupName: op.groupName,
        figureIds: op.figureIds, childGroupIds: op.childGroupIds,
      };

    case 'ungroupFigures':
      // Rebuilding the group is a `groupFigures`, but it has to come back
      // at its saved transform, which a `groupFigures` cannot say —
      // `invertOnGraph` handles it directly.
      return {
        op: 'groupFigures',
        figureIds: op.figureIds, childGroupIds: op.childGroupIds,
        groupId: op.groupId, groupName: op.groupName,
        isFrame: op.savedIsFrame,
      };

    case 'reparentNode': {
      // The op keeps a snapshot of every array as it stood before, so the
      // node's old parent is simply read back off it.
      const previous = [
        ...(op.prevFigures ?? []), ...(op.prevSVGs ?? []), ...(op.prevImages ?? []),
        ...(op.prevTexts ?? []), ...(op.prevPaints ?? []), ...(op.prevPatterns ?? []),
      ].find((n) => n.id === op.nodeId);
      if (!previous) return null;
      return {
        ...op,
        newParentGroupId: previous.groupId,
        newSceneOrder: op.oldSceneOrder, oldSceneOrder: op.newSceneOrder,
      };
    }

    default:
      return null;
  }
}

/**
 * The scene ops that undo a legacy op.
 *
 * Mostly the translation of its inverse. Undoing an ungroup is the one
 * that needs more: the group comes back at the identity, and the
 * transform it had when it was dissolved has to be put back on it — which
 * is exactly what the op's `saved*` fields are for, and why they exist
 * rather than letting undo recreate the group at the identity and move
 * every member instead.
 */
export function invertOnGraph(
  graph: SceneGraph, op: CompUndoOp,
): SceneEntry | null {
  if (op.op === 'ungroupFigures') {
    // The group comes back with its saved transform already on it, so its
    // members keep the world poses the ungroup left them at. Building it
    // at the identity and transforming it afterwards would carry every
    // member along with the transform.
    return buildGroup(
      graph, [...op.figureIds, ...(op.childGroupIds ?? [])],
      op.groupId, op.groupName,
      {
        ...(op.savedIsFrame ? { isFrame: true } : {}),
        transform: groupFieldsToTransform({
          translateX: op.savedTranslateX ?? 0, translateY: op.savedTranslateY ?? 0,
          scaleX: op.savedScaleX ?? 1, scaleY: op.savedScaleY ?? 1,
          rotation: op.savedRotation ?? 0,
          mirrorH: op.savedMirrorH ?? false, mirrorV: op.savedMirrorV ?? false,
        }),
      },
    );
  }

  const inverse = invertLegacyOp(op);
  if (!inverse) return null;
  return legacyOpToSceneOps(graph, inverse);
}

/** Revert a legacy entry through the graph, newest op first. */
export function revertLegacyEntryOnGraph(
  graph: SceneGraph, entry: readonly CompUndoOp[],
): SceneGraph {
  let out = graph;
  for (let i = entry.length - 1; i >= 0; i--) {
    const ops = invertOnGraph(out, entry[i]);
    if (ops) out = applySceneOps(out, ops);
  }
  return out;
}
