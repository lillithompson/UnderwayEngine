import React from 'react';
import type { EndMarkerKind, EndpointsModel } from '../adapter';
import { BarBody, SegmentedRow } from './effectBar';

// The Endpoints page: what an OPEN path's two loose ends carry. A sibling of
// the Stroke / Fill pages sharing their grammar (see effectBar.tsx), with a
// row per end picking that end's marker.
//
// There is no Caps row (round vs square ends) any more. It went from the
// freehand curve first — its ends are wherever the pen lifted, so a cap
// there read as noise — and then from the line, which left only the arc
// holding a control its two siblings had dropped; one subtype's private
// oddity is worse than the choice is worth. Caps a drawing already carries
// (EndpointsModel's startCap / endCap) still render; only the control is
// gone, and the page's Remove resets them with the markers.
//
// No color swatch: a decorated end is drawn in the path's own color, so
// there is nothing here for a picker to change (the Color page owns that
// colour). The sheet's Remove line returns both ends to bare and round —
// the default every path is drawn with — rather than deleting anything.
//
// Every control is a segmented pick, so unlike the slider pages there is no
// live-preview / commit split: each tap is one finished edit, i.e. one undo
// step. That is why `onChange` here takes no `committed` flag.

const MARKERS: readonly { value: EndMarkerKind; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'circle', label: 'Circle' },
  { value: 'arrow', label: 'Arrow' },
];

export function EndpointsBar({ endpoints, onChange }: {
  endpoints: EndpointsModel;
  /** Fires once per tap — a segmented pick is always a finished edit. */
  onChange: (e: EndpointsModel) => void;
}) {
  const set = (patch: Partial<EndpointsModel>) => onChange({ ...endpoints, ...patch });
  return (
    <BarBody>
      <SegmentedRow
        label="Start"
        options={MARKERS}
        value={endpoints.startMarker}
        onChange={(startMarker) => set({ startMarker })}
      />
      <SegmentedRow
        label="End"
        options={MARKERS}
        value={endpoints.endMarker}
        onChange={(endMarker) => set({ endMarker })}
      />
    </BarBody>
  );
}
