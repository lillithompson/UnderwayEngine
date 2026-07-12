/**
 * Tests for the v17 binary format extension: customColors section.
 * Verifies round-trip of the persisted per-composition user palette and
 * backward compatibility with v16 files (no field → empty array).
 */

import {
  serializeComposition,
  deserializeComposition,
  CompositionBundle,
} from '../compositionBinaryFormat';
import { RGBColor } from '../types';

function makeBundle(overrides?: Partial<CompositionBundle>): CompositionBundle {
  return {
    name: 'Test', gridLevel: 1, strokeScale: 8, gridIntensity: 0.3,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    figures: [],
    ...overrides,
  };
}

describe('v17 customColors', () => {
  test('empty customColors round-trips to []', () => {
    const bundle = makeBundle({ customColors: [] });
    const data = serializeComposition(bundle, []);
    const { meta } = deserializeComposition(data);
    expect(meta.customColors).toEqual([]);
  });

  test('omitted customColors round-trips to []', () => {
    const bundle = makeBundle();
    const data = serializeComposition(bundle, []);
    const { meta } = deserializeComposition(data);
    expect(meta.customColors).toEqual([]);
  });

  test('multiple customColors round-trip preserving order', () => {
    const colors: RGBColor[] = [
      { r: 51, g: 68, b: 255 },
      { r: 200, g: 100, b: 50 },
      { r: 0, g: 0, b: 0 },
      { r: 128, g: 128, b: 128 },
    ];
    const bundle = makeBundle({ customColors: colors });
    const data = serializeComposition(bundle, []);
    const { meta } = deserializeComposition(data);
    expect(meta.customColors).toEqual(colors);
  });

  test('v16 file (no customColors section) decodes to []', () => {
    // Hand-craft a minimal v16 payload by serializing then patching the
    // version byte and truncating the customColors section. The simplest
    // route is to serialize a v17 bundle, rewrite the version field to 16,
    // and drop the trailing 2-byte count we know is empty.
    const bundle = makeBundle({ customColors: [] });
    const data = serializeComposition(bundle, []);
    // FORMAT_VERSION lives at offset 4 (u16 LE).
    const v16 = data.slice(0, data.byteLength - 2);
    new DataView(v16.buffer, v16.byteOffset).setUint16(4, 16, true);
    const { meta } = deserializeComposition(v16);
    expect(meta.customColors).toEqual([]);
  });
});
