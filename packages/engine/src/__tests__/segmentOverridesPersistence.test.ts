import { saveCompositionState, loadCompositionState } from '../persistence';
import { CompositionState, makeViewport, RGBColor, SVGObject } from '../types';
import { packKey } from '../tileSegmentOverrides';

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
  delete (globalThis as any).__facetCompMetaCache;
});

const RED: RGBColor = { r: 255, g: 0, b: 0 };
const BLUE: RGBColor = { r: 0, g: 0, b: 255 };

function tiledSvg(extras: Partial<SVGObject> = {}): SVGObject {
  return {
    id: 'svg_tile',
    segments: [{ kind: 'line', start: [0, 0], end: [10, 0] }, { kind: 'line', start: [10, 0], end: [10, 10] }],
    color: { r: 255, g: 255, b: 255 },
    cellX: 0, cellY: 0, cellWidth: 40, cellHeight: 40,
    tileMode: 'repeat', tileWidthL0: 10, tileHeightL0: 10,
    ...extras,
  };
}

function makeState(svgObjects: SVGObject[]): CompositionState {
  return {
    id: 'cmp1', name: 'Test',
    figures: [], svgObjects,
    lineDraft: null, arcDraft: null,
    editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
    customColors: [], groups: [], sceneOrder: svgObjects.map(s => s.id),
    gridLevel: 0, strokeScale: 8, gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(), activeFigureKey: null, compTool: 'select',
    createRegion: null, renderGeneration: 0,
  } as CompositionState;
}

describe('segmentOverrides JSON persistence', () => {
  it('round-trips a Map through save/load as a Map (not a plain object)', async () => {
    const ov = new Map<number, RGBColor>([[packKey(0, 0, 0)!, RED], [packKey(2, 1, 1)!, BLUE]]);
    await saveCompositionState(makeState([tiledSvg({ segmentOverrides: ov })]));
    delete (globalThis as any).__facetCompMetaCache; // force the JSON load path

    const loaded = await loadCompositionState('cmp1');
    const got = loaded!.svgObjects![0].segmentOverrides;
    expect(got).toBeInstanceOf(Map);
    expect(got!.size).toBe(2);
    const values = [...got!.values()];
    expect(values).toContainEqual(RED);
    expect(values).toContainEqual(BLUE);
  });

  it('serializes the Map as a JSON entries array, never a flattened {}', async () => {
    const ov = new Map<number, RGBColor>([[packKey(1, 0, 0)!, RED]]);
    await saveCompositionState(makeState([tiledSvg({ segmentOverrides: ov })]));
    const stored = JSON.parse(storage['comp_meta_cmp1'] as string);
    expect(Array.isArray(stored.svgObjects[0].segmentOverrides)).toBe(true);
    expect(stored.svgObjects[0].segmentOverrides).toHaveLength(1);
  });

  it('omits segmentOverrides entirely when the Map is empty', async () => {
    await saveCompositionState(makeState([tiledSvg({ segmentOverrides: new Map() })]));
    const stored = JSON.parse(storage['comp_meta_cmp1'] as string);
    expect('segmentOverrides' in stored.svgObjects[0]).toBe(false);
  });

  it('loads a legacy flattened {} without crashing (data was lost) → undefined', async () => {
    // Reproduces the crash source: an older save where JSON.stringify turned
    // the Map into {}. Must come back as undefined, never a non-Map.
    const legacy = {
      name: 'Legacy', figures: [],
      svgObjects: [{ ...tiledSvg(), segmentOverrides: {} }],
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    };
    storage['comp_meta_cmp1'] = JSON.stringify(legacy);
    const loaded = await loadCompositionState('cmp1');
    expect(loaded!.svgObjects![0].segmentOverrides).toBeUndefined();
  });

  it('rebuilds a Map from a populated plain object (defensive)', async () => {
    // A plain object keyed by stringified numeric key should still rehydrate.
    const legacy = {
      name: 'Legacy', figures: [],
      svgObjects: [{ ...tiledSvg(), segmentOverrides: { [String(packKey(0, 0, 0)!)]: RED } }],
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    };
    storage['comp_meta_cmp1'] = JSON.stringify(legacy);
    const loaded = await loadCompositionState('cmp1');
    const got = loaded!.svgObjects![0].segmentOverrides;
    expect(got).toBeInstanceOf(Map);
    expect(got!.get(packKey(0, 0, 0)!)).toEqual(RED);
  });
});
