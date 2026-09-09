/**
 * Tests for the v58 stored, content-chosen coordinate scale.
 *
 * v45 derived the i16 fixed-point scale from gridLevel, which protected
 * geometry drawn ON a fine grid but still rounded FREEHAND geometry — touch
 * samples sit on no grid at all — to quarter cells whenever the page's
 * gridLevel was ≥ −1. CozyJournal's Facets pages save at gridLevel 1 with
 * normalize:false, so a drawing synced to another device or exported as a
 * .tile came back as staircases (docs/references in the CozyJournal repo).
 * v58 measures every coordinate the writer encodes, picks the coarsest
 * power of two that represents them all exactly — floored at the v45
 * derived scale, capped by the i16 range — and stores the exponent in one
 * new metadata byte the reader consumes at v58+.
 */

import {
  serializeComposition,
  deserializeComposition,
  CompositionBundle,
} from '../compositionBinaryFormat';
import { PathSegment, SVGObject } from '../types';
import { patchFormatVersion } from './test-utils';

const COORD_SCALE_BYTE_AT = 8 + 43;

function line(start: [number, number], end: [number, number]): PathSegment {
  return { kind: 'line', start, end };
}

function makeSVG(id: string, segments: PathSegment[], extras: Partial<SVGObject> = {}): SVGObject {
  const xs = segments.flatMap((s) => [s.start[0], s.end[0]]);
  const ys = segments.flatMap((s) => [s.start[1], s.end[1]]);
  return {
    id,
    segments,
    color: { r: 121, g: 151, b: 177 },
    cellX: Math.min(...xs),
    cellY: Math.min(...ys),
    cellWidth: Math.max(...xs) - Math.min(...xs),
    cellHeight: Math.max(...ys) - Math.min(...ys),
    ...extras,
  };
}

function makeBundle(gridLevel: number, svgObjects: SVGObject[]): CompositionBundle {
  return {
    name: 'Test', gridLevel, strokeScale: 1, gridIntensity: 0.75,
    camera: { offsetX: 0, offsetY: 0, zoom: 0.92 },
    figures: [],
    svgObjects,
    sceneOrder: svgObjects.map((s) => s.id),
  };
}

/** A freehand-looking polyline: samples nowhere near any dyadic grid. */
function freehand(n: number, ox = 10, oy = 12): PathSegment[] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = i / 7.3;
    pts.push([ox + 3.1 * Math.cos(t) + 0.137 * i, oy + 2.7 * Math.sin(1.3 * t)]);
  }
  const segs: PathSegment[] = [];
  for (let i = 0; i + 1 < pts.length; i++) segs.push(line(pts[i], pts[i + 1]));
  return segs;
}

function maxError(a: PathSegment[], b: PathSegment[]): number {
  let worst = 0;
  a.forEach((s, i) => {
    const t = b[i];
    for (const [p, q] of [[s.start, t.start], [s.end, t.end]] as const) {
      worst = Math.max(worst, Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]));
    }
  });
  return worst;
}

describe('v58 stored coordinate scale', () => {
  test('a freehand stroke on a coarse-grid page comes back within 1/512 of a cell, not on quarter cells', () => {
    const segs = freehand(40);
    const bytes = serializeComposition(makeBundle(1, [makeSVG('stroke', segs)]), []);
    const { meta } = deserializeComposition(bytes);
    const out = meta.svgObjects![0].segments;
    expect(out).toHaveLength(segs.length);
    // Content reaching ~18.5 cells fits the i16 range at ×1024 (a full
    // 32-cell page would settle at ×512); nothing coarser is ever chosen
    // for samples off every grid.
    expect(bytes[COORD_SCALE_BYTE_AT]).toBe(10);
    expect(maxError(segs, out)).toBeLessThanOrEqual(1 / 1024);
    // …whereas the v45 rule (×4 at gridLevel 1) would have been off by up
    // to an eighth of a cell — the staircase.
    const quarterCellError = maxError(segs, segs.map((s) => line(
      [Math.round(s.start[0] * 4) / 4, Math.round(s.start[1] * 4) / 4],
      [Math.round(s.end[0] * 4) / 4, Math.round(s.end[1] * 4) / 4],
    )));
    expect(quarterCellError).toBeGreaterThan(1 / 32);
  });

  test('the bbox and creation box ride the same scale as the segments', () => {
    const segs = freehand(12);
    const svg = makeSVG('boxed', segs, {
      creationBox: { minX: 10.123, minY: 11.987, width: 3.333, height: 2.222 },
    });
    const { meta } = deserializeComposition(serializeComposition(makeBundle(1, [svg]), []));
    const out = meta.svgObjects![0];
    expect(out.cellX).toBeCloseTo(svg.cellX, 2);
    expect(out.cellWidth).toBeCloseTo(svg.cellWidth, 2);
    expect(out.creationBox!.minX).toBeCloseTo(10.123, 2);
    expect(out.creationBox!.width).toBeCloseTo(3.333, 2);
  });

  test('grid-snapped content keeps the gridLevel-derived scale, so its bytes are what v57 wrote', () => {
    // Whole and quarter cells need nothing finer than ×4, and the floor
    // never drops below the v45 derivation — the file is byte-identical to
    // v57 apart from the version and the one new metadata byte.
    const segs = [line([0.25, 0.5], [4.75, 0.5]), line([4.75, 0.5], [4.75, 3])];
    const bytes = serializeComposition(makeBundle(1, [makeSVG('s', segs)]), []);
    expect(bytes[COORD_SCALE_BYTE_AT]).toBe(2);
    expect(deserializeComposition(bytes).meta.svgObjects![0].segments).toEqual(segs);
    // A fine grid still gets its v45 floor even when the content is coarse.
    const fine = serializeComposition(makeBundle(-5, [makeSVG('s', segs)]), []);
    expect(fine[COORD_SCALE_BYTE_AT]).toBe(6);
  });

  test('content on a dyadic grid finer than the floor gets exactly the scale it needs', () => {
    const step = 1 / 64; // needs ×64 — the derived floor at gridLevel 1 is ×4
    const segs = [line([2 + step, 3], [2 + 5 * step, 3 + 3 * step])];
    const bytes = serializeComposition(makeBundle(1, [makeSVG('s', segs)]), []);
    expect(bytes[COORD_SCALE_BYTE_AT]).toBe(6);
    expect(deserializeComposition(bytes).meta.svgObjects![0].segments).toEqual(segs);
  });

  test('the scale backs off so far-flung content still fits the i16 range', () => {
    // A stroke dragged 300 cells off the page: ×512 would overflow (300 ×
    // 512 > 32767), so the writer settles at the finest scale that fits
    // (×64 → ±511.98) rather than wrapping.
    const segs = freehand(10, 300, 300);
    const bytes = serializeComposition(makeBundle(1, [makeSVG('far', segs)]), []);
    expect(bytes[COORD_SCALE_BYTE_AT]).toBe(6);
    const out = deserializeComposition(bytes).meta.svgObjects![0].segments;
    expect(maxError(segs, out)).toBeLessThanOrEqual(1 / 128);
  });

  test('serialization is deterministic: the same content writes the same bytes twice', () => {
    const bundle = makeBundle(1, [makeSVG('stroke', freehand(30))]);
    expect(serializeComposition(bundle, [])).toEqual(serializeComposition(bundle, []));
  });

  test('a v57 file (no scale byte) still derives its scale from gridLevel', () => {
    const segs = [line([0.25, 0.5], [4.75, 0.5])];
    const bytes = serializeComposition(makeBundle(1, [makeSVG('s', segs)]), []);
    const asV57 = patchFormatVersion(bytes, 57);
    expect(asV57.length).toBe(bytes.length - 1);
    expect(deserializeComposition(asV57).meta.svgObjects![0].segments).toEqual(segs);
  });

  test('a v58 file claiming an impossible exponent is rejected rather than misread', () => {
    const bytes = serializeComposition(makeBundle(1, [makeSVG('s', [line([0, 0], [1, 1])])]), []);
    const bad = bytes.slice();
    bad[COORD_SCALE_BYTE_AT] = 200;
    expect(() => deserializeComposition(bad)).toThrow(/coordinate scale/);
  });
});
