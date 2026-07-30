import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { GridViewModel } from '../adapter';
import { CapsuleButton } from './CapsuleButton';
import { CAPSULE_EDGE_MARGIN, HEADER_HEIGHT, WHITE_40, WHITE_60 } from '../theme';

// Facet's GridQuickActionPanel: a left-edge column of 44px round capsules
// (dark fill, 2px border), vertically centered. The gear (tune-variant)
// opens the app's view-settings sheet; the finer (+) and coarser (−)
// capsules step the composition snap grid one level each — lower level =
// finer grid, matching Facet. The grid-level pair is optional: an app that
// only wants the sheet omits onSetGridLevel and gets just the gear. Facet's
// snap grid is unbounded, so this component applies no clamp — the app
// bounds the level inside its onSetGridLevel handler if it wants to.

export function GridQuickActionPanel({ model }: { model: GridViewModel }) {
  const { onSetGridLevel } = model;
  const level = model.gridLevel ?? 0;
  return (
    <View style={styles.stack} pointerEvents="box-none">
      <CapsuleButton
        label="View settings" icon="tune-variant" iconSize={20} iconColor={WHITE_60}
        borderColor={WHITE_40} onPress={model.onOpenViewSettings}
      />
      {onSetGridLevel ? (
        <>
          <CapsuleButton
            label="Finer grid" icon="plus" iconSize={22} iconColor={WHITE_60}
            borderColor={WHITE_40} onPress={() => onSetGridLevel(level - 1)}
          />
          <CapsuleButton
            label="Coarser grid" icon="minus" iconSize={22} iconColor={WHITE_60}
            borderColor={WHITE_40} onPress={() => onSetGridLevel(level + 1)}
          />
        </>
      ) : null}
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
