import { type EditorSession } from './editorSession';
import { type Dispatch, type SetStateAction, useCallback } from 'react';
import type { CaretSeek } from './useTextCaretState';

// Moving the caret, and the guard that keeps a seek from committing the
// edit. The BACK half of the caret group (see `useTextCaretState`): every
// one of these reads the session, which is why they cannot stand where
// that state does.
//
// **Every callback is STABLE** and keeps the `useCallback` deps it had in
// the shell. Every input is one of the four the measurement allows or a
// name `useTextCaretState` hands back — so the context object this plan
// refused to invent is, once again, the front hook's own documented
// return rather than something anyone had to design.

export function useTextCaretSeek<S extends EditorSession>({
  sessionRef, caretSeekPendingRef, setEditingSelection, setCaretSeek,
  editingTextIdRef,
}: {
  sessionRef: { current: S | null };
  caretSeekPendingRef: { current: boolean };
  setEditingSelection: (caret: number, anchor?: number) => void;
  setCaretSeek: Dispatch<SetStateAction<CaretSeek | null>>;
  editingTextIdRef: { current: string | null };
}) {
  const armCaretSeekBlurGuard = useCallback(() => {
    caretSeekPendingRef.current = true;
    setTimeout(() => { caretSeekPendingRef.current = false; }, 0);
  }, []);

  const onCaretSeek = useCallback((utf16: number) => {
    armCaretSeekBlurGuard();
    setEditingSelection(utf16);
    setCaretSeek((prev) => ({ start: utf16, end: utf16, seq: (prev?.seq ?? 0) + 1 }));
  }, [armCaretSeekBlurGuard, setEditingSelection]);

  // A double tap on the text being edited: select ALL of it (the text-field
  // convention), so the next keystroke replaces the whole line. The range
  // rides the same seek plumbing a caret move does — same focus keep, same
  // blur guard — with the length read off the LIVE session text (each
  // keystroke writes it through withState), the same source commit reads.
  const onSelectAllText = useCallback((textId?: string) => {
    const s = sessionRef.current;
    // The id is passed on the web path, where the editor was (re)opened in
    // this very tick and the render-mirrored ref is still one step behind.
    const id = textId ?? editingTextIdRef.current;
    const text = id ? s?.state.texts?.find((t) => t.id === id) : null;
    if (!text) return;
    armCaretSeekBlurGuard();
    // The caret sits at the END of the range and the anchor at its start,
    // which is where a text field leaves them after Select All — and what
    // makes the node paint the whole line.
    setEditingSelection(text.content.length, 0);
    setCaretSeek((prev) => ({ start: 0, end: text.content.length, seq: (prev?.seq ?? 0) + 1 }));
  }, [armCaretSeekBlurGuard, setEditingSelection]);

  const isCaretSeekBlur = useCallback(() => caretSeekPendingRef.current, []);

  return {
    isCaretSeekBlur, onCaretSeek, onSelectAllText,
  };
}
