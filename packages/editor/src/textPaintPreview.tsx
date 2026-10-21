/**
 * The color tool's live preview of brushwork on TEXT: the stroke's touched
 * characters, recoloured in place for the length of the drag.
 *
 * Each brushed text gets its own React root inside the node's paint host
 * (`[data-paint-host]`, TextNodeLayer), rendering TextPaintPreviewInk — the
 * node layer's own ink pass over the node's own layout, with a transparent
 * base colour and the stroke's colours per character. Drawing the preview
 * WITH the renderer that will draw the commit is what makes the drop
 * seamless: the same line boxes, the same font CSS, the same span breaks
 * (charColorRuns), and the node's own CSS transform carrying it, so there
 * is no second layout to disagree with the first. (The screen-space
 * overlay's SVG glyphs were one — see TextPaintPreviewInk.)
 *
 * Rendered synchronously (flushSync) from the stroke's pointer handler, and
 * only when a character's colour actually changed: a move that re-touches
 * what it already painted costs one array compare and no React work.
 * Cleared before the commit re-renders the node (clearPaintOverlay), the
 * way every in-node preview is.
 */

import { flushSync } from 'react-dom';
import { createRoot, Root } from 'react-dom/client';
import { RGBColor, TextObject } from '@/engine/types';
import { DrawnLeaf } from './drawnPose';
import { previewCharColors } from './paintBrush';
import { TextPaintPreviewInk } from './components/NodeLayer';

interface TextPaintPreviewEntry {
  root: Root;
  colors: (RGBColor | null)[];
}

/** Text id → its mounted preview. One per stroke; see clearTextPaintPreviews. */
export type TextPaintPreviews = Map<string, TextPaintPreviewEntry>;

export function createTextPaintPreviews(): TextPaintPreviews {
  return new Map();
}

const sameRGB = (a: RGBColor | null, b: RGBColor | null): boolean =>
  a === b || (!!a && !!b && a.r === b.r && a.g === b.g && a.b === b.b);

/** Whether two previews would draw the same thing. */
export function sameCharColors(a: readonly (RGBColor | null)[], b: readonly (RGBColor | null)[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!sameRGB(a[i], b[i])) return false;
  return true;
}

/**
 * Show `painted` (the stroke's per-character colours for this text, null =
 * the eraser's mark) on the node. Mounts the preview root on the text's
 * first hit; afterwards re-renders only when a colour changed. Returns
 * whether anything was (re)drawn.
 */
export function upsertTextPaintPreview(
  previews: TextPaintPreviews,
  host: Element,
  drawn: DrawnLeaf,
  painted: ReadonlyMap<number, RGBColor | null>,
): boolean {
  const text = drawn.node.content as TextObject;
  const colors = previewCharColors(text, painted);
  let entry = previews.get(text.id);
  if (entry && sameCharColors(entry.colors, colors)) return false;
  if (!entry) {
    entry = { root: createRoot(host), colors };
    previews.set(text.id, entry);
  } else {
    entry.colors = colors;
  }
  const root = entry.root;
  flushSync(() => {
    root.render(<TextPaintPreviewInk drawn={drawn} charColors={colors} />);
  });
  return true;
}

/** Take every preview down — before the commit re-renders the nodes, so
 *  nothing React owns is left carrying a stroke's colours. */
export function clearTextPaintPreviews(previews: TextPaintPreviews): void {
  for (const entry of previews.values()) entry.root.unmount();
  previews.clear();
}
