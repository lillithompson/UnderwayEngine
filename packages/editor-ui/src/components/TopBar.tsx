import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { SwatchRainbow, TopBarModel } from '../adapter';
import { nextToolOnPress } from '../logic/toolbarBehavior';
import { ColorSwatchFill, RainbowRingFill, RainbowSwatchFill } from './ColorSwatch';
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
// label on the left (tap the label to open the scene outline; the back
// square only where the model gives it a press — see TopBarModel.onBack),
// the format's
// tools right-aligned as 40px icon buttons (blue when active). The color
// tool renders as a live swatch with Facet's double selection ring. Toggle
// semantics (nextToolOnPress) are applied here so the app's onSelectTool
// receives the already-resolved tool — including `null`, which is a press on
// the active tool untoggling it, leaving every button unlit.

type MCIName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/** The overshoot spring (ToolModeCapsule's) on a scale value, run once
 *  each time `bounceKey` takes a new value: shrink to 0.6 and spring back
 *  past 1. Undefined never bounces; the first value seen is the resting
 *  key, so mounting with a key set does not bounce either. */
function useBounceScale(bounceKey: number | undefined): Animated.Value {
  const scale = useRef(new Animated.Value(1)).current;
  const lastKey = useRef(bounceKey);
  useEffect(() => {
    if (bounceKey === undefined || bounceKey === lastKey.current) return undefined;
    lastKey.current = bounceKey;
    scale.setValue(0.6);
    const anim = Animated.spring(scale, {
      toValue: 1,
      // Low friction = a visible overshoot past 1 and back — the bounce.
      friction: 4,
      tension: 220,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [bounceKey, scale]);
  return scale;
}

/** The colour tool's live swatch, with the ring pair when armed. It bounces
 *  (useBounceScale) each time `bounceKey` changes: the radial's swatch
 *  capsule confirms a colour away from the toolbar, and the swatch — where
 *  the colour is read — answers so the change is seen.
 *
 *  `rainbow` replaces the colour with the hue wheel: the brush is blending
 *  in a mode that does not lay the armed colour, so the swatch shows that
 *  there is no one colour rather than a colour the stroke will not use —
 *  solid for Random, which lays a colour that walks as the stroke goes,
 *  and a RING for Rotate, which lays none of its own and spins the hue
 *  already under it. */
function SwatchGlyph({ color, rainbow, active, size, bounceKey }: {
  color: NonNullable<TopBarModel['tools'][number]['swatchColor']>;
  rainbow: SwatchRainbow | undefined;
  active: boolean;
  size: number;
  bounceKey: number | undefined;
}) {
  const scale = useBounceScale(bounceKey);
  return (
    <Animated.View style={[styles.swatchWrap, { transform: [{ scale }] }]}>
      <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }}>
        {rainbow === 'ring' ? <RainbowRingFill size={size} />
          : rainbow === 'wheel' ? <RainbowSwatchFill />
            : <ColorSwatchFill color={color} />}
      </View>
      {active ? (
        <>
          <View style={ring(size, STATE_INACTIVE)} />
          <View style={ring(size + 8, STATE_ACTIVE)} />
        </>
      ) : null}
    </Animated.View>
  );
}

/** One tool's glyph — swatch, app-supplied component, or MCI icon — in a
 *  wrapper that bounces (useBounceScale) each time the tool's `bounceKey`
 *  changes: the whole button answers an arming that happened off the bar. */
function ToolGlyph({ tool, swatchSize }: { tool: TopBarModel['tools'][number]; swatchSize: number }) {
  const scale = useBounceScale(tool.bounceKey);
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      {tool.swatchColor ? (
        <SwatchGlyph
          color={tool.swatchColor}
          rainbow={tool.swatchRainbow}
          active={tool.active}
          size={swatchSize}
          bounceKey={tool.swatchBounceKey}
        />
      ) : tool.IconComponent ? (
        <tool.IconComponent
          size={ICON_SIZE}
          color={tool.tint ?? (tool.active ? STATE_ACTIVE : STATE_INACTIVE)}
        />
      ) : (
        <MaterialCommunityIcons
          name={tool.icon as MCIName}
          size={ICON_SIZE}
          color={tool.tint ?? (tool.active ? STATE_ACTIVE : STATE_INACTIVE)}
        />
      )}
    </Animated.View>
  );
}

export function TopBar({ model }: { model: TopBarModel }) {
  // No `active` tool is a real state (all tools untoggled), not a missing
  // one — so it stays null rather than falling back to the first tool, or
  // pressing that tool would read as "already active" and untoggle instead
  // of selecting it.
  const activeId = model.tools.find((t) => t.active)?.id ?? null;
  const swatchSize = ICON_SIZE - 4;

  return (
    <View style={[styles.bar, model.background ? { backgroundColor: model.background } : null]}>
      {/* Center readout (e.g. the developer-mode grid level): absolutely
          centered so it sits in the bar's true middle whatever the label and
          tool-row widths, and press-transparent so it can never swallow a
          tap aimed at what is under it. */}
      {model.centerInfo ? (
        <View pointerEvents="none" style={styles.centerInfoWrap}>
          <Text style={styles.centerInfo} numberOfLines={1}>{model.centerInfo}</Text>
        </View>
      ) : null}
      {/* No `onBack`, no chevron: the app has put the way back on a row of
          its own above the bar, and the label takes the row's left edge. */}
      {model.onBack ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={styles.back} onPress={model.onBack}>
          <MaterialCommunityIcons name="chevron-left" size={24} color={HEADER_INK} />
        </Pressable>
      ) : null}
      <Pressable
        style={styles.labelWrap}
        onPress={model.onLabelPress}
        disabled={!model.onLabelPress}
        accessibilityRole={model.onLabelPress ? 'button' : 'text'}
      >
        <Text style={styles.label} numberOfLines={1}>{model.label}</Text>
      </Pressable>
      {/* toolsDisabled: the whole row dims as one and every button goes
          inert — each Pressable disabled rather than the row made
          press-transparent, so a tap on a dimmed tool does not fall
          through to whatever is under the bar. */}
      <View style={[styles.tools, model.toolsDisabled ? styles.toolsDisabled : null]}>
        {model.tools.map((tool) => (
          <Pressable
            key={tool.id}
            accessibilityRole="button"
            accessibilityLabel={tool.id}
            accessibilityState={model.toolsDisabled ? { disabled: true } : undefined}
            disabled={model.toolsDisabled}
            style={styles.toolButton}
            onPress={() => model.onSelectTool(nextToolOnPress(activeId, tool.id))}
            // Facet's ToolbarButton: a hold runs the tool's own long-press
            // action (sub-mode toggle) INSTEAD of the press toggle, never
            // both — RN suppresses onPress once onLongPress has fired.
            onLongPress={tool.onLongPress}
          >
            <ToolGlyph tool={tool} swatchSize={swatchSize} />
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
  centerInfoWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Small and muted: information, not a control — it must never read as a
  // button or compete with the title.
  centerInfo: { color: HEADER_INK, fontSize: 11, opacity: 0.55, fontVariant: ['tabular-nums'] },
  tools: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: HEADER_HEIGHT,
  },
  // The inactive-tool dim the symmetry button wears when off (0.3 of the
  // ink), applied to the row as a whole so the swatch dims with the icons.
  toolsDisabled: { opacity: 0.3 },
  toolButton: {
    width: TOOLBAR_BUTTON_SIZE,
    height: TOOLBAR_BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchWrap: { alignItems: 'center', justifyContent: 'center' },
});
