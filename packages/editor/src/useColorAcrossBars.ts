import { rgbToHexColor } from './colorUtils';
import {
  buildForEachNode, buildSetTextStyle, transformCopyGhosts, type EditorSession,
  type SessionEntry, type TransformCopies,
} from './editorSession';
import { editTargetIds } from './panelModel';
import { COLOR_RADIAL_ERASER } from './sliderModeMenu';
import { TILE_CAPSULE_STROKE_WIDTH, TILE_LIT_INK } from './tileTool';
import { buildTileSvgDataUri, getTileSvgContent } from '@/engine/tileSvg';
import { RGBColor } from '@/engine/types';
import { triggerHaptic } from '@/native-shell/bridge/webBridge';
import {
  useCallback, useMemo, type Dispatch, type SetStateAction,
} from 'react';

// What each bar does with the colour the others share, one callback apiece:
// the Transform bar's ghosted copies, the Text bar's ink, the Choose
// capsule's tile thumbnail, the paint radial's hue row and the light on its
// eraser switch.
//
// They are one hook because they are one CLOSURE — each reads the state
// `useBarColorState` holds and nothing of any bar but its own — not because
// they are one subject. Five hooks here would have five copies of the same
// parameter list and nothing else to tell them apart.
//
// `TILE_LIT_INK` and `TILE_CAPSULE_STROKE_WIDTH` moved to `tileTool.ts`
// with this: they were module constants of all three shells, byte-identical,
// and the Tiles takeover still reads the first one.
//
// **Every function prop must be STABLE.** These callbacks and the ghost memo
// keep the dep arrays they had in the shell — `applyEntry`,
// `noteActiveColor`, `currentColor`, and the four the memo reads — never the
// setters, so any prop passed as an inline lambda would be captured once and
// never refreshed. `onBrushHueRow` is not memoised at all, as in the shell.
// The three shells pass raw `useState` setters and `useCallback` results,
// which is why this holds today; it is a contract of the hook, not an
// accident of its callers.

export function useColorAcrossBars<S extends EditorSession>({
  session, sessionRef, applyEntry,
  currentColor, applyActiveColor, noteActiveColor, setSwatchBounce,
  transformOpen, transformCopiesDraft, setTransformCopiesDraft, fadeTarget,
  setTextColorPickerOpen, vectorEraserArmed,
}: {
  session: EditorSession | null;
  sessionRef: { current: S | null };
  applyEntry: (se: SessionEntry | null) => void;
  currentColor: RGBColor;
  applyActiveColor: (color: RGBColor) => void;
  noteActiveColor: (color: RGBColor) => void;
  setSwatchBounce: Dispatch<SetStateAction<number>>;
  transformOpen: boolean;
  transformCopiesDraft: TransformCopies | null;
  setTransformCopiesDraft: (spec: TransformCopies | null) => void;
  fadeTarget: RGBColor;
  setTextColorPickerOpen: (open: boolean) => void;
  vectorEraserArmed: boolean;
}) {
  const onTransformCopiesPreview = useCallback((spec: TransformCopies | null) => {
    setTransformCopiesDraft(spec);
  }, []);

  // Ghost previews of the copies the draft would lay down, from the SAME
  // geometry the press commits (transformCopyGhosts, which runs whichever
  // builder the press would), off the live state — so they follow the
  // Rotation slider's preview too. Up to TRANSFORM_COPIES_MAX clones of the
  // selection per change: cheap for one object, and a group's run is the
  // same work the press does, done once per setting rather than per frame.
  // Stable ghost ids keep React's keys still between changes.
  const transformGhosts = useMemo(() => {
    if (!transformOpen || !transformCopiesDraft || !session) return null;
    const ids = editTargetIds(session);
    if (ids.length === 0) return null;
    // The same spec the press commits, target included, so a ghost is
    // faded exactly as far as the copy that lands in its place.
    return transformCopyGhosts(
      session.state, ids, { ...transformCopiesDraft, fadeColor: fadeTarget },
    );
  }, [transformOpen, transformCopiesDraft, fadeTarget, session]);

  // The Text bar's color swatch → the same full-screen picker; confirming
  // commits the new text color as one undo step.
  const onPickTextColor = useCallback(() => setTextColorPickerOpen(true), []);

  const onTextColorConfirm = useCallback((
    color: RGBColor, alpha: number, colorTouched = true,
  ) => {
    setTextColorPickerOpen(false);
    if (colorTouched) noteActiveColor(color);
    const s = sessionRef.current;
    if (!s) return;
    // Opaque is spelled "absent" (v55): a slider parked at 100% clears the
    // field rather than persisting a redundant 1.
    const clamped = Math.max(0, Math.min(1, alpha));
    const inkAlpha = clamped < 1 ? clamped : undefined;
    applyEntry(buildForEachNode(s.state, editTargetIds(s), (st, id) => {
      const t = st.texts?.find((x) => x.id === id);
      if (!t) return null;
      // A whole-node font color replaces any per-character brushwork
      // (charColors dropped) — same rule as buildApplyColor's text case. A
      // confirm that only moved the opacity is not a colour statement, so it
      // keeps this text's own ink (and its brushwork with it).
      const { charColors: _brushwork, alpha: _oldAlpha, ...rest } = t.style;
      if (!colorTouched) {
        return buildSetTextStyle(st, id, {
          ...t.style,
          ...(inkAlpha !== undefined ? { alpha: inkAlpha } : { alpha: undefined }),
        });
      }
      return buildSetTextStyle(st, id, {
        ...rest,
        color: { r: color.r, g: color.g, b: color.b },
        ...(inkAlpha !== undefined ? { alpha: inkAlpha } : {}),
      });
    }));
  }, [applyEntry, noteActiveColor]);

  // The Choose capsule's thumbnailer: one sprite in the ACTIVE color — the
  // ink the stamp will be laid in — for the capsule's segments, and the
  // white bake its LIT segment draws on the accent ground instead (see
  // tileChooseCapsuleOptions), both at the capsule's heavier line weight. Keyed on the color, and only ever run while
  // that capsule is up, so a color drag elsewhere bakes nothing.
  const tileInkThumb = useCallback((spriteId: string) => {
    const content = getTileSvgContent(spriteId);
    return content ? {
      uri: buildTileSvgDataUri(content, 44, rgbToHexColor(currentColor), TILE_CAPSULE_STROKE_WIDTH),
      activeUri: buildTileSvgDataUri(content, 44, TILE_LIT_INK, TILE_CAPSULE_STROKE_WIDTH),
    } : null;
  }, [currentColor]);

  /** The brush's hue row (BrushColorRow): live while the thumb drags — the
   *  brush paints in it at once, and the toolbar swatch follows — and once
   *  more as it is let go. The let-go is what PERSISTS the colour; neither
   *  lands on the picker's swatch row, which only a picker's close writes
   *  (activeColor.ts) — a sweep of this handle is one colour chosen, and
   *  filing each step of it laid a gradient across the row. */
  const onBrushHueRow = (color: RGBColor, committed: boolean) => {
    if (!committed) {
      applyActiveColor(color);
      return;
    }
    noteActiveColor(color);
    // Answered where it can be felt: the row is under the toolbar, the
    // swatch that reads the colour is on it.
    triggerHaptic('light');
    setSwatchBounce((n) => n + 1);
  };

  // The Eraser switch lights on that menu while it is on (SliderModeTarget
  // litKeys) — it is no slider mode, so the active key cannot say so.
  const paintMenuLitKeys = vectorEraserArmed ? [COLOR_RADIAL_ERASER] : [];

  return {
    onBrushHueRow, onPickTextColor, onTextColorConfirm, onTransformCopiesPreview,
    paintMenuLitKeys, tileInkThumb, transformGhosts,
  };
}
