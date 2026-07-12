/**
 * Tests for the ROTATE_FIGURE reducer case in CompositionEditor,
 * verifying that rotation drift is prevented.
 *
 * We replicate the reducer logic here since compReducer lives in a .tsx file
 * that Jest cannot transform (JSX).
 */
import { CompositionState, CompositionFigure, RGBColor, COLOR_PALETTE, makeViewport } from '../types';
import { computeFrameAllCamera } from '../compositionCamera';
import { packColor } from '../figureColors';

function makeFigure(overrides: Partial<CompositionFigure> = {}): CompositionFigure {
  return {
    id: 'fig1',
    figureKey: 'file_file1_L0',
    cellX: 4,
    cellY: 4,
    resolutionX: 32,
    resolutionY: 32,
    cellWidth: 32,
    cellHeight: 32,
    rotation: 0,
    fileId: 'file1',
    placementLevel: 0,
    ...overrides,
  };
}

function makeState(figures: CompositionFigure[]): CompositionState {
  return {
    id: 'test',
    name: 'test',
    figures,
    svgObjects: [],
    lineDraft: null,
    arcDraft: null,
    editingLineId: null,
    selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
    customColors: [],
    groups: [],
    sceneOrder: figures.map((f) => f.id),
    gridLevel: 0,
    strokeScale: 8, gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(),
    activeFigureKey: null,
    compTool: 'select',
    createRegion: null,
    renderGeneration: 0,
  };
}

/**
 * Replica of the ROTATE_FIGURE reducer case from CompositionEditor.
 * Must be kept in sync with the actual reducer.
 */
function applyRotateFigure(state: CompositionState, figureId: string): CompositionState {
  const figures = state.figures.map((f) => {
    if (f.id !== figureId) return f;
    const cur = f.rotation ?? 0;
    const next = ((cur + 90) % 360) as 0 | 90 | 180 | 270;
    const identityW = (cur === 90 || cur === 270) ? f.cellHeight : f.cellWidth;
    const identityH = (cur === 90 || cur === 270) ? f.cellWidth : f.cellHeight;
    const cx = f.cellX + f.cellWidth / 2;
    const cy = f.cellY + f.cellHeight / 2;
    const identityX = f.identityCellX ?? Math.round(cx - identityW / 2);
    const identityY = f.identityCellY ?? Math.round(cy - identityH / 2);
    const newW = f.cellHeight;
    const newH = f.cellWidth;
    const idCx = identityX + identityW / 2;
    const idCy = identityY + identityH / 2;
    const newCellX = Math.round(idCx - newW / 2);
    const newCellY = Math.round(idCy - newH / 2);
    const quads = f.quads?.map(q => ({
      offsetX: f.cellHeight - q.offsetY - q.cellHeight,
      offsetY: q.offsetX,
      cellWidth: q.cellHeight,
      cellHeight: q.cellWidth,
    }));
    return {
      ...f,
      rotation: next,
      cellWidth: newW,
      cellHeight: newH,
      cellX: newCellX,
      cellY: newCellY,
      quads,
      identityCellX: identityX,
      identityCellY: identityY,
    };
  });
  return { ...state, figures, renderGeneration: state.renderGeneration + 1 };
}

// Replica of the SET_VIEWPORT reducer case from CompositionEditor. Keep in sync.
function applySetViewport(state: CompositionState, width: number, height: number): CompositionState {
  if (state.viewport.width === width && state.viewport.height === height) return state;
  const isFirstLayout = state.viewport.width === 0 || state.viewport.height === 0;
  const viewport = { ...state.viewport, width, height };
  if (isFirstLayout && width > 0 && height > 0) {
    const cam = computeFrameAllCamera(state.figures, width, height);
    if (cam) {
      return { ...state, viewport, camera: cam, renderGeneration: state.renderGeneration + 1 };
    }
  }
  return { ...state, viewport };
}

describe('ROTATE_FIGURE drift prevention', () => {
  it('returns to original position after 4 rotations (odd dimensions)', () => {
    const fig = makeFigure({ cellX: 5, cellY: 10, cellWidth: 3, cellHeight: 4, rotation: 0 });
    const state = makeState([fig]);

    let s = state;
    for (let i = 0; i < 4; i++) {
      s = applyRotateFigure(s, 'fig1');
    }
    const result = s.figures[0];
    expect(result.cellX).toBe(5);
    expect(result.cellY).toBe(10);
    expect(result.cellWidth).toBe(3);
    expect(result.cellHeight).toBe(4);
    expect(result.rotation).toBe(0);
  });

  it('returns to original position after 8 rotations (two full turns)', () => {
    const fig = makeFigure({ cellX: 7, cellY: 3, cellWidth: 5, cellHeight: 2, rotation: 0 });
    const state = makeState([fig]);

    let s = state;
    for (let i = 0; i < 8; i++) {
      s = applyRotateFigure(s, 'fig1');
    }
    const result = s.figures[0];
    expect(result.cellX).toBe(7);
    expect(result.cellY).toBe(3);
    expect(result.cellWidth).toBe(5);
    expect(result.cellHeight).toBe(2);
  });

  it('does not drift with even dimensions either', () => {
    const fig = makeFigure({ cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 6, rotation: 0 });
    const state = makeState([fig]);

    let s = state;
    for (let i = 0; i < 4; i++) {
      s = applyRotateFigure(s, 'fig1');
    }
    const result = s.figures[0];
    expect(result.cellX).toBe(0);
    expect(result.cellY).toBe(0);
    expect(result.cellWidth).toBe(4);
    expect(result.cellHeight).toBe(6);
  });
});

describe('SET_VIEWPORT — auto-frame on first layout', () => {
  function makeStateWithViewport(
    figures: CompositionFigure[],
    vw: number,
    vh: number,
    camera = { offsetX: 0, offsetY: 0, zoom: 0.3 },
  ): CompositionState {
    return {
      id: 'test',
      name: 'test',
      figures,
      svgObjects: [],
      lineDraft: null,
      arcDraft: null,
      editingLineId: null,
      selectedVertexIndex: null,
      lastChosenColor: { r: 255, g: 255, b: 255 },
      customColors: [],
      groups: [],
      sceneOrder: figures.map((f) => f.id),
      gridLevel: 0,
      strokeScale: 8, gridIntensity: 0.5,
      camera,
      viewport: makeViewport(vw, vh),
      selectedFigureIds: new Set(),
      activeFigureKey: null,
      compTool: 'select',
      createRegion: null,
      renderGeneration: 0,
    };
  }

  it('frames all figures on the first layout when viewport transitions from 0 to positive', () => {
    const fig = makeFigure({ cellX: 10, cellY: 12, cellWidth: 8, cellHeight: 8 });
    const state = makeStateWithViewport([fig], 0, 0);
    const expected = computeFrameAllCamera([fig], 800, 600);
    expect(expected).not.toBeNull();

    const next = applySetViewport(state, 800, 600);

    expect(next.camera).toEqual(expected);
    expect(next.viewport.width).toBe(800);
    expect(next.viewport.height).toBe(600);
  });

  it('preserves the existing camera on subsequent viewport changes', () => {
    const fig = makeFigure({ cellX: 10, cellY: 12, cellWidth: 8, cellHeight: 8 });
    const userCamera = { offsetX: 123, offsetY: 45, zoom: 2.5 };
    const state = makeStateWithViewport([fig], 800, 600, userCamera);

    const next = applySetViewport(state, 1024, 768);

    expect(next.camera).toEqual(userCamera);
    expect(next.viewport.width).toBe(1024);
    expect(next.viewport.height).toBe(768);
  });

  it('leaves camera unchanged on first layout when there are no figures', () => {
    const defaultCamera = { offsetX: 0, offsetY: 0, zoom: 0.3 };
    const state = makeStateWithViewport([], 0, 0, defaultCamera);

    const next = applySetViewport(state, 800, 600);

    expect(next.camera).toEqual(defaultCamera);
    expect(next.viewport.width).toBe(800);
    expect(next.viewport.height).toBe(600);
  });
});

// Replicas of the ADD_CUSTOM_COLOR / REMOVE_CUSTOM_COLOR reducer cases
// from CompositionEditor. Keep in sync with the actual reducer.
function applyAddCustomColor(state: CompositionState, color: RGBColor): CompositionState {
  const key = packColor(color.r, color.g, color.b);
  for (const [dr, dg, db] of COLOR_PALETTE) {
    if (packColor(dr, dg, db) === key) return state;
  }
  const existingIdx = state.customColors.findIndex(
    c => packColor(c.r, c.g, c.b) === key,
  );
  if (existingIdx === -1) {
    return {
      ...state,
      customColors: [...state.customColors, color],
      renderGeneration: state.renderGeneration + 1,
    };
  }
  if (existingIdx === state.customColors.length - 1) return state;
  const next = [...state.customColors];
  next.splice(existingIdx, 1);
  next.push(color);
  return {
    ...state,
    customColors: next,
    renderGeneration: state.renderGeneration + 1,
  };
}

function applyRemoveCustomColor(state: CompositionState, color: RGBColor): CompositionState {
  const key = packColor(color.r, color.g, color.b);
  const next = state.customColors.filter(c => packColor(c.r, c.g, c.b) !== key);
  if (next.length === state.customColors.length) return state;
  return { ...state, customColors: next, renderGeneration: state.renderGeneration + 1 };
}

describe('ADD_CUSTOM_COLOR', () => {
  it('appends a new color to customColors', () => {
    const s = makeState([]);
    const next = applyAddCustomColor(s, { r: 51, g: 68, b: 255 });
    expect(next.customColors).toEqual([{ r: 51, g: 68, b: 255 }]);
  });

  it('preserves insertion order across multiple adds', () => {
    let s = makeState([]);
    s = applyAddCustomColor(s, { r: 1, g: 2, b: 3 });
    s = applyAddCustomColor(s, { r: 4, g: 5, b: 6 });
    s = applyAddCustomColor(s, { r: 7, g: 8, b: 9 });
    expect(s.customColors).toEqual([
      { r: 1, g: 2, b: 3 },
      { r: 4, g: 5, b: 6 },
      { r: 7, g: 8, b: 9 },
    ]);
  });

  it('is a no-op when re-adding a color already at the end', () => {
    let s = makeState([]);
    s = applyAddCustomColor(s, { r: 51, g: 68, b: 255 });
    const before = s;
    s = applyAddCustomColor(s, { r: 51, g: 68, b: 255 });
    expect(s).toBe(before);
    expect(s.customColors).toHaveLength(1);
  });

  it('moves an existing color to the end when re-added', () => {
    let s = makeState([]);
    s = applyAddCustomColor(s, { r: 1, g: 2, b: 3 });
    s = applyAddCustomColor(s, { r: 4, g: 5, b: 6 });
    s = applyAddCustomColor(s, { r: 7, g: 8, b: 9 });
    s = applyAddCustomColor(s, { r: 1, g: 2, b: 3 });
    expect(s.customColors).toEqual([
      { r: 4, g: 5, b: 6 },
      { r: 7, g: 8, b: 9 },
      { r: 1, g: 2, b: 3 },
    ]);
  });

  it('rejects every entry in the default COLOR_PALETTE (including white)', () => {
    const s = makeState([]);
    for (const [r, g, b] of COLOR_PALETTE) {
      const next = applyAddCustomColor(s, { r, g, b });
      expect(next).toBe(s);
      expect(next.customColors).toEqual([]);
    }
  });
});

describe('REMOVE_CUSTOM_COLOR', () => {
  it('removes the matching color by exact RGB', () => {
    let s = makeState([]);
    s = applyAddCustomColor(s, { r: 51, g: 68, b: 255 });
    s = applyAddCustomColor(s, { r: 4, g: 5, b: 6 });
    s = applyRemoveCustomColor(s, { r: 51, g: 68, b: 255 });
    expect(s.customColors).toEqual([{ r: 4, g: 5, b: 6 }]);
  });

  it('is a no-op when the color is absent', () => {
    let s = makeState([]);
    s = applyAddCustomColor(s, { r: 4, g: 5, b: 6 });
    const before = s;
    s = applyRemoveCustomColor(s, { r: 1, g: 2, b: 3 });
    expect(s).toBe(before);
  });
});
