import {
  CompositionFigure,
  CompUndoEntry,
  CompUndoOp,
  CompositionState,
  GroupNode,
  ImageFraming,
  ImageMimeType,
  ImageObject,
  ImageTint,
  ImagePaintOverlay,
  ImageTintFill,
  NodeEffects,
  Paint,
  PaintObject,
  PaintStrokeDraft,
  BorderPosition,
  PathSegment,
  PatternObject,
  PatternSymmetry,
  ShapePatternFill,
  RGBColor,
  ShapeFill,
  SVGEndpoints,
  SVGObject,
  SVGStroke,
  TextObject,
  TextStyle,
  type CompItemKind,
} from '@/engine/types';
import {
  allDescendantMemberIds,
  applyCompOps,
  applySceneOrder,
  buildDuplicateOps,
  buildPaintStrokeOps,
  buildRemoveObjectOp,
  buildRemoveObjectOps,
  captureSceneOrder,
  detachFromGroup,
  computeDuplicateOffset,
  computeGroupHiddenToggle,
  CompItemRef,
  computeSVGBbox,
  descendantGroupIds,
  findItem,
  findRootGroupId,
  getItemGroupId,
  groupAncestorChain,
  isGroupChainLocked,
  isItemHidden,
  isItemLocked,
  reorderSceneObjects,
  revertCompOps,
  SCENE_ADAPTERS,
  ungroupCreationBox,
  withGroupPruning,
  withSceneGraph,
} from '@/engine/compositionOps';
import {
  type SceneGraph, getNode, graphDescribes, regraphChangedLeaves, worldMatrix,
} from '@/engine/sceneGraph';
import {
  type Bbox, type Mat2D, decomposeMatrix, matAbout, matApplyCorners, matApplyPoint, matMul,
  matTranslate, normalizeDeg,
} from '@/engine/sceneTransform';
import { localContentBox, localHitObject } from '@/engine/sceneHitFrame';
import {
  localBoxForDrawnResize, localLeafToWorld, rescaleLeafLocal,
} from '@/engine/sceneLocalResize';
import {
  aboutPoint, boxToBoxGesture, buildGestureEntry, dragDelta, drawnBox, graphOf, mirrorAbout,
  mirrorLinear, resizeBox, selectionRoots, signedDeg, twistAbout, worldCentre, worldTurnDeg,
} from './transformGestures';
import { buildFrameRectMap, frameGroupIdForNode } from '@/engine/compositionFrame';
import {
  effectivePatternCellColor,
  mintPatternObjectId,
  patternClearEdits,
  patternFloodEdits,
  patternInkColor,
  patternReconcileEdits,
  patternRecolorEdits,
  tintedPatternCell,
  type PatternCellEdit,
  type PatternSubTool,
} from '@/engine/patternObject';
import { patternSVGView } from '@/engine/patternObjectRender';
import { clonePathSegment } from '@/engine/pathSegmentUtils';
import { patternPatchName, patternPatchOutlines } from './patternPatches';
import { cellStatesEqual } from '@/engine/connectivity';
import { FADE_DEFAULT_COLOR } from '@/engine/fade';
import {
  bakeFadeIntoImageObject,
  bakeFadeIntoPattern,
  bakeFadeIntoSVGObject,
  bakeFadeIntoTextStyle,
} from '@/engine/fadeBake';
import { textInkOutset } from '@/engine/textArc';
import { buildUnionEntry, canUnionSelection } from '@/engine/compositionGeometricUnion';
import {
  buildMergeEntry, buildMergePaintEntry, canMergePaintSelection, canMergeSelection,
} from '@/engine/compositionMergeObjects';
import { nextGroupName } from '@/engine/sceneOutlineHelpers';
import { isTagName } from '@/engine/compositionOps';
import { PATTERN_SYMMETRY_OFF } from '@/engine/types';
import { worldSnapshot } from '@/engine/worldSnapshot';
// The host's seam: a parallel document moved by the same undo step, the
// host's own selectable items, and its rules about nodes of its own kind
// (sessionHost.ts; docs/shared-editor.md §4.1).
import {
  type HostItems, type HostPaintTargets, sessionHost,
} from './sessionHost';
// What a ghost is DRAWN as: the Copies preview poses its copies through the
// same reading the node layers use, so a copy inside a group is ghosted
// where its group puts it (transformCopyGhosts).
import { drawnLeaf, drawnLeafOf, type DrawnLeaf } from './drawnPose';
import {
  polygonIsHeart, polygonIsQuarterCircle, polygonIsQuarterTorus, polygonIsRightTriangle, polygonIsSemiTorus,
  polygonIsSemicircle, polygonIsSpiral, polygonIsStar,
} from '@/editor/components/toolbarMeta';
import { svgStrokeWidthCells, svgSubtype, type SVGSubtype } from '@/engine/svgStroke';
import { svgEnclosesArea, svgIsFilled } from '@/engine/svgPathBuilder';
import { BASE_CELL_PX } from './cameraMath';
// Pure subtype table (no react-native), so the reducer and the properties
// panel can't disagree about which shapes have an interior to fill.
import { svgHasFill } from '@/editor-ui/logic/svgEdit';
import { alignAxis, alignedStart, alignPosition, gridPlacements } from '@/editor-ui/logic/layout';
import { copyInkStep } from '@/editor-ui/logic/transform';
import type { AlignEdge } from '@/editor-ui/adapter';
import {
  computeEllipsePolyline, computeOvalSegments, computeQuarterArcSegments,
  isCircleSegments, pickCenter,
} from '@/engine/compositionArcMath';
import {
  computeLineVertices,
  computeRectSegments,
  computeHeartSegments,
  computeQuarterCircleSegments,
  computeQuarterTorusSegments,
  computeStarSegments,
  computeRegularPolygonSegments,
  computeRightTriangleSegments,
  computeSemiTorusSegments,
  computeSemicircleSegments,
  computeSpiralSegments,
  detectLineDirection,
} from '@/engine/compositionLineBboxMath';
import { compSnapStep } from '@/engine/compositionCellMath';
import {
  buildShapePatternFill, clampShapePatternSize, resizeShapePatternFill,
  setShapePatternSpan, shapePatternGrid, shapePatternStrokeWidthCells,
} from '@/engine/shapePatternFill';
import { paintOverlayHasInk } from '@/engine/imagePaintOverlay';
import { commitCanvasPaint, paintTilesContentRect } from '@/engine/canvasPaint';
import {
  createPaintObjectFromTiles, growPaintObjectToContent, mintPaintObjectId,
} from '@/engine/paintObject';
import {
  type ColorScope, type ColorSurface,
  ANY_COLOR_PRIORITY, COLOR_SURFACES, colorScopeReaches,
  DEFAULT_COLOR_SCOPE, ObjectColorState, PaintObjectStrokeState,
  shapeFillSolidColor, touchedPaintTargets,
} from './paintBrush';
import {
  clampPanOffset, COVER_FRAMING, resolveFraming, straightenCoverScale,
} from '@/engine/imageFraming';
import { GEOMETRY_ADAPTERS } from '@/engine/sceneNodeGeometry';
import { buildShapeSVGObject, ShapePresetKind, ShapePresetOptions } from '@/engine/shapePresets';
import { DEFAULT_LINE_HEIGHT, measureTextBbox, TextLayoutOptions } from '@/engine/textLayout';
import {
  type CellBbox, MIN_ARC_CELLS, NO_RESIZE_FLIP, type ResizeFlip, rotatedAabb, sameBbox,
} from '@/editor/resizeMath';
import { toRGB } from './activeColor';

// PURE editor session reducer (no DOM). The UI layer owns gestures and
// rendering; every document mutation flows through `commit` as an engine
// CompUndoEntry so undo/redo is exact op replay (CozyJournal's
// CozyJournal.md §4.1).
//
// Three type parameters carry the APP's types through without the package
// knowing them (docs/shared-editor.md §4.3): `TTool` is the app's closed
// tool-id union (the standard ids plus its own), `TDoc` its parallel
// document and `TOps` the record one undo step keeps of that document
// (sessionHost.ts). An app with no parallel document leaves the last two at
// their defaults and `hostDoc` undefined.

export interface EditorSession<TTool extends string = string, TDoc = unknown, TOps = unknown> {
  state: CompositionState;
  undoStack: CompUndoEntry[];
  redoStack: CompUndoEntry[];
  /** The host's parallel document beside the composition — Sol's cards,
   *  strains and seeds; DrawBot's arena, bots and tiles. Immutable like
   *  `state` (a save queue may gate on it by reference); `undefined` for an
   *  app without one. Moved by `commit`, `undo` and `redo` through the
   *  installed host's `ops` (sessionHost.ts). */
  hostDoc: TDoc;
  /** Index-aligned with `undoStack`: `hostUndoStack[i]` is the host half of
   *  `undoStack[i]`, or null when that step carried none. An entry of host
   *  ops ALONE pushes an empty engine entry (a legal, empty CompUndoEntry),
   *  so every reader of the engine stacks stays untouched; `commit`, `undo`
   *  and `redo` keep the two pairs the same length. */
  hostUndoStack: (TOps | null)[];
  /** Likewise with `redoStack`. */
  hostRedoStack: (TOps | null)[];
  selectedId: string | null;
  /** Multi-selection (the arrange tool's marquee drag). Either empty, or 2+
   *  leaf node ids — never one: {@link selectMany} collapses a single id into
   *  `selectedId`, so every consumer can key "multi mode" off length >= 2.
   *  Mutually exclusive with `selectedId` (null while this is populated). */
  selectedIds: string[];
  /** The lit tool button, or `null` when every tool is untoggled — a real
   *  state, not a missing one: with no tool the canvas only pans and zooms
   *  (see setTool, resolveCanvasTap, and CanvasSurface's gesture router). */
  activeTool: TTool | null;
  /**
   * True when there are COMMITS not yet flushed to persistence.
   *
   * Not the save gate, and must not be used as one: the non-undoable
   * `withState` path swaps in state the canvas renders without a commit, so
   * this stays false while the page has genuinely changed. Gating the write
   * on it left the stored record — and the entry thumbnail rasterized from
   * it — a full edit behind the canvas. pageSaveQueue.ts keys the write on
   * the state object itself instead; this flag is bookkeeping the queue
   * clears once a write lands.
   */
  dirty: boolean;
}

/** A builder result: the ops to commit, the id of any freshly minted node
 *  (so the UI can select it), and image bytes to merge alongside. */
export interface SessionEntry<TOps = unknown> {
  entry: CompUndoEntry;
  id?: string;
  /** The host half of the step (sessionHost.ts `HostOps`): Sol's ops on its
   *  document, DrawBot's {before, after} swap of its sim document. Applied
   *  after the engine ops and reverted with them, one undo step. An entry
   *  may carry these ALONE (`entry: []`). */
  hostOps?: TOps;
  /** imageId → bytes, merged into `state.imageBlobs` by `commit`. Blobs are
   *  NOT part of the undo entry: undo leaves the bytes in place (orphaned
   *  until redo). That is safe by design — the engine's
   *  `saveCompositionState` only persists blobs referenced by
   *  `state.images`, so orphans never reach disk, and `loadCompositionState`
   *  re-hydrates `imageBlobs` from the per-imageId binary keys, which is
   *  the recovery path after a reload mid-undo. */
  blobs?: Record<string, Uint8Array>;
  /** Skip the locked-node commit guard. Set only by the super-long-press
   *  (punch-through) builders, whose whole purpose is acting on nodes the
   *  guard would otherwise protect. */
  force?: boolean;
  /** Fresh node ids to select as a MULTI-selection after commit (the
   *  multi-duplicate builder, so the copies come up selected together the
   *  way the originals were). Takes precedence over `id` when 2+ long. */
  ids?: string[];
  /** The paint island the next 'paint' stroke should continue — set by
   *  buildPaintStroke when a stroke minted or continued one. EditorShell
   *  reads it into its session ref. Deliberately NOT `id`: selecting the
   *  island would pop the properties panel and turn the selection into a
   *  brush filter mid-painting. */
  paintSessionId?: string;
}

/** A fresh session. The type parameters are the app's: `TTool` is never
 *  inferred from the tool handed in (`NoInfer`, so a literal does not narrow
 *  it) and `TOps` has nothing to infer from, so an app names them once in a
 *  constructor of its own — Sol's `createSolSession(state, tool, doc)` — and
 *  reads `hostDoc` typed everywhere after. */
export function createEditorSession<TTool extends string = string, TDoc = undefined, TOps = unknown>(
  state: CompositionState,
  activeTool: NoInfer<TTool> | null = 'arrange' as TTool,
  hostDoc: TDoc = undefined as TDoc,
): EditorSession<TTool, TDoc, TOps> {
  // The session edits THROUGH THE SCENE GRAPH (docs/transform-refactor.md
  // P3-P4): every pose the editor writes is a transform on a node, and the
  // per-kind arrays are what the graph renders out. The builders below
  // read poses off transforms and world matrices, never off the legacy
  // fields — one pose has many spellings there, and the graph keeps the
  // pose, not the wording.
  return {
    state: withSceneGraph(state),
    undoStack: [], redoStack: [], selectedId: null, selectedIds: [], activeTool, dirty: false,
    hostDoc, hostUndoStack: [], hostRedoStack: [],
  };
}

/** The installed host's selectable items (sessionHost.ts), or null for an
 *  app whose document holds none. */
function hostItems<TDoc, TOps>(): HostItems<TDoc, TOps> | null {
  return (sessionHost<TDoc, TOps>().items as HostItems<TDoc, TOps> | undefined) ?? null;
}

/** The installed items adapter FOR THIS SESSION: null when the session has
 *  no host document to ask it about (a plain createEditorSession(state),
 *  the engine's own tests under an app's installed host), whatever is
 *  installed. */
function itemsOf(session: { hostDoc: unknown }): HostItems<unknown, unknown> | null {
  return session.hostDoc === undefined ? null : hostItems();
}

// ── Id minting ──────────────────────────────────────────────────────
// Engine id namespaces ('svg_' / 'img_' / 'txt_' / 'grp_') are a naming
// convention, not a routing rule: a node's kind comes from the array it is
// in (`findItem`) or from its graph node. Keep minting into them anyway —
// they are how a log line or a saved file reads — and note that persistence
// DOES enforce 'pnt_' / 'pat_' when reviving those two kinds. Counter +
// timestamp keeps ids unique within and across sessions.

let mintCounter = 0;

export function mintNodeId(kind: 'svg' | 'text' | 'image' | 'group'): string {
  const prefix = kind === 'text' ? 'txt' : kind === 'image' ? 'img' : kind === 'group' ? 'grp' : 'svg';
  return `${prefix}_${Date.now().toString(36)}_${(mintCounter++).toString(36)}`;
}

// ── Lock guard ──────────────────────────────────────────────────────

/** Ids an op mutates, for the locked-node commit guard. Ops with no single
 *  target (place, reorder, background, replaceScene) return [] — builders
 *  for those check locks themselves before constructing the entry. */
export function opTargetIds(op: CompUndoOp): string[] {
  switch (op.op) {
    case 'setTransform': return [op.nodeId];
    case 'moveNode': return [op.nodeId];
    case 'removeObject': return [op.item.id];
    case 'editSVGSegments':
    case 'renameSVG':
    case 'recolorSVG':
    case 'setFillColor':
    case 'setFillPaint':
    case 'setMaskMode':
    case 'paintTileSegments': return [op.svgId];
    case 'editImage': return [op.imageId];
    case 'setImageTint': return [op.nodeId];
    case 'setText':
    case 'setTextStyle': return [op.textId];
    case 'setNodeEffects': return [op.id];
    case 'setNodeRotation': return [op.id];
    case 'rotateFigure':
    case 'mirrorFigure':
    case 'scaleFigure':
    case 'recolorFigure':
    case 'renameFigure':
    case 'syncDimensions':
    case 'toggleRepeat': return [op.figureId];
    case 'editPatternCells':
    case 'setPatternSettings': return [op.patternId];
    default: return [];
  }
}

// ── Commit / undo / redo ────────────────────────────────────────────

/**
 * Apply an entry: applyCompOps + push undo + clear redo + mark dirty.
 * Rejected commits (an entry with nothing in it, or any op targeting a
 * locked node) return the SAME session instance so callers can
 * identity-compare. `hostOps` is the step's host half (sessionHost.ts):
 * applied to `hostDoc` after the engine ops through the installed host's
 * `ops.apply` and pushed onto the parallel stack (null when the step has
 * none), so the two stacks stay index-aligned; an entry of host ops alone
 * is a whole step with an empty engine entry.
 */
export function commit<S extends EditorSession>(
  session: S,
  entry: CompUndoEntry,
  blobs?: Record<string, Uint8Array>,
  force?: boolean,
  hostOps?: unknown,
): S {
  if (entry.length === 0 && hostOps == null) return session;
  if (!force) {
    for (const op of entry) {
      for (const id of opTargetIds(op)) {
        // A transform can target a group as readily as a leaf; a group is
        // locked through its chain.
        if (isItemLocked(session.state, id) || isGroupChainLocked(session.state, id)) return session;
      }
    }
  }
  let state = entry.length > 0 ? applyCompOps(session.state, entry) : session.state;
  if (blobs) {
    state = { ...state, imageBlobs: { ...(state.imageBlobs ?? {}), ...blobs } };
  }
  // A commit that DELETED the selection has to drop it, exactly as undo
  // does: nothing on screen still shows it (the outline needs a box), but a
  // selection is also the raster brush's object filter, so a leftover id
  // silently confines every following stroke to an object that is gone —
  // the brush stops painting until the page is reopened.
  return reconcileSelection({
    ...session,
    state,
    hostDoc: hostOps == null ? session.hostDoc : hostApply(session.hostDoc, hostOps),
    undoStack: [...session.undoStack, entry],
    redoStack: [],
    hostUndoStack: [...session.hostUndoStack, (hostOps ?? null) as S['hostUndoStack'][number]],
    hostRedoStack: [],
    dirty: true,
  });
}

/** The installed host's `ops.apply` / `ops.revert` over a step that carries
 *  host ops. An entry with host ops and no host installed is a programming
 *  error, not a quiet no-op: the document would silently stop moving. */
function hostApply<TDoc, TOps>(doc: TDoc, ops: TOps): TDoc {
  const host = sessionHost<TDoc, TOps>().ops;
  if (!host) throw new Error('editorSession: an entry carries hostOps but no session host is installed');
  return host.apply(doc, ops);
}
function hostRevert<TDoc, TOps>(doc: TDoc, ops: TOps): TDoc {
  const host = sessionHost<TDoc, TOps>().ops;
  if (!host) throw new Error('editorSession: an entry carries hostOps but no session host is installed');
  return host.revert(doc, ops);
}

/**
 * Push an entry the caller has ALREADY APPLIED to the composition (DrawBot's
 * play session, docs/drawBot.md §5.3: the flushes wrote its trail nodes into
 * `session.state` as provisional state), so the ops are RECORDED, not
 * applied; the host half is applied as a commit's is, the redo stack
 * cleared, the page dirtied. The host half is recorded exactly as given —
 * a kind the host wants on the step ('playSession') goes in `se.hostOps`;
 * nothing is defaulted. Outside a release build, `stateBefore` lets it
 * assert that replaying the ops over the pre-session state reaches the
 * state the session holds — the invariant undo depends on, since undo WILL
 * revert these ops.
 */
export function recordEntry<S extends EditorSession>(
  session: S,
  se: SessionEntry,
  stateBefore?: CompositionState,
): S {
  if (se.entry.length === 0 && se.hostOps == null) return session;
  if (stateBefore && RECORD_ENTRY_CHECKS) assertRecordedEntry(stateBefore, se.entry, session.state);
  return reconcileSelection({
    ...session,
    hostDoc: se.hostOps == null ? session.hostDoc : hostApply(session.hostDoc, se.hostOps),
    undoStack: [...session.undoStack, se.entry],
    redoStack: [],
    hostUndoStack: [...session.hostUndoStack, (se.hostOps ?? null) as S['hostUndoStack'][number]],
    hostRedoStack: [],
    dirty: true,
  });
}

/** Whether recordEntry checks its invariant: everything but a release
 *  build (Metro inlines NODE_ENV; jest sets 'test'). */
const RECORD_ENTRY_CHECKS: boolean =
  typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';

/** Throws when applying `entry` over `before` does not reproduce `after`'s
 *  leaves (engine `worldSnapshot`). Exported for the tests. */
export function assertRecordedEntry(
  before: CompositionState, entry: CompUndoEntry, after: CompositionState,
): void {
  const replayed = JSON.stringify(worldSnapshot(applyCompOps(before, entry)));
  const held = JSON.stringify(worldSnapshot(after));
  if (replayed !== held) {
    throw new Error('recordEntry: the recorded ops do not reproduce the session state');
  }
}

/** A NON-undoable change of the host document: swapped in whole, no entry
 *  — navigation, like the camera (Sol's cycle cursor, saved but never on
 *  the undo stack). The same session back when the document is the same
 *  object. */
export function withHostDoc<S extends EditorSession>(session: S, hostDoc: S['hostDoc']): S {
  if (session.hostDoc === hostDoc) return session;
  return reconcileSelection({ ...session, hostDoc });
}

/** Commit a SessionEntry, selecting the freshly minted node(s) when present.
 *  A minted/edited node that belongs to a group selects as the whole group
 *  (same promotion a tap applies — a tile stamp landing in a grouped pattern
 *  must not leave one member individually selected), but commit-time
 *  selection never changes the armed tool: the user is mid-work with it. */
export function commitEntry<S extends EditorSession>(session: S, se: SessionEntry): S {
  const next = commit(session, se.entry, se.blobs, se.force, se.hostOps);
  if (next === session) return session;
  if (se.ids && se.ids.length >= 2) return selectMany(next, se.ids, { keepTool: true });
  if (!se.id) return next;
  const groupIds = selectionUnitIds(next, se.id);
  if (groupIds) return selectMany(next, groupIds, { raw: true, keepTool: true });
  return { ...next, selectedId: se.id, selectedIds: [] };
}

/** Clear selection when the selected node(s) no longer exist (post undo/redo
 *  or delete). */
function reconcileSelection<S extends EditorSession>(session: S): S {
  // A multi-selection drops the ids that stopped resolving; below two
  // survivors it collapses (to a single selection, or to nothing) — the
  // same normalization selectMany applies on the way in.
  if (session.selectedIds.length > 0) {
    const live = session.selectedIds.filter((id) => isSelectableId(session, id));
    if (live.length === session.selectedIds.length) return session;
    if (live.length >= 2) return { ...session, selectedIds: live };
    return { ...session, selectedId: live[0] ?? null, selectedIds: [] };
  }
  // A frame group id is a valid selection even though it isn't a leaf item
  // (findItem resolves leaves only), so keep it when the frame still exists.
  // A host's own selection likewise: an item or a sentinel its document
  // keeps live (a bot, DrawBot's arena while there is one).
  if (session.selectedId
    && !findItem(session.state, session.selectedId)
    && !isFrameGroupId(session.state, session.selectedId)
    && !hostSelectionLive(session, session.selectedId)) {
    return { ...session, selectedId: null };
  }
  return session;
}

export function undo<S extends EditorSession>(session: S): S {
  const entry = session.undoStack[session.undoStack.length - 1];
  if (!entry) return session;
  const hostOps = session.hostUndoStack[session.hostUndoStack.length - 1] ?? null;
  return reconcileSelection({
    ...session,
    state: entry.length > 0 ? revertCompOps(session.state, entry) : session.state,
    hostDoc: hostOps == null ? session.hostDoc : hostRevert(session.hostDoc, hostOps),
    undoStack: session.undoStack.slice(0, -1),
    redoStack: [...session.redoStack, entry],
    hostUndoStack: session.hostUndoStack.slice(0, -1),
    hostRedoStack: [...session.hostRedoStack, hostOps],
    dirty: true,
  });
}

export function redo<S extends EditorSession>(session: S): S {
  const entry = session.redoStack[session.redoStack.length - 1];
  if (!entry) return session;
  const hostOps = session.hostRedoStack[session.hostRedoStack.length - 1] ?? null;
  return reconcileSelection({
    ...session,
    state: entry.length > 0 ? applyCompOps(session.state, entry) : session.state,
    hostDoc: hostOps == null ? session.hostDoc : hostApply(session.hostDoc, hostOps),
    undoStack: [...session.undoStack, entry],
    redoStack: session.redoStack.slice(0, -1),
    hostUndoStack: [...session.hostUndoStack, hostOps],
    hostRedoStack: session.hostRedoStack.slice(0, -1),
    dirty: true,
  });
}

// ── The host's items in the selection ───────────────────────────────
// A thing the host's document holds (DrawBot's bots and instruction tiles;
// sessionHost.ts `HostItems`) is not a scene node, but it is selected
// through the same `selectedId` / `selectedIds` as one, with an id the
// scene never mints, and it stands in a multi-selection beside the shapes:
// the marquee catches it, shift-click toggles it, and it sits in a group —
// a scene group it rides with shapes, or a group of host items alone (its
// `groupId` is read the same way). A UNIT is what one tap selects: every
// scene leaf and every host item of the outermost plain group. The
// reconciliation above keeps such a selection alive across commits exactly
// as it keeps a frame's (neither resolves through findItem).

/** What the session-free helpers below read of a session. */
type SelectionSession = Pick<EditorSession, 'state' | 'hostDoc'>;

/**
 * Is `id` one of the installed host's items, by its spelling?
 *
 * Exported for the CANVAS, which asks it of what a press found (stage
 * 5b.4): a host item stands in a multi-selection and twists with it, but
 * it is not a scene node, so the questions the canvas asks the scene about
 * one — `canTwoPointerManipulate`, `findItem` — all answer no. The
 * alternative was `sessionHost().items?.isHostId(id) ?? false` written out
 * at each of those sites, which is this function's body copied four times
 * with a `?? false` each time; one spelling of "whose id is this" beats
 * four.
 */
export function isHostId(id: string): boolean {
  return hostItems()?.isHostId(id) ?? false;
}

/** The scene ids among `ids` — what the scene's own builders are handed. */
export function selectedSceneIds(ids: readonly string[]): string[] {
  return ids.some(isHostId) ? ids.filter((id) => !isHostId(id)) : [...ids];
}

/** The host's items among `ids`. */
export function selectedHostIds(ids: readonly string[]): string[] {
  return ids.filter(isHostId);
}

/** True when `id` names a host item the document holds, or a sentinel the
 *  host keeps live (its arena while one exists, its Fields sheet) — a
 *  selection that lives in the host document, not the scene. */
export function hostSelectionLive(session: SelectionSession, id: string | null): boolean {
  if (!id) return false;
  const items = itemsOf(session);
  if (!items) return false;
  if (items.selectionLive?.(session.hostDoc, id)) return true;
  return items.isHostId(id) && items.itemById(session.hostDoc, id) !== null;
}

/** Can `id` stand in a multi-selection: a live scene leaf, or a host item
 *  the document holds. */
export function isSelectableId(session: SelectionSession, id: string): boolean {
  const items = itemsOf(session);
  if (items && items.isHostId(id)) return items.itemById(session.hostDoc, id) !== null;
  return !!findItem(session.state, id);
}

/** Is the host item `id` names locked: by its own flag, or by the lock of
 *  a scene group it rides — the inheritance a shape's lock has
 *  (`isItemLocked`). A locked one is never picked on the canvas and an
 *  edit leaves it where it is. False for anything else. */
export function isHostItemLocked(session: SelectionSession, id: string): boolean {
  const items = itemsOf(session);
  const member = items && items.isHostId(id) ? items.itemById(session.hostDoc, id) : null;
  if (!member) return false;
  return !!member.locked || (!!member.groupId && isGroupChainLocked(session.state, member.groupId));
}

/** What selecting the outline row of scene group `groupId` takes: its
 *  scene leaves, and every host item riding it or a group nested in it
 *  (they are not scene members, so `allDescendantMemberIds` never names
 *  one). */
export function groupSelectionMemberIds(session: SelectionSession, groupId: string): string[] {
  const { state } = session;
  const leaves = allDescendantMemberIds(state, groupId).filter((id) => findItem(state, id));
  const items = itemsOf(session);
  if (!items) return leaves;
  const parentOf = new Map(state.groups.map((g) => [g.id, g.parentGroupId]));
  const within = (m: { groupId?: string }): boolean => {
    for (let gid = m.groupId; gid; gid = parentOf.get(gid)) if (gid === groupId) return true;
    return false;
  };
  const riders = items.items(session.hostDoc).filter(within).map((m) => m.id);
  return riders.length === 0 ? leaves : [...leaves, ...riders];
}

/** The unit a host item belongs to: the outermost plain scene group it
 *  rides, or its own group id when no scene group has it (a group of host
 *  items alone). */
function hostUnitId(state: CompositionState, member: { groupId?: string }): string | null {
  const gid = member.groupId;
  if (!gid) return null;
  if (state.groups.some((g) => g.id === gid)) return outermostPlainGroupOf(state, gid);
  return gid;
}

/** The unit `id` (a leaf or a host item) belongs to, or null when it is
 *  loose. */
export function selectionUnitId(session: SelectionSession, id: string): string | null {
  const items = itemsOf(session);
  if (items && items.isHostId(id)) {
    const member = items.itemById(session.hostDoc, id);
    return member ? hostUnitId(session.state, member) : null;
  }
  return outermostPlainGroupId(session.state, id);
}

/** Every member of a unit: its scene leaves, then the host's items in the
 *  order they draw. */
function selectionUnitMembers(session: SelectionSession, unitId: string): string[] {
  const { state } = session;
  const leaves = state.groups.some((g) => g.id === unitId)
    ? allDescendantMemberIds(state, unitId).filter((id) => findItem(state, id))
    : [];
  const items = itemsOf(session);
  if (!items) return leaves;
  const inUnit = (m: { groupId?: string }) => !!m.groupId && hostUnitId(state, m) === unitId;
  const riders = items.items(session.hostDoc).filter(inUnit).map((m) => m.id);
  return riders.length === 0 ? leaves : [...leaves, ...riders];
}

/** {@link groupSelectionIds} with the host's items: what tapping `id`
 *  selects — its whole unit, shapes and host items alike — or null for a
 *  loose one (or a unit of one, which has nothing to act as). */
export function selectionUnitIds(session: SelectionSession, id: string): string[] | null {
  if (!itemsOf(session)) return groupSelectionIds(session.state, id);
  const unitId = selectionUnitId(session, id);
  if (!unitId) return null;
  const ids = selectionUnitMembers(session, unitId);
  return ids.length >= 2 ? ids : null;
}

/** The unit a multi-selection covers EXACTLY ({@link wholeGroupIdOfSelection}
 *  with the host's items): every member of it and nothing else, so the
 *  panel offers Ungroup. */
export function wholeUnitOfSelection(session: SelectionSession, ids: readonly string[]): string | null {
  if (!itemsOf(session)) return wholeGroupIdOfSelection(session.state, ids);
  if (ids.length < 2) return null;
  const unitId = selectionUnitId(session, ids[0]);
  if (!unitId) return null;
  if (ids.some((id) => selectionUnitId(session, id) !== unitId)) return null;
  return selectionUnitMembers(session, unitId).length === ids.length ? unitId : null;
}

/** {@link expandSelectionGroups} with the host's items: each id expanded to
 *  its whole unit ({@link selectionUnitIds}), deduped in first-seen order. */
export function expandSelectionUnits(session: SelectionSession, ids: readonly string[]): string[] {
  return expandEach(ids, (id) => selectionUnitIds(session, id));
}

/** The host items among `ids` that no scene group carries: the ones a
 *  multi edit moves itself. One riding a scene group moves with the group's
 *  transform (the host's own follow — DrawBot's groupFollow), so moving it
 *  here too would move it twice. A locked one sits out, as a locked shape
 *  does. */
function freeHostIds<TDoc, TOps>(
  state: CompositionState, items: HostItems<TDoc, TOps>, doc: TDoc, ids: readonly string[],
): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    if (!items.isHostId(id)) continue;
    const member = items.itemById(doc, id);
    if (!member || member.locked) continue;
    if (member.groupId && state.groups.some((g) => g.id === member.groupId)) continue;
    out.add(id);
  }
  return out;
}

/** A scene entry with its host half riding the same undo step: the change
 *  from `before` to `after` (none when they are the same document). */
export function withHostChange<TDoc, TOps>(
  se: SessionEntry<TOps> | null, before: TDoc, after: TDoc,
): SessionEntry<TOps> | null {
  if (before === after) return se;
  const items = hostItems<TDoc, TOps>();
  if (!items) throw new Error('editorSession: a host change without a session host installed');
  return { ...(se ?? { entry: [] }), hostOps: items.change(before, after) };
}

/** The host items `ids` names that no scene group carries, through `m`, as
 *  the host half of a scene builder's entry. Nothing when no host document
 *  is handed in. */
function withFreeHostItemsThrough<TDoc>(
  se: SessionEntry | null, state: CompositionState, hostDoc: TDoc | undefined,
  ids: readonly string[], m: Mat2D,
): SessionEntry | null {
  const items = hostItems<TDoc, unknown>();
  if (hostDoc === undefined || !items) return se;
  const free = freeHostIds(state, items, hostDoc, ids);
  if (free.size === 0) return se;
  return withHostChange(se, hostDoc, items.through(hostDoc, free, m));
}

/** Options for the selection setters. `raw` skips group promotion — reserved
 *  for the two places that legitimately address one member of a group: the
 *  Scene Outline's leaf rows and the super-long-press punch-through. Every
 *  other path promotes, so "a group is one thing" cannot drift per-caller
 *  again (it did: taps promoted, shift-clicks and drags didn't).
 *  `keepTool` leaves the armed tool alone on a 2+ selection — commit-time
 *  auto-selection uses it so promoting a minted/edited grouped node doesn't
 *  yank the user off the tool they are working with. */
export interface SelectOptions {
  raw?: boolean;
  keepTool?: boolean;
}

/** The first leaf node in paint order named `name` (exactly), or null —
 *  what a format's `firstSelectionName` resolves to at open. Leaves only:
 *  a group's name is the outline's, not a node the tools act on. */
export function nodeIdNamed(state: CompositionState, name: string): string | null {
  for (const id of state.sceneOrder) {
    if (findItem(state, id)?.item.name === name) return id;
  }
  return null;
}

/**
 * Set the single selection (or clear it with `null`), leaving the armed tool
 * alone. Selecting is orthogonal to the tool: tapping an object used to bounce
 * the user back to 'arrange', which silently disarmed whatever they were
 * drawing with. A tap now only moves the selection — the line tool stays the
 * line tool, the brush stays the brush (and the selection narrows what it may
 * paint), and 'arrange' is reached only by pressing its button.
 *
 * A grouped leaf PROMOTES to its whole group (a multi-selection of every
 * member) unless `raw` is set — see {@link SelectOptions}. Frame members and
 * loose leaves select as themselves.
 */
/** Nothing kept — the shared empty set, so clearing the selection does not
 *  mint one per tap. */
const NO_IDS: ReadonlySet<string> = new Set();

/**
 * The ids the session currently has selected, whichever shape holds them —
 * a single `selectedId` or a `selectedIds` multi.
 */
export function selectedIdList(session: EditorSession): string[] {
  if (session.selectedIds.length >= 2) return session.selectedIds;
  return session.selectedId ? [session.selectedId] : [];
}

/**
 * Paint layers that have just LEFT the selection, re-framed around the ink
 * they actually hold (paintObject.growPaintObjectToContent).
 *
 * A paint object's bbox is its ink bounds when it is minted, and the
 * brushes that can carry paint OUTSIDE those bounds re-grow it as they go
 * (push, blur). Nothing shrinks it: erase deliberately leaves the frame
 * alone mid-stroke, because a frame that snapped tighter on every dab
 * would make the handles crawl under the thumb doing the erasing. So a
 * layer scrubbed back to a corner of itself kept a box around the empty
 * space where the paint used to be — you could grab, move and scale ground
 * that had nothing on it.
 *
 * Letting go of the layer is the moment to settle that: the stroke is
 * over, nothing is being dragged, and the box is about to be drawn around
 * what is really there. Every texel stays exactly where it is drawn — only
 * the frame moves.
 *
 * Left alone: a LOCKED layer (its frame is not the user's to change here),
 * and one that is rotated, mirrored or grouped — such a frame turns about
 * its own centre, so moving the rect moves the pivot and every pixel hung
 * off it (paintObjectCanGrow says so). No undo entry: no pixel changes, so
 * there is nothing to take back.
 */
function trimDeselectedPaint<S extends EditorSession>(session: S, kept: ReadonlySet<string>): S {
  const paints = session.state.paintObjects;
  if (!paints || paints.length === 0) return session;
  const leaving = new Set(selectedIdList(session).filter((id) => !kept.has(id)));
  if (leaving.size === 0) return session;
  let changed = false;
  const next = paints.map((p) => {
    if (!leaving.has(p.id) || p.locked) return p;
    const rect = paintTilesContentRect(p.tiles);
    if (rect === null) return p;
    const trimmed = growPaintObjectToContent(p, rect);
    if (trimmed === null || trimmed === p) return p;
    changed = true;
    return trimmed;
  });
  if (!changed) return session;
  return { ...session, state: { ...session.state, paintObjects: next }, dirty: true };
}

export function select<S extends EditorSession>(
  session: S, id: string | null, opts?: SelectOptions,
): S {
  if (id && !opts?.raw) {
    const groupIds = selectionUnitIds(session, id);
    if (groupIds) return selectMany(session, groupIds, { ...opts, raw: true });
  }
  if (session.selectedId === id && session.selectedIds.length === 0) return session;
  // A paint layer let go of settles its frame around its own ink.
  const base = trimDeselectedPaint(session, id === null ? NO_IDS : new Set([id]));
  return { ...base, selectedId: id, selectedIds: [] };
}

/**
 * Select a set of leaf nodes at once (the marquee's release). Each id first
 * expands to its whole plain group (unless `raw` — see {@link SelectOptions}):
 * catching one member catches the group. Then normalizes — dedupes, drops ids
 * that don't resolve to a live leaf item, and orders by sceneOrder so every
 * multi-entry builder walks back-to-front — and collapses degenerate results:
 * one survivor is a plain single selection, none clears. A real
 * multi-selection (2+) also switches to the arrange tool, the only tool whose
 * canvas gestures can move the set as a whole (`keepTool` opts out).
 */
export function selectMany<S extends EditorSession>(
  session: S, ids: readonly string[], opts?: SelectOptions,
): S {
  const expanded = opts?.raw ? ids : expandSelectionUnits(session, ids);
  const unique = [...new Set(expanded)].filter((id) => isSelectableId(session, id));
  if (unique.length === 0) return select(session, null);
  if (unique.length === 1) return select(session, unique[0], opts);
  // Scene leaves back to front, then the host's items in their own draw
  // order (they draw over the page).
  const orderIndex = new Map(session.state.sceneOrder.map((id, i) => [id, i]));
  const items = itemsOf(session);
  const hostOrder = items ? new Map(items.items(session.hostDoc).map((m, i) => [m.id, i])) : null;
  const sceneEnd = session.state.sceneOrder.length;
  const rank = (id: string) => (hostOrder && items!.isHostId(id)
    ? sceneEnd + (hostOrder.get(id) ?? 0)
    : orderIndex.get(id) ?? 0);
  unique.sort((a, b) => rank(a) - rank(b));
  const next = {
    ...trimDeselectedPaint(session, new Set(unique)), selectedId: null, selectedIds: unique,
  };
  if (opts?.keepTool) return next;
  return next.activeTool === 'arrange' ? next : { ...next, activeTool: 'arrange' as S['activeTool'] };
}

/**
 * Shift-click toggle (desktop multi-select): add `id` to the current
 * selection, or drop it if it is already selected. A grouped id toggles as
 * its WHOLE group — all members in, or all members out — the same unit a tap
 * selects; there is no way to shift-click one member alone. The working set
 * is read from whichever selection shape is live — a single `selectedId` or
 * a `selectedIds` multi — then the toggled result is normalized through
 * selectMany, so it collapses the same way a marquee does: 0 clears, 1 is a
 * plain single selection, 2+ a multi (which also switches to the arrange
 * tool). Only leaf nodes participate (findItem-gated), matching selectMany —
 * frames are chosen from the Scene Outline, never shift-clicked on canvas.
 */
export function toggleSelect<S extends EditorSession>(session: S, id: string): S {
  if (!isSelectableId(session, id)) return session;
  const unit = selectionUnitIds(session, id) ?? [id];
  const current = session.selectedIds.length >= 2
    ? session.selectedIds
    : session.selectedId
      ? [session.selectedId]
      : [];
  const set = new Set(current);
  const allIn = unit.every((m) => set.has(m));
  for (const m of unit) {
    if (allIn) set.delete(m);
    else set.add(m);
  }
  return selectMany(session, [...set]);
}

/**
 * Activate a tool, or `null` to untoggle them all (pressing the lit button).
 *
 * Untoggling also drops the selection: with no tool there is no way to make
 * one and no canvas gesture that acts on it — the handles are gone and a tap
 * is inert — so a lingering selectedId would leave an outline hanging over
 * the page that the user can no longer clear (and, since any selection
 * raises the object-properties panel, a panel over a selection they can't
 * reach).
 */
export function setTool<S extends EditorSession>(session: S, tool: S['activeTool']): S {
  if (session.activeTool === tool) return session;
  const next = { ...session, activeTool: tool };
  return tool === null ? select(next, null) : next;
}

/** Non-undoable session-state updates (camera commit, viewport resize). */
export function withState<S extends EditorSession>(session: S, state: CompositionState): S {
  return { ...session, state: withGraphCurrent(session.state, state) };
}

/**
 * `next` with a graph that describes it.
 *
 * The non-undoable preview paths write the arrays directly (a slider's
 * live angle, a crop pan, an opacity drag) and spread the old graph along
 * with them, so the graph would be a gesture behind the picture: those
 * leaves are read back in. A graph that DOES describe its arrays — the
 * reducer's, or a snapshot's the slider goes back to on commit — is kept
 * as it is, and must be: it can say what the arrays cannot (a group's
 * free turn has no legacy spelling), and a rebuild would respell the
 * group at a quarter turn with its members carrying the rest, so the
 * committed transform would then land on top of that residual and swing
 * the whole group. The engine records which arrays a graph stands for
 * (`graphDescribes`).
 *
 * `regraphChangedLeaves`, not `withSceneGraph`, for the same reason: it
 * keeps every group's transform and every leaf the preview did not
 * write, where a rebuild flattens the twisted group and re-reads the
 * whole page through legacy fields that cannot spell a member of a group
 * pulled off-square — which moved every such member for the sake of one
 * slider. It falls back to a rebuild itself when the scene's SHAPE
 * changed. A state with no graph at all (a page swapped in whole) gets
 * one, so the session never quietly falls back to the legacy path.
 */
function withGraphCurrent(_prev: CompositionState, next: CompositionState): CompositionState {
  if (next.graph && graphDescribes(next.graph, next)) return next;
  if (next.graph) return { ...next, graph: regraphChangedLeaves(next.graph, next) };
  return withSceneGraph(next);
}

/** Mark the current state as flushed to persistence. */
export function markSaved<S extends EditorSession>(session: S): S {
  if (!session.dirty) return session;
  return { ...session, dirty: false };
}

// ── Entry builders ──────────────────────────────────────────────────
// All pure: given the current state (where needed), return the ops (and
// blobs) to commit, or null when the request is invalid / a no-op.

/** Place a text node centered on `(centerX, centerY)`; bbox from the
 *  deterministic layout (`measureTextBbox`). `options.bbox` overrides both —
 *  the node takes that box verbatim (the renderer word-wraps to `cellWidth`
 *  and vAligns within `cellHeight`), for drag-to-place; `centerX`/`centerY`
 *  are ignored then, and the node starts life fixed-size (a dragged-out box
 *  is a user-authored one — Figma's click-vs-drag distinction). */
export function buildPlaceText(
  content: string,
  style: TextStyle,
  centerX: number,
  centerY: number,
  options?: { sticker?: boolean; name?: string; layout?: TextLayoutOptions; bbox?: CellBbox },
): SessionEntry {
  const id = mintNodeId('text');
  const bbox = options?.bbox;
  const { width, height } = bbox
    ? { width: bbox.cellWidth, height: bbox.cellHeight }
    : measureTextBbox(content, style, options?.layout);
  const text: TextObject = {
    id,
    content,
    style,
    cellX: bbox ? bbox.cellX : centerX - width / 2,
    cellY: bbox ? bbox.cellY : centerY - height / 2,
    cellWidth: width,
    cellHeight: height,
  };
  // `fixedSize` means "the user dragged this box out" — the Figma
  // click-vs-drag distinction. A STICKER's box is its card, sized by whoever
  // dealt it, and stickers already keep their box (keepsTextBbox), so a
  // sticker placed into an explicit card is not marked fixed.
  if (bbox && !options?.sticker) text.fixedSize = true;
  if (options?.sticker) text.sticker = true;
  if (options?.name) text.name = options.name;
  return { entry: [{ op: 'placeObject', kind: 'text', item: text }], id };
}

/** Did a style edit touch a field text MEASUREMENT reads? Alignment
 *  (`align`/`vAlign`), color, and stroke reposition or restyle glyphs within
 *  the box without changing the measured extent, so they are excluded —
 *  Figma's rule that alignment never moves the box falls out of this. */
function textMetricsChanged(a: TextStyle, b: TextStyle): boolean {
  return a.fontId !== b.fontId
    || a.size !== b.size
    || (a.weight ?? null) !== (b.weight ?? null)
    || !!a.bold !== !!b.bold
    || !!a.italic !== !!b.italic
    || (a.letterSpacing ?? 0) !== (b.letterSpacing ?? 0)
    || (a.lineHeight ?? DEFAULT_LINE_HEIGHT) !== (b.lineHeight ?? DEFAULT_LINE_HEIGHT);
}

/** Does this node keep its bbox through content/style edits? True once the
 *  user authored the box ({@link TextObject.fixedSize}) and for stickers,
 *  whose card (text + padding) is sized at scaffold time — re-measuring
 *  either would collapse space the user (or scaffold) created. */
function keepsTextBbox(text: TextObject): boolean {
  return !!text.fixedSize || !!text.sticker;
}

/** An auto-size re-measure, anchored Figma-style: the edge (or center) the
 *  alignment points at stays put — left-aligned text grows rightward,
 *  centered text grows both ways, right-aligned grows leftward, and
 *  vAlign anchors the vertical axis the same way. Exported for the page
 *  template's date restamp (pageTemplate.ts), which widens the date box
 *  with exactly this anchoring. */
/**
 * The WORLD size a text of this content and style takes, stretch included.
 *
 * `measureTextBbox` answers in the type's own proportions — the box the
 * glyphs lay out in — and a stretched text (v66, {@link TextObject.stretchX})
 * draws that box `stretchX` times wider. Every re-measure has to ask the
 * question this way, or the first edit to a stretched text would snap its
 * box back to the unstretched width and un-stretch the letters with it.
 */
function measuredTextSize(
  text: { stretchX?: number },
  content: string,
  style: TextStyle,
  layout?: TextLayoutOptions,
): { width: number; height: number } {
  const size = measureTextBbox(content, style, layout);
  const k = text.stretchX;
  return k !== undefined && Number.isFinite(k) && k > 0
    ? { width: size.width * k, height: size.height }
    : size;
}

export function anchoredTextBbox(
  text: TextObject,
  style: TextStyle,
  size: { width: number; height: number },
): CellBbox {
  const align = style.align ?? 'left';
  const vAlign = style.vAlign ?? 'top';
  const cellX = align === 'center' ? text.cellX + (text.cellWidth - size.width) / 2
    : align === 'right' ? text.cellX + text.cellWidth - size.width
    : text.cellX;
  const cellY = vAlign === 'middle' ? text.cellY + (text.cellHeight - size.height) / 2
    : vAlign === 'bottom' ? text.cellY + text.cellHeight - size.height
    : text.cellY;
  return { cellX, cellY, cellWidth: size.width, cellHeight: size.height };
}

/** How far a stored text box may sit from its measured one and still count
 *  as measuring the same thing. The box persists as a float32 (v44+), so a
 *  reload alone moves it by ~1e-7 of its value; a box measured against the
 *  WRONG metrics is out by percent, not by that. */
const REMEASURE_EPSILON_CELLS = 1e-3;

/**
 * Every auto-sized text re-measured against the metrics available NOW —
 * or null when they all still fit, which is the normal answer.
 *
 * The one repair for the font-loading gap. A text's box is measured once,
 * when it is placed or edited, and `TextMeasurer` cannot answer until the
 * face it is asked about has loaded (web/fonts/domTextMeasurer.ts gates on
 * `document.fonts.check`) — so a text placed in the second before the pack
 * faces settle is sized by the engine's font-blind approximation and then
 * keeps that box for good. The glyphs repaint in the real face when it
 * arrives, and in a wide display face like Bungee they are ~60% wider than
 * the approximation guessed: the line wraps inside its own box and the
 * selection outline cuts through the type.
 *
 * So the app re-runs this when the fonts epoch bumps (EditorShell), which is
 * exactly the moment the measurer starts answering. It is a CORRECTION, not
 * an edit: it lands through the non-undoable state path, because undoing back
 * to a box that was never right is not something to offer.
 *
 * Only the boxes the app owns move — a text the user dragged out
 * (`fixedSize`) or a sticker's card keeps its box through every other
 * re-measure ({@link keepsTextBbox}) and keeps it through this one. Each box
 * is re-anchored the way a style edit anchors it, so a centred text grows
 * both ways and a right-aligned one keeps its right edge.
 */
export function remeasuredTexts(state: CompositionState): CompositionState | null {
  const texts = state.texts;
  if (!texts || texts.length === 0) return null;
  let changed = false;
  const next = texts.map((t) => {
    if (keepsTextBbox(t)) return t;
    const size = measuredTextSize(t, t.content, t.style);
    if (Math.abs(size.width - t.cellWidth) <= REMEASURE_EPSILON_CELLS
      && Math.abs(size.height - t.cellHeight) <= REMEASURE_EPSILON_CELLS) return t;
    changed = true;
    return { ...t, ...anchoredTextBbox(t, t.style, size) };
  });
  return changed ? { ...state, texts: next } : null;
}

export function buildSetTextContent(
  state: CompositionState,
  textId: string,
  newContent: string,
  layout?: TextLayoutOptions,
): SessionEntry | null {
  const text = (state.texts ?? []).find((t) => t.id === textId);
  if (!text || text.content === newContent) return null;
  const base = {
    op: 'setText' as const, textId,
    oldContent: text.content, newContent,
    oldCellWidth: text.cellWidth, oldCellHeight: text.cellHeight,
  };
  if (keepsTextBbox(text)) {
    return { entry: [{ ...base, newCellWidth: text.cellWidth, newCellHeight: text.cellHeight }] };
  }
  const bbox = anchoredTextBbox(text, text.style, measuredTextSize(text, newContent, text.style, layout));
  return {
    entry: [{
      ...base,
      newCellWidth: bbox.cellWidth, newCellHeight: bbox.cellHeight,
      oldCellX: text.cellX, oldCellY: text.cellY,
      newCellX: bbox.cellX, newCellY: bbox.cellY,
    }],
  };
}

export function buildSetTextStyle(
  state: CompositionState,
  textId: string,
  newStyle: TextStyle,
  layout?: TextLayoutOptions,
): SessionEntry | null {
  const text = (state.texts ?? []).find((t) => t.id === textId);
  if (!text) return null;
  const base = {
    op: 'setTextStyle' as const, textId,
    oldStyle: text.style, newStyle,
    oldCellWidth: text.cellWidth, oldCellHeight: text.cellHeight,
  };
  if (keepsTextBbox(text) || !textMetricsChanged(text.style, newStyle)) {
    return { entry: [{ ...base, newCellWidth: text.cellWidth, newCellHeight: text.cellHeight }] };
  }
  const bbox = anchoredTextBbox(text, newStyle, measuredTextSize(text, text.content, newStyle, layout));
  return {
    entry: [{
      ...base,
      newCellWidth: bbox.cellWidth, newCellHeight: bbox.cellHeight,
      oldCellX: text.cellX, oldCellY: text.cellY,
      newCellX: bbox.cellX, newCellY: bbox.cellY,
    }],
  };
}

/** Toggle a word sticker's inverted color scheme (magnetic poetry's one
 *  type-specific option): dark card + light text ⇄ light card + dark text.
 *  Rides `replaceScene` like the other text-node edits that have no granular
 *  op. Returns null for a missing / non-text / non-sticker / locked target. */
export function buildToggleStickerInvert(
  state: CompositionState,
  nodeId: string,
  to?: boolean,
): SessionEntry | null {
  const ref = findItem(state, nodeId);
  if (!ref || ref.kind !== 'text' || !ref.item.sticker || isItemLocked(state, ref.item.id)) return null;
  // `to` names the state to land in (null when already there); absent, flip.
  const next = to ?? !ref.item.invert;
  if (next === !!ref.item.invert) return null;
  const texts = (state.texts ?? []).map((t) => (t.id === nodeId
    ? { ...t, invert: next ? true : undefined }
    : t));
  return { entry: [buildReplaceTextsOp(state, texts)] };
}

/** {@link buildToggleStickerInvert} over a multi-selection, CONVERGING it
 *  the way {@link buildToggleLockMulti} does: every member lands in one
 *  state — off when all were on, else on — rather than each flipping into
 *  a differently-mixed selection. A multi-select edit sets every member,
 *  whatever each already had. One undo step; non-stickers and locked
 *  members are skipped, never vetoing the rest. */
export function buildToggleStickerInvertMulti(
  state: CompositionState,
  ids: readonly string[],
): SessionEntry | null {
  const next = !ids.every((id) => {
    const ref = findItem(state, id);
    return ref?.kind === 'text' && !!ref.item.invert;
  });
  return buildForEachNode(state, ids, (cur, id) => buildToggleStickerInvert(cur, id, next));
}

/** Place an already-built SVGObject (e.g. a baked pattern-studio tile).
 *  The caller mints the id via `mintNodeId('svg')` — the prefix is
 *  load-bearing for the engine's kind-by-prefix resolution. */
export function buildPlaceSVGObject(svg: SVGObject): SessionEntry {
  return { entry: [{ op: 'placeObject', kind: 'svg', item: svg }], id: svg.id };
}

/**
 * Toggle a tile pattern object's pattern (repeat) mode — Facet's Repeat
 * button. ON: the current display size becomes the tile size
 * (`tileWidthL0/HeightL0`) and the bbox becomes a repeating REGION — from
 * here, resizing the bounding box repeats the tile rather than scaling it,
 * and the toggle itself changes nothing visually. OFF: back to a single
 * scaling tile, with the bbox recomputed from the actual segment positions
 * so it stays aligned with non-tiled rendering (which uses absolute
 * coordinates). One `toggleRepeat` op = one undo step; the reducer clears
 * `tileOffset*` and per-copy paint on either flip (toggling redefines the
 * grid).
 */
export function buildTogglePatternRepeat(
  state: CompositionState,
  nodeId: string,
  to?: boolean,
): SessionEntry | null {
  const ref = findItem(state, nodeId);
  if (!ref || (ref.kind !== 'svg' && ref.kind !== 'pattern') || isItemLocked(state, nodeId)) return null;
  const item = ref.item;
  if (item.groupId) return null;
  const wasRepeat = item.tileMode === 'repeat';
  // `to` names the mode to land in (null when already there); absent, flip.
  if (to !== undefined && to === wasRepeat) return null;
  let newTileMode: 'repeat' | undefined;
  let newTileWidthL0: number | undefined;
  let newTileHeightL0: number | undefined;
  let newCellX = item.cellX;
  let newCellY = item.cellY;
  let newCellWidth = item.cellWidth;
  let newCellHeight = item.cellHeight;
  if (wasRepeat) {
    newTileMode = undefined;
    newTileWidthL0 = undefined;
    newTileHeightL0 = undefined;
    // Back to a single tile: the bbox snaps to where one tile actually
    // draws — for an svg that is the segment AABB (segments carry one
    // tile), for a pattern node the tile rect at the grid anchor.
    if (ref.kind === 'svg') {
      const bbox = computeSVGBbox(ref.item.segments);
      newCellX = bbox.cellX;
      newCellY = bbox.cellY;
      newCellWidth = bbox.cellWidth;
      newCellHeight = bbox.cellHeight;
    } else {
      newCellX = item.cellX + (ref.item.tileOffsetXL0 ?? 0);
      newCellY = item.cellY + (ref.item.tileOffsetYL0 ?? 0);
      newCellWidth = item.tileWidthL0 ?? item.cellWidth;
      newCellHeight = item.tileHeightL0 ?? item.cellHeight;
    }
  } else {
    newTileMode = 'repeat';
    newTileWidthL0 = item.cellWidth;
    newTileHeightL0 = item.cellHeight;
  }
  return { entry: [{
    op: 'toggleRepeat',
    figureId: item.id,
    oldTileMode: item.tileMode,
    oldTileWidthL0: item.tileWidthL0,
    oldTileHeightL0: item.tileHeightL0,
    oldCellX: item.cellX, oldCellY: item.cellY,
    oldCellWidth: item.cellWidth, oldCellHeight: item.cellHeight,
    newTileMode,
    newTileWidthL0,
    newTileHeightL0,
    newCellX, newCellY,
    newCellWidth, newCellHeight,
  }] };
}

/** {@link buildTogglePatternRepeat} over a multi-selection, CONVERGING it
 *  the way {@link buildToggleLockMulti} does: every member lands in repeat
 *  unless all already do, in which case every member leaves it — rather
 *  than each flipping into a differently-mixed selection. A multi-select
 *  edit sets every member, whatever each already had. One undo step; a
 *  locked or grouped member is skipped, never vetoing the rest. */
export function buildTogglePatternRepeatMulti(
  state: CompositionState,
  ids: readonly string[],
): SessionEntry | null {
  const next = !ids.every((id) => {
    const ref = findItem(state, id);
    return (ref?.kind === 'svg' || ref?.kind === 'pattern') && ref.item.tileMode === 'repeat';
  });
  return buildForEachNode(state, ids, (cur, id) => buildTogglePatternRepeat(cur, id, next));
}

// ── Pattern objects (the inline tile-pattern kind) ──────────────────

/** Place a fresh, empty PatternObject covering `bbox` with a cols×rows
 *  cell grid (1..16 per axis — the create-region drag guarantees the cap).
 *  `symmetry` seeds the painting symmetry (a format's patternSymmetry);
 *  `stroke` seeds the authored line weight (the shell passes the
 *  composition-wide default expressed in world cells, so the width is
 *  explicit from birth and a repeat toggle can never change it).
 *  `floodRandom` fills the fresh grid with connectivity-respecting random
 *  tiles under the seeded symmetry, in the same undo step as the place —
 *  undo removes the pattern, not the fill. `tint` is the ink those tiles
 *  land in (the active colour). */
export function buildPlacePattern(
  bbox: CellBbox,
  cols: number,
  rows: number,
  symmetry?: PatternSymmetry,
  stroke?: SVGStroke,
  floodRandom = false,
  excludedFamilies?: Set<string>,
  tint?: RGBColor | null,
): SessionEntry {
  const item: PatternObject = {
    id: mintPatternObjectId(),
    cellX: bbox.cellX,
    cellY: bbox.cellY,
    cellWidth: bbox.cellWidth,
    cellHeight: bbox.cellHeight,
    cols,
    rows,
    cells: new Array(cols * rows).fill(null),
    ...(symmetry ? { symmetry } : null),
    ...(stroke ? { stroke } : null),
  };
  const entry: SessionEntry['entry'] = [{ op: 'placeObject', kind: 'pattern', item }];
  if (floodRandom) {
    const edits = patternFloodEdits(item, { kind: 'random' }, excludedFamilies, tint);
    if (edits.length > 0) entry.push({ op: 'editPatternCells', patternId: item.id, edits });
  }
  return { entry, id: item.id };
}

/**
 * The tile grid `id` names: a pattern OBJECT's own, or the grid a closed
 * shape carries as its pattern fill (`shapePatternGrid` — the shape's id
 * is the grid's, see engine/shapePatternFill.ts). Null for anything else.
 *
 * The one resolver the grid builders below take their target through, so
 * a fill is flooded, closed, cleared, mirrored and stamped into by the
 * very code a pattern object is — no second set of builders to drift.
 *
 * Not every pattern builder asks it: a fill's BOX is the shape's, so
 * shrinkwrap has nothing to trim, and its colour is the tiles' own, so a
 * colour press on a patterned shape goes on recolouring the shape's own
 * outline (buildRecolorPattern stays pattern-objects-only).
 */
export function patternGridOf(
  state: CompositionState,
  id: string,
): PatternObject | null {
  const ref = findItem(state, id);
  if (!ref) return null;
  if (ref.kind === 'pattern') return ref.item;
  return ref.kind === 'svg' ? shapePatternGrid(ref.item) : null;
}

/**
 * The ink an edit to grid `patternId` lays its tiles in.
 *
 * A shape's pattern FILL keeps the colour it already draws in: re-rolling,
 * flooding, resizing, re-mirroring or brushing tiles into it changes the
 * cloth's SHAPE and nothing else, so its tiles come in the fill's own ink —
 * the colour most of its tiles draw in — rather than the swatch's. Changing
 * the cloth's colour is the Color brush's job (aimed at Patterns), not the
 * pattern tools'. Only a fill with no tile in it yet has no ink to keep, and
 * takes `fallback`, as a loose pattern object always does.
 */
export function patternEditInk<F extends RGBColor | null>(
  state: CompositionState,
  patternId: string | null | undefined,
  fallback: F,
): RGBColor | F {
  const ref = patternId ? findItem(state, patternId) : null;
  if (ref?.kind !== 'svg' || !ref.item.patternFill) return fallback;
  const grid = shapePatternGrid(ref.item);
  if (!grid) return fallback;
  const counts = new Map<string, { ink: RGBColor; n: number }>();
  let best: { ink: RGBColor; n: number } | null = null;
  for (let i = 0; i < grid.cells.length; i++) {
    if (grid.cells[i]?.type !== 'sprite') continue;
    const ink = effectivePatternCellColor(grid, i);
    const key = `${ink.r},${ink.g},${ink.b}`;
    const entry = counts.get(key) ?? { ink, n: 0 };
    entry.n++;
    counts.set(key, entry);
    if (!best || entry.n > best.n) best = entry;
  }
  return best?.ink ?? fallback;
}

/** Commit a batch of pattern cell edits (one stroke, a reconcile sweep, or
 *  a clear) as a single undo step. Null when there is nothing to change or
 *  the pattern is locked/missing. */
export function buildEditPatternCells(
  state: CompositionState,
  patternId: string,
  edits: PatternCellEdit[],
): SessionEntry | null {
  if (!patternGridOf(state, patternId) || isItemLocked(state, patternId)) return null;
  if (edits.length === 0) return null;
  return { entry: [{ op: 'editPatternCells', patternId, edits }] };
}

/** For a repeat-mode pattern, the same object with its region squared to
 *  WHOLE tile copies: origin snapped to the nearest copy boundary of the
 *  existing tile lattice (`cellX + tileOffset + k·tileW`), extent rounded
 *  to the nearest positive copy count, offsets cleared (the origin now sits
 *  ON the lattice). The tiles themselves don't move — only the region's
 *  edges do, each by less than half a tile.
 *
 *  This is what makes Close able to close a dragged repeat region's
 *  borders at all: a region cut mid-copy clips tiles at its edge, and no
 *  cell swap can cap a line the CLIP truncated — the same logical cell
 *  renders whole in the interior copies. Null when the pattern doesn't
 *  repeat or the region already sits on whole copies. */
export function squarePatternRegionToTiles(p: PatternObject): PatternObject | null {
  if (p.tileMode !== 'repeat' || p.tileWidthL0 == null || p.tileHeightL0 == null) return null;
  const tileW = p.tileWidthL0;
  const tileH = p.tileHeightL0;
  if (!(tileW > 0) || !(tileH > 0)) return null;
  const offX = p.tileOffsetXL0 ?? 0;
  const offY = p.tileOffsetYL0 ?? 0;
  const newX = p.cellX + offX - Math.round(offX / tileW) * tileW;
  const newY = p.cellY + offY - Math.round(offY / tileH) * tileH;
  const newW = Math.max(tileW, Math.round((p.cellX + p.cellWidth - newX) / tileW) * tileW);
  const newH = Math.max(tileH, Math.round((p.cellY + p.cellHeight - newY) / tileH) * tileH);
  if (newX === p.cellX && newY === p.cellY && newW === p.cellWidth && newH === p.cellHeight
      && offX === 0 && offY === 0) return null;
  const { tileOffsetXL0: _ox, tileOffsetYL0: _oy, ...rest } = p;
  return { ...rest, cellX: newX, cellY: newY, cellWidth: newW, cellHeight: newH };
}

/** Run the reconcile tool — the UI's "Close" — over a pattern's grid
 *  (borderOnly mirrors the old "hold for Border" behavior).
 *  `excludedFamilies` keeps replacement picks inside the tile sets the
 *  PATTERN is made of (its Shapes page).
 *
 *  `symmetry` is the CURRENT rules when they outrank the pattern's stored
 *  mode — the shell passes the toolbar's canvas Symmetry while it is on,
 *  the same precedence Flood gives it. Repairs mirror under it, and the
 *  same undo step writes it onto the pattern (setPatternSettings), so the
 *  brush that follows paints under the rules the Close just repaired by.
 *  Omitted, the pattern's own mode governs as ever.
 *
 *  A repeat-mode region is squared to whole copies in the same step
 *  (squarePatternRegionToTiles): the reconcile closes the TILE grid's
 *  borders, and only a whole-copy region puts those closed borders at the
 *  region's edge — a mid-copy cut would go on clipping tiles no matter
 *  what the cells hold. One undo step either way. */
export function buildPatternReconcile(
  state: CompositionState,
  patternId: string,
  borderOnly = false,
  excludedFamilies?: Set<string>,
  symmetry?: PatternSymmetry,
): SessionEntry | null {
  const grid = patternGridOf(state, patternId);
  if (!grid) return null;
  const item = symmetry ? { ...grid, symmetry } : grid;
  const cells = buildEditPatternCells(
    state, patternId, patternReconcileEdits(item, borderOnly, excludedFamilies),
  );
  const settings = symmetry ? buildSetPatternSettings(state, patternId, { symmetry }) : null;
  // Only a pattern OBJECT has a region to square: a fill's grid repeats
  // too (its tile is smaller than the shape's box), but the box is the
  // SHAPE's — there is no pattern object of that id for the op to land on,
  // and nothing about a shape moves because its tile was closed.
  const squared = findItem(state, patternId)?.kind === 'pattern' && !isItemLocked(state, patternId)
    ? squarePatternRegionToTiles(grid)
    : null;
  if (!cells && !settings && !squared) return null;
  return { entry: [
    // Region first: it swaps the whole patternObjects array, so it must not
    // land on top of the settings/cell writes.
    ...(squared ? [buildReplacePatternOp(state, squared)] : []),
    ...(settings?.entry ?? []),
    ...(cells?.entry ?? []),
  ] };
}

/** Re-ink every tile of the pattern — what the Stroke bar's swatch does to
 *  a pattern, standing where buildRecolorSVG stands for a vector. Null when
 *  `id` isn't a pattern (so a caller can fall through to the vector path for
 *  a mixed selection), when the pattern is locked, or when every cell
 *  already draws in `color`. One undo step. */
export function buildRecolorPattern(
  state: CompositionState,
  id: string,
  color: RGBColor,
): SessionEntry | null {
  const ref = findItem(state, id);
  if (!ref || ref.kind !== 'pattern') return null;
  return buildEditPatternCells(state, id, patternRecolorEdits(ref.item, color));
}

/**
 * The same act on a SHAPE's pattern fill — the Pattern page's Stroke
 * section's hue row and its picker. A fill's colour lives per cell exactly
 * as a pattern object's does, so this is the same re-ink through the same
 * op (`editPatternCells` routes a shape's grid itself); only the way the
 * grid is reached differs, which is why the two are siblings rather than
 * one function with a mode.
 *
 * Deliberately NOT folded into `buildRecolorPattern`: that one returns
 * null for an svg id so the Stroke bar's swatch falls through to the
 * SHAPE's own outline colour, which is what the swatch there means. A
 * patterned shape has two inks, and each page must reach its own.
 */
export function buildRecolorShapePattern(
  state: CompositionState,
  svgId: string,
  color: RGBColor,
): SessionEntry | null {
  const ref = findItem(state, svgId);
  if (!ref || ref.kind !== 'svg' || !ref.item.patternFill) return null;
  const grid = shapePatternGrid(ref.item);
  if (!grid) return null;
  return buildEditPatternCells(state, svgId, patternRecolorEdits(grid, color));
}

/**
 * Set the line the TILES are drawn in — the Pattern page's Stroke
 * section's Width and Dash. One undo step; null when nothing is
 * patterned, the shape is locked, or the line is already that.
 *
 * A width of `undefined` puts the fill back on its DEFAULT: half the
 * shape's own line, derived at every draw. Nothing is stored until the
 * slider is moved, so a pattern nobody has touched goes on following the
 * outline that frames it.
 */
export function buildSetShapePatternStroke(
  state: CompositionState,
  svgId: string,
  stroke: { width?: number; dash?: number },
): SessionEntry | null {
  const ref = findItem(state, svgId);
  if (!ref || ref.kind !== 'svg' || !ref.item.patternFill) return null;
  const fill = ref.item.patternFill;
  const next: SVGStroke = { ...fill.stroke };
  if (stroke.width == null) delete next.width; else next.width = Math.max(0, stroke.width);
  const dash = stroke.dash == null ? 0 : Math.max(0, Math.min(10, Math.round(stroke.dash)));
  if (dash > 0) next.dash = dash; else delete next.dash;
  const block = Object.keys(next).length > 0 ? next : undefined;
  if (JSON.stringify(block ?? null) === JSON.stringify(fill.stroke ?? null)) return null;
  // The field is ABSENT rather than undefined when there is nothing to
  // say, so a fill back at its defaults round-trips as one that never had
  // a line set.
  const nextFill: ShapePatternFill = { ...fill };
  if (block) nextFill.stroke = block; else delete nextFill.stroke;
  return buildSetShapePatternFill(state, svgId, nextFill);
}

/** The pattern with empty border rows/columns TRIMMED: the bbox shrinks
 *  onto the occupied cells, which stay exactly where they are on the page
 *  (the origin moves by whole cells). Null when there is nothing to trim —
 *  a full-to-the-edges grid, an entirely empty one (nothing to wrap TO;
 *  deleting is not this function's call) — or when the trim can't be done
 *  safely: a repeat pattern's grid IS its tile (trimming would redefine
 *  the tiling), a legacy posed grid maps to the page through its flags,
 *  and a free-rotated one spins about its bbox center, which a trim would
 *  move. */
export function shrinkwrapPatternGrid(p: PatternObject): PatternObject | null {
  if (p.tileMode === 'repeat' || p.rotation || p.mirrorH || p.mirrorV || p.angleDeg) return null;
  let minX = p.cols;
  let minY = p.rows;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < p.rows; y++) {
    for (let x = 0; x < p.cols; x++) {
      if (!p.cells[y * p.cols + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  if (minX === 0 && minY === 0 && maxX === p.cols - 1 && maxY === p.rows - 1) return null;
  const cols = maxX - minX + 1;
  const rows = maxY - minY + 1;
  const cw = p.cellWidth / p.cols;
  const ch = p.cellHeight / p.rows;
  const cells: PatternObject['cells'] = new Array(cols * rows).fill(null);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      cells[y * cols + x] = p.cells[(y + minY) * p.cols + (x + minX)];
    }
  }
  return {
    ...p,
    cellX: p.cellX + minX * cw,
    cellY: p.cellY + minY * ch,
    cellWidth: cols * cw,
    cellHeight: rows * ch,
    cols,
    rows,
    cells,
  };
}

/** Shrinkwrap a pattern's bbox onto its occupied cells, as one undo step —
 *  applied when the object is UNSELECTED or RESELECTED (the shell watches
 *  the selection), so a grid that grew slack — an erase stroke emptied its
 *  edges, a merge left margin — never keeps dead space inside its box.
 *  Null when there is nothing to trim (shrinkwrapPatternGrid), or for a
 *  locked or grouped pattern (a member's box is the group's business). */
export function buildShrinkwrapPattern(
  state: CompositionState,
  patternId: string,
): SessionEntry | null {
  const ref = findItem(state, patternId);
  if (!ref || ref.kind !== 'pattern') return null;
  if (isItemLocked(state, patternId) || ref.item.groupId != null) return null;
  const next = shrinkwrapPatternGrid(ref.item);
  return next ? { entry: [buildReplacePatternOp(state, next)] } : null;
}

/** Clear every tile in the pattern. One undo step. */
export function buildPatternClear(
  state: CompositionState,
  patternId: string,
): SessionEntry | null {
  const grid = patternGridOf(state, patternId);
  if (!grid) return null;
  return buildEditPatternCells(state, patternId, patternClearEdits(grid));
}

/** Replace the pattern's whole grid with the armed sub-tool — a specific
 *  tile fills every cell (mirrored per the symmetry mode), anything else
 *  re-rolls the grid with connectivity-respecting random picks (see
 *  patternFloodEdits) drawn from the enabled tile sets, all in the active
 *  ink `tint`.
 *
 *  `setSymmetry` re-mirrors the pattern in the same breath: the fill lands
 *  in the new mode's orbits, and the same undo step writes that mode onto
 *  the pattern (setPatternSettings), so the brush that follows paints under
 *  the rules the flood just filled by. It is the pattern's Symmetry page —
 *  a mode is a rule about how the cells answer each other, and the cells
 *  already down were laid under the old one, so the pick re-lays them.
 *
 *  A WRAPPER rather than the flags themselves, because `{ flags: undefined }`
 *  has to mean something different from omitting it: picking Off clears the
 *  mode and fills unmirrored, where omitting it keeps whatever the pattern
 *  has (the Flood button, which changes no rules). One undo step either
 *  way. */
export function buildPatternFlood(
  state: CompositionState,
  patternId: string,
  tool: PatternSubTool,
  excludedFamilies?: Set<string>,
  tint?: RGBColor | null,
  setSymmetry?: { flags: PatternSymmetry | undefined },
): SessionEntry | null {
  const grid = patternGridOf(state, patternId);
  if (!grid) return null;
  const item = setSymmetry ? { ...grid, symmetry: setSymmetry.flags } : grid;
  const cells = buildEditPatternCells(
    state, patternId, patternFloodEdits(item, tool, excludedFamilies, tint),
  );
  const settings = setSymmetry
    ? buildSetPatternSettings(state, patternId, { symmetry: setSymmetry.flags })
    : null;
  if (!cells && !settings) return null;
  return { entry: [...(settings?.entry ?? []), ...(cells?.entry ?? [])] };
}

/** FLOOD, then CLOSE — the two grid actions the capsule offers side by
 *  side, run as ONE undo step, so the grid arrives as a finished patch of
 *  pattern rather than as a roll with open ends along its tile's borders.
 *  It is the same pair a dragged pattern region is born under
 *  (onCreatePattern's flood → repeat → close), for the grids that are not
 *  born at all: a shape's fill that opens EMPTY and is printed the moment
 *  it is opened (EditorShell's onEditTilePattern).
 *
 *  The Close reads the flooded state rather than the one passed in — both
 *  builders resolve the grid by id, so the repair is computed against the
 *  cells the flood just laid, not the ones it replaced. Null when neither
 *  half has anything to write. */
export function buildPatternFloodAndClose(
  state: CompositionState,
  patternId: string,
  tool: PatternSubTool,
  excludedFamilies?: Set<string>,
  tint?: RGBColor | null,
  setSymmetry?: { flags: PatternSymmetry | undefined },
): SessionEntry | null {
  const flood = buildPatternFlood(state, patternId, tool, excludedFamilies, tint, setSymmetry);
  const flooded = flood ? applyCompOps(state, flood.entry) : state;
  const close = buildPatternReconcile(flooded, patternId, false, excludedFamilies);
  const entry = [...(flood?.entry ?? []), ...(close?.entry ?? [])];
  return entry.length > 0 ? { entry } : null;
}

/** Whether two tile-set lists say the same thing. Compared by VALUE, for
 *  the same reason the symmetry flags are: the Shapes page hands the scene
 *  a fresh array each press, so a toggle that lands back on the standing
 *  list would otherwise push an empty undo step. Order matters — every
 *  list written here is in the registry's own family order. */
function patternTileSetsEqual(
  a: readonly string[] | undefined, b: readonly string[] | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return (a?.length ?? 0) === 0 && (b?.length ?? 0) === 0;
  return a.length === b.length && a.every((f, i) => f === b[i]);
}

/** Change a pattern's editing settings — its symmetry mode, the
 *  border-connections rule, and/or the tile sets it is made of. Every
 *  field snapshots before/after so the op round-trips exactly. */
export function buildSetPatternSettings(
  state: CompositionState,
  patternId: string,
  settings: {
    symmetry?: PatternSymmetry | undefined;
    allowBorderConnections?: boolean | undefined;
    tileSets?: string[] | undefined;
  },
): SessionEntry | null {
  const item = patternGridOf(state, patternId);
  if (!item || isItemLocked(state, patternId)) return null;
  const newSymmetry = 'symmetry' in settings ? settings.symmetry : item.symmetry;
  const newAllow = 'allowBorderConnections' in settings
    ? settings.allowBorderConnections
    : item.allowBorderConnections;
  const newTileSets = 'tileSets' in settings ? settings.tileSets : item.tileSets;
  // Symmetry compares by VALUE (patternSymmetryEqual): every pick hands the
  // scene a fresh copy of the page's flags, so a re-pick of the standing
  // mode used to read as a change and push an empty undo step. The tile
  // sets compare the same way, and for the same reason.
  if (patternSymmetryEqual(newSymmetry, item.symmetry)
    && newAllow === item.allowBorderConnections
    && patternTileSetsEqual(newTileSets, item.tileSets)) {
    return null;
  }
  return { entry: [{
    op: 'setPatternSettings', patternId,
    // A COPY into the scene: one pick across a multi-selection walks every
    // pattern through here with the same flags object, and the page's own
    // object is not the scene's to hold either way.
    oldSymmetry: item.symmetry, newSymmetry: newSymmetry ? { ...newSymmetry } : newSymmetry,
    oldAllowBorderConnections: item.allowBorderConnections,
    newAllowBorderConnections: newAllow,
    oldTileSets: item.tileSets ? [...item.tileSets] : undefined,
    newTileSets: newTileSets ? [...newTileSets] : undefined,
  }] };
}

/** Two symmetry settings flag for flag — undefined and all-off alike are
 *  "no mirror". By VALUE, not reference: a page's modes and the scene's
 *  stored flags are always separate copies. */
export function patternSymmetryEqual(
  a: PatternSymmetry | undefined, b: PatternSymmetry | undefined,
): boolean {
  return (Object.keys(PATTERN_SYMMETRY_OFF) as (keyof PatternSymmetry)[])
    .every((k) => !!a?.[k] === !!b?.[k]);
}

/** What a fresh patch is filled with: flat, opaque white. Not the active
 *  colour, which would make every patch of a run the same arbitrary hue, and
 *  not the pattern's own ink, which would paint the drawing's own colour over
 *  the page it is drawn on. */
const PATCH_FILL: RGBColor = { r: 255, g: 255, b: 255 };

/** What the Scene Outline calls the group Make Colorable leaves behind:
 *  the drawing and its patches, bound as one thing. */
export const COLORABLE_GROUP_NAME = 'Colorable';

/**
 * MAKE COLORABLE (the pattern object's Tile page): the pattern becomes a
 * plain drawing over a quilt of blank patches, the lot bound into one group
 * named Colorable ({@link COLORABLE_GROUP_NAME}), in a single undo step.
 *
 * Three things happen at once, in the order they stack on the page:
 *
 *   1. One closed shape per region the pattern's drawing cuts its own
 *      bounding box into — Patchwork's own patches, made on demand of a
 *      pattern instead of dealt by the day, over the same geometry
 *      (patternPatches.ts → planarFaces.ts, beside this), so the
 *      same promise holds: no two overlap, none is missing, and together
 *      they are exactly the bounding rectangle. They take the pattern's
 *      slot, so they lie BEHIND everything that follows.
 *   2. The pattern itself is REPLACED by the SVG object the renderer was
 *      already drawing it as (patternSVGView: the same segments, subpaths,
 *      repeat fields and presentation, so nothing on the page changes by a
 *      pixel), given an id of its own and laid over the patches. It is not
 *      a pattern any more — the grid, the tiles, the symmetry and the
 *      Tile tool's brush are gone with the object that carried them — and
 *      what is left is a merged collection of lines, editable the way any
 *      drawn shape is. A pattern that REPEATS becomes an svg that repeats
 *      (SVGObject's own tile mode, the same fields): its one tile is the
 *      drawing, stamped as before.
 *   3. The drawing and its patches are grouped, so they move as one and
 *      the outline shows one thing where the pattern was.
 *
 * The patches arrive filled SOLID WHITE ({@link PATCH_FILL}) and with NO
 * OUTLINE at all — a quilt of blank pieces under the drawing, which is what
 * a patch is for. White because it is the one colour that says "nothing has
 * been chosen here yet" rather than making a choice: recolouring one is the
 * Fill page's slider, already open on the fill the patch arrived wearing
 * instead of on an "Add Fill" button.
 *
 * Strokeless because the lines a patch was cut along are the DRAWING's, and
 * the drawing still draws them on top: an outline of its own would lay a
 * second copy of every shared edge under the first, thickening the drawing
 * the moment the patches appear and doubling again wherever two patches
 * meet. Zero width is how the renderer is told a shape has no stroke
 * (svgStrokeWidthUnits), and it opens the patch's Stroke page on Add Stroke,
 * so an outline can be put back deliberately.
 *
 * The fill is written to the editable `fill` block, built exactly the way a
 * newly drawn filled shape's is (withNewShapeStyle's `asSolidFill` over
 * `shapeFillOf`), so a patch's Fill page is the page every other shape has
 * and its gradient stops fade from the pattern's own ink like theirs do.
 *
 * Null for a LOCKED pattern, like every edit that swaps the object out
 * (buildReplacePattern): the press REPLACES it, which is exactly what the
 * lock refuses. Null for an EMPTY pattern too — there is no drawing to keep,
 * and one white patch where the box was would be a deletion under another
 * name. And null when the repeat grid is too fine to slice
 * (patternPatchOutlines' MAX_CURVES).
 */
export function buildPatternMakeColorable(
  state: CompositionState,
  patternId: string,
): SessionEntry | null {
  const ref = findItem(state, patternId);
  if (!ref || ref.kind !== 'pattern' || isItemLocked(state, patternId)) return null;
  const pattern = ref.item;
  const view = patternSVGView(pattern);
  if (!view || view.segments.length === 0) return null;
  const outlines = patternPatchOutlines(pattern);
  if (outlines.length === 0) return null;
  const color = patternInkColor(pattern) ?? view.color;
  // The pattern's slot: the patches take it in order, the drawing lands over
  // them, and the group binds the run.
  const at = Math.max(0, state.sceneOrder.indexOf(patternId));
  const patches: SVGObject[] = outlines.map((segments, i) => {
    const patch: SVGObject = {
      id: mintNodeId('svg'),
      name: patternPatchName(i),
      segments,
      // The pattern's ink, which no longer draws an outline (width 0 below)
      // but is still what the fill's gradient stops fade from, exactly as a
      // hand-drawn shape's first fill does.
      color,
      // No outline: an explicit zero-width stroke, NOT an absent one — a
      // missing block means the composition-wide default width, which is a
      // line.
      stroke: { width: 0 },
      ...computeSVGBbox(segments),
    };
    patch.fill = asSolidFill(shapeFillOf(patch), PATCH_FILL, 1) as ShapeFill;
    return patch;
  });
  // The drawing: the renderer's view, which is a CACHED object shared with
  // every draw site, so its geometry is cloned before it becomes a node the
  // editor will write to. It arrives wearing the pattern's groupId with no
  // local geometry behind it; the group below re-parents it and takes the
  // local snapshots, so it is placed loose.
  const drawing: SVGObject = {
    ...view,
    id: mintNodeId('svg'),
    segments: view.segments.map(clonePathSegment),
  };
  if (view.subpaths) {
    drawing.subpaths = view.subpaths.map((sub) => ({ ...sub, segments: sub.segments.map(clonePathSegment) }));
  }
  delete drawing.groupId;
  const entry: CompUndoOp[] = [
    { op: 'removeObject', kind: 'pattern', item: pattern, sceneOrderIndex: at },
    ...patches.map((patch, i): CompUndoOp => (
      { op: 'placeObject', kind: 'svg', sceneOrderIndex: at + i, item: patch }
    )),
    { op: 'placeObject', kind: 'svg', sceneOrderIndex: at + patches.length, item: drawing },
    {
      op: 'groupFigures',
      figureIds: [...patches.map((p) => p.id), drawing.id],
      groupId: mintNodeId('group'),
      groupName: COLORABLE_GROUP_NAME,
    },
  ];
  // A pattern that was its group's last member leaves that group empty;
  // the prune drops it (and undo restores it, removeGroup).
  return { entry: withGroupPruning(state, entry), id: drawing.id };
}

/** Place a preset shape (shapePresets.ts) filling `bbox`. */
export function buildPlaceShape(
  kind: ShapePresetKind,
  bbox: CellBbox,
  color: RGBColor,
  options?: ShapePresetOptions & { fillColor?: RGBColor; fillPaint?: Paint; name?: string },
): SessionEntry {
  const id = mintNodeId('svg');
  const svg = buildShapeSVGObject(id, kind, bbox, color, options);
  if (options?.name) svg.name = options.name;
  return { entry: [{ op: 'placeObject', kind: 'svg', item: svg }], id };
}

/** Drop consecutive points closer than `minDist` cells (pointer-trail
 *  thinning for the draw tool); first and last points always survive. */
export function filterPolylinePoints(
  points: ReadonlyArray<[number, number]>,
  minDist: number,
): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const last = out[out.length - 1];
    if (!last || i === points.length - 1 || Math.hypot(p[0] - last[0], p[1] - last[1]) >= minDist) {
      out.push([p[0], p[1]]);
    }
  }
  return out;
}

// ── Line / arc shape tools (ported from Facet) ──────────────────────
// The geometry helpers below are the ONE source of truth for what a shape
// drag draws: the canvas's live preview and the commit builders both call
// them, so the preview can never drift from what lands on the page (Facet
// keeps two copies of this math — its draft-SVG builders and its finalize
// handlers — and they have to be kept in lockstep by hand).

/**
 * Geometry for a line-tool drag between the drag's two corners.
 *
 * A drag within 15° of an axis (Facet's `detectLineDirection` zones) commits
 * a PERFECT horizontal / vertical line — the perpendicular delta is dropped,
 * so the stroke lands exactly on the start point's axis whether or not Grid
 * Snap quantized the endpoints. Those lines carry Facet's H/V metadata:
 * `lineDirection`, and a `creationBox` one grid step thick straddling the
 * stroke — the wider box the selection UI and hit test use, and the anchor
 * for axis-locked endpoint pulls (see {@link resolveSelectionBox}).
 *
 * Everything else stays FREEFORM: a steeper drag is the straight segment
 * between the corners at whatever angle it was drawn (no metadata — its
 * segment AABB is the whole truth), and 'rectangle' is the closed 4-segment
 * box over them.
 *
 * Grid Snap adds nothing here: it lands the two corners on intersections
 * before they arrive (snapPoint, the one creation snap every shape tool
 * shares) and leaves the angle between them to the drag, on the grid or off.
 */
export function lineShapeGeometry(
  start: readonly [number, number],
  end: readonly [number, number],
  mode: 'line' | 'rectangle',
  gridLevel: number,
): {
  segments: PathSegment[];
  creationBox?: { minX: number; minY: number; width: number; height: number };
  lineDirection?: 'horizontal' | 'vertical';
} {
  if (mode === 'rectangle') {
    return { segments: computeRectSegments(start[0], start[1], end[0], end[1]) };
  }
  const direction = detectLineDirection(end[0] - start[0], end[1] - start[1]);
  if (direction === 'diagonal') {
    return {
      segments: [{ kind: 'line', start: [start[0], start[1]], end: [end[0], end[1]] }],
    };
  }
  // Perpendicular thickness of the creation box: one step of the ACTIVE grid
  // (independent of the snap toggle — the grid resolution is always defined),
  // matching Facet's box shape so downstream box math is identical.
  const step = compSnapStep(gridLevel);
  if (direction === 'horizontal') {
    const y = start[1];
    return {
      segments: [{ kind: 'line', start: [start[0], y], end: [end[0], y] }],
      creationBox: {
        minX: Math.min(start[0], end[0]), minY: y - step / 2,
        width: Math.abs(end[0] - start[0]), height: step,
      },
      lineDirection: 'horizontal',
    };
  }
  const x = start[0];
  return {
    segments: [{ kind: 'line', start: [x, start[1]], end: [x, end[1]] }],
    creationBox: {
      minX: x - step / 2, minY: Math.min(start[1], end[1]),
      width: step, height: Math.abs(end[1] - start[1]),
    },
    lineDirection: 'vertical',
  };
}

/**
 * Geometry for an arc-tool drag — the same rule on both of its modes, and
 * the box is whatever the finger drew either way.
 *
 * 'arc' is the single quarter curve the drag described (`center` comes from
 * the gesture's pickCenter, which decides which way it bulges): the exact
 * arc segment on a square box, a polyline quarter-ellipse on any other
 * (computeQuarterArcSegments). 'circle' inscribes a closed OVAL in the same
 * box the same way — four exact arcs when it is square, a polyline ellipse
 * when it is not (computeOvalSegments).
 *
 * Both split for the one reason: an arc segment is a quarter CIRCLE by
 * construction, so around a rectangular box it comes out kinked rather than
 * elliptical. That used to be answered by squaring the arc's drag off
 * before it got here, which made the arc the one shape on the bar whose
 * proportions were not the drawer's to choose. A polyline can be the
 * ellipse exactly, so now it is drawn instead and the drag is free.
 */
export function arcShapeSegments(
  start: readonly [number, number],
  end: readonly [number, number],
  center: readonly [number, number],
  mode: 'arc' | 'circle',
): PathSegment[] {
  const box = unflattenedArcBox(start, end, center);
  if (mode === 'circle') {
    return computeOvalSegments(start[0], start[1], box.end[0], box.end[1]);
  }
  return computeQuarterArcSegments(start, box.end, box.center);
}

/**
 * The arc tool's far corner, pushed off `start` on any axis the drag left
 * THINNER THAN A CELL — and the bulge corner that goes with it.
 *
 * A quarter curve on a box with no height is the straight line between its
 * own ends (every polyline sample lands on it, and the exact-arc form comes
 * out with radius zero); a zero-extent oval is the same nothing. The tool
 * used to answer that by committing NOTHING for such a drag, which put an
 * arc on screen under the finger and then took it away on release — the
 * one gesture in the editor whose preview was not what it placed.
 *
 * So the box is opened instead of the shape being dropped, and the floor is
 * {@link MIN_ARC_CELLS} — a whole visible cell, the same floor a corner
 * handle bottoms an arc out at, so the thinnest arc that can be DRAWN is
 * exactly the thinnest one that can be pulled to, and nothing is placed that
 * a handle could not then have made. It used to be resizeMath's own floor, a tenth
 * of a cell, applied only to an axis that was EXACTLY flat: a drag a twentieth
 * of a cell high was left alone and placed a curve indistinguishable from the
 * line through its ends — the very shape the opening exists to prevent.
 *
 * The opened corner goes the way the drag went (a leftward drag opens
 * further left), so the curve stays on the side of `start` the finger chose;
 * an axis with no direction at all opens positive.
 *
 * The centre is re-picked (`pickCenter`) whenever the box moved, because
 * the one the gesture chose is a corner of the box BEFORE it opened: on a
 * flat box both candidates sit on the drag's own line, and carrying either
 * one over would aim the curve at a corner the box no longer has. It is the
 * same call the gesture itself makes on every move, so the re-pick is the
 * gesture's own rule applied to the box that will actually be placed.
 *
 * Both modes, one rule — the arc tool's two dresses fill the same box, and
 * an oval dragged flat vanished for the very same reason.
 *
 * The PREVIEW comes through here too (`arcShapeSegments` is what the draft
 * path is drawn from), so the opened box is on screen under the finger
 * before the release commits it: what is drawn is what lands.
 */
function unflattenedArcBox(
  start: readonly [number, number],
  end: readonly [number, number],
  center: readonly [number, number],
): { end: readonly [number, number]; center: readonly [number, number] } {
  const thinX = Math.abs(end[0] - start[0]) < MIN_ARC_CELLS;
  const thinY = Math.abs(end[1] - start[1]) < MIN_ARC_CELLS;
  if (!thinX && !thinY) return { end, center };
  const out = (axis: 0 | 1) => (end[axis] < start[axis] ? -MIN_ARC_CELLS : MIN_ARC_CELLS);
  const opened: [number, number] = [
    thinX ? start[0] + out(0) : end[0],
    thinY ? start[1] + out(1) : end[1],
  ];
  return { end: opened, center: pickCenter(start[0], start[1], opened[0], opened[1]) };
}

/** Is this node a CURVE the arc tool made — its quarter arc, or the oval its
 *  other mode inscribes in the same box?
 *
 *  Asked by the corner-resize gesture, which floors such a node's box at
 *  {@link MIN_ARC_CELLS} instead of letting it collapse to a sliver. Read
 *  from the geometry ({@link svgSubtype}), which is the only place the
 *  answer lives: an arc carries no `shapeKind` tag.
 *
 *  So it answers for the EXACT forms — one arc segment, or a closed run of
 *  them. A curve already stretched off its own aspect has shed its arcs for
 *  the polyline of the ellipse it became (`flattenArcs`) and is a stroke
 *  from then on, here as everywhere else. */
export function isArcCurveNode(state: CompositionState, nodeId: string): boolean {
  const ref = findItem(state, nodeId);
  if (ref?.kind !== 'svg') return false;
  const sub = svgSubtype(ref.item);
  return sub === 'arc' || sub === 'circle';
}

/** Commit a line-tool drag as an SVGObject (Facet's handleLineDragFinalize).
 *  A zero-length drag — including one collapsed by the H/V axis forcing —
 *  commits nothing. */
export function buildPlaceLineShape(
  start: readonly [number, number],
  end: readonly [number, number],
  color: RGBColor,
  mode: 'line' | 'rectangle',
  gridLevel: number,
): SessionEntry | null {
  if (start[0] === end[0] && start[1] === end[1]) return null;
  const { segments, creationBox, lineDirection } = lineShapeGeometry(start, end, mode, gridLevel);
  const first = segments[0];
  if (segments.length === 1 && first.start[0] === first.end[0] && first.start[1] === first.end[1]) return null;
  const id = mintNodeId('svg');
  const svg: SVGObject = {
    id,
    name: mode === 'rectangle' ? 'rectangle' : 'line',
    ...(mode === 'rectangle' ? { shapeKind: 'rectangle' as const } : {}),
    segments,
    color,
    ...computeSVGBbox(segments),
    ...(creationBox ? { creationBox } : {}),
    ...(lineDirection ? { lineDirection } : {}),
  };
  return { entry: [{ op: 'placeObject', kind: 'svg', item: svg }], id };
}

/** Geometry for a polygon-tool drag. 4 sides is the axis-aligned RECTANGLE
 *  filling the box: the point-up rule every other count follows would make a
 *  diamond whose sides face the corners, which is not the box anyone
 *  dragging one means. Every other count is a point-up N-gon inscribed in
 *  the box — regular on a square drag, stretched to fill any other. (Grid
 *  Snap used to force that square box; it no longer forces any, so a
 *  regular hexagon is a square DRAG rather than a snapped one.) Shared by
 *  the CanvasSurface draft and the commit below so the preview is exactly
 *  what lands. */
export function polygonShapeSegments(
  start: readonly [number, number],
  end: readonly [number, number],
  sides: number,
): PathSegment[] {
  // The Shape modal's parametric picks ride the same scalar (toolbarMeta's
  // sentinels): a closed heart, a closed star, an open spiral, a closed
  // right triangle, the two closed half shapes — a semicircle and a
  // semi-torus — and the two closed quarter shapes.
  if (polygonIsHeart(sides)) return computeHeartSegments(start[0], start[1], end[0], end[1]);
  if (polygonIsStar(sides)) return computeStarSegments(start[0], start[1], end[0], end[1]);
  if (polygonIsSpiral(sides)) return computeSpiralSegments(start[0], start[1], end[0], end[1]);
  if (polygonIsRightTriangle(sides)) return computeRightTriangleSegments(start[0], start[1], end[0], end[1]);
  if (polygonIsSemicircle(sides)) return computeSemicircleSegments(start[0], start[1], end[0], end[1]);
  if (polygonIsSemiTorus(sides)) return computeSemiTorusSegments(start[0], start[1], end[0], end[1]);
  if (polygonIsQuarterCircle(sides)) return computeQuarterCircleSegments(start[0], start[1], end[0], end[1]);
  if (polygonIsQuarterTorus(sides)) return computeQuarterTorusSegments(start[0], start[1], end[0], end[1]);
  if (sides === 4) return computeRectSegments(start[0], start[1], end[0], end[1]);
  return computeRegularPolygonSegments(start[0], start[1], end[0], end[1], sides);
}

/** Commit a polygon-tool drag as an SVGObject. The 4-side shape IS a
 *  rectangle — the same geometry the line tool's rectangle mode draws — so
 *  it takes the rectangle tag (and with it the rectangle's selection and
 *  move-snap behavior) rather than a parallel polygon-tagged twin, and it is
 *  NAMED for what the drag actually made: a square on a square box, a
 *  rectangle on a freeform one. Every other count is tagged 'polygon' so the
 *  subtype — and with it the Stroke / Fill / Opacity menu — survives
 *  resizing and renames. A drag with no extent commits nothing. */
export function buildPlacePolygonShape(
  start: readonly [number, number],
  end: readonly [number, number],
  sides: number,
  color: RGBColor,
): SessionEntry | null {
  if (start[0] === end[0] || start[1] === end[1]) return null;
  const segments = polygonShapeSegments(start, end, sides);
  const boxy = sides === 4;
  const evenSided = Math.abs(end[0] - start[0]) === Math.abs(end[1] - start[1]);
  const heart = polygonIsHeart(sides);
  const spiral = polygonIsSpiral(sides);
  const star = polygonIsStar(sides);
  const rightTriangle = polygonIsRightTriangle(sides);
  const semicircle = polygonIsSemicircle(sides);
  const semiTorus = polygonIsSemiTorus(sides);
  const quarterCircle = polygonIsQuarterCircle(sides);
  const quarterTorus = polygonIsQuarterTorus(sides);
  const id = mintNodeId('svg');
  const svg: SVGObject = {
    id,
    name: heart ? 'heart'
      : star ? 'star'
      : spiral ? 'spiral'
      : rightTriangle ? 'right triangle'
      : semicircle ? 'semicircle'
      : semiTorus ? 'semi-torus'
      : quarterCircle ? 'quarter circle'
      : quarterTorus ? 'quarter torus'
      : boxy ? (evenSided ? 'square' : 'rectangle') : 'polygon',
    // A heart, a star, a right triangle, the half shapes and the quarter
    // shapes are closed regions like any polygon, so they take the polygon
    // tag (and its Stroke / Fill / Opacity menu). The spiral is an OPEN
    // stroke — no interior — so it carries no shapeKind and falls to the
    // open path's menus, exactly as a freehand stroke does.
    ...(spiral ? {} : { shapeKind: (boxy ? 'rectangle' : 'polygon') as SVGObject['shapeKind'] }),
    segments,
    color,
    ...computeSVGBbox(segments),
  };
  return { entry: [{ op: 'placeObject', kind: 'svg', item: svg }], id };
}

// ── The remembered shape style ──────────────────────────────────────

/**
 * What a freshly drawn shape is born wearing: whatever the last shape the
 * user styled was wearing.
 *
 * Drawing shapes is repetitive — six filled circles, a row of outlined
 * boxes — and without this every one of them arrives in the factory style
 * and has to be filled (or un-outlined) by hand before the next. Everything
 * the Fill and Stroke bars can say about a shape is carried: whether it has
 * a fill and an outline, how wide, how dashed and how aligned that outline
 * is, and — the part the shared active-colour memory CANNOT carry — the
 * two inks, which a shape holds separately. That memory holds one colour,
 * so a red fill and a blue outline collapse into whichever was picked
 * last; `fill` and `strokeColor` are what keep them apart.
 *
 * The STROKE half is one memory for everything that has a stroke — a line,
 * an arc, a freehand mark, a polygon, a box, a tile pattern: set the
 * stroke on any of them and the next one of any of them is born in it
 * (withNewShapeStyle, seededPatternStroke). The fill half is the closed
 * shapes' alone.
 */
export interface NewShapeStyle {
  /** The last shape the user touched carried a fill. */
  filled: boolean;
  /** …and an outline. False only once a stroke has been zeroed or trashed. */
  outlined: boolean;
  /**
   * …and an outline THIS WIDE, in world cells. Undefined until a width is
   * actually authored, which is why it is optional rather than seeded from
   * the composition default: an unauthored width leaves a new SHAPE with no
   * explicit stroke block at all (the legacy strokeScale default), while an
   * authored one is written onto it.
   *
   * Zero is never stored here. A zeroed outline is what `outlined` is for,
   * and remembering 0 as a width would open the next pattern invisible.
   */
  strokeWidth?: number;
  /**
   * …dashed THIS densely (SVGStroke.dash, 0–10; 0 = solid). Undefined until
   * the Stroke bar has been left somewhere, which is why it is optional:
   * unauthored, a new object carries no dash field at all.
   */
  strokeDash?: number;
  /**
   * …aligned THIS way against the path (SVGStroke.position). Meaningful
   * only on a closed shape — an open path has no inside — so it is written
   * onto the fill-bar subtypes alone. Undefined until authored.
   */
  strokePosition?: BorderPosition;
  /**
   * The fill the last-dressed shape wore, kept WHOLE rather than as a
   * colour: a gradient the user built comes back a gradient, stops, angle
   * and all. Undefined until a fill is authored → a flat wash of the active
   * colour, which is what a first fill has always been.
   */
  fill?: ShapeFill;
  /**
   * The ink of the last OUTLINE the user set, which for a vector object is
   * its `color` field. Undefined → the active colour.
   *
   * This exists because the Fill swatch and the Stroke swatch both feed the
   * one active-colour memory: without it, colouring a fill red immediately
   * after colouring an outline blue leaves the next shape blue-filled and
   * blue-edged. Picking a colour for the BRUSH clears it (see the shell's
   * clearNewShapeInk) so a general pick still governs.
   */
  strokeColor?: RGBColor;
}

/** A fresh editor draws outlines, no fill — the factory shape. */
export const DEFAULT_NEW_SHAPE_STYLE: NewShapeStyle = { filled: false, outlined: true };

/**
 * The factory shape, opened at the line weight a FORMAT asks for
 * (EditorConfig.openingStrokeWidthPt — the Response's marks are read at
 * 40pt, where the default reads as a smudge). Undefined → the factory
 * shape itself, which is every other format.
 *
 * The one place pt becomes cells. A format states the width the Stroke
 * bar's readout SHOWS (design pt, 0–24); this memory is in world cells,
 * a sixteenth of that. Handing the pt number straight over opened a
 * Response at 23 CELLS — the readout said 368 — so the division lives
 * here, once, rather than at each format that ever wants a weight.
 */
export function openingNewShapeStyle(
  openingStrokeWidthPt?: number,
  /** …and the fill / outline a FORMAT's closed shapes are born with
   *  (EditorConfig.openingShapeStyle — Shadows deals filled, unoutlined
   *  cut-outs). Undefined → the factory outline. */
  openingShapeStyle?: { filled: boolean; outlined: boolean },
): NewShapeStyle {
  if (openingStrokeWidthPt === undefined && openingShapeStyle === undefined) {
    return DEFAULT_NEW_SHAPE_STYLE;
  }
  return {
    ...DEFAULT_NEW_SHAPE_STYLE,
    ...(openingShapeStyle ? { filled: openingShapeStyle.filled, outlined: openingShapeStyle.outlined } : {}),
    ...(openingStrokeWidthPt !== undefined ? { strokeWidth: openingStrokeWidthPt / BASE_CELL_PX } : {}),
  };
}

/**
 * The line weight a NEW pattern object opens at: the last width the user
 * authored on anything wearing the Stroke bar, or — until they have set one
 * — the composition-wide vector default, EXACTLY the weight a first
 * rectangle draws at. The first pattern and the first shape of a session
 * must come up in the same line; only the pattern needs it written down
 * (an explicit width from birth is what keeps a repeat toggle from
 * changing the drawn weight — see PatternObject.stroke).
 */
export function newPatternStrokeWidth(
  style: NewShapeStyle,
  compDefaultWidthCells: number,
): number {
  return style.strokeWidth ?? compDefaultWidthCells;
}

/** The stroke block a fresh pattern (or Tile-tool tile) is born with: the
 *  remembered width via {@link newPatternStrokeWidth}, with the composition
 *  default expressed in world cells — one definition, so the shell's
 *  create-pattern handler and the canvas's tile stamps can never seed
 *  different weights — and the remembered dash, once one has been set
 *  (a pattern's tiles draw dashed like any other stroke). */
export function seededPatternStroke(
  style: NewShapeStyle,
  strokeScale: number,
): SVGStroke {
  return {
    width: newPatternStrokeWidth(style, svgStrokeWidthCells({}, strokeScale, BASE_CELL_PX)),
    ...(style.strokeDash != null ? { dash: style.strokeDash } : null),
  };
}

/** The ink a new stroke-bearing object is born in — and its draft drawn
 *  in, so nothing changes colour on release: the outline ink the Stroke
 *  swatch last set, else the active colour. The same choice
 *  {@link withNewShapeStyle} makes for the committed object's `color`. */
export function newShapeDraftColor(style: NewShapeStyle, active: RGBColor): RGBColor {
  return style.strokeColor ? toRGB(style.strokeColor) : active;
}

/**
 * Dress a just-built svg placement in the remembered style, falling back to
 * `color` (the active ink) for anything the style has no memory of.
 *
 * EVERYTHING with a stroke takes the stroke half — a line, an arc, a
 * freehand mark, a polygon, a box: the outline ink, width and dash the
 * user last set on any of them is what the next one is born in (and the
 * alignment too, on the closed shapes that have an inside for it to mean
 * anything). Only the fill-bar subtypes (rectangle / circle / polygon —
 * `svgHasFill`) take the FILL half, and only they can lose their outline
 * to it: a line and an arc have no interior, so "filled" says nothing
 * about them, and zeroing their stroke would leave nothing on the page at
 * all. Anything that isn't a single svg placement passes through
 * untouched, so a caller can hand this every commit without asking.
 */
export function withNewShapeStyle(
  se: SessionEntry | null,
  style: NewShapeStyle,
  color: RGBColor,
): SessionEntry | null {
  if (!se || se.entry.length !== 1) return se;
  const op = se.entry[0];
  if (op.op !== 'placeObject' || op.kind !== 'svg') return se;
  const item = op.item as SVGObject;
  const hasFill = svgHasFill(svgSubtype(item));
  const next: SVGObject = { ...item };
  let dressed = false;
  // The outline's ink IS the object's colour. Only override when a stroke
  // colour was actually authored; otherwise the object keeps the active one
  // it was built in (newShapeDraftColor — the draft made the same choice).
  if (style.strokeColor) {
    next.color = toRGB(style.strokeColor);
    dressed = true;
  }
  if (hasFill && style.filled) {
    // A remembered fill is replayed whole (gradients included); the first
    // fill of a session is a flat wash of the ink the shape was drawn in.
    next.fill = style.fill ?? (asSolidFill(shapeFillOf(item), color, 1) as ShapeFill);
    dressed = true;
  }
  const stroke: SVGStroke = { ...item.stroke };
  let strokeTouched = false;
  if (hasFill && !style.outlined && style.filled) {
    // A shape with no outline still needs an interior to be visible at all —
    // an unfilled, unstroked box is nothing. Remembering "no outline" from a
    // filled shape and applying it to an unfilled one would draw a hole, so
    // the outline only goes when the fill is there to take its place.
    stroke.width = 0;
    strokeTouched = true;
  } else if (style.strokeWidth != null && (style.outlined || !hasFill)) {
    // The weight the Stroke bar was last left at. Undefined until one is
    // set, which leaves the composition-wide default in place. An open path
    // takes it whatever `outlined` says: it IS its stroke, and the width
    // remembered is always the last real one (a zeroing is never stored).
    stroke.width = style.strokeWidth;
    strokeTouched = true;
  }
  if (style.strokeDash != null) {
    stroke.dash = style.strokeDash;
    strokeTouched = true;
  }
  if (hasFill && style.strokePosition != null) {
    stroke.position = style.strokePosition;
    strokeTouched = true;
  }
  if (strokeTouched) {
    next.stroke = stroke;
    dressed = true;
  }
  return dressed ? { ...se, entry: [{ ...op, item: next }] } : se;
}

/**
 * The stroke width (world cells) the COMMITTED object will render at — for
 * the drag draft, so a shape never draws at one weight under the finger
 * and snaps to another on release. Mirrors {@link withNewShapeStyle}'s
 * width logic exactly: every subtype takes the remembered width — an open
 * path (line, arc, freehand stroke) always, a fill-bar subtype while it is
 * outlined — a filled no-outline style commits a closed shape at width 0,
 * and an unauthored width falls back to the default the markup uses.
 */
export function newShapeDraftWidthCells(
  style: NewShapeStyle,
  subtype: SVGSubtype,
  strokeScale: number,
): number {
  const fallback = svgStrokeWidthCells({}, strokeScale, BASE_CELL_PX);
  if (!svgHasFill(subtype) || style.outlined) {
    return style.strokeWidth != null ? style.strokeWidth : fallback;
  }
  return style.filled ? 0 : fallback;
}

/** The fill a shape draft draws, in the DOM's terms: the colour and the
 *  layer's opacity, or null for a draft with no fill. */
export interface DraftFill {
  color: RGBColor;
  opacity: number;
}

/**
 * The FILL the COMMITTED object will wear — for the drag draft, so a shape
 * that lands filled looks filled under the finger rather than as a
 * wireframe that floods the moment the drag ends. Mirrors
 * {@link withNewShapeStyle}'s fill rule exactly: only a fill-bar subtype
 * (rectangle / circle / polygon — `svgHasFill`) takes a fill, and only
 * while the remembered style says `filled`. A remembered fill is worn as
 * its own solid at its own opacity — a gradient's first stop stands in for
 * the sweep, which a live-mutated draft path has no defs to draw — and an
 * unauthored one is the flat wash of the ACTIVE ink at full opacity, which
 * is what the commit paints (`asSolidFill(…, color, 1)`). Null for an open
 * path or an unfilled style: the draft draws no fill, exactly as the commit
 * will have none.
 */
export function newShapeDraftFill(
  style: NewShapeStyle,
  subtype: SVGSubtype,
  active: RGBColor,
): DraftFill | null {
  if (!svgHasFill(subtype) || !style.filled) return null;
  const fill = style.fill;
  if (!fill) return { color: toRGB(active), opacity: 1 };
  const color = fill.type === 'solid' ? fill.solid : (fill.stops[0]?.color ?? fill.solid);
  return { color: toRGB(color), opacity: fill.opacity };
}

/** Commit an arc-tool drag as an SVGObject (Facet's handleArcDragFinalize).
 *  A zero-length drag commits nothing — a tap is not a shape.
 *
 *  A drag flat on ONE axis still is: both modes fill a box, and freeform
 *  creation can drag that box flat, which used to commit nothing at all and
 *  so erased a curve the preview had been drawing all along. The box is
 *  opened to the smallest one a handle could resize to instead
 *  (`unflattenedArcBox`), inside the geometry the preview shares, so what
 *  lands is what was under the finger. */
export function buildPlaceArcShape(
  start: readonly [number, number],
  end: readonly [number, number],
  center: readonly [number, number],
  color: RGBColor,
  mode: 'arc' | 'circle',
): SessionEntry | null {
  if (start[0] === end[0] && start[1] === end[1]) return null;
  const segments = arcShapeSegments(start, end, center, mode);
  const id = mintNodeId('svg');
  const svg: SVGObject = {
    id,
    name: mode === 'circle' ? 'circle' : 'arc',
    segments,
    color,
    ...computeSVGBbox(segments),
  };
  return { entry: [{ op: 'placeObject', kind: 'svg', item: svg }], id };
}

/** Place a freehand polyline as a non-closed SVGObject. */
export function buildPlacePolyline(
  points: ReadonlyArray<[number, number]>,
  color: RGBColor,
): SessionEntry | null {
  if (points.length < 2) return null;
  const segments: PathSegment[] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (i > 0) {
      segments.push({ kind: 'line', start: [...points[i - 1]], end: [x, y] });
    }
  }
  if (segments.length === 0) return null;
  const id = mintNodeId('svg');
  const svg: SVGObject = {
    id, segments, color,
    cellX: minX, cellY: minY, cellWidth: maxX - minX, cellHeight: maxY - minY,
  };
  return { entry: [{ op: 'placeObject', kind: 'svg', item: svg }], id };
}

/**
 * Place an imported image. `imageId`/bytes come from the engine's
 * `prepareImageImport` pipeline (decode + ≤1024 px downsample + re-encode);
 * only the node id is minted here. When the source exceeded the display cap
 * the pipeline also hands back a higher-res original (`originalImageId` +
 * `originalBytes`) — pass it through so export can reach full resolution; it
 * rides the same imageBlobs map but the canvas never decodes it. `placeObject`
 * does not carry pixel bytes, so the blob(s) ride the SessionEntry and
 * `commit` merges them into `state.imageBlobs` in the same step (see
 * SessionEntry.blobs for the undo/persistence contract).
 */
export function buildPlaceImage(
  imageId: string,
  mimeType: ImageMimeType,
  pixelWidth: number,
  pixelHeight: number,
  targetCell: CellBbox,
  blobBytes: Uint8Array | undefined,
  options?: { name?: string; originalImageId?: string; originalBytes?: Uint8Array },
): SessionEntry {
  const id = mintNodeId('image');
  const image: ImageObject = {
    id,
    imageId,
    mimeType,
    pixelWidth,
    pixelHeight,
    ...targetCell,
    // Born scale-to-fill ({@link COVER_FRAMING}, the engine's): dragging the
    // bounding box afterwards crops the picture, it cannot stretch it. Only a
    // REAL image gets the record — the unset photo placeholder (no bytes) stays
    // bare, so the "no image" mountain keeps its plain contain rendering. An
    // unframed node draws as cover anyway (effectiveFraming), so the record is
    // the node SAYING what it is rather than the thing that makes it so.
    ...(blobBytes ? { framing: { ...COVER_FRAMING } } : null),
  };
  if (options?.name) image.name = options.name;
  // Full-res original (when the source exceeded the display cap) rides the
  // same imageBlobs map under its own id; export reads it, the canvas doesn't.
  // No bytes → no blob entry (an empty blob would render as a broken 0-byte
  // image rather than the un-set mountain placeholder): the un-filled photo
  // slot resolves to an empty `src` on purpose.
  const blobs: Record<string, Uint8Array> = blobBytes ? { [imageId]: blobBytes } : {};
  if (options?.originalImageId && options.originalBytes) {
    image.originalImageId = options.originalImageId;
    blobs[options.originalImageId] = options.originalBytes;
  }
  return {
    entry: [{ op: 'placeObject', kind: 'image', item: image }],
    id,
    blobs,
  };
}

/** Place an UNFILLED photo placeholder (an image node with the sentinel
 *  imageId and no bytes, so it draws the "no image" mountain) occupying
 *  `targetCell` verbatim — the photos tool's drag-to-place commits this on
 *  release, before any picker opens. The sentinel is what makes the node
 *  tap-to-fill (isUnfilledPhotoPlaceholder → the replace picker), so the
 *  dragged box survives even when the browser refuses to open a file dialog
 *  from a drag-release (WebKit only honors "potential click" gestures). */
export function buildPlacePhotoPlaceholder(targetCell: CellBbox, placeholder: PhotoPlaceholder): SessionEntry {
  return buildPlaceImage(
    placeholder.imageId, placeholder.mime, placeholder.pixelW, placeholder.pixelH,
    targetCell, undefined,
  );
}

/** The unfilled photo placeholder as the APP spells it (its
 *  web/formats/photoPlaceholder.ts): the sentinel imageId its pages carry —
 *  persisted, so it stays the app's own word — with the mime and the pixel
 *  box the "no image" mountain is drawn at. */
export interface PhotoPlaceholder {
  imageId: string;
  mime: ImageMimeType;
  pixelW: number;
  pixelH: number;
}

/** Aspect-preserving containment of a pixelW×pixelH bitmap inside `bbox`,
 *  centered. The single source of truth for fitting an image into a target
 *  rect — slot fills and content replacement both use it. */
export function containBboxInto(
  bbox: CellBbox,
  pixelWidth: number,
  pixelHeight: number,
): CellBbox {
  const scale = Math.min(bbox.cellWidth / pixelWidth, bbox.cellHeight / pixelHeight);
  const w = pixelWidth * scale;
  const h = pixelHeight * scale;
  return {
    cellX: bbox.cellX + (bbox.cellWidth - w) / 2,
    cellY: bbox.cellY + (bbox.cellHeight - h) / 2,
    cellWidth: w,
    cellHeight: h,
  };
}

/**
 * Replace the pixels of an existing image node in place — same node id, same
 * box, keeping rotation / mirror / opacity / tint / name — with a freshly
 * imported bitmap. The incoming bytes are the FULL downsampled image (see
 * `prepareImageReplacement`); the node's bbox is left untouched and its framing
 * is set to plain cover ({@link COVER_FRAMING}) so the whole bitmap cover-fits
 * the box with the overflow clipped, not discarded — Crop mode can still reach
 * it. Bytes ride the SessionEntry like `buildPlaceImage`. There is no granular
 * image-content op, so this rides `replaceScene` (as image rename and text
 * transforms do). Returns null for a missing / non-image / locked target.
 */
export function buildReplaceImageContent(
  state: CompositionState,
  nodeId: string,
  imageId: string,
  mimeType: ImageMimeType,
  pixelWidth: number,
  pixelHeight: number,
  blobBytes: Uint8Array,
  options?: { originalImageId?: string; originalBytes?: Uint8Array },
): SessionEntry | null {
  const ref = findItem(state, nodeId);
  if (!ref || ref.kind !== 'image' || isItemLocked(state, ref.item.id)) return null;
  // The new imageId invalidates any old original — always overwrite the field
  // (undefined when the replacement fit the display cap) so it never dangles.
  const originalImageId = options?.originalImageId && options.originalBytes
    ? options.originalImageId
    : undefined;
  const images = (state.images ?? []).map((i) => (i.id === nodeId
    ? { ...i, imageId, originalImageId, mimeType, pixelWidth, pixelHeight, framing: { ...COVER_FRAMING } }
    : i));
  const blobs: Record<string, Uint8Array> = { [imageId]: blobBytes };
  if (originalImageId) blobs[originalImageId] = options!.originalBytes!;
  return {
    entry: [buildReplaceSceneOp(state, { images })],
    blobs,
  };
}

/** Corner rounding is stored as a fraction (0–0.5) of the image's shorter
 *  side: 0 = sharp, 0.5 = fully rounded (circle for a square). */
export const MAX_CORNER_RADIUS = 0.5;

/** Set the selected image's corner radius, non-undoably — used for the live
 *  slider preview. Clamps to [0, MAX_CORNER_RADIUS] and clears the field at 0
 *  so square images stay clean in the JSON. Returns state unchanged for a
 *  missing / non-image node (locked images are frozen — see the commit guard
 *  in buildSetImageCornerRadius). */
export function withImageCornerRadius(
  state: CompositionState,
  nodeId: string,
  radius: number,
): CompositionState {
  const clamped = Math.max(0, Math.min(MAX_CORNER_RADIUS, radius));
  return {
    ...state,
    images: (state.images ?? []).map((i) => (i.id === nodeId
      ? { ...i, cornerRadius: clamped > 0 ? clamped : undefined }
      : i)),
  };
}

// ── Vector (SVG) stroke ─────────────────────────────────────────────
// The Stroke bar's Width / Radius / Position / Dash rows write the object's
// own `stroke` block. Live drags go through `withSVGStroke` (non-undoable) and
// the release commits one `replaceScene` step, the same coalescing as the
// image corner radius and the effect bars.

/** Drop fields that are at their default so an object the user opened the bar
 *  on but didn't change keeps an absent (not empty) stroke block, and a stroke
 *  reset to defaults stops being persisted at all. Returns undefined when
 *  nothing is left to store. */
function normalizeSVGStroke(stroke: SVGStroke | null | undefined): SVGStroke | undefined {
  if (!stroke) return undefined;
  const next: SVGStroke = {};
  if (stroke.width != null && stroke.width >= 0) next.width = stroke.width;
  if (stroke.radius != null && stroke.radius > 0) next.radius = Math.min(MAX_CORNER_RADIUS, stroke.radius);
  if (stroke.position != null && stroke.position !== 'center') next.position = stroke.position;
  if (stroke.dash != null && stroke.dash > 0) next.dash = Math.max(0, Math.min(10, Math.round(stroke.dash)));
  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * A shape whose PATTERN FILL has no width of its own, given the one it is
 * currently drawing at — called just before the shape's own outline width
 * moves under it.
 *
 * A pattern added now is seeded at half the shape's line and keeps that
 * number (engine/shapePatternFill's buildShapePatternFill). A pattern
 * stored by a build before that has nothing written down and falls back to
 * half the shape's at every draw, so moving the shape's Width row would
 * move the pattern inside it too — the two lines are two decisions, and
 * the Pattern page's Stroke tab is where the pattern's is made. Writing
 * the drawn width down here freezes the old page at what it already looks
 * like, rather than making it jump to be independent.
 *
 * Once only, and only for a WIDTH change: a fill that already has a width
 * is left alone, so a live drag pins on its first frame and no other.
 */
function pinShapePatternStroke(svg: SVGObject, strokeScale: number): SVGObject {
  const fill = svg.patternFill;
  if (!fill || fill.stroke?.width != null) return svg;
  return {
    ...svg,
    patternFill: {
      ...fill,
      stroke: { ...fill.stroke, width: shapePatternStrokeWidthCells(svg, strokeScale) },
    },
  };
}

/** Set a vector object's (or a pattern's) stroke block, non-undoably — the
 *  live preview while a slider drags. `null` clears it (back to the
 *  composition-wide default). No-ops on a missing / other-kind node. */
export function withSVGStroke(
  state: CompositionState,
  nodeId: string,
  stroke: SVGStroke | null,
): CompositionState {
  const next = normalizeSVGStroke(stroke);
  const ref = findItem(state, nodeId);
  if (ref?.kind === 'pattern') {
    return {
      ...state,
      patternObjects: (state.patternObjects ?? []).map((p) =>
        (p.id === nodeId ? { ...p, stroke: next } : p)),
    };
  }
  return {
    ...state,
    svgObjects: state.svgObjects.map((s) => {
      if (s.id !== nodeId) return s;
      // A pattern inside this shape keeps the line it is drawn with when
      // the shape's own width moves (pinShapePatternStroke).
      const pinned = next?.width !== s.stroke?.width
        ? pinShapePatternStroke(s, state.strokeScale)
        : s;
      return { ...pinned, stroke: next };
    }),
  };
}

/** Commit a vector object's (or a pattern's) stroke as one undo step.
 *  Returns null for a missing / other-kind / locked target, or an unchanged
 *  stroke (so opening and releasing the bar without moving anything commits
 *  nothing). */
export function buildSetSVGStroke(
  state: CompositionState,
  nodeId: string,
  stroke: SVGStroke | null,
): SessionEntry | null {
  const ref = findItem(state, nodeId);
  if (!ref || (ref.kind !== 'svg' && ref.kind !== 'pattern') || isItemLocked(state, ref.item.id)) return null;
  const next = normalizeSVGStroke(stroke);
  if (JSON.stringify(ref.item.stroke ?? null) === JSON.stringify(next ?? null)) return null;
  const withNext = withSVGStroke(state, nodeId, stroke);
  return {
    entry: [buildReplaceSceneOp(state, ref.kind === 'pattern'
      ? { patternObjects: withNext.patternObjects }
      : { svgObjects: withNext.svgObjects })],
  };
}

/** Set a closed shape's own fill (the Fill bar), non-undoably — the live
 *  preview while a stop / slider drags or a stop is selected. `null` clears the
 *  fill, leaving the shape an outline. No-ops on a missing / non-svg node.
 *
 *  The legacy `fillColor` / `fillOpacity` / `fillPaint` are cleared alongside
 *  it: `fill` outranks them everywhere a fill is drawn, so leaving a stale one
 *  behind would only wait to reappear the moment the fill is removed. */
export function withSVGFill(
  state: CompositionState,
  nodeId: string,
  fill: ShapeFill | null,
): CompositionState {
  return {
    ...state,
    svgObjects: state.svgObjects.map((s) => (s.id === nodeId
      ? { ...s, fill: fill ?? undefined, fillColor: undefined, fillOpacity: undefined, fillPaint: undefined }
      : s)),
  };
}

/** Commit a closed shape's fill as one undo step. Rides `replaceScene` (no
 *  granular op), like the image tint. Returns null for a missing / non-svg /
 *  locked target, or an unchanged fill — so opening the bar and releasing a
 *  slider that didn't move commits nothing. */
export function buildSetSVGFill(
  state: CompositionState,
  nodeId: string,
  fill: ShapeFill | null,
): SessionEntry | null {
  const ref = findItem(state, nodeId);
  if (!ref || ref.kind !== 'svg' || isItemLocked(state, ref.item.id)) return null;
  const next = withSVGFill(state, nodeId, fill);
  const after = next.svgObjects.find((s) => s.id === nodeId);
  if (JSON.stringify(svgFillSignature(ref.item)) === JSON.stringify(svgFillSignature(after))) return null;
  return { entry: [buildReplaceSceneOp(state, { svgObjects: next.svgObjects })] };
}

/**
 * Set — or clear — a closed shape's PATTERN fill as one undo step: the
 * grid it paints inside its own outline (engine/shapePatternFill.ts).
 *
 * `fill` undefined REMOVES the pattern, leaving the shape's own fill and
 * outline exactly as they are. Null for a missing, non-svg, unclosed or
 * locked target, and for a set that would change nothing.
 *
 * One builder for add, replace and remove because there is one op: the
 * Add button, a swatch pick and the Remove line are the same edit read
 * with different ends (see `setShapePatternFill`).
 */
export function buildSetShapePatternFill(
  state: CompositionState,
  svgId: string,
  fill: ShapePatternFill | undefined,
): SessionEntry | null {
  const ref = findItem(state, svgId);
  if (!ref || ref.kind !== 'svg' || isItemLocked(state, svgId)) return null;
  // An INTERIOR is what a pattern needs — any closed loop among the
  // segments, not one closed chain: a merged collection of lines holds
  // both a loop and loose ends, and the loop is what gets painted.
  if (fill && !svgEnclosesArea(ref.item)) return null;
  const oldFill = ref.item.patternFill;
  if (!oldFill && !fill) return null;
  return {
    entry: [{ op: 'setShapePatternFill', svgId, oldFill, newFill: fill }],
    id: svgId,
  };
}

/**
 * Add a pattern fill to a closed shape: a grid sized to the shape's own
 * box at the composition's grid step, flooded with connectivity-respecting
 * random tiles in the active ink, under the mirror the last pattern was
 * left in — so it arrives as a PATTERN, the way a dragged pattern region
 * does, rather than as an empty grid with nothing to see.
 *
 * `roll` asks for a FRESH roll on a shape that already carries one (the
 * banner's "+"): the grid is rebuilt from scratch rather than left alone.
 */
export function buildAddShapePattern(
  state: CompositionState,
  svgId: string,
  opts: {
    size?: number;
    symmetry?: PatternSymmetry;
    excludedFamilies?: Set<string>;
    tint?: RGBColor | null;
    roll?: boolean;
  } = {},
): SessionEntry | null {
  const ref = findItem(state, svgId);
  if (!ref || ref.kind !== 'svg') return null;
  if (ref.item.patternFill && !opts.roll) return null;
  const fill = buildShapePatternFill(ref.item, compSnapStep(state.gridLevel), {
    // The tiles open at half the shape's own line, written down as the
    // fill's own width — so the Pattern page's Stroke tab owns it from
    // here and the shape's Stroke page no longer drags it about.
    strokeScale: state.strokeScale,
    // A re-roll keeps the tile the size the slider left it at — the "+"
    // is asking for a different PATTERN, not a different scale.
    size: opts.size ?? ref.item.patternFill?.size,
    symmetry: opts.symmetry,
    flood: true,
    excludedFamilies: opts.excludedFamilies,
    tint: opts.tint,
  });
  return buildSetShapePatternFill(state, svgId, fill);
}

/**
 * Set a shape's pattern RESOLUTION — the Pattern page's Resolution
 * slider, 1–8 cells square. One undo step; null when nothing is
 * patterned, the shape is locked, or the resolution is already that.
 *
 * The repeat keeps the size it DRAWS at, so the tile is cut finer or
 * coarser in place and the Size slider does not move with it, and the
 * cells a finer tile exposes are filled in the same breath (see
 * `resizeShapePatternFill`) — a resolution change leaves a finished
 * pattern, never a quarter-painted one.
 *
 * `tool` is the brush in hand, and it is what those cells are laid with:
 * a chosen tile is re-laid finer, and only the random roll re-rolls.
 * Without it the slider handed back a pattern nobody asked for.
 */
export function buildSetShapePatternSize(
  state: CompositionState,
  svgId: string,
  size: number,
  opts: {
    excludedFamilies?: Set<string>;
    tint?: RGBColor | null;
    tool?: PatternSubTool;
  } = {},
): SessionEntry | null {
  const ref = findItem(state, svgId);
  if (!ref || ref.kind !== 'svg' || !ref.item.patternFill) return null;
  const next = resizeShapePatternFill(ref.item.patternFill, size, opts);
  if (next === ref.item.patternFill) return null;
  return buildSetShapePatternFill(state, svgId, next);
}

/**
 * Set how big one repeat DRAWS — the Pattern page's Size slider, 1..10 as
 * TENTHS of the width of the shape being filled (10 draws the motif once
 * across the whole shape, 1 steps ten of them across it). One undo step;
 * null when nothing is patterned, the shape is locked, or the repeat
 * already spans that.
 *
 * The width is the SHAPE's own box, read here rather than passed in, so
 * the number the page sends and the number the page shows
 * (`shapePatternSpanOfWidth`) are measured against the very same edge.
 *
 * The cells are not re-rolled, unlike a Resolution change: the same motif
 * at a different scale is still that motif (`setShapePatternSpan`), so
 * sweeping the slider and coming back hands the pattern back untouched.
 */
export function buildSetShapePatternSpan(
  state: CompositionState,
  svgId: string,
  span: number,
): SessionEntry | null {
  const ref = findItem(state, svgId);
  if (!ref || ref.kind !== 'svg' || !ref.item.patternFill) return null;
  const next = setShapePatternSpan(ref.item.patternFill, span, ref.item.cellWidth);
  if (next === ref.item.patternFill) return null;
  return buildSetShapePatternFill(state, svgId, next);
}

/**
 * Lay the pattern of `sourceId`'s grid into `svgId`'s fill — a swatch
 * pick in the pattern-fill banner. The source is any grid on the page: a
 * pattern object, or another shape's fill.
 *
 * The shape keeps its OWN grid resolution — the fill is sized to the
 * shape, not to whatever the source happens to be — so the source's cells
 * are REPEATED across it, wrapping in both axes. Picking a 2×2 pattern
 * for a wide shape tiles it across, which is what a pattern is for;
 * stretching the source's grid to fit instead would change the size of
 * its tiles from shape to shape.
 */
export function buildApplyPatternSwatch(
  state: CompositionState,
  svgId: string,
  sourceId: string,
): SessionEntry | null {
  const ref = findItem(state, svgId);
  if (!ref || ref.kind !== 'svg' || !ref.item.patternFill) return null;
  const source = findItem(state, sourceId);
  const grid = source?.kind === 'pattern' ? source.item
    : source?.kind === 'svg' ? shapePatternGrid(source.item)
    : null;
  if (!grid || grid.cols <= 0 || grid.rows <= 0) return null;
  const fill = ref.item.patternFill;
  // The shape takes the source's TILE, size and all — the swatch showed a
  // pattern, and half of what makes it that pattern is how many cells it
  // repeats over. A source that is not square (a pattern OBJECT's grid can
  // be oblong) is wrapped into a square tile of its longer edge, so what
  // the swatch drew is what the shape gets.
  const size = clampShapePatternSize(Math.max(grid.cols, grid.rows));
  // The SHAPE of the source's cloth, in this fill's own ink (patternEditInk):
  // a swatch pick changes the pattern, not its colour. A fill with no tile
  // in it yet has no ink to keep, and takes the source's as it stands.
  const ink = patternEditInk(state, svgId, null);
  const cells = new Array(size * size).fill(null).map((_, i) => {
    const col = i % size;
    const row = Math.floor(i / size);
    const cell = grid.cells[(row % grid.rows) * grid.cols + (col % grid.cols)] ?? null;
    return ink ? tintedPatternCell(cell, ink) : cell;
  });
  return buildSetShapePatternFill(state, svgId, {
    ...fill,
    size,
    cells,
    // tileL0 is not written: the repeat goes on drawing exactly as big as
    // it did, so a swatch pick changes the pattern and not its scale —
    // picking a finer swatch no longer walks the Size slider up.
    // The source's own mirror comes with its cells: the pattern the
    // swatch showed was painted under it, and further painting in this
    // shape should answer to the same rule.
    ...(grid.symmetry ? { symmetry: grid.symmetry } : null),
  });
}

/** The fill-bearing fields of a shape, for the unchanged-commit test. Compared
 *  as a whole because a commit rewrites all four together. */
function svgFillSignature(svg: SVGObject | undefined): unknown {
  if (!svg) return null;
  return [svg.fill ?? null, svg.fillColor ?? null, svg.fillOpacity ?? null, svg.fillPaint ?? null];
}

/** Drop fields that are at their default, so an object the user opened the
 *  Endpoints bar on but left alone keeps an absent (not empty) block, and a
 *  reset to bare + round stops being persisted at all. Returns undefined when
 *  nothing is left to store — the same rule `normalizeSVGStroke` follows. */
function normalizeSVGEndpoints(ep: SVGEndpoints | null | undefined): SVGEndpoints | undefined {
  if (!ep) return undefined;
  const next: SVGEndpoints = {};
  if (ep.startMarker && ep.startMarker !== 'none') next.startMarker = ep.startMarker;
  if (ep.endMarker && ep.endMarker !== 'none') next.endMarker = ep.endMarker;
  if (ep.startCap === 'square') next.startCap = 'square';
  if (ep.endCap === 'square') next.endCap = 'square';
  return Object.keys(next).length > 0 ? next : undefined;
}

/** Set an open path's endpoints block. `null` resets both ends to bare +
 *  round. No-ops on a missing / non-svg node.
 *
 *  There is no non-undoable twin of this (as `withSVGStroke` is for
 *  `buildSetSVGStroke`): every Endpoints control is a segmented pick, so there
 *  is no drag to preview — each edit goes straight to a commit. */
export function withSVGEndpoints(
  state: CompositionState,
  nodeId: string,
  endpoints: SVGEndpoints | null,
): CompositionState {
  const next = normalizeSVGEndpoints(endpoints);
  return {
    ...state,
    svgObjects: state.svgObjects.map((s) => (s.id === nodeId ? { ...s, endpoints: next } : s)),
  };
}

/** Commit an open path's endpoints as one undo step. Returns null for a
 *  missing / non-svg / locked target, or an unchanged block — so re-picking the
 *  option that is already selected commits nothing. */
export function buildSetSVGEndpoints(
  state: CompositionState,
  nodeId: string,
  endpoints: SVGEndpoints | null,
): SessionEntry | null {
  const ref = findItem(state, nodeId);
  if (!ref || ref.kind !== 'svg' || isItemLocked(state, ref.item.id)) return null;
  const next = normalizeSVGEndpoints(endpoints);
  if (JSON.stringify(ref.item.endpoints ?? null) === JSON.stringify(next ?? null)) return null;
  const withNext = withSVGEndpoints(state, nodeId, endpoints);
  return { entry: [buildReplaceSceneOp(state, { svgObjects: withNext.svgObjects })] };
}

// ── Whole-object opacity (the Opacity bar) ──────────────────────────
// The bar's two rows are deliberately different things, and they are
// written down differently:
//
//  • Opacity is an alpha, and a PROPERTY: it is stored on the record and
//    the slider reads it back.
//  • Fade is an ADJUSTMENT to the colours the object already draws in. It
//    is spent into them here (engine/fadeBake.ts) and nothing is stored,
//    so the row opens at 0 on the colours as they now stand and no stored
//    number outranks the Stroke page's swatch afterwards.
//
// `fade` is therefore always relative to the state handed IN — the host
// keeps the snapshot the Opacity page opened on and applies from there, so
// the slider is absolute within one visit to the page (drag back to the
// left and the colours come back exactly) and the spend never compounds.
//
// Shared by images, texts, patterns and vector shapes, so unlike the other
// with/build pairs these dispatch on the node's kind. Live drags go through
// `withObjectOpacity` (non-undoable) and the release commits one
// `replaceScene` step, the same coalescing as the image corner radius and
// the effect bars.

/** A text's opacity rides its style's `alpha` — the whole magnet's on a
 *  word sticker (card, border, shadow and ink together), the ink's on plain
 *  text (see TextStyle.alpha). Its fade goes into the ink itself. */
function withTextOpacity(
  style: TextStyle, opacity: number, fade: number, fadeColor: RGBColor,
): TextStyle {
  // Identity is the answer to "did anything change?" everywhere below, so
  // an alpha that already reads `opacity` must come back as the SAME style
  // rather than as an equal copy.
  const { alpha: _a, ...rest } = style;
  const next = Math.abs((style.alpha ?? 1) - opacity) < 1e-4
    ? style
    : (opacity < 1 ? { ...rest, alpha: opacity } : rest as TextStyle);
  return bakeFadeIntoTextStyle(next, fade, fadeColor);
}

/** The one item-level answer both the preview and the commit read: the
 *  record with the opacity set and the fade spent into its colours.
 *  Returns the item UNCHANGED when neither moved, which is how the commit
 *  below knows a slider that didn't move commits nothing. A paint island
 *  has no colour parameter of its own, so it takes the opacity alone
 *  (engine/fade.ts). */
function itemWithObjectOpacity(
  ref: CompItemRef, opacity: number, fade: number, fadeColor: RGBColor,
): CompItemRef['item'] {
  const op = Math.max(0, Math.min(1, opacity));
  const amount = Math.max(0, Math.min(1, fade));
  if (ref.kind === 'text') {
    const style = withTextOpacity(ref.item.style, op, amount, fadeColor);
    return style === ref.item.style ? ref.item : { ...ref.item, style };
  }
  const cur = ref.item as { opacity?: number };
  const alphaSame = Math.abs((cur.opacity ?? 1) - op) < 1e-4;
  const withAlpha = alphaSame
    ? ref.item
    : { ...ref.item, ...(op < 1 ? { opacity: op } : { opacity: undefined }) };
  if (ref.kind === 'image') return bakeFadeIntoImageObject(withAlpha as ImageObject, amount, fadeColor);
  if (ref.kind === 'svg') return bakeFadeIntoSVGObject(withAlpha as SVGObject, amount, fadeColor);
  if (ref.kind === 'pattern') return bakeFadeIntoPattern(withAlpha as PatternObject, amount, fadeColor);
  return withAlpha;
}

/** Set an object's whole-object opacity and spend its fade, non-undoably —
 *  the live preview while a slider drags. No-ops on a missing node or a
 *  kind with nothing to set. */
export function withObjectOpacity(
  state: CompositionState,
  nodeId: string,
  opacity: number,
  fade: number,
  fadeColor: RGBColor = FADE_DEFAULT_COLOR,
): CompositionState {
  const ref = findItem(state, nodeId);
  if (!ref || ref.kind === 'figure') return state;
  const next = itemWithObjectOpacity(ref, opacity, fade, fadeColor);
  if (next === ref.item) return state;
  const swap = <T extends { id: string }>(items: readonly T[] | undefined): T[] =>
    (items ?? []).map((i) => (i.id === nodeId ? next as unknown as T : i));
  if (ref.kind === 'text') return { ...state, texts: swap(state.texts) };
  if (ref.kind === 'image') return { ...state, images: swap(state.images) };
  if (ref.kind === 'svg') return { ...state, svgObjects: swap(state.svgObjects) };
  if (ref.kind === 'pattern') return { ...state, patternObjects: swap(state.patternObjects) };
  if (ref.kind === 'paint') return { ...state, paintObjects: swap(state.paintObjects) };
  return state;
}

/** Commit an object's opacity + spent fade as one undo step. Returns null
 *  for a missing / locked / wrong-kind target, or unchanged values (so
 *  opening the bar and releasing a slider that didn't move commits
 *  nothing). */
export function buildSetObjectOpacity(
  state: CompositionState,
  nodeId: string,
  opacity: number,
  fade: number,
  fadeColor: RGBColor = FADE_DEFAULT_COLOR,
): SessionEntry | null {
  const ref = findItem(state, nodeId);
  if (!ref || ref.kind === 'figure' || isItemLocked(state, ref.item.id)) return null;
  const item = itemWithObjectOpacity(ref, opacity, fade, fadeColor);
  if (item === ref.item) return null;
  // A text's alpha and its ink are both fields of its STYLE, so the whole
  // edit is one setTextStyle step — neither is a metric, and the box stays
  // exactly where it is.
  if (ref.kind === 'text') return buildSetTextStyle(state, nodeId, (item as TextObject).style);
  const next = withObjectOpacity(state, nodeId, opacity, fade, fadeColor);
  if (next === state) return null;
  return {
    entry: [buildReplaceSceneOp(state, ref.kind === 'image'
      ? { images: next.images }
      : ref.kind === 'paint'
        ? { paintObjects: next.paintObjects }
        : ref.kind === 'pattern'
          ? { patternObjects: next.patternObjects }
          : { svgObjects: next.svgObjects })],
  };
}

/** Commit the selected image's corner radius as one undo step. Rides
 *  `replaceScene` (no granular op), like the other image-content edits.
 *  Returns null for a missing / non-image / locked target, or an unchanged
 *  radius (so a slider that didn't move commits nothing). */
export function buildSetImageCornerRadius(
  state: CompositionState,
  nodeId: string,
  radius: number,
): SessionEntry | null {
  const ref = findItem(state, nodeId);
  if (!ref || ref.kind !== 'image' || isItemLocked(state, ref.item.id)) return null;
  const clamped = Math.max(0, Math.min(MAX_CORNER_RADIUS, radius));
  const before = ref.item.cornerRadius ?? 0;
  if (Math.abs(before - clamped) < 1e-4) return null;
  const next = withImageCornerRadius(state, nodeId, clamped);
  return { entry: [buildReplaceSceneOp(state, { images: next.images })] };
}

/** Set the selected image's framing (Crop bar), non-undoably — used for the
 *  live preview while a slider/segment drags. `null` clears framing (reverting
 *  to the legacy stretch). No-ops on a missing / non-image node. */
export function withImageFraming(
  state: CompositionState,
  nodeId: string,
  framing: ImageFraming | null,
): CompositionState {
  return {
    ...state,
    images: (state.images ?? []).map((i) => (i.id === nodeId
      ? { ...i, framing: framing ?? undefined }
      : i)),
  };
}

/** Commit the selected image's framing as one undo step. Rides `replaceScene`
 *  (no granular op), like corner radius. Returns null for a missing / non-image
 *  / locked target, or an unchanged framing (so a released slider that didn't
 *  move commits nothing). */
export function buildSetImageFraming(
  state: CompositionState,
  nodeId: string,
  framing: ImageFraming | null,
): SessionEntry | null {
  const ref = findItem(state, nodeId);
  if (!ref || ref.kind !== 'image' || isItemLocked(state, ref.item.id)) return null;
  if (JSON.stringify(ref.item.framing ?? null) === JSON.stringify(framing ?? null)) return null;
  const next = withImageFraming(state, nodeId, framing);
  return { entry: [buildReplaceSceneOp(state, { images: next.images })] };
}

/** Set the selected image's gradient tint overlay (Tint bar), non-undoably —
 *  used for the live preview while a stop / slider drags or a stop is selected.
 *  `null` clears the tint. No-ops on a missing / non-image node. */
export function withImageTintFill(
  state: CompositionState,
  nodeId: string,
  tintFill: ImageTintFill | null,
): CompositionState {
  return {
    ...state,
    images: (state.images ?? []).map((i) => (i.id === nodeId
      ? { ...i, tintFill: tintFill ?? undefined }
      : i)),
  };
}

/** Commit the selected image's gradient tint overlay as one undo step. Rides
 *  `replaceScene` (no granular op), like framing. Returns null for a missing /
 *  non-image / locked target, or an unchanged tint (so a released slider that
 *  didn't move commits nothing). */
export function buildSetImageTintFill(
  state: CompositionState,
  nodeId: string,
  tintFill: ImageTintFill | null,
): SessionEntry | null {
  const ref = findItem(state, nodeId);
  if (!ref || ref.kind !== 'image' || isItemLocked(state, ref.item.id)) return null;
  if (JSON.stringify(ref.item.tintFill ?? null) === JSON.stringify(tintFill ?? null)) return null;
  const next = withImageTintFill(state, nodeId, tintFill);
  return { entry: [buildReplaceSceneOp(state, { images: next.images })] };
}

/** Fill/Crop min and max zoom (cover-relative), matching the Crop bar's Zoom
 *  slider and the engine's `resolveFraming` clamp. */
export const MIN_FRAMING_ZOOM = 1;
export const MAX_FRAMING_ZOOM = 3;

/** The cover enlargement the pan offset lives within: the Fill zoom, the Crop
 *  straighten factor, or 1 for Fit/Tile (where the offset has no visible
 *  effect). Shared so pan and zoom clamp the offset against the same scale. */
function framingCoverScale(mode: ImageFraming['mode'], zoom: number, angle: number, fw: number, fh: number): number {
  return mode === 'crop' ? straightenCoverScale(angle, fw, fh)
    : mode === 'fill' ? zoom : 1;
}

/** Fold a clamped offset into a framing, unset when 0 so the JSON stays clean
 *  and an unchanged axis compares equal to the base (letting the commit no-op
 *  it, exactly like the sliders). Mutates and returns `f`. */
function withCleanOffset(f: ImageFraming, offsetX: number, offsetY: number): ImageFraming {
  if (offsetX !== 0) f.offsetX = offsetX; else delete f.offsetX;
  if (offsetY !== 0) f.offsetY = offsetY; else delete f.offsetY;
  return f;
}

/** Frame geometry (size + bitmap aspect) an image's crop math needs. */
function imageFrameGeom(img: ImageObject): { fw: number; fh: number; aspect: number } {
  const fw = Math.max(img.cellWidth, 1e-6);
  const fh = Math.max(img.cellHeight, 1e-6);
  const aspect = img.pixelHeight > 0 ? img.pixelWidth / img.pixelHeight : fw / fh;
  return { fw, fh, aspect };
}

/** The framing an image gets after panning its crop by `(dxCells, dyCells)` —
 *  the Crop-bar's on-canvas drag. Adds the delta to the current Fill/Crop pan
 *  offset and clamps it (via the engine) so the bitmap can't be dragged off the
 *  frame. Returns null for a missing / non-image node. The pan is measured in
 *  the node's local frame axes, so it's exact for unrotated images and merely
 *  rotated-with-the-image for rotated ones (an acceptable edge case). */
function pannedFramingFor(
  state: CompositionState,
  nodeId: string,
  dxCells: number,
  dyCells: number,
): ImageFraming | null {
  const ref = findItem(state, nodeId);
  if (!ref || ref.kind !== 'image') return null;
  const base: ImageFraming = ref.item.framing ?? COVER_FRAMING;
  const rf = resolveFraming(base);
  const { fw, fh, aspect } = imageFrameGeom(ref.item);
  const scale = framingCoverScale(rf.mode, rf.zoom, rf.angle, fw, fh);
  const { offsetX, offsetY } = clampPanOffset(
    fw, fh, aspect, scale, rf.offsetX + dxCells, rf.offsetY + dyCells);
  return withCleanOffset({ ...base }, offsetX, offsetY);
}

/** The framing an image gets after pinch-zooming its crop by `factor` (the
 *  finger-separation ratio since the pinch began) — the Crop-bar's two-finger
 *  gesture. Scales the Fill zoom about the frame centre, clamped to
 *  [{@link MIN_FRAMING_ZOOM}, {@link MAX_FRAMING_ZOOM}], and re-clamps the pan
 *  offset to the new zoom's range so a zoom-out can't expose a gap. Returns null
 *  for a missing / non-image node. */
function zoomedFramingFor(
  state: CompositionState,
  nodeId: string,
  factor: number,
): ImageFraming | null {
  const ref = findItem(state, nodeId);
  if (!ref || ref.kind !== 'image') return null;
  const base: ImageFraming = ref.item.framing ?? COVER_FRAMING;
  const rf = resolveFraming(base);
  const { fw, fh, aspect } = imageFrameGeom(ref.item);
  const zoom = Math.max(MIN_FRAMING_ZOOM, Math.min(MAX_FRAMING_ZOOM, rf.zoom * (factor > 0 ? factor : 1)));
  const scale = framingCoverScale(rf.mode, zoom, rf.angle, fw, fh);
  const { offsetX, offsetY } = clampPanOffset(fw, fh, aspect, scale, rf.offsetX, rf.offsetY);
  return withCleanOffset({ ...base, zoom }, offsetX, offsetY);
}

/** Live (non-undoable) crop pan for the on-canvas drag preview: folds the delta
 *  into the node's clamped pan offset. Mirrors {@link withImageFraming}. */
export function withPannedFraming(
  state: CompositionState,
  nodeId: string,
  dxCells: number,
  dyCells: number,
): CompositionState {
  const framing = pannedFramingFor(state, nodeId, dxCells, dyCells);
  return framing ? withImageFraming(state, nodeId, framing) : state;
}

/** Commit a crop pan as one undo step (rides `replaceScene`, like the sliders).
 *  Returns null for a missing / non-image / locked target, or a pan that didn't
 *  move the offset (so a tap-length drag commits nothing). */
export function buildPanImageFraming(
  state: CompositionState,
  nodeId: string,
  dxCells: number,
  dyCells: number,
): SessionEntry | null {
  const ref = findItem(state, nodeId);
  if (!ref || ref.kind !== 'image' || isItemLocked(state, ref.item.id)) return null;
  const framing = pannedFramingFor(state, nodeId, dxCells, dyCells);
  return framing ? buildSetImageFraming(state, nodeId, framing) : null;
}

/** Live (non-undoable) crop zoom for the two-finger pinch preview. Mirrors
 *  {@link withPannedFraming}. */
export function withZoomedFraming(
  state: CompositionState,
  nodeId: string,
  factor: number,
): CompositionState {
  const framing = zoomedFramingFor(state, nodeId, factor);
  return framing ? withImageFraming(state, nodeId, framing) : state;
}

/** Commit a crop zoom as one undo step. Returns null for a missing / non-image
 *  / locked target, or a pinch that left the zoom unchanged (so a pinch that
 *  didn't move commits nothing). */
export function buildZoomImageFraming(
  state: CompositionState,
  nodeId: string,
  factor: number,
): SessionEntry | null {
  const ref = findItem(state, nodeId);
  if (!ref || ref.kind !== 'image' || isItemLocked(state, ref.item.id)) return null;
  const framing = zoomedFramingFor(state, nodeId, factor);
  return framing ? buildSetImageFraming(state, nodeId, framing) : null;
}

/** Translate any node, capturing the transform-cycle stash the forward
 *  move clears so revert restores it (moveNode contract). Only figures and
 *  svgs stash anything: bbox kinds (image / text / paint / pattern) move
 *  rigidly — orientation flags kept, identity carried by the delta — so
 *  the inverse translate alone reverts them exactly. */
/** Move one node by a world delta: one `setTransform`. The delta is
 *  snapped by the caller, in world space (plan Q6). */
export function buildMoveNode(
  state: CompositionState,
  nodeId: string,
  dx: number,
  dy: number,
): SessionEntry | null {
  const entry = dragDelta(state, [nodeId], dx, dy);
  return entry ? { entry } : null;
}

/** Delete a node (group-safe: strands prune via buildRemoveObjectOps). */
export function buildRemoveSelected(
  state: CompositionState,
  nodeId: string,
): SessionEntry | null {
  const entry = buildRemoveObjectOps(state, [nodeId]);
  return entry.length > 0 ? { entry } : null;
}

/**
 * Bring to front / send to back for a Scene Outline row (leaf OR group/frame).
 *
 * Scoped to the row's own container ('siblings'), matching what the outline
 * shows: a node inside a frame goes to the top/bottom of THAT frame — landing
 * just above the frame's boundary rect, which stays back-most as the frame's
 * background — while the frame itself keeps its place on the page. A top-level
 * row (including a frame row) has the scene as its container, so it travels to
 * the scene's extreme, whole subtree included.
 */
export function buildReorder(
  state: CompositionState,
  nodeId: string,
  position: 'front' | 'back',
): SessionEntry | null {
  return buildReorderSelection(state, [nodeId], position);
}

/**
 * The same move for a CANVAS selection — one object or the members of a
 * multi-selection — which is what the radial quick menu's two z-order
 * buttons commit. Members travel together and keep their relative order
 * (reorderSceneObjects moves the whole set), each within its own container
 * for the same reason a single row does.
 */
export function buildReorderSelection(
  state: CompositionState,
  ids: readonly string[],
  position: 'front' | 'back',
): SessionEntry | null {
  // The host's items draw over the whole page; only the scene has an order
  // to change.
  ids = selectedSceneIds(ids);
  if (ids.length === 0) return null;
  // A selection that IS one plain group — every member and nothing else,
  // what a tap on a grouped object leaves selected — moves the GROUP within
  // ITS container, the way the Scene Outline's group row does. Moved as
  // members, the container would be the group itself, and members that
  // already fill it have nowhere to go: the radial's Front and Back did
  // nothing to a group.
  const groupId = wholeGroupIdOfSelection(state, ids);
  const next = reorderSceneObjects(state, new Set(groupId ? [groupId] : ids), position, 'siblings');
  if (next.sceneOrder === state.sceneOrder) return null;
  return buildReorderTo(state, next.sceneOrder);
}

/**
 * Commit an arbitrary drag-produced back→front order (Scene Outline
 * reorder). `newSceneOrder` must be a permutation of the current
 * `state.sceneOrder`; anything else returns null (the drag math should
 * never produce one, but a stale UI could). The order is routed through
 * `applySceneOrder` so group members can't be split by a drop — the
 * engine re-contiguizes them, and that normalized order is what we commit
 * (and diff against for the no-op check). The `reorderObjects` undo op
 * already round-trips (compositionOps applySceneOrder on redo, oldOrder on
 * undo).
 */
export function buildReorderTo(
  state: CompositionState,
  newSceneOrder: readonly string[],
): SessionEntry | null {
  const cur = state.sceneOrder;
  if (newSceneOrder.length !== cur.length) return null;
  const sortedA = [...cur].sort();
  const sortedB = [...newSceneOrder].sort();
  for (let i = 0; i < sortedA.length; i++) {
    if (sortedA[i] !== sortedB[i]) return null; // not a permutation
  }
  const finalOrder = applySceneOrder(state, [...newSceneOrder]).sceneOrder;
  const same = finalOrder.length === cur.length && finalOrder.every((id, i) => id === cur[i]);
  if (same) return null;
  return { entry: [{ op: 'reorderObjects', oldOrder: cur, newOrder: finalOrder }] };
}

/** Rename a GroupNode (a scene-outline group/frame row). */
export function buildRenameGroup(
  state: CompositionState,
  groupId: string,
  newName: string,
): SessionEntry | null {
  const g = state.groups.find((x) => x.id === groupId);
  if (!g) return null;
  const trimmed = newName.trim();
  const name = trimmed.length > 0 ? trimmed : g.name; // empty reverts
  if (name === g.name) return null;
  return { entry: [{ op: 'renameGroup', groupId, oldName: g.name, newName: name }] };
}

// ── Frames ──────────────────────────────────────────────────────────
// A Figma-style frame is a GroupNode with `isFrame`; its boundary is the
// group's active rect mask — an SVGObject that carries the frame's background
// (`fillColor`) and its shadow / border (`effects`). Frames are a first-class
// selection: `selectedId` may be a frame group id, and the object-properties
// panel shows the frame's own options (background / ungroup / shadow / border)
// while the common actions (rotate / flip / copy / lock / delete) act on the
// whole group. Rotate / flip / duplicate / lock / delete all resolve to
// existing group-aware engine ops; background / shadow / border target the
// boundary rect.

/** True when `id` is a live Figma-style frame group. */
export function isFrameGroupId(state: CompositionState, id: string): boolean {
  return !!state.groups.find((x) => x.id === id)?.isFrame;
}

/** The frame's boundary rect (its active rect mask), which carries the frame's
 *  background `fillColor` and shadow / border `effects`. Null when the frame
 *  has no resolvable rect mask (e.g. its boundary shape isn't closed). */
export function frameBoundaryRect(state: CompositionState, frameId: string): SVGObject | null {
  const rect = buildFrameRectMap({
    groups: state.groups, svgObjects: state.svgObjects, sceneOrder: state.sceneOrder,
  }).get(frameId);
  return rect ?? null;
}

/** True when `id` is a node owned by a frame (any ancestor group has
 *  `isFrame`) — a scaffold slot such as the page's photo or its haiku lines. */
export function isFrameMember(state: CompositionState, id: string): boolean {
  const ref = findItem(state, id);
  if (!ref) return false;
  return frameGroupIdForNode(state.groups, ref.item.groupId) != null;
}

/** Share of its frame's boundary a member must cover to count as that frame's
 *  BACKDROP (see isFrameBackdrop). Tuned so a full-bleed photo slot (the whole
 *  page) is a backdrop while the content sitting on it — haiku lines, stickers,
 *  drawn shapes — is not. */
export const FRAME_BACKDROP_COVERAGE = 0.6;

/** True when `id` is a frame member big enough to BE that frame's background:
 *  the boundary rect itself, or a full-bleed slot such as the haiku page's
 *  photo. Loose nodes, ordinary members, and members of a frame with no
 *  resolvable boundary rect are all false.
 *
 *  This is the "two fingers here mean the camera" test. It's deliberately
 *  measured against the frame rather than the viewport so it answers the same
 *  way at every zoom level — a gesture shouldn't change meaning mid-pinch. */
export function isFrameBackdrop(state: CompositionState, id: string): boolean {
  const ref = findItem(state, id);
  if (!ref) return false;
  const frameId = frameGroupIdForNode(state.groups, ref.item.groupId);
  if (!frameId) return false;
  const rect = frameBoundaryRect(state, frameId);
  if (!rect) return false;
  const frameArea = rect.cellWidth * rect.cellHeight;
  if (frameArea <= 0) return false;
  return ref.item.cellWidth * ref.item.cellHeight >= frameArea * FRAME_BACKDROP_COVERAGE;
}

/** Can a two-finger gesture whose fingers both landed on `id` rotate + scale
 *  that node, instead of pinch-zooming the camera?
 *
 *  Only a frame's BACKDROP is excluded — its boundary rect, or a slot that
 *  fills it like the journal page's full-bleed photo. Claiming the gesture
 *  there would leave nowhere to pan / zoom the view from, since the backdrop is
 *  everything the user can see. Ordinary framed content (the haiku lines,
 *  stickers, anything drawn on the page) rotates + scales like a loose object;
 *  there's always the backdrop behind it to pinch the camera from. Figures
 *  aren't manipulable at all, and a locked node (directly or through its group
 *  chain) is inert. */
export function canTwoPointerManipulate(state: CompositionState, id: string): boolean {
  const ref = findItem(state, id);
  if (!ref || ref.kind === 'figure') return false;
  return !isItemLocked(state, id) && !isFrameBackdrop(state, id);
}

/** A frame counts as locked when its own group `locked` flag is set (or an
 *  ancestor group is locked). The frame's lock is inherited by its members;
 *  it is no longer an aggregate of the members' own flags. */
export function isFrameLocked(state: CompositionState, frameId: string): boolean {
  return isGroupChainLocked(state, frameId);
}

/**
 * A world gesture on a FRAME: one `setTransform` on the frame's group node,
 * so every member rides it untouched. Rejects locked / missing / non-frame
 * ids. `flags` names the mirror spelling the frame should read back with.
 */
function buildFrameGesture(
  state: CompositionState,
  frameId: string,
  gesture: Mat2D,
  flags?: { mirrorH?: boolean; mirrorV?: boolean },
): SessionEntry | null {
  const g = state.groups.find((x) => x.id === frameId);
  if (!g || !g.isFrame || isFrameLocked(state, frameId)) return null;
  const entry = buildGestureEntry(state, [frameId], gesture, flags ? () => flags : undefined);
  return entry ? { entry } : null;
}

/** The world point a frame turns and flips about: where its boundary rect
 *  is DRAWN, centre of, or the group's own origin for a frame with no
 *  resolvable rect. */
function framePivot(state: CompositionState, frameId: string): [number, number] {
  const rect = frameBoundaryRect(state, frameId);
  const centre = rect ? worldCentre(state, rect.id) : null;
  if (centre) return centre;
  const m = worldMatrix(graphOf(state), frameId);
  return [m.e, m.f];
}

/** Rotate a frame 90° clockwise about its centre — in place. */
export function buildRotateFrame(state: CompositionState, frameId: string): SessionEntry | null {
  return buildFrameGesture(state, frameId, aboutPoint(framePivot(state, frameId), 90, 1, 1));
}

/** Flip a frame horizontally / vertically about its centre, toggling the
 *  group's own mirror flag so it reads back as the flip it was. */
export function buildMirrorFrame(
  state: CompositionState,
  frameId: string,
  axis: 'h' | 'v',
): SessionEntry | null {
  const g = state.groups.find((x) => x.id === frameId);
  if (!g) return null;
  const pivot = framePivot(state, frameId);
  return buildFrameGesture(state, frameId, matAbout(pivot, mirrorLinear(axis)), {
    mirrorH: axis === 'h' ? !g.mirrorH : g.mirrorH,
    mirrorV: axis === 'v' ? !g.mirrorV : g.mirrorV,
  });
}

/**
 * Resize a frame so its boundary rect occupies `newBbox` (world cells) — the
 * box the corner drag computed with the opposite corner pinned, drawn at the
 * rect's own free angle like every selection box. One `setTransform` on the
 * frame's group carries the rect and every member onto it: a scale along the
 * rect's axes, seated so the old centre lands on the new.
 *
 * Members scale by transform, text included (plan Q3: a group scale scales
 * glyphs). Rejects a missing / non-frame / locked id, a frame with no
 * resolvable boundary rect, a degenerate box, and a no-op.
 */
export function buildResizeFrame(
  state: CompositionState,
  frameId: string,
  newBbox: CellBbox,
): SessionEntry | null {
  const gesture = frameResizeGesture(state, frameId, newBbox);
  return gesture ? buildFrameGesture(state, frameId, gesture) : null;
}

/** The world affine {@link buildResizeFrame} commits: the map from the
 *  boundary rect's box onto `newBbox`. Null for every resize that builder
 *  refuses — missing / non-frame / locked id, no resolvable boundary rect,
 *  a degenerate box, a no-op. */
function frameResizeGesture(
  state: CompositionState,
  frameId: string,
  newBbox: CellBbox,
): Mat2D | null {
  const g = state.groups.find((x) => x.id === frameId);
  if (!g || !g.isFrame || isFrameLocked(state, frameId)) return null;
  const rect = frameBoundaryRect(state, frameId);
  if (!rect || !(rect.cellWidth > 0) || !(rect.cellHeight > 0)) return null;
  if (!(newBbox.cellWidth > 0) || !(newBbox.cellHeight > 0)) return null;
  if (sameBbox(rect, newBbox)) return null;
  const oldBbox = { cellX: rect.cellX, cellY: rect.cellY, cellWidth: rect.cellWidth, cellHeight: rect.cellHeight };
  return boxToBoxGesture(oldBbox, newBbox, rect.angleDeg ?? 0);
}

// ── H/V line special editing (ported from Facet) ────────────────────
// A line the line tool created on-axis carries `lineDirection` +
// `creationBox` (see lineShapeGeometry). Its selection box is the wider
// creation box straddling the stroke, and a corner drag lengthens the line
// along ITS OWN axis only. The live axis is always derived from the current
// segment geometry — never the stored flag — so a line whose group was
// quarter-turned (H become V in world space) still stretches along the axis
// it actually lies on; `lineDirection` is only the "created as H/V"
// eligibility marker (Facet's `recalcLineDirection` semantics).

/**
 * The free (stretchable) LOCAL axis of a creation-tool H/V line, or null for
 * every node without the special editing: freeform/diagonal lines, joined
 * paths (more than one segment), rectangles, patterns. 'x' = the stroke runs
 * along local x (visually horizontal at angleDeg 0). A free rotation
 * (`angleDeg`) doesn't change the answer — it spins the stored geometry at
 * render time, and the resize math already works in the rotated local frame.
 */
export function simpleLineAxis(item: SVGObject): 'x' | 'y' | null {
  if (item.lineDirection !== 'horizontal' && item.lineDirection !== 'vertical') return null;
  if (item.tileMode === 'repeat') return null;
  if (item.segments.length !== 1) return null;
  const seg = item.segments[0];
  if (seg.kind !== 'line') return null;
  const dx = Math.abs(seg.end[0] - seg.start[0]);
  const dy = Math.abs(seg.end[1] - seg.start[1]);
  if (dx === dy) return null;
  return dx > dy ? 'x' : 'y';
}

/**
 * The selection box for a simple H/V line: slightly wider than the stroke,
 * straddling it. Ungrouped lines use their stored `creationBox` (kept in
 * step by every transform). Grouped lines derive the box from the live
 * segment instead — one grid step thick, centred on the stroke — because a
 * group transform updates world segments but not the stored box (the engine
 * rebuilds it at ungroup time, see `ungroupCreationBox`). Null when the node
 * has no line special editing.
 */
export function lineSelectionBox(item: SVGObject, gridLevel: number): CellBbox | null {
  const axis = simpleLineAxis(item);
  if (!axis) return null;
  if (!item.groupId && item.creationBox) {
    const { minX, minY, width, height } = item.creationBox;
    return { cellX: minX, cellY: minY, cellWidth: width, cellHeight: height };
  }
  const seg = item.segments[0] as Extract<PathSegment, { kind: 'line' }>;
  const t = compSnapStep(gridLevel);
  if (axis === 'x') {
    const y = (seg.start[1] + seg.end[1]) / 2;
    return {
      cellX: Math.min(seg.start[0], seg.end[0]), cellY: y - t / 2,
      cellWidth: Math.abs(seg.end[0] - seg.start[0]), cellHeight: t,
    };
  }
  const x = (seg.start[0] + seg.end[0]) / 2;
  return {
    cellX: x - t / 2, cellY: Math.min(seg.start[1], seg.end[1]),
    cellWidth: t, cellHeight: Math.abs(seg.end[1] - seg.start[1]),
  };
}

/** What the canvas draws a selection box around, and whether that box has
 *  corner handles. `frameId` is set only for a frame selection — the flag the
 *  gesture layer uses to route a corner drag to {@link buildResizeFrame}
 *  instead of {@link buildResizeNode}. */
export interface SelectionBox {
  bbox: CellBbox;
  /** The turn {@link bbox} is drawn at, about its own centre. The graph's
   *  one continuous turn: the legacy quarter turn and free angle together.
   *  A frame's boundary rect carries only its own free angle — a group's
   *  quarter turns are baked into its members' world coords. */
  angleDeg: number;
  /** {@link bbox} in the node's OWN space — the box the corner resize
   *  writes, since a resize is a new local box under an unchanged matrix
   *  (engine `sceneLocalResize`). Null for a frame, whose corner drag is a
   *  scale of the GROUP ({@link buildResizeFrame}) and needs no such box.
   *
   *  It travels with `bbox` because the two are one reading: the drag
   *  computes in the drawn frame and commits in the local one, and a
   *  caller that took them from different readings — or from different
   *  moments — would rescale an object across its own axes. */
  local: Bbox | null;
  frameId: string | null;
  /** Can this box be corner-dragged? False for the selections that have
   *  nothing to resize (figures) or refuse to (locked). */
  resizable: boolean;
  /** Set for a simple H/V line: the LOCAL axis a corner drag may stretch
   *  (the perpendicular axis is frozen — the line only lengthens/shortens
   *  along its own stroke). Null for every other selection. */
  freeAxis: 'x' | 'y' | null;
  /** True for a pattern object in repeat mode: the outline draws in Facet's
   *  selection orange to signal the special scaling rule (a corner drag
   *  repeats the tile across the region rather than scaling it). */
  pattern: boolean;
  /** How far the object's INK leaves {@link bbox}, in cells, per side.
   *  Zero on every side for everything but bent text, whose glyphs ride an
   *  arc off their own baselines and so hang outside the box the node is
   *  stored in (engine textBendRise) — the ring drew a box the bent half
   *  of the words sat outside of.
   *
   *  The RING alone grows by it. The box itself stays the node's, because
   *  the node's box is what a corner drag writes back (buildResizeNode)
   *  and what the corner hit-test measures: handing the drag a grown box
   *  would move the words by the bow the moment a corner was touched. So
   *  the ring says where the ink is and the handles stay on the transform
   *  box, a little inside it on the bowed side — which is the truth about
   *  both. */
  inkOutset: { top: number; bottom: number };
}

/** No ink outside the box — every selection but a bent text's. */
const NO_INK_OUTSET = { top: 0, bottom: 0 } as const;

/**
 * How far a node's ink hangs off its own box, per side, in cells.
 *
 * Only bent text does, and the engine's `textInkOutset` is the one answer —
 * the same one the TAP is tested against (sceneNodeGeometry's text adapter),
 * so the ring a reader sees framed is the region that answers their finger.
 */
function inkOutsetOf(ref: { kind: string; item: unknown }): { top: number; bottom: number } {
  if (ref.kind !== 'text') return NO_INK_OUTSET;
  return textInkOutset(ref.item as TextObject);
}

/** {@link SelectionBox.bbox} grown by the ink that hangs outside it — what
 *  the selection RING is drawn around. Identical to the box itself unless
 *  the selection is bent text. */
export function selectionRingBbox(
  bbox: CellBbox, outset: { top: number; bottom: number },
): CellBbox {
  if (outset.top === 0 && outset.bottom === 0) return bbox;
  return {
    cellX: bbox.cellX,
    cellY: bbox.cellY - outset.top,
    cellWidth: bbox.cellWidth,
    cellHeight: bbox.cellHeight + outset.top + outset.bottom,
  };
}

/**
 * What a leaf's own outline hugs, and the box in the node's OWN space that
 * outline is the image of.
 *
 * `local` is the content box — or a simple H/V line's wider straddle box,
 * read in the same space — and `bbox` / `angleDeg` are what the world
 * matrix makes of it: the rectangle the selection ring draws, turned about
 * its own centre. The graph's one continuous turn stands in for the legacy
 * quarter turn plus free angle, and the box is the un-turned content box
 * to match.
 *
 * The pair is the point. The single corner resize computes in the drawn
 * frame and commits in the local one, and the two have to be the same
 * reading of the same node or the drag would compute in one frame and
 * land in another. Every outline in the editor — the single selection, a
 * multi-selection's members, the marquee's reach — comes from here.
 */
function nodeSelectionBaseBox(
  state: CompositionState,
  ref: CompItemRef,
): { bbox: CellBbox; angleDeg: number; local: Bbox | null; freeAxis: 'x' | 'y' | null } {
  const graph = graphOf(state);
  const node = getNode(graph, ref.item.id);
  if (node && node.kind !== 'group') {
    // A simple H/V line hugs its wider straddle box rather than its
    // degenerate path box, and marks the one axis a corner drag may
    // stretch. Both are read off the node's OWN content
    // (sceneHitFrame.localHitObject), where a line inside a turned group
    // is still the H/V line it was drawn as — in world coordinates its
    // segment is neither.
    const localItem = node.kind === 'svg' ? localHitObject(node) as SVGObject : null;
    const straddle = localItem ? lineSelectionBox(localItem, state.gridLevel) : null;
    const local = straddle
      ? { x: straddle.cellX, y: straddle.cellY, width: straddle.cellWidth, height: straddle.cellHeight }
      : localContentBox(node);
    const drawn = drawnBox(state, ref.item.id, local);
    if (drawn) {
      return { ...drawn, local, freeAxis: straddle && localItem ? simpleLineAxis(localItem) : null };
    }
  }
  const { cellX, cellY, cellWidth, cellHeight } = ref.item;
  return {
    bbox: { cellX, cellY, cellWidth, cellHeight }, angleDeg: 0, local: null, freeAxis: null,
  };
}

/**
 * The box the selection outline hugs for `selectedId`, or null when there is
 * nothing to outline. A frame group resolves to its boundary rect — frames are
 * a first-class selection (Scene Outline rows) but not leaf items, so
 * `findItem` alone would draw nothing for one.
 *
 * The single source of truth for BOTH the outline/handle render and the corner
 * hit-test, so the affordance can never be drawn where the grab is rejected
 * (or vice versa).
 */
export function resolveSelectionBox(
  state: CompositionState,
  selectedId: string | null,
): SelectionBox | null {
  if (!selectedId) return null;
  if (isFrameGroupId(state, selectedId)) {
    const rect = frameBoundaryRect(state, selectedId);
    if (!rect) return null;
    const { cellX, cellY, cellWidth, cellHeight } = rect;
    return {
      bbox: { cellX, cellY, cellWidth, cellHeight },
      // A group's quarter-turns are baked into the rect's world coords, so
      // the box is axis-aligned; the rect's FREE angle (a tilted template
      // frame) is the frame's, and the outline and the corner grabs turn
      // with it as they do for any rotated node.
      angleDeg: rect.angleDeg ?? 0,
      local: null,
      frameId: selectedId,
      resizable: !isFrameLocked(state, selectedId),
      freeAxis: null,
      pattern: false,
      inkOutset: NO_INK_OUTSET,
    };
  }
  const ref = findItem(state, selectedId);
  if (!ref) return null;
  // One reading for every kind, straddle box and all: the same
  // nodeSelectionBaseBox the member outlines and the marquee take. It
  // used to be the leaf's legacy box plus its own `angleDeg`, which for a
  // grouped path is the upright rectangle around a turned shape at no
  // angle at all — handles drawn square around something plainly tilted.
  const base = nodeSelectionBaseBox(state, ref);
  return {
    bbox: base.bbox,
    angleDeg: base.angleDeg,
    local: base.local,
    frameId: null,
    resizable: !isItemLocked(state, selectedId) && isRescalable(ref),
    freeAxis: base.freeAxis,
    pattern: (ref.kind === 'svg' || ref.kind === 'pattern') && ref.item.tileMode === 'repeat',
    inkOutset: inkOutsetOf(ref),
  };
}

/**
 * {@link buildDuplicateOps} with each copy placed just above its original,
 * plus whatever the HOST's copies need (sessionHost.ts
 * `HostNodeRules.duplicateCompanions`).
 *
 * CozyJournal's rig is a pair — a figure and a hidden pose record bound to
 * it by name — and only the figure is a scene object, so a plain duplicate
 * produced a picture of a mannequin: no pose to draw live, no rig options,
 * nothing to pose. Every duplicate path goes through here so a copy of such
 * a node is whole, however it was made.
 */
function duplicateOpsAboveOriginals(
  state: CompositionState,
  ids: Iterable<string>,
  options: { offset: number },
): ReturnType<typeof buildDuplicateOps> {
  const copies: Array<{ kind: string; fromId: string; toId: string }> = [];
  const pairs: Array<[string, string]> = [];
  const result = buildDuplicateOps(state, ids, {
    ...options,
    // The adapter's own mint, exactly as an unsupplied caller would get —
    // id prefixes are load-bearing — passed only so the new id can be
    // paired with the one it was copied from: every pair places its copy
    // above its original (below), and the host is told of every pair.
    mintItemId: (kind, fromId) => {
      const toId = (SCENE_ADAPTERS.find((a) => a.kind === kind)?.mintId ?? (() => mintNodeId('svg')))();
      pairs.push([fromId, toId]);
      copies.push({ kind, fromId, toId });
      return toId;
    },
  });
  result.ops = placeCopiesAboveOriginals(state, result.ops, pairs);
  result.ops.push(...hostCompanionOps(state, copies));
  return result;
}

/**
 * The sceneOrder slot a duplicate of `ids` goes into: the one just ABOVE
 * the topmost original — a copy lands adjacent to what it copies, not on
 * top of the whole page. A grouped original counts as its ROOT group's
 * whole run (its copy lands in a sibling group, and a slot inside the run
 * would split the group), so "above the original" is above the group.
 */
function duplicateInsertIndex(state: CompositionState, ids: Iterable<string>): number {
  let top = -1;
  for (const id of ids) {
    const groupId = findItem(state, id)?.item.groupId;
    const chain = groupId ? groupAncestorChain(state.groups, groupId) : [];
    const run = chain.length > 0 ? allDescendantMemberIds(state, chain[chain.length - 1].id) : [id];
    for (const member of run) top = Math.max(top, state.sceneOrder.indexOf(member));
  }
  return top + 1;
}

/**
 * Pin each copy's `placeObject` to the slot above its original: the copies
 * form one block starting at {@link duplicateInsertIndex}, in their
 * originals' own back→front order (the ops are re-sequenced to match, so
 * each insert lands where the index says). A `placeObject` without an index
 * appends to the front of the page — which is where every duplicate used
 * to arrive. Ops that are not copies keep their place after the block.
 */
function placeCopiesAboveOriginals(
  state: CompositionState,
  ops: CompUndoEntry,
  pairs: ReadonlyArray<[string, string]>,
): CompUndoEntry {
  if (pairs.length === 0) return ops;
  const at = duplicateInsertIndex(state, pairs.map(([from]) => from));
  const pos = new Map(state.sceneOrder.map((id, i) => [id, i] as const));
  const originalPos = new Map(pairs.map(([from, to]) => [to, pos.get(from) ?? -1] as const));
  const copyOps = ops
    .filter((op) => op.op === 'placeObject' && originalPos.has(op.item.id))
    .sort((a, b) => (
      originalPos.get((a as { item: { id: string } }).item.id)!
      - originalPos.get((b as { item: { id: string } }).item.id)!
    ))
    .map((op, k) => ({ ...op, sceneOrderIndex: at + k }));
  const isCopy = (op: CompUndoOp) => op.op === 'placeObject' && originalPos.has(op.item.id);
  // Ops the builder put BEFORE the first copy stay before it: that is
  // where a duplicated group's own creation sits, and a member placed
  // before its group exists is read into the graph at the root and
  // re-spelled there (buildDuplicateOps). Everything after keeps its
  // place after the block, as it always has.
  const firstCopy = ops.findIndex(isCopy);
  const before = firstCopy < 0 ? [] : ops.slice(0, firstCopy).filter((op) => !isCopy(op));
  const after = ops.slice(firstCopy < 0 ? 0 : firstCopy).filter((op) => !isCopy(op));
  return [...before, ...copyOps, ...after];
}

/** The ops the installed host brings along for duplicated nodes (a rig's
 *  pose record). Empty with no host, or none of its kind among the copies. */
function hostCompanionOps(
  state: CompositionState,
  copies: ReadonlyArray<{ readonly kind: string; readonly fromId: string; readonly toId: string }>,
): CompUndoEntry {
  return sessionHost().nodes?.duplicateCompanions?.(state, copies) ?? [];
}

/** Duplicate a whole frame (group + every member). Passing the member ids —
 *  not the bare group id — is what makes `buildDuplicateOps` replicate the
 *  group hierarchy (and, with the isFrame fix, its frame flag). Selects the
 *  first duplicated member so the copy is live. */
export function buildDuplicateFrame(state: CompositionState, frameId: string): SessionEntry | null {
  if (isFrameLocked(state, frameId)) return null;
  const memberIds = allDescendantMemberIds(state, frameId);
  if (memberIds.length === 0) return null;
  const { ops, newIds, groupIdMap } = duplicateOpsAboveOriginals(
    state, memberIds, { offset: computeDuplicateOffset(state) },
  );
  if (ops.length === 0) return null;
  // Select the duplicated FRAME (not a member leaf) so the copy stays a
  // first-class frame selection with its options panel up.
  return { entry: ops, id: groupIdMap.get(frameId) ?? newIds[0] };
}

// ── Outline names ───────────────────────────────────────────────────

const DEFAULT_KIND_NAME: Record<string, string> = {
  group: 'Group',
  svg: 'Drawing',
  image: 'Photo',
  text: 'Text',
  figure: 'Shape',
  paint: 'Paint',
  pattern: 'Pattern',
};

const NAME_MAX = 24;

/** The label the outline shows for an ordinary node: its explicit name; a
 *  text's content snippet; else a per-kind default. The standard half of
 *  the shared `outlineNameFor` (sceneOutlineModel.ts), which lays the
 *  host's tagged nodes over it — a scaffold slot's declared name, a seed's
 *  strain — through that function's `tagLabels`. */
export function defaultOutlineName(
  kind: string,
  item: { name?: string; content?: string },
): string {
  const explicit = item.name?.trim();
  if (explicit) return explicit;
  if (kind === 'text') {
    const snippet = item.content?.trim();
    if (snippet) return snippet.length > NAME_MAX ? `${snippet.slice(0, NAME_MAX)}…` : snippet;
  }
  return DEFAULT_KIND_NAME[kind] ?? 'Object';
}

/**
 * The name the i-th copy of a Copies-page RUN is placed with: the label the
 * outline already shows for the ORIGINAL, plus that copy's number — so eight
 * copies of a path read "Drawing 1" … "Drawing 8" down the outline instead of
 * eight rows that all say the same word and can only be told apart by tapping
 * each one. The number is the copy's place in the run, which is also the
 * number of steps of offset / turn / fade it carries.
 *
 * It names the nameless on purpose: almost nothing on a page has been
 * renamed, so a rule that only appended to an explicit name would leave the
 * common case exactly as indistinguishable as it was. Numbering from the
 * displayed label keeps the run in the same word the row already used.
 *
 * A TAGGED node (a format's `slot:` / `decor:` mark, a seed's tag) keeps
 * its tag verbatim, the way `duplicateName` does: the tag says what the
 * node IS to the host rather than what it is called, and numbering it would
 * mint tags no format looks for — which is also why it needs no tag labels
 * here: the one kind of node whose label is the host's to say is the one
 * kind this never numbers (sceneOutlineModel's `outlineNameFor`).
 */
export function copyRunName(
  kind: string,
  item: { name?: string; content?: string },
  index: number,
): string {
  const own = item.name?.trim();
  if (own && isTagName(own)) return own;
  return `${defaultOutlineName(kind, item)} ${index}`;
}

/** Toggle a GROUP's own lock (frame or plain group). Emits a single
 *  `lockGroup` op that flips the group's `locked` flag; members are untouched
 *  and inherit the lock. Returns null for a missing group id. */
export function buildToggleLockGroup(state: CompositionState, groupId: string): SessionEntry | null {
  const g = state.groups.find((x) => x.id === groupId);
  if (!g) return null;
  const oldValue = g.locked ?? false;
  return { entry: [{ op: 'lockGroup', id: groupId, oldValue, newValue: !oldValue }] };
}

/** Toggle the frame's lock. Alias of {@link buildToggleLockGroup} — a frame is
 *  just a group with `isFrame`, and its lock is the group's own flag. */
export function buildToggleLockFrame(state: CompositionState, frameId: string): SessionEntry | null {
  return buildToggleLockGroup(state, frameId);
}

/** Delete a whole frame: remove every member (the GroupNode drops once its
 *  member set empties — `buildRemoveObjectOps` emits the companion
 *  `removeGroup` op). Rejects a locked frame. */
export function buildRemoveFrame(state: CompositionState, frameId: string): SessionEntry | null {
  if (isFrameLocked(state, frameId)) return null;
  const entry = buildRemoveObjectOps(state, allDescendantMemberIds(state, frameId));
  return entry.length > 0 ? { entry } : null;
}

/** Dissolve one group, leaving its direct members loose. Saves the group's
 *  transform + mask + frame flag so undo restores it exactly — a frame comes
 *  back a frame. Null for a group that isn't there or holds nothing.
 *
 *  Caller-checked locks: this is the shared core of {@link buildUngroupFrame}
 *  and {@link buildUngroupSelectedMulti}, which both ask whether the GROUP
 *  is locked (its own flag or a container's), and `ungroupFigures` reports
 *  no target to the commit guard. */
function buildUngroupGroup(state: CompositionState, groupId: string): SessionEntry | null {
  const g = state.groups.find((x) => x.id === groupId);
  if (!g) return null;
  // EVERY member kind — a group holding only patterns (a tiled window) or
  // paint islands used to collect nothing here, and Ungroup silently
  // no-opped while its capsule button sat right there. These are the
  // group's DIRECT leaves; a child group's own members stay with it.
  const figureIds = [
    ...state.figures.filter((f) => f.groupId === groupId).map((f) => f.id),
    ...state.svgObjects.filter((s) => s.groupId === groupId).map((s) => s.id),
    ...(state.images ?? []).filter((i) => i.groupId === groupId).map((i) => i.id),
    ...(state.texts ?? []).filter((t) => t.groupId === groupId).map((t) => t.id),
    ...(state.paintObjects ?? []).filter((p) => p.groupId === groupId).map((p) => p.id),
    ...(state.patternObjects ?? []).filter((p) => p.groupId === groupId).map((p) => p.id),
  ];
  const childGroupIds = state.groups.filter((x) => x.parentGroupId === groupId).map((x) => x.id);
  // A group whose every child is itself a GROUP holds no leaves of its own,
  // and bailing on that emptied the button: nest two groups, select the
  // outer one, press Ungroup, watch nothing happen. The op detaches child
  // groups as readily as leaves, so what has to be non-empty is the two
  // together.
  if (figureIds.length === 0 && childGroupIds.length === 0) return null;
  const maskedSvgIds = state.svgObjects.filter((s) => s.groupId === groupId && s.isMask).map((s) => s.id);
  return { entry: [{
    op: 'ungroupFigures', figureIds, groupId, groupName: g.name, childGroupIds,
    savedTranslateX: g.translateX, savedTranslateY: g.translateY,
    savedScaleX: g.scaleX, savedScaleY: g.scaleY,
    savedRotation: g.rotation, savedAngleDeg: g.angleDeg,
    savedMirrorH: g.mirrorH, savedMirrorV: g.mirrorV,
    savedParentGroupId: g.parentGroupId,
    maskedSvgIds,
    savedIsFrame: g.isFrame,
  }] };
}

/** Ungroup a frame: dissolve the group, keeping its members loose (its
 *  boundary rect becomes a plain shape). Rejects a locked frame. */
export function buildUngroupFrame(state: CompositionState, frameId: string): SessionEntry | null {
  if (isFrameLocked(state, frameId)) return null;
  return buildUngroupGroup(state, frameId);
}

/** Set a frame's background color: the fill of its boundary rect. Also
 *  un-hides the boundary — the scaffold hides it (clip-only) for frames with
 *  no background, so a hidden fill would never render. One undoable
 *  `replaceScene` op (sets fill + opacity + visibility together). A no-op when
 *  the frame has no boundary rect or nothing changes. */
export function buildSetFrameBackground(
  state: CompositionState,
  frameId: string,
  color: RGBColor,
  alpha: number = 1,
): SessionEntry | null {
  const rect = frameBoundaryRect(state, frameId);
  if (!rect) return null;
  const fillOpacity = clamp01(alpha);
  const same = !rect.hidden
    && rect.fillColor
    && rect.fillColor.r === color.r && rect.fillColor.g === color.g && rect.fillColor.b === color.b
    && (rect.fillOpacity ?? 1) === fillOpacity;
  if (same) return null;
  const svgObjects = state.svgObjects.map((s) => (s.id === rect.id
    ? { ...s, fillColor: { ...color }, fillOpacity, hidden: undefined }
    : s));
  return { entry: [buildReplaceSceneOp(state, { svgObjects })] };
}

/** Materialize a default shadow / border on a frame's boundary rect AND un-hide
 *  it, so the effect actually renders — the scaffold hides a background-less
 *  frame's boundary, and a hidden node (with its effects) draws nothing. One
 *  undoable op. Returns null when nothing needs doing (already visible + has
 *  the effect) or the rect is missing. */
export function buildMaterializeFrameEffect(
  state: CompositionState,
  frameId: string,
  key: keyof NodeEffects,
  def: NodeEffects[keyof NodeEffects],
): SessionEntry | null {
  const rect = frameBoundaryRect(state, frameId);
  if (!rect) return null;
  if (!rect.hidden && rect.effects?.[key]) return null;
  const svgObjects = state.svgObjects.map((s) => (s.id === rect.id
    ? { ...s, hidden: undefined, effects: { ...s.effects, [key]: s.effects?.[key] ?? def } }
    : s));
  return { entry: [buildReplaceSceneOp(state, { svgObjects })] };
}

/**
 * Reparent a node (leaf or group) under `newParentGroupId` (null = top level),
 * committing the recomputed back→front `newSceneOrder` from the outline tree.
 * Snapshots every record the forward pass may touch (the moved node, and for a
 * group its whole subtree) so undo restores them exactly. No-op when neither
 * the parent nor the order changes.
 */
export function buildReparent(
  state: CompositionState,
  nodeId: string,
  newParentGroupId: string | null,
  newSceneOrder: readonly string[],
): SessionEntry | null {
  const isGroup = state.groups.some((g) => g.id === nodeId);
  const curParent = isGroup
    ? state.groups.find((g) => g.id === nodeId)?.parentGroupId
    : findItem(state, nodeId)?.item.groupId;
  const orderChanged =
    newSceneOrder.length !== state.sceneOrder.length ||
    newSceneOrder.some((id, i) => id !== state.sceneOrder[i]);
  if ((curParent ?? null) === (newParentGroupId ?? null) && !orderChanged) return null;

  const leafIds = new Set<string>();
  const groupIds = new Set<string>();
  if (isGroup) {
    groupIds.add(nodeId);
    for (const d of descendantGroupIds(state.groups, nodeId)) groupIds.add(d);
    for (const id of allDescendantMemberIds(state, nodeId)) leafIds.add(id);
  } else {
    leafIds.add(nodeId);
  }
  return {
    entry: [{
      op: 'reparentNode',
      nodeId,
      newParentGroupId: newParentGroupId ?? undefined,
      newSceneOrder: [...newSceneOrder],
      oldSceneOrder: [...state.sceneOrder],
      prevFigures: state.figures.filter((f) => leafIds.has(f.id)),
      prevSVGs: state.svgObjects.filter((s) => leafIds.has(s.id)),
      prevImages: (state.images ?? []).filter((i) => leafIds.has(i.id)),
      prevTexts: (state.texts ?? []).filter((t) => leafIds.has(t.id)),
      prevPaints: (state.paintObjects ?? []).filter((p) => leafIds.has(p.id)),
      prevPatterns: (state.patternObjects ?? []).filter((p) => leafIds.has(p.id)),
      prevGroups: state.groups.filter((g) => groupIds.has(g.id)),
    }],
  };
}

/** Toggle a node's or group's visibility (Scene Outline eye toggle). Thin
 *  wrapper over the engine's `computeGroupHiddenToggle`, which is the single
 *  authority on the hide semantics: a group flips its OWN `hidden` flag (its
 *  members inherit it, keeping their individual settings), a leaf flips only
 *  itself. Neither `setObjectHidden` nor `hideGroup` appears in opTargetIds,
 *  so the commit lock-guard never blocks the toggle. */
export function buildToggleHidden(
  state: CompositionState,
  nodeId: string,
): SessionEntry | null {
  const t = computeGroupHiddenToggle(state, nodeId);
  return t ? { entry: t.undoOps } : null;
}

/** Duplicate a node via the engine's group-aware duplicate (offset is a
 *  constant on-screen distance regardless of zoom). Duplicating a locked
 *  node is allowed — the engine's cloneWithOffset always emits the copy
 *  unlocked so it's immediately editable (Facet parity), and the commit
 *  lock-guard doesn't block placeObject ops. Engine adapters mint the
 *  new ids in the same 'svg_'/'img_'/'txt_' namespaces as mintNodeId. */
export function buildDuplicateSelected(
  state: CompositionState,
  nodeId: string,
): SessionEntry | null {
  const { ops, newIds } = duplicateOpsAboveOriginals(state, [nodeId], {
    offset: computeDuplicateOffset(state),
  });
  if (ops.length === 0) return null;
  return { entry: ops, id: newIds[0] };
}

/** Toggle a node's lock, or set it to `next` when given — the multi
 *  version drives every member to the same value rather than flipping each
 *  (see {@link buildToggleLockMulti}), and a node already at `next` is a
 *  no-op so it contributes nothing to that shared entry. `lockObject` is
 *  deliberately absent from opTargetIds so the commit lock-guard never
 *  blocks UNLOCKING a locked node (the op's whole purpose). */
export function buildToggleLock(
  state: CompositionState,
  nodeId: string,
  next?: boolean,
): SessionEntry | null {
  const ref = findItem(state, nodeId);
  if (!ref) return null;
  const oldValue = ref.item.locked ?? false;
  const newValue = next ?? !oldValue;
  if (newValue === oldValue) return null;
  return { entry: [{ op: 'lockObject', id: nodeId, oldValue, newValue }] };
}

// ── Super long press (punch-through) builders ───────────────────────
// The super-long-press radial menu acts on LOCKED nodes (Facet's
// lock-punch-through menu): duplicate, unlock, delete. Ports of Facet's
// CompositionEditor handleSuperDuplicate / handleSuperUnlock /
// handleSuperDelete, expressed as SessionEntry builders. Entries that
// must mutate the locked node itself set `force` to skip the commit
// lock-guard — punching through the lock is the whole point.

/** Super long press → Duplicate: an ungrouped, unlocked copy. */
export function buildSuperDuplicate(
  state: CompositionState,
  nodeId: string,
): SessionEntry | null {
  const ref = findItem(state, nodeId);
  if (!ref) return null;
  const adapter = SCENE_ADAPTERS.find((a) => a.kind === ref.kind);
  if (!adapter) return null;
  const offset = computeDuplicateOffset(state);
  const newId = adapter.mintId();
  const dup = adapter.cloneWithOffset(ref.item, offset, offset, newId, undefined);
  // cloneWithOffset already sets locked: false and groupId to the passed
  // value (undefined), but clear group-local coords too.
  detachFromGroup(dup, ref.kind);
  return {
    entry: [
      {
        op: 'placeObject',
        kind: ref.kind,
        item: adapter.cloneItem(dup) as CompositionFigure | SVGObject | ImageObject | TextObject,
        // Adjacent above the original, like every duplicate.
        sceneOrderIndex: duplicateInsertIndex(state, [nodeId]),
      },
      // A locked node punched through is whole when it lands: the host's
      // companions come with it (a rig's pose record).
      ...hostCompanionOps(state, [{ kind: ref.kind, fromId: nodeId, toId: newId }]),
    ],
    id: newId,
  };
}

/** Super long press → Unlock. A node locked by its own flag (chain
 *  unlocked) unlocks in place — exactly what the properties panel's Lock
 *  button does. A node locked through its group chain can't be freed
 *  that way, so it is EXTRACTED: removed, re-placed ungrouped and
 *  unlocked, and brought to the front (Facet's punch-through unlock). */
export function buildSuperUnlock(
  state: CompositionState,
  nodeId: string,
): SessionEntry | null {
  const ref = findItem(state, nodeId);
  if (!ref) return null;
  const groupId = ref.item.groupId;
  if (!isGroupChainLocked(state, groupId)) {
    // Chain unlocked: the node's own flag is the lock; clear it in place.
    if (!(ref.item.locked ?? false)) return null;
    return { entry: [{ op: 'lockObject', id: nodeId, oldValue: true, newValue: false }] };
  }
  const group = state.groups.find((g) => g.id === groupId);
  const adapter = SCENE_ADAPTERS.find((a) => a.kind === ref.kind);
  if (!adapter) return null;
  let ops: CompUndoEntry = [];
  // 1. Remove the original (with groupId) for the undo snapshot.
  const removeOp = buildRemoveObjectOp(state, nodeId);
  if (removeOp) ops.push(removeOp);
  // 2. Re-place with groupId cleared, unlocked, local coords stripped.
  const extracted = adapter.cloneItem(ref.item) as CompositionFigure | SVGObject | ImageObject | TextObject;
  extracted.locked = false;
  detachFromGroup(extracted, ref.kind);
  if (ref.kind === 'svg' && group) {
    (extracted as SVGObject).creationBox = ungroupCreationBox(
      ref.item as SVGObject, group, state.gridLevel,
    );
  }
  ops.push({ op: 'placeObject', kind: ref.kind, item: extracted });
  // 3. Move the extracted item to the front of sceneOrder.
  const oldOrder = captureSceneOrder(state);
  ops.push({
    op: 'reorderObjects',
    oldOrder,
    newOrder: [...oldOrder.filter((id) => id !== nodeId), nodeId],
  });
  // A group whose last member left prunes via withGroupPruning (the
  // removeGroup op restores it on undo).
  ops = withGroupPruning(state, ops);
  return { entry: ops, id: nodeId, force: true };
}

/** Super long press → Delete: the panel's delete (group-safe pruning via
 *  buildRemoveObjectOps), forced through the lock. */
export function buildSuperDelete(
  state: CompositionState,
  nodeId: string,
): SessionEntry | null {
  const entry = buildRemoveObjectOps(state, [nodeId]);
  return entry.length > 0 ? { entry, force: true } : null;
}

// ── Rotate / mirror ─────────────────────────────────────────────────
// A turn and a flip are `setTransform`s on the node (see transformGestures
// and buildRotateSelected below). The two op builders that remain here
// serve the single corner-handle RESIZE, which still rewrites geometry:
//  - svg:   `editSVGSegments` with `preserveOrientation: true`.
//  - image: `editImage`, which carries bbox + orientation old/new natively.
//
// They used to be wider than that one caller needs: the image builder
// carried `localCell*` old/new, and both carry `identityCell*`. P6-B has
// now answered what the legacy path wants from the caches — nothing, they
// are gone — so the `localCell*` carry went with them.
//
// `identityCell*` and `identitySegments` STAY, and are not the same kind of
// thing: they are `transformCycleStep`'s memory of the authored pose, which
// a figure needs to come back round to where it started (see
// docs/transform-refactor.md §1.4 and §2.3). `editImage` applies every
// `new*` field unconditionally, so they have to ride along or a corner
// resize would wipe the cycle's stash.

function buildEditSVGOrientationOp(prev: SVGObject, next: SVGObject): CompUndoOp {
  return {
    op: 'editSVGSegments', svgId: prev.id,
    oldSegments: prev.segments, newSegments: next.segments,
    oldSubpaths: prev.subpaths ?? null, newSubpaths: next.subpaths ?? null,
    // H/V line metadata rides the transform (rotateSVG90CW swaps the
    // direction and rotates the box; rescale maps the box) — carry it when
    // present so undo/redo round-trips it. Omitted entirely for nodes
    // without it: `undefined` means "don't touch" in the reducer.
    ...(prev.creationBox || next.creationBox
      ? { oldCreationBox: prev.creationBox, newCreationBox: next.creationBox }
      : {}),
    ...(prev.lineDirection || next.lineDirection
      ? { oldLineDirection: prev.lineDirection, newLineDirection: next.lineDirection }
      : {}),
    // Pattern (repeat) mode: the tile grid rides the transform too — a 90°
    // rotation swaps tile W/H and remaps the offsets, a mirror reflects
    // them, a rescale compensates an origin-side move. Offsets are carried
    // as numbers (`?? 0`) so a cleared offset round-trips; the reducer
    // normalizes 0 back to absent. Omitted entirely for non-tiled nodes.
    ...(prev.tileMode === 'repeat' || next.tileMode === 'repeat'
      ? {
          oldTileWidthL0: prev.tileWidthL0, newTileWidthL0: next.tileWidthL0,
          oldTileHeightL0: prev.tileHeightL0, newTileHeightL0: next.tileHeightL0,
          oldTileOffsetXL0: prev.tileOffsetXL0 ?? 0, newTileOffsetXL0: next.tileOffsetXL0 ?? 0,
          oldTileOffsetYL0: prev.tileOffsetYL0 ?? 0, newTileOffsetYL0: next.tileOffsetYL0 ?? 0,
        }
      : {}),
    oldCellX: prev.cellX, oldCellY: prev.cellY,
    oldCellWidth: prev.cellWidth, oldCellHeight: prev.cellHeight,
    newCellX: next.cellX, newCellY: next.cellY,
    newCellWidth: next.cellWidth, newCellHeight: next.cellHeight,
    preserveOrientation: true,
    oldRotation: prev.rotation, newRotation: next.rotation,
    oldMirrorH: prev.mirrorH, newMirrorH: next.mirrorH,
    oldMirrorV: prev.mirrorV, newMirrorV: next.mirrorV,
    oldIdentitySegments: prev.identitySegments, newIdentitySegments: next.identitySegments,
    oldIdentityCellX: prev.identityCellX, newIdentityCellX: next.identityCellX,
    oldIdentityCellY: prev.identityCellY, newIdentityCellY: next.identityCellY,
    // Free rotation rides the transform too (a mirror negates it — see
    // mirroredAngleDeg). `null` = clear, so an angle that negates to zero
    // round-trips; omitted when neither side carries one.
    ...((prev.angleDeg ?? 0) !== (next.angleDeg ?? 0)
      ? { oldAngleDeg: prev.angleDeg ?? null, newAngleDeg: next.angleDeg ?? null }
      : {}),
  };
}

function buildEditImageTransformOp(prev: ImageObject, next: ImageObject): CompUndoOp {
  // editImage applies every new* field unconditionally, so untouched
  // fields must ride along or they'd be wiped to undefined.
  return {
    op: 'editImage', imageId: prev.id,
    oldCellX: prev.cellX, oldCellY: prev.cellY,
    oldCellWidth: prev.cellWidth, oldCellHeight: prev.cellHeight,
    newCellX: next.cellX, newCellY: next.cellY,
    newCellWidth: next.cellWidth, newCellHeight: next.cellHeight,
    oldRotation: prev.rotation, newRotation: next.rotation,
    oldMirrorH: prev.mirrorH, newMirrorH: next.mirrorH,
    oldMirrorV: prev.mirrorV, newMirrorV: next.mirrorV,
    oldAngleDeg: prev.angleDeg, newAngleDeg: next.angleDeg,
    oldOpacity: prev.opacity, newOpacity: next.opacity,
    oldIdentityCellX: prev.identityCellX, newIdentityCellX: next.identityCellX,
    oldIdentityCellY: prev.identityCellY, newIdentityCellY: next.identityCellY,
    oldIdentityCellWidth: prev.identityCellWidth, newIdentityCellWidth: next.identityCellWidth,
    oldIdentityCellHeight: prev.identityCellHeight, newIdentityCellHeight: next.identityCellHeight,
  };
}

/** A `replaceScene` op that swaps only the collections named in `next`,
 *  leaving the rest identical (its documented role: interactions not
 *  expressible as granular ops — text transforms, node rename for kinds
 *  without a dedicated rename op, the Poser stage's figure bake). */
export function buildReplaceSceneOp(
  state: CompositionState,
  next: Partial<Pick<CompositionState,
    'figures' | 'svgObjects' | 'images' | 'groups' | 'sceneOrder' | 'texts' | 'paintObjects' | 'patternObjects'>>,
): CompUndoOp {
  return {
    op: 'replaceScene',
    oldFigures: state.figures, newFigures: next.figures ?? state.figures,
    oldSVGObjects: state.svgObjects, newSVGObjects: next.svgObjects ?? state.svgObjects,
    oldImages: state.images ?? [], newImages: next.images ?? state.images ?? [],
    oldGroups: state.groups, newGroups: next.groups ?? state.groups,
    oldSceneOrder: state.sceneOrder, newSceneOrder: next.sceneOrder ?? state.sceneOrder,
    oldTexts: state.texts ?? [], newTexts: next.texts ?? state.texts ?? [],
    oldPaints: state.paintObjects ?? [], newPaints: next.paintObjects ?? state.paintObjects ?? [],
    oldPatterns: state.patternObjects ?? [], newPatterns: next.patternObjects ?? state.patternObjects ?? [],
  };
}

function buildReplaceTextsOp(state: CompositionState, newTexts: TextObject[]): CompUndoOp {
  return buildReplaceSceneOp(state, { texts: newTexts });
}

/** Swap ONE paint island for an edited copy of itself. Paint objects have no
 *  granular op of their own — an island is a bag of tiles, and every edit that
 *  isn't a stroke is a whole-object swap — so each of these is a scene swap
 *  naming only the islands, exactly as a text transform names only the texts. */
function buildReplacePaintOp(state: CompositionState, next: PaintObject): CompUndoOp {
  const paintObjects = (state.paintObjects ?? []).map((p) => (p.id === next.id ? next : p));
  return buildReplaceSceneOp(state, { paintObjects });
}

/** Swap ONE pattern object for an edited copy of itself — the same
 *  whole-object scene swap paint islands use (a pattern's geometry has no
 *  granular op; its cells do). */
function buildReplacePatternOp(state: CompositionState, next: PatternObject): CompUndoOp {
  const patternObjects = (state.patternObjects ?? []).map((p) => (p.id === next.id ? next : p));
  return buildReplaceSceneOp(state, { patternObjects });
}

/** Swap a pattern object for `next` (same id) as one undo step — a grid
 *  grown by the Tile tool in the pattern's own space (tileTool
 *  buildPlaceTileInPattern). Null for a missing or locked pattern. */
export function buildReplacePattern(state: CompositionState, next: PatternObject): SessionEntry | null {
  const ref = findItem(state, next.id);
  if (!ref || ref.kind !== 'pattern' || isItemLocked(state, next.id)) return null;
  return { entry: [buildReplacePatternOp(state, next)], id: next.id };
}

/** Rename any node (Scene Outline long-press). Uses the granular
 *  rename op where one exists (svg/figure) and a scene swap for the kinds
 *  that have none (image/text/paint/pattern). Empty names clear the field;
 *  a no-op (unchanged name) returns null. */
export function buildRenameNode(
  state: CompositionState,
  nodeId: string,
  newName: string,
): SessionEntry | null {
  const ref = findItem(state, nodeId);
  if (!ref) return null;
  const trimmed = newName.trim();
  const name = trimmed.length > 0 ? trimmed : undefined;
  const current = ref.item.name ?? undefined;
  if (current === name) return null;
  switch (ref.kind) {
    case 'svg':
      return { entry: [{ op: 'renameSVG', svgId: nodeId, oldName: ref.item.name, newName: name }] };
    case 'figure':
      return { entry: [{ op: 'renameFigure', figureId: nodeId, oldName: ref.item.name, newName: name }] };
    case 'text': {
      const texts = (state.texts ?? []).map((t) => (t.id === nodeId ? { ...t, name } : t));
      return { entry: [buildReplaceSceneOp(state, { texts })] };
    }
    case 'image': {
      const images = (state.images ?? []).map((i) => (i.id === nodeId ? { ...i, name } : i));
      return { entry: [buildReplaceSceneOp(state, { images })] };
    }
    case 'paint':
      return { entry: [buildReplacePaintOp(state, { ...ref.item, name })] };
    case 'pattern':
      return { entry: [buildReplacePatternOp(state, { ...ref.item, name })] };
    default:
      return null;
  }
}

/** Turn one node a quarter clockwise about its own centre: one
 *  `setTransform`. Figures sit it out — they need quad-aware cycle math
 *  (arrange tool scope is Phase 3+ for figure nodes; CozyJournal scaffolds
 *  never place figures). */
export function buildRotateSelected(
  state: CompositionState,
  nodeId: string,
): SessionEntry | null {
  const ref = findItem(state, nodeId);
  if (!ref || isItemLocked(state, ref.item.id) || ref.kind === 'figure') return null;
  if (ref.kind === 'pattern') {
    return { entry: [buildReplacePatternOp(state, bakePatternTurn(ref.item))] };
  }
  const pivot = worldCentre(state, nodeId);
  if (!pivot) return null;
  const entry = twistAbout(state, [nodeId], pivot, 90);
  return entry ? { entry } : null;
}

/**
 * A pattern's quarter turn and flip are BAKED — into its cells in stretch
 * mode, into its tile grid in repeat mode — by the engine's pattern
 * adapter, not carried on its transform. A pattern's grid is what the Tile
 * tool reads and edits, in world space, and a baked turn keeps it
 * answering (plan §3.7: patterns keep baked cells). Both bake in place
 * about the pattern's centre.
 */
function bakePatternTurn(item: PatternObject): PatternObject {
  return GEOMETRY_ADAPTERS.pattern.rotate90CW(item) as PatternObject;
}

function bakePatternFlip(item: PatternObject, screenAxis: 'h' | 'v'): PatternObject {
  return GEOMETRY_ADAPTERS.pattern.mirror(item, screenAxis) as PatternObject;
}

/**
 * The pattern leaves among a unit gesture's ids, baked in place by `bake`
 * and carried to where `gesture` puts their centres — as ONE scene swap
 * that leads the entry (a `replaceScene` snapshots every collection off
 * the base state, so applied after the transforms it would put them
 * back). The ids it handled come back so the transform half can skip
 * them. Locked patterns, like locked anything, stay put.
 */
function bakedPatternOps(
  state: CompositionState,
  ids: readonly string[],
  bake: (item: PatternObject) => PatternObject,
  gesture: Mat2D,
): { ops: CompUndoOp[]; handled: Set<string> } {
  const handled = new Set<string>();
  const next = new Map<string, PatternObject>();
  for (const id of ids) {
    const ref = findItem(state, id);
    if (!ref || ref.kind !== 'pattern') continue;
    handled.add(id);
    if (isItemLocked(state, id)) continue;
    const item = ref.item as PatternObject;
    const baked = bake(item);
    // The centre rides the shared gesture; tile offsets are region-relative,
    // so the grid stays glued to the turned artwork as it moves.
    const [cx, cy] = matApplyPoint(gesture, item.cellX + item.cellWidth / 2, item.cellY + item.cellHeight / 2);
    next.set(id, {
      ...baked,
      cellX: cx - baked.cellWidth / 2,
      cellY: cy - baked.cellHeight / 2,
    });
  }
  if (next.size === 0) return { ops: [], handled };
  return {
    ops: [buildReplaceSceneOp(state, {
      patternObjects: (state.patternObjects ?? []).map((p) => next.get(p.id) ?? p),
    })],
    handled,
  };
}

/**
 * Commit a free (continuous) rotation from the two-finger twist gesture or
 * the Rotate slider: turn the node about its own centre so that it is DRAWN
 * at `newAngleDeg` (degrees CW, the one turn the graph keeps — the legacy
 * quarter turn and free angle added together). Works uniformly for every
 * non-figure kind as one `setTransform`. Rejects locked/missing nodes and
 * no-op deltas. Figures are unsupported (no free-rotation render/export
 * path), matching `buildRotateSelected`.
 */
export function buildRotateNodeFree(
  state: CompositionState,
  nodeId: string,
  newAngleDeg: number,
): SessionEntry | null {
  const ref = findItem(state, nodeId);
  if (!ref || isItemLocked(state, ref.item.id) || ref.kind === 'figure') return null;
  const delta = normalizeAngleDeg(normalizeAngleDeg(newAngleDeg) - worldTurnDeg(state, nodeId));
  if (delta === 0) return null;
  const pivot = worldCentre(state, nodeId);
  if (!pivot) return null;
  const entry = twistAbout(state, [nodeId], pivot, delta);
  return entry ? { entry } : null;
}

/** The Transform bar's Create copies request (editor-ui TransformCopiesSpec). */
export interface TransformCopies {
  count: number;
  /** Per-copy position offset, world cells. */
  dx: number;
  dy: number;
  /** Per-copy rotation offset, degrees clockwise. */
  dAngleDeg: number;
  /** Per-copy scale, each axis its own factor (1 = the same size). It
   *  COMPOUNDS: the i-th copy is scaled i times over, about its own
   *  centre, the way the offsets and the turn add up copy over copy. */
  sx: number;
  sy: number;
  /** Where the run's INK ENDS (the Copies page's Color tab): how faded and
   *  how opaque the LAST copy is, each 0…1. The object's own values are
   *  where the walk starts, and it is taken in even steps —
   *  {@link copyInkStep} — so the i-th copy sits `i` steps along and the
   *  last lands exactly here. More copies therefore make a GENTLER run to
   *  the same end, not a longer one past it.
   *
   *  The fade's TARGET COLOUR is not here: the copies inherit the object's
   *  (engine/fade.ts), and the tab says how far the run goes toward it.
   *
   *  Absent leaves that number alone, so a caller with nothing to say about
   *  the ink lays down the copies it always did. */
  finalFade?: number;
  finalOpacity?: number;
  /** What the run's fade walks TOWARD. A fade is spent into the colours
   *  rather than stored (engine/fadeBake.ts), so the target cannot be read
   *  off the original the way it once was — the host, which owns the
   *  Fade row's target, passes it in. Absent = white. */
  fadeColor?: RGBColor;
}

/** The most copies one press lays down — the bar's own ceiling, enforced
 *  here too so a typed number can't flood the page. */
export const TRANSFORM_COPIES_MAX = 24;

/**
 * A vector object's free rotation set to `angleDeg`, non-undoably — the live
 * preview while the Transform bar's Rotation slider drags (the commit is
 * {@link buildRotateNodeFree}, from the pre-drag state). Normalized like the
 * commit, so the preview and the committed value agree to the degree; 0
 * clears the field, as the commit does. Any other kind of node, or an
 * unknown id, comes back unchanged.
 */
export function withSVGAngle(state: CompositionState, nodeId: string, angleDeg: number): CompositionState {
  const normalized = normalizeAngleDeg(angleDeg);
  const next = normalized === 0 ? undefined : normalized;
  let changed = false;
  const svgObjects = state.svgObjects.map((s) => {
    if (s.id !== nodeId || (s.angleDeg ?? undefined) === next) return s;
    changed = true;
    const { angleDeg: _drop, ...rest } = s;
    return next === undefined ? rest : { ...rest, angleDeg: next };
  });
  return changed ? { ...state, svgObjects } : state;
}

/** What {@link transformCopyObjects} produces: the copies, and the ONE kind
 *  they all are (the original's). Carried together so the caller that places
 *  them — and the ghost layer that draws them — reads the kind from this one
 *  answer rather than guessing it from an id or asking each copy. */
export interface TransformCopyResult {
  kind: CompItemKind;
  items: CompItemRef['item'][];
}

/**
 * The copies the Transform bar's Create copies would lay down: `count`
 * copies of a vector object, the i-th moved `i × (dx, dy)` cells from it,
 * turned `i × dAngleDeg` further and scaled by `sx` / `sy` i times over
 * (about its own centre, so the run of copies keeps to the offsets' line)
 * — every copy is the one before it with the offsets added again, so a
 * shape steps across the page, wheels round and grows or shrinks as it
 * goes. A stretch (sx ≠ sy) rides the same per-axis rescale a corner
 * handle uses, so a circle becomes a true ellipse rather than kinked arcs.
 * Copies come out unlocked and loose (out of any group),
 * like a duplicate. Works on ANY node kind the scene adapters know — an
 * image and a text repeat as readily as a line, and the Copies page is
 * offered to all of them. Null for a locked or missing object, a kind with
 * no adapter, or a count below one; a count over
 * {@link TRANSFORM_COPIES_MAX} is capped rather than refused.
 *
 * One function for the press ({@link buildTransformCopies}) AND the ghost
 * preview the canvas shows while the bar is up, so the ghosts sit exactly
 * where the copies land. `mintId(i)` names the i-th copy: the press mints
 * fresh scene ids, the preview uses stable ghost ids so React can key on
 * them without minting anything.
 */
/** One ink number, `i` copies along a run of `count` that ENDS at `final`:
 *  the even walk from the object's own value, clamped. A `final` nobody set
 *  leaves the number where it started. */
function inkAt(from: number, final: number | undefined, i: number, count: number): number {
  if (final === undefined) return clamp01(from);
  return clamp01(from + copyInkStep(from, final, count) * i);
}

/**
 * The i-th copy's INK: the original's opacity, and a fade SPENT into the
 * colours it draws in, each walked `i` steps of the way to where the
 * Copies page's Color tab says the RUN ENDS.
 *
 * The walk is even and lands exactly on the asked-for end at the last copy,
 * so twelve copies dissolve more gently than three rather than overshooting
 * — which is what setting the END of a run means, and what a per-copy step
 * could not say without the reader doing the division themselves.
 *
 * The fade is spent, not stored (engine/fadeBake.ts): each copy comes out
 * carrying colours of its own, so the run reads as a run and yet every
 * copy's Stroke page can still say what its colour is. The opacity is a
 * property and is written as one.
 *
 * Applies to the COPY the loop holds — an item built and rescaled, not yet
 * in any state — where {@link withObjectOpacity} takes a state and a node
 * id. The two agree about where the opacity LIVES on each kind: a text on
 * its style (alpha), every other kind on the record, and a paint island has
 * no colour of its own to fade and takes the opacity alone.
 */
function steppedCopyInk(
  copy: CompItemRef['item'], kind: CompItemKind, i: number, count: number, spec: TransformCopies,
): CompItemRef['item'] {
  if (spec.finalFade === undefined && spec.finalOpacity === undefined) return copy;
  const target = spec.fadeColor ?? FADE_DEFAULT_COLOR;
  if (kind === 'text') {
    const text = copy as TextObject;
    const style = text.style;
    text.style = withTextOpacity(
      style,
      inkAt(style.alpha ?? 1, spec.finalOpacity, i, count),
      inkAt(0, spec.finalFade, i, count),
      target,
    );
    return copy;
  }
  const ink = copy as { opacity?: number };
  const opacity = inkAt(ink.opacity ?? 1, spec.finalOpacity, i, count);
  if (opacity < 1) ink.opacity = opacity; else delete ink.opacity;
  // A paint island is raster brushwork: no fill, no stroke, no border, so
  // nothing for a fade to move (engine/fade.ts).
  if (kind === 'paint') return copy;
  const fade = inkAt(0, spec.finalFade, i, count);
  if (!(fade > 0)) return copy;
  if (kind === 'image') return bakeFadeIntoImageObject(copy as ImageObject, fade, target);
  if (kind === 'pattern') return bakeFadeIntoPattern(copy as PatternObject, fade, target);
  if (kind === 'svg') return bakeFadeIntoSVGObject(copy as SVGObject, fade, target);
  return copy;
}

export function transformCopyObjects(
  state: CompositionState,
  nodeId: string,
  spec: TransformCopies,
  mintId: (i: number) => string,
): TransformCopyResult | null {
  const ref = findItem(state, nodeId);
  // Every kind with a Copies page: a rig's figure has its own pages and no
  // Copies tab, and its quads would not survive the per-axis rescale.
  if (!ref || ref.kind === 'figure' || isItemLocked(state, ref.item.id)) return null;
  const count = Math.min(TRANSFORM_COPIES_MAX, Math.floor(spec.count));
  if (!Number.isFinite(count) || count < 1) return null;
  const adapter = SCENE_ADAPTERS.find((a) => a.kind === ref.kind);
  if (!adapter) return null;
  const base = (ref.item as { angleDeg?: number }).angleDeg ?? 0;
  const items: CompItemRef['item'][] = [];
  for (let i = 1; i <= count; i++) {
    let copy = adapter.cloneWithOffset(
      ref.item as never, spec.dx * i, spec.dy * i, mintId(i), undefined,
    ) as CompItemRef['item'];
    detachFromGroup(copy, ref.kind);
    const fx = Math.pow(spec.sx, i);
    const fy = Math.pow(spec.sy, i);
    if (fx !== 1 || fy !== 1) {
      const oldBbox = { cellX: copy.cellX, cellY: copy.cellY, cellWidth: copy.cellWidth, cellHeight: copy.cellHeight };
      const newBbox = scaleBboxAboutCenter(oldBbox, fx, fy);
      copy = rescaleItem({ ...ref, item: copy } as CompItemRef, oldBbox, newBbox);
    }
    const angle = normalizeAngleDeg(base + spec.dAngleDeg * i);
    const turned = copy as { angleDeg?: number };
    if (angle === 0) delete turned.angleDeg;
    else turned.angleDeg = angle;
    // …and the ink each copy is made of (the Color tab), stepped the same
    // way the offsets and the turn are.
    copy = steppedCopyInk(copy, ref.kind, i, count, spec);
    // …and its NAME, numbered by its place in the run, so the outline shows
    // "Drawing 1 … Drawing 8" rather than eight rows saying the same word
    // (copyRunName). The ghost preview names its ghosts the same way and
    // throws them away; only the placed copies keep it.
    (copy as { name?: string }).name = copyRunName(
      ref.kind, ref.item as { name?: string; content?: string }, i,
    );
    items.push(adapter.cloneItem(copy as never) as CompItemRef['item']);
  }
  return { kind: ref.kind, items };
}

/**
 * Create copies (the Transform bar): the {@link transformCopyObjects} of the
 * object placed in one undo step for the whole set; the original stays
 * selected. Null whenever there is nothing to place.
 */
export function buildTransformCopies(
  state: CompositionState,
  nodeId: string,
  spec: TransformCopies,
): SessionEntry | null {
  const kind = findItem(state, nodeId)?.kind;
  const adapter = kind ? SCENE_ADAPTERS.find((a) => a.kind === kind) : undefined;
  const copies = adapter ? transformCopyObjects(state, nodeId, spec, () => adapter.mintId()) : null;
  if (!copies) return null;
  const entry: CompUndoOp[] = copies.items.map((item) => (
    { op: 'placeObject', kind: copies.kind, item } as CompUndoOp
  ));
  return { entry };
}

/**
 * The SAME run for a selection of several objects — a group, or any
 * marquee of loose ones. Everything selected is copied `count` times over,
 * and the i-th copy of the whole SET is carried by one world map: moved
 * `i × (dx, dy)`, turned `i × dAngleDeg` and scaled `i` times over, all
 * about the SELECTION's own centre rather than each member's, so the set
 * travels, wheels and grows as one thing and never comes apart.
 *
 * It goes through the DUPLICATE machinery rather than cloning items the
 * way the single-object run does, because what makes a group worth copying
 * is everything an item clone drops: a bound group is replicated as a
 * group (so eight copies are eight groups, not eighty loose objects), a
 * rig's hidden pose record travels with its figure, and every copy lands
 * in the slot above what it copies. The per-copy map is then one
 * {@link buildGestureEntry} over the copies' roots — the same world
 * gesture the two-finger twist commits, which a bound group takes as one
 * transform on its group node and loose members take each in turn,
 * orbiting the shared centre.
 *
 * Null for fewer than two ids, a selection with nothing copyable in it, or
 * a count below one; a count over {@link TRANSFORM_COPIES_MAX} is capped,
 * exactly as the single-object run caps it.
 */
export function buildTransformCopiesMulti(
  state: CompositionState,
  ids: readonly string[],
  spec: TransformCopies,
): { entry: CompUndoEntry; newIds: string[] } | null {
  if (ids.length < 2) return null;
  const count = Math.min(TRANSFORM_COPIES_MAX, Math.floor(spec.count));
  if (!Number.isFinite(count) || count < 1) return null;
  // The box the canvas outlines around the selection — the pivot every
  // other multi gesture turns about (multiSelectionPivot).
  const pivot = multiSelectionPivot(state, ids);
  if (!pivot) return null;
  const target = spec.fadeColor ?? FADE_DEFAULT_COLOR;
  const entry: CompUndoEntry = [];
  // Ascending, whatever order the copies are BUILT in: a caller reading
  // this reads the run from its first copy to its last.
  const madeIds: string[][] = [];
  // Each copy is duplicated off the RUNNING state, so its ops are indexed
  // against the page the copies before it are already on, and applied as
  // they are built — the gesture and the ink that follow have to read the
  // copy where it actually lands.
  //
  // The run is built LAST COPY FIRST. Every copy is placed in the slot
  // just above the ORIGINALS (duplicateInsertIndex reads the ids being
  // duplicated, which are the originals every time), so each one pushes
  // the copies already there further forward — and building backwards is
  // what leaves the run stacked the way the single-object run stacks it,
  // the last copy in front.
  let cur = state;
  for (let i = count; i >= 1; i--) {
    const dup = duplicateOpsAboveOriginals(cur, ids, {
      // No duplicate nudge: the offsets ARE the spec's, and a copy at
      // (0, 0) sitting exactly on its original is a run the user asked
      // for (a turn or a scale alone).
      offset: 0,
    });
    if (dup.ops.length === 0) return null;
    cur = applyCompOps(cur, dup.ops);
    entry.push(...dup.ops);
    // …then the one map that puts the i-th copy where the bar says.
    const moved = buildGestureEntry(
      cur, selectionRoots(cur, dup.newIds), copyGesture(pivot, spec, i),
    );
    if (moved) {
      cur = applyCompOps(cur, moved);
      entry.push(...moved);
    }
    // …and the ink the run walks toward, stepped exactly as the
    // single-object run steps it: every member of the i-th copy sits `i`
    // steps along the walk from its own colours (steppedCopyInk).
    for (const id of dup.newIds) {
      const inked = buildSetObjectOpacity(
        cur, id,
        inkAt(itemOpacity(cur, id), spec.finalOpacity, i, count),
        inkAt(0, spec.finalFade, i, count),
        target,
      );
      if (!inked) continue;
      cur = applyCompOps(cur, inked.entry);
      entry.push(...inked.entry);
    }
    madeIds.unshift(dup.newIds);
  }
  return entry.length > 0 ? { entry, newIds: madeIds.flat() } : null;
}

/** The world map the i-th copy of a SELECTION is carried by: moved
 *  `i × (dx, dy)`, turned `i × dAngleDeg` and scaled `i` times over, the
 *  turn and the scale about the selection's own centre. The one reading of
 *  the spec's geometry — the press commits it as a gesture over the
 *  copies' roots, the ghost layer multiplies it into each member's world
 *  pose, and the two cannot drift. */
function copyGesture(
  pivot: readonly [number, number], spec: TransformCopies, i: number,
): Mat2D {
  return matMul(
    matTranslate(spec.dx * i, spec.dy * i),
    aboutPoint(pivot, spec.dAngleDeg * i, Math.pow(spec.sx, i), Math.pow(spec.sy, i)),
  );
}

/** An object's own whole-object opacity — where the Copies run's opacity
 *  walk starts for it. A text keeps it on its style (TextStyle.alpha),
 *  every other kind on the record; 1 for anything that carries none. */
function itemOpacity(state: CompositionState, nodeId: string): number {
  const ref = findItem(state, nodeId);
  if (!ref) return 1;
  if (ref.kind === 'text') return ref.item.style.alpha ?? 1;
  return (ref.item as { opacity?: number }).opacity ?? 1;
}

/** The ghost preview's stable id for the i-th Create copies ghost of a node
 *  — never a scene id, so a ghost can't be mistaken for (or collide with)
 *  a placed object. */
export const transformGhostId = (nodeId: string, i: number) => `ghost:${nodeId}:${i}`;

/** How faint the canvas draws a ghost preview: the object's own look at
 *  just under half strength — plainly where the copies would land, yet
 *  still a proposal that never crowds the object it previews or reads as
 *  placed. */
export const GHOST_OPACITY = 0.45;

/** One ghost as the canvas draws it: the node layer its KIND uses, and the
 *  world pose it is drawn at. A pose rather than a bare item because a
 *  copy of a bound GROUP carries its transform on the group node — the
 *  member records under it never move, and a layer handed one of those
 *  would draw the ghost back where the original stands. */
export interface TransformGhost {
  kind: CompItemKind;
  drawn: DrawnLeaf;
}

/**
 * The copies the Copies page's draft would lay down, posed for the ghost
 * layer — for ANY selection. One object's run comes straight off
 * {@link transformCopyObjects} (items that live in no state, drawn as they
 * are); a group's or a marquee's is the same per-copy world map
 * ({@link copyGesture}) laid over each member's CURRENT world pose, which
 * is what a ghost needs and all it needs.
 *
 * It does not go through {@link buildTransformCopiesMulti}, though that is
 * what the press runs, and the reason is cost: the press's run places
 * every copy of every member for real (a group of eight, copied
 * twenty-four times, is 192 objects), and applying that entry takes a
 * quarter of a second — once, on a press, which is fine, and on EVERY
 * frame of a slider drag, which is not. The two agree because the gesture
 * the press commits is `world' = M · world` for each root, and that is
 * exactly what this multiplies.
 *
 * The ink the Color tab asks for is baked into the ghosts the same way the
 * single-object run bakes it, and skipped entirely when the tab asked for
 * nothing — so an offset or rotation drag pays one matrix multiply per
 * ghost and nothing else.
 *
 * Ghost ids are {@link transformGhostId}'s, so a ghost keeps its id
 * between drafts (React keys hold still) and can never be mistaken for a
 * scene id.
 */
export function transformCopyGhosts(
  state: CompositionState,
  ids: readonly string[],
  spec: TransformCopies,
): TransformGhost[] | null {
  if (ids.length === 1) {
    const made = transformCopyObjects(state, ids[0], spec, (i) => transformGhostId(ids[0], i));
    if (!made) return null;
    return made.items.map((item) => ({ kind: made.kind, drawn: drawnLeafOf(made.kind, item) }));
  }
  if (ids.length === 0) return null;
  const count = Math.min(TRANSFORM_COPIES_MAX, Math.floor(spec.count));
  if (!Number.isFinite(count) || count < 1) return null;
  const pivot = multiSelectionPivot(state, ids);
  if (!pivot) return null;
  const graph = graphOf(state);
  // The members as they stand: what draws them, and where. A locked one is
  // ghosted like the rest — the press copies it too (only the ORIGINAL is
  // protected by its lock, and a copy comes out unlocked).
  const members = ids
    .map((id) => ({ ref: findItem(state, id), drawn: drawnLeaf(graph, id) }))
    .filter((m): m is { ref: CompItemRef; drawn: DrawnLeaf } => !!m.ref && !!m.drawn
      && m.ref.kind !== 'figure');
  if (members.length === 0) return null;
  const inking = spec.finalFade !== undefined || spec.finalOpacity !== undefined;
  const ghosts: TransformGhost[] = [];
  for (let i = 1; i <= count; i++) {
    const gesture = copyGesture(pivot, spec, i);
    for (const { ref, drawn } of members) {
      // The ghost's LOOK: the member's own node, or — when the Color tab
      // named an end for the run — a node built from a copy inked `i`
      // steps along it. Only colours change, and a node's local geometry
      // is the same whatever pose it is drawn at, so the member's world
      // matrix still places it.
      let node = drawn.node;
      if (inking) {
        const adapter = SCENE_ADAPTERS.find((a) => a.kind === ref.kind);
        const copy = adapter
          ? adapter.cloneItem(ref.item as never) as CompItemRef['item'] : ref.item;
        node = drawnLeafOf(ref.kind, steppedCopyInk(copy, ref.kind, i, count, spec)).node;
      }
      ghosts.push({
        kind: ref.kind,
        drawn: {
          node: { ...node, id: transformGhostId(ref.item.id, i) },
          world: matMul(gesture, drawn.world),
        },
      });
    }
  }
  return ghosts;
}


/** Wrap an angle in degrees to (-180, 180], snapping values within
 *  `EPS_DEG` of a right angle so a deliberate near-upright twist settles
 *  exactly (avoids a persisted 0.01° that reads as "not rotated"). */
export function normalizeAngleDeg(deg: number, epsDeg = 0.5): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  for (const snap of [-180, -90, 0, 90, 180]) {
    if (Math.abs(d - snap) <= epsDeg) return snap === 180 ? 180 : snap === -180 ? 180 : snap;
  }
  return d;
}

/** Smallest bbox extent a scale gesture may shrink a node to, in L0 cells —
 *  keeps a pinch-to-nothing from producing a zero/negative box. */
const MIN_SCALE_CELLS = 0.1;

/**
 * Uniformly scale a node about its centre by `factor` (from the two-finger
 * pinch): one `setTransform`. Rejects locked/missing/figure nodes and no-op
 * factors; a turn the node already carries composes with the scale for free.
 *
 * Text scales its TYPE as well as its box — a pinch is "make this bigger",
 * so the glyphs grow with the bbox (the graph's legacy view scales the type
 * with the node's world scale). That is the one way this differs from the
 * corner-handle resize in {@link buildResizeNode}, which reflows the same
 * type into a new box.
 */
export function buildScaleNode(
  state: CompositionState,
  nodeId: string,
  factor: number,
): SessionEntry | null {
  const ref = findItem(state, nodeId);
  if (!ref || isItemLocked(state, ref.item.id) || ref.kind === 'figure') return null;
  if (!(factor > 0) || factor === 1) return null;
  const { cellX, cellY, cellWidth, cellHeight } = ref.item;
  const oldBbox = { cellX, cellY, cellWidth, cellHeight };
  const newBbox = scaleBboxAboutCenter(oldBbox, factor);
  if (newBbox.cellWidth === cellWidth && newBbox.cellHeight === cellHeight) return null;
  // Scale by the factor the BOX actually took, not the one asked for: a
  // pinch collapsing past MIN_SCALE_CELLS is clamped.
  const applied = cellWidth > 0 ? newBbox.cellWidth / cellWidth
    : cellHeight > 0 ? newBbox.cellHeight / cellHeight : factor;
  const pivot = worldCentre(state, nodeId);
  if (!pivot) return null;
  const entry = twistAbout(state, [nodeId], pivot, 0, applied);
  return entry ? { entry } : null;
}

/**
 * The bbox a scale by `factor` produces (and `factorY`, when the axes
 * differ — the Transform bar's per-copy Scale X / Y): each axis multiplied,
 * held about the box's own center, floored at MIN_SCALE_CELLS so a
 * collapsing pinch can't drive a node to zero. Shared by
 * {@link buildScaleNode} (what a pinch commits), the canvas's live
 * Dimensions HUD — so the size the user reads mid-pinch is exactly the one
 * that lands on release — and {@link transformCopyObjects}.
 */
export function scaleBboxAboutCenter(bbox: CellBbox, factor: number, factorY: number = factor): CellBbox {
  const cx = bbox.cellX + bbox.cellWidth / 2;
  const cy = bbox.cellY + bbox.cellHeight / 2;
  // A degenerate axis (a perfectly horizontal / vertical line's thin side)
  // stays exactly 0: flooring it to MIN_SCALE_CELLS would shift the box's
  // origin half the floor off the stroke every pinch.
  const cellWidth = bbox.cellWidth === 0 ? 0 : Math.max(bbox.cellWidth * factor, MIN_SCALE_CELLS);
  const cellHeight = bbox.cellHeight === 0 ? 0 : Math.max(bbox.cellHeight * factorY, MIN_SCALE_CELLS);
  return { cellX: cx - cellWidth / 2, cellY: cy - cellHeight / 2, cellWidth, cellHeight };
}

/**
 * `target`'s content reflowed into its new LOCAL box, as the legacy world
 * leaf the arrays store (engine `rescaleLeafLocal`).
 *
 * The node's transform is untouched, so the box's image is where the drag
 * put it and the world fields that come back are the spelling
 * `toLegacyView` would have chosen — which is what lets the per-kind ops
 * below stay exactly what they were. A simple H/V line does not stretch
 * the stroke it has but draws a new one across the box, so it takes the
 * other door into the same frame.
 */
function rescaledLeaf(state: CompositionState, target: ResizeTarget): CompItemRef['item'] | null {
  const graph = graphOf(state);
  const id = target.ref.item.id;
  const line = resizedLineLocal(graph, id, state.gridLevel, target.newLocal);
  const out = line
    ? localLeafToWorld(graph, id, line as never)
    : rescaleLeafLocal(graph, id, target.newLocal, {
      source: (leaf, oldBox, newBox) => rescaleSource(
        target.ref.kind, leaf as CompItemRef['item'], oldBox, newBox,
      ) as never,
    });
  return (out ?? null) as CompItemRef['item'] | null;
}

/**
 * Rescale a node's geometry from `oldBbox` to `newBbox` and commit it through
 * the SAME per-kind ops as {@link buildRotateSelected} — svg via
 * editSVGSegments, image via editImage, text via a scene swap — so it
 * round-trips through undo/redo with no new op kind. The geometry adapter
 * (`GEOMETRY_ADAPTERS[kind].rescale`) maps segments/bbox with independent x/y
 * factors. Figures are unsupported; callers reject them upstream.
 *
 * ONE caller, {@link buildResizeNode}: the corner-handle resize, which is the
 * only gesture left that rewrites geometry. A pinch does not come here any
 * more — {@link buildScaleNode} is a `setTransform` on the graph, and the
 * node's contents (a text node's glyphs included) take the scale from its
 * matrix rather than from a rewrite of its stored lengths. The `fontFactor`
 * parameter that served that second caller is gone with it.
 */
function buildRescaleEntry(
  state: CompositionState,
  target: ResizeTarget,
): SessionEntry | null {
  const { ref } = target;
  if (!isRescalable(ref)) return null;
  const scaled = rescaledLeaf(state, target);
  if (!scaled) return null;
  switch (ref.kind) {
    case 'svg':
      return { entry: [buildEditSVGOrientationOp(ref.item, scaled as SVGObject)] };
    case 'image':
      return { entry: [buildEditImageTransformOp(ref.item, scaled as ImageObject)] };
    case 'text': {
      // A corner-handle resize is the user explicitly authoring the box,
      // which is the moment a text node leaves auto-size (Figma's rule) —
      // from here on content/style edits reflow within this box. A pinch
      // leaves the mode alone, so an auto box still hugs its content
      // afterwards; it never reaches here, being a graph transform.
      //
      // A WORD STICKER has no such distinction: it is one printed magnet, so
      // the type always takes the box's factor, corner drag included. Its box
      // is the word plus a fixed margin (wordStickerCard), so a card grown
      // around type that stayed put would just be a word rattling in a bigger
      // frame. The drag is aspect-locked (requiresUniformScale), so the one
      // factor the width takes is the whole story.
      const factor = (ref.item as TextObject).sticker && target.oldLocal.width > 0
        ? target.newLocal.width / target.oldLocal.width
        : undefined;
      const next = factor === undefined
        ? { ...(scaled as TextObject), fixedSize: true }
        : factor !== 1
          ? scaleTextTypography(scaled as TextObject, factor)
          : (scaled as TextObject);
      const texts = (state.texts ?? []).map((t) => (t.id === ref.item.id ? next : t));
      return { entry: [buildReplaceTextsOp(state, texts)] };
    }
    case 'paint':
      // Bbox-only, like text: the tiles stretch with the contentRect→bbox
      // mapping, so a resize is just the bbox swap (never a resample).
      return { entry: [buildReplacePaintOp(state, scaled as PaintObject)] };
    case 'pattern':
      // Bbox-only too — stretch mode's cells map through the bbox at bake
      // time, and repeat mode's adapter has already folded the origin-edge
      // move into the tile offset (see patternAdapter.rescale).
      return { entry: [buildReplacePatternOp(state, scaled as PatternObject)] };
    default:
      return null;
  }
}

/**
 * Grow (or shrink) a text node's type by `factor`, to accompany a uniform
 * scale of its box. Font size and outline width are the two style lengths
 * authored in absolute L0 cells, so they are the two that would otherwise
 * stay put while the box around them changed — "text snapped back to the
 * same size in a bigger box". Everything else is already relative
 * (`lineHeight` multiplies size, `letterSpacing` is in em) and follows for
 * free, which is what keeps the wrapped lines breaking in the same places at
 * every size.
 *
 * One caller left, the WORD STICKER's aspect-locked corner drag. A pinch is a
 * graph transform now and scales the glyphs through the node's matrix, so it
 * does not rewrite these lengths at all.
 */
function scaleTextTypography(txt: TextObject, factor: number): TextObject {
  const { style } = txt;
  return {
    ...txt,
    style: {
      ...style,
      size: style.size * factor,
      stroke: style.stroke
        ? { ...style.stroke, width: style.stroke.width * factor }
        : style.stroke,
    },
  };
}

/**
 * Must this node scale uniformly? NOT for a curve, open or closed. Neither an
 * arc nor a circle is held to its aspect any more: `rescaleSegs` sheds an arc
 * into the polyline of the curve it already is before a per-axis map touches
 * it (`flattenArcSegment`, sampled uniformly in angle so no point moves on
 * the way past), and the stretch then turns it into a true elliptical arc
 * rather than the broken geometry a mapped (start, end, center) triple would
 * be. A closed circle has taken that road for a while — through
 * {@link rescaleSource}, which swaps its arcs for the exact polyline ellipse;
 * the lone arc went on being aspect-locked only because nothing had pointed
 * it at the same door. A quarter arc pulled wide is now a quarter ELLIPSE,
 * which is the shape the drag asked for.
 *
 * The cost is the arcs themselves: a stretched curve is line segments from
 * then on, so it no longer exports as `A r,r` and no longer answers to
 * `isCircularSegments`. A UNIFORM scale keeps them — the radius stays honest
 * under one factor — so a circle dragged from a corner on the diagonal is
 * still a circle, and only a drag that actually changes the aspect spends
 * them.
 *
 * Grid Snap does not enter into it. Snapping decides WHERE the dragged edge
 * lands, not what shape the box is allowed to be — the same rule creation
 * follows (nothing squares a creation box either, see gridSnap.ts), and the
 * two have to agree or an oval you can draw on the grid is one you can't
 * then resize on it.
 *
 * True for pattern objects (baked tile
 * files, `patternFileId`): the tile is authored on a fixed cell grid, so
 * stretching it non-uniformly distorts every sprite, and Edit→rebake would
 * then snap it back — EXCEPT in pattern (repeat) mode, where a resize
 * changes only the repeating region (the tile keeps its own size and more
 * copies fill the box), so any aspect is fine.
 *
 * Also true where the HOST says so (sessionHost.ts `nodes.holdsAspect`):
 * CozyJournal's Figgie rig, whose silhouette is a body and must never
 * stretch, and Reimagine's seeded squiggle — the GIVEN of that game, which
 * may be moved, turned, recolored, extended or scaled, but not squashed into
 * a different shape. The host answers for the nodes that are its own; the
 * rules above are the session's.
 *
 * The aspect preserved is the node's CURRENT bbox aspect. The gesture layer
 * constrains the drag with it (see computeCornerResize's `uniform`);
 * `resizeTarget` re-applies it as the backstop for every other caller.
 */
export function requiresUniformScale(
  state: CompositionState,
  nodeId: string,
): boolean {
  const ref = findItem(state, nodeId);
  if (!ref) return false;
  // Pattern nodes: the tile grid is authored on fixed cells, so stretch
  // mode scales aspect-locked; repeat mode resizes only the region.
  if (ref.kind === 'pattern') return ref.item.tileMode !== 'repeat';
  // A word sticker is a printed magnet: the card is the word plus its
  // margin, so pulling one axis would leave the type floating in a card
  // that no longer fits it. It scales, but only as the whole tile.
  if (ref.kind === 'text') return !!ref.item.sticker;
  if (ref.kind !== 'svg' || ref.item.tileMode === 'repeat') return false;
  if (sessionHost().nodes?.holdsAspect?.(state, nodeId)) return true;
  return ref.item.patternFileId != null;
}

/**
 * The item a rescale actually maps. Everything hands back what it was given
 * — except a closed CIRCLE on its way to a box of another aspect, which is
 * first redrawn as the polyline the same circle would be drawn as today
 * (`computeOvalSegments` on its CURRENT box, so nothing moves). The per-axis
 * map then turns that polyline into an exact ellipse, where mapping the
 * arcs would have left each one's radius disagreeing with its endpoints.
 *
 * The substitution is for the NEW geometry only: the undo op still records
 * the circle that was really there, so stepping back restores its arcs.
 */
/** A node's geometry mapped from `oldBbox` onto `newBbox` — the one
 *  rescale every door goes through (pinch, corner handle, the Transform
 *  bar's scaled copies): the kind's geometry adapter over
 *  {@link rescaleSource}'s stretch-ready form of the item. */
function rescaleItem(
  ref: CompItemRef,
  oldBbox: CellBbox,
  newBbox: CellBbox,
): CompItemRef['item'] {
  return GEOMETRY_ADAPTERS[ref.kind].rescale(
    rescaleSource(ref.kind, ref.item, oldBbox, newBbox) as never, oldBbox, newBbox,
  ) as CompItemRef['item'];
}

/** Takes the kind and a bare leaf rather than a {@link CompItemRef}: the
 *  corner resize hands it the node's content spelled in the node's OWN
 *  space (engine `sceneLocalResize`), which belongs to no array and so has
 *  no ref. */
function rescaleSource(
  kind: CompItemKind, leaf: CompItemRef['item'], oldBbox: CellBbox, newBbox: CellBbox,
): CompItemRef['item'] {
  if (kind !== 'svg') return leaf;
  const item = leaf as SVGObject;
  if (!isCircleSegments(item.segments)) return item;
  if (!(oldBbox.cellWidth > 0) || !(oldBbox.cellHeight > 0)) return item;
  const sameAspect = Math.abs(
    newBbox.cellWidth * oldBbox.cellHeight - newBbox.cellHeight * oldBbox.cellWidth,
  ) <= 1e-9 * oldBbox.cellWidth * oldBbox.cellHeight;
  if (sameAspect) return item; // still round: keep the arcs
  return {
    ...item,
    // The polyline form even though the old box IS square — it is the same
    // circle, drawn as segments, so nothing moves; the per-axis map below
    // is what turns it into the ellipse.
    segments: computeEllipsePolyline(
      oldBbox.cellX, oldBbox.cellY,
      oldBbox.cellX + oldBbox.cellWidth, oldBbox.cellY + oldBbox.cellHeight,
    ),
    subpaths: undefined,
    identitySegments: undefined,
  };
}

/**
 * Can this node be rescaled at all? Figures have no rescale path; everything
 * else can, through the single funnel every scale/resize goes through (pinch,
 * corner handle, live preview, the group map).
 *
 * Word stickers (magnetic poetry) used to be refused here — drag and rotate
 * only. That held them to the size the deal printed them at, which is not a
 * rule anyone asked for: a magnet is a thing on a page, and a big word and a
 * small word are how a message is written. They scale as a WHOLE magnet
 * instead — card, border and type together, always uniformly (see
 * {@link requiresUniformScale} and the sticker branch of
 * {@link buildRescaleEntry}), so a tile can never be stretched out of shape.
 */
function isRescalable(ref: CompItemRef): boolean {
  return ref.kind !== 'figure';
}

/**
 * Would a scale of this node commit anything? The same gate
 * {@link buildScaleNode} applies, minus the factor test — so the canvas can
 * ask BEFORE the fingers move whether to show a live scale at all. Drawing a
 * node growing under the pinch and then committing nothing is precisely the
 * snap-back-on-release the live preview exists to prevent.
 */
export function canScaleNode(state: CompositionState, nodeId: string): boolean {
  const ref = findItem(state, nodeId);
  return !!ref && !isItemLocked(state, ref.item.id) && isRescalable(ref);
}

/** A resize the geometry layer will accept: the node, the box it occupies
 *  in its OWN space, and the local box the request lands on. Local, not
 *  world: a resize is a new local box under an unchanged matrix, which is
 *  what lets a path inside a turned group stretch along its own axes
 *  instead of the world's (engine `sceneLocalResize`). */
interface ResizeTarget {
  ref: CompItemRef;
  oldLocal: Bbox;
  newLocal: Bbox;
}

/**
 * Resolve a corner-resize request into the node + bboxes the rescale runs on,
 * or null when the resize is rejected (missing / locked / figure node,
 * degenerate box). The single gate shared by {@link buildResizeNode}
 * (what the release commits) and {@link previewResizedNode} (what the canvas
 * draws mid-drag), so the preview can't land anywhere the commit wouldn't.
 */
function resizeTarget(
  state: CompositionState,
  nodeId: string,
  requested: CellBbox,
): ResizeTarget | null {
  const ref = findItem(state, nodeId);
  if (!ref || isItemLocked(state, ref.item.id) || !isRescalable(ref)) return null;
  if (!(requested.cellWidth > 0) || !(requested.cellHeight > 0)) return null;
  // The rectangle the outline was drawn as, and the box in the node's own
  // space it is the image of — ONE reading, the same one the drag was
  // seeded from ({@link resolveSelectionBox}).
  const base = nodeSelectionBaseBox(state, ref);
  if (!base.local) return null;
  let newBbox = requested;
  // Uniform-scale nodes (arcs, circles, pattern objects) keep their ORIGINAL
  // aspect. Callers are expected to have constrained the drag already;
  // snapping here (about the box's top-left, the same anchor convention the
  // bbox carries, taking the larger candidate axis like computeCornerResize)
  // keeps a stray caller from committing a distorted shape. Measured on the
  // DRAWN box: that is the rectangle the finger pulled, and the aspect a
  // rig or a sticker is being held to is the one on screen.
  if (requiresUniformScale(state, nodeId)) {
    const { cellWidth: ow, cellHeight: oh } = base.bbox;
    const aspect = ow > 0 && oh > 0 ? ow / oh : 1;
    if (Math.abs(newBbox.cellWidth / aspect - newBbox.cellHeight) > 1e-9) {
      newBbox = newBbox.cellWidth / aspect >= newBbox.cellHeight
        ? { ...newBbox, cellHeight: newBbox.cellWidth / aspect }
        : { ...newBbox, cellWidth: newBbox.cellHeight * aspect };
    }
  }
  const newLocal = localBoxForDrawnResize(
    worldMatrix(graphOf(state), nodeId), base.local, base.bbox, newBbox,
  );
  return { ref, oldLocal: base.local, newLocal };
}

/** Do two boxes name the same rectangle? Exact equality, like
 *  {@link sameBbox} whose local-frame twin this is. */
function sameLocalBox(a: Bbox, b: Bbox): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * Free corner-handle resize. `newBbox` is the DRAWN rectangle the drag
 * landed on — the same spelling {@link resolveSelectionBox} handed out,
 * with the opposite corner held fixed and the cursor projected into the
 * box's own axes (see @/editor/resizeMath). What lands on the node is
 * the LOCAL box that rectangle is the image of, its matrix untouched, so
 * the drag stretches the shape along its own axes however it is turned and
 * whatever it is grouped inside.
 * Non-uniform by design — the box aspect follows the drag: an svg rectangle's
 * segments stretch, an image stretches, and a text object's bounding box
 * changes, reflowing the same type into it (font size unchanged, matching
 * Facet's rectangle/image/text corner-resize — the two-finger pinch of
 * {@link buildScaleNode} is the path that scales type instead).
 * Rejects locked/missing/figure nodes, degenerate boxes, and
 * no-op drags. `angleDeg` rides through the reducers untouched.
 *
 * `flip` names the axes the drag turned over — the corner was pulled past
 * the pinned one, so `newBbox` lies on the far side of it (see resizeMath's
 * computeCornerResize). The node is resized onto that box and then
 * mirrored across the box's own axes ({@link flipAcrossBoxOps}), in the
 * same undo entry: what was the grabbed corner of the shape is still the
 * corner under the finger.
 */
/**
 * The line an axis-locked resize produces, spelled in the node's OWN
 * space: `requested` is the new straddle box (see {@link lineSelectionBox})
 * in that space, and the stroke is rebuilt on its perpendicular midline,
 * spanning its long axis — so the drag lengthens the line along exactly
 * its own axis, at any turn and inside any group.
 *
 * The old version did this in world coordinates and then wrote the result
 * back down the group chain by hand (`inverseChainedGroupTransformPoint`),
 * because world coords are derived from locals and the next group
 * transform would otherwise snap the stroke back. In the node's own frame
 * there is no chain to walk: the matrix carries the line out, and
 * `localLeafToWorld` spells the world fields.
 *
 * Null when `nodeId` isn't an editable simple H/V line — callers fall
 * through to the generic box rescale.
 */
function resizedLineLocal(
  graph: SceneGraph,
  nodeId: string,
  gridLevel: number,
  requested: Bbox,
): SVGObject | null {
  const node = getNode(graph, nodeId);
  if (!node || node.kind !== 'svg' || node.locked) return null;
  const item = localHitObject(node) as SVGObject;
  const axis = simpleLineAxis(item);
  if (!axis || !lineSelectionBox(item, gridLevel)) return null;
  if (!(requested.width > 0) || !(requested.height > 0)) return null;
  const [a, b] = computeLineVertices(
    requested.x, requested.y,
    requested.x + requested.width, requested.y + requested.height,
    axis === 'x' ? 'horizontal' : 'vertical',
  );
  // computeLineVertices returns min → max; keep the stored segment's own
  // point order so a resize never silently swaps start and end (endpoint
  // styling is per-end).
  const seg = item.segments[0] as Extract<PathSegment, { kind: 'line' }>;
  const forward = axis === 'x' ? seg.end[0] >= seg.start[0] : seg.end[1] >= seg.start[1];
  const segments: PathSegment[] = [{ kind: 'line', start: forward ? a : b, end: forward ? b : a }];
  const next: SVGObject = {
    ...item,
    segments,
    ...computeSVGBbox(segments),
    identitySegments: undefined, rotation: undefined, mirrorH: undefined, mirrorV: undefined,
  };
  // The straddle box is carried forward only for a loose line, which is
  // the only case `lineSelectionBox` reads it back for — a grouped line
  // derives its box from the live stroke instead.
  if (!node.parentId) {
    next.creationBox = {
      minX: requested.x, minY: requested.y,
      width: requested.width, height: requested.height,
    };
  }
  return next;
}

export function buildResizeNode(
  state: CompositionState,
  nodeId: string,
  newBbox: CellBbox,
  flip: ResizeFlip = NO_RESIZE_FLIP,
): SessionEntry | null {
  const target = resizeTarget(state, nodeId, newBbox);
  if (!target) return null;
  const resized = sameLocalBox(target.oldLocal, target.newLocal)
    ? null : buildRescaleEntry(state, target);
  if (!flip.x && !flip.y) return resized;
  // Turned over: mirror the node where the resize left it. Read off the
  // resized state, so the flip is about the box the drag landed on and
  // along the axes that box is drawn on — the one reading the outline and
  // the corner grab take (resolveSelectionBox).
  const ops = resized?.entry ?? [];
  const mid = ops.length > 0 ? applyCompOps(state, ops) : state;
  const landed = resolveSelectionBox(mid, nodeId);
  const flips = landed ? flipAcrossBoxOps(mid, [nodeId], landed.bbox, landed.angleDeg, flip) : [];
  const entry = [...ops, ...flips];
  return entry.length > 0 ? { entry } : null;
}

/** The kinds {@link previewResizedNode} can hand back — the resizable ones. */
export type ResizedNode = SVGObject | ImageObject | TextObject | PaintObject | PatternObject;

/**
 * The rescaled node a corner-resize to `newBbox` would produce, WITHOUT
 * touching the session: the canvas renders this mid-drag so the object
 * follows the selection box live instead of snapping into place on release.
 * It runs the same gate and the same `GEOMETRY_ADAPTERS[kind].rescale` as
 * {@link buildResizeNode}, so what the drag shows is exactly what the drop
 * commits. Null when the resize is rejected, i.e. when there is nothing to
 * preview because there would be nothing to commit.
 *
 * A drag that has turned the node over (`flip`) previews the node the
 * commit's own entry leaves — resize and mirror both — read back off the
 * state that entry produces. That costs a state advance per previewed box,
 * which the plain resize does not pay; it is spent only while the corner is
 * past the pinned one.
 */
export function previewResizedNode(
  state: CompositionState,
  nodeId: string,
  newBbox: CellBbox,
  flip: ResizeFlip = NO_RESIZE_FLIP,
): ResizedNode | null {
  if (flip.x || flip.y) {
    const se = buildResizeNode(state, nodeId, newBbox, flip);
    if (!se) return null;
    const ref = findItem(applyCompOps(state, se.entry), nodeId);
    return ref && ref.kind !== 'figure' ? (ref.item as ResizedNode) : null;
  }
  const target = resizeTarget(state, nodeId, newBbox);
  if (!target) return null;
  const scaled = rescaledLeaf(state, target) as ResizedNode | null;
  if (!scaled) return null;
  // A corner-resize marks a text node fixed-size (see buildRescaleEntry's
  // text case); mirrored here so the preview stays EXACTLY what the drop
  // commits.
  return target.ref.kind === 'text' ? { ...(scaled as TextObject), fixedSize: true } : scaled;
}

/**
 * The box a live resize's PREVIEW node occupies — what every outline drawn
 * around that node must hug mid-drag, in place of the committed geometry.
 *
 * One rule for all of them. The selection ring and the tile editor's double
 * ring frame the same object from two different reasons (a selection, and a
 * grid held open), and both are drawn from the committed state on a normal
 * render; while a corner drag is in flight the committed state has not
 * moved yet, so a ring that keeps reading it sits at the size the object
 * had when the finger went down and snaps into place on release. Asking
 * this one function means the two can't disagree about where the object is
 * — and can't drift apart later either.
 *
 * A simple H/V line previews its wider STRADDLE box, as its selection does
 * ({@link lineSelectionBox}): the previewed segment's own AABB is
 * degenerate on the frozen axis. Everything else — patterns included — is
 * its own bbox.
 */
export function resizePreviewBox(node: ResizedNode, gridLevel: number): CellBbox {
  const line = 'segments' in node ? lineSelectionBox(node as SVGObject, gridLevel) : null;
  if (line) return line;
  const { cellX, cellY, cellWidth, cellHeight } = node;
  return { cellX, cellY, cellWidth, cellHeight };
}

/**
 * Combined scale + free rotation: scale by `factor` AND set the free
 * rotation to `newAngleDeg`, as a SINGLE undo entry (scale ops first, then
 * the rotation).
 *
 * The two-finger twist's release commits through here — at factor 1, always:
 * the gesture is ROTATION ONLY (two-finger scale was removed because a pinch
 * aimed at the view resized whatever was big enough to hold both fingers,
 * and it stays removed), so the scale half no-ops and the entry is the pure
 * rotation. The factor parameter remains for any future affordance that
 * scales deliberately. Either half may be a no-op; returns null only when
 * both are. The scale ops preserve `angleDeg` and `setNodeRotation`
 * preserves the bbox, so the two compose without clobbering each other.
 */
export function buildManipulateNode(
  state: CompositionState,
  nodeId: string,
  factor: number,
  newAngleDeg: number,
): SessionEntry | null {
  const scale = buildScaleNode(state, nodeId, factor);
  const mid = scale ? applyCompOps(state, scale.entry) : state;
  const rotate = buildRotateNodeFree(mid, nodeId, newAngleDeg);
  const entry = [...(scale?.entry ?? []), ...(rotate?.entry ?? [])];
  return entry.length > 0 ? { entry } : null;
}

/** Flip one node across a screen axis through its own centre: one
 *  `setTransform`, spelled with the named mirror flag toggled. */
export function buildMirrorSelected(
  state: CompositionState,
  nodeId: string,
  screenAxis: 'h' | 'v' = 'h',
): SessionEntry | null {
  const ref = findItem(state, nodeId);
  if (!ref || isItemLocked(state, ref.item.id) || ref.kind === 'figure') return null;
  if (ref.kind === 'pattern') {
    return { entry: [buildReplacePatternOp(state, bakePatternFlip(ref.item, screenAxis))] };
  }
  const pivot = worldCentre(state, nodeId);
  if (!pivot) return null;
  const entry = mirrorAbout(state, [nodeId], pivot, screenAxis);
  return entry ? { entry } : null;
}

// ── Multi-select (marquee) ──────────────────────────────────────────
// The arrange tool's drag-on-empty-canvas selects every leaf node whose
// rendered bounds intersect the dragged rect, and the selection then acts as
// ONE unit: a single combined bounding box, moved / rotated / flipped as if
// the members shared a root transform. Leaf-only (svg / image / text) by
// design — figures have no arrange-tool transform path, frames are
// Scene-Outline selections, and a frame's boundary rect is its background
// surface (not tap-selectable, so not marquee-selectable either). Locked and
// hidden nodes are invisible to the marquee exactly as they are to a tap.
//
// Every unit gesture — move, turn, flip, twist, corner resize — is one
// world-space affine applied to the selection's ROOT nodes
// (transformGestures.selectionRoots): a bound group is lifted to its group
// node and takes the gesture as ONE `setTransform`, members untouched; a
// loose selection gives one per leaf. One entry either way.

/** The axis-aligned world bounds the marquee / combined box sees for a leaf:
 *  its own outline box expanded to the AABB of its free rotation. */
function nodeSelectionAabb(state: CompositionState, ref: CompItemRef): CellBbox {
  const { bbox, angleDeg } = nodeSelectionBaseBox(state, ref);
  return rotatedAabb(bbox, angleDeg);
}

/** Inclusive overlap — a degenerate axis (a flat H/V line's thin side) still
 *  counts when it lies within the other box, which strict inequalities would
 *  reject outright. */
function bboxesTouch(a: CellBbox, b: CellBbox): boolean {
  return a.cellX <= b.cellX + b.cellWidth && a.cellX + a.cellWidth >= b.cellX
    && a.cellY <= b.cellY + b.cellHeight && a.cellY + a.cellHeight >= b.cellY;
}

/**
 * The leaf nodes a marquee over `rect` (world cells) selects, in sceneOrder
 * (back → front). Selection is by intersection — touching the rect is enough,
 * Figma-style — against each node's rendered bounds (rotation-aware).
 */
export function marqueeHitIds<TDoc = undefined>(
  state: CompositionState, rect: CellBbox, hostDoc?: TDoc,
): string[] {
  if (!(rect.cellWidth > 0) || !(rect.cellHeight > 0)) return [];
  const boundaryIds = new Set<string>();
  for (const mask of buildFrameRectMap(state).values()) boundaryIds.add(mask.id);
  const out: string[] = [];
  for (const id of state.sceneOrder) {
    const ref = findItem(state, id);
    if (!ref || ref.kind === 'figure') continue;
    if (boundaryIds.has(id)) continue;
    if (isItemLocked(state, id) || isItemHidden(state, id)) continue;
    if (bboxesTouch(nodeSelectionAabb(state, ref), rect)) out.push(id);
  }
  // The host's items the rect touches join the scene's hits, after them, in
  // their own draw order; a locked one is passed by, as a locked shape is.
  const items = hostItems<TDoc, unknown>();
  if (hostDoc === undefined || !items) return out;
  const session = { state, hostDoc };
  const hits = items.items(hostDoc)
    .filter((m) => !isHostItemLocked(session, m.id))
    .filter((m) => { const b = items.box(hostDoc, m.id); return !!b && bboxesTouch(b, rect); })
    .map((m) => m.id);
  return hits.length === 0 ? out : [...out, ...hits];
}

/** The axis-aligned world bounds of what a leaf DRAWS. Unlike
 *  {@link nodeSelectionAabb} it takes no line straddle: that margin is a
 *  grab affordance for a line selected on its own, not part of the line.
 *
 *  Off the GRAPH, via the same `drawnCorners` the turned-group frame uses.
 *  The legacy spelling — an upright box plus a free angle — describes a
 *  rotated RECTANGLE, and a member of a group scaled off-square is a
 *  PARALLELOGRAM: the group's non-uniform scale shears anything turned
 *  inside it. Measuring the rectangle instead overstates the box on the
 *  sheared axis, which is a combined box visibly taller than the content
 *  it is drawn around. The legacy fields are kept as the fallback for a
 *  state with no graph to ask. */
function nodeInkAabb(state: CompositionState, ref: CompItemRef): CellBbox {
  const corners = drawnCorners(state, ref);
  if (corners.length > 0) {
    const xs = corners.map(([x]) => x);
    const ys = corners.map(([, y]) => y);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    return {
      cellX: minX, cellY: minY,
      cellWidth: Math.max(...xs) - minX, cellHeight: Math.max(...ys) - minY,
    };
  }
  const { cellX, cellY, cellWidth, cellHeight } = ref.item;
  return rotatedAabb({ cellX, cellY, cellWidth, cellHeight }, (ref.item as { angleDeg?: number }).angleDeg ?? 0);
}

/**
 * The single combined box the canvas outlines around a multi-selection (and
 * the box whose centre anchors the shared root transform): the union of every
 * member's INKED bounds. Null when none of the ids resolve. Axis-aligned
 * always — members keep their own rotations, the group box just contains them.
 *
 * Inked, not outlined: a simple H/V line selected alone wears a straddle box
 * a grid step thick so it can be grabbed (lineSelectionBox), but inside a
 * multi-selection or a group that margin made the combined box stand off the
 * strokes at its top or side by half a step while every other edge hugged
 * its member. The members' own boxes (the per-member rings, the marquee's
 * hit-test) keep the straddle; the box around them all does not.
 */
export function resolveMultiSelectionBox<TDoc = undefined>(
  state: CompositionState,
  ids: readonly string[],
  /** The host document, so a selected host item's box joins the union.
   *  Absent, host ids are skipped as any unresolved id is. */
  hostDoc?: TDoc,
): CellBbox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const items = hostDoc === undefined ? null : hostItems<TDoc, unknown>();
  for (const id of ids) {
    const ref = findItem(state, id);
    let b: CellBbox;
    if (ref) {
      b = nodeInkAabb(state, ref);
    } else {
      const box = items && items.isHostId(id) ? items.box(hostDoc as TDoc, id) : null;
      if (!box) continue;
      b = box;
    }
    minX = Math.min(minX, b.cellX);
    minY = Math.min(minY, b.cellY);
    maxX = Math.max(maxX, b.cellX + b.cellWidth);
    maxY = Math.max(maxY, b.cellY + b.cellHeight);
  }
  if (minX === Infinity) return null;
  return { cellX: minX, cellY: minY, cellWidth: maxX - minX, cellHeight: maxY - minY };
}

/**
 * The box the canvas outlines around a multi-selection, and the turn it is
 * drawn at.
 *
 * A loose selection, and a bound group standing square to the page, get the
 * axis-aligned combined box of {@link resolveMultiSelectionBox} at 0. A
 * bound group whose own world matrix carries a turn off the quarters gets a
 * ROTATED box: the corners of every member's drawn box taken into the
 * group's frame, unioned there, and turned back out — the rectangle the
 * group's world matrix puts around its content, rather than the page-aligned
 * box around a tilted one (plan §2.9). The corner handles sit on this box
 * and a corner drag scales along its axes, so a turned group resizes along
 * the axes it was built on.
 */
export function resolveMultiSelectionFrame<TDoc = undefined>(
  state: CompositionState,
  ids: readonly string[],
  hostDoc?: TDoc,
): { bbox: CellBbox; angleDeg: number } | null {
  const aabb = resolveMultiSelectionBox(state, ids, hostDoc);
  if (!aabb) return null;
  // A selection holding a host item is boxed square: a bot is a point with
  // a footprint, not a shape the group's turn can be read back off.
  if (hostDoc !== undefined && ids.some(isHostId)) return { bbox: aabb, angleDeg: 0 };
  const groupId = wholeGroupIdOfSelection(state, ids);
  if (!groupId) return { bbox: aabb, angleDeg: 0 };
  const graph = graphOf(state);
  if (!graph.nodes.has(groupId)) return { bbox: aabb, angleDeg: 0 };
  const turn = normalizeDeg(decomposeMatrix(worldMatrix(graph, groupId)).rotationDeg);
  const offQuarter = turn % 90;
  if (offQuarter < 1e-6 || 90 - offQuarter < 1e-6) return { bbox: aabb, angleDeg: 0 };

  // Into the group's frame: unturn the corners of every member's drawn box
  // about the origin, take the box there, and turn its centre back out. A
  // member square to its group lands exactly on its own box; one turned
  // within the group contributes its turned corners.
  const rad = (turn * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of ids) {
    const ref = findItem(state, id);
    if (!ref) continue;
    for (const [x, y] of drawnCorners(state, ref)) {
      const u = x * cos + y * sin;
      const v = -x * sin + y * cos;
      minX = Math.min(minX, u); minY = Math.min(minY, v);
      maxX = Math.max(maxX, u); maxY = Math.max(maxY, v);
    }
  }
  if (minX === Infinity) return { bbox: aabb, angleDeg: 0 };
  const w = maxX - minX, h = maxY - minY;
  const uc = minX + w / 2, vc = minY + h / 2;
  const cx = uc * cos - vc * sin;
  const cy = uc * sin + vc * cos;
  return {
    bbox: { cellX: cx - w / 2, cellY: cy - h / 2, cellWidth: w, cellHeight: h },
    angleDeg: signedDeg(turn),
  };
}

/** The four world corners of the box a member is drawn as: its own box
 *  through the matrix it is drawn with. Read off the graph, because the
 *  legacy view has no rotated-rectangle spelling for a path inside a
 *  turned group — it stores the turned path and the box around THAT. */
function drawnCorners(state: CompositionState, ref: CompItemRef): [number, number][] {
  const graph = graphOf(state);
  const node = getNode(graph, ref.item.id);
  if (node && node.kind !== 'group') {
    return matApplyCorners(worldMatrix(graph, ref.item.id), localContentBox(node));
  }
  const { bbox, angleDeg } = nodeSelectionBaseBox(state, ref);
  const cx = bbox.cellX + bbox.cellWidth / 2, cy = bbox.cellY + bbox.cellHeight / 2;
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const hw = bbox.cellWidth / 2, hh = bbox.cellHeight / 2;
  return ([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] as [number, number][])
    .map(([dx, dy]) => [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos]);
}

/**
 * Run a per-node entry builder over `ids`, folding each result into a working
 * state so every builder sees its predecessors applied, and concatenate the
 * ops into ONE entry (one undo step). Nodes the builder rejects are skipped
 * rather than vetoing the rest. The funnel for every "apply this option to
 * all selected objects" edit (and the multi move).
 */
export function buildForEachNode(
  state: CompositionState,
  ids: readonly string[],
  builder: (state: CompositionState, id: string) => SessionEntry | null,
): SessionEntry | null {
  let cur = state;
  const entry: CompUndoOp[] = [];
  for (const id of ids) {
    const se = builder(cur, id);
    if (!se) continue;
    entry.push(...se.entry);
    cur = applyCompOps(cur, se.entry);
  }
  return entry.length > 0 ? { entry } : null;
}

/** Move every (unlocked) selected node by the same delta, as one undo entry —
 *  the combined-box drag's commit. A bound group moves as its group node. */
export function buildMoveNodes<TDoc = undefined>(
  state: CompositionState,
  ids: readonly string[],
  dx: number,
  dy: number,
  hostDoc?: TDoc,
): SessionEntry | null {
  const entry = dragDelta(state, selectedSceneIds(ids), dx, dy);
  const se = entry ? { entry } : null;
  if (dx === 0 && dy === 0) return se;
  return withFreeHostItemsThrough(se, state, hostDoc, ids, matTranslate(dx, dy));
}

/** The world point a unit gesture pivots on: the centre of the box the
 *  canvas outlines around the selection. */
function multiSelectionPivot<TDoc>(
  state: CompositionState, ids: readonly string[], hostDoc?: TDoc,
): [number, number] | null {
  const frame = resolveMultiSelectionFrame(state, ids, hostDoc);
  if (!frame) return null;
  return [frame.bbox.cellX + frame.bbox.cellWidth / 2, frame.bbox.cellY + frame.bbox.cellHeight / 2];
}

/**
 * Rotate a multi-selection 90° CW about its combined centre as ONE root
 * transform: a bound group turns as its group node; loose members each
 * turn in place AND orbit the shared centre, exactly as if they shared a
 * rotating parent. Figures and locked members sit it out.
 */
export function buildRotateSelectedMulti<TDoc = undefined>(
  state: CompositionState,
  ids: readonly string[],
  hostDoc?: TDoc,
): SessionEntry | null {
  const pivot = multiSelectionPivot(state, ids, hostDoc);
  if (!pivot) return null;
  const scene = selectedSceneIds(ids);
  // Patterns bake the turn and orbit as content; everything else is one
  // transform each (or one for the whole bound group).
  const patterns = bakedPatternOps(state, scene, bakePatternTurn, aboutPoint(pivot, 90, 1, 1));
  const rest = twistAbout(state, scene.filter((id) => !patterns.handled.has(id)), pivot, 90);
  const entry = [...patterns.ops, ...(rest ?? [])];
  return withFreeHostItemsThrough(
    entry.length > 0 ? { entry } : null, state, hostDoc, ids, aboutPoint(pivot, 90, 1, 1),
  );
}

/**
 * The same for a GROUP (a multi-selection acting as one unit) — the group
 * twist's release, likewise always at factor 1 (see above): turn the whole
 * selection by `deltaDeg` and scale it by `factor`, both about the combined
 * box centre, as ONE undo entry. A bound group takes it as one transform on
 * its group node; loose members each scale about their own centre, turn by
 * the delta, and orbit the shared centre — the same rigid-root-transform
 * model as {@link buildRotateSelectedMulti}, generalized to a continuous
 * angle plus a pinch factor. Locked members and figures are skipped (callers
 * gate whole groups on canTwoPointerManipulate).
 */
export function buildManipulateNodes<TDoc = undefined>(
  state: CompositionState,
  ids: readonly string[],
  factor: number,
  deltaDeg: number,
  hostDoc?: TDoc,
): SessionEntry | null {
  if (!(factor > 0)) return null;
  if (factor === 1 && normalizeAngleDeg(deltaDeg) === 0) return null;
  const pivot = multiSelectionPivot(state, ids, hostDoc);
  if (!pivot) return null;
  const entry = twistAbout(state, selectedSceneIds(ids), pivot, deltaDeg, factor);
  return withFreeHostItemsThrough(
    entry ? { entry } : null, state, hostDoc, ids, aboutPoint(pivot, deltaDeg, factor, factor),
  );
}

/**
 * Corner-resize a GROUP selection: carry `oldBox` (the combined box at grab
 * time) onto `newBox` (the box the corner drag computed), both drawn at
 * `angleDeg` about their centres, as ONE undo entry. Per-axis factors along
 * the box's own axes, so both uniform and non-uniform scaling work. A bound
 * group takes it as one transform on its group node — every member,
 * whatever it is, rides the same map: an svg's path stretches, a repeating
 * pattern's tiling scales with it, and a text's type grows with its box
 * (plan Q3). Locked members and figures are skipped.
 *
 * `flip` names the axes the drag turned over (the corner pulled past the
 * pinned one — `newBox` then lies on its far side): the selection is
 * carried onto `newBox` and then mirrored across that box's own axes, as
 * one entry, the way a single node's corner drag is ({@link buildResizeNode}).
 */
export function buildResizeNodes<TDoc = undefined>(
  state: CompositionState,
  ids: readonly string[],
  oldBox: CellBbox,
  newBox: CellBbox,
  angleDeg = 0,
  flip: ResizeFlip = NO_RESIZE_FLIP,
  hostDoc?: TDoc,
): SessionEntry | null {
  const scene = selectedSceneIds(ids);
  const same = sameBbox(oldBox, newBox);
  const resized = same ? null : resizeBox(state, scene, oldBox, newBox, angleDeg);
  // The host items' half: the same box-to-box map, then the same flips
  // across the new box's own axes.
  let hostMap: Mat2D | null = same ? null : boxToBoxGesture(oldBox, newBox, angleDeg);
  const centre: [number, number] = [newBox.cellX + newBox.cellWidth / 2, newBox.cellY + newBox.cellHeight / 2];
  for (const axis of ['h', 'v'] as const) {
    if (!(axis === 'h' ? flip.x : flip.y)) continue;
    const m = matAbout(centre, mirrorLinear(axis, angleDeg));
    hostMap = hostMap ? matMul(m, hostMap) : m;
  }
  const withHost = (se: SessionEntry | null) => (
    hostMap ? withFreeHostItemsThrough(se, state, hostDoc, ids, hostMap) : se
  );
  if (!flip.x && !flip.y) return withHost(resized ? { entry: resized } : null);
  const ops = resized ?? [];
  const mid = ops.length > 0 ? applyCompOps(state, ops) : state;
  const entry = [...ops, ...flipAcrossBoxOps(mid, scene, newBox, angleDeg, flip)];
  return withHost(entry.length > 0 ? { entry } : null);
}

/**
 * Can a corner drag resize this multi-selection as one unit? True whenever
 * every member is transformable — no figures, nothing locked.
 *
 * A LOOSE selection counts, not only a bound group. The combined box is a
 * box either way, and {@link buildResizeNodes} carries one box onto another
 * as a single world affine over the selection's roots — loose members each
 * take the same map about the shared centre, which is exactly what scaling
 * "these five things together" means. Requiring a bound group first made
 * the commonest way to resize several objects — marquee them, drag a corner
 * — draw no handles at all, so the box sat there looking like a thing you
 * could grab and wasn't.
 *
 * The same gate draws the corner handles and accepts the grab, so the
 * affordance is never shown where the drag would be refused.
 */
export function canResizeMultiSelection(
  state: CompositionState,
  ids: readonly string[],
): boolean {
  if (ids.length < 2) return false;
  return ids.every((id) => {
    // A host item moves with the box, never grows: it never refuses.
    if (isHostId(id)) return true;
    const ref = findItem(state, id);
    return !!ref && ref.kind !== 'figure' && !isItemLocked(state, id);
  });
}

/**
 * Flip a multi-selection across its combined centre as ONE root transform:
 * a bound group flips as its group node; loose members each mirror in place
 * AND reflect across the shared axis. A member's turn reflects with it (a
 * reflection conjugates the turn), as the single-node flip does.
 */
export function buildMirrorSelectedMulti<TDoc = undefined>(
  state: CompositionState,
  ids: readonly string[],
  screenAxis: 'h' | 'v',
  hostDoc?: TDoc,
): SessionEntry | null {
  const pivot = multiSelectionPivot(state, ids, hostDoc);
  if (!pivot) return null;
  const entry = mirrorSelectionOps(state, selectedSceneIds(ids), pivot, screenAxis);
  return withFreeHostItemsThrough(
    entry.length > 0 ? { entry } : null, state, hostDoc, ids, matAbout(pivot, mirrorLinear(screenAxis)),
  );
}

/**
 * One flip of `ids` across an axis through `pivot` — the screen's, or at
 * `angleDeg` a turned box's own. Pattern leaves are baked in place and
 * carried to where the flip puts their centres (their flip is never on
 * their transform — see {@link bakePatternFlip}); everything else takes
 * the reflection as a `setTransform` on its root. The ops both the Mirror
 * buttons and a corner dragged past its pinned corner commit.
 */
function mirrorSelectionOps(
  state: CompositionState,
  ids: readonly string[],
  pivot: readonly [number, number],
  axis: 'h' | 'v',
  angleDeg = 0,
): CompUndoOp[] {
  const patterns = bakedPatternOps(
    state, ids, (item) => bakePatternFlip(item, axis), matAbout(pivot, mirrorLinear(axis, angleDeg)),
  );
  const rest = mirrorAbout(
    state, ids.filter((id) => !patterns.handled.has(id)), pivot, axis, angleDeg,
  );
  return [...patterns.ops, ...(rest ?? [])];
}

/**
 * The flips a corner drag asked for, as ops: `ids` mirrored across the
 * axes of `box` — a rectangle drawn at `angleDeg` about its own centre —
 * once for each axis `flip` names. The box itself does not move: a
 * rectangle is its own mirror image across either of its axes, so the
 * pinned corner stays pinned and only the content turns over.
 *
 * Two flips are applied one after the other (the second read off the state
 * the first leaves), so each root's mirror flags come back as two named
 * flips rather than as the half turn the pair amounts to.
 */
function flipAcrossBoxOps(
  state: CompositionState,
  ids: readonly string[],
  box: CellBbox,
  angleDeg: number,
  flip: ResizeFlip,
): CompUndoOp[] {
  const pivot: [number, number] = [box.cellX + box.cellWidth / 2, box.cellY + box.cellHeight / 2];
  const out: CompUndoOp[] = [];
  let cur = state;
  for (const axis of ['h', 'v'] as const) {
    if (!(axis === 'h' ? flip.x : flip.y)) continue;
    const ops = mirrorSelectionOps(cur, ids, pivot, axis, angleDeg);
    if (ops.length === 0) continue;
    out.push(...ops);
    cur = applyCompOps(cur, ops);
  }
  return out;
}

/**
 * Align a multi-selection against its own combined box: every unlocked member
 * slides — along ONE axis only — until its rendered bounds sit flush to that
 * box's left / right (or top / bottom) edge, or straddle its centre line. The
 * box is the union of the members, so at least one member is already flush to
 * each edge and never moves; the rest close up on it. The box's aligned axis
 * therefore collapses to the widest member, and the edge the members gathered
 * on stays put — which makes an align idempotent: repeating one returns null
 * once nothing has left to move.
 *
 * Deltas are measured against the ORIGINAL state — every member reads the same
 * box, rather than each seeing its predecessors already moved.
 *
 * Bounds here are the rotation-aware AABBs the canvas outlines (the same ones
 * {@link resolveMultiSelectionBox} unions), so a freely-rotated member aligns
 * by what you can see rather than by its unrotated box. A pure translation
 * moves an AABB by the same delta, so no rotation maths is needed on top.
 */
export function buildAlignSelectedMulti<TDoc = undefined>(
  state: CompositionState,
  ids: readonly string[],
  edge: AlignEdge,
  hostDoc?: TDoc,
): SessionEntry | null {
  const box = resolveMultiSelectionBox(state, ids, hostDoc);
  if (!box) return null;
  const horizontal = alignAxis(edge) === 'h';
  const position = alignPosition(edge);
  // The host's items align as shapes do, each unit by its own box.
  const hostMoves = new Map<string, [number, number]>();
  for (const unit of hostLayoutUnits(state, hostDoc, ids)) {
    const delta = horizontal
      ? alignedStart(box.cellX, box.cellWidth, unit.box.cellWidth, position) - unit.box.cellX
      : alignedStart(box.cellY, box.cellHeight, unit.box.cellHeight, position) - unit.box.cellY;
    if (delta === 0) continue;
    for (const id of unit.ids) hostMoves.set(id, horizontal ? [delta, 0] : [0, delta]);
  }
  // Pre-measure every delta against the untouched state, then let
  // buildForEachNode fold the moves into one undo entry. A wholly selected
  // group is ONE unit (layoutUnits): it slides as a piece, rather than
  // each of its members being pushed to the edge on its own.
  const units = new Map<string, LayoutUnit>();
  const deltas = new Map<string, number>();
  for (const unit of layoutUnits(state, selectedSceneIds(ids))) {
    const b = layoutUnitAabb(state, unit);
    if (!b) continue;
    const delta = horizontal
      ? alignedStart(box.cellX, box.cellWidth, b.cellWidth, position) - b.cellX
      : alignedStart(box.cellY, box.cellHeight, b.cellHeight, position) - b.cellY;
    if (delta === 0) continue;
    units.set(unit.root, unit);
    deltas.set(unit.root, delta);
  }
  const scene = deltas.size === 0 ? null : buildForEachNode(state, [...deltas.keys()], (cur, root) => {
    const d = deltas.get(root)!;
    return moveLayoutUnit(cur, units.get(root)!, horizontal ? d : 0, horizontal ? 0 : d);
  });
  return withHostMoves(scene, hostDoc, hostMoves);
}

/** A Layout action's host units: each host item no scene group carries, or
 *  a group of them selected whole as one piece, with the box it is laid out
 *  by. Those riding a scene group are laid out with it. */
interface HostLayoutUnit {
  readonly ids: readonly string[];
  readonly box: CellBbox;
}

function hostLayoutUnits<TDoc>(
  state: CompositionState, hostDoc: TDoc | undefined, ids: readonly string[],
): HostLayoutUnit[] {
  const items = hostItems<TDoc, unknown>();
  if (hostDoc === undefined || !items) return [];
  const units = new Map<string, string[]>();
  for (const id of freeHostIds(state, items, hostDoc, ids)) {
    const key = items.itemById(hostDoc, id)!.groupId ?? id;
    const list = units.get(key);
    if (list) list.push(id);
    else units.set(key, [id]);
  }
  return [...units.values()].map((members) => ({
    ids: members,
    box: resolveMultiSelectionBox(state, members, hostDoc)!,
  }));
}

/** Each host item in `moves` slid by its own delta, as the host half of
 *  `se`. */
function withHostMoves<TDoc>(
  se: SessionEntry | null, hostDoc: TDoc | undefined, moves: ReadonlyMap<string, [number, number]>,
): SessionEntry | null {
  const items = hostItems<TDoc, unknown>();
  if (hostDoc === undefined || !items || moves.size === 0) return se;
  let doc: TDoc = hostDoc;
  for (const [id, [dx, dy]] of moves) doc = items.through(doc, new Set([id]), matTranslate(dx, dy));
  return withHostChange(se, hostDoc, doc);
}

/**
 * What a Layout action places: a plain group whose every member is
 * selected is ONE unit, its group node — the root the drag, the twist and
 * the flip already lift it to (transformGestures.selectionRoots) — and
 * every other selected leaf is a unit of its own. Locked members are not
 * units: an align or a grid leaves them where they are.
 *
 * Gridding or aligning the LEAVES of a group took it apart: each member
 * went to a slot or an edge of its own, so a selection holding a group
 * came out as a scatter of its pieces rather than the group, laid out.
 *
 * In the order the selection names them (the first leaf of a group seats
 * it), so the grid's tie-break is the selection's order, as it was.
 */
interface LayoutUnit {
  /** The node that moves: the group node, or the leaf itself. */
  readonly root: string;
  /** The selected leaves under it — just the root, for a leaf. */
  readonly leaves: readonly string[];
}

function layoutUnits(state: CompositionState, ids: readonly string[]): LayoutUnit[] {
  const graph = graphOf(state);
  const roots = new Set(selectionRoots(state, ids));
  const units = new Map<string, string[]>();
  for (const id of ids) {
    let root: string | null | undefined = id;
    while (root && !roots.has(root)) root = getNode(graph, root)?.parentId;
    if (!root) continue;
    const leaves = units.get(root);
    if (leaves) leaves.push(id);
    else units.set(root, [id]);
  }
  return [...units].map(([root, leaves]) => ({ root, leaves }));
}

/** A unit that is one loose leaf, and the ref it resolves to. */
function layoutUnitLeaf(state: CompositionState, unit: LayoutUnit): CompItemRef | null {
  return unit.leaves.length === 1 && unit.leaves[0] === unit.root
    ? findItem(state, unit.root)
    : null;
}

/** The rendered bounds a unit aligns by: a leaf's rotation-aware box (what
 *  the canvas outlines), a group's the box around all its members' ink —
 *  the combined box it is outlined by when selected. */
function layoutUnitAabb(state: CompositionState, unit: LayoutUnit): CellBbox | null {
  const leaf = layoutUnitLeaf(state, unit);
  return leaf ? nodeSelectionAabb(state, leaf) : resolveMultiSelectionBox(state, unit.leaves);
}

/** Slide a unit by a world delta: a leaf by its own move, a group as its
 *  group node. */
function moveLayoutUnit(
  state: CompositionState, unit: LayoutUnit, dx: number, dy: number,
): SessionEntry | null {
  if (layoutUnitLeaf(state, unit)) return buildMoveNode(state, unit.root, dx, dy);
  const entry = dragDelta(state, unit.leaves, dx, dy);
  return entry ? { entry } : null;
}

/**
 * Square a unit up: take its turn to the nearest quarter, about its own
 * centre, so it lines up with the page. A leaf turns by its own free
 * rotation; a group turns as its group node about the middle of its box, so
 * its members keep their places within it. Null when it already stands on
 * a quarter. Figures only ever stand on one, so they never turn here.
 */
function squareLayoutUnit(state: CompositionState, unit: LayoutUnit): SessionEntry | null {
  const turn = worldTurnDeg(state, unit.root);
  const square = nearestQuarterDeg(turn);
  if (normalizeAngleDeg(square - turn) === 0) return null;
  if (layoutUnitLeaf(state, unit)) return buildRotateNodeFree(state, unit.root, square);
  const box = resolveMultiSelectionBox(state, unit.leaves);
  if (!box) return null;
  const centre: [number, number] = [box.cellX + box.cellWidth / 2, box.cellY + box.cellHeight / 2];
  const entry = twistAbout(state, unit.leaves, centre, signedDeg(square - turn));
  return entry ? { entry } : null;
}

/**
 * Lay a multi-selection out as a grid, anchored at the top-left corner of its
 * own combined box. The members are sorted by rendered height (shortest
 * first) and packed left-to-right into top-aligned rows cut to equal WIDTH
 * rather than equal count — a row of small members holds more of them, so a
 * mixed selection comes out as a block and not a wedge. Neighbours sit a
 * small margin apart (a tenth of the typical member), and each row starts
 * `max(height)` of the row above it, plus that margin, below that row — see
 * {@link gridPlacements}, which owns the packing and the margin so they can
 * be reasoned about without a scene.
 *
 * Gridding also squares every member up — a turn off the quarters is taken
 * to the nearest quarter as part of the same edit. A grid is a statement
 * about how things line up, and a member left at 37° doesn't line up with
 * anything; unturning it is what makes the rows read as rows. A member at a
 * quarter turn already lines up and keeps it. The turn and the move ride in
 * one undo entry, so one tap is still one step back.
 *
 * That un-rotation is why BOTH the packing and the grid's origin are measured
 * from UNROTATED boxes, rather than from the rotation-aware AABBs
 * {@link buildAlignSelectedMulti} uses. An AABB says where a member is *now*,
 * and this is the one action that changes that: packing by what a member will
 * occupy once it lands keeps the rows evenly spaced instead of leaving a
 * rotated member's slack behind, and taking the origin the same way stops a tilt from
 * dragging the whole grid up and left of the content it came from. The
 * unturn spins a node about its own centre, so the two don't interact and
 * the grid lands exactly as computed.
 *
 * The origin is the top-left of the combined box so measured, over EVERY
 * member that resolves — locked ones included, as in an align, where a locked
 * member still helps define the box the others gather into.
 *
 * Locked members neither move nor take a slot: like an align, this leaves them
 * exactly where they are — rotation included — so the grid is built from the
 * unlocked members only and `n` counts just those. That can leave a locked
 * member overlapping the grid, which is the same bargain align already makes.
 *
 * Placements are measured against the ORIGINAL state and folded into one undo
 * entry; re-gridding an already-gridded selection returns null.
 */
export function buildGridSelectedMulti<TDoc = undefined>(
  state: CompositionState,
  ids: readonly string[],
  hostDoc?: TDoc,
): SessionEntry | null {
  const sceneIds = selectedSceneIds(ids);
  let originX = Infinity;
  let originY = Infinity;
  // A locked member takes no slot but still helps define the corner.
  for (const id of ids) {
    const ref = findItem(state, id);
    if (!ref || !isItemLocked(state, id)) continue;
    const bbox = squaredBox(state, ref);
    originX = Math.min(originX, bbox.cellX);
    originY = Math.min(originY, bbox.cellY);
  }
  // Each unit — a loose leaf, or a wholly selected group as one piece
  // (layoutUnits) — is packed by the box it will occupy once squared up:
  // a leaf's content box at the nearest quarter turn, centred where it
  // stands; a group's box around its members once the group itself is
  // turned square.
  const members: {
    unit: LayoutUnit | null; host?: readonly string[]; x: number; y: number; width: number; height: number;
  }[] = [];
  for (const unit of layoutUnits(state, sceneIds)) {
    const leaf = layoutUnitLeaf(state, unit);
    let bbox: CellBbox | null;
    if (leaf) {
      bbox = squaredBox(state, leaf);
    } else {
      const square = squareLayoutUnit(state, unit);
      bbox = resolveMultiSelectionBox(square ? applyCompOps(state, square.entry) : state, unit.leaves);
    }
    if (!bbox) continue;
    originX = Math.min(originX, bbox.cellX);
    originY = Math.min(originY, bbox.cellY);
    members.push({ unit, x: bbox.cellX, y: bbox.cellY, width: bbox.cellWidth, height: bbox.cellHeight });
  }
  // The host's items take slots beside the shapes, each unit by its box.
  for (const unit of hostLayoutUnits(state, hostDoc, ids)) {
    const b = unit.box;
    originX = Math.min(originX, b.cellX);
    originY = Math.min(originY, b.cellY);
    members.push({ unit: null, host: unit.ids, x: b.cellX, y: b.cellY, width: b.cellWidth, height: b.cellHeight });
  }
  // A member left means the corner is finite; none, and there is no grid to
  // build — an all-locked or wholly unresolvable selection falls out here.
  if (members.length === 0) return null;
  const placements = gridPlacements(members, originX, originY);
  const hostMoves = new Map<string, [number, number]>();
  members.forEach((m, i) => {
    if (!m.host) return;
    const dx = tidy(placements[i].x - m.x);
    const dy = tidy(placements[i].y - m.y);
    if (dx !== 0 || dy !== 0) for (const id of m.host) hostMoves.set(id, [dx, dy]);
  });
  const sceneMembers = members.filter((m) => m.unit !== null);
  const slots = new Map(members.flatMap((m, i) => (m.unit ? [[m.unit.root, i] as const] : [])));
  const scene = sceneMembers.length === 0 ? null : buildForEachNode(state, sceneMembers.map((m) => m.unit!.root), (cur, root) => {
    const i = slots.get(root)!;
    const m = members[i];
    // Unturn and move are independent (a turn about the centre leaves the
    // centre alone, a translation leaves the turn alone) and either may
    // no-op — a member already square and already in its slot contributes
    // nothing, which is what makes re-gridding return null. Deltas under
    // float noise count as none. The move is built on the UNTURNED state:
    // both are transforms on the one node, and a second transform built
    // from the same state as the first would carry the first back with it.
    const unturn = squareLayoutUnit(cur, m.unit!);
    const square = unturn ? applyCompOps(cur, unturn.entry) : cur;
    const dx = tidy(placements[i].x - m.x);
    const dy = tidy(placements[i].y - m.y);
    const move = dx !== 0 || dy !== 0 ? moveLayoutUnit(square, m.unit!, dx, dy) : null;
    const entry: CompUndoOp[] = [...(unturn?.entry ?? []), ...(move?.entry ?? [])];
    return entry.length > 0 ? { entry } : null;
  });
  return withHostMoves(scene, hostDoc, hostMoves);
}

/**
 * Straighten a multi-selection: every unit's turn goes to the nearest
 * quarter (0, 90, 180 or 270), about its own centre, and nothing else
 * changes — the squaring-up a grid does, without the grid. A wholly
 * selected group turns as one piece (layoutUnits), so its members keep
 * their places within it; locked members sit it out. One undo entry;
 * null when everything already stands on a quarter.
 */
export function buildStraightenSelectedMulti(
  state: CompositionState,
  ids: readonly string[],
): SessionEntry | null {
  const units = new Map(layoutUnits(state, ids).map((u) => [u.root, u]));
  return buildForEachNode(state, [...units.keys()], (cur, root) => squareLayoutUnit(cur, units.get(root)!));
}

/** A delta under float noise is no delta. */
function tidy(n: number): number {
  return Math.abs(n) < 1e-9 ? 0 : n;
}

/** The quarter turn nearest `deg`; a tie (45, 135, ...) goes toward the
 *  smaller turn, so a member at exactly 45 squares up to 0 rather than 90. */
function nearestQuarterDeg(deg: number): number {
  const q = Math.trunc((Math.abs(deg) + 45 - 1e-9) / 90) * 90;
  return deg < 0 ? -q : q;
}

/** The box a member will occupy once the grid squares it up: its drawn
 *  content box, turned to the nearest quarter about its own centre — so
 *  a member at 90 keeps its swapped footprint and a member at 37 packs as
 *  the plain box it is about to become. */
function squaredBox(state: CompositionState, ref: CompItemRef): CellBbox {
  const { bbox, angleDeg } = nodeSelectionBaseBox(state, ref);
  const quarter = ((Math.round(angleDeg / 90) % 4) + 4) % 4;
  if (quarter % 2 === 0) return bbox;
  const cx = bbox.cellX + bbox.cellWidth / 2;
  const cy = bbox.cellY + bbox.cellHeight / 2;
  return {
    cellX: cx - bbox.cellHeight / 2, cellY: cy - bbox.cellWidth / 2,
    cellWidth: bbox.cellHeight, cellHeight: bbox.cellWidth,
  };
}

/** Duplicate every selected node (group-aware, same offset as the single
 *  duplicate); the copies come up selected together via SessionEntry.ids. */
export function buildDuplicateSelectedMulti<TDoc = undefined>(
  state: CompositionState,
  ids: readonly string[],
  hostDoc?: TDoc,
): SessionEntry | null {
  const offset = computeDuplicateOffset(state);
  const { ops, newIds, groupIdMap } = duplicateOpsAboveOriginals(state, selectedSceneIds(ids), { offset });
  const items = hostItems<TDoc, unknown>();
  const hostIds = hostDoc !== undefined && items ? selectedHostIds(ids) : [];
  if (hostIds.length === 0) return ops.length === 0 ? null : { entry: ops, ids: newIds };
  // The host's copies take the same offset as the scene's (the host may
  // round it up to its own grid), each joining its group's copy — the
  // scene's duplicate of a group it rides, or a fresh id for a group of
  // host items alone.
  const minted = new Map<string, string>();
  const groupCopyOf = (gid: string | undefined): string | undefined => {
    if (!gid) return undefined;
    const mapped = groupIdMap.get(gid) ?? minted.get(gid);
    if (mapped) return mapped;
    const fresh = mintNodeId('group');
    minted.set(gid, fresh);
    return fresh;
  };
  const dup = items!.duplicate(hostDoc as TDoc, hostIds, offset, groupCopyOf);
  if (ops.length === 0 && dup.ids.length === 0) return null;
  return withHostChange({ entry: ops, ids: [...newIds, ...dup.ids] }, hostDoc as TDoc, dup.doc);
}

/** Delete every selected node as one undo entry (group-safe: strands prune
 *  via buildRemoveObjectOps). */
export function buildRemoveSelectedMulti<TDoc = undefined>(
  state: CompositionState,
  ids: readonly string[],
  hostDoc?: TDoc,
): SessionEntry | null {
  const entry = buildRemoveObjectOps(state, selectedSceneIds(ids));
  const se = entry.length > 0 ? { entry } : null;
  const items = hostItems<TDoc, unknown>();
  if (hostDoc === undefined || !items) return se;
  // A locked host item stays, as a locked shape does.
  const session = { state, hostDoc };
  const gone = new Set(ids.filter((id) => items.isHostId(id) && !isHostItemLocked(session, id)));
  if (gone.size === 0) return se;
  return withHostChange(se, hostDoc, items.remove(hostDoc, gone));
}

/** Whether a multi-selection reads as locked: EVERY member is locked (by its
 *  own flag or an inherited group lock). One unlocked member and the
 *  selection is still workable, so it reads unlocked — which is what the
 *  radial menu's lock icon shows and what {@link buildToggleLockMulti}
 *  inverts. */
export function isMultiSelectionLocked<TDoc = undefined>(
  state: CompositionState,
  ids: readonly string[],
  /** The host document, so a selection's host items count. Absent, only
   *  the scene's members are asked. */
  hostDoc?: TDoc,
): boolean {
  const items = hostItems<TDoc, unknown>();
  if (hostDoc === undefined || !items) {
    const scene = selectedSceneIds(ids);
    return scene.length > 0 && scene.every((id) => isItemLocked(state, id));
  }
  const session = { state, hostDoc };
  const members = ids.filter((id) => !items.isHostId(id) || items.itemById(hostDoc, id));
  return members.length > 0 && members.every((id) => (items.isHostId(id)
    ? isHostItemLocked(session, id)
    : isItemLocked(state, id)));
}

/** Lock or unlock a whole multi-selection as one undo entry.
 *
 *  A selection that IS one plain group — every member of it and nothing else,
 *  which is what a tap on a grouped object (and Group itself) leaves selected
 *  — locks the GROUP NODE, exactly as the Scene Outline's lock on the group
 *  row does: one lock icon, on the group, and one toggle that frees the whole
 *  thing. Locking each member instead left the group row bare and a lock on
 *  every child, so select → Group → Lock and the outline's own lock disagreed
 *  about what had been locked.
 *
 *  Any other multi-selection drives every member to ONE value — lock unless
 *  they are all locked already — rather than flipping each in place, so a
 *  mixed selection converges instead of inverting into a differently-mixed
 *  one. Only own flags move (as in the panel's single Lock button): a member
 *  held by an inherited group lock stays locked, and the super-long-press
 *  unlock remains the way to free that one. */
export function buildToggleLockMulti<TDoc = undefined>(
  state: CompositionState,
  ids: readonly string[],
  hostDoc?: TDoc,
): SessionEntry | null {
  const items = hostItems<TDoc, unknown>();
  const scene = selectedSceneIds(ids);
  const hostIds = hostDoc !== undefined && items ? selectedHostIds(ids) : [];
  // A whole scene group locks as the group, and its host items with it
  // (they inherit its lock, as its leaves do).
  const groupId = wholeGroupIdOfSelection(state, scene);
  const riders = groupId && hostDoc !== undefined
    ? new Set(groupSelectionMemberIds({ state, hostDoc }, groupId)) : null;
  if (groupId && hostIds.every((id) => riders?.has(id))) return buildToggleLockGroup(state, groupId);
  // Otherwise one press drives every member — shapes and host items — to
  // the same value.
  const next = !isMultiSelectionLocked(state, ids, hostDoc);
  const se = buildForEachNode(state, scene, (cur, id) => buildToggleLock(cur, id, next));
  if (hostIds.length === 0) return se;
  return withHostChange(se, hostDoc as TDoc, items!.setLocked(hostDoc as TDoc, new Set(hostIds), next));
}

/** Lock or unlock the one host item `id` names (its own flag). */
export function buildToggleHostItemLock<TDoc>(hostDoc: TDoc, id: string, next?: boolean): SessionEntry | null {
  const items = hostItems<TDoc, unknown>();
  const member = items?.itemById(hostDoc, id);
  if (!items || !member) return null;
  const value = next ?? !member.locked;
  if (value === !!member.locked) return null;
  return withHostChange(null, hostDoc, items.setLocked(hostDoc, new Set([id]), value));
}

// ── Group / Union (multi-selection) ─────────────────────────────────
// The two STRUCTURAL actions a multi-selection offers, ported from Facet's
// object-properties panel. They are the pair because they answer the same
// wish at two depths: Group keeps the members and binds them, Union spends
// them and returns one shape.
//
// Both check locks themselves. `opTargetIds` reports no target for
// `groupFigures` / `unionObjects` / `replaceScene` (there is no single node
// they mutate), so the commit-time lock guard cannot see these entries — the
// check has to live in the builder, which is the convention the guard's own
// doc comment sets out.

/** The outermost PLAIN group a leaf belongs to — what "this object is grouped"
 *  resolves to. Null for a loose leaf, and null inside a frame: a frame's
 *  members are scaffold slots (the photo, each haiku line) and must stay
 *  individually tappable, so the climb stops below a frame and a leaf whose
 *  own group IS one is left alone.
 */
export function outermostPlainGroupId(state: CompositionState, leafId: string): string | null {
  const gid = getItemGroupId(state, leafId);
  return gid ? outermostPlainGroupOf(state, gid) : null;
}

/** {@link outermostPlainGroupId} from a group rather than a leaf: the
 *  outermost plain group `gid` sits in (itself, at the root); null when it
 *  is not a scene group or is a frame. */
export function outermostPlainGroupOf(state: CompositionState, gid: string): string | null {
  let group: GroupNode | undefined = state.groups.find((g) => g.id === gid);
  if (!group || group.isFrame) return null;
  for (;;) {
    const parentId: string | undefined = group.parentGroupId;
    const parent: GroupNode | undefined = parentId
      ? state.groups.find((g) => g.id === parentId)
      : undefined;
    if (!parent || parent.isFrame) return group.id;
    group = parent;
  }
}

/** What tapping `leafId` should actually select: every leaf of the plain group
 *  it belongs to, so a group MOVES AS ONE UNIT — the whole point of binding
 *  it. Null when the leaf is loose (or in a frame), leaving the plain
 *  single-node selection alone; null too for a one-member group, which has no
 *  unit to act as.
 */
export function groupSelectionIds(state: CompositionState, leafId: string): string[] | null {
  const groupId = outermostPlainGroupId(state, leafId);
  if (!groupId) return null;
  const ids = allDescendantMemberIds(state, groupId).filter((id) => findItem(state, id));
  return ids.length >= 2 ? ids : null;
}

/** Each id expanded to its whole plain group (loose / frame-member / lone
 *  survivors pass through as themselves), deduped in first-seen order — the
 *  expansion select / selectMany / toggleSelect all promote through, kept in
 *  one place so no selection path can drift from "a group is one thing". */
export function expandSelectionGroups(
  state: CompositionState, ids: readonly string[],
): string[] {
  return expandEach(ids, (id) => groupSelectionIds(state, id));
}

/** Each id replaced by what `unitOf` expands it to (itself when null),
 *  deduped in first-seen order. */
function expandEach(ids: readonly string[], unitOf: (id: string) => string[] | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    for (const member of unitOf(id) ?? [id]) {
      if (seen.has(member)) continue;
      seen.add(member);
      out.push(member);
    }
  }
  return out;
}

/** The plain group a multi-selection covers EXACTLY — every member of it and
 *  nothing else. That selection is already one unit, so the panel offers to
 *  undo the binding (Ungroup) rather than to mint a wrapper around it. Null
 *  when the selection spans several groups, or holds anything loose.
 */
export function wholeGroupIdOfSelection(
  state: CompositionState,
  ids: readonly string[],
): string | null {
  if (ids.length < 2) return null;
  const groupId = outermostPlainGroupId(state, ids[0]);
  if (!groupId) return null;
  if (ids.some((id) => outermostPlainGroupId(state, id) !== groupId)) return null;
  const members = allDescendantMemberIds(state, groupId).filter((id) => findItem(state, id));
  return members.length === ids.length ? groupId : null;
}

/** Dissolve the plain group a multi-selection covers exactly, leaving its
 *  members loose and selected as they are. The counterpart to
 *  {@link buildGroupSelectedMulti}: press Group, press Ungroup, and the scene
 *  is where it started.
 *
 *  The lock that refuses it is the GROUP's — its own flag, or one it inherits
 *  from a container (a locked frame around it) — the same question
 *  {@link buildUngroupFrame} asks of a frame. A locked MEMBER does not: the
 *  binding being undone is the group's, and a member's lock says that member
 *  stays put, which it does — ungrouping hands the group's transform down, so
 *  nothing moves, and the member keeps its lock (a locked child group stays
 *  whole, and locked). Vetoing on any locked member made a group of groups
 *  impossible to take apart once anything inside it was locked, with the
 *  Ungroup button sitting there doing nothing. */
export function buildUngroupSelectedMulti<TDoc = undefined>(
  state: CompositionState,
  ids: readonly string[],
  hostDoc?: TDoc,
): SessionEntry | null {
  const items = hostItems<TDoc, unknown>();
  if (hostDoc === undefined || !items) {
    const groupId = wholeGroupIdOfSelection(state, ids);
    if (!groupId) return null;
    if (isGroupChainLocked(state, groupId)) return null;
    return buildUngroupGroup(state, groupId);
  }
  // With the host's items: the unit may be a scene group with items on it,
  // or a group of items alone. Its own go loose; one on a child group stays
  // on it, as a member of a child group does.
  const unitId = wholeUnitOfSelection({ state, hostDoc }, ids);
  if (!unitId) return null;
  const scene = state.groups.some((g) => g.id === unitId);
  if (scene && isGroupChainLocked(state, unitId)) return null;
  const se = scene ? buildUngroupGroup(state, unitId) : null;
  const own = new Set(items.items(hostDoc).filter((m) => m.groupId === unitId).map((m) => m.id));
  if (own.size === 0) return se;
  return withHostChange(se, hostDoc, items.setGroup(hostDoc, own, undefined));
}

/** Bind a multi-selection into one fresh (non-frame) group.
 *
 *  A selection that covers an existing group ENTIRELY nests it rather than
 *  picking it apart: each member resolves to its ROOT group, and a root whose
 *  every descendant is selected joins as a CHILD group (`childGroupIds`) with
 *  its own members' `groupId` left alone. Only the loose members — those in no
 *  fully-selected group — are re-parented (`figureIds`). That is what keeps a
 *  hierarchy (G1→G3) moving as the one unit it already is.
 *
 *  A LOOSE locked member sits out, as it does for align and grid: grouping
 *  rewrites its parent, which is exactly the structural edit the lock is
 *  there to refuse. A locked member INSIDE a fully selected group goes with
 *  its group: the group moves whole and the member's parent is untouched,
 *  so its lock has nothing to refuse — and dropping it instead broke the
 *  group apart, lifting the unlocked members out around it (a Sol seed's
 *  marker is locked by design, its sol_architecture.md §6.6). A group whose
 *  own chain is locked still sits out whole. A member's NAME is never
 *  touched — the group's own name lives on its GroupNode. Two participants
 *  are the minimum, so a selection that is already exactly one group —
 *  nothing loose, one child — returns null rather than minting a wrapper
 *  around it.
 *
 *  The host's items group as shapes do: the ones no scene group carries join
 *  the new group — a group of them selected whole is taken apart into it, as
 *  there is no scene node to nest — and one riding a scene group that nests
 *  below stays on it.
 */
export function buildGroupSelectedMulti<TDoc = undefined>(
  state: CompositionState,
  ids: readonly string[],
  hostDoc?: TDoc,
): SessionEntry | null {
  const members = selectedSceneIds(ids).filter((id) => findItem(state, id));
  const items = hostItems<TDoc, unknown>();
  const joining = hostDoc !== undefined && items ? [...freeHostIds(state, items, hostDoc, ids)] : [];
  if (members.length + joining.length < 2) return null;

  // Root groups the selection covers in full become child groups, their
  // locked members counted with the rest.
  const rootCounts = new Map<string, number>();
  for (const id of members) {
    const gid = getItemGroupId(state, id);
    if (!gid) continue;
    const rootId = findRootGroupId(state.groups, gid);
    rootCounts.set(rootId, (rootCounts.get(rootId) ?? 0) + 1);
  }
  const childGroupIds: string[] = [];
  const nested = new Set<string>();
  for (const [rootId, count] of rootCounts) {
    const descendants = allDescendantMemberIds(state, rootId);
    if (count !== descendants.length || isGroupChainLocked(state, rootId)) continue;
    childGroupIds.push(rootId);
    for (const memberId of descendants) nested.add(memberId);
  }

  const figureIds = members.filter((id) => !nested.has(id) && !isItemLocked(state, id));
  if (figureIds.length + childGroupIds.length + joining.length < 2) return null;

  const groupId = mintNodeId('group');
  // No scene participant: a group of host items alone, their shared id and
  // no scene node (the engine prunes a group with no scene members).
  const entry: CompUndoOp[] = figureIds.length + childGroupIds.length === 0 ? [] : [{
    op: 'groupFigures',
    figureIds,
    groupId,
    groupName: nextGroupName(state.figures, state.groups),
    ...(childGroupIds.length > 0 ? { childGroupIds } : null),
  }];
  if (joining.length === 0) return { entry };
  return withHostChange({ entry }, hostDoc as TDoc, items!.setGroup(hostDoc as TDoc, new Set(joining), groupId));
}

// ── Boolean shape operations ────────────────────────────────────────
// Union here is the BOOLEAN one: it resolves the overlaps of closed regions
// into a new region, the first of the family (union / difference /
// intersect / exclude) the engine will grow. It is NOT the panel's Merge —
// see {@link buildMergeSelectedMulti}, which flattens objects into one
// object and asks nothing of their geometry. Keep the two apart: a boolean
// op is about REGIONS, a merge is about OBJECTS.
//
// Only the union half is ported, and no UI reaches it yet.

/** Whether {@link buildUnionSelectedMulti} would produce anything — a boolean
 *  union is offered only when it will work, matching Facet's
 *  `canUnionSelection` gate. The engine's own test is ≥2 closed, non-tiled
 *  shapes (pattern fills resolve through their mask); on top of it a locked
 *  member vetoes, because union CONSUMES its sources and a locked object must
 *  not be spent. */
export function canUnionSelectedMulti(
  state: CompositionState,
  ids: readonly string[],
): boolean {
  if (ids.length < 2) return false;
  if (ids.some((id) => isItemLocked(state, id))) return false;
  return canUnionSelection(state, new Set(ids));
}

/** Boolean-union the selected closed shapes into ONE region (Facet's Union):
 *  the sources are replaced by the merged region, inserted at the front-most
 *  source's z-slot, and it comes up selected. Pattern-filled sources carry
 *  their fill across — the engine re-creates it on the result when EVERY
 *  source was pattern-filled. Null when the selection can't union. */
export function buildUnionSelectedMulti(
  state: CompositionState,
  ids: readonly string[],
): SessionEntry | null {
  if (!canUnionSelectedMulti(state, ids)) return null;
  const built = buildUnionEntry(state, new Set(ids));
  return built ? { entry: built.entry, id: built.resultId } : null;
}

// ── Merge (flatten) ─────────────────────────────────────────────────
// The panel's structural counterpart to Group, one depth further down:
// Group binds objects and keeps them, Merge makes them ONE object. After it
// the scene outline holds a single row that selects and transforms as one
// thing. It asks nothing of the geometry — open strokes, closed shapes and
// scattered lines all flatten alike — which is exactly what separates it from
// the boolean union above. See engine/compositionMergeObjects.ts.

/** Whether {@link buildMergeSelectedMulti} would produce anything — the panel
 *  offers Merge only when it will work. The engine's own test is ≥2 objects
 *  that flatten to vectors with geometry: svg objects and pattern objects
 *  (which join as their baked view), with text / images / figures and any
 *  REPEATING tiling vetoing. On top of it a locked member vetoes, because
 *  merge SPENDS its sources and a locked object must not be spent. */
export function canMergeSelectedMulti(
  state: CompositionState,
  ids: readonly string[],
): boolean {
  if (ids.length < 2) return false;
  // A host item is not paint and not a path: nothing merges it.
  if (ids.some(isHostId)) return false;
  if (ids.some((id) => isItemLocked(state, id))) return false;
  const idSet = new Set(ids);
  // Two flatten families, never mixed: an all-paint selection merges as
  // raster (tiles resampled into one island); an all-svg one merges as
  // vectors. Anything else can't flatten.
  return canMergePaintSelection(state, idSet) || canMergeSelection(state, idSet);
}

/** Flatten the selected objects into ONE, at the front-most source's z-slot,
 *  and select it. An all-svg selection keeps every segment where it was and
 *  wears the front-most source's style (its fill, outline and color — see
 *  mergedSVGObject); an
 *  all-paint selection resamples the islands into one (source-over in
 *  z-order, per-island opacity baked into the pixels). Null when the
 *  selection can't merge. */
export function buildMergeSelectedMulti(
  state: CompositionState,
  ids: readonly string[],
): SessionEntry | null {
  if (!canMergeSelectedMulti(state, ids)) return null;
  const idSet = new Set(ids);
  const built = buildMergePaintEntry(state, idSet) ?? buildMergeEntry(state, idSet);
  return built ? { entry: built.entry, id: built.resultId } : null;
}

// ── Effects / paint / tint / recolor ────────────────────────────────

export function buildSetEffects(
  state: CompositionState,
  nodeId: string,
  effects: NodeEffects | undefined,
): SessionEntry | null {
  const ref = findItem(state, nodeId);
  // Paint islands and patterns carry no effects block.
  if (!ref || ref.kind === 'figure' || ref.kind === 'paint' || ref.kind === 'pattern') return null;
  return { entry: [{ op: 'setNodeEffects', id: nodeId, oldEffects: ref.item.effects, newEffects: effects }] };
}

export function buildSetFillPaint(
  state: CompositionState,
  svgId: string,
  paint: Paint | undefined,
): SessionEntry | null {
  const svg = state.svgObjects.find((s) => s.id === svgId);
  if (!svg) return null;
  return { entry: [{ op: 'setFillPaint', svgId, oldPaint: svg.fillPaint, newPaint: paint }] };
}

export function buildSetBackground(
  state: CompositionState,
  paint: Paint | undefined,
): SessionEntry {
  return { entry: [{ op: 'setBackground', oldPaint: state.background, newPaint: paint }] };
}

export function buildSetTint(
  state: CompositionState,
  imageNodeId: string,
  tint: ImageTint | undefined,
): SessionEntry | null {
  const image = (state.images ?? []).find((i) => i.id === imageNodeId);
  if (!image) return null;
  return { entry: [{ op: 'setImageTint', nodeId: imageNodeId, oldTint: image.tint, newTint: tint }] };
}

/**
 * The default gradient tint: a linear #2E1A3D→#FF9F0A ramp at 90° (top→bottom),
 * 50% opacity, Normal blend. Applied when the Tint bar is first opened so
 * there's a visible overlay to edit. `solid` seeds the Solid mode (#123047).
 * Mirrors DEFAULT_TINT_MODEL in the editor-ui package (same values, engine
 * shape).
 */
export const DEFAULT_IMAGE_TINT_FILL: ImageTintFill = {
  type: 'linear',
  solid: { r: 0x12, g: 0x30, b: 0x47 },
  stops: [
    { offset: 0, color: { r: 0x2e, g: 0x1a, b: 0x3d } },
    { offset: 1, color: { r: 0xff, g: 0x9f, b: 0x0a } },
  ],
  angle: 90,
  opacity: 0.5,
  blend: 'normal',
};

/**
 * The fill the Fill bar edits for a shape — its own `fill` block when it has
 * one, otherwise a starting point built from the shape itself.
 *
 * The fallback is a SOLID of the shape's own stroke color at full opacity, not
 * the image tint's blue→orange ramp at 50 %: a shape's first fill should look
 * like it belongs to the drawing it's in. Its gradient stops fade that same
 * color to white, so switching Type to Linear or Radial shows a real gradient
 * rather than a flat band. A pre-`fill` legacy `fillColor` reads back the same
 * way, so an older filled shape opens the bar on the fill it already has.
 */
export function shapeFillOf(svg: SVGObject): ShapeFill {
  if (svg.fill) return svg.fill;
  const base = svg.fillColor ?? svg.color;
  return {
    type: 'solid',
    solid: { ...base },
    stops: [
      { offset: 0, color: { ...base } },
      { offset: 1, color: { r: 255, g: 255, b: 255 } },
    ],
    angle: 90,
    opacity: svg.fillColor ? (svg.fillOpacity ?? 1) : 1,
    blend: 'normal',
  };
}

/**
 * Whether a colour laid on `svg` lands on its FILL rather than on its outline
 * — the one question every colour route asks about a shape, so the swatch the
 * picker OPENS on (selectionColor, selectionColorAlpha) reads the same half
 * the confirm (buildApplyColor) writes.
 *
 * Two conditions, and the second is the one that was missing. A subtype has to
 * HAVE an interior (`svgHasFill`: a rectangle, a circle, a polygon — a line
 * and an arc have none), and the shape has to be FILLED already
 * (`svgIsFilled`). A box drawn with the fill memory off is four lines: the
 * only colour it shows is its outline's, so that is the colour choosing one
 * changes. Filling it instead answered a question nobody asked — the hollow
 * box became a slab of ink, and the line the user was looking at stayed the
 * colour it was.
 *
 * When it has both, the fill wins: the interior is the larger part of what the
 * shape reads as, and the Stroke bar's own swatch (buildRecolorSVGWithOpacity)
 * is right there for the outline.
 *
 * This is the rule the recolour BRUSH already keeps — "a shape that COULD be
 * filled but isn't stays four lines, and takes ink on its outline alone"
 * (paintBrush's `outlineTakesInk`) — so the two ways of colouring a shape can
 * no longer disagree about which half of it they mean.
 */
export function svgColorTargetsFill(svg: SVGObject): boolean {
  return svgHasFill(svgSubtype(svg)) && svgIsFilled(svg);
}

/**
 * WHICH of a shape's colours a swatch means — its interior, its outline,
 * or the ink of a pattern filling it.
 *
 * A shape can wear all three at once, and a swatch is one press: there is
 * nothing in the press itself to say which of them it is for. So it is
 * the colour tool's standing AIM that says — the Fills | Strokes |
 * Patterns capsule the recolour brush is pointed with — and the swatch
 * lands where a drag of the brush would have landed. The two used to
 * disagree: the swatch took the fill of anything that had one and the
 * outline of anything that did not, so a patterned shape could not be
 * re-inked by picking a colour at all, and a filled shape's outline could
 * only be reached through the Stroke page.
 *
 * The aim is re-pointed when it reaches nothing on THIS shape
 * (`colorScopeReaches`, the brush's own question), in capsule order —
 * Strokes, then Fills, then Patterns. That is what keeps a plain line
 * taking a colour under an aim of Fills: there is one colour to give it,
 * and an aim at nothing is not a reason to refuse.
 *
 * The 'any' aim is not a surface but a rule: the first surface this shape
 * has in ANY_COLOR_PRIORITY — its fill, else its outline, else its cloth.
 */
export function svgColorAim(svg: SVGObject, scope: ColorScope): ColorSurface {
  const ref = { kind: 'svg' as const, item: svg };
  // Fills answers to BOTH questions — the brush's, and the one this
  // route's own dispatch asks before it writes a fill
  // (svgColorTargetsFill). An aim nothing would be written under is an
  // aim at nothing, and re-pointing is what keeps the press from landing
  // silently: a closed shape left unfilled is four lines and takes ink on
  // those, and a shape whose fill IS its pattern would otherwise take the
  // colour on a solid nobody can see under the tiles.
  const reaches = (s: ColorSurface): boolean =>
    (s === 'fills'
      ? colorScopeReaches(s, ref) && svgColorTargetsFill(svg)
      : colorScopeReaches(s, ref));
  if (scope === 'any') return ANY_COLOR_PRIORITY.find(reaches) ?? 'strokes';
  if (reaches(scope)) return scope;
  return COLOR_SURFACES.find(reaches) ?? 'strokes';
}

/** `base` turned into a flat wash of `color`: Type flips to Solid and the solid
 *  color is replaced, while the layer's opacity + blend and the retained
 *  gradient fields ride through untouched (ImageTintFill's "non-active fields
 *  are retained" contract). So a plain "make this thing this color" never
 *  silently loses the gradient the object had, and an image the Tint bar has
 *  never touched picks up the default layer's 50 % Normal wash — a tint you can
 *  see through, not a flat rectangle over the photo. */
export function asSolidFill(base: ImageTintFill, color: RGBColor, alpha?: number): ImageTintFill {
  const solid = { ...base, type: 'solid' as const, solid: toRGB(color) };
  // The picker's Opacity slider IS this layer's opacity for a solid wash —
  // "this color, this see-through". Omitted (undefined) leaves whatever the
  // layer already had, so a caller that isn't editing opacity can't reset it.
  return alpha === undefined ? solid : { ...solid, opacity: clamp01(alpha) };
}

/** Clamp to the 0–1 an alpha / opacity field is defined over. */
function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 1));
}

/** The index the Tint / Fill bar's selected stop actually addresses. */
function stopIndexIn(fill: ImageTintFill, selectedStop: number): number {
  return Math.max(0, Math.min(fill.stops.length - 1, selectedStop));
}

/** A fill with the picked color + opacity written to whichever half of it the
 *  picker was opened on: the solid wash, or the selected gradient stop.
 *
 *  Shared by the image Tint bar and the shape Fill bar — `ShapeFill` IS
 *  `ImageTintFill`, and both bars' swatches open the same picker, so a second
 *  copy of this would be two rules for one behavior. The alpha lands where that
 *  fill type keeps it: a solid's on the LAYER opacity (a solid wash has no
 *  other alpha), a gradient's on the STOP (each stop carries its own). */
export function withFillColor(
  fill: ImageTintFill,
  color: RGBColor,
  alpha: number | undefined,
  selectedStop: number,
): ImageTintFill {
  const rgb = toRGB(color);
  if (fill.type === 'solid') {
    return alpha === undefined
      ? { ...fill, solid: rgb }
      : { ...fill, solid: rgb, opacity: clamp01(alpha) };
  }
  const idx = stopIndexIn(fill, selectedStop);
  return {
    ...fill,
    stops: fill.stops.map((st, i) => {
      if (i !== idx) return st;
      // `alpha: undefined` = opaque in GradientStop, so an opaque stop drops
      // the field rather than storing a redundant 1.
      const a = alpha === undefined ? st.alpha : (clamp01(alpha) < 1 ? clamp01(alpha) : undefined);
      return { ...st, color: rgb, alpha: a };
    }),
  };
}

/** The opacity {@link withFillColor} would replace — what the picker's slider
 *  opens on for a Tint / Fill swatch. */
export function fillColorAlpha(fill: ImageTintFill, selectedStop: number): number {
  return fill.type === 'solid'
    ? fill.opacity
    : (fill.stops[stopIndexIn(fill, selectedStop)]?.alpha ?? 1);
}

/** A solid background paint at `alpha`. The alpha field is left OFF when the
 *  color is opaque, so an opaque background record stays byte-identical to what
 *  it has always been (`Paint.alpha` is "undefined = opaque"). */
export function solidPaint(color: RGBColor, alpha: number = 1): Paint {
  const a = clamp01(alpha);
  return a >= 1 ? { kind: 'solid', color } : { kind: 'solid', color, alpha: a };
}

/** The host's colour target for `nodeId` — a node whose colour lives off
 *  the object (sessionHost.ts `HostColorTarget`) — or null for an ordinary
 *  node, or with no host installed. */
function hostColorTarget(state: CompositionState, nodeId: string) {
  return sessionHost().nodes?.colorTarget?.(state, nodeId) ?? null;
}

/** The Color tool's dispatch: recolor an svg, restyle a text, tint an image,
 *  re-ink a pattern, or (nothing selected) set the page background. Single
 *  source of truth for every color-apply entry point (top-bar picker, options
 *  strip, and the long-press radial menu's color action). Returns the entry to
 *  commit, or null for an unhandled/no-op case.
 *
 *  A vector takes the colour on the half it ALREADY HAS
 *  ({@link svgColorTargetsFill}). An open path is its stroke and has no other
 *  half. A closed shape that is filled takes it as a solid FILL — the interior
 *  is what such a shape reads as. A closed shape left UNFILLED is four lines
 *  like any other, and takes it on those lines: a colour picked on a hollow
 *  box must change the box you can see, not mint an interior it never had.
 *
 *  A PATTERN object is line art: the stroke its tiles are drawn in is the only
 *  colour it has (buildRecolorPattern, what the Stroke bar's swatch does to
 *  one), which is the same reading the recolour brush takes of it.
 *
 *  A node whose colour the HOST keeps off the object (sessionHost.ts
 *  `nodes.colorTarget` — CozyJournal's rig, whose two colours live on its
 *  hidden record because the silhouette on the page is a bake the live
 *  sketch draws over) takes it through the host's target: the same write
 *  the node's own Color rows and the recolour brush make, so the stage, the
 *  page and every export agree.
 *
 *  A WORD STICKER is refused. A magnetic-poetry tile is a printed magnet —
 *  card, border and ink are one piece, and the way its colours change is the
 *  invert toggle (buildToggleWordInvert), not a colour laid on its glyphs. The
 *  recolour brush already passes them by (paintBrush's text pass skips
 *  `sticker`); this is the same rule on the dispatch, so no route colours a
 *  word the brush would not. */
export function buildApplyColor(
  state: CompositionState,
  selectedId: string | null,
  color: RGBColor,
  alpha?: number,
  scope: ColorScope = DEFAULT_COLOR_SCOPE,
): SessionEntry | null {
  const selected = selectedId ? findItem(state, selectedId) : null;
  if (!selected) return buildSetBackground(state, solidPaint(color, alpha ?? 1));
  switch (selected.kind) {
    case 'svg': {
      // The host's own before anything else: its colour is not on the
      // object — see the note above. No alpha: the host decides what is
      // opaque, and an aim with nothing to write there says so (null)
      // rather than landing somewhere it was not pointed.
      const target = hostColorTarget(state, selected.item.id);
      if (target) return target.apply(scope, color);
      // Which of the shape's colours the press is for: the colour tool's
      // standing aim, re-pointed to something this shape actually has
      // (svgColorAim). A patterned shape has an interior, an outline and
      // the ink of its tiles, and nothing in a swatch press says which.
      const aim = svgColorAim(selected.item, scope);
      if (aim === 'patterns') {
        // The tiles' ink, the same re-ink the Pattern page's own swatch
        // makes. No alpha: a tile's ink is an RGB stroke with no channel
        // to put one on. A grid that will not answer falls through to the
        // outline rather than refusing the press.
        const ink = buildRecolorShapePattern(state, selected.item.id, color);
        if (ink) return ink;
      }
      return aim === 'fills'
        ? buildSetSVGFill(state, selected.item.id, asSolidFill(shapeFillOf(selected.item), color, alpha))
        // A shape being coloured on its OUTLINE (an open path, a closed
        // one left unfilled, or one aimed at on its line) is all stroke,
        // so the color's opacity is the object's: there is no per-stroke
        // alpha to put it on, and dimming the object dims exactly the
        // marks the color was applied to — for an unfilled shape there is
        // nothing else to dim. Same field the Opacity bar writes, so the
        // two controls agree instead of fighting.
        : buildRecolorSVGWithOpacity(state, selected.item.id, color, alpha);
    }
    case 'text': {
      // A word sticker is not coloured this way — see the note above.
      if (selected.item.sticker) return null;
      // No alpha: a TextStyle color is RGB and a text node has no opacity of
      // its own, so the picker hides the slider for text (showOpacity=false)
      // rather than taking an opacity it would drop here.
      // Setting the font color is a whole-node statement, so it replaces any
      // per-character brushwork: charColors is dropped, not carried along.
      const { charColors: _brushwork, ...rest } = selected.item.style;
      return buildSetTextStyle(state, selected.item.id, { ...rest, color });
    }
    case 'image':
      return buildSetImageTintFill(
        state,
        selected.item.id,
        asSolidFill(selected.item.tintFill ?? DEFAULT_IMAGE_TINT_FILL, color, alpha),
      );
    case 'pattern':
      // No alpha: a tile's ink is an RGB stroke, with no channel to put one
      // on — as for a text, the picker offers no slider here.
      return buildRecolorPattern(state, selected.item.id, color);
    default:
      return null;
  }
}

/** {@link buildRecolorSVG}, plus the object opacity the picker's slider set —
 *  as ONE entry, so a color-with-opacity is one undo step and not two. Falls
 *  through to the plain recolor when no opacity was supplied or it is already
 *  what the object has. */
export function buildRecolorSVGWithOpacity(
  state: CompositionState,
  svgId: string,
  color: RGBColor,
  alpha?: number,
): SessionEntry | null {
  const recolor = buildRecolorSVG(state, svgId, color);
  if (!recolor || alpha === undefined) return recolor;
  const svg = state.svgObjects.find((s) => s.id === svgId);
  if (!svg) return recolor;
  // The opacity op is a whole-scene replace, so it has to be built from the
  // state the recolor already produced — built from `state` it would carry the
  // pre-recolor color forward and quietly undo the color change.
  const after = applyCompOps(state, recolor.entry);
  // Opacity alone: a fade is spent into the colours the moment its slider
  // commits and is never carried on the record (engine/fadeBake.ts), so
  // there is nothing here to preserve — and 0 is what keeps this from
  // spending one a second time over the colour just picked.
  const opacityEntry = buildSetObjectOpacity(after, svgId, clamp01(alpha), 0);
  return opacityEntry
    ? { ...recolor, entry: [...recolor.entry, ...opacityEntry.entry] }
    : recolor;
}

/** {@link buildApplyColor} over a multi-selection: every member takes the
 *  color by its own rule (a line its stroke, a shape its fill, a text its
 *  font color, an image its tint) in ONE undo entry.
 *
 *  Members with no color rule are skipped rather than vetoing the rest —
 *  and skipping them is what keeps `selectedId: null` from reaching
 *  buildApplyColor, whose null case paints the page BACKGROUND. Locked
 *  members are skipped for the same reason the multi move skips them: the
 *  commit lock-guard rejects a whole ENTRY that touches one, so a single
 *  locked member would otherwise silently swallow everyone else's color. */
export function buildApplyColorMulti(
  state: CompositionState,
  ids: readonly string[],
  color: RGBColor,
  alpha?: number,
  scope: ColorScope = DEFAULT_COLOR_SCOPE,
): SessionEntry | null {
  return buildForEachNode(state, ids, (cur, id) =>
    (isColorableSelection(cur, id) && !isItemLocked(cur, id)
      ? buildApplyColor(cur, id, color, alpha, scope)
      : null));
}

/** The color {@link buildApplyColor} would replace on `selectedId` — what a
 *  picker opened on that object should start from, so the wheel opens where the
 *  object already is instead of on the last color used elsewhere. Null when the
 *  selection has no color of its own (a frame, a group, an untinted image, or
 *  nothing selected); the caller falls back to the active color. */
export function selectionColor(
  state: CompositionState,
  selectedId: string | null,
  scope: ColorScope = DEFAULT_COLOR_SCOPE,
): RGBColor | null {
  const selected = selectedId ? findItem(state, selectedId) : null;
  if (!selected) return null;
  switch (selected.kind) {
    case 'svg': {
      // The host's own: whichever of its colours the confirm would write
      // under this aim (the host's reading of the scope).
      const target = hostColorTarget(state, selected.item.id);
      if (target) return target.current(scope);
      // The half the confirm would write, so the wheel opens on the colour it
      // is about to replace — an unfilled shape's outline, not the fill it
      // does not have, and a patterned shape's tiles when that is what the
      // aim points at (svgColorAim, the confirm's own choice). A gradient
      // fill has no single color; the stroke color is the shape's own
      // nearest thing to one (shapeFillSolidColor — the same reading the
      // Color brush blends from, so picker and brush can't disagree).
      const aim = svgColorAim(selected.item, scope);
      if (aim === 'patterns') {
        const grid = shapePatternGrid(selected.item);
        const ink = grid ? patternInkColor(grid) : null;
        if (ink) return ink;
      }
      return aim === 'fills'
        ? shapeFillSolidColor(selected.item)
        : selected.item.color;
    }
    case 'text':
      return selected.item.style.color;
    case 'image':
      return selected.item.tintFill?.solid ?? null;
    case 'pattern':
      // The ink its cells are drawn in, null when they disagree — the same
      // reading the Stroke bar's swatch shows for one (patternInkColor).
      return patternInkColor(selected.item);
    default:
      return null;
  }
}

/** The opacity {@link buildApplyColor} would replace on `selectedId` — the
 *  alpha channel its color rule writes to, so the picker's slider opens where
 *  the object already is. 1 for a target with none (a text, an untouched
 *  object); pair it with {@link selectionTakesAlpha}, which says whether the
 *  slider should be offered at all. */
export function selectionColorAlpha(
  state: CompositionState,
  selectedId: string | null,
  scope: ColorScope = DEFAULT_COLOR_SCOPE,
): number {
  const selected = selectedId ? findItem(state, selectedId) : null;
  // Nothing selected → the page background, whose Paint carries the alpha.
  if (!selected) {
    const bg = state.background;
    return bg?.kind === 'solid' ? (bg.alpha ?? 1) : 1;
  }
  switch (selected.kind) {
    case 'svg':
      // The host's own is opaque by definition (see selectionTakesAlpha),
      // so there is no channel to report.
      if (hostColorTarget(state, selected.item.id)) return 1;
      // The alpha of the half the confirm writes: a fill layer's own opacity,
      // or — colouring the outline — the whole object's, which is the field
      // buildRecolorSVGWithOpacity lands the slider on. A press aimed at the
      // TILES carries no alpha at all (their ink is an RGB stroke), so the
      // object's own stands, as it does for the outline.
      return svgColorAim(selected.item, scope) === 'fills'
        ? shapeFillOf(selected.item).opacity
        : (selected.item.opacity ?? 1);
    case 'image':
      return (selected.item.tintFill ?? DEFAULT_IMAGE_TINT_FILL).opacity;
    default:
      return 1;
  }
}

/** Whether the color {@link buildApplyColor} applies to `selectedId` has an
 *  alpha channel to land on. False for text, for a pattern and for a node
 *  whose colour the HOST keeps (sessionHost.ts `nodes.colorTarget`): a
 *  TextStyle color is RGB and a text node has no opacity field, a tile's
 *  ink is an RGB stroke, and the host's colours are its own to make opaque
 *  (a rig's two are both painted opaque by its sketch shader) — so the
 *  picker hides its Opacity slider on all three rather than offering one
 *  whose value would be dropped. */
export function selectionTakesAlpha(
  state: CompositionState,
  selectedId: string | null,
): boolean {
  const ref = selectedId ? findItem(state, selectedId) : null;
  if (!ref) return true;
  if (ref.kind === 'svg') return !hostColorTarget(state, ref.item.id);
  return ref.kind !== 'text' && ref.kind !== 'pattern';
}

/** Whether the radial menu's color action — and the toolbar picker's
 *  apply-to-the-selection — can act on `selectedId`: the kinds
 *  {@link buildApplyColor} has a color rule for. A locked object still counts:
 *  the menu shows the button, and the commit-time lock guard is what makes it a
 *  no-op, exactly as for the menu's Duplicate and Delete.
 *
 *  A paint ISLAND is not among them, and neither is a WORD STICKER — see
 *  buildApplyColor, whose refusal this has to agree with or the offer would
 *  be a button that does nothing. An engine FIGURE (`kind: 'figure'`) is out
 *  too: those are posed quads with no colour rule. A RIG is not one of those
 *  — it is an `svg`, and it answers here as every other svg does. */
export function isColorableSelection(
  state: CompositionState,
  selectedId: string | null,
): boolean {
  const ref = selectedId ? findItem(state, selectedId) : null;
  if (!ref) return false;
  if (ref.kind === 'text') return !ref.item.sticker;
  return ref.kind === 'svg' || ref.kind === 'image' || ref.kind === 'pattern';
}

/** The multi-selection form: the color action shows only when EVERY member
 *  can take a color, so the button can't half-apply — the same "the whole
 *  selection is that type" rule the properties panel uses to decide which
 *  type rows to offer. */
export function isColorableMultiSelection(
  state: CompositionState,
  ids: readonly string[],
): boolean {
  return ids.length > 0 && ids.every((id) => isColorableSelection(state, id));
}

/** Simple stroke recolor of an SVG (the Color tool's tap-and-confirm op
 *  shape: clears subpaths, revert restores them). */

export function buildRecolorSVG(
  state: CompositionState,
  svgId: string,
  color: RGBColor,
): SessionEntry | null {
  const svg = state.svgObjects.find((s) => s.id === svgId);
  if (!svg) return null;
  return {
    entry: [{
      op: 'recolorSVG', svgId,
      oldColor: svg.color, newColor: color,
      oldSubpaths: svg.subpaths,
    }],
  };
}

/**
 * Commit a finished color-tool paint stroke as ONE undo entry: the engine's
 * per-segment / legacy-fill ops (buildPaintStrokeOps), plus the app-side
 * accumulators the engine draft has no slot for. Brushed text characters
 * land as one setTextStyle op per touched text (the style's `charColors`
 * merged with the stroke's), brushed image paint layers as one replaceScene
 * op swapping `images`, and brushed solid-shape layers as one more swapping
 * `svgObjects`. The COLOR brush's whole-object half (`objectColor`) lands as
 * one setSVGFill per recoloured shape, one setImageTintFill per recoloured
 * image and one record swap per recoloured FIGURE — the same ops the Fill
 * bar, the Tint bar and the figure's Color rows write, the first two
 * flattened to a SOLID of the brushed colour by `asSolidFill`, so a brushed
 * fill and a picked one are the same edit and round-trip through the binary
 * format identically. The text ops build against the original state (texts are
 * untouched by the segment ops); both replaceScene swaps build against the
 * state the ops SO FAR leave behind — replaceScene snapshots every
 * collection, so one built against the original state would quietly revert
 * the same stroke's text ops (and the shape swap its segment recolors).
 * Applying the entry in order lands everything, and undoing it in reverse
 * restores everything.
 *
 * Null when the stroke changed nothing (brushed empty canvas, or repainted
 * segments that were already the brush color).
 *
 * A null in `textChars` is the ERASER's mark — clear that character's tint
 * back to the node color. An overlay the eraser emptied entirely commits as
 * NO overlay at all (`paintOverlay` dropped), so a fully-erased node is
 * byte-identical to one never painted.
 */
export function buildPaintStroke(
  state: CompositionState,
  draft: PaintStrokeDraft,
  textChars?: ReadonlyMap<string, ReadonlyMap<number, RGBColor | null>>,
  imageOverlays?: ReadonlyMap<string, ImagePaintOverlay>,
  shapeOverlays?: ReadonlyMap<string, ImagePaintOverlay>,
  paintState?: PaintObjectStrokeState | null,
  patternCells?: ReadonlyMap<string, ReadonlyMap<number, RGBColor | null>>,
  objectColor?: ObjectColorState | null,
): SessionEntry | null {
  const ops = buildPaintStrokeOps(state, draft);
  // The id the session ref should point at after this commit — set when the
  // island half below minted or continued one. Deliberately NOT
  // SessionEntry.id: that auto-selects the node, which would pop the
  // properties panel and turn the selection into a brush filter
  // mid-painting.
  let paintSessionId: string | undefined;
  if (textChars) {
    for (const [textId, charMap] of textChars) {
      const text = (state.texts ?? []).find((t) => t.id === textId);
      if (!text || text.locked || text.sticker) continue;
      const len = Array.from(text.content).length;
      const existing = text.style.charColors;
      const next: (RGBColor | null)[] = [];
      for (let i = 0; i < len; i++) next.push(existing?.[i] ?? null);
      let changed = false;
      for (const [ci, color] of charMap) {
        if (ci < 0 || ci >= len) continue;
        if (color === null) {
          // Eraser: drop the tint override, if there is one to drop.
          if (next[ci] !== null) {
            next[ci] = null;
            changed = true;
          }
          continue;
        }
        const base = next[ci] ?? text.style.color;
        // No-op filter, like shapeFillChanged: a pass that landed back on the
        // character's current color commits nothing.
        if (base.r === color.r && base.g === color.g && base.b === color.b) continue;
        next[ci] = { r: color.r, g: color.g, b: color.b };
        changed = true;
      }
      if (!changed) continue;
      // All-null = no overrides left: drop charColors entirely rather than
      // carrying a list of nulls.
      const charColors = next.some((c) => c !== null) ? next : undefined;
      const se = buildSetTextStyle(state, textId, { ...text.style, charColors });
      if (se) ops.push(...se.entry);
    }
  }
  if (patternCells) {
    // Brushed pattern cells: one editPatternCells op per pattern, the same
    // op the pattern tool's own painting commits — so a recolor undoes as
    // one step and round-trips through the binary format's per-cell tint.
    // Built against the ORIGINAL state: these ops name cells by index and
    // touch nothing the passes above wrote.
    for (const [patternId, cellMap] of patternCells) {
      // The grid the id names — a pattern OBJECT's own, or the one a closed
      // shape carries as its pattern FILL, which is addressed by the
      // SHAPE's id and routed by the op itself (patternGridOf,
      // engine/shapePatternFill.ts). The brush reaches both, so the commit
      // must resolve both or a stroke over a patterned shape would preview
      // and then vanish on release.
      const grid = patternGridOf(state, patternId);
      if (!grid || isItemLocked(state, patternId)) continue;
      const edits: PatternCellEdit[] = [];
      for (const [index, color] of cellMap) {
        const oldState = grid.cells[index] ?? null;
        if (!oldState || oldState.type !== 'sprite') continue;
        // null is the eraser's mark: lift the brushed ink, leaving the tile
        // its base ink rather than an explicit white.
        const newState = color === null
          ? { ...oldState, tintR: undefined, tintG: undefined, tintB: undefined }
          : tintedPatternCell(oldState, color);
        // A pass that landed back on the cell's current ink commits nothing.
        if (cellStatesEqual(oldState, newState)) continue;
        edits.push({ index, oldState, newState });
      }
      const se = buildEditPatternCells(state, patternId, edits);
      if (se) ops.push(...se.entry);
    }
  }
  if (objectColor && (objectColor.shapeFills.size > 0 || objectColor.imageTints.size > 0)) {
    // The Color brush's whole-object half. Each builder below is a
    // replaceScene of its own — which snapshots EVERY collection — so they
    // are threaded through buildForEachNode against the running state, the
    // same way a multi-selection colour is: built from the original state
    // they would quietly revert this stroke's segment and text ops.
    //
    // `asSolidFill` keeps whatever else the layer carried (its opacity, its
    // blend, its retained gradient stops) and replaces only the colour, so
    // brushing a gradient-filled shape flattens it to the brushed colour
    // exactly as picking that colour on it would, and an untouched image
    // picks up the default tint layer's see-through 50 % rather than a flat
    // rectangle over the photo.
    const mid = ops.length > 0 ? applyCompOps(state, ops) : state;
    const fills = buildForEachNode(mid, [...objectColor.shapeFills.keys()], (cur, id) => {
      const svg = cur.svgObjects.find((o) => o.id === id);
      const color = objectColor.shapeFills.get(id);
      if (!svg || !color || isItemLocked(cur, id)) return null;
      return buildSetSVGFill(cur, id, asSolidFill(shapeFillOf(svg), color));
    });
    if (fills) ops.push(...fills.entry);
    const afterFills = fills ? applyCompOps(mid, fills.entry) : mid;
    const tints = buildForEachNode(afterFills, [...objectColor.imageTints.keys()], (cur, id) => {
      const img = (cur.images ?? []).find((i) => i.id === id);
      const color = objectColor.imageTints.get(id);
      if (!img || !color || isItemLocked(cur, id)) return null;
      return buildSetImageTintFill(cur, id, asSolidFill(img.tintFill ?? DEFAULT_IMAGE_TINT_FILL, color));
    });
    if (tints) ops.push(...tints.entry);
  }
  // …and the Color brush's HOST half (sessionHost.ts `HostPaintTargets`):
  // the nodes the brush reached whose colour is not on the object it touched
  // — CozyJournal's rig, the silhouette under the dab a bake the live sketch
  // draws over — so the write goes where the node's own Color rows write
  // it, and the object comes through untouched. Built against the mid
  // state, for the replaceScene reason above.
  const hostPass: HostPaintTargets | null = objectColor?.host ?? null;
  if (hostPass) {
    const mid = ops.length > 0 ? applyCompOps(state, ops) : state;
    ops.push(...hostPass.commit(mid));
  }
  if (imageOverlays && imageOverlays.size > 0) {
    // Built against the mid state: replaceScene snapshots texts too, and a
    // swap built from the original state would quietly revert the same
    // stroke's setTextStyle ops above.
    const mid = ops.length > 0 ? applyCompOps(state, ops) : state;
    let images = mid.images ?? [];
    let changed = false;
    for (const [id, overlay] of imageOverlays) {
      const img = images.find((i) => i.id === id);
      if (!img || img.locked) continue;
      const kept = paintOverlayHasInk(overlay) ? overlay : undefined;
      images = images.map((i) => (i.id === id ? { ...i, paintOverlay: kept } : i));
      changed = true;
    }
    if (changed) ops.push(buildReplaceSceneOp(mid, { images }));
  }
  if (shapeOverlays && shapeOverlays.size > 0) {
    // Built against the mid state: the paint ops above may have recolored
    // these same objects' segments, and a swap built from the original state
    // would quietly undo that.
    const mid = ops.length > 0 ? applyCompOps(state, ops) : state;
    let svgObjects = mid.svgObjects;
    let changed = false;
    for (const [id, overlay] of shapeOverlays) {
      const svg = svgObjects.find((s) => s.id === id);
      if (!svg || svg.locked) continue;
      const kept = paintOverlayHasInk(overlay) ? overlay : undefined;
      svgObjects = svgObjects.map((s) => (s.id === id ? { ...s, paintOverlay: kept } : s));
      changed = true;
    }
    if (changed) ops.push(buildReplaceSceneOp(mid, { svgObjects }));
  }
  if (paintState && paintState.rev > 0) {
    // Paint island half, built against the mid state like the overlay swaps
    // above (a replaceScene snapshots every collection, and one built from
    // the original state would quietly revert this same stroke's earlier
    // ops).
    const mid = ops.length > 0 ? applyCompOps(state, ops) : state;
    if (paintState.session) {
      // 'paint': the whole stroke's dabs land as ONE island swap. Tiles the
      // stroke didn't touch ride through by reference.
      const kept = commitCanvasPaint(paintState.session.working);
      const sessionId = paintState.session.paintId;
      if (sessionId === null) {
        // Fresh island: one placeObject. Ink bounds give the 1:1 bbox ==
        // contentRect. Spray-paint z: when anything in the scene occluded
        // this stroke's ink, the island splices in directly BELOW the
        // lowest such object — the deposit is the paint that fell PAST it
        // onto the canvas, so it must render under it (move the object away
        // and its stencil silhouette is what remains). An unobstructed
        // stroke keeps landing on top (just-painted belongs in front). A
        // stroke over a LOCKED island records blockers only above that
        // island (its z is the deposit's own), so either way the mint
        // lands above the lock it couldn't merge into.
        const minted = createPaintObjectFromTiles(mintPaintObjectId(), kept);
        if (minted) {
          const below = paintState.occlusion?.freshInsertionIndex();
          ops.push({
            op: 'placeObject', kind: 'paint', item: minted,
            ...(below !== undefined ? { sceneOrderIndex: below } : {}),
          });
          paintSessionId = minted.id;
        }
      } else {
        const island = (mid.paintObjects ?? []).find((p) => p.id === sessionId);
        if (island && !island.locked && kept !== undefined) {
          // Continuing island: swap tiles and regrow contentRect == fresh
          // ink bounds, with the bbox that same rect carried by the
          // island's translation offset — session islands are translation
          // frames by invariant (paintObjectTranslation; the offset is zero
          // until the island has been moved, where this collapses to the
          // old bbox == contentRect regrow). Every existing texel keeps
          // rendering exactly where it did.
          const rect = paintTilesContentRect(kept);
          const dx = island.cellX - island.contentX;
          const dy = island.cellY - island.contentY;
          if (rect) {
            const paintObjects = (mid.paintObjects ?? []).map((p) => (p.id === sessionId
              ? {
                  ...p, tiles: kept,
                  cellX: rect.x + dx, cellY: rect.y + dy, cellWidth: rect.w, cellHeight: rect.h,
                  contentX: rect.x, contentY: rect.y, contentW: rect.w, contentH: rect.h,
                }
              : p));
            ops.push(buildReplaceSceneOp(mid, { paintObjects }));
            paintSessionId = sessionId;
          }
        }
      }
    } else {
      // Targets-style strokes — 'erase'/'blur'/'push', and 'paint' under a
      // non-normal blend mode (mutate-only, so it acts on every island under
      // the brush): one replaceScene swaps every touched island's tiles;
      // islands erased to zero ink become removeObject ops instead, with
      // exact z-restore on undo.
      //
      // The frame moves for PUSH and BLUR (`grow`), the brushes that can
      // carry paint outside the ink bounds their islands were framed to (a
      // smear drags it, a blur feathers it outward): each touched island is
      // re-framed around what it now holds, which leaves every texel drawn
      // exactly where it was and brings the carried ones into view. Erase
      // can only take away, and the whole-object prune covers shrinking to
      // nothing, so it leaves the frame alone.
      const touched = touchedPaintTargets(paintState);
      if (touched.length > 0) {
        const keptById = new Map(touched.map((t) => [t.id, commitCanvasPaint(t.working)]));
        const emptied: string[] = [];
        let changed = false;
        const paintObjects = (mid.paintObjects ?? []).map((p) => {
          if (!keptById.has(p.id)) return p;
          const kept = keptById.get(p.id);
          if (kept === undefined) {
            emptied.push(p.id);
            return p;
          }
          changed = true;
          const next = { ...p, tiles: kept };
          if (!paintState.grow) return next;
          const rect = paintTilesContentRect(kept);
          return (rect && growPaintObjectToContent(next, rect)) || next;
        });
        let afterSwap = mid;
        if (changed) {
          const swap = buildReplaceSceneOp(mid, { paintObjects });
          ops.push(swap);
          afterSwap = applyCompOps(mid, [swap]);
        }
        if (emptied.length > 0) ops.push(...buildRemoveObjectOps(afterSwap, emptied));
      }
    }
  }
  return ops.length > 0 ? { entry: ops, ...(paintSessionId ? { paintSessionId } : {}) } : null;
}
