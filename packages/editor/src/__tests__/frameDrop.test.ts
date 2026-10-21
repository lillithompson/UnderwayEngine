import { CompositionState, PathSegment, SVGObject, TextObject } from '@/engine/types';
import { applyCompOps, findItem, revertCompOps } from '@/engine/compositionOps';
import {
  buildMoveNodeWithFrameReparent,
  currentFrameId,
  dragTargetFrameId,
} from '../frameDrop';
import { turnOf } from './test-utils';

// Figma-style frame membership from canvas drags: dropping a node so it
// overlaps a frame's space adopts it; dropping it fully outside removes it.
// State is built as a literal (same pattern as frameActions.test.ts) so the
// suite stays independent of the scaffold pipeline.

function rectSegments(x: number, y: number, w: number, h: number): PathSegment[] {
  return [
    { kind: 'line', start: [x, y], end: [x + w, y] },
    { kind: 'line', start: [x + w, y], end: [x + w, y + h] },
    { kind: 'line', start: [x + w, y + h], end: [x, y + h] },
    { kind: 'line', start: [x, y + h], end: [x, y] },
  ];
}

function boundary(id: string, groupId: string, x: number, y: number, w: number, h: number): SVGObject {
  return {
    id, groupId, isMask: true, hidden: true,
    color: { r: 0, g: 0, b: 0 }, segments: rectSegments(x, y, w, h),
    cellX: x, cellY: y, cellWidth: w, cellHeight: h,
    localCellX: x, localCellY: y, localCellWidth: w, localCellHeight: h,
    localSegments: rectSegments(x, y, w, h),
  } as unknown as SVGObject;
}

function looseSvg(id: string, x: number, y: number, w: number, h: number, extra?: Partial<SVGObject>): SVGObject {
  return {
    id, color: { r: 0, g: 0, b: 0 }, segments: rectSegments(x, y, w, h),
    cellX: x, cellY: y, cellWidth: w, cellHeight: h,
    ...extra,
  } as unknown as SVGObject;
}

function frameText(id: string, groupId: string): TextObject {
  return {
    id, groupId, content: id,
    style: { fontId: 'system', size: 2, color: { r: 0, g: 0, b: 0 } },
    cellX: 2, cellY: 2, cellWidth: 20, cellHeight: 3,
    localCellX: 2, localCellY: 2, localCellWidth: 20, localCellHeight: 3,
  } as unknown as TextObject;
}

/** Frame "frame" (0,0 32×42) with a hidden boundary + text member, plus a
 *  loose svg square outside the frame at (40,2 4×4). */
function baseState(opts?: { lockFrame?: boolean }): CompositionState {
  return {
    id: 'c', name: 'c',
    figures: [],
    svgObjects: [
      boundary('svg_boundary', 'frame', 0, 0, 32, 42),
      looseSvg('svg_loose', 40, 2, 4, 4),
    ],
    images: [],
    texts: [frameText('txt1', 'frame')],
    groups: [{
      id: 'frame', name: 'Daily Haiku', translateX: 0, translateY: 0,
      scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false, isFrame: true,
      locked: opts?.lockFrame ? true : undefined,
    }],
    sceneOrder: ['svg_boundary', 'txt1', 'svg_loose'],
    viewport: { width: 400, height: 600 },
    camera: { x: 0, y: 0, zoom: 1 },
    selectedFigureIds: new Set<string>(),
  } as unknown as CompositionState;
}

describe('dragTargetFrameId', () => {
  it('resolves the frame when the displaced bbox overlaps it', () => {
    expect(dragTargetFrameId(baseState(), 'svg_loose', -20, 0)).toBe('frame');
  });

  it('any overlap counts — a partial edge overlap still targets the frame', () => {
    // svg_loose at 40..44 dragged by -10 → 30..34, overlapping 0..32 by 2 cells.
    expect(dragTargetFrameId(baseState(), 'svg_loose', -10, 0)).toBe('frame');
  });

  it('edge-touching boxes are fully out', () => {
    // Dragged by -8 → 32..36: touches the frame's right edge exactly.
    expect(dragTargetFrameId(baseState(), 'svg_loose', -8, 0)).toBeNull();
    expect(dragTargetFrameId(baseState(), 'svg_loose', 0, 0)).toBeNull();
  });

  it('a locked frame accepts no drops', () => {
    expect(dragTargetFrameId(baseState({ lockFrame: true }), 'svg_loose', -20, 0)).toBeNull();
  });

  it('the front-most overlapping frame wins', () => {
    const s = baseState();
    s.svgObjects.push(boundary('svg_boundary2', 'frame2', 16, 0, 32, 42));
    s.groups.push({
      id: 'frame2', name: 'Second', translateX: 0, translateY: 0,
      scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false, isFrame: true,
    });
    s.sceneOrder = ['svg_boundary', 'txt1', 'svg_boundary2', 'svg_loose'];
    // Dragged to 20..24: overlaps both frames; frame2's boundary is front-most.
    expect(dragTargetFrameId(s, 'svg_loose', -20, 0)).toBe('frame2');
  });

  it('honours the node’s free rotation (rotated AABB overlaps)', () => {
    const s = baseState();
    // A 2×12 box at (33,5): upright it clears the frame; at 90° its AABB
    // spans x 28..40 and overlaps.
    s.svgObjects.push(looseSvg('svg_tall', 33, 5, 2, 12));
    s.sceneOrder = [...s.sceneOrder, 'svg_tall'];
    expect(dragTargetFrameId(s, 'svg_tall', 0, 0)).toBeNull();
    (s.svgObjects.find((x) => x.id === 'svg_tall') as unknown as { angleDeg: number }).angleDeg = 90;
    expect(dragTargetFrameId(s, 'svg_tall', 0, 0)).toBe('frame');
  });
});

describe('a word dropped onto a ROTATED frame (the Adrift report)', () => {
  // The same frame given a quarter turn: local (0,0,42,32) slid so it
  // still sits at world (0,0,32,42) — the boundary's locals are the
  // world rect inverted through the group, as reconcile keeps them.
  function rotatedState(): CompositionState {
    const s = baseState();
    const frame = { ...s.groups[0], rotation: 90 as const, translateX: 32 };
    const boundaryRect = {
      ...boundary('svg_boundary', 'frame', 0, 0, 32, 42),
      localCellX: 0, localCellY: 0, localCellWidth: 42, localCellHeight: 32,
      localSegments: rectSegments(0, 0, 42, 32),
    };
    const word = {
      id: 'txt_word', content: 'dawn',
      style: { fontId: 'system', size: 2, color: { r: 0, g: 0, b: 0 } },
      cellX: 40, cellY: 2, cellWidth: 6, cellHeight: 2,
    } as unknown as TextObject;
    return {
      ...s, groups: [frame], svgObjects: [boundaryRect], texts: [word],
      sceneOrder: ['svg_boundary', 'txt_word'],
    } as CompositionState;
  }

  it('lands where it was dropped, looking as it did, and turns with the frame from then on', () => {
    const s = rotatedState();
    const se = buildMoveNodeWithFrameReparent(s, 'txt_word', -20, 0)!;
    expect(se.entry.map((op) => op.op)).toEqual(['setTransform', 'reparentNode']);
    const dropped = applyCompOps(s, se.entry);
    const w = dropped.texts![0];
    expect(w.groupId).toBe('frame');
    expect([w.cellX, w.cellY, w.cellWidth, w.cellHeight]).toEqual([20, 2, 6, 2]);
    expect(w.rotation ?? 0).toBe(0);
    // It was dropped upright, so the frame's next transform moves nothing
    // (it used to turn the word a quarter on the spot, leaving its pixels
    // and its selection box off its bbox).
    const frame = dropped.groups[0];
    const still = applyCompOps(dropped, [{
      op: 'transformGroup', groupId: 'frame',
      oldTranslateX: frame.translateX, oldTranslateY: frame.translateY, oldScaleX: 1, oldScaleY: 1,
      oldRotation: frame.rotation, oldMirrorH: false, oldMirrorV: false,
      newTranslateX: frame.translateX, newTranslateY: frame.translateY, newScaleX: 1, newScaleY: 1,
      newRotation: frame.rotation, newMirrorH: false, newMirrorV: false,
    }]);
    expect(still.texts![0]).toEqual(w);
    // Another quarter turn of the frame turns the word with it.
    const turned = applyCompOps(dropped, [{
      op: 'transformGroup', groupId: 'frame',
      oldTranslateX: frame.translateX, oldTranslateY: frame.translateY, oldScaleX: 1, oldScaleY: 1,
      oldRotation: frame.rotation, oldMirrorH: false, oldMirrorV: false,
      newTranslateX: frame.translateX, newTranslateY: frame.translateY, newScaleX: 1, newScaleY: 1,
      newRotation: 180, newMirrorH: false, newMirrorV: false,
    }]);
    // Asked of the DRAWN turn, not of `rotation`: the frame's quarter lands
    // in whichever channel the leaf carries, and both spell the same pose
    // (CozyJournal's docs/transform-refactor.md §1.3).
    expect(turnOf(turned, w.id)).toBe(90);
  });
});

describe('buildMoveNodeWithFrameReparent', () => {
  it('dropping a loose node onto a frame moves + reparents in one entry', () => {
    const s = baseState();
    const se = buildMoveNodeWithFrameReparent(s, 'svg_loose', -20, 0)!;
    expect(se.entry.map((op) => op.op)).toEqual(['setTransform', 'reparentNode']);

    const next = applyCompOps(s, se.entry);
    const item = findItem(next, 'svg_loose')!.item;
    expect(item.groupId).toBe('frame');
    expect(item.cellX).toBe(20); // world position preserved through the reparent
    expect(currentFrameId(next, 'svg_loose')).toBe('frame');
    // Front-most member of the frame: after the existing children, and the
    // frame's run stays contiguous.
    expect(next.sceneOrder).toEqual(['svg_boundary', 'txt1', 'svg_loose']);
  });

  it('dragging a member fully out of its frame removes it from the frame', () => {
    const s = baseState();
    // txt1 spans 2..22 → +40 puts it at 42..62, clear of the frame.
    const se = buildMoveNodeWithFrameReparent(s, 'txt1', 40, 0)!;
    expect(se.entry.map((op) => op.op)).toEqual(['setTransform', 'reparentNode']);

    const next = applyCompOps(s, se.entry);
    const item = findItem(next, 'txt1')!.item;
    expect(item.groupId).toBeUndefined();
    expect(item.cellX).toBe(42);
    expect(currentFrameId(next, 'txt1')).toBeNull();
    // Lands just in front of the frame it left.
    expect(next.sceneOrder.indexOf('txt1')).toBeGreaterThan(next.sceneOrder.indexOf('svg_boundary'));
  });

  it('a drag that stays overlapping its frame is a plain move', () => {
    const s = baseState();
    // txt1 (2..22) dragged +25 → 27..47: still overlaps the frame (0..32).
    const se = buildMoveNodeWithFrameReparent(s, 'txt1', 25, 0)!;
    expect(se.entry.map((op) => op.op)).toEqual(['setTransform']);
    expect(findItem(applyCompOps(s, se.entry), 'txt1')!.item.groupId).toBe('frame');
  });

  it('a drag with no frames involved is a plain move', () => {
    const se = buildMoveNodeWithFrameReparent(baseState(), 'svg_loose', 5, 5)!;
    expect(se.entry.map((op) => op.op)).toEqual(['setTransform']);
  });

  it('a frame’s own boundary rect never leaves its frame', () => {
    const s = baseState();
    const se = buildMoveNodeWithFrameReparent(s, 'svg_boundary', 100, 0)!;
    expect(se.entry.map((op) => op.op)).toEqual(['setTransform']);
    expect(findItem(applyCompOps(s, se.entry), 'svg_boundary')!.item.groupId).toBe('frame');
  });

  it('rips a plain group’s member into a frame, but leaves the group alone otherwise', () => {
    const s = baseState();
    s.svgObjects.push(
      looseSvg('svg_a', 40, 20, 4, 4, { groupId: 'pg' } as Partial<SVGObject>),
      looseSvg('svg_b', 46, 20, 4, 4, { groupId: 'pg' } as Partial<SVGObject>),
    );
    s.groups.push({
      id: 'pg', name: 'Group', translateX: 0, translateY: 0,
      scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false,
    });
    s.sceneOrder = ['svg_boundary', 'txt1', 'svg_loose', 'svg_a', 'svg_b'];

    // Moving within loose space: membership untouched (groups are not frames).
    const move = buildMoveNodeWithFrameReparent(s, 'svg_a', 0, 10)!;
    expect(move.entry.map((op) => op.op)).toEqual(['setTransform']);

    // Dropping onto the frame pulls it out of the group and into the frame.
    const drop = buildMoveNodeWithFrameReparent(s, 'svg_a', -30, 0)!;
    expect(drop.entry.map((op) => op.op)).toEqual(['setTransform', 'reparentNode']);
    const next = applyCompOps(s, drop.entry);
    expect(findItem(next, 'svg_a')!.item.groupId).toBe('frame');
    expect(findItem(next, 'svg_b')!.item.groupId).toBe('pg');
  });

  it('undo reverts the move and the reparent together', () => {
    const s = baseState();
    const se = buildMoveNodeWithFrameReparent(s, 'svg_loose', -20, 0)!;
    const next = applyCompOps(s, se.entry);
    const back = revertCompOps(next, se.entry);
    const item = findItem(back, 'svg_loose')!.item;
    expect(item.groupId).toBeUndefined();
    expect(item.cellX).toBe(40);
    expect(back.sceneOrder).toEqual(s.sceneOrder);
  });

  it('round-trips leaving a frame through undo too', () => {
    const s = baseState();
    const se = buildMoveNodeWithFrameReparent(s, 'txt1', 40, 0)!;
    const back = revertCompOps(applyCompOps(s, se.entry), se.entry);
    const item = findItem(back, 'txt1')!.item;
    expect(item.groupId).toBe('frame');
    expect(item.cellX).toBe(2);
    expect(back.sceneOrder).toEqual(s.sceneOrder);
  });
});
