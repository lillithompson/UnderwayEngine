import React from 'react';
import type { RGBLike } from '../adapter';
import { BarBody, ColorSliderRow } from './effectBar';

// The rig's Color page: the two colours the sketch shader draws the figure
// in, one hue row each.
//
//  - VOLUMES — the opaque masses (chest, pelvis, palms, feet, head and the
//    joint circles). They paint solid and write depth, so they hide both
//    what the page has behind the figure and the figure's own strokes
//    passing genuinely behind them. Their default is the page's own ground,
//    which is what makes an occluding mass read as bare paper.
//  - OUTLINES — the ink laid over them: every stroke of the drawing.
//
// Volumes first because they are the ground the outlines are drawn ON, and
// because that is the order the renderer paints them in.
//
// Each row is the ordinary hue row every other page colours through
// (ColorSliderRow): the wheel along the track, the colour under the thumb,
// and the circle at the end opening the full picker for a saturation or a
// brightness the track alone cannot reach. That makes this the one page of
// a rig that is not a posture — the reason the tab row is its own list
// rather than the part table (rigEdit's RIG_PAGES).
//
// No Remove, like the pose pages and for the same reason: there is no
// layer here that was ADDED. A figure is always drawn in some pair of
// colours, so "remove" could only mean "back to the defaults", which the
// rows themselves reach.

export function RigColorBar({ volumes, outlines, onColor, onOpenPicker }: {
  volumes: RGBLike;
  outlines: RGBLike;
  /** A hue row moved: live while the handle drags, once more on release
   *  (one undo step). */
  onColor: (which: 'volumes' | 'outlines', color: RGBLike, committed: boolean) => void;
  /** A row's trailing circle: the host's full colour picker. */
  onOpenPicker: (which: 'volumes' | 'outlines') => void;
}) {
  return (
    <BarBody>
      <ColorSliderRow
        label="Volumes"
        color={volumes}
        onColor={(color, committed) => onColor('volumes', color, committed)}
        onOpenPicker={() => onOpenPicker('volumes')}
      />
      <ColorSliderRow
        label="Outlines"
        color={outlines}
        onColor={(color, committed) => onColor('outlines', color, committed)}
        onOpenPicker={() => onOpenPicker('outlines')}
      />
    </BarBody>
  );
}
