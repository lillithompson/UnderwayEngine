import { nextToolOnPress as nextToolOnPressGeneric } from '@/editor-ui/logic/toolbarBehavior';
import {
  computeHeartSegments, computeQuarterCircleSegments, computeQuarterTorusSegments, computeRegularPolygonSegments,
  computeRightTriangleSegments, computeSemiTorusSegments, computeSemicircleSegments, computeSpiralSegments,
  computeStarSegments,
} from '@/engine/compositionLineBboxMath';
import { FACET_GLYPH_SCALE } from './facetGlyphs';
import type { ArcToolMode, ArrangeMode, LineToolMode, StandardContentMode, StandardToolId } from '../toolIds';
import { HostTool, HostTools, ToolMeta, hostTool, hostToolMeta } from '../hostTools';

// Top-bar tool metadata: labels + MaterialCommunityIcons glyph names
// (kept icon-component-free so node tests can import this module). The
// SWATCH button ignores its icon — TopBar renders it as a live disc of the
// current color, mirroring Facet's ColorSwatchIcon; every brush button
// wears its own glyph, the colour being that one button's to show. The
// line, arc and polygon tools ignore theirs too: EditorShell hands TopBar the matching
// SVG glyph from components/ToolIcons.tsx (Facet has no MCI equivalent for
// them), picked from the tool's current sub-mode — or, for polygon, drawn
// as an N-gon of the sides slider's current count. The GROUPED buttons
// ('lines', 'content') track their pushdown mode instead, so their entries
// here are just the mode each opens on (contentModeIcon / the line branch in
// EditorShell) — labels and default glyph.
//
// The STANDARD tools are here (toolIds.ts, TOOL_META); the tools that are
// an app's own — Sol's Plant, DrawBot's Inklings and Instructions,
// CozyJournal's Figure, Word, Pattern tile and Symmetry — are not. An app
// registers those as HostTools (../hostTools.ts) and passes the registry
// to every function below that has to know about them: the content group's
// row (a host tool may ride it as a mode), the bar's lit state (a host
// SETTING never lights) and the hold that recalls a mode capsule (a host
// tool may hold one). Every other function here is about the standard
// tools alone, and takes a tool id as a plain string so any app's `ToolId`
// union fits (docs/shared-editor.md §4.3).

/** The mark a PATTERN wears, wherever one appears: the pattern tool's bar
 *  button, every pattern object's row in the scene outline, and a host's
 *  tile tool (a tile IS a pattern — CozyJournal's and DrawBot's registries
 *  read it back off TOOL_META.pattern, as sceneOutlineModel does, rather
 *  than naming the glyph again). A circle with a plus in it: "a pattern,
 *  placed here". */
const PATTERN_ICON = 'plus-circle';

/**
 * The two colour buttons' marks.
 *
 * PAINT — the raster group — wears the PAINTBRUSH. Its drag lays texels
 * straight onto the page, which is painting in the plain sense of the
 * word: the button is reached for to make a mark, and a brush is what a
 * mark is made with. It is also the glyph the Facets paint day has always
 * worn on its card (content/facetDays 'facet-paint'), so the day and the
 * tool it hands you now carry one mark.
 *
 * COLOR — the recolour brush — wears that same PAINTBRUSH. It is a
 * brush, dragged over what is already drawn to restain it, and it reads
 * as one.
 *
 * It has worn the can of spray paint, a palette and the other paintbrush
 * (`brush-variant`) before; the can said "another way to paint", the
 * palette "where colours are kept" rather than an action, and the variant
 * brush was the wrong style of brush.
 *
 * Named constants because the raster GROUP button wears the same mark as
 * the Paint mode it opens on (`paints` below, PAINT_MODE_ICON), and the
 * two must not drift.
 */
const PAINT_ICON = 'brush';
const COLOR_ICON = PAINT_ICON;

export const TOOL_META: Record<StandardToolId, ToolMeta> = {
  arrange: { label: 'Arrange', icon: 'cursor-default-outline' },
  photos: { label: 'Photos', icon: 'image-outline' },
  draw: { label: 'Draw', icon: 'pencil-outline' },
  text: { label: 'Text', icon: 'format-text' },
  stickers: { label: 'Stickers', icon: 'sticker-emoji' },
  color: { label: 'Color', icon: COLOR_ICON },
  paint: { label: 'Paint', icon: PAINT_ICON },
  erase: { label: 'Erase', icon: 'eraser' },
  blur: { label: 'Blur', icon: 'blur' },
  push: { label: 'Push', icon: 'gesture-swipe-right' },
  line: { label: 'Path', icon: 'vector-line' },
  arc: { label: 'Arc', icon: 'vector-radius' },
  polygon: { label: 'Polygon', icon: 'vector-polygon' },
  // The pattern tool: drag out a grid region to place a tile pattern,
  // then paint its tiles in place. Keeps the old studio button's glyph.
  pattern: { label: 'Pattern', icon: PATTERN_ICON },
  lines: { label: 'Line', icon: 'vector-line' },
  content: { label: 'Image', icon: 'image-outline' },
  // The raster group. Its default glyph is the Paint brush's own — the mode
  // it opens on — and the shell swaps in the armed mode's (paintModeIcon).
  paints: { label: 'Paint', icon: PAINT_ICON },
  // The picker-only swatch. Its glyph is a fallback nobody sees: TopBar
  // draws this button as a live disc of the active colour (swatchColor),
  // the same way it draws the colour group's Paint-mode button.
  swatch: { label: 'Color', icon: 'palette-outline' },
};

/**
 * The whole bar's table for an app: the standard rows and the host's own
 * (hostToolMeta), over the app's `ToolId`. Typed by the registry's own id
 * type, so an app whose `ToolId` names a tool it never registered fails
 * where it declares `TOOL_META: Record<ToolId, ToolMeta> = toolMetaFor(…)`
 * — the exhaustiveness the one-table arrangement had, kept across the seam.
 */
export function toolMetaFor<T extends string>(
  tools: readonly HostTool<T>[],
): Record<StandardToolId | T, ToolMeta> {
  return { ...TOOL_META, ...hostToolMeta(tools) } as Record<StandardToolId | T, ToolMeta>;
}

/**
 * Which tool the standalone pattern (+) button follows on the bar, or null
 * for no standalone button at all.
 *
 * A bar carrying the unified 'content' button has no standalone button: the
 * pattern tool is that button's Pattern mode, reached from its pushdown.
 * Otherwise it is a content-placing tool, not a trailing extra, so it sits
 * right after Text. On a toolset without Text it trails the last tool; on an
 * empty one there is nowhere to put it, and no button renders.
 */
export function patternToolAnchor<T extends string>(tools: readonly T[]): T | null {
  const has = (id: string) => (tools as readonly string[]).includes(id);
  if (has('content')) return null;
  if (has('text')) return 'text' as T;
  return tools.length > 0 ? tools[tools.length - 1] : null;
}

// ── Line / arc sub-modes (Facet long-press toggles) ─────────────────
// Facet's CompositionEditor keeps one sub-mode per shape tool: the button
// draws (and the canvas commits) whichever mode is current, and a long press
// on the button flips it — Path ⇄ Rectangle, Arc ⇄ Circle.

// The two mode types are declared with StandardToolId in toolIds.ts — a
// format can PIN either (EditorConfig.shapeLock) — and re-exported here, where
// the toggling lives, so importers need only this module.
export type { ArcToolMode, LineToolMode };

export function toggleLineToolMode(mode: LineToolMode): LineToolMode {
  return mode === 'line' ? 'rectangle' : 'line';
}

export function toggleArcToolMode(mode: ArcToolMode): ArcToolMode {
  return mode === 'arc' ? 'circle' : 'arc';
}

/** Button label for the line tool in its current sub-mode (Facet wording). */
export function lineToolLabel(mode: LineToolMode): string {
  return mode === 'rectangle' ? 'Rectangle' : 'Path';
}

/** Button label for the arc tool in its current sub-mode (Facet wording). */
export function arcToolLabel(mode: ArcToolMode): string {
  return mode === 'circle' ? 'Circle' : 'Arc';
}

// ── Selection tool ('arrange') modes ────────────────────────────────
// The selection tool carries a mode capsule like the other groups: Select |
// Scale | Move | Rotate. Select is the selection tool as it always was — a
// selected object grows its corner handles, and two fingers on it scale and
// turn it. Move keeps the object where the finger puts it and nothing more:
// no corner handles are drawn, a grab at a corner is a plain drag, and two
// fingers fall through to the camera pinch. A steady hand for laying
// things out, where a brush of a corner used to skew what was being moved.
//
// SCALE is Select with one rule added: every resize is UNIFORM. The same
// handles are drawn and the same grabs are taken — what changes is that a
// corner pulled off the diagonal scales the object whole instead of
// squashing it. (Select keeps the free pull; some objects insist on
// uniform there anyway — a rig, a word sticker, a seeded squiggle —
// editorSession.requiresUniformScale, which this mode simply extends to
// everything.) It is the answer to "make this bigger" on a page where a
// squashed drawing is never what was wanted.

// The type itself lives with the other tool-mode types (toolIds.ts),
// because a format can open its page on one (EditorConfig.firstArrangeMode)
// and the config layer must be able to name a mode without importing the
// toolbar — the same arrangement as LineToolMode and ArcToolMode above.
export type { ArrangeMode };

/** Capsule order, left to right: Select | Scale | Move | Rotate. Scale
 *  sits beside Select because it IS Select, with the aspect held. A format
 *  may carry a SUBSET of these (EditorConfig.arrangeModes, read through
 *  `arrangeModes` below) — never a different order. */
export const ARRANGE_MODES: ArrangeMode[] = ['select', 'scale', 'move', 'rotate'];

/** The mode the selection tool opens on — its behaviour as it always was
 *  (Select: the full selection — move, scale and turn). A format may open
 *  on another (EditorConfig.firstArrangeMode). */
export const DEFAULT_ARRANGE_MODE: ArrangeMode = 'select';

/**
 * The modes the selection tool's capsule OFFERS on this page: the four
 * above, or the subset a format narrows them to
 * ({@link EditorConfig.arrangeModes} — Patchwork carries Scale | Move |
 * Rotate and no Select). Filtered out of ARRANGE_MODES rather than read off
 * the config in order, so a config listing them any which way still reads
 * left to right the way every other page's capsule does.
 *
 * The same shape as {@link contentModes} below, for the same reason: a
 * format says which modes it wants and the toolbar decides what that means.
 */
export function arrangeModes(flags: { arrangeModes?: ArrangeMode[] }): ArrangeMode[] {
  const wanted = flags.arrangeModes;
  return wanted ? ARRANGE_MODES.filter((m) => wanted.includes(m)) : ARRANGE_MODES;
}

/** The mode the page OPENS in: the format's own pick, else the default —
 *  and never a mode that format's capsule doesn't offer, which would leave
 *  the page in a mode with no lit segment and no way back to it. */
export function firstArrangeMode(config: {
  firstArrangeMode?: ArrangeMode;
  arrangeModes?: ArrangeMode[];
}): ArrangeMode {
  const offered = arrangeModes(config);
  const wanted = config.firstArrangeMode ?? DEFAULT_ARRANGE_MODE;
  return offered.includes(wanted) ? wanted : (offered[0] ?? DEFAULT_ARRANGE_MODE);
}

export function arrangeModeLabel(mode: ArrangeMode): string {
  return mode === 'move' ? 'Move'
    : mode === 'rotate' ? 'Rotate'
      : mode === 'scale' ? 'Scale'
        : 'Select';
}

/** Scale: every resize holds the object's aspect — the corner drags, the
 *  two-finger pinch and a group's combined box alike. Everything else
 *  about the mode is Select's, so this is the only question the gesture
 *  layer asks about it (CanvasSurface's `uniformScale`). */
export function arrangeModeUniformScale(
  activeTool: string | null | undefined,
  mode: ArrangeMode,
): boolean {
  return activeTool === 'arrange' && mode === 'scale';
}

/** Does this mode, under the selection tool, refuse scaling and turning? */
export function arrangeModeMoveOnly(activeTool: string | null | undefined, mode: ArrangeMode): boolean {
  return activeTool === 'arrange' && mode === 'move';
}

/** Rotate: only turning — no moving, no scaling. The selection turns by
 *  the bottom slider (ArrangeRotateSlider) or a two-finger twist, and a
 *  one-finger press only ever selects. */
export function arrangeModeRotateOnly(activeTool: string | null | undefined, mode: ArrangeMode): boolean {
  return activeTool === 'arrange' && mode === 'rotate';
}

/** Does this mode, under the selection tool, take the corner handles (and
 *  the corner grabs) away? Move and Rotate both do — neither scales. */
export function arrangeModeNoScale(activeTool: string | null | undefined, mode: ArrangeMode): boolean {
  return activeTool === 'arrange' && arrangeModeTracesShape(mode);
}

/** The modes whose chrome is the object's OWN BORDER rather than a box:
 *  Move and Rotate (selectionShapeOutline). Tool-free, unlike the three
 *  above — the selection tool asks it through arrangeModeNoScale, and a
 *  COLOR BRUSH asks it directly: the mode is still what a press would do,
 *  so the paint veil cuts its lit hole to the same border and the ring over
 *  that hole is drawn the same way. */
export function arrangeModeTracesShape(mode: ArrangeMode): boolean {
  return mode === 'move' || mode === 'rotate';
}

// ── Unified line tool ('lines') modes ───────────────────────────────
// Freehand, line and arc are all kinds of lines, so the unrestricted
// carousel carries them as ONE 'lines' button. Selecting it drops a mode
// picker down from the toolbar (the same pushdown pattern as the polygon
// sides slider) with the modes written out as words; the picked mode
// decides which of the underlying tools actually activates, and the
// button's glyph tracks it. The bespoke per-format configs keep placing
// 'draw' / 'line' / 'arc' individually — nothing here applies to them.
//
// Tile used to ride along here as a fourth mode, on the reasoning that
// what a tile is made OF connects to the lines the other three leave. It
// is now the object group's last mode (CONTENT_MODE_SPECS): what you DO
// with it is tap a cell and have a piece of content land there, which is
// that group's move, not a stroke.
//
// Paint rides here as a fourth mode on a bar that leaves the raster group
// off but still wants the brush (EditorConfig.linePaintTool — Free Play): a
// spray is one more mark drawn along a drag. It arms the same 'paint' tool
// the raster group's Paint mode does.

export type LineMode = 'freehand' | 'line' | 'arc' | 'paint';

/** Pushdown order, left to right. Paint is offered only where the format
 *  asks for it — see {@link lineModes}. */
export const LINE_MODES: LineMode[] = ['freehand', 'line', 'arc', 'paint'];

/** The modes the pushdown actually offers on a format carrying `flags` (an
 *  EditorConfig reads as one): the three strokes, plus Paint where the
 *  format grants it. */
export function lineModes(flags: { linePaintTool?: boolean }): LineMode[] {
  return flags.linePaintTool ? LINE_MODES : LINE_MODES.filter((m) => m !== 'paint');
}

/** The mode the unified tool opens on. */
export const DEFAULT_LINE_MODE: LineMode = 'line';

/** The underlying tool a mode activates — the canvas gestures are keyed by
 *  these ids, so the unified button is purely a toolbar affair. */
export function lineModeToolId(mode: LineMode): StandardToolId {
  return mode === 'freehand' ? 'draw' : mode;
}

/**
 * The MODE that arms a tool — {@link lineModeToolId} read backwards. Null
 * for anything outside the line group.
 *
 * What a format's `firstTool` is seeded through: a page that opens with a
 * line tool already armed has to open with the capsule saying so. The
 * Response opens on the freehand path ('draw'), and the capsule — starting
 * at DEFAULT_LINE_MODE like every other page — said "Line" while the
 * canvas drew freehand.
 */
export function lineModeOfToolId(tool: string | null | undefined): LineMode | null {
  if (tool === 'draw') return 'freehand';
  return tool === 'line' || tool === 'arc' || tool === 'paint' ? tool : null;
}

/** Whether an active tool is one the unified 'lines' button stands for —
 *  what lights the button and holds its mode pushdown open. The raster
 *  brushes count only where the group carries its Paint mode
 *  (`linePaint`, from EditorConfig.linePaintTool); elsewhere they are the
 *  'paints' group's. All four count there, not Paint alone: Erase, Blur and
 *  Push are reached from Paint (the `brushes` capsule, topCapsuleSlot), so
 *  the button that armed the brush stays lit while its companions are in
 *  hand, and a tap on it still untoggles. */
export function isLineToolId(tool: string | null, linePaint = false): boolean {
  return tool === 'draw' || tool === 'line' || tool === 'arc'
    || (linePaint && isRasterBrushToolId(tool));
}

/** The bar button that arms `tool` on a format: the tool's own button (a
 *  bespoke bar that carries it), the unified 'content' group when the
 *  tool is one of the modes that group offers there (contentModes), or
 *  null on a bar with no way to the tool at all — where a floating Edit
 *  target for a selected pattern would arm a tile tool the bar cannot
 *  show (CozyJournal's and DrawBot's `tile`, the host tool this is asked
 *  for). */
export function buttonArmingTool<T extends string>(
  config: { tools: readonly T[]; contentTools?: readonly string[] },
  tool: T,
  hostTools: HostTools,
): T | 'content' | null {
  if (config.tools.includes(tool)) return tool;
  if ((config.tools as readonly string[]).includes('content')
    && contentModes(config, hostTools).some((m) => contentModeTarget(m) === tool)) return 'content';
  return null;
}

/** The mode's word in the pushdown (no icons there — words only). */
export function lineModeLabel(mode: LineMode): string {
  if (mode === 'freehand') return 'Freehand';
  if (mode === 'paint') return 'Paint';
  return mode === 'arc' ? 'Arc' : 'Line';
}

// ── Unified content tool ('content') modes ──────────────────────────
// Images, text and whatever a host places — tile patterns, CozyJournal's
// mannequins and word tiles — are all ways of PLACING content, so the
// unrestricted carousel carries them as ONE 'content' button, built exactly
// like the unified line button above: selecting it drops the same words-only
// mode picker down from the toolbar, and the picked mode decides what the
// press actually does — arm the tool that places that thing. The button's
// glyph tracks the mode. The bespoke per-format configs keep placing
// 'photos' / 'text' individually with a standalone (+) button — nothing here
// applies to them.
//
// The row is Image and Text, then every registered host tool that rides it
// (HostTool.contentMode), in the registry's order — so the functions of
// this section take the registry. A host mode is the tool's own id, wears
// the tool's own word and glyph, and arms the tool itself.

// The standard modes' type is declared with StandardToolId (toolIds.ts) so a
// format can list the modes it wants; an app's ContentMode is that union
// plus its own host modes. The modes' behaviour is all here.
export type { StandardContentMode };

/** What a content mode IS: the word the pushdown shows, the glyph the button
 *  wears in it, what a press actually does, and the format flag that gates
 *  it — a mode without one is offered wherever the group is.
 *
 *  One row per mode because these four facts used to be four separate chains
 *  of ifs — a mode added to one and forgotten in another wore the wrong glyph,
 *  or was offered on a format with nothing behind it. */
interface ContentModeSpec {
  mode: string;
  label: string;
  icon: string;
  /** The underlying tool the canvas gestures are keyed by: the unified
   *  button is a toolbar affair only. */
  target: string;
  gate?: string;
}

/** Pushdown order, left to right — Image, Text, then the host's: the two
 *  plain placing tools first, then whatever the app places of its own
 *  (CozyJournal: Figure, Word, then the tile — a tile is a thing you
 *  PLACE, tap a cell and a piece of content lands there, so it belongs on
 *  this row rather than among the strokes, where it used to sit as the
 *  line group's fourth mode).
 *
 *  (An older 'pattern' mode came off the row on 2026-09-11: a pattern is laid
 *  with the Tile mode and worked through its own capsules, so a second door
 *  to it here said the same thing twice.) */
const STANDARD_CONTENT_MODE_SPECS: readonly ContentModeSpec[] = [
  { mode: 'image', label: 'Image', icon: TOOL_META.photos.icon, target: 'photos' },
  { mode: 'text', label: 'Text', icon: TOOL_META.text.icon, target: 'text' },
];

/** The whole row for a registry: the standard specs, then one per host
 *  tool that rides the group, under its own id, word and glyph. */
function contentModeSpecs(hostTools: HostTools): ContentModeSpec[] {
  return [
    ...STANDARD_CONTENT_MODE_SPECS,
    ...hostTools.filter((t) => t.contentMode).map((t) => ({
      mode: t.id, label: t.label, icon: t.icon, target: t.id, gate: t.contentMode!.gate,
    })),
  ];
}

/** Every mode the row can carry for this registry, in pushdown order —
 *  before any format's gating ({@link contentModes}). */
export function contentModeRow(hostTools: HostTools): string[] {
  return contentModeSpecs(hostTools).map((s) => s.mode);
}

/** The mode the unified tool opens on. */
export const DEFAULT_CONTENT_MODE: StandardContentMode = 'image';

function contentModeSpec(mode: string, hostTools: HostTools): ContentModeSpec {
  const spec = contentModeSpecs(hostTools).find((s) => s.mode === mode);
  if (!spec) throw new Error(`not a content mode of this bar: ${mode}`);
  return spec;
}

/** What a format says about the group: the modes it names outright
 *  (`contentTools`, which narrows), and — read by name off the same object,
 *  since an EditorConfig is what the shell passes — the gate flag each host
 *  mode rides (`rigTool`, `wordTool`, `tileTool`). `M` is the app's own
 *  ContentMode where the config names one, so what comes back is typed as
 *  the app types it; a bare flags object reads as plain strings. */
export interface ContentModeFlags<M extends string = string> {
  contentTools?: readonly M[];
}

function gateOpen(flags: ContentModeFlags, gate: string | undefined): boolean {
  return !gate || !!(flags as Record<string, unknown>)[gate];
}

/** The modes the pushdown actually offers on a format carrying `flags` (an
 *  EditorConfig reads as one) — the button never offers a mode that would do
 *  nothing: a host mode whose gate the format leaves shut (CozyJournal's Rig
 *  without the mannequin, Word without the word set).
 *
 *  A format may also name the modes it wants outright (`contentTools`), which
 *  narrows what the flags allow rather than widening it: CozyJournal's Facets
 *  Saturday asks for text / word / rig and gets no Image button, but asking
 *  for a mode whose gate is shut still gets nothing. */
export function contentModes<M extends string = string>(
  flags: ContentModeFlags<M>,
  hostTools: HostTools,
): M[] {
  const offered = contentModeSpecs(hostTools)
    .filter((s) => gateOpen(flags, s.gate))
    .map((s) => s.mode as M);
  const wanted = flags.contentTools;
  return wanted ? offered.filter((m) => wanted.includes(m)) : offered;
}

/**
 * The modes a format TURNED ON and then filtered back out by name: a gate
 * flag set true whose mode `contentTools` does not list.
 *
 * Always a mistake, never a way of saying anything — the flag is the only
 * thing that grants the mode, so setting it and then omitting the name
 * leaves it granting nothing, silently. CozyJournal's Comic did exactly that
 * with Tile (`tileTool: true`, `contentTools: ['text', 'rig', 'word']`) and
 * lost not only the Tile mode but the Pattern button on every shape's
 * Effects page, which hangs off the same reading (`buttonArmingTool` →
 * EditorShell's `shapePatternFills`).
 *
 * Read against the gated modes only: a format narrowing the group to leave
 * out Image or Text is dropping a mode nothing turned on, which is the
 * whole point of `contentTools`.
 */
export function deadContentModes(flags: ContentModeFlags, hostTools: HostTools): string[] {
  const wanted = flags.contentTools;
  if (!wanted) return [];
  return contentModeSpecs(hostTools)
    .filter((s) => !!s.gate && gateOpen(flags, s.gate) && !wanted.includes(s.mode))
    .map((s) => s.mode);
}

/** What a mode targets — see {@link ContentModeSpec.target}. The two
 *  standard modes name their tools; a host mode's target is its own id
 *  (the registry has no second name for one), which is why no registry is
 *  needed here and why the answer is typed by the mode asked about. */
export function contentModeTarget<M extends string>(
  mode: M,
): Exclude<M, StandardContentMode> | 'photos' | 'text' {
  const std = STANDARD_CONTENT_MODE_SPECS.find((s) => s.mode === mode);
  return (std ? std.target : mode) as Exclude<M, StandardContentMode> | 'photos' | 'text';
}

/**
 * The MODE that arms a tool — {@link contentModeTarget} read backwards. Null
 * for anything outside the object group.
 *
 * What a format's `firstTool` is seeded through, exactly as
 * {@link lineModeOfToolId} seeds the line group: CozyJournal's Greeting and
 * Storytime both open with the text tool already armed (configs/tapestry.ts,
 * configs/storytime.ts) and must not open with the capsule reading "Image"
 * over a canvas whose next tap writes a word.
 */
export function contentModeOfToolId(tool: string | null | undefined, hostTools: HostTools): string | null {
  if (!tool) return null;
  return contentModeSpecs(hostTools).find((spec) => spec.target === tool)?.mode ?? null;
}

/** Whether an active tool is one the unified 'content' button stands for —
 *  what lights the button and holds its mode pushdown open.
 *
 *  A host's placing tools count like the first two: arming one puts nothing
 *  on the page, so the button stays lit and its pushdown stays open — which
 *  is how you get from CozyJournal's Rig back to Image or Text. (Rig used to
 *  place a mannequin the instant the button was pressed, and the menu it
 *  never opened was the only way to leave the mode.) */
export function isContentToolId(tool: string | null, hostTools: HostTools): boolean {
  return tool !== null && contentModeSpecs(hostTools).some((s) => s.target === tool);
}

/** The mode's word in the pushdown (no icons there — words only). */
export function contentModeLabel(mode: string, hostTools: HostTools): string {
  return contentModeSpec(mode, hostTools).label;
}

/** The MaterialCommunityIcons glyph the button wears in a given mode — the
 *  same glyph each option carried when it was its own button. */
export function contentModeIcon(mode: string, hostTools: HostTools): string {
  return contentModeSpec(mode, hostTools).icon;
}

// ── Unified raster brush tool ('paints') modes ──────────────────────
// The paint brush, its eraser, the blur brush and the push brush are all
// ways of working the page's TEXELS with a drag, so the bar carries them as
// ONE 'paints' button, built exactly like the unified line button above:
// selecting it drops the mode picker down from the toolbar, and the picked
// mode decides which of the underlying tools activates.
//
// PAINT leads: it is the one that lays colour where there was none, and the
// other three are that same brush run differently — Erase lifting the texels
// back off (paint is not an object, so erasing is the only way to take a dab
// back), Blur averaging them toward their local average.
//
// PUSH is the odd one and belongs anyway: it lays no colour down at all, it
// moves what is already there — paint texels smeared along under the disc,
// path points dragged with them, a host's figure re-posed. But it is aimed,
// sized and dragged exactly like the other three, and it is the only place
// on the bar a brush of that shape could live.
//
// The RECOLOUR brush is not here. It led this run once, on the reading that
// colour is colour — but it deposits nothing, and burying it at the head of
// the pushdown of the button that can mark a blank page meant the gentlest
// move on the bar was reachable only through the least gentle one, and that
// a bar wanting one of the two had to take both. It is 'color' now, its own
// button with its own Fills | Strokes | Patterns capsule, and the two sit
// side by side wherever a format wants both (freeformConfig's ALL_TOOLS).
//
// The colour itself is NOT a mode, and no longer rides this menu at all: a
// colour is not something you are doing, it is the setting the brushes
// share, so it is the bar's own SWATCH button — see ToolId 'swatch'. The
// button's glyph is simply the armed mode's (brush / eraser / blur / push).

export type PaintMode = 'paint' | 'erase' | 'blur' | 'push';

/** Pushdown order, left to right. Paint comes first: it is the one that
 *  puts colour on the page, and the other three are what you do to colour
 *  already there. Push comes last: it is the one that moves what is there
 *  rather than laying anything down, so it reads as the end of the run. */
export const PAINT_MODES: PaintMode[] = ['paint', 'erase', 'blur', 'push'];

/** The mode the unified tool opens on. */
export const DEFAULT_PAINT_MODE: PaintMode = 'paint';

/** The underlying tool a mode activates. Every mode IS a tool id — the
 *  canvas paint gesture is keyed by the same four words the pushdown shows
 *  — so the unified button is purely a toolbar affair. */
export function paintModeToolId(mode: PaintMode): PaintMode {
  return mode;
}

/** Whether an active tool is one of the five BRUSHES — the four this button
 *  stands for plus the standalone recolour one. Not the group button's light
 *  (that is {@link isRasterBrushToolId}, which the recolour brush is out of):
 *  this is what puts the floating brush slider and its lower-right mode
 *  target on screen (EditorShell's brushToolActive), and every brush on the
 *  bar takes a size. */
export function isBrushToolId(tool: string | null): boolean {
  return tool === 'color' || isRasterBrushToolId(tool);
}

/** The four RASTER brushes — the ones whose dab lands as texels: paint
 *  lays them, erase lifts them, blur averages them, push smears them. This
 *  is exactly what the 'paints' button stands for, so it is also what lights
 *  it and holds its mode capsule open. 'color' is out because it deposits no
 *  raster at all, only rewrites the colour fields of what it crosses — it
 *  has its own button and its own capsule. */
export function isRasterBrushToolId(tool: string | null): boolean {
  return tool === 'paint' || tool === 'erase' || tool === 'blur' || tool === 'push';
}

/** The mode's word in the pushdown (no icons there — words only). */
export function paintModeLabel(mode: PaintMode): string {
  if (mode === 'erase') return 'Erase';
  if (mode === 'blur') return 'Blur';
  return mode === 'push' ? 'Push' : 'Paint';
}

/** Paint mode's paintbrush glyph — kept as the single named source the
 *  color picker and tests reference. */
export const PAINT_MODE_ICON = TOOL_META.paint.icon;

/** The MaterialCommunityIcons glyph the button wears in a given mode — the
 *  same glyph each tool carries in TOOL_META. */
export function paintModeIcon(mode: PaintMode): string {
  return TOOL_META[mode].icon;
}

// ── The shape tool's pick ───────────────────────────────────────────
// Selecting the shape (polygon) tool floats a capsule under the toolbar —
// Circle | Triangle | Rectangle | More — in place of the old sides
// slider. `polygonSides` stays the ONE scalar the tool draws from: a
// literal side count 3–12, a circle stop outside that range, or one of
// the two sentinels below for the modal's parametric shapes. Everything
// downstream (the gesture, the placement builder, the button glyph)
// keys off this scalar, so the pickers stay dumb.

export const POLYGON_MIN_SIDES = 3;
export const POLYGON_MAX_SIDES = 12;
/** The canonical circle value the capsule's Circle segment sets — past the
 *  12-gon, where a polygon converges to the smooth shape. */
export const POLYGON_CIRCLE = POLYGON_MAX_SIDES + 1;
/** The Shape modal's parametric shapes, as sentinels on the same scalar.
 *  Far above the side-count range so nothing arithmetic ever lands on them
 *  by accident. */
export const POLYGON_HEART = 100;
export const POLYGON_SPIRAL = 101;
/** The five-pointed star. A sentinel rather than a side count because the
 *  count it would name is ten, and a ten-sided figure is not what it is. */
export const POLYGON_STAR = 102;
/** The half circle, dome up, and the half ring — an arch whose hole is
 *  half its width. Closed solids like the heart, sampled like it. */
export const POLYGON_SEMICIRCLE = 103;
export const POLYGON_SEMI_TORUS = 104;
/** The right triangle: the right angle at the box's bottom-left, the
 *  hypotenuse falling top-left to bottom-right. A sentinel, not the 3-gon
 *  — that one is equilateral, and a right triangle is never that. */
export const POLYGON_RIGHT_TRIANGLE = 105;
/** The quarter circle — a quarter disc, the right angle at the box's
 *  bottom-left like the right triangle, the arc where its hypotenuse falls
 *  — and the quarter ring, the same corner cut out at half the radius.
 *  Closed solids like the half shapes, sampled like them. */
export const POLYGON_QUARTER_CIRCLE = 106;
export const POLYGON_QUARTER_TORUS = 107;

export function polygonIsHeart(sides: number): boolean {
  return sides === POLYGON_HEART;
}

export function polygonIsSpiral(sides: number): boolean {
  return sides === POLYGON_SPIRAL;
}

export function polygonIsStar(sides: number): boolean {
  return sides === POLYGON_STAR;
}

export function polygonIsSemicircle(sides: number): boolean {
  return sides === POLYGON_SEMICIRCLE;
}

export function polygonIsSemiTorus(sides: number): boolean {
  return sides === POLYGON_SEMI_TORUS;
}

export function polygonIsRightTriangle(sides: number): boolean {
  return sides === POLYGON_RIGHT_TRIANGLE;
}

export function polygonIsQuarterCircle(sides: number): boolean {
  return sides === POLYGON_QUARTER_CIRCLE;
}

export function polygonIsQuarterTorus(sides: number): boolean {
  return sides === POLYGON_QUARTER_TORUS;
}

/** Whether the value is one of the modal's decorative three — a heart, a
 *  star or a spiral — the three a format may keep off its sheet
 *  (EditorConfig.shapeModalParametric). The right triangle, the half
 *  shapes and the quarter shapes are not among them: they are plain closed
 *  solids, kept wherever the N-gons are. */
export function polygonIsParametric(sides: number): boolean {
  return polygonIsHeart(sides) || polygonIsStar(sides) || polygonIsSpiral(sides);
}

/** Whether the value is any of the modal's sentinels — a shape that is not
 *  an N-gon and not the circle. */
function polygonIsSentinel(sides: number): boolean {
  return polygonIsParametric(sides) || polygonIsRightTriangle(sides)
    || polygonIsSemicircle(sides) || polygonIsSemiTorus(sides)
    || polygonIsQuarterCircle(sides) || polygonIsQuarterTorus(sides);
}

/** Whether the value draws a circle rather than a polygon — any value off
 *  the 3–12 side-count range that isn't one of the modal's sentinels. */
export function polygonIsCircle(sides: number): boolean {
  return !polygonIsSentinel(sides)
    && (sides < POLYGON_MIN_SIDES || sides > POLYGON_MAX_SIDES);
}

/** What the value draws, as a word — the shape's display name. */
export function polygonShapeLabel(sides: number): string {
  if (polygonIsHeart(sides)) return 'heart';
  if (polygonIsSpiral(sides)) return 'spiral';
  if (polygonIsStar(sides)) return 'star';
  if (polygonIsRightTriangle(sides)) return 'right triangle';
  if (polygonIsSemicircle(sides)) return 'semicircle';
  if (polygonIsSemiTorus(sides)) return 'semi-torus';
  if (polygonIsQuarterCircle(sides)) return 'quarter circle';
  if (polygonIsQuarterTorus(sides)) return 'quarter torus';
  if (polygonIsCircle(sides)) return 'circle';
  return String(sides);
}

// ── The shape capsule + modal tables ────────────────────────────────

/** The floating capsule's four segments. The first three set their shape
 *  outright; More opens the full-screen modal below. */
export type ShapeCapsuleKey = 'circle' | 'triangle' | 'rectangle' | 'more';
export const SHAPE_CAPSULE_OPTIONS: readonly { key: ShapeCapsuleKey; label: string }[] = [
  { key: 'circle', label: 'Circle' },
  { key: 'triangle', label: 'Triangle' },
  { key: 'rectangle', label: 'Rectangle' },
  { key: 'more', label: 'More' },
];

/** The `polygonSides` value a capsule segment arms. */
export function shapeCapsuleSides(key: Exclude<ShapeCapsuleKey, 'more'>): number {
  return key === 'circle' ? POLYGON_CIRCLE : key === 'triangle' ? 3 : 4;
}

/** Which segment the CURRENT value lights: the three named shapes light
 *  their own; anything the modal picked (an N-gon past 4, a semicircle, a
 *  heart…) lights More — the door it came through. */
export function shapeCapsuleKeyOf(sides: number): ShapeCapsuleKey {
  if (polygonIsCircle(sides)) return 'circle';
  if (sides === 3) return 'triangle';
  if (sides === 4) return 'rectangle';
  return 'more';
}

/** The highest N-gon the modal OFFERS. Four below the range's own
 *  ceiling: a 12-gon sat a pixel from the circle the capsule already
 *  carries, so the cell bought nothing, and the 9-, 10- and 11-gon went
 *  the same way — past eight sides the figures are a circle with corners,
 *  and their three cells buy a right triangle, a semicircle and a
 *  semi-torus instead, shapes nothing else on the sheet can make.
 *  POLYGON_MAX_SIDES itself is unchanged — an older page that stored 9,
 *  10, 11 or 12 still draws its N-gon, and the circle still sits just past
 *  the ceiling. */
const SHAPE_MODAL_MAX_SIDES = POLYGON_MAX_SIDES - 4;

/** The Shape modal's grid, 4×3 in display order: every N-gon from 3 to
 *  {@link SHAPE_MODAL_MAX_SIDES}, the Right triangle where the 9-gon
 *  stood, the two half shapes — Semicircle, Semi-torus — where the 10- and
 *  11-gon stood, then the decorative three — Star, Heart, Spiral. */
export const SHAPE_MODAL_SHAPES: readonly { sides: number; label: string }[] = [
  ...Array.from({ length: SHAPE_MODAL_MAX_SIDES - POLYGON_MIN_SIDES + 1 }, (_, i) => ({
    sides: POLYGON_MIN_SIDES + i,
    label: String(POLYGON_MIN_SIDES + i),
  })),
  { sides: POLYGON_RIGHT_TRIANGLE, label: 'Right triangle' },
  { sides: POLYGON_SEMICIRCLE, label: 'Semicircle' },
  { sides: POLYGON_SEMI_TORUS, label: 'Semi-torus' },
  { sides: POLYGON_STAR, label: 'Star' },
  { sides: POLYGON_HEART, label: 'Heart' },
  { sides: POLYGON_SPIRAL, label: 'Spiral' },
];

/** Three more plain closed solids a format may ask for after the half
 *  shapes (EditorConfig.shapeModalExtraSolids — the shadow constraint,
 *  so Shadows and Facets' Saturday alike): the 9-gon the
 *  grid dropped for the right triangle, and the two quarter shapes — a
 *  quarter circle and a quarter torus. Off the whole grid: there they
 *  would push the decorative three onto a fourth row for cells that buy a
 *  fill-only page more than a page with every other tool. */
export const SHAPE_MODAL_EXTRA_SOLIDS: readonly { sides: number; label: string }[] = [
  { sides: SHAPE_MODAL_MAX_SIDES + 1, label: String(SHAPE_MODAL_MAX_SIDES + 1) },
  { sides: POLYGON_QUARTER_CIRCLE, label: 'Quarter circle' },
  { sides: POLYGON_QUARTER_TORUS, label: 'Quarter torus' },
];

/** The grid a FORMAT's sheet shows: the whole of {@link SHAPE_MODAL_SHAPES},
 *  or that grid less the decorative three — Star, Heart, Spiral — for a
 *  format that keeps them off (EditorConfig.shapeModalParametric false —
 *  Shadows); the N-gons, the right triangle and the two half shapes stay,
 *  and a format that asks for them (EditorConfig.shapeModalExtraSolids)
 *  gets {@link SHAPE_MODAL_EXTRA_SOLIDS} after those. Read the way
 *  {@link arrangeModes} reads its flag, so the sheet and the config can't
 *  disagree about what More may hand back. */
export function shapeModalShapes(
  flags: { shapeModalParametric?: boolean; shapeModalExtraSolids?: boolean },
): readonly { sides: number; label: string }[] {
  const base = flags.shapeModalParametric === false
    ? SHAPE_MODAL_SHAPES.filter((e) => !polygonIsParametric(e.sides))
    : SHAPE_MODAL_SHAPES;
  if (!flags.shapeModalExtraSolids) return base;
  // The extras go after the plain solids and before the decorative three,
  // so a sheet that keeps both stays grouped: solids, then decorations.
  const decorated = base.findIndex((e) => polygonIsParametric(e.sides));
  return decorated < 0
    ? [...base, ...SHAPE_MODAL_EXTRA_SOLIDS]
    : [...base.slice(0, decorated), ...SHAPE_MODAL_EXTRA_SOLIDS, ...base.slice(decorated)];
}

// ── Polygon glyph geometry ──────────────────────────────────────────
// The polygon button's neighbours are MaterialCommunityIcons drawn on
// Material's 24-unit grid, whose keylines pad the glyph inside the box: a
// circle spans 20 of the 24 units (plus-circle, the pattern-studio button)
// and a square 18 (image-outline's frame). The Facet-ported shape glyphs
// fill their whole 256 box instead, so a polygon sized like them reads
// oversized and off-center next to the image / select / text buttons. These
// constants put the polygon family on the SAME keylines, in the shared
// 256-box (1 grid unit = 256/24).

const ICON_UNIT = 256 / 24;
const ICON_STROKE_HALF = 13.5; // half the family's 27-wide stroke

// The Facet-ported shape glyphs (Line / Rectangle / Arc / Circle in
// ToolIcons.tsx) fill their whole 256 box, so beside the keyline-padded MCI
// buttons (the freehand pencil spans ~18 of the 24 grid units) they read
// oversized. This scale shrinks that full-bleed art, about the box center,
// onto the 18-unit Material square keyline — the same one the polygon
// tool's 4-side square sits on — so the whole shape family matches the
// pencil / image / select / text buttons in apparent size.
// The scale itself lives in the glyph leaf beside the icons (facetGlyphs.ts:
// a host may re-render the Arc glyph elsewhere and must fit it identically)
// — re-exported here so the toolbar side keeps its one import site.
export { FACET_GLYPH_SCALE } from './facetGlyphs';

/** SVG group transform applying {@link FACET_GLYPH_SCALE} about the
 *  256-box center: p → 128 + (p − 128)·s. */
export function facetGlyphTransform(): string {
  const offset = 128 * (1 - FACET_GLYPH_SCALE);
  return `translate(${offset} ${offset}) scale(${FACET_GLYPH_SCALE})`;
}

/** Path radius of the circle-stop glyph: the 20-unit Material circle
 *  keyline (what plus-circle's disc spans), minus half the stroke so the
 *  OUTER edge sits on the keyline. */
export const POLYGON_ICON_CIRCLE_R = 10 * ICON_UNIT - ICON_STROKE_HALF;
/** Path half-extent of the 4-side square: the 18-unit Material square
 *  keyline (image-outline's frame), minus half the stroke. */
export const POLYGON_ICON_SQUARE_HALF = 9 * ICON_UNIT - ICON_STROKE_HALF;
/** Corner radius matching image-outline's 2-unit rounding. */
export const POLYGON_ICON_SQUARE_RADIUS = 2 * ICON_UNIT;

/**
 * The `<polygon points>` string for the tool button's N-gon glyph, in the
 * 256-box the ToolIcons share. Vertices come from the same engine helper the
 * tool commits with, so the button previews exactly the shape a drag draws.
 * (Geometry only — the component wrapping it lives in ToolIcons.tsx, keeping
 * this module icon-component-free for node tests.)
 *
 * Sizing: the point-up N-gon is scaled so its larger bounding-box dimension
 * equals the circle glyph's path diameter, then BBOX-centered in the box.
 * Bbox-fitting is what keeps the family even — a circumradius rule leaves a
 * triangle small and riding high (its centroid sits below its circumcenter)
 * — and an even-sided N-gon (top + bottom vertices, height 2R) lands on
 * exactly the circle's radius, so sliding 12 → 13 barely moves the outline.
 */
export function regularPolygonIconPoints(sides: number): string {
  // Unit-circumradius point-up N-gon, centered on the origin by the engine.
  const unit = computeRegularPolygonSegments(-1, -1, 1, 1, sides);
  return fitSegmentsToIcon(unit);
}

/** Bbox-fit a segment chain's vertices onto the circle keyline, centered
 *  at 128 — the N-gon rule above, shared by the heart and spiral glyphs
 *  so the whole shape family sits evenly. */
function fitSegmentsToIcon(segs: readonly { start: readonly [number, number] }[]): string {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of segs) {
    minX = Math.min(minX, s.start[0]); maxX = Math.max(maxX, s.start[0]);
    minY = Math.min(minY, s.start[1]); maxY = Math.max(maxY, s.start[1]);
  }
  const scale = (2 * POLYGON_ICON_CIRCLE_R) / Math.max(maxX - minX, maxY - minY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return segs
    .map((s) => `${(128 + (s.start[0] - cx) * scale).toFixed(1)},${(128 + (s.start[1] - cy) * scale).toFixed(1)}`)
    .join(' ');
}

/** The Heart glyph's `<polygon points>` — sampled from the SAME engine
 *  generator the tool commits with, so the button previews exactly the
 *  shape a drag draws. */
export function heartIconPoints(): string {
  return fitSegmentsToIcon(computeHeartSegments(-1, -1, 1, 1));
}

/** The Star glyph's `<polygon points>` — sampled from the SAME engine
 *  generator the tool commits with, like the heart above. */
export function starIconPoints(): string {
  return fitSegmentsToIcon(computeStarSegments(-1, -1, 1, 1));
}

/** The Right-triangle glyph's `<polygon points>` — from the generator the
 *  tool commits with, bbox-fit like the rest: the isosceles one, its legs
 *  spanning the circle keyline. */
export function rightTriangleIconPoints(): string {
  return fitSegmentsToIcon(computeRightTriangleSegments(-1, -1, 1, 1));
}

/** The Semicircle glyph's `<polygon points>` — a true half circle (a 2:1
 *  box), from the generator the tool commits with, bbox-fit like the rest
 *  so its diameter meets the circle keyline. */
export function semicircleIconPoints(): string {
  return fitSegmentsToIcon(computeSemicircleSegments(-1, -1, 1, 0));
}

/** The Semi-torus glyph's `<polygon points>` — the true half ring, from the
 *  generator the tool commits with, fit the same way. */
export function semiTorusIconPoints(): string {
  return fitSegmentsToIcon(computeSemiTorusSegments(-1, -1, 1, 0));
}

/** The Quarter-circle glyph's `<polygon points>` — the true quarter disc
 *  (a square box), from the generator the tool commits with, bbox-fit
 *  like the rest so its radii span the circle keyline. */
export function quarterCircleIconPoints(): string {
  return fitSegmentsToIcon(computeQuarterCircleSegments(-1, -1, 1, 1));
}

/** The Quarter-torus glyph's `<polygon points>` — the true quarter ring,
 *  from the generator the tool commits with, fit the same way. */
export function quarterTorusIconPoints(): string {
  return fitSegmentsToIcon(computeQuarterTorusSegments(-1, -1, 1, 1));
}

/** The Spiral glyph's `<polyline points>` — open, so the LAST vertex must
 *  ride along too (a closed chain's is its first segment's start). */
export function spiralIconPoints(): string {
  const segs = computeSpiralSegments(-1, -1, 1, 1);
  const chain = [...segs.map((s) => ({ start: s.start })), { start: segs[segs.length - 1].end }];
  return fitSegmentsToIcon(chain);
}

/** Typed wrapper over the shared, project-agnostic toggle helper in
 *  @underway/editor-ui (single source of truth — the editor-ui TopBar
 *  applies the same helper): the caller's own tool-id type comes back.
 *  Pressing an inactive tool selects it; pressing the ACTIVE tool untoggles
 *  it, leaving `null` — no tool, canvas gestures reduced to pan / zoom (see
 *  each app's resolveCanvasTap and CanvasSurface). */
export function nextToolOnPress<T extends string>(activeTool: T | null, pressed: T): T | null {
  return nextToolOnPressGeneric(activeTool, pressed) as T | null;
}

/** Whether a toolbar button is LIT for the tool in hand. A grouped button
 *  stands for everything it groups, so any of those being armed lights
 *  it; a host's SETTING button (CozyJournal's symmetry) is never a
 *  selected tool, and never lights. The colour SWATCH stands for the
 *  recolour brush (see {@link toolbarButtonIds}): using the picker is what
 *  arms it, so the swatch wears the ring while it is in hand. */
export function toolbarButtonLit(
  button: string,
  active: string | null,
  hostTools: HostTools,
  linePaint = false,
): boolean {
  if (button === 'lines') return isLineToolId(active, linePaint);
  if (button === 'content') return isContentToolId(active, hostTools);
  if (button === 'paints') return isRasterBrushToolId(active);
  if (button === 'swatch') return active === 'color';
  if (hostTool(hostTools, button)?.kind === 'setting') return false;
  return button === active;
}

/** The tool a reach for the colour arms — a tap on the SWATCH as it opens
 *  the picker, and the picker's confirm with nothing selected: the recolour
 *  brush it stands for, where the bar carries one (the swatch lights and the
 *  brush's aim capsule comes up under the picker). null on a bar with the
 *  swatch and no brush — a paint-only bar — where it arms nothing.
 *
 *  null too while the raster PAINT brush is in hand (`active`): that brush
 *  spends the colour already, so the pick is for the next dab, and swapping
 *  the recolour brush in under it took the brush the user was painting with
 *  out of their hand. */
export function swatchPressTool(tools: readonly string[], active: string | null = null): 'color' | null {
  if (active === 'paint') return null;
  return tools.includes('color') ? 'color' : null;
}

/** The buttons a bar DRAWS for its `tools`. The recolour brush has no
 *  button of its own where the bar carries the swatch: the colour and the
 *  brush that spends it are one control — a tap on the swatch (or the
 *  picker's confirm) arms the brush, the swatch lights for it, and its aim capsule comes up under it.
 *  `'color'` stays in the config all the same: it is what lets the picker
 *  arm the brush at all (a paint-only bar's swatch arms nothing). */
export function toolbarButtonIds<T extends string>(tools: readonly T[]): T[] {
  const ids = tools as readonly string[];
  return ids.includes('swatch') ? tools.filter((t) => (t as string) !== 'color') : [...tools];
}

/** The standard buttons whose tool, armed, holds a MODE CAPSULE under the
 *  toolbar (EditorShell's under-toolbar slot): Select's modes, the line
 *  and content groups, the raster brushes, the polygon's sides. (Not the
 *  colour swatch: its hold is the picker's, lit or not.) A host tool that
 *  holds one says so in its record (HostTool.modeCapsule — Sol's Plant
 *  and its strain chips). */
const MODE_CAPSULE_BUTTONS: ReadonlySet<string> = new Set(['arrange', 'lines', 'content', 'paints', 'polygon']);

/**
 * Whether a HOLD on this button brings its capsule back rather than doing
 * the button's other long press. Asked of the ARMED group's button alone:
 * its capsule gives up the slot to a radial's second level and to a host's
 * own capsules (CozyJournal's symmetry capsule, a selected rig's slider
 * modes), and the only way back used to be a tap to untoggle and another
 * to arm the tool again. A hold on the lit button calls the capsule back
 * and leaves the tool exactly as it was. A button not lit keeps its own
 * hold (the paints group's colour shortcut among them).
 */
export function holdRecallsModeCapsule(
  button: string,
  active: string | null,
  hostTools: HostTools,
  linePaint = false,
): boolean {
  const holds = MODE_CAPSULE_BUTTONS.has(button) || !!hostTool(hostTools, button)?.modeCapsule;
  return holds && toolbarButtonLit(button, active, hostTools, linePaint);
}
