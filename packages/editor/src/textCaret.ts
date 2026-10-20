/**
 * In-canvas caret math for native text editing: on the native shell the
 * text-edit textarea is invisible (the on-canvas text object IS the input
 * box, iOS-Photos style), so the caret must be drawn on the node itself.
 * This module maps the textarea's UTF-16 selection index onto the node's
 * laid-out lines — the same layoutText / lineCharBoxes calls the node layer
 * and the paint brush position glyphs with, so the caret lands exactly
 * between the glyphs the user sees.
 *
 * Pure and node-testable; TextNodeLayer draws the returned box.
 */

import { TextObject } from '@/engine/types';
import { DEFAULT_LINE_HEIGHT, layoutText, lineCharBoxes } from '@/engine/textLayout';
import { DrawnLeaf, drawnLocalBox } from './drawnPose';
import { bboxLocalFrame } from './paintBrush';

/** Caret geometry in the node's inner layout space, world-cell units. */
export interface TextCaretBox {
  x: number;
  y: number;
  height: number;
}

/** One line's worth of a SELECTION, in the same space — a band the node
 *  layer paints behind the glyphs it covers. A range spanning wrapped
 *  lines is several of these, one per line. */
export interface TextSelectionBox extends TextCaretBox {
  width: number;
}

/** UTF-16 selection index (what `textarea.selectionStart` reports) → code
 *  point index (what layoutText's line `start`s count). An index landing
 *  inside a surrogate pair resolves to the pair's code point. */
export function caretCodePoint(content: string, selectionUtf16: number): number {
  let cp = 0;
  let u = 0;
  for (const ch of content) {
    if (u >= selectionUtf16) break;
    u += ch.length;
    cp += 1;
  }
  return cp;
}

/**
 * Where the caret sits for code-point index `caretCp` into `text.content`,
 * laid out exactly as the node renders (wrapped to its box, aligned by its
 * style). A caret at a wrap boundary lands at the START of the later line —
 * where the next typed glyph will appear. Content the caret index overruns
 * (a stale index during a fast delete) clamps to the end.
 */
export function textCaretBox(drawn: DrawnLeaf, caretCp: number): TextCaretBox {
  const text = drawn.node.content as TextObject;
  const box = drawnLocalBox(drawn.node);
  const style = text.style;
  // The node's LOCAL box with its CONTENT style — the layout the node layer
  // draws (TextNodeLayer), whatever the matrix then does to the whole.
  const layout = layoutText(text.content, style, {
    maxWidth: box.width,
    maxHeight: box.height,
  });
  const lineHeight = style.size * (style.lineHeight ?? DEFAULT_LINE_HEIGHT);
  const lines = layout.lines;
  if (lines.length === 0) return { x: 0, y: 0, height: lineHeight };
  let li = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].start <= caretCp) li = i;
  }
  const line = lines[li];
  const glyphCount = Array.from(line.text).length;
  const idx = Math.max(0, Math.min(glyphCount, caretCp - line.start));
  if (idx >= glyphCount) {
    return { x: line.x + line.width, y: line.y, height: lineHeight };
  }
  const boxes = lineCharBoxes(line.text, style);
  return { x: line.x + boxes[idx].x, y: line.y, height: lineHeight };
}

/**
 * The bands a selection from `startCp` to `endCp` covers, one per laid-out
 * line, in the node's inner layout space.
 *
 * On the native shell the textarea is invisible, so a selection made there
 * — the double tap's select-all, an arrow-key shift — has nothing to show
 * for itself: the next keystroke simply replaced a line the reader had no
 * sign was chosen. These are what the node layer paints behind the glyphs
 * so a selection is something you can SEE, the way it is in every other
 * text field.
 *
 * Empty for an empty range (that is a caret, and {@link textCaretBox}
 * draws it) and for a text with no laid-out lines. The ends are taken in
 * either order, so a backwards drag selects what it covers.
 */
export function textSelectionBoxes(
  drawn: DrawnLeaf, startCp: number, endCp: number,
): TextSelectionBox[] {
  const from = Math.min(startCp, endCp);
  const to = Math.max(startCp, endCp);
  if (to <= from) return [];
  const text = drawn.node.content as TextObject;
  const box = drawnLocalBox(drawn.node);
  const style = text.style;
  const layout = layoutText(text.content, style, { maxWidth: box.width, maxHeight: box.height });
  const lineHeight = style.size * (style.lineHeight ?? DEFAULT_LINE_HEIGHT);
  const out: TextSelectionBox[] = [];
  for (const line of layout.lines) {
    const glyphs = Array.from(line.text);
    const lineEnd = line.start + glyphs.length;
    // Lines the range misses entirely. A wrap boundary counts as covered
    // only when the range reaches INTO the line, so selecting up to a
    // break does not paint a band on the line after it.
    if (lineEnd <= from || line.start >= to) continue;
    const a = Math.max(0, from - line.start);
    const b = Math.min(glyphs.length, to - line.start);
    if (b <= a) continue;
    const boxes = lineCharBoxes(line.text, style);
    const x = line.x + boxes[a].x;
    // The far edge is the START of the glyph after the last one covered —
    // the line's own end where the range runs past it, which is what makes
    // a trailing space read as selected rather than the band stopping
    // short of the caret that shares its place.
    const right = b >= glyphs.length ? line.x + line.width : line.x + boxes[b].x;
    if (right > x) out.push({ x, y: line.y, width: right - x, height: lineHeight });
  }
  return out;
}

/** Code-point index → UTF-16 selection index, the inverse of
 *  {@link caretCodePoint} — what has to be handed back to the textarea. */
export function caretUtf16(content: string, caretCp: number): number {
  let cp = 0;
  let u = 0;
  for (const ch of content) {
    if (cp >= caretCp) break;
    u += ch.length;
    cp += 1;
  }
  return u;
}

/**
 * Where a TAP inside a text node puts the caret, as a UTF-16 selection index
 * — the inverse of {@link textCaretBox}, and what makes tapping into the text
 * you are already editing move the cursor instead of restarting the edit.
 *
 * `cellX`/`cellY` are world cells; the node's world matrix (turn, flip,
 * scale, a group's shear) is undone with the same shared frame the paint
 * brush tests characters in, so a tap lands where the glyph looks like it is.
 *
 * The caret goes to the NEARER edge of the glyph tapped — tapping the right
 * half of a letter puts it after that letter — which is what every text field
 * does and what makes tapping "just past the last word" reach the end. A tap
 * above or below the block clamps to the first or last line.
 */
export function caretUtf16AtPoint(drawn: DrawnLeaf, cellX: number, cellY: number): number {
  const text = drawn.node.content as TextObject;
  const box = drawnLocalBox(drawn.node);
  const style = text.style;
  const layout = layoutText(text.content, style, {
    maxWidth: box.width,
    maxHeight: box.height,
  });
  const lines = layout.lines;
  if (lines.length === 0) return 0;
  const [lx, ly] = bboxLocalFrame(drawn).toLocal(cellX, cellY);
  const lineHeight = style.size * (style.lineHeight ?? DEFAULT_LINE_HEIGHT);
  // The line whose band holds the point, clamped to the block at both ends.
  let li = 0;
  for (let i = 0; i < lines.length; i++) {
    if (ly >= lines[i].y) li = i;
  }
  if (ly > lines[li].y + lineHeight && li < lines.length - 1) li = lines.length - 1;
  const line = lines[li];
  const glyphs = Array.from(line.text);
  const boxes = lineCharBoxes(line.text, style);
  // Walk to the first glyph whose midpoint the point has not passed; falling
  // off the end lands after the last glyph on the line.
  let idx = glyphs.length;
  for (let i = 0; i < boxes.length; i++) {
    if (lx < line.x + boxes[i].x + boxes[i].width / 2) { idx = i; break; }
  }
  return caretUtf16(text.content, line.start + idx);
}
