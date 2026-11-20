import fs from 'fs';
import path from 'path';
import { makeBlankComposition } from '@/editor/blankComposition';
import type { CompositionState } from '@/engine/types';
import { applyCompOps } from '@/engine/compositionOps';
import { matApplyPoint } from '@/engine/sceneTransform';
import type { OutlineObject } from '@/editor-ui/adapter';
import { collapsedGroups, computeOutlineTree, flattenTree, treeToSceneOrder } from '@/editor-ui/logic/outlineTree';
import {
  type HostGroup, type HostItem, type HostItems, type HostOps, clearSessionHost, installSessionHost,
} from '../sessionHost';
import { clearOutlineHost, installOutlineHost } from '../outlineHost';
import { buildOutlineObjects, outlineSelectedIds } from '../sceneOutlineModel';
import {
  type SessionEntry, buildDuplicateSelectedMulti, buildGroupSelectedMulti, buildMoveNodes, buildPlaceShape,
  buildRemoveSelectedMulti, buildRenameGroup, buildReparent, buildToggleLockGroup, buildToggleLockMulti,
  buildUngroupSelectedMulti, commitEntry, createEditorSession, groupSelectionMemberIds, hostGroupChain,
  hostGroupIds, hostGroupsKept, isHostGroupId, isHostItemLocked, isMultiSelectionLocked, select,
  selectionUnitIds, undo, wholeUnitOfSelection, withHostChange,
} from '../editorSession';

// A GROUP OF THE HOST'S ITEMS ALONE (sessionHost.ts `HostGroup`;
// docs/shared-editor.md §4.1): no scene node stands for it, so the host's
// document keeps what a group is — a name, what it sits in, a lock — and
// every rule a scene group has is the session's to keep for it too. A
// made-up app again: PINS, each a point with a one-cell box, in a document
// that is swapped whole by an undo step.

interface Pin extends HostItem { x: number; y: number }
interface Doc { pins: Pin[]; groups?: readonly HostGroup[] }
interface Op { before: Doc; after: Doc }

const OPS: HostOps<Doc, Op> = { apply: (_doc, op) => op.after, revert: (_doc, op) => op.before };

const ITEMS: HostItems<Doc, Op> = {
  isHostId: (id) => id.startsWith('pin_'),
  itemById: (doc, id) => doc.pins.find((p) => p.id === id) ?? null,
  items: (doc) => doc.pins,
  box: (doc, id) => {
    const p = doc.pins.find((k) => k.id === id);
    return p ? { cellX: p.x - 0.5, cellY: p.y - 0.5, cellWidth: 1, cellHeight: 1 } : null;
  },
  through: (doc, ids, m) => ({
    ...doc,
    pins: doc.pins.map((p) => {
      if (!ids.has(p.id)) return p;
      const [x, y] = matApplyPoint(m, p.x, p.y);
      return { ...p, x, y };
    }),
  }),
  remove: (doc, ids) => ({ ...doc, pins: doc.pins.filter((p) => !ids.has(p.id)) }),
  setGroup: (doc, ids, groupId) => ({
    ...doc,
    pins: doc.pins.map((p) => {
      if (!ids.has(p.id)) return p;
      const { groupId: _was, ...rest } = p;
      return groupId === undefined ? rest : { ...rest, groupId };
    }),
  }),
  groups: (doc) => doc.groups ?? [],
  setGroups: (doc, groups) => {
    const { groups: _was, ...rest } = doc;
    return groups.length === 0 ? rest : { ...rest, groups };
  },
  setLocked: (doc, ids, locked) => ({
    ...doc, pins: doc.pins.map((p) => (ids.has(p.id) ? { ...p, locked } : p)),
  }),
  duplicate: (doc, ids, offset, groupCopyOf) => {
    const copies = doc.pins.filter((p) => ids.includes(p.id)).map((p) => {
      const { groupId: _was, ...rest } = p;
      const groupId = groupCopyOf(p.groupId);
      return { ...rest, id: `${p.id}_copy`, x: p.x + offset, y: p.y + offset, ...(groupId ? { groupId } : null) };
    });
    return { doc: { ...doc, pins: [...doc.pins, ...copies] }, ids: copies.map((c) => c.id) };
  },
  change: (before, after) => ({ before, after }),
};

/** The pins as outline rows, and each group of them alone as a row of
 *  kind 'group' ranked with the front-most row in it — what DrawBot's
 *  outline host does for its bots and tiles. */
const OUTLINE = {
  overlays(state: CompositionState, doc: Doc | undefined): OutlineObject[] {
    if (!doc) return [];
    const session = { state, hostDoc: doc };
    const rank = new Map<string, number>();
    const rows: OutlineObject[] = doc.pins.map((p, i) => {
      for (const id of hostGroupChain(session, p.groupId).hostIds) rank.set(id, Math.max(rank.get(id) ?? i, i));
      return { id: p.id, kind: 'pin', name: p.id, parentGroupId: p.groupId, locked: !!p.locked, hidden: false, overlayRank: i };
    });
    for (const [id, overlayRank] of rank) {
      const record = doc.groups?.find((g) => g.id === id);
      rows.push({
        id, kind: 'group', name: record?.name ?? 'Group', parentGroupId: record?.parentGroupId,
        locked: !!record?.locked, hidden: false, overlayRank,
      });
    }
    return rows;
  },
};

type S = ReturnType<typeof newSession>;
const pin = (id: string, x: number, y: number, extra: Partial<Pin> = {}): Pin => ({ id, x, y, ...extra });
function newSession(doc: Doc) {
  return createEditorSession<string, Doc, Op>(makeBlankComposition('host-groups'), 'arrange', doc);
}
function placeRect(session: S, x: number, y: number): [S, string] {
  const se = buildPlaceShape('rect', { cellX: x, cellY: y, cellWidth: 4, cellHeight: 4 }, { r: 0, g: 0, b: 0 });
  return [commitEntry(session, se), se.id!];
}
const apply = (s: S, se: SessionEntry | null): S => {
  expect(se).not.toBeNull();
  return commitEntry(s, se!);
};
/** Commit as a host does where every edit passes: with the groups the
 *  entry emptied of scene nodes kept for the items still in them. */
const applyKeeping = (s: S, se: SessionEntry | null): S => {
  expect(se).not.toBeNull();
  const after = se!.hostOps ? (se!.hostOps as Op).after : s.hostDoc;
  const kept = hostGroupsKept(s.state, applyCompOps(s.state, se!.entry), after);
  if (!kept) return commitEntry(s, se!);
  return commitEntry(s, withHostChange({ ...se!, entry: [...se!.entry, ...kept.ops] }, s.hostDoc, kept.hostDoc)!);
};
const groupOf = (s: S, id: string) => s.hostDoc.pins.find((p) => p.id === id)?.groupId;
const record = (s: S, id: string | undefined) => s.hostDoc.groups?.find((g) => g.id === id);
const group = (s: S, ids: string[]): S => apply(s, buildGroupSelectedMulti(s.state, ids, s.hostDoc));

/** Three loose pins. */
const three = () => newSession({ pins: [pin('pin_a', 1, 1), pin('pin_b', 3, 1), pin('pin_c', 5, 1)] });

beforeEach(() => { clearSessionHost(); clearOutlineHost(); installSessionHost({ ops: OPS, items: ITEMS }); installOutlineHost(OUTLINE); });
afterEach(() => { clearSessionHost(); clearOutlineHost(); });

describe('a group of host items alone', () => {
  test('is the id its members share and a record in the host document, named as a scene group is', () => {
    const s = group(three(), ['pin_a', 'pin_b']);
    const gid = groupOf(s, 'pin_a')!;
    expect(groupOf(s, 'pin_b')).toBe(gid);
    expect(s.state.groups).toHaveLength(0);
    expect(record(s, gid)).toEqual({ id: gid, name: 'Group 1' });
    expect(isHostGroupId(s, gid)).toBe(true);
    expect([...hostGroupIds(s)]).toEqual([gid]);
    // The next is numbered past it, whichever kind it turns out to be.
    const [withRect, rect] = placeRect(s, 20, 20);
    const mixed = group(withRect, [rect, 'pin_c']);
    expect(mixed.state.groups[0].name).toBe('Group 2');
    // One undo takes the group and its record together.
    expect(undo(s).hostDoc).toEqual(three().hostDoc);
  });

  test('a group with no record is a group all the same: a document written before the records', () => {
    const s = newSession({ pins: [pin('pin_a', 1, 1, { groupId: 'old' }), pin('pin_b', 3, 1, { groupId: 'old' })] });
    expect(isHostGroupId(s, 'old')).toBe(true);
    expect(selectionUnitIds(s, 'pin_a')).toEqual(['pin_a', 'pin_b']);
    expect(buildOutlineObjects(s.state, undefined, s.hostDoc).get('old')).toMatchObject({ kind: 'group', name: 'Group' });
    // Its first rename is what gives it a record.
    const named = apply(s, buildRenameGroup(s.state, 'old', 'Pair', s.hostDoc));
    expect(record(named, 'old')).toEqual({ id: 'old', name: 'Pair' });
  });

  test('a record nothing is in names no group', () => {
    const s = newSession({ pins: [pin('pin_a', 1, 1)], groups: [{ id: 'gone', name: 'Was' }] });
    expect(isHostGroupId(s, 'gone')).toBe(false);
    expect(buildOutlineObjects(s.state, undefined, s.hostDoc).has('gone')).toBe(false);
    expect(buildRenameGroup(s.state, 'gone', 'X', s.hostDoc)).toBeNull();
  });

  test('renames by its record; an empty name leaves the one it has', () => {
    const s = group(three(), ['pin_a', 'pin_b']);
    const gid = groupOf(s, 'pin_a')!;
    const named = apply(s, buildRenameGroup(s.state, gid, '  Left pair ', s.hostDoc));
    expect(record(named, gid)?.name).toBe('Left pair');
    expect(buildRenameGroup(named.state, gid, 'Left pair', named.hostDoc)).toBeNull();
    expect(buildRenameGroup(named.state, gid, '   ', named.hostDoc)).toBeNull();
    expect(record(undo(named), gid)?.name).toBe('Group 1');
    // With no document handed in there is no such group to rename.
    expect(buildRenameGroup(named.state, gid, 'X')).toBeNull();
  });

  test('locks as a scene group does: its own flag, which its members inherit', () => {
    const s = group(three(), ['pin_a', 'pin_b']);
    const gid = groupOf(s, 'pin_a')!;
    const locked = apply(s, buildToggleLockGroup(s.state, gid, s.hostDoc));
    expect(record(locked, gid)?.locked).toBe(true);
    expect(locked.hostDoc.pins.every((p) => !p.locked)).toBe(true);
    expect(isHostItemLocked(locked, 'pin_a')).toBe(true);
    expect(isHostItemLocked(locked, 'pin_c')).toBe(false);
    expect(isMultiSelectionLocked(locked.state, ['pin_a', 'pin_b'], locked.hostDoc)).toBe(true);
    // Held: a move leaves them, a delete leaves them, an ungroup is refused.
    expect(buildMoveNodes(locked.state, ['pin_a', 'pin_b'], 2, 0, locked.hostDoc)).toBeNull();
    expect(buildRemoveSelectedMulti(locked.state, ['pin_a', 'pin_b'], locked.hostDoc)).toBeNull();
    expect(buildUngroupSelectedMulti(locked.state, ['pin_a', 'pin_b'], locked.hostDoc)).toBeNull();
    // The panel's Lock on the whole unit is the group's lock, not each member's.
    const freed = apply(locked, buildToggleLockMulti(locked.state, ['pin_a', 'pin_b'], locked.hostDoc));
    expect(record(freed, gid)?.locked).toBeUndefined();
    expect(freed.hostDoc.pins.every((p) => !p.locked)).toBe(true);
    expect(isHostItemLocked(freed, 'pin_a')).toBe(false);
  });

  test('ungroup frees its members and drops its record', () => {
    const s = select(group(three(), ['pin_a', 'pin_b']), 'pin_a');
    expect(s.selectedIds).toEqual(['pin_a', 'pin_b']);
    const loose = apply(s, buildUngroupSelectedMulti(s.state, s.selectedIds, s.hostDoc));
    expect(loose.hostDoc).toEqual(three().hostDoc);
  });
});

describe('nesting', () => {
  test('a group selected whole nests in the new one as a child, its members left on it', () => {
    const inner = group(three(), ['pin_a', 'pin_b']);
    const innerId = groupOf(inner, 'pin_a')!;
    const outer = group(inner, ['pin_a', 'pin_b', 'pin_c']);
    const outerId = groupOf(outer, 'pin_c')!;
    expect(outerId).not.toBe(innerId);
    expect(groupOf(outer, 'pin_a')).toBe(innerId);
    expect(record(outer, innerId)).toEqual({ id: innerId, name: 'Group 1', parentGroupId: outerId });
    expect(record(outer, outerId)).toEqual({ id: outerId, name: 'Group 2' });
    expect(hostGroupChain(outer, innerId)).toEqual({ hostIds: [innerId, outerId], sceneId: null, locked: false });
    // One unit: a tap on any of the three takes all three.
    expect(selectionUnitIds(outer, 'pin_a')).toEqual(['pin_a', 'pin_b', 'pin_c']);
    expect(wholeUnitOfSelection(outer, ['pin_a', 'pin_b', 'pin_c'])).toBe(outerId);
    // The inner group's row takes its own two.
    expect(groupSelectionMemberIds(outer, innerId)).toEqual(['pin_a', 'pin_b']);
    expect(groupSelectionMemberIds(outer, outerId)).toEqual(['pin_a', 'pin_b', 'pin_c']);
  });

  test('ungrouping the outer one leaves the inner group whole and loose', () => {
    const outer = group(group(three(), ['pin_a', 'pin_b']), ['pin_a', 'pin_b', 'pin_c']);
    const innerId = groupOf(outer, 'pin_a')!;
    const loose = apply(outer, buildUngroupSelectedMulti(outer.state, ['pin_a', 'pin_b', 'pin_c'], outer.hostDoc));
    expect(groupOf(loose, 'pin_c')).toBeUndefined();
    expect(groupOf(loose, 'pin_a')).toBe(innerId);
    expect(loose.hostDoc.groups).toEqual([{ id: innerId, name: 'Group 1' }]);
    expect(selectionUnitIds(loose, 'pin_a')).toEqual(['pin_a', 'pin_b']);
  });

  test('a group picked in part gives up the members picked', () => {
    const s = group(three(), ['pin_a', 'pin_b']);
    const innerId = groupOf(s, 'pin_a')!;
    const next = group(s, ['pin_b', 'pin_c']);
    expect(groupOf(next, 'pin_a')).toBe(innerId);
    expect(groupOf(next, 'pin_b')).toBe(groupOf(next, 'pin_c'));
    expect(groupOf(next, 'pin_b')).not.toBe(innerId);
    expect(record(next, innerId)?.parentGroupId).toBeUndefined();
  });

  test('grouped with a shape, it nests in the scene group, which then carries its members', () => {
    const [withRect, rect] = placeRect(group(three(), ['pin_a', 'pin_b']), 20, 20);
    const innerId = groupOf(withRect, 'pin_a')!;
    const s = group(withRect, [rect, 'pin_a', 'pin_b']);
    const sceneId = s.state.groups[0].id;
    expect(groupOf(s, 'pin_a')).toBe(innerId);
    expect(record(s, innerId)?.parentGroupId).toBe(sceneId);
    expect(hostGroupChain(s, innerId)).toEqual({ hostIds: [innerId], sceneId, locked: false });
    expect(selectionUnitIds(s, 'pin_a')).toEqual([rect, 'pin_a', 'pin_b']);
    expect(groupSelectionMemberIds(s, sceneId)).toEqual([rect, 'pin_a', 'pin_b']);
    // The scene group carries them: the session's own move leaves them to
    // the host's follow, so they are not moved twice.
    const moved = buildMoveNodes(s.state, [rect, 'pin_a', 'pin_b'], 2, 0, s.hostDoc)!;
    expect(moved.entry.length).toBeGreaterThan(0);
    expect(moved.hostOps).toBeUndefined();
    // The scene group's lock holds them.
    const locked = apply(s, buildToggleLockMulti(s.state, [rect, 'pin_a', 'pin_b'], s.hostDoc));
    expect(locked.state.groups[0].locked).toBe(true);
    expect(isHostItemLocked(locked, 'pin_a')).toBe(true);
    // Ungrouping the scene group leaves the inner one whole and loose.
    const loose = apply(s, buildUngroupSelectedMulti(s.state, [rect, 'pin_a', 'pin_b'], s.hostDoc));
    expect(loose.state.groups).toHaveLength(0);
    expect(record(loose, innerId)).toEqual({ id: innerId, name: 'Group 1' });
    expect(groupOf(loose, 'pin_a')).toBe(innerId);
  });

  test('a locked group sits out of a new one whole', () => {
    const s = group(three(), ['pin_a', 'pin_b']);
    const locked = apply(s, buildToggleLockGroup(s.state, groupOf(s, 'pin_a')!, s.hostDoc));
    expect(buildGroupSelectedMulti(locked.state, ['pin_a', 'pin_b', 'pin_c'], locked.hostDoc)).toBeNull();
  });

  test('a chain that loops ends where it would repeat', () => {
    const s = newSession({
      pins: [pin('pin_a', 1, 1, { groupId: 'g1' })],
      groups: [{ id: 'g1', parentGroupId: 'g2' }, { id: 'g2', parentGroupId: 'g1' }],
    });
    expect(hostGroupChain(s, 'g1').hostIds).toEqual(['g1', 'g2']);
  });
});

describe('duplicating', () => {
  test('a group copied whole comes out as a group, named as a copy', () => {
    const s = group(three(), ['pin_a', 'pin_b']);
    const gid = groupOf(s, 'pin_a')!;
    const dup = apply(s, buildDuplicateSelectedMulti(s.state, ['pin_a', 'pin_b'], s.hostDoc));
    const copyId = groupOf(dup, 'pin_a_copy')!;
    expect(copyId).not.toBe(gid);
    expect(groupOf(dup, 'pin_b_copy')).toBe(copyId);
    expect(record(dup, copyId)).toEqual({ id: copyId, name: 'Group 1 copy' });
    expect(dup.selectedIds).toEqual(['pin_a_copy', 'pin_b_copy']);
  });

  test('a nest copied whole keeps its shape; a child copied alone stands at the top level', () => {
    const outer = group(group(three(), ['pin_a', 'pin_b']), ['pin_a', 'pin_b', 'pin_c']);
    const innerId = groupOf(outer, 'pin_a')!;
    const outerId = groupOf(outer, 'pin_c')!;
    const whole = apply(outer, buildDuplicateSelectedMulti(outer.state, ['pin_a', 'pin_b', 'pin_c'], outer.hostDoc));
    const innerCopy = groupOf(whole, 'pin_a_copy')!;
    const outerCopy = groupOf(whole, 'pin_c_copy')!;
    expect(record(whole, innerCopy)).toEqual({ id: innerCopy, name: 'Group 1 copy', parentGroupId: outerCopy });
    expect(record(whole, outerCopy)).toEqual({ id: outerCopy, name: 'Group 2 copy' });
    expect(new Set([innerId, outerId, innerCopy, outerCopy]).size).toBe(4);
    // The inner pair alone: the outer group is not copied, so the copy is
    // a group of its own outside it, as the scene's copy of a child is.
    const part = apply(outer, buildDuplicateSelectedMulti(outer.state, ['pin_a', 'pin_b'], outer.hostDoc));
    expect(record(part, groupOf(part, 'pin_a_copy'))).toEqual({ id: groupOf(part, 'pin_a_copy'), name: 'Group 1 copy' });
  });
});

describe('reparenting, as an outline row dragged', () => {
  test('a host item goes into a group, and out of it, by its own field', () => {
    const s = group(three(), ['pin_a', 'pin_b']);
    const gid = groupOf(s, 'pin_a')!;
    const joined = apply(s, buildReparent(s.state, 'pin_c', gid, s.state.sceneOrder, s.hostDoc));
    expect(groupOf(joined, 'pin_c')).toBe(gid);
    expect(selectionUnitIds(joined, 'pin_c')).toEqual(['pin_a', 'pin_b', 'pin_c']);
    const left = apply(joined, buildReparent(joined.state, 'pin_c', null, joined.state.sceneOrder, joined.hostDoc));
    expect(groupOf(left, 'pin_c')).toBeUndefined();
    // Dropped where it already is: nothing.
    expect(buildReparent(s.state, 'pin_a', gid, s.state.sceneOrder, s.hostDoc)).toBeNull();
    expect(buildReparent(s.state, 'pin_c', null, s.state.sceneOrder, s.hostDoc)).toBeNull();
  });

  test('a locked item, or one in a locked group, stays where it is', () => {
    const s = group(three(), ['pin_a', 'pin_b']);
    const gid = groupOf(s, 'pin_a')!;
    const held = apply(s, buildToggleLockGroup(s.state, gid, s.hostDoc));
    expect(buildReparent(held.state, 'pin_a', null, held.state.sceneOrder, held.hostDoc)).toBeNull();
    expect(buildReparent(held.state, gid, null, held.state.sceneOrder, held.hostDoc)).toBeNull();
  });

  test('a host item goes into a scene group, and rides it', () => {
    const [a, r1] = placeRect(three(), 20, 20);
    const [b, r2] = placeRect(a, 30, 20);
    const s = group(b, [r1, r2]);
    const sceneId = s.state.groups[0].id;
    const joined = apply(s, buildReparent(s.state, 'pin_a', sceneId, s.state.sceneOrder, s.hostDoc));
    expect(groupOf(joined, 'pin_a')).toBe(sceneId);
    expect(hostGroupChain(joined, sceneId).sceneId).toBe(sceneId);
    expect(selectionUnitIds(joined, r1)).toEqual([r1, r2, 'pin_a']);
  });

  test('a group of host items moves by its record: into another, into a scene group, out again', () => {
    const two = group(newSession({
      pins: [pin('pin_a', 1, 1), pin('pin_b', 3, 1), pin('pin_c', 5, 1), pin('pin_d', 7, 1)],
    }), ['pin_a', 'pin_b']);
    const s = group(two, ['pin_c', 'pin_d']);
    const g1 = groupOf(s, 'pin_a')!;
    const g2 = groupOf(s, 'pin_c')!;
    const nested = apply(s, buildReparent(s.state, g1, g2, s.state.sceneOrder, s.hostDoc));
    expect(record(nested, g1)?.parentGroupId).toBe(g2);
    expect(selectionUnitIds(nested, 'pin_a')).toEqual(['pin_a', 'pin_b', 'pin_c', 'pin_d']);
    // Never into itself, nor into a group inside it.
    expect(buildReparent(nested.state, g2, g1, nested.state.sceneOrder, nested.hostDoc)).toBeNull();
    expect(buildReparent(nested.state, g2, g2, nested.state.sceneOrder, nested.hostDoc)).toBeNull();
    const out = apply(nested, buildReparent(nested.state, g1, null, nested.state.sceneOrder, nested.hostDoc));
    expect(record(out, g1)).toEqual({ id: g1, name: 'Group 1' });
    // Into a scene group: everything in it rides that group from then on.
    const [a, r1] = placeRect(out, 20, 20);
    const [b, r2] = placeRect(a, 30, 20);
    const withScene = group(b, [r1, r2]);
    const sceneId = withScene.state.groups[0].id;
    const riding = apply(withScene, buildReparent(withScene.state, g1, sceneId, withScene.state.sceneOrder, withScene.hostDoc));
    expect(record(riding, g1)?.parentGroupId).toBe(sceneId);
    expect(hostGroupChain(riding, g1).sceneId).toBe(sceneId);
  });

  test('a scene node dropped into one makes a scene group of it, by the same id and name', () => {
    const [withRect, rect] = placeRect(group(group(three(), ['pin_a', 'pin_b']), ['pin_a', 'pin_b', 'pin_c']), 20, 20);
    const innerId = groupOf(withRect, 'pin_a')!;
    const outerId = groupOf(withRect, 'pin_c')!;
    const renamed = apply(withRect, buildRenameGroup(withRect.state, innerId, 'Pair', withRect.hostDoc));
    const locked = apply(renamed, buildToggleLockGroup(renamed.state, outerId, renamed.hostDoc));
    const s = apply(locked, buildReparent(locked.state, rect, innerId, locked.state.sceneOrder, locked.hostDoc));
    // Both groups of the chain are scene groups now, nested as they were,
    // named and locked as their records were, and the records are gone.
    const inner = s.state.groups.find((g) => g.id === innerId)!;
    const outer = s.state.groups.find((g) => g.id === outerId)!;
    expect(inner).toMatchObject({ name: 'Pair', parentGroupId: outerId });
    expect(outer).toMatchObject({ name: 'Group 2', locked: true });
    expect(s.state.svgObjects.find((o) => o.id === rect)!.groupId).toBe(innerId);
    expect(s.hostDoc.groups).toBeUndefined();
    expect(isHostGroupId(s, innerId)).toBe(false);
    // The pins keep their group ids, and are one unit with the shape.
    expect(groupOf(s, 'pin_a')).toBe(innerId);
    expect(groupOf(s, 'pin_c')).toBe(outerId);
    expect(selectionUnitIds(s, rect)).toEqual([rect, 'pin_a', 'pin_b', 'pin_c']);
    // One undo puts the records back and takes the scene groups away.
    const back = undo(s);
    expect(back.state.groups).toHaveLength(0);
    expect(back.hostDoc).toEqual(locked.hostDoc);
    expect(back.state.svgObjects.find((o) => o.id === rect)!.groupId).toBeUndefined();
  });

  test('with no host document it is the scene\'s reparent, as it always was', () => {
    const [a, r1] = placeRect(three(), 20, 20);
    const [b, r2] = placeRect(a, 30, 20);
    const [c, r3] = placeRect(b, 40, 20);
    const s = group(c, [r1, r2]);
    const sceneId = s.state.groups[0].id;
    const order = treeToSceneOrder(computeOutlineTree(buildOutlineObjects(s.state), s.state.sceneOrder));
    const se = buildReparent(s.state, r3, sceneId, order)!;
    expect(se.hostOps).toBeUndefined();
    expect(apply(s, se).state.svgObjects.find((o) => o.id === r3)!.groupId).toBe(sceneId);
  });
});

describe('a scene group emptied of scene nodes while host items are still in it', () => {
  /** A scene group of one rect and two pins. */
  function mixed() {
    const [withRect, rect] = placeRect(three(), 20, 20);
    const s = group(withRect, [rect, 'pin_a', 'pin_b']);
    return { s, rect, sceneId: s.state.groups[0].id };
  }

  test('lives on as a group of the host\'s own, with its name, when its last shape is deleted', () => {
    const { s, rect, sceneId } = mixed();
    const named = apply(s, buildRenameGroup(s.state, sceneId, 'Machine', s.hostDoc));
    const gone = applyKeeping(named, buildRemoveSelectedMulti(named.state, [rect], named.hostDoc));
    expect(gone.state.groups).toHaveLength(0);
    expect(record(gone, sceneId)).toEqual({ id: sceneId, name: 'Machine' });
    expect(isHostGroupId(gone, sceneId)).toBe(true);
    expect(selectionUnitIds(gone, 'pin_a')).toEqual(['pin_a', 'pin_b']);
    // Undo brings the shape and the scene group back, and the record goes.
    const back = undo(gone);
    expect(back.state.groups.map((g) => g.name)).toEqual(['Machine']);
    expect(back.hostDoc.groups).toBeUndefined();
  });

  test('and when its last shape is dragged out of it: the node left behind is removed', () => {
    const { s, rect, sceneId } = mixed();
    const out = applyKeeping(s, buildReparent(s.state, rect, null, s.state.sceneOrder, s.hostDoc));
    expect(out.state.groups).toHaveLength(0);
    expect(record(out, sceneId)).toEqual({ id: sceneId, name: 'Group 1' });
    // The pins it left are free to move again: nothing carries them now.
    expect(buildMoveNodes(out.state, ['pin_a', 'pin_b'], 2, 0, out.hostDoc)?.hostOps).toBeDefined();
    expect(undo(out).state.groups.map((g) => g.id)).toEqual([sceneId]);
  });

  test('keeps its lock, and the group it sat in', () => {
    const [a, r1] = placeRect(three(), 20, 20);
    const [b, r2] = placeRect(a, 30, 20);
    const inner = group(b, [r1, 'pin_a', 'pin_b']);
    const innerId = inner.state.groups[0].id;
    const outer = group(inner, [r1, 'pin_a', 'pin_b', r2]);
    const outerId = outer.state.groups.find((g) => g.id !== innerId)!.id;
    const gone = applyKeeping(outer, buildRemoveSelectedMulti(outer.state, [r1], outer.hostDoc));
    expect(gone.state.groups.map((g) => g.id)).toEqual([outerId]);
    expect(record(gone, innerId)).toEqual({ id: innerId, name: 'Group 1', parentGroupId: outerId });
    expect(hostGroupChain(gone, innerId).sceneId).toBe(outerId);
  });

  test('nothing is kept where nothing of the host is in the group, or nothing was emptied', () => {
    const [a, r1] = placeRect(three(), 20, 20);
    const [b, r2] = placeRect(a, 30, 20);
    const s = group(b, [r1, r2]);
    const se = buildRemoveSelectedMulti(s.state, [r1, r2], s.hostDoc)!;
    expect(hostGroupsKept(s.state, applyCompOps(s.state, se.entry), s.hostDoc)).toBeNull();
    const { s: m, rect } = mixed();
    const move = buildMoveNodes(m.state, [rect, 'pin_a', 'pin_b'], 2, 0, m.hostDoc)!;
    expect(hostGroupsKept(m.state, applyCompOps(m.state, move.entry), m.hostDoc)).toBeNull();
  });
});

describe('in the scene outline', () => {
  const rowsOf = (s: S, open: readonly string[] = []) => {
    const objects = buildOutlineObjects(s.state, undefined, s.hostDoc);
    const tree = computeOutlineTree(objects, s.state.sceneOrder);
    return flattenTree(tree, collapsedGroups(tree, new Set(open))).map((r) => `${'  '.repeat(r.depth)}${r.id}`);
  };

  test('is a group row where its front-most member stood, closed until it is opened', () => {
    const s = group(three(), ['pin_a', 'pin_b']);
    const gid = groupOf(s, 'pin_a')!;
    const row = buildOutlineObjects(s.state, undefined, s.hostDoc).get(gid)!;
    expect(row).toMatchObject({ kind: 'group', name: 'Group 1', locked: false, overlayRank: 1 });
    expect(rowsOf(s)).toEqual(['pin_c', gid]);
    expect(rowsOf(s, [gid])).toEqual(['pin_c', gid, '  pin_b', '  pin_a']);
    // Above every scene row, as the rows in it were.
    const [withRect, rect] = placeRect(s, 20, 20);
    expect(rowsOf(withRect, [gid])).toEqual(['pin_c', gid, '  pin_b', '  pin_a', rect]);
    // …and never in the paint order a drag commits.
    const tree = computeOutlineTree(buildOutlineObjects(withRect.state, undefined, withRect.hostDoc), withRect.state.sceneOrder);
    expect(treeToSceneOrder(tree)).toEqual(withRect.state.sceneOrder);
  });

  test('nests: in another of its kind, and at the top of the scene group it is in', () => {
    const outer = group(group(three(), ['pin_a', 'pin_b']), ['pin_a', 'pin_b', 'pin_c']);
    const innerId = groupOf(outer, 'pin_a')!;
    const outerId = groupOf(outer, 'pin_c')!;
    expect(rowsOf(outer, [innerId, outerId])).toEqual([outerId, '  pin_c', `  ${innerId}`, '    pin_b', '    pin_a']);
    const [withRect, rect] = placeRect(group(three(), ['pin_a', 'pin_b']), 20, 20);
    const s = group(withRect, [rect, 'pin_a', 'pin_b']);
    const sceneId = s.state.groups[0].id;
    const hostId = groupOf(s, 'pin_a')!;
    expect(rowsOf(s, [sceneId, hostId])).toEqual(['pin_c', sceneId, `  ${hostId}`, '    pin_b', '    pin_a', `  ${rect}`]);
  });

  test('lights as one row when the selection covers it, its members not at all', () => {
    const s = group(three(), ['pin_a', 'pin_b']);
    const gid = groupOf(s, 'pin_a')!;
    expect([...outlineSelectedIds(s.state, null, ['pin_a', 'pin_b'], s.hostDoc)]).toEqual([gid]);
    expect([...outlineSelectedIds(s.state, null, ['pin_a', 'pin_b', 'pin_c'], s.hostDoc)].sort()).toEqual([gid, 'pin_c'].sort());
    // One member alone is that member's row.
    expect([...outlineSelectedIds(s.state, 'pin_a', [], s.hostDoc)]).toEqual(['pin_a']);
    // Only the outermost covered group lights.
    const outer = group(s, ['pin_a', 'pin_b', 'pin_c']);
    expect([...outlineSelectedIds(outer.state, null, ['pin_a', 'pin_b', 'pin_c'], outer.hostDoc)]).toEqual([groupOf(outer, 'pin_c')]);
    expect([...outlineSelectedIds(outer.state, null, ['pin_a', 'pin_b'], outer.hostDoc)]).toEqual([gid]);
  });

  test('a scene group is covered by its shapes AND the host items in it', () => {
    const [withRect, rect] = placeRect(three(), 20, 20);
    const s = group(withRect, [rect, 'pin_a']);
    const sceneId = s.state.groups[0].id;
    expect([...outlineSelectedIds(s.state, null, [rect, 'pin_a'], s.hostDoc)]).toEqual([sceneId]);
    // The shape's own row, picked alone, is the shape's.
    expect([...outlineSelectedIds(s.state, rect, [], s.hostDoc)]).toEqual([rect]);
    expect([...outlineSelectedIds(s.state, 'pin_a', [], s.hostDoc)]).toEqual(['pin_a']);
  });
});

describe('wiring (source pins: there is no renderer)', () => {
  const panel = fs.readFileSync(
    path.resolve(__dirname, '..', '..', '..', 'editor-ui', 'src', 'components', 'SceneOutlinePanel.tsx'), 'utf8',
  );

  test('an overlay row drags, as a scene row does; only a lifted row does not', () => {
    expect(panel).toContain('const undraggable = lifted.has(row.id);');
    expect(panel).toContain("{...(undraggable ? null : getResponder(index, 'hold').panHandlers)}");
    expect(panel).toContain("{...(undraggable ? null : getResponder(index, 'touch').panHandlers)}");
  });

  test('a release that changes the row\'s group reparents it, whatever kind of row it is', () => {
    expect(panel).toMatch(/if \(target\.parentId !== curParent && m\.onReparent\) \{\s*m\.onReparent\(dragged\.id, target\.parentId, next\);/);
  });
});
