import { useCallback, useRef, useState } from 'react';
import type { CompItemKind } from '@/engine/types';
import type { CanvasRadialMenuRef } from './components/CanvasRadialMenu';
import {
  buildSuperDelete, buildSuperUnlock, select,
  type EditorSession, type SessionEntry,
} from './editorSession';
import { hasRadialSelection } from './radialMenu';

// The two LONG-PRESS RADIAL MENUS over the canvas, and the gesture lifecycle
// they share.
//
// A stationary hold on a grabbed node — or anywhere inside a multi-selection's
// combined box — opens a radial fan of the panel's common actions; the
// still-down finger drags over one and the release activates it. A LONGER hold
// punches through to LOCKED nodes with the super menu (duplicate / unlock /
// delete), which force-selects just that object because its actions are
// per-node.
//
// The canvas owns the touch throughout and routes the hold's moves and release
// through the two refs, so those come back out of the hook along with the
// handlers: the shell hands them to `CanvasSurface` and mounts the menus.
//
// What does NOT come out is the ACTION set. The fan's own callbacks
// (`radialMenuCallbacks`, `onRadialBringToFront`, `onSuperDuplicate`) stay in
// each shell: they ride that app's commit pipeline and its colour dispatch,
// and the measurement found them outside this group's closure for exactly
// that reason.

export function useRadialMenus<S extends EditorSession>({
  sessionRef, setSession, applyEntry,
}: {
  sessionRef: { current: S | null };
  setSession: (next: S) => void;
  applyEntry: (se: SessionEntry | null) => void;
}) {
  // ── Long-press radial quick-action menus (Facet CanvasRadialMenu) ──
  // A stationary hold on a grabbed node — or anywhere inside a
  // multi-selection's combined box, which grabs the whole selection —
  // opens a radial fan of the properties panel's common actions; the
  // still-down finger drags over one and the release activates it. Every
  // action has a multi form, so one menu serves both selections. A longer
  // hold punches through to LOCKED nodes with the super menu (duplicate /
  // unlock / delete). The canvas owns the touch throughout — it routes the
  // hold's moves and release through the menu refs.
  const [radialMenu, setRadialMenu] = useState<{ x: number; y: number } | null>(null);

  const [superRadialMenu, setSuperRadialMenu] = useState<{
    x: number; y: number; hitId: string; hitKind: CompItemKind;
  } | null>(null);

  const radialMenuRef = useRef<CanvasRadialMenuRef>(null);

  const superRadialMenuRef = useRef<CanvasRadialMenuRef>(null);

  const onCanvasLongPress = useCallback((screenX: number, screenY: number) => {
    const s = sessionRef.current;
    if (s && hasRadialSelection(s)) {
      setRadialMenu({ x: screenX, y: screenY });
    }
  }, []);

  const onCanvasLongPressMove = useCallback((screenX: number, screenY: number) => {
    radialMenuRef.current?.updateDrag(screenX, screenY);
  }, []);

  const onCanvasLongPressUp = useCallback(() => {
    radialMenuRef.current?.releaseDrag();
  }, []);

  const onRadialClose = useCallback(() => {
    setRadialMenu(null);
  }, []);

  const onCanvasSuperLongPress = useCallback((
    screenX: number, screenY: number, hitId: string, hitKind: CompItemKind,
  ) => {
    const s = sessionRef.current;
    if (!s) return;
    // Force-select just this object (the punch-through target is locked, so
    // the ordinary hit-test skipped it). `raw`: the menu's actions are
    // per-node (unlock, delete, color THIS object), so a grouped target must
    // not balloon into its whole group here.
    setSession(select(s, hitId, { raw: true }));
    setSuperRadialMenu({ x: screenX, y: screenY, hitId, hitKind });
  }, [setSession]);

  const onCanvasSuperLongPressMove = useCallback((screenX: number, screenY: number) => {
    superRadialMenuRef.current?.updateDrag(screenX, screenY);
  }, []);

  const onCanvasSuperLongPressUp = useCallback(() => {
    superRadialMenuRef.current?.releaseDrag();
  }, []);

  const onSuperRadialClose = useCallback(() => {
    setSuperRadialMenu(null);
  }, []);

  const onSuperUnlock = useCallback(() => {
    const s = sessionRef.current;
    if (!s || !superRadialMenu) return;
    applyEntry(buildSuperUnlock(s.state, superRadialMenu.hitId));
  }, [applyEntry, superRadialMenu]);

  const onSuperDelete = useCallback(() => {
    const s = sessionRef.current;
    if (!s || !superRadialMenu) return;
    applyEntry(buildSuperDelete(s.state, superRadialMenu.hitId));
  }, [applyEntry, superRadialMenu]);

  return {
    onCanvasLongPress, onCanvasLongPressMove, onCanvasLongPressUp, onCanvasSuperLongPress,
    onCanvasSuperLongPressMove, onCanvasSuperLongPressUp, onRadialClose, onSuperDelete,
    onSuperRadialClose, onSuperUnlock, radialMenu, radialMenuRef, setRadialMenu,
    setSuperRadialMenu, superRadialMenu, superRadialMenuRef,
  };
}
