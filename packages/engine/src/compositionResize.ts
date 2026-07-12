/**
 * Decide whether a corner-handle scale gesture must preserve aspect ratio
 * (uniform scaling) or may scale each axis independently (free-aspect).
 *
 * Grouped nodes ALWAYS scale uniformly: a group is a cohesive unit, and the
 * masked-group scale path scales every member by a single box ratio, so a
 * non-uniform drag would distort the whole group (and any clip mask). This
 * holds for any member type — a mask is typically a rectangle SVGObject, which
 * would otherwise fall into the free-aspect rectangle branch below.
 *
 * For ungrouped nodes the prior rules apply: single non-tile figures are
 * locked; non-figure nodes (svgObjects, images) are locked except simple H/V
 * lines, tiled paths, and rectangles, which scale free-aspect.
 */
export function shouldAspectLockScale(params: {
  isGrouped: boolean;
  isFigure: boolean;
  figureTiled: boolean;
  isNonFigureNode: boolean;
  isSimpleLine: boolean;
  isTiledPath: boolean;
  isRectangle: boolean;
}): boolean {
  if (params.isGrouped) return true;
  if (params.isFigure && !params.figureTiled) return true;
  return params.isNonFigureNode && !params.isSimpleLine
    && !params.isTiledPath && !params.isRectangle;
}

/**
 * Compute the aspect ratio to use when uniformly scaling a composition figure.
 *
 * For regular figures the immutable resolutionX/resolutionY (source-file
 * dimensions) are used so the ratio cannot be corrupted by snapping to a
 * minimum grid size.  For groups (no single resolution) or figures with
 * missing resolution data, the caller-supplied orig dimensions are used.
 */
export function computeFigureAspectRatio(
  fig: {
    resolutionX: number;
    resolutionY: number;
    rotation?: 0 | 90 | 180 | 270;
    groupId?: string;
  },
  origWidth: number,
  origHeight: number,
): number {
  if (fig.groupId || fig.resolutionX <= 0 || fig.resolutionY <= 0) {
    return origWidth / origHeight;
  }
  const rotation = fig.rotation ?? 0;
  const rotSwapped = rotation === 90 || rotation === 270;
  return (rotSwapped ? fig.resolutionY : fig.resolutionX)
    / (rotSwapped ? fig.resolutionX : fig.resolutionY);
}

/**
 * Compute the aspect ratio to use when uniformly scaling an image object.
 *
 * Uses the immutable pixelWidth/pixelHeight (stored bitmap dimensions) so
 * the ratio cannot be corrupted by grid snapping.  When pixel dimensions
 * are missing or zero, falls back to the caller-supplied orig dimensions.
 */
export function computeImageAspectRatio(
  image: { pixelWidth: number; pixelHeight: number; rotation?: 0 | 90 | 180 | 270 },
  origWidth: number,
  origHeight: number,
): number {
  if (image.pixelWidth <= 0 || image.pixelHeight <= 0) {
    return origWidth / origHeight;
  }
  const rotation = image.rotation ?? 0;
  const rotSwapped = rotation === 90 || rotation === 270;
  return (rotSwapped ? image.pixelHeight : image.pixelWidth)
    / (rotSwapped ? image.pixelWidth : image.pixelHeight);
}
