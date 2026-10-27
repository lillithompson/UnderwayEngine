import type {
  CompositionState, ImageObject, NodeEffects, PaintObject, PatternObject, RGBColor, SVGObject,
  TextObject,
} from '@/engine/types';
import { type CompItemRef, findItem, isItemLocked } from '@/engine/compositionOps';
import { svgEnclosesArea } from '@/engine/svgPathBuilder';
import { svgStrokeWidthCells, svgSubtype } from '@/engine/svgStroke';
import { patternInkColor } from '@/engine/patternObject';
import { patternSVGView } from '@/engine/patternObjectRender';
import { COVER_FRAMING } from '@/engine/imageFraming';
import {
  shapePatternGrid, shapePatternSpanOfWidth, shapePatternStrokeWidthCells,
} from '@/engine/shapePatternFill';
import type {
  BorderModel, CommonAction, EndpointsModel, FramingModel, GlowKind, GlowModel, HostPagesModel,
  ObjectPropertiesModel, OpacityModel, ShadowModel, SVGSubtypeKind, TextFontOption,
  TextStyleModel, TintModel,
} from '@/editor-ui/adapter';
import { type SVGEditAction, svgHasFill, svgStrokeRemovable } from '@/editor-ui/logic/svgEdit';
import {
  type PatternEditAction, type PatternGridAction, type PatternPanelTool, type PatternTileRow,
  type PatternTileTransform, patternEnabledTileSets, patternSymmetryKey, patternTileSetRows,
} from '@/editor-ui/logic/patternEdit';
import { BASE_CELL_PX } from './cameraMath';
import {
  type EditorSession, type TransformCopies, frameBoundaryRect, isFrameGroupId, isFrameLocked,
  isHostItemLocked, isMultiSelectionLocked, shapeFillOf,
} from './editorSession';
import { imageFramingTarget } from './canvasTap';
import { PATTERN_TILE_FAMILIES } from './patternTileFamilies';
import { textStyleToModel } from './textStyleModel';
import {
  DEFAULT_GLOW_EFFECT, DEFAULT_SHADOW_EFFECT, type EffectKey, borderEffectToModel,
  endpointsModelOf, framingEffectToModel, glowEffectToModel, shadowEffectToModel,
  tintFillToModel,
} from './panelEffectModels';
import { defaultBorderEffect } from './activeColor';

// The object-properties panel's MODEL — what the three shells each built by
// hand out of the same selection (docs/shared-editor.md §4.2, stage 4).
//
// Two halves, both pure:
//
//  · `buildPanelFacts` reads the selection: what is in hand, what kind of
//    thing it is, which pages that kind may open, and the values those
//    pages seed their rows from. The shell memoizes it on the session (the
//    pieces that walk the scene — a multi-selection's lock, its subtype,
//    the pattern fill's resolved line — used to be memoized one at a time
//    and the rest recomputed per render; one memo over the lot is the same
//    key and strictly less work).
//  · `buildPanelModel` lays the pages out: the facts, the open flags the
//    shell owns, and the shell's handlers, in the panel's own grammar
//    (`ObjectPropertiesModel`, @/editor-ui). The HOST's pages are its one
//    seam — `hostPages` / `hiddenCommonActions`, spread in one place
//    (§4.1, "Property pages for the app's kinds"): DrawBot's bots, tiles,
//    arena and fields pages reach the panel through it, and so do
//    CozyJournal's Figgie rig pages (stage 7a, `web/editor/rigPages.ts`).
//
// The HANDLERS stay in each app's shell: every one of them is a
// `useCallback` over the shell's commit pipeline, its tool state and its
// prefs, and they move here with the shell at stage 6. Threading a context
// of fifty members through them now would be the churn without the seam —
// the argument §4.3 already makes for installing the session host rather
// than threading it.

/** The leaf ids an object-properties edit applies to: every member of the
 *  multi-selection when one is active, else the single selected leaf. Frame
 *  selections are NOT leaves and resolve to [] here — the frame-specific
 *  handlers branch on isFrameGroupId before reaching this. */
export function editTargetIds(s: EditorSession): string[] {
  if (s.selectedIds.length >= 2) return s.selectedIds;
  return s.selectedId && !isFrameGroupId(s.state, s.selectedId) ? [s.selectedId] : [];
}

/** The nodes the Shadow / Border bars edit: a frame routes its effects to its
 *  boundary rect (the mask svg that carries the frame's fill + effects); a
 *  multi-selection edits every member; a leaf edits itself. Empty when
 *  nothing effect-capable is selected. */
export function effectTargetIds(s: EditorSession): string[] {
  if (s.selectedIds.length >= 2) return s.selectedIds;
  const id = s.selectedId;
  if (!id) return [];
  if (!isFrameGroupId(s.state, id)) return [id];
  const rectId = frameBoundaryRect(s.state, id)?.id;
  return rectId ? [rectId] : [];
}

/** Fold a non-undoable per-node state transform over every target — the
 *  live-preview counterpart of buildForEachNode's committed entry. */
export function foldTargets(
  state: CompositionState,
  ids: readonly string[],
  fn: (state: CompositionState, id: string) => CompositionState,
): CompositionState {
  return ids.reduce((st, id) => fn(st, id), state);
}

/**
 * Whether an object has an INTERIOR to paint — what the Fill and Pattern
 * pages are offered on.
 *
 * Geometry, not provenance: `svgHasFill` says what the tool that drew a
 * subtype offers, and a MERGE has no subtype that knows — flatten a few
 * lines and the result is subtype `stroke`, loose ends and all, while the
 * loop among those lines is a perfectly good interior (the engine's
 * `svgEnclosesArea` finds it). The subtype still answers first so a
 * tool-drawn shape is unchanged even if its geometry were ever mangled.
 */
export function svgEnclosesRef(ref: CompItemRef | null | undefined): boolean {
  return ref?.kind === 'svg'
    && (svgHasFill(svgSubtype(ref.item)) || svgEnclosesArea(ref.item));
}

/** Is this selection member repeating? The two kinds that can — a tile
 *  pattern and a legacy studio-baked pattern svg — both say so with
 *  `tileMode`; anything else in a mixed selection simply is not. */
export function isRepeatTarget(ref: CompItemRef): boolean {
  return (ref.kind === 'svg' || ref.kind === 'pattern') && ref.item.tileMode === 'repeat';
}

/** What the panel's facts are read out of, beyond the session. */
export interface PanelFactsInput {
  session: EditorSession | null;
  /** The colour in hand — the Pattern page's stroke row falls back to it
   *  for a grid whose cells disagree. */
  currentColor: RGBColor;
  /** The Fade row's target: what its slider walks the object's colours
   *  TOWARD. The editor's own, not the document's. */
  fadeTarget: RGBColor;
  /** A brush is armed, so a one-finger drag is a stroke and not an
   *  image's reframing pan. */
  brushArmed: boolean;
  /** The Crop page is open (one of the two ways into reframing). */
  cropOpen: boolean;
  /** The image double-tapped into reframing mode, if any. */
  editingImageId: string | null;
  /** The pattern grid open for painting on the canvas, if any. */
  editablePatternId: string | null;
}

/** What the selection is, and what its pages may show. */
export interface PanelFacts {
  /** A live multi-selection (2+ leaves acting as one unit), else null. */
  multiIds: readonly string[] | null;
  multiLocked: boolean;
  selected: CompItemRef | null;
  selectedFrameId: string | null;
  frameRect: SVGObject | null;
  frameLocked: boolean;
  frameEditable: boolean;
  frameEffects: NodeEffects | undefined;
  targetRefs: readonly CompItemRef[];
  imageEditable: boolean;
  imageTintPresent: boolean;
  /** The image open for REFRAMING by double tap, resolved against live
   *  state — null the moment the object is gone. */
  editingImage: string | null;
  /** The node a one-finger drag REFRAMES rather than moves. */
  imageFramingNodeId: string | null;
  textStyleEditable: boolean;
  stickerEditable: boolean;
  stickerInverted: boolean;
  svgEditable: boolean;
  transformCopyable: boolean;
  paintEditable: boolean;
  patternEditable: boolean;
  patternRepeatable: boolean;
  strokeEditable: boolean;
  mixedStrokeEditable: boolean;
  multiOpacityEditable: boolean;
  selectedSvg: SVGObject | null;
  selectedPattern: PatternObject | null;
  objectOpacity: OpacityModel | undefined;
  sharedSvgSubtype: SVGSubtypeKind | undefined;
  effectsHost: { effects: NodeEffects | undefined } | null;
  /** Whether every effect target already CARRIES the given effect — what
   *  flips each effect bar between its Add state and its controls. */
  effectPresent(key: EffectKey): boolean;
  svgFillPresent: boolean;
  svgPatternShape: SVGObject | null;
  svgPatternPresent: boolean;
  svgPatternSpan: number | undefined;
  svgPatternInk: RGBColor | null;
  svgPatternStroke: BorderModel | undefined;
  svgPatternEditing: boolean;
  svgStrokePresent: boolean | undefined;
  svgStrokeRemovableAll: boolean | undefined;
}

/**
 * Read the selection: everything the panel's pages are a function of.
 *
 * Pure, and memoized by the shell on `[session, …the flags above]` — the
 * key the pieces that walk the scene already had.
 */
export function buildPanelFacts(input: PanelFactsInput): PanelFacts {
  const {
    session, currentColor, fadeTarget, brushArmed, cropOpen, editingImageId, editablePatternId,
  } = input;
  const multiIds = session && session.selectedIds.length >= 2 ? session.selectedIds : null;
  const sessionState = session?.state;
  // Is the WHOLE multi-selection locked? The panel's Lock button lights only
  // then, because one press drives every member to the same value (see
  // buildToggleLockMulti) — a partly-locked selection reads unlocked, and that
  // press locks the stragglers.
  const multiLocked = !!multiIds && !!sessionState
    && isMultiSelectionLocked(sessionState, multiIds, session!.hostDoc);
  // Live ref of the selection (null once the node is deleted/undone) —
  // drives the object-properties panel's slide in/out. In multi mode this is
  // the FIRST member: the panel's type options seed their values from it and
  // apply edits to every member.
  const selected = session?.selectedId
    ? findItem(session.state, session.selectedId)
    : multiIds ? findItem(session!.state, multiIds[0]) : null;
  // A selected frame (group). findItem resolves leaves only, so the frame
  // selection is tracked separately; its boundary rect carries the frame's
  // background fill + shadow / border effects.
  const selectedFrameId = session?.selectedId && isFrameGroupId(session.state, session.selectedId)
    ? session.selectedId : null;
  const frameRect = selectedFrameId ? frameBoundaryRect(session!.state, selectedFrameId) : null;
  // Every leaf a properties-panel edit would touch (multi members, or the
  // single selected leaf), resolved. A type row shows only when the WHOLE
  // selection is that type and unlocked, so "apply to all" can't skip anyone.
  const targetRefs: CompItemRef[] = session
    ? editTargetIds(session)
        .map((id) => findItem(session.state, id))
        .filter((r): r is NonNullable<typeof r> => !!r)
    : [];
  const targetsEditable = (pred: (r: CompItemRef) => boolean) =>
    targetRefs.length > 0
    && targetRefs.every((r) => pred(r) && !isItemLocked(session!.state, r.item.id));
  // Unlocked image(s): the image-edit sub-panel (and its Round slider).
  const imageEditable = targetsEditable((r) => r.kind === 'image');
  /** …and whether every one of them already wears a TINT — the Effects
   *  page's fourth button, lit. Read the way effectPresent reads the
   *  three: all of them or none, so a press over a mixed selection adds
   *  rather than half-removing. */
  const imageTintPresent = targetRefs.length > 0
    && targetRefs.every((r) => r.kind === 'image' && !!(r.item as ImageObject).tintFill);
  /** The image open for REFRAMING by double tap (editingImageId), resolved
   *  against live state — null the moment the object is gone (an undo, a
   *  delete), so the double border can never outlive what it framed. The
   *  same guard tileEditPatternId makes for an open grid. */
  const editingImage = session && editingImageId
    && findItem(session.state, editingImageId)?.kind === 'image'
    && !isItemLocked(session.state, editingImageId)
    ? editingImageId : null;
  /** The node a one-finger drag REFRAMES rather than moves — the bitmap
   *  panned inside its frame, clamped so it can never be pulled off
   *  (buildPanImageFraming). Two ways in, one gesture: the Crop page open
   *  over a single unlocked image, or that image double-tapped into
   *  reframing mode. An image framed to FIT has no slack to pan and the
   *  clamp makes the drag a no-op, which is the whole of "drag it about if
   *  it doesn't fit". Null while a BRUSH is armed — its drag is a stroke,
   *  not a pan (imageFramingTarget). */
  const imageFramingNodeId = imageFramingTarget({
    brushArmed,
    cropPageImageId: cropOpen && !multiIds && imageEditable && selected?.kind === 'image'
      ? selected.item.id
      : null,
    editingImageId: editingImage,
  });
  // Unlocked, non-sticker text(s): the Text typography bar.
  const textStyleEditable = targetsEditable((r) => r.kind === 'text' && !(r.item as TextObject).sticker);
  // Unlocked word sticker(s): the sole type-specific option is Invert (the
  // typography bar is suppressed — a sticker's content + style are fixed).
  const stickerEditable = targetsEditable((r) => r.kind === 'text' && !!(r.item as TextObject).sticker);
  // Lit only when EVERY member is inverted — the state the Invert press
  // converges from (all lit → all off; anything unlit → all on).
  const stickerInverted = stickerEditable
    && targetRefs.every((r) => r.kind === 'text' && !!(r.item as TextObject).invert);
  // Unlocked vector object(s) get the subtype's option menu (today: Stroke).
  const svgEditable = targetsEditable((r) => r.kind === 'svg');
  // Can the Copies page act on THIS selection? Every target unlocked and of
  // a kind that repeats — which is every kind but a FIGURE (a rig's included,
  // whose quads have their own pages), which would not survive the per-copy
  // rescale. Read over the whole selection, so a group carrying one locked
  // member is not offered a run that would quietly leave it out.
  const transformCopyable = targetsEditable((r) => r.kind !== 'figure');
  // Paint islands: the raster brush's editable-image objects. Their one
  // type option is Opacity (no Stroke/Fill — see editor-ui paintEdit.ts).
  const paintEditable = targetsEditable((r) => r.kind === 'paint');
  // Unlocked pattern object(s): the Tiles / Tools / Symmetry pages and the
  // Stroke bar. A multi-selection of patterns keeps them — every handler
  // applies to all the members, seeding its row from the first — so their
  // strokes, symmetry, borders and grids can be set at once.
  const patternEditable = targetsEditable((r) => r.kind === 'pattern');
  const selectedPattern = selected?.kind === 'pattern' ? selected.item : null;
  // Repeat needs every target loose: the toggle builder rejects a member of
  // a group, and an offer that half-fires reads as broken.
  const patternRepeatable = patternEditable && targetRefs.every((r) => !r.item.groupId);
  // Everything with a stroke — vectors and patterns alike — unlocked. A
  // selection mixing the two kinds offers neither family's own pages (half
  // the members would have no answer) but keeps the Stroke bar they all
  // share: one width and dash lands on every member, as within a family.
  const strokeEditable = targetsEditable((r) => r.kind === 'svg' || r.kind === 'pattern');
  const mixedStrokeEditable = strokeEditable && !svgEditable && !patternEditable;
  // Opacity is every kind's, so a multi-selection of ANY mix offers its page
  // (the panel's own rule) — so long as one member can take it: a figure
  // has none to set and a locked member is left alone (buildSetObjectOpacity
  // skips both), which is also what the page then writes to.
  const multiOpacityEditable = !!multiIds && targetRefs.some(
    (r) => r.kind !== 'figure' && !isItemLocked(session!.state, r.item.id));
  const selectedSvg = selected?.kind === 'svg' ? selected.item : null;
  // The Opacity page's model: the selection's own opacity, and the fade pair
  // it draws with. A text keeps both on its style (its alpha is the whole
  // magnet's on a word sticker, its ink's on plain text); a paint island has
  // no colour parameter to fade and carries the opacity alone.
  const objectOpacity: OpacityModel | undefined = (() => {
    /** The Fade row's three answers: how far, toward what, and from what
     *  ink.
     *
     *  How far is ALWAYS 0. A fade is an adjustment spent into the colours
     *  the object draws in, not a number it carries (engine/fadeBake.ts) —
     *  so every visit to this page starts from the colours as they now
     *  stand, which is what the row means and what makes the Stroke page's
     *  swatch, not this slider, the authority on the object's colour.
     *
     *  From-what is the object's lead colour: the ramp's near end, so the
     *  track runs from what the object IS to the target the circle wears.
     *  A kind with no one ink passes none and the ramp starts from the
     *  panel's own track instead. */
    const fadeOf = (
      _spec: { fade?: number; fadeColor?: RGBColor },
      ink?: RGBColor | null,
    ): Pick<OpacityModel, 'fade' | 'fadeColor' | 'fadeInk'> => ({
      fade: 0,
      fadeColor: fadeTarget,
      ...(ink ? { fadeInk: ink } : null),
    });
    if (selected?.kind === 'paint') {
      return { opacity: (selected.item as PaintObject).opacity ?? 1, fade: 0, fadeColor: fadeTarget };
    }
    // A photograph has no one ink to ramp from — its Fade row still walks
    // its tint and its border, but nothing here stands for "the object's
    // colour", so the track starts neutral.
    if (selected?.kind === 'image') {
      return { opacity: selected.item.opacity ?? 1, ...fadeOf(selected.item) };
    }
    if (selectedSvg) {
      return { opacity: selectedSvg.opacity ?? 1, ...fadeOf(selectedSvg, selectedSvg.color) };
    }
    // A pattern draws colour on every one of its cells, so both rows have
    // something to act on — the pair rides its baked view exactly as an
    // svg's rides the object (engine/patternObjectRender.ts). Its lead ink
    // is the one the Stroke bar's swatch shows: what the cells actually
    // draw in, the baked view's own colour only where they disagree.
    if (selected?.kind === 'pattern') {
      const p = selected.item;
      return {
        opacity: p.opacity ?? 1,
        ...fadeOf(p, patternInkColor(p) ?? patternSVGView(p)?.color),
      };
    }
    if (selected?.kind === 'text') {
      return {
        opacity: selected.item.style.alpha ?? 1,
        ...fadeOf(selected.item.style, selected.item.style.color),
      };
    }
    return undefined;
  })();
  // The subtype menu a multi svg selection shares: the common subtype when
  // uniform, else the base stroke menu every vector offers.
  const sharedSvgSubtype = svgEditable
    ? (() => {
        const subs = targetRefs.map((r) => svgSubtype(r.item as SVGObject));
        return subs.every((x) => x === subs[0]) ? subs[0] : 'stroke';
      })()
    : undefined;
  // A frame is effect-capable (shadow / border via its boundary rect) when it
  // isn't wholly locked. Its shadow/border read from the boundary rect.
  const frameLocked = !!selectedFrameId && isFrameLocked(session!.state, selectedFrameId);
  const frameEditable = !!selectedFrameId && !frameLocked;
  const frameEffects = frameRect?.effects;
  // The effects record the Effects page reads: the selected leaf's own, or
  // the frame's (which lives on its boundary rect). Null when nothing that
  // can wear them is selected — the page's models go undefined then, which
  // is how the panel knows it has nothing to seed from. Held as a box
  // rather than as the record itself so "no host" and "a host with no
  // effects yet" stay apart.
  const effectsHost: { effects: NodeEffects | undefined } | null =
    (selected?.kind === 'image' || selected?.kind === 'text' || selected?.kind === 'svg')
      ? { effects: selected.item.effects }
      : frameEditable ? { effects: frameEffects } : null;

  // Whether every effect target already CARRIES the given effect — what
  // flips each effect bar between its Add state (EmptyEffectBar) and its
  // controls. Opening a bar no longer materializes anything; only the Add
  // button does (onAddShadow / onAddBorder / onAddSvgFill).
  // Recomputed per commit; a handful of findItem lookups.
  const effectPresent = (key: EffectKey): boolean => {
    if (!session) return false;
    const ids = effectTargetIds(session);
    return ids.length > 0 && ids.every((id) => {
      const ref = findItem(session.state, id);
      return !!(ref && ref.kind !== 'figure' && ref.kind !== 'paint'
        && ref.kind !== 'pattern' && ref.item.effects?.[key]);
    });
  };
  const svgFillPresent = (() => {
    if (!session) return false;
    const shapes = editTargetIds(session)
      .map((id) => findItem(session.state, id))
      .filter(svgEnclosesRef);
    return shapes.length > 0
      && shapes.every((ref) => ref?.kind === 'svg' && !!(ref.item.fill || ref.item.fillColor));
  })();
  // The shape the Pattern page's rows READ from: the first member of the
  // selection that can carry a fill. The panel's standing rule for a
  // multi-selection — seed from the first, write to all — which is how the
  // Stroke, Fill and effect pages have always shown N objects.
  const svgPatternShape = (() => {
    if (!session) return null;
    for (const id of editTargetIds(session)) {
      const ref = findItem(session.state, id);
      if (svgEnclosesRef(ref) && ref?.kind === 'svg') return ref.item;
    }
    return null;
  })();
  // …and pattern-fill PRESENCE, on the same Add-bar rule as the Fill
  // page's: the page opens on "Add Pattern" unless EVERY member already
  // carries cloth, so a mixed selection adds rather than half-editing.
  const svgPatternPresent = (() => {
    if (!session) return false;
    const shapes = editTargetIds(session)
      .map((id) => findItem(session.state, id))
      .filter(svgEnclosesRef);
    return shapes.length > 0
      && shapes.every((ref) => ref?.kind === 'svg' && !!ref.item.patternFill);
  })();
  // …and how big one of its repeats draws, in TENTHS of the SHAPE's own
  // width — the Size slider's number, the stored `tileL0` read against
  // the outline the pattern fills. Derived, never stored twice: resize
  // the shape and the row reads the new fraction, the pattern having not
  // moved.
  const svgPatternSpan = session && svgPatternShape?.patternFill
    ? shapePatternSpanOfWidth(svgPatternShape.patternFill, svgPatternShape.cellWidth)
    : undefined;
  // …and the LINE those tiles are drawn in, for the page's Stroke section.
  // Width is the RESOLVED one (the fill's where its slider set one, half
  // the shape's where it did not), so an untouched pattern opens the row
  // at the width it is actually being drawn with rather than at zero. The
  // ink is what every cell wears, null when they disagree — a swatch can
  // only honestly show one colour when there is one.
  const svgPatternInk = session && svgPatternShape?.patternFill
    ? patternInkColor(shapePatternGrid(svgPatternShape, {
      strokeScale: session.state.strokeScale,
    })!)
    : null;
  const svgPatternStroke: BorderModel | undefined = session && svgPatternShape?.patternFill
    ? {
      width: shapePatternStrokeWidthCells(svgPatternShape, session.state.strokeScale),
      dash: svgPatternShape.patternFill.stroke?.dash ?? 0,
      // Inert here — a mark inside a clip has no side to align to — but
      // the model's shape is the Border page's, so it carries the field.
      position: 'center',
      color: svgPatternInk ?? currentColor,
    }
    : undefined;
  // …and whether THAT shape's grid is the one open for painting, which is
  // what stands the page's Edit button down.
  const svgPatternEditing = !!svgPatternShape && editablePatternId === svgPatternShape.id;
  // Stroke presence, for the same Add-bar rule: only a CLOSED shape can
  // stand outline-less (width 0 — its fill is the shape), so its Stroke
  // page opens on "Add Stroke". An open path IS its stroke and a pattern
  // always draws its tiles' lines, so any target outside the fill-bar
  // subtypes answers undefined and the page keeps its controls.
  const svgStrokePresent = (() => {
    if (!session) return undefined;
    const targets = editTargetIds(session).map((id) => findItem(session.state, id));
    if (targets.length === 0) return undefined;
    if (!targets.every((ref) => ref?.kind === 'svg' && svgHasFill(svgSubtype(ref.item)))) {
      return undefined;
    }
    return targets.every((ref) => ref?.kind === 'svg'
      && svgStrokeWidthCells(ref.item, session.state.strokeScale, BASE_CELL_PX) > 0);
  })();

  // Whether the Stroke page may offer its REMOVE line: whether every object
  // it would act on is one that can lose its outline and still be a shape.
  //
  // Asked of the MEMBERS, not of `sharedSvgSubtype`. That value names the
  // option menu a selection shares and collapses a mixed multi-selection to
  // the base 'stroke' menu — an open path, which cannot lose its line — so
  // reading removability off it took the Remove line away from a rectangle
  // selected beside a circle, though clearing both outlines at once is
  // exactly what the page is for. Undefined when nothing vector is in hand,
  // which leaves the panel on its own single-selection reading.
  //
  // A legacy BAKED PATTERN (patternFileId) is a vector by kind and a
  // pattern by nature: its paths are tiles, and tiles are nothing but
  // their line, so it offers no Remove either — the rule the panel holds
  // for a pattern object (strokePageRemovable), said here for the one
  // pattern the panel cannot tell from a shape.
  const svgStrokeRemovableAll = (() => {
    if (!session || !svgEditable) return undefined;
    return targetRefs.every((ref) => {
      const svg = ref.item as SVGObject;
      return svg.patternFileId == null && svgStrokeRemovable(svgSubtype(svg));
    });
  })();

  return {
    multiIds, multiLocked, selected, selectedFrameId, frameRect, frameLocked, frameEditable,
    frameEffects, targetRefs, imageEditable, imageTintPresent, editingImage, imageFramingNodeId,
    textStyleEditable, stickerEditable, stickerInverted, svgEditable, transformCopyable,
    paintEditable, patternEditable, patternRepeatable, strokeEditable, mixedStrokeEditable,
    multiOpacityEditable, selectedSvg, selectedPattern, objectOpacity, sharedSvgSubtype,
    effectsHost, effectPresent, svgFillPresent, svgPatternShape, svgPatternPresent,
    svgPatternSpan, svgPatternInk, svgPatternStroke, svgPatternEditing, svgStrokePresent,
    svgStrokeRemovableAll,
  };
}

/** Which property page is open — the shell's own state, one flag per page
 *  (mutually exclusive: see its `closeAllPages`). */
export interface PanelPages {
  /** Whether the EDIT SHEET is up, and the shell's report of every gesture
   *  that moves it (so chrome outside the panel can raise the same sheet). */
  editOpen: boolean;
  effectsOpen: boolean;
  borderOpen: boolean;
  cropOpen: boolean;
  strokeOpen: boolean;
  svgFillOpen: boolean;
  svgPatternOpen: boolean;
  endpointsOpen: boolean;
  transformOpen: boolean;
  textStyleOpen: boolean;
  opacityOpen: boolean;
  patternBarOpen: PatternEditAction | null;
}

/** The pattern pages' session state — the app's, not the document's. */
export interface PanelPatternState {
  /** The whole tile menu, host-baked, filtered to the enabled sets. */
  patternTiles: PatternTileRow[];
  /** The five the Tiles bar offers: the most-recently-used, resolved. */
  patternRecent: PatternTileRow[];
  /** The armed sub-tool, and — when it is a tile — which one. */
  patternSubTool: { kind: PatternPanelTool; spriteId?: string };
  /** Each tile's pose, keyed by sprite id. */
  patternTileTransforms: Record<string, PatternTileTransform>;
  /** The selected pattern's own tile-set filter, resolved. */
  patternEnabledSets: ReadonlySet<string>;
}

/** The callbacks the shell owns. Every one is a `useCallback` over its
 *  commit pipeline; they move here with the shell at stage 6. */
export interface PanelHandlers {
  onEditOpenChange(open: boolean): void;
  onCornerRadius(radius: number, committed: boolean): void;
  onEffectsOpenChange(open: boolean): void;
  onAddShadow(): void;
  onShadow(m: ShadowModel | null, committed: boolean): void;
  onPickShadowColor(): void;
  onShadowColor(color: RGBColor, committed: boolean): void;
  onAddGlow(kind: GlowKind): void;
  onGlow(kind: GlowKind, m: GlowModel | null, committed: boolean): void;
  onPickGlowColor(kind: GlowKind): void;
  onGlowColor(kind: GlowKind, color: RGBColor, committed: boolean): void;
  onToggleImageTint(add: boolean): void;
  onAddBorder(): void;
  onBorderOpenChange(open: boolean): void;
  onBorder(m: BorderModel | null, committed: boolean): void;
  onPickBorderColor(): void;
  onBorderColor(color: RGBColor, committed: boolean): void;
  onCropOpenChange(open: boolean): void;
  onFraming(m: FramingModel, committed: boolean): void;
  onResetFraming(): void;
  /** Replace the photo itself — gated here on a single UNLOCKED image. */
  onReplaceImageSource(): void;
  onAddStroke(): void;
  onStrokeOpenChange(open: boolean): void;
  onStroke(m: BorderModel | null, committed: boolean): void;
  onStrokeRadius(radius: number, committed: boolean): void;
  onPickStrokeColor(): void;
  onStrokeColor(color: RGBColor, committed: boolean): void;
  onAddSvgFill(): void;
  onSvgFillOpenChange(open: boolean): void;
  onSvgFill(m: TintModel | null, committed: boolean): void;
  onPickSvgFillColor(): void;
  onSvgFillColor(color: RGBColor, committed: boolean): void;
  onSvgPatternOpenChange(open: boolean): void;
  onSvgPatternSize(size: number, committed: boolean): void;
  onSvgPatternSpan(span: number, committed: boolean): void;
  onSvgPatternStroke(m: BorderModel, committed: boolean): void;
  onPickSvgPatternStrokeColor(): void;
  onSvgPatternSymmetry(key: string): void;
  onSvgPatternToggleTileSet(family: string): void;
  onAddSvgPattern(): void;
  onEditSvgPattern(): void;
  onRemoveSvgPattern(): void;
  onEndpointsOpenChange(open: boolean): void;
  onEndpoints(m: EndpointsModel | null): void;
  onTransformOpenChange(open: boolean): void;
  onTransformCopies(spec: TransformCopies): void;
  onTransformCopiesPreview(spec: TransformCopies | null): void;
  onCopiesSticky(patch: Partial<TransformCopies>): void;
  onPatternBarOpenChange(bar: PatternEditAction | null): void;
  onPatternSymmetry(key: string): void;
  onPatternPickTile(id: string): void;
  onPatternSetTileTransform(id: string, transform: PatternTileTransform): void;
  onPatternArmTool(tool: 'random' | 'erase'): void;
  onPatternMakeColorable(): void;
  onPatternGridAction(action: PatternGridAction): void;
  onPatternToggleBorder(): void;
  onPatternToggleTileSet(family: string): void;
  /** Turn the repeat flag on or off — gated here on a loose selection. */
  onTogglePatternRepeat(): void;
  onOpacityOpenChange(open: boolean): void;
  onObjectOpacity(m: OpacityModel, committed: boolean): void;
  onPickFadeColor(): void;
  onTextStyleOpenChange(open: boolean): void;
  onTextStyle(m: TextStyleModel, committed: boolean): void;
  onPickTextColor(): void;
  onTextColor(color: RGBColor, committed: boolean): void;
  onResetTextStyle(): void;
  onPickFrameBackground(): void;
  onFrameBackgroundColor(color: RGBColor, committed: boolean): void;
  onUngroupFrame(): void;
  onRotate(): void;
  onMirror(axis: 'h' | 'v'): void;
  onDuplicate(): void;
  onToggleLock(): void;
  onDelete(): void;
  onInvert(): void;
}

/** Everything the panel's model is laid out from. */
export interface PanelModelInput {
  session: EditorSession;
  facts: PanelFacts;
  pages: PanelPages;
  pattern: PanelPatternState;
  handlers: PanelHandlers;
  /** The panel slides up over the bottom edge (objectPropertiesPanelVisible). */
  visible: boolean;
  /** Header clearance for the panel's full-screen takeovers: the editor
   *  toolbar's top edge. */
  safeTop: number;
  /** The pages the FORMAT withholds from every vector on its page
   *  (`EditorConfig.hiddenShapePages`). */
  hiddenShapePages?: readonly SVGEditAction[];
  /** Whether a shape may carry a pattern fill at all on this page. */
  shapePatternFills: boolean;
  /** The text tool's font families. */
  fonts: TextFontOption[];
  /** The Copies page's remembered draft. */
  copiesSticky: Partial<TransformCopies>;
  /** The HOST's pages for this selection, and the common-row buttons it
   *  withholds — the one seam (§4.1). */
  hostPages?: HostPagesModel;
  hiddenCommonActions?: readonly CommonAction[];
  /** The colour in hand: a first border and a pattern's fallback ink. */
  currentColor: RGBColor;
  /** Which stop of a gradient fill the Fill page has selected. */
  svgFillSelectedStop: number;
  /** The colour a frame with no background of its own reads as (the
   *  format's `DEFAULT_FRAME_BACKGROUND`). */
  defaultFrameBackground: RGBColor;
}

/**
 * Lay out the object-properties panel: the pages this selection may open,
 * seeded from what it is, with the shell's handlers behind them.
 *
 * Spread into `ObjectPropertiesPanel`'s `model` in ONE place. A host's
 * pages — DrawBot's bots, CozyJournal's rig — come through `hostPages`,
 * which the panel checks before the vectors.
 */
export function buildPanelModel(input: PanelModelInput): ObjectPropertiesModel {
  const {
    session, facts: f, visible, safeTop, hiddenShapePages, shapePatternFills, fonts,
    copiesSticky, hostPages, hiddenCommonActions, currentColor, svgFillSelectedStop,
    defaultFrameBackground,
  } = input;
  const {
    patternTiles, patternRecent, patternSubTool, patternTileTransforms, patternEnabledSets,
  } = input.pattern;
  const {
    editOpen, effectsOpen, borderOpen, cropOpen, strokeOpen, svgFillOpen, svgPatternOpen,
    endpointsOpen, transformOpen, textStyleOpen, opacityOpen, patternBarOpen,
  } = input.pages;
  const {
    onEditOpenChange, onCornerRadius, onEffectsOpenChange, onAddShadow, onShadow,
    onPickShadowColor, onShadowColor, onAddGlow, onGlow, onPickGlowColor, onGlowColor,
    onToggleImageTint, onAddBorder, onBorderOpenChange, onBorder, onPickBorderColor,
    onBorderColor, onCropOpenChange, onFraming, onResetFraming, onReplaceImageSource,
    onAddStroke, onStrokeOpenChange, onStroke, onStrokeRadius, onPickStrokeColor,
    onStrokeColor, onAddSvgFill, onSvgFillOpenChange, onSvgFill, onPickSvgFillColor,
    onSvgFillColor, onSvgPatternOpenChange, onSvgPatternSize, onSvgPatternSpan,
    onSvgPatternStroke, onPickSvgPatternStrokeColor, onSvgPatternSymmetry,
    onSvgPatternToggleTileSet, onAddSvgPattern, onEditSvgPattern, onRemoveSvgPattern,
    onEndpointsOpenChange, onEndpoints, onTransformOpenChange, onTransformCopies,
    onTransformCopiesPreview, onCopiesSticky, onPatternBarOpenChange, onPatternSymmetry,
    onPatternPickTile, onPatternSetTileTransform, onPatternArmTool, onPatternMakeColorable,
    onPatternGridAction, onPatternToggleBorder, onPatternToggleTileSet, onTogglePatternRepeat,
    onOpacityOpenChange, onObjectOpacity, onPickFadeColor, onTextStyleOpenChange, onTextStyle,
    onPickTextColor, onTextColor, onResetTextStyle, onPickFrameBackground,
    onFrameBackgroundColor, onUngroupFrame, onRotate, onMirror, onDuplicate, onToggleLock,
    onDelete, onInvert,
  } = input.handlers;
  const {
    multiIds, multiLocked, selected, selectedFrameId, frameRect, frameEditable, frameEffects,
    frameLocked, targetRefs, imageEditable, imageTintPresent, textStyleEditable, stickerEditable,
    stickerInverted, svgEditable, transformCopyable, paintEditable, patternEditable,
    patternRepeatable, mixedStrokeEditable, strokeEditable, multiOpacityEditable, selectedSvg,
    selectedPattern, objectOpacity, sharedSvgSubtype, effectsHost, effectPresent, svgFillPresent,
    svgPatternShape, svgPatternPresent, svgPatternSpan, svgPatternStroke, svgPatternEditing,
    svgStrokePresent, svgStrokeRemovableAll,
  } = f;
  return {
    visible,
    // The panel's own takeovers (Tiles / Randomization Settings)
    // seat their headers on the toolbar's bottom edge.
    safeTop,
    // Multi mode reshapes the panel: the image row drops the
    // single-target action (Crop), and the selection gets its own
    // carousel page (Layout / Group / Union).
    mode: multiIds ? 'multi' : 'single',
    // The Edit sheet's open state is the shell's, so the floating
    // Edit capsule can raise the same sheet the panel's own swipe
    // and dot do.
    editOpen,
    onEditOpenChange,
    // Content editing is not a tab: a tap on the selected text opens
    // the overlay (onNodeTap → onEditText).
    showImageEdit: imageEditable,
    // The Lock button reflects the selection's OWN lock (raw) — for a leaf
    // inside a locked frame the button still toggles that leaf's own flag,
    // which the parent's inherited lock must not change. Frame selections
    // show the frame's own group lock. A multi-selection lights only when
    // every member is locked, matching what the press does to it.
    // …and a host ITEM's own (a DrawBots bot or instruction tile), which
    // the selection carries beside scene nodes (sessionHost's `items`).
    locked: multiIds ? multiLocked
      : (!!selected?.item.locked || frameLocked
        || (!!session.selectedId && isHostItemLocked(session, session.selectedId))),
    cornerRadius: selected?.kind === 'image' ? (selected.item.cornerRadius ?? 0) : 0,
    onCornerRadius,
    // The Effects page is shared by images, frames, text AND vectors
    // (the same page, the same NodeEffects on the node — a line's page
    // could open but read nothing back, so every edit sprang to the
    // default and the tab did nothing); Border by images and frames
    // only. A frame reads both from its boundary rect's effects
    // (frameEffects).
    // …and a word STICKER, whose Effects page is the same page: a
    // sticker is a text object (TextObject.sticker), so the effect
    // record, the present check and the add button below all reach
    // it already — only this gate named every kind but it.
    effectsOpen: effectsOpen
      && (imageEditable || frameEditable || textStyleEditable || svgEditable
        || stickerEditable),
    shadow: effectsHost
      ? shadowEffectToModel(effectsHost.effects?.shadow ?? DEFAULT_SHADOW_EFFECT)
      : undefined,
    shadowPresent: effectPresent('shadow'),
    onAddShadow,
    onEffectsOpenChange,
    onShadow,
    onPickShadowColor,
    // …and the two glows the same page holds, each seeded from the
    // object's own or from the default it would be created with.
    glows: effectsHost
      ? {
          outer: glowEffectToModel(effectsHost.effects?.glow ?? DEFAULT_GLOW_EFFECT),
          inner: glowEffectToModel(effectsHost.effects?.innerGlow ?? DEFAULT_GLOW_EFFECT),
        }
      : undefined,
    glowPresent: { outer: effectPresent('glow'), inner: effectPresent('innerGlow') },
    // …and the image's TINT, which stands on that page as a fourth
    // button. Offered only where there is a photo to wash — the
    // brush is what puts one there, and this is where it comes off.
    ...(imageEditable ? {
      imageTintPresent,
      onToggleImageTint,
    } : {}),
    onAddGlow,
    onGlow,
    onPickGlowColor,
    borderOpen: borderOpen && (imageEditable || frameEditable),
    border: selected?.kind === 'image'
      ? borderEffectToModel(selected.item.effects?.border ?? defaultBorderEffect(currentColor))
      : frameEditable
        ? borderEffectToModel(frameEffects?.border ?? defaultBorderEffect(currentColor))
        : undefined,
    borderPresent: effectPresent('border'),
    onAddBorder,
    onBorderOpenChange,
    onBorder,
    onPickBorderColor,
    cropOpen: cropOpen && !multiIds && imageEditable,
    // A node with no framing record is DRAWN as plain cover
    // (engine effectiveFraming), so that is what the bar must report —
    // DEFAULT_IMAGE_FRAMING here would open the Crop page claiming 130%
    // zoom over a picture sitting at 100%.
    framing: selected?.kind === 'image'
      ? framingEffectToModel(selected.item.framing ?? COVER_FRAMING)
      : undefined,
    onCropOpenChange,
    onFraming,
    onResetFraming,
    // The Image page: the photo itself. Replace is offered only for an
    // UNLOCKED image, since a locked one is not editable and an
    // unfilled placeholder already replaces itself when tapped
    // (onNodeTap). No callback, no page.
    onReplaceImage: selected?.kind === 'image' && !multiIds
      && !isItemLocked(session.state, selected.item.id)
      ? onReplaceImageSource
      : undefined,
    // Vector selection: the subtype's option menu, and the Stroke bar it
    // opens. Width seeds from what the object is ACTUALLY drawn at (the
    // composition-wide strokeScale when it has no stroke of its own), so
    // the slider opens under the line rather than at zero.
    showSvgOptions: svgEditable,
    svgSubtype: sharedSvgSubtype,
    // …less the pages the FORMAT withholds from every vector on its
    // page (the format's `hiddenShapePages` — CozyJournal's Shadows keeps
    // its shapes solid black by taking Stroke, Fill, Effects and Opacity
    // off the row).
    svgHiddenActions: hiddenShapePages,
    // …and whether the page may offer Remove, asked of the MEMBERS:
    // the subtype above names a shared option MENU, which a mixed
    // multi-selection collapses to the open-path one.
    strokeRemovable: svgStrokeRemovableAll,
    // Repeat toggle: the new pattern kind, and the legacy studio-baked
    // pattern SVGs (patternFileId — they still render, the bake lives
    // on the object; only their old Edit action is gone with the
    // studio). Ungrouped-only — the toggle builder rejects members.
    onToggleRepeat:
      patternRepeatable
      || (!multiIds && svgEditable && selectedSvg?.patternFileId != null && !selectedSvg.groupId)
        ? onTogglePatternRepeat : undefined,
    // Lit only when EVERY member repeats — the state the press
    // converges from.
    repeat: targetRefs.length > 0 && targetRefs.every(isRepeatTarget),
    // …and when the members DISAGREE the switch says so rather than
    // showing one side's value as everyone's. A press from there
    // converges them all on (buildTogglePatternRepeatMulti).
    repeatMixed: targetRefs.length > 1 && targetRefs.some(isRepeatTarget)
      && !targetRefs.every(isRepeatTarget),
    strokeOpen: strokeOpen && strokeEditable,
    // The Stroke bar serves vectors AND patterns (a pattern's tiles are
    // stroked paths; its bar is the open-path form — Width + Dash),
    // together or apart. A pattern's colour lives per cell, so its
    // swatch shows the ink the cells actually draw in and a pick
    // re-inks them all (buildRecolorPattern). Seeded from the first
    // member either way.
    stroke: selectedSvg
      ? {
          width: svgStrokeWidthCells(selectedSvg, session.state.strokeScale, BASE_CELL_PX),
          position: selectedSvg.stroke?.position ?? 'center',
          dash: selectedSvg.stroke?.dash ?? 0,
          color: selectedSvg.color,
        }
      : selectedPattern
        ? {
            width: svgStrokeWidthCells(selectedPattern, session.state.strokeScale, BASE_CELL_PX),
            position: 'center' as const,
            dash: selectedPattern.stroke?.dash ?? 0,
            // The ink the tiles actually draw in, which is per cell —
            // the baked view's own colour is only the fallback, for a
            // grid whose cells disagree or that holds nothing yet.
            color: patternInkColor(selectedPattern)
              ?? patternSVGView(selectedPattern)?.color
              ?? { r: 255, g: 255, b: 255 },
          }
        : undefined,
    strokeRadius: selectedSvg?.stroke?.radius ?? 0,
    strokePresent: svgStrokePresent,
    onAddStroke,
    onStrokeOpenChange,
    onStroke,
    onStrokeRadius,
    onPickStrokeColor,
    onStrokeColor,
    // The Fill bar, offered by the closed shapes (rectangle / circle —
    // see svgHasFill). Seeded from the shape's own fill, or from its
    // color when it has never been filled, so the bar never opens blank.
    svgFillOpen: svgFillOpen && svgEditable,
    svgFill: selectedSvg
      ? tintFillToModel(shapeFillOf(selectedSvg), svgFillSelectedStop)
      : undefined,
    // What the INTERIOR pages ride on — every edit target encloses an
    // area. A merged collection of lines answers yes on the loop it
    // holds, where its subtype (`stroke`) knows nothing about one.
    svgEncloses: svgEditable && (() => {
      const targets = editTargetIds(session).map((id) => findItem(session.state, id));
      return targets.length > 0 && targets.every(svgEnclosesRef);
    })(),
    svgFillPresent,
    onAddSvgFill,
    onSvgFillOpenChange,
    onSvgFill,
    // The Pattern page — a closed shape's tile fill. Offered where
    // the format allows one at all (shapePatternFills): the toolbar
    // can put the TILE TOOL in hand, or the format asks for fills
    // without it. Where it allows neither the tab is left out rather
    // than standing there inert (the panel's own filter).
    svgPatternOpen: svgPatternOpen && svgEditable,
    svgPatternPresent,
    svgPatternEditing,
    svgPatternSize: svgPatternShape?.patternFill?.size,
    onSvgPatternSize: svgPatternPresent ? onSvgPatternSize : undefined,
    svgPatternSpan,
    onSvgPatternSpan: svgPatternPresent ? onSvgPatternSpan : undefined,
    svgPatternStroke,
    onSvgPatternStroke: svgPatternPresent ? onSvgPatternStroke : undefined,
    onPickSvgPatternStrokeColor: svgPatternPresent
      ? onPickSvgPatternStrokeColor : undefined,
    svgPatternSymmetry: patternSymmetryKey(svgPatternShape?.patternFill?.symmetry),
    onSvgPatternSymmetry: svgPatternPresent ? onSvgPatternSymmetry : undefined,
    // …and what that tile is MADE of, read off the fill itself.
    svgPatternTileSets: patternTileSetRows(
      PATTERN_TILE_FAMILIES,
      patternEnabledTileSets(svgPatternShape?.patternFill?.tileSets),
    ),
    onSvgPatternToggleTileSet: svgPatternPresent
      ? onSvgPatternToggleTileSet : undefined,
    onSvgPatternOpenChange,
    // Add, Remove and every row above them go over the WHOLE
    // selection, like the Stroke and Fill pages'. Only EDIT is
    // singular: the tiles are painted on the canvas inside a shape,
    // and there is one grid open at a time — so a multi-selection
    // gets the page without that button rather than not at all,
    // which is what kept a selection of patterned pieces from being
    // cleared in one go.
    onAddSvgPattern: shapePatternFills && svgPatternShape && !svgPatternPresent
      ? onAddSvgPattern : undefined,
    onEditSvgPattern: shapePatternFills && svgPatternPresent && !multiIds
      ? onEditSvgPattern : undefined,
    onRemoveSvgPattern: svgPatternPresent ? onRemoveSvgPattern : undefined,
    // The fill's own colour, on the Fill page where it belongs — it
    // had no control at all there once the swatches moved to the
    // shared Color page, which is the bug this row closes.
    onSvgFillColor,
    endpointsOpen: endpointsOpen && svgEditable,
    endpoints: selectedSvg ? endpointsModelOf(selectedSvg) : undefined,
    onEndpointsOpenChange,
    onEndpoints,
    // The Transform bar: one vector at a time — a rotation slider and
    // Create copies both act on one object's own angle and place.
    // The Copies page, for ONE object or for a whole selection: a
    // group is copied as a group (buildTransformCopiesMulti), so the
    // page no longer stands down the moment a second object is in
    // hand — it was reachable-looking and dead there, a tab on the
    // row that lit nothing and copied nothing.
    transformOpen: transformOpen && transformCopyable
      && (svgEditable || imageEditable || textStyleEditable || stickerEditable || !!multiIds),
    // …and what the page ACTS on, which is also what tells a mixed
    // multi-selection (no kind row of its own) that it has a Copies
    // tab at all.
    onTransformCopies: transformCopyable ? onTransformCopies : undefined,
    onTransformOpenChange,
    onTransformCopiesPreview,
    copiesSticky,
    onCopiesSticky,
    onPickSvgFillColor,
    onShadowColor,
    onGlowColor,
    onBorderColor,
    onTextColor,
    onFrameBackgroundColor,
    // The Opacity bar (whole-object opacity + edge soften), shared by
    // images and the closed vector shapes. Seeded from the object's
    // current values with the defaults resolved (opaque, hard edges) so
    // both sliders always open where the object actually is.
    showPaintOptions: paintEditable,
    // Inline tile pattern: the Tiles / Tools / Symmetry / Patchwork
    // pages, plus the Repeat toggle it shares with the legacy tiled
    // vectors below.
    showPatternOptions: patternEditable,
    // Vectors and patterns together: Stroke alone, applied to all.
    showStrokeOptions: mixedStrokeEditable,
    patternBarOpen,
    onPatternBarOpenChange,
    patternSymmetry: patternSymmetryKey(selectedPattern?.symmetry),
    onPatternSymmetry,
    patternTiles,
    patternRecentTiles: patternRecent,
    patternTool: patternSubTool.kind,
    patternActiveTileId: patternSubTool.kind === 'tile' ? patternSubTool.spriteId ?? null : null,
    onPatternPickTile,
    patternTileTransforms,
    onPatternSetTileTransform,
    onPatternArmTool,
    // The Tile page's Make Colorable button, offered for the same
    // selection the rest of the pattern pages are (every member a
    // pattern, none locked). It is the one press on the sheet that
    // ends the object's life as a pattern: the drawing stays, as
    // lines over patches. (It stands where the page's Edit button
    // used to: the way INTO the grid is the canvas's floating Edit
    // capsule, which is where you already are.)
    onPatternMakeColorable: patternEditable ? onPatternMakeColorable : undefined,
    onPatternGridAction,
    patternAllowBorder: selectedPattern?.allowBorderConnections !== false,
    onPatternToggleBorder,
    // The Shapes page: what THIS pattern is made of. Offered for the
    // same selection the rest of the pattern pages are; a pattern
    // that has never said otherwise reads as the default families.
    patternTileSets: patternEditable
      ? patternTileSetRows(PATTERN_TILE_FAMILIES, patternEnabledSets)
      : undefined,
    onPatternToggleTileSet: patternEditable ? onPatternToggleTileSet : undefined,
    opacityOpen: opacityOpen
      && (imageEditable || svgEditable || paintEditable || stickerEditable
        || textStyleEditable || patternEditable || multiOpacityEditable),
    objectOpacity,
    // The Fade row exists exactly when the host can serve its picker,
    // which is how a selection with nothing to fade says so. A paint
    // island is raster brushwork with no fill, border or stroke of its
    // own, so its page keeps the one row it always had.
    onPickFadeColor: selected && selected.kind !== 'paint' ? onPickFadeColor : undefined,
    onOpacityOpenChange,
    // A multi-selection is offered the page only when a member can
    // take it: one of host items alone has no opacity, and the page
    // stood there writing to nothing.
    onObjectOpacity: !multiIds || multiOpacityEditable ? onObjectOpacity : undefined,
    showTextStyle: textStyleEditable,
    // Word sticker: the Color tab (Invert) and Opacity, mutually
    // exclusive with the text-style controls (a sticker does not set
    // showTextStyle).
    showInvert: stickerEditable,
    inverted: stickerInverted,
    onInvert,
    textStyleOpen: textStyleOpen && textStyleEditable,
    textStyle: selected?.kind === 'text' ? textStyleToModel(selected.item.style) : undefined,
    fonts,
    onTextStyleOpenChange,
    onTextStyle,
    onPickTextColor,
    onResetTextStyle,
    // The HOST's own pages for this selection, and the common-row
    // buttons it withholds — the one seam of this builder
    // (docs/shared-editor.md §4.1): DrawBot's bots, instruction tiles,
    // arena and fields pages reach the panel through it, and CozyJournal's
    // rig pages. The panel checks them before the vectors'.
    hostPages,
    hiddenCommonActions,
    // Frame options (background / shadow / border / ungroup). Gated on an
    // unlocked frame — a locked frame shows only the common actions.
    showFrameOptions: frameEditable,
    frameBackgroundColor: frameRect?.fillColor ?? defaultFrameBackground,
    onPickFrameBackground,
    // Ungroup here serves the FRAME only (its own type options). A
    // multi-selection's structural actions — Group / Ungroup / Merge /
    // Layout — left the panel for the floating capsule over it, so none
    // of them is passed for a multi selection: the panel's row is what
    // the selection is made of, the capsule is what can be done to the
    // selection itself.
    //
    // The BOOLEAN union (onUnion) is a different operation on a different
    // thing — closed regions, not objects — and no UI reaches it yet, so
    // it stays unset here.
    onUngroup: selectedFrameId ? onUngroupFrame : undefined,
    onRotate,
    onMirrorH: () => onMirror('h'),
    onMirrorV: () => onMirror('v'),
    onDuplicate,
    onToggleLock,
    onDelete,
  };
}
