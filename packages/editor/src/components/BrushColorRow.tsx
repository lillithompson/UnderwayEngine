import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { RGBColor } from '@/engine/types';
import { ColorSliderRow } from '@/editor-ui/components/effectBar';
import { SLIDER_CONTROL } from '@/editor-ui/logic/submenuHeight';
import { TOOL_MODE_CAPSULE_Z } from './ToolModeCapsule';
import { FLOATING_ROW_TRACK_W } from './floatingRowTrack';

// The brush's COLOUR, in the radial menu's second-level slot: the property
// pages' own hue row (editor-ui's ColorSliderRow — the wheel along the
// track, the colour under the thumb, and the circle at the end opening the
// full picker), floated under the toolbar where the fan's capsule stands.
//
// It replaces a capsule of six fixed swatches. Six named inks are a
// keyboard muscle memory can learn, but they are also the ONLY six: every
// other colour meant the More doorway and a modal over the page, which is
// the reach the second level exists to save. A hue row has no list to run
// out of — the whole wheel is one drag — and it is the control the user
// already colours everything else through, so nothing here is a second
// vocabulary for the same choice.
//
// Saturation and brightness stay where they are (logic/hsv's withHue), as
// on every other page: the row moves the HUE, and the trailing circle
// opens the picker for the rest. That is what keeps it a quick reach
// rather than a second picker.
//
// It floats UNDECORATED — no pill, no caption. The pill and the word
// "Color" were the capsule's clothes on a control that is not a capsule:
// a slider needs no border to be grabbable, and the only thing that can be
// coloured while the colour fan is open is the brush, so the caption named
// what the tool had already named. What is left over the page is the wheel
// and the swatch, which is the whole control.

/** The track's width — the brush slider's own (BrushControlsPanel's
 *  TRACK_W), so the two controls a painting hand moves between are the
 *  same size. Named once in floatingRowTrack, which every row that floats
 *  in this slot reads. */
const TRACK_W = FLOATING_ROW_TRACK_W;

/** How tall the floated row stands, for the chrome that has to clear it —
 *  the bare control line, the row having no caption over it. */
export const BRUSH_COLOR_ROW_HEIGHT = SLIDER_CONTROL;

export function BrushColorRow({ top, color, onColor, onOpenPicker }: {
  /** Screen px the pill's top edge sits at — under the toolbar, the
   *  capsule's own line. */
  top: number;
  color: RGBColor;
  /** The hue the row landed on: live while the thumb drags, once more as
   *  it is let go (`committed`). */
  onColor: (color: RGBColor, committed: boolean) => void;
  /** The trailing circle: the brush's full colour picker. */
  onOpenPicker: () => void;
}) {
  return (
    <View pointerEvents="box-none" style={[styles.slot, { top }]}>
      <View style={styles.track}>
        <ColorSliderRow
          label="Color"
          hideLabel
          color={color}
          onColor={(next, committed) => onColor(
            { r: next.r, g: next.g, b: next.b }, committed,
          )}
          onOpenPicker={onOpenPicker}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: TOOL_MODE_CAPSULE_Z,
  },
  track: { width: TRACK_W },
});
