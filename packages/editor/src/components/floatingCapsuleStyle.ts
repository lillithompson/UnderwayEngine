import { CAPSULE_SIZE } from '@/editor-ui/theme';

// THE look of a floating over-canvas capsule — the mode capsule, the
// pattern actions capsule, the slider-mode target, the notice and the
// no-paintables hint all wear exactly these, so the pieces of chrome
// cannot drift apart. In CozyJournal they were exported by the rig's
// Sides capsule (RigSidesCapsule.tsx), the first such pill, which reads
// them from here now; DrawBot, having no rig, kept them on their own in
// this file, and that is the arrangement every app takes.

/** Scale on the capsule column's own metrics — a floating pill sits UNDER
 *  the toolbar over the page, where a full-size control crowded the
 *  drawing, so it is drawn a size down from the buttons it hangs beneath. */
export const FLOATING_CAPSULE_SCALE = 0.85;
const SCALE = FLOATING_CAPSULE_SCALE;
/** The word-in-a-segment width, so every floating radio pill sizes its
 *  segments alike. */
export const FLOATING_CAPSULE_SEGMENT_WIDTH = Math.round(66 * SCALE);
export const FLOATING_CAPSULE_HEIGHT = Math.round(CAPSULE_SIZE * SCALE);
export const FLOATING_CAPSULE_FONT_SIZE = Math.round(13 * SCALE);
/** A GLYPH-faced segment's icon size, in pt — the slider-mode target's
 *  own, so an icon in a floating pill (DrawBot's transport's play /
 *  pause / stop / step pair) reads the same weight as the icon in the
 *  target beside it. */
export const FLOATING_CAPSULE_GLYPH_SIZE = 20;

/** The chrome ink — the slider-mode target's own. */
export const FLOATING_CAPSULE_INK = 'rgba(0,0,0,0.6)';
/** The hairline between the segments: the same ink, quieter than the rim. */
export const FLOATING_CAPSULE_DIVIDER = 'rgba(0,0,0,0.25)';
/** The pill's ground — a flat light grey, a step down from the canvas
 *  (BG_EDITOR_CANVAS) so the capsule stands apart from bare canvas behind
 *  it without going dark. */
export const FLOATING_CAPSULE_BG = '#D9D9D9';

// ── A MUTED segment ────────────────────────────────────────────────

/** The ink of a MUTED segment's word or glyph — one on the row but not on
 *  offer right now (`muted` on ToolModeCapsule, still tappable, and on
 *  PatternActionsCapsule — DrawBot's transport row — which refuses the
 *  press). The chrome's own ink, faded to the weight of the divider
 *  between the segments: the segment is still read, but it no longer looks
 *  like a choice that would land. */
export const FLOATING_CAPSULE_INK_MUTED = 'rgba(0,0,0,0.3)';
/** …and the wash over its ground, so the greying reads as the SEGMENT's
 *  and not as a glyph that happens to be pale. A hair darker than the
 *  pill's own grey — the muted segments sit between lit ones, and a
 *  lighter wash would read as a highlight. */
export const FLOATING_CAPSULE_MUTED_BG = 'rgba(0,0,0,0.07)';
