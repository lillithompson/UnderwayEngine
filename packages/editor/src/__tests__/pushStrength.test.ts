/**
 * The push brush's strength (pushStrength.ts): an app setting the host
 * seeds in at startup, read the instant a press lands. How each app gets
 * the number to it — a URL param inside its WebView, its own settings
 * store — is pinned in that app's own tree.
 */

import {
  DEFAULT_PUSH_STRENGTH, PUSH_STRENGTH_MAX, __resetPushStrengthForTest, clampPushStrength,
  pushStrength, setPushStrength,
} from '../pushStrength';

afterEach(() => __resetPushStrengthForTest());

describe('the strength the host seeds', () => {
  it('starts gentler than full force, which is still reachable', () => {
    // The full-force brush threw a limb across the figure on the smallest
    // deliberate drag; below 1 what is pushed lags the finger, which is
    // what makes a stroke controllable. Nothing that could be done before
    // cannot be done now — it is simply not the default.
    expect(pushStrength()).toBe(DEFAULT_PUSH_STRENGTH);
    expect(DEFAULT_PUSH_STRENGTH).toBeGreaterThan(0);
    expect(DEFAULT_PUSH_STRENGTH).toBeLessThan(PUSH_STRENGTH_MAX);
    expect(PUSH_STRENGTH_MAX).toBe(1);
  });

  it('adopts what the host said, and reads it back at once', () => {
    setPushStrength(0.25);
    expect(pushStrength()).toBe(0.25);
  });

  it('clamps off the ends, and refuses junk rather than falling to zero', () => {
    // A brush that does nothing at all reads as broken, not as gentle.
    expect(clampPushStrength(-1)).toBe(0);
    expect(clampPushStrength(5)).toBe(PUSH_STRENGTH_MAX);
    expect(clampPushStrength(Number.NaN)).toBe(DEFAULT_PUSH_STRENGTH);
    expect(clampPushStrength(Number.POSITIVE_INFINITY)).toBe(DEFAULT_PUSH_STRENGTH);
    setPushStrength(Number.NaN);
    expect(pushStrength()).toBe(DEFAULT_PUSH_STRENGTH);
    setPushStrength(9);
    expect(pushStrength()).toBe(PUSH_STRENGTH_MAX);
  });
});
