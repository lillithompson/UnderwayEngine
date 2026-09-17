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
import { fromLegacy, worldMatrix } from '../sceneGraph';
import { matUniformScale } from '../sceneTransform';
import { SVG_UNITS_PER_L0_CELL as U } from '../svgExport';
import { CompositionState, ImageObject, makeViewport } from '../types';
import { drawnQuad, transformsIn } from './exportPose.test-utils';

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

/** The first `<image>`'s x/y/width/height, in SVG units. */
function imageRect(svg: string): { x: number; y: number; width: number; height: number } {
  const m = svg.match(/<image x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/);
  if (!m) throw new Error('no <image> in the export');
  return { x: +m[1], y: +m[2], width: +m[3], height: +m[4] };
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
    const rect = imageRect(svg);
    // Content emitted at the un-turned size: 4 cells wide, 8 tall.
    expect([rect.width / U, rect.height / U]).toEqual([4, 8]);
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
