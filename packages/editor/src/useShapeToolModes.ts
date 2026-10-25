import { useState } from 'react';
import type { ArcToolMode, LineToolMode } from './components/toolbarMeta';
import type { CommonEditorConfig } from './formats/editorConfig';

// The shape tools' sub-modes, and the format's power to pin them. Each tool
// holds what the USER last picked; a format may lock the mode instead
// (`config.shapeLock` — Facets hands out one shape a day), and a locked mode
// wins, so the hold stops toggling and the sides slider never drops down.
//
// The hook hands back BOTH halves: the modes in force (locked or picked) and
// the setters the toolbar's own controls write, because a format that pins a
// mode must not also lose the user's pick underneath it.

export function useShapeToolModes(config: CommonEditorConfig) {
  // Shape-tool sub-modes (Facet's long-press toggles): the line button draws a
  // path or a rectangle, the arc button an arc or a circle. Holding the button
  // flips the mode AND selects that tool, exactly as in Facet's
  // CompositionEditor — so a hold is always "switch to this shape".
  //
  // These hold what the USER last picked. A format may pin the mode instead
  // (config.shapeLock — Facets hands out one shape a day), and a pinned mode
  // wins over the picked one below: the hold stops toggling and the polygon
  // tool's sides slider never drops down, so the day's shape is the shape.
  const [pickedLineToolMode, setLineToolMode] = useState<LineToolMode>('line');

  const [pickedArcToolMode, setArcToolMode] = useState<ArcToolMode>('arc');

  // The shape the polygon tool draws, on one scalar: 3–12 are side
  // counts, values off that range draw a circle, and toolbarMeta's
  // sentinels are the modal's Heart / Spiral. The toolbar
  // glyph tracks it (circle at the stops, triangle at 3, the Rectangle
  // glyph at 4, pentagon at 5, …).
  const [pickedPolygonSides, setPolygonSides] = useState(4);

  // The modes actually in force: the format's lock where it has one, else what
  // the toolbar's own controls last picked.
  const shapeLock = config.shapeLock;

  const lineToolMode = shapeLock?.line ?? pickedLineToolMode;

  const arcToolMode = shapeLock?.arc ?? pickedArcToolMode;

  const polygonSides = shapeLock?.polygonSides ?? pickedPolygonSides;

  return {
    arcToolMode, lineToolMode, polygonSides, setArcToolMode, setLineToolMode,
    setPolygonSides, shapeLock,
  };
}
