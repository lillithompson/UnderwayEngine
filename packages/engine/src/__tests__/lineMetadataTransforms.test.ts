import {
  applyCompOps,
  computeSVGBbox,
  mirrorSVG,
  revertCompOps,
  rotateSVG90CW,
} from '../compositionOps';
import { GEOMETRY_ADAPTERS } from '../sceneNodeGeometry';
import { CompositionState, CompUndoEntry, SVGObject, makeViewport } from '../types';

// H/V line metadata (`lineDirection` + `creationBox`) must track the
// geometry through every transform that rewrites segments: 90° rotation
// swaps the axis and the box, mirror leaves both alone (the box straddles
// the line, centred on the pivot), and rescale maps the box through the
// same affine as the segments.

function makeState(svgObjects: SVGObject[] = [], overrides: Partial<CompositionState> = {}): CompositionState {
  return {
    id: 'test',
    name: 'test',
    figures: [],
    svgObjects,
    lineDraft: null,
    arcDraft: null,
    editingLineId: null,
    selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
    customColors: [],
    groups: [],
    sceneOrder: svgObjects.map((l) => l.id),
    gridLevel: 0,
    strokeScale: 8,
    gridIntensity: 0.5,
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

/** A creation-tool horizontal line from (2,5) to (10,5), box one cell
 *  thick straddling the stroke. */
function makeHLine(overrides: Partial<SVGObject> = {}): SVGObject {
  const segs = [{ kind: 'line' as const, start: [2, 5] as [number, number], end: [10, 5] as [number, number] }];
  return {
    id: 'svg_line',
    segments: segs,
    color: { r: 0, g: 0, b: 0 },
    ...computeSVGBbox(segs),
    lineDirection: 'horizontal',
    creationBox: { minX: 2, minY: 4.5, width: 8, height: 1 },
    ...overrides,
  };
}

describe('rotateSVG90CW line metadata', () => {
  test('swaps lineDirection and rotates the creationBox about its centre', () => {
    const rotated = rotateSVG90CW(makeHLine());
    expect(rotated.lineDirection).toBe('vertical');
    // Line midpoint (6, 5) is the pivot; the box swaps extents about it.
    expect(rotated.creationBox).toEqual({ minX: 5.5, minY: 1, width: 1, height: 8 });
    // The segments really are vertical now, centred on the same midpoint.
    const seg = rotated.segments[0];
    expect(seg.start[0]).toBe(6);
    expect(seg.end[0]).toBe(6);
    expect(Math.abs(seg.end[1] - seg.start[1])).toBe(8);
  });

  test('four rotations land exactly on the original box and direction', () => {
    let svg = makeHLine();
    for (let i = 0; i < 4; i++) svg = rotateSVG90CW(svg);
    expect(svg.lineDirection).toBe('horizontal');
    expect(svg.creationBox).toEqual({ minX: 2, minY: 4.5, width: 8, height: 1 });
    expect(svg.segments[0].start).toEqual([2, 5]);
    expect(svg.segments[0].end).toEqual([10, 5]);
  });

  test('leaves diagonal and unset metadata untouched', () => {
    const segs = [{ kind: 'line' as const, start: [0, 0] as [number, number], end: [4, 3] as [number, number] }];
    const free = rotateSVG90CW(makeHLine({ segments: segs, ...computeSVGBbox(segs), lineDirection: undefined, creationBox: undefined }));
    expect(free.lineDirection).toBeUndefined();
    expect(free.creationBox).toBeUndefined();
    const diag = rotateSVG90CW(makeHLine({ lineDirection: 'diagonal', creationBox: undefined }));
    expect(diag.lineDirection).toBe('diagonal');
  });
});

describe('mirrorSVG line metadata', () => {
  test('keeps direction and box (the box straddles the mirror pivot)', () => {
    for (const axis of ['h', 'v'] as const) {
      const mirrored = mirrorSVG(makeHLine(), axis);
      expect(mirrored.lineDirection).toBe('horizontal');
      expect(mirrored.creationBox).toEqual({ minX: 2, minY: 4.5, width: 8, height: 1 });
      // Geometry maps onto itself: same endpoints (possibly swapped).
      const pts = [mirrored.segments[0].start, mirrored.segments[0].end].sort((a, b) => a[0] - b[0]);
      expect(pts).toEqual([[2, 5], [10, 5]]);
    }
  });
});

describe('editSVGSegments lineDirection round-trip', () => {
  test('apply sets the new direction, revert restores the old', () => {
    const line = makeHLine();
    const state = makeState([line]);
    const rotated = rotateSVG90CW(line);
    const entry: CompUndoEntry = [{
      op: 'editSVGSegments', svgId: line.id,
      oldSegments: line.segments, newSegments: rotated.segments,
      oldCreationBox: line.creationBox, newCreationBox: rotated.creationBox,
      oldLineDirection: line.lineDirection, newLineDirection: rotated.lineDirection,
    }];
    const after = applyCompOps(state, entry);
    expect(after.svgObjects[0].lineDirection).toBe('vertical');
    expect(after.svgObjects[0].creationBox).toEqual(rotated.creationBox);
    const reverted = revertCompOps(after, entry);
    expect(reverted.svgObjects[0].lineDirection).toBe('horizontal');
    expect(reverted.svgObjects[0].creationBox).toEqual(line.creationBox);
    expect(reverted.svgObjects[0].segments).toEqual(line.segments);
  });

  test('ops without the fields leave existing metadata alone', () => {
    const line = makeHLine();
    const state = makeState([line]);
    const shifted = line.segments.map((s) => s.kind === 'line'
      ? { kind: 'line' as const, start: [s.start[0], s.start[1]] as [number, number], end: [s.end[0] + 1, s.end[1]] as [number, number] }
      : s);
    const entry: CompUndoEntry = [{
      op: 'editSVGSegments', svgId: line.id,
      oldSegments: line.segments, newSegments: shifted,
    }];
    const after = applyCompOps(state, entry);
    expect(after.svgObjects[0].lineDirection).toBe('horizontal');
    expect(after.svgObjects[0].creationBox).toEqual(line.creationBox);
  });
});

describe('svgAdapter.rescale creationBox', () => {
  test('maps the box through the same affine as the segments', () => {
    const line = makeHLine();
    // Scale the line's x-extent 2× from a box anchored at its AABB.
    const oldBbox = { cellX: 2, cellY: 5, cellWidth: 8, cellHeight: 0 };
    const newBbox = { cellX: 2, cellY: 5, cellWidth: 16, cellHeight: 0 };
    const scaled = GEOMETRY_ADAPTERS.svg.rescale(line, oldBbox, newBbox) as SVGObject;
    expect(scaled.segments[0].start).toEqual([2, 5]);
    expect(scaled.segments[0].end).toEqual([18, 5]);
    // Degenerate y-axis: scale 1, no shift — thickness preserved.
    expect(scaled.creationBox).toEqual({ minX: 2, minY: 4.5, width: 16, height: 1 });
  });

  test('translates the box when the degenerate axis moves', () => {
    const line = makeHLine();
    const oldBbox = { cellX: 2, cellY: 5, cellWidth: 8, cellHeight: 0 };
    const newBbox = { cellX: 4, cellY: 9, cellWidth: 8, cellHeight: 0 };
    const scaled = GEOMETRY_ADAPTERS.svg.rescale(line, oldBbox, newBbox) as SVGObject;
    expect(scaled.segments[0].start).toEqual([4, 9]);
    expect(scaled.creationBox).toEqual({ minX: 4, minY: 8.5, width: 8, height: 1 });
  });
});
