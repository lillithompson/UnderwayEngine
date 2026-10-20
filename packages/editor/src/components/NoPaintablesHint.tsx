import React from 'react';
import { Text, View } from 'react-native';
import { FLOATING_CAPSULE_FONT_SIZE, FLOATING_CAPSULE_INK } from '@/editor/components/floatingCapsuleStyle';
import { TOOL_MODE_CAPSULE_Z } from '@/editor/components/ToolModeCapsule';
import { NO_PAINTABLES_HINT } from '../paintBrush';

// ── "No paintable objects" ──────────────────────────────────────────
//
// The recolour brush is the one brush that adds nothing: it rewrites the
// colour of what is already under it. Arm it on a page with nothing it can
// reach — a blank page, or one holding only figures — and
// every stroke is a drag that does nothing, with nothing on screen to say
// why. The brush looks armed, the colour is chosen, and the page simply
// does not take it.
//
// So the canvas says it, plainly, for as long as that is true
// (paintBrush's hasPaintableObjects): put something on the page and the
// line goes by itself.
//
// TEXT, not a card. This is a standing CONDITION, not a refusal — the
// editor's notice card (EditorNotice) is for a press that was refused and
// is gone in a couple of seconds, and a card that never left would read as
// a thing to dismiss. Grey floating words with no ground behind them read
// as the page's own margin note: the same quiet ink the floating capsules
// wear, at their size, so it belongs to the same family of chrome without
// pretending to be a control.
//
// It stands in the row BELOW the capsule slot, where the help mark stands
// — the recolour brush's own scope pill (Fills | Strokes | Patterns) holds
// the slot above whenever this can be up, so the two cannot collide.
//
// Inert: it takes no pointer events, so the canvas under it stays live and
// the very stroke that would do nothing is still free to be tried.

export function NoPaintablesHint({ top }: {
  /** Screen-px top edge — the row under the capsule slot (EditorShell's
   *  chromeBelowCapsuleTop). */
  top: number;
}) {
  return (
    <View
      pointerEvents="none"
      accessibilityRole="alert"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top,
        alignItems: 'center',
        zIndex: TOOL_MODE_CAPSULE_Z,
      }}
    >
      <Text
        style={{
          color: FLOATING_CAPSULE_INK,
          fontSize: FLOATING_CAPSULE_FONT_SIZE,
          // No background, no padding, no radius: the words float.
          backgroundColor: 'transparent',
        }}
      >
        {NO_PAINTABLES_HINT}
      </Text>
    </View>
  );
}
