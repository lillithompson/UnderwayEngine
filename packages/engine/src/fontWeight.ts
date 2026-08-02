/**
 * The one place that maps a TextStyle's weight to a numeric CSS/font weight.
 * Used by every text renderer (DOM node layer, SVG export, raster cache key)
 * so a family's face selection stays consistent across canvas and export.
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
