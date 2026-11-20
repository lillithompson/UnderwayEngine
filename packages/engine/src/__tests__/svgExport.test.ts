import { exportToSVG, exportLayersToSVGInner, SVG_UNITS_PER_L0_CELL, prependTransform, multiplyStrokeWidths, maxStrokeWidth, countSVGCVs } from '../svgExport';
import { buildFigureSVGContent, CachedFigureSVG } from '../svgFigureCache';
import { simplifySVG } from '../simplifySVG';
import { makeLayer } from './test-utils';
import { FileConfig, ClipBox, CompositionFigure } from '../types';

// Mock svg-sources with a minimal SVG path
jest.mock('../../assets/images/atlases/svg-sources.json', () => ({
  'test-sprite': '<path d="M0 0L256 256" stroke="white" stroke-width="5"/>',
  'multi-elem': '<path d="M0 0L128 128" stroke="white" stroke-width="5"/><circle cx="128" cy="128" r="11" stroke="white" stroke-width="5"/>',
  'has-transform': '<circle cx="128" cy="128" r="11" transform="rotate(-45 128 128)" stroke="white" stroke-width="5"/>',
}));

const fileConfig: FileConfig = { id: 'f1', name: 'TestFigure', widthL0: 32, heightL0: 32 };

describe('svgExport flat output', () => {
  test('exportLayersToSVGInner returns flat elements array with no <g> tags', () => {
    const layer = makeLayer('l0', 0, 0);
    layer.cells[0][0] = {
      type: 'sprite',
      spriteId: 'test-sprite',
      transform: { rotation: 0, mirrorH: false, mirrorV: false },
    };

    const result = exportLayersToSVGInner([layer], fileConfig);
    expect(Array.isArray(result.elements)).toBe(true);
    // No <g> elements anywhere
    for (const el of result.elements) {
      expect(el).not.toMatch(/<g[\s>]/);
      expect(el).not.toMatch(/<\/g>/);
    }
    // Each element has id and transform attributes
    expect(result.elements[0]).toMatch(/id="tile_0_0"/);
    expect(result.elements[0]).toMatch(/transform="/);
  });

  test('multi-element sprites get unique ids and same transform', () => {
    const layer = makeLayer('l0', 0, 0);
    layer.cells[0][0] = {
      type: 'sprite',
      spriteId: 'multi-elem',
      transform: { rotation: 0, mirrorH: false, mirrorV: false },
    };

    const result = exportLayersToSVGInner([layer], fileConfig);
    expect(result.elements.length).toBe(2);
    expect(result.elements[0]).toMatch(/id="tile_0_0"/);
    expect(result.elements[1]).toMatch(/id="tile_0_0_1"/);
    // Both have the same transform
    const transformRe = /transform="([^"]*)"/;
    const t0 = result.elements[0].match(transformRe)![1];
    const t1 = result.elements[1].match(transformRe)![1];
    expect(t0).toBe(t1);
  });

  test('color cells produce flat <rect> elements with no <g>', () => {
    const layer = makeLayer('l0', 0, 0);
    layer.cells[0][0] = { type: 'color', r: 255, g: 0, b: 0 } as any;

    const result = exportLayersToSVGInner([layer], fileConfig);
    expect(result.elements.length).toBe(1);
    expect(result.elements[0]).toMatch(/<rect /);
    expect(result.elements[0]).not.toMatch(/<g[\s>]/);
  });

  test('layer opacity is applied to each element directly', () => {
    const layer = makeLayer('l0', 0, 0);
    layer.opacity = 0.5;
    layer.cells[0][0] = {
      type: 'sprite',
      spriteId: 'test-sprite',
      transform: { rotation: 0, mirrorH: false, mirrorV: false },
    };

    const result = exportLayersToSVGInner([layer], fileConfig);
    expect(result.elements[0]).toMatch(/opacity="0.5"/);
    // No <g opacity="..."> wrapper
    expect(result.elements[0]).not.toMatch(/<g[\s>]/);
  });

  test('exportToSVG produces SVG with id and no <g> tags', () => {
    const layer = makeLayer('l0', 0, 0);
    layer.cells[0][0] = {
      type: 'sprite',
      spriteId: 'test-sprite',
      transform: { rotation: 0, mirrorH: false, mirrorV: false },
    };

    const svg = exportToSVG([layer], fileConfig);
    expect(svg).toMatch(/id="TestFigure"/);
    expect(svg).not.toMatch(/<g[\s>]/);
    expect(svg).not.toMatch(/<\/g>/);
  });

  test('source elements with existing transform are merged, not duplicated', () => {
    const layer = makeLayer('l0', 0, 0);
    layer.cells[0][0] = {
      type: 'sprite',
      spriteId: 'has-transform',
      transform: { rotation: 0, mirrorH: false, mirrorV: false },
    };

    const result = exportLayersToSVGInner([layer], fileConfig);
    expect(result.elements.length).toBe(1);
    const el = result.elements[0];
    // Should have exactly one transform attribute
    const transformMatches = el.match(/transform="/g);
    expect(transformMatches).toHaveLength(1);
    // The merged transform should contain both the tile transform and the original rotate
    expect(el).toMatch(/rotate\(-45 128 128\)/);
  });

  test('non-zero origin offsets element positions to canvas-relative coordinates', () => {
    const layer = makeLayer('l0', 0, 0);
    // Place a color cell at layer index (12, 12)
    layer.cells[12][12] = { type: 'color', r: 0, g: 255, b: 0 } as any;

    const config: FileConfig = { id: 'f2', name: 'Offset', widthL0: 8, heightL0: 8, originL0X: 12, originL0Y: 12 };
    const result = exportLayersToSVGInner([layer], config);
    expect(result.elements.length).toBe(1);
    // Cell at layer (12,12) with origin (12,12) should be at SVG position (0,0)
    expect(result.elements[0]).toContain('x="0"');
    expect(result.elements[0]).toContain('y="0"');
  });

  test('exportToSVG viewBox starts at 0 0 regardless of origin', () => {
    const layer = makeLayer('l0', 0, 0);
    layer.cells[12][12] = { type: 'color', r: 0, g: 255, b: 0 } as any;

    const config: FileConfig = { id: 'f3', name: 'OffsetView', widthL0: 8, heightL0: 8, originL0X: 12, originL0Y: 12 };
    const svg = exportToSVG([layer], config);
    expect(svg).toContain('viewBox="0 0 2048 2048"');
  });

  test('prependTransform prepends to existing transform', () => {
    const elements = ['<path id="a" transform="translate(10,20)" d="M0 0"/>'];
    const result = prependTransform(elements, 'scale(2)');
    expect(result[0]).toMatch(/transform="scale\(2\) translate\(10,20\)"/);
  });
});

describe('multiplyStrokeWidths', () => {
  test('multiplies numeric stroke-width values by factor', () => {
    const svg = '<path stroke-width="5" d="M0 0"/>';
    expect(multiplyStrokeWidths(svg, 3)).toBe('<path stroke-width="15" d="M0 0"/>');
  });

  test('handles multiple stroke-width attributes', () => {
    const svg = '<path stroke-width="2"/><circle stroke-width="4"/>';
    const result = multiplyStrokeWidths(svg, 2.5);
    expect(result).toBe('<path stroke-width="5"/><circle stroke-width="10"/>');
  });

  test('handles decimal stroke-width values', () => {
    const svg = '<path stroke-width="1.5"/>';
    expect(multiplyStrokeWidths(svg, 3)).toBe('<path stroke-width="4.5"/>');
  });

  test('leaves non-numeric stroke-width values unchanged', () => {
    const svg = '<path stroke-width="inherit"/>';
    expect(multiplyStrokeWidths(svg, 3)).toBe('<path stroke-width="inherit"/>');
  });

  test('factor of 1 returns equivalent values', () => {
    const svg = '<path stroke-width="5"/>';
    expect(multiplyStrokeWidths(svg, 1)).toBe('<path stroke-width="5"/>');
  });
});

describe('maxStrokeWidth', () => {
  test('returns max stroke-width across elements', () => {
    expect(maxStrokeWidth([
      '<rect stroke-width="2"/>',
      '<line stroke-width="5"/><circle stroke-width="3"/>',
    ])).toBe(5);
  });

  test('returns 0 when no stroke-width', () => {
    expect(maxStrokeWidth(['<rect fill="red"/>'])).toBe(0);
  });

  test('returns 0 for empty array', () => {
    expect(maxStrokeWidth([])).toBe(0);
  });
});

describe('countSVGCVs', () => {
  // Counted through the engine's one path-data reader (svgPathData.ts):
  // its own match of command letters counted one for each letter, so an
  // implicit repeat went uncounted (report 564cc996).
  const cvs = (d: string) => countSVGCVs([`<path d="${d}" stroke="white"/>`]);

  test('an implicit repeat counts as the command written out', () => {
    expect(cvs('M0 0 10 10 20 20')).toBe(3);
    expect(cvs('M0 0 10 10 20 20')).toBe(cvs('M0 0 L10 10 L20 20'));
    expect(cvs('M0 0 L1 1 2 2')).toBe(3);
    expect(cvs('M0 0 C1 1 2 2 3 3 4 4 5 5 6 6')).toBe(7);
    expect(cvs('M0 0 Q1 1 2 2 3 3 4 4')).toBe(5);
    expect(cvs('M0 0 A5 5 0 0 1 10 0 5 5 0 0 1 20 0')).toBe(3);
  });

  test('a line, an arc and a subpath start are one; a quadratic two; a cubic three; a Z none', () => {
    expect(cvs('M0 0 L10 0 H20 V10 A5 5 0 0 1 30 10 Z')).toBe(5);
    expect(cvs('M0 0 Q5 5 10 0')).toBe(3);
    expect(cvs('M0 0 C1 1 2 2 3 3')).toBe(4);
  });

  test('S and T count as the cubic and quadratic they draw, the reflected control included', () => {
    expect(cvs('M0 0 C1 1 2 2 3 3 S5 5 6 6')).toBe(cvs('M0 0 C1 1 2 2 3 3 C4 4 5 5 6 6'));
    expect(cvs('M0 0 Q1 1 2 2 T4 4')).toBe(cvs('M0 0 Q1 1 2 2 Q3 3 4 4'));
  });

  test('relative commands count as the absolute ones they stand for', () => {
    expect(cvs('m0 0 l10 0 h10 v10 c1 1 2 2 3 3 s1 1 2 2 q1 1 2 2 t2 2 a5 5 0 0 1 10 0 z'))
      .toBe(cvs('M0 0 L10 0 H20 V10 C21 11 22 12 23 13 S24 14 25 15 Q26 16 27 17 T29 19 A5 5 0 0 1 39 19 Z'));
  });

  test('path data that breaks the grammar counts up to its first error, as it draws', () => {
    // Report 44c95c77: the reader stops at the first error (svgPathData.ts).
    expect(cvs('M0 0 L10 0 L5')).toBe(2);
    expect(cvs('M0 0 L10 0 L5 Z C1 1 2 2 3 3')).toBe(2);
    expect(cvs('M0 0 L1 1 Z 7 8 L2 2')).toBe(2);
    expect(cvs('M0 0 A5 5 0 2 1 10 10 L0 0')).toBe(1);
    expect(cvs('L5 5 L6 6')).toBe(0);
  });

  test('sums over the elements, counting nothing for one with no d', () => {
    expect(countSVGCVs([
      '<path d="M0 0L10 0" stroke="white"/>',
      '<rect x="0" y="0" width="10" height="10"/>',
      '<path d="M0 0C1 1 2 2 3 3" stroke="white"/>',
    ])).toBe(6);
    expect(countSVGCVs([])).toBe(0);
  });

  test('simplifySVG writes one letter to a segment, so a count of its output is a count of letters', () => {
    // M, L, C, Q and Z only, absolute, each segment with its own letter:
    // the count the letter match gave.
    const out = simplifySVG([
      '<path d="M0 0 10 0 20 10 C25 15 25 25 20 30 Q10 40 0 30 Z" stroke="white" stroke-width="5"/>',
    ]);
    const d = out[0].match(/\bd="([^"]*)"/)![1];
    expect(d).toMatch(/^[MLCQZ0-9 .-]+$/);
    const byLetter = (d.match(/[MLCQ]/g) ?? []).reduce((n, c) => n + (c === 'C' ? 3 : c === 'Q' ? 2 : 1), 0);
    expect(countSVGCVs(out)).toBe(byLetter);
  });
});

describe('clip box', () => {
  test('exportToSVG uses clip box dimensions for SVG document', () => {
    const layer = makeLayer('l0', 0, 0);
    layer.cells[0][0] = {
      type: 'color',
      r: 255, g: 0, b: 0,
      transform: { rotation: 0, mirrorH: false, mirrorV: false },
    };
    const clipBox: ClipBox = { clipL0X: 4, clipL0Y: 4, clipL0W: 8, clipL0H: 8 };
    const config: FileConfig = {
      id: 'clip-test', name: 'ClipTest',
      widthL0: 32, heightL0: 32,
      originL0X: 0, originL0Y: 0,
      clipBox,
    };
    const svg = exportToSVG([layer], config);
    const U = SVG_UNITS_PER_L0_CELL;
    // viewBox starts at 0,0 — exportLayersToSVGInner re-origins to clip box
    expect(svg).toContain(`viewBox="0 0 ${8 * U} ${8 * U}"`);
    // width/height should match clip dimensions
    expect(svg).toContain(`width="${8 * U}"`);
    expect(svg).toContain(`height="${8 * U}"`);
    // Cell at (0,0) is outside clip box (4..12), should not appear
    expect(svg).not.toContain('fill="rgb(255,0,0)"');
  });

  test('exportToSVG with clip box includes cells inside clip region', () => {
    const layer = makeLayer('l0', 0, 0);
    // Place a cell at L0 position (5,5) — inside clip box (4..12)
    // L0 level has 32 cells, so cell index 5 = L0 position 5
    layer.cells[5][5] = {
      type: 'color',
      r: 0, g: 255, b: 0,
      transform: { rotation: 0, mirrorH: false, mirrorV: false },
    };
    const clipBox: ClipBox = { clipL0X: 4, clipL0Y: 4, clipL0W: 8, clipL0H: 8 };
    const config: FileConfig = {
      id: 'clip-include', name: 'ClipInclude',
      widthL0: 32, heightL0: 32,
      originL0X: 0, originL0Y: 0,
      clipBox,
    };
    const svg = exportToSVG([layer], config);
    // Cell at (5,5) is inside clip box, should appear
    expect(svg).toContain('fill="rgb(0,255,0)"');
  });

  test('exportToSVG with clip box and non-zero origin', () => {
    const layer = makeLayer('l0', 0, 0);
    const clipBox: ClipBox = { clipL0X: 6, clipL0Y: 4, clipL0W: 10, clipL0H: 8 };
    const config: FileConfig = {
      id: 'clip-origin', name: 'ClipOrigin',
      widthL0: 20, heightL0: 20,
      originL0X: 2, originL0Y: 2,
      clipBox,
    };
    const svg = exportToSVG([layer], config);
    const U = SVG_UNITS_PER_L0_CELL;
    // viewBox starts at 0,0 — clip origin is the new reference
    expect(svg).toContain(`viewBox="0 0 ${10 * U} ${8 * U}"`);
    expect(svg).toContain(`width="${10 * U}"`);
    expect(svg).toContain(`height="${8 * U}"`);
  });

  test('exportLayersToSVGInner returns clip dimensions when clip box set', () => {
    const layer = makeLayer('l0', 0, 0);
    const clipBox: ClipBox = { clipL0X: 4, clipL0Y: 6, clipL0W: 12, clipL0H: 10 };
    const config: FileConfig = {
      id: 'clip-inner', name: 'ClipInner',
      widthL0: 32, heightL0: 32,
      clipBox,
    };
    const result = exportLayersToSVGInner([layer], config);
    expect(result.widthL0).toBe(12);
    expect(result.heightL0).toBe(10);
  });

  test('clip box end-to-end: exportLayersToSVGInner -> buildFigureSVGContent only shows clipped content', () => {
    const layer = makeLayer('l0', 0, 0);
    const U = SVG_UNITS_PER_L0_CELL;
    // Place cells at various positions
    // cell (1,1) — OUTSIDE clip box (4..12 range)
    layer.cells[1][1] = { type: 'color', r: 255, g: 0, b: 0, transform: { rotation: 0, mirrorH: false, mirrorV: false } };
    // cell (5,5) — INSIDE clip box
    layer.cells[5][5] = { type: 'color', r: 0, g: 255, b: 0, transform: { rotation: 0, mirrorH: false, mirrorV: false } };
    // cell (15,15) — OUTSIDE clip box (beyond 4+8=12)
    layer.cells[15][15] = { type: 'color', r: 0, g: 0, b: 255, transform: { rotation: 0, mirrorH: false, mirrorV: false } };

    const clipBox: ClipBox = { clipL0X: 4, clipL0Y: 4, clipL0W: 8, clipL0H: 8 };
    const config: FileConfig = {
      id: 'e2e', name: 'E2E',
      widthL0: 32, heightL0: 32,
      originL0X: 0, originL0Y: 0,
      clipBox,
    };

    // Step 1: export
    const result = exportLayersToSVGInner([layer], config);
    expect(result.widthL0).toBe(8);
    expect(result.heightL0).toBe(8);

    const elements = simplifySVG(result.elements);
    // Only the green cell should be in elements
    const allText = elements.join(' ');
    expect(allText).toContain('rgb(0,255,0)');
    expect(allText).not.toContain('rgb(255,0,0)');
    expect(allText).not.toContain('rgb(0,0,255)');

    // Step 2: build cached figure (what svgFigureCache would produce)
    const cached: CachedFigureSVG = {
      elements,
      svgWidth: result.widthL0 * U,
      svgHeight: result.heightL0 * U,
    };

    // Step 3: render via buildFigureSVGContent (what composition SVG layer does)
    const fig: CompositionFigure = {
      id: 'fig1',
      figureKey: 'test',
      cellX: 0,
      cellY: 0,
      resolutionX: 2,
      resolutionY: 2,
      cellWidth: 8,
      cellHeight: 8,
    };
    const svgContent = buildFigureSVGContent(fig, cached);
    // Final output should contain the green cell, not red or blue
    expect(svgContent).toContain('rgb(0,255,0)');
    expect(svgContent).not.toContain('rgb(255,0,0)');
    expect(svgContent).not.toContain('rgb(0,0,255)');
  });
});
