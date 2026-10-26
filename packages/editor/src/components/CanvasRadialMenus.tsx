import React from 'react';
import type { EditorSession } from '../editorSession';
import {
  DEFAULT_LOCK_ACTION_INDEX, DEFAULT_RADIAL_ACTIONS, SUPER_RADIAL_ACTIONS,
} from '../radialMenu';
import CanvasRadialMenu, { type CanvasRadialMenuRef } from './CanvasRadialMenu';

/** Where a long press landed, in screen coordinates. */
type PressPoint = { x: number; y: number } | null;
type RadialCallbacks = React.ComponentProps<typeof CanvasRadialMenu>['actionCallbacks'];

// Long-press radial quick-action menus (Facet CanvasRadialMenu): the regular
// menu on a held object OR on a held multi-selection's combined box, the super
// (punch-through) menu on a held LOCKED object. The overlays are pointer-inert
// — the canvas routes the still-down finger through the refs — and paint above
// the floating capsule columns (undo/redo 60, grid 100), which the 120px fan
// reaches whenever the press lands mid-canvas.
//
// Both menus are mounted unconditionally and hide themselves on `visible`,
// because the canvas hands a still-down finger to a ref: a menu that unmounted
// between press and release would have no ref to route it through.
//
// The action TABLES are the package's (`radialMenu.ts`) and the CALLBACKS are
// the shell's, which is the split `useRadialMenus` already draws — so this
// pair takes the callbacks and nothing else about what the actions do.
export function CanvasRadialMenus({
  radialMenuRef, radialMenu, radialSelectionLocked, radialMenuCallbacks, onRadialClose,
  superRadialMenuRef, superRadialMenu, superRadialMenuCallbacks, onSuperRadialClose,
  session,
}: {
  radialMenuRef: React.Ref<CanvasRadialMenuRef>;
  radialMenu: PressPoint;
  radialSelectionLocked: boolean;
  radialMenuCallbacks: RadialCallbacks;
  onRadialClose: () => void;
  superRadialMenuRef: React.Ref<CanvasRadialMenuRef>;
  superRadialMenu: PressPoint;
  superRadialMenuCallbacks: RadialCallbacks;
  onSuperRadialClose: () => void;
  session: EditorSession;
}) {
  return (
    <>
      <CanvasRadialMenu
        ref={radialMenuRef}
        visible={radialMenu !== null}
        screenX={radialMenu?.x ?? 0}
        screenY={radialMenu?.y ?? 0}
        isLocked={radialSelectionLocked}
        actions={DEFAULT_RADIAL_ACTIONS}
        actionCallbacks={radialMenuCallbacks}
        lockActionIndex={DEFAULT_LOCK_ACTION_INDEX}
        bounds={session.state.viewport}
        onClose={onRadialClose}
      />
      <CanvasRadialMenu
        ref={superRadialMenuRef}
        visible={superRadialMenu !== null}
        screenX={superRadialMenu?.x ?? 0}
        screenY={superRadialMenu?.y ?? 0}
        isLocked={false}
        actions={SUPER_RADIAL_ACTIONS}
        actionCallbacks={superRadialMenuCallbacks}
        bounds={session.state.viewport}
        onClose={onSuperRadialClose}
      />
    </>
  );
}
