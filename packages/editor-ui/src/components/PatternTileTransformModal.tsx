import React from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {
  mirrorPatternTileTransform,
  patternTileThumbTransforms,
  rotatePatternTileTransform,
  type PatternTileTransform,
} from '../logic/patternEdit';
import {
  MODAL_OVERLAY, PANEL_BG, PANEL_BORDER, PANEL_INK, PANEL_INK_DIM, PANEL_TRACK,
} from '../theme';

// The tile menus' long-press takeover: one tile, large, with the pose
// controls under it — rotate a quarter turn, flip either axis (Facet's
// TileModal, minus the favorites heart this editor doesn't keep). Every
// press calls straight through to onChange with the composed pose; the
// preview re-renders from the prop, so what the card shows is exactly what
// the host now holds — and what the next stamp lays.
//
// It wears the PANEL scheme for the same reason PatternTileModal does: the
// host bakes tile thumbnails in PANEL_INK, which would vanish on the dark
// MODAL card.

export const PATTERN_TRANSFORM_PREVIEW = 120;

export function PatternTileTransformModal({ visible, uri, transform, onChange, onClose }: {
  visible: boolean;
  /** The tile's baked thumbnail (PatternTileRow.uri). */
  uri: string | null;
  transform: PatternTileTransform;
  onChange: (transform: PatternTileTransform) => void;
  onClose: () => void;
}) {
  if (!visible || !uri) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.dimmer} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.contentLayer} pointerEvents="box-none">
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>TILE</Text>
            <Pressable
              style={styles.closeIcon}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <MaterialCommunityIcons name="close" size={22} color={PANEL_INK} />
            </Pressable>
          </View>
          <View style={styles.body}>
            <View style={styles.thumbWrap}>
              <Image
                source={{ uri }}
                style={[styles.thumb, { transform: patternTileThumbTransforms(transform) }]}
              />
            </View>
            <View style={styles.btnRow}>
              <Pressable
                style={styles.actionBtn}
                onPress={() => onChange(rotatePatternTileTransform(transform))}
                accessibilityRole="button"
                accessibilityLabel="Rotate"
              >
                <MaterialCommunityIcons name="rotate-right" size={26} color={PANEL_INK_DIM} />
              </Pressable>
              <Pressable
                style={styles.actionBtn}
                onPress={() => onChange(mirrorPatternTileTransform(transform, 'h'))}
                accessibilityRole="button"
                accessibilityLabel="Flip horizontal"
              >
                <MaterialCommunityIcons name="flip-horizontal" size={26} color={PANEL_INK_DIM} />
              </Pressable>
              <Pressable
                style={styles.actionBtn}
                onPress={() => onChange(mirrorPatternTileTransform(transform, 'v'))}
                accessibilityRole="button"
                accessibilityLabel="Flip vertical"
              >
                <MaterialCommunityIcons name="flip-vertical" size={26} color={PANEL_INK_DIM} />
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dimmer: { ...StyleSheet.absoluteFillObject, backgroundColor: MODAL_OVERLAY },
  contentLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: 240,
    maxWidth: '100%',
    backgroundColor: PANEL_BG,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 16,
    paddingRight: 4,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: PANEL_BORDER,
  },
  title: { color: PANEL_INK, fontSize: 13, fontWeight: '700', letterSpacing: 1.2 },
  closeIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 16, alignItems: 'center' },
  thumbWrap: {
    width: PATTERN_TRANSFORM_PREVIEW,
    height: PATTERN_TRANSFORM_PREVIEW,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: PANEL_TRACK,
    marginBottom: 16,
  },
  thumb: {
    width: PATTERN_TRANSFORM_PREVIEW - 16,
    height: PATTERN_TRANSFORM_PREVIEW - 16,
  },
  btnRow: { flexDirection: 'row', gap: 16 },
  actionBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: PANEL_TRACK,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
