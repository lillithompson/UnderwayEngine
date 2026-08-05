import React, { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ColorPickerModel, RGBLike } from '../adapter';
import { buildPaletteGrid, rgbCss } from '../logic/hsv';
import {
  MODAL_BG,
  MODAL_BORDER,
  MODAL_HEADER_BG,
  MODAL_OVERLAY,
  MODAL_RAISED,
  MODAL_TEXT,
  STATE_ACTIVE,
} from '../theme';

// Fallback color picker (no WebGL / expo-gl): a deterministic HSV swatch
// grid + a live preview, behind the ColorPickerModel contract. Facet's
// GLView HSV picker can replace this later without touching the model — the
// gl picker was gated on verifying expo-gl in the WKWebView bundle, which
// isn't confirmed, so the shared package ships the dependency-free grid.

const sameColor = (a: RGBLike, b: RGBLike) =>
  Math.round(a.r) === Math.round(b.r) &&
  Math.round(a.g) === Math.round(b.g) &&
  Math.round(a.b) === Math.round(b.b);

export function ColorPickerModal({ model }: { model: ColorPickerModel }) {
  const grid = useMemo(() => buildPaletteGrid(), []);

  return (
    <Modal visible={model.visible} transparent animationType="fade" onRequestClose={model.onClose}>
      <Pressable style={styles.overlay} onPress={model.onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title}>Color</Text>
            <View style={[styles.preview, { backgroundColor: rgbCss(model.color) }]} />
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
                      onPress={() => model.onChange(c)}
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
  preview: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: MODAL_BORDER },
  body: { padding: 12, gap: 6 },
  row: { flexDirection: 'row', gap: 6 },
  swatch: { width: SWATCH, height: SWATCH, borderRadius: 6 },
  swatchSelected: { borderWidth: 3, borderColor: STATE_ACTIVE },
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
