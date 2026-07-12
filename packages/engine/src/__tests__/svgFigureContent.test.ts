import { CompositionFigure } from '../types';
import { buildFigureSVGContent, CachedFigureSVG } from '../svgFigureCache';

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

jest.mock('../persistence', () => ({
  loadFileState: jest.fn(() => Promise.resolve(null)),
}));

jest.mock('../bake', () => ({}));

// Use real svgExport helpers (prependTransform, multiplyStrokeWidths)
jest.mock('../svgExport', () => {
  const actual = jest.requireActual('../svgExport');
  return {
    ...actual,
    exportLayersToSVGInner: jest.fn(() => ({ elements: [], widthL0: 0, heightL0: 0 })),
  };
});

const U = 256; // SVG_UNITS_PER_L0_CELL

function makeFigure(overrides: Partial<CompositionFigure>): CompositionFigure {
  return {
    id: 'fig-test',
    figureKey: 'test_key',
    cellX: 0,
    cellY: 0,
    resolutionX: 1,
    resolutionY: 1,
    cellWidth: 4,
    cellHeight: 4,
    ...overrides,
  };
}

function makeCached(widthL0: number, heightL0: number): CachedFigureSVG {
  return {
    elements: [`<rect x="0" y="0" width="${widthL0 * U}" height="${heightL0 * U}" fill="red" transform="" stroke-width="1"/>`],
    svgWidth: widthL0 * U,
    svgHeight: heightL0 * U,
  };
}

/** Extract the positioning transform from the first element's transform attribute */
function extractPosTransform(svg: string): string {
  const m = svg.match(/transform="([^"]*)"/);
  return m ? m[1] : '';
}

// ── Tests ───────────────────────────────────────────────────────────

describe('buildFigureSVGContent – uniform scaling', () => {
  test('equal aspect ratios use single scale value (no skewing)', () => {
    // 4×4 figure in 8×8 cell → scaleX = scaleY = 2
    const fig = makeFigure({ cellWidth: 8, cellHeight: 8 });
    const cached = makeCached(4, 4);
    const svg = buildFigureSVGContent(fig, cached);
    // Positioning group should contain scale(2)
    expect(svg).toContain('scale(2)');
    expect(svg).not.toMatch(/scale\(\d+,\d+\)/);
  });

  test('non-matching aspect ratio uses uniform (min) scale', () => {
    // 5×3 figure in a 2×1 cell (L0 units)
    // rawScaleX = 2*U / 5*U = 0.4, rawScaleY = 1*U / 3*U = 0.333...
    // uniformScale = min(0.4, 0.333) = 0.333...
    const fig = makeFigure({ cellWidth: 2, cellHeight: 1 });
    const cached = makeCached(5, 3);
    const svg = buildFigureSVGContent(fig, cached);

    const expectedScale = (1 * U) / (3 * U); // 1/3
    expect(svg).toContain(`scale(${expectedScale})`);
    // Must NOT contain two-arg scale
    expect(svg).not.toMatch(/scale\([^)]+,[^)]+\)/);
  });

  test('centered alignment for unrotated figure with aspect mismatch', () => {
    // 3×5 figure in 1×2 cell
    // uniformScale = 1/3
    // scaledW = 3*U*(1/3) = U, scaledH = 5*U*(1/3) = 5*256/3 ≈ 426.667
    // center: qCx = 0.5*U, qCy = 1*U
    // posX = qCx - scaledW/2 = 0, posY = qCy - scaledH/2
    const fig = makeFigure({ cellX: 0, cellY: 0, cellWidth: 1, cellHeight: 2 });
    const cached = makeCached(3, 5);
    const svg = buildFigureSVGContent(fig, cached);

    const scale = 1 / 3;
    const scaledH = 5 * U * scale;
    const qCy = 1 * U; // center of 2-cell height
    const expectedY = qCy - scaledH / 2;
    const t = extractPosTransform(svg);
    expect(t).toContain(`translate(0,${expectedY})`);
  });

  test('rotated figure with aspect mismatch uses uniform scale', () => {
    const fig = makeFigure({
      cellX: 0, cellY: 0, cellWidth: 1, cellHeight: 2,
      rotation: 90,
    });
    const cached = makeCached(5, 3);
    const svg = buildFigureSVGContent(fig, cached);

    const expectedScale = (1 * U) / (3 * U);
    expect(svg).toContain(`scale(${expectedScale})`);
    expect(svg).toContain('rotate(90)');
    expect(svg).not.toMatch(/scale\(\d+\.\d+,\d+\.\d+\)/);
  });

  test('mirrored figure with aspect mismatch uses uniform scale', () => {
    const fig = makeFigure({
      cellWidth: 2, cellHeight: 1, mirrorH: true,
    });
    const cached = makeCached(5, 3);
    const svg = buildFigureSVGContent(fig, cached);

    const expectedScale = (1 * U) / (3 * U);
    expect(svg).toContain(`scale(${expectedScale})`);
    expect(svg).toContain('scale(-1,1)');
  });

  test('stroke width compensation uses uniform scale', () => {
    // With scale 2, stroke-width should be halved (1/2)
    const fig = makeFigure({ cellWidth: 8, cellHeight: 8 });
    const cached = makeCached(4, 4);
    const svg = buildFigureSVGContent(fig, cached);
    expect(svg).toContain('stroke-width="0.5"');
  });
});

describe('buildFigureSVGContent – output structure', () => {
  test('output is wrapped in clipping svg viewport', () => {
    const fig = makeFigure({ cellX: 1, cellY: 2, cellWidth: 4, cellHeight: 4 });
    const cached = makeCached(10, 32);
    const svg = buildFigureSVGContent(fig, cached);

    // Wrapped in <svg overflow="hidden"> for bounding-box clipping
    expect(svg).toContain('<svg ');
    expect(svg).toContain('overflow="hidden"');
    expect(svg).not.toContain('<clipPath');
    // Inner content has flat elements with transforms
    const inner = svg.replace(/^<svg [^>]*>/, '').replace(/<\/svg>$/, '');
    const lines = inner.split('\n').filter(l => l.trim().length > 0);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/^<(rect|path|circle|ellipse|line|polyline|polygon)\s/);
    }
  });

  test('elements have per-element transforms, no nested groups', () => {
    const fig = makeFigure({ cellX: 2, cellY: 3, cellWidth: 4, cellHeight: 6 });
    const cached = makeCached(10, 32);
    const svg = buildFigureSVGContent(fig, cached);

    // Content elements should carry their own transform
    expect(svg).toContain('transform=');
    expect(svg).toContain('fill="red"');
    // No inner groups
    const innerGroups = (svg.match(/<g\s+transform="/g) || []).length;
    expect(innerGroups).toBe(0);
  });

  test('stroke width compensation still applies', () => {
    const fig = makeFigure({ cellWidth: 4, cellHeight: 4 });
    const cached: CachedFigureSVG = {
      elements: [`<rect x="0" y="0" width="${4 * U}" height="${4 * U}" fill="none" stroke="black" stroke-width="10" transform=""/>`],
      svgWidth: 4 * U,
      svgHeight: 4 * U,
    };
    const svg = buildFigureSVGContent(fig, cached, 3);
    expect(svg).toContain('stroke-width="30"');
  });
});
