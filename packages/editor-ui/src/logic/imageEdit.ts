// The image-edit sub-panel that the ObjectPropertiesPanel's Edit action
// reveals when an image is selected: the ordered list of image-specific
// bars plus the swipe-to-dismiss threshold. Kept pure (no react-native)
// so the option order and dismiss maths are unit-tested in node; the
// component only owns the animation.

/** The image-specific editing actions, in display order — all of them visual
 *  adjustments, each opening its own bar. Corner rounding lives inside the
 *  Border panel (its Radius slider), so there is no standalone Round action.
 *  Opacity opens the Opacity bar (whole-image opacity + edge soften).
 *  Swapping an image's pixels is not an option here: replace-in-place is
 *  reached by tapping an unfilled photo placeholder, not from this row. */
export type ImageEditAction =
  | 'tint'
  | 'crop'
  | 'shadow'
  | 'border'
  | 'opacity';

export interface ImageEditOption {
  action: ImageEditAction;
  /** Short caption under the icon. */
  label: string;
  /** MaterialCommunityIcons glyph name. */
  icon: string;
}

export const IMAGE_EDIT_OPTIONS: readonly ImageEditOption[] = [
  { action: 'tint', label: 'Tint', icon: 'palette-outline' },
  { action: 'crop', label: 'Crop', icon: 'crop' },
  { action: 'shadow', label: 'Shadow', icon: 'box-shadow' },
  { action: 'border', label: 'Border', icon: 'border-outside' },
  { action: 'opacity', label: 'Opacity', icon: 'opacity' },
];

/** Horizontal travel (px, either direction) that commits a dismiss. Matched
 *  to TitleBanner's SWIPE_DISMISS_PX so the two swipes feel identical. */
export const IMAGE_EDIT_SWIPE_DISMISS_PX = 56;

/** Which way a release throws the sub-panel given the signed drag delta:
 *  −1 = off the left edge, +1 = off the right edge, 0 = snap back into place. */
export function swipeDismissDirection(
  dragDx: number,
  thresholdPx: number = IMAGE_EDIT_SWIPE_DISMISS_PX,
): -1 | 0 | 1 {
  if (dragDx <= -thresholdPx) return -1;
  if (dragDx >= thresholdPx) return 1;
  return 0;
}

/** The source-resolution caption at the bottom of the Crop bar, e.g.
 *  `3024 × 4032 px`. Null when the size is unknown or degenerate (a host that
 *  never learned the pixel dimensions), so the line is omitted rather than
 *  reading `0 × 0 px`. Dimensions are rounded — pixel counts are whole. */
export function formatPixelSize(
  size: { width: number; height: number } | undefined | null,
): string | null {
  if (!size) return null;
  const w = Math.round(size.width);
  const h = Math.round(size.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return `${w} × ${h} px`;
}
