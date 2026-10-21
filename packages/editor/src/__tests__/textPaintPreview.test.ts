/**
 * The color tool's live preview of brushwork on text draws the recoloured
 * characters IN the node, through the node layer's own ink pass — never as
 * separate glyphs placed a second time. Screens can't render in the node
 * test env, so this pins the source the way the other parity tests do,
 * and exercises the pure change-gate the preview re-renders on.
 *
 * Background: the preview used to be an SVG <text> per painted character
 * in the screen-space overlay — type set at the node's cell size inside a
 * camera-scaled group, at lineCharBoxes' summed advances, on a `central`
 * baseline. That is a second layout of the glyphs with its own advances,
 * and it ran ~7 px along the line from the DOM's by the second character
 * (text size 2, headless Chrome), so every brushed character sat beside
 * its own ink for the length of the drag and jumped back on the drop.
 *
 * What the CANVAS does with it — feeding the stroke's characters to the
 * node's paint host and clearing the previews with the rest of the overlay
 * — is pinned in each app's own tree, beside the canvas that still holds
 * it (docs/shared-editor.md §4.2 item 5).
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { sameCharColors } from '../textPaintPreview';
import { RGBColor } from '@/engine/types';

const src = (...parts: string[]) => readFileSync(resolve(__dirname, '..', ...parts), 'utf8');
const NODE_LAYER = src('components', 'NodeLayer.tsx');
const PREVIEW = src('textPaintPreview.tsx');

describe('the preview renders with the node layer’s own ink pass', () => {
  it('TextNodeLayer mounts a paint host inside its inner box, with no React children', () => {
    expect(NODE_LAYER).toContain(
      '<div data-paint-host="" style={{ position: \'absolute\', inset: 0, pointerEvents: \'none\' }} />',
    );
  });

  it('TextPaintPreviewInk is the ink pass over the shared layout, on a transparent base colour', () => {
    const ink = NODE_LAYER.slice(NODE_LAYER.indexOf('export function TextPaintPreviewInk'));
    const body = ink.slice(0, ink.indexOf('export const TextNodeLayer'));
    expect(body).toContain('drawnTextLayout(drawn)');
    expect(body).toContain('fadedTextStyle({ ...text.style, charColors })');
    expect(body).toContain('<TextInkPass');
    expect(body).toContain('color="transparent"');
    expect(body).toContain('charColors={style.charColors}');
    expect(body).toContain('alpha={style.alpha}');
  });

  it("…and TextNodeLayer's committed ink goes through the same TextInkPass", () => {
    const committed = NODE_LAYER.slice(NODE_LAYER.indexOf('export const TextNodeLayer'));
    expect(committed).toContain('<TextInkPass');
    expect(committed).toContain('color={textColorCss}');
    expect(committed).toContain('alpha={isSticker ? undefined : style.alpha}');
  });

  it('mounts one root per brushed text in its paint host and renders it synchronously', () => {
    expect(PREVIEW).toContain("import { createRoot, Root } from 'react-dom/client';");
    expect(PREVIEW).toContain("import { flushSync } from 'react-dom';");
    expect(PREVIEW).toContain('entry = { root: createRoot(host), colors };');
    expect(PREVIEW).toContain('root.render(<TextPaintPreviewInk drawn={drawn} charColors={colors} />);');
  });
});

describe('sameCharColors (the re-render gate)', () => {
  const red: RGBColor = { r: 255, g: 0, b: 0 };
  it('is true for equal colours by value, false for any difference', () => {
    expect(sameCharColors([null, red], [null, { r: 255, g: 0, b: 0 }])).toBe(true);
    expect(sameCharColors([null, red], [red, red])).toBe(false);
    expect(sameCharColors([red], [{ r: 254, g: 0, b: 0 }])).toBe(false);
    expect(sameCharColors([red], [red, null])).toBe(false);
    expect(sameCharColors([], [])).toBe(true);
  });
});
