import {
  buildForEachNode, buildSetSVGFill, shapeFillOf, withFillColor, withSVGFill,
  withState, type EditorSession, type NewShapeStyle, type SessionEntry,
} from './editorSession';
import { tintModelToFill } from './panelEffectModels';
import { editTargetIds, foldTargets, svgEnclosesRef } from './panelModel';
import { TintModel } from '@/editor-ui/adapter';
import { findItem } from '@/engine/compositionOps';
import { CompositionState, RGBColor } from '@/engine/types';
import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';

// The Fill bar: a closed shape's interior, and the picker its swatch opens.
// The section comment below says what it is and what it shares with the Tint
// bar it was made from; what the shell keeps under that banner is
// `onSvgPatternOpenChange` and `onSvgFillOpenChange`, which belong to the
// pages that raise the bar rather than to the fill. (Named rather than
// counted: a count of what stays behind is a number the next slice of the
// shell silently invalidates.)
//
// **Every function prop must be STABLE.** These callbacks keep the
// `useCallback` dep arrays they had in the shell — `applyEntry`,
// `setSession` and `noteActiveColor`, never `setNewShapeStyle` — so any prop
// passed as an inline lambda would be captured once and never refreshed. The
// three shells pass raw `useState` setters and `useCallback` results, which
// is why this holds today; it is a contract of the hook, not an accident of
// its callers.

export function useFillBar<S extends EditorSession>({
  sessionRef, setSession, applyEntry,
  currentColorRef, noteActiveColor, setNewShapeStyle,
  setSvgFillColorPickerOpen,
}: {
  sessionRef: { current: S | null };
  setSession: (next: S) => void;
  applyEntry: (se: SessionEntry | null) => void;
  currentColorRef: { current: RGBColor };
  noteActiveColor: (color: RGBColor) => void;
  setNewShapeStyle: Dispatch<SetStateAction<NewShapeStyle>>;
  setSvgFillColorPickerOpen: (open: boolean) => void;
}) {
  // ── Shape fill (the Fill bar) ─────────────────────────────────────
  // The Tint bar's machinery pointed at a closed shape's interior: identical
  // live-preview / commit coalescing, and the same draft-owns-params /
  // model-owns-colors split (the swatch edits colors through the full-screen
  // picker below).
  const svgFillBaseRef = useRef<CompositionState | null>(null);

  // The stop the Fill bar has selected, mirrored here so the colour picker
  // targets the right one: the bar tracks `selectedStop` and the solid and
  // per-stop colours come back through the model, the way the effect bars'
  // colours do.
  const svgFillSelectedStopRef = useRef(0);

  // The Add Fill button: lay the active color in as one undo step. Shapes
  // that already carry a fill never see this — the bar is then there to
  // EDIT that fill, not to replace it.
  const onAddSvgFill = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    const unfilled = editTargetIds(s).filter((id) => {
      const ref = findItem(s.state, id);
      return svgEnclosesRef(ref) && ref?.kind === 'svg'
        && !ref.item.fill && !ref.item.fillColor;
    });
    if (unfilled.length === 0) return;
    const rgb = currentColorRef.current;
    applyEntry(buildForEachNode(s.state, unfilled, (state, id) => {
      const ref = findItem(state, id);
      if (ref?.kind !== 'svg') return null;
      return buildSetSVGFill(state, id, withFillColor(shapeFillOf(ref.item), rgb, 1, 0));
    }));
    // Adding a fill says "shapes are filled" every bit as much as dragging
    // the bar's sliders does, so it is remembered the same way. Without
    // this the COMMONEST way to fill a shape — add, pick a colour, never
    // touch a slider — left the memory reading "unfilled" and the next
    // shape still came up hollow.
    const first = findItem(s.state, unfilled[0]);
    if (first?.kind === 'svg') {
      const fill = withFillColor(shapeFillOf(first.item), rgb, 1, 0);
      setNewShapeStyle((prev) => ({ ...prev, filled: true, fill }));
    }
  }, [applyEntry]);

  const onSvgFill = useCallback((m: TintModel | null, committed: boolean) => {
    const s = sessionRef.current;
    if (!s) return;
    const ids = editTargetIds(s);
    if (ids.length === 0) return;
    svgFillSelectedStopRef.current = m?.selectedStop ?? 0;
    const fill = m ? tintModelToFill(m) : null;
    if (!committed) {
      if (!svgFillBaseRef.current) svgFillBaseRef.current = s.state;
      setSession(withState(s, foldTargets(s.state, ids,
        (st, id) => withSVGFill(st, id, fill))));
      return;
    }
    const base = svgFillBaseRef.current ?? s.state;
    svgFillBaseRef.current = null;
    setSession(withState(s, base));
    // Filling a shape (or clearing its fill) is the user saying what a shape
    // should look like — the next one they draw starts there, wearing the
    // same fill (a gradient stays a gradient). A CLEARED fill is remembered
    // as `filled: false` only: keeping the last real fill means re-filling
    // returns to it instead of falling back to the active ink.
    setNewShapeStyle((prev) => ({
      ...prev, filled: fill != null, ...(fill ? { fill } : null),
    }));
    applyEntry(buildForEachNode(base, ids,
      (st, id) => buildSetSVGFill(st, id, fill)));
  }, [setSession, applyEntry]);

  // The row's trailing circle opens the same full-screen picker; confirming
  // applies the color to the solid (Solid mode) or the selected stop (gradient
  // modes) as one undo step.
  const onPickSvgFillColor = useCallback(() => setSvgFillColorPickerOpen(true), []);

  const onSvgFillColorConfirm = useCallback((
    color: RGBColor, alpha: number, colorTouched = true,
  ) => {
    setSvgFillColorPickerOpen(false);
    if (colorTouched) noteActiveColor(color);
    const s = sessionRef.current;
    if (!s) return;
    const rgb = { r: color.r, g: color.g, b: color.b };
    const stop = svgFillSelectedStopRef.current;
    applyEntry(buildForEachNode(s.state, editTargetIds(s), (state, id) => {
      const ref = findItem(state, id);
      if (ref?.kind !== 'svg') return null;
      const cur = shapeFillOf(ref.item);
      // Opacity alone: this shape keeps the colour it is filled with.
      const ink = colorTouched ? rgb : (stop === 0 ? cur.solid : cur.stops[stop]?.color ?? cur.solid);
      return buildSetSVGFill(state, id, withFillColor(cur, ink, alpha, stop));
    }));
    // The colour a fill wears is part of the remembered fill. Read off the
    // first vector target, as the Stroke bar reads its width.
    const first = editTargetIds(s)
      .map((id) => findItem(s.state, id)).find((ref) => ref?.kind === 'svg');
    if (first?.kind === 'svg') {
      const fill = withFillColor(shapeFillOf(first.item), rgb, alpha, stop);
      setNewShapeStyle((prev) => ({ ...prev, filled: true, fill }));
    }
  }, [applyEntry, noteActiveColor]);

  return {
    onAddSvgFill, onPickSvgFillColor, onSvgFill, onSvgFillColorConfirm,
    svgFillSelectedStopRef,
  };
}
