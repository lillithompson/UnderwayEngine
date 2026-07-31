import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ObjectPropertiesModel } from '../adapter';
import {
  HEADER_BG,
  MODAL_BG,
  MODAL_TEXT,
  PANEL_ANIM_MS,
  PANEL_HAIRLINE,
  PANEL_HEIGHT,
} from '../theme';

// Facet's ObjectPropertiesPanel: a bottom sheet that slides up (150ms) when
// something is selected — dark raised surface, hairline top border, icon
// buttons grouped by hairline dividers. Below 500px wide the buttons go
// compact (24px icons, flex-weighted groups). Group actions (group/ungroup/
// join/union) render only when the app supplies them (Facet superset;
// CozyJournal leaves them unset).

type MCIName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const ICON_COLOR = HEADER_BG; // Facet TEXT_SECONDARY
const ICON_COLOR_STRONG = MODAL_TEXT; // Facet TEXT_PRIMARY (locked state)
const COMPACT_MAX_WIDTH = 500;

function ActionButton({ label, icon, iconColor, onPress, compact }: {
  label: string;
  icon: string;
  iconColor?: string;
  onPress: () => void;
  compact: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={compact ? styles.buttonCompact : styles.button}
    >
      <MaterialCommunityIcons name={icon as MCIName} size={compact ? 24 : 30} color={iconColor ?? ICON_COLOR} />
    </Pressable>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

export function ObjectPropertiesPanel({ model, safeBottom = 0 }: { model: ObjectPropertiesModel; safeBottom?: number }) {
  const { width } = useWindowDimensions();
  const compact = width < COMPACT_MAX_WIDTH;
  const [mounted, setMounted] = useState(model.visible);
  // The panel rests against the bottom edge but pads its content up by the
  // device safe-area inset (home indicator / screen curve on iOS native), so
  // the hidden position must clear the full padded height to slide fully off.
  const hiddenY = PANEL_HEIGHT + safeBottom;
  const translateY = useRef(new Animated.Value(model.visible ? 0 : hiddenY)).current;

  useEffect(() => {
    if (model.visible) setMounted(true);
    const anim = Animated.timing(translateY, {
      toValue: model.visible ? 0 : hiddenY,
      duration: PANEL_ANIM_MS,
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      if (finished && !model.visible) setMounted(false);
    });
    return () => anim.stop();
  }, [model.visible, translateY, hiddenY]);

  if (!mounted) return null;

  const hasGroupActions = !!(model.onGroup || model.onUngroup || model.onJoin || model.onUnion);

  return (
    <View style={styles.clip} pointerEvents="box-none">
      <Animated.View style={[styles.panel, { paddingBottom: safeBottom, transform: [{ translateY }] }]}>
        <View style={styles.rowInner}>
          {model.showEdit ? (
            <>
              <View style={compact ? styles.groupCompact1 : styles.group}>
                <ActionButton label="Edit" icon="image-edit-outline" onPress={model.onEdit} compact={compact} />
              </View>
              <Divider />
            </>
          ) : null}

          <View style={compact ? styles.groupCompact3 : styles.group}>
            <ActionButton label="Rotate" icon="rotate-right" onPress={model.onRotate} compact={compact} />
            <ActionButton label="Mirror H" icon="arrow-left-right" onPress={model.onMirrorH} compact={compact} />
            <ActionButton label="Mirror V" icon="arrow-up-down" onPress={model.onMirrorV} compact={compact} />
          </View>
          <Divider />

          <View style={compact ? styles.groupCompact3 : styles.group}>
            <ActionButton label="Duplicate" icon="content-copy" onPress={model.onDuplicate} compact={compact} />
            <ActionButton
              label={model.locked ? 'Locked' : 'Lock'}
              icon={model.locked ? 'lock' : 'lock-open-outline'}
              iconColor={model.locked ? ICON_COLOR_STRONG : ICON_COLOR}
              onPress={model.onToggleLock}
              compact={compact}
            />
            <ActionButton label="Delete" icon="delete-outline" onPress={model.onDelete} compact={compact} />
          </View>

          {hasGroupActions ? (
            <>
              <Divider />
              <View style={compact ? styles.groupCompact3 : styles.group}>
                {model.onGroup ? <ActionButton label="Group" icon="group" onPress={model.onGroup} compact={compact} /> : null}
                {model.onUngroup ? <ActionButton label="Ungroup" icon="ungroup" onPress={model.onUngroup} compact={compact} /> : null}
                {model.onJoin ? <ActionButton label="Join" icon="vector-combine" onPress={model.onJoin} compact={compact} /> : null}
                {model.onUnion ? <ActionButton label="Union" icon="vector-union" onPress={model.onUnion} compact={compact} /> : null}
              </View>
            </>
          ) : null}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 200,
    overflow: 'hidden',
  },
  panel: {
    backgroundColor: MODAL_BG,
    borderTopWidth: 1,
    borderTopColor: PANEL_HAIRLINE,
    paddingHorizontal: 12,
  },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 4,
    paddingBottom: 8,
  },
  group: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  groupCompact1: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  groupCompact3: { flex: 3, flexDirection: 'row', alignItems: 'center' },
  button: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  buttonCompact: { flex: 1, height: 48, alignItems: 'center', justifyContent: 'center' },
  divider: { width: 1, alignSelf: 'stretch', backgroundColor: PANEL_HAIRLINE, marginVertical: 6, marginHorizontal: 10 },
});
