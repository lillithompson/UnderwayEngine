import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { GridViewModel } from '../adapter';
import { CapsuleButton } from './CapsuleButton';
import { CAPSULE_EDGE_MARGIN, HEADER_HEIGHT, WHITE_40, WHITE_60 } from '../theme';

// Facet's GridQuickActionPanel entry point: the gear capsule (44px round,
// dark fill, tune-variant glyph) floating at the left edge, vertically
// centered. Opens the app's view-settings sheet via the model. Grid-level
// controls (finer/coarser) are optional — CozyJournal wires only the sheet,
// so this renders the single gear button; apps that expose grid levels can
// add buttons here later against GridViewModel.gridLevel / onSetGridLevel.

export function GridQuickActionPanel({ model }: { model: GridViewModel }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.stack, { top: HEADER_HEIGHT + insets.top }]} pointerEvents="box-none">
      <CapsuleButton
        label="View settings" icon="tune-variant" iconSize={20} iconColor={WHITE_60}
        borderColor={WHITE_40} onPress={model.onOpenViewSettings}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    position: 'absolute',
    top: HEADER_HEIGHT,
    bottom: 0,
    left: CAPSULE_EDGE_MARGIN,
    justifyContent: 'center',
    gap: 8,
    zIndex: 100,
  },
});
