// Where a character's INK sits inside its layout box — what the brushes hit
// a character by (paintBrush.textPaintGeometry). The layout box is the
// character's advance across the whole line height, and most of that box is
// air: leading above and below, and the gap between an x-height letter's
// top and the cap line. A brush circle clear of every glyph still overlapped
// that air, so a stroke passing ABOVE a line of text recoloured it.
//
// Measured with `canvas.measureText`'s actualBoundingBox* at the px size the
// node layer lays the line out at (layoutPxFor), and placed on the baseline
// the DOM line div puts it on: CSS centres the font's ascent + descent in
// the line box (half-leading), so the baseline sits at
// `(lineHeight - (ascent + descent)) / 2 + ascent` from the line's top.
//
// A canvas resolves a font stack on its own and can measure a glyph a few
// percent wider than the DOM lays it out (domTextMeasurer's header says
// how much), so the ink's horizontal extent is scaled by the ratio of the
// DOM advance to the canvas one: the ink is measured by the canvas, and
// placed in the box the DOM gave the character.
//
// The canvas is reached through the duck-typed {@link InkProbe} so the
// logic is unit-testable in the node suite, like domTextMeasurer next door.

import type { GlyphInkFn } from './paintBrush';
import { cssFont, layoutPxFor } from './domTextMeasurer';

/** The part of `measureText` this needs, in px at the font's own size. */
export interface InkMetrics {
  width: number;
  actualBoundingBoxLeft: number;
  actualBoundingBoxRight: number;
  actualBoundingBoxAscent: number;
  actualBoundingBoxDescent: number;
  fontBoundingBoxAscent: number;
  fontBoundingBoxDescent: number;
}

export interface InkProbe {
  measure(font: string, ch: string): InkMetrics | null;
}

/**
 * A character's ink as a rectangle in ITS LAYOUT BOX's own units (cells):
 * `x` from the box's left edge, `y` from the line's top, over the width
 * `boxW` the layout gave the character and a line `lineHeight` tall. Null
 * when there is nothing to measure with (no canvas, a face still loading)
 * — the caller keeps the whole box then. A glyph with no ink at all comes
 * back zero-sized.
 */
export type { GlyphInkFn };

// Glyph metrics are a small closed set per font; cap it all the same.
const CACHE_MAX = 4000;

export function makeGlyphInk(
  probe: InkProbe | null,
  checkFace: ((font: string) => boolean) | null,
): GlyphInkFn {
  const cache = new Map<string, InkMetrics | null>();
  return (ch, style, boxW, lineHeight) => {
    if (!probe) return null;
    const px = layoutPxFor(style);
    if (!(px > 0)) return null;
    const font = cssFont(style, px);
    const key = `${font}|${ch}`;
    let m = cache.get(key);
    if (m === undefined) {
      // A face still loading measures the fallback — neither used nor
      // cached, so the real face is measured once it lands.
      if (checkFace && !checkFace(font)) return null;
      m = probe.measure(font, ch);
      if (cache.size >= CACHE_MAX) cache.clear();
      cache.set(key, m);
    }
    if (!m || !(m.width > 0)) return null;
    // px → cells: the line is drawn at `px` for a size of `style.size`.
    const toCells = style.size / px;
    const sx = boxW / (m.width * toCells);
    const inkL = -m.actualBoundingBoxLeft;
    const inkR = m.actualBoundingBoxRight;
    const inkT = -m.actualBoundingBoxAscent;
    const inkB = m.actualBoundingBoxDescent;
    if (!(inkR > inkL) || !(inkB > inkT)) return { x: 0, y: 0, w: 0, h: 0 };
    const baseline = (lineHeight - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent) * toCells) / 2
      + m.fontBoundingBoxAscent * toCells;
    return {
      x: inkL * toCells * sx,
      y: baseline + inkT * toCells,
      w: (inkR - inkL) * toCells * sx,
      h: (inkB - inkT) * toCells,
    };
  };
}

let ctx: CanvasRenderingContext2D | null | undefined;

function canvasProbe(): InkProbe | null {
  if (ctx === undefined) {
    ctx = typeof document === 'undefined'
      ? null
      : document.createElement('canvas').getContext('2d');
  }
  const c = ctx;
  if (!c) return null;
  return {
    measure(font, ch) {
      c.font = font;
      const t = c.measureText(ch);
      // Engines without the font box (older WebKit) report undefined —
      // without it the baseline cannot be placed, so keep the whole box.
      if (typeof t.fontBoundingBoxAscent !== 'number') return null;
      return {
        width: t.width,
        actualBoundingBoxLeft: t.actualBoundingBoxLeft,
        actualBoundingBoxRight: t.actualBoundingBoxRight,
        actualBoundingBoxAscent: t.actualBoundingBoxAscent,
        actualBoundingBoxDescent: t.actualBoundingBoxDescent,
        fontBoundingBoxAscent: t.fontBoundingBoxAscent,
        fontBoundingBoxDescent: t.fontBoundingBoxDescent,
      };
    },
  };
}

/** The glyph-ink function the app registers (paintBrush.registerGlyphInk). */
export const domGlyphInk: GlyphInkFn = (() => {
  let bound: GlyphInkFn | null = null;
  return (ch, style, boxW, lineHeight) => {
    if (!bound) {
      const probe = canvasProbe();
      if (!probe) return null;
      bound = makeGlyphInk(
        probe,
        typeof document !== 'undefined' && typeof document.fonts?.check === 'function'
          ? (font) => document.fonts.check(font) : null,
      );
    }
    return bound(ch, style, boxW, lineHeight);
  };
})();
