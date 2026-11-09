/**
 * The STYLE page — a vector's line style, the fourth tab the Effects page
 * can make: the glyph row, the drawing pad beside the five sliders, and
 * how the panel offers it only where there is a path to lay glyphs along.
 * The page's own helpers (the pad's points, the strokes a lifted finger
 * commits, what the pad draws) are pure and tested as such; the rest is
 * pinned as source, as effectsPage.test.ts pins the three cast effects.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { LineStyleModel } from '../adapter';
import {
  LINE_STYLE_GLYPH_OPTIONS, LINE_STYLE_SECTIONS, MAX_GLYPH_ROTATION, MAX_GLYPH_SIZE, MIN_DRAW_EXTENT,
  MIN_GLYPH_SIZE, padGlyphPathD, padPointFromTouch, padPolylinePathD, strokesAfterDraw,
} from '../logic/lineStyle';
import {
  ASIDE_GAP, BAR_CUSHION, GLYPH_BUTTON, GLYPH_GRID_GAP, GLYPH_GRID_LINES_MAX, GROUP_PAD, PATTERN_TILE_GRID_GAP, ROW_GAP,
  ROW_SLIDER, SECTION_TABS_ROW, SHADOW_PAD_SIZE, SHEET_PAD_HORIZONTAL, glyphGridHeight, pageIsWelled,
  rowGroupHeight, submenuHeight,
} from '../logic/submenuHeight';

const SRC = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(SRC, ...p), 'utf8');
const PANEL = read('components', 'ObjectPropertiesPanel.tsx');
const BAR = read('components', 'LineStyleBar.tsx');
const EFFECTS = read('components', 'EffectsBar.tsx');
const ADAPTER = read('adapter.ts');

const model = (extras: Partial<LineStyleModel> = {}): LineStyleModel => ({
  glyph: 'circle', density: 0.5, size: 1, rotation: 0, randomPlacement: 0, randomRotation: 0, randomSize: 0,
  ...extras,
});

describe('the Style tab is one of the Effects family', () => {
  it('is the fourth kind, named Style, with a page of its own', () => {
    expect(EFFECTS).toContain("export const EFFECT_KINDS: readonly EffectKind[] = ['shadow', 'outer', 'inner', 'lineStyle'];");
    expect(EFFECTS).toContain("    : 'Style';");
    expect(PANEL).toContain("shadow: 'shadow', outer: 'glowOuter', inner: 'glowInner', lineStyle: 'lineStyle',");
    expect(PANEL).toContain("} else if (shownEffect === 'lineStyle') {");
    expect(PANEL).toContain('<LineStyleBar');
    // Removed from its page's Remove line and from its button alike, as
    // the three are.
    expect(PANEL).toContain("else if (kind === 'lineStyle') model.onLineStyle?.(null, true);");
    expect(PANEL).toContain("model.onAddLineStyle?.();");
  });

  it('is offered only where the host can make one — a vector — or is already worn', () => {
    expect(PANEL).toContain('const lineStylable = !!model.onAddLineStyle;');
    expect(PANEL).toContain("&& (kind !== 'lineStyle' || lineStylable || effectWorn('lineStyle')),");
    expect(PANEL).toContain("? model.lineStylePresent === true");
    expect(ADAPTER).toContain('onAddLineStyle?(): void;');
    expect(ADAPTER).toContain('onLineStyle?(style: LineStyleModel | null, committed: boolean): void;');
    expect(ADAPTER).toContain('lineStylePresent?: boolean;');
  });

  it('carries no colour of its own: the glyphs wear the Stroke page’s ink', () => {
    expect(ADAPTER).not.toContain('onLineStyleColor');
    expect(BAR).not.toContain('ColorSliderRow');
  });
});

describe('the page', () => {
  it('is one tabbed box, the Copies page’s shape: Glyph, Placement, Rotation, Scale (DrawBots report 99b5fb2e)', () => {
    expect(LINE_STYLE_SECTIONS.map((s) => s.value)).toEqual(['glyph', 'placement', 'rotation', 'scale']);
    expect(LINE_STYLE_SECTIONS.map((s) => s.label)).toEqual(['Glyph', 'Placement', 'Rotation', 'Scale']);
    expect(BAR).toContain('<GroupedBody>');
    expect(BAR).toContain('<RowGroup>');
    expect(BAR).toContain('options={LINE_STYLE_SECTIONS}');
    expect(BAR).toContain('pad={GROUP_PAD}');
    expect(BAR).toContain('radius={SECTION_TABS_GROUP_RADIUS}');
    // The face is the panel's, as the Copies page's is.
    expect(PANEL).toContain("const [lineStyleSection, setLineStyleSection] = useState<LineStyleSection>('glyph');");
    expect(PANEL).toContain('section={lineStyleSection}');
    expect(PANEL).toContain('onSection={setLineStyleSection}');
  });

  it('each face holds its own rows: the glyph grid with the pad, the placement, the turn, the size', () => {
    const glyph = BAR.slice(BAR.indexOf("section === 'glyph' ?"), BAR.indexOf("section === 'placement' ?"));
    const placement = BAR.slice(BAR.indexOf("section === 'placement' ?"), BAR.indexOf("section === 'rotation' ?"));
    const rotation = BAR.slice(BAR.indexOf("section === 'rotation' ?"), BAR.indexOf('label="Size"'));
    const scale = BAR.slice(BAR.indexOf('label="Size"'));
    expect(glyph).toContain('<GlyphPad');
    expect(glyph).toContain('<GlyphGrid value={style.glyph} onChange={(glyph) => set({ glyph }, true)} />');
    // Which glyph alone: Density and Scatter are the Placement face's
    // (DrawBots report 99b5fb2e), and the row the glyphs stood in is gone.
    expect(glyph).not.toContain('<SliderRow');
    expect(BAR).not.toContain('<SegmentedRow');
    expect(placement).toContain('label="Density"');
    expect(placement).toContain('label="Scatter"');
    expect(placement).not.toContain('<GlyphPad');
    expect(rotation).toContain('label="Rotation"');
    expect(rotation).toContain('label="Spin"');
    expect(rotation).not.toContain('<GlyphPad');
    expect(scale).toContain('label="Size"');
    expect(scale).toContain('label="Vary"');
    expect(BAR.match(/<SliderRow/g)).toHaveLength(6);
  });

  it('is bare, and every face stands the pad’s height, so a tab press never resizes the sheet', () => {
    const face = Math.max(glyphGridHeight(GLYPH_GRID_LINES_MAX), ROW_SLIDER * 2 + ROW_GAP, SHADOW_PAD_SIZE);
    expect(face).toBe(SHADOW_PAD_SIZE);
    expect(submenuHeight('lineStyle')).toBe(rowGroupHeight([SECTION_TABS_ROW, face]) + BAR_CUSHION);
    expect(pageIsWelled('lineStyle')).toBe(false);
    expect(BAR).toContain('face: { height: PAD_SIZE, justifyContent: \'center\' },');
  });

  it('turns glyphs a full turn in degrees', () => {
    expect(MAX_GLYPH_ROTATION).toBe(360);
    expect(BAR).toContain('apply={(t, c) => set({ rotation: Math.round(t * MAX_GLYPH_ROTATION) }, c)}');
  });

  it('offers the four glyphs and Draw, in that order', () => {
    expect(LINE_STYLE_GLYPH_OPTIONS.map((o) => o.value)).toEqual(['line', 'circle', 'sparkle', 'heart', 'custom']);
    expect(LINE_STYLE_GLYPH_OPTIONS.map((o) => o.label)).toEqual(['Dash', 'Circle', 'Sparkle', 'Heart', 'Draw']);
    // A choice commits at once.
    expect(BAR).toContain("onChange={(glyph) => set({ glyph }, true)}");
  });

  it('lays the glyphs as a grid of square buttons beside the pad, which wraps and never outgrows the pad (DrawBots report 99b5fb2e)', () => {
    const grid = BAR.slice(BAR.indexOf('function GlyphGrid('), BAR.indexOf('export function LineStyleBar('));
    expect(grid).toContain('{GLYPH_OPTIONS.map((o) => {');
    expect(grid).toContain('style={[styles.gridCell, active && styles.gridCellActive]}');
    expect(grid).toContain('accessibilityState={{ selected: active }}');
    expect(grid).toContain('<MaterialCommunityIcons name={o.icon} size={GLYPH_ICON} color={active ? PANEL_INK : PANEL_INK_DIM} />');
    // Fixed squares, the pattern pages' square dress, wrapping and centred
    // in the face's height.
    expect(BAR).toContain("grid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignContent: 'center', gap: GLYPH_GRID_GAP },");
    expect(BAR).toContain('gridCell: { width: GLYPH_BUTTON, height: GLYPH_BUTTON, ...SQUARE_BUTTON_STYLE },');
    expect(BAR).toContain('gridCellActive: SQUARE_BUTTON_ON_STYLE,');
    expect(GLYPH_BUTTON).toBe(44);
    expect(GLYPH_GRID_GAP).toBe(PATTERN_TILE_GRID_GAP);
    // Three squares fit the column beside the pad on the narrowest sheet
    // (an SE's 375), so the five glyphs are two lines there…
    const column = 375 - 2 * SHEET_PAD_HORIZONTAL - 2 * GROUP_PAD - SHADOW_PAD_SIZE - ASIDE_GAP;
    expect(3 * GLYPH_BUTTON + 2 * GLYPH_GRID_GAP).toBeLessThanOrEqual(column);
    expect(4 * GLYPH_BUTTON + 3 * GLYPH_GRID_GAP).toBeGreaterThan(column);
    // …and even three lines stand inside the pad's height, which the face
    // is fixed at.
    expect(glyphGridHeight(GLYPH_GRID_LINES_MAX)).toBeLessThanOrEqual(SHADOW_PAD_SIZE);
    expect(glyphGridHeight(2)).toBe(2 * GLYPH_BUTTON + GLYPH_GRID_GAP);
  });

  it('sizes glyphs from a dot to 64pt', () => {
    expect(MIN_GLYPH_SIZE).toBe(0.125);
    expect(MAX_GLYPH_SIZE).toBe(4);
  });
});

describe('the pad', () => {
  test('stands in the one pad well the Shadow page does, with no fill of its own', () => {
    expect(BAR).toContain('...PAD_WELL_STYLE');
    expect(EFFECTS).toContain('...PAD_WELL_STYLE');
    expect(BAR).not.toContain('rgba(42,42,42');
  });

  it('reads a touch in its own units, clamped to the square', () => {
    expect(padPointFromTouch(74, 37, 148)).toEqual([0.5, 0.25]);
    expect(padPointFromTouch(-10, 200, 148)).toEqual([0, 1]);
    expect(padPointFromTouch(NaN, 0, 148)).toBeNull();
    expect(padPointFromTouch(1, 1, 0)).toBeNull();
  });

  it('a lifted stroke starts a drawing over a built-in glyph, and adds to a drawn one', () => {
    const stroke: [number, number][] = [[0.1, 0.1], [0.9, 0.9]];
    expect(strokesAfterDraw(model({ glyph: 'heart' }), stroke)).toEqual([stroke]);
    const first: [number, number][][] = [[[0, 0], [1, 0]]];
    expect(strokesAfterDraw(model({ glyph: 'custom', custom: first }), stroke)).toEqual([...first, stroke]);
    // …and the strokes are copies, not the pad's own buffer.
    expect(strokesAfterDraw(model(), stroke)![0]).not.toBe(stroke);
    expect(BAR).toContain("if (custom) set({ glyph: 'custom', custom }, true);");
  });

  it('a tap or a tremor draws nothing: the guard is the stroke’s extent, not its point count', () => {
    // The pad holds a point from the moment the finger lands, so a tap IS a
    // stroke of points — all at one place. Fitted to its own bounds, a
    // tremor would stamp as a full-size dash at whatever angle it shook.
    expect(strokesAfterDraw(model(), [[0.5, 0.5]])).toBeNull();
    expect(strokesAfterDraw(model(), [[0.5, 0.5], [0.5, 0.5]])).toBeNull();
    expect(strokesAfterDraw(model(), [[0.5, 0.5], [0.507, 0.503], [0.5, 0.5]])).toBeNull();
    expect(MIN_DRAW_EXTENT).toBe(0.03);
    expect(strokesAfterDraw(model(), [[0.5, 0.5], [0.5 + MIN_DRAW_EXTENT, 0.5]])).toHaveLength(1);
    // …and the release adds no point of its own: its location is not where
    // the finger let go.
    expect(BAR).toContain('onPanResponderRelease: () => finish(),');
    expect(BAR).not.toContain('onPanResponderRelease: (e) => { add(e); finish(); },');
  });

  it('draws a drawn glyph as drawn, and a built-in one from its unit box with its curves kept', () => {
    const custom: [number, number][][] = [[[0.1, 0.2], [0.3, 0.4]], [[0.5, 0.5], [1, 1]]];
    expect(padGlyphPathD(model({ glyph: 'custom', custom }), 100))
      .toBe('M 10,20 L 30,40 M 50,50 L 100,100');
    // The dash runs across the middle of the pad, 70% of its width.
    expect(padGlyphPathD(model({ glyph: 'line' }), 100)).toBe('M 15,50 L 85,50');
    // A circle is its four curves — not a chain of pieces, which drew as a
    // dashed ring.
    const circle = padGlyphPathD(model({ glyph: 'circle' }), 100);
    expect(circle.match(/ C /g)).toHaveLength(4);
    expect(circle).not.toContain(' L ');
    expect(circle.endsWith(' Z')).toBe(true);
    expect(padGlyphPathD(model({ glyph: 'heart' }), 100)).toContain(' C ');
    expect(padGlyphPathD(model({ glyph: 'sparkle' }), 100)).toContain(' C ');
    // Draw with nothing drawn yet is a BLANK pad (DrawBots report
    // 99b5fb2e): the square is empty for the drawing it asks for, and a
    // drawing emptied the same (the path keeps stamping its circle in the
    // meantime — the engine's rule for a drawn glyph with nothing to fit).
    expect(padGlyphPathD(model({ glyph: 'custom' }), 100)).toBe('');
    expect(padGlyphPathD(model({ glyph: 'custom', custom: [] }), 100)).toBe('');
    // …and the stroke under the finger is the same arithmetic.
    expect(padPolylinePathD([[0, 0], [0.5, 0.25]], 148)).toBe('M 0,0 L 74,37');
    // Drawn as ONE svg path, the toolbar's shape icons' way, not as views.
    expect(BAR).toContain('<svg');
    expect(BAR).toContain('<path d={glyphD}');
    expect(BAR).not.toContain('transform: [{ rotate:');
  });

  it('is one pad for every host: exported, dressed by a skin, the Style page in the panel\'s', () => {
    // A host with a page of its own for a line style (DrawBots' Changes
    // style effect) hands the pad a skin; it never writes a second pad.
    expect(BAR).toContain('export interface GlyphPadSkin {');
    expect(BAR).toContain("export function GlyphPad({ style, onDraw, onClear, skin = PANEL_GLYPH_PAD, locked = false, touch = 'location' }: {");
    expect(BAR).toContain('export const PANEL_GLYPH_PAD: GlyphPadSkin = {');
    expect(BAR).toContain('size: PAD_SIZE, ink: PANEL_INK, accent: CONTROL_ACCENT, strokeWidth: PREVIEW_STROKE,');
    expect(BAR).toContain('pad: styles.pad, clear: styles.clear, clearLabel: styles.clearLabel,');
    // Everything it draws comes from the skin.
    expect(BAR).toContain('glyphD={padGlyphPathD(style, skin.size)}');
    expect(BAR).toContain('<path d={glyphD} stroke={skin.ink} strokeWidth={skin.strokeWidth}');
    expect(BAR).toContain('<path d={strokeD} stroke={skin.accent} strokeWidth={skin.strokeWidth}');
    expect(BAR).toContain('style={skin.pad}');
    // The Style page asks for neither host option: the pad as it always was.
    const page = BAR.slice(BAR.indexOf('export function LineStyleBar'));
    expect(page).not.toContain('locked=');
    expect(page).not.toContain('touch=');
    expect(page).not.toContain('skin=');
  });

  it('a host may lock it, and may have its box read once a stroke', () => {
    expect(BAR).toContain('onStartShouldSetPanResponder: () => !lockedRef.current,');
    expect(BAR).toContain('onMoveShouldSetPanResponder: () => !lockedRef.current,');
    expect(BAR).toContain("pointerEvents={locked ? 'none' : 'auto'}");
    expect(BAR).toContain('{onClear && !locked ? (');
    expect(BAR).toContain('locked ? skin.locked : null');
    // By default each event's own location, as ever; `touch: 'box'` reads
    // the pad's box as the stroke is claimed and places every move in it.
    expect(BAR).toContain(': padPointFromTouch(e.nativeEvent.locationX, e.nativeEvent.locationY, sizeRef.current);');
    expect(BAR).toContain("const r = touchRef.current === 'box' ? padRef.current?.getBoundingClientRect?.() : undefined;");
    expect(BAR).toContain('? padPointFromTouch(e.nativeEvent.pageX - box.left, e.nativeEvent.pageY - box.top, box.side)');
    expect(BAR.match(/getBoundingClientRect/g)).toHaveLength(1);
    // A terminated stroke commits what it had, as a lifted one does.
    expect(BAR).toContain('onPanResponderTerminate: () => finish(),');
  });

  it('Clear takes the drawing away and the glyph goes back to the circle', () => {
    expect(BAR).toContain("onClear={drawn ? () => set({ glyph: 'circle', custom: undefined }, true) : undefined}");
  });
});
