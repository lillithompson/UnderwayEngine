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
  LINE_STYLE_GLYPH_OPTIONS, MAX_GLYPH_SIZE, MIN_GLYPH_SIZE, padPointFromTouch, padPolylines,
  strokesAfterDraw,
} from '../logic/lineStyle';
import {
  BAR_CUSHION, CONTENT_PAD, ROW_GAP, ROW_SEGMENTED, ROW_SLIDER, SHADOW_PAD_SIZE, pageIsWelled,
  submenuHeight,
} from '../logic/submenuHeight';

const SRC = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(SRC, ...p), 'utf8');
const PANEL = read('components', 'ObjectPropertiesPanel.tsx');
const BAR = read('components', 'LineStyleBar.tsx');
const EFFECTS = read('components', 'EffectsBar.tsx');
const ADAPTER = read('adapter.ts');

const model = (extras: Partial<LineStyleModel> = {}): LineStyleModel => ({
  glyph: 'circle', density: 0.5, size: 1, randomPlacement: 0, randomRotation: 0, randomSize: 0,
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
  it('is the glyph row, then five sliders with the pad beside them, and never changes height', () => {
    const rows = [ROW_SLIDER, ROW_SLIDER, ROW_SLIDER, ROW_SLIDER, ROW_SLIDER];
    const block = Math.max(rows.reduce((a, b) => a + b, 0) + ROW_GAP * 4, SHADOW_PAD_SIZE);
    expect(submenuHeight('lineStyle')).toBe(CONTENT_PAD * 2 + ROW_SEGMENTED + ROW_GAP + block + BAR_CUSHION);
    // The pad is the Shadow page's square, shorter than five rows, so the
    // sliders set the height whatever glyph is showing.
    expect(block).toBeGreaterThan(SHADOW_PAD_SIZE);
    expect(pageIsWelled('lineStyle')).toBe(true);
    expect(BAR.match(/<SliderRow/g)).toHaveLength(5);
    expect(BAR).toContain('<SegmentedRow');
    expect(BAR).toContain('label="Density"');
    expect(BAR).toContain('label="Size"');
    expect(BAR).toContain('label="Scatter"');
    expect(BAR).toContain('label="Spin"');
    expect(BAR).toContain('label="Vary"');
  });

  it('offers the four glyphs and Draw, in that order', () => {
    expect(LINE_STYLE_GLYPH_OPTIONS.map((o) => o.value)).toEqual(['line', 'circle', 'sparkle', 'heart', 'custom']);
    expect(LINE_STYLE_GLYPH_OPTIONS.map((o) => o.label)).toEqual(['Dash', 'Circle', 'Sparkle', 'Heart', 'Draw']);
    // A choice commits at once.
    expect(BAR).toContain("onChange={(glyph) => set({ glyph }, true)}");
  });

  it('sizes glyphs from a dot to 64pt', () => {
    expect(MIN_GLYPH_SIZE).toBe(0.125);
    expect(MAX_GLYPH_SIZE).toBe(4);
  });
});

describe('the pad', () => {
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
    // A tap draws nothing.
    expect(strokesAfterDraw(model(), [[0.5, 0.5]])).toBeNull();
    expect(BAR).toContain("if (custom) set({ glyph: 'custom', custom }, true);");
  });

  it('draws a drawn glyph as drawn, and a built-in one from its unit box', () => {
    const custom: [number, number][][] = [[[0.1, 0.2], [0.3, 0.4]]];
    expect(padPolylines(model({ glyph: 'custom', custom }))).toBe(custom);
    const [dash] = padPolylines(model({ glyph: 'line' }));
    expect(dash[0][1]).toBeCloseTo(0.5);
    expect(dash[0][0]).toBeLessThan(0.5);
    expect(dash[1][0]).toBeGreaterThan(0.5);
    for (const poly of padPolylines(model({ glyph: 'heart' }))) {
      for (const [x, y] of poly) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(1);
      }
    }
    // Draw with nothing drawn yet shows the circle it will stamp.
    expect(padPolylines(model({ glyph: 'custom' }))).toEqual(padPolylines(model({ glyph: 'circle' })));
  });

  it('Clear takes the drawing away and the glyph goes back to the circle', () => {
    expect(BAR).toContain("onPress={() => set({ glyph: 'circle', custom: undefined }, true)}");
    expect(BAR).toContain('disabled={!drawn}');
  });
});
