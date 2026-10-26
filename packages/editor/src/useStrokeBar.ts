import { BASE_CELL_PX } from './cameraMath';
import {
  buildForEachNode, buildRecolorPattern, buildRecolorSVGWithOpacity,
  buildSetObjectOpacity, buildSetSVGStroke, withSVGStroke, withState,
  type EditorSession, type NewShapeStyle, type SessionEntry,
} from './editorSession';
import { editTargetIds, foldTargets } from './panelModel';
import { BorderModel } from '@/editor-ui/adapter';
import { svgHasFill } from '@/editor-ui/logic/svgEdit';
import { findItem } from '@/engine/compositionOps';
import { svgStrokeWidthCells, svgSubtype } from '@/engine/svgStroke';
import { CompositionState, RGBColor, SVGStroke } from '@/engine/types';
import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';

// The Stroke bar: a vector object's own outline — width, position, dash and
// radius — and the ink it is drawn in. It IS the Border bar, retitled and
// pointed at the object rather than its frame, which is why the bar hands
// back a `BorderModel`.
//
// 6.0 measured this section at 156 lines byte-identical in all three apps,
// one of the three of its ten bar-handler sections that already were.
//
// `newShapeStyle` is an input because an outline the user sets is
// REMEMBERED: the next shape is born wearing it, and `onAddStroke` reads
// the remembered width back to decide what "add" means.

export function useStrokeBar<S extends EditorSession>({
  sessionRef, setSession, applyEntry,
  noteActiveColor, newShapeStyle, setNewShapeStyle,
  setStrokeColorPickerOpen,
}: {
  sessionRef: { current: S | null };
  setSession: (next: S) => void;
  applyEntry: (se: SessionEntry | null) => void;
  noteActiveColor: (color: RGBColor) => void;
  newShapeStyle: NewShapeStyle;
  setNewShapeStyle: Dispatch<SetStateAction<NewShapeStyle>>;
  setStrokeColorPickerOpen: (open: boolean) => void;
}) {
  // ── Vector stroke (the Stroke bar) ────────────────────────────────
  // Same live-preview / commit coalescing as the effect bars: drags preview
  // through non-undoable withState, release rolls back to the pre-drag
  // snapshot and commits one original→final entry.
  const strokeBaseRef = useRef<CompositionState | null>(null);

  // `strokeFor` resolves the stroke PER TARGET (from the working state), so a
  // multi-edit can carry each object's own radius / untouched fields while
  // applying the shared change to all.
  const applyStrokeEdit = useCallback((
    strokeFor: (state: CompositionState, id: string) => SVGStroke | null,
    committed: boolean,
  ) => {
    const s = sessionRef.current;
    if (!s) return;
    const ids = editTargetIds(s);
    if (ids.length === 0) return;
    if (!committed) {
      if (!strokeBaseRef.current) strokeBaseRef.current = s.state;
      setSession(withState(s, foldTargets(s.state, ids,
        (st, id) => withSVGStroke(st, id, strokeFor(st, id)))));
      return;
    }
    const base = strokeBaseRef.current ?? s.state;
    strokeBaseRef.current = null;
    setSession(withState(s, base));
    // Zeroing or trashing a shape's outline is the same kind of statement
    // the Fill bar makes, so it is remembered the same way — and so is the
    // WIDTH itself, which is what a new pattern opens at, and the dash and
    // alignment beside it: the next object with a stroke, of any kind, is
    // born in the whole stroke the bar was last left at. Read off the
    // first target: a multi-edit applies one stroke to all of them.
    const stroke = strokeFor(base, ids[0]);
    const width = stroke?.width;
    if (width != null) {
      setNewShapeStyle((prev) => ({
        ...prev,
        outlined: width > 0,
        // A zeroed outline is `outlined: false`; storing 0 as the width
        // would open the next pattern with no line at all. Keep the last
        // real width, so un-zeroing returns to it.
        ...(width > 0 ? { strokeWidth: width } : null),
        ...(stroke?.dash != null ? { strokeDash: stroke.dash } : null),
        ...(stroke?.position != null ? { strokePosition: stroke.position } : null),
      }));
    }
    applyEntry(buildForEachNode(base, ids,
      (st, id) => buildSetSVGStroke(st, id, strokeFor(st, id))));
  }, [setSession, applyEntry]);

  // The bar hands back a BorderModel (it IS the Border bar); width / position /
  // dash map straight onto the stroke block, and the Radius row arrives
  // separately through onStrokeRadius. Radius is carried through unchanged so a
  // width drag can't wipe a radius the user already set.
  const onStroke = useCallback((m: BorderModel | null, committed: boolean) => {
    if (!m) {
      // Trash. A closed shape carries its own fill, so "remove stroke" means
      // hide the OUTLINE (the fill keeps the shape visible) — zero the width
      // rather than clearing back to the composition-wide default outline,
      // which would leave the outline drawn. An open path IS its stroke, so
      // there is nothing to fall back to: it keeps the reset-to-default clear.
      applyStrokeEdit((state, id) => {
        const ref = findItem(state, id);
        return ref?.kind === 'svg' && svgHasFill(svgSubtype(ref.item)) ? { width: 0 } : null;
      }, committed);
      return;
    }
    // Each target keeps its own radius (set separately via onStrokeRadius) —
    // a width drag must not wipe a radius the user already set.
    applyStrokeEdit((state, id) => {
      const ref = findItem(state, id);
      const radius = ref?.kind === 'svg' ? ref.item.stroke?.radius : undefined;
      return {
        width: Math.max(0, m.width),
        position: m.position,
        dash: Math.max(0, Math.min(10, Math.round(m.dash))),
        radius,
      };
    }, committed);
  }, [applyStrokeEdit]);

  const onStrokeRadius = useCallback((radius: number, committed: boolean) => {
    applyStrokeEdit((state, id) => {
      const ref = findItem(state, id);
      if (ref?.kind !== 'svg') return null;
      return { ...ref.item.stroke, radius };
    }, committed);
  }, [applyStrokeEdit]);

  // A vector object's stroke color IS its color (the object's `color` field),
  // so the Stroke bar's swatch opens the full-screen picker and, on confirm,
  // recolors that field. It CANNOT ride the ordinary `applyColor` path: for a
  // closed shape that path targets the interior FILL (svgHasFill), which would
  // silently paint the fill instead of the outline the Stroke bar points at.
  //
  // A pattern shares the bar and the swatch, but not the field: its colour
  // lives per cell, so it re-inks its tiles instead. buildRecolorPattern
  // returns null for anything that isn't a pattern, so a mixed selection
  // takes each member down its own path.
  const onPickStrokeColor = useCallback(() => setStrokeColorPickerOpen(true), []);

  const onStrokeColorConfirm = useCallback((
    color: RGBColor, alpha: number, colorTouched = true,
  ) => {
    setStrokeColorPickerOpen(false);
    const s = sessionRef.current;
    if (!s) return;
    // The opacity slider ALONE: the press means the opacity, so every target
    // keeps its own ink and only the object opacity lands. The picker opens
    // on the first member's colour, so writing it back here is what used to
    // repaint a whole group in one member's colour.
    if (!colorTouched) {
      applyEntry(buildForEachNode(s.state, editTargetIds(s), (state, id) => {
        const ref = findItem(state, id);
        if (!ref || ref.kind === 'figure') return null;
        // The opacity alone — 0 fade, because a fade is spent into the
        // colours when its slider commits and never rides the record
        // (engine/fadeBake.ts); there is nothing here to carry forward.
        return buildSetObjectOpacity(state, id, alpha, 0);
      }));
      return;
    }
    noteActiveColor(color);
    // An outline's ink is remembered apart from a fill's — a shape holds
    // both, the active colour holds one, so whichever swatch was tapped
    // last would otherwise win both halves of the next shape.
    setNewShapeStyle((prev) => ({ ...prev, strokeColor: color }));
    applyEntry(buildForEachNode(s.state, editTargetIds(s),
      (state, id) => buildRecolorPattern(state, id, color)
        ?? buildRecolorSVGWithOpacity(state, id, color, alpha)));
  }, [applyEntry, noteActiveColor]);

  // The Add Stroke button — the one place a missing outline is created: the
  // width the Stroke bar was last left at (the same memory a new shape is
  // drawn with), else the composition-wide default weight, keeping each
  // shape's own radius. A shape that already draws its outline never sees
  // this — the bar is then there to EDIT that stroke. Goes through
  // applyStrokeEdit, so the width lands in the new-shape memory exactly as
  // a slider drag's would.
  const onAddStroke = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    const width = newShapeStyle.strokeWidth
      ?? svgStrokeWidthCells({ stroke: undefined }, s.state.strokeScale, BASE_CELL_PX);
    applyStrokeEdit((state, id) => {
      const ref = findItem(state, id);
      const radius = ref?.kind === 'svg' ? ref.item.stroke?.radius : undefined;
      return { width, ...(radius != null ? { radius } : {}) };
    }, true);
  }, [applyStrokeEdit, newShapeStyle.strokeWidth]);

  return {
    onAddStroke, onPickStrokeColor, onStroke, onStrokeColorConfirm, onStrokeRadius,
  };
}
