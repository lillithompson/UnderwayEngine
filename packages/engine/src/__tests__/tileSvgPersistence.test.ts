import * as fs from 'fs';
import * as zlib from 'zlib';
import { deserializeComposition, serializeComposition } from '../compositionBinaryFormat';
import { rotateSVG90CW } from '../compositionOps';
import { SVGObject, PathSegment } from '../types';

const WHITE = { r: 255, g: 255, b: 255 };

// ── Regression file ────────────────────────────────────────────────
// `TestSVGPattern.tile` was exported after the user dragged a tiled
// SVG pattern to fill a region larger than one tile. The .tile binary
// format wrote tileWidthL0/HeightL0 but never persisted the region
// (cellX/Y/Width/Height), so the loaded SVG collapses back to one tile
// on import.

function loadTile(path: string) {
  const compressed = fs.readFileSync(path);
  const decompressed = new Uint8Array(zlib.inflateSync(compressed));
  return deserializeComposition(decompressed);
}

const TEST_FILE = `${__dirname}/../../test_data/TestSVGPattern.tile`;

describe('TestSVGPattern.tile tile-region round-trip', () => {
  test('imported tile SVG keeps its dragged region (not collapsed to one tile)', () => {
    const { meta } = loadTile(TEST_FILE);
    const svg = meta.svgObjects![0];
    expect(svg.tileMode).toBe('repeat');
    // Region MUST be strictly larger than one tile in at least one
    // dimension — the user explicitly dragged it past one tile before
    // exporting. Pre-fix, the loader recomputed cellWidth/Height from
    // segment AABB which collapses to exactly tileWidthL0/HeightL0.
    const regionArea = svg.cellWidth * svg.cellHeight;
    const tileArea = (svg.tileWidthL0 ?? 0) * (svg.tileHeightL0 ?? 0);
    expect(regionArea).toBeGreaterThan(tileArea);
  });
});

describe('tile-mode SVG binary round-trip', () => {
  function makeTileSvg(region: { x: number; y: number; w: number; h: number }): SVGObject {
    const segments: PathSegment[] = [
      { kind: 'line', start: [0, 0], end: [4, 0] },
      { kind: 'line', start: [4, 0], end: [4, 4] },
      { kind: 'line', start: [4, 4], end: [0, 4] },
      { kind: 'line', start: [0, 4], end: [0, 0] },
    ];
    return {
      id: 'svg_test_tile', segments, color: WHITE,
      cellX: region.x, cellY: region.y, cellWidth: region.w, cellHeight: region.h,
      tileMode: 'repeat', tileWidthL0: 4, tileHeightL0: 4,
    };
  }

  function roundTrip(svg: SVGObject): SVGObject {
    const bundle = {
      name: 'test', gridLevel: 0 as const,
      strokeScale: 1, gridIntensity: 1,
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
      figures: [],
      groups: [],
      svgObjects: [svg],
      sceneOrder: [svg.id],
    };
    const bytes = serializeComposition(bundle, []);
    const { meta } = deserializeComposition(bytes);
    return meta.svgObjects![0];
  }

  test('region (cellX/Y/Width/Height) survives binary round-trip', () => {
    // A region clearly larger than one tile — pre-fix, the loader
    // recomputed cellX/Y/W/H from segment AABB and the region info
    // (12 × 12 vs the unit's 4 × 4) was lost.
    const original = makeTileSvg({ x: -5, y: 10, w: 12, h: 12 });
    const restored = roundTrip(original);
    expect(restored.tileMode).toBe('repeat');
    expect(restored.cellX).toBe(-5);
    expect(restored.cellY).toBe(10);
    expect(restored.cellWidth).toBe(12);
    expect(restored.cellHeight).toBe(12);
    expect(restored.tileWidthL0).toBe(4);
    expect(restored.tileHeightL0).toBe(4);
  });

  test('non-tile SVG region still derives from segment AABB (no change)', () => {
    // Regression check: only tile-mode SVGs carry the region in the
    // binary stream. Plain SVGs continue to recover bbox from segments,
    // which keeps backwards compatibility with v18 files.
    const segments: PathSegment[] = [{ kind: 'line', start: [0, 0], end: [10, 6] }];
    const svg: SVGObject = {
      id: 'svg_test_line', segments, color: WHITE,
      cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 6,
    };
    const restored = roundTrip(svg);
    expect(restored.cellX).toBe(0);
    expect(restored.cellY).toBe(0);
    expect(restored.cellWidth).toBe(10);
    expect(restored.cellHeight).toBe(6);
  });
});

// Helper: AABB of all segment endpoints (and arc centers), matching what
// `applyTiledSVGObject` reads when building the per-tile path content.
function segmentsAABB(segments: ReadonlyArray<PathSegment>): { w: number; h: number; minX: number; minY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const seg of segments) {
    const pts: readonly [number, number][] = seg.kind === 'arc' ? [seg.start, seg.end, seg.center] : [seg.start, seg.end];
    for (const [x, y] of pts) {
      if (x < minX) minX = x; if (y < minY) minY = y;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }
  }
  return { w: maxX - minX, h: maxY - minY, minX, minY };
}

describe('TestSVGPattern.tile tile rotation alignment', () => {
  // After rotating the imported tile SVG, the segments rotate so their
  // AABB swaps W/H. The renderer translates each tile's segments by
  // (-minX, -minY) into a `tileWidthL0 × tileHeightL0` cell — if the tile
  // dimensions don't also swap, the rotated 40×32 design gets crammed into
  // a 32×40 cell (or vice versa), visibly misaligning the pattern. The
  // tile offsets must also rotate so the world position of the pattern
  // grid origin tracks the rotation pivoting around the region center.

  test('design AABB matches tile dimensions both before and after a rotation', () => {
    const { meta } = loadTile(TEST_FILE);
    const svg = meta.svgObjects![0];
    const before = segmentsAABB(svg.segments);
    expect(before.w).toBe(svg.tileWidthL0);
    expect(before.h).toBe(svg.tileHeightL0);

    const rotated = rotateSVG90CW(svg);
    const after = segmentsAABB(rotated.segments);
    expect(after.w).toBe(rotated.tileWidthL0);
    expect(after.h).toBe(rotated.tileHeightL0);
  });

  test('tile-grid world origin rotates with the region', () => {
    // The pattern grid is anchored at world (cellX + tileOffsetXL0,
    // cellY + tileOffsetYL0). Rotating the SVG must move that anchor to
    // the rotated position around the region center; otherwise the
    // pattern stays "stuck" to the old world location while the region
    // moves out from under it.
    const { meta } = loadTile(TEST_FILE);
    const svg = meta.svgObjects![0];

    const oldPatX = svg.cellX + (svg.tileOffsetXL0 ?? 0);
    const oldPatY = svg.cellY + (svg.tileOffsetYL0 ?? 0);
    const rcx = svg.cellX + svg.cellWidth / 2;
    const rcy = svg.cellY + svg.cellHeight / 2;
    // Rotate (oldPatX, oldPatY) 90° CW around (rcx, rcy) in screen-y-down.
    const expectedPatX = rcx - (oldPatY - rcy);
    const expectedPatY = rcy + (oldPatX - rcx);

    const rotated = rotateSVG90CW(svg);
    const newTileW = rotated.tileWidthL0 ?? 0;
    const newTileH = rotated.tileHeightL0 ?? 0;
    const newPatX = rotated.cellX + (rotated.tileOffsetXL0 ?? 0);
    const newPatY = rotated.cellY + (rotated.tileOffsetYL0 ?? 0);
    // Compare modulo tile period — the pattern is periodic, so any anchor
    // congruent (mod tile) renders identically.
    const mod = (a: number, m: number) => ((a % m) + m) % m;
    expect(mod(newPatX, newTileW)).toBeCloseTo(mod(expectedPatX, newTileW), 9);
    expect(mod(newPatY, newTileH)).toBeCloseTo(mod(expectedPatY, newTileH), 9);
  });
});

describe('rotation alignment when SVG is loaded with rotation + mirror', () => {
  // After loading TestSVGPattern.tile the SVG arrives with `rotation:
  // 180, mirrorV: true` and `identitySegments` pointing at the un-rotated
  // un-mirrored geometry. The user reports that the next rotation
  // misaligns the segments — i.e. they no longer match the canonical
  // "mirror then rotate from identity" state that `mirrorSVG` produces.
  //
  // Root cause we want this test to lock down: `rotateSVG90CW` rebuilds
  // segments from `identitySegments` with only the new rotation applied,
  // without re-applying the still-active mirror flag, so the mirror is
  // silently dropped from the segment data while the flag stays set.
  //
  // To keep the assertion independent of the pattern's incidental
  // symmetry (the bundled TestSVGPattern.tile happens to be near-
  // symmetric, hiding the misalignment) we use an asymmetric synthetic
  // SVG that arrives in the same "rotated + mirrored, with identity
  // stashed" load state.

  function makeRotatedMirrored(): SVGObject {
    // Asymmetric polyline at identity — start at (1, 0), end at (3, 5).
    // No 180° rotational symmetry, no horizontal-mirror symmetry.
    const identitySegments: PathSegment[] = [
      { kind: 'line', start: [1, 0], end: [3, 5] },
      { kind: 'line', start: [3, 5], end: [2, 7] },
    ];
    // mirrorV around bbox center, then rotate 180° around same center
    // — same composed state TestSVGPattern.tile arrives in.
    const segments = identitySegments.map(seg => {
      // Identity bbox: x ∈ [1, 3], y ∈ [0, 7]. Center (2, 3.5).
      // 180° around (2, 3.5): (x, y) → (4 - x, 7 - y).
      // mirrorV around (2, 3.5): (x, y) → (x, 7 - y).
      // Composed (mirrorV ∘ 180°): (x, y) → (4 - x, 7 - (7 - y)) = (4 - x, y).
      // That's mirrorH. So segments are at mirrorH of identity.
      const ms: PathSegment = { kind: 'line',
        start: [4 - seg.start[0], seg.start[1]],
        end: [4 - seg.end[0], seg.end[1]] };
      return ms;
    });
    const bb = { cellX: 1, cellY: 0, cellWidth: 2, cellHeight: 7 };
    return { id: 'svg_asym', segments, identitySegments, color: WHITE,
      rotation: 180, mirrorV: true, ...bb };
  }

  test('four rotations return to the loaded state (no mirror loss)', () => {
    const svg = makeRotatedMirrored();
    let r = svg;
    for (let i = 0; i < 4; i++) r = rotateSVG90CW(r);
    // rotation cycles 180 → 270 → 0 → 90 → 180. After 4 rotations the
    // segments must match the starting (mirrored) state segment-by-
    // segment. Pre-fix the mirror gets dropped on the 1st rotation and
    // never re-applied, so the segments diverge from `svg.segments`.
    expect(r.segments.length).toBe(svg.segments.length);
    for (let i = 0; i < svg.segments.length; i++) {
      const o = svg.segments[i];
      const n = r.segments[i];
      expect(n.start[0]).toBeCloseTo(o.start[0], 9);
      expect(n.start[1]).toBeCloseTo(o.start[1], 9);
      expect(n.end[0]).toBeCloseTo(o.end[0], 9);
      expect(n.end[1]).toBeCloseTo(o.end[1], 9);
    }
  });

  test('a single rotation applied to the loaded state matches a fresh mirror-then-rotate', () => {
    // Reference: the "canonical" state after one rotation is what
    // mirrorSVG would produce if you re-mirrored from identity and then
    // rotated. rotateSVG90CW must land on the same segments.
    const svg = makeRotatedMirrored();
    const rotated = rotateSVG90CW(svg);
    // Reference segments: identitySegments mirrored on V, then rotated
    // 270° (curRot 180 + 90) around the identity bbox center.
    const cx = 1 + 2 / 2; // 2
    const cy = 0 + 7 / 2; // 3.5
    const mirrorV = (p: [number, number]): [number, number] => [p[0], 2 * cy - p[1]];
    const rot90CW = (p: [number, number]): [number, number] => [cx - (p[1] - cy), cy + (p[0] - cx)];
    const transformed = svg.identitySegments!.map(seg => {
      let s = mirrorV(seg.start as [number, number]);
      let e = mirrorV(seg.end as [number, number]);
      for (let i = 0; i < 3; i++) { s = rot90CW(s); e = rot90CW(e); }
      return { kind: 'line' as const, start: s, end: e };
    });
    for (let i = 0; i < transformed.length; i++) {
      const o = transformed[i];
      const n = rotated.segments[i];
      expect(n.start[0]).toBeCloseTo(o.start[0], 9);
      expect(n.start[1]).toBeCloseTo(o.start[1], 9);
      expect(n.end[0]).toBeCloseTo(o.end[0], 9);
      expect(n.end[1]).toBeCloseTo(o.end[1], 9);
    }
  });
});
