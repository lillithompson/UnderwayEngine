import React from 'react';
import type { OpacityModel } from '../adapter';
import { BarBody, SliderRow } from './effectBar';

// The Opacity page: two rows — Opacity (the whole object's render opacity)
// and Soften (how far the edges fade to transparent: 0 = hard edges, 1 = the
// object is transparent toward its edges). Shared by images, paint islands
// and the closed vector shapes (rectangle / circle); there is no color, so
// no swatch — and no Remove line under it: opacity is not a layer an object
// can be without, so there is nothing to take away (undo is the way back).
//
// Both sliders map 0–1 directly, so unlike the Border page there are no range
// constants to keep in sync with the app.

export function OpacityBar({ opacity, onChange, onCommit }: {
  opacity: OpacityModel;
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
      <SliderRow label="Soften" value={opacity.edgeSoften} apply={(t, c) => set({ edgeSoften: t }, c)} />
    </BarBody>
  );
}
