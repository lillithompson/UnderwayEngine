import React, { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ObjectPropertiesModel } from '../adapter';
import { IMAGE_EDIT_OPTIONS, ImageEditAction, swipeDismissDirection } from '../logic/imageEdit';
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
const SLIDER_THUMB = 22;

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

// A minimal draggable slider (0–1). Tapping or dragging the track moves the
// thumb to the touch; `onChange` fires live and `onCommit` on release. Built
// on PanResponder (as the sub-panel swipe is) so it needs no slider dep.
function CornerSlider({ value, onChange, onCommit }: {
  value: number;
  onChange: (v: number) => void;
  onCommit: (v: number) => void;
}) {
  const [trackW, setTrackW] = useState(0);
  const trackWRef = useRef(0);
  trackWRef.current = trackW;
  // Latest handlers, so the once-created PanResponder always calls through.
  const cbRef = useRef({ onChange, onCommit });
  cbRef.current = { onChange, onCommit };

  const valueFromX = (x: number) => {
    const w = trackWRef.current;
    if (w <= 0) return 0;
    return Math.max(0, Math.min(1, x / w));
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => cbRef.current.onChange(valueFromX(e.nativeEvent.locationX)),
      onPanResponderMove: (e) => cbRef.current.onChange(valueFromX(e.nativeEvent.locationX)),
      onPanResponderRelease: (e) => cbRef.current.onCommit(valueFromX(e.nativeEvent.locationX)),
      onPanResponderTerminate: (e) => cbRef.current.onCommit(valueFromX(e.nativeEvent.locationX)),
    }),
  ).current;

  const clamped = Math.max(0, Math.min(1, value));
  const thumbLeft = clamped * trackW;
  return (
    <View
      style={styles.sliderTrackHit}
      onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
      {...pan.panHandlers}
    >
      <View style={styles.sliderTrack} />
      <View style={[styles.sliderFill, { width: thumbLeft }]} />
      <View style={[styles.sliderThumb, { left: thumbLeft - SLIDER_THUMB / 2 }]} />
    </View>
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
      if (finished) { setImageEditMounted(false); model.onRoundOpenChange?.(false); }
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
      panX.setValue(0);
    }
    // model.onRoundOpenChange is a stable setter; listing the whole model
    // would re-run this every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.visible, model.showImageEdit, imageEditMounted, panX]);

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

  const runImageAction = (action: ImageEditAction) => {
    if (action === 'roundCorners') { toggleRound(); return; }
    model.onRoundOpenChange?.(false);
    if (action === 'replace') model.onReplaceImage?.();
    else if (action === 'tint') model.onTintImage?.();
    else if (action === 'crop') model.onCropImage?.();
    else if (action === 'shadow') model.onShadowImage?.();
    else if (action === 'glow') model.onGlowImage?.();
    else if (action === 'border') model.onBorderImage?.();
  };

  // Slider drag → live preview; release → one undo step. Value is 0–1; the
  // model works in the 0–MAX_CORNER_RADIUS fraction space.
  const onSliderChange = (v: number) => {
    setSliderVal(v);
    model.onCornerRadius?.(v * MAX_CORNER_RADIUS, false);
  };
  const onSliderCommit = (v: number) => {
    model.onCornerRadius?.(v * MAX_CORNER_RADIUS, true);
  };

  if (!mounted) return null;

  const hasGroupActions = !!(model.onGroup || model.onUngroup || model.onJoin || model.onUnion);

  return (
    <>
      {model.roundOpen ? (
        <View style={styles.sliderWrap} pointerEvents="box-none">
          <View style={styles.sliderCard}>
            <View style={styles.sliderHeaderRow}>
              <Text style={styles.sliderTitle}>Round corners</Text>
              <MaterialCommunityIcons name="rounded-corner" size={16} color={ICON_COLOR} />
            </View>
            <CornerSlider value={sliderVal} onChange={onSliderChange} onCommit={onSliderCommit} />
          </View>
        </View>
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
  sliderTrackHit: { height: SLIDER_THUMB + 12, justifyContent: 'center' },
  sliderTrack: { height: 4, borderRadius: 2, backgroundColor: PANEL_HAIRLINE },
  sliderFill: {
    position: 'absolute',
    left: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: ICON_COLOR,
  },
  sliderThumb: {
    position: 'absolute',
    width: SLIDER_THUMB,
    height: SLIDER_THUMB,
    borderRadius: SLIDER_THUMB / 2,
    backgroundColor: MODAL_TEXT,
    borderWidth: 1,
    borderColor: PANEL_HAIRLINE,
  },
});
