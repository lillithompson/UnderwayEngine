/**
 * Regression: when two figures with clip boxes are joined, the result's
 * bounding box should match the clipped placement bounds — not an inflated box.
 * Repro file: test_data/JoinBug.tile.
 *
 * Root cause (fixed in arcBoundingBox): the AABB used to include each arc's
 * CENTER as a conservative point. An arc's center is not on the curve, so for
 * the baked coarse-cell arcs here it sat above the figure top and inflated the
 * box. arcBoundingBox now uses the true arc extent (endpoints + swept axis
 * extremes), so the raw bbox is already tight and within placement.
 *
 * The join site (handleJoin in CompositionEditor) still clamps the raw bbox to
 * the join of all source placement bounds as a defensive backstop (e.g. for
 * line-based coarse-cell overflow). Segments themselves are never modified.
 */

import * as fs from 'fs';
import * as zlib from 'zlib';
import * as path from 'path';

import { deserializeComposition } from '../compositionBinaryFormat';
import { deserializeFile } from '../binaryFormat';
import { exportLayersToSVGInner, SVG_UNITS_PER_L0_CELL } from '../svgExport';
import { simplifySVG } from '../simplifySVG';
import { bakeFigureToColoredSegments } from '../figureToPaths';
import { computeSVGBbox } from '../compositionOps';
import { Layer, FileConfig, initDirtyRects } from '../types';
import type { FileMeta } from '../persistence';
import * as cache from '../svgFigureCache';

jest.mock('../svgFigureCache', () => ({
  getFigureSVGSync: jest.fn(),
}));

const mockGetSync = cache.getFigureSVGSync as jest.Mock;

/** Build lightweight Layer objects from FileMeta — just enough for SVG export
 *  (cell data, visibility, level) without allocating 16 MB pixel buffers. */
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

describe('JoinBug.tile: join preserves clip-box bounds', () => {
  function loadFixture() {
    const tilePath = path.join(__dirname, '../../test_data/JoinBug.tile');
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

  test('raw segment bbox is tight — no arc-center inflation above placement', () => {
    const { meta, embeddedFiles } = loadFixture();
    buildSVGCache(embeddedFiles);

    const allSegments = meta.figures.flatMap(fig => {
      const groups = bakeFigureToColoredSegments(fig);
      return groups ? groups.flatMap(g => g.segments) : [];
    });
    expect(allSegments.length).toBeGreaterThan(0);

    // Previously arcBoundingBox added each arc's center, pushing the box above
    // the figure top (rawBbox.cellY < fig0.cellY). With the tight arc bbox the
    // baked geometry sits within its placement, so no inflation/overflow.
    const rawBbox = computeSVGBbox(allSegments);
    const fig0 = meta.figures[0];
    expect(rawBbox.cellY).toBeGreaterThanOrEqual(fig0.cellY);
  });

});
