// The image tabs of the ObjectPropertiesPanel's Edit sheet: the ordered
// list of image-specific pages plus the swipe threshold the panel's gestures
// share. Kept pure (no react-native) so the option order and swipe maths are
// unit-tested in node; the component only owns the animation.

/** The image-specific editing actions, in display order. Image leads — the
 *  photo ITSELF: which pixels these are (Replace) and what they are
 *  (resolution) — and the rest are visual adjustments to them, each opening
 *  its own page. Corner rounding lives inside the Border page (its Radius
 *  slider), so there is no standalone Round action. Opacity opens the
 *  Opacity page (whole-image opacity + edge soften). Tint was removed from
 *  the row: pages saved with a tint keep rendering it, but the page is gone.
 *
 *  `image` is SINGLE-TARGET, like `crop`: one photo to swap, one resolution
 *  to read. A multi-selection drops both. */
export type ImageEditAction =
  | 'image'
  | 'crop'
  | 'shadow'
  | 'border'
  | 'opacity';

/** The actions a MULTI-selection of images drops — the single-target ones. */
export function isSingleImageAction(action: ImageEditAction): boolean {
  return action === 'image' || action === 'crop';
}

export interface ImageEditOption {
  action: ImageEditAction;
  /** Short caption under the icon. */
  label: string;
  /** MaterialCommunityIcons glyph name. */
  icon: string;
}

export const IMAGE_EDIT_OPTIONS: readonly ImageEditOption[] = [
  { action: 'image', label: 'Image', icon: 'image-outline' },
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

/** The source-resolution line on the Image page, e.g. `3024 × 4032 px`.
 *  Null when the size is unknown or degenerate (a host that never learned
 *  the pixel dimensions), so the line is omitted rather than reading
 *  `0 × 0 px`. Dimensions are rounded — pixel counts are whole. */
export function formatPixelSize(
  size: { width: number; height: number } | undefined | null,
): string | null {
  if (!size) return null;
  const w = Math.round(size.width);
  const h = Math.round(size.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return `${w} × ${h} px`;
}
