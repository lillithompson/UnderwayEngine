import {
  computeContentBBox,
  normalizeComposition,
  NormalizableInput,
} from '../compositionNormalize';
import {
  CompositionFigure,
  GroupNode,
  ImageObject,
  SVGObject,
} from '../types';

function fig(over: Partial<CompositionFigure> & { id: string }): CompositionFigure {
  return {
    figureKey: 'file_x_L0',
    cellX: 0,
    cellY: 0,
    cellWidth: 4,
    cellHeight: 4,
    resolutionX: 2,
    resolutionY: 2,
    ...over,
  };
}

function svg(over: Partial<SVGObject> & { id: string }): SVGObject {
  return {
    segments: [{ kind: 'line', start: [0, 0], end: [4, 0] }],
    color: { r: 0, g: 0, b: 0 },
    cellX: 0,
    cellY: 0,
    cellWidth: 4,
    cellHeight: 0,
    ...over,
  };
}

function img(over: Partial<ImageObject> & { id: string }): ImageObject {
  return {
    imageId: 'i1',
    mimeType: 'image/png',
    pixelWidth: 100,
    pixelHeight: 100,
    cellX: 0,
    cellY: 0,
    cellWidth: 4,
    cellHeight: 4,
    ...over,
  };
}

function input(over: Partial<NormalizableInput>): NormalizableInput {
  return {
    figures: [],
    svgObjects: [],
    images: undefined,
    groups: [],
    gridLevel: 2,
    strokeScale: 0.04,
    ...over,
  };
}

describe('computeContentBBox', () => {
  test('returns null for empty content', () => {
    expect(computeContentBBox([], [], undefined)).toBeNull();
    expect(computeContentBBox([], [], [])).toBeNull();
  });

  test('walks figure cellX/Y + cellWidth/Height', () => {
    const bbox = computeContentBBox(
      [fig({ id: 'a', cellX: 3, cellY: 5, cellWidth: 4, cellHeight: 6 })],
      [],
      undefined,
    );
    expect(bbox).toEqual({ minX: 3, minY: 5, maxX: 7, maxY: 11 });
  });

  test('walks SVG segment endpoints', () => {
    const bbox = computeContentBBox(
      [],
      [svg({ id: 'l', segments: [{ kind: 'line', start: [1, 2], end: [9, 8] }] })],
      undefined,
    );
    expect(bbox).toEqual({ minX: 1, minY: 2, maxX: 9, maxY: 8 });
  });

  test('walks arc center', () => {
    const bbox = computeContentBBox(
      [],
      [svg({ id: 'a', segments: [{ kind: 'arc', start: [0, 0], end: [4, 4], center: [4, 0] }] })],
      undefined,
    );
    // Includes the arc center coord
    expect(bbox).toEqual({ minX: 0, minY: 0, maxX: 4, maxY: 4 });
  });

  test('walks SVG subpath segments', () => {
    const bbox = computeContentBBox(
      [],
      [svg({
        id: 's',
        segments: [{ kind: 'line', start: [0, 0], end: [2, 0] }],
        subpaths: [{ color: { r: 1, g: 1, b: 1 }, segments: [{ kind: 'line', start: [10, 10], end: [20, 30] }] }],
      })],
      undefined,
    );
    expect(bbox).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 30 });
  });

  test('walks creationBox extents', () => {
    const bbox = computeContentBBox(
      [],
      [svg({
        id: 'r',
        segments: [{ kind: 'line', start: [0, 0], end: [10, 0] }],
        creationBox: { minX: -5, minY: -5, width: 20, height: 20 },
      })],
      undefined,
    );
    expect(bbox).toEqual({ minX: -5, minY: -5, maxX: 15, maxY: 15 });
  });

  test('walks images', () => {
    const bbox = computeContentBBox(
      [],
      [],
      [img({ id: 'i', cellX: 10, cellY: 20, cellWidth: 5, cellHeight: 8 })],
    );
    expect(bbox).toEqual({ minX: 10, minY: 20, maxX: 15, maxY: 28 });
  });

  test('mixed kinds — union of all bboxes', () => {
    const bbox = computeContentBBox(
      [fig({ id: 'f', cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4 })],
      [svg({ id: 's', cellX: 10, cellY: 0, cellWidth: 4, cellHeight: 4, segments: [{ kind: 'line', start: [10, 0], end: [14, 4] }] })],
      [img({ id: 'i', cellX: 0, cellY: 20, cellWidth: 6, cellHeight: 6 })],
    );
    expect(bbox).toEqual({ minX: 0, minY: 0, maxX: 14, maxY: 26 });
  });

  test('skips hidden items', () => {
    const bbox = computeContentBBox(
      [
        fig({ id: 'a', cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4 }),
        fig({ id: 'b', hidden: true, cellX: 100, cellY: 100, cellWidth: 4, cellHeight: 4 }),
      ],
      [],
      undefined,
    );
    expect(bbox).toEqual({ minX: 0, minY: 0, maxX: 4, maxY: 4 });
  });
});

describe('normalizeComposition — scale factor selection', () => {
  test('bbox=4 yields s=8, k=3', () => {
    const r = normalizeComposition(input({
      svgObjects: [svg({ id: 's', cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
        segments: [{ kind: 'line', start: [0, 0], end: [4, 4] }] })],
    }));
    expect(r.k).toBe(3);
    expect(r.scale).toBe(8);
  });

  test('bbox=24 yields s=1, k=0 (no scaling)', () => {
    const r = normalizeComposition(input({
      svgObjects: [svg({ id: 's', cellX: 0, cellY: 0, cellWidth: 24, cellHeight: 24,
        segments: [{ kind: 'line', start: [0, 0], end: [24, 24] }] })],
    }));
    expect(r.k).toBe(0);
    expect(r.scale).toBe(1);
  });

  test('bbox=32 yields s=1, k=0 (already canonical)', () => {
    const r = normalizeComposition(input({
      svgObjects: [svg({ id: 's', cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32,
        segments: [{ kind: 'line', start: [0, 0], end: [32, 32] }] })],
    }));
    expect(r.k).toBe(0);
    expect(r.scale).toBe(1);
  });

  test('bbox=64 stays at s=1, k=0 (no downscale to preserve encoding precision)', () => {
    const r = normalizeComposition(input({
      svgObjects: [svg({ id: 's', cellX: 0, cellY: 0, cellWidth: 64, cellHeight: 64,
        segments: [{ kind: 'line', start: [0, 0], end: [64, 64] }] })],
    }));
    expect(r.k).toBe(0);
    expect(r.scale).toBe(1);
    // Content exceeds canonical box but is anchored at origin
    expect(r.svgObjects[0].segments[0]).toEqual({ kind: 'line', start: [0, 0], end: [64, 64] });
  });

  test('fine-grid content upscales past canonical canvas to preserve encoding precision', () => {
    // Castle-like scenario: gridLevel=-6 (step 1/64 L0) with a bbox
    // that fits in the canonical canvas. Without the precision floor
    // the normalizer would pick k=0 (kFit=0), leaving the new gridLevel
    // at -6 — well below the quarter-cell encoding grid, so any
    // sub-quarter sub-cell positions would round to zero on save.
    // The precision constraint forces k=4 (upscale by 16×) so the new
    // gridLevel is exactly -2, snug to the encoding grid.
    const r = normalizeComposition(input({
      svgObjects: [svg({ id: 's', cellX: 0, cellY: 0, cellWidth: 22, cellHeight: 22,
        segments: [{ kind: 'line', start: [0, 0], end: [22, 22] }] })],
      gridLevel: -6,
    }));
    expect(r.k).toBe(4);
    expect(r.scale).toBe(16);
    expect(r.gridLevel).toBe(-2);
    expect(r.svgObjects[0].cellWidth).toBe(22 * 16);
  });

  test('fine-grid content still upscales when bbox is small', () => {
    // Tiny content at gridLevel=-6: kFit=floor(log2(32/4))=3, kPrecision=4.
    // Precision wins → upscale by 16× (not 8×).
    const r = normalizeComposition(input({
      svgObjects: [svg({ id: 's', cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
        segments: [{ kind: 'line', start: [0, 0], end: [4, 4] }] })],
      gridLevel: -6,
    }));
    expect(r.k).toBe(4);
    expect(r.gridLevel).toBe(-2);
  });

  test('encoding-safe gridLevel uses fit-based scale (precision constraint inactive)', () => {
    // gridLevel=2 has plenty of precision headroom (kPrecision=-4); the
    // fit constraint at kFit=3 wins.
    const r = normalizeComposition(input({
      svgObjects: [svg({ id: 's', cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
        segments: [{ kind: 'line', start: [0, 0], end: [4, 4] }] })],
      gridLevel: 2,
    }));
    expect(r.k).toBe(3);
    expect(r.gridLevel).toBe(5);
  });

  test('extreme negative gridLevel is capped at MAX_PRECISION_K to avoid encoding overflow', () => {
    // gridLevel=-20 would theoretically demand k=18 to reach -2; cap at 10.
    const r = normalizeComposition(input({
      svgObjects: [svg({ id: 's', cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
        segments: [{ kind: 'line', start: [0, 0], end: [4, 4] }] })],
      gridLevel: -20,
    }));
    expect(r.k).toBe(10);
    expect(r.gridLevel).toBe(-10);
  });

  test('non-square bbox 8×4 yields s=4, offset snaps to new grid step', () => {
    // Input gridLevel=2 → newGridLevel = 2+k = 4. newStep = 2^4 = 16. The
    // ideal Y offset (32-16)/2 = 8 isn't a multiple of 16, so it floors to
    // 0 — content sits at top, but stays grid-aligned.
    const r = normalizeComposition(input({
      svgObjects: [svg({ id: 's', cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 4,
        segments: [{ kind: 'line', start: [0, 0], end: [8, 4] }] })],
    }));
    expect(r.k).toBe(2);
    expect(r.scale).toBe(4);
    expect(r.svgObjects[0].cellX).toBe(0);
    expect(r.svgObjects[0].cellY).toBe(0);
    expect(r.svgObjects[0].cellWidth).toBe(32);
    expect(r.svgObjects[0].cellHeight).toBe(16);
  });

  test('non-square bbox centers when newStep divides the headroom', () => {
    // Input gridLevel=1 → newGridLevel = 1+k = 3. newStep = 2^3 = 8.
    // headroomY = (32-16)/2 = 8, which is a multiple of 8 → snap is no-op
    // and content centers nicely.
    const r = normalizeComposition(input({
      svgObjects: [svg({ id: 's', cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 4,
        segments: [{ kind: 'line', start: [0, 0], end: [8, 4] }] })],
      gridLevel: 1,
    }));
    expect(r.svgObjects[0].cellX).toBe(0);
    expect(r.svgObjects[0].cellY).toBe(8);
    expect(r.svgObjects[0].cellWidth).toBe(32);
    expect(r.svgObjects[0].cellHeight).toBe(16);
  });
});

describe('normalizeComposition — grid alignment preserved', () => {
  test('arc that fits one cell at gridLevel L still fits one cell after normalize', () => {
    // Figure at L2 (step=4) snapped to a single L2 cell at (4, 4).
    const r = normalizeComposition(input({
      figures: [fig({ id: 'f', cellX: 4, cellY: 4, cellWidth: 4, cellHeight: 4 })],
      gridLevel: 2,
    }));
    // bbox 4×4 ⇒ k=3, s=8. New gridLevel = 2+3 = 5. New step at L5 = 2^5 = 32.
    expect(r.gridLevel).toBe(5);
    const fout = r.figures[0];
    // Original (4, 4)..(8, 8) → (0, 0)..(32, 32) after translate-and-scale + center
    expect(fout.cellWidth).toBe(32);
    expect(fout.cellHeight).toBe(32);
    // The figure fits exactly one cell at the new grid level (step = 2^5 = 32)
    const newStep = Math.pow(2, r.gridLevel);
    expect(fout.cellWidth % newStep).toBe(0);
    expect(fout.cellHeight % newStep).toBe(0);
  });

  test('content snapped at L2 stays grid-aligned after power-of-2 scaling', () => {
    // Three figures at L2 (step=4) snapped at multiples of 4: (0,0), (8,0), (4,4)
    // bbox is 16×8 ⇒ k=floor(log2(32/16))=1, s=2
    const r = normalizeComposition(input({
      figures: [
        fig({ id: 'a', cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4 }),
        fig({ id: 'b', cellX: 8, cellY: 0, cellWidth: 4, cellHeight: 4 }),
        fig({ id: 'c', cellX: 4, cellY: 4, cellWidth: 4, cellHeight: 4 }),
      ],
      gridLevel: 2,
    }));
    expect(r.k).toBe(1);
    expect(r.scale).toBe(2);
    expect(r.gridLevel).toBe(3); // step = 2^3 = 8 in new coords
    // All positions should be multiples of the new step (8)
    const newStep = Math.pow(2, r.gridLevel);
    for (const f of r.figures) {
      expect(f.cellX % newStep).toBe(0);
      expect(f.cellY % newStep).toBe(0);
      expect(f.cellWidth % newStep).toBe(0);
      expect(f.cellHeight % newStep).toBe(0);
    }
  });
});

describe('normalizeComposition — idempotency', () => {
  test('normalize(normalize(x)) is structurally equal to normalize(x)', () => {
    const a = normalizeComposition(input({
      figures: [fig({ id: 'f', cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4 })],
    }));
    const b = normalizeComposition({
      figures: a.figures,
      svgObjects: a.svgObjects,
      images: a.images,
      groups: a.groups,
      gridLevel: a.gridLevel,
      strokeScale: a.strokeScale,
    });
    expect(b.scale).toBe(1);
    expect(b.k).toBe(0);
    expect(b.figures[0].cellX).toBe(a.figures[0].cellX);
    expect(b.figures[0].cellY).toBe(a.figures[0].cellY);
    expect(b.figures[0].cellWidth).toBe(a.figures[0].cellWidth);
    expect(b.gridLevel).toBe(a.gridLevel);
    expect(b.strokeScale).toBeCloseTo(a.strokeScale);
  });
});

describe('normalizeComposition — strokeScale and gridLevel', () => {
  test('strokeScale multiplies by s', () => {
    const r = normalizeComposition(input({
      svgObjects: [svg({ id: 's', cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 8,
        segments: [{ kind: 'line', start: [0, 0], end: [8, 8] }] })],
      strokeScale: 0.05,
    }));
    expect(r.scale).toBe(4);
    expect(r.strokeScale).toBeCloseTo(0.05 * 4);
  });

  test('gridLevel shifts by k', () => {
    const r = normalizeComposition(input({
      figures: [fig({ id: 'f', cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 8 })],
      gridLevel: 2,
    }));
    expect(r.k).toBe(2);
    expect(r.gridLevel).toBe(4);
  });

  test('gridLevel can land outside [0, 6]', () => {
    const r1 = normalizeComposition(input({
      figures: [fig({ id: 'f', cellX: 0, cellY: 0, cellWidth: 1, cellHeight: 1 })],
      gridLevel: 5,
    }));
    expect(r1.k).toBe(5);
    expect(r1.gridLevel).toBe(10); // exceeds 6 — proves the type is unbounded
    const r2 = normalizeComposition(input({
      figures: [fig({ id: 'f', cellX: 0, cellY: 0, cellWidth: 128, cellHeight: 128 })],
      gridLevel: 0,
    }));
    expect(r2.k).toBe(0);
    expect(r2.gridLevel).toBe(0); // no downscale — content stays at authored size
  });
});

describe('normalizeComposition — groups', () => {
  test('group translate transforms; scaleX/Y unchanged', () => {
    const group: GroupNode = {
      id: 'g',
      name: 'group',
      translateX: 4,
      translateY: 6,
      scaleX: 1.5,
      scaleY: 2,
      rotation: 0,
      mirrorH: false,
      mirrorV: false,
    };
    const r = normalizeComposition(input({
      figures: [fig({ id: 'a', cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 8, groupId: 'g' })],
      groups: [group],
    }));
    // s=4, bbox.min=(0,0), offsetX=0, offsetY=12 (32-8*4=0, 32-8*4=0... wait)
    // bbox 8×8 → s=4, bboxW*s=32, bboxH*s=32. offsetX=0, offsetY=0.
    // translateX: (4-0)*4 + 0 = 16. translateY: (6-0)*4 + 0 = 24.
    expect(r.groups[0].translateX).toBe(16);
    expect(r.groups[0].translateY).toBe(24);
    expect(r.groups[0].scaleX).toBe(1.5);
    expect(r.groups[0].scaleY).toBe(2);
  });
});

describe('normalizeComposition — SVG segments', () => {
  test('line endpoints scale', () => {
    const r = normalizeComposition(input({
      svgObjects: [svg({
        id: 's',
        cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
        segments: [
          { kind: 'line', start: [0, 0], end: [4, 0] },
          { kind: 'line', start: [4, 0], end: [4, 4] },
        ],
      })],
    }));
    // s=8, bbox 4×4 → 32×32 centered (offset 0,0)
    expect(r.svgObjects[0].segments[0]).toEqual({ kind: 'line', start: [0, 0], end: [32, 0] });
    expect(r.svgObjects[0].segments[1]).toEqual({ kind: 'line', start: [32, 0], end: [32, 32] });
  });

  test('arc center scales', () => {
    const r = normalizeComposition(input({
      svgObjects: [svg({
        id: 'a',
        cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
        segments: [{ kind: 'arc', start: [0, 0], end: [4, 4], center: [4, 0] }],
      })],
    }));
    const seg = r.svgObjects[0].segments[0];
    expect(seg.kind).toBe('arc');
    if (seg.kind !== 'arc') throw new Error('expected arc');
    expect(seg.center).toEqual([32, 0]);
  });

  test('subpath segments scale', () => {
    const r = normalizeComposition(input({
      svgObjects: [svg({
        id: 's',
        cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
        segments: [{ kind: 'line', start: [0, 0], end: [4, 4] }],
        subpaths: [{ color: { r: 1, g: 1, b: 1 }, segments: [{ kind: 'line', start: [1, 1], end: [3, 3] }] }],
      })],
    }));
    expect(r.svgObjects[0].subpaths![0].segments[0]).toEqual({ kind: 'line', start: [8, 8], end: [24, 24] });
  });

  test('creationBox transforms', () => {
    const r = normalizeComposition(input({
      svgObjects: [svg({
        id: 's',
        cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
        segments: [{ kind: 'line', start: [0, 0], end: [4, 4] }],
        creationBox: { minX: 0, minY: 0, width: 4, height: 4 },
      })],
    }));
    expect(r.svgObjects[0].creationBox).toEqual({ minX: 0, minY: 0, width: 32, height: 32 });
  });
});

describe('normalizeComposition — tile patterns', () => {
  test('tileWidthL0 / tileHeightL0 scale', () => {
    const r = normalizeComposition(input({
      figures: [fig({
        id: 'f',
        cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 8,
        tileMode: 'repeat',
        tileWidthL0: 2,
        tileHeightL0: 2,
      })],
    }));
    // s=4 (bbox 8x8 → 32×32)
    expect(r.figures[0].tileWidthL0).toBe(8);
    expect(r.figures[0].tileHeightL0).toBe(8);
  });
});

describe('normalizeComposition — encoding precision', () => {
  test('oversized content with odd-0.25 coords preserves them exactly', () => {
    // Content at 0.25-grid positions that would land off-grid if downscaled
    // by 0.5 (e.g., 5.25 * 0.5 = 2.625 → encodeFixed rounds to 2.75).
    // With k clamped to 0, no scaling occurs and coords pass through intact.
    const r = normalizeComposition(input({
      svgObjects: [svg({
        id: 's',
        cellX: 0, cellY: 0, cellWidth: 48, cellHeight: 48,
        segments: [
          { kind: 'line', start: [5.25, 10.75], end: [47.25, 33.75] },
        ],
      })],
      gridLevel: 0,
    }));
    expect(r.k).toBe(0);
    expect(r.scale).toBe(1);
    // Coordinates are only translated (centering), not scaled — values
    // stay on the 0.25 grid so encodeFixed is lossless.
    const seg = r.svgObjects[0].segments[0];
    expect(seg.start[0] % 0.25).toBe(0);
    expect(seg.start[1] % 0.25).toBe(0);
    expect(seg.end[0] % 0.25).toBe(0);
    expect(seg.end[1] % 0.25).toBe(0);
    // The 0.25-unit fractional parts are preserved (not rounded to 0.5)
    expect(seg.end[0] - seg.start[0]).toBe(42);
    expect(seg.end[1] - seg.start[1]).toBe(23);
  });
});

describe('normalizeComposition — degenerate / empty', () => {
  test('empty composition returns input unchanged', () => {
    const inp = input({});
    const r = normalizeComposition(inp);
    expect(r.figures).toBe(inp.figures);
    expect(r.svgObjects).toBe(inp.svgObjects);
    expect(r.k).toBe(0);
    expect(r.scale).toBe(1);
    expect(r.gridLevel).toBe(inp.gridLevel);
    expect(r.strokeScale).toBe(inp.strokeScale);
  });

  test('single zero-extent point inside the canonical box passes through untouched', () => {
    // Stability invariant: content already inside [0, CANONICAL_SIZE] with
    // k=0 is returned as-is — no recentering, no coordinate rewrite.
    const r = normalizeComposition(input({
      svgObjects: [svg({ id: 'p', cellX: 5, cellY: 5, cellWidth: 0, cellHeight: 0,
        segments: [{ kind: 'line', start: [5, 5], end: [5, 5] }] })],
    }));
    expect(r.scale).toBe(1);
    expect(r.k).toBe(0);
    expect(r.svgObjects[0].segments[0]).toEqual({ kind: 'line', start: [5, 5], end: [5, 5] });
  });
});

describe('normalizeComposition — authored coordinates are inviolable', () => {
  test('content already in canonical position round-trips bit-exactly', () => {
    // Coordinates with non-representable fractions: an identity affine
    // ((x - o) * 1 + o) would perturb these by a float ulp. The stability
    // early-return must hand back the exact input arrays.
    const inp = input({
      svgObjects: [svg({
        id: 's', cellX: 0.1, cellY: 0.1, cellWidth: 28, cellHeight: 20,
        segments: [{ kind: 'line', start: [0.1, 0.1], end: [28.1, 20.1] }],
      })],
    });
    const r = normalizeComposition(inp);
    expect(r.k).toBe(0);
    expect(r.svgObjects).toBe(inp.svgObjects); // same array, not a rewrite
  });

  test('off-grid freehand bbox min cannot knock grid-aligned content off the grid', () => {
    // The Reimagine bug: a grid-aligned seed squiggle (gridLevel 2, step 4)
    // plus a freehand stroke whose bbox min is off-grid AND out of the
    // canonical box (negative coords force a translation). The translation
    // must be a multiple of the grid step so the seed stays aligned.
    const step = 4; // 2^gridLevel
    const r = normalizeComposition(input({
      svgObjects: [
        svg({ id: 'seed', cellX: 4, cellY: 8, cellWidth: 8, cellHeight: 8,
          segments: [
            { kind: 'line', start: [4, 8], end: [8, 8] },
            { kind: 'arc', start: [8, 8], end: [12, 12], center: [8, 12] },
          ] }),
        svg({ id: 'freehand', cellX: -3.7, cellY: -1.3, cellWidth: 30, cellHeight: 30,
          segments: [{ kind: 'line', start: [-3.7, -1.3], end: [26.3, 28.7] }] }),
      ],
      gridLevel: 2,
    }));
    expect(r.k).toBe(0);
    const newStep = Math.pow(2, r.gridLevel);
    expect(newStep).toBe(step);
    const seed = r.svgObjects.find(s => s.id === 'seed')!;
    for (const seg of seed.segments) {
      expect(seg.start[0] % newStep).toBe(0);
      expect(seg.start[1] % newStep).toBe(0);
      expect(seg.end[0] % newStep).toBe(0);
      expect(seg.end[1] % newStep).toBe(0);
      if (seg.kind === 'arc') {
        expect(seg.center[0] % newStep).toBe(0);
        expect(seg.center[1] % newStep).toBe(0);
      }
    }
    // The freehand stroke keeps its sub-grid phase exactly (translated by a
    // whole number of steps only).
    const fh = r.svgObjects.find(s => s.id === 'freehand')!;
    expect(((fh.segments[0].start[0] % step) + step) % step).toBeCloseTo(((-3.7 % step) + step) % step, 12);
    expect(((fh.segments[0].start[1] % step) + step) % step).toBeCloseTo(((-1.3 % step) + step) % step, 12);
  });

  test('grid-aligned content stays aligned when an off-grid stroke forces an upscale', () => {
    // Small scene (bbox < 16 → k > 0) whose bbox min is defined by an
    // off-grid freehand point. Scaling is anchored at the floored-to-grid
    // origin, so the aligned square must land on the new grid step.
    const r = normalizeComposition(input({
      figures: [fig({ id: 'sq', cellX: 4, cellY: 4, cellWidth: 4, cellHeight: 4 })],
      svgObjects: [svg({ id: 'fh', cellX: 2.3, cellY: 2.9, cellWidth: 1, cellHeight: 1,
        segments: [{ kind: 'line', start: [2.3, 2.9], end: [3.3, 3.9] }] })],
      gridLevel: 2,
    }));
    expect(r.k).toBeGreaterThan(0);
    const newStep = Math.pow(2, r.gridLevel);
    const sq = r.figures[0];
    expect(sq.cellX % newStep).toBe(0);
    expect(sq.cellY % newStep).toBe(0);
    expect(sq.cellWidth % newStep).toBe(0);
    expect(sq.cellHeight % newStep).toBe(0);
  });

  test('normalize is exactly stable across repeated applications', () => {
    // Whatever the first normalize produces, applying it again (a reload)
    // must return the identical arrays — not merely close values.
    const first = normalizeComposition(input({
      svgObjects: [
        svg({ id: 'seed', cellX: 4, cellY: 8, cellWidth: 8, cellHeight: 8,
          segments: [{ kind: 'line', start: [4, 8], end: [12, 16] }] }),
        svg({ id: 'freehand', cellX: -3.7, cellY: -1.3, cellWidth: 10, cellHeight: 10,
          segments: [{ kind: 'line', start: [-3.7, -1.3], end: [6.3, 8.7] }] }),
      ],
      gridLevel: 2,
    }));
    const second = normalizeComposition({
      figures: first.figures,
      svgObjects: first.svgObjects,
      images: first.images,
      texts: first.texts,
      groups: first.groups,
      gridLevel: first.gridLevel,
      strokeScale: first.strokeScale,
    });
    expect(second.k).toBe(0);
    expect(second.scale).toBe(1);
    expect(second.svgObjects).toBe(first.svgObjects); // identical reference
    expect(second.figures).toBe(first.figures);
  });
});

describe('normalizeComposition — frame (page) anchoring', () => {
  // A full-page daily-haiku-style frame: a hidden `isMask` boundary rect at the
  // page origin + a photo dragged DOWN-RIGHT so it overhangs the frame, all
  // members of an `isFrame` group at identity. The frame IS the page (the fixed
  // white background div is drawn at world (0,0)); normalization must keep the
  // frame's clip rect pinned there and NOT let the overhanging photo re-anchor
  // the scene — otherwise the crop slides up-left of the page on reopen.
  const PAGE_H = 42.67;
  const rect = (x: number, y: number, w: number, h: number): SVGObject['segments'] => ([
    { kind: 'line', start: [x, y], end: [x + w, y] },
    { kind: 'line', start: [x + w, y], end: [x + w, y + h] },
    { kind: 'line', start: [x + w, y + h], end: [x, y + h] },
    { kind: 'line', start: [x, y + h], end: [x, y] },
  ]);
  const frameGroup: GroupNode = {
    id: 'frame', name: 'Daily Haiku', translateX: 0, translateY: 0,
    scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false, isFrame: true,
  } as GroupNode;

  function haikuInput(imgX: number, imgY: number): NormalizableInput {
    return input({
      svgObjects: [svg({
        id: 'svg_boundary', groupId: 'frame', isMask: true, hidden: true,
        segments: rect(0, 0, 32, PAGE_H), cellX: 0, cellY: 0, cellWidth: 32, cellHeight: PAGE_H,
      })],
      images: [img({ id: 'img_photo', groupId: 'frame', cellX: imgX, cellY: imgY, cellWidth: 32, cellHeight: PAGE_H })],
      groups: [frameGroup],
      gridLevel: 3,
    });
  }

  const boundaryOf = (r: { svgObjects: SVGObject[] }) => r.svgObjects.find((s) => s.id === 'svg_boundary')!;

  test('the hidden frame boundary anchors the bbox; framed overhang is ignored', () => {
    // With groups, the overhanging photo does not extend the anchor bbox — it's
    // the frame boundary (0,0,32,PAGE_H) that defines it.
    const bbox = computeContentBBox(
      haikuInput(6, 6).figures, haikuInput(6, 6).svgObjects, haikuInput(6, 6).images, undefined,
      [frameGroup],
    );
    expect(bbox).toEqual({ minX: 0, minY: 0, maxX: 32, maxY: PAGE_H });
  });

  test('a down-right overhang leaves the frame clip pinned at the page origin', () => {
    const r = normalizeComposition(haikuInput(6, 6));
    const b = boundaryOf(r);
    expect(b.cellX).toBeCloseTo(0, 5);
    expect(b.cellY).toBeCloseTo(0, 5);
    expect(b.cellWidth).toBeCloseTo(32, 5);
    expect(b.cellHeight).toBeCloseTo(PAGE_H, 5);
    // The photo keeps its position relative to the (pinned) clip.
    const photo = r.images!.find((i) => i.id === 'img_photo')!;
    expect(photo.cellX).toBeCloseTo(6, 5);
    expect(photo.cellY).toBeCloseTo(6, 5);
  });

  test('an up-left overhang also leaves the frame pinned (no drift either way)', () => {
    const r = normalizeComposition(haikuInput(-5, -4));
    const b = boundaryOf(r);
    expect(b.cellX).toBeCloseTo(0, 5);
    expect(b.cellY).toBeCloseTo(0, 5);
    const photo = r.images!.find((i) => i.id === 'img_photo')!;
    expect(photo.cellX).toBeCloseTo(-5, 5);
    expect(photo.cellY).toBeCloseTo(-4, 5);
  });

  test('regression: WITHOUT frame awareness the overhang drifts the clip', () => {
    // The old behavior (no groups → all visible content drives the anchor):
    // the hidden boundary was excluded and the down-right photo pushed the
    // bbox min off (0,0), sliding the clip up-left. Guards the fix.
    const i = haikuInput(6, 6);
    const legacy = computeContentBBox(i.figures, i.svgObjects, i.images, undefined);
    expect(legacy!.minX).toBeGreaterThan(0);
    expect(legacy!.minY).toBeGreaterThan(0);
  });
});
