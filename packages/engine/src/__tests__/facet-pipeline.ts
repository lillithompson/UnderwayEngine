import * as fs from 'fs';
import * as path from 'path';
import { Layer, LAYER_PX, initDirtyRects, markFullDirty } from '../types';
import { createCellGrid, rebuildPixelData } from '../cells';
import {
  computeBoundingBox,
  hashFileContent,
  BakedFigureInfo,
} from '../bake';
import { FileMeta } from '../persistence';

export interface FacetFile {
  version: number;
  name: string;
  meta: FileMeta;
  thumbnail?: string;
}

/**
 * Read and parse a .facet JSON file from the test_data directory.
 */
export function loadFacetFile(relativePath: string): FacetFile {
  const absPath = path.resolve(__dirname, '../../assets/images/test_data', relativePath);
  const raw = fs.readFileSync(absPath, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Convert FileMeta into live Layer[] with pixel data rebuilt.
 * Mirrors loadFileState logic from persistence.ts without AsyncStorage.
 */
export function facetToLayers(meta: FileMeta): Layer[] {
  const layers: Layer[] = [];
  for (const lm of meta.layers) {
    const data = new Uint8Array(LAYER_PX * LAYER_PX * 4);
    const layer: Layer = {
      id: lm.id,
      name: lm.name,
      level: lm.level,
      visible: lm.visible,
      opacity: lm.opacity,
      order: lm.order,
      shiftX: (lm.shiftX ?? 0) as 0 | 0.5,
      shiftY: (lm.shiftY ?? 0) as 0 | 0.5,
      locked: lm.locked ?? false,
      data,
      dataU32: new Uint32Array(data.buffer),
      dirtyRects: initDirtyRects(),
      dirtyRectCount: 0,
      cells: lm.cells ?? createCellGrid(lm.level),
      cellsGeneration: 0,
      edgeRowTop: lm.edgeRowTop ?? null,
      edgeColLeft: lm.edgeColLeft ?? null,
      edgeCorner: lm.edgeCorner ?? null,
    };
    rebuildPixelData(layer);
    markFullDirty(layer);
    layers.push(layer);
  }
  return layers;
}

/**
 * Build a BakedFigureInfo from layers (no PNG rasterization — SVG renders natively).
 * Returns null if bounding box is empty.
 */
export function bakeLayers(
  fileId: string,
  layers: Layer[],
): { info: BakedFigureInfo } | null {
  const bounds = computeBoundingBox(layers);
  if (!bounds) return null;

  const contentHash = hashFileContent(layers);

  const info: BakedFigureInfo = {
    fileId,
    resolutionX: bounds.resolutionX,
    resolutionY: bounds.resolutionY,
    contentHash,
    pxWidth: bounds.pxMaxX - bounds.pxMinX,
    pxHeight: bounds.pxMaxY - bounds.pxMinY,
  };

  return { info };
}
