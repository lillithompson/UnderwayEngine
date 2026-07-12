import {
  Pattern,
  PatternEntry,
  EditorState,
  GridLevel,
  CELL_COUNTS,
  cellPx,
  CellState,
  Selection,
  UndoOp,
} from './types';
import { getContainedLayerCells, rotateOffset, composeRotation } from './cells';

// ── Create Pattern ──────────────────────────────────────────────────

export function createPattern(
  id: string,
  name: string,
  state: EditorState,
  selection: Selection,
): Pattern {
  const activeLayer = state.layers.find((l) => l.id === state.activeLayerId);
  if (!activeLayer) {
    return { id, name, coarsestLevel: selection.level, pxWidth: 0, pxHeight: 0, entries: [] };
  }

  const coarsestLevel = activeLayer.level;
  const acp = cellPx(coarsestLevel);
  const shiftPxX = activeLayer.shiftX * acp;
  const shiftPxY = activeLayer.shiftY * acp;

  const pxMinX = selection.startCellX * acp + shiftPxX;
  const pxMinY = selection.startCellY * acp + shiftPxY;
  const pxMaxX = (selection.endCellX + 1) * acp + shiftPxX;
  const pxMaxY = (selection.endCellY + 1) * acp + shiftPxY;

  const pxWidth = pxMaxX - pxMinX;
  const pxHeight = pxMaxY - pxMinY;

  const contained = getContainedLayerCells(
    state.layers,
    state.activeLayerId,
    coarsestLevel,
    pxMinX,
    pxMinY,
    pxMaxX,
    pxMaxY,
    state.deepEdit,
  );

  const entries: PatternEntry[] = [];
  for (const { layer, cellMinX, cellMinY, cellMaxX, cellMaxY } of contained) {
    const lcp = cellPx(layer.level);
    const lShiftX = layer.shiftX * lcp;
    const lShiftY = layer.shiftY * lcp;
    for (let cy = cellMinY; cy <= cellMaxY; cy++) {
      for (let cx = cellMinX; cx <= cellMaxX; cx++) {
        const cellState = layer.cells[cy]?.[cx];
        if (cellState === null || cellState === undefined) continue;
        entries.push({
          level: layer.level,
          pxOffX: cx * lcp + lShiftX - pxMinX,
          pxOffY: cy * lcp + lShiftY - pxMinY,
          state: cellState,
        });
      }
    }
  }

  return { id, name, coarsestLevel, pxWidth, pxHeight, entries };
}

// ── Rotate Pattern ──────────────────────────────────────────────────

export function rotatePattern(
  pattern: Pattern,
  rotation: 0 | 90 | 180 | 270,
): Pattern {
  if (rotation === 0) return pattern;

  const { pxWidth, pxHeight } = pattern;
  const centerX = pxWidth / 2;
  const centerY = pxHeight / 2;

  const newPxWidth = (rotation === 90 || rotation === 270) ? pxHeight : pxWidth;
  const newPxHeight = (rotation === 90 || rotation === 270) ? pxWidth : pxHeight;
  const newCenterX = newPxWidth / 2;
  const newCenterY = newPxHeight / 2;

  const newEntries: PatternEntry[] = pattern.entries.map((entry) => {
    const lcp = cellPx(entry.level);
    const ecx = entry.pxOffX + lcp / 2;
    const ecy = entry.pxOffY + lcp / 2;
    const dx = ecx - centerX;
    const dy = ecy - centerY;
    const [rdx, rdy] = rotateOffset(dx, dy, rotation);
    const newPxOffX = newCenterX + rdx - lcp / 2;
    const newPxOffY = newCenterY + rdy - lcp / 2;

    const st = entry.state!;
    return {
      level: entry.level,
      pxOffX: newPxOffX,
      pxOffY: newPxOffY,
      state: {
        ...st,
        transform: composeRotation(st.transform, rotation),
      } as CellState,
    };
  });

  return {
    ...pattern,
    pxWidth: newPxWidth,
    pxHeight: newPxHeight,
    entries: newEntries,
  };
}

// ── Apply Pattern Ops (single cell) ─────────────────────────────────

export function computePatternApplyOps(
  state: EditorState,
  pattern: Pattern,
  cellX: number,
  cellY: number,
): UndoOp[] {
  const activeLayer = state.layers.find((l) => l.id === state.activeLayerId);
  if (!activeLayer) return [];

  const pat = state.activePatternRotation !== 0
    ? rotatePattern(pattern, state.activePatternRotation)
    : pattern;

  const activeLevel = activeLayer.level;
  const acp = cellPx(activeLevel);

  // Level shifting: shift all entries so the pattern's coarsest level
  // aligns with the active level. Positive = shift down (finer),
  // negative = shift up (coarser).
  const levelOffset = pat.coarsestLevel - activeLevel;
  const scale = levelOffset !== 0 ? cellPx(activeLevel) / cellPx(pat.coarsestLevel as GridLevel) : 1;
  const scaledPxW = pat.pxWidth * scale;
  const scaledPxH = pat.pxHeight * scale;

  const origin = state.patternOrigin ?? { cellX, cellY };

  // Pixel area of the target cell
  const cellPxX = cellX * acp + activeLayer.shiftX * acp;
  const cellPxY = cellY * acp + activeLayer.shiftY * acp;

  // Pixel offset from origin in pattern-space
  const originPxX = origin.cellX * acp + activeLayer.shiftX * acp;
  const originPxY = origin.cellY * acp + activeLayer.shiftY * acp;

  const ops: UndoOp[] = [];

  // Find all tile instances that overlap this cell's pixel area
  const firstTileX = Math.floor((cellPxX - originPxX) / scaledPxW);
  const lastTileX = Math.floor((cellPxX + acp - 1 - originPxX) / scaledPxW);
  const firstTileY = Math.floor((cellPxY - originPxY) / scaledPxH);
  const lastTileY = Math.floor((cellPxY + acp - 1 - originPxY) / scaledPxH);

  for (let tiy = firstTileY; tiy <= lastTileY; tiy++) {
    for (let tix = firstTileX; tix <= lastTileX; tix++) {
      const tileOriginX = originPxX + tix * scaledPxW;
      const tileOriginY = originPxY + tiy * scaledPxH;

      for (const entry of pat.entries) {
        // Level shifting: shift entry level by offset, skip if out of range
        const targetLevelN = entry.level - levelOffset;
        if (targetLevelN < 0 || targetLevelN > 4) continue;
        const targetLevel = targetLevelN as GridLevel;
        const targetLayer = state.layers.find(
          (l) => l.level === targetLevel && !l.locked,
        );
        if (!targetLayer) continue;

        const entryFootprint = cellPx(entry.level) * scale;
        const tcp = cellPx(targetLevel);
        const tShiftX = targetLayer.shiftX * tcp;
        const tShiftY = targetLayer.shiftY * tcp;
        const tCount = CELL_COUNTS[targetLevel];

        const entryPxX = tileOriginX + entry.pxOffX * scale;
        const entryPxY = tileOriginY + entry.pxOffY * scale;

        // Check if the entry's pixel footprint overlaps this active-layer cell
        if (entryPxX + entryFootprint <= cellPxX || entryPxX >= cellPxX + acp) continue;
        if (entryPxY + entryFootprint <= cellPxY || entryPxY >= cellPxY + acp) continue;

        // Compute range of target cells within the overlap
        const overlapMinX = Math.max(entryPxX, cellPxX);
        const overlapMaxX = Math.min(entryPxX + entryFootprint, cellPxX + acp);
        const overlapMinY = Math.max(entryPxY, cellPxY);
        const overlapMaxY = Math.min(entryPxY + entryFootprint, cellPxY + acp);

        const tcMinX = Math.floor((overlapMinX - tShiftX) / tcp);
        const tcMaxX = Math.floor((overlapMaxX - 1 - tShiftX) / tcp);
        const tcMinY = Math.floor((overlapMinY - tShiftY) / tcp);
        const tcMaxY = Math.floor((overlapMaxY - 1 - tShiftY) / tcp);

        for (let tcy = tcMinY; tcy <= tcMaxY; tcy++) {
          for (let tcx = tcMinX; tcx <= tcMaxX; tcx++) {
            if (tcx < 0 || tcx >= tCount || tcy < 0 || tcy >= tCount) continue;

            const oldState = targetLayer.cells[tcy]?.[tcx] ?? null;
            ops.push({
              op: 'cell',
              layerId: targetLayer.id,
              cellX: tcx,
              cellY: tcy,
              oldState,
              newState: entry.state,
            });
          }
        }
      }
    }
  }

  return ops;
}

// ── Pattern Flood Fill ──────────────────────────────────────────────

export function computePatternFloodFillOps(
  state: EditorState,
  pattern: Pattern,
): UndoOp[] {
  const activeLayer = state.layers.find((l) => l.id === state.activeLayerId);
  if (!activeLayer) return [];

  const pat = state.activePatternRotation !== 0
    ? rotatePattern(pattern, state.activePatternRotation)
    : pattern;

  const activeLevel = activeLayer.level;
  const acp = cellPx(activeLevel);
  const aCount = CELL_COUNTS[activeLevel];

  // Level shifting: shift all entries so the pattern's coarsest level
  // aligns with the active level. Positive = shift down (finer),
  // negative = shift up (coarser).
  const levelOffset = pat.coarsestLevel - activeLevel;
  const scale = levelOffset !== 0 ? cellPx(activeLevel) / cellPx(pat.coarsestLevel as GridLevel) : 1;
  const scaledPxW = pat.pxWidth * scale;
  const scaledPxH = pat.pxHeight * scale;

  const origin = state.patternOrigin ?? { cellX: 0, cellY: 0 };
  const originPxX = origin.cellX * acp + activeLayer.shiftX * acp;
  const originPxY = origin.cellY * acp + activeLayer.shiftY * acp;

  const dedup = new Map<string, UndoOp>();

  for (let cy = 0; cy < aCount; cy++) {
    for (let cx = 0; cx < aCount; cx++) {
      const cellPxX = cx * acp + activeLayer.shiftX * acp;
      const cellPxY = cy * acp + activeLayer.shiftY * acp;

      const firstTileX = Math.floor((cellPxX - originPxX) / scaledPxW);
      const lastTileX = Math.floor((cellPxX + acp - 1 - originPxX) / scaledPxW);
      const firstTileY = Math.floor((cellPxY - originPxY) / scaledPxH);
      const lastTileY = Math.floor((cellPxY + acp - 1 - originPxY) / scaledPxH);

      for (let tiy = firstTileY; tiy <= lastTileY; tiy++) {
        for (let tix = firstTileX; tix <= lastTileX; tix++) {
          const tileOriginX = originPxX + tix * scaledPxW;
          const tileOriginY = originPxY + tiy * scaledPxH;

          for (const entry of pat.entries) {
            const targetLevelN = entry.level - levelOffset;
            if (targetLevelN < 0 || targetLevelN > 4) continue;
            const targetLevel = targetLevelN as GridLevel;
            const targetLayer = state.layers.find(
              (l) => l.level === targetLevel && !l.locked,
            );
            if (!targetLayer) continue;

            const entryFootprint = cellPx(entry.level) * scale;
            const tcp = cellPx(targetLevel);
            const tShiftX = targetLayer.shiftX * tcp;
            const tShiftY = targetLayer.shiftY * tcp;
            const tCount = CELL_COUNTS[targetLevel];

            const entryPxX = tileOriginX + entry.pxOffX * scale;
            const entryPxY = tileOriginY + entry.pxOffY * scale;

            if (entryPxX + entryFootprint <= cellPxX || entryPxX >= cellPxX + acp) continue;
            if (entryPxY + entryFootprint <= cellPxY || entryPxY >= cellPxY + acp) continue;

            const overlapMinX = Math.max(entryPxX, cellPxX);
            const overlapMaxX = Math.min(entryPxX + entryFootprint, cellPxX + acp);
            const overlapMinY = Math.max(entryPxY, cellPxY);
            const overlapMaxY = Math.min(entryPxY + entryFootprint, cellPxY + acp);

            const tcMinX = Math.floor((overlapMinX - tShiftX) / tcp);
            const tcMaxX = Math.floor((overlapMaxX - 1 - tShiftX) / tcp);
            const tcMinY = Math.floor((overlapMinY - tShiftY) / tcp);
            const tcMaxY = Math.floor((overlapMaxY - 1 - tShiftY) / tcp);

            for (let tcy = tcMinY; tcy <= tcMaxY; tcy++) {
              for (let tcx = tcMinX; tcx <= tcMaxX; tcx++) {
                if (tcx < 0 || tcx >= tCount || tcy < 0 || tcy >= tCount) continue;

                const key = `${targetLayer.id},${tcx},${tcy}`;
                const oldState = targetLayer.cells[tcy]?.[tcx] ?? null;
                dedup.set(key, {
                  op: 'cell',
                  layerId: targetLayer.id,
                  cellX: tcx,
                  cellY: tcy,
                  oldState,
                  newState: entry.state,
                });
              }
            }
          }
        }
      }
    }
  }

  return Array.from(dedup.values());
}
