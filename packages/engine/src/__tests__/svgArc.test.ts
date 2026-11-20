import * as fs from 'fs';
import * as path from 'path';
import { svgArcCentre, svgArcPieces, svgArcPoint, svgArcToCubics, SvgArcCentre } from '../svgArc';

// The engine's one conversion of an SVG arc from the endpoints it is written
// with to the centre form it is drawn from (SVG 1.1 F.6.5, F.6.6). What each
// reader draws from it is pinned in that reader's suite (simplifySVG,
// figureToPaths, the editor's svgImageGeometry).

const arc = (x1: number, y1: number, rx: number, ry: number, rot: number, large: boolean, sweep: boolean, x2: number, y2: number) =>
  svgArcCentre(x1, y1, rx, ry, rot, large, sweep, x2, y2) as SvgArcCentre;

/** A point's radius on the arc's ellipse, in the ellipse's own units: 1 on it. */
function ellipseRadius(a: SvgArcCentre, x: number, y: number): number {
  const dx = x - a.cx, dy = y - a.cy;
  const u = a.cosPhi * dx + a.sinPhi * dy, v = -a.sinPhi * dx + a.cosPhi * dy;
  return Math.hypot(u / a.rx, v / a.ry);
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('svgArcCentre', () => {
  test('a semicircle: its centre midway, its sweep half a turn the way the sweep flag says', () => {
    const a = arc(0, 0, 10, 10, 0, false, true, 20, 0);
    expect(a.cx).toBeCloseTo(10, 12);
    expect(a.cy).toBeCloseTo(0, 12);
    expect([a.rx, a.ry]).toEqual([10, 10]);
    expect(a.theta1).toBeCloseTo(Math.PI, 12);
    expect(a.dTheta).toBeCloseTo(Math.PI, 12);
    expect(arc(0, 0, 10, 10, 0, false, false, 20, 0).dTheta).toBeCloseTo(-Math.PI, 12);
  });

  test('the two flags choose among the four arcs through two points', () => {
    // A quarter circle of radius 10 from (10, 0) to (0, 10): about (0, 0) or (10, 10).
    const cases: [boolean, boolean, [number, number], number][] = [
      [false, true, [0, 0], Math.PI / 2],
      [true, true, [10, 10], (3 * Math.PI) / 2],
      [false, false, [10, 10], -Math.PI / 2],
      [true, false, [0, 0], (-3 * Math.PI) / 2],
    ];
    for (const [large, sweep, [cx, cy], dTheta] of cases) {
      const a = arc(10, 0, 10, 10, 0, large, sweep, 0, 10);
      expect(a.cx).toBeCloseTo(cx, 9);
      expect(a.cy).toBeCloseTo(cy, 9);
      expect(a.dTheta).toBeCloseTo(dTheta, 9);
    }
  });

  test('a negative radius is the same as its positive, as the spec reads it', () => {
    expect(arc(0, 0, -10, 10, 0, false, true, 20, 0)).toEqual(arc(0, 0, 10, 10, 0, false, true, 20, 0));
    expect(arc(0, 0, 10, -5, 30, true, false, 20, 10)).toEqual(arc(0, 0, 10, 5, 30, true, false, 20, 10));
  });

  test('radii too small to reach are scaled up together until they just do', () => {
    const a = arc(0, 0, 1, 1, 0, false, true, 20, 0);
    expect(a.rx).toBeCloseTo(10, 12);
    expect(a.ry).toBeCloseTo(10, 12);
    expect(a.cx).toBeCloseTo(10, 12);
    expect(Math.abs(a.dTheta)).toBeCloseTo(Math.PI, 12);
    const e = arc(0, 0, 2, 1, 0, false, true, 40, 0);
    expect(e.rx / e.ry).toBeCloseTo(2, 12);
    expect(e.rx).toBeCloseTo(20, 12);
  });

  test('a rotated ellipse: its axes turn with the rotation', () => {
    // rx 20 along y after a 90° turn: (0, 0) to (0, 40) is its whole major axis.
    const a = arc(0, 0, 20, 10, 90, false, true, 0, 40);
    expect(a.cx).toBeCloseTo(0, 9);
    expect(a.cy).toBeCloseTo(20, 9);
    const [mx, my] = svgArcPoint(a, a.theta1 + a.dTheta / 2);
    expect(Math.abs(mx)).toBeCloseTo(10, 9);
    expect(my).toBeCloseTo(20, 9);
  });

  test('no arc where the spec draws a line or nothing: a zero radius, or ends that are one point', () => {
    expect(svgArcCentre(0, 0, 0, 10, 0, false, true, 20, 0)).toBeNull();
    expect(svgArcCentre(0, 0, 10, 0, 0, false, true, 20, 0)).toBeNull();
    expect(svgArcCentre(0, 0, 1e-12, 1e-12, 0, false, true, 20, 0)).toBeNull();
    expect(svgArcCentre(5, 5, 10, 10, 0, true, true, 5, 5)).toBeNull();
  });

  test('its ellipse runs from the arc’s start to its end', () => {
    // To within the acos the spec takes its angles with, which near a half
    // turn holds them to about 1e-8 rad: the readers end each arc on its own
    // ends, never on these.
    const r = rng(1);
    for (let i = 0; i < 200; i++) {
      const x1 = r() * 200 - 100, y1 = r() * 200 - 100, x2 = r() * 200 - 100, y2 = r() * 200 - 100;
      const a = arc(x1, y1, 1 + r() * 150, 1 + r() * 150, r() * 360 - 180, r() < 0.5, r() < 0.5, x2, y2);
      const s = svgArcPoint(a, a.theta1), e = svgArcPoint(a, a.theta1 + a.dTheta);
      const tol = 1e-7 * Math.max(a.rx, a.ry);
      expect(Math.hypot(s[0] - x1, s[1] - y1)).toBeLessThan(tol);
      expect(Math.hypot(e[0] - x2, e[1] - y2)).toBeLessThan(tol);
      expect(Math.abs(a.dTheta)).toBeLessThanOrEqual(2 * Math.PI);
    }
  });
});

describe('svgArcPieces', () => {
  test('equal pieces of at most the turn given; an exact multiple is that many', () => {
    const q = Math.PI / 2;
    expect(svgArcPieces(arc(10, 0, 10, 10, 0, false, true, 0, 10), q)).toBe(1);
    expect(svgArcPieces(arc(0, 0, 10, 10, 0, false, true, 20, 0), q)).toBe(2);
    expect(svgArcPieces(arc(10, 0, 10, 10, 0, true, true, 0, 10), q)).toBe(3);
    expect(svgArcPieces(arc(0, 0, 10, 10, 0, false, true, 20, 0), Math.PI / 16)).toBe(16);
  });

  test('none for a sweep that is not a number', () => {
    expect(svgArcPieces(arc(0, 0, NaN, 10, 0, false, true, 20, 0), Math.PI / 2)).toBe(0);
  });
});

describe('svgArcToCubics', () => {
  const cubicAt = (p0: [number, number], c: number[], i: number, t: number): [number, number] => {
    const u = 1 - t;
    const [x1, y1, x2, y2, x, y] = c.slice(i, i + 6);
    return [
      u * u * u * p0[0] + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
      u * u * u * p0[1] + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y,
    ];
  };

  test('a semicircle is two quarter cubics, the classic circle cubic, ending exactly on its end', () => {
    const c = svgArcToCubics(0, 0, 10, 10, 0, false, true, 20, 0)!;
    expect(c).toHaveLength(12);
    const k = 10 * (4 / 3) * Math.tan(Math.PI / 8); // 5.5228…
    const want = [0, -k, 10 - k, -10, 10, -10, 10 + k, -10, 20, -k, 20, 0];
    c.forEach((v, i) => expect(v).toBeCloseTo(want[i], 9));
    expect(c.slice(10)).toEqual([20, 0]);
  });

  test('every cubic stays on the ellipse within 0.03% of its radii, and the pieces join', () => {
    const r = rng(2);
    for (let i = 0; i < 300; i++) {
      const x1 = r() * 200 - 100, y1 = r() * 200 - 100, x2 = r() * 200 - 100, y2 = r() * 200 - 100;
      const args = [x1, y1, 1 + r() * 150, 1 + r() * 150, r() * 360 - 180, r() < 0.5, r() < 0.5, x2, y2] as const;
      const a = svgArcCentre(...args)!;
      const c = svgArcToCubics(...args)!;
      expect(c.length / 6).toBe(svgArcPieces(a, Math.PI / 2));
      let p0: [number, number] = [x1, y1];
      for (let j = 0; j < c.length; j += 6) {
        for (const t of [0.25, 0.5, 0.75]) {
          const [x, y] = cubicAt(p0, c, j, t);
          expect(Math.abs(ellipseRadius(a, x, y) - 1)).toBeLessThan(3e-4);
        }
        p0 = [c[j + 4], c[j + 5]];
      }
      expect(p0).toEqual([x2, y2]);
    }
  });

  test('null where there is no arc: the caller draws the line to its end', () => {
    expect(svgArcToCubics(0, 0, 0, 10, 0, false, true, 20, 0)).toBeNull();
    expect(svgArcToCubics(5, 5, 10, 10, 0, false, true, 5, 5)).toBeNull();
    expect(svgArcToCubics(0, 0, NaN, 10, 0, false, true, 20, 0)).toBeNull();
  });
});

describe('one arc conversion', () => {
  // Report bbf6797b: the endpoint-to-centre conversion was written twice
  // (figureToPaths' convertSVGArc and svgImageGeometry's arcPoints), and
  // simplifySVG drew none (report 7f84afc7). Every reader of an arc reads
  // it here now, and nothing else in the packages does the arithmetic.
  const PACKAGES = path.resolve(__dirname, '..', '..', '..');
  const read = (rel: string) => fs.readFileSync(path.join(PACKAGES, rel), 'utf8');

  test.each([
    ['engine/src/simplifySVG.ts', /^import \{ svgArcToCubics \} from '\.\/svgArc';$/m],
    ['engine/src/figureToPaths.ts', /^import \{ svgArcCentre, svgArcPieces, svgArcPoint \} from '\.\/svgArc';$/m],
    ['editor/src/formats/svgImageGeometry.ts', /^import \{ svgArcCentre, svgArcPoint \} from '@\/engine\/svgArc';$/m],
  ])('%s draws its arcs from svgArc', (rel, imp) => {
    expect(read(rel)).toMatch(imp);
  });

  test('no other source in the packages carries the endpoint-to-centre arithmetic', () => {
    const MARK = 'rx * rx * ry * ry';
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(full);
        } else if (/\.tsx?$/.test(entry.name) && fs.readFileSync(full, 'utf8').includes(MARK)) {
          hits.push(path.relative(PACKAGES, full).split(path.sep).join('/'));
        }
      }
    };
    for (const pkg of fs.readdirSync(PACKAGES)) {
      const src = path.join(PACKAGES, pkg, 'src');
      if (fs.existsSync(src)) walk(src);
    }
    expect(hits).toEqual(['engine/src/svgArc.ts']);
  });
});
