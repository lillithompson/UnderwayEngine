import { nextFigureName, nextGroupName, computeFigureDisplayName, computeUnplacedFileIds } from '../sceneOutlineHelpers';
import type { CompositionFigure } from '../types';
import type { PaletteItem } from '../figures';

function makeFigure(name?: string): CompositionFigure {
  return {
    id: Math.random().toString(),
    figureKey: 'test',
    cellX: 0,
    cellY: 0,
    resolutionX: 2,
    resolutionY: 2,
    cellWidth: 4,
    cellHeight: 4,
    name,
  } as CompositionFigure;
}

describe('nextFigureName', () => {
  it('returns "Figure 1" by default when no figures exist', () => {
    expect(nextFigureName([])).toBe('Figure 1');
  });

  it('returns "Figure 2" when Figure 1 exists', () => {
    expect(nextFigureName([makeFigure('Figure 1')])).toBe('Figure 2');
  });

  it('returns max + 1 with gaps for Figure prefix', () => {
    const figures = [makeFigure('Figure 1'), makeFigure('Figure 5')];
    expect(nextFigureName(figures)).toBe('Figure 6');
  });

  it('ignores figures with non-matching names', () => {
    const figures = [makeFigure('My Custom Name'), makeFigure('Figure 3')];
    expect(nextFigureName(figures)).toBe('Figure 4');
  });

  it('ignores figures without a name', () => {
    const figures = [makeFigure(undefined), makeFigure('Figure 2')];
    expect(nextFigureName(figures)).toBe('Figure 3');
  });

  it('does not count Pattern names when using Figure prefix', () => {
    const figures = [makeFigure('Pattern 5'), makeFigure('Figure 1')];
    expect(nextFigureName(figures)).toBe('Figure 2');
  });

  it('returns "Pattern 1" when using Pattern prefix with no patterns', () => {
    expect(nextFigureName([], 'Pattern')).toBe('Pattern 1');
  });

  it('returns "Pattern 2" when Pattern 1 exists', () => {
    expect(nextFigureName([makeFigure('Pattern 1')], 'Pattern')).toBe('Pattern 2');
  });

  it('returns max + 1 with gaps for Pattern prefix', () => {
    const figures = [makeFigure('Pattern 1'), makeFigure('Pattern 5')];
    expect(nextFigureName(figures, 'Pattern')).toBe('Pattern 6');
  });

  it('does not count Figure names when using Pattern prefix', () => {
    const figures = [makeFigure('Figure 5'), makeFigure('Pattern 1')];
    expect(nextFigureName(figures, 'Pattern')).toBe('Pattern 2');
  });

  it('handles mixed Figure and Pattern names independently', () => {
    const figures = [makeFigure('Figure 3'), makeFigure('Pattern 2')];
    expect(nextFigureName(figures)).toBe('Figure 4');
    expect(nextFigureName(figures, 'Pattern')).toBe('Pattern 3');
  });
});

describe('nextGroupName', () => {
  it('returns "Group 1" when no groups exist', () => {
    expect(nextGroupName([])).toBe('Group 1');
  });

  it('returns "Group 2" when Group 1 exists', () => {
    expect(nextGroupName([makeFigure('Group 1')])).toBe('Group 2');
  });

  it('returns max + 1 with gaps', () => {
    const figures = [makeFigure('Group 1'), makeFigure('Group 5')];
    expect(nextGroupName(figures)).toBe('Group 6');
  });

  it('ignores non-group names', () => {
    const figures = [makeFigure('Figure 3'), makeFigure('Group 2')];
    expect(nextGroupName(figures)).toBe('Group 3');
  });

  // A scene of svgs / images / texts has no figure carrying the group name;
  // without the GroupNodes every group would come back "Group 1".
  it('numbers past existing groups in a scene with no figures', () => {
    expect(nextGroupName([], [{ name: 'Group 1' }, { name: 'Group 2' }])).toBe('Group 3');
  });

  it('takes the max across figures and groups together', () => {
    expect(nextGroupName([makeFigure('Group 4')], [{ name: 'Group 2' }])).toBe('Group 5');
  });
});

describe('computeFigureDisplayName', () => {
  function makePalette(key: string, label: string, fileId?: string): PaletteItem {
    return { key, label, source: null, dataUri: null, resolutionX: 2, resolutionY: 2, isBaked: true, fileId };
  }

  it('returns figure name when set', () => {
    const fig = makeFigure('My Figure');
    expect(computeFigureDisplayName(fig, [])).toBe('My Figure');
  });

  it('returns palette label when figureKey matches', () => {
    const fig = { ...makeFigure(), figureKey: 'baked_abc123' };
    const palette = [makePalette('baked_abc123', 'Tree')];
    expect(computeFigureDisplayName(fig, palette)).toBe('Tree');
  });

  it('falls back to fileId palette lookup when figureKey does not match', () => {
    const fig = { ...makeFigure(), figureKey: 'file_abc123_L0', fileId: 'abc123' };
    const palette = [makePalette('baked_abc123', 'Tree', 'abc123')];
    expect(computeFigureDisplayName(fig, palette)).toBe('Tree');
  });

  it('returns short-id fallback for file figures with no palette match', () => {
    const fig = { ...makeFigure(), figureKey: 'file_abc123_L0', fileId: 'abc123' };
    expect(computeFigureDisplayName(fig, [])).toBe('Figure abc123');
  });
});

describe('computeUnplacedFileIds', () => {
  it('returns empty set when all lib figures are placed', () => {
    const lib = [{ fileId: 'a' }, { fileId: 'b' }];
    const placed = [{ fileId: 'a' }, { fileId: 'b' }];
    expect(computeUnplacedFileIds(lib, placed)).toEqual(new Set());
  });

  it('returns fileIds of lib figures not placed in composition', () => {
    const lib = [{ fileId: 'a' }, { fileId: 'b' }, { fileId: 'c' }];
    const placed = [{ fileId: 'a' }];
    expect(computeUnplacedFileIds(lib, placed)).toEqual(new Set(['b', 'c']));
  });

  it('returns empty set when library is empty', () => {
    expect(computeUnplacedFileIds([], [{ fileId: 'x' }])).toEqual(new Set());
  });

  it('returns all lib fileIds when no figures are placed', () => {
    const lib = [{ fileId: 'a' }, { fileId: 'b' }];
    expect(computeUnplacedFileIds(lib, [])).toEqual(new Set(['a', 'b']));
  });

  it('ignores lib items without fileId', () => {
    const lib = [{ fileId: 'a' }, { fileId: undefined }];
    expect(computeUnplacedFileIds(lib, [])).toEqual(new Set(['a']));
  });

  it('ignores placed figures without fileId', () => {
    const lib = [{ fileId: 'a' }];
    const placed = [{ fileId: undefined }, { fileId: 'a' }];
    expect(computeUnplacedFileIds(lib, placed)).toEqual(new Set());
  });

  it('handles duplicate placed references correctly', () => {
    const lib = [{ fileId: 'a' }, { fileId: 'b' }];
    const placed = [{ fileId: 'a' }, { fileId: 'a' }];
    expect(computeUnplacedFileIds(lib, placed)).toEqual(new Set(['b']));
  });
});
