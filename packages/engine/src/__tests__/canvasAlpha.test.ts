import { ALPHA_SCAN_BAND_ROWS, canvasHasTransparency } from '../canvasAlpha';

// The probe behind "PNG or JPEG": every pixel read, in bands, first
// translucent pixel wins.

/** A context whose pixels have the alpha `alphaAt` gives, counting the reads. */
function context(alphaAt: (x: number, y: number) => number) {
  const reads: [number, number, number, number][] = [];
  return {
    reads,
    getImageData(sx: number, sy: number, sw: number, sh: number) {
      reads.push([sx, sy, sw, sh]);
      const data = new Uint8ClampedArray(sw * sh * 4).fill(255);
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) data[(y * sw + x) * 4 + 3] = alphaAt(sx + x, sy + y);
      }
      return { data, width: sw, height: sh, colorSpace: 'srgb' } as unknown as ImageData;
    },
  };
}

describe('canvasHasTransparency', () => {
  it('is false for a frame opaque edge to edge', () => {
    expect(canvasHasTransparency(context(() => 255), 10, 10)).toBe(false);
  });

  it('finds one translucent pixel anywhere, not only at sample points', () => {
    // A sampled 16×16 grid would step past a single pixel at (7, 200).
    const ctx = context((x, y) => (x === 7 && y === 200 ? 254 : 255));
    expect(canvasHasTransparency(ctx, 300, 300)).toBe(true);
  });

  it('reads in bands of ALPHA_SCAN_BAND_ROWS, the last one short, and stops at the first hit', () => {
    const ctx = context(() => 255);
    expect(canvasHasTransparency(ctx, 8, 150)).toBe(false);
    expect(ctx.reads).toEqual([
      [0, 0, 8, ALPHA_SCAN_BAND_ROWS],
      [0, ALPHA_SCAN_BAND_ROWS, 8, ALPHA_SCAN_BAND_ROWS],
      [0, 2 * ALPHA_SCAN_BAND_ROWS, 8, 150 - 2 * ALPHA_SCAN_BAND_ROWS],
    ]);
    // A transparent margin at the top answers on the first band alone.
    const margin = context((_x, y) => (y < 2 ? 0 : 255));
    expect(canvasHasTransparency(margin, 8, 150)).toBe(true);
    expect(margin.reads).toHaveLength(1);
  });

  it('an empty frame has nothing translucent in it', () => {
    const ctx = context(() => 0);
    expect(canvasHasTransparency(ctx, 0, 0)).toBe(false);
    expect(ctx.reads).toEqual([]);
  });
});
