import { CompositionState, CompositionFigure, GridLevel, RGBColor, SVGObject } from './types';
import { PaletteItem } from './figures';
import { applyCompOps, computeSVGBbox } from './compositionOps';
import { clampToLayerLevel, compSnapStep } from './compositionCellMath';
import { nextFigureName, nextGroupName } from './sceneOutlineHelpers';

/** Pattern-size slider range: one repeat spans 1–4 cells at the current grid. */
export const MIN_PATTERN_SIZE = 1;
export const MAX_PATTERN_SIZE = 4;

/**
 * Order pattern items most-recently-used first for the pattern picker and the
 * banner swatches. `usageOrder` is a list of palette keys, most-recent first;
 * `selectedKey` (if any) is forced to the very front so the active pattern
 * always leads. Items absent from `usageOrder` keep their incoming relative
 * order (stable) behind the used ones. Pure — does not mutate `items`.
 */
export function orderPatternsByUsage<T extends { key: string }>(
  items: T[],
  usageOrder: readonly string[],
  selectedKey: string | null,
): T[] {
  const rank = new Map<string, number>();
  usageOrder.forEach((k, i) => rank.set(k, i));
  const rankOf = (key: string): number =>
    key === selectedKey ? -1 : rank.get(key) ?? Number.POSITIVE_INFINITY;
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const d = rankOf(a.item.key) - rankOf(b.item.key);
      return d !== 0 ? d : a.i - b.i;
    })
    .map((x) => x.item);
}

/** Tile edge in L0 cells for a pattern that spans `patternSize` cells at the
 *  given composition grid level. One grid cell is `compSnapStep(gridLevel)` L0
 *  cells, so the meaning of "2" changes with the selected grid — by design. */
export function patternTileSizeL0(patternSize: number, gridLevel: number): number {
  const n = Math.max(MIN_PATTERN_SIZE, Math.min(MAX_PATTERN_SIZE, Math.round(patternSize)));
  return n * compSnapStep(gridLevel);
}

/** Recover the pattern-size slider value (1–4) from a tiled figure's L0 box
 *  edge at the given grid level. Pass the *longer* tile dimension (which spans
 *  the full N×N box); inverse of {@link patternTileSizeL0}. */
export function patternSizeFromTileL0(tileL0: number | undefined, gridLevel: number): number {
  if (!tileL0) return MIN_PATTERN_SIZE;
  const n = Math.round(tileL0 / compSnapStep(gridLevel));
  return Math.max(MIN_PATTERN_SIZE, Math.min(MAX_PATTERN_SIZE, n));
}

/**
 * Pattern-fill model
 * ------------------
 * A "pattern fill" is the existing mask + tiled-figure composition, not a new
 * render path: a closed shape (`isMask: true`, `isPatternFill: true`) clips a
 * sibling `tileMode: 'repeat'` figure that covers the shape's bbox. Grouping
 * the two makes the mask clip the figure, so the shape's interior shows the
 * repeating figure framed by the shape's own outline.
 *
 * `buildPatternFillScene` constructs that group from a *base* state whose shape
 * is loose (ungrouped, no fill figure). The editor rebuilds the draft from base
 * on every swatch change, so this stays a pure function over (base, mask, item).
 */

/** Stable ids for the figure + group a pattern fill creates. Passed in (not
 *  generated here) so the result is deterministic for tests and so an edit can
 *  reuse the existing ids when rebuilding the draft. */
export interface PatternFillIds {
  figureId: string;
  groupId: string;
}

/**
 * Set the baked-figure placement fields (`fileId`, `placementLevel`,
 * `figureKey`) on a freshly-built figure, mirroring the Place tool's
 * resolution. Tile-mode figures bake at the clamped composition grid level;
 * non-tile at L0. Mutates `figure` in place (matches `resolveAndPlace`). A
 * no-op for non-baked (SVG-design) items, which keep `figureKey = item.key`.
 */
export function resolveFigurePlacement(
  figure: CompositionFigure,
  item: PaletteItem | undefined,
  gridLevel: number,
): void {
  if (item?.isBaked && item.fileId) {
    figure.fileId = item.fileId;
    const level = figure.tileMode === 'repeat' ? clampToLayerLevel(gridLevel) : (0 as GridLevel);
    figure.placementLevel = level;
    figure.figureKey = `file_${item.fileId}_L${level}`;
  }
}

/**
 * Build the pattern-fill scene: a `tileMode:'repeat'` figure covering the
 * mask's bbox, grouped with the mask, with the mask flagged as a pattern fill.
 *
 * `base` must contain the mask as a loose (ungrouped) shape. One repeat spans
 * `patternSize` cells at `gridLevel` (a square N×N tile); the figure's region
 * equals the mask bbox. The figure is inserted immediately before the mask in
 * `sceneOrder` so the mask's outline paints on top of the fill. The mask's
 * solid `fillColor`/`fillOpacity` are preserved: render paths draw that color
 * as the tiled figure's background (beneath the tiles, framed by the outline),
 * so a shape with a background color shows both the color and the pattern.
 */
export function buildPatternFillScene(
  base: CompositionState,
  maskId: string,
  item: PaletteItem,
  gridLevel: number,
  ids: PatternFillIds,
  patternSize: number = MIN_PATTERN_SIZE,
): CompositionState {
  const mask = base.svgObjects.find((s) => s.id === maskId);
  if (!mask) return base;

  // Region = mask bbox. The tile fits one whole repeat into an N×N box of grid
  // cells (`patternSize` cells), but preserves the figure's native aspect ratio
  // (resolutionX : resolutionY) so non-square figures aren't stretched — the
  // longer side spans N cells, the shorter side scales down proportionally.
  const box = patternTileSizeL0(patternSize, gridLevel);
  const longer = Math.max(item.resolutionX, item.resolutionY) || 1;
  const tileWidthL0 = box * item.resolutionX / longer;
  const tileHeightL0 = box * item.resolutionY / longer;
  const bbox = computeSVGBbox(mask.segments);
  const figure: CompositionFigure = {
    id: ids.figureId,
    figureKey: item.key,
    name: nextFigureName(base.figures, 'Pattern'),
    cellX: bbox.cellX,
    cellY: bbox.cellY,
    cellWidth: bbox.cellWidth,
    cellHeight: bbox.cellHeight,
    resolutionX: item.resolutionX,
    resolutionY: item.resolutionY,
    tileMode: 'repeat',
    tileWidthL0,
    tileHeightL0,
    // Phase the tile grid so a whole tile is centered on the region (= the
    // shape's bbox), giving symmetric partial tiles at all four edges instead
    // of a full tile pinned to the top-left corner.
    tileOffsetXL0: (bbox.cellWidth - tileWidthL0) / 2,
    tileOffsetYL0: (bbox.cellHeight - tileHeightL0) / 2,
  };
  resolveFigurePlacement(figure, item, gridLevel);

  // Insert the figure just before the mask in paint order (mask outline on top).
  const maskIdx = base.sceneOrder.indexOf(maskId);
  const order = base.sceneOrder.slice();
  order.splice(maskIdx < 0 ? order.length : maskIdx, 0, figure.id);

  const withFigure: CompositionState = {
    ...base,
    figures: [...base.figures, figure],
    sceneOrder: order,
  };

  // Group [figure, mask]. The figure is the named node (it carries the group
  // name and is hidden from the outline anyway), so the mask keeps a clean
  // undefined name and the shape's outline row never shows "Group N".
  // groupFigures re-clusters sceneOrder preserving member order, so the figure
  // stays below the mask.
  const grouped = applyCompOps(withFigure, [{
    op: 'groupFigures',
    figureIds: [figure.id, maskId],
    groupId: ids.groupId,
    groupName: nextGroupName(withFigure.figures),
    oldNames: [figure.name, mask.name],
  }]);

  // Flag the mask: clip siblings, mark as a pattern fill. Its solid
  // `fillColor`/`fillOpacity` are preserved — render paths paint that color as
  // the tiled figure's background so the shape shows both color and pattern.
  const svgObjects = grouped.svgObjects.map((s) => s.id === maskId
    ? { ...s, isMask: true as const, isPatternFill: true as const }
    : s);
  return { ...grouped, svgObjects };
}

/** True when `groupId` is a pattern-fill group — a group whose direct mask
 *  member is flagged `isPatternFill`. Such groups are an implementation detail:
 *  they render as a single shape in the outline and can't be ungrouped. */
export function isPatternFillGroup(state: CompositionState, groupId: string): boolean {
  return state.svgObjects.some((s) => s.groupId === groupId && s.isPatternFill);
}

/** The tiled figure backing a pattern-fill mask, looked up by shared group. */
export interface PatternFillInfo {
  figureId: string;
  fileId?: string;
  figureKey: string;
}

/**
 * Locate the `tileMode:'repeat'` figure that a pattern-fill mask clips, so the
 * editor can preselect the current swatch and reuse the figure/group ids when
 * re-entering pattern-fill mode. Returns null when the mask isn't a grouped
 * pattern fill or no tiled sibling is found.
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
