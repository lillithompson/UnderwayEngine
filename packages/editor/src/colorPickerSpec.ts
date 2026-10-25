import type { RGBColor } from '@/engine/types';

// The editor's open COLOUR PICKERS, as the shell builds them each render.
// One picker component serves every swatch in the editor, so the shell
// keeps a table — one row per swatch that can open it — and the row says
// what the picker opens on and what to do with what comes back. The
// eyedropper reads the same table, which is how it knows where to commit a
// colour it sampled on another row's behalf.

/**
 * Which swatch opened the picker, for the swatches every Underway editor
 * has. An app's own `ColorPickerId` is this union plus its own ids —
 * CozyJournal's rig Color page writes two (`rigVolumes`, `rigOutlines`),
 * DrawBots' Pen page one (`botPen`) — the arrangement 6.3b's
 * `CommonEditorConfig` uses for a type whose shared half is most of it.
 */
export type CommonColorPickerId =
  | 'color' | 'shadow' | 'border' | 'stroke'
  // The Effects page's two glows — one id each, because the picker commits
  // through the row that opened it and the two write different slots.
  | 'glowOuter' | 'glowInner'
  | 'tint' | 'svgFill' | 'text' | 'radial' | 'frameBg'
  // The Opacity page's Fade row: the colour every colour walks toward.
  | 'fade'
  // The Pattern page's Stroke section: the ink the TILES are drawn in.
  | 'svgPatternStroke';

/**
 * One row of that table: everything the shared picker needs, and everything
 * the eyedropper needs to commit on its behalf.
 *
 * Generic over the id so each app's table is typed in its OWN union: a row
 * for an id the app does not have is then a compile error rather than a
 * picker nothing ever opens.
 */
export interface ColorPickerSpecFor<TId extends string> {
  id: TId;
  visible: boolean;
  /** The color this target already wears — where the wheel opens. */
  color: RGBColor;
  /** That color's current opacity — where the slider opens. */
  alpha: number;
  /** False when the target has no alpha channel (text color, border color):
   *  the slider is hidden rather than offering an opacity that gets dropped. */
  showOpacity: boolean;
  /** `colorTouched` is false when the only thing the reader moved was the
   *  opacity slider — see ColorPickerModal.onConfirm. A confirm that fans
   *  out over a multi-selection must leave every member's own colour alone
   *  then, and write the opacity by itself. */
  confirm: (color: RGBColor, alpha: number, colorTouched: boolean) => void;
  close: () => void;
}

/** The row as an app with no pickers of its own spells it. */
export type ColorPickerSpec = ColorPickerSpecFor<CommonColorPickerId>;
