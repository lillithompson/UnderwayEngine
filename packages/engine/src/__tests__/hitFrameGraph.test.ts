/**
 * The hit test through the scene graph (P5 of docs/transform-refactor.md).
 *
 * `findSceneObjectAtCell` used to carry the query point into a leaf's frame
 * with `unrotatePointForNode`, which undoes the leaf's own free `angleDeg`
 * about its bbox centre and nothing else, and then tested the leaf's LEGACY
 * world fields. That is the whole truth only while those fields are — and a
 * box plus a turn cannot spell SHEAR, which is exactly what a bound group
 * stretched along one axis gives a member turned inside it. The legacy view
 * falls back to the nearest rotated rectangle there (plan §2.9), so the old
 * hit test claimed ground the member does not cover and missed ground it
 * does. The inverse world matrix has no such gap.
 *
 * The rest of the hit test's behaviour — z-order, sticky selection, masks,
 * the svg path fallback — is pinned by findSceneObjectAtCell.test.ts, which
 * runs through this same path.
 */

import { applySceneOps, buildSetTransform } from '../sceneGraphOps';
import {
  computeSVGBbox, findSceneObjectAtCell, unrotatePointForNode, withSceneGraph,
} from '../compositionOps';
import { computeHitToleranceCells, svgPathHitsPoint } from '../compositionPathHitTest';
import { fromLegacy, toLegacyView, worldMatrix } from '../sceneGraph';
import { leafHitFrame, localHitObject, nodeHitFrame } from '../sceneHitFrame';
import { LocalTransform, matApplyPoint } from '../sceneTransform';
import {
  CompositionFigure, CompositionState, GroupNode, ImageObject,
  PathSegment, SVGObject, makeViewport,
} from '../types';

const WHITE = { r: 255, g: 255, b: 255 };

function svgOf(id: string, pts: [number, number][], extra: Partial<SVGObject> = {}): SVGObject {
  const segments: PathSegment[] = [];
  for (let i = 0; i < pts.length - 1; i++) segments.push({ kind: 'line', start: pts[i], end: pts[i + 1] });
  return { id, segments, color: WHITE, ...computeSVGBbox(segments), ...extra };
}

/** A closed rectangle path, so the svg's own bounds are the rect. */
function rectSvg(id: string, x: number, y: number, w: number, h: number, extra: Partial<SVGObject> = {}): SVGObject {
  return svgOf(id, [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]], extra);
}

function makeState(parts: Partial<CompositionState> = {}): CompositionState {
  const figures = parts.figures ?? [];
  const svgObjects = parts.svgObjects ?? [];
  const images = parts.images ?? [];
  return {
    id: 't', name: 't',
    figures, svgObjects, images, imageBlobs: {},
    lineDraft: null, arcDraft: null,
    editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: WHITE,
    customColors: [],
    groups: parts.groups ?? [],
    sceneOrder: parts.sceneOrder ?? [...figures, ...svgObjects, ...images].map((n) => n.id),
    gridLevel: 0, strokeScale: 8, gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(),
    activeFigureKey: null,
    compTool: 'select',
    createRegion: null,
    renderGeneration: 0,
    ...parts,
  };
}

const group = (id: string): GroupNode => ({
  id, name: id, translateX: 0, translateY: 0,
  scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false,
});

/** `state` with one node's LOCAL transform replaced — the shape every host
 *  gesture commits, and the only way to say "this node carries a scale". */
function setTransform(state: CompositionState, id: string, t: LocalTransform): CompositionState {
  const graph = state.graph ?? fromLegacy(state);
  const op = buildSetTransform(graph, id, t);
  if (!op) throw new Error(`no transform op for ${id}`);
  const next = applySceneOps(graph, [op]);
  return { ...state, ...toLegacyView(next), graph: next };
}

describe('a member sheared by its bound group answers for what it draws', () => {
  // A 4×4 image turned 45° INSIDE a group that is then pulled 3× along the
  // group's own x. The product S(3, 1) · R(45) has non-perpendicular
  // columns — real shear — so the image is drawn as a rhombus and no box
  // plus a turn can say where it is.
  function shearedMember() {
    const img: ImageObject = {
      id: 'm1', imageId: 'm1', groupId: 'g1',
      cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
      pixelWidth: 64, pixelHeight: 64, mimeType: 'image/png',
    };
    let state = withSceneGraph(makeState({
      images: [img], groups: [group('g1')], sceneOrder: ['m1'],
    }));
    state = setTransform(state, 'm1', { tx: 0, ty: 0, sx: 1, sy: 1, rotationDeg: 45 });
    state = setTransform(state, 'g1', { tx: 0, ty: 0, sx: 3, sy: 1, rotationDeg: 0 });
    return state;
  }

  /** The OLD reading, verbatim: the query point un-spun by the leaf's own
   *  `angleDeg` about its legacy bbox centre, tested against that box. */
  function legacySays(state: CompositionState, x: number, y: number): boolean {
    const n = state.images![0];
    const [hx, hy] = unrotatePointForNode(n, x, y);
    return hx >= n.cellX && hx < n.cellX + n.cellWidth
      && hy >= n.cellY && hy < n.cellY + n.cellHeight;
  }

  test('the legacy box really is only an approximation here', () => {
    const state = shearedMember();
    const n = state.images![0];
    // A rotated rectangle, where the truth is a rhombus: its turn is not
    // the member's own 45, and its sides are not the member's 4.
    expect(n.angleDeg).toBeCloseTo(18.434948, 5);
    expect(n.cellWidth).toBeCloseTo(8.944271, 5);
    expect(n.cellHeight).toBeCloseTo(5.366563, 5);
  });

  test('a point inside the drawn rhombus but outside the legacy box hits', () => {
    const state = shearedMember();
    const world = worldMatrix(state.graph!, 'm1');
    // 90% of the way to the rhombus vertex that is the image's own corner.
    const [vx, vy] = matApplyPoint(world, 4, 0);
    const p: [number, number] = [vx * 0.9, vy * 0.9];
    expect(findSceneObjectAtCell(state, ...p)).toEqual({ kind: 'image', id: 'm1' });
    expect(legacySays(state, ...p)).toBe(false);
  });

  test('a point inside the legacy box but outside the drawn rhombus misses', () => {
    const state = shearedMember();
    // 90% of the way to a corner of the legacy rectangle, which pokes out
    // past the rhombus's slanted side.
    const n = state.images![0];
    const cx = n.cellX + n.cellWidth / 2, cy = n.cellY + n.cellHeight / 2;
    const rad = ((n.angleDeg ?? 0) * Math.PI) / 180;
    const hw = (n.cellWidth / 2) * 0.9, hh = (n.cellHeight / 2) * 0.9;
    const p: [number, number] = [
      cx + hw * Math.cos(rad) - hh * Math.sin(rad),
      cy + hw * Math.sin(rad) + hh * Math.cos(rad),
    ];
    expect(legacySays(state, ...p)).toBe(true);
    expect(findSceneObjectAtCell(state, ...p)).toBeNull();
  });

  test('every corner the group actually draws the member at is a hit', () => {
    const state = shearedMember();
    const world = worldMatrix(state.graph!, 'm1');
    const centre = matApplyPoint(world, 2, 2);
    for (const [lx, ly] of [[0, 0], [4, 0], [4, 4], [0, 4]] as [number, number][]) {
      const [wx, wy] = matApplyPoint(world, lx, ly);
      // A hair inside, so the half-open box test cannot argue the boundary.
      const p: [number, number] = [
        centre[0] + (wx - centre[0]) * 0.99,
        centre[1] + (wy - centre[1]) * 0.99,
      ];
      expect(findSceneObjectAtCell(state, ...p)).toEqual({ kind: 'image', id: 'm1' });
    }
  });
});

describe('a tolerance is a world length, carried into each node frame', () => {
  // The path tolerance comes off the CAMERA — how far a thumb may miss a
  // line on screen — so it is a world quantity, while the frame measures
  // the node's own local geometry. `lengthScale` is the carry, and without
  // it a node drawn at half size would be half as easy to grab as it looks.
  test('a path at half scale is grabbed at the same world distance', () => {
    // A diagonal, so a point can sit inside the box and off the path.
    const line = svgOf('s1', [[10, 10], [18, 18]]);
    let state = withSceneGraph(makeState({ svgObjects: [line] }));
    // Half size about the path's centre (14, 14): drawn from 12 to 16.
    state = setTransform(state, 's1', { tx: 14, ty: 14, sx: 0.5, sy: 0.5, rotationDeg: 0 });

    const frame = nodeHitFrame(state.graph!, 's1')!;
    expect(frame.lengthScale).toBeCloseTo(2, 9);

    const tol = computeHitToleranceCells(state.viewport, state.camera);
    // 0.85 world cells off the drawn line, inside its box: within tolerance.
    const p: [number, number] = [14.6, 13.4];
    const [hx, hy] = frame.toLocal(...p);
    const carried = tol * frame.lengthScale;
    expect(svgPathHitsPoint(frame.object as SVGObject, hx, hy, carried * carried)).toBe(true);
    // Without the carry the same thumb would miss, though nothing on screen
    // moved — that is the bug the carry is here to prevent.
    expect(svgPathHitsPoint(frame.object as SVGObject, hx, hy, tol * tol)).toBe(false);
    expect(findSceneObjectAtCell(state, ...p)).toEqual({ kind: 'svg', id: 's1' });
  });
});

describe('a quarter-turned figure keeps its quads', () => {
  // A figure's quad offsets are stored ALREADY TURNED
  // (rotateFigureIndividual90CW rewrites them), while the graph node's
  // local box is the UN-turned content box. sceneHitFrame's `quadSpinDeg`
  // is what keeps the two from sitting a quarter turn apart.
  const figure = (over: Partial<CompositionFigure>): CompositionFigure => ({
    id: 'f1', figureKey: 'k',
    cellX: 0, cellY: 0, resolutionX: 4, resolutionY: 2,
    cellWidth: 4, cellHeight: 2,
    ...over,
  });

  test('upright: only the quad takes the hit', () => {
    // A 4×2 figure whose ink is the LEFT 1×2 column.
    const state = withSceneGraph(makeState({
      figures: [figure({ quads: [{ offsetX: 0, offsetY: 0, cellWidth: 1, cellHeight: 2 }] })],
    }));
    expect(findSceneObjectAtCell(state, 0.5, 1)).toEqual({ kind: 'figure', id: 'f1' });
    expect(findSceneObjectAtCell(state, 3.5, 1)).toBeNull();
  });

  test('turned 90: the box swaps and the quad rides with it', () => {
    // As rotateFigureIndividual90CW leaves it: box 2×4, the same ink now
    // the TOP 2×1 row.
    const state = withSceneGraph(makeState({
      figures: [figure({
        cellWidth: 2, cellHeight: 4, rotation: 90,
        quads: [{ offsetX: 0, offsetY: 0, cellWidth: 2, cellHeight: 1 }],
      })],
    }));
    expect(findSceneObjectAtCell(state, 1, 0.5)).toEqual({ kind: 'figure', id: 'f1' });
    expect(findSceneObjectAtCell(state, 1, 3.5)).toBeNull();
  });
});

describe('the frame and the object it hands over are a matched pair', () => {
  test('the local object carries content and no pose', () => {
    const svg = rectSvg('s1', 10, 10, 8, 8, { angleDeg: 30, name: 'a shape' });
    const graph = fromLegacy(makeState({ svgObjects: [svg] }));
    const object = localHitObject(graph.nodes.get('s1')!) as SVGObject;
    // Pose is gone — the frame has spent it.
    expect(object.angleDeg).toBeUndefined();
    expect(object.rotation).toBeUndefined();
    expect(object.mirrorH).toBeUndefined();
    expect(object.mirrorV).toBeUndefined();
    expect(object.localSegments).toBeUndefined();
    // Content is not.
    expect(object.name).toBe('a shape');
    expect(object.color).toEqual(WHITE);
    // The box is the node's own and the geometry is the local path, so the
    // two describe the same rectangle.
    expect(object.cellWidth).toBeCloseTo(8, 9);
    expect(object.cellHeight).toBeCloseTo(8, 9);
    expect(computeSVGBbox(object.segments).cellWidth).toBeCloseTo(8, 9);
  });

  test('a turned leaf maps its own drawn corner onto its local corner', () => {
    const svg = rectSvg('s1', 10, 10, 8, 8, { angleDeg: 30 });
    const graph = fromLegacy(makeState({ svgObjects: [svg] }));
    const world = worldMatrix(graph, 's1');
    const frame = leafHitFrame(graph.nodes.get('s1')!, world);
    // The drawn top-left corner is the local corner through the matrix.
    const [wx, wy] = matApplyPoint(world, -4, -4);
    expect(frame.toLocal(wx, wy)[0]).toBeCloseTo(-4, 9);
    expect(frame.toLocal(wx, wy)[1]).toBeCloseTo(-4, 9);
  });

  test('a frame is reused while the node and its pose stand still', () => {
    const state = withSceneGraph(makeState({ svgObjects: [rectSvg('s1', 0, 0, 4, 4)] }));
    const node = state.graph!.nodes.get('s1')!;
    const world = worldMatrix(state.graph!, 's1');
    // A new matrix OBJECT with the same numbers — what an ancestor moving
    // hands an untouched node — must not rebuild the frame.
    expect(leafHitFrame(node, world)).toBe(leafHitFrame(node, { ...world }));
  });
});
