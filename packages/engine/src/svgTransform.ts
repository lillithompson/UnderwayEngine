// An SVG `transform` attribute — its list of translate, scale, rotate and
// matrix — as the one affine matrix it stands for, read in ONE place: the
// SVG simplifier (simplifySVG) resolves a path's transform into its
// coordinates, and the figure bake (figureToPaths) maps a rect's and a
// circle's corners and centre through it. Each had a parser of its own, and
// they wrote a rotation about a point two ways — the same matrix, rounded
// differently, and a two-number rotate read two ways. Beside the engine's
// one path-data reader (svgPathData.ts) and its one arc conversion
// (svgArc.ts).
//
// Imports nothing, so a script can compile it from its TypeScript alone
// (scripts that read the simplifier that way serve it this module too).

/** 2D affine matrix [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type AffineMatrix = [number, number, number, number, number, number];

/** The matrix that applies `b` first and then `a`: the product a·b. */
export function multiplyMatrices(a: AffineMatrix, b: AffineMatrix): AffineMatrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/** A point under a matrix. */
export function applyMatrix(m: AffineMatrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/**
 * A transform list as one matrix, each function multiplied on in the order
 * written, so the last is the first applied to a point, as SVG has it:
 * `translate(tx [ty])`, ty 0 when left out; `scale(sx [sy])`, sy sx when
 * left out; `rotate(a [cx cy])`, in degrees, about (cx, cy) — the spec's
 * translate(cx, cy) rotate(a) translate(−cx, −cy), multiplied out — when
 * both are given and about the origin otherwise; `matrix(a b c d e f)`. Any
 * other function (skewX, skewY) is skipped. An empty list is the identity.
 */
export function parseTransform(str: string): AffineMatrix {
  let r: AffineMatrix = [1, 0, 0, 1, 0, 0];
  if (!str) return r;
  const re = /(\w+)\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) !== null) {
    const args = m[2].split(/[\s,]+/).map(Number);
    let t: AffineMatrix;
    switch (m[1]) {
      case 'translate':
        t = [1, 0, 0, 1, args[0] || 0, args.length > 1 ? args[1] : 0];
        break;
      case 'scale': {
        const sx = args[0] ?? 1, sy = args.length > 1 ? args[1] : sx;
        t = [sx, 0, 0, sy, 0, 0];
        break;
      }
      case 'rotate': {
        const rad = (args[0] || 0) * Math.PI / 180;
        const c = Math.cos(rad), s = Math.sin(rad);
        if (args.length >= 3) {
          const cx = args[1], cy = args[2];
          t = [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
        } else {
          t = [c, s, -s, c, 0, 0];
        }
        break;
      }
      case 'matrix':
        t = [args[0], args[1], args[2], args[3], args[4], args[5]];
        break;
      default: continue;
    }
    r = multiplyMatrices(r, t);
  }
  return r;
}
