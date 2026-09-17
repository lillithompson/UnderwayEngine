/**
 * The scene graph: one node per thing in the outline, each holding a
 * LOCAL transform, world derived by multiplying down the hierarchy.
 *
 * See docs/transform-refactor.md §3. The short version:
 *
 * - Every node — group or leaf — has a transform and a name. A group is a
 *   node with a transform and no content.
 * - Nothing stores world coordinates. A node's world matrix is the
 *   product of its ancestors' local matrices, cached by generation.
 * - `children` is the single ordering truth, back to front. The legacy
 *   trio of `groupId`, `parentGroupId` and contiguity in `sceneOrder`
 *   collapses into it.
 *
 * During the migration this lives alongside the legacy state and the two
 * converters below keep them in step: {@link fromLegacy} builds a graph
 * from legacy world fields, {@link toLegacyView} renders a graph back
 * into the six per-kind arrays every existing reader expects. The
 * converters are what make the change incremental — readers move to the
 * graph one at a time, and until the last one has, both views are live.
 */

import {
  LOCAL_IDENTITY, LocalTransform, MAT_IDENTITY, Mat2D,
  decomposeMatrix, localMatrix, matAbout, matApplyBbox, matApplyPoint, matInvert, matMul,
  normalizeDeg, respellMirror,
} from './sceneTransform';
import type { Bbox } from './transform2d';
import { contentBoxCells } from './textLayout';
import type {
  CompItemKind, CompositionFigure, CompositionState, GroupNode, ImageObject,
  PaintObject, PathSegment, PatternObject, SVGObject, SVGSubpath, TextObject,
} from './types';

// ── Node ───────────────────────────────────────────────────────────────

export type SceneNodeKind = CompItemKind | 'group';

/**
 * One node of the scene graph.
 *
 * `content` carries the legacy per-kind object for everything that is not
 * pose — colour, text, framing, cells, effects. Its own pose fields
 * (`cellX/Y/Width/Height`, `rotation`, `mirror*`, `angleDeg`, and for svg
 * `segments`) are NOT the truth here; `transform` and `localBox` /
 * `localSegments` are, and {@link toLegacyView} recomputes the legacy
 * fields from them. Keeping the payload whole is what lets the content
 * ops and the 31 engine readers keep working while they migrate.
 */
export interface SceneNode {
  readonly id: string;
  readonly kind: SceneNodeKind;
  readonly name?: string;
  /** Parent group, or undefined at the root. */
  readonly parentId?: string;
  /** Groups only: child ids, back to front. */
  readonly children?: readonly string[];
  /** Pose relative to the parent. */
  readonly transform: LocalTransform;
  readonly locked?: boolean;
  readonly hidden?: boolean;
  /** Groups only: this group is a Figma-style frame. */
  readonly isFrame?: boolean;
  /**
   * Local content box, for every kind whose content is a rectangle
   * (figure, image, text, paint, pattern). Always axis-aligned with its
   * origin at (0, 0) — the turn that used to swap its width and height
   * lives on `transform` now.
   *
   * An svg carries one too, centred on its origin: the legacy leaf's
   * stored box, which is the path's own bounds for a drawn shape but the
   * REGION a repeat-mode path tiles — content in its own right, not
   * something the path can say.
   */
  readonly localBox?: Bbox;
  /** svg only: path geometry in the node's own space. */
  readonly localSegments?: readonly PathSegment[];
  /** svg only: per-colour sub-paths, in the node's own space. */
  readonly localSubpaths?: readonly SVGSubpath[];
  /** svg only: a creation-tool H/V line's straddle box (`creationBox`),
   *  in the node's own space — it is world geometry the legacy leaf
   *  carries beside its path, so it rides the transform the same way. */
  readonly localCreationBox?: Bbox;
  /** The legacy object, for everything that is not pose. */
  readonly content?: LegacyLeaf;
}

export type LegacyLeaf =
  | CompositionFigure | SVGObject | ImageObject
  | TextObject | PaintObject | PatternObject;

/**
 * A whole scene. `nodes` is keyed by id; `roots` is the top level, back
 * to front.
 *
 * Copy-on-write: an op returns a new graph sharing every untouched node,
 * so a reader can compare node identity to see what changed (which is
 * how the reducer decides what to re-render). `generation` bumps when any
 * transform or parentage changes, which is what invalidates the world
 * cache.
 */
export interface SceneGraph {
  readonly nodes: ReadonlyMap<string, SceneNode>;
  readonly roots: readonly string[];
  readonly generation: number;
}

export const EMPTY_GRAPH: SceneGraph = {
  nodes: new Map(), roots: [], generation: 0,
};

// ── Walking ────────────────────────────────────────────────────────────

/** The node, or undefined. */
export function getNode(graph: SceneGraph, id: string): SceneNode | undefined {
  return graph.nodes.get(id);
}

/** Ancestors from the immediate parent up to the root. */
export function ancestors(graph: SceneGraph, id: string): SceneNode[] {
  const out: SceneNode[] = [];
  let cur = graph.nodes.get(id)?.parentId;
  const seen = new Set<string>([id]);
  while (cur && !seen.has(cur)) {
    const node = graph.nodes.get(cur);
    if (!node) break;
    out.push(node);
    seen.add(cur);
    cur = node.parentId;
  }
  return out;
}

/**
 * Every node under `id` (not including it), in back-to-front order.
 * Depth-first through `children`, which is the paint order.
 */
export function descendants(graph: SceneGraph, id: string): SceneNode[] {
  const out: SceneNode[] = [];
  const walk = (nodeId: string) => {
    for (const childId of graph.nodes.get(nodeId)?.children ?? []) {
      const child = graph.nodes.get(childId);
      if (!child) continue;
      out.push(child);
      walk(childId);
    }
  };
  walk(id);
  return out;
}

/**
 * Every leaf in the graph, back to front — the derived replacement for
 * `sceneOrder`. Groups are skipped; their children appear in place, which
 * is what made group members contiguous in the legacy array and is now
 * simply how a tree flattens.
 */
export function flattenLeaves(graph: SceneGraph): SceneNode[] {
  const out: SceneNode[] = [];
  const walk = (ids: readonly string[]) => {
    for (const id of ids) {
      const node = graph.nodes.get(id);
      if (!node) continue;
      if (node.kind === 'group') walk(node.children ?? []);
      else out.push(node);
    }
  };
  walk(graph.roots);
  return out;
}

// ── World transforms ───────────────────────────────────────────────────

/**
 * Lazily computed world matrices, invalidated wholesale by generation.
 *
 * Steady-state rendering hits the cache every time: transforms change
 * only on a gesture commit, which bumps the generation once and lets the
 * affected nodes recompute on next read. Strictly cheaper than the legacy
 * eager `materializeGroupMembers` + per-member reconcile, and it is what
 * keeps the parent-chain walk out of the render loop.
 */
const worldCache = new WeakMap<ReadonlyMap<string, SceneNode>, Map<string, Mat2D>>();

/**
 * The node's local-to-world matrix.
 *
 * Memoised per *nodes map*, which is the only correct key: a node's world
 * matrix is a pure function of the map it lives in, and ops are
 * copy-on-write, so a map that has not been replaced cannot have moved
 * anything. Keying on `generation` instead would be a trap — every graph
 * `fromLegacy` builds starts at generation 0, so one scene would be
 * served another's matrices. A WeakMap also means nobody has to remember
 * to invalidate, and a dropped graph's cache is collected with it.
 */
export function worldMatrix(graph: SceneGraph, id: string): Mat2D {
  let cache = worldCache.get(graph.nodes);
  if (!cache) {
    cache = new Map();
    worldCache.set(graph.nodes, cache);
  }
  return cachedWorld(graph, id, cache, new Set());
}

function cachedWorld(
  graph: SceneGraph, id: string,
  cache: Map<string, Mat2D>, visiting: Set<string>,
): Mat2D {
  const hit = cache.get(id);
  if (hit) return hit;

  const node = graph.nodes.get(id);
  // A parent cycle in broken data would otherwise recurse until the stack
  // gave out, on someone's page, at load time.
  if (!node || visiting.has(id)) return MAT_IDENTITY;
  visiting.add(id);
  const parent = node.parentId
    ? cachedWorld(graph, node.parentId, cache, visiting)
    : MAT_IDENTITY;
  visiting.delete(id);

  const world = matMul(parent, localMatrix(node.transform));
  cache.set(id, world);
  return world;
}

/** The matrix that takes a point in `id`'s parent's space to world. */
export function parentMatrix(graph: SceneGraph, id: string): Mat2D {
  const parentId = graph.nodes.get(id)?.parentId;
  return parentId ? worldMatrix(graph, parentId) : MAT_IDENTITY;
}

function parentWorldOf(graph: SceneGraph, node: SceneNode): Mat2D {
  return node.parentId ? worldMatrix(graph, node.parentId) : MAT_IDENTITY;
}

/**
 * The node's world-space AABB.
 *
 * For a rotated or sheared node this is larger than the node — the
 * bounding box of its four mapped corners. A caller that needs the shape
 * rather than its extent reads `worldMatrix` and maps the corners.
 */
export function worldBbox(graph: SceneGraph, id: string): Bbox {
  const node = graph.nodes.get(id);
  if (!node) return { x: 0, y: 0, width: 0, height: 0 };
  const m = worldMatrix(graph, id);
  if (node.kind === 'group') {
    return unionBbox(descendants(graph, node.id)
      .filter((n) => n.kind !== 'group')
      .map((n) => worldBbox(graph, n.id)));
  }
  if (node.localBox) return matApplyBbox(m, node.localBox);
  if (node.localSegments) return matApplyBbox(m, segmentsBbox(node.localSegments));
  return matApplyBbox(m, { x: 0, y: 0, width: 0, height: 0 });
}

/** The node's path geometry in world space. svg kinds only. */
export function worldSegments(graph: SceneGraph, id: string): PathSegment[] {
  const node = graph.nodes.get(id);
  if (!node?.localSegments) return [];
  return mapSegments(node.localSegments, worldMatrix(graph, id));
}

function unionBbox(boxes: readonly Bbox[]): Bbox {
  if (boxes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width); maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ── Segment geometry ───────────────────────────────────────────────────

/** Map every vertex of a path through a matrix. */
export function mapSegments(
  segments: readonly PathSegment[], m: Mat2D,
): PathSegment[] {
  return segments.map((seg) => seg.kind === 'arc'
    ? {
      kind: 'arc' as const,
      start: matApplyPoint(m, seg.start[0], seg.start[1]),
      end: matApplyPoint(m, seg.end[0], seg.end[1]),
      center: matApplyPoint(m, seg.center[0], seg.center[1]),
    }
    : {
      kind: 'line' as const,
      start: matApplyPoint(m, seg.start[0], seg.start[1]),
      end: matApplyPoint(m, seg.end[0], seg.end[1]),
    });
}

/** `next`, or `prev` itself when every vertex is exactly the same. */
function sameGeometry(next: PathSegment[], prev: readonly PathSegment[] | undefined): PathSegment[] {
  if (!prev || prev.length !== next.length) return next;
  for (let i = 0; i < next.length; i++) {
    const a = next[i], b = prev[i];
    if (a.kind !== b.kind) return next;
    if (a.start[0] !== b.start[0] || a.start[1] !== b.start[1]) return next;
    if (a.end[0] !== b.end[0] || a.end[1] !== b.end[1]) return next;
    if (a.kind === 'arc' && b.kind === 'arc'
      && (a.center[0] !== b.center[0] || a.center[1] !== b.center[1])) return next;
  }
  return prev as PathSegment[];
}

function mapSubpaths(
  subpaths: readonly SVGSubpath[], m: Mat2D,
): SVGSubpath[] {
  return subpaths.map((sp) => ({ ...sp, segments: mapSegments(sp.segments, m) }));
}

/** AABB of a path's vertices. Arc bulge is not accounted for — this is
 *  the same approximation the legacy `computeSVGBbox` makes, kept so the
 *  two agree during the migration. */
export function segmentsBbox(segments: readonly PathSegment[]): Bbox {
  if (segments.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const see = (p: readonly [number, number]) => {
    minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]);
  };
  for (const seg of segments) { see(seg.start); see(seg.end); }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ── Legacy → graph ─────────────────────────────────────────────────────

/** The pose fields a legacy leaf carries, whatever its kind. */
interface LegacyPose {
  cellX: number; cellY: number; cellWidth: number; cellHeight: number;
  rotation?: 0 | 90 | 180 | 270;
  mirrorH?: boolean; mirrorV?: boolean;
  angleDeg?: number;
}

/**
 * The world matrix a legacy leaf's pose fields describe.
 *
 * Reproduces exactly what the renderer builds (`orientedInnerStyle` in
 * NodeLayer): the content box is centred in the world bbox, then flipped,
 * then given its quarter turn, then its free angle — every step about
 * that centre. Hence one continuous rotation of `rotation + angleDeg`,
 * and a translation that puts the content box's centre on the bbox's.
 *
 * The content box is the *un-turned* box: a 90 or 270 swaps the world
 * bbox's width and height, so it is swapped back here. That swap
 * disappears entirely in the new model — the box is local, and its world
 * footprint is derived.
 */
function poseToTransform(p: LegacyPose): { transform: LocalTransform; localBox: Bbox } {
  const content = contentBoxCells(p);
  const localBox: Bbox = { x: 0, y: 0, width: content.width, height: content.height };
  const rotationDeg = normalizeDeg((p.rotation ?? 0) + (p.angleDeg ?? 0));
  const linear = localMatrix({
    ...LOCAL_IDENTITY, rotationDeg,
    ...(p.mirrorH ? { mirrorH: true } : {}),
    ...(p.mirrorV ? { mirrorV: true } : {}),
  });
  // Put the content box's centre on the world bbox's centre.
  const cx = p.cellX + p.cellWidth / 2;
  const cy = p.cellY + p.cellHeight / 2;
  const hw = content.width / 2, hh = content.height / 2;
  return {
    localBox,
    transform: {
      tx: cx - (linear.a * hw + linear.c * hh),
      ty: cy - (linear.b * hw + linear.d * hh),
      sx: 1, sy: 1, rotationDeg,
      ...(p.mirrorH ? { mirrorH: true } : {}),
      ...(p.mirrorV ? { mirrorV: true } : {}),
    },
  };
}

/** The centre of a path's bounding box. */
function centreOf(segments: readonly PathSegment[]): [number, number] {
  const b = segmentsBbox(segments);
  return [b.x + b.width / 2, b.y + b.height / 2];
}

/**
 * Build a graph from legacy state, reading **world fields only**.
 *
 * The persisted `local*` caches are deliberately ignored. World is what
 * the user saw, and a file can carry local caches that disagree with it
 * (the loader backfills the missing ones but never the wrong ones — see
 * `materializeGroupHierarchy`). Deriving locals fresh is what finally
 * makes the two agree, by having only one of them.
 */
export function fromLegacy(state: CompositionState): SceneGraph {
  const nodes = new Map<string, SceneNode>();

  // 1. Groups, with their own transforms. A GroupNode's legacy transform
  //    scales after rotating; `fromTransform2D` handles the swap.
  for (const g of state.groups ?? []) {
    nodes.set(g.id, {
      id: g.id, kind: 'group', name: g.name,
      parentId: g.parentGroupId,
      children: [],
      transform: groupTransform(g),
      ...(g.locked ? { locked: true } : {}),
      ...(g.hidden ? { hidden: true } : {}),
      ...(g.isFrame ? { isFrame: true } : {}),
    });
  }

  // 2. A group's world matrix, so a member's local pose can be found by
  //    dividing it out. Computed here rather than through the cache
  //    because the graph is still being built.
  const groupWorld = new Map<string, Mat2D>();
  const worldOf = (id: string | undefined): Mat2D => {
    if (!id) return MAT_IDENTITY;
    const hit = groupWorld.get(id);
    if (hit) return hit;
    const node = nodes.get(id);
    if (!node) return MAT_IDENTITY;
    // Guard against a cycle in malformed data rather than recursing away.
    groupWorld.set(id, MAT_IDENTITY);
    const m = matMul(worldOf(node.parentId), localMatrix(node.transform));
    groupWorld.set(id, m);
    return m;
  };
  for (const id of nodes.keys()) worldOf(id);

  // 3. Leaves. Each one's world pose is read off its world fields, then
  //    divided by its group's world matrix to give a local transform.
  const addLeaf = (kind: CompItemKind, leaf: LegacyLeaf) => {
    nodes.set(leaf.id, leafNodeFromLegacy(kind, leaf, safeInvert(worldOf(leaf.groupId))));
  };

  for (const f of state.figures ?? []) addLeaf('figure', f);
  for (const s of state.svgObjects ?? []) addLeaf('svg', s);
  for (const i of state.images ?? []) addLeaf('image', i);
  for (const t of state.texts ?? []) addLeaf('text', t);
  for (const p of state.paintObjects ?? []) addLeaf('paint', p);
  for (const p of state.patternObjects ?? []) addLeaf('pattern', p);

  // 4. Child order, from `sceneOrder` (back to front). A group takes the
  //    position of its back-most member, which is what the outline
  //    already derives and what group contiguity was enforcing.
  linkChildren(nodes, state.sceneOrder ?? []);

  return { nodes, roots: computeRoots(nodes, state.sceneOrder ?? []), generation: 0 };
}

/**
 * One legacy leaf as a graph node, its pose read off its world fields.
 *
 * `toLocal` is the inverse of the parent group's world matrix — the
 * identity for a leaf at the root, or for a caller that wants the world
 * pose itself: a renderer drawing an object that is not in any graph (a
 * ghost, a live-resize preview) gets the very node `fromLegacy` would
 * build for it, so the two cannot draw the same fields differently.
 */
export function leafNodeFromLegacy(
  kind: CompItemKind, leaf: LegacyLeaf, toLocal: Mat2D = MAT_IDENTITY,
): SceneNode {
  const pose = leaf as unknown as LegacyPose;
  const parentId = leaf.groupId;

  if (kind === 'svg') {
    const svg = leaf as SVGObject;
    // An svg's segments are world coordinates with its quarter turns
    // already baked in — as they always have been — and its free angle
    // applied at draw time, about the bbox centre. So: centre the
    // geometry on the node's own origin, and put the free angle on the
    // TRANSFORM, where every other kind keeps its turn. Rotating about
    // the origin is then rotating the shape about its centre, which is
    // what the angle always meant.
    //
    // Baking the angle into the vertices instead renders identically
    // and loses something the editor needs: the rotate slider seats on
    // that angle, a flip leans it the other way, a multi-selection
    // reports it per member. A model with the angle folded into
    // vertices has nowhere to answer those from.
    const segments = svg.segments ?? [];
    // The node's origin is the centre of the STORED box, which is what
    // the renderer turns the path about. For a drawn shape that is the
    // path's own centre; for a repeat-mode path it is the region's.
    const c: [number, number] = svg.cellWidth !== undefined && svg.cellHeight !== undefined
      ? [svg.cellX + svg.cellWidth / 2, svg.cellY + svg.cellHeight / 2]
      : centreOf(segments);
    const spun = matMul(
      { ...MAT_IDENTITY, e: c[0], f: c[1] },
      localMatrix({ ...LOCAL_IDENTITY, rotationDeg: pose.angleDeg ?? 0 }),
    );
    return {
      id: leaf.id, kind: 'svg', name: leaf.name, parentId,
      transform: decomposeMatrix(matMul(toLocal, spun)),
      localSegments: mapSegments(segments, { ...MAT_IDENTITY, e: -c[0], f: -c[1] }),
      ...(svg.cellWidth !== undefined && svg.cellHeight !== undefined ? {
        localBox: {
          x: svg.cellX - c[0], y: svg.cellY - c[1],
          width: svg.cellWidth, height: svg.cellHeight,
        },
      } : {}),
      ...(svg.subpaths ? {
        localSubpaths: mapSubpaths(svg.subpaths, { ...MAT_IDENTITY, e: -c[0], f: -c[1] }),
      } : {}),
      ...(svg.creationBox ? {
        localCreationBox: {
          x: svg.creationBox.minX - c[0], y: svg.creationBox.minY - c[1],
          width: svg.creationBox.width, height: svg.creationBox.height,
        },
      } : {}),
      ...(leaf.locked ? { locked: true } : {}),
      content: leaf,
    };
  }

  const { transform: world, localBox } = poseToTransform(pose);
  return {
    id: leaf.id, kind, name: leaf.name, parentId,
    // A grouped leaf's local pose is its world pose with the group
    // divided out; spelled with the leaf's own flips where that fits, so
    // the view keeps reading a mirrored member as mirrored.
    transform: parentId
      ? respellMirror(decomposeMatrix(matMul(toLocal, localMatrix(world))), world)
      : world,
    localBox,
    ...(leaf.locked ? { locked: true } : {}),
    content: leaf,
  };
}

/** A group's local transform, from its legacy fields. */
function groupTransform(g: GroupNode): LocalTransform {
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

/** Invert, or fall back to the identity for a collapsed ancestor rather
 *  than throwing while loading someone's page. */
function safeInvert(m: Mat2D): Mat2D {
  try { return matInvert(m); } catch { return MAT_IDENTITY; }
}

/**
 * Fill in each group's `children`, ordered by `sceneOrder`.
 *
 * A node's position is the position of its back-most leaf, so a group
 * sits where its members sit. Anything missing from `sceneOrder` is
 * appended in insertion order rather than dropped — a repaired scene
 * order is better than a lost node.
 */
function linkChildren(nodes: Map<string, SceneNode>, sceneOrder: readonly string[]): void {
  const rank = new Map<string, number>();
  sceneOrder.forEach((id, i) => rank.set(id, i));

  // A group's rank is its back-most descendant leaf's. `visiting` guards
  // a parent cycle in malformed data, which would otherwise recurse until
  // the stack gave out while opening someone's page.
  const visiting = new Set<string>();
  const rankOf = (id: string): number => {
    const direct = rank.get(id);
    if (direct !== undefined) return direct;
    if (visiting.has(id)) return Infinity;
    visiting.add(id);
    let best = Infinity;
    for (const [childId, child] of nodes) {
      if (child.parentId !== id) continue;
      best = Math.min(best, rankOf(childId));
    }
    visiting.delete(id);
    return best;
  };

  const byParent = new Map<string | undefined, string[]>();
  let fallback = sceneOrder.length;
  const order = new Map<string, number>();
  for (const [id, node] of nodes) {
    const r = rankOf(id);
    order.set(id, Number.isFinite(r) ? r : fallback++);
    const bucket = byParent.get(node.parentId) ?? [];
    bucket.push(id);
    byParent.set(node.parentId, bucket);
  }

  for (const [parentId, childIds] of byParent) {
    if (parentId === undefined) continue;
    const parent = nodes.get(parentId);
    if (!parent) continue;
    childIds.sort((a, b) => order.get(a)! - order.get(b)!);
    nodes.set(parentId, { ...parent, children: childIds });
  }
  // Stash the root ordering for computeRoots.
  rootOrder.set(nodes, order);
}

/** Ordering side-table, consumed immediately by `computeRoots`. */
const rootOrder = new WeakMap<Map<string, SceneNode>, Map<string, number>>();

function computeRoots(nodes: Map<string, SceneNode>, sceneOrder: readonly string[]): string[] {
  const order = rootOrder.get(nodes) ?? new Map<string, number>();
  const roots: string[] = [];
  for (const [id, node] of nodes) {
    if (!node.parentId || !nodes.has(node.parentId)) roots.push(id);
  }
  roots.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  void sceneOrder;
  return roots;
}

// ── Graph → legacy ─────────────────────────────────────────────────────

/** The six per-kind arrays plus groups and paint order — what every
 *  reader that has not migrated still expects to find on the state. */
export interface LegacyView {
  figures: CompositionFigure[];
  svgObjects: SVGObject[];
  images: ImageObject[];
  texts: TextObject[];
  paintObjects: PaintObject[];
  patternObjects: PatternObject[];
  groups: GroupNode[];
  sceneOrder: string[];
}

/**
 * Render a graph back into legacy world-field objects.
 *
 * The adapter that keeps the migration incremental: while readers move to
 * the graph one at a time, this is what the rest keep reading. When the
 * last one has moved, this and the legacy fields go together.
 *
 * World poses come out of the world matrices, so a node that the graph
 * places somewhere is a leaf that reports being there — the two views
 * cannot disagree, which is the whole point of having one source of
 * truth.
 */
export function toLegacyView(graph: SceneGraph): LegacyView {
  const view: LegacyView = {
    figures: [], svgObjects: [], images: [], texts: [],
    paintObjects: [], patternObjects: [], groups: [], sceneOrder: [],
  };

  for (const node of graph.nodes.values()) {
    if (node.kind !== 'group') continue;
    view.groups.push(toGroupNode(graph, node));
  }

  for (const leaf of flattenLeaves(graph)) {
    view.sceneOrder.push(leaf.id);
    const out = toLegacyLeaf(graph, leaf);
    switch (leaf.kind) {
      case 'figure': view.figures.push(out as CompositionFigure); break;
      case 'svg': view.svgObjects.push(out as SVGObject); break;
      case 'image': view.images.push(out as ImageObject); break;
      case 'text': view.texts.push(out as TextObject); break;
      case 'paint': view.paintObjects.push(out as PaintObject); break;
      case 'pattern': view.patternObjects.push(out as PatternObject); break;
    }
  }
  return view;
}

function toGroupNode(graph: SceneGraph, node: SceneNode): GroupNode {
  const t = node.transform;
  const quarter = nearestQuarterTurn(t.rotationDeg);
  const swap = quarter === 90 || quarter === 270;
  void graph;
  return {
    id: node.id,
    name: node.name ?? 'Group',
    translateX: t.tx, translateY: t.ty,
    scaleX: swap ? t.sy : t.sx,
    scaleY: swap ? t.sx : t.sy,
    rotation: quarter,
    mirrorH: !!t.mirrorH,
    mirrorV: !!t.mirrorV,
    ...(node.parentId ? { parentGroupId: node.parentId } : {}),
    ...(node.locked ? { locked: true } : {}),
    ...(node.hidden ? { hidden: true } : {}),
    ...(node.isFrame ? { isFrame: true } : {}),
  };
}

/** True when the angle is a quarter turn, to within float noise. */
function isQuarterTurn(deg: number): boolean {
  const off = normalizeDeg(deg) % 90;
  return off < 1e-6 || 90 - off < 1e-6;
}

function nearestQuarterTurn(deg: number): 0 | 90 | 180 | 270 {
  const q = (Math.round(normalizeDeg(deg) / 90) * 90) % 360;
  return (q === 90 || q === 180 || q === 270 ? q : 0) as 0 | 90 | 180 | 270;
}

/**
 * One leaf, as the legacy arrays want it: the content payload with its
 * world pose fields recomputed from the graph.
 *
 * The world pose is split back into the legacy pair of channels the same
 * way it was joined: the nearest quarter turn becomes `rotation` (which
 * swaps the bbox dimensions), and what is left over becomes `angleDeg`.
 */
/** How the leaf spelled its orientation before, so the view can keep
 *  saying it the same way where more than one spelling fits. */
interface CarriedSpelling {
  rotation?: 0 | 90 | 180 | 270;
  mirrorH?: boolean;
}

/** The legacy pose fields a matrix implies for a local box. */
interface PoseFields {
  cellX: number; cellY: number; cellWidth: number; cellHeight: number;
  rotation?: 0 | 90 | 180 | 270;
  mirrorH?: boolean; mirrorV?: boolean;
  angleDeg?: number;
}

/**
 * Split a matrix back into the legacy pair of rotation channels.
 *
 * The graph holds ONE continuous rotation; legacy holds two, a quarter
 * turn that swaps the bbox and a free angle that does not. The split is
 * not recoverable from the total, so the discrete part comes from the
 * leaf's own `rotation`: a leaf that never had a discrete channel keeps
 * none and the whole turn is free, whatever its size; a leaf that had one
 * keeps it, unless the total is itself a quarter turn, in which case it
 * is all discrete and the bbox swaps. Both spellings render the same;
 * they differ in the box they report and in the box the leaf's other
 * fields are read against — a tile offset, a paint island's content rect
 * — and a leaf whose content was authored against its un-turned box must
 * keep reporting that box. This is also what keeps a page's stored boxes
 * unmoved across the conversion.
 *
 * Used for BOTH the world fields and the `local*` caches, from the world
 * matrix and the local one respectively — one derivation, so the two
 * cannot say different things about the same node.
 */
function poseFieldsFrom(
  m: Mat2D, local: Bbox, carried: CarriedSpelling,
): PoseFields {
  const t = decomposeMatrix(m);
  // `decomposeMatrix` puts every flip in `sy`, so a mirrored node always
  // comes back as a vertical flip. A flip about one axis is a flip about
  // the other plus a half turn — `(theta, V)` and `(theta - 180, H)` are
  // the same matrix — so when the leaf came in mirrored horizontally, say
  // it that way. Nothing renders differently; it keeps the field the
  // editor wrote reading back as the editor wrote it.
  const flipped = t.sy < 0;
  const preferH = flipped && !!carried.mirrorH;
  const turn = normalizeDeg(preferH ? t.rotationDeg - 180 : t.rotationDeg);

  const quarter = carried.rotation === undefined
    ? 0
    : isQuarterTurn(turn) ? nearestQuarterTurn(turn) : carried.rotation;
  const residual = normalizeDeg(turn - quarter);

  // The content box, scaled — the box the turn is applied to.
  const cw = local.width * Math.abs(t.sx);
  const ch = local.height * Math.abs(t.sy);
  const swap = quarter === 90 || quarter === 270;
  const cellWidth = swap ? ch : cw;
  const cellHeight = swap ? cw : ch;
  const [cx, cy] = matApplyPoint(m, local.x + local.width / 2, local.y + local.height / 2);

  return {
    cellX: cx - cellWidth / 2,
    cellY: cy - cellHeight / 2,
    cellWidth, cellHeight,
    // Omitted rather than zero, as the legacy arrays have always had it:
    // an un-turned leaf carries no rotation field at all, and a view that
    // added one would not compare equal to the thing it stands in for.
    rotation: quarter || undefined,
    // Read the flips off the matrix, never off a stored flag: a flip is
    // already folded into the rotation by the time a chain is multiplied
    // out — a node turned 270 and flipped twice is one turned 90 — so
    // taking both would count it twice. `decomposeMatrix` puts the whole
    // handedness flip in `sy`, which is why only `mirrorV` comes back.
    mirrorH: preferH || undefined,
    mirrorV: (flipped && !preferH) || undefined,
    angleDeg: residual === 0 ? undefined : residual,
  };
}

/**
 * One leaf, as the legacy arrays want it: the content payload with its
 * pose fields recomputed from the graph.
 *
 * The `local*` caches are deliberately CLEARED, not filled in.
 *
 * They were a second copy of a grouped leaf's pose, kept in step by hand,
 * and the copy going stale is what made a member of a group jump the next
 * time the group moved. Emitting a derived copy sounds safer and is
 * worse: the legacy materialize pass composes a group chain by D4 rules —
 * quarter turns and flags — which cannot express an arbitrary continuous
 * local turn, so the copy and the world pose would disagree again, by a
 * different route. Absent caches say the right thing instead. The
 * materialize pass leaves a leaf with no locals alone, which for a
 * graph-backed leaf is exactly correct: the graph is the truth, and the
 * world fields below are already derived from it.
 */
function toLegacyLeaf(graph: SceneGraph, node: SceneNode): LegacyLeaf {
  const world = worldMatrix(graph, node.id);
  const key = node.content ?? node;
  const hit = viewCache.get(key);
  if (hit && sameView(hit, node, world)) return hit.out;
  const rendered = renderLegacyLeaf(graph, node, world);
  // A leaf the graph has not moved since its content was read renders to
  // exactly the fields it already carries: hand back the content object
  // itself, so a composition that never asked for a graph — the legacy
  // reducer path — keeps the copy-on-write identity its readers rely on.
  const out = node.content && sameFields(rendered, node.content) ? node.content : rendered;
  const entry: ViewEntry = { world, parentId: node.parentId, name: node.name, out };
  viewCache.set(key, entry);
  // The rendered leaf is its own content at this pose: a later graph built
  // from these arrays carries it as `content`, and must hand it straight
  // back rather than a fresh copy of it.
  viewCache.set(out, entry);
  return out;
}

/**
 * One rendered leaf per (content, world pose), kept by identity.
 *
 * The legacy reducer is copy-on-write — an untouched leaf comes out of an
 * op as the SAME object — and readers lean on that: the node layer's
 * per-node memo, the symmetry mirror's "what did this entry touch" diff,
 * the engine's own rewritten-leaf scan. A view that rendered every leaf
 * afresh on every pose op would re-render the whole page for one drag and
 * tell the mirror that everything moved. So a leaf whose content object,
 * world matrix, parent and name are what they were last time is handed
 * back as the very object it was last time.
 */
interface ViewEntry {
  world: Mat2D;
  parentId?: string;
  name?: string;
  out: LegacyLeaf;
}
const viewCache = new WeakMap<object, ViewEntry>();

/** Shallow field equality, an absent key and an `undefined` one alike. */
function sameFields(a: object, b: object): boolean {
  const ra = a as Record<string, unknown>, rb = b as Record<string, unknown>;
  for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
    if (ra[k] !== rb[k]) return false;
  }
  return true;
}

function sameView(e: ViewEntry, node: SceneNode, world: Mat2D): boolean {
  const w = e.world;
  return e.parentId === node.parentId && e.name === node.name
    && w.a === world.a && w.b === world.b && w.c === world.c
    && w.d === world.d && w.e === world.e && w.f === world.f;
}

function renderLegacyLeaf(graph: SceneGraph, node: SceneNode, world: Mat2D): LegacyLeaf {
  const base = { ...(node.content ?? { id: node.id }) } as LegacyLeaf & LegacyPose & Record<string, unknown>;
  base.id = node.id;
  if (node.name !== undefined) base.name = node.name;
  base.groupId = node.parentId;

  if (node.kind === 'svg') {
    const svg = base as SVGObject;
    // The node's own free angle comes off the transform; everything the
    // ancestors contribute stays baked into the vertices, which is where
    // the legacy materialize pass always put it. Un-turning by exactly
    // that angle recovers the segments the legacy model stores.
    const spin = normalizeDeg(
      decomposeMatrix(world).rotationDeg
      - decomposeMatrix(parentWorldOf(graph, node)).rotationDeg,
    );
    // The renderer turns the stored path by `spin` about its bbox centre,
    // so the stored path is the DRAWN path turned back by `spin` about
    // that same centre — the world matrix with the spin taken off its
    // OUTSIDE. Taking it off the inside (`world . R(-spin)`) is only the
    // same thing when the world scale is uniform: under a group pulled
    // off-square the two differ by exactly the shear, and a quarter-turned
    // member came out stretched along the wrong axis.
    const localCentre: [number, number] = node.localBox
      ? [node.localBox.x + node.localBox.width / 2, node.localBox.y + node.localBox.height / 2]
      : centreOf(node.localSegments ?? []);
    const drawnCentre = matApplyPoint(world, localCentre[0], localCentre[1]);
    const unturned = matMul(
      matAbout(drawnCentre, localMatrix({ ...LOCAL_IDENTITY, rotationDeg: -spin })),
      world,
    );
    // The geometry arrays are reused from the content where the render
    // lands exactly on them, so a path the graph has not moved keeps its
    // identity (see the view cache) instead of an equal copy.
    const was = node.content as SVGObject | undefined;
    svg.segments = sameGeometry(mapSegments(node.localSegments ?? [], unturned), was?.segments);
    if (node.localSubpaths) {
      const subpaths = mapSubpaths(node.localSubpaths, unturned);
      svg.subpaths = was?.subpaths && subpaths.length === was.subpaths.length
        && subpaths.every((sp, i) => sameGeometry(sp.segments, was.subpaths![i].segments) === was.subpaths![i].segments)
        ? was.subpaths : subpaths;
    }
    if (node.localCreationBox) {
      // The straddle box rides the same matrix as the path; its image is
      // taken as a box again, exact for every turn the box can survive.
      const b = matApplyBbox(unturned, node.localCreationBox);
      const box = { minX: b.x, minY: b.y, width: b.width, height: b.height };
      const old = was?.creationBox;
      svg.creationBox = old && old.minX === box.minX && old.minY === box.minY
        && old.width === box.width && old.height === box.height ? old : box;
    }
    // The stored box: the carried one where there is one (a repeat-mode
    // path's region; a drawn shape's own bounds), else the path's bounds.
    const bb = node.localBox ? matApplyBbox(unturned, node.localBox) : segmentsBbox(svg.segments);
    svg.cellX = bb.x; svg.cellY = bb.y;
    svg.cellWidth = bb.width; svg.cellHeight = bb.height;
    svg.angleDeg = spin === 0 ? undefined : spin;
    svg.localSegments = undefined;
    svg.localSubpaths = undefined;
    svg.localCellX = undefined; svg.localCellY = undefined;
    svg.localCellWidth = undefined; svg.localCellHeight = undefined;
    scaleContentLengths(svg as unknown as Record<string, unknown>, world);
    return svg;
  }

  const local = node.localBox ?? { x: 0, y: 0, width: 0, height: 0 };
  const was = node.content as CarriedSpelling | undefined;
  Object.assign(base, poseFieldsFrom(world, local, {
    rotation: was?.rotation,
    // A flip the node's own transform names horizontally reads back that
    // way — the flag a gesture respelled onto it, or the one the leaf came
    // in with, either says the user thinks of this as a horizontal flip.
    mirrorH: was?.mirrorH || node.transform.mirrorH,
  }));
  scaleContentLengths(base, world);

  base.localCellX = undefined; base.localCellY = undefined;
  base.localCellWidth = undefined; base.localCellHeight = undefined;
  base.localRotation = undefined;
  base.localMirrorH = undefined; base.localMirrorV = undefined;
  base.localAngleDeg = undefined;
  return base;
}

/**
 * Scale the lengths a leaf's CONTENT carries in world units by the
 * node's world scale, so the legacy view says what a scaled node renders
 * as.
 *
 * The legacy leaf has no scale channel: its box is its size, and the
 * things drawn inside it that have a size of their own — a text's type,
 * a repeat-mode tile pitch and offset — are stored in world cells too. A
 * node the graph has scaled (a pinch, a group resize) therefore needs
 * those lengths scaled along with its box, or the view would report a
 * bigger box with the same type reflowed inside it and the same tile
 * repeated more times — precisely what the live preview does not draw.
 *
 * `content` holds those lengths as they stood when the graph was last
 * built from the arrays, at which point every leaf's own scale was 1
 * (`fromLegacy` reads sizes into the local box, never into `sx`/`sy`).
 * So the factor is the node's world scale outright, and a content op —
 * which rebuilds the graph from this view — folds it back into the
 * content, where it stays at scale 1 again. Nothing is counted twice.
 *
 * Type takes the SMALLER axis factor: it cannot be stretched by the
 * legacy renderer, and the smaller factor is the one that keeps it inside
 * a box pulled off-square. A uniform scale, which is what a pinch and a
 * diagonal corner drag produce, is exact. Rendering the glyphs through
 * the matrix — stretched and all — is what the render phase of the
 * refactor brings; this is the view saying the same thing as nearly as
 * it can until then.
 */
function scaleContentLengths(leaf: Record<string, unknown>, world: Mat2D): void {
  const t = decomposeMatrix(world);
  const kx = Math.abs(t.sx), ky = Math.abs(t.sy);
  const near1 = (k: number) => Math.abs(k - 1) < 1e-9;
  if (near1(kx) && near1(ky)) return;

  if (leaf.tileMode === 'repeat') {
    if (typeof leaf.tileWidthL0 === 'number') leaf.tileWidthL0 *= kx;
    if (typeof leaf.tileHeightL0 === 'number') leaf.tileHeightL0 *= ky;
    if (typeof leaf.tileOffsetXL0 === 'number') leaf.tileOffsetXL0 *= kx;
    if (typeof leaf.tileOffsetYL0 === 'number') leaf.tileOffsetYL0 *= ky;
  }

  const style = leaf.style as TextObject['style'] | undefined;
  if (style && typeof style.size === 'number') {
    const k = Math.min(kx, ky);
    if (!near1(k)) {
      leaf.style = {
        ...style,
        size: style.size * k,
        ...(style.stroke ? { stroke: { ...style.stroke, width: style.stroke.width * k } } : {}),
      };
    }
  }
}
