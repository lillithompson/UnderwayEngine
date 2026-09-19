import React from 'react';
import type { OpacityModel, RGBLike } from '../adapter';
import { BarBody, FadeSliderRow, SliderRow } from './effectBar';

// The Opacity page: two rows — Opacity (the whole object's render opacity)
// and Fade (how far every colour the object DRAWS is mixed toward one target
// colour). Shared by images, paint islands, the closed vector shapes
// (rectangle / circle), rigs and word stickers; there is no colour of its own
// here, so no swatch — and no Remove line under it: opacity is not a layer an
// object can be without, so there is nothing to take away (undo is the way
// back).
//
// The second row used to be SOFTEN — how far the object's edges faded into
// transparency, drawn as an eroded-then-blurred silhouette mask. Fade stands
// where it stood, and is a different kind of thing in three ways worth
// keeping straight:
//
//  · it moves COLOUR, not alpha, so a faded object still hides what is
//    behind it — which is what makes it usable with the row above rather
//    than a second spelling of it;
//  · it is one number over SEVERAL colours — fill, border and stroke at
//    once, each interpolated from its own starting value, so their
//    relationships survive the whole length of the slider;
//  · and it costs nothing to draw. The soften was a live `<filter>` (a
//    feMorphology and a feGaussianBlur per object) on the 90 fps path;
//    the fade is spent on the colours before a single path is written
//    (engine/fade.ts, applied at `svgLocalGeometry`).
//
// A kind with no fill, border or stroke has nothing to fade — a paint island
// is raster brushwork — so it drops the second row (`showFade`), the way a
// word sticker used to drop Soften.
//
// The Opacity slider maps 0–1 directly and so does the Fade amount, so unlike
// the Border page there are no range constants to keep in sync with the app.
//
// Fade is RELATIVE to where the page opened, though — the panel re-bases it
// so the slider always starts at the left, on the object as it is, and the
// track ramps from there to the target. So the number this row hands back is
// how much FURTHER, and the panel composes it with what the object already
// carried.

export function OpacityBar({ opacity, fadeFrom, showFade = true, onChange, onCommit, onOpenFadePicker }: {
  opacity: OpacityModel;
  /** The Fade track's near end — the object's ink stood where the page
   *  opened it, which the panel computes (it owns the re-base, and the
   *  target the ink is mixed toward can change while the page is up). */
  fadeFrom?: RGBLike;
  /** Render the Fade row. Off for a selection with no colour of its own to
   *  fade (a paint island's brushwork). submenuHeight('opacity') is told the
   *  same thing (`opacityFade`). */
  showFade?: boolean;
  onChange: (o: OpacityModel) => void;
  onCommit: (o: OpacityModel) => void;
  /** The trailing circle's press: the host's full colour picker, which is
   *  where the fade's target is chosen. */
  onOpenFadePicker?: () => void;
}) {
  const set = (patch: Partial<OpacityModel>, committed: boolean) =>
    (committed ? onCommit : onChange)({ ...opacity, ...patch });
  return (
    <BarBody>
      {/* An opacity: the alpha checker under the ramp, so its empty end
          reads as see-through. Fade is not one — it is a walk toward a
          colour, and its far end is as opaque as its near one. */}
      <SliderRow label="Opacity" value={opacity.opacity} checker apply={(t, c) => set({ opacity: t }, c)} />
      {showFade && onOpenFadePicker ? (
        <FadeSliderRow
          label="Fade"
          value={opacity.fade}
          color={opacity.fadeColor}
          from={fadeFrom}
          apply={(t, c) => set({ fade: t }, c)}
          onOpenPicker={onOpenFadePicker}
        />
      ) : null}
    </BarBody>
  );
}
