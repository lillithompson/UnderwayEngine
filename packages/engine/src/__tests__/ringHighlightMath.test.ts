import { computeRingGeometry, ringPhase } from '../tutorial/ringHighlightMath';

describe('computeRingGeometry', () => {
  it('centers on a square rect and uses half the side as base radius', () => {
    const g = computeRingGeometry({ x: 100, y: 200, width: 50, height: 50 }, 0, 2);
    expect(g.cx).toBe(125);
    expect(g.cy).toBe(225);
    expect(g.minRadius).toBe(25);
    expect(g.maxRadius).toBe(50);
  });

  it('caps minRadius on a tall rect', () => {
    const g = computeRingGeometry({ x: 0, y: 0, width: 20, height: 80 }, 0, 1);
    expect(g.minRadius).toBe(36); // capped at MIN_RADIUS_CAP
    expect(g.maxRadius).toBe(40); // rawMinRadius * radiusScale
  });

  it('caps minRadius on a wide rect', () => {
    const g = computeRingGeometry({ x: 0, y: 0, width: 100, height: 30 }, 0, 1);
    expect(g.minRadius).toBe(36); // capped at MIN_RADIUS_CAP
    expect(g.maxRadius).toBe(50); // rawMinRadius * radiusScale
  });

  it('adds padding before scaling', () => {
    const g = computeRingGeometry({ x: 0, y: 0, width: 40, height: 40 }, 10, 2);
    expect(g.minRadius).toBe(30);
    expect(g.maxRadius).toBe(60);
  });

  it('applies radiusScale to the padded base', () => {
    const g = computeRingGeometry({ x: 0, y: 0, width: 40, height: 40 }, 0, 2.5);
    expect(g.minRadius).toBe(20);
    expect(g.maxRadius).toBe(50);
  });

  it('centers correctly on a rect not at the origin', () => {
    const g = computeRingGeometry({ x: 30, y: 60, width: 40, height: 40 }, 0, 1);
    expect(g.cx).toBe(50);
    expect(g.cy).toBe(80);
  });
});

describe('ringPhase', () => {
  it('staggers 3 rings evenly at progress 0', () => {
    expect(ringPhase(0, 0, 3)).toBeCloseTo(0);
    expect(ringPhase(0, 1, 3)).toBeCloseTo(1 / 3);
    expect(ringPhase(0, 2, 3)).toBeCloseTo(2 / 3);
  });

  it('staggers 4 rings evenly at progress 0.5', () => {
    expect(ringPhase(0.5, 0, 4)).toBeCloseTo(0.5);
    expect(ringPhase(0.5, 1, 4)).toBeCloseTo(0.75);
    expect(ringPhase(0.5, 2, 4)).toBeCloseTo(0);
    expect(ringPhase(0.5, 3, 4)).toBeCloseTo(0.25);
  });

  it('wraps when progress + offset exceeds 1', () => {
    expect(ringPhase(0.9, 1, 3)).toBeCloseTo((0.9 + 1 / 3) - 1);
  });

  it('returns a value in [0, 1) for any non-negative progress', () => {
    for (const p of [0, 0.25, 0.5, 0.75, 0.999, 1, 1.5, 2.7]) {
      for (let i = 0; i < 5; i++) {
        const v = ringPhase(p, i, 5);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it('is monotonically increasing within one cycle for ring 0', () => {
    expect(ringPhase(0.1, 0, 3)).toBeLessThan(ringPhase(0.2, 0, 3));
    expect(ringPhase(0.2, 0, 3)).toBeLessThan(ringPhase(0.5, 0, 3));
  });
});
