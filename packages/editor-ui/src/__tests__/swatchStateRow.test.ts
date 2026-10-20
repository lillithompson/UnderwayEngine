import { readFileSync } from 'fs';
import { resolve } from 'path';
import { COLOR_PALETTE } from '@/engine/types';
import { swatchInk } from '../logic/hsv';
import {
  HINT_HEIGHT, ROW_CARDS, ROW_SEGMENTED, ROW_SWATCH_STATES, SWATCH_STATE_CAPTION, SWATCH_STATE_CAPTION_LINE,
  SWATCH_GLYPH_COLOUR_MARGIN, SWATCH_GLYPH_SIZE, SWATCH_MAX_WIDTH, SWATCH_PRESET_HEIGHT, SWATCH_PRESET_PAD,
  SWATCH_RING_WIDTH, SWATCH_STATE_GAP, SWATCH_STATE_LABEL, SWATCH_STATE_SIZE, submenuHeight,
} from '../logic/submenuHeight';

/** What the sheet takes off the window's width before the swatch row gets
 *  it, measured in Chrome on the Fields page (Phase 10b's walk): the
 *  panel's 16 each side plus the sheet's own inset. */
const SHEET_INSETS = 60;

// The swatch-state row (SwatchStateRow) and a host page made of it. The
// page stands as tall as its rows, measured by the same
// numbers the component lays out with; the component reads its metrics
// from submenuHeight so the two cannot drift. No renderer here; the
// layout is pinned at the source, as the other panel suites do.

const ADAPTER = readFileSync(resolve(__dirname, '..', 'adapter.ts'), 'utf8');
const ROW = readFileSync(resolve(__dirname, '..', 'components', 'SwatchStateRow.tsx'), 'utf8');

describe('a swatch-state row’s height', () => {
  it('is one swatch-state row: caption line, swatches, a two-line sentence', () => {
    expect(ROW_SWATCH_STATES).toBe(SWATCH_STATE_LABEL + SWATCH_STATE_SIZE + SWATCH_STATE_CAPTION);
    expect(SWATCH_STATE_CAPTION).toBe(4 + SWATCH_STATE_CAPTION_LINE * 2);
    expect(submenuHeight('host:p', { hostPage: { rows: [{ kind: 'swatchStates' }] } }))
      .toBe(submenuHeight('host:p', { hostPage: { rows: [] } }) - ROW_SEGMENTED + ROW_SWATCH_STATES);
    // Taller than the cards row (the sentence under it), one row either way.
    expect(ROW_SWATCH_STATES).toBeGreaterThan(ROW_CARDS);
    expect(ROW_SWATCH_STATES).toBeGreaterThan(HINT_HEIGHT);
  });

  it('counts each row it lists', () => {
    expect(submenuHeight('host:p', { hostPage: { rows: [{ kind: 'slider' }, { kind: 'swatchStates' }] } }))
      .toBeGreaterThan(submenuHeight('host:p', { hostPage: { rows: [{ kind: 'swatchStates' }] } }));
  });
});

describe('the swatch-state row', () => {
  it('takes its states, glyphs and caption from the caller (any host page can list one)', () => {
    expect(ADAPTER).toContain("export interface SwatchStateItem { id: string; color: RGBLike; state: string; label: string }");
    expect(ADAPTER).toContain("export interface SwatchPresetItem { id: string; label: string }");
    expect(ADAPTER).toContain("export interface SwatchStateStyle { ring: 'grey' | 'solid' | 'dashed'; glyph?: string }");
    expect(ADAPTER).toContain("| { kind: 'swatchStates'; key: string; label: string;");
    expect(ADAPTER).toContain("onSwatchState?(page: string, key: string, id: string): void;");
    expect(ROW).toContain('export function SwatchStateRow({ label, items, states, caption, presets, disabled = false, onTap }: {');
    expect(ROW).toContain('onPress={() => onTap(item.id)}');
    expect(ROW).toContain('const style = states[item.state] ?? DEFAULT_STYLE;');
  });

  it('lays out with the metrics the height arithmetic reads', () => {
    expect(ROW).toContain('SWATCH_GLYPH_SIZE, SWATCH_MAX_WIDTH, SWATCH_PRESET_HEIGHT, SWATCH_PRESET_PAD, SWATCH_RING_WIDTH,');
    expect(ROW).toContain('SWATCH_STATE_GAP, SWATCH_STATE_LABEL, SWATCH_STATE_SIZE,');
    expect(ROW).toContain('height: SWATCH_STATE_LABEL');
    expect(ROW).toContain("swatches: { flexDirection: 'row', gap: SWATCH_STATE_GAP, height: SWATCH_STATE_SIZE }");
    expect(ROW).toContain('height: SWATCH_STATE_CAPTION, paddingTop: 4');
    expect(ROW).toContain('lineHeight: SWATCH_STATE_CAPTION_LINE');
    expect(ROW).toContain('<Text style={styles.caption} numberOfLines={2}>{caption}</Text>');
  });

  it('draws the three rings at one width — grey, solid ink, dashed ink — with the colour clipped inside', () => {
    expect(ROW).toContain("grey: { borderColor: PANEL_SWATCH_BORDER, borderStyle: 'solid' },");
    expect(ROW).toContain("solid: { borderColor: PANEL_INK, borderStyle: 'solid' },");
    expect(ROW).toContain("dashed: { borderColor: PANEL_INK, borderStyle: 'dashed' },");
    expect(ROW).toContain('borderWidth: RING_WIDTH,');
    expect(ROW).toContain("overflow: 'hidden'");
    expect(ROW).toContain('<ColorSwatchFill color={item.color} />');
  });

  /**
   * The glyph sits ON the colour: a palette's nine entries may all be
   * light, and a host's tenth swatch BLACK, where a #2a2a2a glyph was
   * invisible.
   */
  it('inks the glyph by the swatch’s own luma, not in the panel’s ink', () => {
    expect(ROW).toContain("import { swatchInk } from '../logic/hsv';");
    expect(ROW).toContain('color={swatchInk(item.color)}');
    // The one answer in the package, not a second threshold here.
    expect(ROW).not.toMatch(/const\s+\w*LUMA\w*\s*=/);
    // The tenth swatch — black — is the one this is for: a white glyph.
    expect(swatchInk({ r: 0, g: 0, b: 0 })).toBe('#fff');
    // Of the nine palette entries only the rose (index 1) is dark enough
    // to flip; the other eight keep the dark glyph.
    const inks = COLOR_PALETTE.map(([r, g, b]) => swatchInk({ r, g, b }));
    expect(inks.filter((i) => i === '#fff')).toHaveLength(1);
    expect(inks[1]).toBe('#fff');
    expect(inks[0]).toBe('#000');
    // The ring is unchanged: it is drawn on the PANEL, not on the colour.
    expect(ROW).toContain("solid: { borderColor: PANEL_INK, borderStyle: 'solid' },");
  });

  /**
   * Ten swatches on an iPhone SE. The sheet's
   * content is the window less about 60 pt of insets, so at 320 pt the ten
   * are around 25 pt wide — and a fixed 16 pt glyph covered the colour
   * almost edge to edge, which is the one thing the swatch is there to
   * show. The glyph shrinks instead; the row keeps its height, so
   * ROW_SWATCH_STATES and every sheet built on it are untouched.
   */
  describe('ten swatches at an iPhone SE’s width', () => {
    /** What a swatch is wide in a sheet on a `window`-wide screen. */
    const swatchWidth = (window: number, n: number) => Math.min(
      SWATCH_MAX_WIDTH, (window - SHEET_INSETS - SWATCH_STATE_GAP * (n - 1)) / n,
    );
    /** …and the colour left showing each side of its glyph. */
    const colourMargin = (w: number) => (w - SWATCH_RING_WIDTH * 2 - SWATCH_GLYPH_SIZE) / 2;

    it('leaves colour showing each side of the glyph, so the swatch still names a colour', () => {
      const ten = swatchWidth(320, 10);
      expect(ten).toBeGreaterThan(24);              // the gap reclaim
      expect(ten).toBeLessThan(SWATCH_MAX_WIDTH);
      expect(colourMargin(ten)).toBeGreaterThanOrEqual(SWATCH_GLYPH_COLOUR_MARGIN - 0.5);
      // Nine are wider still, so they cannot be the tight case.
      expect(swatchWidth(320, 9)).toBeGreaterThan(ten);
    });

    it('the glyph stays a legible mark at the wide end too', () => {
      expect(swatchWidth(1024, 10)).toBe(SWATCH_MAX_WIDTH);
      expect(SWATCH_GLYPH_SIZE).toBeGreaterThanOrEqual(12);
      expect(SWATCH_GLYPH_SIZE).toBeLessThan(SWATCH_STATE_SIZE - SWATCH_RING_WIDTH * 2);
    });

    it('the gap between two swatches is narrow, and the row’s HEIGHT is unchanged', () => {
      expect(SWATCH_STATE_GAP).toBe(2);
      // The whole point of fixing it this way: no sheet gets taller.
      expect(ROW_SWATCH_STATES).toBe(SWATCH_STATE_LABEL + SWATCH_STATE_SIZE + SWATCH_STATE_CAPTION);
    });

    it('the row still holds no state and reads no layout', () => {
      expect(ROW).not.toMatch(/useState|useEffect|useRef|onLayout/);
      expect(ROW).toContain('size={SWATCH_GLYPH_SIZE}');
    });
  });

  /**
   * A row's All and None. They are one-tap presets on the LABEL line,
   * not swatches — the swatch line is already
   * at the width where a swatch barely names a colour on an iPhone SE, and
   * these name none. The label line was empty to the right of its word, so
   * the row's height is untouched and every sheet built on it is too.
   */
  describe('the label line\u2019s one-tap presets', () => {
    it('sit on the label line, so the row keeps its height', () => {
      expect(ROW).toContain("head: { flexDirection: 'row', alignItems: 'center', height: SWATCH_STATE_LABEL }");
      expect(ROW).toContain('label: { flex: 1,');
      expect(ROW).toContain("presets: { flexDirection: 'row', gap: SWATCH_PRESET_PAD }");
      expect(ROW_SWATCH_STATES).toBe(SWATCH_STATE_LABEL + SWATCH_STATE_SIZE + SWATCH_STATE_CAPTION);
      // The chip fits INSIDE the label line it shares.
      expect(SWATCH_PRESET_HEIGHT).toBeLessThanOrEqual(SWATCH_STATE_LABEL);
      // …and its hitSlop brings the touch target back up to a usable size.
      expect(SWATCH_PRESET_HEIGHT + SWATCH_PRESET_PAD * 2).toBeGreaterThanOrEqual(30);
    });

    it('report through the row\u2019s one onTap, and are omitted when the caller passes none', () => {
      expect(ROW).toContain('onPress={() => onTap(preset.id)}');
      expect(ROW).toContain('{presets?.length ? (');
      expect(ROW).toContain('<Text style={styles.presetLabel}>{preset.label}</Text>');
      // Dimmed and inert with the rest of the row while a run is live.
      expect(ROW).toContain('style={[styles.presets, disabled && styles.swatchesDisabled]}');
      // Still no state and no layout read.
      expect(ROW).not.toMatch(/useState|useEffect|useRef|onLayout/);
    });

    it('leave the swatch line as wide as it was', () => {
      // What the presets bought: a swatch line of nine is wider per swatch
      // than one of ten.
      const swatchWidth = (window: number, n: number) => Math.min(
        SWATCH_MAX_WIDTH, (window - SHEET_INSETS - SWATCH_STATE_GAP * (n - 1)) / n,
      );
      expect(swatchWidth(320, 9)).toBeGreaterThan(swatchWidth(320, 10));
      expect(swatchWidth(320, 9)).toBeGreaterThan(SWATCH_GLYPH_SIZE + SWATCH_RING_WIDTH * 2 + SWATCH_GLYPH_COLOUR_MARGIN * 2);
    });
  });

  it('is dimmed and inert when disabled', () => {
    expect(ROW).toContain("pointerEvents={disabled ? 'none' : 'auto'}");
    expect(ROW).toContain('accessibilityState={{ disabled }}');
  });
});
