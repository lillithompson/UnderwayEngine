import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { GLView } from 'expo-gl';
import type { ExpoWebGLRenderingContext } from 'expo-gl';
import { CompositionRenderer } from '@/engine/gl/compositionRenderer';
import { TweenHandle, cubicOut, mix, tween } from '@/engine/motion';
import {
  applyCompOps, computeSVGBbox, findItem, findSceneObjectAtCell,
  getItemGroupId, hiddenGroupIds, isItemHidden, isItemLocked,
} from '@/engine/compositionOps';
import { Mat2D, matIsSimilarity } from '@/engine/sceneTransform';
import { buildFrameRectMap, frameGroupIdForNode } from '@/engine/compositionFrame';
import type { LegacyLeaf } from '@/engine/sceneGraph';
import { findSelectableAtCell } from '../groupHit';
import {
  PreviewPose,
  cssMatrix, gestureAbout, graphOf, previewGesture, previewWorldGesture, worldTurnDeg,
} from '../transformGestures';
import {
  DrawnClip, DrawnLeaf, drawnClip, drawnClipGesture, drawnFrame, drawnLeaf, drawnLeafFor, drawnLeafOf,
  drawnLeaves, patternLayerMarkup,
  svgDrawnGeometry,
} from '../drawnPose';
import { withShapePatternFill } from '@/engine/shapePatternFill';
import { ShapePatternEditOutline } from './ShapePatternEditOutline';
import type { SelectionShapePath } from '../selectionShapeOutline';
import { selectionShapePath, shapeOutlineViewBox } from '../selectionShapeOutline';
import { NodeHitFrame, leafHitFrame } from '@/engine/sceneHitFrame';
import { aboutPoint } from '../transformGestures';
import { pickCenter } from '@/engine/compositionArcMath';
import { compSnapStep } from '@/engine/compositionCellMath';
import { buildPathD, buildSVGObjectContent } from '@/engine/svgPathBuilder';
import { SVG_STROKE_WIDTH } from '@/engine/svgExport';
import { svgStrokeWidthUnits, type SVGSubtype } from '@/engine/svgStroke';
import {
  BlendMode, Camera, CompItemKind, CompUndoEntry, CompositionState, ImageObject, ImagePaintOverlay,
  PaintObject, PaintStrokeDraft, PathSegment, PatternObject, PatternSymmetry, RGBColor,
  SVGObject, TextObject, Viewport,
  makeViewport,
} from '@/engine/types';
import {
  MAX_PATTERN_GRID,
  applyPatternCellEdits,
  patternApplyToolAt,
  patternCellAtWorldPoint,
  tintedPatternCell,
  type PatternCellEdit,
  type PatternSubTool,
} from '@/engine/patternObject';
import { signalReady } from '@/native-shell/bridge/webBridge';
import { pageIsReady } from '../afterReady';
import { useSuppressIOSLoupe } from '../useSuppressIOSLoupe';
import { tapTargetGrid } from './tapTargetGrid';
import { BG_EDITOR_CANVAS, CANVAS_HAIRLINE } from '@/editor-ui/theme';
import {
  BASE_CELL_PX,
  FRAME_OBJECT_FIT,
  WORLD_CELLS,
  computeFrameCellBboxCamera,
  pageHeightCells,
  pairAngleDeg,
  panBy,
  pinchCamera,
  pxPerCell,
  screenToWorld,
  shortestAngleDeltaDeg,
  wheelZoomFactor,
  worldLayerTransform,
  worldToScreen,
  zoomAboutPoint,
} from '../cameraMath';
import { purgeDecodeLevels } from '@/engine/imageDecodeLevels';
import {
  levelUrlFor, planImageDraws, warmDrawLevels, type ImageDrawPlan,
} from '../imageDrawLevels';
import {
  EditorSession,
  ResizedNode,
  SessionEntry,
  buildEditPatternCells,
  buildSetPatternSettings,
  patternGridOf,
  buildManipulateNode,
  buildManipulateNodes,
  buildPaintStroke,
  DEFAULT_IMAGE_TINT_FILL,
  buildPlaceArcShape,
  isArcCurveNode,
  buildPlaceLineShape,
  buildPlacePolygonShape,
  withNewShapeStyle,
  newShapeDraftColor,
  newShapeDraftFill,
  type DraftFill,
  newShapeDraftWidthCells,
  DEFAULT_NEW_SHAPE_STYLE,
  type NewShapeStyle,
  buildPlacePolyline,
  seededPatternStroke,
  buildResizeFrame,
  buildResizeNode,
  buildResizeNodes,
  canResizeMultiSelection,
  marqueeHitIds,
  resolveMultiSelectionBox,
  resolveMultiSelectionFrame,
  canTwoPointerManipulate,
  buildMoveNodes,
  isHostId,
  selectionUnitIds,
  filterPolylinePoints,
  lineShapeGeometry,
  arcShapeSegments,
  polygonShapeSegments,
  previewResizedNode,
  requiresUniformScale,
  resizePreviewBox,
  resolveSelectionBox,
  selectionRingBbox,
  simpleLineAxis,
  asSolidFill,
  shapeFillOf,
  GHOST_OPACITY,
  type TransformGhost,
  patternEditInk,
} from '../editorSession';
import { dimensionsHudPlacement, dimensionsHudTransform, rotationHudText } from '../dimensionsHud';
import {
  snapAngleDeg, snapDragDelta, snapPoint, snapStepCells, snapTwistDeltaDeg,
} from '../gridSnap';
import { tracksStalePointers } from '../pointerRegistry';
import {
  LIVE_INV_VAR,
  SCREEN_INV_TRANSFORM,
  SELECTION_BORDER_PX,
  SELECTION_COLOR,
  SELECTION_OUTLINE_FADE_MS,
  ZOOM_INV_VAR,
  screenPx,
  PAINT_DIM_VEIL,
  PAINT_VEIL_SHAPE_STROKE_PX,
  paintDimVeilPath,
  paintDimVeilShapeTransform,
  outlineGestureTransform,
  selectionOutlineRect,
  selectionOutlineStyle,
  textEditRingStyle,
} from '../selectionOutline';
import { useGridSnap } from '../useGridSnap';
import { useShowDimensions } from '../useShowDimensions';
import {
  ArcToolMode, ArrangeMode, LineToolMode, arrangeModeMoveOnly, arrangeModeNoScale, arrangeModeRotateOnly,
  arrangeModeTracesShape, arrangeModeUniformScale, isRasterBrushToolId, polygonIsCircle,
} from './toolbarMeta';
import { currentFrameId, dragTargetFrameId } from '../frameDrop';
import {
  buildMoveNodeWithDragScale, buildMoveNodesWithDragScale, dragScaleFactor,
} from '../dragScale';
import {
  type CellBbox, bboxCornerCell, computeCornerResize, CornerSign, MIN_ARC_CELLS, RESIZE_CORNERS,
  type ResizeFlip,
  sameBbox, sameFlip,
} from '../resizeMath';
import { paintToCssBackground, rgbCss } from '../colorUtils';
import { cameraAvoidingBottomInset } from '../cameraAvoid';
import { caretCodePoint, caretUtf16AtPoint, textCaretBox, textSelectionBoxes } from '../textCaret';
import {
  dragCellBbox, frontItemTakesPress, isTextDoubleTap, lockedTapClearsSelection,
  resolveCanvasTap, selectionBoxHitsCell, selectionContains,
  tapClearsSelection,
  selectionHoldsNode, selectionOwnsPress, selectionSwallowsCanvas, toolYieldsToSelection,
} from '../canvasTap';
import {
  buildPlaceTile, buildPlaceTileInPattern, mergeTileStrokeOps, tapLandsOnPatternGrid,
  tileCellInPattern, tileTapJoinsPattern, tileTargetPattern,
} from '../tileTool';
import {
  applySymmetryAffine,
  applySymmetryAffineVec,
  canvasSymmetryOn,
  canvasSymmetrySpecOf,
  canvasWideSymmetry,
  symmetryAffineMaps,
  symmetryAxesShown,
  symmetryOverlayFor,
  type CanvasSymmetrySpec,
  type SymmetryOverlayModel,
} from '../canvasSymmetry';
import { axisGroupOf, symmetryAxisSegments, writeSymmetryAxes, type WorldTransform } from '../symmetryAxesScreen';
import {
  clampToRegion, lineGridPoints, magnetToLines, type EditableRegion,
} from '../editableRegion';
import { triggerHaptic } from '@/native-shell/bridge/webBridge';
import { collectPaintGuards, pointInPaintGuard } from '../paintGuards';
import {
  type ForwardArrow, MARKER_POP_KEYFRAMES, type RegionMarker, writeForwardArrow, writeRegionChrome,
} from '../regionChromeScreen';

import { mirroredSegments, withSymmetryCopies } from '../symmetryObjects';
import { SymmetryDragPeer, symmetryDragPeers, withSymmetryReflection } from '../symmetryReflect';
import {
  OverlayPaintState, PaintBrushKind, PaintObjectStrokeState, PaintToolKind,
  TextPaintState, PatternPaintState, ObjectColorState, ColorScope, createObjectColorState,
  createOverlayPaintState, createPaintObjectStrokeState,
  createPaintStrokeDraft, createPatternPaintState,
  blurPaintObjectBrush, brushDimsToSelection, colorScopeWritesPaintIsland, createTextPaintState,
  erasePaintObjectBrush, paintFilterIds,
  paintHiddenIds, paintLockedIds, paintStampPoints, resolvePaintSessionTarget, smudgePaintObjectBrush,
  stampPaintBrush, stampPaintObjectBrush,
  advanceRandomColorWalk, createRandomColorWalk,
} from '../paintBrush';
import type { RandomColorWalk } from '../paintBrush';
import {
  type VectorEraseState, buildVectorEraseEntry, createVectorEraseState, eraseVectorDab, keptPieces,
} from '../vectorEraser';
import { buildSceneOcclusion } from '../sceneOcclusion';
import { subscribeTurnLive } from '../turnLive';
import { subscribeRotateLive } from '../rotateLive';
import { pushStrength } from '../pushStrength';
import {
  PushStrokeState, buildPushStroke, createPushStrokeState, pushDab, pushStrokeChanged,
} from '../pushBrush';
import { drawOverlayToCanvas, overlayImageData } from '@/engine/overlayCanvas';
import { createPaintPreviewCanvas } from '../paintOverlayPreview';
import { type ShapeStrokePreviewFrame, shapeStrokePreviewFrame, sideD } from '../shapeStrokePreview';
import { SHAPE_STROKES_SVG_ATTR, type ShapeSplit, mountShapeMarkup, splitShapeDom, unsplitShapeDom } from '../shapePaintDom';
import { shapePaintClipId } from '@/engine/imagePaintOverlay';
import { clearTextPaintPreviews, createTextPaintPreviews, upsertTextPaintPreview } from '../textPaintPreview';
import {
  CANVAS_ISLAND_CELLS, CANVAS_PAINT_TEXELS_PER_CELL, CanvasPaintWorking, composeCanvasPaint,
  islandKey,
} from '@/engine/canvasPaint';
import { paintObjectTranslation } from '@/engine/paintObject';
import { anyFingerMoved, classifyMultiTap } from '../multiTapGesture';
import {
  BorderOverlay, ImageNodeLayer, PaintNodeLayer, PatternNodeLayer, SvgNodeLayer, TextNodeLayer,
  drawPaintTiles,
} from './NodeLayer';
import { shadowGlowBoxShadow } from '../effectsBoxShadow';
import { overlayNearPoint, TAP_EXCLUSION_RADIUS } from '../tapExclusion';
import {
  type CanvasLayers, type CanvasRecords, type CanvasSurfaceHandle, type GestureHooks,
  type HostNodeTwist, type HostPreviewStandIn, type PointerClaim, type PriorSelection, canvasHost,
} from './canvasHooks';
import { resolveTwistUnit } from '../canvasTwist';
import { type HostTool, hostTool } from '../hostTools';

// The editor canvas: GL grid pass at the bottom (Phase 0 wiring kept), one
// absolutely-positioned world-transform DOM container above it holding a
// layer per scene node, and pointer/wheel gesture handling.
//
// Performance contract (§11): pan/zoom and node drags mutate styles
// directly through refs during the gesture — React state (and the engine
// op pipeline) only sees the single commit on gesture end.
//
// TWO FINGERS: the camera's by default — pan / zoom, or a stationary
// multi-finger tap for undo / redo. The one object gesture a second pointer
// keeps is the TWIST: both fingers landing on the same SELECTED manipulable
// object — or anywhere inside a selected group's or multi-selection's
// combined box — rotate it freely. Selected
// only — a two-finger gesture never changes the selection, so with nothing
// selected two fingers always work the camera (grabbing whatever sat under
// the pair used to select it mid-zoom). Rotation only — the pinch
// DISTANCE never scales anything. Two-finger scale used to ride the same
// gesture, which meant a pinch aimed at the view silently resized whatever
// was big enough to hold both fingers; a twist has no such collision (a
// camera pinch has no twist to speak of, and a deliberate twist reads as
// nothing else), so it came back without the scale. Anything a single
// pointer had in flight when the second lands is dropped or committed on
// the spot (beginTwoPointerGesture) so nothing is left half-done under the
// fingers.
//
// The other exception is the crop bar, where a pinch on the cropped image
// zooms its framing: there the framing IS the camera, and the canvas's own
// is not what the fingers are reaching for.

const TAP_SLOP_PX = 4;
const DRAW_MIN_DIST_CELLS = 0.15;

// Long-press radial menu timing (Facet CompositionCanvas).
/** Hold duration before the radial long-press menu opens. Matches iOS UILongPressGestureRecognizer default. */
const LONG_PRESS_MS = 500;
/** Hold duration for the lock-punch-through menu. Must exceed LONG_PRESS_MS — the
 *  super-press handler self-suppresses if the regular menu already fired. */
const SUPER_LONG_PRESS_MS = 1200;

// Selection affordance — matches the Facet composition editor: a solid cyan
// bounding box hugging the object bbox, with four white square corner handles.
// There is no rotation/side handle (rotate + scale are two-finger gestures, as
// in Facet). Colors are Facet's SELECTION_CYAN / TEXT_PRIMARY / BG_SEPARATOR
// (engine/colors.ts). The four corners, as [horizontal, vertical] edges the
// handle pins to; each handle is centered on its bbox corner. The blue is
/** No ink outside the box — every selection but a bent text's. One frozen
 *  object, so the render and the imperative re-anchor share an identity. */
const NO_OUTSET = { top: 0, bottom: 0 } as const;

// selectionOutline's SELECTION_COLOR, imported with the ring styles, so the
// text edit ring (the same blue, doubled) can never drift from it.
/** The "here it is" highlight ring — a green that reads as a pointer rather
 *  than as a selection (which is the blue above and comes with handles). */
// Facet's SELECTION_ORANGE (engine/colors.ts): the visual cue that corner
// drags follow a special rule instead of free-resizing — a simple H/V line's
// box (drags stretch the stroke along its own axis) and a repeat-mode
// pattern's region (drags repeat the tile rather than scaling it).
const SELECTION_ORANGE = '#FFA032';
// Handle size in SCREEN px: the handle is drawn inside the zoom-scaled world
// layer but counter-scaled back out (see SCREEN_INV_TRANSFORM), so it reads 10px
// at every zoom level, like the ring around it.
const HANDLE_SIZE_PX = 10;
const HANDLE_FILL = '#ffffff';
const HANDLE_BORDER = '#333333';
// Grab radius (screen px) around a corner handle that starts a resize. Larger
// than the 10px handle so the corner is easy to catch (Facet uses 16) — and
// now reliably so, since the drawn handle no longer outgrows it at high zoom.
const HANDLE_HIT_RADIUS_PX = 18;
const SELECTION_CORNERS = [
  ['left', 'top'],
  ['right', 'top'],
  ['left', 'bottom'],
  ['right', 'bottom'],
] as const;

// Live size readout during resize / pinch-scale / shape+place drags, gated on
// the View Settings "Dimensions" toggle. Facet's DimensionsHUD styling.
const DIM_HUD_FONT_PX = 22;
const DIM_HUD_BG = 'rgba(0, 0, 0, 0.75)';

// Color-tool brush cursor (Facet CompositionSVGLayer's gradient circle).
// The radial gradient approximates the paint falloff with a power curve
// anchored at three points — center = PEAK, midpoint = MID, edge = EDGE —
// so the soft circle under the finger IS the footprint the stamp colors.
// Offsets are evenly spaced; 7 stops is plenty for a smooth gradient.
/**
 * How long the camera takes to fly to a rect the shell asks it to reveal
 * (`revealRect`). Long enough to read as travel — the reader has to see
 * WHERE it went, or arriving somewhere new is the same as being teleported
 * — and short enough that a refused *I'm Done* is answered, not waited on.
 */
const REVEAL_GLIDE_MS = 520;

/**
 * How long the camera (or the scene) has to stand still before the image
 * draw levels are re-decided — see imageDrawLevels.ts.
 *
 * Long enough that a pinch, a flick and a drag are ONE settle rather than
 * thirty, short enough that it lands well inside the pause after a gesture.
 * Nothing about the picture changes at the settle except which source a
 * photo is decoded from, so being late costs nothing but memory held a
 * moment longer.
 */
const DRAW_LEVEL_SETTLE_MS = 250;

const SVG_NS = 'http://www.w3.org/2000/svg';
const PEAK_CURSOR_OPACITY = 0.85;
const MID_CURSOR_OPACITY = 0.7;
const EDGE_CURSOR_OPACITY = 0.1;
const CURSOR_FALLOFF_EXPONENT =
  Math.log((MID_CURSOR_OPACITY - EDGE_CURSOR_OPACITY) / (PEAK_CURSOR_OPACITY - EDGE_CURSOR_OPACITY))
  / Math.log(0.5);
const CURSOR_GRADIENT_STOPS: ReadonlyArray<{ offset: string; opacity: string }> =
  [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1].map((t) => ({
    offset: t.toFixed(4),
    opacity: (
      EDGE_CURSOR_OPACITY
      + (PEAK_CURSOR_OPACITY - EDGE_CURSOR_OPACITY) * Math.pow(1 - t, CURSOR_FALLOFF_EXPONENT)
    ).toFixed(4),
  }));
const BRUSH_CURSOR_GRADIENT_ID = 'cj-brush-cursor-gradient';

/** The push brush's disc: a neutral gray, like the blur brush's. The tool
 *  deposits no colour of its own — it moves what is already there. */
const PUSH_CURSOR_COLOR = { r: 168, g: 168, b: 168 };

interface CanvasSurfaceProps {
  /**
   * One-finger input on the canvas is LOCKED: nothing is selected, drawn,
   * dragged or placed, and the two-finger pan/zoom stays live (DrawBot's
   * running simulation, docs/drawBot.md §5.2). A press made under the lock
   * is a `lockedTap` and does one thing on release — put the selection
   * away, and with it the properties panel (canvasTap's
   * `lockedTapClearsSelection`).
   *
   * The chrome that drives whatever holds the lock is its own and is not
   * reached through here.
   */
  inputLocked?: boolean;
  session: EditorSession;
  aspect: number;
  currentColor: RGBColor;
  /** The paint island the current colors-group session continues, owned by
   *  the shell (it clears the ref when the tool group changes and updates it
   *  from each stroke's commit — see SessionEntry.paintSessionId). A ref,
   *  not state: strokes read it at gesture start, never during render. */
  paintSessionRef?: React.MutableRefObject<string | null>;
  /** Multiplier the brush-size slider applies to the brushes'
   *  grid-step radius — every colours-group brush, the recolour one too.
   *  Read once at stroke start, like the rest of the brush settings. */
  brushRadiusScale?: number;
  onSelect: (id: string | null) => void;
  /** The band of the page a turn may draw in (docs/social_game_spec.md
   *  §7.3, EditorConfig.editableRegion): every draw sample and shape-drag
   *  point is clamped into it, and — with `magnetYs` — the final point of
   *  a stroke or drag within tolerance of one of those lines snaps to its
   *  nearest grid point (`editableRegion.ts`'s `magnetToLines`, which came
   *  here from CozyJournal's creatureGeometry with the canvas). */
  editableRegion?: EditableRegion & { magnetYs?: readonly number[] };
  /** The region's chrome: the veil over everything outside it, a dotted
   *  line on each of the band's edges, and — where the region is a piece
   *  of a finite BOARD — an outline round the whole of that board, drawn
   *  over the veil as well as over the band (regionChromeScreen.ts) — and
   *  faint target dots on the grid points of each of `targetYs`. */
  regionChrome?: {
    veil: 'outside';
    midline: { ys: readonly number[]; dash: true };
    board?: { xMin: number; xMax: number; yMin: number; yMax: number };
    targetYs?: readonly number[];
  };
  /** World points drawn as green circles in the same overlay — the
   *  connection points. Recomputed by the shell on commit only. */
  markers?: readonly RegionMarker[];
  /** The page's forward arrow (`EditorConfig.forwardArrow`): the faint
   *  screen-space guide saying the top of a page leads, drawn in the same
   *  overlay in a `<g>` of its own — the region writer clears its group
   *  when there is no region, which a page with an arrow and no region is
   *  (regionChromeScreen.writeForwardArrow). */
  forwardArrow?: ForwardArrow;
  /**
   * A world rect the camera should GLIDE to frame, and the `key` of the
   * ask that wants it framed: CozyJournal's Creature turn refused over a
   * point the move before left uncarried flies the view to that point,
   * since the notice can say how many are left but not where
   * (docs/social_game_spec.md §7.3); Sol's Draw frames the plants it grew
   * (its architecture §6.4).
   *
   * Re-flown whenever `key` changes — pressing *I'm Done* again after
   * panning away asks again — and never on the same key twice, so a
   * render for any other reason does not yank the camera. A touch cancels
   * it, like the avoid-glide, and an ask that arrives while a finger is
   * already down is DROPPED rather than fought.
   *
   * `durationMs` is the ask's own, defaulting to {@link REVEAL_GLIDE_MS}:
   * the two callers want different flights (a refusal is answered, a
   * reveal is admired) and the duration is per-ask data, like the key.
   *
   * ONE prop for both, where Sol passed a camera it had worked out itself
   * (stage 5b.4c's `cameraGlide`, gone at 5b.4e): the BOX is the question
   * — the canvas owns how a box becomes a camera, which is where the
   * chrome insets and the fit live, and a host that computed its own
   * camera was quietly framing without them.
   */
  revealRect?: { bbox: CellBbox; key: string; durationMs?: number } | null;
  /** A finger landed on the canvas — ANY finger, before the press is
   *  classified and whatever it turns out to mean. For a host that has
   *  something playing which a touch should end (Sol's Draw reveal, its
   *  architecture §6.3): the frame that ending asks for must see the
   *  finger, so nothing may precede this. */
  onCanvasPointerDown?: () => void;
  /** Node ids withheld from render AND hit-test for the session — a twin
   *  of `hidden` the document never carries (§7.3's veil). */
  veiledIds?: ReadonlySet<string>;
  /** Marquee release: select every id the dragged rect touched (the shell
   *  normalizes — 0 clears, 1 single-selects, 2+ multi-selects). */
  onSelectMany: (ids: string[]) => void;
  /** Shift-click on a node (desktop): toggle it into / out of the current
   *  selection. The shell normalizes (drops to single / clears as needed). */
  onToggleSelect: (id: string) => void;
  onCommit: (se: SessionEntry) => void;
  onCameraCommit: (camera: Camera) => void;
  onViewportChange: (viewport: Viewport) => void;
  /** Height (px) of bottom-anchored UI currently covering the canvas — the
   *  object properties panel plus its open submenu, reported by the shell.
   *  When > 0 and the selection's bottom edge is under it, the camera GLIDES
   *  the selection just clear (see the camera-avoid effect). 0 / absent
   *  disables the behavior (web: the shell only wires it in the native
   *  WKWebView shell). */
  avoidBottomPx?: number;
  /** Top chrome height (px) the avoid-scroll must not push the selection's
   *  top edge under (header + title band). */
  avoidTopPx?: number;
  /** Native text editing: the text node whose edit is live and the
   *  textarea's UTF-16 caret index — the node draws the caret itself (the
   *  invisible input makes the on-canvas object the input box). Null on web
   *  (the visible input bar carries its own caret there). */
  editingCaret?: {
    textId: string;
    utf16: number;
    /** The other end of the textarea's selection, when it has one. Equal
     *  to `utf16` for a plain caret. The node paints the band between them
     *  (textSelectionBoxes) so a range chosen in an invisible field is a
     *  thing the reader can see. */
    anchorUtf16?: number;
  } | null;
  /** A text node is open for typing right now (the keyboard is up). A tap on
   *  empty canvas is then a DISMISSAL — the field blurs and the edit commits
   *  — so the canvas must not also place something under the finger. See
   *  resolveCanvasTap. */
  editingText?: boolean;
  /** The selected IMAGE is open for reframing — double-tapped, the double
   *  border round it, a drag on its body panning the bitmap inside the
   *  frame (cropPanNodeId carries that half). Lights the same edit ring the
   *  editing text wears: both say "this object's INSIDE is what the next
   *  touch works on", and a page holds at most one of them open. */
  editingImage?: boolean;
  /** A press landed INSIDE the text node currently being edited: move the
   *  caret to `utf16` rather than treating it as a fresh tap. The canvas also
   *  swallows the press's default action so the (invisible) textarea keeps
   *  focus — without that the field blurs, the edit commits, and the tap
   *  reopens it, which is the keyboard dismiss/re-show flicker this avoids. */
  onCaretSeek?: (utf16: number) => void;
  /** A DOUBLE tap landed on the text being edited (isTextDoubleTap): select
   *  its whole content, the way a double tap does in any text field. */
  onSelectAllText?: () => void;
  /** Text tool: tap on empty canvas drops a new text at this world cell. A
   *  DRAG instead supplies `bbox` — the dragged rect the new text should
   *  occupy (wrap to its width, take its box verbatim). */
  onAddText: (cellX: number, cellY: number, bbox?: CellBbox) => void;
  /** Photos tool: tap on empty canvas opens the image import picker; the
   *  imported image is centered on this world cell. A DRAG instead supplies
   *  `bbox` — the shell drops a photo placeholder into the dragged rect and
   *  the picked image replaces it in place (cover-filling the box). */
  onRequestPhoto: (cellX: number, cellY: number, bbox?: CellBbox) => void;
  /** Photos tool with an image already selected: an empty-canvas tap means
   *  "done placing", not "another one" — the shell re-arms the arrange tool
   *  instead of opening the picker again (see resolveCanvasTap). */
  onRevertToArrange: () => void;
  /**
   * A settled tap under one of the app's OWN placing tools (hostTools.ts
   * `tap`): place whatever that tool places, centred on this world cell.
   *
   * ONE callback for every such tool, because the canvas's part is the
   * same for all of them — read the tap, apply the tool's two declared
   * riders (`HostTool.place`: the grid snap, and refusing a tap within
   * reach of the floating chrome) and hand over the cell. The shell
   * switches on the id to its own builder, which is where the knowledge
   * of what a rig, a word, a tile or a seed IS belongs. None of these
   * tools has a drag form: a rig has one size at birth, a word is the
   * size of its own card, a tile fills one grid cell, and a drag pans.
   */
  onHostPlace: (tool: string, cellX: number, cellY: number) => void;
  /** Pattern tool: a drag on empty canvas selected `bbox` — a region of
   *  grid cells, cols×rows of them (each ≤ 16). The shell places a fresh
   *  PatternObject of that resolution covering it, always its own object:
   *  dragging out a region is the CREATING gesture, and creating never
   *  merges into or edits a pattern already on the page. */
  onCreatePattern: (bbox: CellBbox, cols: number, rows: number) => void;
  /** The pattern sub-tool a press INSIDE a pattern paints with (the Tools /
   *  Tiles properties bars set it; the shell owns it). Absent = random. */
  patternSubTool?: PatternSubTool;
  /** Whether the pattern tool's empty-canvas drag may CREATE a region.
   *  False in the formats whose bar never offers the pattern tool (the
   *  tile formats — Greeting, Facets' Saturday): the pattern tool still
   *  reaches the hand there through the tile radial's Erase / Close arms
   *  and the Tiles bar's picks, which need its grid BRUSH — but there is
   *  no such thing as dragging out a rectangle of tiles while using the
   *  Tile tool, in any mode, so the drag falls through to the pan. */
  patternRegionDrags?: boolean;
  /** Whether the TILE tool's drag off the open grid may create a region —
   *  a brand-new pattern object. True wherever the bar can arm the tile
   *  tool at all, which is the tool's resting behaviour: it creates.
   *
   *  False where the tool comes to hand ONLY to paint a closed shape's
   *  pattern fill (a bar with no tile button — Patchwork, whose page is
   *  dealt complete and places nothing). There a drag off the piece being
   *  patterned must not mint a pattern of its own: it falls through to the
   *  pan, and the tap that settles it closes the fill. */
  tileRegionDrags?: boolean;
  /** Whether a drag outlines the frame that would adopt its node (Figma's
   *  drop-target ring). Undefined → shown; a format turns it off through
   *  EditorConfig.frameDropHighlight (Adrift). Adoption is unaffected. */
  frameDropHighlight?: boolean;
  /** The pattern that is OPEN FOR EDITING — put there by hand with the
   *  Edit capsule (EditorShell, editablePatternId). It is framed with the
   *  editing double ring (the text edit ring's style, in the pattern's
   *  orange) and it is the ONE object the Tile tool may rework: stamps
   *  re-roll its cells and grow its grid, while every other pattern on the
   *  page is scenery. Null (no double border) means no pattern's contents
   *  can be changed, and the tool only creates. */
  tileEditPatternId?: string | null;
  /** The style a freshly drawn shape is born in — the last one the user
   *  dressed (see editorSession's NewShapeStyle). */
  newShapeStyle?: NewShapeStyle;
  /** Vector objects drawn as GHOSTS over the scene: the object's own look at
   *  half opacity, untouchable (no hits, no drags), riding pan/zoom with the
   *  world. The Transform bar's Create copies preview — the copies a press
   *  would lay down, where they would land (editorSession's
   *  transformCopyGhosts). Absent / empty draws nothing. Not scene objects:
   *  their ids are never in state, so hit testing (engine-side, on state)
   *  can't find them and a drag can't pick their elements. */
  /** The Copies draft's preview: the copies a press would lay down, each
   *  with the KIND whose node layer draws it and the world pose it is
   *  drawn at. A run over a group is as mixed as the group is, so the kind
   *  rides on the ghost rather than on the run. */
  ghosts?: readonly TransformGhost[] | null;
  /** The sprite families a grid's OWN tile-set list leaves out — what the
   *  random brush may not pick for it. The filter is the pattern's, not
   *  the app's (PatternObject.tileSets, the Shapes page), so this is a
   *  RESOLVER rather than a set: each stamp hands it the list of the grid
   *  it is about to touch, and `undefined` in means the default families,
   *  `undefined` out means nothing is excluded. */
  patternExcludedFamiliesOf?: (tileSets: readonly string[] | undefined) => Set<string> | undefined;
  /** A single tap landed on a scene node (after selecting it, no drag).
   *  `wasSelected` is whether the node was already the selection BEFORE this
   *  tap — i.e. this is a re-tap. The shell re-taps an editable text into its
   *  content editor, opens the replace-photo picker for an unset photo
   *  placeholder, and otherwise no-ops. */
  onNodeTap: (nodeId: string, wasSelected: boolean) => void;
  /** A DOUBLE TAP under the recolour brush on a pattern grid — a pattern
   *  object, or a shape carrying a pattern fill. The brush's tap is a dab,
   *  not a select, so the double never reaches onNodeTap; this is the
   *  brush's own road to the grid, the one the arrange tool's second tap
   *  takes. `undoFirstDab` says the first tap's dab is the newest undo
   *  entry, so the shell can lift it: two taps meant "let me in", not two
   *  dabs. Returns whether the grid opened — false, and the second tap is
   *  the dab it would have been. */
  onColorBrushDoubleTap?: (nodeId: string, undoFirstDab: boolean) => boolean;
  /** The image whose Crop submenu is open, or null. When set, a one-finger drag
   *  that starts on THAT image pans its crop (see onCropPan) instead of moving
   *  the object — regardless of the active tool. */
  cropPanNodeId: string | null;
  /** Live crop pan from an on-canvas drag: `(dxCells, dyCells)` is the drag
   *  delta from gesture start, in world cells. `committed` false previews (each
   *  move), true finalizes as one undo step (or rolls back a zero-length drag). */
  onCropPan: (nodeId: string, dxCells: number, dyCells: number, committed: boolean) => void;
  /** Live crop zoom from a two-finger pinch on the crop image: `factor` is the
   *  finger-separation ratio since the pinch began. `committed` false previews,
   *  true finalizes as one undo step (factor 1 rolls back an unmoved pinch). */
  onCropZoom: (nodeId: string, factor: number, committed: boolean) => void;
  /** Sub-mode of the line tool — what a `line`-tool drag commits (Facet's
   *  long-press toggle on the toolbar button). */
  lineToolMode: LineToolMode;
  /** Sub-mode of the arc tool (arc ⇄ circle). */
  arcToolMode: ArcToolMode;
  /** The selection tool's mode (toolbarMeta ArrangeMode). Under 'move' the
   *  selection draws no corner handles, a corner grab is a plain drag and
   *  two fingers on the selection pinch the camera — the object only ever
   *  moves. Read only while the selection tool is armed
   *  (arrangeModeMoveOnly); the other tools keep their handles. */
  arrangeMode: ArrangeMode;
  /** Slider division a `polygon`-tool drag commits (the toolbar's sides
   *  slider): a side count on 3–12, a circle on the two end stops. */
  polygonSides: number;
  /** The color tool's brush blend mode (the picker's grid) — how a paint
   *  stroke shifts the colors it crosses (see paintBrush.ts). */
  colorBlendMode: BlendMode;
  /** The color tool's brush opacity (the picker's Opacity slider), 0–1. */
  colorBrushOpacity: number;
  /** What the RECOLOUR brush is aimed at — the scope capsule's pick (see
   *  paintBrush's ColorScope): a stroke writes fills, strokes or pattern
   *  cells, never two at once. Read once at gesture start, like the blend
   *  mode and the opacity beside it; ignored by every other brush. */
  colorScope: ColorScope;
  /** The Color brush's Eraser is on (EditorShell's colorEraser, only while
   *  the Color brush is in hand): a Color stroke CUTS the stroked paths it
   *  crosses instead of restaining them (vectorEraser.ts). Read once at
   *  gesture start. */
  vectorEraser?: boolean;
  /** The page is marked DONE, so the canvas is read-only: a single finger
   *  can still move the page about (the same view-only pan a canvas with
   *  no tool armed gives), but nothing is drawn, grabbed, placed or
   *  typed on — and the press calls this instead, which raises the ask to
   *  reopen the day (reopenDone.ts). Null/undefined while the page is
   *  still being worked on, which is the ONLY state that edits. */
  onEditWhileDone?: (() => void) | null;
  /** Two-finger tap on the canvas → undo (see the MULTI_TAP_* handling). */
  onUndo: () => void;
  /** Three-finger tap on the canvas → redo. */
  onRedo: () => void;
  /** A stationary LONG_PRESS_MS hold on a grabbed node: open the radial
   *  quick-action menu at this screen point. The finger stays down for the
   *  menu's whole life — subsequent moves route to onLongPressMove and the
   *  release to onLongPressUp (which activates the hovered action). */
  onLongPress?: (screenX: number, screenY: number) => void;
  onLongPressMove?: (screenX: number, screenY: number) => void;
  onLongPressUp?: () => void;
  /** Super long press (SUPER_LONG_PRESS_MS hold): punches through locks —
   *  re-hit-tests with ignoreLock and fires only when the held point sits
   *  on a LOCKED node (invisible to the normal tap hit-test). */
  onSuperLongPress?: (screenX: number, screenY: number, hitId: string, hitKind: CompItemKind) => void;
  onSuperLongPressMove?: (screenX: number, screenY: number) => void;
  onSuperLongPressUp?: () => void;
  /** The app's OWN tools on the bar, with the rule each placing one's tap
   *  is read by (hostTools.ts, the registry of the plan's §4.1). Static
   *  per app: the canvas reads the same list for its whole life. */
  hostTools: readonly HostTool[];
  /** The host's open trace, if it keeps one: `mark` records the moment the
   *  first frame is up (before the splash is dismissed, because that is
   *  the moment being timed) and `report` hands the marks over once the
   *  deferred work is released (a trace posted from anywhere else would
   *  race the one that matters). Diagnostics: nothing about the page
   *  depends on either. */
  openTrace?: { mark(name: string): void; report(): void };
  /** One-finger gesture hooks the host supplies (canvasHooks.ts
   *  `GestureHooks`): a press a hook CLAIMS is the hook's for its whole
   *  life and the surface runs none of its own machinery for it. This
   *  app's are the rig's joint knobs (rigGestures.ts). */
  gestures?: GestureHooks;
  /** The host's own DOM inside the world layer, per scene node
   *  (canvasHooks.ts `CanvasLayers`). This app's is the rig, which renders
   *  as a live WebGL sketch seated on its baked silhouette. */
  layers?: CanvasLayers;
  /** Filled by the surface on mount with its live camera, viewport, pixel
   *  pick and layer slot (`CanvasSurfaceHandle`); null until then. */
  surfaceHandle?: React.MutableRefObject<CanvasSurfaceHandle | null>;
}

// The selection as it stood BEFORE a press selected something, kept on the
// gesture (or on a host's CLAIM) so a second finger — which turns the press
// into a CAMERA gesture — can put it back (beginTwoPointerGesture). Only
// present when the press actually changed the selection: two fingers must
// never leave behind an object nobody had tapped. The type is the canvas
// seam's, because a claimed press can select too (canvasHooks.ts).

type Gesture =
  | { mode: 'idle' }
  // `noTap` marks a middle-mouse-button pan (desktop): unlike a no-tool /
  // two-finger pan, a stationary release must NOT settle a tap — a middle
  // click should never select, drop text, or open the photo picker.
  | { mode: 'pan'; startCamera: Camera; startX: number; startY: number; moved: boolean; noTap?: boolean }
  | { mode: 'pinch'; startCamera: Camera; aId: number; bId: number;
      a0: { x: number; y: number }; b0: { x: number; y: number } }
  // Two-finger TWIST of a single unlocked object: the pair's rotation turns
  // it freely. ROTATION ONLY — the finger separation is never read, so the
  // pinch distance can't scale anything (two-finger scale is what made a
  // camera pinch resize objects; it stays gone). `angle0` is the object's
  // committed angleDeg at gesture start; `accumDeg` is the twist accumulated
  // since (unwrapped across the atan2 seam); `lastPairDeg` is the previous
  // finger-pair angle.
  //
  // With Grid Snap on the twist lands on a 45° multiple (snapAngleDeg).
  // `angleDeg` is that resolved live angle — absolute, already snapped, and
  // what the release commits — kept beside the raw `accumDeg`, which has to
  // stay unquantized for the next move's unwrapping to work.
  | { mode: 'manipulate'; nodeId: string; aId: number; bId: number;
      angle0: number; accumDeg: number; lastPairDeg: number; angleDeg: number;
      /** The object's bbox centre in world cells — the twist's pivot, which
       *  stands still all gesture, so the rotation readout (Dimensions HUD)
       *  is anchored on it once rather than re-resolved per move. */
      cx: number; cy: number;
      /** The host's reading of this node's twist (canvasHooks.ts
       *  `CanvasTwist.node`), resolved once at the press, or null for an
       *  ordinary scene node. A rig's rolls the FIGURE inside its viewport
       *  rather than turning the object's box, so angle0 comes from its
       *  record and the live drive goes onto its stage. */
      hostTwist: HostNodeTwist | null }
  // The same twist for a GROUP or a MULTI-SELECTION (both fingers landed
  // inside the unit's combined box — on one member, two members, or the
  // space between): the whole selection rotates about its combined box
  // centre. Same twist bookkeeping as 'manipulate', but the live angle is
  // the DELTA since gesture start (`deltaDeg` — members keep their own
  // committed angles and the group turns as one). `angleDeg` is the turn
  // the combined box is drawn at (a bound group off the quarters), which
  // the outline's live rotation composes on — and, with Grid Snap on, the
  // angle the snap is taken from: the unit lands ON a 45° multiple
  // (snapTwistDeltaDeg), not BY one. Every move previews the very
  // entry the release commits (previewGesture), so there is nothing to
  // snapshot per member.
  | { mode: 'multiManipulate'; ids: string[]; box: CellBbox; angleDeg: number;
      aId: number; bId: number; accumDeg: number; lastPairDeg: number; deltaDeg: number }
  // ROTATE mode's press on an object: it has selected, and nothing
  // drags (the slider and the two-finger twist turn it) — but the
  // release still settles as a tap on that node, so the second tap of a
  // double reaches the shell and a patterned shape's grid opens here as
  // it does under every other mode. It used to go straight to 'idle',
  // which ate the tap and with it the gesture.
  | { mode: 'nodeTap'; nodeId: string; wasSelected: boolean; startX: number; startY: number }
  // A one-finger press made while `inputLocked` holds: nothing moves, and
  // a release within the slop puts the selection away and the properties
  // panel with it (canvasTap's lockedTapClearsSelection). The lock cannot
  // simply drop the press, because the tap that dismisses a page is the
  // one thing a locked canvas still owes.
  | { mode: 'lockedTap'; startX: number; startY: number }
  | { mode: 'drag'; nodeId: string; startX: number; startY: number; dx: number; dy: number;
      wasSelected: boolean;
      /** The turn the node's box is DRAWN at, snapshotted at the press, which
       *  the outline's live transform composes on — as in 'multiDrag'. The
       *  DRAWN turn, not the node's own `angleDeg`: a member of a tilted
       *  FRAME is turned by the frame and carries no angle of its own (a
       *  frame's members drag one at a time — selectionUnitIds promotes
       *  plain groups only), so the raw field wrote a bare translate over
       *  the resting rotation and the box stood square for the length of
       *  every drag. */
      angleDeg: number;
      /** Has the press crossed TAP_SLOP_PX yet? Until it has, the press is
       *  still a TAP and NOTHING is previewed — see the 'drag' move case. */
      moved: boolean;
      /** The node's standing symmetry partners, moved live with the drag
       *  (resolved lazily on the first move — see symmetryDragPeers). */
      peers?: SymmetryDragPeer[];
      prevSelection?: PriorSelection }
  // Marquee (arrange tool, press on empty canvas): drag out a rect, release
  // selects everything it touches. Same deferred commitment as 'shape' — the
  // press stays a tap (select / clear) until it crosses TAP_SLOP_PX.
  | { mode: 'marquee'; downX: number; downY: number; active: boolean }
  // Combined-box drag (a multi-selection): one finger inside the combined
  // bounding box moves EVERY selected node by the same delta. `box` is the
  // combined box at gesture start (the grid-snap anchor: its origin is what
  // pulls onto an intersection, like a single node's bbox origin).
  // `angleDeg` is the turn the combined box is DRAWN at (a bound group off
  // the quarters), which the outline's live transform composes on — as in
  // 'multiManipulate' and 'drag'. Without it a drag writes a bare translate
  // over the resting rotation and the box stands square until release.
  | { mode: 'multiDrag'; ids: string[]; box: CellBbox; angleDeg: number;
      startX: number; startY: number; dx: number; dy: number;
      /** As in 'drag': below TAP_SLOP_PX the press is still a tap and the
       *  members hold still. */
      moved: boolean;
      /** The members' standing symmetry partners, moved live with the drag
       *  (resolved lazily on the first move — see symmetryDragPeers). */
      peers?: SymmetryDragPeer[];
      prevSelection?: PriorSelection }
  // Corner-handle resize: a one-finger drag on the selection's corner. The
  // opposite corner is pinned and the cursor is projected into the node's local
  // axes (see resizeMath). `sign` is the grabbed corner, `angleDeg` the node's
  // committed free rotation, `oldBbox` its bbox at gesture start. The node is
  // rescaled and re-rendered live (see the 'resize' move branch); release
  // commits the same geometry as one undo entry. `lastBbox` is the box the
  // last preview was built for, so repeat moves inside one grid step cost
  // nothing. `uniform` is resolved once at gesture start (circles can't scale
  // non-uniformly) and applied to every preview frame AND the commit, so the
  // box the user sees is exactly the one that lands.
  //
  // A corner pulled PAST the pinned one turns the node over: the box comes
  // out the far side and the content is mirrored on the axis that crossed
  // (computeCornerResize's `flip`), previewed and committed with the box.
  //
  // `frame` marks a FRAME resize (targetId is then a frame group id, not a
  // leaf): the whole frame scales through its group transform, previewed by
  // transforming the frame's clip wrapper rather than through React state.
  | { mode: 'resize'; targetId: string; frame: boolean; sign: CornerSign; angleDeg: number;
      oldBbox: CellBbox; changed: boolean; uniform: boolean;
      freeAxis: 'x' | 'y' | null; lastBbox?: CellBbox; lastFlip?: ResizeFlip }
  // Corner-handle resize of a GROUP selection: the combined box's corner is
  // dragged (opposite corner pinned, free per-axis factors — uniform when the
  // drag keeps the diagonal, non-uniform when it doesn't) and the whole unit
  // maps through the old→new affine along the box's own axes (`angleDeg`,
  // a bound group's turn). Each move previews the entry the release commits
  // (buildResizeNodes with the same box the preview showed).
  | { mode: 'multiResize'; ids: string[]; oldBox: CellBbox; angleDeg: number; sign: CornerSign;
      /** Hold the combined box's aspect: the selection tool's SCALE mode,
       *  resolved once at gesture start like the single-node resize's. */
      uniform: boolean;
      /** The axes the drag has turned over, with the box it was read off —
       *  the release commits the pair the last preview drew. */
      changed: boolean; lastBox?: CellBbox; lastFlip?: ResizeFlip }
  // Crop pan: a one-finger drag on the image whose Crop bar is open, panning
  // its framing offset instead of moving the object. Same delta bookkeeping as
  // 'drag', but committed through onCropPan (framing) rather than buildMoveNode.
  | { mode: 'cropPan'; nodeId: string; startX: number; startY: number; dx: number; dy: number }
  // Crop zoom: a two-finger pinch on that same image, scaling its framing zoom
  // instead of the object or the camera. `factor` is the latest finger-pair
  // separation ratio (curDist / startDist); committed through onCropZoom.
  | { mode: 'cropZoom'; nodeId: string; aId: number; bId: number; startDist: number; factor: number }
  // Freehand draw. `downX`/`downY` and the same TAP_SLOP_PX deferral the shape
  // tools use: below the slop the press is still ambiguous, so a stationary
  // press falls through to the normal tap routing (clear the selection, keep
  // the tool armed) instead of committing a one-point stroke that draws
  // nothing and leaves whatever was selected selected.
  | { mode: 'draw'; downX: number; downY: number; moved: boolean;
      cellPoints: [number, number][]; screenPoints: [number, number][] }
  // Color-group drag-paint (Facet's colorPaint drag): the recolour brush,
  // the raster paint brush and their erase / blur companions, all one
  // gesture differing only in `kind` (what a stamp does — see
  // PaintBrushKind). The whole stroke accumulates into `draft` (the engine's
  // PaintStrokeDraft — per-segment blends, legacy fills) plus the app-side
  // accumulators: per-character text colors, the image / solid-shape bitmap
  // layers, and — for the Color brush, which lays no bitmap at all — the
  // whole-object tints and fills in `objectColor`; release commits it all as
  // ONE undo entry (buildPaintStroke).
  // `radiusCells` / `filterIds` / `skipIds` are resolved once at stroke
  // start: one grid step's radius, Facet's selection filter, and the
  // hidden-group + frame-boundary exclusions.
  // `paint` is the paint-island accumulator: the session island's working
  // set the 'paint' brush stamps into, or the erase/blur targets — null
  // when the kind touches no island (color, or a selection confining the
  // stroke to objects).
  // `lastCell` is where the previous dab landed, in world cells: a pointer
  // stream is samples, not a path, so every move walks the gap in from here
  // (paintStampPoints) rather than stamping once and leaving a row of dots.
  // The FIRST dab is deferred, like 'shape' and 'placeBox' defer their drafts:
  // it lands when the finger crosses TAP_SLOP_PX (at `downX`/`downY`, so the
  // stroke still starts where the finger did) or when a stationary press
  // lifts. Stamping on contact instead is what made a two-finger pinch leave
  // a dot — the fingers never land in the same frame, so the first one always
  // painted before the second could turn the gesture into a pinch. `stamped`
  // is that "anything committed yet" flag; while it is false the gesture can
  // be abandoned without a trace.
  | { mode: 'paint'; kind: PaintToolKind; draft: PaintStrokeDraft;
      textPaint: TextPaintState; imagePaint: OverlayPaintState; shapePaint: OverlayPaintState;
      patternPaint: PatternPaintState;
      /** 'color' only: the solid each touched image's tint layer and each
       *  touched shape's fill ends the stroke at. Empty for every other
       *  brush — they write those objects' bitmap layers instead. */
      objectColor: ObjectColorState;
      /** Per pattern, the `patternPaint.rev` its mounted markup was last
       *  baked from — what makes the preview re-bake only what moved. */
      patternPreviewRev: Map<string, number>;
      paint: PaintObjectStrokeState | null; lastCell: [number, number] | null;
      downX: number; downY: number; stamped: boolean;
      radiusCells: number; filterIds: Set<string> | null; skipIds: Set<string>;
      /** 'push' only: the vector paths and rigs the stroke may deform, and
       *  how hard it deforms them. The island half rides `paint` above like
       *  the eraser's does — the raster pipeline is the same one. */
      push: PushStrokeState | null; strength: number;
      /** 'randomize' only: the stroke's colour walk, stepped once per dab.
       *  Null under every other blend mode. */
      random: RandomColorWalk | null;
      /** The Color brush's Eraser: the stroke cuts paths instead of
       *  colouring anything, and every other accumulator stays empty. Null
       *  for every ordinary stroke. */
      vectorErase: VectorEraseState | null }
  // Line / arc tool bounding-box drag (Facet's line + arc drag-to-draw). Like
  // Facet, commitment is deferred: the gesture is seeded on pointer-down but
  // stays `active: false` — and commits nothing — until the finger travels
  // TAP_SLOP_PX, so a stationary press still resolves as a tap. `start` is the
  // DOWN point snapped to the nearest grid intersection; `end` is the live
  // cursor after the tool's constraint (H/V/diagonal, free rect, or square),
  // and `center` is the arc's pickCenter for that box.
  | { mode: 'shape'; tool: 'line' | 'arc' | 'polygon'; downX: number; downY: number;
      active: boolean; start: [number, number]; end: [number, number] | null;
      center: [number, number] | null }
  // Photos / text tool drag-to-place: the dragged rect becomes the new node's
  // bounding box (image fitted into it, text wrapped to it). Same deferred
  // commitment as 'shape': seeded on pointer-down, `active` only after
  // TAP_SLOP_PX, so a stationary press still resolves as the tool's tap
  // (place at point / open picker). `start`/`end` are the drag's corners in
  // world cells.
  | { mode: 'placeBox'; tool: 'photos' | 'text'; downX: number; downY: number;
      active: boolean; start: [number, number]; end: [number, number] | null }
  // Pattern tool, empty-canvas press: drag out a region of grid cells (the
  // floor-snapped cell under the press is the anchor; the rect is clamped to
  // 16 cells per axis, trimming the edge away from the finger's travel) that
  // becomes a fresh PatternObject of that resolution. Same deferred
  // commitment as 'placeBox'.
  | { mode: 'patternRegion'; downX: number; downY: number; active: boolean;
      anchor: [number, number]; region: CellBbox | null }
  // Pattern tool, press on an existing pattern's bbox: paint its component
  // tiles with the active pattern sub-tool. Edits accumulate on a working
  // copy (so later connectivity picks see earlier stamps) and commit as ONE
  // editPatternCells op at gesture end; the live preview re-bakes the
  // working copy into the node's mounted <svg> imperatively (90 fps rule —
  // no React state during the stroke). Like 'paint', the first stamp is
  // deferred past the tap slop so a press that becomes a pinch leaves the
  // pattern untouched.
  // `symmetry` is the CURRENT rules when they outrank the pattern's stored
  // mode: the Close (reconcile) brush works under the toolbar's canvas
  // Symmetry while it is on — Flood's precedence — so the working copy
  // carries these flags and the commit writes them onto the pattern.
  // `frame` is the grid's POSE, resolved once at press: the inverse of the
  // pattern's world matrix, so a grid inside a bound group (or one the group
  // has scaled) takes the stroke where it is DRAWN. Resolved once and not
  // per point because a stroke edits cells and never the pose — and because
  // after the first edit `working` is no longer the object the graph holds,
  // so it could not be found there again.
  | { mode: 'patternPaint'; patternId: string; downX: number; downY: number;
      working: PatternObject; frame: NodeHitFrame; edits: PatternCellEdit[];
      painted: Set<number>; stamped: boolean; symmetry?: PatternSymmetry }
  // Tile tool press: a drag stamps one connecting tile into every grid cell
  // the finger crosses (each cell at most once per stroke), the pattern
  // paint stroke's shape — stamps accumulate against a working scene copy
  // (so each pick sees the tiles before it) and commit as ONE undo step at
  // gesture end, with the live preview mounted imperatively (90 fps rule).
  // Below the slop the press stays a tap and settles through resolveCanvasTap
  // (a 'hostPlace' for the tile), exactly as before drags existed.
  | { mode: 'tileStamp'; downX: number; downY: number; active: boolean;
      working: CompositionState; ops: SessionEntry['entry'];
      stamped: Set<string>; previewEls: HTMLElement[]; touched: Set<string>;
      // A pattern GROWN this stroke (stamped past its edge in its own space):
      // its committed node is hidden and a preview of the working grid stands
      // in, re-mounted on every later edit of it (see stampTileAtWorld).
      grown?: Map<string, HTMLElement>;
      /** World point of the previous stamp event — the trail walker
       *  interpolates from here so a fast drag misses no cells. */
      last?: { x: number; y: number } };

/** One ghost, drawn with the node layer its kind uses on the page — the
 *  same component the real object draws with, so a proposal cannot look
 *  like something the page would not make.
 *
 *  Handed a POSE rather than a bare object: the shell resolves each ghost
 *  to the world (transformCopyGhosts), because a copy of a bound group
 *  wears its transform on the group and its members' own records never
 *  move. */
function renderGhostNode(
  ghost: TransformGhost,
  strokeScale: number,
  srcFor: (imageId: string) => string | undefined,
): React.ReactNode {
  const { kind, drawn } = ghost;
  const id = drawn.node.id;
  switch (kind) {
    case 'svg':
      return <SvgNodeLayer key={id} drawn={drawn} strokeScale={strokeScale} />;
    case 'text':
      return <TextNodeLayer key={id} drawn={drawn} />;
    case 'image':
      return (
        <ImageNodeLayer
          key={id}
          drawn={drawn}
          src={srcFor((drawn.node.content as ImageObject).imageId)}
        />
      );
    case 'paint':
      return <PaintNodeLayer key={id} drawn={drawn} />;
    case 'pattern':
      return <PatternNodeLayer key={id} drawn={drawn} strokeScale={strokeScale} />;
    default:
      return null;
  }
}

/** The scene with `veiledIds` marked hidden — for the session's render
 *  and hit-test alone, the document untouched (the veil, §7.3). The same
 *  state back when there is nothing to veil, so nothing re-renders for
 *  the common case. */
function veilState(state: CompositionState, veiledIds: ReadonlySet<string> | undefined): CompositionState {
  if (!veiledIds || veiledIds.size === 0) return state;
  const veil = <T extends { id: string; hidden?: boolean }>(nodes: T[] | undefined): T[] | undefined =>
    nodes?.map((n) => (veiledIds.has(n.id) && !n.hidden ? { ...n, hidden: true } : n));
  return {
    ...state,
    figures: veil(state.figures) ?? state.figures,
    svgObjects: veil(state.svgObjects) ?? state.svgObjects,
    ...(state.images ? { images: veil(state.images) } : {}),
    ...(state.texts ? { texts: veil(state.texts) } : {}),
    ...(state.paintObjects ? { paintObjects: veil(state.paintObjects) } : {}),
    ...(state.patternObjects ? { patternObjects: veil(state.patternObjects) } : {}),
  };
}

export function CanvasSurface({
  inputLocked,
  session, aspect, currentColor, paintSessionRef, brushRadiusScale, avoidBottomPx, avoidTopPx, editingText, editingImage, editingCaret, onCaretSeek, onSelectAllText,
  onSelect, onSelectMany, onToggleSelect, onCommit, onCameraCommit, onViewportChange, onAddText, onRequestPhoto, onRevertToArrange, onHostPlace, onCreatePattern, patternSubTool, patternRegionDrags, tileRegionDrags, frameDropHighlight, patternExcludedFamiliesOf, newShapeStyle, onNodeTap, onColorBrushDoubleTap,
  cropPanNodeId, onCropPan, onCropZoom, lineToolMode, arcToolMode, arrangeMode, tileEditPatternId, polygonSides,
  colorBlendMode, colorBrushOpacity, colorScope, vectorEraser, onEditWhileDone, onUndo, onRedo,
  onLongPress, onLongPressMove, onLongPressUp,
  onSuperLongPress, onSuperLongPressMove, onSuperLongPressUp,
  ghosts,
  editableRegion, regionChrome, markers, forwardArrow, veiledIds, revealRect,
  onCanvasPointerDown,
  hostTools, openTrace, gestures, layers, surfaceHandle,
}: CanvasSurfaceProps) {
  // The scene as the canvas draws and hit-tests it: the veiled nodes
  // marked hidden for the session, the document itself untouched.
  const state = useMemo(() => veilState(session.state, veiledIds), [session.state, veiledIds]);
  // Read by the gesture handlers (created once) — plain refs, like the
  // camera's, so they never close over a stale render.
  const regionRef = useRef(editableRegion);
  regionRef.current = editableRegion;
  /** A world point pulled into the editable band, when there is one. */
  const regionClamp = (pt: [number, number]): [number, number] => {
    const r = regionRef.current;
    return r ? clampToRegion(pt, r) : pt;
  };
  /** …and, on release, pulled onto a dividing line's grid point when
   *  within tolerance of it. */
  const regionMagnet = (pt: [number, number]): [number, number] => {
    const r = regionRef.current;
    if (!r || r.magnetYs === undefined) return pt;
    return magnetToLines(pt, stateRef.current.gridLevel, r.magnetYs);
  };
  const containerRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const selectionOutlineRef = useRef<HTMLDivElement | null>(null);
  // How far the selection's ink hangs off its box (a bent text's bow), for
  // the gesture handlers that re-anchor the ring by hand. Written each
  // render from the resolved selection.
  const ringOutsetRef = useRef<{ top: number; bottom: number }>(NO_OUTSET);
  // The Tile tool's un-selected editing target's outline — a second chrome
  // element beside the selection's, so it takes the same zoom-inverse
  // property write on every zoom frame (applyLiveCamera).
  const tileEditOutlineRef = useRef<HTMLDivElement | null>(null);
  // …and the shape-hugging twin of it, worn by a shape whose pattern fill
  // is open. Its rings are screen px too, so it takes the same per-frame
  // zoom write.
  const patternEditOutlineRef = useRef<HTMLDivElement | null>(null);
  const drawPathRef = useRef<SVGPathElement | null>(null);
  const shapePathRef = useRef<SVGPathElement | null>(null);
  // Orbit copies of the in-flight draw/shape draft (canvas Symmetry).
  const draftMirrorPathRef = useRef<SVGPathElement | null>(null);
  // Color-tool paint overlay: the <g> hosting the painted-segment/-fill
  // preview paths and, above them, the gradient brush cursor. All mutated
  // imperatively during a stroke (see the paint helpers below).
  const paintLayerRef = useRef<SVGGElement | null>(null);
  const paintPathsRef = useRef(new Map<string, { el: SVGPathElement; color: RGBColor }>());
  const paintFrameCacheRef = useRef(new Map<string, ShapeStrokePreviewFrame>());
  // A recoloured SHAPE's preview does NOT ride the screen-space overlay: one
  // <svg> per painted shape, in the WORLD layer, inserted immediately after
  // that shape's own node element — so the fill and the seam colours a
  // stroke is laying preview at the shape's own place in the stack. In the
  // overlay they previewed above the entire scene, and a piece under its
  // neighbour jumped in front of it the moment the brush crossed it and
  // dropped back on release: the colour changed and the DRAWING changed
  // with it, which on a page of packed, overlapping pieces (Patchwork)
  // reads as the stack shuffling under the finger.
  //
  // Being in the world layer also means the camera is not frozen into them:
  // the layer's own CSS transform carries pan and zoom, so a preview stays
  // glued to its shape without a per-frame rewrite.
  const paintSvgLayersRef = useRef(new Map<string, SVGSVGElement>());
  // The Color brush's Eraser preview, per path it has cut: the node it hid
  // (and the visibility to give back), one preview <path> per colour drawn
  // in that node's own world-layer <svg> (ensureSvgPaintLayer), and the
  // cut revision they were last drawn from.
  const vectorErasePreviewRef = useRef(new Map<string, {
    node: HTMLElement; prevVisibility: string;
    paths: Map<string, SVGPathElement>; rev: number;
  }>());
  // Shapes whose own content markup a fill preview has re-mounted, and the
  // colour each is wearing — the dedupe (one re-mount per shape per colour,
  // not one per pointer move) and the restore list (clearPaintOverlay).
  const paintShapeFillsRef = useRef(new Map<string, RGBColor>());
  // The PUSH brush's own preview: one overlay path per warped subpath, and
  // the committed nodes those paths stand in for (id → the visibility to
  // restore). Push replaces geometry rather than colouring it, so the node
  // has to be out of the way while the overlay is up.
  const paintPushPathsRef = useRef(new Map<string, SVGPathElement>());
  const paintPushHiddenRef = useRef(new Map<string, string>());
  // Brushed text: one React root per touched text, inside the node's own
  // paint host, drawing the stroke's colours through the node layer's ink
  // pass (textPaintPreview.tsx) — never a second placement of the glyphs.
  const paintTextPreviewsRef = useRef(createTextPaintPreviews());
  // Live shape paint: one <canvas> per painted solid shape, mounted in the
  // shape's own paint host BETWEEN its fill svg and its strokes svg
  // (shapePaintDom.ts) — never a <foreignObject> in an svg, whose canvas is
  // a composited layer WebKit places on its own terms. A shape with no
  // committed paint is one svg, so the stroke splits it first (`split`) and
  // puts it back on clear; the committed canvas of a painted one is hidden
  // for the stroke (the working overlay is its clone plus the new dabs) and
  // the host's isolation forced on. clearPaintOverlay restores all of it.
  const paintNodeShapesRef = useRef(new Map<string, {
    el: HTMLCanvasElement; rev: number; host: HTMLElement;
    prevIsolation: string; committed: HTMLElement | null; split: ShapeSplit | null;
  }>());
  // Live image paint: one <canvas> per painted image, mounted INSIDE the node's
  // own clip div (its data-paint-host) rather than the screen-space overlay —
  // the overlay <svg> is an isolated group, so a mix-blend-mode there can
  // never composite against the photo and every non-normal mode read as
  // plain paint until the drop. The committed paint canvas is hidden for the
  // stroke (the working overlay is its clone plus the new dabs) and the
  // host's isolation forced on; clearPaintOverlay restores both.
  const paintNodeImgsRef = useRef(new Map<string, {
    el: HTMLCanvasElement; rev: number; host: HTMLElement;
    prevIsolation: string; committed: HTMLElement | null;
  }>());
  // Live image TINT (the Color brush): one flat colour div per recoloured
  // image, mounted in the same clip div for the same reason — the tint
  // composites against the photo with the layer's own blend mode, which the
  // screen-space overlay could not reproduce. The committed tint div is
  // hidden for the stroke (the preview stands in for it exactly), and the
  // host's isolation forced on; clearPaintOverlay restores both.
  const paintNodeTintsRef = useRef(new Map<string, {
    el: HTMLElement; color: RGBColor; host: HTMLElement;
    prevIsolation: string; committed: HTMLElement | null;
  }>());
  const paintCursorRef = useRef<{ group: SVGGElement; circle: SVGCircleElement } | null>(null);
  /** Whether a preview element already wears this colour — the one test the
   *  segment, fill and tint caches share, so a re-touch that changed
   *  nothing costs no DOM write. */
  const sameRGB = (a: RGBColor, b: RGBColor) => a.r === b.r && a.g === b.g && a.b === b.b;
  // Session-island live preview: ONE canvas in the world layer, sized to the
  // working set's tile bounds (world cells). `hidden` is the continued
  // island's committed canvas, display:none'd for the stroke. See
  // renderPaintObjectPreview.
  interface IslandPreview {
    el: HTMLCanvasElement; x: number; y: number; w: number; h: number;
    hidden: HTMLElement | null;
  }
  const paintIslandPreviewRef = useRef<IslandPreview | null>(null);
  // The GROW strokes' (push/blur) per-island previews, keyed by island id:
  // the same world-layer takeover as the session's, one per touched island —
  // their paint leaves the committed frame, which the island's own canvas
  // clips to. See renderPaintObjectPreview.
  const paintGrowPreviewsRef = useRef(new Map<string, IslandPreview>());
  // Committed island canvases the erase/blur preview wrote into, so a
  // cancelled stroke can redraw them from committed tiles.
  const paintTouchedCanvasesRef = useRef(new Map<string, HTMLCanvasElement>());
  const placeBoxRectRef = useRef<SVGRectElement | null>(null);
  const marqueeRectRef = useRef<SVGRectElement | null>(null);
  const dimsHudRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<CompositionRenderer | null>(null);
  const readySignaledRef = useRef(false);

  const stateRef = useRef(state);
  stateRef.current = state;
  // Both are read from handlers created once. The tool registry is static
  // per app; the open trace is the host's and may be absent.
  const hostToolsRef = useRef(hostTools);
  hostToolsRef.current = hostTools;
  const openTraceRef = useRef(openTrace);
  openTraceRef.current = openTrace;
  const liveCameraRef = useRef<Camera>(state.camera);
  const layerSlotRef = useRef<HTMLDivElement | null>(null);
  /** The one pointer a host's hook has claimed (canvasHooks.ts
   *  `GestureHooks`), and the selection its claim replaced, or null: the
   *  claimed pointer's moves and its end go to the hooks and the surface
   *  runs none of its own machinery for it. */
  const claimedPointerRef = useRef<{ pointerId: number; claim: PointerClaim } | null>(null);
  /** What a host layer has under the press being decided
   *  (`GestureHooks.beforePick`): a thing drawn in FRONT of the whole scene
   *  — DrawBot's bots and instruction tiles, its arena's border. Read by
   *  the selection grabs, which yield a press that landed on it
   *  (canvasTap's `frontItemTakesPress`), and by the select tool, which
   *  picks it rather than whatever the scene has behind it. Set once per
   *  press, before the tool branches, and cleared at the top of the next
   *  one so a press that returns early cannot leave a stale pick behind;
   *  null with no hook. */
  const pressFrontPickRef = useRef<string | null>(null);
  // Frame clip-rect (boundary) node ids. Frames are only selectable from the
  // Scene Outline, so a tap that lands on a frame's boundary rect (its
  // background surface) must not select it — hitTestAt filters these out.
  // Kept in a ref so the gesture handlers (created once) read the live set.
  const frameBoundaryIdsRef = useRef<Set<string>>(new Set());
  // frameId → boundary rect, mirrored from the render's memo so the drag
  // handlers can resolve the Figma-style drop-target frame per pointermove
  // without rebuilding the map.
  const frameRectsRef = useRef<ReturnType<typeof buildFrameRectMap>>(new Map());
  // The frame currently highlighted as the drag's drop target (its wrapper div
  // gets an outline via direct style mutation — no React state, 90 fps rule).
  const dropFrameIdRef = useRef<string | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const gestureRef = useRef<Gesture>({ mode: 'idle' });
  // Long-press radial menu state (Facet CompositionCanvas). The `fired`
  // refs mark an OPEN menu: while set, pointer moves and the release are
  // routed to the menu (via the onLongPress*/onSuperLongPress* props)
  // instead of the normal gesture handling.
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  const superLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const superLongPressFiredRef = useRef(false);
  // Multi-finger tap (undo/redo) tracking — see the MULTI_TAP_* constants and
  // the pointer handlers. `maxFingers` doubles as the "in a multi-touch
  // session" flag (0 when idle / single finger, reset when all fingers lift):
  // tracking is seeded on the transition into 2 fingers and read on the last
  // finger up. `startPos` snapshots each finger's touch-down point so per-finger
  // displacement can tell a stationary tap from a pan/pinch.
  const multiTapStartTimeRef = useRef(0);
  const multiTapMaxFingersRef = useRef(0);
  const multiTapMovedRef = useRef(false);
  const multiTapStartPosRef = useRef(new Map<number, { x: number; y: number }>());
  /** When the gesture's first finger landed, and when its last finger
   *  joined: a tap's fingers land together (MULTI_TAP_LAND_WINDOW). */
  const firstFingerDownAtRef = useRef(0);
  const multiTapLastLandAtRef = useRef(0);
  const propsRef = useRef({ inputLocked, onCanvasPointerDown, gestures, layers, session, currentColor, paintSessionRef, brushRadiusScale, onSelect, onSelectMany, onToggleSelect, onCommit, onCameraCommit, onAddText, onRequestPhoto, onRevertToArrange, onHostPlace, onCreatePattern, patternSubTool, patternRegionDrags, tileRegionDrags, frameDropHighlight, patternExcludedFamiliesOf, newShapeStyle, onNodeTap, onColorBrushDoubleTap, editingText, editingCaret, onCaretSeek, onSelectAllText, cropPanNodeId, onCropPan, onCropZoom, lineToolMode, arcToolMode, arrangeMode, tileEditPatternId, polygonSides, colorBlendMode, colorBrushOpacity, colorScope, vectorEraser, onEditWhileDone, onUndo, onRedo, onLongPress, onLongPressMove, onLongPressUp, onSuperLongPress, onSuperLongPressMove, onSuperLongPressUp });
  propsRef.current = { inputLocked, onCanvasPointerDown, gestures, layers, session, currentColor, paintSessionRef, brushRadiusScale, onSelect, onSelectMany, onToggleSelect, onCommit, onCameraCommit, onAddText, onRequestPhoto, onRevertToArrange, onHostPlace, onCreatePattern, patternSubTool, patternRegionDrags, tileRegionDrags, frameDropHighlight, patternExcludedFamiliesOf, newShapeStyle, onNodeTap, onColorBrushDoubleTap, editingText, editingCaret, onCaretSeek, onSelectAllText, cropPanNodeId, onCropPan, onCropZoom, lineToolMode, arcToolMode, arrangeMode, tileEditPatternId, polygonSides, colorBlendMode, colorBrushOpacity, colorScope, vectorEraser, onEditWhileDone, onUndo, onRedo, onLongPress, onLongPressMove, onLongPressUp, onSuperLongPress, onSuperLongPressMove, onSuperLongPressUp };

  // Live preview of a corner resize: the RESCALED node being dragged, or null
  // when idle. `previewResizedNode` runs the same geometry adapter the release
  // commits, so the object on screen tracks the selection box the whole way
  // down and lands on the drop with nothing to snap: an svg's segments stretch
  // live, a text re-wraps live, an image restretches live. It drives both the
  // node and the selection outline from one source of truth, so a re-render
  // can't clobber the outline (and no imperative box mutation can go stale).
  const [liveResize, setLiveResize] = useState<{ id: string; node: ResizedNode } | null>(null);

  // Live preview of an OFF-SQUARE group gesture: the world matrix each
  // affected leaf is drawn by mid-drag, or null when the gesture (or the
  // idle canvas) needs none. Every other gesture previews by writing one
  // CSS transform per element — but that transform composes ABOVE the
  // whole of what the leaf is drawn with, so a stretch that is not a
  // similarity reaches its STROKES: a line comes out heavier across the
  // pull than along it, then snaps back on the drop. These leaves re-draw
  // from the graph instead, at the very world matrix the release commits,
  // where `svgLocalGeometry` puts everything but the turn into the
  // vertices and the stroke keeps its world width (see applyGesturePreview).
  const [livePose, setLivePose] = useState<ReadonlyMap<string, Mat2D> | null>(null);

  /** Whether the frame resize in flight has gone off square, and so is
   *  drawing through `livePose` rather than through the clip wrapper's
   *  transform (applyFramePreview). Sticky until the drag is dropped. */
  const framePosedRef = useRef(false);

  // App-level "Dimensions" preference (View Settings). Read through a ref by
  // the gesture handlers, which are created once and never re-close over props.
  const { showDimensions } = useShowDimensions();
  const showDimensionsRef = useRef(showDimensions);
  showDimensionsRef.current = showDimensions;

  // App-level "Grid Snap" preference (View Settings), read through a ref for
  // the same reason. Drives arrange AND creation: a drag steps the moved
  // object's bbox origin gridline-to-gridline, a corner resize snaps the
  // cursor (the corner being dragged) to the nearest intersection, and every
  // drag-to-create box (line / rectangle / arc / circle / image / text) takes
  // its corners from grid intersections. Freehand draw ignores it entirely:
  // the stroke is the raw line the hand made, from its very first sample,
  // and nothing pulls any of it about.
  const { gridSnap } = useGridSnap();
  const gridSnapRef = useRef(gridSnap);
  gridSnapRef.current = gridSnap;

  // The camera's CURRENT zoom inverse (1 / world-layer scale), kept in step
  // with every camera apply whether or not any chrome is on screen — because
  // this is the number React writes onto a selection outline the moment one
  // mounts (ZOOM_INV_VAR below).
  //
  // It used to be the last value WRITTEN to the DOM, and the write only
  // happened when some chrome existed to write it to. So zooming with
  // nothing selected left it holding the old zoom, and the next selection's
  // ring and handles were drawn at the size that zoom called for — too big
  // or too small, and staying that way until something rewrote the property:
  // a pan, a committed state change, a reload. (That is the bug this pair of
  // refs is split to fix; the write guard is the second one.)
  const zoomInvRef = useRef(0);
  /** …and the last value actually SET on the chrome elements, so a pan —
   *  which moves the camera every frame but never changes the scale —
   *  doesn't restyle them. 0 is not a reachable inverse, so the first apply
   *  always writes. */
  const zoomInvWrittenRef = useRef(0);

  // The canvas-symmetry axes (screen space — see symmetryAxesScreen.ts):
  // the <g> the lines are written into, and the model they draw (written
  // each render), so the camera path below can re-anchor them imperatively.
  // They used to be DOM inside the world layer, whose bounds they widened
  // to thousands of px — a ~300 MB compositing layer that a zoom repainted
  // every frame until iOS killed the WebContent process.
  const symmetryAxesRef = useRef<SVGGElement | null>(null);
  const symmetryModelRef = useRef<SymmetryOverlayModel | null>(null);
  /** The symmetryModelKey the axes on screen were last written from; null
   *  after an imperative write, so the next render writes again. */
  const axesWrittenKeyRef = useRef<string | null>(null);

  // Paint's selection veil (screen space — see selectionOutline.ts). The
  // path element, and the world geometry its hole is cut from (written each
  // render), so the camera path below can re-anchor the hole imperatively:
  // pan/zoom mutate styles with no re-render, and a screen-space hole that
  // waited for React would swim off its object mid-gesture.
  /** The shaped hole is cut with a <mask>, and a mask is referenced by id
   *  — so the id has to be this canvas's own (a page can mount more than
   *  one, and a duplicate id would point every veil at the first). */
  const paintVeilMaskId = `cj-paint-veil-${React.useId()}`;
  const paintVeilPathRef = useRef<SVGPathElement | null>(null);
  /** The <g> the shaped hole's path hangs in — the mask's black — when the
   *  veil is cut to the object's own border instead of its box. */
  const paintVeilShapeRef = useRef<SVGGElement | null>(null);
  const paintVeilGeomRef = useRef<
    { box: CellBbox; angleDeg: number; shape: SelectionShapePath | null } | null
  >(null);

  // The editable region's chrome (screen space — regionChromeScreen.ts):
  // the <g> it is written into, and the model (written each render), so
  // the camera path below can re-anchor it imperatively like the axes.
  const regionGroupRef = useRef<SVGGElement | null>(null);
  const regionModelRef = useRef<Parameters<typeof writeRegionChrome>[3]>(null);
  // The faint targets on the line(s) a turn connects on: that line's grid
  // points at the page's grid level — the very points the magnet pulls a
  // stroke's end onto. Rebuilt only when the level or the lines change.
  const targetYs = regionChrome?.targetYs;
  const regionTargets = useMemo(
    () => (targetYs ?? []).flatMap((y) => lineGridPoints(state.gridLevel, y)),
    [targetYs, state.gridLevel],
  );
  regionModelRef.current = editableRegion && regionChrome
    ? {
      region: editableRegion,
      midlineYs: regionChrome.midline.ys,
      markers: markers ?? [],
      // Everything in view that is not the band, which the band's own
      // four sides say on their own: the region is the whole of it
      // (regionChromeScreen.regionVeilPath).
      veil: regionChrome.veil === 'outside',
      // …and the whole board outlined over the grey and the clear alike,
      // so a turn can see the shape of the thing it is a part of.
      board: regionChrome.board,
      targets: regionTargets,
    }
    : null;

  // …and the FORWARD ARROW beside it (regionChromeScreen.writeForwardArrow),
  // in a <g> of its own rather than the region's: the region writer clears
  // its group when there is no region, and a page can carry an arrow with
  // no region at all (DrawBot's bot look page is exactly that).
  const arrowGroupRef = useRef<SVGGElement | null>(null);
  const forwardArrowRef = useRef<ForwardArrow | null>(null);
  forwardArrowRef.current = forwardArrow ?? null;

  // The last settled tap / caret press on a scene node, for the text
  // double-tap (isTextDoubleTap): two quick taps on the text being edited
  // select its whole content.
  const lastNodeTapRef = useRef<{ id: string; time: number } | null>(null);
  /** The recolour brush's last stationary press on a pattern grid, and how
   *  deep the undo stack stood BEFORE its dab: the first half of the double
   *  tap that opens the grid (onColorBrushDoubleTap). Cleared by a press
   *  that lands anywhere else, so two taps on two grids are two dabs. */
  const lastColorTapRef = useRef<{ id: string; time: number; undoDepth: number } | null>(null);

  /** A connection point that has just appeared pops (§7.3) — and the
   *  finger is told, the way every other thing the editor accepts tells
   *  it. The count comes from the writer, which mints a circle only for
   *  a point that was not there a moment ago, so the two writers (the
   *  render effect and the camera frame) cannot ring it twice: whichever
   *  runs first mints, the other finds it already there. ONE tap however
   *  many points landed together — a stroke that connects at both ends
   *  is one thing happening, not two. */
  const notePoppedMarkers = (fresh: number): void => {
    if (fresh > 0) triggerHaptic('light');
  };

  // ── Camera application (direct style mutation; no re-render) ──────
  /** The symmetry axes, written for the current model through world
   *  transform `t` — the one writer the camera path and the model effect
   *  below share (writeSymmetryAxes reuses the <line>s in place). */
  const writeAxes = useCallback((t: WorldTransform, viewport: Viewport) => {
    const axes = symmetryAxesRef.current;
    if (!axes) return;
    const model = symmetryModelRef.current;
    writeSymmetryAxes(axisGroupOf(axes), model ? symmetryAxisSegments(model, t, viewport) : []);
  }, []);

  const applyLiveCamera = useCallback((camera: Camera) => {
    liveCameraRef.current = camera;
    const el = worldRef.current;
    const s = stateRef.current;
    if (el) {
      const t = worldLayerTransform(camera, s.viewport);
      el.style.transform = `translate(${t.translateX}px, ${t.translateY}px) scale(${t.scale})`;
      // Selection chrome inside this layer divides by the scale to stay a
      // constant screen size. It has to ride along here rather than be
      // computed at render: zoom moves through this path with no re-render,
      // so a rendered number would lag the gesture and snap on commit. The
      // property lives on the OUTLINE element, not the world: it is the
      // outline's own subtree that reads it, and a custom property written
      // on the world restyled every node in the scene on every zoom frame.
      // The guard — a transform write is compositor-only, this one is not.
      const zoomInv = t.scale > 0 ? 1 / t.scale : 1;
      // Always, even with nothing selected: a chrome element that mounts
      // later reads this at its first render.
      zoomInvRef.current = zoomInv;
      const outline = selectionOutlineRef.current;
      const tileOutline = tileEditOutlineRef.current;
      const patternOutline = patternEditOutlineRef.current;
      if ((outline || tileOutline || patternOutline) && zoomInv !== zoomInvWrittenRef.current) {
        zoomInvWrittenRef.current = zoomInv;
        outline?.style.setProperty(ZOOM_INV_VAR, String(zoomInv));
        tileOutline?.style.setProperty(ZOOM_INV_VAR, String(zoomInv));
        patternOutline?.style.setProperty(ZOOM_INV_VAR, String(zoomInv));
      }
      // The paint veil is screen-space: its lit hole must chase the camera
      // by hand, like the chrome above.
      const veil = paintVeilPathRef.current;
      const veilShape = paintVeilShapeRef.current;
      const geom = paintVeilGeomRef.current;
      if (veilShape && geom?.shape) {
        // The shaped hole: one transform re-maps the whole path, so this
        // costs the same per frame as rewriting the box hole's `d`.
        veilShape.setAttribute(
          'transform',
          paintDimVeilShapeTransform(geom.box, t, geom.angleDeg, geom.shape.units),
        );
      } else if (veil && geom) {
        veil.setAttribute('d', paintDimVeilPath(s.viewport, geom.box, t, geom.angleDeg));
      }
      // So must the editable region's veil, midline and markers (screen
      // space too — regionChromeScreen.ts)…
      notePoppedMarkers(
        writeRegionChrome(regionGroupRef.current, s.viewport, t, regionModelRef.current),
      );
      // …and the forward arrow, which is screen space for the same reason.
      writeForwardArrow(arrowGroupRef.current, t, forwardArrowRef.current);
      // …and the symmetry axes, for the same reason.
      writeAxes(t, s.viewport);
    }
    rendererRef.current?.render({ ...s, camera });
  }, [writeAxes]);

  // The region chrome, written for the committed camera on every render
  // that could change it — the model, the viewport, the camera.
  useEffect(() => {
    const t = worldLayerTransform(state.camera, state.viewport);
    notePoppedMarkers(writeRegionChrome(
      regionGroupRef.current, state.viewport, t, regionModelRef.current,
    ));
    writeForwardArrow(arrowGroupRef.current, t, forwardArrowRef.current);
  }, [state.camera, state.viewport, editableRegion, regionChrome, markers, regionTargets, forwardArrow]);

  // Declared ahead of the resync effect below, which must know whether an
  // avoid-glide currently owns the camera.
  const cameraTweenRef = useRef<TweenHandle | null>(null);

  // Committed camera / state changed → resync the live transform + GL.
  // While an avoid-glide is mid-flight the tween owns the camera: a live
  // text edit commits state per keystroke, and snapping to the committed
  // camera for one frame each time would shimmy the glide. The tween
  // commits its own target on completion (and a touch cancels-and-commits),
  // so the committed camera catches up either way.
  useEffect(() => {
    if (cameraTweenRef.current) return;
    applyLiveCamera(state.camera);
  }, [state, applyLiveCamera]);

  // ── Camera avoid: glide the selection clear of bottom UI ──────────
  // When the shell reports bottom-anchored UI covering the canvas
  // (avoidBottomPx: the object properties panel, growing when one of its
  // taller submenus opens) and the selection's bottom edge is under it,
  // tween the camera so the object sits just above the UI — an animation,
  // not a pop. One-directional by design: the UI closing never scrolls back
  // (the object is visible either way). A touch cancels the glide and
  // commits the camera where it stands, so the finger always wins.
  const cancelCameraTween = (commit: boolean) => {
    if (!cameraTweenRef.current) return;
    cameraTweenRef.current.cancel();
    cameraTweenRef.current = null;
    if (commit) propsRef.current.onCameraCommit(liveCameraRef.current);
  };
  useEffect(() => () => cancelCameraTween(false), []); // eslint-disable-line react-hooks/exhaustive-deps
  // Selection identity — the effect re-aims on a NEW selection under an open
  // panel, but not on unrelated state edits (a paint stroke must not scroll).
  const avoidSelectionKey = `${session.selectedId ?? ''}|${session.selectedIds.join(',')}`;
  // Selection GEOMETRY — a live text edit reflows and re-anchors the box per
  // keystroke, and the glide must follow so the growing text stays just
  // above the keyboard. Keyed on the bbox alone (not the whole state), so a
  // manual pan that tucks the selection under the UI is respected, never
  // fought.
  const avoidBbox = useMemo(() => (
    session.selectedIds.length >= 2
      ? resolveMultiSelectionBox(state, session.selectedIds, session.hostDoc)
      : resolveSelectionBox(state, session.selectedId)?.bbox ?? null
  ), [state, session.hostDoc, session.selectedId, session.selectedIds]);
  const avoidBboxKey = avoidBbox
    ? `${avoidBbox.cellX},${avoidBbox.cellY},${avoidBbox.cellWidth},${avoidBbox.cellHeight}`
    : '';
  useEffect(() => {
    const px = avoidBottomPx ?? 0;
    if (px <= 0) return;
    const s = stateRef.current;
    const sel = propsRef.current.session;
    const bbox = sel.selectedIds.length >= 2
      ? resolveMultiSelectionBox(s, sel.selectedIds, sel.hostDoc)
      : resolveSelectionBox(s, sel.selectedId)?.bbox ?? null;
    if (!bbox) return;
    const from = liveCameraRef.current;
    const target = cameraAvoidingBottomInset(from, s.viewport, bbox, px, avoidTopPx ?? 0);
    if (!target) return;
    cancelCameraTween(false);
    cameraTweenRef.current = tween({
      duration: 260,
      ease: cubicOut,
      // Vertical-only pan: zoom and offsetX are target's own (unchanged).
      onUpdate: (t) => applyLiveCamera({ ...target, offsetY: mix(from.offsetY, target.offsetY, t) }),
      onComplete: () => {
        cameraTweenRef.current = null;
        propsRef.current.onCameraCommit(target);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avoidBottomPx, avoidTopPx, avoidSelectionKey, avoidBboxKey, applyLiveCamera]);

  // ── Reveal: glide the camera to a rect the shell asks for ─────────
  // The same tween as the avoid-glide, aimed at a rect instead of away
  // from the bottom UI, and a full frame rather than a vertical nudge:
  // the point a refused Creature turn is about could be anywhere on the
  // board, at any zoom (§7.3). Keyed on the ASK, not the rect — pressing
  // *I'm Done* again after panning away must fly again, and a render for
  // any other reason must not.
  /**
   * Fly the camera to `target` over `durationMs` and commit it on arrival,
   * in the avoid-glide's one tween slot — so a touch cancels-and-commits
   * it the same way, and a host raster waits it out (`isGestureBusy`).
   *
   * Zoom travels in LOG space: linear zoom races away at the start and
   * crawls at the end when the two ends differ by a factor, which a glide
   * that reframes the page always does.
   */
  const glideCameraTo = (target: Camera, durationMs: number) => {
    const from = liveCameraRef.current;
    cancelCameraTween(false);
    cameraTweenRef.current = tween({
      duration: durationMs,
      ease: cubicOut,
      onUpdate: (t) => applyLiveCamera({
        offsetX: mix(from.offsetX, target.offsetX, t),
        offsetY: mix(from.offsetY, target.offsetY, t),
        zoom: Math.exp(mix(Math.log(from.zoom), Math.log(target.zoom), t)),
      }),
      onComplete: () => {
        cameraTweenRef.current = null;
        propsRef.current.onCameraCommit(target);
      },
    });
  };

  const revealKey = revealRect?.key ?? '';
  useEffect(() => {
    if (revealKey === '') return;
    if (!revealRect) return;
    const s = stateRef.current;
    if (s.viewport.width <= 0 || s.viewport.height <= 0) return;
    // An ask that arrives while a finger is already down is dropped: the
    // finger wins, and an unasked-for flight under it is the one thing a
    // glide must never do. (A finger that lands DURING one cancels it and
    // commits the camera where it stands — `cancelCameraTween` on the
    // press. This is the other end of the same rule.)
    if (gestureRef.current.mode !== 'idle' || pointersRef.current.size > 0) return;
    // The box becomes a camera HERE, which is the point of taking a box:
    // the fit and the chrome insets are the canvas's knowledge, and a host
    // computing its own camera was framing without them — a plant could
    // land under the toolbar.
    glideCameraTo(computeFrameCellBboxCamera(
      s.viewport, revealRect.bbox, FRAME_OBJECT_FIT,
      { top: avoidTopPx ?? 0, bottom: avoidBottomPx ?? 0 },
    ), revealRect.durationMs ?? REVEAL_GLIDE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealKey, applyLiveCamera]);

  // ── Viewport tracking ─────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const notify = () => {
      const rect = el.getBoundingClientRect();
      containerRectRef.current = { left: rect.left, top: rect.top };
      if (rect.width > 0 && rect.height > 0) {
        onViewportChange(makeViewport(rect.width, rect.height));
      }
    };
    notify();
    const ro = new ResizeObserver(notify);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Image blob object URLs (cached per imageId, revoked on unmount) ─
  const urlCacheRef = useRef(new Map<string, string>());
  const imageUrls = useMemo(() => {
    const cache = urlCacheRef.current;
    const blobs = state.imageBlobs ?? {};
    const urls = new Map<string, string>();
    for (const img of state.images ?? []) {
      if (urls.has(img.imageId)) continue;
      let url = cache.get(img.imageId);
      if (!url) {
        const bytes = blobs[img.imageId];
        if (!bytes) continue;
        try {
          url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: img.mimeType }));
          cache.set(img.imageId, url);
        } catch {
          continue; // non-browser environment
        }
      }
      urls.set(img.imageId, url);
    }
    return urls;
  }, [state.images, state.imageBlobs]);
  useEffect(() => () => {
    for (const url of urlCacheRef.current.values()) {
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    }
    urlCacheRef.current.clear();
    // The derived draw levels go with the page (imageDecodeLevels): they are
    // pure derived data, and the next page has no use for them.
    purgeDecodeLevels();
  }, []);

  // ── Which source each image draws from, re-decided on camera SETTLE ─
  //
  // What the compositor allocates for a drawn photo is width × height × 4
  // off the SOURCE's pixels, not the box it is drawn in — so a photo in a
  // collage cell drawn from its 1024 px display copy costs 4 MB of bitmap
  // where 256 px would be indistinguishable and cost 256 KB. And a photo
  // the camera cannot see costs the same 4 MB as one it can.
  //
  // Both are settled work, never per-frame: a level is a re-encode and a src
  // swap is a decode, and doing either mid-pinch would trade away the very
  // frames this exists to protect. See @/editor/imageDrawLevels.
  const [drawPlans, setDrawPlans] = useState<Map<string, ImageDrawPlan>>(() => new Map());
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleDrawLevels = useCallback(() => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      const s = stateRef.current;
      const images = s.images ?? [];
      if (images.length === 0) return;
      const plans = planImageDraws(images, liveCameraRef.current, s.viewport);
      setDrawPlans(plans);
      // …and make what the plan asked for; one re-render when any lands.
      void warmDrawLevels(plans, images, s.imageBlobs ?? {}).then((landed) => {
        if (landed) setDrawPlans(new Map(plans));
      });
    }, DRAW_LEVEL_SETTLE_MS);
  }, []);
  // A settle after the camera stops moving, and after the scene changes
  // (a photo placed, a node resized — both change what is drawn how large).
  useEffect(settleDrawLevels, [settleDrawLevels, state.camera, state.images, state.viewport]);
  useEffect(() => () => { if (settleTimerRef.current) clearTimeout(settleTimerRef.current); }, []);
  /** The source one image node draws from: its settled level when made,
   *  the display copy until then, and nothing at all when culled. */
  const srcForNode = useCallback(
    (node: ImageObject) => levelUrlFor(drawPlans.get(node.id), imageUrls.get(node.imageId)),
    [drawPlans, imageUrls],
  );

  // ── GL boot (Phase 0 wiring kept) ─────────────────────────────────
  const onContextCreate = useCallback((gl: ExpoWebGLRenderingContext) => {
    rendererRef.current = new CompositionRenderer(gl);
    rendererRef.current.render({ ...stateRef.current, camera: liveCameraRef.current });
    if (!readySignaledRef.current) {
      readySignaledRef.current = true;
      // Dismisses the native splash overlay (WebViewShell waits for READY).
      openTraceRef.current?.mark('glReady');
      signalReady();
      // …and the background work that was told to wait for this frame
      // (the editor package’s afterReady.ts).
      pageIsReady();
      // …and hands native the marks of everything that led here, so the
      // whole open prints as one table (docs/response_open_speed.md Phase 0).
      openTraceRef.current?.report();
    }
  }, []);

  // ── Gesture helpers ───────────────────────────────────────────────
  // The container's screen origin, read once per resize and per gesture
  // start rather than per pointer move: getBoundingClientRect on every move
  // forced a layout on every frame of a pan or zoom (Web Inspector: ~40
  // forced layouts a second), and the container never moves mid-gesture.
  const containerRectRef = useRef<{ left: number; top: number } | null>(null);
  const localPoint = (e: { clientX: number; clientY: number }) => {
    let rect = containerRectRef.current;
    if (!rect) {
      const r = containerRef.current?.getBoundingClientRect();
      rect = { left: r?.left ?? 0, top: r?.top ?? 0 };
      containerRectRef.current = rect;
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  /** Whether a floating control sits within a tap of `pt` (container-local).
   *  The samples are in CLIENT space, so the container's own offset goes back
   *  on — the same rect localPoint took it off with. */
  const overlayNearTap = (pt: { x: number; y: number }) => {
    const rect = containerRectRef.current;
    if (!rect) return false;
    return overlayNearPoint(
      pt.x + rect.left, pt.y + rect.top,
      containerRef.current,
      TAP_EXCLUSION_RADIUS,
      (x, y) => document.elementFromPoint(x, y),
    );
  };

  const hitTestAt = (pt: { x: number; y: number }) => {
    const s = { ...stateRef.current, camera: liveCameraRef.current };
    const cell = screenToWorld(pt.x, pt.y, s.camera, s.viewport);
    // The pixel walk, with a plain group answering for its whole box
    // (groupHit.ts) — the eyedropper below keeps the literal pixel stack.
    const hit = findSelectableAtCell(s, cell.cellX, cell.cellY);
    // A frame's boundary rect (its background) is not tap-selectable — frames
    // are chosen from the Scene Outline only. The boundary is back-most, so
    // there's nothing selectable behind it: treat it as an empty-canvas hit.
    if (hit && frameBoundaryIdsRef.current.has(hit.id)) return null;
    return hit;
  };

  /** What is DRAWN under the point, and nothing the pick reads off a box:
   *  a host layer's reading (`CanvasSurfaceHandle.pixelHitAt`), for a
   *  placing tool that steps aside for a tap ON an object and still
   *  builds in a wiggly line's empty box. The selection's own walk is
   *  `hitTestAt` above; the two differ only in what they ask the engine
   *  for, which is why the canvas keeps both rather than a host
   *  re-implementing one (the plan's §4.3). */
  const pixelHitTestAt = (pt: { x: number; y: number }) => {
    const s = { ...stateRef.current, camera: liveCameraRef.current };
    const cell = screenToWorld(pt.x, pt.y, s.camera, s.viewport);
    const hit = findSceneObjectAtCell(s, cell.cellX, cell.cellY, { pixelsOnly: true });
    if (hit && frameBoundaryIdsRef.current.has(hit.id)) return null;
    return hit;
  };

  // The handle a layer over the surface reads per frame (canvasHooks.ts):
  // filled once the slot exists, cleared on unmount. Read per FRAME, never
  // per render — the live camera is the one the surface's own two-finger
  // gesture is moving, ahead of the committed state.camera.
  useEffect(() => {
    const handle = surfaceHandle;
    if (!handle) return undefined;
    handle.current = {
      getLiveCamera: () => liveCameraRef.current,
      getViewport: () => stateRef.current.viewport,
      pixelHitAt: (x, y) => pixelHitTestAt({ x, y })?.id ?? null,
      layerSlot: layerSlotRef.current,
    };
    return () => { handle.current = null; };
    // The ref identity is the dependency; the getters read live refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaceHandle]);

  // ── Long-press radial menu timers (Facet CompositionCanvas) ───────
  const clearLongPressTimers = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (superLongPressTimerRef.current) {
      clearTimeout(superLongPressTimerRef.current);
      superLongPressTimerRef.current = null;
    }
  };

  /** Start the regular long-press timer. Armed when a press grabs a node
   *  (the 'drag' gesture), a whole multi-selection ('multiDrag') or a rig's
   *  joint ('rigPose'); any movement at all cancels it. On fire the grab is
   *  over — the menu owns the touch — so a gesture that holds live state of
   *  its own passes `abandon` to unwind it first. */
  const armLongPress = (pt: { x: number; y: number }, abandon?: () => void) => {
    if (!propsRef.current.onLongPress) return;
    longPressFiredRef.current = false;
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      longPressFiredRef.current = true;
      // Cancel the super long press timer — the regular long press menu
      // is now open and must not be replaced by the super menu.
      if (superLongPressTimerRef.current) {
        clearTimeout(superLongPressTimerRef.current);
        superLongPressTimerRef.current = null;
      }
      abandon?.();
      gestureRef.current = { mode: 'idle' };
      propsRef.current.onLongPress?.(pt.x, pt.y);
    }, LONG_PRESS_MS);
  };

  /** Start the super long press timer. Armed on EVERY press under the
   *  arrange/line/arc tools — locked objects are invisible to the normal
   *  hit-test (so the press reads as empty canvas), which is why it does
   *  its own ignoreLock hit-test when it fires and only opens on a
   *  locked node. */
  const armSuperLongPress = (pt: { x: number; y: number }) => {
    if (!propsRef.current.onSuperLongPress) return;
    superLongPressFiredRef.current = false;
    if (superLongPressTimerRef.current) clearTimeout(superLongPressTimerRef.current);
    superLongPressTimerRef.current = setTimeout(() => {
      superLongPressTimerRef.current = null;
      // Regular long-press menu already opened; never replace it.
      if (longPressFiredRef.current) return;
      const s = { ...stateRef.current, camera: liveCameraRef.current };
      const cell = screenToWorld(pt.x, pt.y, s.camera, s.viewport);
      const hit = findSceneObjectAtCell(s, cell.cellX, cell.cellY, { ignoreLock: true });
      // Frames are chosen from the Scene Outline only — a boundary rect
      // is not a punch-through target, same as it is not a tap target.
      if (!hit || frameBoundaryIdsRef.current.has(hit.id)) return;
      // Only fire on locked objects.
      if (!isItemLocked(s, hit.id)) return;
      superLongPressFiredRef.current = true;
      longPressFiredRef.current = false;
      gestureRef.current = { mode: 'idle' };
      propsRef.current.onSuperLongPress?.(pt.x, pt.y, hit.id, hit.kind);
    }, SUPER_LONG_PRESS_MS);
  };

  // Clear any pending long-press timers on unmount.
  useEffect(() => () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    if (superLongPressTimerRef.current) clearTimeout(superLongPressTimerRef.current);
  }, []);

  const nodeEl = (id: string): HTMLElement | null =>
    worldRef.current?.querySelector(`[data-node-id="${CSS.escape(id)}"]`) ?? null;

  const frameEl = (id: string): HTMLElement | null =>
    worldRef.current?.querySelector(`[data-frame-id="${CSS.escape(id)}"]`) ?? null;

  /** Does a HOST element stand in for this node in a live preview
   *  (`CanvasLayers.previewStandIn`)? A node whose layer drew nothing has
   *  no element of its own, so writing a transform on it writes on
   *  nothing: Sol's plant draws every leaf it absorbs as one composite,
   *  and a drag of the plant moves that one element. */
  const standInFor = (id: string) => propsRef.current.layers?.previewStandIn?.(id);

  /**
   * How a gesture's members divide: the ones with elements of their own,
   * and ONE driving member per host stand-in (the first of them in the
   * gesture's own id list, whose previewed pose the stand-in is written
   * from). Resolved once per gesture — `ids` is the gesture's own array,
   * so its identity is the cache key — because a plant at its cap would
   * otherwise cost two thousand lookups and two thousand style writes per
   * frame, which is the whole thing a composite exists to avoid.
   */
  const previewTargetsRef = useRef<{
    ids: readonly string[];
    own: string[];
    standIns: { standIn: HostPreviewStandIn; driverId: string }[];
  } | null>(null);
  const previewTargets = (ids: readonly string[]) => {
    const hit = previewTargetsRef.current;
    if (hit && hit.ids === ids) return hit;
    const own: string[] = [];
    const standIns: { standIn: HostPreviewStandIn; driverId: string }[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      const standIn = standInFor(id);
      if (!standIn) { own.push(id); continue; }
      if (seen.has(standIn.key)) continue;
      seen.add(standIn.key);
      standIns.push({ standIn, driverId: id });
    }
    const out = { ids, own, standIns };
    previewTargetsRef.current = out;
    return out;
  };

  /** The frame's border overlay — a sibling of its clip wrapper (so an
   *  outside/center stroke isn't cropped), which therefore has to be
   *  transformed alongside it during a live frame resize. */
  const frameBorderEl = (id: string): HTMLElement | null =>
    worldRef.current?.querySelector(`[data-frame-border-id="${CSS.escape(id)}"]`) ?? null;

  /** Outline the frame a drag would drop its node into (Figma's drop-target
   *  highlight), or clear it with null. Idempotent per frame id; the width
   *  counters the world scale (screenPx) so it reads 2px on screen at any
   *  zoom, like every other piece of selection chrome. */
  const setDropHighlight = (id: string | null) => {
    if (dropFrameIdRef.current === id) return;
    if (dropFrameIdRef.current) {
      const prev = frameEl(dropFrameIdRef.current);
      if (prev) {
        prev.style.removeProperty('outline-width');
        prev.style.removeProperty('outline-style');
        prev.style.removeProperty('outline-color');
      }
    }
    dropFrameIdRef.current = id;
    if (id) {
      const el = frameEl(id);
      if (el) {
        el.style.setProperty('outline-width', screenPx(SELECTION_BORDER_PX));
        el.style.setProperty('outline-style', 'solid');
        el.style.setProperty('outline-color', SELECTION_COLOR);
      }
    }
  };

  // Did `pt` (screen px) land on a corner handle of the selection? Returns the
  // grabbed corner + the box/angle to seed a resize gesture, and `frameId` when
  // the selection is a frame (so the release commits a group scale). The
  // corners are the ROTATED bbox corners (local-axis offsets), projected to
  // screen — so grabbing works at any free rotation. Eligibility comes from
  // resolveSelectionBox, the same resolver that decides whether the handles are
  // drawn, so the grab can never be offered where it would be refused.
  /** The selection tool in its Move mode: no scaling, no turning — the
   *  two-finger manipulations below stand down (and, with Rotate, the
   *  corner grabs — noScale — and the handles: see the outline JSX). */
  const moveOnly = () =>
    arrangeModeMoveOnly(propsRef.current.session.activeTool, propsRef.current.arrangeMode);
  /** …and in its Rotate mode: only turning — a one-finger press selects
   *  and nothing drags (the slider and the two-finger twist turn it). */
  const rotateOnly = () =>
    arrangeModeRotateOnly(propsRef.current.session.activeTool, propsRef.current.arrangeMode);
  const noScale = () =>
    arrangeModeNoScale(propsRef.current.session.activeTool, propsRef.current.arrangeMode);
  /** …and in its Scale mode: the handles and the grabs are Select's, and
   *  every one of them holds the object's aspect. */
  const uniformScale = () =>
    arrangeModeUniformScale(propsRef.current.session.activeTool, propsRef.current.arrangeMode);

  const hitSelectionCorner = (
    pt: { x: number; y: number },
  ): { sign: CornerSign; angleDeg: number; oldBbox: CellBbox; frameId: string | null;
       freeAxis: 'x' | 'y' | null } | null => {
    if (noScale()) return null;
    const sel = resolveSelectionBox(stateRef.current, propsRef.current.session.selectedId);
    if (!sel || !sel.resizable) return null;
    const { bbox: oldBbox, angleDeg, frameId, freeAxis } = sel;
    const cam = liveCameraRef.current;
    const vp = stateRef.current.viewport;
    const r2 = HANDLE_HIT_RADIUS_PX * HANDLE_HIT_RADIUS_PX;
    for (const corner of RESIZE_CORNERS) {
      const cell = bboxCornerCell(oldBbox, angleDeg, corner.sign);
      const scr = worldToScreen(cell.x, cell.y, cam, vp);
      const ddx = scr.x - pt.x;
      const ddy = scr.y - pt.y;
      if (ddx * ddx + ddy * ddy <= r2) {
        return { sign: corner.sign, angleDeg, oldBbox, frameId, freeAxis };
      }
    }
    return null;
  };

  // ── Selection-first press routing ─────────────────────────────────
  // A selection is manipulable under EVERY armed tool, not just 'arrange':
  // tapping an object no longer disarms the tool (see `select`), so the
  // handles and the box it draws have to answer to the finger whatever is
  // armed — otherwise the affordance is on screen with nothing behind it.
  // Each helper claims the gesture and returns true, or leaves it alone and
  // returns false so the tool's own branch continues.

  /** Grab a corner handle of the selection: resize with the opposite corner
   *  pinned. Offered under every tool — the handles are drawn from
   *  resolveSelectionBox whenever something resizable is selected, whatever
   *  is armed. Arms NO long-press timers (Facet: the scale branch returns
   *  before them). */
  const beginCornerResize = (pt: { x: number; y: number }) => {
    const corner = hitSelectionCorner(pt);
    if (!corner) return false;
    const targetId = propsRef.current.session.selectedId!;
    gestureRef.current = {
      mode: 'resize', targetId, frame: corner.frameId !== null,
      sign: corner.sign, angleDeg: corner.angleDeg, oldBbox: corner.oldBbox, changed: false,
      // Frames scale per-axis through their group transform, so nothing
      // constrains their aspect; requiresUniformScale answers false for a
      // group id anyway (it resolves leaves).
      // A CURVE answers false — an arc as much as a closed circle. Either
      // may be pulled off its aspect, snap or no snap, the same rule
      // creation follows (which squares nothing either); the rescale sheds
      // the arcs into the polyline of the same curve on the way past, so
      // the stretch lands on a true ellipse (see requiresUniformScale).
      // …and in Scale mode EVERY object insists, which is the whole of
      // what that mode is.
      uniform: uniformScale() || requiresUniformScale(stateRef.current, targetId),
      freeAxis: corner.freeAxis,
    };
    return true;
  };

  /** Grab a corner handle of a GROUP selection: resize the whole group with
   *  the opposite corner of the combined box pinned. Gated exactly like the
   *  drawn handles (canResizeMultiSelection), so the grab is never accepted
   *  where the affordance isn't shown. */
  const beginMultiCornerResize = (pt: { x: number; y: number }) => {
    const s = stateRef.current;
    const ids = propsRef.current.session.selectedIds;
    if (noScale() || ids.length < 2 || !canResizeMultiSelection(s, ids)) return false;
    const frame = resolveMultiSelectionFrame(s, ids, propsRef.current.session.hostDoc);
    if (!frame) return false;
    const cam = liveCameraRef.current;
    const r2 = HANDLE_HIT_RADIUS_PX * HANDLE_HIT_RADIUS_PX;
    for (const corner of RESIZE_CORNERS) {
      // The corners sit on the box as drawn — turned with a bound group.
      const cell = bboxCornerCell(frame.bbox, frame.angleDeg, corner.sign);
      const scr = worldToScreen(cell.x, cell.y, cam, s.viewport);
      const ddx = scr.x - pt.x;
      const ddy = scr.y - pt.y;
      if (ddx * ddx + ddy * ddy <= r2) {
        gestureRef.current = {
          mode: 'multiResize', ids: [...ids], oldBox: frame.bbox, angleDeg: frame.angleDeg,
          sign: corner.sign, uniform: uniformScale(), changed: false,
        };
        return true;
      }
    }
    return false;
  };

  /** Grab a whole multi-selection: a press inside the combined bounding box
   *  moves every member together (it owns the box outright, over a member or
   *  the empty space between members alike). Held still, that same press
   *  opens the radial menu on the WHOLE selection, exactly as a held single
   *  grab does — its actions (copy / lock / delete / color) all have multi
   *  forms. No super long press: punching through to one locked node would
   *  fight the selection the box represents. */
  /** The gesture a grab of `id` should start when the leaf belongs to a
   *  group: a multiDrag of the whole group — the CANVAS never moves a group
   *  member alone. Null for loose leaves and frame members (they drag as
   *  themselves). The gesture captures its target synchronously, so this
   *  mirrors the promotion `select` applies to the selection itself. */
  /** The turn a node's selection box is DRAWN at — the same reading the
   *  render and the release re-anchor take (resolveSelectionBox), so a live
   *  drag cannot disagree with either about how the box stands. Read ONCE
   *  per gesture: a drag holds the turn still, and the resolver walks the
   *  scene graph. */
  const drawnSelectionAngle = (id: string) =>
    resolveSelectionBox(stateRef.current, id)?.angleDeg ?? 0;

  const groupDragGesture = (
    state: CompositionState, id: string, pt: { x: number; y: number },
  ) => {
    // The whole UNIT a tap on `id` selects — its scene leaves AND the
    // host's own items riding the same group (`selectionUnitIds`, stage 3's
    // `HostItems`): a group of shapes and DrawBot's bots drags as one, from
    // a press on any of it. With no items adapter installed this IS
    // `groupSelectionIds`, which it falls back to.
    const { hostDoc } = propsRef.current.session;
    const ids = selectionUnitIds({ state, hostDoc }, id);
    const box = ids ? resolveMultiSelectionBox(state, ids, hostDoc) : null;
    // The turn the outline is drawn at, so the live preview can put it back
    // on — a bound group off the quarters wears a rotated box.
    const frame = ids ? resolveMultiSelectionFrame(state, ids, hostDoc) : null;
    return ids && box
      ? {
          mode: 'multiDrag' as const, ids, box, angleDeg: frame?.angleDeg ?? 0,
          startX: pt.x, startY: pt.y, dx: 0, dy: 0, moved: false,
        }
      : null;
  };

  /** Has the selection's box swallowed the screen? Then it claims no
   *  ONE-FINGER press: the press belongs to the armed tool, so a box with no
   *  page around it still leaves somewhere to draw (canvasTap's
   *  selectionSwallowsCanvas). The two-finger TWIST is not capped — it turns
   *  the selection at every zoom level, and the capsule's Done is the exit
   *  that does not depend on the box's size. Asked of the LIVE camera, so
   *  zooming out hands the claim back the moment there is page around the
   *  selection again. */
  const selectionSwallowsScreen = (frame: { bbox: CellBbox; angleDeg: number }) =>
    selectionSwallowsCanvas(
      frame.bbox,
      frame.angleDeg,
      (x, y) => screenToWorld(x, y, liveCameraRef.current, stateRef.current.viewport),
      stateRef.current.viewport,
    );

  const beginMultiDrag = (pt: { x: number; y: number }) => {
    const ids = propsRef.current.session.selectedIds;
    if (rotateOnly() || ids.length < 2) return false;
    // A host item drawn in FRONT of the whole scene keeps the press, even
    // inside the box of a selection behind it (canvasTap's
    // `frontItemTakesPress`) — unless it is itself part of that selection.
    if (frontItemTakesPress(pressFrontPickRef.current, ids)) return false;
    const { hostDoc } = propsRef.current.session;
    const frame = resolveMultiSelectionFrame(stateRef.current, ids, hostDoc);
    const box = resolveMultiSelectionBox(stateRef.current, ids, hostDoc);
    if (!frame || !box) return false;
    const cell = screenToWorld(pt.x, pt.y, liveCameraRef.current, stateRef.current.viewport);
    // The box as drawn: a bound group's is turned with it.
    if (!selectionBoxHitsCell(frame.bbox, frame.angleDeg, cell.cellX, cell.cellY)) return false;
    // …and unless the box IS the screen, where grabbing it would leave
    // nothing to draw on. A press on a member still drags the whole group
    // (beginHitSelectDrag promotes to it). Asked LAST: it samples the
    // viewport, where everything above is a point test, and a press outside
    // the box has already been answered by then.
    if (selectionSwallowsScreen(frame)) return false;
    armLongPress(pt);
    gestureRef.current = {
      mode: 'multiDrag', ids: [...ids], box, angleDeg: frame.angleDeg,
      startX: pt.x, startY: pt.y, dx: 0, dy: 0, moved: false,
    };
    return true;
  };

  /** Grab the selected node itself: a press on the box it draws moves it,
   *  whatever tool is armed (see toolYieldsToSelection for who asks). The
   *  BOX decides, not the hit-test — a press in the empty space inside a
   *  drawn line's box would otherwise fall through to whatever sits behind
   *  it and the shape tool would draw over the object being grabbed
   *  (selectionOwnsPress; an object in FRONT still keeps the press).
   *
   *  Locked / hidden nodes are refused, matching the hit-test's own skips,
   *  and so are frame selections — a frame is a group, and this gesture
   *  moves one node. */
  const beginSelectedNodeDrag = (
    pt: { x: number; y: number }, hit: { id: string } | null,
  ) => {
    const s = stateRef.current;
    const id = propsRef.current.session.selectedId;
    if (!id || rotateOnly()) return false;
    const sel = resolveSelectionBox(s, id);
    if (!sel || sel.frameId !== null) return false;
    if (isItemLocked(s, id) || isItemHidden(s, id)) return false;
    const cell = screenToWorld(pt.x, pt.y, liveCameraRef.current, s.viewport);
    if (!selectionOwnsPress({
      hitId: hit ? hit.id : null,
      frontId: pressFrontPickRef.current,
      selectedId: id,
      insideBox: selectionBoxHitsCell(sel.bbox, sel.angleDeg, cell.cellX, cell.cellY),
      sceneOrder: s.sceneOrder,
    })) return false;
    // Re-announce the selection: unchanged as a selection, but it is what
    // opens the editor when the text tool is the armed one (see the shell's
    // onSelect).
    propsRef.current.onSelect(id);
    armLongPress(pt);
    // A grouped leaf can sit in `selectedId` only via the outline's raw leaf
    // rows — but grabbing it on canvas drags the whole group (the selection
    // promotes the same way through the onSelect above).
    gestureRef.current = groupDragGesture(s, id, pt)
      ?? {
        mode: 'drag', nodeId: id, startX: pt.x, startY: pt.y, dx: 0, dy: 0, moved: false,
        angleDeg: drawnSelectionAngle(id), wasSelected: true,
      };
    return true;
  };

  /** The whole selection-first sequence for a creation tool's press: corner
   *  handles, then the combined multi box, then the selected object itself.
   *  `superLongPress` arms the punch-through timer between them, where the
   *  tool arms it on every press (a corner grab must precede it — a held
   *  resize is not a menu). The hit-test runs at most once, and only once
   *  the cheap corner / multi checks have passed on the gesture. */
  const beginSelectionGrab = (
    pt: { x: number; y: number }, opts: { superLongPress: boolean },
  ) => {
    if (beginCornerResize(pt)) return true;
    if (beginMultiCornerResize(pt)) return true;
    if (opts.superLongPress) armSuperLongPress(pt);
    if (beginMultiDrag(pt)) return true;
    return beginSelectedNodeDrag(pt, hitTestAt(pt));
  };

  // ── Grid snap (arrange gestures) ──────────────────────────────────
  // Both helpers are called by the live preview AND by the commit, so what
  // the drag showed is exactly what lands. With the preference off they are
  // pass-throughs and the gestures behave as before.

  /** A node drag's effective delta in world cells: the raw screen delta
   *  converted through the live camera, then pulled onto the grid so the
   *  moved bbox's origin sits on an intersection — or, for a node carrying a
   *  free rotation, so a CORNER of the box as drawn does (the stored origin
   *  isn't a visible vertex once the box is turned). */
  const dragDeltaCells = (nodeId: string, dxPx: number, dyPx: number) => {
    const s = stateRef.current;
    const ppc = pxPerCell(liveCameraRef.current, s.viewport);
    const ref = findItem(s, nodeId);
    if (!ref) return { dxCells: dxPx / ppc, dyCells: dyPx / ppc };
    // A simple H/V line snaps its PERPENDICULAR axis at half the grid step
    // (Facet's rule: the stroke's fine placement lives on that axis, its
    // endpoints on the full grid).
    const axis = ref.kind === 'svg' ? simpleLineAxis(ref.item as SVGObject) : null;
    const angleDeg = (ref.item as { angleDeg?: number }).angleDeg ?? 0;
    return snapDragDelta(ref.item, dxPx / ppc, dyPx / ppc, s.gridLevel, gridSnapRef.current, {
      halfStepAxis: axis ? (axis === 'x' ? 'y' : 'x') : null,
      angleDeg,
    });
  };

  /** The resize cursor in world cells, snapped to the nearest grid
   *  intersection — computeCornerResize pins the opposite corner and drives
   *  the box from this point, so snapping it lands the GRABBED corner on the
   *  grid (exactly, at angleDeg 0 and non-uniform scaling). */
  const resizeCursorCell = (pt: { x: number; y: number }) => {
    const s = stateRef.current;
    const cell = screenToWorld(pt.x, pt.y, liveCameraRef.current, s.viewport);
    return snapPoint(cell.cellX, cell.cellY, s.gridLevel, gridSnapRef.current);
  };

  /** Smallest extent a corner drag may shrink to, in world cells: one VISIBLE
   *  grid cell while snapping (the smallest size the snapped cursor can even
   *  express — anything less is a collapsed sliver sitting off-grid), and
   *  computeCornerResize's own hard floor when freeform.
   *
   *  …raised to {@link MIN_ARC_CELLS} for a CURVE the arc tool made (an arc or
   *  its oval — `isArcCurveNode`). A quarter curve pulled flat IS the straight
   *  line between its ends, and the stretch has shed its arc for a polyline on
   *  the way, so there is no pulling it back out: the whole cell is the floor
   *  that keeps a curve a curve. `ids` is what the drag is resizing — one node,
   *  or a multi-selection's members, where ONE arc among them raises the floor
   *  for the combined box (the box is scaled as a whole, so the thinnest thing
   *  in it decides). */
  const resizeMinCells = (ids: readonly string[]) => {
    const snap = snapStepCells(stateRef.current.gridLevel, gridSnapRef.current);
    return ids.some((id) => isArcCurveNode(stateRef.current, id))
      ? Math.max(snap, MIN_ARC_CELLS)
      : snap;
  };

  // ── Dimensions HUD ────────────────────────────────────────────────
  // Facet's live size readout, gated on the View Settings toggle. Mutated
  // through a ref like every other gesture preview — never React state, per
  // the 90 fps rule.

  const hideDimsHud = () => {
    const el = dimsHudRef.current;
    if (el) el.style.display = 'none';
  };

  /** Label the live gesture box `bbox` (world cells) with its size in visible
   *  grid squares. Projects through the LIVE camera, so the label tracks a
   *  gesture that pans/zooms underneath it. */
  const updateDimsHud = (bbox: CellBbox) => {
    const el = dimsHudRef.current;
    if (!el) return;
    if (!showDimensionsRef.current) { hideDimsHud(); return; }
    const cam = liveCameraRef.current;
    const vp = stateRef.current.viewport;
    const ppc = pxPerCell(cam, vp);
    // Anchor on the box CENTER (rotation-invariant: a node's free rotation
    // turns its bbox about that point), then derive the screen box from it —
    // so the label stays put on a rotated object instead of chasing the
    // rotated-away top-left corner.
    const mid = worldToScreen(
      bbox.cellX + bbox.cellWidth / 2, bbox.cellY + bbox.cellHeight / 2, cam, vp,
    );
    const width = bbox.cellWidth * ppc;
    const height = bbox.cellHeight * ppc;
    const placement = dimensionsHudPlacement(
      bbox,
      { left: mid.x - width / 2, top: mid.y - height / 2, width, height },
      stateRef.current.gridLevel,
    );
    if (!placement) { hideDimsHud(); return; }
    el.textContent = placement.text;
    el.style.display = 'block';
    el.style.left = `${placement.x}px`;
    el.style.top = `${placement.y}px`;
    el.style.transform = dimensionsHudTransform(placement.hAnchor, placement.vAnchor);
  };

  /** Label a live two-finger twist with the object's rotation angle — the
   *  twist's "dimension" is its degrees, so it wears the same HUD element,
   *  chrome and View Settings gate as the size readout. Anchored on the
   *  pivot (the object's centre), which stands still while the object turns
   *  under it; projected through the LIVE camera like updateDimsHud. */
  const updateRotationHud = (cx: number, cy: number, deg: number) => {
    const el = dimsHudRef.current;
    if (!el) return;
    if (!showDimensionsRef.current) { hideDimsHud(); return; }
    const mid = worldToScreen(cx, cy, liveCameraRef.current, stateRef.current.viewport);
    el.textContent = rotationHudText(deg);
    el.style.display = 'block';
    el.style.left = `${mid.x}px`;
    el.style.top = `${mid.y}px`;
    el.style.transform = dimensionsHudTransform('center', 'middle');
  };

  // The selection tool's Rotate slider announces the angle it drags
  // through (rotateLive): the readout a two-finger twist wears — the same
  // HUD, at the selection's pivot, under the same View Settings gate —
  // follows the slider, and goes when the drag ends. The pivot is the
  // selection's centre: one object's own box, a group's combined box.
  useEffect(() => subscribeRotateLive((v) => {
    if (!v) { hideDimsHud(); return; }
    const s = stateRef.current;
    const { selectedId, selectedIds, hostDoc } = propsRef.current.session;
    const box = selectedIds.length >= 2
      ? resolveMultiSelectionBox(s, selectedIds, hostDoc)
      : selectedId ? resolveSelectionBox(s, selectedId)?.bbox ?? null : null;
    if (!box) { hideDimsHud(); return; }
    updateRotationHud(box.cellX + box.cellWidth / 2, box.cellY + box.cellHeight / 2, v.angleDeg);
  }), []);

  // A node whose own TURN is live announces itself (`turnLive.ts`) — from a
  // host's own slider up in the shell, or from a two-finger twist here.
  // CozyJournal's rig is the case: the figure re-projects as it turns, so
  // its silhouette is a different shape every frame and no one box is true
  // until the gesture settles. Rather than chase it, the selection outline
  // FADES OUT for the duration and fades back in on the committed geometry
  // when the turn ends. The re-anchor is done by hand for the same reason
  // every other live preview is: React renders the outline from committed
  // state, and a turn that ends where it began would have React write
  // nothing back. The DOM writes are one-per-gesture-edge
  // (`publishTurnLive` dedupes), not per frame.
  useEffect(() => subscribeTurnLive((v) => {
    const id = propsRef.current.session.selectedId;
    if (!id) return;
    const outline = selectionOutlineRef.current;
    if (v) {
      if (v.nodeId === id && outline) outline.style.opacity = '0';
      return;
    }
    const sel = resolveSelectionBox(stateRef.current, id);
    if (sel) setOutlineBox(sel.bbox);
    if (outline) outline.style.opacity = '1';
  }), []);

  /** Move the selection outline onto `bbox` (world cells) by hand. Every
   *  gesture that previews imperatively re-anchors it through here: React
   *  renders the outline from committed state and its reconciler skips DOM
   *  writes for props that didn't change, so live mutations have to be put
   *  back by the gesture that made them. */
  const setOutlineBox = (bbox: CellBbox) => {
    const outline = selectionOutlineRef.current;
    if (!outline) return;
    // Grown by the selection's ink outset, exactly as the render grows it
    // — the ring is one element and both paths have to put it in the same
    // place, or a drag would snap it back onto the flat box.
    const rect = selectionOutlineRect(selectionRingBbox(bbox, ringOutsetRef.current));
    outline.style.left = `${rect.left}px`;
    outline.style.top = `${rect.top}px`;
    outline.style.width = `${rect.width}px`;
    outline.style.height = `${rect.height}px`;
  };

  /** Move a drag's standing symmetry partners live: each previews the
   *  primary's snapped delta through its own orbit map's linear part —
   *  exactly the translation the release will commit for it (see
   *  SymmetryDragPeer). Same inline-style channel as the dragged node. */
  const previewSymmetryPeers = (
    peers: readonly SymmetryDragPeer[], dxCells: number, dyCells: number,
  ) => {
    for (const p of peers) {
      const el = nodeEl(p.id);
      if (el) {
        el.style.transform = `translate(${(p.a * dxCells + p.b * dyCells) * BASE_CELL_PX}px, `
          + `${(p.c * dxCells + p.d * dyCells) * BASE_CELL_PX}px)`;
      }
    }
  };

  /** Clear the peers' live transforms (gesture end or abandon), like
   *  resetDragEl does for the dragged node itself. */
  const resetSymmetryPeerEls = (peers?: readonly SymmetryDragPeer[]) => {
    for (const p of peers ?? []) {
      const el = nodeEl(p.id);
      if (el) el.style.transform = '';
    }
  };

  /** Tear down a node gesture's live preview. `outline: false` for gestures
   *  that previewed through React state (resize) rather than ref mutation:
   *  their outline is already in sync with the render, and writing the
   *  pre-commit geometry over it would leave the DOM stale — the very next
   *  render passes React the same props it rendered during the drag, so the
   *  reconciler writes nothing back. */
  const resetDragEl = (id: string, opts?: { outline?: boolean }) => {
    hideDimsHud();
    // The node's own element, or the host's stand-in where one draws it
    // (`CanvasLayers.previewStandIn`): a preview written by hand has to be
    // put back by hand, whichever element took it.
    const el = standInFor(id)?.el() ?? nodeEl(id);
    if (el) el.style.transform = '';
    // A dragged scoped pattern's axes previewed the shifted box: back onto
    // the committed one (a drop's own render moves them again at once).
    if (canvasSymmetrySpec()?.only === id) writeAxesForState(stateRef.current);
    // Any gesture teardown also drops the drag's drop-target frame highlight.
    setDropHighlight(null);
    // Re-anchor the outline to the CURRENT committed geometry. React re-renders
    // the outline from committed state, but its reconciler skips DOM writes for
    // props unchanged since the last render (a move doesn't change the angle) —
    // so a gesture's live ref mutations would stay stuck.
    if (opts?.outline !== false && selectionOutlineRef.current) {
      const outline = selectionOutlineRef.current;
      // resolveSelectionBox, not the raw item bbox: the render draws the
      // outline from the resolver, and for a simple H/V line the two differ —
      // the item bbox is the stroke's degenerate segment AABB (0 on one axis),
      // the resolver its straddle box. Writing the item bbox here collapsed
      // the outline flat on release, and the extent that didn't change in the
      // commit is exactly what the next render's reconciler won't put back.
      const sel = resolveSelectionBox(stateRef.current, id);
      if (sel) setOutlineBox(sel.bbox);
      const ang = sel?.angleDeg ?? 0;
      outline.style.transform = outlineGestureTransform('', ang);
      outline.style.removeProperty(LIVE_INV_VAR);
    }
  };

  /** End a resize preview: the node and its outline fall back to committed
   *  geometry on the next render. The outline is deliberately NOT re-anchored
   *  by hand (see resetDragEl) — it renders from the same state the preview
   *  did, so React's next pass is what puts it back. */
  const dropResizePreview = (id: string) => {
    resetDragEl(id, { outline: false });
    setLiveResize(null);
  };

  /** How a frame is drawn: its boundary rect read off the graph, as the
   *  render reads it (drawnPose.drawnClip). Null for a frame whose rect no
   *  longer resolves. */
  const frameClipOf = (frameId: string): DrawnClip | null => {
    const mask = frameRectsRef.current.get(frameId);
    if (!mask) return null;
    return drawnClip(drawnLeafFor('svg', mask, graphOf(stateRef.current)), BASE_CELL_PX);
  };

  /**
   * Live preview of a FRAME resize: the world affine the release's own entry
   * lands on the frame group, written onto the clip element and its border
   * overlay, and the selection outline dragged with it.
   *
   * ONE style write moves the members too: the clip's inner element holds the
   * clip's RESTING inverse (drawnClip.rebase), so a gesture worn on top of it
   * reaches every member as itself — and a frame commits as ONE transform on
   * its group, so that ride IS each member's. No React state and no per-leaf
   * DOM: the whole frame tracks the finger however many members it holds (the
   * alternative, re-materializing the group each move, rebuilds every member's
   * geometry AND re-renders every layer). The builder and one graph advance
   * run per move, behind the grid-snap early-out above, so the work is once
   * per grid step and never per pointer event.
   *
   * Reading the ENTRY rather than the resize's ideal gesture is what keeps
   * the preview honest: a TILTED frame stretched off its own axes asks for a
   * shear, which a group's transform cannot store, so the commit settles on
   * the nearest scale — and the preview now settles there with it instead of
   * popping on release.
   *
   * Faithful for the boundary rect, svg members (their segments genuinely
   * scale) and images. Two knowing approximations, both settled by the commit
   * on release: TEXT members scale as glyphs here but keep their font size when
   * committed (only the box grows — buildResizeNode's rule), and figure members
   * live in the GL pass, which this doesn't touch.
   *
   * A resize the builder refuses — a locked frame, a drag that has come back
   * to the box it started at — draws the frame at REST, so the preview shows
   * exactly what the release would leave.
   */
  const applyFramePreview = (frameId: string, next: CellBbox) => {
    const clip = frameClipOf(frameId);
    if (!clip) return;
    const se = buildResizeFrame(stateRef.current, frameId, next);
    const gesture = se ? previewWorldGesture(stateRef.current, se.entry, frameId) : null;
    // A frame pulled OFF SQUARE is the group bug again (applyGesturePreview):
    // the members ride the clip wrapper's transform, and an off-square one
    // stretches the strokes inside it. So the whole frame — its clip, its
    // border and every member — goes through React instead, each leaf at
    // the world matrix the release will draw it by. STICKY for the rest of
    // the drag: a pull that passes back through square must not hand the
    // wrapper between React and this function frame by frame, which is one
    // render of whichever wrote last.
    if (se && (framePosedRef.current || (gesture && !matIsSimilarity(gesture)))) {
      // Entering: drop the transforms written while the pull was still
      // square, or they would compose under React's own.
      if (!framePosedRef.current) {
        framePosedRef.current = true;
        const el = frameEl(frameId);
        if (el) el.style.transform = '';
        const ring = frameBorderEl(frameId);
        if (ring) ring.style.transform = '';
      }
      const posed = new Map<string, Mat2D>();
      for (const [id, pose] of previewGesture(stateRef.current, se.entry)) {
        posed.set(id, pose.world);
      }
      setLivePose(posed);
      setOutlineBox(next);
      return;
    }
    const t = gesture ? drawnClipGesture(clip, gesture, BASE_CELL_PX) : clip.transform;
    const wrapper = frameEl(frameId);
    if (wrapper) wrapper.style.transform = t;
    const border = frameBorderEl(frameId);
    if (border) border.style.transform = t;
    setOutlineBox(next);
  };

  /** End a frame-resize preview. A SQUARE pull renders from nothing but
   *  imperative writes, so every one of them has to be undone by hand: a
   *  cancelled (or no-op) drag would otherwise leave the frame stretched,
   *  since React's next pass writes nothing for props that never changed.
   *
   *  An OFF-SQUARE one is the other way about — React has been drawing the
   *  clip all along (applyFramePreview) — and undoing by hand would be the
   *  bug instead: the commit lands on exactly the pose the last preview
   *  render already wrote, so React sees an unchanged prop and writes
   *  nothing, and a resting transform put on the element here would be
   *  what stayed. Leave the element alone and let the render own it. */
  const dropFramePreview = (frameId: string) => {
    hideDimsHud();
    const wasPosed = framePosedRef.current;
    // Whichever half was driving it, the committed render owns the frame
    // again from here (see applyFramePreview).
    framePosedRef.current = false;
    setLivePose(null);
    if (!wasPosed) {
      // Back to the frame's resting pose — the matrix its boundary rect is
      // drawn by, or nothing at all when that is a plain translation.
      const rest = frameClipOf(frameId)?.transform ?? '';
      const wrapper = frameEl(frameId);
      if (wrapper) wrapper.style.transform = rest;
      const border = frameBorderEl(frameId);
      if (border) border.style.transform = rest;
    }
    const sel = resolveSelectionBox(stateRef.current, frameId);
    if (sel) setOutlineBox(sel.bbox);
  };

  /** Tear down whichever preview a corner drag was running (node or frame). */
  const dropAnyResizePreview = (g: Extract<Gesture, { mode: 'resize' }>) => {
    if (g.frame) dropFramePreview(g.targetId);
    else dropResizePreview(g.targetId);
  };

  const updateDrawPreview = (
    screenPoints: [number, number][], cellPoints: [number, number][],
  ) => {
    const path = drawPathRef.current;
    if (!path || screenPoints.length === 0) return;
    let d = `M ${screenPoints[0][0]} ${screenPoints[0][1]}`;
    for (let i = 1; i < screenPoints.length; i++) {
      d += ` L ${screenPoints[i][0]} ${screenPoints[i][1]}`;
    }
    // The ink and weight the committed polyline will render at — the
    // remembered stroke's (newShapeDraftColor / draftStrokeWidthPxFor, the
    // same memory the commit below dresses it with), not the active colour
    // and a fixed draft width: a stroke that drew thin and landed thick
    // popped under the finger the moment it was let go. Read every move,
    // since the page's stroke scale and the camera both feed it.
    const stroke = rgbCss(newShapeDraftColor(
      propsRef.current.newShapeStyle ?? DEFAULT_NEW_SHAPE_STYLE, propsRef.current.currentColor,
    ));
    const widthPx = draftStrokeWidthPxFor('stroke');
    path.setAttribute('d', d);
    path.setAttribute('stroke', stroke);
    path.setAttribute('stroke-width', String(widthPx));
    // The canvas Symmetry setting: the stroke's orbit copies draw live
    // under the finger, from the same world points the commit will mirror.
    const segs: PathSegment[] = [];
    for (let i = 1; i < cellPoints.length; i++) {
      segs.push({ kind: 'line', start: cellPoints[i - 1], end: cellPoints[i] });
    }
    updateDraftMirrors(segs, stroke, widthPx);
  };

  const clearDrawPreview = () => {
    drawPathRef.current?.setAttribute('d', '');
    clearDraftMirrors();
  };

  // ── Color-tool paint stroke (Facet's drag-paint brush) ────────────
  // Screen-space overlay under paintLayerRef, mutated through refs like the
  // other drafts — no React state per pointermove (90 fps rule). The camera
  // is frozen for the life of a one-finger stroke (a second finger commits
  // the stroke before pinching — see beginTwoPointerGesture), so painting
  // in screen space stays glued to the world underneath.
  //
  // The preview is a per-segment / per-fill <path> cache keyed
  // `${svgId}:${flatIdx}` / `fill:${svgId}`: a new hit creates one element,
  // a re-touch only updates its color attribute — O(delta) per stamp, as in
  // Facet's CompositionSVGLayer, never a rebuild of every painted path.

  /** The stroke width a painted svg's preview paths should carry, in WORLD
   *  px — the same units the committed node renders at (svgStrokeWidthUnits
   *  against the BASE_CELL_PX world layout). The Color brush's side
   *  previews no longer read it (they wear the node's own presentation,
   *  shapeStrokePreview.ts); the screen-space one below still does. */
  const paintStrokeWidthWorldPx = (svg: SVGObject): number =>
    svgStrokeWidthUnits(svg, stateRef.current.strokeScale, BASE_CELL_PX);

  /** …and the same width in SCREEN px, for the previews that live in the
   *  screen-space overlay (the Push brush's warped paths). */
  const paintStrokeWidthPx = (svg: SVGObject): number =>
    paintStrokeWidthWorldPx(svg)
    * worldLayerTransform(liveCameraRef.current, stateRef.current.viewport).scale;

  /** The world-layer preview `<svg>` for one painted shape, made on first
   *  need and parked immediately AFTER that shape's node element — the one
   *  place it can sit and leave the stack alone (see paintSvgLayersRef).
   *  What comes back is the `<g>` inside it that the side previews go in:
   *  it wears the node's matrix (the shape's turn, its group's pose) scaled
   *  into world px, and the shape's own stroke defs, so a side drawn into
   *  it in the shape's local units lands exactly where — and as wide as —
   *  the node draws it (shapeStrokePreview.ts).
   *
   *  Null when the shape has no mounted node, which is the one case there
   *  is no right place for it: nothing is previewed for that shape and the
   *  commit still lands everything. */
  const ensureSvgPaintLayer = (svgId: string, frame: ShapeStrokePreviewFrame): SVGGElement | null => {
    const cached = paintSvgLayersRef.current.get(svgId);
    if (cached) return cached.firstElementChild as SVGGElement;
    const node = nodeEl(svgId);
    if (!node) return null;
    const el = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    el.setAttribute('data-paint-preview', svgId);
    el.setAttribute('aria-hidden', 'true');
    // A 1px box at the world origin with overflow VISIBLE: the element is
    // only an origin for world-px coordinates, never a box anything is
    // fitted into, and everything it holds is drawn outside it. Not ZERO
    // px — a zero-sized <svg> has no layout box in Blink and paints
    // nothing at all, overflow or no overflow, which is a preview that
    // exists in the DOM, measures correctly and cannot be seen.
    Object.assign(el.style, {
      position: 'absolute', left: '0px', top: '0px', width: '1px', height: '1px',
      overflow: 'visible', pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);
    const group = document.createElementNS(SVG_NS, 'g') as SVGGElement;
    group.setAttribute('transform', frame.transform);
    if (frame.defs) group.innerHTML = frame.defs;
    el.appendChild(group);
    node.insertAdjacentElement('afterend', el);
    paintSvgLayersRef.current.set(svgId, el);
    return group;
  };

  /** A painted shape's preview frame — its flat (segment, colour) list in
   *  its own local units (the flat indices are the stable identity the
   *  draft accumulates on), the transform that lands those units where the
   *  node draws them, and the stroke presentation it draws them with —
   *  computed once per shape per stroke. Null for a shape not in the
   *  scene. */
  const paintPreviewFrame = (svgId: string): ShapeStrokePreviewFrame | null => {
    const cached = paintFrameCacheRef.current.get(svgId);
    if (cached) return cached;
    const s = stateRef.current;
    const d = drawnLeaf(graphOf(s), svgId);
    if (!d) return null;
    const frame = shapeStrokePreviewFrame(d, s.strokeScale, BASE_CELL_PX);
    paintFrameCacheRef.current.set(svgId, frame);
    return frame;
  };

  /** Live-preview the Color brush's ERASER: each path it has cut is hidden
   *  and redrawn, in its own world-layer <svg> (ensureSvgPaintLayer — the
   *  node's matrix and stroke presentation, so the pieces land where and as
   *  wide as the node draws them), from what the stroke has left of it.
   *  A path cut by this dab costs one `d` per colour it carries; a path the
   *  dab missed costs a revision compare. Effects the node draws round its
   *  path (a shadow, end caps' arrowheads) sit out until the release. */
  const updateVectorErasePreview = (es: VectorEraseState) => {
    const cache = vectorErasePreviewRef.current;
    for (const [svgId, t] of es.targets) {
      if (!t || t.rev === 0) continue;
      const seen = cache.get(svgId);
      if (seen && seen.rev === t.rev) continue;
      const frame = paintPreviewFrame(svgId);
      if (!frame) continue;
      let entry = seen;
      if (!entry) {
        const node = nodeEl(svgId);
        const own = node ? ensureSvgPaintLayer(svgId, frame) : null;
        if (!node || !own) continue;
        entry = { node, prevVisibility: node.style.visibility, paths: new Map(), rev: 0 };
        node.style.visibility = 'hidden';
        cache.set(svgId, entry);
      }
      const pieces = keptPieces(t, frame.flat.map((f) => f.segment));
      const byColor = new Map<string, PathSegment[]>();
      frame.flat.forEach((f, i) => {
        const css = rgbCss(f.color);
        const list = byColor.get(css);
        if (list) list.push(...pieces[i]);
        else byColor.set(css, [...pieces[i]]);
      });
      const own = paintSvgLayersRef.current.get(svgId)?.firstElementChild;
      for (const [css, segs] of byColor) {
        let path = entry.paths.get(css);
        if (!path) {
          if (!own) continue;
          path = document.createElementNS(SVG_NS, 'path') as SVGPathElement;
          for (const [name, value] of frame.attrs) path.setAttribute(name, value);
          path.setAttribute('stroke', css);
          own.appendChild(path);
          entry.paths.set(css, path);
        }
        path.setAttribute('d', buildPathD(segs));
      }
      entry.rev = t.rev;
    }
  };

  /** Mount the gradient brush cursor at the touch point (stroke start). */
  const ensurePaintCursor = (pt: { x: number; y: number }, radiusCells: number, color: RGBColor) => {
    const layer = paintLayerRef.current;
    if (!layer || paintCursorRef.current) return;
    const colorCSS = rgbCss(color);
    const group = document.createElementNS(SVG_NS, 'g') as SVGGElement;
    group.setAttribute('data-brush-cursor', 'true');
    const defs = document.createElementNS(SVG_NS, 'defs') as SVGDefsElement;
    const gradient = document.createElementNS(SVG_NS, 'radialGradient') as SVGRadialGradientElement;
    gradient.setAttribute('id', BRUSH_CURSOR_GRADIENT_ID);
    for (const { offset, opacity } of CURSOR_GRADIENT_STOPS) {
      const stop = document.createElementNS(SVG_NS, 'stop') as SVGStopElement;
      stop.setAttribute('offset', offset);
      stop.setAttribute('stop-color', colorCSS);
      stop.setAttribute('stop-opacity', opacity);
      gradient.appendChild(stop);
    }
    defs.appendChild(gradient);
    group.appendChild(defs);
    const circle = document.createElementNS(SVG_NS, 'circle') as SVGCircleElement;
    circle.setAttribute('fill', `url(#${BRUSH_CURSOR_GRADIENT_ID})`);
    circle.setAttribute('stroke', colorCSS);
    circle.setAttribute('stroke-width', '1.5');
    circle.setAttribute('cx', String(pt.x));
    circle.setAttribute('cy', String(pt.y));
    circle.setAttribute('r', String(
      radiusCells * pxPerCell(liveCameraRef.current, stateRef.current.viewport),
    ));
    group.appendChild(circle);
    layer.appendChild(group);
    paintCursorRef.current = { group, circle };
  };

  const movePaintCursor = (pt: { x: number; y: number }) => {
    const cursor = paintCursorRef.current;
    if (!cursor) return;
    cursor.circle.setAttribute('cx', String(pt.x));
    cursor.circle.setAttribute('cy', String(pt.y));
  };

  /** Live preview of a PUSH stroke's warped vector geometry: one overlay
   *  path per touched object, redrawn from the accumulating segments, with
   *  the committed node hidden underneath for the stroke's duration.
   *
   *  A push REPLACES geometry rather than adding colour to it, so unlike the
   *  colour brushes' overlay (which draws over what is already there) this
   *  one has to take the node's place — leaving the committed shape visible
   *  would show the path in both positions at once. The node comes back on
   *  teardown: on a commit React has already flushed the warped geometry, on
   *  a cancel the committed shape is exactly what should return.
   *
   *  O(touched) per event, and the touched set only grows as the brush
   *  reaches new objects — a re-warp is one `d` rewrite, no allocation. */
  const updatePushPreview = (g: Extract<Gesture, { mode: 'paint' }>) => {
    const layer = paintLayerRef.current;
    if (!layer || !g.push) return;
    const cache = paintPushPathsRef.current;
    const s = stateRef.current;
    for (const t of g.push.svgs) {
      if (!t.moved) continue;
      const svg = s.svgObjects.find((o) => o.id === t.id);
      if (!svg) continue;
      // Each coloured subpath draws on its own, exactly as the node does.
      const runs = t.subpaths
        ? t.subpaths.map((sp, i) => ({ key: `${t.id}:${i}`, segments: sp.segments, color: sp.color }))
        : [{ key: `${t.id}:0`, segments: t.segments, color: svg.color }];
      for (const run of runs) {
        let el = cache.get(run.key);
        if (!el) {
          el = document.createElementNS(SVG_NS, 'path') as SVGPathElement;
          el.setAttribute('fill', 'none');
          el.setAttribute('stroke', rgbCss(run.color));
          el.setAttribute('stroke-width', String(paintStrokeWidthPx(svg)));
          el.setAttribute('stroke-linecap', 'round');
          el.setAttribute('stroke-linejoin', 'round');
          const cursor = paintCursorRef.current;
          if (cursor) layer.insertBefore(el, cursor.group);
          else layer.appendChild(el);
          cache.set(run.key, el);
          const node = nodeEl(t.id);
          if (node && !paintPushHiddenRef.current.has(t.id)) {
            paintPushHiddenRef.current.set(t.id, node.style.visibility);
            node.style.visibility = 'hidden';
          }
        }
        el.setAttribute('d', segmentsToScreenPath(run.segments));
      }
    }
  };

  /** Sync the preview to the stroke's accumulators.
   *
   *  A recoloured SHAPE previews in its OWN world-layer `<svg>`, parked
   *  behind the next node up the stack (ensureSvgPaintLayer): the brush
   *  changes colours and must change nothing else, and a preview drawn over
   *  the whole scene changes the STACK — a piece under its neighbour comes
   *  out in front for as long as the finger is down. Inside that element a
   *  fill path sits first and the seam strokes over it, which is the order
   *  the shape itself draws them in.
   *
   *  A brushed TEXT previews inside its own node too (textPaintPreview.tsx):
   *  the node layer's ink pass re-run with the stroke's colours, so the
   *  recoloured glyph is the glyph, not a copy laid over it.
   *
   *  Everything else — the bitmap layers, the brush cursor — is still the
   *  screen-space overlay's. */
  const updatePaintPreview = (g: Extract<Gesture, { mode: 'paint' }>) => {
    if (g.vectorErase) { updateVectorErasePreview(g.vectorErase); return; }
    const layer = paintLayerRef.current;
    if (!layer) return;
    const cache = paintPathsRef.current;
    const s = stateRef.current;

    /**
     * A recoloured INTERIOR previews by re-mounting the shape's own content
     * markup with the new fill on it — the same innerHTML swap a brushed
     * pattern cell rides (mountShapeContent) — rather than by drawing a
     * filled silhouette over the node.
     *
     * The silhouette was wrong twice over, because it covered the shape
     * instead of being it. A patterned shape's cloth vanished under it for
     * the length of the drag and came back on release; and the path had no
     * stroke, so it ate the inner half of the shape's own outline and every
     * border looked to thin and then snap back. Re-mounting draws fill,
     * tiles and outline in the shape's own order at the shape's own
     * geometry, which is exactly what the commit will render.
     *
     * `legacy` picks which fill the preview object carries: the old
     * whole-object `fillColor` blend (the raster Paint brush's, which is
     * what it commits), or the modern ShapeFill layer the Color brush
     * writes — asSolidFill over whatever the shape already had, so a
     * gradient flattens here exactly as it will on the drop.
     *
     * One mount per shape per colour: the map holds what each is wearing,
     * and a drag that keeps crossing a shape it has already recoloured
     * costs nothing.
     */
    const upsertFill = (svgId: string, color: RGBColor, legacy: boolean) => {
      const worn = paintShapeFillsRef.current.get(svgId);
      if (worn && sameRGB(worn, color)) return;
      const svg = s.svgObjects.find((o) => o.id === svgId);
      if (!svg) return;
      paintShapeFillsRef.current.set(svgId, color);
      mountShapeContent(legacy
        ? { ...svg, fillColor: color }
        : {
          ...svg,
          fill: asSolidFill(shapeFillOf(svg), color),
          fillColor: undefined,
          fillOpacity: undefined,
          fillPaint: undefined,
        });
    };

    // Legacy fillColor fills (the engine draft's whole-fill blend). Modern
    // ShapeFill shapes preview through their bitmap layer below instead.
    for (const [svgId, color] of g.draft.paintedFills) {
      upsertFill(svgId, color, true);
    }

    for (const [svgId, painted] of g.draft.paintedSegments) {
      if (painted.size === 0) continue;
      const frame = paintPreviewFrame(svgId);
      if (!frame) continue;
      const { flat } = frame;
      for (const [idx, color] of painted) {
        if (idx < 0 || idx >= flat.length) continue;
        const key = `${svgId}:${idx}`;
        const existing = cache.get(key);
        const colorCSS = rgbCss(color);
        if (existing) {
          if (!sameRGB(existing.color, color)) {
            existing.el.setAttribute('stroke', colorCSS);
            existing.color = color;
          }
          continue;
        }
        const own = ensureSvgPaintLayer(svgId, frame);
        if (!own) continue;
        // The side as the node draws it: local units inside the frame's
        // transformed <g>, wearing the shape's own stroke presentation
        // (width, caps, dash, the inside clip / outside mask) — never a
        // world-space centred stroke of its own (bug report 85dc9b13).
        const path = document.createElementNS(SVG_NS, 'path') as SVGPathElement;
        path.setAttribute('d', sideD(flat[idx].segment));
        for (const [name, value] of frame.attrs) path.setAttribute(name, value);
        path.setAttribute('stroke', colorCSS);
        own.appendChild(path);
        cache.set(key, { el: path, color });
      }
    }

    // Text characters: the touched characters recoloured IN the node, by the
    // node layer's own ink pass over its own layout (textPaintPreview.tsx),
    // so the preview glyph is the committed glyph's exact placement. A
    // re-touch that changed no colour costs one compare and no render.
    for (const [textId, charMap] of g.textPaint.chars) {
      const drawn = drawnLeaf(graphOf(s), textId);
      if (!drawn) continue;
      const host = nodeEl(textId)?.querySelector<HTMLElement>('[data-paint-host]');
      if (!host) continue;
      upsertTextPaintPreview(paintTextPreviewsRef.current, host, drawn, charMap);
    }

    // Solid-shape bitmap paint layer: one working canvas per touched shape,
    // mounted in the shape's OWN paint host between its fill and its
    // strokes (shapePaintDom.ts) — the same in-node carrier the image
    // previews use, and the same order the commit renders in: over the
    // fill, under the outline. Cut to the outline through the fill half's
    // own clip (`clip-path: url(#…)`), blended with the overlay's mode
    // against the fill alone (the host isolates), and redrawn in place from
    // the working overlay only when a stamp actually changed bytes (`rev`)
    // — never a data URL per pointer move (paintOverlayPreview.ts). A shape
    // that carries no committed paint is one svg: it is split for the
    // stroke and put back whole on clear.
    const upsertShapePaintPreview = (
      svgId: string,
      entry: { overlay: ImagePaintOverlay; rev: number },
    ) => {
      const cache = paintNodeShapesRef.current;
      const existing = cache.get(svgId);
      if (existing) {
        if (existing.rev !== entry.rev) {
          drawOverlayToCanvas(existing.el, entry.overlay);
          existing.rev = entry.rev;
        }
        return;
      }
      const host = nodeEl(svgId)?.querySelector<HTMLElement>('[data-paint-host]');
      if (!host) return;
      const drawn = drawnLeaf(graphOf(s), svgId);
      if (!drawn) return;
      const split = splitShapeDom(document, host, drawn, s.strokeScale);
      const strokesSvg = host.querySelector<SVGSVGElement>(`svg[${SHAPE_STROKES_SVG_ATTR}]`);
      if (!strokesSvg) return;
      const committed = host.querySelector<HTMLElement>('[data-paint-committed]');
      if (committed) committed.style.display = 'none';
      const prevIsolation = host.style.isolation;
      host.style.isolation = 'isolate';
      // The fill half emits the clip only for a shape with a closed outline;
      // a canvas cut with a clip that is not there would draw nothing at all.
      const clipId = shapePaintClipId(svgId);
      const clipped = !!host.querySelector(`#${CSS.escape(clipId)}`);
      const el = createPaintPreviewCanvas(document, entry.overlay, clipped ? clipId : null);
      host.insertBefore(el, strokesSvg);
      cache.set(svgId, { el, rev: entry.rev, host, prevIsolation, committed, split });
    };

    // Image paint previews live in the image's OWN clip div (data-paint-host),
    // not the screen-space overlay: the overlay <svg> is an isolated group, so
    // a mix-blend-mode set there can't composite against the photo and every
    // non-normal mode painted as if normal until the drop. Mounted beside the
    // committed layers (which share the host's `isolation: isolate`), the
    // stroke blends live, exactly as the commit will render. The committed
    // paint canvas is hidden for the stroke — the working overlay is its
    // clone plus this stroke's dabs (see stampNodeOverlay), so showing both
    // would deposit the old ink twice. The working canvas is redrawn in
    // place per stamp (paintOverlayPreview.ts) — never a data URL.
    const upsertImagePaintPreview = (
      imgId: string,
      entry: { overlay: ImagePaintOverlay; rev: number },
    ) => {
      const cache = paintNodeImgsRef.current;
      const existing = cache.get(imgId);
      if (existing) {
        if (existing.rev !== entry.rev) {
          drawOverlayToCanvas(existing.el, entry.overlay);
          existing.rev = entry.rev;
        }
        return;
      }
      const host = nodeEl(imgId)?.querySelector<HTMLElement>('[data-paint-host]');
      if (!host) return;
      const committed = host.querySelector<HTMLElement>('[data-paint-committed]');
      if (committed) committed.style.display = 'none';
      // Force isolation on for a first-ever stroke (the node layer only sets
      // it once a tintFill / paintOverlay exists); restored on clear, and the
      // commit re-renders it through React anyway.
      const prevIsolation = host.style.isolation;
      host.style.isolation = 'isolate';
      const el = createPaintPreviewCanvas(document, entry.overlay);
      host.appendChild(el);
      cache.set(imgId, { el, rev: entry.rev, host, prevIsolation, committed });
    };

    // The Color brush's whole-image tint: a flat wash of the brushed colour
    // at the tint layer's own opacity + blend, standing in for the committed
    // tint layer (hidden for the stroke) exactly as the commit will render
    // it. One div per image, its colour updated in place per dab.
    const upsertImageTintPreview = (imgId: string, color: RGBColor) => {
      const cache = paintNodeTintsRef.current;
      const existing = cache.get(imgId);
      if (existing) {
        if (!sameRGB(existing.color, color)) {
          existing.el.style.background = rgbCss(color);
          existing.color = color;
        }
        return;
      }
      const host = nodeEl(imgId)?.querySelector<HTMLElement>('[data-paint-host]');
      if (!host) return;
      const img = s.images?.find((i) => i.id === imgId);
      const layer = img?.tintFill ?? DEFAULT_IMAGE_TINT_FILL;
      const committed = host.querySelector<HTMLElement>('[data-tint-committed]');
      if (committed) committed.style.display = 'none';
      const prevIsolation = host.style.isolation;
      host.style.isolation = 'isolate';
      const el = document.createElement('div');
      Object.assign(el.style, {
        position: 'absolute', inset: '0', background: rgbCss(color),
        opacity: String(layer.opacity), mixBlendMode: layer.blend,
        pointerEvents: 'none',
      });
      // Under the paint canvas — committed or previewed — which is the order
      // the markup renders in and the SVG export writes: tint, then paint.
      const above = host.querySelector<HTMLElement>('[data-paint-committed]')
        ?? paintNodeImgsRef.current.get(imgId)?.el
        ?? null;
      if (above) host.insertBefore(el, above);
      else host.appendChild(el);
      cache.set(imgId, { el, color, host, prevIsolation, committed });
    };

    // The Color brush's whole-shape fill rides the SAME wash the legacy
    // `fillColor` blend previews through — it is the same statement about
    // the same interior, so there is one drawing of it.
    for (const [svgId, color] of g.objectColor.shapeFills) {
      upsertFill(svgId, color, false);
    }
    for (const [imgId, color] of g.objectColor.imageTints) {
      upsertImageTintPreview(imgId, color);
    }
    for (const [imgId, entry] of g.imagePaint.overlays) {
      upsertImagePaintPreview(imgId, entry);
    }
    for (const [svgId, entry] of g.shapePaint.overlays) {
      upsertShapePaintPreview(svgId, entry);
    }
  };

  const clearPaintOverlay = () => {
    // The Eraser's hidden nodes come back first (their preview <svg>s go
    // with the other world-layer previews just below).
    for (const p of vectorErasePreviewRef.current.values()) {
      p.node.style.visibility = p.prevVisibility;
    }
    vectorErasePreviewRef.current.clear();
    const layer = paintLayerRef.current;
    if (layer) while (layer.firstChild) layer.removeChild(layer.firstChild);
    // The recoloured shapes' own world-layer previews: whole elements this
    // code put in the scene, so they come out whole. Before the commit
    // re-renders, like every other in-node preview here.
    for (const el of paintSvgLayersRef.current.values()) el.remove();
    paintSvgLayersRef.current.clear();
    // …and the shapes whose own markup a FILL preview re-mounted go back to
    // the committed record's, on the same rule the previewed patterns do
    // (restorePatternBrushPreview): before the commit lands. A shape the
    // stroke actually recoloured is re-rendered by React in the same tick —
    // its object identity moves — while one the brush reached and left
    // alone has no identity change to trigger that, and would otherwise
    // keep wearing the preview.
    for (const svgId of paintShapeFillsRef.current.keys()) {
      const committed = stateRef.current.svgObjects.find((o) => o.id === svgId);
      if (committed) mountShapeContent(committed);
    }
    paintShapeFillsRef.current.clear();
    paintPathsRef.current.clear();
    paintFrameCacheRef.current.clear();
    // Brushed texts' preview roots come down before the commit re-renders
    // the nodes: the host is React's, its contents were ours.
    clearTextPaintPreviews(paintTextPreviewsRef.current);
    // In-node shape previews: remove the working canvas, restore what the
    // stroke hid / forced (committed paint layer, host isolation), and put a
    // shape the stroke split back into its one-svg form, mounted from the
    // committed node. Before the commit re-renders, so nothing React owns is
    // left carrying an imperative override — and the painted form React
    // then renders is the first the DOM sees of the new paint.
    for (const [id, p] of paintNodeShapesRef.current) {
      p.el.remove();
      if (p.committed) p.committed.style.display = '';
      p.host.style.isolation = p.prevIsolation;
      if (p.split) {
        // By id, off the graph — see mountShapeContent for why not
        // drawnLeafFor.
        const d = drawnLeaf(graphOf(stateRef.current), id) ?? null;
        unsplitShapeDom(p.host, p.split, d, stateRef.current.strokeScale);
      }
    }
    paintNodeShapesRef.current.clear();
    // In-node image previews: remove the working canvas and restore what the
    // stroke hid / forced (committed paint layer, host isolation). Runs
    // BEFORE the commit re-renders the node, so nothing React owns is left
    // carrying an imperative override.
    for (const p of paintNodeImgsRef.current.values()) {
      p.el.remove();
      if (p.committed) p.committed.style.display = '';
      p.host.style.isolation = p.prevIsolation;
    }
    paintNodeImgsRef.current.clear();
    // …and the Color brush's tint washes, on the same rule.
    for (const t of paintNodeTintsRef.current.values()) {
      t.el.remove();
      if (t.committed) t.committed.style.display = '';
      t.host.style.isolation = t.prevIsolation;
    }
    paintNodeTintsRef.current.clear();
    // Session-island preview: remove the world-layer canvas and unhide the
    // continued island's committed one. On a commit the reveal is seamless —
    // React flushes the new tiles before the browser paints; on a cancel the
    // committed pixels are exactly what should return.
    const pv = paintIslandPreviewRef.current;
    if (pv) {
      pv.el.remove();
      if (pv.hidden) pv.hidden.style.display = '';
      paintIslandPreviewRef.current = null;
    }
    // The grow strokes' per-island previews come down the same way: remove
    // the takeover canvas, give the committed one back. On a commit React
    // flushes the re-framed island before the browser paints; on a cancel
    // the committed pixels are exactly what should return.
    for (const gp of paintGrowPreviewsRef.current.values()) {
      gp.el.remove();
      if (gp.hidden) gp.hidden.style.display = '';
    }
    paintGrowPreviewsRef.current.clear();
    paintTouchedCanvasesRef.current.clear();
    // Push preview: the overlay paths went with the layer wipe above; give
    // the nodes they stood in for their visibility back.
    for (const [id, prev] of paintPushHiddenRef.current) {
      const node = nodeEl(id);
      if (node) node.style.visibility = prev;
    }
    paintPushHiddenRef.current.clear();
    paintPushPathsRef.current.clear();
    paintCursorRef.current = null;
  };

  /** Mount a fresh world-layer preview canvas for one island's working set,
   *  hiding the committed canvas it stands in for (`paintId` null = a fresh
   *  island, nothing to hide). The caller owns teardown via the preview
   *  refs (clearPaintOverlay). */
  const createIslandPreview = (paintId: string | null, opacity?: number): IslandPreview => {
    const el = document.createElement('canvas');
    Object.assign(el.style, {
      position: 'absolute', pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);
    // A translucent island previews at its own opacity, or the takeover
    // reads brighter than the paint it stands in for.
    if (opacity !== undefined && opacity < 1) el.style.opacity = String(opacity);
    worldRef.current?.appendChild(el);
    let hidden: HTMLElement | null = null;
    if (paintId) {
      hidden = nodeEl(paintId)
        ?.querySelector<HTMLElement>('[data-paint-canvas]') ?? null;
      if (hidden) hidden.style.display = 'none';
    }
    return { el, x: NaN, y: NaN, w: 0, h: 0, hidden };
  };

  /** Draw a working set's dirty tiles into its world-layer preview canvas.
   *  The canvas is sized to the working set's tile bounds — tiles are
   *  uniform 16-cell squares on the allocation grid, so the bounds are
   *  exact and cheap — and carried to WORLD by the island's translation
   *  offset (a moved island draws its working tiles where it renders, not
   *  where its tile space says). A dab past the current bounds resizes
   *  (which resets the bitmap) and redraws every tile — the one full
   *  redraw, bounded and occasional; otherwise each dirty tile is one
   *  putImageData. */
  const drawWorkingPreview = (
    pv: IslandPreview,
    working: CanvasPaintWorking,
    worldDx: number,
    worldDy: number,
    dirty: ReadonlySet<string>,
  ) => {
    const tiles = composeCanvasPaint(working);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const t of tiles) {
      if (t.x < minX) minX = t.x;
      if (t.y < minY) minY = t.y;
      if (t.x + CANVAS_ISLAND_CELLS > maxX) maxX = t.x + CANVAS_ISLAND_CELLS;
      if (t.y + CANVAS_ISLAND_CELLS > maxY) maxY = t.y + CANVAS_ISLAND_CELLS;
    }
    if (minX === Infinity) return;
    const w = maxX - minX;
    const h = maxY - minY;
    const ctx = pv.el.getContext('2d');
    if (!ctx) return;
    if (pv.x !== minX || pv.y !== minY || pv.w !== w || pv.h !== h) {
      pv.x = minX; pv.y = minY; pv.w = w; pv.h = h;
      pv.el.width = w * CANVAS_PAINT_TEXELS_PER_CELL;
      pv.el.height = h * CANVAS_PAINT_TEXELS_PER_CELL;
      pv.el.style.left = `${(minX + worldDx) * BASE_CELL_PX}px`;
      pv.el.style.top = `${(minY + worldDy) * BASE_CELL_PX}px`;
      pv.el.style.width = `${w * BASE_CELL_PX}px`;
      pv.el.style.height = `${h * BASE_CELL_PX}px`;
      for (const t of tiles) {
        ctx.putImageData(
          overlayImageData(t.overlay),
          (t.x - minX) * CANVAS_PAINT_TEXELS_PER_CELL,
          (t.y - minY) * CANVAS_PAINT_TEXELS_PER_CELL,
        );
      }
    } else {
      for (const key of dirty) {
        const t = working.touched.get(key);
        if (!t) continue;
        ctx.putImageData(
          overlayImageData(t.overlay),
          (t.x - pv.x) * CANVAS_PAINT_TEXELS_PER_CELL,
          (t.y - pv.y) * CANVAS_PAINT_TEXELS_PER_CELL,
        );
      }
    }
  };

  /** Redraw exactly the stroke's dirty tiles into the live preview — the
   *  raster brush's per-event refresh. Working tiles mutate under stable
   *  references and their ImageData views alias the same bytes, so each
   *  dirty tile is one putImageData (64 KB), no encode and no allocation.
   *
   *  Session strokes draw into ONE preview canvas mounted in the world
   *  layer (top of the stack — a continued island rises for the stroke's
   *  duration only, and an occluded stroke's deposits are already masked to
   *  what the scene lets through, so texels under opaque objects hold no
   *  ink to mis-stack; only semi-transparent occluders read a touch bright
   *  until the drop settles the island at its real z), sized to the working
   *  set's tile bounds and regrown on the occasional dab past them
   *  (drawWorkingPreview). While continuing an existing island its
   *  committed canvas is hidden — the working set already holds its ink, so
   *  showing both would double-deposit.
   *
   *  The GROW strokes (push / blur) carry paint past the committed content
   *  rect, which each island's own canvas clips to — smeared or feathered
   *  paint would vanish at the frame edge until the commit re-framed it, a
   *  wall in the middle of the drag. So every touched translation-frame
   *  island gets the same world-layer takeover as the session's, one
   *  preview canvas per island (same top-of-stack caveat, same teardown). A
   *  rotated island's writes are already fenced INSIDE its content rect
   *  (targetGrowBounds), so it keeps the committed-canvas path below.
   *
   *  Erase (and blend-mode paint) write straight into each touched island's
   *  OWN committed canvas (content-space pixels — the node's transform maps
   *  them, so no camera math here); the commit re-renders those through
   *  React with the same bytes, and a cancel redraws them from committed
   *  tiles (finishPaintStroke). */
  const renderPaintObjectPreview = (g: Extract<Gesture, { mode: 'paint' }>) => {
    const ps = g.paint;
    if (!ps) return;
    if (ps.session) {
      const dirty = ps.dirty.get('');
      if (!dirty || dirty.size === 0) return;
      let pv = paintIslandPreviewRef.current;
      if (!pv) {
        pv = createIslandPreview(ps.session.paintId);
        paintIslandPreviewRef.current = pv;
      }
      drawWorkingPreview(pv, ps.session.working, ps.session.worldDx, ps.session.worldDy, dirty);
      dirty.clear();
      return;
    }
    // Targets-style strokes: each touched island previews through the
    // takeover (grow strokes on translation frames) or its own committed
    // canvas (everything else) — see the doc above.
    for (const [id, keys] of ps.dirty) {
      if (keys.size === 0) continue;
      const target = ps.targets.find((t) => t.island.id === id);
      if (!target?.working) { keys.clear(); continue; }
      const shift = ps.grow ? paintObjectTranslation(target.island) : null;
      if (shift) {
        let pv = paintGrowPreviewsRef.current.get(id);
        if (!pv) {
          pv = createIslandPreview(id, target.island.opacity);
          paintGrowPreviewsRef.current.set(id, pv);
        }
        drawWorkingPreview(pv, target.working, shift.dx, shift.dy, keys);
        keys.clear();
        continue;
      }
      const el = nodeEl(id)?.querySelector<HTMLCanvasElement>('canvas[data-paint-canvas]');
      if (!el) { keys.clear(); continue; }
      const ctx = el.getContext('2d');
      if (!ctx) { keys.clear(); continue; }
      paintTouchedCanvasesRef.current.set(id, el);
      const island = target.island;
      const sx = el.width / island.contentW;
      const sy = el.height / island.contentH;
      for (const key of keys) {
        const t = target.working.touched.get(key);
        if (!t) continue;
        // putImageData clips to the canvas, so tile regions past the
        // contentRect (which holds all ink by definition) draw nothing.
        ctx.putImageData(
          overlayImageData(t.overlay),
          Math.round((t.x - island.contentX) * sx),
          Math.round((t.y - island.contentY) * sy),
        );
      }
      keys.clear();
    }
  };

  /** One dab at a world cell. Returns whether the object accumulators
   *  changed (the island half refreshes its own preview per event). */
  const stampPaintDab = (
    g: Extract<Gesture, { mode: 'paint' }>,
    cellX: number,
    cellY: number,
    dxCells = 0,
    dyCells = 0,
  ): { objects: boolean; paint: boolean } => {
    // The Color brush's Eraser: cut the paths under the disc, nothing else.
    if (g.vectorErase) {
      return {
        objects: eraseVectorDab(g.vectorErase, stateRef.current, cellX, cellY, g.radiusCells),
        paint: false,
      };
    }
    // PUSH lays no colour: the dab is a DISPLACEMENT, so it carries the
    // travel since the last one and hands it to each half — path points and
    // rig joints in pushBrush, island texels through the same working sets
    // the eraser uses. Nothing below it applies.
    if (g.kind === 'push') {
      const moved = g.push
        ? pushDab(g.push, cellX, cellY, g.radiusCells, dxCells, dyCells, g.strength)
        : { host: false, svgs: false };
      const paint = !!g.paint && smudgePaintObjectBrush(
        g.paint, cellX, cellY, g.radiusCells, dxCells, dyCells, g.strength,
      );
      // What the dab moved of the HOST's own shows the deformation it
      // reached, through the host's live channel: a bake has no overlay
      // path for the canvas to preview it with.
      if (moved.host) g.push!.host?.preview();
      return { objects: moved.svgs, paint };
    }
    // 'randomize': the stroke drifts through colour, one step per dab. Every
    // pass below reads draft.brushColor, so setting it here is all it takes
    // for segments, glyphs, layers and island texels to agree on the colour
    // this dab is laying down.
    if (g.random) g.draft.brushColor = advanceRandomColorWalk(g.random);
    // The raster brush paints everything under it: the objects (their strokes
    // and their fills, through the same pass the color brush uses) AND the
    // session's paint island. `g.paint` is null when a selection is up, which
    // is what confines the stroke to that object — the object pass is already
    // filtered to it, so nothing else is left to paint. The stroke's
    // occlusion stack rides both halves of the raster brush: per-dab weights
    // here (only the topmost ink takes the dab, opacity falls through), the
    // per-texel island mask inside stampPaintObjectBrush below.
    const objects = stampPaintBrush(
      stateRef.current, g.draft, g.textPaint, g.imagePaint, g.shapePaint, cellX, cellY,
      g.radiusCells, g.filterIds, g.skipIds, g.kind,
      g.kind === 'paint' ? g.paint?.occlusion ?? null : null,
      g.patternPaint,
      g.objectColor,
    );
    // The eraser lifts island paint back off and the blur brush softens it,
    // and the recolour brush restains it (a mutate-only stamp — see
    // createPaintObjectStrokeState) — islands are not reached by the object
    // pass above.
    const paint = !!g.paint && (g.kind === 'paint' || g.kind === 'color'
      ? stampPaintObjectBrush(g.paint, g.draft, cellX, cellY, g.radiusCells)
      : g.kind === 'erase'
        ? erasePaintObjectBrush(g.paint, g.draft, cellX, cellY, g.radiusCells)
        : g.kind === 'blur'
          && blurPaintObjectBrush(g.paint, g.draft, cellX, cellY, g.radiusCells));
    return { objects, paint };
  };

  /** Stamp the brush up to a touch point: accumulate into the draft and sync
   *  the cursor + preview. Shared by pointer-down and every move.
   *
   *  A pointer stream is samples, not a path — at any real drag speed the
   *  finger skips whole brush-widths between events — so the gap from the
   *  last dab is walked in (paintStampPoints) and stamped at quarter-radius
   *  spacing. Without it a stroke is a row of dots. All three brushes come
   *  through here, so paint, erase and blur all draw continuously.
   *
   *  The previews are refreshed ONCE for the whole run rather than per dab:
   *  a GL re-upload and an overlay rebuild per interpolated point is what
   *  would turn the interpolation into the jank it is meant to avoid. */
  /** The canvas Symmetry setting as painting consumes it, or undefined
   *  when the mirror is off. With a pattern selected it is THAT pattern's
   *  mirror — its box, its centre, its grid alone (canvasSymmetrySpecOf);
   *  the consumers that mirror the canvas read it through
   *  canvasWideSymmetry and stand down. */
  const canvasSymmetrySpec = (): CanvasSymmetrySpec | undefined =>
    canvasSymmetrySpecOf(stateRef.current, symmetryScopeId());
  /** The pattern the mirror is scoped to, when one is in hand: the grid
   *  wearing the editing double border (tileEditPatternId — the one the
   *  Tile tool may rework), else the selected pattern. Anything else keeps
   *  the canvas frame (canvasSymmetrySpecOf). */
  const symmetryScopeId = (): string | null | undefined =>
    propsRef.current.tileEditPatternId ?? propsRef.current.session.selectedId;

  /** The symmetry axes rebuilt from `st` — the working state of a stroke,
   *  or the committed one again on a cancel — and, with `shift`, the scoped
   *  pattern's frame moved by that many cells: a drag's live preview, where
   *  the axes ride the box under the finger instead of waiting for the
   *  drop. Written through the one axes writer. */
  const writeAxesForState = (st: CompositionState, shift?: { dx: number; dy: number }) => {
    // Off the rendered model: the next render rewrites (see the effect
    // keyed on symmetryModelKey).
    axesWrittenKeyRef.current = null;
    const spec = canvasSymmetrySpecOf(st, symmetryScopeId());
    const frame = spec && shift
      ? { ...spec.frame, cellX: spec.frame.cellX + shift.dx, cellY: spec.frame.cellY + shift.dy }
      : spec?.frame;
    symmetryModelRef.current = symmetryOverlayFor(spec, st.patternObjects, st.gridLevel, frame);
    writeAxes(worldLayerTransform(liveCameraRef.current, st.viewport), st.viewport);
  };

  const stampPaintAt = (g: Extract<Gesture, { mode: 'paint' }>, pt: { x: number; y: number }) => {
    const s = stateRef.current;
    const cell = screenToWorld(pt.x, pt.y, liveCameraRef.current, s.viewport);
    let objects = false;
    let paint = false;
    // The canvas Symmetry setting mirrors EVERY brush at the dab level —
    // paint, erase, blur and push alike: each dab re-fires at its orbit
    // positions with its travel vector carried through the map's linear
    // part (a push smears in the mirrored direction). Dabs flow through
    // the same accumulators, so preview and commit mirror identically.
    // A dab ON an axis maps to itself and is skipped, as are coincident
    // partners, so nothing double-stamps.
    const spec = canvasWideSymmetry(canvasSymmetrySpec());
    const maps = spec
      ? symmetryAffineMaps(spec, compSnapStep(s.gridLevel), cell.cellX, cell.cellY)
      : null;
    // Each interpolated dab carries the step that reached it, so a push
    // spread over a walked-in gap displaces by the same total the finger
    // travelled rather than by one step repeated.
    let prev: [number, number] = g.lastCell ?? [cell.cellX, cell.cellY];
    for (const [cx, cy] of paintStampPoints(g.lastCell, [cell.cellX, cell.cellY], g.radiusCells)) {
      const dx = cx - prev[0];
      const dy = cy - prev[1];
      const hit = stampPaintDab(g, cx, cy, dx, dy);
      prev = [cx, cy];
      objects = objects || hit.objects;
      paint = paint || hit.paint;
      if (maps) {
        const eps = 1e-9;
        const stampedAt: [number, number][] = [[cx, cy]];
        for (const m of maps) {
          const [mx, my] = applySymmetryAffine(m, cx, cy);
          if (stampedAt.some(([px, py]) => Math.abs(px - mx) < eps && Math.abs(py - my) < eps)) {
            continue;
          }
          stampedAt.push([mx, my]);
          const [mdx, mdy] = applySymmetryAffineVec(m, dx, dy);
          const mHit = stampPaintDab(g, mx, my, mdx, mdy);
          objects = objects || mHit.objects;
          paint = paint || mHit.paint;
        }
      }
    }
    g.lastCell = [cell.cellX, cell.cellY];
    if (paint) renderPaintObjectPreview(g);
    movePaintCursor(pt);
    // A push REPLACES geometry, so its preview is a different one — see
    // updatePushPreview. Rig joints need no overlay at all: the live rig
    // canvas repaints through its own handle, as it does under a joint drag.
    if (objects) {
      if (g.kind === 'push') updatePushPreview(g);
      else {
        updatePaintPreview(g);
        // Patterns preview by re-baking rather than by overlay paths: their
        // drawn segments are derived from the cells, so there is no stable
        // segment to lay a preview stroke over (see updatePatternBrushPreview).
        updatePatternBrushPreview(g);
        // …and a node whose colour is not ON the object by the HOST's own
        // live channel: there is nothing for the overlay to be laid over
        // (a rig's silhouette is a bake its live sketch draws over), so the
        // Color pass that owns that colour is simply told what it looks
        // like now (sessionHost.ts `HostPaintTargets.preview`), the way a
        // joint drag tells a rig what pose it is in.
        if (g.kind === 'color') g.objectColor.host?.preview?.();
      }
    }
  };

  /** Put what a push stroke drove of the HOST's own back on the committed
   *  page, for an abandoned or empty stroke. */
  const restoreHostPush = (g: Extract<Gesture, { mode: 'paint' }>) => {
    g.push?.host?.restore(stateRef.current);
  };

  /** Tear down the overlay and (unless cancelled) commit the stroke as ONE
   *  undo entry. Shared by pointer-up and the second-finger handoff. */
  const finishPaintStroke = (g: Extract<Gesture, { mode: 'paint' }>, cancelled: boolean) => {
    if (g.vectorErase) {
      // The cut paths come back into view before the commit re-renders them
      // (in the same task, so the browser never paints the uncut path
      // between the two) — or, on a cancel, exactly as they were.
      clearPaintOverlay();
      if (cancelled) return;
      const entry = buildVectorEraseEntry(stateRef.current, g.vectorErase);
      if (entry) propsRef.current.onCommit({ entry });
      return;
    }
    // Committed island canvases the erase/blur preview painted into — read
    // BEFORE clearPaintOverlay resets the ref.
    const touched = new Map(paintTouchedCanvasesRef.current);
    clearPaintOverlay();
    if (cancelled) {
      // The abandoned stroke's dabs must not survive on screen: erased-into
      // committed canvases redraw from their committed tiles. (The session
      // preview canvas was already torn down above; on a commit the touched
      // canvases already show the exact bytes the commit lands, and React
      // re-renders them from the new tiles.)
      for (const [id, el] of touched) {
        const island = (stateRef.current.paintObjects ?? []).find((p) => p.id === id);
        if (island) drawPaintTiles(el, island);
      }
      restoreHostPush(g);
      g.objectColor.host?.restore?.();
      // …and a previewed pattern goes back to its committed bake: nothing is
      // committing to re-render it away.
      restorePatternBrushPreview(g);
      return;
    }
    // PUSH commits through its own builder: it moved geometry and joints
    // rather than colour, so none of the accumulators below carry anything
    // (its island half rides along inside). The gate must count that island
    // half TOO (paint.rev): a push over nothing but raster paint moves no
    // rig and no path, and gating on those alone silently dropped the
    // stroke — the smear stayed on screen (the preview draws into the
    // committed island's own canvas) until the next commit re-rendered the
    // island from tiles that never changed, which read as "my second push
    // undid my first".
    if (g.kind === 'push') {
      const smeared = !!g.paint && g.paint.rev > 0;
      if (g.push && (pushStrokeChanged(g.push) || smeared)) {
        const se = buildPushStroke(stateRef.current, g.push, g.draft, g.paint);
        if (se) propsRef.current.onCommit(se);
        else restoreHostPush(g);
      } else {
        restoreHostPush(g);
      }
      return;
    }
    // Only overlays a stamp actually changed commit (rev 0 = the brush came
    // near the node but every dab landed at zero falloff or on same bytes).
    const changedOverlays = (p: OverlayPaintState) => new Map(
      [...p.overlays].filter(([, e]) => e.rev > 0)
        .map(([id, e]) => [id, e.overlay] as const),
    );
    // Put every previewed pattern back to its COMMITTED bake before the
    // commit lands. The re-render repaints the ones the stroke actually
    // changed in the same tick (their object identity moves, so the memoized
    // layer re-runs); a pattern the brush reached but left unchanged has no
    // identity change to trigger that, and would otherwise keep wearing the
    // preview. The restore is a cached bake, not a fresh one.
    restorePatternBrushPreview(g);
    const se = buildPaintStroke(
      stateRef.current, g.draft, g.textPaint.chars,
      changedOverlays(g.imagePaint), changedOverlays(g.shapePaint),
      g.paint && g.paint.rev > 0 ? g.paint : undefined,
      g.patternPaint.cells,
      g.objectColor,
    );
    if (se) propsRef.current.onCommit(se);
    // Nothing to commit: a figure the brush reached but did not change (a dab
    // that landed back on the colour already there) is still wearing the
    // preview, and no re-render is coming to take it off.
    else g.objectColor.host?.restore?.();
  };

  // ── Line / arc draft preview ──────────────────────────────────────
  // Screen-space, mutated through a ref like the freehand preview — no React
  // re-render per pointermove. Segments come from the SAME helpers the commit
  // uses (editorSession), so the draft can't drift from what lands on release;
  // only the cell→screen mapping happens here.

  /** The draft's stroke width in screen px, matched to what the committed
   *  SVGObject will render at — so the shape doesn't change weight on release.
   *  The engine's markup (buildSVGObjectContent) strokes at
   *  `SVG_STROKE_WIDTH * strokeScale` with `vector-effect="non-scaling-stroke"`,
   *  which neutralizes the viewBox transform but NOT the world container's CSS
   *  scale — so that scale is the only factor left. */
  const draftStrokeWidthPx = () =>
    SVG_STROKE_WIDTH * stateRef.current.strokeScale
    * worldLayerTransform(liveCameraRef.current, stateRef.current.viewport).scale;

  /** Path `d` for cell-space segments in SCREEN px — the engine's own path
   *  walk (buildPathD) driven through the camera instead of the SVG-unit
   *  scale, so the draft can't disagree with the committed markup about how a
   *  segment chain is emitted. The camera is a uniform y-down similarity, so
   *  arcs stay circular (one radius, unchanged sweep flag). */
  const segmentsToScreenPath = (segments: ReadonlyArray<PathSegment>): string => {
    const cam = liveCameraRef.current;
    const vp = stateRef.current.viewport;
    const ppc = pxPerCell(cam, vp);
    return buildPathD(segments, {
      point: (x, y) => { const p = worldToScreen(x, y, cam, vp); return [p.x, p.y]; },
      length: (v) => v * ppc,
    });
  };

  /** The drag's box in world cells with NO minimum-size gate. dragCellBbox's
   *  placement floor rejects a box that is flat in one axis, but a straight
   *  line draft IS flat — and the Dimensions HUD still labels it. */
  const draftCellBbox = (
    start: readonly [number, number], end: readonly [number, number],
  ): CellBbox => dragCellBbox(start, end, 0)
    ?? { cellX: start[0], cellY: start[1], cellWidth: 0, cellHeight: 0 };

  /** The draft's SVGSubtype — what decides which stroke width the COMMIT
   *  will dress it with (withNewShapeStyle: an open path always takes the
   *  remembered width, a closed shape while outlined, else width 0). */
  const shapeDraftSubtype = (g: Extract<Gesture, { mode: 'shape' }>): SVGSubtype => {
    if (g.tool === 'line') {
      return propsRef.current.lineToolMode === 'rectangle' ? 'rectangle' : 'line';
    }
    if (g.tool === 'polygon') {
      return polygonIsCircle(propsRef.current.polygonSides) ? 'circle' : 'polygon';
    }
    return propsRef.current.arcToolMode === 'circle' ? 'circle' : 'arc';
  };

  /** The screen-px width the committed object will actually render at —
   *  the remembered style's width once one has been set, the composition
   *  default until then — so nothing changes weight on release. A style
   *  that commits width 0 (fill only) keeps a 1px guide so the draft stays
   *  visible at all. */
  const draftStrokeWidthPxFor = (subtype: SVGSubtype): number => {
    const cells = newShapeDraftWidthCells(
      propsRef.current.newShapeStyle ?? DEFAULT_NEW_SHAPE_STYLE,
      subtype,
      stateRef.current.strokeScale,
    );
    const px = cells * BASE_CELL_PX
      * worldLayerTransform(liveCameraRef.current, stateRef.current.viewport).scale;
    return Math.max(px, 1);
  };

  /** Live mirrored draft: the orbit copies of the in-flight segments,
   *  drawn into one extra overlay path — the same maps the commit will
   *  apply (anchored on the draft's own bbox center), so the mirrors under
   *  the finger are exactly the mirrors that land. */
  const updateDraftMirrors = (
    segments: ReadonlyArray<PathSegment>, stroke: string, widthPx: number,
    fill: DraftFill | null = null,
  ) => {
    const path = draftMirrorPathRef.current;
    if (!path) return;
    const spec = canvasWideSymmetry(canvasSymmetrySpec());
    if (!spec || segments.length === 0) {
      path.setAttribute('d', '');
      return;
    }
    const bbox = computeSVGBbox(segments);
    const maps = symmetryAffineMaps(
      spec, compSnapStep(stateRef.current.gridLevel),
      bbox.cellX + bbox.cellWidth / 2, bbox.cellY + bbox.cellHeight / 2,
    );
    let d = '';
    for (const m of maps) {
      d += (d ? ' ' : '') + segmentsToScreenPath(mirroredSegments(segments, m));
    }
    path.setAttribute('d', d);
    path.setAttribute('stroke', stroke);
    path.setAttribute('stroke-width', String(widthPx));
    // The mirrors wear the draft's fill too, or a filled shape's copies
    // would read as wireframes beside a filled original.
    path.setAttribute('fill', fill ? rgbCss(fill.color) : 'none');
    path.setAttribute('fill-opacity', fill ? String(fill.opacity) : '1');
  };

  const clearDraftMirrors = () => draftMirrorPathRef.current?.setAttribute('d', '');

  const updateShapePreview = (g: Extract<Gesture, { mode: 'shape' }>) => {
    const path = shapePathRef.current;
    if (!path || !g.end) return;
    // The polygon slider's two end divisions are circle stops: the draft (and
    // the commit below) becomes the arc tool's inscribed circle.
    const segments = g.tool === 'line'
      ? lineShapeGeometry(g.start, g.end, propsRef.current.lineToolMode, stateRef.current.gridLevel).segments
      : g.tool === 'polygon'
        ? (polygonIsCircle(propsRef.current.polygonSides)
          ? arcShapeSegments(g.start, g.end, g.start, 'circle')
          : polygonShapeSegments(g.start, g.end, propsRef.current.polygonSides))
        : arcShapeSegments(g.start, g.end, g.center ?? g.start, propsRef.current.arcToolMode);
    // The ink the commit will wear (newShapeDraftColor): the remembered
    // outline ink, else the active colour — so no shape changes colour on
    // release either.
    const stroke = rgbCss(newShapeDraftColor(
      propsRef.current.newShapeStyle ?? DEFAULT_NEW_SHAPE_STYLE, propsRef.current.currentColor,
    ));
    const widthPx = draftStrokeWidthPxFor(shapeDraftSubtype(g));
    // …and the FILL the commit will wear (newShapeDraftFill): a shape that
    // lands filled is drawn filled under the finger, in the ink and at the
    // opacity it will land with, rather than as a wireframe that floods on
    // release. An open path, or an unfilled style, draws none — as before.
    const fill = newShapeDraftFill(
      propsRef.current.newShapeStyle ?? DEFAULT_NEW_SHAPE_STYLE, shapeDraftSubtype(g), propsRef.current.currentColor,
    );
    path.setAttribute('d', segmentsToScreenPath(segments));
    path.setAttribute('stroke', stroke);
    path.setAttribute('stroke-width', String(widthPx));
    path.setAttribute('fill', fill ? rgbCss(fill.color) : 'none');
    path.setAttribute('fill-opacity', fill ? String(fill.opacity) : '1');
    updateDraftMirrors(segments, stroke, widthPx, fill);
    // A line draft labels the STROKE's own box (the geometry may have forced
    // the drag onto an axis — see lineShapeGeometry — and a flat axis makes
    // the HUD show just the one changing dimension); other drafts label the
    // raw drag box.
    const first = segments[0];
    updateDimsHud(segments.length === 1 && first.kind === 'line'
      ? draftCellBbox([first.start[0], first.start[1]], [first.end[0], first.end[1]])
      : draftCellBbox(g.start, g.end));
  };

  const clearShapePreview = () => {
    hideDimsHud();
    shapePathRef.current?.setAttribute('d', '');
    clearDraftMirrors();
  };

  /** Advance a shape drag to the current cursor — line, rectangle, arc and
   *  circle all come through here.
   *
   *  Creation is FREEFORM, snap or no snap: the box is whatever the finger
   *  drew and the shape stretches to fill it — a circle dragged wide comes
   *  out wide, a hexagon dragged tall comes out tall, an arc dragged wide
   *  comes out a wide quarter-ellipse. NO shape's box is forced square any
   *  more; the arc was the last one, and it was squared only because an arc
   *  SEGMENT holds one radius — which the geometry now answers for itself
   *  by drawing the skewed case as a polyline (computeQuarterArcSegments).
   *
   *  With Grid Snap ON both ends land on grid intersections — snapPoint, and
   *  nothing else — and the box still stays whatever the finger drew: a
   *  snapped oval is an oval, a snapped arc an arc of the proportions it was
   *  dragged at, and a snapped line runs at whatever angle its two
   *  intersections make. Snap never constrains a shape's angle or aspect, so
   *  a line or arc draws the same in every format; only where its ends land
   *  follows the toggle. */
  const advanceShapeDrag = (g: Extract<Gesture, { mode: 'shape' }>, pt: { x: number; y: number }) => {
    const s = stateRef.current;
    const cam = liveCameraRef.current;
    const snap = gridSnapRef.current;
    if (!g.active) {
      g.active = true;
      const down = screenToWorld(g.downX, g.downY, cam, s.viewport);
      const origin = snapPoint(down.cellX, down.cellY, s.gridLevel, snap);
      // Both ends of a drag are clamped into the editable band (§7.3).
      g.start = regionClamp([origin.cellX, origin.cellY]);
      // Clear the selection when a shape drag begins (as Facet does), so the
      // outgoing object's outline doesn't hang over the new shape.
      const sel = propsRef.current.session;
      if (sel.selectedId || sel.selectedIds.length > 0) propsRef.current.onSelect(null);
    }
    const rawPt = screenToWorld(pt.x, pt.y, cam, s.viewport);
    const clampedPt = regionClamp([rawPt.cellX, rawPt.cellY]);
    const raw = { cellX: clampedPt[0], cellY: clampedPt[1] };
    const [sx, sy] = g.start;
    const end = snapPoint(raw.cellX, raw.cellY, s.gridLevel, snap);
    if (end.cellX === sx && end.cellY === sy) {
      // Degenerate — the cursor is inside the start's own grid square (or, off
      // snap, exactly on it). Drop any draft from an earlier frame rather than
      // leaving a stale one on screen: dragging back toward the origin must
      // shrink the shape away, and a release here settles as a tap.
      g.end = null;
      g.center = null;
      clearShapePreview();
      return;
    }
    g.end = regionClamp([end.cellX, end.cellY]);
    if (g.tool === 'arc') g.center = pickCenter(sx, sy, g.end[0], g.end[1]);
    updateShapePreview(g);
  };

  // ── Photos / text drag-to-place preview ───────────────────────────
  // A dashed marquee in the screen-space overlay, mutated through a ref like
  // the shape draft — no React state per pointermove (90 fps rule).

  const updatePlaceBoxPreview = (g: Extract<Gesture, { mode: 'placeBox' }>) => {
    const rect = placeBoxRectRef.current;
    if (!rect || !g.end) return;
    const cam = liveCameraRef.current;
    const vp = stateRef.current.viewport;
    const a = worldToScreen(g.start[0], g.start[1], cam, vp);
    const b = worldToScreen(g.end[0], g.end[1], cam, vp);
    rect.setAttribute('x', String(Math.min(a.x, b.x)));
    rect.setAttribute('y', String(Math.min(a.y, b.y)));
    rect.setAttribute('width', String(Math.abs(b.x - a.x)));
    rect.setAttribute('height', String(Math.abs(b.y - a.y)));
    updateDimsHud(draftCellBbox(g.start, g.end));
  };

  const clearPlaceBoxPreview = () => {
    hideDimsHud();
    placeBoxRectRef.current?.setAttribute('width', '0');
    placeBoxRectRef.current?.setAttribute('height', '0');
  };

  /** Advance a photos/text drag-to-place to the current cursor. Same rule as
   *  the shape drag: freeform off-grid by default, both corners on grid
   *  intersections when Grid Snap is on — so the new image / text box lands
   *  aligned, since the dragged rect becomes its bbox verbatim. */
  const advancePlaceBoxDrag = (g: Extract<Gesture, { mode: 'placeBox' }>, pt: { x: number; y: number }) => {
    const s = stateRef.current;
    const cam = liveCameraRef.current;
    const snap = gridSnapRef.current;
    if (!g.active) {
      g.active = true;
      const down = screenToWorld(g.downX, g.downY, cam, s.viewport);
      const origin = snapPoint(down.cellX, down.cellY, s.gridLevel, snap);
      // Both ends of a drag are clamped into the editable band (§7.3).
      g.start = regionClamp([origin.cellX, origin.cellY]);
      // Clear the selection when the drag begins (as a shape drag does), so
      // the outgoing object's outline doesn't hang over the new box.
      const sel = propsRef.current.session;
      if (sel.selectedId || sel.selectedIds.length > 0) propsRef.current.onSelect(null);
    }
    const raw = screenToWorld(pt.x, pt.y, cam, s.viewport);
    const end = snapPoint(raw.cellX, raw.cellY, s.gridLevel, snap);
    g.end = [end.cellX, end.cellY];
    updatePlaceBoxPreview(g);
  };

  // ── Pattern tool: create-region drag + tile painting ──────────────

  /** The pattern region rect rides the placeBox preview rect (same overlay
   *  element — only one of the two gestures can be live). */
  const updatePatternRegionPreview = (g: Extract<Gesture, { mode: 'patternRegion' }>) => {
    const rect = placeBoxRectRef.current;
    if (!rect || !g.region) return;
    const cam = liveCameraRef.current;
    const vp = stateRef.current.viewport;
    const a = worldToScreen(g.region.cellX, g.region.cellY, cam, vp);
    const b = worldToScreen(g.region.cellX + g.region.cellWidth, g.region.cellY + g.region.cellHeight, cam, vp);
    rect.setAttribute('x', String(Math.min(a.x, b.x)));
    rect.setAttribute('y', String(Math.min(a.y, b.y)));
    rect.setAttribute('width', String(Math.abs(b.x - a.x)));
    rect.setAttribute('height', String(Math.abs(b.y - a.y)));
    updateDimsHud(g.region);
  };

  /** Advance a pattern create-region drag: floor-snap the cell under the
   *  finger, normalize the rect inclusive of that cell, and clamp each axis
   *  to 16 cells — trimming the edge AWAY from the finger's travel so the
   *  rect stays glued to it (Facet's create-tool clamp). */
  const advancePatternRegionDrag = (g: Extract<Gesture, { mode: 'patternRegion' }>, pt: { x: number; y: number }) => {
    const s = stateRef.current;
    const cam = liveCameraRef.current;
    const step = compSnapStep(s.gridLevel);
    if (!g.active) {
      g.active = true;
      const down = screenToWorld(g.downX, g.downY, cam, s.viewport);
      g.anchor = [Math.floor(down.cellX / step) * step, Math.floor(down.cellY / step) * step];
      // Clear the selection when the drag begins, as placeBox does.
      const sel = propsRef.current.session;
      if (sel.selectedId || sel.selectedIds.length > 0) propsRef.current.onSelect(null);
    }
    const raw = screenToWorld(pt.x, pt.y, cam, s.viewport);
    const cx = Math.floor(raw.cellX / step) * step;
    const cy = Math.floor(raw.cellY / step) * step;
    let startX = Math.min(g.anchor[0], cx);
    let endX = Math.max(g.anchor[0], cx) + step;
    let startY = Math.min(g.anchor[1], cy);
    let endY = Math.max(g.anchor[1], cy) + step;
    const max = step * MAX_PATTERN_GRID;
    if (endX - startX > max) { if (cx >= g.anchor[0]) endX = startX + max; else startX = endX - max; }
    if (endY - startY > max) { if (cy >= g.anchor[1]) endY = startY + max; else startY = endY - max; }
    g.region = { cellX: startX, cellY: startY, cellWidth: endX - startX, cellHeight: endY - startY };
    updatePatternRegionPreview(g);
  };

  /** Swap a mounted pattern <svg>'s markup for the bake of `p` — the same
   *  recipe PatternNodeLayer renders (patternLayerMarkup: the cells in the
   *  node's own space, the viewBox over its local box), so a stroke
   *  previews where its commit renders. */
  const mountPatternMarkup = (svg: SVGSVGElement, p: PatternObject) => {
    const { viewBox, html } = patternLayerMarkup(drawnLeafOf('pattern', p), stateRef.current.strokeScale);
    svg.setAttribute('viewBox', viewBox);
    svg.innerHTML = html;
  };

  /** Re-bake the working copy into the pattern node's mounted <svg> — the
   *  stroke's live preview, an imperative innerHTML swap (never React
   *  state; see the 90 fps notes at the top). */
  const updatePatternPaintPreview = (g: Extract<Gesture, { mode: 'patternPaint' }>) => {
    const svg = nodeEl(g.patternId)?.querySelector('svg');
    if (svg) mountPatternMarkup(svg, g.working);
  };

  /** Swap one pattern's mounted markup for the bake of `cells`. */
  const mountPatternCells = (p: PatternObject, cells: PatternObject['cells']) => {
    const svg = nodeEl(p.id)?.querySelector('svg');
    if (svg) mountPatternMarkup(svg, cells === p.cells ? p : { ...p, cells });
  };

  /** The same live swap for a SHAPE a stroke is recolouring: its node draws
   *  the outline, the fill and the clipped pattern tiles together — one
   *  `<svg>`, or two halves round a paint canvas once it carries paint —
   *  so the whole of it is re-mounted (mountShapeMarkup, off the readers
   *  NodeLayer draws from, in whichever form the node is in) rather than
   *  any one of the three alone. That is the point of the route: a
   *  preview that redraws the shape AS the shape cannot lose the parts it
   *  isn't changing, the way a silhouette drawn over the node loses the
   *  cloth and half the outline under it. The content svgs live in the
   *  node's paint host: an unfilled shape casting a drop shadow draws its
   *  ring in a sibling before it.
   *
   *  `preview` is that shape as the stroke has it so far — the committed
   *  record with brushed cells or a brushed fill on it. It stands in for
   *  the node's own content and for nothing else: the GEOMETRY still comes
   *  off the committed node (its local segments, its box, its world
   *  matrix), which is why a cell edit or a recolour may ride this route
   *  and a move may not. */
  const mountShapeContent = (preview: SVGObject) => {
    const committed = stateRef.current.svgObjects.find((o) => o.id === preview.id);
    if (!committed) return;
    const host = nodeEl(preview.id)?.querySelector<HTMLElement>('[data-paint-host]');
    if (!host) return;
    // The node BY ID, off the graph — the frame React placed this host's
    // element in. Not drawnLeafFor(committed): a member of a TURNED group
    // is rendered back out of the graph as a fresh legacy record (its
    // world-baked vertices), not as the node's own content, so the
    // identity check there fails and it draws the record in world axes —
    // which, written into an element the group's turn already rotates,
    // came out turned twice and stretched to the box. Every patch a
    // colour stroke reached on a grouped, rotated Patchwork page skewed
    // mid-stroke and stayed skewed until the page was reopened (bug
    // report b86a0076).
    const d = drawnLeaf(graphOf(stateRef.current), preview.id);
    if (!d) return;
    mountShapeMarkup(
      host, d, stateRef.current.strokeScale,
      svgDrawnGeometry(d, preview === committed ? undefined : preview),
    );
  };


  /**
   * Live-preview the COLOR BRUSH over the tile grids it has tinted: re-bake
   * each one and swap its markup, the same innerHTML route the pattern
   * tool's own painting takes.
   *
   * Two things carry a grid and the brush reaches both, addressed alike by
   * id (engine/shapePatternFill.ts): a loose pattern OBJECT, whose node is
   * the grid, and a closed SHAPE's pattern FILL, whose node is the shape —
   * so the shape's whole markup is what gets re-mounted there, outline and
   * fill and clipped tiles together.
   *
   * A bake is millisecond work and the frame budget is 11, so this re-bakes
   * only the grids whose cells a stamp actually moved — `rev` is bumped
   * per grid per changed stamp, and a drag continuing across cells it has
   * already painted therefore costs nothing at all.
   */
  const updatePatternBrushPreview = (g: Extract<Gesture, { mode: 'paint' }>) => {
    for (const [patternId, cellMap] of g.patternPaint.cells) {
      const rev = g.patternPaint.rev.get(patternId) ?? 0;
      if (g.patternPreviewRev.get(patternId) === rev) continue;
      g.patternPreviewRev.set(patternId, rev);
      const ref = findItem(stateRef.current, patternId);
      if (!ref) continue;
      const shape = ref.kind === 'svg' ? ref.item : null;
      const fill = shape?.patternFill;
      const base = ref.kind === 'pattern' ? ref.item.cells : fill?.cells;
      if (!base) continue;
      const cells = base.slice();
      for (const [index, color] of cellMap) {
        const cell = cells[index] ?? null;
        if (!cell || cell.type !== 'sprite') continue;
        cells[index] = color === null
          ? { ...cell, tintR: undefined, tintG: undefined, tintB: undefined }
          : tintedPatternCell(cell, color);
      }
      if (ref.kind === 'pattern') mountPatternCells(ref.item, cells);
      else if (shape && fill) mountShapeContent(withShapePatternFill(shape, { ...fill, cells }));
    }
  };

  /** Put every previewed grid back to the committed record's own bake
   *  (WeakMap-cached, so no re-bake happens here). */
  const restorePatternBrushPreview = (g: Extract<Gesture, { mode: 'paint' }>) => {
    for (const patternId of g.patternPreviewRev.keys()) {
      const ref = findItem(stateRef.current, patternId);
      if (ref?.kind === 'pattern') mountPatternCells(ref.item, ref.item.cells);
      else if (ref?.kind === 'svg') mountShapeContent(ref.item);
    }
    g.patternPreviewRev.clear();
  };

  /** Apply the active pattern sub-tool at the pattern cell under `pt`,
   *  accumulating the edits on the gesture. Each grid cell takes at most
   *  one application per stroke (the old editor's within-stroke dedupe). */
  const applyPatternToolAtPoint = (g: Extract<Gesture, { mode: 'patternPaint' }>, pt: { x: number; y: number }) => {
    const s = stateRef.current;
    const raw = screenToWorld(pt.x, pt.y, liveCameraRef.current, s.viewport);
    // Into the grid's own frame, then the BAKE undone there: the frame's
    // object is the grid at its local box with the pose stripped, and its
    // cols/rows/box stand still all stroke (only cells change), so the
    // working copy's edits never move the cell under the finger.
    const [hx, hy] = g.frame.toLocal(raw.cellX, raw.cellY);
    const cell = patternCellAtWorldPoint(g.frame.object as PatternObject, hx, hy);
    if (!cell) return;
    const key = cell.y * g.working.cols + cell.x;
    if (g.painted.has(key)) return;
    g.painted.add(key);
    const edits = patternApplyToolAt(
      g.working, cell.x, cell.y,
      propsRef.current.patternSubTool ?? { kind: 'random' },
      propsRef.current.patternExcludedFamiliesOf?.(g.working.tileSets),
      // The tile arrives in the colour the toolbar is showing, the way a
      // drawn stroke does — the pattern tool is a brush like any other.
      propsRef.current.currentColor,
    );
    if (edits.length === 0) return;
    g.working = applyPatternCellEdits(g.working, edits);
    // Merge into the stroke's edit list: an index edited twice keeps its
    // FIRST oldState (what undo restores) and the LAST newState.
    for (const e of edits) {
      const prior = g.edits.find((x) => x.index === e.index);
      if (prior) prior.newState = e.newState;
      else g.edits.push({ ...e });
    }
    updatePatternPaintPreview(g);
  };

  /** Commit (or abandon) a pattern paint stroke as one undo step. */
  const finishPatternPaint = (g: Extract<Gesture, { mode: 'patternPaint' }>, cancelled: boolean) => {
    if (cancelled || g.edits.length === 0) {
      // Put the mounted markup back to the committed object's bake.
      const ref = findItem(stateRef.current, g.patternId);
      if (ref?.kind === 'pattern') {
        const svg = nodeEl(g.patternId)?.querySelector('svg');
        if (svg) mountPatternMarkup(svg, ref.item);
      }
      return;
    }
    const se = buildEditPatternCells(stateRef.current, g.patternId, g.edits);
    if (!se) return;
    // A Close stroke that mirrored under the toolbar's canvas Symmetry
    // writes those rules onto the pattern in the same undo step (Flood's
    // "and they stick"), so the brush that follows paints under the mode
    // the repairs just closed by. Only a stroke that edited something
    // commits — an idle tap still leaves no undo entry.
    const settings = g.symmetry
      ? buildSetPatternSettings(stateRef.current, g.patternId, { symmetry: g.symmetry })
      : null;
    propsRef.current.onCommit(settings
      ? { ...se, entry: [...settings.entry, ...se.entry] }
      : se);
  };

  // ── Tile tool stroke (one connecting tile per grid cell crossed) ──

  /** Stamp one tile into the grid cell holding world point (`wx`, `wy`),
   *  against the stroke's WORKING scene — so each pick connects to the
   *  stamps before it — and mount its live preview. Each cell takes at
   *  most one stamp per stroke (the pattern stroke's own dedupe).
   *  Re-rolled object ids land in `dirty` for the CALLER to re-bake once
   *  the whole trail segment has stamped — the trail may cross a big
   *  absorbed grid many cells in one event, and one innerHTML bake per
   *  event is plenty (90 fps rule). */
  const stampTileAtWorld = (
    g: Extract<Gesture, { mode: 'tileStamp' }>, wx: number, wy: number, dirty: Set<string>,
  ) => {
    const s = stateRef.current;
    const sub = propsRef.current.patternSubTool;
    // The EDITABLE pattern, when its grid is not the composition grid (the
    // Edit capsule's target, off-lattice or turned): the stamp is in ITS space
    // — a cell of it re-rolls, a point past its edge grows it
    // (buildPlaceTileInPattern) — never a loose tile of the current step
    // laid over it. Deduped per pattern cell.
    const target = tileTargetPattern(
      g.working, propsRef.current.tileEditPatternId, s.gridLevel);
    if (target) {
      const cell = tileCellInPattern(target, wx, wy, graphOf(stateRef.current));
      if (!cell) return;
      const key = `${target.id}:${cell.col},${cell.row}`;
      if (g.stamped.has(key)) return;
      g.stamped.add(key);
      // A shape's pattern FILL keeps its own ink (patternEditInk): the
      // brush reshapes cloth, it does not recolour it.
      const se = buildPlaceTileInPattern(
        g.working, target.id, wx, wy, patternEditInk(g.working, target.id, propsRef.current.currentColor),
        propsRef.current.patternExcludedFamiliesOf?.(target.tileSets),
        sub?.kind === 'tile' ? { spriteId: sub.spriteId, transform: sub.transform } : undefined,
      );
      if (!se) return;
      g.working = applyCompOps(g.working, se.entry);
      g.ops.push(...se.entry);
      g.touched.add(target.id);
      dirty.add(target.id);
      // A grown grid is a new box: the committed node can't show it, so
      // it hides behind a preview of the working grid until the commit
      // re-renders (or the cancel restores it).
      if (se.entry.some((op) => op.op !== 'editPatternCells')) {
        const el = nodeEl(target.id);
        if (el) el.style.visibility = 'hidden';
        (g.grown ??= new Map()).set(target.id, g.grown?.get(target.id) ?? el ?? document.createElement('div'));
        // The grid is a new box NOW, not on release: the selection outline
        // and the symmetry axes (which live inside that box) follow the
        // working grid on every stamp (the cancel puts them back).
        previewGrownPatternChrome(g.working, target.id);
      }
      return;
    }
    const step = compSnapStep(s.gridLevel);
    const key = `${Math.floor(wx / step)},${Math.floor(wy / step)}`;
    if (g.stamped.has(key)) return;
    g.stamped.add(key);
    const se = buildPlaceTile(
      g.working, wx, wy, s.gridLevel,
      propsRef.current.currentColor,
      // A loose stamp either grows the grid that is open for editing —
      // whose families are its own — or mints a 1×1 made of the defaults.
      propsRef.current.patternExcludedFamiliesOf?.(
        patternGridOf(g.working, propsRef.current.tileEditPatternId ?? '')?.tileSets,
      ),
      seededPatternStroke(propsRef.current.newShapeStyle ?? DEFAULT_NEW_SHAPE_STYLE, s.strokeScale ?? 1),
      // The canvas Symmetry setting: each stamp of the stroke mirrors
      // about the symmetry frame, partners riding the same entry.
      canvasSymmetrySpec(),
      // A specific tile armed (the radial's Choose fan) is what the stroke
      // lays — pose and all — instead of the connectivity roll.
      sub?.kind === 'tile' ? { spriteId: sub.spriteId, transform: sub.transform } : undefined,
      // …and the only grid on the page a stamp may rework in place.
      propsRef.current.tileEditPatternId,
    );
    if (!se) return;
    g.working = applyCompOps(g.working, se.entry);
    g.ops.push(...se.entry);
    for (const op of se.entry) {
      if (op.op === 'placeObject' && op.kind === 'pattern') {
        mountTileStampPreview(g, op.item as PatternObject);
      } else if (op.op === 'editPatternCells') {
        // The stroke crossed a cell already holding a tile: it re-rolls in
        // place, previewed by re-baking the working object's cells into the
        // mounted node — patternPaint's own innerHTML route (deferred to
        // the caller via `dirty`).
        g.touched.add(op.patternId);
        dirty.add(op.patternId);
      }
    }
  };

  /** The selection outline and the symmetry axes re-anchored on the pattern
   *  as it stands in `working` — a grid grown mid-stroke, or the committed
   *  one again on cancel. The outline keeps its rotation (about the new
   *  centre, as the node turns); the axes model is rebuilt from the
   *  working box and written through the one axes writer. */
  const previewGrownPatternChrome = (working: CompositionState, patternId: string) => {
    if (propsRef.current.session.selectedId === patternId) {
      const sel = resolveSelectionBox(working, patternId);
      if (sel) setOutlineBox(sel.bbox);
    }
    writeAxesForState(working);
  };

  /** Stamp every grid cell the pointer trail crossed since the previous
   *  event: the segment from the last event's world point to this one is
   *  walked at half-step intervals (paintStampPoints with the grid step as
   *  the "radius" — the paint brushes' own interpolation, jank cap and
   *  all), so a fast drag fills a continuous run of cells instead of
   *  scattering islands where the (sparse) pointer events happened to
   *  land. */
  const stampTileTrail = (g: Extract<Gesture, { mode: 'tileStamp' }>, pt: { x: number; y: number }) => {
    const s = stateRef.current;
    const raw = screenToWorld(pt.x, pt.y, liveCameraRef.current, s.viewport);
    // The trail walks at the finer of the composition step and the target
    // pattern's own cell, so a stroke across a fine off-lattice grid fills
    // every cell it crosses.
    const target = tileTargetPattern(
      g.working, propsRef.current.tileEditPatternId, s.gridLevel);
    const step = Math.min(
      compSnapStep(s.gridLevel),
      target ? Math.min(target.cellWidth / target.cols, target.cellHeight / target.rows) : Infinity,
    );
    const dirty = new Set<string>();
    const prev = g.last;
    g.last = { x: raw.cellX, y: raw.cellY };
    for (const [x, y] of paintStampPoints(
      prev ? [prev.x, prev.y] : null, [raw.cellX, raw.cellY], step,
    )) {
      stampTileAtWorld(g, x, y, dirty);
    }
    for (const id of dirty) {
      const ref = findItem(g.working, id);
      // A shape's pattern FILL: the grid lives on the shape, so the
      // SHAPE's node is what gets re-mounted (and it can never have
      // grown — a fill's grid is the shape's box).
      if (ref?.kind === 'svg') { mountShapeContent(ref.item); continue; }
      if (ref?.kind !== 'pattern') continue;
      if (g.grown?.has(id)) {
        // The grown grid's preview is re-mounted whole: its box may have
        // changed again, and the hidden committed node can't be re-baked into.
        const stale = g.previewEls.findIndex((el) => el.dataset.grownPreview === id);
        if (stale >= 0) { g.previewEls[stale].remove(); g.previewEls.splice(stale, 1); }
        mountTileStampPreview(g, ref.item, id);
      } else {
        mountPatternCells(ref.item, ref.item.cells);
      }
    }
  };

  /** Mount a NEW stamp's live preview: the same positioned wrapper + <svg>
   *  markup PatternNodeLayer renders, created imperatively because the
   *  object is not committed yet, so there is no React node to re-bake
   *  into (90 fps rule — no React state during the stroke). */
  const mountTileStampPreview = (
    g: Extract<Gesture, { mode: 'tileStamp' }>, item: PatternObject, grownId?: string,
  ) => {
    const world = worldRef.current;
    if (!world) return;
    // The outer box on the world AABB and the inner element placed by the
    // matrix — the two elements PatternNodeLayer renders, from the same
    // pose reading (drawnFrame), so a grown grid keeps its free turn
    // exactly where the layer will draw it.
    const drawn = drawnLeafOf('pattern', item);
    const frame = drawnFrame(drawn, BASE_CELL_PX);
    const { viewBox, html } = patternLayerMarkup(drawn, stateRef.current.strokeScale);
    const el = document.createElement('div');
    el.style.position = 'absolute';
    el.style.left = `${frame.outer.left}px`;
    el.style.top = `${frame.outer.top}px`;
    el.style.width = `${frame.outer.width}px`;
    el.style.height = `${frame.outer.height}px`;
    el.style.pointerEvents = 'none';
    if (grownId) el.dataset.grownPreview = grownId;
    el.innerHTML = `<div style="position:absolute;left:0;top:0;width:${frame.inner.width}px;height:${frame.inner.height}px;transform:${frame.inner.transform};transform-origin:0 0">`
      + `<svg width="100%" height="100%" viewBox="${viewBox}" preserveAspectRatio="none" style="position:absolute;inset:0;overflow:visible;display:block">${html}</svg></div>`;
    world.appendChild(el);
    g.previewEls.push(el);
  };

  /** Commit (or abandon) a tile stroke as ONE undo step and tear the
   *  imperative previews down — the commit's own render replaces them in
   *  the same event flush, so nothing flashes. Committed WITHOUT the
   *  auto-selection, like a freehand stroke: a run of stamps should not
   *  leave a selection box and the properties panel over the line just
   *  laid. */
  const finishTileStamp = (g: Extract<Gesture, { mode: 'tileStamp' }>, cancelled: boolean) => {
    for (const el of g.previewEls) el.remove();
    // A grown pattern's committed node comes back either way: the commit
    // re-renders it at its new box in the same flush, the cancel leaves it
    // as it was.
    for (const el of g.grown?.values() ?? []) el.style.visibility = '';
    if (cancelled) {
      // A grown grid's outline and axes were previewing the working box;
      // back onto the committed one (the commit's render does this itself).
      for (const id of g.grown?.keys() ?? []) previewGrownPatternChrome(stateRef.current, id);
      // Any re-rolled EXISTING tiles had their mounted markup swapped for
      // the working preview; put the committed bake back. (On a real commit
      // React re-renders them from the new cells, so no restore is needed.)
      for (const id of g.touched) {
        const ref = findItem(stateRef.current, id);
        if (ref?.kind === 'pattern') mountPatternCells(ref.item, ref.item.cells);
      }
      return;
    }
    if (g.ops.length === 0) return;
    // ONE gesture leaves ONE object: the stroke's fresh 1×1 stamps merge
    // into a single multi-cell pattern (per symmetry-orbit region), and the
    // pattern OPEN FOR EDITING, where the stroke touches it, is grown in
    // place instead of getting a new object beside it (see
    // mergeTileStrokeOps). Every other pattern on the page is left exactly
    // as it stands; other re-rolls pass through.
    propsRef.current.onCommit(mergeTileStrokeOps(
      stateRef.current, { entry: g.ops }, propsRef.current.tileEditPatternId));
  };

  // ── Marquee selection preview (arrange tool) ──────────────────────
  // A dashed rect in the screen-space overlay, mutated through a ref like the
  // other drag previews (90 fps rule). The rect lives in screen px; the
  // release converts its corners to world cells for the hit query.

  const updateMarqueePreview = (g: Extract<Gesture, { mode: 'marquee' }>, pt: { x: number; y: number }) => {
    const rect = marqueeRectRef.current;
    if (!rect) return;
    rect.setAttribute('x', String(Math.min(g.downX, pt.x)));
    rect.setAttribute('y', String(Math.min(g.downY, pt.y)));
    rect.setAttribute('width', String(Math.abs(pt.x - g.downX)));
    rect.setAttribute('height', String(Math.abs(pt.y - g.downY)));
  };

  const clearMarqueePreview = () => {
    marqueeRectRef.current?.setAttribute('width', '0');
    marqueeRectRef.current?.setAttribute('height', '0');
  };

  /** The marquee's world-cell rect from its two screen corners. */
  const marqueeCellRect = (g: Extract<Gesture, { mode: 'marquee' }>, pt: { x: number; y: number }): CellBbox => {
    const cam = liveCameraRef.current;
    const vp = stateRef.current.viewport;
    const a = screenToWorld(g.downX, g.downY, cam, vp);
    const b = screenToWorld(pt.x, pt.y, cam, vp);
    return {
      cellX: Math.min(a.cellX, b.cellX),
      cellY: Math.min(a.cellY, b.cellY),
      cellWidth: Math.abs(b.cellX - a.cellX),
      cellHeight: Math.abs(b.cellY - a.cellY),
    };
  };

  // ── Combined-box (multi-selection) drag ───────────────────────────

  /** The multi-drag's effective delta in world cells: the combined box's
   *  ORIGIN is the snap anchor, the way a single node's bbox origin is. */
  const multiDragDeltaCells = (box: CellBbox, dxPx: number, dyPx: number) => {
    const s = stateRef.current;
    const ppc = pxPerCell(liveCameraRef.current, s.viewport);
    return snapDragDelta(box, dxPx / ppc, dyPx / ppc, s.gridLevel, gridSnapRef.current);
  };

  /**
   * Draw a unit gesture live: `entry` is what the release will commit, and
   * each leaf under it takes the relative matrix between where it stands
   * and where the graph puts it (previewGesture). One path for a twist and
   * a corner resize, a bound group and a loose selection alike. Leaves the
   * entry does not move are put back, so a drag that returns to its start
   * shows nothing moved.
   */
  const applyGesturePreview = (ids: readonly string[], entry: CompUndoEntry | undefined) => {
    const moved: ReadonlyMap<string, PreviewPose> = entry
      ? previewGesture(stateRef.current, entry) : new Map();
    // A leaf the gesture pulls OFF SQUARE cannot be drawn by composing that
    // map on its element: a CSS transform sits above the element's own
    // matrix, and a frame that is not a similarity stretches the stroke
    // weights inside it (docs/transform-refactor.md §9.10). Those leaves go
    // through React at their new WORLD matrix, which is the reading the
    // release renders — the shape shears under the finger and the lines
    // stay the weight they will land at. Everything else keeps the cheap
    // element write: a drag, a twist and a uniform stretch are all
    // similarities, and a similarity composed on top of the leaf's own
    // matrix leaves the same total as re-drawing would (90 fps rule — the
    // re-draw is reserved for the one gesture that has no other answer).
    //
    // …except a node a HOST stands in for: it has no element, so it never
    // takes the element write, and it must not go through React either —
    // the stand-in takes whatever the map says, and an off-square stretch
    // thickens its strokes for the length of the drag the way a frame's
    // preview does, settling on the commit's render.
    const targets = previewTargets(ids);
    let posed: Map<string, Mat2D> | null = null;
    for (const [id, pose] of moved) {
      if (!matIsSimilarity(pose.css) && !standInFor(id)) (posed ??= new Map()).set(id, pose.world);
    }
    for (const id of targets.own) {
      const el = nodeEl(id);
      if (!el) continue;
      const pose = posed?.has(id) ? undefined : moved.get(id);
      el.style.transform = pose ? cssMatrix(pose.css, BASE_CELL_PX) : '';
    }
    // One write per stand-in, from its driving member's previewed pose,
    // mapped into the host's own element space by the host.
    for (const { standIn, driverId } of targets.standIns) {
      const el = standIn.el();
      if (!el) continue;
      const pose = moved.get(driverId);
      const css = pose ? standIn.css(driverId, pose.world) : null;
      el.style.transform = css ? cssMatrix(css, BASE_CELL_PX) : '';
    }
    setLivePose(posed);
  };

  /**
   * Hand a host layer the entry a multi gesture in flight WOULD commit, so
   * it can draw its own things where the release will put them
   * (`GestureHooks.previewSelectionEntry`): DrawBot's bots and instruction
   * tiles ride a mixed group's drag, twist and corner resize under the
   * finger with the shapes. A null `entry` ends the preview.
   *
   * The entry rides as a THUNK and the ids go with it, because this runs
   * per pointer move and building one is a reducer pass over every member:
   * whether this gesture moves anything of the host's is the host's own
   * question, so it gates on the ids and calls the thunk only if it has
   * something to draw. Two of the three gestures have built the entry for
   * their own preview by then and the thunk hands that one over; the drag
   * previews with a plain translate and would otherwise pay for an entry
   * nobody reads.
   */
  const previewSelectionEntry = (
    ids: readonly string[], entry: (() => SessionEntry | null) | null,
  ) => {
    propsRef.current.gestures?.previewSelectionEntry?.(ids, entry);
  };

  /** Tear down a multi-drag's live preview: clear every member's transform
   *  and re-anchor the combined outline on the committed geometry — React's
   *  reconciler skips DOM writes for props unchanged since the last render,
   *  so the drag's inline mutations have to be put back by hand. */
  const resetMultiDragEls = (ids: readonly string[]) => {
    hideDimsHud();
    previewSelectionEntry(ids, null);
    // Drop any off-square re-draw: the committed render (or, on a cancel,
    // the standing one) is the source of truth again. Already-null bails
    // out of React without a render, so an ordinary drag costs nothing.
    setLivePose(null);
    const targets = previewTargets(ids);
    for (const id of targets.own) {
      const el = nodeEl(id);
      if (el) el.style.transform = '';
    }
    for (const { standIn } of targets.standIns) {
      const el = standIn.el();
      if (el) el.style.transform = '';
    }
    if (selectionOutlineRef.current) {
      const outline = selectionOutlineRef.current;
      const frame = resolveMultiSelectionFrame(
        stateRef.current, ids, propsRef.current.session.hostDoc);
      if (frame) setOutlineBox(frame.bbox);
      outline.style.transform = outlineGestureTransform('', frame?.angleDeg ?? 0);
      // A multiManipulate counter-scales the outline chrome; put it back.
      outline.style.removeProperty(LIVE_INV_VAR);
    }
  };

  const beginTwoPointerGesture = () => {
    const pointers = pointersRef.current;
    if (pointers.size !== 2) return false;
    const g = gestureRef.current;
    // A second finger ends a press a host's hook CLAIMED: the pair is a
    // two-finger gesture now — a twist of that very thing, or the camera's
    // — and the claimed finger's moves must stop feeding the hook. It is a
    // TAKEOVER, not a cancel: only the host knows how to settle one (a rig
    // commits a pose that moved, the canvas having already shown it, and
    // abandons an untouched grab).
    const claimed = claimedPointerRef.current;
    if (claimed) {
      claimedPointerRef.current = null;
      const at = pointers.get(claimed.pointerId);
      if (at) propsRef.current.gestures?.onPointerUp?.(at.x, at.y, 'takeover');
    }
    // Abort any in-flight single-pointer interaction cleanly.
    if (g.mode === 'drag') { resetDragEl(g.nodeId); resetSymmetryPeerEls(g.peers); }
    // A second finger abandons a marquee / combined-box drag the same way.
    if (g.mode === 'marquee') clearMarqueePreview();
    if (g.mode === 'multiDrag') { resetMultiDragEls(g.ids); resetSymmetryPeerEls(g.peers); }
    // A second finger turns a corner drag into a pinch/manipulate: drop the
    // resize preview, or the node would stay stuck at a size nothing ever
    // commits (the gesture that would have committed it is gone).
    if (g.mode === 'resize') dropAnyResizePreview(g);
    if (g.mode === 'multiResize') resetMultiDragEls(g.ids);
    if (g.mode === 'draw') clearDrawPreview();
    // A second finger abandons an in-flight shape draft (it becomes a
    // pinch/manipulate) — drop the preview without committing.
    if (g.mode === 'shape') clearShapePreview();
    if (g.mode === 'placeBox') clearPlaceBoxPreview();
    // Finalize an in-flight paint stroke as one undo step before the
    // two-finger gesture takes over (Facet commits the active gesture before
    // a pinch the same way) — the stroke painted real color the preview was
    // already showing, so dropping it would surprise more than keeping it.
    // A stroke that has stamped NOTHING yet is abandoned instead: the second
    // finger arrived before the first had painted, which is a pinch (or a
    // two/three-finger undo tap) rather than a stroke, and it must leave the
    // page as it found it.
    if (g.mode === 'paint') finishPaintStroke(g, !g.stamped);
    // Same rule for a pattern stroke: stamped tiles commit as one step, an
    // untouched grab is abandoned (the second finger means pinch).
    if (g.mode === 'patternPaint') finishPatternPaint(g, !g.stamped);
    // …and for a tile stroke: cells already stamped commit as one step, an
    // untouched press is abandoned (the second finger means pinch).
    if (g.mode === 'tileStamp') finishTileStamp(g, !g.active);
    // A second finger abandons an in-flight create-region draft too.
    if (g.mode === 'patternRegion') clearPlaceBoxPreview();
    // Finalize an in-flight crop pan as one undo step before the two-finger
    // gesture takes over, so its live preview isn't stranded uncommitted.
    if (g.mode === 'cropPan') {
      const ppc = pxPerCell(liveCameraRef.current, stateRef.current.viewport);
      propsRef.current.onCropPan(g.nodeId, g.dx / ppc, g.dy / ppc, true);
    }
    // The second finger turns the first finger's press into a CAMERA
    // gesture — so any selection that press just made is unwound here,
    // back to what stood selected before the touch (prevSelection, kept on
    // the aborted gesture). Two fingers must never pick an object nobody
    // had tapped; gating the twist on "already selected" alone was not
    // enough, because the first finger's own down had just selected the
    // object it landed on. The restored set is ALSO what the twist gate
    // below reads — propsRef.current.session still carries the
    // press-selection until the shell re-renders.
    let sel: { selectedId: string | null; selectedIds: readonly string[] } =
      propsRef.current.session;
    // A claimed press can have selected too (a rig's joint grab is a grab
    // on that figure), so the claim carries its own `prevSelection`.
    const prev = (g.mode === 'drag' || g.mode === 'multiDrag') ? g.prevSelection
      : claimed?.claim.prevSelection;
    if (prev) {
      sel = prev;
      if (prev.selectedIds.length >= 2) {
        propsRef.current.onSelectMany([...prev.selectedIds]);
      } else {
        propsRef.current.onSelect(prev.selectedId);
      }
    }
    const [[aId, a], [bId, b]] = [...pointers.entries()];

    // No tool active: two fingers only ever work the camera. Checked before
    // the crop and twist cases (the single-pointer router has the same
    // guard) so nothing on the page can be rotated.
    if (!propsRef.current.session.activeTool) {
      gestureRef.current = {
        mode: 'pinch', startCamera: liveCameraRef.current,
        aId, bId, a0: { ...a }, b0: { ...b },
      };
      return true;
    }

    // Crop bar open: a two-finger pinch on that image zooms its crop instead
    // of the camera — inside the crop bar the framing IS what a pinch is for,
    // and the canvas camera is not what the fingers are reaching for. Checked
    // before the twist/pinch cases so it wins whenever both fingers are on
    // the crop target.
    const cropId = propsRef.current.cropPanNodeId;
    if (cropId) {
      const ha = hitTestAt(a);
      const hb = hitTestAt(b);
      if (ha && hb && ha.id === cropId && hb.id === cropId) {
        propsRef.current.onSelect(cropId);
        gestureRef.current = {
          mode: 'cropZoom', nodeId: cropId, aId, bId,
          startDist: Math.hypot(b.x - a.x, b.y - a.y), factor: 1,
        };
        return true;
      }
    }

    // The twist: if BOTH fingers land inside the same ALREADY-SELECTED
    // object's bbox and that object is two-finger manipulable (an unlocked
    // svg/image/text that isn't its frame's backdrop — see
    // canTwoPointerManipulate), the pair's ROTATION turns the object
    // instead of the gesture zooming the view. Rotation only — the finger
    // separation is never read, so a pinch can't scale anything (that is
    // what got two-finger scale removed). Selected only — two fingers land
    // on the page to work the camera far more often than to rotate, and
    // hit-testing whatever sat under the pair used to SELECT it mid-zoom:
    // a two-finger gesture must never pick an object nobody had tapped,
    // so with nothing selected the fingers are the camera's and the
    // selection stays untouched. Everything else — empty canvas, an
    // unselected object, a figure, a locked node, or a frame's backdrop —
    // falls through to the camera pinch below, so two fingers on the
    // page's full-bleed photo still pan / zoom the view. `sel` is the
    // restored pre-press selection from above, NOT the props' session —
    // the first finger's down may have just selected the very object
    // under the pair, and that press-selection must not open the twist.
    const isSelected = (id: string) => selectionContains(sel, id);
    const hitA = hitTestAt(a);
    const hitB = hitTestAt(b);

    // A GROUP or a MULTI-SELECTION is one unit on the canvas (a tap on a
    // group selects it whole, filling selectedIds with every member; a
    // marquee or a shift-tap fills it with the chosen nodes), and two
    // fingers landing anywhere inside the unit's COMBINED BOX — on one
    // member, on two different members, or on the empty space between
    // them — rotate the whole unit about its combined centre. The box, not
    // a pixel hit: a one-finger grab owns that box outright (beginMultiDrag),
    // and two fingers on line art seldom both land on ink, so a twist gated
    // on both hitting a member never opened — and a loose multi-selection,
    // whose members share no group, never had a path here at all. Gated on
    // EVERY member being two-finger manipulable: a unit holding a figure or
    // a locked node has no whole-unit transform, and rotating one member
    // out of it would break the very unity the selection promises, so the
    // gesture falls through to the camera pinch instead. `sel` is the
    // restored pre-press selection (see above), so a press that had just
    // multi-selected nothing can't open this.
    //
    // How much of the SCREEN the box covers decides nothing here: the twist
    // works the same at every zoom level, exactly as the single-object case
    // below already did. A coverage cap used to stand in this gate so a box
    // with no page left around it could not take the camera and keep it
    // (zooming out being the one thing that shrinks the box, and the one
    // thing it had taken) — but the multi-selection capsule's DONE ends the
    // selection whatever size its box is (multiSelectionCapsule.ts), which
    // is the way out that does not depend on the zoom. What the cap actually
    // cost was the turn itself: zoom in far enough to work on a group and
    // the gesture for turning it quietly became a camera pinch. The cap
    // still guards the ONE-FINGER grab (beginMultiDrag), so a swallowing box
    // leaves the page drawable.
    // Move mode (the selection tool): neither branch opens — two fingers
    // pinch the camera, whatever they landed on. One reading for both the
    // multi unit and a host's lone twisting item (canvasTwist.ts).
    const unit = resolveTwistUnit(stateRef.current, sel, {
      moveOnly: moveOnly(),
      pxPerCell: pxPerCell(liveCameraRef.current, stateRef.current.viewport),
      hostDoc: propsRef.current.session.hostDoc,
    });
    const insideUnit = (pt: { x: number; y: number }) => {
      if (!unit) return false;
      const cell = screenToWorld(pt.x, pt.y, liveCameraRef.current, stateRef.current.viewport);
      // The box as drawn: a bound group's is turned with it.
      return selectionBoxHitsCell(unit.grip, unit.angleDeg, cell.cellX, cell.cellY);
    };
    if (unit && insideUnit(a) && insideUnit(b)) {
      const s = stateRef.current;
      // A host's own item turns and moves with the unit as a shape does,
      // and the scene's questions do not apply to it: it is not a node, so
      // `canTwoPointerManipulate` (which resolves through `findItem`) can
      // only say no. Its own lock is the adapter's and is read by the
      // builders (`isHostItemLocked`).
      if (unit.ids.every((id) => isHostId(id) || canTwoPointerManipulate(s, id))) {
        gestureRef.current = {
          mode: 'multiManipulate', ids: [...unit.ids], box: unit.box, angleDeg: unit.angleDeg,
          aId, bId, accumDeg: 0, lastPairDeg: pairAngleDeg(a, b), deltaDeg: 0,
        };
        return true;
      }
    } else if (hitA && hitB && hitA.id === hitB.id && isSelected(hitA.id)
      && !moveOnly() && canTwoPointerManipulate(stateRef.current, hitA.id)) {
      const ref = findItem(stateRef.current, hitA.id)!;
      propsRef.current.onSelect(hitA.id);
      // Is the twist of this node the HOST's? Resolved once, here, from the
      // host's own data (canvasHooks.ts `CanvasTwist.node`): a rig's twist
      // is its record's ROLL — the figure turning inside its viewport — so
      // it reads its start angle, drives its own live preview and commits
      // its own entry.
      const hostTwist = canvasHost().twist?.node?.(stateRef.current, hitA.id) ?? null;
      // The one turn the node is drawn at (the graph's), not the legacy
      // free-angle field — buildManipulateNode turns to an ABSOLUTE angle,
      // so the gesture has to start from the same reading it commits to.
      const start = hostTwist ? hostTwist.startDeg : worldTurnDeg(stateRef.current, hitA.id);
      gestureRef.current = {
        mode: 'manipulate', nodeId: hitA.id, aId, bId,
        angle0: start,
        accumDeg: 0, lastPairDeg: pairAngleDeg(a, b),
        // Unsnapped until the fingers move: two fingers resting on an object
        // must commit nothing, snap on or off.
        angleDeg: start,
        cx: ref.item.cellX + ref.item.cellWidth / 2,
        cy: ref.item.cellY + ref.item.cellHeight / 2,
        hostTwist,
      };
      return true;
    }

    gestureRef.current = {
      mode: 'pinch', startCamera: liveCameraRef.current,
      aId, bId, a0: { ...a }, b0: { ...b },
    };
    return true;
  };

  /**
   * A press inside the text node whose edit is live: move the caret there and
   * keep the field focused, instead of letting the press blur it.
   *
   * The invisible textarea is what holds the keyboard up (nativeHidden mode —
   * the on-canvas node is the visible input box). A press anywhere on the
   * canvas would blur it, which commits the edit and unmounts the field, and
   * the tap would then reopen the same text — the keyboard dropping and
   * coming back, and the camera re-running its avoid-glide. preventDefault on
   * the press is what stops the focus moving at all; the caller moves the
   * selection to where the finger landed.
   *
   * Returns true when it handled the press, and the rest of the gesture
   * machinery is skipped: the node is already selected and already being
   * edited, so there is nothing else for this press to mean.
   */
  const seekCaretAt = (e: React.PointerEvent, pt: { x: number; y: number }): boolean => {
    const { editingCaret, onCaretSeek, onSelectAllText, session: s } = propsRef.current;
    if (!editingCaret || !onCaretSeek) return false;
    const text = s.state.texts?.find((t) => t.id === editingCaret.textId);
    if (!text) return false;
    if (hitTestAt(pt)?.id !== text.id) return false;
    e.preventDefault();
    // A DOUBLE tap on the text selects its whole content, the text-field
    // convention — the previous tap may have been the one that OPENED the
    // editor (settleTap records it) or an earlier caret press (recorded
    // just below), so select-tap→tap and caret-tap→tap both count.
    const now = Date.now();
    const double = isTextDoubleTap(lastNodeTapRef.current, text.id, now);
    lastNodeTapRef.current = { id: text.id, time: now };
    if (double && onSelectAllText) {
      onSelectAllText();
      return true;
    }
    const cell = screenToWorld(pt.x, pt.y, liveCameraRef.current, s.state.viewport);
    const drawn = drawnLeaf(graphOf(s.state), text.id);
    if (!drawn) return false;
    onCaretSeek(caretUtf16AtPoint(drawn, cell.cellX, cell.cellY));
    return true;
  };

  /**
   * Select the node under a press and start moving it in the same motion:
   * a stationary press settles as a tap that has already selected (the
   * 'drag' case in endGesture), and one that crosses the slop moves what
   * it selected — no trip back to the arrange tool to reach the object.
   *
   * The selection as it STOOD rides along (prevSelection), so a second
   * finger turning this press into a camera gesture can put it back, and
   * `wasSelected` marks a re-tap for the shell's editing affordances. A
   * grouped hit selects — and drags — the whole group, or press-and-drag
   * in one motion would move the member alone while tap-then-drag moved
   * the group (groupDragGesture).
   *
   * Shared by the arrange tool and by the Tile tool's press on a pattern
   * that is not the grid open for editing.
   */
  const beginHitSelectDrag = (pt: { x: number; y: number }, hitId: string) => {
    const before = propsRef.current.session;
    const wasSelected = before.selectedId === hitId;
    const prev: PriorSelection = {
      selectedId: before.selectedId, selectedIds: [...before.selectedIds],
    };
    propsRef.current.onSelect(hitId);
    armLongPress(pt);
    // Rotate mode: the press has selected, and that is all it MOVES —
    // nothing drags (the slider and the two-finger twist turn it). The
    // release still settles as a tap on the node, so the openings a
    // double tap asks for are reachable here too.
    if (rotateOnly()) {
      gestureRef.current = { mode: 'nodeTap', nodeId: hitId, wasSelected, startX: pt.x, startY: pt.y };
      return;
    }
    const grp = groupDragGesture(stateRef.current, hitId, pt);
    const groupWasSelected = grp != null
      && grp.ids.length === prev.selectedIds.length
      && grp.ids.every((id) => prev.selectedIds.includes(id));
    gestureRef.current = grp
      ? { ...grp, ...(groupWasSelected ? null : { prevSelection: prev }) }
      : {
          mode: 'drag', nodeId: hitId, startX: pt.x, startY: pt.y, dx: 0, dy: 0, moved: false,
          angleDeg: drawnSelectionAngle(hitId),
          wasSelected, ...(wasSelected ? null : { prevSelection: prev }),
        };
  };

  /**
   * Offer a press to the host's gesture hooks at one of the two points the
   * seam defines (canvasHooks.ts `claimAt`): `'press'`, before the surface
   * reads anything else about it, and `'grab'`, inside the select tool
   * after the selection's own grabs. A press a hook CLAIMS is the hook's
   * for its whole life — its moves and its end go to the hooks and none of
   * the machinery below runs for it — and the claim remembers the
   * selection it replaced, so a second finger can put that back.
   */
  const offerClaim = (
    where: 'press' | 'grab', pt: { x: number; y: number }, e: React.PointerEvent,
  ): boolean => {
    const hooks = propsRef.current.gestures;
    if (!hooks || (hooks.claimAt ?? 'press') !== where) return false;
    const claim = hooks.onPointerDown?.(pt.x, pt.y, e);
    if (!claim) return false;
    claimedPointerRef.current = { pointerId: e.pointerId, claim };
    // A hold on what the hook grabbed opens the same radial menu a hold on
    // a grabbed scene node does: on fire the claim is CANCELLED (it has
    // not moved, so nothing was dragged) and the menu owns the touch from
    // there, through the surface's own paths. Without it a host's own
    // thing would be the one object on the page whose quick actions a hold
    // could never open.
    if (hooks.holdOpensMenu?.()) {
      const pointerId = e.pointerId;
      armLongPress(pt, () => {
        if (claimedPointerRef.current?.pointerId !== pointerId) return;
        claimedPointerRef.current = null;
        hooks.onPointerUp?.(pt.x, pt.y, 'cancel');
      });
    }
    return true;
  };

  /** The desktop camera pan a middle-button drag is, whatever tool is
   *  armed. `noTap` keeps the release from being read as a tap, which is
   *  what would drop a text or open the photo picker; `preventDefault`
   *  stops the browser's middle-click autoscroll from hijacking the drag. */
  const beginMiddlePan = (e: React.PointerEvent, pt: { x: number; y: number }) => {
    e.preventDefault();
    gestureRef.current = {
      mode: 'pan', startCamera: liveCameraRef.current,
      startX: pt.x, startY: pt.y, moved: false, noTap: true,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const el = containerRef.current;
    if (!el) return;
    // A finger on the canvas — any finger, whatever it turns out to mean —
    // before anything else is read about it: a host with something playing
    // that a touch should end needs the frame that ending asks for to see
    // the finger (Sol's Draw reveal).
    propsRef.current.onCanvasPointerDown?.();
    // One layout read per gesture, not per move (see localPoint).
    const r = el.getBoundingClientRect();
    containerRectRef.current = { left: r.left, top: r.top };
    // A touch takes the camera over from any in-flight avoid-glide — commit
    // it where it stands so the gesture (and any later state resync) builds
    // on what's on screen, not on a camera the user never saw.
    cancelCameraTween(true);
    // Ignore pointers that start on the chrome overlays (buttons etc.).
    el.setPointerCapture(e.pointerId);
    const pt = localPoint(e);
    // A PRIMARY pointer landing while pointers are still tracked proves
    // those never got their release (pointerRegistry.ts): forget them, or
    // this one finger pairs with a ghost and every drag zooms — the "stuck
    // in pinch mode" state a long Adrift session could fall into.
    if (tracksStalePointers(e.isPrimary, pointersRef.current.size)) cancelStaleGesture();
    pointersRef.current.set(e.pointerId, pt);
    if (pointersRef.current.size === 1) firstFingerDownAtRef.current = Date.now();
    // Multi-finger tap tracking (Facet parity): seed on the transition into a
    // 2+finger gesture, then track the max finger count reached. The snapshot
    // of finger start positions drives the per-finger move check in
    // onPointerMove; the final finger-up in endGesture resolves undo/redo.
    if (pointersRef.current.size >= 2) {
      if (multiTapMaxFingersRef.current < 2) {
        multiTapStartTimeRef.current = Date.now();
        multiTapMovedRef.current = false;
        multiTapStartPosRef.current = new Map(pointersRef.current);
      }
      if (pointersRef.current.size > multiTapMaxFingersRef.current) {
        multiTapMaxFingersRef.current = pointersRef.current.size;
        multiTapLastLandAtRef.current = Date.now();
      }
      // A second finger means pinch/manipulate: cancel any pending long
      // press, and release an already-open radial menu (nothing is
      // hovered at this point, so the release just closes it).
      clearLongPressTimers();
      if (superLongPressFiredRef.current) {
        superLongPressFiredRef.current = false;
        propsRef.current.onSuperLongPressUp?.();
      } else if (longPressFiredRef.current) {
        longPressFiredRef.current = false;
        propsRef.current.onLongPressUp?.();
      }
    }
    if (beginTwoPointerGesture()) return;
    if (pointersRef.current.size !== 1) return;
    // Forget the last press's front pick before anything can read it: the
    // gates below return early for presses that never reach the scene, and
    // one of those must not leave the pick a tool branch would have read.
    pressFrontPickRef.current = null;

    // Desktop: a middle-mouse-button drag pans the camera regardless of the
    // active tool (parity with the two-finger / no-tool pan). FIRST of
    // everything a one-pointer press can mean — ahead of a host's claim,
    // the input lock, the done-page gate, the caret and every tool — so
    // nothing on the page is grabbed, drawn on, or placed while the middle
    // button is the one held: it is the desktop's camera and nothing else
    // (DrawBot's bug f1079398, where it fell to the simulation's lock).
    if (e.button === 1) {
      beginMiddlePan(e, pt);
      return;
    }

    // A host's gestures at the 'press' point (canvasHooks.ts `claimAt`),
    // which is what that default MEANS: before the surface reads anything
    // else about the press — ahead of the input lock, the done-page gate,
    // the caret and every tool. DrawBot's bots and its arena are armed by
    // their own tool and the claim has to beat the running simulation's
    // lock below, so nothing may precede it but the middle button.
    //
    // Settled at stage 5b.4, where the claim sat after the done gate and
    // the caret and nothing exercised the difference (CozyJournal's rig
    // claims at 'grab'). DrawBot's is the shipped order, and it is the one
    // `claimAt: 'press'` already documents; the canvas was what disagreed.
    if (offerClaim('press', pt, e)) return;

    // …then the lock on one-finger input: nothing is selected, drawn,
    // dragged or placed (the two-finger camera above is still live) — all
    // but a TAP, which puts the selection away and the properties panel's
    // pages with it, as a background tap does unlocked (canvasTap's
    // `lockedTapClearsSelection`).
    if (propsRef.current.inputLocked) {
      gestureRef.current = { mode: 'lockedTap', startX: pt.x, startY: pt.y };
      return;
    }

    // A page marked DONE takes no edits (reopenDone.ts). Before every
    // branch below — the caret, the crop, the tools — so there is no
    // second way in: whatever is armed, the finger pans and the press
    // asks whether to reopen the day. `noTap` keeps the release from
    // being read as a tap, which is what would drop a text or open the
    // photo picker. Two fingers never reach here (beginTwoPointerGesture
    // returned above), so pinch-zoom on a finished page is untouched.
    if (propsRef.current.onEditWhileDone) {
      propsRef.current.onEditWhileDone();
      gestureRef.current = {
        mode: 'pan', startCamera: liveCameraRef.current,
        startX: pt.x, startY: pt.y, moved: false, noTap: true,
      };
      return;
    }

    // Tapping into the text you are already editing moves the cursor. Checked
    // before every tool branch: whatever is armed, a press inside the live
    // edit is about the caret, not about drawing on the words.
    if (seekCaretAt(e, pt)) {
      gestureRef.current = { mode: 'idle' };
      return;
    }

    // No tool active: the canvas is view-only. Fall straight through to the
    // camera pan below — before the crop and tool branches, so nothing on the
    // page can be grabbed, drawn on, or placed.
    if (!propsRef.current.session.activeTool) {
      gestureRef.current = {
        mode: 'pan', startCamera: liveCameraRef.current,
        startX: pt.x, startY: pt.y, moved: false,
      };
      return;
    }

    // Crop bar open on an image: a drag that starts on that image pans its crop
    // instead of moving the object — whatever the active tool. Checked before
    // the tool branches so it takes precedence over move/draw/pan.
    const cropId = propsRef.current.cropPanNodeId;
    if (cropId) {
      const hit = hitTestAt(pt);
      if (hit && hit.id === cropId) {
        gestureRef.current = { mode: 'cropPan', nodeId: cropId, startX: pt.x, startY: pt.y, dx: 0, dy: 0 };
        return;
      }
    }

    // What a host layer has under the finger, drawn in FRONT of every
    // scene node (canvasHooks.ts `beforePick`): the selection grabs below
    // yield to it, and the select tool picks it rather than whatever the
    // scene has behind it. Read once, here, before the tool branches — the
    // hook walks the host's own things, and a press must not ask twice and
    // risk two answers. Asked HERE and not at the top of the press, so the
    // gates above — the middle button, a claim, the lock, the done page,
    // the caret, the crop — cost no walk at all.
    pressFrontPickRef.current = propsRef.current.gestures?.beforePick?.(pt.x, pt.y) ?? null;

    const tool = propsRef.current.session.activeTool;
    // Selection first, for every tool that would otherwise create something
    // under the finger (toolYieldsToSelection): a press on the selection's
    // corner handle scales it, and a press on the box it draws moves it —
    // the same gestures 'arrange' offers, since a selection made while a
    // shape tool is armed is a selection like any other. Only the paint
    // brushes keep their press (there the selection is the brush's filter),
    // and even they yield the corner handles below.
    // ('arrange' runs the same helpers in its own branch, after shift-click.)
    if (tool !== 'arrange' && toolYieldsToSelection(tool, hostToolsRef.current)) {
      // Facet's select/line/arc rule: the super long press arms on every
      // press under the shape tools, whether or not anything is hit.
      const shapeTool = tool === 'line' || tool === 'arc' || tool === 'polygon';
      if (beginSelectionGrab(pt, { superLongPress: shapeTool })) return;
    }
    if (tool === 'line' || tool === 'arc' || tool === 'polygon') {
      // A press that the selection didn't claim starts drawing — including
      // one on an unselected object, which is drawn over, not grabbed. The
      // shape tool stays armed through a grab, so the next press draws again.
      // The grid snap of the down point is deferred to the first move that
      // crosses the slop (see advanceShapeDrag), matching Facet.
      gestureRef.current = {
        mode: 'shape', tool, downX: pt.x, downY: pt.y,
        active: false, start: [0, 0], end: null, center: null,
      };
      return;
    }
    if (tool === 'photos' || tool === 'text') {
      // Same press semantics as the shape tools: a press the selection didn't
      // claim seeds a drag-to-place box that stays a tap until it crosses the
      // slop.
      gestureRef.current = {
        mode: 'placeBox', tool, downX: pt.x, downY: pt.y,
        active: false, start: [0, 0], end: null,
      };
      return;
    }
    if (tool === 'pattern') {
      // The selected region's corner handles are drawn under this tool too,
      // so a grab on one resizes the region — for a repeat pattern that is
      // the stabilized resize (the tiling holds still in world space, the
      // edge just reveals more or less of it) — instead of seeding a new
      // region under the handle.
      if (beginCornerResize(pt)) return;
      // A press on an existing pattern's rectangle edits its component
      // tiles with the active sub-tool; anywhere else seeds a create-region
      // drag (a stationary press still settles as a tap — clearing the
      // selection — like the other creators).
      const hit = hitTestAt(pt);
      const ref = hit ? findItem(stateRef.current, hit.id) : null;
      if (ref?.kind === 'pattern' && !isItemLocked(stateRef.current, ref.item.id)) {
        // EVERY brush — Random, Erase, Close, a stamped tile — works under
        // the CURRENT symmetry rules: while the toolbar's canvas Symmetry
        // is on it outranks the pattern's stored mode — the same precedence
        // Flood gives it — so the stroke's working copy carries those flags
        // and every tap's partners mirror by them (the commit then writes
        // them onto the pattern, see finishPatternPaint). Close alone used
        // to get this, so an Erase tap deleted only the touched cell while
        // its Random and Close neighbours reflected.
        const canvasSym = stateRef.current.symmetry;
        const symmetry = canvasSymmetryOn(canvasSym) ? { ...canvasSym! } : undefined;
        const paintDrawn = drawnLeafFor('pattern', ref.item, graphOf(stateRef.current));
        gestureRef.current = {
          mode: 'patternPaint', patternId: ref.item.id, downX: pt.x, downY: pt.y,
          working: symmetry ? { ...ref.item, symmetry } : ref.item,
          frame: leafHitFrame(paintDrawn.node, paintDrawn.world),
          edits: [], painted: new Set(), stamped: false, symmetry,
        };
        return;
      }
      // The create-region drag exists only where the bar OFFERS the
      // pattern tool (patternRegionDrags). In the tile formats the pattern
      // tool reaches the hand invisibly — the tile radial's Erase / Close
      // arms and the Tiles bar's picks put it there for its grid brush —
      // and a rectangle of tiles dragged out of nowhere is not a thing the
      // Tile tool does, in any mode: the press falls through to the pan.
      if (propsRef.current.patternRegionDrags) {
        gestureRef.current = {
          mode: 'patternRegion', downX: pt.x, downY: pt.y,
          active: false, anchor: [0, 0], region: null,
        };
        return;
      }
    }
    if (tool === 'tile') {
      // Like pattern and the brushes, the tile tool keeps its press off the
      // selection's BODY (a tap must stamp a tile right against the selected
      // thing — see toolYieldsToSelection) but not off the corner handles:
      // a just-placed tile is selected, and a grab on its handle has to
      // scale it rather than stamp another tile under the handle.
      if (beginCornerResize(pt)) return;
      if (beginMultiCornerResize(pt)) return;
      // A pattern already on the page is an OBJECT to this tool, not a
      // surface to stamp on: the stamps go into the grid opened for
      // editing and nowhere else (editableTilePattern). So a press on any
      // OTHER pattern selects it — which is how the Edit capsule is
      // reached — and drags it, the arrange tool's own gesture. It used to
      // lay a loose tile over the pattern, or drag a fresh region out
      // across it, with the tap that meant "this one" clearing the
      // selection instead.
      const tilePatternHit = hitTestAt(pt);
      if (tilePatternHit && tilePatternHit.id !== propsRef.current.tileEditPatternId) {
        const ref = findItem(stateRef.current, tilePatternHit.id);
        if (ref?.kind === 'pattern'
          && !isItemLocked(stateRef.current, ref.item.id)
          && !isItemHidden(stateRef.current, ref.item.id)) {
          beginHitSelectDrag(pt, tilePatternHit.id);
          return;
        }
      }
      // With no grid OPEN under this touch, the drag is not a stroke of
      // tiles: it drags out a REGION, which the release fills and closes
      // into a brand-new object (onCreatePattern). That is the tool's
      // resting behaviour — it creates — and a pattern already on the page
      // is reached only by opening it for editing first (the Edit capsule,
      // the double border). A press that never crosses the slop settles as
      // the tap, which clears the selection (resolveCanvasTap).
      if (!tileJoinsHere(pt)) {
        // …on a bar that offers the tile tool of its own accord. Where the
        // tool is only ever in hand to paint a closed shape's pattern FILL
        // (tileRegionDrags false), creating is not among the things it
        // does: the press falls through to the camera pan at the bottom,
        // and the tap that settles there puts the open fill away.
        if (propsRef.current.tileRegionDrags !== false) {
          gestureRef.current = {
            mode: 'patternRegion', downX: pt.x, downY: pt.y,
            active: false, anchor: [0, 0], region: null,
          };
          return;
        }
      } else {
        // Over (or against) the OPEN grid the press seeds a stamp stroke: a
        // drag lays one connecting tile into every grid cell it crosses
        // (committed as one undo step), and a press that never crosses the
        // slop settles as the single-tile tap (settleTap → 'hostPlace' for
        // the tile).
        gestureRef.current = {
          mode: 'tileStamp', downX: pt.x, downY: pt.y, active: false,
          working: stateRef.current, ops: [],
          stamped: new Set(), previewEls: [], touched: new Set(),
        };
        return;
      }
    }
    if (tool === 'word') {
      // Like tile, the word tool keeps its press off the selection's BODY (a
      // tap must deal a word wherever it lands — magnets go down in runs, on
      // top of each other — see toolYieldsToSelection) but not off the corner
      // handles: a just-dealt word is selected, and a grab on its handle has
      // to scale it rather than deal another word under the handle. No drag
      // form of its own: the press falls through to the camera pan below,
      // and a settled tap deals (settleTap → 'hostPlace' for the word).
      if (beginCornerResize(pt)) return;
      if (beginMultiCornerResize(pt)) return;
    }
    // The rig tool has no gesture branch of its own: it places on a settled
    // TAP (settleTap → 'hostPlace' for the rig) and has no drag form to seed
    // a box for, so
    // a press falls through to the camera pan at the bottom — which is what
    // settles that tap. A press the selection claimed was already handled
    // above (toolYieldsToSelection), so a placed rig still drags and resizes.
    if (tool === 'draw') {
      const s = stateRef.current;
      // Grid Snap never touches a freehand stroke — not even its first point.
      // The whole tool is the raw line the hand makes, and the press used to
      // be the one sample pulled to a gridline: a stroke begun a hair off an
      // intersection kinked at its root, the pencil jumping to somewhere the
      // finger was not. Every sample, the first included, is the finger's own.
      const cell = screenToWorld(pt.x, pt.y, liveCameraRef.current, s.viewport);
      const draw: Extract<Gesture, { mode: 'draw' }> = {
        mode: 'draw',
        downX: pt.x, downY: pt.y, moved: false,
        // …but every sample IS clamped into the editable band, where one is
        // set (docs/social_game_spec.md §7.3): a stroke that crosses the
        // midline is stopped at it.
        cellPoints: [regionClamp([cell.cellX, cell.cellY])],
        screenPoints: [[pt.x, pt.y]],
      };
      gestureRef.current = draw;
      // No preview yet: nothing is being drawn until the finger crosses the
      // slop, and a dot under a stationary press would flash on every tap.
      return;
    }
    if (tool === 'color' || tool === 'paint' || tool === 'erase' || tool === 'blur'
      || tool === 'push') {
      // The brushes keep the body of the selection box (it is their filter —
      // see toolYieldsToSelection), but not its corner handles: those are
      // drawn under these tools too, so grabbing one has to scale.
      if (beginCornerResize(pt)) return;
      if (beginMultiCornerResize(pt)) return;
      // …and the overlay buttons' no-paint margin (paintGuards.ts): a
      // brush stamps on CONTACT, so a finger that misses a 44px capsule
      // by a few pixels used to leave a dab behind the control it was
      // reaching for. A press inside a button, or within the margin round
      // one, pans instead — no mark, and the camera still answers.
      if (pointInPaintGuard(collectPaintGuards(containerRef.current), e.clientX, e.clientY)) {
        gestureRef.current = {
          mode: 'pan', startCamera: liveCameraRef.current,
          startX: pt.x, startY: pt.y, moved: false,
        };
        return;
      }
      // Facet's drag-paint, shared by the whole color group: the press
      // starts a stroke and stamps once, so a tap-without-drag still leaves
      // a single dab (or lifts one, for the eraser). Radius is one grid step
      // (Facet's rule); the selection (if any) filters what the brush may
      // touch; hidden-group members and frame boundary rects never paint.
      // Erase and blur ignore the picker's blend mode — they deposit no
      // colour of their own, so there is nothing for a mode to blend; the
      // draft carries 'normal' so the unary-mode special cases can't fire
      // for them. Paint takes it: an island renders source-over, so the
      // mode acts on the dab itself — and MUTATE-ONLY, editing the colour
      // of paint already under the brush and depositing nothing on bare
      // canvas (see stampPaintObjectBrush).
      const s = stateRef.current;
      // Two sets, because "not there" and "not to be changed" are not the
      // same thing to the spray-paint stack below: a hidden object cannot
      // stencil a dab, a LOCKED one is fully visible and still does. So the
      // occlusion stack is built from the hidden set alone, and the locked
      // objects join only the set the stamps consult — their own `locked`
      // flag OR a lock inherited from a frame above them, the effective lock
      // every other edit path already honours (paintLockedIds).
      const occluderSkips = paintHiddenIds(s);
      for (const id of frameBoundaryIdsRef.current) occluderSkips.add(id);
      const skipIds = new Set(occluderSkips);
      for (const id of paintLockedIds(s)) skipIds.add(id);
      const filterIds = paintFilterIds(
        propsRef.current.session.selectedId, propsRef.current.session.selectedIds,
      );
      // The raster brush paints into a PAINT ISLAND scene object — the
      // session island when the stroke starts near its content (the ref the
      // shell keeps for the current colors-group session), a fresh one
      // otherwise — as well as the objects under it. A SELECTION narrows the
      // stroke to those objects alone: `filterIds` confines the object pass,
      // and the island half joins only when the selection names a paint
      // island — the whole stroke then deposits into THAT island, merging
      // and growing it, with no other island touched and none minted
      // (see createPaintObjectStrokeState). Erase/blur target every visible
      // island under the dab (or only the selected ones), so old strokes
      // still erase like the single layer they replaced.
      const downCell = screenToWorld(pt.x, pt.y, liveCameraRef.current, s.viewport);
      // The slider's multiplier rides EVERY brush in the colours group, the
      // recolour brush included: its disc decides how much of a line, a
      // word or a fill one pass catches, so a size means as much to it as
      // to the raster four.
      const radiusCells = compSnapStep(s.gridLevel)
        * (propsRef.current.brushRadiusScale ?? 1);
      // The raster brush behaves like spray paint: the occlusion stack
      // (sceneOcclusion.ts) is what makes the topmost ink at each point
      // catch the dab and only the uncovered share reach the island. A
      // selection filter skips it — an explicitly targeted object is
      // painted even under its neighbors.
      const occlusion = tool === 'paint' && !filterIds
        ? buildSceneOcclusion(s, occluderSkips)
        : null;
      // A non-normal blend mode reroutes the island half onto targets-style
      // mutation of every island under the brush (mutate-only dabs deposit
      // nothing, so the session island loses no work) — the mode must reach
      // the state builder for that. The recolour brush always runs that way
      // (it restains raster, never lays it), wherever its aim reaches paint.
      // The Color brush's Eraser cuts paths and touches nothing else — no
      // island, no fill, no tint (vectorEraser.ts).
      const vectorErase = tool === 'color' && propsRef.current.vectorEraser
        ? createVectorEraseState(filterIds, skipIds)
        : null;
      const paintState = !vectorErase && (tool !== 'color'
        || colorScopeWritesPaintIsland(tool, propsRef.current.colorScope))
        ? createPaintObjectStrokeState(
            s,
            tool,
            tool === 'paint'
              ? resolvePaintSessionTarget(
                  s, propsRef.current.paintSessionRef?.current ?? null,
                  downCell.cellX, downCell.cellY, radiusCells,
                )
              : null,
            filterIds,
            occlusion,
            tool === 'paint' ? propsRef.current.colorBlendMode : 'normal',
          )
        : null;
      const paint: Extract<Gesture, { mode: 'paint' }> = {
        mode: 'paint',
        kind: tool,
        // PUSH is the multi-type deformer: its island half is the state
        // above (same targets the eraser takes), its vector and rig halves
        // are here. Strength is the app setting the rig brush already ran
        // on — one knob for everything the brush moves.
        push: tool === 'push' ? createPushStrokeState(s, filterIds, skipIds) : null,
        strength: pushStrength(),
        draft: createPaintStrokeDraft(
          propsRef.current.currentColor,
          tool === 'color' || tool === 'paint' ? propsRef.current.colorBlendMode : 'normal',
          propsRef.current.colorBrushOpacity,
        ),
        textPaint: createTextPaintState(),
        imagePaint: createOverlayPaintState(),
        shapePaint: createOverlayPaintState(),
        patternPaint: createPatternPaintState(),
        // The colour state resolves the page's RIGS at the press, the way the
        // push state resolves its own: a figure's colour is not on the object
        // the dab lands on (the silhouette is a bake the live sketch draws
        // over), so the stroke needs the record beside the geometry.
        objectColor: createObjectColorState(propsRef.current.colorScope, s),
        patternPreviewRev: new Map(),
        paint: paintState,
        lastCell: null,
        downX: pt.x, downY: pt.y, stamped: false,
        radiusCells,
        filterIds,
        skipIds,
        // A press starts a NEW random walk, so every stroke opens on its own
        // colour rather than continuing the last one's drift.
        random: !vectorErase && (tool === 'color' || tool === 'paint')
          && propsRef.current.colorBlendMode === 'randomize'
          ? createRandomColorWalk()
          : null,
        vectorErase,
      };
      gestureRef.current = paint;
      // The cursor disc wears the brush color; the eraser has none, so it
      // shows white, and blur a neutral gray (it deposits no color of its
      // own).
      const cursorColor = tool === 'erase' || vectorErase
        ? { r: 255, g: 255, b: 255 }
        : tool === 'blur'
          ? { r: 168, g: 168, b: 168 }
          : tool === 'push'
            ? PUSH_CURSOR_COLOR
            : propsRef.current.currentColor;
      // The cursor mounts on contact — it is the brush's "you are here", and
      // it deposits nothing. The first dab waits (see the gesture type).
      ensurePaintCursor(pt, paint.radiusCells, cursorColor);
      return;
    }
    if (tool === 'arrange') {
      // Desktop shift-click: toggle the hit node into / out of the selection
      // instead of replacing it, then end the gesture (no drag — building a
      // multi-selection shouldn't move anything). Checked before the corner /
      // multi / hit branches so shift always means "add to selection". A
      // shift-click on empty canvas is inert (keeps the current selection).
      if (e.shiftKey) {
        // A host item is drawn over the whole scene, so it is what the
        // click toggles when one is under it — and only one that can
        // actually stand in a multi-selection: a host's SENTINEL id (the
        // arena's border) is a selection of its own and not a member of
        // anything (DrawBot's bug db99d9c8).
        const front = pressFrontPickRef.current;
        const target = front !== null && isHostId(front) ? front : hitTestAt(pt)?.id;
        if (target) propsRef.current.onToggleSelect(target);
        gestureRef.current = { mode: 'idle' };
        return;
      }
      // A grab on the selected node's corner handle resizes it (opposite corner
      // pinned), and a press inside a multi-selection's combined box moves the
      // whole selection — both checked before the node hit-test so a corner
      // near the object edge starts a resize, not a move/drag, and the box
      // owns its interior. Same helpers every other tool routes through.
      if (beginCornerResize(pt)) return;
      if (beginMultiCornerResize(pt)) return;
      if (beginMultiDrag(pt)) return;
      // Super long press arms whether or not anything is hit — a LOCKED
      // node under the finger hit-tests as empty canvas here.
      armSuperLongPress(pt);
      // A host's gestures at the 'grab' point (canvasHooks.ts): after the
      // selection's own grabs and before the scene is hit-tested. A rig's
      // joint knobs pose here — the mannequin is poseable right in the
      // scene, and only its knobs are special; the rest of the figure is an
      // ordinary object.
      if (offerClaim('grab', pt, e)) return;
      // A host item is drawn above the whole scene, so it is the topmost
      // thing under the finger: the press selects IT, not the node behind
      // it. Dragging one is the host's own gesture, claimed above on the
      // one already selected, so this press picks (re-announcing one that
      // is already in hand), and a hold on it opens the radial menu — a
      // host's thing must not be the one object on the page whose quick
      // actions a hold cannot reach. A SENTINEL id (DrawBot's arena
      // border) is selected and nothing more: it has no menu and no group.
      const frontPick = pressFrontPickRef.current;
      if (frontPick !== null) {
        propsRef.current.onSelect(frontPick);
        if (isHostId(frontPick)) armLongPress(pt);
        // …and a GROUPED one selects its whole unit and drags it, as a
        // press on a grouped shape does (selectionUnitIds).
        const unitDrag = isHostId(frontPick)
          ? groupDragGesture(stateRef.current, frontPick, pt) : null;
        gestureRef.current = unitDrag ?? { mode: 'idle' };
        return;
      }
      const hit = hitTestAt(pt);
      // The selected object keeps the presses on the box it draws (even the
      // empty space inside a thin stroke's box), so a nudge can't fall
      // through to what sits behind it — the same rule the shape tools use.
      if (beginSelectedNodeDrag(pt, hit)) return;
      if (hit) { beginHitSelectDrag(pt, hit.id); return; }
      // Empty canvas under the select tool: the drag is a marquee — it stays
      // a tap (select / clear via settleTap) until it crosses the slop. The
      // camera still pans with two fingers, the wheel, or no tool active.
      gestureRef.current = { mode: 'marquee', downX: pt.x, downY: pt.y, active: false };
      return;
    }
    gestureRef.current = {
      mode: 'pan', startCamera: liveCameraRef.current,
      startX: pt.x, startY: pt.y, moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const pointers = pointersRef.current;
    if (!pointers.has(e.pointerId)) return;
    const pt = localPoint(e);
    pointers.set(e.pointerId, pt);
    if (claimedPointerRef.current?.pointerId === e.pointerId) {
      // Any movement cancels a claimed hold's menu, as it does below.
      clearLongPressTimers();
      propsRef.current.gestures?.onPointerMove?.(pt.x, pt.y, e);
      return;
    }
    // Multi-finger tap detection (Facet parity): once any tracked finger moves
    // past the slop, the multi-touch gesture is a pan/pinch/rotate, not a tap —
    // latch that so endGesture skips undo/redo.
    if (!multiTapMovedRef.current && multiTapMaxFingersRef.current >= 2
      && anyFingerMoved(pointers, multiTapStartPosRef.current)) {
      multiTapMovedRef.current = true;
    }
    // Cancel a pending long press on any movement at all (Facet: the menu
    // only ever opens under a stationary hold).
    clearLongPressTimers();
    // An open radial menu owns the touch: forward movement to it (the
    // shell routes these into the menu's drag-to-hover hit-test).
    if (superLongPressFiredRef.current) {
      propsRef.current.onSuperLongPressMove?.(pt.x, pt.y);
      return;
    }
    if (longPressFiredRef.current) {
      propsRef.current.onLongPressMove?.(pt.x, pt.y);
      return;
    }
    const g = gestureRef.current;
    switch (g.mode) {
      case 'pinch': {
        const a = pointers.get(g.aId);
        const b = pointers.get(g.bId);
        if (!a || !b) return;
        applyLiveCamera(pinchCamera(g.startCamera, stateRef.current.viewport, g.a0, g.b0, a, b));
        return;
      }
      case 'manipulate': {
        const a = pointers.get(g.aId);
        const b = pointers.get(g.bId);
        if (!a || !b) return;
        // Accumulate the twist across the atan2 seam so >180° turns track.
        const cur = pairAngleDeg(a, b);
        g.accumDeg += shortestAngleDeltaDeg(g.lastPairDeg, cur);
        g.lastPairDeg = cur;
        // Snapped on the ABSOLUTE angle, so a node that was already off-angle
        // straightens on its first twist (what snapping means for a drag too).
        // ROTATION ONLY: the finger separation is never read — nothing here
        // scales, so nothing can grow under a pinch aimed at the view.
        const live = snapAngleDeg(g.angle0 + g.accumDeg, gridSnapRef.current);
        g.angleDeg = live;
        // Show Dimensions on → the object's live angle, centered on the
        // pivot (a rig's readout is its roll, the angle the twist writes).
        updateRotationHud(g.cx, g.cy, live);
        // The node's committed render already holds `angle0`, so transform
        // the OUTER bbox element (about its center) by the twist SINCE that
        // angle to reach the live pose. The selection outline carries no base
        // transform during the gesture, so it takes the absolute live angle.
        // A node the HOST twists drives its own live preview and the box
        // stands still: a rig turns inside its viewport, so its box neither
        // rotates nor carries the twist, and the outline bows out for the
        // duration (the silhouette is a different shape every frame, so no
        // one box is true until the gesture settles).
        if (g.hostTwist) {
          g.hostTwist.preview(live);
          return;
        }
        const el = nodeEl(g.nodeId);
        if (el) el.style.transform = `rotate(${live - g.angle0}deg)`;
        if (selectionOutlineRef.current) {
          // No world move in a single-node twist — just the live absolute
          // angle, through the same composition every other branch uses.
          selectionOutlineRef.current.style.transform =
            outlineGestureTransform('', live);
        }
        return;
      }
      case 'multiManipulate': {
        const a = pointers.get(g.aId);
        const b = pointers.get(g.bId);
        if (!a || !b) return;
        // Accumulate the twist across the atan2 seam so >180° turns track.
        const cur = pairAngleDeg(a, b);
        g.accumDeg += shortestAngleDeltaDeg(g.lastPairDeg, cur);
        g.lastPairDeg = cur;
        // The gesture commits a DELTA (members keep their own committed
        // rotations and every one turns by it about the shared pivot), but
        // the snap is taken on the UNIT'S ABSOLUTE angle — the frame it is
        // drawn at (g.angleDeg, a turned bound group's own turn; 0 for a
        // loose selection or a group on a quarter) plus the twist — so the
        // unit lands ON a 45° multiple, as a single object does, rather
        // than turning BY 45° from wherever it stood (report a289ecc4).
        const d = snapTwistDeltaDeg(g.angleDeg, g.accumDeg, gridSnapRef.current);
        g.deltaDeg = d;
        const cx = g.box.cellX + g.box.cellWidth / 2;
        const cy = g.box.cellY + g.box.cellHeight / 2;
        // Show Dimensions on → the unit's live angle, its frame plus the
        // twist (for a loose selection that is the twist itself), centered
        // on the combined pivot — what the single-object readout shows too.
        updateRotationHud(cx, cy, g.angleDeg + d);
        // Draw the very entry the release will commit: each leaf takes the
        // relative matrix between where it stands and where the graph puts
        // it under the proposed transforms — a bound group's members ride
        // their group's one transform, loose members orbit on their own.
        const twisted = buildManipulateNodes(
          stateRef.current, g.ids, 1, d, propsRef.current.session.hostDoc);
        applyGesturePreview(g.ids, twisted?.entry);
        previewSelectionEntry(g.ids, () => twisted);
        // The combined outline's box centre IS the pivot, so it takes the
        // bare twist, on top of the turn it is drawn at.
        if (selectionOutlineRef.current) {
          const twist = gestureAbout(aboutPoint([cx, cy], d, 1, 1), [cx, cy]);
          selectionOutlineRef.current.style.transform =
            outlineGestureTransform(cssMatrix(twist, BASE_CELL_PX), g.angleDeg);
        }
        return;
      }
      case 'resize': {
        const cell = resizeCursorCell(pt);
        // A frame never turns over (noFlip): it is a page of members, and a
        // corner dragged a little too far flipping every one of them is an
        // accident, not an edit. Everything else does.
        const { bbox: next, flip } = computeCornerResize(
          g.oldBbox, g.angleDeg, g.sign, cell.cellX, cell.cellY,
          { uniform: g.uniform, freeAxis: g.freeAxis ?? undefined,
            minCells: resizeMinCells([g.targetId]), noFlip: g.frame });
        g.changed = true;
        // An axis-locked line resize labels only the stroke's length: flatten
        // the box onto its midline so the HUD's degenerate-axis rule shows the
        // one changing dimension (a "8 × 1" readout would be box noise).
        updateDimsHud(g.freeAxis === 'x'
          ? { ...next, cellY: next.cellY + next.cellHeight / 2, cellHeight: 0 }
          : g.freeAxis === 'y'
            ? { ...next, cellX: next.cellX + next.cellWidth / 2, cellWidth: 0 }
            : next);
        // The grid snap makes most moves land on the box we already previewed —
        // skip those before any geometry work, so a slow drag across one cell
        // costs one rescale, not one per pointer event.
        if (g.lastBbox && sameBbox(g.lastBbox, next) && sameFlip(g.lastFlip, flip)) return;
        g.lastBbox = next;
        g.lastFlip = flip;
        // A frame stretches as a whole — wrapper, border and outline, by
        // transform (see applyFramePreview). Nothing to rescale per-member.
        if (g.frame) { applyFramePreview(g.targetId, next); return; }
        // Rescale the node exactly as the release will (previewResizedNode
        // shares buildResizeNode's gate and geometry adapter) and render THAT:
        // the object stretches under the finger and the drop changes nothing
        // on screen. Node and outline both come from this one state, so the
        // re-render can't clobber the outline. A CSS scale on the subtree
        // would have been cheaper but wrong — it stretches stroke weights,
        // borders, rounded corners and drop shadows, then snaps back.
        // Past the pinned corner the preview is the mirrored node the
        // release will leave, built by the commit's own entry — a state
        // advance per previewed box, paid only while the node is turned over.
        const preview = previewResizedNode(stateRef.current, g.targetId, next, flip);
        if (preview) setLiveResize({ id: g.targetId, node: preview });
        return;
      }
      case 'multiResize': {
        const cell = resizeCursorCell(pt);
        // Free per-axis factors: dragging along the diagonal scales uniformly,
        // off it non-uniformly — both, with one gesture, along the box's own
        // axes (a bound group's turn). In SCALE mode the group holds its
        // shape like everything else: the members keep their places in it.
        const { bbox: next, flip } = computeCornerResize(
          g.oldBox, g.angleDeg, g.sign, cell.cellX, cell.cellY,
          { uniform: g.uniform, minCells: resizeMinCells(g.ids) });
        g.changed = true;
        updateDimsHud(next);
        if (g.lastBox && sameBbox(g.lastBox, next) && sameFlip(g.lastFlip, flip)) return;
        g.lastBox = next;
        g.lastFlip = flip;
        // Draw the very entry the release will commit (see multiManipulate):
        // a bound group stretches as one transform, members and all, and
        // each leaf is drawn as the rectangle the commit will render. A CSS
        // scale stretches stroke weights slightly mid-drag; the committed
        // render settles them, exactly as the frame preview does.
        // …turned over with it when the corner has crossed the pinned one:
        // the entry then carries the members' mirrors too, and each leaf's
        // relative matrix is a reflection.
        const resized = buildResizeNodes(
          stateRef.current, g.ids, g.oldBox, next, g.angleDeg, flip,
          propsRef.current.session.hostDoc);
        applyGesturePreview(g.ids, resized?.entry);
        previewSelectionEntry(g.ids, () => resized);
        // The combined outline re-draws at the live box (geometry write, not a
        // transform, so its ring and handles keep their screen size).
        if (selectionOutlineRef.current) setOutlineBox(next);
        return;
      }
      case 'pan': {
        const dx = pt.x - g.startX;
        const dy = pt.y - g.startY;
        if (Math.hypot(dx, dy) > TAP_SLOP_PX) g.moved = true;
        applyLiveCamera(panBy(g.startCamera, dx, dy));
        return;
      }
      case 'drag': {
        g.dx = pt.x - g.startX;
        g.dy = pt.y - g.startY;
        // Below the slop the press is still a TAP — and a tap MOVES NOTHING,
        // so nothing is previewed until it crosses (the same latch the pan,
        // the marquee and the creation drags keep). Under GRID SNAP the
        // preview isn't the raw delta: `dragDeltaCells` pulls the node's
        // origin onto the nearest gridline, so a delta of half a pixel is
        // previewed as a jump of up to half a grid step. That is what a
        // MOUSE double-click on a Patchwork patch looked like — the pointer
        // jitters a pixel between the two clicks, the piece leapt to the
        // seam and the release (a tap, which commits nothing) put it back.
        // A finger that holds still sends no move at all, which is why the
        // native app never showed it.
        if (!g.moved) {
          if (Math.hypot(g.dx, g.dy) <= TAP_SLOP_PX) return;
          g.moved = true;
        }
        const el = nodeEl(g.nodeId);
        // The outer node div lives in container units (1 cell = BASE_CELL_PX
        // before the container's CSS scale), so preview the SNAPPED cell
        // delta directly — the same delta the release commits, which is what
        // makes the object appear to step gridline-to-gridline under the
        // finger instead of jumping on release.
        const d = dragDeltaCells(g.nodeId, g.dx, g.dy);
        // Adrift: a word sticker grows as it floats into the bottle and
        // shrinks back on its way out (maskWordScale). The scale is the
        // one the release commits, read at the SNAPPED delta, so the word
        // under the finger is the size the drop leaves — and 1 for every
        // other node on every other page, where this is one lookup that
        // finds no mask.
        const maskScale = dragScaleFactor(stateRef.current, g.nodeId, d.dxCells, d.dyCells);
        const worldTranslate =
          `translate(${d.dxCells * BASE_CELL_PX}px, ${d.dyCells * BASE_CELL_PX}px)`
          + (maskScale === 1 ? '' : ` scale(${maskScale})`);
        // The node's free rotation lives on its inner element (image/text) or
        // an inner wrapper (svg), so translating the outer bbox element alone
        // moves it correctly at any angle.
        if (el) el.style.transform = worldTranslate;
        // Under canvas symmetry the node's standing partners move live too —
        // the release re-establishes the orbit (withSymmetryReflection), and
        // the mirror shouldn't lag the finger until then.
        g.peers ??= symmetryDragPeers(stateRef.current, [g.nodeId],
          canvasSymmetrySpec(), compSnapStep(stateRef.current.gridLevel));
        previewSymmetryPeers(g.peers, d.dxCells, d.dyCells);
        // Keep the selection outline glued to the object as it moves. The
        // outline carries the rotation itself, so re-apply the committed angle
        // after the translate (rotate about its own center, then translate).
        if (selectionOutlineRef.current) {
          selectionOutlineRef.current.style.transform =
            outlineGestureTransform(worldTranslate, g.angleDeg);
        }
        // The mirror scoped to THIS pattern (its axes drawn inside its box)
        // rides along too — the same snapped delta, so the axes sit where
        // the drop will put them (writeAxesForState with the shift).
        if (canvasSymmetrySpec()?.only === g.nodeId) {
          writeAxesForState(stateRef.current, { dx: d.dxCells, dy: d.dyCells });
        }
        // Figma's drop-target highlight: outline the frame that would adopt
        // the node if released here — only when that changes its parent, and
        // only where the format wants the ring at all (frameDropHighlight).
        if (propsRef.current.frameDropHighlight !== false && frameRectsRef.current.size > 0) {
          const s = stateRef.current;
          const target = dragTargetFrameId(s, g.nodeId, d.dxCells, d.dyCells, frameRectsRef.current);
          setDropHighlight(target !== currentFrameId(s, g.nodeId) ? target : null);
        }
        return;
      }
      case 'marquee': {
        // Below the slop the press is still ambiguous (tap vs. marquee).
        if (!g.active && Math.hypot(pt.x - g.downX, pt.y - g.downY) < TAP_SLOP_PX) return;
        g.active = true;
        updateMarqueePreview(g, pt);
        return;
      }
      case 'multiDrag': {
        g.dx = pt.x - g.startX;
        g.dy = pt.y - g.startY;
        // Same tap slop as a single-node drag, for the same reason: until the
        // press crosses it the release is a tap, and the members hold still
        // rather than snapping to the grid and back.
        if (!g.moved) {
          if (Math.hypot(g.dx, g.dy) <= TAP_SLOP_PX) return;
          g.moved = true;
        }
        // Same snapped-delta preview as a single-node drag, anchored on the
        // combined box's origin: every member takes the identical translate,
        // so the group steps gridline-to-gridline as one rigid unit.
        const d = multiDragDeltaCells(g.box, g.dx, g.dy);
        const worldTranslate =
          `translate(${d.dxCells * BASE_CELL_PX}px, ${d.dyCells * BASE_CELL_PX}px)`;
        previewSelectionEntry(g.ids, () => buildMoveNodes(
          stateRef.current, g.ids, d.dxCells, d.dyCells, propsRef.current.session.hostDoc));
        const targets = previewTargets(g.ids);
        for (const id of targets.own) {
          const el = nodeEl(id);
          // …and any word among them grows into the bottle as it would on
          // its own (dragScale.ts), about its own centre.
          const maskScale = dragScaleFactor(stateRef.current, id, d.dxCells, d.dyCells);
          if (el) {
            el.style.transform = maskScale === 1
              ? worldTranslate : `${worldTranslate} scale(${maskScale})`;
          }
        }
        // …and one write for each host stand-in among them. A plain
        // translate is the same for every member, so the driving pose is
        // not needed: nothing a host grows by being dragged exists, and a
        // composite rides the group's one delta.
        for (const { standIn } of targets.standIns) {
          const el = standIn.el();
          if (el) el.style.transform = worldTranslate;
        }
        // The members' standing partners ride along, mapped per orbit — a
        // dragged symmetric pair claims its own halves, so no peer doubles
        // what the fingers already hold (see symmetryDragPeers).
        g.peers ??= symmetryDragPeers(stateRef.current, g.ids,
          canvasSymmetrySpec(), compSnapStep(stateRef.current.gridLevel));
        previewSymmetryPeers(g.peers, d.dxCells, d.dyCells);
        // Keep the combined outline glued to the moving members — on top of
        // the turn it is drawn at. A bound group off the quarters wears a
        // ROTATED combined box (resolveMultiSelectionFrame), and this write
        // replaces the resting `rotate()`, so the angle has to be composed
        // back on or the box stands square for the length of the drag.
        if (selectionOutlineRef.current) {
          selectionOutlineRef.current.style.transform =
            outlineGestureTransform(worldTranslate, g.angleDeg);
        }
        return;
      }
      case 'cropPan': {
        g.dx = pt.x - g.startX;
        g.dy = pt.y - g.startY;
        // Preview through React state (framing offset), like the Crop sliders —
        // NodeLayer re-renders the panned image. Delta is total-from-start, in
        // world cells, so the shell recomputes from its pre-drag snapshot.
        const ppc = pxPerCell(liveCameraRef.current, stateRef.current.viewport);
        propsRef.current.onCropPan(g.nodeId, g.dx / ppc, g.dy / ppc, false);
        return;
      }
      case 'cropZoom': {
        const a = pointers.get(g.aId);
        const b = pointers.get(g.bId);
        if (!a || !b) return;
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        g.factor = g.startDist > 0 ? dist / g.startDist : 1;
        // Preview through React state (framing zoom), like the Crop sliders.
        propsRef.current.onCropZoom(g.nodeId, g.factor, false);
        return;
      }
      case 'shape': {
        // Below the slop the press is still ambiguous (tap vs. draw) — Facet
        // defers the same way, so a stationary press falls through to select.
        if (!g.active && Math.hypot(pt.x - g.downX, pt.y - g.downY) < TAP_SLOP_PX) return;
        advanceShapeDrag(g, pt);
        return;
      }
      case 'placeBox': {
        // Same tap-vs-drag deferral as 'shape'.
        if (!g.active && Math.hypot(pt.x - g.downX, pt.y - g.downY) < TAP_SLOP_PX) return;
        advancePlaceBoxDrag(g, pt);
        return;
      }
      case 'patternRegion': {
        // Close is a repair brush, not a creator: with it armed there is
        // nothing on empty canvas to close, so the press never becomes a
        // create-region drag however far it travels — it settles as a tap
        // (clearing the selection) like a stationary press would. Random
        // (and an armed tile) still drag out a fresh region to fill.
        if (propsRef.current.patternSubTool?.kind === 'reconcile') return;
        // Same tap-vs-drag deferral as 'placeBox'.
        if (!g.active && Math.hypot(pt.x - g.downX, pt.y - g.downY) < TAP_SLOP_PX) return;
        advancePatternRegionDrag(g, pt);
        return;
      }
      case 'patternPaint': {
        // Below the slop the press may yet become a pinch — same deferral as
        // 'paint'; once crossed, the down point stamps first, then the trail.
        if (!g.stamped) {
          if (Math.hypot(pt.x - g.downX, pt.y - g.downY) < TAP_SLOP_PX) return;
          g.stamped = true;
          applyPatternToolAtPoint(g, { x: g.downX, y: g.downY });
        }
        applyPatternToolAtPoint(g, pt);
        return;
      }
      case 'tileStamp': {
        // Same deferral as 'patternPaint': below the slop the press is
        // still ambiguous (tap vs. stroke); once crossed, the down point's
        // cell stamps first, then every cell the trail crosses.
        if (!g.active) {
          if (Math.hypot(pt.x - g.downX, pt.y - g.downY) < TAP_SLOP_PX) return;
          g.active = true;
          stampTileTrail(g, { x: g.downX, y: g.downY });
        }
        stampTileTrail(g, pt);
        return;
      }
      case 'draw': {
        // Below the slop the press is still ambiguous (tap vs. draw) — the
        // same deferral 'shape' and 'placeBox' make.
        if (!g.moved) {
          if (Math.hypot(pt.x - g.downX, pt.y - g.downY) < TAP_SLOP_PX) return;
          g.moved = true;
        }
        const raw = screenToWorld(pt.x, pt.y, liveCameraRef.current, stateRef.current.viewport);
        const clamped = regionClamp([raw.cellX, raw.cellY]);
        const cell = { cellX: clamped[0], cellY: clamped[1] };
        const last = g.cellPoints[g.cellPoints.length - 1];
        if (Math.hypot(cell.cellX - last[0], cell.cellY - last[1]) >= DRAW_MIN_DIST_CELLS) {
          g.cellPoints.push([cell.cellX, cell.cellY]);
          g.screenPoints.push([pt.x, pt.y]);
        }
        updateDrawPreview(g.screenPoints, g.cellPoints);
        return;
      }
      case 'paint': {
        // Below the slop the press is still ambiguous — it may yet become a
        // pinch, and a pinch must leave no paint. The same deferral 'draw',
        // 'shape' and 'placeBox' make; once it resolves as a stroke the first
        // dab lands at the DOWN point, so the stroke starts where the finger
        // did rather than a few px along it.
        if (!g.stamped) {
          if (Math.hypot(pt.x - g.downX, pt.y - g.downY) < TAP_SLOP_PX) return;
          g.stamped = true;
          stampPaintAt(g, { x: g.downX, y: g.downY });
        }
        stampPaintAt(g, pt);
        return;
      }
      default:
        return;
    }
  };

  /** A settled tap (no drag) on the canvas: route it by what it hit and the
   *  active tool (see resolveCanvasTap). Shared by the pan gesture and by a
   *  shape-tool press that never became a drag. */
  /** Would a tile placed under this touch join the pattern that is OPEN
   *  FOR EDITING? The tap and the press both ask
   *  (tileTool.tileTapJoinsPattern): the tap to decide whether it places at
   *  all, the press to decide whether the drag stamps a stroke or drags out
   *  a fresh region. With no grid open it is always no — the Tile tool then
   *  only creates. */
  const tileJoinsHere = (pt: { x: number; y: number }): boolean => {
    const s = stateRef.current;
    const cell = screenToWorld(pt.x, pt.y, liveCameraRef.current, s.viewport);
    return tileTapJoinsPattern(
      s, cell.cellX, cell.cellY, s.gridLevel, propsRef.current.tileEditPatternId,
    );
  };

  /** Did a press land in the paint veil's LIT HOLE — the one region the
   *  recolour brush may write while the selection is its filter?
   *
   *  The hole is the selection's box, which is what the veil draws round
   *  (paintVeilGeomRef, the same geometry the camera path re-anchors), so
   *  this answers the question the veil itself puts on screen. The box, not
   *  a hit-test: a dab inside the box catches the object through its own
   *  radius, so a tap in the empty room beside a drawn line is a dab on that
   *  line, not a miss.
   *
   *  True with NO veil up: there is then no hole to be outside of, and every
   *  press is the stroke it always was. */
  const pressInPaintVeilHole = (pt: { x: number; y: number }): boolean => {
    const geom = paintVeilGeomRef.current;
    if (!geom) return true;
    const s = stateRef.current;
    const cell = screenToWorld(pt.x, pt.y, liveCameraRef.current, s.viewport);
    return selectionBoxHitsCell(geom.box, geom.angleDeg, cell.cellX, cell.cellY);
  };

  const settleTap = (pt: { x: number; y: number }) => {
    // A host layer's pick first (canvasHooks.ts `beforePick`): its own
    // thing under the finger is drawn over every scene node, so it is
    // selected before the scene is asked and the tap is spent on it. Asked
    // fresh rather than read off `pressFrontPickRef`, because a tap settles
    // from branches the press router's set never ran through (a marquee
    // below the slop, a tile stamp that never stamped).
    const picked = propsRef.current.gestures?.beforePick?.(pt.x, pt.y) ?? null;
    if (picked !== null) {
      propsRef.current.onSelect(picked);
      return;
    }
    const hit = hitTestAt(pt);
    const selectedId = propsRef.current.session.selectedId;
    const selectedKind = selectedId ? findItem(stateRef.current, selectedId)?.kind : undefined;
    // The tile tool's one stampable hit: the pattern OPEN FOR EDITING —
    // anything else under the finger is selected instead
    // (resolveCanvasTap). Any other pattern is an object like a text or a
    // photo; the press branch above grabs it before a tap ever settles.
    const hitOnOpenGrid = !!hit && hit.id === propsRef.current.tileEditPatternId;
    const action = resolveCanvasTap(
      hit ? hit.id : null,
      propsRef.current.session.activeTool,
      !!propsRef.current.editingText,
      // A selected rig is a mode rather than a selection — see
      // resolveCanvasTap — so tapping off it clears it even with the
      // toolbar untoggled and the canvas otherwise view-only.
      !!selectedId && !!hostRecordsRef.current?.has(selectedId),
      // With an image (or text) selected, its own tool's off-tap reverts to
      // arrange instead of minting another one (resolveCanvasTap).
      selectedKind === 'image',
      selectedKind === 'text',
      // This app's placing tools, each with the rule its tap is read by
      // (hostTools.ts `tap`): the Figure on empty canvas, the Word anywhere,
      // the tile against what is there.
      hostToolsRef.current,
      {
        openTarget: hitOnOpenGrid,
        // Is there an OPEN grid for a tile to join here? A tap that would
        // start a pattern from nothing clears the selection instead — a
        // pattern is dragged out as a region (tileTapJoinsPattern).
        joins: tileJoinsHere(pt),
      },
    );
    // A tap on the BACKGROUND puts the selection away, under every tool
    // (canvasTap.tapClearsSelection). Said here rather than inside each
    // action so there is ONE rule and not six: the actions below only say
    // what the tap PLACES, and a placement selects what it placed after
    // this. 'select' already carries its own answer.
    if (action.kind !== 'select'
      && tapClearsSelection(
        hit ? hit.id : null,
        propsRef.current.session.activeTool,
        !!propsRef.current.editingText,
      )) {
      propsRef.current.onSelect(null);
    }
    switch (action.kind) {
      case 'select': {
        // Read the pre-tap selection before doSelect flips it, so a re-tap
        // of the already-selected node reaches the shell as wasSelected.
        // A GROUPED node counts through `selectedIds`: a tap on it selects
        // the whole group, so it never becomes `selectedId` and its second
        // tap would otherwise read as a first tap for ever
        // (selectionHoldsNode).
        const wasSelected = action.id !== null && selectionHoldsNode(
          propsRef.current.session, action.id,
          getItemGroupId(stateRef.current, action.id) != null,
        );
        propsRef.current.onSelect(action.id);
        // A tap on a node also drives text editing / photo-replace (shell
        // no-ops on a plain first tap / non-placeholder) — and is recorded
        // so a quick second tap on the (now editing) text reads as a
        // double tap (seekCaretAt → select all).
        if (action.id) {
          lastNodeTapRef.current = { id: action.id, time: Date.now() };
          propsRef.current.onNodeTap(action.id, wasSelected);
        }
        return;
      }
      case 'addText': {
        const cell = screenToWorld(pt.x, pt.y, liveCameraRef.current, stateRef.current.viewport);
        propsRef.current.onAddText(cell.cellX, cell.cellY);
        return;
      }
      case 'requestPhoto': {
        const cell = screenToWorld(pt.x, pt.y, liveCameraRef.current, stateRef.current.viewport);
        propsRef.current.onRequestPhoto(cell.cellX, cell.cellY);
        return;
      }
      case 'revertToArrange':
        propsRef.current.onRevertToArrange();
        return;
      case 'hostPlace': {
        // One of the app's OWN placing tools (hostTools.ts). The canvas's
        // part is the same for every one of them: read the tap, apply the
        // two riders the tool's registry row declares, hand the cell to
        // the shell — which is where the knowledge of what the tool places
        // belongs, and which is the only branch it keeps until stage 6.
        const place = hostTool(hostToolsRef.current, action.tool)?.place;
        // …unless the thumb was reaching for a control and fell short: a
        // tap that close to any floating chrome is meant for the chrome,
        // and a thing placed there is a silent wrong edit. Asked before
        // the cell, because there is then no cell to speak of.
        if (place?.clearOfOverlay && overlayNearTap(pt)) return;
        const s = stateRef.current;
        const cell = screenToWorld(pt.x, pt.y, liveCameraRef.current, s.viewport);
        // …and snapped, for a tool that asks: it lands on an intersection
        // the way every other placement does, rather than between two.
        const at = place?.snap
          ? snapPoint(cell.cellX, cell.cellY, s.gridLevel, gridSnapRef.current)
          : cell;
        propsRef.current.onHostPlace(action.tool, at.cellX, at.cellY);
        return;
      }
      case 'none':
        // No tool active — a tap is inert (the pan it settled from already
        // moved the camera as far as it was going to).
        return;
    }
  };

  /** Drop a live gesture's on-screen leftovers — previews, live transforms,
   *  overlays — without committing anything. The camera modes (pan, pinch)
   *  leave nothing behind; what to do with THEIR live camera is the
   *  caller's call (a multi-finger tap rolls it back, a stale-pointer heal
   *  keeps what is on screen). Shared by the multi-tap undo/redo path and
   *  the heal, so the list of things a gesture can leave lying around is
   *  kept in one place. */
  const dropGestureLeftovers = (g: Gesture) => {
    if (g.mode === 'resize') dropAnyResizePreview(g);
    else if (g.mode === 'drag' || g.mode === 'manipulate') {
      resetDragEl(g.nodeId);
      if (g.mode === 'drag') resetSymmetryPeerEls(g.peers);
      else g.hostTwist?.reset();
    } else if (g.mode === 'marquee') clearMarqueePreview();
    else if (g.mode === 'multiDrag' || g.mode === 'multiManipulate'
      || g.mode === 'multiResize') {
      resetMultiDragEls(g.ids);
      if (g.mode === 'multiDrag') resetSymmetryPeerEls(g.peers);
    }
    else if (g.mode === 'draw') clearDrawPreview();
    else if (g.mode === 'paint') clearPaintOverlay();
    // …and a press a host's hook CLAIMED is cancelled with it: its state is
    // the hook's, so only the hook can unwind it, and a lost finger would
    // otherwise strand a host layer mid-drag.
    dropClaim();
  };

  /** Cancel a claimed press without a finger-up to carry it: the
   *  stale-pointer heal, a page that went to the background mid-touch, the
   *  multi-finger tap's undo. There is no event for the hook to read,
   *  which is why the seam's `onPointerUp` takes none. */
  const dropClaim = () => {
    const claimed = claimedPointerRef.current;
    if (!claimed) return;
    claimedPointerRef.current = null;
    const at = pointersRef.current.get(claimed.pointerId);
    propsRef.current.gestures?.onPointerUp?.(at?.x ?? 0, at?.y ?? 0, 'cancel');
  };

  /** Forget every tracked pointer and the gesture they were driving — the
   *  registry has been shown to be stale (pointerRegistry.ts: a primary
   *  pointer arrived while pointers were still tracked), or the page went
   *  to the background mid-touch, after which no release will ever come.
   *  Nothing is committed: a drag or a stroke that never got its finger-up
   *  is abandoned like a pointercancel; a camera gesture keeps the view
   *  exactly where it stands (it is what the user is looking at — snapping
   *  back to where a lost pinch began would be the jump they never made).
   *  The long-press flags are left alone: an open radial menu is the
   *  shell's to close. */
  const cancelStaleGesture = () => {
    const g = gestureRef.current;
    dropGestureLeftovers(g);
    if (g.mode === 'pinch' || g.mode === 'pan') {
      propsRef.current.onCameraCommit(liveCameraRef.current);
    }
    gestureRef.current = { mode: 'idle' };
    pointersRef.current.clear();
    multiTapMaxFingersRef.current = 0;
    multiTapMovedRef.current = false;
    clearLongPressTimers();
  };
  const cancelStaleGestureRef = useRef(cancelStaleGesture);
  cancelStaleGestureRef.current = cancelStaleGesture;
  // A page that goes to the background mid-touch never sees those fingers
  // lift: when it comes back, whatever was tracked is stale by construction.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') cancelStaleGestureRef.current();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const endGesture = (e: React.PointerEvent, cancelled: boolean) => {
    const pointers = pointersRef.current;
    if (!pointers.has(e.pointerId)) return;
    const pt = localPoint(e);
    pointers.delete(e.pointerId);
    if (claimedPointerRef.current?.pointerId === e.pointerId) {
      claimedPointerRef.current = null;
      clearLongPressTimers();
      propsRef.current.gestures?.onPointerUp?.(pt.x, pt.y, cancelled ? 'cancel' : 'release');
      return;
    }
    const g = gestureRef.current;
    const { onSelect: doSelect, onCommit: doCommit, onCameraCommit: doCameraCommit } = propsRef.current;
    // ACTION entries — move, resize, pinch scale / rotate — commit through
    // the symmetry reflection: with the canvas mirror on, the entry leaves
    // carrying the partner refresh for every object it touched (one undo
    // step). Drawing commits below stay on plain doCommit — they carry
    // their orbit copies already.
    const doCommitReflected = (se: SessionEntry) => doCommit(
      withSymmetryReflection(stateRef.current, se, canvasSymmetrySpec(),
        compSnapStep(stateRef.current.gridLevel)) ?? se);

    // Clear any pending long-press timers; forward the release of an OPEN
    // radial menu to it (activating the hovered action) instead of the
    // normal gesture end. A cancel only clears the flags — Facet's
    // pointercancel path leaves the menu to the shell's own closers.
    clearLongPressTimers();
    if (superLongPressFiredRef.current) {
      superLongPressFiredRef.current = false;
      gestureRef.current = { mode: 'idle' };
      if (!cancelled) propsRef.current.onSuperLongPressUp?.();
      return;
    }
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      gestureRef.current = { mode: 'idle' };
      if (!cancelled) propsRef.current.onLongPressUp?.();
      return;
    }

    // Multi-finger tap → undo (2 fingers) / redo (3), copied from Facet's
    // Canvas. When the LAST finger of a 2+finger gesture lifts quickly with no
    // finger having moved past the slop, it's a tap, not a pinch/rotate: fire
    // undo/redo instead of the tool action. The pinch/manipulate the earlier
    // finger-lifts ran committed nothing — CozyJournal's entry builders no-op
    // on unchanged geometry (buildScaleNode at factor 1, buildRotateNodeFree at
    // an unchanged angle) — so a stationary tap leaves no stray undo entry.
    if (pointers.size === 0 && multiTapMaxFingersRef.current >= 2) {
      const action = classifyMultiTap({
        maxFingers: multiTapMaxFingersRef.current,
        moved: multiTapMovedRef.current,
        elapsed: Date.now() - multiTapStartTimeRef.current,
        stagger: multiTapLastLandAtRef.current - firstFingerDownAtRef.current,
        cancelled,
      });
      multiTapMaxFingersRef.current = 0;
      if (action) {
        // Drop any live gesture leftovers without committing them, then reset.
        dropGestureLeftovers(g);
        if (g.mode === 'pinch') applyLiveCamera(g.startCamera);
        gestureRef.current = { mode: 'idle' };
        if (action === 'undo') propsRef.current.onUndo();
        else propsRef.current.onRedo();
        return;
      }
    }

    switch (g.mode) {
      case 'pinch': {
        if (pointers.size >= 2) return; // other pointers keep pinching
        doCameraCommit(liveCameraRef.current);
        if (pointers.size === 1) {
          const [remaining] = [...pointers.values()];
          gestureRef.current = {
            mode: 'pan', startCamera: liveCameraRef.current,
            startX: remaining.x, startY: remaining.y, moved: true,
          };
        } else {
          gestureRef.current = { mode: 'idle' };
        }
        return;
      }
      case 'manipulate': {
        if (pointers.size >= 2) return; // a third finger keeps twisting
        // Drop the live transforms; the committed render (and the outline)
        // re-anchor from state on the next render, exactly like a drag.
        resetDragEl(g.nodeId);
        g.hostTwist?.reset();
        gestureRef.current = pointers.size === 1
          // A finger remains — hand off to a pan so it stays useful.
          ? (() => {
              const [remaining] = [...pointers.values()];
              return {
                mode: 'pan' as const, startCamera: liveCameraRef.current,
                startX: remaining.x, startY: remaining.y, moved: true,
              };
            })()
          : { mode: 'idle' as const };
        if (cancelled) return;
        // g.angleDeg is the LIVE angle the preview was drawn with (grid-
        // snapped when the preference is on), so the release lands the object
        // exactly where the fingers left it. Factor 1: the scale half of the
        // builders no-ops, and the entry is the pure rotation — two-finger
        // scale stays removed.
        const se = g.hostTwist
          ? g.hostTwist.commit(stateRef.current, g.angleDeg)
          : buildManipulateNode(stateRef.current, g.nodeId, 1, g.angleDeg);
        if (se) doCommitReflected(se);
        return;
      }
      case 'multiManipulate': {
        if (pointers.size >= 2) return; // a third finger keeps twisting
        // Drop the live transforms; the committed render re-anchors from state.
        resetMultiDragEls(g.ids);
        gestureRef.current = pointers.size === 1
          // A finger remains — hand off to a pan so it stays useful.
          ? (() => {
              const [remaining] = [...pointers.values()];
              return {
                mode: 'pan' as const, startCamera: liveCameraRef.current,
                startX: remaining.x, startY: remaining.y, moved: true,
              };
            })()
          : { mode: 'idle' as const };
        if (cancelled) return;
        // One entry for the whole group twist — the same live delta the
        // preview was drawn with; factor 1 keeps every member its own size.
        const se = buildManipulateNodes(
          stateRef.current, g.ids, 1, g.deltaDeg, propsRef.current.session.hostDoc);
        if (se) doCommitReflected(se);
        return;
      }
      case 'multiResize': {
        gestureRef.current = { mode: 'idle' };
        // Drop the live transforms and re-anchor the combined outline on the
        // committed geometry (the commit below re-renders everything).
        resetMultiDragEls(g.ids);
        if (cancelled || !g.changed || !g.lastBox) return;
        // The same box the preview drew — one entry for the whole group.
        const se = buildResizeNodes(
          stateRef.current, g.ids, g.oldBox, g.lastBox, g.angleDeg, g.lastFlip,
          propsRef.current.session.hostDoc);
        if (se) doCommitReflected(se);
        return;
      }
      case 'pan': {
        gestureRef.current = { mode: 'idle' };
        if (cancelled) { applyLiveCamera(g.startCamera); return; }
        if (g.moved) {
          doCameraCommit(liveCameraRef.current);
          return;
        }
        // A middle-button pan never settles a tap (see noTap) — a stationary
        // middle click is inert, not a select / place.
        if (!g.noTap) settleTap(pt);
        return;
      }
      case 'lockedTap': {
        gestureRef.current = { mode: 'idle' };
        const sel = propsRef.current.session;
        if (lockedTapClearsSelection({
          movedPx: Math.hypot(pt.x - g.startX, pt.y - g.startY),
          slopPx: TAP_SLOP_PX,
          hasSelection: !!sel.selectedId || sel.selectedIds.length > 0,
          cancelled,
        })) doSelect(null);
        return;
      }
      case 'nodeTap': {
        // Rotate mode's press (beginHitSelectDrag): nothing moved, so the
        // release is the tap — judged by the same slop every other
        // gesture judges tap-against-drag by, because a finger that swept
        // across the page and lifted is not the second half of a double.
        gestureRef.current = { mode: 'idle' };
        if (cancelled) return;
        if (Math.hypot(pt.x - g.startX, pt.y - g.startY) > TAP_SLOP_PX) return;
        propsRef.current.onNodeTap(g.nodeId, g.wasSelected);
        return;
      }
      case 'drag': {
        gestureRef.current = { mode: 'idle' };
        resetDragEl(g.nodeId);
        resetSymmetryPeerEls(g.peers);
        if (cancelled) return;
        if (g.moved) {
          // Move + (when the drop lands on / leaves a frame) the Figma-style
          // reparent, committed as one undo entry. Same grid-snapped delta
          // the preview showed. Tap-vs-drag is judged on the LATCH the
          // preview keeps, not on the release point, so what was previewed
          // as a move commits as one: a drag that wanders out and comes back
          // stays a drag (it just commits nothing — buildMoveNode no-ops on
          // a null delta), and a press that never previewed anything is the
          // tap it looked like.
          const d = dragDeltaCells(g.nodeId, g.dx, g.dy);
          // …and the word-sticker scale the preview showed rides in the
          // same entry, so one undo puts the word back where it was AND
          // at the size it was (buildMoveNodeWithMaskScale; a plain move
          // for everything the mask rule doesn't touch).
          const se = buildMoveNodeWithDragScale(stateRef.current, g.nodeId, d.dxCells, d.dyCells);
          if (se) doCommitReflected(se);
        } else {
          // A tap (no drag) on a node under the arrange tool. wasSelected marks
          // a re-tap of the current selection, which the shell turns into text
          // editing / photo-replace (a no-op on a plain first tap).
          propsRef.current.onNodeTap(g.nodeId, g.wasSelected);
        }
        return;
      }
      case 'resize': {
        gestureRef.current = { mode: 'idle' };
        // Drop the live-resize override; the commit below (or, if cancelled,
        // the committed geometry) becomes the source of truth on the next
        // render. Both are batched, so there's no intermediate flash — and the
        // commit reproduces the previewed geometry exactly, so nothing moves.
        dropAnyResizePreview(g);
        if (cancelled || !g.changed) return;
        // Recompute the final bbox from the release point (same math as the live
        // preview's last frame, grid snap included) and commit it as one undo entry.
        const cell = resizeCursorCell(pt);
        const { bbox: next, flip } = computeCornerResize(
          g.oldBbox, g.angleDeg, g.sign, cell.cellX, cell.cellY,
          { uniform: g.uniform, freeAxis: g.freeAxis ?? undefined,
            minCells: resizeMinCells([g.targetId]), noFlip: g.frame });
        // A frame commits as a group scale (members follow from their locals);
        // a leaf node commits its own new bbox — turned over, when the
        // corner was let go past the pinned one.
        const se = g.frame
          ? buildResizeFrame(stateRef.current, g.targetId, next)
          : buildResizeNode(stateRef.current, g.targetId, next, flip);
        if (se) doCommitReflected(se);
        return;
      }
      case 'marquee': {
        gestureRef.current = { mode: 'idle' };
        clearMarqueePreview();
        if (cancelled) return;
        // Never crossed the slop → a tap: normal tap routing (select / clear).
        if (!g.active) { settleTap(pt); return; }
        // Select everything the rect touched. The shell normalizes the id
        // list (0 → clear, 1 → single, 2+ → multi with the combined box).
        propsRef.current.onSelectMany(marqueeHitIds(
          stateRef.current, marqueeCellRect(g, pt), propsRef.current.session.hostDoc));
        return;
      }
      case 'multiDrag': {
        gestureRef.current = { mode: 'idle' };
        resetMultiDragEls(g.ids);
        resetSymmetryPeerEls(g.peers);
        if (cancelled) return;
        if (g.moved) {
          // One undo entry moves every member by the same snapped delta the
          // preview showed (judged on the same latch as a single drag). No
          // frame reparenting — the group moves as a rigid unit and its
          // members keep their frame membership.
          const d = multiDragDeltaCells(g.box, g.dx, g.dy);
          const se = buildMoveNodesWithDragScale(
            stateRef.current, g.ids, d.dxCells, d.dyCells, propsRef.current.session.hostDoc);
          if (se) doCommitReflected(se);
        } else {
          // A settled tap inside the combined box: collapse to the normal tap
          // routing — select the item under the finger, or clear on empty.
          settleTap(pt);
        }
        return;
      }
      case 'cropPan': {
        gestureRef.current = { mode: 'idle' };
        const ppc = pxPerCell(liveCameraRef.current, stateRef.current.viewport);
        // Cancel → commit a zero delta, which rolls the preview back to the
        // pre-drag snapshot without an undo entry. A real drag commits one step.
        const moved = !cancelled && Math.hypot(g.dx, g.dy) > TAP_SLOP_PX;
        propsRef.current.onCropPan(
          g.nodeId, moved ? g.dx / ppc : 0, moved ? g.dy / ppc : 0, true);
        return;
      }
      case 'cropZoom': {
        if (pointers.size >= 2) return; // a third finger keeps zooming
        // A finger remains → continue as a one-finger crop pan; else finish.
        gestureRef.current = pointers.size === 1
          ? (() => {
              const [remaining] = [...pointers.values()];
              return {
                mode: 'cropPan' as const, nodeId: g.nodeId,
                startX: remaining.x, startY: remaining.y, dx: 0, dy: 0,
              };
            })()
          : { mode: 'idle' as const };
        // Commit the zoom as one step; a cancel (or unmoved pinch) rolls back.
        propsRef.current.onCropZoom(g.nodeId, cancelled ? 1 : g.factor, true);
        return;
      }
      case 'shape': {
        gestureRef.current = { mode: 'idle' };
        clearShapePreview();
        if (cancelled) return;
        // Never crossed the slop → this was a tap, not a draw: fall back to
        // the normal tap routing (select / clear), as Facet does.
        if (!g.active || !g.end) { settleTap(pt); return; }
        // The drag's final point is pulled onto the midline's grid point
        // when within tolerance (§7.3's magnet), like a stroke's end.
        // A line's or arc's START is one of its ends as well (UX §4.1); a
        // polygon's start is a corner of its box, not an end.
        if (g.tool !== 'polygon') g.start = regionMagnet(g.start);
        g.end = regionMagnet(g.end);
        const se = g.tool === 'line'
          ? buildPlaceLineShape(g.start, g.end, propsRef.current.currentColor, propsRef.current.lineToolMode, stateRef.current.gridLevel)
          : g.tool === 'polygon'
            ? (polygonIsCircle(propsRef.current.polygonSides)
              ? buildPlaceArcShape(g.start, g.end, g.start, propsRef.current.currentColor, 'circle')
              : buildPlacePolygonShape(g.start, g.end, propsRef.current.polygonSides, propsRef.current.currentColor))
            : buildPlaceArcShape(g.start, g.end, g.center ?? g.start, propsRef.current.currentColor, propsRef.current.arcToolMode);
        // A LINE and an ARC commit without the mint's auto-selection
        // (dropping `id` is what turns that off — see commitEntry), for the
        // same reason a freehand stroke does: they are marks, drawn in runs,
        // and a box with eight handles thrown over each one — plus the
        // properties panel rising over the bottom of the page — sits between
        // every mark and the next. The POLYGON tool keeps its selection: one
        // deliberate rectangle is a thing you then place, size and colour.
        // A new shape arrives dressed in the last style the user set — the
        // stroke half on every tool, the fill half on the closed shapes
        // (see withNewShapeStyle).
        const dressed = withSymmetryCopies(
          withNewShapeStyle(
            se,
            propsRef.current.newShapeStyle ?? DEFAULT_NEW_SHAPE_STYLE,
            propsRef.current.currentColor,
          ),
          // The canvas Symmetry setting: the shape commits with its orbit
          // copies in the same entry (dressed first, so the copies wear
          // the same fill and stroke).
          canvasSymmetrySpec(),
          compSnapStep(stateRef.current.gridLevel),
        );
        if (dressed) doCommit(g.tool === 'polygon' ? dressed : { ...dressed, id: undefined });
        return;
      }
      case 'placeBox': {
        gestureRef.current = { mode: 'idle' };
        clearPlaceBoxPreview();
        if (cancelled) return;
        // Never crossed the slop → a tap: the tool's normal tap routing
        // (place text at the point / open the picker centered on it). A drag
        // whose box came out sliver-thin settles the same way rather than
        // minting an unusably small node.
        const bbox = g.active && g.end ? dragCellBbox(g.start, g.end) : null;
        if (!bbox) { settleTap(pt); return; }
        const cx = bbox.cellX + bbox.cellWidth / 2;
        const cy = bbox.cellY + bbox.cellHeight / 2;
        // NOTE: onRequestPhoto opens the file picker and must run inside the
        // pointerup's transient user activation — nothing async before it.
        if (g.tool === 'text') propsRef.current.onAddText(cx, cy, bbox);
        else propsRef.current.onRequestPhoto(cx, cy, bbox);
        return;
      }
      case 'patternRegion': {
        gestureRef.current = { mode: 'idle' };
        clearPlaceBoxPreview();
        if (cancelled) return;
        // Never crossed the slop → a tap: normal tap routing (clears the
        // selection, keeps the tool armed).
        if (!g.active || !g.region) { settleTap(pt); return; }
        const step = compSnapStep(stateRef.current.gridLevel);
        const cols = Math.max(1, Math.min(MAX_PATTERN_GRID, Math.round(g.region.cellWidth / step)));
        const rows = Math.max(1, Math.min(MAX_PATTERN_GRID, Math.round(g.region.cellHeight / step)));
        // A region laid against an existing compatible pattern grows THAT
        // object rather than leaving a second one beside it — the tile
        // stroke's own join rule, which is touching (mergeTileStrokeOps).
        propsRef.current.onCreatePattern(g.region, cols, rows);
        return;
      }
      case 'patternPaint': {
        gestureRef.current = { mode: 'idle' };
        // A stationary press IS a stamp — applied here rather than on
        // contact so a press that turned out to be a pinch's first finger
        // leaves the pattern untouched (same rule as 'paint').
        if (!cancelled && !g.stamped) {
          // …and a stationary press on the BACKGROUND puts the selection
          // away, as a tap does under every tool (canvasTap
          // .tapClearsSelection). The brushes never settle through
          // settleTap — their tap IS a stamp — so they say the rule here.
          if (hitTestAt({ x: g.downX, y: g.downY }) === null) propsRef.current.onSelect(null);
          g.stamped = true;
          applyPatternToolAtPoint(g, { x: g.downX, y: g.downY });
        }
        finishPatternPaint(g, cancelled);
        return;
      }
      case 'tileStamp': {
        gestureRef.current = { mode: 'idle' };
        // Never crossed the slop → a tap: nothing stamped yet, so the
        // teardown is a no-op and the normal tap routing places the single
        // tile (settleTap → 'hostPlace' for the tile, with its own selection
        // behaviour).
        if (!cancelled && !g.active) {
          finishTileStamp(g, true);
          settleTap(pt);
          return;
        }
        finishTileStamp(g, cancelled);
        return;
      }
      case 'draw': {
        gestureRef.current = { mode: 'idle' };
        clearDrawPreview();
        if (cancelled) return;
        // Never crossed the slop → this was a tap, not a stroke: fall back to
        // the normal tap routing, which clears the selection and leaves the
        // pencil armed. Exactly what Line and Arc do.
        if (!g.moved) { settleTap(pt); return; }
        const filtered = filterPolylinePoints(g.cellPoints, DRAW_MIN_DIST_CELLS / 2);
        // The stroke's END is pulled onto the midline's grid point when it
        // lands within tolerance of it (§7.3's magnet): freehand samples
        // never snap, so this is what lets a stroke connect.
        // Its START too: a stroke drawn up FROM the dotted line connects
        // there as surely as one drawn down to it (UX §4.1).
        if (filtered.length > 0) {
          filtered[0] = regionMagnet(filtered[0]);
          filtered[filtered.length - 1] = regionMagnet(filtered[filtered.length - 1]);
        }
        // A freehand mark is born in the last stroke the user set — ink,
        // width, dash — like every other object with a stroke
        // (withNewShapeStyle; the draft above drew in the same). The
        // canvas Symmetry setting: the stroke commits with its orbit copies
        // riding the same entry (dressed first, so the copies wear the
        // same stroke — and the same no-selection rule).
        const se = withSymmetryCopies(
          withNewShapeStyle(
            buildPlacePolyline(filtered, propsRef.current.currentColor),
            propsRef.current.newShapeStyle ?? DEFAULT_NEW_SHAPE_STYLE,
            propsRef.current.currentColor,
          ),
          canvasSymmetrySpec(),
          compSnapStep(stateRef.current.gridLevel),
        );
        // Committed WITHOUT the mint's auto-selection (dropping `id` is what
        // turns that off — see commitEntry). Drawing freehand is a run of
        // strokes: pick up the pencil, make a mark, make the next one. A
        // selection after each one throws a box and eight handles over the
        // drawing you are looking at, and puts the properties panel up over
        // the bottom of it, between every stroke and the one after it. The
        // shape tools keep theirs — one deliberate rectangle is a thing you
        // then place, size and colour.
        if (se) doCommit({ ...se, id: undefined });
        return;
      }
      case 'paint': {
        gestureRef.current = { mode: 'idle' };
        // A stationary press IS a dab — the color group's tap. It is stamped
        // here rather than on contact so that a press which turned out to be
        // the first finger of a pinch leaves nothing behind; by now no second
        // finger came, so this one was a tap after all. At the down point,
        // which is where the user aimed.
        if (!cancelled && !g.stamped) {
          // …unless it is a tap on the BACKGROUND while the recolour brush's
          // filter is in force. The veil has just told the reader that the
          // selected object is the only thing this brush can write
          // (paintFilterIds), so a tap outside the lit hole is a dab that
          // provably marks nothing — and it is the one gesture that means
          // "put this away" under every other tool (resolveCanvasTap's
          // empty-canvas select(null)). Without it the selection could only
          // be dropped by disarming the brush.
          //
          // The recolour brush alone: the raster four wear the same veil, but
          // a tap off a selected paint ISLAND deposits into that island, and
          // that is a mark, not a miss. A DRAG is untouched either way — it
          // stamped, so it never reaches here — so starting just outside the
          // box and sweeping across it still paints.
          if (g.kind === 'color' && g.filterIds
            && !pressInPaintVeilHole({ x: g.downX, y: g.downY })) {
            propsRef.current.onSelect(null);
            // Nothing was stamped, so there is nothing to commit: the
            // cancelled path puts the (empty) previews back and writes no
            // undo entry.
            finishPaintStroke(g, true);
            return;
          }
          // …and a second quick tap on the same pattern GRID is the double
          // tap that opens it for editing, exactly as the arrange tool's
          // second tap is (onColorBrushDoubleTap) — the recolour brush is
          // the tool in hand on a Patchwork piece, and its tap used to be
          // only ever a dab. The shell lifts the first tap's dab where it
          // can, and the second is never stamped: the finger asked for
          // the grid, not for two dabs.
          if (g.kind === 'color') {
            const hit = hitTestAt({ x: g.downX, y: g.downY });
            const grid = hit && tapLandsOnPatternGrid(stateRef.current, hit.id) ? hit.id : null;
            const now = Date.now();
            const last = lastColorTapRef.current;
            const undoDepth = propsRef.current.session.undoStack.length;
            if (grid !== null && last !== null && isTextDoubleTap(last, grid, now)) {
              lastColorTapRef.current = null;
              // The first tap's dab is the newest entry only if it committed
              // one at all: a dab that changed nothing wrote nothing.
              const undoFirstDab = undoDepth === last.undoDepth + 1;
              if (propsRef.current.onColorBrushDoubleTap?.(grid, undoFirstDab)) {
                finishPaintStroke(g, true);
                return;
              }
            }
            lastColorTapRef.current = grid === null ? null : { id: grid, time: now, undoDepth };
          }
          // …and a dab on the BACKGROUND puts the selection away, as a tap
          // does under every tool (canvasTap.tapClearsSelection). The
          // brushes never settle through settleTap — a stationary press IS
          // a dab — so the rule is said here, and the dab still lands:
          // what the tap drops is the selection, not the mark. The filter
          // this stroke runs under was resolved at press (g.filterIds), so
          // clearing it now cannot change what this dab writes.
          //
          // This is what a selection had no other way out of: with one up,
          // the brush is confined to it and a veil is drawn over the rest
          // of the page, and putting that away meant disarming the tool.
          if (hitTestAt({ x: g.downX, y: g.downY }) === null) propsRef.current.onSelect(null);
          g.stamped = true;
          stampPaintAt(g, { x: g.downX, y: g.downY });
        }
        finishPaintStroke(g, cancelled);
        return;
      }
      default:
        return;
    }
  };

  // Disarm iOS's text-selection loupe on the canvas. Without this, tapping an
  // unfilled photo placeholder — which opens the `<input type="file">` upload
  // sheet from inside the tap — leaves WKWebView's UITextInteraction recognizer
  // armed with no touchend to cancel it (the native sheet covers the WebView),
  // so the round magnifier paints over the cream canvas and only clears on its
  // own fade-out timer. Same fix the tile-editor canvas already carries.
  useSuppressIOSLoupe(containerRef);

  // ── Wheel zoom (desktop) ──────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let commitTimer: ReturnType<typeof setTimeout> | null = null;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const camera = zoomAboutPoint(
        liveCameraRef.current, stateRef.current.viewport,
        e.clientX - rect.left, e.clientY - rect.top,
        wheelZoomFactor(e.deltaY),
      );
      applyLiveCamera(camera);
      if (commitTimer) clearTimeout(commitTimer);
      commitTimer = setTimeout(() => propsRef.current.onCameraCommit(liveCameraRef.current), 160);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (commitTimer) clearTimeout(commitTimer);
    };
  }, [applyLiveCamera]);

  // ── Render ────────────────────────────────────────────────────────
  const t = worldLayerTransform(state.camera, state.viewport);
  const pageCellsH = pageHeightCells(aspect);
  // What the selection outline hugs: a leaf node's bbox, or — for a frame,
  // which is selected from the Scene Outline and is not a leaf item — the
  // frame's boundary rect. Memoized because resolving a frame rebuilds the
  // mask map; a leaf selection is a cheap lookup either way.
  const selectionBox = useMemo(
    () => resolveSelectionBox(state, session.selectedId),
    [state, session.selectedId],
  );
  // A multi-selection outlines ONE combined box containing every member —
  // no per-member boxes. Axis-aligned for a loose selection; a bound group
  // turned off the quarters wears its own turned box, handles and all
  // (resolveMultiSelectionFrame).
  const multiSelectionFrame = useMemo(
    () => (session.selectedIds.length >= 2
      ? resolveMultiSelectionFrame(state, session.selectedIds, session.hostDoc)
      : null),
    [state, session.hostDoc, session.selectedIds],
  );
  const multiSelectionBox = multiSelectionFrame?.bbox ?? null;
  // A GROUP selection resizes as one unit from its combined box's corners —
  // the same gate accepts the grab (beginMultiCornerResize), so the handles
  // are never drawn where the drag would be refused.
  const multiResizable = useMemo(
    () => multiSelectionBox !== null
      && canResizeMultiSelection(state, session.selectedIds),
    [state, session.selectedIds, multiSelectionBox],
  );
  const selectedAngleDeg = multiSelectionFrame ? multiSelectionFrame.angleDeg : selectionBox?.angleDeg ?? 0;
  // The pattern that is OPEN FOR EDITING (tileEditPatternId): its own box,
  // framed below with the doubled ring — the page's one sign that this
  // grid's contents can be changed. Drawn whether or not it is also the
  // selection: the double border marks editability, which outlives any one
  // tap, so it must not blink out when the object is taken up.
  // A SHAPE whose pattern fill is the open grid wears its own outline
  // doubled instead of a box (ShapePatternEditOutline): a fill is painted
  // inside the shape, so the sign saying which grid the next press lands
  // in has to be that shape's outline. Null for a pattern object, which is
  // a box and keeps the rectangular ring below.
  const tileEditShape = useMemo(() => {
    if (!tileEditPatternId) return null;
    const ref = findItem(state, tileEditPatternId);
    return ref?.kind === 'svg' && ref.item.patternFill ? ref.item : null;
  }, [state, tileEditPatternId]);
  const tileEditBox = useMemo(
    () => (tileEditPatternId && !tileEditShape ? resolveSelectionBox(state, tileEditPatternId) : null),
    [state, tileEditPatternId, tileEditShape],
  );
  const tileEditRingColor = tileEditBox && (tileEditBox.freeAxis || tileEditBox.pattern)
    ? SELECTION_ORANGE : SELECTION_COLOR;
  // …and mid-resize it hugs the PREVIEWED grid, not the committed one —
  // the same swap the selection outline makes just below, through the same
  // resizePreviewBox. Without it the double border kept the size the grid
  // had when the finger went down and snapped into place on release, which
  // reads loudest on a repeating grid: a corner drag there grows the region
  // by whole tiles, so the ring sat visibly short of the copies appearing
  // under it for the whole drag. The double border marks editability, and
  // it has to mark the object where the object actually IS.
  const tileEditOutlineBbox = tileEditBox
    ? (liveResize && liveResize.id === tileEditPatternId
      ? resizePreviewBox(liveResize.node, state.gridLevel)
      : tileEditBox.bbox)
    : null;
  // Mid-resize the outline hugs the previewed node — the same object the
  // canvas draws, so box and content can never disagree by a frame; otherwise
  // it hugs the committed geometry. (A frame resize previews imperatively —
  // see applyFramePreview — so it never comes through here.) A previewed
  // simple H/V line hugs its straddle box (the previewed node carries the
  // updated creationBox), not its degenerate segment AABB — resizePreviewBox
  // knows that rule, and the tile-edit ring above asks the same function.
  const outlineBox = multiSelectionBox ?? (selectionBox
    ? (liveResize && liveResize.id === session.selectedId
      ? resizePreviewBox(liveResize.node, state.gridLevel)
      : selectionBox.bbox)
    : null);
  // …and the RING is that box grown by whatever ink hangs outside it —
  // a bent text's bow, and nothing else (SelectionBox.inkOutset). The
  // handles below stay on the box itself, which is what a corner drag
  // writes back, so on a bowed page the ring runs a little outside them.
  const ringOutset = multiSelectionBox ? NO_OUTSET : selectionBox?.inkOutset ?? NO_OUTSET;
  const ringBox = outlineBox === null ? null : selectionRingBbox(outlineBox, ringOutset);
  // Move and Rotate ring the object's OWN BORDER instead of that rectangle
  // (selectionShapeOutline). Neither mode scales, so there are no corner
  // handles for a box to carry — and the box is exactly what is wrong about
  // a triangle, a curve or a letterform when the question on screen is
  // "which thing am I about to move". Select keeps the rectangle: that is
  // the mode whose corners are grabbable, and the box is what they are on.
  // A multi-selection keeps it too — the combined box is not any one
  // object's border — and so does an OPEN stroke, whose "border" is just its
  // own ink: only a closed shape traces (selectionShapePath). The box it
  // keeps is handle-free all the same (arrangeModeNoScale, below).
  // The ink the selection wears, box or border alike: blue, orange for a
  // repeating grid and for the one straddle box a simple line gets.
  const selectionRingColor = !multiSelectionBox && selectionBox && (selectionBox.freeAxis || selectionBox.pattern)
    ? SELECTION_ORANGE : SELECTION_COLOR;
  // A COLOR BRUSH keeps the mode's border too, though it is not the
  // selection tool: with one armed the selection is the brush's filter and
  // the veil below cuts its lit hole to this same border, so a rectangle
  // ring drawn over a shaped hole would contradict it.
  const tracesOwnBorder = arrangeModeTracesShape(arrangeMode)
    && (arrangeModeNoScale(session.activeTool, arrangeMode)
      || brushDimsToSelection(session.activeTool));
  // Whether the HOST keeps a record beside a scene node, asked ONCE per
  // render (canvasHooks.ts `CanvasRecords`) — CozyJournal's rig keeps its
  // pose, its colours and its roll on a hidden one. A predicate, never the
  // record: three rules read it and all three are about a selection that
  // is a MODE rather than an object in hand. In a ref too, because the
  // gesture handlers are created once.
  //
  // Declared ahead of the shape outline below, which is the third reader:
  // it used to ask the host itself and so walked the page a second time
  // per render, which this seam's own contract forbids — a host that has
  // to find its own kinds finds them once.
  const hostRecords = useMemo(() => canvasHost().records?.(state) ?? null, [state]);
  const hostRecordsRef = useRef<CanvasRecords | null>(hostRecords);
  hostRecordsRef.current = hostRecords;

  const shapeOutlinePath = useMemo(
    () => (tracesOwnBorder && !multiSelectionBox && selectionBox
      ? selectionShapePath(
        state, session.selectedId, selectionBox.local, selectionBox.freeAxis, hostRecords)
      : null),
    [state, tracesOwnBorder, session.selectedId, multiSelectionBox, selectionBox, hostRecords],
  );
  // Read by the gesture handlers, which re-anchor the ring imperatively.
  ringOutsetRef.current = ringOutset;
  // …and the SELECTION BOX stands down while that same shape's pattern
  // fill is open for painting. The doubled ring on the shape's own outline
  // (ShapePatternEditOutline) already frames the object, and it frames it
  // in the shape the presses actually land in; a rectangle drawn around
  // that says nothing the outline doesn't and crosses it everywhere the
  // shape isn't a rectangle. The box comes back the moment the fill is
  // closed, because `tileEditShape` goes null with it. Only the box is
  // withheld, not the selection: `outlineBox` still stands for the paint
  // veil's lit hole below, and every gesture still reads the selection.
  // A pattern OBJECT keeps its box — there the edit ring IS a box in the
  // same place, so the two coincide instead of fighting.
  const patternEditReplacesSelectionBox = tileEditShape !== null
    && multiSelectionBox === null
    && session.selectedId === tileEditShape.id;

  // The paint veil's hole geometry, for the camera path (applyLiveCamera) to
  // re-anchor the screen-space veil between renders. Written every render so
  // it can never go stale against the element the render mounts. A selected
  // RIG under the raster brushes shows no veil: a rig is a mode more than a
  // selection — it rides along while other work happens — and painting with
  // the whole canvas held dark behind it read as a stuck overlay.
  const paintVeilOn = brushDimsToSelection(session.activeTool) && outlineBox !== null
    && !(isRasterBrushToolId(session.activeTool)
      && !!session.selectedId && !!hostRecords?.has(session.selectedId));
  // …with the hole's SHAPE alongside it: null for the box hole, the
  // object's own border under Move and Rotate (shapeOutlinePath).
  paintVeilGeomRef.current = paintVeilOn
    ? { box: outlineBox!, angleDeg: selectedAngleDeg, shape: shapeOutlinePath }
    : null;
  // The axes follow the spec the stamps use: with a pattern selected, its
  // own box — centred on it and stopping at its edges (bounded).
  // …scoped to the selected pattern, or to the grid the tile tool is
  // editing under its double ring (symmetryScopeId): the axes sit on that
  // grid, clipped to it, as if it were selected.
  const symmetrySpec = canvasSymmetrySpecOf(state, tileEditPatternId ?? session.selectedId);
  // …and drawn at all only where the scope has axes to draw: a pattern in
  // REPEAT mode shows its tile over and over, so one pair of axes across
  // the whole region would rule lines through every copy. The mirror still
  // applies — this hides the drawing, not the symmetry (symmetryAxesShown).
  const symmetryAxes = symmetryAxesShown(symmetrySpec, state.patternObjects);
  symmetryModelRef.current = symmetryOverlayFor(symmetrySpec, state.patternObjects, state.gridLevel);
  // …and are redrawn the moment the MODEL changes by value — a pattern
  // picked or dropped moves the mirror onto (or off) its box without
  // touching the camera or the committed state, which is all the resync
  // effect below watches; the axes used to stay put until the pattern was
  // moved. Keyed on the spec's value (a few small fields, per render, never
  // per frame); the live camera is read, so a mid-gesture pick lands where
  // the view stands.
  const symmetryModelKey = JSON.stringify([
    symmetrySpec?.only ?? null, symmetrySpec?.frame ?? null, symmetrySpec?.flags ?? null, state.gridLevel,
    symmetrySpec?.angleDeg ?? 0,
    // …and whether the scope draws axes at all, so toggling Repeat on the
    // pattern in hand takes them off (and back) without waiting for the
    // box to move.
    symmetryAxes,
  ]);
  // Written whenever the model on screen is not the one this render holds:
  // the key last written is remembered, and every imperative writer (a
  // drag's shifted axes, a stroke's grown grid, a cancel's restore) marks
  // it stale — so dropping a pattern's selection, however it happens, puts
  // the axes back on the canvas frame on that very render, never a
  // pan/zoom later.
  useEffect(() => {
    if (axesWrittenKeyRef.current === symmetryModelKey) return;
    axesWrittenKeyRef.current = symmetryModelKey;
    writeAxes(worldLayerTransform(liveCameraRef.current, stateRef.current.viewport), stateRef.current.viewport);
  });

  const nodeById = useMemo(() => {
    const map = new Map<string, { kind: 'svg' | 'image' | 'text' | 'paint' | 'pattern'; node: any }>();
    for (const s of state.svgObjects) map.set(s.id, { kind: 'svg', node: s });
    for (const i of state.images ?? []) map.set(i.id, { kind: 'image', node: i });
    for (const x of state.texts ?? []) map.set(x.id, { kind: 'text', node: x });
    for (const p of state.paintObjects ?? []) map.set(p.id, { kind: 'paint', node: p });
    for (const p of state.patternObjects ?? []) map.set(p.id, { kind: 'pattern', node: p });
    return map;
  }, [state.svgObjects, state.images, state.texts, state.paintObjects, state.patternObjects]);

  // What each leaf is DRAWN as: its graph node and world matrix, identity-
  // stable across renders for a leaf nothing moved (drawnLeaves), which is
  // what lets the memoised layers skip it. The graph is the pose's truth;
  // the legacy view above is what the hit tests and the outline still read.
  const drawnRef = useRef<Map<string, DrawnLeaf>>(new Map());
  const drawnById = useMemo(() => {
    const next = drawnLeaves(graphOf(state), drawnRef.current);
    drawnRef.current = next;
    return next;
  }, [state]);

  // Figma-style frames: map each frame group to its clip rect (its active rect
  // mask). Children are clipped on-canvas by an overflow:hidden wrapper — the
  // same rect the SVG export clips to (compositionSVGCore) — so the preview
  // matches the exported image.
  const frameRects = useMemo(
    () => buildFrameRectMap({ groups: state.groups, svgObjects: state.svgObjects, sceneOrder: state.sceneOrder }),
    [state.groups, state.svgObjects, state.sceneOrder],
  );
  // Mirror the boundary-rect ids into the ref hitTestAt reads (see above),
  // and the rect map itself into the ref the drag handlers read.
  frameBoundaryIdsRef.current = useMemo(() => {
    const ids = new Set<string>();
    for (const mask of frameRects.values()) ids.add(mask.id);
    return ids;
  }, [frameRects]);
  frameRectsRef.current = frameRects;

  // Groups hidden by their own flag or an ancestor's. Members inherit the
  // hide (their own `hidden` flags stay untouched), so the check is on the
  // node's group, not the node. Memoized per groups array: the render walk
  // below is per-node and must not re-walk an ancestor chain each time.
  const hiddenGroups = useMemo(() => hiddenGroupIds(state.groups), [state.groups]);
  /** What this render is re-drawing through React rather than previewing
   *  with an element transform (canvasHooks.ts `HostNodeLayerInput`): the
   *  off-square poses and a live resize's target. A host that draws many
   *  nodes as one element reads it to lift such a node back out for the
   *  length of the gesture. */
  const liveIds = useMemo(() => {
    const ids = new Set<string>(livePose ? livePose.keys() : []);
    if (liveResize) ids.add(liveResize.id);
    return ids;
  }, [livePose, liveResize]);

  // The view facts a host's own layer sizes itself from (canvasHooks.ts
  // `HostNodeLayerInput`): the zoom the page is drawn at, the device pixel
  // ratio, and whether a gesture or a camera tween is in flight — a host
  // raster is never regenerated on those frames.
  const zoomScale = worldLayerTransform(state.camera, state.viewport).scale;
  const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  const isGestureBusy = useCallback(
    () => gestureRef.current.mode !== 'idle' || cameraTweenRef.current !== null,
    [],
  );

  /** A leaf as it should be DRAWN right now: its committed pose, or the
   *  one an off-square gesture is previewing it at. One reader for the
   *  node layers and for a frame's clip — the clip is its boundary rect
   *  drawn like any other leaf, and a frame stretched off square has to
   *  clip where its members are being drawn. */
  const drawnPosed = useCallback((id: string): DrawnLeaf | undefined => {
    const committed = drawnById.get(id);
    const posed = committed && livePose?.get(id);
    return posed ? { node: committed.node, world: posed } : committed;
  }, [drawnById, livePose]);

  const renderNode = useCallback((id: string) => {
    const entry = nodeById.get(id);
    if (!entry) return null; // figures render via the GL pass only
    if (entry.node.groupId && hiddenGroups.has(entry.node.groupId)) return null;
    // Mid-resize, the dragged node renders from its previewed geometry — the
    // rescaled object release will commit — so svg segments, text wrapping and
    // image framing all follow the box live. Every other node keeps its
    // committed drawn identity, so the memoized layers skip re-rendering
    // entirely while a resize re-renders each frame. The preview is a legacy
    // object in no graph, drawn as the node the graph would make of it.
    // Mid-gesture, an off-square member draws at the world matrix the
    // release will give it (drawnPosed) — same node, new pose, so the
    // stroke split is taken afresh and the lines keep their weight.
    const drawn = liveResize && liveResize.id === id
      ? drawnLeafOf(entry.kind, liveResize.node)
      : drawnPosed(id);
    if (!drawn) return null;
    // The HOST's own DOM for this node, if it has any (canvasHooks.ts
    // `CanvasLayers`): an element to draw instead of the package's layer,
    // `null` for a node of the host's that draws nothing here, and
    // `undefined` for one that is none of the host's. Asked BEFORE the
    // hidden check, so a host can keep its own thing mounted while the page
    // hides it — this app's rig paints itself invisible rather than
    // unmounting, which is what keeps its GL context alive.
    const hostLayer = layers?.nodeLayer?.({
      id,
      kind: entry.kind,
      node: (liveResize && liveResize.id === id ? liveResize.node : entry.node) as LegacyLeaf,
      drawn,
      strokeScale: state.strokeScale,
      zoom: zoomScale,
      dpr,
      isBusy: isGestureBusy,
      liveIds,
      hiddenGroups,
    });
    if (hostLayer !== undefined) return hostLayer;
    // A veiled or hidden leaf draws nothing.
    if (entry.node.hidden) return null;
    switch (entry.kind) {
      case 'svg':
        return <SvgNodeLayer key={id} drawn={drawn} strokeScale={state.strokeScale} />;
      case 'image':
        return <ImageNodeLayer key={id} drawn={drawn} src={srcForNode(entry.node as ImageObject)} />;
      case 'paint':
        return <PaintNodeLayer key={id} drawn={drawn} />;
      case 'pattern':
        return <PatternNodeLayer key={id} drawn={drawn} strokeScale={state.strokeScale} />;
      case 'text': {
        // Native in-canvas caret: mapped from the invisible textarea's UTF-16
        // index onto this node's own layout (same layoutText the layer draws
        // with, in the node's own box), so the caret sits exactly between
        // the glyphs on screen.
        const text = drawn.node.content as TextObject;
        const mine = editingCaret && editingCaret.textId === id ? editingCaret : null;
        const caretCp = mine ? caretCodePoint(text.content, mine.utf16) : 0;
        const caret = mine ? textCaretBox(drawn, caretCp) : null;
        // …and the band behind the glyphs when the field holds a RANGE
        // rather than a caret. The caret stays drawn at its own end, as it
        // is in a text field: the range is where the next keystroke lands
        // and the caret says which way it grows.
        const anchorCp = mine && mine.anchorUtf16 !== undefined
          ? caretCodePoint(text.content, mine.anchorUtf16) : caretCp;
        const selection = mine && anchorCp !== caretCp
          ? textSelectionBoxes(drawn, anchorCp, caretCp) : null;
        return <TextNodeLayer key={id} drawn={drawn} caret={caret} selection={selection} />;
      }
      default:
        return null;
    }
  }, [nodeById, drawnPosed, layers, zoomScale, dpr, isGestureBusy, state.strokeScale, srcForNode, liveResize,
    hiddenGroups, editingCaret]);

  // Walk sceneOrder, wrapping each contiguous run of nodes owned by the same
  // frame in a fixed-in-world clip box. Group members are contiguous in
  // sceneOrder, so one wrapper per frame preserves z-order. The wrapper is
  // anchored in world space (not per-node), so dragging a child re-clips for
  // free during direct-DOM-mutation gestures — no per-frame recompute.
  const renderScene = (): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    const order = state.sceneOrder;
    const frameOf = (id: string): string | undefined => {
      const e = nodeById.get(id);
      const fid = e ? frameGroupIdForNode(state.groups, e.node.groupId) : undefined;
      return fid && frameRects.has(fid) ? fid : undefined;
    };
    let i = 0;
    while (i < order.length) {
      const frameId = frameOf(order[i]);
      if (!frameId) { out.push(renderNode(order[i])); i++; continue; }
      const runIds: string[] = [];
      while (i < order.length && frameOf(order[i]) === frameId) { runIds.push(order[i]); i++; }
      // A hidden frame draws nothing at all — not even the wrapper, whose own
      // box-shadow / border overlay would otherwise survive its empty
      // (all-children-null) contents as a floating outline.
      if (hiddenGroups.has(frameId)) continue;
      const mask = frameRects.get(frameId)!;
      // The clip is the boundary rect as the graph DRAWS it: its local box
      // through its world matrix, so a tilted rect clips tilted and a frame
      // inside a bound group clips where it stands (drawnPose.drawnClip).
      const clip = drawnClip(drawnPosed(mask.id) ?? drawnLeafFor('svg', mask, graphOf(state)), BASE_CELL_PX);
      out.push(
        <div
          key={`frame-${frameId}`}
          data-frame-id={frameId}
          style={{
            position: 'absolute',
            left: clip.left,
            top: clip.top,
            width: clip.width,
            height: clip.height,
            overflow: 'hidden',
            // Anchor for the clip's own pose and for the live frame-resize
            // gesture written on top of it (applyFramePreview), both of which
            // map this element's top-left onto the frame's world origin.
            transformOrigin: '0 0',
            transform: clip.transform || undefined,
            // The frame's drop shadow (stored on its boundary rect,
            // `mask.effects`) rides the clip wrapper itself, NOT the boundary
            // node inside it: an element's own box-shadow is not clipped by its
            // own `overflow: hidden`, whereas the boundary node — a clipped
            // descendant — would have its shadow cropped at the frame edge. The
            // wrapper's box is exactly the frame rect, so the shadow hugs the
            // frame like an image's does. Shadow/glow ONLY — the border is a
            // stroked-rect overlay below (so it honors inside/center/outside and
            // never reads as a shadow).
            boxShadow: shadowGlowBoxShadow(mask.effects),
          }}
        >
          {/* Re-base to world origin so children keep their absolute world
              coords (NodeLayer.outerStyle) while being clipped to the box.
              It undoes the clip's own pose too — a member carries the frame
              group's transform in its own world matrix already, and must not
              take it twice — which is what lets a live resize gesture worn
              on the clip reach every member as itself. */}
          <div style={{
            position: 'absolute', left: clip.rebase.left, top: clip.rebase.top,
            width: 0, height: 0,
            transformOrigin: '0 0',
            transform: clip.rebase.transform || undefined,
          }}>
            {runIds.map(renderNode)}
          </div>
        </div>,
      );
      // Border overlay OUTSIDE the clip wrapper so center/outside strokes that
      // extend past the frame edge aren't cropped, and the inside/center/outside
      // control actually shifts the stroke (a box-shadow ring can't). Placed
      // just after the frame's clipped content so it paints over the board edge.
      if (mask.effects?.border) {
        out.push(
          <div
            key={`frame-border-${frameId}`}
            data-frame-border-id={frameId}
            style={{
              position: 'absolute', left: clip.left, top: clip.top,
              width: clip.width, height: clip.height,
              overflow: 'visible', pointerEvents: 'none',
              transformOrigin: '0 0',
              transform: clip.transform || undefined,
            }}
          >
            <BorderOverlay border={mask.effects.border} wPx={clip.width} hPx={clip.height} />
          </div>,
        );
      }
    }
    return out;
  };

  // Cells for the tap-target grid (see tapTargetGrid.ts). Depends only on the
  // viewport, so this rebuilds on rotate/resize and never during a gesture or
  // a camera change — no per-frame cost, and the cells are empty divs.
  const tapGrid = tapTargetGrid(state.viewport.width, state.viewport.height);
  const tapCells = useMemo(
    () => Array.from({ length: tapGrid.count }, (_, i) => <div key={i} />),
    [tapGrid.count],
  );

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        touchAction: 'none', cursor: 'default', background: BG_EDITOR_CANVAS,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endGesture(e, false)}
      onPointerCancel={(e) => endGesture(e, true)}
    >
      <GLView
        style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
        onContextCreate={onContextCreate}
      />
      <div
        ref={worldRef}
        style={{
          position: 'absolute', left: 0, top: 0, width: 0, height: 0,
          transformOrigin: '0 0',
          transform: `translate(${t.translateX}px, ${t.translateY}px) scale(${t.scale})`,
        }}
      >
        {/* Canvas background paint, beneath all content. Rendered ONLY when the
            composition declares one (setBackground / config.canvas.background)
            — there is no implicit white page. Every surface on screen is then a
            real scene object, and so has a Scene Outline row; an opaque page
            rect drawn here would be visible chrome the outline can't reach. */}
        {state.background ? (
          <div
            style={{
              position: 'absolute', left: 0, top: 0,
              width: WORLD_CELLS * BASE_CELL_PX,
              height: pageCellsH * BASE_CELL_PX,
              background: paintToCssBackground(state.background),
              boxShadow: `0 0 0 1px ${CANVAS_HAIRLINE}, 0 2px 16px rgba(58, 53, 50, 0.10)`,
            }}
          />
        ) : null}
        {renderScene()}
        {/* Ghost previews (the Transform bar's copies-to-be): the same node
            layer the real object draws with, in one half-opacity wrapper that
            takes no pointer events. Over the scene — a ghost is a proposal
            laid on the page, not part of it — and under the selection chrome. */}
        {ghosts && ghosts.length > 0 ? (
          <div data-ghost-layer style={{ position: 'absolute', left: 0, top: 0, opacity: GHOST_OPACITY, pointerEvents: 'none' }}>
            {ghosts.map((g) => renderGhostNode(
              g, state.strokeScale, (imageId) => imageUrls.get(imageId),
            ))}
          </div>
        ) : null}
        {outlineBox && !patternEditReplacesSelectionBox ? (
          <div
            ref={selectionOutlineRef}
            style={{
              // The element IS the bbox and the ring paints outside it — see
              // selectionOutline.ts for why this can't be a `border`.
              // …in `transparent` when the object's own border is drawn
              // inside instead (shapeOutlinePath): the element stays, with
              // every gesture that re-anchors it, and only its ring goes.
              ...selectionOutlineStyle(
                ringBox!,
                shapeOutlinePath ? 'transparent' : selectionRingColor,
              ),
              // 1 / the world scale, for the zoom-invariant chrome in this
              // subtree (screenPx, SCREEN_INV_TRANSFORM). First paint's
              // value; applyLiveCamera keeps it in step thereafter.
              [ZOOM_INV_VAR]: String(zoomInvRef.current || (t.scale > 0 ? 1 / t.scale : 1)),
              pointerEvents: 'none',
              // The `turnLive.ts` fade: while a host's own turn is in flight the
              // outline's opacity is dropped to 0 by hand (and put back on
              // settle); this transition is what makes both edges a fade.
              transition: `opacity ${SELECTION_OUTLINE_FADE_MS}ms ease`,
              // Frame the object at its committed free rotation (about the
              // bbox center, which is this element's own center). The live
              // gesture overwrites this inline transform during a twist/drag.
              transformOrigin: 'center',
              transform: selectedAngleDeg
                ? `rotate(${selectedAngleDeg}deg)` : undefined,
            } as CSSProperties}
          >
            {/* Edit-mode frame: while the selected text is open for typing —
                or the selected image open for reframing — a second blue ring
                sits a small margin outside the first (see textEditRingStyle).
                A child of the outline element, so every re-anchor/rotation
                moves both rings together. */}
            {(editingText || editingImage) && !multiSelectionBox ? (
              <div style={textEditRingStyle()} />
            ) : null}
            {/* Move / Rotate: the object's own border, stretched over the box
                it replaces. `preserveAspectRatio="none"` is what makes the
                mapping the box's own — the element is the image of `local`,
                so the two land on the same pixels however the node is scaled
                — and `non-scaling-stroke` keeps the line a constant width on
                screen at any zoom, the same promise `screenPx` makes for the
                rectangle. */}
            {shapeOutlinePath ? (
              <svg
                aria-hidden
                data-selection-shape-outline=""
                width="100%"
                height="100%"
                viewBox={shapeOutlineViewBox(shapeOutlinePath.units)}
                preserveAspectRatio="none"
                style={{ position: 'absolute', inset: 0, overflow: 'visible', display: 'block' }}
              >
                <path
                  d={shapeOutlinePath.d}
                  transform={shapeOutlinePath.transform}
                  fill="none"
                  stroke={selectionRingColor}
                  strokeWidth={SELECTION_BORDER_PX}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            ) : null}
            {/* Corner resize handles — only where a corner drag would actually
                land (resolveSelectionBox rejects figures, locked nodes and word
                stickers, and locked frames; canResizeMultiSelection gates a
                group's combined box the same way), so the affordance is never
                shown where the grab would be refused. The same gates route the
                press (hitSelectionCorner / beginMultiCornerResize), so the two
                cannot drift. */}
            {(multiSelectionBox ? multiResizable : selectionBox!.resizable)
              && !arrangeModeNoScale(session.activeTool, arrangeMode)
              ? SELECTION_CORNERS.map(([h, v]) => (
                <div
                  key={`${h}-${v}`}
                  style={{
                    position: 'absolute',
                    [h]: -HANDLE_SIZE_PX / 2,
                    // Pushed in off the ring by the ink hanging outside the
                    // box, so the handle stays ON the box a corner drag
                    // acts on (hitSelectionCorner measures that box too).
                    // Zero for everything but a bent text.
                    [v]: (v === 'top' ? ringOutset.top : ringOutset.bottom) * BASE_CELL_PX
                      - HANDLE_SIZE_PX / 2,
                    width: HANDLE_SIZE_PX,
                    height: HANDLE_SIZE_PX,
                    boxSizing: 'border-box',
                    backgroundColor: HANDLE_FILL,
                    border: `1px solid ${HANDLE_BORDER}`,
                    // Pin the handle to a constant SCREEN size by undoing every
                    // scale above it — the camera zoom on the world layer, and a
                    // live pinch's factor on the outline. Done as a transform
                    // rather than in the width/height so it stays off the layout
                    // path (zoom is a compositor-only change; resizing four divs
                    // per pinch frame would not be): the element lays out at
                    // HANDLE_SIZE_PX centred on the corner by the offsets above,
                    // and scaling about that centre leaves it centred at any zoom.
                    transformOrigin: 'center',
                    transform: SCREEN_INV_TRANSFORM,
                  }}
                />
              ))
              : null}
          </div>
        ) : null}
        {/* The pattern OPEN FOR EDITING wears the DOUBLE ring — the
            selection ring plus the edit ring a text object shows while open
            for typing (textEditRingStyle) — in the pattern's own orange,
            and no corner handles of its own: this marks an editing state,
            not a selection. Its own element beside the selection outline
            (the two can name the same object — edit mode is entered from a
            selection and the selection survives it), sharing the
            zoom-inverse property write. */}
        {tileEditShape ? (
          <div
            // The zoom inverse the rings' widths read, seeded at render and
            // rewritten on every camera frame (see applyLiveCamera) — the
            // same property the box rings carry, on the same rule.
            ref={patternEditOutlineRef}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: 0,
              height: 0,
              pointerEvents: 'none',
              [ZOOM_INV_VAR]: String(zoomInvRef.current || (t.scale > 0 ? 1 / t.scale : 1)),
            } as CSSProperties}
          >
            <ShapePatternEditOutline
              drawn={drawnPosed(tileEditShape.id) ?? drawnLeafFor('svg', tileEditShape, graphOf(state))}
            />
          </div>
        ) : null}
        {tileEditBox ? (
          <div
            ref={tileEditOutlineRef}
            data-tile-edit-outline=""
            style={{
              // The ink the select tool would give this object: the
              // selection blue, orange only for a repeating grid (the same
              // rule as the selection outline above).
              ...selectionOutlineStyle(tileEditOutlineBbox!, tileEditRingColor),
              [ZOOM_INV_VAR]: String(zoomInvRef.current || (t.scale > 0 ? 1 / t.scale : 1)),
              pointerEvents: 'none',
              transformOrigin: 'center',
              transform: tileEditBox.angleDeg ? `rotate(${tileEditBox.angleDeg}deg)` : undefined,
            } as CSSProperties}
          >
            <div style={textEditRingStyle(tileEditRingColor)} />
          </div>
        ) : null}
      </div>
      {/* Canvas-symmetry axis lines, over the scene and under the selection
          veil and drafts. SCREEN-SPACE (symmetryAxesScreen.ts): the lines
          are written into this <g> imperatively — at each render through
          the effect that resyncs the camera, and on every pan/zoom frame by
          applyLiveCamera — so the world layer's bounds stay the page's, not
          the axes' canvas-wide overhang. */}
      <svg
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        aria-hidden
      >
        <g ref={symmetryAxesRef} data-symmetry-axes="" />
        {/* The editable region's veil, midline and connection points
            (docs/social_game_spec.md §7.3) — the same screen-space idiom.
            The pop a NEW connection point arrives with — and the same pop
            a point a refusal NAMES is given — is one compositor keyframe
            on the circle; the writer sets the animation, this is where the
            animation is declared. */}
        <style>{MARKER_POP_KEYFRAMES}</style>
        <g ref={regionGroupRef} data-region-chrome="" />
        {/* The page's forward arrow (EditorConfig.forwardArrow): the same
            screen-space idiom, a <g> of its own. */}
        <g ref={arrowGroupRef} data-forward-arrow-group="" />
      </svg>
      {/* The paint filter made VISIBLE: with a color-group brush armed and a
          selection in force, the brush may only touch the selected object(s)
          (paintFilterIds) — so everything else drops behind a dark veil, and
          the lit hole IS the paintable region. SCREEN-SPACE, over the whole
          world layer (the GL figure pass included): one viewport-sized
          evenodd path whose hole is the selection's box through the camera —
          constant wash at any zoom, where the old in-world giant box-shadow
          drifted and vanished at zoom extremes (see selectionOutline.ts). A
          multi-selection lights its combined box, matching its outline. The
          render anchors the hole for its frame; applyLiveCamera re-anchors
          it imperatively while pan/zoom mutate the camera between renders. */}
      {paintVeilOn ? (
        <svg
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          aria-hidden
        >
          {shapeOutlinePath ? (
            /* Move / Rotate: the lit hole is the object's OWN BORDER, the
               same border the ring above traces, instead of the rectangle
               around it — on a triangle, a curve or a letterform the box
               lights a wide margin of canvas that the brush cannot touch.
               A shape cannot be a subpath of the screen-space `d` (its own
               path is written in its own units, and transforming a `d` by
               hand means re-emitting every curve), so the wash is a plain
               full-view rect and the shape is painted BLACK into a
               luminance mask: white shows the wash, black is the hole.
               The <g>'s transform is the whole mapping — one attribute for
               applyLiveCamera to rewrite per frame. */
            <>
              <mask
                id={paintVeilMaskId}
                maskUnits="userSpaceOnUse"
                x={0}
                y={0}
                width={state.viewport.width}
                height={state.viewport.height}
              >
                <rect
                  x={0}
                  y={0}
                  width={state.viewport.width}
                  height={state.viewport.height}
                  fill="#fff"
                />
                <g
                  ref={paintVeilShapeRef}
                  transform={paintDimVeilShapeTransform(
                    outlineBox!, t, selectedAngleDeg, shapeOutlinePath.units,
                  )}
                >
                  <path
                    d={shapeOutlinePath.d}
                    transform={shapeOutlinePath.transform}
                    fill="#000"
                    stroke="#000"
                    strokeWidth={PAINT_VEIL_SHAPE_STROKE_PX}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              </mask>
              <rect
                data-paint-veil-shape=""
                x={0}
                y={0}
                width={state.viewport.width}
                height={state.viewport.height}
                fill={PAINT_DIM_VEIL}
                mask={`url(#${paintVeilMaskId})`}
              />
            </>
          ) : (
            <path
              ref={paintVeilPathRef}
              d={paintDimVeilPath(state.viewport, outlineBox!, t, selectedAngleDeg)}
              fill={PAINT_DIM_VEIL}
              fillRule="evenodd"
            />
          )}
        </svg>
      ) : null}
      {/* Freehand draw + line/arc draft previews (screen space; direct
          attribute mutation — never React state, per the 90 fps rule). BOTH
          drafts carry their stroke width imperatively so they match the
          weight the committed SVGObject renders at. */}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
        <path ref={drawPathRef} d="" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path ref={shapePathRef} d="" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {/* The drafts' live mirror copies (canvas Symmetry) — every orbit
            image of whatever the two paths above are showing. */}
        <path ref={draftMirrorPathRef} d="" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {/* Photos / text drag-to-place marquee: the rect the new node will
            occupy (see the 'placeBox' gesture), drawn like the selection
            outline so the box you drag reads as the box you'll get. */}
        <rect
          ref={placeBoxRectRef}
          width={0} height={0} fill="none"
          stroke={SELECTION_COLOR} strokeWidth={SELECTION_BORDER_PX}
        />
        {/* Marquee selection rect (arrange tool drag on empty canvas): dashed
            so it reads as "selecting", not as an object's own outline. */}
        <rect
          ref={marqueeRectRef}
          width={0} height={0}
          fill="rgba(56, 189, 248, 0.08)"
          stroke={SELECTION_COLOR} strokeWidth={1} strokeDasharray="6 4"
        />
        {/* Color-tool paint stroke: painted-segment/-fill preview paths plus
            the gradient brush cursor, all created and mutated imperatively
            while a stroke is live (see the paint helpers). */}
        <g ref={paintLayerRef} />
      </svg>
      {/* Dimensions HUD (View Settings toggle): the live size of whatever box
          is being resized / scaled / drawn, in visible grid squares. Position
          and text are written imperatively by updateDimsHud; React only ever
          mounts the empty, hidden shell. */}
      <div
        ref={dimsHudRef}
        aria-hidden
        style={{
          position: 'absolute', left: 0, top: 0, display: 'none',
          padding: '4px 12px', borderRadius: 6,
          background: DIM_HUD_BG, color: SELECTION_COLOR,
          fontSize: DIM_HUD_FONT_PX, fontFamily: 'monospace', fontWeight: 600,
          whiteSpace: 'nowrap', pointerEvents: 'none',
        }}
      />
      {/* Tap-target grid — TOPMOST on purpose, so it is what iOS hit-tests
          under a touch. See tapTargetGrid.ts for the why: the upload sheet's
          context-menu presentation paints a white disc sized to the touched
          element, and without this the touched element is the zoom-scaled page
          background, making the disc scale with the camera. The cells are
          inert — no handlers, no paint — and pointer events bubble to the
          container, which is where every gesture handler already lives. The
          canvas never used DOM hit-testing (picking is hitTestAt in JS), so
          covering the subtree costs nothing. */}
      <div
        aria-hidden
        style={{
          position: 'absolute', left: 0, top: 0,
          width: tapGrid.cols * tapGrid.tile,
          height: tapGrid.rows * tapGrid.tile,
          display: 'grid',
          gridTemplateColumns: `repeat(${tapGrid.cols}, ${tapGrid.tile}px)`,
          gridAutoRows: `${tapGrid.tile}px`,
          touchAction: 'none',
        }}
      >
        {tapCells}
      </div>
      {/* A host layer's slot (canvasHooks.ts CanvasSurfaceHandle): screen
          space, over the world layer, pointer-inert — a layer draws here
          every frame and the gestures reach it through the hooks. */}
      <div
        ref={layerSlotRef}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        aria-hidden
      />
    </div>
  );
}
