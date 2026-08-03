/**
 * Deterministic text layout in world cell units (L0 cells — `TextStyle.size`
 * is a world-unit font size, so layout output is directly comparable to
 * node bboxes). Pure and injectable: metrics come from a `TextMeasurer`,
 * with a deterministic approximation as the default so layout is exact in
 * node tests. Apps inject a canvas-based measurer for real font metrics.
 */

import { TextStyle } from './types';

export interface TextMeasurer {
  /** Advance width of a single character in em units (multiples of
   *  `style.size`), excluding letter spacing. */
  advance(ch: string, style: TextStyle): number;
}

const NARROW_CHARS = new Set(['i', 'l', 'j', 't', '.', ',', ':', ';', '!', "'", '|']);
const WIDE_CHARS = new Set(['m', 'w', 'M', 'W']);

/** Deterministic width approximation: 0.6 em default, 0.35 em for narrow
 *  glyphs, 0.9 em for wide glyphs, 0.33 em for the space. */
export const defaultMeasurer: TextMeasurer = {
  advance(ch: string): number {
    if (ch === ' ') return 0.33;
    if (NARROW_CHARS.has(ch)) return 0.35;
    if (WIDE_CHARS.has(ch)) return 0.9;
    return 0.6;
  },
};

export interface TextLayoutLine {
  text: string;
  /** Line width in world units. */
  width: number;
  /** Left offset from the layout origin, honoring `style.align`. */
  x: number;
  /** TOP offset of the line from the layout top. */
  y: number;
}

export interface TextLayout {
  lines: TextLayoutLine[];
  /** `maxWidth` when wrapping was requested, else the widest line. */
  width: number;
  height: number;
}

export interface TextLayoutOptions {
  maxWidth?: number;
  /** Box height (world units) the block is vertically aligned within. When
   *  given and `style.vAlign` is 'middle'/'bottom', every line's `y` is
   *  shifted so the block sits centered / bottom-anchored in the box. Omit (or
   *  'top') leaves lines top-anchored (the original behavior). */
  maxHeight?: number;
  measurer?: TextMeasurer;
}

/** Default line height multiple when `style.lineHeight` is unset. */
export const DEFAULT_LINE_HEIGHT = 1.2;

/** Width of a string in world units: sum of per-char advances times size,
 *  plus `size * letterSpacing` per inter-character gap. */
function measureLine(text: string, style: TextStyle, measurer: TextMeasurer): number {
  const chars = Array.from(text);
  if (chars.length === 0) return 0;
  let em = 0;
  for (const ch of chars) em += measurer.advance(ch, style);
  const spacing = (style.letterSpacing ?? 0) * (chars.length - 1);
  return (em + spacing) * style.size;
}

/** Greedy word wrap of one explicit line. Breaks at spaces (the breaking
 *  space is consumed); a single word wider than maxWidth overflows on its
 *  own line rather than being split. */
function wrapLine(text: string, style: TextStyle, measurer: TextMeasurer, maxWidth: number): string[] {
  const words = text.split(' ');
  const out: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (current.length === 0 || measureLine(candidate, style, measurer) <= maxWidth) {
      current = candidate;
    } else {
      out.push(current);
      current = word;
    }
  }
  out.push(current);
  return out;
}

/**
 * Lay out `content` under `style`. Explicit '\n' always breaks; word wrap
 * applies when `opts.maxWidth` is given. Line `x` honors `style.align`
 * ('left' default) relative to `maxWidth` when wrapping, else the widest
 * line; `y` is each line's top offset.
 */
export function layoutText(content: string, style: TextStyle, opts?: TextLayoutOptions): TextLayout {
  const measurer = opts?.measurer ?? defaultMeasurer;
  const maxWidth = opts?.maxWidth;

  const texts: string[] = [];
  for (const paragraph of content.split('\n')) {
    if (maxWidth !== undefined && paragraph.length > 0) {
      texts.push(...wrapLine(paragraph, style, measurer, maxWidth));
    } else {
      texts.push(paragraph);
    }
  }

  const widths = texts.map(t => measureLine(t, style, measurer));
  const refWidth = maxWidth ?? Math.max(0, ...widths);
  const align = style.align ?? 'left';
  const lineHeight = style.size * (style.lineHeight ?? DEFAULT_LINE_HEIGHT);
  const blockHeight = texts.length * lineHeight;

  // Vertical offset within the box: 'top' (and no maxHeight) leaves the block
  // at the top; 'middle'/'bottom' shift it by the slack under the box height.
  const vAlign = style.vAlign ?? 'top';
  const offsetY = opts?.maxHeight === undefined || vAlign === 'top' ? 0
    : vAlign === 'middle' ? (opts.maxHeight - blockHeight) / 2
    : opts.maxHeight - blockHeight;

  const lines: TextLayoutLine[] = texts.map((text, i) => {
    const width = widths[i];
    const x = align === 'left' ? 0
      : align === 'center' ? (refWidth - width) / 2
      : refWidth - width;
    return { text, width, x, y: i * lineHeight + offsetY };
  });

  return { lines, width: refWidth, height: blockHeight };
}

/** Convenience: just the layout extent. */
export function measureTextBbox(
  content: string,
  style: TextStyle,
  opts?: TextLayoutOptions,
): { width: number; height: number } {
  const layout = layoutText(content, style, opts);
  return { width: layout.width, height: layout.height };
}
