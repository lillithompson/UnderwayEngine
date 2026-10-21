import type { CompositionState } from '@/engine/types';
import type { OutlineObject } from '@/editor-ui/adapter';

// The OUTLINE seam of the EditorExtension (docs/shared-editor.md §4.1,
// "Scene outline rows"): what the shared scene outline
// (sceneOutlineModel.ts) needs of an app's own kinds of thing — the third
// seam, and the one stage 4 adds.
//
// Three apps, two shapes of need, each an optional member here:
//
//  · `nodes` — a SCENE node of the host's own kind reads differently in the
//    outline than its engine kind says: CozyJournal's rig figure is an svg
//    object but a MANNEQUIN in the outline (it wears the Rig tool's glyph,
//    not a closed path's), and the rig's hidden pose record is rendering
//    internals, a row a tap could rename or delete. A reader is resolved
//    ONCE per build, so a host that has to walk the page for its own kinds
//    (findRigs) walks it once rather than per row.
//  · `overlays` — rows for things the host's DOCUMENT holds that draw over
//    the scene rather than in it: DrawBot's bots and its instruction tiles,
//    ranked by `OutlineObject.overlayRank` (above every scene row, nested
//    under the scene group they ride). They stand in the selection like any
//    other row, so a lit group swallows the ones riding it.
//
// The tag LABELS are not here: they are per-format or per-document DATA,
// not a rule, and ride as the `tagLabels` argument the shell already builds
// (§4.3, stage 4). What counts as a tag is the engine's own rule
// (`isTagName`), the same one `duplicateName` and `copyRunName` go by.
//
// Installed ONCE per app, at module scope, by the app's own extension
// module (`installOutlineHost`), beside the session host (sessionHost.ts)
// and for the same reason: the outline's builders are pure over a
// CompositionState and are called from several sites in each shell.

/** What the outline's row for one scene node is, beyond its kind. */
export interface OutlineNodeRow {
  /** The glyph the row wears instead of the kind's default, or undefined
   *  to keep it. */
  icon?: string;
  /** True for the host's own rendering internals — kept in the model (and
   *  so in `sceneOrder`) but not shown as a row, the way a frame's clip-rect
   *  boundary is. */
  chrome?: boolean;
}

/** One node as the reader below is asked about it. */
export interface OutlineNodeItem {
  readonly id: string;
  readonly name?: string;
  readonly content?: string;
}

/** The host's reading of the page's nodes, resolved once per build. */
export interface OutlineNodeReader {
  /** The glyph `item` wears, or undefined for the kind's own. */
  icon?(kind: string, item: OutlineNodeItem): string | undefined;
  /** Is `item`'s row the host's rendering internals? */
  chrome?(kind: string, item: OutlineNodeItem): boolean;
}

/** What an app adds to the shared scene outline. */
export interface OutlineHost<TDoc = unknown> {
  /** The host's reading of this page's nodes, or null when it has none of
   *  its own kinds on it. Called once per `buildOutlineObjects`. */
  nodes?(state: CompositionState): OutlineNodeReader | null;
  /** The host's own rows — what its document holds that draws OVER the
   *  scene. Each carries its own `overlayRank`, and `parentGroupId` where
   *  it rides a scene group. */
  overlays?(state: CompositionState, doc: TDoc | undefined): readonly OutlineObject[];
}

const NONE: OutlineHost = {};
let installed: OutlineHost = NONE;

/** Install the app's outline host (or, with null, none). Called once at
 *  module scope by the app's extension module; a test installs its own and
 *  clears it after. */
export function installOutlineHost(host: OutlineHost<never> | OutlineHost | null): void {
  installed = (host as OutlineHost | null) ?? NONE;
}

/** The installed host — every member optional. */
export function outlineHost<TDoc = unknown>(): OutlineHost<TDoc> {
  return installed as OutlineHost<TDoc>;
}

/** Tests only. */
export function clearOutlineHost(): void {
  installed = NONE;
}
