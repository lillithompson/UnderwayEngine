/**
 * Deterministic text layout (textLayout.ts). Uses an injected fixed-width
 * measurer (0.5 em per char) so every expected width is exact arithmetic;
 * the built-in defaultMeasurer approximation is pinned separately.
 */

import {
  layoutText,
  measureTextBbox,
  defaultMeasurer,
  registerTextMeasurer,
  DEFAULT_LINE_HEIGHT,
  TextMeasurer,
} from '../textLayout';
import { TextStyle } from '../types';

/** Every char (including the space) advances 0.5 em. */
const mono: TextMeasurer = { advance: () => 0.5 };

function makeStyle(overrides: Partial<TextStyle> = {}): TextStyle {
  return { fontId: 'f', size: 10, color: { r: 0, g: 0, b: 0 }, ...overrides };
}

describe('explicit newlines', () => {
  test('\\n always breaks, including consecutive newlines', () => {
    const layout = layoutText('ab\ncd\n\nef', makeStyle(), { measurer: mono });
    expect(layout.lines.map((l) => l.text)).toEqual(['ab', 'cd', '', 'ef']);
  });

  test('empty paragraphs get zero width but still occupy a line slot', () => {
    const layout = layoutText('a\n\nb', makeStyle(), { measurer: mono });
    expect(layout.lines[1].width).toBe(0);
    expect(layout.height).toBe(3 * 10 * DEFAULT_LINE_HEIGHT);
  });

  test('\\n breaks apply even when wrapping is active', () => {
    const layout = layoutText('aa\nbb', makeStyle(), { measurer: mono, maxWidth: 1000 });
    expect(layout.lines.map((l) => l.text)).toEqual(['aa', 'bb']);
  });
});

describe('word wrap', () => {
  test('wraps greedily at maxWidth, consuming the breaking space', () => {
    // 'aaa aaa' = 7 chars * 5 = 35 <= 40; adding ' aaa' = 55 > 40.
    const layout = layoutText('aaa aaa aaa', makeStyle(), { measurer: mono, maxWidth: 40 });
    expect(layout.lines.map((l) => l.text)).toEqual(['aaa aaa', 'aaa']);
    expect(layout.lines[0].width).toBe(35);
    expect(layout.lines[1].width).toBe(15);
  });

  test('layout width equals maxWidth when wrapping was requested', () => {
    const layout = layoutText('aaa', makeStyle(), { measurer: mono, maxWidth: 40 });
    expect(layout.width).toBe(40);
  });

  test('layout width is the widest line when not wrapping', () => {
    const layout = layoutText('aaaa\naa', makeStyle(), { measurer: mono });
    expect(layout.width).toBe(20);
  });

  test('a single word wider than maxWidth overflows on its own line', () => {
    // 'aaaaaaaaaa' = 10 chars * 5 = 50 > 30 — not split.
    const layout = layoutText('aaaaaaaaaa bb', makeStyle(), { measurer: mono, maxWidth: 30 });
    expect(layout.lines.map((l) => l.text)).toEqual(['aaaaaaaaaa', 'bb']);
    expect(layout.lines[0].width).toBe(50);
    expect(layout.width).toBe(30);
  });

  test('no wrap happens when every word fits', () => {
    const layout = layoutText('aa bb', makeStyle(), { measurer: mono, maxWidth: 100 });
    expect(layout.lines.map((l) => l.text)).toEqual(['aa bb']);
  });
});

describe('resize re-wraps to the box width', () => {
  // The render lays a text object out with maxWidth = its box width, and the
  // box is placed shrink-wrapped to the content (measureTextBbox, no maxWidth).
  // So un-resized text must stay a single line, and narrowing the box must wrap.
  const content = 'aaa aaa aaa';
  const style = makeStyle();
  const opts = { measurer: mono };

  test('re-laying out at the shrink-wrapped width does not spuriously wrap', () => {
    const { width } = measureTextBbox(content, style, opts); // placement width
    const layout = layoutText(content, style, { ...opts, maxWidth: width });
    expect(layout.lines.map((l) => l.text)).toEqual([content]);
  });

  test('narrowing the box below the content width wraps to fit', () => {
    const { width } = measureTextBbox(content, style, opts);
    const layout = layoutText(content, style, { ...opts, maxWidth: width - 1 });
    expect(layout.lines.length).toBeGreaterThan(1);
    for (const line of layout.lines) expect(line.width).toBeLessThanOrEqual(width - 1);
  });
});

describe('alignment', () => {
  // Two lines: widths 20 and 10 (refWidth = 20 without maxWidth).
  const content = 'aaaa\naa';

  test('left (default): x = 0 on every line', () => {
    const layout = layoutText(content, makeStyle(), { measurer: mono });
    expect(layout.lines.map((l) => l.x)).toEqual([0, 0]);
    const explicit = layoutText(content, makeStyle({ align: 'left' }), { measurer: mono });
    expect(explicit.lines.map((l) => l.x)).toEqual([0, 0]);
  });

  test('center: x = (refWidth - width) / 2', () => {
    const layout = layoutText(content, makeStyle({ align: 'center' }), { measurer: mono });
    expect(layout.lines.map((l) => l.x)).toEqual([0, 5]);
  });

  test('right: x = refWidth - width', () => {
    const layout = layoutText(content, makeStyle({ align: 'right' }), { measurer: mono });
    expect(layout.lines.map((l) => l.x)).toEqual([0, 10]);
  });

  test('alignment is relative to maxWidth when wrapping', () => {
    const layout = layoutText('aaaa', makeStyle({ align: 'center' }), { measurer: mono, maxWidth: 40 });
    // Line width 20, refWidth 40 → x = 10.
    expect(layout.lines[0].x).toBe(10);
  });
});

describe('vertical alignment', () => {
  // Three lines at size 10, default line height 1.2 → block height 36.
  const content = 'a\nb\nc';

  test('no maxHeight: block stays top-anchored (y from 0) regardless of vAlign', () => {
    const layout = layoutText(content, makeStyle({ vAlign: 'bottom' }), { measurer: mono });
    expect(layout.lines.map((l) => l.y)).toEqual([0, 12, 24]);
    expect(layout.height).toBe(36);
  });

  test("top (default): no offset even when the box is taller", () => {
    const layout = layoutText(content, makeStyle(), { measurer: mono, maxHeight: 100 });
    expect(layout.lines.map((l) => l.y)).toEqual([0, 12, 24]);
  });

  test('middle: block centered in the box by half the slack', () => {
    // slack = 100 - 36 = 64 → offset 32.
    const layout = layoutText(content, makeStyle({ vAlign: 'middle' }), { measurer: mono, maxHeight: 100 });
    expect(layout.lines.map((l) => l.y)).toEqual([32, 44, 56]);
  });

  test('bottom: block pushed to the box floor by the full slack', () => {
    // slack = 100 - 36 = 64.
    const layout = layoutText(content, makeStyle({ vAlign: 'bottom' }), { measurer: mono, maxHeight: 100 });
    expect(layout.lines.map((l) => l.y)).toEqual([64, 76, 88]);
  });

  test('reported height is the block height, not the box height', () => {
    const layout = layoutText(content, makeStyle({ vAlign: 'middle' }), { measurer: mono, maxHeight: 100 });
    expect(layout.height).toBe(36);
  });

  test('a box shorter than the block yields a negative offset (overflow up)', () => {
    // slack = 20 - 36 = -16 → bottom offset -16.
    const layout = layoutText(content, makeStyle({ vAlign: 'bottom' }), { measurer: mono, maxHeight: 20 });
    expect(layout.lines.map((l) => l.y)).toEqual([-16, -4, 8]);
  });
});

describe('letterSpacing and lineHeight math', () => {
  test('letterSpacing adds size * spacing per inter-character gap', () => {
    // 4 chars: em = 2.0, spacing = 0.1 * 3 = 0.3 → (2.3) * 10 = 23.
    const layout = layoutText('aaaa', makeStyle({ letterSpacing: 0.1 }), { measurer: mono });
    expect(layout.lines[0].width).toBeCloseTo(23, 10);
  });

  test('letterSpacing does not apply to a single character', () => {
    const layout = layoutText('a', makeStyle({ letterSpacing: 0.5 }), { measurer: mono });
    expect(layout.lines[0].width).toBeCloseTo(5, 10);
  });

  test('line y offsets and height use size * lineHeight', () => {
    const layout = layoutText('a\nb\nc', makeStyle({ lineHeight: 1.5 }), { measurer: mono });
    expect(layout.lines.map((l) => l.y)).toEqual([0, 15, 30]);
    expect(layout.height).toBe(45);
  });

  test('default line height is 1.2', () => {
    expect(DEFAULT_LINE_HEIGHT).toBe(1.2);
    const layout = layoutText('a\nb', makeStyle(), { measurer: mono });
    expect(layout.lines[1].y).toBeCloseTo(12, 10);
    expect(layout.height).toBeCloseTo(24, 10);
  });

  test('widths scale with style.size', () => {
    const layout = layoutText('aaaa', makeStyle({ size: 3 }), { measurer: mono });
    expect(layout.lines[0].width).toBeCloseTo(6, 10);
  });
});

describe('defaultMeasurer', () => {
  test('narrow, wide, space, and default advances', () => {
    expect(defaultMeasurer.advance('i', makeStyle())).toBe(0.35);
    expect(defaultMeasurer.advance('W', makeStyle())).toBe(0.9);
    expect(defaultMeasurer.advance(' ', makeStyle())).toBe(0.33);
    expect(defaultMeasurer.advance('a', makeStyle())).toBe(0.6);
  });

  test('is the fallback when no measurer is injected', () => {
    // 'mi' = 0.9 + 0.35 = 1.25 em → 12.5 at size 10.
    const layout = layoutText('mi', makeStyle());
    expect(layout.lines[0].width).toBeCloseTo(12.5, 10);
  });
});

describe('lineAdvance', () => {
  test('replaces the per-char sum when present', () => {
    // Per-char would give 3 * 0.5 = 1.5 em; lineAdvance reports 2 em.
    const shaped: TextMeasurer = { advance: () => 0.5, lineAdvance: () => 2 };
    const layout = layoutText('abc', makeStyle(), { measurer: shaped });
    expect(layout.lines[0].width).toBeCloseTo(20, 10);
  });

  test('letterSpacing still adds on top of the whole-line advance', () => {
    // 4 chars: lineAdvance 2 em + 0.1 * 3 spacing = 2.3 em → 23 at size 10.
    const shaped: TextMeasurer = { advance: () => 0.5, lineAdvance: () => 2 };
    const layout = layoutText('aaaa', makeStyle({ letterSpacing: 0.1 }), { measurer: shaped });
    expect(layout.lines[0].width).toBeCloseTo(23, 10);
  });
});

describe('registerTextMeasurer', () => {
  afterEach(() => registerTextMeasurer(null));

  test('a registered measurer becomes the no-opts default', () => {
    registerTextMeasurer(mono);
    const layout = layoutText('mi', makeStyle());
    // mono, not defaultMeasurer: 2 * 0.5 em → 10 at size 10.
    expect(layout.lines[0].width).toBeCloseTo(10, 10);
  });

  test('an explicit opts.measurer still wins over the registered one', () => {
    registerTextMeasurer({ advance: () => 99 });
    const layout = layoutText('mi', makeStyle(), { measurer: mono });
    expect(layout.lines[0].width).toBeCloseTo(10, 10);
  });

  test('null restores the deterministic default', () => {
    registerTextMeasurer(mono);
    registerTextMeasurer(null);
    const layout = layoutText('mi', makeStyle());
    expect(layout.lines[0].width).toBeCloseTo(12.5, 10);
  });
});

describe('measureTextBbox', () => {
  test('matches layoutText extent without wrapping', () => {
    const layout = layoutText('aaaa\naa', makeStyle(), { measurer: mono });
    const bbox = measureTextBbox('aaaa\naa', makeStyle(), { measurer: mono });
    expect(bbox).toEqual({ width: layout.width, height: layout.height });
  });

  test('matches layoutText extent with wrapping', () => {
    const opts = { measurer: mono, maxWidth: 40 };
    const layout = layoutText('aaa aaa aaa', makeStyle(), opts);
    const bbox = measureTextBbox('aaa aaa aaa', makeStyle(), opts);
    expect(bbox).toEqual({ width: layout.width, height: layout.height });
  });
});
