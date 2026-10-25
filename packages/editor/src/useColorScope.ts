import { useCallback, useRef, useState } from 'react';
import { DEFAULT_COLOR_SCOPE, type ColorScope } from './paintBrush';

// The recolour brush's AIM — fills, strokes, pattern cells, or one of those
// per object — with the two refs that make it readable without a dep and
// restorable after a pattern edit has borrowed it.
//
// Session state, like the brush size: an aim you took stays taken while the
// page is open. Nothing of any app is in it, which is why it comes out whole.

export function useColorScope() {
  // ── The recolour brush's aim ──────────────────────────────────────
  // What a Color pass writes: fills, strokes or pattern cells — or 'any',
  // one of those per object (ColorScope),
  // picked from a capsule under the toolbar that stands only while that
  // brush is armed. The three partition everything the brush can reach, so
  // the pick is a genuine aim rather than a filter — and the brush needed
  // one: a drag across a filled shape used to set its fill AND every border
  // segment it crossed, with no way to ask for either alone. Session state
  // like the brush size beside it — an aim you took stays taken while the
  // page is open.
  const [colorScope, setColorScope] = useState<ColorScope>(DEFAULT_COLOR_SCOPE);

  // …readable by the callbacks that BORROW the aim without listing it as a
  // dep (opening a shape's cloth for editing points it at Patterns).
  const colorScopeRef = useRef<ColorScope>(colorScope);
  colorScopeRef.current = colorScope;

  /** The aim the pattern edit borrowed the capsule FROM — what goes back
   *  when it is done with it — or null when nothing is borrowed.
   *
   *  Opening a shape's cloth (onEditTilePattern) points the brush at
   *  Patterns: the whole of that mode is working on the cells, so a reach
   *  for the recolour brush from inside it means the cells, and an aim left
   *  on Fills would repaint the shape's body instead — the one thing the
   *  cloth is covering.
   *
   *  Forgotten the moment the user picks an aim themselves
   *  (onPickColorScope): an aim they took outlives the edit that borrowed
   *  this one, the same rule reaimedColorScope goes by. */
  const colorScopeBeforePatternEditRef = useRef<ColorScope | null>(null);

  /** Pick an aim from the capsule. Identical to setColorScope but for the
   *  memory above: a deliberate pick is the user's, so there is no longer
   *  anything of theirs to put back. */
  const onPickColorScope = useCallback((scope: ColorScope) => {
    colorScopeBeforePatternEditRef.current = null;
    setColorScope(scope);
  }, []);

  return {
    colorScope, colorScopeBeforePatternEditRef, colorScopeRef, onPickColorScope,
    setColorScope,
  };
}
