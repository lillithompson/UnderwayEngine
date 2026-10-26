import {
  SessionEntry, buildForEachNode, buildSetTextStyle, withState,
  type EditorSession,
} from './editorSession';
import { shouldRememberFont } from './fontPreference';
import { editTargetIds } from './panelModel';
import { textStyleModelToStyle } from './textStyleModel';
import { TextStyleModel } from '@/editor-ui/adapter';
import { applyCompOps } from '@/engine/compositionOps';
import { CompositionState } from '@/engine/types';
import { useCallback } from 'react';

// Writing a text style, and remembering the font it used. The BACK half of
// the default-font group: `onTextStyle` is the live-preview-and-commit
// dance for every text style the editor writes, so it reads the commit
// pipeline, and `rememberFont` writes the app's own store.
//
// `updateSettings` is the app's store handed in — 6.5b.2's rule for what
// the package cannot import. Everything else is one of the four allowed
// inputs or a name `useDefaultFontState` hands back.

export function useDefaultFontCommit<S extends EditorSession>({
  sessionRef, setSession, applyEntry, updateSettings, fontTouchedRef,
  setDefaultFontId, textStyleBaseRef,
}: {
  sessionRef: { current: S | null };
  setSession: (next: S) => void;
  applyEntry: (se: SessionEntry | null) => void;
  updateSettings: (patch: { lastFontId: string }) => Promise<unknown>;
  fontTouchedRef: { current: boolean };
  setDefaultFontId: (id: string) => void;
  textStyleBaseRef: { current: CompositionState | null };
}) {
  // Remember a chosen font so the next new text starts in it: update the
  // session default and persist it (best-effort) as the user setting.
  const rememberFont = useCallback((fontId: string) => {
    fontTouchedRef.current = true;
    setDefaultFontId(fontId);
    void updateSettings({ lastFontId: fontId });
  }, []);

  const onTextStyle = useCallback((m: TextStyleModel, committed: boolean) => {
    const s = sessionRef.current;
    if (!s) return;
    const ids = editTargetIds(s);
    if (ids.length === 0) return;
    // Per target: fold the bar's model into that object's OWN style, so a
    // multi-edit changes the tracked params on every text without flattening
    // the fields the bar doesn't carry.
    const entryFrom = (state: CompositionState): SessionEntry | null =>
      buildForEachNode(state, ids, (st, id) => {
        const t = st.texts?.find((x) => x.id === id);
        if (!t) return null;
        return buildSetTextStyle(st, id, textStyleModelToStyle(m, t.style));
      });
    if (!committed) {
      if (!textStyleBaseRef.current) textStyleBaseRef.current = s.state;
      const se = entryFrom(s.state);
      if (se) setSession(withState(s, applyCompOps(s.state, se.entry)));
      return;
    }
    const base = textStyleBaseRef.current ?? s.state;
    textStyleBaseRef.current = null;
    setSession(withState(s, base));
    applyEntry(entryFrom(base));
    // A committed change that switched the font family becomes the new default
    // for future text (size/color/weight-only commits leave it untouched).
    const prevFontId = base.texts?.find((x) => x.id === ids[0])?.style.fontId;
    if (shouldRememberFont(prevFontId, m.fontId)) rememberFont(m.fontId);
  }, [setSession, applyEntry, rememberFont]);

  return {
    onTextStyle,
  };
}
