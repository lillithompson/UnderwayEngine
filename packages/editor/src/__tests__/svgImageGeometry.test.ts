import { coverImageRect } from '@/engine/imageFraming';
import type { ImageObject } from '@/engine/types';
import {
  imageContentRect,
  parseSvgViewBox,
  pathPolylines,
  polylineBboxArea,
  polylineSegments,
  svgImageWorldPolylines,
  svgPolylines,
} from '../formats/svgImageGeometry';

// The geometry of an SVG picture placed on a page
// (formats/svgImageGeometry.ts): its shapes flattened in viewBox units,
// then laid in world cells where the picture's framing draws its bitmap.

const doc = (body: string, root = 'viewBox="0 0 100 50"') =>
  `<svg ${root} xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

function image(overrides: Partial<ImageObject> = {}): ImageObject {
  return {
    id: 'img_1', imageId: 'blob', mimeType: 'image/svg+xml',
    pixelWidth: 200, pixelHeight: 100,
    cellX: 10, cellY: 20, cellWidth: 20, cellHeight: 10,
    ...overrides,
  };
}

describe('parseSvgViewBox', () => {
  test('reads the viewBox, else the declared size, else nothing', () => {
    expect(parseSvgViewBox(doc(''))).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    expect(parseSvgViewBox(doc('', 'viewBox="5, 6, 40, 30"'))).toEqual({ x: 5, y: 6, width: 40, height: 30 });
    expect(parseSvgViewBox(doc('', 'width="1537" height="1109"'))).toEqual({ x: 0, y: 0, width: 1537, height: 1109 });
    expect(parseSvgViewBox(doc('', ''))).toBeNull();
    expect(parseSvgViewBox('not svg')).toBeNull();
  });
});

describe('pathPolylines', () => {
  test('straight commands, absolute and relative, and a Z that closes', () => {
    expect(pathPolylines('M10 10 L90 10 L90 90 L10 90 Z')).toEqual([
      { points: [10, 10, 90, 10, 90, 90, 10, 90], closed: true },
    ]);
    expect(pathPolylines('m10 10 l80 0 v80 h-80 z')).toEqual([
      { points: [10, 10, 90, 10, 90, 90, 10, 90], closed: true },
    ]);
    // An M's extra pairs are lines; no Z leaves it open.
    expect(pathPolylines('M0 0 10 0 10 10')).toEqual([{ points: [0, 0, 10, 0, 10, 10], closed: false }]);
  });

  test('one polyline per subpath, and a Z followed by more drawing starts from the subpath start', () => {
    const out = pathPolylines('M0 0 L10 0 Z M20 20 L30 20');
    expect(out).toEqual([
      { points: [0, 0, 10, 0], closed: true },
      { points: [20, 20, 30, 20], closed: false },
    ]);
    const after = pathPolylines('M0 0 L10 0 L10 10 Z L5 5');
    expect(after[1].points.slice(0, 2)).toEqual([0, 0]);
  });

  test('a cubic is sampled into chords that start and end exactly on the curve’s ends', () => {
    const [poly] = pathPolylines('M0 0 C0 10 10 10 10 0');
    expect(poly.closed).toBe(false);
    expect(poly.points.slice(0, 2)).toEqual([0, 0]);
    expect(poly.points.slice(-2)).toEqual([10, 0]);
    expect(poly.points.length / 2).toBeGreaterThan(8);
    // The curve's midpoint (t = 0.5) is (5, 7.5), and the sample there lands
    // on it: the samples after the start point are evenly spaced in t.
    const samples = poly.points.length / 2 - 1;
    const mid = samples / 2;
    expect(poly.points[2 * mid]).toBeCloseTo(5, 6);
    expect(poly.points[2 * mid + 1]).toBeCloseTo(7.5, 6);
  });

  test('S and T reflect the previous control point; Q samples like C', () => {
    const smooth = pathPolylines('M0 0 C0 10 10 10 10 0 S20 -10 20 0')[0];
    expect(smooth.points.slice(-2)).toEqual([20, 0]);
    // Reflected control keeps the curve smooth through (10, 0): the first
    // sample after it continues DOWN (the reflected tangent), not up.
    const at10 = smooth.points.indexOf(10, 0);
    expect(smooth.points[at10 + 3]).toBeLessThan(0);
    const quad = pathPolylines('M0 0 Q5 10 10 0 T20 0')[0];
    expect(quad.points.slice(-2)).toEqual([20, 0]);
    expect(quad.points.length / 2).toBeGreaterThan(10);
  });

  test('an arc is sampled on its circle', () => {
    // A semicircle of radius 10 from (0,0) to (20,0), centred on (10,0).
    const [poly] = pathPolylines('M0 0 A10 10 0 0 1 20 0');
    expect(poly.points.slice(-2)).toEqual([20, 0]);
    for (let i = 0; i < poly.points.length; i += 2) {
      expect(Math.hypot(poly.points[i] - 10, poly.points[i + 1])).toBeCloseTo(10, 6);
    }
    expect(poly.points.length / 2).toBeGreaterThan(8);
  });
});

describe('svgPolylines', () => {
  test('reads every shape element in document order', () => {
    const out = svgPolylines(doc(
      '<rect x="1" y="2" width="3" height="4"/>' +
      '<line x1="0" y1="0" x2="5" y2="5"/>' +
      '<polygon points="0,0 4,0 4,4"/>' +
      '<polyline points="0 0 1 1 2 0"/>' +
      '<circle cx="10" cy="10" r="2"/>' +
      '<path d="M0 0 L1 1"/>',
    ));
    expect(out.map((p) => p.closed)).toEqual([true, false, true, false, true, false]);
    expect(out[0].points).toEqual([1, 2, 4, 2, 4, 6, 1, 6]);
    expect(out[1].points).toEqual([0, 0, 5, 5]);
    expect(out[2].points).toEqual([0, 0, 4, 0, 4, 4]);
    for (let i = 0; i < out[4].points.length; i += 2) {
      expect(Math.hypot(out[4].points[i] - 10, out[4].points[i + 1] - 10)).toBeCloseTo(2, 6);
    }
    expect(out[5].points).toEqual([0, 0, 1, 1]);
  });

  test('the real Mask document is one closed shape', () => {
    const mask = '<svg width="1537" height="1109" viewBox="0 0 1537 1109" fill="none">' +
      '<path d="M452 535C455.455 552.706 527.952 707.028 563.619 781.528H643L722.5 779.5L804 773.5L881.119 757.528' +
      'C825.119 649.694 716.219 436.928 694.619 412.528C667.619 382.028 604.119 379.028 576.619 350.028Z" fill="#D9D9D9"/></svg>';
    const out = svgPolylines(mask);
    expect(out).toHaveLength(1);
    expect(out[0].closed).toBe(true);
    expect(out[0].points.slice(0, 2)).toEqual([452, 535]);
  });
});

describe('imageContentRect — where the bitmap is drawn', () => {
  test('no framing: stretched to the node bbox', () => {
    expect(imageContentRect(image())).toEqual({ x: 10, y: 20, w: 20, h: 10 });
  });

  test('Fill: the engine’s cover rect, offset to the node', () => {
    const img = image({ cellWidth: 20, cellHeight: 20, framing: { mode: 'fill', zoom: 1 } });
    const r = coverImageRect(20, 20, 2, 1, 0, 0);
    expect(imageContentRect(img)).toEqual({ x: 10 + r.x, y: 20 + r.y, w: r.w, h: r.h });
    // Cover of a square by a 2:1 picture: as tall as the frame, twice as wide, centred.
    expect(imageContentRect(img)).toEqual({ x: 0, y: 20, w: 40, h: 20 });
  });

  test('Fit: contained inside the margin, centred', () => {
    const img = image({ cellWidth: 20, cellHeight: 20, framing: { mode: 'fit', margin: 2 } });
    // 16×16 box; a 2:1 picture is 16 wide, 8 tall, centred vertically.
    expect(imageContentRect(img)).toEqual({ x: 12, y: 26, w: 16, h: 8 });
  });

  test('Tile draws no one rectangle', () => {
    expect(imageContentRect(image({ framing: { mode: 'tile' } }))).toBeNull();
  });
});

describe('svgImageWorldPolylines', () => {
  test('maps viewBox units onto the drawn rectangle', () => {
    const out = svgImageWorldPolylines(image(), doc('<path d="M0 0 L50 25 L100 50"/>'));
    expect(out).toEqual([{ points: [10, 20, 20, 25, 30, 30], closed: false }]);
  });

  test('honours a viewBox origin, and yields nothing without one', () => {
    const shifted = svgImageWorldPolylines(image(), doc('<path d="M5 6 L45 36"/>', 'viewBox="5 6 40 30"'));
    expect(shifted[0].points).toEqual([10, 20, 30, 30]);
    expect(svgImageWorldPolylines(image(), doc('<path d="M0 0 L1 1"/>', ''))).toEqual([]);
    expect(svgImageWorldPolylines(image({ framing: { mode: 'tile' } }), doc('<path d="M0 0 L1 1"/>'))).toEqual([]);
  });
});

describe('polylineSegments', () => {
  test('consecutive line segments, closed back to the first point', () => {
    const segs = polylineSegments({ points: [0, 0, 4, 0, 4, 4], closed: true });
    expect(segs).toEqual([
      { kind: 'line', start: [0, 0], end: [4, 0] },
      { kind: 'line', start: [4, 0], end: [4, 4] },
      { kind: 'line', start: [4, 4], end: [0, 0] },
    ]);
  });

  test('skips repeated points and does not double a closing point the data carries', () => {
    const segs = polylineSegments({ points: [0, 0, 0, 0, 4, 0, 4, 4, 0, 0], closed: true });
    expect(segs).toHaveLength(3);
    expect(polylineSegments({ points: [0, 0, 4, 0], closed: false })).toHaveLength(1);
  });

  test('polylineBboxArea is the box’s area', () => {
    expect(polylineBboxArea({ points: [1, 1, 5, 1, 3, 4], closed: true })).toBe(12);
    expect(polylineBboxArea({ points: [], closed: false })).toBe(0);
  });
});
