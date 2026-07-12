import * as fs from 'fs';
import * as zlib from 'zlib';
import * as path from 'path';
import { deserializeComposition } from '../compositionBinaryFormat';
import { isClosedPath, chainSegments, normalizeClosedSegments, computeSignedArea } from '../compositionArcMath';
import { PathSegment } from '../types';

function loadTile(relativePath: string) {
  const compressed = fs.readFileSync(path.join(__dirname, '../../test_data', relativePath));
  const payload = new Uint8Array(zlib.inflateSync(compressed));
  return deserializeComposition(payload);
}

describe('JoinTest.tile: winding normalization', () => {
  let allSegments: PathSegment[];

  beforeAll(() => {
    const result = loadTile('JoinTest.tile');
    const svgs = result.meta.svgObjects ?? [];
    expect(svgs.length).toBeGreaterThan(0);
    // Collect all segments from all SVG objects (simulates join)
    allSegments = svgs.flatMap(svg => svg.segments.map(s => ({ ...s }) as PathSegment));
  });

  it('collected segments can be chained into a closed path', () => {
    const chained = chainSegments(allSegments);
    expect(chained).not.toBeNull();
    expect(isClosedPath(chained!)).toBe(true);
  });

  it('normalizeClosedSegments produces a closed path', () => {
    const normalized = normalizeClosedSegments(allSegments);
    expect(normalized.length).toBeGreaterThan(0);
    expect(isClosedPath(normalized)).toBe(true);
  });

  it('normalized segments have positive (CW) signed area', () => {
    const normalized = normalizeClosedSegments(allSegments);
    expect(computeSignedArea(normalized)).toBeGreaterThan(0);
  });

  it('all consecutive endpoints are exactly equal (vertices merged)', () => {
    const normalized = normalizeClosedSegments(allSegments);
    for (let i = 0; i < normalized.length; i++) {
      const next = normalized[(i + 1) % normalized.length];
      expect(normalized[i].end[0]).toBe(next.start[0]);
      expect(normalized[i].end[1]).toBe(next.start[1]);
    }
  });

  it('different segment orderings produce same winding', () => {
    // Reverse the input order to simulate different selection order
    const reversed = [...allSegments].reverse();
    const n1 = normalizeClosedSegments(allSegments);
    const n2 = normalizeClosedSegments(reversed);
    // Both should have same positive signed area
    const a1 = computeSignedArea(n1);
    const a2 = computeSignedArea(n2);
    expect(a1).toBeGreaterThan(0);
    expect(a2).toBeGreaterThan(0);
    expect(a1).toBeCloseTo(a2, 4);
  });
});
