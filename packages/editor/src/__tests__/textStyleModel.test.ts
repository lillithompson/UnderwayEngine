import { DEFAULT_LINE_HEIGHT } from '@/engine/textLayout';
import { TextStyle } from '@/engine/types';
import {
  DEFAULT_TEXT_SIZE,
  resetTextStyle,
  textStyleModelToStyle,
  textStyleToModel,
} from '../textStyleModel';

// The Text bar reads/writes through these converters; they must round-trip
// faithfully and treat `weight` as authoritative over the legacy `bold`.

const base: TextStyle = {
  fontId: 'lora', size: 2.5, color: { r: 40, g: 50, b: 60 },
  weight: 'semibold', letterSpacing: 0.1, lineHeight: 1.4, align: 'center', vAlign: 'middle', italic: true,
};

describe('textStyleToModel', () => {
  test('maps every field', () => {
    expect(textStyleToModel({ ...base, bend: 0.5 })).toEqual({
      fontId: 'lora', weight: 'semibold', size: 2.5,
      letterSpacing: 0.1, lineHeight: 1.4, bend: 0.5, align: 'center', vAlign: 'middle',
      color: { r: 40, g: 50, b: 60 },
    });
  });

  test('round-trips a non-default vertical alignment', () => {
    const m = textStyleToModel({ ...base, vAlign: 'middle' });
    expect(m.vAlign).toBe('middle');
    expect(textStyleModelToStyle(m, base).vAlign).toBe('middle');
  });

  test('supplies defaults for absent optional fields', () => {
    const m = textStyleToModel({ fontId: 'system', size: 2, color: { r: 0, g: 0, b: 0 } });
    expect(m.weight).toBe('regular');
    expect(m.letterSpacing).toBe(0);
    expect(m.lineHeight).toBe(DEFAULT_LINE_HEIGHT);
    expect(m.align).toBe('left');
    expect(m.vAlign).toBe('top');
    expect(m.bend).toBe(0);
  });

  test('falls back to bold when weight is absent', () => {
    expect(textStyleToModel({ fontId: 'system', size: 2, bold: true, color: { r: 0, g: 0, b: 0 } }).weight).toBe('bold');
  });
});

describe('textStyleModelToStyle', () => {
  test('round-trips through the model', () => {
    expect(textStyleModelToStyle(textStyleToModel(base), base)).toMatchObject({
      fontId: 'lora', weight: 'semibold', size: 2.5,
      letterSpacing: 0.1, lineHeight: 1.4, align: 'center', vAlign: 'middle', italic: true,
    });
  });

  test('preserves untouched style fields (italic / stroke)', () => {
    const prev: TextStyle = { ...base, stroke: { width: 0.1, color: { r: 1, g: 2, b: 3 } } };
    const out = textStyleModelToStyle(textStyleToModel(prev), prev);
    expect(out.italic).toBe(true);
    expect(out.stroke).toEqual({ width: 0.1, color: { r: 1, g: 2, b: 3 } });
  });

  test('drops the legacy bold flag (weight is authoritative)', () => {
    const prev: TextStyle = { ...base, bold: true };
    const out = textStyleModelToStyle(textStyleToModel(prev), prev);
    expect('bold' in out).toBe(false);
  });

  test('clamps color channels to 0..255 integers', () => {
    const m = textStyleToModel(base);
    const out = textStyleModelToStyle({ ...m, color: { r: -5, g: 300, b: 127.6 } }, base);
    expect(out.color).toEqual({ r: 0, g: 255, b: 128 });
  });

  test('bend stores flat as absent, keeps bent values, clamps to ±1', () => {
    const m = textStyleToModel(base);
    // The slider's middle (0) must not grow the stored style a field.
    expect('bend' in textStyleModelToStyle({ ...m, bend: 0 }, base)).toBe(false);
    // …and returning to the middle removes a previously stored bend.
    expect('bend' in textStyleModelToStyle({ ...m, bend: 0 }, { ...base, bend: 0.7 })).toBe(false);
    expect(textStyleModelToStyle({ ...m, bend: -0.4 }, base).bend).toBe(-0.4);
    expect(textStyleModelToStyle({ ...m, bend: 3 }, base).bend).toBe(1);
    expect(textStyleModelToStyle({ ...m, bend: -3 }, base).bend).toBe(-1);
  });
});

describe('resetTextStyle', () => {
  test('resets size / character / line / weight but keeps font, color, align', () => {
    const out = resetTextStyle(base);
    expect(out.size).toBe(DEFAULT_TEXT_SIZE);
    expect(out.letterSpacing).toBe(0);
    expect(out.lineHeight).toBe(DEFAULT_LINE_HEIGHT);
    expect(out.weight).toBe('regular');
    expect(out.fontId).toBe('lora');
    expect(out.color).toEqual({ r: 40, g: 50, b: 60 });
    expect(out.align).toBe('center');
    expect(out.vAlign).toBe('middle');
  });

  test('drops the legacy bold flag', () => {
    expect('bold' in resetTextStyle({ ...base, bold: true })).toBe(false);
  });

  test('flattens the arc bend (a metric distortion, like the spacings)', () => {
    expect('bend' in resetTextStyle({ ...base, bend: -0.6 })).toBe(false);
  });
});
