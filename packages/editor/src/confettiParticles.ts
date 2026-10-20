// Facet's confetti particle model (components/confetti/confettiParticles.ts),
// ported verbatim: the physics constants and the generator are the effect's
// identity — the burst that plays when a Facet tutorial finishes — and the
// done-mark celebration reuses it unchanged. Only the renderer differs (DOM
// in ConfettiBurst.tsx; Facet drives the same numbers through reanimated).

export type Particle = {
  angle: number;
  speed: number;
  rotSpeed: number;
  size: number;
  color: string;
};

export type ParticleGenOptions = {
  count: number;
  colors: string[];
  speedRange: [number, number];
  sizeRange: [number, number];
  spread: { angleMin: number; angleMax: number };
  rotationSpeed: number;
  random?: () => number;
};

export const DEFAULT_COLORS = ['#FF6B6B', '#FFD24A', '#4ECDC4', '#5C6FE0', '#A06FE5'];

export const DEFAULT_PARTICLE_COUNT = 24;
export const DEFAULT_DURATION_MS = 1500;
export const DEFAULT_GRAVITY = 600;
export const DEFAULT_SPEED_RANGE: [number, number] = [220, 520];
export const DEFAULT_SIZE_RANGE: [number, number] = [6, 10];
export const DEFAULT_ROTATION_SPEED = 720;
export const DEFAULT_FADE_START = 0.6;
export const DEFAULT_SPREAD = { angleMin: 0, angleMax: Math.PI * 2 };

/** The particle's pose at eased progress `p` of a `durationSec` flight —
 *  Facet's ParticleView worklet, verbatim physics. ConfettiBurst samples
 *  this into Web Animations keyframes. */
export function particleFrame(
  particle: Pick<Particle, 'angle' | 'speed' | 'rotSpeed'>,
  p: number,
  durationSec: number,
  gravity: number,
  fadeStart: number,
): { x: number; y: number; rot: number; opacity: number } {
  const t = p * durationSec;
  const fadeSpan = 1 - fadeStart;
  return {
    x: Math.cos(particle.angle) * particle.speed * t,
    y: Math.sin(particle.angle) * particle.speed * t + 0.5 * gravity * t * t,
    rot: particle.rotSpeed * t,
    opacity: fadeSpan > 0 ? Math.max(0, 1 - Math.max(0, p - fadeStart) / fadeSpan) : 1,
  };
}

/** Easing.out(Easing.quad), as Facet's withTiming applies it. */
export function easeOutQuad(raw: number): number {
  return 1 - (1 - raw) * (1 - raw);
}

export function generateParticles(opts: ParticleGenOptions): Particle[] {
  const rand = opts.random ?? Math.random;
  const [speedMin, speedMax] = opts.speedRange;
  const [sizeMin, sizeMax] = opts.sizeRange;
  const angleSpan = opts.spread.angleMax - opts.spread.angleMin;
  const colors = opts.colors.length > 0 ? opts.colors : DEFAULT_COLORS;

  const particles: Particle[] = new Array(opts.count);
  for (let i = 0; i < opts.count; i++) {
    particles[i] = {
      angle: opts.spread.angleMin + rand() * angleSpan,
      speed: speedMin + rand() * (speedMax - speedMin),
      rotSpeed: (rand() * 2 - 1) * opts.rotationSpeed,
      size: sizeMin + rand() * (sizeMax - sizeMin),
      color: colors[Math.floor(rand() * colors.length)],
    };
  }
  return particles;
}
