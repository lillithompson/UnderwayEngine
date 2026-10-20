/**
 * The toolbar's metadata and mode tables (components/toolbarMeta.ts), for
 * the STANDARD tools — every app's bar. A host's own tools, and what the
 * registry adds to the content row, the lit state and the hold, are
 * hostTools.test.ts; what each app's shell does with the bar is pinned in
 * its own tree.
 */

import {
  PAINT_MODES,
  contentModeRow,
  DEFAULT_PAINT_MODE,
  DEFAULT_CONTENT_MODE,
  DEFAULT_LINE_MODE,
  FACET_GLYPH_SCALE,
  LINE_MODES,
  lineModes,
  PAINT_MODE_ICON,
  facetGlyphTransform,
  POLYGON_MAX_SIDES,
  POLYGON_MIN_SIDES,
  TOOL_META,
  arcToolLabel,
  paintModeIcon,
  paintModeLabel,
  paintModeToolId,
  contentModeIcon,
  contentModeLabel,
  contentModeTarget,
  contentModes,
  deadContentModes,
  isBrushToolId,
  isRasterBrushToolId,
  isContentToolId,
  isLineToolId,
  lineModeLabel,
  lineModeToolId,
  lineModeOfToolId,
  contentModeOfToolId,
  lineToolLabel,
  nextToolOnPress,
  patternToolAnchor,
  POLYGON_ICON_CIRCLE_R,
  polygonIsCircle,
  POLYGON_CIRCLE,
  POLYGON_HEART,
  POLYGON_SPIRAL,
  POLYGON_STAR,
  SHAPE_CAPSULE_OPTIONS,
  SHAPE_MODAL_SHAPES,
  POLYGON_SEMICIRCLE,
  POLYGON_SEMI_TORUS,
  POLYGON_RIGHT_TRIANGLE,
  POLYGON_QUARTER_CIRCLE,
  POLYGON_QUARTER_TORUS,
  SHAPE_MODAL_EXTRA_SOLIDS,
  polygonIsParametric,
  polygonIsQuarterCircle,
  polygonIsQuarterTorus,
  polygonIsRightTriangle,
  polygonIsSemiTorus,
  polygonIsSemicircle,
  quarterCircleIconPoints,
  quarterTorusIconPoints,
  rightTriangleIconPoints,
  semiTorusIconPoints,
  semicircleIconPoints,
  shapeModalShapes,
  heartIconPoints,
  starIconPoints,
  polygonIsHeart,
  polygonIsSpiral,
  polygonShapeLabel,
  shapeCapsuleKeyOf,
  shapeCapsuleSides,
  spiralIconPoints,
  regularPolygonIconPoints,
  toggleArcToolMode,
  toggleLineToolMode,
  holdRecallsModeCapsule,
  swatchPressTool,
  toolbarButtonIds,
  toolbarButtonLit,
} from '../components/toolbarMeta';
import { NO_HOST_TOOLS } from '../hostTools';

/** The MaterialCommunityIcons glyph map, where the font is installed. The
 *  font is the consuming app's (a peer dependency), so the pin that reads
 *  it runs in every app's suite — which roots jest at this package too —
 *  and is skipped in the standalone engine clone, where there is no font. */
function mciGlyphs(): Record<string, number> | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json');
  } catch {
    return null;
  }
}
const MCI_GLYPHS = mciGlyphs();

/** The grouped bar every app's freeform format carries (each app's
 *  freeformConfig ALL_TOOLS): the content group in place of a standalone
 *  pattern button, the swatch beside the recolour brush. */
const GROUPED_BAR = ['arrange', 'content', 'lines', 'polygon', 'color', 'paints', 'swatch'] as const;
const NO = NO_HOST_TOOLS;

describe('TOOL_META', () => {
  it('gives every tool a label and an icon name', () => {
    for (const meta of Object.values(TOOL_META)) {
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.icon.length).toBeGreaterThan(0);
    }
  });

  (MCI_GLYPHS ? it : it.skip)('names a glyph the shipped font actually has', () => {
    // A name the font does not carry renders as a "?" box on the bar, and
    // nothing else would say so. (A host's registered glyphs are checked
    // the same way — hostTools.test.ts.)
    const glyphs = MCI_GLYPHS!;
    for (const [id, meta] of Object.entries(TOOL_META)) {
      expect([id, glyphs[meta.icon] !== undefined]).toEqual([id, true]);
    }
  });

  it('gives the two colour buttons the marks their jobs deserve', () => {
    // The raster group lays paint on the page, so it wears the PAINTBRUSH;
    // the recolour brush is a brush dragged over what is already drawn, so
    // it wears that same paintbrush — not the spray can, the palette
    // (9d0366e2) or the other brush (82591af0) it has worn before.
    expect(TOOL_META.paint.icon).toBe('brush');
    expect(TOOL_META.color.icon).toBe(TOOL_META.paint.icon);
    // The raster group's resting glyph is Paint's own.
    expect(TOOL_META.paints.icon).toBe(TOOL_META.paint.icon);
  });

  it('carries exactly the standard tools — a host’s own are the registry’s', () => {
    expect(Object.keys(TOOL_META).sort()).toEqual([
      'arc', 'arrange', 'blur', 'color', 'content', 'draw', 'erase', 'line', 'lines', 'paint', 'paints',
      'pattern', 'photos', 'polygon', 'push', 'stickers', 'swatch', 'text',
    ]);
  });
});

describe("the standalone pattern button's place on the bar", () => {
  it('follows Text, putting a bespoke bar in its intended order', () => {
    const tools = ['arrange', 'photos', 'text', 'line', 'arc'] as const;
    expect(patternToolAnchor([...tools])).toBe('text');
    const bar: string[] = tools.flatMap((t) =>
      t === patternToolAnchor([...tools]) ? [t, 'pattern'] : [t],
    );
    expect(bar).toEqual(['arrange', 'photos', 'text', 'pattern', 'line', 'arc']);
  });

  it('trails the last tool when the toolset has no Text', () => {
    expect(patternToolAnchor(['arrange', 'draw'])).toBe('draw');
  });

  it('has nowhere to go on an empty toolset', () => {
    expect(patternToolAnchor([])).toBeNull();
  });

  it('is absent from the grouped bar — the content button carries it', () => {
    // The unrestricted carousel reaches the pattern tool through the content
    // group's Pattern mode, so no separate button renders there.
    expect(GROUPED_BAR).toContain('content');
    expect(patternToolAnchor(GROUPED_BAR)).toBeNull();
  });
});

describe('shape tool sub-modes (Facet long-press toggles)', () => {
  it('flips the line tool between path and rectangle', () => {
    expect(toggleLineToolMode('line')).toBe('rectangle');
    expect(toggleLineToolMode('rectangle')).toBe('line');
    expect(toggleLineToolMode(toggleLineToolMode('line'))).toBe('line');
  });

  it('flips the arc tool between arc and circle', () => {
    expect(toggleArcToolMode('arc')).toBe('circle');
    expect(toggleArcToolMode('circle')).toBe('arc');
    expect(toggleArcToolMode(toggleArcToolMode('arc'))).toBe('arc');
  });

  it('labels each sub-mode the way Facet does', () => {
    expect(lineToolLabel('line')).toBe('Path');
    expect(lineToolLabel('rectangle')).toBe('Rectangle');
    expect(arcToolLabel('arc')).toBe('Arc');
    expect(arcToolLabel('circle')).toBe('Circle');
  });
});

describe('the unified line tool (pushdown mode picker)', () => {
  it('offers freehand, line and arc — in that order, words only', () => {
    expect(lineModes({})).toEqual(['freehand', 'line', 'arc']);
    expect(lineModes({}).map(lineModeLabel)).toEqual(['Freehand', 'Line', 'Arc']);
    // A host's tile tool is the OBJECT group's, not a stroke: you tap a
    // cell and a piece of content lands there.
    expect(LINE_MODES).not.toContain('tile');
  });

  it('offers Paint after Arc only where the format asks (linePaintTool)', () => {
    expect(LINE_MODES).toEqual(['freehand', 'line', 'arc', 'paint']);
    expect(lineModes({ linePaintTool: true })).toEqual(['freehand', 'line', 'arc', 'paint']);
    expect(lineModes({ linePaintTool: true }).map(lineModeLabel))
      .toEqual(['Freehand', 'Line', 'Arc', 'Paint']);
    expect(lineModes({ linePaintTool: false })).not.toContain('paint');
    // It arms the same raster brush the 'paints' group's Paint mode does.
    expect(lineModeToolId('paint')).toBe('paint');
  });

  it('lights and holds the line button for the brush only on a Paint-carrying group', () => {
    expect(isLineToolId('paint', true)).toBe(true);
    expect(isLineToolId('paint')).toBe(false);
    // Its companions are reached from Paint (the `brushes` capsule), so the
    // button that armed the brush stays lit while they are in hand.
    expect(isLineToolId('erase', true)).toBe(true);
    expect(isLineToolId('push', true)).toBe(true);
    expect(isLineToolId('erase')).toBe(false);
    expect(toolbarButtonLit('lines', 'paint', NO, true)).toBe(true);
    expect(toolbarButtonLit('lines', 'paint', NO)).toBe(false);
    expect(toolbarButtonLit('paints', 'paint', NO, true)).toBe(true);
    expect(holdRecallsModeCapsule('lines', 'paint', NO, true)).toBe(true);
    expect(holdRecallsModeCapsule('lines', 'paint', NO)).toBe(false);
  });

  it('defaults to the line mode', () => {
    expect(DEFAULT_LINE_MODE).toBe('line');
  });

  it('maps each mode to the underlying tool the canvas acts with', () => {
    expect(lineModeToolId('freehand')).toBe('draw');
    expect(lineModeToolId('line')).toBe('line');
    expect(lineModeToolId('arc')).toBe('arc');
  });

  it('reads a tool back to its mode, so a format can open on one', () => {
    // The capsule has to say what the canvas is doing from the FIRST
    // frame: the Response opens armed with the freehand path, and the
    // capsule — left at the default — read "Line" over a canvas drawing
    // freehand.
    for (const mode of LINE_MODES) {
      expect(lineModeOfToolId(lineModeToolId(mode))).toBe(mode);
    }
    expect(lineModeOfToolId('arrange')).toBeNull();
    expect(lineModeOfToolId(null)).toBeNull();
    expect(lineModeOfToolId(undefined)).toBeNull();
  });

  it('lights the button for exactly the tools it stands for', () => {
    for (const mode of lineModes({})) {
      expect(isLineToolId(lineModeToolId(mode))).toBe(true);
    }
    expect(isLineToolId('polygon')).toBe(false);
    expect(isLineToolId('arrange')).toBe(false);
    expect(isLineToolId('lines')).toBe(false); // never an activeTool itself
    expect(isLineToolId(null)).toBe(false);
  });
});

describe('the unified content tool (pushdown mode picker)', () => {
  // The standard row; a host's own modes on it are hostTools.test.ts.

  it('offers image and text — in order, words only — before any host’s own', () => {
    expect(contentModeRow(NO)).toEqual(['image', 'text']);
    expect(contentModeRow(NO).map((m) => contentModeLabel(m, NO))).toEqual(['Image', 'Text']);
  });

  it('defaults to the image mode', () => {
    expect(DEFAULT_CONTENT_MODE).toBe('image');
  });

  it('maps each mode to what the press actually does', () => {
    expect(contentModeTarget('image')).toBe('photos');
    expect(contentModeTarget('text')).toBe('text');
  });

  it('reads a tool back to its mode, so a format can open on one', () => {
    // The capsule has to say what the canvas is doing from the FIRST
    // frame: a page that opens with the text tool armed must not open
    // with the capsule reading "Image".
    for (const mode of contentModeRow(NO)) {
      expect(contentModeOfToolId(contentModeTarget(mode), NO)).toBe(mode);
    }
    expect(contentModeOfToolId('draw', NO)).toBeNull();
    expect(contentModeOfToolId('content', NO)).toBeNull();
    expect(contentModeOfToolId(null, NO)).toBeNull();
    expect(contentModeOfToolId(undefined, NO)).toBeNull();
  });

  it('wears the glyph each option carried as its own button', () => {
    expect(contentModeIcon('image', NO)).toBe(TOOL_META.photos.icon);
    expect(contentModeIcon('text', NO)).toBe(TOOL_META.text.icon);
    // The bar's resting state is the default mode's glyph.
    expect(TOOL_META.content.icon).toBe(contentModeIcon(DEFAULT_CONTENT_MODE, NO));
  });

  it('lights the button for exactly the tools it stands for', () => {
    expect(isContentToolId('photos', NO)).toBe(true);
    expect(isContentToolId('text', NO)).toBe(true);
    expect(isContentToolId('arrange', NO)).toBe(false);
    // The pattern tool does not stand for the group (Pattern came off the
    // row): armed from its own capsules, it leaves the button dark.
    expect(isContentToolId('pattern', NO)).toBe(false);
    expect(isContentToolId('lines', NO)).toBe(false);
    expect(isContentToolId('content', NO)).toBe(false); // never an activeTool itself
    expect(isContentToolId(null, NO)).toBe(false);
  });

  it('offers the standard modes on every format; a flag of another kind opens nothing', () => {
    expect(contentModes({}, NO)).toEqual(['image', 'text']);
    // A pattern format's flag (patternTool) opens nothing here — the PATTERN
    // tool arms from its own capsules.
    expect(contentModes({ ...({ patternTool: true } as object) }, NO)).toEqual(['image', 'text']);
    expect(contentModes({}, NO)).toContain(DEFAULT_CONTENT_MODE);
  });

  it('narrows to the modes a format asks for by name, never widens', () => {
    expect(contentModes({ contentTools: ['text', 'image'] }, NO)).toEqual(['image', 'text']);
    // Naming a mode the row does not carry grants nothing.
    expect(contentModes({ contentTools: ['text', 'bogus'] }, NO)).toEqual(['text']);
    // The default mode can be narrowed away, which is why a shell clamps
    // the current mode to what is offered.
    expect(contentModes({ contentTools: ['text'] }, NO)).not.toContain(DEFAULT_CONTENT_MODE);
    // Dropping a standard mode by name is never a dead mode: nothing turned
    // it on.
    expect(deadContentModes({ contentTools: ['text'] }, NO)).toEqual([]);
  });
});

describe('the unified raster brush tool (pushdown mode picker)', () => {
  it('is a four-way brush toggle — neither the colour nor the recolour brush is a mode', () => {
    // A colour is the setting the brushes share, not another thing to be
    // doing; the pushdown carries no swatch, hex row or disc of its own (the
    // picker is the bar's swatch button). Nor is the RECOLOUR brush here any
    // more: it deposits nothing, and burying it at the head of this menu put
    // the gentlest move on the bar behind the button that can mark a blank
    // page, and made a bar wanting one of the two take both. It is 'color',
    // its own button with its own Fills | Strokes | Patterns capsule.
    //
    // Paint comes first — it is the one that puts colour on the page, and
    // the rest are what you do to colour already there. Push comes last, and
    // belongs: it lays no colour down at all — it moves what is already
    // there — but it is aimed, sized and dragged exactly like the brushes.
    expect(PAINT_MODES).toEqual(['paint', 'erase', 'blur', 'push']);
    expect(PAINT_MODES.map(paintModeLabel))
      .toEqual(['Paint', 'Erase', 'Blur', 'Push']);
    expect(PAINT_MODES).not.toContain('color');
  });

  it('defaults to the paint brush', () => {
    expect(DEFAULT_PAINT_MODE).toBe('paint');
  });

  it('maps each mode to the underlying tool the canvas paints with', () => {
    // Every mode IS its tool id: the pushdown's word, the armed tool and the
    // stamp's PaintBrushKind are one vocabulary, so nothing is translated.
    expect(paintModeToolId('paint')).toBe('paint');
    expect(paintModeToolId('erase')).toBe('erase');
    expect(paintModeToolId('blur')).toBe('blur');
    expect(paintModeToolId('push')).toBe('push');
  });

  it('lights the button for exactly the tools it stands for — not the recolour brush', () => {
    for (const mode of PAINT_MODES) {
      expect(isRasterBrushToolId(paintModeToolId(mode))).toBe(true);
    }
    // The one that keeps the group's button dark: Color is its own button
    // now, and lighting this one for it would say the wrong tool is in hand.
    expect(isRasterBrushToolId('color')).toBe(false);
    expect(isRasterBrushToolId('draw')).toBe(false);
    expect(isRasterBrushToolId('arrange')).toBe(false);
    expect(isRasterBrushToolId('paints')).toBe(false); // never an activeTool itself
    expect(isRasterBrushToolId(null)).toBe(false);
  });

  it('counts every brush — the recolour one included — as taking a size', () => {
    // The floating brush slider and its lower-right mode target belong to
    // ALL five: the recolour brush scales its radius from the same value.
    for (const mode of PAINT_MODES) {
      expect(isBrushToolId(paintModeToolId(mode))).toBe(true);
    }
    expect(isBrushToolId('color')).toBe(true);
    expect(isBrushToolId('draw')).toBe(false);
    expect(isBrushToolId('paints')).toBe(false);
    expect(isBrushToolId(null)).toBe(false);
  });

  it('wears each mode\'s own glyph', () => {
    expect(paintModeIcon('paint')).toBe(PAINT_MODE_ICON);
    expect(paintModeIcon('erase')).toBe(TOOL_META.erase.icon);
    expect(paintModeIcon('blur')).toBe(TOOL_META.blur.icon);
    expect(paintModeIcon('push')).toBe(TOOL_META.push.icon);
    // The group's resting glyph is Paint's own, so the button reads as the
    // brush before anything is picked.
    expect(TOOL_META.paints.icon).toBe(PAINT_MODE_ICON);
  });
});

describe('the shape tool’s pick (capsule + modal tables)', () => {
  it('spans 3–12 sides, a canonical circle, and the two parametric sentinels', () => {
    expect(POLYGON_MIN_SIDES).toBe(3);
    expect(POLYGON_MAX_SIDES).toBe(12);
    expect(polygonIsCircle(POLYGON_CIRCLE)).toBe(true);
    // The sentinels are neither circles nor side counts…
    expect(polygonIsHeart(POLYGON_HEART)).toBe(true);
    expect(polygonIsSpiral(POLYGON_SPIRAL)).toBe(true);
    expect(polygonIsCircle(POLYGON_HEART)).toBe(false);
    expect(polygonIsCircle(POLYGON_SPIRAL)).toBe(false);
    // …and every real count is exactly a count.
    for (let sides = POLYGON_MIN_SIDES; sides <= POLYGON_MAX_SIDES; sides++) {
      expect(polygonIsCircle(sides)).toBe(false);
      expect(polygonIsHeart(sides)).toBe(false);
    }
  });

  it('names every value: circle, heart, star, spiral, or the count', () => {
    expect(polygonShapeLabel(POLYGON_CIRCLE)).toBe('circle');
    expect(polygonShapeLabel(2)).toBe('circle');
    expect(polygonShapeLabel(POLYGON_HEART)).toBe('heart');
    expect(polygonShapeLabel(POLYGON_SPIRAL)).toBe('spiral');
    expect(polygonShapeLabel(POLYGON_STAR)).toBe('star');
    expect(polygonShapeLabel(3)).toBe('3');
    expect(polygonShapeLabel(12)).toBe('12');
    // A sentinel is not a side count, so it is not a circle either — the
    // circle rule is "off the 3–12 range", and every sentinel sits above it.
    expect(polygonIsCircle(POLYGON_STAR)).toBe(false);
  });

  it('the capsule is Circle | Triangle | Rectangle | More, arming what it says', () => {
    expect(SHAPE_CAPSULE_OPTIONS.map((o) => o.label))
      .toEqual(['Circle', 'Triangle', 'Rectangle', 'More']);
    expect(shapeCapsuleSides('circle')).toBe(POLYGON_CIRCLE);
    expect(shapeCapsuleSides('triangle')).toBe(3);
    expect(shapeCapsuleSides('rectangle')).toBe(4);
  });

  it('the current value lights its own segment; a modal pick lights More', () => {
    expect(shapeCapsuleKeyOf(POLYGON_CIRCLE)).toBe('circle');
    expect(shapeCapsuleKeyOf(2)).toBe('circle');
    expect(shapeCapsuleKeyOf(3)).toBe('triangle');
    expect(shapeCapsuleKeyOf(4)).toBe('rectangle');
    for (const sides of [5, 6, 12, POLYGON_HEART, POLYGON_SPIRAL, POLYGON_STAR]) {
      expect(shapeCapsuleKeyOf(sides)).toBe('more');
    }
  });

  it('the modal is a 4×3 grid: every N-gon 3–8, Right triangle, Semicircle, Semi-torus, then Star, Heart and Spiral', () => {
    expect(SHAPE_MODAL_SHAPES).toHaveLength(12);
    expect(SHAPE_MODAL_SHAPES.slice(0, 6).map((e) => e.sides))
      .toEqual([3, 4, 5, 6, 7, 8]);
    // The right triangle stands where the 9-gon stood, the two half shapes
    // where the 10- and 11-gon stood.
    expect(SHAPE_MODAL_SHAPES[6]).toEqual({ sides: POLYGON_RIGHT_TRIANGLE, label: 'Right triangle' });
    expect(SHAPE_MODAL_SHAPES[7]).toEqual({ sides: POLYGON_SEMICIRCLE, label: 'Semicircle' });
    expect(SHAPE_MODAL_SHAPES[8]).toEqual({ sides: POLYGON_SEMI_TORUS, label: 'Semi-torus' });
    expect(SHAPE_MODAL_SHAPES[9]).toEqual({ sides: POLYGON_STAR, label: 'Star' });
    expect(SHAPE_MODAL_SHAPES[10]).toEqual({ sides: POLYGON_HEART, label: 'Heart' });
    expect(SHAPE_MODAL_SHAPES[11]).toEqual({ sides: POLYGON_SPIRAL, label: 'Spiral' });
    // The 9-, 10-, 11- and 12-gon left the grid, not the RANGE: past eight
    // sides the figures are a circle with corners, and the capsule already
    // carries the circle — but an older page that stored any of them still
    // draws its N-gon, and the circle still sits just past the ceiling.
    for (const sides of [9, 10, 11, POLYGON_MAX_SIDES]) {
      expect(SHAPE_MODAL_SHAPES.some((e) => e.sides === sides)).toBe(false);
      expect(polygonIsCircle(sides)).toBe(false);
      expect(polygonShapeLabel(sides)).toBe(String(sides));
    }
    expect(POLYGON_MAX_SIDES).toBe(12);
    expect(POLYGON_CIRCLE).toBe(13);
  });

  it('the right triangle, semicircle and semi-torus are sentinels of their own: not a circle, not an N-gon, and named', () => {
    for (const sides of [POLYGON_RIGHT_TRIANGLE, POLYGON_SEMICIRCLE, POLYGON_SEMI_TORUS, POLYGON_QUARTER_CIRCLE, POLYGON_QUARTER_TORUS]) {
      expect(polygonIsCircle(sides)).toBe(false);
      expect(polygonIsParametric(sides)).toBe(false);
      expect(shapeCapsuleKeyOf(sides)).toBe('more');
    }
    // The right triangle is NOT the capsule's Triangle (the equilateral
    // 3-gon): it lights More, the door it came through.
    expect(polygonIsRightTriangle(POLYGON_RIGHT_TRIANGLE)).toBe(true);
    expect(polygonIsRightTriangle(3)).toBe(false);
    expect(polygonIsRightTriangle(POLYGON_SEMICIRCLE)).toBe(false);
    expect(polygonShapeLabel(POLYGON_RIGHT_TRIANGLE)).toBe('right triangle');
    expect(polygonIsSemicircle(POLYGON_SEMICIRCLE)).toBe(true);
    expect(polygonIsSemicircle(POLYGON_SEMI_TORUS)).toBe(false);
    expect(polygonIsSemiTorus(POLYGON_SEMI_TORUS)).toBe(true);
    expect(polygonIsSemiTorus(POLYGON_SEMICIRCLE)).toBe(false);
    expect(polygonShapeLabel(POLYGON_SEMICIRCLE)).toBe('semicircle');
    expect(polygonShapeLabel(POLYGON_SEMI_TORUS)).toBe('semi-torus');
    expect(polygonIsQuarterCircle(POLYGON_QUARTER_CIRCLE)).toBe(true);
    expect(polygonIsQuarterCircle(POLYGON_QUARTER_TORUS)).toBe(false);
    expect(polygonIsQuarterCircle(POLYGON_SEMICIRCLE)).toBe(false);
    expect(polygonIsQuarterTorus(POLYGON_QUARTER_TORUS)).toBe(true);
    expect(polygonIsQuarterTorus(POLYGON_QUARTER_CIRCLE)).toBe(false);
    expect(polygonIsQuarterTorus(POLYGON_SEMI_TORUS)).toBe(false);
    expect(polygonShapeLabel(POLYGON_QUARTER_CIRCLE)).toBe('quarter circle');
    expect(polygonShapeLabel(POLYGON_QUARTER_TORUS)).toBe('quarter torus');
    // Far above the side-count range, beside the other sentinels, and
    // distinct from every one of them.
    const sentinels = [
      POLYGON_HEART, POLYGON_SPIRAL, POLYGON_STAR, POLYGON_SEMICIRCLE, POLYGON_SEMI_TORUS, POLYGON_RIGHT_TRIANGLE,
      POLYGON_QUARTER_CIRCLE, POLYGON_QUARTER_TORUS,
    ];
    expect(new Set(sentinels).size).toBe(sentinels.length);
    for (const s of sentinels) expect(s).toBeGreaterThan(POLYGON_CIRCLE);
  });

  it('the heart, star, spiral, right triangle, half-shape and quarter-shape glyphs draw inside the keyline like the N-gons', () => {
    for (const points of [
      heartIconPoints(), starIconPoints(), spiralIconPoints(), rightTriangleIconPoints(),
      semicircleIconPoints(), semiTorusIconPoints(), quarterCircleIconPoints(), quarterTorusIconPoints(),
    ]) {
      const pts = points.split(' ').map((pair) => pair.split(',').map(Number));
      const xs = pts.map(([x]) => x);
      const ys = pts.map(([, y]) => y);
      // Bbox-fit: the larger dimension meets the circle keyline diameter…
      expect(Math.max(
        Math.max(...xs) - Math.min(...xs),
        Math.max(...ys) - Math.min(...ys),
      )).toBeCloseTo(2 * POLYGON_ICON_CIRCLE_R, 0);
      // …centered at 128, inside the viewBox with stroke room.
      expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(128, 0);
      for (const [x, y] of pts) {
        expect(x).toBeGreaterThanOrEqual(20);
        expect(x).toBeLessThanOrEqual(236);
        expect(y).toBeGreaterThanOrEqual(20);
        expect(y).toBeLessThanOrEqual(236);
      }
    }
  });
});

describe('regularPolygonIconPoints (the sides-tracking button glyph)', () => {
  const parse = (sides: number): [number, number][] =>
    regularPolygonIconPoints(sides).split(' ').map((p) => {
      const [x, y] = p.split(',').map(Number);
      return [x, y];
    });

  it('emits one vertex per side', () => {
    for (const sides of [3, 5, 6, 9, 12]) {
      expect(parse(sides)).toHaveLength(sides);
    }
  });

  it('points up: the first vertex sits at the top center of the box', () => {
    for (const sides of [3, 5, 7]) {
      const [first] = parse(sides);
      expect(first[0]).toBeCloseTo(128, 0);
      expect(first[1]).toBeLessThan(128);
    }
  });

  it('sizes every N-gon to the circle keyline: larger bbox side = circle path diameter', () => {
    for (const sides of [3, 5, 6, 9, 12]) {
      const pts = parse(sides);
      const w = Math.max(...pts.map(([x]) => x)) - Math.min(...pts.map(([x]) => x));
      const h = Math.max(...pts.map(([, y]) => y)) - Math.min(...pts.map(([, y]) => y));
      expect(Math.max(w, h)).toBeCloseTo(2 * POLYGON_ICON_CIRCLE_R, 0);
    }
  });

  it('bbox-centers every N-gon, so no shape rides high in the box', () => {
    for (const sides of [3, 5, 6, 9, 12]) {
      const pts = parse(sides);
      const xs = pts.map(([x]) => x);
      const ys = pts.map(([, y]) => y);
      expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(128, 0);
      expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(128, 0);
    }
  });

  it('leaves room for the 27-wide stroke and its miters inside the viewBox', () => {
    for (const sides of [3, 5, 6, 9, 12]) {
      for (const [x, y] of parse(sides)) {
        expect(x).toBeGreaterThanOrEqual(27);
        expect(x).toBeLessThanOrEqual(229);
        expect(y).toBeGreaterThanOrEqual(27);
        expect(y).toBeLessThanOrEqual(229);
      }
    }
  });

  it("lands the 12-gon's vertices exactly on the circle stop's radius", () => {
    // An even-sided point-up N-gon is 2R tall, so the bbox fit makes its
    // vertex radius the circle glyph's — sliding 12 → 13 barely moves.
    for (const [x, y] of parse(12)) {
      expect(Math.hypot(x - 128, y - 128)).toBeCloseTo(POLYGON_ICON_CIRCLE_R, 0);
    }
  });
});

describe('facetGlyphTransform (full-bleed shape glyphs → Material keyline)', () => {
  it('shrinks the 256 box onto the 18-unit square keyline', () => {
    expect(FACET_GLYPH_SCALE).toBeCloseTo(18 / 24, 10);
  });

  it('scales about the box center: 0 → 32 and 256 → 224, extent 192', () => {
    const m = facetGlyphTransform().match(/^translate\((\S+) (\S+)\) scale\((\S+)\)$/);
    expect(m).not.toBeNull();
    const [, tx, ty, s] = m!.map(Number);
    expect(tx).toBe(ty);
    const map = (p: number) => tx + p * s;
    expect(map(0)).toBeCloseTo(32, 10);
    expect(map(256)).toBeCloseTo(224, 10);
    expect(map(128)).toBeCloseTo(128, 10); // center stays put
    expect(map(256) - map(0)).toBeCloseTo(18 * (256 / 24), 10);
  });
});

describe('nextToolOnPress (toggle semantics)', () => {
  it('selects an inactive tool', () => {
    expect(nextToolOnPress('arrange', 'text')).toBe('text');
    expect(nextToolOnPress('photos', 'color')).toBe('color');
  });

  it('untoggles the active tool, leaving none', () => {
    expect(nextToolOnPress('text', 'text')).toBeNull();
    expect(nextToolOnPress('color', 'color')).toBeNull();
  });

  it('untoggles arrange too — no tool is exempt', () => {
    expect(nextToolOnPress('arrange', 'arrange')).toBeNull();
  });

  it('selects normally from the no-tool state', () => {
    expect(nextToolOnPress(null, 'arrange')).toBe('arrange');
    expect(nextToolOnPress(null, 'draw')).toBe('draw');
  });
});

describe('a hold on the armed group’s button recalls its capsule', () => {
  // The mode capsule gives up its slot to a radial's second level and to a
  // host's own capsules; the hold is the way back that does not untoggle
  // and re-arm the tool.

  it('recalls on the lit button of every group that has a capsule', () => {
    expect(holdRecallsModeCapsule('paints', 'blur', NO)).toBe(true);
    expect(holdRecallsModeCapsule('lines', 'draw', NO)).toBe(true);
    expect(holdRecallsModeCapsule('arrange', 'arrange', NO)).toBe(true);
    expect(holdRecallsModeCapsule('polygon', 'polygon', NO)).toBe(true);
  });

  it('leaves an unlit button its own hold — the paints group’s colour shortcut stays', () => {
    expect(holdRecallsModeCapsule('paints', null, NO)).toBe(false);
    expect(holdRecallsModeCapsule('paints', 'arrange', NO)).toBe(false);
    // …and a button with no capsule to recall keeps its own, lit or not.
    expect(holdRecallsModeCapsule('color', 'color', NO)).toBe(false);
    expect(holdRecallsModeCapsule('text', 'text', NO)).toBe(false);
  });

  it('lights a group for any tool it groups; a plain button for itself', () => {
    expect(toolbarButtonLit('paints', 'push', NO)).toBe(true);
    expect(toolbarButtonLit('swatch', 'paint', NO)).toBe(false);
    expect(toolbarButtonLit('text', 'text', NO)).toBe(true);
    expect(toolbarButtonLit('text', 'draw', NO)).toBe(false);
    expect(toolbarButtonLit('content', 'photos', NO)).toBe(true);
  });
});

describe('the swatch stands for the recolour brush', () => {
  it('draws no Color button where the bar carries the swatch', () => {
    expect(toolbarButtonIds(GROUPED_BAR)).not.toContain('color');
    expect(toolbarButtonIds(GROUPED_BAR)).toContain('swatch');
    expect(toolbarButtonIds(['arrange', 'color', 'swatch'])).toEqual(['arrange', 'swatch']);
    // A bar with the brush and no swatch keeps the brush's own button, so
    // it is never left unreachable.
    expect(toolbarButtonIds(['arrange', 'color'])).toEqual(['arrange', 'color']);
  });

  it('a tap on the swatch arms the brush where the bar carries one', () => {
    expect(swatchPressTool(GROUPED_BAR)).toBe('color');
    expect(swatchPressTool(['arrange', 'color', 'swatch'])).toBe('color');
    // A paint-only bar: nothing to arm; the tap only opens the picker.
    expect(swatchPressTool(['paint', 'swatch'])).toBeNull();
    // With the raster Paint brush in hand the reach keeps it: the colour is
    // for its next dab. Any other tool still gives way to the Color brush.
    expect(swatchPressTool(GROUPED_BAR, 'paint')).toBeNull();
    expect(swatchPressTool(GROUPED_BAR, 'arrange')).toBe('color');
    expect(swatchPressTool(GROUPED_BAR, 'draw')).toBe('color');
    expect(swatchPressTool(GROUPED_BAR, 'erase')).toBe('color');
    expect(swatchPressTool(GROUPED_BAR, null)).toBe('color');
    // A hold on the swatch is the picker's, lit or not — never a capsule
    // recall, which would change the menus.
    expect(holdRecallsModeCapsule('swatch', 'color', NO)).toBe(false);
    expect(holdRecallsModeCapsule('swatch', null, NO)).toBe(false);
  });

  it('lights the swatch while the brush is in hand, and only then', () => {
    expect(toolbarButtonLit('swatch', 'color', NO)).toBe(true);
    expect(toolbarButtonLit('swatch', 'paint', NO)).toBe(false);
    expect(toolbarButtonLit('swatch', null, NO)).toBe(false);
  });

  it('keeps the caller’s own tool-id type through the toggle', () => {
    // nextToolOnPress and toolbarButtonIds are generic over the app's
    // union, so what comes back is typed as what went in.
    const bar = ['arrange', 'plant'] as const;
    const next: 'arrange' | 'plant' | null = nextToolOnPress<'arrange' | 'plant'>('arrange', 'plant');
    expect(next).toBe('plant');
    const ids: ('arrange' | 'plant')[] = toolbarButtonIds(bar);
    expect(ids).toEqual(['arrange', 'plant']);
  });

});

describe('the shape sheet a FORMAT gets (shapeModalShapes)', () => {
  it('is the whole grid unless the format keeps the parametric three off or asks for the extra solids', () => {
    expect(shapeModalShapes({})).toBe(SHAPE_MODAL_SHAPES);
    expect(shapeModalShapes({ shapeModalParametric: true })).toBe(SHAPE_MODAL_SHAPES);
    expect(shapeModalShapes({ shapeModalParametric: undefined })).toBe(SHAPE_MODAL_SHAPES);
    expect(shapeModalShapes({ shapeModalExtraSolids: false })).toBe(SHAPE_MODAL_SHAPES);
    // The whole grid never carries the extras: they are a format's ask.
    for (const e of SHAPE_MODAL_EXTRA_SOLIDS) expect(SHAPE_MODAL_SHAPES.some((s) => s.sides === e.sides)).toBe(false);
  });

  it('the extra solids are the 9-gon and the two quarter shapes, and slot in after the half shapes', () => {
    expect(SHAPE_MODAL_EXTRA_SOLIDS).toEqual([
      { sides: 9, label: '9' },
      { sides: POLYGON_QUARTER_CIRCLE, label: 'Quarter circle' },
      { sides: POLYGON_QUARTER_TORUS, label: 'Quarter torus' },
    ]);
    // With the decorative three off (Shadows): twelve cells, the 4×3 grid
    // full — the nine plain solids, then the three extras.
    const shadows = shapeModalShapes({ shapeModalParametric: false, shapeModalExtraSolids: true });
    expect(shadows.map((e) => e.sides)).toEqual([
      3, 4, 5, 6, 7, 8, POLYGON_RIGHT_TRIANGLE, POLYGON_SEMICIRCLE, POLYGON_SEMI_TORUS,
      9, POLYGON_QUARTER_CIRCLE, POLYGON_QUARTER_TORUS,
    ]);
    expect(shadows).toHaveLength(12);
    expect(shadows.some((e) => polygonIsParametric(e.sides))).toBe(false);
    // With the decorative three kept, the extras still go BEFORE them, so
    // the sheet stays grouped: solids, then decorations.
    const both = shapeModalShapes({ shapeModalExtraSolids: true });
    expect(both.map((e) => e.sides)).toEqual([
      3, 4, 5, 6, 7, 8, POLYGON_RIGHT_TRIANGLE, POLYGON_SEMICIRCLE, POLYGON_SEMI_TORUS,
      9, POLYGON_QUARTER_CIRCLE, POLYGON_QUARTER_TORUS, POLYGON_STAR, POLYGON_HEART, POLYGON_SPIRAL,
    ]);
    // The 9-gon is a real N-gon again on that sheet, not a circle.
    expect(polygonIsCircle(9)).toBe(false);
    expect(polygonShapeLabel(9)).toBe('9');
  });

  it('is the N-gons, the right triangle and the two half shapes, in order, for a format that does (Shadows)', () => {
    const plain = shapeModalShapes({ shapeModalParametric: false });
    expect(plain.map((e) => e.sides)).toEqual([3, 4, 5, 6, 7, 8, POLYGON_RIGHT_TRIANGLE, POLYGON_SEMICIRCLE, POLYGON_SEMI_TORUS]);
    expect(plain.some((e) => polygonIsParametric(e.sides))).toBe(false);
    // The same cells the full grid leads with — a cut, not a rewrite.
    expect(plain).toEqual(SHAPE_MODAL_SHAPES.slice(0, 9));
  });

  it('polygonIsParametric names exactly the heart, star and spiral sentinels', () => {
    for (const sides of [POLYGON_HEART, POLYGON_STAR, POLYGON_SPIRAL]) {
      expect(polygonIsParametric(sides)).toBe(true);
    }
    for (const sides of [3, 4, 5, 11, POLYGON_MAX_SIDES, POLYGON_CIRCLE, 2]) {
      expect(polygonIsParametric(sides)).toBe(false);
    }
  });
});
