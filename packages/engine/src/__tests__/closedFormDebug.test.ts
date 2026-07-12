import * as fs from 'fs';
import * as zlib from 'zlib';
import * as path from 'path';
import { deserializeComposition } from '../compositionBinaryFormat';
import { isClosedPath, chainSegments } from '../compositionArcMath';

it('closedForm.tile SVG object is detected as closed', () => {
  const compressed = fs.readFileSync(
    path.join(__dirname, '../../test_data/closedForm.tile'),
  );
  const payload = new Uint8Array(zlib.inflateSync(compressed));
  const result = deserializeComposition(payload);
  const svgs = result.meta.svgObjects ?? [];

  expect(svgs.length).toBe(1);
  expect(isClosedPath(svgs[0].segments)).toBe(true);
});

it('closedForm.tile segments can be chained', () => {
  const compressed = fs.readFileSync(
    path.join(__dirname, '../../test_data/closedForm.tile'),
  );
  const payload = new Uint8Array(zlib.inflateSync(compressed));
  const result = deserializeComposition(payload);
  const svgs = result.meta.svgObjects ?? [];
  const chained = chainSegments(svgs[0].segments);
  expect(chained).not.toBeNull();
  // Chained segments should be sequential end-to-start
  for (let i = 0; i < chained!.length; i++) {
    const next = chained![(i + 1) % chained!.length];
    expect(Math.abs(chained![i].end[0] - next.start[0])).toBeLessThan(1e-6);
    expect(Math.abs(chained![i].end[1] - next.start[1])).toBeLessThan(1e-6);
  }
});
