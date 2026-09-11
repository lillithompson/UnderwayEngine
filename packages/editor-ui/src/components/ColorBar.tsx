import React from 'react';
import { BarBody, MultiToggleRow } from './effectBar';

// The Color page: what a selection can change about its colours, one row
// each. A word sticker's colours are its card scheme — light card / dark
// ink or the inverse — so its one row is the Invert toggle, a chip that
// lights while the scheme is flipped. (Selections with colours to pick will
// list a labelled swatch row per colour here.)

export type ColorRowSpec = {
  key: string;
  kind: 'toggle';
  /** The chip's word (and accessibility name), e.g. "Invert". */
  label: string;
  on: boolean;
  onToggle: () => void;
};

export function ColorBar({ rows }: { rows: readonly ColorRowSpec[] }) {
  return (
    <BarBody>
      {rows.map((row) => (
        <MultiToggleRow
          key={row.key}
          options={[{ value: 'on' as const, label: row.label, active: row.on }]}
          onToggle={() => row.onToggle()}
        />
      ))}
    </BarBody>
  );
}
