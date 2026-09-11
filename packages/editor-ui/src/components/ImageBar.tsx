import React from 'react';
import { ActionRow, BarBody } from './effectBar';
import { RadiusRow } from './BorderBar';

// The Image page: the photo ITSELF, where every other image page is an
// adjustment to it. Replace swaps the pixels behind the node, keeping its
// box, its framing and its place in the scene; Radius rounds the picture's
// own corners.
//
// Both were reached from elsewhere before — Replace from a floating capsule
// that hovered over the canvas, Radius as a row of the Border page, where it
// rounded the IMAGE while everything around it dressed the outline drawn on
// top. They are the image's own controls, so they are on the image's own
// page. A source-resolution caption stood under them for a while and came
// off (2026-09-11): it was a number to read, not a thing to do, on a page
// of things to do.
//
// Replace is an ActionRow: replacing is something you do, not a state the
// image is in. It MUST fire straight out of the press — the host opens a
// file picker, and WebKit only shows the dialog while the gesture's
// activation is live — so nothing here defers it.

const REPLACE_OPTION = [{ value: 'replace' as const, label: 'Replace' }];

export function ImageBar({ cornerRadius, onReplace, onCornerRadius }: {
  /** The picture's corner rounding, a 0–0.5 fraction of the shorter side. */
  cornerRadius: number;
  onReplace: () => void;
  /** `radius` is a 0–0.5 fraction; `committed` marks the drag release (one
   *  undo step) vs. a live preview. */
  onCornerRadius: (radius: number, committed: boolean) => void;
}) {
  return (
    <BarBody>
      <ActionRow options={REPLACE_OPTION} onPress={onReplace} />
      <RadiusRow cornerRadius={cornerRadius} onCornerRadius={onCornerRadius} />
    </BarBody>
  );
}
