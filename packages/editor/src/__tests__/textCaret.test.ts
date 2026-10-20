/**
 * In-canvas caret math (textCaret.ts): the UTF-16 → code-point conversion
 * (surrogate pairs) and the caret's landing spot on the node's laid-out
 * lines — start / middle / end of line, explicit line breaks, wrap
 * boundaries, empty content, and stale-index clamping.
 */

import { caretCodePoint, caretUtf16, caretUtf16AtPoint, textCaretBox, textSelectionBoxes } from '../textCaret';
import { drawnLeafOf } from '../drawnPose';
import { DEFAULT_LINE_HEIGHT, layoutText } from '@/engine/textLayout';
import { RGBColor, TextObject, TextStyle } from '@/engine/types';

const BLACK: RGBColor = { r: 0, g: 0, b: 0 };
const STYLE: TextStyle = { fontId: 'test', size: 2, color: BLACK };

/** A bare node as the graph draws it — the caret reads the drawn leaf. */
const D = (t: TextObject) => drawnLeafOf('text', t);

function text(content: string, extras: Partial<TextObject> = {}): TextObject {
  return {
    id: 'text_1',
    content,
    style: STYLE,
    cellX: 4, cellY: 4, cellWidth: 12, cellHeight: 8,
    ...extras,
  };
}

describe('caretCodePoint', () => {
  it('is the identity on plain ascii', () => {
    expect(caretCodePoint('hello', 0)).toBe(0);
    expect(caretCodePoint('hello', 3)).toBe(3);
    expect(caretCodePoint('hello', 5)).toBe(5);
  });

  it('counts a surrogate pair as one code point', () => {
    // '🙂' is two UTF-16 units.
    expect(caretCodePoint('a🙂b', 1)).toBe(1); // before the emoji
    expect(caretCodePoint('a🙂b', 3)).toBe(2); // after the emoji
    expect(caretCodePoint('a🙂b', 4)).toBe(3); // end
  });

  it('clamps an index past the end', () => {
    expect(caretCodePoint('ab', 99)).toBe(2);
  });
});

describe('textCaretBox', () => {
  it('sits at the line start for caret 0 and advances with the glyphs', () => {
    const node = text('hello');
    const line = layoutText(node.content, STYLE, {
      maxWidth: node.cellWidth, maxHeight: node.cellHeight,
    }).lines[0];
    const at0 = textCaretBox(D(node), 0);
    expect(at0.x).toBeCloseTo(line.x);
    expect(at0.y).toBeCloseTo(line.y);
    expect(at0.height).toBeCloseTo(STYLE.size * DEFAULT_LINE_HEIGHT);
    const at2 = textCaretBox(D(node), 2);
    const at5 = textCaretBox(D(node), 5);
    expect(at2.x).toBeGreaterThan(at0.x);
    expect(at5.x).toBeGreaterThan(at2.x);
    // End of content: the line's full measured width.
    expect(at5.x).toBeCloseTo(line.x + line.width);
  });

  it('a caret just past a newline lands at the start of the next line', () => {
    const node = text('ab\ncd');
    const lines = layoutText(node.content, STYLE, {
      maxWidth: node.cellWidth, maxHeight: node.cellHeight,
    }).lines;
    expect(lines.length).toBe(2);
    // Code points: a(0) b(1) \n(2) c(3): caret 3 = before 'c'.
    const caret = textCaretBox(D(node), 3);
    expect(caret.x).toBeCloseTo(lines[1].x);
    expect(caret.y).toBeCloseTo(lines[1].y);
    expect(caret.y).toBeGreaterThan(textCaretBox(D(node), 0).y);
  });

  it('follows wrapping: a caret on the second wrapped line sits below the first', () => {
    // A narrow box forces the two words onto separate lines.
    const node = text('aaaa bbbb', { cellWidth: 5 });
    const lines = layoutText(node.content, STYLE, {
      maxWidth: node.cellWidth, maxHeight: node.cellHeight,
    }).lines;
    expect(lines.length).toBeGreaterThan(1);
    const onSecond = textCaretBox(D(node), lines[1].start);
    expect(onSecond.y).toBeCloseTo(lines[1].y);
    expect(onSecond.x).toBeCloseTo(lines[1].x);
  });

  it('handles empty content (the caret has a line to sit on)', () => {
    const node = text('');
    const caret = textCaretBox(D(node), 0);
    expect(Number.isFinite(caret.x)).toBe(true);
    expect(Number.isFinite(caret.y)).toBe(true);
    expect(caret.height).toBeCloseTo(STYLE.size * DEFAULT_LINE_HEIGHT);
  });

  it('clamps a stale index past the content end to the last position', () => {
    const node = text('hi');
    expect(textCaretBox(D(node), 99)).toEqual(textCaretBox(D(node), 2));
  });
});

// The inverse: a tap inside the text you are already editing moves the
// cursor there. Round-tripped against textCaretBox wherever possible, so the
// two can't drift — the caret has to land where the tap was.
describe('caretUtf16', () => {
  it('is the inverse of caretCodePoint across surrogate pairs', () => {
    for (const content of ['hello', 'a🙂b', '🙂🙂']) {
      const cps = Array.from(content).length;
      for (let cp = 0; cp <= cps; cp++) {
        expect(caretCodePoint(content, caretUtf16(content, cp))).toBe(cp);
      }
    }
  });

  it('clamps past the end', () => {
    expect(caretUtf16('ab', 99)).toBe(2);
  });
});

describe('caretUtf16AtPoint', () => {
  /** World-cell point for a caret box, which is in the node's layout space.
   *  The fixtures are unrotated, so the two differ by the node's origin. */
  const atCaret = (node: TextObject, cp: number, dx = 0.01) => {
    const box = textCaretBox(D(node), cp);
    return {
      x: node.cellX + box.x + dx,
      y: node.cellY + box.y + box.height / 2,
    };
  };

  it('lands on the glyph boundary the tap is nearest', () => {
    const node = text('hello');
    // Just past each caret position is that position — the tap has not yet
    // reached the midpoint of the glyph after it.
    for (let cp = 0; cp < 5; cp++) {
      const p = atCaret(node, cp);
      expect(caretUtf16AtPoint(D(node), p.x, p.y)).toBe(cp);
    }
  });

  it('puts the caret AFTER a glyph tapped on its right half', () => {
    const node = text('hello');
    const first = textCaretBox(D(node), 0);
    const second = textCaretBox(D(node), 1);
    const rightHalf = node.cellX + (first.x + second.x) / 2 + 0.05;
    expect(caretUtf16AtPoint(D(node), rightHalf, node.cellY + first.y + 0.5)).toBe(1);
  });

  it('a tap past the end of a line lands at the end of that line', () => {
    const node = text('hello');
    const end = textCaretBox(D(node), 5);
    expect(caretUtf16AtPoint(D(node), node.cellX + end.x + 4, node.cellY + end.y + 0.5)).toBe(5);
  });

  it('picks the line the tap is on, not always the first', () => {
    const node = text('ab\ncd');
    const second = textCaretBox(D(node), 3); // start of 'cd'
    expect(caretUtf16AtPoint(D(node), node.cellX + second.x + 0.01, node.cellY + second.y + 0.5))
      .toBe(3);
  });

  it('clamps above the block to the first line and below it to the last', () => {
    const node = text('ab\ncd');
    // Well above the text: the first line, at its start.
    expect(caretUtf16AtPoint(D(node), node.cellX, node.cellY - 50)).toBe(0);
    // Well below: the last line. 'cd' starts at code point 3, so a tap past
    // its right edge is 5 (the end of the content).
    expect(caretUtf16AtPoint(D(node), node.cellX + 50, node.cellY + 50)).toBe(5);
  });

  it('counts a surrogate pair as one glyph, in UTF-16 units', () => {
    const node = text('a🙂b');
    // Code point 2 is after the emoji — UTF-16 index 3.
    const box = textCaretBox(D(node), 2);
    expect(caretUtf16AtPoint(D(node), node.cellX + box.x + 0.01, node.cellY + box.y + 0.5)).toBe(3);
  });

  it('undoes the node’s own transform, so a tap lands where the glyph looks', () => {
    // Mirroring flips the glyphs about the box center without changing the
    // layout, so a tap near the LEFT edge of a mirrored node has to reach the
    // END of the text. Reading the point in layout space directly — the bug
    // this guards — would give the start instead.
    const node = text('hello', { mirrorH: true });
    const nearLeft = node.cellX + 0.2;
    const midLine = node.cellY + textCaretBox(D(node), 0).height / 2;
    expect(caretUtf16AtPoint(D(node), nearLeft, midLine)).toBe(5);
    // …and the right edge reaches the start, the same flip the other way.
    expect(caretUtf16AtPoint(D(node), node.cellX + node.cellWidth - 0.2, midLine)).toBe(0);
    // The unmirrored twin reads the opposite way round, which is the point.
    const upright = text('hello');
    expect(caretUtf16AtPoint(D(upright), nearLeft, midLine)).toBe(0);
  });

  it('is 0 on empty content', () => {
    expect(caretUtf16AtPoint(D(text('')), 0, 0)).toBe(0);
  });
});

describe('textSelectionBoxes — a range you can see', () => {
  // The textarea is invisible on native, so a selection made there has
  // nothing to show for itself: the next keystroke simply replaced a line
  // the reader had no sign was chosen. These are the bands the node layer
  // paints behind the glyphs.

  it('is nothing at all for a caret', () => {
    const node = text('hello');
    expect(textSelectionBoxes(D(node), 0, 0)).toEqual([]);
    expect(textSelectionBoxes(D(node), 3, 3)).toEqual([]);
  });

  it('covers exactly the glyphs between the two ends, on the caret’s own line', () => {
    const node = text('hello');
    const [band] = textSelectionBoxes(D(node), 1, 4);
    // Its edges ARE the carets at those indices — a selection and the
    // caret that starts it cannot disagree about where a glyph begins.
    expect(band.x).toBeCloseTo(textCaretBox(D(node), 1).x);
    expect(band.x + band.width).toBeCloseTo(textCaretBox(D(node), 4).x);
    expect(band.y).toBeCloseTo(textCaretBox(D(node), 1).y);
    expect(band.height).toBeCloseTo(STYLE.size * DEFAULT_LINE_HEIGHT);
  });

  it('takes its ends in either order, so a backwards drag selects what it covers', () => {
    const node = text('hello');
    expect(textSelectionBoxes(D(node), 4, 1)).toEqual(textSelectionBoxes(D(node), 1, 4));
  });

  it('runs to the line’s own end where the range passes it', () => {
    const node = text('hello');
    const [band] = textSelectionBoxes(D(node), 0, 5);
    const line = layoutText(node.content, STYLE, {
      maxWidth: node.cellWidth, maxHeight: node.cellHeight,
    }).lines[0];
    expect(band.x).toBeCloseTo(line.x);
    expect(band.width).toBeCloseTo(line.width);
  });

  it('is one band PER LINE across a break, each on its own line', () => {
    const node = text('ab\ncd');
    const bands = textSelectionBoxes(D(node), 0, 5);
    expect(bands).toHaveLength(2);
    expect(bands[0].y).toBeLessThan(bands[1].y);
    // Neither band reaches onto the other's line.
    expect(bands[0].y + bands[0].height).toBeLessThanOrEqual(bands[1].y + 1e-9);
  });

  it('does not paint a line the range merely stops at', () => {
    // Selecting up to a break covers the first line and nothing of the
    // second — a band on a line the range never entered would claim a
    // glyph is chosen when it is not.
    const node = text('ab\ncd');
    expect(textSelectionBoxes(D(node), 0, 2)).toHaveLength(1);
  });

  it('selects the whole of a wrapped text, which is what a double tap asks for', () => {
    // The gesture the bullet is about: every line covered, none missed.
    const node = text('one two three four five six seven', { cellWidth: 8 });
    const lines = layoutText(node.content, STYLE, {
      maxWidth: node.cellWidth, maxHeight: node.cellHeight,
    }).lines;
    expect(lines.length).toBeGreaterThan(1);
    const bands = textSelectionBoxes(D(node), 0, Array.from(node.content).length);
    expect(bands).toHaveLength(lines.length);
    for (let i = 0; i < lines.length; i++) expect(bands[i].y).toBeCloseTo(lines[i].y);
  });

  it('holds up across a surrogate pair, counted in code points like the caret', () => {
    const node = text('a🙂b');
    // The whole content: three code points, four UTF-16 units.
    const bands = textSelectionBoxes(D(node), 0, 3);
    expect(bands).toHaveLength(1);
    expect(bands[0].x).toBeCloseTo(textCaretBox(D(node), 0).x);
  });

  it('has nothing to paint on an empty text', () => {
    expect(textSelectionBoxes(D(text('')), 0, 0)).toEqual([]);
  });
});
