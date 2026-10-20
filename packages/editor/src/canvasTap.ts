import {
  LOCAL_IDENTITY, localMatrix, matAbout, matApplyPoint,
} from '@/engine/sceneTransform';
import type { CellBbox } from '@/editor/resizeMath';
import { secondTapWithin, type TapRecord } from '@/editor-ui/logic/secondTap';
import { type HostTools, NO_HOST_TOOLS, hostTool } from './hostTools';

// What a single tap (no drag) on the editor canvas resolves to. The options
// row that used to host "Add photo" / "Add text" is gone, so an empty-canvas
// tap is the primary way to place content: it is routed by the active tool.
export type CanvasTapAction =
  | { kind: 'select'; id: string | null } // select a hit item, or clear
  | { kind: 'addText' } // text tool on empty canvas
  | { kind: 'requestPhoto' } // photos tool on empty canvas
  | { kind: 'revertToArrange' } // photos tool, image selected — tap off = done placing
  | { kind: 'hostPlace'; tool: string } // a host tool's tap places: the shell builds the entry
  | { kind: 'none' }; // no tool active — the canvas is view-only

/**
 * Does a settled tap CLEAR the selection, whatever else it goes on to do?
 *
 * ONE rule, and it holds under every tool: a tap on the BACKGROUND —
 * nothing under the finger — ends the selection. It is the gesture that
 * means "put this away", and it used to mean that only under the tools
 * whose empty-canvas tap had nothing else to do. Under the brushes it did
 * nothing at all: a stationary press is a DAB, so it never settled as a
 * tap, and a selection — which is the brush's own filter, with a veil
 * over the rest of the page — could only be dropped by disarming the
 * tool. Under the tools that PLACE something (text, photos, a host's
 * placing tool) the placement's own selection lands after this, so the
 * clear is invisible there; what it fixes is every tool that placed
 * nothing.
 *
 * Two things are not a background tap:
 *  - a tap that HIT something, which selects that thing instead;
 *  - a tap while a text is being typed into, which is the press that puts
 *    the keyboard away (it commits the edit and is consumed by the blur).
 *
 * With NO tool armed the canvas is view-only and `setTool` has already
 * dropped the selection — except a selection that is a MODE (CozyJournal's
 * selected rig), which {@link resolveCanvasTap} clears itself.
 */
export function tapClearsSelection(
  hitId: string | null,
  tool: string | null,
  editingText = false,
): boolean {
  return hitId === null && tool !== null && !editingText;
}

/**
 * Decide what a tap does from what it landed on, the active tool, and
 * whether a text is being typed into right now.
 *
 * Whatever this answers, a tap on the BACKGROUND also clears the selection
 * ({@link tapClearsSelection}) — the caller applies that rule first, so
 * the actions below only have to say what the tap PLACES.
 *
 * With NO tool active (`null`, every button untoggled) a tap does nothing at
 * all — not even clearing the selection, which setTool already dropped. The
 * canvas is view-only in that state, so a finger on it can only pan or zoom.
 *
 * A selection that is a MODE (`selectionIsMode` — CozyJournal's selected
 * rig) is the exception, because it is not really a selection. The figure
 * answers presses by posing itself, a Turn slider floats over the page, and
 * the properties panel fills with rig controls — none of which the toolbar
 * put there or can take away. So the gesture that obviously means "I'm done
 * with this" has to work: a tap on empty canvas clears it, tool or no tool.
 *
 * Otherwise an item under the finger is always selected, whatever the tool
 * (a host tool that places `'anywhere'` or `'against'` excepted — see
 * below). A tap on empty canvas is tool-specific: `text` drops a new text,
 * `photos` opens the import picker, a HOST tool with a `tap` rule places
 * (hostTools.ts; the shell builds the entry for the tool the action names),
 * and every other tool places nothing — leaving the background tap's clear
 * as the whole of what it does.
 *
 * WITH AN IMAGE SELECTED, the photos tool's empty-canvas tap does NOT open
 * the picker again. Placing an image leaves it selected with the tool still
 * armed, so the very next tap — usually "I'm done, put this away" — minted a
 * second image on top of the first. That tap instead hands the canvas back
 * to the arrange tool (`revertToArrange`); adding another is a fresh press
 * on the toolbar's Image button. It used to leave the image SELECTED, on
 * the reading that the tap meant "now let me move it"; a background tap is
 * the one gesture that puts a selection away under every other tool, so it
 * puts this one away too and a tap back on the image picks it up.
 *
 * WITH A TEXT SELECTED, the text tool's empty-canvas tap follows the same
 * rule: placing (or selecting) a text leaves it selected with the tool
 * armed, and the tap that means "done with this one" minted another text
 * right under it. It reverts to arrange instead; a new text only goes down
 * when none is selected.
 *
 * A HOST TOOL'S TAP is read by the rule its registry row names
 * (hostTools.ts `HostTool.tap`), three shapes between them:
 *  · `'anywhere'` places under every tap, hit or not (CozyJournal's Word,
 *    whose magnets go down in clusters right up against — and over — what
 *    is already on the page, so a tap that SELECTED the tile underneath
 *    broke the run; Sol's Plant, which seeds among its own drawings).
 *    Selecting is the arrange tool's job.
 *  · `'onEmpty'` selects what it hits and places on empty canvas
 *    (CozyJournal's Figure: a fresh T-pose).
 *  · `'against'` places AGAINST what is there (the Pattern tile, whose
 *    whole point is filling cells beside existing tiles) — but only ever
 *    into the ONE target opened for editing (`against.openTarget`: the
 *    pattern with the double border). A tap there stamps. A tap on anything
 *    ELSE under the finger — a text, a shape, a photo, another pattern — is
 *    aimed at that object: it selects it, as under any other tool. And a
 *    tap with nothing to place against (`against.joins` false) CLEARS the
 *    selection, as every other tool's empty-canvas tap does: a file's first
 *    pattern is dragged out as a region, so the lone tap is free to mean
 *    what it means everywhere else.
 * A host tool with no `tap` rule places nothing: a tap selects what it
 * hits (DrawBot's Inklings, whose placement the sim layer's own gesture
 * hooks claim before the tap is read).
 *
 * WHILE A TEXT IS BEING EDITED, an empty-canvas tap does NOTHING. Tapping
 * off is how the keyboard is put away — the field blurs, which commits the
 * edit — and that press is a dismissal, not a placement. Routed as usual it
 * ALSO minted a second text under the finger (or opened the photo picker),
 * so putting the keyboard away left litter on the page. Landing on a node
 * still selects it: that is a press aimed at something, and the blur puts
 * the keyboard away just the same.
 */
export function resolveCanvasTap(
  hitId: string | null,
  tool: string | null,
  editingText = false,
  /** The selection is a MODE rather than a selection (CozyJournal's rig):
   *  an empty-canvas tap clears it even with no tool armed. */
  selectionIsMode = false,
  imageSelected = false,
  textSelected = false,
  /** The app's host-tool registry, for the tools whose tap places. */
  hostTools: HostTools = NO_HOST_TOOLS,
  /** What the shell knows of a press under an `'against'` tool: whether the
   *  hit is the target OPEN for the tool (the pattern with the double
   *  border — a tap there stamps into its cell; every other pattern is an
   *  object), and whether the tap would JOIN what is there (filling a cell
   *  of a pattern, or landing edge-on against it — tileTool's
   *  tileTapJoinsPattern). Joining false means the tap would start from
   *  nothing, which is a drag's job, not a tap's. */
  against: { openTarget: boolean; joins: boolean } = NOT_AGAINST,
): CanvasTapAction {
  if (!tool) {
    return hitId === null && selectionIsMode && !editingText
      ? { kind: 'select', id: null }
      : { kind: 'none' };
  }
  const host = hostTool(hostTools, tool);
  // A tool that places AGAINST what is there stamps on the empty canvas and
  // into the target it has open — but any OTHER object under the finger
  // takes the press as a selection: a tap on a text, a shape, or another
  // pattern is aimed at that object, not at the cell it covers. (An editing
  // text still gets its dismissal tap first.)
  if (host?.tap === 'against') {
    if (editingText) return { kind: 'none' };
    if (hitId && !against.openTarget) return { kind: 'select', id: hitId };
    // …and a tap with nothing to place against clears the selection, the
    // way every other tool's empty-canvas tap does: a lone tap there is not
    // a placement at all — it is the gesture that means "put this away".
    return against.joins ? { kind: 'hostPlace', tool } : { kind: 'select', id: null };
  }
  // A tool that places ANYWHERE deals under every tap, hit or not. While it
  // is armed, a tap only ever places; selecting is the arrange tool's job.
  if (host?.tap === 'anywhere') {
    return editingText ? { kind: 'none' } : { kind: 'hostPlace', tool };
  }
  if (hitId) return { kind: 'select', id: hitId };
  if (editingText) return { kind: 'none' };
  if (tool === 'text') {
    return textSelected ? { kind: 'revertToArrange' } : { kind: 'addText' };
  }
  if (tool === 'photos') {
    return imageSelected ? { kind: 'revertToArrange' } : { kind: 'requestPhoto' };
  }
  if (host?.tap === 'onEmpty') return { kind: 'hostPlace', tool };
  return { kind: 'select', id: null };
}

/** No `'against'` facts: nothing open, nothing to join. */
const NOT_AGAINST = { openTarget: false, joins: false } as const;

/**
 * Does a press at (`cellX`, `cellY`) land inside a selection box as DRAWN —
 * its free rotation included? The box comes from `resolveSelectionBox` (single
 * selection) or `resolveMultiSelectionFrame` (combined; axis-aligned unless a
 * bound group is turned off the quarters), which are the same resolvers the
 * outline and the corner handles are drawn from: the region that answers true
 * is exactly the region the user sees framed.
 *
 * This is a RECTANGLE test, not a node one. The box is drawn by turning it
 * clockwise about its own centre, so the point is carried back through the
 * inverse of that turn — which is the turn by the negated angle about the
 * same centre — and then compared with the box plainly. It used to borrow
 * the engine's `unrotatePointForNode` by handing it a `{ ...box, angleDeg }`
 * object shaped like a node; the box is not a node, has no world matrix, and
 * that helper is going away with the last legacy pose reader (P5), so it
 * states its own turn instead, in the same matrix convention everything else
 * uses.
 */
export function selectionBoxHitsCell(
  box: CellBbox, angleDeg: number, cellX: number, cellY: number,
): boolean {
  let x = cellX, y = cellY;
  if (angleDeg) {
    const centre: [number, number] = [
      box.cellX + box.cellWidth / 2, box.cellY + box.cellHeight / 2,
    ];
    [x, y] = matApplyPoint(
      matAbout(centre, localMatrix({ ...LOCAL_IDENTITY, rotationDeg: -angleDeg })),
      cellX, cellY,
    );
  }
  return x >= box.cellX && x <= box.cellX + box.cellWidth
    && y >= box.cellY && y <= box.cellY + box.cellHeight;
}

// ── When a selection has to let the canvas go ────────────────────────
// A multi-selection claims its whole combined BOX: a press inside it drags
// the selection whatever tool is armed (CanvasSurface's beginMultiDrag).
// That is right for a selection you can see the edges of, and becomes a
// TRAP when you cannot — a group whose box covers the screen takes every
// press, so nothing can be drawn, and a settled tap re-selects it, since a
// plain group answers for its whole box (groupHit). A page CozyJournal
// shipped reached that state (its docs/reimagine_stuck_selection.md).
//
// So the PRESS claim is capped by how much of the screen the box covers.
// Past {@link SELECTION_CLAIM_MAX_COVERAGE} the selection lets go of it and
// presses go to the armed tool. Nothing is deselected and nothing is
// unreachable — a press ON a member still drags the whole group
// (beginHitSelectDrag promotes to it), the Rotate slider still turns it,
// and zooming out hands the box its claim straight back.
//
// The TWO-FINGER TWIST is deliberately NOT capped (CanvasSurface's
// multiManipulate). It was, and the cost was that turning a group stopped
// working the moment you zoomed in close enough to work on it: the gesture
// silently became a camera pinch. The reason it had been capped — two
// fingers being the only way to move the camera on touch — is answered
// instead by the multi-selection capsule's DONE, which ends the selection
// whatever size its box is (multiSelectionCapsule.ts), so the way out never
// depended on the zoom in the first place.

/**
 * How much of the screen a selection's box may cover and still claim the
 * presses that land inside it (0..1).
 *
 * Seven tenths, because what the cap has to leave is room to AIM: past
 * roughly two thirds there is not enough page outside the selection to
 * start a stroke in. Below it the selection is a thing on a page with page
 * around it, which is the case its whole-box claim was written for.
 */
export const SELECTION_CLAIM_MAX_COVERAGE = 0.7;

/** The lattice the coverage is measured on. Each point is asked whether the
 *  box as DRAWN covers it ({@link selectionBoxHitsCell}), so a turned box is
 *  measured exactly as it is seen and there is no second geometry to keep in
 *  step with the first. Odd, so the screen's centre is a sample; 7×7 puts the
 *  outermost ring a fourteenth of the way in, which is close enough to the
 *  edges that a box has to reach them to count as covering them. */
const COVERAGE_SAMPLES = 7;

/**
 * The fraction of the viewport a selection's box covers (0..1), sampled on
 * {@link COVERAGE_SAMPLES}².
 *
 * `toCell` carries a screen point into world cells through the caller's LIVE
 * camera — passed in rather than taken as a camera, so this module stays free
 * of the screen↔world convention (cameraMath) and the rule can be tested
 * without one.
 */
export function selectionViewportCoverage(
  box: CellBbox,
  angleDeg: number,
  toCell: (screenX: number, screenY: number) => { cellX: number; cellY: number },
  viewport: { width: number; height: number },
): number {
  if (!(viewport.width > 0) || !(viewport.height > 0)) return 0;
  let inside = 0;
  for (let row = 0; row < COVERAGE_SAMPLES; row++) {
    for (let col = 0; col < COVERAGE_SAMPLES; col++) {
      const { cellX, cellY } = toCell(
        (viewport.width * (col + 0.5)) / COVERAGE_SAMPLES,
        (viewport.height * (row + 0.5)) / COVERAGE_SAMPLES,
      );
      if (selectionBoxHitsCell(box, angleDeg, cellX, cellY)) inside++;
    }
  }
  return inside / (COVERAGE_SAMPLES * COVERAGE_SAMPLES);
}

/** Whether the selection has swallowed so much of the screen that it must
 *  let go of the gestures inside it — see the note above. */
export function selectionSwallowsCanvas(
  box: CellBbox,
  angleDeg: number,
  toCell: (screenX: number, screenY: number) => { cellX: number; cellY: number },
  viewport: { width: number; height: number },
): boolean {
  return selectionViewportCoverage(box, angleDeg, toCell, viewport)
    > SELECTION_CLAIM_MAX_COVERAGE;
}

/**
 * Does a press that landed inside the selection's box belong to the SELECTION
 * (move it) rather than to whatever the hit-test found there?
 *
 * The selection owns its box — that is what "selection and moving take
 * precedence" means — with one exception: an object drawn IN FRONT of it keeps
 * the press, so a sticker sitting on top of a selected full-bleed photo is
 * still reachable (without it, selecting a page-sized object would trap the
 * canvas: every press would move the photo and nothing else could be picked).
 *
 * Consulting the box rather than the hit-test alone is the whole point. A
 * hit-test walks front-to-back and a stroke-miss inside an SVG's bbox only
 * registers as a fallback, so anything BEHIND a drawn line — the page photo, a
 * frame's backdrop — claims a press aimed at the line's box and the armed
 * shape tool drew over the object the user meant to grab.
 */
export function selectionOwnsPress(opts: {
  /** Topmost hit-test result under the press, or null for empty canvas. */
  hitId: string | null;
  /** The node the selection box belongs to. */
  selectedId: string;
  /** Did the press land inside that box (see selectionBoxHitsCell)? */
  insideBox: boolean;
  /** Back-to-front paint order; an id missing from it counts as behind. */
  sceneOrder: readonly string[];
  /** An item drawn above the WHOLE scene under the press — a host layer's
   *  own thing (DrawBot's bot or arena border, the surface's `beforePick`)
   *  — or null/absent. See {@link frontItemTakesPress}. */
  frontId?: string | null;
}): boolean {
  const { hitId, selectedId, insideBox, sceneOrder } = opts;
  // An item a host layer draws in front of everything keeps the press, even
  // over the selected node itself (frontItemTakesPress).
  if (frontItemTakesPress(opts.frontId ?? null, [selectedId])) return false;
  // A press literally on the selected node is always its own, box or not (a
  // node can hang outside the box it is drawn from — a stroke that overflows
  // a simple line's straddle box).
  if (hitId === selectedId) return true;
  if (!insideBox) return false;
  if (hitId === null) return true;
  return sceneOrder.indexOf(hitId) <= sceneOrder.indexOf(selectedId);
}

/**
 * Does an item drawn in front of the whole scene take a press away from the
 * selection? A host layer (DrawBot's sim layer: a bot, the arena's border)
 * paints above every scene node, so by the same in-front rule as
 * {@link selectionOwnsPress} it keeps a press that lands on it — even inside
 * the box of a selected node BEHIND it, such as the bot's own trail sent to
 * the back (DrawBot's bug report 7e86ce9d). Unless it is itself (part of)
 * the selection: then the press is the selection's as ever.
 */
export function frontItemTakesPress(frontId: string | null, selectedIds: readonly string[]): boolean {
  return frontId !== null && !selectedIds.includes(frontId);
}

/**
 * Does an armed `tool` yield a press on the current selection to it — moving
 * the object instead of doing the tool's own thing?
 *
 * Every tool that would otherwise CREATE something under the finger yields:
 * with a shape selected, dragging across it moves it rather than drawing a
 * line, a stroke or a placement box over it, exactly as it would under
 * 'arrange'. Reaching the object no longer costs a trip back to the selection
 * tool, which is the point of selecting without disarming (see `select`).
 *
 * The color group is the exception, push included. There a selection is the
 * brush's FILTER (`paintFilterIds`) — you select an object precisely so the
 * brush may only touch that object — so a press on it has to keep working.
 * Their corner handles stay grabbable; only the body of the box is theirs,
 * not the selection's.
 *
 * A HOST tool that places `'anywhere'` or `'against'` (hostTools.ts) does
 * not yield either: the Pattern tile must fill the cell under the finger —
 * usually right against the selected thing — not move the selection, and
 * CozyJournal's Word must deal a magnet wherever the tap lands, including
 * on the (selected) word it just dealt, not grab it. One that places
 * `'onEmpty'`, or places nothing, yields like a shape tool.
 */
export function toolYieldsToSelection(tool: string | null, hostTools: HostTools = NO_HOST_TOOLS): boolean {
  // No tool: the canvas is view-only and a press only pans (see
  // resolveCanvasTap), so there is nothing to yield.
  if (!tool) return false;
  const tap = hostTool(hostTools, tool)?.tap;
  if (tap === 'anywhere' || tap === 'against') return false;
  // The pattern tool is with the brushes: a press on a selected pattern
  // must PAINT its tiles, not move it (moving is the arrange tool's job).
  return tool !== 'color' && tool !== 'paint' && tool !== 'erase' && tool !== 'blur'
    && tool !== 'push' && tool !== 'pattern';
}

// Smallest dragged-box extent (world cells, per axis) that commits a
// drag-to-place: anything under this settles as a tap instead, so a wobbly
// press doesn't mint a sliver-sized image or text box. At the default zoom
// (16 px/cell) this is an ~8 px drag — comfortably past the 4 px tap slop.
export const PLACE_BOX_MIN_CELLS = 0.5;

/**
 * Normalize the two corners of a photos/text-tool drag into the bounding box
 * the new node will occupy, or null when the drag is too small in either axis
 * to be an intentional placement (the caller falls back to tap routing).
 */
export function dragCellBbox(
  start: readonly [number, number],
  end: readonly [number, number],
  minCells: number = PLACE_BOX_MIN_CELLS,
): CellBbox | null {
  const cellWidth = Math.abs(end[0] - start[0]);
  const cellHeight = Math.abs(end[1] - start[1]);
  if (cellWidth < minCells || cellHeight < minCells) return null;
  return {
    cellX: Math.min(start[0], end[0]),
    cellY: Math.min(start[1], end[1]),
    cellWidth,
    cellHeight,
  };
}

/** Second tap on the same text within this many ms = a DOUBLE tap, which
 *  selects the text's whole content (the text-editing convention
 *  everywhere else). Same window the outline rows use (DOUBLE_TAP_MS). */
export const TEXT_DOUBLE_TAP_MS = 300;

/**
 * Was the press at `now` on text `id` the second half of a double tap?
 * `last` is the previous settled tap / caret press on a node (the canvas
 * records both: the tap that OPENS the editor and every caret press in
 * it, so select-tap→tap and caret-tap→tap both read as doubles).
 *
 * The rule is the chrome's `secondTapWithin`, as the pattern tile's and
 * the locked capsule segment's are (this was the third copy of the same
 * three lines; DrawBot folded it in). The WINDOW is this control's. One
 * behaviour change with it, the same one the pattern tile took: the
 * boundary is inclusive, so a second press exactly 300 ms after the first
 * is a double tap rather than a miss.
 */
export function isTextDoubleTap(
  last: TapRecord | null,
  id: string,
  now: number,
): boolean {
  return secondTapWithin(last, id, now, TEXT_DOUBLE_TAP_MS);
}

// What a settled tap (no drag) that landed on an existing scene node does,
// once selection has been resolved. This is the SECOND-tap decision: the first
// tap on a node selects it; tapping it again (while it is already the
// selection) is the affordance that opens content editing.
export type NodeTapAction =
  | { kind: 'editText' } // re-tap on an editable text → open its content editor
  | { kind: 'default' }; // first tap, or a non-text node → fall through (photo-replace probe)

/**
 * Decide what a settled node tap does from whether the node was already
 * selected before this tap and whether it is an editable text object.
 *
 * A re-tap (the node was already the selection) on an editable text opens the
 * text-content edit flow. Every other node tap — a first tap that merely
 * selected the node, or a tap on a non-editable / non-text node — is the
 * default, leaving the shell's placeholder-replace probe untouched.
 *
 * …except in the modes that only SELECT — Move and Rotate — where nothing
 * opens at all. Move's whole promise is that a press moves the thing under
 * it and does nothing else: it takes the corner handles away
 * (arrangeModeNoScale) so a grab cannot scale, and a second tap that
 * dropped the reader into a text's content editor — or, the same gesture,
 * into a pattern's grid — broke the same promise from the other side.
 * Arranging a page means tapping the same object repeatedly, which is
 * exactly the shape of the gesture that opens one. Rotate says the same
 * thing about its own one-finger press (the slider and the two-finger
 * twist are what turn the object), so it refuses the same openings.
 */
export function resolveNodeTap(opts: {
  wasSelected: boolean;
  isEditableText: boolean;
  /** The selection tool is in a mode whose press only ever SELECTS —
   *  Move or Rotate (toolbarMeta.arrangeModeMoveOnly /
   *  arrangeModeRotateOnly). */
  selectsOnly?: boolean;
}): NodeTapAction {
  if (opts.selectsOnly) return { kind: 'default' };
  if (opts.wasSelected && opts.isEditableText) return { kind: 'editText' };
  return { kind: 'default' };
}

/**
 * Was `id` already held by the selection when this tap landed — the
 * "already the selection" half of {@link resolveNodeTap}?
 *
 * A single selection holds the node it names. A GROUP selection holds
 * every member: a tap on a grouped node selects the whole group (the
 * promotion in `select`), so the leaf under the finger never becomes
 * `selectedId` and a second tap on it would otherwise read as a first
 * tap forever. That is what made a text inside a group impossible to
 * open — the group is the unit the canvas selects, so a member of the
 * selected group IS selected in the only sense the canvas offers.
 *
 * A marquee or shift-tap multi-selection of LOOSE nodes is deliberately
 * not the same thing. Tapping one of those narrows the selection down to
 * it, so that tap is a first tap on that node and must not also open it;
 * only a grouped id counts through `selectedIds`.
 */
export function selectionHoldsNode(
  selection: Selection, id: string, grouped: boolean,
): boolean {
  if (selection.selectedId === id) return true;
  return grouped && selectionContains(selection, id);
}

/** The live selection, in either of its two shapes. */
export interface Selection {
  selectedId: string | null;
  selectedIds: readonly string[];
}

/** Is `id` in the live selection at all — as the single selection or as
 *  one of a multi? The plain membership question, for callers that treat
 *  every multi alike (the two-finger gesture, which manipulates whatever
 *  unit is selected). {@link selectionHoldsNode} is the narrower one. */
export function selectionContains(selection: Selection, id: string): boolean {
  return selection.selectedId === id || selection.selectedIds.includes(id);
}

/**
 * The image a one-finger drag REFRAMES rather than moves — the bitmap
 * panned inside its frame — or null when no drag does. Two doors in: the
 * Crop page open over the single selected, unlocked image
 * (`cropPageImageId`), or that image double-tapped into reframing mode
 * (`editingImageId`). The page's door is tried first, as it always was: the
 * bar is up, so the bar's image is the one being framed.
 *
 * …and ONE tool that shuts both: a brush. A brush's press is a dab and its
 * drag a stroke, wherever they land, so while one of the five is armed
 * (`brushArmed` — EditorShell's brushToolActive, isBrushToolId) the crop's
 * pan and its two-finger pinch stand down, and the double ring with them.
 * The canvas arms the crop gesture BEFORE any tool branch can claim the
 * press, so without this a paint stroke over a photo open for reframing
 * panned the picture about inside its frame and laid no paint at all —
 * which read as "painting an image changes its framing" (bug report
 * 86ae37ee). The mode itself is kept, not closed: disarm the brush and the
 * ring is back, the image still open where it was left.
 */
export function imageFramingTarget(args: {
  brushArmed: boolean;
  cropPageImageId: string | null;
  editingImageId: string | null;
}): string | null {
  if (args.brushArmed) return null;
  return args.cropPageImageId ?? args.editingImageId;
}
