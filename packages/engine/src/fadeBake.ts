/**
 * SPENDING a fade — the other half of engine/fade.ts.
 *
 * `fade.ts` describes the mix; this describes what the editor DOES with
 * it. The Fade row is an ADJUSTMENT to the colours an object already
 * draws in, not a colour of its own: dragging it commits the mixed
 * colours onto the object and stores nothing, so the row opens at 0 on
 * the colours as they now stand, and every other colour control — the
 * Stroke page's swatch above all — remains the authority on what the
 * object's colour IS.
 *
 * It used to be stored (`fade` + `fadeColor`) and applied at draw time.
 * That made the pair outrank every colour underneath it: an object left
 * at fade 1 drew as a flat silhouette of the target, so picking a stroke
 * colour changed the record and nothing on the screen — the Stroke menu
 * read as broken, and on a pattern (whose ink is per cell and whose
 * swatch reads the cells) there was nothing at all to show for a pick.
 *
 * The stored pair is still READ, because files written before this carry
 * it; {@link bakeStoredFades} spends it once as a composition loads, so
 * nothing downstream of a load ever sees a fade standing over a colour.
 */

import {
  fadedImageObject,
  fadedSVGObject,
  fadedTextStyle,
  FADE_DEFAULT_COLOR,
  hasFade,
  type FadeSpec,
} from './fade';
import { applyPatternCellEdits, patternFadeEdits } from './patternObject';
import type {
  ImageObject,
  PatternObject,
  RGBColor,
  SVGObject,
  TextObject,
  TextStyle,
} from './types';

/** The same record with the stored pair gone. Returned as-is when it
 *  carries neither, so the common path allocates nothing. */
export function withoutFadeFields<T extends FadeSpec>(node: T): T {
  if (node.fade === undefined && node.fadeColor === undefined) return node;
  const { fade: _f, fadeColor: _fc, ...rest } = node;
  return rest as T;
}

/** One kind's bake: dress the record in the asked-for fade, let the render
 *  transform mix every colour it knows about, then drop the pair — so the
 *  spent fade and the drawn fade can never disagree about which colours
 *  move, because they are the same code. */
function spend<T extends FadeSpec>(
  node: T, amount: number, target: RGBColor, render: (n: T) => T,
): T {
  if (!(amount > 0)) return withoutFadeFields(node);
  return withoutFadeFields(render({ ...node, fade: amount, fadeColor: target }));
}

export function bakeFadeIntoSVGObject(
  obj: SVGObject, amount: number, target: RGBColor = FADE_DEFAULT_COLOR,
): SVGObject {
  return spend(obj, amount, target, fadedSVGObject);
}

export function bakeFadeIntoImageObject(
  img: ImageObject, amount: number, target: RGBColor = FADE_DEFAULT_COLOR,
): ImageObject {
  return spend(img, amount, target, fadedImageObject);
}

export function bakeFadeIntoTextStyle(
  style: TextStyle, amount: number, target: RGBColor = FADE_DEFAULT_COLOR,
): TextStyle {
  return spend(style, amount, target, fadedTextStyle);
}

/** A pattern's fade goes into its CELLS, not into the baked view: the view
 *  is derived, and a fade left on the object is exactly the thing this
 *  change removes. */
export function bakeFadeIntoPattern(
  p: PatternObject, amount: number, target: RGBColor = FADE_DEFAULT_COLOR,
): PatternObject {
  if (!(amount > 0)) return withoutFadeFields(p);
  const edits = patternFadeEdits(p, amount, target);
  return withoutFadeFields(edits.length > 0 ? applyPatternCellEdits(p, edits, 'apply') : p);
}

/** The scene arrays a composition load hands over, with any fade a record
 *  still carries spent into its colours and the pair dropped. Idempotent —
 *  a scene with no stored fade comes back with every array identical, so
 *  the common load allocates nothing. */
export function bakeStoredFades<T extends {
  svgObjects?: SVGObject[];
  images?: ImageObject[];
  texts?: TextObject[];
  patternObjects?: PatternObject[];
}>(parts: T): T {
  const svgObjects = mapSpent(parts.svgObjects, (o) => bakeFadeIntoSVGObject(o, o.fade ?? 0, o.fadeColor));
  const images = mapSpent(parts.images, (i) => bakeFadeIntoImageObject(i, i.fade ?? 0, i.fadeColor));
  const texts = mapSpent(parts.texts, (t) => (hasFade(t.style) || t.style.fadeColor !== undefined
    ? { ...t, style: bakeFadeIntoTextStyle(t.style, t.style.fade ?? 0, t.style.fadeColor) }
    : t));
  const patternObjects = mapSpent(parts.patternObjects, (p) => bakeFadeIntoPattern(p, p.fade ?? 0, p.fadeColor));
  if (svgObjects === parts.svgObjects && images === parts.images
    && texts === parts.texts && patternObjects === parts.patternObjects) return parts;
  return {
    ...parts,
    ...(svgObjects ? { svgObjects } : null),
    ...(images ? { images } : null),
    ...(texts ? { texts } : null),
    ...(patternObjects ? { patternObjects } : null),
  };
}

/** `map`, but the array itself comes back untouched when every member
 *  did — the identity every memo downstream of a load keys on. */
function mapSpent<T>(items: T[] | undefined, spend: (item: T) => T): T[] | undefined {
  if (!items || items.length === 0) return items;
  let changed = false;
  const out = items.map((item) => {
    const next = spend(item);
    if (next !== item) changed = true;
    return next;
  });
  return changed ? out : items;
}
