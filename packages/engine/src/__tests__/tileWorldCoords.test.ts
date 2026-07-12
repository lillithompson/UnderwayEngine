import {
  reconcileGroupLocals,
  materializeGroupMembers,
  groupAncestorChain,
  groupLocalCenter,
  applyGroupTransformPoint,
  applyChainedGroupTransform,
  applyChainedGroupTransformPoint,
} from '../compositionOps';
import { CompositionState, SVGObject, GroupNode, PathSegment, makeViewport } from '../types';

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

    // Before reconcile: locals are stale (materialization would produce
    // different world coords than what's stored).
    let mismatchBefore = 0;
    for (const s of state.svgObjects) {
      if (!s.groupId || s.localCellX == null) continue;
      const chain = groupAncestorChain(state.groups, s.groupId);
      const expected = applyChainedGroupTransform(chain, {
        cellX: s.localCellX!, cellY: s.localCellY!,
        cellWidth: s.localCellWidth!, cellHeight: s.localCellHeight!,
      });
      if (Math.abs(expected.cellX - s.cellX) > 0.01) mismatchBefore++;
    }
    expect(mismatchBefore).toBeGreaterThan(0);

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

describe('groupLocalCenter stability across rotations', () => {
  test('returns same pivot after rotating a group with nested child groups', () => {
    const parentGroup: GroupNode = {
      id: 'parent', name: 'Parent',
      translateX: 50, translateY: 100,
      scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const childGroup: GroupNode = {
      id: 'child', name: 'Child', parentGroupId: 'parent',
      translateX: 10, translateY: 20,
      scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    // SVG in the child group
    const svg = makeSvg({
      id: 'svg_1',
      groupId: 'child',
      localCellX: 0, localCellY: 0,
      localCellWidth: 8, localCellHeight: 8,
      localSegments: [{ kind: 'line' as const, start: [0, 0] as [number, number], end: [8, 8] as [number, number] }],
      // World coords = parent(child(local)) = parent(10+0, 20+0, 8, 8) = (60, 120, 8, 8)
      cellX: 60, cellY: 120, cellWidth: 8, cellHeight: 8,
      segments: [{ kind: 'line' as const, start: [60, 120] as [number, number], end: [68, 128] as [number, number] }],
    });

    let state = makeState({
      svgObjects: [svg],
      groups: [parentGroup, childGroup],
      sceneOrder: ['svg_1'],
    });

    // Get initial pivot
    const [cx0, cy0] = groupLocalCenter(state, 'parent');

    // Simulate 4 rotations (full 360)
    for (let i = 0; i < 4; i++) {
      const gn = state.groups.find(g => g.id === 'parent')!;
      const [lcx, lcy] = groupLocalCenter(state, 'parent');
      const oldWorldCenter = applyGroupTransformPoint(gn, lcx, lcy);
      const newRot = ((gn.rotation + 90) % 360) as 0 | 90 | 180 | 270;
      const newGroup = { ...gn, rotation: newRot };
      const newWorldCenter = applyGroupTransformPoint(newGroup, lcx, lcy);
      const newTx = gn.translateX + (oldWorldCenter[0] - newWorldCenter[0]);
      const newTy = gn.translateY + (oldWorldCenter[1] - newWorldCenter[1]);
      const groups = state.groups.map(g => g.id === 'parent'
        ? { ...g, rotation: newRot, translateX: newTx, translateY: newTy }
        : g);
      state = materializeGroupMembers({ ...state, groups }, 'parent');

      // Pivot should be stable on every iteration
      const [cx, cy] = groupLocalCenter(state, 'parent');
      expect(cx).toBeCloseTo(cx0, 6);
      expect(cy).toBeCloseTo(cy0, 6);
    }

    // After 4 rotations, group should be back to rotation=0
    const finalGroup = state.groups.find(g => g.id === 'parent')!;
    expect(finalGroup.rotation).toBe(0);
    // And translate should be back to original
    expect(finalGroup.translateX).toBeCloseTo(50, 6);
    expect(finalGroup.translateY).toBeCloseTo(100, 6);
  });

  test('returns same pivot after mirroring a group twice', () => {
    const parentGroup: GroupNode = {
      id: 'parent', name: 'Parent',
      translateX: 50, translateY: 100,
      scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const childGroup: GroupNode = {
      id: 'child', name: 'Child', parentGroupId: 'parent',
      translateX: 10, translateY: 20,
      scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const svg = makeSvg({
      id: 'svg_1',
      groupId: 'child',
      localCellX: 0, localCellY: 0,
      localCellWidth: 8, localCellHeight: 8,
      localSegments: [{ kind: 'line' as const, start: [0, 0] as [number, number], end: [8, 8] as [number, number] }],
      cellX: 60, cellY: 120, cellWidth: 8, cellHeight: 8,
      segments: [{ kind: 'line' as const, start: [60, 120] as [number, number], end: [68, 128] as [number, number] }],
    });

    const origState = makeState({
      svgObjects: [svg],
      groups: [parentGroup, childGroup],
      sceneOrder: ['svg_1'],
    });

    // Mirror H twice should return to original
    let state = origState;
    for (let i = 0; i < 2; i++) {
      const gn = state.groups.find(g => g.id === 'parent')!;
      const [lcx, lcy] = groupLocalCenter(state, 'parent');
      const oldWorldCenter = applyGroupTransformPoint(gn, lcx, lcy);
      const newMirrorH = !gn.mirrorH;
      const newGroup = { ...gn, mirrorH: newMirrorH };
      const newWorldCenter = applyGroupTransformPoint(newGroup, lcx, lcy);
      const newTx = gn.translateX + (oldWorldCenter[0] - newWorldCenter[0]);
      const newTy = gn.translateY + (oldWorldCenter[1] - newWorldCenter[1]);
      const groups = state.groups.map(g => g.id === 'parent'
        ? { ...g, mirrorH: newMirrorH, translateX: newTx, translateY: newTy }
        : g);
      state = materializeGroupMembers({ ...state, groups }, 'parent');
    }

    const finalGroup = state.groups.find(g => g.id === 'parent')!;
    expect(finalGroup.mirrorH).toBe(false);
    expect(finalGroup.translateX).toBeCloseTo(50, 6);
    expect(finalGroup.translateY).toBeCloseTo(100, 6);
  });

  test('masked group pivots around the mask center, not the full member union', () => {
    const square = (x: number, y: number, size: number): PathSegment[] => [
      { kind: 'line', start: [x, y], end: [x + size, y] },
      { kind: 'line', start: [x + size, y], end: [x + size, y + size] },
      { kind: 'line', start: [x + size, y + size], end: [x, y + size] },
      { kind: 'line', start: [x, y + size], end: [x, y] },
    ];
    // Big background member spanning local (0,0)..(20,20): union center is (10,10).
    const bg = makeSvg({
      id: 'bg', groupId: 'g1',
      localSegments: square(0, 0, 20),
      segments: square(0, 0, 20),
      cellX: 0, cellY: 0, cellWidth: 20, cellHeight: 20,
      localCellX: 0, localCellY: 0, localCellWidth: 20, localCellHeight: 20,
    });
    // Small mask at local (2,2)..(6,6): mask center is (4,4).
    const mask = makeSvg({
      id: 'mask', groupId: 'g1', isMask: true,
      localSegments: square(2, 2, 4),
      segments: square(2, 2, 4),
      cellX: 2, cellY: 2, cellWidth: 4, cellHeight: 4,
      localCellX: 2, localCellY: 2, localCellWidth: 4, localCellHeight: 4,
    });
    const group: GroupNode = {
      id: 'g1', name: 'G1',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const state = makeState({
      svgObjects: [bg, mask], groups: [group], sceneOrder: ['bg', 'mask'],
    });

    const [cx, cy] = groupLocalCenter(state, 'g1');
    expect(cx).toBeCloseTo(4, 6);
    expect(cy).toBeCloseTo(4, 6);
  });

  test('unmasked group still pivots around the full member union', () => {
    const square = (x: number, y: number, size: number): PathSegment[] => [
      { kind: 'line', start: [x, y], end: [x + size, y] },
      { kind: 'line', start: [x + size, y], end: [x + size, y + size] },
      { kind: 'line', start: [x + size, y + size], end: [x, y + size] },
      { kind: 'line', start: [x, y + size], end: [x, y] },
    ];
    const bg = makeSvg({
      id: 'bg', groupId: 'g1',
      localSegments: square(0, 0, 20),
      segments: square(0, 0, 20),
      cellX: 0, cellY: 0, cellWidth: 20, cellHeight: 20,
      localCellX: 0, localCellY: 0, localCellWidth: 20, localCellHeight: 20,
    });
    const group: GroupNode = {
      id: 'g1', name: 'G1',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const state = makeState({
      svgObjects: [bg], groups: [group], sceneOrder: ['bg'],
    });

    const [cx, cy] = groupLocalCenter(state, 'g1');
    expect(cx).toBeCloseTo(10, 6);
    expect(cy).toBeCloseTo(10, 6);
  });
});
