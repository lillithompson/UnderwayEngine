/**
 * Decomposed 2D affine transform for the 90-degree rotation system.
 *
 * Application order: mirror flips first (about local origin), then
 * 90-degree rotation, then per-axis scale, then translate. This matches
 * the existing `applyGroupTransform` convention in compositionOps.ts.
 *
 * Immutable value type. All operations return new instances.
 */

// ── Types ──────────────────────────────────────────────────────────────

export interface Transform2D {
  readonly tx: number;
  readonly ty: number;
  readonly sx: number;
  readonly sy: number;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly mirrorH: boolean;
  readonly mirrorV: boolean;
}

export interface Bbox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type Orientation = {
  readonly rotation: 0 | 90 | 180 | 270;
  readonly mirrorH: boolean;
  readonly mirrorV: boolean;
};

export const IDENTITY: Transform2D = {
  tx: 0, ty: 0, sx: 1, sy: 1, rotation: 0, mirrorH: false, mirrorV: false,
};

// ── Forward transforms ─────────────────────────────────────────────────

/**
 * Apply a transform to an axis-aligned bounding box, returning the
 * world-space bbox. Mirror flips first, then 90-degree rotation, then
 * per-axis scale, then translate. Pure float math.
 */
export function applyToBbox(t: Transform2D, bbox: Bbox): Bbox {
  let x = bbox.x, y = bbox.y, w = bbox.width, h = bbox.height;
  if (t.mirrorH) x = -(x + w);
  if (t.mirrorV) y = -(y + h);
  if (t.rotation === 90) {
    const nx = -(y + h), ny = x, nw = h, nh = w;
    x = nx; y = ny; w = nw; h = nh;
  } else if (t.rotation === 180) {
    x = -(x + w); y = -(y + h);
  } else if (t.rotation === 270) {
    const nx = y, ny = -(x + w), nw = h, nh = w;
    x = nx; y = ny; w = nw; h = nh;
  }
  return {
    x: t.tx + x * t.sx,
    y: t.ty + y * t.sy,
    width:  w * t.sx,
    height: h * t.sy,
  };
}

/**
 * Apply a transform to a single 2D point. Same application order as
 * `applyToBbox`: mirror, rotate, scale, translate.
 */
export function applyToPoint(t: Transform2D, px: number, py: number): [number, number] {
  let x = px, y = py;
  if (t.mirrorH) x = -x;
  if (t.mirrorV) y = -y;
  if (t.rotation === 90) { const nx = -y, ny = x; x = nx; y = ny; }
  else if (t.rotation === 180) { x = -x; y = -y; }
  else if (t.rotation === 270) { const nx = y, ny = -x; x = nx; y = ny; }
  return [t.tx + x * t.sx, t.ty + y * t.sy];
}

// ── Inverse transforms ─────────────────────────────────────────────────

/**
 * Invert a transform on a bounding box. Undoes translate+scale, then
 * inverse rotation, then inverse mirror (mirror is self-inverse).
 */
export function invertBbox(t: Transform2D, world: Bbox): Bbox {
  let x = (world.x - t.tx) / t.sx;
  let y = (world.y - t.ty) / t.sy;
  let w = world.width / t.sx;
  let h = world.height / t.sy;
  if (t.rotation === 90) {
    const nx = y, ny = -(x + w), nw = h, nh = w;
    x = nx; y = ny; w = nw; h = nh;
  } else if (t.rotation === 180) {
    x = -(x + w); y = -(y + h);
  } else if (t.rotation === 270) {
    const nx = -(y + h), ny = x, nw = h, nh = w;
    x = nx; y = ny; w = nw; h = nh;
  }
  if (t.mirrorV) y = -(y + h);
  if (t.mirrorH) x = -(x + w);
  return { x, y, width: w, height: h };
}

/**
 * Invert a transform on a single 2D point.
 */
export function invertPoint(t: Transform2D, worldX: number, worldY: number): [number, number] {
  let x = (worldX - t.tx) / t.sx;
  let y = (worldY - t.ty) / t.sy;
  if (t.rotation === 90) { const nx = y, ny = -x; x = nx; y = ny; }
  else if (t.rotation === 180) { x = -x; y = -y; }
  else if (t.rotation === 270) { const nx = -y, ny = x; x = nx; y = ny; }
  if (t.mirrorV) y = -y;
  if (t.mirrorH) x = -x;
  return [x, y];
}

// ── Orientation math (D4 dihedral group) ───────────────────────────────

/**
 * Convert an orientation triple to a 2x2 matrix [a, b, c, d] representing
 * [[a, b], [c, d]]. Convention: mirror first, then rotate.
 * 90 CW in screen y-down: (x,y) -> (-y, x).
 */
export function orientationToMatrix(o: Orientation): [number, number, number, number] {
  const mh = o.mirrorH ? -1 : 1;
  const mv = o.mirrorV ? -1 : 1;
  const cos = o.rotation === 0 ? 1 : o.rotation === 180 ? -1 : 0;
  const sin = o.rotation === 90 ? 1 : o.rotation === 270 ? -1 : 0;
  return [cos * mh, -sin * mv, sin * mh, cos * mv];
}

/**
 * Decompose a 2x2 dihedral-group matrix back to an orientation triple.
 * Picks the most compact canonical form (fewer mirrors, smaller rotation).
 */
export function matrixToOrientation(m: readonly [number, number, number, number]): Orientation {
  for (const [mh, mv] of [[false, false], [true, false], [false, true], [true, true]] as const) {
    for (const r of [0, 90, 180, 270] as const) {
      const c = orientationToMatrix({ rotation: r, mirrorH: mh, mirrorV: mv });
      if (c[0] === m[0] && c[1] === m[1] && c[2] === m[2] && c[3] === m[3]) {
        return { rotation: r, mirrorH: mh, mirrorV: mv };
      }
    }
  }
  return { rotation: 0, mirrorH: false, mirrorV: false };
}

/**
 * Compose two orientations: world = outer . inner (apply inner first).
 */
export function composeOrientation(outer: Orientation, inner: Orientation): Orientation {
  const O = orientationToMatrix(outer);
  const I = orientationToMatrix(inner);
  const M: [number, number, number, number] = [
    O[0] * I[0] + O[1] * I[2], O[0] * I[1] + O[1] * I[3],
    O[2] * I[0] + O[3] * I[2], O[2] * I[1] + O[3] * I[3],
  ];
  return matrixToOrientation(M);
}

// ── Transform composition ──────────────────────────────────────────────

/**
 * Compose two transforms: result = outer . inner (apply inner first, then
 * outer). The result transform, when applied to a point, gives the same
 * answer as applying `inner` then `outer` in sequence.
 *
 * Derivation: outer(inner(p)) where each transform does
 * mirror -> rotate -> scale -> translate. We decompose by computing
 * what the composed transform does to an arbitrary bbox / point, then
 * reading off the decomposed parameters.
 *
 * For the D4 portion (mirror + rotation): we compose the 2x2 matrices
 * and decompose back to (rotation, mirrorH, mirrorV).
 *
 * For scale: the inner scale feeds through the outer's rotation (which
 * may swap axes) and outer scale multiplies.
 *
 * For translate: inner's translate is transformed by the outer, then
 * added to outer's translate.
 */
export function compose(outer: Transform2D, inner: Transform2D): Transform2D {
  // 1. Compose orientations (mirror + rotation)
  const outerOri: Orientation = { rotation: outer.rotation, mirrorH: outer.mirrorH, mirrorV: outer.mirrorV };
  const innerOri: Orientation = { rotation: inner.rotation, mirrorH: inner.mirrorH, mirrorV: inner.mirrorV };
  const composedOri = composeOrientation(outerOri, innerOri);

  // 2. Determine how inner's scale flows through outer's orientation+scale.
  // Inner's scale factors are (inner.sx, inner.sy). After outer's mirror
  // + rotation, the axes may swap. We trace a unit-width, unit-height box
  // through inner's scale, then through outer.
  //
  // A cleaner approach: apply the full compose to a known bbox and read
  // the result. Use bbox {x:0, y:0, width:1, height:1} through inner,
  // then through outer.
  const innerBox = applyToBbox(inner, { x: 0, y: 0, width: 1, height: 1 });
  const worldBox = applyToBbox(outer, innerBox);

  // The composed transform's tx, ty is the world position of the origin
  // point (0,0) after both transforms.
  const [composedTx, composedTy] = applyToPoint(outer, inner.tx, inner.ty);

  return {
    tx: composedTx,
    ty: composedTy,
    sx: worldBox.width,
    sy: worldBox.height,
    rotation: composedOri.rotation,
    mirrorH: composedOri.mirrorH,
    mirrorV: composedOri.mirrorV,
  };
}

/**
 * Compose a chain of transforms: chain[0] is applied first (innermost),
 * chain[last] is applied last (outermost). Returns the single equivalent
 * transform.
 */
export function composeChain(chain: readonly Transform2D[]): Transform2D {
  if (chain.length === 0) return IDENTITY;
  let result = chain[0];
  for (let i = 1; i < chain.length; i++) {
    result = compose(chain[i], result);
  }
  return result;
}

// ── Convenience constructors ───────────────────────────────────────────

/** Create a translate-only transform. */
export function translate(tx: number, ty: number): Transform2D {
  return { ...IDENTITY, tx, ty };
}

// ── Interop with legacy GroupNode fields ───────────────────────────────

/**
 * Convert legacy GroupNode fields to a Transform2D. Direct field mapping
 * since GroupNode uses the same decomposed representation.
 */
export function fromGroupNode(g: {
  translateX: number; translateY: number;
  scaleX: number; scaleY: number;
  rotation: 0 | 90 | 180 | 270;
  mirrorH: boolean; mirrorV: boolean;
}): Transform2D {
  return {
    tx: g.translateX, ty: g.translateY,
    sx: g.scaleX, sy: g.scaleY,
    rotation: g.rotation,
    mirrorH: g.mirrorH, mirrorV: g.mirrorV,
  };
}

/**
 * Convert legacy cell-based bbox fields to a Bbox.
 */
export function bboxFromCells(c: {
  cellX: number; cellY: number; cellWidth: number; cellHeight: number;
}): Bbox {
  return { x: c.cellX, y: c.cellY, width: c.cellWidth, height: c.cellHeight };
}

/**
 * Convert a Bbox to legacy cell-based fields.
 */
export function bboxToCells(b: Bbox): {
  cellX: number; cellY: number; cellWidth: number; cellHeight: number;
} {
  return { cellX: b.x, cellY: b.y, cellWidth: b.width, cellHeight: b.height };
}
