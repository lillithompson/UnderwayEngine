import type { ImageFramingMode, TintType } from '../adapter';

// How tall each submenu bar is, and therefore how tall the bar layer stands for
// a given selection.
//
// Every bar used to share ONE height, sized to the tallest bar in the editor —
// so a text selection, whose two bars are three rows each, still reserved room
// for the five-row linear-gradient Tint an image can open. The bars for a
// selection now size to the tallest bar THAT selection can reach, and no more.
//
// A bar's height is its chrome plus its rows, and the rows are counted from the
// same state the bar will render from — a solid Tint really is three rows, so
// an image whose tint is solid gets a shorter layer than one mid-gradient. That
// is the point: reserving the worst case everywhere is the thing being fixed.
//
// The metrics below are the SAME numbers the bars' StyleSheets lay out with —
// effectBar.tsx and each bar import them from here rather than repeating the
// literals — so this arithmetic cannot drift from the layout it predicts.

// ── Row metrics (effectBar.tsx's row styles) ────────────────────────
/** A label + slider row (SliderRow, DualSliderRow). */
export const ROW_SLIDER = 32;
/** A label + segmented-control row (SegmentedRow, ActionRow, DualSegmentedRow). */
export const ROW_SEGMENTED = 36;
/** A label + full-width pill row (the Text bar's Font, the Tint bar's Blend and
 *  its gradient stop editor). */
export const ROW_PILL = 36;
/** Space between rows inside a bar's `controls` stack. */
export const ROW_GAP = 2;
/** A dim hint line under a control (effectBar's Hint): 2 above + an 11pt line
 *  + 2 below. */
export const HINT_HEIGHT = 17;

// ── Bar chrome (each bar's container + header) ──────────────────────
export const BAR_BORDER = 1;
export const BAR_PAD_TOP = 10;
export const BAR_PAD_BOTTOM = 14;
export const BAR_PAD_HORIZONTAL = 16;
/** EffectBarHeader's minHeight. */
export const BAR_HEADER = 22;
/** Gap between the header and the first row (`controls` marginTop). */
export const BAR_CONTROLS_TOP = 10;
/** A cushion on every bar so font metrics can't clip its last row. */
export const BAR_CUSHION = 3;

// ── Bars that don't use the standard container ──────────────────────
/** The Drop Shadow bar sits its XY pad beside its sliders, so it pads and
 *  spaces differently from the stacked bars. */
export const SHADOW_PAD_TOP = 12;
export const SHADOW_PAD_BOTTOM = 16;
export const SHADOW_CONTROLS_TOP = 4;
/** The XY offset pad — taller than the three sliders beside it, so it alone
 *  sets that bar's content height. */
export const SHADOW_PAD_SIZE = 106;
/** The Crop bar's source-resolution caption, below `controls`: 8 above + an
 *  11pt line. */
export const CROP_CAPTION_HEIGHT = 21;

/** The slide-up submenus. Image selections cycle through tint / crop / shadow /
 *  border / opacity; text through font / align (two pages of the Text bar) and
 *  shadow (the image bar, reused); a vector through stroke plus whichever of
 *  svgFill / endpoints / opacity its subtype has. `layout` rides on a
 *  multi-selection rather than on a type. */
export type SubmenuKey =
  | 'tint' | 'crop' | 'shadow' | 'border' | 'opacity'
  | 'font' | 'align' | 'stroke' | 'svgFill' | 'endpoints' | 'layout'
  // The poseable rig's parts: the whole figure (three axes plus the IK
  // switch), two sliders each for the hands and feet, three for the spine.
  | 'rigRoot' | 'rigHands' | 'rigFeet' | 'rigSpine';

/** The current state of everything that changes a bar's row count. Values are
 *  optional so a caller can describe only the bars its selection can open; a
 *  missing one falls back to the shortest reading, which is what an unopened
 *  bar of that kind would render. */
export interface SubmenuHeightContext {
  /** Tint bar: gradients add a stop editor, linear adds an angle slider. */
  tintType?: TintType;
  /** The Fill bar is the Tint bar pointed at a shape's interior. */
  svgFillType?: TintType;
  /** Crop bar: each framing mode brings its own rows. */
  cropMode?: ImageFramingMode;
  /** Crop bar: the source-resolution caption only renders when it's known. */
  cropHasResolution?: boolean;
  /** Border bar: which optional rows the image / frame border shows. */
  borderRows?: { radius: boolean; position: boolean };
  /** Stroke bar: the same bar, with the rows this vector subtype supports. */
  strokeRows?: { radius: boolean; position: boolean };
  /** Layout bar: whether the host wired up Grid, which adds the Arrange row. */
  layoutHasGrid?: boolean;
}

/** Total height of a stack of rows, including the gaps between them. */
function stack(rows: readonly number[]): number {
  if (rows.length === 0) return 0;
  return rows.reduce((sum, h) => sum + h, 0) + (rows.length - 1) * ROW_GAP;
}

/** A bar built the standard way: hairline, padding, header, then its rows.
 *  `below` is anything outside the row stack (the Crop bar's caption). */
function standardBar(rows: readonly number[], below = 0): number {
  return BAR_BORDER + BAR_PAD_TOP + BAR_HEADER + BAR_CONTROLS_TOP
    + stack(rows) + below + BAR_PAD_BOTTOM + BAR_CUSHION;
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

/** Border / Stroke rows: Width, the subtype's optional Radius and Position,
 *  then Dash. */
function borderRows(rows: { radius: boolean; position: boolean } = { radius: true, position: true }): number[] {
  return [
    ROW_SLIDER,
    ...(rows.radius ? [ROW_SLIDER] : []),
    ...(rows.position ? [ROW_SEGMENTED] : []),
    ROW_SLIDER,
  ];
}

/** Crop rows: Mode, then whatever that mode asks for. */
function cropRows(mode: ImageFramingMode = 'fill'): number[] {
  switch (mode) {
    case 'fit': return [ROW_SEGMENTED, ROW_SLIDER, HINT_HEIGHT];
    case 'crop': return [ROW_SEGMENTED, ROW_SEGMENTED, ROW_SLIDER];
    case 'tile': return [ROW_SEGMENTED, ROW_SLIDER, ROW_SLIDER];
    case 'fill':
    default: return [ROW_SEGMENTED, ROW_SLIDER, HINT_HEIGHT];
  }
}

/** How tall one submenu bar stands, given the state it will render from. */
export function submenuHeight(key: SubmenuKey, ctx: SubmenuHeightContext = {}): number {
  switch (key) {
    case 'tint':
      return standardBar(tintRows(ctx.tintType));
    case 'svgFill':
      return standardBar(tintRows(ctx.svgFillType));
    case 'border':
      return standardBar(borderRows(ctx.borderRows));
    case 'stroke':
      return standardBar(borderRows(ctx.strokeRows));
    case 'crop':
      return standardBar(cropRows(ctx.cropMode), ctx.cropHasResolution ? CROP_CAPTION_HEIGHT : 0);
    case 'opacity':
      return standardBar([ROW_SLIDER, ROW_SLIDER]);
    case 'rigHands':
    case 'rigFeet':
      // Left and Right, each with its own Twist, plus the line saying which
      // way the sliders run.
      return standardBar([ROW_SLIDER, ROW_SLIDER, ROW_SLIDER, ROW_SLIDER, HINT_HEIGHT]);
    case 'rigSpine':
      return standardBar([ROW_SLIDER, ROW_SLIDER, ROW_SLIDER, HINT_HEIGHT]);
    case 'rigRoot':
      // X, Y and Z, over the IK switch and the line under it.
      return standardBar([ROW_SLIDER, ROW_SLIDER, ROW_SLIDER, ROW_SEGMENTED, HINT_HEIGHT]);
    case 'endpoints':
      return standardBar([ROW_SEGMENTED, ROW_SEGMENTED, ROW_SEGMENTED]);
    case 'layout':
      // Horizontal and Vertical, plus Arrange when the host offers Grid.
      return standardBar([
        ROW_SEGMENTED, ROW_SEGMENTED,
        ...(ctx.layoutHasGrid ? [ROW_SEGMENTED] : []),
      ]);
    case 'font':
      // Font pill, Weight segmented, Size slider.
      return standardBar([ROW_PILL, ROW_SEGMENTED, ROW_SLIDER]);
    case 'align':
      // Char/Line sharing one slider row, then Align and Vertical.
      return standardBar([ROW_SLIDER, ROW_SEGMENTED, ROW_SEGMENTED]);
    case 'shadow':
      // The odd one out: its XY pad sits BESIDE three sliders rather than above
      // them, so the taller of the two columns sets the height — and its
      // container pads differently from the stacked bars.
      return BAR_BORDER + SHADOW_PAD_TOP + BAR_HEADER + SHADOW_CONTROLS_TOP
        + Math.max(SHADOW_PAD_SIZE, ROW_SLIDER * 3)
        + SHADOW_PAD_BOTTOM + BAR_CUSHION;
    default: {
      // Exhaustiveness guard: adding a SubmenuKey without giving it rows here
      // is a compile error, not a silently stunted bar.
      const unhandled: never = key;
      return unhandled;
    }
  }
}

/** How tall the bar layer stands for a selection: the tallest of the bars that
 *  selection can reach, so swiping the carousel never moves the bar's top edge
 *  — but a type whose bars are all short never reserves a taller type's room.
 *  Zero for a selection with no submenus at all. */
export function typeMenuHeight(keys: readonly SubmenuKey[], ctx: SubmenuHeightContext = {}): number {
  return keys.reduce((tallest, key) => Math.max(tallest, submenuHeight(key, ctx)), 0);
}
