import { OBJECT_PANEL_HEIGHT } from '../theme';

// Bottom-edge layout for the object-properties panel and its slide-up submenus.
//
// Both surfaces end in a row of carousel dots. Where those dots sit depends on
// the device: on a notched phone they drop *into* the home-indicator strip (the
// "unsafe" space at the very bottom) rather than sitting above it, so the panel
// reclaims the dot row's height and the whole sheet reads shorter. With no
// inset (desktop web) there is no strip to drop into, so the dots stay in flow.
// Callers pass `dotsInSafeArea` — keyed off a measured inset, not the platform:
// the editor runs as the web bundle even inside the native iOS WebView.

/** Carousel dot diameter. */
export const OBJECT_DOT_SIZE = 12;
/** Dot row box: paddingTop (4) + dot + paddingBottom (8). */
export const OBJECT_DOTS_ROW_HEIGHT = 4 + OBJECT_DOT_SIZE + 8;

/** Panel box for a given inset. `height` is the full slide distance (so the
 *  hidden position clears the screen edge); `paddingBottom` keeps the button
 *  row clear of the inset — zero when the dots have taken the strip over, since
 *  the strip is then part of the panel's own content. */
export function objectPanelLayout(safeBottom: number, dotsInSafeArea: boolean): { height: number; paddingBottom: number } {
  if (!dotsInSafeArea) {
    return { height: OBJECT_PANEL_HEIGHT + safeBottom, paddingBottom: safeBottom };
  }
  // The strip replaces the dot row — unless it is shorter than the dots need,
  // in which case the dots set the floor and nothing is reclaimed.
  return {
    height: OBJECT_PANEL_HEIGHT - OBJECT_DOTS_ROW_HEIGHT + Math.max(safeBottom, OBJECT_DOTS_ROW_HEIGHT),
    paddingBottom: 0,
  };
}

/** Offset of the submenu dots from the bottom of the slide-up layer: clear of
 *  the inset normally, inside it when the dots take the strip over. */
export function submenuDotsBottom(safeBottom: number, dotsInSafeArea: boolean): number {
  return (dotsInSafeArea ? 0 : safeBottom) + 8;
}
