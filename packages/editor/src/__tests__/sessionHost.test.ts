import { makeBlankComposition } from '@/editor/blankComposition';
import type { CompositionState, CompUndoEntry, RGBColor, SVGObject } from '@/engine/types';
import { matApplyPoint } from '@/engine/sceneTransform';
import { findItem } from '@/engine/compositionOps';
import type { CellBbox } from '../resizeMath';
import {
  type HostItem, type HostItems, type HostNodeRules, type HostOps,
  clearSessionHost, installSessionHost, sessionHost,
} from '../sessionHost';
import {
  buildAlignSelectedMulti, buildApplyColor, buildDuplicateSelected, buildDuplicateSelectedMulti,
  buildGroupSelectedMulti, buildMoveNodes, buildPlaceShape, buildRemoveSelectedMulti,
  buildResizeNodes, buildRotateSelectedMulti, buildToggleHostItemLock, buildToggleLockMulti,
  buildUngroupSelectedMulti, canMergeSelectedMulti, commit, commitEntry, copyRunName,
  createEditorSession, expandSelectionUnits, groupSelectionMemberIds, isHostItemLocked,
  hostSelectionLive, isMultiSelectionLocked, isSelectableId, marqueeHitIds, recordEntry, redo, requiresUniformScale,
  resolveMultiSelectionBox, resolveMultiSelectionFrame, select, selectMany, selectionColor,
  selectionColorAlpha, selectionTakesAlpha, selectionUnitIds, toggleSelect, undo, withHostChange,
  withHostDoc, wholeUnitOfSelection,
} from '../editorSession';
import { colorScopeReaches, createObjectColorState, hostPaintReach, reaimedColorScope } from '../paintBrush';

// The SESSION seam (sessionHost.ts; docs/shared-editor.md §4.1): a made-up
// app with a parallel document of counters, a kind of selectable item of its
// own — a MARKER, a point with a one-cell footprint — and a node rule for
// nodes named `badge:…`, whose colour it keeps off the object. What the
// three apps plug in is theirs to pin; this suite pins what the session
// does with any of it.

// ── The parallel document ──────────────────────────────────────────────

interface Doc { count: number; markers: Marker[] }
interface Marker extends HostItem { x: number; y: number }
type Op = { kind: 'add'; n: number } | { kind: 'markers'; before: Marker[]; after: Marker[] };

const EMPTY: Doc = { count: 0, markers: [] };

const OPS: HostOps<Doc, Op> = {
  apply: (doc, op) => (op.kind === 'add'
    ? { ...doc, count: doc.count + op.n }
    : { ...doc, markers: op.after }),
  revert: (doc, op) => (op.kind === 'add'
    ? { ...doc, count: doc.count - op.n }
    : { ...doc, markers: op.before }),
};

const BOX = 1;
const ITEMS: HostItems<Doc, Op> = {
  isHostId: (id) => id.startsWith('mk_'),
  itemById: (doc, id) => doc.markers.find((m) => m.id === id) ?? null,
  items: (doc) => doc.markers,
  box: (doc, id) => {
    const m = doc.markers.find((k) => k.id === id);
    return m ? { cellX: m.x - BOX / 2, cellY: m.y - BOX / 2, cellWidth: BOX, cellHeight: BOX } : null;
  },
  selectionLive: (_doc, id) => id === 'sheet',
  through: (doc, ids, m) => ({
    ...doc,
    markers: doc.markers.map((k) => {
      if (!ids.has(k.id)) return k;
      const [x, y] = matApplyPoint(m, k.x, k.y);
      return { ...k, x, y };
    }),
  }),
  remove: (doc, ids) => ({ ...doc, markers: doc.markers.filter((k) => !ids.has(k.id)) }),
  setGroup: (doc, ids, groupId) => ({
    ...doc, markers: doc.markers.map((k) => (ids.has(k.id) ? { ...k, groupId } : k)),
  }),
  setLocked: (doc, ids, locked) => ({
    ...doc, markers: doc.markers.map((k) => (ids.has(k.id) ? { ...k, locked } : k)),
  }),
  duplicate: (doc, ids, offset, groupCopyOf) => {
    const copies = doc.markers.filter((k) => ids.includes(k.id)).map((k) => ({
      ...k, id: `${k.id}_copy`, x: k.x + offset, y: k.y + offset, groupId: groupCopyOf(k.groupId),
    }));
    return { doc: { ...doc, markers: [...doc.markers, ...copies] }, ids: copies.map((c) => c.id) };
  },
  change: (before, after) => ({ kind: 'markers', before: before.markers, after: after.markers }),
};

const marker = (id: string, x: number, y: number, extra: Partial<Marker> = {}): Marker => ({ id, x, y, ...extra });
const docWith = (...markers: Marker[]): Doc => ({ count: 0, markers });

type S = ReturnType<typeof newSession>;
function newSession(doc: Doc = EMPTY, state: CompositionState = makeBlankComposition('host')) {
  return createEditorSession<string, Doc, Op>(state, 'arrange', doc);
}

/** A rectangle at (x, y), w × h, placed and committed; its id. */
function placeRect(session: S, x: number, y: number, w = 4, h = 4): [S, string] {
  const se = buildPlaceShape('rect', { cellX: x, cellY: y, cellWidth: w, cellHeight: h }, { r: 0, g: 0, b: 0 });
  return [commitEntry(session, se), se.id!];
}

// Cleared before AND after: an app that installs its own host in a jest
// setupFile runs this suite from its vendor root with one pre-installed.
beforeEach(() => clearSessionHost());
afterEach(() => clearSessionHost());

describe('installing the host', () => {
  test('nothing installed means nothing of a host: every member absent', () => {
    expect(sessionHost()).toEqual({});
  });

  test('install, read back, clear', () => {
    installSessionHost({ ops: OPS });
    expect(sessionHost<Doc, Op>().ops).toBe(OPS);
    installSessionHost(null);
    expect(sessionHost()).toEqual({});
  });
});

describe('a parallel document moved by the same undo step', () => {
  beforeEach(() => installSessionHost({ ops: OPS }));

  test('a fresh session carries the document and two empty stacks', () => {
    const s = newSession({ count: 3, markers: [] });
    expect(s.hostDoc).toEqual({ count: 3, markers: [] });
    expect(s.hostUndoStack).toEqual([]);
    expect(s.hostRedoStack).toEqual([]);
  });

  test('a session with no document at all leaves hostDoc undefined', () => {
    const s = createEditorSession(makeBlankComposition('plain'));
    expect(s.hostDoc).toBeUndefined();
    expect(s.hostUndoStack).toEqual([]);
  });

  test('host ops ride a commit: applied after the engine ops, pushed beside them', () => {
    let s = newSession();
    const se = buildPlaceShape('rect', { cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4 }, { r: 0, g: 0, b: 0 });
    s = commit(s, se.entry, undefined, undefined, { kind: 'add', n: 2 });
    expect(s.hostDoc.count).toBe(2);
    expect(s.undoStack).toHaveLength(1);
    expect(s.hostUndoStack).toEqual([{ kind: 'add', n: 2 }]);
  });

  test('an entry of host ops ALONE is a whole step with an empty engine entry', () => {
    let s = newSession();
    s = commitEntry(s, { entry: [], hostOps: { kind: 'add', n: 5 } });
    expect(s.hostDoc.count).toBe(5);
    expect(s.undoStack).toEqual([[]]);
    expect(s.hostUndoStack).toEqual([{ kind: 'add', n: 5 }]);
    expect(s.dirty).toBe(true);
    // A step with nothing in it at all is refused: the same session back.
    expect(commitEntry(s, { entry: [] })).toBe(s);
    expect(commit(s, [], undefined, undefined, undefined)).toBe(s);
  });

  test('an engine-only step pushes null on the host stack, so the stacks stay index-aligned', () => {
    let s = newSession();
    [s] = placeRect(s, 0, 0);
    s = commitEntry(s, { entry: [], hostOps: { kind: 'add', n: 1 } });
    [s] = placeRect(s, 8, 8);
    expect(s.undoStack).toHaveLength(3);
    expect(s.hostUndoStack).toEqual([null, { kind: 'add', n: 1 }, null]);
  });

  test('undo reverts the host half with the engine half; redo re-applies both', () => {
    let s = newSession();
    [s] = placeRect(s, 0, 0);
    s = commitEntry(s, { entry: [], hostOps: { kind: 'add', n: 4 } });
    expect(s.hostDoc.count).toBe(4);
    s = undo(s);
    expect(s.hostDoc.count).toBe(0);
    expect(s.hostUndoStack).toEqual([null]);
    expect(s.hostRedoStack).toEqual([{ kind: 'add', n: 4 }]);
    s = undo(s);
    expect(s.state.svgObjects).toHaveLength(0);
    expect(s.hostRedoStack).toEqual([{ kind: 'add', n: 4 }, null]);
    s = redo(s);
    expect(s.state.svgObjects).toHaveLength(1);
    s = redo(s);
    expect(s.hostDoc.count).toBe(4);
    expect(s.hostUndoStack).toEqual([null, { kind: 'add', n: 4 }]);
    expect(s.hostRedoStack).toEqual([]);
    // A new commit clears the redo stacks together.
    s = undo(s);
    s = commitEntry(s, { entry: [], hostOps: { kind: 'add', n: 1 } });
    expect(s.redoStack).toEqual([]);
    expect(s.hostRedoStack).toEqual([]);
  });

  test('every step keeps the two pairs of stacks the same length', () => {
    let s = newSession();
    const check = () => {
      expect(s.hostUndoStack.length).toBe(s.undoStack.length);
      expect(s.hostRedoStack.length).toBe(s.redoStack.length);
    };
    [s] = placeRect(s, 0, 0); check();
    s = commitEntry(s, { entry: [], hostOps: { kind: 'add', n: 1 } }); check();
    s = undo(s); check();
    s = undo(s); check();
    s = redo(s); check();
    [s] = placeRect(s, 4, 4); check();
    expect(s.redoStack).toEqual([]);
  });

  test('host ops with no host installed is a programming error, not a quiet no-op', () => {
    clearSessionHost();
    const s = newSession();
    expect(() => commitEntry(s, { entry: [], hostOps: { kind: 'add', n: 1 } })).toThrow(/no session host/);
  });

  test('withHostDoc swaps the document in whole, with no entry (navigation)', () => {
    const s = newSession({ count: 1, markers: [] });
    const next = withHostDoc(s, { count: 9, markers: [] });
    expect(next.hostDoc.count).toBe(9);
    expect(next.undoStack).toEqual([]);
    expect(next.hostUndoStack).toEqual([]);
    expect(withHostDoc(next, next.hostDoc)).toBe(next);
  });

  test('recordEntry pushes ops already applied, applies the host half, and checks the replay', () => {
    let s = newSession();
    const [placed, id] = placeRect(s, 0, 0);
    // The caller applied the ops itself (a flush): the state already holds
    // the shape, so the entry is recorded over the pre-session state.
    const before = s.state;
    const entry = placed.undoStack[0];
    s = { ...s, state: placed.state };
    s = recordEntry(s, { entry, hostOps: { kind: 'add', n: 7 } }, before);
    expect(findItem(s.state, id)).not.toBeNull();
    expect(s.undoStack).toEqual([entry]);
    expect(s.hostUndoStack).toEqual([{ kind: 'add', n: 7 }]);
    expect(s.hostDoc.count).toBe(7);
    // Undo WILL revert the recorded ops, so a record whose ops do not
    // reproduce the held state is refused loudly (outside a release build).
    const move = buildMoveNodes(s.state, [id], 5, 5)!.entry;
    expect(() => recordEntry(s, { entry: move }, before)).toThrow(/do not reproduce/);
    // Nothing recorded is the same session back.
    expect(recordEntry(s, { entry: [] })).toBe(s);
  });

  test('the generic functions carry the app’s session type through', () => {
    const s = newSession({ count: 1, markers: [] });
    // Type-level: every one of these is an EditorSession<string, Doc, Op>,
    // so `.hostDoc.count` typechecks without a cast.
    expect(select(s, null).hostDoc.count).toBe(1);
    expect(undo(s).hostDoc.count).toBe(1);
    expect(toggleSelect(s, 'nothing').hostDoc.count).toBe(1);
  });
});

describe('the host’s items in the selection', () => {
  beforeEach(() => installSessionHost({ ops: OPS, items: ITEMS }));

  test('a host item is selectable, stays selected across commits, and goes when the document drops it', () => {
    let s = newSession(docWith(marker('mk_1', 10, 10)));
    expect(isSelectableId(s, 'mk_1')).toBe(true);
    expect(isSelectableId(s, 'mk_9')).toBe(false);
    s = select(s, 'mk_1');
    expect(s.selectedId).toBe('mk_1');
    // A commit that places nothing to select (a bare entry) keeps it.
    s = commit(s, buildPlaceShape('rect', { cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4 }, { r: 0, g: 0, b: 0 }).entry);
    expect(s.selectedId).toBe('mk_1');
    s = commitEntry(s, withHostChange(null, s.hostDoc, ITEMS.remove(s.hostDoc, new Set(['mk_1'])))!);
    expect(s.selectedId).toBeNull();
    // Undo brings the marker back; the selection stays gone, as a deleted
    // shape's does.
    s = undo(s);
    expect(s.hostDoc.markers).toHaveLength(1);
    expect(s.selectedId).toBeNull();
  });

  test('a sentinel the host keeps live survives commits too', () => {
    let s = select(newSession(), 'sheet');
    expect(s.selectedId).toBe('sheet');
    s = commit(s, buildPlaceShape('rect', { cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4 }, { r: 0, g: 0, b: 0 }).entry);
    expect(s.selectedId).toBe('sheet');
  });

  test('selectMany orders scene leaves back to front, then the host’s items in their own order', () => {
    let s = newSession(docWith(marker('mk_b', 1, 1), marker('mk_a', 2, 2)));
    let r1: string, r2: string;
    [s, r1] = placeRect(s, 0, 0);
    [s, r2] = placeRect(s, 8, 8);
    s = selectMany(s, ['mk_a', r2, 'mk_b', r1]);
    expect(s.selectedIds).toEqual([r1, r2, 'mk_b', 'mk_a']);
    expect(s.activeTool).toBe('arrange');
    // One that the document does not hold is dropped as an unresolved id.
    expect(selectMany(s, ['mk_zz', r1]).selectedId).toBe(r1);
  });

  test('the marquee catches the host’s items after the scene’s, passing a locked one by', () => {
    let s = newSession(docWith(marker('mk_1', 10, 10), marker('mk_2', 20, 20, { locked: true }), marker('mk_3', 60, 60)));
    let r: string;
    [s, r] = placeRect(s, 8, 8);
    const rect: CellBbox = { cellX: 0, cellY: 0, cellWidth: 30, cellHeight: 30 };
    expect(marqueeHitIds(s.state, rect, s.hostDoc)).toEqual([r, 'mk_1']);
    // Without the document the scene alone answers.
    expect(marqueeHitIds(s.state, rect)).toEqual([r]);
  });

  test('a host item’s box joins the combined box, and a selection with one is boxed square', () => {
    let s = newSession(docWith(marker('mk_1', 20, 20)));
    let r: string;
    [s, r] = placeRect(s, 0, 0);
    expect(resolveMultiSelectionBox(s.state, [r, 'mk_1'], s.hostDoc)).toEqual({
      cellX: 0, cellY: 0, cellWidth: 20.5, cellHeight: 20.5,
    });
    expect(resolveMultiSelectionBox(s.state, [r, 'mk_1'])).toEqual({ cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4 });
    expect(resolveMultiSelectionFrame(s.state, [r, 'mk_1'], s.hostDoc)!.angleDeg).toBe(0);
  });

  test('a drag moves the free host items with the shapes, as one step', () => {
    let s = newSession(docWith(marker('mk_1', 20, 20), marker('mk_locked', 30, 30, { locked: true })));
    let r: string;
    [s, r] = placeRect(s, 0, 0);
    const se = buildMoveNodes(s.state, [r, 'mk_1', 'mk_locked'], 3, 1, s.hostDoc)!;
    expect(se.hostOps).toBeDefined();
    s = commitEntry(s, se);
    expect(findItem(s.state, r)!.item.cellX).toBe(3);
    expect(s.hostDoc.markers.find((m) => m.id === 'mk_1')).toMatchObject({ x: 23, y: 21 });
    // The locked one sat it out…
    expect(s.hostDoc.markers.find((m) => m.id === 'mk_locked')).toMatchObject({ x: 30, y: 30 });
    // …and undo takes both halves back.
    s = undo(s);
    expect(findItem(s.state, r)!.item.cellX).toBe(0);
    expect(s.hostDoc.markers.find((m) => m.id === 'mk_1')).toMatchObject({ x: 20, y: 20 });
    // No movement, no host half.
    expect(buildMoveNodes(s.state, [r, 'mk_1'], 0, 0, s.hostDoc)).toBeNull();
  });

  test('a quarter turn, a resize and a flip carry the host items through the same map', () => {
    let s = newSession(docWith(marker('mk_1', 8, 4)));
    let r: string;
    [s, r] = placeRect(s, 0, 0, 4, 4);
    // Turn about the combined centre: the box is 0..8.5 × 0..4.5.
    const turned = buildRotateSelectedMulti(s.state, [r, 'mk_1'], s.hostDoc)!;
    const centre = resolveMultiSelectionBox(s.state, [r, 'mk_1'], s.hostDoc)!;
    const cx = centre.cellX + centre.cellWidth / 2, cy = centre.cellY + centre.cellHeight / 2;
    const t = commitEntry(s, turned);
    const m = t.hostDoc.markers[0];
    // 90° CW about (cx, cy): (x, y) → (cx - (y - cy), cy + (x - cx)).
    expect(m.x).toBeCloseTo(cx - (4 - cy), 9);
    expect(m.y).toBeCloseTo(cy + (8 - cx), 9);
    // A resize of the box doubles the marker's offset from the box corner.
    const box = resolveMultiSelectionBox(s.state, [r, 'mk_1'], s.hostDoc)!;
    const grown = { ...box, cellWidth: box.cellWidth * 2, cellHeight: box.cellHeight * 2 };
    const g = commitEntry(s, buildResizeNodes(s.state, [r, 'mk_1'], box, grown, 0, undefined, s.hostDoc)!);
    expect(g.hostDoc.markers[0]).toMatchObject({ x: 16, y: 8 });
    // A flip across the box's vertical axis mirrors x about the box centre.
    const f = commitEntry(s, buildResizeNodes(s.state, [r, 'mk_1'], box, box, 0, { x: true, y: false }, s.hostDoc)!);
    expect(f.hostDoc.markers[0].x).toBeCloseTo(2 * (box.cellX + box.cellWidth / 2) - 8, 9);
    expect(f.hostDoc.markers[0].y).toBeCloseTo(4, 9);
  });

  test('align slides each host unit to the edge by its own box', () => {
    let s = newSession(docWith(marker('mk_1', 20, 2)));
    let r: string;
    [s, r] = placeRect(s, 0, 0, 4, 4);
    const se = buildAlignSelectedMulti(s.state, [r, 'mk_1'], 'left', s.hostDoc)!;
    const a = commitEntry(s, se);
    expect(a.hostDoc.markers[0].x).toBeCloseTo(0.5, 9);
    expect(a.hostDoc.markers[0].y).toBe(2);
  });

  test('duplicate copies the host items beside the scene’s copies, selected together', () => {
    let s = newSession(docWith(marker('mk_1', 10, 10)));
    let r: string;
    [s, r] = placeRect(s, 0, 0);
    const se = buildDuplicateSelectedMulti(s.state, [r, 'mk_1'], s.hostDoc)!;
    s = commitEntry(s, se);
    expect(s.hostDoc.markers.map((m) => m.id)).toEqual(['mk_1', 'mk_1_copy']);
    expect(s.state.svgObjects).toHaveLength(2);
    expect(s.selectedIds).toContain('mk_1_copy');
    expect(s.selectedIds).toHaveLength(2);
    // Host items alone duplicate too, with no scene ops.
    const alone = buildDuplicateSelectedMulti(s.state, ['mk_1'], s.hostDoc)!;
    expect(alone.entry).toEqual([]);
    expect(alone.ids).toEqual(['mk_1_copy']);
  });

  test('delete removes the host items with the shapes; a locked one stays', () => {
    let s = newSession(docWith(marker('mk_1', 10, 10), marker('mk_2', 12, 12, { locked: true })));
    let r: string;
    [s, r] = placeRect(s, 0, 0);
    s = commitEntry(s, buildRemoveSelectedMulti(s.state, [r, 'mk_1', 'mk_2'], s.hostDoc)!);
    expect(s.state.svgObjects).toHaveLength(0);
    expect(s.hostDoc.markers.map((m) => m.id)).toEqual(['mk_2']);
  });

  test('lock reads and toggles over the host items too', () => {
    let s = newSession(docWith(marker('mk_1', 10, 10), marker('mk_2', 12, 12, { locked: true })));
    let r: string;
    [s, r] = placeRect(s, 0, 0);
    expect(isHostItemLocked(s, 'mk_2')).toBe(true);
    expect(isHostItemLocked(s, 'mk_1')).toBe(false);
    expect(isHostItemLocked(s, r)).toBe(false);
    expect(isMultiSelectionLocked(s.state, [r, 'mk_2'], s.hostDoc)).toBe(false);
    expect(isMultiSelectionLocked(s.state, ['mk_2'], s.hostDoc)).toBe(true);
    const se = buildToggleLockMulti(s.state, [r, 'mk_1'], s.hostDoc)!;
    s = commitEntry(s, se);
    expect(isHostItemLocked(s, 'mk_1')).toBe(true);
    expect(findItem(s.state, r)!.item.locked).toBe(true);
    // One item on its own flag.
    s = commitEntry(s, buildToggleHostItemLock(s.hostDoc, 'mk_2')!);
    expect(isHostItemLocked(s, 'mk_2')).toBe(false);
    expect(buildToggleHostItemLock(s.hostDoc, 'mk_2', false)).toBeNull();
  });

  test('group binds free host items with the shapes; a tap selects the whole unit; ungroup frees them', () => {
    let s = newSession(docWith(marker('mk_1', 10, 10), marker('mk_2', 12, 12)));
    let r1: string, r2: string;
    [s, r1] = placeRect(s, 0, 0);
    [s, r2] = placeRect(s, 20, 20);
    s = commitEntry(s, buildGroupSelectedMulti(s.state, [r1, r2, 'mk_1'], s.hostDoc)!);
    const groupId = s.state.groups[0].id;
    expect(s.hostDoc.markers.find((m) => m.id === 'mk_1')!.groupId).toBe(groupId);
    expect(s.hostDoc.markers.find((m) => m.id === 'mk_2')!.groupId).toBeUndefined();
    // The unit: both shapes and the marker, from any member.
    expect(selectionUnitIds(s, 'mk_1')).toEqual([r1, r2, 'mk_1']);
    expect(selectionUnitIds(s, r1)).toEqual([r1, r2, 'mk_1']);
    expect(selectionUnitIds(s, 'mk_2')).toBeNull();
    expect(groupSelectionMemberIds(s, groupId)).toEqual([r1, r2, 'mk_1']);
    expect(expandSelectionUnits(s, ['mk_1', 'mk_2'])).toEqual([r1, r2, 'mk_1', 'mk_2']);
    expect(wholeUnitOfSelection(s, [r1, r2, 'mk_1'])).toBe(groupId);
    expect(wholeUnitOfSelection(s, [r1, r2])).toBeNull();
    const tapped = select(s, 'mk_1');
    expect(tapped.selectedIds).toEqual([r1, r2, 'mk_1']);
    // The group's lock covers its rider.
    const locked = commitEntry(s, buildToggleLockMulti(s.state, [r1, r2, 'mk_1'], s.hostDoc)!);
    expect(locked.state.groups[0].locked).toBe(true);
    expect(isHostItemLocked(locked, 'mk_1')).toBe(true);
    // Ungroup frees the rider with the shapes.
    const loose = commitEntry(s, buildUngroupSelectedMulti(s.state, [r1, r2, 'mk_1'], s.hostDoc)!);
    expect(loose.state.groups).toHaveLength(0);
    expect(loose.hostDoc.markers.find((m) => m.id === 'mk_1')!.groupId).toBeUndefined();
  });

  test('a group of host items alone has no scene node: a shared id, and Ungroup frees them', () => {
    let s = newSession(docWith(marker('mk_1', 10, 10), marker('mk_2', 12, 12)));
    const se = buildGroupSelectedMulti(s.state, ['mk_1', 'mk_2'], s.hostDoc)!;
    expect(se.entry).toEqual([]);
    s = commitEntry(s, se);
    const gid = s.hostDoc.markers[0].groupId!;
    expect(gid).toMatch(/^grp_/);
    expect(s.hostDoc.markers[1].groupId).toBe(gid);
    expect(selectionUnitIds(s, 'mk_1')).toEqual(['mk_1', 'mk_2']);
    expect(wholeUnitOfSelection(s, ['mk_1', 'mk_2'])).toBe(gid);
    s = commitEntry(s, buildUngroupSelectedMulti(s.state, ['mk_1', 'mk_2'], s.hostDoc)!);
    expect(s.hostDoc.markers.every((m) => m.groupId === undefined)).toBe(true);
  });

  test('nothing merges a host item', () => {
    let s = newSession(docWith(marker('mk_1', 10, 10)));
    let r1: string, r2: string;
    [s, r1] = placeRect(s, 0, 0);
    [s, r2] = placeRect(s, 8, 8);
    expect(canMergeSelectedMulti(s.state, [r1, r2])).toBe(true);
    expect(canMergeSelectedMulti(s.state, [r1, 'mk_1'])).toBe(false);
  });

  test('a session with NO host document ignores the installed items adapter', () => {
    // The engine’s own suites run from an app’s jest root with that app’s host
    // installed: a plain createEditorSession(state) must not hand the adapter
    // an undefined document (DrawBot’s adapter read `doc.tiles`).
    let s = createEditorSession(makeBlankComposition('plain'));
    let r1: string, r2: string;
    const place = (x: number) => buildPlaceShape('rect', { cellX: x, cellY: 0, cellWidth: 4, cellHeight: 4 }, { r: 0, g: 0, b: 0 });
    const p1 = place(0); s = commitEntry(s, p1); r1 = p1.id!;
    const p2 = place(8); s = commitEntry(s, p2); r2 = p2.id!;
    s = selectMany(s, [r2, r1]);
    expect(s.selectedIds).toEqual([r1, r2]);
    s = commitEntry(s, buildGroupSelectedMulti(s.state, [r1, r2])!);
    expect(selectionUnitIds(s, r1)).toEqual([r1, r2]);
    expect(wholeUnitOfSelection(s, [r1, r2])).toBe(s.state.groups[0].id);
    expect(groupSelectionMemberIds(s, s.state.groups[0].id)).toEqual([r1, r2]);
    expect(isSelectableId(s, 'mk_1')).toBe(false);
    expect(hostSelectionLive(s, 'sheet')).toBe(false);
    expect(isHostItemLocked(s, 'mk_1')).toBe(false);
  });

  test('without the document handed in, a state-level builder moves the scene alone', () => {
    let s = newSession(docWith(marker('mk_1', 10, 10)));
    let r: string;
    [s, r] = placeRect(s, 0, 0);
    const se = buildMoveNodes(s.state, [r, 'mk_1'], 1, 1)!;
    expect(se.hostOps).toBeUndefined();
    expect(se.entry).toHaveLength(1);
  });
});

// ── Node rules ─────────────────────────────────────────────────────────

const BADGE_INK: RGBColor = { r: 200, g: 20, b: 20 };
const isBadge = (state: CompositionState, id: string) =>
  state.svgObjects.some((o) => o.id === id && o.name?.startsWith('badge_'));

/** A record of each badge's colour, off the object (the way a rig's record
 *  is a node of its own). */
const badgeColours = new Map<string, RGBColor>();

/** What the host's live channel is showing, outside the document: the
 *  stand-in for a rig's sketch repainting itself mid-stroke. */
const shown = new Map<string, RGBColor>();

const RULES: HostNodeRules = {
  duplicateCompanions: (state, copies) => copies
    .filter((c) => c.kind === 'svg' && isBadge(state, c.fromId))
    .map((c): CompUndoEntry[number] => ({
      op: 'placeObject', kind: 'text',
      item: {
        id: `rec_${c.toId}`, content: `badge-record:${c.toId}`,
        cellX: 0, cellY: 0, cellWidth: 1, cellHeight: 1,
        style: { fontFamily: 'sans', size: 1, color: BADGE_INK },
      } as never,
    })),
  holdsAspect: (state, id) => isBadge(state, id),
  colorTarget: (state, id) => (isBadge(state, id) ? {
    apply: (scope, color) => (scope === 'patterns' ? null : {
      entry: [{ op: 'renameSVG', svgId: id, oldName: 'badge_x', newName: `badge_${color.r}` }],
    }),
    current: () => badgeColours.get(id) ?? BADGE_INK,
  } : null),
  paintTargets: (state) => {
    const ids = new Set(state.svgObjects.filter((o) => o.name?.startsWith('badge_')).map((o) => o.id));
    if (ids.size === 0) return null;
    const touched = new Map<string, RGBColor>();
    return {
      ids,
      // The live channel, for a host whose colour is not ON the object the
      // dab lands on: there is nothing to lay the canvas's overlay over, so
      // the host is told what it looks like now and hands the committed
      // picture back when the stroke is abandoned.
      preview: () => { for (const [id, c] of touched) shown.set(id, c); },
      restore: () => { for (const id of touched.keys()) shown.delete(id); },
      reaches: (_id, scope) => scope !== 'patterns',
      stamp: (draft, cellX, cellY, radiusCells) => {
        let painted = false;
        for (const id of ids) {
          const o = state.svgObjects.find((k) => k.id === id)!;
          if (Math.abs(o.cellX + o.cellWidth / 2 - cellX) > radiusCells + o.cellWidth / 2) continue;
          if (Math.abs(o.cellY + o.cellHeight / 2 - cellY) > radiusCells + o.cellHeight / 2) continue;
          touched.set(id, draft.brushColor);
          painted = true;
        }
        return painted;
      },
      commit: () => [...touched].map(([id, c]): CompUndoEntry[number] => (
        { op: 'renameSVG', svgId: id, oldName: 'badge_x', newName: `badge_${c.r}` }
      )),
    };
  },
};

function placeBadge(session: S, x: number): [S, string] {
  const se = buildPlaceShape('rect', { cellX: x, cellY: 0, cellWidth: 4, cellHeight: 4 }, { r: 0, g: 0, b: 0 });
  const named: CompUndoEntry = se.entry.map((op) => (op.op === 'placeObject'
    ? { ...op, item: { ...(op.item as SVGObject), name: 'badge_x' } }
    : op));
  return [commitEntry(session, { ...se, entry: named }), se.id!];
}

describe('the host’s rules about nodes of its own', () => {
  beforeEach(() => installSessionHost({ nodes: RULES }));

  test('a duplicate brings the host’s companions along, every way it is made', () => {
    let s = newSession();
    let b: string, r: string;
    [s, b] = placeBadge(s, 0);
    [s, r] = placeRect(s, 10, 10);
    const dup = commitEntry(s, buildDuplicateSelectedMulti(s.state, [b, r])!);
    // The copy's name is the engine's duplicateName of the original's.
    const copyId = dup.selectedIds.find((id) => id !== b && id !== r && findItem(dup.state, id)?.kind === 'svg'
      && (findItem(dup.state, id)!.item as SVGObject).name?.startsWith('badge_'))!;
    expect(copyId).toBeDefined();
    expect(dup.state.texts?.some((t) => t.content === `badge-record:${copyId}`)).toBe(true);
    // The plain rect's copy brought nothing.
    expect(dup.state.texts).toHaveLength(1);
    // The single duplicate too.
    const one = commitEntry(s, buildDuplicateSelected(s.state, b)!);
    expect(one.state.texts).toHaveLength(1);
  });

  test('a node the host holds to its aspect scales uniformly; the standard rules still stand', () => {
    let s = newSession();
    let b: string, r: string;
    [s, b] = placeBadge(s, 0);
    [s, r] = placeRect(s, 10, 10);
    expect(requiresUniformScale(s.state, b)).toBe(true);
    expect(requiresUniformScale(s.state, r)).toBe(false);
    clearSessionHost();
    expect(requiresUniformScale(s.state, b)).toBe(false);
  });

  test('the colour dispatch routes a host node through its target: apply, seed, no alpha', () => {
    let s = newSession();
    let b: string, r: string;
    [s, b] = placeBadge(s, 0);
    [s, r] = placeRect(s, 10, 10);
    const se = buildApplyColor(s.state, b, { r: 7, g: 0, b: 0 })!;
    expect(se.entry).toEqual([{ op: 'renameSVG', svgId: b, oldName: 'badge_x', newName: 'badge_7' }]);
    // An aim with nothing to write there says so.
    expect(buildApplyColor(s.state, b, { r: 7, g: 0, b: 0 }, undefined, 'patterns')).toBeNull();
    expect(selectionColor(s.state, b)).toEqual(BADGE_INK);
    expect(selectionColorAlpha(s.state, b)).toBe(1);
    expect(selectionTakesAlpha(s.state, b)).toBe(false);
    // An ordinary shape is untouched by the rule.
    expect(selectionTakesAlpha(s.state, r)).toBe(true);
    expect(buildApplyColor(s.state, r, { r: 7, g: 0, b: 0 })!.entry[0].op).not.toBe('renameSVG');
  });

  test('the Color brush skips the host’s nodes in the svg pass and writes them through the host’s pass', () => {
    let s = newSession();
    let b: string;
    [s, b] = placeBadge(s, 0);
    const objectColor = createObjectColorState('fills', s.state);
    expect(objectColor.host).not.toBeNull();
    expect(objectColor.host!.ids.has(b)).toBe(true);
    const reach = hostPaintReach(s.state)!;
    const ref = { kind: 'svg' as const, item: findItem(s.state, b)!.item as SVGObject };
    expect(colorScopeReaches('fills', ref, reach)).toBe(true);
    expect(colorScopeReaches('patterns', ref, reach)).toBe(false);
    expect(reaimedColorScope('patterns', [ref], reach)).toBe('strokes');
    // Without the reach the shape is read as the plain rectangle it is.
    expect(colorScopeReaches('patterns', ref)).toBe(false);
    // The pass commits what a dab touched.
    const touched = objectColor.host!.stamp(
      { brushColor: { r: 9, g: 9, b: 9 }, blendMode: 'normal', opacity: 1 } as never, 2, 2, 1, null, new Set(), null,
    );
    expect(touched).toBe(true);
    expect(objectColor.host!.commit(s.state)).toEqual([
      { op: 'renameSVG', svgId: b, oldName: 'badge_x', newName: 'badge_9' },
    ]);
  });

  test('the pass drives the host’s own live picture, and hands it back on an abandon', () => {
    // A node whose colour is not ON the object has nothing for the canvas's
    // overlay to be laid over — a rig's silhouette is a bake the live
    // sketch draws over — so the pass is the host's live channel too: it is
    // told what it looks like now, and a stroke that commits nothing hands
    // the committed picture back. A stroke that DOES commit needs neither:
    // the records move and the host's layer re-pushes from them.
    shown.clear();
    let s = newSession();
    let b: string;
    [s, b] = placeBadge(s, 0);
    const objectColor = createObjectColorState('fills', s.state);
    objectColor.host!.stamp(
      { brushColor: { r: 7, g: 7, b: 7 }, blendMode: 'normal', opacity: 1 } as never, 2, 2, 1, null, new Set(), null,
    );
    objectColor.host!.preview!();
    expect(shown.get(b)).toEqual({ r: 7, g: 7, b: 7 });
    objectColor.host!.restore!();
    expect(shown.has(b)).toBe(false);
  });

  test('a host that needs no live picture supplies neither', () => {
    // Both are optional: a host whose colour IS on the object is previewed
    // by the canvas's own overlay like any other node.
    installSessionHost({
      nodes: {
        paintTargets: () => ({
          ids: new Set<string>(), reaches: () => false, stamp: () => false, commit: () => [],
        }),
      },
    });
    const pass = createObjectColorState('fills', newSession().state).host!;
    expect(pass.preview).toBeUndefined();
    expect(pass.restore).toBeUndefined();
  });

  test('without a host, the brush’s state carries no pass and the dispatch is the standard one', () => {
    clearSessionHost();
    let s = newSession();
    let b: string;
    [s, b] = placeBadge(s, 0);
    expect(createObjectColorState('fills', s.state).host).toBeNull();
    expect(hostPaintReach(s.state)).toBeNull();
    expect(selectionTakesAlpha(s.state, b)).toBe(true);
  });

  test('a run of copies is numbered from the standard label, whatever the host', () => {
    expect(copyRunName('svg', { name: 'badge_x' }, 3)).toBe('badge_x 3');
    expect(copyRunName('svg', {}, 3)).toBe('Drawing 3');
    expect(copyRunName('text', { content: 'hello' }, 2)).toBe('hello 2');
    // A tag (a `prefix:id` name) keeps its name verbatim — and a tagged
    // node is the one kind whose label the host says (the outline's
    // tagLabels), which is why no host seam is read here.
    expect(copyRunName('svg', { name: 'slot:squiggle' }, 4)).toBe('slot:squiggle');
    clearSessionHost();
    expect(copyRunName('svg', { name: 'badge_x' }, 3)).toBe('badge_x 3');
  });
});

