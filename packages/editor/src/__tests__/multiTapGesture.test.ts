import {
  MULTI_TAP_LAND_WINDOW,
  MULTI_TAP_MAX_DURATION,
  MULTI_TAP_MOVE_THRESHOLD,
  anyFingerMoved,
  classifyMultiTap,
} from '../multiTapGesture';

const pt = (x: number, y: number) => ({ x, y });
const map = (...entries: [number, { x: number; y: number }][]) => new Map(entries);

describe('classifyMultiTap', () => {
  const tap = (over: Partial<Parameters<typeof classifyMultiTap>[0]> = {}) => classifyMultiTap({
    maxFingers: 2, moved: false, elapsed: 100, stagger: 20, cancelled: false, ...over,
  });

  it('two-finger stationary tap → undo', () => {
    expect(tap({ maxFingers: 2 })).toBe('undo');
  });

  it('three-finger stationary tap → redo', () => {
    expect(tap({ maxFingers: 3 })).toBe('redo');
  });

  it('ignores a single-finger gesture (never multi-touch)', () => {
    expect(tap({ maxFingers: 1 })).toBeNull();
    expect(tap({ maxFingers: 0 })).toBeNull();
  });

  it('ignores four or more fingers', () => {
    expect(tap({ maxFingers: 4 })).toBeNull();
  });

  it('does not fire when a finger moved (pan/pinch/rotate)', () => {
    expect(tap({ maxFingers: 2, moved: true })).toBeNull();
    expect(tap({ maxFingers: 3, moved: true })).toBeNull();
  });

  it('does not fire once the tap window has elapsed', () => {
    expect(tap({ elapsed: MULTI_TAP_MAX_DURATION })).toBeNull();
    expect(tap({ elapsed: MULTI_TAP_MAX_DURATION + 50 })).toBeNull();
    expect(tap({ elapsed: MULTI_TAP_MAX_DURATION - 1 })).toBe('undo');
  });

  it('does not fire when a finger joins one already held (bug b3a2a998)', () => {
    // One finger held down, a second touching later: not a tap, however
    // quickly the second lifts.
    expect(tap({ stagger: 800 })).toBeNull();
    expect(tap({ maxFingers: 3, stagger: 800 })).toBeNull();
    expect(tap({ stagger: MULTI_TAP_LAND_WINDOW + 1 })).toBeNull();
    // Fingers landing together still undo.
    expect(tap({ stagger: MULTI_TAP_LAND_WINDOW })).toBe('undo');
    expect(tap({ stagger: 0 })).toBe('undo');
  });

  it('does not fire on a cancelled gesture', () => {
    expect(tap({ cancelled: true })).toBeNull();
  });
});

describe('anyFingerMoved', () => {
  it('false when every finger is within the slop', () => {
    const start = map([1, pt(0, 0)], [2, pt(50, 50)]);
    const current = map(
      [1, pt(MULTI_TAP_MOVE_THRESHOLD, 0)],
      [2, pt(50, 50 - MULTI_TAP_MOVE_THRESHOLD)],
    );
    expect(anyFingerMoved(current, start)).toBe(false);
  });

  it('true when any finger passes the slop on either axis', () => {
    const start = map([1, pt(0, 0)], [2, pt(50, 50)]);
    expect(anyFingerMoved(map([1, pt(0, 0)], [2, pt(50, 50 + MULTI_TAP_MOVE_THRESHOLD + 1)]), start)).toBe(true);
    expect(anyFingerMoved(map([1, pt(MULTI_TAP_MOVE_THRESHOLD + 1, 0)], [2, pt(50, 50)]), start)).toBe(true);
  });

  it('ignores fingers that were not in the start snapshot (arrived mid-gesture)', () => {
    const start = map([1, pt(0, 0)]);
    // Finger 2 is way off but was never snapshotted, so it is not judged.
    const current = map([1, pt(1, 1)], [2, pt(999, 999)]);
    expect(anyFingerMoved(current, start)).toBe(false);
  });
});
