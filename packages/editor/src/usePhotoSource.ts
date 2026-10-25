import { useCallback, useRef } from 'react';
import {
  buildPlacePhotoPlaceholder,
  type EditorSession, type PhotoPlaceholder, type SessionEntry,
} from './editorSession';
import type { CellBbox } from './resizeMath';

// Opening the photo picker, and routing what comes back — a new placement, a
// drag-placed box, or a REPLACE of an image already on the canvas.
//
// Every path here is shaped by one browser rule, and it is why the hook exists
// rather than three handlers: WebKit only shows a file dialog while the tap's
// transient activation is still live, so the `.click()` goes FIRST and
// synchronously and nothing may run — or await — ahead of it. The tap point,
// and the node a replace is aimed at, are stashed in refs AFTER the click,
// because neither is read until the async `onChange` fires.
//
// The drag-to-place path commits an unfilled PLACEHOLDER into the dragged box
// immediately and then routes the picked file through the replace-in-place
// flow, which keeps the node's box and cover-fills the bitmap into it. That
// placeholder is also the fallback when the click above is ignored — a
// drag-release may not qualify as a "potential click" on iOS — so the box
// then already sits on canvas and tapping it opens the picker.
//
// `photoPlaceholder` is the app's own sentinel `imageId`, handed in: it is
// built from that app's store namespace (`cozy:` / `sol:` / `drawbots:`)
// because the blob store keys blobs by `imageId`, so it cannot be the
// package's. 6.3d put the SHAPE here and left the WORD with each app.

export function usePhotoSource({
  sessionRef, applyEntry, photoPlaceholder,
}: {
  sessionRef: { current: EditorSession | null };
  applyEntry: (se: SessionEntry | null) => void;
  photoPlaceholder: PhotoPlaceholder;
}) {
  // Hidden <input type=file> the photos-tool canvas tap opens (the options
  // row that used to host it is gone). The tap point is stashed here while
  // the (async) picker is up, so the import centers on where the user tapped.
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  const photoDropCellRef = useRef<{ x: number; y: number } | null>(null);

  // Set when the picker was opened to REPLACE an existing image's pixels (props
  // panel → Edit → Replace) rather than place a new one. Holds the target node
  // id; read (and cleared) when the async picker resolves.
  const replaceTargetRef = useRef<string | null>(null);

  const onRequestPhoto = useCallback((cellX: number, cellY: number, bbox?: CellBbox) => {
    // Open the picker FIRST, synchronously in the tap's user gesture. WebKit
    // only shows a file dialog while the gesture's transient activation is
    // still live, so nothing must run ahead of this click. The drop cell is
    // stashed after — it isn't read until the async onChange fires.
    photoInputRef.current?.click();
    if (bbox) {
      // Drag-to-place: commit an unfilled photo placeholder into the dragged
      // box NOW and route the picked file through the replace-in-place flow,
      // which keeps the node's box and cover-fills the bitmap into it. The
      // placeholder is also the fallback when the click above is ignored —
      // WebKit only opens a file dialog from a "potential click" gesture, so
      // a drag-release may not qualify (iOS) — the box then already sits on
      // canvas and tapping it opens the picker (the standard unfilled-
      // placeholder tap flow, see onNodeTap).
      const se = buildPlacePhotoPlaceholder(bbox, photoPlaceholder);
      applyEntry(se);
      photoDropCellRef.current = null;
      replaceTargetRef.current = se.id!;
      return;
    }
    photoDropCellRef.current = { x: cellX, y: cellY };
    // This is an add-new, not a replace: drop any target left set by a
    // replace picker the user opened and then cancelled, so onChange routes
    // to onAddPhoto rather than hijacking this add to overwrite that node.
    replaceTargetRef.current = null;
  }, [applyEntry]);

  // The Crop bar's Replace action: point the replace flow below at the
  // selected image and open the picker. Until this existed the flow could
  // only be entered by tapping an UNFILLED placeholder, so a photo already
  // in place could be moved, framed and cropped but never swapped — the
  // only way to change it was to delete it and re-place a new one, losing
  // its box, its framing and its place in the scene.
  //
  // The click goes FIRST and synchronously, for the reason onRequestPhoto
  // documents: WebKit only opens a file dialog while the press's transient
  // activation is live, so nothing may run (or await) ahead of it.
  const onReplaceImageSource = useCallback(() => {
    const id = sessionRef.current?.selectedId;
    if (!id) return;
    photoInputRef.current?.click();
    replaceTargetRef.current = id;
  }, []);

  return {
    onReplaceImageSource, onRequestPhoto, photoDropCellRef, photoInputRef,
    replaceTargetRef,
  };
}
