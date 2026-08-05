import {
  EYEDROPPER_RING_RADIUS,
  EYEDROPPER_TOUCH_PADDING,
  clampEyedropperPoint,
  eyedropperStartPoint,
  isInsideEyedropperRing,
} from '../logic/eyedropper';

describe('eyedropperStartPoint', () => {
  test('centres the ring on the canvas', () => {
    expect(eyedropperStartPoint(400, 300)).toEqual({ x: 200, y: 150 });
  });

  test('rounds odd sizes to a whole pixel', () => {
    expect(eyedropperStartPoint(401, 301)).toEqual({ x: 201, y: 151 });
  });
});

describe('isInsideEyedropperRing', () => {
  const ring = { x: 100, y: 100 };
  const reach = EYEDROPPER_RING_RADIUS + EYEDROPPER_TOUCH_PADDING;

  test('the centre grabs the ring', () => {
    expect(isInsideEyedropperRing(ring, 100, 100)).toBe(true);
  });

  test('the touch slop counts as inside, just past it does not', () => {
    expect(isInsideEyedropperRing(ring, 100 + reach, 100)).toBe(true);
    expect(isInsideEyedropperRing(ring, 100 + reach + 1, 100)).toBe(false);
  });

  test('is radial, not square — the corner of the slop box misses', () => {
    // (reach, reach) away is reach*√2 from the centre: outside the circle.
    expect(isInsideEyedropperRing(ring, 100 + reach, 100 + reach)).toBe(false);
  });

  test('an explicit padding of 0 tightens the hit area to the ring itself', () => {
    expect(isInsideEyedropperRing(ring, 100 + EYEDROPPER_RING_RADIUS, 100, 0)).toBe(true);
    expect(isInsideEyedropperRing(ring, 100 + EYEDROPPER_RING_RADIUS + 1, 100, 0)).toBe(false);
  });
});

describe('clampEyedropperPoint', () => {
  test('leaves an in-bounds point alone', () => {
    expect(clampEyedropperPoint(40, 60, 400, 300)).toEqual({ x: 40, y: 60 });
  });

  test('clamps past either edge', () => {
    expect(clampEyedropperPoint(-20, 500, 400, 300)).toEqual({ x: 0, y: 300 });
    expect(clampEyedropperPoint(900, -5, 400, 300)).toEqual({ x: 400, y: 0 });
  });
});
