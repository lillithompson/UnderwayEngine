import React, { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ObjectPropertiesModel, ShadowModel } from '../adapter';
import { IMAGE_EDIT_OPTIONS, ImageEditAction, swipeDismissDirection } from '../logic/imageEdit';
import { Slider } from './Slider';
import { ShadowBar } from './ShadowBar';
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
// Max corner radius the slider reaches, as a fraction of the shorter side —
// 0.5 rounds a square all the way to a circle (mirror of editorSession's
// MAX_CORNER_RADIUS; the app clamps commits to the same bound).
const MAX_CORNER_RADIUS = 0.5;
const DEFAULT_SHADOW_MODEL: ShadowModel = {
  dx: 0.75, dy: 0.875, blur: 1.125, spread: 0.125, color: { r: 0, g: 0, b: 0 }, opacity: 0.45,
};

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

// Image-edit sub-panel button: an icon over a short caption, weighted to
// share the row evenly with its siblings.
function ImageEditButton({ label, icon, onPress }: {
  label: string;
  icon: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.imageEditButton}
    >
      <MaterialCommunityIcons name={icon as MCIName} size={24} color={ICON_COLOR} />
      <Text style={styles.imageEditLabel}>{label}</Text>
    </Pressable>
  );
}

export function ObjectPropertiesPanel({ model }: { model: ObjectPropertiesModel }) {
  const { width } = useWindowDimensions();
  const compact = width < COMPACT_MAX_WIDTH;
  const [mounted, setMounted] = useState(model.visible);
  const translateY = useRef(new Animated.Value(model.visible ? 0 : PANEL_HEIGHT)).current;

  useEffect(() => {
    if (model.visible) setMounted(true);
    const anim = Animated.timing(translateY, {
      toValue: model.visible ? 0 : PANEL_HEIGHT,
      duration: PANEL_ANIM_MS,
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      if (finished && !model.visible) setMounted(false);
    });
    return () => anim.stop();
  }, [model.visible, translateY]);

  // ── Image-edit sub-panel ────────────────────────────────────────────
  // Pressing Edit on an image slides this layer in over the action row; it
  // is dismissed by swiping it sideways (either way), mirroring the title
  // banner's swipe feel — the content follows the finger, then a past-
  // threshold release throws it off-screen and reveals the row beneath.
  const [imageEditMounted, setImageEditMounted] = useState(false);
  // Round-corners slider (0–1) floating above the bar; opened from the Edit
  // sub-panel's Round button. Open/closed is app-owned (model.roundOpen) so a
  // tap-off dismisses the slider before the panel; only the thumb value is
  // local, so the live preview round-trip doesn't fight the drag.
  const [sliderVal, setSliderVal] = useState(0);
  // Shadow-controls draft — seeded from model.shadow when the controls open,
  // then locally owned so live previews don't fight the sliders.
  const [shadowDraft, setShadowDraft] = useState<ShadowModel | null>(null);
  const prevShadowOpen = useRef(false);
  // The Drop Shadow bar slides in horizontally over the edit controls and can
  // be swiped sideways (either way) to dismiss. Mounted through the slide-out
  // so it animates off-screen before unmounting.
  const [shadowMounted, setShadowMounted] = useState(false);
  const shadowX = useRef(new Animated.Value(0)).current;
  const shadowExitDir = useRef<1 | -1>(1); // which edge it leaves by (a swipe overrides)
  const panX = useRef(new Animated.Value(0)).current;
  // Latest committed-dismiss runner, so the once-created PanResponder always
  // throws by the current window width.
  const dismissRef = useRef<(dir: -1 | 1) => void>(() => {});
  dismissRef.current = (dir) => {
    Animated.timing(panX, {
      toValue: dir * width,
      duration: PANEL_ANIM_MS,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setImageEditMounted(false);
        model.onRoundOpenChange?.(false);
        model.onShadowOpenChange?.(false);
      }
    });
  };

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) > 5 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_e, g) => panX.setValue(g.dx),
      onPanResponderRelease: (_e, g) => {
        const dir = swipeDismissDirection(g.dx);
        if (dir !== 0) dismissRef.current(dir);
        else Animated.spring(panX, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
      },
      onPanResponderTerminate: () =>
        Animated.spring(panX, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start(),
    }),
  ).current;

  // Fold the sub-panel away the moment the selection is no longer an
  // editable image (or the whole bar hides) so it never lingers over the
  // next object's actions.
  useEffect(() => {
    if ((!model.visible || !model.showImageEdit) && imageEditMounted) {
      setImageEditMounted(false);
      model.onRoundOpenChange?.(false);
      model.onShadowOpenChange?.(false);
      panX.setValue(0);
    }
    // model.on*OpenChange are stable setters; listing the whole model would
    // re-run this every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.visible, model.showImageEdit, imageEditMounted, panX]);

  // Seed the shadow draft from the current shadow each time the controls open.
  useEffect(() => {
    if (model.shadowOpen && !prevShadowOpen.current) {
      setShadowDraft(model.shadow ?? DEFAULT_SHADOW_MODEL);
    }
    prevShadowOpen.current = !!model.shadowOpen;
  }, [model.shadowOpen, model.shadow]);

  // Slide the Drop Shadow bar in from the right on open; on close slide it off
  // the last-swiped edge (right by default), then unmount, revealing the
  // image-specific edit controls.
  useEffect(() => {
    if (model.shadowOpen) {
      setShadowMounted(true);
      shadowExitDir.current = 1;
      shadowX.setValue(width); // enter from the right edge
      const anim = Animated.timing(shadowX, { toValue: 0, duration: PANEL_ANIM_MS, useNativeDriver: true });
      anim.start();
      return () => anim.stop();
    }
    const anim = Animated.timing(shadowX, {
      toValue: shadowExitDir.current * width,
      duration: PANEL_ANIM_MS,
      useNativeDriver: true,
    });
    anim.start(({ finished }) => { if (finished) setShadowMounted(false); });
    return () => anim.stop();
  }, [model.shadowOpen, shadowX, width]);

  // Swipe the bar sideways past the threshold to dismiss (it then flies off
  // that edge via the close effect); a short drag springs back. The pad and
  // sliders claim their own touches, so this only fires on the bar's inert
  // areas (header, labels, padding).
  const shadowReleaseRef = useRef<(dx: number) => void>(() => {});
  shadowReleaseRef.current = (dx) => {
    const dir = swipeDismissDirection(dx);
    if (dir !== 0) {
      shadowExitDir.current = dir;
      model.onShadowOpenChange?.(false);
    } else {
      Animated.spring(shadowX, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
    }
  };
  const shadowPan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_e, g) => shadowX.setValue(g.dx),
      onPanResponderRelease: (_e, g) => shadowReleaseRef.current(g.dx),
      onPanResponderTerminate: () => Animated.spring(shadowX, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start(),
    }),
  ).current;

  const openImageEdit = () => {
    panX.setValue(width); // start just off the right edge, then slide in
    setImageEditMounted(true);
    Animated.timing(panX, { toValue: 0, duration: PANEL_ANIM_MS, useNativeDriver: true }).start();
  };

  const toggleRound = () => {
    const willOpen = !model.roundOpen;
    // Seed the thumb from the current radius each time it opens.
    if (willOpen) setSliderVal((model.cornerRadius ?? 0) / MAX_CORNER_RADIUS);
    model.onRoundOpenChange?.(willOpen);
  };

  const toggleShadow = () => model.onShadowOpenChange?.(!model.shadowOpen);

  const runImageAction = (action: ImageEditAction) => {
    if (action === 'roundCorners') { toggleRound(); return; }
    if (action === 'shadow') { toggleShadow(); return; }
    // Any other action closes both transient controls.
    model.onRoundOpenChange?.(false);
    model.onShadowOpenChange?.(false);
    if (action === 'replace') model.onReplaceImage?.();
    else if (action === 'tint') model.onTintImage?.();
    else if (action === 'crop') model.onCropImage?.();
    else if (action === 'glow') model.onGlowImage?.();
    else if (action === 'border') model.onBorderImage?.();
  };

  // Round slider drag → live preview; release → one undo step. Value is 0–1;
  // the model works in the 0–MAX_CORNER_RADIUS fraction space.
  const onSliderChange = (v: number) => {
    setSliderVal(v);
    model.onCornerRadius?.(v * MAX_CORNER_RADIUS, false);
  };
  const onSliderCommit = (v: number) => {
    model.onCornerRadius?.(v * MAX_CORNER_RADIUS, true);
  };

  // Shadow controls → live preview / commit through the model; the draft stays
  // in sync so the sliders keep tracking.
  const applyShadow = (s: ShadowModel, committed: boolean) => {
    setShadowDraft(s);
    model.onShadow?.(s, committed);
  };
  const removeShadow = () => {
    model.onShadow?.(null, true);
    model.onShadowOpenChange?.(false);
  };

  if (!mounted) return null;

  const hasGroupActions = !!(model.onGroup || model.onUngroup || model.onJoin || model.onUnion);
  // Params tracked by the sliders/pad come from the local draft; color comes
  // from the model (it's changed externally, via the full-screen picker).
  const shadowForBar: ShadowModel = shadowDraft
    ? { ...shadowDraft, color: model.shadow?.color ?? shadowDraft.color }
    : (model.shadow ?? DEFAULT_SHADOW_MODEL);

  return (
    <>
      {model.roundOpen ? (
        <View style={styles.sliderWrap} pointerEvents="box-none">
          <View style={styles.sliderCard}>
            <View style={styles.sliderHeaderRow}>
              <Text style={styles.sliderTitle}>Round corners</Text>
              <MaterialCommunityIcons name="rounded-corner" size={16} color={ICON_COLOR} />
            </View>
            <Slider value={sliderVal} onChange={onSliderChange} onCommit={onSliderCommit} />
          </View>
        </View>
      ) : null}
      {shadowMounted ? (
        <Animated.View
          style={[styles.shadowBarWrap, { transform: [{ translateX: shadowX }] }]}
          {...shadowPan.panHandlers}
        >
          <ShadowBar
            shadow={shadowForBar}
            onChange={(s) => applyShadow(s, false)}
            onCommit={(s) => applyShadow(s, true)}
            onBack={() => model.onShadowOpenChange?.(false)}
            onRemove={removeShadow}
            onPickColor={() => model.onPickShadowColor?.()}
          />
        </Animated.View>
      ) : null}
      <View style={styles.clip} pointerEvents="box-none">
        <Animated.View style={[styles.panel, { transform: [{ translateY }] }]}>
        <View style={styles.rowInner}>
          {model.showEdit || model.showImageEdit ? (
            <>
              <View style={compact ? styles.groupCompact1 : styles.group}>
                <ActionButton
                  label="Edit"
                  icon="image-edit-outline"
                  onPress={model.showImageEdit ? openImageEdit : model.onEdit}
                  compact={compact}
                />
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

        {imageEditMounted ? (
          <Animated.View
            style={[styles.imageEditOverlay, {
              transform: [{ translateX: panX }],
              opacity: panX.interpolate({
                inputRange: [-120, 0, 120],
                outputRange: [0.5, 1, 0.5],
                extrapolate: 'clamp',
              }),
            }]}
            {...pan.panHandlers}
          >
            <View style={styles.rowInner}>
              {IMAGE_EDIT_OPTIONS.map((opt) => (
                <ImageEditButton
                  key={opt.action}
                  label={opt.label}
                  icon={opt.icon}
                  onPress={() => runImageAction(opt.action)}
                />
              ))}
            </View>
          </Animated.View>
        ) : null}
        </Animated.View>
      </View>
    </>
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
  // Opaque cover over the action row — same surface as the panel, so the
  // row is fully hidden until the sub-panel is swiped away.
  imageEditOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: MODAL_BG,
    justifyContent: 'center',
  },
  imageEditButton: { flex: 1, height: 48, alignItems: 'center', justifyContent: 'center', gap: 2 },
  imageEditLabel: { color: ICON_COLOR, fontSize: 10, fontWeight: '500' },
  // Floating round-corners slider, above the bar (which is ~PANEL_HEIGHT tall).
  sliderWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: PANEL_HEIGHT + 10,
    alignItems: 'center',
    zIndex: 201,
  },
  sliderCard: {
    width: '92%',
    maxWidth: 460,
    backgroundColor: MODAL_BG,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PANEL_HAIRLINE,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  sliderHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  sliderTitle: { color: ICON_COLOR, fontSize: 12, fontWeight: '600' },
  // Drop Shadow bar — full-width, bottom-anchored, slides up over the panel.
  shadowBarWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 205,
  },
});
