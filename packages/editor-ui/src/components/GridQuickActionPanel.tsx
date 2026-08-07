import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { GridViewModel } from '../adapter';
import { CapsuleButton } from './CapsuleButton';
import {
  CAPSULE_BG, CAPSULE_EDGE_MARGIN, HEADER_HEIGHT, HEADER_INK, STATE_ACTIVE, WHITE_40, WHITE_60,
} from '../theme';

// Facet's GridQuickActionPanel: a left-edge column of 44px round capsules
// (dark fill, 2px border), vertically centered. The magnet flips snap-to-grid
// and INVERTS while snap is on — the accent fills the capsule and the icon and
// border go dark, so an on toggle reads at a glance against the resting dark
// capsules instead of as a merely tinted one. The finer (+) and coarser (−)
// capsules step the composition snap grid one level each — lower level = finer
// grid, matching Facet. Both groups are optional: an app that wants neither
// omits onToggleGridSnap / onSetGridLevel and the column renders empty.
// Facet's snap grid is unbounded, so this component applies no clamp — the app
// bounds the level inside its onSetGridLevel handler if it wants to.
//
// Facet's gear (a view-settings sheet) is deliberately absent: CozyJournal's
// view preferences are app-wide and live on its native settings screen, so
// there is nothing page-local left for a sheet to hold.

export function GridQuickActionPanel({ model }: { model: GridViewModel }) {
  const { onSetGridLevel, onToggleGridSnap } = model;
  const level = model.gridLevel ?? 0;
  const snapOn = model.gridSnap === true;
  return (
    <View style={styles.stack} pointerEvents="box-none">
      {onToggleGridSnap ? (
        <CapsuleButton
          label={snapOn ? 'Turn grid snap off' : 'Turn grid snap on'}
          icon="magnet"
          iconSize={20}
          backgroundColor={snapOn ? STATE_ACTIVE : CAPSULE_BG}
          iconColor={snapOn ? HEADER_INK : WHITE_60}
          borderColor={snapOn ? HEADER_INK : WHITE_40}
          onPress={onToggleGridSnap}
        />
      ) : null}
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
