/**
 * The whole-object opacity markup (the Opacity bar's first row):
 * `wrapSVGObjectOpacity` and its application inside `buildSVGObjectContent`.
 * Both the live DOM layer and the exporter go through the same wrap, so these
 * assert the shared behavior: no-op at the default, a group opacity when the
 * row is set, and nothing else.
 *
 * The bar's SECOND row used to be Soften, and this wrap used to carry an
 * eroded-then-blurred silhouette mask for it — a feMorphology and a
 * feGaussianBlur per softened object, the most expensive markup this builder
 * could emit. The row is Fade now: it moves the colours the markup is built
 * FROM (engine/fade.ts, applied at `svgLocalGeometry`), so nothing of it
 * reaches the wrap, and a faded shape's markup has no filter in it at all.
 */

import { buildSVGObjectContent, buildTiledSVGObjectRegionMarkup, wrapSVGObjectOpacity } from '../svgPathBuilder';
import { PathSegment, SVGObject } from '../types';

function line(start: [number, number], end: [number, number]): PathSegment {
  return { kind: 'line', start, end };
}

function rect(id: string, extras: Partial<SVGObject> = {}): SVGObject {
  return {
    id,
    segments: [
      line([0, 0], [4, 0]),
      line([4, 0], [4, 3]),
      line([4, 3], [0, 3]),
      line([0, 3], [0, 0]),
    ],
    color: { r: 10, g: 20, b: 30 },
    cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 3,
    shapeKind: 'rectangle',
    ...extras,
  };
}

const STROKE_SCALE = 0.2;

describe('wrapSVGObjectOpacity', () => {
  it('returns the content untouched at the default', () => {
    expect(wrapSVGObjectOpacity(rect('svg_1'), '<path />', STROKE_SCALE)).toBe('<path />');
    expect(wrapSVGObjectOpacity(rect('svg_1', { opacity: 1 }), '<path />', STROKE_SCALE))
      .toBe('<path />');
  });

  it('wraps the content in a group opacity for the Opacity row', () => {
    const out = wrapSVGObjectOpacity(rect('svg_1', { opacity: 0.5 }), '<path />', STROKE_SCALE);
    expect(out).toBe('<g opacity="0.5"><path /></g>');
  });

  it('emits no mask and no filter for a FADED shape — fade is not a mask', () => {
    // The fade is spent on the colours before the markup exists; by the time
    // the wrap sees the object there is nothing left of it to express.
    const out = wrapSVGObjectOpacity(
      rect('svg_1', { fade: 0.5, fadeColor: { r: 255, g: 255, b: 255 } }), '<path />', STROKE_SCALE,
    );
    expect(out).toBe('<path />');
    expect(out).not.toContain('mask');
    expect(out).not.toContain('<filter');
  });

  it('clamps out-of-range values', () => {
    const out = wrapSVGObjectOpacity(rect('svg_1', { opacity: -1 }), '<path />', STROKE_SCALE);
    expect(out).toContain('<g opacity="0">');
  });

  it('passes empty content through', () => {
    expect(wrapSVGObjectOpacity(rect('svg_1', { opacity: 0.5 }), '', STROKE_SCALE)).toBe('');
  });
});

describe('buildSVGObjectContent with opacity', () => {
  it('emits legacy markup when the object has no opacity', () => {
    const out = buildSVGObjectContent(rect('svg_1'), STROKE_SCALE, 16);
    expect(out).not.toContain('<g opacity');
    expect(out).not.toContain('mask=');
  });

  it('wraps the whole drawn markup — fill and stroke fade as one layer', () => {
    const out = buildSVGObjectContent(
      rect('svg_1', { opacity: 0.5, fillColor: { r: 1, g: 2, b: 3 } }),
      STROKE_SCALE,
      16,
    );
    expect(out).toMatch(/^<g opacity="0\.5">/);
    expect(out).toMatch(/<\/g>$/);
    // Both the fill path and the stroke path are inside the wrap.
    const inner = out.slice(out.indexOf('>') + 1, out.lastIndexOf('</g>'));
    expect(inner).toContain('fill="rgb(1,2,3)"');
    expect(inner).toContain('stroke="rgb(10,20,30)"');
  });

  it('wraps REPEAT mode too — the tiled region fades as one layer', () => {
    // The bug: repeat mode returns early, above the flat path's wraps, so
    // the Opacity row moved nothing for anything tiled. Every pattern is
    // tiled — a dragged-out one is born repeating — so the row did nothing
    // on the very kind whose page had just grown it. Fade kept working
    // throughout: it moves the colours the markup is built FROM rather
    // than wrapping what it drew.
    const tiled = (extras: Partial<SVGObject> = {}) => rect('svg_1', {
      tileMode: 'repeat', tileWidthL0: 2, tileHeightL0: 2, ...extras,
    });
    const out = buildSVGObjectContent(tiled({ opacity: 0.5 }), STROKE_SCALE, 16);
    expect(out).toMatch(/^<g opacity="0\.5">/);
    expect(out).toMatch(/<\/g>$/);
    // …around the WHOLE region — its <defs> and the rect that fills from
    // them — so the tile's copies fade together rather than one by one.
    const inner = out.slice(out.indexOf('>') + 1, out.lastIndexOf('</g>'));
    expect(inner).toContain('<pattern id="pat_svg_svg_1"');
    expect(inner).toContain('fill="url(#pat_svg_svg_1)"');
    // Full opacity emits nothing extra, as everywhere else.
    expect(buildSVGObjectContent(tiled(), STROKE_SCALE, 16)).not.toContain('<g opacity');
    // The EXPORT reaches the tiled builder directly, never through the flat
    // path, so the wrap has to live in the builder to reach both.
    const exported = buildTiledSVGObjectRegionMarkup(tiled({ opacity: 0.25 }), STROKE_SCALE);
    expect(exported).toMatch(/^<g opacity="0\.25">/);
    // …and exactly ONE wrap, not one per caller.
    expect(exported.match(/<g opacity=/g)).toHaveLength(1);
    expect(buildSVGObjectContent(tiled({ opacity: 0.25 }), STROKE_SCALE, 16)
      .match(/<g opacity=/g)).toHaveLength(1);
  });

  it('wraps the per-copy expansion of a recoloured tiling too', () => {
    // The other tiled shape: sparse per-copy colour overrides expand into a
    // <g> per visible copy inside a clipping region <svg>, and that return
    // sat above the wraps as well.
    const out = buildTiledSVGObjectRegionMarkup(rect('svg_1', {
      tileMode: 'repeat', tileWidthL0: 2, tileHeightL0: 2, opacity: 0.5,
      segmentOverrides: new Map([[0, { r: 9, g: 9, b: 9 }]]),
    }), STROKE_SCALE);
    expect(out).toMatch(/^<g opacity="0\.5">/);
    expect(out).toContain('<svg x=');
  });

  it('never emits a soften filter, whatever the object carries', () => {
    // Nothing can ask for one any more: the field is gone from the record
    // and the mask is gone from the builder.
    const out = buildSVGObjectContent(
      rect('svg_1', { opacity: 0.5, fade: 1, fillColor: { r: 1, g: 2, b: 3 } }), STROKE_SCALE, 16,
    );
    expect(out).not.toContain('feMorphology');
    expect(out).not.toContain('feGaussianBlur');
    expect(out).not.toContain('uw-soften');
  });
});
