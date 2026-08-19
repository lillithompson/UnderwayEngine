import React, { useEffect, useRef, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {
  PATTERN_TILE_DOUBLE_TAP_MS,
  PATTERN_TILE_TRANSFORM_IDENTITY,
  groupPatternTiles,
  isPatternTileDoubleTap,
  patternTileThumbTransforms,
  rotatePatternTileTransform,
  type PatternTileRow,
  type PatternTileTransform,
} from '../logic/patternEdit';
import {
  PANEL_BG, PANEL_BORDER, PANEL_INK, PANEL_INK_DIM, PANEL_TRACK, STATE_ACTIVE,
} from '../theme';
import { PatternTileTransformModal } from './PatternTileTransformModal';

// The Tiles bar's takeover: every tile the menu offers, laid out as a grid
// of square buttons. Tapping one arms it; the sheet then excuses itself —
// after the double-tap window, not instantly, because a tile here takes the
// same pose gestures as the bar's recent grid: a second tap inside the
// window turns it a quarter clockwise (cancelling the exit, so the pose can
// keep turning), and a long press opens the transform modal over this one.
// There is still no confirm — the arming already happened on the first tap.
//
// This sheet wears the PANEL scheme rather than the dark MODAL one the
// rename / colour-picker sheets use, and that is not a stylistic whim: the
// host bakes tile thumbnails in PANEL_INK for the light bar, so on a #3f3f3f
// card the entire grid would be near-invisible dark-on-dark.
//
// The grouping by connection count is the old TilePalette's, kept because
// with the whole registry on screen at once it is the only thing that makes
// a particular tile findable.

export const PATTERN_MODAL_TILE = 56;

export function PatternTileModal({ visible, tiles, activeId, transforms, onPick, onSetTransform, onClose }: {
  visible: boolean;
  tiles: readonly PatternTileRow[];
  activeId: string | null;
  /** Each tile's pose, keyed by sprite id (identity when missing). */
  transforms?: Record<string, PatternTileTransform>;
  onPick: (id: string) => void;
  onSetTransform?: (id: string, transform: PatternTileTransform) => void;
  onClose: () => void;
}) {
  const groups = groupPatternTiles(tiles);
  const [transformId, setTransformId] = useState<string | null>(null);
  const lastTapRef = useRef<{ id: string; time: number }>({ id: '', time: 0 });
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimerRef.current != null) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };
  // A re-open (or unmount) must not inherit the previous visit's pending
  // exit or half-open transform card.
  useEffect(() => {
    if (!visible) {
      cancelClose();
      setTransformId(null);
      lastTapRef.current = { id: '', time: 0 };
    }
    return cancelClose;
  }, [visible]);

  const poseOf = (id: string) => transforms?.[id] ?? PATTERN_TILE_TRANSFORM_IDENTITY;
  const transformUri = transformId
    ? tiles.find((t) => t.id === transformId)?.uri ?? null
    : null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.title}>TILES</Text>
          <Pressable
            style={styles.closeIcon}
            onPress={() => { cancelClose(); onClose(); }}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <MaterialCommunityIcons name="close" size={24} color={PANEL_INK} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          {groups.map((g) => (
            <View key={g.connections} style={styles.section}>
              <Text style={styles.caption}>
                {g.connections === 1 ? '1 connection' : `${g.connections} connections`}
              </Text>
              <View style={styles.grid}>
                {g.tiles.map((t) => {
                  const active = t.id === activeId;
                  return (
                    <Pressable
                      key={t.id}
                      onPress={() => {
                        const now = Date.now();
                        if (isPatternTileDoubleTap(lastTapRef.current, t.id, now)) {
                          cancelClose();
                          onSetTransform?.(t.id, rotatePatternTileTransform(poseOf(t.id)));
                          lastTapRef.current = { id: '', time: 0 };
                        } else {
                          onPick(t.id);
                          lastTapRef.current = { id: t.id, time: now };
                          cancelClose();
                          closeTimerRef.current = setTimeout(onClose, PATTERN_TILE_DOUBLE_TAP_MS);
                        }
                      }}
                      onLongPress={() => {
                        cancelClose();
                        onPick(t.id);
                        setTransformId(t.id);
                      }}
                      style={[styles.tile, active && styles.tileActive]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={t.id}
                    >
                      <Image
                        source={{ uri: t.uri }}
                        style={[styles.tileImage, { transform: patternTileThumbTransforms(poseOf(t.id)) }]}
                      />
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>
        <PatternTileTransformModal
          visible={transformId != null}
          uri={transformUri}
          transform={transformId ? poseOf(transformId) : PATTERN_TILE_TRANSFORM_IDENTITY}
          onChange={(xform) => {
            if (transformId) onSetTransform?.(transformId, xform);
          }}
          onClose={() => setTransformId(null)}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: PANEL_BG },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: PANEL_BORDER,
  },
  title: { color: PANEL_INK, fontSize: 13, fontWeight: '700', letterSpacing: 1.2 },
  closeIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 16, gap: 18 },
  section: { gap: 8 },
  caption: { color: PANEL_INK_DIM, fontSize: 11, lineHeight: 15 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    width: PATTERN_MODAL_TILE,
    height: PATTERN_MODAL_TILE,
    borderRadius: 8,
    backgroundColor: PANEL_TRACK,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  tileActive: { borderColor: STATE_ACTIVE },
  tileImage: { width: PATTERN_MODAL_TILE - 12, height: PATTERN_MODAL_TILE - 12 },
});
