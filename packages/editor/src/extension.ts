import type { HostTool } from './hostTools';

// The EditorExtension: everything an app plugs into the shared editor
// that the three apps' shells used to wire in by hand (docs/shared-editor.md
// §4.1). One editor, configured and extended, never forked — and the
// package imports no app: what it knows of one is what the extension says.
//
// Built up a seam at a time, as the staged plan (§4.2) moves each piece of
// the editor here. Stage 2 — the toolbar — adds the first: the host's own
// tools. The seams to come (host pages, the outline's rows, the canvas
// layers, the commit wrapper, the file chunks, the capsules, the config's
// host fields, the host bridge) are listed in §4.1 and arrive with the
// stages that need them.

/**
 * What an app supplies beside its `EditorConfig`. `TTool` is the app's own
 * tool-id type (`SolToolId`, `DrawBotToolId` …), so its registry is checked
 * against its own union.
 */
export interface EditorExtension<TTool extends string = string> {
  /** The tools that are the app's own, on the bar after the standard ones
   *  (hostTools.ts). An app with none passes `[]`. */
  tools: readonly HostTool<TTool>[];
}
