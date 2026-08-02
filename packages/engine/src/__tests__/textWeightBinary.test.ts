import {
  serializeComposition,
  deserializeComposition,
  CompositionBundle,
} from '../compositionBinaryFormat';
import { effectiveFontWeight, FONT_WEIGHT_NUMERIC } from '../fontWeight';
import { FontWeight, TextObject } from '../types';

// The named-weight TextStyle field is a flag-gated binary addition (0x80),
// appended after the stroke block. Absent weight must leave older saves
// unchanged; present weight must round-trip for every value.

function makeBundle(texts: TextObject[]): CompositionBundle {
  return {
    name: 'Weight Comp',
    gridLevel: 1,
    strokeScale: 0.5,
    gridIntensity: 0.3,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    figures: [],
    texts,
  };
}

function makeText(weight?: FontWeight): TextObject {
  return {
    id: 'txt_1',
    content: 'weighted',
    style: {
      fontId: 'CozySans', size: 2, color: { r: 10, g: 20, b: 30 },
      ...(weight ? { weight } : {}),
    },
    cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 3,
  };
}

function roundTrip(bundle: CompositionBundle) {
  return deserializeComposition(serializeComposition(bundle, []));
}

describe('TextStyle.weight binary round-trip', () => {
  const WEIGHTS: FontWeight[] = ['light', 'regular', 'semibold', 'bold'];

  test.each(WEIGHTS)('round-trips weight %s', (weight) => {
    const rt = roundTrip(makeBundle([makeText(weight)]));
    expect(rt.meta.texts?.[0].style.weight).toBe(weight);
  });

  test('absent weight stays absent (back-compat with pre-weight saves)', () => {
    const rt = roundTrip(makeBundle([makeText(undefined)]));
    expect(rt.meta.texts?.[0].style.weight).toBeUndefined();
  });

  test('weight coexists with other flagged style fields', () => {
    const text = makeText('semibold');
    text.style.italic = true;
    text.style.letterSpacing = 0.05;
    text.style.lineHeight = 1.4;
    text.style.align = 'center';
    text.style.stroke = { width: 0.1, color: { r: 1, g: 2, b: 3 } };
    const rt = roundTrip(makeBundle([text]));
    const s = rt.meta.texts?.[0].style;
    expect(s?.weight).toBe('semibold');
    expect(s?.italic).toBe(true);
    expect(s?.letterSpacing).toBeCloseTo(0.05, 5);
    expect(s?.lineHeight).toBeCloseTo(1.4, 5);
    expect(s?.align).toBe('center');
    // stroke width rides an f32, so compare with tolerance.
    expect(s?.stroke?.width).toBeCloseTo(0.1, 5);
    expect(s?.stroke?.color).toEqual({ r: 1, g: 2, b: 3 });
  });
});

describe('effectiveFontWeight', () => {
  test('named weight maps to its numeric face', () => {
    expect(effectiveFontWeight({ weight: 'light' })).toBe(FONT_WEIGHT_NUMERIC.light);
    expect(effectiveFontWeight({ weight: 'semibold' })).toBe(600);
    expect(effectiveFontWeight({ weight: 'bold' })).toBe(700);
  });

  test('falls back to the legacy bold boolean when weight is absent', () => {
    expect(effectiveFontWeight({ bold: true })).toBe(700);
    expect(effectiveFontWeight({ bold: false })).toBe(400);
    expect(effectiveFontWeight({})).toBe(400);
  });

  test('named weight wins over bold', () => {
    expect(effectiveFontWeight({ weight: 'light', bold: true })).toBe(300);
  });
});
