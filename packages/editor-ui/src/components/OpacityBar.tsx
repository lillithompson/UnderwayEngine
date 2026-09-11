import React from 'react';
import type { OpacityModel } from '../adapter';
import { BarBody, SliderRow } from './effectBar';

// The Opacity page: two rows — Opacity (the whole object's render opacity)
// and Soften (how far the edges fade to transparent: 0 = hard edges, 1 = the
// object is transparent toward its edges). Shared by images, paint islands,
// the closed vector shapes (rectangle / circle), rigs and word stickers;
// there is no color, so no swatch — and no Remove line under it: opacity is
// not a layer an object can be without, so there is nothing to take away
// (undo is the way back). A word sticker fades as a whole and offers no
// soften, so it drops the second row (`showSoften`).
//
// Both sliders map 0–1 directly, so unlike the Border page there are no range
// constants to keep in sync with the app.

export function OpacityBar({ opacity, showSoften = true, onChange, onCommit }: {
  opacity: OpacityModel;
  /** Render the Soften row. Off for a selection with no edge to feather (a
   *  word sticker's card). submenuHeight('opacity') is told the same thing
   *  (`opacitySoften`). */
  showSoften?: boolean;
  onChange: (o: OpacityModel) => void;
  onCommit: (o: OpacityModel) => void;
}) {
  const set = (patch: Partial<OpacityModel>, committed: boolean) =>
    (committed ? onCommit : onChange)({ ...opacity, ...patch });
  return (
    <BarBody>
      {/* An opacity: the alpha checker under the ramp, so its empty end
          reads as see-through. Soften is not one (hard → faded edges). */}
      <SliderRow label="Opacity" value={opacity.opacity} checker apply={(t, c) => set({ opacity: t }, c)} />
      {showSoften ? (
        <SliderRow label="Soften" value={opacity.edgeSoften} apply={(t, c) => set({ edgeSoften: t }, c)} />
      ) : null}
    </BarBody>
  );
}
