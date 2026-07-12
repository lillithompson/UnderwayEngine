import { RGBColor, SVGObject } from '../types';
import {
  packKey,
  unpackKey,
  svgTileGrid,
  worldToTile,
  tileInRegion,
  tileWorldCenter,
  tileWorldOrigin,
  totalInstances,
  countPaintedInstances,
  shouldFullyExpandTiles,
  remapOverrides,
  cloneOverrides,
  SegmentOverrides,
  MAX_SPARSE_PAINTED_INSTANCES,
} from '../tileSegmentOverrides';

const RED: RGBColor = { r: 255, g: 0, b: 0 };
const BLUE: RGBColor = { r: 0, g: 0, b: 255 };

/** Minimal tiled SVG object. A `tw × tw` tile filling a `cols×rows` region
 *  anchored at (cellX, cellY). */
function tiled(opts: Partial<SVGObject> & {
  cellX: number; cellY: number; cellWidth: number; cellHeight: number;
}): SVGObject {
  return {
    id: 's',
    segments: [],
    color: RED,
    tileMode: 'repeat',
    tileWidthL0: opts.cellWidth,
    tileHeightL0: opts.cellHeight,
    ...opts,
  } as SVGObject;
}

describe('packKey / unpackKey', () => {
  it('round-trips representable triples (incl. negative anchor-relative indices)', () => {
    for (const [c, r, s] of [[0, 0, 0], [1, 2, 3], [-512, 511, 4095], [-1, -7, 11], [5, 0, 11]]) {
      const k = packKey(c, r, s)!;
      expect(k).not.toBeNull();
      expect(k).toBeGreaterThanOrEqual(0);
      expect(unpackKey(k)).toEqual({ col: c, row: r, segIdx: s });
    }
  });

  it('returns null for out-of-range components', () => {
    expect(packKey(-513, 0, 0)).toBeNull(); // below -512
    expect(packKey(0, 512, 0)).toBeNull();  // above 511
    expect(packKey(0, 0, -1)).toBeNull();
    expect(packKey(512, 0, 0)).toBeNull();
    expect(packKey(0, 0, 4096)).toBeNull();
  });

  it('produces distinct keys for distinct triples', () => {
    const a = packKey(2, 3, 4)!;
    const b = packKey(3, 2, 4)!;
    const c = packKey(2, 3, 5)!;
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe('svgTileGrid', () => {
  it('computes a simple aligned grid (no offset)', () => {
    const obj = tiled({ cellX: 0, cellY: 0, cellWidth: 30, cellHeight: 20, tileWidthL0: 10, tileHeightL0: 10 });
    const g = svgTileGrid(obj);
    expect(g.twL0).toBe(10);
    expect([g.colMin, g.colMax]).toEqual([0, 2]); // 3 columns
    expect([g.rowMin, g.rowMax]).toEqual([0, 1]); // 2 rows
  });

  it('accounts for a fractional tile offset (origin-side resize)', () => {
    // anchor = cellX + offset = 0 + 3 = 3; grid lines at ...,-7,3,13,23,...
    // Region 0..30 intersects tiles at indices -1,0,1,2 → 4 columns.
    const obj = tiled({ cellX: 0, cellY: 0, cellWidth: 30, cellHeight: 10, tileWidthL0: 10, tileHeightL0: 10, tileOffsetXL0: 3 });
    const g = svgTileGrid(obj);
    expect(g.anchorX).toBe(3);
    expect([g.colMin, g.colMax]).toEqual([-1, 2]); // 4 columns
  });

  it('keeps a physical copy at the same index across an origin-side resize', () => {
    // Resize that extends the region leftward (cellX 0 → -25) while keeping
    // the anchor fixed by adjusting the offset. A copy at world x≈15 must
    // keep the same anchor-relative col index.
    const a = tiled({ cellX: 0, cellY: 0, cellWidth: 30, cellHeight: 10, tileWidthL0: 10, tileHeightL0: 10 });
    const b = tiled({ cellX: -25, cellY: 0, cellWidth: 55, cellHeight: 10, tileWidthL0: 10, tileHeightL0: 10, tileOffsetXL0: 25 });
    expect(svgTileGrid(b).anchorX).toBe(svgTileGrid(a).anchorX); // anchor preserved
    expect(worldToTile(a, 15, 5)).toEqual(worldToTile(b, 15, 5));
  });
});

describe('worldToTile / tileInRegion', () => {
  const obj = tiled({ cellX: 0, cellY: 0, cellWidth: 30, cellHeight: 20, tileWidthL0: 10, tileHeightL0: 10 });

  it('maps interior points to their cell', () => {
    expect(worldToTile(obj, 5, 5)).toEqual({ col: 0, row: 0 });
    expect(worldToTile(obj, 15, 5)).toEqual({ col: 1, row: 0 });
    expect(worldToTile(obj, 25, 15)).toEqual({ col: 2, row: 1 });
  });

  it('cell boundaries belong to the higher cell', () => {
    expect(worldToTile(obj, 10, 0)).toEqual({ col: 1, row: 0 });
  });

  it('tileInRegion bounds-checks', () => {
    expect(tileInRegion(obj, 0, 0)).toBe(true);
    expect(tileInRegion(obj, 2, 1)).toBe(true);
    expect(tileInRegion(obj, 3, 0)).toBe(false);
    expect(tileInRegion(obj, 0, 2)).toBe(false);
    expect(tileInRegion(obj, -1, 0)).toBe(false);
  });

  it('worldToTile and tileWorldCenter are inverse on interior cells', () => {
    for (let c = 0; c < 3; c++) {
      for (let r = 0; r < 2; r++) {
        const ctr = tileWorldCenter(obj, c, r);
        expect(worldToTile(obj, ctr.x, ctr.y)).toEqual({ col: c, row: r });
      }
    }
  });

  it('tileWorldOrigin gives the cell top-left', () => {
    expect(tileWorldOrigin(obj, 1, 1)).toEqual({ x: 10, y: 10 });
  });
});

describe('instance counting + fallback', () => {
  const obj = tiled({ cellX: 0, cellY: 0, cellWidth: 40, cellHeight: 40, tileWidthL0: 10, tileHeightL0: 10 });

  it('totalInstances = cols × rows', () => {
    expect(totalInstances(obj)).toBe(16);
  });

  it('countPaintedInstances counts distinct (col,row), not segments', () => {
    const ov: SegmentOverrides = new Map();
    ov.set(packKey(0, 0, 0)!, RED);
    ov.set(packKey(0, 0, 1)!, BLUE); // same instance, different segment
    ov.set(packKey(1, 0, 0)!, RED);
    expect(ov.size).toBe(3);
    expect(countPaintedInstances(ov)).toBe(2);
  });

  it('shouldFullyExpandTiles false when sparsely painted', () => {
    const ov: SegmentOverrides = new Map([[packKey(0, 0, 0)!, RED]]);
    expect(shouldFullyExpandTiles({ ...obj, segmentOverrides: ov })).toBe(false);
  });

  it('shouldFullyExpandTiles true past the half-region fraction', () => {
    const ov: SegmentOverrides = new Map();
    // Paint 9 of 16 instances (> 50%).
    let n = 0;
    for (let c = 0; c < 4 && n < 9; c++) for (let r = 0; r < 4 && n < 9; r++, n++) ov.set(packKey(c, r, 0)!, RED);
    expect(countPaintedInstances(ov)).toBe(9);
    expect(shouldFullyExpandTiles({ ...obj, segmentOverrides: ov })).toBe(true);
  });

  it('shouldFullyExpandTiles true past the absolute cap', () => {
    // Large region (50×50 tiles = 2500), paint MAX+1 instances (< 50%).
    const big = tiled({ cellX: 0, cellY: 0, cellWidth: 500, cellHeight: 500, tileWidthL0: 10, tileHeightL0: 10 });
    const ov: SegmentOverrides = new Map();
    let painted = 0;
    outer: for (let c = 0; c < 50; c++) for (let r = 0; r < 50; r++) {
      ov.set(packKey(c, r, 0)!, RED);
      if (++painted > MAX_SPARSE_PAINTED_INSTANCES) break outer;
    }
    expect(countPaintedInstances(ov)).toBeGreaterThan(MAX_SPARSE_PAINTED_INSTANCES);
    expect(countPaintedInstances(ov)).toBeLessThan(0.5 * totalInstances(big));
    expect(shouldFullyExpandTiles({ ...big, segmentOverrides: ov })).toBe(true);
  });
});

describe('remapOverrides (transform re-keying)', () => {
  // Square 4×4-tile region so a 90° rotation maps the grid onto itself
  // (cols === rows). 90° CW about center (S/2,S/2): (x,y) → (S - y, x).
  const S = 40;
  const sq = tiled({ cellX: 0, cellY: 0, cellWidth: S, cellHeight: S, tileWidthL0: 10, tileHeightL0: 10 });
  const rot90CW = (x: number, y: number) => ({ x: S - y, y: x });

  it('maps (col,row) → (N-1-row, col) under one 90° CW step', () => {
    const ov: SegmentOverrides = new Map([[packKey(0, 0, 2)!, RED]]);
    const out = remapOverrides(ov, sq, sq, rot90CW);
    // tile (0,0) center (5,5) → (35,5) → col 3,row 0. Segment index kept.
    expect(out.size).toBe(1);
    expect(unpackKey([...out.keys()][0])).toEqual({ col: 3, row: 0, segIdx: 2 });
  });

  it('a 4× 90° cycle returns to the original keys', () => {
    const ov: SegmentOverrides = new Map([
      [packKey(0, 0, 0)!, RED],
      [packKey(1, 2, 5)!, BLUE],
      [packKey(3, 3, 1)!, RED],
    ]);
    let cur = ov;
    for (let i = 0; i < 4; i++) cur = remapOverrides(cur, sq, sq, rot90CW);
    expect(cur.size).toBe(ov.size);
    for (const [k, v] of ov) expect(cur.get(k)).toEqual(v);
  });

  it('drops overrides whose mapped center leaves the post-transform region', () => {
    // Map identity but shrink target region to 2×2 tiles: a key at col 3
    // falls outside and is dropped.
    const small = tiled({ cellX: 0, cellY: 0, cellWidth: 20, cellHeight: 20, tileWidthL0: 10, tileHeightL0: 10 });
    const ov: SegmentOverrides = new Map([
      [packKey(0, 0, 0)!, RED],
      [packKey(3, 0, 0)!, BLUE],
    ]);
    const out = remapOverrides(ov, sq, small, (x, y) => ({ x, y }));
    expect(countPaintedInstances(out)).toBe(1);
    expect(unpackKey([...out.keys()][0])).toEqual({ col: 0, row: 0, segIdx: 0 });
  });
});

describe('cloneOverrides', () => {
  it('returns an independent map', () => {
    const ov: SegmentOverrides = new Map([[packKey(0, 0, 0)!, RED]]);
    const copy = cloneOverrides(ov)!;
    copy.set(packKey(1, 1, 1)!, BLUE);
    expect(ov.size).toBe(1);
    expect(copy.size).toBe(2);
  });

  it('passes undefined through', () => {
    expect(cloneOverrides(undefined)).toBeUndefined();
  });
});
