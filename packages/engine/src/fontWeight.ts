/**
 * The one place that maps a TextStyle's weight to a numeric CSS/font weight,
 * and the one place that spells the fallback family tail. Used by every text
 * renderer (DOM node layer, SVG export, raster cache key) so a family's face
 * selection stays consistent across canvas and export.
 */

import { FontWeight, TextStyle } from './types';

/** Named weight → numeric font-weight (closest common face). */
export const FONT_WEIGHT_NUMERIC: Record<FontWeight, number> = {
  light: 300,
  regular: 400,
  semibold: 600,
  bold: 700,
};

/** Resolve a style's effective numeric weight: the named `weight` when set,
 *  otherwise the legacy `bold` boolean (700/400) for older compositions. */
export function effectiveFontWeight(style: Pick<TextStyle, 'weight' | 'bold'>): number {
  if (style.weight) return FONT_WEIGHT_NUMERIC[style.weight];
  return style.bold ? 700 : 400;
}

/**
 * The warm system tail every family falls back to — what `fontId: 'system'`
 * (and an un-embedded family) lands on.
 *
 * Here because the DOM preview and the SVG export have to agree: a text node
 * must look the same in the editor and in what it exports. The two spell it
 * differently only in quoting — CSS takes `'`, an XML attribute takes
 * `&apos;` — so the export derives its form from this one
 * (`compositionSVGCore`) and the editor's `fontFamily.ts` uses it as the
 * answer when an app has installed no pack.
 */
export const SYSTEM_FAMILY_STACK = "system-ui, -apple-system, 'Segoe UI', sans-serif";
