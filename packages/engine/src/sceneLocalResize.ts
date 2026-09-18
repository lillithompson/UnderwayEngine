/**
 * The corner-handle resize, done in the node's own space (P5 of
 * docs/transform-refactor.md).
 *
 * `sceneHitFrame` is what a hit test tests and `sceneDrawnContent` is what
 * the render and the export draw; this is the BUILDER twin of both, and it
 * is built to the same rule. A leaf is drawn as its local content carried
 * through its world matrix, so a resize is a new LOCAL BOX with the same
 * matrix — the content reflowed into it by the kind's own geometry
 * adapter, exactly as it always was, only spelled where the content lives
 * rather than out in world coordinates.
 *
 * Plan Q3 keeps reflow-in-box a CONTENT op: a corner drag stretches an
 * image and reflows a text into a new box, where a pinch scales the type
 * with it. That is why this cannot be a transform, and why it has to write
 * a box rather than a matrix.
 *
 * What it buys over resizing the legacy world box: the legacy spelling of
 * a leaf's box is its WORLD footprint, which for a grouped node is the
 * group's word about where the corners fell — and for an svg is the
 * nearest upright rectangle around a path whose ancestors' turns are baked
 * into its vertices. Stretching that box stretches along world axes, not
 * the shape's own, so a path inside a turned group sheared as it was
 * dragged. The local box has no such gap: it is the frame the content is
 * authored in, and the matrix carries it out.
 */

import {
  Bbox, Mat2D, matApplyPoint, matInvert,
} from './sceneTransform';
import { bboxFromCells, bboxToCells } from './transform2d';
import {
  LegacyLeaf, SceneGraph, SceneNode, getNode, legacyLeafOf, worldMatrix,
} from './sceneGraph';
import { localContentBox, localHitObject } from './sceneHitFrame';
import { GEOMETRY_ADAPTERS } from './sceneNodeGeometry';
import type { CompItemKind, SVGObject } from './types';

/** A box in the cell spelling the geometry adapters and the gesture layer
 *  both take — the graph's own {@link Bbox} under longer names.
 *  `bboxToCells` / `bboxFromCells` are the crossing. */
export type CellBbox = ReturnType<typeof bboxToCells>;

/**
 * The local box a corner drag lands on.
 *
 * `drawnOld` / `drawnNew` are the rotated RECTANGLE the selection outline
 * is drawn as, before and after the drag (the host's `drawnBox`): `local`
 * scaled by the matrix's per-axis scale, centred where the matrix puts the
 * box's centre, turned by the matrix's one rotation. So the drawn box's
 * width is the local box's width in world units however the node is
 * turned, and the factors between the two are the factors the LOCAL box
 * takes — no quarter-turn swap to undo, no mirror to unpick, because a
 * rectangle's width is its width whichever way it is flipped.
 *
 * The new box is placed by its CENTRE, mapped back through the matrix. The
 * drag pins the corner opposite the one grabbed, and `drawnNew`'s centre
 * already says where that leaves the box; going through the centre rather
 * than the anchor means this cannot disagree with what the outline drew,
 * whatever the caller pinned.
 */
export function localBoxForDrawnResize(
  world: Mat2D, local: Bbox, drawnOld: CellBbox, drawnNew: CellBbox,
): Bbox {
  const fx = drawnOld.cellWidth > 0 ? drawnNew.cellWidth / drawnOld.cellWidth : 1;
  const fy = drawnOld.cellHeight > 0 ? drawnNew.cellHeight / drawnOld.cellHeight : 1;
  const width = local.width * fx;
  const height = local.height * fy;
  let inv: Mat2D;
  try { inv = matInvert(world); } catch { return { ...local, width, height }; }
  const [cx, cy] = matApplyPoint(
    inv, drawnNew.cellX + drawnNew.cellWidth / 2, drawnNew.cellY + drawnNew.cellHeight / 2,
  );
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}

/** The node's content, in its own space, as the rescale will see it —
 *  a hook for the one caller that substitutes geometry on the way in (a
 *  closed circle redrawn as the polyline of the same circle before a
 *  stretch turns it into an ellipse: see `rescaleSource`). */
export interface LocalRescaleOptions {
  source?(local: LegacyLeaf, oldBox: CellBbox, newBox: CellBbox): LegacyLeaf;
}

/**
 * `id`'s content reflowed from its own content box into `newLocalBox`, as
 * the legacy WORLD leaf the arrays store.
 *
 * Three steps, none of which touch the node's transform: spell the content
 * in its own space ({@link localHitObject}), hand it and the two LOCAL
 * boxes to the kind's geometry adapter, then render the result back out
 * through the node's unchanged world matrix. Because the matrix is
 * untouched, the local box's image is where the drag put it, and the world
 * fields that come back are whatever spelling `toLegacyView` would have
 * chosen for that pose — the same one the rest of the arrays are in.
 *
 * Null for a group, a figure (which has no rescale path at all) and an
 * unknown id.
 */
export function rescaleLeafLocal(
  graph: SceneGraph, id: string, newLocalBox: Bbox, opts?: LocalRescaleOptions,
): LegacyLeaf | null {
  const node = getNode(graph, id);
  if (!node || node.kind === 'group' || node.kind === 'figure') return null;
  const oldBox = bboxToCells(localContentBox(node));
  const newBox = bboxToCells(newLocalBox);
  const local = localHitObject(node);
  const source = opts?.source ? opts.source(local, oldBox, newBox) : local;
  const scaled = GEOMETRY_ADAPTERS[node.kind as CompItemKind].rescale(
    source as never, oldBox, newBox,
  ) as LegacyLeaf;
  return localLeafToWorld(graph, id, scaled);
}

/**
 * A leaf spelled in `id`'s OWN space, as the legacy world leaf the arrays
 * store — {@link rescaleLeafLocal}'s last step, for the caller that builds
 * its new local content itself rather than rescaling the old.
 *
 * The H/V line resize is that caller: it does not stretch the stroke it
 * has, it draws a new one across the box the drag asked for, which is a
 * thing to say in the node's own frame and nowhere else.
 */
export function localLeafToWorld(
  graph: SceneGraph, id: string, local: LegacyLeaf,
): LegacyLeaf | null {
  const node = getNode(graph, id);
  if (!node || node.kind === 'group') return null;
  return legacyLeafOf(graph, nodeWithLocalContent(node, local), worldMatrix(graph, id));
}

/**
 * The same node carrying `scaled` as its local content.
 *
 * The transform is kept verbatim — this is the whole reason a resize can
 * be spelled locally — so the node's origin does not move and the local
 * box simply sits somewhere else relative to it. An svg's local geometry
 * arrays come from the rescaled object directly, because the adapter
 * mapped them in the very frame they are stored in; the box it reports may
 * differ from the box asked for (a repeat-mode region's path does not fill
 * it, a degenerate axis does not stretch), and its own answer is the one
 * that renders.
 */
function nodeWithLocalContent(node: SceneNode, scaled: LegacyLeaf): SceneNode {
  const box = scaled as unknown as CellBbox;
  const localBox: Bbox = bboxFromCells(box);
  if (node.kind !== 'svg') return { ...node, localBox, content: scaled };
  const svg = scaled as SVGObject;
  return {
    ...node,
    localBox,
    localSegments: svg.segments ?? [],
    localSubpaths: svg.subpaths,
    localCreationBox: svg.creationBox ? {
      x: svg.creationBox.minX, y: svg.creationBox.minY,
      width: svg.creationBox.width, height: svg.creationBox.height,
    } : undefined,
    content: scaled,
  };
}
