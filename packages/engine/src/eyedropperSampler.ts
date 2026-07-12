import { CompositionState, RGBColor } from './types';
import { findSceneObjectAtCell } from './compositionOps';

export interface EyedropperHit {
  color: RGBColor | null;
  /** True when an object was hit but has no single color (e.g. an
   *  uncolored figure or an image). The caller should fall through to
   *  GL readPixels only for tiled/repeating objects; for non-tiled objects
   *  rendered in the SVG layer, GL won't have their pixels. */
  hitNonColoredObject: boolean;
  /** True when the hit object is tiled (rendered in GL, not SVG layer). */
  hitTiled: boolean;
}

/**
 * Algorithmic color sampling: hit-test the scene graph at the given cell
 * coordinates and return the object's color if one is found.
 *
 * Uses the same `findSceneObjectAtCell` as the canvas tap detection, so
 * the hit geometry is identical.
 */
export function sampleColorFromScene(
  state: CompositionState,
  cellX: number,
  cellY: number,
): EyedropperHit {
  const hit = findSceneObjectAtCell(state, cellX, cellY, { ignoreLock: true });
  if (!hit) return { color: null, hitNonColoredObject: false, hitTiled: false };

  if (hit.kind === 'svg') {
    const obj = state.svgObjects.find(s => s.id === hit.id);
    if (!obj) return { color: null, hitNonColoredObject: false, hitTiled: false };
    return {
      color: obj.color,
      hitNonColoredObject: false,
      hitTiled: obj.tileMode === 'repeat',
    };
  }

  if (hit.kind === 'figure') {
    const fig = state.figures.find(f => f.id === hit.id);
    if (!fig) return { color: null, hitNonColoredObject: false, hitTiled: false };
    if (fig.colorOverride) {
      return {
        color: fig.colorOverride,
        hitNonColoredObject: false,
        hitTiled: fig.tileMode === 'repeat',
      };
    }
    // Figure has no colorOverride — it renders with natural tile colors.
    // For tiled figures the GL buffer has the rendered pixel; for non-tiled
    // figures the SVG layer renders them so GL won't help.
    return {
      color: null,
      hitNonColoredObject: true,
      hitTiled: fig.tileMode === 'repeat',
    };
  }

  // Images: no single color.
  return { color: null, hitNonColoredObject: true, hitTiled: false };
}

/** Pre-allocated pixel buffer to avoid per-frame allocation. */
const _pixel = new Uint8Array(4);

/**
 * Read a single pixel from the current GL framebuffer.
 * Must be called after gl.flush() but before endFrameEXP() — the
 * CompositionRenderer.render() `onPostRender` callback provides this window.
 *
 * Coordinates are in canvas-local screen space (top-left origin).
 */
export function sampleColorFromGL(
  gl: WebGLRenderingContext,
  localX: number,
  localY: number,
  viewportHeight: number,
): RGBColor {
  const canvas = gl.canvas as HTMLCanvasElement;
  const dprX = gl.drawingBufferWidth / (canvas.clientWidth || canvas.width || 1);
  const dprY = gl.drawingBufferHeight / (canvas.clientHeight || canvas.height || 1);
  const glX = Math.floor(localX * dprX);
  const glY = Math.floor((viewportHeight - localY - 1) * dprY);

  gl.readPixels(glX, glY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, _pixel);

  // Detect all-zero (context lost or out-of-bounds) and return grid bg color.
  if (_pixel[0] === 0 && _pixel[1] === 0 && _pixel[2] === 0 && _pixel[3] === 0) {
    return { r: 5, g: 4, b: 8 };
  }

  return { r: _pixel[0], g: _pixel[1], b: _pixel[2] };
}
