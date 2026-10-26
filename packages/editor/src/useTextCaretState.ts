import { useCallback, useRef, useState } from 'react';

// The invisible input's CARET and selection, mirrored for the on-canvas
// text node to draw: the UTF-16 focus index, the anchor a range started
// at, the seek a tap on the glyphs requests, and the blur backstop that
// tells a press escaping `preventDefault` from the reader tapping away.
//
// This is the FRONT half of the 10-statement caret group §4.2 item 6 held
// back twice — at 6.5b.2, and again on re-measurement at 6.5b.3. As ONE
// hook it is not placeable in any of the three apps: the handlers read the
// session ref two hundred statements after this state is read back by the
// canvas. Cut at that read and both halves place. The seam is where the
// group FAILED the gate, which is 6.5b.3's rule applied a second time —
// and the first time it has been applied to a group that was refused.
//
// It takes only the id of the text being edited, which its ref mirrors so
// the canvas tap handlers can read it without going stale.

/** A tap on the glyphs asking the caret (or a range) to move there.
 *  `seq` makes every tap a distinct request, so tapping the same spot twice
 *  still moves the selection back after arrowing away from it. */
export interface CaretSeek { start: number; end: number; seq: number }

export function useTextCaretState({ editingTextId }: {
  editingTextId: string | null;
}) {
  // Mirrored so the canvas tap handlers — which read through a props ref and
  // are not rebuilt per render — can tell "the text being edited" from any
  // other node without going stale.
  const editingTextIdRef = useRef<string | null>(null);

  editingTextIdRef.current = editingTextId;

  // The invisible-input caret (native): the textarea's UTF-16 selection
  // index, mirrored so the on-canvas text node can draw the caret itself —
  // and, when the field holds a RANGE rather than a caret, its other end,
  // so the node can paint the band behind the glyphs it covers. Without
  // that band a selection made in an invisible field is a thing the next
  // keystroke silently replaces.
  const [editingCaretUtf16, setEditingCaretUtf16] = useState(0);

  const [editingAnchorUtf16, setEditingAnchorUtf16] = useState(0);

  /** Both ends at once — what the textarea reports on every selection move,
   *  and what a seek sets. The caret is the FOCUS end (where the next
   *  keystroke lands); the anchor is where the range started. */
  const setEditingSelection = useCallback((caret: number, anchor: number = caret) => {
    setEditingCaretUtf16(caret);
    setEditingAnchorUtf16(anchor);
  }, []);

  // A single tap that settled on a scene node (after selecting it).
  // `wasSelected` marks a re-tap — the node was already the selection before
  // this tap. Re-tapping an editable text opens its content editor (the same
  // flow as props-panel Edit); tapping an unset photo placeholder opens the
  // picker to replace its pixels in place — the only way in, now that the
  // props panel offers no Replace option — keeping the node's box/slot tag/
  // frame membership while its sentinel imageId flips to a real one (which is
  // what marks the slot filled).
  // Every other node tap is a no-op.
  // A tap inside the text being edited: put the caret where the finger landed.
  // The canvas has already kept the (invisible) textarea focused, so this only
  // has to move the selection — mirrored onto the on-canvas caret, and pushed
  // into the textarea itself so the next keystroke inserts there. `seq` makes
  // every tap a distinct request, so tapping the same spot twice still moves
  // the selection back after arrowing away from it.
  const [caretSeek, setCaretSeek] = useState<CaretSeek | null>(null);

  // Swallowing the press's default action is what keeps the field focused, but
  // it is a WebKit behaviour rather than a guarantee. This is the backstop: a
  // blur arriving in the same turn as a caret seek is that press escaping the
  // preventDefault, not the user tapping away, so the edit must not commit.
  // Cleared on the next turn — by then any blur the press caused has fired.
  const caretSeekPendingRef = useRef(false);

  return {
    caretSeek, caretSeekPendingRef, editingAnchorUtf16, editingCaretUtf16,
    editingTextIdRef, setCaretSeek, setEditingSelection,
  };
}
