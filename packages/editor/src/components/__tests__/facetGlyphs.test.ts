import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ARC_GLYPH, FACET_GLYPH_SCALE, arcGlyphLayout } from '../facetGlyphs';

// The Arc glyph's geometry, as the shared toolbar's inline <svg> draws it
// (ToolIcons.ArcIcon). It is a leaf of its own because an app may draw the
// same glyph a second way — CozyJournal's Facets card re-renders it out of
// bordered Views through `arcGlyphLayout`, and pins that in its own tree —
// so the two pictures come from ONE set of numbers.

describe('the Arc glyph geometry', () => {
  it('is Facet’s original art: two 44-boxes joined by a 172-radius quarter circle', () => {
    // The numbers ported from Facet's ToolIcons path
    // (M52 32 C146.993 32 224 109.007 224 204 — a cubic approximating this
    // exact circle) and its two mirrored 44×44 endpoint rects.
    expect(ARC_GLYPH.box).toBe(256);
    expect(ARC_GLYPH.squareA).toEqual({ x: 10, y: 10 });
    expect(ARC_GLYPH.squareB).toEqual({ x: 202, y: 202 });
    expect(ARC_GLYPH.arcCenter).toEqual({ x: 52, y: 204 });
    expect(ARC_GLYPH.arcRadius).toBe(172);
    // The arc starts on the top square's edge and ends on the bottom one's:
    // (52, 32) sits on squareA's right flank, (224, 204) on squareB's top.
    expect(ARC_GLYPH.arcCenter.y - ARC_GLYPH.arcRadius).toBe(32);
    expect(ARC_GLYPH.arcCenter.x + ARC_GLYPH.arcRadius).toBe(224);
  });

  it('lays out with the keyline fit — the toolbar’s own group transform, in pixels', () => {
    // At size 256 the fit alone applies: p → 128 + (p − 128)·(18/24).
    const l = arcGlyphLayout(256);
    const fit = (v: number) => 128 + (v - 128) * FACET_GLYPH_SCALE;
    expect(l.arc.cx).toBeCloseTo(fit(52), 9);
    expect(l.arc.cy).toBeCloseTo(fit(204), 9);
    expect(l.arc.radius).toBeCloseTo(172 * FACET_GLYPH_SCALE, 9);
    expect(l.arc.stroke).toBeCloseTo(27 * FACET_GLYPH_SCALE, 9);
    // The squares come back as OUTER boxes (stroke straddles the path), the
    // frame a bordered View lays out with its border inside.
    const sw = 20 * FACET_GLYPH_SCALE;
    expect(l.squares[0].left).toBeCloseTo(fit(10) - sw / 2, 9);
    expect(l.squares[0].size).toBeCloseTo(44 * FACET_GLYPH_SCALE + sw, 9);
    expect(l.squares[0].stroke).toBeCloseTo(sw, 9);
    // …and everything scales linearly with the icon size.
    const half = arcGlyphLayout(128);
    expect(half.arc.cx).toBeCloseTo(l.arc.cx / 2, 9);
    expect(half.squares[1].left).toBeCloseTo(l.squares[1].left / 2, 9);
  });
});

describe('the toolbar draws from the leaf', () => {
  it('ArcIcon builds its rects and arc path from ARC_GLYPH', () => {
    const SRC = readFileSync(resolve(__dirname, '..', 'ToolIcons.tsx'), 'utf8');
    expect(SRC).toContain("import { ARC_GLYPH } from './facetGlyphs';");
    expect(SRC).toContain('} = ARC_GLYPH;');
    expect(SRC).toContain('x={squareA.x} y={squareA.y} width={square} height={square}');
    expect(SRC).toContain('A${arcRadius} ${arcRadius} 0 0 1');
    // The hardcoded cubic is gone — one geometry, no drift.
    expect(SRC).not.toContain('M52 32C146.993');
  });

  it('the keyline scale the toolbar re-exports is the leaf’s', () => {
    const META = readFileSync(resolve(__dirname, '..', 'toolbarMeta.ts'), 'utf8');
    expect(META).toContain("export { FACET_GLYPH_SCALE } from './facetGlyphs';");
    expect(FACET_GLYPH_SCALE).toBeCloseTo(18 / 24, 10);
  });
});
