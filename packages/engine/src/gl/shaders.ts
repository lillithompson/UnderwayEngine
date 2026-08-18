// The GL shaders still in use: the shared fullscreen quad vertex shader
// (compositionRenderer + hsvPickerRenderer) and the composition canvas's
// infinite-grid fragment shader. The old tile editor's layer / selection /
// mirror / clone shaders went with its renderer.

/** Shared fullscreen quad vertex shader */
export const QUAD_VERT = `
attribute vec2 a_position;
attribute vec2 a_uv;
varying vec2 v_uv;

void main() {
  v_uv = a_uv;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

/**
 * Infinite grid fragment shader for composition canvas.
 * No UV bounds check — grid extends infinitely.
 *
 * Density-adaptive: when the active grid's line spacing drops below
 * MIN_LINE_SPACING_PX device pixels (a deeply subdivided grid viewed
 * zoomed-out), the fract-based lines pack tighter than a pixel and the
 * whole canvas would wash toward solid grid color. Instead the shader
 * walks up the power-of-2 hierarchy to the finest level that still
 * resolves, drawing that level at full strength and the next-finer level
 * cross-faded by how close it is to resolving — so zooming in reveals
 * finer gridlines continuously, with no popping and no wash.
 */
export const INFINITE_GRID_FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform float u_cellCount;
uniform vec2 u_offset;
uniform float u_zoom;
uniform float u_aspect;
uniform vec2 u_resolution;
uniform float u_gridIntensity;

float gridLine(vec2 uv, float cellCount, float canvasPx) {
  float pxInCell = cellCount / canvasPx;
  vec2 cell = uv * cellCount;
  vec2 grid = abs(fract(cell - 0.5) - 0.5);
  vec2 lineAA = smoothstep(vec2(0.0), vec2(pxInCell * 2.0), grid);
  return 1.0 - min(lineAA.x, lineAA.y);
}

void main() {
  vec2 uv = v_uv - 0.5;
  uv.y /= u_aspect;
  uv = uv / u_zoom - u_offset;
  uv = uv + 0.5;

  float canvasPx = u_resolution.x * u_zoom;

  // Continuous LOD: how many power-of-2 coarsenings until line spacing
  // reaches the threshold (0 when the active grid already resolves). The
  // integer part picks the finest drawable level; the fractional part
  // cross-fades it out as it compresses toward the next coarsening, while
  // its 2x-coarser parent (whose lines are a subset) draws at full
  // strength. At lodExact = 0 this degenerates to the plain single-grid
  // shader (fade = 1, fine level = the active grid).
  const float MIN_LINE_SPACING_PX = 8.0;
  float pxPerCell = canvasPx / u_cellCount;
  float lodExact = max(0.0, log2(MIN_LINE_SPACING_PX / pxPerCell));
  float lodFloor = floor(lodExact);
  float fade = 1.0 - (lodExact - lodFloor);
  float fineCount = u_cellCount / exp2(lodFloor);
  float line = max(gridLine(uv, fineCount * 0.5, canvasPx),
                   gridLine(uv, fineCount, canvasPx) * fade);

  // gridIntensity maps directly to line opacity: the composition default of
  // 0.5 yields 50%-opaque grid lines.
  float alpha = line * u_gridIntensity;
  if (alpha < 0.01) discard;
  vec3 color = vec3(0.2); // dark grey grid lines
  gl_FragColor = vec4(color, alpha);
}
`;
