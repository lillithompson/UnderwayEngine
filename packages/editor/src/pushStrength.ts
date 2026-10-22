// How hard the PUSH brush pushes.
//
// Push is the deformer: a soft circle dragged across the page that MOVES
// what is under it rather than colouring it — paint texels smeared along
// the drag, vector path points carried with them, and a host's own kind of
// thing deformed its own way (CozyJournal's rig re-poses its joints). It
// began as a rig-only tool armed by its own size slider over a selected
// rig; it is the Push mode of the toolbar's colour group now, sized by the
// one brush-size slider every raster brush shares.
//
// So all this module owns is the STRENGTH, which is not a session thing at
// all: it is an app SETTING, owned by the host and seeded in at editor
// startup (a URL param inside the native WebView, the settings store on
// web). Module state, not React state, because the canvas reads it the
// instant a press lands — no React on that path.

/**
 * How much of the finger's travel a point dead under the brush's centre
 * takes, 0..1.
 *
 * 1 is the brush the rig shipped with — joints tracked the finger exactly,
 * which turned out to be a shove rather than a smear: the smallest
 * deliberate drag threw a limb across the figure, and the only way to
 * deform gently was to move slowly enough that the brush barely covered
 * ground. Below 1 what is pushed LAGS the finger, which is what every
 * smudge tool does and what makes a stroke controllable.
 *
 * The full-force brush is still reachable — a host's slider may top out at
 * exactly the old value — so nothing that could be done before cannot be
 * done now, it is simply not the default any more.
 */
export const PUSH_STRENGTH_MAX = 1;
export const DEFAULT_PUSH_STRENGTH = 0.5;

/** A stored or host-supplied strength, made safe: off the ends is clamped,
 *  junk falls back to the default rather than to zero (a brush that does
 *  nothing at all reads as broken, not as gentle). */
export function clampPushStrength(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PUSH_STRENGTH;
  return Math.min(PUSH_STRENGTH_MAX, Math.max(0, value));
}

let strength = DEFAULT_PUSH_STRENGTH;

/** What a dab's travel is multiplied by, for every kind of thing the brush
 *  moves. Read the instant a press lands. */
export function pushStrength(): number {
  return strength;
}

/**
 * Adopt what the host said. Read-only for the editor's whole life — there
 * is no editor-side control and nothing to write back — so a change on an
 * app's settings screen applies the next time the editor opens, exactly
 * like the shader.
 */
export function setPushStrength(next: number): void {
  strength = clampPushStrength(next);
}

/** Test-only: back to the default. */
export function __resetPushStrengthForTest(): void {
  strength = DEFAULT_PUSH_STRENGTH;
}
