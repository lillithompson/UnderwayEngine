import React from 'react';
import {
  NOTICE_FONT_SIZE, NOTICE_MAX_WIDTH, NOTICE_MS, NOTICE_RADIUS,
  type EditorNoticeState,
} from '../editorNotice';
import { NOTICE_Z } from '../overlayZ';
import { FLOATING_CAPSULE_BG, FLOATING_CAPSULE_INK } from './floatingCapsuleStyle';

// ── The editor's refusal card ───────────────────────────────────────
// The one word the editor says back when a press is refused or a step is
// missing — "End at least two lines on the dotted line", "You cannot
// delete the Reimagine seed", "Stay in your half". EVERY refusal, in
// every game, wears this: the shell raises them all through one hook
// (editorNotice's showNotice), so there is a single place for the look
// and no game can drift its own.
//
// A CARD, not a pill: rounded corners on a squarish block, with the
// sentence set large and broken over about two lines. The one-line pill
// this replaced was the size of a piece of chrome and read like one —
// something to glance past — where this is the editor saying no, and it
// has to be read. The width is the whole of the line-breaking: no clamp,
// no ellipsis, so a longer sentence takes a third line rather than
// losing its end.
//
// It is up for NOTICE_MS and gone — no button, no dismissal, nothing to
// tap through. It takes no pointer events, so the canvas under it stays
// live.
//
// It is the TOP layer of the editor (overlayZ's NOTICE_Z) and the shell
// renders it last: a refusal raised from inside a full-screen overlay —
// a response's send that did not land — has to be readable over it.
//
// The show and the hide are ONE compositor keyframe on the card (opacity
// + a small settle), and the only JS is the timer that unmounts it: no
// per-frame work (the 90 fps rule). Re-showing while one is up swaps the
// text and restarts the run (keyed remount), so a second refusal reads as
// a second notice, not a stale one. The tap on the finger goes with the
// raise, not the render, so it lands once per refusal (editorNotice.ts).

const KEYFRAMES = `@keyframes cj-editor-notice {
  0% { opacity: 0; transform: translate(-50%, -6px); }
  8% { opacity: 1; transform: translate(-50%, 0); }
  82% { opacity: 1; transform: translate(-50%, 0); }
  100% { opacity: 0; transform: translate(-50%, 0); }
}`;

export function EditorNotice({ notice, top }: {
  notice: EditorNoticeState | null;
  /** Screen-px top edge — the slot under the toolbar (EditorShell's
   *  underToolbarTop), where the mode capsules stand. */
  top: number;
}) {
  if (!notice) return null;
  return (
    <div
      key={notice.key}
      data-editor-notice=""
      role="status"
      style={{
        position: 'absolute',
        left: '50%',
        top,
        transform: 'translate(-50%, 0)',
        maxWidth: NOTICE_MAX_WIDTH,
        padding: '14px 20px',
        borderRadius: NOTICE_RADIUS,
        background: FLOATING_CAPSULE_BG,
        color: FLOATING_CAPSULE_INK,
        fontSize: NOTICE_FONT_SIZE,
        lineHeight: 1.3,
        fontWeight: 600,
        textAlign: 'center',
        // Wraps, and wraps EVENLY: two lines of a length apiece reads as a
        // sentence, where a full line over a two-word orphan reads as a
        // line that ran out of room.
        whiteSpace: 'normal',
        textWrap: 'balance',
        boxShadow: '0 2px 10px rgba(58, 53, 50, 0.18)',
        zIndex: NOTICE_Z,
        pointerEvents: 'none',
        animation: `cj-editor-notice ${NOTICE_MS}ms ease both`,
      }}
    >
      <style>{KEYFRAMES}</style>
      {notice.text}
    </div>
  );
}
