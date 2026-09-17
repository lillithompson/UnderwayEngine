/**
 * Transform math for the scene graph.
 *
 * A node holds a LOCAL transform — its pose relative to its parent — and
 * its world transform is the product of its ancestors'. Nothing stores
 * world coordinates. See docs/transform-refactor.md §3.2.
 *
 * This is the replacement for `transform2d.ts`, which models the legacy
 * system: quarter turns plus flips (the dihedral group D4), with every
 * leaf storing its world geometry and a parallel local cache. The two
 * coexist while readers migrate; the legacy module goes away with the
 * last of them. The conventions differ in two ways worth knowing:
 *
 * - rotation here is CONTINUOUS, subsuming both the legacy discrete
 *   quarter turn and the separate free `angleDeg` that rode on top of it;
 * - the application order here scales BEFORE rotating, where the legacy
 *   order scales after. For the quarter turns a `GroupNode` can hold, the
 *   two differ only by swapping `sx`/`sy` on a 90 or 270 — which is what
 *   `fromTransform2D` does.
 */

import type { Bbox, Transform2D } from './transform2d';

export type { Bbox };

// ── Affine matrix ──────────────────────────────────────────────────────

/**
 * A 2x3 affine matrix, in the order SVG and CSS `matrix()` take:
 *
 * ```
 *   | a  c  e |     x' = a*x + c*y + e
 *   | b  d  f |     y' = b*x + d*y + f
 *   | 0  0  1 |
 * ```
 *
 * Deliberately the convention the renderers already speak, so a world
 * matrix can go straight into `el.style.transform`, an SVG `transform=`
 * attribute or a GL uniform without a re-ordering step nobody remembers
 * to write.
 *
 * Unlike {@link LocalTransform} this can represent shear — which is what
 * a non-uniform parent scale over a rotated child actually produces.
 */
export interface Mat2D {
  readonly a: number; readonly b: number;
  readonly c: number; readonly d: number;
  readonly e: number; readonly f: number;
}

export const MAT_IDENTITY: Mat2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/**
 * Fold -0 into 0.
 *
 * Negative zero is arithmetically invisible and visible everywhere else:
 * it fails a deep-equality assertion, changes a JSON snapshot, and
 * survives into a persisted file. Composition produces it constantly —
 * any product with a zero and a negative — so it is folded at the two
 * places matrices are built rather than at the places they are compared.
 */
function z(n: number): number {
  return n || 0;
}

/** `outer` applied after `inner` — the matrix product `outer * inner`. */
export function matMul(outer: Mat2D, inner: Mat2D): Mat2D {
  return {
    a: z(outer.a * inner.a + outer.c * inner.b),
    b: z(outer.b * inner.a + outer.d * inner.b),
    c: z(outer.a * inner.c + outer.c * inner.d),
    d: z(outer.b * inner.c + outer.d * inner.d),
    e: z(outer.a * inner.e + outer.c * inner.f + outer.e),
    f: z(outer.b * inner.e + outer.d * inner.f + outer.f),
  };
}

/** Determinant. Negative means the matrix flips handedness. */
export function matDet(m: Mat2D): number {
  return m.a * m.d - m.b * m.c;
}

/**
 * Exact inverse. Throws on a singular matrix rather than returning a
 * quietly wrong one: a zero scale reaching here means a node was
 * collapsed somewhere upstream, and silently mapping every point to the
 * origin would hide that until a hit test started missing.
 */
export function matInvert(m: Mat2D): Mat2D {
  const det = matDet(m);
  if (det === 0 || !Number.isFinite(det)) {
    throw new Error(`matInvert: singular matrix (det=${det})`);
  }
  const ia = m.d / det, ib = -m.b / det, ic = -m.c / det, id = m.a / det;
  return {
    a: z(ia), b: z(ib), c: z(ic), d: z(id),
    e: z(-(ia * m.e + ic * m.f)),
    f: z(-(ib * m.e + id * m.f)),
  };
}

/** Map a point through the matrix. */
export function matApplyPoint(m: Mat2D, x: number, y: number): [number, number] {
  return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
}

/**
 * Map a *delta* through the matrix — the linear part only, translation
 * dropped. A drag distance converted into a parent's space goes through
 * this; a position goes through {@link matApplyPoint}.
 */
export function matApplyDelta(m: Mat2D, dx: number, dy: number): [number, number] {
  return [m.a * dx + m.c * dy, m.b * dx + m.d * dy];
}

/** A pure translation. */
export function matTranslate(dx: number, dy: number): Mat2D {
  return { ...MAT_IDENTITY, e: dx, f: dy };
}

/**
 * `linear` re-centred so that `pivot` is its fixed point: the matrix that
 * scales, turns or flips everything about that one point.
 *
 * Every pivoted gesture is this — a corner resize about the opposite
 * corner, a twist about the selection centre, a flip about a frame's
 * middle — expressed in whichever space `pivot` and `linear` are given in.
 * The translation part of `linear` is ignored: a gesture about a point has
 * no translation of its own.
 */
export function matAbout(pivot: readonly [number, number], linear: Mat2D): Mat2D {
  const [px, py] = pivot;
  return {
    a: linear.a, b: linear.b, c: linear.c, d: linear.d,
    e: z(px - (linear.a * px + linear.c * py)),
    f: z(py - (linear.b * px + linear.d * py)),
  };
}

/** The four corners of a rectangle mapped through the matrix, in the
 *  order top-left, top-right, bottom-right, bottom-left. */
export function matApplyCorners(m: Mat2D, b: Bbox): [number, number][] {
  const x0 = b.x, y0 = b.y, x1 = b.x + b.width, y1 = b.y + b.height;
  return [
    matApplyPoint(m, x0, y0), matApplyPoint(m, x1, y0),
    matApplyPoint(m, x1, y1), matApplyPoint(m, x0, y1),
  ];
}

/**
 * The axis-aligned bounding box of a rectangle's image under the matrix.
 *
 * A rotated or sheared rectangle is not a rectangle, so this is the AABB
 * of its four mapped corners: right for culling, camera fitting and
 * marquee tests, wrong for anything that needs the actual quad. Use
 * {@link matApplyCorners} when the shape matters.
 */
export function matApplyBbox(m: Mat2D, b: Bbox): Bbox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of matApplyCorners(m, b)) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * True when the matrix is a similarity: one uniform scale, a rotation,
 * optionally a flip — no shear, no differing axis scales.
 *
 * Figures are pixel sprites drawn through a tile atlas and can render
 * neither shear nor an unequal axis scale, so the figure path asserts
 * this and falls back to the nearest similarity (plan Q2). Every other
 * kind renders the general affine.
 */
export function matIsSimilarity(m: Mat2D, eps = 1e-6): boolean {
  // The two columns must be equal in length and perpendicular.
  const col0 = m.a * m.a + m.b * m.b;
  const col1 = m.c * m.c + m.d * m.d;
  if (Math.abs(col0 - col1) > eps * Math.max(1, col0, col1)) return false;
  const dot = m.a * m.c + m.b * m.d;
  return Math.abs(dot) <= eps * Math.max(1, Math.sqrt(col0 * col1));
}

/**
 * How much shear a matrix carries: the cosine of the angle between its
 * axes, so 0 for a clean transform and approaching +-1 as it collapses.
 * {@link decomposeMatrix} is exact exactly when this is 0.
 */
export function matShear(m: Mat2D): number {
  const l0 = Math.hypot(m.a, m.b), l1 = Math.hypot(m.c, m.d);
  if (l0 === 0 || l1 === 0) return 0;
  return (m.a * m.c + m.b * m.d) / (l0 * l1);
}

/** Entry-wise equality, exact. */
export function matEquals(a: Mat2D, b: Mat2D): boolean {
  return a.a === b.a && a.b === b.b && a.c === b.c
    && a.d === b.d && a.e === b.e && a.f === b.f;
}

/**
 * The one uniform scale factor nearest a matrix's linear part: the
 * square root of its area factor. Exact for a similarity; for a matrix
 * pulled off-square it is the geometric mean of the two axis factors —
 * the factor to take out of a length that must stay a WORLD quantity (a
 * stroke width) when the geometry it dresses is drawn through the matrix.
 */
export function matUniformScale(m: Mat2D): number {
  return Math.sqrt(Math.abs(matDet(m)));
}

// ── LocalTransform ─────────────────────────────────────────────────────

/**
 * A node's pose relative to its parent.
 *
 * Application order is **mirror, then scale, then rotate, then
 * translate** — `M = T . R . S . F`. Written down here once so no reader
 * has to re-derive it: the flips and the scale act in the node's own
 * (unrotated) axes, the rotation and translation in the parent's.
 *
 * `rotationDeg` is continuous and clockwise on screen (y grows downward).
 * It replaces the legacy pair of a discrete quarter turn and a separate
 * free angle layered on at draw time. The mirror flags are kept because
 * naming a flip reads better than a negative scale; the math treats them
 * as a scale of -1 and nothing depends on which spelling is stored.
 */
export interface LocalTransform {
  readonly tx: number;
  readonly ty: number;
  readonly sx: number;
  readonly sy: number;
  readonly rotationDeg: number;
  readonly mirrorH?: boolean;
  readonly mirrorV?: boolean;
}

export const LOCAL_IDENTITY: LocalTransform = {
  tx: 0, ty: 0, sx: 1, sy: 1, rotationDeg: 0,
};

const DEG = Math.PI / 180;

/**
 * Snap values within 1e-12 of an integer, so `cos(90 deg)` is 0 rather
 * than 6.1e-17. The difference is invisible on screen and very visible
 * in a persisted file, an equality test and a snapshot diff.
 */
function clean(n: number): number {
  const r = Math.round(n);
  // `|| 0` folds -0 into 0. Negative zero is invisible arithmetically and
  // very visible in a JSON snapshot, a persisted file and a deep-equality
  // assertion, and it appears the moment a quarter turn negates sin(0).
  return (Math.abs(n - r) < 1e-12 ? r : n) || 0;
}

/** Fold an angle into [0, 360). */
export function normalizeDeg(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

/** The node's local-to-parent matrix: `T . R . S . F`. */
export function localMatrix(t: LocalTransform): Mat2D {
  const sx = t.mirrorH ? -t.sx : t.sx;
  const sy = t.mirrorV ? -t.sy : t.sy;
  const rad = t.rotationDeg * DEG;
  const cos = clean(Math.cos(rad)), sin = clean(Math.sin(rad));
  return {
    a: clean(cos * sx), b: clean(sin * sx),
    c: clean(-sin * sy), d: clean(cos * sy),
    e: t.tx, f: t.ty,
  };
}

/** Shorthand for a translate-only local transform. */
export function localTranslate(tx: number, ty: number): LocalTransform {
  return { ...LOCAL_IDENTITY, tx, ty };
}

/** True when two transforms describe the same pose, to within `eps`. */
export function localEquals(a: LocalTransform, b: LocalTransform, eps = 1e-9): boolean {
  const close = (x: number, y: number) => Math.abs(x - y) <= eps;
  const ma = localMatrix(a), mb = localMatrix(b);
  return close(ma.a, mb.a) && close(ma.b, mb.b) && close(ma.c, mb.c)
    && close(ma.d, mb.d) && close(ma.e, mb.e) && close(ma.f, mb.f);
}

/**
 * The nearest `LocalTransform` to a matrix, by Gram-Schmidt (QR)
 * decomposition.
 *
 * Exact whenever the matrix carries no shear, which covers every pose the
 * editor authors directly. A sheared matrix — what a non-uniform parent
 * scale over a rotated child produces — has no TRS form at all, and this
 * returns the closest one: the rotation of its first axis, and the scales
 * that reproduce the signed area. A caller that must not lose the shear
 * carries the matrix instead.
 *
 * A flip comes back as a negative `sy` rather than a `mirrorV` flag, so
 * the result is canonical.
 */
export function decomposeMatrix(m: Mat2D): LocalTransform {
  const sx = Math.hypot(m.a, m.b);
  const det = matDet(m);
  return {
    tx: m.e, ty: m.f,
    sx: clean(sx),
    // Signed, so a handedness flip lands in sy rather than being lost.
    sy: clean(sx === 0 ? Math.hypot(m.c, m.d) : det / sx),
    rotationDeg: sx === 0 ? 0 : clean(normalizeDeg(clean(Math.atan2(m.b, m.a) / DEG))),
  };
}

/**
 * The same pose, spelled with the given mirror flags where that is
 * possible.
 *
 * `decomposeMatrix` is canonical — every flip lands in a negative `sy` —
 * and the matrix is unchanged by any respelling, so this is purely about
 * what a reader sees: a node the user flipped horizontally should keep
 * reading as flipped horizontally instead of drifting into "upside down
 * and turned half round" after a gesture, which is the same picture. The
 * respelling uses the one identity there is: negating both axes is a half
 * turn, so `R(θ)·S(sx, sy) = R(θ+180)·S(−sx, −sy)`. When the requested
 * flags name the other handedness, no spelling fits and the canonical
 * form comes back unchanged.
 */
export function respellMirror(
  t: LocalTransform, flags: { mirrorH?: boolean; mirrorV?: boolean },
): LocalTransform {
  const h = !!flags.mirrorH, v = !!flags.mirrorV;
  // Signs the requested spelling would put on each axis...
  const wantX = h ? -1 : 1, wantY = v ? -1 : 1;
  // ...and the signs the canonical form carries (sx is never negative).
  const haveX = t.sx < 0 ? -1 : 1, haveY = t.sy < 0 ? -1 : 1;
  const base = { ...t, sx: Math.abs(t.sx), sy: Math.abs(t.sy) };
  delete (base as { mirrorH?: boolean }).mirrorH;
  delete (base as { mirrorV?: boolean }).mirrorV;
  const flagged = {
    ...base,
    ...(h ? { mirrorH: true } : {}),
    ...(v ? { mirrorV: true } : {}),
  };
  if (wantX === haveX && wantY === haveY) return flagged;
  if (wantX === -haveX && wantY === -haveY) {
    return { ...flagged, rotationDeg: normalizeDeg(t.rotationDeg + 180) };
  }
  return t;
}

/**
 * `outer` composed with `inner`: the pose `inner` describes, read in
 * `outer`'s parent's space.
 *
 * Returns a `LocalTransform`, so a composition that shears (a non-uniform
 * `outer` scale over a rotated `inner`) is approximated. A chain that
 * must stay exact multiplies matrices and decomposes once at the end,
 * which is what the world-transform cache does.
 */
export function composeLocal(outer: LocalTransform, inner: LocalTransform): LocalTransform {
  return decomposeMatrix(matMul(localMatrix(outer), localMatrix(inner)));
}

/**
 * Re-pose a node so that `pivot` — a point in the node's PARENT space —
 * stays put while `delta` is applied around it.
 *
 * Every pivoted gesture is expressed through this: a corner resize pivots
 * on the opposite corner, a twist on the selection centre, a
 * quarter-turn-in-place on the node's own centre. The pivot itself is
 * never stored, only the `tx`/`ty` it implies — which is why the legacy
 * frame path had to run a "probe materialize" to discover the translate
 * that kept a rotation in place, and why nothing here does.
 */
export function transformAboutPivot(
  t: LocalTransform,
  pivot: readonly [number, number],
  delta: { rotateDeg?: number; scaleX?: number; scaleY?: number },
): LocalTransform {
  const rad = (delta.rotateDeg ?? 0) * DEG;
  const scaleX = delta.scaleX ?? 1;
  const scaleY = delta.scaleY ?? 1;
  const cos = clean(Math.cos(rad)), sin = clean(Math.sin(rad));
  // The gesture as a linear map in parent space, re-centred so `pivot` is
  // its fixed point.
  const about = matAbout(pivot, {
    a: cos * scaleX, b: sin * scaleX,
    c: -sin * scaleY, d: cos * scaleY,
    e: 0, f: 0,
  });
  return respellMirror(
    decomposeMatrix(matMul(about, localMatrix(t))),
    { mirrorH: t.mirrorH, mirrorV: t.mirrorV },
  );
}

/**
 * Convert a legacy quarter-turn transform.
 *
 * The legacy order scales *after* rotating, so on a 90 or 270 — where the
 * rotation swaps the axes — the scales swap to match.
 */
export function fromTransform2D(t: Transform2D): LocalTransform {
  const swap = t.rotation === 90 || t.rotation === 270;
  return {
    tx: t.tx, ty: t.ty,
    sx: swap ? t.sy : t.sx,
    sy: swap ? t.sx : t.sy,
    rotationDeg: t.rotation,
    ...(t.mirrorH ? { mirrorH: true } : {}),
    ...(t.mirrorV ? { mirrorV: true } : {}),
  };
}
