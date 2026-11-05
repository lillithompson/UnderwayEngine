/**
 * A LINE STYLE: the path's stroke replaced by glyphs stamped along it
 * (lineStyle.ts), and how those stamps reach the markup the canvas and the
 * export share (svgStrokesMarkup, buildSVGObjectContent). Mirrors
 * svgEndpointsMarkup.test.ts for the endpoint decorations.
 */

import {
  glyphCommandsPathD, lineStyleGlyphCommands, lineStyleMarkup, lineStyleOf,
  clampGlyphSize, lineStylePathD, lineStylePlacements, lineStyleReachCells, lineStyleSeed, lineStyleSpacing,
  MAX_DRAWN_GLYPH_POINTS, MAX_GLYPH_SIZE, MAX_LINE_STYLE_COMMANDS, MAX_LINE_STYLE_STAMPS, MIN_GLYPH_SIZE,
} from '../lineStyle';
import { buildSVGObjectContent, svgStrokePresentation, svgStrokesMarkup } from '../svgPathBuilder';
import { computeCircleSegments } from '../compositionArcMath';
import { SVG_UNITS_PER_L0_CELL } from '../svgExport';
import { LineStyleEffect, LineStyleGlyph, PathSegment, SVGObject } from '../types';

/** Every glyph a style can name — the union, spelled out so the loop below
 *  cannot silently skip one. */
const EVERY_GLYPH: readonly LineStyleGlyph[] = ['line', 'circle', 'sparkle', 'heart', 'custom'];

const line = (start: [number, number], end: [number, number]): PathSegment =>
  ({ kind: 'line', start, end });

/** A 10-cell horizontal line, left to right. */
const straight = (): PathSegment[] => [line([0, 0], [10, 0])];

const square = (): PathSegment[] => [
  line([0, 0], [4, 0]), line([4, 0], [4, 4]), line([4, 4], [0, 4]), line([0, 4], [0, 0]),
];

const style = (extras: Partial<LineStyleEffect> = {}): LineStyleEffect => ({
  glyph: 'circle', density: 0.5, size: 0.5, rotation: 0,
  randomPlacement: 0, randomRotation: 0, randomSize: 0,
  ...extras,
});

const obj = (extras: Partial<SVGObject> = {}): SVGObject => ({
  id: 'svg_1',
  segments: straight(),
  color: { r: 10, g: 20, b: 30 },
  cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 0,
  stroke: { width: 0.25 },
  ...extras,
});

describe('placement along the path', () => {
  it('an open path stands a glyph at each end and spaces the rest evenly, facing along it', () => {
    const s = style({ density: 0.5, size: 0.5 }); // spacing 0.5 × 2.375 = 1.1875
    const spacing = lineStyleSpacing(s);
    expect(spacing).toBeCloseTo(1.1875);
    const stamps = lineStylePlacements(straight(), s, 1);
    // round(10 / 1.1875) + 1 = 8 + 1 = 9 stamps, 1.25 apart.
    expect(stamps).toHaveLength(9);
    expect(stamps[0]).toMatchObject({ x: 0, y: 0, angle: 0, scale: 0.5 });
    expect(stamps[8].x).toBeCloseTo(10);
    expect(stamps[4].x).toBeCloseTo(5);
    for (const p of stamps) {
      expect(p.y).toBe(0);
      expect(p.angle).toBe(0);
      expect(p.scale).toBe(0.5);
    }
  });

  it('a closed path spaces its stamps all the way round, the last gap like every other', () => {
    const s = style({ density: 1, size: 0.5 }); // spacing 0.375
    const stamps = lineStylePlacements(square(), s, 1);
    // Perimeter 16 / 0.375 → round(42.67) = 43 stamps, 16/43 apart, none at
    // both the start and the end (which are the same corner).
    expect(stamps).toHaveLength(43);
    expect(stamps[0]).toMatchObject({ x: 0, y: 0 });
    const last = stamps[42];
    expect(Math.hypot(last.x - 0, last.y - 16 / 43)).toBeLessThan(1e-9);
  });

  it('a path shorter than half a spacing gets one glyph at its middle', () => {
    const stamps = lineStylePlacements([line([0, 0], [0.4, 0])], style(), 1);
    expect(stamps).toHaveLength(1);
    expect(stamps[0].x).toBeCloseTo(0.2);
  });

  it('glyphs turn with the path: on a circle each faces the tangent where it stands', () => {
    const circle = computeCircleSegments(0, 0, 4, 4);
    const stamps = lineStylePlacements(circle, style({ size: 1, density: 0 }), 7);
    expect(stamps.length).toBeGreaterThan(2);
    for (const p of stamps) {
      // On a circle centred at (2,2), the tangent is perpendicular to the
      // radius at every point.
      const rx = p.x - 2, ry = p.y - 2;
      const tx = Math.cos(p.angle), ty = Math.sin(p.angle);
      expect(Math.abs(rx * tx + ry * ty)).toBeLessThan(1e-6);
      expect(Math.hypot(rx, ry)).toBeCloseTo(2, 6);
    }
  });

  it('a rotation turns every glyph from the path’s direction by the same angle', () => {
    const stamps = lineStylePlacements(straight(), style({ rotation: 90 }), 1);
    for (const p of stamps) expect(p.angle).toBeCloseTo(Math.PI / 2);
    const d = lineStylePathD([line([0, 0], [0.4, 0])], style({ glyph: 'line', size: 1, rotation: 90 }), 1);
    // A dash turned a quarter turn stands across the path.
    expect(d).toBe(`M ${0.2 * 256},${-0.5 * 256} L ${0.2 * 256},${0.5 * 256}`);
  });

  it('density runs from sparse to touching, and nothing is stamped on nothing', () => {
    expect(lineStyleSpacing(style({ density: 0, size: 1 }))).toBe(4);
    expect(lineStyleSpacing(style({ density: 1, size: 1 }))).toBe(0.75);
    expect(lineStylePlacements([], style(), 1)).toEqual([]);
    expect(lineStylePlacements(straight(), style({ size: 0 }), 1)).toEqual([]);
    expect(lineStylePlacements([line([1, 1], [1, 1])], style(), 1)).toEqual([]);
  });
});

describe('the random sliders', () => {
  it('are deterministic for a seed, and a different seed scatters differently', () => {
    const s = style({ randomPlacement: 1, randomRotation: 1, randomSize: 1 });
    const a = lineStylePlacements(straight(), s, 42);
    const b = lineStylePlacements(straight(), s, 42);
    const c = lineStylePlacements(straight(), s, 43);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('each slider moves only its own quantity, within its range', () => {
    const base = lineStylePlacements(straight(), style(), 5);
    const placed = lineStylePlacements(straight(), style({ randomPlacement: 1 }), 5);
    const turned = lineStylePlacements(straight(), style({ randomRotation: 1 }), 5);
    const sized = lineStylePlacements(straight(), style({ randomSize: 1 }), 5);
    const spacing = 10 / (base.length - 1);
    placed.forEach((p, i) => {
      expect(Math.abs(p.x - base[i].x)).toBeLessThanOrEqual(spacing * 0.5 + 1e-9);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(0.5 * 0.75 + 1e-9);
      expect(p.angle).toBe(0);
      expect(p.scale).toBe(0.5);
    });
    expect(placed.some((p, i) => p.x !== base[i].x || p.y !== 0)).toBe(true);
    turned.forEach((p, i) => {
      expect(p.x).toBe(base[i].x);
      expect(Math.abs(p.angle)).toBeLessThanOrEqual(Math.PI + 1e-9);
      expect(p.scale).toBe(0.5);
    });
    expect(turned.some((p) => p.angle !== 0)).toBe(true);
    sized.forEach((p, i) => {
      expect(p.x).toBe(base[i].x);
      expect(p.angle).toBe(0);
      expect(p.scale).toBeGreaterThanOrEqual(0.5 * 0.25 - 1e-9);
      expect(p.scale).toBeLessThanOrEqual(0.5 * 1.75 + 1e-9);
    });
    expect(sized.some((p) => p.scale !== 0.5)).toBe(true);
  });

  it('one slider does not reshuffle another: the turn a stamp takes is the same whether or not it is scattered', () => {
    const turned = lineStylePlacements(straight(), style({ randomRotation: 1 }), 9);
    const both = lineStylePlacements(straight(), style({ randomRotation: 1, randomPlacement: 1 }), 9);
    turned.forEach((p, i) => expect(both[i].angle).toBeCloseTo(p.angle, 12));
  });

  it('the seed is the object’s, so a reopened page and a shadow’s cast stamp where the object does', () => {
    expect(lineStyleSeed('svg_1')).toBe(lineStyleSeed('svg_1'));
    expect(lineStyleSeed('svg_1')).not.toBe(lineStyleSeed('svg_2'));
    expect(lineStyleSeed('svg_1', 1)).not.toBe(lineStyleSeed('svg_1'));
  });

  it('the reach covers the biggest stamp pushed furthest across the path', () => {
    expect(lineStyleReachCells(style({ size: 1 }))).toBeCloseTo(Math.SQRT1_2);
    expect(lineStyleReachCells(style({ size: 1, randomSize: 1, randomPlacement: 1 })))
      .toBeCloseTo(1.75 * Math.SQRT1_2 + 0.75);
  });
});

describe('the glyphs', () => {
  it('every built-in glyph fits its unit box', () => {
    for (const glyph of EVERY_GLYPH) {
      if (glyph === 'custom') continue;
      for (const c of lineStyleGlyphCommands(style({ glyph }))) {
        for (let i = 1; i < c.length; i++) expect(Math.abs(c[i] as number)).toBeLessThanOrEqual(0.5 + 1e-9);
      }
    }
    // The dash is the one open glyph; the others close.
    expect(lineStyleGlyphCommands(style({ glyph: 'line' }))).toEqual([['M', -0.5, 0], ['L', 0.5, 0]]);
    const heart = lineStyleGlyphCommands(style({ glyph: 'heart' }));
    expect(heart[heart.length - 1]).toEqual(['Z']);
  });

  it('a drawn glyph is fitted to its own bounds: centred, its longer side one unit', () => {
    // A small L in the pad's top-left corner.
    const custom: [number, number][][] = [[[0.1, 0.1], [0.1, 0.3], [0.2, 0.3]]];
    const cmds = lineStyleGlyphCommands(style({ glyph: 'custom', custom }));
    const expected = [['M', -0.25, -0.5], ['L', -0.25, 0.5], ['L', 0.25, 0.5]] as const;
    expect(cmds).toHaveLength(3);
    cmds.forEach((c, i) => {
      expect(c[0]).toBe(expected[i][0]);
      expect(c[1]).toBeCloseTo(expected[i][1], 9);
      expect(c[2]).toBeCloseTo(expected[i][2], 9);
    });
    // …and a second stroke is a second subpath.
    const two = lineStyleGlyphCommands(style({ glyph: 'custom', custom: [[[0, 0], [1, 0]], [[0, 1], [1, 1]]] }));
    expect(two.filter((c) => c[0] === 'M')).toHaveLength(2);
  });

  it('a drawn glyph that cannot be fitted stamps a circle, so Draw never makes the path vanish', () => {
    const circle = lineStyleGlyphCommands(style({ glyph: 'circle' }));
    expect(lineStyleGlyphCommands(style({ glyph: 'custom' }))).toBe(circle);
    expect(lineStyleGlyphCommands(style({ glyph: 'custom', custom: [] }))).toBe(circle);
    expect(lineStyleGlyphCommands(style({ glyph: 'custom', custom: [[[0.5, 0.5]]] }))).toBe(circle);
    expect(lineStyleGlyphCommands(style({ glyph: 'custom', custom: [[[0.5, 0.5], [0.5, 0.5]]] }))).toBe(circle);
  });
});

describe('the markup', () => {
  it('walks the commands once for every reader, each with its own point mapper', () => {
    const cmds = lineStyleGlyphCommands(style({ glyph: 'line' }));
    expect(glyphCommandsPathD(cmds, (x, y) => [x * 10, y * 10 + 1])).toBe('M -5,1 L 5,1');
    expect(glyphCommandsPathD([['M', 0, 0], ['C', 1, 1, 2, 2, 3, 3], ['Z']], (x, y) => [x, y]))
      .toBe('M 0,0 C 1,1 2,2 3,3 Z');
    expect(glyphCommandsPathD([['M', 1 / 3, 0]], (x, y) => [x, y])).toBe('M 0.333,0');
  });

  it('a long chain is walked once, not once per stamp: the cursor lands every stamp where a scan would', () => {
    // A thousand-piece freehand chain along x, stamped densely: every stamp
    // must sit on the chain (y = 0) at its evenly spaced x, which a stale
    // cursor would miss.
    const chain: PathSegment[] = [];
    for (let i = 0; i < 1000; i++) chain.push(line([i * 0.1, 0], [(i + 1) * 0.1, 0]));
    const stamps = lineStylePlacements(chain, style({ size: 0.5, density: 1 }), 3);
    expect(stamps.length).toBeGreaterThan(200);
    stamps.forEach((p, i) => {
      expect(p.y).toBeCloseTo(0, 9);
      expect(p.x).toBeCloseTo(i * (100 / (stamps.length - 1)), 9);
    });
    // …and scattered stamps, which can step backwards a little, still land
    // on the chain.
    for (const p of lineStylePlacements(chain, style({ size: 0.5, density: 1, randomPlacement: 1 }), 3)) {
      expect(Math.abs(p.y)).toBeLessThanOrEqual(0.5 * 0.75 + 1e-9);
      expect(p.x).toBeGreaterThanOrEqual(-1e-9);
      expect(p.x).toBeLessThanOrEqual(100 + 1e-9);
    }
  });

  it('places, turns and scales each glyph into SVG units, as one path', () => {
    const d = lineStylePathD([line([0, 0], [0.4, 0])], style({ glyph: 'line', size: 1 }), 1);
    // One dash centred at x = 0.2 cells, a unit wide: (0.2 ± 0.5) × 256.
    expect(d).toBe(`M ${-0.3 * 256},0 L ${0.7 * 256},0`);
    const vertical = lineStylePathD([line([0, 0], [0, 0.4])], style({ glyph: 'line', size: 1 }), 1);
    // Turned to face down the path: the dash runs along y.
    expect(vertical).toBe(`M 0,${-0.3 * 256} L 0,${0.7 * 256}`);
    expect(lineStylePathD([], style(), 1)).toBe('');
  });

  it('wears the stroke attrs it is given, in the ink it is given', () => {
    const m = lineStyleMarkup(straight(), style({ glyph: 'line' }), 1, 'stroke-width="7" stroke-dasharray="2 1"', { r: 1, g: 2, b: 3 });
    expect(m.startsWith('<path d="M ')).toBe(true);
    expect(m).toContain(' stroke-width="7" stroke-dasharray="2 1" stroke="rgb(1,2,3)" />');
    expect(lineStyleMarkup([], style(), 1, '', { r: 0, g: 0, b: 0 })).toBe('');
  });

  it('a styled object strokes as its glyphs, undecorated; a plain one as its path', () => {
    const plain = obj({ endpoints: { endMarker: 'arrow' } });
    const styled = obj({ endpoints: { endMarker: 'arrow' }, effects: { lineStyle: style({ glyph: 'line' }) } });
    const { attrs, segments } = svgStrokePresentation(plain, 1, SVG_UNITS_PER_L0_CELL);
    const plainMarkup = svgStrokesMarkup(plain, segments, attrs, 0.25);
    const styledMarkup = svgStrokesMarkup(styled, segments, attrs, 0.25);
    expect(plainMarkup).toContain('<path d="M 0,0 L 2560,0"');
    expect(plainMarkup.match(/<path /g)).toHaveLength(2); // the line and its arrow
    expect(styledMarkup).not.toContain('L 2560,0"');
    expect(styledMarkup.match(/<path /g)).toHaveLength(1); // the glyphs alone, no arrow
    expect(styledMarkup).toBe(lineStyleMarkup(segments, style({ glyph: 'line' }), lineStyleSeed('svg_1'), attrs, styled.color));
  });

  it('the node layer’s builder draws the glyphs in the stroke’s place, and the glyphs wear its dash', () => {
    const dashed = obj({ stroke: { width: 0.25, dash: 5 }, effects: { lineStyle: style({ glyph: 'heart' }) } });
    const content = buildSVGObjectContent(dashed, 1, SVG_UNITS_PER_L0_CELL, { nonScaling: false });
    expect(content).not.toContain('L 2560,0"');
    expect(content).toContain(' C ');
    expect(content).toContain('stroke-dasharray=');
    expect(content).toContain('stroke="rgb(10,20,30)"');
  });

  it('a styled closed shape keeps its fill, and its glyphs are not clipped to the inside', () => {
    const shape = obj({
      segments: square(), cellWidth: 4, cellHeight: 4,
      fillColor: { r: 200, g: 0, b: 0 },
      stroke: { width: 0.25, position: 'inside' },
      effects: { lineStyle: style() },
    });
    const content = buildSVGObjectContent(shape, 1, SVG_UNITS_PER_L0_CELL, { nonScaling: false });
    expect(content).toContain('fill="rgb(200,0,0)"');
    expect(content).not.toContain('clip-path=');
    expect(content).not.toContain('stroke-width="128"'); // not the doubled inside stroke
  });

  it('a merged object styles each stroked subpath in its own ink and keeps its fill subpaths', () => {
    const merged = obj({
      subpaths: [
        { segments: square(), color: { r: 9, g: 9, b: 9 }, fill: true },
        { segments: straight(), color: { r: 1, g: 1, b: 1 } },
        { segments: [line([0, 2], [10, 2])], color: { r: 2, g: 2, b: 2 } },
      ],
      effects: { lineStyle: style({ glyph: 'line' }) },
    });
    const { attrs, segments } = svgStrokePresentation(merged, 1, SVG_UNITS_PER_L0_CELL);
    const m = svgStrokesMarkup(merged, segments, attrs, 0.25);
    expect(m).toContain('fill="rgb(9,9,9)"');
    expect(m).toContain('stroke="rgb(1,1,1)"');
    expect(m).toContain('stroke="rgb(2,2,2)"');
    expect(m).not.toContain('L 2560,0"');
  });

  it('a repeat-mode tile has no path to style', () => {
    expect(lineStyleOf(obj({ effects: { lineStyle: style() } }))).toEqual(style());
    expect(lineStyleOf(obj({ tileMode: 'repeat', effects: { lineStyle: style() } }))).toBeNull();
    expect(lineStyleOf(obj({ effects: { shadow: { dx: 0, dy: 0, blur: 1, color: { r: 0, g: 0, b: 0 }, alpha: 1 } } }))).toBeNull();
  });
});

describe('what one styled path may cost', () => {
  const longLine = (cells: number) => [line([0, 0], [cells, 0])];

  test('a tiny size from outside cannot ask for millions of stamps', () => {
    const stamps = lineStylePlacements(longLine(10), style({ size: 1e-6, density: 1 }), 1);
    expect(stamps.length).toBe(MAX_LINE_STYLE_STAMPS);
  });

  test('past the budget the stamps spread over the whole path, ends included', () => {
    const stamps = lineStylePlacements(longLine(1000), style({ size: MIN_GLYPH_SIZE, density: 1 }), 1);
    expect(stamps.length).toBe(MAX_LINE_STYLE_STAMPS);
    expect(stamps[0].x).toBeCloseTo(0);
    expect(stamps[stamps.length - 1].x).toBeCloseTo(1000);
  });

  test('under the budget nothing changes', () => {
    const s = style({ size: 1, density: 1 });
    expect(lineStylePlacements(longLine(30), s, 1).length).toBe(Math.round(30 / lineStyleSpacing(s)) + 1);
  });

  test('a long drawn glyph stamps with a bounded number of points, its stroke ends kept', () => {
    const stroke: [number, number][] = Array.from({ length: 5000 }, (_, i) => [i / 4999, (i % 2) / 2]);
    const commands = lineStyleGlyphCommands(style({ glyph: 'custom', custom: [stroke] }));
    expect(commands.length).toBeLessThanOrEqual(MAX_DRAWN_GLYPH_POINTS + 2);
    expect(commands[0][1]).toBeCloseTo(-0.5);
    expect(commands[commands.length - 1][1]).toBeCloseTo(0.5);
  });

  test('stamps of a drawn glyph stay inside the command budget, whatever the drawing', () => {
    const strokes: [number, number][][] = Array.from({ length: 255 }, (_, k) => (
      Array.from({ length: 40 }, (_, i): [number, number] => [i / 39, k / 254])
    ));
    const s = style({ glyph: 'custom', custom: strokes, size: MIN_GLYPH_SIZE, density: 1 });
    const stamps = lineStylePlacements(longLine(1000), s, 1).length;
    expect(stamps).toBeGreaterThanOrEqual(2);
    expect(stamps * lineStyleGlyphCommands(s).length).toBeLessThanOrEqual(MAX_LINE_STYLE_COMMANDS);
  });

  test('clampGlyphSize holds a size to the range, and a non-finite one to the floor', () => {
    expect(clampGlyphSize(1e-6)).toBe(MIN_GLYPH_SIZE);
    expect(clampGlyphSize(1e9)).toBe(MAX_GLYPH_SIZE);
    expect(clampGlyphSize(1)).toBe(1);
    expect(clampGlyphSize(NaN)).toBe(MIN_GLYPH_SIZE);
  });
});
