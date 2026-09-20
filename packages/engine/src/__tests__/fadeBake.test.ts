/**
 * SPENDING a fade (engine/fadeBake.ts).
 *
 * The Fade row is an ADJUSTMENT to the colours an object already draws in,
 * not a colour of its own standing over them: the mix is committed onto the
 * record and nothing is stored. What that buys is that every other colour
 * control stays the authority — an object left at fade 1 used to draw as a
 * flat silhouette of the target whatever its own colours said, so the
 * Stroke page's swatch moved the record and nothing on the screen.
 *
 * {@link bakeStoredFades} is the other half: files written while the fade
 * WAS stored still carry the pair, and it is spent once as they load, so
 * nothing downstream of a load is ever handed a colour with a fade over it.
 * The round-trip tests (binaryFormatV62Fade and its siblings) walk that
 * path through the real reader; this pins the sweep itself.
 */

import {
  bakeFadeIntoImageObject,
  bakeFadeIntoPattern,
  bakeFadeIntoSVGObject,
  bakeFadeIntoTextStyle,
  bakeStoredFades,
} from '../fadeBake';
import { fadedSVGObject } from '../fade';
import { patternInkColor } from '../patternObject';
import type {
  ImageObject, PatternObject, RGBColor, SVGObject, TextObject,
} from '../types';

const BLACK: RGBColor = { r: 0, g: 0, b: 0 };
const WHITE: RGBColor = { r: 255, g: 255, b: 255 };
const RED: RGBColor = { r: 200, g: 0, b: 0 };
const IDENTITY = { rotation: 0 as const, mirrorH: false, mirrorV: false };

const svg = (over: Partial<SVGObject> = {}): SVGObject => ({
  id: 'svg_1',
  segments: [{ kind: 'line', start: [0, 0], end: [4, 0] }],
  color: BLACK,
  cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 3,
  ...over,
});

const image = (over: Partial<ImageObject> = {}): ImageObject => ({
  id: 'img_1',
  imageId: 'blob_1',
  mimeType: 'image/png',
  pixelWidth: 10, pixelHeight: 10,
  cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
  ...over,
});

const text = (over: Partial<TextObject['style']> = {}): TextObject => ({
  id: 'txt_1',
  content: 'hi',
  style: { fontId: 'inter', size: 2, color: BLACK, ...over },
  cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 2,
});

function pattern(over: Partial<PatternObject> = {}): PatternObject {
  const cells = new Array(4).fill(null);
  cells[0] = { type: 'color' as const, r: 200, g: 100, b: 50, transform: IDENTITY };
  cells[1] = {
    type: 'sprite' as const, spriteId: 'test/tile_00010000', transform: IDENTITY,
    tintR: 0, tintG: 0, tintB: 0,
  };
  return {
    id: 'pat_1',
    cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
    cols: 2, rows: 2, cells,
    ...over,
  };
}

describe('spending a fade into one record', () => {
  it('moves every colour an svg paints with, and keeps none of the pair', () => {
    const out = bakeFadeIntoSVGObject(
      svg({ fillColor: RED, effects: { border: { width: 0.25, color: { r: 0, g: 0, b: 100 } } } }),
      0.5, WHITE,
    );
    expect(out.color).toEqual({ r: 128, g: 128, b: 128 });
    expect(out.fillColor).toEqual({ r: 228, g: 128, b: 128 });
    expect(out.effects?.border?.color).toEqual({ r: 128, g: 128, b: 178 });
    expect(out.fade).toBeUndefined();
    expect(out.fadeColor).toBeUndefined();
  });

  it('is the DRAWN object, made permanent — the same mix, by the same code', () => {
    // The bake dresses the record in the fade and lets the render transform
    // do the mixing, so the two can never disagree about which colours move.
    const base = svg({ fillColor: RED });
    const drawn = fadedSVGObject({ ...base, fade: 0.4, fadeColor: RED });
    const spent = bakeFadeIntoSVGObject(base, 0.4, RED);
    expect({ ...spent, fade: 0.4, fadeColor: RED }).toEqual(drawn);
  });

  it('moves what an IMAGE paints with, never its pixels', () => {
    const out = bakeFadeIntoImageObject(
      image({ tint: { color: BLACK, amount: 1, mode: 'tint' } }), 1, RED,
    );
    expect(out.tint?.color).toEqual(RED);
    expect(out.imageId).toBe('blob_1');
    expect(out.fade).toBeUndefined();
  });

  it('moves a TEXT’s ink, and leaves its alpha where it is', () => {
    const out = bakeFadeIntoTextStyle(text({ alpha: 0.4 }).style, 1, RED);
    expect(out.color).toEqual(RED);
    expect(out.alpha).toBeCloseTo(0.4);
    expect(out.fade).toBeUndefined();
  });

  it('moves a PATTERN’s cells, since that is where its colour lives', () => {
    const out = bakeFadeIntoPattern(pattern(), 1, RED);
    expect(patternInkColor(out)).toEqual(RED);
    expect(out.cells[0]).toMatchObject({ type: 'color', ...RED });
    expect(out.fade).toBeUndefined();
  });

  it('a zero fade is no edit at all — the record comes back identical', () => {
    const one = svg();
    expect(bakeFadeIntoSVGObject(one, 0, RED)).toBe(one);
    const p = pattern();
    expect(bakeFadeIntoPattern(p, 0, RED)).toBe(p);
  });
});

describe('bakeStoredFades — what a legacy file becomes as it loads', () => {
  it('spends every kind’s stored pair and drops it', () => {
    const out = bakeStoredFades({
      svgObjects: [svg({ fade: 1, fadeColor: RED })],
      images: [image({ fade: 1, fadeColor: RED, tint: { color: BLACK, amount: 1, mode: 'tint' } })],
      texts: [{ ...text(), style: { ...text().style, fade: 1, fadeColor: RED } }],
      patternObjects: [pattern({ fade: 1, fadeColor: RED })],
    });
    expect(out.svgObjects![0].color).toEqual(RED);
    expect(out.images![0].tint?.color).toEqual(RED);
    expect(out.texts![0].style.color).toEqual(RED);
    expect(patternInkColor(out.patternObjects![0])).toEqual(RED);
    for (const node of [out.svgObjects![0], out.images![0], out.patternObjects![0], out.texts![0].style]) {
      expect(node.fade).toBeUndefined();
      expect(node.fadeColor).toBeUndefined();
    }
  });

  it('an absent target means WHITE, the way the file spells it', () => {
    const out = bakeStoredFades({ svgObjects: [svg({ fade: 1 })] });
    expect(out.svgObjects![0].color).toEqual(WHITE);
  });

  it('is idempotent, and costs an unfaded scene nothing', () => {
    // Identity all the way down — every memo past a load keys on it, and
    // a scene with no stored fade is every scene written from here on.
    const parts = {
      svgObjects: [svg()], images: [image()], texts: [text()], patternObjects: [pattern()],
    };
    const once = bakeStoredFades(parts);
    expect(once).toBe(parts);
    expect(once.svgObjects).toBe(parts.svgObjects);
    expect(bakeStoredFades(once)).toBe(once);
  });

  it('leaves the members that carried nothing untouched, by identity', () => {
    const plain = svg({ id: 'svg_2' });
    const out = bakeStoredFades({ svgObjects: [svg({ fade: 1 }), plain] });
    expect(out.svgObjects![1]).toBe(plain);
  });
});
