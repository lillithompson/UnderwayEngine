// The paint-island option row the ObjectPropertiesPanel shows when a paint
// island (raster brushwork scene object) is selected. Kept pure (no
// react-native) so the option set is unit-tested in node, mirroring
// imageEdit.ts / svgEdit.ts.

/** The paint-island editing actions, in display order. An island is baked
 *  raster brushwork with a transparent background: there is no Stroke or
 *  Fill to edit (that's what makes it a paint island and not a shape), so
 *  its ONE type option is Opacity — the shared Opacity bar (whole-object
 *  opacity + edge soften), exactly the image's. */
export type PaintEditAction = 'opacity';

export interface PaintEditOption {
  action: PaintEditAction;
  /** Short caption under the icon. */
  label: string;
  /** MaterialCommunityIcons glyph name. */
  icon: string;
}

export const PAINT_EDIT_OPTIONS: readonly PaintEditOption[] = [
  { action: 'opacity', label: 'Opacity', icon: 'opacity' },
];
