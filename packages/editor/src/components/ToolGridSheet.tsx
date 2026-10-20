import React from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { PANEL_INK, STATE_ACTIVE } from '@/editor-ui/theme';
import { ToolPopover } from './ToolPopover';
import { toolSheetCellSize, toolSheetGlyphSize, toolSheetRows } from './toolSheetGrid';

// The tool menus' shared sheet: a grid of square cells, glyph over a small
// label, rising from the bottom over the canvas (ToolPopover). Blend,
// Shapes, Symmetry and Layout are all this — the same thing with a
// different table in it — and each used to carry its own copy of the
// grid, the cell and the cell's styles, which is how they drifted
// (Symmetry's cells a third bigger than Shapes', Layout under a heading
// and section labels the others never had). The table is the caller's;
// everything about how it is drawn is here.
//
// No title. The sheet is opened from a capsule that already names what it
// holds, and every cell wears its own label, so a heading over the grid
// only spent canvas height saying it again.
//
// A DOM-free component, like the popover it wraps: RN primitives only. The
// glyph is the caller's (an icon font here, an inline <svg> there), handed
// the size and ink the cell wants it drawn in.

/** One cell of a tool sheet's grid. */
export interface ToolGridCell {
  key: string;
  /** The small label under the glyph. */
  label: string;
  /** What a screen reader says: the sheet's subject and the cell's own
   *  name ("Blend: Multiply"), since the sheet has no heading to give the
   *  subject. */
  accessibilityLabel: string;
  onPress: () => void;
  /** LIT — for a grid whose cells are a state the subject is IN (a blend
   *  mode, a symmetry). Leave it out on a grid of things to add (Shapes),
   *  where no cell is ever "the chosen one". */
  active?: boolean;
  /** The lit cell's ground, where the selection blue would say the wrong
   *  thing (Symmetry's None: off, lit in blue, would claim a feature is
   *  on). */
  activeBackground?: string;
  /** Lit only WHILE PRESSED, for a cell that is an action finished the
   *  moment it is tapped rather than a state to stay lit (Layout's
   *  aligns). */
  momentary?: boolean;
  /** The glyph, drawn `size` wide in `color`. */
  glyph: (size: number, color: string) => React.ReactNode;
}

/** One square cell: glyph over label, lit when `active`, or — `momentary`
 *  — only while pressed. */
function ToolSheetCell({
  size,
  label,
  accessibilityLabel,
  onPress,
  active,
  activeBackground = STATE_ACTIVE,
  momentary = false,
  glyph,
}: Omit<ToolGridCell, 'key'> & {
  /** The cell's edge. */
  size: number;
}) {
  const glyphEdge = toolSheetGlyphSize(size);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={active === undefined ? undefined : { selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.cell,
        { width: size, height: size },
        (active || (momentary && pressed)) && { backgroundColor: activeBackground },
      ]}
    >
      {({ pressed }) => {
        const ink = active || (momentary && pressed) ? '#fff' : PANEL_INK;
        return (
          <>
            {glyph(glyphEdge, ink)}
            <Text style={[styles.cellLabel, { color: ink }]}>{label}</Text>
          </>
        );
      }}
    </Pressable>
  );
}

/** The sheet: `cells` in rows of `cols`, sized to the window by the one
 *  rule every tool sheet shares (toolSheetGrid). */
export function ToolGridSheet({ visible, onDismiss, bottomInset, cols, cells }: {
  visible: boolean;
  onDismiss: () => void;
  /** Home-indicator clearance under the grid. */
  bottomInset?: number;
  cols: number;
  cells: readonly ToolGridCell[];
}) {
  const { width } = useWindowDimensions();
  const cellSize = toolSheetCellSize(width, cols);
  return (
    <ToolPopover visible={visible} onDismiss={onDismiss} bottomInset={bottomInset}>
      <View style={{ width: cols * cellSize }}>
        {toolSheetRows(cells, cols).map((row, ri) => (
          <View key={ri} style={styles.row}>
            {row.map(({ key, ...cell }) => (
              <ToolSheetCell key={key} size={cellSize} {...cell} />
            ))}
          </View>
        ))}
      </View>
    </ToolPopover>
  );
}

/** The one cell style and the one label style every tool sheet draws. */
const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  cell: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  // Centred, so a label too long for a narrow phone's cell wraps under
  // its glyph instead of ragged-left.
  cellLabel: { fontSize: 11, marginTop: 4, textAlign: 'center' },
});
