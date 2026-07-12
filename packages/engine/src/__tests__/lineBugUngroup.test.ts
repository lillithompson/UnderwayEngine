/**
 * Regression: opening a saved .tile file (test_data/LineBug.tile) that
 * contains a group of axis-aligned lines and ungrouping it must produce
 * lines with a non-degenerate creationBox. Before the v15 schema bump,
 * lineDirection and creationBox were not persisted, so loaded H/V lines
 * fell out of ungroup with `creationBox: undefined` and a 0-axis segment
 * AABB. Selection overlay, drag-snap anchor, and corner-handle math all
 * collapsed; users reported lines "disappearing" on move/scale.
 */

import * as fs from 'fs';
import * as zlib from 'zlib';
import * as path from 'path';

import { deserializeComposition, serializeComposition } from '../compositionBinaryFormat';
import { applyCompOps } from '../compositionOps';
import {
  CompositionState,
  CompUndoEntry,
  SVGObject,
  makeViewport,
} from '../types';

jest.mock('@/native-shell/bridge/webBridge', () => ({
  logToNative: jest.fn(),
}));

function makeState(parts: Partial<CompositionState> = {}): CompositionState {
  const figures = parts.figures ?? [];
  const svgObjects = parts.svgObjects ?? [];
  const images = parts.images ?? [];
  const groups = parts.groups ?? [];
  return {
    id: 'test', name: 'test',
    figures, svgObjects, images,
    imageBlobs: {},
    lineDraft: null, arcDraft: null,
    editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
    customColors: [],
    groups,
    sceneOrder: parts.sceneOrder ?? [
      ...images.map(i => i.id),
      ...figures.map(f => f.id),
      ...svgObjects.map(s => s.id),
    ],
    gridLevel: parts.gridLevel ?? 0, strokeScale: 8, gridIntensity: 0.5,
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

describe('LineBug.tile: ungroup restores non-degenerate creationBox', () => {
  test('every loaded group, when ungrouped, leaves H/V lines with creationBox width≥1 and height≥1', () => {
    const tilePath = path.join(__dirname, '../../test_data/LineBug.tile');
    const data = new Uint8Array(fs.readFileSync(tilePath));
    const decompressed = zlib.inflateSync(data);
    const { meta } = deserializeComposition(decompressed);

    let state = makeState({
      figures: meta.figures,
      svgObjects: meta.svgObjects ?? [],
      images: meta.images ?? [],
      groups: meta.groups ?? [],
      sceneOrder: meta.sceneOrder,
      gridLevel: meta.gridLevel,
    });

    // Backfill should have inferred lineDirection on load for every
    // axis-aligned single-segment line. Confirm at least some H/V lines
    // are now tagged — otherwise downstream assertions can't fire.
    const taggedHV = state.svgObjects.filter(s =>
      s.lineDirection === 'horizontal' || s.lineDirection === 'vertical');
    expect(taggedHV.length).toBeGreaterThan(0);

    // Repair on load fires for grouped H/V lines too — every degenerate
    // line should already have a non-degenerate creationBox before any
    // ungroup happens.
    for (const s of taggedHV) {
      expect(s.creationBox).toBeDefined();
      expect(s.creationBox!.width).toBeGreaterThanOrEqual(1);
      expect(s.creationBox!.height).toBeGreaterThanOrEqual(1);
    }

    // Recursively ungroup every group: walk parents → children, applying
    // an ungroup op at each level. The user's repro is on a single saved
    // group, but LineBug.tile nests its lines a few groups deep, so we
    // unwind the whole hierarchy to land all H/V lines at the loose level.
    while (state.groups.length > 0) {
      // Pick a leaf-most group (no children of its own) so we never try
      // to ungroup a group whose own children we'd then orphan.
      const groupsByParent = new Map<string | undefined, string[]>();
      for (const g of state.groups) {
        const key = g.parentGroupId;
        if (!groupsByParent.has(key)) groupsByParent.set(key, []);
        groupsByParent.get(key)!.push(g.id);
      }
      const leaf = state.groups.find(g => !groupsByParent.has(g.id));
      if (!leaf) break;
      const directIds = [
        ...state.svgObjects.filter(s => s.groupId === leaf.id).map(s => s.id),
        ...state.figures.filter(f => f.groupId === leaf.id).map(f => f.id),
        ...(state.images ?? []).filter(i => i.groupId === leaf.id).map(i => i.id),
      ];
      const ungroupOps: CompUndoEntry = [{
        op: 'ungroupFigures', figureIds: directIds, groupId: leaf.id,
        groupName: leaf.name,
      }];
      state = applyCompOps(state, ungroupOps);
    }

    // Every loose (now-ungrouped) H/V line must have a sane creationBox.
    let checked = 0;
    for (const s of state.svgObjects) {
      if (s.groupId) continue; // child groups still nest some — skip
      if (s.lineDirection !== 'horizontal' && s.lineDirection !== 'vertical') continue;
      checked++;
      expect(s.creationBox).toBeDefined();
      expect(s.creationBox!.width).toBeGreaterThanOrEqual(1);
      expect(s.creationBox!.height).toBeGreaterThanOrEqual(1);
    }
    expect(checked).toBeGreaterThan(0);
  });

  test('repair on load: ungrouped degenerate-bbox line gets a synthesized creationBox', () => {
    // Mimic a v14-era save where the bug already left lines in a bad
    // state on disk: ungrouped, no creationBox, no lineDirection,
    // segments collapsed onto one axis.
    const horizontal: SVGObject = {
      id: 'svg_h',
      segments: [{ kind: 'line', start: [10, 4], end: [22, 4] }],
      color: { r: 0, g: 0, b: 0 },
      cellX: 10, cellY: 4, cellWidth: 12, cellHeight: 0,
    };
    const vertical: SVGObject = {
      id: 'svg_v',
      segments: [{ kind: 'line', start: [3, 5], end: [3, 17] }],
      color: { r: 0, g: 0, b: 0 },
      cellX: 3, cellY: 5, cellWidth: 0, cellHeight: 12,
    };
    const bytes = serializeComposition({
      name: 'Repair', gridLevel: 0,
      strokeScale: 8, gridIntensity: 0.5,
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
      figures: [],
      svgObjects: [horizontal, vertical],
      sceneOrder: ['svg_h', 'svg_v'],
    }, []);
    const { meta } = deserializeComposition(bytes);
    const h = meta.svgObjects!.find(s => s.id === 'svg_h')!;
    const v = meta.svgObjects!.find(s => s.id === 'svg_v')!;

    // Repair triggers because creationBox/lineDirection were undefined
    // and the bbox is degenerate. Step is 1 L0 cell at gridLevel 0.
    expect(h.lineDirection).toBe('horizontal');
    expect(h.creationBox).toBeDefined();
    expect(h.creationBox!.width).toBeGreaterThanOrEqual(1);
    expect(h.creationBox!.height).toBeGreaterThanOrEqual(1);

    expect(v.lineDirection).toBe('vertical');
    expect(v.creationBox).toBeDefined();
    expect(v.creationBox!.width).toBeGreaterThanOrEqual(1);
    expect(v.creationBox!.height).toBeGreaterThanOrEqual(1);
  });

  test('repair leaves valid v15 saves alone', () => {
    // A round-trip where creationBox + lineDirection were already set:
    // the deserializer must NOT clobber them.
    const original: SVGObject = {
      id: 'svg_h',
      segments: [{ kind: 'line', start: [10, 4], end: [22, 4] }],
      color: { r: 0, g: 0, b: 0 },
      cellX: 10, cellY: 4, cellWidth: 12, cellHeight: 0,
      lineDirection: 'horizontal',
      creationBox: { minX: 10, minY: 3, width: 12, height: 2 },
    };
    const bytes = serializeComposition({
      name: 'RoundTrip', gridLevel: 0,
      strokeScale: 8, gridIntensity: 0.5,
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
      figures: [],
      svgObjects: [original],
      sceneOrder: ['svg_h'],
    }, []);
    const { meta } = deserializeComposition(bytes);
    const h = meta.svgObjects!.find(s => s.id === 'svg_h')!;
    expect(h.lineDirection).toBe('horizontal');
    expect(h.creationBox).toEqual({ minX: 10, minY: 3, width: 12, height: 2 });
  });
});
