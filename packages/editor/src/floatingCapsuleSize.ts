// How wide the floating actions capsule comes out — the pill in the bottom
// slot that the pattern grid's Flood | Close | Clear and the multi-selection's
// Group | Merge | Layout | Done both wear (components/PatternActionsCapsule's
// FloatingActionsCapsule) — and how the under-toolbar MODE capsule
// (components/ToolModeCapsule) lays its segments out when a row would not fit.
//
// Here, apart from the component, because the component imports react-native
// and cannot be loaded in a node test — the same reason multiSelectionCapsule
// keeps the segment SET out of it. The sizing is the one thing about that
// pill that can go wrong without anyone seeing it in code review: the
// segments are a FIXED width and the pill is one row that cannot wrap, so
// every word added makes it wider by a whole segment, and past a point it
// runs off a small screen.

/** A fixed segment's width, in pt (ActionSegment's `segmentFixed`). The
 *  multi-word capsules share it so their words line up; a `hugLabels`
 *  capsule sizes to its text instead and is not measured here. */
export const FLOATING_SEGMENT_WIDTH = 72;

/** The smallest side Apple's HIG gives a touch target, in pt. The floor
 *  for a press target in this chrome, whatever the art inside it measures. */
export const MIN_TOUCH_TARGET = 44;

/** A GLYPH-faced segment's width (ActionSegment's `segmentGlyph`) —
 *  DrawBot's playback controls' pills are the glyph-faced ones. 56 pt: wider
 *  than the HIG minimum (MIN_TOUCH_TARGET) by a comfortable margin, since
 *  these are pressed mid-run with an eye on the canvas, not the pill; the
 *  44 pt square they first wore read as cramped (owner, 2026-10-08). Still
 *  narrower than a word's 72 pt: a media-player triangle needs no word's
 *  room, and at that width the controls read as far bigger than they are.
 *
 *  The segment's HEIGHT is the pill's (FLOATING_CAPSULE_HEIGHT, 37 pt) and
 *  is a couple of pt under the minimum — raising it would resize every
 *  floating capsule in the chrome, so it stands. */
export const FLOATING_SEGMENT_GLYPH_WIDTH = 56;

/** The narrowest viewport the app is built for — an iPhone SE at 320 pt.
 *  What the pill has to fit inside, edge to edge. */
export const NARROWEST_PHONE_PX = 320;

/** What a capsule of `segments` fixed-width segments measures across: the
 *  segments themselves, a hairline divider between each pair, and the pill's
 *  own 2 pt border on each side. `segmentWidth` defaults to a word's;
 *  pass FLOATING_SEGMENT_GLYPH_WIDTH for a glyph pill like the transport. */
export function floatingCapsuleWidthPx(
  segments: number,
  segmentWidth: number = FLOATING_SEGMENT_WIDTH,
): number {
  return segments * segmentWidth + Math.max(0, segments - 1) + 4;
}

// ── The under-toolbar mode capsule (ToolModeCapsule) ───────────────
//
// That capsule's segments size to their content, and a host's row of glyph
// segments — DrawBot's Inklings row, nine glyphs then, seven since
// 2026-10-08 — came out wider than a phone held upright, so it ran off
// both edges (DrawBot bug d2307b58). It WRAPS when it must: when the one
// row would not fit the window, the segments split into the fewest
// balanced rows that do, stacked inside the same pill. But one row is what
// the owner wants (DrawBot bug 2f925f36: "put them all on one line"), so
// before wrapping the row first TIGHTENS — each segment's side padding
// comes down, as far as TOOL_MODE_SEGMENT_PAD_H_MIN, until the row fits.
// Only a row that does not fit even at that floor wraps (at the full
// padding). The widths here
// are estimates made before layout (a word's is a character count times an
// average advance), which is all the split needs: it decides a padding and
// a row count, and the rows themselves are laid out by flex.

/** A segment's side padding (ToolModeCapsule's own). */
export const TOOL_MODE_SEGMENT_PAD_H = 14;
/** The tightest that padding goes to keep a capsule on one row. At 9 a
 *  glyph segment is 40 pt across — seven of them fit a 393 pt phone with
 *  the cycle arrows up. Under that the glyphs crowd each other, and the
 *  row wraps instead. */
export const TOOL_MODE_SEGMENT_PAD_H_MIN = 9;
/** The swatch disc / tile art / glyph inside a non-word segment. */
export const TOOL_MODE_SEGMENT_ART_SIZE = 22;
/** The width the cycle arrows add each side of the pill: the press target
 *  and the gap between it and the pill's edge. */
export const TOOL_MODE_ARROW_SPAN = 34 + 6;
/** Room kept clear between the pill (or its arrows) and each screen edge. */
export const TOOL_MODE_SCREEN_MARGIN = 8;
/** A word's average advance per character, as a fraction of its font size
 *  — a semibold sans runs a little over half an em. */
const WORD_ADVANCE_EM = 0.6;

/** What a segment's content asks for: a word, or a fixed piece of art. */
export interface ToolModeSegmentContent {
  label: string;
  /** Set for a swatch / tile / glyph segment: the art, not the word, is
   *  its face. */
  art?: boolean;
  /** A swatch segment's fixed width, overriding the padded art. */
  fixedWidth?: number;
}

/** One segment's estimated width, padding included (`padH` each side; a
 *  fixed-width swatch ignores it). */
export function toolModeSegmentWidthPx(
  seg: ToolModeSegmentContent,
  fontSize: number,
  padH: number = TOOL_MODE_SEGMENT_PAD_H,
): number {
  if (seg.fixedWidth !== undefined) return seg.fixedWidth;
  const content = seg.art
    ? TOOL_MODE_SEGMENT_ART_SIZE
    : Math.ceil(seg.label.length * fontSize * WORD_ADVANCE_EM);
  return content + padH * 2;
}

/** A row's width inside the pill: its segments, a hairline between each
 *  pair, and the pill's 2 pt border each side. */
function rowWidthPx(widths: readonly number[]): number {
  return widths.reduce((s, w) => s + w, 0) + Math.max(0, widths.length - 1) + 4;
}

/**
 * How many segments go on each row: one row when it fits `availablePx`,
 * else the fewest balanced rows (front rows take the extra one) whose
 * widest row fits. A row of one that still does not fit is as far as a
 * split can go, so the result never has more rows than segments.
 */
export function capsuleRowCounts(widths: readonly number[], availablePx: number): number[] {
  const n = widths.length;
  if (n === 0) return [];
  for (let rows = 1; rows <= n; rows++) {
    const counts: number[] = [];
    const base = Math.floor(n / rows);
    const extra = n % rows;
    for (let r = 0; r < rows; r++) counts.push(base + (r < extra ? 1 : 0));
    let at = 0;
    let fits = true;
    for (const c of counts) {
      if (rowWidthPx(widths.slice(at, at + c)) > availablePx) { fits = false; break; }
      at += c;
    }
    if (fits) return counts;
  }
  return widths.map(() => 1);
}

/** The width a mode capsule may take in a window `windowPx` wide: the
 *  window less its edge margins, and less the arrows when they flank it. */
export function toolModeCapsuleAvailablePx(windowPx: number, withArrows: boolean): number {
  return windowPx - 2 * TOOL_MODE_SCREEN_MARGIN - (withArrows ? 2 * TOOL_MODE_ARROW_SPAN : 0);
}

/** How a mode capsule lays out: the side padding its segments wear and how
 *  many go on each row. */
export interface ToolModeCapsuleLayout {
  padH: number;
  rowCounts: number[];
}

/**
 * One row at the full padding when it fits; else one row at the widest
 * padding (whole pt, no tighter than TOOL_MODE_SEGMENT_PAD_H_MIN) that
 * fits; else the wrap (`capsuleRowCounts`) at the full padding.
 */
export function toolModeCapsuleLayout(
  segments: readonly ToolModeSegmentContent[],
  fontSize: number,
  availablePx: number,
): ToolModeCapsuleLayout {
  const full = segments.map((s) => toolModeSegmentWidthPx(s, fontSize));
  if (segments.length === 0 || rowWidthPx(full) <= availablePx) {
    return { padH: TOOL_MODE_SEGMENT_PAD_H, rowCounts: segments.length ? [segments.length] : [] };
  }
  const padded = segments.filter((s) => s.fixedWidth === undefined).length;
  if (padded > 0) {
    // The row's width at no padding, then what is left shared out as
    // padding between the padded segments' two sides.
    const bare = rowWidthPx(segments.map((s) => toolModeSegmentWidthPx(s, fontSize, 0)));
    const padH = Math.min(TOOL_MODE_SEGMENT_PAD_H, Math.floor((availablePx - bare) / (2 * padded)));
    if (padH >= TOOL_MODE_SEGMENT_PAD_H_MIN) return { padH, rowCounts: [segments.length] };
  }
  return { padH: TOOL_MODE_SEGMENT_PAD_H, rowCounts: capsuleRowCounts(full, availablePx) };
}
