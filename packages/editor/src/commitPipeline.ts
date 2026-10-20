import type { SessionEntry } from './editorSession';

// The commit pipeline seam (docs/shared-editor.md §4.1, "Commit pipeline
// wrapper"; DrawBot's docs/drawBot.md §5.4, where it came from): the
// shell's three ways of changing the document — a user entry, undo, redo —
// exposed as one object an app can WRAP. DrawBot installs its play
// session's commit wrapper here (freeze a paused run before any user edit,
// untag the trail nodes an edit touches); with nothing installed the
// pipeline is the identity and the shell behaves exactly as it did. An
// app's extension names its wrapper as `wrapCommit` (extension.ts); the
// shell installs it with {@link setCommitWrapper}.
//
// The shell keeps its real handlers in a ref it refreshes every render and
// calls through the stable functions {@link wrapCommitPipeline} returns, so
// a wrapper installed at module scope reaches every call site — the
// toolbar, the properties panel, the canvas's commits, the keyboard — and
// there is exactly one place a user edit passes through.

export interface CommitPipeline {
  /** Apply a user entry to the session: commit it, schedule the save. A
   *  null entry is a no-op (the builders return null for "nothing to do"). */
  applyEntry(se: SessionEntry | null): void;
  doUndo(): void;
  doRedo(): void;
}

/** What a phase installs: given the shell's own pipeline, the pipeline the
 *  shell should call instead. */
export type CommitWrapper = (base: CommitPipeline) => CommitPipeline;

const IDENTITY: CommitWrapper = (base) => base;

let wrapper: CommitWrapper = IDENTITY;

/** Install (or, with null, remove) the wrapper every shell call goes
 *  through. Called once at module load by the phase that owns it. */
export function setCommitWrapper(next: CommitWrapper | null): void {
  wrapper = next ?? IDENTITY;
}

/** Tests only. */
export function clearCommitWrapper(): void {
  wrapper = IDENTITY;
}

/**
 * The pipeline the shell calls. Stable across renders (the shell memoizes
 * the result once); each call reads the shell's CURRENT handlers off the
 * ref and the CURRENT wrapper, so neither a re-render nor a late install
 * is missed.
 */
export function wrapCommitPipeline(ref: { current: CommitPipeline }): CommitPipeline {
  return {
    applyEntry: (se) => wrapper(ref.current).applyEntry(se),
    doUndo: () => wrapper(ref.current).doUndo(),
    doRedo: () => wrapper(ref.current).doRedo(),
  };
}
