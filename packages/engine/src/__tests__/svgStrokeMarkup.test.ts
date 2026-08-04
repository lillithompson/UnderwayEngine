/**
 * How a per-object stroke reaches the markup: `buildSVGObjectContent` (the
 * live DOM node layer) and `svgStrokePresentation` (shared with the SVG
 * exporter). The point of the shared helper is that the two can't drift, so
 * these assert the same knobs through both.
 */

import { buildSVGObjectContent, svgStrokePresentation } from '../svgPathBuilder';
import { SVG_STROKE_WIDTH, SVG_UNITS_PER_L0_CELL } from '../svgExport';
import { PathSegment, SVGObject } from '../types';

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

/** Pull the numeric stroke-width out of the emitted markup. */
function widthOf(markup: string): number {
  const m = markup.match(/stroke-width="([^"]+)"/);
  return m ? Number(m[1]) : NaN;
}

describe('buildSVGObjectContent — legacy behaviour is untouched', () => {
  it('an object with no stroke block strokes at the composition-wide scale', () => {
    const markup = buildSVGObjectContent(obj(), 0.2, 16);
    expect(widthOf(markup)).toBeCloseTo(SVG_STROKE_WIDTH * 0.2);
  });

  it('emits no dash, clip or mask by default', () => {
    const markup = buildSVGObjectContent(obj(), 0.2, 16);
    expect(markup).not.toContain('stroke-dasharray');
    expect(markup).not.toContain('clip-path');
    expect(markup).not.toContain('mask=');
    expect(markup).not.toContain('<defs>');
  });

  it('keeps the non-scaling vector-effect the DOM layer relies on', () => {
    expect(buildSVGObjectContent(obj(), 0.2, 16)).toContain('vector-effect="non-scaling-stroke"');
  });

  it('returns empty markup for an object with no geometry', () => {
    expect(buildSVGObjectContent(obj({ segments: [] }), 0.2, 16)).toBe('');
  });
});

describe('Width', () => {
  it('an authored width overrides the composition scale, in the caller unit', () => {
    // 0.375 cells at 16 units per cell = 6.
    const markup = buildSVGObjectContent(obj({ stroke: { width: 0.375 } }), 0.2, 16);
    expect(widthOf(markup)).toBeCloseTo(6);
  });

  it('the exporter reads the same width in ITS unit', () => {
    const { attrs } = svgStrokePresentation(obj({ stroke: { width: 0.375 } }), 0.2, SVG_UNITS_PER_L0_CELL);
    expect(widthOf(attrs)).toBeCloseTo(0.375 * SVG_UNITS_PER_L0_CELL);
  });
});

describe('Dash', () => {
  it('emits a dasharray scaled into the caller unit', () => {
    const markup = buildSVGObjectContent(obj({ stroke: { dash: 5 } }), 0.2, 16);
    expect(markup).toContain('stroke-dasharray=');
  });

  it('dash 0 is solid', () => {
    expect(buildSVGObjectContent(obj({ stroke: { dash: 0 } }), 0.2, 16)).not.toContain('stroke-dasharray');
  });
});

describe('Position', () => {
  it('inside clips to the filled path and doubles the stroke', () => {
    const markup = buildSVGObjectContent(obj({ stroke: { width: 0.25, position: 'inside' } }), 0.2, 16);
    expect(markup).toContain('<clipPath id="uw-stroke-clip-svg_7">');
    expect(markup).toContain('clip-path="url(#uw-stroke-clip-svg_7)"');
    // Doubled so that, once half is clipped away, the visible edge is 0.25.
    expect(widthOf(markup)).toBeCloseTo(0.25 * 16 * 2);
  });

  it('outside masks out the interior and doubles the stroke', () => {
    const markup = buildSVGObjectContent(obj({ stroke: { width: 0.25, position: 'outside' } }), 0.2, 16);
    expect(markup).toContain('<mask id="uw-stroke-mask-svg_7"');
    expect(markup).toContain('mask="url(#uw-stroke-mask-svg_7)"');
    expect(markup).toContain('fill="white"');
    expect(markup).toContain('fill="black"');
    expect(widthOf(markup)).toBeCloseTo(0.25 * 16 * 2);
  });

  it('states the mask region explicitly, around the object’s WORLD position', () => {
    // Regression: `<mask>` defaults its region to -10%/-10%/120%/120%, which
    // under userSpaceOnUse resolves against the viewport — a box at the user
    // space origin. An object anywhere else fell outside its own mask region
    // and vanished entirely. The region must cover the object's own bbox.
    const away = obj({ cellX: 20, cellY: 15, stroke: { width: 0.25, position: 'outside' } });
    const markup = buildSVGObjectContent(away, 0.2, 16);
    const m = markup.match(
      /<mask id="[^"]+" maskUnits="userSpaceOnUse" x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/);
    expect(m).not.toBeNull();
    const [x, y, w, h] = m!.slice(1).map(Number);
    const u = SVG_UNITS_PER_L0_CELL;
    // The object's world bbox is strictly inside the region…
    expect(x).toBeLessThan(20 * u);
    expect(y).toBeLessThan(15 * u);
    expect(x + w).toBeGreaterThan((20 + away.cellWidth) * u);
    expect(y + h).toBeGreaterThan((15 + away.cellHeight) * u);
    // …with room for the outward half of the stroke on every side.
    expect(20 * u - x).toBeGreaterThan(0.25 * u);
  });

  it('places the mask’s white rect over the same region it declares', () => {
    const away = obj({ cellX: 20, cellY: 15, stroke: { position: 'outside' } });
    const markup = buildSVGObjectContent(away, 0.2, 16);
    const region = markup.match(/maskUnits="userSpaceOnUse" x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/);
    const rect = markup.match(/<rect x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="white"/);
    expect(region).not.toBeNull();
    expect(rect).not.toBeNull();
    expect(rect!.slice(1)).toEqual(region!.slice(1));
  });

  it('center strokes plainly, at the authored width', () => {
    const markup = buildSVGObjectContent(obj({ stroke: { width: 0.25, position: 'center' } }), 0.2, 16);
    expect(markup).not.toContain('clip-path');
    expect(markup).not.toContain('mask=');
    expect(widthOf(markup)).toBeCloseTo(0.25 * 16);
  });

  it('an OPEN path ignores alignment — it has no inside', () => {
    const open = obj({ segments: [line([0, 0], [4, 0])], stroke: { width: 0.25, position: 'inside' } });
    const markup = buildSVGObjectContent(open, 0.2, 16);
    expect(markup).not.toContain('clip-path');
    expect(markup).not.toContain('mask=');
    expect(widthOf(markup)).toBeCloseTo(0.25 * 16);
  });

  it('gives each object its own def id so two aligned strokes coexist', () => {
    const a = buildSVGObjectContent(obj({ id: 'svg_a', stroke: { position: 'inside' } }), 0.2, 16);
    const b = buildSVGObjectContent(obj({ id: 'svg_b', stroke: { position: 'inside' } }), 0.2, 16);
    expect(a).toContain('uw-stroke-clip-svg_a');
    expect(b).toContain('uw-stroke-clip-svg_b');
  });
});

describe('Radius', () => {
  it('rounds the emitted path — arcs appear in the `d`', () => {
    const sharp = buildSVGObjectContent(obj(), 0.2, 16);
    const round = buildSVGObjectContent(obj({ stroke: { radius: 0.2 } }), 0.2, 16);
    expect(sharp).not.toMatch(/ A /);
    expect(round).toMatch(/ A /);
  });

  it('does not touch the stored segments', () => {
    const o = obj({ stroke: { radius: 0.2 } });
    const before = JSON.parse(JSON.stringify(o.segments));
    buildSVGObjectContent(o, 0.2, 16);
    expect(o.segments).toEqual(before);
  });

  it('rounds the fill outline too, so fill and stroke agree', () => {
    const markup = buildSVGObjectContent(
      obj({ stroke: { radius: 0.2 }, fillColor: { r: 1, g: 2, b: 3 } }), 0.2, 16);
    const fill = markup.match(/<path d="([^"]+)" fill="rgb\(1,2,3\)"/);
    expect(fill).not.toBeNull();
    expect(fill![1]).toMatch(/ A /);
  });
});

describe('svgStrokePresentation — export vs DOM', () => {
  it('omits the non-scaling vector-effect unless asked for it', () => {
    expect(svgStrokePresentation(obj(), 0.2, SVG_UNITS_PER_L0_CELL).attrs)
      .not.toContain('vector-effect');
    expect(svgStrokePresentation(obj(), 0.2, 16, { nonScaling: true }).attrs)
      .toContain('vector-effect="non-scaling-stroke"');
  });

  it('hands back the rounded segments for the caller to draw', () => {
    const { segments } = svgStrokePresentation(obj({ stroke: { radius: 0.2 } }), 0.2, SVG_UNITS_PER_L0_CELL);
    expect(segments.some((s) => s.kind === 'arc')).toBe(true);
  });

  it('hands back the authored segments when there is no radius', () => {
    const o = obj();
    expect(svgStrokePresentation(o, 0.2, SVG_UNITS_PER_L0_CELL).segments).toBe(o.segments);
  });
});
