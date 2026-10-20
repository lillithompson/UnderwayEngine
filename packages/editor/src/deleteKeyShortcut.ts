// Desktop-web keyboard shortcut: Backspace / Delete removes the selected
// object — the same action as the object-properties panel's Delete button,
// reachable from a physical keyboard.
//
// Phones and the native iOS shell are deliberately excluded. There's no
// hardware Delete key there, and the on-screen keyboard that IS present
// belongs to the text-edit overlay, where those keys must keep editing text.
//
// Dependency-injected so it stays free of DOM/react-native imports and is
// unit testable in the node harness; EditorShell wires the real ones.

/** A mouse/trackpad implies a real keyboard — the signal that distinguishes a
 *  desktop browser from a touch one. An iPad with a trackpad keyboard case
 *  matches too, which is correct: it has a Delete key. */
export const DESKTOP_POINTER_QUERY = '(hover: hover) and (pointer: fine)';

export interface DesktopWebDeps {
  /** Running inside the native WebView shell (the iOS app). */
  isInWebView: () => boolean;
  /** window.matchMedia, or null where there's no DOM (SSR, node tests). */
  matchMedia: ((query: string) => { matches: boolean }) | null;
}

export function isDesktopWeb(deps: DesktopWebDeps): boolean {
  if (deps.isInWebView()) return false;
  if (!deps.matchMedia) return false;
  return deps.matchMedia(DESKTOP_POINTER_QUERY).matches;
}

/** The slice of KeyboardEvent the decision reads. */
export interface DeleteKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

/** The slice of the event's target element the decision reads. */
export interface KeyTarget {
  tagName: string;
  isContentEditable: boolean;
}

/** macOS's main Delete key reports 'Backspace'; fn+Delete (and the PC Delete
 *  key) reports 'Delete'. Both mean "remove this". A held modifier belongs to
 *  the browser or OS (⌘⌫ and friends), so those presses are left alone. */
export function isDeleteKey(e: DeleteKeyEvent): boolean {
  if (e.key !== 'Backspace' && e.key !== 'Delete') return false;
  return !e.metaKey && !e.ctrlKey && !e.altKey;
}

/** True when the keypress landed in a field the user is typing into — the
 *  text-edit overlay's textarea, a color picker's hex input, and so on.
 *  There, Delete deletes a character, never the object. */
export function isTypingTarget(target: KeyTarget | null): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export interface DeleteShortcutContext {
  /** Physical keyboard present (see isDesktopWeb). */
  desktopWeb: boolean;
  /** The properties panel's Delete button is on screen and would act: the
   *  arrange tool is up, something is selected, and no overlay covers it. */
  deletableSelection: boolean;
  /** Where the keypress landed; null when the event has no element target. */
  target: KeyTarget | null;
}

export function shouldDeleteSelection(e: DeleteKeyEvent, ctx: DeleteShortcutContext): boolean {
  if (!ctx.desktopWeb) return false;
  if (!isDeleteKey(e)) return false;
  if (isTypingTarget(ctx.target)) return false;
  return ctx.deletableSelection;
}
