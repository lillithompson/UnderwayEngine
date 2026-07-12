import { sampleColorFromScene } from '../eyedropperSampler';
import {
  CompositionFigure,
  CompositionState,
  PathSegment,
  SVGObject,
  makeViewport,
  RGBColor,
} from '../types';
import { computeSVGBbox, deriveSceneOrderFromKindArrays } from '../compositionOps';

const WHITE: RGBColor = { r: 255, g: 255, b: 255 };
const RED: RGBColor = { r: 244, g: 63, b: 94 };
const BLUE: RGBColor = { r: 34, g: 211, b: 238 };

function makeFigure(id: string, overrides: Partial<CompositionFigure> = {}): CompositionFigure {
  return {
    id,
    figureKey: 'k',
    cellX: 0, cellY: 0,
    resolutionX: 2, resolutionY: 2,
    cellWidth: 4, cellHeight: 4,
    ...overrides,
  };
}

function makeLine(id: string, vertices: [number, number][], color: RGBColor = WHITE): SVGObject {
  const segments: PathSegment[] = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    segments.push({ kind: 'line', start: vertices[i], end: vertices[i + 1] });
  }
  return { id, segments, color, ...computeSVGBbox(segments) };
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
    sceneOrder: parts.sceneOrder ?? deriveSceneOrderFromKindArrays({ figures, svgObjects, images }),
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

describe('sampleColorFromScene', () => {
  test('returns null color when tapping empty space', () => {
    const state = makeState();
    const hit = sampleColorFromScene(state, 5, 5);
    expect(hit.color).toBeNull();
    expect(hit.hitNonColoredObject).toBe(false);
    expect(hit.hitTiled).toBe(false);
  });

  test('returns SVG object color when tapping a line', () => {
    const line = makeLine('line1', [[0, 0], [10, 0]], RED);
    const state = makeState({ svgObjects: [line] });
    const hit = sampleColorFromScene(state, 5, 0);
    expect(hit.color).toEqual(RED);
    expect(hit.hitTiled).toBe(false);
  });

  test('returns figure colorOverride when tapping a colored figure', () => {
    const fig = makeFigure('fig1', {
      cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
      colorOverride: BLUE,
    });
    const state = makeState({ figures: [fig] });
    const hit = sampleColorFromScene(state, 2, 2);
    expect(hit.color).toEqual(BLUE);
  });

  test('signals hitNonColoredObject for figure without colorOverride', () => {
    const fig = makeFigure('fig1', {
      cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
    });
    const state = makeState({ figures: [fig] });
    const hit = sampleColorFromScene(state, 2, 2);
    expect(hit.color).toBeNull();
    expect(hit.hitNonColoredObject).toBe(true);
  });

  test('front-to-back ordering: topmost object color wins', () => {
    const fig = makeFigure('fig1', {
      cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10,
      colorOverride: BLUE,
    });
    const line = makeLine('line1', [[0, 0], [10, 0]], RED);
    // Line on top of figure in sceneOrder.
    const state = makeState({
      figures: [fig],
      svgObjects: [line],
      sceneOrder: ['fig1', 'line1'],
    });
    // At y=0 the line overlaps the figure. The line (front) should win.
    const hit = sampleColorFromScene(state, 5, 0);
    expect(hit.color).toEqual(RED);
  });

  test('reports hitTiled for repeating SVG object', () => {
    const line = makeLine('line1', [[0, 0], [10, 0]], RED);
    (line as any).tileMode = 'repeat';
    const state = makeState({ svgObjects: [line] });
    const hit = sampleColorFromScene(state, 5, 0);
    expect(hit.color).toEqual(RED);
    expect(hit.hitTiled).toBe(true);
  });
});
