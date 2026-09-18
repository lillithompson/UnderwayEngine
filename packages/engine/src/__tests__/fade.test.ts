/**
 * The Fade row's arithmetic (engine/fade.ts) — the Opacity page's second
 * row, which stands where Soften stood.
 *
 * One number and one target colour, and every colour an object DRAWS is
 * mixed that far toward the target FROM ITS OWN VALUE. That last part is the
 * whole design: one slider fades a shape's fill, its stroke and its border at
 * once without collapsing them onto each other, so what fades is the object
 * rather than the difference between its parts.
 */

import {
  FADE_DEFAULT_COLOR,
  fadeRgb,
  fadedImageObject,
  fadedNodeBorder,
  fadedSVGObject,
  fadedTextStyle,
  hasFade,
} from '../fade';
import type { ImageObject, PathSegment, SVGObject, TextStyle } from '../types';

const BLACK = { r: 0, g: 0, b: 0 };
const WHITE = { r: 255, g: 255, b: 255 };
const RED = { r: 200, g: 0, b: 0 };

function line(start: [number, number], end: [number, number]): PathSegment {
  return { kind: 'line', start, end };
}

function shape(extras: Partial<SVGObject> = {}): SVGObject {
  return {
    id: 'svg_1',
    segments: [line([0, 0], [4, 0]), line([4, 0], [4, 3])],
    color: BLACK,
    cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 3,
    ...extras,
  };
}

describe('fadeRgb', () => {
  it('is the colour itself at 0 and the target at 1', () => {
    expect(fadeRgb(RED, 0, WHITE)).toEqual(RED);
    expect(fadeRgb(RED, 1, WHITE)).toEqual(WHITE);
  });

  it('walks straight between them, in whole channels', () => {
    // Every colour in a scene is 8-bit; a fraction would not survive the
    // eyedropper or the hex field.
    expect(fadeRgb(BLACK, 0.5, WHITE)).toEqual({ r: 128, g: 128, b: 128 });
    expect(fadeRgb({ r: 100, g: 0, b: 50 }, 0.25, { r: 200, g: 100, b: 50 }))
      .toEqual({ r: 125, g: 25, b: 50 });
  });

  it('clamps an amount from outside the range rather than overshooting', () => {
    expect(fadeRgb(RED, -1, WHITE)).toEqual(RED);
    expect(fadeRgb(RED, 5, WHITE)).toEqual(WHITE);
  });

  it('fades toward a target that is not white, since the target is a choice', () => {
    expect(fadeRgb(WHITE, 1, BLACK)).toEqual(BLACK);
    expect(fadeRgb(WHITE, 0.5, BLACK)).toEqual({ r: 128, g: 128, b: 128 });
  });
});

describe('hasFade', () => {
  it('is false for every way of saying "none"', () => {
    expect(hasFade(undefined)).toBe(false);
    expect(hasFade({})).toBe(false);
    expect(hasFade({ fade: 0 })).toBe(false);
    expect(hasFade({ fade: -1 })).toBe(false);
    // A target with no amount is nothing either — the colour is only ever
    // read through the amount.
    expect(hasFade({ fadeColor: RED })).toBe(false);
  });

  it('is true the moment there is an amount to apply', () => {
    expect(hasFade({ fade: 0.01 })).toBe(true);
  });
});

describe('fadedSVGObject', () => {
  it('hands back the SAME object when there is nothing to do', () => {
    // Identity, not just equality: `svgLocalGeometry` caches on it, and every
    // memo downstream of the node layer reads that cache.
    const obj = shape({ fillColor: RED });
    expect(fadedSVGObject(obj)).toBe(obj);
    expect(fadedSVGObject(shape({ fade: 0 }))).toEqual(shape({ fade: 0 }));
  });

  it('fades the stroke, the fill and the border in one pass', () => {
    const out = fadedSVGObject(shape({
      fade: 0.5,
      color: BLACK,
      fillColor: RED,
      effects: { border: { width: 0.2, color: { r: 0, g: 0, b: 100 } } },
    }));
    expect(out.color).toEqual({ r: 128, g: 128, b: 128 });
    expect(out.fillColor).toEqual({ r: 228, g: 128, b: 128 });
    expect(out.effects?.border?.color).toEqual({ r: 128, g: 128, b: 178 });
  });

  it('keeps each colour’s own starting point — the relationships survive', () => {
    // Half way to white, a black stroke round a red fill is still darker than
    // its interior. The alternative (every colour set to the same mix) would
    // flatten the object at the first touch of the slider.
    const out = fadedSVGObject(shape({ fade: 0.5, color: BLACK, fillColor: RED }));
    expect(out.color!.r).toBeLessThan(out.fillColor!.r);
  });

  it('arrives at the target, and only at 1', () => {
    const out = fadedSVGObject(shape({ fade: 1, color: BLACK, fillColor: RED }));
    expect(out.color).toEqual(FADE_DEFAULT_COLOR);
    expect(out.fillColor).toEqual(FADE_DEFAULT_COLOR);
  });

  it('fades every joined subpath and every per-copy segment override', () => {
    const out = fadedSVGObject(shape({
      fade: 1,
      subpaths: [{ segments: [line([0, 0], [1, 1])], color: RED }],
      segmentOverrides: new Map([[7, BLACK]]),
    }));
    expect(out.subpaths?.[0].color).toEqual(WHITE);
    expect(out.segmentOverrides?.get(7)).toEqual(WHITE);
  });

  it('fades a gradient fill stop by stop, so the ramp keeps its direction', () => {
    const out = fadedSVGObject(shape({
      fade: 0.5,
      fill: {
        type: 'linear',
        solid: BLACK,
        stops: [{ offset: 0, color: BLACK }, { offset: 1, color: RED }],
        angle: 90, opacity: 1, blend: 'normal',
      },
      fillPaint: { kind: 'solid', color: RED, alpha: 0.5 },
    }));
    expect(out.fill?.stops[0].color).toEqual({ r: 128, g: 128, b: 128 });
    expect(out.fill?.stops[1].color).toEqual({ r: 228, g: 128, b: 128 });
    expect(out.fill?.stops[0].color).not.toEqual(out.fill?.stops[1].color);
    expect(out.fillPaint).toEqual({ kind: 'solid', color: { r: 228, g: 128, b: 128 }, alpha: 0.5 });
  });

  it('leaves every ALPHA alone — a faded object is as solid as it ever was', () => {
    // This is what makes Fade a different control from Opacity rather than a
    // second spelling of it: the page's two rows can be used together.
    const out = fadedSVGObject(shape({
      fade: 1,
      opacity: 0.4,
      fillOpacity: 0.25,
      fill: {
        type: 'solid', solid: RED, stops: [{ offset: 0, color: RED, alpha: 0.3 }],
        angle: 0, opacity: 0.8, blend: 'normal',
      },
      effects: { border: { width: 0.2, color: BLACK, alpha: 0.6 } },
    }));
    expect(out.opacity).toBe(0.4);
    expect(out.fillOpacity).toBe(0.25);
    expect(out.fill?.opacity).toBe(0.8);
    expect(out.fill?.stops[0].alpha).toBe(0.3);
    expect(out.effects?.border?.alpha).toBe(0.6);
  });

  it('does not touch the stored record — the slider is reversible', () => {
    const obj = shape({ fade: 1, fillColor: RED });
    fadedSVGObject(obj);
    expect(obj.fillColor).toEqual(RED);
    expect(obj.color).toEqual(BLACK);
  });
});

describe('fadedNodeBorder', () => {
  it('is undefined when there is no border to fade', () => {
    expect(fadedNodeBorder({ fade: 1 })).toBeUndefined();
    expect(fadedNodeBorder({ fade: 1, effects: {} })).toBeUndefined();
  });

  it('hands the border back untouched with no fade, and faded with one', () => {
    const border = { width: 0.2, color: BLACK };
    expect(fadedNodeBorder({ effects: { border } })).toBe(border);
    expect(fadedNodeBorder({ fade: 1, effects: { border } })?.color).toEqual(WHITE);
  });
});

describe('fadedImageObject', () => {
  const img = (extras: Partial<ImageObject> = {}): ImageObject => ({
    id: 'img_1', imageId: 'blob', mimeType: 'image/png', pixelWidth: 10, pixelHeight: 10,
    cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 3, ...extras,
  });

  it('leaves the PIXELS alone — they are not a colour parameter', () => {
    const out = fadedImageObject(img({ fade: 1 }));
    expect(out.imageId).toBe('blob');
    expect(out.pixelWidth).toBe(10);
  });

  it('fades what the image is painted WITH: its tints and its border', () => {
    const out = fadedImageObject(img({
      fade: 1,
      tint: { color: RED, amount: 0.5, mode: 'tint' },
      tintFill: {
        type: 'solid', solid: RED, stops: [{ offset: 0, color: BLACK }],
        angle: 0, opacity: 0.5, blend: 'normal',
      },
      effects: { border: { width: 0.2, color: BLACK } },
    }));
    expect(out.tint?.color).toEqual(WHITE);
    expect(out.tint?.amount).toBe(0.5);
    expect(out.tintFill?.solid).toEqual(WHITE);
    expect(out.tintFill?.stops[0].color).toEqual(WHITE);
    expect(out.effects?.border?.color).toEqual(WHITE);
  });

  it('hands back the same image when it has no fade', () => {
    const plain = img();
    expect(fadedImageObject(plain)).toBe(plain);
  });
});

describe('fadedTextStyle', () => {
  const style = (extras: Partial<TextStyle> = {}): TextStyle => ({
    fontId: 'inter', size: 2, color: BLACK, ...extras,
  });

  it('fades the ink, every brush colour and the outline together', () => {
    const out = fadedTextStyle(style({
      fade: 1,
      charColors: [RED, null, BLACK],
      stroke: { width: 0.1, color: RED },
    }));
    expect(out.color).toEqual(WHITE);
    expect(out.charColors).toEqual([WHITE, null, WHITE]);
    expect(out.stroke?.color).toEqual(WHITE);
  });

  it('leaves the ink ALPHA alone, which is the row above it', () => {
    const out = fadedTextStyle(style({ fade: 1, alpha: 0.5 }));
    expect(out.alpha).toBe(0.5);
  });

  it('hands back the same style when it has no fade', () => {
    const plain = style();
    expect(fadedTextStyle(plain)).toBe(plain);
  });
});
