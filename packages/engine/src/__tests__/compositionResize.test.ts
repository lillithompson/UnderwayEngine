import { computeFigureAspectRatio, computeImageAspectRatio, shouldAspectLockScale } from '../compositionResize';

describe('shouldAspectLockScale', () => {
  const base = {
    isGrouped: false,
    isFigure: false,
    figureTiled: false,
    isNonFigureNode: false,
    isSimpleLine: false,
    isTiledPath: false,
    isRectangle: false,
  };

  it('locks a grouped rectangle (e.g. a mask shape)', () => {
    expect(shouldAspectLockScale({
      ...base, isGrouped: true, isNonFigureNode: true, isRectangle: true,
    })).toBe(true);
  });

  it('locks a grouped tiled path', () => {
    expect(shouldAspectLockScale({
      ...base, isGrouped: true, isNonFigureNode: true, isTiledPath: true,
    })).toBe(true);
  });

  it('locks a grouped simple line', () => {
    expect(shouldAspectLockScale({
      ...base, isGrouped: true, isNonFigureNode: true, isSimpleLine: true,
    })).toBe(true);
  });

  it('locks a grouped figure regardless of tiling', () => {
    expect(shouldAspectLockScale({
      ...base, isGrouped: true, isFigure: true, figureTiled: true,
    })).toBe(true);
  });

  it('does not lock an ungrouped rectangle', () => {
    expect(shouldAspectLockScale({
      ...base, isNonFigureNode: true, isRectangle: true,
    })).toBe(false);
  });

  it('does not lock an ungrouped tiled path', () => {
    expect(shouldAspectLockScale({
      ...base, isNonFigureNode: true, isTiledPath: true,
    })).toBe(false);
  });

  it('does not lock an ungrouped simple line', () => {
    expect(shouldAspectLockScale({
      ...base, isNonFigureNode: true, isSimpleLine: true,
    })).toBe(false);
  });

  it('locks an ungrouped single non-tile figure', () => {
    expect(shouldAspectLockScale({
      ...base, isFigure: true,
    })).toBe(true);
  });

  it('does not lock an ungrouped tiled single figure', () => {
    expect(shouldAspectLockScale({
      ...base, isFigure: true, figureTiled: true,
    })).toBe(false);
  });

  it('locks an ungrouped non-figure node that is not line/tile/rectangle', () => {
    expect(shouldAspectLockScale({
      ...base, isNonFigureNode: true,
    })).toBe(true);
  });
});

describe('computeFigureAspectRatio', () => {
  it('returns resolutionX / resolutionY for a non-rotated figure', () => {
    const fig = { resolutionX: 4, resolutionY: 2, rotation: 0 as const };
    expect(computeFigureAspectRatio(fig, 8, 4)).toBe(2);
  });

  it('swaps resolution for 90-degree rotation', () => {
    const fig = { resolutionX: 4, resolutionY: 2, rotation: 90 as const };
    expect(computeFigureAspectRatio(fig, 2, 4)).toBe(0.5);
  });

  it('does not swap resolution for 180-degree rotation', () => {
    const fig = { resolutionX: 4, resolutionY: 2, rotation: 180 as const };
    expect(computeFigureAspectRatio(fig, 8, 4)).toBe(2);
  });

  it('swaps resolution for 270-degree rotation', () => {
    const fig = { resolutionX: 4, resolutionY: 2, rotation: 270 as const };
    expect(computeFigureAspectRatio(fig, 2, 4)).toBe(0.5);
  });

  it('uses orig dimensions for group figures', () => {
    const fig = { resolutionX: 4, resolutionY: 2, groupId: 'g1' };
    expect(computeFigureAspectRatio(fig, 6, 3)).toBe(2);
  });

  it('falls back to orig dimensions when resolutionX is zero', () => {
    const fig = { resolutionX: 0, resolutionY: 2 };
    expect(computeFigureAspectRatio(fig, 6, 3)).toBe(2);
  });

  it('falls back to orig dimensions when resolutionY is zero', () => {
    const fig = { resolutionX: 4, resolutionY: 0 };
    expect(computeFigureAspectRatio(fig, 6, 3)).toBe(2);
  });

  it('uses resolution even when orig dimensions are corrupted (square)', () => {
    const fig = { resolutionX: 4, resolutionY: 2, rotation: 0 as const };
    // orig is square due to prior min-size corruption, but resolution preserves truth
    expect(computeFigureAspectRatio(fig, 4, 4)).toBe(2);
  });

  it('defaults to no rotation when rotation is undefined', () => {
    const fig = { resolutionX: 3, resolutionY: 1 };
    expect(computeFigureAspectRatio(fig, 6, 2)).toBe(3);
  });
});

describe('computeImageAspectRatio', () => {
  it('returns pixelWidth / pixelHeight for a non-rotated image', () => {
    const img = { pixelWidth: 1024, pixelHeight: 768, rotation: 0 as const };
    expect(computeImageAspectRatio(img, 8, 6)).toBeCloseTo(1024 / 768);
  });

  it('swaps pixel dims for 90-degree rotation', () => {
    const img = { pixelWidth: 1024, pixelHeight: 768, rotation: 90 as const };
    expect(computeImageAspectRatio(img, 6, 8)).toBeCloseTo(768 / 1024);
  });

  it('does not swap pixel dims for 180-degree rotation', () => {
    const img = { pixelWidth: 1024, pixelHeight: 768, rotation: 180 as const };
    expect(computeImageAspectRatio(img, 8, 6)).toBeCloseTo(1024 / 768);
  });

  it('swaps pixel dims for 270-degree rotation', () => {
    const img = { pixelWidth: 1024, pixelHeight: 768, rotation: 270 as const };
    expect(computeImageAspectRatio(img, 6, 8)).toBeCloseTo(768 / 1024);
  });

  it('falls back to orig dimensions when pixelWidth is zero', () => {
    const img = { pixelWidth: 0, pixelHeight: 768 };
    expect(computeImageAspectRatio(img, 6, 3)).toBe(2);
  });

  it('falls back to orig dimensions when pixelHeight is zero', () => {
    const img = { pixelWidth: 1024, pixelHeight: 0 };
    expect(computeImageAspectRatio(img, 6, 3)).toBe(2);
  });

  it('uses pixel dims even when orig dimensions are distorted', () => {
    const img = { pixelWidth: 1024, pixelHeight: 768, rotation: 0 as const };
    // orig is square due to prior snap corruption, but pixel dims preserve truth
    expect(computeImageAspectRatio(img, 4, 4)).toBeCloseTo(1024 / 768);
  });

  it('defaults to no rotation when rotation is undefined', () => {
    const img = { pixelWidth: 1024, pixelHeight: 512 };
    expect(computeImageAspectRatio(img, 8, 4)).toBe(2);
  });
});
