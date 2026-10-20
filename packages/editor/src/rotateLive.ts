// The selection tool's Rotate slider announcing the angle it is dragging
// through (arrangeRotate.ts) — the rig Turn slider's rigTurnLive, for the
// rotation readout: CanvasSurface subscribes and labels the selection's
// pivot with the live angle, the same HUD, chrome and View Settings gate a
// two-finger twist wears (updateRotationHud). One object's value is its
// absolute angle, a group's the delta since the drag began — exactly what
// the twist's readout shows for each. Cleared on commit (or abandon); the
// surface hides the readout on null.

export interface RotateLive {
  angleDeg: number;
}

let live: RotateLive | null = null;
const listeners = new Set<(v: RotateLive | null) => void>();

export function subscribeRotateLive(fn: (v: RotateLive | null) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getRotateLive(): RotateLive | null {
  return live;
}

function emit(next: RotateLive | null): void {
  live = next;
  for (const fn of Array.from(listeners)) fn(next);
}

/** The slider passed through `angleDeg`: every move emits (the readout
 *  tracks the value), a repeat of the standing value does not. */
export function publishRotateLive(angleDeg: number): void {
  if (live?.angleDeg === angleDeg) return;
  emit({ angleDeg });
}

/** The drag is over (committed or abandoned): the readout goes. */
export function clearRotateLive(): void {
  if (live !== null) emit(null);
}

/** Test seam: forget everything, subscribers included. */
export function __resetRotateLiveForTest(): void {
  clearRotateLive();
  live = null;
  listeners.clear();
}
