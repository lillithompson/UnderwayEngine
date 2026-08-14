import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { AlignEdge, BorderModel, EndpointsModel, FramingModel, ObjectPropertiesModel, OpacityModel, RGBLike, ShadowModel, TextStyleModel, TintModel } from '../adapter';
import { IMAGE_EDIT_OPTIONS, ImageEditAction, formatPixelSize, swipeDismissDirection } from '../logic/imageEdit';
import { PAINT_EDIT_OPTIONS } from '../logic/paintEdit';
import { multiSelectionOptions } from '../logic/multiOptions';
import { SubmenuKey, typeMenuHeight } from '../logic/submenuHeight';
import { svgEditOptions, svgHasEndpoints, svgHasFill, svgHasOpacity, svgStrokeRows } from '../logic/svgEdit';
import { DEFAULT_TINT_MODEL, addStop } from '../logic/tint';
import {
  OBJECT_DOTS_BOTTOM,
  OBJECT_DOT_SIZE,
  OPTION_CAPSULE_HEIGHT,
  OPTION_CAPSULE_MAX_WIDTH,
  OPTION_PILL_PAD,
  OPTION_ROW_GAP,
  PanelPage,
  landingPanelPage,
  objectPanelLayout,
  objectPanelPages,
  optionCapsuleLefts,
  optionRowSidePad,
  stepPanelPage,
} from '../logic/panelLayout';
import { ColorSwatchFill } from './ColorSwatch';
import { ShadowBar } from './ShadowBar';
import { BorderBar } from './BorderBar';
import { OpacityBar } from './OpacityBar';
import { RigPoseBar } from './RigPoseBar';
import { RIG_PART_OPTIONS, restRigSliders } from '../logic/rigEdit';
import type { RigPart } from '../logic/rigEdit';
import { CropBar } from './CropBar';
import { TextBar } from './TextBar';
import { TintBar } from './TintBar';
import { EndpointsBar } from './EndpointsBar';
import { LayoutBar } from './LayoutBar';
import { BAR_BG } from './effectBar';
import {
  PANEL_ANIM_MS,
  PANEL_BG,
  PANEL_BORDER,
  PANEL_DOT,
  PANEL_ICON,
  PANEL_INK,
  PANEL_INK_LABEL,
  PANEL_SWATCH_BORDER,
  PATTERN_ACTIVE,
  STATE_ACTIVE,
} from '../theme';

// Facet's ObjectPropertiesPanel: a bottom sheet that slides up (150ms) when
// something is selected — light raised surface (the toolbar's #e5e5e5, so top
// and bottom chrome match; see PANEL_BG in theme.ts), hairline top border,
// icon buttons grouped by hairline dividers. Below 500px wide the buttons go
// compact (24px icons, flex-weighted groups). The structural actions
// (group/ungroup/join, and the boolean union) render only when the app
// supplies them (Facet superset) — and for a multi-selection Group and Merge
// move off this row onto the selection's own page (below), because they
// describe the selection rather than what it is made of.
//
// The panel is a compact fixed height (OBJECT_PANEL_HEIGHT) — just one row of
// buttons and the carousel dots. It shows one row at a time; a horizontal
// swipe cycles through the pages, sliding the row along, and the dots below
// track which is showing (logic/panelLayout.ts owns the page order):
//
//   common — rotate / flip / copy / lock / delete, as bare icons: universal
//            enough to need no caption. Every selection has this page.
//   type   — what the selection's KIND offers (images: tint / crop / shadow /
//            border / opacity; text: edit / type / align / shadow), as word
//            capsules in the toolbar line-mode pushdown's style.
//   multi  — what the SELECTION offers (Layout · Group · Merge), same word
//            capsules. Multi-selections only, and independent of what the
//            members are: a mixed selection has this page and no type page.
//
// A new selection lands on the leftmost page it brought with it — its type
// options, else the multi ones — rather than on the common actions.
//
// Crop / Shadow / Border / Text open their full editing bar, which STACKS
// ABOVE this panel rather than covering it — the bar's bottom edge meets the
// panel's top, so the options row stays visible underneath and the option that
// opened the bar wears the pushdown's selection blue to say so. That lit pill
// is why the bar carries no carousel dots of its own. The bar is still a
// carousel: a left/right swipe cycles forward/back through the available
// submenus and a downward swipe dismisses, dropping it back down behind the
// panel. Its height is the tallest bar THIS selection can reach and no more
// (logic/submenuHeight.ts), so the top edge holds still across the carousel
// without a text selection reserving an image bar's room.

type MCIName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const ICON_COLOR = PANEL_ICON; // the toolbar's inactive-tool grey
const ICON_COLOR_STRONG = PANEL_INK; // full ink — the locked state, a step up
const COMPACT_MAX_WIDTH = 500;
const DEFAULT_SHADOW_MODEL: ShadowModel = {
  dx: 0.75, dy: 0.875, blur: 1.125, spread: 0.125, color: { r: 0, g: 0, b: 0 }, opacity: 0.45,
};
// Design default endpoints: bare ends, round caps — how every path has always
// been drawn. Only a fallback for the transient frame before model.endpoints
// lands; the app resolves the real ones.
const DEFAULT_ENDPOINTS_MODEL: EndpointsModel = {
  startMarker: 'none', endMarker: 'none', startCap: 'round', endCap: 'round',
};
// Design default border: 6pt (0.375 cell) centered solid stroke.
const DEFAULT_BORDER_MODEL: BorderModel = {
  width: 0.375, position: 'center', dash: 0, color: { r: 58, g: 53, b: 50 },
};
// Opacity-bar defaults: fully opaque, hard edges — what every object renders
// as until it visits the bar, and what the bar's trash resets to.
const DEFAULT_OPACITY_MODEL: OpacityModel = { opacity: 1, edgeSoften: 0 };
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
// tint / crop / shadow / border / opacity (matching their type-option order);
// text cycles through font / align (two pages of the Text bar) and then shadow
// — the SAME Drop Shadow bar an image opens, cast by the glyphs rather than by
// the box; a vector selection has stroke, plus its subtype's second bar —
// svgFill on the closed shapes, endpoints on the open paths — plus opacity on
// the closed shapes.
// Kept in this order so a left swipe advances the same way the type-option
// row reads.
//
// `layout` is the odd one out: it rides on a MULTI-selection rather than on a
// type, so it joins whichever of the above the members happen to share (and
// stands alone when they share none), always last — the type's own controls
// are what the selection came for.
//
// SubmenuKey itself lives in logic/submenuHeight.ts, which needs it to say how
// tall each of these bars stands.

// One grid cell: a bare icon, weighted (flex) so every button shares the same
// column width whichever set is showing. The common actions these draw —
// rotate, flip, copy, lock, delete — are the universal ones, and their glyphs
// name them without help; `label` survives as the accessibility name. The cell
// keeps its 48pt height with the caption gone so the row stays put across a
// swipe to the type options (whose pills are the same height).
function GridButton({ label, icon, iconColor, onPress, compact }: {
  label: string;
  icon: string;
  iconColor?: string;
  onPress?: () => void;
  compact: boolean;
}) {
  const glyphSize = compact ? 24 : 28;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.gridButton}
    >
      <MaterialCommunityIcons name={icon as MCIName} size={glyphSize} color={iconColor ?? ICON_COLOR} />
    </Pressable>
  );
}

/** The option row's selection capsule, parked over whichever option opened the
 *  bar you're looking at. It takes that option's own box: the cells size to
 *  their words, so the capsule RESIZES as it travels rather than holding one
 *  width for the row.
 *
 *  It SLIDES only when moving between two options. Arriving from nowhere — a
 *  bar opening, or the type row swiping in — it fades up in place instead,
 *  because sliding in from a cell that was never selected would be a lie about
 *  where it came from. `shown` outlives `at` so the fade-out has something to
 *  animate against.
 *
 *  Width can't ride the native driver, and mixing drivers on one node lets the
 *  native side overwrite the JS side's props, so the whole capsule animates in
 *  JS. It is one small view moving for PANEL_ANIM_MS on a tap — not a
 *  per-frame cost — and the editor runs as the web bundle, where the native
 *  driver is a no-op anyway.
 *
 *  Its own component because the panel returns early when it isn't mounted, and
 *  these hooks must not sit behind that.  */
function OptionCapsule({ at, width }: {
  /** Left offset of the selected cell, or null when nothing is selected. */
  at: number | null;
  /** Width of the selected cell; 0 before the row has been measured. */
  width: number;
}) {
  const x = useRef(new Animated.Value(at ?? 0)).current;
  const w = useRef(new Animated.Value(width)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(at != null);
  const prevAt = useRef<number | null>(null);
  useEffect(() => {
    const from = prevAt.current;
    prevAt.current = at;
    if (at == null) {
      const anim = Animated.timing(fade, { toValue: 0, duration: PANEL_ANIM_MS, useNativeDriver: false });
      anim.start(({ finished }) => { if (finished) setShown(false); });
      return () => anim.stop();
    }
    setShown(true);
    if (from == null) {
      x.setValue(at);
      w.setValue(width);
      const anim = Animated.timing(fade, { toValue: 1, duration: PANEL_ANIM_MS, useNativeDriver: false });
      anim.start();
      return () => anim.stop();
    }
    fade.setValue(1);
    // Position and width travel together, or the capsule would arrive at the
    // new option still wearing the old one's width.
    const anim = Animated.parallel([
      Animated.timing(x, { toValue: at, duration: PANEL_ANIM_MS, useNativeDriver: false }),
      Animated.timing(w, { toValue: width, duration: PANEL_ANIM_MS, useNativeDriver: false }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [at, width, x, w, fade]);

  if (!shown || width <= 0) return null;
  return (
    // Untappable, so it can't swallow a press meant for the option it sits on.
    <Animated.View
      pointerEvents="none"
      style={[styles.optionCapsule, { width: w, opacity: fade, transform: [{ translateX: x }] }]}
    />
  );
}

/** One type-specific option, described rather than rendered — the row needs the
 *  set before it can lay the sliding capsule over the selected one. */
interface OptionSpec {
  key: string;
  /** Accessibility name (often longer than the visible word). */
  label: string;
  /** Visible word, when it differs from `label`. */
  caption?: string;
  /** The submenu this option opens. Options carrying one share the row's single
   *  sliding capsule; the rest never take it. */
  sub?: SubmenuKey;
  /** An independent on/off state (Repeat, Invert) — not a submenu, so it wears
   *  a capsule of its own rather than moving the shared one. */
  toggled?: boolean;
  /** Fill for a toggled option's capsule; defaults to selection blue. */
  tint?: string;
  /** Renders a small swatch of this color before the word — for an option
   *  whose state is a color rather than on/off (the frame's Fill). */
  swatchColor?: RGBLike;
  onPress?: () => void;
}

// One type-specific option: a word on a capsule, borrowed wholesale from the
// toolbar's line-mode pushdown (Freehand | Line | Arc) — same 13/600 word, same
// fully-round capsule, the same selection blue under the one that's on. No
// glyph: these options name a thing you're about to open or turn on, and the
// pushdown makes the case that the word alone carries that better than an icon.
//
// The SELECTED option's capsule isn't drawn here — the row owns one shared
// capsule that slides between cells (see `capsuleX`), so this draws only the
// word. A `toggled` option is the exception: its state is independent of which
// bar is open, so it carries a static capsule of its own.
//
// It keeps the GridButton's 48pt height, so a swipe between the two pages
// doesn't change the row's height — but NOT its equal-width cell. The words
// vary in length and the icons don't, so equal columns sized by the icon page
// meant the long words ("Opacity", "Endpoints") ellipsized on a phone while
// short ones sat in half-empty cells. Here each cell hugs its own word and the
// row's leftover width is shared out equally between them, so the row is always
// full and nothing truncates until the words genuinely outgrow the screen.
// On a wide window a cell stops at OPTION_CAPSULE_MAX_WIDTH — what keeps a
// three-option set from stretching into slabs, the row centring what it then
// doesn't fill. That cap comes OFF below COMPACT_MAX_WIDTH: a phone has no
// width to spare, and spending it all is the whole point there.
//
// `onMeasure` reports the width the cell actually took — the capsule that parks
// over it can't know a word's width without the layout having happened.
function OptionPill({ spec, selected, compact, onMeasure }: {
  spec: OptionSpec;
  /** True when this option's submenu is the open one — colors the word for the
   *  capsule sliding underneath it. */
  selected: boolean;
  /** Narrow screen: the width cap comes off, so the row is spent in full. */
  compact: boolean;
  /** Reports this cell's laid-out width, for the capsule that parks over it. */
  onMeasure: (key: string, width: number) => void;
}) {
  const lit = selected || !!spec.toggled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spec.label}
      accessibilityState={spec.sub || spec.toggled !== undefined ? { selected: lit } : undefined}
      onPress={spec.onPress}
      onLayout={(e) => onMeasure(spec.key, e.nativeEvent.layout.width)}
      style={[styles.optionCell, compact ? null : styles.optionCellCapped]}
    >
      <View
        style={[
          styles.optionPill,
          // Only a toggle paints its own capsule; a selected submenu option is
          // covered by the shared one sliding under it.
          spec.toggled ? { backgroundColor: spec.tint ?? STATE_ACTIVE } : null,
        ]}
      >
        {spec.swatchColor ? (
          <View style={styles.optionSwatch}>
            <ColorSwatchFill color={spec.swatchColor} />
          </View>
        ) : null}
        <Text
          style={[styles.optionLabel, lit && styles.optionLabelActive]}
          numberOfLines={1}
        >
          {spec.caption ?? spec.label}
        </Text>
      </View>
    </Pressable>
  );
}

export function ObjectPropertiesPanel({ model, safeBottom = 0, onOccludedHeight }: {
  model: ObjectPropertiesModel;
  /** Bottom safe-area inset (home indicator). Padded under the bottom-anchored
   *  effect bars so their controls clear it; 0 on non-notched / web. */
  safeBottom?: number;
  /** Reports how many px of the screen's bottom edge the panel claims — the
   *  base row when visible, plus the open submenu's layer — so the shell can
   *  scroll the selection clear of it. Fired with the TARGET height the
   *  moment visibility / submenu state changes (not after the slide), so a
   *  camera animation can run alongside the panel's own. 0 when hidden. */
  onOccludedHeight?: (px: number) => void;
}) {
  const { width } = useWindowDimensions();
  const compact = width < COMPACT_MAX_WIDTH;
  const [mounted, setMounted] = useState(model.visible);
  // Which page the single row shows — common actions, the selection's type
  // options, or (multi only) the selection-level ones. A horizontal swipe
  // cycles. Held as the page's NAME rather than an index so a selection change
  // that drops a page can't leave the row pointing at a different one; a page
  // the current selection doesn't have falls back below.
  const [page, setPage] = useState<PanelPage>('common');
  // The panel rests against the bottom edge. Where a device reports a bottom
  // inset (iOS home indicator / curved corners) the carousel dots sit *in* that
  // strip — nothing there is tappable anyway — and the panel reclaims their
  // row; with no inset (desktop web) the dots stay in flow. The hidden position
  // must clear the full height either way, to slide fully off.
  // Note the editor always runs as the web bundle, inside a WebView on native,
  // so this keys off the measured inset rather than Platform.OS.
  const dotsInSafeArea = safeBottom > 0;
  const panelBox = objectPanelLayout(safeBottom, dotsInSafeArea);
  const hiddenY = panelBox.height;
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

  // ── Row swap (the page carousel) ────────────────────────────────────
  // The visible row slides on a shared translateX. `dir` is the direction the
  // content travels: −1 = leftward (out the left edge, new row in from the
  // right) and so forward through the pages, +1 = rightward and back. A swap
  // throws the current row off one edge, steps the page, then brings the new
  // row in from the opposite edge; a drag lets the row follow the finger first,
  // then completes in the drag direction. The carousel wraps, so with two pages
  // it stays the straight toggle it was.
  const swapX = useRef(new Animated.Value(0)).current;
  const swapping = useRef(false);
  // Measured width of the button row, and of each type option's cell (keyed by
  // option key). The cells size themselves to their words, so the selection
  // capsule takes its width from the layout that actually happened and its
  // offset from optionCapsuleLefts. Empty until the first layout pass, when
  // there's nothing for the capsule to sit on and it isn't drawn.
  const [rowWidth, setRowWidth] = useState(0);
  const [optionWidths, setOptionWidths] = useState<Record<string, number>>({});
  const onOptionMeasure = useCallback((key: string, width: number) => {
    setOptionWidths((prev) => {
      // onLayout fires on every pass; only a real change is worth a re-render
      // (and sub-pixel jitter would otherwise loop).
      if (prev[key] !== undefined && Math.abs(prev[key] - width) < 0.5) return prev;
      return { ...prev, [key]: width };
    });
  }, []);
  // Latest runner + swipe-eligibility, so the once-created PanResponder always
  // uses the current window width and set availability. The page set and the
  // showing page ride refs for the same reason — both are worked out further
  // down this render, after the model's option flags.
  const pagesRef = useRef<PanelPage[]>(['common']);
  const pageRef = useRef<PanelPage>('common');
  const runSwapRef = useRef<(dir: -1 | 1) => void>(() => {});
  runSwapRef.current = (dir) => {
    if (swapping.current) return;
    swapping.current = true;
    Animated.timing(swapX, { toValue: dir * width, duration: PANEL_ANIM_MS, useNativeDriver: true }).start(({ finished }) => {
      if (!finished) { swapping.current = false; return; }
      setPage(stepPanelPage(pagesRef.current, pageRef.current, dir));
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

  // Multi-selection mode: the host applies every edit to ALL selected
  // objects at once — Lock included, member by member. The image set drops
  // Crop (it frames one image).
  const multi = model.mode === 'multi';
  // Layout (align the members against their combined box) — a type option that
  // asks nothing of the members but their boxes, so it rides on the selection
  // being multi rather than on what it is made of. A mixed selection gets it
  // (with Group / Merge) as its ONLY type options; a uniform one gets them
  // appended to that type's own set. Gated on the host supplying onAlign, like
  // the other optional actions.
  const showLayout = multi && !!model.onAlign;
  // Group / Merge ride alongside Layout for the same reason: they are things a
  // SELECTION is, not things its members are. A mixed multi-selection can be
  // bound into a group or flattened into one object without its members
  // sharing a kind, so they share Layout's page — words, not the common row's
  // icons (where a single selection's Facet-side group actions still live).
  //
  // Merge is the structural flatten, NOT the boolean union (`onUnion`, which
  // stays a common-row action): it makes several objects one object and asks
  // nothing of their geometry.
  const showGroup = multi && !!model.onGroup;
  // A selection that IS a group has one option its members' kind can't give
  // it: the way back out. Ungroup is a TYPE option, alongside whatever the
  // members share — the same row a frame's Ungroup sits in — and it is the
  // whole type row for a group of mixed kinds. Group itself drops off the
  // selection page while it shows (the host stops supplying onGroup), so the
  // two never contradict each other.
  const showUngroup = multi && !!model.onUngroup;
  const showMerge = multi && !!model.onMerge;

  // The two optional carousel pages. `type` is what the selection's KIND
  // offers (and a multi-selection's members must share a kind to have one);
  // `multi` is what the SELECTION offers, whatever it is made of.
  const hasTypeOptions = !!model.showImageEdit || !!model.showEdit || !!model.showTextStyle || !!model.showFrameOptions || !!model.showInvert || !!model.showSvgOptions || !!model.showPaintOptions || !!model.showRigOptions || showUngroup;
  const hasMultiOptions = showLayout || showGroup || showMerge;
  const pages = objectPanelPages({ type: hasTypeOptions, multi: hasMultiOptions });
  // Signature of the current selection's option pages. It changes when the
  // panel first appears for a selection or the selected object's type changes
  // (image → frame → text …), and empties when the panel hides. The vector
  // subtype is part of it so switching between two vector objects with
  // different menus (a line → a rectangle) re-lands on the type row.
  const typeSig = model.visible
    ? `${multi ? 'm' : ''}${showLayout ? 'L' : ''}${showGroup ? 'G' : ''}${showUngroup ? 'g' : ''}${showMerge ? 'M' : ''}${model.showImageEdit ? 'i' : ''}${model.showFrameOptions ? 'f' : ''}${model.showTextStyle ? 's' : ''}${model.showEdit ? 'e' : ''}${model.showInvert ? 'v' : ''}${model.showPaintOptions ? 'p' : ''}${model.showSvgOptions ? `g${model.svgSubtype ?? 'stroke'}${model.onSvgEdit ? 'E' : ''}` : ''}`
    : '';
  const prevTypeSig = useRef('');
  // The page the panel was last showing for a real selection — what the next
  // one lands on when it has that page too. Recorded only while VISIBLE: the
  // row falls back to 'common' as the panel hides, and letting that overwrite
  // the memory would make every selection after a deselect start over.
  const lastPageRef = useRef<PanelPage>('common');
  const landingPage = landingPanelPage(pages, lastPageRef.current);
  useEffect(() => {
    if (typeSig === prevTypeSig.current) return;
    prevTypeSig.current = typeSig;
    // On each new selection, stay on the page the last one was on when this
    // one has it; otherwise land on the options it brought with it — its
    // kind's if it has any, else the selection-level ones; fall back to the
    // common actions when it has neither (also keeps a stale swap from
    // leaving an empty row).
    setPage(landingPage);
  }, [typeSig, landingPage]);
  // After the effect above, so the landing decision reads the PREVIOUS
  // selection's page rather than the one it just set.
  useEffect(() => {
    if (model.visible) lastPageRef.current = page;
  }, [page, model.visible]);

  // A new option set relays out from scratch, so drop the old widths rather
  // than let a key both sets share (Shadow, Border) size the capsule from the
  // previous set's layout for a frame.
  useEffect(() => { setOptionWidths({}); }, [typeSig]);

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
  // The Opacity bar rides the same draft pattern as Crop — the draft owns
  // both tracked params (there's no external color to split off).
  const [opacityDraft, setOpacityDraft] = useState<OpacityModel | null>(null);
  const prevOpacityOpen = useRef(false);
  // The Stroke bar rides the same draft pattern as Border — it IS the Border
  // bar, pointed at a vector object's own stroke.
  const [strokeDraft, setStrokeDraft] = useState<BorderModel | null>(null);
  const prevStrokeOpen = useRef(false);
  const [tintDraft, setTintDraft] = useState<TintModel | null>(null);
  const prevTintOpen = useRef(false);
  // The Fill bar rides the same draft pattern as Tint — it IS the Tint bar,
  // pointed at a closed shape's interior.
  const [svgFillDraft, setSvgFillDraft] = useState<TintModel | null>(null);
  const prevSvgFillOpen = useRef(false);
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
  // The open submenu stacks ABOVE the panel rather than over it: its bottom
  // edge abuts the panel's top, so the bar and the options row that summoned it
  // are both on screen and the lit option says which bar you're looking at. A
  // left/right swipe cycles forward/back through the available submenus, and a
  // downward swipe dismisses. The submenus are separate bars but only one shows
  // at a time, so this drives a single layer: `layerY` for the vertical
  // open/dismiss, `navX` for the horizontal carousel slide.
  //
  // The bar needs no bottom inset of its own — the panel beneath it owns the
  // home-indicator strip. Its height doubles as its slide distance: pushed down
  // by exactly that, it sits wholly behind the panel (which draws over it) and
  // below the screen edge, so it reveals by rising out from under the panel.
  const svgFillable = !!model.showSvgOptions && svgHasFill(model.svgSubtype ?? 'stroke');
  const svgEndable = !!model.showSvgOptions && svgHasEndpoints(model.svgSubtype ?? 'stroke');
  const svgOpacityable = !!model.showSvgOptions && svgHasOpacity(model.svgSubtype ?? 'stroke');
  const typeSubmenuOrder: SubmenuKey[] =
    model.showImageEdit ? (multi
      ? ['tint', 'shadow', 'border', 'opacity']
      : ['tint', 'crop', 'shadow', 'border', 'opacity'])
    : model.showFrameOptions ? ['shadow', 'border']
    : model.showTextStyle ? ['font', 'align', 'shadow']
    : model.showPaintOptions ? ['opacity']
    // A rig's parts, in the order its options row lists them. Checked
    // before showSvgOptions: a rig's figure IS an svg object, and the
    // vector bars have nothing to act on for a baked silhouette.
    : model.showRigOptions ? ['rigRoot', 'rigHands', 'rigFeet', 'rigSpine']
    : model.showSvgOptions
      ? [
          'stroke',
          ...(svgFillable ? (['svgFill'] as const) : []),
          ...(svgEndable ? (['endpoints'] as const) : []),
          ...(svgOpacityable ? (['opacity'] as const) : []),
        ]
    : [];
  // Layout joins the tail of whatever the selection's type offers, so a
  // mixed multi-selection lands on a one-page carousel and a uniform one
  // swipes from its type's bars into Layout.
  const submenuOrder: SubmenuKey[] = showLayout ? [...typeSubmenuOrder, 'layout'] : typeSubmenuOrder;

  // How tall the bar layer stands: the tallest bar THIS selection can reach,
  // and no taller. Every bar of a type shares it, so swiping the carousel never
  // moves the bar's top edge — but a text selection (two three-row bars) no
  // longer reserves room for the five-row gradient Tint only an image can open.
  //
  // Rows are counted from the state the bars will actually render from, drafts
  // included, so this tracks a live edit: switching a tint to Linear genuinely
  // adds an angle row, and the layer grows by one row to hold it.
  const barHeight = typeMenuHeight(submenuOrder, {
    tintType: (tintDraft ?? model.tint ?? DEFAULT_TINT_MODEL).type,
    svgFillType: (svgFillDraft ?? model.svgFill ?? DEFAULT_TINT_MODEL).type,
    cropMode: (cropDraft ?? model.framing ?? DEFAULT_FRAMING_MODEL).mode,
    cropHasResolution: formatPixelSize(model.imagePixelSize) !== null,
    // The image / frame border offers every row; a vector's stroke drops the
    // ones its subtype has no answer for.
    borderRows: { radius: true, position: true },
    strokeRows: svgStrokeRows(model.svgSubtype ?? 'stroke'),
    // The Layout bar grows an Arrange row exactly when the bar will render it.
    layoutHasGrid: !!model.onGrid,
  });
  const activeSub: SubmenuKey | null =
    model.layoutOpen ? 'layout'
    : model.tintOpen ? 'tint'
    : model.cropOpen ? 'crop'
    : model.shadowOpen ? 'shadow'
    : model.borderOpen ? 'border'
    : model.opacityOpen ? 'opacity'
    : model.strokeOpen ? 'stroke'
    : model.svgFillOpen ? 'svgFill'
    : model.endpointsOpen ? 'endpoints'
    : model.rigPartOpen === 'rig' ? 'rigRoot'
    : model.rigPartOpen === 'hands' ? 'rigHands'
    : model.rigPartOpen === 'feet' ? 'rigFeet'
    : model.rigPartOpen === 'spine' ? 'rigSpine'
    : model.textStyleOpen ? textPage
    : null;
  const submenuOpen = activeSub != null;

  // Bottom-edge occlusion report — see the prop doc. The submenu layer sits
  // ON TOP of the base panel (bottom: panelBox.height), so the two heights
  // add while a bar is open.
  const occludedPx = model.visible ? panelBox.height + (submenuOpen ? barHeight : 0) : 0;
  useEffect(() => {
    onOccludedHeight?.(occludedPx);
  }, [onOccludedHeight, occludedPx]);

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

  /** True while `key`'s bar is the one showing — lights that option's pill, so
   *  the options row doubles as the carousel's position indicator now that the
   *  bar no longer covers it. */
  const subOpen = (key: SubmenuKey) => activeSub === key;

  /** The bar a vector option opens. svgEdit's action names match the submenu
   *  keys except where the panel has to disambiguate — a shape's `fill` is the
   *  svgFill bar, not an image's Tint. Named because both the press handler and
   *  the lit state need it, and they must agree. */
  const svgActionSubmenu = (action: string): SubmenuKey =>
    action === 'fill' ? 'svgFill'
    : action === 'endpoints' ? 'endpoints'
    : action === 'opacity' ? 'opacity'
    : 'stroke';

  const openSubmenu = (key: SubmenuKey) => {
    fontSheetOpenRef.current = false;
    // The bar and the row that summoned it are on screen together now, so the
    // row has to be the page holding that option for its lit capsule to be
    // visible — the Layout bar's option lives on the multi page, every other
    // bar's on the type page. A swipe can still take you elsewhere afterwards
    // (including onto a page where nothing is lit, which is fine: the bar says
    // what it is).
    setPage(key === 'layout' ? 'multi' : 'type');
    if (key === 'tint') model.onTintOpenChange?.(true);
    else if (key === 'crop') model.onCropOpenChange?.(true);
    else if (key === 'shadow') model.onShadowOpenChange?.(true);
    else if (key === 'border') model.onBorderOpenChange?.(true);
    else if (key === 'opacity') model.onOpacityOpenChange?.(true);
    else if (key === 'stroke') model.onStrokeOpenChange?.(true);
    else if (key === 'svgFill') model.onSvgFillOpenChange?.(true);
    else if (key === 'endpoints') model.onEndpointsOpenChange?.(true);
    else if (key === 'layout') model.onLayoutOpenChange?.(true);
    else if (key === 'rigRoot') model.onRigPartOpenChange?.('rig');
    else if (key === 'rigHands') model.onRigPartOpenChange?.('hands');
    else if (key === 'rigFeet') model.onRigPartOpenChange?.('feet');
    else if (key === 'rigSpine') model.onRigPartOpenChange?.('spine');
    else if (key === 'font' || key === 'align') {
      // Both text pages ride the single textStyleOpen flag; the page state
      // picks which one shows (drives the carousel between them).
      setTextPage(key);
      model.onTextStyleOpenChange?.(true);
    }
  };
  const dismissSubmenu = () => {
    fontSheetOpenRef.current = false;
    model.onTintOpenChange?.(false);
    model.onShadowOpenChange?.(false);
    model.onBorderOpenChange?.(false);
    model.onCropOpenChange?.(false);
    model.onOpacityOpenChange?.(false);
    model.onStrokeOpenChange?.(false);
    model.onSvgFillOpenChange?.(false);
    model.onEndpointsOpenChange?.(false);
    model.onLayoutOpenChange?.(false);
    model.onTextStyleOpenChange?.(false);
    model.onRigPartOpenChange?.(null);
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
      layerY.setValue(barHeight);
      const anim = Animated.timing(layerY, { toValue: 0, duration: PANEL_ANIM_MS, useNativeDriver: true });
      anim.start();
      return () => anim.stop();
    }
    if (!submenuOpen && prevSubmenuOpen.current) {
      prevSubmenuOpen.current = false;
      const anim = Animated.timing(layerY, { toValue: barHeight, duration: PANEL_ANIM_MS, useNativeDriver: true });
      anim.start(({ finished }) => { if (finished) setSubmenuMounted(false); });
      return () => anim.stop();
    }
  }, [submenuOpen, layerY, navX, barHeight]);

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

  // Every submenu folds away with the panel. This matters more than it used to:
  // the bar is anchored to the panel's top edge rather than the screen's bottom,
  // so a panel that hid with one still open would drop the bar into the space it
  // vacated and leave it sitting on the canvas. The per-type fold-aways below
  // only cover the bars whose selection stopped supporting them.
  useEffect(() => {
    if (!model.visible) dismissRef.current();
  }, [model.visible]);

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
  // while a frame is selected. Shadow and Border part company here: text offers
  // Shadow but not Border, so a text selection must not drag the Shadow bar
  // down with a rule written for the pair.
  useEffect(() => {
    const canShadow = model.showImageEdit || model.showFrameOptions || model.showTextStyle;
    const canBorder = model.showImageEdit || model.showFrameOptions;
    if (!model.visible || !canShadow) model.onShadowOpenChange?.(false);
    if (!model.visible || !canBorder) model.onBorderOpenChange?.(false);
    if (!model.visible || !model.showImageEdit) {
      model.onCropOpenChange?.(false);
      model.onTintOpenChange?.(false);
    }
    // model.on*OpenChange are stable setters; listing the whole model would
    // re-run this every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.visible, model.showImageEdit, model.showFrameOptions, model.showTextStyle]);
  // The Opacity bar is shared by images, paint islands, and the closed
  // vector shapes, so it folds away only when the selection is none of
  // those (or the panel hides).
  useEffect(() => {
    const canOpacity = model.showImageEdit || model.showPaintOptions || svgOpacityable;
    if ((!model.visible || !canOpacity) && model.opacityOpen) {
      model.onOpacityOpenChange?.(false);
    }
    // model.on* are stable setters; listing the whole model would re-run this
    // every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.visible, model.showImageEdit, model.showPaintOptions, svgOpacityable, model.opacityOpen]);

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
    if (model.opacityOpen && !prevOpacityOpen.current) {
      // Seeded from the app, which reports the object's CURRENT opacity /
      // soften (defaults resolved), so the sliders open where the object is.
      setOpacityDraft(model.objectOpacity ?? DEFAULT_OPACITY_MODEL);
    }
    prevOpacityOpen.current = !!model.opacityOpen;
  }, [model.opacityOpen, model.objectOpacity]);
  useEffect(() => {
    if (model.strokeOpen && !prevStrokeOpen.current) {
      // Seeded from the app, which reports the object's CURRENT stroke —
      // including the composition-wide default it is drawn at when it has
      // never been given one, so the Width slider opens where the line
      // actually is rather than at zero.
      setStrokeDraft(model.stroke ?? DEFAULT_BORDER_MODEL);
    }
    prevStrokeOpen.current = !!model.strokeOpen;
  }, [model.strokeOpen, model.stroke]);
  useEffect(() => {
    if (model.textStyleOpen && !prevTextOpen.current) {
      setTextDraft(model.textStyle ?? DEFAULT_TEXT_STYLE_MODEL);
    }
    prevTextOpen.current = !!model.textStyleOpen;
  }, [model.textStyleOpen, model.textStyle]);
  useEffect(() => {
    if (model.svgFillOpen && !prevSvgFillOpen.current) {
      // Seeded from the app, which reports the shape's CURRENT fill — or a
      // default one when it has never been filled, so the bar opens on
      // something coherent rather than on an empty gradient.
      setSvgFillDraft(model.svgFill ?? DEFAULT_TINT_MODEL);
    }
    prevSvgFillOpen.current = !!model.svgFillOpen;
  }, [model.svgFillOpen, model.svgFill]);
  // Fold the Stroke bar away the moment the selection is no longer a vector
  // object (or the panel hides), so it never lingers over the next object. The
  // Fill and Endpoints bars go with it, and also whenever the new vector
  // selection is a subtype that doesn't offer that one — a shape with no
  // interior to fill, or a closed one with no loose end to decorate.
  useEffect(() => {
    if ((!model.visible || !model.showSvgOptions) && model.strokeOpen) {
      model.onStrokeOpenChange?.(false);
    }
    if ((!model.visible || !svgFillable) && model.svgFillOpen) {
      model.onSvgFillOpenChange?.(false);
    }
    if ((!model.visible || !svgEndable) && model.endpointsOpen) {
      model.onEndpointsOpenChange?.(false);
    }
    // model.on* are stable setters; listing the whole model would re-run this
    // every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.visible, model.showSvgOptions, model.strokeOpen, svgFillable, model.svgFillOpen, svgEndable, model.endpointsOpen]);
  // Fold the Layout bar away as soon as the selection stops being a multi one
  // (a tap that drops it to a single object, or clears it), so it never
  // lingers over an object it has nothing to say about.
  useEffect(() => {
    if ((!model.visible || !showLayout) && model.layoutOpen) model.onLayoutOpenChange?.(false);
    // model.on* are stable setters; listing the whole model would re-run this
    // every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.visible, showLayout, model.layoutOpen]);
  useEffect(() => {
    if (model.tintOpen && !prevTintOpen.current) {
      setTintDraft(model.tint ?? DEFAULT_TINT_MODEL);
    }
    prevTintOpen.current = !!model.tintOpen;
  }, [model.tintOpen, model.tint]);
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
  const toggleTint = () => model.onTintOpenChange?.(!model.tintOpen);
  const toggleOpacity = () => model.onOpacityOpenChange?.(!model.opacityOpen);

  const runImageAction = (action: ImageEditAction) => {
    if (action === 'tint') { toggleTint(); return; }
    if (action === 'shadow') { toggleShadow(); return; }
    if (action === 'border') { toggleBorder(); return; }
    if (action === 'crop') { toggleCrop(); return; }
    if (action === 'opacity') { toggleOpacity(); return; }
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

  // Stroke controls → live preview / commit; same pattern as Border. The trash
  // clears the object's stroke overrides, returning it to the composition-wide
  // default rather than deleting anything.
  const applyStroke = (b: BorderModel, committed: boolean) => {
    setStrokeDraft(b);
    model.onStroke?.(b, committed);
  };
  const removeStroke = () => {
    model.onStroke?.(null, true);
    model.onStrokeOpenChange?.(false);
  };

  // Crop controls → live preview / commit; the draft owns the tracked params
  // (there's no external color).
  const applyFraming = (f: FramingModel, committed: boolean) => {
    setCropDraft(f);
    model.onFraming?.(f, committed);
  };

  // Opacity controls → live preview / commit; the draft owns both params
  // (no external color). The trash resets to the defaults as one undo step
  // and closes the bar.
  const applyOpacity = (o: OpacityModel, committed: boolean) => {
    setOpacityDraft(o);
    model.onObjectOpacity?.(o, committed);
  };
  const removeOpacity = () => {
    applyOpacity(DEFAULT_OPACITY_MODEL, true);
    model.onOpacityOpenChange?.(false);
  };

  // Text style → live preview / commit; the draft owns the tracked params, so
  // the sliders keep tracking (color comes from the model).
  const applyTextStyle = (s: TextStyleModel, committed: boolean) => {
    setTextDraft(s);
    model.onTextStyle?.(s, committed);
  };

  // Tint → live preview / commit; the draft owns the tracked params (type,
  // stop positions, angle, opacity, blend, selection) while colors (solid +
  // per-stop) come from the model, changed externally via the full-screen
  // picker — same split as the effect bars' colors.
  const applyTint = (t: TintModel, committed: boolean) => {
    setTintDraft(t);
    model.onTint?.(t, committed);
  };
  // Header trash: drop the whole tint layer (one undo step) and close the bar.
  const removeTint = () => {
    model.onTint?.(null, true);
    model.onTintOpenChange?.(false);
  };
  // + button: commit the new stop (one undo step) then open the picker on it so
  // a fresh stop is never a dead end (design 6a).
  const addTintStop = () => {
    const next = addStop(tintDraft ?? model.tint ?? DEFAULT_TINT_MODEL);
    applyTint(next, true);
    model.onPickTintColor?.();
  };

  // Shape fill → the same three handlers as Tint, against the shape's own fill.
  const applySvgFill = (f: TintModel, committed: boolean) => {
    setSvgFillDraft(f);
    model.onSvgFill?.(f, committed);
  };
  const removeSvgFill = () => {
    model.onSvgFill?.(null, true);
    model.onSvgFillOpenChange?.(false);
  };
  const addSvgFillStop = () => {
    const next = addStop(svgFillDraft ?? model.svgFill ?? DEFAULT_TINT_MODEL);
    applySvgFill(next, true);
    model.onPickSvgFillColor?.();
  };

  // Endpoints keeps no draft: every control is a segmented pick, so there is no
  // drag for a live preview to smooth over and the model is always the truth.
  const removeEndpoints = () => {
    model.onEndpoints?.(null);
    model.onEndpointsOpenChange?.(false);
  };

  if (!mounted) return null;

  // Common actions (rotate / flip / copy / lock / delete, plus the optional
  // group actions). Built as an array so it and the type-options set share a
  // column count and the row keeps a stable cell width across a swap.
  const row1: React.ReactNode[] = [
    <GridButton key="rotate" label="Rotate" icon="rotate-right" onPress={model.onRotate} compact={compact} />,
    <GridButton key="flipH" label="Mirror H" icon="arrow-left-right" onPress={model.onMirrorH} compact={compact} />,
    <GridButton key="flipV" label="Mirror V" icon="arrow-up-down" onPress={model.onMirrorV} compact={compact} />,
    <GridButton key="copy" label="Duplicate" icon="content-copy" onPress={model.onDuplicate} compact={compact} />,
    // Lock acts per object, so a multi-selection gets it too: it locks each
    // member individually. `locked` then means EVERY member is locked (the
    // host's own reading, so the button's state and what a press does can't
    // disagree) — a partly-locked selection reads unlocked and one press
    // finishes the job rather than inverting into a differently-mixed one.
    <GridButton
      key="lock"
      label={model.locked ? 'Locked' : 'Lock'}
      icon={model.locked ? 'lock' : 'lock-open-outline'}
      iconColor={model.locked ? ICON_COLOR_STRONG : ICON_COLOR}
      onPress={model.onToggleLock}
      compact={compact}
    />,
    <GridButton key="delete" label="Delete" icon="delete-outline" onPress={model.onDelete} compact={compact} />,
  ];
  // A multi-selection's Group / Merge live on the selection's own page (words,
  // beside Layout), not on this icon row — see showGroup / showMerge.
  if (model.onGroup && !multi) row1.push(<GridButton key="group" label="Group" icon="group" onPress={model.onGroup} compact={compact} />);
  // Frames surface Ungroup in their own type-options row (not the common row),
  // so skip it here when the frame options are showing.
  if (model.onUngroup && !model.showFrameOptions && !multi) row1.push(<GridButton key="ungroup" label="Ungroup" icon="ungroup" onPress={model.onUngroup} compact={compact} />);
  if (model.onJoin) row1.push(<GridButton key="join" label="Join" icon="vector-combine" onPress={model.onJoin} compact={compact} />);
  if (model.onUnion && !multi) row1.push(<GridButton key="union" label="Union" icon="vector-union" onPress={model.onUnion} compact={compact} />);

  // The type page's options (images: the image-edit set; text: Edit + Type),
  // null when the selection's kind offers none — a mixed multi-selection, say,
  // which has no shared kind to ask. Described rather than rendered, because
  // the row needs to know WHICH option is selected to park the sliding capsule
  // over it; the elements come out of these at render time.
  let typeSpecs: OptionSpec[] | null = null;
  if (model.showImageEdit) {
    typeSpecs = IMAGE_EDIT_OPTIONS
      // Crop is single-target only — a mixed selection has no one frame to fit.
      .filter((opt) => !multi || opt.action !== 'crop')
      // Every image action names a bar, and shares its key.
      .map((opt) => ({
        key: opt.action,
        label: opt.label,
        sub: opt.action as SubmenuKey,
        onPress: () => runImageAction(opt.action),
      }));
  } else if (model.showFrameOptions) {
    // Frame options: Background (circular color swatch) · Shadow · Border ·
    // Ungroup. Shadow / Border reuse the image effect bars (the frame submenu
    // carousel). Background opens the shared full-screen color picker.
    typeSpecs = [
      {
        key: 'background',
        label: 'Background color',
        caption: 'Fill',
        swatchColor: model.frameBackgroundColor,
        onPress: model.onPickFrameBackground,
      },
      { key: 'shadow', label: 'Shadow', sub: 'shadow', onPress: toggleShadow },
      { key: 'border', label: 'Border', sub: 'border', onPress: toggleBorder },
    ];
    if (model.onUngroup) {
      typeSpecs.push({ key: 'ungroup', label: 'Ungroup', onPress: model.onUngroup });
    }
  } else if (model.showRigOptions) {
    // Poseable rig: the PARTS a slider can shape — the whole figure first,
    // then its hands, feet and spine. No Stroke / Fill / Opacity: the
    // figure's silhouette is baked from its pose, so none of the three has
    // anything to act on. The IK switch is not an option of its own; it
    // lives on the RIG bar, with the rest of the posing controls.
    typeSpecs = RIG_PART_OPTIONS.map((opt) => ({
      key: opt.part,
      label: opt.label,
      sub: opt.sub,
      onPress: () => openSubmenu(opt.sub),
    }));
  } else if (model.showSvgOptions) {
    // Vector selection: the subtype's own option menu (svgEdit.ts). Every
    // subtype offers Stroke — a path IS its stroke; the closed shapes add Fill.
    typeSpecs = svgEditOptions(model.svgSubtype ?? 'stroke').map((opt) => ({
      key: opt.action,
      label: opt.label,
      sub: svgActionSubmenu(opt.action),
      onPress: () => openSubmenu(svgActionSubmenu(opt.action)),
    }));
    if (model.onToggleRepeat) {
      // Pattern-mode toggle (tile pattern objects): repeat the tile across
      // the bounding box instead of scaling it. A toggle rather than a bar, so
      // it wears its own capsule instead of taking the sliding one — and it
      // keeps Facet's PATTERN_ACTIVE, which is what separates "pattern mode is
      // on" from "this is the bar you're looking at".
      typeSpecs.unshift({
        key: 'repeat',
        label: 'Repeat',
        toggled: model.repeat,
        tint: PATTERN_ACTIVE,
        onPress: model.onToggleRepeat,
      });
    }
    if (model.onSvgEdit) {
      // Source-editor Edit (e.g. reopen a pattern object's tile editor),
      // ahead of the subtype options.
      typeSpecs.unshift({ key: 'svgEdit', label: 'Edit', onPress: model.onSvgEdit });
    }
  } else if (model.showInvert) {
    // Word sticker (magnetic poetry): the single type-specific option is
    // Invert (dark card ⇄ light card). Content + typography are fixed, so no
    // Edit / Type / Align. It's a toggle, so the lit pill now says what the
    // black/white swatch used to.
    typeSpecs = [{ key: 'invert', label: 'Invert', toggled: model.inverted, onPress: model.onInvert }];
  } else if (model.showPaintOptions) {
    // Paint island: raster brushwork has no Stroke/Fill to edit — its one
    // option is Opacity, opening the same bar (opacity + soften) an image's
    // Opacity action does.
    typeSpecs = PAINT_EDIT_OPTIONS.map((opt) => ({
      key: opt.action,
      label: opt.label,
      sub: opt.action as SubmenuKey,
      onPress: toggleOpacity,
    }));
  } else if (model.showEdit || model.showTextStyle) {
    // Edit (content) · Type (opens the Text bar on the Font page) · Align (opens
    // it straight on the Align page) · Shadow. Type / Align both slide the same
    // two-page Text bar up; they differ only in which page it lands on. Shadow
    // is the image's own bar, unchanged — one Drop Shadow control for every
    // object that can cast one.
    typeSpecs = [];
    if (model.showEdit) typeSpecs.push({ key: 'edit', label: 'Edit', onPress: model.onEdit });
    if (model.showTextStyle) typeSpecs.push({ key: 'type', label: 'Type', sub: 'font', onPress: () => openSubmenu('font') });
    if (model.showTextStyle) typeSpecs.push({ key: 'align', label: 'Align', sub: 'align', onPress: () => openSubmenu('align') });
    if (model.showTextStyle) typeSpecs.push({ key: 'shadow', label: 'Shadow', sub: 'shadow', onPress: toggleShadow });
  }
  if (showUngroup) {
    // A GROUP is a type of selection, and Ungroup is the option that type has:
    // it closes the row after whatever the members share, and IS the row when
    // they share nothing. One press, no bar — like the frame Ungroup it mirrors.
    typeSpecs = [...(typeSpecs ?? []), { key: 'ungroup', label: 'Ungroup', onPress: model.onUngroup }];
  }
  // The selection-level options (Layout · Group · Merge) get a page of their
  // own, after the type page — they belong to the selection rather than to
  // what it is made of, and a mixed multi-selection has this page and no type
  // page at all. "Layout" keeps it clear of the text Align option (which is
  // about a paragraph's own lines, not where objects sit) now that neither
  // carries a glyph. Only Layout opens a bar; Group and Merge are one press
  // each, so they never take the sliding capsule — they just fire and leave a
  // selection that is one thing instead of several.
  const multiOptions = multiSelectionOptions({ align: showLayout, group: showGroup, merge: showMerge });
  const multiSpecs: OptionSpec[] | null = multiOptions.length > 0
    ? multiOptions.map((opt): OptionSpec =>
        opt.action === 'layout'
          ? { key: 'layout', label: opt.label, sub: 'layout', onPress: () => openSubmenu('layout') }
          : { key: opt.action, label: opt.label, onPress: opt.action === 'group' ? model.onGroup : model.onMerge })
    : null;

  // Only one page shows at a time; a horizontal swipe cycles through them (the
  // dots below track which is showing). The icon row's columns stay fixed at
  // the widest page's count so the icons keep one size across selections, and
  // empty cells split either side to centre them; an option row sizes its own
  // cells to its words instead (OptionPill) and so needs no pad.
  //
  // `pages` is worked out from the model's flags up top; the specs below are
  // what those flags produce, so a page in the list always has a row to show.
  const shownPage: PanelPage = pages.includes(page) ? page : landingPage;
  const canSwap = pages.length > 1;
  canSwapRef.current = canSwap;
  pagesRef.current = pages;
  pageRef.current = shownPage;
  // The option specs for the page showing (null on the common-actions page).
  const activeSpecs: OptionSpec[] | null =
    shownPage === 'type' ? typeSpecs : shownPage === 'multi' ? multiSpecs : null;
  const columns = Math.max(row1.length, typeSpecs?.length ?? 0, multiSpecs?.length ?? 0);

  // ── The sliding selection capsule ───────────────────────────────────
  // Parked over whichever option opened the bar you're looking at, taking that
  // cell's own width — the cells size to their words, so it resizes as well as
  // travels. Widths are measured, offsets reproduced from the row's geometry
  // (optionCapsuleLefts); both need the first layout pass, and until every cell
  // has reported there is nothing to sit on and the capsule isn't drawn.
  const selectedOption = activeSpecs
    ? activeSpecs.findIndex((s) => s.sub !== undefined && subOpen(s.sub))
    : -1;
  const cellWidths = activeSpecs ? activeSpecs.map((s) => optionWidths[s.key] ?? 0) : [];
  const measured = cellWidths.length > 0 && cellWidths.every((w) => w > 0);
  const lefts = measured ? optionCapsuleLefts(rowWidth, cellWidths) : [];
  // Only a measured, selected option row gets a capsule.
  const litCell = selectedOption >= 0 && lefts.length > 0;
  const capsuleAt = litCell ? lefts[selectedOption] : null;
  const capsuleWidth = litCell ? cellWidths[selectedOption] : 0;

  const activeButtons: React.ReactNode[] = activeSpecs
    ? activeSpecs.map((spec, i) => (
        <OptionPill key={spec.key} spec={spec} selected={i === selectedOption} compact={compact} onMeasure={onOptionMeasure} />
      ))
    : row1;
  // An option row fills the width itself; only the icon row is centred by pads.
  const sidePad = activeSpecs ? 0 : optionRowSidePad(columns, activeButtons.length);

  // Params tracked by the sliders/pad come from the local draft; color comes
  // from the model (it's changed externally, via the full-screen picker).
  const shadowForBar: ShadowModel = shadowDraft
    ? { ...shadowDraft, color: model.shadow?.color ?? shadowDraft.color }
    : (model.shadow ?? DEFAULT_SHADOW_MODEL);
  const borderForBar: BorderModel = borderDraft
    ? { ...borderDraft, color: model.border?.color ?? borderDraft.color }
    : (model.border ?? DEFAULT_BORDER_MODEL);
  const framingForBar: FramingModel = cropDraft ?? model.framing ?? DEFAULT_FRAMING_MODEL;
  const opacityForBar: OpacityModel = opacityDraft ?? model.objectOpacity ?? DEFAULT_OPACITY_MODEL;
  const strokeForBar: BorderModel = strokeDraft
    ? { ...strokeDraft, color: model.stroke?.color ?? strokeDraft.color }
    : (model.stroke ?? DEFAULT_BORDER_MODEL);
  // Tracked type params come from the draft; color comes from the model (the
  // full-screen picker changes it externally, like the effect bars' colors).
  const textForBar: TextStyleModel = textDraft
    ? { ...textDraft, color: model.textStyle?.color ?? textDraft.color }
    : (model.textStyle ?? DEFAULT_TEXT_STYLE_MODEL);
  // Tracked tint params from the draft; the solid + per-stop colors come from
  // the model (the full-screen picker edits them externally). Stops are matched
  // by index — add / delete commit immediately, so the counts stay aligned.
  const tintForBar: TintModel = tintDraft
    ? {
        ...tintDraft,
        solid: model.tint?.solid ?? tintDraft.solid,
        stops: tintDraft.stops.map((s, i) => ({ ...s, color: model.tint?.stops[i]?.color ?? s.color })),
      }
    : (model.tint ?? DEFAULT_TINT_MODEL);
  // Same draft/model split for the shape fill.
  const svgFillForBar: TintModel = svgFillDraft
    ? {
        ...svgFillDraft,
        solid: model.svgFill?.solid ?? svgFillDraft.solid,
        stops: svgFillDraft.stops.map((s, i) => ({ ...s, color: model.svgFill?.stops[i]?.color ?? s.color })),
      }
    : (model.svgFill ?? DEFAULT_TINT_MODEL);

  // The currently-shown submenu bar (retained through the dismiss slide). onBack
  // (the down chevron) dismisses the whole submenu layer.
  let activeBarEl: React.ReactNode = null;
  if (displaySub === 'tint') {
    activeBarEl = (
      <TintBar
        tint={tintForBar}
        onChange={(t) => applyTint(t, false)}
        onCommit={(t) => applyTint(t, true)}
        onBack={dismissSubmenu}
        onRemove={removeTint}
        onPickColor={() => model.onPickTintColor?.()}
        onAddStop={addTintStop}
        onSheetOpenChange={(open) => { fontSheetOpenRef.current = open; }}
      />
    );
  } else if (displaySub === 'svgFill') {
    // The Tint bar retitled, pointed at the closed shape's own interior.
    activeBarEl = (
      <TintBar
        title="FILL"
        removeLabel="Remove fill"
        tint={svgFillForBar}
        onChange={(t) => applySvgFill(t, false)}
        onCommit={(t) => applySvgFill(t, true)}
        onBack={dismissSubmenu}
        onRemove={removeSvgFill}
        onPickColor={() => model.onPickSvgFillColor?.()}
        onAddStop={addSvgFillStop}
        onSheetOpenChange={(open) => { fontSheetOpenRef.current = open; }}
      />
    );
  } else if (displaySub === 'endpoints') {
    activeBarEl = (
      <EndpointsBar
        endpoints={model.endpoints ?? DEFAULT_ENDPOINTS_MODEL}
        onChange={(e) => model.onEndpoints?.(e)}
        onBack={dismissSubmenu}
        onRemove={removeEndpoints}
      />
    );
  } else if (displaySub === 'layout') {
    activeBarEl = (
      <LayoutBar
        onAlign={(edge: AlignEdge) => model.onAlign?.(edge)}
        onGrid={model.onGrid ? () => model.onGrid?.() : undefined}
        onBack={dismissSubmenu}
      />
    );
  } else if (displaySub === 'shadow') {
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
  } else if (displaySub === 'stroke') {
    // The Border bar retitled, pointed at the vector object's own stroke, with
    // the rows this subtype has no answer for dropped (svgStrokeRows).
    const rows = svgStrokeRows(model.svgSubtype ?? 'stroke');
    activeBarEl = (
      <BorderBar
        title="STROKE"
        border={strokeForBar}
        cornerRadius={model.strokeRadius ?? 0}
        showRadius={rows.radius}
        showPosition={rows.position}
        onChange={(b) => applyStroke(b, false)}
        onCommit={(b) => applyStroke(b, true)}
        onCornerRadius={(r, committed) => model.onStrokeRadius?.(r, committed)}
        onBack={dismissSubmenu}
        onRemove={removeStroke}
        onPickColor={() => model.onPickStrokeColor?.()}
      />
    );
  } else if (displaySub === 'rigRoot' || displaySub === 'rigHands'
    || displaySub === 'rigFeet' || displaySub === 'rigSpine') {
    const part: RigPart =
      displaySub === 'rigRoot' ? 'rig'
      : displaySub === 'rigHands' ? 'hands'
      : displaySub === 'rigFeet' ? 'feet' : 'spine';
    activeBarEl = (
      <RigPoseBar
        part={part}
        values={model.rigSliders ?? restRigSliders()}
        onChange={(key, v) => model.onRigSlider?.(key, v, false)}
        onCommit={(key, v) => model.onRigSlider?.(key, v, true)}
        onBack={dismissSubmenu}
        onReset={() => model.onResetRigPart?.(part)}
        ik={model.rigIk}
        onToggleIk={model.onToggleRigIk}
      />
    );
  } else if (displaySub === 'opacity') {
    activeBarEl = (
      <OpacityBar
        opacity={opacityForBar}
        onChange={(o) => applyOpacity(o, false)}
        onCommit={(o) => applyOpacity(o, true)}
        onBack={dismissSubmenu}
        onRemove={removeOpacity}
      />
    );
  } else if (displaySub === 'crop') {
    activeBarEl = (
      <CropBar
        framing={framingForBar}
        pixelSize={model.imagePixelSize}
        onChange={(f) => applyFraming(f, false)}
        onCommit={(f) => applyFraming(f, true)}
        onBack={dismissSubmenu}
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
        onPickColor={() => model.onPickTextColor?.()}
        onSheetOpenChange={(open) => { fontSheetOpenRef.current = open; }}
      />
    );
  }

  return (
    <>
      {submenuMounted ? (
        // Anchored to the panel's top edge, not the screen's bottom, and it
        // rides the panel's own show/hide slide (translateY) on top of its
        // reveal (layerY) so the two never come apart. It sits BELOW the panel
        // in z-order, which is what lets it hide by sliding down behind it.
        <Animated.View
          style={[
            styles.effectBarWrap,
            {
              bottom: panelBox.height,
              height: barHeight,
              backgroundColor: BAR_BG,
              transform: [{ translateY: Animated.add(layerY, translateY) }],
            },
          ]}
          {...submenuPan.panHandlers}
        >
          <Animated.View style={{ transform: [{ translateX: navX }] }}>
            {activeBarEl}
          </Animated.View>
        </Animated.View>
      ) : null}
      <View style={styles.clip} pointerEvents="box-none">
        <Animated.View style={[styles.panel, { height: panelBox.height, paddingBottom: panelBox.paddingBottom, transform: [{ translateY }] }]}>
        {/* A single row of buttons — the showing page's — that a horizontal
            swipe slides between. Empty cells flank the buttons to centre the
            group. Carousel dots below, one per page, track which is showing. */}
        <View style={styles.swapArea} {...(canSwap ? swapPan.panHandlers : {})}>
          <Animated.View style={{ transform: [{ translateX: swapX }] }}>
            <View style={styles.gridRow} onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}>
              {/* The selection capsule, first so it paints under the words. */}
              <OptionCapsule at={capsuleAt} width={capsuleWidth} />
              {sidePad > 0 ? <View style={{ flex: sidePad }} /> : null}
              {activeButtons}
              {sidePad > 0 ? <View style={{ flex: sidePad }} /> : null}
            </View>
          </Animated.View>
        </View>
        {canSwap ? (
          <View style={styles.dotsRow}>
            {pages.map((p) => (
              <View key={p} style={[styles.dot, p === shownPage && styles.dotActive]} />
            ))}
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
    backgroundColor: PANEL_BG,
    borderTopWidth: 1,
    borderTopColor: PANEL_BORDER,
    // 16 to match the effect bars' content inset, so the title lands in the
    // same place whether the panel or an effect bar is showing.
    paddingHorizontal: 16,
  },
  // Fills the panel so a horizontal swipe anywhere over it (not just on the
  // buttons) swaps the row.
  swapArea: { flex: 1 },
  // Carousel dots (bottom): one filled for the current page, the other empty.
  dotsRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12, paddingTop: 4, paddingBottom: OBJECT_DOTS_BOTTOM },
  dot: { width: OBJECT_DOT_SIZE, height: OBJECT_DOT_SIZE, borderRadius: OBJECT_DOT_SIZE / 2, backgroundColor: PANEL_DOT },
  dotActive: { backgroundColor: ICON_COLOR },
  // A grid row: cells separated by a gap wide enough that they read as distinct
  // buttons, not one strip. The common-actions page divides it into equal
  // columns flanked by one weighted empty cell per side that centres them; the
  // type-options page sizes each cell to its own word (see optionCell).
  // `justifyContent` only bites on that second page, and only once every option
  // has hit its width cap — then the group centres instead of spreading.
  gridRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: OPTION_ROW_GAP,
    paddingTop: 4,
    paddingBottom: 8,
  },
  gridButton: { flex: 1, height: 48, alignItems: 'center', justifyContent: 'center' },
  // ── Type-specific option pills (the toolbar line-mode pushdown's look) ──
  // Variable width: `flexBasis: 'auto'` starts the cell at its own word plus
  // the pill's padding, and flexGrow shares the row's leftover width equally
  // between the cells, so the row is always full and a long word gets the room
  // it needs. Allowed to shrink (ellipsizing) only if the words really can't
  // fit. Keeps the GridButton's 48pt height so a page swap can't change the
  // row's height.
  optionCell: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Wide windows only: stop a short set from stretching into slabs. A phone
  // keeps every pixel — that's where the words were being clipped.
  optionCellCapped: { maxWidth: OPTION_CAPSULE_MAX_WIDTH },
  // The shared selection capsule, sliding between cells. Absolutely placed
  // (left 0 + an animated translateX) so it moves without touching layout, and
  // vertically centred on the 48pt cell under the row's 4pt top padding.
  optionCapsule: {
    position: 'absolute',
    left: 0,
    top: 4 + (48 - OPTION_CAPSULE_HEIGHT) / 2,
    height: OPTION_CAPSULE_HEIGHT,
    borderRadius: 999,
    backgroundColor: STATE_ACTIVE,
  },
  // The word's box: the whole cell, so the pill a toggle paints and the shared
  // capsule that parks over it are the same box the cell was measured as.
  // Like the pushdown's capsule, but sized by the word rather than hardcoded —
  // the option sets run to six items and their words vary, so one fixed width
  // would clip on a phone and float on a desktop.
  // `alignSelf: stretch` rather than a width: it fills the cell without being a
  // percentage, which would confuse the cell's own content-sized flex basis.
  optionPill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    alignSelf: 'stretch', height: OPTION_CAPSULE_HEIGHT, paddingHorizontal: OPTION_PILL_PAD, borderRadius: 999,
  },
  // 13/600, the toolbar line-mode pushdown's word, at every width. Narrow
  // screens used to drop this to 11 to keep the longest words whole; matching
  // the pushdown matters more, and a word that outgrows its cell ellipsizes.
  // The colour is the one departure from the pushdown: its fixed #a3a3a3 was
  // struck for the toolbar's three-word row and against the panel's #e5e5e5 it
  // barely cleared the surface. These are the panel's row labels, so they take
  // the panel ink ramp's label rung instead.
  optionLabel: { flexShrink: 1, color: PANEL_INK_LABEL, fontSize: 13, fontWeight: '600' },
  optionLabelActive: { color: '#ffffff' },
  // A color-valued option (the frame's Fill) keeps a small swatch ahead of its
  // word — on/off the pill can say itself, a color it can't.
  optionSwatch: {
    width: 12, height: 12, borderRadius: 6, overflow: 'hidden',
    borderWidth: 1, borderColor: PANEL_SWATCH_BORDER,
  },
  // Full-width effect bar (Drop Shadow / Border / …), anchored so its bottom
  // edge meets the panel's top — `bottom` is set inline from the panel's
  // measured height. Its zIndex sits UNDER the panel's (200) so a dismiss
  // slides it down behind that opaque surface rather than across it, and above
  // the floating capsules (100) so it can't be overdrawn by them.
  effectBarWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 195,
  },
});
