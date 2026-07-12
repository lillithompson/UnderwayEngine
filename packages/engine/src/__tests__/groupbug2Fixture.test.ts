/**
 * Regression: marquee-grouping in a deeply-nested-group composition must
 * pull in EVERY descendant of the root group, not only the descendants
 * whose immediate `groupId` happens to be among the hits. Before the fix,
 * `handleSelectRegion`'s expansion keyed off the immediate `groupId` of
 * each AABB hit, so descendants in untouched nested sub-groups were
 * silently excluded — pressing Group then left them behind in the old
 * hierarchy. See test_data/groupbug2.tile for the user-reported repro.
 */

import * as fs from 'fs';
import * as zlib from 'zlib';
import * as path from 'path';

import { deserializeComposition } from '../compositionBinaryFormat';
import {
  applyCompOps,
  expandIdsToGroups,
  allDescendantMemberIds,
  findRootGroupId,
} from '../compositionOps';
import { CompositionState, CompUndoEntry, makeViewport } from '../types';

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

describe('groupbug2.tile: partial marquee + Group preserves nested-group members', () => {
  const ROOT_GROUP_ID = '1778514698956_g';   // GroupA
  const NESTED_HIDDEN = '1778500100459_g';   // sub-group whose members sit outside the partial region
  const OBJECT_B = 'svg_1778499603556_u';    // the ungrouped scene object

  function loadFixture(): CompositionState {
    const tilePath = path.join(__dirname, '../../test_data/groupbug2.tile');
    const data = new Uint8Array(fs.readFileSync(tilePath));
    const decompressed = zlib.inflateSync(data);
    const { meta } = deserializeComposition(decompressed);
    return makeState({
      figures: meta.figures,
      svgObjects: meta.svgObjects ?? [],
      images: meta.images ?? [],
      groups: meta.groups ?? [],
      sceneOrder: meta.sceneOrder,
      gridLevel: meta.gridLevel,
    });
  }

  // AABB hit-test mirroring handleSelectRegion's svg pass. Returns ids of
  // svgObjects whose segment-bbox intersects the rectangle.
  function svgsIntersectingRegion(
    state: CompositionState,
    rMinX: number, rMinY: number, rMaxX: number, rMaxY: number,
  ): string[] {
    const hits: string[] = [];
    for (const svg of state.svgObjects) {
      const segs = svg.segments ?? [];
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const seg of segs) {
        const pts = (seg as { kind?: string }).kind === 'arc'
          ? [(seg as { start: [number, number] }).start,
             (seg as { end: [number, number] }).end,
             (seg as { center: [number, number] }).center]
          : [(seg as { start: [number, number] }).start,
             (seg as { end: [number, number] }).end];
        for (const [x, y] of pts) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
      if (!Number.isFinite(minX)) continue;
      if (minX < rMaxX && maxX > rMinX && minY < rMaxY && maxY > rMinY) {
        hits.push(svg.id);
      }
    }
    return hits;
  }

  test('fixture has the expected GroupA structure', () => {
    const state = loadFixture();
    const allRootDescendants = allDescendantMemberIds(state, ROOT_GROUP_ID);
    // 32 svgs in the GroupA tree (28 direct + 2 + 2 in nested sub-groups).
    expect(allRootDescendants.length).toBe(32);
    // ObjectB exists and is ungrouped.
    const objectB = state.svgObjects.find(s => s.id === OBJECT_B);
    expect(objectB).toBeDefined();
    expect(objectB!.groupId).toBeUndefined();
  });

  test('partial marquee misses one nested sub-group entirely', () => {
    const state = loadFixture();
    // Region in fixture coord space. Y is positive-up in storage, so the
    // user's screen-space (-29,84)→(84,4) maps to (-29,-84)→(84,-4) here.
    const hits = svgsIntersectingRegion(state, -29, -84, 84, -4);

    // ObjectB is inside the marquee.
    expect(hits).toContain(OBJECT_B);
    // Some root-direct members were hit.
    const directlyHit = hits.filter(id => {
      const s = state.svgObjects.find(o => o.id === id);
      return s?.groupId === ROOT_GROUP_ID;
    });
    expect(directlyHit.length).toBeGreaterThan(0);
    // The nested sub-group at x≈(96..100) is completely OUTSIDE the marquee,
    // so none of its members are hit by AABB. This is what reproduces the bug.
    const nestedHidden = state.svgObjects.filter(s => s.groupId === NESTED_HIDDEN).map(s => s.id);
    for (const id of nestedHidden) expect(hits).not.toContain(id);

    // And the hit set is strictly smaller than the full root tree.
    expect(hits.length).toBeLessThan(32 + 1);
  });

  test('expandIdsToGroups pulls in every descendant of the root group', () => {
    const state = loadFixture();
    const hits = svgsIntersectingRegion(state, -29, -84, 84, -4);
    const expanded = expandIdsToGroups(state, hits);

    // Everything in the GroupA tree must be present — including members of
    // the nested sub-group the marquee missed.
    const allRootDescendants = allDescendantMemberIds(state, ROOT_GROUP_ID);
    for (const id of allRootDescendants) expect(expanded).toContain(id);
    // ObjectB stays in too.
    expect(expanded).toContain(OBJECT_B);
    // Size matches root tree + the one ungrouped object.
    expect(expanded.length).toBe(allRootDescendants.length + 1);
  });

  test('groupFigures op with the expanded selection nests GroupA + ObjectB intact', () => {
    const state = loadFixture();
    const hits = svgsIntersectingRegion(state, -29, -84, 84, -4);
    const expanded = expandIdsToGroups(state, hits);

    // Replicate handleGroup's bucketing: every expanded id whose root group
    // is fully covered → that root becomes a childGroupId; everything else
    // is a loose figureId.
    const rootGroupCounts = new Map<string, number>();
    for (const id of expanded) {
      const item = state.svgObjects.find(s => s.id === id)
        ?? state.figures.find(f => f.id === id)
        ?? state.images!.find(i => i.id === id);
      const gid = item?.groupId;
      if (!gid) continue;
      const root = findRootGroupId(state.groups, gid);
      rootGroupCounts.set(root, (rootGroupCounts.get(root) ?? 0) + 1);
    }
    const childGroupIds: string[] = [];
    const childGroupMemberSet = new Set<string>();
    for (const [rootGid, count] of rootGroupCounts) {
      const total = allDescendantMemberIds(state, rootGid).length;
      if (count === total) {
        childGroupIds.push(rootGid);
        for (const m of allDescendantMemberIds(state, rootGid)) childGroupMemberSet.add(m);
      }
    }
    const figureIds = expanded.filter(id => !childGroupMemberSet.has(id));

    // The whole point of the fix: GroupA's root is fully represented, so
    // it must collapse into a single childGroupId — not be picked apart.
    expect(childGroupIds).toEqual([ROOT_GROUP_ID]);
    expect(figureIds).toEqual([OBJECT_B]);

    // Apply the op and verify the resulting hierarchy.
    const outerId = 'outer_test_g';
    const op: CompUndoEntry = [{
      op: 'groupFigures',
      figureIds,
      groupId: outerId,
      groupName: 'Outer',
      oldNames: figureIds.map(id => state.svgObjects.find(s => s.id === id)?.name),
      childGroupIds,
    }];
    const next = applyCompOps(state, op);

    // New outer group exists at the top.
    const outer = next.groups.find(g => g.id === outerId)!;
    expect(outer).toBeDefined();
    expect(outer.parentGroupId).toBeUndefined();

    // GroupA is now parented to the outer group.
    const root = next.groups.find(g => g.id === ROOT_GROUP_ID)!;
    expect(root.parentGroupId).toBe(outerId);

    // ObjectB joined the outer group as a direct member.
    expect(next.svgObjects.find(s => s.id === OBJECT_B)!.groupId).toBe(outerId);

    // Every original GroupA descendant still resolves to GroupA's root,
    // which now resolves up to the new outer group.
    const rootTreeMembers = allDescendantMemberIds(next, outerId);
    expect(rootTreeMembers).toHaveLength(32 + 1);  // 32 GroupA descendants + ObjectB
    for (const id of allDescendantMemberIds(state, ROOT_GROUP_ID)) {
      expect(rootTreeMembers).toContain(id);
    }
  });
});
