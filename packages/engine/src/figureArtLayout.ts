/**
 * Where a figure's cached art sits inside the box it is placed in.
 *
 * A figure is the one leaf whose quarter turn is CONTENT rather than pose:
 * it says which way to lay the cached art into a box whose width and height
 * the same quarter has already swapped. That makes its layout four steps —
 * un-swap the box, scale the art into it uniformly, centre it, then turn and
 * flip it about the box's centre — and those four steps had grown three
 * copies: the exporter's markup (`buildFigureSVGContent`), the tiled variant
 * (`buildBlockSVGContent`, which shares the first two), and the bake to path
 * segments (`figureToPaths.convertCachedSVGToColoredSegments`). They were
 * kept in step by hand and by comments saying so. This is the one copy.
 *
 * Unit-agnostic: `unitsPerCell` scales the box out of L0 cells into whatever
 * space the caller emits in — SVG units for the builders, cells for the bake
 * — while the cached art's own dimensions are always in SVG units.
 */

/**
 * The art's own width and height for a box that a quarter turn has swapped.
 *
 * The cached SVG is always in its unrotated orientation, and the reducer
 * stores a quarter-turned figure's box post-turn, so 90°/270° have to be
 * undone before the art can be scaled into it.
 */
export function unswapQuarter(
  width: number, height: number, rotation: 0 | 90 | 180 | 270,
): [number, number] {
  return (rotation === 90 || rotation === 270) ? [height, width] : [width, height];
}

/**
 * The uniform scale that fits art of `svgWidth × svgHeight` into
 * `contentW × contentH` without skewing it.
 *
 * `min` of the two axes whenever they differ — a 5×3 figure placed in a 2×1
 * box letterboxes rather than squashing. The epsilon guard keeps the exact
 * -fit case on the x ratio verbatim, so a figure whose aspect already matches
 * emits the byte-identical scale it always did.
 */
export function uniformArtScale(
  contentW: number, contentH: number, svgWidth: number, svgHeight: number,
): number {
  const rawX = contentW / svgWidth;
  const rawY = contentH / svgHeight;
  return Math.abs(rawX - rawY) > 1e-9 ? Math.min(rawX, rawY) : rawX;
}

/** Where the art lands: the scale onto it, its top-left, and the box centre
 *  that the quarter turn and the mirrors both pivot about. */
export interface FigureArtLayout {
  /** SVG units → output units, uniform. */
  scale: number;
  /** Top-left of the scaled art, in output units. */
  posX: number;
  posY: number;
  /** The placed box's centre in output units — the pivot. */
  cx: number;
  cy: number;
}

/**
 * Lay `cached` art into one placed box.
 *
 * `box` is in L0 cells; everything returned is in cells × `unitsPerCell`.
 * A figure with `quads` calls this once per quad, with the quad's own box.
 */
export function figureArtLayout(
  box: { cellX: number; cellY: number; cellWidth: number; cellHeight: number },
  rotation: 0 | 90 | 180 | 270,
  cached: { svgWidth: number; svgHeight: number },
  unitsPerCell: number = 1,
): FigureArtLayout {
  const cx = (box.cellX + box.cellWidth / 2) * unitsPerCell;
  const cy = (box.cellY + box.cellHeight / 2) * unitsPerCell;

  const [swW, swH] = unswapQuarter(box.cellWidth, box.cellHeight, rotation);
  const scale = uniformArtScale(
    swW * unitsPerCell, swH * unitsPerCell, cached.svgWidth, cached.svgHeight,
  );

  return {
    scale,
    posX: cx - (cached.svgWidth * scale) / 2,
    posY: cy - (cached.svgHeight * scale) / 2,
    cx,
    cy,
  };
}

/**
 * Turn and flip a point about (cx, cy) — MIRRORS FIRST, then the quarter.
 *
 * The order is the one the builders' SVG transform list spells, where the
 * rightmost transform is applied to the point first:
 * `translate(c) rotate(r) scale(-1,1) scale(1,-1) translate(-c)`. Every
 * consumer of a figure's cached art has to agree with it or the art comes
 * out flipped across the wrong diagonal; putting the order here is what
 * keeps them agreeing.
 *
 * y points down, so a positive rotation is clockwise — SVG semantics.
 */
export function rotateMirrorAround(
  x: number, y: number,
  cx: number, cy: number,
  rotation: 0 | 90 | 180 | 270,
  mirrorH: boolean, mirrorV: boolean,
): [number, number] {
  let dx = x - cx;
  let dy = y - cy;
  if (mirrorV) dy = -dy;
  if (mirrorH) dx = -dx;
  if (rotation === 90) { const t = dx; dx = -dy; dy = t; }
  else if (rotation === 180) { dx = -dx; dy = -dy; }
  else if (rotation === 270) { const t = dx; dx = dy; dy = -t; }
  return [dx + cx, dy + cy];
}

/**
 * The full art-space → output-space map for one laid-out box: scale and
 * centre the art, then turn and flip it about the box's centre.
 */
export function figureArtPoint(
  layout: FigureArtLayout,
  svgX: number, svgY: number,
  rotation: 0 | 90 | 180 | 270,
  mirrorH: boolean, mirrorV: boolean,
): [number, number] {
  return rotateMirrorAround(
    svgX * layout.scale + layout.posX,
    svgY * layout.scale + layout.posY,
    layout.cx, layout.cy, rotation, mirrorH, mirrorV,
  );
}
