/**
 * Reading the POSE out of an exported SVG, rather than its spelling.
 *
 * The export used to place a node with a `translate(...) rotate(a cx cy)`
 * chain built from its legacy fields and now places it with one
 * `matrix(...)` off its world matrix (P5 of docs/transform-refactor.md).
 * Both draw the same quad, so a test that names either spelling is testing
 * the wrong thing: it goes red on a respelling and stays green if the
 * picture moves. These helpers evaluate whatever transform the markup
 * carries and answer where the content actually lands.
 */

import { Bbox, MAT_IDENTITY, Mat2D, matApplyPoint, matMul } from '../sceneTransform';
import { SVG_UNITS_PER_L0_CELL } from '../svgExport';

const DEG = Math.PI / 180;

function rotationMat(deg: number): Mat2D {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  return { a: c, b: s, c: -s, d: c, e: 0, f: 0 };
}

/** One SVG `transform` attribute value as a matrix. Understands the
 *  primitives this exporter emits: matrix, translate, rotate (with and
 *  without a centre) and scale. */
export function parseSvgTransform(attr: string): Mat2D {
  let m = MAT_IDENTITY;
  const fn = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  for (let hit = fn.exec(attr); hit; hit = fn.exec(attr)) {
    const n = hit[2].trim().split(/[\s,]+/).filter((s) => s !== '').map(Number);
    let step: Mat2D;
    switch (hit[1]) {
      case 'matrix':
        step = { a: n[0], b: n[1], c: n[2], d: n[3], e: n[4], f: n[5] };
        break;
      case 'translate':
        step = { ...MAT_IDENTITY, e: n[0], f: n[1] ?? 0 };
        break;
      case 'scale':
        step = { ...MAT_IDENTITY, a: n[0], d: n[1] ?? n[0] };
        break;
      case 'rotate': {
        const r = rotationMat(n[0]);
        step = n.length > 1
          ? matMul({ ...MAT_IDENTITY, e: n[1], f: n[2] },
            matMul(r, { ...MAT_IDENTITY, e: -n[1], f: -n[2] }))
          : r;
        break;
      }
      default:
        throw new Error(`unhandled SVG transform primitive: ${hit[1]}`);
    }
    m = matMul(m, step);
  }
  return m;
}

/** Every `transform="…"` in the document, in order, as matrices. */
export function transformsIn(svg: string): Mat2D[] {
  const out: Mat2D[] = [];
  const attr = /\stransform="([^"]*)"/g;
  for (let hit = attr.exec(svg); hit; hit = attr.exec(svg)) out.push(parseSvgTransform(hit[1]));
  return out;
}

/** The four corners, in SVG units, that a `<g>` wearing `m` puts a local
 *  content box of `widthCells` × `heightCells` at. The content is emitted
 *  at the origin, which is the one thing both spellings agree on. */
export function drawnQuad(m: Mat2D, widthCells: number, heightCells: number): [number, number][] {
  const w = widthCells * SVG_UNITS_PER_L0_CELL;
  const h = heightCells * SVG_UNITS_PER_L0_CELL;
  return ([[0, 0], [w, 0], [w, h], [0, h]] as [number, number][])
    .map(([x, y]) => matApplyPoint(m, x, y));
}

/**
 * Where a legacy pose says its content box's corners fall, in SVG units.
 *
 * The recipe the export composed by hand for every bbox kind: step to the
 * world box, turn about its centre (the discrete quarter and the free angle
 * together), step into the content box centred inside it, and flip within
 * that box. Written out here so a test has an answer computed from the pose
 * FIELDS, independent of the graph the export now reads.
 */
export function legacyQuad(
  pose: Bbox & {
    rotation?: 0 | 90 | 180 | 270;
    angleDeg?: number;
    mirrorH?: boolean;
    mirrorV?: boolean;
  },
): [number, number][] {
  const swap = pose.rotation === 90 || pose.rotation === 270;
  const cw = swap ? pose.height : pose.width;
  const ch = swap ? pose.width : pose.height;
  let m = matMul(
    { ...MAT_IDENTITY, e: pose.x, f: pose.y },
    matMul(
      matMul(
        { ...MAT_IDENTITY, e: pose.width / 2, f: pose.height / 2 },
        matMul(rotationMat((pose.rotation ?? 0) + (pose.angleDeg ?? 0)),
          { ...MAT_IDENTITY, e: -pose.width / 2, f: -pose.height / 2 }),
      ),
      { ...MAT_IDENTITY, e: (pose.width - cw) / 2, f: (pose.height - ch) / 2 },
    ),
  );
  if (pose.mirrorH) m = matMul(m, { ...MAT_IDENTITY, a: -1, e: cw });
  if (pose.mirrorV) m = matMul(m, { ...MAT_IDENTITY, d: -1, f: ch });
  return ([[0, 0], [cw, 0], [cw, ch], [0, ch]] as [number, number][])
    .map(([x, y]) => matApplyPoint(m, x, y))
    .map(([x, y]) => [x * SVG_UNITS_PER_L0_CELL, y * SVG_UNITS_PER_L0_CELL] as [number, number]);
}

/** The content box a legacy pose lays its content out in: the world box,
 *  with a quarter turn's axis swap undone. */
export function legacyContentBox(
  pose: Bbox & { rotation?: 0 | 90 | 180 | 270 },
): { width: number; height: number } {
  return pose.rotation === 90 || pose.rotation === 270
    ? { width: pose.height, height: pose.width }
    : { width: pose.width, height: pose.height };
}

/** Corner-wise comparison, to a tenth of an SVG unit (a 2,560th of a cell). */
export function expectQuadsClose(got: [number, number][], want: [number, number][]): void {
  expect(got).toHaveLength(want.length);
  got.forEach(([x, y], i) => {
    expect(x).toBeCloseTo(want[i][0], 1);
    expect(y).toBeCloseTo(want[i][1], 1);
  });
}
