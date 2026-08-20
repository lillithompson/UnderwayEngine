import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { PatternTileSetRow } from '../logic/patternEdit';
import {
  PANEL_BG, PANEL_BORDER, PANEL_INK, PANEL_INK_DIM, PANEL_TRACK, STATE_ACTIVE,
} from '../theme';

// The Tools bar's Sets takeover: Facet's Randomization Settings, as a
// full-screen sheet in the panel scheme (the same chrome as the Tiles
// takeover). Every tile set the host offers is a full-width toggle cell —
// lit while its tiles are in the random pool — and below them sits the
// Border Connections rule as a switch, the same setting the Tools bar's
// Borders row drives. Facet's Multi-layer Fill switch is deliberately
// absent: patterns here are single-resolution grids, so it has nothing to
// govern. There is no confirm — every toggle applies as it is pressed.

export function PatternSetsModal({ visible, sets, allowBorder, onToggleSet, onToggleBorder, onClose }: {
  visible: boolean;
  sets: readonly PatternTileSetRow[];
  /** Whether connectivity may reach across the grid border (undefined = yes). */
  allowBorder: boolean;
  onToggleSet: (family: string) => void;
  onToggleBorder: () => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.title}>RANDOMIZATION SETTINGS</Text>
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
          <View style={styles.setList}>
            {sets.map((s) => (
              <Pressable
                key={s.family}
                onPress={() => onToggleSet(s.family)}
                style={[styles.setCell, s.enabled && styles.setCellActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: s.enabled }}
                accessibilityLabel={s.label}
              >
                <Text style={[styles.setWord, s.enabled && styles.setWordActive]}>{s.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Border Connections</Text>
            <Switch
              value={allowBorder}
              onValueChange={onToggleBorder}
              trackColor={{ false: PANEL_TRACK, true: STATE_ACTIVE }}
            />
          </View>
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
  body: { padding: 16, gap: 16 },
  // Facet's familyGrid: full-width cells stacked with a gap, tall enough
  // to hit without looking.
  setList: { gap: 12 },
  setCell: {
    height: 64,
    borderRadius: 8,
    backgroundColor: PANEL_TRACK,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  setCellActive: { borderColor: STATE_ACTIVE },
  setWord: { color: PANEL_INK_DIM, fontSize: 12, fontWeight: '700' },
  setWordActive: { color: PANEL_INK },
  // Facet's borderConnectionRow: label left, switch right, set off from
  // the cells above by a hairline.
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 4,
    marginTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: PANEL_BORDER,
  },
  switchLabel: { color: PANEL_INK_DIM, fontSize: 14 },
});
