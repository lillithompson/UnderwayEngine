/** GLSL fragment shader for HSV color picker — renders hue ring + SV circle */

export const HSV_PICKER_FRAG = `
precision mediump float;
varying vec2 v_uv;

uniform float u_hue;       // current hue in [0, 360)
uniform vec2 u_svPoint;    // selected SV position in UV space
uniform float u_hueAngle;  // selected hue angle in radians
uniform vec2 u_resolution; // viewport width, height
uniform float u_hueScale;  // hue indicator scale (1.0 = rest)
uniform float u_svScale;   // sv indicator scale (1.0 = rest)

const float RING_INNER = 0.33;
const float RING_OUTER = 0.48;
const float SV_RADIUS  = 0.30;
const float PI = 3.14159265;
const float TAU = 6.28318530;

// Elliptical grid mapping inverse: disc to square (smooth, no diagonal artifacts)
vec2 discToSquare(vec2 nd) {
  float nx2 = nd.x * nd.x;
  float ny2 = nd.y * nd.y;
  float r2 = nx2 + ny2;
  if (r2 < 1e-6) return vec2(0.0);
  float disc = (r2 - 2.0) * (r2 - 2.0) - 4.0 * nx2 * ny2;
  float sqrtDisc = sqrt(max(0.0, disc));
  float v2 = (2.0 - nx2 + ny2 - sqrtDisc) * 0.5;
  float u2 = v2 + nx2 - ny2;
  return vec2(
    sign(nd.x) * sqrt(max(0.0, u2)),
    sign(nd.y) * sqrt(max(0.0, v2))
  );
}

vec3 hsv2rgb(float h, float s, float v) {
  float c = v * s;
  float hh = h / 60.0;
  float x = c * (1.0 - abs(mod(hh, 2.0) - 1.0));
  float m = v - c;
  vec3 rgb;
  if      (hh < 1.0) rgb = vec3(c, x, 0.0);
  else if (hh < 2.0) rgb = vec3(x, c, 0.0);
  else if (hh < 3.0) rgb = vec3(0.0, c, x);
  else if (hh < 4.0) rgb = vec3(0.0, x, c);
  else if (hh < 5.0) rgb = vec3(x, 0.0, c);
  else               rgb = vec3(c, 0.0, x);
  return rgb + m;
}

void main() {
  vec2 center = vec2(0.5, 0.5);
  vec2 d = v_uv - center;

  // Correct for non-square viewports
  float aspect = u_resolution.x / u_resolution.y;
  d.x *= aspect;

  float dist = length(d);
  float angle = atan(d.y, d.x);
  if (angle < 0.0) angle += TAU;

  // Anti-aliasing pixel size
  float px = 1.0 / min(u_resolution.x, u_resolution.y);

  // Indicator radius for hue dot (used by both ring and SV sections)
  float indicatorR = (RING_OUTER - RING_INNER) / 2.0 - px;

  // --- Hue indicator (computed first, drawn last as overlay) ---
  float midR = (RING_INNER + RING_OUTER) / 2.0;
  vec2 huePos = center + vec2(cos(u_hueAngle), sin(u_hueAngle)) * midR;
  vec2 hd = v_uv - huePos;
  hd.x *= aspect;
  float hDist = length(hd);
  float hueR = indicatorR * u_hueScale;
  float hueDot1 = 1.0 - smoothstep(hueR - px * 2.0, hueR, hDist);
  float hueDot2 = 1.0 - smoothstep(hueR - px * 4.0, hueR - px * 2.0, hDist);

  // --- Grey background disc (fills inside ring outer edge) ---
  // Extend 2px past ring outer so ring overlaps it; SV circle overlaps inner edge
  float bgAlpha = 1.0 - smoothstep(RING_OUTER - px, RING_OUTER + px, dist);

  // --- Hue Ring ---
  float ringAlpha = smoothstep(RING_INNER - px, RING_INNER + px, dist)
                  * (1.0 - smoothstep(RING_OUTER - px, RING_OUTER + px, dist));

  // --- SV Circle ---
  float svAlpha = 1.0 - smoothstep(SV_RADIUS - px, SV_RADIUS + px, dist);

  // Nothing to draw — early out
  if (bgAlpha <= 0.0 && hueDot1 <= 0.0) discard;

  // Compute selected S/V from SV point (needed by both SV and hue indicators)
  vec2 selSq = discToSquare((u_svPoint - center) * vec2(aspect, 1.0) / SV_RADIUS);
  float selS = clamp((selSq.x + 1.0) * 0.5, 0.0, 1.0);
  float selV = clamp(1.0 - (selSq.y + 1.0) * 0.5, 0.0, 1.0);

  // Start with grey background
  vec3 color = vec3(0.165);
  float alpha = bgAlpha;

  // Composite hue ring on top
  if (ringAlpha > 0.0) {
    float hue = angle / TAU * 360.0;
    vec3 ringColor = hsv2rgb(hue, 1.0, 1.0);
    color = mix(color, ringColor, ringAlpha);
    alpha = max(alpha, ringAlpha);
  }

  // Composite SV circle on top
  if (svAlpha > 0.0) {
    vec2 sq = discToSquare(d / SV_RADIUS);
    float s = clamp((sq.x + 1.0) * 0.5, 0.0, 1.0);
    float v = clamp(1.0 - (sq.y + 1.0) * 0.5, 0.0, 1.0);
    vec3 svColor = hsv2rgb(u_hue, s, v);

    // SV selection indicator
    float svIndicatorR = indicatorR * 0.5 * u_svScale;
    vec2 svd = v_uv - u_svPoint;
    svd.x *= aspect;
    float svDist = length(svd);
    float dotOuter = 1.0 - smoothstep(svIndicatorR - px * 2.0, svIndicatorR, svDist);
    float dotInner = 1.0 - smoothstep(svIndicatorR - px * 4.0, svIndicatorR - px * 2.0, svDist);
    vec3 selectedColor = hsv2rgb(u_hue, selS, selV);
    svColor = mix(svColor, vec3(1.0), dotOuter);
    svColor = mix(svColor, selectedColor, dotInner);

    color = mix(color, svColor, svAlpha);
    alpha = max(alpha, svAlpha);
  }

  // Composite hue indicator on top of everything
  if (hueDot1 > 0.0) {
    vec3 hueColor = hsv2rgb(u_hue, selS, selV);
    color = mix(color, vec3(1.0), hueDot1);
    color = mix(color, hueColor, hueDot2);
    alpha = max(alpha, hueDot1);
  }

  gl_FragColor = vec4(color, alpha);
}
`;
