import type { ImageFramingMode, TintType } from '../adapter';

// How tall each property page's CONTENT AREA is, and therefore how tall the
// Edit sheet stands while that page is showing.
//
// The Edit sheet (components/EditSheet.tsx) is a bottom sheet with a row of
// tabs — one per property page the selection offers — and, under them, a
// darkened rounded content area holding the showing page's controls. Each page is only as tall as its own controls need, so the sheet
// RESIZES as the tabs change (the panel animates the height), and the
// arithmetic here is what it animates TO: the target is known the moment a
// tab is chosen, before any layout has happened, which is also what lets the
// panel report the space it will occlude to the host at once.
//
// A page's height is its rows, counted from the same state the page will
// render from — a Crop page in Tile mode really is two sliders, so a live
// mode switch resizes the sheet to hold them. The metrics below are the SAME
// numbers the pages' StyleSheets lay out with — effectBar.tsx and each page
// import them from here rather than repeating the literals — so this
// arithmetic cannot drift from the layout it predicts.

// ── Row metrics (effectBar.tsx's row styles) ────────────────────────
/** A slider row's label line: the small uppercase caption OVER the track. */
export const SLIDER_LABEL = 13;
/** …the gap under it… */
export const SLIDER_LABEL_GAP = 3;
/** …and the control line: the pill track (Slider.tsx's SLIDER_TRACK) plus a
 *  hair of room above and below for the thumb's ring and shadow. The value
 *  box beside the track is exactly one track tall, so it adds nothing. */
export const SLIDER_CONTROL = 32;
/** A label-over-track slider row (SliderRow, each half of DualSliderRow). */
export const ROW_SLIDER = SLIDER_LABEL + SLIDER_LABEL_GAP + SLIDER_CONTROL;
/** A label + segmented-control row (SegmentedRow, ActionRow, DualSegmentedRow). */
export const ROW_SEGMENTED = 36;
/** A label + full-width pill row (the Text page's Font, the Tint page's Blend and
 *  its gradient stop editor). */
export const ROW_PILL = 36;
/** Space between rows inside a page's `controls` stack. */
export const ROW_GAP = 2;
/** A dim hint line under a control (effectBar's Hint): 2 above + an 11pt line
 *  + 2 below. */
export const HINT_HEIGHT = 17;
/** The Image page's source-resolution line: 8 above + an 11pt line. */

// ── The content area (every page's container) ───────────────────────
/** Inner padding of the darkened content area, all four sides. */
export const CONTENT_PAD = 14;
/** A cushion on every page so font metrics can't clip its last row. */
export const BAR_CUSHION = 3;
/** The gap between a page's aside column (the Shadow page's offset pad) and
 *  its rows. */
export const ASIDE_GAP = 16;
/** The Shadow page's XY offset pad — its aside column, and a SQUARE one: it
 *  is a direction chooser, so its two axes have to read as the same
 *  distance. It takes the exact height of the three sliders beside it
 *  (Blur / Spread / Opacity), which is what makes it square in the page
 *  rather than merely square in its own style — at 106 it was a small
 *  square sitting in a taller column, which reads as squat. Derived from
 *  those rows so the two can't drift apart. */
export const SHADOW_PAD_SIZE = ROW_SLIDER * 3 + ROW_GAP * 2;

// ── The Edit sheet's own chrome (components/EditSheet.tsx) ───────────
/** Padding above the tab row. */
export const SHEET_PAD_TOP = 14;
/** The tab row. */
export const SHEET_TABS = 40;
/** Gap between the tab row and the content area. */
export const SHEET_CONTENT_TOP = 14;
/** The Remove line under the content area, when the page has one: its gap
 *  above plus the line. */
export const SHEET_REMOVE = 30;
/** Padding under the last element (before any safe-area inset). */
export const SHEET_PAD_BOTTOM = 14;
/** Side padding of everything in the sheet. */
export const SHEET_PAD_HORIZONTAL = 16;
/** The sheet's top corners. */
export const SHEET_RADIUS = 24;

/** One square button of the pattern Tiles page's arming grid, and the gap
 *  between them. Six fit across a phone's sheet (6×52 + 5×6 = 342 clears an
 *  SE-width 375 − 2×16 sheet padding − 2×14 content padding… nearly: the grid
 *  wraps column-wise, so a seventh column simply starts), which is what makes
 *  the grid's twelve buttons (Random over Erase, nine recent tiles, '...')
 *  two rows. */
export const PATTERN_TILE_BUTTON = 52;
export const PATTERN_TILE_GRID_GAP = 6;

/** The whole arming grid: two rows of buttons with one gap between. */
export const PATTERN_TILE_GRID =
  PATTERN_TILE_BUTTON * 2 + PATTERN_TILE_GRID_GAP;

/** The property pages. An image selection offers crop / shadow / border /
 *  opacity; text font / spacing / align (three pages of the Text controls)
 *  and shadow (the image page, reused); a vector stroke plus whichever of svgFill /
 *  endpoints / opacity / transform its subtype has. `layout` rides on a
 *  multi-selection rather than on a type. */
export type SubmenuKey =
  | 'tint' | 'crop' | 'shadow' | 'border' | 'opacity'
  | 'image'
  | 'text' | 'font' | 'spacing' | 'align' | 'stroke' | 'svgFill' | 'endpoints' | 'transform' | 'layout'
  // The Shape page: a polygonal shape's corner Radius (see svgHasShape).
  | 'shape'
  // The Color page: every colour a selection can pick (and a word sticker's
  // Invert, its one colour setting) as labelled rows — components/ColorBar.tsx.
  | 'color'
  // The poseable rig's parts: the whole figure (three axes, plus the Reset
  // that stands it back up), six sliders for the hands (curl / twist /
  // spread per side), four for the feet, three for the spine, two for the
  // head.
  | 'rigRoot' | 'rigHands' | 'rigFeet' | 'rigSpine' | 'rigHead'
  // A pattern object's pages: the Tile page (its Repeat toggle), the tile
  // menu, the grid tools, and the painting-symmetry grid.
  | 'patternTile' | 'patternTiles' | 'patternTools' | 'patternSymmetry';

/** The current state of everything that changes a page's row count. Values are
 *  optional so a caller can describe only the pages its selection can open; a
 *  missing one falls back to the shortest reading, which is what an unopened
 *  page of that kind would render. */
export interface SubmenuHeightContext {
  /** Tint page: gradients add a stop editor, linear adds an angle slider. */
  tintType?: TintType;
  /** Crop page: each framing mode brings its own rows. */
  cropMode?: ImageFramingMode;
    /** Opacity page: whether it shows the Soften row under Opacity (default
   *  true). A word sticker fades as a whole and offers no soften. */
  opacitySoften?: boolean;
  /** Color page: how many rows it lists (a swatch or a toggle each). */
  colorRows?: number;
  /** Border page: which optional rows the image / frame border shows. */
  borderRows?: { position: boolean };
  /** Stroke page: the same page, with the rows this vector subtype supports
   *  (never Radius — that is the Shape page's). `color` adds the hue row a
   *  VECTOR's own stroke reads on, under Dash. */
  strokeRows?: { position: boolean; color?: boolean };
  /** Layout page: whether the host wired up Grid, which adds the Arrange row. */
  layoutHasGrid?: boolean;
  /** RIG page: whether the host wired up Reset, which adds its row. A locked
   *  rig offers none, and its page is three sliders tall. */
  rigCanReset?: boolean;
  /** Pattern Tools page: how many tile sets the filter offers. Nonzero adds
   *  the Sets row. */
  patternTileSetCount?: number;
  /** Pattern Tools page: whether the host wired up the Repeat toggle, which
   *  adds its row. A grouped pattern can't repeat, so it doesn't. */
  patternCanRepeat?: boolean;
}

/** Total height of a stack of rows, including the gaps between them. */
function stack(rows: readonly number[], gap = ROW_GAP): number {
  if (rows.length === 0) return 0;
  return rows.reduce((sum, h) => sum + h, 0) + (rows.length - 1) * gap;
}

/** A page's content area: its padding around the taller of its row stack and
 *  its aside column (the Shadow page's pad — 0 for a page with no aside),
 *  plus the cushion. `gap` is the space between its rows, which a page of
 *  GROUPS widens (the Copies page — see GROUP_GAP). */
function contentArea(rows: readonly number[], aside = 0, gap = ROW_GAP): number {
  return CONTENT_PAD * 2 + Math.max(stack(rows, gap), aside) + BAR_CUSHION;
}

/** The same rows with NO well around them — see {@link pageIsWelled}: no
 *  padding of the well's, since there is no well, just the cushion. */
function bareArea(rows: readonly number[], gap = ROW_GAP): number {
  return stack(rows, gap) + BAR_CUSHION;
}

/**
 * Whether a page is drawn inside the Edit sheet's content WELL — the
 * darkened rounded area the controls sit in.
 *
 * Nearly all are: the well is what separates a page's controls from the
 * tabs above them. The Copies page is not, because it brings its own boxes
 * (three RowGroups), and a well around those drew a second rectangle around
 * every section — each one framed twice, for no extra meaning.
 *
 * Both the arithmetic here and EditSheet's markup read this, so a page
 * cannot be measured one way and drawn the other.
 */
export function pageIsWelled(key: SubmenuKey): boolean {
  return key !== 'transform';
}

/** A GROUP of rows (effectBar's RowGroup): a shaded rounded box around rows
 *  that are one setting in several parts. Its padding all round… */
export const GROUP_PAD = 10;
/** …and the space between one group and the next, wider than the gap
 *  between bare rows so the boxes read as separate. */
export const GROUP_GAP = 8;

/** How tall a {@link GROUP_PAD}-padded group of `rows` stands. */
export function rowGroupHeight(rows: readonly number[]): number {
  return GROUP_PAD * 2 + stack(rows);
}

/** Tint / Fill rows: Type, then the gradient stop editor and (linear only) the
 *  angle, then Opacity and Blend. */
function tintRows(type: TintType = 'solid'): number[] {
  return [
    ROW_SEGMENTED,
    ...(type !== 'solid' ? [ROW_PILL] : []),
    ...(type === 'linear' ? [ROW_SLIDER] : []),
    ROW_SLIDER,
    ROW_PILL,
  ];
}

/** Border / Stroke rows: Width, Dash, then the optional Position — the
 *  line's own properties together, then where it sits. No Radius: rounding
 *  belongs to the object, so it is the Image and Shape pages' row. */
function borderRows(rows: { position: boolean; color?: boolean } = { position: true }): number[] {
  return [
    ROW_SLIDER,
    ROW_SLIDER,
    // The colour row rides the slider's own proportions (ColorSliderRow).
    ...(rows.color ? [ROW_SLIDER] : []),
    ...(rows.position ? [ROW_SEGMENTED] : []),
  ];
}

/** Crop rows: the Fill / Fit / Crop / Tile mode row, then whatever that mode
 *  asks for. Nothing else — the source-resolution caption and the Replace
 *  row came off the page (Replace rides the host's floating capsule). */
function cropRows(mode: ImageFramingMode = 'fill'): number[] {
  switch (mode) {
    case 'fit': return [ROW_SEGMENTED, ROW_SLIDER, HINT_HEIGHT];
    case 'crop': return [ROW_SEGMENTED, ROW_SEGMENTED, ROW_SLIDER];
    case 'tile': return [ROW_SEGMENTED, ROW_SLIDER, ROW_SLIDER];
    case 'fill':
    default: return [ROW_SEGMENTED, ROW_SLIDER];
  }
}

/** How tall one page's content area stands, given the state it will render
 *  from. The sheet around it is {@link editSheetHeight}. */
export function submenuHeight(key: SubmenuKey, ctx: SubmenuHeightContext = {}): number {
  switch (key) {
    case 'tint':
      return contentArea(tintRows(ctx.tintType));
    case 'svgFill':
      // The Fill page is the Tint page solid-only (a shape's fill is always
      // one flat color at Normal blend): no Type control, no gradient rows,
      // no Blend row — the Opacity slider alone (its colour is the Color
      // page's).
      return contentArea([ROW_SLIDER]);
    case 'border':
      return contentArea(borderRows(ctx.borderRows));
    case 'stroke':
      return contentArea(borderRows({
        position: ctx.strokeRows?.position ?? true,
        color: ctx.strokeRows?.color ?? false,
      }));
    case 'shape':
      // The Radius slider alone.
      return contentArea([ROW_SLIDER]);
    case 'crop':
      return contentArea(cropRows(ctx.cropMode));
    case 'image':
      // The Replace button and the picture's corner Radius.
      return contentArea([ROW_SEGMENTED, ROW_SLIDER]);
    case 'opacity':
      return contentArea(ctx.opacitySoften === false ? [ROW_SLIDER] : [ROW_SLIDER, ROW_SLIDER]);
    case 'color':
      // One segmented-height row per colour (or toggle) listed; at least one.
      return contentArea(new Array(Math.max(1, ctx.colorRows ?? 1)).fill(ROW_SEGMENTED));
    // The rig pages are sliders and nothing else — no hint line and no IK
    // switch (see RigPoseBar) — so each stands exactly as tall as the
    // controls it renders.
    case 'rigHands':
      // Left and Right, and a Twist, a Spread and a Bend each.
      return contentArea([
        ROW_SLIDER, ROW_SLIDER, ROW_SLIDER, ROW_SLIDER, ROW_SLIDER, ROW_SLIDER,
        ROW_SLIDER, ROW_SLIDER,
      ]);
    case 'rigFeet':
      // Left and Right, each with its own Twist and its ball's Bend.
      return contentArea([
        ROW_SLIDER, ROW_SLIDER, ROW_SLIDER, ROW_SLIDER, ROW_SLIDER, ROW_SLIDER,
      ]);
    case 'rigSpine':
      // Bend / Twist / Lean.
      return contentArea([ROW_SLIDER, ROW_SLIDER, ROW_SLIDER]);
    case 'rigRoot':
      // The three axes the figure stands on, and — when the host offers it —
      // the Reset that puts the whole figure back at rest. It lives on THIS
      // page because this is the page about the figure as a whole.
      return contentArea([
        ROW_SLIDER, ROW_SLIDER, ROW_SLIDER,
        ...(ctx.rigCanReset ? [ROW_SEGMENTED] : []),
      ]);
    case 'rigHead':
      // Nod / Shake / Tilt.
      return contentArea([ROW_SLIDER, ROW_SLIDER, ROW_SLIDER]);
    case 'endpoints':
      // A marker row per end. (The Caps row went — see EndpointsBar.)
      return contentArea([ROW_SEGMENTED, ROW_SEGMENTED]);
    case 'transform': {
      // The Copies page: Create's six settings, a slider row each, in ONE
      // tabbed box — the count beside the turn, the offsets, the scales,
      // whichever tab is lit — and the button that fires it, standing
      // below. Every face is the same height (the tab row and two
      // sliders), so the page never resizes under a tab press. Its group IS
      // its box, so it is drawn with no well around it (pageIsWelled) and
      // measured without the well's padding.
      const tabbed = rowGroupHeight([ROW_SEGMENTED, ROW_SLIDER, ROW_SLIDER]);
      return bareArea([tabbed, ROW_SEGMENTED], GROUP_GAP);
    }
    case 'patternTile':
      // The Tile page: the Repeat toggle, and nothing else.
      return contentArea([ROW_SEGMENTED]);
    case 'patternTiles':
      // The arming grid: two rows of square buttons.
      return contentArea([PATTERN_TILE_GRID]);
    case 'patternTools': {
      // Grid actions and Borders, plus Repeat when the pattern can take it
      // and the Sets row when the host offers a tile-set filter. (Random
      // and Erase left for the Tiles page, where they sit beside the tiles
      // they compete with.) The Sets row's filter opens as a full-screen
      // takeover (PatternSetsModal), so the page reserves nothing for it.
      const setCount = ctx.patternTileSetCount ?? 0;
      const mainRows = 2 + (ctx.patternCanRepeat ? 1 : 0) + (setCount > 0 ? 1 : 0);
      return contentArea(new Array(mainRows).fill(ROW_SEGMENTED));
    }
    case 'patternSymmetry':
      // The mode grid: 4×3 label-less rectangles, each row at the
      // segmented-row height (Off rides row 3).
      return contentArea([ROW_SEGMENTED, ROW_SEGMENTED, ROW_SEGMENTED]);
    case 'layout':
      // Horizontal and Vertical, plus Arrange when the host offers Grid.
      return contentArea([
        ROW_SEGMENTED, ROW_SEGMENTED,
        ...(ctx.layoutHasGrid ? [ROW_SEGMENTED] : []),
      ]);
    case 'text':
      // The text itself: its colour rows (one segmented row each, at least
      // one) and Size under them.
      return contentArea([
        ...new Array(Math.max(1, ctx.colorRows ?? 1)).fill(ROW_SEGMENTED),
        ROW_SLIDER,
      ]);
    case 'font':
      // Font pill and Weight segmented. Size reads on the Text page, beside
      // the ink it sizes.
      return contentArea([ROW_PILL, ROW_SEGMENTED]);
    case 'spacing':
      // Char, Line and Bend, a slider row each.
      return contentArea([ROW_SLIDER, ROW_SLIDER, ROW_SLIDER]);
    case 'align':
      // The horizontal and the vertical alignment rows.
      return contentArea([ROW_SEGMENTED, ROW_SEGMENTED]);
    case 'shadow':
      // The XY pad on the left, three sliders on the right: the taller
      // column sets the height.
      return contentArea([ROW_SLIDER, ROW_SLIDER, ROW_SLIDER], SHADOW_PAD_SIZE);
    default: {
      // Exhaustiveness guard: adding a SubmenuKey without giving it rows here
      // is a compile error, not a silently stunted page.
      const unhandled: never = key;
      return unhandled;
    }
  }
}

/** How tall an ABSENT effect's page stands: the one Add button
 *  (EmptyEffectBar), a segmented row tall, in the well's chrome — not the
 *  controls that will swap in once it is pressed. Without this a shadowless
 *  image's Shadow tab stood as tall as the pad and three sliders it wasn't
 *  showing. */
export function emptyEffectHeight(): number {
  return contentArea([ROW_SEGMENTED]);
}

/** How tall the Edit sheet stands: its tab row, then — when a page is
 *  showing — the content area holding it (`content`, a
 *  {@link submenuHeight}) and, when that page can be removed, the Remove line
 *  under it; then the bottom padding and the device's bottom inset, which
 *  the sheet pads so its last line clears the home indicator. A sheet whose
 *  tabs are all one-press actions (a word sticker's Invert) shows no content
 *  area at all, and is the tabs alone. */
export function editSheetHeight(
  content: number | null,
  opts: { removable?: boolean; safeBottom?: number } = {},
): number {
  return SHEET_PAD_TOP + SHEET_TABS
    + (content != null ? SHEET_CONTENT_TOP + content : 0)
    + (content != null && opts.removable ? SHEET_REMOVE : 0)
    + SHEET_PAD_BOTTOM + (opts.safeBottom ?? 0);
}
