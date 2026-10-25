import { useCallback, useRef } from 'react';
import type { CompositionState } from '@/engine/types';
import { findItem } from '@/engine/compositionOps';
import type { FramingModel } from '@/editor-ui/adapter';
import {
  buildForEachNode, buildPanImageFraming, buildSetImageCornerRadius,
  buildSetImageFraming, buildZoomImageFraming, withImageCornerRadius,
  withImageFraming, withPannedFraming, withState, withZoomedFraming,
  type EditorSession, type SessionEntry,
} from './editorSession';
import { framingModelToEffect } from './panelEffectModels';
import { editTargetIds, foldTargets } from './panelModel';

// The four image property edits that COALESCE: corner radius, framing (the
// Crop bar's sliders), and the on-canvas crop pan and zoom.
//
// One shape, four times over, and it is the shape that makes them a module
// rather than four handlers: a drag previews live through non-undoable
// `withState`, and the release rolls back to the PRE-DRAG snapshot and commits
// a single original→final undo entry. Each keeps its own base ref because the
// gestures can overlap (a slider drag while a pinch is settling), and a
// zero-delta commit — a tap, a cancel — rolls back with no entry at all.
//
// `onFraming` carries the one subtlety worth reading twice: it resolves the
// image it is EDITING the way the render resolves the framing the bar
// DISPLAYS. The two can split while the bar is up, and an edit routed through
// the moved id died silently after the live preview had already been rolled
// back — which read as "release the Zoom slider and the value jumps back".

/**
 * The image a framing edit is ABOUT, resolved the way the render resolves the
 * framing the bar DISPLAYS: the single selection's leaf, else a multi's first
 * member — never the raw `selectedId`.
 *
 * Pulled out of `onFraming` and exported because it is the one DECISION in
 * this module rather than plumbing, and because it has a shipped bug in its
 * history. The two can split while the bar is up (a scaffold flow advancing,
 * an outline action, a group promotion), and an edit routed through the moved
 * id died silently AFTER the commit path had already rolled the live preview
 * back — which read as "release the Zoom slider and the value jumps back to
 * the pre-edit value". One resolution for what the bar shows and what it
 * writes keeps the slider and the state on one object.
 *
 * `null` when the selection names nothing, or names something that is not an
 * image; the caller still has to consume a commit's snapshot in that case.
 */
export function framingTarget(session: {
  state: CompositionState;
  selectedId: string | null;
  selectedIds: readonly string[];
}) {
  return session.selectedId
    ? findItem(session.state, session.selectedId)
    : session.selectedIds.length > 0 ? findItem(session.state, session.selectedIds[0]) : null;
}

export function useImageEdits<S extends EditorSession>({
  sessionRef, setSession, applyEntry,
}: {
  sessionRef: { current: S | null };
  setSession: (next: S) => void;
  applyEntry: (se: SessionEntry | null) => void;
}) {
  // Round-corners slider. Drags preview live through non-undoable withState;
  // release rolls back to the pre-drag snapshot and commits one original→final
  // undo entry — the same coalescing the live text edit uses.
  const cornerBaseRef = useRef<CompositionState | null>(null);

  const onCornerRadius = useCallback((radius: number, committed: boolean) => {
    const s = sessionRef.current;
    if (!s) return;
    const ids = editTargetIds(s);
    if (ids.length === 0) return;
    if (!committed) {
      if (!cornerBaseRef.current) cornerBaseRef.current = s.state;
      setSession(withState(s, foldTargets(s.state, ids,
        (st, id) => withImageCornerRadius(st, id, radius))));
      return;
    }
    const base = cornerBaseRef.current ?? s.state;
    cornerBaseRef.current = null;
    setSession(withState(s, base));
    applyEntry(buildForEachNode(base, ids,
      (st, id) => buildSetImageCornerRadius(st, id, radius)));
  }, [setSession, applyEntry]);

  // Crop / framing: drags preview live through non-undoable withState; release
  // rolls back to the pre-drag snapshot and commits one original→final undo
  // entry — the same coalescing as corner radius.
  const framingBaseRef = useRef<CompositionState | null>(null);

  const onFraming = useCallback((m: FramingModel, committed: boolean) => {
    const s = sessionRef.current;
    if (!s) return;
    const ref = framingTarget(s);
    if (ref?.kind !== 'image') {
      // The bar's target is gone (mid-dismiss, or the selection moved
      // between preview and release): a commit still consumes the drag's
      // snapshot — roll the live preview back so it can't strand unsaved.
      if (committed && framingBaseRef.current) {
        setSession(withState(s, framingBaseRef.current));
        framingBaseRef.current = null;
      }
      return;
    }
    const id = ref.item.id;
    const framing = framingModelToEffect(m);
    if (!committed) {
      if (!framingBaseRef.current) framingBaseRef.current = s.state;
      setSession(withState(s, withImageFraming(s.state, id, framing)));
      return;
    }
    const base = framingBaseRef.current ?? s.state;
    framingBaseRef.current = null;
    setSession(withState(s, base));
    applyEntry(buildSetImageFraming(base, id, framing));
  }, [setSession, applyEntry]);

  // On-canvas crop pan (drag on the image while the Crop bar is open): preview
  // live through non-undoable withState, release rolls back to the pre-drag
  // snapshot and commits one step — the same coalescing as onFraming. The delta
  // is total-from-gesture-start (world cells), so every call recomputes from the
  // snapshot; a zero-delta commit (a tap or a cancel) rolls back with no entry.
  const cropPanBaseRef = useRef<CompositionState | null>(null);

  const onCropPan = useCallback((nodeId: string, dxCells: number, dyCells: number, committed: boolean) => {
    const s = sessionRef.current;
    if (!s) return;
    if (!committed) {
      if (!cropPanBaseRef.current) cropPanBaseRef.current = s.state;
      setSession(withState(s, withPannedFraming(cropPanBaseRef.current, nodeId, dxCells, dyCells)));
      return;
    }
    const base = cropPanBaseRef.current ?? s.state;
    cropPanBaseRef.current = null;
    setSession(withState(s, base));
    const se = buildPanImageFraming(base, nodeId, dxCells, dyCells);
    if (se) applyEntry(se);
  }, [setSession, applyEntry]);

  // On-canvas crop zoom (two-finger pinch on the image while the Crop bar is
  // open): same live-preview + coalesced-commit shape as onCropPan, but the
  // gesture reports a scale factor rather than a delta.
  const cropZoomBaseRef = useRef<CompositionState | null>(null);

  const onCropZoom = useCallback((nodeId: string, factor: number, committed: boolean) => {
    const s = sessionRef.current;
    if (!s) return;
    if (!committed) {
      if (!cropZoomBaseRef.current) cropZoomBaseRef.current = s.state;
      setSession(withState(s, withZoomedFraming(cropZoomBaseRef.current, nodeId, factor)));
      return;
    }
    const base = cropZoomBaseRef.current ?? s.state;
    cropZoomBaseRef.current = null;
    setSession(withState(s, base));
    const se = buildZoomImageFraming(base, nodeId, factor);
    if (se) applyEntry(se);
  }, [setSession, applyEntry]);

  return { onCornerRadius, onCropPan, onCropZoom, onFraming };
}
