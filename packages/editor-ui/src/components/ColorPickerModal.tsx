import React, { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ColorPickerModel, RGBLike } from '../adapter';
import { buildPaletteGrid, colorAlpha, rgbCss, withAlpha } from '../logic/hsv';
import {
  MODAL_BG,
  MODAL_BORDER,
  MODAL_HEADER_BG,
  MODAL_OVERLAY,
  MODAL_RAISED,
  MODAL_TEXT,
  STATE_ACTIVE,
} from '../theme';
import { ColorSwatchFill } from './ColorSwatch';
import { Slider } from './Slider';

// Fallback color picker (no WebGL / expo-gl): a deterministic HSV swatch
// grid + an Opacity slider + a live preview, behind the ColorPickerModel
// contract. Facet's GLView HSV picker can replace this later without touching
// the model — the gl picker was gated on verifying expo-gl in the WKWebView
// bundle, which isn't confirmed, so the shared package ships the
// dependency-free grid.
//
// Hue and opacity are one color, not two settings: the slider writes
// `RGBLike.a` on the same color the grid picks, so opacity rides along
// wherever the host puts the color and needs no second plumbing path.

// The swatch grid is opaque by construction, so the selected-swatch ring
// compares RGB only — matching on alpha too would un-select the grid the
// moment the opacity left 100%, when the hue chosen hasn't changed at all.
const sameColor = (a: RGBLike, b: RGBLike) =>
  Math.round(a.r) === Math.round(b.r) &&
  Math.round(a.g) === Math.round(b.g) &&
  Math.round(a.b) === Math.round(b.b);

export function ColorPickerModal({ model }: { model: ColorPickerModel }) {
  const grid = useMemo(() => buildPaletteGrid(), []);
  // Alpha mid-drag. The slider is only locally authoritative while the finger
  // is down (`null` otherwise) so hosts that don't take `onPreview` still get
  // a picker that tracks the drag, then one committed `onChange` on release.
  const [dragAlpha, setDragAlpha] = useState<number | null>(null);
  const alpha = dragAlpha ?? colorAlpha(model.color);
  // What the preview + a swatch tap use: the model's color at the live alpha.
  const previewColor = withAlpha(model.color, alpha);

  const setAlpha = (a: number, committed: boolean) => {
    if (committed) {
      setDragAlpha(null);
      model.onChange(withAlpha(model.color, a));
    } else {
      setDragAlpha(a);
      model.onPreview?.(withAlpha(model.color, a));
    }
  };

  return (
    <Modal visible={model.visible} transparent animationType="fade" onRequestClose={model.onClose}>
      <Pressable style={styles.overlay} onPress={model.onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title}>Color</Text>
            <View style={styles.preview}>
              <ColorSwatchFill color={previewColor} />
            </View>
          </View>
          <View style={styles.body}>
            {grid.map((row, ri) => (
              <View key={ri} style={styles.row}>
                {row.map((c, ci) => {
                  const selected = sameColor(c, model.color);
                  return (
                    <Pressable
                      key={ci}
                      accessibilityRole="button"
                      accessibilityLabel={rgbCss(c)}
                      // Picking a hue keeps the opacity you already dialled in —
                      // the two controls edit different halves of one color.
                      onPress={() => model.onChange(withAlpha(c, alpha))}
                      style={[
                        styles.swatch,
                        { backgroundColor: rgbCss(c) },
                        selected && styles.swatchSelected,
                      ]}
                    />
                  );
                })}
              </View>
            ))}
            {/* Opacity sits under the grid, label + readout over a full-width
                track: the card is only as wide as five swatches, so a
                label-beside-slider row would leave the slider unusably short. */}
            {model.showOpacity !== false && (
              <View style={styles.opacity}>
                <View style={styles.opacityHead}>
                  <Text style={styles.opacityLabel}>Opacity</Text>
                  <Text style={styles.opacityValue}>{`${Math.round(alpha * 100)}%`}</Text>
                </View>
                <Slider
                  value={alpha}
                  // The filled track is the color itself, so the slider reads as
                  // "how much of this color", not as generic chrome.
                  accent={rgbCss(withAlpha(model.color, 1))}
                  onChange={(v) => setAlpha(v, false)}
                  onCommit={(v) => setAlpha(v, true)}
                />
              </View>
            )}
            <View style={styles.footer}>
              {/* Eyedropper (Facet parity): sits with the swatches because it
                  picks a color like they do — it just takes it off the canvas.
                  Closing first is the host's job; the picker would cover the
                  pixels being sampled. */}
              {model.onEyedropper && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Pick a color from the canvas"
                  onPress={model.onEyedropper}
                  style={styles.eyedropper}
                >
                  <MaterialCommunityIcons name="eyedropper" size={20} color="#333" />
                </Pressable>
              )}
              <Pressable style={styles.done} onPress={model.onClose}>
                <Text style={styles.doneText}>Done</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const SWATCH = 30;

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: MODAL_OVERLAY },
  card: {
    backgroundColor: MODAL_BG,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: MODAL_BORDER,
    overflow: 'hidden',
    maxWidth: '92%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: MODAL_HEADER_BG,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  title: { color: MODAL_TEXT, fontSize: 18, fontWeight: '700' },
  // overflow:hidden clips ColorSwatchFill (checkerboard + color) to the circle.
  preview: {
    width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: MODAL_BORDER,
    overflow: 'hidden',
  },
  body: { padding: 12, gap: 6 },
  row: { flexDirection: 'row', gap: 6 },
  swatch: { width: SWATCH, height: SWATCH, borderRadius: 6 },
  swatchSelected: { borderWidth: 3, borderColor: STATE_ACTIVE },
  // Opacity block: 2pt above the grid's own 6pt row gap, then the label line
  // tight over the track (the Slider carries its own 12pt of vertical hit).
  opacity: { marginTop: 2 },
  opacityHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  opacityLabel: { color: MODAL_TEXT, fontSize: 12, opacity: 0.75 },
  opacityValue: { color: MODAL_TEXT, fontSize: 12, fontVariant: ['tabular-nums'] },
  footer: { flexDirection: 'row', alignItems: 'stretch', gap: 6, marginTop: 8 },
  eyedropper: {
    height: 40,
    width: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e0e0e0', // Facet eyedropperSwatch
  },
  done: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: MODAL_RAISED,
  },
  doneText: { color: MODAL_TEXT, fontSize: 13, fontWeight: '700' },
});
