// Reproduction test for the "thumbnails no longer show for new files" report.
// Simulates: user creates a comp, saves a state with one SVG line, then a
// thumbnail-style export via loadCompositionState → SVG.

const storage: Record<string, string | Uint8Array> = {};

jest.mock('@/engine/storage', () => ({
  default: {
    getItem: jest.fn((key: string) => Promise.resolve(typeof storage[key] === 'string' ? storage[key] as string : null)),
    setItem: jest.fn((key: string, value: string) => { storage[key] = value; return Promise.resolve(); }),
    removeItem: jest.fn((key: string) => { delete storage[key]; return Promise.resolve(); }),
    multiRemove: jest.fn((keys: string[]) => { for (const k of keys) delete storage[k]; return Promise.resolve(); }),
    multiGet: jest.fn((keys: string[]) => Promise.resolve(keys.map(k => [k, typeof storage[k] === 'string' ? storage[k] as string : null] as [string, string | null]))),
    getBinary: jest.fn((key: string) => Promise.resolve(storage[key] instanceof Uint8Array ? storage[key] as Uint8Array : null)),
    setBinary: jest.fn((key: string, value: Uint8Array) => { storage[key] = value; return Promise.resolve(); }),
  },
  __esModule: true,
}));

jest.mock('@/native-shell/bridge/webBridge', () => ({
  logToNative: jest.fn(),
}));

import { loadCompositionState, saveCompositionState } from '../persistence';
import { exportCompositionSVG } from '../compositionExport';
import { makeViewport } from '../types';
import type { CompositionState } from '../types';

function freshState(over: Partial<CompositionState> = {}): CompositionState {
  return {
    id: 'comp1',
    name: 'New Comp',
    figures: [],
    svgObjects: [],
    images: [],
    imageBlobs: {},
    groups: [],
    sceneOrder: [],
    customColors: [],
    gridLevel: 2,
    strokeScale: 0.04,
    gridIntensity: 0.3,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set<string>(),
    activeFigureKey: null,
    compTool: 'select',
    createRegion: null,
    renderGeneration: 0,
    lineDraft: null,
    arcDraft: null,
    paintStrokeDraft: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
    ...over,
  } as CompositionState;
}

beforeEach(() => {
  for (const k of Object.keys(storage)) delete storage[k];
});

describe('save → load → SVG export roundtrip', () => {
  test('one fresh SVG line produces a non-null SVG after save+load', async () => {
    const state = freshState({
      svgObjects: [{
        id: 'svg-1',
        segments: [{ kind: 'line', start: [4, 4], end: [12, 12] }],
        color: { r: 100, g: 100, b: 100 },
        cellX: 4, cellY: 4, cellWidth: 8, cellHeight: 8,
      }],
      sceneOrder: ['svg-1'],
    });

    await saveCompositionState(state);
    const svg = await exportCompositionSVG('comp1');
    expect(svg).not.toBeNull();
    expect(svg).toContain('<path');
  });

  test('one SVG line at the bbox of (0,0)→(4,0)→(4,4) produces non-null SVG', async () => {
    const state = freshState({
      svgObjects: [{
        id: 'svg-a',
        segments: [
          { kind: 'line', start: [0, 0], end: [4, 0] },
          { kind: 'line', start: [4, 0], end: [4, 4] },
        ],
        color: { r: 200, g: 100, b: 50 },
        cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
      }],
      sceneOrder: ['svg-a'],
    });

    await saveCompositionState(state);
    const svg = await exportCompositionSVG('comp1');
    expect(svg).not.toBeNull();
    expect(svg).toContain('<path');
  });

  test('a Create-tool figure with fileId+placementLevel saves and loads', async () => {
    const state = freshState({
      figures: [{
        id: 'fig-1',
        figureKey: 'file_xyz_L0',
        fileId: 'xyz',
        placementLevel: 0,
        resolutionX: 2,
        resolutionY: 2,
        cellX: 4,
        cellY: 4,
        cellWidth: 4,
        cellHeight: 4,
      }],
      sceneOrder: ['fig-1'],
    });

    await saveCompositionState(state);
    const json = storage['comp_meta_comp1'] as string;
    expect(json).toBeDefined();
    const meta = JSON.parse(json);
    // After normalize: bbox 4×4 → scale 8 → 32×32 centered at origin.
    expect(meta.figures[0].cellX).toBe(0);
    expect(meta.figures[0].cellY).toBe(0);
    expect(meta.figures[0].cellWidth).toBe(32);
    expect(meta.figures[0].cellHeight).toBe(32);
    // fileId / placementLevel / figureKey unchanged
    expect(meta.figures[0].fileId).toBe('xyz');
    expect(meta.figures[0].placementLevel).toBe(0);
    expect(meta.figures[0].figureKey).toBe('file_xyz_L0');
  });

  test('two consecutive saves are idempotent — the second normalize is a no-op', async () => {
    const state = freshState({
      svgObjects: [{
        id: 'svg-1',
        segments: [{ kind: 'line', start: [4, 4], end: [12, 12] }],
        color: { r: 100, g: 100, b: 100 },
        cellX: 4, cellY: 4, cellWidth: 8, cellHeight: 8,
      }],
      sceneOrder: ['svg-1'],
    });

    await saveCompositionState(state);
    const firstJson = storage['comp_meta_comp1'] as string;

    await saveCompositionState(state);
    const secondJson = storage['comp_meta_comp1'] as string;

    // Both calls write the same normalized payload (state is unchanged
    // between saves).
    expect(secondJson).toBe(firstJson);
  });
});

// A page-anchored caller (a journal page, where cell coordinates are
// positions on a fixed page) opts out of canonical-box normalization on BOTH
// sides of the round trip — otherwise small content is power-of-2 upscaled
// and re-anchored, i.e. moved relative to the page it was placed on.
describe('{ normalize: false }', () => {
  const smallState = () => freshState({
    svgObjects: [{
      id: 'svg-1',
      segments: [{ kind: 'line', start: [4, 4], end: [12, 12] }],
      color: { r: 100, g: 100, b: 100 },
      cellX: 4, cellY: 4, cellWidth: 8, cellHeight: 8,
    }],
    sceneOrder: ['svg-1'],
  });

  test('save stores small content at its own coordinates, unscaled', async () => {
    await saveCompositionState(smallState(), { normalize: false });
    const meta = JSON.parse(storage['comp_meta_comp1'] as string);
    expect(meta.svgObjects[0]).toMatchObject({ cellX: 4, cellY: 4, cellWidth: 8, cellHeight: 8 });
    expect(meta.svgObjects[0].segments).toEqual([{ kind: 'line', start: [4, 4], end: [12, 12] }]);
    // gridLevel / strokeScale are only bumped to compensate a rescale.
    expect(meta.gridLevel).toBe(2);
    expect(meta.strokeScale).toBe(0.04);
    // No rescale ⇒ the caller's working camera is kept, not a placeholder.
    expect(meta.camera).toEqual({ offsetX: 0, offsetY: 0, zoom: 1 });
  });

  test('load returns those coordinates untouched', async () => {
    await saveCompositionState(smallState(), { normalize: false });
    const loaded = await loadCompositionState('comp1', { normalize: false });
    expect(loaded!.svgObjects![0]).toMatchObject({ cellX: 4, cellY: 4, cellWidth: 8, cellHeight: 8 });
    expect(loaded!.gridLevel).toBe(2);
  });

  test('the default still normalizes — 8× upscale of the same content', async () => {
    await saveCompositionState(smallState());
    const meta = JSON.parse(storage['comp_meta_comp1'] as string);
    expect(meta.svgObjects[0]).toMatchObject({ cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32 });
  });

  test('load can still normalize a record saved without normalization', async () => {
    await saveCompositionState(smallState(), { normalize: false });
    const loaded = await loadCompositionState('comp1');
    expect(loaded!.svgObjects![0]).toMatchObject({ cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32 });
  });
});
