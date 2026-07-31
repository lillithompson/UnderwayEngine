/**
 * SVG serialization for the v29 visual types (Paint gradients, node
 * effects, image tints, borders). Runtime rendering never uses live SVG
 * filters (effects render from pre-blurred cached textures); these
 * builders exist for export, where real `<defs>` markup is the portable
 * representation.
 */

import { Paint, GradientStop, NodeEffects, BorderEffect, ImageTint, RGBColor } from './types';
import { rgbToHex } from './colorConvert';
import { blendColor } from './colorBlend';
import type { Bbox } from './sceneNodeGeometry';

const hex = (c: RGBColor): string => rgbToHex(c.r, c.g, c.b);

/** Format a number for SVG attributes without float noise. */
const fmt = (n: number): string => String(Number(n.toFixed(6)));

function stopMarkup(stop: GradientStop): string {
  const opacity = stop.alpha !== undefined && stop.alpha < 1
    ? ` stop-opacity="${fmt(stop.alpha)}"`
    : '';
  return `<stop offset="${fmt(stop.offset)}" stop-color="${hex(stop.color)}"${opacity}/>`;
}

/**
 * Serialize a Paint to fill attributes plus (for gradients) a def.
 * Gradient geometry is authored in unit-bbox space, which maps directly
 * onto `gradientUnits="objectBoundingBox"`.
 */
export function paintToSvg(
  paint: Paint,
  defId: string,
): { defs: string | null; fill: string; fillOpacity?: number } {
  if (paint.kind === 'solid') {
    if (paint.alpha !== undefined && paint.alpha < 1) {
      return { defs: null, fill: hex(paint.color), fillOpacity: paint.alpha };
    }
    return { defs: null, fill: hex(paint.color) };
  }
  const stops = paint.stops.map(stopMarkup).join('');
  const defs = paint.kind === 'linear'
    ? `<linearGradient id="${defId}" gradientUnits="objectBoundingBox" ` +
      `x1="${fmt(paint.x1)}" y1="${fmt(paint.y1)}" x2="${fmt(paint.x2)}" y2="${fmt(paint.y2)}">` +
      `${stops}</linearGradient>`
    : `<radialGradient id="${defId}" gradientUnits="objectBoundingBox" ` +
      `cx="${fmt(paint.cx)}" cy="${fmt(paint.cy)}" r="${fmt(paint.r)}">` +
      `${stops}</radialGradient>`;
  return { defs, fill: `url(#${defId})` };
}

/**
 * Build a `<filter>` def for a node's shadow/glow, or nulls when neither
 * is present (borders need no filter).
 *
 * Shadow uses the single `feDropShadow` primitive (SVG 2 / filter-effects
 * spec; universally supported in browsers and much shorter than the
 * feGaussianBlur+feOffset+feMerge chain). Glow blurs SourceAlpha, floods
 * it with the glow color, composites `in`, and merges under the source.
 * When both are present the drop-shadowed source (which includes the
 * source itself) merges over the glow halo.
 */
export function effectsToSvgFilter(
  effects: NodeEffects,
  defId: string,
): { defs: string | null; filterRef: string | null } {
  const sh = effects.shadow;
  const gl = effects.glow;
  if (!sh && !gl) return { defs: null, filterRef: null };

  const prims: string[] = [];
  if (sh) {
    const spread = sh.spread ?? 0;
    if (spread !== 0) {
      // feDropShadow has no spread, so expand it: dilate (positive) or erode
      // (negative) SourceAlpha, blur + offset that, flood with the shadow
      // color, then merge the source back on top. `withShadow` result feeds
      // the glow merge below when present.
      const merge = gl ? ' result="withShadow"' : '';
      const op = spread > 0 ? 'dilate' : 'erode';
      prims.push(
        `<feMorphology in="SourceAlpha" operator="${op}" radius="${fmt(Math.abs(spread))}" result="shSpread"/>`,
        `<feGaussianBlur in="shSpread" stdDeviation="${fmt(sh.blur)}" result="shBlur"/>`,
        `<feOffset in="shBlur" dx="${fmt(sh.dx)}" dy="${fmt(sh.dy)}" result="shOffset"/>`,
        `<feFlood flood-color="${hex(sh.color)}" flood-opacity="${fmt(sh.alpha)}" result="shColor"/>`,
        `<feComposite in="shColor" in2="shOffset" operator="in" result="shShadow"/>`,
        `<feMerge${merge}><feMergeNode in="shShadow"/><feMergeNode in="SourceGraphic"/></feMerge>`,
      );
    } else {
      const result = gl ? ' result="withShadow"' : '';
      prims.push(
        `<feDropShadow dx="${fmt(sh.dx)}" dy="${fmt(sh.dy)}" stdDeviation="${fmt(sh.blur)}" ` +
        `flood-color="${hex(sh.color)}" flood-opacity="${fmt(sh.alpha)}"${result}/>`,
      );
    }
  }
  if (gl) {
    prims.push(
      `<feGaussianBlur in="SourceAlpha" stdDeviation="${fmt(gl.radius)}" result="glowBlur"/>`,
      `<feFlood flood-color="${hex(gl.color)}" flood-opacity="${fmt(gl.alpha)}" result="glowColor"/>`,
      `<feComposite in="glowColor" in2="glowBlur" operator="in" result="glow"/>`,
      `<feMerge><feMergeNode in="glow"/><feMergeNode in="${sh ? 'withShadow' : 'SourceGraphic'}"/></feMerge>`,
    );
  }
  const defs =
    `<filter id="${defId}" x="-50%" y="-50%" width="200%" height="200%" ` +
    `color-interpolation-filters="sRGB">${prims.join('')}</filter>`;
  return { defs, filterRef: `url(#${defId})` };
}

/**
 * `feColorMatrix` values string for an ImageTint. For 'tint' (and
 * 'duotone', which shares the same math — see imageTint.ts) the matrix is
 * exact: out = (1-a)·base + a·lum(base)·tintColor/255, which reduces to a
 * luminance projection scaled by the tint plus an identity term. 'wash'
 * is exact too: a constant offset toward mix(tint, white, 0.5) via the
 * matrix's offset column. Matches `applyImageTint` up to 8-bit rounding.
 */
export function tintToFeColorMatrix(tint: ImageTint): string {
  const a = Math.min(Math.max(tint.amount, 0), 1);
  const rows: number[][] = [];
  if (tint.mode === 'wash') {
    const overlay = blendColor(tint.color, { r: 255, g: 255, b: 255 }, 'normal', 0.5);
    rows.push(
      [1 - a, 0, 0, 0, (a * overlay.r) / 255],
      [0, 1 - a, 0, 0, (a * overlay.g) / 255],
      [0, 0, 1 - a, 0, (a * overlay.b) / 255],
    );
  } else {
    // 'tint' / 'duotone': luminance-projected colorize.
    const tr = tint.color.r / 255;
    const tg = tint.color.g / 255;
    const tb = tint.color.b / 255;
    rows.push(
      [1 - a + a * tr * 0.2126, a * tr * 0.7152, a * tr * 0.0722, 0, 0],
      [a * tg * 0.2126, 1 - a + a * tg * 0.7152, a * tg * 0.0722, 0, 0],
      [a * tb * 0.2126, a * tb * 0.7152, 1 - a + a * tb * 0.0722, 0, 0],
    );
  }
  rows.push([0, 0, 0, 1, 0]);
  return rows.map(row => row.map(fmt).join(' ')).join(' ');
}

/** Stroked (optionally rounded) rect markup for a border effect around a
 *  world-cell bbox. Stroke is centered on the bbox edge, matching the
 *  compositor's border pass. */
export function borderToSvgRect(border: BorderEffect, bbox: Bbox): string {
  const rx = border.radius !== undefined && border.radius > 0 ? ` rx="${fmt(border.radius)}"` : '';
  return `<rect x="${fmt(bbox.cellX)}" y="${fmt(bbox.cellY)}" ` +
    `width="${fmt(bbox.cellWidth)}" height="${fmt(bbox.cellHeight)}"${rx} ` +
    `fill="none" stroke="${hex(border.color)}" stroke-width="${fmt(border.width)}"/>`;
}
