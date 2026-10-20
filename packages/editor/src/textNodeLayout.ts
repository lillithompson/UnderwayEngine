/**
 * A text node's laid-out lines: the ONE layout every renderer and
 * hit-tester of the node reads — the DOM node layer (TextNodeLayer), the
 * color brush's per-character boxes (textPaintGeometry) and the live
 * stroke preview that recolours them (textPaintPreview) — so the boxes
 * the brush tests, the glyphs the user sees and the glyphs the preview
 * recolours all come from the same layoutText call over the same box.
 *
 * Laid out in the node's LOCAL box with its CONTENT style: the un-turned,
 * unscaled box the type was authored in, whatever the matrix then does to
 * the whole. maxWidth word-wraps to the box, maxHeight vertically aligns
 * the block (style.vAlign) within it; each line's `y` already carries the
 * offset.
 */

import { TextObject } from '@/engine/types';
import { DEFAULT_LINE_HEIGHT, layoutText, TextLayout } from '@/engine/textLayout';
import { DrawnLeaf, drawnLocalBox } from './drawnPose';

export interface DrawnTextLayout {
  text: TextObject;
  layout: TextLayout;
  /** One line box's height, world cells. */
  lineHeight: number;
}

export function drawnTextLayout(drawn: DrawnLeaf): DrawnTextLayout {
  const text = drawn.node.content as TextObject;
  const box = drawnLocalBox(drawn.node);
  const style = text.style;
  const layout = layoutText(text.content, style, {
    maxWidth: box.width,
    maxHeight: box.height,
  });
  const lineHeight = style.size * (style.lineHeight ?? DEFAULT_LINE_HEIGHT);
  return { text, layout, lineHeight };
}
