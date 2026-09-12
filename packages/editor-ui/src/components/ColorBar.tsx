import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { RGBLike } from '../adapter';
import { ROW_SEGMENTED } from '../logic/submenuHeight';
import { PANEL_INK, PANEL_SWATCH_BORDER } from '../theme';
import { ColorSwatchFill } from './ColorSwatch';
import { BarBody, MultiToggleRow } from './effectBar';

// The Color page: every colour a selection can pick, one labelled row each
// — a shape's Fill and Stroke, an image's Shadow and Border, a text's ink
// and Shadow, a frame's Background — so the colours live in one place
// rather than as a swatch on each effect's page. Tapping a row opens the
// host's full-screen picker for that colour (the same picker the swatches
// used to). A word sticker's colours are its card scheme — light card /
// dark ink or the inverse — so its one row is the Invert toggle, a chip
// that lights while the scheme is flipped.

export type ColorRowSpec =
  | {
      key: string;
      kind: 'swatch';
      /** The row's word, e.g. "Stroke", "Shadow", "Background". */
      label: string;
      /** The colour the swatch previews (a translucent one over the alpha
       *  checker, like every swatch in the package). */
      color?: RGBLike;
      onPick: () => void;
    }
  | {
      key: string;
      kind: 'toggle';
      /** The chip's word (and accessibility name), e.g. "Invert". */
      label: string;
      on: boolean;
      onToggle: () => void;
    };

/** The swatch a Color row shows: a circle one row tall, the colour inside a
 *  ring. */
const SWATCH = 28;

function SwatchRow({ row }: { row: Extract<ColorRowSpec, { kind: 'swatch' }> }) {
  return (
    <Pressable
      onPress={row.onPick}
      accessibilityRole="button"
      accessibilityLabel={`${row.label} color`}
      style={styles.swatchRow}
    >
      <View style={styles.swatch}>
        <View style={styles.swatchClip}>
          {row.color ? <ColorSwatchFill color={row.color} /> : null}
        </View>
      </View>
      <Text style={styles.swatchLabel}>{row.label}</Text>
    </Pressable>
  );
}

/** The colour rows themselves, with no body around them — so a page that
 *  holds MORE than colours (the text's own Text page, which pairs them with
 *  Size) can lay them in its own body rather than restating them. The one
 *  definition both that page and {@link ColorBar} render. */
export function ColorRows({ rows }: { rows: readonly ColorRowSpec[] }) {
  return (
    <>
      {rows.map((row) => (row.kind === 'swatch' ? (
        <SwatchRow key={row.key} row={row} />
      ) : (
        <MultiToggleRow
          key={row.key}
          options={[{ value: 'on' as const, label: row.label, active: row.on }]}
          onToggle={() => row.onToggle()}
        />
      )))}
    </>
  );
}

export function ColorBar({ rows }: { rows: readonly ColorRowSpec[] }) {
  return (
    <BarBody>
      <ColorRows rows={rows} />
    </BarBody>
  );
}

const styles = StyleSheet.create({
  // One segmented row tall (submenuHeight counts a Color row as one), the
  // swatch then its word; the whole row is the target.
  swatchRow: { height: ROW_SEGMENTED, flexDirection: 'row', alignItems: 'center', gap: 12 },
  swatch: {
    width: SWATCH, height: SWATCH, borderRadius: SWATCH / 2,
    borderWidth: 1.5, borderColor: PANEL_SWATCH_BORDER,
    shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 3, shadowOffset: { width: 0, height: 1 },
  },
  // Clips the fill to the circle, inside the border — its own inner layer
  // because `overflow: hidden` on the outer would take the swatch's drop
  // shadow with it (RN maps it to clipsToBounds).
  swatchClip: { ...StyleSheet.absoluteFillObject, borderRadius: SWATCH / 2, overflow: 'hidden' },
  swatchLabel: { color: PANEL_INK, fontSize: 14, fontWeight: '500' },
});
