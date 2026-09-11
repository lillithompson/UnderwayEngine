import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { formatPixelSize } from '../logic/imageEdit';
import { PANEL_INK_MUTED } from '../theme';
import { ActionRow, BarBody } from './effectBar';
import { RadiusRow } from './BorderBar';

// The Image page: the photo ITSELF, where every other image page is an
// adjustment to it. Replace swaps the pixels behind the node, keeping its
// box, its framing and its place in the scene; Radius rounds the picture's
// own corners; and the line at the foot reads the source resolution, so a
// crop can be judged against the pixels available.
//
// All three were reached from elsewhere before — Replace from a floating
// capsule that hovered over the canvas, the resolution as a caption on the
// Crop page, Radius as a row of the Border page, where it rounded the IMAGE
// while everything around it dressed the outline drawn on top. They are the
// image's own facts, so they are on the image's own page.
//
// Replace is an ActionRow: replacing is something you do, not a state the
// image is in. It MUST fire straight out of the press — the host opens a
// file picker, and WebKit only shows the dialog while the gesture's
// activation is live — so nothing here defers it.

const REPLACE_OPTION = [{ value: 'replace' as const, label: 'Replace' }];

export function ImageBar({ pixelSize, cornerRadius, onReplace, onCornerRadius }: {
  /** Source resolution of the selected image; omitted (or degenerate) hides
   *  the line rather than reading `0 × 0 px`. */
  pixelSize?: { width: number; height: number };
  /** The picture's corner rounding, a 0–0.5 fraction of the shorter side. */
  cornerRadius: number;
  onReplace: () => void;
  /** `radius` is a 0–0.5 fraction; `committed` marks the drag release (one
   *  undo step) vs. a live preview. */
  onCornerRadius: (radius: number, committed: boolean) => void;
}) {
  const resolution = formatPixelSize(pixelSize);
  return (
    <BarBody>
      <ActionRow options={REPLACE_OPTION} onPress={onReplace} />
      <RadiusRow cornerRadius={cornerRadius} onCornerRadius={onCornerRadius} />
      {resolution ? (
        <Text style={styles.resolution} accessibilityLabel={`Image resolution ${resolution}`}>
          {resolution}
        </Text>
      ) : null}
    </BarBody>
  );
}

const styles = StyleSheet.create({
  // Informational only, so it is dimmer than a row label and centred under
  // the button rather than sitting in a control column.
  resolution: {
    marginTop: 8,
    textAlign: 'center',
    color: PANEL_INK_MUTED,
    fontSize: 11,
  },
});
