import {
  reconcileGroupLocals,
  materializeGroupMembers,
  groupAncestorChain,
  applyChainedGroupTransform,
  applyChainedGroupTransformPoint,
} from '../compositionOps';
import { CompositionState, SVGObject, GroupNode, makeViewport } from '../types';

function makeSvg(overrides: Partial<SVGObject> & { id: string }): SVGObject {
  return {
    segments: [{ kind: 'line' as const, start: [0, 0] as [number, number], end: [2, 2] as [number, number] }],
    color: { r: 255, g: 255, b: 255 },
    cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2,
    ...overrides,
  };
}

function makeState(overrides: Partial<CompositionState> = {}): CompositionState {
  return {
    id: 'test',
    name: 'test',
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
    strokeScale: 8, gridIntensity: 0.5,
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

describe('reconcileGroupLocals', () => {
  test('recomputes locals from world for a group with scale', () => {
    const group: GroupNode = {
      id: 'g1', name: 'G1',
      translateX: 10, translateY: 20,
      scaleX: 2, scaleY: 0.5,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    // World coords are the intended visual positions.
    // Locals are stale (don't match world + inverse group transform).
    const svg = makeSvg({
      id: 'svg_1',
      groupId: 'g1',
      localCellX: 999, localCellY: 999,
      localCellWidth: 999, localCellHeight: 999,
      localSegments: [{ kind: 'line' as const, start: [999, 999] as [number, number], end: [999, 999] as [number, number] }],
      // Intended world coords:
      cellX: 20, cellY: 24, cellWidth: 8, cellHeight: 3,
      segments: [{ kind: 'line' as const, start: [20, 24] as [number, number], end: [28, 27] as [number, number] }],
    });
    const state = makeState({ svgObjects: [svg], groups: [group], sceneOrder: ['svg_1'] });
    const fixed = reconcileGroupLocals(state);

    // World coords should be UNCHANGED
    expect(fixed.svgObjects[0].cellX).toBe(20);
    expect(fixed.svgObjects[0].cellY).toBe(24);
    expect(fixed.svgObjects[0].cellWidth).toBe(8);
    expect(fixed.svgObjects[0].cellHeight).toBe(3);

    // Locals should now be correct: local = inverse(world)
    // localX = (20 - 10) / 2 = 5, localY = (24 - 20) / 0.5 = 8
    // localW = 8 / 2 = 4, localH = 3 / 0.5 = 6
    expect(fixed.svgObjects[0].localCellX).toBe(5);
    expect(fixed.svgObjects[0].localCellY).toBe(8);
    expect(fixed.svgObjects[0].localCellWidth).toBe(4);
    expect(fixed.svgObjects[0].localCellHeight).toBe(6);

    // Materializing should now produce the same world coords
    const materialized = materializeGroupMembers(fixed, 'g1');
    expect(materialized.svgObjects[0].cellX).toBe(20);
    expect(materialized.svgObjects[0].cellY).toBe(24);
    expect(materialized.svgObjects[0].cellWidth).toBe(8);
    expect(materialized.svgObjects[0].cellHeight).toBe(3);
  });

  test('recomputes locals in nested group hierarchy', () => {
    const innerGroup: GroupNode = {
      id: 'inner', name: 'Inner', parentGroupId: 'outer',
      translateX: 0, translateY: 0,
      scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const outerGroup: GroupNode = {
      id: 'outer', name: 'Outer',
      translateX: 100, translateY: 50,
      scaleX: 0.5, scaleY: 0.5,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const svg = makeSvg({
      id: 'svg_1',
      groupId: 'inner',
      localCellX: 999, localCellY: 999,
      localCellWidth: 999, localCellHeight: 999,
      localSegments: [{ kind: 'line' as const, start: [999, 999] as [number, number], end: [999, 999] as [number, number] }],
      // Intended world:
      cellX: 105, cellY: 60, cellWidth: 4, cellHeight: 4,
      segments: [{ kind: 'line' as const, start: [105, 60] as [number, number], end: [109, 64] as [number, number] }],
    });
    const state = makeState({
      svgObjects: [svg],
      groups: [innerGroup, outerGroup],
      sceneOrder: ['svg_1'],
    });
    const fixed = reconcileGroupLocals(state);

    // World preserved
    expect(fixed.svgObjects[0].cellX).toBe(105);
    expect(fixed.svgObjects[0].cellY).toBe(60);

    // Locals corrected: chain inner(identity)→outer(tx=100,ty=50,s=0.5)
    // Inverse outer: (105-100)/0.5=10, (60-50)/0.5=20, 4/0.5=8, 4/0.5=8
    // Inverse inner: identity → (10, 20, 8, 8)
    expect(fixed.svgObjects[0].localCellX).toBe(10);
    expect(fixed.svgObjects[0].localCellY).toBe(20);
    expect(fixed.svgObjects[0].localCellWidth).toBe(8);
    expect(fixed.svgObjects[0].localCellHeight).toBe(8);

    // Materializing should reproduce the same world coords
    const materialized = materializeGroupMembers(fixed, 'outer');
    expect(materialized.svgObjects[0].cellX).toBeCloseTo(105, 6);
    expect(materialized.svgObjects[0].cellY).toBeCloseTo(60, 6);
  });

  test('no-ops when locals already consistent', () => {
    const group: GroupNode = {
      id: 'g1', name: 'G1',
      translateX: 10, translateY: 20,
      scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const svg = makeSvg({
      id: 'svg_1',
      groupId: 'g1',
      localCellX: 5, localCellY: 8,
      localCellWidth: 4, localCellHeight: 6,
      localSegments: [{ kind: 'line' as const, start: [5, 8] as [number, number], end: [9, 14] as [number, number] }],
      // Correct world coords that match local + group:
      cellX: 15, cellY: 28, cellWidth: 4, cellHeight: 6,
      segments: [{ kind: 'line' as const, start: [15, 28] as [number, number], end: [19, 34] as [number, number] }],
    });
    const state = makeState({ svgObjects: [svg], groups: [group], sceneOrder: ['svg_1'] });
    const result = reconcileGroupLocals(state);
    // Locals should be unchanged
    expect(result.svgObjects[0].localCellX).toBe(5);
    expect(result.svgObjects[0].localCellY).toBe(8);
  });

  test('handles composition with no groups', () => {
    const state = makeState({});
    const result = reconcileGroupLocals(state);
    expect(result).toBe(state);
  });

  test('WaveBug.tile: after reconcile, materialize reproduces world coords', async () => {
    const fs = require('fs');
    const zlib = require('zlib');
    const path = require('path');
    const { deserializeComposition } = require('../compositionBinaryFormat');

    const tilePath = path.join(__dirname, '../../test_data/WaveBug.tile');
    const data = fs.readFileSync(tilePath);
    const decompressed = zlib.inflateSync(data);
    const result = deserializeComposition(new Uint8Array(decompressed));
    const m = result.meta;

    const state = makeState({
      figures: m.figures ?? [],
      svgObjects: m.svgObjects ?? [],
      images: m.images ?? [],
      groups: m.groups ?? [],
      sceneOrder: m.sceneOrder ?? [],
    });

    // This file is why the loader drops the persisted caches: as saved,
    // 98 of its 99 grouped paths carry locals that re-derive somewhere
    // other than where the file says they were drawn, one of them 65
    // cells out. The loader now drops them, so there is no stale local
    // to find and nothing for a later materialize to move.
    for (const s of state.svgObjects) {
      expect(s.localCellX).toBeUndefined();
      expect(s.localSegments).toBeUndefined();
    }

    // Reconcile: recompute locals from world coords
    const fixed = reconcileGroupLocals(state);

    // World coords should be preserved exactly
    for (let i = 0; i < state.svgObjects.length; i++) {
      expect(fixed.svgObjects[i].cellX).toBe(state.svgObjects[i].cellX);
      expect(fixed.svgObjects[i].cellY).toBe(state.svgObjects[i].cellY);
      expect(fixed.svgObjects[i].cellWidth).toBe(state.svgObjects[i].cellWidth);
      expect(fixed.svgObjects[i].cellHeight).toBe(state.svgObjects[i].cellHeight);
    }

    // After reconcile: materializing produces the same world coords
    for (const s of fixed.svgObjects) {
      if (!s.groupId || s.localCellX == null) continue;
      const chain = groupAncestorChain(fixed.groups, s.groupId);
      const expected = applyChainedGroupTransform(chain, {
        cellX: s.localCellX!, cellY: s.localCellY!,
        cellWidth: s.localCellWidth!, cellHeight: s.localCellHeight!,
      });
      expect(s.cellX).toBeCloseTo(expected.cellX, 5);
      expect(s.cellY).toBeCloseTo(expected.cellY, 5);
      expect(s.cellWidth).toBeCloseTo(expected.cellWidth, 5);
      expect(s.cellHeight).toBeCloseTo(expected.cellHeight, 5);
    }

    // Segment endpoints should also be consistent after reconcile
    for (const s of fixed.svgObjects) {
      if (!s.groupId || !s.localSegments) continue;
      const chain = groupAncestorChain(fixed.groups, s.groupId);
      for (let i = 0; i < s.segments.length; i++) {
        const ls = s.localSegments[i];
        const ws = s.segments[i];
        const [ex, ey] = applyChainedGroupTransformPoint(chain, ls.start[0], ls.start[1]);
        expect(ws.start[0]).toBeCloseTo(ex, 4);
        expect(ws.start[1]).toBeCloseTo(ey, 4);
      }
    }
  });
});
