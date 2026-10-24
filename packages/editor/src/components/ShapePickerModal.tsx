import React from 'react';
import { ToolGridSheet, type ToolGridCell } from './ToolGridSheet';
import {
  SHAPE_MODAL_SHAPES,
  heartIconPoints,
  polygonIsHeart,
  polygonIsQuarterCircle,
  polygonIsQuarterTorus,
  polygonIsRightTriangle,
  polygonIsSemiTorus,
  polygonIsSemicircle,
  polygonIsSpiral,
  polygonIsStar,
  quarterCircleIconPoints,
  quarterTorusIconPoints,
  regularPolygonIconPoints,
  rightTriangleIconPoints,
  semiTorusIconPoints,
  semicircleIconPoints,
  spiralIconPoints,
  starIconPoints,
} from './toolbarMeta';

// The Shape tool's full picker — the capsule's More doorway: a 4×3 grid of
// every N-gon from 3 to 8, a Right triangle, a Semicircle and a Semi-torus,
// then Star, Heart and Spiral, icon over a small label — or the format's
// own cut of it (Shadows: the 9-gon and the two quarter shapes in the
// decorative three's place).
//
// A SHEET rising from the bottom, not a takeover — the one shared grid
// sheet (ToolGridSheet), which owns the cells, their sizing and their
// styles; this file is the table that fills it and the glyphs it draws.
// You reach for a triangle because of what is on the page, and a
// full-screen picker answers that by hiding the page.
//
// Nothing in the grid is shown as chosen. The capsule beside it holds the
// armed shape and says which; this is a menu of shapes to ADD, and a lit
// cell in it read as "this is what you have" on a list whose every cell is
// a thing to press. A press arms the shape and closes the sheet, so the
// next drag draws it — and so does a tap anywhere off the sheet, which
// arms nothing.

const COLS = 4;

/** One cell's glyph, drawn from the same generators the tool commits with
 *  (toolbarMeta's icon-points helpers) — the grid previews exactly what a
 *  drag will draw. Inline <svg>: the editor is a DOM tree (see
 *  @/editor/components/ToolIcons), and this modal never mounts under the RN renderer. */
function ShapeGlyph({ sides, size, color }: { sides: number; size: number; color: string }) {
  if (polygonIsSpiral(sides)) {
    return (
      <svg width={size} height={size} viewBox="0 0 256 256" fill="none">
        <polyline points={spiralIconPoints()} stroke={color} strokeWidth={20} strokeLinecap="round" />
      </svg>
    );
  }
  const points = polygonIsHeart(sides) ? heartIconPoints()
    : polygonIsStar(sides) ? starIconPoints()
    : polygonIsRightTriangle(sides) ? rightTriangleIconPoints()
    : polygonIsSemicircle(sides) ? semicircleIconPoints()
    : polygonIsSemiTorus(sides) ? semiTorusIconPoints()
    : polygonIsQuarterCircle(sides) ? quarterCircleIconPoints()
    : polygonIsQuarterTorus(sides) ? quarterTorusIconPoints()
    : regularPolygonIconPoints(sides);
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none">
      <polygon points={points} stroke={color} strokeWidth={27} strokeLinejoin="round" />
    </svg>
  );
}

export function ShapePickerModal({ visible, onPick, onDismiss, bottomInset, shapes = SHAPE_MODAL_SHAPES }: {
  visible: boolean;
  /** Arm this shape — the caller closes the sheet and keeps the tool. */
  onPick: (sides: number) => void;
  onDismiss: () => void;
  /** Home-indicator clearance under the grid. */
  bottomInset?: number;
  /** The grid's cells, in display order: the whole table by default, or
   *  the format's own cut of it (toolbarMeta.shapeModalShapes — Shadows
   *  keeps the parametric three off and asks for the extra solids). */
  shapes?: readonly { sides: number; label: string }[];
}) {
  // No cell carries `active`: nothing in this grid is shown as chosen.
  const cells: ToolGridCell[] = shapes.map((entry) => ({
    key: String(entry.sides),
    label: entry.label,
    accessibilityLabel: `Shape: ${entry.label}`,
    onPress: () => onPick(entry.sides),
    glyph: (size, color) => <ShapeGlyph sides={entry.sides} size={size} color={color} />,
  }));
  return (
    <ToolGridSheet
      visible={visible}
      onDismiss={onDismiss}
      bottomInset={bottomInset}
      cols={COLS}
      cells={cells}
    />
  );
}
