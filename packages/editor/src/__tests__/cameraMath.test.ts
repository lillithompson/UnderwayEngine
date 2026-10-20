import { buildShapeSVGObject } from '@/engine/shapePresets';
import { Camera, ImageObject, makeViewport, PaintObject, SVGObject, TextObject } from '@/engine/types';
import {
  BASE_CELL_PX,
  cameraMatrixInto,
  cellBboxAroundPoints,
  EDITOR_MAX_ZOOM,
  EDITOR_MIN_ZOOM,
  FRAME_CONTENT_FIT,
  FRAME_OBJECT_FIT,
  groupCellBbox,
  WORLD_CELLS,
  clampZoom,
  computeFrameCellBboxCamera,
  computeCellsWideCamera,
  computeFrameContentCamera,
  computeInitialCamera,
  computeOpeningCamera,
  pairAngleDeg,
  panBy,
  pinchCamera,
  pxPerCell,
  screenToWorld,
  shortestAngleDeltaDeg,
  visibleWorldRect,
  wheelZoomFactor,
  worldLayerTransform,
  worldToScreen,
  zoomAboutPoint,
} from '../cameraMath';

const viewport = makeViewport(390, 720);

describe('screenToWorld / worldToScreen', () => {
  test('are exact inverses across cameras', () => {
    const cameras = [
      { offsetX: 0, offsetY: 0, zoom: 1 },
      { offsetX: 42.5, offsetY: -117, zoom: 0.8 },
      { offsetX: -300, offsetY: 260, zoom: 5.25 },
    ];
    const points = [
      { x: 0, y: 0 },
      { x: 195, y: 360 },
      { x: 389, y: 719 },
      { x: 17.3, y: 401.9 },
    ];
    for (const camera of cameras) {
      for (const p of points) {
        const cell = screenToWorld(p.x, p.y, camera, viewport);
        const back = worldToScreen(cell.cellX, cell.cellY, camera, viewport);
        expect(back.x).toBeCloseTo(p.x, 9);
        expect(back.y).toBeCloseTo(p.y, 9);
      }
    }
  });

  test('identity camera maps the viewport center to cell (16, 16)', () => {
    // uv (0.5, 0.5) — the middle of the canonical 32-cell box — sits at
    // the viewport center when offset = 0, zoom = 1.
    const cell = screenToWorld(viewport.width / 2, viewport.height / 2,
      { offsetX: 0, offsetY: 0, zoom: 1 }, viewport);
    expect(cell.cellX).toBeCloseTo(WORLD_CELLS / 2, 9);
    expect(cell.cellY).toBeCloseTo(WORLD_CELLS / 2, 9);
  });

  test('visibleWorldRect: the identity camera shows the full 32-cell width, centred vertically', () => {
    const rect = visibleWorldRect({ offsetX: 0, offsetY: 0, zoom: 1 }, viewport);
    expect(rect.minX).toBeCloseTo(0, 9);
    expect(rect.maxX).toBeCloseTo(WORLD_CELLS, 9);
    // Vertically the view is as tall as its aspect makes it, about the middle.
    const halfV = (viewport.height / viewport.width) * (WORLD_CELLS / 2);
    expect(rect.minY).toBeCloseTo(WORLD_CELLS / 2 - halfV, 9);
    expect(rect.maxY).toBeCloseTo(WORLD_CELLS / 2 + halfV, 9);
  });
});

describe('worldLayerTransform', () => {
  test('matches worldToScreen for container-local child positions', () => {
    const camera = { offsetX: 33, offsetY: -80, zoom: 2.5 };
    const t = worldLayerTransform(camera, viewport);
    for (const [cellX, cellY] of [[0, 0], [16, 16], [32, 5.5]] as const) {
      const viaTransform = {
        x: t.translateX + cellX * BASE_CELL_PX * t.scale,
        y: t.translateY + cellY * BASE_CELL_PX * t.scale,
      };
      const direct = worldToScreen(cellX, cellY, camera, viewport);
      expect(viaTransform.x).toBeCloseTo(direct.x, 9);
      expect(viaTransform.y).toBeCloseTo(direct.y, 9);
    }
  });

  test('pxPerCell agrees with the transform scale', () => {
    const camera = { offsetX: 0, offsetY: 0, zoom: 3 };
    const t = worldLayerTransform(camera, viewport);
    expect(pxPerCell(camera, viewport)).toBeCloseTo(t.scale * BASE_CELL_PX, 9);
  });
});

describe('panBy', () => {
  test('shifts every screen mapping by exactly the pixel delta', () => {
    const camera = { offsetX: 10, offsetY: 20, zoom: 1.7 };
    const panned = panBy(camera, 25, -40);
    const before = worldToScreen(8, 12, camera, viewport);
    const after = worldToScreen(8, 12, panned, viewport);
    expect(after.x - before.x).toBeCloseTo(25, 9);
    expect(after.y - before.y).toBeCloseTo(-40, 9);
    expect(panned.zoom).toBe(camera.zoom);
  });
});

describe('zoomAboutPoint', () => {
  test('keeps the anchor world point fixed on screen', () => {
    const camera = { offsetX: -12, offsetY: 60, zoom: 1.2 };
    const anchor = { x: 100, y: 500 };
    const world = screenToWorld(anchor.x, anchor.y, camera, viewport);
    const zoomed = zoomAboutPoint(camera, viewport, anchor.x, anchor.y, 1.9);
    expect(zoomed.zoom).toBeCloseTo(1.2 * 1.9, 9);
    const back = worldToScreen(world.cellX, world.cellY, zoomed, viewport);
    expect(back.x).toBeCloseTo(anchor.x, 9);
    expect(back.y).toBeCloseTo(anchor.y, 9);
  });

  test('clamps zoom and still keeps the anchor fixed at the clamp', () => {
    const camera = { offsetX: 0, offsetY: 0, zoom: 1 };
    const anchor = { x: 30, y: 40 };
    const world = screenToWorld(anchor.x, anchor.y, camera, viewport);
    const maxed = zoomAboutPoint(camera, viewport, anchor.x, anchor.y, 1e9);
    expect(maxed.zoom).toBe(EDITOR_MAX_ZOOM);
    const back = worldToScreen(world.cellX, world.cellY, maxed, viewport);
    expect(back.x).toBeCloseTo(anchor.x, 6);
    expect(back.y).toBeCloseTo(anchor.y, 6);

    const minned = zoomAboutPoint(camera, viewport, anchor.x, anchor.y, 1e-9);
    expect(minned.zoom).toBe(EDITOR_MIN_ZOOM);
  });

  test('returns the same camera when already at the clamp', () => {
    const camera = { offsetX: 5, offsetY: 5, zoom: EDITOR_MAX_ZOOM };
    expect(zoomAboutPoint(camera, viewport, 10, 10, 2)).toBe(camera);
  });
});

describe('clampZoom / wheelZoomFactor', () => {
  test('clampZoom bounds', () => {
    expect(clampZoom(0)).toBe(EDITOR_MIN_ZOOM);
    expect(clampZoom(1e6)).toBe(EDITOR_MAX_ZOOM);
    expect(clampZoom(1)).toBe(1);
  });

  test('wheel deltas are symmetric: up then down returns to 1', () => {
    expect(wheelZoomFactor(120) * wheelZoomFactor(-120)).toBeCloseTo(1, 12);
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1); // scroll up = zoom in
  });
});

describe('pinchCamera', () => {
  const start = { offsetX: 14, offsetY: -33, zoom: 1.5 };

  test('spreading two pointers scales zoom by the distance ratio', () => {
    const a0 = { x: 150, y: 300 };
    const b0 = { x: 250, y: 300 };
    // Same midpoint, doubled distance.
    const a1 = { x: 100, y: 300 };
    const b1 = { x: 300, y: 300 };
    const out = pinchCamera(start, viewport, a0, b0, a1, b1);
    expect(out.zoom).toBeCloseTo(3.0, 9);
    // Midpoint world anchor unchanged.
    const world = screenToWorld(200, 300, start, viewport);
    const back = worldToScreen(world.cellX, world.cellY, out, viewport);
    expect(back.x).toBeCloseTo(200, 9);
    expect(back.y).toBeCloseTo(300, 9);
  });

  test('parallel translation pans without zooming', () => {
    const a0 = { x: 100, y: 200 };
    const b0 = { x: 200, y: 200 };
    const a1 = { x: 130, y: 250 };
    const b1 = { x: 230, y: 250 };
    const out = pinchCamera(start, viewport, a0, b0, a1, b1);
    expect(out.zoom).toBeCloseTo(start.zoom, 9);
    // The world point under the start midpoint lands at the new midpoint.
    const world = screenToWorld(150, 200, start, viewport);
    const back = worldToScreen(world.cellX, world.cellY, out, viewport);
    expect(back.x).toBeCloseTo(180, 9);
    expect(back.y).toBeCloseTo(250, 9);
  });

  test('combined spread + travel anchors the start midpoint to the new midpoint', () => {
    const a0 = { x: 120, y: 320 };
    const b0 = { x: 220, y: 400 };
    const a1 = { x: 90, y: 250 };
    const b1 = { x: 330, y: 430 };
    const out = pinchCamera(start, viewport, a0, b0, a1, b1);
    const world = screenToWorld((a0.x + b0.x) / 2, (a0.y + b0.y) / 2, start, viewport);
    const back = worldToScreen(world.cellX, world.cellY, out, viewport);
    expect(back.x).toBeCloseTo((a1.x + b1.x) / 2, 9);
    expect(back.y).toBeCloseTo((a1.y + b1.y) / 2, 9);
  });

  test('degenerate zero start distance keeps zoom stable', () => {
    const p = { x: 100, y: 100 };
    const out = pinchCamera(start, viewport, p, p, { x: 110, y: 100 }, { x: 130, y: 100 });
    expect(out.zoom).toBeCloseTo(start.zoom, 9);
  });
});

describe('computeInitialCamera', () => {
  test('fits and centers a 3:4 page in a portrait viewport', () => {
    const camera = computeInitialCamera(viewport, 0.75);
    const pageH = WORLD_CELLS / 0.75;
    const topLeft = worldToScreen(0, 0, camera, viewport);
    const bottomRight = worldToScreen(WORLD_CELLS, pageH, camera, viewport);
    // Fully on screen…
    expect(topLeft.x).toBeGreaterThanOrEqual(0);
    expect(topLeft.y).toBeGreaterThanOrEqual(0);
    expect(bottomRight.x).toBeLessThanOrEqual(viewport.width);
    expect(bottomRight.y).toBeLessThanOrEqual(viewport.height);
    // …and centered.
    expect((topLeft.x + bottomRight.x) / 2).toBeCloseTo(viewport.width / 2, 6);
    expect((topLeft.y + bottomRight.y) / 2).toBeCloseTo(viewport.height / 2, 6);
  });

  test('degenerate viewport falls back to the identity camera', () => {
    expect(computeInitialCamera(makeViewport(0, 0), 1)).toEqual({ offsetX: 0, offsetY: 0, zoom: 1 });
  });
});

describe('computeFrameCellBboxCamera', () => {
  const bbox = { cellX: 8, cellY: 10, cellWidth: 4, cellHeight: 4 };

  /** The bbox's on-screen rect under `camera`. */
  const screenRect = (camera: ReturnType<typeof computeFrameCellBboxCamera>) => {
    const tl = worldToScreen(bbox.cellX, bbox.cellY, camera, viewport);
    const br = worldToScreen(
      bbox.cellX + bbox.cellWidth, bbox.cellY + bbox.cellHeight, camera, viewport);
    return { ...tl, width: br.x - tl.x, height: br.y - tl.y, right: br.x, bottom: br.y };
  };

  test('fills the requested share of the viewport, centered', () => {
    const r = screenRect(computeFrameCellBboxCamera(viewport, bbox, 1));
    // Square bbox in a portrait viewport → width is the binding axis.
    expect(r.width).toBeCloseTo(viewport.width, 6);
    expect((r.x + r.right) / 2).toBeCloseTo(viewport.width / 2, 6);
    expect((r.y + r.bottom) / 2).toBeCloseTo(viewport.height / 2, 6);
  });

  test('defaults to the object fit, leaving a margin', () => {
    const wide = screenRect(computeFrameCellBboxCamera(viewport, bbox, 1));
    const snug = screenRect(computeFrameCellBboxCamera(viewport, bbox));
    expect(snug.width).toBeCloseTo(wide.width * FRAME_OBJECT_FIT, 6);
    expect(snug.x).toBeGreaterThan(0);
  });
});

describe('computeFrameContentCamera', () => {
  const path = (id: string, x: number, y: number, w: number, h: number): SVGObject => ({
    id,
    segments: [{ kind: 'line', start: [x, y], end: [x + w, y + h] }],
    color: { r: 0, g: 0, b: 0 },
    cellX: x, cellY: y, cellWidth: w, cellHeight: h,
  });
  const scene = (svgObjects: SVGObject[], texts: TextObject[] = []) => ({
    figures: [], svgObjects, images: [], texts, groups: [],
  });

  test('puts every mark in view, as close as the screen allows', () => {
    // Two strokes in one corner of the page: the union is what fills the
    // screen — the 32-cell page rect is not what is being framed.
    const camera = computeFrameContentCamera(
      scene([path('svg_1', 4, 4, 4, 2), path('svg_2', 6, 5, 2, 3)]), viewport)!;
    // Union of the two strokes: cells (4,4)–(8,8).
    const tl = worldToScreen(4, 4, camera, viewport);
    const br = worldToScreen(8, 8, camera, viewport);
    // It fills the viewport but for a margin, and sits centered in what's left.
    expect(br.x - tl.x).toBeCloseTo(FRAME_CONTENT_FIT * viewport.width, 6);
    expect(tl.x).toBeCloseTo((viewport.width - (br.x - tl.x)) / 2, 6);
    // Everything is on screen…
    expect(tl.y).toBeGreaterThan(0);
    expect(br.y).toBeLessThan(viewport.height);
    // …and nothing beyond the content is: the whole page would not fit.
    const pageBr = worldToScreen(WORLD_CELLS, WORLD_CELLS, camera, viewport);
    expect(pageBr.x).toBeGreaterThan(viewport.width);
  });

  test('leaves a margin rather than running flush to the edges', () => {
    // A drawing touching the rim reads as cropped even when all of it is
    // there — and half a stroke's width really would be.
    const camera = computeFrameContentCamera(scene([path('svg_1', 4, 4, 8, 8)]), viewport)!;
    const tl = worldToScreen(4, 4, camera, viewport);
    const br = worldToScreen(12, 12, camera, viewport);
    expect(tl.x).toBeGreaterThan(0);
    expect(br.x).toBeLessThan(viewport.width);
  });

  test('tile patterns count — a page stamped only from tiles still frames', () => {
    // The regression: FramableScene omitted patternObjects, so a file whose
    // whole content was tile stamps opened on the bare page fit (and Frame
    // Page found "nothing drawn") — the engine's bbox takes patterns, the
    // app just never passed them.
    const pattern = {
      id: 'pat_1', cellX: 10, cellY: 20, cellWidth: 8, cellHeight: 4,
      cols: 4, rows: 2, cells: new Array(8).fill(null),
    };
    const camera = computeFrameContentCamera(
      { ...scene([]), patternObjects: [pattern] }, viewport)!;
    expect(camera).not.toBeNull();
    // The pattern's own center lands at the screen's center.
    const c = worldToScreen(14, 22, camera, viewport);
    expect(c.x).toBeCloseTo(viewport.width / 2, 6);
    // …and without it the same scene frames nothing.
    expect(computeFrameContentCamera(scene([]), viewport)).toBeNull();
  });

  test('measures the inked segments, not the node rect', () => {
    // A node whose stored bbox is the whole page but whose stroke is a corner
    // (the seeded squiggle before the bbox repair) frames on the stroke.
    const stale = { ...path('svg_1', 4, 4, 4, 4), cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32 };
    const camera = computeFrameContentCamera(scene([stale]), viewport)!;
    // The STROKE's middle (cell 6) is what lands at the middle of the screen;
    // the node rect's middle (cell 16) would be far off it.
    expect(worldToScreen(6, 6, camera, viewport).x).toBeCloseTo(viewport.width / 2, 6);
  });

  test('frames into the usable box, clear of the chrome over the canvas', () => {
    // The regression: the canvas is full-bleed under the title band and
    // toolbar, so framing against the whole viewport put the top of a tall
    // object behind them. A tall bbox must clear the inset.
    const inset = { top: 94, bottom: 24 };
    const tall = scene([path('svg_1', 12, 2, 4, 28)]);
    const camera = computeFrameContentCamera(tall, viewport, inset)!;
    const tl = worldToScreen(12, 2, camera, viewport);
    const br = worldToScreen(16, 30, camera, viewport);
    expect(tl.y).toBeGreaterThan(inset.top);
    expect(br.y).toBeLessThan(viewport.height - inset.bottom);
    // Centered in the usable box, not in the viewport: its middle sits below
    // the viewport's, pushed down by the chrome above it.
    const middle = (tl.y + br.y) / 2;
    expect(middle).toBeCloseTo((inset.top + viewport.height - inset.bottom) / 2, 6);
    expect(middle).toBeGreaterThan(viewport.height / 2);
  });

  test('an inset that swallows the canvas still returns a usable camera', () => {
    const camera = computeFrameContentCamera(
      scene([path('svg_1', 4, 4, 4, 4)]), viewport, { top: 9000, bottom: 9000 })!;
    expect(Number.isFinite(camera.zoom)).toBe(true);
    expect(camera.zoom).toBeGreaterThanOrEqual(EDITOR_MIN_ZOOM);
  });

  test('an empty canvas has nothing to frame', () => {
    expect(computeFrameContentCamera(scene([]), viewport)).toBeNull();
  });

  // ── Brush marks count as marks ────────────────────────────────────
  // Brush strokes are paint ISLAND scene nodes now, and an island's bbox IS
  // its ink bounds (bbox == contentRect at creation), so the engine content
  // bbox sees them like any other node — the framing bug this section
  // guarded against (paint invisible to the node bbox) can only come back
  // by dropping paintObjects from the measured fields.

  /** A minimal inked island whose bbox spans (x, y)–(x+w, y+h) — framing
   *  reads only the bbox, so one solid texel is content enough. */
  const island = (x: number, y: number, w: number, h: number): PaintObject => {
    const rgba = new Uint8Array(2 * 2 * 4);
    rgba[3] = 255;
    return {
      id: `pnt_${x}_${y}`,
      cellX: x, cellY: y, cellWidth: w, cellHeight: h,
      tiles: [{ x, y, widthCells: w, overlay: { cols: 2, rows: 2, rgba, blend: 'normal' } }],
      contentX: x, contentY: y, contentW: w, contentH: h,
    };
  };

  test('frames a page that holds nothing but brush marks', () => {
    const painted = { ...scene([]), paintObjects: [island(8, 8, 4, 4)] };
    const camera = computeFrameContentCamera(painted, viewport)!;
    expect(camera).not.toBeNull();
    // The island bbox — cells (8,8)–(12,12) — is what fills the screen.
    const tl = worldToScreen(8, 8, camera, viewport);
    const br = worldToScreen(12, 12, camera, viewport);
    expect(br.x - tl.x).toBeCloseTo(FRAME_CONTENT_FIT * viewport.width, 6);
  });

  test('brush marks outside the drawn objects are still brought into view', () => {
    // The historical bug: a stroke in one corner, paint in another, and the
    // zoom computed as if the paint weren't there — so it sat off screen.
    const painted = { ...scene([path('svg_1', 2, 2, 2, 2)]), paintObjects: [island(20, 20, 4, 4)] };
    const camera = computeFrameContentCamera(painted, viewport)!;
    const tl = worldToScreen(2, 2, camera, viewport);
    const br = worldToScreen(24, 24, camera, viewport);
    expect(tl.x).toBeGreaterThanOrEqual(0);
    expect(br.x).toBeLessThanOrEqual(viewport.width);
    // Union of stroke and island, not the stroke alone.
    expect(br.x - tl.x).toBeCloseTo(FRAME_CONTENT_FIT * viewport.width, 6);
  });

  test('a hidden island is not a mark', () => {
    // Hidden content must not drive the frame — same rule as every kind.
    const hiddenIsland = { ...island(24, 24, 4, 4), hidden: true };
    const base = scene([path('svg_1', 4, 4, 4, 4)]);
    const withoutIt = computeFrameContentCamera(base, viewport)!;
    expect(computeFrameContentCamera({ ...base, paintObjects: [hiddenIsland] }, viewport))
      .toEqual(withoutIt);
  });
});

describe('computeOpeningCamera — what a format frames when it opens', () => {
  const path = (x: number, y: number, w: number, h: number): SVGObject => ({
    id: 'svg_1',
    segments: [{ kind: 'line', start: [x, y], end: [x + w, y + h] }],
    color: { r: 0, g: 0, b: 0 },
    cellX: x, cellY: y, cellWidth: w, cellHeight: h,
  });
  const scene = (svgObjects: SVGObject[]) => ({
    figures: [], svgObjects, images: [], texts: [], groups: [],
  });
  const frame = { cellX: 4, cellY: 4, cellWidth: 24, cellHeight: 24 };

  test("a template's Focus rect wins over every fit: framed as the outline's double-tap frames it", () => {
    const focus = { cellX: 29.5, cellY: 20.75, cellWidth: 39.5, cellHeight: 50 };
    const inset = { top: 60, bottom: 120, left: 0, right: 0 };
    const framed = computeFrameCellBboxCamera(viewport, focus, FRAME_OBJECT_FIT, inset);
    // Over the frame fit (Adrift's), the page fit, and a cells-wide open alike.
    expect(computeOpeningCamera(viewport, {
      aspect: 1, initialFit: 'frame', frame, scene: scene([]), inset, focus,
    })).toEqual(framed);
    expect(computeOpeningCamera(viewport, { aspect: 1, inset, focus })).toEqual(framed);
    expect(computeOpeningCamera(viewport, { aspect: 1, cellsWide: 12, inset, focus })).toEqual(framed);
    // The focus is on screen whole, with the object fit's margin.
    const tl = worldToScreen(focus.cellX, focus.cellY, framed, viewport);
    const br = worldToScreen(focus.cellX + focus.cellWidth, focus.cellY + focus.cellHeight, framed, viewport);
    expect(tl.y).toBeGreaterThanOrEqual(inset.top);
    expect(br.y).toBeLessThanOrEqual(viewport.height - inset.bottom);
    expect(tl.x).toBeGreaterThanOrEqual(0);
    expect(br.x).toBeLessThanOrEqual(viewport.width);
  });

  test("a format's own rect frames the open: Creature's turn on its band", () => {
    // The band a Creature move may draw in — 8 grid squares by 6 of the
    // board's 12 (creatureGeometry) — framed as the outline's double-tap
    // frames a row, and ahead of every fit but a template's Focus.
    const fitRect = { cellX: 0, cellY: 24, cellWidth: 32, cellHeight: 24 };
    const inset = { top: 60, bottom: 120, left: 0, right: 0 };
    const framed = computeFrameCellBboxCamera(viewport, fitRect, FRAME_OBJECT_FIT, inset);
    expect(computeOpeningCamera(viewport, { aspect: 2 / 3, inset, fitRect })).toEqual(framed);
    // Over the page fit, a cells-wide open and a named node alike…
    expect(computeOpeningCamera(viewport, {
      aspect: 2 / 3, inset, fitRect, cellsWide: 12, scene: scene([path(4, 4, 4, 4)]),
      fitNode: { cellX: 30, cellY: 8, cellWidth: 43, cellHeight: 57 },
    })).toEqual(framed);
    // …and under a template's Focus, which is a choice made on the page
    // itself.
    const focus = { cellX: 29.5, cellY: 20.75, cellWidth: 39.5, cellHeight: 50 };
    expect(computeOpeningCamera(viewport, { aspect: 2 / 3, inset, fitRect, focus }))
      .toEqual(computeFrameCellBboxCamera(viewport, focus, FRAME_OBJECT_FIT, inset));
    // The band is on screen whole, inside the chrome.
    expect(shows(framed, fitRect, inset)).toBe(true);
    // Nothing drawn outside the band widens the view back out to it: the
    // turn before it is veiled, not something to frame.
    expect(computeOpeningCamera(viewport, {
      aspect: 2 / 3, inset, fitRect, scene: scene([path(2, 2, 6, 6)]),
    })).toEqual(framed);
  });

  test("a format's named node is framed on every open, ahead of the fits and under the focus", () => {
    // Adrift opens on its Mask (canvas.initialFitName, resolved by the shell
    // to the node's bbox): the object fit on that box, whatever the
    // initialFit says — and on a reopen too, where no template focus exists.
    const fitNode = { cellX: 30, cellY: 8, cellWidth: 43, cellHeight: 57 };
    const inset = { top: 60, bottom: 120, left: 0, right: 0 };
    const framed = computeFrameCellBboxCamera(viewport, fitNode, FRAME_OBJECT_FIT, inset);
    expect(computeOpeningCamera(viewport, { aspect: 1, inset, fitNode, scene: scene([]) })).toEqual(framed);
    expect(computeOpeningCamera(viewport, {
      aspect: 1, initialFit: 'frame', frame, inset, fitNode, scene: scene([]),
    })).toEqual(framed);
    // A template's Focus and a cells-wide open still come first.
    const focus = { cellX: 29.5, cellY: 20.75, cellWidth: 39.5, cellHeight: 50 };
    expect(computeOpeningCamera(viewport, { aspect: 1, inset, fitNode, focus }))
      .toEqual(computeFrameCellBboxCamera(viewport, focus, FRAME_OBJECT_FIT, inset));
    expect(computeOpeningCamera(viewport, { aspect: 1, cellsWide: 12, fitNode }))
      .toEqual(computeCellsWideCamera(viewport, 1, 12, 0));
  });

  test('by default it opens on the page, whatever is drawn ON it', () => {
    expect(computeOpeningCamera(viewport, { aspect: 1, scene: scene([path(4, 4, 4, 4)]) }))
      .toEqual(computeInitialCamera(viewport, 1));
    // An empty page, and no scene at all, open the same way.
    expect(computeOpeningCamera(viewport, { aspect: 1, scene: scene([]) }))
      .toEqual(computeInitialCamera(viewport, 1));
    expect(computeOpeningCamera(viewport, { aspect: 1 })).toEqual(computeInitialCamera(viewport, 1));
  });

  /** Is the whole cell rect on screen, inside the inset's usable box? */
  const shows = (camera: Camera, rect: { cellX: number; cellY: number; cellWidth: number; cellHeight: number }, inset = { top: 0, bottom: 0, left: 0, right: 0 }) => {
    const tl = worldToScreen(rect.cellX, rect.cellY, camera, viewport);
    const br = worldToScreen(rect.cellX + rect.cellWidth, rect.cellY + rect.cellHeight, camera, viewport);
    return tl.x >= inset.left - 1e-6 && tl.y >= inset.top - 1e-6
      && br.x <= viewport.width - inset.right + 1e-6 && br.y <= viewport.height - inset.bottom + 1e-6;
  };
  const page = { cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32 };

  test('content drawn PAST the page reopens in view, with the page still there', () => {
    // Zoom out, draw off the right edge, close: the page fit alone would
    // reopen with that work off screen, as though the page were untouched.
    const off = { cellX: 36, cellY: 10, cellWidth: 10, cellHeight: 6 };
    const drawn = scene([path(4, 4, 4, 4), path(off.cellX, off.cellY, off.cellWidth, off.cellHeight)]);
    const camera = computeOpeningCamera(viewport, { aspect: 1, scene: drawn });
    expect(camera).not.toEqual(computeInitialCamera(viewport, 1));
    expect(shows(camera, off)).toBe(true);
    expect(shows(camera, page)).toBe(true);
    // The default view stays the anchor: zoomed out from it, not re-centred on the stroke alone.
    expect(camera.zoom).toBeLessThan(computeInitialCamera(viewport, 1).zoom);
  });

  test('the widening respects the chrome inset — the spilled work is not under the toolbar', () => {
    const inset = { top: 94, bottom: 120, left: 0, right: 0 };
    const off = { cellX: 8, cellY: -14, cellWidth: 6, cellHeight: 6 };
    const camera = computeOpeningCamera(viewport, {
      aspect: 1, scene: scene([path(off.cellX, off.cellY, off.cellWidth, off.cellHeight)]), inset,
    });
    expect(shows(camera, off, inset)).toBe(true);
    expect(shows(camera, page, inset)).toBe(true);
  });

  test("the other fits are the view on purpose — a 'frame' or cells-wide open never widens", () => {
    // Adrift's word bank sits OUTSIDE its board by design, and a cells-wide
    // open is a chosen working scale: content beyond either is expected there,
    // not lost work. Only the page fit widens.
    const off = { cellX: 40, cellY: 2, cellWidth: 4, cellHeight: 4 };
    const drawn = scene([path(off.cellX, off.cellY, off.cellWidth, off.cellHeight)]);
    expect(computeOpeningCamera(viewport, { aspect: 1, initialFit: 'frame', frame, scene: drawn }))
      .toEqual(computeFrameCellBboxCamera(viewport, frame, FRAME_OBJECT_FIT));
    expect(computeOpeningCamera(viewport, { aspect: 1, cellsWide: 12, scene: drawn }))
      .toEqual(computeCellsWideCamera(viewport, 1, 12, 0));
  });

  test("'content' opens on the marks, exactly as Frame Page does", () => {
    // The complaint this answers: a squiggle in one corner of an otherwise
    // empty page opened small and adrift, because the page was what got fit.
    const drawn = scene([path(4, 4, 6, 6)]);
    const inset = { top: 94, bottom: 24 };
    const camera = computeOpeningCamera(viewport, {
      aspect: 1, initialFit: 'content', scene: drawn, inset,
    });
    // The same camera the Outline header's Frame Page gives, chrome and all.
    expect(camera).toEqual(computeFrameContentCamera(drawn, viewport, inset));
    // The marks fill the screen rather than sitting inside a framed page.
    const tl = worldToScreen(4, 4, camera, viewport);
    const br = worldToScreen(10, 10, camera, viewport);
    expect(br.x - tl.x).toBeCloseTo(FRAME_CONTENT_FIT * viewport.width, 6);
    expect(tl.y).toBeGreaterThan(inset.top);
  });

  test("'content' with nothing drawn falls back to the page", () => {
    // A blank page has no marks to frame, and framing emptiness would zoom
    // to the clamp. Same fallback when the caller passes no scene at all.
    expect(computeOpeningCamera(viewport, { aspect: 1, initialFit: 'content', scene: scene([]) }))
      .toEqual(computeInitialCamera(viewport, 1));
    expect(computeOpeningCamera(viewport, { aspect: 1, initialFit: 'content' }))
      .toEqual(computeInitialCamera(viewport, 1));
  });

  test("'frame' without a scene frame opens on the config's frame rect, as the outline would frame it", () => {
    const camera = computeOpeningCamera(viewport, { aspect: 1, initialFit: 'frame', frame });
    expect(camera).toEqual(computeFrameCellBboxCamera(viewport, frame, FRAME_OBJECT_FIT));
    // The object fit leaves a margin: the frame's corner is inside the view.
    const tl = worldToScreen(frame.cellX, frame.cellY, camera, viewport);
    expect(tl.x).toBeGreaterThan(0);
  });

  // A page minted from a template carries the board its author drew, and
  // the drawing they put around it. The open must show the board — the
  // config's frame is where the built-in board sits, not this page's — and
  // show it exactly as double-tapping the frame row in the outline does.
  const framedScene = (
    board: { cellX: number; cellY: number; cellWidth: number; cellHeight: number },
    images: ImageObject[] = [],
    texts: TextObject[] = [],
  ) => ({
    figures: [],
    svgObjects: [{
      ...buildShapeSVGObject('svg_board', 'rect', board, { r: 0, g: 0, b: 0 }),
      isMask: true, groupId: 'g_frame',
    }],
    images,
    texts,
    groups: [{
      id: 'g_frame', name: 'Board', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 0 as const, mirrorH: false, mirrorV: false, isFrame: true as const,
    }],
  });
  const picture = (id: string, box: { cellX: number; cellY: number; cellWidth: number; cellHeight: number }, hidden?: boolean): ImageObject =>
    ({ id, imageId: 'blob_' + id, mimeType: 'image/png', pixelWidth: 10, pixelHeight: 10, ...box, ...(hidden ? { hidden } : {}) }) as ImageObject;
  const word = (id: string, box: { cellX: number; cellY: number; cellWidth: number; cellHeight: number }, groupId?: string): TextObject =>
    ({ id, content: id, ...box, ...(groupId ? { groupId } : {}) }) as unknown as TextObject;

  test("'frame' opens on the SCENE's frame when it has one — the outline's double-tap view of it", () => {
    const board = { cellX: 40, cellY: 40, cellWidth: 20, cellHeight: 20 };
    const inset = { top: 60, bottom: 34 };
    const camera = computeOpeningCamera(viewport, {
      aspect: 1, initialFit: 'frame', frame, scene: framedScene(board), inset,
    });
    // Exactly what onFrameObject computes for the frame row: the group's
    // bbox at the object fit inside the inset. The config's frame at (4, 4)
    // plays no part, and there is no widening.
    expect(camera).toEqual(computeFrameCellBboxCamera(viewport, board, FRAME_OBJECT_FIT, inset));
    expect(camera).toEqual(computeFrameCellBboxCamera(viewport, groupCellBbox(framedScene(board), 'g_frame')!, FRAME_OBJECT_FIT, inset));
  });

  test("words played onto the board widen the 'frame' open, as they widen the row's double-tap", () => {
    const board = { cellX: 40, cellY: 40, cellWidth: 20, cellHeight: 20 };
    const overhang = { cellX: 58, cellY: 45, cellWidth: 6, cellHeight: 2 };
    const scene = framedScene(board, [], [word('txt_in', overhang, 'g_frame'), word('txt_out', { cellX: 0, cellY: 0, cellWidth: 6, cellHeight: 2 })]);
    const camera = computeOpeningCamera(viewport, { aspect: 1, initialFit: 'frame', frame, scene });
    // The adopted word's overhang is in; the loose word at the origin is not.
    expect(camera).toEqual(computeFrameCellBboxCamera(viewport, {
      cellX: 40, cellY: 40, cellWidth: 24, cellHeight: 20,
    }));
  });

  test("a picture around the board does not pull the 'frame' open wider — the board is the view", () => {
    const board = { cellX: 40, cellY: 40, cellWidth: 20, cellHeight: 20 };
    const bottle = { cellX: 0, cellY: 5, cellWidth: 120, cellHeight: 90 };
    const camera = computeOpeningCamera(viewport, {
      aspect: 1, initialFit: 'frame', frame, scene: framedScene(board, [picture('img_bottle', bottle)]),
    });
    expect(camera).toEqual(computeFrameCellBboxCamera(viewport, board));
    // The board fills the object fit's share of the screen, centred.
    const tl = worldToScreen(board.cellX, board.cellY, camera, viewport);
    const br = worldToScreen(board.cellX + board.cellWidth, board.cellY + board.cellHeight, camera, viewport);
    expect((tl.x + br.x) / 2).toBeCloseTo(viewport.width / 2, 5);
    expect((tl.y + br.y) / 2).toBeCloseTo(viewport.height / 2, 5);
    expect(br.x - tl.x).toBeCloseTo(viewport.width * FRAME_OBJECT_FIT, 5);
  });

  test('groupCellBbox is the union of everything in the group and the groups under it', () => {
    const scene = {
      figures: [], images: [], paintObjects: [], patternObjects: [],
      svgObjects: [{ ...buildShapeSVGObject('svg_a', 'rect', { cellX: 10, cellY: 10, cellWidth: 4, cellHeight: 4 }, { r: 0, g: 0, b: 0 }), groupId: 'g_inner' }],
      texts: [word('txt_b', { cellX: 2, cellY: 20, cellWidth: 3, cellHeight: 1 }, 'g_outer'), word('txt_c', { cellX: 90, cellY: 90, cellWidth: 1, cellHeight: 1 })],
      groups: [
        { id: 'g_outer', name: 'o', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0 as const, mirrorH: false, mirrorV: false },
        { id: 'g_inner', name: 'i', parentGroupId: 'g_outer', translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0 as const, mirrorH: false, mirrorV: false },
      ],
    };
    expect(groupCellBbox(scene, 'g_outer')).toEqual({ cellX: 2, cellY: 10, cellWidth: 12, cellHeight: 11 });
    expect(groupCellBbox(scene, 'g_inner')).toEqual({ cellX: 10, cellY: 10, cellWidth: 4, cellHeight: 4 });
    expect(groupCellBbox(scene, 'g_empty')).toBeNull();
  });

  test("'frame' without a frame rect has nothing to fit, so the page it is", () => {
    expect(computeOpeningCamera(viewport, { aspect: 1, initialFit: 'frame' }))
      .toEqual(computeInitialCamera(viewport, 1));
  });

  test('a cells-wide open puts exactly that many GRID cells on the screen', () => {
    // Counted in the cells the user sees, not canonical page cells: at
    // level −1 a grid cell is half a canonical one, so 4 of them span 2.
    // Levels whose zoom is inside the clamp; the clamped case is its own test.
    for (const gridLevel of [-1, 0, 1, 2]) {
      const camera = computeCellsWideCamera(viewport, 8, 4, gridLevel);
      const left = screenToWorld(0, 0, camera, viewport);
      const right = screenToWorld(viewport.width, 0, camera, viewport);
      expect(right.cellX - left.cellX).toBeCloseTo(4 * 2 ** gridLevel, 6);
    }
  });

  test('a cells-wide open is centred on the page, like a page open', () => {
    const camera = computeCellsWideCamera(viewport, 8, 4, -1);
    const page = computeInitialCamera(viewport, 8);
    expect(camera.offsetX).toBe(page.offsetX);
    expect(camera.offsetY).toBe(page.offsetY);
    // Only the zoom differs — the page centre stays under the screen centre.
    const centre = worldToScreen(WORLD_CELLS / 2, WORLD_CELLS / 16, camera, viewport);
    expect(centre.x).toBeCloseTo(viewport.width / 2, 6);
    expect(centre.y).toBeCloseTo(viewport.height / 2, 6);
  });

  test('a cell count finer than the zoom clamp lands at the clamp', () => {
    // Not silently ignored, not past the limit: as close as it can get.
    expect(computeCellsWideCamera(viewport, 1, 0.01, 0).zoom).toBe(EDITOR_MAX_ZOOM);
    expect(computeCellsWideCamera(viewport, 1, 1e6, 0).zoom).toBe(EDITOR_MIN_ZOOM);
  });

  test('cellsWide overrides a fit — a fit and a cell size cannot both set zoom', () => {
    const camera = computeOpeningCamera(viewport, {
      aspect: 8, initialFit: 'content', scene: scene([path(4, 4, 6, 6)]), cellsWide: 4, gridLevel: -1,
    });
    expect(camera).toEqual(computeCellsWideCamera(viewport, 8, 4, -1));
  });

  test('no cellsWide (or a nonsense one) leaves the fit alone', () => {
    const page = computeInitialCamera(viewport, 8);
    expect(computeOpeningCamera(viewport, { aspect: 8 })).toEqual(page);
    expect(computeOpeningCamera(viewport, { aspect: 8, cellsWide: 0 })).toEqual(page);
  });
});

describe('two-finger twist math', () => {
  test('pairAngleDeg matches atan2 (y-down, clockwise-positive)', () => {
    // b directly to the right of a → 0°.
    expect(pairAngleDeg({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(0);
    // b directly below a (y grows downward) → +90° (clockwise).
    expect(pairAngleDeg({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(90);
    // b directly above a → -90°.
    expect(pairAngleDeg({ x: 0, y: 0 }, { x: 0, y: -10 })).toBeCloseTo(-90);
  });

  test('shortestAngleDeltaDeg wraps to (-180, 180] across the atan2 seam', () => {
    expect(shortestAngleDeltaDeg(170, -170)).toBeCloseTo(20); // through +180
    expect(shortestAngleDeltaDeg(-170, 170)).toBeCloseTo(-20); // through -180
    expect(shortestAngleDeltaDeg(10, 20)).toBeCloseTo(10);
    expect(shortestAngleDeltaDeg(0, 0)).toBeCloseTo(0);
  });

  test('accumulating per-sample deltas tracks multi-turn twists past the seam', () => {
    // Simulate the gesture loop: sample the finger-pair angle each move and
    // accumulate the wrapped step. A monotonic clockwise twist that crosses
    // the atan2 seam twice sums to two full turns (720°), not folding back
    // toward 0 — this is why the gesture accumulates rather than reading the
    // raw pair angle.
    const samples = [0, 80, 170, -100, -20, 60, 150, -110, -30, 0];
    let accum = 0;
    let last = samples[0];
    for (let i = 1; i < samples.length; i++) {
      accum += shortestAngleDeltaDeg(last, samples[i]);
      last = samples[i];
    }
    expect(accum).toBeCloseTo(720);
  });
});

describe('cellBboxAroundPoints: the rect the camera flies to', () => {
  test('grows a single point into paper you could draw a line through', () => {
    // A point has no size, and framing a zero rect at FRAME_OBJECT_FIT
    // would zoom to the moon: what the reader needs is the point AND the
    // room around it (docs/social_game_spec.md §7.3).
    expect(cellBboxAroundPoints([{ x: 8, y: 24 }], 6))
      .toEqual({ cellX: 2, cellY: 18, cellWidth: 12, cellHeight: 12 });
  });

  test('takes in every point asked for, padded on all four sides', () => {
    expect(cellBboxAroundPoints([{ x: 8, y: 24 }, { x: 20, y: 24 }, { x: 12, y: 30 }], 2))
      .toEqual({ cellX: 6, cellY: 22, cellWidth: 16, cellHeight: 10 });
  });

  test('is null for nothing to look at', () => {
    expect(cellBboxAroundPoints([], 6)).toBeNull();
  });

  test('frames at a zoom a reader can work at, not the editor ceiling', () => {
    const viewport = makeViewport(390, 780);
    const bbox = cellBboxAroundPoints([{ x: 16, y: 24 }], 6)!;
    const camera = computeFrameCellBboxCamera(viewport, bbox, FRAME_OBJECT_FIT);
    // 12 cells of a 32-cell page filling 80% of the width.
    expect(camera.zoom).toBeCloseTo((0.8 * WORLD_CELLS) / 12, 5);
    expect(camera.zoom).toBeLessThan(EDITOR_MAX_ZOOM);
  });
});

describe('visibleWorldRect with an inset', () => {
  test('an inset trims the bands the chrome covers (DrawBot’s bug a0177e98)', () => {
    const camera = { offsetX: 0, offsetY: 0, zoom: 1 };
    const full = visibleWorldRect(camera, viewport);
    const rect = visibleWorldRect(camera, viewport, { top: 100, bottom: 60 });
    const cellsPerPx = WORLD_CELLS / viewport.width;
    expect(rect.minY).toBeCloseTo(full.minY + 100 * cellsPerPx, 9);
    expect(rect.maxY).toBeCloseTo(full.maxY - 60 * cellsPerPx, 9);
    expect(rect.minX).toBeCloseTo(full.minX, 9);
    expect(rect.maxX).toBeCloseTo(full.maxX, 9);
    // No inset is the whole view.
    expect(visibleWorldRect(camera, viewport, {})).toEqual(full);
  });
});

describe('cameraMatrixInto', () => {
  test('is worldToScreen as a flat affine matrix, scaled by the device pixel ratio', () => {
    const camera: Camera = { offsetX: 12, offsetY: -8, zoom: 1.7 };
    const vp = makeViewport(390, 844);
    const out = new Float64Array(12);
    cameraMatrixInto(out, 6, camera, vp, 3);
    expect(out[7]).toBe(0);
    expect(out[8]).toBe(0);
    expect(out[6]).toBe(out[9]);
    for (const [cx, cy] of [[0, 0], [16, 16], [-3, 40]]) {
      const expected = worldToScreen(cx, cy, camera, vp);
      expect(out[6] * cx + out[8] * cy + out[10]).toBeCloseTo(expected.x * 3, 9);
      expect(out[7] * cx + out[9] * cy + out[11]).toBeCloseTo(expected.y * 3, 9);
    }
  });
});
