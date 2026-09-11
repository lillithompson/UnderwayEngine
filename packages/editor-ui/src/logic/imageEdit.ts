// The image tabs of the ObjectPropertiesPanel's Edit sheet: the ordered
// list of image-specific pages plus the swipe threshold the panel's gestures
// share. Kept pure (no react-native) so the option order and swipe maths are
// unit-tested in node; the component only owns the animation.

/** The image-specific editing actions, in display order — all of them visual
 *  adjustments, each opening its own page. Corner rounding lives inside the
 *  Border page (its Radius slider), so there is no standalone Round action.
 *  Opacity opens the Opacity page (whole-image opacity + edge soften).
 *  Swapping an image's pixels is not an option here: replace-in-place is
 *  reached by tapping an unfilled photo placeholder (and the floating
 *  Replace capsule), not from this row. Tint was removed from the row:
 *  pages saved with a tint keep rendering it, but the page is gone. */
export type ImageEditAction =
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
  { action: 'crop', label: 'Crop', icon: 'crop' },
  { action: 'shadow', label: 'Shadow', icon: 'box-shadow' },
  { action: 'border', label: 'Border', icon: 'border-outside' },
  { action: 'opacity', label: 'Opacity', icon: 'opacity' },
];

/** Travel (px, either direction) that commits a swipe — the panel's sideways
 *  swipe that pops the Edit sheet up, and the downward one that drops it.
 *  Matched to TitleBanner's SWIPE_DISMISS_PX so the swipes feel identical. */
export const IMAGE_EDIT_SWIPE_DISMISS_PX = 56;

/** Which way a release throws given the signed drag delta along one axis:
 *  −1 = past the threshold negative (left / up), +1 = positive (right /
 *  down), 0 = too short, snap back into place. */
export function swipeDismissDirection(
  dragDx: number,
  thresholdPx: number = IMAGE_EDIT_SWIPE_DISMISS_PX,
): -1 | 0 | 1 {
  if (dragDx <= -thresholdPx) return -1;
  if (dragDx >= thresholdPx) return 1;
  return 0;
}
