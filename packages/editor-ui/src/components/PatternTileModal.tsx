import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  PATTERN_TILE_TRANSFORM_IDENTITY,
  groupPatternTiles,
  isPatternTileDoubleTap,
  patternTileThumbTransforms,
  rotatePatternTileTransform,
  type PatternTileRow,
  type PatternTileTransform,
} from '../logic/patternEdit';
import { PANEL_INK_DIM, PANEL_TRACK, STATE_ACTIVE } from '../theme';
import { AppModal, AppModalDoneButton } from './AppModal';
import { PatternTileTransformModal } from './PatternTileTransformModal';

// The Tiles bar's takeover: every tile the menu offers, laid out as a grid
// of square buttons. Tapping one arms it and the sheet STAYS — the standard
// AppModal rule: a pick is not a dismissal, so tiles can be browsed and
// re-picked freely, and a tile keeps the same pose gestures as the bar's
// recent grid (a second tap inside the double-tap window turns it a quarter
// clockwise; a long press opens the transform modal over this one). The
// way out is the Done button at the foot (AppModalDoneButton, the Set
// Color layout) or the header's X. There is still no confirm — the arming
// already happened on the first tap.
//
// This sheet wears the unified takeover chrome (AppModal — the PANEL
// scheme, not the dark MODAL one the floating rename card uses), and that
// is not a stylistic whim: the host bakes tile thumbnails in PANEL_INK for
// the light bar, so on a #3f3f3f card the entire grid would be
// near-invisible dark-on-dark.
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
  // A re-open must not inherit the previous visit's half-open transform
  // card or double-tap arm.
  useEffect(() => {
    if (!visible) {
      setTransformId(null);
      lastTapRef.current = { id: '', time: 0 };
    }
  }, [visible]);

  const poseOf = (id: string) => transforms?.[id] ?? PATTERN_TILE_TRANSFORM_IDENTITY;
  const transformUri = transformId
    ? tiles.find((t) => t.id === transformId)?.uri ?? null
    : null;

  return (
    <AppModal visible={visible} title="Tiles" onClose={onClose}>
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
                          onSetTransform?.(t.id, rotatePatternTileTransform(poseOf(t.id)));
                          lastTapRef.current = { id: '', time: 0 };
                        } else {
                          onPick(t.id);
                          lastTapRef.current = { id: t.id, time: now };
                        }
                      }}
                      onLongPress={() => {
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
      {/* Done: picks don't dismiss (see the header note), so the sheet
          carries the standard AppModal way out, pinned under the scroll. */}
      <View style={styles.footer}>
        <AppModalDoneButton onPress={onClose} />
      </View>
      <PatternTileTransformModal
        visible={transformId != null}
        uri={transformUri}
        transform={transformId ? poseOf(transformId) : PATTERN_TILE_TRANSFORM_IDENTITY}
        onChange={(xform) => {
          if (transformId) onSetTransform?.(transformId, xform);
        }}
        onClose={() => setTransformId(null)}
      />
    </AppModal>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 18 },
  // The Done row: the button carries its own 20pt top margin (the Set
  // Color spacing), the row only frames it against the sheet's edges.
  footer: { paddingHorizontal: 16, paddingBottom: 16 },
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
