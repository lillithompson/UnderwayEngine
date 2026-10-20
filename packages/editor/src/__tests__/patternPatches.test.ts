import { applyCompOps, revertCompOps } from '@/engine/compositionOps';
import { computeSignedArea, isClosedPath } from '@/engine/compositionArcMath';
import { computeSVGBbox } from '@/engine/compositionOps';
import { CompositionState, PathSegment, PatternObject, SVGObject } from '@/engine/types';
import { svgIsFilled } from '@/engine/svgPathBuilder';
import { svgStrokeWidthCells } from '@/engine/svgStroke';
import { BASE_CELL_PX } from '../cameraMath';
import { makeBlankComposition } from '@/editor/blankComposition';
import { patternSVGView } from '@/engine/patternObjectRender';
import { COLORABLE_GROUP_NAME, buildPatternMakeColorable } from '../editorSession';
import { patternPatchName, patternPatchOutlines } from '../patternPatches';

// PATCHES OF A PATTERN (Make Colorable): the regions a pattern object's
// drawing cuts its bounding box into, as closed shapes of their own — the
// pattern's answer to Patchwork's patches, over the same arrangement
// (web/content/planarFaces.ts).
//
// The promise every test here is checking one face of: the patches TILE the
// bounding rectangle. They do not overlap, none is missing, none hangs over
// the edge, and their areas add up to the box exactly. That has to survive
// the three things a pattern hands the arrangement that Patchwork's two
// closed curves never did — strokes that trail off in mid-air, a drawing
// that never touches the box, and a grid that repeats.
//
// Tiles are the real sprite sources (engine assets/svg-sources.json, which
// tests read unmocked):
//   • 'angular/tile_10101010' is a PLUS — four arms from the middle to the
//     middle of each edge, so one cell of it cuts its box into quarters;
//   • 'curved/tile_00000000' is a bare CIRCLE in the middle of the cell,
//     touching nothing — the island case, where the region around it has to
//     come back with a hole in it rather than as the whole box again;
//   • 'angular/tile_10000000' is one arm from the top edge to a small
//     circle in the middle — a stroke with a LOOSE END, which bounds
//     nothing and must not leave a slit in the patch it hangs in.

const INK = { r: 10, g: 20, b: 30 };

function cell(spriteId: string) {
  return {
    type: 'sprite' as const,
    spriteId,
    transform: { rotation: 0 as const, mirrorH: false, mirrorV: false },
    tintR: INK.r, tintG: INK.g, tintB: INK.b,
  };
}

function pattern(
  spriteIds: (string | null)[],
  cols: number,
  rows: number,
  overrides: Partial<PatternObject> = {},
): PatternObject {
  return {
    id: 'pat_test',
    cellX: 4,
    cellY: 6,
    cellWidth: 2 * cols,
    cellHeight: 2 * rows,
    cols,
    rows,
    cells: spriteIds.map((id) => (id ? cell(id) : null)),
    ...overrides,
  };
}

const boxArea = (p: PatternObject) => p.cellWidth * p.cellHeight;
const area = (face: readonly PathSegment[]) => computeSignedArea(face);
const totalArea = (faces: PathSegment[][]) => faces.reduce((sum, f) => sum + area(f), 0);

/** The patches fill the box, to within the tolerance the curves were read
 *  at: welding two near-coincident ends into one moves a boundary by up to
 *  a weld, and the box is a thousand of those across (patternPatches'
 *  WELD_UNITS_PER_CELL). Anything that leaves a real gap or a real overlap
 *  is off by a region, not by a part in ten thousand. */
function expectFillsBox(faces: PathSegment[][], p: PatternObject) {
  expect(totalArea(faces) / boxArea(p)).toBeCloseTo(1, 3);
}

/** Every patch closed, wound the way the engine's own shapes are, and inside
 *  the box — the three things that are true of each one on its own. */
function expectWellFormed(faces: PathSegment[][], p: PatternObject) {
  expect(faces.length).toBeGreaterThan(0);
  for (const face of faces) {
    expect(isClosedPath(face)).toBe(true);
    expect(area(face)).toBeGreaterThan(0);
    const b = computeSVGBbox(face);
    expect(b.cellX).toBeGreaterThanOrEqual(p.cellX - 1e-6);
    expect(b.cellY).toBeGreaterThanOrEqual(p.cellY - 1e-6);
    expect(b.cellX + b.cellWidth).toBeLessThanOrEqual(p.cellX + p.cellWidth + 1e-6);
    expect(b.cellY + b.cellHeight).toBeLessThanOrEqual(p.cellY + p.cellHeight + 1e-6);
  }
}

describe('patternPatchOutlines', () => {
  it('cuts the box into the regions the tiles draw, and they add back up to it', () => {
    const p = pattern(['angular/tile_10101010'], 1, 1);
    const faces = patternPatchOutlines(p);
    // A plus in the middle of one cell: four quadrants, equal by symmetry.
    expect(faces).toHaveLength(4);
    expectWellFormed(faces, p);
    expectFillsBox(faces, p);
    // Quarters, to within where the art actually puts the plus's middle —
    // the source draws it a quarter of one of its own units off centre.
    for (const f of faces) expect(area(f) / (boxArea(p) / 4)).toBeCloseTo(1, 2);
  });

  it('an empty pattern is one patch: the bounding rectangle itself', () => {
    const p = pattern([null], 1, 1);
    const faces = patternPatchOutlines(p);
    expect(faces).toHaveLength(1);
    expect(area(faces[0])).toBeCloseTo(boxArea(p), 9);
    expect(computeSVGBbox(faces[0]))
      .toEqual({ cellX: 4, cellY: 6, cellWidth: 2, cellHeight: 2 });
  });

  it('an ISLAND leaves a hole in the patch around it, not a second copy of the box', () => {
    // A circle touching nothing: the regions are its inside and everything
    // else. "Everything else" is the box MINUS the circle — the two together
    // are the box once, not one and a bit.
    const p = pattern(['curved/tile_00000000'], 1, 1);
    const faces = patternPatchOutlines(p);
    expect(faces).toHaveLength(2);
    expectWellFormed(faces, p);
    expectFillsBox(faces, p);
    // The one holding the island is the box's own outline AND the circle's,
    // counter-wound — so it is SMALLER than the box by exactly the disc.
    const ring = faces.find((f) => area(f) > boxArea(p) / 2)!;
    const disc = faces.find((f) => f !== ring)!;
    expect(area(disc)).toBeGreaterThan(0);
    expect(area(ring)).toBeLessThan(boxArea(p) - area(disc) / 2);
  });

  it('a stroke run into the box edge and an island joins them, it does not cut', () => {
    // One arm from the top edge down INTO a small circle: it reaches the box
    // at one end and the island at the other, so it separates nothing — the
    // regions are still the circle's inside and everything else. The outer
    // one's boundary runs in along the arm and back out again, a slit of no
    // width: the right answer for a cut from a region's edge to a hole in it,
    // and it fills and strokes as the region does.
    const p = pattern(['angular/tile_10000000'], 1, 1);
    const faces = patternPatchOutlines(p);
    expect(faces).toHaveLength(2);
    expectWellFormed(faces, p);
    expectFillsBox(faces, p);
    // The part of the arm INSIDE the circle is a true hair — it ends in
    // mid-air — and is pruned: no segment of any patch reaches the middle.
    const middle: [number, number] = [p.cellX + p.cellWidth / 2, p.cellY + p.cellHeight / 2];
    for (const face of faces) {
      for (const seg of face) {
        expect(Math.hypot(seg.end[0] - middle[0], seg.end[1] - middle[1]))
          .toBeGreaterThan(1e-3);
      }
    }
  });

  it('a grid of tiles cuts one box, not one box per cell', () => {
    const p = pattern(new Array(9).fill('angular/tile_10101010'), 3, 3);
    const faces = patternPatchOutlines(p);
    expectWellFormed(faces, p);
    expectFillsBox(faces, p);
    // Nine plus-tiles, arm meeting arm across every shared cell edge: three
    // unbroken lines down the box and three across it, so the box is cut
    // into a 4×4 — not nine boxes of four, which is what a tile read on its
    // own would give.
    expect(faces).toHaveLength(16);
  });

  it('orders the patches down the page and then across it', () => {
    const p = pattern(['angular/tile_10101010'], 1, 1);
    const boxes = patternPatchOutlines(p).map((f) => computeSVGBbox(f));
    const sorted = [...boxes].sort((a, b) => (a.cellY - b.cellY) || (a.cellX - b.cellX));
    expect(boxes).toEqual(sorted);
  });

  it('turns the patches into place with the object, and still fills its box', () => {
    const upright = pattern(['angular/tile_10101010'], 1, 1);
    const turned = pattern(['angular/tile_10101010'], 1, 1, { angleDeg: 30 });
    const faces = patternPatchOutlines(turned);
    expect(faces).toHaveLength(4);
    // A rotation is rigid: same regions, same areas, moved.
    expectFillsBox(faces, turned);
    expect(patternPatchOutlines(upright).map(area))
      .toEqual(faces.map(area).map((a) => expect.closeTo(a, 6)));
    // …and they are NOT where the upright ones are.
    expect(computeSVGBbox(faces[0])).not.toEqual(computeSVGBbox(patternPatchOutlines(upright)[0]));
  });

  it('spells out a REPEATING grid and still stops at the region edge', () => {
    // One cell's tile, repeated over a region four tiles wide and two tall.
    const p = pattern(['angular/tile_10101010'], 1, 1, {
      cellWidth: 8, cellHeight: 4, tileMode: 'repeat', tileWidthL0: 2, tileHeightL0: 2,
    });
    const faces = patternPatchOutlines(p);
    expectWellFormed(faces, p);
    expectFillsBox(faces, p);
    // Four columns and two rows of the plus, their arms meeting copy to
    // copy: four lines down the region and two across it, cutting it into
    // a 5×3. The copies that hang over the region's edge cut nothing that
    // is kept.
    expect(faces).toHaveLength(15);
  });

  it('gives a pattern with no box no patches at all', () => {
    expect(patternPatchOutlines(pattern([null], 1, 1, { cellWidth: 0 }))).toEqual([]);
  });
});

describe('buildPatternMakeColorable', () => {
  function placed(p: PatternObject): CompositionState {
    return applyCompOps(makeBlankComposition('c', 'Test'), [
      { op: 'placeObject', kind: 'pattern', item: p },
    ]);
  }
  const isPatch = (s: SVGObject) => !!s.name?.startsWith('Patch ');
  const patchesOf = (state: CompositionState) => state.svgObjects.filter(isPatch);
  const drawingOf = (state: CompositionState) => state.svgObjects.find((s) => !isPatch(s))!;

  it('replaces the pattern with its drawing over one patch per region, grouped, in one undo step', () => {
    const p = pattern(['angular/tile_10101010'], 1, 1, { stroke: { width: 0.25 }, name: 'Quilt' });
    const state = placed(p);
    const se = buildPatternMakeColorable(state, p.id)!;
    expect(se).not.toBeNull();
    // The pattern out, four patches and the drawing in, and the group.
    expect(se.entry).toHaveLength(7);
    const after = applyCompOps(state, se.entry);
    // Not a pattern any more: the grid and its tools are gone with it.
    expect(after.patternObjects ?? []).toHaveLength(0);
    const patches = patchesOf(after);
    expect(patches.map((s) => s.name)).toEqual(['Patch 1', 'Patch 2', 'Patch 3', 'Patch 4']);
    // What is left is the drawing the renderer was already showing the
    // pattern as — same lines, same ink, same stroke, same box — under the
    // pattern's own name, and it is what comes up selected.
    const drawing = drawingOf(after);
    const view = patternSVGView(p)!;
    expect(drawing.name).toBe('Quilt');
    expect(se.id).toBe(drawing.id);
    expect(drawing.segments).toEqual(view.segments);
    expect(drawing.color).toEqual(view.color);
    expect(drawing.stroke).toEqual({ width: 0.25 });
    expect({
      cellX: drawing.cellX, cellY: drawing.cellY,
      cellWidth: drawing.cellWidth, cellHeight: drawing.cellHeight,
    }).toEqual({ cellX: p.cellX, cellY: p.cellY, cellWidth: p.cellWidth, cellHeight: p.cellHeight });
    // The patches lie where the pattern stood, and the drawing over them,
    // so the lines they were cut along still read on top.
    expect(after.sceneOrder.indexOf(patches[0].id)).toBe(state.sceneOrder.indexOf(p.id));
    for (const patch of patches) {
      expect(after.sceneOrder.indexOf(patch.id)).toBeLessThan(after.sceneOrder.indexOf(drawing.id));
    }
    // …and the lot is one group, named for what it is.
    const group = after.groups.find((g) => g.name === COLORABLE_GROUP_NAME)!;
    expect(group).toBeDefined();
    expect(COLORABLE_GROUP_NAME).toBe('Colorable');
    for (const s of after.svgObjects) expect(s.groupId).toBe(group.id);
    expect(after.groups).toHaveLength(1);
  });

  it('gives the drawing geometry of its own, not the renderer\'s cached view', () => {
    // patternSVGView is a cache shared with every draw site; a node the
    // editor writes to must not alias it.
    const p = pattern(['angular/tile_10101010'], 1, 1);
    const state = placed(p);
    const after = applyCompOps(state, buildPatternMakeColorable(state, p.id)!.entry);
    const drawing = drawingOf(after);
    const view = patternSVGView(p)!;
    expect(drawing.segments).not.toBe(view.segments);
    expect(drawing.segments[0]).not.toBe(view.segments[0]);
    expect(drawing.groupId).toBeDefined();
    expect(drawing.localSegments).toHaveLength(view.segments.length);
  });

  it('keeps a repeating pattern repeating: the drawing is a tiled svg', () => {
    // The intrinsic tile is one cell of a two-cell box, so the tile is
    // stamped four times; the drawing carries the same repeat fields and
    // its patches cover the box the stamps cut.
    const p = pattern(['angular/tile_10101010'], 1, 1, {
      tileMode: 'repeat', tileWidthL0: 1, tileHeightL0: 1,
    });
    const state = placed(p);
    const after = applyCompOps(state, buildPatternMakeColorable(state, p.id)!.entry);
    const drawing = drawingOf(after);
    expect(drawing.tileMode).toBe('repeat');
    expect(drawing.tileWidthL0).toBe(1);
    expect(drawing.tileHeightL0).toBe(1);
    const patches = patchesOf(after);
    expect(patches).toHaveLength(patternPatchOutlines(p).length);
    expectFillsBox(patches.map((s) => s.segments), p);
  });

  it('undoes as one step: the pattern is back, the drawing, patches and group gone', () => {
    const p = pattern(['angular/tile_10101010'], 1, 1);
    const state = placed(p);
    const se = buildPatternMakeColorable(state, p.id)!;
    const back = revertCompOps(applyCompOps(state, se.entry), se.entry);
    expect(back.patternObjects).toEqual(state.patternObjects);
    expect(back.svgObjects).toHaveLength(0);
    expect(back.groups).toHaveLength(0);
    expect(back.sceneOrder).toEqual(state.sceneOrder);
  });

  it('fills the patches white through the block the Fill page edits, with no outline', () => {
    // Not the legacy `fillColor`: the fill has to be the one the Fill page
    // opens ON, so a patch lands there showing its own white rather than an
    // "Add Fill" button (shapeFillOf reads `fill` first). And no outline at
    // all — the drawing draws those lines on top, so a patch that outlined
    // itself would double every edge.
    const p = pattern(['angular/tile_10101010'], 1, 1, { stroke: { width: 0.25 } });
    const state = placed(p);
    const after = applyCompOps(state, buildPatternMakeColorable(state, p.id)!.entry);
    const patches = patchesOf(after);
    expect(patches.length).toBeGreaterThan(0);
    for (const patch of patches) {
      expect(patch.stroke).toEqual({ width: 0 });
      expect(patch.color).toEqual(INK);
      expect(patch.fillColor).toBeUndefined();
      expect(svgIsFilled(patch)).toBe(true);
      expect(patch.fill).toMatchObject({
        type: 'solid',
        solid: { r: 255, g: 255, b: 255 },
        opacity: 1,
        blend: 'normal',
      });
      // …and its gradient stops fade from the pattern's ink, exactly as a
      // hand-drawn shape's first fill does.
      expect(patch.fill!.stops[0].color).toEqual(INK);
    }
    // The drawing keeps its line; only the patches go bare.
    expect(drawingOf(after).stroke).toEqual({ width: 0.25 });
  });

  it('writes the zero width even when the pattern carries no stroke block', () => {
    // An ABSENT stroke is not a missing one here: with no block at all the
    // renderer falls back to the composition-wide default width, which is a
    // visible line. Only an explicit `{ width: 0 }` makes the patch bare.
    const p = pattern(['angular/tile_10101010'], 1, 1);
    const state = placed(p);
    const after = applyCompOps(state, buildPatternMakeColorable(state, p.id)!.entry);
    for (const patch of patchesOf(after)) {
      expect(patch.stroke).toEqual({ width: 0 });
      expect(svgStrokeWidthCells(patch, after.strokeScale, BASE_CELL_PX)).toBe(0);
    }
  });

  it('boxes each patch on its own segments', () => {
    const p = pattern(['angular/tile_10101010'], 1, 1);
    const state = placed(p);
    const after = applyCompOps(state, buildPatternMakeColorable(state, p.id)!.entry);
    for (const patch of patchesOf(after)) {
      expect({
        cellX: patch.cellX, cellY: patch.cellY,
        cellWidth: patch.cellWidth, cellHeight: patch.cellHeight,
      }).toEqual(computeSVGBbox(patch.segments));
    }
  });

  it('prunes the group the pattern was the last member of, and undo restores it', () => {
    const p = pattern(['angular/tile_10101010'], 1, 1);
    const state = applyCompOps(placed(p), [
      { op: 'groupFigures', figureIds: [p.id], groupId: 'grp_old', groupName: 'Old' },
    ]);
    const se = buildPatternMakeColorable(state, p.id)!;
    expect(se.entry.some((op) => op.op === 'removeGroup')).toBe(true);
    const after = applyCompOps(state, se.entry);
    expect(after.groups.map((g) => g.name)).toEqual([COLORABLE_GROUP_NAME]);
    const back = revertCompOps(after, se.entry);
    expect(back.groups.map((g) => g.name)).toEqual(['Old']);
    expect(back.patternObjects?.[0]?.groupId).toBe('grp_old');
  });

  it('refuses a locked pattern: the press replaces it, which is what the lock refuses', () => {
    const p = pattern(['angular/tile_10101010'], 1, 1, { locked: true });
    expect(buildPatternMakeColorable(placed(p), p.id)).toBeNull();
  });

  it('refuses an empty pattern: there is no drawing to keep', () => {
    const p = pattern([null], 1, 1);
    expect(buildPatternMakeColorable(placed(p), p.id)).toBeNull();
  });

  it('is nothing for a node that is not a pattern', () => {
    const state = placed(pattern(['angular/tile_10101010'], 1, 1));
    expect(buildPatternMakeColorable(state, 'nope')).toBeNull();
  });
});

describe('patternPatchName', () => {
  it('numbers from one, as the Scene Outline shows them', () => {
    expect([0, 1, 9].map(patternPatchName)).toEqual(['Patch 1', 'Patch 2', 'Patch 10']);
  });
});
