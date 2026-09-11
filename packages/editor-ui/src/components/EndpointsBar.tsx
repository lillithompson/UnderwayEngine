import React from 'react';
import type { EndCapKind, EndMarkerKind, EndpointsModel } from '../adapter';
import { BarBody, DualSegmentedRow, SegmentedRow } from './effectBar';

// The Endpoints page: what an OPEN path's two loose ends carry. A sibling of
// the Stroke / Fill pages sharing their grammar (see effectBar.tsx), with
// three rows — Start and End pick that end's marker, and Caps picks both
// ends' caps side by side.
//
// No color swatch: a decorated end is drawn in the path's own color, so there
// is nothing here for a picker to change (the Stroke page's swatch already
// owns that color). The sheet's Remove line returns both ends to bare and
// round — the default every path is drawn with — rather than deleting
// anything.
//
// Every control is a segmented pick, so unlike the slider pages there is no
// live-preview / commit split: each tap is one finished edit, i.e. one undo
// step. That is why `onChange` here takes no `committed` flag.

const MARKERS: readonly { value: EndMarkerKind; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'circle', label: 'Circle' },
  { value: 'arrow', label: 'Arrow' },
];

const CAPS: readonly { value: EndCapKind; label: string }[] = [
  { value: 'round', label: 'Round' },
  { value: 'square', label: 'Square' },
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
      <DualSegmentedRow
        label="Caps"
        options={CAPS}
        leftLabel="Start"
        leftValue={endpoints.startCap}
        onLeftChange={(startCap) => set({ startCap })}
        rightLabel="End"
        rightValue={endpoints.endCap}
        onRightChange={(endCap) => set({ endCap })}
      />
    </BarBody>
  );
}
