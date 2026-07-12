import {
  shouldProbeOnResume,
  LONG_BACKGROUND_MS,
} from '../resumeLivenessWatchdog';

describe('shouldProbeOnResume', () => {
  it('returns false when there was no prior background timestamp', () => {
    expect(shouldProbeOnResume(null, 10_000_000)).toBe(false);
  });

  it('returns false for a short background under the threshold', () => {
    const bg = 1_000_000;
    expect(shouldProbeOnResume(bg, bg + 30_000)).toBe(false);
  });

  it('returns false at exactly the threshold (strict greater-than)', () => {
    const bg = 1_000_000;
    expect(shouldProbeOnResume(bg, bg + LONG_BACKGROUND_MS)).toBe(false);
  });

  it('returns true for a background past the threshold', () => {
    const bg = 1_000_000;
    expect(shouldProbeOnResume(bg, bg + LONG_BACKGROUND_MS + 1)).toBe(true);
  });

  it('returns true for an overnight-length gap', () => {
    const bg = 1_000_000;
    const overnight = bg + 8 * 60 * 60 * 1000;
    expect(shouldProbeOnResume(bg, overnight)).toBe(true);
  });
});
