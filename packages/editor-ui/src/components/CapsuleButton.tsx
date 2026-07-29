import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { CAPSULE_BG, CAPSULE_SIZE } from '../theme';

// The one floating-capsule button shape (Facet's UndoRedoPanel /
// GridQuickActionPanel buttons): 44px round, dark fill, 2px border. Border
// and icon colors vary per panel, so they come in as props.

type MCIName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

interface CapsuleButtonProps {
  label: string;
  icon: string;
  iconSize: number;
  iconColor: string;
  borderColor: string;
  enabled?: boolean;
  onPress: () => void;
}

export function CapsuleButton({
  label, icon, iconSize, iconColor, borderColor, enabled = true, onPress,
}: CapsuleButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      style={[styles.button, { borderColor, opacity: enabled ? 1 : 0.4 }]}
    >
      <MaterialCommunityIcons name={icon as MCIName} size={iconSize} color={iconColor} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: CAPSULE_SIZE,
    height: CAPSULE_SIZE,
    borderRadius: CAPSULE_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CAPSULE_BG,
    borderWidth: 2,
  },
});
