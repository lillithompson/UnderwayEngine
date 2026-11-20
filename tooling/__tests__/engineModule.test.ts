import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { imageHeaderSize, pngHeaderSize } from '../../packages/engine/src/imageHeaderSize';
import { parsePathD } from '../../packages/engine/src/simplifySVG';

// tooling/engine-module.js runs the engine's TypeScript from plain-node
// scripts, so the case studies (and a project's scripts) read with the app's
// own code rather than copies of it (DrawBot report 377295be).

/* eslint-disable @typescript-eslint/no-var-requires */
const { engineModule } = require('../engine-module.js');
/* eslint-enable @typescript-eslint/no-var-requires */

function png(w: number, h: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13, false);
  for (let i = 0; i < 4; i++) bytes[12 + i] = 'IHDR'.charCodeAt(i);
  view.setUint32(16, w, false);
  view.setUint32(20, h, false);
  return bytes;
}

describe('engineModule', () => {
  it('serves an engine module that answers as the engine does', () => {
    const served = engineModule('imageHeaderSize');
    expect(served.pngHeaderSize(png(640, 480))).toEqual(pngHeaderSize(png(640, 480)));
    expect(served.imageHeaderSize(png(3, 2))).toEqual(imageHeaderSize(png(3, 2)));
    expect(served.pngHeaderSize(png(0, 2))).toBeNull();
  });

  it('compiles a module once, and serves the siblings it imports the same way', () => {
    expect(engineModule('imageHeaderSize')).toBe(engineModule('imageHeaderSize'));
    // simplifySVG.ts imports ./svgPathData.
    expect(engineModule('simplifySVG').parsePathD('M0 0 L10 0')).toEqual(parsePathD('M0 0 L10 0'));
  });

  it('refuses an import that is not an engine sibling, naming it', () => {
    // imageDataUri.ts imports '@/engine/pngcodec', an alias plain node cannot resolve.
    expect(() => engineModule('imageDataUri')).toThrow(/imports @\/engine\/pngcodec, which is not served/);
  });

  it('is what the case studies read a frame\'s size with, not a copy of the IHDR read', () => {
    const src = readFileSync(join(__dirname, '..', 'case_studies', 'build-writeup.js'), 'utf8');
    expect(src).toContain("engineModule('imageHeaderSize').pngHeaderSize(buf)");
    expect(src).not.toMatch(/readUInt32BE|'IHDR'/);
  });
});
