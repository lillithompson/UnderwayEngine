import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { AlignEdge, BorderModel, EndpointsModel, FramingModel, ObjectPropertiesModel, OpacityModel, RGBLike, ShadowModel, TextStyleModel, TintModel } from '../adapter';
import { IMAGE_EDIT_OPTIONS, isSingleImageAction, swipeDismissDirection } from '../logic/imageEdit';
import { PAINT_EDIT_OPTIONS } from '../logic/paintEdit';
import {
  PATTERN_EDIT_OPTIONS, patternActionOfSubmenu, patternActionSubmenu,
} from '../logic/patternEdit';
import { multiSelectionOptions } from '../logic/multiOptions';
import { isValueDragging } from '../logic/slider';
import { SubmenuKey, editSheetHeight, emptyEffectHeight, pageIsWelled, submenuHeight } from '../logic/submenuHeight';
import { svgEditOptions, svgHasEndpoints, svgHasFill, svgHasOpacity, svgHasShape, svgStrokeRemovable, svgStrokeRows } from '../logic/svgEdit';
import { DEFAULT_TINT_MODEL, addStop } from '../logic/tint';
import {
  landingSubmenu,
  objectPanelLayout,
  objectPanelPages,
} from '../logic/panelLayout';
import { ShadowBar } from './ShadowBar';
import { BorderBar } from './BorderBar';
import { OpacityBar } from './OpacityBar';
import { RigPoseBar } from './RigPoseBar';
import {
  RIG_PART_PAGES, restRigSliders, rigPartOfSubmenu, rigPartSubmenu,
} from '../logic/rigEdit';
import { CropBar } from './CropBar';
import { ImageBar } from './ImageBar';
import { TextBar, TextPage } from './TextBar';
import { TintBar } from './TintBar';
import { EndpointsBar } from './EndpointsBar';
import { TransformBar, type CopiesSection } from './TransformBar';
import { LayoutBar } from './LayoutBar';
import { PatternSymmetryBar, PatternTileBar, PatternTilesBar, PatternToolsBar } from './PatternBars';
import { BarBody, ColorSliderRow, EmptyEffectBar, MultiToggleRow } from './effectBar';
import { ShapeBar } from './ShapeBar';
import { EditSheet, EditTabSpec } from './EditSheet';
import { SHEET_RADIUS } from '../logic/submenuHeight';
import {
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
//            selection's KIND offers (images: crop / shadow / border /
//            opacity; text: edit / type / align / shadow) followed by what
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
// What a hue row shows before the host has reported a colour — only a
// fallback for the transient frame before the model lands, since every host
// that offers one of these pages resolves the real colour.
const DEFAULT_ROW_COLOR: RGBLike = { r: 255, g: 255, b: 255 };
// Opacity-page defaults: fully opaque, hard edges — what every object renders
// as until it visits the page.
const DEFAULT_OPACITY_MODEL: OpacityModel = { opacity: 1, edgeSoften: 0 };
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

// The property pages, in tab order. Image selections offer crop / shadow /
// border / opacity (matching their tab order); text offers font / align (two
// pages of the Text controls) and then shadow — the SAME Drop Shadow page an
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
/** The pages whose open state the panel keeps itself (see `localSub`). */
type LocalSubmenu = 'background' | 'card' | 'shape' | 'image';
const isLocalSubmenu = (key: SubmenuKey): key is LocalSubmenu =>
  key === 'background' || key === 'card' || key === 'shape' || key === 'image';

interface OptionSpec extends Omit<EditTabSpec, 'selected'> {
  /** The page this option opens. Options carrying one light up as tabs while
   *  that page shows; the rest (actions, toggles) never take that lit state. */
  sub?: SubmenuKey;
}

export function ObjectPropertiesPanel({ model, safeBottom = 0, onOccludedHeight }: {
  model: ObjectPropertiesModel;
  /** Bottom safe-area inset (home indicator). Padded under the panel's row
   *  and the Edit sheet's last line so they clear it; 0 on non-notched / web. */
  safeBottom?: number;
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
  // The Opacity page rides the same draft pattern as Crop — the draft owns
  // both tracked params (there's no external color to split off).
  const [opacityDraft, setOpacityDraft] = useState<OpacityModel | null>(null);
  const prevOpacityOpen = useRef(false);
  // The Stroke page rides the same draft pattern as Border — it IS the Border
  // page, pointed at a vector object's own stroke.
  const [strokeDraft, setStrokeDraft] = useState<BorderModel | null>(null);
  const prevStrokeOpen = useRef(false);
  // The Fill page rides the Tint page's draft pattern — it IS the Tint page,
  // pointed at a closed shape's interior.
  const [svgFillDraft, setSvgFillDraft] = useState<TintModel | null>(null);
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
  // The Color, Shape and Image pages are the panel's own: they hold nothing
  // the host has to know is open (a swatch opens the host's picker, a toggle
  // fires its action, the Radius slider writes through onStrokeRadius as it
  // always did, Replace is one press and the resolution is just read), so
  // unlike the effect pages their open state lives here rather than on the
  // model. A page NOT on this list and not wired to a host flag can never
  // open at all — which is what left the Image tab dead, and an image's
  // sheet landing on it empty.
  const [localSub, setLocalSub] = useState<LocalSubmenu | null>(null);
  // ── The pages (Crop / Shadow / Border / Text …) ──────────────────────
  // The open page is what the Edit sheet's well holds, and its tab is the lit
  // one. The pages are separate components but only one shows at a time.
  const svgFillable = !!model.showSvgOptions && svgHasFill(model.svgSubtype ?? 'stroke');
  const svgEndable = !!model.showSvgOptions && svgHasEndpoints(model.svgSubtype ?? 'stroke');
  const svgOpacityable = !!model.showSvgOptions && svgHasOpacity(model.svgSubtype ?? 'stroke');
  // Every vector subtype repeats (svgEditOptions' Copies).
  const svgTransformable = !!model.showSvgOptions;
  // A polygonal shape rounds its corners on the Shape page.
  const svgShapeable = !!model.showSvgOptions && svgHasShape(model.svgSubtype ?? 'stroke');
  // Vectors and patterns share the Stroke page (and its colour).
  const strokeable = !!model.showSvgOptions || !!model.showPatternOptions || !!model.showStrokeOptions;

  // ── Where a colour reads ──────────────────────────────────────────────
  // On the page of the thing it colours, and nowhere else: the Stroke page's
  // hue row is the line's ink, the Fill page's is the fill, the Shadow and
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
      ? ['shadow', 'border', 'opacity', 'transform']
      : [...(model.onReplaceImage ? (['image'] as const) : []), 'crop', 'shadow', 'border', 'opacity', 'transform'])
    // A frame leads on its own fill — Background — then the two effects it
    // dresses its edge with.
    : model.showFrameOptions
      ? [...(backgroundable ? (['background'] as const) : []), 'shadow', 'border']
    // A text leads on the text ITSELF — its ink and its size — then the
    // pages that dress it.
    : model.showTextStyle ? ['text', 'font', 'spacing', 'align', 'shadow', 'opacity', 'transform']
    // A word sticker: its card scheme, then Opacity.
    : model.showInvert ? [...(cardable ? (['card'] as const) : []), 'opacity']
    : model.showPaintOptions ? ['opacity']
    // A pattern object's pages, in the order its tab row lists them, plus
    // the Stroke page its baked tile paths share with the vectors.
    : model.showPatternOptions
      ? [...PATTERN_EDIT_OPTIONS.map((o) => patternActionSubmenu(o.action)), 'stroke' as const]
    // Vectors and patterns together: the one page they share.
    : model.showStrokeOptions ? ['stroke']
    // A rig's pages — the whole-figure TRANSFORM page (the part pages
    // Hands/Feet/Spine/Head came off the row, their sliders living on as
    // the host's floating slider modes) and Opacity, the same page an
    // image opens: a figure fades like any object. Checked before
    // showSvgOptions: a rig's figure IS an svg object, and the other vector
    // pages have nothing to act on for a baked silhouette.
    : model.showRigOptions ? [...RIG_PART_PAGES.map((o) => o.sub), 'opacity' as const]
    : model.showSvgOptions
      ? [
          'stroke',
          ...(svgShapeable ? (['shape'] as const) : []),
          ...(svgFillable ? (['svgFill'] as const) : []),
          ...(svgEndable ? (['endpoints'] as const) : []),
          // …then the tail every kind shares — Shadow, Opacity, Copies.
          'shadow',
          ...(svgOpacityable ? (['opacity'] as const) : []),
          ...(svgTransformable ? (['transform'] as const) : []),
        ]
    : [];
  // Does THIS selection offer the Copies page? Read off the tab order
  // itself, so the fold-away below asks exactly the question the tab row
  // asks. It used to ask `svgTransformable` — "is this a vector" — while
  // an image and a TEXT carry the tab too: tapping Copies on a text opened
  // the page, this effect closed it on the next render for not being a
  // vector, the landing rule re-opened the remembered page, and the tab
  // flickered on and off for as long as it was looked at.
  const transformable = typeSubmenuOrder.includes('transform');

  // Layout joins the tail of whatever the selection's type offers, so a mixed
  // multi-selection's sheet has Layout alone to open and a uniform one's has
  // its type's pages before it.
  const submenuOrder: SubmenuKey[] = showLayout ? [...typeSubmenuOrder, 'layout'] : typeSubmenuOrder;

  const activeSub: SubmenuKey | null =
    model.layoutOpen ? 'layout'
    : model.cropOpen ? 'crop'
    : model.shadowOpen ? 'shadow'
    : model.borderOpen ? 'border'
    : model.opacityOpen ? 'opacity'
    : model.strokeOpen ? 'stroke'
    : model.svgFillOpen ? 'svgFill'
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
    : action === 'shape' ? 'shape'
    : action === 'shadow' ? 'shadow'
    : action === 'endpoints' ? 'endpoints'
    : action === 'opacity' ? 'opacity'
    : action === 'transform' ? 'transform'
    : 'stroke';

  const openSubmenu = (key: SubmenuKey) => {
    fontSheetOpenRef.current = false;
    // One page at a time: a panel-kept page (Color, Shape) closes as any
    // host page opens (the host closes its own siblings the same way), and
    // opens alone.
    setLocalSub(isLocalSubmenu(key) ? key : null);
    if (isLocalSubmenu(key)) { dismissHostSubmenus(); return; }
    if (key === 'crop') model.onCropOpenChange?.(true);
    else if (key === 'shadow') model.onShadowOpenChange?.(true);
    else if (key === 'border') model.onBorderOpenChange?.(true);
    else if (key === 'opacity') model.onOpacityOpenChange?.(true);
    else if (key === 'stroke') model.onStrokeOpenChange?.(true);
    else if (key === 'svgFill') model.onSvgFillOpenChange?.(true);
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
    model.onShadowOpenChange?.(false);
    model.onBorderOpenChange?.(false);
    model.onCropOpenChange?.(false);
    model.onOpacityOpenChange?.(false);
    model.onStrokeOpenChange?.(false);
    model.onSvgFillOpenChange?.(false);
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
    const target = landingSubmenu(submenuOrder, lastSubRef.current);
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

  // Fold the effect pages away the moment the selection can no longer use them
  // (or the whole panel hides) so none lingers over the next object's actions.
  // Frames reuse the Shadow / Border pages (but never Crop), so keep those open
  // while a frame is selected. Shadow and Border part company here: text offers
  // Shadow but not Border, so a text selection must not drag the Shadow page
  // down with a rule written for the pair.
  useEffect(() => {
    const canShadow = model.showImageEdit || model.showFrameOptions || model.showTextStyle
      || model.showSvgOptions;
    const canBorder = model.showImageEdit || model.showFrameOptions;
    if (!model.visible || !canShadow) model.onShadowOpenChange?.(false);
    if (!model.visible || !canBorder) model.onBorderOpenChange?.(false);
    if (!model.visible || !model.showImageEdit) {
      model.onCropOpenChange?.(false);
    }
    // model.on*OpenChange are stable setters; listing the whole model would
    // re-run this every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.visible, model.showImageEdit, model.showFrameOptions, model.showTextStyle, model.showSvgOptions]);
  // The Opacity page is shared by images, paint islands, the closed vector
  // shapes, rigs and word stickers, so it folds away only when the
  // selection is none of those (or the panel hides).
  useEffect(() => {
    const canOpacity = model.showImageEdit || model.showPaintOptions || svgOpacityable
      || model.showRigOptions || model.showInvert || model.showTextStyle;
    if ((!model.visible || !canOpacity) && model.opacityOpen) {
      model.onOpacityOpenChange?.(false);
    }
    // model.on* are stable setters; listing the whole model would re-run this
    // every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.visible, model.showImageEdit, model.showPaintOptions, svgOpacityable, model.showRigOptions, model.showInvert, model.showTextStyle, model.opacityOpen]);
  // The panel-kept pages fold away when the selection stops offering them
  // (or the panel hides), like the host's pages do.
  const imageable = !!model.showImageEdit && !!model.onReplaceImage && !multi;
  useEffect(() => {
    if (!model.visible
      || (localSub === 'background' && !backgroundable)
      || (localSub === 'card' && !cardable)
      || (localSub === 'shape' && !svgShapeable)
      || (localSub === 'image' && !imageable)) {
      setLocalSub(null);
    }
  }, [model.visible, backgroundable, cardable, svgShapeable, imageable, localSub]);

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
      // default one when it has never been filled, so the page opens on
      // something coherent rather than on an empty gradient.
      setSvgFillDraft(model.svgFill ?? DEFAULT_TINT_MODEL);
    }
    prevSvgFillOpen.current = !!model.svgFillOpen;
  }, [model.svgFillOpen, model.svgFill]);
  // Fold the Stroke page away the moment the selection no longer offers it —
  // a vector object or a PATTERN (whose tiles share the page) — or the panel
  // hides, so it never lingers over the next object. The Fill and Endpoints
  // pages go with it, and also whenever the new vector selection is a subtype
  // that doesn't offer that one — a shape with no interior to fill, or a
  // closed one with no loose end to decorate.
  useEffect(() => {
    if ((!model.visible || !strokeable) && model.strokeOpen) {
      model.onStrokeOpenChange?.(false);
    }
    if ((!model.visible || !svgFillable) && model.svgFillOpen) {
      model.onSvgFillOpenChange?.(false);
    }
    if ((!model.visible || !svgEndable) && model.endpointsOpen) {
      model.onEndpointsOpenChange?.(false);
    }
    if ((!model.visible || !transformable) && model.transformOpen) {
      model.onTransformOpenChange?.(false);
    }
    // model.on* are stable setters; listing the whole model would re-run this
    // every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.visible, strokeable, model.strokeOpen, svgFillable, model.svgFillOpen, svgEndable, model.endpointsOpen, transformable, model.transformOpen]);
  // Fold the Layout page away as soon as the selection stops being a multi one
  // (a tap that drops it to a single object, or clears it), so it never
  // lingers over an object it has nothing to say about.
  useEffect(() => {
    if ((!model.visible || !showLayout) && model.layoutOpen) model.onLayoutOpenChange?.(false);
    // model.on* are stable setters; listing the whole model would re-run this
    // every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.visible, showLayout, model.layoutOpen]);
  // Fold the Text pages away the moment the selection is no longer editable
  // text (or the whole panel hides), so they never linger over the next object.
  useEffect(() => {
    if ((!model.visible || !model.showTextStyle) && model.textStyleOpen) {
      model.onTextStyleOpenChange?.(false);
    }
    // model.on* are stable setters; listing the whole model would re-run this
    // every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.visible, model.showTextStyle, model.textStyleOpen]);

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

  // Crop controls → live preview / commit; the draft owns the tracked params
  // (there's no external color).
  const applyFraming = (f: FramingModel, committed: boolean) => {
    setCropDraft(f);
    model.onFraming?.(f, committed);
  };

  // Opacity controls → live preview / commit; the draft owns both params
  // (no external color). No Remove: opacity is not a layer an object can be
  // without — every object has one — so the sliders are the whole page.
  const applyOpacity = (o: OpacityModel, committed: boolean) => {
    setOpacityDraft(o);
    model.onObjectOpacity?.(o, committed);
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
  const borderForBar: BorderModel = borderDraft
    ? { ...borderDraft, color: model.border?.color ?? borderDraft.color }
    : (model.border ?? DEFAULT_BORDER_MODEL);
  const framingForBar: FramingModel = cropDraft ?? model.framing ?? DEFAULT_FRAMING_MODEL;
  const opacityForBar: OpacityModel = opacityDraft ?? model.objectOpacity ?? DEFAULT_OPACITY_MODEL;
  const strokeForBar: BorderModel = strokeDraft
    ? { ...strokeDraft, color: model.stroke?.color ?? strokeDraft.color }
    : (model.stroke ?? DEFAULT_BORDER_MODEL);
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
    // A flip, not a hue, so it is the one chip it always was.
    activeBarEl = (
      <BarBody>
        <MultiToggleRow
          options={[{ value: 'invert' as const, label: 'Invert', active: !!model.inverted }]}
          onToggle={() => model.onInvert?.()}
        />
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
  } else if (displaySub === 'shadow' && model.shadowPresent === false && model.onAddShadow) {
    addPage = true;
    activeBarEl = <EmptyEffectBar addLabel="Add Drop Shadow" onAdd={() => model.onAddShadow?.()} />;
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
  } else if (displaySub === 'transform') {
    activeBarEl = (
      <TransformBar
        onCopies={(spec) => model.onTransformCopies?.(spec)}
        onCopiesPreview={(spec) => model.onTransformCopiesPreview?.(spec)}
        section={copiesSection}
        onSection={setCopiesSection}
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
  } else if (displaySub === 'shadow') {
    activeBarEl = (
      <ShadowBar
        shadow={shadowForBar}
        // The shadow's own ink, under Spread: the colour is the SHADOW's, not
        // a field of the draft the sliders keep, so the host writes it down
        // its own path (the one the full picker writes too) and reports it
        // back each move — which is what moves the handle.
        color={shadowForBar.color}
        onColor={model.onShadowColor ? (color, committed) => model.onShadowColor?.(color, committed) : undefined}
        onOpenColorPicker={model.onPickShadowColor ? () => model.onPickShadowColor?.() : undefined}
        onChange={(s) => applyShadow(s, false)}
        onCommit={(s) => applyShadow(s, true)}
      />
    );
    removeAction = { label: 'Remove drop shadow', onPress: removeShadow };
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
  } else if (displaySub && rigPartOfSubmenu(displaySub)) {
    activeBarEl = (
      <RigPoseBar
        part={rigPartOfSubmenu(displaySub)!}
        values={model.rigSliders ?? restRigSliders()}
        onChange={(key, v) => model.onRigSlider?.(key, v, false)}
        onCommit={(key, v) => model.onRigSlider?.(key, v, true)}
        onReset={model.onResetRig}
      />
    );
  } else if (displaySub === 'opacity') {
    activeBarEl = (
      <OpacityBar
        opacity={opacityForBar}
        showSoften={!model.showInvert && !model.showTextStyle}
        onChange={(o) => applyOpacity(o, false)}
        onCommit={(o) => applyOpacity(o, true)}
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
    // A word sticker fades as a whole: no Soften row.
    opacitySoften: !model.showInvert && !model.showTextStyle,
    // Every hue row is counted exactly where its page will render it — the
    // page grows by a slider row when the host has that colour to write.
    svgFillColor: !!model.onSvgFillColor,
    shadowColor: !!model.onShadowColor && !!model.onPickShadowColor,
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

  // Common actions (rotate / flip / copy / lock / delete, plus the optional
  // group actions).
  const row1: React.ReactNode[] = [
    <GridButton key="rotate" label="Rotate" icon="rotate-right" onPress={model.onRotate} compact={compact} />,
    <GridButton key="flipH" label="Mirror H" icon="arrow-left-right" onPress={model.onMirrorH} compact={compact} />,
    <GridButton key="flipV" label="Mirror V" icon="arrow-up-down" onPress={model.onMirrorV} compact={compact} />,
    <GridButton key="copy" label="Duplicate" icon="content-copy" onPress={model.onDuplicate} compact={compact} />,
    // The way into the type pages: the sheet the row's second dot and a
    // sideways swipe also raise (openSheet — one opener, so the button and
    // the gestures can't land differently). It took Lock's place on the row
    // (2026-09-11): the tabs were reachable only by a gesture nothing on
    // screen announced, while locking stays a press away on the canvas
    // radial. Absent on a selection with no pages to open — there would be
    // nothing behind it.
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
  if (model.showImageEdit) {
    typeSpecs = IMAGE_EDIT_OPTIONS
      // Image and Crop are single-target only — a mixed selection has no one
      // photo to swap, and no one frame to fit.
      .filter((opt) => !multi || !isSingleImageAction(opt.action))
      // …and the Image page is the host's Replace: no callback, no page.
      .filter((opt) => opt.action !== 'image' || !!model.onReplaceImage)
      // Every image action names a page, and shares its key.
      .map((opt) => ({
        key: opt.action,
        label: opt.label,
        sub: opt.action as SubmenuKey,
        onPress: () => openSubmenu(opt.action as SubmenuKey),
      }));
  } else if (model.showFrameOptions) {
    // Frame tabs: Background · Shadow · Border · Ungroup. Background leads —
    // it is the frame's OWN colour, where Shadow and Border dress its edge —
    // and those two reuse the image effect pages.
    typeSpecs = [
      ...(backgroundable
        ? [{ key: 'background', label: 'Background', sub: 'background' as const, onPress: () => openSubmenu('background') }]
        : []),
      { key: 'shadow', label: 'Shadow', sub: 'shadow', onPress: () => openSubmenu('shadow') },
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
    typeSpecs = RIG_PART_PAGES.map((opt) => ({
      key: opt.part,
      label: opt.label,
      sub: opt.sub,
      onPress: () => openSubmenu(opt.sub),
    }));
    // …and Opacity: the whole figure's render opacity, the page an image
    // opens, through the host's same objectOpacity plumbing.
    typeSpecs.push({ key: 'opacity', label: 'Opacity', sub: 'opacity', onPress: () => openSubmenu('opacity') });
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
    // Word sticker (magnetic poetry): Card — its one colour setting, Invert
    // (dark card ⇄ light card) — then Opacity, the whole magnet's. Content +
    // typography are fixed, so no Type / Align.
    typeSpecs = [
      ...(cardable
        ? [{ key: 'card', label: 'Card', sub: 'card' as const, onPress: () => openSubmenu('card') }]
        : []),
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
  } else if (model.showStrokeOptions) {
    // Vectors and pattern objects selected together: every one of them
    // has a stroke and nothing else in common, so the row is Stroke alone
    // — the open-path page, which the host lands on all of them.
    typeSpecs = [strokeSpec()];
  } else if (model.showTextStyle) {
    // Text · Font · Spacing · Align (each opening the Text controls straight
    // on its page) · Shadow. The four text tabs show the same component;
    // they differ only in which page it lands on, and each is named for
    // what its page holds — Text leads with the ink and the size (the text
    // itself, where the others dress it). Shadow is
    // the image's own page, unchanged — one Drop Shadow control for every
    // object that can cast one. Editing the CONTENT is not a tab: a tap on
    // the selected text opens the host's overlay.
    typeSpecs = [
      { key: 'text', label: 'Text', sub: 'text', onPress: () => openSubmenu('text') },
      { key: 'font', label: 'Font', sub: 'font', onPress: () => openSubmenu('font') },
      { key: 'spacing', label: 'Spacing', sub: 'spacing', onPress: () => openSubmenu('spacing') },
      { key: 'align', label: 'Align', sub: 'align', onPress: () => openSubmenu('align') },
      { key: 'shadow', label: 'Shadow', sub: 'shadow', onPress: () => openSubmenu('shadow') },
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
            { height: sheetH, transform: [{ translateY: sheetY }] },
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
