/**
 * The word-sticker (magnetic poetry) card look, in world cell units — the
 * single source of truth for the two renderers that draw it: the DOM node
 * layer (live editor) and the SVG exporter (journal images, .svg/.png
 * export, page thumbnails). Keeping the palette and metrics here is what
 * stops the exported image from drifting away from what the editor shows.
 *
 * Lengths are cells so each renderer scales them itself (the DOM layer by
 * its px-per-cell, the SVG generator by its units-per-cell). They were
 * authored as CSS px at {@link AUTHORED_PX_PER_CELL}, hence the divisions.
 */

/** Card face / text color of a normal sticker (and the text of an inverted one). */
export const STICKER_LIGHT = '#FFFFFF';
/** Card face / text color of an inverted sticker (and the text of a normal one). */
export const STICKER_DARK = '#000000';

/** px-per-cell the card's CSS lengths below were authored against. */
const AUTHORED_PX_PER_CELL = 16;

/** Card border width (cells) — the DOM layer's `1px solid`. */
export const STICKER_BORDER_CELLS = 1 / AUTHORED_PX_PER_CELL;

/** Card drop shadow (cells) — the DOM layer's `1px 2px 3px rgba(0,0,0,0.4)`. */
export const STICKER_SHADOW_CELLS = {
  dx: 1 / AUTHORED_PX_PER_CELL,
  dy: 2 / AUTHORED_PX_PER_CELL,
  /** CSS blur radius; a Gaussian σ is half of it. */
  blur: 3 / AUTHORED_PX_PER_CELL,
  opacity: 0.4,
};

/**
 * Card and text colors for a sticker. A sticker's scheme is fixed
 * black-on-white (or the inverse), ignoring `TextStyle.color` — the invert
 * toggle owns a sticker's color entirely.
 */
export function stickerColors(invert: boolean | undefined): { bg: string; fg: string } {
  return invert
    ? { bg: STICKER_DARK, fg: STICKER_LIGHT }
    : { bg: STICKER_LIGHT, fg: STICKER_DARK };
}
