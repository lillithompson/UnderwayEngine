/**
 * SVGSubpath.fill rendering: fill subpaths emit filled closed loops beneath
 * stroke subpaths in buildSVGObjectContent (and its tile variant).
 */

import { PathSegment, SVGObject } from '../types';
import { buildSVGObjectContent, buildSVGObjectTileContent } from '../svgPathBuilder';

function rect(x: number, y: number, w: number, h: number): PathSegment[] {
  const pts: [number, number][] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  return pts.map((p, i) => ({ kind: 'line' as const, start: p, end: pts[(i + 1) % pts.length] }));
}

function makeObj(extras: Partial<SVGObject> = {}): SVGObject {
  const loop = rect(0, 0, 2, 2);
  const strokes: PathSegment[] = [{ kind: 'line', start: [2, 0], end: [4, 2] }];
  return {
    id: 'svg_1',
    segments: [...loop, ...strokes],
    color: { r: 255, g: 255, b: 255 },
    cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 2,
    subpaths: [
      { color: { r: 200, g: 40, b: 40 }, segments: loop, fill: true },
      { color: { r: 255, g: 255, b: 255 }, segments: strokes },
    ],
    ...extras,
  };
}

describe('buildSVGObjectContent with fill subpaths', () => {
  it('emits a filled path for fill subpaths and a stroked path for the rest', () => {
    const out = buildSVGObjectContent(makeObj(), 8, 256);
    expect(out).toContain('fill="rgb(200,40,40)"');
    expect(out).toContain('fill-rule="nonzero"');
    expect(out).toContain('stroke="rgb(255,255,255)"');
    // The fill element must come before the stroke element so strokes
    // draw on top.
    expect(out.indexOf('fill="rgb(200,40,40)"')).toBeLessThan(out.indexOf('stroke="rgb(255,255,255)"'));
  });

  it('renders no stroke for a fill-only subpath object', () => {
    const loop = rect(0, 0, 2, 2);
    const obj = makeObj({
      segments: loop,
      subpaths: [{ color: { r: 10, g: 20, b: 30 }, segments: loop, fill: true }],
    });
    const out = buildSVGObjectContent(obj, 8, 256);
    expect(out).toContain('fill="rgb(10,20,30)"');
    expect(out).not.toContain('stroke="rgb(10,20,30)"');
  });
});

describe('buildSVGObjectTileContent with fill subpaths', () => {
  it('emits fill then stroke in tile-local space', () => {
    const obj = makeObj({ tileMode: 'repeat', tileWidthL0: 4, tileHeightL0: 2 });
    const out = buildSVGObjectTileContent(obj, 8);
    expect(out).toContain('fill="rgb(200,40,40)"');
    expect(out.indexOf('fill="rgb(200,40,40)"')).toBeLessThan(out.indexOf('stroke="rgb(255,255,255)"'));
  });
});
