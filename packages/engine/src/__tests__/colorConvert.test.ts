import { hsvToRgb, rgbToHsv } from '../colorConvert';

describe('hsvToRgb', () => {
  it('converts black (v=0)', () => {
    expect(hsvToRgb(0, 0, 0)).toEqual([0, 0, 0]);
  });

  it('converts white (s=0, v=1)', () => {
    expect(hsvToRgb(0, 0, 1)).toEqual([255, 255, 255]);
  });

  it('converts pure red', () => {
    expect(hsvToRgb(0, 1, 1)).toEqual([255, 0, 0]);
  });

  it('converts pure green', () => {
    expect(hsvToRgb(120, 1, 1)).toEqual([0, 255, 0]);
  });

  it('converts pure blue', () => {
    expect(hsvToRgb(240, 1, 1)).toEqual([0, 0, 255]);
  });

  it('converts yellow', () => {
    expect(hsvToRgb(60, 1, 1)).toEqual([255, 255, 0]);
  });

  it('converts cyan', () => {
    expect(hsvToRgb(180, 1, 1)).toEqual([0, 255, 255]);
  });

  it('converts magenta', () => {
    expect(hsvToRgb(300, 1, 1)).toEqual([255, 0, 255]);
  });

  it('converts a desaturated color', () => {
    // HSV(0, 0.5, 0.5) → mid-gray red
    const [r, g, b] = hsvToRgb(0, 0.5, 0.5);
    expect(r).toBe(128);
    expect(g).toBe(64);
    expect(b).toBe(64);
  });
});

describe('rgbToHsv', () => {
  it('converts black', () => {
    expect(rgbToHsv(0, 0, 0)).toEqual([0, 0, 0]);
  });

  it('converts white', () => {
    expect(rgbToHsv(255, 255, 255)).toEqual([0, 0, 1]);
  });

  it('converts pure red', () => {
    expect(rgbToHsv(255, 0, 0)).toEqual([0, 1, 1]);
  });

  it('converts pure green', () => {
    expect(rgbToHsv(0, 255, 0)).toEqual([120, 1, 1]);
  });

  it('converts pure blue', () => {
    expect(rgbToHsv(0, 0, 255)).toEqual([240, 1, 1]);
  });
});

describe('round-trip', () => {
  const cases: [number, number, number][] = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
    [128, 64, 32],
    [0, 0, 0],
    [255, 255, 255],
    [100, 200, 50],
  ];

  it.each(cases)('rgb(%i, %i, %i) round-trips', (r, g, b) => {
    const [h, s, v] = rgbToHsv(r, g, b);
    const [r2, g2, b2] = hsvToRgb(h, s, v);
    expect(r2).toBeCloseTo(r, 0);
    expect(g2).toBeCloseTo(g, 0);
    expect(b2).toBeCloseTo(b, 0);
  });
});
