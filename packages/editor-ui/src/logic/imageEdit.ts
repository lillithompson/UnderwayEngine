// The image-edit sub-panel that the ObjectPropertiesPanel's Edit action
// reveals when an image is selected: the ordered list of image-specific
// actions plus the swipe-to-dismiss threshold. Kept pure (no react-native)
// so the option order and dismiss maths are unit-tested in node; the
// component only owns the animation.

/** The image-specific editing actions, in display order. Replace swaps the
 *  image inside the same container; the rest are visual adjustments. */
export type ImageEditAction =
  | 'replace'
  | 'tint'
  | 'roundCorners'
  | 'crop'
  | 'shadow'
  | 'glow'
  | 'border';

export interface ImageEditOption {
  action: ImageEditAction;
  /** Short caption under the icon. */
  label: string;
  /** MaterialCommunityIcons glyph name. */
  icon: string;
}

export const IMAGE_EDIT_OPTIONS: readonly ImageEditOption[] = [
  { action: 'replace', label: 'Replace', icon: 'image-refresh-outline' },
  { action: 'tint', label: 'Tint', icon: 'palette-outline' },
  { action: 'roundCorners', label: 'Round', icon: 'rounded-corner' },
  { action: 'crop', label: 'Crop', icon: 'crop' },
  { action: 'shadow', label: 'Shadow', icon: 'box-shadow' },
  { action: 'glow', label: 'Glow', icon: 'flare' },
  { action: 'border', label: 'Border', icon: 'border-outside' },
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
