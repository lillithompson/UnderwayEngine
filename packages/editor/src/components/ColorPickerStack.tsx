import React from 'react';
import type { RGBColor } from '@/engine/types';
import type { ColorPickerSpecFor } from '../colorPickerSpec';
import { ColorPickerModal } from './ColorPickerModal';

// ONE picker per swatch that opens it (see the `colorPickers` table). Every
// one of them gets the eyedropper and — where its target has an alpha channel
// to store it in — the Opacity slider, from the single table rather than from
// nine sets of props that would drift.
//
// Generic over the picker id for `colorPickerSpec`'s reason: each app's table
// is typed in its OWN union, so a row for an id the app does not have is a
// compile error rather than a picker nothing opens.
//
// `insets` is taken structurally rather than as an `EdgeInsets`: the safe-area
// inset is the shell's to read, and `react-native-safe-area-context` is a
// NATIVE dependency this package stays clear of (docs/shared-editor.md §4.3).
export function ColorPickerStack<TId extends string>({
  colorPickers, insets, setColorPreview, noteRecentColor, armEyedropper, recentColors,
}: {
  colorPickers: readonly ColorPickerSpecFor<TId>[];
  insets: { bottom: number };
  setColorPreview: (color: RGBColor | null) => void;
  noteRecentColor: (color: RGBColor) => void;
  armEyedropper: (picker: ColorPickerSpecFor<TId>) => void;
  recentColors?: RGBColor[];
}) {
  return (
    <>
      {colorPickers.map((p) => (
        // A SHEET over the canvas (ToolPopover), like Shapes, Symmetry and
        // Blend: a colour is chosen because of what is on the page, and the
        // full-screen takeover this used to be answered that by hiding the
        // page. Its home-indicator clearance is the shell's own inset.
        <ColorPickerModal
          key={p.id}
          bottomInset={insets.bottom}
          // Only the TOOLBAR swatch's own picker previews there: that disc is
          // the colour this picker sets. A Fill or Border picker reporting
          // into it would have the toolbar promise an active colour nothing
          // is about to set.
          onPreview={p.id === 'color' ? setColorPreview : undefined}
          visible={p.visible}
          initialColor={p.color}
          initialAlpha={p.alpha}
          showOpacity={p.showOpacity}
          // A picker's CLOSE is what files a colour onto the swatch row —
          // one entry per visit, not one per frame of the drag that chose
          // it (activeColor.ts). An opacity-only confirm picked no colour
          // and files none. The preview always lets go, confirmed or not.
          onConfirm={(color, alpha, colorTouched) => {
            setColorPreview(null);
            if (colorTouched) noteRecentColor(color);
            p.confirm(color, alpha, colorTouched);
          }}
          onDismiss={() => { setColorPreview(null); p.close(); }}
          onEyedropper={() => armEyedropper(p)}
          // ONE swatch row for every picker, the same one: the colours last
          // worked in. The toolbar's picker used to be given none (it had a
          // fixed palette instead) — but "what I have been using" is the
          // same question wherever the colour is going.
          recentColors={recentColors}
        />
      ))}
    </>
  );
}
