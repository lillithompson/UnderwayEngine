// Pure touch→value math for the drag controls (Slider, the Shadow bar's XY
// offset pad), extracted so the non-finite-touch guard below is unit-testable
// (it isn't reachable through the PanResponder in a headless test).

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

/** The 0–1 slider value for a touch at `x` px across a `trackW`-wide track.
 *
 *  On react-native-web the FIRST onPanResponderGrant fires before the
 *  responder target's layout offset is cached, so `locationX` arrives NaN.
 *  Feeding that forward set the value to NaN and rendered "NaN%" until the next
 *  move. When the touch is non-finite (or the track hasn't been measured yet),
 *  hold `current` instead — the un-locatable first grant becomes a no-op, not
 *  a NaN. Callers pass the value the GESTURE has reached, not the value prop:
 *  see the Slider's dragRef for why the two are not the same. */
export function sliderValueFromX(x: number, trackW: number, current: number): number {
  if (trackW <= 0 || !Number.isFinite(x)) return clamp01(current);
  return clamp01(x / trackW);
}

/** The ±`max` offset a touch at (`x`, `y`) picks out of a `size`-square XY pad,
 *  centered at the pad's middle. Non-finite touches hold `current`, for the
 *  same reason (and out of the same event) as {@link sliderValueFromX} — an
 *  unguarded pad turned an un-locatable release into a NaN offset. */
export function padOffsetFromTouch(
  x: number,
  y: number,
  size: number,
  max: number,
  current: readonly [number, number],
): [number, number] {
  if (size <= 0 || !Number.isFinite(x) || !Number.isFinite(y)) {
    return [current[0], current[1]];
  }
  const along = (v: number) => ((v < 0 ? 0 : v > size ? size : v) / size * 2 - 1) * max;
  return [along(x), along(y)];
}

/** The 0–1 value for a touch at `x` px across a brush-size track whose round
 *  handle is `handle` px wide. Unlike {@link sliderValueFromX}, the handle
 *  CONTAINS the value readout (the growing dot), so it must stay fully inside
 *  the track: the usable run is `trackW − handle` and the touch maps to the
 *  handle's CENTER. Same non-finite-touch guard, same reason. */
export function brushSliderValueFromX(
  x: number,
  trackW: number,
  handle: number,
  current: number,
): number {
  const run = trackW - handle;
  if (run <= 0 || !Number.isFinite(x)) return clamp01(current);
  return clamp01((x - handle / 2) / run);
}

/** Diameter of the white size dot inside the brush handle at value `t` —
 *  linear from `min` (a pinprick, never 0: the handle must stay findable) to
 *  `max` (flush with the handle's inner edge). */
export function brushDotSize(t: number, min: number, max: number): number {
  return min + clamp01(t) * (max - min);
}

/** Whether a touch gesture belongs to a value control at all.
 *
 *  It does only while ONE finger is down. Two and three fingers mean the
 *  canvas's undo and redo taps, and those land wherever the hand happens to
 *  be — which, with the brush sliders floating over the artwork, is often
 *  right on a slider. A control that took the first of those fingers both
 *  swallowed the gesture and jumped its own value on the way, so an undo
 *  came out as a change in brush size.
 *
 *  Used twice per control: to refuse the gesture outright when a second
 *  finger is already down, and to ABANDON one already in flight when a
 *  second finger joins it (the two rarely land in the same event). */
export function isSingleTouchGesture(numberActiveTouches: number): boolean {
  return numberActiveTouches <= 1;
}
