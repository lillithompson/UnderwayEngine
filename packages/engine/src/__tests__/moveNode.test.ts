import { applyCompOps, revertCompOps, computeSVGBbox } from '../compositionOps';
import { SVGObject, PathSegment, CompositionFigure, CompositionState, CompUndoEntry, makeViewport } from '../types';

const WHITE = { r: 255, g: 255, b: 255 };

function makeState(overrides: Partial<CompositionState> = {}): CompositionState {
  const figures = overrides.figures ?? [];
  const svgObjects = overrides.svgObjects ?? [];
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
    activeFigureKey: null,
    compTool: 'select',
    createRegion: null,
    renderGeneration: 0,
    ...overrides,
  };
}

function makeFigure(): CompositionFigure {
  return {
    id: 'fig1', figureKey: 'k', cellX: 5, cellY: 5,
    resolutionX: 2, resolutionY: 2, cellWidth: 2, cellHeight: 2,
  };
}

function makeSVGArc(id: string, segments: PathSegment[]): SVGObject {
  return { id, segments, color: WHITE, ...computeSVGBbox(segments) };
}

function makeSVGLine(id: string, segments: PathSegment[]): SVGObject {
  return { id, segments, color: WHITE, ...computeSVGBbox(segments) };
}

describe('moveNode op uniformly translates any node type', () => {
  test('svg (line-like): translates every segment point and the bbox, revert restores rotation/mirror', () => {
    const svg: SVGObject = {
      ...makeSVGLine('l1', [{kind:'line', start:[1,1], end:[4,1]}, {kind:'line', start:[4,1], end:[4,4]}]),
      identitySegments: [{kind:'line', start:[1,1], end:[4,1]}, {kind:'line', start:[4,1], end:[4,4]}],
      rotation: 90,
      mirrorH: true,
    };
    const state = makeState({ svgObjects: [svg] });
    const entry: CompUndoEntry = [{
      op: 'moveNode', nodeId: 'l1', dx: 10, dy: -2,
      oldIdentitySegments: [{kind:'line', start:[1,1], end:[4,1]}, {kind:'line', start:[4,1], end:[4,4]}],
      oldRotation: 90,
      oldMirrorH: true,
    }];
    const after = applyCompOps(state, entry);
    expect(after.svgObjects[0].segments).toEqual([{kind:'line', start:[11,-1], end:[14,-1]}, {kind:'line', start:[14,-1], end:[14,2]}]);
    expect(after.svgObjects[0].cellX).toBe(11);
    expect(after.svgObjects[0].cellY).toBe(-1);
    expect(after.svgObjects[0].identitySegments).toBeUndefined();
    expect(after.svgObjects[0].rotation).toBeUndefined();
    expect(after.svgObjects[0].mirrorH).toBeUndefined();
    const back = revertCompOps(after, entry);
    expect(back.svgObjects[0].segments).toEqual([{kind:'line', start:[1,1], end:[4,1]}, {kind:'line', start:[4,1], end:[4,4]}]);
    expect(back.svgObjects[0].cellX).toBe(1);
    expect(back.svgObjects[0].cellY).toBe(1);
    expect(back.svgObjects[0].identitySegments).toEqual([{kind:'line', start:[1,1], end:[4,1]}, {kind:'line', start:[4,1], end:[4,4]}]);
    expect(back.svgObjects[0].rotation).toBe(90);
    expect(back.svgObjects[0].mirrorH).toBe(true);
  });

  test('svg (arc-like): translates every segment point (start/end/center) and the bbox', () => {
    const segs: PathSegment[] = [{ kind: 'arc', start: [0, 0], end: [3, 3], center: [0, 3] }];
    const svg = makeSVGArc('a1', segs);
    const state = makeState({ svgObjects: [svg] });
    const entry: CompUndoEntry = [{
      op: 'moveNode', nodeId: 'a1', dx: 5, dy: 7,
    }];
    const after = applyCompOps(state, entry);
    const moved = after.svgObjects[0].segments[0];
    expect(moved.kind).toBe('arc');
    if (moved.kind === 'arc') {
      expect(moved.start).toEqual([5, 7]);
      expect(moved.end).toEqual([8, 10]);
      expect(moved.center).toEqual([5, 10]);
    }
    expect(after.svgObjects[0].cellX).toBe(5);
    expect(after.svgObjects[0].cellY).toBe(7);
    const back = revertCompOps(after, entry);
    const reverted = back.svgObjects[0].segments[0];
    if (reverted.kind === 'arc') {
      expect(reverted.start).toEqual([0, 0]);
      expect(reverted.end).toEqual([3, 3]);
      expect(reverted.center).toEqual([0, 3]);
    }
    expect(back.svgObjects[0].cellX).toBe(0);
    expect(back.svgObjects[0].cellY).toBe(0);
  });

  test('grouped svg: translates localSegments and localCell* alongside world coords', () => {
    const svg: SVGObject = {
      ...makeSVGLine('l1', [{kind:'line', start:[0,0], end:[4,0]}]),
      groupId: 'g1',
      localSegments: [{kind:'line', start:[0,0], end:[4,0]}],
      localCellX: 0, localCellY: 0, localCellWidth: 4, localCellHeight: 0,
    };
    const state = makeState({ svgObjects: [svg] });
    const entry: CompUndoEntry = [{
      op: 'moveNode', nodeId: 'l1', dx: 3, dy: 3,
    }];
    const after = applyCompOps(state, entry);
    expect(after.svgObjects[0].segments).toEqual([{kind:'line', start:[3,3], end:[7,3]}]);
    expect(after.svgObjects[0].localSegments).toEqual([{kind:'line', start:[3,3], end:[7,3]}]);
    expect(after.svgObjects[0].localCellX).toBe(3);
    expect(after.svgObjects[0].localCellY).toBe(3);
  });

  test('zero-delta moveNode is a no-op even on identity-bearing nodes', () => {
    const fig = { ...makeFigure(), identityCellX: 5, identityCellY: 5 };
    const state = makeState({ figures: [fig] });
    const after = applyCompOps(state, [{ op: 'moveNode', nodeId: 'fig1', dx: 0, dy: 0 }]);
    expect(after).toBe(state);
  });
});
