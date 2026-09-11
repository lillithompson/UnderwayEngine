import React from 'react';
import { BarBody } from './effectBar';
import { RadiusRow } from './BorderBar';

// The Shape page, on a polygonal shape (a rectangle, a polygon — see
// svgHasShape): the Radius slider that rounds the path's own corners. It
// came off the Stroke page, where it sat between Width and Position as
// though it were a property of the outline: the corners are the shape's,
// whatever is drawn along them. One row, no colour, nothing to remove.

export function ShapeBar({ cornerRadius, onCornerRadius }: {
  /** Corner rounding, a 0–0.5 fraction of the shorter side. */
  cornerRadius: number;
  /** `radius` is a 0–0.5 fraction; `committed` marks the drag release (one
   *  undo step) vs. a live preview. */
  onCornerRadius: (radius: number, committed: boolean) => void;
}) {
  return (
    <BarBody>
      <RadiusRow cornerRadius={cornerRadius} onCornerRadius={onCornerRadius} />
    </BarBody>
  );
}
