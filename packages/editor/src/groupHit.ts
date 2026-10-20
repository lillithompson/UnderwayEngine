import { findItem, findSceneObjectAtCell, isItemHidden, isItemLocked } from '@/engine/compositionOps';
import type { CompItemKind, CompositionState } from '@/engine/types';
import { selectionBoxHitsCell } from './canvasTap';
import {
  groupSelectionIds, outermostPlainGroupId, resolveMultiSelectionFrame,
} from './editorSession';
import type { CellBbox } from '@/editor/resizeMath';

// The canvas's hit test for SELECTION: the engine's pixel walk
// (findSceneObjectAtCell — front to back, each object answering for the
// pixels it actually draws), with one rule of the app's own laid over it:
//
// A plain GROUP is one thing on the canvas — a tap selects it whole, a grab
// moves it whole — so it answers for its whole BOUNDING BOX, not just the
// pixels its members draw. Tapping the empty space between two grouped
// strokes selects the group, the way tapping the space inside a selected
// group's box already grabbed it (beginMultiDrag); before, the tap fell
// through to whatever sat behind, or to nothing, and the group was only
// reachable by landing a fingertip on one of its lines.
//
// Z ORDER STILL DECIDES. The group answers at the z of its front-most
// member: anything drawn ABOVE that member which the pixel walk hit keeps
// the press (a sticker sitting over a grouped drawing is still reachable),
// and the group beats anything the walk found BEHIND it — an SVG's
// bbox-miss fallback included. A MERGED (union) object is one SVG, not a
// group, so it keeps answering by its pixels alone; so does every loose
// node, a frame's members, and a hidden or locked group.
//
// The engine's sticky-selection pre-pass — a press anywhere inside an
// already-selected object's box re-grabs it — is honoured as is: what it
// returns is returned untouched.

/** The scene object a press at world cell (`cellX`, `cellY`) selects. */
export function findSelectableAtCell(
  state: CompositionState, cellX: number, cellY: number,
): { kind: CompItemKind; id: string } | null {
  const hit = findSceneObjectAtCell(state, cellX, cellY);
  if (hit && state.selectedFigureIds.has(hit.id)) return hit;
  // A pixel hit ON a member of the group whose box answers is the better
  // answer for that group (the member under the finger, not the front-most).
  const hitGroupId = hit ? outermostPlainGroupId(state, hit.id) : null;
  const boxes = new Map<string, { bbox: CellBbox; angleDeg: number } | null>();
  for (let i = state.sceneOrder.length - 1; i >= 0; i--) {
    const id = state.sceneOrder[i];
    if (hit && id === hit.id) return hit;
    const groupId = outermostPlainGroupId(state, id);
    if (!groupId) continue;
    if (groupId === hitGroupId) return hit;
    let box = boxes.get(groupId);
    if (box === undefined) {
      const ids = groupSelectionIds(state, id);
      box = ids ? resolveMultiSelectionFrame(state, ids) : null;
      boxes.set(groupId, box);
    }
    // The box as drawn: a bound group off the quarters wears a turned one.
    if (!box || !selectionBoxHitsCell(box.bbox, box.angleDeg, cellX, cellY)) continue;
    if (isItemHidden(state, id) || isItemLocked(state, id)) continue;
    const ref = findItem(state, id);
    if (ref) return { kind: ref.kind, id };
  }
  return hit;
}
