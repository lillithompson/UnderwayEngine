/**
 * drawnTextLayout is the ONE layout of a text node — what the DOM node
 * layer draws, what the color brush tests characters against, and what the
 * stroke preview recolours. This pins that it is layoutText over the node's
 * local box and that the three consumers read it rather than laying the
 * node out again on their own.
 */

import { drawnTextLayout } from '../textNodeLayout';
import { drawnLeafOf, drawnLocalBox } from '../drawnPose';
import { DEFAULT_LINE_HEIGHT, layoutText } from '@/engine/textLayout';
import { TextObject } from '@/engine/types';

const text = (extras: Partial<TextObject> = {}): TextObject => ({
  id: 'txt_1',
  content: 'hello there journal',
  style: { fontId: 'system', size: 2, color: { r: 0, g: 0, b: 0 } },
  cellX: 3, cellY: 5, cellWidth: 6, cellHeight: 8,
  ...extras,
});

describe('drawnTextLayout', () => {
  it('is layoutText over the LOCAL box, wrapped to its width and aligned in its height', () => {
    const t = text();
    const d = drawnLeafOf('text', t);
    const box = drawnLocalBox(d.node);
    const { layout, lineHeight } = drawnTextLayout(d);
    expect(layout).toEqual(layoutText(t.content, t.style, { maxWidth: box.width, maxHeight: box.height }));
    expect(layout.lines.length).toBeGreaterThan(1); // 6 cells wide: it wrapped
    expect(lineHeight).toBe(2 * DEFAULT_LINE_HEIGHT);
  });

  it("takes the style's own line height", () => {
    const d = drawnLeafOf('text', text({ style: { fontId: 'system', size: 3, color: { r: 0, g: 0, b: 0 }, lineHeight: 1.5 } }));
    expect(drawnTextLayout(d).lineHeight).toBe(4.5);
  });

  it('hands back the node content it laid out', () => {
    const t = text();
    expect(drawnTextLayout(drawnLeafOf('text', t)).text).toBe(t);
  });
});
