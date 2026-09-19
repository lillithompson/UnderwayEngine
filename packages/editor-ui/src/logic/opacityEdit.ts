import type { RGBLike } from '../adapter';

// The Opacity page's arithmetic: composing a RELATIVE fade with the one the
// object already carries, and placing the near end of the Fade row's track.
// Kept pure (no react-native) so it is unit-tested in node, the
// imageEdit.ts / patternEdit.ts pattern.

/**
 * A fade of `t` measured from an object that already stands at `base`,
 * expressed as the absolute fade the scene stores.
 *
 * Fade is a linear mix toward one target (engine/fade.ts), so a walk from
 * an already-walked colour is just a longer walk from the original:
 *
 *   mix(mix(c, T, base), T, t) = mix(c, T, base + t·(1 − base))
 *
 * That identity is what lets the page re-base its slider on every open —
 * left means "the object as it is", right means "all the way to the
 * target" — without the re-base costing the object anything. Opening the
 * page and dragging back to the left returns exactly `base`.
 *
 * Both arguments are clamped, so the answer is always a fade the scene can
 * hold, and `base` of 1 (already at the target) stays there whatever the
 * slider says — there is nowhere further to walk.
 */
export function composeFade(base: number, t: number): number {
  const b = clamp01(base);
  return b + clamp01(t) * (1 - b);
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

/**
 * One colour mixed `t` of the way toward `target` — the Fade row's own
 * arithmetic, for placing the near end of its track.
 *
 * The engine does this to every colour an object draws with (fade.ts's
 * `fadeRgb`); this is the same mix on ONE colour, restated here because the
 * package stays engine-import-free — the same reason PatternSymmetryFlags
 * is declared twice. If the two ever disagree the slider would promise a
 * colour the render does not produce, so they are the same three lines and
 * the same rounding.
 */
export function fadeMix(from: RGBLike, target: RGBLike, t: number): RGBLike {
  const k = clamp01(t);
  const mix = (a: number, b: number) => Math.round(a + (b - a) * k);
  return { r: mix(from.r, target.r), g: mix(from.g, target.g), b: mix(from.b, target.b) };
}
