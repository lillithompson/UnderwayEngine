import type { HostTool } from './hostTools';
import type { SessionHost } from './sessionHost';
import type { OutlineHost } from './outlineHost';
import type { CommitWrapper } from './commitPipeline';

// The EditorExtension: everything an app plugs into the shared editor
// that the three apps' shells used to wire in by hand (docs/shared-editor.md
// §4.1). One editor, configured and extended, never forked — and the
// package imports no app: what it knows of one is what the extension says.
//
// Built up a seam at a time, as the staged plan (§4.2) moves each piece of
// the editor here. Stage 2 — the toolbar — added the first: the host's own
// tools. Stage 3 — the session — added the second: the host's parallel
// document, its selectable items and its node rules (`session`), and the
// commit pipeline wrapper (`wrapCommit`). Stage 4 — the outline and the
// properties glue — adds the third: how the scene outline reads the app's
// own kinds of thing (`outline`). The host PAGES of the panel are not a
// member here: they are per-selection data, and the shell hands the
// package's panel model its `hostPages` / `hiddenCommonActions` in one
// place (panelModel.ts). The seams to come (the canvas layers, the file
// chunks, the capsules, the config's host fields, the host bridge) are
// listed in §4.1 and arrive with the stages that need them.

/**
 * What an app supplies beside its `EditorConfig`. `TTool` is the app's own
 * tool-id type (`SolToolId`, `DrawBotToolId` …), so its registry is checked
 * against its own union; `TDoc` and `TOps` are its parallel document and
 * the record one undo step keeps of it (sessionHost.ts).
 */
export interface EditorExtension<TTool extends string = string, TDoc = unknown, TOps = unknown> {
  /** The tools that are the app's own, on the bar after the standard ones
   *  (hostTools.ts). An app with none passes `[]`. */
  tools: readonly HostTool<TTool>[];
  /** What the shared session needs of the app (sessionHost.ts): the
   *  parallel document's ops (Sol, DrawBot), the document's selectable
   *  items (DrawBot's bots and tiles), the rules about the app's own kinds
   *  of node (CozyJournal's rig). Installed once with
   *  `installSessionHost`. */
  session?: SessionHost<TDoc, TOps>;
  /** What the shared scene outline needs of the app (outlineHost.ts): how
   *  it reads a node of its own kind (CozyJournal's rig figure wears the
   *  Rig tool's glyph; the rig's hidden pose record is chrome) and the
   *  OVERLAY rows its document holds (DrawBot's bots and instruction
   *  tiles). Installed once with `installOutlineHost`. The labels for the
   *  app's functional `prefix:id` tags are not here — per-format or
   *  per-document data, handed to the outline's builders as `tagLabels`
   *  (§4.3). */
  outline?: OutlineHost<TDoc>;
  /** The app's wrapper round the shell's commit pipeline
   *  (commitPipeline.ts): DrawBot freezes a paused run before any edit and
   *  untags the trail nodes an edit touches. Installed with
   *  `setCommitWrapper`; an app that binds and unbinds its wrapper with a
   *  hook's lifetime (DrawBot's useSimEditor) calls that itself. */
  wrapCommit?: CommitWrapper;
}
