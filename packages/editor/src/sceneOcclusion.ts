// The raster paintbrush's spray-paint occlusion model: what the scene lets
// a dab deposit at each point.
//
// Physical rule: a stroke behaves like spray paint falling on the page from
// above. At every point the TOPMOST ink catches the paint; whatever the top
// layer doesn't catch falls through to the next one, and what nothing
// catches lands on the canvas — the paint island. A fully opaque object
// stencils the island out of its silhouette; a 0.75-opacity object passes
// 0.25 of the stroke through. Transmittance through a stack multiplies:
// what reaches layer k is ∏(1 − αᵢ) over everything above it.
//
// This module builds that stack once per stroke (the scene cannot change
// mid-stroke): every visible scene object in sceneOrder, each with an
// analytic per-point coverage test — the same primitives the tap hit-test
// trusts (pointInClosedPath / svgPathHitsPoint / frame inverses / island
// texel alpha). Two consumers:
//
//  - the island stamp takes a per-TEXEL mask ({@link SceneOcclusion.islandMask},
//    the engine's CanvasPaintStampMask), memoized per texel so a stroke that
//    revisits the same tiles dab after dab classifies each texel once;
//  - the object passes take a per-DAB weight ({@link SceneOcclusion.weightFor}),
//    sampled at the dab center — "only the top object takes the paint" at
//    brush granularity, which is as fine as the object brushes themselves
//    resolve (their falloff is per-dab too).
//
// Deliberate approximations, chosen over duplicating renderer code paths:
// image coverage is the (transformed) frame rectangle × the image's opacity
// — a transparent PNG's own alpha channel is not sampled; text coverage is
// the per-character layout boxes, not glyph outlines; a gradient fill
// occludes at the fill layer's scalar opacity, not per-stop alpha; and
// edge-soften fades are ignored. Figures never occlude — CozyJournal pages
// carry none (they bake to SVGObjects; see stampPaintBrush's port notes).

import {
  CompositionState, ImageObject, PaintObject, SVGObject, TextObject,
} from '@/engine/types';
import { CanvasPaintStampMask, paintTileAlphaAt } from '@/engine/canvasPaint';
import { pointInClosedPath, svgPathHitsPoint } from '@/engine/compositionPathHitTest';
import { hiddenGroupIds } from '@/engine/compositionOps';
import { leafHitFrame } from '@/engine/sceneHitFrame';
import { buildActiveMaskMap, pointVisibleThroughMasks } from '@/engine/compositionMask';
import { patternSVGView } from '@/engine/patternObjectRender';
import { svgStrokeWidthCells } from '@/engine/svgStroke';
import { BASE_CELL_PX } from './cameraMath';
import { DrawnLeaf, drawnAabb, drawnLeaf, drawnLeafFor } from './drawnPose';
import { bboxLocalFrame, islandTileFrame, textPaintGeometry, TextPaintGeometry } from './paintBrush';
import { graphOf } from './transformGestures';

/** Below this, a stack's transmittance reads as fully blocked — half a
 *  quantization step of the per-texel byte cache. */
const EPS = 1 / 512;

/** The sceneOrder "index" of a fresh, not-yet-placed island: below index 0,
 *  so every occluder in the scene sits above it. */
export const FRESH_ISLAND_ORDER = -1;

/**
 * The stroke's occlusion queries, bound to one immutable scene snapshot.
 * All coordinates are world cells; `order` arguments are sceneOrder indices
 * (back→front), and every query considers occluders STRICTLY above that
 * index — an object never occludes itself, and the deposit target island
 * never masks its own dabs.
 */
export interface SceneOcclusion {
  /** Transmittance (0..1) through every occluder strictly above sceneOrder
   *  index `order` at world point (x, y). 1 = nothing in the way. */
  transmittanceAbove(order: number, x: number, y: number): number;
  /** A node's sceneOrder index, or {@link FRESH_ISLAND_ORDER} when the id
   *  isn't in the order (defensive — every placed node is). */
  orderOf(id: string): number;
  /** The share of a dab object `id` may take: the transmittance above it at
   *  the dab center. 1 for an unknown id (nothing provably above it). */
  weightFor(id: string, x: number, y: number): number;
  /** The island stamp's per-texel deposit mask for a target at `order` —
   *  memoized per texel, and the one query path that RECORDS blockers for
   *  {@link freshInsertionIndex}. */
  islandMask(order: number): CanvasPaintStampMask;
  /** Where a FRESH island belongs in sceneOrder: the index of the lowest
   *  occluder that actually attenuated island ink this stroke (splice there
   *  = directly below it), or undefined when nothing ever occluded — an
   *  unobstructed stroke keeps landing on top. */
  freshInsertionIndex(): number | undefined;
}

/** One occluder: a visible scene object with its inflated world AABB (the
 *  cheap reject) and exact-enough per-point coverage. */
interface OccluderEntry {
  index: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Coverage × object opacity at a world point, 0..1. */
  alphaAt(x: number, y: number): number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Build the stroke's occlusion stack from the scene. `skipIds` is the
 * brush's own never-touch set (hidden-group members, frame boundary rects) —
 * a frame's background is the page surface paint lands ON, not a stencil
 * over it. Beyond that: hidden nodes and hidden-group members never occlude
 * (they draw nothing), `isMask` / `isPatternFill` shapes are clip geometry
 * with no ink of their own, and group-mask clipping applies per point —
 * a shape only occludes where its mask chain lets it draw. LOCKED objects
 * still occlude: locked ink is still ink.
 */
export function buildSceneOcclusion(
  state: CompositionState,
  skipIds: ReadonlySet<string>,
): SceneOcclusion {
  const hidden = hiddenGroupIds(state.groups);
  const maskMap = buildActiveMaskMap(state);
  const graph = graphOf(state);

  const svgs = new Map(state.svgObjects.map((s) => [s.id, s]));
  const images = new Map((state.images ?? []).map((i) => [i.id, i]));
  const texts = new Map((state.texts ?? []).map((t) => [t.id, t]));
  const paints = new Map((state.paintObjects ?? []).map((p) => [p.id, p]));
  const patterns = new Map((state.patternObjects ?? []).map((p) => [p.id, p]));

  const orders = new Map<string, number>();
  const entries: OccluderEntry[] = [];

  /** The mask-chain gate shared by every kind: 0 outside the node's visible
   *  (un-clipped) region. Cheap no-op for the common ungrouped node. */
  const clipped = (node: { id: string; groupId?: string }, x: number, y: number): boolean =>
    maskMap.size > 0 && !pointVisibleThroughMasks(maskMap, state.groups, node, x, y);

  const eligible = (node: { id: string; hidden?: boolean; groupId?: string }): boolean =>
    !node.hidden
    && !(node.groupId && hidden.has(node.groupId))
    && !skipIds.has(node.id);

  /** The exact world AABB of a leaf drawn through the graph, as the
   *  entry's reject box. */
  const drawnBounds = (d: DrawnLeaf, pad: number) => {
    const b = drawnAabb(d);
    return { minX: b.x - pad, minY: b.y - pad, maxX: b.x + b.width + pad, maxY: b.y + b.height + pad };
  };

  /**
   * An svg's coverage, tested in the node's OWN frame (sceneHitFrame): the
   * point comes in through the inverse world matrix and meets the local
   * path there, so a member of a stretched bound group is tested against
   * the parallelogram it is drawn as rather than the nearest rectangle
   * around it. A pattern's derived view has no node — `drawnLeafFor` reads
   * its own world fields, which is all that object is.
   */
  const svgEntry = (svg: SVGObject, index: number): OccluderEntry | null => {
    if (svg.isMask || svg.isPatternFill) return null;
    const hasFillLayer = !!(svg.fill || svg.fillPaint || svg.fillColor);
    const fillAlpha = svg.fill
      ? clamp01(svg.fill.opacity)
      : svg.fillPaint ? 1 : clamp01(svg.fillOpacity ?? 1);
    const opacity = clamp01(svg.opacity ?? 1);
    if (opacity <= 0) return null;
    const drawn = drawnLeafFor('svg', svg, graph);
    const frame = leafHitFrame(drawn.node, drawn.world);
    const local = frame.object as SVGObject;
    // A stroke is a WORLD width (svgDrawnGeometry says the same), so the
    // reject box is padded by it out here and the test carries it into the
    // frame through `lengthScale`.
    const strokeHalf = svgStrokeWidthCells(svg, state.strokeScale, BASE_CELL_PX) / 2;
    const localHalf = strokeHalf * frame.lengthScale;
    const strokeHalfSq = localHalf * localHalf;
    return {
      index,
      ...drawnBounds(drawn, strokeHalf),
      alphaAt(x, y) {
        if (clipped(svg, x, y)) return 0;
        let [wx, wy] = frame.toLocal(x, y);
        // Tiled patterns store one origin tile rendered as a grid of copies —
        // wrap the point into that tile so every copy occludes (the same
        // wrap brushHitsSegments' whole-object branch uses). Pitch and
        // offset are the local object's, in the frame's own units.
        if (local.tileMode === 'repeat') {
          const tw = local.tileWidthL0 ?? frame.box.width;
          const th = local.tileHeightL0 ?? frame.box.height;
          if (tw > 0 && th > 0) {
            const ax = frame.box.x + (local.tileOffsetXL0 ?? 0);
            const ay = frame.box.y + (local.tileOffsetYL0 ?? 0);
            wx = ax + (((wx - ax) % tw) + tw) % tw;
            wy = ay + (((wy - ay) % th) + th) % th;
          }
        }
        // The outline is opaque ink; the interior covers at the fill
        // layer's own opacity. Take the strongest layer under the point.
        let a = 0;
        if (strokeHalfSq > 0 && svgPathHitsPoint(local, wx, wy, strokeHalfSq)) a = 1;
        if (a < 1 && hasFillLayer && fillAlpha > a
          && pointInClosedPath(local.segments, wx, wy)) {
          a = fillAlpha;
        }
        if (a < 1 && Array.isArray(local.subpaths)) {
          for (const sub of local.subpaths) {
            if (sub.fill && pointInClosedPath(sub.segments, wx, wy)) {
              a = 1;
              break;
            }
          }
        }
        return a * opacity;
      },
    };
  };

  const imageEntry = (img: ImageObject, index: number): OccluderEntry | null => {
    const opacity = clamp01(img.opacity ?? 1);
    if (opacity <= 0) return null;
    const drawn = drawnLeaf(graph, img.id);
    if (!drawn) return null;
    const frame = bboxLocalFrame(drawn);
    return {
      index,
      ...drawnBounds(drawn, 0),
      alphaAt(x, y) {
        if (clipped(img, x, y)) return 0;
        const [lx, ly] = frame.toLocal(x, y);
        return lx >= 0 && lx <= frame.iw && ly >= 0 && ly <= frame.ih ? opacity : 0;
      },
    };
  };

  const textEntry = (text: TextObject, index: number): OccluderEntry | null => {
    const drawn = drawnLeaf(graph, text.id);
    if (!drawn) return null;
    // Layout is the expensive part — resolved on first query, and only for
    // texts a stroke actually reaches.
    let geom: TextPaintGeometry | null = null;
    return {
      index,
      ...drawnBounds(drawn, 0),
      alphaAt(x, y) {
        if (clipped(text, x, y)) return 0;
        geom ??= textPaintGeometry(drawn);
        const [lx, ly] = geom.toLocal(x, y);
        for (const box of geom.chars.values()) {
          if (lx >= box.x && lx <= box.x + box.w && ly >= box.y && ly <= box.y + box.h) return 1;
        }
        return 0;
      },
    };
  };

  const paintEntry = (p: PaintObject, index: number): OccluderEntry | null => {
    const opacity = clamp01(p.opacity ?? 1);
    if (opacity <= 0) return null;
    const drawn = drawnLeaf(graph, p.id);
    if (!drawn) return null;
    // The same frame the colour brush's own dabs land through: the whole
    // pose — free angle, quarter turn, mirror, scale, and every ancestor's
    // — is the node's world matrix, and all that is left after it is the
    // one stretch onto the island's content rect. A stencil and the brush
    // it stencils must agree on which texel a point is over.
    const frame = islandTileFrame(drawn);
    return {
      index,
      ...drawnBounds(drawn, 0),
      alphaAt(x, y) {
        if (clipped(p, x, y)) return 0;
        const [tx, ty] = frame.toTile(x, y);
        return (paintTileAlphaAt(p.tiles, tx, ty) / 255) * opacity;
      },
    };
  };

  state.sceneOrder.forEach((id, index) => {
    orders.set(id, index);
    let entry: OccluderEntry | null = null;
    const svg = svgs.get(id);
    if (svg) entry = eligible(svg) ? svgEntry(svg, index) : null;
    else {
      const img = images.get(id);
      if (img) entry = eligible(img) ? imageEntry(img, index) : null;
      else {
        const text = texts.get(id);
        if (text) entry = eligible(text) ? textEntry(text, index) : null;
        else {
          const p = paints.get(id);
          if (p) entry = eligible(p) ? paintEntry(p, index) : null;
          else {
            // A pattern occludes exactly what it draws: its derived SVG
            // view (segments in world space, tileMode carried over, so the
            // repeat wrap above applies). An empty pattern has no ink and
            // no view — it never occludes.
            const pat = patterns.get(id);
            if (pat && eligible(pat)) {
              const view = patternSVGView(pat);
              if (view) entry = svgEntry(view, index);
            }
          }
        }
      }
    }
    if (entry) entries.push(entry);
  });
  // entries are ascending by sceneOrder index — walks run from the end
  // (front of paint) down to the target order.

  let minBlocker = Infinity;

  const walk = (order: number, x: number, y: number, record: boolean): number => {
    let t = 1;
    for (let k = entries.length - 1; k >= 0; k--) {
      const e = entries[k];
      if (e.index <= order) break;
      if (x < e.minX || x > e.maxX || y < e.minY || y > e.maxY) continue;
      const a = e.alphaAt(x, y);
      if (a <= 0) continue;
      if (record && e.index < minBlocker) minBlocker = e.index;
      t *= 1 - a;
      if (t < EPS) return 0;
    }
    return t;
  };

  return {
    transmittanceAbove: (order, x, y) => walk(order, x, y, false),
    orderOf: (id) => orders.get(id) ?? FRESH_ISLAND_ORDER,
    weightFor(id, x, y) {
      const order = orders.get(id);
      return order === undefined ? 1 : walk(order, x, y, false);
    },
    islandMask(order) {
      // One byte per texel per island: 0 = unresolved, else 1 + t·254 — so
      // each texel walks the stack at most once per stroke, however many
      // dabs revisit it.
      const caches = new Map<string, { bytes: Uint8Array; fn: (i: number, lx: number, ly: number) => number }>();
      return {
        forIsland(key, texelCount, originX, originY) {
          let c = caches.get(key);
          if (!c) {
            const bytes = new Uint8Array(texelCount);
            c = {
              bytes,
              fn: (i, lx, ly) => {
                const t = i >> 2;
                let v = bytes[t];
                if (v === 0) {
                  const w = walk(order, originX + lx, originY + ly, true);
                  v = 1 + Math.round(w * 254);
                  bytes[t] = v;
                }
                // Always the quantized value — first classification and
                // every cached read must agree byte-for-byte.
                return (v - 1) / 254;
              },
            };
            caches.set(key, c);
          }
          return c.fn;
        },
      };
    },
    freshInsertionIndex: () => (minBlocker === Infinity ? undefined : minBlocker),
  };
}
