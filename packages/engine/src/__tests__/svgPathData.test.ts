import * as fs from 'fs';
import * as path from 'path';
import { PathDataSink, readPathData } from '../svgPathData';

// The engine's one reader of SVG path data. Each test reads a `d` into a
// sink that records every call, in absolute coordinates, so what is pinned
// is the grammar alone: what a curve or an arc becomes is each caller's
// (simplifySVG, figureToPaths, the editor's svgImageGeometry), pinned in
// their own suites.

type Call = (string | number | boolean)[];

function calls(d: string): Call[] {
  const out: Call[] = [];
  const sink: PathDataSink = {
    moveTo: (x, y) => { out.push(['M', x, y]); },
    lineTo: (x0, y0, x, y) => { out.push(['L', x0, y0, x, y]); },
    cubicTo: (x0, y0, x1, y1, x2, y2, x, y) => { out.push(['C', x0, y0, x1, y1, x2, y2, x, y]); },
    quadTo: (x0, y0, x1, y1, x, y) => { out.push(['Q', x0, y0, x1, y1, x, y]); },
    arcTo: (x0, y0, rx, ry, rot, large, sweep, x, y) => { out.push(['A', x0, y0, rx, ry, rot, large, sweep, x, y]); },
    close: (x0, y0, sx, sy) => { out.push(['Z', x0, y0, sx, sy]); },
  };
  readPathData(d, sink);
  return out;
}

describe('readPathData', () => {
  test.each<[string, Call[]]>([
    ['M10 20L30 40', [['M', 10, 20], ['L', 10, 20, 30, 40]]],
    ['M10,20 l-5-5', [['M', 10, 20], ['L', 10, 20, 5, 15]]],
    ['M.5.5', [['M', 0.5, 0.5]]],
    ['M1e2 1E-2 L2.5e+1 0', [['M', 100, 0.01], ['L', 100, 0.01, 25, 0]]],
    ['M+1 -.25', [['M', 1, -0.25]]],
    ['M1. 2', [['M', 1, 2]]],
    ['  \n\tz Z ', [['Z', 0, 0, 0, 0], ['Z', 0, 0, 0, 0]]],
    ['M0 0 x 5 # 6', [['M', 0, 0], ['L', 0, 0, 5, 6]]],
  ])('a number ends where the next character cannot continue it, and anything else only separates: %j', (d, expected) => {
    expect(calls(d)).toEqual(expected);
  });

  test('M then L, absolute and relative', () => {
    expect(calls('M10 10 L20 10 l5 5')).toEqual([
      ['M', 10, 10],
      ['L', 10, 10, 20, 10],
      ['L', 20, 10, 25, 15],
    ]);
  });

  test("an M's further pairs are lines, a relative m's relative to the point before each", () => {
    expect(calls('M0 0 10 0 10 10')).toEqual([['M', 0, 0], ['L', 0, 0, 10, 0], ['L', 10, 0, 10, 10]]);
    expect(calls('m5 5 10 0 0 10')).toEqual([['M', 5, 5], ['L', 5, 5, 15, 5], ['L', 15, 5, 15, 15]]);
  });

  test('a relative m starts from the current point; the first m from (0, 0)', () => {
    expect(calls('M10 10 L20 20 m5 5')).toEqual([['M', 10, 10], ['L', 10, 10, 20, 20], ['M', 25, 25]]);
  });

  test('H and V draw a line along one axis, absolute and relative', () => {
    expect(calls('M1 2 H10 V20 h-5 v-5')).toEqual([
      ['M', 1, 2],
      ['L', 1, 2, 10, 2],
      ['L', 10, 2, 10, 20],
      ['L', 10, 20, 5, 20],
      ['L', 5, 20, 5, 15],
    ]);
  });

  test('implicit repeats are each a call', () => {
    expect(calls('M0 0 L1 1 2 2 H3 4 V5 6')).toEqual([
      ['M', 0, 0],
      ['L', 0, 0, 1, 1],
      ['L', 1, 1, 2, 2],
      ['L', 2, 2, 3, 2],
      ['L', 3, 2, 4, 2],
      ['L', 4, 2, 4, 5],
      ['L', 4, 5, 4, 6],
    ]);
  });

  test('C and Q, absolute and relative (every control point from the start of the curve)', () => {
    expect(calls('M10 10 C10 20 20 20 20 10 c0 10 10 10 10 0')).toEqual([
      ['M', 10, 10],
      ['C', 10, 10, 10, 20, 20, 20, 20, 10],
      ['C', 20, 10, 20, 20, 30, 20, 30, 10],
    ]);
    expect(calls('M10 10 Q15 20 20 10 q5 10 10 0')).toEqual([
      ['M', 10, 10],
      ['Q', 10, 10, 15, 20, 20, 10],
      ['Q', 20, 10, 25, 20, 30, 10],
    ]);
  });

  test('S reflects the last control point after a C or an S, and starts from the current point otherwise', () => {
    expect(calls('M0 0 C0 10 10 10 10 0 S20 -10 20 0 s0 10 10 0')).toEqual([
      ['M', 0, 0],
      ['C', 0, 0, 0, 10, 10, 10, 10, 0],
      ['C', 10, 0, 10, -10, 20, -10, 20, 0],
      ['C', 20, 0, 20, 10, 20, 10, 30, 0],
    ]);
    expect(calls('M0 0 L5 5 S10 10 20 0')).toEqual([
      ['M', 0, 0], ['L', 0, 0, 5, 5], ['C', 5, 5, 5, 5, 10, 10, 20, 0],
    ]);
    // A Q is not a C: an S after it does not reflect.
    expect(calls('M0 0 Q5 5 10 0 S15 5 20 0')).toEqual([
      ['M', 0, 0], ['Q', 0, 0, 5, 5, 10, 0], ['C', 10, 0, 10, 0, 15, 5, 20, 0],
    ]);
    // A repeated S reflects from its second curve on, whatever came before.
    expect(calls('M0 0 S0 10 10 10 20 10 30 0')).toEqual([
      ['M', 0, 0], ['C', 0, 0, 0, 0, 0, 10, 10, 10], ['C', 10, 10, 20, 10, 20, 10, 30, 0],
    ]);
  });

  test('T reflects the last control point after a Q or a T, and starts from the current point otherwise', () => {
    expect(calls('M0 0 Q5 10 10 0 T20 0 t10 0')).toEqual([
      ['M', 0, 0],
      ['Q', 0, 0, 5, 10, 10, 0],
      ['Q', 10, 0, 15, -10, 20, 0],
      ['Q', 20, 0, 25, 10, 30, 0],
    ]);
    // A C is not a Q: a T after it does not reflect.
    expect(calls('M0 0 C0 10 10 10 10 0 T20 0')).toEqual([
      ['M', 0, 0], ['C', 0, 0, 0, 10, 10, 10, 10, 0], ['Q', 10, 0, 10, 0, 20, 0],
    ]);
  });

  test('a Z closes to the subpath start and returns the current point there', () => {
    expect(calls('M10 10 L20 10 L20 20 Z l5 0')).toEqual([
      ['M', 10, 10],
      ['L', 10, 10, 20, 10],
      ['L', 20, 10, 20, 20],
      ['Z', 20, 20, 10, 10],
      ['L', 10, 10, 15, 10],
    ]);
    // The start is the latest M's: a second subpath closes to its own.
    expect(calls('M0 0 L1 0 Z M5 5 L6 5 z')).toEqual([
      ['M', 0, 0], ['L', 0, 0, 1, 0], ['Z', 1, 0, 0, 0],
      ['M', 5, 5], ['L', 5, 5, 6, 5], ['Z', 6, 5, 5, 5],
    ]);
  });

  test('a Z breaks an S / T reflection', () => {
    expect(calls('M0 0 C0 10 10 10 10 0 Z S10 10 20 0')).toEqual([
      ['M', 0, 0], ['C', 0, 0, 0, 10, 10, 10, 10, 0], ['Z', 10, 0, 0, 0], ['C', 0, 0, 0, 0, 10, 10, 20, 0],
    ]);
  });

  test('A: radii and rotation as written, the flags as booleans, the end absolute or relative', () => {
    expect(calls('M0 0 A10 5 30 0 1 20 0 a-10 5 0 1 0 20 0')).toEqual([
      ['M', 0, 0],
      ['A', 0, 0, 10, 5, 30, false, true, 20, 0],
      ['A', 20, 0, -10, 5, 0, true, false, 40, 0],
    ]);
  });

  test("an arc's flags are one character each, so they may run on into what follows them", () => {
    // Report 1f5ff91e: a minifier writes `0 1 10` as `0110`, which a reader
    // that took it for one number read as the flag 110 and went on wrong.
    expect(calls('M0 0 a5 5 0 0110 10')).toEqual([['M', 0, 0], ['A', 0, 0, 5, 5, 0, false, true, 10, 10]]);
    expect(calls('M0 0 A5 5 0 1110 10')).toEqual([['M', 0, 0], ['A', 0, 0, 5, 5, 0, true, true, 10, 10]]);
    expect(calls('M0 0 a5 5 0 01-10 10')).toEqual([['M', 0, 0], ['A', 0, 0, 5, 5, 0, false, true, -10, 10]]);
    expect(calls('M0 0 A5 5 0 1 1.5.5')).toEqual([['M', 0, 0], ['A', 0, 0, 5, 5, 0, true, true, 0.5, 0.5]]);
    // Each repeat of the arc reads its own flags the same way.
    expect(calls('M0 0 a5 5 0 0110 10 5 5 0 1010 0')).toEqual([
      ['M', 0, 0],
      ['A', 0, 0, 5, 5, 0, false, true, 10, 10],
      ['A', 10, 10, 5, 5, 0, true, false, 20, 10],
    ]);
    // Written apart, they read as they always did.
    expect(calls('M0 0 A5 5 0 0 1 10 10')).toEqual([['M', 0, 0], ['A', 0, 0, 5, 5, 0, false, true, 10, 10]]);
    expect(calls('M0 0 A5 5 0,1,0,10,10')).toEqual([['M', 0, 0], ['A', 0, 0, 5, 5, 0, true, false, 10, 10]]);
  });

  test('a flag written as some other number is read as that number, true unless it is zero', () => {
    expect(calls('M0 0 A5 5 0 2 -0 10 10')).toEqual([['M', 0, 0], ['A', 0, 0, 5, 5, 0, true, false, 10, 10]]);
    expect(calls('M0 0 A5 5 0 -1 .5 10 10')).toEqual([['M', 0, 0], ['A', 0, 0, 5, 5, 0, true, true, 10, 10]]);
  });

  test('only an arc reads flags: a number that starts with 0 or 1 is one number anywhere else', () => {
    expect(calls('M0110 10')).toEqual([['M', 110, 10]]);
    expect(calls('M0 0 A0110 10 0 0 1 5 5')).toEqual([['M', 0, 0], ['A', 0, 0, 110, 10, 0, false, true, 5, 5]]);
  });

  test('a number no command takes is skipped; drawing before any M starts from (0, 0)', () => {
    expect(calls('5 5 L10 10')).toEqual([['L', 0, 0, 10, 10]]);
    expect(calls('M0 0 L1 1 Z 7 8 L2 2')).toEqual([
      ['M', 0, 0], ['L', 0, 0, 1, 1], ['Z', 1, 1, 0, 0], ['L', 0, 0, 2, 2],
    ]);
  });

  test('an M with no numbers draws nothing', () => {
    expect(calls('M L5 5')).toEqual([['L', 0, 0, 5, 5]]);
  });

  test('a command short of numbers reads what is missing as NaN, a command letter it takes included', () => {
    expect(calls('M0 0 L5')).toEqual([['M', 0, 0], ['L', 0, 0, 5, NaN]]);
    // The L takes the Z as its y, so there is no close.
    expect(calls('M0 0 L5 Z')).toEqual([['M', 0, 0], ['L', 0, 0, 5, NaN]]);
  });

  test('the empty path reads as nothing', () => {
    expect(calls('')).toEqual([]);
    expect(calls('   ')).toEqual([]);
  });
});

describe('one reader of path data', () => {
  // The three readers that had a tokenizer and a command reader of their
  // own (report ed8ff7f1) read path data here, and nothing in the engine's
  // packages tokenizes it again.
  const PACKAGES = path.resolve(__dirname, '..', '..', '..');
  const READERS = [
    'engine/src/simplifySVG.ts',
    'engine/src/figureToPaths.ts',
    'editor/src/formats/svgImageGeometry.ts',
  ];
  const read = (rel: string) => fs.readFileSync(path.join(PACKAGES, rel), 'utf8');

  test.each(READERS)('%s reads path data with readPathData', (rel) => {
    const src = read(rel);
    expect(src).toMatch(/^import \{ readPathData \} from '(\.|@\/engine)\/svgPathData';$/m);
    expect(src).toMatch(/\breadPathData\(d, \{/);
    expect(src).not.toMatch(/function tokenize\w*\(/);
  });

  test('no other source in the packages carries the path-data number pattern', () => {
    const NUMBER_PATTERN = '(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?';
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(full);
        } else if (/\.tsx?$/.test(entry.name) && fs.readFileSync(full, 'utf8').includes(NUMBER_PATTERN)) {
          hits.push(path.relative(PACKAGES, full).split(path.sep).join('/'));
        }
      }
    };
    for (const pkg of fs.readdirSync(PACKAGES)) {
      const src = path.join(PACKAGES, pkg, 'src');
      if (fs.existsSync(src)) walk(src);
    }
    expect(hits).toEqual(['engine/src/svgPathData.ts']);
  });
});
