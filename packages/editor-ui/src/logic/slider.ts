// Pure track-position math for the Slider component, extracted so the
// non-finite-touch guard below is unit-testable (it isn't reachable through
// the PanResponder in a headless test).

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

/** The 0–1 slider value for a touch at `x` px across a `trackW`-wide track.
 *
 *  On react-native-web the FIRST onPanResponderGrant fires before the
 *  responder target's layout offset is cached, so `locationX` arrives NaN.
 *  Feeding that forward set the value to NaN and rendered "NaN%" until the next
 *  move. When the touch is non-finite (or the track hasn't been measured yet),
 *  hold `current` instead — the un-locatable first grant becomes a no-op, not
 *  a NaN. */
export function sliderValueFromX(x: number, trackW: number, current: number): number {
  if (trackW <= 0 || !Number.isFinite(x)) return clamp01(current);
  return clamp01(x / trackW);
}
