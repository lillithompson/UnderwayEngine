/**
 * How an open path's decorated ends reach the markup: `pathEnds` (which end is
 * which, and which way it points), `svgEndpointsMarkup` (the decorations), and
 * `buildSVGObjectContent` (the node layer's use of it). Mirrors
 * svgStrokeMarkup / svgFillMarkup for the stroke and the fill.
 */

import { buildSVGObjectContent } from '../svgPathBuilder';
import { pathEnds, svgEndpointsActive, svgEndpointsMarkup } from '../svgEndpoints';
import { PathSegment, SVGEndpoints, SVGObject } from '../types';

const line = (start: [number, number], end: [number, number]): PathSegment =>
  ({ kind: 'line', start, end });

/** A 4-cell horizontal line, left to right. */
const straight = (): PathSegment[] => [line([0, 0], [4, 0])];

const closedRect = (): PathSegment[] => [
  line([0, 0], [4, 0]),
  line([4, 0], [4, 3]),
  line([4, 3], [0, 3]),
  line([0, 3], [0, 0]),
];

/** Stroke width 0.25 cells, so every decoration lands on a round number:
 *  circle r = 0.4375 cells (112 units), arrow 1 × 0.5 cells (256 × 128),
 *  square cap 0.125 cells (32) each way. */
const obj = (extras: Partial<SVGObject> = {}): SVGObject => ({
  id: 'svg_1',
  segments: straight(),
  color: { r: 10, g: 20, b: 30 },
  cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 0,
  stroke: { width: 0.25 },
  ...extras,
});

const W = 0.25;

describe('svgEndpointsActive', () => {
  it('is false for an absent block and for one that is all defaults', () => {
    expect(svgEndpointsActive(undefined)).toBe(false);
    expect(svgEndpointsActive({})).toBe(false);
    // Spelled-out defaults are still defaults — the app normalizes them away,
    // but the guard must not depend on it having done so.
    expect(svgEndpointsActive({
      startMarker: 'none', endMarker: 'none', startCap: 'round', endCap: 'round',
    })).toBe(false);
  });

  it('is true as soon as either end asks for anything', () => {
    expect(svgEndpointsActive({ startMarker: 'circle' })).toBe(true);
    expect(svgEndpointsActive({ endMarker: 'arrow' })).toBe(true);
    expect(svgEndpointsActive({ startCap: 'square' })).toBe(true);
    expect(svgEndpointsActive({ endCap: 'square' })).toBe(true);
  });
});

describe('pathEnds', () => {
  it('reports the first point and the last, pointing outward', () => {
    const e = pathEnds(straight())!;
    expect(e.start.at).toEqual([0, 0]);
    expect(e.start.dir[0]).toBeCloseTo(-1); // away from the path
    expect(e.start.dir[1]).toBeCloseTo(0);
    expect(e.end.at).toEqual([4, 0]);
    expect(e.end.dir[0]).toBeCloseTo(1);
  });

  it('follows a multi-segment chain to its two loose ends', () => {
    const e = pathEnds([line([0, 0], [2, 0]), line([2, 0], [2, 5])])!;
    expect(e.start.at).toEqual([0, 0]);
    expect(e.end.at).toEqual([2, 5]);
    expect(e.end.dir[0]).toBeCloseTo(0);
    expect(e.end.dir[1]).toBeCloseTo(1);
  });

  it('takes an arc\'s tangent, not its chord', () => {
    // Quarter arc centred at the origin from (1,0) to (0,1): the tangent at
    // the start is straight up (or down) — never along the chord (−1,1).
    const e = pathEnds([{ kind: 'arc', start: [1, 0], end: [0, 1], center: [0, 0] }])!;
    expect(e.start.dir[0]).toBeCloseTo(0);
    expect(Math.abs(e.start.dir[1])).toBeCloseTo(1);
    expect(Math.abs(e.end.dir[0])).toBeCloseTo(1);
    expect(e.end.dir[1]).toBeCloseTo(0);
  });

  it('returns null for a closed path — it has no loose end', () => {
    expect(pathEnds(closedRect())).toBeNull();
  });

  it('returns null for an empty path and for a zero-length one', () => {
    expect(pathEnds([])).toBeNull();
    expect(pathEnds([line([2, 2], [2, 2])])).toBeNull();
  });
});

describe('svgEndpointsMarkup — nothing to draw', () => {
  it('emits nothing for an undecorated path', () => {
    expect(svgEndpointsMarkup(obj(), straight(), W)).toBe('');
    expect(svgEndpointsMarkup(obj({ endpoints: {} }), straight(), W)).toBe('');
  });

  it('emits nothing for a closed path, however it is decorated', () => {
    const closed = obj({ segments: closedRect(), endpoints: { startMarker: 'arrow', endCap: 'square' } });
    expect(svgEndpointsMarkup(closed, closedRect(), W)).toBe('');
  });

  it('emits nothing for a tiled object — its ends are pattern seams', () => {
    const tiled = obj({ tileMode: 'repeat', endpoints: { endMarker: 'arrow' } });
    expect(svgEndpointsMarkup(tiled, straight(), W)).toBe('');
  });

  it('emits nothing at zero stroke width, where every decoration collapses', () => {
    expect(svgEndpointsMarkup(obj({ endpoints: { endMarker: 'arrow' } }), straight(), 0)).toBe('');
  });
});

describe('svgEndpointsMarkup — the decorations', () => {
  const markup = (endpoints: SVGEndpoints) =>
    svgEndpointsMarkup(obj({ endpoints }), straight(), W);

  it('draws a circle centred ON the endpoint, in the path\'s own color', () => {
    expect(markup({ startMarker: 'circle' }))
      .toBe('<circle cx="0" cy="0" r="112" fill="rgb(10,20,30)" stroke="none" />');
  });

  it('grows the arrowhead outward from the endpoint, tip last', () => {
    // Base corners straddle (4,0) at ±0.5 cells; the tip is 1 cell further on.
    expect(markup({ endMarker: 'arrow' }))
      .toBe('<path d="M 1024,128 L 1280,0 L 1024,-128 Z" fill="rgb(10,20,30)" stroke="none" />');
  });

  it('points each end\'s decoration its own way', () => {
    const both = markup({ startMarker: 'arrow', endMarker: 'arrow' });
    // The start arrow points left (x < 0), the end arrow right (x > 1024).
    expect(both).toContain('L -256,0');
    expect(both).toContain('L 1280,0');
  });

  it('lays a square cap over the round one as a half-width extrusion', () => {
    expect(markup({ endCap: 'square' }))
      .toBe('<path d="M 1024,32 L 1056,32 L 1056,-32 L 1024,-32 Z" fill="rgb(10,20,30)" stroke="none" />');
  });

  it('emits nothing for a round cap — the path already draws it', () => {
    expect(markup({ startCap: 'round', endCap: 'round' })).toBe('');
  });

  it('draws the cap before the marker, so the marker covers it', () => {
    const m = markup({ endMarker: 'arrow', endCap: 'square' });
    expect(m.indexOf('1056,32')).toBeLessThan(m.indexOf('L 1280,0'));
  });

  it('scales every decoration with the stroke width', () => {
    const thick = svgEndpointsMarkup(obj({ endpoints: { startMarker: 'circle' } }), straight(), W * 2);
    expect(thick).toContain('r="224"');
  });

  it('keeps the two ends independent', () => {
    const m = markup({ startMarker: 'circle', endMarker: 'arrow' });
    expect(m).toContain('<circle cx="0"');
    expect(m).toContain('L 1280,0');
    expect(m.match(/<circle/g)).toHaveLength(1);
  });
});

describe('buildSVGObjectContent — the node layer draws what the helper says', () => {
  it('leaves an undecorated path byte-identical to what it was', () => {
    const bare = buildSVGObjectContent(obj(), 0.2, 16);
    expect(bare).toBe(buildSVGObjectContent(obj({ endpoints: {} }), 0.2, 16));
    expect(bare).not.toContain('<circle');
    // The stroke keeps its round linecap regardless — the cap control is
    // geometry, so it can never restyle the dashes.
    expect(bare).toContain('stroke-linecap="round"');
  });

  it('appends the decorations after the stroke, so they sit on top', () => {
    const m = buildSVGObjectContent(obj({ endpoints: { startMarker: 'circle' } }), 0.2, 16);
    expect(m.indexOf('stroke="rgb(10,20,30)"')).toBeLessThan(m.indexOf('<circle'));
  });

  it('never switches stroke-linecap, even for two square ends', () => {
    const m = buildSVGObjectContent(obj({ endpoints: { startCap: 'square', endCap: 'square' } }), 0.2, 16);
    expect(m).toContain('stroke-linecap="round"');
    expect(m).not.toContain('stroke-linecap="square"');
  });

  it('sizes the decoration off the width the object is actually stroked at', () => {
    // No per-object width → the composition-wide default, which for this unit
    // (BASE_CELL_PX = 16) is SVG_STROKE_WIDTH × strokeScale ÷ 16 cells.
    const m = buildSVGObjectContent(
      obj({ stroke: undefined, endpoints: { startMarker: 'circle' } }), 0.2, 16,
    );
    const r = Number(m.match(/<circle [^>]*r="([\d.]+)"/)![1]);
    expect(r).toBeCloseTo((5 * 0.2 / 16) * 1.75 * 256, 3);
  });
});
