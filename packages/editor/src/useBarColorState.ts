import { DEFAULT_ACTIVE_COLOR, storedActiveColor, toRGB } from './activeColor';
import {
  openingNewShapeStyle, type EditorSession, type NewShapeStyle,
  type TransformCopies,
} from './editorSession';
import { type CommonEditorConfig } from './formats/editorConfig';
import { FADE_DEFAULT_COLOR } from '@/engine/fade';
import { RGBColor } from '@/engine/types';
import { useCallback, useRef, useState } from 'react';

// The colour state the property bars SHARE — the active ink, the style the
// next shape is born in, and the flag for whichever bar has the full-screen
// picker open.
//
// This is the FRONT HALF of the colour-and-effects component §4.2 item 6 held
// back twice, and it is a half because the whole does not place. The handlers
// read `applyEntry` — the shell's commit pipeline, two hundred statements
// into the body — while this state is read seventy-five statements BEFORE
// that, by the fade sync and the colour effects. React hook order is a total
// order, so no single call site exists, in any of the three apps. Cut here,
// both halves place with room to spare, and the four bar hooks take THIS
// hook's return instead of the fifty-member context object §4.3 declined to
// invent: every input of all four is either one of the four allowed inputs or
// a name returned below.
//
// `updateSettings` is the app's store, handed in — 6.5b.2's rule for
// `useEyedropper`, and for the same reason: the active colour outlives the
// page (AppSettings.lastColor) and the package names no app's store.
// `config` is the format's opening style, narrowed to the two fields
// `openingNewShapeStyle` already takes.

export function useBarColorState({
  config, session, updateSettings,
}: {
  config: Pick<CommonEditorConfig, 'openingShapeStyle' | 'openingStrokeWidthPt'>;
  session: EditorSession | null;
  updateSettings: (patch: { lastColor: string }) => Promise<unknown>;
}) {
  // The active color: what the toolbar swatch shows and what every new stroke
  // (draw / line / arc) and border starts in. Mirrored into a ref so the
  // callbacks that materialize a default border can read the latest pick
  // without being rebuilt on every color change.
  const [currentColor, setCurrentColor] = useState<RGBColor>(DEFAULT_ACTIVE_COLOR);

  const currentColorRef = useRef<RGBColor>(DEFAULT_ACTIVE_COLOR);

  // Guards the async seed below from landing on a color picked before it
  // resolved — the same race fontTouchedRef guards for the font.
  const colorTouchedRef = useRef(false);

  // Adopt a color without remembering it: the seed path.
  const applyActiveColor = useCallback((color: RGBColor) => {
    const rgb = toRGB(color);
    currentColorRef.current = rgb;
    setCurrentColor(rgb);
  }, []);

  // Bumped when a colour is confirmed AWAY from the toolbar swatch (the paint
  // radial's swatch capsule); the swatch bounces once per bump (TopBar).
  const [swatchBounce, setSwatchBounce] = useState(0);

  // The recolour brush's ERASER (bug report 6b36fe8b) — the last option on
  // its radial menu (COLOR_ERASER_OPTION): while on, a Color stroke cuts
  // the paths it crosses instead of restaining them (vectorEraser.ts), and
  // the toolbar swatch wears the eraser, since the brush lays no colour.
  // Kept while the page is open, like the brush's size and aim; it acts —
  // and the swatch shows it — only while the Color brush is in hand.
  // Confirming a colour turns it off (noteActiveColor): an ink chosen is
  // an ink to paint with.
  const [colorEraser, setColorEraser] = useState(false);

  // Every colour confirmed from any tool's settings becomes the active one,
  // and is remembered across pages (AppSettings.lastColor) so the next file of
  // any format opens in it. One write per CONFIRMED pick — these are discrete
  // commits (a picker's confirm, a swatch tap), not per-frame drag updates,
  // and the pattern studio dedupes before it reports.
  const noteActiveColor = useCallback((color: RGBColor) => {
    colorTouchedRef.current = true;
    setColorEraser(false);
    applyActiveColor(color);
    void updateSettings({ lastColor: storedActiveColor(color) });
  }, [applyActiveColor]);

  // The style the next drawn shape is born in — see NewShapeStyle. Updated
  // by the Fill and Stroke bars as the user dresses a shape, so the next one
  // arrives already dressed.
  // …opening at the weight the FORMAT asks for, where one does
  // (config.openingStrokeWidthPt — the Response's marks are read at 40pt).
  // A starting point, not a lock: the first width the user sets replaces
  // it and is remembered as usual, exactly as the opening colour is.
  // The format states PT, the readout's own unit, and the memory holds
  // world cells — openingNewShapeStyle is the one place that converts.
  // …and in the fill / outline the format's closed shapes are born with
  // (config.openingShapeStyle — Shadows deals filled, unoutlined cut-outs),
  // the same kind of starting point.
  const [newShapeStyle, setNewShapeStyle] = useState<NewShapeStyle>(
    () => openingNewShapeStyle(config.openingStrokeWidthPt, config.openingShapeStyle),
  );

  // Picking a colour for the BRUSH is a general "this is the ink now", so it
  // supersedes the two inks the shape bars remembered — otherwise the next
  // shape would come up in a colour the user has visibly moved on from. Only
  // the colours go: filled / outlined / width are shape, not ink.
  const clearNewShapeInk = useCallback(() => {
    setNewShapeStyle((prev) => (
      prev.fill === undefined && prev.strokeColor === undefined
        ? prev
        : { ...prev, fill: undefined, strokeColor: undefined }
    ));
  }, []);

  const [transformOpen, setTransformOpen] = useState(false);

  // The Transform bar's live Create copies draft (count, offsets), or null
  // when the bar is away or its last press has just landed — what the canvas
  // ghosts (see transformGhosts below).
  const [transformCopiesDraft, setTransformCopiesDraft] = useState<TransformCopies | null>(null);

  const [shadowColorPickerOpen, setShadowColorPickerOpen] = useState(false);

  const [fadeColorPickerOpen, setFadeColorPickerOpen] = useState(false);

  // The Fade row's target: what its slider walks the object's colours
  // TOWARD. A fade is spent into those colours and nothing is stored
  // (engine/fadeBake.ts), so the target has nowhere in the record to live —
  // it is the editor's, like the active colour, and stands until it is
  // picked again. White is the page's own paper, which is what the first
  // pull of the slider means.
  const [fadeTarget, setFadeTarget] = useState<RGBColor>(FADE_DEFAULT_COLOR);

  const fadeTargetRef = useRef<RGBColor>(FADE_DEFAULT_COLOR);

  fadeTargetRef.current = fadeTarget;

  const [borderColorPickerOpen, setBorderColorPickerOpen] = useState(false);

  const [strokeColorPickerOpen, setStrokeColorPickerOpen] = useState(false);

  const [textColorPickerOpen, setTextColorPickerOpen] = useState(false);

  const [svgFillColorPickerOpen, setSvgFillColorPickerOpen] = useState(false);

  // The Eraser switch acts only while the Color brush is the tool in hand.
  const vectorEraserArmed = colorEraser && session?.activeTool === 'color';

  return {
    applyActiveColor, borderColorPickerOpen, clearNewShapeInk, colorTouchedRef,
    currentColor, currentColorRef, fadeColorPickerOpen, fadeTarget, fadeTargetRef,
    newShapeStyle, noteActiveColor, setBorderColorPickerOpen, setColorEraser,
    setFadeColorPickerOpen, setFadeTarget, setNewShapeStyle,
    setShadowColorPickerOpen, setStrokeColorPickerOpen, setSvgFillColorPickerOpen,
    setSwatchBounce, setTextColorPickerOpen, setTransformCopiesDraft,
    setTransformOpen, shadowColorPickerOpen, strokeColorPickerOpen,
    svgFillColorPickerOpen, swatchBounce, textColorPickerOpen, transformCopiesDraft,
    transformOpen, vectorEraserArmed,
  };
}
