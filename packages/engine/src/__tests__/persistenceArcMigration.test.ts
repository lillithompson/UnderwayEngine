import { saveCompositionState, loadCompositionState } from '../persistence';
import { CompositionState, makeViewport } from '../types';

jest.mock('../bake', () => ({
  bakeFile: jest.fn(() => Promise.resolve()),
  removeBakedFigure: jest.fn(() => Promise.resolve()),
}));

const storage: Record<string, string | Uint8Array> = {};
jest.mock('@/engine/storage', () => ({
  default: {
    getItem: jest.fn((key: string) => Promise.resolve(typeof storage[key] === 'string' ? (storage[key] as string) : null)),
    setItem: jest.fn((key: string, value: string) => { storage[key] = value; return Promise.resolve(); }),
    removeItem: jest.fn((key: string) => { delete storage[key]; return Promise.resolve(); }),
    multiRemove: jest.fn((keys: string[]) => { for (const k of keys) delete storage[k]; return Promise.resolve(); }),
    getBinary: jest.fn(() => Promise.resolve(null)),
    setBinary: jest.fn(() => Promise.resolve()),
  },
  __esModule: true,
}));

beforeEach(() => {
  Object.keys(storage).forEach(k => delete storage[k]);
});

function makeState(): CompositionState {
  return {
    id: 'cmp1', name: 'Test',
    figures: [], svgObjects: [],
    lineDraft: null, arcDraft: null,
    editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
    customColors: [],
    groups: [],
    sceneOrder: [],
    gridLevel: 0, strokeScale: 8, gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(),
    activeFigureKey: null, compTool: 'select',
    createRegion: null, renderGeneration: 0,
  };
}

describe('arc segment migration on load', () => {
  it('defaults missing kind to "arc" for legacy saves', async () => {
    // Hand-craft a legacy save shape: svgObjects with kind-less segments.
    const legacy = {
      name: 'Legacy',
      figures: [],
      svgObjects: [{
        id: 'svg_old',
        segments: [
          { start: [0, 0], end: [3, 3], center: [0, 3] },
          { start: [3, 3], end: [6, 0], center: [6, 3] },
        ],
        color: { r: 0, g: 0, b: 0 },
      }],
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    };
    storage['comp_meta_cmp1'] = JSON.stringify(legacy);

    const loaded = await loadCompositionState('cmp1');
    expect(loaded).not.toBeNull();
    expect(loaded!.svgObjects).toHaveLength(1);
    expect(loaded!.svgObjects![0].segments).toHaveLength(2);
    expect(loaded!.svgObjects![0].segments[0].kind).toBe('arc');
    expect(loaded!.svgObjects![0].segments[1].kind).toBe('arc');
  });

  it('preserves kind=line on segments that already carry it', async () => {
    const state = makeState();
    state.svgObjects = [{
      id: 'svg_new',
      segments: [
        { kind: 'line', start: [0, 0], end: [1, 1] },
        { kind: 'arc',  start: [1, 1], end: [3, 3], center: [0, 3] },
      ],
      color: { r: 0, g: 0, b: 0 },
      cellX: 0, cellY: 0, cellWidth: 3, cellHeight: 3,
    }];
    await saveCompositionState(state);
    // Bypass the in-memory write-through cache to ensure we exercise the JSON
    // load path (the cache stores the serialized string).
    delete (globalThis as any).__facetCompMetaCache;
    const loaded = await loadCompositionState('cmp1');
    expect(loaded!.svgObjects![0].segments[0].kind).toBe('line');
    expect(loaded!.svgObjects![0].segments[1].kind).toBe('arc');
  });
});
