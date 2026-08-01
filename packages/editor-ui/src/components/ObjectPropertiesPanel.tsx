import React, { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { BorderModel, FramingModel, ObjectPropertiesModel, ShadowModel } from '../adapter';
import { IMAGE_EDIT_OPTIONS, ImageEditAction, swipeDismissDirection } from '../logic/imageEdit';
import { ShadowBar } from './ShadowBar';
import { BorderBar } from './BorderBar';
import { CropBar } from './CropBar';
import { BAR_BG } from './effectBar';
import { useSlideSwipeBar } from './useSlideSwipeBar';
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
const DEFAULT_SHADOW_MODEL: ShadowModel = {
  dx: 0.75, dy: 0.875, blur: 1.125, spread: 0.125, color: { r: 0, g: 0, b: 0 }, opacity: 0.45,
};
// Design default border: 6pt (0.375 cell) centered solid stroke.
const DEFAULT_BORDER_MODEL: BorderModel = {
  width: 0.375, position: 'center', dash: 0, color: { r: 58, g: 53, b: 50 },
};
// Design default framing (Zoom 130%, Margin 14pt, Ratio 1:1, Straighten 0°,
// Size 46, Spacing 6pt). Lengths in world cells (pt ÷ 16).
const DEFAULT_FRAMING_MODEL: FramingModel = {
  mode: 'fill', zoom: 1.3, margin: 0.875, ratio: 'square', angle: 0, tileScale: 0.46, tileGap: 0.375,
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

export function ObjectPropertiesPanel({ model, safeBottom = 0 }: {
  model: ObjectPropertiesModel;
  /** Bottom safe-area inset (home indicator). Padded under the bottom-anchored
   *  effect bars so their controls clear it; 0 on non-notched / web. */
  safeBottom?: number;
}) {
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

  // ── Image-edit sub-panel ────────────────────────────────────────────
  // Pressing Edit on an image slides this layer in over the action row; it
  // is dismissed by swiping it sideways (either way), mirroring the title
  // banner's swipe feel — the content follows the finger, then a past-
  // threshold release throws it off-screen and reveals the row beneath.
  const [imageEditMounted, setImageEditMounted] = useState(false);
  // Shadow / Border controls each seed a local draft from model.shadow /
  // model.border when they open, then own the tracked params so live previews
  // don't fight the sliders (color still comes from the model — it's changed
  // externally via the full-screen picker).
  const [shadowDraft, setShadowDraft] = useState<ShadowModel | null>(null);
  const prevShadowOpen = useRef(false);
  const [borderDraft, setBorderDraft] = useState<BorderModel | null>(null);
  const prevBorderOpen = useRef(false);
  const [cropDraft, setCropDraft] = useState<FramingModel | null>(null);
  const prevCropOpen = useRef(false);
  // The Drop Shadow, Border and Crop bars each slide in horizontally over the
  // edit controls and can be swiped sideways to dismiss (shared chrome).
  const shadowBar = useSlideSwipeBar(!!model.shadowOpen, width, () => model.onShadowOpenChange?.(false));
  const borderBar = useSlideSwipeBar(!!model.borderOpen, width, () => model.onBorderOpenChange?.(false));
  const cropBar = useSlideSwipeBar(!!model.cropOpen, width, () => model.onCropOpenChange?.(false));

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
        model.onShadowOpenChange?.(false);
        model.onBorderOpenChange?.(false);
        model.onCropOpenChange?.(false);
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
      model.onShadowOpenChange?.(false);
      model.onBorderOpenChange?.(false);
      model.onCropOpenChange?.(false);
      panX.setValue(0);
    }
    // model.on*OpenChange are stable setters; listing the whole model would
    // re-run this every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.visible, model.showImageEdit, imageEditMounted, panX]);

  // Seed the shadow / border drafts from the current effect each time the
  // controls open.
  useEffect(() => {
    if (model.shadowOpen && !prevShadowOpen.current) {
      setShadowDraft(model.shadow ?? DEFAULT_SHADOW_MODEL);
    }
    prevShadowOpen.current = !!model.shadowOpen;
  }, [model.shadowOpen, model.shadow]);
  useEffect(() => {
    if (model.borderOpen && !prevBorderOpen.current) {
      setBorderDraft(model.border ?? DEFAULT_BORDER_MODEL);
    }
    prevBorderOpen.current = !!model.borderOpen;
  }, [model.borderOpen, model.border]);
  useEffect(() => {
    if (model.cropOpen && !prevCropOpen.current) {
      setCropDraft(model.framing ?? DEFAULT_FRAMING_MODEL);
    }
    prevCropOpen.current = !!model.cropOpen;
  }, [model.cropOpen, model.framing]);

  const openImageEdit = () => {
    panX.setValue(width); // start just off the right edge, then slide in
    setImageEditMounted(true);
    Animated.timing(panX, { toValue: 0, duration: PANEL_ANIM_MS, useNativeDriver: true }).start();
  };

  const toggleShadow = () => model.onShadowOpenChange?.(!model.shadowOpen);
  const toggleBorder = () => model.onBorderOpenChange?.(!model.borderOpen);
  const toggleCrop = () => model.onCropOpenChange?.(!model.cropOpen);

  const runImageAction = (action: ImageEditAction) => {
    if (action === 'shadow') { toggleShadow(); return; }
    if (action === 'border') { toggleBorder(); return; }
    if (action === 'crop') { toggleCrop(); return; }
    // Any other action closes the transient bars.
    model.onShadowOpenChange?.(false);
    model.onBorderOpenChange?.(false);
    model.onCropOpenChange?.(false);
    if (action === 'replace') model.onReplaceImage?.();
    else if (action === 'tint') model.onTintImage?.();
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

  // Border controls → live preview / commit through the model; same pattern.
  const applyBorder = (b: BorderModel, committed: boolean) => {
    setBorderDraft(b);
    model.onBorder?.(b, committed);
  };
  const removeBorder = () => {
    model.onBorder?.(null, true);
    model.onBorderOpenChange?.(false);
  };

  // Crop controls → live preview / commit; the draft owns the tracked params
  // (there's no external color). Reset re-seeds the draft to the defaults so
  // the sliders/segments snap back with the bar staying open.
  const applyFraming = (f: FramingModel, committed: boolean) => {
    setCropDraft(f);
    model.onFraming?.(f, committed);
  };
  const resetFraming = () => {
    model.onResetFraming?.();
    setCropDraft(DEFAULT_FRAMING_MODEL);
  };

  if (!mounted) return null;

  const hasGroupActions = !!(model.onGroup || model.onUngroup || model.onJoin || model.onUnion);
  // Params tracked by the sliders/pad come from the local draft; color comes
  // from the model (it's changed externally, via the full-screen picker).
  const shadowForBar: ShadowModel = shadowDraft
    ? { ...shadowDraft, color: model.shadow?.color ?? shadowDraft.color }
    : (model.shadow ?? DEFAULT_SHADOW_MODEL);
  const borderForBar: BorderModel = borderDraft
    ? { ...borderDraft, color: model.border?.color ?? borderDraft.color }
    : (model.border ?? DEFAULT_BORDER_MODEL);
  const framingForBar: FramingModel = cropDraft ?? model.framing ?? DEFAULT_FRAMING_MODEL;

  return (
    <>
      {shadowBar.mounted ? (
        <Animated.View
          style={[styles.effectBarWrap, { paddingBottom: safeBottom, backgroundColor: BAR_BG, transform: [{ translateX: shadowBar.translateX }] }]}
          {...shadowBar.panHandlers}
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
      {borderBar.mounted ? (
        <Animated.View
          style={[styles.effectBarWrap, { paddingBottom: safeBottom, backgroundColor: BAR_BG, transform: [{ translateX: borderBar.translateX }] }]}
          {...borderBar.panHandlers}
        >
          <BorderBar
            border={borderForBar}
            cornerRadius={model.cornerRadius ?? 0}
            onChange={(b) => applyBorder(b, false)}
            onCommit={(b) => applyBorder(b, true)}
            onCornerRadius={(r, committed) => model.onCornerRadius?.(r, committed)}
            onBack={() => model.onBorderOpenChange?.(false)}
            onRemove={removeBorder}
            onPickColor={() => model.onPickBorderColor?.()}
          />
        </Animated.View>
      ) : null}
      {cropBar.mounted ? (
        <Animated.View
          style={[styles.effectBarWrap, { paddingBottom: safeBottom, backgroundColor: BAR_BG, transform: [{ translateX: cropBar.translateX }] }]}
          {...cropBar.panHandlers}
        >
          <CropBar
            framing={framingForBar}
            onChange={(f) => applyFraming(f, false)}
            onCommit={(f) => applyFraming(f, true)}
            onBack={() => model.onCropOpenChange?.(false)}
            onReset={resetFraming}
          />
        </Animated.View>
      ) : null}
      <View style={styles.clip} pointerEvents="box-none">
        <Animated.View style={[styles.panel, { paddingBottom: safeBottom, transform: [{ translateY }] }]}>
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
  // Full-width, bottom-anchored effect bar (Drop Shadow / Border) that slides
  // in over the panel.
  effectBarWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 205,
  },
});
