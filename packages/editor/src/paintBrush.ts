// The color tool's drag-paint brush — CozyJournal's port of Facet's
// CompositionEditor paint stroke (handleColorPaintStart / Move / Finalize),
// against the engine's own PaintStrokeDraft + buildPaintStrokeOps pipeline.
//
// The brush is a round Gaussian stamp of one grid step's radius: every SVG
// segment inside it blends toward the brush color under the picker's blend
// mode, scaled by `opacity * gaussianFalloff((d/r)²)` — so a pass leaves a
// soft-edged wash and repeat passes compose (multiply keeps darkening,
// normal converges on the brush color). Unary modes (invert / rotate) are
// discrete per-stroke ops: they apply once to each touched segment and
// re-touches within the stroke are ignored, exactly as in Facet (lerping
// them repeatedly converges to mid-gray).
//
// Kept free of DOM / React so the stamp semantics are node-testable; the
// canvas owns the gesture, the preview overlay and the commit.

import {
  BlendMode, CompositionState, ImageObject, ImagePaintOverlay, PaintObject, PaintStrokeDraft,
  PathSegment, PatternObject, RGBColor, SVGObject, SVGSubpath, TextObject, TextStyle,
} from '@/engine/types';
import {
  PATTERN_BASE_INK, effectivePatternCellColor, patternCellTint, patternCellsInBrush,
} from '@/engine/patternObject';
import { shapePatternGrid } from '@/engine/shapePatternFill';
import { blendColor, gaussianFalloff } from '@/engine/colorBlend';
import { brushHitsSegments, pointInClosedPath } from '@/engine/compositionPathHitTest';
import { arcBoundingBox } from '@/engine/compositionArcHitTest';
import { type CompItemRef, hiddenGroupIds, lockedGroupIds } from '@/engine/compositionOps';
import { buildFrameRectMap } from '@/engine/compositionFrame';
import { lineCharBoxes } from '@/engine/textLayout';
import {
  blurImagePaintOverlay, clonePaintOverlay, createImagePaintOverlay, eraseImagePaintOverlay,
  paintBlendCss, stampImagePaintOverlay,
} from '@/engine/imagePaintOverlay';
import {
  blurCanvasPaint, CANVAS_ISLAND_CELLS, CANVAS_PAINT_MAX_BYTES, CanvasPaintStampMask,
  CanvasPaintWorking, canvasPaintBytes, createCanvasPaintWorking, eraseCanvasPaint,
  smudgeCanvasPaint, stampCanvasPaint,
} from '@/engine/canvasPaint';
import {
  PaintLocalFrame, paintObjectAlphaHitTest, paintObjectCanGrow, paintObjectTranslation,
  paintTileFrame,
} from '@/engine/paintObject';
import type { SceneOcclusion } from './sceneOcclusion';
import { FRESH_ISLAND_ORDER } from './sceneOcclusion';
import type { SceneGraph } from '@/engine/sceneGraph';
import { leafHitFrame } from '@/engine/sceneHitFrame';
import { DrawnLeaf, drawnAabb, drawnLeaf } from './drawnPose';
import { drawnTextLayout } from './textNodeLayout';
import { graphOf } from './transformGestures';
import { svgIsFilled } from '@/engine/svgPathBuilder';
import { svgSubtype } from '@/engine/svgStroke';
import { svgHasFill } from '@/editor-ui/logic/svgEdit';
// The host's own nodes under the Color brush — CozyJournal's rig, whose
// colours are not on its object (sessionHost.ts `HostPaintTargets`).
import { type HostPaintTargets, sessionHost } from './sessionHost';

/**
 * Whether a blend actually MOVED a colour.
 *
 * Every pass below reports whether its dab painted, and the canvas mounts
 * the stroke's preview — a wash over a fill, a stroke over a segment, a
 * glyph over a character — on the strength of that answer. So "I painted"
 * has to mean the colour changed, not merely that the brush was over
 * something: a dab that lands back on the colour already there must report
 * nothing, or the preview stands in for an edit the commit will (rightly)
 * refuse to make, and the stroke appears to undo itself on release.
 *
 * It is the STRONG modes that make this visible rather than theoretical.
 * Dodge, burn and multiply blend at an eighth of the brush opacity
 * (blendStrength), and `blendColor` rounds to whole channels, so a small
 * step rounds back to where it started. And dodge cannot brighten white at
 * all — no blend colour moves a maxed channel — which is exactly the case a
 * user meets first, white being the default ink AND the fill a shape takes
 * when one is added. Dodging a white shape is a no-op by definition; the
 * tool's job is to look like one.
 */
export function sameColor(a: RGBColor, b: RGBColor): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

/** Modes that pre-bake their result per stroke instead of composing per
 *  touch — Facet's "discrete per-stroke op" rule (see module header).
 *
 *  RANDOM is NOT one of them, though it reads like one. Invert and rotate
 *  are FUNCTIONS OF THE BASE — re-running them on their own output walks
 *  away from the answer (a second invert undoes the first, a second rotate
 *  turns the hue twice), so each surface gets exactly one go. Random is a
 *  function of nothing: the engine's blend for it deposits the colour the
 *  stroke is carrying, the same arithmetic `normal` does, and the walk
 *  (see below) is what makes it random. Composing it is therefore
 *  well-defined, and not composing it cost the mode the one thing every
 *  other brush has: at a low opacity the colour has to FADE IN under a
 *  held brush. One-go-per-surface meant a shape took its whole colour on
 *  the dab that first touched it and then ignored the rest of the drag —
 *  the stroke only ever seemed to act when it crossed into a new shape. */
export function isUnaryMode(mode: BlendMode): boolean {
  return mode === 'invert' || mode === 'rotate';
}

/** The extra factor a non-Normal dab blends at. */
const NON_NORMAL_BLEND_FACTOR = 0.5;

/** The further factor the arithmetic heavyweights take: dodge, burn and
 *  multiply compound so fast that even the halved hand saturated what was
 *  under the brush within a dab or two, so they run at a QUARTER of it
 *  again — the effect reduced by 75%. Opacity still scales the hand
 *  proportionally; the effect is simply much slower to build. */
const STRONG_BLEND_FACTOR = 0.25;

/** Where the brushes' shared STRENGTH slider stands on a fresh editor.
 *  Not at the top: the top is the one setting that lands a colour outright
 *  (dabHand), and a brush that replaces what it touches on contact leaves
 *  the slider nothing to say. Half-way, a pass reads as colour building
 *  up, and the slider's two directions both do something from there. */
export const DEFAULT_BRUSH_STRENGTH = 0.5;

/** The softest hand any dab lands with — the share of the strength value a
 *  dab lays down once the value is well off its top end. The colour a
 *  stroke lays is `1 − (1 − hand)^dabs`, so the hand is what decides how
 *  many dabs a change takes; at the raw strength value it took one or two
 *  at any setting, which is why every setting but the very lowest read as
 *  instant. */
const SOFT_HAND = 0.35;

/** How sharply the hand climbs back to FULL as the strength value reaches
 *  its top. The curve is (hand = v × (SOFT_HAND + (1 − SOFT_HAND)·v^KNEE)):
 *  a high power keeps the soft hand across the slider's working range and
 *  spends the climb in the last stretch, so only a strength dragged all
 *  the way up lands a colour outright. */
const FULL_HAND_KNEE = 4;

/**
 * How much of the way to the brush's colour ONE dab carries, from the
 * strength value in hand.
 *
 * A dab blends TOWARD the colour under it, so a stroke's progress is
 * geometric: at hand h, `dabs` dabs land `1 − (1 − h)^dabs`. That is why
 * the raw value never read as a rate — at 0.5 a shape was 94% recoloured
 * four dabs in (a quarter of a brush width of travel), which is the same
 * "instantly" 1.0 gives. The strength slider changed how hard the FIRST
 * dab hit and nothing about how long the change took.
 *
 * The curve below makes the value a rate instead. Across the working range
 * it is very nearly `value × SOFT_HAND`, and the dabs a given change takes
 * go as 1/hand — so half the strength is twice the travel for the same
 * shift of colour, which is what the slider now means. The top of the
 * slider is still literal: at 1 the hand is exactly 1 and the colour lands
 * in the dab that touches it, which is the one setting that should feel
 * immediate.
 */
export function dabHand(value: number): number {
  const v = Math.max(0, Math.min(1, value));
  return v * (SOFT_HAND + (1 - SOFT_HAND) * v ** FULL_HAND_KNEE);
}

/** The strength one Paint dab BLENDS at: the brush's hand (dabHand of the
 *  strength value), halved on any mode other than Normal — a full-strength
 *  multiply / dodge / rotate overwhelms what is under the brush within a
 *  dab or two, so blending runs at half the hand plain painting gets (and
 *  the three heavyweights at a quarter of that — STRONG_BLEND_FACTOR).
 *  Invert's own full-strength override (a half-invert is just a gray
 *  drift) layers on top of this at the call sites, and the erase / blur
 *  brushes never consult it — they are not blends, and lifting or
 *  softening paint is not a colour building up. */
export function blendStrength(mode: BlendMode, opacity: number): number {
  const hand = dabHand(opacity);
  if (mode === 'normal') return hand;
  const strong = mode === 'dodge' || mode === 'burn' || mode === 'multiply';
  return hand * NON_NORMAL_BLEND_FACTOR * (strong ? STRONG_BLEND_FACTOR : 1);
}

// ── Brush kinds ─────────────────────────────────────────────────────
// The color group's tools share ONE stroke pipeline (the same draft /
// accumulators / commit), differing only in what a stamp does to what it
// touches. A kind IS a tool id — the pushdown's word, the gesture's arming
// and the stamp's behaviour are one vocabulary, so nothing has to be
// translated between them:
//   'color'  — RECOLOUR ONLY, and never a raster mark. What the brush
//              touches changes the colour it already draws in: a line's
//              touched segments, a text's touched characters, a pattern's
//              touched cells, a filled shape's FILL (as a solid) plus any
//              border segment the brush crossed, and an image's tint layer
//              — one tint over the whole photo, since an image has no
//              smaller part that owns a colour. A FIGURE takes it on one of
//              the two colours its sketch is drawn in, on its RECORD rather
//              than on the silhouette the page carries (see the rig section
//              below). A word tile takes nothing — its ink is its preset's,
//              not a style's — and no paint overlay, island or tile is ever
//              created. This
//              is the whole difference from 'paint': same blends, same
//              falloff, nothing new laid down. It is also the one kind
//              that AIMS: a stroke writes one of those surfaces at a time,
//              picked by its ColorScope (see below).
//   'paint'  — deposit the brush color under the picker's blend mode: the
//              object pass writes each touched image's and solid shape's
//              low-res paint overlay, and the island half (see
//              PaintObjectStrokeState) lays raster paint on the page
//              itself.
//   'erase'  — lift deposited paint back off: overlay alpha erased with the
//              stamp's own falloff, per-character text tints cleared to the
//              node color. Segment recolors and legacy fill blends are
//              PERMANENT (the stroke's color IS the object's color once
//              committed — there is no underlying base to reveal), so the
//              eraser leaves vector strokes alone.
//   'push'   — nothing is coloured at all: what is under the cursor MOVES
//              with it. Island texels smear along the drag (the engine's
//              smudgeCanvasPaint), and the vector and rig halves of the
//              same brush live in pushBrush.ts. It rides this pipeline for
//              its island half alone, which is why it appears in
//              PaintToolKind but not in PaintBrushKind — there is no
//              per-object colour pass for it to run.
//   'blur'   — everything under the cursor softens toward its LOCAL
//              average: each touched object's own colors blend among
//              themselves (segments toward that object's segments, glyphs
//              toward that text's glyphs, overlay texels through a box-blur
//              step) — never toward a neighbor's, so blurring a shape's
//              fill can't drag its outline color in, and two objects under
//              one cursor stay distinct. Carries nothing between stamps.

export type PaintBrushKind = 'color' | 'paint' | 'erase' | 'blur';

/** What a paint gesture can be armed with: the four object brushes above,
 *  plus 'push'. The raster brush ('paint') paints everything under it, the
 *  page's canvas paint layer (see engine/canvasPaint.ts) AND the objects on
 *  it. A selection narrows it to that object: the object pass is filtered to
 *  it, and the island half runs only when the selection names a paint island
 *  — then the whole stroke deposits into that island. */
export type PaintToolKind = PaintBrushKind | 'push';

// ── The Color brush's scope ─────────────────────────────────────────
// Everything the recolour brush can reach is one of three kinds of
// surface, and a pass aims at ONE of them — the scope capsule under the
// toolbar picks which. Colouring used to be all-or-nothing: a drag across
// a filled shape set its fill AND every border segment it crossed, and
// there was no way to ask for one without the other. On a page where the
// pieces are packed edge to edge (Patchwork) that is the difference
// between restaining the cloth and restaining the seams.
//
//   'fills'    — the colour a closed thing is filled WITH: a shape's fill
//                (modern `fill`, legacy `fillColor` or a baked fill
//                subpath), an image's tint layer, a text's characters.
//                The body of the thing.
//   'strokes'  — the colour its LINE is drawn in: the segments the brush
//                crosses, on an open path or round a filled shape alike —
//                and a text's characters again.
//   'patterns' — a pattern's cells, one cell at a time.
//
// The three cover the brush's reach: every surface it can write belongs to
// at least one, so no pick can leave something unreachable. TEXT is the
// one surface in two of them, and the reason is that it has only one
// colour to give: a character is drawn, not filled and outlined, so its
// ink is its body and its line at once. Aiming at Strokes and dragging
// over a poem has to do something — on a page that is a photo and three
// lines, or a board of magnets, it would otherwise be an aim with nothing
// under it — and whichever of the two the user picked, there is only ever
// the one colour for the brush to set.
//
// …and a fourth aim, 'any', that is not a surface but a rule for picking
// one PER OBJECT: each thing the brush reaches takes the colour on exactly
// one of its surfaces, the first it has in ANY_COLOR_PRIORITY — its fill if
// it has one, else its line, else its cloth. It is the aim for colouring
// things rather than surfaces: a drag across a filled square and an open
// line recolours the square's body and the line's ink, and never the
// square's border as well.
//
// Only 'color' is scoped — the other brushes deposit, lift or move raster
// and are aimed by their own rules.
export type ColorScope = 'any' | ColorSurface;

/** The three surfaces a colour can land on — every aim but 'any', which
 *  resolves to one of these per object ({@link colorAimFor}). */
export type ColorSurface = 'fills' | 'strokes' | 'patterns';

/** The surfaces in the order a re-aim tries them (reaimedColorScope,
 *  editorSession's svgColorAim). STROKES leads: the line is what a page
 *  is mostly made of here, so it is the surface a colour is most often
 *  aimed at. Fills follows, then Patterns — the narrowest of the three,
 *  and the only one that needs a pattern on the page before it writes
 *  anything. */
export const COLOR_SURFACES: readonly ColorSurface[] = ['strokes', 'fills', 'patterns'];

/** Capsule order, left to right: Any, then the surfaces. Order is not the
 *  aim: the aim is whatever the capsule was last left on
 *  (DEFAULT_COLOR_SCOPE until someone picks), and nothing — not even the
 *  picker confirm that arms the brush — re-aims it. */
export const COLOR_SCOPES: readonly ColorScope[] = ['any', ...COLOR_SURFACES];

/** Which ONE surface 'any' lands on: the first of these the object has.
 *  Fill before line — the body is what a filled thing reads as — and the
 *  cloth last. */
export const ANY_COLOR_PRIORITY: readonly ColorSurface[] = ['fills', 'strokes', 'patterns'];

/** The scope a brush nobody has aimed yet writes: Any, on every page and
 *  every game — each object takes the colour on its most telling surface
 *  (ANY_COLOR_PRIORITY) until the capsule is aimed somewhere narrower. */
export const DEFAULT_COLOR_SCOPE: ColorScope = 'any';

/** The scope's word on the capsule (words only there, as in every tool
 *  group's menu). */
export function colorScopeLabel(scope: ColorScope): string {
  if (scope === 'any') return 'Any';
  return scope === 'strokes' ? 'Strokes' : scope === 'patterns' ? 'Patterns' : 'Fills';
}

/** Whether a stamp of `kind` may write a `target` surface this stroke.
 *  True for every brush but 'color', which writes its one scope and
 *  nothing else — asked at each of the four passes rather than threaded
 *  through them, so the partition above is stated in one place. Under
 *  'any' every surface MAY be written; which one each object actually
 *  takes is decided per object ({@link colorAimFor}) where a kind has more
 *  than one (an svg's fill/line/cloth). */
export function colorScopeWrites(
  kind: PaintToolKind, scope: ColorScope, target: ColorSurface,
): boolean {
  return kind !== 'color' || scope === 'any' || scope === target;
}

/** Whether a stamp writes a TEXT's characters — one of the two surfaces
 *  that two aims reach (see the ColorScope comment above): a character's
 *  ink is the whole of it, body and line together, so Fills and Strokes
 *  both land on it. Named rather than spelled out at the call site so the
 *  exception is stated once, beside the rule it bends. */
export function colorScopeWritesText(kind: PaintToolKind, scope: ColorScope): boolean {
  return colorScopeWrites(kind, scope, 'fills') || colorScopeWrites(kind, scope, 'strokes');
}

/** …and a PAINT ISLAND's texels, for the same reason: raster paint has one
 *  colour, its pixels, which are its body and its line at once — so it
 *  answers to Fills and Strokes exactly as a text does (never Patterns). */
export function colorScopeWritesPaintIsland(kind: PaintToolKind, scope: ColorScope): boolean {
  return colorScopeWritesText(kind, scope);
}

/** …and whether it writes a PATTERN OBJECT's cells, which is the other.
 *  A pattern object is LINE ART: what a cell's ink is, is the stroke its
 *  tile is drawn in (effectivePatternCellColor), and it is the only colour
 *  the object has. So Strokes lands on it as squarely as Patterns does —
 *  an aim at the lines of the page, over a thing that is nothing but
 *  lines, must not be an aim at nothing.
 *
 *  A shape's pattern FILL is NOT this. That shape has an outline of its
 *  own for Strokes to mean and cloth inside it for Patterns to mean, so
 *  the two aims stay apart there — which is exactly the split the capsule
 *  exists for on a page of patterned pieces. */
export function colorScopeWritesPatternObject(
  kind: PaintToolKind, scope: ColorScope,
): boolean {
  return colorScopeWrites(kind, scope, 'patterns')
    || colorScopeWrites(kind, scope, 'strokes');
}

/**
 * Whether a Color pass aimed at `scope` has anything to write on this
 * object — the same partition the stamp passes apply, asked of ONE object
 * ahead of any stroke.
 *
 * It is what lets the brush be re-aimed at what is actually in hand
 * ({@link reaimedColorScope}): a shape with no fill under an aim at Fills
 * is a brush that would drag across its target and do nothing, with
 * nothing on screen to say why.
 *
 * Read against the passes above, kind by kind:
 *  • a TEXT has one colour and answers to Fills and Strokes alike;
 *  • an IMAGE has its tint, which is Fills (an untinted photo takes the
 *    brush colour on the first dab, so it counts);
 *  • a PATTERN object answers to Patterns and to Strokes — its cells'
 *    stroke is the only colour it has;
 *  • a node the HOST answers for (`host` — sessionHost.ts
 *    `HostPaintTargets`: CozyJournal's rig, whose two colours live on its
 *    record, not its object) answers as the host says; the object alone
 *    cannot, which is why the caller hands the host's targets in;
 *  • an SVG takes ink on its outline always, on its FILL only where there
 *    is one (a shape that could be filled but isn't is four lines), and on
 *    its cloth only where it carries a pattern fill;
 *  • a paint ISLAND answers to Fills and Strokes, like a text: its pixels
 *    are its one colour, and the brush restains them where they already
 *    are ({@link colorScopeWritesPaintIsland});
 *  • an engine FIGURE (`kind: 'figure'`) has nothing for it: those quads
 *    are posed, not coloured.
 */
export function colorScopeReaches(
  scope: ColorScope, ref: CompItemRef, host: HostPaintReach | null = null,
): boolean {
  if (scope === 'any') return colorAimFor(scope, ref, host) !== null;
  if (ref.kind === 'text' || ref.kind === 'paint') return colorScopeWritesPaintIsland('color', scope);
  if (ref.kind === 'image') return scope === 'fills';
  if (ref.kind === 'pattern') return scope === 'patterns' || scope === 'strokes';
  if (ref.kind !== 'svg') return false;
  if (host?.ids.has(ref.item.id)) return host.reaches(ref.item.id, scope);
  const svg = ref.item;
  if (scope === 'patterns') return !!svg.patternFill;
  if (scope === 'strokes') return svg.segments.length > 0;
  if (svg.tileMode) return false;
  if (svgIsFilled(svg) && !svg.isPatternFill) return true;
  return Array.isArray(svg.subpaths) && fillSubpathRanges(svg.subpaths).length > 0;
}

/**
 * The ONE surface an aim at `scope` writes on this object: the scope
 * itself for a surface aim, and for 'any' the first surface in
 * {@link ANY_COLOR_PRIORITY} the object has — null when it has none (an
 * engine figure). A surface aim is returned as-is, whether
 * or not it reaches; asking that is colorScopeReaches' job.
 */
export function colorAimFor(
  scope: ColorScope, ref: CompItemRef, host: HostPaintReach | null = null,
): ColorSurface | null {
  if (scope !== 'any') return scope;
  return ANY_COLOR_PRIORITY.find((s) => colorScopeReaches(s, ref, host)) ?? null;
}

/** What {@link colorScopeReaches} asks of the host about its own nodes: the
 *  nodes it answers for, and whether an aim reaches one — the reach half of
 *  {@link HostPaintTargets}. */
export type HostPaintReach = Pick<HostPaintTargets, 'ids' | 'reaches'>;

/** The installed host's reach over `state` — null with no host, or a page
 *  with none of its nodes. */
export function hostPaintReach(state: CompositionState): HostPaintReach | null {
  return sessionHost().nodes?.paintTargets?.(state, 'any') ?? null;
}

/**
 * The scope the recolour brush should be aimed at with `targets` in hand:
 * the aim it already has whenever that reaches any of them, and otherwise
 * the first aim in capsule order that reaches something — Strokes, then
 * Fills, then Patterns.
 *
 * Any rather than every: a selection of several things is aimed at as a
 * whole, and an aim that lands on some of them is an aim that does
 * something. An empty selection, or one with no colour the brush can
 * rewrite at all (an engine figure), leaves the aim exactly where it was —
 * there is nothing better to point it at, and a brush that re-aimed itself
 * for no reason would lose an aim the user took.
 *
 * A node the HOST answers for is re-aimed like anything else: Patterns over
 * CozyJournal's rig is an aim at nothing (it has volumes and outlines, no
 * cloth), so the capsule drops onto Strokes — which is why the brush never
 * meets one under an aim it cannot write. `host` is the host's reach over
 * the page (`hostPaintReach`).
 */
export function reaimedColorScope(
  scope: ColorScope, targets: readonly CompItemRef[], host: HostPaintReach | null = null,
): ColorScope {
  if (targets.length === 0) return scope;
  const reaches = (s: ColorScope) => targets.some((t) => colorScopeReaches(s, t, host));
  return reaches(scope) ? scope : COLOR_SURFACES.find(reaches) ?? scope;
}

// ── Stroke interpolation ────────────────────────────────────────────
// A pointer stream is a sequence of samples, not a path: at 60–120 Hz a
// finger moving at any speed skips whole brush-widths between events, and a
// brush that stamps once per event lays a row of dots. Every dab of a stroke
// is therefore walked in along the segment from the last one — the same rule
// for paint, erase and blur, since all three stamp through one gesture.

/** Gap between stamps, as a fraction of the brush radius. Half-radius leaves
 *  the point midway between two dabs at ~0.84 alpha from each, so the pair
 *  composites to ~0.97 there and the stroke reads solid. Tightening to a
 *  quarter buys ~0.998 — invisible — at twice the stamps, and the vector
 *  brush hit-tests the scene on every one of them. */
export const PAINT_STAMP_SPACING = 0.5;

/** Hard ceiling on the dabs one pointer event may fan out into. A dropped
 *  frame, a stall, or a finger flung across the page can otherwise ask for
 *  hundreds of stamps in a single handler and jank the very frame that is
 *  already late. Past this the stroke is drawn coarser rather than slower. */
export const PAINT_MAX_STEPS_PER_MOVE = 64;

/**
 * The points to stamp for a move from `from` to `to` — the gap walked in at
 * {@link PAINT_STAMP_SPACING} of `radiusCells`, always ending exactly on
 * `to` so the stroke tracks the finger with no lag. `from` is excluded: it
 * was stamped by the event that reported it.
 *
 * A first dab (no previous point) is just `[to]`, which is what makes a tap
 * without a drag still leave a single dab.
 */
export function paintStampPoints(
  from: readonly [number, number] | null,
  to: readonly [number, number],
  radiusCells: number,
): [number, number][] {
  if (!from) return [[to[0], to[1]]];
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dist = Math.hypot(dx, dy);
  const spacing = Math.max(radiusCells * PAINT_STAMP_SPACING, 1e-6);
  const steps = Math.min(PAINT_MAX_STEPS_PER_MOVE, Math.max(1, Math.ceil(dist / spacing)));
  const points: [number, number][] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    points.push([from[0] + dx * t, from[1] + dy * t]);
  }
  return points;
}

// ── Brush size ───────────────────────────────────────────────────────
//
// The raster brush's radius is one grid step (compSnapStep) scaled by the
// floating brush-size slider. The slider hands over a 0–1 position; the
// mapping onto a multiplier lives here so the control stays a dumb picker.

/** Slider position that means "the unscaled grid-step radius" — dead center,
 *  so the default brush is exactly what it was before the slider existed and
 *  there is equal travel toward finer and broader. */
export const BRUSH_SIZE_DEFAULT = 0.5;

/** The multiplier at the slider's left end: a twelfth of the grid step —
 *  three times finer than the ¼× the slider first shipped with, for the
 *  hairlines the raster brush was too blunt to draw. */
export const BRUSH_SCALE_MIN = 1 / 12;
/** The multiplier at the slider's right end. */
export const BRUSH_SCALE_MAX = 4;

/** Slider position (0–1) → multiplier on the grid-step brush radius.
 *  Exponential on each side of center — {@link BRUSH_SCALE_MIN} at 0 up to
 *  1× at center, then up to {@link BRUSH_SCALE_MAX} at 1 — so within a half
 *  each equal slide multiplies the radius by the same factor, which is how
 *  size changes read visually (a 2px→4px step matters as much as
 *  20px→40px). The two halves run at different rates: the fine half packs
 *  a 12× range into the same travel the broad half spends on 4×, which
 *  keeps the default and the broad end exactly where they always were. */
export function brushRadiusScale(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped < BRUSH_SIZE_DEFAULT
    ? BRUSH_SCALE_MIN * Math.pow(1 / BRUSH_SCALE_MIN, clamped / BRUSH_SIZE_DEFAULT)
    : Math.pow(BRUSH_SCALE_MAX, (clamped - BRUSH_SIZE_DEFAULT) / (1 - BRUSH_SIZE_DEFAULT));
}

// ── Random: a stroke that drifts through colour ─────────────────────
//
// The 'randomize' blend mode is the stroke's randomness, not the pixel's. A
// dab does not roll its own colour — the STROKE carries one, walking it
// smoothly toward a fresh random target every {@link RANDOM_WALK_FRAMES}
// dabs, so a drag lays a line that drifts through colour instead of a spray
// of confetti. Each press starts a new walk on a new colour.

/** Dabs one leg of the walk takes. Ten is short enough that a quick flick
 *  still changes colour and long enough that a slow drag reads as a drift
 *  rather than a flicker. */
export const RANDOM_WALK_FRAMES = 10;

/** A stroke's colour walk: the leg it is on, and how far along it. */
export interface RandomColorWalk {
  from: RGBColor;
  to: RGBColor;
  /** Dabs into the current leg, 0 … RANDOM_WALK_FRAMES − 1. */
  step: number;
}

/** `rand` is injectable so the walk is testable; it defaults to Math.random
 *  and must return [0, 1). */
export type RandomSource = () => number;

function randomColor(rand: RandomSource): RGBColor {
  return {
    r: Math.floor(rand() * 256),
    g: Math.floor(rand() * 256),
    b: Math.floor(rand() * 256),
  };
}

/** A fresh walk — "a new random colour on each press", plus the target it is
 *  already heading for. */
export function createRandomColorWalk(rand: RandomSource = Math.random): RandomColorWalk {
  return { from: randomColor(rand), to: randomColor(rand), step: 0 };
}

/**
 * The colour for the next dab, advancing the walk by one frame.
 *
 * Returns where the walk stands NOW and then steps: the first dab of a
 * stroke is exactly its starting colour, and the leg's last dab lands one
 * frame short of the target — because the roll-over makes that target the
 * next leg's start, so the line is continuous across legs with no repeated
 * colour and no jump.
 */
export function advanceRandomColorWalk(
  walk: RandomColorWalk,
  rand: RandomSource = Math.random,
): RGBColor {
  const t = walk.step / RANDOM_WALK_FRAMES;
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  const color = {
    r: mix(walk.from.r, walk.to.r),
    g: mix(walk.from.g, walk.to.g),
    b: mix(walk.from.b, walk.to.b),
  };
  walk.step += 1;
  if (walk.step >= RANDOM_WALK_FRAMES) {
    walk.from = walk.to;
    walk.to = randomColor(rand);
    walk.step = 0;
  }
  return color;
}

// ── Paint islands: the raster brush's scene objects ─────────────────
//
// The 'paint' tool's strokes land in PAINT ISLAND scene objects (engine
// PaintObject): sparse raster tiles with a transparent background, living
// in sceneOrder like any other node. Strokes group into islands by
// SESSION — a continuous run of the colors tool group — plus a spatial
// rule: painting far from the session island starts a new one.

/** How far (world cells, point-to-rect) a stroke may start from the session
 *  island's content and still join it. One full allocation tile: a gap that
 *  wide means at least one fully-empty 64 KB tile would separate the blobs,
 *  and it comfortably exceeds any brush radius (compSnapStep), so a
 *  continuation of the same drawing always lands inside it. */
export const PAINT_SESSION_FAR_CELLS = CANVAS_ISLAND_CELLS;

/** Which island the next 'paint' stroke goes into: `paintId` null = mint a
 *  fresh island at commit. `over` names the LOCKED island the stroke started
 *  on — the one it would have combined with but for the lock — so the mint
 *  seats directly above it in z (its dried paint neither masks the dabs nor
 *  ends up over the new ink). */
export interface PaintSessionTarget {
  paintId: string | null;
  over?: string;
}

/**
 * Stroke-start resolution of the target island. The SESSION island wins
 * when it still holds: the id resolves, the island is visible, unlocked and
 * still a pure TRANSLATION of its tile space (paintObjectTranslation — a
 * moved island keeps taking strokes, with every dab offset into its frame;
 * rotate/mirror/scale/group break the 1:1 map, so the brush's round world
 * dabs could no longer stamp exactly, and those end the session), and the
 * stroke starts within {@link PAINT_SESSION_FAR_CELLS} of its world content
 * rect ("far" = a different drawing).
 *
 * Failing that, RASTER-OVER-RASTER COMBINES: a stroke that starts on an
 * existing island's ink (within the brush radius, topmost island first)
 * continues that island rather than minting a fresh one below it — new
 * spray lands ON dried paint, it doesn't slide underneath. A MOVED island
 * is dried paint too, so it takes the stroke through the same offset;
 * only translation-frame islands are eligible, same rule as the session.
 * A LOCKED island can't take the paint, but the stroke still lands ON it:
 * the target is fresh with `over` naming the lock, and the mint seats
 * above it (createPaintObjectStrokeState binds the deposit's z there).
 *
 * Only then is the target fresh (`paintId` null = mint at commit).
 */
export function resolvePaintSessionTarget(
  state: CompositionState,
  sessionPaintId: string | null,
  startCellX: number,
  startCellY: number,
  radiusCells: number,
): PaintSessionTarget {
  const lockedGroups = lockedGroupIds(state.groups);
  if (sessionPaintId) {
    const island = (state.paintObjects ?? []).find((p) => p.id === sessionPaintId);
    if (island && !island.hidden && !lockedUnder(island, lockedGroups)
      && paintObjectTranslation(island)) {
      const dx = Math.max(island.cellX - startCellX, 0, startCellX - (island.cellX + island.cellWidth));
      const dy = Math.max(island.cellY - startCellY, 0, startCellY - (island.cellY + island.cellHeight));
      if (Math.hypot(dx, dy) <= PAINT_SESSION_FAR_CELLS) return { paintId: sessionPaintId };
    }
  }
  const paints = state.paintObjects ?? [];
  if (paints.length > 0) {
    const byId = new Map(paints.map((p) => [p.id, p]));
    const graph = graphOf(state);
    /** Does the stroke start on this island's ink? Asked in the island's
     *  OWN frame (sceneHitFrame), so a locked island inside a stretched
     *  bound group answers for the parallelogram it is drawn as, and the
     *  world radius comes in through the frame's length factor. */
    const startsOnInk = (p: PaintObject): boolean => {
      const d = drawnLeaf(graph, p.id);
      if (!d) return false;
      const frame = leafHitFrame(d.node, d.world);
      const [lx, ly] = frame.toLocal(startCellX, startCellY);
      return paintObjectAlphaHitTest(
        frame.object as PaintObject, lx, ly, radiusCells * frame.lengthScale,
      );
    };
    for (let i = state.sceneOrder.length - 1; i >= 0; i--) {
      const p = byId.get(state.sceneOrder[i]);
      if (!p || p.hidden) continue;
      if (lockedUnder(p, lockedGroups)) {
        // Dried paint that can't be added to: the stroke lands over it.
        if (startsOnInk(p)) return { paintId: null, over: p.id };
        continue;
      }
      // Translation-only also excludes grouped islands, so a hidden group
      // can never capture a stroke through this branch.
      if (!paintObjectTranslation(p)) continue;
      if (startsOnInk(p)) return { paintId: p.id };
    }
  }
  return { paintId: null };
}

/** One island the erase/blur passes may touch, resolved once at stroke
 *  start (the scene cannot change mid-stroke): its inverse frame, its bbox
 *  center for the cull, and a lazily-created working set (erase/blur never
 *  allocate, so no budget applies). */
interface PaintIslandTarget {
  island: PaintObject;
  frame: PaintLocalFrame;
  cx: number;
  cy: number;
  /** World-cell cull reach about (cx, cy): the frame's bbox half-diagonal at
   *  stroke start, EXTENDED as dabs land — push and blur carry paint beyond
   *  the bbox the island was framed to, and a cull frozen at stroke start
   *  would freeze that paint one brush-width past the old edge (see
   *  forEachTargetUnderDab). */
  reach: number;
  working: CanvasPaintWorking | null;
}

/**
 * Per-stroke paint-island accumulator, riding beside the engine draft like
 * the other bitmap layers. Two halves:
 *
 *  - `session` ('paint' tool, normal mode): the working set of the island
 *    the session continues — or of a brand-new island when `paintId` is
 *    null. Session islands are translation frames by invariant, so the
 *    brush stamps world coordinates shifted by the island's offset
 *    (`worldDx`/`worldDy` — zero until the island has been moved).
 *  - `targets` ('erase'/'blur'/'push', and 'paint' under a non-normal blend
 *    mode): every island under the stroke may take the dab, topmost
 *    included — today's erase-anywhere feel, and what makes a blend stroke
 *    modify the colour under the cursor no matter which island holds it.
 *    Dabs are mapped through each island's inverse frame, so a
 *    rotated/scaled island takes them where its pixels appear on screen.
 *
 * `dirty` narrows the live preview's redraw to exactly the stamped tiles,
 * keyed by island id ('' = the session island); `rev` bumps whenever any
 * stamp changes bytes. Committed by buildPaintStroke as placeObject /
 * replaceScene ops.
 */
export interface PaintObjectStrokeState {
  session: {
    paintId: string | null;
    working: CanvasPaintWorking;
    /** The island's tile→world offset (paintObjectTranslation): dabs stamp
     *  at world − offset, and the commit / preview put the tiles back at
     *  tile + offset. (0, 0) for a fresh or never-moved island — then tile
     *  space IS world space, exactly as before. */
    worldDx: number;
    worldDy: number;
  } | null;
  targets: PaintIslandTarget[];
  /** The stroke's spray-paint occlusion stack (sceneOcclusion.ts), or null
   *  when the stroke runs unoccluded (erase/blur, or a selection filter —
   *  an explicit target is painted even under other objects). Owns the
   *  fresh-island insertion index buildPaintStroke reads at commit. */
  occlusion: SceneOcclusion | null;
  /** The island stamp's per-texel deposit mask, bound to the session
   *  target's z — built once at stroke start beside `occlusion`. */
  mask: CanvasPaintStampMask | null;
  /** Island id ('' = the session island) → tile keys whose bytes changed
   *  since the preview last drew. The preview redraws exactly these, then
   *  clears the sets. */
  dirty: Map<string, Set<string>>;
  rev: number;
  /** True for the PUSH and BLUR brushes: their dabs carry paint outside the
   *  ink bounds the island was framed to (a smear drags it, a blur feathers
   *  it outward), so the commit re-frames each touched island around what it
   *  now holds. Every other brush leaves the frame where it is (a stamp
   *  lands inside the session island's own growth path; erase can only take
   *  away). */
  grow?: boolean;
  /** True for the COLOR brush: its dabs restain the paint under them in
   *  every blend mode, 'normal' included — mutate-only, like a non-normal
   *  paint stroke, so the recolour brush never lays raster of its own. */
  recolor?: boolean;
}

/**
 * Seed the stroke's paint-island state, resolved once at stroke start.
 *
 * `'paint'` in NORMAL mode with no selection filter: the session half is
 * armed — a working set over the session island's committed tiles (or over
 * nothing for a fresh island; the plane is sparse, so nothing is cloned or
 * allocated until a dab lands). Its byte budget is the global tile budget
 * minus every OTHER island's committed bytes, so the cap spans the whole
 * document.
 *
 * With a selection: the selection is the brush's object filter — and when
 * it names a paint ISLAND, that island is the explicit deposit target: the
 * session half arms on it (topmost when several are selected, the
 * raster-over-raster rule) and the stroke deposits into it in FULL — fresh
 * ink included, merging and growing the island exactly as an unselected
 * session stroke would. The selection decides which OBJECT the paint lands
 * in (no other island is touched and no fresh island is minted), not which
 * pixels may change: an island left selected by a move must still take a
 * plain new stroke. A selection naming no eligible island (or only a
 * rotated / mirrored / scaled one, whose frame can't take exact dabs — the
 * session invariant) still returns null: the object passes are all that's
 * active.
 *
 * `'paint'` under a NON-NORMAL blend mode runs targets-style instead (see
 * the branch below): mutate-only dabs act on every island under the brush,
 * so blending never depends on which island a stroke was associated with.
 * `'color'` runs the same way in EVERY mode, marked `recolor`: the recolour
 * brush restains the paint under it (normal sets the brush colour, the
 * other modes blend it) and deposits nothing. Null when no island is there
 * to touch — the caller also leaves it out when the colour scope does not
 * reach raster ({@link colorScopeWritesPaintIsland}).
 *
 * `'erase'` / `'blur'` / `'push'`: every visible, unlocked island is a
 * target — the session island included when it exists, so "erase anywhere"
 * keeps feeling like the single layer it replaced. A selection narrows the
 * targets to the selected islands (none selected → no island pass). Push
 * and blur additionally mark the state `grow`: both can carry paint past
 * the bounds their islands were framed to.
 *
 * `occlusion` (the 'paint' tool, unfiltered) is the stroke's spray-paint
 * stack: the island mask is bound here to the target's z — the session
 * island's sceneOrder index, or {@link FRESH_ISLAND_ORDER} for a mint,
 * which puts every visible object above the deposit. A mint OVER a locked
 * island (PaintSessionTarget.over) binds to that island's index instead:
 * only what sits above the lock masks the dabs, and the blockers recorded
 * there put the commit's splice above it too. Erase and blur lift
 * and soften what is THERE regardless of what sits above it, so they never
 * take one.
 *
 * Returns null when the stroke has no island work at all.
 */
export function createPaintObjectStrokeState(
  state: CompositionState,
  kind: PaintToolKind,
  session: PaintSessionTarget | null,
  filterIds: Set<string> | null,
  occlusion: SceneOcclusion | null = null,
  blendMode: BlendMode = 'normal',
): PaintObjectStrokeState | null {
  const base = {
    dirty: new Map<string, Set<string>>(),
    rev: 0,
    occlusion: null as SceneOcclusion | null,
    mask: null as CanvasPaintStampMask | null,
  };
  if (kind === 'color') {
    // The recolour brush is the non-normal branch below in every mode: the
    // same targets, the same unmasked mutate-only stamp — flagged so a
    // NORMAL dab restains too instead of depositing. No occlusion: the
    // brush's object passes run unoccluded, and so does its island half.
    const targets = resolveIslandTargets(state, filterIds);
    return targets.length === 0 ? null : { ...base, session: null, targets, recolor: true };
  }
  if (kind === 'paint' && blendMode !== 'normal') {
    // A non-normal 'paint' stroke is MUTATE-ONLY (see stampCanvasPaint): it
    // edits the colour of paint that already exists and deposits nothing —
    // so the island it happens to be "associated with" must not matter. It
    // targets EVERY island under the dab, exactly as the eraser does, and
    // the user never has to know how their strokes were partitioned: dodge
    // over two disjoint blobs brightens both, multiply over stacked islands
    // darkens what is there. Mapped through each island's frame, so a
    // transformed island blends where its pixels appear. A selection
    // narrows the targets to the selected islands, the erase rule.
    //
    // The session half stays out — there is nothing for it to deposit — but
    // the occlusion stack rides along: the OBJECT passes still read it off
    // this state for their spray-paint weights, so it must survive even
    // when no island exists at all (targets may be empty).
    return { ...base, session: null, targets: resolveIslandTargets(state, filterIds), occlusion };
  }
  if (kind === 'paint') {
    // A SELECTED island is an explicit deposit target (see the doc above):
    // the session half arms on it instead of the session ref's island. A
    // selection naming no eligible island keeps the old rule — the object
    // passes are all that runs, and the island half sits the stroke out.
    const selected = filterIds ? selectedPaintIsland(state, filterIds) : null;
    if (filterIds ? !selected : !session) return null;
    const paintId = selected ? selected.id : session!.paintId;
    const over = selected ? undefined : session!.over;
    const island = selected ?? (paintId
      ? (state.paintObjects ?? []).find((p) => p.id === paintId)
      : undefined);
    // Budget: the global cap minus what every OTHER island already holds.
    // The session island's own bytes are counted by the working set itself
    // (createCanvasPaintWorking seeds `bytes` from its base list).
    let otherBytes = 0;
    for (const p of state.paintObjects ?? []) {
      if (p.id !== paintId) otherBytes += canvasPaintBytes(p.tiles);
    }
    const maxBytes = Math.max(0, CANVAS_PAINT_MAX_BYTES - otherBytes);
    const anchor = paintId ?? over;
    const targetOrder = anchor
      ? occlusion?.orderOf(anchor) ?? FRESH_ISLAND_ORDER
      : FRESH_ISLAND_ORDER;
    // A continued island that has been MOVED still has tile→world = one
    // offset (the resolver only hands over translation frames): dabs stamp
    // at world − offset, and the occlusion mask's tile origins are shifted
    // back to world so stencils above the island mask the right texels.
    const { dx: worldDx, dy: worldDy } = (island && paintObjectTranslation(island)) ?? { dx: 0, dy: 0 };
    // A SELECTED island takes the FULL stroke, bare canvas included — the
    // selection says which object the paint lands IN, not which pixels may
    // change, so a normal stroke on a selected island reads exactly like
    // painting it unselected: fresh ink deposits, merges and grows the
    // island's frame at commit. (Masking those dabs to the committed alpha
    // was the "can only retouch existing ink" bug: after a move — which
    // leaves the island selected — no new stroke could land on it.) An
    // explicitly targeted island also paints unoccluded, the erase rule —
    // the caller passes no occlusion stack for a filtered stroke, so the
    // mask below is null on that path.
    const rawMask = occlusion ? occlusion.islandMask(targetOrder) : null;
    const mask = rawMask && (worldDx || worldDy)
      ? {
          forIsland: (key: string, texelCount: number, originX: number, originY: number) =>
            rawMask.forIsland(key, texelCount, originX + worldDx, originY + worldDy),
        }
      : rawMask;
    return {
      ...base,
      session: {
        paintId,
        working: createCanvasPaintWorking(island?.tiles, maxBytes),
        worldDx, worldDy,
      },
      targets: [],
      occlusion,
      mask,
    };
  }
  if (kind === 'erase' || kind === 'blur' || kind === 'push') {
    const targets = resolveIslandTargets(state, filterIds);
    if (targets.length === 0) return null;
    // Push and blur both carry paint past the bounds their islands were
    // framed to — a smear drags it there, a blur feathers it outward — so
    // both mark the state `grow` and the commit re-frames what they touch.
    return { ...base, session: null, targets, ...(kind !== 'erase' ? { grow: true } : {}) };
  }
  return null;
}

/** The island a SELECTION hands the deposit half: the topmost selected
 *  paint object (the raster-over-raster rule — spray lands on the paint
 *  the eye sees) that can take exact dabs — visible, unlocked (its own flag
 *  or a frame's), outside hidden groups, and a translation frame (the session invariant; a
 *  rotated / mirrored / scaled island cannot stamp round dabs exactly).
 *  Null when the selection names no such island. */
function selectedPaintIsland(
  state: CompositionState,
  filterIds: Set<string>,
): PaintObject | null {
  const paints = state.paintObjects ?? [];
  if (paints.length === 0) return null;
  const hidden = hiddenGroupIds(state.groups);
  const locked = lockedGroupIds(state.groups);
  const byId = new Map(paints.map((p) => [p.id, p]));
  for (let i = state.sceneOrder.length - 1; i >= 0; i--) {
    const p = byId.get(state.sceneOrder[i]);
    if (!p || !filterIds.has(p.id)) continue;
    if (p.hidden || lockedUnder(p, locked)) continue;
    if (p.groupId && hidden.has(p.groupId)) continue;
    if (!paintObjectTranslation(p)) continue;
    return p;
  }
  return null;
}

/** Every island a targets-style stroke may touch: visible, unlocked (its own
 *  flag or a frame's — see lockedUnder), not in
 *  a hidden group, narrowed by the selection filter — with its inverse frame
 *  and cull centre resolved once (the scene cannot change mid-stroke). */
function resolveIslandTargets(
  state: CompositionState,
  filterIds: Set<string> | null,
): PaintIslandTarget[] {
  const hidden = hiddenGroupIds(state.groups);
  const locked = lockedGroupIds(state.groups);
  const graph = graphOf(state);
  const targets: PaintIslandTarget[] = [];
  for (const p of state.paintObjects ?? []) {
    if (p.hidden || lockedUnder(p, locked)) continue;
    if (p.groupId && hidden.has(p.groupId)) continue;
    if (filterIds && !filterIds.has(p.id)) continue;
    const d = drawnLeaf(graph, p.id);
    if (!d) continue;
    const frame = islandTileFrame(d);
    const aabb = drawnAabb(d);
    targets.push({
      island: p,
      frame,
      // The cull rides the world AABB the graph draws, so a turned or
      // sheared island is culled around what it covers.
      cx: aabb.x + aabb.width / 2,
      cy: aabb.y + aabb.height / 2,
      reach: frame.cullRadius,
      working: null,
    });
  }
  return targets;
}

/** The shared walk of a targets-style stroke's islands under one dab: cull
 *  by centre distance, map the dab through the island's inverse frame, hand
 *  `apply` the tile-space point and scaled radius, and record what changed.
 *  Erase / blur / smudge / blend all agree on coverage through this. */
function forEachTargetUnderDab(
  ps: PaintObjectStrokeState,
  cellX: number,
  cellY: number,
  radiusCells: number,
  apply: (t: PaintIslandTarget, tx: number, ty: number, radius: number) => string[],
): boolean {
  let changed = false;
  for (const t of ps.targets) {
    const dx = cellX - t.cx;
    const dy = cellY - t.cy;
    const reach = t.reach + radiusCells;
    if (dx * dx + dy * dy > reach * reach) continue;
    const [tx, ty] = t.frame.toTile(cellX, cellY);
    if (recordPaintChange(ps, t.island.id, apply(t, tx, ty, radiusCells * t.frame.radiusScale))) {
      changed = true;
      // The dab changed this island, and push/blur may have carried its
      // paint out to the dab's own rim — extend the cull there, so the
      // NEXT dab of the drag still finds the island however far the stroke
      // has walked its paint from the bbox it started with (the same
      // re-centering the push brush's svg targets do).
      const walked = Math.sqrt(dx * dx + dy * dy) + radiusCells;
      if (walked > t.reach) t.reach = walked;
    }
  }
  return changed;
}

/** Record a stamp's changed tiles into the stroke state's dirty map and rev
 *  counter; true when anything changed. `id` is '' for the session island. */
function recordPaintChange(ps: PaintObjectStrokeState, id: string, changed: string[]): boolean {
  if (changed.length === 0) return false;
  let set = ps.dirty.get(id);
  if (!set) {
    set = new Set();
    ps.dirty.set(id, set);
  }
  for (const key of changed) set.add(key);
  ps.rev++;
  return true;
}

/** Island pass of one raster-brush stamp: blend the brush color into the
 *  session island's tiles — allocating fresh ones where the dab lands on
 *  empty space, which is what makes painting effectively infinite. Session
 *  islands are translation frames by invariant (tile space == world space
 *  up to the island's move offset), so the dab's world coordinates stamp
 *  in shifted by that offset alone.
 *
 *  An island renders source-over into the scene, so the stroke's blend mode
 *  cannot act at composite time the way a per-object overlay's does. It
 *  acts HERE instead — and MUTATE-ONLY: a non-normal dab edits the color of
 *  paint that already exists (dodge brightens the stroke under the brush)
 *  and deposits nothing on bare canvas; only 'normal' lays new paint down.
 *  A non-normal stroke therefore runs targets-style (session null) against
 *  EVERY island under the dab rather than the session's alone — painting
 *  must feel like one continuous canvas, however the strokes were
 *  partitioned. See the blending section of engine/imagePaintOverlay.ts.
 *
 *  The stroke's occlusion mask (when armed) weights every texel by what the
 *  scene above the island lets through: nothing deposits under an opaque
 *  object, a 0.75-opacity object passes 0.25 of the stroke — spray paint
 *  falling past stencils onto the canvas. */
export function stampPaintObjectBrush(
  ps: PaintObjectStrokeState,
  draft: PaintStrokeDraft,
  cellX: number,
  cellY: number,
  radiusCells: number,
): boolean {
  // Invert keeps its full hand: a half-invert is just a gray drift that a
  // second stroke can never undo (the vector pass has the same carve-out).
  const alpha = draft.blendMode === 'invert'
    ? draft.opacity
    : blendStrength(draft.blendMode, draft.opacity);
  if (!ps.session) {
    // Targets-style stroke: a non-normal blend mode, or the recolour brush
    // in any mode (`recolor` — see createPaintObjectStrokeState). Mutate the colour of
    // whatever paint sits under the dab on EVERY island — the stroke never
    // knows or cares how the paint was partitioned (see the blend branch of
    // createPaintObjectStrokeState). Unmasked, like the eraser: it acts on
    // what is there. Each island's working set keeps its own per-stroke
    // unary scratch, so invert and rotate still rewrite each texel once
    // per stroke. That scratch is the ENGINE's own (canvasPaint's
    // `unaryDone`), and it still counts random among the unary modes: a
    // raster texel is not a surface that owns a colour, and the vector
    // change above does not reach it.
    return forEachTargetUnderDab(ps, cellX, cellY, radiusCells, (t, tx, ty, radius) =>
      stampCanvasPaint(
        targetWorking(t), tx, ty, radius, draft.brushColor, alpha,
        { mode: draft.blendMode, recolor: ps.recolor },
      ));
  }
  // A moved session island: the dab lands where the finger is on SCREEN, so
  // its tile coordinates are world − the island's translation offset ((0,0)
  // for a fresh or in-frame island — then this is the plain stamp it always
  // was). Round dabs stay round and the radius carries 1:1: translation is
  // the one transform the session survives.
  return recordPaintChange(ps, '', stampCanvasPaint(
    ps.session.working,
    cellX - ps.session.worldDx, cellY - ps.session.worldDy,
    radiusCells, draft.brushColor, alpha,
    { mode: draft.blendMode },
    ps.mask ?? undefined,
  ));
}

/** The working set for one erase/blur target, cloned lazily on first touch. */
function targetWorking(t: PaintIslandTarget): CanvasPaintWorking {
  if (!t.working) t.working = createCanvasPaintWorking(t.island.tiles);
  return t.working;
}

/** The write fence for a dab that can carry paint outward (push's smear,
 *  blur's feathering): an island whose frame cannot be re-framed around more
 *  content (a rotated one — engine paintObjectCanGrow) is fenced to its
 *  content rect, so paint carried past it piles up in view instead of
 *  vanishing outside the rect it is drawn through. Undefined — no fence —
 *  for a growable island. */
function targetGrowBounds(
  t: PaintIslandTarget,
): { x: number; y: number; w: number; h: number } | undefined {
  return paintObjectCanGrow(t.island) ? undefined : {
    x: t.island.contentX, y: t.island.contentY,
    w: t.island.contentW, h: t.island.contentH,
  };
}

/** Island pass of one eraser stamp: lift paint off EVERY island under the
 *  dab (the stroke's targets — see createPaintObjectStrokeState), each dab
 *  inverse-mapped through the island's frame with the radius scaled to
 *  match, so a transformed island erases where its pixels appear. Never
 *  allocates. */
export function erasePaintObjectBrush(
  ps: PaintObjectStrokeState,
  draft: PaintStrokeDraft,
  cellX: number,
  cellY: number,
  radiusCells: number,
): boolean {
  return forEachTargetUnderDab(ps, cellX, cellY, radiusCells, (t, tx, ty, radius) =>
    eraseCanvasPaint(targetWorking(t), tx, ty, radius, draft.opacity));
}

/** Island pass of one blur stamp: soften the paint under the dab, one
 *  box-blur step per dab per island under it. Same targeting/mapping as the
 *  eraser — but unlike it the blur SPREADS: a softened edge feathers
 *  outward, across tile seams and into fresh tiles the engine pass
 *  allocates, so what the user sees is one continuous wash going soft, with
 *  no trace of how it was tiled. Islands whose frame cannot grow (rotated)
 *  are fenced to their content rect, like the push brush's. */
export function blurPaintObjectBrush(
  ps: PaintObjectStrokeState,
  draft: PaintStrokeDraft,
  cellX: number,
  cellY: number,
  radiusCells: number,
): boolean {
  return forEachTargetUnderDab(ps, cellX, cellY, radiusCells, (t, tx, ty, radius) =>
    blurCanvasPaint(targetWorking(t), tx, ty, radius, draft.opacity, targetGrowBounds(t)));
}

/** Extra factor on the ISLAND half of a push. The strength knob is shared
 *  by everything the brush moves, but at the same setting the raster smear
 *  read far weaker than the vector and rig halves under the same drag —
 *  each texel drifts by `travel × strength × falloff`, and the falloff eats
 *  most of it. Clamped to 1 at the point of use: the smear reads strength
 *  as a fraction of the dab's own travel, and past 1 texels would outrun
 *  the finger. */
const RASTER_PUSH_BOOST = 2;

/** Island pass of one PUSH dab: smear each island's texels along the drag.
 *  Same targeting and inverse mapping as the eraser, plus the travel — which
 *  is a WORLD delta and has to reach tile space as one, so it is mapped as
 *  the difference of two mapped points rather than scaled, the only way it
 *  comes out right through a rotated or mirrored island's frame.
 *
 *  The shared strength arrives boosted here (RASTER_PUSH_BOOST): the raster
 *  colour takes a stronger hand than the geometry halves.
 *
 *  An island whose frame cannot be re-framed around more content (a rotated
 *  one — see engine paintObjectCanGrow) is fenced to its content rect, so
 *  paint smeared at its edge piles up in view instead of vanishing outside
 *  the rect it is drawn through. */
export function smudgePaintObjectBrush(
  ps: PaintObjectStrokeState,
  cellX: number,
  cellY: number,
  radiusCells: number,
  dxCells: number,
  dyCells: number,
  strength: number,
): boolean {
  const rasterStrength = Math.min(1, strength * RASTER_PUSH_BOOST);
  return forEachTargetUnderDab(ps, cellX, cellY, radiusCells, (t, tx, ty, radius) => {
    const [px, py] = t.frame.toTile(cellX - dxCells, cellY - dyCells);
    return smudgeCanvasPaint(
      targetWorking(t), tx, ty, radius, rasterStrength,
      tx - px, ty - py, targetGrowBounds(t),
    );
  });
}

/** The stroke's per-island results for the commit: each touched target's
 *  id and working set (untouched targets are skipped — their islands ride
 *  through the entry by reference). */
export function touchedPaintTargets(
  ps: PaintObjectStrokeState,
): { id: string; working: CanvasPaintWorking }[] {
  const out: { id: string; working: CanvasPaintWorking }[] = [];
  for (const t of ps.targets) {
    if (t.working && ps.dirty.has(t.island.id)) out.push({ id: t.island.id, working: t.working });
  }
  return out;
}

/** Falloff-weighted average of a set of colors — the local target a blur
 *  stamp pulls each member toward. Fractional channels are intentional:
 *  blendColor rounds once at the end, not per average. */
function weightedAverage(entries: { color: RGBColor; w: number }[]): RGBColor | null {
  let r = 0, g = 0, b = 0, w = 0;
  for (const e of entries) {
    r += e.color.r * e.w;
    g += e.color.g * e.w;
    b += e.color.b * e.w;
    w += e.w;
  }
  return w > 0 ? { r: r / w, g: g / w, b: b / w } : null;
}

/** A fresh, empty stroke draft in the engine's shape. `brushColor` is the
 *  editor's active color; mode + opacity come from the color picker's brush
 *  controls. */
export function createPaintStrokeDraft(
  brushColor: RGBColor,
  blendMode: BlendMode,
  opacity: number,
): PaintStrokeDraft {
  return {
    brushColor: { ...brushColor },
    blendMode,
    opacity,
    paintedSegments: new Map(),
    paintedFigures: new Map(),
    paintedFills: new Map(),
    svgSnapshots: new Map(),
    figureSnapshots: new Map(),
  };
}

/** The color-group brushes — the 'color' recolour brush and the raster four
 *  — are the tools a SELECTION filters rather than yields to (the inverse of
 *  canvasTap's toolYieldsToSelection): with one armed, the selection is the
 *  brush's object filter (paintFilterIds below). While that filter is in
 *  force the canvas drops a dark veil over everything BUT the selection
 *  (see the paint-dim mask in CanvasSurface), so "only this can be painted"
 *  is visible before the first stroke. */
export function brushDimsToSelection(tool: string | null): boolean {
  return tool === 'color' || tool === 'paint' || tool === 'erase'
    || tool === 'blur' || tool === 'push';
}

/** Facet preserves the selection when the color tool takes over, so the
 *  brush paints ONLY the selected objects; with nothing selected it paints
 *  everything. Null = unfiltered. */
export function paintFilterIds(
  selectedId: string | null,
  selectedIds: readonly string[],
): Set<string> | null {
  if (selectedIds.length >= 2) return new Set(selectedIds);
  return selectedId ? new Set([selectedId]) : null;
}

/** Objects a stroke must never touch, resolved once at stroke start: members
 *  of hidden groups (invisible content must not change under the brush).
 *  The canvas adds the frame boundary rects on top — a frame's background
 *  surface is not tap-selectable and is recolored from the frame Background
 *  picker, not by brushing across the page. */
export function paintHiddenIds(state: CompositionState): Set<string> {
  const hidden = hiddenGroupIds(state.groups);
  const ids = new Set<string>();
  for (const svg of state.svgObjects) {
    if (svg.hidden || (svg.groupId && hidden.has(svg.groupId))) ids.add(svg.id);
  }
  for (const text of state.texts ?? []) {
    if (text.hidden || (text.groupId && hidden.has(text.groupId))) ids.add(text.id);
  }
  for (const img of state.images ?? []) {
    if (img.hidden || (img.groupId && hidden.has(img.groupId))) ids.add(img.id);
  }
  for (const p of state.patternObjects ?? []) {
    if (p.hidden || (p.groupId && hidden.has(p.groupId))) ids.add(p.id);
  }
  for (const p of state.paintObjects ?? []) {
    if (p.hidden || (p.groupId && hidden.has(p.groupId))) ids.add(p.id);
  }
  return ids;
}

/** A node's EFFECTIVE lock, against a set from `lockedGroupIds`: its own
 *  `locked` flag, or a lock inherited from a frame above it. */
function lockedUnder(
  node: { locked?: boolean; groupId?: string },
  lockedGroups: ReadonlySet<string>,
): boolean {
  return (node.locked ?? false)
    || (node.groupId !== undefined && lockedGroups.has(node.groupId));
}

/**
 * Objects a stroke must never CHANGE because they are LOCKED, resolved once
 * at stroke start: the node's own `locked` flag, or the lock of any frame
 * above it — engine `isItemLocked`'s rule, that locking a frame makes every
 * member act as locked without touching the members' own flags.
 *
 * Every other edit path (move, resize, delete, recolor) reads that effective
 * lock; the brush passes read only each node's OWN field, so a stroke — a
 * dodge or a burn especially, which mutate whatever colour is under the
 * cursor — went straight through a locked frame and recoloured its members.
 *
 * Kept SEPARATE from {@link paintHiddenIds} rather than folded into it,
 * because the two mean different things to the spray-paint stack: a hidden
 * object is not there and cannot stencil a dab, while a locked one is fully
 * visible and still does. Only the hidden set is handed to
 * buildSceneOcclusion.
 */
export function paintLockedIds(state: CompositionState): Set<string> {
  const locked = lockedGroupIds(state.groups);
  const ids = new Set<string>();
  for (const svg of state.svgObjects) if (lockedUnder(svg, locked)) ids.add(svg.id);
  for (const text of state.texts ?? []) if (lockedUnder(text, locked)) ids.add(text.id);
  for (const img of state.images ?? []) if (lockedUnder(img, locked)) ids.add(img.id);
  for (const p of state.patternObjects ?? []) if (lockedUnder(p, locked)) ids.add(p.id);
  return ids;
}

/**
 * Is there ANYTHING on this page the recolour brush could write on?
 *
 * The recolour brush is the one brush that adds nothing (ToolId 'color'):
 * it rewrites the colour of what is already under it, so on a page with
 * nothing it can reach, every stroke is a drag that does nothing and
 * leaves nothing on screen to say why. The editor says so instead — see
 * NO_PAINTABLES_HINT.
 *
 * "Could" means any of the three aims, not the one the capsule is on: the
 * brush re-aims itself at what is in hand ({@link reaimedColorScope}), so
 * a page of nothing but line art is paintable even while the capsule
 * reads Fills. The nodes it can never write are skipped for the same
 * reasons a stroke skips them — HIDDEN (invisible content must not change
 * under the brush) and a frame's boundary rect, which is the page's own
 * background surface and is recoloured from the frame's Background picker
 * rather than by brushing across it.
 *
 * A LOCKED object still counts. The hint says the page has nothing the
 * brush paints, and a page of locked shapes has plenty — they are held,
 * not absent, and unlocking one is a tap away. Read as "nothing here",
 * the hint sat over a page full of drawings (a day's locked template, a
 * turn's handed-over canvas) naming the wrong reason the stroke did
 * nothing.
 *
 * Engine figures and paint islands are not asked about: `colorScopeReaches`
 * answers no for both, and their arrays can be skipped outright. A node the
 * HOST answers for is asked about through the host's reach (a rig is an svg
 * on that array, and the brush writes its record's two colours), resolved
 * once here.
 */
export function hasPaintableObjects(state: CompositionState): boolean {
  const hidden = paintHiddenIds(state);
  const host = hostPaintReach(state);
  const boundaries = new Set<string>();
  for (const mask of buildFrameRectMap(state).values()) boundaries.add(mask.id);
  const paintable = (ref: CompItemRef): boolean =>
    !hidden.has(ref.item.id) && !boundaries.has(ref.item.id)
    && COLOR_SURFACES.some((scope) => colorScopeReaches(scope, ref, host));
  for (const item of state.svgObjects) if (paintable({ kind: 'svg', item })) return true;
  for (const item of state.texts ?? []) if (paintable({ kind: 'text', item })) return true;
  for (const item of state.images ?? []) if (paintable({ kind: 'image', item })) return true;
  for (const item of state.patternObjects ?? []) if (paintable({ kind: 'pattern', item })) return true;
  for (const item of state.paintObjects ?? []) if (paintable({ kind: 'paint', item })) return true;
  return false;
}

/** What the canvas says while the recolour brush is armed over a page it
 *  cannot write on (the hint itself is components/NoPaintablesHint.tsx). */
export const NO_PAINTABLES_HINT = 'No paintable objects';

// ── Shared bbox-node brush geometry ────────────────────────────────

/** The fields a node the brush culls by carries: its world box, as the
 *  legacy view spells it (a first, conservative reject before the frame
 *  is resolved). */
export interface BboxNodeLike {
  cellX: number;
  cellY: number;
  cellWidth: number;
  cellHeight: number;
}

/** A node's LOCAL content frame off the scene graph — the box its content
 *  is authored in (the overlay bitmap's, the text layout's) — plus the
 *  inverse of its world matrix, so the brush centre can be tested in that
 *  frame. The same frame the node layer draws through (drawnPose), so a
 *  dab lands on the texel it appears over, under any turn, flip, scale or
 *  group shear. A scale is not an isometry: the brush radius carries over
 *  by `radiusScale`. */
export interface BboxLocalFrame {
  /** Local content frame dims, cells. */
  iw: number;
  ih: number;
  toLocal(cellX: number, cellY: number): [number, number];
  /** Conservative cull radius about the world box centre: half the world
   *  AABB's diagonal. */
  cullRadius: number;
  /** World → local length factor (the inverse of the matrix's uniform
   *  scale): multiply a world brush radius by this before testing in the
   *  frame. 1 for an unscaled node. */
  radiusScale: number;
}

export function bboxLocalFrame(d: DrawnLeaf): BboxLocalFrame {
  // The engine's hit frame IS this frame — inverse world matrix, local
  // box, one length factor — so it is asked rather than re-derived, and a
  // brush and a tap can no longer disagree about where a node's content
  // is. The only difference left is the origin: a brush measures its
  // content from the box's own corner (an overlay bitmap's 0,0), while the
  // hit frame answers in the node's local coordinates.
  const frame = leafHitFrame(d.node, d.world);
  const { box, aabb } = frame;
  return {
    iw: box.width,
    ih: box.height,
    toLocal(px: number, py: number): [number, number] {
      const [lx, ly] = frame.toLocal(px, py);
      return [lx - box.x, ly - box.y];
    },
    cullRadius: Math.hypot(aabb.width, aabb.height) / 2,
    radiusScale: frame.lengthScale,
  };
}

/**
 * An island's world → TILE frame, off the graph: the node's own frame
 * (above) followed by the one stretch onto its content rect
 * (`paintTileFrame`).
 *
 * This is what `paintLocalFrame` says, with the pose half read from the
 * scene graph instead of re-derived from the legacy box + rotation +
 * mirror + angle. It is exact where those fields are not: an island inside
 * a bound group that has been stretched is drawn as a parallelogram, and a
 * box plus an angle can only name the nearest rectangle around it.
 */
export function islandTileFrame(d: DrawnLeaf): PaintLocalFrame {
  const f = bboxLocalFrame(d);
  const tile = paintTileFrame(d.node.content as PaintObject, f.iw, f.ih);
  return {
    toTile(cellX: number, cellY: number): [number, number] {
      const [lx, ly] = f.toLocal(cellX, cellY);
      return tile.toTile(lx, ly);
    },
    radiusScale: f.radiusScale * tile.radiusScale,
    cullRadius: f.cullRadius,
  };
}

// ── Text: per-character brush geometry ─────────────────────────────

/** One paintable character: code-point index into the node's content plus
 *  its box in the node's LAYOUT space (the inner, pre-transform box the DOM
 *  layer positions lines in), world cell units. */
export interface TextCharBox {
  ci: number;
  ch: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A text node's brushable geometry, resolved once per stroke: every
 *  character's layout-space box, plus the inverse of the node transform so
 *  the brush center can be tested in that space (rotation and mirror are
 *  isometries, so the brush radius carries over unchanged). */
export interface TextPaintGeometry {
  chars: Map<number, TextCharBox>;
  toLocal(cellX: number, cellY: number): [number, number];
  /** Conservative cull radius: half the world AABB's diagonal. */
  cullRadius: number;
  /** World → local length factor for the brush radius (see
   *  {@link BboxLocalFrame.radiusScale}). */
  radiusScale: number;
}

/** Per-stroke text accumulator: blended color per touched character (text id
 *  → code-point index; null = the eraser cleared the character's tint back
 *  to the node color), plus the stroke's geometry cache. The engine's
 *  PaintStrokeDraft has no slot for text (Facet scenes carry none), so this
 *  rides beside it the way the bitmap layers do, committed by
 *  buildPaintStroke as setTextStyle ops. */
export interface TextPaintState {
  chars: Map<string, Map<number, RGBColor | null>>;
  geom: Map<string, TextPaintGeometry>;
}

export function createTextPaintState(): TextPaintState {
  return { chars: new Map(), geom: new Map() };
}

/**
 * Where a glyph's INK sits in its layout box: the probe the text pass reads
 * so a dab lands on the letter, not the whole box. Implemented by the app
 * over its own text measurer (its web/fonts/glyphInk.ts) and installed with
 * {@link setGlyphInk}; null when there is nothing to measure with (no
 * canvas, a face still loading) — the caller keeps the whole box then. A
 * glyph with no ink at all comes back zero-sized.
 */
export type GlyphInkFn = (
  ch: string, style: TextStyle, boxW: number, lineHeight: number,
) => { x: number; y: number; w: number; h: number } | null;

/** Where each character's INK sits in its layout box (the app's web/fonts/glyphInk),
 *  registered by the app beside the text measurer. Null — a node suite, or
 *  before the fonts load — keeps every character's whole box. */
let glyphInk: GlyphInkFn | null = null;

export function registerGlyphInk(fn: GlyphInkFn | null): void {
  glyphInk = fn;
}

/**
 * Build a text node's brush geometry. Layout is the DOM node layer's own
 * (drawnTextLayout — same layoutText call, same measurer, the node's
 * CONTENT style in its LOCAL box), so the boxes sit where the glyphs
 * render; per-char offsets come from lineCharBoxes and the inverse node
 * transform from the shared {@link bboxLocalFrame}.
 *
 * Each box is then shrunk to the glyph's own INK (registerGlyphInk): the
 * layout box is the advance across the whole line height, mostly air, and
 * a brush circle that cleared every glyph still overlapped it — so a
 * stroke passing just above a line recoloured it. A glyph with no ink
 * (a tab, a zero-width joiner) has nothing to colour and is left out.
 */
export function textPaintGeometry(d: DrawnLeaf): TextPaintGeometry {
  const { text, layout, lineHeight } = drawnTextLayout(d);
  const style = text.style;
  const chars = new Map<number, TextCharBox>();
  for (const line of layout.lines) {
    const boxes = lineCharBoxes(line.text, style);
    const glyphs = Array.from(line.text);
    for (let i = 0; i < boxes.length; i++) {
      if (glyphs[i] === ' ') continue; // spaces have no ink to color
      const ink = glyphInk?.(glyphs[i], style, boxes[i].width, lineHeight) ?? null;
      if (ink !== null && (ink.w <= 0 || ink.h <= 0)) continue;
      chars.set(line.start + i, {
        ci: line.start + i,
        ch: glyphs[i],
        x: line.x + boxes[i].x + (ink?.x ?? 0),
        y: line.y + (ink?.y ?? 0),
        w: ink?.w ?? boxes[i].width,
        h: ink?.h ?? lineHeight,
      });
    }
  }
  const frame = bboxLocalFrame(d);
  return { chars, toLocal: frame.toLocal, cullRadius: frame.cullRadius, radiusScale: frame.radiusScale };
}

/** Effective color character `ci` currently renders at. */
export function effectiveCharColor(text: TextObject, ci: number): RGBColor {
  return text.style.charColors?.[ci] ?? text.style.color;
}

/**
 * The stroke's brushwork on one text as a `charColors` list for the live
 * preview: every touched character at the colour the stroke has blended it
 * to, every other one null (the preview inherits a TRANSPARENT base colour,
 * so an untouched glyph draws nothing over itself). The eraser's null mark
 * previews at the node colour — exactly what the commit renders once the
 * override is dropped (buildPaintStroke). Indices past the content are
 * ignored, as the commit ignores them.
 */
export function previewCharColors(
  text: TextObject,
  painted: ReadonlyMap<number, RGBColor | null>,
): (RGBColor | null)[] {
  const len = Array.from(text.content).length;
  const out: (RGBColor | null)[] = new Array(len).fill(null);
  for (const [ci, color] of painted) {
    if (ci < 0 || ci >= len) continue;
    out[ci] = color ?? text.style.color;
  }
  return out;
}

/** Text pass of one brush stamp: blend every character whose layout box the
 *  brush overlaps, with the same falloff / unary-mode rules as segments.
 *  The eraser clears touched characters' tints back to the node color
 *  (bucket value null) — only ones that HAVE a tint, committed or from this
 *  stroke. Blur pulls each touched character toward the falloff-weighted
 *  average of THIS text's touched characters — one node's colors only.
 *  Stickers never paint — their ink is the card scheme's, not the style's. */
function stampPaintTexts(
  state: CompositionState,
  graph: SceneGraph,
  draft: PaintStrokeDraft,
  textPaint: TextPaintState,
  cellX: number,
  cellY: number,
  radiusCells: number,
  filterIds: Set<string> | null,
  skipIds: Set<string>,
  kind: PaintBrushKind,
  occlusion: SceneOcclusion | null,
): boolean {
  const { brushColor, blendMode: mode, opacity } = draft;
  const strength = blendStrength(mode, opacity);
  const unary = isUnaryMode(mode);
  let painted = false;

  for (const text of state.texts ?? []) {
    if (text.locked || text.sticker) continue;
    if (skipIds.has(text.id)) continue;
    if (filterIds && !filterIds.has(text.id)) continue;
    // The eraser only ever CLEARS tints, so a text with none committed and
    // none painted this stroke has nothing for it to do.
    if (kind === 'erase' && !text.style.charColors && !textPaint.chars.has(text.id)) continue;
    // Center-distance cull with the half-diagonal, valid under any rotation.
    const ccx = text.cellX + text.cellWidth / 2;
    const ccy = text.cellY + text.cellHeight / 2;
    let geom = textPaint.geom.get(text.id);
    const cull = geom?.cullRadius ?? Math.hypot(text.cellWidth, text.cellHeight) / 2;
    if (Math.hypot(cellX - ccx, cellY - ccy) > radiusCells + cull) continue;
    // Spray-paint fall-through: this text takes only what the objects above
    // it let past at the dab center (see stampPaintBrush).
    const weight = occlusion ? occlusion.weightFor(text.id, cellX, cellY) : 1;
    if (weight <= 0) continue;

    if (!geom) {
      const drawn = drawnLeaf(graph, text.id);
      if (!drawn) continue;
      geom = textPaintGeometry(drawn);
      textPaint.geom.set(text.id, geom);
    }
    const [lx, ly] = geom.toLocal(cellX, cellY);
    // The brush disc in the node's own cells: a scaled node sees it smaller.
    const localRadius = radiusCells * geom.radiusScale;
    const radiusSq = localRadius * localRadius;

    let bucket = textPaint.chars.get(text.id);
    // Blur is two-phase: collect this node's touched characters first, then
    // pull each toward their shared average — computed before any of them
    // moves, so the pass can't cascade into itself within one stamp.
    const blurHits: { ci: number; color: RGBColor; w: number }[] = [];
    for (const box of geom.chars.values()) {
      // Distance to the nearest point of the char box, so large glyphs take
      // paint anywhere on their body, not just near their center.
      const nx = Math.max(box.x, Math.min(lx, box.x + box.w));
      const ny = Math.max(box.y, Math.min(ly, box.y + box.h));
      const distSq = (lx - nx) * (lx - nx) + (ly - ny) * (ly - ny);
      if (distSq > radiusSq) continue;
      const falloff = gaussianFalloff(distSq / radiusSq);
      if (falloff <= 0) continue;
      if (kind === 'erase') {
        // Clear the character's tint — if it has one (committed, or painted
        // earlier in this stroke). No partial erase: a char color is one
        // value, not a bitmap, so the falloff can't thin it.
        const cur = bucket?.has(box.ci)
          ? bucket.get(box.ci)!
          : text.style.charColors?.[box.ci] ?? null;
        if (cur === null) continue;
        if (!bucket) {
          bucket = new Map();
          textPaint.chars.set(text.id, bucket);
        }
        bucket.set(box.ci, null);
        painted = true;
        continue;
      }
      if (kind === 'blur') {
        const base = bucket?.get(box.ci) ?? effectiveCharColor(text, box.ci);
        blurHits.push({ ci: box.ci, color: base, w: falloff });
        continue;
      }
      if (!bucket) {
        bucket = new Map();
        textPaint.chars.set(text.id, bucket);
      }
      if (unary) {
        if (bucket.has(box.ci)) continue;
        const passOpacity = mode === 'invert' ? 1 : strength;
        const was = effectiveCharColor(text, box.ci);
        const out = blendColor(was, brushColor, mode, passOpacity);
        bucket.set(box.ci, out);
        if (!sameColor(was, out)) painted = true;
        continue;
      }
      const base = bucket.get(box.ci) ?? effectiveCharColor(text, box.ci);
      const out = blendColor(base, brushColor, mode, strength * falloff * weight);
      bucket.set(box.ci, out);
      if (!sameColor(base, out)) painted = true;
    }

    // Blur apply: with a single character under the cursor the average IS
    // its color — nothing to soften, so the stamp deposits nothing.
    if (blurHits.length >= 2) {
      const avg = weightedAverage(blurHits)!;
      if (!bucket) {
        bucket = new Map();
        textPaint.chars.set(text.id, bucket);
      }
      for (const hit of blurHits) {
        bucket.set(hit.ci, blendColor(hit.color, avg, 'normal', opacity * hit.w));
        painted = true;
      }
    }
  }

  return painted;
}

// ── Patterns: per-cell brush geometry ──────────────────────────────
//
// A pattern object is line art like any curve, and takes the brush the same
// way — except that what it draws is baked from a grid of CELLS, so the unit
// the brush colors is a cell rather than a path segment. Each cell carries
// its own ink (`CellState.tintR/G/B`), which the bake writes into that
// tile's strokes, so a brushed cell keeps its shape and changes only color.
//
// This rides beside the engine draft exactly as the text pass does: the
// draft's `paintedSegments` is keyed by flat SEGMENT index against a stored
// segment list, and a pattern's segments are derived — re-baked from the
// cells on every edit — so there is no stable index there to key on.

/** Re-exported from the engine, where the pattern tool also needs it: the
 *  ink an UNTINTED cell draws in is the base every blend starts from AND
 *  the tint that canonicalizes back to none (see tintedPatternCell). */
export { PATTERN_BASE_INK };

/** Per-stroke pattern accumulator: the color each touched cell will end up
 *  drawing in (pattern id → flat cell index; null = the eraser lifted the
 *  brushed tint back off, leaving the cell its base ink). Committed by
 *  buildPaintStroke as one `editPatternCells` op per pattern. */
export interface PatternPaintState {
  cells: Map<string, Map<number, RGBColor | null>>;
  /** Bumped for a pattern whenever a stamp changed one of its cells. The
   *  canvas previews a recolor by RE-BAKING the pattern, which is millisecond
   *  work against an 11ms frame — so it re-bakes only what actually moved,
   *  and a drag that stays inside cells it has already painted costs nothing. */
  rev: Map<string, number>;
}

export function createPatternPaintState(): PatternPaintState {
  return { cells: new Map(), rev: new Map() };
}

/** Re-exported from the engine beside PATTERN_BASE_INK: the colour a cell
 *  currently draws in is what a blend starts from HERE and what the Stroke
 *  swatch reads there, and one answer serves both. */
export { effectivePatternCellColor };

/**
 * Every tile grid one stamp may reach, in the order this pass walks them.
 *
 * Two things carry a grid, and the brush cannot tell them apart once it has
 * one in hand. A loose {@link PatternObject} is its own node. A closed
 * SHAPE's pattern FILL is the tile repeating inside its outline, which
 * `shapePatternGrid` dresses as a `PatternObject` in the shape's own box,
 * ADDRESSED BY THE SHAPE'S ID — the convention the ops (`editPatternCells`)
 * and the Tile tool already go by, so a fill is brushed, previewed and
 * committed by the very code a pattern object is, with no parallel path to
 * drift from it (engine/shapePatternFill.ts).
 *
 * The fills are the RECOLOUR brush's alone. The raster brushes already have
 * a target on a filled shape — its paint overlay, which `stampPaintShapes`
 * writes — and reaching its pattern cells from the same dab would be two
 * edits to one thing. 'color' lays no raster of its own (it only restains
 * paint islands already there), and its Patterns scope
 * is the aim that asks for exactly this surface, so it is the one kind for
 * which a shape's grid is what the brush is over.
 *
 * …and only under THAT aim. A pattern OBJECT answers to Strokes as well
 * (colorScopeWritesPatternObject — its cells' stroke is the only colour it
 * has), but a fill does not: the shape around it has a line of its own for
 * Strokes to mean, which the segment pass writes.
 */
function brushableGrids(
  state: CompositionState, kind: PaintBrushKind, scope: ColorScope,
  objectColor: ObjectColorState | null,
): PatternObject[] {
  const grids: PatternObject[] = [...(state.patternObjects ?? [])];
  if (kind !== 'color' || (scope !== 'patterns' && scope !== 'any')) return grids;
  for (const svg of state.svgObjects) {
    if (!svg.patternFill) continue;
    if (svg.locked || svg.hidden) continue;
    // Under 'any' the cloth is the shape's LAST choice: one with a fill or
    // a line takes the colour there instead.
    if (scope === 'any' && anyAimOfSvg(objectColor, svg) !== 'patterns') continue;
    const grid = shapePatternGrid(svg);
    if (grid) grids.push(grid);
  }
  return grids;
}

/**
 * Pattern pass of one brush stamp: blend every cell the brush disc covers,
 * with the same falloff, blend-mode and unary rules the segment and
 * character passes use.
 *
 * A 'color' cell is skipped — it IS a color rather than a tile drawn in one,
 * so brushing it would replace the thing instead of inking it. Empty cells
 * are skipped for the same reason there is nothing there to color.
 *
 * What a cell's ink IS, on either kind of grid, is the tiles' STROKE colour
 * — a tile is line art, and `effectivePatternCellColor` is the one reading
 * of it — so a pass over a patterned shape restains the cloth printed in it
 * and leaves the shape's own fill and outline exactly where they were.
 */
function stampPaintPatterns(
  state: CompositionState,
  draft: PaintStrokeDraft,
  patternPaint: PatternPaintState,
  cellX: number,
  cellY: number,
  radiusCells: number,
  filterIds: Set<string> | null,
  skipIds: Set<string>,
  kind: PaintBrushKind,
  occlusion: SceneOcclusion | null,
  scope: ColorScope,
  objectColor: ObjectColorState | null,
): boolean {
  const { brushColor, blendMode: mode, opacity } = draft;
  const strength = blendStrength(mode, opacity);
  const radiusSq = radiusCells * radiusCells;
  const unary = isUnaryMode(mode);
  let painted = false;

  for (const p of brushableGrids(state, kind, scope, objectColor)) {
    if (p.locked || p.hidden) continue;
    if (skipIds.has(p.id)) continue;
    if (filterIds && !filterIds.has(p.id)) continue;
    // Region AABB pre-reject, inflated by the radius (the svg pass's test).
    if (p.cellX + p.cellWidth + radiusCells < cellX - radiusCells) continue;
    if (p.cellX - radiusCells > cellX + radiusCells) continue;
    if (p.cellY + p.cellHeight + radiusCells < cellY - radiusCells) continue;
    if (p.cellY - radiusCells > cellY + radiusCells) continue;
    // Spray-paint fall-through: only what the objects above let past.
    const weight = occlusion ? occlusion.weightFor(p.id, cellX, cellY) : 1;
    if (weight <= 0) continue;

    const hits = patternCellsInBrush(p, cellX, cellY, radiusCells);
    if (hits.length === 0) continue;

    let bucket = patternPaint.cells.get(p.id);
    let touched = false;
    const ensure = () => {
      touched = true;
      if (!bucket) {
        bucket = new Map();
        patternPaint.cells.set(p.id, bucket);
      }
      return bucket;
    };
    // Blur is two-phase, as elsewhere: collect this pattern's touched cells
    // first, then pull each toward their shared average.
    const blurHits: { index: number; color: RGBColor; w: number }[] = [];

    for (const { index, distSq } of hits) {
      const cell = p.cells[index] ?? null;
      if (!cell || cell.type !== 'sprite') continue;
      const falloff = gaussianFalloff(distSq / radiusSq);
      if (falloff <= 0) continue;

      if (kind === 'erase') {
        // Lift the brushed ink back off — where there is one to lift. A
        // cell's tint is one value, not a bitmap, so there is no partial
        // erase for the falloff to thin.
        const cur = bucket?.has(index) ? bucket.get(index)! : patternCellTint(cell);
        if (cur === null) continue;
        ensure().set(index, null);
        painted = true;
        continue;
      }
      if (kind === 'blur') {
        const base = bucket?.get(index) ?? effectivePatternCellColor(p, index);
        blurHits.push({ index, color: base, w: falloff });
        continue;
      }
      if (unary) {
        if (bucket?.has(index)) continue;
        const passOpacity = mode === 'invert' ? 1 : strength;
        const was = effectivePatternCellColor(p, index);
        const out = blendColor(was, brushColor, mode, passOpacity);
        ensure().set(index, out);
        if (!sameColor(was, out)) painted = true;
        continue;
      }
      const base = bucket?.get(index) ?? effectivePatternCellColor(p, index);
      const out = blendColor(base, brushColor, mode, strength * falloff * weight);
      ensure().set(index, out);
      if (!sameColor(base, out)) painted = true;
    }

    // A single cell's average is its own color — nothing to soften.
    if (blurHits.length >= 2) {
      const avg = weightedAverage(blurHits)!;
      for (const hit of blurHits) {
        ensure().set(hit.index, blendColor(hit.color, avg, 'normal', opacity * hit.w));
        painted = true;
      }
    }
    if (touched) patternPaint.rev.set(p.id, (patternPaint.rev.get(p.id) ?? 0) + 1);
  }

  return painted;
}

// ── Images and solid shapes: the hidden low-res paint layer ────────

/** Per-stroke bitmap-layer accumulator: a working copy of each touched
 *  node's paint overlay (`rev` bumps whenever a stamp changes bytes, so the
 *  canvas preview knows when to re-encode), plus the stroke's frame cache.
 *  One instance per node kind (images, solid shapes) rides beside the
 *  engine draft the way text paint does; committed by buildPaintStroke as
 *  replaceScene swaps. */
export interface OverlayPaintState {
  overlays: Map<string, { overlay: ImagePaintOverlay; rev: number }>;
  frames: Map<string, BboxLocalFrame>;
}

export function createOverlayPaintState(): OverlayPaintState {
  return { overlays: new Map(), frames: new Map() };
}

/** Where a dab lands in a bbox node's OWN content frame, or null when it
 *  misses: the centre-distance cull, the frame resolve (cached per stroke)
 *  and the on-frame test, in the one place the passes that need them agree
 *  on. The overlay stamp works inside this frame; the Color brush only
 *  needs to know that the dab reached the node at all. */
function dabInNodeFrame(
  node: BboxNodeLike & { id: string },
  graph: SceneGraph,
  frames: Map<string, BboxLocalFrame>,
  cellX: number,
  cellY: number,
  worldRadius: number,
): { frame: BboxLocalFrame; lx: number; ly: number; radiusCells: number } | null {
  const ccx = node.cellX + node.cellWidth / 2;
  const ccy = node.cellY + node.cellHeight / 2;
  let frame = frames.get(node.id);
  const cull = frame?.cullRadius ?? Math.hypot(node.cellWidth, node.cellHeight) / 2;
  if (Math.hypot(cellX - ccx, cellY - ccy) > worldRadius + cull) return null;

  if (!frame) {
    const drawn = drawnLeaf(graph, node.id);
    if (!drawn) return null;
    frame = bboxLocalFrame(drawn);
    frames.set(node.id, frame);
  }
  const [lx, ly] = frame.toLocal(cellX, cellY);
  // The brush disc in the node's own cells: a scaled node sees it smaller.
  const radiusCells = worldRadius * frame.radiusScale;
  // The content covers the frame only — a brush wholly off it touches nothing.
  if (lx < -radiusCells || lx > frame.iw + radiusCells) return null;
  if (ly < -radiusCells || ly > frame.ih + radiusCells) return null;
  return { frame, lx, ly, radiusCells };
}

/** Does a disc at (lx, ly) reach the rectangle [0, w] × [0, h]? Exact: the
 *  distance to the rectangle's nearest point, against the radius. */
function discMeetsRect(lx: number, ly: number, r: number, w: number, h: number): boolean {
  const nx = Math.max(0, Math.min(lx, w));
  const ny = Math.max(0, Math.min(ly, h));
  return (lx - nx) * (lx - nx) + (ly - ny) * (ly - ny) <= r * r;
}

/** Stamp one brush dab into a bbox node's paint overlay: cull, map into the
 *  node's frame, seed the working copy on first touch (for the paint brush,
 *  the stroke's blend mode becomes the whole layer's — one bitmap can't mix
 *  modes), then paint the disc. Shared by the image and solid-shape passes.
 *  The eraser lifts alpha out of an EXISTING layer (nothing to seed when
 *  the node carries none) and never re-modes it; blur softens an existing
 *  layer in place (a box-blur step over the disc — the layer's own texels
 *  only), equally with nothing to do on a node that carries no paint. */
function stampNodeOverlay(
  node: BboxNodeLike & { id: string; paintOverlay?: ImagePaintOverlay },
  graph: SceneGraph,
  paint: OverlayPaintState,
  draft: PaintStrokeDraft,
  cellX: number,
  cellY: number,
  worldRadius: number,
  kind: PaintBrushKind,
  weight = 1,
): boolean {
  const { brushColor, blendMode: mode, opacity } = draft;
  const strength = blendStrength(mode, opacity);
  if (kind !== 'paint' && !node.paintOverlay && !paint.overlays.has(node.id)) return false;
  const hit = dabInNodeFrame(node, graph, paint.frames, cellX, cellY, worldRadius);
  if (!hit) return false;
  const { frame, lx, ly, radiusCells } = hit;

  let entry = paint.overlays.get(node.id);

  if (kind === 'erase' || kind === 'blur') {
    if (!entry) {
      // Working copy of the committed layer (immutable — undo entries hold
      // references into past scenes). Blend stays whatever it was.
      entry = { overlay: clonePaintOverlay(node.paintOverlay!), rev: 0 };
      paint.overlays.set(node.id, entry);
    }
    const touched = kind === 'erase'
      ? eraseImagePaintOverlay(entry.overlay, frame.iw, frame.ih, lx, ly, radiusCells, opacity)
      : blurImagePaintOverlay(entry.overlay, frame.iw, frame.ih, lx, ly, radiusCells, opacity);
    if (touched) {
      entry.rev++;
      return true;
    }
    return false;
  }

  let painted = false;
  if (!entry) {
    // First touch: work on a copy of the committed layer (undo entries hold
    // references into past scenes, so committed overlays are immutable).
    const overlay = node.paintOverlay
      ? clonePaintOverlay(node.paintOverlay)
      : createImagePaintOverlay(frame.iw, frame.ih, mode);
    const remoded = overlay.blend !== mode;
    overlay.blend = mode;
    entry = { overlay, rev: remoded ? 1 : 0 };
    paint.overlays.set(node.id, entry);
    if (remoded) painted = true;
  }
  if (stampImagePaintOverlay(
    entry.overlay, frame.iw, frame.ih, lx, ly, radiusCells, brushColor, strength * weight,
  )) {
    entry.rev++;
    painted = true;
  }
  return painted;
}

// ── The Color brush's whole-object half ────────────────────────────
//
// Two of the things the brush can reach have no smaller part that owns a
// colour: a photo, and a filled shape's interior. The paint brush answers
// that by laying a low-res bitmap over them — which is exactly the raster
// mark the COLOR brush is defined not to make. So Color writes the one
// colour field each of them already has instead: the image's tint layer
// (`ImageObject.tintFill`) and the shape's own fill (`SVGObject.fill`),
// both turned into a SOLID of the accumulated brush colour at commit
// (editorSession's asSolidFill, which keeps the layer's opacity, blend and
// retained gradient stops). One value per object per stroke, blended per
// dab at the whole-object strength the legacy fills have always used — no
// spatial falloff, because there is no space inside a single colour for a
// falloff to mean anything.

/** Per-stroke whole-object recolour accumulator: the solid each touched
 *  image's tint and each touched shape's fill ends the stroke at, and the
 *  HOST's pass over the nodes whose colour it keeps. Rides beside the engine
 *  draft the way the text and pattern states do (it has no slot for any of
 *  these), and is committed by buildPaintStroke as one setImageTintFill /
 *  setSVGFill per object and whatever the host's pass commits. */
export interface ObjectColorState {
  imageTints: Map<string, RGBColor>;
  shapeFills: Map<string, RGBColor>;
  /** What this stroke is aimed at (the scope capsule's pick — see
   *  {@link ColorScope}). It rides the Color brush's own state rather than
   *  the engine draft, which has no slot for it and is shared with the
   *  brushes that have no scope; resolved once at gesture start like every
   *  other brush setting. */
  scope: ColorScope;
  /** The host's pass over the nodes whose colour it keeps off the object
   *  (sessionHost.ts `HostPaintTargets` — CozyJournal's rig), resolved at
   *  the press (the scene cannot change mid-stroke). The svg pass skips its
   *  `ids` under every aim — recolouring a rig's baked silhouette changed a
   *  picture nobody sees — and the pass answers for them. Null with no host,
   *  or a page with none of its nodes. */
  host: HostPaintTargets | null;
  /** Under the 'any' aim, the one surface each svg the stroke has reached
   *  takes ({@link colorAimFor}), resolved at its first touch and kept for
   *  the stroke: the question walks fill subpaths, too dear to ask per dab,
   *  and an object must not switch surfaces mid-drag. */
  anyAims: Map<string, ColorSurface | null>;
}

/** The surface an svg takes under 'any', cached on the stroke's state when
 *  there is one. */
function anyAimOfSvg(objectColor: ObjectColorState | null, svg: SVGObject): ColorSurface | null {
  const cache = objectColor?.anyAims;
  let aim = cache?.get(svg.id);
  if (aim === undefined) {
    aim = colorAimFor('any', { kind: 'svg', item: svg });
    cache?.set(svg.id, aim);
  }
  return aim;
}

export function createObjectColorState(
  scope: ColorScope = DEFAULT_COLOR_SCOPE,
  state?: CompositionState,
): ObjectColorState {
  const host = state ? sessionHost().nodes?.paintTargets?.(state, scope) ?? null : null;
  return { imageTints: new Map(), shapeFills: new Map(), scope, host, anyAims: new Map() };
}

/** The single colour a shape's FILL currently reads as — the base a Color
 *  dab blends from, and what a picker opened on the shape should start at.
 *  A gradient has no one colour, so the shape's stroke colour stands in for
 *  it (the same answer the Fill bar's swatch falls back to); a pre-`fill`
 *  legacy `fillColor` reads back directly. */
export function shapeFillSolidColor(svg: SVGObject): RGBColor {
  if (svg.fill) return svg.fill.type === 'solid' ? svg.fill.solid : svg.color;
  return svg.fillColor ?? svg.color;
}

/** The single colour an image's TINT layer currently reads as, or null for
 *  an image carrying none (or a gradient one, which has no one colour). A
 *  first Color dab on such an image lands the brush colour itself rather
 *  than blending from an invented base: there is nothing there to blend
 *  with, and the default tint's own navy is not the photo's colour. */
export function imageTintSolidColor(img: ImageObject): RGBColor | null {
  const tint = img.tintFill;
  return tint && tint.type === 'solid' ? tint.solid : null;
}

/** Image pass of one brush stamp: paint the brush disc into each touched
 *  image's low-res overlay. The unary modes rewrite a base color in place
 *  and have no compositing equivalent, so the PAINT brush skips the bitmap
 *  layers entirely for them — the same way it leaves Facet's gradient fills
 *  alone; erase and blur don't consult the blend picker at all.
 *
 *  The COLOR brush takes the other road entirely (see the section above):
 *  no bitmap, one tint over the whole photo, accumulated in `objectColor`. */
function stampPaintImages(
  state: CompositionState,
  graph: SceneGraph,
  draft: PaintStrokeDraft,
  imagePaint: OverlayPaintState,
  cellX: number,
  cellY: number,
  radiusCells: number,
  filterIds: Set<string> | null,
  skipIds: Set<string>,
  kind: PaintBrushKind,
  occlusion: SceneOcclusion | null,
  objectColor: ObjectColorState | null,
): boolean {
  if (kind === 'paint' && paintBlendCss(draft.blendMode) === null) return false;
  if (kind === 'color' && !objectColor) return false;
  const { brushColor, blendMode: mode, opacity } = draft;
  const strength = blendStrength(mode, opacity);
  const unary = isUnaryMode(mode);
  let painted = false;
  for (const img of state.images ?? []) {
    if (img.locked) continue;
    if (skipIds.has(img.id)) continue;
    if (filterIds && !filterIds.has(img.id)) continue;
    const weight = occlusion ? occlusion.weightFor(img.id, cellX, cellY) : 1;
    if (weight <= 0) continue;
    if (kind === 'color') {
      const bucket = objectColor!.imageTints;
      // Unary modes are one go per object per stroke, as everywhere else.
      if (unary && bucket.has(img.id)) continue;
      // The whole photo takes the tint on ONE touch, so the touch has to be
      // real: the disc must reach the picture's rectangle, not merely the
      // square around the disc (dabInNodeFrame's cull, which is all the
      // bitmap brushes need — they paint the disc itself and nothing
      // outside it lands).
      const hit = dabInNodeFrame(img, graph, imagePaint.frames, cellX, cellY, radiusCells);
      if (!hit || !discMeetsRect(hit.lx, hit.ly, hit.radiusCells, hit.frame.iw, hit.frame.ih)) continue;
      const base = bucket.get(img.id) ?? imageTintSolidColor(img);
      // An untinted photo has no base to blend from: the first dab lands the
      // brush colour itself, and later dabs drift that.
      const next = base === null
        ? { ...brushColor }
        : blendColor(base, brushColor, mode, unary && mode === 'invert' ? 1 : strength * weight);
      bucket.set(img.id, next);
      if (base === null || !sameColor(base, next)) painted = true;
      continue;
    }
    if (stampNodeOverlay(img, graph, imagePaint, draft, cellX, cellY, radiusCells, kind, weight)) {
      painted = true;
    }
  }
  return painted;
}

/** Solid-shape pass: the same bitmap layer on the fill-bar shapes
 *  (rectangle / circle / polygon — `svgHasFill`), masked to the outline at
 *  render. Legacy `fillColor` shapes keep Facet's whole-fill blend (the
 *  engine draft's paintedFills) instead — one shape must not take both —
 *  and pattern tiles / pattern-fill masks have no interior of their own to
 *  paint.
 *
 *  A shape that COULD be filled but currently isn't is skipped too. Being
 *  fillable is not the same as having an interior: an unfilled rectangle is
 *  four lines, you can see the page through it, and the brush passing over
 *  should no more paint that hole than the empty page beside it. It looked
 *  especially wrong because the interior it painted was invisible until the
 *  shape was later filled, at which point the old strokes reappeared. The
 *  outline still takes ink through the segment pass, as any open path does.
 *
 *  The COLOR brush never reaches here: a shape's fill is one of the two
 *  whole-object colours it writes instead (see the section above), recorded
 *  by the segment pass, which already knows which shapes the dab touched. */
function stampPaintShapes(
  state: CompositionState,
  graph: SceneGraph,
  draft: PaintStrokeDraft,
  shapePaint: OverlayPaintState,
  cellX: number,
  cellY: number,
  radiusCells: number,
  filterIds: Set<string> | null,
  skipIds: Set<string>,
  kind: PaintBrushKind,
  occlusion: SceneOcclusion | null,
): boolean {
  if (kind === 'color') return false;
  if (kind === 'paint' && paintBlendCss(draft.blendMode) === null) return false;
  let painted = false;
  for (const svg of state.svgObjects) {
    if (svg.locked) continue;
    if (skipIds.has(svg.id)) continue;
    if (filterIds && !filterIds.has(svg.id)) continue;
    if (svg.fillColor || svg.isPatternFill || svg.tileMode === 'repeat') continue;
    if (!svgHasFill(svgSubtype(svg))) continue;
    if (!svgIsFilled(svg)) continue;
    const weight = occlusion ? occlusion.weightFor(svg.id, cellX, cellY) : 1;
    if (weight <= 0) continue;
    if (stampNodeOverlay(svg, graph, shapePaint, draft, cellX, cellY, radiusCells, kind, weight)) {
      painted = true;
    }
  }
  return painted;
}

/** One FILL subpath's flat-index range [start, end) plus its loop's AABB —
 *  what the brush needs to treat the fill as the single closed drawing it
 *  renders as. Cached per subpaths array: the reference is stable for an
 *  object's whole life between edits, so the resolve runs once, not per dab. */
interface FillSubpathRange {
  start: number;
  end: number;
  segments: readonly PathSegment[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const fillRangeCache = new WeakMap<readonly SVGSubpath[], FillSubpathRange[]>();

function fillSubpathRanges(subpaths: readonly SVGSubpath[]): FillSubpathRange[] {
  let ranges = fillRangeCache.get(subpaths);
  if (ranges) return ranges;
  ranges = [];
  let idx = 0;
  for (const sub of subpaths) {
    if (sub.fill) {
      const bb = arcBoundingBox(sub.segments);
      if (bb) {
        ranges.push({
          start: idx, end: idx + sub.segments.length, segments: sub.segments,
          minX: bb.minX, minY: bb.minY, maxX: bb.maxX, maxY: bb.maxY,
        });
      }
    }
    idx += sub.segments.length;
  }
  fillRangeCache.set(subpaths, ranges);
  return ranges;
}

/** The color the snapshot renders segment `idx` at — the same flat ordering
 *  `flattenSVGSegmentsWithColor` / `brushHitsSegments` walk (subpaths-only
 *  when subpaths are non-empty, main segments otherwise). */
function snapshotColorAt(
  snap: { color: RGBColor; subpaths?: { segments: unknown[]; color: RGBColor }[] },
  idx: number,
): RGBColor {
  if (Array.isArray(snap.subpaths) && snap.subpaths.length > 0) {
    let cursor = 0;
    for (const sub of snap.subpaths) {
      if (idx < cursor + sub.segments.length) return sub.color;
      cursor += sub.segments.length;
    }
  }
  return snap.color;
}

/**
 * Stamp the brush once at (cellX, cellY), accumulating into `draft` (engine
 * shape: painted segments + legacy `fillColor` fills), `textPaint`
 * (per-character text colors, committed as setTextStyle ops by
 * `buildPaintStroke`), and the two bitmap layers — `imagePaint` (each
 * touched image's low-res paint layer) and `shapePaint` (the same layer on
 * solid shapes, masked to their outline), committed as replaceScene swaps.
 * Returns true when the stamp painted anything, so the caller can skip a
 * preview refresh.
 *
 * Ported from Facet's handleColorPaintMove, minus the Facet-only branches:
 * no figures (Free Play scenes have none), no mask groups, no mid-stroke
 * figure expansion, and tiled patterns paint through the origin-tile wrap
 * (every repeated copy recolors together — the engine's whole-object mode).
 * The text / image / solid-shape passes are CozyJournal's own: Facet
 * compositions carry none of those.
 *
 * `kind` picks the brush (see {@link PaintBrushKind}): 'erase' lifts
 * deposited paint (overlay alpha, char tints) and leaves vector strokes
 * alone; 'blur' softens everything under the cursor toward its LOCAL
 * average — per object, never across objects — so a shape's outline can't
 * bleed into its fill and neighbors stay distinct; 'color' recolours and
 * only recolours, writing `objectColor` where 'paint' would have written a
 * bitmap (an image's tint, a shape's fill) — and writing exactly one kind
 * of surface per stroke, the one its `objectColor.scope` names (ColorScope:
 * fills, strokes or patterns — or under 'any', one surface per OBJECT).
 *
 * `occlusion` (the raster 'paint' tool's spray-paint stack, null for the
 * standalone object brushes) makes the stack behave physically: each object
 * takes only the share of the dab the objects ABOVE it let through, sampled
 * at the dab center — an opaque top object takes the whole dab and the one
 * under it nothing; a 0.75-opacity top object lets 0.25 fall through. The
 * per-dab-center sample is the right granularity: the falloff these passes
 * apply is per dab too.
 */
export function stampPaintBrush(
  state: CompositionState,
  draft: PaintStrokeDraft,
  textPaint: TextPaintState,
  imagePaint: OverlayPaintState,
  shapePaint: OverlayPaintState,
  cellX: number,
  cellY: number,
  radiusCells: number,
  filterIds: Set<string> | null,
  skipIds: Set<string>,
  kind: PaintBrushKind = 'paint',
  occlusion: SceneOcclusion | null = null,
  patternPaint: PatternPaintState | null = null,
  objectColor: ObjectColorState | null = null,
): boolean {
  const { brushColor, blendMode: mode, opacity } = draft;
  const strength = blendStrength(mode, opacity);
  const unary = isUnaryMode(mode);
  let painted = false;
  // What the COLOR brush is aimed at this stroke, resolved once per dab —
  // this runs at pointer rate, and the four passes below ask three times.
  // Every other kind writes whatever it always wrote (colorScopeWrites is
  // true for them throughout).
  const scope = objectColor?.scope ?? DEFAULT_COLOR_SCOPE;
  const writesFills = colorScopeWrites(kind, scope, 'fills');
  const writesStrokes = colorScopeWrites(kind, scope, 'strokes');
  const writesPatternGrids = colorScopeWritesPatternObject(kind, scope);

  // Every pass maps the dab into each node's own frame off the scene graph
  // (a session state carries one; a bare state gets one built here).
  const graph = graphOf(state);

  for (const svg of state.svgObjects) {
    if (kind === 'erase') break; // segment recolors are permanent — see PaintBrushKind
    // An SVG owns a fill and a stroke and nothing else: aimed at patterns,
    // the Color brush has no business in this pass at all — and walking it
    // anyway snapshotted every shape the drag crossed for writes that could
    // never come.
    if (!writesFills && !writesStrokes) break;
    // A node the HOST answers for (a rig's silhouette is a bake the live
    // sketch draws over, so recolouring it changes a picture nobody sees):
    // the Color brush writes through the host's pass instead — under every
    // aim, including the one that writes nothing there.
    if (kind === 'color' && objectColor?.host?.ids.has(svg.id)) continue;
    if (svg.locked) continue;
    if (skipIds.has(svg.id)) continue;
    if (filterIds && !filterIds.has(svg.id)) continue;
    // Cull on a disc: the shape is drawn turned by its `angleDeg` about the
    // stored box's centre, so that box's half-diagonal holds it whatever the
    // turn.
    if (Math.hypot(cellX - (svg.cellX + svg.cellWidth / 2), cellY - (svg.cellY + svg.cellHeight / 2))
      > radiusCells + Math.hypot(svg.cellWidth, svg.cellHeight) / 2) continue;
    // Spray-paint fall-through (see the doc above): fully covered at the
    // dab center = this object takes nothing from this dab.
    const weight = occlusion ? occlusion.weightFor(svg.id, cellX, cellY) : 1;
    if (weight <= 0) continue;
    // Under 'any' this shape takes ONE surface — its fill if it has one,
    // else its line; one whose only colour is its cloth is the pattern
    // pass's (brushableGrids), not this one's.
    let svgFills = writesFills;
    let svgStrokes = writesStrokes;
    if (kind === 'color' && scope === 'any') {
      const aim = anyAimOfSvg(objectColor, svg);
      svgFills = aim === 'fills';
      svgStrokes = aim === 'strokes';
      if (!svgFills && !svgStrokes) continue;
    }

    // A shape that HAS a fill takes the PAINT brush on that fill, never on
    // its outline: painting a filled rectangle means colouring the
    // rectangle, and recolouring its border as well would restyle an object
    // the stroke of which the user never aimed at. The outline is the target
    // only when there is no fill to take the paint — an open path, or a
    // closed one left unfilled. (The fill itself is painted by the passes
    // below: the bitmap layer for a Fill-bar shape, the whole-object blend
    // for a legacy `fillColor` one.)
    //
    // COLOR takes both, because for it they are the same size of edit: the
    // fill becomes the brush colour and so does every border segment the
    // brush actually crossed. Nothing is being laid ON the shape there — the
    // shape's own two colour fields are being set — so "you coloured more
    // than you aimed at" cannot happen the way a stray bitmap stroke can,
    // and a border you never touched keeps its colour regardless.
    const filled = svgIsFilled(svg);
    // COLOR takes the outline when — and only when — it is aimed at
    // strokes; its scope is the aim the `kind === 'color'` clause used to
    // stand in for, back when the brush took the fill and the border in one
    // pass and neither could be asked for alone.
    const outlineTakesInk = kind === 'color' ? svgStrokes : !filled;

    // Every test below runs in the shape's OWN frame (sceneHitFrame), the
    // one it is drawn through. The stored `segments` are the path before its
    // free turn (`angleDeg`), so testing the dab against them hit a twisted
    // shape where its upright twin would be — a fan of rectangles all turned
    // about one centre shares one upright bar, and a dab on that bar
    // recoloured every blade at once while the blades it visibly crossed
    // took nothing. The local path keeps the stored path's segment order,
    // so a hit's `idx` still names the same segment of `svg`.
    const drawn = drawnLeaf(graph, svg.id);
    const frame = drawn ? leafHitFrame(drawn.node, drawn.world) : null;
    const local = (frame?.object ?? svg) as SVGObject;
    const [lx, ly] = frame ? frame.toLocal(cellX, cellY) : [cellX, cellY];
    const localRadius = radiusCells * (frame?.lengthScale ?? 1);
    const radiusSq = localRadius * localRadius;
    const hits = brushHitsSegments(local, lx, ly, localRadius);

    // FILL SUBPATHS (figure-bake painted cells, filled merges) are each one
    // closed drawing in one color — the brush treats them the way it treats
    // a legacy `fillColor`: touched as a unit, colored as a unit, with no
    // per-segment falloff. Touched means a segment hit on the loop OR the
    // dab center landing INSIDE it — a filled interior visibly catches the
    // spray (the occlusion stack stencils the canvas out of it), so a dab
    // there must color the fill rather than vanish. Tiled objects sit this
    // out (their wrap makes "inside" ambiguous), as do the brushes that lay
    // no colour down (erase leaves vector color alone; blur has no spatial
    // extent to soften in a one-color fill — the legacy-fill rule).
    const fillRanges = !svg.tileMode && Array.isArray(local.subpaths) && local.subpaths.length > 0
      ? fillSubpathRanges(local.subpaths)
      : [];
    const inFillRange = (idx: number) => fillRanges.some((r) => idx >= r.start && idx < r.end);
    const touchedFills: FillSubpathRange[] = [];
    const colors = kind === 'paint' || (kind === 'color' && svgFills);
    if (colors && fillRanges.length > 0) {
      const hitIdx = new Set(hits.map((h) => h.idx));
      for (const rng of fillRanges) {
        let touched = false;
        for (let i = rng.start; i < rng.end && !touched; i++) touched = hitIdx.has(i);
        if (!touched
          && lx >= rng.minX && lx <= rng.maxX
          && ly >= rng.minY && ly <= rng.maxY
          && pointInClosedPath(rng.segments, lx, ly)) {
          touched = true;
        }
        if (touched) touchedFills.push(rng);
      }
    }
    // A filled interior catches the dab the same way its outline does:
    // without this, a dab in the middle of a large filled shape hit no
    // segment, and — with the occlusion stack stenciling the island out of
    // the same interior — deposited nowhere at all. The swallowed dab.
    const interiorHit = colors && !svg.tileMode
      && hits.length === 0
      && lx >= local.cellX && lx <= local.cellX + local.cellWidth
      && ly >= local.cellY && ly <= local.cellY + local.cellHeight
      && pointInClosedPath(local.segments, lx, ly);
    const legacyInteriorFill = kind === 'paint' && !!svg.fillColor && interiorHit;
    // COLOR's whole-shape fill: every filled shape it reaches, whether the
    // fill is a modern `fill` block, a legacy `fillColor` or a `fillPaint`
    // (the commit's asSolidFill flattens all three the way the Fill bar
    // does). A pattern-filled shape is not one colour and sits this out; a
    // shape that COULD be filled but isn't stays four lines, and takes ink
    // on its outline alone — the same rule the bitmap pass keeps.
    const colorFillHit = kind === 'color' && svgFills
      && filled && !svg.isPatternFill && !svg.tileMode
      && (hits.length > 0 || interiorHit);
    if (hits.length === 0 && touchedFills.length === 0
      && !legacyInteriorFill && !colorFillHit) continue;

    // First touch of this SVG: snapshot it, so flat indices stay stable for
    // the rest of the stroke, the finalize op has the pre-stroke shape, and
    // the live preview has a path to draw a fill wash over.
    let snap = draft.svgSnapshots.get(svg.id);
    if (!snap) {
      snap = {
        color: svg.color,
        segments: svg.segments,
        subpaths: svg.subpaths,
        localSegments: svg.localSegments,
        localSubpaths: svg.localSubpaths,
        fillColor: svg.fillColor,
        groupId: svg.groupId,
      };
      draft.svgSnapshots.set(svg.id, snap);
    }

    let bucket = draft.paintedSegments.get(svg.id);
    if (!bucket) {
      bucket = new Map();
      draft.paintedSegments.set(svg.id, bucket);
    }

    // Blur is two-phase: collect THIS object's touched segments first, then
    // pull each toward their shared average — computed before any of them
    // moves, so the pass can't cascade into itself within one stamp. One
    // object's segments only: a neighbor under the same cursor blurs among
    // its own colors, not into this one's.
    if (kind === 'blur') {
      // Same targeting rule: a filled shape's colour lives in its fill, and
      // the bitmap layer's own blur pass (stampPaintShapes) softens that.
      if (filled) continue;
      const blurHits: { idx: number; color: RGBColor; w: number }[] = [];
      for (const { idx, distSq } of hits) {
        // A fill subpath is one color — no spatial extent for the blur to
        // soften locally, the same carve-out the legacy fill gets.
        if (inFillRange(idx)) continue;
        const falloff = gaussianFalloff(distSq / radiusSq);
        if (falloff <= 0) continue;
        blurHits.push({ idx, color: bucket.get(idx) ?? snapshotColorAt(snap, idx), w: falloff });
      }
      // A single segment's average is its own color — nothing to soften.
      if (blurHits.length >= 2) {
        const avg = weightedAverage(blurHits)!;
        for (const hit of blurHits) {
          bucket.set(hit.idx, blendColor(hit.color, avg, 'normal', opacity * hit.w));
          painted = true;
        }
      }
      continue;
    }

    // Outline recolour — skipped on a filled shape for every brush but
    // Color (see `outlineTakesInk` above); the hits still mattered, since
    // they are what tells a fill below that the brush reached this object
    // at all.
    if (outlineTakesInk) {
      for (const { idx, distSq } of hits) {
        // Fill-subpath segments are the fill's boundary, not strokes — the
        // whole-subpath pass below colors them as one unit.
        if (inFillRange(idx)) continue;
        const falloff = gaussianFalloff(distSq / radiusSq);
        if (falloff <= 0) continue;
        if (unary) {
          // Once per stroke per segment; invert ignores opacity (a half-invert
          // is just a gray drift), rotate folds opacity into the hue angle.
          if (bucket.has(idx)) continue;
          const base = snapshotColorAt(snap, idx);
          const passOpacity = mode === 'invert' ? 1 : strength;
          const out = blendColor(base, brushColor, mode, passOpacity);
          bucket.set(idx, out);
          if (!sameColor(base, out)) painted = true;
          continue;
        }
        const base = bucket.get(idx) ?? snapshotColorAt(snap, idx);
        const out = blendColor(base, brushColor, mode, strength * falloff * weight);
        bucket.set(idx, out);
        if (!sameColor(base, out)) painted = true;
      }
    }

    // FILL SUBPATHS the dab touched: each blends as one unit at the
    // legacy-fill strength (no spatial falloff), written to every flat
    // index of the subpath so the commit's fill-aware regroup reads one
    // uniform color and keeps the loop whole. Unary modes get one go per
    // subpath per stroke, same as everywhere else.
    for (const rng of touchedFills) {
      if (unary) {
        if (bucket.has(rng.start)) continue;
        const was = snapshotColorAt(snap, rng.start);
        const passOpacity = mode === 'invert' ? 1 : strength;
        const out = blendColor(was, brushColor, mode, passOpacity);
        for (let i = rng.start; i < rng.end; i++) bucket.set(i, out);
        if (!sameColor(was, out)) painted = true;
        continue;
      }
      const base = bucket.get(rng.start) ?? snapshotColorAt(snap, rng.start);
      const out = blendColor(base, brushColor, mode, strength * weight);
      for (let i = rng.start; i < rng.end; i++) bucket.set(i, out);
      if (!sameColor(base, out)) painted = true;
    }

    // COLOR's whole-shape fill: one solid per shape per stroke, blended
    // with no spatial falloff (a single colour has no inside for a falloff
    // to vary across) and committed through the same asSolidFill the Fill
    // bar writes. This is the road the bitmap layer is NOT taken down.
    if (colorFillHit && objectColor) {
      const bucket = objectColor.shapeFills;
      const base = bucket.get(svg.id) ?? shapeFillSolidColor(svg);
      const passOpacity = unary && mode === 'invert' ? 1 : strength * weight;
      if (!unary || !bucket.has(svg.id)) {
        const out = blendColor(base, brushColor, mode, passOpacity);
        bucket.set(svg.id, out);
        if (!sameColor(base, out)) painted = true;
      }
    }

    // Legacy `fillColor` fill: a whole-object property, blended with no
    // spatial falloff once the brush touches the outline OR the dab lands
    // in its interior (see legacyInteriorFill above) — the engine draft's
    // paintedFills. The modern `fill: ShapeFill` shapes paint locally
    // instead, through the bitmap layer (stampPaintShapes below). Paint
    // brush only: a whole-object color has no spatial extent for the blur
    // brush to soften locally, and Color writes the fill block above.
    if (svg.fillColor && kind === 'paint') {
      if (unary) {
        if (!draft.paintedFills.has(svg.id)) {
          const passOpacity = mode === 'invert' ? 1 : strength;
          const out = blendColor(svg.fillColor, brushColor, mode, passOpacity);
          draft.paintedFills.set(svg.id, out);
          if (!sameColor(svg.fillColor, out)) painted = true;
        }
      } else {
        const base = draft.paintedFills.get(svg.id) ?? svg.fillColor;
        const out = blendColor(base, brushColor, mode, strength * weight);
        draft.paintedFills.set(svg.id, out);
        if (!sameColor(base, out)) painted = true;
      }
    }
  }

  // A photo's tint is the BODY of the thing, so it answers to the Fills
  // scope; a pattern's cells are their own. A character's ink answers to
  // BOTH Fills and Strokes — it is the only colour a text has, and an aim
  // at Strokes over a poem must not be an aim at nothing
  // (colorScopeWritesText). The raster brushes pass every gate
  // (colorScopeWrites) and run as they always have.
  if (colorScopeWritesText(kind, scope) && stampPaintTexts(
    state, graph, draft, textPaint, cellX, cellY, radiusCells, filterIds, skipIds, kind, occlusion,
  )) {
    painted = true;
  }
  if (writesFills && stampPaintImages(
    state, graph, draft, imagePaint, cellX, cellY, radiusCells, filterIds, skipIds, kind, occlusion,
    objectColor,
  )) {
    painted = true;
  }
  if (stampPaintShapes(
    state, graph, draft, shapePaint, cellX, cellY, radiusCells, filterIds, skipIds, kind, occlusion,
  )) {
    painted = true;
  }
  // A pattern OBJECT answers to Strokes too — its cells' stroke is the
  // only colour it has (colorScopeWritesPatternObject); which grids that
  // reaches is brushableGrids' own answer, a shape's cloth staying the
  // Patterns aim's alone.
  if (patternPaint && writesPatternGrids && stampPaintPatterns(
    state, draft, patternPaint, cellX, cellY, radiusCells, filterIds, skipIds, kind, occlusion,
    scope, objectColor,
  )) {
    painted = true;
  }
  // …and the HOST's own nodes answer through its pass (a rig on one of its
  // two colours, the one the aim names). Only the Color brush: the raster
  // brushes lay bitmap, and a rig's record is not a surface to lay anything
  // ON — `objectColor` is null for every other kind.
  if (kind === 'color' && objectColor?.host && objectColor.host.stamp(
    draft, cellX, cellY, radiusCells, filterIds, skipIds, occlusion,
  )) {
    painted = true;
  }

  return painted;
}

