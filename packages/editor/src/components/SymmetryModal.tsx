import React from 'react';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { PUSHDOWN_INACTIVE, STATE_ACTIVE } from '@/editor-ui/theme';
import {
  PATTERN_SYMMETRY_ENTRIES,
  patternSymmetryKey,
} from '@/editor-ui/logic/patternEdit';
import type { PatternSymmetry } from '@/engine/types';
import { ToolGridSheet, type ToolGridCell } from './ToolGridSheet';

// The Symmetry mode picker — the canvas's, and an open pattern fill's
// (the shell mounts it once for each): a 4×3 grid of None plus the eleven
// modes, icon over a small label, the active mode highlighted.
//
// A SHEET rising from the bottom, where it was a full-screen takeover —
// the one shared grid sheet (ToolGridSheet), which owns the cells, their
// sizing and their styles; this file is only the table that fills it. Its
// own rule always was that a pick is not a dismissal — so modes can be
// compared against the live canvas — which a takeover made impossible by
// covering the canvas. Now the drawing stays in view and the comparison
// is the thing you are actually doing.
//
// Unlike the shape grid beside it, the lit cell stays: symmetry is a MODE
// the canvas is in, and a picker for a state has to say which state.
// Tapping the ACTIVE mode turns symmetry off (Facet's toggle-off rule),
// as does None. The way out is a tap anywhere off the sheet — there is no
// Done, because nothing here is waiting to be confirmed.
// The mode table is the editor-ui symmetry grid the per-pattern Symmetry
// bar already uses — same keys, same order — with Facet's icons laid over
// it (symmetryModalMeta).
import { SYMMETRY_MODE_ICONS } from './symmetryModalMeta';

// The Shapes grid's own columns, so the two sheets' buttons are one size:
// twelve cells in three full rows of four. It was three columns of bigger
// cells, which stood a row taller over the canvas than the sheet beside
// it for no more to read.
const COLS = 4;
// The active cell wears the editor-wide selection blue (STATE_ACTIVE) with
// white ink — the same selected-cell rule as every other lit control.
// EXCEPT None: symmetry off highlighted in the selection blue would claim
// a feature is on, so the lit None cell is grey — the same exception the
// toolbar pushdown's picker makes (ToolbarModePicker's mutedKey).
const ACTIVE_BG = STATE_ACTIVE;
const ACTIVE_OFF_BG = PUSHDOWN_INACTIVE;

export function SymmetryModal({
  visible,
  flags,
  onSet,
  onDismiss,
  bottomInset,
}: {
  visible: boolean;
  /** The current canvas symmetry (undefined = off). */
  flags: PatternSymmetry | undefined;
  /** Chosen flags — undefined turns symmetry off. */
  onSet: (flags: PatternSymmetry | undefined) => void;
  onDismiss: () => void;
  /** Home-indicator clearance under the grid. */
  bottomInset?: number;
}) {
  const currentKey = patternSymmetryKey(flags);
  // None leads the grid: symmetry off as a first-class pick, not only the
  // re-tap-the-active-mode gesture. Its flags are undefined (what onSet
  // reads as "clear"), and it wears the highlight when no mode is on —
  // patternSymmetryKey's own 'off'.
  type ModalEntry = { key: string; label: string; flags: PatternSymmetry | undefined };
  const entries: ModalEntry[] = [
    { key: 'off', label: 'None', flags: undefined },
    ...PATTERN_SYMMETRY_ENTRIES,
  ];
  const cells: ToolGridCell[] = entries.map((entry) => {
    const active = entry.key === currentKey;
    const icon = SYMMETRY_MODE_ICONS[entry.key];
    return {
      key: entry.key,
      label: entry.label,
      accessibilityLabel: `Symmetry: ${entry.label}`,
      active,
      activeBackground: entry.key === 'off' ? ACTIVE_OFF_BG : ACTIVE_BG,
      // Facet's toggle-off rule: re-picking the active mode clears
      // symmetry — as does None, whose flags are undefined outright.
      onPress: () => onSet(active || !entry.flags ? undefined : { ...entry.flags }),
      glyph: (size, color) => (
        <MaterialCommunityIcons
          name={icon.icon as never}
          size={size}
          color={color}
          style={icon.mirrored ? { transform: [{ scaleX: -1 }] } : undefined}
        />
      ),
    };
  });
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
