/**
 * Regression: toggling pattern mode on a clipped join makes geometry
 * disappear. The tile-content builder was computing its translation origin
 * from all segment points including arc centers, but arc centers can lie
 * outside the clamped bbox after clipArcToRect(). This pushed all visible
 * geometry past the rasterizer's viewBox.
 *
 * Fix: use obj.cellX/cellY as the tile origin instead of the segment-
 * derived minimum.
 */

import { buildSVGObjectTileContent, buildTilePathD } from '../svgPathBuilder';
import { SVG_UNITS_PER_L0_CELL } from '../svgExport';
import type { SVGObject, PathSegment } from '../types';

/** Extract positional x,y coordinates from an SVG path `d` string.
 *  Parses M x,y and L x,y endpoints as well as the final x,y of A commands,
 *  skipping radius/flag values. */
function parsePositionalCoords(d: string): { x: number; y: number }[] {
  const coords: { x: number; y: number }[] = [];
  // Match M x,y and L x,y
  const mlRe = /[ML]\s+(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = mlRe.exec(d)) !== null) {
    coords.push({ x: Number(m[1]), y: Number(m[2]) });
  }
  // Match A rx,ry rotation large-arc-flag,sweep-flag x,y
  const arcRe = /A\s+[\d.]+,[\d.]+\s+[\d.]+\s+[\d.,]+\s+(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g;
  while ((m = arcRe.exec(d)) !== null) {
    coords.push({ x: Number(m[1]), y: Number(m[2]) });
  }
  return coords;
}

describe('tile content uses cellX/cellY origin (not segment min)', () => {
  const U = SVG_UNITS_PER_L0_CELL;

  // Arc whose center is far outside the clamped bbox.
  const arcSeg: PathSegment = {
    kind: 'arc',
    start: [5, 5],
    end: [15, 5],
    center: [-10, 5],   // well outside cellX=5
  };

  const obj: SVGObject = {
    id: 'test_clip_tile',
    segments: [arcSeg],
    color: { r: 0, g: 0, b: 0 },
    cellX: 5,
    cellY: 3,
    cellWidth: 10,
    cellHeight: 4,
  };

  it('buildSVGObjectTileContent coordinates stay within viewBox', () => {
    const content = buildSVGObjectTileContent(obj, 1);
    expect(content).not.toBe('');

    const coords = parsePositionalCoords(content);
    expect(coords.length).toBeGreaterThan(0);
    const viewBoxW = obj.cellWidth * U;
    const viewBoxH = obj.cellHeight * U;
    for (const { x, y } of coords) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(viewBoxW + 1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(viewBoxH + 1);
    }
  });

  it('buildTilePathD with cellX/cellY produces in-bounds coordinates', () => {
    const d = buildTilePathD(obj.segments, obj.cellX, obj.cellY);
    expect(d).not.toBe('');

    const coords = parsePositionalCoords(d);
    expect(coords.length).toBeGreaterThan(0);
    const viewBoxW = obj.cellWidth * U;
    const viewBoxH = obj.cellHeight * U;
    for (const { x, y } of coords) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(viewBoxW + 1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(viewBoxH + 1);
    }
  });

  it('handles line-only segments identically to before', () => {
    const lineSeg: PathSegment = {
      kind: 'line',
      start: [2, 3],
      end: [8, 7],
    };
    const lineObj: SVGObject = {
      id: 'test_line_tile',
      segments: [lineSeg],
      color: { r: 255, g: 0, b: 0 },
      cellX: 2,
      cellY: 3,
      cellWidth: 6,
      cellHeight: 4,
    };
    const content = buildSVGObjectTileContent(lineObj, 1);
    expect(content).not.toBe('');

    // Start should translate to (0,0), end to (6*U, 4*U)
    const coords = parsePositionalCoords(content);
    expect(coords).toContainEqual({ x: 0, y: 0 });
    expect(coords).toContainEqual({ x: 6 * U, y: 4 * U });
  });
});

describe('tile content stays fixed after origin-side region expansion', () => {
  const U = SVG_UNITS_PER_L0_CELL;

  // Base object: a line from (5,3) to (8,7), tile = full bbox
  const baseSeg: PathSegment = {
    kind: 'line',
    start: [5, 3],
    end: [8, 7],
  };

  it('expanding upward — tile content matches pre-expansion output', () => {
    // Before expansion
    const before: SVGObject = {
      id: 'exp_up',
      segments: [baseSeg],
      color: { r: 0, g: 0, b: 0 },
      cellX: 5, cellY: 3, cellWidth: 3, cellHeight: 4,
      tileMode: 'repeat',
      tileWidthL0: 3, tileHeightL0: 4,
    };
    // After expanding up by 2: cellY decreases, tileOffsetYL0 compensates
    const after: SVGObject = {
      ...before,
      cellY: 1, cellHeight: 6,
      tileOffsetYL0: 2, // = -(newCellY - oldCellY) = -(1-3) = 2
    };

    const contentBefore = buildSVGObjectTileContent(before, 1);
    const contentAfter = buildSVGObjectTileContent(after, 1);
    expect(contentAfter).toBe(contentBefore);
  });

  it('expanding leftward — tile content matches pre-expansion output', () => {
    const before: SVGObject = {
      id: 'exp_left',
      segments: [baseSeg],
      color: { r: 0, g: 0, b: 0 },
      cellX: 5, cellY: 3, cellWidth: 3, cellHeight: 4,
      tileMode: 'repeat',
      tileWidthL0: 3, tileHeightL0: 4,
    };
    const after: SVGObject = {
      ...before,
      cellX: 2, cellWidth: 6,
      tileOffsetXL0: 3,
    };

    const contentBefore = buildSVGObjectTileContent(before, 1);
    const contentAfter = buildSVGObjectTileContent(after, 1);
    expect(contentAfter).toBe(contentBefore);
  });

  it('expanding both up and left — tile content matches pre-expansion output', () => {
    const before: SVGObject = {
      id: 'exp_both',
      segments: [baseSeg],
      color: { r: 0, g: 0, b: 0 },
      cellX: 5, cellY: 3, cellWidth: 3, cellHeight: 4,
      tileMode: 'repeat',
      tileWidthL0: 3, tileHeightL0: 4,
    };
    const after: SVGObject = {
      ...before,
      cellX: 2, cellY: 0,
      cellWidth: 6, cellHeight: 7,
      tileOffsetXL0: 3, tileOffsetYL0: 3,
    };

    const contentBefore = buildSVGObjectTileContent(before, 1);
    const contentAfter = buildSVGObjectTileContent(after, 1);
    expect(contentAfter).toBe(contentBefore);
  });

  it('expanding down/right (no tileOffset change) — still works', () => {
    const before: SVGObject = {
      id: 'exp_dr',
      segments: [baseSeg],
      color: { r: 0, g: 0, b: 0 },
      cellX: 5, cellY: 3, cellWidth: 3, cellHeight: 4,
      tileMode: 'repeat',
      tileWidthL0: 3, tileHeightL0: 4,
    };
    // Expanding down/right doesn't change cellX/cellY, no offset needed
    const after: SVGObject = {
      ...before,
      cellWidth: 6, cellHeight: 8,
    };

    const contentBefore = buildSVGObjectTileContent(before, 1);
    const contentAfter = buildSVGObjectTileContent(after, 1);
    expect(contentAfter).toBe(contentBefore);
  });

  it('content coordinates stay within tile viewBox after expansion', () => {
    const expanded: SVGObject = {
      id: 'exp_bounds',
      segments: [baseSeg],
      color: { r: 0, g: 0, b: 0 },
      cellX: 2, cellY: 0, cellWidth: 9, cellHeight: 10,
      tileMode: 'repeat',
      tileWidthL0: 3, tileHeightL0: 4,
      tileOffsetXL0: 3, tileOffsetYL0: 3,
    };

    const content = buildSVGObjectTileContent(expanded, 1);
    expect(content).not.toBe('');

    const coords = parsePositionalCoords(content);
    expect(coords.length).toBeGreaterThan(0);
    // Content must fit within one tile (tileWidthL0 x tileHeightL0)
    const tileViewW = expanded.tileWidthL0! * U;
    const tileViewH = expanded.tileHeightL0! * U;
    for (const { x, y } of coords) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(tileViewW + 1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(tileViewH + 1);
    }
  });
});
