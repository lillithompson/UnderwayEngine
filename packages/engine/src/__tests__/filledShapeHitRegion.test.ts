import {
  computeSVGBbox, findSceneObjectAtCell,
} from '../compositionOps';
import { svgPaintsInterior } from '../svgPathBuilder';
import { svgInteriorHitsPoint } from '../compositionPathHitTest';
import {
  CompositionState, PathSegment, ShapePatternFill, SVGObject, makeViewport,
} from '../types';

// A shape that paints its INTERIOR reaches only as far as its own outline.
//
// The picking walk falls back to a shape's BOX when the tap misses its
// stroke — which is what makes a hollow outline forgiving to tap near, and
// what made the corners of a pattern-filled circle's box select the circle.
// Those corners are page: the reader can see there is nothing of the object
// there. So a shape with an interior falls back to that interior instead.

const WHITE = { r: 255, g: 255, b: 255 };

/** A closed diamond inside the box (0,0)-(10,10): its corners are empty. */
function diamond(id: string, extra: Partial<SVGObject> = {}): SVGObject {
  const pts: [number, number][] = [[5, 0], [10, 5], [5, 10], [0, 5], [5, 0]];
  const segments: PathSegment[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    segments.push({ kind: 'line', start: pts[i], end: pts[i + 1] });
  }
  return { id, segments, color: WHITE, ...computeSVGBbox(segments), ...extra };
}

/** A pattern fill with ink in it — an EMPTY tile draws nothing. */
function inkedPattern(): ShapePatternFill {
  return { size: 2, cells: [1, null, null, 1], tileL0: 2 } as unknown as ShapePatternFill;
}

function makeState(svgObjects: SVGObject[]): CompositionState {
  return {
    id: 't', name: 't',
    figures: [], svgObjects, images: [], imageBlobs: {},
    lineDraft: null, arcDraft: null,
    editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: WHITE,
    customColors: [],
    groups: [],
    sceneOrder: svgObjects.map((s) => s.id),
    gridLevel: 0, strokeScale: 8, gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(),
    activeFigureKey: null,
    compTool: 'select',
    createRegion: null,
    renderGeneration: 0,
  } as unknown as CompositionState;
}

// Far enough from every edge that the stroke tolerance cannot reach it —
// the tolerance here is 24 screen px over a 800 px / 32-cell view, ~0.96
// cells. (0.2, 0.2) is 3.2 cells from the nearest diamond edge.
const CORNER: [number, number] = [0.2, 0.2];
const MIDDLE: [number, number] = [5, 5];

describe('svgPaintsInterior', () => {
  test('any of the three paint fields, and a pattern fill’s tiles', () => {
    expect(svgPaintsInterior(diamond('a'))).toBe(false);
    expect(svgPaintsInterior(diamond('a', { fillColor: WHITE }))).toBe(true);
    expect(svgPaintsInterior(diamond('a', { patternFill: inkedPattern() }))).toBe(true);
  });

  test('an empty pattern tile draws nothing, so it is no interior', () => {
    const empty = { size: 2, cells: [null, null, null, null], tileL0: 2 } as unknown as ShapePatternFill;
    expect(svgPaintsInterior(diamond('a', { patternFill: empty }))).toBe(false);
  });

  test('a legacy pattern-fill MASK is outline-only, as svgIsFilled says', () => {
    expect(svgPaintsInterior(diamond('a', { fillColor: WHITE, isPatternFill: true }))).toBe(false);
  });
});

describe('svgInteriorHitsPoint', () => {
  test('inside the closed path, and not in the corners of its box', () => {
    const d = diamond('a');
    expect(svgInteriorHitsPoint(d, ...MIDDLE)).toBe(true);
    expect(svgInteriorHitsPoint(d, ...CORNER)).toBe(false);
  });

  test('a filled subpath counts as interior too', () => {
    const d = diamond('a');
    const withSub = { ...d, subpaths: [{ segments: d.segments, color: WHITE, fill: true }] };
    expect(svgInteriorHitsPoint({ segments: [], subpaths: withSub.subpaths } as never, ...MIDDLE)).toBe(true);
  });
});

describe('the tap region of a shape that paints its interior', () => {
  test('a pattern-filled shape is tapped inside its outline, never in the corners', () => {
    const state = makeState([diamond('svg_d', { patternFill: inkedPattern() })]);
    expect(findSceneObjectAtCell(state, ...MIDDLE)).toEqual({ kind: 'svg', id: 'svg_d' });
    expect(findSceneObjectAtCell(state, ...CORNER)).toBeNull();
  });

  test('…and so is a plainly filled one', () => {
    const state = makeState([diamond('svg_d', { fillColor: WHITE })]);
    expect(findSceneObjectAtCell(state, ...MIDDLE)).toEqual({ kind: 'svg', id: 'svg_d' });
    expect(findSceneObjectAtCell(state, ...CORNER)).toBeNull();
  });

  test('a HOLLOW shape keeps its box: there is nothing inside it to have meant', () => {
    const state = makeState([diamond('svg_d')]);
    expect(findSceneObjectAtCell(state, ...CORNER)).toEqual({ kind: 'svg', id: 'svg_d' });
  });

  test('the shape behind still gets the corner a filled one no longer claims', () => {
    const behind = diamond('svg_back');
    const front = diamond('svg_front', { fillColor: WHITE });
    const state = makeState([behind, front]);
    // Front-to-back: the filled diamond declines the corner, and the hollow
    // one behind it takes it on its own box fallback.
    expect(findSceneObjectAtCell(state, ...CORNER)).toEqual({ kind: 'svg', id: 'svg_back' });
    // The middle is the front one's, as it always was.
    expect(findSceneObjectAtCell(state, ...MIDDLE)).toEqual({ kind: 'svg', id: 'svg_front' });
  });

  test('a selected shape is still bbox-definitive — the user said which object', () => {
    const state = makeState([diamond('svg_d', { fillColor: WHITE })]);
    state.selectedFigureIds.add('svg_d');
    expect(findSceneObjectAtCell(state, ...CORNER)).toEqual({ kind: 'svg', id: 'svg_d' });
  });
});
