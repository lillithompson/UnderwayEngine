/**
 * A LINE STYLE: the path's stroke replaced by glyphs stamped along it
 * (lineStyle.ts), and how those stamps reach the markup the canvas and the
 * export share (svgStrokesMarkup, buildSVGObjectContent). Mirrors
 * svgEndpointsMarkup.test.ts for the endpoint decorations.
 */

import {
  glyphCommandsPathD, lineStyleArt, lineStyleArtPathOutlined, lineStyleGlyphCommands, lineStyleMarkup, lineStyleOf,
  clampGlyphSize, lineStylePathD, lineStylePlacements, lineStyleReachCells, lineStyleSeed, lineStyleSpacing,
  lineStyleArtTint, lineStyleStampJitter, lineStyleTintAmount, lineStyleWithInk,
  MAX_ART_GLYPH_POINTS, MAX_ART_PATHS, MAX_DRAWN_GLYPH_POINTS, MAX_GLYPH_SIZE, MAX_LINE_STYLE_COMMANDS, MAX_LINE_STYLE_STAMPS, MIN_GLYPH_SIZE,
} from '../lineStyle';
import { buildSVGObjectContent, svgStrokePresentation, svgStrokesMarkup, withSVGObjectStrokeColor } from '../svgPathBuilder';
import { computeCircleSegments } from '../compositionArcMath';
import { mulberry32 } from '../seededRandom';
import { SVG_UNITS_PER_L0_CELL } from '../svgExport';
import { LineStyleArtPath, LineStyleEffect, LineStyleGlyph, PathSegment, SVGObject } from '../types';

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

  it('a stamp\'s draws are the seed\'s stream four at a time, addressable by its index', () => {
    // `lineStyleStampJitter` is the one rule for the builder and for a
    // layer that lays stamps along a path still being drawn (DrawBots'
    // sim canvas): stamp i reads draws 4i … 4i + 3 of `mulberry32(seed)`,
    // along, across, turn, size — the order the placements have always
    // drawn in, so no saved page's glyphs move.
    const s = style({ randomPlacement: 0.6, randomRotation: 0.4, randomSize: 0.8, size: 0.5 });
    const rng = mulberry32(42);
    const out = { along: 0, across: 0, turn: 0, grow: 1 };
    for (let i = 0; i < 12; i++) {
      const along = (rng() * 2 - 1) * 0.5 * 1.25 * 0.6;
      const across = (rng() * 2 - 1) * 0.75 * 0.5 * 0.6;
      const turn = (rng() * 2 - 1) * Math.PI * 0.4;
      const grow = 1 + (rng() * 2 - 1) * 0.75 * 0.8;
      expect(lineStyleStampJitter(s, 42, i, 1.25, out)).toBe(out);
      expect(out).toEqual({ along, across, turn, grow });
    }
    // …and the placements are those draws: stamp i stands `along` off its
    // even place, `across` off the path, turned and sized by the rest.
    const stamps = lineStylePlacements(straight(), s, 42);
    const step = 10 / (stamps.length - 1);
    stamps.forEach((p, i) => {
      const j = lineStyleStampJitter(s, 42, i, step, { along: 0, across: 0, turn: 0, grow: 1 });
      expect(p.x).toBeCloseTo(Math.max(0, Math.min(10, i * step + j.along)), 12);
      expect(p.y).toBeCloseTo(j.across, 12);
      expect(p.angle).toBeCloseTo(j.turn, 12);
      expect(p.scale).toBeCloseTo(0.5 * j.grow, 12);
    });
    // With every slider at rest a stamp is not moved at all (a draw
    // below a half times nothing is −0, which is no move either).
    const rest = lineStyleStampJitter(style(), 42, 3, 1, out);
    expect([Math.abs(rest.along), Math.abs(rest.across), Math.abs(rest.turn), rest.grow]).toEqual([0, 0, 0, 1]);
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

// ── Art (v72): a drawn glyph that keeps its own paint ────────────────
const RED = { r: 200, g: 10, b: 20 };
const BLUE = { r: 5, g: 60, b: 220 };
const WHITE = { r: 255, g: 255, b: 255 };

/** A filled, outlined square in the pad's top-left quarter, and a bare
 *  outlined tick over it. */
const twoPaths = (): LineStyleArtPath[] => [
  { points: [[0.1, 0.1], [0.3, 0.1], [0.3, 0.3], [0.1, 0.3]], color: RED, width: 0.02, fill: BLUE, fillOpacity: 0.5 },
  { points: [[0.1, 0.2], [0.5, 0.2]], color: BLUE, width: 0.04, opacity: 0.25 },
];

const artStyle = (art: LineStyleArtPath[] = twoPaths(), extras: Partial<LineStyleEffect> = {}): LineStyleEffect =>
  style({ glyph: 'custom', art, ...extras });

describe('a drawn glyph’s art', () => {
  it('is fitted as ONE drawing to its own bounds, as a drawn glyph is: centred, its longer side one unit, its widths with it', () => {
    const art = lineStyleArt(artStyle())!;
    expect(art).toHaveLength(2);
    // The box is x 0.1…0.5 (the longer side, 0.4), y 0.1…0.3: centre (0.3, 0.2).
    const [square, tick] = art;
    const expected = [['M', -0.5, -0.25], ['L', 0, -0.25], ['L', 0, 0.25], ['L', -0.5, 0.25]] as const;
    expect(square.commands).toHaveLength(5);
    expected.forEach((e, i) => {
      expect(square.commands[i][0]).toBe(e[0]);
      expect(square.commands[i][1]).toBeCloseTo(e[1], 9);
      expect(square.commands[i][2]).toBeCloseTo(e[2], 9);
    });
    // A filled path closes; an unfilled one is left open.
    expect(square.commands[4]).toEqual(['Z']);
    expect(tick.commands.map((c) => c[0])).toEqual(['M', 'L']);
    expect(tick.commands[1][1]).toBeCloseTo(0.5, 9);
    // The paint rides through, the widths scaled by the fit (÷ 0.4).
    expect(square.color).toBe(RED);
    expect(square.width).toBeCloseTo(0.05, 9);
    expect(square.fill).toBe(BLUE);
    expect(square.fillOpacity).toBe(0.5);
    expect('opacity' in square).toBe(false);
    expect(tick.width).toBeCloseTo(0.1, 9);
    expect(tick.opacity).toBe(0.25);
    expect('fill' in tick).toBe(false);
  });

  it('is read only on the drawn glyph, and only when a path of it can draw', () => {
    expect(lineStyleArt(style({ glyph: 'heart', art: twoPaths() }))).toBeNull();
    expect(lineStyleArt(style({ glyph: 'custom' }))).toBeNull();
    expect(lineStyleArt(artStyle([]))).toBeNull();
    // No paint, one point, no finite points, nothing to span.
    expect(lineStyleArt(artStyle([{ points: [[0, 0], [1, 1]] }]))).toBeNull();
    expect(lineStyleArt(artStyle([{ points: [[0.5, 0.5]], fill: RED }]))).toBeNull();
    expect(lineStyleArt(artStyle([{ points: [[NaN, 0], [0, Infinity]], fill: RED }]))).toBeNull();
    expect(lineStyleArt(artStyle([{ points: [[0.5, 0.5], [0.5, 0.5]], fill: RED }]))).toBeNull();
    // An undrawable path among drawable ones is left out, and not fitted to.
    const mixed = lineStyleArt(artStyle([
      { points: [[0, 0], [9, 9]] },
      { points: [[0.2, 0.2], [0.4, 0.2]], fill: RED },
    ]))!;
    expect(mixed).toHaveLength(1);
    expect(mixed[0].commands[0][1]).toBeCloseTo(-0.5, 9);
  });

  it('an outline is a colour AND a width: either alone draws none', () => {
    expect(lineStyleArtPathOutlined({ points: [], color: RED, width: 0.1 })).toBe(true);
    expect(lineStyleArtPathOutlined({ points: [], color: RED })).toBe(false);
    expect(lineStyleArtPathOutlined({ points: [], width: 0.1 })).toBe(false);
    expect(lineStyleArtPathOutlined({ points: [], color: RED, width: 0 })).toBe(false);
    expect(lineStyleArtPathOutlined({ points: [], color: RED, width: NaN })).toBe(false);
    // A filled path whose outline has no width keeps its fill and loses the outline.
    const [only] = lineStyleArt(artStyle([{ points: [[0, 0], [1, 0], [1, 1]], color: RED, fill: BLUE }]))!;
    expect(only.fill).toBe(BLUE);
    expect('color' in only).toBe(false);
    expect('width' in only).toBe(false);
  });

  it('an opacity is carried only under 1, and a fill’s only with a fill', () => {
    const [a, b] = lineStyleArt(artStyle([
      { points: [[0, 0], [1, 0]], color: RED, width: 0.1, opacity: 1, fillOpacity: 0.5 },
      { points: [[0, 1], [1, 1]], fill: RED, opacity: -3, fillOpacity: NaN },
    ]))!;
    expect('opacity' in a).toBe(false);
    expect('fillOpacity' in a).toBe(false);
    expect(b.opacity).toBe(0);
    expect('fillOpacity' in b).toBe(false);
  });

  it('outranks the pad’s strokes, and falls back in order: art, strokes, a circle', () => {
    const custom: [number, number][][] = [[[0, 0], [1, 0]]];
    const circle = lineStyleGlyphCommands(style({ glyph: 'circle' }));
    const art = artStyle(twoPaths(), { custom });
    // One ink reads the art's whole outline: every path's commands, end to end.
    expect(lineStyleGlyphCommands(art)).toEqual(lineStyleArt(art)!.flatMap((path) => [...path.commands]));
    expect(lineStyleGlyphCommands(art)).toHaveLength(7);
    // Art that cannot draw leaves the strokes, and neither leaves the circle.
    expect(lineStyleGlyphCommands(artStyle([{ points: [[0, 0], [1, 1]] }], { custom })))
      .toEqual([['M', -0.5, 0], ['L', 0.5, 0]]);
    expect(lineStyleGlyphCommands(artStyle([{ points: [[0, 0], [1, 1]] }]))).toBe(circle);
    // …and a style that never had art is read exactly as it was.
    expect(lineStyleGlyphCommands(style({ glyph: 'custom', custom }))).toEqual([['M', -0.5, 0], ['L', 0.5, 0]]);
  });

  it('is bounded: the first paths of the budget, and a bounded number of points, each path’s ends kept', () => {
    const many: LineStyleArtPath[] = Array.from({ length: 200 }, (_, k) => ({
      points: Array.from({ length: 50 }, (_, i): [number, number] => [i / 49, k / 199]),
      color: RED, width: 0.01,
    }));
    const art = lineStyleArt(artStyle(many))!;
    expect(MAX_ART_PATHS).toBe(96);
    // A path a segment fits the budget of points: neither cuts the other short.
    expect(MAX_ART_PATHS).toBe(MAX_ART_GLYPH_POINTS);
    expect(MAX_ART_GLYPH_POINTS).toBe(96);
    expect(art).toHaveLength(MAX_ART_PATHS);
    const points = art.reduce((n, path) => n + path.commands.length, 0);
    // The stride keeps each path's two ends over the cap, and nothing more.
    expect(points).toBeLessThanOrEqual(MAX_ART_GLYPH_POINTS + 2 * MAX_ART_PATHS);
    for (const path of art) {
      expect(path.commands[0][1]).toBeCloseTo(-0.5, 9);
      expect(path.commands[path.commands.length - 1][1]).toBeCloseTo(0.5, 9);
    }
    // The bounds are the kept paths' own: the last sits on the box's far side.
    expect(art[MAX_ART_PATHS - 1].commands[0][2] as number).toBeGreaterThan(art[0].commands[0][2] as number);
  });

  it('stamps inside the command budget, counted over all its paths', () => {
    const many: LineStyleArtPath[] = Array.from({ length: 40 }, (_, k) => ({
      points: Array.from({ length: 40 }, (_, i): [number, number] => [i / 39, k / 39]),
      fill: RED,
    }));
    const s = artStyle(many, { size: MIN_GLYPH_SIZE, density: 1 });
    const total = lineStyleArt(s)!.reduce((n, path) => n + path.commands.length, 0);
    expect(lineStyleGlyphCommands(s)).toHaveLength(total);
    const chain = [line([0, 0], [1000, 0])];
    const stamps = lineStylePlacements(chain, s, 1).length;
    expect(stamps).toBeGreaterThanOrEqual(2);
    expect(stamps).toBe(Math.floor(MAX_LINE_STYLE_COMMANDS / total));
    // The markup stamps the very same number: every path holds one M per stamp.
    const m = lineStyleMarkup(chain, s, 1, '', RED);
    expect(m.match(/<path /g)).toHaveLength(lineStyleArt(s)!.length);
    expect(m.match(/M /g)).toHaveLength(stamps * lineStyleArt(s)!.length);
  });

  it('reaches half its widest outline further than a glyph in the path’s ink', () => {
    const bare = style({ glyph: 'custom', custom: [[[0, 0], [1, 0]]], size: 2, randomSize: 1 });
    // Fitted widths 0.05 and 0.1: the wider one's half, at the biggest stamp (2 × 1.75).
    expect(lineStyleReachCells(artStyle(twoPaths(), { size: 2, randomSize: 1 })))
      .toBeCloseTo(lineStyleReachCells(bare) + 3.5 * 0.05, 9);
    // Fills alone widen nothing.
    expect(lineStyleReachCells(artStyle([{ points: [[0, 0], [1, 1]], fill: RED }], { size: 2 })))
      .toBeCloseTo(lineStyleReachCells(style({ size: 2 })), 9);
  });
});

describe('the art’s markup', () => {
  // One stamp at the middle of a short line, a cell across: x = 0.2 cells.
  const short = (): PathSegment[] => [line([0, 0], [0.4, 0])];

  it('is one path per art path, bottom first, each holding every stamp’s copy in the stamps’ own places', () => {
    const s = artStyle(twoPaths(), { size: 1 });
    const m = lineStyleMarkup(short(), s, 1, 'stroke-width="7" stroke-dasharray="2 1"', { r: 1, g: 2, b: 3 });
    const paths = m.match(/<path [^>]*\/>/g)!;
    expect(paths).toHaveLength(2);
    // The square, placed as lineStylePathD places a glyph: (0.2 + x) × 256.
    expect(paths[0]).toContain(`d="M ${-0.3 * 256},-64 L ${0.2 * 256},-64 L ${0.2 * 256},64 L ${-0.3 * 256},64 Z"`);
    expect(paths[1]).toContain(`d="M ${-0.3 * 256},0 L ${0.7 * 256},0"`);
    // The two together are the outline one ink draws.
    const ds = paths.map((p) => /d="([^"]*)"/.exec(p)![1]);
    expect(ds.join(' ')).toBe(lineStylePathD(short(), s, 1));
    // Along a longer chain every path holds every stamp.
    const stamps = lineStylePlacements(straight(), s, 1).length;
    expect(stamps).toBeGreaterThan(2);
    for (const p of lineStyleMarkup(straight(), s, 1, '', RED).match(/<path [^>]*\/>/g)!) {
      expect(p.match(/M /g)).toHaveLength(stamps);
    }
  });

  it('paints in the art’s own colours — exactly, whatever the path’s — and never wears the path’s stroke attrs', () => {
    const m = lineStyleMarkup(short(), artStyle(twoPaths(), { size: 1 }), 1, 'stroke-width="7" stroke-dasharray="2 1"', WHITE);
    expect(lineStyleMarkup(short(), artStyle(twoPaths(), { size: 1 }), 1, 'stroke-width="7" stroke-dasharray="2 1"', { r: 12, g: 34, b: 56 })).toBe(m);
    const [square, tick] = m.match(/<path [^>]*\/>/g)!;
    expect(square).toContain(' fill="rgb(5,60,220)" fill-opacity="0.5" stroke="rgb(200,10,20)" stroke-width="12.8" stroke-linecap="round" stroke-linejoin="round" />');
    expect(tick).toContain(' fill="none" stroke="rgb(5,60,220)" stroke-width="25.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.25" />');
    expect(m).not.toContain('rgb(255,255,255)');
    expect(m).not.toContain('stroke-width="7"');
    expect(m).not.toContain('stroke-dasharray');
    // A fill with no outline says so, and an opaque fill carries no opacity.
    const filled = lineStyleMarkup(short(), artStyle([{ points: [[0, 0], [1, 0], [1, 1]], fill: RED }]), 1, 'stroke-width="7"', WHITE);
    expect(filled).toContain(' fill="rgb(200,10,20)" stroke="none" />');
    expect(filled).not.toContain('opacity');
  });

  it('the path’s ink is MIXED with the art’s colours, never multiplied into them: the amount is the share of the way from the ink to the art’s own', () => {
    const art = { r: 200, g: 100, b: 50 }, ink = { r: 0, g: 50, b: 250 };
    // All the way, and unsaid: the art's own colour, whatever the ink.
    expect(lineStyleArtTint(art, ink)).toEqual(art);
    expect(lineStyleArtTint(art, ink, 1)).toEqual(art);
    // None of it: the ink, whatever the art — black art and white art alike.
    expect(lineStyleArtTint(art, ink, 0)).toEqual(ink);
    expect(lineStyleArtTint({ r: 0, g: 0, b: 0 }, ink, 0)).toEqual(ink);
    expect(lineStyleArtTint(WHITE, ink, 0)).toEqual(ink);
    // Between them in proportion, each channel by itself.
    expect(lineStyleArtTint(art, ink, 0.5)).toEqual({ r: 100, g: 75, b: 150 });
    expect(lineStyleArtTint(art, ink, 0.25)).toEqual({ r: 50, g: 63, b: 200 });
    // Art drawn in the ink's own colour is that colour at any amount (a multiply darkened it).
    expect(lineStyleArtTint(ink, ink, 0.3)).toEqual(ink);
    // A white path is an ink like any other: it does not leave the art as drawn.
    expect(lineStyleArtTint(art, WHITE, 0)).toEqual(WHITE);
  });

  it('a style’s TINT is that amount: the art as drawn at 1 and unsaid, the path’s ink alone at 0, between them in proportion', () => {
    // The amount a style says: clamped, and the whole of the art's own for none or nonsense.
    expect(lineStyleTintAmount(artStyle(twoPaths()))).toBe(1);
    expect(lineStyleTintAmount(artStyle(twoPaths(), { tint: 0.25 }))).toBe(0.25);
    expect(lineStyleTintAmount(artStyle(twoPaths(), { tint: -1 }))).toBe(0);
    expect(lineStyleTintAmount(artStyle(twoPaths(), { tint: 7 }))).toBe(1);
    expect(lineStyleTintAmount(artStyle(twoPaths(), { tint: Number.NaN }))).toBe(1);
    // In the markup: at 1 and unsaid the art is as drawn, whatever the ink.
    const ink = { r: 255, g: 0, b: 0 };
    const at = (tint?: number) => lineStyleMarkup(short(), artStyle(twoPaths(), { size: 1, ...(tint === undefined ? {} : { tint }) }), 1, '', ink);
    const exact = lineStyleMarkup(short(), artStyle(twoPaths(), { size: 1 }), 1, '', WHITE);
    expect(at()).toBe(exact);
    expect(at(1)).toBe(exact);
    // At 0 every colour of it is the ink: the square's fill and outline, the tick's.
    expect(at(0).match(/rgb\([^)]*\)/g)).toEqual(['rgb(255,0,0)', 'rgb(255,0,0)', 'rgb(255,0,0)']);
    // Half way: the red outline and the blue fill each half the ink's.
    const [square, tick] = at(0.5).match(/<path [^>]*\/>/g)!;
    expect(square).toContain(' fill="rgb(130,30,110)" fill-opacity="0.5" stroke="rgb(228,5,10)" ');
    expect(tick).toContain(' stroke="rgb(130,30,110)" ');
    // A recoloured object's stamps follow it as far as its style's tint lets them.
    const styled = (tint: number) => obj({ color: ink, effects: { lineStyle: artStyle(twoPaths(), { size: 1, tint }) } });
    expect(buildSVGObjectContent(styled(0), 1, SVG_UNITS_PER_L0_CELL)).toContain('stroke="rgb(255,0,0)"');
    expect(buildSVGObjectContent(styled(1), 1, SVG_UNITS_PER_L0_CELL)).toContain('stroke="rgb(200,10,20)"');
    // One ink is one ink: a silhouette is its ink whatever the style says, and whatever it is stamped along.
    for (const tint of [0, 0.5, 1]) {
      const cast = lineStyleWithInk(artStyle(twoPaths(), { tint }), ink, { floodFills: true });
      expect('tint' in cast).toBe(false);
      expect(lineStyleMarkup(short(), cast, 1, '', ink)).not.toMatch(/rgb\((?!255,0,0\))/);
      expect(lineStyleMarkup(short(), cast, 1, '', BLUE)).not.toMatch(/rgb\((?!255,0,0\))/);
    }
  });

  it('an outline’s width scales with the glyph’s size', () => {
    const at = (size: number) => /stroke-width="([^"]*)"/.exec(
      lineStyleMarkup(straight(), artStyle(twoPaths(), { size }), 1, '', RED),
    )![1];
    // Fitted 0.05 × size × 256 units a cell.
    expect(at(1)).toBe('12.8');
    expect(at(2)).toBe('25.6');
    expect(at(0.5)).toBe('6.4');
  });

  it('nothing to stamp is no markup, and a style without drawable art is the one path it always was', () => {
    expect(lineStyleMarkup([], artStyle(), 1, '', RED)).toBe('');
    const custom: [number, number][][] = [[[0, 0], [1, 0]]];
    const plain = style({ glyph: 'custom', custom });
    const undrawable = style({ glyph: 'custom', custom, art: [{ points: [[0, 0], [1, 1]] }] });
    const attrs = 'fill="none" stroke-width="7"';
    expect(lineStyleMarkup(straight(), undrawable, 1, attrs, RED)).toBe(lineStyleMarkup(straight(), plain, 1, attrs, RED));
    expect(lineStyleMarkup(straight(), plain, 1, attrs, RED).match(/<path /g)).toHaveLength(1);
  });

  it('reaches the canvas and the export through the one strokes builder, the object’s fill subpaths drawn as ever', () => {
    const styled = obj({ color: WHITE, effects: { lineStyle: artStyle(twoPaths(), { size: 1 }) } });
    const { attrs, segments } = svgStrokePresentation(styled, 1, SVG_UNITS_PER_L0_CELL);
    const m = svgStrokesMarkup(styled, segments, attrs, 0.25);
    expect(m).toContain('fill="rgb(5,60,220)"');
    expect(buildSVGObjectContent(styled, 1, SVG_UNITS_PER_L0_CELL)).toContain('stroke="rgb(200,10,20)"');
  });
});

describe('art in one ink', () => {
  it('a recolour WRITES the ink into the art’s outlines, and into its fills only under a flood — the subpaths’ rule — and takes the style’s tint off, so what is written is what is drawn', () => {
    const GREEN = { r: 0, g: 128, b: 0 };
    const s = artStyle(twoPaths(), { size: 1, tint: 0.5 });
    const inked = lineStyleWithInk(s, GREEN);
    expect(inked.art![0]).toMatchObject({ color: GREEN, width: 0.02, fill: BLUE, fillOpacity: 0.5 });
    expect(inked.art![1]).toMatchObject({ color: GREEN, width: 0.04, opacity: 0.25 });
    expect(inked.art![0].points).toBe(s.art![0].points);
    expect('tint' in inked).toBe(false);
    const flooded = lineStyleWithInk(s, GREEN, { floodFills: true });
    expect(flooded.art![0]).toMatchObject({ color: GREEN, fill: GREEN });
    // The style it was given is not written to.
    expect(s.art![0].color).toBe(RED);
    expect(s.tint).toBe(0.5);
    // Drawn: the outlines in the ink and the kept fill exactly as drawn, whatever the object is coloured.
    for (const along of [GREEN, WHITE, RED]) {
      const [square, tick] = lineStyleMarkup(straight(), inked, 1, '', along).match(/<path [^>]*\/>/g)!;
      expect(square).toContain(' fill="rgb(5,60,220)" fill-opacity="0.5" stroke="rgb(0,128,0)" ');
      expect(tick).toContain(' stroke="rgb(0,128,0)" ');
    }
  });

  it('widens every outline by world cells, whatever the glyph’s size and the art’s own', () => {
    // A cell wider on a glyph two cells across, fitted from a 0.4 box:
    // 1 × 0.4 ÷ 2 in the art's own units — a cell again once it is drawn.
    const s = artStyle(twoPaths(), { size: 2 });
    const wide = lineStyleWithInk(s, WHITE, { widenCells: 1 });
    expect(wide.art![0].width).toBeCloseTo(0.02 + 0.2, 9);
    const before = lineStyleArt(s)!;
    const after = lineStyleArt(wide)!;
    after.forEach((path, i) => expect((path.width! - before[i].width!) * s.size).toBeCloseTo(1, 9));
  });

  it('a style with no drawable art comes back as it is', () => {
    const plain = style({ glyph: 'heart' });
    expect(lineStyleWithInk(plain, WHITE, { floodFills: true, widenCells: 1 })).toBe(plain);
    const undrawable = artStyle([{ points: [[0, 0], [1, 1]] }]);
    expect(lineStyleWithInk(undrawable, WHITE)).toBe(undrawable);
  });

  it('an object recoloured for a cutout has its art recoloured with it', () => {
    const styled = obj({ effects: { shadow: { dx: 0, dy: 0, blur: 1, color: RED, alpha: 1 }, lineStyle: artStyle() } });
    const white = withSVGObjectStrokeColor(styled, WHITE);
    expect(white.effects!.lineStyle!.art![0]).toMatchObject({ color: WHITE, fill: BLUE });
    expect(white.effects!.shadow).toBe(styled.effects!.shadow);
    expect(withSVGObjectStrokeColor(styled, WHITE, { floodFills: true }).effects!.lineStyle!.art![0].fill).toEqual(WHITE);
    // The ink is written into the art, so its stamps are in it.
    const red = withSVGObjectStrokeColor(styled, RED, { floodFills: true });
    expect(buildSVGObjectContent(red, 1, SVG_UNITS_PER_L0_CELL)).toContain('fill="rgb(200,10,20)"');
    // An object whose style has no art keeps the very effects it had.
    const plain = obj({ effects: { lineStyle: style({ glyph: 'heart' }) } });
    expect(withSVGObjectStrokeColor(plain, WHITE).effects).toBe(plain.effects);
  });
});
