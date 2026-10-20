// The editor's single "active color": the swatch the toolbar shows, and the
// color every newly created stroke or border starts in — drawn paths, the
// line / arc / rectangle / circle shapes, and the Border bar's first border.
//
// One color, set from anywhere. Confirming a color in ANY tool's settings
// (the color tool, Stroke, Border, Drop Shadow, Tint, Text, a frame's
// Background, or the pattern studio) makes that color active, so the next
// stroke or border continues in the color the user was just working with
// instead of snapping back to a fixed default.
//
// And it outlives the page. The last color chosen is persisted
// (AppSettings.lastColor) and seeds the next page of ANY format, exactly as
// the last-chosen font does (fontPreference.ts): a user who works in red
// keeps working in red across files rather than re-picking it every time they
// start something.

import { BorderEffect, RGBColor } from '@/engine/types';
import { parseHexColor, rgbToHexColor } from './colorUtils';

/** White — the palette's first swatch (#FFFFFF, COLOR_PALETTE[0]), so the
 *  starting color is one the picker can round-trip to exactly. */
export const DEFAULT_ACTIVE_COLOR: RGBColor = { r: 255, g: 255, b: 255 };

/** The border width a freshly opened Border / Stroke bar starts at:
 *  6pt in world cells (design pt ÷ BASE_CELL_PX 16). */
export const DEFAULT_BORDER_WIDTH_CELLS = 0.375;

/**
 * The color a freshly opened page starts in, given the persisted last-chosen
 * color. Falls back to {@link DEFAULT_ACTIVE_COLOR} when nothing has been
 * chosen yet (absent) or the stored text is not a color — a page never opens
 * on a half-parsed hex.
 *
 * `openingColor` is a format's own declared starting ink (EditorConfig's
 * `openingColor`), and it OUTRANKS the remembered one: a format that names a
 * color is saying every page of it opens there, which the carry-across-files
 * memory would otherwise quietly override on the second visit. It is still
 * only a STARTING point — the first pick of the session replaces it, and is
 * remembered as usual.
 *
 * An unparseable opening color falls through to the remembered one rather
 * than to the default, so a typo in a config costs the format its opening
 * ink and nothing else.
 *
 * `keepLastColor` turns that ranking round for a page that has already been
 * STARTED: the opening ink is where a page BEGINS, so once the drawer has
 * opened one and picked a colour in it, re-opening it must not drag the
 * swatch back off their pick. Set by the shell for a PERSONAL opening ink
 * (EditorConfig.openingColorIsPersonal — the drawer's own colour on a
 * reaction or a redline, which seeds the start of the page and nothing
 * after it) and never for a format's own tint, which every page of that
 * game opens in. The opening ink still stands where nothing is remembered:
 * yielding to a colour that isn't there would open a reaction in white.
 */
export function resolveActiveColor(
  lastColor: string | null | undefined,
  openingColor?: string | null,
  opts?: { keepLastColor?: boolean },
): RGBColor {
  const opening = openingColor ? parseHexColor(openingColor) : null;
  const last = lastColor ? parseHexColor(lastColor) : null;
  if (opts?.keepLastColor && last) return last;
  if (opening) return opening;
  return last ?? DEFAULT_ACTIVE_COLOR;
}

/** How the active color is persisted: '#RRGGBB'. A string rather than an
 *  {r,g,b} record so the settings blob stays small and human-readable, and so
 *  a corrupt value is simply unparseable (see resolveActiveColor) rather than
 *  a partial color. */
export function storedActiveColor(color: RGBColor): string {
  return rgbToHexColor(color);
}

/** Keep only r/g/b. The pickers hand back their own color objects; storing
 *  one verbatim would carry whatever else it happens to hold into the
 *  document (and into its JSON). */
export function toRGB(color: RGBColor): RGBColor {
  return { r: color.r, g: color.g, b: color.b };
}

// ── Recently used colors ────────────────────────────────────────────
// The colour picker's ONE swatch row, after the eyedropper: the seven
// colours last worked in, most recent first. It is the whole palette the
// picker offers — the fixed nine-swatch grid it used to show underneath is
// gone, because a row that answers "the colours I am using" is worth more
// of that space than one that answers "the colours this app shipped with".
//
// A colour counts as USED when the picker closes on it (EditorShell's
// onConfirm), not while the wheel is being dragged: the row must not
// reshuffle under the finger that is picking from it, and a sweep of a hue
// handle is one colour chosen, not fifty. Persisted beside lastColor
// (AppSettings.recentColors) so the palette a user actually works in
// follows them across pages.

/** Cap on remembered recent colors — the picker's row beside its
 *  eyedropper. Push an eighth and the rightmost falls off the end. */
export const RECENT_COLORS_MAX = 7;

/** What the row holds before anyone has picked anything, and what a short
 *  stored list is padded back up to: a spectrum to start from, in the order
 *  the row reads. They are exact sRGB primaries so the wheel round-trips to
 *  each one precisely, and tapping one puts that colour at the head like
 *  any other pick. */
export const DEFAULT_RECENT_COLORS: readonly RGBColor[] = [
  { r: 255, g: 255, b: 255 }, // white
  { r: 0, g: 0, b: 0 },       // black
  { r: 255, g: 0, b: 0 },     // red
  { r: 255, g: 255, b: 0 },   // yellow
  { r: 0, g: 255, b: 0 },     // green
  { r: 0, g: 0, b: 255 },     // blue
  { r: 148, g: 0, b: 255 },   // purple
];

/** Add a closed picker's colour to the front of the row: exact-RGB dupes
 *  collapse into the new head (a re-pick refreshes recency, never repeats a
 *  swatch), and the rightmost falls off past {@link RECENT_COLORS_MAX}. */
export function pushRecentColor(recent: readonly RGBColor[], color: RGBColor): RGBColor[] {
  const rgb = toRGB(color);
  const rest = recent.filter((c) => !sameRGB(c, rgb));
  return [rgb, ...rest].slice(0, RECENT_COLORS_MAX);
}

const sameRGB = (a: RGBColor, b: RGBColor) => a.r === b.r && a.g === b.g && a.b === b.b;

/** Parse the persisted recent list ('#RRGGBB', newest first), then pad the
 *  tail from {@link DEFAULT_RECENT_COLORS} so the row is always its full
 *  width. Unparseable entries are dropped rather than poisoning the rest,
 *  same contract as {@link resolveActiveColor}; nothing stored at all (a
 *  fresh install) is simply an empty list padded to the whole spectrum.
 *
 *  Padding SKIPS defaults already remembered, so a user who picked red
 *  keeps one red — at the head, where their pick put it — rather than
 *  meeting it again further down the row. */
export function resolveRecentColors(stored: readonly string[] | null | undefined): RGBColor[] {
  const out: RGBColor[] = [];
  for (const hex of stored ?? []) {
    const c = parseHexColor(hex);
    if (c && !out.some((o) => sameRGB(o, c))) out.push(c);
    if (out.length >= RECENT_COLORS_MAX) break;
  }
  for (const d of DEFAULT_RECENT_COLORS) {
    if (out.length >= RECENT_COLORS_MAX) break;
    if (!out.some((o) => sameRGB(o, d))) out.push(d);
  }
  return out;
}

/** How the recent list is persisted: '#RRGGBB' per entry, newest first. */
export function storedRecentColors(recent: readonly RGBColor[]): string[] {
  return recent.slice(0, RECENT_COLORS_MAX).map(rgbToHexColor);
}

/**
 * The border materialized when the Border controls are first opened on an
 * object that has none: a 6pt centered solid stroke in the active color.
 */
export function defaultBorderEffect(color: RGBColor = DEFAULT_ACTIVE_COLOR): BorderEffect {
  return {
    width: DEFAULT_BORDER_WIDTH_CELLS,
    position: 'center',
    dash: 0,
    color: toRGB(color),
  };
}
