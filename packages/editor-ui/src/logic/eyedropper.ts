// Pure geometry for the eyedropper overlay (Facet's EyedropperOverlay, with
// its ring metrics lifted verbatim). No react-native, no engine dep — the
// sampling itself is the host's job (see @/engine/eyedropperSnapshot), this
// only decides where the ring sits and whether a touch grabbed it.

/** Ring radius in px (the visible loupe outline). */
export const EYEDROPPER_RING_RADIUS = 32;
/** Ring stroke width in px — drawn in the currently sampled color. */
export const EYEDROPPER_RING_BORDER = 4;
/** Extra touch slop outside the ring so it stays grabbable on a phone. */
export const EYEDROPPER_TOUCH_PADDING = 16;
/** Diameter of the centre crosshair dot in px. */
export const EYEDROPPER_CROSSHAIR_SIZE = 4;

/** A point in canvas-local coordinates (top-left origin, px). */
export interface EyedropperPoint {
  x: number;
  y: number;
}

/** Where the ring appears when the eyedropper activates: the canvas centre,
 *  rounded so the first sample lands on a whole pixel. */
export function eyedropperStartPoint(canvasWidth: number, canvasHeight: number): EyedropperPoint {
  return { x: Math.round(canvasWidth / 2), y: Math.round(canvasHeight / 2) };
}

/** True when a canvas-local touch landed on the ring (plus its touch slop) —
 *  i.e. the press should start a drag rather than dismiss the eyedropper. */
export function isInsideEyedropperRing(
  ring: EyedropperPoint,
  x: number,
  y: number,
  padding: number = EYEDROPPER_TOUCH_PADDING,
): boolean {
  const dx = x - ring.x;
  const dy = y - ring.y;
  const reach = EYEDROPPER_RING_RADIUS + padding;
  return dx * dx + dy * dy <= reach * reach;
}

/** Keep the ring centre inside the canvas so it can never be dragged somewhere
 *  there are no pixels to sample. */
export function clampEyedropperPoint(
  x: number,
  y: number,
  canvasWidth: number,
  canvasHeight: number,
): EyedropperPoint {
  return {
    x: Math.max(0, Math.min(canvasWidth, x)),
    y: Math.max(0, Math.min(canvasHeight, y)),
  };
}
