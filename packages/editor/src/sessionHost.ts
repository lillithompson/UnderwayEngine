import type { CompositionState, CompUndoEntry, PaintStrokeDraft, RGBColor } from '@/engine/types';
import type { Mat2D } from '@/engine/sceneTransform';
import type { CellBbox } from './resizeMath';
import type { SessionEntry } from './editorSession';
import type { ColorScope } from './paintBrush';
import type { SceneOcclusion } from './sceneOcclusion';

// The SESSION seam of the EditorExtension (docs/shared-editor.md §4.1,
// "Commit pipeline wrapper"): what an app's parallel document and its own
// kinds of thing need of the shared session — the second seam after the
// host-tool registry (hostTools.ts), and the one stage 3 adds.
//
// Three apps, three shapes of need, each an optional member here:
//
//  · `ops` — a PARALLEL DOCUMENT beside the composition, moved by the same
//    undo step. Sol's document of cards, strains and seeds rides as
//    `SolOp[]` applied after the engine ops and reverted with them; DrawBot's
//    sim document (arena, bots, tiles) rides as a {before, after} swap. The
//    session keeps `hostDoc` and two stacks index-aligned with the engine's
//    (editorSession.ts: `hostUndoStack[i]` belongs to `undoStack[i]`), and
//    an entry may carry host ops alone.
//  · `items` — things the host's document holds that stand in the SELECTION
//    beside scene nodes and move with them: DrawBot's bots and instruction
//    tiles, which the marquee catches, a group carries, and every multi
//    edit (drag, turn, resize, mirror, align, layout, duplicate, delete,
//    lock, group) moves through this adapter — the document never learns
//    what a bot is.
//  · `nodes` — rules the host adds about SCENE nodes of its own: a node whose
//    colour is not on the object (CozyJournal's rig, whose colours live on a
//    hidden record), a node a duplicate has to bring a companion along for
//    (the rig's pose record), a node held to uniform scale (the rig, the
//    day's seeded squiggle), and the Color brush's pass over such nodes.
//    What the OUTLINE makes of such a node is a seam of its own
//    (outlineHost.ts, stage 4).
//
// Installed ONCE per app, at module scope, by the app's own extension
// module (`installSessionHost`), the way DrawBot's commit wrapper installs
// itself on commitPipeline.ts and the glyph-ink probe on paintBrush.ts: the
// pure builders below take a CompositionState, not a session, and are
// called from dozens of sites in each shell; threading the host through
// every one of them would be the churn without the seam. A session-level
// function reads `hostDoc` off the session it is handed; a state-level
// builder that moves host items takes the document as a trailing argument
// (`hostDoc?`), exactly where DrawBot's builders took `sim?`.

/** How a parallel document is moved by an undo step. `TDoc` is the
 *  document (immutable: every change is a new object), `TOps` the record
 *  one entry carries of it. */
export interface HostOps<TDoc, TOps> {
  /** The document after `ops` (commit, redo). */
  apply(doc: TDoc, ops: TOps): TDoc;
  /** …and before them (undo). */
  revert(doc: TDoc, ops: TOps): TDoc;
}

/** One selectable thing the host's document holds — what the session needs
 *  to know of a bot or a tile: its id (spelled so `isHostId` can tell it
 *  from a scene node's), the scene group it rides or the group of host
 *  items it forms, and its own lock. */
export interface HostItem {
  readonly id: string;
  readonly groupId?: string;
  readonly locked?: boolean;
}

/**
 * The host's items as the selection and the multi builders need them.
 * Every method is pure over `doc`; a change returns a new document, and
 * `change(before, after)` is the host op the entry then carries.
 */
export interface HostItems<TDoc, TOps> {
  /** Is `id` one of the host's, by its spelling alone (DrawBot's `bot_…`
   *  and `tile_…`)? Asked before the document is, so it answers for an id
   *  the document no longer holds too. */
  isHostId(id: string): boolean;
  /** The item `id` names in `doc`, or null. */
  itemById(doc: TDoc, id: string): HostItem | null;
  /** Every item, in the order they DRAW — over the scene, back to front
   *  (DrawBot's tiles are the floor, its bots walk on them). `selectMany`
   *  orders a mixed selection scene first, then these. */
  items(doc: TDoc): readonly HostItem[];
  /** The world box the item occupies (a bot's square, a tile's cell). */
  box(doc: TDoc, id: string): CellBbox | null;
  /** A selection that lives in the document but is not an item — a
   *  sentinel id the shell selects to open a sheet (DrawBot's arena, its
   *  Fields page). Kept across commits while it answers true. */
  selectionLive?(doc: TDoc, id: string): boolean;
  /** The items in `ids` carried through `m` (a drag, a turn, a mirror). */
  through(doc: TDoc, ids: ReadonlySet<string>, m: Mat2D): TDoc;
  remove(doc: TDoc, ids: ReadonlySet<string>): TDoc;
  setGroup(doc: TDoc, ids: ReadonlySet<string>, groupId: string | undefined): TDoc;
  setLocked(doc: TDoc, ids: ReadonlySet<string>, locked: boolean): TDoc;
  /** Copies of `ids` offset by the scene's duplicate step (the host may
   *  round it up to its own grid), each joining the group `groupCopyOf`
   *  names for its original's group — the scene's copy of a scene group
   *  it rides, or a fresh id for a group of host items alone. */
  duplicate(
    doc: TDoc, ids: readonly string[], offset: number,
    groupCopyOf: (groupId: string | undefined) => string | undefined,
  ): { doc: TDoc; ids: string[] };
  /** The host op recording a document change, for `SessionEntry.hostOps`. */
  change(before: TDoc, after: TDoc): TOps;
}

/** A node whose colour the host keeps off the object (CozyJournal's rig:
 *  the silhouette on the page is a bake the live sketch draws over, so the
 *  colour goes on its record). The picker's dispatch, its seed and the
 *  Color brush's commit route through this instead of the object. */
export interface HostColorTarget {
  /** The entry that writes `color` under the Color tool's aim, or null when
   *  the aim has nothing to write there (Patterns on a figure) or nothing
   *  changes. Carries no alpha: the host decides what is opaque. */
  apply(scope: ColorScope, color: RGBColor): SessionEntry | null;
  /** The colour it wears under `scope` — where a picker opened on it
   *  starts. */
  current(scope: ColorScope): RGBColor;
}

/**
 * The Color brush's pass over the host's nodes for one stroke, resolved at
 * the press (the scene cannot change mid-stroke). The svg pass skips `ids`
 * — their colour is not on the object — and this pass answers for them.
 */
export interface HostPaintTargets {
  /** Every node whose colour this pass owns, whatever the aim. */
  readonly ids: ReadonlySet<string>;
  /** Has a Color pass aimed at `scope` anything to write on node `id`? */
  reaches(id: string, scope: ColorScope): boolean;
  /** One dab: blend the brush colour into the nodes it lands on. True when
   *  anything changed. `filterIds` is the selection's filter (null for
   *  none), `skipIds` what every pass skips, `occlusion` the scene's
   *  weight at the dab. */
  stamp(
    draft: PaintStrokeDraft, cellX: number, cellY: number, radiusCells: number,
    filterIds: ReadonlySet<string> | null, skipIds: ReadonlySet<string>, occlusion: SceneOcclusion | null,
  ): boolean;
  /** The ops committing what the stroke changed, built over `state` (the
   *  state the stroke's other ops have brought the page to; the host applies
   *  its own ops in turn when one builds on another). Empty when nothing
   *  changed. */
  commit(state: CompositionState): CompUndoEntry;
}

/** Rules the host adds about scene nodes of its own kind. */
export interface HostNodeRules {
  /** Ops a duplicate brings along for the copied leaves: `copies` pairs each
   *  original with its copy's id, by kind. CozyJournal places a copy of the
   *  rig's hidden pose record for each copied figure, so a copy of a rig is
   *  a rig however it was made. */
  duplicateCompanions?(
    state: CompositionState,
    copies: ReadonlyArray<{ readonly kind: string; readonly fromId: string; readonly toId: string }>,
  ): CompUndoEntry;
  /** A node held to uniform scale by the host's rule (a rig's silhouette, a
   *  game's given shape). The standard rules — a pattern's tile, a word
   *  sticker — are the session's own. */
  holdsAspect?(state: CompositionState, nodeId: string): boolean;
  /** A node whose colour lives off the object, or null for an ordinary
   *  one. */
  colorTarget?(state: CompositionState, nodeId: string): HostColorTarget | null;
  /** The Color brush's pass over the host's nodes, or null when the page
   *  has none. */
  paintTargets?(state: CompositionState, scope: ColorScope): HostPaintTargets | null;
}

/** What an app supplies the shared session: any of the three. */
export interface SessionHost<TDoc = unknown, TOps = unknown> {
  ops?: HostOps<TDoc, TOps>;
  items?: HostItems<TDoc, TOps>;
  nodes?: HostNodeRules;
}

const NONE: SessionHost = {};
let installed: SessionHost = NONE;

/** Install the app's session host (or, with null, none). Called once at
 *  module scope by the app's extension module; a test installs its own and
 *  clears it after. */
export function installSessionHost(host: SessionHost<never, never> | SessionHost | null): void {
  installed = (host as SessionHost | null) ?? NONE;
}

/** The installed host — every member optional. */
export function sessionHost<TDoc = unknown, TOps = unknown>(): SessionHost<TDoc, TOps> {
  return installed as SessionHost<TDoc, TOps>;
}

/** Tests only. */
export function clearSessionHost(): void {
  installed = NONE;
}
