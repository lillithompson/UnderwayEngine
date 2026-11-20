import { CompositionState } from '@/engine/types';
import { isClosedPath } from '@/engine/compositionArcMath';
import { allDescendantMemberIds, computeAliveGroupIds, isTagName } from '@/engine/compositionOps';
import { buildFrameRectMap } from '@/engine/compositionFrame';
import { defaultOutlineName } from './editorSession';
import { outlineHost } from './outlineHost';
import { TOOL_META } from './components/toolbarMeta';
import type { OutlineObject, OutlineRowToggle, SceneOutlineModel } from '@/editor-ui/adapter';

// Builds the project-agnostic SceneOutlineModel (from @/editor-ui) out of a
// composition. The shared panel never sees engine types — it only reads
// this normalized view model + callbacks. Pure aside from the callbacks the
// caller injects and the installed outline host (outlineHost.ts), so the
// object-mapping half is unit-tested.

/** Display name for an outline row: the engine's standard label
 *  (defaultOutlineName — explicit name wins; text falls back to a content
 *  snippet; otherwise a per-kind default) under the host's functional tags.
 *
 *  A TAGGED node's `name` is NOT a name — it is a functional `prefix:id`
 *  tag (the engine's `isTagName`, the same rule `duplicateName` and
 *  `copyRunName` go by: CozyJournal's `slot:<slotId>` / `decor:<decorId>`
 *  scaffold marks, Sol's `seed:<id>` / `plant:<id>` / `branch:<id>/<run>` /
 *  `stamp:<cardId>`), which the row must never show raw ("slot:squiggle").
 *  Such a node takes the label the caller declares for its tag
 *  (`tagLabels`, keyed by the WHOLE tag — a format's
 *  `ScaffoldSlotBase.outlineName`, a seed's strain), and falls through to
 *  the ordinary defaults when none is declared. Once the user renames the
 *  node the tag is gone and their name wins, like any other node's. */
export function outlineNameFor(
  kind: string,
  item: { name?: string; content?: string },
  tagLabels?: ReadonlyMap<string, string>,
): string {
  const own = item.name?.trim();
  if (own && isTagName(own)) {
    const label = tagLabels?.get(own);
    if (label) return label;
    // A tagged node's name is its tag, never shown: the standard label is
    // asked about the node as if it had none.
    return defaultOutlineName(kind, { content: item.content });
  }
  return defaultOutlineName(kind, item);
}

/** Normalize every scene node (figures + svg + image + text + paint +
 *  pattern) into the outline's OutlineObject map, keyed by id. `icon` is set
 *  only where the kind alone is ambiguous — svg rows get Facet's open/closed
 *  path glyph (vector-polyline / vector-polygon) — or where the installed
 *  outline host reads a node as one of its own kinds (a rig's figure wears
 *  the Rig tool's glyph); every other kind falls back to the shared
 *  defaultIconForKind.
 *
 *  A frame's clip-rect boundary is rendering internals, never a row: to the
 *  user a frame IS its border/fill/shadow, and those live on the frame's own
 *  row — selecting the frame edits them (EditorShell reads frameBoundaryRect).
 *  Surfacing the boundary as a "Background" row presented an implementation
 *  object as a scene object. Every boundary is flagged `chrome`: kept in the
 *  model + sceneOrder (reorder/reparent commits still include it, and it stays
 *  back-most within its frame) but filtered from the visible rows. It's
 *  equally unreachable on canvas — CanvasSurface.hitTestAt drops boundary
 *  hits — so no selection path can ever land on it. A host's own internals
 *  (CozyJournal's hidden rig pose record) are chrome for the same reason,
 *  through `OutlineHost.nodes`.
 *
 *  Each leaf and group row carries the host's reading of it on the host's
 *  own row toggle (`OutlineNodeReader.toggled`, read with `hostDoc`;
 *  DrawBot's Ignore), and none where the host says nothing — every row of
 *  an app without one.
 *
 *  The host's OVERLAY rows come last (`OutlineHost.overlays`): things its
 *  document holds that draw over the page rather than in it — DrawBot's bots
 *  and instruction tiles — each ranked by `overlayRank`, above every scene
 *  row and nested under the group it is in: the scene group it rides, or a
 *  group of the host's own, which is an overlay row itself (kind 'group'). */
export function buildOutlineObjects(
  state: CompositionState,
  tagLabels?: ReadonlyMap<string, string>,
  hostDoc?: unknown,
): Map<string, OutlineObject> {
  const map = new Map<string, OutlineObject>();
  const groups = state.groups ?? [];
  const frameRects = buildFrameRectMap({ groups, svgObjects: state.svgObjects, sceneOrder: state.sceneOrder });
  const chromeBoundaryIds = new Set<string>();
  for (const mask of frameRects.values()) chromeBoundaryIds.add(mask.id);
  // The host's reading of this page's nodes, resolved ONCE: a host that has
  // to walk the page for its own kinds (findRigs) walks it here, not per row.
  const host = outlineHost();
  const hostNodes = host.nodes?.(state, hostDoc) ?? null;

  const add = (
    kind: string,
    item: {
      id: string;
      name?: string;
      content?: string;
      groupId?: string;
      locked?: boolean;
      hidden?: boolean;
    },
    icon?: string,
  ) => {
    const toggled = hostNodes?.toggled?.(kind, item);
    map.set(item.id, {
      id: item.id,
      kind,
      name: outlineNameFor(kind, item, tagLabels),
      parentGroupId: item.groupId,
      locked: item.locked ?? false,
      hidden: item.hidden ?? false,
      icon: hostNodes?.icon?.(kind, item) ?? icon,
      chrome: chromeBoundaryIds.has(item.id)
        || hostNodes?.chrome?.(kind, item)
        || undefined,
      overRank: hostNodes?.overRank?.(kind, item),
      // Only where the host says (an app without the toggle builds the
      // rows it always built).
      ...(toggled !== undefined ? { toggled } : null),
    });
  };
  for (const f of state.figures) add('figure', f);
  for (const s of state.svgObjects) {
    add('svg', s, isClosedPath(s.segments) ? 'vector-polygon' : 'vector-polyline');
  }
  for (const i of state.images ?? []) add('image', i);
  for (const t of state.texts ?? []) add('text', t);
  for (const p of state.paintObjects ?? []) add('paint', p);
  // Pattern rows wear the pattern tool's own glyph, like a rig wears its.
  for (const p of state.patternObjects ?? []) add('pattern', p, TOOL_META.pattern.icon);

  // Group/frame rows: one per ALIVE group, nesting via its own parentGroupId.
  // Lock AND hidden are the group's OWN flags — both are inherited, not
  // propagated: toggling one applies to the whole subtree without touching
  // members' own flags, so a child row keeps showing (and toggling) its own
  // setting while the frame is hidden. A group's name goes through the same
  // reading as a leaf's: a TAGGED group (a Sol seed, plant or branch,
  // `sol_architecture.md` §6.1) shows its label, never its tag, and a plant
  // detached by an ungroup — renamed plain "Plant" (§6.6) — shows that name
  // as any renamed node does.
  const alive = computeAliveGroupIds(
    groups, state.figures, state.svgObjects, state.images ?? [], state.texts ?? [],
    state.paintObjects ?? [], state.patternObjects ?? [],
  );
  for (const g of groups) {
    if (!alive.has(g.id)) continue;
    // The host's own toggle reads a group as it reads a leaf (DrawBot's
    // Ignore carries down to a group's members, as the lock does).
    const toggled = hostNodes?.toggled?.('group', g);
    map.set(g.id, {
      id: g.id,
      kind: 'group',
      name: outlineNameFor('group', g, tagLabels),
      parentGroupId: g.parentGroupId,
      locked: g.locked ?? false,
      hidden: g.hidden ?? false,
      ...(toggled !== undefined ? { toggled } : null),
    });
  }

  for (const row of host.overlays?.(state, hostDoc) ?? []) map.set(row.id, row);
  return map;
}

/** Callbacks the shell wires to the session (commit pipeline + camera). */
export interface OutlineCallbacks {
  onSelect(id: string): void;
  onReorder(newSceneOrder: string[]): void;
  onReparent(nodeId: string, newParentGroupId: string | null, newSceneOrder: string[]): void;
  onRename(id: string, newName: string): void;
  onToggleLock(id: string): void;
  onToggleHidden(id: string): void;
  /** The host's own third row toggle (DrawBot's Ignore), or unset for
   *  none: each row's state of it is the outline host's to say
   *  (`OutlineNodeReader.toggled`). */
  rowToggle?: OutlineRowToggle;
  onFrame(id: string): void;
  /** Press the panel's "Outline" header: frame the whole page. */
  onFrameAll(): void;
  onClose(): void;
  onBringToFront(id: string): void;
  onSendToBack(id: string): void;
}

/** Which outline rows read as selected, given the session's selection.
 *
 *  Session selection is per-node, so selecting a group means holding every one
 *  of its members. The outline says that in the group's own terms: a group the
 *  selection covers WHOLE lights as one row, and its members — and any group
 *  nested inside it — light not at all. What you picked was the group, so the
 *  group is what reads as picked; lighting its children too would make one
 *  selection look like several.
 *
 *  Only the OUTERMOST covered group lights, for the same reason. Anything
 *  selected outside a covered group keeps its own row (a group plus a loose
 *  object lights both).
 *
 *  A host's OVERLAY rows are members like any other — neither a bot nor an
 *  instruction tile is a scene member, so `allDescendantMemberIds` never
 *  names one, and they are counted here: a group is covered when every
 *  scene leaf AND every overlay row under it is selected, whether it is a
 *  scene group or a group of the host's own (an overlay row of kind
 *  'group', which holds overlay rows alone). So a group of bots lights as
 *  one row, as a group of shapes does, and a group of shapes with a bot
 *  riding it is not lit by its shapes alone. */
export function outlineSelectedIds(
  state: CompositionState,
  selectedId: string | null,
  selectedIds: readonly string[] = [],
  hostDoc?: unknown,
): Set<string> {
  const selected = new Set<string>(selectedIds.length > 0
    ? selectedIds
    : (selectedId ? [selectedId] : []));
  if (selected.size === 0) return selected;

  const groups = state.groups ?? [];
  const overlays = outlineHost().overlays?.(state, hostDoc) ?? [];
  // Every group's parent: the scene's, and the host's own.
  const parentOf = new Map<string, string | undefined>();
  for (const g of groups) parentOf.set(g.id, g.parentGroupId);
  for (const row of overlays) if (row.kind === 'group') parentOf.set(row.id, row.parentGroupId);
  // `visit` each group `groupId` sits in, itself first. A chain that
  // loops (a damaged document) ends where it would repeat.
  const climb = (groupId: string | undefined, visit: (id: string) => boolean | void): boolean => {
    const seen = new Set<string>();
    for (let id = groupId; id !== undefined && parentOf.has(id) && !seen.has(id); id = parentOf.get(id)) {
      if (visit(id)) return true;
      seen.add(id);
    }
    return false;
  };

  // The overlay rows under each group, and how many of them are selected.
  const riders = new Map<string, { total: number; picked: number }>();
  for (const row of overlays) {
    if (row.kind === 'group') continue;
    const picked = selected.has(row.id) ? 1 : 0;
    climb(row.parentGroupId, (id) => {
      const count = riders.get(id);
      if (count) { count.total++; count.picked += picked; } else riders.set(id, { total: 1, picked });
    });
  }

  const covered = new Set<string>();
  const sceneGroupIds = new Set(groups.map((g) => g.id));
  for (const id of parentOf.keys()) {
    const members = sceneGroupIds.has(id) ? allDescendantMemberIds(state, id) : [];
    const riding = riders.get(id);
    if (members.length + (riding?.total ?? 0) === 0) continue;
    if (riding && riding.picked < riding.total) continue;
    if (members.every((member) => selected.has(member))) covered.add(id);
  }
  if (covered.size === 0) return selected;

  const insideCovered = (groupId: string | undefined): boolean => climb(groupId, (id) => covered.has(id));

  const lit = new Set<string>();
  const swallowed = new Set<string>();
  for (const id of covered) {
    // A covered group nested in another covered one is part of that one's row.
    if (insideCovered(parentOf.get(id))) continue;
    lit.add(id);
    if (sceneGroupIds.has(id)) for (const member of allDescendantMemberIds(state, id)) swallowed.add(member);
  }
  for (const row of overlays) {
    if (insideCovered(row.parentGroupId)) swallowed.add(row.id);
  }
  for (const id of selected) if (!swallowed.has(id)) lit.add(id);
  return lit;
}

export function buildSceneOutlineModel(
  state: CompositionState,
  selectedId: string | null,
  isOpen: boolean,
  callbacks: OutlineCallbacks,
  selectedIds: readonly string[] = [],
  tagLabels?: ReadonlyMap<string, string>,
  hostDoc?: unknown,
): SceneOutlineModel {
  return {
    objects: buildOutlineObjects(state, tagLabels, hostDoc),
    sceneOrder: state.sceneOrder,
    selectedIds: outlineSelectedIds(state, selectedId, selectedIds, hostDoc),
    groupNames: buildGroupNames(state),
    isOpen,
    ...callbacks,
  };
}

/** Group id → display name for the outline. Only named groups (e.g. a
 *  Figma-style frame carries the day's format label) get an entry; others
 *  fall back to the panel's generic "Group (N)". A tag is not a name, so a
 *  tagged group gets none: its row's own label (outlineNameFor) is what the
 *  panel shows, and the panel prefers that over this map anyway. */
export function buildGroupNames(state: CompositionState): Map<string, string> {
  const map = new Map<string, string>();
  for (const g of state.groups ?? []) {
    const name = g.name?.trim();
    if (name && !isTagName(name)) map.set(g.id, name);
  }
  return map;
}
