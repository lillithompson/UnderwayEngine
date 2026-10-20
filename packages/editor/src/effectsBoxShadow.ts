import { NodeEffects, ShadowEffect } from '@/engine/types';
import { effectsToSvgFilter, scaleEffects } from '@/engine/paintSvg';
import { Mat2D, matUniformScale } from '@/engine/sceneTransform';
import { BASE_CELL_PX } from './cameraMath';
import { rgbCss } from './colorUtils';

// The CSS box-shadow approximation of a node's NodeEffects (drop shadow / glow /
// border), shared by the per-node DOM layers (NodeLayer) and the frame clip
// wrapper (CanvasSurface). Kept in a pure .ts module — separate from the .tsx
// layers — so it's unit-testable under the node/ts-jest harness (which doesn't
// transform JSX).
//
// Effects constraint (§11): runtime shadow/glow/border are approximated with a
// CSS box-shadow on the node's bbox — never live SVG/CSS filters. The export
// path (compositionSVGCore) emits real <filter> defs engine-side, so exports
// stay exact even though the editor preview is a bbox approximation.
//
// The rule is about the BOX, and it holds wherever the node really is one: an
// image, a frame, a sticker's card. Where the node is a SHAPE it stopped being
// an approximation and became a different picture — a circle casting a
// rectangle, its grid-cell box traced in blurred black beside it. Text already
// had this exemption (CSS text-shadow, glyph-shaped and paint-time); a vector
// path has no such paint-time primitive, so it takes `drop-shadow()` — see
// {@link shadowGlowDropShadow} for what that costs and why it is affordable.
//
// A shape's INNER GLOW is the one case that reaches for a real filter, for
// the same reason and one step further: CSS has no inner-glow function to
// approximate it WITH. See {@link innerGlowSvgFilter}.

/** box-shadow approximation of a NodeEffects block. Magnitudes are world cells
 *  scaled to px by {@link BASE_CELL_PX}. Returns undefined when there's nothing
 *  to draw (so it can feed a `boxShadow` style directly).
 *
 *  The INNER glow is the one effect CSS box-shadow draws exactly rather than
 *  approximately — `inset` is the same band of light inside the same edge —
 *  for every node that really is a box. Where it isn't (a shape), the node
 *  layer draws it from the silhouette instead; see
 *  {@link innerGlowSvgFilter}. */
export function effectsBoxShadow(effects: NodeEffects | undefined): string | undefined {
  if (!effects) return undefined;
  const parts: string[] = [];
  const px = BASE_CELL_PX;
  if (effects.shadow) {
    const s = effects.shadow;
    parts.push(`${s.dx * px}px ${s.dy * px}px ${s.blur * px}px ${(s.spread ?? 0) * px}px ${rgbCss(s.color, s.alpha)}`);
  }
  if (effects.glow) {
    const g = effects.glow;
    parts.push(`0 0 ${g.radius * px}px ${(g.spread ?? 0) * px}px ${rgbCss(g.color, g.alpha)}`);
  }
  if (effects.innerGlow) {
    const g = effects.innerGlow;
    parts.push(`inset 0 0 ${g.radius * px}px ${(g.spread ?? 0) * px}px ${rgbCss(g.color, g.alpha)}`);
  }
  if (effects.border) {
    const b = effects.border;
    parts.push(`0 0 0 ${b.width * px}px ${rgbCss(b.color)}`);
  }
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/**
 * The inner glow of a node whose silhouette is NOT its box, as a real SVG
 * `<filter>` — for the vector layer, which draws its node into an inline
 * `<svg>` and can wrap that markup in a `<g filter="…">`.
 *
 * The other two cast effects reach the shape through CSS `drop-shadow()`
 * (see {@link shadowGlowDropShadow}), which reads the element's own alpha.
 * An inner glow has no CSS counterpart at all — nothing lights the inside
 * of an arbitrary outline — and the bbox `inset` box-shadow above would
 * draw a rectangle glowing inside a circle, which is the same lie the
 * outer box-shadow used to tell. So this is the export's own filter,
 * reused: `effectsToSvgFilter` builds it, `scaleEffects` puts its lengths
 * in the `<svg>`'s user space, and the two renderers therefore draw the
 * same band from the same recipe.
 *
 * Returns nulls when the node carries no inner glow — the overwhelming
 * majority, effects being opt-in — so no filter is mounted at all. Where
 * one IS mounted it is a live SVG filter on the 90 fps path, which §11
 * otherwise forbids: it rides only the nodes that actually wear this
 * effect, and it is worth an Instruments pass on a page that leans on it.
 *
 * `u` is the inline `<svg>`'s user units per world cell (the node layer's
 * SVG_UNITS_PER_L0_CELL). `defId` must be unique in the document; the node
 * id is what the export uses for the same reason.
 *
 * `outlineCells` is the caster's stroke width, in world cells, when its
 * silhouette is an OUTLINE rather than a solid — an unfilled shape. An inner
 * glow needs an INSIDE to gather in and a hairline has none, so the filter
 * dilates that alpha to the glow's own radius first; see
 * `paintSvg.outlineCastDilate`, the one rule all three cast effects read.
 * Undefined for a filled shape, which has an inside of its own.
 */
export function innerGlowSvgFilter(
  effects: NodeEffects | undefined,
  defId: string,
  u: number,
  outlineCells?: number,
): { defs: string | null; filterRef: string | null } {
  if (!effects?.innerGlow) return { defs: null, filterRef: null };
  return effectsToSvgFilter(
    scaleEffects({ innerGlow: effects.innerGlow }, u), defId, undefined,
    // The filter's lengths are all in the inline <svg>'s user space, and the
    // width is one of them — scaled by the same `u` scaleEffects just used.
    outlineCells !== undefined ? outlineCells * u : undefined,
  );
}

// ── Text shadows ────────────────────────────────────────────────────
//
// A text node's shadow is cast by its GLYPHS, not by its box: the SVG export
// runs the drop-shadow filter over the rendered `<text>` elements, so a
// box-shadow on the bbox would preview a rectangle the exported page never
// draws. CSS `text-shadow` is the glyph-shaped equivalent, and — like
// box-shadow — it is a paint-time primitive rather than a live filter, so it
// keeps §11's rule.
//
// Two things text-shadow can't express on its own, both handled by the caller
// pairing this with a group `opacity` (see TextNodeLayer):
//
//  • Alpha. `spread` needs several stacked copies, and stacking N translucent
//    copies compounds their alpha (0.45 nine times over is opaque). So the
//    color here is always FULLY opaque and the shadow's alpha is applied once,
//    to the layer as a whole — exactly where the export's `flood-opacity` sits.
//  • Spread. text-shadow has no spread parameter, so a positive spread is
//    approximated by repeating the shadow around a ring of that radius, which
//    fattens the glyph silhouette the way the export's `feMorphology dilate`
//    does. A NEGATIVE spread has no CSS counterpart (nothing erodes a glyph),
//    so the preview shows the un-eroded shadow.

/** How many copies approximate one ring of `spread`. Eight (every 45°) closes
 *  the ring on ordinary type without turning one shadow into a paint storm. */
const SPREAD_RING_STEPS = 8;

/** A px length without float noise. The offsets here come out of trig, so an
 *  exact zero arrives as 1e-16 and a stable style string would otherwise
 *  change on every render. Sub-thousandth-pixel precision is invisible. */
const px3 = (n: number): string => `${Number(n.toFixed(3))}px`;

/** A node's orientation as the DOM layer applies it — the inner element's
 *  `rotate(angleDeg) rotate(rotation) scaleX(-1) scaleY(-1)` chain. */
export interface NodeOrientation {
  rotation?: 0 | 90 | 180 | 270;
  angleDeg?: number;
  mirrorH?: boolean;
  mirrorV?: boolean;
}

/** The frame a shadow is cast inside: the legacy orientation chain, or —
 *  for a layer drawn through the scene graph — the node's world matrix,
 *  which the inner element wears as one CSS `matrix()`. */
export type NodeFrame = NodeOrientation | Mat2D;

function isMatrix(frame: NodeFrame): frame is Mat2D {
  return 'a' in frame && 'd' in frame;
}

/** The uniform scale the frame applies to lengths drawn inside it — a
 *  matrix's, or 1 for the legacy chain, which never scales. Lengths
 *  authored in world cells (a blur radius, a spread ring) are divided by
 *  it so they come out on screen at the size the export draws them. */
function frameScale(frame: NodeFrame): number {
  return isMatrix(frame) ? matUniformScale(frame) || 1 : 1;
}

/** Re-express a WORLD-space offset in the node's own rotated / mirrored frame.
 *
 *  Shadow offsets are authored in world space, and the export keeps them there:
 *  it wraps the text's whole transform group in the filter, so `dx`/`dy` are
 *  measured against the page however the text is tilted. The DOM preview draws
 *  its shadow *inside* that transform, so the offset has to be pushed back
 *  through it — otherwise a rotated line's shadow falls the wrong way in the
 *  editor and the right way in the saved page.
 *
 *  Not the engine's `unrotatePointForNode`, despite the family resemblance:
 *  that un-rotates a hit-test POINT about a node's bbox center and reads only
 *  `angleDeg`. This turns a free direction — no center to pivot about — through
 *  the whole transform the DOM layer applies, mirrors and discrete rotation
 *  included. */
export function worldOffsetInNodeFrame(
  dx: number,
  dy: number,
  node: NodeFrame,
): [number, number] {
  if (isMatrix(node)) {
    // A direction through the inverse of the matrix's linear part: the
    // offset the element must be given so that, drawn through the matrix,
    // it lands on the authored world offset. Scale included — a shadow on
    // a node scaled by 2 is authored in cells, not in the node's own
    // doubled cells.
    const det = node.a * node.d - node.b * node.c;
    if (!det) return [dx, dy];
    return [(node.d * dx - node.c * dy) / det, (node.a * dy - node.b * dx) / det];
  }
  const rad = (-((node.rotation ?? 0) + (node.angleDeg ?? 0)) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let x = dx * cos - dy * sin;
  let y = dx * sin + dy * cos;
  // The mirrors are innermost in the transform chain, so they undo last.
  if (node.mirrorH) x = -x;
  if (node.mirrorV) y = -y;
  return [x, y];
}

/** The CSS `text-shadow` for a node's drop shadow, in the node's own frame, at
 *  FULL opacity — the caller fades the layer by `shadow.alpha`. Magnitudes are
 *  world cells scaled to px by {@link BASE_CELL_PX}; the blur is passed through
 *  as the CSS blur radius, the same approximation {@link effectsBoxShadow}
 *  makes for images, so the two previews stay consistent with each other.
 *  Returns undefined when there is nothing to draw. */
export function textShadowCss(
  shadow: ShadowEffect | undefined,
  node: NodeFrame,
): string | undefined {
  if (!shadow || shadow.alpha <= 0) return undefined;
  const px = BASE_CELL_PX;
  const k = frameScale(node);
  const [dx, dy] = worldOffsetInNodeFrame(shadow.dx, shadow.dy, node);
  const color = rgbCss(shadow.color);
  const blur = px3((shadow.blur / k) * px);
  const at = (x: number, y: number) => `${px3(x * px)} ${px3(y * px)} ${blur} ${color}`;
  // A sub-pixel dilate is invisible, so don't pay nine blurred copies for it —
  // and a negative one has no CSS counterpart at all.
  const spread = (shadow.spread ?? 0) / k;
  if (spread * px < 1) return at(dx, dy);
  // A ring is rotationally symmetric, so its own offsets need no re-framing.
  const ring = Array.from({ length: SPREAD_RING_STEPS }, (_, i) => {
    const a = (i / SPREAD_RING_STEPS) * 2 * Math.PI;
    return at(dx + spread * Math.cos(a), dy + spread * Math.sin(a));
  });
  return [at(dx, dy), ...ring].join(', ');
}

/**
 * A text node's drop shadow as a CSS `filter`, in the node's own frame.
 *
 * For BENT text, and only for it. A bent line is drawn as SVG
 * `<textPath>`s, and WebKit paints no `text-shadow` on SVG text — so a
 * text with a drop shadow lost it outright the moment it was bent, which
 * is what the report described. `drop-shadow()` reads the glyphs' own
 * alpha instead and casts the same silhouette the export's
 * `<feDropShadow>` does over the same `<text>` markup.
 *
 * Cast from the INK, so a bent text needs no transparent second pass to
 * cast from: the shadow's alpha rides its colour here, where the flat
 * path fades a whole pass by it. `spread` has no counterpart in a single
 * `drop-shadow()` (the flat path buys its dilate with a ring of copies —
 * see {@link textShadowCss}), so a bent shadow draws un-dilated; and a
 * bent text's own `style.alpha` fades the shadow with the ink, the flat
 * path keeping the two apart.
 *
 * Magnitudes are world cells scaled by {@link BASE_CELL_PX}; the authored
 * blur is a 2σ radius, which `drop-shadow()` takes as-is.
 */
export function textShadowFilter(
  shadow: ShadowEffect | undefined,
  node: NodeFrame,
): string | undefined {
  if (!shadow || shadow.alpha <= 0) return undefined;
  const px = BASE_CELL_PX;
  const [dx, dy] = worldOffsetInNodeFrame(shadow.dx, shadow.dy, node);
  return `drop-shadow(${px3(dx * px)} ${px3(dy * px)} ${px3((shadow.blur / frameScale(node)) * px)} ${rgbCss(shadow.color, shadow.alpha)})`;
}

/**
 * A node's shadow + glow as a CSS `filter`, cast from the node's own
 * SILHOUETTE rather than from its bbox: `drop-shadow()` reads the alpha
 * channel, so a circle casts a circle and a dashed line casts dashes — which
 * is what the export has always drawn (`<feDropShadow>` over the real path
 * markup). The bbox box-shadow beside it is right for a node that IS a box and
 * wrong for every shape that isn't; a 3×1-cell ellipse cast a blurred
 * rectangle with nothing on it.
 *
 * Magnitudes are world cells scaled by {@link BASE_CELL_PX}. The authored
 * `blur` is a CSS-style blur radius (2σ) in both worlds — the export halves it
 * to σ (paintSvg's BLUR_SIGMA_PER_RADIUS) and `drop-shadow()` halves it the
 * same way — so the number passes straight through and the two blurs match.
 *
 * Glow leads the chain: filter functions compose, each reading the last one's
 * output, and this order puts the drop shadow behind a glow that is behind the
 * shape — the export's stacking (both cast from SourceAlpha, glow merged over
 * the shadowed source). A shadow cast by shape-plus-glow is the one place the
 * two still differ, and only when a node wears both.
 *
 * `spread` has no counterpart here — CSS `drop-shadow()` has no spread
 * parameter, where the export dilates or erodes the alpha first
 * (`feMorphology`). The preview shows the un-spread silhouette, for the
 * outer glow as for the shadow. It is a smaller error than the one it
 * replaces: spread used to inflate the BOX, which was not the shape's
 * outline to begin with.
 *
 * That missing dilate is why an UNFILLED shape isn't here at all: its
 * silhouette is a hairline, and blurring a hairline is how "adding a shadow
 * does nothing" happened. Those two casts are DRAWN — the path stroked a
 * second time at the width the rule asks for — in the node layer itself.
 * See `paintSvg.outlineCastDilate`.
 *
 * The INNER glow is not here either, filled or not: no CSS filter function
 * draws one. It takes the export's own `<filter>` — see
 * {@link innerGlowSvgFilter}.
 *
 * On the cost: this is a filter on the 90 fps path, which §11 otherwise
 * forbids. It rides only the nodes that actually carry a shadow or a glow —
 * effects are opt-in and rare, so the overwhelming majority of nodes render
 * with no filter at all — and it goes on the node's inner <svg>, leaving the
 * outer bbox element (the drag target, and the border ring) unfiltered. Worth
 * an Instruments pass on a page that leans on it.
 */
export function shadowGlowDropShadow(effects: NodeEffects | undefined): string | undefined {
  if (!effects) return undefined;
  const px = BASE_CELL_PX;
  const parts: string[] = [];
  if (effects.glow) {
    const g = effects.glow;
    parts.push(`drop-shadow(0 0 ${g.radius * px}px ${rgbCss(g.color, g.alpha)})`);
  }
  if (effects.shadow) {
    const s = effects.shadow;
    parts.push(
      `drop-shadow(${s.dx * px}px ${s.dy * px}px ${s.blur * px}px ${rgbCss(s.color, s.alpha)})`,
    );
  }
  return parts.length > 0 ? parts.join(' ') : undefined;
}

/** box-shadow for a node's cast effects ONLY — the border is excluded. Used by
 *  the frame clip wrapper, whose border renders as a real stroked-rect overlay
 *  (position-aware: inside / center / outside) rather than a box-shadow ring. So
 *  a frame's border never implies a drop shadow: a shadow shows only when the
 *  user actually adds one. */
export function shadowGlowBoxShadow(effects: NodeEffects | undefined): string | undefined {
  if (!effects) return undefined;
  return effectsBoxShadow({
    shadow: effects.shadow, glow: effects.glow, innerGlow: effects.innerGlow,
  });
}
