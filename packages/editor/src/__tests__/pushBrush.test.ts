/**
 * The PUSH brush's multi-type deformation: what a stroke does to vector
 * paths, to raster paint islands, to a HOST's own kinds of node and to
 * everything it is told to leave alone — and how all of it commits as one
 * undo step.
 *
 * What each app's own kind of thing does with a dab is pinned in that app's
 * tree (CozyJournal's rig needs a whole Poise page), as is the toolbar
 * wiring that offers the brush.
 */

import { applyCompOps, revertCompOps } from '@/engine/compositionOps';
import {
  commitCanvasPaint, createCanvasPaintWorking, islandHeightCells, smudgeCanvasPaint,
  stampCanvasPaint,
} from '@/engine/canvasPaint';
import { createPaintObjectFromTiles } from '@/engine/paintObject';
import {
  CanvasPaintIsland, CompositionState, PaintObject, RGBColor, SVGObject,
} from '@/engine/types';
import { makeBlankComposition } from '@/editor/blankComposition';
import {
  createPaintObjectStrokeState, createPaintStrokeDraft, smudgePaintObjectBrush,
} from '../paintBrush';
import {
  buildPushStroke, createPushStrokeState, pushDab, pushStrokeChanged, pushWeight,
} from '../pushBrush';
import {
  type HostPushTargets, clearSessionHost, installSessionHost,
} from '../sessionHost';

const RED: RGBColor = { r: 255, g: 0, b: 0 };
const DRAFT = createPaintStrokeDraft(RED, 'normal', 1);

/** A straight horizontal line from (0,10) to (20,10), as a scene object. */
function line(id = 'svg_1', extra: Partial<SVGObject> = {}): SVGObject {
  return {
    id,
    segments: [
      { kind: 'line', start: [0, 10], end: [10, 10] },
      { kind: 'line', start: [10, 10], end: [20, 10] },
    ],
    color: { r: 0, g: 0, b: 0 },
    cellX: 0, cellY: 10, cellWidth: 20, cellHeight: 0,
    ...extra,
  };
}

function pageWith(svgs: SVGObject[], paints: PaintObject[] = []): CompositionState {
  const base = makeBlankComposition('comp_1');
  return {
    ...base,
    svgObjects: svgs,
    paintObjects: paints,
    sceneOrder: [...svgs.map((s) => s.id), ...paints.map((p) => p.id)],
  };
}

/** A committed paint island holding one red blob at world (8, 8). */
function blobIsland(id = 'pnt_1'): PaintObject {
  const working = createCanvasPaintWorking(undefined);
  stampCanvasPaint(working, 8, 8, 1, RED, 1);
  return createPaintObjectFromTiles(id, commitCanvasPaint(working))!;
}

function alphaAt(islands: readonly CanvasPaintIsland[] | undefined, x: number, y: number): number {
  const isl = (islands ?? []).find((i) =>
    x >= i.x && x < i.x + i.widthCells && y >= i.y && y < i.y + islandHeightCells(i));
  if (!isl) return 0;
  const texW = isl.widthCells / isl.overlay.cols;
  const c = Math.floor((x - isl.x) / texW);
  const r = Math.floor((y - isl.y) / texW);
  return isl.overlay.rgba[(r * isl.overlay.cols + c) * 4 + 3];
}

describe('the falloff', () => {
  it('is the same bell every other brush in the group deposits through', () => {
    expect(pushWeight(0, 4, 1)).toBe(1);
    expect(pushWeight(4, 4, 1)).toBe(0);   // nothing at the rim
    expect(pushWeight(9, 4, 1)).toBe(0);   // nor past it
    expect(pushWeight(2, 4, 1)).toBeGreaterThan(0);
    expect(pushWeight(2, 4, 1)).toBeLessThan(1);
    // Strength scales it, so half strength moves half as far everywhere.
    expect(pushWeight(2, 4, 0.5)).toBeCloseTo(pushWeight(2, 4, 1) / 2, 12);
  });
});

describe('a path under the brush', () => {
  it('bends: the point under the centre moves, the far end does not', () => {
    // What separates a deformer from a drag. The brush is aimed at the
    // middle joint of the line, tight enough to leave both ends alone.
    const ps = createPushStrokeState(pageWith([line()]), null, new Set());
    expect(pushDab(ps, 10, 10, 4, 0, 3, 1).svgs).toBe(true);
    const [a, b] = ps.svgs[0].segments;
    expect(a.end[1]).toBeCloseTo(13, 6);       // the middle went the full way
    expect(a.start[1]).toBeCloseTo(10, 6);     // the far ends stayed
    expect(b.end[1]).toBeCloseTo(10, 6);
  });

  it('keeps the join joined — the two segments still share their point', () => {
    // The warp is a function of position, so a point handed to both
    // segments comes back the same. A pushed path never comes apart.
    const ps = createPushStrokeState(pageWith([line()]), null, new Set());
    pushDab(ps, 9, 10, 6, 1.5, 2, 1);
    const [a, b] = ps.svgs[0].segments;
    expect(a.end).toEqual(b.start);
  });

  it('accumulates over a stroke, and re-centres its own reach', () => {
    // A shape pushed clear of where its box was must keep taking the brush,
    // so the cull follows the geometry rather than the committed bbox.
    const ps = createPushStrokeState(pageWith([line()]), null, new Set());
    for (let i = 0; i < 6; i++) pushDab(ps, 10, 10 + i, 5, 0, 1, 1);
    expect(ps.svgs[0].segments[0].end[1]).toBeGreaterThan(13);
  });

  it('is inert where the disc reaches nothing', () => {
    const ps = createPushStrokeState(pageWith([line()]), null, new Set());
    expect(pushDab(ps, 400, 400, 4, 0, 3, 1).svgs).toBe(false);
    expect(pushStrokeChanged(ps)).toBe(false);
    // …and with no travel, or no strength, whatever it covers.
    expect(pushDab(ps, 10, 10, 4, 0, 0, 1).svgs).toBe(false);
    expect(pushDab(ps, 10, 10, 4, 0, 3, 0).svgs).toBe(false);
  });
});

describe('what the brush leaves alone', () => {
  it('locked, hidden, grouped and tiled objects, and a frame boundary', () => {
    const state = pageWith([
      line('svg_locked', { locked: true }),
      line('svg_hidden', { hidden: true }),
      line('svg_grouped', { groupId: 'g1' }),
      line('svg_tiled', { tileMode: 'repeat' }),
      line('svg_frame'),
      line('svg_ok'),
    ]);
    const ps = createPushStrokeState(state, null, new Set(['svg_frame']));
    expect(ps.svgs.map((s) => s.id)).toEqual(['svg_ok']);
  });

  it('everything but the selection, when there is one', () => {
    // A selection is the brush's filter here exactly as it is for paint,
    // erase and blur: you select an object so the brush may touch only it.
    const state = pageWith([line('svg_a'), line('svg_b')]);
    const ps = createPushStrokeState(state, new Set(['svg_b']), new Set());
    expect(ps.svgs.map((s) => s.id)).toEqual(['svg_b']);
  });
});

describe('raster paint under the brush', () => {
  it('smears the island, and re-frames it around where the paint went', () => {
    // The island's frame is fitted to its ink, so paint pushed past that
    // edge would be drawn outside the canvas it renders through. The commit
    // re-frames it — which is what `grow` marks the state for.
    const island = blobIsland();
    const state = pageWith([], [island]);
    const ps = createPaintObjectStrokeState(state, 'push', null, null)!;
    expect(ps.grow).toBe(true);
    const right = island.cellX + island.cellWidth;
    for (let i = 0; i < 10; i++) smudgePaintObjectBrush(ps, 8 + i * 0.125, 8, 1, 0.125, 0, 1);
    const se = buildPushStroke(state, createPushStrokeState(state, null, new Set()), DRAFT, ps)!;
    const after = applyCompOps(state, se.entry);
    const moved = after.paintObjects![0];
    expect(moved.cellX + moved.cellWidth).toBeGreaterThan(right);
    expect(moved.contentW).toBeGreaterThan(island.contentW);
    // The paint really travelled — it is not just a bigger frame.
    expect(alphaAt(moved.tiles, 9.4, 8)).toBeGreaterThan(0);
  });

  it('keeps smearing however far the drag carries the paint — the cull follows', () => {
    // The island's cull was framed to its committed bbox at stroke start; a
    // drag that walks the paint several bbox-widths away used to sail past
    // it and the smear froze mid-air, one brush-width out — the "invisible
    // wall". The cull now extends to each dab that changes the island, the
    // same re-centering the brush's svg targets do.
    const island = blobIsland();
    const state = pageWith([], [island]);
    const ps = createPaintObjectStrokeState(state, 'push', null, null)!;
    // A long continuous drag: from the blob at (8, 8) out to x ≈ 17.5 —
    // far beyond bbox half-diagonal + brush radius from the island centre.
    for (let i = 0; i < 40; i++) smudgePaintObjectBrush(ps, 7.5 + i * 0.25, 8, 1.5, 0.25, 0, 1);
    const se = buildPushStroke(state, createPushStrokeState(state, null, new Set()), DRAFT, ps)!;
    const moved = applyCompOps(state, se.entry).paintObjects![0];
    // Paint travelled with the finger well past the original frame.
    expect(alphaAt(moved.tiles, 14, 8)).toBeGreaterThan(0);
    expect(moved.contentX + moved.contentW).toBeGreaterThan(14);
  });

  it('takes every visible island, and only the selected ones when filtered', () => {
    const state = pageWith([], [blobIsland('pnt_a'), blobIsland('pnt_b')]);
    expect(createPaintObjectStrokeState(state, 'push', null, null)!.targets).toHaveLength(2);
    const one = createPaintObjectStrokeState(state, 'push', null, new Set(['pnt_b']))!;
    expect(one.targets.map((t) => t.island.id)).toEqual(['pnt_b']);
  });

  it('leaves a locked island alone', () => {
    const island = { ...blobIsland(), locked: true };
    expect(createPaintObjectStrokeState(pageWith([], [island]), 'push', null, null)).toBeNull();
  });

  it('gives the raster smear a stronger hand than the shared knob alone', () => {
    // The strength knob is shared by everything the brush moves, but the
    // island half's texels drift by travel × strength × falloff and read
    // far weaker than the geometry halves at the same setting — so the
    // brush boosts it (RASTER_PUSH_BOOST, clamped to 1). At the default
    // 0.5 the smear runs at the engine's full strength.
    const island = blobIsland();
    const viaBrush = createPaintObjectStrokeState(pageWith([], [island]), 'push', null, null)!;
    smudgePaintObjectBrush(viaBrush, 8, 8, 1.5, 0.5, 0, 0.5);
    const direct = createCanvasPaintWorking(island.tiles);
    smudgeCanvasPaint(direct, 8, 8, 1.5, 1, 0.5, 0);
    const brushTiles = commitCanvasPaint([...viaBrush.targets[0].working!.touched.values()].length
      ? viaBrush.targets[0].working!
      : createCanvasPaintWorking(island.tiles));
    const directTiles = commitCanvasPaint(direct);
    expect(brushTiles).toEqual(directTiles);
  });

  it('two strokes compose — the second never rewinds the first', () => {
    // The report behind this pin: push once, push again, and the first
    // smear vanished. The state-level pipeline composes correctly (this
    // test); what actually dropped the first stroke was the FINALIZE gate
    // in CanvasSurface, pinned below.
    const state0 = pageWith([], [blobIsland()]);
    const ps1 = createPaintObjectStrokeState(state0, 'push', null, null)!;
    for (let i = 0; i < 12; i++) smudgePaintObjectBrush(ps1, 7.5 + i * 0.25, 8, 1.5, 0.25, 0, 1);
    const se1 = buildPushStroke(state0, createPushStrokeState(state0, null, new Set()), DRAFT, ps1)!;
    const state1 = applyCompOps(state0, se1.entry);
    const smearAfter1 = alphaAt(state1.paintObjects![0].tiles, 10.2, 8);
    expect(smearAfter1).toBeGreaterThan(0);

    const ps2 = createPaintObjectStrokeState(state1, 'push', null, null)!;
    for (let i = 0; i < 8; i++) smudgePaintObjectBrush(ps2, 7.5 + i * 0.25, 9.2, 1.2, 0.25, 0, 1);
    const se2 = buildPushStroke(state1, createPushStrokeState(state1, null, new Set()), DRAFT, ps2)!;
    const state2 = applyCompOps(state1, se2.entry);
    expect(alphaAt(state2.paintObjects![0].tiles, 10.2, 8)).toBe(smearAfter1);
  });
});

describe('the commit', () => {
  it('is ONE entry however many kinds of thing the stroke moved', () => {
    // One drag is one action: a stroke that bent a path and smeared an
    // island undoes in a single step, not two.
    const island = blobIsland();
    const state = pageWith([line()], [island]);
    const ps = createPushStrokeState(state, null, new Set());
    const paint = createPaintObjectStrokeState(state, 'push', null, null)!;
    pushDab(ps, 10, 10, 4, 0, 3, 1);
    smudgePaintObjectBrush(paint, 8, 8, 1, 0.5, 0, 1);
    const se = buildPushStroke(state, ps, DRAFT, paint)!;
    const after = applyCompOps(state, se.entry);
    expect(after.svgObjects[0].segments[0].end[1]).toBeCloseTo(13, 6);
    expect(after.paintObjects![0].tiles).not.toBe(island.tiles);
    // Undoing that one entry puts both halves back.
    const back = revertCompOps(after, se.entry);
    expect(back.svgObjects[0].segments).toEqual(state.svgObjects[0].segments);
    expect(back.paintObjects![0].tiles).toBe(island.tiles);
  });

  it('refits a warped object\'s box, and drops its stale identity geometry', () => {
    // The bbox is the AABB of the geometry by invariant, and the cached
    // pre-rotation segments describe a shape that no longer exists.
    const state = pageWith([line('svg_1', { identitySegments: line().segments })]);
    const ps = createPushStrokeState(state, null, new Set());
    pushDab(ps, 10, 10, 4, 0, 3, 1);
    const after = applyCompOps(state, buildPushStroke(state, ps, DRAFT, null)!.entry);
    const svg = after.svgObjects[0];
    expect(svg.cellHeight).toBeCloseTo(3, 6);
    expect(svg.cellY).toBeCloseTo(10, 6);
    expect(svg.identitySegments).toBeUndefined();
  });

  it('is null when the stroke moved nothing', () => {
    const state = pageWith([line()]);
    const ps = createPushStrokeState(state, null, new Set());
    expect(buildPushStroke(state, ps, DRAFT, null)).toBeNull();
  });
});

describe('a HOST’s own kind of node under the brush', () => {
  // A made-up app whose own node is a DIAL: an svg object whose path is a
  // BAKE of a needle angle, so pushing it means turning the needle and
  // re-baking, never warping the path. (CozyJournal's rig is the real
  // case: its subpaths are a bake of a pose, and a dab re-poses the
  // joints.) What the dabs reach lives in the pass, as it does there.
  const DIAL = 'svg_dial';
  let turned = 0;
  let shown = 0;
  let restored = 0;

  function dialPass(reachable: boolean): HostPushTargets {
    let moved = false;
    return {
      ids: new Set([DIAL]),
      push: (cellX, cellY, radiusCells, dxCells, dyCells, strength) => {
        if (!reachable) return false;
        const w = pushWeight(Math.hypot(cellX - 10, cellY - 10), radiusCells, strength);
        if (!(w > 0)) return false;
        turned += (dxCells + dyCells) * w;
        moved = true;
        return true;
      },
      preview: () => { shown += 1; },
      restore: () => { restored += 1; },
      changed: () => moved,
      commit: () => (moved
        ? [{ op: 'renameSVG', svgId: DIAL, oldName: 'dial', newName: `dial:${turned}` }]
        : []),
    };
  }

  beforeEach(() => {
    turned = 0;
    shown = 0;
    restored = 0;
  });
  afterEach(() => clearSessionHost());

  it('is pushed through its own pass, and the vector pass leaves its path alone', () => {
    installSessionHost({ nodes: { pushTargets: () => dialPass(true) } });
    const state = pageWith([line(DIAL), line('svg_ok')]);
    const ps = createPushStrokeState(state, null, new Set());
    // Its path is NOT a warp target: the bake and the thing it was baked
    // from would end up describing different shapes.
    expect(ps.svgs.map((t) => t.id)).toEqual(['svg_ok']);
    expect(ps.host).not.toBeNull();
    const moved = pushDab(ps, 10, 10, 4, 0, 3, 1);
    expect(moved).toEqual({ host: true, svgs: true });
    expect(turned).toBeGreaterThan(0);
  });

  it('counts toward the finalize gate and commits before the warped paths', () => {
    // `replaceScene` snapshots every collection, so each part has to be
    // built against the state the parts before it leave behind — and the
    // host's ops are a swap of their own.
    installSessionHost({ nodes: { pushTargets: () => dialPass(true) } });
    const state = pageWith([line(DIAL), line('svg_ok')]);
    const ps = createPushStrokeState(state, null, new Set());
    expect(pushStrokeChanged(ps)).toBe(false);
    pushDab(ps, 10, 10, 4, 0, 3, 1);
    expect(pushStrokeChanged(ps)).toBe(true);
    const se = buildPushStroke(state, ps, DRAFT, null)!;
    expect(se.entry[0]).toMatchObject({ op: 'renameSVG', svgId: DIAL });
    expect(se.entry[1]).toMatchObject({ op: 'replaceScene' });
  });

  it('a stroke that reaches only the host still commits — and only its ops', () => {
    installSessionHost({ nodes: { pushTargets: () => dialPass(true) } });
    const state = pageWith([line(DIAL)]);
    const ps = createPushStrokeState(state, null, new Set());
    pushDab(ps, 10, 10, 4, 0, 3, 1);
    expect(pushStrokeChanged(ps)).toBe(true);
    const se = buildPushStroke(state, ps, DRAFT, null)!;
    expect(se.entry).toHaveLength(1);
  });

  it('a pass that reaches nothing leaves the gate shut and the entry null', () => {
    installSessionHost({ nodes: { pushTargets: () => dialPass(false) } });
    const state = pageWith([line(DIAL)]);
    const ps = createPushStrokeState(state, null, new Set());
    expect(pushDab(ps, 10, 10, 4, 0, 3, 1)).toEqual({ host: false, svgs: false });
    expect(pushStrokeChanged(ps)).toBe(false);
    expect(buildPushStroke(state, ps, DRAFT, null)).toBeNull();
    // The live channel is the canvas's to call, not this module's: nothing
    // here previews or restores behind the gesture's back.
    expect([shown, restored]).toEqual([0, 0]);
  });

  it('with no host at all, every svg is a warp target and the state carries no pass', () => {
    const state = pageWith([line(DIAL), line('svg_ok')]);
    const ps = createPushStrokeState(state, null, new Set());
    expect(ps.host).toBeNull();
    expect(ps.svgs.map((t) => t.id)).toEqual([DIAL, 'svg_ok']);
  });
});
