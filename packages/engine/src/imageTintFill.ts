import type { ImageTintFill, Paint } from './types';

// Geometry for the gradient tint overlay (design 6a): converts the editable
// ImageTintFill (type / solid / stops / angle) to a Paint in unit-bbox space,
// which every renderer already understands (paintToCssBackground on the web
// canvas, paintToSvg at export). Keeping this one converter shared means the
// live preview and the exported artwork can't drift.

/**
 * Convert a gradient tint overlay to a {@link Paint} (unit-bbox 0..1 space).
 *
 * The linear angle follows the design: 0° points left→right and increases
 * clockwise, so 90° is top→bottom (the default). Radial centers on the frame
 * with the outer stop at the nearer edge (r = 0.5). The overlay's `opacity`
 * and `blend` are applied by the caller on the overlay element, not baked into
 * the Paint.
 */
export function tintFillToPaint(fill: ImageTintFill): Paint {
  if (fill.type === 'solid') {
    return { kind: 'solid', color: fill.solid };
  }
  // The editor keeps the stored `stops` in insertion order so a stop's index
  // (selectedStop) stays valid while it's dragged past its neighbours or a new
  // one is appended. A gradient must paint them in ascending position, though —
  // CSS/SVG clamp an out-of-order stop to its predecessor — so sort here (the
  // stop-bar preview sorts the same way; see rampGradient).
  const stops = [...fill.stops].sort((a, b) => a.offset - b.offset);
  if (fill.type === 'linear') {
    const a = (fill.angle * Math.PI) / 180;
    const cx = Math.cos(a);
    const cy = Math.sin(a);
    return {
      kind: 'linear',
      stops,
      x1: 0.5 - 0.5 * cx,
      y1: 0.5 - 0.5 * cy,
      x2: 0.5 + 0.5 * cx,
      y2: 0.5 + 0.5 * cy,
    };
  }
  return { kind: 'radial', stops, cx: 0.5, cy: 0.5, r: 0.5 };
}
