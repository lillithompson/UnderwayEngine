import {
  normalizeStrokeScale,
  migrateLegacyStrokeScale,
  effectiveStrokeMultiplier,
  DEFAULT_STROKE_SCALE,
  MAX_LINE_WIDTH,
  STROKE_SCALE_RENDER_MULTIPLIER,
} from '../strokeScale';

const SVG_STROKE_WIDTH = 5;

describe('normalizeStrokeScale', () => {
  test('returns the default when undefined or null', () => {
    expect(normalizeStrokeScale(undefined)).toBe(DEFAULT_STROKE_SCALE);
    expect(normalizeStrokeScale(null as any)).toBe(DEFAULT_STROKE_SCALE);
  });

  test('returns the default for non-finite input', () => {
    expect(normalizeStrokeScale(NaN)).toBe(DEFAULT_STROKE_SCALE);
    expect(normalizeStrokeScale(Infinity)).toBe(DEFAULT_STROKE_SCALE);
  });

  test('passes valid values (including >1 v23+ normalized values) through unchanged', () => {
    expect(normalizeStrokeScale(0)).toBe(0);
    expect(normalizeStrokeScale(0.5)).toBe(0.5);
    expect(normalizeStrokeScale(1)).toBe(1);
    // v23+ normalization can scale strokeScale by up to ~32×, so values >1 are
    // legitimate and must NOT be auto-divided.
    expect(normalizeStrokeScale(2)).toBe(2);
    expect(normalizeStrokeScale(16)).toBe(16);
  });
});

describe('migrateLegacyStrokeScale', () => {
  test('migrates v22- legacy multiplier values (>1) to preserve rendered width', () => {
    // legacy_value × SVG_STROKE_WIDTH = new_strokeScale × MAX_LINE_WIDTH
    // → new = legacy × SVG_STROKE_WIDTH / MAX_LINE_WIDTH
    const expectFor = (legacy: number) =>
      (legacy * SVG_STROKE_WIDTH) / MAX_LINE_WIDTH;
    expect(migrateLegacyStrokeScale(40)).toBeCloseTo(expectFor(40));
    expect(migrateLegacyStrokeScale(8)).toBeCloseTo(expectFor(8));
    expect(migrateLegacyStrokeScale(5)).toBeCloseTo(expectFor(5));
  });

  test('passes percentage values (≤1) through unchanged', () => {
    expect(migrateLegacyStrokeScale(0)).toBe(0);
    expect(migrateLegacyStrokeScale(0.5)).toBe(0.5);
    expect(migrateLegacyStrokeScale(1)).toBe(1);
  });

  test('returns the default for null / undefined / non-finite', () => {
    expect(migrateLegacyStrokeScale(undefined)).toBe(DEFAULT_STROKE_SCALE);
    expect(migrateLegacyStrokeScale(NaN)).toBe(DEFAULT_STROKE_SCALE);
  });
});

describe('effectiveStrokeMultiplier', () => {
  test('produces the legacy multiplier from a 0..1 percentage', () => {
    expect(effectiveStrokeMultiplier(0)).toBe(0);
    expect(effectiveStrokeMultiplier(1)).toBe(STROKE_SCALE_RENDER_MULTIPLIER);
  });

  test('round-trip preserves rendered stroke width for legacy default', () => {
    const legacyDefault = 8;
    const normalized = migrateLegacyStrokeScale(legacyDefault);
    const multiplier = effectiveStrokeMultiplier(normalized);
    expect(SVG_STROKE_WIDTH * multiplier).toBeCloseTo(SVG_STROKE_WIDTH * legacyDefault);
  });

});

describe('constants', () => {
});
