// How wide a control FLOATED under the toolbar draws its track.
//
// The brush panel's slider is 260 wide (editor-ui BrushControlsPanel's own
// private TRACK_W), and the rows that float in the under-toolbar slot match
// it so every control a hand moves between is the same size and sits over
// the same part of the screen. Here that is the brush's hue row
// (BrushColorRow); an app with another such row reads this number for it —
// DrawBots' run Speed row (SimSpeedRow) does.
//
// One number, named once. It was DrawBots' module, where the two rows had
// had a copy each, "which is how a third would have appeared" — and a third
// nearly did: stage 6.5a of docs/shared-editor.md moved BrushColorRow here
// with the literal written back out, which is the copy this module exists
// to prevent, so the module came too.
export const FLOATING_ROW_TRACK_W = 260;
