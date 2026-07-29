import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { TopBarModel } from '../adapter';
import { nextToolOnPress } from '../logic/toolbarBehavior';
import { rgbCss } from '../logic/hsv';
import {
  HEADER_BG,
  HEADER_HEIGHT,
  HEADER_INK,
  ICON_SIZE,
  STATE_ACTIVE,
  STATE_INACTIVE,
  TOOLBAR_BUTTON_SIZE,
} from '../theme';

// Facet's CompositionEditor header: light strip, "<" back square + bold
// label on the left (tap the label to open the scene outline), the format's
// tools right-aligned as 40px icon buttons (blue when active). The color
// tool renders as a live swatch with Facet's double selection ring. Toggle
// semantics (nextToolOnPress) are applied here so the app's onSelectTool
// receives the already-resolved tool.

type MCIName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

export function TopBar({ model }: { model: TopBarModel }) {
  const toolIds = model.tools.map((t) => t.id);
  const activeId = model.tools.find((t) => t.active)?.id ?? toolIds[0] ?? '';
  const swatchSize = ICON_SIZE - 4;

  return (
    <View style={styles.bar}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" style={styles.back} onPress={model.onBack}>
        <MaterialCommunityIcons name="chevron-left" size={24} color={HEADER_INK} />
      </Pressable>
      <Pressable
        style={styles.labelWrap}
        onPress={model.onLabelPress}
        disabled={!model.onLabelPress}
        accessibilityRole={model.onLabelPress ? 'button' : 'text'}
      >
        <Text style={styles.label} numberOfLines={1}>{model.label}</Text>
        {model.onLabelPress ? (
          <MaterialCommunityIcons name="chevron-down" size={18} color={HEADER_INK} />
        ) : null}
      </Pressable>
      <View style={styles.tools}>
        {model.tools.map((tool) => (
          <Pressable
            key={tool.id}
            accessibilityRole="button"
            accessibilityLabel={tool.id}
            style={styles.toolButton}
            onPress={() => model.onSelectTool(nextToolOnPress(toolIds, activeId, tool.id))}
          >
            {tool.swatchColor ? (
              <View style={styles.swatchWrap}>
                <View
                  style={{
                    width: swatchSize, height: swatchSize, borderRadius: swatchSize / 2,
                    backgroundColor: rgbCss(tool.swatchColor),
                  }}
                />
                {tool.active ? (
                  <>
                    <View style={ring(swatchSize, STATE_INACTIVE)} />
                    <View style={ring(swatchSize + 8, STATE_ACTIVE)} />
                  </>
                ) : null}
              </View>
            ) : (
              <MaterialCommunityIcons
                name={tool.icon as MCIName}
                size={ICON_SIZE}
                color={tool.active ? STATE_ACTIVE : STATE_INACTIVE}
              />
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function ring(size: number, color: string) {
  return {
    position: 'absolute' as const,
    width: size,
    height: size,
    borderRadius: size / 2,
    borderWidth: 2,
    borderColor: color,
  };
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    minHeight: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    backgroundColor: HEADER_BG,
    zIndex: 10,
  },
  back: {
    width: Math.round(HEADER_HEIGHT * 0.6),
    height: HEADER_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelWrap: {
    flexShrink: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  label: { flexShrink: 1, color: HEADER_INK, fontSize: 18, fontWeight: '600' },
  tools: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: HEADER_HEIGHT,
  },
  toolButton: {
    width: TOOLBAR_BUTTON_SIZE,
    height: TOOLBAR_BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchWrap: { alignItems: 'center', justifyContent: 'center' },
});
