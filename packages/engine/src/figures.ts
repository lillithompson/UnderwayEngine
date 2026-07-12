export interface PaletteItem {
  key: string;
  label: string;
  source: number | null;
  dataUri: string | null;
  resolutionX: number;
  resolutionY: number;
  isBaked: boolean;
  fileId?: string;
  contentHash?: string;
  /** Present when this palette entry represents a saved SVG design. */
  svgDesignId?: string;
}
