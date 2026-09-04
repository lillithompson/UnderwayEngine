import React from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type { PatternTileSetRow } from '../logic/patternEdit';
import { PANEL_BORDER, PANEL_INK, PANEL_INK_DIM, PANEL_TRACK, STATE_ACTIVE } from '../theme';
import { AppModal, AppModalDoneButton } from './AppModal';

// The Tools bar's Sets takeover: Facet's Randomization Settings, as a
// full-screen sheet in the panel scheme (the same chrome as the Tiles
// takeover). Every tile set the host offers is a full-width toggle cell —
// lit while its tiles are in the random pool — and below them sits the
// Border Connections rule as a switch, the same setting the Tools bar's
// Borders row drives. Facet's Multi-layer Fill switch is deliberately
// absent: patterns here are single-resolution grids, so it has nothing to
// govern. There is no confirm — every toggle applies as it is pressed —
// and the way out is the standard Done button (or the header's X).

export function PatternSetsModal({ visible, sets, allowBorder, onToggleSet, onToggleBorder, onClose, safeTop }: {
  visible: boolean;
  sets: readonly PatternTileSetRow[];
  /** Whether connectivity may reach across the grid border (undefined = yes). */
  allowBorder: boolean;
  onToggleSet: (family: string) => void;
  onToggleBorder: () => void;
  onClose: () => void;
  /** Header clearance — see AppModal's safeTop. */
  safeTop?: number;
}) {
  return (
    <AppModal visible={visible} title="Randomization Settings" onClose={onClose} safeTop={safeTop}>
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
      <View style={styles.footer}>
        <AppModalDoneButton onPress={onClose} />
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 16 },
  footer: { paddingHorizontal: 16, paddingBottom: 16 },
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
