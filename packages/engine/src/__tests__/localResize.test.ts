/**
 * The corner-handle resize in the node's own space (P5 of
 * docs/transform-refactor.md).
 *
 * The old path stretched the leaf's LEGACY world box: for an ungrouped
 * node that box is the rectangle it renders into and the stretch is right,
 * and for a grouped one it is the group's word about where the corners
 * fell. An svg is the sharp case — its segments carry every ancestor turn
 * baked into the vertices and its stored box is the nearest UPRIGHT
 * rectangle around them — so dragging a corner of a path inside a turned
 * group mapped the vertices along WORLD axes and sheared the shape. The
 * local box has no such gap, and the disagreement below is kept as an
 * explicit foil so this file cannot quietly stop being about it.
 *
 * Everything here is asserted on the DRAWN geometry — the world vertices,
 * measured in the shape's own frame — never on a stored box. A grouped
 * path's stored box is the upright rectangle around it, and what a reader
 * makes of that is the second thing this file pins: a content op now
 * re-reads the leaf in its parent's frame and the ring comes back tight,
 * while a RELOAD, which has only the arrays, still cannot — the group's
 * turn is not in them to divide out. That last one is P6's.
 */

import { applySceneOps, buildSetTransform } from '../sceneGraphOps';
import { computeSVGBbox, withSceneGraph } from '../compositionOps';
import {
  SceneGraph, fromLegacy, regraphChangedLeaves, toLegacyView, worldMatrix, worldSegments,
} from '../sceneGraph';
import { localContentBox } from '../sceneHitFrame';
import { GEOMETRY_ADAPTERS } from '../sceneNodeGeometry';
import { CellBbox, localBoxForDrawnResize, rescaleLeafLocal } from '../sceneLocalResize';
import { bboxFromCells, bboxToCells } from '../transform2d';
import { Bbox, LocalTransform, decomposeMatrix, matApplyPoint } from '../sceneTransform';
import {
  CompositionState, GroupNode, ImageObject, PathSegment, SVGObject, makeViewport,
} from '../types';

const WHITE = { r: 255, g: 255, b: 255 };

function rectSvg(
  id: string, x: number, y: number, w: number, h: number, extra: Partial<SVGObject> = {},
): SVGObject {
  const pts: Array<[number, number]> = [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
  const segments: PathSegment[] = [];
  for (let i = 0; i < pts.length - 1; i++) segments.push({ kind: 'line', start: pts[i], end: pts[i + 1] });
  return { id, segments, color: WHITE, ...computeSVGBbox(segments), ...extra };
}

function makeState(parts: Partial<CompositionState> = {}): CompositionState {
  const svgObjects = parts.svgObjects ?? [];
  const images = parts.images ?? [];
  return {
    id: 't', name: 't',
    figures: [], svgObjects, images, imageBlobs: {},
    lineDraft: null, arcDraft: null,
    editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: WHITE, customColors: [],
    groups: parts.groups ?? [],
    sceneOrder: parts.sceneOrder ?? [...svgObjects, ...images].map((n) => n.id),
    gridLevel: 0, strokeScale: 8, gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(),
    activeFigureKey: null,
    compTool: 'select', createRegion: null, renderGeneration: 0,
    ...parts,
  };
}

const group = (id: string): GroupNode => ({
  id, name: id, translateX: 0, translateY: 0,
  scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false,
});

function setTransform(state: CompositionState, id: string, t: LocalTransform): CompositionState {
  const graph = state.graph ?? fromLegacy(state);
  const op = buildSetTransform(graph, id, t);
  if (!op) throw new Error(`no transform op for ${id}`);
  const next = applySceneOps(graph, [op]);
  return { ...state, ...toLegacyView(next), graph: next };
}

/**
 * The rectangle the node is DRAWN as — the engine twin of the host's
 * `drawnBox`, and the frame the corner drag works in: the local content
 * box scaled by the matrix's per-axis scale, centred where the matrix puts
 * its centre, turned by the matrix's one rotation.
 */
function drawnRect(graph: SceneGraph, id: string): { box: CellBbox; angleDeg: number } {
  const node = graph.nodes.get(id)!;
  const m = worldMatrix(graph, id);
  const t = decomposeMatrix(m);
  const local = localContentBox(node);
  const w = local.width * Math.abs(t.sx);
  const h = local.height * Math.abs(t.sy);
  const [cx, cy] = matApplyPoint(m, local.x + local.width / 2, local.y + local.height / 2);
  return {
    box: { cellX: cx - w / 2, cellY: cy - h / 2, cellWidth: w, cellHeight: h },
    angleDeg: t.rotationDeg,
  };
}

/** The four corners of a rotated rectangle, in world cells. */
function cornersOf(b: CellBbox, angleDeg: number): Array<[number, number]> {
  const th = (angleDeg * Math.PI) / 180;
  const c = Math.cos(th), s = Math.sin(th);
  const cx = b.cellX + b.cellWidth / 2, cy = b.cellY + b.cellHeight / 2;
  const hw = b.cellWidth / 2, hh = b.cellHeight / 2;
  const signs: Array<[number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  return signs.map(([sx, sy]) => [
    cx + sx * hw * c - sy * hh * s,
    cy + sx * hw * s + sy * hh * c,
  ] as [number, number]);
}

/**
 * The state a content op leaves behind: `leaf` in place of the one it is,
 * and the graph read back the way `runOnGraph` reads it — the leaves the
 * op wrote re-read, everything else kept.
 *
 * NOT `withSceneGraph` on the arrays alone. That is what a RELOAD does,
 * and it is lossy in a way that has nothing to do with the resize: a
 * group's turn is a quarter turn in the arrays, so rebuilding from them
 * flattens a group twisted off the quarters and hands every member back in
 * world axes. `reloaded` below is that reading, kept as the foil.
 */
function commit(
  state: CompositionState, kind: 'svgObjects' | 'images', leaf: unknown,
): CompositionState {
  const arr = (state[kind] as Array<{ id: string }>).map(
    (n) => (n.id === (leaf as { id: string }).id ? leaf as never : n),
  );
  const after = { ...state, [kind]: arr };
  return { ...after, graph: regraphChangedLeaves(state.graph!, after) };
}

/** The same state as a page saved and opened again — the graph built from
 *  the arrays and nothing else. */
function reloaded(state: CompositionState): CompositionState {
  return withSceneGraph({ ...state, graph: undefined });
}

/** The drag, end to end: the drawn rectangle the outline showed, stretched
 *  to `drawnNew`, landed on the node's local box. */
function resizeTo(
  state: CompositionState, id: string, drawnNew: CellBbox,
): { leaf: unknown; newLocal: Bbox } {
  const graph = state.graph!;
  const node = graph.nodes.get(id)!;
  const drawn = drawnRect(graph, id);
  const newLocal = localBoxForDrawnResize(
    worldMatrix(graph, id), localContentBox(node), drawn.box, drawnNew,
  );
  return { leaf: rescaleLeafLocal(graph, id, newLocal)!, newLocal };
}

/** The corners a path's world segments visit, in order. */
function worldVertices(state: CompositionState, id: string): Array<[number, number]> {
  return worldSegments(state.graph!, id).map(
    (seg) => (seg as Extract<PathSegment, { kind: 'line' }>).start,
  );
}

/** How far a point set reaches along a pair of axes turned by `angleDeg` —
 *  the rectangle it fills in the shape's OWN frame. */
function extentsAlong(pts: Array<[number, number]>, angleDeg: number): [number, number] {
  const th = (angleDeg * Math.PI) / 180;
  const c = Math.cos(th), s = Math.sin(th);
  const us = pts.map(([x, y]) => x * c + y * s);
  const vs = pts.map(([x, y]) => -x * s + y * c);
  return [Math.max(...us) - Math.min(...us), Math.max(...vs) - Math.min(...vs)];
}

/** The cosine of the angle between a closed path's first two edges — 0 for
 *  a rectangle, anything else for one that has been sheared. */
function cornerCos(pts: Array<[number, number]>): number {
  const [p0, p1, p2] = pts;
  const a: [number, number] = [p1[0] - p0[0], p1[1] - p0[1]];
  const b: [number, number] = [p2[0] - p1[0], p2[1] - p1[1]];
  return (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(a[0], a[1]) * Math.hypot(b[0], b[1]));
}

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('a resize lands where the drag put it, whatever the node is under', () => {
  /** A 4x2 path inside a group turned 30 degrees: the shape no legacy
   *  stored box can name, because the vertices carry the turn and the box
   *  is the upright rectangle around them. */
  function tiltedGroupPath(): CompositionState {
    const state = withSceneGraph(makeState({
      svgObjects: [rectSvg('svg_1', 10, 10, 4, 2, { groupId: 'g1' })],
      groups: [group('g1')], sceneOrder: ['svg_1'],
    }));
    return setTransform(state, 'g1', { tx: 0, ty: 0, sx: 1, sy: 1, rotationDeg: 30 });
  }

  /** The drawn rectangle pulled to twice its width with its first corner
   *  pinned — the host's `computeResizedBbox` spelled out: the new centre
   *  steps half the new size back from the anchor along the box's own
   *  axes. Holding `cellX` would NOT do it: the turn is about the centre,
   *  so a box that keeps its origin and grows swings its corners round. */
  function doubledWidth(b: CellBbox, angleDeg: number): CellBbox {
    const th = (angleDeg * Math.PI) / 180;
    const c = Math.cos(th), s = Math.sin(th);
    const [ax, ay] = cornersOf(b, angleDeg)[0];
    const w = b.cellWidth * 2, h = b.cellHeight;
    const ncx = ax + (w / 2) * c - (h / 2) * s;
    const ncy = ay + (w / 2) * s + (h / 2) * c;
    return { cellX: ncx - w / 2, cellY: ncy - h / 2, cellWidth: w, cellHeight: h };
  }

  it('stretches a tilted group path along the path own axes', () => {
    const state = tiltedGroupPath();
    const before = drawnRect(state.graph!, 'svg_1');
    near(before.box.cellWidth, 4);
    const anchor = cornersOf(before.box, before.angleDeg)[0];
    const { leaf } = resizeTo(state, 'svg_1', doubledWidth(before.box, before.angleDeg));
    const after = commit(state, 'svgObjects', leaf);

    // Measured in the shape's own frame: twice as long, the same across,
    // and still a rectangle.
    const pts = worldVertices(after, 'svg_1');
    const [u, v] = extentsAlong(pts, 30);
    near(u, 8);
    near(v, 2);
    near(cornerCos(pts), 0);
    // The pinned corner did not move: the turn stayed on the group and
    // only the box grew, which is what "along its own axes" means.
    const pinned = pts.reduce((best, p) => (
      Math.hypot(p[0] - anchor[0], p[1] - anchor[1])
        < Math.hypot(best[0] - anchor[0], best[1] - anchor[1]) ? p : best));
    near(pinned[0], anchor[0]);
    near(pinned[1], anchor[1]);
  });

  it('leaves the ring where it was: tight, and at the turn it is drawn at', () => {
    // The gap this file used to pin. The commit round-trips the leaf
    // through the arrays, and a graph REBUILT from those has no group turn
    // to divide out — so the member came back at no local turn, measured
    // by the upright rectangle around a tilted shape, and the ring visibly
    // respelled the moment the drag landed. A second drag on that node was
    // a world-axis one again.
    const state = tiltedGroupPath();
    const drawn = drawnRect(state.graph!, 'svg_1');
    const { leaf } = resizeTo(state, 'svg_1', doubledWidth(drawn.box, drawn.angleDeg));
    const after = commit(state, 'svgObjects', leaf);

    const box = localContentBox(after.graph!.nodes.get('svg_1')!);
    near(box.width, 8);
    near(box.height, 2);
    near(drawnRect(after.graph!, 'svg_1').angleDeg, 30);

    // And through a RELOAD, which is the half P6 closed: the arrays can
    // say the group is turned 30 degrees now (v61 `GroupNode.angleDeg`),
    // so a page saved here and opened again still has the tight box and
    // still draws the shape at its own angle. Before that field, this came
    // back as the upright rectangle around a tilted shape —
    // 8·cos30 + 2·sin30 across, at no turn at all.
    const again = reloaded(after);
    const box2 = localContentBox(again.graph!.nodes.get('svg_1')!);
    near(box2.width, 8);
    near(box2.height, 2);
    near(drawnRect(again.graph!, 'svg_1').angleDeg, 30);
  });

  it('disagrees with stretching the LEGACY box, which shears the shape', () => {
    const state = tiltedGroupPath();
    const item = state.svgObjects![0];
    const before = drawnRect(state.graph!, 'svg_1');
    // The stored box is the UPRIGHT rectangle around a turned path, so it
    // is wider than the path's own four cells; doubling it maps the
    // vertices along world axes, and a turned rectangle mapped that way
    // comes out a parallelogram.
    near(item.cellWidth, 4 * Math.cos(Math.PI / 6) + 2 * Math.sin(Math.PI / 6));
    const stored = { x: item.cellX, y: item.cellY, width: item.cellWidth, height: item.cellHeight };
    const legacy = GEOMETRY_ADAPTERS.svg.rescale(
      item, bboxToCells(stored), bboxToCells({ ...stored, width: stored.width * 2 }),
    ) as SVGObject;
    const legacyPts = legacy.segments.map(
      (seg) => (seg as Extract<PathSegment, { kind: 'line' }>).start,
    );
    expect(Math.abs(cornerCos(legacyPts))).toBeGreaterThan(0.2);

    const { leaf } = resizeTo(state, 'svg_1', doubledWidth(before.box, before.angleDeg));
    const after = commit(state, 'svgObjects', leaf);
    near(cornerCos(worldVertices(after, 'svg_1')), 0);
  });

  it('is exactly the old world-box stretch for an upright, ungrouped node', () => {
    const state = withSceneGraph(makeState({
      images: [{
        id: 'img_1', imageId: 'i', cellX: 3, cellY: 5, cellWidth: 4, cellHeight: 2,
        pixelWidth: 40, pixelHeight: 20, mimeType: 'image/png',
      } as ImageObject],
    }));
    const { leaf } = resizeTo(state, 'img_1', {
      cellX: 3, cellY: 5, cellWidth: 8, cellHeight: 3,
    });
    const out = leaf as ImageObject;
    near(out.cellX, 3); near(out.cellY, 5);
    near(out.cellWidth, 8); near(out.cellHeight, 3);
    expect(out.angleDeg).toBeUndefined();
  });

  it('maps a quarter-turned image drag onto its own axes', () => {
    let state = withSceneGraph(makeState({
      images: [{
        id: 'img_1', imageId: 'i', cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 2,
        pixelWidth: 40, pixelHeight: 20, mimeType: 'image/png',
      } as ImageObject],
    }));
    state = setTransform(state, 'img_1', { tx: 0, ty: 0, sx: 1, sy: 1, rotationDeg: 90 });
    const before = drawnRect(state.graph!, 'img_1');
    // The drawn rectangle is the CONTENT's 4x2 stood on end; pulling its
    // "width" pulls the picture along its own long axis, which on screen
    // is vertical.
    near(before.box.cellWidth, 4);
    const { leaf } = resizeTo(state, 'img_1', { ...before.box, cellWidth: 6 });
    const after = commit(state, 'images', leaf);
    const drawn = drawnRect(after.graph!, 'img_1');
    near(drawn.box.cellWidth, 6);
    near(drawn.box.cellHeight, 2);
    // The arrays spell the whole turn as the free angle — this leaf never
    // carried a discrete `rotation` — so the world box is the content box
    // at 90 degrees rather than its upright AABB. The same rectangle.
    near((leaf as ImageObject).cellWidth, 6);
    near((leaf as ImageObject).cellHeight, 2);
    near((leaf as ImageObject).angleDeg ?? 0, 90);
  });

  it('carries a group scale: a local box is not a world one', () => {
    let state = withSceneGraph(makeState({
      images: [{
        id: 'img_1', imageId: 'i', groupId: 'g1',
        cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 2,
        pixelWidth: 40, pixelHeight: 20, mimeType: 'image/png',
      } as ImageObject],
      groups: [group('g1')], sceneOrder: ['img_1'],
    }));
    state = setTransform(state, 'g1', { tx: 0, ty: 0, sx: 3, sy: 3, rotationDeg: 0 });
    const before = drawnRect(state.graph!, 'img_1');
    near(before.box.cellWidth, 12);
    const { newLocal } = resizeTo(state, 'img_1', { ...before.box, cellWidth: 24 });
    // Twice as wide on screen is twice as wide in the node's own frame —
    // the group's 3x stays on the matrix and is not counted into the box.
    near(newLocal.width, 8);
  });

  it('refuses an unknown id', () => {
    const state = withSceneGraph(makeState({}));
    expect(rescaleLeafLocal(state.graph!, 'nope', { x: 0, y: 0, width: 1, height: 1 })).toBeNull();
  });
});

describe('localBoxForDrawnResize', () => {
  it('is the identity on a box that did not change', () => {
    const local: Bbox = { x: -2, y: -1, width: 4, height: 2 };
    const drawn = bboxToCells({ x: 0, y: 0, width: 4, height: 2 });
    const out = localBoxForDrawnResize(
      { a: 1, b: 0, c: 0, d: 1, e: 2, f: 1 }, local, drawn, drawn,
    );
    expect(bboxFromCells(bboxToCells(out))).toEqual(local);
  });
});
