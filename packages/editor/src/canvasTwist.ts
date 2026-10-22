import type { CompositionState } from '@/engine/types';
import type { CellBbox } from './resizeMath';
import { canvasHost } from './components/canvasHooks';
import { resolveMultiSelectionFrame } from './editorSession';

// The two-finger TWIST's shared reading of what is in hand (canvasHooks.ts
// `CanvasTwist`; docs/shared-editor.md §4.1, §4.3). Both halves of the
// gesture's gate were written out by hand in each app's canvas, and two of
// the three apps had grown a host rider on it: this is the one reading.

/** The unit a two-finger twist would turn. */
export interface TwistUnit {
  /** Every member, which is the selection itself for a multi and the one
   *  host item for a lone unit. */
  readonly ids: readonly string[];
  /** The box BOTH fingers must land in for the twist to open — the unit's
   *  own, or a lone host item's grown to a fingertip pair
   *  (`CanvasTwist.grip`). */
  readonly grip: CellBbox;
  /** The box the gesture TURNS, and the angle it is already turned at: a
   *  bound group's box rides its own turn, so the pair's rotation is read
   *  as a delta from there. Never the grip — growing the box for the
   *  fingers must not grow what the turn pivots about. */
  readonly box: CellBbox;
  readonly angleDeg: number;
}

/**
 * The unit two fingers landing on the page would twist, or null when the
 * pair is the camera's.
 *
 * A GROUP or a MULTI-SELECTION is one unit on the canvas and turns about
 * its combined centre; a lone selection is a unit only where the host says
 * so (`CanvasTwist.loneUnit` — DrawBot's bot, which turns about its own
 * centre by the same builder, so a grid bot lands on a quarter turn). A
 * lone SCENE node's twist is not this: it is the single-object case, gated
 * on both fingers hitting that very node, which the canvas reads with its
 * own hit test.
 *
 * `sel` is the selection as the gesture must read it — the one restored
 * from a claim's `prevSelection`, not the props' session, because the
 * first finger's own press may have just selected the object under the
 * pair and a two-finger gesture must never pick an object nobody tapped.
 *
 * Move mode opens nothing: two fingers pinch the camera, whatever they
 * landed on.
 */
export function resolveTwistUnit<TDoc = undefined>(
  state: CompositionState,
  sel: { readonly selectedId: string | null; readonly selectedIds: readonly string[] },
  opts: { moveOnly: boolean; pxPerCell: number; hostDoc?: TDoc },
): TwistUnit | null {
  if (opts.moveOnly) return null;
  const twist = canvasHost<TDoc>().twist;
  const multi = sel.selectedIds.length >= 2;
  const lone = multi ? null : twist?.loneUnit?.(opts.hostDoc, sel.selectedId) ?? null;
  const ids = multi ? sel.selectedIds : lone ? [lone] : null;
  if (!ids || ids.length === 0) return null;
  const frame = resolveMultiSelectionFrame(state, ids, opts.hostDoc);
  if (!frame) return null;
  // The grip grows for a LONE host item only: a multi-selection's box is
  // already as wide as the things in it, and growing it would open the
  // twist on empty page beside the selection.
  const grip = lone && twist?.grip ? twist.grip(frame.bbox, opts.pxPerCell) : frame.bbox;
  return { ids: [...ids], grip, box: frame.bbox, angleDeg: frame.angleDeg };
}
