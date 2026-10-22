import type React from 'react';
import type { Camera, CompositionState, Viewport } from '@/engine/types';
import type { LegacyLeaf } from '@/engine/sceneGraph';
import type { SessionEntry } from '../editorSession';
import type { DrawnLeaf } from '../drawnPose';
import type { CellBbox } from '../resizeMath';

// The CANVAS seam of the shared editor (docs/shared-editor.md §4.1,
// "Layers drawn over the canvas, and the gestures a host claims"): what an
// app plugs into `CanvasSurface` — the presses it claims, the DOM it draws
// per scene node, its own per-node records, and the two-finger twist.
//
// ADOPTED, NOT DESIGNED (§4.3, "The canvas seam is DrawBot's, adopted
// whole"). DrawBot had already shipped `GestureHooks` and
// `CanvasSurfaceHandle` in its own `web/editor/components/canvasHooks.ts`,
// and CozyJournal's rig — a whole gesture mode woven through the canvas by
// hand — maps onto them member for member: its `beginRigPose` IS
// `onPointerDown` returning a claim, its `case 'rigPose'` move arm IS
// `onPointerMove`, `finishRigPose` IS `onPointerUp`, and the hold that
// abandons a pose grab IS `holdOpensMenu`. This reverses the plan's usual
// direction, and the rule is worth stating: the canonical-copy rule
// (CozyJournal's text wins) governs a file's CONTENTS, not a seam's
// DESIGN. DrawBot was the app forced to invent this interface, because its
// sim layer needed presses; CozyJournal never was.
//
// Two widenings came with the adoption, both of which SHRINK the canvas
// rather than grow it:
//
//  · `onPointerUp` ends with a three-state `PointerEnd` where DrawBot's
//    took a `cancelled` boolean. DrawBot discards a claimed press when a
//    second finger arrives; the rig commits a pose that moved. Only the
//    host knows how to settle a takeover, so the surface says which of the
//    three endings this is and stops guessing.
//  · `prevSelection` rides on the CLAIM. A claimed press can select
//    (DrawBot's bot drag and the rig's joint grab both do), and a second
//    finger — the camera's gesture — has to put the selection back; the
//    canvas carried that bookkeeping in three separate gesture branches.
//
// Two more came out of wiring the rig's hooks up (5b.2): `claimAt`, below,
// because the two apps' claims do not sit in the same place in the press
// router; and `onPointerUp` drops the React event, because the surface has
// none to give for a stale-pointer heal or a page backgrounded mid-touch,
// and neither app's hook ever read it.
//
// What is NOT here: `overlay?(session, camera)`, which the plan once
// designed for this row and which is dropped. The one thing it was for is
// mounted by the shell (stage 6), and the canvas's real overlay mechanism
// is `CanvasSurfaceHandle.layerSlot` — imperative by design, because Sol's
// architecture §9.2 and DrawBot's §10.3 both forbid React state per frame.
//
// Where each member is wired follows the plan's own rule (§4.3): an
// installed RULE goes on the `EditorExtension`, per-render DATA rides as a
// prop, the way the panel's host pages ride on `PanelModelInput` rather
// than the extension. So `records` and `twist` are installed once at
// module scope (`installCanvasHost`, beside `installSessionHost` and
// `installOutlineHost`), and `GestureHooks` / `CanvasLayers` are props of
// `CanvasSurface`: both close over state only the shell holds — DrawBot's
// `useSimEditor()`, Sol's per-render plant plan and its rasters' oversample.

/** What stood selected before a press selected something else, so a
 *  gesture the camera takes over can put it back. */
export type PriorSelection = { selectedId: string | null; selectedIds: string[] };

/**
 * How a claimed press ended, which is the host's cue for what to do with
 * what it was doing:
 *
 *  · `release` — the finger lifted. The gesture did what it was for (the
 *    rig bakes the pose it was dragging).
 *  · `takeover` — a SECOND finger arrived, so the pair is a two-finger
 *    gesture now and the claimed finger's moves stop feeding the hook. A
 *    host that has already changed what is on screen settles it (the rig
 *    commits a pose that moved); one that has not abandons it.
 *  · `cancel` — the press is void: a `pointercancel` (a system gesture
 *    took the finger), or the surface pulling the claim back because a
 *    stationary hold opened the radial menu instead (`holdOpensMenu`).
 *    Nothing the press was doing survives.
 */
export type PointerEnd = 'release' | 'takeover' | 'cancel';

/**
 * A press the host's `onPointerDown` hook has CLAIMED. The press is the
 * hook's for its whole life: the surface routes its moves and its ending
 * to the hooks and runs none of its own gesture machinery for it.
 */
export interface PointerClaim {
  /** What stood selected before this press, when the claim SELECTED
   *  something (grabbing a rig's joint is grabbing that figure; so is
   *  grabbing a bot). Left out when the claim selected nothing. A
   *  `takeover` puts it back — two fingers must never pick an object
   *  nobody had tapped. */
  prevSelection?: PriorSelection;
}

/**
 * One-finger gesture hooks, in surface pixels (the same space
 * `localPoint` reports: the container's top-left is 0,0). A press the
 * `onPointerDown` hook CLAIMS (returns a claim rather than null) is the
 * hook's for its whole life — the surface routes its moves and its end to
 * the hooks and runs none of its own gesture machinery for that pointer. A
 * press it declines falls through to the surface's own handling.
 *
 * Two-finger pan/zoom is never offered: the camera stays the surface's.
 * The one two-finger gesture a host has a say in is the TWIST, which is a
 * seam of its own below (`CanvasTwist`) because it is not a claim at all —
 * the surface drives it and asks the host what it means.
 */
export interface GestureHooks {
  /**
   * WHERE in the press router the surface offers a press to
   * `onPointerDown`. The two apps' claims do not sit in the same place and
   * neither can move to the other's — the third widening the adoption
   * needed, and the one §4.3's member-for-member mapping passed over:
   *
   *  · `'press'` (the default, DrawBot's) — FIRST, before the surface
   *    reads anything else about the press: ahead of the input lock, the
   *    done-page gate, the caret and every tool. DrawBot's bots and its
   *    arena are armed by their own tool and the claim has to beat the
   *    running simulation's lock, so nothing may precede it.
   *  · `'grab'` — inside the SELECT tool only, after the selection's own
   *    grabs (a corner handle, a multi-selection's combined box) and
   *    before the scene is hit-tested. CozyJournal's rig joints are a grab
   *    on an object like any other: offered the press first they would
   *    swallow a brush stroke, a shift-click, and the corner handles of
   *    the very figure they belong to.
   */
  claimAt?: 'press' | 'grab';
  onPointerDown?: (x: number, y: number, e: React.PointerEvent) => PointerClaim | null;
  onPointerMove?: (x: number, y: number, e: React.PointerEvent) => void;
  /** No event: the surface must be able to end a claim when it has none —
   *  a stale-pointer heal, a page backgrounded mid-touch, a hold that
   *  handed the touch to the radial menu — and neither app's hook reads
   *  one (DrawBot's own implementation already drops the parameter). */
  onPointerUp?: (x: number, y: number, end: PointerEnd) => void;
  /** Asked right after a claim: does a stationary hold on this press open
   *  the long-press radial menu? When it fires, the surface cancels the
   *  claim (`onPointerUp` with `cancel`) and the menu owns the touch.
   *  Without it a host's own thing would be the one object on the page a
   *  hold could never open the quick actions on — a rig's joint knobs
   *  cover most of its body, and a bot is all of itself. */
  holdOpensMenu?: () => boolean;
  /**
   * A multi-selection gesture in flight — a drag, a twist, a corner resize
   * — and the entry its release would commit, so a host layer can draw the
   * selection's own things where it would put them (DrawBot's bots and
   * instruction tiles ride a mixed group under the finger with the
   * shapes). `entry` is null when the gesture ends.
   *
   * Per pointer move, so the entry comes as a THUNK and the ids beside it:
   * whether this gesture moves anything of the host's is the host's own
   * question — which of these ids are its, and whether any of its items
   * rides a group among them — and only the host can answer it without
   * building the entry first. A gesture over shapes alone then costs the
   * hook one predicate and no reducer pass. DrawBot's canvas had that gate
   * written out in front of the call; it belongs behind it.
   *
   * The FIFTH widening of the adopted seam (§4.3), and the same kind as
   * the other four: the surface hands the host what it needs to answer
   * rather than deciding on its behalf. DrawBot's took a built
   * `SessionEntry | null` alone.
   */
  previewSelectionEntry?: (
    ids: readonly string[], entry: (() => SessionEntry | null) | null,
  ) => void;
  /**
   * What the host has under the finger, IN FRONT OF every scene node, in
   * surface pixels — asked before the scene is hit-tested. A string is the
   * id to select (the tap is spent on it, and the selection grabs below
   * yield to it); null lets the press fall through to the scene.
   *
   * Not a claim: the host's thing is being SELECTED here, not driven, and
   * the gestures that follow are the canvas's own. DrawBot's bot hit test
   * is the one that needs it — its tiles and bots draw over the scene, so
   * a tap on one must not reach the shape underneath — and it shipped this
   * as a prop beside `GestureHooks` rather than a member of it. Adopted
   * into the interface (stage 5b.1): it is a question the surface asks the
   * host while deciding a press, which is what this interface is, and one
   * home beats two.
   */
  beforePick?: (x: number, y: number) => string | null;
}

/**
 * What the surface hands a layer that draws over it every frame. Read
 * per frame, never per render: the live camera is the one the surface's
 * own two-finger gesture is moving, ahead of the committed `state.camera`
 * — exactly what a screen-space overlay must draw against.
 */
export interface CanvasSurfaceHandle {
  getLiveCamera(): Camera;
  getViewport(): Viewport;
  /** The scene node whose DRAWN pixels lie under surface (x, y) — no box
   *  of a group, a selection or a line's bbox counts; frame backgrounds
   *  excluded; null over empty canvas. Lets a placing tool step aside for
   *  a tap ON an object and still build in a wiggly line's empty box.
   *
   *  Always offered, where DrawBot's was optional: the pick is seven lines
   *  beside the selection's own `hitTestAt`, differing only in asking the
   *  engine for pixels rather than for what is selectable, so the package
   *  keeps both and exposes both (§4.3). Host-side was the alternative and
   *  is worse — a host implementing it would be a second copy of the hit
   *  test beside the package's, which is the drift the plan exists to
   *  end. */
  pixelHitAt(x: number, y: number): string | null;
  /** The screen-space element a host layer mounts into: the container's
   *  last child, over the world layer, pointer-inert. */
  layerSlot: HTMLDivElement | null;
}

/** One scene node as the host's layer hook is asked about it: everything
 *  the three apps' own layers draw from that is the CANVAS's to know. What
 *  is the HOST's — Sol's plant composites and their raster oversample,
 *  CozyJournal's pose records — the hook closes over, which is why
 *  `CanvasLayers` is a prop and not an installed rule. */
export interface HostNodeLayerInput {
  readonly id: string;
  readonly kind: 'svg' | 'image' | 'text' | 'paint' | 'pattern';
  /** The legacy per-kind object, previewed where a resize is in flight —
   *  the same object the standard layer would be drawn from. */
  readonly node: LegacyLeaf;
  /** Its graph node and world matrix, identity-stable across a render
   *  that moved nothing, which is what lets a memoized layer skip it. */
  readonly drawn: DrawnLeaf;
  /** The page's stroke scale, which every svg layer draws lines by. */
  readonly strokeScale: number;
  /** The zoom the page is drawn at, and the device pixel ratio: what a
   *  host raster sizes itself from. */
  readonly zoom: number;
  readonly dpr: number;
  /** Is a gesture or a camera tween in flight? A host raster is never
   *  regenerated on those frames (Sol's architecture §9.2 rule 4). */
  isBusy(): boolean;
}

/**
 * The host's own DOM inside the world layer, per scene node.
 *
 * Three uses, all three of the shape below: CozyJournal's rig figure
 * renders as a live WebGL sketch seated on its bbox instead of the baked
 * svg; Sol's plant draws as ONE composite element in place of every leaf
 * it absorbs, and a seed's marker wears its strain's initial.
 */
export interface CanvasLayers {
  /**
   * The host's element for this node, or:
   *
   *  · `undefined` — none of the host's: the package's own node layer
   *    draws it. **The hook must answer this by asking about its own
   *    DATA**, never by what the node's kind happens to be: a hook that
   *    says "not mine" for every svg on a page that holds a rig is
   *    answering a different question, and the rig stops drawing.
   *  · `null` — the host's, and it draws NOTHING here (Sol's leaves
   *    absorbed into a plant's composite; the composite renders once, in
   *    the first absorbed leaf's place, so the plant keeps its z-order
   *    among the loose nodes around it).
   *
   * Asked BEFORE the hidden check, so a host can keep its own thing
   * mounted while the page hides it: CozyJournal's rig paints itself
   * invisible rather than unmounting, which is what keeps its GL context.
   */
  nodeLayer?(node: HostNodeLayerInput): React.ReactNode | undefined;
}

/**
 * The host's per-node RECORDS, reached as a predicate rather than as a map
 * (§4.3): CozyJournal keeps each rig's pose, colours and roll on a hidden
 * record beside the figure, and the canvas asks questions of it and never
 * reads it. Resolved ONCE per render over the committed state, the way the
 * outline host's node reader is per build, so a host that has to walk the
 * page for its own kinds (`findRigs`) walks it once.
 */
export interface CanvasRecords {
  /**
   * Does the host hold a record for `nodeId`? Two rules read this and
   * nothing else, and both are about a selection that is a MODE rather
   * than an object in hand:
   *
   *  · `resolveCanvasTap`'s `selectionIsMode` — tapping off such a
   *    selection clears it even with the toolbar untoggled.
   *  · the raster brushes' dimming veil, which such a selection does not
   *    raise: it rides along while other work happens, and painting with
   *    the whole canvas held dark behind it read as a stuck overlay.
   */
  has(nodeId: string): boolean;
}

/**
 * The TWO-FINGER TWIST — the one object gesture the surface keeps when a
 * second finger lands, and the one `GestureHooks` deliberately withholds:
 * the pair is the camera's by default, so the host does not claim it, it
 * answers questions about it.
 *
 * TWO apps need this independently, which is why it is a seam and not the
 * rig's own branch. CozyJournal's rig twists by ROLLING THE FIGURE inside
 * its viewport rather than turning its box — the silhouette genuinely
 * re-projects, so no one box is true for the gesture — and DrawBot's bot
 * decides whether a lone selection twists at all (a bot that never moves
 * has no heading to turn) and how big the grip for it is (a bot is a cell
 * across, no room for two fingertips).
 */
export interface CanvasTwist<TDoc = unknown> {
  /** A lone selected HOST ITEM that twists as a unit of one — turned about
   *  its own centre by the same multi builder, so a grid bot lands on a
   *  quarter turn. Its id, or null for a selection this does not apply to
   *  (which leaves the fingers to the camera). */
  loneUnit?(doc: TDoc | undefined, selectedId: string | null): string | null;
  /** `bbox` grown to a box two fingertips can both land in at this zoom,
   *  for a `loneUnit`'s twist. A cell-wide thing's own box is smaller than
   *  the pair that would turn it. */
  grip?(bbox: CellBbox, pxPerCell: number): CellBbox;
  /**
   * How a twist of `nodeId` works when it is the HOST's rather than the
   * scene's, or null for an ordinary node — which the canvas turns its own
   * way, by rotating the element and committing `buildManipulateNode`.
   *
   * Resolved ONCE, at the press, and carried on the gesture: the four
   * things the canvas has to do differently for a host's node are then
   * one object rather than four optional calls, and the question "is this
   * one of mine?" is asked once, of the host's own DATA.
   */
  node?(state: CompositionState, nodeId: string): HostNodeTwist | null;
}

/** A host node's twist, resolved at the press (`CanvasTwist.node`) and
 *  closed over that node. */
export interface HostNodeTwist {
  /** The angle the gesture starts from, in place of the scene's
   *  `worldTurnDeg`. A rig's is its record's ROLL: the builder turns to an
   *  ABSOLUTE angle, so the gesture has to start from the same reading it
   *  commits to. */
  readonly startDeg: number;
  /** Drive the live twist to `angleDeg`, per pointer move, through the
   *  host's own imperative channel (a layer handle, an inline transform) —
   *  never React state, and never the node's box: a rig turns INSIDE its
   *  box, which stands still. */
  preview(angleDeg: number): void;
  /** Put the node back on its committed reading — a cancel, or a twist
   *  that ends where it began. React writes that transform from the
   *  record, but its reconciler skips DOM writes for props unchanged since
   *  the last render, so the gesture that made the live write has to undo
   *  it. */
  reset(): void;
  /** The entry the twist commits, or null when it changes nothing. */
  commit(state: CompositionState, angleDeg: number): SessionEntry | null;
}

/** What an app supplies the shared canvas as installed RULES. The canvas's
 *  other two seams are props (see this file's head): the gesture hooks and
 *  the host's node layers both close over per-render state the shell
 *  holds. */
export interface CanvasHost<TDoc = unknown> {
  /** The host's reading of this page's own kinds, or null when it has none
   *  on the page. Called once per render. */
  records?(state: CompositionState): CanvasRecords | null;
  /** What a two-finger twist means for the host's own things. */
  twist?: CanvasTwist<TDoc>;
}

const NONE: CanvasHost = {};
let installed: CanvasHost = NONE;

/** Install the app's canvas host (or, with null, none). Called once at
 *  module scope by the app's extension module; a test installs its own and
 *  clears it after. */
export function installCanvasHost(host: CanvasHost<never> | CanvasHost | null): void {
  installed = (host as CanvasHost | null) ?? NONE;
}

/** The installed host — every member optional. */
export function canvasHost<TDoc = unknown>(): CanvasHost<TDoc> {
  return installed as CanvasHost<TDoc>;
}

/** Tests only. */
export function clearCanvasHost(): void {
  installed = NONE;
}
