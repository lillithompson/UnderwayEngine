import { padOffsetFromTouch, sliderValueFromX } from '../logic/slider';

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
