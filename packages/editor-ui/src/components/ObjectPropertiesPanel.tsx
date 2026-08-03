import React, { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { BorderModel, FramingModel, ObjectPropertiesModel, RGBLike, ShadowModel, TextStyleModel } from '../adapter';
import { IMAGE_EDIT_OPTIONS, ImageEditAction, swipeDismissDirection } from '../logic/imageEdit';
import { rgbCss } from '../logic/hsv';
import { ShadowBar } from './ShadowBar';
import { BorderBar } from './BorderBar';
import { CropBar } from './CropBar';
import { TextBar } from './TextBar';
import { BAR_BG } from './effectBar';
import {
  HEADER_BG,
  MODAL_BG,
  MODAL_TEXT,
  OBJECT_MENU_HEIGHT,
  OBJECT_PANEL_HEIGHT,
  PANEL_ANIM_MS,
  PANEL_HAIRLINE,
} from '../theme';

// Facet's ObjectPropertiesPanel: a bottom sheet that slides up (150ms) when
// something is selected — dark raised surface, hairline top border, icon
// buttons grouped by hairline dividers. Below 500px wide the buttons go
// compact (24px icons, flex-weighted groups). Group actions (group/ungroup/
// join/union) render only when the app supplies them (Facet superset;
// CozyJournal leaves them unset).
//
// The panel is a compact fixed height (OBJECT_PANEL_HEIGHT) — just one row of
// buttons and the carousel dots. It shows one row of icon+caption
// buttons at a time: the common actions (rotate / flip / copy / lock / delete)
// or — when the selection has them — the type-specific options (images: replace
// / tint / crop / shadow / border; text: edit / type). A leading `<` cell swaps
// between the two, sliding the row leftward; a horizontal swipe (either
// direction) swaps too. Crop / Shadow / Border / Text open their full editing
// bar (the taller OBJECT_MENU_HEIGHT), which slides up over the panel as a
// carousel: a left/right swipe cycles forward/back through the available
// submenus (dots at the bottom track the position) and a downward swipe
// dismisses.

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
/** Value-equality for the Crop bar's tracked params. A slider's own live edit
 *  round-trips to an equal model.framing, so this lets the draft ignore its own
 *  echo while still following genuinely external changes (e.g. the two-finger
 *  pinch-zoom on the canvas). */
const sameFramingModel = (a: FramingModel, b: FramingModel): boolean =>
  a.mode === b.mode && a.zoom === b.zoom && a.margin === b.margin && a.ratio === b.ratio &&
  a.angle === b.angle && a.tileScale === b.tileScale && a.tileGap === b.tileGap;
// Fallback seed for the Text bar when the app hasn't supplied a style yet
// (it always does while a text is selected — this only guards the transient
// frame before model.textStyle lands).
const DEFAULT_TEXT_STYLE_MODEL: TextStyleModel = {
  fontId: 'system', weight: 'regular', size: 2, letterSpacing: 0, lineHeight: 1.2, align: 'left', vAlign: 'top', color: { r: 58, g: 53, b: 50 },
};

// The slide-up submenus, in carousel order. Image selections cycle through
// crop / shadow / border (matching their type-option order); text cycles
// through font / align (two pages of the Text bar). Kept in this order so a
// left swipe advances the same way the type-option row reads.
type SubmenuKey = 'crop' | 'shadow' | 'border' | 'font' | 'align';

// One grid cell: an icon over a short caption, weighted (flex) so every button
// shares the same column width whichever set is showing. `caption` is the
// visible label; `label` is the (often longer) accessibility name.
function GridButton({ label, caption, icon, iconColor, swatchColor, onPress, compact, iconOnly }: {
  label: string;
  caption?: string;
  icon: string;
  iconColor?: string;
  /** When set, the button renders a circular color swatch (of this color) in
   *  place of the icon — used by the frame Background button. */
  swatchColor?: RGBLike;
  onPress?: () => void;
  compact: boolean;
  /** Render just the icon (no caption) — used by the swap arrow. */
  iconOnly?: boolean;
}) {
  const glyphSize = compact ? 24 : 28;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.gridButton}
    >
      {swatchColor ? (
        <View style={[styles.swatch, { width: glyphSize, height: glyphSize, borderRadius: glyphSize / 2, backgroundColor: rgbCss(swatchColor) }]} />
      ) : (
        <MaterialCommunityIcons name={icon as MCIName} size={glyphSize} color={iconColor ?? ICON_COLOR} />
      )}
      {iconOnly ? null : <Text style={styles.gridLabel} numberOfLines={1}>{caption ?? label}</Text>}
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
  // Which set the single row shows: false = common actions, true = the
  // type-specific options. The leading `<` cell (and a horizontal swipe) flip
  // it; showTypeRow is ignored when the selection has no type options.
  const [showTypeRow, setShowTypeRow] = useState(false);
  // The panel rests against the bottom edge but pads its content up by the
  // device safe-area inset (home indicator / screen curve on iOS native), so
  // the hidden position must clear the full padded height to slide fully off.
  const hiddenY = OBJECT_PANEL_HEIGHT + safeBottom;
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

  // ── Row swap (common ⇄ type-specific) ───────────────────────────────
  // The visible row slides on a shared translateX. `dir` is the direction the
  // content travels: −1 = leftward (out the left edge, new row in from the
  // right), +1 = rightward. A swap throws the current row off one edge, flips
  // the set, then brings the new row in from the opposite edge; a drag lets the
  // row follow the finger first, then completes in the drag direction.
  const swapX = useRef(new Animated.Value(0)).current;
  const swapping = useRef(false);
  // Latest runner + swipe-eligibility, so the once-created PanResponder always
  // uses the current window width and set availability.
  const runSwapRef = useRef<(dir: -1 | 1) => void>(() => {});
  runSwapRef.current = (dir) => {
    if (swapping.current) return;
    swapping.current = true;
    Animated.timing(swapX, { toValue: dir * width, duration: PANEL_ANIM_MS, useNativeDriver: true }).start(({ finished }) => {
      if (!finished) { swapping.current = false; return; }
      setShowTypeRow((v) => !v);
      swapX.setValue(dir * -width); // place the incoming row just off the opposite edge
      Animated.timing(swapX, { toValue: 0, duration: PANEL_ANIM_MS, useNativeDriver: true }).start(() => {
        swapping.current = false;
      });
    });
  };
  const canSwapRef = useRef(false);

  const swapPan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        canSwapRef.current && Math.abs(g.dx) > 5 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_e, g) => { if (!swapping.current) swapX.setValue(g.dx); },
      onPanResponderRelease: (_e, g) => {
        const dir = swipeDismissDirection(g.dx); // −1 left, +1 right, 0 = too short
        if (dir !== 0 && canSwapRef.current) runSwapRef.current(dir);
        else Animated.spring(swapX, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
      },
      onPanResponderTerminate: () =>
        Animated.spring(swapX, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start(),
    }),
  ).current;

  const hasTypeOptions = !!model.showImageEdit || !!model.showEdit || !!model.showTextStyle || !!model.showFrameOptions;
  // Signature of the current selection's type-option set. It changes when the
  // panel first appears for a selection or the selected object's type changes
  // (image → frame → text …), and empties when the panel hides.
  const typeSig = model.visible
    ? `${model.showImageEdit ? 'i' : ''}${model.showFrameOptions ? 'f' : ''}${model.showTextStyle ? 's' : ''}${model.showEdit ? 'e' : ''}`
    : '';
  const prevTypeSig = useRef('');
  useEffect(() => {
    if (typeSig === prevTypeSig.current) return;
    prevTypeSig.current = typeSig;
    // On each new selection, land on the type-specific options first so they're
    // front-and-centre; fall back to the common actions when the selection has
    // none (also keeps a stale swap from leaving an empty row).
    setShowTypeRow(hasTypeOptions);
  }, [typeSig, hasTypeOptions]);

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
  // The Text bar owns its tracked params too (color still comes from the model
  // — it's changed externally via the full-screen picker).
  const [textDraft, setTextDraft] = useState<TextStyleModel | null>(null);
  const prevTextOpen = useRef(false);
  // The Text bar is a two-page carousel (font / align) sharing the single
  // `textStyleOpen` flag; this tracks which page shows. The entry points own
  // it: the Type button opens on 'font', the Align button on 'align', and the
  // carousel swaps it (all via openSubmenu).
  const [textPage, setTextPage] = useState<'font' | 'align'>('font');
  // ── Submenu carousel (Crop / Shadow / Border / Text) ────────────────
  // The open submenu slides up over the panel; a left/right swipe cycles
  // forward/back through the available submenus, and a downward swipe dismisses.
  // Carousel dots at the bottom track the position. The submenus are separate
  // bars but only one shows at a time, so this drives a single layer: `layerY`
  // for the vertical open/dismiss, `navX` for the horizontal carousel slide.
  const submenuSlide = OBJECT_MENU_HEIGHT + safeBottom;
  const submenuOrder: SubmenuKey[] =
    model.showImageEdit ? ['crop', 'shadow', 'border']
    : model.showFrameOptions ? ['shadow', 'border']
    : model.showTextStyle ? ['font', 'align']
    : [];
  const activeSub: SubmenuKey | null =
    model.cropOpen ? 'crop'
    : model.shadowOpen ? 'shadow'
    : model.borderOpen ? 'border'
    : model.textStyleOpen ? textPage
    : null;
  const submenuOpen = activeSub != null;
  // Keep rendering the last-open bar through the dismiss slide (activeSub goes
  // null the instant it closes, but the bar should stay visible sliding down).
  const lastSubRef = useRef<SubmenuKey | null>(null);
  if (activeSub) lastSubRef.current = activeSub;
  const displaySub = activeSub ?? lastSubRef.current;
  const activeIndex = displaySub ? submenuOrder.indexOf(displaySub) : -1;

  // True while the Text bar's font sheet (a scrollable list) is open. The
  // submenu pan responder reads this to stand down, so dragging to scroll the
  // list isn't mistaken for a downward dismiss swipe. Reset on every submenu
  // change so it can't linger true over a different bar.
  const fontSheetOpenRef = useRef(false);

  const openSubmenu = (key: SubmenuKey) => {
    fontSheetOpenRef.current = false;
    if (key === 'crop') model.onCropOpenChange?.(true);
    else if (key === 'shadow') model.onShadowOpenChange?.(true);
    else if (key === 'border') model.onBorderOpenChange?.(true);
    else if (key === 'font' || key === 'align') {
      // Both text pages ride the single textStyleOpen flag; the page state
      // picks which one shows (drives the carousel between them).
      setTextPage(key);
      model.onTextStyleOpenChange?.(true);
    }
  };
  const dismissSubmenu = () => {
    fontSheetOpenRef.current = false;
    model.onShadowOpenChange?.(false);
    model.onBorderOpenChange?.(false);
    model.onCropOpenChange?.(false);
    model.onTextStyleOpenChange?.(false);
  };

  const [submenuMounted, setSubmenuMounted] = useState(false);
  const layerY = useRef(new Animated.Value(0)).current;
  const navX = useRef(new Animated.Value(0)).current;
  const prevSubmenuOpen = useRef(false);
  const navigating = useRef(false);

  // Vertical open / dismiss. Skipped while merely navigating between submenus
  // (submenuOpen stays true), so switching bars is a purely horizontal slide.
  useEffect(() => {
    if (submenuOpen && !prevSubmenuOpen.current) {
      prevSubmenuOpen.current = true;
      setSubmenuMounted(true);
      navX.setValue(0);
      layerY.setValue(submenuSlide);
      const anim = Animated.timing(layerY, { toValue: 0, duration: PANEL_ANIM_MS, useNativeDriver: true });
      anim.start();
      return () => anim.stop();
    }
    if (!submenuOpen && prevSubmenuOpen.current) {
      prevSubmenuOpen.current = false;
      const anim = Animated.timing(layerY, { toValue: submenuSlide, duration: PANEL_ANIM_MS, useNativeDriver: true });
      anim.start(({ finished }) => { if (finished) setSubmenuMounted(false); });
      return () => anim.stop();
    }
  }, [submenuOpen, layerY, navX, submenuSlide]);

  // Carousel navigation. dir −1 = swipe left → forward (next submenu); +1 =
  // swipe right → back. The current bar slides off in the swipe direction, the
  // set switches, and the next bar slides in from the opposite edge.
  const runNavRef = useRef<(dir: -1 | 1) => void>(() => {});
  runNavRef.current = (dir) => {
    if (navigating.current || submenuOrder.length < 2 || activeIndex < 0) return;
    navigating.current = true;
    const len = submenuOrder.length;
    const nextIndex = (activeIndex - dir + len) % len;
    Animated.timing(navX, { toValue: dir * width, duration: PANEL_ANIM_MS, useNativeDriver: true }).start(({ finished }) => {
      if (!finished) { navigating.current = false; return; }
      openSubmenu(submenuOrder[nextIndex]);
      navX.setValue(dir * -width);
      Animated.timing(navX, { toValue: 0, duration: PANEL_ANIM_MS, useNativeDriver: true }).start(() => {
        navigating.current = false;
      });
    });
  };
  // Latest dismiss + nav-eligibility for the once-created PanResponder.
  const dismissRef = useRef<() => void>(() => {});
  dismissRef.current = dismissSubmenu;
  const canNavRef = useRef(false);
  canNavRef.current = submenuOrder.length > 1;

  const submenuPan = useRef(
    PanResponder.create({
      // Claim a clearly-horizontal fling (carousel) or a clearly-downward drag
      // (dismiss) — but never while the font sheet is open, so scrolling its
      // list isn't hijacked as a dismiss / carousel swipe.
      onMoveShouldSetPanResponder: (_e, g) =>
        !fontSheetOpenRef.current &&
        ((Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5) ||
          (g.dy > 10 && g.dy > Math.abs(g.dx) * 1.5)),
      onPanResponderMove: (_e, g) => {
        if (navigating.current) return;
        if (Math.abs(g.dx) > Math.abs(g.dy)) { if (canNavRef.current) navX.setValue(g.dx); }
        else if (g.dy > 0) layerY.setValue(g.dy);
      },
      onPanResponderRelease: (_e, g) => {
        if (navigating.current) return;
        const horiz = swipeDismissDirection(g.dx);
        const down = swipeDismissDirection(g.dy) === 1 && Math.abs(g.dy) >= Math.abs(g.dx);
        if (down) {
          dismissRef.current();
          Animated.spring(navX, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
        } else if (horiz !== 0 && canNavRef.current) {
          runNavRef.current(horiz);
        } else {
          Animated.spring(navX, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
          Animated.spring(layerY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(navX, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
        Animated.spring(layerY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
      },
    }),
  ).current;

  // Fold the effect bars away the moment the selection can no longer use them
  // (or the whole panel hides) so none lingers over the next object's actions.
  // Frames reuse the Shadow / Border bars (but never Crop), so keep those open
  // while a frame is selected.
  useEffect(() => {
    const canEffect = model.showImageEdit || model.showFrameOptions;
    if (!model.visible || !canEffect) {
      model.onShadowOpenChange?.(false);
      model.onBorderOpenChange?.(false);
    }
    if (!model.visible || !model.showImageEdit) {
      model.onCropOpenChange?.(false);
    }
    // model.on*OpenChange are stable setters; listing the whole model would
    // re-run this every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.visible, model.showImageEdit, model.showFrameOptions]);

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
      // Just opened: seed the draft from the current framing.
      setCropDraft(model.framing ?? DEFAULT_FRAMING_MODEL);
    } else if (model.cropOpen && model.framing) {
      // Already open: follow external framing changes (the two-finger pinch-zoom
      // on the canvas) so the sliders track them. A slider's own live edit
      // round-trips to an equal model.framing, so `sameFramingModel` no-ops it —
      // returning the same draft reference lets React skip the re-render.
      setCropDraft((d) => (d && sameFramingModel(d, model.framing!) ? d : model.framing!));
    }
    prevCropOpen.current = !!model.cropOpen;
  }, [model.cropOpen, model.framing]);
  useEffect(() => {
    if (model.textStyleOpen && !prevTextOpen.current) {
      setTextDraft(model.textStyle ?? DEFAULT_TEXT_STYLE_MODEL);
    }
    prevTextOpen.current = !!model.textStyleOpen;
  }, [model.textStyleOpen, model.textStyle]);
  // Fold the Text bar away the moment the selection is no longer editable text
  // (or the whole bar hides), so it never lingers over the next object.
  useEffect(() => {
    if ((!model.visible || !model.showTextStyle) && model.textStyleOpen) {
      model.onTextStyleOpenChange?.(false);
    }
    // model.on* are stable setters; listing the whole model would re-run this
    // every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.visible, model.showTextStyle, model.textStyleOpen]);

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

  // Text style → live preview / commit; the draft owns the tracked params, so
  // the sliders keep tracking (color comes from the model). Reset re-seeds the
  // draft from the model's post-reset style (font + color kept).
  const applyTextStyle = (s: TextStyleModel, committed: boolean) => {
    setTextDraft(s);
    model.onTextStyle?.(s, committed);
  };
  const resetTextStyle = () => {
    model.onResetTextStyle?.();
    // Re-seed on the next open from the model; clear the draft so the freshly
    // reset style flows in.
    setTextDraft(null);
    prevTextOpen.current = false;
  };

  if (!mounted) return null;

  // Common actions (rotate / flip / copy / lock / delete, plus the optional
  // group actions). Built as an array so it and the type-options set share a
  // column count and the row keeps a stable cell width across a swap.
  const row1: React.ReactNode[] = [
    <GridButton key="rotate" label="Rotate" icon="rotate-right" onPress={model.onRotate} compact={compact} />,
    <GridButton key="flipH" label="Mirror H" caption="Flip H" icon="arrow-left-right" onPress={model.onMirrorH} compact={compact} />,
    <GridButton key="flipV" label="Mirror V" caption="Flip V" icon="arrow-up-down" onPress={model.onMirrorV} compact={compact} />,
    <GridButton key="copy" label="Duplicate" caption="Copy" icon="content-copy" onPress={model.onDuplicate} compact={compact} />,
    <GridButton
      key="lock"
      label={model.locked ? 'Locked' : 'Lock'}
      caption={model.locked ? 'Locked' : 'Lock'}
      icon={model.locked ? 'lock' : 'lock-open-outline'}
      iconColor={model.locked ? ICON_COLOR_STRONG : ICON_COLOR}
      onPress={model.onToggleLock}
      compact={compact}
    />,
    <GridButton key="delete" label="Delete" caption="Delete" icon="delete-outline" onPress={model.onDelete} compact={compact} />,
  ];
  if (model.onGroup) row1.push(<GridButton key="group" label="Group" caption="Group" icon="group" onPress={model.onGroup} compact={compact} />);
  // Frames surface Ungroup in their own type-options row (not the common row),
  // so skip it here when the frame options are showing.
  if (model.onUngroup && !model.showFrameOptions) row1.push(<GridButton key="ungroup" label="Ungroup" caption="Ungroup" icon="ungroup" onPress={model.onUngroup} compact={compact} />);
  if (model.onJoin) row1.push(<GridButton key="join" label="Join" caption="Join" icon="vector-combine" onPress={model.onJoin} compact={compact} />);
  if (model.onUnion) row1.push(<GridButton key="union" label="Union" caption="Union" icon="vector-union" onPress={model.onUnion} compact={compact} />);

  // Type-specific options (images: the image-edit set; text: Edit + Type),
  // null when the selection has none.
  let typeOptions: React.ReactNode[] | null = null;
  if (model.showImageEdit) {
    typeOptions = IMAGE_EDIT_OPTIONS.map((opt) => (
      <GridButton key={opt.action} label={opt.label} icon={opt.icon} onPress={() => runImageAction(opt.action)} compact={compact} />
    ));
  } else if (model.showFrameOptions) {
    // Frame options: Background (circular color swatch) · Shadow · Border ·
    // Ungroup. Shadow / Border reuse the image effect bars (the frame submenu
    // carousel). Background opens the shared full-screen color picker.
    typeOptions = [
      <GridButton
        key="background"
        label="Background color"
        caption="Fill"
        icon="palette"
        swatchColor={model.frameBackgroundColor}
        onPress={model.onPickFrameBackground}
        compact={compact}
      />,
      <GridButton key="shadow" label="Shadow" caption="Shadow" icon="box-shadow" onPress={toggleShadow} compact={compact} />,
      <GridButton key="border" label="Border" caption="Border" icon="border-outside" onPress={toggleBorder} compact={compact} />,
    ];
    if (model.onUngroup) {
      typeOptions.push(<GridButton key="ungroup" label="Ungroup" caption="Ungroup" icon="ungroup" onPress={model.onUngroup} compact={compact} />);
    }
  } else if (model.showEdit || model.showTextStyle) {
    // Edit (content) · Type (opens the Text bar on the Font page) · Align (opens
    // it straight on the Align page). Type / Align both slide the same two-page
    // Text bar up; they differ only in which page it lands on.
    typeOptions = [];
    if (model.showEdit) typeOptions.push(<GridButton key="edit" label="Edit" caption="Edit" icon="pencil-outline" onPress={model.onEdit} compact={compact} />);
    if (model.showTextStyle) typeOptions.push(<GridButton key="type" label="Type" caption="Type" icon="format-font" onPress={() => openSubmenu('font')} compact={compact} />);
    if (model.showTextStyle) typeOptions.push(<GridButton key="align" label="Align" caption="Align" icon="format-align-center" onPress={() => openSubmenu('align')} compact={compact} />);
  }

  // Only one set shows at a time; the `<` cell (far right) swaps between them.
  // Columns stay fixed (the larger set + the arrow) so the cells don't resize
  // on swap; empty cells sit between the buttons and the right-aligned arrow.
  const canSwap = !!typeOptions;
  canSwapRef.current = canSwap;
  const showType = canSwap && showTypeRow;
  const activeButtons = showType ? typeOptions! : row1;
  const columns = Math.max(row1.length, typeOptions ? typeOptions.length : 0) + (canSwap ? 1 : 0);
  // Empty cells keep each button one grid column wide (so the buttons never
  // resize); split them either side of the button group to centre it, with the
  // arrow always in the last column.
  const totalPad = Math.max(0, columns - activeButtons.length - (canSwap ? 1 : 0));
  const padLeft = Math.min(totalPad, Math.floor((columns - activeButtons.length) / 2));
  const padRight = totalPad - padLeft;
  const swapArrow = canSwap ? (
    <GridButton
      key="swap"
      label={showType ? 'Back to common actions' : 'Show edit options'}
      icon="chevron-left"
      iconOnly
      onPress={() => runSwapRef.current(-1)}
      compact={compact}
    />
  ) : null;

  // Params tracked by the sliders/pad come from the local draft; color comes
  // from the model (it's changed externally, via the full-screen picker).
  const shadowForBar: ShadowModel = shadowDraft
    ? { ...shadowDraft, color: model.shadow?.color ?? shadowDraft.color }
    : (model.shadow ?? DEFAULT_SHADOW_MODEL);
  const borderForBar: BorderModel = borderDraft
    ? { ...borderDraft, color: model.border?.color ?? borderDraft.color }
    : (model.border ?? DEFAULT_BORDER_MODEL);
  const framingForBar: FramingModel = cropDraft ?? model.framing ?? DEFAULT_FRAMING_MODEL;
  // Tracked type params come from the draft; color comes from the model (the
  // full-screen picker changes it externally, like the effect bars' colors).
  const textForBar: TextStyleModel = textDraft
    ? { ...textDraft, color: model.textStyle?.color ?? textDraft.color }
    : (model.textStyle ?? DEFAULT_TEXT_STYLE_MODEL);

  // The currently-shown submenu bar (retained through the dismiss slide). onBack
  // (the down chevron) dismisses the whole submenu layer.
  let activeBarEl: React.ReactNode = null;
  if (displaySub === 'shadow') {
    activeBarEl = (
      <ShadowBar
        shadow={shadowForBar}
        onChange={(s) => applyShadow(s, false)}
        onCommit={(s) => applyShadow(s, true)}
        onBack={dismissSubmenu}
        onRemove={removeShadow}
        onPickColor={() => model.onPickShadowColor?.()}
      />
    );
  } else if (displaySub === 'border') {
    activeBarEl = (
      <BorderBar
        border={borderForBar}
        cornerRadius={model.cornerRadius ?? 0}
        onChange={(b) => applyBorder(b, false)}
        onCommit={(b) => applyBorder(b, true)}
        onCornerRadius={(r, committed) => model.onCornerRadius?.(r, committed)}
        onBack={dismissSubmenu}
        onRemove={removeBorder}
        onPickColor={() => model.onPickBorderColor?.()}
      />
    );
  } else if (displaySub === 'crop') {
    activeBarEl = (
      <CropBar
        framing={framingForBar}
        onChange={(f) => applyFraming(f, false)}
        onCommit={(f) => applyFraming(f, true)}
        onBack={dismissSubmenu}
        onReset={resetFraming}
      />
    );
  } else if (displaySub === 'font' || displaySub === 'align') {
    activeBarEl = (
      <TextBar
        page={displaySub}
        style={textForBar}
        fonts={model.fonts ?? []}
        onChange={(s) => applyTextStyle(s, false)}
        onCommit={(s) => applyTextStyle(s, true)}
        onBack={dismissSubmenu}
        onReset={resetTextStyle}
        onPickColor={() => model.onPickTextColor?.()}
        onSheetOpenChange={(open) => { fontSheetOpenRef.current = open; }}
      />
    );
  }

  return (
    <>
      {submenuMounted ? (
        <Animated.View
          style={[styles.effectBarWrap, { height: submenuSlide, paddingBottom: safeBottom, backgroundColor: BAR_BG, transform: [{ translateY: layerY }] }]}
          {...submenuPan.panHandlers}
        >
          <Animated.View style={{ transform: [{ translateX: navX }] }}>
            {activeBarEl}
          </Animated.View>
          {submenuOrder.length > 1 ? (
            <View style={[styles.submenuDots, { bottom: safeBottom + 8 }]} pointerEvents="none">
              {submenuOrder.map((k, i) => (
                <View key={k} style={[styles.dot, i === activeIndex && styles.dotActive]} />
              ))}
            </View>
          ) : null}
        </Animated.View>
      ) : null}
      <View style={styles.clip} pointerEvents="box-none">
        <Animated.View style={[styles.panel, { height: OBJECT_PANEL_HEIGHT + safeBottom, paddingBottom: safeBottom, transform: [{ translateY }] }]}>
        {/* A single row of buttons (common actions or type-specific options)
            that the `<` cell / a horizontal swipe slides between. Empty cells
            flank the buttons to centre the group; the arrow stays last.
            Carousel dots below track which page is showing. */}
        <View style={styles.swapArea} {...(canSwap ? swapPan.panHandlers : {})}>
          <Animated.View style={{ transform: [{ translateX: swapX }] }}>
            <View style={styles.gridRow}>
              {Array.from({ length: padLeft }).map((_, i) => <View key={`padL${i}`} style={styles.gridSpacer} />)}
              {activeButtons}
              {Array.from({ length: padRight }).map((_, i) => <View key={`padR${i}`} style={styles.gridSpacer} />)}
              {swapArrow}
            </View>
          </Animated.View>
        </View>
        {canSwap ? (
          <View style={styles.dotsRow}>
            <View style={[styles.dot, !showType && styles.dotActive]} />
            <View style={[styles.dot, showType && styles.dotActive]} />
          </View>
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
    // 16 to match the effect bars' content inset, so the title lands in the
    // same place whether the panel or an effect bar is showing.
    paddingHorizontal: 16,
  },
  // Fills the panel so a horizontal swipe anywhere over it (not just on the
  // buttons) swaps the row.
  swapArea: { flex: 1 },
  // Carousel dots (bottom): one filled for the current page, the other empty.
  dotsRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingTop: 4, paddingBottom: 8 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.28)' },
  dotActive: { backgroundColor: ICON_COLOR },
  // Submenu carousel dots, pinned to the bottom of the slide-up layer.
  submenuDots: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
  // A grid row: equal-width cells (the buttons) plus any right-side padding
  // cells, so the common-actions and type-options sets share the same columns
  // (stable cell width across a swap). Cell gap matches the transform spacing.
  gridRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 2,
    paddingTop: 4,
    paddingBottom: 8,
  },
  gridButton: { flex: 1, height: 48, alignItems: 'center', justifyContent: 'center', gap: 2 },
  // Circular color swatch (frame Background button), a hairline ring so a
  // near-background fill still reads as a control.
  swatch: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.55)' },
  gridSpacer: { flex: 1 },
  gridLabel: { color: ICON_COLOR, fontSize: 10, fontWeight: '500' },
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
