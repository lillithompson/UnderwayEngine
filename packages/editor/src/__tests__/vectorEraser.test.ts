/**
 * The Color brush's eraser (vectorEraser.ts, bug report 6b36fe8b): a dab
 * cuts the stroked geometry under its disc out of the path, landing cut
 * vertices exactly on the disc's edge and leaving every surviving piece on
 * the curve it was on.
 */

import {
  buildVectorEraseEntry, createVectorEraseState, cutVectorTarget, erasedSvg, eraseVectorDab, keptPieces, keptPiecesOfSegment,
  paintedPiecesOfSegment, paintVectorTarget, segmentCircleCover, subtractIntervals, targetIsCut, vectorErasable,
  vectorEraseTarget,
} from '../vectorEraser';
import { type LineCover, lineCircleCover } from '@/engine/segmentCircleCut';
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

describe('lineCircleCover', () => {
  const out: LineCover = { t0: 0, t1: 0 };
  const cover = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number) =>
    (lineCircleCover(ax, ay, bx, by, cx, cy, r, out) ? [[out.t0, out.t1]] : []);

  it("is segmentCircleCover's answer for a line, written into the caller's two numbers", () => {
    const cases: [number, number, number, number, number, number, number][] = [
      [0, 0, 10, 0, 5, 0, 1],        // a run in the middle
      [0, 0, 10, 0, 5, 3, 1],        // a miss
      [0, 0, 1, 0, 0.5, 0, 5],       // swallowed
      [0, 0, 10, 0, 0, 0, 2],        // an end
      [0, 0, 10, 0, 10, 0.5, 1],     // the other end, off the line
      [3, 3, 3, 3, 3, 3, 1],         // a point inside
      [3, 3, 3, 3, 5, 3, 1],         // a point outside
      [0, 0, 10, 0, 5, 1, 1],        // tangent: the arithmetic decides, the two agree
    ];
    for (const [ax, ay, bx, by, cx, cy, r] of cases) {
      expect(cover(ax, ay, bx, by, cx, cy, r)).toEqual(segmentCircleCover(line([ax, ay], [bx, by]), cx, cy, r));
    }
  });

  it('writes nothing when there is no run', () => {
    out.t0 = 7; out.t1 = 8;
    expect(lineCircleCover(0, 0, 10, 0, 5, 3, 1, out)).toBe(false);
    expect(out).toEqual({ t0: 7, t1: 8 });
  });
});

describe('cutVectorTarget', () => {
  it('records the flat indices a dab changed, for a preview to redraw those chunks alone', () => {
    const svg: SVGObject = {
      id: 'svg_p', color: BLACK, cellX: 0, cellY: 0, cellWidth: 30, cellHeight: 0,
      segments: [line([0, 0], [10, 0]), line([10, 0], [20, 0]), line([20, 0], [30, 0])],
    };
    const t = vectorEraseTarget(stateWith([svg]), svg)!;
    expect(t.changed).toEqual([]);
    expect(cutVectorTarget(t, 25, 0, 1)).toBe(true);
    expect(t.changed).toEqual([2]);
    // A miss changes nothing; a dab on the joint changes both sides.
    expect(cutVectorTarget(t, 15, 5, 1)).toBe(false);
    expect(cutVectorTarget(t, 10, 0, 1)).toBe(true);
    expect(t.changed).toEqual([2, 0, 1]);
    // A dab over a segment already cut away whole is not a change.
    const whole = vectorEraseTarget(stateWith([svg]), svg)!;
    cutVectorTarget(whole, 5, 0, 20);
    whole.changed.length = 0;
    expect(cutVectorTarget(whole, 5, 0, 1)).toBe(false);
    expect(whole.changed).toEqual([]);
    // Per index, what keptPieces gives for all.
    const pieces = keptPieces(t, svg.segments);
    svg.segments.forEach((seg, i) => expect(keptPiecesOfSegment(t, i, seg)).toEqual(pieces[i]));
    // An uncut segment comes back as the very object.
    const fresh = vectorEraseTarget(stateWith([svg]), svg)!;
    expect(keptPiecesOfSegment(fresh, 1, svg.segments[1])).toEqual([svg.segments[1]]);
    expect(keptPiecesOfSegment(fresh, 1, svg.segments[1])[0]).toBe(svg.segments[1]);
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

// A target takes PAINT by the same discs (DrawBots' Paint effect): the
// stretch a disc covers is recoloured, not cut, and the record it leaves
// is its pieces regrouped by colour.
describe('paintVectorTarget', () => {
  const RED = { r: 220, g: 30, b: 30 };
  const BLUE = { r: 30, g: 60, b: 220 };
  const xs = (segs: readonly PathSegment[]) => segs.map((s) => [+s.start[0].toFixed(6), +s.end[0].toFixed(6)]);

  it('recolours the stretch under the disc and cuts nothing: the record is the line in three pieces, the middle the paint\'s', () => {
    const svg = hline('svg_a');
    const t = vectorEraseTarget(stateWith([svg]), svg, true)!;
    expect(paintVectorTarget(t, 5, 3, 1, RED)).toBe(false);          // the disc misses
    expect(t.rev).toBe(0);
    expect(paintVectorTarget(t, 5, 0, 1, RED)).toBe(true);
    expect(t.rev).toBe(1);
    expect(targetIsCut(t)).toBe(false);
    const pieces = paintedPiecesOfSegment(t, 0, svg.segments[0]);
    expect(xs(pieces.map((p) => p.segment))).toEqual([[0, 4], [4, 6], [6, 10]]);
    expect(pieces.map((p) => p.paint)).toEqual([undefined, RED, undefined]);
    const next = erasedSvg(t)!;
    expect(xs(next.segments)).toEqual([[0, 4], [4, 6], [6, 10]]);
    expect(next.subpaths!.map((s) => s.color)).toEqual([BLACK, RED, BLACK]);
    expect(next.subpaths!.map((s) => xs(s.segments))).toEqual([[[0, 4]], [[4, 6]], [[6, 10]]]);
    // Nothing moved: the box is the record's own.
    expect([next.cellX, next.cellY, next.cellWidth, next.cellHeight]).toEqual([0, 0, 10, 0]);
  });

  it('the colour already there changes nothing, and the base colour laid back takes the run away', () => {
    const svg = hline('svg_a');
    const t = vectorEraseTarget(stateWith([svg]), svg, true)!;
    expect(paintVectorTarget(t, 5, 0, 1, BLACK)).toBe(false);        // the line's own colour
    expect(t.painted).toBeUndefined();
    paintVectorTarget(t, 5, 0, 1, RED);
    expect(paintVectorTarget(t, 5, 0, 1, RED)).toBe(false);          // again: nothing new
    expect(t.rev).toBe(1);
    expect(paintVectorTarget(t, 5, 0, 1, BLACK)).toBe(true);
    expect(t.painted![0]).toEqual([]);
    expect(erasedSvg(t)!.subpaths).toBeUndefined();
  });

  it('the latest paint lies over the ones before it, and neighbours of one colour are one run', () => {
    const svg = hline('svg_a');
    const t = vectorEraseTarget(stateWith([svg]), svg, true)!;
    paintVectorTarget(t, 3, 0, 1, RED);
    paintVectorTarget(t, 4, 0, 1, BLUE);                              // over half of the red
    expect(t.painted![0].map(([f0, f1, c]) => [+f0.toFixed(6), +f1.toFixed(6), c])).toEqual([[0.2, 0.3, RED], [0.3, 0.5, BLUE]]);
    paintVectorTarget(t, 2.5, 0, 0.5, BLUE);                          // 2..3 in blue: red squeezed out
    expect(t.painted![0].map(([f0, f1]) => [+f0.toFixed(6), +f1.toFixed(6)])).toEqual([[0.2, 0.5]]);
  });

  it('an ink that is a rule makes each stretch\'s colour from the one it had', () => {
    const svg: SVGObject = {
      ...hline('svg_two'),
      segments: [line([0, 0], [5, 0]), line([5, 0], [10, 0])],
      subpaths: [{ color: RED, segments: [line([0, 0], [5, 0])] }, { color: BLUE, segments: [line([5, 0], [10, 0])] }],
    };
    const t = vectorEraseTarget(stateWith([svg]), svg, true)!;
    const swap = (from: { r: number; g: number; b: number }) => ({ r: from.b, g: from.g, b: from.r });
    expect(paintVectorTarget(t, 5, 0, 1, swap)).toBe(true);
    const next = erasedSvg(t)!;
    expect(next.subpaths!.map((s) => [s.color, xs(s.segments)])).toEqual([
      [RED, [[0, 4]]], [swap(RED), [[4, 5]]], [swap(BLUE), [[5, 6]]], [BLUE, [[6, 10]]],
    ]);
    // …and a second pass turns what the first left, back to where it began.
    expect(paintVectorTarget(t, 5, 0, 1, swap)).toBe(true);
    expect(erasedSvg(t)!.subpaths!.map((s) => s.color)).toEqual([RED, BLUE]);
  });

  it('a cut and a paint commute: what is left is cut and coloured whichever came first', () => {
    const svg = hline('svg_a');
    const state = stateWith([svg]);
    const a = vectorEraseTarget(state, svg, true)!;
    paintVectorTarget(a, 5, 0, 2, RED);
    cutVectorTarget(a, 5, 0, 1);
    const b = vectorEraseTarget(state, svg, true)!;
    cutVectorTarget(b, 5, 0, 1);
    paintVectorTarget(b, 5, 0, 2, RED);
    for (const t of [a, b]) {
      expect(targetIsCut(t)).toBe(true);
      const next = erasedSvg(t)!;
      expect(xs(next.segments)).toEqual([[0, 3], [3, 4], [6, 7], [7, 10]]);
      expect(next.subpaths!.map((s) => s.color)).toEqual([BLACK, RED, BLACK]);
      expect(next.subpaths![1].segments).toHaveLength(2);            // 3..4 and 6..7, one red run
    }
  });

  it('a sliver beside a painted piece joins it, so a painted outline keeps every bit of its line', () => {
    const svg = hline('svg_a');
    const t = vectorEraseTarget(stateWith([svg]), svg, true)!;
    // The disc's edge falls 0.0005 cells short of the line's end.
    paintVectorTarget(t, 9, 0, 0.9995, RED);
    const pieces = paintedPiecesOfSegment(t, 0, svg.segments[0]);
    expect(pieces).toHaveLength(2);
    close(pieces[1].segment.end[0], 10);
    expect(pieces[1].paint).toEqual(RED);
  });

  it('a filled shape\'s fill takes the paint whole, flat, while no cut has opened it', () => {
    const filled = hline('svg_f', { fillColor: BLUE, fillOpacity: 0.5 });
    const state = stateWith([filled]);
    const t = vectorEraseTarget(state, filled, true)!;
    expect(paintVectorTarget(t, 5, 0, 1, RED)).toBe(true);
    expect(t.fill).toEqual(RED);
    const next = erasedSvg(t)!;
    expect(next.fillColor).toEqual(RED);
    expect(next.fillOpacity).toBeUndefined();
    expect(next.subpaths!.map((s) => s.color)).toEqual([BLACK, RED, BLACK]);
    // A fill the outline's paint leaves alone but its own rule changes.
    const turned = vectorEraseTarget(state, filled, true)!;
    const onlyBlue = (from: { r: number; g: number; b: number }) => (from.b > 200 ? RED : from);
    expect(paintVectorTarget(turned, 5, 0, 1, onlyBlue)).toBe(true);
    expect(turned.painted).toBeUndefined();
    const flooded = erasedSvg(turned)!;
    expect(flooded.fillColor).toEqual(RED);
    expect(flooded.subpaths).toBeUndefined();
    // Cut as well: the record keeps the fill it had, for its caller to take off.
    cutVectorTarget(t, 8, 0, 0.5);
    expect(erasedSvg(t)!.fillColor).toEqual(BLUE);
  });

  it('a painted piece of a path whose line style stamps art is marked ink; a plain glyph\'s is not', () => {
    const style = {
      glyph: 'custom' as const, density: 0.5, size: 1, rotation: 0, randomPlacement: 0, randomRotation: 0, randomSize: 0,
      art: [{ points: [[0, 0], [1, 0], [1, 1]] as [number, number][], color: BLUE, width: 0.1 }],
    };
    const art = hline('svg_art', { effects: { lineStyle: style } as SVGObject['effects'] });
    const t = vectorEraseTarget(stateWith([art]), art, true)!;
    paintVectorTarget(t, 5, 0, 1, RED);
    expect(erasedSvg(t)!.subpaths!.map((s) => !!s.ink)).toEqual([false, true, false]);
    const plain = hline('svg_dots', { effects: { lineStyle: { ...style, glyph: 'circle', art: undefined } } as SVGObject['effects'] });
    const u = vectorEraseTarget(stateWith([plain]), plain, true)!;
    paintVectorTarget(u, 5, 0, 1, RED);
    expect(erasedSvg(u)!.subpaths!.some((s) => s.ink)).toBe(false);
  });
});
