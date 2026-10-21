import { applyCompOps, revertCompOps } from '@/engine/compositionOps';
import {
  PATTERN_SYMMETRY_OFF, PatternObject, RGBColor, TextObject,
} from '@/engine/types';
import { makeBlankComposition } from '../blankComposition';
import { poseOf } from './test-utils';
import {
  buildDuplicateSelected,
  buildMoveNode,
  buildMoveNodes,
  buildPlaceImage,
  buildPlacePolyline,
  buildRotateSelected,
  SessionEntry,
} from '../editorSession';
import { withSymmetryCopies } from '../symmetryObjects';
import { symmetryAffineMaps, type CanvasSymmetrySpec } from '../canvasSymmetry';
import {
  decomposeSymmetryLinear,
  symmetryDragPeers,
  symmetryPartnerCopy,
  withSymmetryReflection,
} from '../symmetryReflect';

// Canvas symmetry through EDITS: wrapping an action's entry in
// withSymmetryReflection refreshes the orbit of everything the entry
// touches — stale partners leave, partner copies of the new state arrive,
// one undo step. These pin the replace-orbit semantics, the guards that
// keep it from fighting the user, and the gesture / panel wiring.

const INK: RGBColor = { r: 10, g: 20, b: 30 };
const FRAME = { cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 8 };
const H: CanvasSymmetrySpec = {
  flags: { ...PATTERN_SYMMETRY_OFF, mirrorH: true }, frame: FRAME,
};
const HV: CanvasSymmetrySpec = {
  flags: { ...PATTERN_SYMMETRY_OFF, mirrorH: true, mirrorV: true }, frame: FRAME,
};

const blank = () => makeBlankComposition('c', 'Test');

/** A state holding one freehand stroke and its H partner, the way drawing
 *  under the mirror leaves them. */
function mirroredPair() {
  const se = withSymmetryCopies(buildPlacePolyline([[1, 1], [2, 3]], INK), H, 1)!;
  const state = applyCompOps(blank(), se.entry);
  const [primary, partner] = state.svgObjects;
  return { state, primary, partner };
}

describe('withSymmetryReflection', () => {
  test('a move drags the mirror along — stale partner out, fresh one in, one undo step', () => {
    const { state, primary, partner } = mirroredPair();
    const wrapped = withSymmetryReflection(
      state, buildMoveNode(state, primary.id, 0.5, 0.25), H, 1)!;
    const after = applyCompOps(state, wrapped.entry);
    expect(after.svgObjects).toHaveLength(2);
    expect(after.svgObjects.some((o) => o.id === partner.id)).toBe(false);
    // The fresh partner is the MOVED primary reflected about x = 4.
    const fresh = after.svgObjects.find((o) => o.id !== primary.id)!;
    const seg = fresh.segments[0];
    if (seg.kind !== 'line') throw new Error('expected a line');
    expect(seg.start[0]).toBeCloseTo(6.5);
    expect(seg.start[1]).toBeCloseTo(1.25);
    expect(seg.end[0]).toBeCloseTo(5.5);
    expect(seg.end[1]).toBeCloseTo(3.25);
    // One undo step restores the original pair, old partner included.
    const undone = revertCompOps(after, wrapped.entry);
    expect(undone.svgObjects.map((o) => o.id).sort())
      .toEqual([primary.id, partner.id].sort());
  });

  test('moving something never multiplies it: no partner in, no partner out', () => {
    // An object drawn before the mirror went on has no orbit, and an edit is
    // not where it gets one — dragging it (across the axis or anywhere else)
    // has to leave one object where there was one. Only an object ARRIVING
    // on the page is given a fresh orbit.
    const se0 = buildPlacePolyline([[1, 1], [2, 3]], INK)!;
    const state = applyCompOps(blank(), se0.entry);
    let cur = state;
    // All the way across the axis at x = 4, a cell at a time.
    for (let i = 0; i < 6; i++) {
      const wrapped = withSymmetryReflection(cur, buildMoveNode(cur, se0.id!, 1, 0), H, 1)!;
      cur = applyCompOps(cur, wrapped.entry);
      expect(cur.svgObjects).toHaveLength(1);
    }
    expect(cur.svgObjects[0].id).toBe(se0.id);
  });

  test('…and a standing pair stays a pair, all the way across', () => {
    // The other half of the rule: the partner an object HAS rides along.
    const { state, primary } = mirroredPair();
    let cur = state;
    for (let i = 0; i < 6; i++) {
      const wrapped = withSymmetryReflection(cur, buildMoveNode(cur, primary.id, 1, 0), H, 1)!;
      cur = applyCompOps(cur, wrapped.entry);
      expect(cur.svgObjects).toHaveLength(2);
    }
  });

  test('moving BOTH halves of a pair yourself is left alone — the user’s action wins', () => {
    const { state, primary, partner } = mirroredPair();
    const se = buildMoveNodes(state, [primary.id, partner.id], 1, 0)!;
    expect(withSymmetryReflection(state, se, H, 1)).toBe(se);
  });

  test('an object ON the axis never gets a coincident copy', () => {
    const se0 = buildPlacePolyline([[4, 1], [4, 3]], INK)!;
    const state = applyCompOps(blank(), se0.entry);
    const se = buildMoveNode(state, se0.id!, 0, 1)!;
    expect(withSymmetryReflection(state, se, H, 1)).toBe(se);
  });

  test('a LOCKED partner is neither removed nor doubled', () => {
    const { state, primary, partner } = mirroredPair();
    const locked = {
      ...state,
      svgObjects: state.svgObjects.map((o) =>
        o.id === partner.id ? { ...o, locked: true } : o),
    };
    const se = buildMoveNode(locked, primary.id, 1, 0)!;
    expect(withSymmetryReflection(locked, se, H, 1)).toBe(se);
  });

  test('rotating an image replaces its partner with the mirrored turn', () => {
    const place = buildPlaceImage('imgblob', 'image/png', 40, 20,
      { cellX: 1, cellY: 1, cellWidth: 2, cellHeight: 1 }, new Uint8Array([1]));
    let state = applyCompOps(blank(), place.entry);
    const primary = state.images![0];
    const [m] = symmetryAffineMaps(H, 1, 2, 1.5);
    const partner = symmetryPartnerCopy('image', primary, m);
    state = applyCompOps(state, [
      { op: 'placeObject', kind: 'image', item: partner },
    ] as SessionEntry['entry']);
    const wrapped = withSymmetryReflection(
      state, buildRotateSelected(state, primary.id), H, 1)!;
    const after = applyCompOps(state, wrapped.entry);
    expect(after.images).toHaveLength(2);
    expect(after.images!.some((i) => i.id === partner.id)).toBe(false);
    // 2×1 at (2, 1.5) turns to 1×2 in place; the partner is that turn
    // mirrored to (6, 1.5): the same quarter turn, flipped.
    const fresh = after.images!.find((i) => i.id !== primary.id)!;
    const pose = poseOf(after, fresh.id);
    expect(pose.box).toEqual([2, 1]);
    expect(pose.at[0]).toBeCloseTo(6);
    expect(pose.at[1]).toBeCloseTo(1.5);
    expect(pose.turn).toBe(90);
    expect(pose.flip).toBe(true);
  });

  test('a duplicate arrives with its own partner; the original pair stands', () => {
    const { state, primary, partner } = mirroredPair();
    const se = buildDuplicateSelected(state, primary.id)!;
    const wrapped = withSymmetryReflection(state, se, H, 1)!;
    expect(wrapped.id).toBe(se.id); // the copy keeps the selection
    const after = applyCompOps(state, wrapped.entry);
    expect(after.svgObjects).toHaveLength(4);
    expect(after.svgObjects.some((o) => o.id === partner.id)).toBe(true);
    const copy = after.svgObjects.find((o) => o.id === se.id)!;
    const copyCx = copy.cellX + copy.cellWidth / 2;
    const copyCy = copy.cellY + copy.cellHeight / 2;
    expect(after.svgObjects.some((o) =>
      Math.abs(o.cellX + o.cellWidth / 2 - (8 - copyCx)) < 1e-6
      && Math.abs(o.cellY + o.cellHeight / 2 - copyCy) < 1e-6)).toBe(true);
  });

  test('a pattern partner BAKES the flip into its grid, in the kind’s own id family', () => {
    const pat = {
      id: 'pat_reflect1', cellX: 1, cellY: 1, cellWidth: 1, cellHeight: 1,
      cols: 1, rows: 1,
      cells: [{
        type: 'sprite', spriteId: 'test/tile_10100000', // N+E
        transform: { rotation: 0, mirrorH: false, mirrorV: false },
      }],
    } as unknown as PatternObject;
    // Its standing partner, on the H image of that footprint (axis x = 4) —
    // an edit refreshes the orbit an object HAS, so the pair has to exist.
    const partner = { ...pat, id: 'pat_reflect2', cellX: 6 };
    const state = applyCompOps(blank(), [
      { op: 'placeObject', kind: 'pattern', item: pat },
      { op: 'placeObject', kind: 'pattern', item: partner },
    ] as SessionEntry['entry']);
    const wrapped = withSymmetryReflection(
      state, buildMoveNode(state, pat.id, 1, 0), H, 1)!;
    const after = applyCompOps(state, wrapped.entry);
    expect(after.patternObjects).toHaveLength(2);
    const fresh = after.patternObjects!.find((p) => p.id !== pat.id)!;
    expect(fresh.id.startsWith('pat_')).toBe(true);
    // The flip lands in the cells (bakePatternPose via the pattern
    // adapter), never in an object-level flag — so the partner's grid
    // stays world-readable for the Tile tool like any other pattern.
    expect(fresh.mirrorH).toBeUndefined();
    expect(fresh.cells[0]).toMatchObject({
      spriteId: 'test/tile_10100000', transform: { mirrorH: true },
    });
    expect(fresh.cellX + fresh.cellWidth / 2).toBeCloseTo(5.5);
    expect(fresh.cellY + fresh.cellHeight / 2).toBeCloseTo(1.5);
  });

  test('a free rotation negates across a flip and rides through a half turn', () => {
    // The whole HV orbit standing — an edit refreshes the partners an object
    // has — each turned the same 30° as the primary.
    const se0 = withSymmetryCopies(buildPlacePolyline([[1, 1], [2, 3]], INK), HV, 1)!;
    const placed = applyCompOps(blank(), se0.entry);
    const state = {
      ...placed,
      svgObjects: placed.svgObjects.map((o) => ({ ...o, angleDeg: 30 })),
    };
    const primaryId = placed.svgObjects[0].id;
    const wrapped = withSymmetryReflection(
      state, buildMoveNode(state, primaryId, 0.5, 0), HV, 1)!;
    const after = applyCompOps(state, wrapped.entry);
    // H+V: reflect-x, reflect-y, and their composition (a half turn).
    expect(after.svgObjects).toHaveLength(4);
    const angles = after.svgObjects
      .filter((o) => o.id !== primaryId)
      .map((o) => o.angleDeg).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(angles).toEqual([30, 330, 330]);
  });

  test('hidden leaves are invisible to the reflection (a rig’s pose record must not grow copies)', () => {
    const hiddenText = {
      id: 'txt_hidden1', content: 'pose', style: { fontId: 'system', size: 1, color: INK },
      cellX: 1, cellY: 1, cellWidth: 2, cellHeight: 1, hidden: true,
    } as unknown as TextObject;
    const state = applyCompOps(blank(), [
      { op: 'placeObject', kind: 'text', item: hiddenText },
    ] as SessionEntry['entry']);
    const se = buildMoveNode(state, hiddenText.id, 1, 0)!;
    expect(withSymmetryReflection(state, se, H, 1)).toBe(se);
  });

  test('no symmetry, no change', () => {
    const { state, primary } = mirroredPair();
    const se = buildMoveNode(state, primary.id, 1, 0)!;
    expect(withSymmetryReflection(state, se, undefined, 1)).toBe(se);
  });
});

describe('symmetryDragPeers — the partners a live drag moves along', () => {
  test('a mirrored pair: the partner follows through the H map', () => {
    const { state, primary, partner } = mirroredPair();
    const peers = symmetryDragPeers(state, [primary.id], H, 1);
    expect(peers).toHaveLength(1);
    expect(peers[0].id).toBe(partner.id);
    // A screen-horizontal mirror: dx negates, dy passes through — exactly
    // the translation the release commits for the replaced partner.
    expect(peers[0]).toMatchObject({ a: -1, b: 0, c: 0, d: 1 });
  });

  test('an HV orbit: three peers, one per non-identity map', () => {
    const se = withSymmetryCopies(buildPlacePolyline([[1, 1], [2, 3]], INK), HV, 1)!;
    const state = applyCompOps(blank(), se.entry);
    const primary = state.svgObjects[0];
    const peers = symmetryDragPeers(state, [primary.id], HV, 1);
    expect(peers).toHaveLength(3);
    const mats = peers.map((p) => [p.a, p.b, p.c, p.d].join(','));
    expect(new Set(mats)).toEqual(new Set(['-1,0,0,1', '1,0,0,-1', '-1,0,0,-1']));
  });

  test('a dragged pair claims its own halves — no peer doubles the fingers', () => {
    const { state, primary, partner } = mirroredPair();
    expect(symmetryDragPeers(state, [primary.id, partner.id], H, 1)).toEqual([]);
  });

  test('a locked partner stays put, exactly as the commit leaves it', () => {
    const { state, primary, partner } = mirroredPair();
    const locked = {
      ...state,
      svgObjects: state.svgObjects.map((o) =>
        o.id === partner.id ? { ...o, locked: true } : o),
    };
    expect(symmetryDragPeers(locked, [primary.id], H, 1)).toEqual([]);
  });

  test('no spec, or a loose object with no partner in the slot → nothing follows', () => {
    const { state, primary } = mirroredPair();
    expect(symmetryDragPeers(state, [primary.id], undefined, 1)).toEqual([]);
    const lone = applyCompOps(blank(), buildPlacePolyline([[1, 1], [2, 3]], INK)!.entry);
    expect(symmetryDragPeers(lone, [lone.svgObjects[0].id], H, 1)).toEqual([]);
  });
});

describe('decomposeSymmetryLinear', () => {
  /** The linear part of "flip, then k clockwise quarter turns": R^k · F^f. */
  function linearOf(flip: boolean, k: number): [number, number, number, number] {
    let a = flip ? -1 : 1; let b = 0; let c = 0; let d = 1;
    for (let i = 0; i < k; i++) {
      const [na, nb, nc, nd] = [-c, -d, a, b]; // R · M, R = [[0,-1],[1,0]]
      a = na; b = nb; c = nc; d = nd;
    }
    return [a + 0, b + 0, c + 0, d + 0]; // + 0 folds the -0 the negations mint
  }

  test('recomposes every orbit map the ten modes produce', () => {
    const specs: CanvasSymmetrySpec[] = [
      H, HV,
      { flags: { ...PATTERN_SYMMETRY_OFF, mirrorStar: true }, frame: FRAME },
      { flags: { ...PATTERN_SYMMETRY_OFF, mirrorDiagBoth: true }, frame: FRAME },
      { flags: { ...PATTERN_SYMMETRY_OFF, mirrorRotate: true }, frame: FRAME },
      { flags: { ...PATTERN_SYMMETRY_OFF, mirrorQuad: true }, frame: FRAME },
    ];
    let checked = 0;
    for (const spec of specs) {
      for (const m of symmetryAffineMaps(spec, 1, 1.5, 2.5)) {
        const { flip, quarterTurns } = decomposeSymmetryLinear(m);
        expect(linearOf(flip, quarterTurns)).toEqual([m.a, m.b, m.c, m.d]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(20); // star alone contributes 7
  });
});

describe('a pattern-scoped mirror (spec.only) leaves the canvas alone', () => {
  // With a pattern selected the mirror is that pattern's: a drawn shape
  // gets no copies, a moved object drags no partner and reflects no edit.
  const ONLY: CanvasSymmetrySpec = { ...H, only: 'pat_1' };

  test('withSymmetryCopies adds nothing', () => {
    const se = buildPlacePolyline([[1, 1], [2, 3]], INK)!;
    expect(withSymmetryCopies(se, ONLY, 1)).toBe(se);
    expect(withSymmetryCopies(se, H, 1)!.entry.length).toBeGreaterThan(se.entry.length);
  });

  test('withSymmetryReflection passes the edit through untouched', () => {
    const { state, primary } = mirroredPair();
    const move = buildMoveNode(state, primary.id, 0.5, 0.25);
    expect(withSymmetryReflection(state, move, ONLY, 1)).toBe(move);
  });

  test('symmetryDragPeers moves no partner along', () => {
    const { state, primary } = mirroredPair();
    expect(symmetryDragPeers(state, [primary.id], ONLY, 1)).toEqual([]);
    expect(symmetryDragPeers(state, [primary.id], H, 1)).toHaveLength(1);
  });
});
