import React from 'react';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { BLEND_MODES, MODE_LABEL } from '@/editor/colorBlendModes';
import type { BlendMode } from '@/engine/types';
import { PAINT_RADIAL_BLEND_ICONS } from '../sliderModeMenu';
import { ToolGridSheet, type ToolGridCell } from '@/editor/components/ToolGridSheet';

// The Blend capsule's More doorway: every blend mode the brush can hold,
// as a 2×5 grid — icon over a small label — in Facet's own grid order,
// the same one the colour picker's blend grid reads (BLEND_MODES).
//
// A SHEET rising from the bottom, the shape grid's shape exactly — the
// one shared grid sheet (ToolGridSheet), which owns the cells, their
// sizing and their styles; this file is only the table that fills it.
// What a dab does to the paint under it is judged against the paint that
// is already there, and a full-screen takeover answers that by hiding the
// page. The capsule stays up behind it, so the mode a pick arms can be
// read in its own segment the moment the sheet drops.
//
// Unlike the shape grid — where nothing is shown as chosen, because every
// cell is a thing to ADD — the armed mode is LIT here, on the symmetry
// sheet's rule: a blend mode is a state the brush is IN, and a picker for
// a state has to say which state. Only three modes ever show in the
// capsule (Normal and the two most recently used), so this grid is the
// one place the rest can be seen at all, let alone compared.
//
// A press arms the mode and closes the sheet, so the next stroke blends
// that way — and so does a tap anywhere off it, which arms nothing.

const COLS = 5;

export function BlendPickerModal({ visible, current, onPick, onDismiss, bottomInset }: {
  visible: boolean;
  /** The mode the brush is blending with — the lit cell. */
  current: BlendMode;
  /** Arm this mode — the caller closes the sheet and keeps the brush. */
  onPick: (mode: BlendMode) => void;
  onDismiss: () => void;
  /** Home-indicator clearance under the grid. */
  bottomInset?: number;
}) {
  const cells: ToolGridCell[] = BLEND_MODES.map((mode) => ({
    key: mode,
    label: MODE_LABEL[mode],
    accessibilityLabel: `Blend: ${MODE_LABEL[mode]}`,
    active: mode === current,
    onPress: () => onPick(mode),
    glyph: (size, color) => (
      <MaterialCommunityIcons
        name={PAINT_RADIAL_BLEND_ICONS[mode] as never}
        size={size}
        color={color}
      />
    ),
  }));
  return (
    <ToolGridSheet
      visible={visible}
      onDismiss={onDismiss}
      bottomInset={bottomInset}
      cols={COLS}
      cells={cells}
    />
  );
}
