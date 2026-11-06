// A path cut live, with no commit, shown in the world layer: the node is
// hidden where it stands and what the cuts have left of it is drawn in a
// `<svg>` parked right after it, so the stack is undisturbed. Two callers
// feed one implementation — the Color brush's ERASER, per dab, from the
// stroke's `VectorEraseState` (`update`), and a host's live cuts into the
// document while something else runs, per cut, through
// `CanvasSurfaceHandle.liveCuts` (`cut`; DrawBots' Erase effect while a run
// is going) — and the flush that later writes a cut into the record cuts
// with the same target (`vectorEraseTarget`, `cutVectorTarget`), so the
// preview and the commit cannot disagree about the geometry.
//
// Three things a long-lived preview needs that the gesture's did not:
//
//  1. CHUNKS. A merged trail from an earlier run is one node of thousands
//     of segments and the commonest target of a live cut. The path is drawn
//     as one `<path>` per colour per `CHUNK_SEGMENTS` flat segments, and a
//     cut rewrites the chunks whose segments it changed (`t.changed`), so a
//     cut costs the chunk's `d`, not the node's.
//  2. A FALLBACK for a node that is more than a stroked path. The `<path>`s
//     carry the node's stroke presentation and nothing else — a line style,
//     a shadow, a glow are left out — which a gesture hides for a drag and a
//     run would hide until Stop. Such a node is re-mounted from its own
//     markup builder instead (`mountShapeMarkup`, the swap the fill preview
//     already rides), exact and the whole node per cut; they are hand-made
//     and small.
//  3. SURVIVING A RENDER. A commit re-renders the canvas. The layers leave
//     an untouched node's element alone (drawnLeaves), and `refresh` cuts
//     a node whose RECORD changed again from the new one, with every disc
//     it has had, and lets go of one that left the scene.
//
// Kept to the slice of the DOM it touches (the interfaces below) so it is
// node-testable with fakes, like shapePaintDom.ts.

import type { CompositionState, PathSegment, SVGObject } from '@/engine/types';
import { buildPathD, svgIsFilled, svgObjectStrokesOnly } from '@/engine/svgPathBuilder';
import { rgbCss } from './colorUtils';
import { type DrawnLeaf, drawnLocalBox } from './drawnPose';
import { mountShapeMarkup, type ShapeHostLike } from './shapePaintDom';
import type { ShapeStrokePreviewFrame } from './shapeStrokePreview';
import {
  cutVectorTarget, keptPiecesOfSegment, type VectorEraseState, type VectorEraseTarget, vectorEraseTarget,
} from './vectorEraser';

/** Flat segments per preview `<path>`. Small, because a cut's `d` rewrite
 *  is short-lived string garbage and the WebView's failure mode is memory
 *  (DrawBots' stage-0 measurement, docs/live_edit.md §7.1). */
export const CHUNK_SEGMENTS = 128;

/** The slice of the node's element the preview touches. */
export interface PreviewNodeLike {
  style: { visibility: string };
}

/** A preview `<path>`. */
export interface PreviewPathLike {
  setAttribute(name: string, value: string): void;
  remove(): void;
}

/** What a preview needs of the surface and the document. */
export interface ErasePreviewDom {
  /** The node's mounted element, or null. */
  nodeEl(id: string): PreviewNodeLike | null;
  /** The frame the node draws in (`shapeStrokePreviewFrame`), computed
   *  afresh, or null for a node not in the scene. */
  frameOf(id: string): ShapeStrokePreviewFrame | null;
  /** Park a `<svg>` for node `id` after its element (CanvasSurface's
   *  `ensureSvgPaintLayer`: the node's matrix into world px, its stroke
   *  defs); false when the node is not mounted. Once per shown node. */
  park(id: string, frame: ShapeStrokePreviewFrame): boolean;
  /** A new `<path>` in node `id`'s parked `<svg>`, or null without one. */
  addPath(id: string): PreviewPathLike | null;
  /** Take node `id`'s parked `<svg>` away (`reset`). */
  unpark(id: string): void;
  /** The fallback's: the node's content host (`[data-paint-host]`), its
   *  drawn leaf, and the composition's strokeScale. */
  hostOf(id: string): ShapeHostLike | null;
  drawnOf(id: string): DrawnLeaf | null;
  strokeScale(): number;
}

export interface VectorErasePreview {
  /** The gesture's: every target of `es` the stroke has cut, drawn as the
   *  stroke has left it. A target whose revision is unchanged costs a
   *  compare. */
  update(es: VectorEraseState): void;
  /** A live cut: a disc of `r` cells at world (x, y) out of node `id`,
   *  shown now. False when the node is not in `state`, may not be cut
   *  (`vectorErasable`, fills allowed: a filled shape shows as its opened
   *  outline) or is not mounted; true otherwise, whether or not the disc
   *  reached the path. */
  cut(state: CompositionState, id: string, x: number, y: number, r: number): boolean;
  /** Show node `id` — every node — as the document has it again. */
  reset(id?: string): void;
  /** After a render: a live-cut node whose record `state` now holds anew
   *  is cut again from it (the element may be new too); one `state` no
   *  longer holds is let go. The gesture's entries are not its own
   *  records and are left alone. */
  refresh(state: CompositionState): void;
  /** Tests: the nodes shown cut. */
  shown(): readonly string[];
}

interface Entry {
  node: PreviewNodeLike;
  prevVisibility: string;
  frame: ShapeStrokePreviewFrame;
  /** `colour|chunk` → its path. Empty for a fallback entry. */
  paths: Map<string, PreviewPathLike>;
  /** The target's revision the paths were last drawn from. */
  rev: number;
  /** Drawn from the node's own markup (2. above) rather than as paths. */
  fallback: boolean;
  /** A live cut's own target and the discs it has taken (x, y, r
   *  triples), for `refresh`; null for the gesture's. */
  live: { target: VectorEraseTarget; svg: SVGObject; discs: number[] } | null;
}

/** A node whose look is more than its stroked path: an effect of any kind
 *  (a line style's glyphs, a shadow, a glow) — the fallback's. */
export function needsMarkupFallback(svg: SVGObject): boolean {
  const effects = svg.effects;
  if (!effects) return false;
  for (const key in effects) if ((effects as Record<string, unknown>)[key] != null) return true;
  return false;
}

/** The record as the cuts leave it, in its own box: the kept pieces of
 *  every flat segment, subpaths kept as subpaths, a filled shape's fill
 *  taken off (what the flush writes, `svgObjectStrokesOnly`). The box is
 *  the ORIGINAL's, so the element React positioned draws it in place;
 *  `erasedSvg` shrinks the box for the committed record instead. */
export function cutRecord(t: VectorEraseTarget): SVGObject {
  const svg = t.svg;
  let segments: PathSegment[];
  let subpaths = svg.subpaths;
  if (Array.isArray(subpaths) && subpaths.length > 0) {
    let idx = 0;
    subpaths = subpaths.map((sub) => {
      const cut: PathSegment[] = [];
      for (let k = 0; k < sub.segments.length; k++) cut.push(...keptPiecesOfSegment(t, idx++, sub.segments[k]));
      return { ...sub, segments: cut };
    });
    segments = subpaths.flatMap((s) => s.segments);
  } else {
    segments = [];
    for (let i = 0; i < svg.segments.length; i++) segments.push(...keptPiecesOfSegment(t, i, svg.segments[i]));
  }
  const out: SVGObject = { ...svg, segments, ...(subpaths ? { subpaths } : {}) };
  return svgIsFilled(svg) ? svgObjectStrokesOnly(out) : out;
}

/**
 * The drawn leaf of a node as the cuts leave it (the fallback's): the
 * node's own LOCAL geometry cut by the same fractions — the markup builder
 * reads a node's `localSegments` and `localSubpaths`, not its record's
 * points (`svgLocalGeometry`), and a fraction of a segment is the same in
 * every frame — with its content the cut record and its box pinned to
 * what it was, so the element React sized for the whole node frames the
 * cut one without a stretch.
 */
export function cutLeaf(t: VectorEraseTarget, d: DrawnLeaf): DrawnLeaf {
  const node = d.node;
  let localSegments: PathSegment[];
  let localSubpaths = node.localSubpaths;
  if (localSubpaths && localSubpaths.length > 0) {
    let idx = 0;
    localSubpaths = localSubpaths.map((sub) => ({
      ...sub, segments: sub.segments.flatMap((seg) => keptPiecesOfSegment(t, idx++, seg)),
    }));
    localSegments = localSubpaths.flatMap((s) => s.segments);
  } else {
    localSegments = (node.localSegments ?? []).flatMap((seg, i) => keptPiecesOfSegment(t, i, seg));
  }
  return {
    node: {
      ...node, content: cutRecord(t), localSegments, localBox: drawnLocalBox(node),
      ...(localSubpaths ? { localSubpaths } : {}),
    } as DrawnLeaf['node'],
    world: d.world,
  };
}

export function createVectorErasePreview(dom: ErasePreviewDom): VectorErasePreview {
  const entries = new Map<string, Entry>();

  /** Begin showing node `id` cut: hide it and park its svg. Null when it
   *  is not mounted or not in the scene. */
  const open = (id: string, fallback: boolean, live: Entry['live']): Entry | null => {
    const frame = dom.frameOf(id);
    const node = dom.nodeEl(id);
    if (!frame || !node) return null;
    if (!fallback && !dom.park(id, frame)) return null;
    const entry: Entry = { node, prevVisibility: node.style.visibility, frame, paths: new Map(), rev: 0, fallback, live };
    if (!fallback) node.style.visibility = 'hidden';
    entries.set(id, entry);
    return entry;
  };

  /** Draw the chunks of `t` that changed since the entry was last drawn
   *  (all of them the first time), one `d` per colour per chunk. */
  const drawChunks = (id: string, entry: Entry, t: VectorEraseTarget): void => {
    const flat = entry.frame.flat;
    const n = flat.length;
    const chunks = Math.ceil(n / CHUNK_SEGMENTS);
    let dirty: Set<number> | null = null;
    if (entry.rev > 0) {
      dirty = new Set<number>();
      for (let k = 0; k < t.changed.length; k++) dirty.add(Math.floor(t.changed[k] / CHUNK_SEGMENTS));
    }
    for (let c = 0; c < chunks; c++) {
      if (dirty && !dirty.has(c)) continue;
      const byColor = new Map<string, PathSegment[]>();
      const end = Math.min(n, (c + 1) * CHUNK_SEGMENTS);
      for (let i = c * CHUNK_SEGMENTS; i < end; i++) {
        const css = rgbCss(flat[i].color);
        let list = byColor.get(css);
        if (!list) { list = []; byColor.set(css, list); }
        list.push(...keptPiecesOfSegment(t, i, flat[i].segment));
      }
      for (const [css, segs] of byColor) {
        const key = `${css}|${c}`;
        let path = entry.paths.get(key);
        if (!path) {
          path = dom.addPath(id) ?? undefined;
          if (!path) continue;
          for (const [name, value] of entry.frame.attrs) path.setAttribute(name, value);
          // The stroke presentation's `fill` is the node's; a cut shape is
          // its outline alone.
          path.setAttribute('fill', 'none');
          path.setAttribute('stroke', css);
          entry.paths.set(key, path);
        }
        path.setAttribute('d', buildPathD(segs));
      }
    }
  };

  /** Re-mount the node from its own markup, cut (the fallback). */
  const drawMarkup = (id: string, entry: Entry, t: VectorEraseTarget): void => {
    const host = dom.hostOf(id);
    const d = dom.drawnOf(id);
    if (!host || !d) return;
    mountShapeMarkup(host, cutLeaf(t, d), dom.strokeScale());
  };

  const draw = (id: string, entry: Entry, t: VectorEraseTarget): void => {
    if (entry.fallback) drawMarkup(id, entry, t);
    else drawChunks(id, entry, t);
    entry.rev = t.rev;
    t.changed.length = 0;
  };

  const close = (id: string, entry: Entry): void => {
    if (entry.fallback) {
      const host = dom.hostOf(id);
      const d = dom.drawnOf(id);
      if (host && d) mountShapeMarkup(host, d, dom.strokeScale());
    } else {
      entry.node.style.visibility = entry.prevVisibility;
      dom.unpark(id);
    }
    entries.delete(id);
  };

  const api: VectorErasePreview = {
    update(es) {
      for (const [id, t] of es.targets) {
        if (!t || t.rev === 0) continue;
        let entry = entries.get(id);
        if (entry && entry.rev === t.rev) continue;
        if (!entry) entry = open(id, needsMarkupFallback(t.svg), null) ?? undefined;
        if (!entry) continue;
        draw(id, entry, t);
      }
    },
    cut(state, id, x, y, r) {
      let entry = entries.get(id);
      if (!entry || !entry.live) {
        const svg = state.svgObjects.find((o) => o.id === id);
        if (!svg) return false;
        const target = vectorEraseTarget(state, svg, true);
        if (!target) return false;
        entry = open(id, needsMarkupFallback(svg), { target, svg, discs: [] }) ?? undefined;
        if (!entry) return false;
      }
      const live = entry.live!;
      live.discs.push(x, y, r);
      if (cutVectorTarget(live.target, x, y, r) || entry.rev === 0) draw(id, entry, live.target);
      return true;
    },
    reset(id) {
      if (id !== undefined) {
        const entry = entries.get(id);
        if (entry) close(id, entry);
        return;
      }
      for (const [key, entry] of [...entries]) close(key, entry);
    },
    refresh(state) {
      for (const [id, entry] of [...entries]) {
        if (!entry.live) continue;
        const svg = state.svgObjects.find((o) => o.id === id);
        if (svg === entry.live.svg) continue;
        const discs = entry.live.discs;
        close(id, entry);
        if (!svg) continue;
        const target = vectorEraseTarget(state, svg, true);
        if (!target) continue;
        for (let k = 0; k + 2 < discs.length; k += 3) cutVectorTarget(target, discs[k], discs[k + 1], discs[k + 2]);
        const next = open(id, needsMarkupFallback(svg), { target, svg, discs });
        if (next) draw(id, next, target);
      }
    },
    shown: () => [...entries.keys()],
  };
  return api;
}
