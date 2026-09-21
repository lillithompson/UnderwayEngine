/**
 * The export reads poses off a scene graph (P5 of
 * docs/transform-refactor.md).
 *
 * Which graph is the first question, and the only one this file asks: a
 * live caller's own graph knows things its legacy arrays cannot spell (a
 * world scale, a shear), so it must be kept; a graph that no longer
 * describes those arrays must not, or the export draws a gesture behind
 * the picture it was handed.
 */

import { exportGraph, generateCompositionSVGCore } from '../compositionSVGCore';
import type { CompositionSVGInputs } from '../compositionSVGCore';
import { applyCompOps, withSceneGraph } from '../compositionOps';
import { fromLegacy, worldMatrix, worldSegments } from '../sceneGraph';
import { svgLocalGeometry } from '../sceneDrawnContent';
import { localContentBox } from '../sceneHitFrame';
import {
  matApplyBbox, matApplyCorners, matApplyPoint, matInvert, matIsSimilarity, matShear,
  matUniformScale,
} from '../sceneTransform';
import { SVG_UNITS_PER_L0_CELL as U } from '../svgExport';
import {
  CellState, CompositionState, DEFAULT_TRANSFORM, ImageObject, PaintObject, PatternObject,
  GroupNode, SVGObject, TextObject, makeViewport,
} from '../types';
import {
  commitCanvasPaint, createCanvasPaintWorking, paintTilesContentRect, stampCanvasPaint,
} from '../canvasPaint';
import {
  drawnQuad, expectQuadsClose, legacyQuad, transformsIn,
} from './exportPose.test-utils';

jest.mock('@/native-shell/bridge/webBridge', () => ({
  logToNative: jest.fn(),
}));

function makeState(overrides: Partial<CompositionState> = {}): CompositionState {
  return {
    id: 'test', name: 'test',
    figures: [], svgObjects: [], images: [], texts: [],
    paintObjects: [], patternObjects: [],
    imageBlobs: {},
    lineDraft: null, arcDraft: null,
    editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
    customColors: [],
    groups: [], sceneOrder: [],
    gridLevel: 0, strokeScale: 8, gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(),
    activeFigureKey: null,
    compTool: 'select',
    createRegion: null,
    renderGeneration: 0,
    ...overrides,
  };
}

const image = (): ImageObject => ({
  id: 'img', imageId: 'blob', mimeType: 'image/png',
  pixelWidth: 40, pixelHeight: 20,
  cellX: 3, cellY: 5, cellWidth: 4, cellHeight: 2,
} as ImageObject);

/** The generator's inputs for a state, the way every live caller builds
 *  them: the arrays as they stand, and the state's own graph beside. */
function inputsFor(
  state: CompositionState, extra: Partial<CompositionSVGInputs> = {},
): CompositionSVGInputs {
  return {
    name: state.name,
    figures: state.figures,
    svgObjects: state.svgObjects,
    images: state.images ?? [],
    imageBlobs: {},
    texts: state.texts,
    paintObjects: state.paintObjects,
    patternObjects: state.patternObjects,
    groups: state.groups,
    sceneOrder: state.sceneOrder,
    graph: state.graph,
    loadFigure: async () => null,
    ...extra,
  };
}

describe('exportGraph', () => {
  test('builds one from the arrays when the caller has no graph', () => {
    const state = makeState({ images: [image()], sceneOrder: ['img'] });
    const graph = exportGraph(inputsFor(state));
    expect(graph.nodes.get('img')?.localBox)
      .toEqual({ x: 0, y: 0, width: 4, height: 2 });
  });

  test('keeps a live graph rather than rebuilding it', () => {
    const state = withSceneGraph(makeState({ images: [image()], sceneOrder: ['img'] }));
    expect(exportGraph(inputsFor(state))).toBe(state.graph);
  });

  test('keeps the world scale the legacy arrays cannot spell', () => {
    // A leaf scaled in place: the graph carries the scale on the node's
    // transform, and the legacy view can only report a bigger box. A
    // rebuild off that box gives a scale of 1 — the very thing the export
    // is meant to stop losing.
    const start = withSceneGraph(makeState({ images: [image()], sceneOrder: ['img'] }));
    const from = start.graph!.nodes.get('img')!.transform;
    const scaled = applyCompOps(start, [{
      op: 'setTransform', nodeId: 'img',
      from, to: { ...from, sx: 3, sy: 3 },
    }]);
    expect(matUniformScale(worldMatrix(scaled.graph!, 'img'))).toBeCloseTo(3);

    const kept = exportGraph(inputsFor(scaled));
    expect(kept).toBe(scaled.graph);
    expect(matUniformScale(worldMatrix(kept, 'img'))).toBeCloseTo(3);

    const rebuilt = fromLegacy(scaled);
    expect(matUniformScale(worldMatrix(rebuilt, 'img'))).toBeCloseTo(1);
  });

  test('rebuilds when the graph no longer describes the arrays', () => {
    // A preview path spreads new arrays over an old state; its graph is a
    // gesture behind the picture, so the arrays win.
    const state = withSceneGraph(makeState({ images: [image()], sceneOrder: ['img'] }));
    const moved: CompositionState = {
      ...state,
      images: [{ ...state.images![0], cellX: 30 }],
    };
    const graph = exportGraph(inputsFor(moved));
    expect(graph).not.toBe(state.graph);
    expect(worldMatrix(graph, 'img').e).toBeCloseTo(30);
  });
});

// ── The image kind ────────────────────────────────────────────────────

const BLOB = { blob: new Uint8Array([137, 80, 78, 71]) };

/** The first `<image>`'s x/y/width/height, in SVG units — the rect the BITMAP
 *  is drawn into, which for a cover framing overflows the frame. */
function imageRect(svg: string): { x: number; y: number; width: number; height: number } {
  const m = svg.match(/<image x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/);
  if (!m) throw new Error('no <image> in the export');
  return { x: +m[1], y: +m[2], width: +m[3], height: +m[4] };
}

/** The nested `<svg>` viewport a square-cornered framed image clips its bitmap
 *  to — the node's LOCAL FRAME, the box the matrix then places. */
function frameRect(svg: string): { width: number; height: number } {
  const m = svg.match(/<svg x="0" y="0" width="([-\d.]+)" height="([-\d.]+)" overflow="hidden"/);
  if (!m) throw new Error('no frame viewport in the export');
  return { width: +m[1], height: +m[2] };
}

function aabbOf(quad: [number, number][]): { x: number; y: number; width: number; height: number } {
  const xs = quad.map((p) => p[0]), ys = quad.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

describe('the image kind draws its local frame through one matrix', () => {
  test('a quarter-turned image lands on the box it says it occupies', async () => {
    // The old emission drew the content into the WORLD box and then turned
    // it, which for a non-square box turned it off its own footprint. The
    // local box is the un-turned content box, so the matrix puts it back
    // exactly on the world box — the footprint every other reader (the
    // frame union below, the hit test, the node layer) already uses.
    const img = { ...image(), cellWidth: 8, cellHeight: 4, cellX: 0, cellY: 0, rotation: 90 } as ImageObject;
    const svg = (await generateCompositionSVGCore(inputsFor(
      makeState({ images: [img], sceneOrder: ['img'] }),
      { imageBlobs: BLOB },
    )))!;
    // The FRAME is emitted at the un-turned size: 4 cells wide, 8 tall. (The
    // bitmap inside it is the cover rect every image is drawn with, which
    // overflows this frame and is clipped by it — see the cover assertion
    // below.)
    const frame = frameRect(svg);
    expect([frame.width / U, frame.height / U]).toEqual([4, 8]);
    // 40×20 pixels cover-fitted into a 4×8 frame: 16 wide, 8 tall, centred.
    const rect = imageRect(svg);
    expect([rect.width / U, rect.height / U]).toEqual([16, 8]);
    expect([rect.x / U, rect.y / U]).toEqual([-6, 0]);
    const box = aabbOf(drawnQuad(transformsIn(svg)[0], 4, 8));
    expect(box.x / U).toBeCloseTo(0);
    expect(box.y / U).toBeCloseTo(0);
    expect(box.width / U).toBeCloseTo(8);
    expect(box.height / U).toBeCloseTo(4);
  });

  test("a scaled node scales its framing margin, as the screen does", async () => {
    // The gap this closes. `ImageFraming`'s lengths are world cells, and
    // `scaleContentLengths` does not carry a node's world scale into them:
    // the legacy view reports a box twice the size with the SAME margin,
    // while the layer draws the margin in the local box and lets the matrix
    // scale it. Drawing the local frame through the matrix is what makes
    // the export agree.
    const framed = {
      ...image(), cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 2,
      framing: { mode: 'fit', margin: 0.5 },
    } as unknown as ImageObject;
    const start = withSceneGraph(makeState({ images: [framed], sceneOrder: ['img'] }));
    const from = start.graph!.nodes.get('img')!.transform;
    const scaled = applyCompOps(start, [{
      op: 'setTransform', nodeId: 'img', from, to: { ...from, sx: 2, sy: 2 },
    }]);
    // The arrays alone can only say "a box twice as big".
    expect(scaled.images![0].cellWidth).toBeCloseTo(8);
    expect(scaled.images![0].cellHeight).toBeCloseTo(4);

    const withGraph = (await generateCompositionSVGCore(
      inputsFor(scaled, { imageBlobs: BLOB }),
    ))!;
    const scale = transformsIn(withGraph)[0].a;
    expect(scale).toBeCloseTo(2);
    // Half a cell in the local frame, scaled by two: one world cell.
    expect(imageRect(withGraph).x / U).toBeCloseTo(0.5);
    expect(imageRect(withGraph).x * scale / U).toBeCloseTo(1);

    // Without the graph the export is back to reading the grown box with
    // the authored margin — half a world cell, which is what the screen
    // stopped drawing.
    const fromArrays = (await generateCompositionSVGCore(
      inputsFor({ ...scaled, graph: undefined }, { imageBlobs: BLOB }),
    ))!;
    expect(transformsIn(fromArrays)[0].a).toBeCloseTo(1);
    expect(imageRect(fromArrays).x / U).toBeCloseTo(0.5);
  });
});

// ── The text kind ─────────────────────────────────────────────────────

const text = (): TextObject => ({
  id: 'txt', content: 'wide',
  style: { fontId: 'CozySans', size: 2, color: { r: 0, g: 0, b: 0 } },
  cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 4,
} as TextObject);

/** The first `<text>`'s font-size, in SVG units. */
function fontSize(svg: string): number {
  return Number(svg.match(/font-size="([-\d.]+)"/)![1]);
}

describe('the text kind lays out in its local box', () => {
  test('a stretched node stretches its glyphs instead of shrinking them', async () => {
    // The layer lays the CONTENT's own style out in the LOCAL box and lets
    // the matrix stretch the glyphs; the export does too — and since v66
    // so does the record, which carries the stretch as `stretchX` instead
    // of rounding the scale off to its smaller axis. That is what makes a
    // duplicate and a reopened page draw the same letters as the screen.
    const start = withSceneGraph(makeState({ texts: [text()], sceneOrder: ['txt'] }));
    const from = start.graph!.nodes.get('txt')!.transform;
    const stretched = applyCompOps(start, [{
      op: 'setTransform', nodeId: 'txt', from, to: { ...from, sx: 3, sy: 1 },
    }]);
    // What the arrays can say: a box three times as wide, type unchanged.
    expect(stretched.texts![0].cellWidth).toBeCloseTo(30);
    expect(stretched.texts![0].style.size).toBeCloseTo(2);

    const withGraph = (await generateCompositionSVGCore(inputsFor(stretched)))!;
    const m = transformsIn(withGraph)[0];
    expect(m.a).toBeCloseTo(3);
    expect(m.d).toBeCloseTo(1);
    // Laid out at the authored size in the 10-cell local box…
    expect(fontSize(withGraph)).toBeCloseTo(2 * U);
    expect(aabbOf(drawnQuad(m, 10, 4)).width / U).toBeCloseTo(30);

    // …and the arrays ALONE now say it too: the record kept the stretch,
    // so a page rebuilt from it draws the same stretched letters in the
    // same 30-cell box. (It used to come back as unstretched type reflowed
    // in that box — the reported duplicate / reopen bug.)
    expect(stretched.texts![0].stretchX).toBeCloseTo(3);
    const fromArrays = (await generateCompositionSVGCore(
      inputsFor({ ...stretched, graph: undefined }),
    ))!;
    const m2 = transformsIn(fromArrays)[0];
    expect(m2.a).toBeCloseTo(3);
    expect(m2.d).toBeCloseTo(1);
    expect(fontSize(fromArrays)).toBeCloseTo(2 * U);
    expect(aabbOf(drawnQuad(m2, 10, 4)).width / U).toBeCloseTo(30);
  });
});

// ── The paint kind ────────────────────────────────────────────────────

/** A dab of paint, framed on its ink the way createPaintObjectFromTiles
 *  does, posed over a box the caller names. */
function paintIsland(pose: Partial<PaintObject>): PaintObject {
  const working = createCanvasPaintWorking(undefined);
  stampCanvasPaint(working, 3, 3, 2, { r: 200, g: 40, b: 40 }, 1);
  const tiles = commitCanvasPaint(working)!;
  const rect = paintTilesContentRect(tiles)!;
  return {
    id: 'pnt', tiles,
    contentX: rect.x, contentY: rect.y, contentW: rect.w, contentH: rect.h,
    cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 4,
    ...pose,
  } as PaintObject;
}

describe('the paint kind draws its island in its local frame', () => {
  test('a quarter-turned island lands on its world box', async () => {
    // The old emission built the inner frame by hand — dims swapped on a
    // quarter turn, centred back in the world bbox, then turned — which is
    // precisely what the node's local box and its matrix say between them.
    const p = paintIsland({ cellWidth: 8, cellHeight: 4, rotation: 90 });
    const svg = (await generateCompositionSVGCore(inputsFor(
      makeState({ paintObjects: [p], sceneOrder: ['pnt'] }),
    )))!;
    const rect = imageRect(svg);
    expect([rect.width / U, rect.height / U]).toEqual([4, 8]);
    const quad = drawnQuad(transformsIn(svg)[0], 4, 8);
    expectQuadsClose(quad, legacyQuad({
      x: p.cellX, y: p.cellY, width: p.cellWidth, height: p.cellHeight, rotation: 90,
    }));
    const box = aabbOf(quad);
    expect([box.x / U, box.y / U, box.width / U, box.height / U]).toEqual([0, 0, 8, 4]);
  });

  test('a stretched island leans with its group instead of squaring up', async () => {
    // What the arrays cannot carry: a shear. `toLegacyView` can only report
    // the nearest rectangle, so the export drew a member of a stretched
    // bound group upright; the matrix carries the lean exactly.
    const start = withSceneGraph(makeState({
      paintObjects: [paintIsland({})], sceneOrder: ['pnt'],
    }));
    const from = start.graph!.nodes.get('pnt')!.transform;
    const turned = applyCompOps(start, [{
      op: 'setTransform', nodeId: 'pnt', from, to: { ...from, sx: 2, sy: 1, rotationDeg: 30 },
    }]);
    const svg = (await generateCompositionSVGCore(inputsFor(turned)))!;
    const m = transformsIn(svg)[0];
    // Two different axis factors and a turn: a pose no `rotate()` off the
    // legacy fields could have spelled.
    expect(Math.hypot(m.a, m.b)).toBeCloseTo(2);
    expect(Math.hypot(m.c, m.d)).toBeCloseTo(1);
    expect(Math.atan2(m.b, m.a) * 180 / Math.PI).toBeCloseTo(30);
    // …and the island itself is still emitted at its own local size.
    expect(imageRect(svg).width / U).toBeCloseTo(8);
  });
});

// ── The svg and pattern kinds ─────────────────────────────────────────

const svgObject = (over: Partial<SVGObject> = {}): SVGObject => ({
  id: 'svg', color: { r: 0, g: 0, b: 0 },
  segments: [
    { kind: 'line', start: [0, 0], end: [8, 0] },
    { kind: 'line', start: [8, 0], end: [8, 4] },
  ],
  cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 4,
  ...over,
} as SVGObject);

const patternObject = (over: Partial<PatternObject> = {}): PatternObject => {
  const cell = (): CellState => ({
    type: 'color', r: 200, g: 30, b: 30, transform: { ...DEFAULT_TRANSFORM },
  });
  return {
    id: 'pat', cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
    cols: 2, rows: 2, cells: [cell(), cell(), cell(), cell()],
    ...over,
  } as PatternObject;
};

describe('the svg kind draws its path in its own space', () => {
  test("a sheared member's chrome is even, and bounds what is drawn", async () => {
    // The path itself was always exact — `toLegacyView` maps the vertices
    // through the world matrix, shear and all, and the export turned them
    // back with a `rotate(angleDeg)` wrapper. What was NOT exact is
    // everything an svg draws in its BOX rather than along its path: the
    // border rect, the drop shadow's filter region, the opacity and soften
    // masks. Those read `cellX…cellHeight`, which for a sheared member is
    // the nearest UPRIGHT rectangle around it — so this used to check that
    // the chrome LEANED, drawn in the very frame the path was.
    //
    // It no longer leans, and that is the fix for §9.10: a frame with a
    // lean in it stretches a stroke, so a line inside a group pulled
    // off-square changed WEIGHT. The frame an svg is drawn in is a
    // similarity now and the lean lives in the path's points, which means
    // the chrome — the border rect among it — is drawn square to that
    // frame and bounds the drawn parallelogram instead of tracing it.
    // Evener than the canvas, which rings an svg's border on its world
    // AABB; the parallelogram-tracing border is not recoverable without
    // giving up the even stroke, and the even stroke is what was asked
    // for.
    //
    // A shear needs a turned member inside a group stretched off its axes:
    // no `LocalTransform` can store one, but a composition of two can.
    const group: GroupNode = {
      id: 'g1', name: 'G', translateX: 0, translateY: 0,
      scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false,
    };
    const start = withSceneGraph(makeState({
      groups: [group],
      svgObjects: [svgObject({
        groupId: 'g1', angleDeg: 30,
        effects: { border: { width: 0.5, color: { r: 0, g: 255, b: 0 } } },
      })],
      sceneOrder: ['svg'],
    }));
    const from = start.graph!.nodes.get('g1')!.transform;
    const leaned = applyCompOps(start, [{
      op: 'setTransform', nodeId: 'g1', from, to: { ...from, sx: 2, sy: 1 },
    }]);
    const world = worldMatrix(leaned.graph!, 'svg');
    expect(matShear(world)).not.toBeCloseTo(0, 2);

    // The quad a document's green border rect covers, in world SVG units.
    const borderQuad = (doc: string): [number, number][] => {
      const [, rx, ry, rw, rh] = doc.match(
        /<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"[^>]*#00FF00/,
      )!;
      const m = transformsIn(doc)[0];
      return ([[0, 0], [1, 0], [1, 1], [0, 1]] as const)
        .map(([fx, fy]) => matApplyPoint(m, Number(rx) + fx * Number(rw), Number(ry) + fy * Number(rh)));
    };

    const svg = (await generateCompositionSVGCore(inputsFor(leaned)))!;
    const geo = svgLocalGeometry(leaned.graph!.nodes.get('svg')!, world);
    // The frame every part of the node is drawn in is a SIMILARITY — the
    // one thing that makes a stroke come out the width it was authored at
    // whichever way it runs.
    expect(matIsSimilarity(geo.matrix)).toBe(true);
    // The border sits on that frame's box…
    const want = matApplyCorners(geo.matrix, geo.box)
      .map(([x, y]) => [x * U, y * U] as [number, number]);
    expectQuadsClose(borderQuad(svg), want);
    // …which is the TIGHT bound of the drawn parallelogram in it: the
    // chrome is square to the frame, and no larger than what it holds.
    const toFrame = matInvert(geo.matrix);
    const inFrame = (pts: readonly (readonly [number, number])[]) => {
      const m = pts.map(([x, y]) => matApplyPoint(toFrame, x, y));
      return {
        x0: Math.min(...m.map((p) => p[0])), y0: Math.min(...m.map((p) => p[1])),
        x1: Math.max(...m.map((p) => p[0])), y1: Math.max(...m.map((p) => p[1])),
      };
    };
    // …which is the TIGHT bound, in that frame, of the very parallelogram
    // the world matrix makes of the node's own box. The chrome is square
    // to the frame instead of leaning, and no bigger than what it holds.
    const quad = inFrame(matApplyCorners(world, localContentBox(leaned.graph!.nodes.get('svg')!)));
    expect(quad.x0).toBeCloseTo(geo.box.x, 6);
    expect(quad.y0).toBeCloseTo(geo.box.y, 6);
    expect(quad.x1).toBeCloseTo(geo.box.x + geo.box.width, 6);
    expect(quad.y1).toBeCloseTo(geo.box.y + geo.box.height, 6);
    // The drawn path is inside it, as a node's own box has to be.
    const path = inFrame(worldSegments(leaned.graph!, 'svg').flatMap((seg) => [seg.start, seg.end]));
    expect(path.x0).toBeGreaterThanOrEqual(geo.box.x - 1e-9);
    expect(path.y0).toBeGreaterThanOrEqual(geo.box.y - 1e-9);
    expect(path.x1).toBeLessThanOrEqual(geo.box.x + geo.box.width + 1e-9);
    expect(path.y1).toBeLessThanOrEqual(geo.box.y + geo.box.height + 1e-9);
    // The emitted rect is that box: the lean WIDENS it (a lean along x is
    // what this group's stretch makes) and leaves its height the
    // parallelogram's own, where the uniform scale would have grown both.
    const s = matUniformScale(world);
    const [, bw, bh] = svg.match(/width="([-\d.]+)" height="([-\d.]+)"[^>]*#00FF00/)!;
    expect(Number(bw) / U).toBeCloseTo(geo.box.width, 3);
    expect(Number(bh) / U).toBeCloseTo(geo.box.height, 3);
    expect(geo.box.width).toBeGreaterThan(8 * s);

    // …and the arrays alone now answer the same quad, which is what
    // opening the saved page has to do. The lean cannot live in the
    // member's `LocalTransform` — no such term — so reading the arrays
    // back used to drop it and hand back the upright rectangle turned by
    // the member's own angle, a member that visibly moved on reopen.
    // `leafNodeFromLegacy` folds the part the transform cannot say into
    // the PATH, where points carry it exactly.
    const fromArrays = (await generateCompositionSVGCore(
      inputsFor({ ...leaned, graph: undefined }),
    ))!;
    expectQuadsClose(borderQuad(fromArrays), want);
  });
});

describe('the pattern kind bakes its cells in the frame it is drawn in', () => {
  test('a turned pattern bakes upright and the matrix turns it', async () => {
    // `patternSVGView` bakes a pattern's cells into the box it is given, so
    // the view the export emits has to be baked in the LOCAL box its matrix
    // carries. Baking the world view instead puts the cells at the world
    // box — the nearest rectangle around a turned pattern — and then draws
    // them there.
    const p = patternObject({ cellX: 4, cellY: 4, angleDeg: 40 });
    const svg = (await generateCompositionSVGCore(inputsFor(
      makeState({ patternObjects: [p], sceneOrder: ['pat'] }),
    )))!;
    const m = transformsIn(svg)[0];
    expect(Math.atan2(m.b, m.a) * 180 / Math.PI).toBeCloseTo(40);
    // The cells are baked at the origin: the whole picture lies inside the
    // local 4×4 box, which is only true in the node's own space.
    const coords = [...svg.matchAll(/([-\d.]+),([-\d.]+)/g)]
      .map(([, x, y]) => [Number(x), Number(y)] as const);
    expect(coords.length).toBeGreaterThan(0);
    for (const [x, y] of coords) {
      expect(Math.abs(x)).toBeLessThanOrEqual(4 * U + 1);
      expect(Math.abs(y)).toBeLessThanOrEqual(4 * U + 1);
    }
    // …and it is drawn where the legacy pose always put it.
    expectQuadsClose(drawnQuad(m, 4, 4), legacyQuad({
      x: 4, y: 4, width: 4, height: 4, angleDeg: 40,
    }));
  });
});

// ── The frame ─────────────────────────────────────────────────────────

function viewBoxOf(svg: string): number[] {
  return svg.match(/viewBox="([^"]*)"/)![1].split(/\s+/).map(Number);
}

describe('the frame is the union of what is drawn', () => {
  test("a sheared member's frame is its parallelogram, not its rectangle", async () => {
    // The union read the legacy box and turned it about its own centre. For
    // a member of a stretched bound group that box is the nearest UPRIGHT
    // rectangle around a parallelogram, so the frame and the markup were
    // measuring two different shapes.
    const group: GroupNode = {
      id: 'g1', name: 'G', translateX: 0, translateY: 0,
      scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false,
    };
    const start = withSceneGraph(makeState({
      groups: [group],
      images: [{ ...image(), groupId: 'g1', cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 4, angleDeg: 30 }],
      sceneOrder: ['img'],
    }));
    const from = start.graph!.nodes.get('g1')!.transform;
    const leaned = applyCompOps(start, [{
      op: 'setTransform', nodeId: 'g1', from, to: { ...from, sx: 2, sy: 1 },
    }]);
    const world = worldMatrix(leaned.graph!, 'img');
    expect(matShear(world)).not.toBeCloseTo(0, 2);

    const svg = (await generateCompositionSVGCore(inputsFor(leaned, { imageBlobs: BLOB })))!;
    const want = matApplyBbox(world, localContentBox(leaned.graph!.nodes.get('img')!));
    const [vx, vy, vw, vh] = viewBoxOf(svg);
    expect(vx / U).toBeCloseTo(want.x, 3);
    expect(vy / U).toBeCloseTo(want.y, 3);
    expect(vw / U).toBeCloseTo(want.width, 3);
    expect(vh / U).toBeCloseTo(want.height, 3);

    // …and it really is a different frame from the one the arrays give.
    const fromArrays = (await generateCompositionSVGCore(
      inputsFor({ ...leaned, graph: undefined }, { imageBlobs: BLOB }),
    ))!;
    expect(viewBoxOf(fromArrays)).not.toEqual(viewBoxOf(svg));
  });
});
