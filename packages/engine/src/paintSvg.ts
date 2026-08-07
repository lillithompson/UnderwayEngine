/**
 * SVG serialization for the v29 visual types (Paint gradients, node
 * effects, image tints, borders). Runtime rendering never uses live SVG
 * filters (effects render from pre-blurred cached textures); these
 * builders exist for export, where real `<defs>` markup is the portable
 * representation.
 */

import { Paint, GradientStop, NodeEffects, BorderEffect, BorderPosition, ImageTint, RGBColor } from './types';
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

/** A Gaussian is visually dead by three standard deviations, which is also
 *  where renderers stop sampling it. Filter regions are sized from this. */
const BLUR_EXTENT_SIGMAS = 3;

/** The old filter region, kept for callers that pass no box: half the caster's
 *  bbox on every side. Generous for a big node, nowhere near enough for a
 *  small one — which is why {@link effectsFilterRegion} exists. */
const RELATIVE_REGION = ' x="-50%" y="-50%" width="200%" height="200%"';

/** How far a shadow / glow paints beyond the shape casting it, per side, in
 *  whatever units the effects are expressed in.
 *
 *  A filter clips to its region, so a region that doesn't cover this cuts the
 *  shadow off with a hard straight edge. The blur reaches 3σ in every
 *  direction; the offset slides that whole disc one way, so only the side it
 *  moves toward pays for it; a positive spread dilates before the blur (a
 *  negative one erodes, and can only shrink the reach — treated as 0). */
export function effectsFilterOutset(
  effects: NodeEffects,
): { left: number; right: number; top: number; bottom: number } {
  const out = { left: 0, right: 0, top: 0, bottom: 0 };
  const sh = effects.shadow;
  if (sh) {
    const reach = BLUR_EXTENT_SIGMAS * Math.max(0, sh.blur) + Math.max(0, sh.spread ?? 0);
    out.left = reach + Math.max(0, -sh.dx);
    out.right = reach + Math.max(0, sh.dx);
    out.top = reach + Math.max(0, -sh.dy);
    out.bottom = reach + Math.max(0, sh.dy);
  }
  const gl = effects.glow;
  if (gl) {
    const reach = BLUR_EXTENT_SIGMAS * Math.max(0, gl.radius);
    out.left = Math.max(out.left, reach);
    out.right = Math.max(out.right, reach);
    out.top = Math.max(out.top, reach);
    out.bottom = Math.max(out.bottom, reach);
  }
  return out;
}

/** A node's bbox in the user space the filter is referenced from. */
export interface FilterBox { x: number; y: number; width: number; height: number }

/** The `filter` region attributes for `effects` cast by `box`, in user space.
 *
 *  Every side gets whichever is larger: what the effect actually reaches, or a
 *  tenth of the box — the floor is there because the region has to contain the
 *  SOURCE too, and a source can spill slightly past the bbox it was measured
 *  from (a centered stroke, an italic glyph's overhang). Without it a node
 *  whose only effect is a hard-edged offset shadow would clip its own paint. */
function effectsFilterRegion(effects: NodeEffects, box: FilterBox): string {
  const o = effectsFilterOutset(effects);
  const left = Math.max(o.left, box.width * 0.1);
  const right = Math.max(o.right, box.width * 0.1);
  const top = Math.max(o.top, box.height * 0.1);
  const bottom = Math.max(o.bottom, box.height * 0.1);
  return ' filterUnits="userSpaceOnUse"' +
    ` x="${fmt(box.x - left)}" y="${fmt(box.y - top)}"` +
    ` width="${fmt(box.width + left + right)}" height="${fmt(box.height + top + bottom)}"`;
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
 *
 * Pass `box` — the caster's bbox in the user space the filter is referenced
 * from — to size the filter region to what the effect actually reaches.
 * Without it the region is the relative ±50%, which silently guillotines any
 * shadow that travels further than half the node's own box: fine for a big
 * image, wrong for a line of text, whose box is a couple of cells tall and
 * whose shadow is measured in the same cells.
 */
export function effectsToSvgFilter(
  effects: NodeEffects,
  defId: string,
  box?: FilterBox,
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
  const region = box ? effectsFilterRegion(effects, box) : RELATIVE_REGION;
  const defs =
    `<filter id="${defId}"${region} ` +
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

/** Design points per world cell (BASE_CELL_PX in the app). The border dash
 *  ranges are authored in iOS points; dividing maps them to world cells so
 *  they scale with the composition like every other length. */
const BORDER_PT_PER_CELL = 16;

/** Dash `[dashLength, gap]` in world cells for a 1–10 dash index, or null for
 *  a solid stroke (`dash` ≤ 0 / undefined). Mirrors the design mapping: dash 1
 *  ≈ long dashes, dash 10 ≈ tight dots. Callers scale the returned lengths to
 *  their own unit (× SVG units-per-cell, or × px). */
export function borderDashPattern(dash: number | undefined): [number, number] | null {
  if (!dash || dash <= 0) return null;
  const d = Math.max(1, Math.min(10, dash));
  const t = (d - 1) / 9;
  const dashLenPt = Math.max(1.5, 24 - 22.5 * t);
  const gapPt = dashLenPt <= 3 ? dashLenPt * 1.9 : dashLenPt * 0.65;
  return [dashLenPt / BORDER_PT_PER_CELL, gapPt / BORDER_PT_PER_CELL];
}

/** True once a dash length (in world cells) is short enough that round caps
 *  read as dots rather than clipped dashes (design: ≤ 3pt). */
export function borderDashIsDotted(dashLenCells: number): boolean {
  return dashLenCells <= 3 / BORDER_PT_PER_CELL;
}

/** Geometry of a border stroke rect for a bbox, given the stroke `width`,
 *  alignment `position`, and node corner `radius`. All inputs share one unit
 *  (SVG units or px) and the output is in that unit. The rect is inset (for
 *  'inside') or outset (for 'outside') by half the stroke so the visible edge
 *  aligns with the bbox; 'center' straddles it. The corner radius stays
 *  concentric with the node's rounding. */
export function borderRectGeometry(
  width: number,
  position: BorderPosition | undefined,
  radius: number,
  bbox: Bbox,
): { x: number; y: number; w: number; h: number; rx: number } {
  const half = width / 2;
  const inset = position === 'inside' ? half : position === 'outside' ? -half : 0;
  return {
    x: bbox.cellX + inset,
    y: bbox.cellY + inset,
    w: Math.max(0, bbox.cellWidth - inset * 2),
    h: Math.max(0, bbox.cellHeight - inset * 2),
    rx: radius > 0 ? Math.max(0, radius - inset) : 0,
  };
}

/** Stroked (optionally rounded / dashed / offset) rect markup for a border
 *  effect around a bbox. `border.width`, `border.radius` and `bbox` are in SVG
 *  units; `u` (SVG units per world cell) scales only the unitless dash index
 *  into matching lengths. Matches the compositor's border pass. */
export function borderToSvgRect(border: BorderEffect, bbox: Bbox, u = 1): string {
  const geo = borderRectGeometry(border.width, border.position, border.radius ?? 0, bbox);
  const rx = geo.rx > 0 ? ` rx="${fmt(geo.rx)}" ry="${fmt(geo.rx)}"` : '';
  const pattern = borderDashPattern(border.dash);
  let dashAttr = '';
  if (pattern) {
    const [dLen, gap] = pattern;
    const cap = borderDashIsDotted(dLen) ? ' stroke-linecap="round"' : '';
    dashAttr = ` stroke-dasharray="${fmt(dLen * u)} ${fmt(gap * u)}"${cap}`;
  }
  return `<rect x="${fmt(geo.x)}" y="${fmt(geo.y)}" ` +
    `width="${fmt(geo.w)}" height="${fmt(geo.h)}"${rx} ` +
    `fill="none" stroke="${hex(border.color)}" stroke-width="${fmt(border.width)}"${dashAttr}/>`;
}
