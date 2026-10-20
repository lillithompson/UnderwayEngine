// Facet's confettiParticles suite (components/confetti/__tests__), ported
// with the module: the generator is the tutorial-finish burst's identity,
// so it keeps its original guarantees here.

import {
  easeOutQuad,
  generateParticles,
  particleFrame,
  DEFAULT_COLORS,
  DEFAULT_SPEED_RANGE,
  DEFAULT_SIZE_RANGE,
  DEFAULT_SPREAD,
  DEFAULT_ROTATION_SPEED,
} from '../confettiParticles';

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const baseOpts = {
  colors: DEFAULT_COLORS,
  speedRange: DEFAULT_SPEED_RANGE,
  sizeRange: DEFAULT_SIZE_RANGE,
  spread: DEFAULT_SPREAD,
  rotationSpeed: DEFAULT_ROTATION_SPEED,
};

describe('generateParticles', () => {
  test('produces the requested count', () => {
    const ps = generateParticles({ ...baseOpts, count: 24, random: seeded(1) });
    expect(ps).toHaveLength(24);
  });

  test('respects speed, size, angle, and rotation ranges', () => {
    const ps = generateParticles({ ...baseOpts, count: 200, random: seeded(42) });
    for (const p of ps) {
      expect(p.speed).toBeGreaterThanOrEqual(DEFAULT_SPEED_RANGE[0]);
      expect(p.speed).toBeLessThanOrEqual(DEFAULT_SPEED_RANGE[1]);
      expect(p.size).toBeGreaterThanOrEqual(DEFAULT_SIZE_RANGE[0]);
      expect(p.size).toBeLessThanOrEqual(DEFAULT_SIZE_RANGE[1]);
      expect(p.angle).toBeGreaterThanOrEqual(DEFAULT_SPREAD.angleMin);
      expect(p.angle).toBeLessThanOrEqual(DEFAULT_SPREAD.angleMax);
      expect(Math.abs(p.rotSpeed)).toBeLessThanOrEqual(DEFAULT_ROTATION_SPEED);
      expect(DEFAULT_COLORS).toContain(p.color);
    }
  });

  test('only uses colors from the provided palette', () => {
    const palette = ['#aaa', '#bbb', '#ccc'];
    const ps = generateParticles({ ...baseOpts, colors: palette, count: 50, random: seeded(7) });
    for (const p of ps) {
      expect(palette).toContain(p.color);
    }
  });

  test('falls back to default palette when colors prop is empty', () => {
    const ps = generateParticles({ ...baseOpts, colors: [], count: 30, random: seeded(99) });
    for (const p of ps) {
      expect(DEFAULT_COLORS).toContain(p.color);
    }
  });

  test('is deterministic for a given seed', () => {
    const a = generateParticles({ ...baseOpts, count: 10, random: seeded(123) });
    const b = generateParticles({ ...baseOpts, count: 10, random: seeded(123) });
    expect(a).toEqual(b);
  });

  test('count of 0 returns empty array', () => {
    const ps = generateParticles({ ...baseOpts, count: 0, random: seeded(1) });
    expect(ps).toHaveLength(0);
  });
});

// The frame math is Facet's ParticleView worklet verbatim — the burst's
// keyframes are sampled from it, so its identities are what keep the DOM
// port the same effect.
describe('particleFrame', () => {
  const p = { angle: Math.PI / 4, speed: 300, rotSpeed: 360 };

  test('starts at the origin, fully opaque', () => {
    expect(particleFrame(p, 0, 1.5, 600, 0.6)).toEqual({ x: 0, y: 0, rot: 0, opacity: 1 });
  });

  test('flies ballistically: velocity by angle, gravity on y only', () => {
    const f = particleFrame(p, 1, 1.5, 600, 0.6);
    expect(f.x).toBeCloseTo(Math.cos(p.angle) * 300 * 1.5);
    expect(f.y).toBeCloseTo(Math.sin(p.angle) * 300 * 1.5 + 0.5 * 600 * 1.5 * 1.5);
    expect(f.rot).toBeCloseTo(360 * 1.5);
    expect(f.opacity).toBe(0);
  });

  test('holds full opacity until fadeStart, then fades linearly to zero', () => {
    expect(particleFrame(p, 0.6, 1.5, 600, 0.6).opacity).toBeCloseTo(1);
    expect(particleFrame(p, 0.8, 1.5, 600, 0.6).opacity).toBeCloseTo(0.5);
  });

  test('easeOutQuad matches Easing.out(Easing.quad)', () => {
    expect(easeOutQuad(0)).toBe(0);
    expect(easeOutQuad(0.5)).toBeCloseTo(0.75);
    expect(easeOutQuad(1)).toBe(1);
  });
});
