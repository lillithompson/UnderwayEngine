import { rotateSegmentsAbout, translateSegments } from '@/engine/compositionArcMath';
import { computeRectSegments } from '@/engine/compositionLineBboxMath';
import { computeSVGBbox } from '@/engine/compositionOps';
import { patternSVGView } from '@/engine/patternObjectRender';
import { PathSegment, PatternObject } from '@/engine/types';
import { sliceIntoFaces } from './planarFaces';

// PATCHES OF A PATTERN: the regions a pattern object's drawing cuts its own
// bounding box into, each one a closed shape in its own right.
//
// The same thing Patchwork makes of its loop and frame
// (web/content/patchwork.ts) and the same machinery underneath — the planar
// arrangement of a bag of curves and its bounded faces (planarFaces.ts). What
// differs is only what is handed in. Patchwork hands it ONE continuous closed
// line and the rounded rectangle shrinkwrapped onto it; a pattern hands it
// the baked tile grid, which is hundreds of short strokes that cross, run
// along one another, trail off in mid-air and need not touch the box at all.
// Three things follow from that, and they are the whole of this module:
//
//   • THE BOX IS DRAWN. The rectangle is not in the pattern's geometry — it
//     is the object's bbox, a fact about the node rather than about the
//     drawing — so it is added as four lines before the slice (the shape
//     tools' own `computeRectSegments`, so the box the patches are cut out
//     of is the same rectangle a drawn one is). That is what makes the
//     promise the caller wants hold: the patches tile the bounding
//     rectangle exactly, with nothing over the edge and no gaps.
//   • REPEAT IS SPELLED OUT. A repeating pattern bakes ONE tile and lets the
//     renderer stamp it; the arrangement has no such trick, so the copies
//     are laid out here, the same grid `buildTiledSVGObjectRegionMarkup`
//     stamps. Copies hang over the region's edge and the faces they make out
//     there are dropped — see `withinBox`.
//   • THE FREE ANGLE IS LAST. Everything is cut in the object's UPRIGHT
//     frame, where the box is axis-aligned and "is this face inside it" is a
//     bbox comparison; the finished patches are turned into place at the
//     end. A rotation is rigid, so the two readings are the same one.
//
// Hairs — a tile's stroke that ends in mid-air — bound no region and are
// pruned by the arrangement itself. A stroke with both ends ON something,
// running from the box to an island inside it, is not a hair and is not
// pruned: it does not separate anything either, so the region around the
// island comes back with a zero-width slit along it, which is the right
// answer and fills and strokes as the region does.

/** Faces this far outside the box are outside it; anything else is rounding.
 *  The geometry is built on a lattice a page is 32 cells across, so this is
 *  a long way below anything the tiles actually draw. */
const SLACK = 1e-6;

/**
 * HOW CLOSE COUNTS AS TOUCHING, as a fraction of one pattern cell: one unit
 * of the 256-unit square the tile art is authored on.
 *
 * The arrangement's own default is a lattice tolerance
 * (planarFaces.ts `WELD`) and the tiles are not on a lattice — they are
 * DRAWN, and two of them reach the border between them at coordinates that
 * differ in the third decimal of that square. A stroke running down a
 * column of cells is one line to the eye and, at the lattice tolerance, a
 * stack of separate ones whose ends stop a ten-thousandth of a cell short of
 * each other: every one of them a loose end, pruned, and the regions either
 * side of the column merged into one.
 *
 * One authoring unit is the natural floor — nothing in the art means to say
 * anything finer — and it is a fortieth of the thinnest thing the art draws
 * (the sources stroke at 10 of those units), so nothing that is meant to be
 * two places is welded into one.
 */
const WELD_UNITS_PER_CELL = 1 / 256;

/**
 * How many curves the slice will take before this gives up and hands back
 * nothing.
 *
 * Only a REPEATING pattern can get near it: a stretched grid hands over what
 * it baked, and a full 16×16 of tiles is under a thousand segments, which
 * slices in a few tens of milliseconds. A repeat stamps its tile across the
 * region, so a fine tile under a region dragged wide asks for the copies'
 * PRODUCT — and the arrangement's cost grows faster than the curve count
 * does: measured, ~900 curves take 30ms, ~20,000 take over a second, and
 * ~150,000 take half a minute.
 *
 * Six thousand keeps the press inside a couple of hundred milliseconds. It
 * is also about where the ANSWER stops being one anybody wants: a region
 * that big holds thousands of regions, and a press that put thousands of
 * shapes on the page would cost the document more than the patches are
 * worth. Past it the press does nothing rather than locking the app up for
 * a minute to make a thing nobody could use.
 */
const MAX_CURVES = 6000;

/**
 * The pattern's drawn curves, in world cells and upright — one copy for a
 * stretched pattern, and the whole stamped grid for a repeating one.
 *
 * The repeat grid is the renderer's, read off the same fields: the anchor
 * copy sits at `cellX/Y + tileOffset` and the rest step by the intrinsic
 * tile, so the copies land exactly where the `<pattern>` paints them. The
 * range covers the region and then one copy further each way, because a copy
 * that only overlaps the region's edge still cuts the faces along it.
 *
 * Null when the tiling would ask for more curves than {@link MAX_CURVES}.
 */
function patternCurves(p: PatternObject): PathSegment[] | null {
  const view = patternSVGView(p);
  if (!view || view.segments.length === 0) return [];
  const tileW = view.tileMode === 'repeat' ? view.tileWidthL0 : undefined;
  const tileH = view.tileMode === 'repeat' ? view.tileHeightL0 : undefined;
  if (!tileW || !tileH || tileW <= 0 || tileH <= 0) return [...view.segments];

  const anchorX = p.cellX + (view.tileOffsetXL0 ?? 0);
  const anchorY = p.cellY + (view.tileOffsetYL0 ?? 0);
  const col0 = Math.floor((p.cellX - anchorX) / tileW);
  const col1 = Math.ceil((p.cellX + p.cellWidth - anchorX) / tileW);
  const row0 = Math.floor((p.cellY - anchorY) / tileH);
  const row1 = Math.ceil((p.cellY + p.cellHeight - anchorY) / tileH);
  const copies = (col1 - col0 + 1) * (row1 - row0 + 1);
  if (copies * view.segments.length > MAX_CURVES) return null;

  const out: PathSegment[] = [];
  const one = [...view.segments];
  for (let col = col0; col <= col1; col++) {
    for (let row = row0; row <= row1; row++) {
      out.push(...(col === 0 && row === 0
        ? one
        : translateSegments(one, col * tileW, row * tileH)));
    }
  }
  return out;
}

/**
 * The tolerance the slice reads this pattern's curves at: one unit of the
 * tile art's own square (see {@link WELD_UNITS_PER_CELL}), in world cells.
 *
 * A pattern cell is drawn `cellWidth / cols` world cells across when the
 * grid is stretched to fill the box, and `tileWidthL0 / cols` when it
 * repeats — the box then being a region the tile is stamped across rather
 * than the tile itself. The narrower axis governs, so a squashed grid is
 * read at the tolerance its tighter direction needs.
 */
function patternWeld(p: PatternObject): number {
  const across = (p.tileWidthL0 && p.tileMode === 'repeat' ? p.tileWidthL0 : p.cellWidth)
    / Math.max(1, p.cols);
  const down = (p.tileHeightL0 && p.tileMode === 'repeat' ? p.tileHeightL0 : p.cellHeight)
    / Math.max(1, p.rows);
  return Math.max(SLACK, Math.min(across, down) * WELD_UNITS_PER_CELL);
}

/** Is this face one of the box's own, rather than one the overhang of a
 *  repeated copy made outside it? The box is in the arrangement, so no face
 *  straddles its edge — every face is wholly in or wholly out, and one that
 *  is out has to reach past the box to be there. */
function withinBox(
  face: readonly PathSegment[],
  box: { cellX: number; cellY: number; cellWidth: number; cellHeight: number },
): boolean {
  const b = computeSVGBbox(face);
  return b.cellX >= box.cellX - SLACK
    && b.cellY >= box.cellY - SLACK
    && b.cellX + b.cellWidth <= box.cellX + box.cellWidth + SLACK
    && b.cellY + b.cellHeight <= box.cellY + box.cellHeight + SLACK;
}

/**
 * Every closed region inside a pattern object's bounding box, as closed runs
 * of world-space segments — one per region, ordered down the page and then
 * across it, so the first is the top-left one and the numbering reads the
 * way the page does rather than the way the walk happened to go.
 *
 * The guarantee is the arrangement's: no two overlap, none is left out, and
 * together they are exactly the bounding rectangle. A region with an island
 * in it comes back as two loops — its own outline and the island's,
 * counter-wound — which is how the renderer spells a hole.
 *
 * Empty for a pattern with no box to speak of, and for one whose repeat grid
 * is too fine to slice (see {@link MAX_CURVES}). An EMPTY pattern is not a
 * special case: nothing is drawn inside the box, so the box is the one
 * region, which is the true answer.
 */
export function patternPatchOutlines(p: PatternObject): PathSegment[][] {
  if (!(p.cellWidth > SLACK) || !(p.cellHeight > SLACK)) return [];
  const box = {
    cellX: p.cellX, cellY: p.cellY, cellWidth: p.cellWidth, cellHeight: p.cellHeight,
  };
  const curves = patternCurves(p);
  if (curves === null) return [];

  const outline = computeRectSegments(
    box.cellX, box.cellY, box.cellX + box.cellWidth, box.cellY + box.cellHeight,
  );
  const faces = sliceIntoFaces([...outline, ...curves], patternWeld(p))
    .filter((face) => withinBox(face, box))
    .map((segments) => ({ segments, box: computeSVGBbox(segments) }))
    .sort((a, b) => (a.box.cellY - b.box.cellY) || (a.box.cellX - b.box.cellX));

  // …and only now the object's free angle, about the centre of the box the
  // renderer turns it about. Upright, that loop above is bbox arithmetic;
  // tilted it would be a point-in-path test per face per copy.
  const angle = p.angleDeg ?? 0;
  if (!angle) return faces.map((f) => f.segments);
  const cx = box.cellX + box.cellWidth / 2;
  const cy = box.cellY + box.cellHeight / 2;
  return faces.map((f) => rotateSegmentsAbout(f.segments, cx, cy, angle));
}

/** What the Scene Outline calls the `index`-th patch — Patchwork's own word
 *  for the same thing (`patchworkSlotName`), one place so a row on screen
 *  and the object behind it cannot fall out of step. */
export function patternPatchName(index: number): string {
  return `Patch ${index + 1}`;
}
