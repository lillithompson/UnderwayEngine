import {
  clampPanOffset,
  COVER_FRAMING,
  coverDrawSize,
  coverImageRect,
  cropRatioValue,
  effectiveFraming,
  FRAMING_DEFAULTS,
  resolveFraming,
  straightenCoverScale,
  tileGeometry,
} from '@/engine/imageFraming';
import { generateCompositionSVGCore } from '@/engine/compositionSVGCore';
import { imageContentRect } from '../formats/svgImageGeometry';
import { ImageObject } from '@/engine/types';
import { readFileSync } from 'fs';
import { join } from 'path';

// Framing geometry are engine-only pure helpers, exercised here directly; the
// mode-by-mode SVG output goes through generateCompositionSVGCore.

describe('effectiveFraming — an absent record is plain cover', () => {
  test('no framing resolves to COVER_FRAMING, not the design defaults', () => {
    const r = effectiveFraming(undefined);
    expect(r.mode).toBe('fill');
    // The one field COVER_FRAMING pins: 100%, so a node that has never been
    // near the Crop bar is not silently zoomed to the bar's 130% default.
    expect(r.zoom).toBe(1);
    expect(r.zoom).not.toBe(FRAMING_DEFAULTS.zoom);
  });

  test('a record present is resolved exactly as resolveFraming does', () => {
    const f = { mode: 'crop' as const, angle: 12 };
    expect(effectiveFraming(f)).toEqual(resolveFraming(f));
  });

  test('COVER_FRAMING is plain cover: uniform scale, nothing cropped off a matching frame', () => {
    const r = effectiveFraming(COVER_FRAMING);
    // A 2:1 bitmap in a 2:1 frame: the cover rect IS the frame, so a picture
    // placed at its own ratio is untouched by the framing.
    const rect = coverImageRect(20, 10, 2, r.zoom);
    expect(rect).toEqual({ x: 0, y: 0, w: 20, h: 10 });
  });
});

describe('resolveFraming', () => {
  test('fills unset fields from the design defaults', () => {
    const r = resolveFraming({ mode: 'fill' });
    expect(r).toMatchObject({
      mode: 'fill',
      zoom: FRAMING_DEFAULTS.zoom,
      margin: FRAMING_DEFAULTS.margin,
      ratio: 'square',
      angle: 0,
      tileScale: FRAMING_DEFAULTS.tileScale,
      tileGap: FRAMING_DEFAULTS.tileGap,
      offsetX: 0,
      offsetY: 0,
    });
  });

  test('clamps zoom, angle and tileScale to their ranges', () => {
    const r = resolveFraming({ mode: 'crop', zoom: 9, angle: 200, tileScale: 5 });
    expect(r.zoom).toBe(3);
    expect(r.angle).toBe(45);
    expect(r.tileScale).toBe(1);
    expect(resolveFraming({ mode: 'crop', angle: -90 }).angle).toBe(-45);
  });
});

describe('coverDrawSize', () => {
  test('a same-aspect bitmap at scale 1 is exactly the frame', () => {
    // 100×80 frame, 5:4 bitmap → cover is the frame itself.
    expect(coverDrawSize(100, 80, 100 / 80, 1)).toEqual({ w: 100, h: 80 });
  });

  test('a wide bitmap covers by height and overflows in width', () => {
    // 100×80 frame, 2:1 bitmap → height fills (80), width = 160 (overflow 60).
    const s = coverDrawSize(100, 80, 2, 1);
    expect(s.h).toBeCloseTo(80, 6);
    expect(s.w).toBeCloseTo(160, 6);
  });

  test('a tall bitmap covers by width and overflows in height', () => {
    // 100×80 frame, 1:2 bitmap → width fills (100), height = 200 (overflow 120).
    const s = coverDrawSize(100, 80, 0.5, 1);
    expect(s.w).toBeCloseTo(100, 6);
    expect(s.h).toBeCloseTo(200, 6);
  });

  test('scale enlarges both dimensions uniformly', () => {
    const one = coverDrawSize(100, 80, 2, 1);
    const two = coverDrawSize(100, 80, 2, 2);
    expect(two.w).toBeCloseTo(one.w * 2, 6);
    expect(two.h).toBeCloseTo(one.h * 2, 6);
  });
});

describe('coverImageRect', () => {
  test('same-aspect, no offset is exactly the frame', () => {
    expect(coverImageRect(100, 80, 100 / 80, 1)).toEqual({ x: 0, y: 0, w: 100, h: 80 });
  });

  test('a wide bitmap centres its overflow at offset 0', () => {
    // 2:1 into 100×80 → 160×80, centred → x = -30 (30px hidden each side).
    const r = coverImageRect(100, 80, 2, 1);
    expect(r).toMatchObject({ w: 160, h: 80 });
    expect(r.x).toBeCloseTo(-30, 6);
    expect(r.y).toBeCloseTo(0, 6);
  });

  test('offset pans within the overflow and is clamped to the edge', () => {
    // Overflow is 60 wide → range ±30. A +20 pan slides the rect right to -10.
    expect(coverImageRect(100, 80, 2, 1, 20, 0).x).toBeCloseTo(-10, 6);
    // A +999 pan clamps at the right edge (x = 0, left edge of bitmap shown).
    expect(coverImageRect(100, 80, 2, 1, 999, 0).x).toBeCloseTo(0, 6);
    // The tight (height) axis has no slack, so its offset is pinned at 0.
    expect(coverImageRect(100, 80, 2, 1, 0, 50).y).toBeCloseTo(0, 6);
  });
});

describe('clampPanOffset', () => {
  test('limits each axis to half its overflow', () => {
    // 2:1 into 100×80 → 160×80: width overflow 60 (range ±30), no height slack.
    expect(clampPanOffset(100, 80, 2, 1, 25, 25)).toEqual({ offsetX: 25, offsetY: 0 });
    expect(clampPanOffset(100, 80, 2, 1, 100, -100)).toEqual({ offsetX: 30, offsetY: 0 });
  });

  test('a same-aspect cover at scale 1 can not pan at all', () => {
    expect(clampPanOffset(100, 80, 100 / 80, 1, 40, 40)).toEqual({ offsetX: 0, offsetY: 0 });
  });
});

describe('straightenCoverScale', () => {
  test('no rotation needs no extra scale', () => {
    expect(straightenCoverScale(0, 100, 100)).toBeCloseTo(1, 6);
  });

  test('a square at 45° needs √2 to avoid empty corners', () => {
    expect(straightenCoverScale(45, 100, 100)).toBeCloseTo(Math.SQRT2, 6);
  });

  test('grows monotonically from 0 to 45° and is symmetric', () => {
    const a = straightenCoverScale(10, 120, 80);
    const b = straightenCoverScale(30, 120, 80);
    expect(b).toBeGreaterThan(a);
    expect(a).toBeGreaterThan(1);
    expect(straightenCoverScale(-30, 120, 80)).toBeCloseTo(b, 6);
  });
});

describe('tileGeometry', () => {
  test('the grid covers the frame (ceil of frame / pitch)', () => {
    const g = tileGeometry(100, 60, 1, 0.5, 0);
    expect(g.cols * g.stepX).toBeGreaterThanOrEqual(100);
    expect(g.rows * g.stepY).toBeGreaterThanOrEqual(60);
  });

  test('a bigger Size means bigger tiles and fewer columns', () => {
    const small = tileGeometry(100, 100, 1, 0.2, 0);
    const big = tileGeometry(100, 100, 1, 0.9, 0);
    expect(big.tileW).toBeGreaterThan(small.tileW);
    expect(big.cols).toBeLessThan(small.cols);
  });

  test('the gap widens the pitch without changing the tile size', () => {
    const noGap = tileGeometry(100, 100, 1, 0.5, 0);
    const gap = tileGeometry(100, 100, 1, 0.5, 4);
    expect(gap.tileW).toBeCloseTo(noGap.tileW, 6);
    expect(gap.stepX).toBeCloseTo(noGap.stepX + 4, 6);
  });

  test('tiles preserve the bitmap aspect', () => {
    const g = tileGeometry(100, 100, 2, 0.5, 0); // 2:1 bitmap
    expect(g.tileW / g.tileH).toBeCloseTo(2, 6);
  });
});

describe('cropRatioValue', () => {
  test('named ratios resolve to their aspect, free follows the frame', () => {
    expect(cropRatioValue('square', 1.7)).toBe(1);
    expect(cropRatioValue('fourFive', 1.7)).toBeCloseTo(4 / 5, 6);
    expect(cropRatioValue('sixteenNine', 1.7)).toBeCloseTo(16 / 9, 6);
    expect(cropRatioValue('free', 1.7)).toBe(1.7);
  });
});

// ── SVG export end-to-end ────────────────────────────────────────────
function imageNode(extra: Partial<ImageObject>): ImageObject {
  return {
    id: 'img_1', imageId: 'blob_1', mimeType: 'image/png',
    pixelWidth: 40, pixelHeight: 40,
    cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 8,
    ...extra,
  };
}

async function svgFor(image: ImageObject): Promise<string> {
  const out = await generateCompositionSVGCore({
    name: 'c', figures: [], svgObjects: [], images: [image],
    imageBlobs: { blob_1: new Uint8Array([1, 2, 3]) },
    loadFigure: async () => null,
  });
  return out ?? '';
}

describe('composition SVG export — image framing', () => {
  test('an image with no framing record covers — it is never stretched', async () => {
    // The node's transform sets the FRAME; the framing says how the picture
    // sits in it. A record-less node draws the plain cover every image is born
    // with (COVER_FRAMING), so a 1:1 bitmap in a 10x8 frame is drawn 10 wide
    // and 10 tall, centred, and clipped by the frame — never squashed to 10x8
    // by the retired `preserveAspectRatio="none"` draw.
    const svg = await svgFor(imageNode({}));
    expect(svg).not.toContain('preserveAspectRatio="none"');
    expect(svg).toContain('preserveAspectRatio="xMidYMid slice"');
    const m = svg.match(/<image x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/);
    expect(m).not.toBeNull();
    const [x, y, w, h] = m!.slice(1).map(Number);
    expect(w).toBeCloseTo(h, 6);      // the bitmap keeps its own 1:1 ratio
    expect(x).toBeCloseTo(0, 6);      // width is the tight axis: nothing to centre
    // The frame is 8/10 of the drawn square tall, so half the overflow — a
    // tenth of the side — hangs off each of the top and bottom edges.
    expect(y).toBeCloseTo(-w / 10, 6);
  });

  test('a record-less image and an explicit plain-cover one draw identically', async () => {
    // The whole back-compat claim in one assertion: seeding COVER_FRAMING at
    // birth changed nothing about how an older, record-less node renders.
    const bare = await svgFor(imageNode({}));
    const covered = await svgFor(imageNode({ framing: { mode: 'fill', zoom: 1 } }));
    expect(bare).toEqual(covered);
  });

  test('Fill covers with a slice viewport', async () => {
    const svg = await svgFor(imageNode({ framing: { mode: 'fill', zoom: 1 } }));
    expect(svg).toContain('preserveAspectRatio="xMidYMid slice"');
    expect(svg).not.toContain('preserveAspectRatio="none"');
  });

  test('Fit letterboxes with a meet viewport inset by the margin', async () => {
    const svg = await svgFor(imageNode({ framing: { mode: 'fit', margin: 1 } }));
    expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
  });

  test('Crop rotates the cover viewport by the straighten angle', async () => {
    const svg = await svgFor(imageNode({ framing: { mode: 'crop', angle: 12 } }));
    expect(svg).toMatch(/rotate\(12 /);
    expect(svg).toContain('preserveAspectRatio="xMidYMid slice"');
  });

  test('Tile emits a repeating pattern', async () => {
    const svg = await svgFor(imageNode({ framing: { mode: 'tile', tileScale: 0.5, tileGap: 0 } }));
    expect(svg).toContain('<pattern');
    expect(svg).toContain('patternUnits="userSpaceOnUse"');
  });
});

describe('nothing draws an image by stretching it onto its frame', () => {
  // Three readers answer "where do this bitmap's pixels go": the DOM preview
  // (the editor package's NodeLayer), the SVG export (compositionSVGCore,
  // covered end-to-end above) and the world-geometry reader templates trace
  // through (svgImageGeometry). Each one used to carry its own `if (!framing)`
  // escape hatch onto a non-uniform bbox scale. They go through the engine's
  // one `effectiveFraming` now, so they cannot drift on what an unframed
  // image looks like — and none of them can squash a picture.
  const src = (...parts: string[]) =>
    readFileSync(join(__dirname, '..', ...parts), 'utf8');

  test('the DOM preview has no object-fit: fill branch left', () => {
    const layer = src('components', 'NodeLayer.tsx');
    expect(layer).toContain('effectiveFraming(node.framing)');
    // `objectFit: 'fill'` is the CSS spelling of the deform — the one value
    // that scales each axis independently. contain/cover are fine.
    expect(layer).not.toContain("objectFit: 'fill'");
  });

  test('the world-geometry reader frames an unframed image instead of stretching it', () => {
    expect(src('formats', 'svgImageGeometry.ts')).toContain('effectiveFraming(img.framing)');
    // A 2:1 bitmap in a square box: the rect it draws into keeps 2:1 and
    // hangs off the sides, rather than becoming the square.
    const rect = imageContentRect({
      cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10,
      pixelWidth: 40, pixelHeight: 20,
    })!;
    expect(rect.w / rect.h).toBeCloseTo(2, 9);
    expect(rect.h).toBeCloseTo(10, 9);
    expect(rect).toEqual(imageContentRect({
      cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 10,
      pixelWidth: 40, pixelHeight: 20, framing: { mode: 'fill', zoom: 1 },
    }));
  });
});
