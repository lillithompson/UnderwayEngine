import { CompositionState, CompositionFigure, RGBColor, SVGObject } from './types';

/**
 * Pattern-fill model (legacy documents)
 * -------------------------------------
 * A "pattern fill" is a mask + tiled-figure composition from the retired
 * Facet-era editor flow: a closed shape (`isMask: true`,
 * `isPatternFill: true`) clips a sibling `tileMode: 'repeat'` figure that
 * covers the shape's bbox, so the shape's interior shows the repeating
 * figure framed by its own outline.
 *
 * Nothing BUILDS these any more — the builder went with the old pattern
 * system — but saved documents still contain them, so the two lookups the
 * render/export/union paths need are kept: resolving the mask↔figure
 * pairing, and the mask's solid background color painted beneath the tiles.
 */

/** The tiled figure backing a pattern-fill mask, looked up by shared group. */
export interface PatternFillInfo {
  figureId: string;
  fileId?: string;
  figureKey: string;
}

/**
 * Locate the `tileMode:'repeat'` figure that a pattern-fill mask clips.
 * Returns null when the mask isn't a grouped pattern fill or no tiled
 * sibling is found.
 */
export function findPatternFillInfo(state: CompositionState, maskId: string): PatternFillInfo | null {
  const mask = state.svgObjects.find((s) => s.id === maskId);
  if (!mask || !mask.isPatternFill || !mask.groupId) return null;
  const fig = state.figures.find((f) => f.groupId === mask.groupId && f.tileMode === 'repeat');
  if (!fig) return null;
  return { figureId: fig.id, fileId: fig.fileId, figureKey: fig.figureKey };
}

/**
 * The solid fill color (if any) to paint behind a pattern-fill tiled figure,
 * looked up from the sibling pattern-fill mask via the shared group. Render
 * paths paint this beneath the tiles so a shape's background color shows
 * through the gaps in the pattern. Returns null when `figure` is not a
 * pattern-fill tile member or its mask carries no `fillColor`. Takes the figure
 * and the scene's svgObjects directly so both the live layer and the SVG export
 * path can call it without assembling a full `CompositionState`.
 */
export function patternFillBackground(
  figure: CompositionFigure,
  svgObjects: readonly SVGObject[],
): { fillColor: RGBColor; fillOpacity?: number } | null {
  if (figure.tileMode !== 'repeat' || !figure.groupId) return null;
  const mask = svgObjects.find((s) => s.groupId === figure.groupId && s.isPatternFill);
  if (!mask || !mask.fillColor) return null;
  return { fillColor: mask.fillColor, fillOpacity: mask.fillOpacity };
}
