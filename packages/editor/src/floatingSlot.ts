import { FLOATING_SLIDER_BOTTOM } from '@/editor-ui/logic/submenuHeight';

// Where the FLOATING SLOT at the foot of the canvas seats what stands in
// it: the pattern actions capsule, a multi-selection's capsule, the
// selection tool's Rotate slider, the lower-right radial target, and a
// host's own pills (DrawBots' transport). ONE formula, so everything in
// the slot rises together and stays aligned when the properties panel
// pushes up — and one a host can stack on (DrawBots stands its Speed row
// over its pill while a run goes, docs/live_edit.md §4.6) without a copy
// of the arithmetic. It lived in PatternActionsCapsule, the first tenant,
// and ArrangeRotateSlider carried a second spelling of it.

/** Clearance between a tenant and whatever it floats above — the rig
 *  slider's own gap (RigControlsPanel.TURN_GAP). */
export const FLOATING_SLOT_GAP = 12;

/** The slot's seat: above whatever the object-properties panel claims
 *  (`panelPx`, its onOccludedHeight report), never below the slider row's
 *  own bottom line (`FLOATING_SLIDER_BOTTOM` off the safe area). */
export function floatingSlotAnchor(panelPx: number, safeBottom: number): number {
  return Math.max(panelPx + FLOATING_SLOT_GAP, safeBottom + FLOATING_SLIDER_BOTTOM);
}
