import {
  dragCellBbox, PLACE_BOX_MIN_CELLS, TEXT_DOUBLE_TAP_MS, isTextDoubleTap,
  resolveCanvasTap, resolveNodeTap,
  frontItemTakesPress, selectionBoxHitsCell, selectionOwnsPress, tapClearsSelection, toolYieldsToSelection,
  SELECTION_CLAIM_MAX_COVERAGE, selectionSwallowsCanvas, selectionViewportCoverage,
} from '../canvasTap';
import { findSceneObjectAtCell } from '@/engine/compositionOps';
import type { CompositionState, ImageObject, SVGObject } from '@/engine/types';
import { makeBlankComposition } from '@/editor/blankComposition';
import {
  buildPlaceArcShape, buildPlaceLineShape, buildPlacePolygonShape, buildPlacePolyline,
  commitEntry, createEditorSession, resolveSelectionBox,
} from '../editorSession';
import type { HostTool } from '../hostTools';

const ALL_TOOLS: string[] = ['arrange', 'photos', 'draw', 'text', 'stickers', 'color', 'line', 'arc'];

// A tap on the BACKGROUND puts the selection away, under every tool.
// It did not under the brushes: a stationary press with one of them armed
// is a DAB, so it never settled as a tap at all, and a selection — which
// is the brush's own filter, with a veil over the rest of the page —
// could only be dropped by disarming the tool.
describe('tapClearsSelection — one rule, every tool', () => {
  // Every standard id (toolIds.ts StandardToolId) and a few an app might
  // register, so a tool added later cannot quietly get its own answer.
  const EVERY_TOOL: string[] = [
    'arrange', 'photos', 'draw', 'text', 'stickers', 'color', 'paint', 'erase', 'blur',
    'push', 'line', 'arc', 'polygon', 'pattern', 'lines', 'rig', 'word', 'tile', 'plant', 'bots',
  ];

  it('clears on a background tap whatever is armed — the brushes included', () => {
    for (const tool of EVERY_TOOL) {
      expect([tool, tapClearsSelection(null, tool)]).toEqual([tool, true]);
    }
  });

  it('does not clear when the tap HIT something — that tap selects it instead', () => {
    for (const tool of EVERY_TOOL) {
      expect([tool, tapClearsSelection('node-1', tool)]).toEqual([tool, false]);
    }
  });

  it('does not clear the press that puts the keyboard away', () => {
    // Tapping off an edited text commits it and blurs the field; that press
    // is a dismissal and is consumed by the blur.
    for (const tool of EVERY_TOOL) {
      expect([tool, tapClearsSelection(null, tool, true)]).toEqual([tool, false]);
    }
  });

  it('says nothing with no tool armed — the canvas is view-only there', () => {
    // setTool already dropped the selection; a selection that is a MODE is
    // the one exception and resolveCanvasTap clears that itself.
    expect(tapClearsSelection(null, null)).toBe(false);
    expect(resolveCanvasTap(null, null, false, true)).toEqual({ kind: 'select', id: null });
  });

  it('agrees with resolveCanvasTap wherever that already answered "clear"', () => {
    for (const tool of EVERY_TOOL) {
      const action = resolveCanvasTap(null, tool);
      if (action.kind === 'select') {
        expect([tool, action.id, tapClearsSelection(null, tool)]).toEqual([tool, null, true]);
      }
    }
  });
});

describe('resolveCanvasTap', () => {
  it('selects the hit item regardless of the active tool', () => {
    for (const tool of ALL_TOOLS) {
      expect(resolveCanvasTap('node-1', tool)).toEqual({ kind: 'select', id: 'node-1' });
    }
  });

  it('adds text on an empty-canvas tap with the text tool', () => {
    expect(resolveCanvasTap(null, 'text')).toEqual({ kind: 'addText' });
  });

  it('opens the photo picker on an empty-canvas tap with the photos tool', () => {
    expect(resolveCanvasTap(null, 'photos')).toEqual({ kind: 'requestPhoto' });
  });

  it('clears the selection on an empty-canvas tap with any other tool', () => {
    for (const tool of ALL_TOOLS.filter((t) => t !== 'text' && t !== 'photos')) {
      expect(resolveCanvasTap(null, tool)).toEqual({ kind: 'select', id: null });
    }
  });

  it('does nothing at all with no tool active — hit or not', () => {
    // The whole point of untoggling every tool: the canvas is view-only, so a
    // tap can neither select an object nor clear a selection nor place
    // content. Only the camera moves (CanvasSurface routes the gesture to a
    // pan before it ever consults this).
    expect(resolveCanvasTap(null, null)).toEqual({ kind: 'none' });
    expect(resolveCanvasTap('node-1', null)).toEqual({ kind: 'none' });
  });

  describe('with an IMAGE selected, the photos tool stops minting on tap', () => {
    // Placing an image leaves it selected with the tool still armed, so the
    // next tap — usually "I'm done, put this away" — opened the picker and
    // stacked a second image on the first. It now hands the canvas back to
    // the arrange tool instead; the image stays selected.
    it('reverts to arrange on an empty-canvas tap instead of opening the picker', () => {
      expect(resolveCanvasTap(null, 'photos', false, false, true))
        .toEqual({ kind: 'revertToArrange' });
    });

    it('still opens the picker when nothing (or something else) is selected', () => {
      expect(resolveCanvasTap(null, 'photos', false, false, false))
        .toEqual({ kind: 'requestPhoto' });
      expect(resolveCanvasTap(null, 'photos')).toEqual({ kind: 'requestPhoto' });
    });

    it('still selects a node the tap actually landed on', () => {
      expect(resolveCanvasTap('node-1', 'photos', false, false, true))
        .toEqual({ kind: 'select', id: 'node-1' });
    });

    it('still yields the dismissal tap to an open text edit', () => {
      expect(resolveCanvasTap(null, 'photos', true, false, true)).toEqual({ kind: 'none' });
    });

    it('changes nothing for the other tools — their off-tap already deselects', () => {
      for (const tool of ALL_TOOLS.filter((t) => t !== 'photos')) {
        expect(resolveCanvasTap(null, tool, false, false, true))
          .toEqual(resolveCanvasTap(null, tool, false, false, false));
      }
    });
  });

  describe('with a TEXT selected, the text tool stops minting on tap', () => {
    // Same rule as the photos tool: placing (or selecting) a text leaves it
    // selected with the tool armed, so the off-tap — "done with this one" —
    // dropped another text right under it. It reverts to arrange instead;
    // the text stays selected.
    it('reverts to arrange on an empty-canvas tap instead of adding a text', () => {
      expect(resolveCanvasTap(null, 'text', false, false, false, true))
        .toEqual({ kind: 'revertToArrange' });
    });

    it('still adds a text when nothing (or something else) is selected', () => {
      expect(resolveCanvasTap(null, 'text', false, false, false, false))
        .toEqual({ kind: 'addText' });
      expect(resolveCanvasTap(null, 'text')).toEqual({ kind: 'addText' });
      // An image selected under the text tool doesn't block the placement.
      expect(resolveCanvasTap(null, 'text', false, false, true, false))
        .toEqual({ kind: 'addText' });
    });

    it('still selects a node the tap actually landed on', () => {
      expect(resolveCanvasTap('node-1', 'text', false, false, false, true))
        .toEqual({ kind: 'select', id: 'node-1' });
    });

    it('still yields the dismissal tap to an open text edit', () => {
      expect(resolveCanvasTap(null, 'text', true, false, false, true)).toEqual({ kind: 'none' });
    });

    it('changes nothing for the other tools — their off-tap already deselects', () => {
      for (const tool of ALL_TOOLS.filter((t) => t !== 'text')) {
        expect(resolveCanvasTap(null, tool, false, false, false, true))
          .toEqual(resolveCanvasTap(null, tool, false, false, false, false));
      }
    });
  });

  it('prefers selecting a hit item over placing content (hit wins over tool)', () => {
    expect(resolveCanvasTap('img-9', 'text')).toEqual({ kind: 'select', id: 'img-9' });
    expect(resolveCanvasTap('img-9', 'photos')).toEqual({ kind: 'select', id: 'img-9' });
  });

  describe('while a text is being typed into', () => {
    it('places nothing on an empty-canvas tap — that press is the dismissal', () => {
      // Tapping off is how the keyboard goes away: the field blurs and the
      // edit commits. Routed as usual, that same press ALSO minted a second
      // text under the finger, so putting the keyboard away left litter.
      expect(resolveCanvasTap(null, 'text', true)).toEqual({ kind: 'none' });
      expect(resolveCanvasTap(null, 'photos', true)).toEqual({ kind: 'none' });
    });

    it('leaves the selection alone, so the text stays selected behind it', () => {
      for (const tool of ALL_TOOLS) {
        expect(resolveCanvasTap(null, tool, true)).toEqual({ kind: 'none' });
      }
    });

    it('still selects a node the tap actually landed on', () => {
      // A press aimed at something is not a dismissal, even though the blur
      // puts the keyboard away just the same.
      expect(resolveCanvasTap('img-9', 'text', true)).toEqual({ kind: 'select', id: 'img-9' });
      expect(resolveCanvasTap('txt-2', 'arrange', true)).toEqual({ kind: 'select', id: 'txt-2' });
    });

    it('is off by default — nothing changes for a tap with no edit in flight', () => {
      expect(resolveCanvasTap(null, 'text')).toEqual({ kind: 'addText' });
      expect(resolveCanvasTap(null, 'text', false)).toEqual({ kind: 'addText' });
    });
  });
});

describe('a selection that has swallowed the screen lets go of the press', () => {
  // A multi-selection claims its whole combined box — a press inside it
  // drags the selection whatever tool is armed. A box covering the screen
  // therefore took every press and (a group answering for its own box)
  // every settled tap, so nothing could be drawn on the page at all. See
  // docs/reimagine_stuck_selection.md. The cap answers that press claim
  // only: the two-finger TWIST turns the selection at every zoom level
  // (CanvasSurface's multiManipulate), since a rotation has no business
  // depending on how close the camera is, and the capsule's Done is the
  // exit that does not depend on the box's size either.

  const VIEWPORT = { width: 400, height: 800 };
  /** A camera that maps the whole viewport onto cells 0..40 × 0..80 — one
   *  cell per ten screen px — so a box in cells is easy to read as a
   *  fraction of the screen. */
  const toCell = (x: number, y: number) => ({ cellX: x / 10, cellY: y / 10 });
  /** A box spanning `fx` of the screen's width and `fy` of its height,
   *  centred — the shape a selection has as you zoom in on it. */
  const centred = (fx: number, fy: number) => ({
    cellX: 20 - (40 * fx) / 2,
    cellY: 40 - (80 * fy) / 2,
    cellWidth: 40 * fx,
    cellHeight: 80 * fy,
  });

  it('measures how much of the viewport the box covers', () => {
    expect(selectionViewportCoverage(centred(1, 1), 0, toCell, VIEWPORT)).toBe(1);
    expect(selectionViewportCoverage(
      { cellX: -100, cellY: -100, cellWidth: 1, cellHeight: 1 }, 0, toCell, VIEWPORT,
    )).toBe(0);
    // Half the width, all the height: about half the screen.
    expect(selectionViewportCoverage(centred(0.5, 1), 0, toCell, VIEWPORT))
      .toBeCloseTo(0.43, 2);
  });

  it('keeps the claim for a selection with page around it', () => {
    // The case the whole-box claim was written for: a thing on a page.
    expect(selectionSwallowsCanvas(centred(0.5, 0.5), 0, toCell, VIEWPORT)).toBe(false);
    expect(selectionSwallowsCanvas(centred(0.8, 0.8), 0, toCell, VIEWPORT)).toBe(false);
  });

  it('drops the claim once the box IS the screen', () => {
    expect(selectionSwallowsCanvas(centred(1, 1), 0, toCell, VIEWPORT)).toBe(true);
    // …and while it merely overflows it, which is what zooming in produces.
    expect(selectionSwallowsCanvas(centred(3, 3), 0, toCell, VIEWPORT)).toBe(true);
  });

  it('is monotone in the box’s size, so zooming out hands the claim back', () => {
    // The recovery path: the cap releases the pinch, the pinch shrinks the
    // box against the screen, and the claim returns — so the release is
    // temporary and self-correcting rather than a mode.
    let previous = 1;
    for (const f of [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.25]) {
      const coverage = selectionViewportCoverage(centred(f, f), 0, toCell, VIEWPORT);
      expect(coverage).toBeLessThanOrEqual(previous);
      previous = coverage;
    }
    expect(selectionSwallowsCanvas(centred(0.25, 0.25), 0, toCell, VIEWPORT)).toBe(false);
  });

  it('measures the box as DRAWN, turn included', () => {
    // A box exactly the screen's size covers all of it square-on; turned
    // about its own centre the same box leaves the screen's corners, and
    // the measure drops. Sampled through selectionBoxHitsCell rather than
    // off the stored rect, so the box is measured as it is SEEN and there
    // is no second geometry to keep in step with the first.
    const full = centred(1, 1);
    expect(selectionViewportCoverage(full, 0, toCell, VIEWPORT)).toBe(1);
    expect(selectionViewportCoverage(full, 45, toCell, VIEWPORT)).toBeLessThan(1);
    // A narrow band laid across the screen covers a stripe of it either
    // way round, and never enough to take the claim.
    const band = { cellX: 16, cellY: -160, cellWidth: 8, cellHeight: 400 };
    expect(selectionSwallowsCanvas(band, 0, toCell, VIEWPORT)).toBe(false);
    expect(selectionSwallowsCanvas(band, 90, toCell, VIEWPORT)).toBe(false);
  });

  it('answers 0 for a viewport with no size, so nothing is refused before layout', () => {
    expect(selectionViewportCoverage(centred(1, 1), 0, toCell, { width: 0, height: 0 })).toBe(0);
    expect(selectionSwallowsCanvas(centred(1, 1), 0, toCell, { width: 0, height: 0 })).toBe(false);
  });

  it('caps below the whole screen, so the trap cannot be reached by a near miss', () => {
    // The cap has to leave room to AIM: a two-finger gesture needs BOTH
    // fingers outside the box to reach the camera.
    expect(SELECTION_CLAIM_MAX_COVERAGE).toBeGreaterThan(0.5);
    expect(SELECTION_CLAIM_MAX_COVERAGE).toBeLessThan(1);
  });
});

describe('selectionBoxHitsCell', () => {
  const box = { cellX: 4, cellY: 4, cellWidth: 8, cellHeight: 4 };

  it('accepts a point inside the box and rejects one outside', () => {
    expect(selectionBoxHitsCell(box, 0, 8, 6)).toBe(true);
    expect(selectionBoxHitsCell(box, 0, 3.9, 6)).toBe(false);
    expect(selectionBoxHitsCell(box, 0, 8, 8.1)).toBe(false);
  });

  it('accepts the edges (a press on the outline still grabs)', () => {
    expect(selectionBoxHitsCell(box, 0, 4, 4)).toBe(true);
    expect(selectionBoxHitsCell(box, 0, 12, 8)).toBe(true);
  });

  it('follows the box through a free rotation', () => {
    // Turned a quarter clockwise about its center (8, 6), the 8x4 box covers
    // 4 wide x 8 tall: a point above the unrotated box is now inside it, and
    // one at its unrotated left edge is now outside.
    expect(selectionBoxHitsCell(box, 90, 8, 2.5)).toBe(true);
    expect(selectionBoxHitsCell(box, 0, 8, 2.5)).toBe(false);
    expect(selectionBoxHitsCell(box, 90, 4.5, 6)).toBe(false);
    expect(selectionBoxHitsCell(box, 0, 4.5, 6)).toBe(true);
  });
});

describe('selectionOwnsPress', () => {
  // A line drawn over the page's full-bleed photo: the photo is painted
  // first, so it sits BEHIND the line.
  const sceneOrder = ['photo', 'line', 'sticker'];

  it('keeps a press inside the box that the hit-test gave to something behind', () => {
    // The reported bug: pressing inside a drawn line's box but off its stroke
    // resolves to the photo behind it, so the shape tool drew instead of
    // moving the very object the user had selected.
    expect(selectionOwnsPress({
      hitId: 'photo', selectedId: 'line', insideBox: true, sceneOrder,
    })).toBe(true);
  });

  it('keeps a press that landed on the selected node itself', () => {
    expect(selectionOwnsPress({
      hitId: 'line', selectedId: 'line', insideBox: true, sceneOrder,
    })).toBe(true);
    // Geometry can overflow the box it is drawn from (a stroke straddling a
    // simple line's box), so a hit on the node wins without it.
    expect(selectionOwnsPress({
      hitId: 'line', selectedId: 'line', insideBox: false, sceneOrder,
    })).toBe(true);
  });

  it('keeps a press on empty canvas inside the box', () => {
    expect(selectionOwnsPress({
      hitId: null, selectedId: 'line', insideBox: true, sceneOrder,
    })).toBe(true);
  });

  it('yields to an object drawn IN FRONT of the selection', () => {
    // Otherwise selecting a page-sized object would trap the canvas: every
    // press would move it and nothing on top could be picked again.
    expect(selectionOwnsPress({
      hitId: 'sticker', selectedId: 'line', insideBox: true, sceneOrder,
    })).toBe(false);
  });

  it('claims nothing outside the box', () => {
    expect(selectionOwnsPress({
      hitId: null, selectedId: 'line', insideBox: false, sceneOrder,
    })).toBe(false);
    expect(selectionOwnsPress({
      hitId: 'photo', selectedId: 'line', insideBox: false, sceneOrder,
    })).toBe(false);
  });

  it('treats an id missing from the paint order as behind', () => {
    expect(selectionOwnsPress({
      hitId: 'ghost', selectedId: 'line', insideBox: true, sceneOrder,
    })).toBe(true);
  });
});

describe('a shape-tool press on a selected line lying over a photo', () => {
  // The reported bug, end to end over real engine geometry: a diagonal line
  // drawn on a page whose backdrop is a full-bleed photo. Selecting the line
  // no longer disarms the line tool, so the next press has to decide between
  // moving the line and drawing another one.
  const state: CompositionState = {
    ...makeBlankComposition('press-routing', 'Probe'),
    images: [{
      id: 'img_bg', imageId: 'i1', mimeType: 'image/png',
      cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 40,
    } as ImageObject],
    svgObjects: [{
      id: 'svg_line', color: { r: 0, g: 0, b: 0 },
      segments: [{ kind: 'line', start: [4, 4], end: [12, 12] }],
      cellX: 4, cellY: 4, cellWidth: 8, cellHeight: 8,
    } as SVGObject],
    sceneOrder: ['img_bg', 'svg_line'],
  };
  const sel = resolveSelectionBox(state, 'svg_line')!;
  const ownsPressAt = (cellX: number, cellY: number) => {
    const hit = findSceneObjectAtCell(state, cellX, cellY);
    return selectionOwnsPress({
      hitId: hit ? hit.id : null,
      selectedId: 'svg_line',
      insideBox: selectionBoxHitsCell(sel.bbox, sel.angleDeg, cellX, cellY),
      sceneOrder: state.sceneOrder,
    });
  };

  it('resolves the corner of the line box to the PHOTO behind it', () => {
    // Why the old `hit.id === selectedId` check never fired there: a stroke
    // miss inside an SVG's bbox is only a fallback, so the photo wins.
    expect(findSceneObjectAtCell(state, 11, 5)?.id).toBe('img_bg');
  });

  it('still moves the line: the box the user sees claims that press', () => {
    expect(ownsPressAt(11, 5)).toBe(true);
    expect(ownsPressAt(8, 8)).toBe(true); // on the stroke itself
  });

  it('draws, as before, on a press outside the line box', () => {
    expect(ownsPressAt(20, 20)).toBe(false);
  });
});

describe('toolYieldsToSelection', () => {
  it('yields for every tool that would otherwise create something', () => {
    for (const tool of ['arrange', 'line', 'arc', 'polygon', 'draw', 'photos', 'text'] as string[]) {
      expect(toolYieldsToSelection(tool)).toBe(true);
    }
  });

  it('does not yield for the paint brushes — there the selection is the filter', () => {
    for (const tool of ['color', 'erase', 'blur'] as string[]) {
      expect(toolYieldsToSelection(tool)).toBe(false);
    }
  });

  it('does not yield with no tool active (the canvas is view-only)', () => {
    expect(toolYieldsToSelection(null)).toBe(false);
  });
});

describe('dragCellBbox', () => {
  it('normalizes a top-left → bottom-right drag into a bbox', () => {
    expect(dragCellBbox([2, 3], [10, 9])).toEqual({
      cellX: 2, cellY: 3, cellWidth: 8, cellHeight: 6,
    });
  });

  it('normalizes an inverted drag (bottom-right → top-left) to the same bbox', () => {
    expect(dragCellBbox([10, 9], [2, 3])).toEqual({
      cellX: 2, cellY: 3, cellWidth: 8, cellHeight: 6,
    });
  });

  it('rejects a drag thinner than the minimum in either axis', () => {
    // Wide but flat: height under the minimum.
    expect(dragCellBbox([0, 0], [10, PLACE_BOX_MIN_CELLS / 2])).toBeNull();
    // Tall but narrow: width under the minimum.
    expect(dragCellBbox([0, 0], [PLACE_BOX_MIN_CELLS / 2, 10])).toBeNull();
    // Degenerate: no movement at all.
    expect(dragCellBbox([5, 5], [5, 5])).toBeNull();
  });

  it('accepts a box exactly at the minimum extent', () => {
    expect(dragCellBbox([0, 0], [PLACE_BOX_MIN_CELLS, PLACE_BOX_MIN_CELLS])).toEqual({
      cellX: 0, cellY: 0, cellWidth: PLACE_BOX_MIN_CELLS, cellHeight: PLACE_BOX_MIN_CELLS,
    });
  });

  it('honors a caller-supplied minimum', () => {
    expect(dragCellBbox([0, 0], [1, 1], 2)).toBeNull();
    expect(dragCellBbox([0, 0], [2, 2], 2)).not.toBeNull();
  });
});

describe('resolveNodeTap', () => {
  it('opens the text editor when re-tapping an already-selected editable text', () => {
    expect(resolveNodeTap({ wasSelected: true, isEditableText: true })).toEqual({ kind: 'editText' });
  });

  it('does not edit on the first tap (node was not yet selected)', () => {
    expect(resolveNodeTap({ wasSelected: false, isEditableText: true })).toEqual({ kind: 'default' });
  });

  it('does not edit a re-tapped non-text node (defers to the photo-replace probe)', () => {
    expect(resolveNodeTap({ wasSelected: true, isEditableText: false })).toEqual({ kind: 'default' });
  });

  it('never edits when the node is neither selected nor an editable text', () => {
    expect(resolveNodeTap({ wasSelected: false, isEditableText: false })).toEqual({ kind: 'default' });
  });

  it('opens NOTHING in the modes where a tap only ever selects', () => {
    // Move's promise is that a press moves the thing under it and does
    // nothing else: it already takes the corner handles away so a grab
    // cannot scale. A re-tap dropping the reader into a text's content
    // editor broke the same promise from the other side, and arranging a
    // page is tapping the same object over and over — the very shape of
    // the gesture that opens one. Rotate says the same of its own
    // one-finger press, so it is the same flag.
    expect(resolveNodeTap({ wasSelected: true, isEditableText: true, selectsOnly: true }))
      .toEqual({ kind: 'default' });
    // …and with it off, the re-tap opens as it always did.
    expect(resolveNodeTap({ wasSelected: true, isEditableText: true, selectsOnly: false }))
      .toEqual({ kind: 'editText' });
  });
});

describe('a line and an arc leave nothing selected either', () => {
  // Same reasoning as the pencil: they are marks, drawn in runs. The
  // behaviour is the entry's own, so it is checkable without the canvas.
  const BLACK = { r: 0, g: 0, b: 0 };

  it('commits the shape but selects nothing, where polygon selects', () => {
    const state = makeBlankComposition('comp_shape');
    const session = createEditorSession(state);
    const line = buildPlaceLineShape([2, 2], [8, 2], BLACK, 'line', 0)!;
    const arc = buildPlaceArcShape([2, 2], [8, 8], [2, 8], BLACK, 'arc')!;
    for (const se of [line, arc]) {
      // Dropping `id` is what the canvas does with these two…
      expect(commitEntry(session, { ...se, id: undefined }).selectedId).toBeNull();
      // …and the shape still lands on the page.
      expect(commitEntry(session, { ...se, id: undefined }).state.svgObjects)
        .toHaveLength(state.svgObjects.length + 1);
    }
    // A polygon keeps its id, so it arrives selected.
    const poly = buildPlacePolygonShape([2, 2], [8, 8], 5, BLACK)!;
    expect(commitEntry(session, poly).selectedId).toBe(poly.id);
  });
});

describe('a mint that keeps its id selects; one that drops it does not', () => {
  // The mechanism the pencil leans on, stated where it can be checked.
  it('selects the new object when the entry names it, and not otherwise', () => {
    const state = makeBlankComposition('comp_tap');
    const session = createEditorSession(state);
    const se = buildPlacePolyline([[2, 3], [6, 3], [6, 9]], { r: 0, g: 0, b: 0 })!;
    expect(commitEntry(session, se).selectedId).toBe(se.id);
    expect(commitEntry(session, { ...se, id: undefined }).selectedId).toBeNull();
    // Either way the stroke lands on the page — only the selection differs.
    expect(commitEntry(session, { ...se, id: undefined }).state.svgObjects)
      .toHaveLength((state.svgObjects?.length ?? 0) + 1);
  });
});

// ── A host tool's tap, by the rule its registry row names ────────────
// The three shapes an app's placing tool can take (hostTools.ts
// `HostTool.tap`): what CozyJournal's Word, Figure and Pattern tile, Sol's
// Plant and DrawBot's Inklings each are is pinned in their own apps; here a
// made-up registry pins what the resolver does with each rule.
describe('a host tool’s tap (hostTools.ts `tap`)', () => {
  const HOST: HostTool[] = [
    { id: 'deal', label: 'Deal', icon: 'cards', tap: 'anywhere' },
    { id: 'figure', label: 'Figure', icon: 'human', tap: 'onEmpty' },
    { id: 'stamp', label: 'Stamp', icon: 'grid', tap: 'against' },
    { id: 'thing', label: 'Thing', icon: 'robot' },
  ];

  describe('‘anywhere’ deals under EVERY tap — hit or not', () => {
    // Magnets go down in runs, right up against and on top of what is
    // already on the page. A tap that selected the tile underneath instead
    // of dealing broke the run; selecting is the arrange tool's job.
    it('never selects: a tap on an object still places', () => {
      expect(resolveCanvasTap(null, 'deal', false, false, false, false, HOST)).toEqual({ kind: 'hostPlace', tool: 'deal' });
      expect(resolveCanvasTap('node-1', 'deal', false, false, false, false, HOST)).toEqual({ kind: 'hostPlace', tool: 'deal' });
    });

    it('still yields the dismissal tap to an open text edit', () => {
      expect(resolveCanvasTap(null, 'deal', true, false, false, false, HOST)).toEqual({ kind: 'none' });
      expect(resolveCanvasTap('node-1', 'deal', true, false, false, false, HOST)).toEqual({ kind: 'none' });
    });

    it('never yields a press on the selection: a tap there places beside it', () => {
      expect(toolYieldsToSelection('deal', HOST)).toBe(false);
    });

    it('a background tap still clears the selection', () => {
      expect(tapClearsSelection(null, 'deal')).toBe(true);
    });
  });

  describe('‘onEmpty’ places on an empty-canvas tap and selects what it hits', () => {
    // The tool PLACES on the canvas rather than the instant its toolbar
    // button is pressed — which is what lets that button keep its menu.
    it('plants on empty canvas', () => {
      expect(resolveCanvasTap(null, 'figure', false, false, false, false, HOST)).toEqual({ kind: 'hostPlace', tool: 'figure' });
    });

    it('a press aimed at something is a selection like under any other tool', () => {
      expect(resolveCanvasTap('node-1', 'figure', false, false, false, false, HOST)).toEqual({ kind: 'select', id: 'node-1' });
    });

    it('places nothing while a text is being typed into', () => {
      expect(resolveCanvasTap(null, 'figure', true, false, false, false, HOST)).toEqual({ kind: 'none' });
    });

    it('yields a press on the selection, like a shape tool', () => {
      expect(toolYieldsToSelection('figure', HOST)).toBe(true);
    });
  });

  describe('‘against’ places against what is there', () => {
    const against = (openTarget: boolean, joins: boolean) => ({ openTarget, joins });

    it('stamps into the target it has open, and against a neighbour on empty canvas', () => {
      expect(resolveCanvasTap('grid-1', 'stamp', false, false, false, false, HOST, against(true, true)))
        .toEqual({ kind: 'hostPlace', tool: 'stamp' });
      expect(resolveCanvasTap(null, 'stamp', false, false, false, false, HOST, against(false, true)))
        .toEqual({ kind: 'hostPlace', tool: 'stamp' });
    });

    it('a tap on any OTHER object is aimed at that object: it selects it', () => {
      expect(resolveCanvasTap('text-1', 'stamp', false, false, false, false, HOST, against(false, true)))
        .toEqual({ kind: 'select', id: 'text-1' });
    });

    it('a tap with nothing to place against clears the selection, as every empty-canvas tap does', () => {
      expect(resolveCanvasTap(null, 'stamp', false, false, false, false, HOST, against(false, false)))
        .toEqual({ kind: 'select', id: null });
      // The default: nothing open, nothing to join.
      expect(resolveCanvasTap(null, 'stamp', false, false, false, false, HOST)).toEqual({ kind: 'select', id: null });
    });

    it('an editing text still gets its dismissal tap first', () => {
      expect(resolveCanvasTap('grid-1', 'stamp', true, false, false, false, HOST, against(true, true))).toEqual({ kind: 'none' });
    });

    it('does not yield a press on the selection: a tap there fills the cell', () => {
      expect(toolYieldsToSelection('stamp', HOST)).toBe(false);
    });
  });

  it('a host tool with no tap rule places nothing: a tap selects what it hits, or clears', () => {
    expect(resolveCanvasTap('node-1', 'thing', false, false, false, false, HOST)).toEqual({ kind: 'select', id: 'node-1' });
    expect(resolveCanvasTap(null, 'thing', false, false, false, false, HOST)).toEqual({ kind: 'select', id: null });
    expect(toolYieldsToSelection('thing', HOST)).toBe(true);
  });

  it('a tool the registry does not know is read as a standard one', () => {
    expect(resolveCanvasTap(null, 'deal')).toEqual({ kind: 'select', id: null });
    expect(toolYieldsToSelection('deal')).toBe(true);
  });
});

describe('a selection that is a MODE rather than a selection', () => {
  // CozyJournal's selected rig answers presses by posing itself, floats a
  // Turn slider over the page and fills the properties panel — none of it
  // put there by the toolbar, so untoggling every tool cannot take it away.
  // Tapping off has to be the way out.
  it('clears it on an empty-canvas tap even with no tool active', () => {
    expect(resolveCanvasTap(null, null, false, true)).toEqual({ kind: 'select', id: null });
  });

  it('still leaves a tap that landed on something alone', () => {
    expect(resolveCanvasTap('node-1', null, false, true)).toEqual({ kind: 'none' });
  });

  it('is not an escape hatch out of a text edit', () => {
    expect(resolveCanvasTap(null, null, true, true)).toEqual({ kind: 'none' });
  });

  it('changes nothing once a tool IS active — that path already cleared', () => {
    for (const tool of ALL_TOOLS.filter((t) => t !== 'text' && t !== 'photos')) {
      expect(resolveCanvasTap(null, tool, false, true))
        .toEqual(resolveCanvasTap(null, tool, false, false));
    }
  });
});

describe('an item a host layer draws in front of the whole scene', () => {
  const sceneOrder = ['photo', 'line'];

  it('takes the press away from the selection, even over the selected node itself', () => {
    // DrawBot's bug report 7e86ce9d: a bot sitting on its own trail, the
    // trail sent to the back and still selected. The scene hit-test finds
    // the TRAIL (the bot is not a scene node), but the bot is drawn above
    // everything.
    expect(selectionOwnsPress({
      hitId: 'line', frontId: 'bot_1', selectedId: 'line', insideBox: true, sceneOrder,
    })).toBe(false);
    expect(selectionOwnsPress({
      hitId: null, frontId: 'bot_1', selectedId: 'line', insideBox: true, sceneOrder,
    })).toBe(false);
    // No such item under the press: the rules above, unchanged.
    expect(selectionOwnsPress({
      hitId: 'line', frontId: null, selectedId: 'line', insideBox: true, sceneOrder,
    })).toBe(true);
  });

  it('frontItemTakesPress: an item in front takes the press unless it is (part of) the selection', () => {
    expect(frontItemTakesPress('bot_1', ['line'])).toBe(true);
    expect(frontItemTakesPress('bot_1', ['line', 'photo'])).toBe(true);
    expect(frontItemTakesPress('bot_1', ['bot_1'])).toBe(false);
    expect(frontItemTakesPress(null, ['line'])).toBe(false);
    expect(frontItemTakesPress(null, [])).toBe(false);
  });
});

describe('the text double tap’s window is inclusive', () => {
  it('a second press exactly TEXT_DOUBLE_TAP_MS after the first is a double', () => {
    // The rule became the chrome's `secondTapWithin` (the third copy of the
    // same three lines, folded in by DrawBot); the pattern tile took the
    // same one-millisecond change.
    expect(isTextDoubleTap({ id: 'txt-1', time: 1000 - TEXT_DOUBLE_TAP_MS }, 'txt-1', 1000)).toBe(true);
    expect(isTextDoubleTap({ id: 'txt-1', time: 1000 - TEXT_DOUBLE_TAP_MS - 1 }, 'txt-1', 1000)).toBe(false);
  });
});
