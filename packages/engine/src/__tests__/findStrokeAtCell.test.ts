import { computeSVGBbox, findStrokeAtCell } from '../compositionOps';
import { SVGObject, PathSegment, CompositionState, makeViewport } from '../types';

const WHITE = { r: 255, g: 255, b: 255 };

function makeState(over: Partial<CompositionState> = {}): CompositionState {
  const figures = over.figures ?? [];
  const svgObjects = over.svgObjects ?? [];
  return {
    id: 't', name: 't',
    figures, svgObjects,
    lineDraft: null, arcDraft: null,
    editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: WHITE,
    customColors: [],
    groups: [],
    sceneOrder: [...figures.map((f) => f.id), ...svgObjects.map((s) => s.id)],
    gridLevel: 0, strokeScale: 8, gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(),
    activeFigureKey: null, compTool: 'select',
    createRegion: null, renderGeneration: 0,
    ...over,
  };
}

function makeSVGFromVertices(id: string, vertices: [number, number][]): SVGObject {
  const segments: PathSegment[] = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    segments.push({ kind: 'line', start: vertices[i], end: vertices[i + 1] });
  }
  return { id, segments, color: WHITE, ...computeSVGBbox(segments) };
}

function makeSVG(id: string, segments: PathSegment[]): SVGObject {
  return { id, segments, color: WHITE, ...computeSVGBbox(segments) };
}

describe('findStrokeAtCell', () => {
  test('returns the svg object when only an arc-like svg is under the point', () => {
    const svgArc = makeSVG('a1', [{ kind: 'arc', start: [0, 0], end: [4, 4], center: [4, 0] }]);
    const state = makeState({ svgObjects: [svgArc] });
    expect(findStrokeAtCell(state, 2, 2)).toEqual({ kind: 'svg', id: 'a1' });
  });

  test('returns the svg object when only a line-like svg is under the point', () => {
    const svgLine = makeSVGFromVertices('l1', [[0, 0], [10, 0]]);
    const state = makeState({ svgObjects: [svgLine] });
    // Pure horizontal line — bbox inflates to 0.25 cell in hit-test.
    expect(findStrokeAtCell(state, 5, 0)).toEqual({ kind: 'svg', id: 'l1' });
  });

  test('topmost in sceneOrder wins when two svg objects both cover the point', () => {
    const svgArc = makeSVG('a1', [{ kind: 'arc', start: [0, 0], end: [4, 4], center: [4, 0] }]);
    const svgLine = makeSVGFromVertices('l1', [[0, 0], [4, 4]]);
    // makeState builds sceneOrder as [...svgObjects] — arc is first, line second (on top).
    const lineOnTop = makeState({ svgObjects: [svgArc, svgLine] });
    expect(findStrokeAtCell(lineOnTop, 2, 2)).toEqual({ kind: 'svg', id: 'l1' });
    // Flip sceneOrder so the arc is on top — arc should now win.
    const arcOnTop = makeState({
      svgObjects: [svgArc, svgLine],
      sceneOrder: ['l1', 'a1'],
    });
    expect(findStrokeAtCell(arcOnTop, 2, 2)).toEqual({ kind: 'svg', id: 'a1' });
  });

  test('returns null when nothing is under the point', () => {
    const svgArc = makeSVG('a1', [{ kind: 'arc', start: [0, 0], end: [4, 4], center: [4, 0] }]);
    const state = makeState({ svgObjects: [svgArc] });
    expect(findStrokeAtCell(state, 100, 100)).toBeNull();
  });

  test('skips locked strokes', () => {
    const lockedArc = { ...makeSVG('a1', [{ kind: 'arc', start: [0, 0], end: [4, 4], center: [4, 0] }]), locked: true };
    const svgLine = makeSVGFromVertices('l1', [[0, 0], [4, 4]]);
    const state = makeState({ svgObjects: [lockedArc, svgLine] });
    // Arc is on top in sceneOrder but locked, so the line wins.
    expect(findStrokeAtCell(state, 2, 2)).toEqual({ kind: 'svg', id: 'l1' });
  });

  test('tolerates an svgObjects-undefined state shell (legacy partials)', () => {
    const state = makeState();
    // @ts-expect-error: simulate older code that constructed state without `svgObjects`
    delete state.svgObjects;
    const svgLine = makeSVGFromVertices('l1', [[0, 0], [10, 0]]);
    state.svgObjects = [svgLine];
    state.sceneOrder = ['l1'];
    expect(findStrokeAtCell(state, 5, 0)).toEqual({ kind: 'svg', id: 'l1' });
  });
});
