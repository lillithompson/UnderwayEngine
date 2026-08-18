import React from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { groupPatternTiles, type PatternTileRow } from '../logic/patternEdit';
import {
  PANEL_BG, PANEL_BORDER, PANEL_INK, PANEL_INK_DIM, PANEL_TRACK, STATE_ACTIVE,
} from '../theme';

// The Tiles bar's takeover: every tile the menu offers, laid out as a grid
// of square buttons. Tapping one arms it and dismisses — the picking is the
// whole interaction, so there is no confirm.
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

export function PatternTileModal({ visible, tiles, activeId, onPick, onClose }: {
  visible: boolean;
  tiles: readonly PatternTileRow[];
  activeId: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const groups = groupPatternTiles(tiles);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.title}>TILES</Text>
          <Pressable
            style={styles.closeIcon}
            onPress={onClose}
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
                      onPress={() => onPick(t.id)}
                      style={[styles.tile, active && styles.tileActive]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={t.id}
                    >
                      <Image source={{ uri: t.uri }} style={styles.tileImage} />
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>
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
