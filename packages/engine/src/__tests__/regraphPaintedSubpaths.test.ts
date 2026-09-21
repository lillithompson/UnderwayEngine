/**
 * A paint stroke across a shape's OUTLINE, on a composition that carries a
 * scene graph.
 *
 * Reported as: brush one edge of a rectangle and the edge shows the new
 * colour under the finger — let go and the WHOLE outline snaps to it.
 *
 * The commit is right: `buildPaintStrokeOps` regroups the segments into
 * `subpaths`, one per run of colour, and the state comes out holding them
 * (reload the page and the rectangle draws with its one recoloured edge).
 * What was wrong is the trip back into the graph. `regraphChangedLeaves`
 * asks `contentOnlyNode` whether a changed leaf can simply be re-hung on
 * the node it already has, and that probe compares the node's RENDER
 * against the incoming leaf. The render carries `subpaths` straight through
 * from the content whenever the node has no mirror of its own
 * (`localSubpaths`), so a leaf that had just grown subpaths matched field
 * for field — and the node kept no mirror. The mirror is what everything
 * DRAWN reads (`svgLocalGeometry` deletes `subpaths` without one), so the
 * drawing threw the runs away and painted the whole path in the leading
 * colour, which is the colour the drop snapped to.
 *
 * The assertions are on the DRAWN object rather than on the arrays,
 * because the arrays were right all along — it is what the renderer is
 * handed that was not.
 */

import { applyCompOps, withSceneGraph } from '../compositionOps';
import { getNode, worldMatrix } from '../sceneGraph';
import { svgLocalGeometry } from '../sceneDrawnContent';
import {
  CompUndoOp, CompositionState, RGBColor, SVGObject, SVGSubpath, makeViewport,
} from '../types';

jest.mock('@/native-shell/bridge/webBridge', () => ({ logToNative: jest.fn() }));

const GREEN: RGBColor = { r: 163, g: 230, b: 53 };
const RED: RGBColor = { r: 244, g: 63, b: 94 };

/** The four sides of a 4 x 3 rectangle at the origin, in one run. */
const SIDES = [
  { kind: 'line', start: [0, 0], end: [4, 0] },
  { kind: 'line', start: [4, 0], end: [4, 3] },
  { kind: 'line', start: [4, 3], end: [0, 3] },
  { kind: 'line', start: [0, 3], end: [0, 0] },
] as SVGObject['segments'];

const rect: SVGObject = {
  id: 'svg_1', color: GREEN, segments: SIDES,
  cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 3,
} as SVGObject;

function makeState(): CompositionState {
  return withSceneGraph({
    id: 'test', name: 'test',
    figures: [], svgObjects: [rect], images: [], texts: [],
    paintObjects: [], patternObjects: [], imageBlobs: {},
    lineDraft: null, arcDraft: null,
    editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 }, customColors: [],
    groups: [], sceneOrder: ['svg_1'],
    gridLevel: 0, strokeScale: 8, gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(), activeFigureKey: null,
    compTool: 'select', createRegion: null, renderGeneration: 0,
  } as CompositionState);
}

/** The top side red, the other three left alone — the shape a stroke over
 *  one edge commits (regroupSegmentsByColor's output). */
const RECOLOURED: SVGSubpath[] = [
  { color: RED, segments: SIDES.slice(0, 1) },
  { color: GREEN, segments: SIDES.slice(1) },
];

const paintOneEdge: CompUndoOp = {
  op: 'recolorSVG',
  svgId: 'svg_1',
  oldColor: GREEN,
  newColor: RED,
  oldSegments: SIDES,
  oldSubpaths: undefined,
  newSegments: SIDES,
  newSubpaths: RECOLOURED,
};

/** What the renderer is handed for the shape: the object `svgLocalGeometry`
 *  builds, which is what both the canvas layer and the SVG export draw. */
function drawn(state: CompositionState): SVGObject {
  const node = getNode(state.graph!, 'svg_1')!;
  return svgLocalGeometry(node, worldMatrix(state.graph!, 'svg_1')).object;
}

describe('a painted outline reaches the drawing, run by run', () => {
  test('the state holds the recoloured runs', () => {
    // The commit half, which was never the broken one.
    const after = applyCompOps(makeState(), [paintOneEdge]);
    const svg = after.svgObjects.find((o) => o.id === 'svg_1')!;
    expect(svg.subpaths?.map((sp) => sp.color)).toEqual([RED, GREEN]);
  });

  test('and so does the object the renderer draws', () => {
    // The bug: this came back with no subpaths at all, so the whole
    // outline drew in `color` — the leading run's red.
    const after = applyCompOps(makeState(), [paintOneEdge]);
    const object = drawn(after);
    expect(object.subpaths?.map((sp) => sp.color)).toEqual([RED, GREEN]);
    expect(object.subpaths?.map((sp) => sp.segments.length)).toEqual([1, 3]);
  });

  test('the node grew the local mirror the drawing reads', () => {
    // `svgLocalGeometry` deletes `subpaths` unless the node carries
    // `localSubpaths`, so the mirror IS the fix: the probe now refuses the
    // content-only shortcut for a subpaths change and the leaf is read in
    // again, which is what builds one.
    const after = applyCompOps(makeState(), [paintOneEdge]);
    const node = getNode(after.graph!, 'svg_1')!;
    expect(node.localSubpaths?.map((sp) => sp.color)).toEqual([RED, GREEN]);
  });

  test('a second pass over the same outline lands on top of the first', () => {
    // The runs a stroke commits are read off the state it started from, so
    // the graph has to be right BETWEEN strokes, not only after a reload.
    const once = applyCompOps(makeState(), [paintOneEdge]);
    const twice = applyCompOps(once, [{
      op: 'recolorSVG',
      svgId: 'svg_1',
      oldColor: RED,
      newColor: RED,
      oldSegments: SIDES,
      oldSubpaths: RECOLOURED,
      newSegments: SIDES,
      newSubpaths: [
        { color: RED, segments: SIDES.slice(0, 2) },
        { color: GREEN, segments: SIDES.slice(2) },
      ],
    }]);
    expect(drawn(twice).subpaths?.map((sp) => sp.segments.length)).toEqual([2, 2]);
  });

  test('a shape with no runs still draws as one path', () => {
    // The shortcut is only refused where the subpaths actually changed; a
    // plain outline keeps coming back without any.
    expect(drawn(makeState()).subpaths).toBeUndefined();
  });
});
