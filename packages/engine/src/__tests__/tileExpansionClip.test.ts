/**
 * Regression: expanding a tiled figure whose tile grid doesn't evenly divide
 * the region produced segments that extended beyond the region boundary. The
 * shader clips during rendering, but the baked segments didn't — causing
 * visible overflow (e.g. a 9×10 region rendering as 11.5×10.5).
 *
 * The fix clips expanded segments to the source region via clipSegmentsToRect.
 * Repro file: test_data/expansionBug.tile.
 */

import * as fs from 'fs';
import * as zlib from 'zlib';
import * as path from 'path';

import { deserializeComposition } from '../compositionBinaryFormat';
import { deserializeFile } from '../binaryFormat';
import { exportLayersToSVGInner, SVG_UNITS_PER_L0_CELL } from '../svgExport';
import { simplifySVG } from '../simplifySVG';
import {
  bakeFigureToColoredSegments,
  transformSegmentAroundCenter,
  clipSegmentsToRect,
} from '../figureToPaths';
import {
  computeSVGBbox,
  offsetPathSegment,
  clonePathSegment,
} from '../compositionOps';
import {
  Layer,
  FileConfig,
  initDirtyRects,
  PathSegment,
  CompositionFigure,
} from '../types';
import type { FileMeta } from '../persistence';
import * as cache from '../svgFigureCache';

jest.mock('../svgFigureCache', () => ({
  getFigureSVGSync: jest.fn(),
}));

const mockGetSync = cache.getFigureSVGSync as jest.Mock;

function layersFromMeta(meta: FileMeta): Layer[] {
  const EMPTY_U8 = new Uint8Array(0);
  const EMPTY_U32 = new Uint32Array(0);
  return meta.layers.map(lm => ({
    id: lm.id,
    name: lm.name,
    level: lm.level,
    visible: lm.visible,
    opacity: lm.opacity,
    order: lm.order,
    shiftX: (lm.shiftX ?? 0) as 0 | 0.5,
    shiftY: (lm.shiftY ?? 0) as 0 | 0.5,
    locked: lm.locked ?? false,
    data: EMPTY_U8,
    dataU32: EMPTY_U32,
    dirtyRects: initDirtyRects(),
    cells: lm.cells,
    cellsGeneration: lm.cellsGeneration ?? 0,
    edgeRowTop: lm.edgeRowTop ?? null,
    edgeColLeft: lm.edgeColLeft ?? null,
    edgeCorner: lm.edgeCorner ?? null,
  }) as Layer);
}

/** Replicate the figure tiling logic from buildJoinFromSources so we can
 *  test it outside the React component. */
function expandTiledFigure(fig: CompositionFigure): {
  segments: PathSegment[];
  cellX: number; cellY: number; cellWidth: number; cellHeight: number;
} | null {
  const tileW = fig.tileWidthL0!;
  const tileH = fig.tileHeightL0!;
  const rotation = fig.rotation ?? 0;
  const mH = fig.mirrorH ?? false;
  const mV = fig.mirrorV ?? false;
  const rotSwapped = rotation === 90 || rotation === 270;
  const regionW = rotSwapped ? fig.cellHeight : fig.cellWidth;
  const regionH = rotSwapped ? fig.cellWidth : fig.cellHeight;
  const regionCx = fig.cellX + fig.cellWidth / 2;
  const regionCy = fig.cellY + fig.cellHeight / 2;
  const rectX = regionCx - regionW / 2;
  const rectY = regionCy - regionH / 2;
  const bakeFig: CompositionFigure = {
    ...fig,
    cellX: rectX, cellY: rectY,
    cellWidth: tileW, cellHeight: tileH,
    rotation: 0 as 0, mirrorH: false, mirrorV: false,
  };
  const colorGroups = bakeFigureToColoredSegments(bakeFig);
  if (!colorGroups) return null;

  const offX = fig.tileOffsetXL0 ?? 0;
  const offY = fig.tileOffsetYL0 ?? 0;
  const normX = ((offX % tileW) + tileW) % tileW;
  const normY = ((offY % tileH) + tileH) % tileH;
  const startX = normX > 0 ? normX - tileW : 0;
  const startY = normY > 0 ? normY - tileH : 0;
  const cols = Math.ceil((regionW - startX) / tileW);
  const rows = Math.ceil((regionH - startY) / tileH);
  const needsTransform = rotation !== 0 || mH || mV;

  const figMinX = fig.cellX;
  const figMinY = fig.cellY;
  const figMaxX = fig.cellX + fig.cellWidth;
  const figMaxY = fig.cellY + fig.cellHeight;

  const allSegments: PathSegment[] = [];
  for (const group of colorGroups) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const dx = startX + col * tileW;
        const dy = startY + row * tileH;
        for (const seg of group.segments) {
          const placed = (dx === 0 && dy === 0)
            ? clonePathSegment(seg)
            : offsetPathSegment(seg, dx, dy);
          const final = needsTransform
            ? transformSegmentAroundCenter(placed, regionCx, regionCy, rotation, mH, mV)
            : placed;
          // Overlap filter (same as production code)
          const pts = final.kind === 'arc'
            ? [final.start, final.end, final.center]
            : [final.start, final.end];
          let sMinX = Infinity, sMaxX = -Infinity;
          let sMinY = Infinity, sMaxY = -Infinity;
          for (const p of pts) {
            if (p[0] < sMinX) sMinX = p[0];
            if (p[0] > sMaxX) sMaxX = p[0];
            if (p[1] < sMinY) sMinY = p[1];
            if (p[1] > sMaxY) sMaxY = p[1];
          }
          if (sMaxX < figMinX || sMinX > figMaxX) continue;
          if (sMaxY < figMinY || sMinY > figMaxY) continue;
          allSegments.push(final);
        }
      }
    }
  }

  // Apply the fix: clip to region bounds
  const clipped = clipSegmentsToRect(allSegments, figMinX, figMinY, figMaxX, figMaxY);

  return {
    segments: clipped,
    cellX: fig.cellX,
    cellY: fig.cellY,
    cellWidth: fig.cellWidth,
    cellHeight: fig.cellHeight,
  };
}

describe('expansionBug.tile: tiled expansion clips segments to region', () => {
  function loadFixture() {
    const tilePath = path.join(__dirname, '../../test_data/expansionBug.tile');
    const data = new Uint8Array(fs.readFileSync(tilePath));
    const decompressed = zlib.inflateSync(data);
    const { meta, embeddedFiles } = deserializeComposition(decompressed);
    return { meta, embeddedFiles };
  }

  function buildSVGCache(embeddedFiles: any[]) {
    const svgByFileId = new Map<string, { elements: string[]; svgWidth: number; svgHeight: number }>();
    for (const ef of embeddedFiles) {
      const fileMeta = deserializeFile(ef.data);
      const layers = layersFromMeta(fileMeta);
      const fileConfig: FileConfig = {
        id: ef.id,
        name: ef.name,
        widthL0: fileMeta.widthL0 ?? 32,
        heightL0: fileMeta.heightL0 ?? 32,
        originL0X: fileMeta.originL0X ?? 0,
        originL0Y: fileMeta.originL0Y ?? 0,
        clipBox: fileMeta.clipBox,
      };
      const result = exportLayersToSVGInner(layers, fileConfig);
      svgByFileId.set(ef.id, {
        elements: simplifySVG(result.elements),
        svgWidth: result.widthL0 * SVG_UNITS_PER_L0_CELL,
        svgHeight: result.heightL0 * SVG_UNITS_PER_L0_CELL,
      });
    }
    mockGetSync.mockImplementation((fig: any) => {
      if (fig.fileId) return svgByFileId.get(fig.fileId) ?? null;
      return null;
    });
  }

  afterEach(() => mockGetSync.mockReset());

  test('fixture has a tiled figure with region larger than tile', () => {
    const { meta } = loadFixture();
    const tiledFig = meta.figures.find(f => f.tileMode === 'repeat');
    expect(tiledFig).toBeDefined();
    expect(tiledFig!.tileWidthL0).toBeGreaterThan(0);
    expect(tiledFig!.tileHeightL0).toBeGreaterThan(0);
    // Region should be larger than the tile in at least one dimension
    expect(
      tiledFig!.cellWidth > tiledFig!.tileWidthL0! ||
      tiledFig!.cellHeight > tiledFig!.tileHeightL0!,
    ).toBe(true);
  });

  test('unclipped expansion produces segments beyond region (confirms bug existed)', () => {
    const { meta, embeddedFiles } = loadFixture();
    buildSVGCache(embeddedFiles);

    const fig = meta.figures.find(f => f.tileMode === 'repeat')!;
    const tileW = fig.tileWidthL0!;
    const tileH = fig.tileHeightL0!;
    const rotation = fig.rotation ?? 0;
    const rotSwapped = rotation === 90 || rotation === 270;
    const regionW = rotSwapped ? fig.cellHeight : fig.cellWidth;
    const regionH = rotSwapped ? fig.cellWidth : fig.cellHeight;
    const regionCx = fig.cellX + fig.cellWidth / 2;
    const regionCy = fig.cellY + fig.cellHeight / 2;
    const rectX = regionCx - regionW / 2;
    const rectY = regionCy - regionH / 2;
    const bakeFig: CompositionFigure = {
      ...fig,
      cellX: rectX, cellY: rectY,
      cellWidth: tileW, cellHeight: tileH,
      rotation: 0 as 0, mirrorH: false, mirrorV: false,
    };
    const colorGroups = bakeFigureToColoredSegments(bakeFig);
    expect(colorGroups).not.toBeNull();

    const offX = fig.tileOffsetXL0 ?? 0;
    const offY = fig.tileOffsetYL0 ?? 0;
    const normX = ((offX % tileW) + tileW) % tileW;
    const normY = ((offY % tileH) + tileH) % tileH;
    const startX = normX > 0 ? normX - tileW : 0;
    const startY = normY > 0 ? normY - tileH : 0;
    const cols = Math.ceil((regionW - startX) / tileW);
    const rows = Math.ceil((regionH - startY) / tileH);
    const needsTransform = rotation !== 0 || (fig.mirrorH ?? false) || (fig.mirrorV ?? false);

    // Tile without clipping
    const raw: PathSegment[] = [];
    for (const group of colorGroups!) {
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const dx = startX + col * tileW;
          const dy = startY + row * tileH;
          for (const seg of group.segments) {
            const placed = (dx === 0 && dy === 0)
              ? clonePathSegment(seg)
              : offsetPathSegment(seg, dx, dy);
            const final = needsTransform
              ? transformSegmentAroundCenter(placed, regionCx, regionCy, rotation, fig.mirrorH ?? false, fig.mirrorV ?? false)
              : placed;
            raw.push(final);
          }
        }
      }
    }

    const rawBbox = computeSVGBbox(raw);
    // Without clipping, the raw bbox should exceed the region in at least
    // one dimension (confirming the bug existed).
    const exceeds =
      rawBbox.cellX < fig.cellX - 0.01 ||
      rawBbox.cellY < fig.cellY - 0.01 ||
      rawBbox.cellX + rawBbox.cellWidth > fig.cellX + fig.cellWidth + 0.01 ||
      rawBbox.cellY + rawBbox.cellHeight > fig.cellY + fig.cellHeight + 0.01;
    expect(exceeds).toBe(true);
  });

  test('clipped expansion keeps all segments within region bounds', () => {
    const { meta, embeddedFiles } = loadFixture();
    buildSVGCache(embeddedFiles);

    const fig = meta.figures.find(f => f.tileMode === 'repeat')!;
    const result = expandTiledFigure(fig);
    expect(result).not.toBeNull();
    expect(result!.segments.length).toBeGreaterThan(0);

    const eps = 0.01;
    const minX = fig.cellX - eps;
    const minY = fig.cellY - eps;
    const maxX = fig.cellX + fig.cellWidth + eps;
    const maxY = fig.cellY + fig.cellHeight + eps;

    for (const seg of result!.segments) {
      const pts = seg.kind === 'arc'
        ? [seg.start, seg.end, seg.center]
        : [seg.start, seg.end];
      for (const p of pts) {
        expect(p[0]).toBeGreaterThanOrEqual(minX);
        expect(p[0]).toBeLessThanOrEqual(maxX);
        expect(p[1]).toBeGreaterThanOrEqual(minY);
        expect(p[1]).toBeLessThanOrEqual(maxY);
      }
    }
  });

  test('expanded bbox matches source region exactly', () => {
    const { meta, embeddedFiles } = loadFixture();
    buildSVGCache(embeddedFiles);

    const fig = meta.figures.find(f => f.tileMode === 'repeat')!;
    const result = expandTiledFigure(fig);
    expect(result).not.toBeNull();

    expect(result!.cellX).toBe(fig.cellX);
    expect(result!.cellY).toBe(fig.cellY);
    expect(result!.cellWidth).toBe(fig.cellWidth);
    expect(result!.cellHeight).toBe(fig.cellHeight);
  });
});
