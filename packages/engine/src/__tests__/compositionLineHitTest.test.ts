import { lineBoundingBox, findLineAtCell } from '../compositionLineHitTest';
import { SVGObject } from '../types';
import { computeSVGBbox } from '../compositionOps';

function makeLine(id: string, segments: {kind:'line', start:[number,number], end:[number,number]}[], locked = false): SVGObject {
  return { id, segments, color: { r: 255, g: 255, b: 255 }, locked, ...computeSVGBbox(segments) };
}

describe('lineBoundingBox', () => {
  test('returns null for empty segment list', () => {
    expect(lineBoundingBox({ segments: [] })).toBeNull();
  });

  test('single segment collapses to a zero-area AABB', () => {
    expect(lineBoundingBox({ segments: [{ start: [5, 7], end: [5, 7] }] })).toEqual({ minX: 5, minY: 7, maxX: 5, maxY: 7 });
  });

  test('multi-segment AABB spans extreme coords', () => {
    expect(lineBoundingBox({ segments: [
      { start: [0, 5], end: [10, 0] },
      { start: [10, 0], end: [3, 8] },
    ] })).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 8 });
  });

  test('prefers creationBox when present', () => {
    expect(lineBoundingBox({
      segments: [{ start: [4, 6], end: [8, 6] }],
      creationBox: { minX: 4, minY: 4, width: 4, height: 4 },
    })).toEqual({ minX: 4, minY: 4, maxX: 8, maxY: 8 });
  });

  test('falls back to segment AABB when creationBox is absent', () => {
    expect(lineBoundingBox({
      segments: [{ start: [4, 6], end: [8, 6] }],
    })).toEqual({ minX: 4, minY: 6, maxX: 8, maxY: 6 });
  });
});

describe('findLineAtCell (bounding-box selection)', () => {
  test('hit inside bounding box selects the line', () => {
    const lines = [makeLine('a', [{kind:'line', start:[0,0], end:[10,10]}])];
    // The diagonal line from (0,0) to (10,10) — point (5, 8) is far from
    // the stroke but well inside the AABB. AABB selection accepts it.
    expect(findLineAtCell(5, 8, lines)).toBe('a');
  });

  test('hit outside bounding box returns null', () => {
    const lines = [makeLine('a', [{kind:'line', start:[0,0], end:[10,0]}])];
    expect(findLineAtCell(5, 5, lines)).toBeNull();
  });

  test('returns topmost (last) line when both AABBs contain the point', () => {
    const lines = [
      makeLine('bottom', [{kind:'line', start:[0,0], end:[20,20]}]),
      makeLine('top', [{kind:'line', start:[5,5], end:[15,15]}]),
    ];
    expect(findLineAtCell(10, 10, lines)).toBe('top');
  });

  test('skips locked lines and returns the next match', () => {
    const lines = [
      makeLine('locked', [{kind:'line', start:[0,0], end:[10,10]}], true),
      makeLine('unlocked', [{kind:'line', start:[0,0], end:[20,20]}]),
    ];
    expect(findLineAtCell(5, 5, lines)).toBe('unlocked');
  });

  test('returns null when the only matching line is locked', () => {
    const lines = [makeLine('a', [{kind:'line', start:[0,0], end:[10,0]}], true)];
    expect(findLineAtCell(5, 0, lines)).toBeNull();
  });

  test('horizontal-only line still selectable (degenerate Y inflated)', () => {
    // Segments on the same Y collapse to a 0-height AABB. The hit-test
    // inflates degenerate axes so the user can still select it.
    const lines = [makeLine('a', [{kind:'line', start:[0,5], end:[10,5]}])];
    expect(findLineAtCell(5, 5, lines)).toBe('a');
  });

  test('single-point segment line still selectable at that point', () => {
    const lines = [makeLine('a', [{kind:'line', start:[5,5], end:[5,5]}])];
    expect(findLineAtCell(5, 5, lines)).toBe('a');
  });

  test('uses creationBox for hit testing when present', () => {
    const line: SVGObject = {
      id: 'cb',
      segments: [{ kind: 'line', start: [4, 6], end: [8, 6] }],
      color: { r: 255, g: 255, b: 255 },
      creationBox: { minX: 4, minY: 4, width: 4, height: 4 },
      cellX: 4, cellY: 4, cellWidth: 4, cellHeight: 4,
    };
    // Point (6, 5) is inside the creationBox but outside segment AABB
    expect(findLineAtCell(6, 5, [line])).toBe('cb');
    // Point (6, 9) is outside the creationBox
    expect(findLineAtCell(6, 9, [line])).toBeNull();
  });
});
