/**
 * SVG serialization for the v29 visual types (Paint gradients, node
 * effects, image tints, borders). Runtime rendering never uses live SVG
 * filters (effects render from pre-blurred cached textures); these
 * builders exist for export, where real `<defs>` markup is the portable
 * representation.
 */

import { Paint, GlowEffect, GradientStop, NodeEffects, BorderEffect, BorderPosition, ImageTint, RGBColor, ShadowEffect } from './types';
import { rgbToHex } from './colorConvert';
import { blendColor } from './colorBlend';
import type { CellBbox } from './transform2d';

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

/**
 * σ per unit of authored blur.
 *
 * `ShadowEffect.blur` and `GlowEffect.radius` are CSS blur RADII — that is how
 * the panel authors them (its ranges are the design's box-shadow points) and
 * how the editor previews them, through `text-shadow` / `box-shadow`. CSS
 * defines a radius R as a Gaussian of standard deviation R/2, so an SVG filter
 * fed the radius as its `stdDeviation` blurs the shadow twice as wide as the
 * editor drew it — spread over four times the area, it lands visibly paler.
 * That is the whole of the "exported shadow is less dark" mismatch.
 */
export const BLUR_SIGMA_PER_RADIUS = 0.5;

/** The σ an authored blur radius means, in the same units it came in. */
export function blurSigma(radius: number): number {
  return Math.max(0, radius) * BLUR_SIGMA_PER_RADIUS;
}

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
 *  negative one erodes, and can only shrink the reach — treated as 0).
 *
 *  `outlineWidth` is the caster's stroke width when its silhouette is an
 *  OUTLINE rather than a solid — an unfilled shape. That source is dilated
 *  to the effect's own softness before it casts ({@link outlineCastSpread}),
 *  and a region measured from the authored spread alone would crop the wider
 *  ring that comes out. */
export function effectsFilterOutset(
  effects: NodeEffects,
  outlineWidth?: number,
): { left: number; right: number; top: number; bottom: number } {
  const out = { left: 0, right: 0, top: 0, bottom: 0 };
  const sh = effects.shadow;
  if (sh) {
    const reach = BLUR_EXTENT_SIGMAS * blurSigma(sh.blur) + Math.max(0, castSpread(sh, outlineWidth));
    out.left = reach + Math.max(0, -sh.dx);
    out.right = reach + Math.max(0, sh.dx);
    out.top = reach + Math.max(0, -sh.dy);
    out.bottom = reach + Math.max(0, sh.dy);
  }
  const gl = effects.glow;
  if (gl) {
    const reach = BLUR_EXTENT_SIGMAS * blurSigma(gl.radius) + Math.max(0, castSpread(gl, outlineWidth));
    out.left = Math.max(out.left, reach);
    out.right = Math.max(out.right, reach);
    out.top = Math.max(out.top, reach);
    out.bottom = Math.max(out.bottom, reach);
  }
  // An INNER glow reaches nowhere: it is clipped to the silhouette that
  // casts it, so it adds nothing to the region the filter has to cover.
  return out;
}

/** One glow with every length multiplied through — see {@link scaleEffects}. */
function scaleGlow(glow: GlowEffect, u: number): GlowEffect {
  return {
    ...glow,
    radius: glow.radius * u,
    spread: glow.spread !== undefined ? glow.spread * u : undefined,
  };
}

/**
 * Scale a NodeEffects' world-unit geometry (shadow offset/blur, glow radius
 * and spread, border width/radius) into the user space a filter is
 * referenced from. The builders below are unit-agnostic, so this is what
 * puts the numbers in their space: export space is L0 cells ×
 * SVG_UNITS_PER_L0_CELL, and the editor's node layer scales into its own
 * inline `<svg>` the same way. One scaler, so the two renderers cannot
 * drift over what a blur radius means.
 */
export function scaleEffects(effects: NodeEffects, u: number): NodeEffects {
  const out: NodeEffects = {};
  if (effects.shadow) {
    out.shadow = {
      ...effects.shadow,
      dx: effects.shadow.dx * u,
      dy: effects.shadow.dy * u,
      blur: effects.shadow.blur * u,
      spread: effects.shadow.spread !== undefined ? effects.shadow.spread * u : undefined,
    };
  }
  if (effects.glow) out.glow = scaleGlow(effects.glow, u);
  if (effects.innerGlow) out.innerGlow = scaleGlow(effects.innerGlow, u);
  if (effects.border) {
    out.border = {
      ...effects.border,
      width: effects.border.width * u,
      radius: effects.border.radius !== undefined ? effects.border.radius * u : undefined,
    };
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
function effectsFilterRegion(
  effects: NodeEffects, box: FilterBox, outlineWidth?: number,
): string {
  const o = effectsFilterOutset(effects, outlineWidth);
  const left = Math.max(o.left, box.width * 0.1);
  const right = Math.max(o.right, box.width * 0.1);
  const top = Math.max(o.top, box.height * 0.1);
  const bottom = Math.max(o.bottom, box.height * 0.1);
  return ' filterUnits="userSpaceOnUse"' +
    ` x="${fmt(box.x - left)}" y="${fmt(box.y - top)}"` +
    ` width="${fmt(box.width + left + right)}" height="${fmt(box.height + top + bottom)}"`;
}

/**
 * A cast effect's own softness, whichever field names it: a shadow blurs by
 * its `blur`, a glow by its `radius`. The outline rule below reads this and
 * nothing else about the effect, which is what lets one rule serve all three.
 */
export function castSoftness(effect: ShadowEffect | GlowEffect): number {
  return 'blur' in effect ? effect.blur : effect.radius;
}

/**
 * A SOURCE wide enough to be seen — the rule for a shape that draws no fill.
 *
 * A cast effect is the object's own silhouette, blurred. For a filled shape
 * that silhouette is a slab and the blur barely dents it; for an UNFILLED
 * one it is the outline, and an outline is a hairline next to the blur these
 * effects are authored with. Blurring a 0.3-cell line with a 1.1-cell radius
 * spreads its ink over four times its width and leaves about a twentieth of
 * the opacity behind: present, and indistinguishable from nothing. Which is
 * how "adding a shadow does nothing" — and then "adding a glow does nothing"
 * — was true of exactly the shapes with no fill.
 *
 * So an outline casts from an outline no narrower than the blur that is
 * about to soften it. It stays the shape of the outline — a ring, with the
 * paper still showing through the middle, which is what the shadow of a
 * frame looks like — and the blur now rounds its edges instead of erasing
 * it. Scaling the floor to the effect's OWN softness rather than to some
 * constant is what keeps it honest at both ends, and keeps a tight glow
 * tight beside a soft shadow: a sharp effect is cast by the line itself, a
 * soft one by a band as wide as its own softness.
 *
 * Returned as the DILATION that gets it there, which is what an inner glow
 * needs — see {@link outlineCastSpread} for the outward pair, whose own
 * spread can be folded in with it.
 */
export function outlineCastDilate(strokeWidthCells: number, softnessCells: number): number {
  return Math.max(0, Math.max(0, softnessCells) - Math.max(0, strokeWidthCells)) / 2;
}

/**
 * …stated as the `spread` that reaches an OUTWARD cast — a shadow or an
 * outer glow — for the filter builder, which dilates the stroke it is given.
 * The authored spread is inside it: it still applies on top, exactly as it
 * does for a filled shape. A negative one only thins a silhouette that was
 * already too thin to cast, so against an outline it is dropped rather than
 * left to fight the floor.
 *
 * An INNER glow takes {@link outlineCastDilate} on its own instead, because
 * its spread ERODES — the two can't be folded into one number.
 */
export function outlineCastSpread(
  strokeWidthCells: number,
  effect: ShadowEffect | GlowEffect,
): number {
  return outlineCastDilate(strokeWidthCells, castSoftness(effect))
    + Math.max(0, effect.spread ?? 0);
}

/**
 * …and as the WIDTH the cast is DRAWN at, for the node layer, which strokes
 * the path a second time rather than dilating an alpha. Same silhouette, from
 * the other side.
 */
export function outlineCastSourceCells(
  strokeWidthCells: number,
  effect: ShadowEffect | GlowEffect,
): number {
  return strokeWidthCells + 2 * outlineCastSpread(strokeWidthCells, effect);
}

/** The spread an outward cast actually gets: the authored one for a solid
 *  silhouette, the outline floor (with the authored one inside it) for a
 *  caster that is only a line. `outlineWidth` undefined means solid — the
 *  case every node but an unfilled shape is in. */
function castSpread(effect: ShadowEffect | GlowEffect, outlineWidth?: number): number {
  return outlineWidth === undefined
    ? effect.spread ?? 0
    : outlineCastSpread(outlineWidth, effect);
}

/**
 * Build a `<filter>` def for a node's shadow / glow / inner glow, or nulls
 * when it carries none of them (borders need no filter).
 *
 * Shadow uses the single `feDropShadow` primitive (SVG 2 / filter-effects
 * spec; universally supported in browsers and much shorter than the
 * feGaussianBlur+feOffset+feMerge chain). Glow blurs SourceAlpha, floods
 * it with the glow color, composites `in`, and merges under the source.
 * When both are present the drop-shadowed source (which includes the
 * source itself) merges over the glow halo.
 *
 * The INNER glow is that same band laid the other way about: what gets
 * blurred is the silhouette's COMPLEMENT (SourceAlpha inverted), the result
 * is clipped back `in` to SourceAlpha — so the light gathers just inside
 * the node's own edge — and it merges OVER everything else rather than
 * under it. Its `spread` erodes where an outer glow's dilates: shrinking
 * the silhouette is what lets the complement reach further in, which is
 * what thickens a band that grows inward.
 *
 * The three stack in one chain, each reading the layer built so far:
 * shadow furthest back, then the outer glow, then the node's own paint,
 * then the inner glow. A stage names its result only when a LATER stage
 * reads it — the last primitive's output is the filter's own.
 *
 * Pass `box` — the caster's bbox in the user space the filter is referenced
 * from — to size the filter region to what the effect actually reaches.
 * Without it the region is the relative ±50%, which silently guillotines any
 * shadow that travels further than half the node's own box: fine for a big
 * image, wrong for a line of text, whose box is a couple of cells tall and
 * whose shadow is measured in the same cells.
 *
 * Pass `outlineWidth` — the caster's stroke width — when its silhouette is
 * an OUTLINE rather than a solid, which for a shape means it draws no fill.
 * Every stage then casts from that outline dilated to its own softness
 * instead of from the hairline itself; see {@link outlineCastDilate} for
 * why, and note that the SOURCE ITSELF is untouched either way — the shape
 * still draws exactly what it drew, and only the light around it changes.
 */
export function effectsToSvgFilter(
  effects: NodeEffects,
  defId: string,
  box?: FilterBox,
  outlineWidth?: number,
): { defs: string | null; filterRef: string | null } {
  const sh = effects.shadow;
  const gl = effects.glow;
  const ig = effects.innerGlow;
  if (!sh && !gl && !ig) return { defs: null, filterRef: null };

  const prims: string[] = [];
  // The layer the next stage composites against — the node's own paint
  // until a stage puts something behind it.
  let under = 'SourceGraphic';
  if (sh) {
    const spread = castSpread(sh, outlineWidth);
    // Named only for a stage that follows; the last one's output IS the
    // filter's.
    const result = gl || ig ? ' result="withShadow"' : '';
    if (spread !== 0) {
      // feDropShadow has no spread, so expand it: dilate (positive) or erode
      // (negative) SourceAlpha, blur + offset that, flood with the shadow
      // color, then merge the source back on top. `withShadow` result feeds
      // the glow merge below when present.
      const op = spread > 0 ? 'dilate' : 'erode';
      prims.push(
        `<feMorphology in="SourceAlpha" operator="${op}" radius="${fmt(Math.abs(spread))}" result="shSpread"/>`,
        `<feGaussianBlur in="shSpread" stdDeviation="${fmt(blurSigma(sh.blur))}" result="shBlur"/>`,
        `<feOffset in="shBlur" dx="${fmt(sh.dx)}" dy="${fmt(sh.dy)}" result="shOffset"/>`,
        `<feFlood flood-color="${hex(sh.color)}" flood-opacity="${fmt(sh.alpha)}" result="shColor"/>`,
        `<feComposite in="shColor" in2="shOffset" operator="in" result="shShadow"/>`,
        `<feMerge${result}><feMergeNode in="shShadow"/><feMergeNode in="SourceGraphic"/></feMerge>`,
      );
    } else {
      prims.push(
        `<feDropShadow dx="${fmt(sh.dx)}" dy="${fmt(sh.dy)}" stdDeviation="${fmt(blurSigma(sh.blur))}" ` +
        `flood-color="${hex(sh.color)}" flood-opacity="${fmt(sh.alpha)}"${result}/>`,
      );
    }
    under = 'withShadow';
  }
  if (gl) {
    const spread = castSpread(gl, outlineWidth);
    // The same expansion the shadow buys its spread with: the halo is cast
    // by a silhouette dilated (or eroded) before the blur softens it.
    if (spread !== 0) {
      prims.push(
        `<feMorphology in="SourceAlpha" operator="${spread > 0 ? 'dilate' : 'erode'}" ` +
        `radius="${fmt(Math.abs(spread))}" result="glowSpread"/>`,
      );
    }
    prims.push(
      `<feGaussianBlur in="${spread !== 0 ? 'glowSpread' : 'SourceAlpha'}" ` +
      `stdDeviation="${fmt(blurSigma(gl.radius))}" result="glowBlur"/>`,
      `<feFlood flood-color="${hex(gl.color)}" flood-opacity="${fmt(gl.alpha)}" result="glowColor"/>`,
      `<feComposite in="glowColor" in2="glowBlur" operator="in" result="glow"/>`,
      `<feMerge${ig ? ' result="withGlow"' : ''}><feMergeNode in="glow"/><feMergeNode in="${under}"/></feMerge>`,
    );
    under = 'withGlow';
  }
  if (ig) {
    const spread = ig.spread ?? 0;
    // The silhouette this band lives inside. For a solid caster that is its
    // own alpha; for an OUTLINE it is that alpha dilated to the glow's
    // radius — an inner glow needs an inside, and a hairline has none.
    // Kept separate from the authored `spread` below because the two go
    // opposite ways: the floor dilates, the spread erodes.
    const dilate = outlineWidth === undefined
      ? 0
      : outlineCastDilate(outlineWidth, ig.radius);
    const inside = dilate > 0 ? 'innerSrc' : 'SourceAlpha';
    if (dilate > 0) {
      prims.push(
        `<feMorphology in="SourceAlpha" operator="dilate" ` +
        `radius="${fmt(dilate)}" result="innerSrc"/>`,
      );
    }
    if (spread !== 0) {
      prims.push(
        `<feMorphology in="${inside}" operator="${spread > 0 ? 'erode' : 'dilate'}" ` +
        `radius="${fmt(Math.abs(spread))}" result="innerSpread"/>`,
      );
    }
    prims.push(
      `<feComponentTransfer in="${spread !== 0 ? 'innerSpread' : inside}" result="innerInv">` +
      `<feFuncA type="table" tableValues="1 0"/></feComponentTransfer>`,
      `<feGaussianBlur in="innerInv" stdDeviation="${fmt(blurSigma(ig.radius))}" result="innerBlur"/>`,
      `<feComposite in="innerBlur" in2="${inside}" operator="in" result="innerMask"/>`,
      `<feFlood flood-color="${hex(ig.color)}" flood-opacity="${fmt(ig.alpha)}" result="innerColor"/>`,
      `<feComposite in="innerColor" in2="innerMask" operator="in" result="innerGlow"/>`,
      `<feMerge><feMergeNode in="${under}"/><feMergeNode in="innerGlow"/></feMerge>`,
    );
  }
  const region = box ? effectsFilterRegion(effects, box, outlineWidth) : RELATIVE_REGION;
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
  bbox: CellBbox,
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
export function borderToSvgRect(border: BorderEffect, bbox: CellBbox, u = 1): string {
  const geo = borderRectGeometry(border.width, border.position, border.radius ?? 0, bbox);
  const rx = geo.rx > 0 ? ` rx="${fmt(geo.rx)}" ry="${fmt(geo.rx)}"` : '';
  const pattern = borderDashPattern(border.dash);
  let dashAttr = '';
  if (pattern) {
    const [dLen, gap] = pattern;
    const cap = borderDashIsDotted(dLen) ? ' stroke-linecap="round"' : '';
    dashAttr = ` stroke-dasharray="${fmt(dLen * u)} ${fmt(gap * u)}"${cap}`;
  }
  // Border color opacity (v55): stroke-opacity, absent when opaque so
  // pre-v55 output is byte-identical.
  const alphaAttr = border.alpha != null && border.alpha < 1
    ? ` stroke-opacity="${border.alpha}"` : '';
  return `<rect x="${fmt(geo.x)}" y="${fmt(geo.y)}" ` +
    `width="${fmt(geo.w)}" height="${fmt(geo.h)}"${rx} ` +
    `fill="none" stroke="${hex(border.color)}" stroke-width="${fmt(border.width)}"${dashAttr}${alphaAttr}/>`;
}
