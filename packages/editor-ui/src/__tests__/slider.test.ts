import { sliderValueFromX } from '../logic/slider';

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
