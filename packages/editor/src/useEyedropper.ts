import { useCallback, useRef, useState } from 'react';
import type { RGBColor } from '@/engine/types';
import { DEFAULT_RECENT_COLORS, pushRecentColor, storedRecentColors } from './activeColor';
import { captureCanvasSnapshot, type CanvasSnapshot } from './eyedropperSample';
import type { ColorPickerSpecFor } from './colorPickerSpec';
import type { EditorSession } from './editorSession';

// The EYEDROPPER and the colour-picker swatch ROW it files into.
//
// Facet's flow exactly: a picker's eyedropper swatch closes the picker and
// arms a loupe over the canvas, and the press that DISMISSES the loupe commits
// the colour under the crosshair — no second confirm. `eyedropper` says which
// picker armed it, so the sample commits back through that picker's own rule
// (a shadow colour stays a shadow colour), and `pickersRef` is the table it
// looks that rule up in.
//
// Generic over the picker ID so each app's table stays typed in ITS union
// (6.5b.1's `ColorPickerSpecFor`): the eyedropper can be armed from a row
// only that app has — CozyJournal's rig colours, DrawBots' pen — and commit
// back into it.
//
// The page raster is best-effort and asynchronous: until it lands, and if it
// never does, the loupe samples the scene graph, so the tool works from the
// first frame either way. The snapshot is a REF because it must not re-render
// — the loupe reads it per drag move.
//
// `updateSettings` is the app's store, handed in: the swatch row is
// remembered across pages, and the store a page is saved to is the one thing
// in here that is not the package's.

export function useEyedropper<TId extends string>({
  sessionRef, updateSettings,
}: {
  sessionRef: { current: EditorSession | null };
  updateSettings: (patch: { recentColors: string[] }) => Promise<unknown>;
}) {
  // The colour picker's swatch row: the colours last worked in, newest
  // first, padded out of the default spectrum. Seeded from settings below
  // and written by noteRecentColor — which a picker's CLOSE calls, not
  // every pick along the way (see activeColor.ts). The ref keeps that
  // callback stable.
  const [recentColors, setRecentColors] = useState<RGBColor[]>(
    () => [...DEFAULT_RECENT_COLORS],
  );

  const recentColorsRef = useRef<RGBColor[]>([...DEFAULT_RECENT_COLORS]);

  // The colour a picker is showing RIGHT NOW, while it is open — the toolbar
  // swatch wears it so the disc you opened tracks the wheel you are dragging,
  // exactly as the sheet's own header band does. Null whenever no picker is
  // open, and cleared on close, when the confirmed colour takes over.
  //
  // Only the toolbar's own picker sets it (see the ColorPickerModal below):
  // that swatch IS the colour that picker commits. A Fill or Border picker
  // previewing there would have the toolbar promise an active colour it is
  // not about to set.
  const [colorPreview, setColorPreview] = useState<RGBColor | null>(null);

  // …and separately, what the picker's swatch ROW remembers. One entry per
  // picker visit, written when it CLOSES: a hue row's sweep or a live drag
  // is one colour being chosen, and recording each step of it filled the
  // row with a gradient of everything the handle passed through. Keeping it
  // apart from noteActiveColor is also what stops the row reshuffling
  // under the finger picking from it.
  const noteRecentColor = useCallback((color: RGBColor) => {
    const recent = pushRecentColor(recentColorsRef.current, color);
    recentColorsRef.current = recent;
    setRecentColors(recent);
    void updateSettings({ recentColors: storedRecentColors(recent) });
  }, []);

  // ── Eyedropper (Facet's: the picker's eyedropper swatch arms a loupe over
  // the canvas, and dismissing it commits the color under the crosshair) ──
  //
  // `eyedropper` says which picker armed it, so the sample commits back through
  // that picker's own rule — a shadow color stays a shadow color. The snapshot
  // is a ref because it lands asynchronously and must not re-render: the loupe
  // reads it per drag move (see EyedropperLayer).
  const [eyedropper, setEyedropper] = useState<{ id: TId; color: RGBColor } | null>(null);

  const eyedropperSnapshotRef = useRef<CanvasSnapshot | null>(null);

  const pickersRef = useRef<ColorPickerSpecFor<TId>[]>([]);

  // ── Eyedropper: arm from a picker, commit back into it ────────────
  // Facet's flow exactly (CompositionEditor.handleEyedropperActivate /
  // …Dismiss): the picker closes, a loupe takes over the canvas, and the press
  // that dismisses the loupe commits the sampled color — no second confirm.
  const armEyedropper = useCallback((spec: ColorPickerSpecFor<TId>) => {
    // The picker goes down without confirming, so the toolbar swatch lets
    // go of its live preview too — the loupe has not sampled anything yet,
    // and the disc must not sit on a colour nobody chose while it does.
    setColorPreview(null);
    spec.close();
    setEyedropper({ id: spec.id, color: spec.color });
    eyedropperSnapshotRef.current = null;
    const s = sessionRef.current;
    if (!s) return;
    // Rasterize the page for pixel-accurate sampling. Async and best-effort:
    // until it lands (and if it never does) the loupe samples the scene graph,
    // so the tool works from the first frame either way.
    void captureCanvasSnapshot(s.state)
      .then((snap) => { eyedropperSnapshotRef.current = snap; })
      .catch(() => { eyedropperSnapshotRef.current = null; });
  }, []);

  /** Disarm without sampling anything — the tool was abandoned. */
  const cancelEyedropper = useCallback(() => {
    setEyedropper(null);
    eyedropperSnapshotRef.current = null;
  }, []);

  const commitEyedropper = useCallback((color: RGBColor) => {
    const armed = eyedropper;
    setEyedropper(null);
    eyedropperSnapshotRef.current = null;
    if (!armed) return;
    const spec = pickersRef.current.find((p) => p.id === armed.id);
    // The sample is a hue lifted off the canvas, not a reset of the opacity the
    // slider set — so it commits at the opacity that picker was already on.
    // A lifted hue IS a colour choice, whatever the slider did — so it files
    // onto the swatch row like any other, this being the picker's close by
    // another route (the loupe took the sheet's place for one press).
    if (spec) {
      noteRecentColor(color);
      spec.confirm(color, spec.alpha, true);
    }
  }, [eyedropper, noteRecentColor]);

  return {
    armEyedropper, cancelEyedropper, colorPreview, commitEyedropper, eyedropper,
    eyedropperSnapshotRef, noteRecentColor, pickersRef, recentColors, recentColorsRef,
    setColorPreview, setRecentColors,
  };
}
