/**
 * v53: text records persist `style.vAlign`.
 *
 * It had never been written at all — the style flags byte was full — so
 * vertical alignment survived only in memory. Every text that went through
 * the binary format (a .tile export, a page template, any reopened file that
 * rides one) came back top-aligned however it had been authored. The visible
 * report was magnetic poetry: a word sticker's card is its measured word
 * grown by a pad on all sides, with the word centred in it, so losing vAlign
 * lifted the word off the middle of its card onto the edge the moment the
 * page was reopened — margin gone on one side, doubled on the other.
 */

import {
  serializeComposition,
  deserializeComposition,
  CompositionBundle,
} from '../compositionBinaryFormat';
import { TextObject, TextVAlign } from '../types';

function makeText(id: string, extras: Partial<TextObject> = {}): TextObject {
  return {
    id,
    content: 'hello',
    style: { fontId: 'serif', size: 1.5, color: { r: 0, g: 0, b: 0 } },
    cellX: 1, cellY: 2, cellWidth: 6, cellHeight: 3,
    ...extras,
  };
}

function bundle(texts: TextObject[]): CompositionBundle {
  return {
    name: 'test',
    figures: [],
    svgObjects: [],
    images: [],
    texts,
    groups: [],
    sceneOrder: texts.map((t) => t.id),
    gridLevel: 1,
    strokeScale: 1,
    gridIntensity: 1,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
  };
}

function roundTrip(texts: TextObject[]): TextObject[] {
  const bytes = serializeComposition(bundle(texts), []);
  return deserializeComposition(bytes).meta.texts ?? [];
}

describe('vertical alignment survives the file', () => {
  it.each(['top', 'middle', 'bottom'] as TextVAlign[])('round-trips %s', (vAlign) => {
    const [out] = roundTrip([makeText('t1', {
      style: { fontId: 'serif', size: 1.5, color: { r: 0, g: 0, b: 0 }, vAlign },
    })]);
    expect(out.style.vAlign).toBe(vAlign);
  });

  it('keeps "not set" distinct from an explicit top', () => {
    // Presence is the signal, as it is for align: a text that never named an
    // alignment must not come back claiming one.
    const [plain] = roundTrip([makeText('t1')]);
    expect(plain.style.vAlign).toBeUndefined();
    const [explicit] = roundTrip([makeText('t1', {
      style: { fontId: 'serif', size: 1.5, color: { r: 0, g: 0, b: 0 }, vAlign: 'top' },
    })]);
    expect(explicit.style.vAlign).toBe('top');
  });

  it('rides alongside the fields that share its record', () => {
    // vAlign is written LAST, after the char-colour block — the one place
    // left for it — so this pins that neither walks over the other.
    const [out] = roundTrip([makeText('t1', {
      sticker: true,
      angleDeg: -7.25,
      style: {
        fontId: 'serif', size: 1.5, color: { r: 0, g: 0, b: 0 },
        align: 'center', vAlign: 'middle', bold: true, weight: 'semibold',
        letterSpacing: 0.05, lineHeight: 1.4,
        charColors: [{ r: 9, g: 8, b: 7 }, null, { r: 1, g: 2, b: 3 }],
      },
    })]);
    expect(out.style.vAlign).toBe('middle');
    expect(out.style.align).toBe('center');
    expect(out.style.weight).toBe('semibold');
    expect(out.style.charColors?.[0]).toEqual({ r: 9, g: 8, b: 7 });
    expect(out.style.charColors?.[2]).toEqual({ r: 1, g: 2, b: 3 });
    expect(out.sticker).toBe(true);
    expect(out.angleDeg).toBeCloseTo(-7.25, 2);
  });

  it('keeps a whole scene of texts in register', () => {
    // The field is length-varying and last in the record, so a miswrite
    // would desynchronise every record after it.
    const texts = [
      makeText('a', { style: { fontId: 'serif', size: 1, color: { r: 0, g: 0, b: 0 }, vAlign: 'middle' } }),
      makeText('b'),
      makeText('c', { style: { fontId: 'serif', size: 2, color: { r: 4, g: 5, b: 6 }, vAlign: 'bottom' } }),
    ];
    const out = roundTrip(texts);
    expect(out.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(out.map((t) => t.style.vAlign)).toEqual(['middle', undefined, 'bottom']);
    expect(out[2].style.color).toEqual({ r: 4, g: 5, b: 6 });
  });
});
