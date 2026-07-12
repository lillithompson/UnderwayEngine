import { Layer, CELL_COUNTS } from './types';
import { connectionPointL0, getRenderedSignature } from './connectivity';
import type { CellAtPoint } from './connectivity';

const GRID_SIZE = 65; // L0 coords 0..32, multiplied by 2 → 0..64
const BUCKET_COUNT = GRID_SIZE * GRID_SIZE; // 4225

/**
 * Flat spatial hash for L0 connection point queries.
 *
 * L0 connection points are half-integers in [0, 32].  Multiplying by 2
 * produces integers in [0, 64], giving a 65×65 = 4,225 slot flat array.
 * Each slot holds a small list of indexed entries.  Point queries are a
 * single array lookup + small bucket scan — O(1) vs the O(layers × 8)
 * linear scan in findCellsAtL0Point.
 */
export class L0PointIndex {
  /** 4225 buckets, each a small array of pool entries. */
  private buckets: CellAtPoint[][];
  /** Pre-allocated object pool to avoid GC during flood fill. */
  private pool: CellAtPoint[];
  /** Next free slot in the pool. */
  private poolIdx: number;

  /** Shared query output — caller must consume before next queryPoint call. */
  readonly queryResults: CellAtPoint[] = [];
  queryResultsCount: number = 0;

  constructor(poolSize: number = 10_000) {
    this.buckets = new Array(BUCKET_COUNT);
    for (let i = 0; i < BUCKET_COUNT; i++) {
      this.buckets[i] = [];
    }
    this.pool = new Array(poolSize);
    for (let i = 0; i < poolSize; i++) {
      this.pool[i] = { layer: null as unknown as Layer, cellX: 0, cellY: 0, pointIndex: 0, value: false };
    }
    this.poolIdx = 0;
  }

  private allocEntry(): CellAtPoint {
    if (this.poolIdx < this.pool.length) {
      return this.pool[this.poolIdx++];
    }
    const entry: CellAtPoint = { layer: null as unknown as Layer, cellX: 0, cellY: 0, pointIndex: 0, value: false };
    this.pool.push(entry);
    this.poolIdx++;
    return entry;
  }

  private static bucketKey(l0x: number, l0y: number): number {
    return Math.round(l0y * 2) * GRID_SIZE + Math.round(l0x * 2);
  }

  /** Build the full index from a set of layers (typically constraintLayers). */
  buildFromLayers(layers: Layer[]): void {
    this.clear();
    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li];
      if (!layer.visible) continue;
      const count = CELL_COUNTS[layer.level];
      for (let cy = 0; cy < count; cy++) {
        const row = layer.cells[cy];
        if (!row) continue;
        for (let cx = 0; cx < count; cx++) {
          const cell = row[cx];
          if (!cell || cell.type !== 'sprite') continue;
          const sig = getRenderedSignature(cell);
          if (!sig) continue;
          this.insertWithSig(layer, cx, cy, sig);
        }
      }
    }
  }

  /** Insert a single cell's 8 connection points into the index. */
  insertCell(layer: Layer, cellX: number, cellY: number): void {
    const cell = layer.cells[cellY]?.[cellX];
    if (!cell || cell.type !== 'sprite') return;
    const sig = getRenderedSignature(cell);
    if (!sig) return;
    this.insertWithSig(layer, cellX, cellY, sig);
  }

  private insertWithSig(layer: Layer, cellX: number, cellY: number, sig: boolean[]): void {
    for (let p = 0; p < 8; p++) {
      const cp = connectionPointL0(cellX, cellY, p, layer.level, layer.shiftX, layer.shiftY);
      const key = L0PointIndex.bucketKey(cp.x, cp.y);
      if (key < 0 || key >= BUCKET_COUNT) continue;
      const entry = this.allocEntry();
      entry.layer = layer;
      entry.cellX = cellX;
      entry.cellY = cellY;
      entry.pointIndex = p;
      entry.value = sig[p];
      this.buckets[key].push(entry);
    }
  }

  /** Remove a cell's 8 connection points from the index. */
  removeCell(layer: Layer, cellX: number, cellY: number): void {
    for (let p = 0; p < 8; p++) {
      const cp = connectionPointL0(cellX, cellY, p, layer.level, layer.shiftX, layer.shiftY);
      const key = L0PointIndex.bucketKey(cp.x, cp.y);
      if (key < 0 || key >= BUCKET_COUNT) continue;
      const bucket = this.buckets[key];
      for (let i = bucket.length - 1; i >= 0; i--) {
        const e = bucket[i];
        if (e.layer === layer && e.cellX === cellX && e.cellY === cellY && e.pointIndex === p) {
          // Swap-remove for O(1)
          bucket[i] = bucket[bucket.length - 1];
          bucket.pop();
          break;
        }
      }
    }
  }

  /**
   * Find all indexed connection points at (l0x, l0y), excluding the given cell.
   * Results are written to this.queryResults / this.queryResultsCount.
   * Caller must consume before the next queryPoint call.
   */
  queryPoint(
    l0x: number,
    l0y: number,
    excludeLayer: Layer,
    excludeCellX: number,
    excludeCellY: number,
  ): void {
    this.queryResultsCount = 0;
    const key = L0PointIndex.bucketKey(l0x, l0y);
    if (key < 0 || key >= BUCKET_COUNT) return;
    const bucket = this.buckets[key];
    for (let i = 0; i < bucket.length; i++) {
      const e = bucket[i];
      if (e.layer === excludeLayer && e.cellX === excludeCellX && e.cellY === excludeCellY) continue;
      if (this.queryResultsCount >= this.queryResults.length) {
        this.queryResults.push(e);
      } else {
        this.queryResults[this.queryResultsCount] = e;
      }
      this.queryResultsCount++;
    }
  }

  /** Reset all buckets and reclaim pool entries. */
  clear(): void {
    for (let i = 0; i < BUCKET_COUNT; i++) {
      this.buckets[i].length = 0;
    }
    this.poolIdx = 0;
  }
}
