import type { PathSegment, SVGObject } from '@/engine/types';
import { computeSVGBbox } from '@/engine/compositionOps';
import { mintNodeId, SessionEntry } from './editorSession';
import {
  applySymmetryAffine,
  symmetryAffineMaps,
  type CanvasSymmetrySpec,
  type SymmetryAffine,
} from './canvasSymmetry';

// Mirrored VECTOR copies for the canvas Symmetry setting: a freshly drawn
// freehand stroke, line, arc, rectangle, circle or polygon commits with
// its orbit partners in the same entry — each partner the SAME object
// carried through one of the orbit's isometries, point by point. A quarter
// arc stays a quarter arc (start/end/center all map, and the sweep is
// implied by their orientation, so a reflection flips it for free); a
// closed shape stays closed; the copy keeps the primary's colour, fill and
// stroke dress. One undo step removes the mark and its mirrors together.

function mapPoint(m: SymmetryAffine, p: readonly [number, number]): [number, number] {
  return applySymmetryAffine(m, p[0], p[1]);
}

/** Segments carried through one orbit map, point by point — shared by the
 *  committed copies below and the live drag preview, so the draft mirrors
 *  exactly where the commit will land. */
export function mirroredSegments(
  segments: readonly PathSegment[], m: SymmetryAffine,
): PathSegment[] {
  return segments.map((seg) => seg.kind === 'arc'
    ? { kind: 'arc', start: mapPoint(m, seg.start), end: mapPoint(m, seg.end), center: mapPoint(m, seg.center) }
    : { kind: 'line', start: mapPoint(m, seg.start), end: mapPoint(m, seg.end) });
}

/** The same object, carried through one orbit map: geometry transformed
 *  point-wise, bbox recomputed, a fresh id minted; the axis-locked-line
 *  metadata follows the transform (its box maps, and an axis swap flips
 *  horizontal ↔ vertical). Everything else — colour, fill, stroke dress,
 *  name, shapeKind — rides the spread. */
export function mirroredSVGCopy(item: SVGObject, m: SymmetryAffine): SVGObject {
  const segments = mirroredSegments(item.segments, m);
  const swapsAxes = m.b !== 0 || m.c !== 0;
  const copy: SVGObject = {
    ...item,
    id: mintNodeId('svg'),
    segments,
    ...computeSVGBbox(segments),
  };
  if (item.lineDirection) {
    copy.lineDirection = swapsAxes
      ? (item.lineDirection === 'horizontal' ? 'vertical' : 'horizontal')
      : item.lineDirection;
  }
  if (item.creationBox) {
    const [ax, ay] = applySymmetryAffine(m, item.creationBox.minX, item.creationBox.minY);
    const [bx, by] = applySymmetryAffine(
      m,
      item.creationBox.minX + item.creationBox.width,
      item.creationBox.minY + item.creationBox.height,
    );
    copy.creationBox = {
      minX: Math.min(ax, bx),
      minY: Math.min(ay, by),
      width: Math.abs(bx - ax),
      height: Math.abs(by - ay),
    };
  }
  return copy;
}

/**
 * Wrap a fresh vector placement in its symmetry orbit: every `placeObject`
 * SVG op in `se` gains one mirrored copy per orbit map, appended to the
 * SAME entry (one undo step; the primary keeps whatever selection the
 * entry's id carries). Quad / row / col anchor their half-block structure
 * on the object's own center, the way a paint dab anchors on itself. No-op
 * when symmetry is off (`spec` undefined) or the entry places nothing.
 */
export function withSymmetryCopies(
  se: SessionEntry | null,
  spec: CanvasSymmetrySpec | undefined,
  step: number,
): SessionEntry | null {
  // A pattern-scoped mirror copies nothing: it is that pattern's alone.
  if (!se || !spec || spec.only) return se;
  const copies: SessionEntry['entry'] = [];
  for (const op of se.entry) {
    if (op.op !== 'placeObject' || op.kind !== 'svg') continue;
    const item = op.item as SVGObject;
    const maps = symmetryAffineMaps(
      spec, step,
      item.cellX + item.cellWidth / 2,
      item.cellY + item.cellHeight / 2,
    );
    for (const m of maps) {
      copies.push({ op: 'placeObject', kind: 'svg', item: mirroredSVGCopy(item, m) });
    }
  }
  if (copies.length === 0) return se;
  return { ...se, entry: [...se.entry, ...copies] };
}
