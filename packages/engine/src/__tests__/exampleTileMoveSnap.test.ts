/**
 * User repro fixture: a grid-aligned mixed (arc + 2 lines) group on
 * L2 (step=4). Per the user, dragging this group fails to snap to the
 * grid -- the (1, -3) translate persists across drags. Arc-only groups
 * don't show this.
 *
 * The test rebuilds the canvas's drag-start state programmatically,
 * then mirrors the canvas pointer-down/move logic exactly:
 *   - snap anchor = (groupBounds.minX, groupBounds.maxY)
 *   - snap delta from `computeMoveSnapDelta`
 *   - dispatch via the same bucketed MOVE_FIGURES_DELTA the live
 *     reducer uses (group translate update + materialize)
 * After a drag past the threshold, the group's world bbox must land
 * on multiples of the active grid step.
 */

import {
  bucketMovedIds,
  computeSVGBbox,
  groupBounds,
  materializeGroupHierarchy,
  materializeGroupMembers,
} from '../compositionOps';
import { computeMoveSnapDelta } from '../compositionCellMath';
import { findStrokeAtCell, findFigureAtCell, groupMemberIds, getItemGroupId } from '../compositionOps';
import { lineBoundingBox } from '../compositionLineHitTest';
import {
  PathSegment,
  CELL_COUNTS,
  CompositionState,
  GridLevel,
  SVGObject,
  makeViewport,
} from '../types';

/**
 * Build a state matching the original Example.tile fixture:
 * - L2 grid (step = 4)
 * - 3 svgObjects in a single group with translate (1, -3):
 *   1. H-line from (0,5) to (8,5)  (local coords)
 *   2. V-line from (8,-3) to (8,5) (local coords)
 *   3. Arc from (0,0) to (0,-3) with center (0,0) — quarter-circle
 * After group translate (1, -3), world coords shift, putting group
 * bbox off the L2 grid.
 */
function buildExampleComposition(): CompositionState {
  const groupId = 'grp_example';
  // Local-coord SVG objects (pre-group-transform)
  const hLine: SVGObject = {
    id: 'svg_hline',
    segments: [{ kind: 'line', start: [0, 5], end: [8, 5] }],
    color: { r: 255, g: 255, b: 255 },
    groupId,
    ...computeSVGBbox([{ kind: 'line', start: [0, 5], end: [8, 5] }]),
  };
  const vLine: SVGObject = {
    id: 'svg_vline',
    segments: [{ kind: 'line', start: [8, -3], end: [8, 5] }],
    color: { r: 255, g: 255, b: 255 },
    groupId,
    ...computeSVGBbox([{ kind: 'line', start: [8, -3], end: [8, 5] }]),
  };
  const arc: SVGObject = {
    id: 'svg_arc',
    segments: [{ kind: 'arc', start: [0, 0], end: [3, -3], center: [0, -3] }],
    color: { r: 255, g: 255, b: 255 },
    groupId,
    ...computeSVGBbox([{ kind: 'arc', start: [0, 0], end: [3, -3], center: [0, -3] }]),
  };

  let state: CompositionState = {
    id: 'example', name: 'Example',
    figures: [],
    svgObjects: [hLine, vLine, arc],
    images: [],
    imageBlobs: {},
    lineDraft: null, arcDraft: null,
    editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
    customColors: [],
    groups: [{
      id: groupId,
      name: 'Group',
      translateX: 1,
      translateY: -3,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      mirrorH: false,
      mirrorV: false,
    }],
    sceneOrder: [hLine.id, vLine.id, arc.id],
    gridLevel: 2,
    strokeScale: 8,
    gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(),
    activeFigureKey: null,
    compTool: 'select',
    createRegion: null,
    renderGeneration: 0,
  };
  // Seed local segments from current world segments
  state = materializeGroupHierarchy(state);
  // Apply group transforms to produce world coordinates
  state = materializeGroupMembers(state, groupId);
  return state;
}

/** Mirror MOVE_FIGURES_DELTA's bucketed reducer: route grouped ids
 *  through their group's translate update + materialize. */
function applyMoveDelta(state: CompositionState, ids: string[], dx: number, dy: number): CompositionState {
  const { groupIds, ungrouped } = bucketMovedIds(state, ids);
  const ungroupedSet = new Set(ungrouped);
  const groups = state.groups.map(g => groupIds.has(g.id)
    ? { ...g, translateX: g.translateX + dx, translateY: g.translateY + dy }
    : g);
  let next: CompositionState = {
    ...state,
    groups,
    figures: state.figures.map(f => ungroupedSet.has(f.id)
      ? { ...f, cellX: f.cellX + dx, cellY: f.cellY + dy }
      : f),
    svgObjects: state.svgObjects.map(s => {
      if (!ungroupedSet.has(s.id)) return s;
      const newSegs: PathSegment[] = s.segments.map(seg => seg.kind === 'arc'
        ? { kind: 'arc', start: [seg.start[0] + dx, seg.start[1] + dy], end: [seg.end[0] + dx, seg.end[1] + dy], center: [seg.center[0] + dx, seg.center[1] + dy] }
        : { kind: 'line', start: [seg.start[0] + dx, seg.start[1] + dy], end: [seg.end[0] + dx, seg.end[1] + dy] });
      return { ...s, segments: newSegs, ...computeSVGBbox(newSegs) };
    }),
  };
  for (const gid of groupIds) next = materializeGroupMembers(next, gid);
  return next;
}

describe('Example fixture: dragging the mixed arc+line group snaps to grid', () => {
  test('fixture loads as a single mixed (arc + 2 lines) group on L2', () => {
    const state = buildExampleComposition();
    expect(state.gridLevel).toBe(2);
    expect(state.figures).toHaveLength(0);
    expect(state.svgObjects).toHaveLength(3);
    expect(state.groups).toHaveLength(1);
    const groupId = state.groups[0].id;
    expect(state.svgObjects.every(s => s.groupId === groupId)).toBe(true);
  });

  test('first drag of the group snaps the world bbox to the L2 grid', () => {
    let state = buildExampleComposition();
    const groupId = state.groups[0].id;
    const memberIds: string[] = [
      ...state.svgObjects.filter(s => s.groupId === groupId).map(s => s.id),
    ];
    const step = 32 / CELL_COUNTS[state.gridLevel as GridLevel]; // L2 -> 4

    // Pre-drag: the group sits off-grid (translate (1, -3)).
    const pre = groupBounds(state.figures, groupId, state.svgObjects, state.svgObjects, state.images);
    expect(pre.minX % step !== 0 || pre.maxY % step !== 0).toBe(true);

    // Mirror canvas's pointer-down -> move sequence: snap anchor =
    // (groupBounds.minX, groupBounds.maxY); snap delta is from
    // computeMoveSnapDelta. Use a small drag past the no-op zone.
    const rawDx = 1;
    const rawDy = 1;
    // Cursor starts at the group's bbox center and moves with the drag.
    const cursorStart = { x: (pre.minX + pre.maxX) / 2, y: (pre.minY + pre.maxY) / 2 };
    const { dx, dy } = computeMoveSnapDelta(
      pre, cursorStart.x + rawDx, cursorStart.y + rawDy, rawDx, rawDy, step, step, 1, 1,
    );
    state = applyMoveDelta(state, memberIds, dx, dy);

    const post = groupBounds(state.figures, groupId, state.svgObjects, state.svgObjects, state.images);
    expect(post.minX % step).toBe(0);
    expect(post.maxY % step).toBe(0);
  });

  /**
   * Faithful simulation of CompositionCanvas's pointer-down handler.
   * Mirrors the exact hit chain -- `findFigureAtCell` first, then
   * `findStrokeAtCell` only when the figure pass missed -- and the
   * snap-anchor branch (anchorFig / hitSVG).
   *
   * `bbox === null` means none of the canvas's snap-anchor branches
   * matched, which is the bug: `findFigureAtCell`'s Pass 2 returns an
   * svg id for taps that land inside a figure-less group's bbox but
   * not on a stroke. In that path `hitSVG` is never set (the canvas
   * only assigns it inside the `if (!hitId)` findStrokeAtCell branch),
   * so the down-handler's anchorFig / hitSVG chain falls through and
   * leaves `dragAnchorOrigRef` stale. The next move tick snaps
   * relative to `(0, 0)` (initial value) rather than the group's
   * actual bbox, producing a delta that can't realign the group to
   * the active grid.
   */
  function simulatePointerDown(
    state: CompositionState, tapCellX: number, tapCellY: number,
  ): {
    hitId: string | null;
    hitSVG: SVGObject | null;
    dragIds: string[];
    bbox: { minX: number; minY: number; maxX: number; maxY: number } | null;
    stepX: number;
    stepY: number;
  } {
    let hitId = findFigureAtCell(tapCellX, tapCellY, state);
    let hitSVG: SVGObject | null = null;
    if (!hitId) {
      const stroke = findStrokeAtCell(state, tapCellX, tapCellY);
      if (stroke) {
        hitId = stroke.id;
        hitSVG = state.svgObjects.find(s => s.id === stroke.id) ?? null;
      }
    }
    if (!hitId) throw new Error('no hit at ' + tapCellX + ',' + tapCellY);

    // Drag set: expand to all group members.
    const dragSet = new Set<string>();
    const gid = getItemGroupId(state, hitId);
    if (gid) for (const m of groupMemberIds(state, gid)) dragSet.add(m);
    else dragSet.add(hitId);
    const dragIds = [...dragSet];

    // Snap bbox -- derive from hitId directly, the same shape the
    // canvas now uses (CompositionCanvas.tsx pointer-down handler).
    let bbox: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
    if (gid) {
      const b = groupBounds(state.figures, gid, state.svgObjects, state.svgObjects, state.images);
      bbox = { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY };
    } else {
      const fig = state.figures.find(f => f.id === hitId);
      const svg = !fig ? state.svgObjects.find(s => s.id === hitId) : undefined;
      const img = !fig && !svg ? (state.images ?? []).find(i => i.id === hitId) : undefined;
      if (fig) {
        bbox = { minX: fig.cellX, minY: fig.cellY, maxX: fig.cellX + fig.cellWidth, maxY: fig.cellY + fig.cellHeight };
      } else if (svg) {
        const bb = lineBoundingBox(svg);
        if (bb) bbox = { minX: bb.minX, minY: bb.minY, maxX: bb.maxX, maxY: bb.maxY };
      } else if (img) {
        bbox = { minX: img.cellX, minY: img.cellY, maxX: img.cellX + img.cellWidth, maxY: img.cellY + img.cellHeight };
      }
    }

    // Per-axis snap step -- mirrors CompositionCanvas.tsx:777-790.
    const baseStep = 32 / CELL_COUNTS[state.gridLevel as GridLevel];
    let stepX = baseStep;
    let stepY = baseStep;
    if (dragIds.length === 1 && hitSVG) {
      let dir = hitSVG.lineDirection;
      if (!dir) {
        const bb = lineBoundingBox(hitSVG);
        if (bb) {
          if (bb.maxX - bb.minX > bb.maxY - bb.minY) dir = 'horizontal';
          else if (bb.maxY - bb.minY > bb.maxX - bb.minX) dir = 'vertical';
        }
      }
      if (dir === 'horizontal') stepY = baseStep / 2;
      else if (dir === 'vertical') stepX = baseStep / 2;
    }

    return { hitId, hitSVG, dragIds, bbox, stepX, stepY };
  }

  /** Tap inside the group bbox but not on a stroke. findFigureAtCell's
   *  Pass 2 returns an svg id, so findStrokeAtCell doesn't run and
   *  hitSVG remains null. The snap-anchor chain must still resolve via
   *  the group path so dragAnchorOrigRef gets set correctly. */
  test('tapping inside the group bbox (not on a stroke) sets a snap bbox', () => {
    const state = buildExampleComposition();
    // Pick a point inside the group's world bbox but not on any stroke.
    // After translate (1, -3), the H-line runs at world y=2, V-line at
    // world x=9, and the arc is near (1, -3)...(4, -6). Try (5, 0).
    const sim = simulatePointerDown(state, 5, 0);
    expect(sim.hitId).toBeTruthy();
    expect(sim.dragIds.length).toBe(3);
    // The snap bbox MUST be set so the next move tick has a
    // non-stale origin to snap against.
    expect(sim.bbox).not.toBeNull();
  });

  test('first drag with an in-bbox tap snaps the group to L2 grid', () => {
    let state = buildExampleComposition();
    const groupId = state.groups[0].id;
    const sim = simulatePointerDown(state, 5, 0);
    if (sim.bbox === null) {
      throw new Error('snap bbox must be set; the canvas needs the in-bbox tap to populate dragAnchorOrigRef');
    }
    const baseStep = 32 / CELL_COUNTS[state.gridLevel as GridLevel];
    // Down-right tick past the tap threshold. Directional snap picks
    // (maxX, maxY) as the leading edges, which both still need to
    // realign onto the L2 grid for this fractional fixture.
    const rawDx = 0.2, rawDy = 0.2;
    const cursorStart = { x: 5, y: 0 };
    const { dx, dy } = computeMoveSnapDelta(
      sim.bbox, cursorStart.x + rawDx, cursorStart.y + rawDy, rawDx, rawDy, sim.stepX, sim.stepY, 1, 1,
    );
    state = applyMoveDelta(state, sim.dragIds, dx, dy);
    const post = groupBounds(state.figures, groupId, state.svgObjects, state.svgObjects, state.images);
    expect(post.maxX % baseStep).toBe(0);
    expect(post.maxY % baseStep).toBe(0);
  });

  test('tapping the H-line stroke and dragging snaps the whole group to L2 grid', () => {
    let state = buildExampleComposition();
    const groupId = state.groups[0].id;
    // After translate (1, -3), the H-line at local y=5 becomes world y=2.
    // Its x range is local [0,8] -> world [1,9]. Tap at (5, 2).
    const sim = simulatePointerDown(state, 5, 2);
    expect(sim.hitId).toBeTruthy();
    expect(sim.dragIds.length).toBe(3);
    expect(sim.bbox).not.toBeNull();
    const baseStep = 32 / CELL_COUNTS[state.gridLevel as GridLevel];
    expect(sim.stepX).toBe(baseStep);
    expect(sim.stepY).toBe(baseStep);

    const rawDx = 0.2, rawDy = 0.2;
    const cursorStart = { x: 5, y: 2 };
    const { dx, dy } = computeMoveSnapDelta(
      sim.bbox!, cursorStart.x + rawDx, cursorStart.y + rawDy, rawDx, rawDy, sim.stepX, sim.stepY, 1, 1,
    );
    state = applyMoveDelta(state, sim.dragIds, dx, dy);
    const post = groupBounds(state.figures, groupId, state.svgObjects, state.svgObjects, state.images);
    expect(post.maxX % baseStep).toBe(0);
    expect(post.maxY % baseStep).toBe(0);
  });
});
