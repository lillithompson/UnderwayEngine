import { CompositionState, CompositionFigure, SVGObject, PathSegment } from '../types';
import { findPatternFillInfo, patternFillBackground } from '../patternFill';

// The pattern-fill BUILDER was removed with the old pattern system; only the
// two legacy-document lookups remain. Fixtures below hand-build the saved
// document shape the builder used to produce: a mask (isMask + isPatternFill)
// grouped with a tileMode:'repeat' figure.

function squareSegments(x: number, y: number, size: number): PathSegment[] {
  return [
    { kind: 'line', start: [x, y], end: [x + size, y] },
    { kind: 'line', start: [x + size, y], end: [x + size, y + size] },
    { kind: 'line', start: [x + size, y + size], end: [x, y + size] },
    { kind: 'line', start: [x, y + size], end: [x, y] },
  ];
}

function makeMask(id: string, overrides: Partial<SVGObject> = {}): SVGObject {
  const segs = overrides.segments ?? squareSegments(4, 6, 10);
  return {
    id,
    color: { r: 0, g: 0, b: 0 },
    segments: segs,
    cellX: 4, cellY: 6, cellWidth: 10, cellHeight: 10,
    ...overrides,
  };
}

function makeTiledFigure(id: string, overrides: Partial<CompositionFigure> = {}): CompositionFigure {
  return {
    id,
    figureKey: 'file_file9_L1',
    fileId: 'file9',
    tileMode: 'repeat',
    groupId: 'grp_pf',
    cellX: 4, cellY: 6, cellWidth: 10, cellHeight: 10,
    resolutionX: 2, resolutionY: 2,
    ...overrides,
  } as CompositionFigure;
}

function makeState(svgObjects: SVGObject[], figures: CompositionFigure[] = []): CompositionState {
  return {
    figures, svgObjects, images: [], groups: [],
    sceneOrder: [...figures.map(f => f.id), ...svgObjects.map(s => s.id)],
  } as unknown as CompositionState;
}

describe('findPatternFillInfo', () => {
  test('resolves the tiled figure of a pattern-fill mask via the shared group', () => {
    const mask = makeMask('m1', { isMask: true, isPatternFill: true, groupId: 'grp_pf' });
    const fig = makeTiledFigure('fig_pf');
    const info = findPatternFillInfo(makeState([mask], [fig]), 'm1');
    expect(info).not.toBeNull();
    expect(info!.figureId).toBe('fig_pf');
    expect(info!.fileId).toBe('file9');
    expect(info!.figureKey).toBe('file_file9_L1');
  });

  test('returns null for a plain (non-pattern) mask', () => {
    const mask = makeMask('m1', { isMask: true, groupId: 'g' });
    expect(findPatternFillInfo(makeState([mask]), 'm1')).toBeNull();
  });

  test('returns null when the group has no repeat-tiled sibling figure', () => {
    const mask = makeMask('m1', { isMask: true, isPatternFill: true, groupId: 'grp_pf' });
    const fig = makeTiledFigure('fig_pf', { tileMode: undefined });
    expect(findPatternFillInfo(makeState([mask], [fig]), 'm1')).toBeNull();
  });

  test('returns null for an unknown mask id', () => {
    expect(findPatternFillInfo(makeState([]), 'nope')).toBeNull();
  });
});

describe('patternFillBackground', () => {
  test('returns the mask fill for the tiled figure of a pattern fill', () => {
    const mask = makeMask('m1', {
      isMask: true, isPatternFill: true, groupId: 'grp_pf',
      fillColor: { r: 1, g: 2, b: 3 }, fillOpacity: 0.5,
    });
    const fig = makeTiledFigure('fig_pf');
    expect(patternFillBackground(fig, [mask])).toEqual({
      fillColor: { r: 1, g: 2, b: 3 }, fillOpacity: 0.5,
    });
  });

  test('returns null when the mask carries no fill color', () => {
    const mask = makeMask('m1', { isMask: true, isPatternFill: true, groupId: 'grp_pf' });
    const fig = makeTiledFigure('fig_pf');
    expect(patternFillBackground(fig, [mask])).toBeNull();
  });

  test('returns null for a non-pattern tiled figure (no group)', () => {
    const mask = makeMask('m1', {
      isMask: true, isPatternFill: true, groupId: 'grp_pf',
      fillColor: { r: 1, g: 2, b: 3 },
    });
    const fig = makeTiledFigure('fig_pf', { groupId: undefined });
    expect(patternFillBackground(fig, [mask])).toBeNull();
  });
});
