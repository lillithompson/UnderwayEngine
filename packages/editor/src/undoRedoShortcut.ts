// Desktop-web keyboard shortcuts: Ctrl/Cmd+Z undoes, Ctrl/Cmd+V redoes — the
// same actions as the two-finger / three-finger canvas taps, reachable from a
// physical keyboard.
//
// Phones and the native iOS shell are excluded (see isDesktopWeb): there's no
// hardware keyboard there, and the on-screen keyboard belongs to the text-edit
// overlay, where these keys must keep editing text.
//
// Ctrl+V (rather than the more common Ctrl+Y / Ctrl+Shift+Z) is the requested
// redo binding; the editor has no paste action for it to shadow. A keypress
// inside a typing field is always left to the browser, so text-box paste and
// undo still work as normal.
//
// Split out (and dependency-light) so it stays unit testable in the node
// harness, matching deleteKeyShortcut; EditorShell wires the real event.

import { KeyTarget, isTypingTarget } from './deleteKeyShortcut';

/** The slice of KeyboardEvent the decision reads. */
export interface UndoRedoKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Ctrl (Windows/Linux) or Cmd (macOS) is the undo/redo accelerator; Alt is
 *  not part of either binding, so a held Alt means this is some other combo. */
function hasAccelerator(e: UndoRedoKeyEvent): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey;
}

/**
 * Classify a keypress as an undo, a redo, or neither. Returns null when a
 * modifier-less key, a typing target, or any non-matching combo is pressed —
 * the caller then leaves the event alone. Shift is excluded from both so a
 * future Ctrl+Shift+Z (or Shift+Ctrl+V) can't be mistaken for the plain form.
 */
export function classifyUndoRedoKey(
  e: UndoRedoKeyEvent,
  target: KeyTarget | null,
): 'undo' | 'redo' | null {
  if (!hasAccelerator(e) || e.shiftKey) return null;
  if (isTypingTarget(target)) return null;
  const key = e.key.toLowerCase();
  if (key === 'z') return 'undo';
  if (key === 'v') return 'redo';
  return null;
}
