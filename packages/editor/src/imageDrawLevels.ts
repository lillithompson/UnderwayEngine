import type { Camera, ImageObject, Viewport } from '@/engine/types';
import { decodeLevelEdge, decodeLevelKey, ensureDecodeLevel, peekDecodeLevel } from '@/engine/imageDecodeLevels';
import { pxPerCell, visibleWorldRect } from './cameraMath';

// WHICH source each image node on the canvas draws from, and which it draws
// from at all (the engine's imageDecodeLevels is the WHAT).
//
// Two rules, and the reason for both is the same number: what the
// compositor allocates for a drawn photo is width × height × 4, off the
// SOURCE's pixels, not the box it is drawn in.
//
//  1. Draw from a level about the size the node is drawn at. The display
//     copy is capped at MAX_EDGE_PX = 1024, sized for a photo that FILLS a
//     page; a photo in a 4x3 collage cell is drawn at a quarter of the
//     page's width, where 256 px is indistinguishable and costs a sixteenth
//     of the decode — 256 KB against 4 MB.
//  2. Draw nothing at all for a node the camera cannot see. Its bytes stay
//     (they are kilobytes); its decoded bitmap does not.
//
// Both are re-decided on camera SETTLE, never per frame: a level is a
// re-encode and a src swap is a decode, and doing either mid-pinch would
// trade the very frames this exists to protect.

/**
 * How far outside the viewport a node still counts as visible, as a
 * fraction of the viewport. A margin, because the alternative is a frame of
 * empty box on the leading edge of every pan: at a settle the camera has
 * stopped, and this is the room the next flick gets before the swap catches
 * up.
 */
const CULL_MARGIN = 0.75;

/**
 * Below this many images on a page, nothing is culled.
 *
 * Culling costs a re-decode when a node comes back, and a page with three
 * photos was never the problem — its decoded pixels fit several times over
 * in any budget. The rule earns its keep on the collage pages it was
 * written for, and on nothing else.
 */
const CULL_MIN_IMAGES = 6;

/** What one image node should draw this settle. */
export interface ImageDrawPlan {
  /** The asset id whose bytes to draw — the node's display copy. */
  imageId: string;
  /** The level's long edge, or the source's own when no level helps. */
  edge: number;
  /** False when the camera cannot see this node: draw nothing, and let the
   *  compositor drop what it had decoded. */
  visible: boolean;
}

/** The node's longer drawn edge in SCREEN pixels at this camera. */
export function drawnEdgePx(node: ImageObject, camera: Camera, viewport: Viewport): number {
  return Math.max(node.cellWidth, node.cellHeight) * pxPerCell(camera, viewport);
}

/** Does the camera reach this node, with the margin? */
export function nodeInView(node: ImageObject, camera: Camera, viewport: Viewport): boolean {
  const rect = visibleWorldRect(camera, viewport);
  const padX = (rect.maxX - rect.minX) * CULL_MARGIN;
  const padY = (rect.maxY - rect.minY) * CULL_MARGIN;
  return node.cellX + node.cellWidth >= rect.minX - padX
    && node.cellX <= rect.maxX + padX
    && node.cellY + node.cellHeight >= rect.minY - padY
    && node.cellY <= rect.maxY + padY;
}

/**
 * What every image node on the page should draw at this camera, by node id.
 *
 * Pure and synchronous: it decides, and {@link warmDrawLevels} makes what
 * the decision asked for. Nothing here waits, so a settle never blocks a
 * frame, and a node whose level is not made yet keeps drawing its display
 * copy until it is.
 */
export function planImageDraws(
  images: readonly ImageObject[],
  camera: Camera,
  viewport: Viewport,
): Map<string, ImageDrawPlan> {
  const out = new Map<string, ImageDrawPlan>();
  const cull = images.length >= CULL_MIN_IMAGES;
  for (const node of images) {
    const visible = !cull || nodeInView(node, camera, viewport);
    out.set(node.id, {
      imageId: node.imageId,
      // A node nobody can see is planned at its source size: it draws
      // nothing this settle, and asking for a level for it would re-encode
      // a photo to make a bitmap no one looks at.
      edge: visible
        ? decodeLevelEdge(drawnEdgePx(node, camera, viewport), sourceEdge(node))
        : sourceEdge(node) ?? 0,
      visible,
    });
  }
  return out;
}

/** The display copy's own longer edge, off the node — which is what
 *  `pixelWidth`/`pixelHeight` record. Undefined for a node carrying
 *  neither (an old save), which leaves decodeLevelEdge on the import cap. */
function sourceEdge(node: ImageObject): number | undefined {
  const edge = Math.max(node.pixelWidth ?? 0, node.pixelHeight ?? 0);
  return edge > 0 ? edge : undefined;
}

/**
 * The object URL to draw a planned node from: its level when one is made,
 * else the display copy's own URL (`fallback`), else nothing.
 *
 * An invisible node draws nothing whatever is cached — that IS the cull.
 */
export function levelUrlFor(
  plan: ImageDrawPlan | undefined,
  fallback: string | undefined,
): string | undefined {
  if (plan && !plan.visible) return undefined;
  if (!plan) return fallback;
  return peekDecodeLevel(plan.imageId, plan.edge)?.url ?? fallback;
}

/**
 * Make the levels a plan asked for that are not made yet, and report
 * whether any landed — the caller re-renders once, on that, rather than on
 * each one.
 *
 * Best-effort throughout: an environment that cannot re-encode, or a source
 * that will not decode, simply keeps drawing the display copy.
 */
export async function warmDrawLevels(
  plans: Map<string, ImageDrawPlan>,
  images: readonly ImageObject[],
  blobs: Record<string, Uint8Array>,
): Promise<boolean> {
  const mimeById = new Map(images.map((n) => [n.imageId, n.mimeType]));
  const wanted = new Map<string, number>();
  for (const plan of plans.values()) {
    if (!plan.visible) continue;
    if (peekDecodeLevel(plan.imageId, plan.edge)) continue;
    wanted.set(decodeLevelKey(plan.imageId, plan.edge), plan.edge);
  }
  if (wanted.size === 0) return false;
  const made = await Promise.all(Array.from(wanted, async ([key, edge]) => {
    const imageId = key.slice(0, key.lastIndexOf('@'));
    const bytes = blobs[imageId];
    const mime = mimeById.get(imageId);
    if (!bytes || !mime) return null;
    return ensureDecodeLevel(imageId, edge, bytes, mime);
  }));
  return made.some((level) => level !== null);
}
