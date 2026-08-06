/**
 * Tests for the v45 per-file fixed-point coordinate scale.
 *
 * The i16 coordinate fields were hard-wired to quarter-cell precision (×4),
 * which silently collapsed geometry authored on grids finer than
 * gridLevel −2. Consumers that save page-anchored compositions with
 * normalize:false (CozyJournal journal pages) never get the normalizer's
 * precision upscale, so a stroke drawn at gridLevel −5 (step 1/32 cell)
 * rounded every endpoint onto the 0.25 grid — the same class of loss as the
 * old Castle collapsed-segments bug. v45 derives the scale per file from
 * the composition's gridLevel (already the first metadata field), the same
 * pure function on the write and read side, so the byte layout is unchanged
 * from v44.
 */

import {
  serializeComposition,
  deserializeComposition,
  CompositionBundle,
} from '../compositionBinaryFormat';
import { PathSegment, SVGObject } from '../types';

function line(start: [number, number], end: [number, number]): PathSegment {
  return { kind: 'line', start, end };
}

function makeSVG(id: string, segments: PathSegment[], extras: Partial<SVGObject> = {}): SVGObject {
  const xs = segments.flatMap((s) => [s.start[0], s.end[0]]);
  const ys = segments.flatMap((s) => [s.start[1], s.end[1]]);
  return {
    id,
    segments,
    color: { r: 255, g: 160, b: 50 },
    cellX: Math.min(...xs),
    cellY: Math.min(...ys),
    cellWidth: Math.max(...xs) - Math.min(...xs),
    cellHeight: Math.max(...ys) - Math.min(...ys),
    ...extras,
  };
}

function makeBundle(gridLevel: number, svgObjects: SVGObject[]): CompositionBundle {
  return {
    name: 'Test', gridLevel, strokeScale: 0.2, gridIntensity: 0.3,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    figures: [],
    svgObjects,
    sceneOrder: svgObjects.map((s) => s.id),
  };
}

function roundTrip(bundle: CompositionBundle) {
  return deserializeComposition(serializeComposition(bundle, []));
}

describe('v45 per-file coordinate scale', () => {
  test('gridLevel −5 geometry round-trips exactly (1/32-cell steps)', () => {
    // Endpoints on the gridLevel −5 snap grid: multiples of 1/32 cell.
    // Every one of these would collapse onto the 0.25 grid at the legacy
    // quarter-cell scale.
    const step = 1 / 32;
    const segs = [
      line([5 * step, 7 * step], [9 * step, 7 * step]),
      line([9 * step, 7 * step], [9 * step, 20 * step]),
      line([1.5, 1.5 + step], [1.5 + 3 * step, 1.5 + step]),
    ];
    const { meta } = roundTrip(makeBundle(-5, [makeSVG('fine', segs)]));
    expect(meta.svgObjects![0].segments).toEqual(segs);
    expect(meta.gridLevel).toBe(-5);
  });

  test('half-step offsets of the finest grid survive too', () => {
    // The editor's solo-H/V line snap places the perpendicular axis at
    // HALF the active step (gridSnap uses level − 1), so at gridLevel −5
    // coordinates land on 1/64-cell multiples. The scale is one bit finer
    // than the snap step to keep those exact.
    const half = 1 / 64;
    const segs = [line([2, 3 * half], [4, 3 * half])];
    const { meta } = roundTrip(makeBundle(-5, [makeSVG('half', segs)]));
    expect(meta.svgObjects![0].segments).toEqual(segs);
  });

  test('bboxes and creation boxes carry the fine scale as well', () => {
    const step = 1 / 32;
    const svg = makeSVG('boxed', [line([step, step], [33 * step, step])], {
      creationBox: { minX: step, minY: step, width: 32 * step, height: 6 * step },
    });
    const { meta } = roundTrip(makeBundle(-5, [svg]));
    const out = meta.svgObjects![0];
    expect(out.cellX).toBe(svg.cellX);
    expect(out.cellY).toBe(svg.cellY);
    expect(out.cellWidth).toBe(svg.cellWidth);
    expect(out.creationBox).toEqual(svg.creationBox);
  });

  test('coarse-grid files keep the legacy quarter-cell coordinate bytes', () => {
    // gridLevel ≥ −1 derives the legacy ×4 scale and the layout carries no
    // new fields, so a v45 buffer patched down to v44 must decode to the
    // very same composition — the byte-compat invariant every legacy
    // migration test in this suite leans on.
    const segs = [line([0.25, 0.5], [4.75, 0.5])];
    const bytes = serializeComposition(makeBundle(1, [makeSVG('s', segs)]), []);
    expect(deserializeComposition(bytes).meta.svgObjects![0].segments).toEqual(segs);

    const asV44 = bytes.slice();
    new DataView(asV44.buffer).setUint16(4, 44, true);
    expect(deserializeComposition(asV44).meta.svgObjects![0].segments).toEqual(segs);
  });

  test('quarter-cell content also round-trips under a fine scale', () => {
    // Coordinates on the coarse 0.25 grid are exactly representable at
    // every finer scale, so cranking the grid finer never perturbs content
    // drawn earlier at coarser levels.
    const segs = [line([0.25, 0.5], [4.75, 0.5])];
    const { meta } = roundTrip(makeBundle(-5, [makeSVG('s', segs)]));
    expect(meta.svgObjects![0].segments).toEqual(segs);
  });

  test('sub-scale detail still quantizes instead of corrupting', () => {
    // Below the encodable precision (1/64 at the ×64 scale cap) values
    // round to the nearest representable coordinate — bounded loss (max
    // half a step), no wraparound.
    const segs = [line([1 / 256, 0], [2, 0])];
    const { meta } = roundTrip(makeBundle(-9, [makeSVG('tiny', segs)]));
    const [sx] = meta.svgObjects![0].segments[0].start;
    expect(Math.abs(sx - 1 / 256)).toBeLessThanOrEqual(1 / 128);
  });
});
