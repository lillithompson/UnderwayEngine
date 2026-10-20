import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { SwatchPresetItem, SwatchStateItem, SwatchStateStyle } from '../adapter';
import {
  SWATCH_GLYPH_SIZE, SWATCH_MAX_WIDTH, SWATCH_PRESET_HEIGHT, SWATCH_PRESET_PAD, SWATCH_RING_WIDTH,
  SWATCH_STATE_CAPTION, SWATCH_STATE_CAPTION_LINE,
  SWATCH_STATE_GAP, SWATCH_STATE_LABEL, SWATCH_STATE_SIZE,
} from '../logic/submenuHeight';
import { swatchInk } from '../logic/hsv';
import { PANEL_INK, PANEL_INK_LABEL, PANEL_INK_MUTED, PANEL_SWATCH_BORDER } from '../theme';
import { ColorSwatchFill } from './ColorSwatch';

// A row of colour swatches, each in one of a few states, with a
// one-sentence caption under them (a host page's `swatchStates` row). The
// states, their rings and glyphs, and the caption are the caller's: a
// host's rules page passes its palette × off / attract / repel, say. A tap
// reports the swatch's id; the host decides the next state and writes it
// (one undo step), so the row holds no state of its own.
//
// Nine swatches share one line: at an iPhone SE's content width they are
// about 28 pt wide — the colour picker's own swatches are 30 — and a
// fixed SWATCH_STATE_SIZE tall, so the row's height is the arithmetic in
// submenuHeight.ts whatever the width. Every swatch keeps the same ring
// width so the colour inside never shifts between states; the ring's
// colour and dash are what change.
//
// The glyph is drawn ON the colour, so its ink FLIPS with the swatch's
// own luma (logic/hsv `swatchInk`, the package's one answer to "what
// reads on this colour"). A palette's nine entries may every one be light
// enough for the panel's ink, and a host's tenth swatch BLACK, where a
// #2a2a2a glyph was one nobody could see.
//
// The label line can carry one-tap PRESETS at its right: a row's All and
// None, which set every swatch at once. They go there and not in the swatch line because they are not
// swatches — they name no colour and hold no state — and because eleven
// things across an iPhone SE's sheet would take every swatch below the
// width at which it still reads as a colour. The label line was empty to
// the right of its word, and this costs the row no height, so
// ROW_SWATCH_STATES and every sheet built on it are untouched. A preset
// reports through the same `onTap` as a swatch; its id is the caller's to
// keep distinct.
//
// …and it is drawn SMALL (SWATCH_GLYPH_SIZE). Ten swatches on an iPhone
// SE are about 25 pt wide, and a 16 pt glyph sized for nine covered the
// colour almost edge to edge there — the swatch stopped
// saying which colour its rule was on, which is the one thing it is there
// to say. The row holds no state and reads no
// layout (gatesSourcePin pins that), so the size is a constant that has
// to work at both ends of the range rather than a measurement.

type MCIName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const RING_WIDTH = SWATCH_RING_WIDTH;

const DEFAULT_STYLE: SwatchStateStyle = { ring: 'grey' };

export function SwatchStateRow({ label, items, states, caption, presets, disabled = false, onTap }: {
  /** The row's caption over the swatches; none to omit. */
  label?: string;
  /** The swatches in order, each naming its state. */
  items: readonly SwatchStateItem[];
  /** One-tap presets at the right of the label line; none to omit. */
  presets?: readonly SwatchPresetItem[];
  /** How each state draws, keyed by the state's name. */
  states: Readonly<Record<string, SwatchStateStyle>>;
  /** One sentence under the row describing the whole. */
  caption: string;
  /** Dimmed and inert (a host's row while its run is live). */
  disabled?: boolean;
  /** A tap on a swatch, by its id. */
  onTap: (id: string) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.head}>
        {label ? <Text style={styles.label}>{label}</Text> : null}
        {presets?.length ? (
          <View style={[styles.presets, disabled && styles.swatchesDisabled]} pointerEvents={disabled ? 'none' : 'auto'}>
            {presets.map((preset) => (
              <Pressable
                key={preset.id}
                accessibilityRole="button"
                accessibilityLabel={preset.label}
                accessibilityState={{ disabled }}
                hitSlop={SWATCH_PRESET_PAD}
                onPress={() => onTap(preset.id)}
                style={styles.preset}
              >
                <Text style={styles.presetLabel}>{preset.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
      <View style={[styles.swatches, disabled && styles.swatchesDisabled]} pointerEvents={disabled ? 'none' : 'auto'}>
        {items.map((item) => {
          const style = states[item.state] ?? DEFAULT_STYLE;
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              accessibilityState={{ disabled }}
              onPress={() => onTap(item.id)}
              style={[styles.swatch, RINGS[style.ring]]}
            >
              <ColorSwatchFill color={item.color} />
              {style.glyph ? (
                <MaterialCommunityIcons
                  name={style.glyph as MCIName}
                  size={SWATCH_GLYPH_SIZE}
                  color={swatchInk(item.color)}
                />
              ) : null}
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.caption} numberOfLines={2}>{caption}</Text>
    </View>
  );
}

const RINGS: Record<SwatchStateStyle['ring'], { borderColor: string; borderStyle: 'solid' | 'dashed' }> = {
  grey: { borderColor: PANEL_SWATCH_BORDER, borderStyle: 'solid' },
  solid: { borderColor: PANEL_INK, borderStyle: 'solid' },
  dashed: { borderColor: PANEL_INK, borderStyle: 'dashed' },
};

const styles = StyleSheet.create({
  row: { paddingVertical: 0 },
  // The label and the presets share one line, so the row keeps its height.
  head: { flexDirection: 'row', alignItems: 'center', height: SWATCH_STATE_LABEL },
  label: { flex: 1, color: PANEL_INK_LABEL, fontSize: 12, height: SWATCH_STATE_LABEL, lineHeight: 16 },
  presets: { flexDirection: 'row', gap: SWATCH_PRESET_PAD },
  preset: {
    height: SWATCH_PRESET_HEIGHT, paddingHorizontal: SWATCH_PRESET_PAD, borderRadius: SWATCH_PRESET_HEIGHT / 2,
    borderWidth: 1, borderColor: PANEL_SWATCH_BORDER, alignItems: 'center', justifyContent: 'center',
  },
  presetLabel: { color: PANEL_INK_LABEL, fontSize: 11, lineHeight: 13 },
  swatches: { flexDirection: 'row', gap: SWATCH_STATE_GAP, height: SWATCH_STATE_SIZE },
  swatchesDisabled: { opacity: 0.4 },
  // overflow:hidden clips ColorSwatchFill to the rounded ring.
  swatch: {
    flex: 1, maxWidth: SWATCH_MAX_WIDTH, height: SWATCH_STATE_SIZE, borderRadius: 8, borderWidth: RING_WIDTH,
    overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
  },
  caption: {
    height: SWATCH_STATE_CAPTION, paddingTop: 4, color: PANEL_INK_MUTED, fontSize: 11,
    lineHeight: SWATCH_STATE_CAPTION_LINE,
  },
});
