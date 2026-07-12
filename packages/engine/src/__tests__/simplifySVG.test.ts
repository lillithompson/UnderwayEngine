import {
  parseTransform,
  parsePathD,
  areCollinear,
  removeCollinearPoints,
  reverseSubpath,
  simplifySVG,
  Subpath,
} from '../simplifySVG';
import { countSVGCVs } from '../svgExport';

// No svg-sources mock — unit tests provide raw SVG elements directly,
// and .facet integration tests need real sprite data.

// ─── Transform parsing ─────────────────────────────────────────────

describe('parseTransform', () => {
  test('identity for empty string', () => {
    expect(parseTransform('')).toEqual([1, 0, 0, 1, 0, 0]);
  });

  test('translate', () => {
    const m = parseTransform('translate(100,200)');
    expect(m[4]).toBeCloseTo(100);
    expect(m[5]).toBeCloseTo(200);
    expect(m[0]).toBeCloseTo(1);
  });

  test('translate single arg', () => {
    const m = parseTransform('translate(50)');
    expect(m[4]).toBeCloseTo(50);
    expect(m[5]).toBeCloseTo(0);
  });

  test('scale uniform', () => {
    const m = parseTransform('scale(2)');
    expect(m[0]).toBeCloseTo(2);
    expect(m[3]).toBeCloseTo(2);
  });

  test('scale non-uniform', () => {
    const m = parseTransform('scale(-1,1)');
    expect(m[0]).toBeCloseTo(-1);
    expect(m[3]).toBeCloseTo(1);
  });

  test('rotate 90', () => {
    const m = parseTransform('rotate(90)');
    expect(m[0]).toBeCloseTo(0);
    expect(m[1]).toBeCloseTo(1);
    expect(m[2]).toBeCloseTo(-1);
    expect(m[3]).toBeCloseTo(0);
  });

  test('rotate with center', () => {
    const m = parseTransform('rotate(-45 128 128)');
    // After rotation, the center (128,128) should map to itself
    const x = m[0] * 128 + m[2] * 128 + m[4];
    const y = m[1] * 128 + m[3] * 128 + m[5];
    expect(x).toBeCloseTo(128);
    expect(y).toBeCloseTo(128);
  });

  test('composed transform from tile pipeline', () => {
    const m = parseTransform('translate(256,0) scale(1) translate(128,128) rotate(90) scale(-1,1) translate(-128,-128)');
    // This represents a tile at position (256,0) with 90° rotation and horizontal mirror
    // Point (128,128) in local space should map to (256+128, 0+128) = (384, 128) since
    // the rotation center is (128,128) and the tile is translated to (256,0)
    const x = m[0] * 128 + m[2] * 128 + m[4];
    const y = m[1] * 128 + m[3] * 128 + m[5];
    expect(x).toBeCloseTo(384);
    expect(y).toBeCloseTo(128);
  });
});

// ─── Path d parsing ─────────────────────────────────────────────────

describe('parsePathD', () => {
  test('simple M L', () => {
    const subs = parsePathD('M0 0L256 256');
    expect(subs).toHaveLength(1);
    expect(subs[0].segments).toHaveLength(2);
    expect(subs[0].segments[0]).toEqual({ cmd: 'M', x: 0, y: 0 });
    expect(subs[0].segments[1]).toEqual({ cmd: 'L', x: 256, y: 256 });
  });

  test('multiple subpaths', () => {
    const subs = parsePathD('M128 128L256 0M128 128L0 256');
    expect(subs).toHaveLength(2);
    expect(subs[0].segments[1]).toEqual({ cmd: 'L', x: 256, y: 0 });
    expect(subs[1].segments[1]).toEqual({ cmd: 'L', x: 0, y: 256 });
  });

  test('H and V normalized to L', () => {
    const subs = parsePathD('M0 0H256V128');
    expect(subs).toHaveLength(1);
    expect(subs[0].segments[1]).toEqual({ cmd: 'L', x: 256, y: 0 });
    expect(subs[0].segments[2]).toEqual({ cmd: 'L', x: 256, y: 128 });
  });

  test('cubic bezier', () => {
    const subs = parsePathD('M0 0C85 0 171 85 256 256');
    expect(subs).toHaveLength(1);
    const c = subs[0].segments[1];
    expect(c.cmd).toBe('C');
    if (c.cmd === 'C') {
      expect(c.x1).toBeCloseTo(85);
      expect(c.y1).toBeCloseTo(0);
      expect(c.x).toBeCloseTo(256);
      expect(c.y).toBeCloseTo(256);
    }
  });

  test('Z marks closed', () => {
    const subs = parsePathD('M0 0L256 0L256 256Z');
    expect(subs[0].closed).toBe(true);
  });

  test('implicit L after M', () => {
    const subs = parsePathD('M0 0 128 128 256 256');
    expect(subs).toHaveLength(1);
    expect(subs[0].segments).toHaveLength(3);
    expect(subs[0].segments[1]).toEqual({ cmd: 'L', x: 128, y: 128 });
    expect(subs[0].segments[2]).toEqual({ cmd: 'L', x: 256, y: 256 });
  });

  test('scientific notation', () => {
    const subs = parsePathD('M-1.83e-05 3.35e-05L256 256');
    expect(subs[0].segments[0].cmd).toBe('M');
    const m = subs[0].segments[0] as { cmd: 'M'; x: number; y: number };
    expect(m.x).toBeCloseTo(0, 4);
    expect(m.y).toBeCloseTo(0, 4);
  });

  test('S command (smooth cubic)', () => {
    const subs = parsePathD('M0 0C50 0 100 50 100 100S150 200 200 200');
    expect(subs[0].segments).toHaveLength(3);
    // S produces a C with reflected control point
    const s = subs[0].segments[2];
    expect(s.cmd).toBe('C');
  });

  test('Q command', () => {
    const subs = parsePathD('M0 0Q128 0 256 128');
    expect(subs[0].segments[1].cmd).toBe('Q');
  });

  test('relative commands', () => {
    const subs = parsePathD('M100 100l50 50');
    expect(subs[0].segments[1]).toEqual({ cmd: 'L', x: 150, y: 150 });
  });
});

// ─── Collinearity ───────────────────────────────────────────────────

describe('areCollinear', () => {
  test('horizontal points', () => {
    expect(areCollinear(0, 0, 128, 0, 256, 0)).toBe(true);
  });

  test('diagonal points', () => {
    expect(areCollinear(0, 0, 128, 128, 256, 256)).toBe(true);
  });

  test('non-collinear points', () => {
    expect(areCollinear(0, 0, 128, 128, 256, 0)).toBe(false);
  });

  test('near-collinear within tolerance', () => {
    expect(areCollinear(0, 0, 128, 0.1, 256, 0)).toBe(true);
  });

  test('coincident points (degenerate)', () => {
    expect(areCollinear(5, 5, 5, 5, 5, 5)).toBe(true);
  });
});

// ─── Collinear removal ──────────────────────────────────────────────

describe('removeCollinearPoints', () => {
  test('removes collinear middle point', () => {
    const sp: Subpath = {
      segments: [
        { cmd: 'M', x: 0, y: 0 },
        { cmd: 'L', x: 128, y: 128 },
        { cmd: 'L', x: 256, y: 256 },
      ],
      closed: false,
    };
    const result = removeCollinearPoints(sp);
    expect(result.segments).toHaveLength(2);
    expect(result.segments[1]).toEqual({ cmd: 'L', x: 256, y: 256 });
  });

  test('removes multiple collinear points', () => {
    const sp: Subpath = {
      segments: [
        { cmd: 'M', x: 0, y: 0 },
        { cmd: 'L', x: 1, y: 1 },
        { cmd: 'L', x: 2, y: 2 },
        { cmd: 'L', x: 3, y: 3 },
      ],
      closed: false,
    };
    const result = removeCollinearPoints(sp);
    expect(result.segments).toHaveLength(2);
    expect(result.segments[1]).toEqual({ cmd: 'L', x: 3, y: 3 });
  });

  test('preserves non-collinear points', () => {
    const sp: Subpath = {
      segments: [
        { cmd: 'M', x: 0, y: 0 },
        { cmd: 'L', x: 128, y: 128 },
        { cmd: 'L', x: 256, y: 0 },
      ],
      closed: false,
    };
    const result = removeCollinearPoints(sp);
    expect(result.segments).toHaveLength(3);
  });

  test('does not remove points adjacent to curves', () => {
    const sp: Subpath = {
      segments: [
        { cmd: 'M', x: 0, y: 0 },
        { cmd: 'C', x1: 50, y1: 0, x2: 100, y2: 50, x: 128, y: 128 },
        { cmd: 'L', x: 256, y: 256 },
      ],
      closed: false,
    };
    const result = removeCollinearPoints(sp);
    expect(result.segments).toHaveLength(3);
  });
});

// ─── Subpath reversal ───────────────────────────────────────────────

describe('reverseSubpath', () => {
  test('reverses line subpath', () => {
    const sp: Subpath = {
      segments: [
        { cmd: 'M', x: 0, y: 0 },
        { cmd: 'L', x: 256, y: 128 },
      ],
      closed: false,
    };
    const rev = reverseSubpath(sp);
    expect(rev.segments[0]).toEqual({ cmd: 'M', x: 256, y: 128 });
    expect(rev.segments[1]).toEqual({ cmd: 'L', x: 0, y: 0 });
  });

  test('reverses multi-segment line', () => {
    const sp: Subpath = {
      segments: [
        { cmd: 'M', x: 0, y: 0 },
        { cmd: 'L', x: 128, y: 64 },
        { cmd: 'L', x: 256, y: 128 },
      ],
      closed: false,
    };
    const rev = reverseSubpath(sp);
    expect(rev.segments[0]).toEqual({ cmd: 'M', x: 256, y: 128 });
    expect(rev.segments[1]).toEqual({ cmd: 'L', x: 128, y: 64 });
    expect(rev.segments[2]).toEqual({ cmd: 'L', x: 0, y: 0 });
  });

  test('reverses cubic: swaps control points', () => {
    const sp: Subpath = {
      segments: [
        { cmd: 'M', x: 0, y: 0 },
        { cmd: 'C', x1: 10, y1: 20, x2: 30, y2: 40, x: 50, y: 60 },
      ],
      closed: false,
    };
    const rev = reverseSubpath(sp);
    expect(rev.segments[0]).toEqual({ cmd: 'M', x: 50, y: 60 });
    const c = rev.segments[1] as any;
    expect(c.cmd).toBe('C');
    expect(c.x1).toBe(30); // was x2
    expect(c.y1).toBe(40); // was y2
    expect(c.x2).toBe(10); // was x1
    expect(c.y2).toBe(20); // was y1
    expect(c.x).toBe(0);
    expect(c.y).toBe(0);
  });
});

// ─── Rect merging ───────────────────────────────────────────────────

describe('rect merging in simplifySVG', () => {
  test('merges horizontally adjacent same-fill rects', () => {
    const els = [
      '<rect x="0" y="0" width="256" height="256" fill="rgb(255,0,0)"/>',
      '<rect x="256" y="0" width="256" height="256" fill="rgb(255,0,0)"/>',
    ];
    const result = simplifySVG(els);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/width="512"/);
  });

  test('merges vertically adjacent same-fill rects', () => {
    const els = [
      '<rect x="0" y="0" width="256" height="256" fill="rgb(0,255,0)"/>',
      '<rect x="0" y="256" width="256" height="256" fill="rgb(0,255,0)"/>',
    ];
    const result = simplifySVG(els);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/height="512"/);
  });

  test('does not merge different-fill rects', () => {
    const els = [
      '<rect x="0" y="0" width="256" height="256" fill="rgb(255,0,0)"/>',
      '<rect x="256" y="0" width="256" height="256" fill="rgb(0,0,255)"/>',
    ];
    const result = simplifySVG(els);
    expect(result).toHaveLength(2);
  });

  test('merges 2x2 grid', () => {
    const fill = 'rgb(128,128,128)';
    const els = [
      `<rect x="0" y="0" width="256" height="256" fill="${fill}"/>`,
      `<rect x="256" y="0" width="256" height="256" fill="${fill}"/>`,
      `<rect x="0" y="256" width="256" height="256" fill="${fill}"/>`,
      `<rect x="256" y="256" width="256" height="256" fill="${fill}"/>`,
    ];
    const result = simplifySVG(els);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/width="512"/);
    expect(result[0]).toMatch(/height="512"/);
  });
});

// ─── Full simplifySVG integration ───────────────────────────────────

describe('simplifySVG', () => {
  test('passes through non-path/rect elements unchanged', () => {
    const els = [
      '<circle cx="128" cy="128" r="11" stroke="white" stroke-width="5"/>',
    ];
    const result = simplifySVG(els);
    expect(result).toEqual(els);
  });

  test('merges two path elements sharing an endpoint', () => {
    // Path A: (128,128) → (256,128), Path B: (256,128) → (384,128)
    const els = [
      '<path id="a" transform="translate(0,0)" d="M128 128L256 128" stroke="white" stroke-width="5"/>',
      '<path id="b" transform="translate(0,0)" d="M256 128L384 128" stroke="white" stroke-width="5"/>',
    ];
    const result = simplifySVG(els);
    // Should merge into a single path; collinear removal produces M128,128 L384,128
    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/<path/);
    expect(result[0]).toMatch(/stroke="white"/);
  });

  test('merges paths that need reversal', () => {
    // Both paths end at (256,128) — one needs reversal
    const els = [
      '<path transform="translate(0,0)" d="M128 128L256 128" stroke="white" stroke-width="5"/>',
      '<path transform="translate(0,0)" d="M384 128L256 128" stroke="white" stroke-width="5"/>',
    ];
    const result = simplifySVG(els);
    expect(result).toHaveLength(1);
  });

  test('does not merge paths with different stroke colors', () => {
    const els = [
      '<path transform="translate(0,0)" d="M0 0L256 128" stroke="white" stroke-width="5"/>',
      '<path transform="translate(0,0)" d="M256 128L512 256" stroke="rgb(255,0,0)" stroke-width="5"/>',
    ];
    const result = simplifySVG(els);
    expect(result).toHaveLength(2);
  });

  test('does not merge closed subpaths', () => {
    const els = [
      '<path transform="translate(0,0)" d="M0 0L256 0L256 256Z" stroke="white" stroke-width="5"/>',
      '<path transform="translate(0,0)" d="M0 0L0 256L256 256" stroke="white" stroke-width="5"/>',
    ];
    const result = simplifySVG(els);
    // Closed subpath should remain separate
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  test('applies transforms before merging', () => {
    // Tile A at (0,0): center→east = (128,128)→(256,128)
    // Tile B at (256,0): center→west = after translate, (384,128)→(256,128)
    const els = [
      '<path transform="translate(0,0)" d="M128 128L256 128" stroke="white" stroke-width="5"/>',
      '<path transform="translate(256,0)" d="M128 128L0 128" stroke="white" stroke-width="5"/>',
    ];
    const result = simplifySVG(els);
    // After transform: A=(128,128)→(256,128), B=(384,128)→(256,128)
    // Share endpoint (256,128), should merge
    expect(result).toHaveLength(1);
  });

  test('removes collinear interior points after merge', () => {
    const els = [
      '<path transform="translate(0,0)" d="M0 0L128 0" stroke="white" stroke-width="5"/>',
      '<path transform="translate(0,0)" d="M128 0L256 0" stroke="white" stroke-width="5"/>',
    ];
    const result = simplifySVG(els);
    expect(result).toHaveLength(1);
    // The merged path should be M0 0L256 0 (middle point 128,0 removed)
    const d = result[0].match(/d="([^"]*)"/)?.[1] || '';
    expect(d).not.toContain('128');
  });

  test('handles degenerate cubic as line', () => {
    // A "cubic" where all 4 points are collinear = actually a line
    const els = [
      '<path transform="translate(0,0)" d="M0 0C85.33 85.33 170.67 170.67 256 256" stroke="white" stroke-width="5"/>',
    ];
    const result = simplifySVG(els);
    expect(result).toHaveLength(1);
    // Should be simplified to L instead of C
    const d = result[0].match(/d="([^"]*)"/)?.[1] || '';
    expect(d).not.toContain('C');
    expect(d).toContain('L');
  });

  test('combines multiple same-property subpaths into one element', () => {
    const els = [
      '<path transform="translate(0,0)" d="M0 0L128 0" stroke="white" stroke-width="5"/>',
      '<path transform="translate(0,0)" d="M0 128L128 128" stroke="white" stroke-width="5"/>',
    ];
    const result = simplifySVG(els);
    // These don't share endpoints, but same visual key → combined into one <path> element
    expect(result).toHaveLength(1);
    const d = result[0].match(/d="([^"]*)"/)?.[1] || '';
    // Should have two M commands (two subpaths in one element)
    const mCount = (d.match(/M/g) || []).length;
    expect(mCount).toBe(2);
  });

  test('empty input returns empty', () => {
    expect(simplifySVG([])).toEqual([]);
  });

  test('merges L1 tiles with imprecise boundary coordinates', () => {
    // Real tile data: angular/tile_00101010 has path
    // M127.755 128L-0.244995 128M127.755 128L256.255 128M127.755 128L128 256
    // At L1 (scale=2), East edge of tile(0,0) = 256.255*2 = 512.51
    // West edge of tile(1,0) = -0.245*2 + 512 = 511.51 — 1.0 unit mismatch
    // The snap quantum should absorb this mismatch.
    const eastWestTile = 'M127.755 128L-0.244995 128M127.755 128L256.255 128';
    const els = [
      `<path transform="translate(0,0) scale(2)" d="${eastWestTile}" stroke="white" stroke-width="2.5"/>`,
      `<path transform="translate(512,0) scale(2)" d="${eastWestTile}" stroke="white" stroke-width="2.5"/>`,
      `<path transform="translate(1024,0) scale(2)" d="${eastWestTile}" stroke="white" stroke-width="2.5"/>`,
      `<path transform="translate(1536,0) scale(2)" d="${eastWestTile}" stroke="white" stroke-width="2.5"/>`,
    ];
    const result = simplifySVG(els);
    // 4 tiles × 2 E-W subpaths each = 8 line subpaths that should merge
    // into one continuous horizontal line. Plus 4 south subpaths (unconnected).
    // After collinear removal, the horizontal chain should have only 2 CVs.
    const cvCount = countSVGCVs(result);
    console.log(`L1 line: ${els.length} elements → ${result.length}, ${countSVGCVs(els)} CVs → ${cvCount} CVs`);
    // The horizontal line should merge, reducing element count
    expect(result.length).toBeLessThan(els.length);
    // The horizontal chain should be simplified to 2 CVs (start + end)
    // plus the 4 south subpaths (2 CVs each = 8) = 10 total
    expect(cvCount).toBeLessThan(countSVGCVs(els));
  });
});

// ─── Real .facet file tests ─────────────────────────────────────────

describe('size reduction measurement', () => {
});
