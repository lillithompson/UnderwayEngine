import { serializeComposition, EmbeddedFile } from '../compositionBinaryFormat';
import { serializeFile } from '../binaryFormat';
import { compressTile } from '../tileIO';
import { applyCompOps, revertCompOps, materializeGroupMembers, reconcileGroupLocals } from '../compositionOps';
import { CompositionFigure, SVGObject, ImageObject, GroupNode, CompositionState, makeViewport, CompUndoEntry } from '../types';

// ── Storage mock ───────────────────────────────────────────────────

const storage: Record<string, string | Uint8Array> = {};

jest.mock('@/engine/storage', () => ({
  default: {
    getItem: jest.fn((key: string) => {
      const v = storage[key];
      return Promise.resolve(typeof v === 'string' ? v : null);
    }),
    setItem: jest.fn((key: string, value: string) => {
      storage[key] = value;
      return Promise.resolve();
    }),
    removeItem: jest.fn((key: string) => {
      delete storage[key];
      return Promise.resolve();
    }),
    multiGet: jest.fn((keys: string[]) =>
      Promise.resolve(keys.map(k => [k, typeof storage[k] === 'string' ? storage[k] : null] as [string, string | null])),
    ),
    getBinary: jest.fn((key: string) => {
      const v = storage[key];
      return Promise.resolve(v instanceof Uint8Array ? v : null);
    }),
    setBinary: jest.fn((key: string, value: Uint8Array) => {
      storage[key] = value;
      return Promise.resolve();
    }),
  },
  __esModule: true,
}));

jest.mock('@/native-shell/bridge/webBridge', () => ({
  logToNative: jest.fn(),
}));

const bakeFileMock: jest.Mock<Promise<void>, unknown[]> = jest.fn(
  () => Promise.resolve(),
);
jest.mock('../bake', () => ({
  bakeFile: (...args: unknown[]) => bakeFileMock(...args),
}));

jest.mock('../cells', () => {
  const actual = jest.requireActual('../cells');
  return {
    ...actual,
    rebuildPixelData: jest.fn(),
  };
});

// Import after mocks
import { prepareTileMerge } from '../compositionMerge';

// ── Helpers ────────────────────────────────────────────────────────

function makeFigure(overrides: Partial<CompositionFigure> & { id: string; figureKey: string }): CompositionFigure {
  return {
    cellX: 0, cellY: 0,
    resolutionX: 2, resolutionY: 2,
    cellWidth: 4, cellHeight: 4,
    ...overrides,
  };
}

function makeSVG(id: string): SVGObject {
  return {
    id,
    segments: [{ kind: 'line' as const, start: [0, 0] as [number, number], end: [10, 10] as [number, number] }],
    color: { r: 255, g: 0, b: 0 },
    cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10,
  };
}

function makeImage(id: string, imageId: string): ImageObject {
  return {
    id,
    imageId,
    mimeType: 'image/png',
    cellX: 0, cellY: 0,
    cellWidth: 8, cellHeight: 8,
    pixelWidth: 256, pixelHeight: 256,
  };
}

function makeGroup(id: string, name: string): GroupNode {
  return {
    id, name,
    translateX: 0, translateY: 0,
    scaleX: 1, scaleY: 1,
    rotation: 0, mirrorH: false, mirrorV: false,
  };
}

function makeFileBytes(fileId: string): Uint8Array {
  const layers = [{
    id: `${fileId}_l0`,
    name: 'Layer 0',
    level: 2 as const,
    visible: true,
    opacity: 1,
    order: 0,
    cells: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => null)),
  }];
  return serializeFile(layers as any, layers[0].id, 32, 32, fileId);
}

function makeState(overrides: Partial<CompositionState> = {}): CompositionState {
  return {
    id: 'existing',
    name: 'Existing Comp',
    figures: [],
    svgObjects: [],
    lineDraft: null,
    arcDraft: null,
    editingLineId: null,
    selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
    customColors: [],
    groups: [],
    sceneOrder: [],
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

async function buildTileBytes(opts: {
  figures?: CompositionFigure[];
  svgObjects?: SVGObject[];
  images?: ImageObject[];
  imageBlobs?: Record<string, Uint8Array>;
  groups?: GroupNode[];
  embeddedFiles?: EmbeddedFile[];
}): Promise<Uint8Array> {
  const bundle = {
    name: 'Source',
    gridLevel: 1 as const,
    strokeScale: 8,
    gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    figures: opts.figures ?? [],
    svgObjects: opts.svgObjects ?? [],
    images: opts.images ?? [],
    imageBlobs: opts.imageBlobs ?? {},
    groups: opts.groups ?? [],
  };
  const payload = serializeComposition(bundle, opts.embeddedFiles ?? []);
  return compressTile(payload);
}

beforeEach(() => {
  for (const key of Object.keys(storage)) delete storage[key];
  bakeFileMock.mockClear();
});

// ── Tests ──────────────────────────────────────────────────────────

describe('prepareTileMerge', () => {
  test('remaps figure IDs so they do not collide', async () => {
    const tile = await buildTileBytes({
      figures: [makeFigure({ id: 'fig1', figureKey: 'test_key' })],
    });
    const result = await prepareTileMerge(tile, 'Test.tile');
    expect(result.figures).toHaveLength(1);
    expect(result.figures[0].id).not.toBe('fig1');
  });

  test('remaps fileId and figureKey for embedded files', async () => {
    const fileBytes = makeFileBytes('oldfile');
    const tile = await buildTileBytes({
      figures: [makeFigure({ id: 'fig1', figureKey: 'file_oldfile_L0', fileId: 'oldfile' })],
      embeddedFiles: [{ id: 'oldfile', name: 'Test', widthL0: 32, heightL0: 32, data: fileBytes }],
    });
    const result = await prepareTileMerge(tile, 'Test.tile');
    expect(result.figures[0].fileId).not.toBe('oldfile');
    expect(result.figures[0].figureKey).not.toContain('oldfile');
    expect(result.importedFileIds).toHaveLength(1);
    expect(result.importedFileIds[0]).toBe(result.figures[0].fileId);
  });

  test('bakes embedded files', async () => {
    const fileBytes = makeFileBytes('f0');
    const tile = await buildTileBytes({
      figures: [makeFigure({ id: 'fig1', figureKey: 'file_f0_L0', fileId: 'f0' })],
      embeddedFiles: [{ id: 'f0', name: 'File', widthL0: 32, heightL0: 32, data: fileBytes }],
    });
    await prepareTileMerge(tile, 'File.tile');
    expect(bakeFileMock).toHaveBeenCalledTimes(1);
  });

  test('remaps SVG IDs', async () => {
    const tile = await buildTileBytes({
      svgObjects: [makeSVG('svg_old1'), makeSVG('svg_old2')],
    });
    const result = await prepareTileMerge(tile, 'Test.tile');
    expect(result.svgObjects).toHaveLength(2);
    expect(result.svgObjects[0].id).not.toBe('svg_old1');
    expect(result.svgObjects[1].id).not.toBe('svg_old2');
    expect(result.svgObjects[0].id).toContain('svg_');
  });

  test('remaps image IDs and imageId blob keys', async () => {
    const blobData = new Uint8Array([1, 2, 3]);
    const tile = await buildTileBytes({
      images: [makeImage('img_old1', 'blob_a')],
      imageBlobs: { blob_a: blobData },
    });
    const result = await prepareTileMerge(tile, 'Test.tile');
    expect(result.images).toHaveLength(1);
    expect(result.images[0].id).not.toBe('img_old1');
    expect(result.images[0].imageId).not.toBe('blob_a');
    // Blob must exist under the new key
    const newBlobKey = result.images[0].imageId;
    expect(result.imageBlobs[newBlobKey]).toBeDefined();
    expect(result.imageBlobs[newBlobKey].length).toBe(3);
  });

  test('deduplicates imageId across shared blobs', async () => {
    const blobData = new Uint8Array([1, 2, 3]);
    const tile = await buildTileBytes({
      images: [
        makeImage('img_a', 'shared_blob'),
        makeImage('img_b', 'shared_blob'),
      ],
      imageBlobs: { shared_blob: blobData },
    });
    const result = await prepareTileMerge(tile, 'Test.tile');
    expect(result.images).toHaveLength(2);
    // Both images should share the same new imageId
    expect(result.images[0].imageId).toBe(result.images[1].imageId);
    // Only one blob entry
    expect(Object.keys(result.imageBlobs)).toHaveLength(1);
  });

  test('remaps group IDs and groupId references', async () => {
    const group = makeGroup('g1', 'Group 1');
    const fig = makeFigure({ id: 'fig1', figureKey: 'test', groupId: 'g1' });
    const svg = { ...makeSVG('svg_1'), groupId: 'g1' };
    const tile = await buildTileBytes({
      figures: [fig],
      svgObjects: [svg],
      groups: [group],
    });
    const result = await prepareTileMerge(tile, 'Test.tile');
    // groups[0] is the wrapper, groups[1] is the remapped original
    expect(result.groups).toHaveLength(2);
    const wrapper = result.groups[0];
    const inner = result.groups[1];
    expect(inner.id).not.toBe('g1');
    expect(inner.parentGroupId).toBe(wrapper.id);
    // Items still reference their original (remapped) group, not the wrapper
    expect(result.figures[0].groupId).toBe(inner.id);
    expect(result.svgObjects[0].groupId).toBe(inner.id);
  });

  test('remaps parentGroupId for nested groups', async () => {
    const parent = makeGroup('gp', 'Parent');
    const child = { ...makeGroup('gc', 'Child'), parentGroupId: 'gp' };
    // A leaf in the child keeps the parent/child chain alive across the
    // serialize → deserialize round-trip (orphan groups are pruned).
    const leaf = makeFigure({ id: 'leaf', figureKey: 'k', groupId: 'gc' });
    const tile = await buildTileBytes({ figures: [leaf], groups: [parent, child] });
    const result = await prepareTileMerge(tile, 'Test.tile');
    // 3 groups: wrapper + parent + child
    expect(result.groups).toHaveLength(3);
    const wrapper = result.groups.find(g => g.name === 'Test')!;
    const newParent = result.groups.find(g => g.name === 'Parent')!;
    const newChild = result.groups.find(g => g.name === 'Child')!;
    // Parent is a root group, so it nests under wrapper
    expect(newParent.parentGroupId).toBe(wrapper.id);
    // Child still nests under parent
    expect(newChild.parentGroupId).toBe(newParent.id);
  });

  test('scene order contains all new IDs', async () => {
    const tile = await buildTileBytes({
      figures: [makeFigure({ id: 'fig1', figureKey: 'k' })],
      svgObjects: [makeSVG('svg_1')],
    });
    const result = await prepareTileMerge(tile, 'Test.tile');
    expect(result.sceneOrder).toHaveLength(2);
    expect(result.sceneOrder).toContain(result.figures[0].id);
    expect(result.sceneOrder).toContain(result.svgObjects[0].id);
  });

  test('empty bundle returns empty result', async () => {
    const tile = await buildTileBytes({});
    const result = await prepareTileMerge(tile, 'Empty.tile');
    expect(result.figures).toHaveLength(0);
    expect(result.svgObjects).toHaveLength(0);
    expect(result.images).toHaveLength(0);
    expect(result.groups).toHaveLength(0);
    expect(result.sceneOrder).toHaveLength(0);
    expect(result.importedFileIds).toHaveLength(0);
  });

  test('wraps ungrouped items in a named wrapper group', async () => {
    const tile = await buildTileBytes({
      figures: [makeFigure({ id: 'fig1', figureKey: 'k', cellX: 5, cellY: 10, cellWidth: 4, cellHeight: 4 })],
      svgObjects: [makeSVG('svg_1')],
      images: [makeImage('img_1', 'blob_a')],
      imageBlobs: { blob_a: new Uint8Array([1]) },
    });
    const result = await prepareTileMerge(tile, 'MyDesign.tile');

    // Should have exactly 1 wrapper group
    expect(result.groups).toHaveLength(1);
    const wrapper = result.groups[0];
    expect(wrapper.name).toBe('MyDesign');
    expect(wrapper.translateX).toBe(0);
    expect(wrapper.translateY).toBe(0);
    expect(wrapper.scaleX).toBe(1);
    expect(wrapper.scaleY).toBe(1);
    expect(wrapper.rotation).toBe(0);
    expect(wrapper.mirrorH).toBe(false);
    expect(wrapper.mirrorV).toBe(false);

    // All items reference the wrapper
    expect(result.figures[0].groupId).toBe(wrapper.id);
    expect(result.svgObjects[0].groupId).toBe(wrapper.id);
    expect(result.images[0].groupId).toBe(wrapper.id);
  });

  test('ungrouped figures get correct local coords', async () => {
    const tile = await buildTileBytes({
      figures: [makeFigure({ id: 'fig1', figureKey: 'k', cellX: 5, cellY: 10, cellWidth: 8, cellHeight: 6 })],
    });
    const result = await prepareTileMerge(tile, 'Test.tile');
    const fig = result.figures[0];
    expect(fig.localCellX).toBe(fig.cellX);
    expect(fig.localCellY).toBe(fig.cellY);
    expect(fig.localCellWidth).toBe(fig.cellWidth);
    expect(fig.localCellHeight).toBe(fig.cellHeight);
    expect(fig.localRotation).toBe(0);
    expect(fig.localMirrorH).toBe(false);
    expect(fig.localMirrorV).toBe(false);
  });

  test('ungrouped SVGs get deep-cloned localSegments', async () => {
    const tile = await buildTileBytes({
      svgObjects: [makeSVG('svg_1')],
    });
    const result = await prepareTileMerge(tile, 'Test.tile');
    const svg = result.svgObjects[0];
    expect(svg.localSegments).toBeDefined();
    expect(svg.localSegments).toHaveLength(svg.segments.length);
    // Must be a distinct array, not the same reference
    expect(svg.localSegments).not.toBe(svg.segments);
    expect(svg.localCellX).toBe(svg.cellX);
    expect(svg.localCellY).toBe(svg.cellY);
  });

  test('already-grouped items keep their original groupId', async () => {
    const group = makeGroup('g1', 'Inner');
    const fig = makeFigure({ id: 'fig1', figureKey: 'k', groupId: 'g1' });
    const tile = await buildTileBytes({
      figures: [fig],
      groups: [group],
    });
    const result = await prepareTileMerge(tile, 'Test.tile');
    const wrapper = result.groups[0];
    const inner = result.groups[1];
    // Figure stays in the inner group
    expect(result.figures[0].groupId).toBe(inner.id);
    expect(result.figures[0].groupId).not.toBe(wrapper.id);
    // Inner group nests under wrapper
    expect(inner.parentGroupId).toBe(wrapper.id);
  });

  test('unlocks all imported items', async () => {
    const fig = makeFigure({ id: 'fig1', figureKey: 'k' });
    (fig as any).locked = true;
    const svg = makeSVG('svg_1');
    (svg as any).locked = true;
    const img = makeImage('img_1', 'blob_a');
    (img as any).locked = true;
    const tile = await buildTileBytes({
      figures: [fig],
      svgObjects: [svg],
      images: [img],
      imageBlobs: { blob_a: new Uint8Array([1]) },
    });
    const result = await prepareTileMerge(tile, 'Test.tile');
    expect(result.figures[0].locked).toBeFalsy();
    expect(result.svgObjects[0].locked).toBeFalsy();
    expect(result.images[0].locked).toBeFalsy();
  });

  test('Starry.tile import wraps all sub-groups under wrapper with valid local coords', async () => {
    const fs = require('fs');
    const path = require('path');
    const data = new Uint8Array(fs.readFileSync(path.join(__dirname, '../../test_data/Starry.tile')));
    const result = await prepareTileMerge(data, 'Starry.tile');

    // Wrapper group named "Starry"
    const wrapper = result.groups.find(g => !g.parentGroupId);
    expect(wrapper).toBeDefined();
    expect(wrapper!.name).toBe('Starry');

    // All other groups nested under wrapper
    const childGroups = result.groups.filter(g => g.parentGroupId === wrapper!.id);
    expect(childGroups.length).toBeGreaterThan(0);
    expect(result.groups.length).toBe(childGroups.length + 1);

    // All SVGs have localSegments (needed for resize/materialize)
    for (const svg of result.svgObjects) {
      expect(svg.localSegments).toBeDefined();
      expect(svg.localSegments!.length).toBeGreaterThan(0);
    }

    // Every SVG belongs to either the wrapper or a child group
    const childGroupIds = new Set(childGroups.map(g => g.id));
    for (const svg of result.svgObjects) {
      expect(svg.groupId).toBeDefined();
      expect(svg.groupId === wrapper!.id || childGroupIds.has(svg.groupId!)).toBe(true);
    }
  });

  test('wrapper group name strips extension and cleans separators', async () => {
    const tile = await buildTileBytes({
      figures: [makeFigure({ id: 'fig1', figureKey: 'k' })],
    });
    const result = await prepareTileMerge(tile, 'my_cool-design.tile');
    const wrapper = result.groups[0];
    expect(wrapper.name).toBe('my cool design');
  });
});

describe('mergeTile undo/redo', () => {
  test('apply adds all items, revert removes them', async () => {
    // Bind the source group to a member so it round-trips (empty groups
    // get pruned on serialize/deserialize).
    const tile = await buildTileBytes({
      figures: [makeFigure({ id: 'fig1', figureKey: 'k', groupId: 'g1' })],
      svgObjects: [makeSVG('svg_1')],
      groups: [makeGroup('g1', 'Group')],
    });
    const merged = await prepareTileMerge(tile, 'Test.tile');

    const state = makeState();
    const oldSceneOrder = [...state.sceneOrder];

    const entry: CompUndoEntry = [{
      op: 'mergeTile',
      addedFigures: merged.figures,
      addedSVGs: merged.svgObjects,
      addedImages: merged.images,
      addedGroups: merged.groups,
      addedSceneOrder: merged.sceneOrder,
      oldSceneOrder,
    }];

    // Apply (redo) — 2 groups: wrapper + original
    const applied = applyCompOps(state, entry);
    expect(applied.figures).toHaveLength(1);
    expect(applied.svgObjects).toHaveLength(1);
    expect(applied.groups).toHaveLength(2);
    expect(applied.sceneOrder).toHaveLength(2);

    // Revert (undo) — all removed including wrapper
    const reverted = revertCompOps(applied, entry);
    expect(reverted.figures).toHaveLength(0);
    expect(reverted.svgObjects).toHaveLength(0);
    expect(reverted.groups).toHaveLength(0);
    expect(reverted.sceneOrder).toHaveLength(0);
  });

  test('revert restores original scene order exactly', async () => {
    const existingFig = makeFigure({ id: 'existing_fig', figureKey: 'ek' });
    const state = makeState({
      figures: [existingFig],
      sceneOrder: ['existing_fig'],
    });

    const tile = await buildTileBytes({
      figures: [makeFigure({ id: 'new_fig', figureKey: 'nk' })],
    });
    const merged = await prepareTileMerge(tile, 'Test.tile');

    const entry: CompUndoEntry = [{
      op: 'mergeTile',
      addedFigures: merged.figures,
      addedSVGs: [],
      addedImages: [],
      addedGroups: merged.groups,
      addedSceneOrder: merged.sceneOrder,
      oldSceneOrder: ['existing_fig'],
    }];

    const applied = applyCompOps(state, entry);
    expect(applied.figures).toHaveLength(2);
    expect(applied.sceneOrder).toHaveLength(2);

    const reverted = revertCompOps(applied, entry);
    expect(reverted.figures).toHaveLength(1);
    expect(reverted.figures[0].id).toBe('existing_fig');
    expect(reverted.sceneOrder).toEqual(['existing_fig']);
  });
});

describe('prepareTileMerge backfills missing local fields', () => {
  test('grouped figure with rotation gets localRotation backfilled', async () => {
    const group = makeGroup('g1', 'Group 1');
    const fig = makeFigure({
      id: 'fig1', figureKey: 'test', groupId: 'g1',
      rotation: 90, mirrorH: true, mirrorV: false,
    });
    const tile = await buildTileBytes({ figures: [fig], groups: [group] });
    const result = await prepareTileMerge(tile, 'Test.tile');

    const merged = result.figures[0];
    expect(merged.localRotation).toBe(90);
    expect(merged.localMirrorH).toBe(true);
    expect(merged.localMirrorV).toBe(false);
  });

  test('grouped figure with tile mode gets localTile dims backfilled', async () => {
    const group = makeGroup('g1', 'Group 1');
    const fig = makeFigure({
      id: 'fig1', figureKey: 'test', groupId: 'g1',
      tileMode: 'repeat' as const, tileWidthL0: 8, tileHeightL0: 8,
    });
    (fig as any).tileMode = 'repeat';
    const tile = await buildTileBytes({ figures: [fig], groups: [group] });
    const result = await prepareTileMerge(tile, 'Test.tile');

    const merged = result.figures[0];
    expect(merged.localTileWidthL0).toBe(8);
    expect(merged.localTileHeightL0).toBe(8);
  });

  test('grouped SVG without localSegments gets backfilled', async () => {
    const group = makeGroup('g1', 'Group 1');
    const svg = { ...makeSVG('svg_1'), groupId: 'g1' };
    const tile = await buildTileBytes({ svgObjects: [svg], groups: [group] });
    const result = await prepareTileMerge(tile, 'Test.tile');

    const merged = result.svgObjects[0];
    expect(merged.localSegments).toBeDefined();
    expect(merged.localSegments!.length).toBeGreaterThan(0);
    expect(merged.localCellX).toBeDefined();
    expect(merged.localCellY).toBeDefined();
  });

  test('end-to-end: materialize after merge reproduces world rotation', async () => {
    const group: GroupNode = {
      ...makeGroup('g1', 'Group 1'),
      translateX: 10, translateY: 20,
    };
    const fig = makeFigure({
      id: 'fig1', figureKey: 'test', groupId: 'g1',
      cellX: 15, cellY: 25, cellWidth: 4, cellHeight: 4,
      rotation: 90,
    });
    const tile = await buildTileBytes({ figures: [fig], groups: [group] });
    const merged = await prepareTileMerge(tile, 'Test.tile');

    // Build a composition state from the merge result
    const state = makeState({
      figures: merged.figures,
      svgObjects: merged.svgObjects,
      groups: merged.groups,
      sceneOrder: merged.sceneOrder,
    });

    // Reconcile locals (same as handleImportFile does)
    const reconciled = reconcileGroupLocals(state);

    // Now materialize through the wrapper group — world coords should be preserved
    const wrapper = reconciled.groups.find(g => !g.parentGroupId)!;
    const materialized = materializeGroupMembers(reconciled, wrapper.id);

    const resultFig = materialized.figures[0];
    expect(resultFig.cellX).toBeCloseTo(15, 1);
    expect(resultFig.cellY).toBeCloseTo(25, 1);
    expect(resultFig.rotation).toBe(90);
  });

  test('JustFrames.tile: all grouped figures have localRotation after merge', async () => {
    const fs = require('fs');
    const path = require('path');
    const tilePath = path.join(__dirname, '../../test_data/JustFrames.tile');
    if (!fs.existsSync(tilePath)) return; // skip if test data not present
    const data = new Uint8Array(fs.readFileSync(tilePath));
    const result = await prepareTileMerge(data, 'JustFrames.tile');

    for (const fig of result.figures) {
      if (fig.groupId) {
        expect(fig.localRotation).toBeDefined();
        expect(fig.localMirrorH).toBeDefined();
        expect(fig.localMirrorV).toBeDefined();
      }
    }
    for (const svg of result.svgObjects) {
      if (svg.groupId) {
        expect(svg.localSegments).toBeDefined();
      }
    }
  });
});
