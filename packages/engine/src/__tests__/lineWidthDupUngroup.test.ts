/**
 * Regression: duplicate a group containing H/V lines, then ungroup the
 * copy.  The original's creationBox (and thus selection bbox) should be
 * correct, but the copy's was wrong because cloneWithOffset drops
 * creationBox when the target group changes — so ungroupCreationBox
 * receives creationBox === undefined and returns undefined, leaving the
 * selection overlay to fall back to the zero-height/width segment AABB.
 */

import { deserializeComposition } from '../compositionBinaryFormat';
import {
  applyCompOps,
  SCENE_ADAPTERS,
  findItem,
  allDescendantMemberIds,
} from '../compositionOps';
import {
  CompositionState,
  SVGObject,
  GroupNode,
  CompUndoEntry,
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
    sceneOrder: [
      ...images.map(i => i.id),
      ...figures.map(f => f.id),
      ...svgObjects.map(s => s.id),
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

/** Mirror the duplicate helper from compositionOpsDuplicate.test.ts but
 *  keep it self-contained so this file runs independently. */
function buildDuplicateOps(state: CompositionState, selectedIds: string[]): {
  ops: CompUndoEntry;
  groupIdMap: Map<string, string>;
} {
  const ops: CompUndoEntry = [];
  const groupIdMap = new Map<string, string>();
  const newGroupMembers = new Map<string, string[]>();
  const newGroupOldNames = new Map<string, (string | undefined)[]>();
  let mint = 0;

  for (const id of selectedIds) {
    const ref = findItem(state, id);
    if (!ref) continue;
    const adapter = SCENE_ADAPTERS.find(a => a.kind === ref.kind);
    if (!adapter) continue;
    const origGroupId = ref.item.groupId;
    let newGroupId: string | undefined;
    if (origGroupId) {
      newGroupId = groupIdMap.get(origGroupId);
      if (!newGroupId) {
        newGroupId = origGroupId + '_dup';
        groupIdMap.set(origGroupId, newGroupId);
        newGroupMembers.set(newGroupId, []);
        newGroupOldNames.set(newGroupId, []);
      }
    }
    const baseId = ref.kind === 'svg' ? 'svg_' : ref.kind === 'image' ? 'img_' : '';
    const newId = `${baseId}dup_${mint++}_${ref.item.id}`;
    const dup = adapter.cloneWithOffset(ref.item, 1, 1, newId, newGroupId);
    ops.push({ op: 'placeObject', kind: ref.kind, item: adapter.cloneItem(dup) as any });
    if (newGroupId) {
      newGroupMembers.get(newGroupId)!.push(dup.id);
      newGroupOldNames.get(newGroupId)!.push(dup.name);
    }
  }

  // Replicate hierarchy (same logic as handlePropsDuplicate).
  const newChildGroupIds = new Map<string, string[]>();
  for (const [origGroupId] of groupIdMap) {
    const origGroup = state.groups.find(g => g.id === origGroupId);
    if (!origGroup?.parentGroupId) continue;
    const newParentId = groupIdMap.get(origGroup.parentGroupId);
    if (!newParentId) continue;
    if (!newChildGroupIds.has(newParentId)) newChildGroupIds.set(newParentId, []);
    newChildGroupIds.get(newParentId)!.push(groupIdMap.get(origGroupId)!);
  }
  const emitted = new Set<string>();
  while (emitted.size < groupIdMap.size) {
    let progress = false;
    for (const [origGroupId, newGroupId] of groupIdMap) {
      if (emitted.has(newGroupId)) continue;
      const children = newChildGroupIds.get(newGroupId) ?? [];
      if (!children.every(c => emitted.has(c))) continue;
      const memberIds = newGroupMembers.get(newGroupId)!;
      if (memberIds.length === 0 && children.length === 0) { emitted.add(newGroupId); progress = true; continue; }
      const origGroup = state.groups.find(g => g.id === origGroupId);
      ops.push({
        op: 'groupFigures',
        figureIds: memberIds,
        groupId: newGroupId,
        groupName: (origGroup?.name ?? 'Group') + ' copy',
        oldNames: newGroupOldNames.get(newGroupId)!,
        ...(children.length > 0 ? { childGroupIds: children } : null),
      });
      emitted.add(newGroupId);
      progress = true;
    }
    if (!progress) break;
  }

  return { ops, groupIdMap };
}

describe('duplicate then ungroup preserves H/V line creationBox', () => {
  test('synthetic: horizontal line duplicate gets valid creationBox after ungroup', () => {
    const group: GroupNode = {
      id: 'g1', name: 'G',
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const hLine: SVGObject = {
      id: 'svg_h', groupId: 'g1',
      segments: [{ kind: 'line', start: [0, 4], end: [10, 4] }],
      localSegments: [{ kind: 'line', start: [0, 4], end: [10, 4] }],
      color: { r: 0, g: 0, b: 0 },
      cellX: 0, cellY: 4, cellWidth: 10, cellHeight: 0,
      localCellX: 0, localCellY: 4, localCellWidth: 10, localCellHeight: 0,
      creationBox: { minX: 0, minY: 3.5, width: 10, height: 1 },
      lineDirection: 'horizontal',
    };
    const state = makeState({ svgObjects: [hLine], groups: [group] });

    // Duplicate
    const { ops: dupOps, groupIdMap } = buildDuplicateOps(state, ['svg_h']);
    const afterDup = applyCompOps(state, dupOps);
    const newGid = groupIdMap.get('g1')!;

    // The duplicate's SVG should have a creationBox (groupFigures
    // re-seeds it from segments for H/V lines via the identity group).
    const dupSvg = afterDup.svgObjects.find(s => s.groupId === newGid)!;

    // Ungroup the duplicate
    const looseIds = afterDup.svgObjects.filter(s => s.groupId === newGid).map(s => s.id);
    const ungroupOps: CompUndoEntry = [{
      op: 'ungroupFigures', figureIds: looseIds, groupId: newGid,
      groupName: 'G copy',
    }];
    const afterUngroup = applyCompOps(afterDup, ungroupOps);
    const result = afterUngroup.svgObjects.find(s => s.id === dupSvg.id)!;

    // The ungrouped line must have a creationBox with height ≥ 1 step.
    expect(result.creationBox).toBeDefined();
    expect(result.creationBox!.width).toBeGreaterThanOrEqual(1);
    expect(result.creationBox!.height).toBeGreaterThanOrEqual(1);
  });

  test('line_width_bug.tile: duplicate then ungroup preserves selection width', () => {
    const fs = require('fs');
    const zlib = require('zlib');
    const path = require('path');
    const tilePath = path.join(__dirname, '../../test_data/line_width_bug.tile');
    if (!fs.existsSync(tilePath)) { console.log('skipped — file not present'); return; }

    const data = new Uint8Array(fs.readFileSync(tilePath));
    const decompressed = zlib.inflateSync(data);
    const { meta } = deserializeComposition(decompressed);

    const state = makeState({
      figures: meta.figures,
      svgObjects: meta.svgObjects ?? [],
      images: meta.images ?? [],
      groups: meta.groups ?? [],
      sceneOrder: meta.sceneOrder ?? [],
    });

    // Find the single root group.
    const rootGroup = state.groups.find(g => !g.parentGroupId)!;
    const allIds = allDescendantMemberIds(state, rootGroup.id);

    // Ungroup the original — capture the creationBoxes as the reference.
    const directIds = [
      ...state.svgObjects.filter(s => s.groupId === rootGroup.id).map(s => s.id),
      ...state.figures.filter(f => f.groupId === rootGroup.id).map(f => f.id),
      ...(state.images ?? []).filter(i => i.groupId === rootGroup.id).map(i => i.id),
    ];
    const childGroupIds = state.groups.filter(g => g.parentGroupId === rootGroup.id).map(g => g.id);
    const origUngrouped = applyCompOps(state, [{
      op: 'ungroupFigures', figureIds: directIds, groupId: rootGroup.id,
      groupName: rootGroup.name,
      childGroupIds: childGroupIds.length > 0 ? childGroupIds : undefined,
    }]);
    const origBoxes = new Map<string, typeof origUngrouped.svgObjects[0]['creationBox']>();
    for (const s of origUngrouped.svgObjects) {
      if (!s.lineDirection) continue; // only H/V lines
      origBoxes.set(s.id, s.creationBox);
    }

    // Now duplicate then ungroup the copy.
    const { ops: dupOps, groupIdMap } = buildDuplicateOps(state, allIds);
    const afterDup = applyCompOps(state, dupOps);
    const newRootId = groupIdMap.get(rootGroup.id)!;
    const dupDirectIds = [
      ...afterDup.svgObjects.filter(s => s.groupId === newRootId).map(s => s.id),
      ...afterDup.figures.filter(f => f.groupId === newRootId).map(f => f.id),
      ...(afterDup.images ?? []).filter(i => i.groupId === newRootId).map(i => i.id),
    ];
    const dupChildGroupIds = afterDup.groups.filter(g => g.parentGroupId === newRootId).map(g => g.id);
    const dupUngrouped = applyCompOps(afterDup, [{
      op: 'ungroupFigures', figureIds: dupDirectIds, groupId: newRootId,
      groupName: 'copy',
      childGroupIds: dupChildGroupIds.length > 0 ? dupChildGroupIds : undefined,
    }]);

    // Every H/V line in the copy must have a creationBox with the same
    // dimensions (width/height) as the original — not zero or undefined.
    for (const s of dupUngrouped.svgObjects) {
      if (!s.lineDirection) continue;
      if (origBoxes.has(s.id)) continue; // skip originals
      expect(s.creationBox).toBeDefined();
      expect(s.creationBox!.width).toBeGreaterThanOrEqual(1);
      expect(s.creationBox!.height).toBeGreaterThanOrEqual(1);
    }
  });
});
