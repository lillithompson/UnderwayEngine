// Sizing for the canvas tap-target grid.
//
// WHY THIS EXISTS. On iOS 26, opening `<input type="file">` presents the
// upload options as a UIKit context menu (the device log shows
// _UIVariableGestureContextMenuInteraction driving a
// _UIContextMenuActionsOnlyViewController). That presentation paints a white
// disc behind the menu, and the disc's diameter is taken from the on-screen
// rect of the DOM element iOS hit-tested under the touch.
//
// The composition canvas made that disc enormous. Its page background lives
// inside the zoom-transformed world layer, so the touched element's on-screen
// size scaled with the camera: at default zoom the disc was about as wide as
// the sheet, zoomed in it swallowed the sheet whole, zoomed out it shrank to
// nothing. Tapping a small image node produced a correspondingly small disc,
// and the props-panel Replace button (since removed) — a ~64pt GridButton —
// produced one small enough to hide under the sheet entirely, which is why
// that path always looked clean.
//
// So the fix is to bound the size of whatever iOS hit-tests: a grid of small
// inert cells laid over the canvas in SCREEN space, so the touched element is
// always one cell and never scales with zoom. The canvas can afford this
// because it does not use DOM hit-testing at all — every pointer handler is
// bound to the container and picking is done in JS against engine state
// (hitTestAt → resolveCanvasTap). The cells are pure touch surface; events
// bubble to the container untouched.
//
// This is a workaround for a WebKit/UIKit presentation detail, not a design.
// The web side cannot configure WKFileUploadPanel, so bounding the source rect
// is the only lever available short of replacing the picker with a native one
// over the bridge.

/** Cell size. Small enough that the resulting disc hides under the sheet at
 *  every zoom level, large enough to keep the cell count trivial. */
export const TAP_TARGET_PX = 48;

/** Ceiling on cells. Only reachable on an absurd viewport; past it the cells
 *  grow rather than the count, so coverage is never silently dropped. */
export const MAX_TAP_TARGETS = 4096;

export interface TapTargetGrid {
  cols: number;
  rows: number;
  /** Cell edge in px — `TAP_TARGET_PX` unless MAX_TAP_TARGETS forced a grow. */
  tile: number;
  count: number;
}

/**
 * The grid needed to cover a `width`×`height` viewport.
 *
 * Cols/rows round UP: a partially covered strip at the right or bottom edge
 * would fall through to the full-size element underneath and bring the large
 * disc back for taps that land there. The caller sizes the layer to
 * `cols*tile` × `rows*tile` and lets the canvas container clip the overhang.
 */
export function tapTargetGrid(
  width: number,
  height: number,
  size: number = TAP_TARGET_PX,
): TapTargetGrid {
  const ok =
    Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
  if (!ok) return { cols: 0, rows: 0, tile: Math.max(1, size), count: 0 };

  let tile = Math.max(1, size);
  let cols = Math.ceil(width / tile);
  let rows = Math.ceil(height / tile);
  while (cols * rows > MAX_TAP_TARGETS) {
    tile *= 2;
    cols = Math.ceil(width / tile);
    rows = Math.ceil(height / tile);
  }
  return { cols, rows, tile, count: cols * rows };
}
