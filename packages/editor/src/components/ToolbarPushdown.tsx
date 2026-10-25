import React from 'react';
import { HEADER_BG, HEADER_HEIGHT } from '@/editor-ui';

/** The pushdown panel's own height. The strip is a fixed row — what varies
 *  is whether it is down or up, never how tall it is. */
export const PUSHDOWN_HEIGHT = 44;

/**
 * A tool's settings strip that pushes down from under the toolbar while that
 * tool is active — only Text Art's alphabet still uses it (every MODE menu,
 * symmetry included, moved to the floating ToolModeCapsule chrome).
 * It sits INSIDE the toolbar's sliding wrapper so it travels with the bar
 * when the title band dismisses, and below the bar's own zIndex so its
 * retracted state (translated up by its full height) hides behind the opaque
 * toolbar strip — no clipping container needed.
 *
 * The open panel wears a faint hairline along BOTH edges: an inset one at
 * the top (the seam under the toolbar) and a drop one at the bottom (the
 * seam against the canvas). The shadow is dropped entirely while retracted —
 * a retracted sibling's bottom shadow would otherwise leak 1px below the
 * opaque bar and paint a phantom seam over whichever panel IS open.
 */
export function ToolbarPushdown(
  { visible, children }: { visible: boolean; children: React.ReactNode },
) {
  return (
    <div
      style={{
        position: 'absolute', left: 0, right: 0, top: HEADER_HEIGHT, zIndex: 5,
        display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px',
        height: PUSHDOWN_HEIGHT, background: HEADER_BG,
        boxShadow: visible
          ? 'inset 0 1px 0 rgba(0,0,0,0.08), 0 1px 0 rgba(0,0,0,0.08)'
          : 'none',
        transform: visible ? 'translateY(0)' : 'translateY(-100%)',
        transition: 'transform 200ms ease',
        pointerEvents: visible ? 'auto' : 'none',
      }}
      aria-hidden={!visible}
    >
      {children}
    </div>
  );
}
