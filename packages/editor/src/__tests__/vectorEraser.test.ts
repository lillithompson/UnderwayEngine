/**
 * The Color brush's eraser (vectorEraser.ts, bug report 6b36fe8b): a dab
 * cuts the stroked geometry under its disc out of the path, landing cut
 * vertices exactly on the disc's edge and leaving every surviving piece on
 * the curve it was on.
 */

import {
  buildVectorEraseEntry, createVectorEraseState, cutVectorTarget, eraseVectorDab, keptPieces,
  segmentCircleCover, subtractIntervals, vectorErasable, vectorEraseTarget,
} from '../vectorEraser';
import { makeBlankComposition } from '@/editor/blankComposition';
import { applyCompOps, revertCompOps } from '@/engine/compositionOps';
import { arcRadius } from '@/engine/compositionArcMath';
import type { CompositionState, PathSegment, SVGObject } from '@/engine/types';

const line = (start: [number, number], end: [number, number]): PathSegment =>
  ({ kind: 'line', start, end });

const BLACK = { r: 0, g: 0, b: 0 };

function hline(id: string, extras: Partial<SVGObject> = {}): SVGObject {
  return {
    id, segments: [line([0, 0], [10, 0])], color: BLACK,
    cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 0, ...extras,
  };
}

function stateWith(objects: SVGObject[]): CompositionState {
  return { ...makeBlankComposition('comp_test'), svgObjects: objects, sceneOrder: objects.map((o) => o.id) };
}

function erase(state: CompositionState, dabs: [number, number][], r: number,
  filter: Set<string> | null = null) {
  const es = createVectorEraseState(filter, new Set());
  let changed = false;
  for (const [x, y] of dabs) changed = eraseVectorDab(es, state, x, y, r) || changed;
  return { es, changed, entry: buildVectorEraseEntry(state, es) };
}

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('segmentCircleCover', () => {
  it('covers the run of a line inside the disc, cut at the crossings', () => {
    const cover = segmentCircleCover(line([0, 0], [10, 0]), 5, 0, 1);
    expect(cover).toHaveLength(1);
    close(cover[0][0], 0.4);
    close(cover[0][1], 0.6);
  });

  it('covers nothing when the disc misses, and everything when it swallows', () => {
    expect(segmentCircleCover(line([0, 0], [10, 0]), 5, 3, 1)).toEqual([]);
    expect(segmentCircleCover(line([0, 0], [1, 0]), 0.5, 0, 5)).toEqual([[0, 1]]);
  });

  it('covers an end the disc sits over from the end itself', () => {
    const cover = segmentCircleCover(line([0, 0], [10, 0]), 0, 0, 2);
    expect(cover).toHaveLength(1);
    close(cover[0][0], 0);
    close(cover[0][1], 0.2);
  });

  it('cuts an arc where the disc crosses its own circle', () => {
    const arc: PathSegment = { kind: 'arc', start: [5, 0], end: [0, 5], center: [0, 0] };
    const m = 5 * Math.SQRT1_2;
    const cover = segmentCircleCover(arc, m, m, 1);
    expect(cover).toHaveLength(1);
    const [f0, f1] = cover[0];
    // Symmetric about the arc's midpoint, which the disc is centred on.
    close(f0 + f1, 1);
    // The cut angle is where a circle of radius 1 about the midpoint meets
    // the radius-5 arc: chord 1 subtends 2·asin(1/10).
    close((f1 - f0) * (Math.PI / 2), 4 * Math.asin(1 / 10));
  });
});

describe('subtractIntervals', () => {
  it('splits, trims and drops', () => {
    expect(subtractIntervals([[0, 1]], [[0.4, 0.6]])).toEqual([[0, 0.4], [0.6, 1]]);
    expect(subtractIntervals([[0, 0.4], [0.6, 1]], [[0.3, 0.7]])).toEqual([[0, 0.3], [0.7, 1]]);
    expect(subtractIntervals([[0.2, 0.3]], [[0, 1]])).toEqual([]);
    expect(subtractIntervals([[0, 1]], [])).toEqual([[0, 1]]);
  });
});

describe('eraseVectorDab + buildVectorEraseEntry', () => {
  it('cuts a gap out of a line, with cut vertices on the disc edge', () => {
    const state = stateWith([hline('svg_a')]);
    const { changed, entry } = erase(state, [[5, 0]], 1);
    expect(changed).toBe(true);
    const next = applyCompOps(state, entry!);
    const svg = next.svgObjects[0];
    expect(svg.segments).toHaveLength(2);
    expect(svg.segments[0].start).toEqual([0, 0]);
    close(svg.segments[0].end[0], 4);
    close(svg.segments[1].start[0], 6);
    expect(svg.segments[1].end).toEqual([10, 0]);
    // Still one object: the gap is a move-to inside the same path.
    expect(next.svgObjects).toHaveLength(1);
    // …and undo puts the whole line back.
    expect(revertCompOps(next, entry!).svgObjects[0].segments).toEqual(state.svgObjects[0].segments);
  });

  it('shrinks the box to what is left', () => {
    const state = stateWith([hline('svg_a')]);
    const { entry } = erase(state, [[0, 0], [1, 0], [2, 0]], 1.5);
    const svg = applyCompOps(state, entry!).svgObjects[0];
    close(svg.cellX, 3.5);
    close(svg.cellWidth, 6.5);
  });

  it('keeps an arc on its own circle', () => {
    const arc: SVGObject = {
      id: 'svg_arc', color: BLACK,
      segments: [{ kind: 'arc', start: [5, 0], end: [0, 5], center: [0, 0] }],
      cellX: 0, cellY: 0, cellWidth: 5, cellHeight: 5,
    };
    const state = stateWith([arc]);
    const m = 5 * Math.SQRT1_2;
    const { entry } = erase(state, [[m, m]], 1);
    const segs = applyCompOps(state, entry!).svgObjects[0].segments;
    expect(segs).toHaveLength(2);
    for (const s of segs) {
      expect(s.kind).toBe('arc');
      if (s.kind !== 'arc') continue;
      expect(s.center).toEqual([0, 0]);
      close(arcRadius(s), 5);
      close(Math.hypot(s.end[0], s.end[1]), 5);
    }
    // The cut vertices sit on the brush disc's edge.
    close(Math.hypot(segs[0].end[0] - m, segs[0].end[1] - m), 1);
    close(Math.hypot(segs[1].start[0] - m, segs[1].start[1] - m), 1);
  });

  it('removes a path erased entirely', () => {
    const state = stateWith([hline('svg_a', { segments: [line([0, 0], [1, 0])], cellWidth: 1 })]);
    const { entry } = erase(state, [[0.5, 0]], 2);
    const next = applyCompOps(state, entry!);
    expect(next.svgObjects).toHaveLength(0);
    expect(revertCompOps(next, entry!).svgObjects.map((o) => o.id)).toEqual(['svg_a']);
  });

  it('cuts each colour run of a multi-colour path in place', () => {
    const RED = { r: 255, g: 0, b: 0 };
    const segs = [line([0, 0], [10, 0]), line([10, 0], [20, 0])];
    const state = stateWith([hline('svg_m', {
      segments: segs, cellWidth: 20,
      subpaths: [{ color: BLACK, segments: [segs[0]] }, { color: RED, segments: [segs[1]] }],
    })]);
    const { entry } = erase(state, [[15, 0]], 1);
    const svg = applyCompOps(state, entry!).svgObjects[0];
    expect(svg.subpaths).toHaveLength(2);
    expect(svg.subpaths![0].segments).toEqual([segs[0]]);
    expect(svg.subpaths![1].color).toEqual(RED);
    expect(svg.subpaths![1].segments).toHaveLength(2);
    expect(svg.segments).toHaveLength(3);
  });

  it('keeps the surviving piece of a turned path drawn where it was', () => {
    // A path drawn turned 90° about its box centre: drawn = R(p − c) + c.
    const turned = hline('svg_t', { angleDeg: 90, cellY: 0 });
    const state = stateWith([turned]);
    const drawn = (svg: SVGObject, p: readonly [number, number]): [number, number] => {
      const cx = svg.cellX + svg.cellWidth / 2;
      const cy = svg.cellY + svg.cellHeight / 2;
      const a = ((svg.angleDeg ?? 0) * Math.PI) / 180;
      const dx = p[0] - cx, dy = p[1] - cy;
      return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
    };
    // Where the far end (10, 0) is drawn — and a dab on the drawn NEAR end.
    const farBefore = drawn(turned, [10, 0]);
    const nearDrawn = drawn(turned, [0, 0]);
    const { entry } = erase(state, [nearDrawn], 3);
    expect(entry).not.toBeNull();
    const after = applyCompOps(state, entry!).svgObjects[0];
    const farAfter = drawn(after, after.segments[after.segments.length - 1].end);
    close(farAfter[0], farBefore[0]);
    close(farAfter[1], farBefore[1]);
  });

  it('leaves filled shapes, locked paths and unselected paths alone', () => {
    const filled = hline('svg_f', { fillColor: BLACK });
    expect(vectorErasable(filled)).toBe(false);
    const locked = hline('svg_l', { locked: true });
    const other = hline('svg_o');
    const state = stateWith([filled, locked, other]);
    expect(erase(state, [[5, 0]], 1, new Set(['svg_f', 'svg_l'])).entry).toBeNull();
    const { entry } = erase(state, [[5, 0]], 1);
    expect(entry!.map((op) => ('svgId' in op ? op.svgId : null))).toEqual(['svg_o']);
  });

  // DrawBots' Erase effect (bug 9a6bd320) cuts a filled shape's outline
  // too, and takes the fill off what is left itself.
  it('cuts a filled shape that draws an outline only when asked to', () => {
    const filled = hline('svg_f', { fillColor: BLACK });
    expect(vectorErasable(filled, true)).toBe(true);
    expect(vectorErasable({ ...filled, stroke: { width: 0 } }, true)).toBe(false);
    expect(vectorErasable({ ...filled, patternFill: {} as SVGObject['patternFill'] }, true)).toBe(false);
    expect(vectorErasable(hline('svg_r', { tileMode: 'repeat' }), true)).toBe(false);
    expect(vectorEraseTarget(stateWith([filled]), filled)).toBeNull();
    const t = vectorEraseTarget(stateWith([filled]), filled, true)!;
    expect(cutVectorTarget(t, 5, 3, 1)).toBe(false);
    expect(cutVectorTarget(t, 5, 0, 1)).toBe(true);
    expect(t.rev).toBe(1);
    const pieces = keptPieces(t, filled.segments)[0];
    expect(pieces).toHaveLength(2);
    close(pieces[0].end[0], 4);
    close(pieces[1].start[0], 6);
  });
});
