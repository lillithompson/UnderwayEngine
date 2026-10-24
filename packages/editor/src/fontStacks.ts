/**
 * The app's two faces, as the DOM asks for them.
 *
 * theme.ts names each face the way React Native does — one family per
 * weight (`Karla_600SemiBold`), no fallbacks — and the editor is plain
 * DOM, where a family that has not loaded silently becomes Times. So each
 * stack is the registered face first, then the family by its plain name
 * (a system install), then the last-resort generic.
 *
 * Said ONCE here because the editor's DOM had the same four literals
 * written out at four call sites, and a stack that disagrees with the
 * app's is a screen in the wrong typeface with nothing to show for it.
 */
import { FONT_BODY, FONT_BODY_SEMI, FONT_DISPLAY } from '@/editor-ui/appTheme';

/** Newsreader — titles and page headings. */
export const FONT_DISPLAY_CSS = `${FONT_DISPLAY}, Newsreader, Georgia, serif`;

/** Karla — body copy, labels, the small print. */
export const FONT_BODY_CSS = `${FONT_BODY}, Karla, sans-serif`;

/** …and Karla's semibold, for a label that has to carry. */
export const FONT_BODY_SEMI_CSS = `${FONT_BODY_SEMI}, Karla, sans-serif`;
