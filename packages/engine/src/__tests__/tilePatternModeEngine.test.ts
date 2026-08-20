import {
  applyCompOps,
  mirrorSVG,
  revertCompOps,
  rotateSVG90CW,
} from '../compositionOps';
import { GEOMETRY_ADAPTERS } from '../sceneNodeGeometry';
import { buildSVGObjectContent, buildTiledSVGObjectRegionMarkup } from '../svgPathBuilder';
import { SVG_UNITS_PER_L0_CELL } from '../svgExport';
import { CompositionState, CompUndoEntry, SVGObject, makeViewport } from '../types';

// Pattern (repeat) mode plumbing: the tiled markup builder that both the
// exporter and the live DOM layer render through, the tile-grid metadata
// riding editSVGSegments through op replay (rotate / mirror / rescale must
// round-trip through undo/redo, not just through the direct-state helpers),
// and the rescale offset compensation that keeps the pattern anchored when
// the region's origin edge moves.

function makeState(svgObjects: SVGObject[] = [], overrides: Partial<CompositionState> = {}): CompositionState {
  return {
    id: 'test',
    name: 'test',
    figures: [],
    svgObjects,
    lineDraft: null,
    arcDraft: null,
    editingLineId: null,
    selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
    customColors: [],
    groups: [],
    sceneOrder: svgObjects.map((l) => l.id),
    gridLevel: 0,
    strokeScale: 8,
    gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(),
    activeFigureKey: null,
    compTool: 'select',
    createRegion: null,
    renderGeneration: 0,
    ...overrides,
  };
}

/** A pattern object in repeat mode: one 4×2 tile of content at (10, 20),
 *  repeating across a 12×8 region. */
function makeTiledSVG(overrides: Partial<SVGObject> = {}): SVGObject {
  return {
    id: 'svg_pat',
    segments: [
      { kind: 'line', start: [10, 20], end: [14, 20] },
      { kind: 'line', start: [14, 20], end: [14, 22] },
    ],
    color: { r: 10, g: 20, b: 30 },
    cellX: 10, cellY: 20, cellWidth: 12, cellHeight: 8,
    tileMode: 'repeat',
    tileWidthL0: 4, tileHeightL0: 2,
    ...overrides,
  };
}

describe('buildTiledSVGObjectRegionMarkup', () => {
  const U = SVG_UNITS_PER_L0_CELL;

  test('emits a userSpaceOnUse pattern of the tile filling the region rect', () => {
    const markup = buildTiledSVGObjectRegionMarkup(makeTiledSVG(), 1);
    expect(markup).toContain('patternUnits="userSpaceOnUse"');
    expect(markup).toContain(`width="${4 * U}" height="${2 * U}"`); // tile
    expect(markup).toContain(
      `<rect x="${10 * U}" y="${20 * U}" width="${12 * U}" height="${8 * U}"`,
    ); // region
    // Tile content is anchored to the grid origin: the first segment starts
    // at (0,0) tile-local.
    expect(markup).toContain('M 0,0');
  });

  test('a tile offset shifts the pattern origin, not the region', () => {
    const markup = buildTiledSVGObjectRegionMarkup(
      makeTiledSVG({ tileOffsetXL0: 1, tileOffsetYL0: -0.5 }), 1,
    );
    expect(markup).toContain(`x="${(10 + 1) * U}" y="${(20 - 0.5) * U}"`);
    expect(markup).toContain(`<rect x="${10 * U}" y="${20 * U}"`);
  });

  test('buildSVGObjectContent routes repeat-mode objects to the tiled markup', () => {
    const tiled = makeTiledSVG();
    expect(buildSVGObjectContent(tiled, 1, 16)).toBe(buildTiledSVGObjectRegionMarkup(tiled, 1, 16));
    // …and a non-tiled object still renders plain paths, no pattern.
    const plain = makeTiledSVG({ tileMode: undefined, tileWidthL0: undefined, tileHeightL0: undefined });
    expect(buildSVGObjectContent(plain, 1, 16)).not.toContain('<pattern');
  });

  test('toggling repeat keeps the DOM stroke width (legacy strokeScale)', () => {
    // The DOM layer measures legacy strokes in its base pixel (unitsPerCell
    // = 16) under non-scaling-stroke: width = 5 × strokeScale px. The tile
    // draws in SVG units through the viewBox transform (renders one unit as
    // 16/U px), so its emitted width must be 5 × strokeScale × (U / 16) for
    // the same on-screen weight — a repeat toggle then changes nothing
    // visually.
    const strokeScale = 0.2;
    const domTiled = buildSVGObjectContent(makeTiledSVG(), strokeScale, 16);
    const emitted = Number(/stroke-width="([^"]+)"/.exec(domTiled)![1]);
    expect(emitted * (16 / U)).toBeCloseTo(5 * strokeScale);
    // The export caller (unitsPerCell = U) is the identity conversion.
    const exportTiled = buildTiledSVGObjectRegionMarkup(makeTiledSVG(), strokeScale);
    expect(exportTiled).toContain(`stroke-width="${5 * strokeScale}"`);
  });

  test('a per-object stroke block keeps its authored cell width in the tile', () => {
    // Stroke-block widths are in world cells and must land at width × U SVG
    // units regardless of the caller's unit.
    const svg = makeTiledSVG({ stroke: { width: 0.5, position: 'center', dash: 0 } });
    const dom = buildSVGObjectContent(svg, 0.2, 16);
    expect(dom).toContain(`stroke-width="${0.5 * U}"`);
  });
});

describe('editSVGSegments tile metadata', () => {
  test('applies and inverts tile dims and offsets', () => {
    const state = makeState([makeTiledSVG()]);
    const entry: CompUndoEntry = [{
      op: 'editSVGSegments', svgId: 'svg_pat',
      oldSegments: makeTiledSVG().segments, newSegments: makeTiledSVG().segments,
      oldCellX: 10, oldCellY: 20, oldCellWidth: 12, oldCellHeight: 8,
      newCellX: 10, newCellY: 20, newCellWidth: 12, newCellHeight: 8,
      oldTileWidthL0: 4, newTileWidthL0: 2,
      oldTileHeightL0: 2, newTileHeightL0: 4,
      oldTileOffsetXL0: 0, newTileOffsetXL0: 3,
      oldTileOffsetYL0: 0, newTileOffsetYL0: 0,
    }];
    const after = applyCompOps(state, entry).svgObjects[0];
    expect(after.tileWidthL0).toBe(2);
    expect(after.tileHeightL0).toBe(4);
    expect(after.tileOffsetXL0).toBe(3);
    // 0 normalizes back to absent so untouched patterns stay field-free.
    expect(after.tileOffsetYL0).toBeUndefined();
    const reverted = revertCompOps(applyCompOps(state, entry), entry).svgObjects[0];
    expect(reverted.tileWidthL0).toBe(4);
    expect(reverted.tileHeightL0).toBe(2);
    expect(reverted.tileOffsetXL0).toBeUndefined();
  });

  test('rotate round-trips the tile grid through op replay', () => {
    const prev = makeTiledSVG();
    const next = rotateSVG90CW(prev);
    // The direct-state helper swaps the tile dims…
    expect(next.tileWidthL0).toBe(2);
    expect(next.tileHeightL0).toBe(4);
    // …and an op carrying the same old/new fields lands identically.
    const entry: CompUndoEntry = [{
      op: 'editSVGSegments', svgId: prev.id,
      oldSegments: prev.segments, newSegments: next.segments,
      oldCellX: prev.cellX, oldCellY: prev.cellY,
      oldCellWidth: prev.cellWidth, oldCellHeight: prev.cellHeight,
      newCellX: next.cellX, newCellY: next.cellY,
      newCellWidth: next.cellWidth, newCellHeight: next.cellHeight,
      preserveOrientation: true,
      oldRotation: prev.rotation, newRotation: next.rotation,
      oldTileWidthL0: prev.tileWidthL0, newTileWidthL0: next.tileWidthL0,
      oldTileHeightL0: prev.tileHeightL0, newTileHeightL0: next.tileHeightL0,
      oldTileOffsetXL0: prev.tileOffsetXL0 ?? 0, newTileOffsetXL0: next.tileOffsetXL0 ?? 0,
      oldTileOffsetYL0: prev.tileOffsetYL0 ?? 0, newTileOffsetYL0: next.tileOffsetYL0 ?? 0,
    }];
    const state = makeState([prev]);
    const applied = applyCompOps(state, entry).svgObjects[0];
    expect(applied.tileWidthL0).toBe(next.tileWidthL0);
    expect(applied.tileHeightL0).toBe(next.tileHeightL0);
    expect(applied.tileOffsetXL0).toBe(next.tileOffsetXL0);
    expect(applied.tileOffsetYL0).toBe(next.tileOffsetYL0);
    expect(applied.cellWidth).toBe(next.cellWidth);
    const undone = revertCompOps(applyCompOps(state, entry), entry).svgObjects[0];
    expect(undone.tileWidthL0).toBe(4);
    expect(undone.tileHeightL0).toBe(2);
    expect(undone.cellWidth).toBe(12);
  });

  test('mirror keeps the region and reflects the tile BOX within it', () => {
    const prev = makeTiledSVG({ tileOffsetXL0: 1 });
    const next = mirrorSVG(prev, 'h');
    expect(next.cellX).toBe(prev.cellX);
    expect(next.cellWidth).toBe(prev.cellWidth);
    // Screen-h mirror reflects the tile BOX about the region width — the
    // pattern adapter's rule, span − (offset + tile) = 12 − (1 + 4) — so
    // the box sits the same distance from the far edge and the segments
    // (also reflected, about the region centre) land exactly inside it.
    expect(next.tileOffsetXL0).toBe(prev.cellWidth - (1 + prev.tileWidthL0!));
    expect(next.tileOffsetYL0).toBeUndefined();
  });
});

describe('svgAdapter.rescale in repeat mode', () => {
  const rescale = GEOMETRY_ADAPTERS.svg.rescale;

  test('keeps the tile and segments; only the region changes', () => {
    const svg = makeTiledSVG();
    const oldBbox = { cellX: 10, cellY: 20, cellWidth: 12, cellHeight: 8 };
    const grown = rescale(svg, oldBbox, { cellX: 10, cellY: 20, cellWidth: 20, cellHeight: 14 }) as SVGObject;
    expect(grown.segments).toEqual(svg.segments);
    expect(grown.tileWidthL0).toBe(4);
    expect(grown.tileHeightL0).toBe(2);
    expect(grown.cellWidth).toBe(20);
    // Bottom/right growth doesn't move the origin: no offset appears.
    expect(grown.tileOffsetXL0).toBeUndefined();
    expect(grown.tileOffsetYL0).toBeUndefined();
  });

  test('an origin-side resize compensates the tile offset so the pattern stays put', () => {
    const svg = makeTiledSVG();
    const oldBbox = { cellX: 10, cellY: 20, cellWidth: 12, cellHeight: 8 };
    const grown = rescale(svg, oldBbox, { cellX: 7, cellY: 18, cellWidth: 15, cellHeight: 10 }) as SVGObject;
    // The tile-grid anchor (cellX + offset) is invariant: 7 + 3 = 10.
    expect(grown.tileOffsetXL0).toBe(3);
    expect(grown.tileOffsetYL0).toBe(2);
    expect(grown.cellX + (grown.tileOffsetXL0 ?? 0)).toBe(svg.cellX + (svg.tileOffsetXL0 ?? 0));
    expect(grown.cellY + (grown.tileOffsetYL0 ?? 0)).toBe(svg.cellY + (svg.tileOffsetYL0 ?? 0));
  });
});
