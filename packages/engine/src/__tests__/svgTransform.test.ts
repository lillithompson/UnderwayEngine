import * as fs from 'fs';
import * as path from 'path';
import { applyMatrix, multiplyMatrices, parseTransform } from '../svgTransform';

// The engine's one reader of an SVG `transform` attribute (report bbf6797b:
// simplifySVG and figureToPaths each had their own, with two rotations
// about a point).

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
    const [x, y] = applyMatrix(m, 128, 128);
    expect(x).toBeCloseTo(128);
    expect(y).toBeCloseTo(128);
  });

  test("rotate with center is the spec's translate · rotate · translate back, multiplied out", () => {
    // The closed form the figure bake always used, so the tile sprites'
    // rotated circles bake to the same numbers they did (exact, not close).
    const rad = (-45 * Math.PI) / 180;
    const c = Math.cos(rad), s = Math.sin(rad);
    expect(parseTransform('rotate(-45 128 128)')).toEqual([c, s, -s, c, 128 - c * 128 + s * 128, 128 - s * 128 - c * 128]);
    // And it is that product, to rounding.
    const product = multiplyMatrices([1, 0, 0, 1, 30, -7], multiplyMatrices(parseTransform('rotate(33)'), [1, 0, 0, 1, -30, 7]));
    parseTransform('rotate(33 30 -7)').forEach((v, i) => expect(v).toBeCloseTo(product[i], 12));
  });

  test('rotate with one number after the angle is about the origin (the spec takes one or three)', () => {
    expect(parseTransform('rotate(30, 50)')).toEqual(parseTransform('rotate(30)'));
  });

  test('composed transform from tile pipeline', () => {
    const m = parseTransform('translate(256,0) scale(1) translate(128,128) rotate(90) scale(-1,1) translate(-128,-128)');
    // This represents a tile at position (256,0) with 90° rotation and horizontal mirror
    // Point (128,128) in local space should map to (256+128, 0+128) = (384, 128) since
    // the rotation center is (128,128) and the tile is translated to (256,0)
    const [x, y] = applyMatrix(m, 128, 128);
    expect(x).toBeCloseTo(384);
    expect(y).toBeCloseTo(128);
  });

  test('the functions apply right to left, and one the reader does not know is skipped', () => {
    // translate then scale: the point is scaled first.
    expect(applyMatrix(parseTransform('translate(10 0) scale(2)'), 1, 1)).toEqual([12, 2]);
    expect(applyMatrix(parseTransform('scale(2) translate(10 0)'), 1, 1)).toEqual([22, 2]);
    expect(parseTransform('skewX(30) translate(5, 6)')).toEqual(parseTransform('translate(5, 6)'));
    expect(parseTransform('matrix(1 2 3 4 5 6)')).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('one transform reader', () => {
  const SRC = path.resolve(__dirname, '..');
  const read = (name: string) => fs.readFileSync(path.join(SRC, name), 'utf8');

  test.each(['simplifySVG.ts', 'figureToPaths.ts'])('%s reads transforms with svgTransform and keeps no parser of its own', (name) => {
    const src = read(name);
    expect(src).toMatch(/^import \{[^}]*\bparseTransform\b[^}]*\} from '\.\/svgTransform';$/m);
    expect(src).not.toMatch(/function (parseTransform|multiplyMatrices|applyMatrix)\(/);
  });

  test('no other source in the packages parses a transform list', () => {
    const PACKAGES = path.resolve(SRC, '..', '..');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(full);
        } else if (/\.tsx?$/.test(entry.name) && /function (parseTransform|multiplyMatrices)\(/.test(fs.readFileSync(full, 'utf8'))) {
          hits.push(path.relative(PACKAGES, full).split(path.sep).join('/'));
        }
      }
    };
    for (const pkg of fs.readdirSync(PACKAGES)) {
      const src = path.join(PACKAGES, pkg, 'src');
      if (fs.existsSync(src)) walk(src);
    }
    expect(hits).toEqual(['engine/src/svgTransform.ts']);
  });
});
