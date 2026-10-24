import type { PathSegment, SVGObject } from '@/engine/types';
import { pointInClosedPath } from '@/engine/compositionPathHitTest';
import { decorIdOfNode } from './scaffold';

// The nodes a page template names for the page to READ (pageTemplate.ts):
// what a template author calls a node in the Scene Outline is the contract
// between the .tile and the format — "Date" is restamped each day, "Frame"
// becomes the page's frame, "Focus" is where a new page opens, and Adrift's
// "Mask" is the shape its words must be floated into. The name readers live
// here, apart from the template pipeline, so the parts of the app that ask
// about a finished page (the edited check, the Today cutout, the journal
// export, the opening camera) can ask without pulling the template store
// and the tile codec into their module graph.
//
// Names match exact, any case, trimmed (templateNameKey); a grouped member's
// name is its own — grouping never touches one — so `name` is the one field
// read.

/** A node's name as the template readers match it: trimmed, lower-cased,
 *  '' when it has none. */
export function templateNameKey(node: { name?: string }): string {
  return node.name?.trim().toLowerCase() ?? '';
}

/** decorId every format's date stamp carries (`decor:dateStamp`). */
export const DATE_STAMP_DECOR_ID = 'dateStamp';

/**
 * Whether a template text node is the per-instance date: the user named it
 * "Date", or it carries the standard date-stamp decor tag — which is what
 * the stamp on any exported page carries, so "export a page, upload it as
 * the template" keeps its date live without any renaming.
 */
export function isTemplateDateText(node: { name?: string }): boolean {
  if (templateNameKey(node) === 'date') return true;
  return decorIdOfNode(node) === DATE_STAMP_DECOR_ID;
}

/** The name that marks a template rectangle as the page's frame. */
export const FRAME_RECT_NAME = 'frame';

/** Whether a template node is the frame-to-be: the user named it "Frame".
 *  Rectangles are assumed; the name alone is what this decides. */
export function isTemplateFrameRect(node: { name?: string }): boolean {
  return templateNameKey(node) === FRAME_RECT_NAME;
}

/** The name that marks the template rectangle a new page opens on. */
export const FOCUS_RECT_NAME = 'focus';

/** Whether a template node is the focus rectangle: named exactly "Focus"
 *  ("Focus", not "focus area"). */
export function isTemplateFocusRect(node: { name?: string }): boolean {
  return templateNameKey(node) === FOCUS_RECT_NAME;
}

/** The name that marks Adrift's mask: the one closed shape the words are
 *  floated into. In the template it is an SVG picture (an ImageObject whose
 *  document draws the shape); on every page minted from it, it is a bare
 *  path object of the same name — see pageTemplate.promoteTemplateMask. */
export const MASK_NAME = 'mask';

/** Whether a node is the page's mask, by name. */
export function isTemplateMaskNode(node: { name?: string }): boolean {
  return templateNameKey(node) === MASK_NAME;
}

/** The fields of a path object the mask readers use. Satisfied by the
 *  engine's SVGObject wherever a scene carries them. */
export type MaskShape = Pick<SVGObject, 'id' | 'name' | 'segments'>
  // …and the geometry the social games' rules read (docs/social_game_spec.md
  // §6.3, §7.3): rotation and the cell box, so Creature's connection-point
  // test reads a rotated line's ends without a second scene type. Every
  // field is one SVGObject already has, so CompositionState still satisfies
  // the scene shape.
  & Partial<Pick<
    SVGObject,
    // …the pattern FILL besides, which the edited rule reads the same way
    // it reads a paint island: cloth printed inside a shape is a mark
    // (edited.ts printedFillsChanged).
    'angleDeg' | 'cellX' | 'cellY' | 'cellWidth' | 'cellHeight' | 'hidden' | 'patternFill'
  >>;

/** The page's mask: the first path object named "Mask", or undefined on a
 *  page without one (a page minted before the mask existed, another
 *  format's page). */
export function templateMaskNode<T extends MaskShape>(svgObjects: readonly T[]): T | undefined {
  return svgObjects.find(isTemplateMaskNode);
}

/**
 * Whether the world point lies inside the mask's closed outline — the
 * engine's own interior test (nonzero winding over the chained, flattened
 * loop, cached by the segments' reference), so the answer is the same one a
 * "use as mask" region would give. False for a mask whose segments do not
 * close, which is no mask at all.
 */
export function maskContains(mask: { segments: readonly PathSegment[] }, x: number, y: number): boolean {
  return pointInClosedPath(mask.segments, x, y);
}


/** A cell rect: the world bbox every leaf node carries. */
export interface NodeCellBbox {
  cellX: number;
  cellY: number;
  cellWidth: number;
  cellHeight: number;
}

/** The leaf arrays a scene may hold, as the name lookup walks them. */
export interface NamedLeafScene {
  figures?: readonly (NodeCellBbox & { name?: string })[];
  svgObjects?: readonly (NodeCellBbox & { name?: string })[];
  images?: readonly (NodeCellBbox & { name?: string })[];
  texts?: readonly (NodeCellBbox & { name?: string })[];
  paintObjects?: readonly (NodeCellBbox & { name?: string })[];
  patternObjects?: readonly (NodeCellBbox & { name?: string })[];
}

/**
 * The world bbox of the first leaf node named `name` (any case, trimmed),
 * or undefined when the page has none — what a format's
 * `canvas.initialFitName` frames on open (Adrift opens on its Mask). The
 * arrays are walked in kind order, not paint order: a template names ONE
 * node for this, so which of several would win is not a question the
 * contract asks.
 */
export function namedLeafBbox(scene: NamedLeafScene, name: string): NodeCellBbox | undefined {
  const key = name.trim().toLowerCase();
  for (const list of [
    scene.figures, scene.svgObjects, scene.images, scene.texts, scene.paintObjects, scene.patternObjects,
  ]) {
    const hit = list?.find((n) => templateNameKey(n) === key);
    if (hit) {
      return { cellX: hit.cellX, cellY: hit.cellY, cellWidth: hit.cellWidth, cellHeight: hit.cellHeight };
    }
  }
  return undefined;
}
