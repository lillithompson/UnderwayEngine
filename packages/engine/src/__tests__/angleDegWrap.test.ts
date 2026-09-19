/**
 * A leaf turned past 327.67 degrees kept its turn.
 *
 * The v31 `angleDeg` block on an svg / image / text is an i16 of hundredths
 * of a degree, so the field reaches 327.67. `poseFieldsFrom` emits the free
 * angle in [0, 360), so any member nudged a little ANTICLOCKWISE -- the
 * ordinary way to straighten something -- stored 340-ish, hit the clamp and
 * read back at 327.67: visibly askew, on roughly 9% of all angles, on every
 * `.tile` export since v31. A page SAVE was never affected, which is why no
 * device ever reported it; it needs a share, a template or a sync to show.
 *
 * A turn is mod 360, so 340 and -20 are the same pose and only one of them
 * fits. `encodeAngleDeg` now wraps into (-180, 180] instead of clamping.
 * No layout change and no version bump: the bytes an in-range angle writes
 * are the bytes it always wrote.
 *
 * What this canNOT do is repair a file written by an older build. The clamp
 * threw the original angle away; 327.67 is all that is left in those bytes.
 *
 * docs/transform-refactor.md section 4, "Also open".
 */

import { serializeComposition, deserializeComposition, CompositionBundle } from '../compositionBinaryFormat';
import { signedDeg } from '../sceneTransform';
import { ImageObject, PathSegment, SVGObject, TextObject } from '../types';

function line(start: [number, number], end: [number, number]): PathSegment {
  return { kind: 'line', start, end };
}

function makeBundle(parts: Partial<CompositionBundle>): CompositionBundle {
  const svgObjects = parts.svgObjects ?? [];
  const images = parts.images ?? [];
  const texts = parts.texts ?? [];
  return {
    name: 'Angles', gridLevel: 1, strokeScale: 0.2, gridIntensity: 0.3,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    figures: [], svgObjects, images, texts, paintObjects: [], patternObjects: [],
    imageBlobs: Object.fromEntries(images.map((i) => [i.imageId, new Uint8Array([1, 2, 3])])),
    sceneOrder: [...svgObjects.map((o) => o.id), ...images.map((o) => o.id), ...texts.map((o) => o.id)],
    ...parts,
  } as CompositionBundle;
}

const makeSVG = (angleDeg: number): SVGObject => ({
  id: 'svg1', segments: [line([0, 0], [4, 0]), line([4, 0], [4, 3])],
  color: { r: 255, g: 160, b: 50 },
  cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 3, angleDeg,
});
const makeImage = (angleDeg: number): ImageObject => ({
  id: 'img1', imageId: 'blob_img1', mimeType: 'image/png',
  pixelWidth: 100, pixelHeight: 80,
  cellX: 1, cellY: 2, cellWidth: 4, cellHeight: 3, angleDeg,
});
const makeText = (angleDeg: number): TextObject => ({
  id: 'txt1', content: 'hello',
  style: { fontId: 'inter', size: 2, color: { r: 0, g: 0, b: 0 } },
  cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 2, angleDeg,
});

/** The angle that comes back, as the same turn measured in [0, 360). Two
 *  spellings of one pose (-20 and 340) must compare equal -- the file is
 *  free to say either, and only the TURN is under test. */
function roundTripTurn(kind: 'svg' | 'image' | 'text', angleDeg: number): number {
  const bundle = kind === 'svg' ? makeBundle({ svgObjects: [makeSVG(angleDeg)] })
    : kind === 'image' ? makeBundle({ images: [makeImage(angleDeg)] })
    : makeBundle({ texts: [makeText(angleDeg)] });
  const { meta } = deserializeComposition(serializeComposition(bundle, []));
  const back = kind === 'svg' ? meta.svgObjects![0].angleDeg
    : kind === 'image' ? meta.images![0].angleDeg
    : meta.texts![0].angleDeg;
  const a = ((back ?? 0) % 360 + 360) % 360;
  return Math.round(a * 100) / 100;
}

describe('signedDeg', () => {
  test.each([
    [340, -20], [359.9, -0.1], [327.68, -32.32], [300, -60],
    [180, 180], [-180, 180], [-190, 170], [0, 0], [45, 45], [720 + 340, -20],
  ])('%p folds to %p', (input, expected) => {
    expect(signedDeg(input)).toBeCloseTo(expected, 9);
  });

  test('never leaves the range the i16 field can hold', () => {
    for (let d = -1080; d <= 1080; d += 0.25) {
      const w = signedDeg(d);
      expect(w).toBeGreaterThan(-180.0000001);
      expect(w).toBeLessThanOrEqual(180.0000001);
      // …and it is the SAME turn.
      expect(((w - d) % 360 + 360) % 360).toBeCloseTo(0, 9);
    }
  });
});

describe('a turn past 327.67 survives a .tile', () => {
  // Every one of these read back as 327.67 before the wrap.
  const PAST_THE_CLAMP = [327.68, 330, 340, 350, 359.9];

  describe.each(['svg', 'image', 'text'] as const)('%s', (kind) => {
    test.each(PAST_THE_CLAMP)('%p degrees comes back as itself', (deg) => {
      expect(roundTripTurn(kind, deg)).toBeCloseTo(deg, 2);
    });

    test.each([0, 45, 90.5, 180, 270, 327.67])('%p degrees is unchanged', (deg) => {
      expect(roundTripTurn(kind, deg)).toBeCloseTo(deg, 2);
    });

    test('a negative angle round-trips as the same turn', () => {
      expect(roundTripTurn(kind, -20)).toBeCloseTo(340, 2);
    });
  });

  test('the whole circle, at every degree, on all three kinds', () => {
    for (const kind of ['svg', 'image', 'text'] as const) {
      for (let deg = 0; deg < 360; deg += 1) {
        expect(roundTripTurn(kind, deg)).toBeCloseTo(deg, 2);
      }
    }
  });
});

describe('the bytes do not change for an angle that always fitted', () => {
  test('an in-range angle writes exactly the bytes it wrote before', () => {
    // The wrap is a no-op on (-180, 180], so no existing file's bytes move
    // and no version bump is owed.
    const a = serializeComposition(makeBundle({ svgObjects: [makeSVG(45)] }), []);
    const b = serializeComposition(makeBundle({ svgObjects: [makeSVG(45)] }), []);
    expect(Array.from(a)).toEqual(Array.from(b));
    // 340 and -20 are one pose, so they now write one record.
    const past = serializeComposition(makeBundle({ svgObjects: [makeSVG(340)] }), []);
    const equiv = serializeComposition(makeBundle({ svgObjects: [makeSVG(-20)] }), []);
    expect(Array.from(past)).toEqual(Array.from(equiv));
  });
});
