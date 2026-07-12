import type { ElementRect } from './tutorialElementRegistry';

export interface RingGeometry {
  minRadius: number;
  maxRadius: number;
  cx: number;
  cy: number;
}

/** Cap for the inner ring radius. Elements larger than this get more rings
 *  at the same inner size rather than a scaled-up effect. */
const MIN_RADIUS_CAP = 36;

export function computeRingGeometry(
  rect: ElementRect,
  padding: number,
  radiusScale: number,
): RingGeometry {
  const halfMaxDim = Math.max(rect.width, rect.height) / 2;
  const rawMinRadius = halfMaxDim + padding;
  const minRadius = Math.min(rawMinRadius, MIN_RADIUS_CAP);
  const maxRadius = rawMinRadius * radiusScale;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return { minRadius, maxRadius, cx, cy };
}

/** Suggest a ring count based on the gap between inner and outer radius.
 *  Larger gaps get more rings so the spacing stays consistent. */
export function suggestRingCount(minRadius: number, maxRadius: number, defaultCount: number): number {
  const gap = maxRadius - minRadius;
  if (gap <= 60) return defaultCount;
  return Math.min(6, Math.max(defaultCount, Math.round(gap / 20)));
}

export function ringPhase(progress: number, index: number, ringCount: number): number {
  'worklet';
  const raw = progress + index / ringCount;
  return raw - Math.floor(raw);
}
