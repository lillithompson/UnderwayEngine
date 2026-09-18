/**
 * What is at this cell, and how big is this selection.
 *
 * The scene-level picking layer: it walks `sceneOrder` front-to-back,
 * honours locks, hidden flags and the mask chain, and asks the per-kind
 * geometry testers the actual question. Those testers live one layer down
 * (`compositionLineHitTest`, `compositionPathHitTest`,
 * `compositionArcHitTest`, `paintObject`); the frames they are asked in
 * come from the graph (`sceneHitFrame.leafHitFrame`), so a turned or
 * scaled member is tested in its own space rather than an approximation of
 * it.
 *
 * Split out of `compositionOps` in P7, unchanged. It only ever needed one
 * thing from that file (`computeSVGBbox`) and everything else from the
 * layers below, which is what made it the first clean cut. `compositionOps`
 * re-exports all of it, so existing importers are unaffected.
 */

import {
  CompItemKind, CompositionFigure, CompositionState, GroupNode, ImageObject,
  PaintObject, SVGObject, TextObject,
} from './types';
import { paintObjectAlphaHitTest } from './paintObject';
import { lineHitsCell as svgHitsCell } from './compositionLineHitTest';
import { arcBoundingBox } from './compositionArcHitTest';
import { GEOMETRY_ADAPTERS } from './sceneNodeGeometry';
import { svgPathHitsPoint, computeHitToleranceCells } from './compositionPathHitTest';
import {
  buildActiveMaskMap, getAncestorMasks, getGroupMaskChain, pointPassesMasks,
  clipRectToNodeMasks,
} from './compositionMask';
import { computeSVGBbox, worldMatrix } from './sceneGraph';
import { NodeHitFrame, graphOf, leafHitFrame } from './sceneHitFrame';
import {
  allDescendantMemberIds, descendantGroupIds, findRootGroupId, getItemGroupId,
  hiddenGroupIds, isGroupChainLocked,
} from './compositionNodeLookup';


// â”€â”€ Group membership helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Find the groupId for a node (figure, svg, or image) by its ID.
 * Returns undefined if the node is ungrouped or not found.
 */
export function findGroupId(state: CompositionState, nodeId: string): string | undefined {
  return getItemGroupId(state, nodeId);
}

/**
 * Split a set of moved ids into the groups they touch and the loose
 * (ungrouped) ids. Used by MOVE_FIGURES_DELTA and its commit phase to
 * route grouped ids through the group's translate (so mirror/rotation
 * baked into the GroupNode is honored) and ungrouped ids through a
 * direct world-coord shift. Without this split, shifting a grouped
 * member's local fields by (dx, dy) silently desyncs from world when
 * the group has a non-identity transform.
 */
export function bucketMovedIds(
  state: CompositionState, ids: Iterable<string>,
): { groupIds: Set<string>; ungrouped: string[] } {
  const groupIds = new Set<string>();
  const ungrouped: string[] = [];
  for (const id of ids) {
    const gid = getItemGroupId(state, id);
    if (gid) groupIds.add(gid);
    else ungrouped.push(id);
  }
  return { groupIds, ungrouped };
}

/**
 * Find the topmost SVG stroke at `(cellX, cellY)`, walking `sceneOrder`
 * front-to-back. Skips locked nodes. Figures and images are excluded â€”
 * they live in their own passes in the canvas pointer-down chain.
 */
export function findStrokeAtCell(
  state: CompositionState, cellX: number, cellY: number,
): { kind: 'svg'; id: string } | null {
  const maskMap = buildActiveMaskMap(state);
  const svgMap = new Map<string, SVGObject>();
  for (const s of state.svgObjects) svgMap.set(s.id, s);
  for (let i = state.sceneOrder.length - 1; i >= 0; i--) {
    const id = state.sceneOrder[i];
    const svg = svgMap.get(id);
    if (svg) {
      if (svgHitsCell(svg, cellX, cellY)) {
        if (maskMap.size > 0
          && !pointPassesMasks(getAncestorMasks(maskMap, state.groups, svg.groupId), id, cellX, cellY)) {
          continue; // clipped away â€” fall through to objects behind
        }
        return { kind: 'svg', id: svg.id };
      }
      continue;
    }
  }
  return null;
}

/** Bounding rectangle (in L0 cells) of every figure, svg, image, and text
 *  belonging to `groupId` (and its descendant groups when `groups` is provided).
 *  Returns Infinities if the group is empty.
 *
 *  When a non-empty `maskMap` is provided, each member's world rect is clipped
 *  to its ancestor-mask chain (via `clipRectToNodeMasks`) before being unioned,
 *  so members hidden by a mask on a nested group don't pad the bounds. The
 *  unclipped union is kept as a fallback for the degenerate case where every
 *  member is clipped away (e.g. a hidden mask leaves no visible content), so
 *  this never returns a fully-collapsed box when members exist. With no
 *  `maskMap` (or an empty one) this reduces to the plain member union â€” the
 *  behaviour the hit-test callers rely on. */
export function groupBounds(
  figures: readonly CompositionFigure[],
  groupId: string,
  svgObjects?: readonly SVGObject[],
  _arcsLegacy?: unknown,
  images?: readonly ImageObject[],
  groups?: readonly GroupNode[],
  maskMap?: ReadonlyMap<string, SVGObject>,
  texts?: readonly TextObject[],
): { minX: number; minY: number; maxX: number; maxY: number } {
  // Build the set of group IDs to include (self + descendants).
  const groupSet = groups
    ? new Set([groupId, ...descendantGroupIds(groups, groupId)])
    : new Set([groupId]);
  const clip = !!maskMap && maskMap.size > 0 && !!groups;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  // Unclipped union fallback for the all-clipped degenerate case.
  let uMinX = Infinity, uMinY = Infinity, uMaxX = -Infinity, uMaxY = -Infinity;

  const accept = (
    node: { id: string; groupId?: string },
    rMinX: number, rMinY: number, rMaxX: number, rMaxY: number,
  ) => {
    if (rMinX < uMinX) uMinX = rMinX;
    if (rMinY < uMinY) uMinY = rMinY;
    if (rMaxX > uMaxX) uMaxX = rMaxX;
    if (rMaxY > uMaxY) uMaxY = rMaxY;
    if (clip) {
      const r = clipRectToNodeMasks(maskMap!, groups!, node, rMinX, rMinY, rMaxX, rMaxY);
      if (!r) return;
      rMinX = r.minX; rMinY = r.minY; rMaxX = r.maxX; rMaxY = r.maxY;
    }
    if (rMinX < minX) minX = rMinX;
    if (rMinY < minY) minY = rMinY;
    if (rMaxX > maxX) maxX = rMaxX;
    if (rMaxY > maxY) maxY = rMaxY;
  };

  for (const f of figures) {
    if (!f.groupId || !groupSet.has(f.groupId)) continue;
    accept(f, f.cellX, f.cellY, f.cellX + f.cellWidth, f.cellY + f.cellHeight);
  }
  if (svgObjects) {
    for (const s of svgObjects) {
      if (!s.groupId || !groupSet.has(s.groupId)) continue;
      if (s.tileMode === 'repeat') {
        // A repeat-tiled object's visible extent is its cell region, not its
        // base-tile segments.
        accept(s, s.cellX, s.cellY, s.cellX + s.cellWidth, s.cellY + s.cellHeight);
      } else {
        const bb = arcBoundingBox(s.segments);
        if (bb) accept(s, bb.minX, bb.minY, bb.maxX, bb.maxY);
      }
    }
  }
  if (images) {
    for (const i of images) {
      if (!i.groupId || !groupSet.has(i.groupId)) continue;
      accept(i, i.cellX, i.cellY, i.cellX + i.cellWidth, i.cellY + i.cellHeight);
    }
  }
  if (texts) {
    for (const t of texts) {
      if (!t.groupId || !groupSet.has(t.groupId)) continue;
      accept(t, t.cellX, t.cellY, t.cellX + t.cellWidth, t.cellY + t.cellHeight);
    }
  }
  // Everything clipped away but members existed â†’ fall back to the union.
  if (minX === Infinity && uMinX !== Infinity) {
    return { minX: uMinX, minY: uMinY, maxX: uMaxX, maxY: uMaxY };
  }
  return { minX, minY, maxX, maxY };
}

/** World-space selection bounds for a group. When the group has an active mask
 *  (`maskMap` has an entry for `groupId`), the selection box hugs the mask, so
 *  the bounds are the mask's own bbox and no other member affects them.
 *  Otherwise it's the mask-aware union of members (a mask on a *nested* group
 *  still clips its siblings). Single source of truth for the selection box
 *  overlay, the scale anchor, the corner-handle hit-test, and the move anchor â€”
 *  keeping all four in agreement so there's no jump between rendering and
 *  interaction. */
export function groupSelectionBounds(
  figures: readonly CompositionFigure[],
  groupId: string,
  svgObjects: readonly SVGObject[],
  images: readonly ImageObject[] | undefined,
  groups: readonly GroupNode[],
  maskMap: ReadonlyMap<string, SVGObject> | undefined,
  texts?: readonly TextObject[],
): { minX: number; minY: number; maxX: number; maxY: number } {
  const mask = maskMap?.get(groupId);
  if (mask) {
    const bb = computeSVGBbox(mask.segments);
    return { minX: bb.cellX, minY: bb.cellY, maxX: bb.cellX + bb.cellWidth, maxY: bb.cellY + bb.cellHeight };
  }
  return groupBounds(figures, groupId, svgObjects, svgObjects, images, groups, maskMap, texts);
}

/**
 * Find the topmost figure (or figure-anchored / line-only group) at
 * `(cellX, cellY)`, walking `state.sceneOrder` front-to-back so figure z-order
 * matches what the user sees in the Scene Outline panel.
 *
 * Returns the id of the figure, or â€” when the front-most member of a group
 * is encountered â€” the id of that member as a stand-in for the whole group;
 * the caller expands the id to its group via `expandIdsToGroups`.
 *
 * `state.figures` array order is NOT consulted: the source of truth for
 * z-order is `sceneOrder`, which is the only structure that drag-to-reorder
 * in the Scene Outline mutates (`applySceneOrder`).
 */
export function findFigureAtCell(
  cellX: number, cellY: number, state: CompositionState,
): string | null {
  const maskMap = buildActiveMaskMap(state);
  const hiddenGroups = hiddenGroupIds(state.groups);
  const figMap = new Map<string, CompositionFigure>();
  for (const f of state.figures) figMap.set(f.id, f);

  // Pass 1: figures and figure-anchored groups, walked front-to-back via sceneOrder.
  const checkedGroups = new Set<string>();
  for (let i = state.sceneOrder.length - 1; i >= 0; i--) {
    const f = figMap.get(state.sceneOrder[i]);
    if (!f) continue;
    if (f.groupId) {
      if (checkedGroups.has(f.groupId)) continue;
      checkedGroups.add(f.groupId);
      if (hiddenGroups.has(f.groupId)) continue; // inherited hide
      const members = state.figures.filter(m => m.groupId === f.groupId);
      if (members.some(m => m.locked)) continue;
      if (state.svgObjects.some(s => s.groupId === f.groupId && s.locked)) continue;
      if (members.some(m => m.hidden)) continue;
      if (state.svgObjects.some(s => s.groupId === f.groupId && s.hidden)) continue;
      if ((state.images ?? []).some(i => i.groupId === f.groupId && i.hidden)) continue;
      if ((state.texts ?? []).some(t => t.groupId === f.groupId && t.hidden)) continue;
      const b = groupBounds(state.figures, f.groupId, state.svgObjects, undefined, state.images, state.groups, undefined, state.texts);
      if (cellX >= b.minX && cellX < b.maxX && cellY >= b.minY && cellY < b.maxY) {
        if (maskMap.size > 0
          && !pointPassesMasks(getGroupMaskChain(maskMap, state.groups, f.groupId), undefined, cellX, cellY)) {
          continue; // group hit clipped by its mask chain
        }
        return f.id;
      }
      continue;
    }
    if (f.locked) continue;
    if (f.hidden) continue;
    if (f.quads) {
      for (const q of f.quads) {
        const qx = f.cellX + q.offsetX;
        const qy = f.cellY + q.offsetY;
        if (cellX >= qx && cellX < qx + q.cellWidth && cellY >= qy && cellY < qy + q.cellHeight) {
          return f.id;
        }
      }
    } else if (cellX >= f.cellX && cellX < f.cellX + f.cellWidth
      && cellY >= f.cellY && cellY < f.cellY + f.cellHeight) {
      return f.id;
    }
  }

  // Pass 2: svg-only groups (groups with no figure member). Same z-order
  // walk as pass 1, kept as a fallback so an svg-only group never beats an
  // ungrouped figure that's z-above it.
  const svgMap = new Map<string, SVGObject>();
  for (const s of state.svgObjects) svgMap.set(s.id, s);
  for (let i = state.sceneOrder.length - 1; i >= 0; i--) {
    const s = svgMap.get(state.sceneOrder[i]);
    if (!s || !s.groupId || checkedGroups.has(s.groupId)) continue;
    checkedGroups.add(s.groupId);
    if (hiddenGroups.has(s.groupId)) continue; // inherited hide
    if (state.svgObjects.some(m => m.groupId === s.groupId && m.locked)) continue;
    if (state.svgObjects.some(m => m.groupId === s.groupId && m.hidden)) continue;
    const b = groupBounds(state.figures, s.groupId, state.svgObjects, undefined, state.images, state.groups, undefined, state.texts);
    if (cellX >= b.minX && cellX < b.maxX && cellY >= b.minY && cellY < b.maxY) {
      if (maskMap.size > 0
        && !pointPassesMasks(getGroupMaskChain(maskMap, state.groups, s.groupId), undefined, cellX, cellY)) {
        continue; // group hit clipped by its mask chain
      }
      return s.id;
    }
  }
  return null;
}

/**
 * Image-only bbox hit-test. Lives in a separate pass from `findFigureAtCell`
 * so the pointer-down hit sequence can run line/arc stroke proximity
 * (`findStrokeAtCell`) *before* it â€” that way a thin line painted on top of
 * an image still wins the hit, matching the visual z-order (images render
 * at the back). Without the split, the image's large bbox would always
 * swallow clicks on overlapping line strokes.
 *
 * Walks `state.sceneOrder` front-to-back â€” same z-order rule as the figure
 * and stroke passes.
 */
export function findImageAtCell(
  cellX: number, cellY: number, state: CompositionState,
): string | null {
  const stateImages = state.images ?? [];
  if (stateImages.length === 0) return null;
  const maskMap = buildActiveMaskMap(state);
  const hiddenGroups = hiddenGroupIds(state.groups);
  const imgMap = new Map<string, ImageObject>();
  for (const img of stateImages) imgMap.set(img.id, img);

  const checkedGroups = new Set<string>();
  for (let i = state.sceneOrder.length - 1; i >= 0; i--) {
    const id = state.sceneOrder[i];
    const img = imgMap.get(id);
    if (!img) continue;
    if (img.groupId) {
      if (checkedGroups.has(img.groupId)) continue;
      checkedGroups.add(img.groupId);
      if (hiddenGroups.has(img.groupId)) continue; // inherited hide
      if (stateImages.some(m => m.groupId === img.groupId && m.locked)) continue;
      if (stateImages.some(m => m.groupId === img.groupId && m.hidden)) continue;
      if (state.figures.some(f => f.groupId === img.groupId && f.hidden)) continue;
      if (state.svgObjects.some(s => s.groupId === img.groupId && s.hidden)) continue;
      if ((state.texts ?? []).some(t => t.groupId === img.groupId && t.hidden)) continue;
      const b = groupBounds(state.figures, img.groupId, state.svgObjects, undefined, state.images, state.groups, undefined, state.texts);
      if (cellX >= b.minX && cellX < b.maxX && cellY >= b.minY && cellY < b.maxY) {
        if (maskMap.size > 0
          && !pointPassesMasks(getGroupMaskChain(maskMap, state.groups, img.groupId), undefined, cellX, cellY)) {
          continue; // group hit clipped by its mask chain
        }
        return img.id;
      }
      continue;
    }
    if (img.locked) continue;
    if (img.hidden) continue;
    if (cellX >= img.cellX && cellX < img.cellX + img.cellWidth
      && cellY >= img.cellY && cellY < img.cellY + img.cellHeight) {
      return img.id;
    }
  }
  return null;
}

/**
 * Text-only bbox hit-test. Mirrors `findImageAtCell`: a separate pass so
 * the pointer-down chain can order stroke proximity ahead of the text
 * bbox, and walks `state.sceneOrder` front-to-back for z-order.
 */
export function findTextAtCell(
  cellX: number, cellY: number, state: CompositionState,
): string | null {
  const stateTexts = state.texts ?? [];
  if (stateTexts.length === 0) return null;
  const maskMap = buildActiveMaskMap(state);
  const hiddenGroups = hiddenGroupIds(state.groups);
  const txtMap = new Map<string, TextObject>();
  for (const txt of stateTexts) txtMap.set(txt.id, txt);

  const checkedGroups = new Set<string>();
  for (let i = state.sceneOrder.length - 1; i >= 0; i--) {
    const id = state.sceneOrder[i];
    const txt = txtMap.get(id);
    if (!txt) continue;
    if (txt.groupId) {
      if (checkedGroups.has(txt.groupId)) continue;
      checkedGroups.add(txt.groupId);
      if (hiddenGroups.has(txt.groupId)) continue; // inherited hide
      if (stateTexts.some(m => m.groupId === txt.groupId && m.locked)) continue;
      if (stateTexts.some(m => m.groupId === txt.groupId && m.hidden)) continue;
      if (state.figures.some(f => f.groupId === txt.groupId && f.hidden)) continue;
      if (state.svgObjects.some(s => s.groupId === txt.groupId && s.hidden)) continue;
      if ((state.images ?? []).some(m => m.groupId === txt.groupId && m.hidden)) continue;
      const b = groupBounds(state.figures, txt.groupId, state.svgObjects, undefined, state.images, state.groups, undefined, state.texts);
      if (cellX >= b.minX && cellX < b.maxX && cellY >= b.minY && cellY < b.maxY) {
        if (maskMap.size > 0
          && !pointPassesMasks(getGroupMaskChain(maskMap, state.groups, txt.groupId), undefined, cellX, cellY)) {
          continue; // group hit clipped by its mask chain
        }
        return txt.id;
      }
      continue;
    }
    if (txt.locked) continue;
    if (txt.hidden) continue;
    if (cellX >= txt.cellX && cellX < txt.cellX + txt.cellWidth
      && cellY >= txt.cellY && cellY < txt.cellY + txt.cellHeight) {
      return txt.id;
    }
  }
  return null;
}

/** Topmost scene object at the given cell across every kind, walking
 *  `sceneOrder` from front to back. Locked items and items inside a group
 *  whose dominant member is locked are skipped â€” the existing per-kind
 *  helpers (`lineHitsCell`, `arcHitsCell`) check `locked` themselves;
 *  figures/images do their own check below.
 *
 *  Figures use AABB or quad-list testing (matches the legacy figure
 *  hit-test in handleTap). Images use bbox-only. Returns the kind so
 *  callers can run kind-specific post-processing (e.g. group expansion). */
export function findSceneObjectAtCell(
  state: CompositionState, cellX: number, cellY: number,
  options?: { ignoreLock?: boolean },
): { kind: CompItemKind; id: string } | null {
  // The SCENE GRAPH is what this walk reads. Every leaf is tested in its
  // OWN frame — the query point carried through the inverse of the leaf's
  // world matrix, against the leaf's local content (sceneHitFrame) — so a
  // member of a stretched bound group answers for the parallelogram it is
  // drawn as, not for the nearest rectangle its legacy box can name, and a
  // node carrying a scale of its own answers at the size it is drawn.
  const graph = graphOf(state);

  // Zoom-dependent tolerance for SVG path hit testing, in WORLD cells. It
  // comes off the camera, so it is a world length: each node carries it
  // into its own frame by that frame's `lengthScale`.
  const toleranceCells = computeHitToleranceCells(state.viewport, state.camera);

  const maskMap = buildActiveMaskMap(state);

  // Inherited hide: a member of a hidden group (frame) draws nothing, so it
  // must not be hit-testable either. Resolved once for the whole walk (O(1)
  // membership below) instead of re-walking each node's ancestor chain.
  const hiddenGroups = hiddenGroupIds(state.groups);

  // Track the first SVG whose bbox passes but whose path misses —
  // returned as a fallback when nothing else is behind it.
  let svgBboxFallback: { kind: CompItemKind; id: string } | null = null;

  // Per-node gate shared by the selected-preference pre-pass and the main
  // front-to-back walk, so the two can never disagree about a node's
  // eligibility. Returns the node's frame and the query point IN it when
  // the node passes every guard and its content accepts the point.
  const nodeHitAt = (id: string): {
    kind: CompItemKind; frame: NodeHitFrame; hx: number; hy: number;
  } | null => {
    const node = graph.nodes.get(id);
    if (!node || node.kind === 'group') return null;
    const kind = node.kind;
    // Inherited lock: a member of a locked group (frame) acts as locked even
    // though its own `locked` flag is untouched. The per-node hitTest below
    // only checks the node's OWN flag, so skip ancestor-group-locked members
    // here. `ignoreLock` (eyedropper) bypasses this like the per-node check.
    if (!options?.ignoreLock && isGroupChainLocked(state, node.parentId)) return null;
    // Inherited hide (mirror of the lock skip above): the per-node hitTest
    // only checks the node's OWN `hidden` flag. Unlike lock, `ignoreLock`
    // does not bypass this — an invisible pixel has no color to sample.
    if (node.parentId && hiddenGroups.has(node.parentId)) return null;
    const frame = leafHitFrame(node, worldMatrix(graph, id));
    const [hx, hy] = frame.toLocal(cellX, cellY);
    if (!GEOMETRY_ADAPTERS[kind].hitTest(frame.object as never, hx, hy, options?.ignoreLock)) return null;
    // Mask gate: a member of a masked group is hit-testable only inside
    // its mask chain (the mask itself is exempt from its own clip). Sits
    // before every kind-specific accept so figures/images/tiled/selected
    // SVGs are all covered AND the svgBboxFallback stays mask-clean.
    // Returning null (not a hit) lets the caller fall through to visible
    // objects behind the clipped-away area. The masks are world geometry,
    // so this one takes the WORLD point.
    if (maskMap.size > 0
      && !pointPassesMasks(getAncestorMasks(maskMap, state.groups, node.parentId), id, cellX, cellY)) {
      return null;
    }
    return { kind, frame, hx, hy };
  };

  // Sticky selection: once an object is selected, a tap or drag anywhere
  // inside its bounding box re-grabs THAT object, even when another object
  // sits above it in z-order or has opaque pixels under the point. Without
  // this, nudging a selected object by dragging from a spot that overlaps a
  // neighbor silently switches the selection to the neighbor. Walk
  // front-to-back so the topmost selected object wins when several overlap.
  // Skipped for the eyedropper / long-press sampler (ignoreLock), which
  // sample the literal stack and must not honor the current selection.
  if (!options?.ignoreLock && state.selectedFigureIds.size > 0) {
    for (let i = state.sceneOrder.length - 1; i >= 0; i--) {
      const id = state.sceneOrder[i];
      if (!state.selectedFigureIds.has(id)) continue;
      const hit = nodeHitAt(id);
      if (hit) return { kind: hit.kind, id };
    }
  }

  // Walk sceneOrder front-to-back (last index = front).
  for (let i = state.sceneOrder.length - 1; i >= 0; i--) {
    const id = state.sceneOrder[i];
    const hit = nodeHitAt(id);
    if (!hit) continue;
    const { kind, frame, hx, hy } = hit;

    // Bbox hit confirmed.
    if (kind === 'paint') {
      // A selected island is bbox-definitive (mirrors the selected-SVG rule
      // below — normal selection is already covered by the sticky pre-pass,
      // this fires on the ignoreLock path). Otherwise only inked texels
      // take the hit, so the blank space of a sparse island falls through
      // to whatever sits behind it.
      if (state.selectedFigureIds.has(id)) return { kind, id };
      if (paintObjectAlphaHitTest(
        frame.object as PaintObject, hx, hy, toleranceCells * frame.lengthScale,
      )) return { kind, id };
      continue;
    }
    if (kind !== 'svg') return { kind, id };  // figure/image/text/pattern: bbox is definitive

    const svg = frame.object as SVGObject;
    // SVG: tiled objects fill their region, so bbox is definitive.
    if (svg.tileMode === 'repeat') return { kind, id };

    // Selected SVGs are bbox-definitive: the user has expressed intent
    // to interact with this object, so its bbox claims hits even where
    // path-distance would otherwise fall through. The sticky-selection
    // pre-pass above already covers this for normal selection; this branch
    // now only fires on the ignoreLock (eyedropper/long-press) path, where
    // the pre-pass is skipped but a selected SVG should still win its bbox.
    if (state.selectedFigureIds.has(id)) return { kind, id };

    // SVG: precise path-distance test, in the node's own frame — so the
    // tolerance comes in through `lengthScale` and a path drawn half size
    // is as easy to grab as it looks.
    const tol = toleranceCells * frame.lengthScale;
    if (svgPathHitsPoint(svg, hx, hy, tol * tol)) return { kind, id };

    // Bbox hit but path miss — record as fallback (first/topmost only).
    if (!svgBboxFallback) svgBboxFallback = { kind, id };
  }

  return svgBboxFallback;
}

/**
 * Return all member IDs (figures + svgObjects + images + texts) of a group.
 * If groupId is undefined, returns an empty array.
 */
export function groupMemberIds(state: CompositionState, groupId: string | undefined): string[] {
  if (!groupId) return [];
  return [
    ...state.figures.filter(f => f.groupId === groupId).map(f => f.id),
    ...state.svgObjects.filter(s => s.groupId === groupId).map(s => s.id),
    ...(state.images ?? []).filter(i => i.groupId === groupId).map(i => i.id),
    ...(state.texts ?? []).filter(t => t.groupId === groupId).map(t => t.id),
  ];
}

/**
 * Expand a single node ID to include all members of its root group
 * (including members of nested child groups).
 * If the node is ungrouped, returns `[nodeId]`.
 */
export function expandToGroup(state: CompositionState, nodeId: string): string[] {
  const gid = findGroupId(state, nodeId);
  if (!gid) return [nodeId];
  const rootGid = findRootGroupId(state.groups, gid);
  return allDescendantMemberIds(state, rootGid);
}

/**
 * Set-based expansion: for every id in `ids`, replace it with the full
 * leaf membership of its root group (including nested sub-groups). Ids
 * without a group are kept as themselves. Returns a deduplicated array.
 *
 * Use this anywhere a selection of leaf ids needs to be expanded to "every
 * member of any group at least one id belongs to" â€” marquee selection,
 * drag-id assembly, etc. Resolving each id to its ROOT before walking
 * descendants is what makes this safe for nested-group hierarchies.
 */
export function expandIdsToGroups(state: CompositionState, ids: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    const gid = findGroupId(state, id);
    if (gid) {
      const rootGid = findRootGroupId(state.groups, gid);
      for (const m of allDescendantMemberIds(state, rootGid)) out.add(m);
    } else {
      out.add(id);
    }
  }
  return [...out];
}

