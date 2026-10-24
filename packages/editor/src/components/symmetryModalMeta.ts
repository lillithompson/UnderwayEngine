// The canvas Symmetry modal's icon table — the glyph per mode key, read
// off the editor-ui symmetry grid (PATTERN_SYMMETRY_ENTRIES, which carries
// the keys, labels, glyphs and flag sets in the same 3-wide display order)
// and widened by the modal's own leading None cell. Kept
// icon-component-free in its own .ts module so node tests can import it,
// the TOOL_META pattern.

import {
  PATTERN_SYMMETRY_ENTRIES,
  PATTERN_SYMMETRY_OFF_ICON,
} from '@/editor-ui/logic/patternEdit';

/** The glyph per mode key ('mirrored' = drawn scaleX −1, the Diag \
 *  variant of the shared diagonal glyph).
 *
 *  DERIVED, not restated: the pattern's own Symmetry page draws the same
 *  eleven modes from the same entries, and a second hand-written table was
 *  a second chance for the two pictures of one mode to drift apart. Only
 *  'off' is added here — symmetry cleared, and the cell that reads active
 *  when no mode is on, which is the modal's own cell and not a grid entry. */
export const SYMMETRY_MODE_ICONS: Record<string, { icon: string; mirrored?: boolean }> = {
  off: { icon: PATTERN_SYMMETRY_OFF_ICON },
  ...Object.fromEntries(PATTERN_SYMMETRY_ENTRIES.map((e) => [
    e.key,
    e.mirrored ? { icon: e.icon, mirrored: true } : { icon: e.icon },
  ])),
};
