import type { PaintStrokeDraft, RGBColor } from './types';
import { PaintStrokeSVGSnapshot } from './types';

/**
 * Out-of-React store for the Color tool's in-flight paint stroke.
 *
 * Lives outside `CompositionState` / `useReducer` so a paint tick can
 * never trigger a re-render of `CompositionEditor` or its component
 * tree. The SVG overlay subscribes directly via `subscribe` and
 * imperatively updates its DOM in response to `notify` calls.
 *
 * Profiling (Perf/Trace-…json) showed >50 % of trace time inside
 * `renderRootSync` because every PAINT_STROKE_PAINT action propagated a
 * new state object that the editor re-rendered top-to-bottom. Moving
 * the draft here removes that cost — paint only touches the store and
 * the preview's DOM.
 */

let draft: PaintStrokeDraft | null = null;
const listeners = new Set<() => void>();

export function getPaintStrokeDraft(): PaintStrokeDraft | null {
  return draft;
}

/** Replace the draft (start a stroke with a fresh draft, or clear with
 *  `null` at stroke end / cancel). Notifies subscribers. */
export function setPaintStrokeDraft(next: PaintStrokeDraft | null): void {
  draft = next;
  notify();
}

/** Mutate the existing draft in place (for the rAF-flush hot path where
 *  we add accumulator entries / snapshots). The mutator runs against the
 *  live draft so inner Maps don't get cloned at touch-event frequency.
 *  Notifies subscribers when the mutator reports it changed something. */
export function mutatePaintStrokeDraft(mutate: (d: PaintStrokeDraft) => boolean): void {
  if (!draft) return;
  if (mutate(draft)) notify();
}

/** Subscribe to draft changes. Returns an unsubscribe. The callback fires
 *  synchronously after every `setPaintStrokeDraft`, and after a
 *  `mutatePaintStrokeDraft` whose mutator returned true. */
export function subscribePaintStroke(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function notify(): void {
  for (const cb of listeners) cb();
}

// Re-export types for convenience (so consumers don't need a separate import).
export type { PaintStrokeDraft, PaintStrokeSVGSnapshot, RGBColor };
