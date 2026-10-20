import {
  CAPSULE_SWIPE_CLAIM_PX, CAPSULE_SWIPE_COMMIT_PX, CAPSULE_SWIPE_COMMIT_VX, capsuleSwipeDirection,
} from '../capsuleSwipe';

describe('a swipe across a floating capsule', () => {
  test('a drag past the commit distance, or a flick past the commit speed, is a swipe', () => {
    // Left is 1 (the next menu comes in from the right), right is -1.
    expect(capsuleSwipeDirection(-CAPSULE_SWIPE_COMMIT_PX, 0)).toBe(1);
    expect(capsuleSwipeDirection(CAPSULE_SWIPE_COMMIT_PX, 0)).toBe(-1);
    expect(capsuleSwipeDirection(-200, 0)).toBe(1);
    // Short of the distance and slow: not a swipe. Short but quick: a swipe.
    expect(capsuleSwipeDirection(-20, 0)).toBeNull();
    expect(capsuleSwipeDirection(20, -0.1)).toBeNull();
    expect(capsuleSwipeDirection(-20, -CAPSULE_SWIPE_COMMIT_VX)).toBe(1);
    expect(capsuleSwipeDirection(20, CAPSULE_SWIPE_COMMIT_VX)).toBe(-1);
  });

  test('no travel is no swipe, however fast', () => {
    expect(capsuleSwipeDirection(0, 5)).toBeNull();
  });

  test('the thresholds stand in the order the gesture needs them', () => {
    // The row claims the drag from its segments well before a swipe
    // commits, and the commit distance is past any press's slop.
    expect(CAPSULE_SWIPE_CLAIM_PX).toBeLessThan(CAPSULE_SWIPE_COMMIT_PX);
    expect(CAPSULE_SWIPE_CLAIM_PX).toBe(8);
    expect(CAPSULE_SWIPE_COMMIT_PX).toBe(48);
    expect(CAPSULE_SWIPE_COMMIT_VX).toBe(0.4);
  });
});
