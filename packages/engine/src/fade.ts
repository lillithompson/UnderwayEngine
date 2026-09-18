import type {
  BorderEffect,
  GradientStop,
  ImageObject,
  ImageTintFill,
  Paint,
  RGBColor,
  SVGObject,
  TextStyle,
} from './types';

/**
 * FADE — the Opacity page's second row (the one that stood where Soften
 * stood).
 *
 * One number, 0…1, and one target colour. Every colour an object DRAWS —
 * its fill, its stroke, its border, each subpath and each gradient stop —
 * is mixed that far toward the target, each from its OWN starting value.
 * At 0 nothing moves; at 1 everything the object draws is the target
 * colour and the object reads as a flat silhouette of it.
 *
 * It is not an opacity, and it leaves every alpha alone. A faded object is
 * as solid as it ever was and still hides what is behind it — which is the
 * whole point of the control: "push this back into the paper" without
 * letting the page show through it. The two rows of the page therefore do
 * different things and can be used together.
 *
 * It is a RENDER transform, not an edit: the fade and its target are the
 * only things stored, so the colours underneath are untouched and dragging
 * the slider back to 0 gives them back exactly. That is what lets one
 * slider fade fill, stroke and border at once — each is interpolated from
 * the value it still has, so their RELATIONSHIP survives the fade instead
 * of every colour collapsing onto one.
 *
 * Applied at the one place both renderers read an object from:
 * `sceneDrawnContent.svgLocalGeometry`, which the live DOM node layer and
 * the SVG export both draw through. Nothing downstream knows about fade,
 * which is why the export and the screen cannot disagree about it.
 */

/** The target a fade starts on: white — the page's own paper, so the first
 *  pull of the slider reads as the object receding into it. Stored only
 *  once the reader has picked something else (`fadeColor` absent means
 *  this), so an untouched object carries nothing. */
export const FADE_DEFAULT_COLOR: RGBColor = { r: 255, g: 255, b: 255 };

/** What the two stored fields are, wherever a node carries them. Every
 *  kind that draws a fill, a border or a stroke has this pair. */
export interface FadeSpec {
  /** How far toward {@link FadeSpec.fadeColor} every colour is mixed, 0…1.
   *  0 / undefined = untouched, which is what an object that has never
   *  visited the row carries. */
  fade?: number;
  /** The colour they are mixed TOWARD. Undefined = {@link FADE_DEFAULT_COLOR}. */
  fadeColor?: RGBColor;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Is there any fade to apply? Kept as one question so the render paths and
 *  the persistence agree about what "no fade" means: a missing amount, a
 *  zero one, and a negative one are all nothing. */
export function hasFade(spec: FadeSpec | undefined): boolean {
  return spec != null && spec.fade != null && spec.fade > 0;
}

/** One colour, mixed `amount` of the way toward `target`. Rounded to whole
 *  channels: every colour in a scene is 8-bit, and a render that carried
 *  fractions would not survive a round trip through the eyedropper or the
 *  hex field. */
export function fadeRgb(color: RGBColor, amount: number, target: RGBColor): RGBColor {
  const t = clamp01(amount);
  if (t <= 0) return color;
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  return { r: mix(color.r, target.r), g: mix(color.g, target.g), b: mix(color.b, target.b) };
}

/** The fade a spec asks for, as a function of one colour — or null when it
 *  asks for nothing, which lets every caller below keep the object it was
 *  given rather than rebuilding it. */
function fader(spec: FadeSpec | undefined): ((c: RGBColor) => RGBColor) | null {
  if (!hasFade(spec)) return null;
  const amount = clamp01(spec!.fade!);
  const target = spec!.fadeColor ?? FADE_DEFAULT_COLOR;
  return (c) => fadeRgb(c, amount, target);
}

/** Gradient stops, each faded from its own colour — so a two-stop ramp
 *  keeps its direction all the way to 1, where both ends meet on the
 *  target. Alphas are not touched. */
function fadeStops(stops: readonly GradientStop[], f: (c: RGBColor) => RGBColor): GradientStop[] {
  return stops.map((s) => ({ ...s, color: f(s.color) }));
}

/** A {@link Paint} — the flattened fill an export and the shader read. */
export function fadePaint(paint: Paint, f: (c: RGBColor) => RGBColor): Paint {
  if (paint.kind === 'solid') return { ...paint, color: f(paint.color) };
  return { ...paint, stops: fadeStops(paint.stops, f) };
}

/** The EDITABLE fill record (the Fill bar's, and the image tint's twin):
 *  its solid colour and its stops both move, so switching Type mid-fade
 *  does not jump. Opacity and blend are not colours and stay as they are. */
export function fadeTintFill(fill: ImageTintFill, f: (c: RGBColor) => RGBColor): ImageTintFill {
  return { ...fill, solid: f(fill.solid), stops: fadeStops(fill.stops, f) };
}

/** The border ring. Its alpha is not a colour and is left alone. */
export function fadeBorder(border: BorderEffect, f: (c: RGBColor) => RGBColor): BorderEffect {
  return { ...border, color: f(border.color) };
}

/**
 * A node's BORDER as it should be drawn, given the node's own fade — null
 * when there is no border at all.
 *
 * Its own function because the border is the one colour that is not in the
 * object's markup: it is a ring on the bbox, drawn by the layer around the
 * shape (and by the exporter's own rect), so it cannot ride
 * {@link fadedSVGObject} the way the fill and the stroke do.
 */
export function fadedNodeBorder(
  node: FadeSpec & { effects?: { border?: BorderEffect } },
): BorderEffect | undefined {
  const border = node.effects?.border;
  if (!border) return undefined;
  const f = fader(node);
  return f ? fadeBorder(border, f) : border;
}

/**
 * An SVG object as it should be DRAWN: the same object with every colour
 * it paints mixed toward its fade target.
 *
 * Every colour, which for one object can be six kinds at once: the stroke
 * (`color`), each joined subpath's own, each per-copy segment override of
 * a repeating tile, the editable fill's solid and stops, the flattened
 * gradient beneath it, and the legacy solid. They are faded from their own
 * values and so keep their relationships — a red shape outlined in black
 * stays a shape outlined darker than its interior all the way up the
 * slider.
 *
 * Returns the object UNCHANGED when there is no fade, so the common path
 * allocates nothing and every memo downstream (svgLocalGeometry's own
 * cache, the markup builders) keeps its identity.
 */
export function fadedSVGObject(obj: SVGObject): SVGObject {
  const f = fader(obj);
  if (!f) return obj;
  const out: SVGObject = { ...obj, color: f(obj.color) };
  if (obj.subpaths) out.subpaths = obj.subpaths.map((s) => ({ ...s, color: f(s.color) }));
  if (obj.segmentOverrides && obj.segmentOverrides.size > 0) {
    const overrides = new Map<number, RGBColor>();
    for (const [key, color] of obj.segmentOverrides) overrides.set(key, f(color));
    out.segmentOverrides = overrides;
  }
  if (obj.fill) out.fill = fadeTintFill(obj.fill, f);
  if (obj.fillPaint) out.fillPaint = fadePaint(obj.fillPaint, f);
  if (obj.fillColor) out.fillColor = f(obj.fillColor);
  if (obj.effects?.border) {
    out.effects = { ...obj.effects, border: fadeBorder(obj.effects.border, f) };
  }
  return out;
}

/**
 * An IMAGE as it should be drawn. Its pixels are not a colour parameter
 * and are left alone — what fades is what the image PAINTS over and around
 * them: the tint overlay (a fill in everything but name) and the border
 * ring. An image with neither is returned untouched, which is most of them.
 */
export function fadedImageObject(img: ImageObject): ImageObject {
  const f = fader(img);
  if (!f) return img;
  const out: ImageObject = { ...img };
  // The shader recolour and the overlay layer are two different tints and
  // both are colours the image paints with.
  if (img.tint) out.tint = { ...img.tint, color: f(img.tint.color) };
  if (img.tintFill) out.tintFill = fadeTintFill(img.tintFill, f);
  if (img.effects?.border) {
    out.effects = { ...img.effects, border: fadeBorder(img.effects.border, f) };
  }
  return out;
}

/**
 * A TEXT style as it should be drawn: its ink, every per-character brush
 * colour and its outline stroke, each faded from its own value — so
 * lettering painted in three colours keeps all three apart the whole way up
 * the slider, and an outlined word keeps its outline readable against its
 * fill until both arrive at the target together.
 *
 * `alpha` is not touched. It is the one number on this record that already
 * means "fade into the page", and the two rows of the Opacity page are
 * deliberately different things.
 */
export function fadedTextStyle(style: TextStyle): TextStyle {
  const f = fader(style);
  if (!f) return style;
  const out: TextStyle = { ...style, color: f(style.color) };
  if (style.charColors) {
    out.charColors = style.charColors.map((c) => (c ? f(c) : c));
  }
  if (style.stroke) out.stroke = { ...style.stroke, color: f(style.stroke.color) };
  return out;
}
