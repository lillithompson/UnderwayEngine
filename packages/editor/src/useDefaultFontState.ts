import { resolveDefaultFontId } from './fontPreference';
import { type CommonEditorConfig } from './formats/editorConfig';
import { CompositionState } from '@/engine/types';
import { useRef, useState } from 'react';

// The font the next text is born in, whether the reader has ever chosen
// one, and the state a style drag began from.
//
// The FRONT half of the 5-statement default-font group, the other one
// §4.2 item 6 held twice: its handlers read `applyEntry`, and this state
// is read back by an effect long before that. Cut at the pipeline — the
// same seam 6.5b.3 cut the colour complex at — and both halves place in
// all three apps.

export function useDefaultFontState({ config }: {
  config: Pick<CommonEditorConfig, 'openingFontId'>;
}) {
  // The font new text starts in — seeded from the persisted last-chosen font
  // (AppSettings.lastFontId) and updated whenever the user picks a font. The
  // ref guards the async seed from clobbering a font chosen before it resolves.
  // A format may name the face its pages open in (config.openingFontId —
  // Storytime's storybook serif), which outranks the remembered font; seeded
  // here too, not only in the async effect, so the first word typed before the
  // settings read resolves still lands in it.
  const [defaultFontId, setDefaultFontId] = useState(
    () => resolveDefaultFontId(undefined, config.openingFontId),
  );

  const fontTouchedRef = useRef(false);

  // Text style edit: live preview via non-undoable withState, release commits
  // one step from the pre-drag snapshot — the same coalescing as the effect
  // bars / corner radius / live text edit.
  const textStyleBaseRef = useRef<CompositionState | null>(null);

  return {
    defaultFontId, fontTouchedRef, setDefaultFontId, textStyleBaseRef,
  };
}
