/**
 * The v66 binary format extension: a TEXT's glyph stretch.
 *
 * One f32 on the v57 text extension byte (0x08), after the v63 shear,
 * written only when the type IS stretched. It is the last of the pose
 * fields a box kind could not say: `shear` (v63) gave a leaf its lean, and
 * this gives a text the one scale its box cannot carry, because a text
 * re-wraps in a wider box instead of stretching.
 *
 * Mirrors binaryFormatV63Shear.test.ts for the block that precedes it.
 */

import {
  serializeComposition,
  deserializeComposition,
  CompositionBundle,
} from '../compositionBinaryFormat';
import { TextObject } from '../types';

function makeText(id: string, extras: Partial<TextObject> = {}): TextObject {
  return {
    id,
    content: 'wide',
    style: { fontId: 'inter', size: 2, color: { r: 0, g: 0, b: 0 } },
    cellX: 1, cellY: 2, cellWidth: 10, cellHeight: 4,
    ...extras,
  };
}

function makeBundle(texts: TextObject[]): CompositionBundle {
  return {
    name: 'Test', gridLevel: 1, strokeScale: 0.2, gridIntensity: 0.3,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    figures: [], svgObjects: [], texts,
    sceneOrder: texts.map((t) => t.id),
  };
}

const roundTrip = (texts: TextObject[]): TextObject[] =>
  deserializeComposition(serializeComposition(makeBundle(texts), [])).meta.texts ?? [];

describe('v66 text stretch round-trip', () => {
  it('preserves the stretch', () => {
    const [out] = roundTrip([makeText('txt_1', { stretchX: 2.5 })]);
    expect(out.stretchX).toBeCloseTo(2.5, 5);
  });

  it('rides after the shear, not instead of it', () => {
    const [out] = roundTrip([makeText('txt_1', {
      shear: 0.4, stretchX: 0.5, angleDeg: 29, style: {
        fontId: 'inter', size: 2, color: { r: 1, g: 2, b: 3 },
        fade: 0.5, bend: 0.25, alpha: 0.75,
      },
    })]);
    expect(out.shear).toBeCloseTo(0.4, 5);
    expect(out.stretchX).toBeCloseTo(0.5, 5);
    expect(out.angleDeg).toBeCloseTo(29, 5);
    // …and every block before it in the record still reads back.
    expect(out.style.bend).toBeCloseTo(0.25, 5);
    expect(out.style.fade).toBeCloseTo(0.5, 2);
    expect(out.style.alpha).toBeCloseTo(0.75, 2);
    expect(out.content).toBe('wide');
  });

  it('costs four bytes when there is a stretch and nothing when there is not', () => {
    const bare = serializeComposition(makeBundle([makeText('txt_1')]), []);
    const wide = serializeComposition(makeBundle([makeText('txt_1', { stretchX: 2 })]), []);
    expect(wide.length - bare.length).toBe(4);
    // 1 is what "unstretched" MEANS, so it is spelled absent — which is
    // what keeps every v65 file byte-identical here.
    const one = serializeComposition(makeBundle([makeText('txt_1', { stretchX: 1 })]), []);
    expect(one.length).toBe(bare.length);
    expect(roundTrip([makeText('txt_1', { stretchX: 1 })])[0].stretchX).toBeUndefined();
    expect(roundTrip([makeText('txt_1')])[0].stretchX).toBeUndefined();
  });

  it('refuses a degenerate stretch rather than writing one', () => {
    // A zero or negative x scale is not a stretch, it is a collapse or a
    // mirror — the mirror has its own flag and the collapse has no box.
    for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      const bytes = serializeComposition(makeBundle([makeText('txt_1', { stretchX: bad })]), []);
      expect(bytes.length).toBe(serializeComposition(makeBundle([makeText('txt_1')]), []).length);
    }
  });
});
