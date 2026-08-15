import {
  brushDotSize, brushSliderValueFromX, isSingleTouchGesture, padOffsetFromTouch, sliderValueFromX,
} from '../logic/slider';

describe('sliderValueFromX', () => {
  test('maps a touch to its fraction across the track', () => {
    expect(sliderValueFromX(0, 200, 0.5)).toBe(0);
    expect(sliderValueFromX(100, 200, 0.5)).toBe(0.5);
    expect(sliderValueFromX(200, 200, 0.5)).toBe(1);
  });

  test('clamps a touch past either edge into 0–1', () => {
    expect(sliderValueFromX(-40, 200, 0.5)).toBe(0);
    expect(sliderValueFromX(9000, 200, 0.5)).toBe(1);
  });

  // The reported bug: the first opacity-slider grab rendered "NaN%".
  test('holds the current value for a non-finite touch, never yielding NaN', () => {
    // react-native-web's first onPanResponderGrant delivers locationX === NaN.
    expect(sliderValueFromX(NaN, 200, 0.42)).toBe(0.42);
    expect(sliderValueFromX(NaN, 200, 0.42)).not.toBeNaN();
    // Undefined coming through as a number is guarded the same way.
    expect(sliderValueFromX(undefined as unknown as number, 200, 0.7)).toBe(0.7);
  });

  test('holds the current value before the track has been measured', () => {
    expect(sliderValueFromX(100, 0, 0.3)).toBe(0.3);
  });

  test('clamps the held current value too, so it can never leak out of range', () => {
    expect(sliderValueFromX(NaN, 200, 5)).toBe(1);
    expect(sliderValueFromX(NaN, 200, -2)).toBe(0);
  });
});

describe('brushSliderValueFromX', () => {
  // 260px track, 44px handle: the handle's center runs 22 → 238.
  test('maps a touch to the handle-center run, not the raw track', () => {
    expect(brushSliderValueFromX(22, 260, 44, 0.5)).toBe(0);
    expect(brushSliderValueFromX(130, 260, 44, 0.5)).toBe(0.5);
    expect(brushSliderValueFromX(238, 260, 44, 0.5)).toBe(1);
  });

  test('clamps touches on the end caps (where the handle cannot center)', () => {
    expect(brushSliderValueFromX(0, 260, 44, 0.5)).toBe(0);
    expect(brushSliderValueFromX(260, 260, 44, 0.5)).toBe(1);
  });

  test('holds the current value for a non-finite touch or unmeasured track', () => {
    expect(brushSliderValueFromX(NaN, 260, 44, 0.42)).toBe(0.42);
    expect(brushSliderValueFromX(130, 0, 44, 0.3)).toBe(0.3);
    // A track no wider than its handle has no run at all.
    expect(brushSliderValueFromX(130, 44, 44, 0.6)).toBe(0.6);
  });
});

describe('brushDotSize', () => {
  test('runs linearly from min to max', () => {
    expect(brushDotSize(0, 6, 34)).toBe(6);
    expect(brushDotSize(0.5, 6, 34)).toBe(20);
    expect(brushDotSize(1, 6, 34)).toBe(34);
  });

  test('never collapses below min or overflows max on out-of-range values', () => {
    expect(brushDotSize(-1, 6, 34)).toBe(6);
    expect(brushDotSize(2, 6, 34)).toBe(34);
  });
});

describe('padOffsetFromTouch', () => {
  const HELD: [number, number] = [0.4, -0.9];

  test('maps a touch to ±max about the pad’s center', () => {
    expect(padOffsetFromTouch(0, 0, 100, 1.5, HELD)).toEqual([-1.5, -1.5]);
    expect(padOffsetFromTouch(50, 50, 100, 1.5, HELD)).toEqual([0, 0]);
    expect(padOffsetFromTouch(100, 100, 100, 1.5, HELD)).toEqual([1.5, 1.5]);
  });

  test('clamps a touch dragged off the pad to its edge', () => {
    expect(padOffsetFromTouch(-80, 900, 100, 1.5, HELD)).toEqual([-1.5, 1.5]);
  });

  test('holds the current offset for a non-finite touch, never yielding NaN', () => {
    // The unguarded version turned an un-locatable release into NaN offsets —
    // the same react-native-web quirk sliderValueFromX guards against.
    expect(padOffsetFromTouch(NaN, 50, 100, 1.5, HELD)).toEqual(HELD);
    expect(padOffsetFromTouch(50, undefined as unknown as number, 100, 1.5, HELD)).toEqual(HELD);
    expect(padOffsetFromTouch(NaN, NaN, 100, 1.5, HELD).some(Number.isNaN)).toBe(false);
  });

  test('holds it before the pad has been measured', () => {
    expect(padOffsetFromTouch(50, 50, 0, 1.5, HELD)).toEqual(HELD);
  });
});

describe('isSingleTouchGesture', () => {
  test('a value control answers to one finger and no more', () => {
    expect(isSingleTouchGesture(1)).toBe(true);
    expect(isSingleTouchGesture(2)).toBe(false);
    expect(isSingleTouchGesture(3)).toBe(false);
  });

  test('treats an empty gesture as one — a release must never read as multi', () => {
    // The last finger up can report zero touches; that has to fall on the
    // "ours" side or a normal drag would abandon itself at the end.
    expect(isSingleTouchGesture(0)).toBe(true);
  });
});
