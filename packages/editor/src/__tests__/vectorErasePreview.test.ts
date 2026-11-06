/**
 * A path cut live without a commit (vectorErasePreview.ts): the node hidden,
 * what the discs leave of it drawn in a parked svg as chunked paths, a node
 * with effects re-mounted from its own markup, and the picture surviving a
 * render. One implementation for the Color brush's eraser and for a host's
 * live cuts through `CanvasSurfaceHandle.liveCuts`.
 */

import type { CompositionState, PathSegment, SVGObject } from '@/engine/types';
import { makeBlankComposition } from '@/editor/blankComposition';
import { buildPathD } from '@/engine/svgPathBuilder';
import { BASE_CELL_PX } from '../cameraMath';
import { buildPlaceSVGObject, commitEntry, createEditorSession } from '../editorSession';
import { drawnLeaf, svgLayerMarkup } from '../drawnPose';
import { SHAPE_FILL_SVG_ATTR, type ShapeHostLike, type ShapeSvgLike } from '../shapePaintDom';
import { type ShapeStrokePreviewFrame, shapeStrokePreviewFrame } from '../shapeStrokePreview';
import { graphOf } from '../transformGestures';
import { createVectorEraseState, cutVectorTarget, eraseVectorDab, keptPieces, vectorEraseTarget } from '../vectorEraser';
import {
  CHUNK_SEGMENTS, createVectorErasePreview, cutLeaf, cutRecord, type ErasePreviewDom, needsMarkupFallback, type PreviewPathLike,
} from '../vectorErasePreview';

const BLACK = { r: 0, g: 0, b: 0 };
const RED = { r: 200, g: 20, b: 20 };

/** A polyline along y = 0 from x = 0, `n` unit segments. */
function polyline(id: string, n: number, extras: Partial<SVGObject> = {}): SVGObject {
  const segments: PathSegment[] = [];
  for (let k = 0; k < n; k++) segments.push({ kind: 'line', start: [k, 0], end: [k + 1, 0] });
  return { id, segments, color: BLACK, stroke: { width: 0.25 }, cellX: 0, cellY: 0, cellWidth: n, cellHeight: 0, ...extras };
}

/** A state holding `svgs`, with its graph. */
function stateWith(svgs: SVGObject[]): CompositionState {
  let session = createEditorSession(makeBlankComposition('comp_live'));
  for (const svg of svgs) session = commitEntry(session, buildPlaceSVGObject(svg));
  return session.state;
}

// ── A fake slice of the surface's DOM ──

class FakePath implements PreviewPathLike {
  attrs: Record<string, string> = {};
  writes = 0;
  removed = false;
  setAttribute(name: string, value: string): void { this.attrs[name] = value; if (name === 'd') this.writes++; }
  remove(): void { this.removed = true; }
}

class FakeSvg implements ShapeSvgLike {
  attrs: Record<string, string> = { [SHAPE_FILL_SVG_ATTR]: '' };
  innerHTML = '';
  style = { cssText: '' };
  getAttribute(name: string): string | null { return this.attrs[name] ?? null; }
  setAttribute(name: string, value: string): void { this.attrs[name] = value; }
  after(): void {}
  remove(): void {}
}

class FakeHost implements ShapeHostLike {
  fill = new FakeSvg();
  style = { opacity: '' };
  querySelector(selectors: string): ShapeSvgLike | null {
    return selectors.includes(SHAPE_FILL_SVG_ATTR) ? this.fill : null;
  }
}

interface FakeNode { style: { visibility: string }; host: FakeHost }

/** The surface as the preview sees it: every node mounted (`nodes`), a
 *  parked svg per shown node (`parked`) holding its paths. */
function fakeDom(getState: () => CompositionState) {
  const nodes = new Map<string, FakeNode>();
  const parked = new Map<string, { frame: ShapeStrokePreviewFrame; paths: FakePath[] }>();
  const log: string[] = [];
  const mounted = (id: string): FakeNode => {
    let node = nodes.get(id);
    if (!node) { node = { style: { visibility: '' }, host: new FakeHost() }; nodes.set(id, node); }
    return node;
  };
  const dom: ErasePreviewDom = {
    nodeEl: (id) => nodes.get(id) ?? null,
    frameOf: (id) => {
      const d = drawnLeaf(graphOf(getState()), id);
      return d ? shapeStrokePreviewFrame(d, getState().strokeScale, BASE_CELL_PX) : null;
    },
    park: (id, frame) => {
      if (!nodes.has(id)) return false;
      log.push(`park ${id}`);
      parked.set(id, { frame, paths: [] });
      return true;
    },
    addPath: (id) => {
      const p = parked.get(id);
      if (!p) return null;
      const path = new FakePath();
      p.paths.push(path);
      return path;
    },
    unpark: (id) => { log.push(`unpark ${id}`); parked.delete(id); },
    hostOf: (id) => nodes.get(id)?.host ?? null,
    drawnOf: (id) => drawnLeaf(graphOf(getState()), id) ?? null,
    strokeScale: () => getState().strokeScale,
  };
  return { dom, nodes, parked, log, mounted };
}

/** The `d` a path would carry for the kept pieces of flat segments
 *  `[from, to)` of a target drawn in `frame`. */
function expectedD(state: CompositionState, svg: SVGObject, discs: [number, number, number][], from: number, to: number): string {
  const t = vectorEraseTarget(state, svg, true)!;
  for (const [x, y, r] of discs) cutVectorTarget(t, x, y, r);
  const frame = shapeStrokePreviewFrame(drawnLeaf(graphOf(state), svg.id)!, state.strokeScale, BASE_CELL_PX);
  const pieces = keptPieces(t, frame.flat.map((f) => f.segment));
  return buildPathD(pieces.slice(from, to).flat());
}

describe('createVectorErasePreview: a live cut', () => {
  it('hides the node, parks one svg, and draws what the disc leaves as chunked paths wearing the frame\'s stroke', () => {
    const svg = polyline('svg_a', 10);
    const state = stateWith([svg]);
    const { dom, mounted, parked, log } = fakeDom(() => state);
    const node = mounted('svg_a');
    const preview = createVectorErasePreview(dom);
    expect(preview.cut(state, 'svg_a', 5, 0, 1)).toBe(true);
    expect(node.style.visibility).toBe('hidden');
    expect(log).toEqual(['park svg_a']);
    const paths = parked.get('svg_a')!.paths;
    expect(paths).toHaveLength(1);
    expect(paths[0].attrs.d).toBe(expectedD(state, svg, [[5, 0, 1]], 0, 10));
    expect(paths[0].attrs.stroke).toBe('rgb(0, 0, 0)');
    expect(paths[0].attrs.fill).toBe('none');
    expect(paths[0].attrs['stroke-width']).toBeDefined();
    expect(preview.shown()).toEqual(['svg_a']);
  });

  it('a second cut rewrites the chunks it changed and no other', () => {
    const svg = polyline('svg_long', 300);
    const state = stateWith([svg]);
    const { dom, mounted, parked } = fakeDom(() => state);
    mounted('svg_long');
    const preview = createVectorErasePreview(dom);
    preview.cut(state, 'svg_long', 10.5, 0, 0.3);
    const paths = parked.get('svg_long')!.paths;
    // 300 segments: three chunks of 128, 128 and 44.
    expect(paths).toHaveLength(Math.ceil(300 / CHUNK_SEGMENTS));
    expect(paths.map((p) => p.writes)).toEqual([1, 1, 1]);
    // A cut in the last chunk alone.
    preview.cut(state, 'svg_long', 290.5, 0, 0.3);
    expect(paths.map((p) => p.writes)).toEqual([1, 1, 2]);
    expect(paths[2].attrs.d).toBe(expectedD(state, svg, [[10.5, 0, 0.3], [290.5, 0, 0.3]], 256, 300));
    expect(paths[0].attrs.d).toBe(expectedD(state, svg, [[10.5, 0, 0.3]], 0, 128));
    // A disc that misses the path changes nothing.
    preview.cut(state, 'svg_long', 150, 5, 1);
    expect(paths.map((p) => p.writes)).toEqual([1, 1, 2]);
  });

  it('refuses a node not in the scene, one that may not be cut, and one not mounted', () => {
    const state = stateWith([polyline('svg_a', 4), polyline('svg_pattern', 4, { tileMode: 'repeat' })]);
    const { dom, mounted } = fakeDom(() => state);
    mounted('svg_pattern');
    const preview = createVectorErasePreview(dom);
    expect(preview.cut(state, 'svg_none', 1, 0, 1)).toBe(false);
    expect(preview.cut(state, 'svg_pattern', 1, 0, 1)).toBe(false);
    expect(preview.cut(state, 'svg_a', 1, 0, 1)).toBe(false);         // not mounted
    expect(preview.shown()).toEqual([]);
  });

  it('a filled shape shows as its outline alone, which is what the commit writes', () => {
    const square: SVGObject = {
      ...polyline('svg_sq', 4), fillColor: RED,
      segments: [
        { kind: 'line', start: [0, 0], end: [4, 0] }, { kind: 'line', start: [4, 0], end: [4, 4] },
        { kind: 'line', start: [4, 4], end: [0, 4] }, { kind: 'line', start: [0, 4], end: [0, 0] },
      ],
      cellWidth: 4, cellHeight: 4,
    };
    const state = stateWith([square]);
    const { dom, mounted, parked } = fakeDom(() => state);
    mounted('svg_sq');
    const preview = createVectorErasePreview(dom);
    expect(preview.cut(state, 'svg_sq', 2, 0, 0.5)).toBe(true);
    const paths = parked.get('svg_sq')!.paths;
    expect(paths).toHaveLength(1);
    expect(paths[0].attrs.fill).toBe('none');
    expect(paths[0].attrs.d).toBe(expectedD(state, square, [[2, 0, 0.5]], 0, 4));
  });

  it('reset shows the node again: visibility back, the svg unparked, nothing shown', () => {
    const state = stateWith([polyline('svg_a', 4), polyline('svg_b', 4)]);
    const { dom, mounted, log } = fakeDom(() => state);
    const a = mounted('svg_a');
    a.style.visibility = 'visible';
    mounted('svg_b');
    const preview = createVectorErasePreview(dom);
    preview.cut(state, 'svg_a', 2, 0, 0.5);
    preview.cut(state, 'svg_b', 2, 0, 0.5);
    preview.reset('svg_a');
    expect(a.style.visibility).toBe('visible');
    expect(preview.shown()).toEqual(['svg_b']);
    preview.reset();
    expect(preview.shown()).toEqual([]);
    expect(log).toEqual(['park svg_a', 'park svg_b', 'unpark svg_a', 'unpark svg_b']);
  });
});

describe('the fallback for a node that is more than a stroked path', () => {
  const styled = (id: string): SVGObject => polyline(id, 6, {
    effects: { lineStyle: { glyph: 'line', density: 0.5, size: 0.5, rotation: 0, randomPlacement: 0, randomRotation: 0, randomSize: 0 } },
  });

  it('is chosen for a node with an effect and for no other', () => {
    expect(needsMarkupFallback(polyline('a', 2))).toBe(false);
    expect(needsMarkupFallback(polyline('a', 2, { effects: {} }))).toBe(false);
    expect(needsMarkupFallback(styled('a'))).toBe(true);
    expect(needsMarkupFallback(polyline('a', 2, { effects: { shadow: { color: BLACK, alpha: 0.5, dx: 1, dy: 1, radius: 1 } as never } }))).toBe(true);
  });

  it('re-mounts the node from its own markup, cut, in its own box; reset re-mounts the record', () => {
    const svg = styled('svg_s');
    const state = stateWith([svg]);
    const { dom, mounted, parked, log } = fakeDom(() => state);
    const node = mounted('svg_s');
    const d = drawnLeaf(graphOf(state), 'svg_s')!;
    const original = svgLayerMarkup(d, state.strokeScale);
    node.host.fill.innerHTML = original.html;
    const preview = createVectorErasePreview(dom);
    // A disc over the path's first glyph, so the stamps re-lay.
    expect(preview.cut(state, 'svg_s', 0.6, 0, 0.5)).toBe(true);
    // Not hidden, nothing parked: the node itself is redrawn.
    expect(node.style.visibility).toBe('');
    expect(parked.size).toBe(0);
    expect(log).toEqual([]);
    const t = vectorEraseTarget(state, svg, true)!;
    cutVectorTarget(t, 0.6, 0, 0.5);
    const cut = cutRecord(t);
    expect(cut.segments).toHaveLength(6);                 // a stub, then the rest from past the gap
    expect(cut.cellX).toBe(svg.cellX);
    expect(cut.cellWidth).toBe(svg.cellWidth);
    const leaf = cutLeaf(t, d);
    // The local geometry is cut by the same fractions; the box is pinned.
    expect(leaf.node.localSegments).toHaveLength(6);
    expect(leaf.node.localSegments![0].end[0]).toBeCloseTo(leaf.node.localSegments![0].start[0] + 0.1, 9);
    expect(leaf.node.localBox).toEqual({ x: -3, y: 0, width: 6, height: 0 });
    const expected = svgLayerMarkup(leaf, state.strokeScale);
    expect(expected.viewBox).toBe(original.viewBox);
    expect(node.host.fill.innerHTML).toBe(expected.html);
    expect(node.host.fill.innerHTML).not.toBe(original.html);
    // Fewer stamps fit the shorter path, and none stands in the gap.
    expect((expected.html.match(/ M /g) ?? []).length).toBeLessThan((original.html.match(/ M /g) ?? []).length);
    preview.reset();
    expect(node.host.fill.innerHTML).toBe(original.html);
  });

  it('cutRecord takes a filled shape\'s fill off and keeps subpaths as subpaths', () => {
    const svg: SVGObject = {
      ...polyline('svg_sub', 2), fillColor: RED,
      subpaths: [
        { color: BLACK, segments: [{ kind: 'line', start: [0, 0], end: [1, 0] }] },
        { color: RED, segments: [{ kind: 'line', start: [1, 0], end: [2, 0] }] },
      ],
    };
    const state = stateWith([svg]);
    const t = vectorEraseTarget(state, svg, true)!;
    cutVectorTarget(t, 1.5, 0, 0.2);
    const cut = cutRecord(t);
    expect(cut.fillColor).toBeUndefined();
    expect(cut.subpaths).toHaveLength(2);
    expect(cut.subpaths![0].segments).toHaveLength(1);
    expect(cut.subpaths![1].segments).toHaveLength(2);
    expect(cut.segments).toHaveLength(3);
  });
});

describe('surviving a render', () => {
  it('a node whose record changed is cut again from the new one, with every disc it had; one gone is let go', () => {
    const a = polyline('svg_a', 10);
    const b = polyline('svg_b', 10);
    let state = stateWith([a, b]);
    const { dom, mounted, parked, log } = fakeDom(() => state);
    const nodeA = mounted('svg_a');
    mounted('svg_b');
    const preview = createVectorErasePreview(dom);
    preview.cut(state, 'svg_a', 2, 0, 0.5);
    preview.cut(state, 'svg_a', 7, 0, 0.5);
    preview.cut(state, 'svg_b', 5, 0, 0.5);
    // A commit: `a` recoloured (a new record, same id), `b` deleted.
    const recoloured: SVGObject = { ...a, color: RED };
    state = {
      ...state,
      svgObjects: state.svgObjects.map((o) => (o.id === 'svg_a' ? recoloured : o)).filter((o) => o.id !== 'svg_b'),
      sceneOrder: state.sceneOrder.filter((id) => id !== 'svg_b'),
      graph: undefined,
    };
    nodeA.style.visibility = '';                           // React drew the new record
    preview.refresh(state);
    expect(preview.shown()).toEqual(['svg_a']);
    expect(nodeA.style.visibility).toBe('hidden');
    const paths = parked.get('svg_a')!.paths;
    expect(paths).toHaveLength(1);
    expect(paths[0].attrs.stroke).toBe('rgb(200, 20, 20)');
    expect(paths[0].attrs.d).toBe(expectedD(state, recoloured, [[2, 0, 0.5], [7, 0, 0.5]], 0, 10));
    expect(log).toEqual(['park svg_a', 'park svg_b', 'unpark svg_a', 'park svg_a', 'unpark svg_b']);
    // Unchanged records cost nothing.
    preview.refresh(state);
    expect(log).toHaveLength(5);
  });
});

describe('the gesture and the live cut are one implementation', () => {
  it('update(es) draws the same paths a live cut of the same disc draws', () => {
    const svg = polyline('svg_a', 10);
    const state = stateWith([svg]);
    const live = fakeDom(() => state);
    live.mounted('svg_a');
    createVectorErasePreview(live.dom).cut(state, 'svg_a', 5, 0, 1);
    const gesture = fakeDom(() => state);
    gesture.mounted('svg_a');
    const es = createVectorEraseState(null, new Set());
    eraseVectorDab(es, state, 5, 0, 1);
    const preview = createVectorErasePreview(gesture.dom);
    preview.update(es);
    expect(gesture.parked.get('svg_a')!.paths.map((p) => p.attrs)).toEqual(live.parked.get('svg_a')!.paths.map((p) => p.attrs));
    // An unchanged revision costs nothing more.
    preview.update(es);
    expect(gesture.parked.get('svg_a')!.paths[0].writes).toBe(1);
  });
});
