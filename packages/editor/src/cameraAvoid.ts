/**
 * Scroll-into-view for the selection: when bottom-anchored UI (the object
 * properties panel, or one of its taller submenus) claims part of the
 * screen, compute the camera that slides the selected object's bbox just
 * above it. Pure math — the canvas animates toward the returned camera (see
 * CanvasSurface's camera-avoid effect); this module owns only the target.
 *
 * The pan is vertical-only and one-directional: it returns a camera exactly
 * when the selection's bottom edge is occluded, and never proposes scrolling
 * back down when the UI closes (the object is visible either way, and
 * bouncing the page on every submenu dismiss would read as jumpy).
 */

import { Camera, Viewport } from '@/engine/types';
import { panBy, worldToScreen } from './cameraMath';
import type { CellBbox } from '@/editor/resizeMath';

/** Breathing room between the selection's bottom edge and the UI's top edge
 *  (and between its top edge and the top chrome when clamped). */
export const CAMERA_AVOID_MARGIN_PX = 12;

/**
 * What bottom-anchored UI the camera must currently avoid, as the shell
 * reports it. Native shell only — on desktop web the panel is short relative
 * to the window and an unasked-for scroll reads as the page moving on its
 * own. While a text edit is live the properties panel is hidden (the two
 * bottom sheets never stack) and the KEYBOARD is the occluder — its measured
 * inset drives the glide, so the edited text object rides just above the
 * keyboard as it animates in, iOS-Photos style.
 */
export function shellAvoidBottomPx(input: {
  native: boolean;
  editingText: boolean;
  keyboardInsetPx: number;
  panelOccludedPx: number;
}): number {
  if (!input.native) return 0;
  return input.editingText ? input.keyboardInsetPx : input.panelOccludedPx;
}

/**
 * The camera that places `bbox` just above the occluded bottom strip, or
 * null when no scroll is needed (nothing occluded, the object already
 * clears the UI, or the object's top edge is already against the chrome so
 * there is nowhere to go).
 *
 * A selection taller than the visible gap scrolls only until its TOP edge
 * reaches `topChromePx` + margin — keeping the object's start on screen
 * beats fully clearing the panel it cannot fit above anyway.
 */
export function cameraAvoidingBottomInset(
  camera: Camera,
  viewport: Viewport,
  bbox: CellBbox,
  occludedBottomPx: number,
  topChromePx: number = 0,
  marginPx: number = CAMERA_AVOID_MARGIN_PX,
): Camera | null {
  if (occludedBottomPx <= 0) return null;
  const topY = worldToScreen(bbox.cellX, bbox.cellY, camera, viewport).y;
  const bottomY = worldToScreen(bbox.cellX, bbox.cellY + bbox.cellHeight, camera, viewport).y;
  const visibleBottom = viewport.height - occludedBottomPx - marginPx;
  const overflow = bottomY - visibleBottom;
  if (overflow <= 0) return null;
  const maxShift = topY - (topChromePx + marginPx);
  const dy = Math.min(overflow, maxShift);
  if (dy <= 0) return null;
  return panBy(camera, 0, -dy);
}
