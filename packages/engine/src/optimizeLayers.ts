import { Layer, CellState, CELL_COUNTS } from './types';

export interface CellPlan {
  cellX: number;
  cellY: number;
  state: CellState;
}

export interface MergePlan {
  survivorId: string;
  donorId: string;
  cells: CellPlan[];
}

export interface OptimizeResult {
  /** IDs of all removed layers (empty + merged donors) */
  removals: string[];
  /** Details for each successful merge */
  merges: MergePlan[];
  /** Non-null if the active layer was removed */
  newActiveLayerId: string | null;
  /** Whether any changes occurred */
  changed: boolean;
}

function isLayerEmpty(layer: Layer): boolean {
  const count = CELL_COUNTS[layer.level];
  for (let y = 0; y < count; y++) {
    for (let x = 0; x < count; x++) {
      if (layer.cells[y][x] != null) return false;
    }
  }
  if (layer.edgeRowTop) {
    for (let i = 0; i < layer.edgeRowTop.length; i++) {
      if (layer.edgeRowTop[i] != null) return false;
    }
  }
  if (layer.edgeColLeft) {
    for (let i = 0; i < layer.edgeColLeft.length; i++) {
      if (layer.edgeColLeft[i] != null) return false;
    }
  }
  if (layer.edgeCorner != null) return false;
  return true;
}

function timestampFromId(id: string): number {
  const parts = id.split('_');
  const ts = parseInt(parts[parts.length - 1], 10);
  return isNaN(ts) ? 0 : ts;
}

/**
 * Compute an optimization plan for the given layers without mutating anything.
 * Phase 1: remove unlocked, visible empty layers (keeping at least one).
 * Phase 2: merge compatible non-overlapping unlocked, visible layers
 * grouped by (level, shiftX, shiftY). Hidden or locked layers are never
 * removed or merged.
 */
export function computeOptimizePlan(
  layers: readonly Layer[],
  activeLayerId: string,
): OptimizeResult {
  const removals: string[] = [];
  const merges: MergePlan[] = [];
  // Track which survivor absorbed each donor (for active-layer redirect)
  const donorToSurvivor = new Map<string, string>();

  // --- Phase 1: Remove empty layers ---
  const emptyIds: string[] = [];
  for (const layer of layers) {
    if (layer.locked || !layer.visible) continue;
    if (isLayerEmpty(layer)) emptyIds.push(layer.id);
  }

  // Conservation: if removing all empties leaves 0 layers, keep the coarsest one
  const nonEmptyCount = layers.length - emptyIds.length;
  let keptEmptyId: string | null = null;
  if (nonEmptyCount === 0 && emptyIds.length > 0) {
    // Keep the empty layer with the highest level (coarsest grid)
    // Tiebreak: oldest (lowest timestamp)
    let best: Layer | null = null;
    for (const layer of layers) {
      if (!emptyIds.includes(layer.id)) continue;
      if (
        !best ||
        layer.level > best.level ||
        (layer.level === best.level &&
          timestampFromId(layer.id) < timestampFromId(best.id))
      ) {
        best = layer;
      }
    }
    keptEmptyId = best!.id;
  }

  for (const id of emptyIds) {
    if (id === keptEmptyId) continue;
    removals.push(id);
  }

  // --- Phase 2: Merge compatible layers ---
  const removedSet = new Set(removals);
  const remaining = layers.filter((l) => !removedSet.has(l.id));

  // Group by (level, shiftX, shiftY)
  const groups = new Map<string, Layer[]>();
  for (const layer of remaining) {
    const key = `${layer.level}_${layer.shiftX}_${layer.shiftY}`;
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push(layer);
  }

  for (const group of groups.values()) {
    const unlocked = group.filter((l) => !l.locked && l.visible);
    if (unlocked.length < 2) continue;

    // Sort by creation timestamp (oldest first)
    unlocked.sort((a, b) => timestampFromId(a.id) - timestampFromId(b.id));

    const survivor = unlocked[0];
    const count = CELL_COUNTS[survivor.level];

    // Build a mutable copy of the survivor's cell state to track merged result
    const merged: (CellState | null)[][] = [];
    for (let y = 0; y < count; y++) {
      merged[y] = [];
      for (let x = 0; x < count; x++) {
        merged[y][x] = survivor.cells[y][x];
      }
    }
    const mergedEdgeRowTop = survivor.edgeRowTop ? [...survivor.edgeRowTop] : null;
    const mergedEdgeColLeft = survivor.edgeColLeft ? [...survivor.edgeColLeft] : null;
    let mergedEdgeCorner = survivor.edgeCorner;

    // Try each donor
    for (let d = 1; d < unlocked.length; d++) {
      const donor = unlocked[d];
      const donorCount = CELL_COUNTS[donor.level];
      if (donorCount !== count) continue; // different array length → skip

      // Check for overlaps
      const cellsToMerge: CellPlan[] = [];
      let overlap = false;

      for (let y = 0; y < count && !overlap; y++) {
        for (let x = 0; x < count && !overlap; x++) {
          const donorCell = donor.cells[y][x];
          const survivorCell = merged[y][x];
          if (donorCell != null && survivorCell != null) {
            overlap = true;
          } else if (donorCell != null) {
            cellsToMerge.push({ cellX: x, cellY: y, state: donorCell });
          }
        }
      }

      // Check edge cells
      if (!overlap && donor.edgeRowTop && mergedEdgeRowTop) {
        for (let i = 0; i < donor.edgeRowTop.length && !overlap; i++) {
          if (donor.edgeRowTop[i] != null && mergedEdgeRowTop[i] != null) {
            overlap = true;
          } else if (donor.edgeRowTop[i] != null) {
            cellsToMerge.push({ cellX: i, cellY: -1, state: donor.edgeRowTop[i]! });
          }
        }
      }
      if (!overlap && donor.edgeColLeft && mergedEdgeColLeft) {
        for (let i = 0; i < donor.edgeColLeft.length && !overlap; i++) {
          if (donor.edgeColLeft[i] != null && mergedEdgeColLeft[i] != null) {
            overlap = true;
          } else if (donor.edgeColLeft[i] != null) {
            cellsToMerge.push({ cellX: -1, cellY: i, state: donor.edgeColLeft[i]! });
          }
        }
      }
      if (!overlap && donor.edgeCorner != null) {
        if (mergedEdgeCorner != null) {
          overlap = true;
        } else {
          cellsToMerge.push({ cellX: -1, cellY: -1, state: donor.edgeCorner });
        }
      }

      if (overlap) continue;

      // Merge succeeds: update merged state
      for (const { cellX, cellY, state } of cellsToMerge) {
        if (cellX === -1 && cellY === -1) {
          mergedEdgeCorner = state;
        } else if (cellY === -1) {
          mergedEdgeRowTop![cellX] = state;
        } else if (cellX === -1) {
          mergedEdgeColLeft![cellY] = state;
        } else {
          merged[cellY][cellX] = state;
        }
      }

      merges.push({
        survivorId: survivor.id,
        donorId: donor.id,
        cells: cellsToMerge,
      });
      removals.push(donor.id);
      donorToSurvivor.set(donor.id, survivor.id);
    }
  }

  // --- Active layer handling ---
  let newActiveLayerId: string | null = null;
  const allRemovals = new Set(removals);
  if (allRemovals.has(activeLayerId)) {
    const survivorId = donorToSurvivor.get(activeLayerId);
    if (survivorId) {
      newActiveLayerId = survivorId;
    } else {
      // Removed as empty — pick first remaining layer
      const first = layers.find((l) => !allRemovals.has(l.id));
      newActiveLayerId = first ? first.id : null;
    }
  }

  const changed = removals.length > 0;
  return { removals, merges, newActiveLayerId, changed };
}
