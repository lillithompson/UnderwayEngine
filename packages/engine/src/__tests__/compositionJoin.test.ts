import { itemToSegments, reverseSegments, canJoin, joinItems } from '../compositionJoin';
import { SVGObject, PathSegment, RGBColor } from '../types';
import { computeSVGBbox } from '../compositionOps';

const WHITE: RGBColor = { r: 255, g: 255, b: 255 };

function makeLine(id: string, segments: PathSegment[]): SVGObject {
  return { id, segments, color: WHITE, ...computeSVGBbox(segments) };
}

function makeArc(id: string, segments: PathSegment[]): SVGObject {
  return { id, segments, color: WHITE, ...computeSVGBbox(segments) };
}

describe('itemToSegments', () => {
  it('expands a polyline into straight segments', () => {
    const line = makeLine('l1', [
      { kind: 'line', start: [0, 0], end: [1, 0] },
      { kind: 'line', start: [1, 0], end: [1, 1] },
    ]);
    const segs = itemToSegments(line);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toEqual({ kind: 'line', start: [0, 0], end: [1, 0] });
    expect(segs[1]).toEqual({ kind: 'line', start: [1, 0], end: [1, 1] });
  });

  it('passes arc segments through (deep-copied)', () => {
    const seg: PathSegment = { kind: 'arc', start: [0, 0], end: [3, 3], center: [0, 3] };
    const arc = makeArc('a1', [seg]);
    const segs = itemToSegments(arc);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toEqual(seg);
    // Deep-copy: mutating the input doesn't change the output
    seg.start[0] = 99;
    expect(segs[0].start[0]).toBe(0);
  });
});

describe('reverseSegments', () => {
  it('reverses arc-curve segments preserving center', () => {
    const segs: PathSegment[] = [
      { kind: 'arc', start: [0, 0], end: [3, 3], center: [0, 3] },
      { kind: 'arc', start: [3, 3], end: [6, 0], center: [6, 3] },
    ];
    const rev = reverseSegments(segs);
    expect(rev[0]).toEqual({ kind: 'arc', start: [6, 0], end: [3, 3], center: [6, 3] });
    expect(rev[1]).toEqual({ kind: 'arc', start: [3, 3], end: [0, 0], center: [0, 3] });
  });

  it('reverses line segments', () => {
    const segs: PathSegment[] = [
      { kind: 'line', start: [0, 0], end: [1, 0] },
      { kind: 'line', start: [1, 0], end: [1, 1] },
    ];
    const rev = reverseSegments(segs);
    expect(rev).toEqual([
      { kind: 'line', start: [1, 1], end: [1, 0] },
      { kind: 'line', start: [1, 0], end: [0, 0] },
    ]);
  });
});

describe('canJoin', () => {
  it('rejects empty items', () => {
    expect(canJoin([makeLine('a', []), makeLine('b', [{ kind: 'line', start: [0, 0], end: [1, 0] }])])).toBe(false);
  });

  it('accepts two arcs that share an endpoint', () => {
    const a = makeArc('a', [{ kind: 'arc', start: [0, 0], end: [3, 3], center: [0, 3] }]);
    const b = makeArc('b', [{ kind: 'arc', start: [3, 3], end: [6, 0], center: [6, 3] }]);
    expect(canJoin([a, b])).toBe(true);
  });

  it('accepts a line and an arc that share an endpoint', () => {
    const l = makeLine('l', [{ kind: 'line', start: [0, 0], end: [3, 3] }]);
    const a = makeArc('a', [{ kind: 'arc', start: [3, 3], end: [6, 0], center: [6, 3] }]);
    expect(canJoin([l, a])).toBe(true);
  });

  it('rejects items that do not chain', () => {
    const a = makeArc('a', [{ kind: 'arc', start: [0, 0], end: [3, 3], center: [0, 3] }]);
    const b = makeArc('b', [{ kind: 'arc', start: [10, 10], end: [13, 13], center: [10, 13] }]);
    expect(canJoin([a, b])).toBe(false);
  });

  it('handles reversal-required matches', () => {
    // First arc ends at (3,3); second arc also ends at (3,3) so it must be
    // reversed to chain on.
    const a = makeArc('a', [{ kind: 'arc', start: [0, 0], end: [3, 3], center: [0, 3] }]);
    const b = makeArc('b', [{ kind: 'arc', start: [6, 0], end: [3, 3], center: [6, 3] }]);
    expect(canJoin([a, b])).toBe(true);
  });
});

describe('joinItems', () => {
  it('chains arc + arc into one segment array', () => {
    const a = makeArc('a', [{ kind: 'arc', start: [0, 0], end: [3, 3], center: [0, 3] }]);
    const b = makeArc('b', [{ kind: 'arc', start: [3, 3], end: [6, 0], center: [6, 3] }]);
    const segs = joinItems([a, b]);
    expect(segs).toHaveLength(2);
    expect(segs[0].kind).toBe('arc');
    expect(segs[1].kind).toBe('arc');
    expect(segs[0].start).toEqual([0, 0]);
    expect(segs[segs.length - 1].end).toEqual([6, 0]);
  });

  it('chains line + arc and preserves both kinds', () => {
    const l = makeLine('l', [{ kind: 'line', start: [0, 0], end: [3, 3] }]);
    const a = makeArc('a', [{ kind: 'arc', start: [3, 3], end: [6, 0], center: [6, 3] }]);
    const segs = joinItems([l, a]);
    expect(segs.map(s => s.kind)).toEqual(['line', 'arc']);
    expect(segs[0].start).toEqual([0, 0]);
    expect(segs[0].end).toEqual([3, 3]);
    expect(segs[1].start).toEqual([3, 3]);
    expect(segs[1].end).toEqual([6, 0]);
  });

  it('throws when items cannot chain', () => {
    const a = makeArc('a', [{ kind: 'arc', start: [0, 0], end: [3, 3], center: [0, 3] }]);
    const b = makeArc('b', [{ kind: 'arc', start: [10, 10], end: [13, 13], center: [10, 13] }]);
    expect(() => joinItems([a, b])).toThrow(/chain-joinable/);
  });

  it('reverses the second arc when its end matches the first arc end', () => {
    const a = makeArc('a', [{ kind: 'arc', start: [0, 0], end: [3, 3], center: [0, 3] }]);
    const b = makeArc('b', [{ kind: 'arc', start: [6, 0], end: [3, 3], center: [6, 3] }]);
    const segs = joinItems([a, b]);
    // After reversal, b becomes (3,3)→(6,0), so the chain ends at (6,0).
    expect(segs).toHaveLength(2);
    expect(segs[segs.length - 1].end).toEqual([6, 0]);
  });
});
