// Facet-ported toolbar glyph GEOMETRY, as data. A leaf module (no imports)
// because more than one renderer may draw from it: the shared toolbar
// renders these numbers as inline <svg> (./ToolIcons.tsx), and an app may
// draw the same glyph somewhere of its own — CozyJournal's native Home
// screen re-renders the Arc glyph out of bordered Views for its Facets
// card (react-native-svg not being a dependency there), and the card's
// icon must look IDENTICAL to the toolbar button it stands for. One set
// of numbers, however many renderers; `arcGlyphLayout` is the one the
// bordered-View renderer reads.

/** The Facet-ported glyphs fill their whole 256 box; beside the
 *  keyline-padded MCI buttons (the freehand pencil spans ~18 of the 24 grid
 *  units) full-bleed reads oversized. This scale shrinks the art about the
 *  box center onto the 18-unit Material square keyline. */
export const FACET_GLYPH_SCALE = 18 / 24;

/**
 * The Arc tool's glyph, in its native 256 box (Facet's ToolIcons art): two
 * endpoint squares joined by a quarter circle, every stroke centered on its
 * path. The arc is the TOP-RIGHT quadrant about `arcCenter` — it runs from
 * (cx, cy − r) up-left down to (cx + r, cy).
 */
export const ARC_GLYPH = {
  box: 256,
  square: 44,
  squareStroke: 20,
  squareA: { x: 10, y: 10 },
  squareB: { x: 202, y: 202 },
  arcCenter: { x: 52, y: 204 },
  arcRadius: 172,
  arcStroke: 27,
} as const;

export interface ArcGlyphLayout {
  /** Endpoint squares as OUTER boxes (the centered stroke reaches half a
   *  stroke outside the path), with the stroke width — a bordered View
   *  renders its border inside, so the outer box is what it lays out. */
  squares: { left: number; top: number; size: number; stroke: number }[];
  /** The quarter arc: center and PATH radius (stroke centered on it). */
  arc: { cx: number; cy: number; radius: number; stroke: number };
}

/**
 * The Arc glyph laid out in pixels for an icon of `size`, keyline fit
 * ({@link FACET_GLYPH_SCALE} about the box center) applied — the same
 * numbers the toolbar's <svg> produces via its group transform, so the two
 * renderings cannot drift.
 */
export function arcGlyphLayout(size: number): ArcGlyphLayout {
  const g = ARC_GLYPH;
  const s = (FACET_GLYPH_SCALE * size) / g.box;
  const off = (size * (1 - FACET_GLYPH_SCALE)) / 2;
  const at = (v: number) => off + v * s;
  const squareStroke = g.squareStroke * s;
  const square = (sq: { x: number; y: number }) => ({
    left: at(sq.x) - squareStroke / 2,
    top: at(sq.y) - squareStroke / 2,
    size: g.square * s + squareStroke,
    stroke: squareStroke,
  });
  return {
    squares: [square(g.squareA), square(g.squareB)],
    arc: {
      cx: at(g.arcCenter.x),
      cy: at(g.arcCenter.y),
      radius: g.arcRadius * s,
      stroke: g.arcStroke * s,
    },
  };
}
