/**
 * The export draws a FIGURE through its matrix (§5 item 6 of
 * docs/transform-refactor-next.md — the last leaf in `compositionSVGCore`
 * that was still posed off its legacy fields, markup and frame both).
 *
 * Two things have to hold at once and they pull against each other:
 *
 * - Plan Q1 gives a figure no free gesture, so for every figure the editor
 *   can actually author its own fields describe it EXACTLY, and the new
 *   emission must land the art on the very same pixels the old one did.
 *   That is the first block, and it checks the new markup against the
 *   legacy builder called directly rather than against a number typed out
 *   here — the old spelling is the oracle.
 * - What the fields cannot describe is a figure inside a group twisted off
 *   the quarters: the arrays can only give it an upright rectangle, and
 *   the export drew it upright. That is the second block.
 */

import { generateCompositionSVGCore } from '../compositionSVGCore';
import type { CompositionSVGInputs } from '../compositionSVGCore';
import { applyCompOps, withSceneGraph } from '../compositionOps';
import { worldMatrix } from '../sceneGraph';
import { localContentBox } from '../sceneHitFrame';
import {
  Mat2D, matApplyBbox, matApplyPoint, matMul, matShear,
} from '../sceneTransform';
import { SVG_UNITS_PER_L0_CELL as U } from '../svgExport';
import { buildFigureSVGContent, type CachedFigureSVG } from '../svgFigureBuilders';
import { effectiveStrokeMultiplier, normalizeStrokeScale } from '../strokeScale';
import {
  CompositionFigure, CompositionState, GroupNode, makeViewport,
} from '../types';
import { expectQuadsClose, parseSvgTransform } from './exportPose.test-utils';

jest.mock('@/native-shell/bridge/webBridge', () => ({
  logToNative: jest.fn(),
}));

// The generator turns a figure FILE into cached SVG elements; none of that
// is what this file is about, so the conversion hands back one asymmetric
// marker whose corners are easy to follow through a transform.
jest.mock('../svgExport', () => {
  const actual = jest.requireActual('../svgExport');
  return { ...actual, exportLayersToSVGInner: jest.fn(() => ART) };
});

/** A 5 × 3 figure source: one rect filling it, with no stroke (so the
 *  builder's clip pad is 0 and every number below is geometry). */
const ART = {
  elements: [`<rect x="0" y="0" width="${5 * 256}" height="${3 * 256}" fill="red"/>`],
  widthL0: 5,
  heightL0: 3,
};

const cached: CachedFigureSVG = {
  elements: ART.elements,
  svgWidth: ART.widthL0 * U,
  svgHeight: ART.heightL0 * U,
};

const STROKE_SCALE = 8;
const artStrokeScale = effectiveStrokeMultiplier(normalizeStrokeScale(STROKE_SCALE));

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
    gridLevel: 0, strokeScale: STROKE_SCALE, gridIntensity: 0.5,
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

/** A 5 × 3 figure at (10, 20), before any quarter turn swaps its box. */
function figure(overrides: Partial<CompositionFigure> = {}): CompositionFigure {
  const rotation = overrides.rotation ?? 0;
  const swap = rotation === 90 || rotation === 270;
  return {
    id: 'fig', figureKey: 'k', fileId: 'file-1',
    resolutionX: 1, resolutionY: 1,
    cellX: 10, cellY: 20,
    cellWidth: swap ? 3 : 5, cellHeight: swap ? 5 : 3,
    ...overrides,
  };
}

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
    strokeScale: state.strokeScale,
    loadFigure: async () => ({
      layers: [], widthL0: ART.widthL0, heightL0: ART.heightL0,
      originL0X: 0, originL0Y: 0, clipBox: null,
    }),
    ...extra,
  };
}

/**
 * Where the figure's ART actually lands, in world SVG units.
 *
 * The two spellings put the same quad on the page by different routes — the
 * old one wrote world coordinates into each element, the new one writes the
 * element in the node's own frame and hangs the node's matrix over it — so
 * the only fair comparison composes whatever chain the markup carries and
 * reads the corners out of the result.
 */
function artQuad(markup: string): [number, number][] {
  const attrs = [...markup.matchAll(/\stransform="([^"]*)"/g)].map((m) => m[1]);
  const m = attrs.reduce<Mat2D>(
    (acc, a) => matMul(acc, parseSvgTransform(a)),
    { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
  );
  return ([[0, 0], [cached.svgWidth, 0], [cached.svgWidth, cached.svgHeight],
    [0, cached.svgHeight]] as [number, number][])
    .map(([x, y]) => matApplyPoint(m, x, y));
}

function viewBoxOf(svg: string): number[] {
  return svg.match(/viewBox="([^"]*)"/)![1].split(/\s+/).map(Number);
}

describe('a figure drawn through its matrix lands where its fields always put it', () => {
  // A figure's whole vocabulary (plan Q1): the four quarters and the two
  // flips. Every one of them has to come out byte-for-byte where the world
  // builder put it, because for an ungrouped figure the arrays and the
  // graph say exactly the same thing.
  const poses: Array<Partial<CompositionFigure>> = [
    {},
    { rotation: 90 },
    { rotation: 180 },
    { rotation: 270 },
    { mirrorH: true },
    { mirrorV: true },
    { mirrorH: true, mirrorV: true },
    { rotation: 90, mirrorH: true },
    { rotation: 270, mirrorV: true },
  ];

  test.each(poses)('%j', async (pose) => {
    const fig = figure(pose);
    const state = withSceneGraph(makeState({ figures: [fig], sceneOrder: ['fig'] }));
    const svg = (await generateCompositionSVGCore(inputsFor(state)))!;

    // The oracle: the builder in the world coordinates it has always used.
    expectQuadsClose(
      artQuad(svg),
      artQuad(buildFigureSVGContent(fig, cached, artStrokeScale)),
    );
  });

  test('the frame is still the figure\'s own rectangle', async () => {
    const fig = figure({ rotation: 90 });
    const state = withSceneGraph(makeState({ figures: [fig], sceneOrder: ['fig'] }));
    const [vx, vy, vw, vh] = viewBoxOf((await generateCompositionSVGCore(inputsFor(state)))!);
    expect(vx / U).toBeCloseTo(fig.cellX, 3);
    expect(vy / U).toBeCloseTo(fig.cellY, 3);
    expect(vw / U).toBeCloseTo(fig.cellWidth, 3);
    expect(vh / U).toBeCloseTo(fig.cellHeight, 3);
  });

  test('a baked PNG still fills the stored rectangle, quarter turn and all', async () => {
    const fig = figure({ rotation: 90, fileId: undefined });
    const state = withSceneGraph(makeState({ figures: [fig], sceneOrder: ['fig'] }));
    const svg = (await generateCompositionSVGCore(inputsFor(state, {
      loadFigure: async () => null,
      loadBakedFigurePng: async () => 'data:image/png;base64,AA==',
    })))!;
    const [, iw, ih] = svg.match(/<image x="0" y="0" width="([-\d.]+)" height="([-\d.]+)"/)!;
    // The raster is emitted in the figure's CONTENT frame, and the quarter
    // the frame divides out the matrix puts back — so it covers the stored
    // rect at its stored orientation, exactly as the world emission did.
    const m = parseSvgTransform(svg.match(/<g transform="([^"]*)"/)![1]);
    const quad = ([[0, 0], [Number(iw), 0], [Number(iw), Number(ih)], [0, Number(ih)]] as
      [number, number][]).map(([x, y]) => matApplyPoint(m, x, y));
    const xs = quad.map(([x]) => x), ys = quad.map(([, y]) => y);
    expect(Math.min(...xs) / U).toBeCloseTo(fig.cellX, 3);
    expect(Math.min(...ys) / U).toBeCloseTo(fig.cellY, 3);
    expect((Math.max(...xs) - Math.min(...xs)) / U).toBeCloseTo(fig.cellWidth, 3);
    expect((Math.max(...ys) - Math.min(...ys)) / U).toBeCloseTo(fig.cellHeight, 3);
  });
});

describe('a figure inside a group twisted off the quarters', () => {
  /** A group the user has turned 30° and pulled to twice its width — the
   *  one pose a figure's own fields cannot spell. */
  function twisted(): CompositionState {
    const group: GroupNode = {
      id: 'g1', name: 'G', translateX: 0, translateY: 0,
      scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false,
    };
    const start = withSceneGraph(makeState({
      groups: [group],
      figures: [figure({ groupId: 'g1' })],
      sceneOrder: ['fig'],
    }));
    const from = start.graph!.nodes.get('g1')!.transform;
    return applyCompOps(start, [{
      op: 'setTransform', nodeId: 'g1', from, to: { ...from, rotationDeg: 30, sx: 2 },
    }]);
  }

  test('is drawn turned, where its own fields draw it flat', async () => {
    const state = twisted();
    const world = worldMatrix(state.graph!, 'fig');
    // Not a shear — no quarter turn can make one of an axis scale, which is
    // why a figure is the one leaf this refactor could leave behind — but a
    // tilt, and a tilt is enough.
    expect(matShear(world)).toBeCloseTo(0, 6);
    expect(world.b).not.toBeCloseTo(0, 2);

    const svg = (await generateCompositionSVGCore(inputsFor(state)))!;
    // The art covers the very quad the world matrix makes of the node's own
    // content box.
    const box = localContentBox(state.graph!.nodes.get('fig')!);
    const want = ([[0, 0], [box.width, 0], [box.width, box.height], [0, box.height]] as
      [number, number][])
      .map(([x, y]) => matApplyPoint(world, box.x + x, box.y + y))
      .map(([x, y]) => [x * U, y * U] as [number, number]);
    expectQuadsClose(artQuad(svg), want);

    // …where the emission this replaces put it flat on the page. The turn
    // the group gave it is a free angle, and the builder's whole vocabulary
    // for a figure is the four quarters — it never read one. (The arrays
    // themselves are not the foil any more: a group's own twist is a stored
    // field since v61, so a graph rebuilt from them says the same thing the
    // live one does. What could not say it was this markup.)
    const upright = artQuad(buildFigureSVGContent(
      state.figures![0], cached, artStrokeScale,
    ));
    expect(upright[0][1]).toBeCloseTo(upright[1][1], 3);
    expect(() => expectQuadsClose(upright, want)).toThrow();
  });

  test('and the frame is that turned quad, not the upright rectangle', async () => {
    const state = twisted();
    const svg = (await generateCompositionSVGCore(inputsFor(state)))!;
    const want = matApplyBbox(
      worldMatrix(state.graph!, 'fig'), localContentBox(state.graph!.nodes.get('fig')!),
    );
    const [vx, vy, vw, vh] = viewBoxOf(svg);
    expect(vx / U).toBeCloseTo(want.x, 3);
    expect(vy / U).toBeCloseTo(want.y, 3);
    expect(vw / U).toBeCloseTo(want.width, 3);
    expect(vh / U).toBeCloseTo(want.height, 3);

    // The union used to take the figure's stored rect as written. That rect
    // is the tilted quad's own width and height laid out flat, so it is
    // neither where the art is nor the size of it.
    const stored = state.figures![0];
    expect(want.width).toBeGreaterThan(stored.cellWidth);
    expect(want.height).toBeGreaterThan(stored.cellHeight);
  });
});
