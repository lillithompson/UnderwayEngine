import React from 'react';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { AlignEdge } from '../adapter';
import type { AlignOption } from '../logic/layout';
import { HORIZONTAL_ALIGN_OPTIONS, VERTICAL_ALIGN_OPTIONS } from '../logic/layout';
import { ActionRow, BarBody } from './effectBar';

// The Layout page: where a MULTI-selection's members sit relative to each
// other. A sibling of the Stroke / Fill / Endpoints pages sharing their
// grammar (see effectBar.tsx), with up to three rows — Horizontal pushes
// every member to the left edge, the centre line, or the right edge of the
// selection's combined box; Vertical does the same top / middle / bottom;
// Arrange reflows them into a grid instead of pushing them at an edge.
//
// The Arrange row renders only when the host supplies `onGrid`, and
// submenuHeight('layout') is told the same thing (`layoutHasGrid`) so the
// sheet reserves two rows or three to match.
//
// No color swatch (nothing here is colored) and nothing to remove: an align
// has no state to remove — undo is the way back, the same as any other move.
// Every control is an action rather than a pick, so the cells light only
// while held (ActionRow) and each tap is one finished edit, i.e. one undo
// step — which is why `onAlign` takes no `committed` flag.

type MCIName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/** An align option as a row cell: the edge is the value, the glyph is the
 *  whole label (the written name stays on for accessibility). The tables keep
 *  `icon` a plain string so they stay pure of react-native, so the widening
 *  happens here — once, at module load, rather than on every render. */
const toCell = (o: AlignOption) => ({ value: o.edge, label: o.label, icon: o.icon as MCIName });
const H_CELLS = HORIZONTAL_ALIGN_OPTIONS.map(toCell);
const V_CELLS = VERTICAL_ALIGN_OPTIONS.map(toCell);
/** The Arrange row's one cell. Alone in its row rather than tacked onto
 *  Vertical: it is not an align, and a lone cell reads as the action it is. */
const GRID_CELLS = [
  { value: 'grid' as const, label: 'Arrange in grid', icon: 'view-grid-outline' as MCIName },
];

export function LayoutBar({ onAlign, onGrid }: {
  /** Fires once per tap — an align is always a finished edit. */
  onAlign: (edge: AlignEdge) => void;
  /** Lay the members out as a grid. Omit and the Arrange row doesn't render. */
  onGrid?: () => void;
}) {
  return (
    <BarBody>
      <ActionRow label="Horizontal" options={H_CELLS} onPress={onAlign} />
      <ActionRow label="Vertical" options={V_CELLS} onPress={onAlign} />
      {onGrid ? (
        <ActionRow label="Arrange" options={GRID_CELLS} onPress={onGrid} />
      ) : null}
    </BarBody>
  );
}
