import React from 'react';
import { SVG_UNITS_PER_L0_CELL } from '@/engine/svgExport';
import { buildClosedFillPathD } from '@/engine/svgPathBuilder';
import type { SVGObject } from '@/engine/types';
import { BASE_CELL_PX } from '../cameraMath';
import { DrawnLeaf, drawnFrame, svgDrawnGeometry } from '../drawnPose';
import {
  SELECTION_BORDER_PX, SELECTION_COLOR, TEXT_EDIT_RING_GAP_PX, screenPx,
} from '../selectionOutline';

// The DOUBLE BORDER a shape wears while its pattern fill is open for
// painting.
//
// The same doubled ring an open TEXT wears and a pattern object's grid
// wears — two SELECTION_BORDER_PX rings in the selection blue with
// TEXT_EDIT_RING_GAP_PX of clear space between them — drawn around the
// shape's OWN OUTLINE rather than around a box. A pattern fill is painted
// inside the shape, cell by cell, so the sign that says "this is the grid
// your next press lands in" has to be the outline itself; everything about
// how that sign is DRAWN is the editor's existing one, so edit mode looks
// the same whatever is in it.
//
// Both rings lie OUTSIDE the path (clipped to its outside), so they never
// cover the tiles they frame and the shape's own stroke goes on drawing
// itself — where this used to paint a band four times the line weight and
// redraw the outline on top of it.
//
// Zoom-invariant like the box rings, and by the same machinery: the widths
// are `screenPx` calcs against ZOOM_INV_VAR, which CanvasSurface writes on
// this element every camera frame (a JS number would lag a pinch). The one
// conversion is the viewBox's: a CSS px inside this <svg> is one SVG user
// unit, and the element draws BASE_CELL_PX per cell over a viewBox of
// SVG_UNITS_PER_L0_CELL per cell — so a screen px is that ratio of them.

/** Screen px → this SVG's user units (before the camera's own scale, which
 *  `screenPx` divides out). */
const PX_TO_UNITS = SVG_UNITS_PER_L0_CELL / BASE_CELL_PX;

/** A stroke centred on the path covers half its width to each side, so a
 *  band reaching `outward` screen px past the path is stroked at twice
 *  that — and clipped to the outside, which keeps the outer half. */
const bandWidth = (outward: number): string => screenPx(outward * 2 * PX_TO_UNITS);

/** The rings, as distances OUTWARD from the path in screen px: the first
 *  ring, then the gap, then the second — the box ring's own three numbers
 *  (selectionOutlineStyle's border, textEditRingStyle's inset and its
 *  border). */
const RING_1 = SELECTION_BORDER_PX;
const RING_2_INNER = SELECTION_BORDER_PX + TEXT_EDIT_RING_GAP_PX;
const RING_2_OUTER = RING_2_INNER + SELECTION_BORDER_PX;

/** World half-extent of the rectangle the outside-clip is cut from. Big
 *  enough to cover any shape at any zoom; it is clipped to the element's
 *  own box anyway. */
const CLIP_EXTENT = 1e6;

/** How far past the shape's box the ring MASK reaches, in cells. The rings
 *  are a fixed number of SCREEN px, so the further the camera pulls back
 *  the more cells they span; eight covers any zoom the editor allows. */
const MASK_MARGIN_CELLS = 8;

export function ShapePatternEditOutline({ drawn, outlineRef }: {
  /** The patterned shape, as the node layer draws it. */
  drawn: DrawnLeaf;
  /** Handed to CanvasSurface, which writes the zoom inverse here on every
   *  camera frame as it does on the selection outline's own element. */
  outlineRef?: React.Ref<HTMLDivElement>;
}) {
  const u = SVG_UNITS_PER_L0_CELL;
  // The SAME geometry the node layer draws from, so the rings land exactly
  // on the path the canvas is showing — through a pinch, a turn, and a
  // group pulled off square alike (svgDrawnGeometry).
  const geometry = svgDrawnGeometry(drawn);
  const frame = drawnFrame(drawn, BASE_CELL_PX, geometry);
  const object = geometry.object as SVGObject;
  const box = geometry.box;
  const closedD = buildClosedFillPathD(object.segments);
  if (!closedD) return null;
  const clipId = `patedit_clip_${object.id}`;
  const maskId = `patedit_rings_${object.id}`;
  const outer = `M ${-CLIP_EXTENT} ${-CLIP_EXTENT} H ${CLIP_EXTENT} V ${CLIP_EXTENT} H ${-CLIP_EXTENT} Z`;
  const margin = MASK_MARGIN_CELLS * u;
  const band = (outward: number, stroke: string) =>
    `<path d="${closedD}" fill="none" stroke="${stroke}"`
    + ` style="stroke-width: ${bandWidth(outward)}" stroke-linejoin="round" />`;
  return (
    <div ref={outlineRef} style={{ position: 'absolute', ...frame.outer, pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: frame.inner.width,
          height: frame.inner.height,
          transform: frame.inner.transform,
          transformOrigin: '0 0',
        }}
      >
        <svg
          aria-hidden
          width="100%"
          height="100%"
          viewBox={`${box.x * u} ${box.y * u} ${Math.max(box.width, 0.05) * u} ${Math.max(box.height, 0.05) * u}`}
          preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0, overflow: 'visible', display: 'block' }}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html:
              '<defs>'
              // Everything OUTSIDE the shape: each band keeps the half of
              // itself that falls there, so nothing is drawn over the
              // pattern the rings frame.
              + `<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse">`
              + `<path d="${outer} ${closedD}" fill-rule="evenodd" /></clipPath>`
              // The two rings, as a luminance mask: everything out to the
              // second ring's outer edge, less the gap, plus the first
              // ring back again. A mask rather than a second clip because
              // the gap must be CLEAR — the page shows through it.
              + `<mask id="${maskId}" maskUnits="userSpaceOnUse"`
              + ` x="${box.x * u - margin}" y="${box.y * u - margin}"`
              + ` width="${box.width * u + margin * 2}" height="${box.height * u + margin * 2}">`
              + band(RING_2_OUTER, '#ffffff')
              + band(RING_2_INNER, '#000000')
              + band(RING_1, '#ffffff')
              + '</mask></defs>'
              + `<g clip-path="url(#${clipId})" mask="url(#${maskId})">`
              + band(RING_2_OUTER, SELECTION_COLOR)
              + '</g>',
          }}
        />
      </div>
    </div>
  );
}
