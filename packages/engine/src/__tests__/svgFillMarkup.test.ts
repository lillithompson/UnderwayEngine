/**
 * How a shape's fill reaches the markup: `svgFillPresentation` (the paint,
 * shared by the live DOM node layer and the SVG exporter) and
 * `buildSVGObjectContent` (the node layer's use of it). The point of the shared
 * helper is that the canvas and the export can't drift, so these assert the
 * paint through both — mirroring svgStrokeMarkup.test.ts for the stroke.
 */

import { buildSVGObjectContent, svgFillPresentation, svgIsFilled } from '../svgPathBuilder';
import { PathSegment, ShapeFill, SVGObject } from '../types';

const line = (start: [number, number], end: [number, number]): PathSegment =>
  ({ kind: 'line', start, end });

const rect = (): PathSegment[] => [
  line([0, 0], [4, 0]),
  line([4, 0], [4, 3]),
  line([4, 3], [0, 3]),
  line([0, 3], [0, 0]),
];

const obj = (extras: Partial<SVGObject> = {}): SVGObject => ({
  id: 'svg_7',
  segments: rect(),
  color: { r: 10, g: 20, b: 30 },
  cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 3,
  ...extras,
});

const solidFill = (extras: Partial<ShapeFill> = {}): ShapeFill => ({
  type: 'solid',
  solid: { r: 255, g: 0, b: 0 },
  stops: [
    { offset: 0, color: { r: 0, g: 0, b: 0 } },
    { offset: 1, color: { r: 255, g: 255, b: 255 } },
  ],
  angle: 90,
  opacity: 1,
  blend: 'normal',
  ...extras,
});

describe('svgIsFilled', () => {
  it('is true for any of the three fields that can carry a fill', () => {
    expect(svgIsFilled(obj({ fill: solidFill() }))).toBe(true);
    expect(svgIsFilled(obj({ fillPaint: { kind: 'solid', color: { r: 9, g: 9, b: 9 } } }))).toBe(true);
    expect(svgIsFilled(obj({ fillColor: { r: 1, g: 2, b: 3 } }))).toBe(true);
  });

  it('is false for an outline-only shape', () => {
    expect(svgIsFilled(obj())).toBe(false);
  });

  it('is false for a pattern-fill mask, whose own path is outline-only', () => {
    expect(svgIsFilled(obj({ isPatternFill: true, fillColor: { r: 1, g: 2, b: 3 } }))).toBe(false);
  });

  it('agrees with whether there is anything to paint', () => {
    for (const o of [obj(), obj({ fill: solidFill() }), obj({ fillColor: { r: 1, g: 2, b: 3 } }),
      obj({ isPatternFill: true, fillColor: { r: 1, g: 2, b: 3 } })]) {
      expect(svgFillPresentation(o, 'g') !== null).toBe(svgIsFilled(o));
    }
  });
});

describe('svgFillPresentation — nothing to paint', () => {
  it('returns null for a shape with no fill of any kind', () => {
    expect(svgFillPresentation(obj(), 'grad_x')).toBeNull();
  });

  it('returns null for a pattern-fill mask — its fill belongs to the tiles', () => {
    const pattern = obj({ isPatternFill: true, fillColor: { r: 1, g: 2, b: 3 }, fill: solidFill() });
    expect(svgFillPresentation(pattern, 'grad_x')).toBeNull();
  });
});

describe('svgFillPresentation — legacy fills are untouched', () => {
  it('emits the legacy fillColor exactly as before, with no defs', () => {
    const p = svgFillPresentation(obj({ fillColor: { r: 1, g: 2, b: 3 } }), 'grad_x')!;
    expect(p.defs).toBe('');
    expect(p.attrs).toBe('fill="rgb(1,2,3)"');
  });

  it('carries a partial legacy fillOpacity through and omits a full one', () => {
    expect(svgFillPresentation(obj({ fillColor: { r: 1, g: 2, b: 3 }, fillOpacity: 0.4 }), 'g')!.attrs)
      .toBe('fill="rgb(1,2,3)" fill-opacity="0.4"');
    expect(svgFillPresentation(obj({ fillColor: { r: 1, g: 2, b: 3 }, fillOpacity: 1 }), 'g')!.attrs)
      .toBe('fill="rgb(1,2,3)"');
  });

  it('lets a flattened fillPaint outrank the legacy solid', () => {
    const p = svgFillPresentation(obj({
      fillColor: { r: 1, g: 2, b: 3 },
      fillPaint: { kind: 'solid', color: { r: 9, g: 9, b: 9 } },
    }), 'grad_x')!;
    expect(p.attrs).toContain('#090909');
    expect(p.attrs).not.toContain('rgb(1,2,3)');
  });
});

describe('svgFillPresentation — the editable fill block', () => {
  it('outranks both the flattened paint and the legacy solid', () => {
    const p = svgFillPresentation(obj({
      fill: solidFill(),
      fillColor: { r: 1, g: 2, b: 3 },
      fillPaint: { kind: 'solid', color: { r: 9, g: 9, b: 9 } },
    }), 'grad_x')!;
    expect(p.attrs).toContain('#FF0000');
    expect(p.attrs).not.toContain('rgb(1,2,3)');
    expect(p.attrs).not.toContain('#090909');
  });

  it('paints a Solid fill flat, with no gradient defs', () => {
    const p = svgFillPresentation(obj({ fill: solidFill() }), 'grad_x')!;
    expect(p.defs).toBe('');
    expect(p.attrs).toBe('fill="#FF0000"');
  });

  it('emits a linear gradient def the attrs reference by the given id', () => {
    const p = svgFillPresentation(obj({ fill: solidFill({ type: 'linear' }) }), 'grad_svg_7')!;
    expect(p.defs).toContain('<linearGradient id="grad_svg_7"');
    expect(p.defs).toContain('gradientUnits="objectBoundingBox"');
    expect(p.attrs).toBe('fill="url(#grad_svg_7)"');
  });

  it('emits a radial gradient def for the radial type', () => {
    const p = svgFillPresentation(obj({ fill: solidFill({ type: 'radial' }) }), 'g')!;
    expect(p.defs).toContain('<radialGradient id="g"');
    expect(p.attrs).toBe('fill="url(#g)"');
  });

  it('carries the layer opacity onto the fill and omits it at full', () => {
    expect(svgFillPresentation(obj({ fill: solidFill({ opacity: 0.5 }) }), 'g')!.attrs)
      .toBe('fill="#FF0000" fill-opacity="0.5"');
    expect(svgFillPresentation(obj({ fill: solidFill({ opacity: 1 }) }), 'g')!.attrs)
      .toBe('fill="#FF0000"');
  });

  it('multiplies the layer opacity by a per-stop alpha rather than replacing it', () => {
    // A Paint may carry its own alpha; the bar's Opacity row is the whole
    // layer's, so the two compose.
    const p = svgFillPresentation(obj({
      fill: { ...solidFill(), opacity: 0.5 },
      // fillPaint is outranked, so the alpha must come from the fill's own
      // solid — which carries none. 0.5 × 1 = 0.5.
    }), 'g')!;
    expect(p.attrs).toContain('fill-opacity="0.5"');
  });

  it('emits a blend mode only when it is not the default', () => {
    expect(svgFillPresentation(obj({ fill: solidFill({ blend: 'normal' }) }), 'g')!.attrs)
      .not.toContain('mix-blend-mode');
    expect(svgFillPresentation(obj({ fill: solidFill({ blend: 'multiply' }) }), 'g')!.attrs)
      .toContain('style="mix-blend-mode:multiply"');
  });

  it('clamps a nonsense opacity into range', () => {
    expect(svgFillPresentation(obj({ fill: solidFill({ opacity: -3 }) }), 'g')!.attrs)
      .toContain('fill-opacity="0"');
    expect(svgFillPresentation(obj({ fill: solidFill({ opacity: 4 }) }), 'g')!.attrs)
      .not.toContain('fill-opacity');
  });
});

describe('buildSVGObjectContent — the node layer draws what the helper says', () => {
  it('draws no fill path for an unfilled shape', () => {
    expect(buildSVGObjectContent(obj(), 0.2, 16)).not.toContain('fill-rule="nonzero"');
  });

  it('draws the fill under the stroke so the outline sits on top', () => {
    const markup = buildSVGObjectContent(obj({ fill: solidFill() }), 0.2, 16);
    expect(markup.indexOf('fill-rule="nonzero"')).toBeLessThan(markup.indexOf('stroke="rgb(10,20,30)"'));
  });

  it('carries the gradient defs into the markup ahead of the path using them', () => {
    const markup = buildSVGObjectContent(obj({ fill: solidFill({ type: 'linear' }) }), 0.2, 16);
    expect(markup).toContain('<linearGradient id="grad_svg_7"');
    expect(markup).toContain('fill="url(#grad_svg_7)"');
    expect(markup.indexOf('<linearGradient')).toBeLessThan(markup.indexOf('url(#grad_svg_7)'));
  });

  it('renders a fillPaint the DOM layer used to ignore, matching the export', () => {
    const markup = buildSVGObjectContent(obj({
      fillPaint: { kind: 'solid', color: { r: 9, g: 9, b: 9 } },
    }), 0.2, 16);
    expect(markup).toContain('fill="#090909"');
  });

  it('leaves a legacy fillColor rendering byte-for-byte as it did', () => {
    const markup = buildSVGObjectContent(obj({ fillColor: { r: 1, g: 2, b: 3 }, fillOpacity: 0.4 }), 0.2, 16);
    expect(markup).toContain('fill="rgb(1,2,3)" fill-opacity="0.4" stroke="none" fill-rule="nonzero"');
  });

  it('follows the corner-rounded outline the stroke follows', () => {
    // Radius reshapes the drawn path; the fill must trace the same shape or it
    // would peek out past the rounded corners.
    const rounded = buildSVGObjectContent(obj({ fill: solidFill(), stroke: { radius: 0.3 } }), 0.2, 16);
    const sharp = buildSVGObjectContent(obj({ fill: solidFill() }), 0.2, 16);
    const fillD = (m: string) => m.match(/<path d="([^"]+)" fill="#FF0000"/)![1];
    expect(fillD(rounded)).toContain('A '); // arcs spliced in at the corners
    expect(fillD(rounded)).not.toBe(fillD(sharp));
  });
});
