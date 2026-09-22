import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { AlignEdge, BorderModel, EffectKind, EndpointsModel, FramingModel, GlowKind, GlowModel, ObjectPropertiesModel, OpacityModel, RGBLike, ShadowModel, TextStyleModel, TintModel } from '../adapter';
import { IMAGE_EDIT_OPTIONS, isSingleImageAction, swipeDismissDirection } from '../logic/imageEdit';
import { PAINT_EDIT_OPTIONS } from '../logic/paintEdit';
import {
  PATTERN_EDIT_OPTIONS, patternActionOfSubmenu, patternActionSubmenu,
} from '../logic/patternEdit';
import { multiSelectionOptions } from '../logic/multiOptions';
import { composeFade, fadeMix } from '../logic/opacityEdit';
import { isValueDragging } from '../logic/slider';
import { SubmenuKey, editSheetHeight, emptyEffectHeight, pageIsWelled, submenuHeight } from '../logic/submenuHeight';
import { svgEditOptions, svgHasEndpoints, svgHasFill, svgHasOpacity, svgHasShape, svgStrokeRemovable, svgStrokeRows } from '../logic/svgEdit';
import { DEFAULT_TINT_MODEL, addStop } from '../logic/tint';
import {
  landingSubmenu,
  objectPanelLayout,
  objectPanelPages,
} from '../logic/panelLayout';
import { EffectBar, EffectsBar, EFFECT_KINDS, effectLabel } from './EffectsBar';
import { BorderBar } from './BorderBar';
import { OpacityBar } from './OpacityBar';
import { RigJointsBar } from './RigJointsBar';
import { RigPoseBar } from './RigPoseBar';
import { RigColorBar } from './RigColorBar';
import {
  RIG_OUTLINES_DEFAULT, RIG_PAGES, RIG_VOLUMES_DEFAULT, restRigSliders, rigPartOfSubmenu,
  rigPartSubmenu, type RigJointSection,
} from '../logic/rigEdit';
import { CropBar } from './CropBar';
import { ImageBar } from './ImageBar';
import { TextBar, TextPage } from './TextBar';
import { TintBar } from './TintBar';
import { EndpointsBar } from './EndpointsBar';
import { TransformBar, type CopiesSection } from './TransformBar';
import { rememberedCopies, type StickyCopies } from '../logic/transform';
import { LayoutBar } from './LayoutBar';
import {
  PatternSymmetryBar, PatternSymmetryGrid, PatternTileBar, PatternTilesBar, PatternToolsBar,
} from './PatternBars';
import {
  BarBody,
  ColorSliderRow,
  EffectButton,
  EmptyEffectBar,
  MultiToggleRow,
  SectionTabs,
  SegmentedRow,
  SliderRow,
} from './effectBar';
import { ShapeBar } from './ShapeBar';
import { EditSheet, EditTabSpec } from './EditSheet';
import { SHEET_RADIUS } from '../logic/submenuHeight';
import {
  KEYBOARD_LIFT_MS,
  PANEL_ANIM_MS,
  PANEL_BG,
  PANEL_BORDER,
  PANEL_ICON,
  PANEL_INK,
  PATTERN_ACTIVE,
} from '../theme';

// Facet's ObjectPropertiesPanel: a bottom sheet that slides up (150ms) when
// something is selected — light raised surface (the toolbar's #e5e5e5, so top
// and bottom chrome match; see PANEL_BG in theme.ts), hairline top border,
// icon buttons grouped by hairline dividers. Below 500px wide the buttons go
// compact (24px icons, flex-weighted groups). The structural actions
// (group/ungroup/join, and the boolean union) render only when the app
// supplies them (Facet superset) — and for a multi-selection Group and Merge
// move off this row into the Edit sheet (below), because they describe the
// selection rather than what it is made of.
//
// The panel is a compact fixed height (OBJECT_PANEL_HEIGHT) — one row of
// buttons. It has two pages (logic/panelLayout.ts), swiped between; the row
// of carousel dots that said which was showing is gone, the sheet saying so
// by standing up:
//
//   common — rotate / flip / copy / lock / delete, as bare icons: universal
//            enough to need no caption. Every selection has this page, first,
//            and it is the row the panel itself shows.
//   edit   — the EDIT SHEET (components/EditSheet.tsx): every option the
//            selection's KIND offers (images: crop / effects / border /
//            opacity; text: edit / type / align / effects) followed by what
//            the SELECTION offers (Layout · Group · Merge, multi-selections
//            only — a mixed selection has just those), as a row of tabs
//            over a darkened well holding the lit tab's controls. Present
//            when the selection has any option.
//
// The sheet is not a row the panel swaps in. A sideways swipe on the panel
// (or a press on the second dot) POPS IT UP over the panel, rounded corners
// and all, sized to the tab it opens on; tapping another tab swaps the well's
// controls and animates the sheet to that page's own height (each page is
// only as tall as it needs — logic/submenuHeight.ts); a downward swipe on
// the sheet (or the first dot) drops it back down, revealing the panel and
// its dots again. The sheet carries no dots of its own and no sideways
// carousel: the tabs are the navigation.
//
// The sheet opens on the tab the last one was showing when this selection
// has it, else its first page; it stays up across selections that have
// options and folds when one has none.

type MCIName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const ICON_COLOR = PANEL_ICON; // the toolbar's inactive-tool grey
const ICON_COLOR_STRONG = PANEL_INK; // full ink — the locked state, a step up
const COMPACT_MAX_WIDTH = 500;
const DEFAULT_SHADOW_MODEL: ShadowModel = {
  dx: 0.75, dy: 0.875, blur: 1.125, spread: 0.125, color: { r: 0, g: 0, b: 0 }, opacity: 0.45,
};
// …and a glow's: the shadow's softness with nowhere to fall, in white
// rather than black — a glow is light where a shadow is its absence. Only a
// fallback for the frame before the host reports its own, as with every
// other page's default.
const DEFAULT_GLOW_MODEL: GlowModel = {
  blur: 1.125, spread: 0.125, color: { r: 255, g: 255, b: 255 }, opacity: 0.6,
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
// What a hue row shows before the host has reported a colour — only a
// fallback for the transient frame before the model lands, since every host
// that offers one of these pages resolves the real colour.
const DEFAULT_ROW_COLOR: RGBLike = { r: 255, g: 255, b: 255 };
// Opacity-page defaults: fully opaque, hard edges — what every object renders
// as until it visits the page.
const DEFAULT_OPACITY_MODEL: OpacityModel = {
  opacity: 1, fade: 0, fadeColor: { r: 255, g: 255, b: 255 },
};
// Design default framing (Zoom 130%, Margin 14pt, Ratio 1:1, Straighten 0°,
// Size 46, Spacing 6pt). Lengths in world cells (pt ÷ 16).
const DEFAULT_FRAMING_MODEL: FramingModel = {
  mode: 'fill', zoom: 1.3, margin: 0.875, ratio: 'square', angle: 0, tileScale: 0.46, tileGap: 0.375,
};
/** Value-equality for the Crop page's tracked params. A slider's own live edit
 *  round-trips to an equal model.framing, so this lets the draft ignore its own
 *  echo while still following genuinely external changes (e.g. the two-finger
 *  pinch-zoom on the canvas). */
const sameFramingModel = (a: FramingModel, b: FramingModel): boolean =>
  a.mode === b.mode && a.zoom === b.zoom && a.margin === b.margin && a.ratio === b.ratio &&
  a.angle === b.angle && a.tileScale === b.tileScale && a.tileGap === b.tileGap;
// Fallback seed for the Text pages when the app hasn't supplied a style yet
// (it always does while a text is selected — this only guards the transient
// frame before model.textStyle lands).
const DEFAULT_TEXT_STYLE_MODEL: TextStyleModel = {
  fontId: 'system', weight: 'regular', size: 2, letterSpacing: 0, lineHeight: 1.2, bend: 0, align: 'left', vAlign: 'top', color: { r: 58, g: 53, b: 50 },
};

// A pattern fill's tile is square and holds 1..8 cells per edge — the
// Pattern page's RESOLUTION row. Mirrors the engine's
// MIN/MAX_SHAPE_PATTERN_SIZE (this package stays engine-import-free, like
// PatternSymmetryFlags), whose stored name is still `size`: what the row
// sets is how many cells the tile is cut into, which is a density, and
// the word "Size" was taken by how big the repeat DRAWS.
const MIN_SVG_PATTERN_SIZE = 1;
const MAX_SVG_PATTERN_SIZE = 8;
const DEFAULT_SVG_PATTERN_SIZE = 2;

// …and how big that repeat DRAWS: the Size row, 1 to 10 in whole steps,
// read as TENTHS of the width of the shape being filled — 10 draws one
// repeat across the whole shape, 1 steps ten of them across it. Mirrors
// the engine's MIN/MAX/STEP_SHAPE_PATTERN_SPAN on the same
// engine-import-free rule as the resolution numbers above.
const MIN_SVG_PATTERN_SPAN = 1;
const MAX_SVG_PATTERN_SPAN = 10;
const SVG_PATTERN_SPAN_STEP = 1;
const DEFAULT_SVG_PATTERN_SPAN = 2;

/** The Size row's number, written the shortest way that is still exact:
 *  "1", "10". A trailing ".00" on a slider readout reads as precision the
 *  control does not have. */
const spanText = (span: number): string => String(Number(span.toFixed(2)));

/** The Pattern page's three sections, in display order: the tile itself,
 *  the mirror it is painted under, and the LINE the tiles are drawn in —
 *  which is the pattern's own, not the outline the shape wears. (That one
 *  is the Stroke TAB, a row up; this is the mark inside it.) */
const SVG_PATTERN_SECTIONS = [
  { value: 'tile' as const, label: 'Tile' },
  { value: 'symmetry' as const, label: 'Symmetry' },
  { value: 'stroke' as const, label: 'Stroke' },
];

// The property pages, in tab order. Image selections offer crop / effects /
// border / opacity (matching their tab order); text offers font / align (two
// pages of the Text controls) and then effects — the SAME Effects page an
// image opens, cast by the glyphs rather than by the box; a vector selection
// has stroke, plus its subtype's second page — svgFill on the closed shapes,
// endpoints on the open paths — plus opacity on the closed shapes.
//
// `layout` is the odd one out: it rides on a MULTI-selection rather than on a
// type, so it joins whichever of the above the members happen to share (and
// stands alone when they share none), always last — the type's own controls
// are what the selection came for.
//
// SubmenuKey itself lives in logic/submenuHeight.ts, which needs it to say how
// tall each of these pages stands.

// One grid cell: a bare icon, weighted (flex) so every button shares the same
// column width. The common actions these draw — rotate, flip, copy, lock,
// delete — are the universal ones, and their glyphs name them without help;
// `label` survives as the accessibility name.
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

/** One type-specific option, described rather than rendered — it becomes a
 *  tab of the Edit sheet (EditTabSpec), lit while its page is showing. */
/** Which page each effect's own tab opens, and which effect a page is for.
 *
 *  These tabs are unlike every other tab in the sheet: they EXIST only
 *  while the selection wears the effect, and the Effects page's buttons are
 *  what put them there and take them away. One map for both directions, so
 *  the tab a button makes and the page that tab opens can never disagree. */
const EFFECT_PAGE: Record<EffectKind, SubmenuKey> = {
  shadow: 'shadow', outer: 'glowOuter', inner: 'glowInner',
};
const EFFECT_OF_PAGE: Partial<Record<SubmenuKey, EffectKind>> = {
  shadow: 'shadow', glowOuter: 'outer', glowInner: 'inner',
};

/** The pages whose open state the panel keeps itself (see `localSub`). */
type LocalSubmenu = 'background' | 'card' | 'shape' | 'image' | 'rigColor' | 'rigFigure';
const isLocalSubmenu = (key: SubmenuKey): key is LocalSubmenu =>
  key === 'background' || key === 'card' || key === 'shape' || key === 'image'
  || key === 'rigColor' || key === 'rigFigure';

interface OptionSpec extends Omit<EditTabSpec, 'selected'> {
  /** The page this option opens. Options carrying one light up as tabs while
   *  that page shows; the rest (actions, toggles) never take that lit state. */
  sub?: SubmenuKey;
}

export function ObjectPropertiesPanel({ model, safeBottom = 0, keyboardInset = 0, onOccludedHeight }: {
  model: ObjectPropertiesModel;
  /** Bottom safe-area inset (home indicator). Padded under the panel's row
   *  and the Edit sheet's last line so they clear it; 0 on non-notched / web. */
  safeBottom?: number;
  /** Pixels the on-screen keyboard covers from the bottom edge, measured by
   *  the host (the editor's keyboardInset). The Edit sheet rides UP by this
   *  much so a page's value fields stay in sight while they are being typed
   *  into — the sheet is bottom-anchored, and the keyboard rises straight
   *  over the row being edited otherwise. 0 whenever no keyboard is up, and
   *  on every host that never raises one. */
  keyboardInset?: number;
  /** Reports how many px of the screen's bottom edge the panel claims — the
   *  base row when visible, or the Edit sheet while it is up (it covers the
   *  row) — so the shell can scroll the selection clear of it. Fired with the
   *  TARGET height the moment visibility / sheet state changes (not after
   *  the slide), so a camera animation can run alongside the panel's own.
   *  0 when hidden. */
  onOccludedHeight?: (px: number) => void;
}) {
  const { width } = useWindowDimensions();
  const compact = width < COMPACT_MAX_WIDTH;
  const [mounted, setMounted] = useState(model.visible);
  // The panel rests against the bottom edge. Where a device reports a bottom
  // inset (iOS home indicator / curved corners) the carousel dots sit *in* that
  // strip — nothing there is tappable anyway — and the panel reclaims their
  // row; with no inset (desktop web) the dots stay in flow. The hidden position
  // must clear the full height either way, to slide fully off.
  // Note the editor always runs as the web bundle, inside a WebView on native,
  // so this keys off the measured inset rather than Platform.OS.
  const panelBox = objectPanelLayout(safeBottom);
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

  // ── The sideways swipe that pops the Edit sheet ──────────────────────
  // A swipe past the threshold in EITHER direction pops the sheet up over
  // the panel. The row itself DOES NOT MOVE: it used to follow the finger
  // and spring back, a leftover from when a swipe slid one row of options
  // out and another in, and once the options became the sheet's tabs that
  // travel was saying something untrue — nothing is going anywhere
  // sideways. The sheet rising is the whole answer to the gesture.
  //
  // Whether the sheet has been ASKED for — by a swipe, the edit dot, a page
  // the host opened, or the host itself (model.editOpen: a floating Edit
  // button outside the panel). It is what keeps the sheet up across
  // selections (see sheetOpen below); a downward swipe or the common dot
  // clears it.
  //
  // Controlled when the host passes `editOpen`, the panel's own otherwise —
  // and the host hears every gesture through onEditOpenChange either way,
  // so its button can read as lit while the sheet stands.
  // Which face the Copies page's box shows — its count and turn, its
  // offsets or its scales. Held HERE rather than in the bar for the same
  // reason its other drafts are: the page belongs to the panel, and the
  // sheet's height is computed ahead of the render. (Every face stands the
  // same height, so the sheet never moves under a tab press.)
  const [copiesSection, setCopiesSection] = useState<CopiesSection>('copies');
  // …and what that page was last SET to, minus the count — held here for the
  // same reason, and outliving a selection the same way. The bar is seeded
  // per mount and unmounts with the page, so this is what carries an offset
  // and a turn from one shape to the next: the settings say what a copy is,
  // and a copy of a rectangle is the same request as a copy of a line.
  // (StickyCopies: only keys actually moved, never the count.)
  const [copiesSticky, setCopiesSticky] = useState<StickyCopies>({});
  // …and the Joints page's own, held here for the same reason: the page's
  // height must be known before it renders, and it is the same either way.
  const [jointSection, setJointSection] = useState<RigJointSection>('elbows');
  const [localSheetWanted, setLocalSheetWanted] = useState(false);
  const sheetWanted = model.editOpen ?? localSheetWanted;
  const onEditOpenChange = model.onEditOpenChange;
  const setSheetWanted = useCallback((open: boolean) => {
    setLocalSheetWanted(open);
    onEditOpenChange?.(open);
  }, [onEditOpenChange]);
  // Latest opener + swipe-eligibility, so the once-created PanResponder
  // always uses the current option set.
  const openSheetRef = useRef<() => void>(() => {});
  const canSwapRef = useRef(false);

  const swapPan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        !isValueDragging()
        && canSwapRef.current && Math.abs(g.dx) > 5 && Math.abs(g.dx) > Math.abs(g.dy),
      // Nothing to do as the finger travels: the row is still, and the
      // release decides whether the sheet comes up.
      onPanResponderRelease: (_e, g) => {
        if (swipeDismissDirection(g.dx) !== 0 && canSwapRef.current) openSheetRef.current();
      },
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
  // sharing a kind, so they share Layout's row — words, not the common row's
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

  // Whether the selection has any option — a tab — at all. `type` is what the
  // selection's KIND offers (and a multi-selection's members must share a
  // kind to have one); `multi` is what the SELECTION offers, whatever it is
  // made of. Both render on the sheet's ONE tab row — kind options first,
  // then the selection's — which scrolls if it must.
  const hasTypeOptions = !!model.showImageEdit || !!model.showTextStyle || !!model.showFrameOptions || !!model.showInvert || !!model.showSvgOptions || !!model.showPaintOptions || !!model.showPatternOptions || !!model.showStrokeOptions || !!model.showRigOptions || showUngroup;
  const hasMultiOptions = showLayout || showGroup || showMerge;
  const hasOptions = hasTypeOptions || hasMultiOptions;
  // Signature of the current selection's option set. It changes when the
  // panel first appears for a selection or the selected object's type changes
  // (image → frame → text …), and empties when the panel hides. The vector
  // subtype is part of it so switching between two vector objects with
  // different menus (a line → a rectangle) re-lands the sheet.
  const typeSig = model.visible
    ? `${multi ? 'm' : ''}${showLayout ? 'L' : ''}${showGroup ? 'G' : ''}${showUngroup ? 'g' : ''}${showMerge ? 'M' : ''}${model.showImageEdit ? 'i' : ''}${model.showFrameOptions ? 'f' : ''}${model.showTextStyle ? 's' : ''}${model.showInvert ? 'v' : ''}${model.showPaintOptions ? 'p' : ''}${model.showPatternOptions ? 'P' : ''}${model.showStrokeOptions ? 'S' : ''}${model.showSvgOptions ? `g${model.svgSubtype ?? 'stroke'}${model.onSvgEdit ? 'E' : ''}` : ''}`
    : '';
  const prevTypeSig = useRef('');
  useEffect(() => {
    if (typeSig === prevTypeSig.current) return;
    prevTypeSig.current = typeSig;
    // A selection with no options has no sheet to keep up: the next one
    // that has options opens on the common row again, exactly as a swipe
    // down would have left it. (A selection WITH options keeps the sheet,
    // landing on the remembered tab — see the landing effect below.)
    if (model.visible && !hasOptions) setSheetWanted(false);
  }, [typeSig, model.visible, hasOptions]);

  // Effects / Border controls each seed a local draft from the model when
  // they open, then own the tracked params so live previews don't fight the
  // sliders (color still comes from the model — it's changed externally via
  // the full-screen picker).
  //
  // The Effects family holds THREE of them — the shadow and a glow each way
  // — and seeds all three when the family opens rather than on each tab
  // press: moving between the effect tabs is a look at another effect, not
  // an edit, and re-seeding as a tab is pressed would let a half-dragged
  // value on one of them be written by another.
  const [shadowDraft, setShadowDraft] = useState<ShadowModel | null>(null);
  const [glowDrafts, setGlowDrafts] = useState<Partial<Record<GlowKind, GlowModel>>>({});
  /** Which of the Effects family's pages is showing — the Add / Remove
   *  buttons, or one effect's controls. The four share ONE host flag
   *  (`effectsOpen`), exactly as the four text pages share `textStyleOpen`,
   *  and this picks between them. Held HERE because the sheet's height is
   *  worked out before the page renders. */
  const [effectsPage, setEffectsPage] = useState<SubmenuKey>('effects');
  const prevEffectsOpen = useRef(false);
  const [borderDraft, setBorderDraft] = useState<BorderModel | null>(null);
  const prevBorderOpen = useRef(false);
  const [cropDraft, setCropDraft] = useState<FramingModel | null>(null);
  const prevCropOpen = useRef(false);
  // The Opacity page rides the same draft pattern as Shadow — the draft owns
  // the two sliders' values, while the Fade target comes from the model (it
  // is changed externally, via the full-screen picker).
  const [opacityDraft, setOpacityDraft] = useState<OpacityModel | null>(null);
  const prevOpacityOpen = useRef(false);
  /** The fade the Opacity page OPENED on. The slider starts at the left and
   *  says how much further; this is what it is further THAN. */
  const fadeBaseRef = useRef(0);
  // The Stroke page rides the same draft pattern as Border — it IS the Border
  // page, pointed at a vector object's own stroke.
  const [strokeDraft, setStrokeDraft] = useState<BorderModel | null>(null);
  const prevStrokeOpen = useRef(false);
  // The Fill page rides the Tint page's draft pattern — it IS the Tint page,
  // pointed at a closed shape's interior.
  const [svgFillDraft, setSvgFillDraft] = useState<TintModel | null>(null);
  // The Pattern page's Size handle while it is moving; null when it rests
  // on what the shape actually carries.
  const [svgPatternSizeDraft, setSvgPatternSizeDraft] = useState<number | null>(null);
  const [svgPatternSpanDraft, setSvgPatternSpanDraft] = useState<number | null>(null);
  // …and which of its two sections is showing (the Copies page keeps its
  // own the same way). It outlives a selection, like that one: a section
  // is where you were working, not a property of the shape.
  const [svgPatternSection, setSvgPatternSection] =
    useState<'tile' | 'symmetry' | 'stroke'>('tile');
  const [svgPatternStrokeDraft, setSvgPatternStrokeDraft] = useState<BorderModel | null>(null);
  const prevSvgFillOpen = useRef(false);
  // The Text pages own their tracked params too (color still comes from the
  // model — it's changed externally via the full-screen picker).
  const [textDraft, setTextDraft] = useState<TextStyleModel | null>(null);
  const prevTextOpen = useRef(false);
  // The Text controls are three pages (font / spacing / align) sharing the
  // single `textStyleOpen` flag; this tracks which page shows. The entry
  // points own it: the Type tab opens on 'font', Spacing on 'spacing', Align
  // on 'align' (all via openSubmenu).
  const [textPage, setTextPage] = useState<TextPage>('text');
  // The Color, Shape, Image, rig-Color and rig-Figure pages are the panel's
  // own: they hold nothing the host has to know is open (a swatch opens the
  // host's picker, a toggle fires its action, the Radius slider writes
  // through onStrokeRadius as it always did, Replace is one press, Reset is
  // one press, and the resolution is just read), so unlike the effect pages
  // their open state lives here rather than on the model. A page NOT on this list and not
  // wired to a host flag can never open at all — which is what left the
  // Image tab dead, and an image's sheet landing on it empty, and what
  // left the rig's Color tab pressable but inert: openSubmenu ran off the
  // end of its chain (rigColor names no rig PART, so the rig branch skips
  // it too) and set nothing, so the page could never become the open one.
  const [localSub, setLocalSub] = useState<LocalSubmenu | null>(null);
  // ── The pages (Crop / Effects / Border / Text …) ─────────────────────
  // The open page is what the Edit sheet's well holds, and its tab is the lit
  // one. The pages are separate components but only one shows at a time.
  // The INTERIOR pages (Fill, Pattern) go by what the selection encloses,
  // which the host answers from its geometry; the subtype is the fallback
  // for a host that doesn't (and the right answer for anything a tool drew).
  const svgFillable = !!model.showSvgOptions
    && (model.svgEncloses ?? svgHasFill(model.svgSubtype ?? 'stroke'));
  const svgEndable = !!model.showSvgOptions && svgHasEndpoints(model.svgSubtype ?? 'stroke');
  const svgOpacityable = !!model.showSvgOptions && svgHasOpacity(model.svgSubtype ?? 'stroke');
  // Every vector subtype repeats (svgEditOptions' Copies).
  const svgTransformable = !!model.showSvgOptions;
  // A polygonal shape rounds its corners on the Shape page.
  const svgShapeable = !!model.showSvgOptions && svgHasShape(model.svgSubtype ?? 'stroke');
  // Vectors and patterns share the Stroke page (and its colour).
  const strokeable = !!model.showSvgOptions || !!model.showPatternOptions || !!model.showStrokeOptions;

  // ── Which effects the selection WEARS ─────────────────────────────────
  // This is the one reading in the panel that decides how many TABS there
  // are. Everywhere else a tab is a fixed property of the selection's kind;
  // here the Effects page's buttons add and remove them as they add and
  // remove the effects themselves.
  //
  // Read strictly (`=== true`), unlike the absent-effect Add pages' own
  // `!== false`: those fall back to showing controls, which is harmless,
  // where this would conjure a tab — a place to GO — for an effect a host
  // that reports nothing may not have.
  const effectWorn = (kind: EffectKind): boolean => (kind === 'shadow'
    ? model.shadowPresent === true
    : model.glowPresent?.[kind] === true);
  const wornEffects = EFFECT_KINDS.filter(effectWorn);
  /** The Effects tab, then one tab per effect worn — the run of pages that
   *  goes wherever a kind's tab order names `effects`. */
  const effectPages: SubmenuKey[] = ['effects', ...wornEffects.map((k) => EFFECT_PAGE[k])];

  // ── Where a colour reads ──────────────────────────────────────────────
  // On the page of the thing it colours, and nowhere else: the Stroke page's
  // hue row is the line's ink, the Fill page's is the fill, the Effects and
  // Border pages' are their own, and a text's ink leads its Text page. There
  // is no shared Color page any more — it collected every colour onto one tab
  // and left the pages named after them unable to set them (a Fill page whose
  // only control was Opacity), which is the whole reason it goes.
  //
  // Two colour settings have no page of that kind to sit on, so they get one
  // of their own, first among their type's tabs:
  //
  //  • a FRAME's Background — its boundary rect's fill, the frame's own
  //    colour, on a page that is that one hue row;
  //  • a word STICKER's card scheme — Invert, which is not a hue at all but a
  //    flip between light card / dark ink and the reverse, so it stays a chip.
  //
  // Both are the panel's own pages (LocalSubmenu): a hue row writes through
  // the host's callback and a chip fires its action, so neither has open state
  // the host must track.
  const backgroundable = !!model.showFrameOptions && !!model.onPickFrameBackground;
  const cardable = !!model.showInvert;
  const typeSubmenuOrder: SubmenuKey[] =
    model.showImageEdit ? (multi
      ? [...effectPages, 'border', 'opacity', 'transform']
      : [...(model.onReplaceImage ? (['image'] as const) : []), 'crop', ...effectPages, 'border', 'opacity', 'transform'])
    // A frame leads on its own fill — Background — then the two effects it
    // dresses its edge with.
    : model.showFrameOptions
      ? [...(backgroundable ? (['background'] as const) : []), ...effectPages, 'border']
    // A text leads on the text ITSELF — its ink and its size — then the
    // pages that dress it.
    : model.showTextStyle ? ['text', 'font', 'spacing', 'align', ...effectPages, 'opacity', 'transform']
    // A word sticker: its card scheme, then Opacity.
    // A word sticker: its card scheme, then the pages every kind shares.
    : model.showInvert ? [...(cardable ? (['card'] as const) : []), ...effectPages, 'opacity']
    : model.showPaintOptions ? ['opacity']
    // A pattern object's pages, in the order its tab row lists them, plus
    // the Stroke page its baked tile paths share with the vectors and the
    // Opacity page every kind that draws colour shares.
    : model.showPatternOptions
      ? [
          ...PATTERN_EDIT_OPTIONS.map((o) => patternActionSubmenu(o.action)),
          'stroke' as const,
          'opacity' as const,
        ]
    // Vectors and patterns together: the one page they share.
    : model.showStrokeOptions ? ['stroke']
    // A rig's pages, in RIG_PAGES' order: Figure, Joints, Color, Transform.
    // (The part pages Hands/Feet/Spine/Head came off the row, their
    // sliders living on as the host's floating slider modes.) Opacity
    // stood beside it and is gone: a figure is a POSE, and fading one is
    // not a thing anybody reached this panel to do — it left a two-tab
    // row where one of the tabs was a slider nobody asked for. The model
    // and the page stand for every other kind that offers them. Checked
    // before showSvgOptions: a rig's figure IS an svg object, and the
    // other vector pages have nothing to act on for a baked silhouette.
    : model.showRigOptions ? RIG_PAGES.map((o) => o.sub)
    : model.showSvgOptions
      ? [
          'stroke',
          ...(svgShapeable ? (['shape'] as const) : []),
          ...(svgFillable ? (['svgFill'] as const) : []),
          ...(svgFillable && (model.onAddSvgPattern || model.onEditSvgPattern)
            ? (['svgPattern'] as const) : []),
          ...(svgEndable ? (['endpoints'] as const) : []),
          // …then the tail every kind shares — Effects (and the tabs its
          // buttons have made), Opacity, Copies.
          ...effectPages,
          ...(svgOpacityable ? (['opacity'] as const) : []),
          ...(svgTransformable ? (['transform'] as const) : []),
        ]
    : [];
  // Does THIS selection offer the Copies page? Read off the tab order
  // itself — the reading the one fold-away rule below now makes for every
  // page, and the first place it was made.
  const transformable = typeSubmenuOrder.includes('transform');

  // Layout joins the tail of whatever the selection's type offers, so a mixed
  // multi-selection's sheet has Layout alone to open and a uniform one's has
  // its type's pages before it.
  const submenuOrder: SubmenuKey[] = showLayout ? [...typeSubmenuOrder, 'layout'] : typeSubmenuOrder;

  const activeSub: SubmenuKey | null =
    model.layoutOpen ? 'layout'
    : model.cropOpen ? 'crop'
    : model.effectsOpen ? effectsPage
    : model.borderOpen ? 'border'
    : model.opacityOpen ? 'opacity'
    : model.strokeOpen ? 'stroke'
    : model.svgFillOpen ? 'svgFill'
    : model.svgPatternOpen ? 'svgPattern'
    : model.endpointsOpen ? 'endpoints'
    : model.transformOpen ? 'transform'
    : localSub ? localSub
    : model.rigPartOpen ? rigPartSubmenu(model.rigPartOpen)
    : model.patternBarOpen ? patternActionSubmenu(model.patternBarOpen)
    : model.textStyleOpen ? textPage
    : null;
  const submenuOpen = activeSub != null;

  // The sheet is up while it has been asked for OR a page is open (a host
  // can open a page itself — the pattern capsule's Tools — and the sheet
  // rises to hold it), and only for a selection that has tabs to show.
  const sheetOpen = model.visible && hasOptions && (sheetWanted || submenuOpen);
  // A page opened by any route counts as asking for the sheet, so it stays
  // up when that page later folds (the selection changed) and lands the next
  // selection on its remembered tab.
  useEffect(() => {
    if (submenuOpen) setSheetWanted(true);
  }, [submenuOpen]);

  // True while a page's popover sheet (the Text page's font list, the Tint
  // page's blend list — scrollable) is open. The sheet's pan responder reads
  // this to stand down, so dragging to scroll the list isn't mistaken for a
  // downward dismiss swipe. Reset on every page change so it can't linger
  // true over a different page.
  const fontSheetOpenRef = useRef(false);

  /** True while `key`'s page is the one showing — lights that tab. */
  const subOpen = (key: SubmenuKey) => activeSub === key;

  /** The page a vector option opens. svgEdit's action names match the page
   *  keys except where the panel has to disambiguate — a shape's `fill` is the
   *  svgFill page, not an image's Tint. Named because both the press handler
   *  and the lit state need it, and they must agree. */
  const svgActionSubmenu = (action: string): SubmenuKey =>
    action === 'fill' ? 'svgFill'
    : action === 'pattern' ? 'svgPattern'
    : action === 'shape' ? 'shape'
    : action === 'effects' ? 'effects'
    : action === 'endpoints' ? 'endpoints'
    : action === 'opacity' ? 'opacity'
    : action === 'transform' ? 'transform'
    : 'stroke';

  /** Pages a HOST opens with chrome of its own, which no tab row ever
   *  offers: a rig's part sliders (Hands / Feet / Spine / Head — the row
   *  carries none of them, see RIG_PAGES) and the pattern capsule's
   *  Tiles and Tools bars. The fold-away rule reads the tab row, so these
   *  have to be named: they are not the row's to take away, and a rule that
   *  closed them would shut the capsule's own bar the frame it opened. */
  const isHostOnlyPage = (key: SubmenuKey): boolean =>
    key === 'patternTiles' || key === 'patternTools'
    || (rigPartOfSubmenu(key) != null && key !== 'rigRoot');

  const openSubmenu = (key: SubmenuKey) => {
    fontSheetOpenRef.current = false;
    // One page at a time, and the PANEL is what holds to that: an open
    // closes every other page first, then opens the one asked for. It used
    // to close only its OWN pages (Color, Shape) and leave each host page
    // to close its siblings, and the hosts' lists disagreed — every
    // open-change handler named a few neighbours by hand and none of them
    // named all. A page left open that `activeSub` ranks ABOVE the one just
    // opened keeps winning that chain, so the pressed tab lit nothing and
    // the well never changed: a text that had been through Copies left
    // `transformOpen` set, which outranks the text pages, and Text / Font /
    // Spacing / Align were pressable and dead until the selection changed.
    // Closing everything here makes the ranking a tie-break with no tie
    // left to break.
    setLocalSub(isLocalSubmenu(key) ? key : null);
    dismissHostSubmenus();
    if (isLocalSubmenu(key)) return;
    if (key === 'crop') model.onCropOpenChange?.(true);
    else if (key === 'effects' || EFFECT_OF_PAGE[key]) {
      // The Effects page and the three it creates ride one host flag; the
      // page state picks which shows (the text pages' arrangement).
      setEffectsPage(key);
      model.onEffectsOpenChange?.(true);
    }
    else if (key === 'border') model.onBorderOpenChange?.(true);
    else if (key === 'opacity') model.onOpacityOpenChange?.(true);
    else if (key === 'stroke') model.onStrokeOpenChange?.(true);
    else if (key === 'svgFill') model.onSvgFillOpenChange?.(true);
    else if (key === 'svgPattern') model.onSvgPatternOpenChange?.(true);
    else if (key === 'endpoints') model.onEndpointsOpenChange?.(true);
    else if (key === 'transform') model.onTransformOpenChange?.(true);
    else if (key === 'layout') model.onLayoutOpenChange?.(true);
    else if (rigPartOfSubmenu(key)) model.onRigPartOpenChange?.(rigPartOfSubmenu(key));
    else if (patternActionOfSubmenu(key)) model.onPatternBarOpenChange?.(patternActionOfSubmenu(key));
    else if (key === 'text' || key === 'font' || key === 'spacing' || key === 'align') {
      // The text pages ride the single textStyleOpen flag; the page state
      // picks which one shows.
      setTextPage(key);
      model.onTextStyleOpenChange?.(true);
    }
  };
  const dismissHostSubmenus = () => {
    model.onEffectsOpenChange?.(false);
    model.onBorderOpenChange?.(false);
    model.onCropOpenChange?.(false);
    model.onOpacityOpenChange?.(false);
    model.onStrokeOpenChange?.(false);
    model.onSvgFillOpenChange?.(false);
    model.onSvgPatternOpenChange?.(false);
    model.onEndpointsOpenChange?.(false);
    model.onTransformOpenChange?.(false);
    model.onLayoutOpenChange?.(false);
    model.onTextStyleOpenChange?.(false);
    model.onRigPartOpenChange?.(null);
    model.onPatternBarOpenChange?.(null);
  };
  const dismissSubmenu = () => {
    fontSheetOpenRef.current = false;
    setLocalSub(null);
    dismissHostSubmenus();
  };
  // The fold-away rule runs in an effect and must read the CURRENT page,
  // row and closer — all three are rebuilt every render, and listing them
  // as deps would either re-run it every render or stale it.
  const activeSubRef = useRef<SubmenuKey | null>(null);
  activeSubRef.current = activeSub;
  const orderRef = useRef<SubmenuKey[]>(submenuOrder);
  orderRef.current = submenuOrder;
  const dismissSubmenuRef = useRef<() => void>(() => {});
  dismissSubmenuRef.current = dismissSubmenu;

  // The page the sheet last showed — what the sheet keeps rendering through
  // its slide down (activeSub goes null the instant it closes, but the well
  // should stay filled while it drops), and the tab the next selection lands
  // on when it has that page too (landingSubmenu).
  const lastSubRef = useRef<SubmenuKey | null>(null);
  if (activeSub) lastSubRef.current = activeSub;
  // What the well holds. While the sheet is UP with no page yet — the frame
  // between asking for the sheet and the landing effect's page arriving,
  // which for a host-owned page is a whole render — it shows the page it is
  // ABOUT to land on rather than nothing. Otherwise the sheet was measured
  // at its bare tab-row height for that frame and rose to it, then grew in a
  // second motion once the page landed. Through the slide DOWN it keeps the
  // page it last showed, so the well doesn't empty as it goes.
  const displaySub: SubmenuKey | null = activeSub
    ?? (sheetOpen ? landingSubmenu(submenuOrder, lastSubRef.current) : lastSubRef.current);
  /** The effect whose CONTROLS are showing — null on the Effects page
   *  itself (its buttons belong to all three) and on every other page. The
   *  shadow stands in where nothing is showing, so the values below are
   *  always something coherent. */
  const shownEffect: EffectKind | null = displaySub ? (EFFECT_OF_PAGE[displaySub] ?? null) : null;
  const effectKind: EffectKind = shownEffect ?? 'shadow';

  /** Pop the sheet up. Asking is ALL it does: the landing effect below sees
   *  a sheet with no page and opens the tab it lands on (the remembered one
   *  when this selection has it, else the first page).
   *
   *  That effect is the single way in, which is the point — this used to
   *  land the page itself, so the edit dot ran one path and the host's own
   *  Edit button (model.editOpen, which only sets the flag) ran another,
   *  and the two could disagree about what came up. */
  const openSheet = () => setSheetWanted(true);
  openSheetRef.current = openSheet;
  /** Drop the sheet: no page open, and none asked for. */
  const closeSheet = () => {
    setSheetWanted(false);
    dismissSubmenu();
  };
  const closeSheetRef = useRef<() => void>(() => {});
  closeSheetRef.current = closeSheet;

  // A sheet that is up with no page showing lands on one: the selection
  // changed and the old page folded (the fold-aways below), or the page the
  // host had open went away. A selection with no pages at all (every tab an
  // action) stays as its tabs alone.
  const landingRef = useRef<() => void>(() => {});
  landingRef.current = () => {
    const last = lastSubRef.current;
    // An EFFECT page that has gone — its effect was just removed, or this
    // selection doesn't wear it — lands on Effects: the page that makes
    // those tabs, and the one place the effect can be brought back. The
    // shared rule would drop it on the row's FIRST tab instead, which for
    // an image is Crop, nowhere near what was being worked on.
    const target = last && EFFECT_OF_PAGE[last] && !submenuOrder.includes(last)
      && submenuOrder.includes('effects')
      ? ('effects' as SubmenuKey)
      : landingSubmenu(submenuOrder, last);
    if (target) openSubmenu(target);
  };
  useEffect(() => {
    if (sheetOpen && !submenuOpen) landingRef.current();
    // The landing reads the current order through the ref; it keys on the
    // sheet being up without a page, and on the selection changing under it.
  }, [sheetOpen, submenuOpen, typeSig]);

  // Every page folds away with the panel — and the sheet with it.
  useEffect(() => {
    if (!model.visible) closeSheetRef.current();
  }, [model.visible]);

  // ── The sheet's rise, fall and resize ────────────────────────────────
  // `sheetY` is the vertical slide (its own height = fully below the screen
  // edge), `sheetH` the animated height between pages. Both ride the JS
  // driver: height can't ride the native one, and mixing drivers on one node
  // lets the native side overwrite the JS side's props. The editor runs as
  // the web bundle, where the native driver is a no-op anyway.
  const [sheetMounted, setSheetMounted] = useState(false);
  const sheetY = useRef(new Animated.Value(0)).current;
  const sheetH = useRef(new Animated.Value(0)).current;
  const prevSheetOpen = useRef(false);

  const sheetPan = useRef(
    PanResponder.create({
      // Claim a clearly-downward drag (dismiss) — never while a popover list
      // is open, so scrolling it isn't hijacked as a dismiss swipe, and never
      // while a slider is taking a value (see logic/slider's drag guard). A
      // sideways drag is left alone: the tab row scrolls with it, and there
      // is no page carousel to fling.
      onMoveShouldSetPanResponder: (_e, g) =>
        !fontSheetOpenRef.current && !isValueDragging() &&
        g.dy > 10 && g.dy > Math.abs(g.dx) * 1.5,
      onPanResponderMove: (_e, g) => { sheetY.setValue(Math.max(0, g.dy)); },
      onPanResponderRelease: (_e, g) => {
        if (swipeDismissDirection(g.dy) === 1) closeSheetRef.current();
        else Animated.spring(sheetY, { toValue: 0, useNativeDriver: false, bounciness: 0 }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(sheetY, { toValue: 0, useNativeDriver: false, bounciness: 0 }).start();
      },
    }),
  ).current;

  // ── The one fold-away rule ──────────────────────────────────────────
  //
  // A page closes the moment the TAB ROW stops offering it — read off
  // `submenuOrder` itself, the very list the row is built from — or the
  // panel hides. One rule, one source, for every page the row can hold:
  // the host's, the panel's own, effect pages and type pages alike.
  //
  // It used to be six effects, each with its own hand-written answer to
  // "can this selection still use this page?", and those answers drifted
  // from the row's. That drift is not a cosmetic bug, it is a LOOP: the
  // row offers a page, the user taps it, the fold-away closes it for not
  // being offered, the landing rule below reopens the remembered page
  // because the row says it is there, and the tab flickers on and off for
  // as long as it is looked at. It happened to Copies on a text, and
  // again to Opacity on a pattern the day the pattern grew an Opacity tab
  // — the tab row was told and this rule was not. Derived from the row, a
  // disagreement is no longer sayable.
  useEffect(() => {
    if (!activeSubRef.current) return;
    if (model.visible
      && (isHostOnlyPage(activeSubRef.current) || orderRef.current.includes(activeSubRef.current))) {
      return;
    }
    dismissSubmenuRef.current();
    // The refs carry the current reading; the keys below are what CHANGES
    // it — the panel's visibility, which page is open, and the row itself
    // (by value, since it is rebuilt every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.visible, activeSub, submenuOrder.join('|')]);

  // Seed the effect / border drafts from the current effects each time the
  // controls open. One seed for the whole Effects family: its four pages
  // share the flag, so moving between them keeps whatever was dragged.
  useEffect(() => {
    if (model.effectsOpen && !prevEffectsOpen.current) {
      setShadowDraft(model.shadow ?? DEFAULT_SHADOW_MODEL);
      setGlowDrafts({
        outer: model.glows?.outer ?? DEFAULT_GLOW_MODEL,
        inner: model.glows?.inner ?? DEFAULT_GLOW_MODEL,
      });
    }
    prevEffectsOpen.current = !!model.effectsOpen;
  }, [model.effectsOpen, model.shadow, model.glows]);
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
      // Seeded from the app, which reports the object's CURRENT opacity and
      // fade (defaults resolved), so Opacity opens where the object is.
      //
      // FADE opens at the left instead, always. It is a walk from the colour
      // the object draws in to the target, and once it has been walked the
      // object's colour IS the far end of the last walk: a slider still
      // sitting at 0.6 would be pointing at a journey already made, over a
      // track whose near end is where the object ended up. So the page
      // re-bases — the number here is how much FURTHER from here, and the
      // track ramps from here.
      //
      // The host spends a fade into the object's colours rather than
      // storing one (engine/fadeBake.ts), so `open.fade` is 0 and there is
      // nothing to compose with: the object's colour after a spend simply
      // IS where the last walk ended, which is what makes "open at the
      // left" the whole of the rule. fadeBaseRef stands for a host that
      // still reports a standing fade — composing with it is exact either
      // way (see applyOpacity).
      const open = model.objectOpacity ?? DEFAULT_OPACITY_MODEL;
      fadeBaseRef.current = open.fade;
      setOpacityDraft({ ...open, fade: 0 });
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
      // default one when it has never been filled, so the page opens on
      // something coherent rather than on an empty gradient.
      setSvgFillDraft(model.svgFill ?? DEFAULT_TINT_MODEL);
    }
    prevSvgFillOpen.current = !!model.svgFillOpen;
  }, [model.svgFillOpen, model.svgFill]);

  // Each handle rests on what the shape carries the moment that changes —
  // the commit's own echo, and a selection that moved to a differently
  // sized pattern (a stale draft would otherwise show the last shape's
  // number over this one's tile). One effect per row, keyed on its own
  // quantity: the two are independent, so a Size commit must not throw
  // away a Resolution drag in flight.
  useEffect(() => {
    setSvgPatternSizeDraft(null);
  }, [model.svgPatternSize, model.svgPatternPresent]);
  useEffect(() => {
    setSvgPatternSpanDraft(null);
  }, [model.svgPatternSpan, model.svgPatternPresent]);
  useEffect(() => {
    setSvgPatternStrokeDraft(null);
  }, [model.svgPatternPresent]);
  // Shadow controls → live preview / commit through the model; the draft stays
  // in sync so the sliders keep tracking.
  const applyShadow = (s: ShadowModel, committed: boolean) => {
    setShadowDraft(s);
    model.onShadow?.(s, committed);
  };
  // Glow controls → the same live preview / commit, told which of the two
  // it is. One path for both: they differ in which way the light goes and
  // in nothing else.
  const applyGlow = (kind: GlowKind, g: GlowModel, committed: boolean) => {
    setGlowDrafts((d) => ({ ...d, [kind]: g }));
    model.onGlow?.(kind, g, committed);
  };
  /** Take an effect off the object — from its own page's Remove line, or by
   *  pressing its (lit) button on the Effects page.
   *
   *  Its tab goes with it, so the sheet lands back on Effects: the page that
   *  makes these tabs, where the press came from in one case and where the
   *  effect can be put back in both. (Setting the page here is what makes
   *  that immediate; the landing rule above is the backstop for a tab that
   *  goes some other way.) */
  const removeEffect = (kind: EffectKind) => {
    if (kind === 'shadow') model.onShadow?.(null, true);
    else model.onGlow?.(kind, null, true);
    setEffectsPage('effects');
  };
  /** The Effects page's buttons: one press each way.
   *
   *  Adding OPENS the new tab at once — it is the tab the press just made,
   *  and the thing it was made to edit is sitting on it. The face's draft is
   *  dropped on the way: it was seeded on the ABSENT effect, and the
   *  controls that come up should read the freshly created one off the
   *  model (the Stroke page's Add does the same). */
  const toggleEffect = (kind: EffectKind, add: boolean) => {
    if (!add) { removeEffect(kind); return; }
    if (kind === 'shadow') {
      setShadowDraft(null);
      model.onAddShadow?.();
    } else {
      setGlowDrafts((d) => ({ ...d, [kind]: undefined }));
      model.onAddGlow?.(kind);
    }
    openSubmenu(EFFECT_PAGE[kind]);
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

  // Stroke controls → live preview / commit; same pattern as Border. Remove
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

  // The PATTERN's line — the same two rows and the same hue row, pointed
  // at the tiles instead of at the outline around them. Its own draft, so
  // a drag here cannot be read back as the shape's.
  const applySvgPatternStroke = (b: BorderModel, committed: boolean) => {
    setSvgPatternStrokeDraft(b);
    model.onSvgPatternStroke?.(b, committed);
  };

  // Crop controls → live preview / commit; the draft owns the tracked params
  // (there's no external color).
  const applyFraming = (f: FramingModel, committed: boolean) => {
    setCropDraft(f);
    model.onFraming?.(f, committed);
  };

  // Opacity controls → live preview / commit; the draft owns both sliders
  // (the Fade target comes from the model). No Remove: opacity is not a layer
  // an object can be without — every object has one — so the sliders are the
  // whole page.
  //
  // The draft's `fade` is RELATIVE to where the page opened (see the seed
  // effect): the slider says how much further from the object's current
  // colour toward the target. A fade is a linear mix, so a standing one
  // composes with it exactly — mix(mix(c, T, b), T, t) = mix(c, T,
  // b + t(1 − b)) — and with the host spending its fades (b = 0) this is
  // simply the number the slider shows.
  //
  // Either way the amount is relative to the colours the page OPENED on,
  // which is the contract the host applies it under: it holds that snapshot
  // for as long as the page is up, so dragging back to the left leaves the
  // object precisely where it was.
  const applyOpacity = (o: OpacityModel, committed: boolean) => {
    setOpacityDraft(o);
    model.onObjectOpacity?.({ ...o, fade: composeFade(fadeBaseRef.current, o.fade) }, committed);
  };

  // Text style → live preview / commit; the draft owns the tracked params, so
  // the sliders keep tracking (color comes from the model).
  const applyTextStyle = (s: TextStyleModel, committed: boolean) => {
    setTextDraft(s);
    model.onTextStyle?.(s, committed);
  };

  // Shape fill → live preview / commit against the shape's own fill: the
  // draft owns the tracked params (type, stop positions, angle, opacity,
  // blend, selection) while colors (solid + per-stop) come from the model,
  // changed externally via the full-screen picker — same split as the
  // effect pages' colors.
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
  // Params tracked by the sliders/pad come from the local draft; color comes
  // from the model (it's changed externally, via the full-screen picker).
  const shadowForBar: ShadowModel = shadowDraft
    ? { ...shadowDraft, color: model.shadow?.color ?? shadowDraft.color }
    : (model.shadow ?? DEFAULT_SHADOW_MODEL);
  // …and the same reading for the showing GLOW, lifted into the shadow's
  // shape so the page has one set of rows to render. A glow has no offset,
  // so the pad's two numbers are zeroed rather than carried: nothing on a
  // glow face can write them, and a stale pair riding through would land on
  // the shadow the moment the chooser went back.
  const glowForBar = (kind: GlowKind): ShadowModel => {
    const draft = glowDrafts[kind];
    const live = model.glows?.[kind];
    const g = draft
      ? { ...draft, color: live?.color ?? draft.color }
      : (live ?? DEFAULT_GLOW_MODEL);
    return { ...g, dx: 0, dy: 0 };
  };
  /** The showing effect, as the one set of rows reads it. */
  const effectForBar: ShadowModel = effectKind === 'shadow'
    ? shadowForBar
    : glowForBar(effectKind);
  /** Whether the host has the showing effect's colour to write — what the
   *  hue row is gated on, and what the sheet's height is counted with. */
  const effectColorWritable = effectKind === 'shadow'
    ? !!model.onShadowColor && !!model.onPickShadowColor
    : !!model.onGlowColor && !!model.onPickGlowColor;
  /** One write for whichever effect is showing: the three pages are the same
   *  rows, so they edit through one callback and this is where it forks. */
  const applyEffect = (s: ShadowModel, committed: boolean) => {
    if (effectKind === 'shadow') { applyShadow(s, committed); return; }
    const { dx: _dx, dy: _dy, ...glow } = s;
    applyGlow(effectKind, glow, committed);
  };
  const borderForBar: BorderModel = borderDraft
    ? { ...borderDraft, color: model.border?.color ?? borderDraft.color }
    : (model.border ?? DEFAULT_BORDER_MODEL);
  const framingForBar: FramingModel = cropDraft ?? model.framing ?? DEFAULT_FRAMING_MODEL;
  // The Fade target is the one value on this page the draft must NOT own: it
  // is picked in the full-screen colour picker, which leaves the page open,
  // so a draft seeded before the pick would keep answering with the colour
  // the page opened on (white) and the next slider drag would write that
  // stale target straight back over the picked one. Same split the shadow's,
  // the border's and the stroke's colours keep — sliders from the draft,
  // colour from the model.
  // The Fade track's NEAR end: the object's own ink, stood where the page
  // OPENED it — the ink mixed by the fade it already carried, toward the
  // target as it stands now. Frozen at the open, not followed live, because
  // the track is the scale the thumb points into: a near end that chased the
  // drag would slide the ground out from under the thumb on every frame. It
  // is computed rather than reported so a target re-picked mid-page (the
  // trailing circle's job, which leaves the page open) moves it correctly —
  // only the raw ink and the current target can say where a standing fade
  // has landed.
  const fadeTarget = model.objectOpacity?.fadeColor ?? DEFAULT_OPACITY_MODEL.fadeColor;
  const fadeInk = model.objectOpacity?.fadeInk;
  const fadeFrom = fadeInk ? fadeMix(fadeInk, fadeTarget, fadeBaseRef.current) : undefined;
  const opacityForBar: OpacityModel = opacityDraft
    ? {
        ...opacityDraft,
        fadeColor: model.objectOpacity?.fadeColor ?? opacityDraft.fadeColor,
      }
    // Before the seed effect has run — one frame, on the open — the fade
    // still reads at the left, because that is where this page's slider
    // always starts.
    : { ...(model.objectOpacity ?? DEFAULT_OPACITY_MODEL), fade: 0 };
  const strokeForBar: BorderModel = strokeDraft
    ? { ...strokeDraft, color: model.stroke?.color ?? strokeDraft.color }
    : (model.stroke ?? DEFAULT_BORDER_MODEL);
  // …and the pattern's, on the same rule: tracked params from the draft,
  // the colour from the model (the full-screen picker writes it).
  const svgPatternStrokeForBar: BorderModel = svgPatternStrokeDraft
    ? {
      ...svgPatternStrokeDraft,
      color: model.svgPatternStroke?.color ?? svgPatternStrokeDraft.color,
    }
    : (model.svgPatternStroke ?? DEFAULT_BORDER_MODEL);
  // Tracked type params come from the draft; color comes from the model (the
  // full-screen picker changes it externally, like the effect pages' colors).
  const textForBar: TextStyleModel = textDraft
    ? { ...textDraft, color: model.textStyle?.color ?? textDraft.color }
    : (model.textStyle ?? DEFAULT_TEXT_STYLE_MODEL);
  // Tracked tint params from the draft; the solid + per-stop colors come
  // from the model (the full-screen picker edits them externally). Stops
  // are matched by index — add / delete commit immediately, so the counts
  // stay aligned.
  const svgFillForBar: TintModel = svgFillDraft
    ? {
        ...svgFillDraft,
        solid: model.svgFill?.solid ?? svgFillDraft.solid,
        stops: svgFillDraft.stops.map((s, i) => ({ ...s, color: model.svgFill?.stops[i]?.color ?? s.color })),
      }
    : (model.svgFill ?? DEFAULT_TINT_MODEL);

  // The showing page and, for a page whose effect can be removed, its Remove
  // line — built together, because an ABSENT effect renders as the Add page
  // (EmptyEffectBar) with nothing to remove yet: opening a menu must never
  // edit the object, so the effect exists only once its Add button is
  // pressed — the host materializes it, presence flips, and the real
  // controls (and Remove) swap in here. `addPage` says the well holds that
  // one button, so the sheet is sized to it rather than to the controls.
  let activeBarEl: React.ReactNode = null;
  let removeAction: { label: string; onPress: () => void } | undefined;
  let addPage = false;
  if (displaySub === 'background') {
    // A frame's own fill, on the one row that says it. The colour comes off
    // the model (the picker behind the trailing circle changes it externally),
    // so the row is fed by what the frame actually wears.
    activeBarEl = (
      <BarBody>
        <ColorSliderRow
          label="Background"
          color={model.frameBackgroundColor ?? DEFAULT_ROW_COLOR}
          onColor={(color, committed) => model.onFrameBackgroundColor?.(color, committed)}
          onOpenPicker={() => model.onPickFrameBackground?.()}
        />
      </BarBody>
    );
  } else if (displaySub === 'card') {
    // A word sticker's card scheme: light card / dark ink, or the inverse.
    // A flip, not a hue — so it is the page's one ACT, and it wears the
    // button the effect pages give theirs (EffectButton), not a lit chip
    // on a darkened row. The row said "this is a setting, and it is
    // currently off" about a thing that has no off: a magnet is one
    // scheme or the other, and either is a whole answer.
    activeBarEl = (
      <BarBody>
        <EffectButton label="Invert" icon="invert-colors" onPress={() => model.onInvert?.()} />
      </BarBody>
    );
  } else if (displaySub === 'shape') {
    // A polygonal shape's corner Radius — the host's strokeRadius plumbing,
    // which it used to reach as a Stroke row.
    activeBarEl = (
      <ShapeBar
        cornerRadius={model.strokeRadius ?? 0}
        onCornerRadius={(r, committed) => model.onStrokeRadius?.(r, committed)}
      />
    );
  } else if (displaySub === 'stroke' && model.strokePresent === false && model.onAddStroke) {
    addPage = true;
    activeBarEl = (
      <EmptyEffectBar
        addLabel="Add Stroke"
        // The draft was seeded when the page opened — on the ABSENT stroke
        // (width 0) — so drop it as the Add lands: the controls that swap
        // in read the freshly created stroke off the model instead of
        // showing a Width slider parked at zero.
        onAdd={() => { setStrokeDraft(null); model.onAddStroke?.(); }}
      />
    );
  } else if (displaySub === 'svgFill' && model.svgFillPresent === false && model.onAddSvgFill) {
    addPage = true;
    activeBarEl = <EmptyEffectBar addLabel="Add Fill" onAdd={() => model.onAddSvgFill?.()} />;
  } else if (displaySub === 'svgPattern' && model.svgPatternPresent === false && model.onAddSvgPattern) {
    addPage = true;
    activeBarEl = <EmptyEffectBar addLabel="Add Pattern" onAdd={() => model.onAddSvgPattern?.()} />;
  } else if (displaySub === 'border' && model.borderPresent === false && model.onAddBorder) {
    addPage = true;
    activeBarEl = <EmptyEffectBar addLabel="Add Border" onAdd={() => model.onAddBorder?.()} />;
  } else if (displaySub === 'svgFill') {
    // The Tint page retitled, pointed at the closed shape's own interior.
    // Solid-only: a shape's fill is always one flat color, so the page drops
    // its Type control and the gradient rows.
    activeBarEl = (
      <TintBar
        solidOnly
        tint={svgFillForBar}
        // The fill's own colour, above its Opacity. This page is called Fill
        // and could not set one: its swatch had gone to a shared Color page,
        // leaving an Opacity slider alone under the name of the thing it
        // could not colour.
        onColor={model.onSvgFillColor ? (color, committed) => model.onSvgFillColor?.(color, committed) : undefined}
        onChange={(t) => applySvgFill(t, false)}
        onCommit={(t) => applySvgFill(t, true)}
        onPickColor={() => model.onPickSvgFillColor?.()}
        onAddStop={addSvgFillStop}
        onSheetOpenChange={(open) => { fontSheetOpenRef.current = open; }}
      />
    );
    removeAction = { label: 'Remove fill', onPress: removeSvgFill };
  } else if (displaySub === 'svgPattern') {
    // How FINELY one repeat is cut — the tile is square, so the row reads
    // "2×2" — over the one act that opens it: the tiles themselves are
    // painted ON THE CANVAS, inside the shape. While that tile IS open the
    // button has nothing left to do and goes away.
    //
    // Called RESOLUTION, not Size: more cells per edge is a denser tile,
    // not a bigger one. (Size is how big the repeat draws, which is the
    // row below.)
    //
    // The slider keeps its own handle (svgPatternSizeDraft) and commits on
    // release: a change re-rolls the cells the finer tile exposes, which
    // is one undo step, not sixty a second.
    const editing = !!model.svgPatternEditing;
    const size = svgPatternSizeDraft
      ?? model.svgPatternSize ?? DEFAULT_SVG_PATTERN_SIZE;
    const span = svgPatternSpanDraft
      ?? model.svgPatternSpan ?? DEFAULT_SVG_PATTERN_SPAN;
    activeBarEl = (
      <BarBody>
        {/* The page's three sections, under the tab rather than beside it:
            the tile is one thing with several questions about it — how big
            a repeat is, what mirror it is painted under, what line it is
            drawn in. (A pattern OBJECT asks them as tabs of its own, having
            no other property pages to share a row with.) They head the well
            as one solid line rather than sitting in it as a control: they
            say which properties you are looking at, not what any property
            is. */}
        <SectionTabs
          options={SVG_PATTERN_SECTIONS}
          value={svgPatternSection}
          onChange={setSvgPatternSection}
        />
        {svgPatternSection === 'symmetry' ? (
          <PatternSymmetryGrid
            value={model.svgPatternSymmetry ?? 'off'}
            onPick={(key) => model.onSvgPatternSymmetry?.(key)}
          />
        ) : svgPatternSection === 'stroke' ? (
          // The tiles' OWN line: Width, Dash, and the ink they are drawn
          // in — the shape's Stroke page pointed inward. The same
          // component, so the pattern's line is set with the same rows and
          // the same ranges as every other line in the editor.
          //
          // No Position row: alignment asks which side of a path to keep,
          // and the tiles are a mark inside a clip, not an outline around
          // an area. The Remove line stays the PAGE's (it removes the
          // pattern) — a line is not something a pattern can be without.
          <BorderBar
            border={svgPatternStrokeForBar}
            showPosition={false}
            color={svgPatternStrokeForBar.color}
            onColor={model.onSvgPatternStroke
              ? (color, committed) => applySvgPatternStroke(
                { ...svgPatternStrokeForBar, color }, committed,
              )
              : undefined}
            onOpenColorPicker={() => model.onPickSvgPatternStrokeColor?.()}
            onChange={(b) => applySvgPatternStroke(b, false)}
            onCommit={(b) => applySvgPatternStroke(b, true)}
          />
        ) : (
          <>
            <SliderRow
              label="Resolution"
              value={(size - MIN_SVG_PATTERN_SIZE) / (MAX_SVG_PATTERN_SIZE - MIN_SVG_PATTERN_SIZE)}
              apply={(t, committed) => {
                const next = Math.round(
                  MIN_SVG_PATTERN_SIZE + t * (MAX_SVG_PATTERN_SIZE - MIN_SVG_PATTERN_SIZE),
                );
                setSvgPatternSizeDraft(committed ? null : next);
                if (committed) model.onSvgPatternSize?.(next);
              }}
              readout={{
                text: `${size}×${size}`,
                commit: (n) => {
                  setSvgPatternSizeDraft(null);
                  model.onSvgPatternSize?.(Math.round(
                    Math.min(MAX_SVG_PATTERN_SIZE, Math.max(MIN_SVG_PATTERN_SIZE, n)),
                  ));
                },
              }}
            />
            {/* …and how big that repeat DRAWS, under it, in tenths of the
                filled shape's width — 10 is the motif drawn once across
                the whole shape, 1 is ten repeats. The pair is the whole
                of what a tile is: Resolution cuts the repeat finer
                without moving it, Size scales the whole motif without
                re-cutting it, and neither handle moves the other.
                Unlike Resolution this one never re-rolls — the same
                pattern larger is the same pattern — so its handle can be
                swept without spending the cells. */}
            <SliderRow
              label="Size"
              value={(span - MIN_SVG_PATTERN_SPAN) / (MAX_SVG_PATTERN_SPAN - MIN_SVG_PATTERN_SPAN)}
              apply={(t, committed) => {
                const raw = MIN_SVG_PATTERN_SPAN
                  + t * (MAX_SVG_PATTERN_SPAN - MIN_SVG_PATTERN_SPAN);
                const next = Math.round(raw / SVG_PATTERN_SPAN_STEP) * SVG_PATTERN_SPAN_STEP;
                setSvgPatternSpanDraft(committed ? null : next);
                if (committed) model.onSvgPatternSpan?.(next);
              }}
              readout={{
                text: spanText(span),
                commit: (n) => {
                  setSvgPatternSpanDraft(null);
                  model.onSvgPatternSpan?.(
                    Math.min(MAX_SVG_PATTERN_SPAN, Math.max(MIN_SVG_PATTERN_SPAN, n)),
                  );
                },
              }}
            />
            {/* The one act that opens the tile. While it IS open there is
                nothing for the button to do, so the page drops it rather
                than parking an inert "Editing" in the well — the canvas
                already shows the tile is open. */}
            {editing ? null : (
              <EffectButton
                label="Edit Pattern"
                icon="pencil"
                onPress={() => model.onEditSvgPattern?.()}
              />
            )}
          </>
        )}
      </BarBody>
    );
    if (model.onRemoveSvgPattern) {
      removeAction = { label: 'Remove pattern', onPress: () => model.onRemoveSvgPattern?.() };
    }
  } else if (displaySub === 'transform') {
    activeBarEl = (
      <TransformBar
        onCopies={(spec) => model.onTransformCopies?.(spec)}
        onCopiesPreview={(spec) => model.onTransformCopiesPreview?.(spec)}
        section={copiesSection}
        onSection={setCopiesSection}
        // Set an offset and a turn once and every later opening of the page
        // is already dialled to them, on this shape or the next.
        sticky={copiesSticky}
        onSticky={(patch) => setCopiesSticky((s) => rememberedCopies(s, patch))}
        // The Color tab asks where the RUN ends, so it needs to know where
        // the object stands: its own opacity and fade seat both sliders, and
        // a press with neither touched lays copies that look like it.
        // Straight off the model, never the Opacity page's draft — that
        // draft re-bases fade to the left (the page is relative; this tab is
        // absolute), and reading it here would seat the run at zero on an
        // object that is already half faded.
        ink={model.objectOpacity}
        // …and the target it fades toward, which the copies inherit: the
        // circle wears it, its press opens the same picker the Opacity page
        // opens, and the track ramps from the object's authored ink to it.
        fadeColor={model.onPickFadeColor ? fadeTarget : undefined}
        fadeInk={fadeInk}
        onOpenFadePicker={model.onPickFadeColor ? () => model.onPickFadeColor?.() : undefined}
      />
    );
  } else if (displaySub === 'endpoints') {
    activeBarEl = (
      <EndpointsBar
        endpoints={model.endpoints ?? DEFAULT_ENDPOINTS_MODEL}
        onChange={(e) => model.onEndpoints?.(e)}
      />
    );
  } else if (displaySub === 'layout') {
    activeBarEl = (
      <LayoutBar
        onAlign={(edge: AlignEdge) => model.onAlign?.(edge)}
        onGrid={model.onGrid ? () => model.onGrid?.() : undefined}
      />
    );
  } else if (displaySub === 'effects') {
    // Three buttons, one per effect: lit for the ones the object wears, and
    // a press either way. No Remove line — every button IS one.
    activeBarEl = <EffectsBar present={effectWorn} onToggle={toggleEffect} />;
  } else if (shownEffect) {
    const glowKind: GlowKind | null = shownEffect === 'shadow' ? null : shownEffect;
    activeBarEl = (
      <EffectBar
        effect={effectForBar}
        // Only the shadow has somewhere to fall, so only its page brings the
        // XY offset pad; the rows beside it are the same rows either way.
        directional={shownEffect === 'shadow'}
        // The effect's own ink, under Spread: the colour is the EFFECT's, not
        // a field of the draft the sliders keep, so the host writes it down
        // its own path (the one the full picker writes too) and reports it
        // back each move — which is what moves the handle.
        color={effectForBar.color}
        onColor={effectColorWritable
          ? (color, committed) => (glowKind
            ? model.onGlowColor?.(glowKind, color, committed)
            : model.onShadowColor?.(color, committed))
          : undefined}
        onOpenColorPicker={effectColorWritable
          ? () => (glowKind ? model.onPickGlowColor?.(glowKind) : model.onPickShadowColor?.())
          : undefined}
        onChange={(s) => applyEffect(s, false)}
        onCommit={(s) => applyEffect(s, true)}
      />
    );
    removeAction = {
      label: `Remove ${effectLabel(shownEffect).toLowerCase()}`,
      onPress: () => removeEffect(shownEffect),
    };
  } else if (displaySub === 'border') {
    activeBarEl = (
      <BorderBar
        border={borderForBar}
        // Inside / Center / Outside name themselves, so the row keeps no
        // label column — the same reading the Stroke page's has always
        // taken, and the only page that still spelled "Position" out.
        labelPosition={false}
        // …and the border's colour, on the same rule as the Stroke page's below.
        color={borderForBar.color}
        onColor={model.onBorderColor ? (color, committed) => model.onBorderColor?.(color, committed) : undefined}
        onOpenColorPicker={model.onPickBorderColor ? () => model.onPickBorderColor?.() : undefined}
        onChange={(b) => applyBorder(b, false)}
        onCommit={(b) => applyBorder(b, true)}
      />
    );
    removeAction = { label: 'Remove border', onPress: removeBorder };
  } else if (displaySub === 'stroke') {
    // The Border page pointed at the vector object's own stroke, with the
    // rows this subtype has no answer for dropped (svgStrokeRows). Never a
    // Radius row — a shape's corners round on its Shape page — and the
    // Position row's cells name themselves, so no label column.
    const rows = svgStrokeRows(model.svgSubtype ?? 'stroke');
    activeBarEl = (
      <BorderBar
        border={strokeForBar}
        showPosition={rows.position}
        labelPosition={false}
        // The line's colour reads HERE now, under Dash, rather than as a
        // row of the shared Color page a tab away: it is part of the
        // stroke's own model, so the hue row commits down the same path
        // every other row on this page does.
        // The colour is the OBJECT's ink, not a field of the stroke the
        // other rows draft — the host writes it down its own path (the one
        // the full-screen picker writes too), and the model reports it back
        // each move, which is what moves the handle.
        color={strokeForBar.color}
        onColor={model.onStrokeColor ? (color, committed) => model.onStrokeColor?.(color, committed) : undefined}
        onOpenColorPicker={() => model.onPickStrokeColor?.()}
        onChange={(b) => applyStroke(b, false)}
        onCommit={(b) => applyStroke(b, true)}
      />
    );
    // …and only a CLOSED shape can lose its stroke: an open path IS its
    // stroke, so Remove there would leave an invisible object you can still
    // select and drag (svgStrokeRemovable).
    if (svgStrokeRemovable(model.svgSubtype ?? 'stroke')) {
      removeAction = { label: 'Remove stroke', onPress: removeStroke };
    }
  } else if (displaySub === 'rigJoints') {
    // The rig page whose two faces are one box with tabs — the Copies
    // page's shape, because Left and Right are one setting asked twice and
    // elbows and knees are the same question about a different pair of
    // chains. Same slider plumbing as every other rig page beneath it.
    activeBarEl = (
      <RigJointsBar
        section={jointSection}
        onSection={setJointSection}
        values={model.rigSliders ?? restRigSliders()}
        onChange={(key, v) => model.onRigSlider?.(key, v, false)}
        onCommit={(key, v) => model.onRigSlider?.(key, v, true)}
      />
    );
  } else if (displaySub === 'rigFigure') {
    // The rig as an OBJECT: the one act said about the whole figure rather
    // than about a posture. Reset stands it back up — rest pose, facing
    // front, every slider at rest — and wears the filled button an "Add
    // Fill" wears, because it is the same kind of thing: a page whose whole
    // content is one act. It sat at the foot of the Transform page as a
    // one-cell ActionRow, which is the shape the pages use for CHOOSING
    // between states and read as a setting with a single option.
    activeBarEl = (
      <BarBody>
        {model.onResetRig ? (
          <EffectButton label="Reset" icon="restore" onPress={() => model.onResetRig?.()} />
        ) : null}
      </BarBody>
    );
  } else if (displaySub && rigPartOfSubmenu(displaySub)) {
    activeBarEl = (
      <RigPoseBar
        part={rigPartOfSubmenu(displaySub)!}
        values={model.rigSliders ?? restRigSliders()}
        onChange={(key, v) => model.onRigSlider?.(key, v, false)}
        onCommit={(key, v) => model.onRigSlider?.(key, v, true)}
      />
    );
  } else if (displaySub === 'rigColor') {
    // The one rig page that is not a posture: the sketch's two colours.
    // Like every hue row in the panel it writes through the host, which
    // owns both the live preview and the single undo step on release.
    activeBarEl = (
      <RigColorBar
        volumes={model.rigVolumesColor ?? RIG_VOLUMES_DEFAULT}
        outlines={model.rigOutlinesColor ?? RIG_OUTLINES_DEFAULT}
        onColor={(which, color, committed) => model.onRigColor?.(which, color, committed)}
        onOpenPicker={(which) => model.onPickRigColor?.(which)}
      />
    );
  } else if (displaySub === 'opacity') {
    activeBarEl = (
      <OpacityBar
        opacity={opacityForBar}
        fadeFrom={fadeFrom}
        // The Fade row exists exactly when the host can serve its picker,
        // which is how a selection with nothing to fade says so — the same
        // rule the shadow's and the border's colour rows keep.
        showFade={!!model.onPickFadeColor}
        onChange={(o) => applyOpacity(o, false)}
        onCommit={(o) => applyOpacity(o, true)}
        onOpenFadePicker={model.onPickFadeColor ? () => model.onPickFadeColor?.() : undefined}
      />
    );
  } else if (displaySub === 'image') {
    activeBarEl = (
      <ImageBar
        cornerRadius={model.cornerRadius ?? 0}
        onCornerRadius={(r, committed) => model.onCornerRadius?.(r, committed)}
        // Straight out of the press: the host opens a file picker, and
        // WebKit only shows the dialog while the gesture's activation lives.
        onReplace={() => model.onReplaceImage?.()}
      />
    );
  } else if (displaySub === 'crop') {
    activeBarEl = (
      <CropBar
        framing={framingForBar}
        onChange={(f) => applyFraming(f, false)}
        onCommit={(f) => applyFraming(f, true)}
      />
    );
  } else if (displaySub === 'patternTile') {
    activeBarEl = <PatternTileBar model={model} />;
  } else if (displaySub === 'patternTiles') {
    activeBarEl = <PatternTilesBar model={model} />;
  } else if (displaySub === 'patternTools') {
    activeBarEl = <PatternToolsBar model={model} />;
  } else if (displaySub === 'patternSymmetry') {
    activeBarEl = <PatternSymmetryBar model={model} />;
  } else if (displaySub === 'text' || displaySub === 'font' || displaySub === 'spacing' || displaySub === 'align') {
    activeBarEl = (
      <TextBar
        page={displaySub}
        style={textForBar}
        fonts={model.fonts ?? []}
        // The ink leads the Text page, above the Size that sets it.
        color={textForBar.color}
        onColor={model.onTextColor ? (color, committed) => model.onTextColor?.(color, committed) : undefined}
        onOpenColorPicker={model.onPickTextColor ? () => model.onPickTextColor?.() : undefined}
        onChange={(s) => applyTextStyle(s, false)}
        onCommit={(s) => applyTextStyle(s, true)}
        onSheetOpenChange={(open) => { fontSheetOpenRef.current = open; }}
      />
    );
  }
  // How tall the sheet stands: its chrome around the showing page's content
  // area — the page's rows counted from the state it will render from, drafts
  // included (switching the Crop mode genuinely swaps its rows, and the sheet
  // resizes to hold them), or the one Add button of an absent effect — plus
  // the Remove line when the page has one. The page shown through the slide
  // down (displaySub) keeps its height, so the sheet drops as it stood.
  const contentHeight = !displaySub ? null : addPage ? emptyEffectHeight() : submenuHeight(displaySub, {
    cropMode: framingForBar.mode,
    // …counted exactly where the page will render it, on that same rule.
    opacityFade: !!model.onPickFadeColor,
    // Every hue row is counted exactly where its page will render it — the
    // page grows by a slider row when the host has that colour to write.
    svgFillColor: !!model.onSvgFillColor,
    // …and the Pattern page by the section showing: a mirror grid stands
    // two rows of square buttons where the tile's own section is a slider
    // and a button.
    svgPatternSection,
    effectColor: effectColorWritable,
    textColor: !!model.onTextColor && !!model.onPickTextColor,
    // The image / frame border offers every row; a vector's stroke drops the
    // ones its subtype has no answer for.
    borderRows: {
      position: true,
      color: !!model.onBorderColor && !!model.onPickBorderColor,
    },
    strokeRows: {
      ...svgStrokeRows(model.svgSubtype ?? 'stroke'),
      color: !!model.onStrokeColor,
    },
    // The Layout page grows an Arrange row exactly when the page will render it.
    layoutHasGrid: !!model.onGrid,
    // …and the RIG page its Reset row, on the same rule.
    rigCanReset: !!model.onResetRig,
    // The pattern Tools page grows its Sets row when the host offers a
    // tile-set filter, and its Repeat row on the same rule.
    patternTileSetCount: model.patternTileSets?.length ?? 0,
    patternCanRepeat: !!model.onToggleRepeat,
  });
  const sheetHeight = editSheetHeight(contentHeight, { removable: !!removeAction, safeBottom });

  // The target height, readable by the rise and the fall WITHOUT their
  // having to list it as a dependency — see the effect below for why that
  // matters.
  const sheetHeightRef = useRef(sheetHeight);
  sheetHeightRef.current = sheetHeight;

  // Rise on open, drop on close. Keyed on the open flag ALONE.
  //
  // The rise and the resize used to share one effect, with `sheetHeight` in
  // its deps, and that made the sheet open wrong: a height change re-ran the
  // effect, React ran the previous cleanup first, and the cleanup stopped
  // the rise MID-FLIGHT. `sheetY` froze partway, leaving the sheet pushed
  // down past the screen edge with only its tab row showing — which is
  // exactly what a height change does the moment the sheet opens, since the
  // page lands a render after the flag (the host owns most pages' open
  // state, so its answer arrives on the next pass).
  useEffect(() => {
    if (sheetOpen && !prevSheetOpen.current) {
      prevSheetOpen.current = true;
      setSheetMounted(true);
      sheetH.setValue(sheetHeightRef.current);
      sheetY.setValue(sheetHeightRef.current);
      const anim = Animated.timing(sheetY, { toValue: 0, duration: PANEL_ANIM_MS, useNativeDriver: false });
      anim.start();
      return () => anim.stop();
    }
    if (!sheetOpen && prevSheetOpen.current) {
      prevSheetOpen.current = false;
      const anim = Animated.timing(sheetY, { toValue: sheetHeightRef.current, duration: PANEL_ANIM_MS, useNativeDriver: false });
      anim.start(({ finished }) => { if (finished) setSheetMounted(false); });
      return () => anim.stop();
    }
    return undefined;
  }, [sheetOpen, sheetH, sheetY]);

  // …and the lift over the keyboard: a page's value field summons one, and
  // a bottom-anchored sheet would sit behind it. `keyboardY` rides alongside
  // the slide rather than replacing it, so a dismissing swipe still reads
  // the sheet's own travel while the lift holds. It is animated (rather than
  // set straight from the inset) because the host measures the keyboard in
  // steps as it comes up, and stepping the sheet after it reads as a stutter.
  const keyboardY = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(keyboardY, {
      toValue: -keyboardInset,
      duration: KEYBOARD_LIFT_MS,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [keyboardInset, keyboardY]);

  // …and, while it is up, the resize between the heights of the pages the
  // tabs switch to: a shorter page pushes the sheet's top edge down, a
  // taller one lifts it. Its own effect, so its cleanup can only ever stop
  // a resize — never the rise above.
  useEffect(() => {
    if (!sheetOpen) return undefined;
    const anim = Animated.timing(sheetH, { toValue: sheetHeight, duration: PANEL_ANIM_MS, useNativeDriver: false });
    anim.start();
    return () => anim.stop();
  }, [sheetOpen, sheetHeight, sheetH]);

  // Bottom-edge occlusion report — see the prop doc. The sheet covers the
  // panel while it is up, so the two never add.
  const occludedPx = !model.visible ? 0 : sheetOpen ? sheetHeight : panelBox.height;
  useEffect(() => {
    onOccludedHeight?.(occludedPx);
  }, [onOccludedHeight, occludedPx]);

  if (!mounted) return null;

  // Common actions (rotate / flip / copy / lock / properties / delete, plus
  // the optional group actions).
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
    // …then the way into the type pages: the sheet the row's sideways swipe
    // also raises (openSheet — one opener, so the button and the gesture
    // can't land differently). Absent on a selection with no pages to open
    // — there would be nothing behind it. It briefly stood in Lock's place
    // on the row (2026-09-11), the two sharing one seat; they have a seat
    // each again, Lock to its left.
    ...(hasOptions
      ? [<GridButton key="properties" label="Properties" icon="tune" onPress={openSheet} compact={compact} />]
      : []),
  ];
  // A multi-selection's Group / Merge live in the Edit sheet (tabs, beside
  // Layout), not on this icon row — see showGroup / showMerge.
  if (model.onGroup && !multi) row1.push(<GridButton key="group" label="Group" icon="group" onPress={model.onGroup} compact={compact} />);
  // Frames surface Ungroup among their own tabs (not the common row), so skip
  // it here when the frame options are showing.
  if (model.onUngroup && !model.showFrameOptions && !multi) row1.push(<GridButton key="ungroup" label="Ungroup" icon="ungroup" onPress={model.onUngroup} compact={compact} />);
  if (model.onJoin) row1.push(<GridButton key="join" label="Join" icon="vector-combine" onPress={model.onJoin} compact={compact} />);
  if (model.onUnion && !multi) row1.push(<GridButton key="union" label="Union" icon="vector-union" onPress={model.onUnion} compact={compact} />);
  // …and LAST, Delete: the one press that takes the object off the page,
  // at the end of the row and away from everything that merely changes it.
  // (It sat mid-row, with Properties last, until the two traded places.)
  row1.push(
    <GridButton key="delete" label="Delete" icon="delete-outline" onPress={model.onDelete} compact={compact} />,
  );

  // The sheet's type tabs (images: the image-edit set; text: Edit + Type),
  // null when the selection's kind offers none — a mixed multi-selection, say,
  // which has no shared kind to ask. Described rather than rendered, because
  // the sheet needs to know WHICH tab is lit.
  let typeSpecs: OptionSpec[] | null = null;
  // The Stroke tab as the pattern row and the mixed row both list it:
  // one spec, so the two can't drift.
  const strokeSpec = () => ({ key: 'stroke', label: 'Stroke', sub: 'stroke' as const, onPress: () => openSubmenu('stroke') });
  /** The Effects tab and the tabs its buttons have made — one per effect the
   *  selection wears, in the order the buttons stand. THE one place this run
   *  is built, so every kind's row grows and shrinks the same way, and so
   *  the row can't disagree with `effectPages` (which is what says the sheet
   *  may open them). */
  const effectSpecs = (): OptionSpec[] => [
    { key: 'effects', label: 'Effects', sub: 'effects', onPress: () => openSubmenu('effects') },
    ...wornEffects.map((kind): OptionSpec => ({
      key: EFFECT_PAGE[kind],
      label: effectLabel(kind),
      sub: EFFECT_PAGE[kind],
      onPress: () => openSubmenu(EFFECT_PAGE[kind]),
    })),
  ];
  if (model.showImageEdit) {
    typeSpecs = IMAGE_EDIT_OPTIONS
      // Image and Crop are single-target only — a mixed selection has no one
      // photo to swap, and no one frame to fit.
      .filter((opt) => !multi || !isSingleImageAction(opt.action))
      // …and the Image page is the host's Replace: no callback, no page.
      .filter((opt) => opt.action !== 'image' || !!model.onReplaceImage)
      // Every image action names a page, and shares its key — except
      // Effects, which brings its own tabs with it.
      .flatMap((opt): OptionSpec[] => (opt.action === 'effects' ? effectSpecs() : [{
        key: opt.action,
        label: opt.label,
        sub: opt.action as SubmenuKey,
        onPress: () => openSubmenu(opt.action as SubmenuKey),
      }]));
  } else if (model.showFrameOptions) {
    // Frame tabs: Background · Effects · Border · Ungroup. Background leads —
    // it is the frame's OWN colour, where the cast effects and the Border
    // dress its edge — and those two reuse the image pages.
    typeSpecs = [
      ...(backgroundable
        ? [{ key: 'background', label: 'Background', sub: 'background' as const, onPress: () => openSubmenu('background') }]
        : []),
      ...effectSpecs(),
      { key: 'border', label: 'Border', sub: 'border', onPress: () => openSubmenu('border') },
    ];
    if (model.onUngroup) {
      typeSpecs.push({ key: 'ungroup', label: 'Ungroup', onPress: model.onUngroup });
    }
  } else if (model.showRigOptions) {
    // Poseable rig: the whole-figure RIG tab only — the part tabs
    // (Hands / Feet / Spine / Head) were removed from the row; their
    // sliders live on as the host's floating slider modes. No Stroke /
    // Fill / Opacity: the figure's silhouette is baked from its pose, so
    // none of the three has anything to act on. The IK switch is not a
    // tab of its own; it lives on the RIG page, with the rest of the
    // posing controls.
    // Reset is NOT one of them: standing the figure back up is a thing you do
    // to the whole rig, so it rides at the foot of the RIG page (RigPoseBar),
    // the page that is already about the figure as a whole — rather than
    // taking a slot in a row of pages you can open.
    typeSpecs = RIG_PAGES.map((opt) => ({
      key: opt.key,
      label: opt.label,
      sub: opt.sub,
      onPress: () => openSubmenu(opt.sub),
    }));
    // …and nothing else. Opacity stood beside it — the whole figure's
    // render opacity, through the host's objectOpacity plumbing — and is
    // gone: a figure is a POSE, and fading one is not a thing anybody
    // reached this panel to do. It left a two-tab row whose second tab
    // was a slider nobody asked for. The plumbing stands for every other
    // kind that offers the page.
  } else if (model.showSvgOptions) {
    // Vector selection: the subtype's own option menu (svgEdit.ts). Every
    // subtype offers Stroke — a path IS its stroke; the closed shapes add Fill.
    typeSpecs = svgEditOptions(model.svgSubtype ?? 'stroke', { encloses: svgFillable })
      // …less the Pattern tab on a host that cannot paint one. A pattern
      // fill is painted with the TILE tool, on the canvas, so a format
      // whose toolbar has no tile tool offers no pattern either — and
      // says so by leaving the tab out rather than by standing it there
      // inert. (The host reports that by passing neither callback.)
      .filter((opt) => opt.action !== 'pattern'
        || !!model.onAddSvgPattern || !!model.onEditSvgPattern)
      .flatMap((opt): OptionSpec[] => (opt.action === 'effects' ? effectSpecs() : [{
        key: opt.action,
        label: opt.label,
        sub: svgActionSubmenu(opt.action),
        onPress: () => openSubmenu(svgActionSubmenu(opt.action)),
      }]));
    if (model.onToggleRepeat) {
      // Pattern-mode toggle (tile pattern objects): repeat the tile across
      // the bounding box instead of scaling it. A toggle rather than a page,
      // so it lights on its own rather than as the showing tab — and it
      // keeps Facet's PATTERN_ACTIVE, which is what separates "pattern mode
      // is on" from "this is the page you're looking at".
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
    // Word sticker (magnetic poetry): Word — its one colour setting,
    // Invert (dark card ⇄ light card) — then Effects and Opacity. Content
    // and typography are fixed, so no Type / Align.
    //
    // The tab is named for the OBJECT, as every other type's first tab is
    // (Image, Text, Stroke): "Card" named the white rectangle behind the
    // word, which is a part of the thing rather than the thing, and read
    // as a page about a background on a panel whose other pages are about
    // the object.
    typeSpecs = [
      ...(cardable
        ? [{ key: 'card', label: 'Word', sub: 'card' as const, onPress: () => openSubmenu('card') }]
        : []),
      ...effectSpecs(),
      { key: 'opacity', label: 'Opacity', sub: 'opacity', onPress: () => openSubmenu('opacity') },
    ];
  } else if (model.showPaintOptions) {
    // Paint island: raster brushwork has no Stroke/Fill to edit — its one
    // option is Opacity, opening the same page (opacity + soften) an image's
    // Opacity action does.
    typeSpecs = PAINT_EDIT_OPTIONS.map((opt) => ({
      key: opt.action,
      label: opt.label,
      sub: opt.action as SubmenuKey,
      onPress: () => openSubmenu('opacity'),
    }));
  } else if (model.showPatternOptions) {
    // Inline tile pattern: its Tools page (PATTERN_EDIT_OPTIONS — the
    // Tiles and Symmetry pages came off the row; see patternEdit.ts).
    // Repeat is NOT a tab here the way it is on the svg branch below —
    // it rides the Tools page as a row, with the grid actions and Borders,
    // because Repeat is a setting rather than a place to go.
    typeSpecs = PATTERN_EDIT_OPTIONS.map((opt) => ({
      key: opt.action,
      label: opt.label,
      sub: patternActionSubmenu(opt.action),
      onPress: () => openSubmenu(patternActionSubmenu(opt.action)),
    }));
    // The same Stroke page the vectors get (its open-path form: Width +
    // Dash), pointed at the pattern's own stroke block.
    typeSpecs.push(strokeSpec());
    // …and the Opacity page every other kind that draws colour offers. A
    // pattern IS its colours, so both of its rows have something to act
    // on: Opacity fades the whole tile grid into the page, Fade walks
    // every cell's ink and the stroke around it toward one target
    // (engine/fade.ts, applied to the baked view).
    typeSpecs.push({ key: 'opacity', label: 'Opacity', sub: 'opacity', onPress: () => openSubmenu('opacity') });
  } else if (model.showStrokeOptions) {
    // Vectors and pattern objects selected together: every one of them
    // has a stroke and nothing else in common, so the row is Stroke alone
    // — the open-path page, which the host lands on all of them.
    typeSpecs = [strokeSpec()];
  } else if (model.showTextStyle) {
    // Text · Font · Spacing · Align (each opening the Text controls straight
    // on its page) · Effects. The four text tabs show the same component;
    // they differ only in which page it lands on, and each is named for
    // what its page holds — Text leads with the ink and the size (the text
    // itself, where the others dress it). Effects is the image's own page,
    // unchanged — one set of cast effects for every object that can wear
    // them. Editing the CONTENT is not a tab: a tap on the selected text
    // opens the host's overlay.
    typeSpecs = [
      { key: 'text', label: 'Text', sub: 'text', onPress: () => openSubmenu('text') },
      { key: 'font', label: 'Font', sub: 'font', onPress: () => openSubmenu('font') },
      { key: 'spacing', label: 'Spacing', sub: 'spacing', onPress: () => openSubmenu('spacing') },
      { key: 'align', label: 'Align', sub: 'align', onPress: () => openSubmenu('align') },
      ...effectSpecs(),
      { key: 'opacity', label: 'Opacity', sub: 'opacity', onPress: () => openSubmenu('opacity') },
      { key: 'transform', label: 'Copies', sub: 'transform', onPress: () => openSubmenu('transform') },
    ];
  }
  if (showUngroup) {
    // A GROUP is a type of selection, and Ungroup is the option that type has:
    // it closes the row after whatever the members share, and IS the row when
    // they share nothing. One press, no page — like the frame Ungroup it mirrors.
    typeSpecs = [...(typeSpecs ?? []), { key: 'ungroup', label: 'Ungroup', onPress: model.onUngroup }];
  }
  // The selection-level tabs (Layout · Group · Merge) — they belong to the
  // selection rather than to what it is made of, so they come AFTER the
  // kind's own tabs on the one row (a mixed multi-selection simply has them
  // as its whole row). "Layout" keeps it clear of the text Align tab (which is
  // about a paragraph's own lines, not where objects sit). Only Layout opens
  // a page; Group and Merge are one press each, so they never light — they
  // just fire and leave a selection that is one thing instead of several.
  const multiOptions = multiSelectionOptions({ align: showLayout, group: showGroup, merge: showMerge });
  const multiSpecs: OptionSpec[] | null = multiOptions.length > 0
    ? multiOptions.map((opt): OptionSpec =>
        opt.action === 'layout'
          ? { key: 'layout', label: opt.label, sub: 'layout', onPress: () => openSubmenu('layout') }
          : { key: opt.action, label: opt.label, onPress: opt.action === 'group' ? model.onGroup : model.onMerge })
    : null;

  // ONE tab row: the selection-level tabs come AFTER the kind's own. The row
  // scrolls if it must (EditTabs), so nothing spills onto a page of its own.
  const allOptionSpecs: OptionSpec[] = [...(typeSpecs ?? []), ...(multiSpecs ?? [])];
  const tabs: EditTabSpec[] = allOptionSpecs.map(({ sub, ...spec }) => ({
    ...spec,
    selected: sub !== undefined ? subOpen(sub) : undefined,
  }));
  const pages = objectPanelPages(allOptionSpecs.length > 0);
  const canSwap = pages.length > 1;
  canSwapRef.current = canSwap;

  return (
    <>
      <View style={styles.clip} pointerEvents="box-none">
        <Animated.View style={[styles.panel, { height: panelBox.height, paddingBottom: panelBox.paddingBottom, transform: [{ translateY }] }]}>
        {/* The common-actions row. A sideways swipe anywhere over it pops the
            Edit sheet — the row itself holds still — and the dots below say
            which of the two pages is up. */}
        <View style={styles.swapArea} {...(canSwap ? swapPan.panHandlers : {})}>
          <View style={styles.gridRow}>
            {row1}
          </View>
        </View>
        </Animated.View>
      </View>
      {sheetMounted ? (
        // Anchored to the screen's bottom edge OVER the panel (its z sits
        // above the panel's clip), rounded at the top, sized to the showing
        // page. It slides by its own height, so it rises out of the screen
        // edge and drops back through it; the panel beneath never moves.
        <Animated.View
          style={[
            styles.sheetWrap,
            { height: sheetH, transform: [{ translateY: sheetY }, { translateY: keyboardY }] },
          ]}
          {...sheetPan.panHandlers}
        >
          <EditSheet
            tabs={tabs}
            content={activeBarEl}
            welled={!displaySub || pageIsWelled(displaySub)}
            remove={removeAction}
            safeBottom={safeBottom}
          />
        </Animated.View>
      ) : null}
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
    // 16 to match the sheet's content inset, so the row's ends land where
    // the sheet's do.
    paddingHorizontal: 16,
  },
  // Fills the panel so a horizontal swipe anywhere over it (not just on the
  // buttons) pops the sheet.
  swapArea: { flex: 1 },
  // The icon row: equal columns separated by a gap wide enough that they read
  // as distinct buttons, not one strip.
  gridRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 4,
    paddingBottom: 8,
  },
  gridButton: { flex: 1, height: 48, alignItems: 'center', justifyContent: 'center' },
  // The Edit sheet's box: bottom-anchored over the panel (zIndex above the
  // panel's clip at 200, and the floating capsules at 100), the panel's
  // surface with rounded top corners and a soft lift off the canvas. Its
  // height is animated inline; content that outruns it mid-resize runs off
  // the bottom of the screen, never over the top edge.
  sheetWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 210,
    backgroundColor: PANEL_BG,
    borderTopLeftRadius: SHEET_RADIUS,
    borderTopRightRadius: SHEET_RADIUS,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: -4 }, elevation: 8,
  },
});
