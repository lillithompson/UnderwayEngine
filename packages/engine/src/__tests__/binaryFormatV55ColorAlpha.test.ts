/**
 * v55: color OPACITY for two targets that had none.
 *
 *  - Text ink: `style.alpha` rides text flags2 bit 0x80 as one trailing u8.
 *  - Border effect: `border.alpha` rides the v44 border-extension block
 *    behind sub-mask bit 0x04, one u8.
 *
 * Both are presence-gated — absent means opaque, which is what every file
 * written before v55 has always meant — so older saves read back unchanged.
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

describe('text ink opacity survives the file', () => {
  it('round-trips a translucent ink (quantized to u8)', () => {
    const [out] = roundTrip([makeText('t1', {
      style: { fontId: 'serif', size: 1.5, color: { r: 10, g: 20, b: 30 }, alpha: 0.4 },
    })]);
    expect(out.style.alpha).toBeCloseTo(0.4, 2);
    expect(out.style.color).toEqual({ r: 10, g: 20, b: 30 });
  });

  it('keeps "not set" absent — opaque is spelled absence', () => {
    const [plain] = roundTrip([makeText('t1')]);
    expect(plain.style.alpha).toBeUndefined();
  });

  it('rides alongside the other trailing blocks (vAlign, effects)', () => {
    const [out] = roundTrip([makeText('t1', {
      style: {
        fontId: 'serif', size: 1.5, color: { r: 0, g: 0, b: 0 },
        vAlign: 'middle', alpha: 0.25,
      },
      effects: { border: { width: 0.5, color: { r: 1, g: 2, b: 3 } } },
    })]);
    expect(out.style.vAlign).toBe('middle');
    expect(out.style.alpha).toBeCloseTo(0.25, 2);
    expect(out.effects?.border?.color).toEqual({ r: 1, g: 2, b: 3 });
  });
});

describe('border color opacity survives the file', () => {
  it('round-trips through the border-extension block', () => {
    const [out] = roundTrip([makeText('t1', {
      effects: { border: { width: 0.5, color: { r: 200, g: 100, b: 50 }, alpha: 0.6 } },
    })]);
    expect(out.effects?.border?.alpha).toBeCloseTo(0.6, 2);
    expect(out.effects?.border?.width).toBeCloseTo(0.5);
  });

  it('composes with the v44 extensions it shares the block with', () => {
    const [out] = roundTrip([makeText('t1', {
      effects: { border: {
        width: 0.5, color: { r: 9, g: 9, b: 9 },
        position: 'inside', dash: 4, alpha: 0.3,
      } },
    })]);
    expect(out.effects?.border?.position).toBe('inside');
    expect(out.effects?.border?.dash).toBe(4);
    expect(out.effects?.border?.alpha).toBeCloseTo(0.3, 2);
  });

  it('an opaque border stays absent-alpha, byte-compatible with pre-v55', () => {
    const [out] = roundTrip([makeText('t1', {
      effects: { border: { width: 0.5, color: { r: 9, g: 9, b: 9 } } },
    })]);
    expect(out.effects?.border?.alpha).toBeUndefined();
  });
});
