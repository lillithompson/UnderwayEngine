/**
 * Deterministic text layout in world cell units (L0 cells — `TextStyle.size`
 * is a world-unit font size, so layout output is directly comparable to
 * node bboxes). Pure and injectable: metrics come from a `TextMeasurer`,
 * with a deterministic approximation as the default so layout is exact in
 * node tests. Apps inject a canvas-based measurer for real font metrics.
 */

import { RGBColor, TextStyle } from './types';

export interface TextMeasurer {
  /** Advance width of a single character in em units (multiples of
   *  `style.size`), excluding letter spacing. */
  advance(ch: string, style: TextStyle): number;
  /** Optional whole-string advance in em units, excluding letter spacing.
   *  When present it replaces the per-char sum in `measureLine`, letting a
   *  real-font measurer report shaped (kerned) widths that per-char
   *  advances can't capture. */
  lineAdvance?(text: string, style: TextStyle): number;
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

// App-registered measurer, used whenever a call doesn't pass its own. ONE
// slot on purpose: bbox measurement (editor session builders), canvas layout
// (node render), and SVG export all call layoutText, and they must agree on
// metrics or exported line breaks drift from the editor's. Registering here
// switches all of them at once. Engine tests never register, so layout stays
// deterministic under the approximation above.
let registeredMeasurer: TextMeasurer = defaultMeasurer;

/** Install the app's font-metric measurer (e.g. a canvas-based one keyed to
 *  the registered font pack); `null` restores the deterministic default. */
export function registerTextMeasurer(measurer: TextMeasurer | null): void {
  registeredMeasurer = measurer ?? defaultMeasurer;
}

export interface TextLayoutLine {
  text: string;
  /** Line width in world units. */
  width: number;
  /** Left offset from the layout origin, honoring `style.align`. */
  x: number;
  /** TOP offset of the line from the layout top. */
  y: number;
  /** Code-point index into the source content where this line begins (the
   *  `Array.from` walk). Each break consumes exactly one source character —
   *  the '\n' or the breaking space — so per-character annotations keyed to
   *  the content (e.g. `TextStyle.charColors`) can be mapped onto lines. */
  start: number;
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

/**
 * Relative slack on the wrap test: a line may exceed `maxWidth` by this
 * fraction and still count as fitting.
 *
 * A text box shrink-wrapped to its own content lands EXACTLY on the wrap
 * threshold, so `width <= maxWidth` becomes a coin flip decided by bits that
 * nothing guarantees:
 *  - `cellWidth` persists as a float32 (compositionBinaryFormat's v44+ text
 *    bbox), and that round-trip rounds the authored width DOWN as often as up
 *    — a ~1e-7 shortfall that flips one line into two on reload;
 *  - the `TextMeasurer` is the host's text engine, and the same string in the
 *    same face measures a hair differently across them (Blink/Skia on desktop
 *    web vs. WebKit/CoreText inside the iOS WebView), so a tile authored on
 *    one wraps on the other.
 * Both are sub-0.1% effects, so one relative epsilon absorbs them. It is
 * deliberately far below a real "this word doesn't fit" margin (a wrap the
 * author intended is a whole word wide), and the visual cost when it does
 * apply is the last glyph overhanging its box by a fraction of a percent.
 */
export const WRAP_EPSILON = 1e-3;

/** Width of a string in world units: sum of per-char advances times size,
 *  plus `size * letterSpacing` per inter-character gap. */
function measureLine(text: string, style: TextStyle, measurer: TextMeasurer): number {
  const chars = Array.from(text);
  if (chars.length === 0) return 0;
  const em = measurer.lineAdvance
    ? measurer.lineAdvance(text, style)
    : chars.reduce((sum, ch) => sum + measurer.advance(ch, style), 0);
  const spacing = (style.letterSpacing ?? 0) * (chars.length - 1);
  return (em + spacing) * style.size;
}

/** Greedy word wrap of one explicit line. Breaks at spaces (the breaking
 *  space is consumed); a single word wider than maxWidth overflows on its
 *  own line rather than being split. The fit test carries `WRAP_EPSILON` of
 *  relative slack so a box shrink-wrapped to its own text doesn't wrap on the
 *  last bit of a float32 bbox or a foreign text engine's metrics. */
function wrapLine(text: string, style: TextStyle, measurer: TextMeasurer, maxWidth: number): string[] {
  const words = text.split(' ');
  const out: string[] = [];
  const limit = maxWidth * (1 + WRAP_EPSILON);
  let current = '';
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (current.length === 0 || measureLine(candidate, style, measurer) <= limit) {
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
/**
 * The box a node's CONTENT is laid out and drawn in, in cells.
 *
 * A quarter turn swaps a node's WORLD box — `rotate90CW` records the turned
 * rectangle as `cellWidth`/`cellHeight`, because that is the space the node
 * now occupies on the page — but the content inside is still drawn in the
 * un-turned box and then rotated into place. A wide word magnet stood on end
 * has a world box 2 wide and 8 tall, and a card and a line of type that are
 * still 8 by 2.
 *
 * Both renderers ask for this box, which is the point: the canvas laid its
 * sticker card out in it while handing the TEXT the world box instead, so a
 * turned magnet drew its words wrapped to the card's short side and offset
 * from the card they belong to. One answer, one place.
 */
export function contentBoxCells(node: {
  cellWidth: number;
  cellHeight: number;
  rotation?: 0 | 90 | 180 | 270;
}): { width: number; height: number } {
  return node.rotation === 90 || node.rotation === 270
    ? { width: node.cellHeight, height: node.cellWidth }
    : { width: node.cellWidth, height: node.cellHeight };
}

export function layoutText(content: string, style: TextStyle, opts?: TextLayoutOptions): TextLayout {
  const measurer = opts?.measurer ?? registeredMeasurer;
  const maxWidth = opts?.maxWidth;

  // Each line's start index in code points. Every break consumes exactly one
  // source character (the '\n', or the one breaking space wrapLine eats), so
  // successive starts advance by the previous line's length + 1.
  const texts: string[] = [];
  const starts: number[] = [];
  let cursor = 0;
  for (const paragraph of content.split('\n')) {
    const pieces = maxWidth !== undefined && paragraph.length > 0
      ? wrapLine(paragraph, style, measurer, maxWidth)
      : [paragraph];
    for (const piece of pieces) {
      texts.push(piece);
      starts.push(cursor);
      cursor += Array.from(piece).length + 1;
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
    return { text, width, x, y: i * lineHeight + offsetY, start: starts[i] };
  });

  return { lines, width: refWidth, height: blockHeight };
}

export interface CharBox {
  /** Left edge from the line's own origin (add `line.x`), world units. */
  x: number;
  /** Advance width of the character, world units (letter spacing excluded —
   *  the inter-character gap sits after the advance). */
  width: number;
}

/**
 * Per-character x offsets of one laid-out line, world units, from per-char
 * advances plus letter spacing per gap — the same sum `measureLine` uses when
 * no `lineAdvance` is registered. A kerning-aware `lineAdvance` can make the
 * whole line a touch narrower than this sum; the drift is shaping-level noise,
 * fine for hit-testing and per-character paint, not for line breaking (which
 * stays on `measureLine`).
 */
export function lineCharBoxes(text: string, style: TextStyle, measurer?: TextMeasurer): CharBox[] {
  const m = measurer ?? registeredMeasurer;
  const spacing = (style.letterSpacing ?? 0) * style.size;
  const out: CharBox[] = [];
  let x = 0;
  for (const ch of Array.from(text)) {
    const width = m.advance(ch, style) * style.size;
    out.push({ x, width });
    x += width + spacing;
  }
  return out;
}

export interface CharColorRun {
  text: string;
  /** Override color for the run, or null to inherit the base font color. */
  color: RGBColor | null;
}

/**
 * Split one laid-out line into runs of consecutive characters sharing the
 * same `charColors` override (null = inherit `style.color`). `start` is the
 * line's code-point offset into the content (`TextLayoutLine.start`). The
 * single splitting rule for every renderer of brush-colored text — DOM spans
 * and SVG tspans must break identically or their kerning boundaries drift.
 */
export function charColorRuns(
  text: string,
  start: number,
  charColors: ReadonlyArray<RGBColor | null | undefined> | undefined,
): CharColorRun[] {
  const chars = Array.from(text);
  if (chars.length === 0) return [];
  const colorAt = (i: number): RGBColor | null => charColors?.[start + i] ?? null;
  const runs: CharColorRun[] = [];
  let runStart = 0;
  let runColor = colorAt(0);
  for (let i = 1; i <= chars.length; i++) {
    const color = i < chars.length ? colorAt(i) : null;
    const boundary = i === chars.length
      || (color === null) !== (runColor === null)
      || (color !== null && runColor !== null
        && (color.r !== runColor.r || color.g !== runColor.g || color.b !== runColor.b));
    if (boundary) {
      runs.push({ text: chars.slice(runStart, i).join(''), color: runColor });
      runStart = i;
      runColor = color;
    }
  }
  return runs;
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
