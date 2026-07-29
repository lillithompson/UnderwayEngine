import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { UndoRedoModel } from '../adapter';
import { CapsuleButton } from './CapsuleButton';
import { CAPSULE_EDGE_MARGIN, CAPSULE_GAP, HEADER_HEIGHT, WHITE_10, WHITE_25 } from '../theme';

// Facet's UndoRedoPanel: two 44px round capsules floating at the right edge
// of the canvas, vertically centered — dimmer border + 0.4 opacity when the
// stack is empty. The container ignores touches so only the buttons capture.

export function UndoRedoPanel({ model }: { model: UndoRedoModel }) {
  return (
    <View style={styles.stack} pointerEvents="box-none">
      <CapsuleButton
        label="Undo" icon="undo" iconSize={20} iconColor="white"
        borderColor={model.canUndo ? WHITE_25 : WHITE_10}
        enabled={model.canUndo} onPress={model.onUndo}
      />
      <CapsuleButton
        label="Redo" icon="redo" iconSize={20} iconColor="white"
        borderColor={model.canRedo ? WHITE_25 : WHITE_10}
        enabled={model.canRedo} onPress={model.onRedo}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    position: 'absolute',
    top: HEADER_HEIGHT,
    bottom: 0,
    right: CAPSULE_EDGE_MARGIN,
    justifyContent: 'center',
    gap: CAPSULE_GAP,
    zIndex: 60,
  },
});
