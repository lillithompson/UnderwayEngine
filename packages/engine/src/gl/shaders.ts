// The margin (outside the canvas bounds) is the GL clear color — flat black,
// matching the studio chrome around the canvas. There is no margin pass: the
// grid shader paints the canvas opaquely on top of the clear.

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
 * Layer fragment shader.
 * Samples layer texture with camera transform and alpha blending.
 * Uniforms:
 *   u_texture  - layer RGBA texture
 *   u_opacity  - layer opacity [0..1]
 *   u_offset   - camera offset in UV space
 *   u_zoom     - camera zoom
 *   u_aspect   - viewport aspect correction (viewportW/viewportH)
 */
export const LAYER_FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_texture;
uniform float u_opacity;
uniform vec2 u_offset;
uniform float u_zoom;
uniform float u_aspect;
uniform float u_highlightMode;
uniform float u_isHighlighted;
uniform vec2 u_boundsMin;
uniform vec2 u_boundsMax;

void main() {
  // Center UVs, apply zoom and offset, un-center
  vec2 uv = v_uv - 0.5;

  // Aspect correction: fit canvas to viewport width, center vertically
  uv.y /= u_aspect;

  uv = uv / u_zoom - u_offset;
  uv = uv + 0.5;

  // Discard fragments outside the layer texture [0,1]
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    discard;
  }

  // Clip to canvas window [boundsMin, boundsMax) in layer UV space
  if (uv.x < u_boundsMin.x || uv.y < u_boundsMin.y ||
      uv.x >= u_boundsMax.x || uv.y >= u_boundsMax.y) {
    discard;
  }

  vec4 color = texture2D(u_texture, uv);

  if (u_highlightMode > 0.5 && u_isHighlighted <= 0.5) {
    gl_FragColor = vec4(1.0, 1.0, 1.0, color.a * u_opacity * 0.4);
  } else {
    gl_FragColor = vec4(color.rgb, color.a * u_opacity);
  }
}
`;

/**
 * Grid overlay fragment shader.
 * Draws 1px grid lines as a screen-space overlay, independent of cell count.
 * Uniforms:
 *   u_cellCount  - number of cells per axis
 *   u_offset     - camera offset in UV space
 *   u_zoom       - camera zoom
 *   u_aspect     - viewport aspect correction
 *   u_resolution - viewport size in pixels (vec2)
 */
export const GRID_FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform float u_cellCount;
uniform vec2 u_offset;
uniform float u_zoom;
uniform float u_aspect;
uniform vec2 u_resolution;
uniform float u_shiftX;
uniform float u_shiftY;
uniform vec3 u_bgColor;
uniform float u_gridIntensity;
uniform vec2 u_boundsMin;
uniform vec2 u_boundsMax;

// Mirrors INFINITE_GRID_FRAG's intensity→(color, alpha) formula so the
// figure editor's grid reads the same as the composition editor's.
// Driven by the parent composition's gridIntensity (Grid Weight slider).

void main() {
  vec2 uv = v_uv - 0.5;

  // Aspect correction: fit canvas to viewport width, center vertically
  uv.y /= u_aspect;

  uv = uv / u_zoom - u_offset;
  uv = uv + 0.5;

  // Outside layer texture: transparent
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    discard;
  }

  // 1px line width in cell-space, computed from viewport resolution
  float canvasPx = u_resolution.x * u_zoom;
  float pxInCell = u_cellCount / canvasPx;

  // Grid lines (shifted by u_shiftX/u_shiftY in cell units). uv is in layer
  // UV (0..1 = 32 L0), so u_cellCount describes the full layer; the canvas
  // window discard below restricts visible gridlines to its sub-rect.
  vec2 cell = uv * u_cellCount - vec2(u_shiftX, u_shiftY);
  vec2 grid = abs(fract(cell - 0.5) - 0.5);
  vec2 lineAA = smoothstep(vec2(0.0), vec2(pxInCell * 1.5), grid);
  float line = 1.0 - min(lineAA.x, lineAA.y);

  // Canvas border — 1px in UV space, along the canvas window edges
  float pxInUv = 1.0 / canvasPx;
  float bxLeft  = smoothstep(u_boundsMin.x, u_boundsMin.x + pxInUv, uv.x);
  float bxRight = 1.0 - smoothstep(u_boundsMax.x - pxInUv, u_boundsMax.x, uv.x);
  float bx = bxLeft * bxRight;
  float byTop    = smoothstep(u_boundsMin.y, u_boundsMin.y + pxInUv, uv.y);
  float byBottom = 1.0 - smoothstep(u_boundsMax.y - pxInUv, u_boundsMax.y, uv.y);
  float by = byTop * byBottom;
  float border = 1.0 - bx * by;

  // gridIntensity maps directly to line opacity: the composition default of
  // 0.5 yields 50%-opaque grid lines.
  float lineAlpha = clamp(line * u_gridIntensity, 0.0, 1.0);
  float alpha = max(lineAlpha, border * 0.6);

  // Out-of-bounds: discard so margin color shows through
  if (uv.x < u_boundsMin.x || uv.y < u_boundsMin.y ||
      uv.x >= u_boundsMax.x || uv.y >= u_boundsMax.y) {
    discard;
  }

  // Radial gradient centered on the viewport: bright in the middle,
  // darkening toward the corners. Subtle depth cue.
  vec2 vp = v_uv - 0.5;
  vp.x *= u_aspect; // circular, not elliptical
  float r = length(vp);
  float d = pow(smoothstep(0.0, 0.75, r), 1.3);
  vec3 bg = u_bgColor * mix(1.08, 0.78, d);
  vec3 gridColor = vec3(0.2); // dark grey grid lines
  vec3 finalColor = mix(bg, gridColor, alpha);
  gl_FragColor = vec4(finalColor, 1.0);
}
`;

/**
 * Mirror axis overlay fragment shader.
 * Draws mirror-axis guide lines at u_mirrorCenter (plus quad/diagonal
 * axes), dashed when the axis passes through cell centers.
 * Uniforms:
 *   u_mirrorH    - 1.0 if horizontal mirror active
 *   u_mirrorV    - 1.0 if vertical mirror active
 *   u_quadLinesH - 1.0 to draw vertical quad boundary lines at 1/4, 3/4 X
 *   u_quadLinesV - 1.0 to draw horizontal quad boundary lines at 1/4, 3/4 Y
 *   u_offset    - camera offset in UV space
 *   u_zoom      - camera zoom
 *   u_aspect    - viewport aspect correction
 *   u_resolution - viewport size in pixels (vec2)
 */
export const MIRROR_FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform float u_mirrorH;
uniform float u_mirrorV;
uniform float u_quadLinesH;
uniform float u_quadLinesV;
uniform float u_diag1;
uniform float u_diag2;
uniform vec2 u_offset;
uniform float u_zoom;
uniform float u_aspect;
uniform vec2 u_resolution;
uniform vec2 u_mirrorCenter;
uniform vec2 u_boundsMin;
uniform vec2 u_boundsMax;
// Dash flags per line group: 1.0 = the axis lies through cell centers at
// the active layer (draw dashed), 0.0 = on a cell border (solid). The
// shader applies the dash mask along the axis's perpendicular direction
// so each cell along the line gets one dash centered on its mid-line.
uniform float u_dashH;
uniform float u_dashV;
uniform float u_dashQuadH;
uniform float u_dashQuadV;
// Diagonal lines always bisect cells diagonally — drawn dashed
// unconditionally when the diagonal is enabled.
uniform float u_dashPeriod;
// Within-half axis positions for mirrorQuad / mirrorRow / mirrorCol.
// Computed at the active layer's resolution via cell-window math so the
// lines land on cell borders or cell centers (matching the engine's
// actual axis). The prior shader used 25% / 75% of the canvas span,
// which drifts off the engine axis for partial canvases.
uniform float u_firstHalfU;
uniform float u_secondHalfU;
uniform float u_firstHalfV;
uniform float u_secondHalfV;
// Diagonal-axis center. Distinct from u_mirrorCenter so diagonals always
// pass through a cell's center (corner-to-corner bisection), even when
// the H/V axis lies on a cell border and u_mirrorCenter is at a 4-way
// cell corner.
uniform vec2 u_diagCenter;

void main() {
  vec2 uv = v_uv - 0.5;
  uv.y /= u_aspect;
  uv = uv / u_zoom - u_offset;
  uv = uv + 0.5;

  // Outside canvas window: transparent
  if (uv.x < u_boundsMin.x || uv.x > u_boundsMax.x ||
      uv.y < u_boundsMin.y || uv.y > u_boundsMax.y) {
    discard;
  }

  float canvasPx = u_resolution.x * u_zoom;
  float pxInUv = 1.0 / canvasPx;

  // 50% duty-cycle dash centered on each cell. Aligned to the canvas
  // window origin so dashes line up with cell boundaries regardless of
  // pan offset. Returns 1.0 in the dash, 0.0 in the gap.
  // coord is the position along the line; origin is the start of the
  // cell grid (canvas bounds min).
  // Falls back to solid (1.0) when u_dashPeriod is non-positive.

  float alpha = 0.0;

  // Vertical line at mirror center X (horizontal mirror axis)
  if (u_mirrorH > 0.5) {
    float dH = abs(uv.x - u_mirrorCenter.x);
    float lineAlpha = 1.0 - smoothstep(0.0, pxInUv * 3.0, dH);
    if (u_dashH > 0.5 && u_dashPeriod > 0.0) {
      float t = fract((uv.y - u_boundsMin.y) / u_dashPeriod);
      lineAlpha *= step(0.25, t) * step(t, 0.75);
    }
    alpha = max(alpha, lineAlpha);
  }

  // Horizontal line at mirror center Y (vertical mirror axis)
  if (u_mirrorV > 0.5) {
    float dV = abs(uv.y - u_mirrorCenter.y);
    float lineAlpha = 1.0 - smoothstep(0.0, pxInUv * 3.0, dV);
    if (u_dashV > 0.5 && u_dashPeriod > 0.0) {
      float t = fract((uv.x - u_boundsMin.x) / u_dashPeriod);
      lineAlpha *= step(0.25, t) * step(t, 0.75);
    }
    alpha = max(alpha, lineAlpha);
  }

  // Within-half quadrant axes — positions come from the active-layer
  // cell-window math (u_firstHalfU/u_secondHalfU/...), not 25%/75% of
  // canvas span.
  float qAlpha = 0.0;
  if (u_quadLinesH > 0.5) {
    float dQx1 = abs(uv.x - u_firstHalfU);
    float dQx2 = abs(uv.x - u_secondHalfU);
    float qLine = max(1.0 - smoothstep(0.0, pxInUv * 3.0, dQx1),
                      1.0 - smoothstep(0.0, pxInUv * 3.0, dQx2));
    if (u_dashQuadH > 0.5 && u_dashPeriod > 0.0) {
      float t = fract((uv.y - u_boundsMin.y) / u_dashPeriod);
      qLine *= step(0.25, t) * step(t, 0.75);
    }
    qAlpha = max(qAlpha, qLine);
  }
  if (u_quadLinesV > 0.5) {
    float dQy1 = abs(uv.y - u_firstHalfV);
    float dQy2 = abs(uv.y - u_secondHalfV);
    float qLine = max(1.0 - smoothstep(0.0, pxInUv * 3.0, dQy1),
                      1.0 - smoothstep(0.0, pxInUv * 3.0, dQy2));
    if (u_dashQuadV > 0.5 && u_dashPeriod > 0.0) {
      float t = fract((uv.x - u_boundsMin.x) / u_dashPeriod);
      qLine *= step(0.25, t) * step(t, 0.75);
    }
    qAlpha = max(qAlpha, qLine);
  }
  alpha = max(alpha, qAlpha * 0.5);

  // Diagonal guide lines — always dashed (the diagonal passes through
  // each cell's centre, so the dashed marks land one per cell along the
  // 45° direction). Dash period scaled by √2 because the diagonal step
  // per cell equals √2 × cellSize along the line direction.
  float diagDash = u_dashPeriod > 0.0 ? u_dashPeriod * sqrt(2.0) : 0.0;
  if (u_diag1 > 0.5) {
    // Main diagonal (\): slope-1 line through u_diagCenter — shifted off
    // u_mirrorCenter when the H/V axis is on a cell border so the line
    // passes through a cell's center rather than a 4-way corner.
    float dD1 = abs((uv.x - u_diagCenter.x) - (uv.y - u_diagCenter.y)) / sqrt(2.0);
    float lineAlpha = 1.0 - smoothstep(0.0, pxInUv * 3.0, dD1);
    if (diagDash > 0.0) {
      // Coordinate along the \ direction (uv.x + uv.y) / √2, anchored at bounds min.
      float along = ((uv.x - u_boundsMin.x) + (uv.y - u_boundsMin.y)) / sqrt(2.0);
      float t = fract(along / diagDash);
      lineAlpha *= step(0.25, t) * step(t, 0.75);
    }
    alpha = max(alpha, lineAlpha * 0.7);
  }
  if (u_diag2 > 0.5) {
    // Anti-diagonal (/): slope-(-1) line through u_diagCenter.
    float dD2 = abs((uv.x - u_diagCenter.x) + (uv.y - u_diagCenter.y)) / sqrt(2.0);
    float lineAlpha = 1.0 - smoothstep(0.0, pxInUv * 3.0, dD2);
    if (diagDash > 0.0) {
      // Coordinate along the / direction (uv.x - uv.y) / √2.
      float along = ((uv.x - u_boundsMin.x) - (uv.y - u_boundsMin.y)) / sqrt(2.0);
      float t = fract(along / diagDash);
      lineAlpha *= step(0.25, t) * step(t, 0.75);
    }
    alpha = max(alpha, lineAlpha * 0.7);
  }

  if (alpha < 0.01) discard;
  gl_FragColor = vec4(0.22, 0.741, 0.973, alpha * 0.7);
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

/**
 * Selection overlay fragment shader.
 * Draws a solid blue border around the selection and an optional dashed
 * preview border for the move destination.
 * Uniforms:
 *   u_selMinUV, u_selMaxUV   - selection bounds in UV space
 *   u_previewMinUV, u_previewMaxUV - move preview bounds in UV space
 *   u_hasMovePreview          - 1.0 if move preview is active
 *   u_offset, u_zoom, u_aspect, u_resolution - standard camera uniforms
 */
export const SELECTION_FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform vec2 u_selMinUV;
uniform vec2 u_selMaxUV;
uniform vec2 u_previewMinUV;
uniform vec2 u_previewMaxUV;
uniform float u_hasMovePreview;
uniform vec2 u_orientStartUV;
uniform vec2 u_orientEndUV;
uniform float u_hasOrientLine;
uniform vec2 u_offset;
uniform float u_zoom;
uniform float u_aspect;
uniform vec2 u_resolution;
uniform vec2 u_boundsMin;
uniform vec2 u_boundsMax;

float borderAlpha(vec2 uv, vec2 bMin, vec2 bMax, float pxInUv) {
  float lineW = pxInUv * 3.0;
  // Distance to each edge
  float dLeft   = abs(uv.x - bMin.x);
  float dRight  = abs(uv.x - bMax.x);
  float dTop    = abs(uv.y - bMin.y);
  float dBottom = abs(uv.y - bMax.y);

  float hw = lineW * 0.5;
  float hInside = step(bMin.y - hw, uv.y) * step(uv.y, bMax.y + hw);
  float vInside = step(bMin.x - hw, uv.x) * step(uv.x, bMax.x + hw);

  float a = 0.0;
  a = max(a, (1.0 - smoothstep(0.0, lineW, dLeft))   * hInside);
  a = max(a, (1.0 - smoothstep(0.0, lineW, dRight))  * hInside);
  a = max(a, (1.0 - smoothstep(0.0, lineW, dTop))    * vInside);
  a = max(a, (1.0 - smoothstep(0.0, lineW, dBottom)) * vInside);
  return a;
}

float distToSegment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
  return length(p - (a + t * ab));
}

void main() {
  vec2 uv = v_uv - 0.5;
  uv.y /= u_aspect;
  uv = uv / u_zoom - u_offset;
  uv = uv + 0.5;

  if (uv.x < u_boundsMin.x || uv.x > u_boundsMax.x ||
      uv.y < u_boundsMin.y || uv.y > u_boundsMax.y) {
    discard;
  }

  float canvasPx = u_resolution.x * u_zoom;
  float pxInUv = 1.0 / canvasPx;

  // Selection border color: cyan (#5ffaff)
  vec3 selColor = vec3(0.373, 0.98, 1.0);
  // Move preview color: light blue (#38BDF8)
  vec3 previewColor = vec3(0.22, 0.741, 0.973);

  vec3 color = selColor;
  float alpha = 0.0;

  // Solid selection border
  alpha = max(alpha, borderAlpha(uv, u_selMinUV, u_selMaxUV, pxInUv));

  // Dashed preview border
  if (u_hasMovePreview > 0.5) {
    float pa = borderAlpha(uv, u_previewMinUV, u_previewMaxUV, pxInUv);
    // Dash pattern based on position along edges
    float freq = canvasPx * 0.05;
    float dashX = step(0.5, fract(uv.x * freq));
    float dashY = step(0.5, fract(uv.y * freq));
    float dash = max(dashX, dashY);
    float previewAlpha = pa * dash;
    if (previewAlpha > alpha) {
      color = previewColor;
      alpha = previewAlpha;
    }
  }

  // Orientation line (cyan with arrowhead)
  if (u_hasOrientLine > 0.5) {
    float d = distToSegment(uv, u_orientStartUV, u_orientEndUV);
    float lineAlpha = 1.0 - smoothstep(0.0, pxInUv * 3.0, d);

    // Arrowhead at the end point
    vec2 dir = normalize(u_orientEndUV - u_orientStartUV);
    vec2 perp = vec2(-dir.y, dir.x);
    float arrowLen = pxInUv * 14.0;
    vec2 wing1 = u_orientEndUV - dir * arrowLen + perp * arrowLen * 0.5;
    vec2 wing2 = u_orientEndUV - dir * arrowLen - perp * arrowLen * 0.5;
    float dWing1 = distToSegment(uv, u_orientEndUV, wing1);
    float dWing2 = distToSegment(uv, u_orientEndUV, wing2);
    float arrowAlpha = 1.0 - smoothstep(0.0, pxInUv * 3.0, min(dWing1, dWing2));
    lineAlpha = max(lineAlpha, arrowAlpha);

    if (lineAlpha > alpha) {
      color = selColor;
      alpha = lineAlpha;
    }
  }

  if (alpha < 0.01) discard;
  gl_FragColor = vec4(color, alpha * 0.9);
}
`;

/**
 * Path selection overlay fragment shader.
 * Receives a 32x32 RGBA texture where R=255 means selected.
 * Draws semi-transparent cyan fill on selected cells and 4px border
 * on edges adjacent to unselected cells.
 * Uniforms:
 *   u_pathTex    - 32x32 mask texture (R channel = selection)
 *   u_l0Count    - L0 cell count (always 32)
 *   u_offset, u_zoom, u_aspect, u_resolution - standard camera uniforms
 */
export const PATH_SELECTION_FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_pathTex;
uniform float u_l0Count;
uniform vec2 u_offset;
uniform float u_zoom;
uniform float u_aspect;
uniform vec2 u_resolution;
uniform vec2 u_boundsMin;
uniform vec2 u_boundsMax;

void main() {
  vec2 uv = v_uv - 0.5;
  uv.y /= u_aspect;
  uv = uv / u_zoom - u_offset;
  uv = uv + 0.5;

  if (uv.x < u_boundsMin.x || uv.x > u_boundsMax.x ||
      uv.y < u_boundsMin.y || uv.y > u_boundsMax.y) {
    discard;
  }

  // Current cell in L0 grid
  vec2 cellF = uv * u_l0Count;
  vec2 cellIdx = floor(cellF);
  float texel = 1.0 / u_l0Count;

  // Sample center of this cell
  float sel = texture2D(u_pathTex, (cellIdx + 0.5) * texel).r;
  if (sel < 0.5) discard;

  // Check 4 cardinal neighbors for border
  float nL = texture2D(u_pathTex, (cellIdx + vec2(-0.5, 0.5)) * texel).r;
  float nR = texture2D(u_pathTex, (cellIdx + vec2(1.5, 0.5)) * texel).r;
  float nT = texture2D(u_pathTex, (cellIdx + vec2(0.5, -0.5)) * texel).r;
  float nB = texture2D(u_pathTex, (cellIdx + vec2(0.5, 1.5)) * texel).r;

  float canvasPx = u_resolution.x * u_zoom;
  float cellPx = canvasPx / u_l0Count;
  float borderW = 4.0 / cellPx; // 4px in cell-fraction space

  vec2 frac = fract(cellF);
  float border = 0.0;
  if (nL < 0.5) border = max(border, 1.0 - smoothstep(0.0, borderW, frac.x));
  if (nR < 0.5) border = max(border, 1.0 - smoothstep(0.0, borderW, 1.0 - frac.x));
  if (nT < 0.5) border = max(border, 1.0 - smoothstep(0.0, borderW, frac.y));
  if (nB < 0.5) border = max(border, 1.0 - smoothstep(0.0, borderW, 1.0 - frac.y));

  vec3 cyan = vec3(0.373, 0.98, 1.0);
  float fillAlpha = 0.15;
  float borderAlpha = border * 0.9;
  float alpha = max(fillAlpha, borderAlpha);

  if (alpha < 0.01) discard;
  gl_FragColor = vec4(cyan, alpha);
}
`;

/**
 * Clone tool overlay fragment shader.
 * Draws colored cell borders for source, sample, anchor, and cursor cells.
 * Uses its own cloneBorderAlpha() helper (a copy of SELECTION_FRAG's
 * borderAlpha with 2px width — GLSL programs share nothing).
 * Uniforms:
 *   u_cellCount         - number of cells per axis
 *   u_sourceUV          - UV center of source cell
 *   u_sampleUV          - UV center of sample cell
 *   u_anchorUV          - UV center of anchor cell
 *   u_cursorUV          - UV center of cursor cell
 *   u_sourceEnabled     - 1.0 if source overlay active
 *   u_sampleEnabled     - 1.0 if sample overlay active
 *   u_anchorEnabled     - 1.0 if anchor overlay active
 *   u_cursorEnabled     - 1.0 if cursor overlay active
 *   u_offset, u_zoom, u_aspect, u_resolution - standard camera uniforms
 */
export const CLONE_OVERLAY_FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform float u_cellCount;
uniform vec2 u_sourceUV;
uniform vec2 u_sampleUV;
uniform vec2 u_anchorUV;
uniform vec2 u_cursorUV;
uniform float u_sourceEnabled;
uniform float u_sampleEnabled;
uniform float u_anchorEnabled;
uniform float u_cursorEnabled;
uniform vec2 u_offset;
uniform float u_zoom;
uniform float u_aspect;
uniform vec2 u_resolution;
uniform vec2 u_boundsMin;
uniform vec2 u_boundsMax;

float cloneBorderAlpha(vec2 uv, vec2 bMin, vec2 bMax, float pxInUv) {
  float lineW = pxInUv * 2.0;
  float dLeft   = abs(uv.x - bMin.x);
  float dRight  = abs(uv.x - bMax.x);
  float dTop    = abs(uv.y - bMin.y);
  float dBottom = abs(uv.y - bMax.y);

  float hw = lineW * 0.5;
  float hInside = step(bMin.y - hw, uv.y) * step(uv.y, bMax.y + hw);
  float vInside = step(bMin.x - hw, uv.x) * step(uv.x, bMax.x + hw);

  float a = 0.0;
  a = max(a, (1.0 - smoothstep(0.0, lineW, dLeft))   * hInside);
  a = max(a, (1.0 - smoothstep(0.0, lineW, dRight))  * hInside);
  a = max(a, (1.0 - smoothstep(0.0, lineW, dTop))    * vInside);
  a = max(a, (1.0 - smoothstep(0.0, lineW, dBottom)) * vInside);
  return a;
}

void main() {
  vec2 uv = v_uv - 0.5;
  uv.y /= u_aspect;
  uv = uv / u_zoom - u_offset;
  uv = uv + 0.5;

  if (uv.x < u_boundsMin.x || uv.x > u_boundsMax.x ||
      uv.y < u_boundsMin.y || uv.y > u_boundsMax.y) {
    discard;
  }

  float canvasPx = u_resolution.x * u_zoom;
  float pxInUv = 1.0 / canvasPx;
  float cellSize = 1.0 / u_cellCount;

  vec3 color = vec3(0.0);
  float alpha = 0.0;

  // Source: solid cyan #38BDF8
  if (u_sourceEnabled > 0.5) {
    vec2 bMin = u_sourceUV;
    vec2 bMax = u_sourceUV + vec2(cellSize);
    float a = cloneBorderAlpha(uv, bMin, bMax, pxInUv);
    if (a > alpha) {
      color = vec3(0.22, 0.741, 0.973);
      alpha = a;
    }
  }

  // Sample: dim blue rgba(59,130,246,0.3)
  if (u_sampleEnabled > 0.5) {
    vec2 bMin = u_sampleUV;
    vec2 bMax = u_sampleUV + vec2(cellSize);
    float a = cloneBorderAlpha(uv, bMin, bMax, pxInUv) * 0.3;
    if (a > alpha) {
      color = vec3(0.231, 0.51, 0.965);
      alpha = a;
    }
  }

  // Anchor: solid red #ef4444
  if (u_anchorEnabled > 0.5) {
    vec2 bMin = u_anchorUV;
    vec2 bMax = u_anchorUV + vec2(cellSize);
    float a = cloneBorderAlpha(uv, bMin, bMax, pxInUv);
    if (a > alpha) {
      color = vec3(0.937, 0.267, 0.267);
      alpha = a;
    }
  }

  // Cursor: dim red rgba(239,68,68,0.3)
  if (u_cursorEnabled > 0.5) {
    vec2 bMin = u_cursorUV;
    vec2 bMax = u_cursorUV + vec2(cellSize);
    float a = cloneBorderAlpha(uv, bMin, bMax, pxInUv) * 0.3;
    if (a > alpha) {
      color = vec3(0.937, 0.267, 0.267);
      alpha = a;
    }
  }

  if (alpha < 0.01) discard;
  gl_FragColor = vec4(color, alpha);
}
`;
