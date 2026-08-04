import { tintFillToPaint } from '../imageTintFill';
import type { ImageTintFill } from '../types';

const base = (over: Partial<ImageTintFill>): ImageTintFill => ({
  type: 'linear',
  solid: { r: 1, g: 2, b: 3 },
  stops: [
    { offset: 0, color: { r: 0, g: 0, b: 0 } },
    { offset: 1, color: { r: 255, g: 255, b: 255 } },
  ],
  angle: 90,
  opacity: 0.7,
  blend: 'multiply',
  ...over,
});

describe('tintFillToPaint', () => {
  test('solid maps to a solid paint of the solid color', () => {
    expect(tintFillToPaint(base({ type: 'solid' }))).toEqual({
      kind: 'solid', color: { r: 1, g: 2, b: 3 },
    });
  });

  test('radial centers on the frame with r=0.5 and carries the stops', () => {
    const p = tintFillToPaint(base({ type: 'radial' }));
    expect(p).toMatchObject({ kind: 'radial', cx: 0.5, cy: 0.5, r: 0.5 });
    if (p.kind === 'radial') expect(p.stops).toHaveLength(2);
  });

  test('linear angle 90 flows top→bottom (design default)', () => {
    const p = tintFillToPaint(base({ angle: 90 }));
    if (p.kind !== 'linear') throw new Error('expected linear');
    // Start at the top-center, end at the bottom-center.
    expect(p.x1).toBeCloseTo(0.5, 5);
    expect(p.y1).toBeCloseTo(0, 5);
    expect(p.x2).toBeCloseTo(0.5, 5);
    expect(p.y2).toBeCloseTo(1, 5);
  });

  test('linear angle 0 flows left→right', () => {
    const p = tintFillToPaint(base({ angle: 0 }));
    if (p.kind !== 'linear') throw new Error('expected linear');
    expect(p.x1).toBeCloseTo(0, 5);
    expect(p.y1).toBeCloseTo(0.5, 5);
    expect(p.x2).toBeCloseTo(1, 5);
    expect(p.y2).toBeCloseTo(0.5, 5);
  });

  test('sorts out-of-order stops (a mid stop appended by "+" paints in the middle)', () => {
    // addStop appends the new stop at the end of the array, so the stored order
    // is [0, 1, 0.5]; the paint must reorder to 0, 0.5, 1 or CSS/SVG clamps the
    // 0.5 up to 1 and it vanishes on the image.
    const fill = base({
      type: 'linear',
      stops: [
        { offset: 0, color: { r: 1, g: 1, b: 1 } },
        { offset: 1, color: { r: 3, g: 3, b: 3 } },
        { offset: 0.5, color: { r: 2, g: 2, b: 2 } },
      ],
    });
    const p = tintFillToPaint(fill);
    if (p.kind !== 'linear') throw new Error('expected linear');
    expect(p.stops.map((s) => s.offset)).toEqual([0, 0.5, 1]);
    expect(p.stops.map((s) => s.color.r)).toEqual([1, 2, 3]);
  });

  test('does not mutate the input stops array', () => {
    const stops = [
      { offset: 1, color: { r: 3, g: 3, b: 3 } },
      { offset: 0, color: { r: 1, g: 1, b: 1 } },
    ];
    tintFillToPaint(base({ type: 'radial', stops }));
    expect(stops.map((s) => s.offset)).toEqual([1, 0]); // untouched
  });
});
