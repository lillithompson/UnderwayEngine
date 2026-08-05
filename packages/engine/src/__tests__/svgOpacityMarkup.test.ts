/**
 * Tests for the whole-object opacity + edge soften markup (the Opacity bar):
 * `wrapSVGObjectOpacity` and its application inside `buildSVGObjectContent`.
 * Both the live DOM layer and the exporter go through the same wrap, so these
 * assert the shared behavior: no-op at the defaults, a group opacity for the
 * Opacity row, a blurred-silhouette mask for the Soften row.
 */

import { buildSVGObjectContent, wrapSVGObjectOpacity } from '../svgPathBuilder';
import { SVG_UNITS_PER_L0_CELL } from '../svgExport';
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
  it('returns the content untouched at the defaults', () => {
    expect(wrapSVGObjectOpacity(rect('svg_1'), '<path />', STROKE_SCALE)).toBe('<path />');
    expect(wrapSVGObjectOpacity(rect('svg_1', { opacity: 1, edgeSoften: 0 }), '<path />', STROKE_SCALE))
      .toBe('<path />');
  });

  it('wraps the content in a group opacity for the Opacity row', () => {
    const out = wrapSVGObjectOpacity(rect('svg_1', { opacity: 0.5 }), '<path />', STROKE_SCALE);
    expect(out).toBe('<g opacity="0.5"><path /></g>');
  });

  it('emits an eroded-then-blurred silhouette mask for the Soften row', () => {
    const out = wrapSVGObjectOpacity(rect('svg_1', { edgeSoften: 0.5 }), '<path />', STROKE_SCALE);
    expect(out).toContain('mask="url(#uw-soften-m-svg_1)"');
    expect(out).toContain('<mask id="uw-soften-m-svg_1"');
    expect(out).toContain('<filter id="uw-soften-f-svg_1"');
    // Feather depth = soften × half the shorter bbox side, in SVG units. The
    // erode eats half of it and the blur's 2.5σ tail spans the eroded half
    // back out — so the ramp ENDS (alpha 0) at the original edge.
    const round4 = (v: number) => Math.round(v * 1e4) / 1e4;
    const depth = 0.5 * 0.5 * 3 * SVG_UNITS_PER_L0_CELL;
    expect(out).toContain(`<feMorphology operator="erode" radius="${round4(depth / 2)}" />`);
    expect(out).toContain(`<feGaussianBlur stdDeviation="${round4(depth / 5)}" />`);
    // Regions are explicit userSpaceOnUse boxes (the defaults resolve against
    // the viewport, which would put the object outside its own mask).
    expect(out).toContain('maskUnits="userSpaceOnUse"');
    expect(out).toContain('filterUnits="userSpaceOnUse"');
    // The silhouette is the filled closed outline, stroked at the drawn width.
    expect(out).toContain('fill="white"');
    expect(out).toContain('stroke="white"');
  });

  it('combines both rows in one wrapping group', () => {
    const out = wrapSVGObjectOpacity(rect('svg_1', { opacity: 0.25, edgeSoften: 1 }), '<path />', STROKE_SCALE);
    expect(out).toContain('<g opacity="0.25" mask="url(#uw-soften-m-svg_1)"><path /></g>');
  });

  it('clamps out-of-range values', () => {
    const out = wrapSVGObjectOpacity(rect('svg_1', { opacity: -1 }), '<path />', STROKE_SCALE);
    expect(out).toContain('<g opacity="0">');
  });

  it('passes empty content through', () => {
    expect(wrapSVGObjectOpacity(rect('svg_1', { opacity: 0.5 }), '', STROKE_SCALE)).toBe('');
  });

  it('sanitizes the def ids like the stroke-alignment defs do', () => {
    const out = wrapSVGObjectOpacity(rect('svg a.b', { edgeSoften: 0.5 }), '<path />', STROKE_SCALE);
    expect(out).toContain('mask="url(#uw-soften-m-svg_a_b)"');
  });
});

describe('buildSVGObjectContent with opacity', () => {
  it('emits legacy markup when the object has neither field', () => {
    const out = buildSVGObjectContent(rect('svg_1'), STROKE_SCALE, 16);
    expect(out).not.toContain('<g opacity');
    expect(out).not.toContain('uw-soften');
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

  it('masks a softened shape', () => {
    const out = buildSVGObjectContent(rect('svg_1', { edgeSoften: 0.5 }), STROKE_SCALE, 16);
    expect(out).toContain('mask="url(#uw-soften-m-svg_1)"');
    expect(out).toContain('<feGaussianBlur');
  });
});
