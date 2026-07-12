/** Touch geometry math for HSV color picker — zero dependencies */

/** Radii in UV space (center at 0.5, 0.5) */
export const RING_INNER = 0.33;
export const RING_OUTER = 0.48;
export const SV_RADIUS = 0.30;

export type DragZone = 'ring' | 'sv' | 'none';

/**
 * Convert a touch position to UV coordinates within the GL view.
 * @param touchX Touch x in view-local coordinates
 * @param touchY Touch y in view-local coordinates
 * @param viewSize Width/height of the square GL view
 * @returns [u, v] in [0, 1] range
 */
export function touchToUV(touchX: number, touchY: number, viewSize: number): [number, number] {
  return [touchX / viewSize, touchY / viewSize];
}

/**
 * Hit test a UV coordinate against the ring and SV circle.
 * @returns Which zone was hit
 */
export function hitTest(u: number, v: number): DragZone {
  const dx = u - 0.5;
  const dy = v - 0.5;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist >= RING_INNER && dist <= RING_OUTER) return 'ring';
  if (dist <= SV_RADIUS) return 'sv';
  return 'none';
}

/**
 * Convert UV position on the ring to a hue angle in [0, 360).
 */
export function uvToHue(u: number, v: number): number {
  const dx = u - 0.5;
  const dy = v - 0.5;
  let angle = Math.atan2(dy, dx) * (180 / Math.PI);
  if (angle < 0) angle += 360;
  return angle;
}

/**
 * Convert UV position in the SV circle to saturation and value, both in [0, 1].
 * The position is clamped to the circle boundary.
 */
export function uvToSV(u: number, v: number): [number, number] {
  let dx = u - 0.5;
  let dy = v - 0.5;

  // Clamp to circle
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > SV_RADIUS) {
    const scale = SV_RADIUS / dist;
    dx *= scale;
    dy *= scale;
  }

  // Elliptical grid mapping inverse (disc to square).
  // Smooth and algebraic — no diagonal artifacts.
  const nx = dx / SV_RADIUS;
  const ny = dy / SV_RADIUS;
  const nx2 = nx * nx;
  const ny2 = ny * ny;
  const r2 = nx2 + ny2;

  let su: number, sv: number;
  if (r2 < 1e-10) {
    su = 0;
    sv = 0;
  } else {
    const disc = (r2 - 2) * (r2 - 2) - 4 * nx2 * ny2;
    const sqrtDisc = Math.sqrt(Math.max(0, disc));
    const v2 = (2 - nx2 + ny2 - sqrtDisc) / 2;
    const u2 = v2 + nx2 - ny2;
    su = Math.sign(nx) * Math.sqrt(Math.max(0, u2));
    sv = Math.sign(ny) * Math.sqrt(Math.max(0, v2));
  }

  const sat = (su + 1) * 0.5;
  const val = 1 - (sv + 1) * 0.5;

  return [sat, val];
}

/**
 * Convert saturation/value back to UV coordinates within the SV circle.
 */
export function svToUV(sat: number, val: number): [number, number] {
  // Map [0, 1] to [-1, 1]
  const su = sat * 2 - 1;
  const sv = (1 - val) * 2 - 1;

  // Elliptical grid mapping (square to disc)
  const dx = su * Math.sqrt(1 - sv * sv / 2) * SV_RADIUS;
  const dy = sv * Math.sqrt(1 - su * su / 2) * SV_RADIUS;

  return [0.5 + dx, 0.5 + dy];
}

/**
 * Convert a hue angle to the UV position on the ring midline.
 */
export function hueToUV(hue: number): [number, number] {
  const midRadius = (RING_INNER + RING_OUTER) / 2;
  const rad = hue * (Math.PI / 180);
  return [0.5 + Math.cos(rad) * midRadius, 0.5 + Math.sin(rad) * midRadius];
}
