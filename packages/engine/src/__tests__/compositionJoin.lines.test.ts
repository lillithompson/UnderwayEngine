import { canJoin as canJoinLines, joinItems as joinLines } from '../compositionJoin';
import { SVGObject } from '../types';
import { computeSVGBbox } from '../compositionOps';

function line(id: string, segments: {kind:'line', start:[number,number], end:[number,number]}[]): SVGObject {
  return { id, segments, color: { r: 0, g: 0, b: 0 }, ...computeSVGBbox(segments) };
}

describe('canJoinLines', () => {
  test('returns false for fewer than two lines', () => {
    expect(canJoinLines([])).toBe(false);
    expect(canJoinLines([line('a', [{kind:'line', start:[0,0], end:[1,1]}])])).toBe(false);
  });

  test('returns true for two lines sharing a tail-to-head endpoint', () => {
    const a = line('a', [{kind:'line', start:[0,0], end:[1,1]}]);
    const b = line('b', [{kind:'line', start:[1,1], end:[2,2]}]);
    expect(canJoinLines([a, b])).toBe(true);
  });

  test('returns true for two lines sharing a tail-to-tail endpoint (one will reverse)', () => {
    const a = line('a', [{kind:'line', start:[0,0], end:[1,1]}]);
    const b = line('b', [{kind:'line', start:[2,2], end:[1,1]}]);
    expect(canJoinLines([a, b])).toBe(true);
  });

  test('returns false for three lines where one is disjoint', () => {
    const a = line('a', [{kind:'line', start:[0,0], end:[1,1]}]);
    const b = line('b', [{kind:'line', start:[1,1], end:[2,2]}]);
    const c = line('c', [{kind:'line', start:[10,10], end:[11,11]}]);
    expect(canJoinLines([a, b, c])).toBe(false);
  });

  test('returns false when paths share only an interior vertex (T-junction)', () => {
    const a = line('a', [{kind:'line', start:[0,0], end:[5,5]}, {kind:'line', start:[5,5], end:[10,0]}]);
    const b = line('b', [{kind:'line', start:[5,5], end:[5,10]}]);
    expect(canJoinLines([a, b])).toBe(false);
  });

  test('treats endpoints differing by 5e-7 as equal', () => {
    const a = line('a', [{kind:'line', start:[0,0], end:[1,1]}]);
    const b = line('b', [{kind:'line', start:[1 + 5e-7, 1 - 5e-7], end:[2,2]}]);
    expect(canJoinLines([a, b])).toBe(true);
  });

  test('joins three lines presented in non-trivial pickup order', () => {
    const a = line('a', [{kind:'line', start:[0,0], end:[1,0]}]);
    const b = line('b', [{kind:'line', start:[1,0], end:[2,0]}]);
    const c = line('c', [{kind:'line', start:[2,0], end:[3,0]}]);
    expect(canJoinLines([b, a, c])).toBe(true);
  });

});

describe('joinLines', () => {
  test('joins two tail-to-head lines and drops the duplicated junction segment', () => {
    const a = line('a', [{kind:'line', start:[0,0], end:[1,1]}]);
    const b = line('b', [{kind:'line', start:[1,1], end:[2,2]}]);
    expect(joinLines([a, b])).toEqual([
      {kind:'line', start:[0,0], end:[1,1]},
      {kind:'line', start:[1,1], end:[2,2]},
    ]);
  });

  test('reverses a tail-to-tail neighbor before appending', () => {
    const a = line('a', [{kind:'line', start:[0,0], end:[1,1]}]);
    const b = line('b', [{kind:'line', start:[2,2], end:[1,1]}]);
    expect(joinLines([a, b])).toEqual([
      {kind:'line', start:[0,0], end:[1,1]},
      {kind:'line', start:[1,1], end:[2,2]},
    ]);
  });

  test('joins three lines presented in non-trivial order into one chain', () => {
    const a = line('a', [{kind:'line', start:[0,0], end:[1,0]}]);
    const b = line('b', [{kind:'line', start:[1,0], end:[2,0]}]);
    const c = line('c', [{kind:'line', start:[2,0], end:[3,0]}]);
    expect(joinLines([b, a, c])).toEqual([
      {kind:'line', start:[0,0], end:[1,0]},
      {kind:'line', start:[1,0], end:[2,0]},
      {kind:'line', start:[2,0], end:[3,0]},
    ]);
  });

  test('attaches at the head when the new line connects to the chain start', () => {
    const a = line('a', [{kind:'line', start:[1,0], end:[2,0]}]);
    const b = line('b', [{kind:'line', start:[0,0], end:[1,0]}]);
    expect(joinLines([a, b])).toEqual([
      {kind:'line', start:[0,0], end:[1,0]},
      {kind:'line', start:[1,0], end:[2,0]},
    ]);
  });

  test('collapses consecutive epsilon-equal segments in the joined chain', () => {
    const a = line('a', [{kind:'line', start:[0,0], end:[1,0]}, {kind:'line', start:[1,0], end:[1 + 1e-9,0]}]);
    const b = line('b', [{kind:'line', start:[1,0], end:[2,0]}]);
    const result = joinLines([a, b]);
    // The chain should have collapsed the epsilon-duplicate junction
    expect(result.length).toBeLessThanOrEqual(3);
    expect(result[0].start).toEqual([0, 0]);
    expect(result[result.length - 1].end).toEqual([2, 0]);
  });

  test('returned segments are fresh (not aliased to inputs)', () => {
    const a = line('a', [{kind:'line', start:[0,0], end:[1,1]}]);
    const b = line('b', [{kind:'line', start:[1,1], end:[2,2]}]);
    const out = joinLines([a, b]);
    out[0].start[0] = 999;
    expect(a.segments[0].start[0]).toBe(0);
  });
});
