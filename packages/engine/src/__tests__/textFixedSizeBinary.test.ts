import {
  serializeComposition,
  deserializeComposition,
  CompositionBundle,
} from '../compositionBinaryFormat';
import { TextObject } from '../types';

// TextObject.fixedSize is a v43 flag-gated binary addition (text flags2 bit
// 0x10, no payload). Absent must leave older saves unchanged (auto-size);
// present must round-trip alongside the other flags2-gated blocks.

function makeBundle(texts: TextObject[]): CompositionBundle {
  return {
    name: 'FixedSize Comp',
    gridLevel: 1,
    strokeScale: 0.5,
    gridIntensity: 0.3,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    figures: [],
    texts,
  };
}

function makeText(overrides: Partial<TextObject> = {}): TextObject {
  return {
    id: 'txt_1',
    content: 'boxed',
    style: { fontId: 'CozySans', size: 2, color: { r: 10, g: 20, b: 30 } },
    cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 3,
    ...overrides,
  };
}

function roundTrip(bundle: CompositionBundle) {
  return deserializeComposition(serializeComposition(bundle, []));
}

describe('TextObject.fixedSize binary round-trip (v43)', () => {
  test('fixedSize true round-trips', () => {
    const rt = roundTrip(makeBundle([makeText({ fixedSize: true })]));
    expect(rt.meta.texts?.[0].fixedSize).toBe(true);
  });

  test('absent fixedSize stays absent (auto-size, pre-v43 behavior)', () => {
    const rt = roundTrip(makeBundle([makeText()]));
    expect(rt.meta.texts?.[0].fixedSize).toBeUndefined();
  });

  test('fixedSize coexists with the other flags2-gated payloads', () => {
    const text = makeText({
      fixedSize: true,
      angleDeg: 33.5,
      effects: { shadow: { dx: 0.1, dy: 0.2, blur: 0.3, color: { r: 1, g: 2, b: 3 }, alpha: 0.5 } },
    });
    const rt = roundTrip(makeBundle([text]));
    const t = rt.meta.texts?.[0];
    expect(t?.fixedSize).toBe(true);
    expect(t?.angleDeg).toBeCloseTo(33.5, 1);
    expect(t?.effects?.shadow).toBeDefined();
  });
});
