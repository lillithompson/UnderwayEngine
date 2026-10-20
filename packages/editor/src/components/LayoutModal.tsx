import React from 'react';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { AlignEdge } from '@/editor-ui';
import { ToolGridSheet, type ToolGridCell } from './ToolGridSheet';
import { LAYOUT_SHEET_ACTIONS, LAYOUT_SHEET_COLS } from './layoutSheetMeta';

// The multi-selection's Layout options: where the members sit relative to
// each other. Reached from the floating Group | Merge | Layout capsule: the
// aligns the engine's builders serve, then Arrange in grid, and Straighten
// (every member's turn to the nearest quarter). The table and its order
// are layoutSheetMeta's.
//
// A SHEET rising from the bottom, as Blend, Shapes and Symmetry are — the
// one shared grid sheet (ToolGridSheet), which owns the cells, their
// sizing and their styles; this file is only the table that fills it. An
// align is judged by looking at the members it moved, and a full-screen
// takeover answered that by hiding them.
//
// No heading and no section labels, like the sheets beside it: every cell
// says what it does in its own words ("Align left", "Align top"), and the
// ROWS carry the grouping the labels used to — the horizontal aligns
// across the first, the vertical across the second, and the two actions
// that are not aligns down the last column. Two rows of four, where it
// was three rows under three labels: more of the members being aligned
// stays in view above the sheet.
//
// Every cell is a MOMENTARY action, not a pick: each tap is one finished
// edit (one undo step) and the sheet stays open so aligns can be stacked —
// align left, then top — which is why the cells light only while pressed
// and the way out is the sheet's own: a tap off it, or a swipe down.

/** One action's glyph: an icon-font name drawn at the cell's size and ink. */
function actionGlyph(icon: string): ToolGridCell['glyph'] {
  return (size, color) => (
    <MaterialCommunityIcons name={icon as never} size={size} color={color} />
  );
}

export function LayoutModal({ visible, onAlign, onGrid, onStraighten, onDismiss, bottomInset }: {
  visible: boolean;
  /** Fires once per tap — an align is always a finished edit. */
  onAlign: (edge: AlignEdge) => void;
  /** Reflow the members into a grid — same one-tap-one-edit rule. */
  onGrid: () => void;
  /** Turn every member to its nearest quarter — the same rule again. */
  onStraighten: () => void;
  onDismiss: () => void;
  /** Home-indicator clearance under the grid. */
  bottomInset?: number;
}) {
  // Every cell is momentary, and named for a screen reader by its own
  // label, which already says the whole of what it does.
  const cells: ToolGridCell[] = LAYOUT_SHEET_ACTIONS.map((a) => ({
    key: a.kind === 'align' ? a.edge : a.kind,
    label: a.label,
    accessibilityLabel: a.label,
    momentary: true,
    onPress: a.kind === 'align' ? () => onAlign(a.edge)
      : a.kind === 'grid' ? onGrid
      : onStraighten,
    glyph: actionGlyph(a.icon),
  }));
  return (
    <ToolGridSheet
      visible={visible}
      onDismiss={onDismiss}
      bottomInset={bottomInset}
      cols={LAYOUT_SHEET_COLS}
      cells={cells}
    />
  );
}
