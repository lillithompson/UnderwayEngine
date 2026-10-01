/**
 * A `.svg` FILE writes its repeating regions as real paths.
 *
 * Everywhere the app draws a pattern it is a `<pattern>` paint server
 * filling the region's rect: one tile, however many copies show. A browser
 * reads that; Figma's importer does not, and a page of patterns opened
 * there with every one of them missing. So the file export asks for the
 * EXPANSION — `expandTiles` — and gets every visible copy as paths,
 * clipped to the region, through the expander the painted-tile path
 * already used (`buildExpandedTileSVGObjectContent`).
 *
 * These pin: that the expansion is the same picture the paint server made
 * (the very tile, once per visible copy, clipped to the same rect), that
 * nothing changes for a caller that does not ask, and that the option
 * reaches every region a page can hold — a tiled object, a pattern
 * object, a shape's pattern fill.
 */

import { generateCompositionSVGCore } from '../compositionSVGCore';
import { shapePatternFillTiles } from '../patternObjectRender';
import { SVG_UNITS_PER_L0_CELL } from '../svgExport';
import {
  buildExpandedTileSVGObjectContent,
  buildSVGObjectContent,
  buildTiledSVGObjectRegionMarkup,
} from '../svgPathBuilder';
import { packKey } from '../tileSegmentOverrides';
import {
  CellState, DEFAULT_TRANSFORM, PatternObject, ShapePatternFill, SVGObject,
} from '../types';

const U = SVG_UNITS_PER_L0_CELL;
const EXPAND = { expandTiles: true } as const;
// A sprite the mocked registry carries a vector source for, so its cell
// bakes to real paths (shapePatternFill.test.ts's DRAWN_TILE).
const DRAWN_TILE = 'angular/tile_00000001';

/** One 4×2 tile of content at (10, 20), repeating across a 12×8 region:
 *  3 columns × 4 rows of copies (tilePatternModeEngine.test.ts's fixture). */
function tiled(over: Partial<SVGObject> = {}): SVGObject {
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
    ...over,
  };
}

/** A closed 4×2 loop as one tile — something a fill can paint. */
const LOOP: SVGObject['segments'] = [
  { kind: 'line', start: [10, 20], end: [14, 20] },
  { kind: 'line', start: [14, 20], end: [14, 22] },
  { kind: 'line', start: [14, 22], end: [10, 22] },
  { kind: 'line', start: [10, 22], end: [10, 20] },
];

/** What sits between `<pattern …>` and `</pattern>`: the one tile. */
function patternTile(markup: string): string {
  const m = /<pattern [^>]*>([\s\S]*)<\/pattern>/.exec(markup);
  if (!m) throw new Error('no <pattern> in markup');
  return m[1];
}

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe('the region, expanded', () => {
  it('writes no paint server: every visible copy is the pattern s own tile, as paths', () => {
    const served = buildTiledSVGObjectRegionMarkup(tiled(), 1);
    const expanded = buildTiledSVGObjectRegionMarkup(tiled(), 1, undefined, EXPAND);

    expect(served).toContain('<pattern');
    expect(expanded).not.toContain('<pattern');
    expect(expanded).not.toContain('fill="url(#pat_svg_');
    // The very tile the paint server repeated, once per visible copy.
    const tile = patternTile(served);
    expect(tile).toContain('<path');
    expect(count(expanded, tile)).toBe(3 * 4);
  });

  it('places each copy on the tile grid, in world SVG units', () => {
    const expanded = buildTiledSVGObjectRegionMarkup(tiled(), 1, undefined, EXPAND);
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 3; col++) {
        expect(expanded).toContain(`<g transform="translate(${(10 + col * 4) * U},${(20 + row * 2) * U})">`);
      }
    }
    expect(count(expanded, '<g transform="translate(')).toBe(12);
  });

  it('clips the copies to the region with a clipPath rect, not a nested viewport', () => {
    const expanded = buildTiledSVGObjectRegionMarkup(tiled(), 1, undefined, EXPAND);
    expect(expanded).toContain(
      '<clipPath id="tileclip_svg_pat" clipPathUnits="userSpaceOnUse">'
      + `<rect x="${10 * U}" y="${20 * U}" width="${12 * U}" height="${8 * U}" /></clipPath>`,
    );
    const clipAt = expanded.indexOf('<g clip-path="url(#tileclip_svg_pat)">');
    expect(clipAt).toBeGreaterThan(-1);
    // Every copy rides inside the clipped group.
    expect(expanded.indexOf('<g transform="translate(')).toBeGreaterThan(clipAt);
    expect(expanded).not.toContain('<svg');
  });

  it('a tile offset keeps the grid where it was and still covers the region', () => {
    // The grid is anchored a cell right and half a cell up of the region:
    // a partial column on the left and a partial row on top join in, and
    // the clip is what trims them.
    const off = tiled({ tileOffsetXL0: 1, tileOffsetYL0: -0.5 });
    const expanded = buildTiledSVGObjectRegionMarkup(off, 1, undefined, EXPAND);
    const xs = new Set<number>();
    const ys = new Set<number>();
    for (const m of expanded.matchAll(/<g transform="translate\(([-\d.]+),([-\d.]+)\)">/g)) {
      xs.add(Number(m[1]) / U);
      ys.add(Number(m[2]) / U);
    }
    // Columns every 4 cells through x = 11, rows every 2 through y = 19.5,
    // from the copy that starts before the region to the one that ends
    // after it.
    expect([...xs].sort((a, b) => a - b)).toEqual([7, 11, 15, 19]);
    expect([...ys].sort((a, b) => a - b)).toEqual([19.5, 21.5, 23.5, 25.5, 27.5]);
    // The clip is still the region, not the grid.
    expect(expanded).toContain(`<rect x="${10 * U}" y="${20 * U}" width="${12 * U}" height="${8 * U}" />`);
  });

  it('keeps the object s own stroke block and its FILLED subpaths in every copy', () => {
    // What the expander's painted-copy path does not draw (it strokes at
    // the legacy width and knows no subpath fill) and a pattern's baked
    // cells are made of: the unpainted expansion goes through the tile the
    // paint server draws, so neither is lost on the way to a file.
    const obj = tiled({
      segments: LOOP,
      stroke: { width: 0.5, position: 'center', dash: 0 },
      subpaths: [
        { segments: LOOP, color: { r: 200, g: 40, b: 40 }, fill: true },
        { segments: [LOOP[0]], color: { r: 1, g: 2, b: 3 } },
      ],
    } as Partial<SVGObject>);
    const expanded = buildTiledSVGObjectRegionMarkup(obj, 1, undefined, EXPAND);
    expect(count(expanded, 'fill="rgb(200,40,40)" stroke="none" fill-rule="nonzero"')).toBe(12);
    expect(count(expanded, 'stroke="rgb(1,2,3)"')).toBe(12);
    expect(count(expanded, `stroke-width="${0.5 * U}"`)).toBe(12);
  });

  it('states a gradient fill s defs once, ahead of the copies that use it', () => {
    const obj = tiled({
      segments: LOOP,
      fillPaint: {
        kind: 'linear',
        stops: [
          { offset: 0, color: { r: 255, g: 0, b: 0 } },
          { offset: 1, color: { r: 0, g: 0, b: 255 } },
        ],
        x1: 0, y1: 0, x2: 1, y2: 1,
      },
    } as Partial<SVGObject>);
    const expanded = buildTiledSVGObjectRegionMarkup(obj, 1, undefined, EXPAND);
    expect(count(expanded, '<linearGradient')).toBe(1);
    expect(count(expanded, 'url(#grad_svg_pat')).toBe(12);
    expect(expanded.indexOf('<linearGradient')).toBeLessThan(expanded.indexOf('<g transform="translate('));
  });

  it('wears the whole-object opacity, as the paint server s region does', () => {
    const expanded = buildTiledSVGObjectRegionMarkup(tiled({ opacity: 0.25 }), 1, undefined, EXPAND);
    expect(expanded.startsWith('<g opacity="0.25">')).toBe(true);
    expect(expanded).toContain('<g clip-path="url(#tileclip_svg_pat)">');
  });

  it('a PAINTED region expands through the same clip, with its per-copy colours', () => {
    const red = { r: 255, g: 0, b: 0 };
    const painted = tiled({ segmentOverrides: new Map([[packKey(1, 0, 0)!, red]]) });
    const expanded = buildTiledSVGObjectRegionMarkup(painted, 1, undefined, EXPAND);
    expect(expanded).toContain('<g clip-path="url(#tileclip_svg_pat)">');
    expect(expanded).not.toContain('<svg');
    expect(count(expanded, 'stroke="rgb(255,0,0)"')).toBe(1);
    expect(count(expanded, '<g transform="translate(')).toBe(12);
  });

  it('draws nothing for a region with no geometry', () => {
    expect(buildTiledSVGObjectRegionMarkup(tiled({ segments: [] }), 1, undefined, EXPAND)).toBe('');
  });
});

describe('nothing changes for a caller that does not ask', () => {
  it('an unpainted region is still the paint server, a painted one still the nested viewport', () => {
    const served = buildTiledSVGObjectRegionMarkup(tiled(), 1);
    expect(served).toContain('<pattern id="pat_svg_svg_pat"');
    expect(served).not.toContain('tileclip_');
    expect(buildTiledSVGObjectRegionMarkup(tiled(), 1, undefined, {})).toBe(served);
    expect(buildTiledSVGObjectRegionMarkup(tiled(), 1, undefined, { expandTiles: false })).toBe(served);

    const painted = tiled({ segmentOverrides: new Map([[packKey(1, 0, 0)!, { r: 255, g: 0, b: 0 }]]) });
    const overlay = buildTiledSVGObjectRegionMarkup(painted, 1);
    expect(overlay).toContain('<svg x=');
    expect(overlay).not.toContain('tileclip_');
  });

  it('the live overlay s sparse expansion is untouched: only painted copies, legacy line', () => {
    expect(buildExpandedTileSVGObjectContent(tiled(), 1, { onlyPainted: true })).toBe('');
    const painted = tiled({ segmentOverrides: new Map([[packKey(1, 0, 0)!, { r: 255, g: 0, b: 0 }]]) });
    const sparse = buildExpandedTileSVGObjectContent(painted, 1, { onlyPainted: true });
    expect(count(sparse, '<g transform="translate(')).toBe(1);
  });
});

describe('the option reaches every region a page can hold', () => {
  const spriteCell = (): CellState => ({
    type: 'sprite', spriteId: DRAWN_TILE, transform: { ...DEFAULT_TRANSFORM },
  });

  function rect(id: string, x: number, y: number, w: number, h: number): SVGObject {
    return {
      id,
      segments: [
        { kind: 'line', start: [x, y], end: [x + w, y] },
        { kind: 'line', start: [x + w, y], end: [x + w, y + h] },
        { kind: 'line', start: [x + w, y + h], end: [x, y + h] },
        { kind: 'line', start: [x, y + h], end: [x, y] },
      ],
      color: { r: 0, g: 0, b: 0 },
      cellX: x, cellY: y, cellWidth: w, cellHeight: h,
    } as SVGObject;
  }

  /** A 2×2 block with one drawn cell, repeated across the shape. */
  function patternFill(): ShapePatternFill {
    const cells: CellState[] = new Array(4).fill(null);
    cells[0] = spriteCell();
    return { size: 2, cells, tileL0: 2 };
  }

  /** A 2×2 pattern object repeating its 2-cell block across an 8×6 region. */
  function repeatingPattern(): PatternObject {
    const cells: CellState[] = new Array(4).fill(null);
    cells[0] = spriteCell();
    return {
      id: 'pat_1',
      cellX: 20, cellY: 4, cellWidth: 8, cellHeight: 6,
      cols: 2, rows: 2, cells,
      tileMode: 'repeat', tileWidthL0: 2, tileHeightL0: 2,
    } as PatternObject;
  }

  function page(svgObjects: SVGObject[], patternObjects: PatternObject[], expandTiles?: boolean) {
    return {
      name: 'page',
      figures: [], svgObjects, images: [], imageBlobs: {}, texts: [],
      patternObjects,
      groups: [],
      sceneOrder: [...svgObjects.map((s) => s.id), ...patternObjects.map((p) => p.id)],
      expandTiles,
    } as never;
  }

  it('buildSVGObjectContent hands it on to the region', () => {
    expect(buildSVGObjectContent(tiled(), 1, U, { expandTiles: true }))
      .toBe(buildTiledSVGObjectRegionMarkup(tiled(), 1, U, EXPAND));
    expect(buildSVGObjectContent(tiled(), 1, U)).toContain('<pattern');
  });

  it('a shape s pattern fill bakes its tiles as paths', () => {
    const shape = { ...rect('svg_1', 0, 0, 4, 4), patternFill: patternFill() };
    const served = shapePatternFillTiles(shape, 1);
    const expanded = shapePatternFillTiles(shape, 1, undefined, EXPAND);
    expect(served).toContain('<pattern');
    expect(expanded).not.toBe('');
    expect(expanded).not.toContain('<pattern');
    // The block is CENTRED on the shape (shapePatternGrid's offset), so the
    // 4×4 box shows a whole block in the middle and half of one on every
    // side: 3×3 copies, the outer ring trimmed by the clip.
    expect(count(expanded, patternTile(served))).toBe(9);
  });

  it('the exported page holds no <pattern> at all — tiled object, pattern object and pattern fill', async () => {
    const objects = [tiled(), { ...rect('svg_1', 0, 0, 4, 4), patternFill: patternFill() }];
    const patterns = [repeatingPattern()];

    // As every raster and thumbnail draws it: three paint servers.
    const drawn = (await generateCompositionSVGCore(page(objects, patterns)))!;
    expect(count(drawn, '<pattern ')).toBe(3);

    const file = (await generateCompositionSVGCore(page(objects, patterns, true)))!;
    expect(file).not.toContain('<pattern');
    expect(file).not.toMatch(/fill="url\(#pat_/);
    // Each region is there, as a clipped group of copies…
    expect(count(file, '<g clip-path="url(#tileclip_')).toBe(3);
    // …and the shape's fill is still held to the shape's own outline.
    expect(file).toContain('clip-path="url(#patfill_svg_1)"');
    // The frame is the same page either way.
    const viewBox = (s: string) => /viewBox="([^"]+)"/.exec(s)![1];
    expect(viewBox(file)).toBe(viewBox(drawn));
  });
});
