import {
  applySceneOrder,
  computeSVGBbox,
  deriveSceneOrderFromKindArrays,
  findSceneObjectAtCell,
} from '../compositionOps';
import {
  CompositionFigure,
  CompositionState,
  ImageObject,
  PathSegment,
  SVGObject,
  makeViewport,
} from '../types';

const WHITE = { r: 255, g: 255, b: 255 };

function makeFigure(id: string, overrides: Partial<CompositionFigure> = {}): CompositionFigure {
  return {
    id,
    figureKey: 'k',
    cellX: 0, cellY: 0,
    resolutionX: 2, resolutionY: 2,
    cellWidth: 2, cellHeight: 2,
    ...overrides,
  };
}

function makeImage(id: string, overrides: Partial<ImageObject> = {}): ImageObject {
  return {
    id,
    imageId: id,
    cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
    pixelWidth: 64, pixelHeight: 64,
    mimeType: 'image/png',
    ...overrides,
  };
}

function makeLine(id: string, vertices: [number, number][]): SVGObject {
  const segments: PathSegment[] = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    segments.push({ kind: 'line', start: vertices[i], end: vertices[i + 1] });
  }
  return { id, segments, color: WHITE, ...computeSVGBbox(segments) };
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

describe('findSceneObjectAtCell — z-order across kinds', () => {
  // Regression for the "place a line on top of a figure, send figure to back,
  // tap line → figure gets selected" bug. The previous canvas pointer-down
  // chain ran kind-priority hit-tests (figures, then strokes, then images),
  // so a figure z-below a line still won the tap. This unified helper must
  // walk sceneOrder front-to-back across every kind.
  test('line placed on top of a larger figure wins the tap', () => {
    const big = makeFigure('big', { cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const line = makeLine('l1', [[2, 5], [8, 5]]);
    const state = makeState({
      figures: [big],
      svgObjects: [line],
      sceneOrder: ['big', 'l1'], // line on top
    });
    expect(findSceneObjectAtCell(state, 5, 5)).toEqual({ kind: 'svg', id: 'l1' });
  });

  test('after applySceneOrder lifts the figure to the front, the figure wins instead', () => {
    const big = makeFigure('big', { cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const line = makeLine('l1', [[2, 5], [8, 5]]);
    let state = makeState({
      figures: [big],
      svgObjects: [line],
      sceneOrder: ['big', 'l1'],
    });
    expect(findSceneObjectAtCell(state, 5, 5)).toEqual({ kind: 'svg', id: 'l1' });
    state = applySceneOrder(state, ['l1', 'big']);
    expect(findSceneObjectAtCell(state, 5, 5)).toEqual({ kind: 'figure', id: 'big' });
  });

  test('image on top of a figure wins the tap (symmetric case)', () => {
    const big = makeFigure('big', { cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const img = makeImage('i1', { cellX: 3, cellY: 3, cellWidth: 4, cellHeight: 4 });
    const state = makeState({
      figures: [big],
      images: [img],
      sceneOrder: ['big', 'i1'],
    });
    expect(findSceneObjectAtCell(state, 5, 5)).toEqual({ kind: 'image', id: 'i1' });
  });

  test('figure on top of a line wins the tap', () => {
    const big = makeFigure('big', { cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const line = makeLine('l1', [[2, 5], [8, 5]]);
    const state = makeState({
      figures: [big],
      svgObjects: [line],
      sceneOrder: ['l1', 'big'], // figure on top
    });
    expect(findSceneObjectAtCell(state, 5, 5)).toEqual({ kind: 'figure', id: 'big' });
  });

  test('hidden front-most image is skipped, next-front wins', () => {
    const big = makeFigure('big', { cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const img = makeImage('i1', { cellX: 3, cellY: 3, cellWidth: 4, cellHeight: 4, hidden: true });
    const state = makeState({
      figures: [big],
      images: [img],
      sceneOrder: ['big', 'i1'], // image on top, but hidden
    });
    expect(findSceneObjectAtCell(state, 5, 5)).toEqual({ kind: 'figure', id: 'big' });
  });

  test('hidden image is skipped even when ignoreLock is true', () => {
    const img = makeImage('i1', { cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4, hidden: true });
    const state = makeState({ images: [img], sceneOrder: ['i1'] });
    expect(findSceneObjectAtCell(state, 1, 1, { ignoreLock: true })).toBeNull();
  });

  test('a member of a hidden group is skipped, next-front wins', () => {
    // The image's OWN `hidden` flag is clear — it inherits the hide from its
    // frame, exactly as it inherits a lock.
    const big = makeFigure('big', { cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const img = makeImage('i1', { cellX: 3, cellY: 3, cellWidth: 4, cellHeight: 4, groupId: 'frame' });
    const state = makeState({
      figures: [big],
      images: [img],
      groups: [{
        id: 'frame', name: 'Daily Haiku', isFrame: true, hidden: true,
        translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
        rotation: 0, mirrorH: false, mirrorV: false,
      }],
      sceneOrder: ['big', 'i1'], // image on top, but its frame is hidden
    });
    expect(img.hidden).toBeUndefined();
    expect(findSceneObjectAtCell(state, 5, 5)).toEqual({ kind: 'figure', id: 'big' });
    // ignoreLock (eyedropper) does not resurrect an invisible node either.
    expect(findSceneObjectAtCell(state, 5, 5, { ignoreLock: true })).toEqual({ kind: 'figure', id: 'big' });
  });

  test('a visible group does not hide its members', () => {
    const img = makeImage('i1', { cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4, groupId: 'frame' });
    const state = makeState({
      images: [img],
      groups: [{
        id: 'frame', name: 'Daily Haiku', isFrame: true,
        translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
        rotation: 0, mirrorH: false, mirrorV: false,
      }],
      sceneOrder: ['i1'],
    });
    expect(findSceneObjectAtCell(state, 1, 1)).toEqual({ kind: 'image', id: 'i1' });
  });

  test('locked front-most object is skipped, next-front wins', () => {
    const big = makeFigure('big', { cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10, locked: true });
    const line = makeLine('l1', [[2, 5], [8, 5]]);
    const state = makeState({
      figures: [big],
      svgObjects: [line],
      sceneOrder: ['l1', 'big'], // figure on top, but locked
    });
    expect(findSceneObjectAtCell(state, 5, 5)).toEqual({ kind: 'svg', id: 'l1' });
  });

  test('returns null when no object covers the point', () => {
    const big = makeFigure('big', { cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2 });
    const state = makeState({ figures: [big] });
    expect(findSceneObjectAtCell(state, 50, 50)).toBeNull();
  });
});

describe('findSceneObjectAtCell — pixel-accurate SVG hit testing', () => {
  // Diagonal line from (0,0) to (10,10). Its bbox covers a 10x10 area but
  // the stroke is only ~0 cells wide along the diagonal.
  function makeDiagonalLine(id: string): SVGObject {
    const segments: PathSegment[] = [{ kind: 'line', start: [0, 0], end: [10, 10] }];
    return { id, segments, color: WHITE, ...computeSVGBbox(segments) };
  }

  test('tap near diagonal line stroke selects the SVG', () => {
    const fig = makeFigure('fig', { cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const line = makeDiagonalLine('svg_diag');
    const state = makeState({
      figures: [fig],
      svgObjects: [line],
      sceneOrder: ['fig', 'svg_diag'], // SVG on top
    });
    // Tap on the diagonal (5,5) — directly on the stroke
    expect(findSceneObjectAtCell(state, 5, 5)).toEqual({ kind: 'svg', id: 'svg_diag' });
  });

  test('tap far from diagonal line stroke but inside its bbox selects figure behind', () => {
    const fig = makeFigure('fig', { cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const line = makeDiagonalLine('svg_diag');
    const state = makeState({
      figures: [fig],
      svgObjects: [line],
      sceneOrder: ['fig', 'svg_diag'], // SVG on top
    });
    // Tap at (1, 9) — inside the 10x10 bbox but far from the diagonal stroke
    // Distance from (1,9) to line y=x is |1-9|/sqrt(2) ≈ 5.66 cells
    expect(findSceneObjectAtCell(state, 1, 9)).toEqual({ kind: 'figure', id: 'fig' });
  });

  test('lone SVG with no objects behind falls back to bbox selection', () => {
    const line = makeDiagonalLine('svg_diag');
    const state = makeState({
      svgObjects: [line],
      sceneOrder: ['svg_diag'],
    });
    // Tap at (1, 9) — inside bbox but far from stroke. No fallback object.
    // Should still return the SVG via bbox fallback.
    expect(findSceneObjectAtCell(state, 1, 9)).toEqual({ kind: 'svg', id: 'svg_diag' });
  });

  test('arc: tap inside bbox but far from curve selects figure behind', () => {
    const fig = makeFigure('fig', { cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    // Quarter-circle arc from (8,0) to (0,8) centered at (0,0), radius 8
    const arcSeg: PathSegment = { kind: 'arc', start: [8, 0], end: [0, 8], center: [0, 0] };
    const arc: SVGObject = {
      id: 'svg_arc', segments: [arcSeg], color: WHITE,
      ...computeSVGBbox([arcSeg]),
    };
    const state = makeState({
      figures: [fig],
      svgObjects: [arc],
      sceneOrder: ['fig', 'svg_arc'], // arc on top
    });
    // Tap at (1, 1) — inside the arc's 8x8 bbox but far from the arc curve
    // (radius from center to (1,1) ≈ 1.41, arc radius = 8, radial distance ≈ 6.59)
    expect(findSceneObjectAtCell(state, 1, 1)).toEqual({ kind: 'figure', id: 'fig' });
  });

  test('arc: tap near the arc curve selects the SVG', () => {
    const fig = makeFigure('fig', { cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const arcSeg: PathSegment = { kind: 'arc', start: [8, 0], end: [0, 8], center: [0, 0] };
    const arc: SVGObject = {
      id: 'svg_arc', segments: [arcSeg], color: WHITE,
      ...computeSVGBbox([arcSeg]),
    };
    const state = makeState({
      figures: [fig],
      svgObjects: [arc],
      sceneOrder: ['fig', 'svg_arc'],
    });
    // Tap at 45 degrees on the arc: (8/sqrt2, 8/sqrt2) ≈ (5.66, 5.66)
    const x = 8 * Math.SQRT1_2;
    const y = 8 * Math.SQRT1_2;
    expect(findSceneObjectAtCell(state, x, y)).toEqual({ kind: 'svg', id: 'svg_arc' });
  });

  test('tiled SVG uses bbox-only (no precise test)', () => {
    const fig = makeFigure('fig', { cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const line = makeDiagonalLine('svg_tiled');
    line.tileMode = 'repeat';
    line.tileWidthL0 = 10;
    line.tileHeightL0 = 10;
    const state = makeState({
      figures: [fig],
      svgObjects: [line],
      sceneOrder: ['fig', 'svg_tiled'],
    });
    // Tap far from stroke but inside bbox — tiled SVG should still win
    expect(findSceneObjectAtCell(state, 1, 9)).toEqual({ kind: 'svg', id: 'svg_tiled' });
  });

  test('SVG with subpaths: tap near subpath segment hits', () => {
    const fig = makeFigure('fig', { cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    // Primary segment is diagonal from (0,0) to (10,10)
    // Subpath segment is horizontal from (0,9) to (10,9)
    const svg: SVGObject = {
      id: 'svg_sub',
      segments: [{ kind: 'line', start: [0, 0], end: [10, 10] }],
      subpaths: [{
        segments: [{ kind: 'line', start: [0, 9], end: [10, 9] }],
        color: { r: 255, g: 0, b: 0 },
      }],
      color: WHITE,
      cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10,
    };
    const state = makeState({
      figures: [fig],
      svgObjects: [svg],
      sceneOrder: ['fig', 'svg_sub'],
    });
    // Tap at (1, 9) — far from the diagonal primary but on the subpath
    expect(findSceneObjectAtCell(state, 1, 9)).toEqual({ kind: 'svg', id: 'svg_sub' });
  });

  test('locked SVG is skipped regardless of precise hit', () => {
    const fig = makeFigure('fig', { cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const line = makeDiagonalLine('svg_locked');
    line.locked = true;
    const state = makeState({
      figures: [fig],
      svgObjects: [line],
      sceneOrder: ['fig', 'svg_locked'],
    });
    // Tap on the stroke — locked SVG is skipped, figure wins
    expect(findSceneObjectAtCell(state, 5, 5)).toEqual({ kind: 'figure', id: 'fig' });
  });
});

describe('findSceneObjectAtCell — selected SVG is bbox-definitive', () => {
  // Mirrors the duplicate-then-move workflow: a duplicated SVG is
  // auto-selected and appended to sceneOrder (rendered on top). Without
  // selection-aware hit testing, a drag inside the duplicate's bbox that
  // lands far from the duplicate's stroke falls through to the original
  // and the wrong object gets moved.
  //
  // The shipped duplicate offset scales with composition bbox (~3% of
  // bbox per axis); here the parallel diagonal is shifted further along
  // x so the stroke perpendicular distance exceeds the default
  // tolerance (~0.96 cells at viewport 800px / zoom 1). The mechanism
  // under test — selection biasing the bbox-fallback case — is the same
  // regardless of offset magnitude.
  function makeDiag(id: string, ox: number, oy: number): SVGObject {
    const segments: PathSegment[] = [{ kind: 'line', start: [ox, oy], end: [ox + 10, oy + 10] }];
    return { id, segments, color: WHITE, ...computeSVGBbox(segments) };
  }

  test('duplicate (selected, on top) wins when tap lands on original stroke inside duplicate bbox', () => {
    const original = makeDiag('orig', 0, 0);   // y = x, bbox 0..10
    const duplicate = makeDiag('dup', 3, 0);   // y = x - 3, bbox 3..13 × 0..10
    const state = makeState({
      svgObjects: [original, duplicate],
      sceneOrder: ['orig', 'dup'], // duplicate on top, as buildDuplicateOps appends
      selectedFigureIds: new Set(['dup']),
    });
    // (5, 5): inside both bboxes. Distance to orig stroke (y=x) = 0 → orig path hits.
    // Distance to dup stroke (y=x-3) = 3/√2 ≈ 2.12 → dup path misses.
    // Pre-fix: dup bbox fallback recorded, orig path hit wins → returns orig.
    // Post-fix: dup is selected, so its bbox claims the hit before path testing.
    expect(findSceneObjectAtCell(state, 5, 5)).toEqual({ kind: 'svg', id: 'dup' });
  });

  test('with no selection, the same tap still falls through to the original (preserves pixel-accurate behavior)', () => {
    const original = makeDiag('orig', 0, 0);
    const duplicate = makeDiag('dup', 3, 0);
    const state = makeState({
      svgObjects: [original, duplicate],
      sceneOrder: ['orig', 'dup'],
      // selectedFigureIds intentionally empty
    });
    expect(findSceneObjectAtCell(state, 5, 5)).toEqual({ kind: 'svg', id: 'orig' });
  });
});

describe('findSceneObjectAtCell — sticky selection (bbox re-grabs the selected object)', () => {
  // A selected object claims any tap/drag inside its bounding box, even when a
  // different object sits above it in z-order or has opaque pixels there. This
  // keeps a nudge-drag that starts over an overlapping neighbor from silently
  // switching the selection.
  test('selected figure behind an opaque image on top still wins inside its bbox', () => {
    const back = makeFigure('back', { cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const front = makeImage('front', { cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const base = makeState({
      figures: [back],
      images: [front],
      sceneOrder: ['back', 'front'], // image fully covers the figure, on top
    });
    // Without a selection, the top image wins.
    expect(findSceneObjectAtCell(base, 5, 5)).toEqual({ kind: 'image', id: 'front' });
    // With the figure selected, its bbox re-grabs it despite the image above.
    const selected = { ...base, selectedFigureIds: new Set(['back']) };
    expect(findSceneObjectAtCell(selected, 5, 5)).toEqual({ kind: 'figure', id: 'back' });
  });

  test('the topmost selected object wins when several selected bboxes overlap', () => {
    const lo = makeFigure('lo', { cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const hi = makeFigure('hi', { cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const state = makeState({
      figures: [lo, hi],
      sceneOrder: ['lo', 'hi'],
      selectedFigureIds: new Set(['lo', 'hi']),
    });
    expect(findSceneObjectAtCell(state, 5, 5)).toEqual({ kind: 'figure', id: 'hi' });
  });

  test('a tap outside the selected object still selects whatever is under the point', () => {
    const sel = makeFigure('sel', { cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4 });
    const other = makeImage('other', { cellX: 6, cellY: 6, cellWidth: 4, cellHeight: 4 });
    const state = makeState({
      figures: [sel],
      images: [other],
      sceneOrder: ['sel', 'other'],
      selectedFigureIds: new Set(['sel']),
    });
    // (8,8) is outside sel's bbox but inside other's — sticky selection must
    // not hijack a tap that misses the selected object entirely.
    expect(findSceneObjectAtCell(state, 8, 8)).toEqual({ kind: 'image', id: 'other' });
  });

  test('a locked selected object is not re-grabbed on a normal tap', () => {
    const back = makeImage('back', { cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10 });
    const sel = makeFigure('sel', { cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10, locked: true });
    const state = makeState({
      figures: [sel],
      images: [back],
      sceneOrder: ['back', 'sel'],
      selectedFigureIds: new Set(['sel']),
    });
    // Locked objects are inert to normal taps; sticky selection honors the
    // same lock guard, so the tap falls through to the image behind.
    expect(findSceneObjectAtCell(state, 5, 5)).toEqual({ kind: 'image', id: 'back' });
  });
});
