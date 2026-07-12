/**
 * Coverage for the duplicate-of-a-group flow used by handlePropsDuplicate
 * (components/CompositionEditor.tsx). The handler delegates op building
 * to engine `buildDuplicateOps`; this test wraps that helper with stable
 * id minters and asserts results through applyCompOps / revertCompOps.
 */

import {
  applyCompOps,
  revertCompOps,
  buildDuplicateOps as engineBuildDuplicateOps,
  computeSVGBbox,
  groupLocalCenter,
  applyGroupTransformPoint,
  computeDuplicateOffset,
} from '../compositionOps';
import {
  CompositionState,
  CompositionFigure,
  SVGObject,
  ImageObject,
  GroupNode,
  CompUndoEntry,
  makeViewport,
} from '../types';

function makeFigure(id: string, overrides: Partial<CompositionFigure> = {}): CompositionFigure {
  return {
    id,
    figureKey: 'test',
    cellX: 0, cellY: 0,
    cellWidth: 2, cellHeight: 2,
    resolutionX: 2, resolutionY: 2,
    rotation: 0,
    ...overrides,
  };
}

function makeSVGLine(id: string, overrides: Partial<SVGObject> = {}): SVGObject {
  const segs = overrides.segments ?? [{kind:'line' as const, start:[5,5] as [number,number], end:[10,5] as [number,number]}];
  return {
    id,
    segments: segs,
    color: { r: 255, g: 255, b: 255 },
    ...computeSVGBbox(segs),
    ...overrides,
  };
}

function makeSVGArc(id: string, overrides: Partial<SVGObject> = {}): SVGObject {
  const segs = overrides.segments ?? [{ kind: 'arc' as const, start: [1, 0] as [number,number], end: [0, 1] as [number,number], center: [0, 0] as [number,number] }];
  return {
    id,
    segments: segs,
    color: { r: 0, g: 0, b: 0 },
    cellX: 0, cellY: 0, cellWidth: 1, cellHeight: 1,
    ...overrides,
  };
}

function makeImage(id: string, overrides: Partial<ImageObject> = {}): ImageObject {
  return {
    id,
    imageId: 'blob_' + id,
    mimeType: 'image/png',
    pixelWidth: 100, pixelHeight: 100,
    cellX: 20, cellY: 20,
    cellWidth: 4, cellHeight: 4,
    ...overrides,
  };
}

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
    sceneOrder: [
      ...images.map((i) => i.id),
      ...figures.map((f) => f.id),
      ...svgObjects.map((s) => s.id),
    ],
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

/** Test wrapper around the engine's buildDuplicateOps that injects
 *  stable id minters so tests can assert exact ids and ordering. */
function buildDuplicateOps(state: CompositionState, selectedIds: string[]): {
  ops: CompUndoEntry;
  newIds: string[];
  groupIdMap: Map<string, string>;
} {
  let mintCounter = 0;
  return engineBuildDuplicateOps(state, selectedIds, {
    mintGroupId: (origGroupId) => origGroupId + '_dup',
    mintItemId: (kind, origId) => {
      const baseId = kind === 'svg' ? 'svg_' : kind === 'image' ? 'img_' : '';
      return `${baseId}dup_${mintCounter++}_${origId}`;
    },
  });
}

describe('handlePropsDuplicate ops produce a usable duplicated group', () => {
  // Build a group with one member of every kind. Each member is in 'g1' at
  // identity transform, so cloneWithOffset's locals (which it offsets by
  // dx/dy) and the duplicate's world coords end up consistent post-
  // groupFigures-reseed. Member fields cover the locals that
  // materializeGroupMembers requires (figure: localCell*, svg:
  // localSegments, image: localCell*).
  function buildGroupedState(): CompositionState {
    const fig = makeFigure('fig1', {
      cellX: 0, cellY: 0,
      groupId: 'g1',
      localCellX: 0, localCellY: 0, localCellWidth: 2, localCellHeight: 2,
      localRotation: 0, localMirrorH: false, localMirrorV: false,
    });
    const svgLine = makeSVGLine('svg_1', {
      segments: [{kind:'line', start:[5,5], end:[10,5]}],
      groupId: 'g1',
      localSegments: [{kind:'line', start:[5,5], end:[10,5]}],
      localCellX: 5, localCellY: 5, localCellWidth: 5, localCellHeight: 0,
    });
    const svgArc = makeSVGArc('svg_2', {
      segments: [{ kind: 'arc', start: [1, 0], end: [0, 1], center: [0, 0] }],
      localSegments: [{ kind: 'arc', start: [1, 0], end: [0, 1], center: [0, 0] }],
      groupId: 'g1',
      localCellX: 0, localCellY: 0, localCellWidth: 1, localCellHeight: 1,
    });
    const img = makeImage('img_1', {
      cellX: 20, cellY: 20,
      groupId: 'g1',
      localCellX: 20, localCellY: 20, localCellWidth: 4, localCellHeight: 4,
    });
    const group: GroupNode = {
      id: 'g1', name: 'My group',
      translateX: 0, translateY: 0,
      scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    return makeState({ figures: [fig], svgObjects: [svgLine, svgArc], images: [img], groups: [group] });
  }

  test('duplicate creates a new GroupNode at identity transform', () => {
    const state = buildGroupedState();
    const { ops, groupIdMap } = buildDuplicateOps(state, ['fig1', 'svg_1', 'svg_2', 'img_1']);
    const newGroupId = groupIdMap.get('g1')!;

    const after = applyCompOps(state, ops);

    expect(after.groups.length).toBe(2);
    const newGroup = after.groups.find(g => g.id === newGroupId)!;
    expect(newGroup).toBeDefined();
    expect(newGroup.translateX).toBe(0);
    expect(newGroup.translateY).toBe(0);
    expect(newGroup.scaleX).toBe(1);
    expect(newGroup.scaleY).toBe(1);
    expect(newGroup.rotation).toBe(0);
    expect(newGroup.mirrorH).toBe(false);
    expect(newGroup.mirrorV).toBe(false);
    expect(newGroup.name).toBe('My group copy');
  });

  test('duplicate seeds locals from world coords on every kind', () => {
    const state = buildGroupedState();
    const { ops, newIds, groupIdMap } = buildDuplicateOps(state, ['fig1', 'svg_1', 'svg_2', 'img_1']);
    const newGroupId = groupIdMap.get('g1')!;

    const after = applyCompOps(state, ops);

    // Test wrapper calls buildDuplicateOps without options.offset, so it
    // gets the 1-cell legacy default. Production callsites pass the
    // viewport-scaled `computeDuplicateOffset(state)` instead.

    // Every duplicate is in the new group and has locals == world.
    const dupFig = after.figures.find(f => newIds.includes(f.id))!;
    expect(dupFig.groupId).toBe(newGroupId);
    expect(dupFig.cellX).toBe(1);
    expect(dupFig.cellY).toBe(1);
    expect(dupFig.localCellX).toBe(dupFig.cellX);
    expect(dupFig.localCellY).toBe(dupFig.cellY);
    expect(dupFig.localCellWidth).toBe(dupFig.cellWidth);
    expect(dupFig.localCellHeight).toBe(dupFig.cellHeight);

    const dupSVGLine = after.svgObjects.find(s => newIds.includes(s.id) && s.segments[0]?.kind === 'line')!;
    expect(dupSVGLine.groupId).toBe(newGroupId);
    expect(dupSVGLine.segments).toEqual([{kind:'line', start:[6, 6], end:[11, 6]}]);
    expect(dupSVGLine.localSegments).toEqual(dupSVGLine.segments);

    const dupSVGArc = after.svgObjects.find(s => newIds.includes(s.id) && s.segments[0]?.kind === 'arc')!;
    expect(dupSVGArc.groupId).toBe(newGroupId);
    const seg = dupSVGArc.segments[0];
    if (seg.kind !== 'arc') throw new Error('expected arc segment');
    expect(seg.start).toEqual([2, 1]);
    expect(seg.end).toEqual([1, 2]);
    expect(seg.center).toEqual([1, 1]);
    expect(dupSVGArc.localSegments).toEqual(dupSVGArc.segments);

    const dupImg = after.images!.find(i => newIds.includes(i.id))!;
    expect(dupImg.groupId).toBe(newGroupId);
    expect(dupImg.cellX).toBe(21);
    expect(dupImg.cellY).toBe(21);
    expect(dupImg.localCellX).toBe(dupImg.cellX);
    expect(dupImg.localCellY).toBe(dupImg.cellY);
  });

  test('rotating the duplicate group transforms every member kind (regression)', () => {
    const state = buildGroupedState();
    const { ops, newIds, groupIdMap } = buildDuplicateOps(state, ['fig1', 'svg_1', 'svg_2', 'img_1']);
    const newGroupId = groupIdMap.get('g1')!;

    const afterDup = applyCompOps(state, ops);

    // Rotate 90° CW about the group's local origin (no translate adjust —
    // we only need to confirm the transform actually propagates).
    const rotated = applyCompOps(afterDup, [{
      op: 'transformGroup',
      groupId: newGroupId,
      oldTranslateX: 0, oldTranslateY: 0,
      oldScaleX: 1, oldScaleY: 1,
      oldRotation: 0, oldMirrorH: false, oldMirrorV: false,
      newTranslateX: 0, newTranslateY: 0,
      newScaleX: 1, newScaleY: 1,
      newRotation: 90, newMirrorH: false, newMirrorV: false,
    }]);

    // Pre-fix, transformGroup silently no-opped (no GroupNode for newId).
    // Now every duplicate's world coords reflect the 90° rotation.
    const dupSVGLine = rotated.svgObjects.find(s => newIds.includes(s.id) && s.segments[0]?.kind === 'line')!;
    expect(dupSVGLine.segments).not.toEqual([{kind:'line', start:[6,6], end:[11,6]}]);

    const dupSVGArc = rotated.svgObjects.find(s => newIds.includes(s.id) && s.segments[0]?.kind === 'arc')!;
    const seg = dupSVGArc.segments[0];
    if (seg.kind !== 'arc') throw new Error('expected arc segment');
    expect([seg.start, seg.end, seg.center]).not.toEqual([[2, 1], [1, 2], [1, 1]]);

    const dupFig = rotated.figures.find(f => newIds.includes(f.id))!;
    expect(dupFig.rotation).toBe(90);

    // Original group is untouched.
    expect(rotated.figures.find(f => f.id === 'fig1')!.rotation).toBe(0);
    expect(rotated.svgObjects.find(s => s.id === 'svg_1')!.segments).toEqual([{kind:'line', start:[5,5], end:[10,5]}]);
  });

  test('partial group selection: duplicate of one member produces a 1-member new group', () => {
    const state = buildGroupedState();
    const { ops, newIds, groupIdMap } = buildDuplicateOps(state, ['svg_1']);
    const newGroupId = groupIdMap.get('g1')!;

    const after = applyCompOps(state, ops);

    expect(after.groups.length).toBe(2);
    expect(after.groups.find(g => g.id === newGroupId)).toBeDefined();
    // Only the duplicated svg object is in the new group.
    const newGroupMembers = [
      ...after.figures.filter(f => f.groupId === newGroupId).map(f => f.id),
      ...after.svgObjects.filter(s => s.groupId === newGroupId).map(s => s.id),
      ...(after.images ?? []).filter(i => i.groupId === newGroupId).map(i => i.id),
    ];
    expect(newGroupMembers).toEqual(newIds);
    // Original group still has all four original members.
    const origMembers = [
      ...after.figures.filter(f => f.groupId === 'g1').map(f => f.id),
      ...after.svgObjects.filter(s => s.groupId === 'g1').map(s => s.id),
      ...(after.images ?? []).filter(i => i.groupId === 'g1').map(i => i.id),
    ];
    expect(origMembers.sort()).toEqual(['fig1', 'img_1', 'svg_1', 'svg_2']);
  });

  test('multi-source-group selection produces disjoint new groups', () => {
    const figA = makeFigure('a1', { cellX: 0, cellY: 0, groupId: 'gA',
      localCellX: 0, localCellY: 0, localCellWidth: 2, localCellHeight: 2,
      localRotation: 0, localMirrorH: false, localMirrorV: false });
    const figB = makeFigure('b1', { cellX: 30, cellY: 30, groupId: 'gB',
      localCellX: 30, localCellY: 30, localCellWidth: 2, localCellHeight: 2,
      localRotation: 0, localMirrorH: false, localMirrorV: false });
    const groupA: GroupNode = { id: 'gA', name: 'A', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false };
    const groupB: GroupNode = { id: 'gB', name: 'B', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false };
    const state = makeState({ figures: [figA, figB], groups: [groupA, groupB] });

    const { ops, newIds, groupIdMap } = buildDuplicateOps(state, ['a1', 'b1']);
    const newGA = groupIdMap.get('gA')!;
    const newGB = groupIdMap.get('gB')!;

    const after = applyCompOps(state, ops);

    expect(after.groups.length).toBe(4);
    expect(newGA).not.toEqual(newGB);
    // Each new group has exactly one member, and they're disjoint.
    const inA = after.figures.filter(f => f.groupId === newGA).map(f => f.id);
    const inB = after.figures.filter(f => f.groupId === newGB).map(f => f.id);
    expect(inA.length).toBe(1);
    expect(inB.length).toBe(1);
    expect(inA[0]).not.toEqual(inB[0]);
    expect(newIds.sort()).toEqual([...inA, ...inB].sort());
  });

  test('non-grouped duplicate emits no groupFigures op and behavior is unchanged', () => {
    const fig = makeFigure('lone1');
    const state = makeState({ figures: [fig] });

    const { ops, newIds } = buildDuplicateOps(state, ['lone1']);

    // Only the placeObject op — no groupFigures.
    expect(ops.length).toBe(1);
    expect(ops[0].op).toBe('placeObject');

    const after = applyCompOps(state, ops);
    expect(after.groups.length).toBe(0);
    const dup = after.figures.find(f => newIds.includes(f.id))!;
    expect(dup.groupId).toBeUndefined();
    // Test wrapper omits options.offset, so the duplicate lands at the
    // legacy 1-cell default.
    expect(dup.cellX).toBe(1);
    expect(dup.cellY).toBe(1);
  });

  test('undo round-trip restores pre-duplicate state', () => {
    const state = buildGroupedState();
    const { ops } = buildDuplicateOps(state, ['fig1', 'svg_1', 'svg_2', 'img_1']);

    const after = applyCompOps(state, ops);
    const reverted = revertCompOps(after, ops);

    expect(reverted.groups.length).toBe(state.groups.length);
    expect(reverted.figures.length).toBe(state.figures.length);
    expect(reverted.svgObjects.length).toBe(state.svgObjects.length);
    expect(reverted.images!.length).toBe(state.images!.length);
    expect(reverted.sceneOrder).toEqual(state.sceneOrder);

    // Original members untouched.
    expect(reverted.figures.find(f => f.id === 'fig1')).toEqual(state.figures[0]);
    expect(reverted.svgObjects.find(s => s.id === 'svg_1')).toEqual(state.svgObjects[0]);
    expect(reverted.svgObjects.find(s => s.id === 'svg_2')).toEqual(state.svgObjects[1]);
    expect(reverted.images!.find(i => i.id === 'img_1')).toEqual(state.images![0]);
  });

  test('duplicating a group with child groups preserves hierarchy', () => {
    // Root group with a child group, each containing a figure.
    const rootGroup: GroupNode = {
      id: 'root', name: 'Root',
      translateX: 10, translateY: 20, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const childGroup: GroupNode = {
      id: 'child', name: 'Child', parentGroupId: 'root',
      translateX: 5, translateY: 5, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const rootFig = makeFigure('f_root', {
      cellX: 10, cellY: 20, groupId: 'root',
      localCellX: 0, localCellY: 0, localCellWidth: 2, localCellHeight: 2,
      localRotation: 0, localMirrorH: false, localMirrorV: false,
    });
    const childFig = makeFigure('f_child', {
      cellX: 15, cellY: 25, groupId: 'child',
      localCellX: 0, localCellY: 0, localCellWidth: 2, localCellHeight: 2,
      localRotation: 0, localMirrorH: false, localMirrorV: false,
    });
    const state = makeState({
      figures: [rootFig, childFig],
      groups: [rootGroup, childGroup],
    });

    const { ops, groupIdMap } = buildDuplicateOps(state, ['f_root', 'f_child']);
    const after = applyCompOps(state, ops);

    const newRootId = groupIdMap.get('root')!;
    const newChildId = groupIdMap.get('child')!;

    // Both new groups should exist.
    const newRoot = after.groups.find(g => g.id === newRootId);
    const newChild = after.groups.find(g => g.id === newChildId);
    expect(newRoot).toBeDefined();
    expect(newChild).toBeDefined();

    // The new child should be nested under the new root.
    expect(newChild!.parentGroupId).toBe(newRootId);

    // Figures should be in the correct new groups.
    const dupRootFig = after.figures.find(f => f.groupId === newRootId);
    const dupChildFig = after.figures.find(f => f.groupId === newChildId);
    expect(dupRootFig).toBeDefined();
    expect(dupChildFig).toBeDefined();

    // Undo should cleanly restore original state.
    const reverted = revertCompOps(after, ops);
    expect(reverted.groups.length).toBe(2);
    expect(reverted.figures.length).toBe(2);
  });

  test('duplicating a root group whose only direct contents are sub-groups produces one new root', () => {
    // Repro: root group G2 contains two sub-groups G1, G1prime; each
    // sub-group has two figures and no loose members live directly under
    // G2. Previously this duplicated to three root nodes (the original
    // plus two unparented sub-groups) because the leaf-driven groupIdMap
    // never seeded an entry for G2.
    const g2: GroupNode = {
      id: 'g2', name: 'G2',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const g1: GroupNode = {
      id: 'g1', name: 'G1', parentGroupId: 'g2',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const g1p: GroupNode = {
      id: 'g1p', name: 'G1prime', parentGroupId: 'g2',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const a = makeFigure('a', {
      cellX: 0, cellY: 0, groupId: 'g1',
      localCellX: 0, localCellY: 0, localCellWidth: 2, localCellHeight: 2,
      localRotation: 0, localMirrorH: false, localMirrorV: false,
    });
    const b = makeFigure('b', {
      cellX: 2, cellY: 0, groupId: 'g1',
      localCellX: 2, localCellY: 0, localCellWidth: 2, localCellHeight: 2,
      localRotation: 0, localMirrorH: false, localMirrorV: false,
    });
    const ap = makeFigure('ap', {
      cellX: 0, cellY: 4, groupId: 'g1p',
      localCellX: 0, localCellY: 4, localCellWidth: 2, localCellHeight: 2,
      localRotation: 0, localMirrorH: false, localMirrorV: false,
    });
    const bp = makeFigure('bp', {
      cellX: 2, cellY: 4, groupId: 'g1p',
      localCellX: 2, localCellY: 4, localCellWidth: 2, localCellHeight: 2,
      localRotation: 0, localMirrorH: false, localMirrorV: false,
    });
    const state = makeState({
      figures: [a, b, ap, bp],
      groups: [g2, g1, g1p],
    });

    const { ops, groupIdMap } = buildDuplicateOps(state, ['a', 'b', 'ap', 'bp']);
    const after = applyCompOps(state, ops);

    const newG2 = groupIdMap.get('g2');
    const newG1 = groupIdMap.get('g1');
    const newG1p = groupIdMap.get('g1p');
    expect(newG2).toBeDefined();
    expect(newG1).toBeDefined();
    expect(newG1p).toBeDefined();

    // Two root groups: original g2, and the new duplicated root.
    const rootGroups = after.groups.filter(g => !g.parentGroupId);
    expect(rootGroups.map(g => g.id).sort()).toEqual(['g2', newG2!].sort());

    // Both new sub-groups must be nested under the new root.
    expect(after.groups.find(g => g.id === newG1)!.parentGroupId).toBe(newG2);
    expect(after.groups.find(g => g.id === newG1p)!.parentGroupId).toBe(newG2);

    // Each new sub-group should have its two duplicated figures.
    const newG1Members = after.figures.filter(f => f.groupId === newG1);
    const newG1pMembers = after.figures.filter(f => f.groupId === newG1p);
    expect(newG1Members.length).toBe(2);
    expect(newG1pMembers.length).toBe(2);
  });

  test('full sequence: duplicate → mirror → move → ungroup → undo all restores original', () => {
    // Set up: a group with one figure.
    const group: GroupNode = {
      id: 'g1', name: 'TestGroup',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const fig = makeFigure('f1', {
      cellX: 4, cellY: 6, groupId: 'g1',
      localCellX: 4, localCellY: 6, localCellWidth: 2, localCellHeight: 2,
      localRotation: 0, localMirrorH: false, localMirrorV: false,
    });
    const origState = makeState({ figures: [fig], groups: [group] });

    // Step 1: Duplicate
    const { ops: dupOps, groupIdMap } = buildDuplicateOps(origState, ['f1']);
    let state = applyCompOps(origState, dupOps);
    const newGid = groupIdMap.get('g1')!;
    const dupFigId = state.figures.find(f => f.groupId === newGid)!.id;

    // Step 2: Mirror the duplicate group
    const g2 = state.groups.find(g => g.id === newGid)!;
    const [lcx, lcy] = groupLocalCenter(state, newGid);
    const oldWC = applyGroupTransformPoint(g2, lcx, lcy);
    const newG2 = { ...g2, mirrorH: true };
    const newWC = applyGroupTransformPoint(newG2, lcx, lcy);
    const mirrorOps: CompUndoEntry = [{
      op: 'transformGroup', groupId: newGid,
      oldTranslateX: g2.translateX, oldTranslateY: g2.translateY,
      oldScaleX: g2.scaleX, oldScaleY: g2.scaleY,
      oldRotation: g2.rotation, oldMirrorH: g2.mirrorH, oldMirrorV: g2.mirrorV,
      newTranslateX: g2.translateX + (oldWC[0] - newWC[0]),
      newTranslateY: g2.translateY + (oldWC[1] - newWC[1]),
      newScaleX: g2.scaleX, newScaleY: g2.scaleY,
      newRotation: g2.rotation, newMirrorH: true, newMirrorV: g2.mirrorV,
    }];
    state = applyCompOps(state, mirrorOps);
    const mirroredGroup = state.groups.find(g => g.id === newGid)!;
    expect(mirroredGroup.mirrorH).toBe(true);

    // Step 3: Move the duplicate group
    const moveOps: CompUndoEntry = [{
      op: 'transformGroup', groupId: newGid,
      oldTranslateX: mirroredGroup.translateX, oldTranslateY: mirroredGroup.translateY,
      oldScaleX: mirroredGroup.scaleX, oldScaleY: mirroredGroup.scaleY,
      oldRotation: mirroredGroup.rotation, oldMirrorH: mirroredGroup.mirrorH, oldMirrorV: mirroredGroup.mirrorV,
      newTranslateX: mirroredGroup.translateX + 10, newTranslateY: mirroredGroup.translateY + 5,
      newScaleX: mirroredGroup.scaleX, newScaleY: mirroredGroup.scaleY,
      newRotation: mirroredGroup.rotation, newMirrorH: mirroredGroup.mirrorH, newMirrorV: mirroredGroup.mirrorV,
    }];
    state = applyCompOps(state, moveOps);
    const movedGroup = state.groups.find(g => g.id === newGid)!;

    // Step 4: Ungroup — capture the group's transform in the op
    const looseIds = state.figures.filter(f => f.groupId === newGid).map(f => f.id);
    const ungroupOps: CompUndoEntry = [{
      op: 'ungroupFigures', figureIds: looseIds, groupId: newGid, groupName: movedGroup.name,
      savedTranslateX: movedGroup.translateX, savedTranslateY: movedGroup.translateY,
      savedScaleX: movedGroup.scaleX, savedScaleY: movedGroup.scaleY,
      savedRotation: movedGroup.rotation, savedMirrorH: movedGroup.mirrorH, savedMirrorV: movedGroup.mirrorV,
    }];
    state = applyCompOps(state, ungroupOps);

    // Verify ungrouped state.
    expect(state.groups.find(g => g.id === newGid)).toBeUndefined();
    const ungroupedFig = state.figures.find(f => f.id === dupFigId)!;
    expect(ungroupedFig.groupId).toBeUndefined();

    // Now undo everything in reverse.

    // Undo 4: ungroup → group should reappear WITH its transform
    state = revertCompOps(state, ungroupOps);
    const restoredGroup = state.groups.find(g => g.id === newGid);
    expect(restoredGroup).toBeDefined();
    expect(restoredGroup!.mirrorH).toBe(true);
    expect(restoredGroup!.translateX).toBe(movedGroup.translateX);

    // Undo 3: move → group translate should revert to pre-move
    state = revertCompOps(state, moveOps);
    const unmovedGroup = state.groups.find(g => g.id === newGid)!;
    expect(unmovedGroup.translateX).toBe(mirroredGroup.translateX);
    expect(unmovedGroup.mirrorH).toBe(true);

    // Undo 2: mirror → group should be back to identity mirror
    state = revertCompOps(state, mirrorOps);
    const unmirroredGroup = state.groups.find(g => g.id === newGid)!;
    expect(unmirroredGroup.mirrorH).toBe(false);
    // Figure should be back at its duplicated (pre-mirror) position.
    // Test wrapper omits options.offset → 1-cell legacy default.
    const preMirrorFig = state.figures.find(f => f.id === dupFigId)!;
    expect(preMirrorFig.cellX).toBe(4 + 1); // original 4 + offset
    expect(preMirrorFig.cellY).toBe(6 + 1); // original 6 + offset

    // Undo 1: duplicate → back to original single-group state
    state = revertCompOps(state, dupOps);
    expect(state.figures.length).toBe(1);
    expect(state.figures[0].id).toBe('f1');
    expect(state.groups.length).toBe(1);
    expect(state.groups[0].id).toBe('g1');
  });

  test('ungroup with child groups then move child member: undo restores position', () => {
    // Parent group with a non-identity transform and a child group.
    const parent: GroupNode = {
      id: 'parent', name: 'Parent',
      translateX: 10, translateY: 20, scaleX: 2, scaleY: 2,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const child: GroupNode = {
      id: 'child', name: 'Child', parentGroupId: 'parent',
      translateX: 5, translateY: 5, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    // Figure in child group. World = parent(child(local)):
    // child(0,0,2,2) = (5,5,2,2), parent(5,5,2,2) = (10+5*2, 20+5*2, 2*2, 2*2) = (20, 30, 4, 4)
    const fig = makeFigure('f1', {
      cellX: 20, cellY: 30, cellWidth: 4, cellHeight: 4,
      groupId: 'child',
      localCellX: 0, localCellY: 0, localCellWidth: 2, localCellHeight: 2,
      localRotation: 0, localMirrorH: false, localMirrorV: false,
    });
    // Loose member directly in parent.
    const loose = makeFigure('f2', {
      cellX: 14, cellY: 24, groupId: 'parent',
      localCellX: 2, localCellY: 2, localCellWidth: 2, localCellHeight: 2,
      localRotation: 0, localMirrorH: false, localMirrorV: false,
    });
    let state = makeState({
      figures: [fig, loose],
      groups: [parent, child],
    });

    // Ungroup the parent — child becomes a root group, loose is ungrouped.
    const ungroupOps: CompUndoEntry = [{
      op: 'ungroupFigures', figureIds: ['f2'], groupId: 'parent', groupName: 'Parent',
      childGroupIds: ['child'],
      savedTranslateX: parent.translateX, savedTranslateY: parent.translateY,
      savedScaleX: parent.scaleX, savedScaleY: parent.scaleY,
      savedRotation: parent.rotation, savedMirrorH: parent.mirrorH, savedMirrorV: parent.mirrorV,
    }];
    state = applyCompOps(state, ungroupOps);

    // Child is now a root group. Its member (f1) should still be at (20, 30).
    expect(state.groups.find(g => g.id === 'child')!.parentGroupId).toBeUndefined();
    const f1After = state.figures.find(f => f.id === 'f1')!;
    expect(f1After.cellX).toBe(20);
    expect(f1After.cellY).toBe(30);

    // Move the child group by (3, 4).
    const childGroup = state.groups.find(g => g.id === 'child')!;
    const moveOps: CompUndoEntry = [{
      op: 'transformGroup', groupId: 'child',
      oldTranslateX: childGroup.translateX, oldTranslateY: childGroup.translateY,
      oldScaleX: childGroup.scaleX, oldScaleY: childGroup.scaleY,
      oldRotation: childGroup.rotation, oldMirrorH: childGroup.mirrorH, oldMirrorV: childGroup.mirrorV,
      newTranslateX: childGroup.translateX + 3, newTranslateY: childGroup.translateY + 4,
      newScaleX: childGroup.scaleX, newScaleY: childGroup.scaleY,
      newRotation: childGroup.rotation, newMirrorH: childGroup.mirrorH, newMirrorV: childGroup.mirrorV,
    }];
    state = applyCompOps(state, moveOps);

    // After move, f1 should be at (23, 34).
    const f1Moved = state.figures.find(f => f.id === 'f1')!;
    expect(f1Moved.cellX).toBe(23);
    expect(f1Moved.cellY).toBe(34);

    // Undo the move — f1 should return to (20, 30).
    state = revertCompOps(state, moveOps);
    const f1Undone = state.figures.find(f => f.id === 'f1')!;
    expect(f1Undone.cellX).toBe(20);
    expect(f1Undone.cellY).toBe(30);
  });

  test('duplicate preserves shapeKind on rectangle SVGObjects', () => {
    const rect = makeSVGLine('svg_rect', {
      name: 'rectangle',
      shapeKind: 'rectangle',
      segments: [
        { kind: 'line', start: [0, 0], end: [4, 0] },
        { kind: 'line', start: [4, 0], end: [4, 3] },
        { kind: 'line', start: [4, 3], end: [0, 3] },
        { kind: 'line', start: [0, 3], end: [0, 0] },
      ],
    });
    const state = makeState({ svgObjects: [rect] });
    const { ops, newIds } = buildDuplicateOps(state, ['svg_rect']);
    const after = applyCompOps(state, ops);
    const dup = after.svgObjects.find(s => newIds.includes(s.id))!;
    expect(dup).toBeDefined();
    expect(dup.shapeKind).toBe('rectangle');
    // name gets ' copy' appended, but shapeKind is unaffected
    expect(dup.name).toBe('rectangle copy');
  });
});

describe('computeDuplicateOffset is zoom-relative and grid-independent', () => {
  // The offset is sized so the duplicate lands ~1% of the viewport width
  // away from the original on screen. In L0 cells that works out to
  // 0.01 * 32 / zoom = 0.32 / zoom, independent of both viewport width
  // and gridLevel.
  const make = (zoom: number, viewportWidth: number, gridLevel = 0) => makeState({
    camera: { offsetX: 0, offsetY: 0, zoom },
    viewport: makeViewport(viewportWidth, 600),
    gridLevel: gridLevel as 0,
  });

  test('inverse-proportional to camera zoom', () => {
    expect(computeDuplicateOffset(make(1, 800))).toBeCloseTo(0.32, 9);
    expect(computeDuplicateOffset(make(2, 800))).toBeCloseTo(0.16, 9);
    expect(computeDuplicateOffset(make(0.5, 800))).toBeCloseTo(0.64, 9);
  });

  test('independent of viewport width at the same zoom', () => {
    const a = computeDuplicateOffset(make(1, 400));
    const b = computeDuplicateOffset(make(1, 1024));
    const c = computeDuplicateOffset(make(1, 1600));
    expect(a).toBeCloseTo(b, 9);
    expect(b).toBeCloseTo(c, 9);
  });

  test('independent of gridLevel', () => {
    const a = computeDuplicateOffset(make(1, 800, 0));
    const b = computeDuplicateOffset(make(1, 800, 3));
    const c = computeDuplicateOffset(make(1, 800, 6));
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  test('falls back to 1 for degenerate camera/viewport', () => {
    expect(computeDuplicateOffset(make(0, 800))).toBe(1);
    expect(computeDuplicateOffset(make(1, 0))).toBe(1);
  });
});
