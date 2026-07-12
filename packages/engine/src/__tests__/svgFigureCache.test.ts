import { CompositionFigure } from '../types';
import {
  getFigureSVGSync,
  getFigureSVG,
  evictFigureSVGByFileId,
  preloadFigureSVGs,
  buildFigureSVGContent,
  buildBlockSVGContent,
} from '../svgFigureCache';

// ── Mocks ───────────────────────────────────────────────────────────

jest.mock('@/engine/storage', () => ({
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
    getBinary: jest.fn(() => Promise.resolve(null)),
  },
  __esModule: true,
}));

const mockLayers = [
  {
    id: 'l1',
    name: 'Layer 1',
    level: 0 as const,
    visible: true,
    opacity: 1,
    order: 0,
    shiftX: 0 as const,
    shiftY: 0 as const,
    locked: false,
    cells: Array.from({ length: 32 }, () => Array(32).fill(null)),
    cellsGeneration: 0,
  },
];

const mockLoadImpl = (fileId: string) => {
  if (fileId === 'test-file') {
    return Promise.resolve({
      layers: mockLayers,
      activeLayerId: 'l1',
      widthL0: 8,
      heightL0: 8,
    });
  }
  return Promise.resolve(null);
};

jest.mock('../persistence', () => ({
  loadFileState: jest.fn((...args: any[]) => mockLoadImpl(args[0])),
  loadFileStateLite: jest.fn((...args: any[]) => mockLoadImpl(args[0])),
  loadClipBox: jest.fn(() => Promise.resolve(null)),
}));

jest.mock('../svgExport', () => ({
  exportLayersToSVGInner: jest.fn(() => ({
    elements: ['<rect x="0" y="0" width="256" height="256" fill="red"/>'],
    widthL0: 8,
    heightL0: 8,
  })),
  SVG_UNITS_PER_L0_CELL: 256,
  prependTransform: jest.fn((elements: string[], transform: string) =>
    elements.map(el => el.replace(/<(\w+)\s/, `<$1 transform="${transform}" `))
  ),
  multiplyStrokeWidths: jest.fn((svg: string) => svg),
  maxStrokeWidth: jest.fn((elements: string[]) => {
    let max = 0;
    const re = /stroke-width="([^"]*)"/g;
    for (const el of elements) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(el)) !== null) {
        const num = parseFloat(m[1]);
        if (!isNaN(num) && num > max) max = num;
      }
      re.lastIndex = 0;
    }
    return max;
  }),
}));

jest.mock('../bake', () => ({}));

// ── Tests ───────────────────────────────────────────────────────────

describe('svgFigureCache', () => {
  const fileFigure: CompositionFigure = {
    id: 'fig1',
    figureKey: 'file_test-file_L0',
    cellX: 4,
    cellY: 4,
    resolutionX: 2,
    resolutionY: 2,
    cellWidth: 8,
    cellHeight: 8,
    fileId: 'test-file',
  };

  test('getFigureSVGSync returns null for uncached figure', () => {
    const result = getFigureSVGSync({ ...fileFigure, fileId: 'uncached' });
    expect(result).toBeNull();
  });

  test('getFigureSVG loads and caches file-backed figure', async () => {
    const result = await getFigureSVG(fileFigure);
    expect(result).not.toBeNull();
    expect(result!.elements.length).toBeGreaterThan(0);
    expect(result!.svgWidth).toBe(8 * 256);
    expect(result!.svgHeight).toBe(8 * 256);

    // Should now be available synchronously
    const sync = getFigureSVGSync(fileFigure);
    expect(sync).toBe(result);
  });

  test('buildFigureSVGContent produces SVG markup', async () => {
    const cached = await getFigureSVG(fileFigure);
    expect(cached).not.toBeNull();

    const content = buildFigureSVGContent(fileFigure, cached!);
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain('transform=');
  });

  test('buildFigureSVGContent applies rotation transform', async () => {
    const cached = await getFigureSVG(fileFigure);
    expect(cached).not.toBeNull();

    const rotatedFigure = { ...fileFigure, rotation: 90 as const };
    const content = buildFigureSVGContent(rotatedFigure, cached!);
    expect(content).toContain('rotate(90)');
  });

  test('buildFigureSVGContent applies mirror transform', async () => {
    const cached = await getFigureSVG(fileFigure);
    expect(cached).not.toBeNull();

    const mirroredFigure = { ...fileFigure, mirrorH: true };
    const content = buildFigureSVGContent(mirroredFigure, cached!);
    expect(content).toContain('scale(-1,1)');
  });

  test('buildFigureSVGContent omits filter when no colorOverride', async () => {
    const cached = await getFigureSVG(fileFigure);
    expect(cached).not.toBeNull();

    const content = buildFigureSVGContent(fileFigure, cached!);
    expect(content).not.toContain('feColorMatrix');
    expect(content).not.toContain('filter="url(#recolor-');
  });

  test('buildFigureSVGContent bakes recolored fills directly when colorOverride is set', async () => {
    const cached = await getFigureSVG(fileFigure);
    expect(cached).not.toBeNull();

    // Mock fill is `red` (255,0,0). White tint on red: lum=0.2126 →
    // r = 255·(1−0.2126) + 255·0.2126 = 255; g = b = 0·(1−0.2126) + 255·0.2126 ≈ 54.
    const tinted = { ...fileFigure, colorOverride: { r: 255, g: 255, b: 255 } };
    const content = buildFigureSVGContent(tinted, cached!);
    expect(content).toContain('fill="rgb(255,54,54)"');
    expect(content).not.toContain('fill="red"');
    // No filter wrapper — colors are baked into attributes so Figma and other
    // tools that drop advanced filter primitives still render the tint.
    expect(content).not.toContain('feColorMatrix');
    expect(content).not.toContain('filter="url(#recolor-');
  });

  test('buildFigureSVGContent leaves fills unchanged when override equals base color', async () => {
    const cached = await getFigureSVG(fileFigure);
    expect(cached).not.toBeNull();

    // Red base + red tint is a no-op of the recolor formula, but the attribute
    // is still rewritten from the named `red` to canonical `rgb(255,0,0)` —
    // proving the path executed without changing the visible result.
    const tinted = { ...fileFigure, colorOverride: { r: 255, g: 0, b: 0 } };
    const content = buildFigureSVGContent(tinted, cached!);
    expect(content).toContain('fill="rgb(255,0,0)"');
    expect(content).not.toContain('feColorMatrix');
    expect(content).not.toContain('filter="url(#recolor-');
  });

  test('buildFigureSVGContent applies normal blend mode (flat replace)', async () => {
    const cached = await getFigureSVG(fileFigure);
    expect(cached).not.toBeNull();

    // Normal blend with blue tint: every fill should become the tint color exactly.
    const tinted = { ...fileFigure, colorOverride: { r: 0, g: 0, b: 255 }, colorOverrideBlendMode: 'normal' as const };
    const content = buildFigureSVGContent(tinted, cached!);
    expect(content).toContain('fill="rgb(0,0,255)"');
  });

  test('buildFigureSVGContent applies multiply blend mode', async () => {
    const cached = await getFigureSVG(fileFigure);
    expect(cached).not.toBeNull();

    // Base fill is red (255,0,0). Multiply with white (255,255,255):
    // r = (255*255)/255 = 255, g = (0*255)/255 = 0, b = (0*255)/255 = 0
    const tinted = { ...fileFigure, colorOverride: { r: 255, g: 255, b: 255 }, colorOverrideBlendMode: 'multiply' as const };
    const content = buildFigureSVGContent(tinted, cached!);
    expect(content).toContain('fill="rgb(255,0,0)"');
  });

  test('evictFigureSVGByFileId clears cache entries', async () => {
    // Ensure it's cached
    await getFigureSVG(fileFigure);
    expect(getFigureSVGSync(fileFigure)).not.toBeNull();

    evictFigureSVGByFileId('test-file');
    expect(getFigureSVGSync(fileFigure)).toBeNull();
  });

  test('preloadFigureSVGs loads all figures', async () => {
    evictFigureSVGByFileId('test-file');
    expect(getFigureSVGSync(fileFigure)).toBeNull();

    await preloadFigureSVGs([fileFigure]);
    expect(getFigureSVGSync(fileFigure)).not.toBeNull();
  });

  test('buildBlockSVGContent produces tiled SVG with pattern element', async () => {
    const cached = await getFigureSVG(fileFigure);
    expect(cached).not.toBeNull();

    const blockFigure: CompositionFigure = {
      ...fileFigure,
      tileMode: 'repeat',
      tileWidthL0: 4,
      tileHeightL0: 4,
      cellWidth: 16,
      cellHeight: 16,
    };

    const content = buildBlockSVGContent(blockFigure, cached!);
    expect(content).toContain('<pattern');
    expect(content).toContain('patternUnits="userSpaceOnUse"');
    expect(content).toContain(`width="${4 * 256}"`);  // tileWidthL0 * U
    expect(content).toContain(`height="${4 * 256}"`); // tileHeightL0 * U
    expect(content).toContain('fill="url(#pat_fig1)"');
  });

  test('buildBlockSVGContent applies rotation transform', async () => {
    const cached = await getFigureSVG(fileFigure);
    expect(cached).not.toBeNull();

    const blockFigure: CompositionFigure = {
      ...fileFigure,
      tileMode: 'repeat',
      tileWidthL0: 4,
      tileHeightL0: 4,
      cellWidth: 16,
      cellHeight: 16,
      rotation: 90,
    };

    const content = buildBlockSVGContent(blockFigure, cached!);
    expect(content).toContain('rotate(90)');
  });

  test('buildBlockSVGContent applies mirror transform', async () => {
    const cached = await getFigureSVG(fileFigure);
    expect(cached).not.toBeNull();

    const blockFigure: CompositionFigure = {
      ...fileFigure,
      tileMode: 'repeat',
      tileWidthL0: 4,
      tileHeightL0: 4,
      cellWidth: 16,
      cellHeight: 16,
      mirrorH: true,
    };

    const content = buildBlockSVGContent(blockFigure, cached!);
    expect(content).toContain('scale(-1,1)');
  });

  test('buildBlockSVGContent expandTiles produces flat elements with per-element transforms', async () => {
    const cached = await getFigureSVG(fileFigure);
    expect(cached).not.toBeNull();

    const blockFigure: CompositionFigure = {
      ...fileFigure,
      tileMode: 'repeat',
      tileWidthL0: 4,
      tileHeightL0: 4,
      cellWidth: 8,
      cellHeight: 8,
    };

    const content = buildBlockSVGContent(blockFigure, cached!, 1, true);
    // No patterns, clip paths, or nested groups
    expect(content).not.toContain('<pattern');
    expect(content).not.toContain('<clipPath');
    expect(content).not.toContain('clip-path=');
    expect(content).not.toContain('<g ');
    // Single svg viewport clips region bounds, flat elements inside
    expect(content).toMatch(/^<svg /);
    expect(content).toContain('overflow="hidden"');
    // 2×2 = 4 tiles, each with 1 element = 4 elements with transforms
    const inner = content.replace(/^<svg [^>]*>/, '').replace(/<\/svg>$/, '');
    const lines = inner.split('\n').filter(l => l.trim().length > 0);
    expect(lines).toHaveLength(4);
    for (const line of lines) {
      expect(line).toContain('transform=');
    }
  });

  test('buildBlockSVGContent pattern mode omits inner clip-path', async () => {
    const cached = await getFigureSVG(fileFigure);
    expect(cached).not.toBeNull();

    const blockFigure: CompositionFigure = {
      ...fileFigure,
      tileMode: 'repeat',
      tileWidthL0: 4,
      tileHeightL0: 4,
      cellWidth: 16,
      cellHeight: 16,
    };

    const content = buildBlockSVGContent(blockFigure, cached!);
    // Pattern mode should not contain any clip-path references
    expect(content).not.toContain('<clipPath');
    expect(content).not.toContain('clip-path=');
    // Should still contain the pattern and rect
    expect(content).toContain('<pattern');
    expect(content).toContain('fill="url(#pat_fig1)"');
  });

  test('buildBlockSVGContent omits filter when no colorOverride', async () => {
    const cached = await getFigureSVG(fileFigure);
    expect(cached).not.toBeNull();

    const blockFigure: CompositionFigure = {
      ...fileFigure,
      tileMode: 'repeat',
      tileWidthL0: 4,
      tileHeightL0: 4,
      cellWidth: 16,
      cellHeight: 16,
    };

    const patternContent = buildBlockSVGContent(blockFigure, cached!);
    expect(patternContent).not.toContain('feColorMatrix');
    expect(patternContent).not.toContain('filter="url(#recolor-');

    const expandedContent = buildBlockSVGContent(blockFigure, cached!, 1, true);
    expect(expandedContent).not.toContain('feColorMatrix');
    expect(expandedContent).not.toContain('filter="url(#recolor-');
  });

  test('buildBlockSVGContent bakes recolored fills inside the pattern when colorOverride is set (pattern path)', async () => {
    const cached = await getFigureSVG(fileFigure);
    expect(cached).not.toBeNull();

    const tinted: CompositionFigure = {
      ...fileFigure,
      tileMode: 'repeat',
      tileWidthL0: 4,
      tileHeightL0: 4,
      cellWidth: 16,
      cellHeight: 16,
      colorOverride: { r: 255, g: 255, b: 255 },
    };

    const content = buildBlockSVGContent(tinted, cached!);
    // Recolored fill (white tint on red base → rgb(255,54,54)) appears inside
    // the <pattern>; the outer `fill="url(#pat_fig1)"` reference is left
    // alone because it doesn't parse as a color value.
    expect(content).toContain('fill="rgb(255,54,54)"');
    expect(content).toContain('fill="url(#pat_fig1)"');
    expect(content).not.toContain('feColorMatrix');
    expect(content).not.toContain('filter="url(#recolor-');
  });

  test('buildBlockSVGContent bakes recolored fills in the expandTiles output when colorOverride is set', async () => {
    // expandTiles=true is the thumbnail path; this is the path that was
    // previously dropping the tint and producing untinted thumbnails.
    const cached = await getFigureSVG(fileFigure);
    expect(cached).not.toBeNull();

    const tinted: CompositionFigure = {
      ...fileFigure,
      tileMode: 'repeat',
      tileWidthL0: 4,
      tileHeightL0: 4,
      cellWidth: 8,
      cellHeight: 8,
      colorOverride: { r: 255, g: 255, b: 255 },
    };

    const content = buildBlockSVGContent(tinted, cached!, 1, true);
    expect(content).toContain('fill="rgb(255,54,54)"');
    expect(content).not.toContain('feColorMatrix');
    expect(content).not.toContain('filter="url(#recolor-');
  });

  test('buildBlockSVGContent uses cellWidth as tile when tileWidthL0 not set', async () => {
    const cached = await getFigureSVG(fileFigure);
    expect(cached).not.toBeNull();

    const blockFigure: CompositionFigure = {
      ...fileFigure,
      tileMode: 'repeat',
      cellWidth: 8,
      cellHeight: 8,
    };

    const content = buildBlockSVGContent(blockFigure, cached!);
    // Should use cellWidth * U for pattern tile size when tileWidthL0 is undefined
    expect(content).toContain(`width="${8 * 256}"`);
    expect(content).toContain(`height="${8 * 256}"`);
  });

  test('buildBlockSVGContent expandTiles composes rotation into per-element transforms', async () => {
    const cached = await getFigureSVG(fileFigure);
    expect(cached).not.toBeNull();

    const blockFigure: CompositionFigure = {
      ...fileFigure,
      tileMode: 'repeat',
      tileWidthL0: 4,
      tileHeightL0: 4,
      cellWidth: 16,
      cellHeight: 16,
      rotation: 90,
    };

    const content = buildBlockSVGContent(blockFigure, cached!, 1, true);
    // No defs or groups — rotation is composed into each element's transform
    expect(content).not.toContain('<defs>');
    expect(content).not.toContain('<g ');
    // Every inner element should contain rotate(90)
    const inner = content.replace(/^<svg [^>]*>/, '').replace(/<\/svg>$/, '');
    const lines = inner.split('\n').filter(l => l.trim().length > 0);
    for (const line of lines) {
      expect(line).toContain('rotate(90)');
    }
  });

  test('buildBlockSVGContent expandTiles clips with single svg viewport', async () => {
    const cached = await getFigureSVG(fileFigure);
    expect(cached).not.toBeNull();

    const blockFigure: CompositionFigure = {
      ...fileFigure,
      tileMode: 'repeat',
      tileWidthL0: 4,
      tileHeightL0: 4,
      cellWidth: 16,
      cellHeight: 16,
    };

    const content = buildBlockSVGContent(blockFigure, cached!, 1, true);
    // Single svg viewport for region clipping
    expect(content).toMatch(/^<svg /);
    expect(content).toContain('overflow="hidden"');
    expect(content).toMatch(/<\/svg>$/);
    // Flat elements inside — no nested groups or clip paths
    expect(content).not.toContain('<g ');
    expect(content).not.toContain('<clipPath');
    const inner = content.replace(/^<svg [^>]*>/, '').replace(/<\/svg>$/, '');
    const lines = inner.split('\n').filter(l => l.trim().length > 0);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/^<(rect|path|circle|ellipse|line|polyline|polygon)\s/);
    }
  });

  test('buildBlockSVGContent applies tile offset to pattern origin', async () => {
    const cached = await getFigureSVG(fileFigure);
    expect(cached).not.toBeNull();

    const U = 256; // SVG_UNITS_PER_L0_CELL
    const blockFigure: CompositionFigure = {
      ...fileFigure,
      tileMode: 'repeat',
      tileWidthL0: 4,
      tileHeightL0: 4,
      cellWidth: 16,
      cellHeight: 16,
      cellX: 8,
      cellY: 8,
      tileOffsetXL0: 2,
      tileOffsetYL0: 0,
    };

    const content = buildBlockSVGContent(blockFigure, cached!);
    // Pattern origin should be shifted by offset: (8+2)*256 = 2560
    const patOriginX = (8 + 2) * U;
    expect(content).toContain(`x="${patOriginX}"`);
    // Rect should still be at region origin: 8*256 = 2048
    expect(content).toContain(`<rect x="${8 * U}"`);
  });

  test('buildBlockSVGContent expandTiles handles non-zero tile offset', async () => {
    const cached = await getFigureSVG(fileFigure);
    expect(cached).not.toBeNull();

    const blockFigure: CompositionFigure = {
      ...fileFigure,
      tileMode: 'repeat',
      tileWidthL0: 4,
      tileHeightL0: 4,
      cellWidth: 8,
      cellHeight: 8,
      cellX: 0,
      cellY: 0,
      tileOffsetXL0: 2,
    };

    // Without offset: 2 cols × 2 rows = 4 tiles
    // With offset of 2 (half a tile): need 3 cols to cover region
    const content = buildBlockSVGContent(blockFigure, cached!, 1, true);
    expect(content).toContain('<svg ');
    expect(content).toContain('overflow="hidden"');
    // Count translate() occurrences to verify tile count
    const translates = content.match(/translate\(/g) ?? [];
    // 3 cols × 2 rows = 6 tiles, each with 1 translate
    expect(translates.length).toBe(6);
  });

  test('getFigureSVG passes clip box from loadClipBox to exportLayersToSVGInner', async () => {
    const { loadClipBox } = require('../persistence');
    const { exportLayersToSVGInner } = require('../svgExport');

    const clipBox = { clipL0X: 2, clipL0Y: 2, clipL0W: 4, clipL0H: 4 };

    // Configure loadClipBox to return a clip box
    (loadClipBox as jest.Mock).mockResolvedValueOnce(clipBox);

    // Evict to force reload
    evictFigureSVGByFileId('test-file');

    // Reset exportLayersToSVGInner call tracker
    (exportLayersToSVGInner as jest.Mock).mockClear();

    await getFigureSVG(fileFigure);

    // Verify exportLayersToSVGInner was called with fileConfig containing the clip box
    expect(exportLayersToSVGInner).toHaveBeenCalledTimes(1);
    const callArgs = (exportLayersToSVGInner as jest.Mock).mock.calls[0];
    const fileConfig = callArgs[1];
    expect(fileConfig.clipBox).toEqual(clipBox);

    // Restore default loadClipBox behavior
    (loadClipBox as jest.Mock).mockResolvedValue(null);
  });
});
