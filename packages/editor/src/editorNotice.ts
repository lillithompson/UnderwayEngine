import { useCallback, useEffect, useRef, useState } from 'react';
import { triggerHaptic } from '@/native-shell/bridge/webBridge';

// The editor notice's state and timing (the card itself is
// components/EditorNotice.tsx — JSX-free here so the logic tests plainly).

/** How long a notice stands, keyframe and unmount alike. */
export const NOTICE_MS = 2600;

/** The card's text, a good step up from the floating capsules' 11px: this
 *  is a sentence to read, not a label on a control. */
export const NOTICE_FONT_SIZE = 17;

/** How wide the card may get, screen px. Sized so the refusals the games
 *  actually raise — the longest is Creature's "End at least two lines on
 *  the dotted line" — break over TWO lines rather than running as one long
 *  bar. A longer sentence simply takes another line; nothing is clamped. */
export const NOTICE_MAX_WIDTH = 260;

/** The card's corner radius. Rounded, but a card's corners rather than a
 *  pill's — well under half the card's height, so the sides read straight. */
export const NOTICE_RADIUS = 18;

export interface EditorNoticeState {
  text: string;
  /** Bumped per show: the keyed remount that restarts the keyframe. */
  key: number;
}

/** The notice's state and the one way to raise it. The timer is the
 *  hook's: each show resets it, and unmount clears it. */
export function useEditorNotice(): {
  notice: EditorNoticeState | null;
  /** `quiet`: the card without the knock — for a line that REPORTS what
   *  happened ("Undid: Cycle") rather than refusing a press. Sol's addition,
   *  adopted here as the superset the way 5b.4 took the other two apps'
   *  canvas additions: optional, so it costs the apps that had none
   *  nothing. */
  showNotice: (text: string, opts?: { quiet?: boolean }) => void;
} {
  const [notice, setNotice] = useState<EditorNoticeState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNotice = useCallback((text: string, opts?: { quiet?: boolean }) => {
    // A knock on the finger with the words. Every notice the editor raises
    // is a refusal — nothing here ever says well done — and the press that
    // earned it looked from the hand exactly like a press that worked, so
    // the tap is what tells the two apart before the eye gets to the card.
    // 'heavy' rather than the lighter taps the editor spends on things
    // that DID happen (a connection point landing, a pattern baked): this
    // one is a no. The exception is a line that REPORTS rather than
    // refuses — Sol's undo notice (solOpLabel) — which asks for `quiet`.
    if (!opts?.quiet) triggerHaptic('heavy');
    if (timer.current) clearTimeout(timer.current);
    setNotice((prev) => ({ text, key: (prev?.key ?? 0) + 1 }));
    timer.current = setTimeout(() => { timer.current = null; setNotice(null); }, NOTICE_MS);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return { notice, showNotice };
}

