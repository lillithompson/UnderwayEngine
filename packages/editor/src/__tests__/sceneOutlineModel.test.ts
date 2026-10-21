import { makeBlankComposition } from '../blankComposition';
import {
  buildGroupSelectedMulti,
  buildPlaceImage,
  buildPlaceShape,
  buildPlaceText,
  buildRenameNode,
  buildToggleLock,
  commitEntry,
  createEditorSession,
  select,
} from '../editorSession';
import {
  buildGroupNames,
  buildOutlineObjects,
  buildSceneOutlineModel,
  outlineNameFor,
  outlineSelectedIds,
  OutlineCallbacks,
} from '../sceneOutlineModel';
import { clearOutlineHost, installOutlineHost, type OutlineHost } from '../outlineHost';
import { PaintObject, RGBColor } from '@/engine/types';
import { applyCompOps, revertCompOps } from '@/engine/compositionOps';
import { makePaintIsland } from './test-utils';

// The shared scene outline's view model: the three apps' own suites for it,
// unioned (their shell pins stay behind in each app). The host seam's own
// cases run over a MADE-UP app at the bottom, the way sessionHost.test does.

const INK: RGBColor = { r: 40, g: 40, b: 40 };

function populated() {
  let session = createEditorSession(makeBlankComposition('c1'));
  const shape = buildPlaceShape('rect', { cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4 }, INK);
  session = commitEntry(session, shape);
  const text = buildPlaceText('Once upon a time in a land far away', { fontId: 'system', size: 2, color: INK }, 8, 8);
  session = commitEntry(session, text);
  const image = buildPlaceImage('img1', 'image/png', 50, 50,
    { cellX: 2, cellY: 2, cellWidth: 4, cellHeight: 4 }, new Uint8Array([1]), { name: 'Sunset' });
  session = commitEntry(session, image);
  return { session, shapeId: shape.id!, textId: text.id!, imageId: image.id! };
}

const NOOP_CALLBACKS: OutlineCallbacks = {
  onSelect: () => {},
  onReorder: () => {},
  onReparent: () => {},
  onRename: () => {},
  onToggleLock: () => {},
  onToggleHidden: () => {},
  onFrame: () => {},
  onFrameAll: () => {},
  onClose: () => {},
  onBringToFront: () => {},
  onSendToBack: () => {},
};

beforeEach(() => clearOutlineHost());
afterEach(() => clearOutlineHost());

describe('outlineNameFor', () => {
  test('prefers an explicit name', () => {
    expect(outlineNameFor('image', { name: 'Sunset' })).toBe('Sunset');
  });
  test('uses a truncated content snippet for text', () => {
    expect(outlineNameFor('text', { content: 'short' })).toBe('short');
    const long = outlineNameFor('text', { content: 'x'.repeat(40) });
    expect(long.endsWith('…')).toBe(true);
    expect(long.length).toBeLessThanOrEqual(25);
  });
  test('falls back to a per-kind default', () => {
    expect(outlineNameFor('svg', {})).toBe('Drawing');
    expect(outlineNameFor('image', {})).toBe('Photo');
    expect(outlineNameFor('text', {})).toBe('Text');
    expect(outlineNameFor('mystery', {})).toBe('Object');
  });

  // A tagged node's `name` is a functional `prefix:id` tag, not a name:
  // CozyJournal's scaffold marks, Sol's seeds (`sol_architecture.md` §6.1).
  test('never shows a tag as a name', () => {
    expect(outlineNameFor('svg', { name: 'slot:squiggle' })).toBe('Drawing');
    expect(outlineNameFor('image', { name: 'slot:photo' })).toBe('Photo');
    expect(outlineNameFor('svg', { name: 'seedmark:abc' })).toBe('Drawing');
    expect(outlineNameFor('text', { name: 'decor:date', content: 'Jul 28' })).toBe('Jul 28');
  });

  test('a tag takes the label the caller declared for it, keyed by the whole tag', () => {
    const labels = new Map([['slot:squiggle', 'Reimagine Me'], ['seed:abc', 'Seed · Starter']]);
    expect(outlineNameFor('svg', { name: 'slot:squiggle' }, labels)).toBe('Reimagine Me');
    expect(outlineNameFor('svg', { name: 'seed:abc' }, labels)).toBe('Seed · Starter');
    // A tag with no declared label still falls back, never to the tag.
    expect(outlineNameFor('image', { name: 'slot:photo' }, labels)).toBe('Photo');
    expect(outlineNameFor('image', { name: 'stamp:prov_bud' }, labels)).toBe('Photo');
  });

  test('a renamed node keeps the name the user gave it', () => {
    const labels = new Map([['slot:squiggle', 'Reimagine Me']]);
    expect(outlineNameFor('svg', { name: 'My mountain' }, labels)).toBe('My mountain');
  });
});

describe('buildOutlineObjects', () => {
  test('covers svg, image, and text nodes with resolved names', () => {
    const { session, shapeId, textId, imageId } = populated();
    const objects = buildOutlineObjects(session.state);
    expect(objects.size).toBe(3);
    expect(objects.get(shapeId)).toMatchObject({ kind: 'svg', name: 'Drawing', locked: false, hidden: false });
    expect(objects.get(imageId)).toMatchObject({ kind: 'image', name: 'Sunset' });
    expect(objects.get(textId)?.kind).toBe('text');
    expect(objects.get(textId)?.name.startsWith('Once upon a time')).toBe(true);
  });

  test('reflects lock state', () => {
    const { session, shapeId } = populated();
    const locked = commitEntry(session, buildToggleLock(session.state, shapeId)!);
    expect(buildOutlineObjects(locked.state).get(shapeId)?.locked).toBe(true);
  });

  test('handles figures when present', () => {
    const state = {
      ...makeBlankComposition('cf'),
      figures: [{ id: 'fig1', name: 'Star', cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2 } as never],
      sceneOrder: ['fig1'],
    };
    const objects = buildOutlineObjects(state);
    expect(objects.get('fig1')).toMatchObject({ kind: 'figure', name: 'Star' });
  });
});

describe('paint islands in the outline', () => {
  function stateWithIsland(island: PaintObject) {
    const base = makeBlankComposition('cp');
    return { ...base, paintObjects: [island], sceneOrder: [island.id] };
  }

  test('an island gets a row of kind paint with the default name', () => {
    const island = makePaintIsland(10, 10);
    const row = buildOutlineObjects(stateWithIsland(island)).get(island.id);
    expect(row).toMatchObject({
      kind: 'paint', name: 'Paint', locked: false, hidden: false,
    });
  });

  test('rename round-trips through buildRenameNode', () => {
    const island = makePaintIsland(10, 10);
    const state = stateWithIsland(island);
    const se = buildRenameNode(state, island.id, 'Watercolor sky')!;
    const renamed = applyCompOps(state, se.entry);
    expect(buildOutlineObjects(renamed).get(island.id)?.name).toBe('Watercolor sky');
    // A rename to the same name is a no-op commit…
    expect(buildRenameNode(renamed, island.id, 'Watercolor sky')).toBeNull();
    // …and undo brings the default row name back.
    const back = revertCompOps(renamed, se.entry);
    expect(buildOutlineObjects(back).get(island.id)?.name).toBe('Paint');
  });

  test('lock and hidden flags reach the row like any other node kind', () => {
    const island = { ...makePaintIsland(10, 10), locked: true, hidden: true };
    const row = buildOutlineObjects(stateWithIsland(island)).get(island.id);
    expect(row).toMatchObject({ locked: true, hidden: true });
  });
});

// A group's name goes through the same reading as a leaf's. Sol's seed,
// plant and branch groups are tagged (`sol_architecture.md` §6.1), and a
// plant detached by an ungroup is renamed plain "Plant" (§6.6).
describe('group rows read their tags through the labels', () => {
  function groupState() {
    return {
      ...makeBlankComposition('cg'),
      groups: [
        { id: 'g_seed', name: 'seed:abc', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false },
        { id: 'g_plant', name: 'plant:abc', parentGroupId: 'g_seed', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false },
        { id: 'g_branch', name: 'branch:abc/1', parentGroupId: 'g_plant', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false },
        { id: 'g_detached', name: 'Plant', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false },
        { id: 'g_plain', name: '', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false },
      ] as never[],
      svgObjects: ['g_branch', 'g_detached', 'g_plain'].map((groupId, i) => ({
        id: `s${i}`, groupId, segments: [{ kind: 'line', start: [0, 0], end: [1, 1] }], color: { r: 0, g: 0, b: 0 },
        cellX: 0, cellY: 0, cellWidth: 1, cellHeight: 1,
      })) as never[],
      sceneOrder: ['s0', 's1', 's2'],
    };
  }

  test('a tagged group shows its label, a plain-named group its name, an unnamed one "Group"', () => {
    const state = groupState();
    const labels = new Map([['seed:abc', 'Seed · Starter'], ['plant:abc', 'Plant'], ['branch:abc/1', 'Branch']]);
    const objects = buildOutlineObjects(state, labels);
    expect(objects.get('g_seed')?.name).toBe('Seed · Starter');
    expect(objects.get('g_plant')?.name).toBe('Plant');
    expect(objects.get('g_branch')?.name).toBe('Branch');
    expect(objects.get('g_detached')?.name).toBe('Plant');
    expect(objects.get('g_plain')?.name).toBe('Group');
    // Without the labels a tag falls through to the kind's default, never the raw tag.
    expect(buildOutlineObjects(state).get('g_seed')?.name).toBe('Group');
  });

  test('buildGroupNames names only the named — a tag is not a name', () => {
    const names = buildGroupNames(groupState());
    expect(names.get('g_detached')).toBe('Plant');
    expect(names.has('g_seed')).toBe(false);
    expect(names.has('g_plain')).toBe(false);
  });
});

describe('buildSceneOutlineModel', () => {
  test('passes through sceneOrder and open flag, wires callbacks', () => {
    const { session } = populated();
    const model = buildSceneOutlineModel(session.state, null, true, NOOP_CALLBACKS);
    expect(model.sceneOrder).toBe(session.state.sceneOrder);
    expect(model.isOpen).toBe(true);
    expect(typeof model.onReorder).toBe('function');
    expect(typeof model.onFrame).toBe('function');
  });

  test('maps selectedId to a 0- or 1-element selectedIds set', () => {
    const { session, shapeId } = populated();
    expect(buildSceneOutlineModel(session.state, null, false, NOOP_CALLBACKS).selectedIds.size).toBe(0);

    const withSel = select(session, shapeId);
    const model = buildSceneOutlineModel(withSel.state, withSel.selectedId, false, NOOP_CALLBACKS);
    expect(model.selectedIds.size).toBe(1);
    expect(model.selectedIds.has(shapeId)).toBe(true);
  });
});

describe('outlineSelectedIds', () => {
  test('a multi-selection lights every member row', () => {
    const { session, shapeId, textId } = populated();
    const lit = outlineSelectedIds(session.state, null, [shapeId, textId]);
    expect(lit.has(shapeId)).toBe(true);
    expect(lit.has(textId)).toBe(true);
  });

  test('a covered group lights ALONE — the group row, not its members', () => {
    const { session, shapeId, textId } = populated();
    const grouped = commitEntry(session, buildGroupSelectedMulti(session.state, [shapeId, textId])!);
    const gid = grouped.state.groups[0].id;

    // Selecting a group means holding its members (session selection is
    // per-node), but what the user picked was ONE thing, so one row lights.
    const lit = outlineSelectedIds(grouped.state, null, [shapeId, textId]);
    expect([...lit]).toEqual([gid]);

    // Half a group is not the group: that member lights on its own.
    const half = outlineSelectedIds(grouped.state, shapeId, []);
    expect([...half]).toEqual([shapeId]);
  });

  test('a group and a loose object light one row each', () => {
    const { session, shapeId, textId, imageId } = populated();
    const grouped = commitEntry(session, buildGroupSelectedMulti(session.state, [shapeId, textId])!);
    const gid = grouped.state.groups[0].id;
    const lit = outlineSelectedIds(grouped.state, null, [shapeId, textId, imageId]);
    expect([...lit].sort()).toEqual([gid, imageId].sort());
  });

  test('a nested group lights only at its outermost covered level', () => {
    const { session, shapeId, textId, imageId } = populated();
    let s = commitEntry(session, buildGroupSelectedMulti(session.state, [shapeId, textId])!);
    const innerId = s.state.groups[0].id;
    s = commitEntry(s, buildGroupSelectedMulti(s.state, [shapeId, textId, imageId])!);
    const outerId = s.state.groups.find((g) => g.id !== innerId)!.id;

    const lit = outlineSelectedIds(s.state, null, [shapeId, textId, imageId]);
    expect([...lit]).toEqual([outerId]);
    // The inner group is part of the outer one's row, not a row of its own.
    expect(lit.has(innerId)).toBe(false);
  });

  test('an empty selection lights nothing', () => {
    const { session } = populated();
    expect(outlineSelectedIds(session.state, null, []).size).toBe(0);
  });

  test('the model carries the multi-selection through', () => {
    const { session, shapeId, textId } = populated();
    const model = buildSceneOutlineModel(
      session.state, null, true, NOOP_CALLBACKS, [shapeId, textId],
    );
    expect(model.selectedIds.has(shapeId)).toBe(true);
    expect(model.selectedIds.has(textId)).toBe(true);
  });
});

// ── The outline seam, over a made-up app ──────────────────────────
//
// A host whose scene carries BADGES (an svg named `badge_…`, which wears
// its own glyph, with a hidden record beside it that is never a row), and
// whose own document holds MARKERS that draw over the page.

interface MarkerDoc {
  readonly markers: readonly { id: string; label: string; groupId?: string }[];
}

const HOST: OutlineHost<MarkerDoc> = {
  nodes: (state) => {
    const badgeIds = new Set(state.svgObjects.filter((s) => s.name?.startsWith('badge_')).map((s) => s.id));
    if (badgeIds.size === 0) return null;
    return {
      icon: (_kind, item) => (badgeIds.has(item.id) ? 'shield-star' : undefined),
      chrome: (_kind, item) => item.name === 'badge_record',
    };
  },
  overlays: (_state, doc) => (doc?.markers ?? []).map((m, i) => ({
    id: m.id,
    kind: 'marker',
    name: m.label,
    parentGroupId: m.groupId,
    locked: false,
    hidden: false,
    icon: 'map-marker',
    overlayRank: i,
  })),
};

describe('the outline host', () => {
  function badged() {
    const base = makeBlankComposition('cb');
    return {
      ...base,
      svgObjects: [
        { id: 'svg_badge', name: 'badge_1', segments: [{ kind: 'line', start: [0, 0], end: [2, 2] }], color: INK, cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2 },
        { id: 'svg_record', name: 'badge_record', segments: [{ kind: 'line', start: [0, 0], end: [1, 1] }], color: INK, cellX: 0, cellY: 0, cellWidth: 1, cellHeight: 1 },
      ] as never[],
      sceneOrder: ['svg_badge', 'svg_record'],
    };
  }

  test("a node of the host's own kind wears the host's glyph", () => {
    const state = badged();
    // Without the host it is an ordinary open path.
    expect(buildOutlineObjects(state).get('svg_badge')?.icon).toBe('vector-polyline');
    installOutlineHost(HOST);
    expect(buildOutlineObjects(state).get('svg_badge')?.icon).toBe('shield-star');
  });

  test("the host's own internals are chrome, like a frame's boundary", () => {
    const state = badged();
    expect(buildOutlineObjects(state).get('svg_record')?.chrome).toBeUndefined();
    installOutlineHost(HOST);
    expect(buildOutlineObjects(state).get('svg_record')?.chrome).toBe(true);
    // …and the badge beside it is a row like any other.
    expect(buildOutlineObjects(state).get('svg_badge')?.chrome).toBeUndefined();
  });

  test('a host with none of its kinds on the page is asked once and answers null', () => {
    const { session } = populated();
    const nodes = jest.fn(HOST.nodes!);
    installOutlineHost({ ...HOST, nodes });
    buildOutlineObjects(session.state);
    expect(nodes).toHaveBeenCalledTimes(1);   // once per build, not once per row
    expect(nodes.mock.results[0].value).toBeNull();
  });

  test("the host's overlay rows come with their rank, and only with a document", () => {
    const { session } = populated();
    installOutlineHost(HOST);
    expect([...buildOutlineObjects(session.state).keys()].some((id) => id.startsWith('mk_'))).toBe(false);
    const doc: MarkerDoc = { markers: [{ id: 'mk_a', label: 'Start' }, { id: 'mk_b', label: 'End' }] };
    const objects = buildOutlineObjects(session.state, undefined, doc);
    expect(objects.get('mk_a')).toMatchObject({ kind: 'marker', name: 'Start', icon: 'map-marker', overlayRank: 0 });
    expect(objects.get('mk_b')?.overlayRank).toBe(1);
  });

  test('an overlay row riding a lit group is part of that group’s row', () => {
    const { session, shapeId, textId } = populated();
    const grouped = commitEntry(session, buildGroupSelectedMulti(session.state, [shapeId, textId])!);
    const gid = grouped.state.groups[0].id;
    installOutlineHost(HOST);
    const doc: MarkerDoc = { markers: [{ id: 'mk_in', label: 'In', groupId: gid }, { id: 'mk_out', label: 'Out' }] };
    // The group's members plus a marker riding it and one outside it: the
    // group row stands for itself and the marker it carries (no overlay row
    // is a scene member, so allDescendantMemberIds never names one).
    const lit = outlineSelectedIds(grouped.state, null, [shapeId, textId, 'mk_in', 'mk_out'], doc);
    expect([...lit].sort()).toEqual([gid, 'mk_out'].sort());
  });

  test('the model carries the document through to both halves', () => {
    const { session } = populated();
    installOutlineHost(HOST);
    const doc: MarkerDoc = { markers: [{ id: 'mk_a', label: 'Start' }] };
    const model = buildSceneOutlineModel(session.state, null, true, NOOP_CALLBACKS, [], undefined, doc);
    expect(model.objects.get('mk_a')?.name).toBe('Start');
    // An overlay row is never in the scene order a drag commits.
    expect(model.sceneOrder).not.toContain('mk_a');
  });

  test('installing null goes back to no host', () => {
    const state = badged();
    installOutlineHost(HOST);
    expect(buildOutlineObjects(state).get('svg_badge')?.icon).toBe('shield-star');
    installOutlineHost(null);
    expect(buildOutlineObjects(state).get('svg_badge')?.icon).toBe('vector-polyline');
  });
});
