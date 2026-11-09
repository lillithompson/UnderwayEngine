// Desktop-web keyboard shortcut: F frames the selection — brings the camera
// to the selected object(s), the keyboard's answer to double-tapping a row
// in the scene outline. With nothing selected the app frames the page
// instead (the outline's Frame page tab), so the key always lands somewhere.
//
// Phones and the native iOS shell are excluded (see isDesktopWeb), as the
// other shortcuts are. A plain F only: ⌘F / Ctrl+F is the browser's Find,
// and a keypress inside a typing field is always a letter, never a command.
//
// Split out (and dependency-light) so it stays unit testable in the node
// harness, matching deleteKeyShortcut and undoRedoShortcut.

import { KeyTarget, isTypingTarget } from './deleteKeyShortcut';

/** The slice of KeyboardEvent the decision reads. */
export interface FrameKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** True when the keypress is a bare F (either case — Caps Lock on still
 *  frames) outside a field the user is typing into. */
export function isFrameSelectionKey(e: FrameKeyEvent, target: KeyTarget | null): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false;
  if (e.key !== 'f' && e.key !== 'F') return false;
  return !isTypingTarget(target);
}
