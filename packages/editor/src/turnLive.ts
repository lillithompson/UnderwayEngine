// Whether a node is being TURNED right now, and which one.
//
// Every other live manipulation moves the object rigidly, so its box can
// ride the gesture as a transform. Some do not: a host's own kind of node
// may RE-PROJECT as it turns — CozyJournal's rig figure is wide facing
// front and narrow edge-on — so its silhouette is genuinely a different
// shape every frame. No one box is true for the whole gesture, and
// re-baking the true box every frame makes the outline judder through a
// run of different shapes while the thing moves.
//
// So while such a turn is in flight the selection outline simply bows out:
// the canvas fades it away on the first publish and fades it back in on the
// committed geometry when the gesture clears. This module is just the wire
// those two moments travel over — no geometry, no per-frame work; the
// commit is still the only thing that changes the page.
//
// Two publishers, which is why it is a wire and not a flag the gesture
// carries: the canvas's own two-finger twist (through the host's
// `CanvasTwist`, canvasHooks.ts) and a slider in the shell, which the
// canvas never hears about any other way. Beside rotateLive.ts, which
// carries the ANGLE for the rotation readout — a different question about
// the same gesture.

export interface TurnLive {
  nodeId: string;
}

let live: TurnLive | null = null;
const listeners = new Set<(v: TurnLive | null) => void>();

export function subscribeTurnLive(fn: (v: TurnLive | null) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getTurnLive(): TurnLive | null {
  return live;
}

function emit(next: TurnLive | null): void {
  live = next;
  for (const fn of Array.from(listeners)) fn(next);
}

/** A turn gesture is moving `nodeId`. Publishers call this from every move
 *  event; only the first for a node emits — the signal is "a turn is in
 *  flight", and it is already up. */
export function publishTurnLive(nodeId: string): void {
  if (live?.nodeId === nodeId) return;
  emit({ nodeId });
}

/** The gesture is over (committed or abandoned): listeners re-anchor the
 *  outline on the committed geometry and fade it back in. */
export function clearTurnLive(): void {
  if (live !== null) emit(null);
}

/** Test seam: forget everything, subscribers included. */
export function __resetTurnLiveForTest(): void {
  clearTurnLive();
  live = null;
  listeners.clear();
}
