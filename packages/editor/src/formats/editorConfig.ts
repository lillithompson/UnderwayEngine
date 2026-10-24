import type { BorderEffect, Paint, PatternSymmetry, RGBColor, TextStyle } from '@/engine/types';
import type { ArcToolMode, ArrangeMode, LineToolMode } from '../toolIds';
import type { RegionMarker } from '../regionChromeScreen';
import type { DoneRefusal, MarkScene, TemplateBaseline } from './edited';

/** The default fill a visible-background frame board uses when a format doesn't
 *  override it, and the fallback shown in the frame Background picker. A warm
 *  off-white (#F4F3F1). */
export const DEFAULT_FRAME_BACKGROUND: RGBColor = { r: 244, g: 243, b: 241 };

/** A vector's properties-panel page a format may withhold — see
 *  {@link CommonEditorConfig.hiddenShapePages}. The names are the panel's own
 *  option actions (editor-ui svgEdit `SVGEditAction`), spelt here so the
 *  config layer can name one without importing the editor. */
export type ShapePropertyPage = 'stroke' | 'fill' | 'effects' | 'opacity';

/**
 * Shape-tool settings the FORMAT fixes, in place of the toolbar controls that
 * would otherwise choose them: the line/arc long-press toggle and the polygon
 * tool's sides slider.
 *
 * A locked control is not merely pre-set — it is gone. The long press stops
 * toggling and the sides slider does not drop down, because the point of a
 * lock is that the day's shape cannot be escaped from the bar. Facets uses it
 * to hand you one shape a day (web/content/facetDays.ts FACET_DAYS).
 */
export interface ShapeLock {
  line?: LineToolMode;
  arc?: ArcToolMode;
  /** Sides the polygon tool draws with; 3 is a triangle, and the two end
   *  divisions (2 and 13) are the circle stops — see polygonIsCircle. */
  polygonSides?: number;
}

/**
 * The part of a format's `EditorConfig` that every Underway app shares.
 *
 * A format reshapes the ONE editor rather than being a separate editor
 * (`CozyJournal.md` §4.3), and the shape it reshapes it through was three
 * copies of one interface: of the 22 members all three apps declare, 21 were
 * byte-identical in comment AND declaration, and the 22nd (`canvas`) nested
 * exactly — Sol's inside CozyJournal's inside DrawBots'. So this is their
 * one text, with DrawBots' canvas as the superset
 * (docs/shared-editor.md §4.2 item 6, stage 6.3b).
 *
 * An app's own fields are NOT here. Each app declares
 * `interface EditorConfig extends CommonEditorConfig` and adds them: 4 of
 * CozyJournal's are its rig and word stickers, 3 of DrawBots' are its
 * simulation and forward arrow, and the 32 that CozyJournal and DrawBots
 * share are the template, scaffold and completion layer, which Sol has none
 * of and which moves when `edited.ts` and `scaffold.ts` do.
 *
 * WHY THE TOOL AND FORMAT IDS ARE `string` HERE. `formatId`, `tools`,
 * `firstTool` and `contentTools` name unions that are each app's own
 * (`FormatId`, `ToolId`, `ContentMode`). §4.3 settled that question for
 * `ToolId` at stage 2 and took neither option it was posed as: the package
 * takes an id as `string` where one comes IN — every app's union is
 * assignable — rather than threading a generic through a package that never
 * needs to know WHICH host tool is armed, only that one is. A config is
 * data the app hands in, so it is that case. Each app re-narrows these four
 * in its own interface, where `Record<ToolId, …>` and the exhaustive
 * switches still hold.
 */
export interface CommonEditorConfig {
  formatId: string;
  hideHeader?: boolean;
  canvas: {
    /** width / height. */
    aspect: number;
    /**
     * The page has no shape of its own: it takes the VISIBLE box's, measured
     * on the device — from under the toolbar down to the bottom edge of the
     * screen — so the page edge is the screen edge and there is no page
     * boundary mid-canvas for a wash to stop at. `aspect` above is then only
     * the fallback, used until the canvas has a size to report.
     *
     * For the unconstrained page (Free Play), whose artifact is framed on the
     * drawn content rather than on the page rect — so a page shaped by the
     * screen it was drawn on costs nothing downstream. A format whose page IS
     * the artifact must declare its ratio instead.
     */
    fillView?: boolean;
    background?: Paint;
    /** What the editor frames on open. 'page' (default) fits the format's
     *  page (cells 0..32 × 0..32/aspect); 'frame' frames the page's frame
     *  exactly as double-tapping its Scene Outline row does (the scene's own
     *  frame group with all it holds, else the format's `frame` rect) — for
     *  formats whose frame is the thing to look at (magnetic poetry); 'content' fits
     *  what is actually drawn, exactly as the Outline header's Frame Page
     *  does — for a format whose seeded marks sit wherever the generator put
     *  them on an otherwise empty page (Reimagine). Falls back to the page
     *  when there is nothing drawn. */
    initialFit?: 'page' | 'frame' | 'content';
    /** The node the page OPENS framed on, by its Scene Outline name (exact,
     *  any case, trimmed — the template naming rule): framed as the
     *  Outline's double-tap frames a row, on EVERY open of the page, ahead
     *  of `initialFit`. Adrift names its template's "Mask" — the shape its
     *  words are floated into, with the word bank heaped around it. A page
     *  with no node of that name falls through to `initialFit`. */
    initialFitName?: string;
    /**
     * The page opens zoomed so the screen is exactly this many GRID cells
     * across — the cells the user sees, at the composition's live grid
     * level, not the canonical 32-cell page unit. Overrides `initialFit`:
     * a fit answers "what should be in view", this answers "how big should
     * a cell be", and only one of those can set the zoom.
     *
     * For a format worked at cell scale rather than page scale: Greeting
     * opens 4 cells wide, so the first tile lands the size of a tile you
     * can see rather than a speck in a band-length view. Centred on the
     * page like a `'page'` open, and clamped by the zoom limits, so a
     * count too small for EDITOR_MAX_ZOOM simply lands as close as it can.
     */
    initialCellsWide?: number;
    /**
     * The page opens FRAMED ON THIS RECT, in world cells — the way a
     * template's Focus rect frames the page, but named by the format
     * rather than drawn into the page.
     *
     * For a format where the part of the page a turn may work in is not
     * the whole page: a Creature turn's band is a half or a third of the
     * board (creatureGeometry.creatureBand), and opening on the whole
     * board spent most of the screen on the grey that is somebody else's.
     * Ranks under a template's `focus` and over every fit below it.
     */
    initialFitRect?: { cellX: number; cellY: number; cellWidth: number; cellHeight: number };
    /**
     * The canvas draws NO GRID LINES — just the flat grey the GL pass
     * clears to (engine colors CANVAS_BASE_GREY), which is the ground a
     * finished picture is shown on anyway (ArtViewer's default
     * background, the same #D9D9D9).
     *
     * For a format whose canvas is somebody else's PICTURE rather than a
     * page being laid out: a Redline's page fills the canvas, and the
     * only place the grid shows through is the picture's own transparent
     * ground — where it reads as ruled lines drawn INTO the artwork
     * being marked up, and where it is not in the redline that gets sent.
     * The marks are meant to be judged against what the room will see.
     *
     * The app-wide Grid Weight preference is simply not mirrored onto
     * such a page (EditorShell); nothing about the grid LEVEL changes, so
     * snapping and the finer/coarser capsules work as they always did.
     */
    hideGrid?: boolean;
    /** Grid/snap level seeded onto fresh compositions (visible grid step =
     *  2^gridLevel cells — see CompositionState.gridLevel). Absent → the
     *  blank-composition default. Reimagine sets it so the visible grid
     *  intersections coincide with the generator's stroke endpoints. */
    gridLevel?: number;
    /** How far the finer/coarser capsules may subdivide: the lowest grid
     *  level the format allows (lower = finer; each level halves the step).
     *  Absent → 0, the app-wide floor. Bounded below by
     *  MIN_FORMAT_GRID_LEVEL (see web/editor/gridLevel.ts). Reimagine sets
     *  −5 so a squiggle can be extended at up to 1/32-cell detail. */
    minGridLevel?: number;
    /** The page OPENS with Grid Snap on. Session-scoped, never persisted:
     *  the snap capsule still changes it (and persists that, app-globally)
     *  the moment the user taps it — but the next open of this format is
     *  snapped again. Reimagine sets it — the locked squiggle's endpoints
     *  already sit on the visible grid, so snapping is what lines new
     *  strokes up with it. `false` is the opposite ask — the page OPENS
     *  unsnapped (Poise: a grid pulling joint drags to the lattice fights
     *  the posing) — while absent leaves the user's own setting alone. */
    gridSnapDefault?: boolean;
    /** The CANVAS mirror the page opens under (the toolbar's Symmetry
     *  setting, not a pattern object's own): every mark made lands with its
     *  orbit copies until it is cycled off. Seeded on the first framing,
     *  where the opening camera exists — the axes are planted on the view
     *  the way toggling the button plants them (pickSymmetryFrame) — and
     *  only onto a page that carries no live symmetry of its own, so a page
     *  saved under another mode reopens in it. Greeting sets it: a woven
     *  band is a mirrored thing. */
    symmetryDefault?: PatternSymmetry;
    /**
     * The grid controls are HIDDEN (docs/drawBot.md §5.9): the
     * finer/coarser/snap capsules (GridQuickActionPanel) are not mounted,
     * the composition's grid level is pinned to `gridLevel` on open and on
     * every load, and grid snap is forced on for the whole session. Absent
     * → the capsules show and the level steps as it always did, which is
     * what EVERY shipping format does today: drawBots set this while its
     * grid was the simulation's to own, and no longer does — it names the
     * level a page opens on (`gridLevel`) and leaves the column alone.
     */
    hideGridControls?: boolean;
  };
  /** Subset + order of the tool carousel. */
  tools: readonly string[];
  shapeLock?: ShapeLock;
  contentTools?: readonly string[];
  patternTool?: boolean;
  linePaintTool?: boolean;
  patternFill?: boolean;
  patternFirst?: boolean;
  firstTool?: string;
  firstArrangeMode?: ArrangeMode;
  arrangeModes?: ArrangeMode[];
  firstSelectionName?: string;
  patternSymmetry?: { horizontal: boolean; vertical: boolean };
  openingColor?: string;
  openingFontId?: string;
  openingStrokeWidthPt?: number;
  openingShapeStyle?: { filled: boolean; outlined: boolean };
  shapeModalParametric?: boolean;
  shapeModalExtraSolids?: boolean;
  hiddenShapePages?: readonly ShapePropertyPage[];
}


// ── The format layer: a page that is a PROMPT ───────────────────────────
//
// Everything below is declared by CozyJournal and DrawBots and by neither
// Sol nor the package's own screens: a page those two apps open is a format
// — an instruction, a scaffold of slots seeded onto it, a prompt flow that
// walks the user through filling them and a rule for when it counts as
// done. A Sol canvas opens blank, so Sol declares none of it and ships it
// unused (docs/shared-editor.md §4.2 item 6, stage 6.3d).
//
// It was two copies of one text. Of the 36 members those two apps share,
// ALL 36 were byte-identical in doc comment as well as declaration, and
// four of them are the ids 6.3b left as `string` here for each app to
// re-narrow — so 32 move, with nothing to merge. The vocabulary they are
// declared over (the slot kinds, the frame, the decor text, the prompt step
// and the completion rule) was byte-identical in the two apps as well.

/** Engine-node name prefix that marks a node as a scaffold slot. */
export const SLOT_NAME_PREFIX = 'slot:';

/** Engine-node name prefix that marks a node as scaffold DECOR — page chrome
 *  the format seeded (the Haiku date stamp), as opposed to a fillable
 *  slot. Deliberately distinct from SLOT_NAME_PREFIX so `slotIdOfNode` (and
 *  everything keyed off it: prompt flow, completion, slot recovery) keeps
 *  ignoring these. */
export const DECOR_NAME_PREFIX = 'decor:';

export interface ScaffoldSlotBase {
  slotId: string;
  /** What the Scene Outline calls this slot's node until the user renames it
   *  (e.g. Reimagine's squiggle is "Reimagine Me"). The node's `name` field
   *  holds the functional `slot:<slotId>` tag, so without this the outline
   *  showed the tag itself; with it, the row reads as content. Purely a
   *  display default — nothing is stored on the node, and a slot that joins a
   *  frame group (its tag still its name) is labelled the same way. Absent → the outline's per-kind default ("Drawing", "Photo"). */
  outlineName?: string;
  /** World-cell rect in the composition's canonical 0..32 space. */
  cellX: number;
  cellY: number;
  cellWidth: number;
  cellHeight: number;
}

export type ScaffoldNode =
  /** Tap-to-fill photo slot ("tap to add your photo").
   *
   *  Default: seeded as a subtle SVG frame that the photos tool later
   *  REPLACES with the picked ImageObject. When `seedImage` is true, the slot
   *  is instead seeded as a real ImageObject showing a bundled placeholder
   *  bitmap (see photoPlaceholder.ts) — same slot tag, membership, and
   *  swap-on-fill behavior as the frame, just an image instead of a vector. */
  | (ScaffoldSlotBase & { kind: 'imageSlot'; hint: string; seedImage?: boolean })
  /** Pre-placed editable text ("write your haiku here"). */
  | (ScaffoldSlotBase & {
      kind: 'textSlot';
      hint: string;
      placeholder: string;
      style: Partial<TextStyle>;
    })
  /** Pre-seeded vector content (e.g. the day's squiggle). The segments come
   *  from the frozen issue payload under `payloadKey`, seeded ONCE into a
   *  fresh composition; from there it is ordinary editable content — the user
   *  can move, restyle, reshape or delete it, and those edits persist like any
   *  other node. The issue payload is the starting point, not a lock. */
  | (ScaffoldSlotBase & {
      kind: 'seedSvg';
      payloadKey: string;
      /** Seed this slot LOCKED. The default is unlocked, because a seed is
       *  ordinarily a starting point to be drawn over — Patchwork locks the
       *  two curves its patches are cut from, so the pieces can be coloured
       *  in without the lines under them moving. The user can still unlock it
       *  from the Scene Outline; this is the state it arrives in, not a rule.
       *
       *  It also exempts the slot from `unlockSeedSvgSlots`, the one-shot
       *  migration that strips a lock the old Reimagine builds shipped. */
      locked?: boolean;
      /** Seed this slot HIDDEN: on the page, in the document, and out of
       *  sight — the eye toggle's state, not a deletion.
       *
       *  For a seed that is scaffolding rather than picture. Patchwork's two
       *  curves are the seams its patches were cut along, and every patch
       *  draws its own outline exactly under them: they add nothing to what
       *  is on screen, while a tap meant for a piece could land on the line
       *  lying over it. Locking them stopped the line MOVING; hiding them
       *  takes them out of the drawing altogether, so what is on the page is
       *  the pieces and nothing else.
       *
       *  Like `locked`, the state it arrives in rather than a rule: the
       *  Scene Outline's eye brings it back. */
      hidden?: boolean;
      /** Seed this slot with an empty PATTERN GRID: a `size × size` tile
       *  repeating inside the seeded shape's own outline
       *  (engine/shapePatternFill.ts), with no tiles in it yet.
       *
       *  Blank on purpose — the grid is the invitation, not the picture.
       *  The shape opens looking exactly as it would without one, and a
       *  double tap on it (or the Pattern page's Edit) goes straight into
       *  painting instead of asking for a pattern to be added first.
       *  Patchwork's patches are cloth waiting to be printed.
       *
       *  `gridCells` is the square the tile is measured against, in world
       *  cells, and the tile is laid at twice its resolution — the rule a
       *  fill added by hand follows against the page's own grid, so a 2×2
       *  tile spans exactly one square. Patchwork hands it the unit every
       *  piece of its line travels, which puts one repeat of the pattern on
       *  each step of the drawing's own lattice.
       *
       *  It arrives PRINTED — a random flood, closed, rolled afresh every
       *  time the scaffold runs (scaffold.ts `seedPatternFill`), and
       *  recorded on the entry so the edited rule knows it for the
       *  scaffold's (JournalEntry.seededFills).
       *
       *  A starting point like the rest of the seed: the Pattern page's Size
       *  slider, its symmetry, the tiles painted into it and its removal are
       *  ordinary edits from there. */
      patternFill?: {
        size: number;
        gridCells: number;
        /** The ink the dealt cloth is printed in, given the seed's fill.
         *  Default: the seed's own stroke colour. */
        ink?: (fillColor: RGBColor | undefined) => RGBColor;
      };
    });

/**
 * A Figma-style frame declared by a format. It groups the named scaffold
 * slots into an `isFrame` group whose rectangular boundary clips them (on
 * canvas + export) and defines the exported region exactly. The member
 * slots stay ordinary top-level scaffold slots (so prompt flow + completion
 * enumerate them unchanged) — the frame is a layout/clipping wrapper, not a
 * fillable slot. `background`, when set, paints behind the members; otherwise
 * the boundary is invisible (clip only). Rect is in canonical 0..32 space.
 */
export interface ScaffoldFrame {
  cellX: number;
  cellY: number;
  cellWidth: number;
  cellHeight: number;
  /** slotIds of the scaffold slots contained by (and clipped to) the frame,
   *  back-to-front. Every id must name a slot in `EditorConfig.scaffold`. */
  memberSlotIds: string[];
  background?: RGBColor;
  /** Default border for the frame, seeded onto its boundary rect's effects (so
   *  it renders + edits exactly like a user-added border). Honors
   *  inside/center/outside like an image's border. Absent → no border. */
  border?: BorderEffect;
  /** Group name for the frame (its Scene Outline label, e.g. "Today's Hopes,
   *  Dreams, Plans"). Falls back to the issue label when absent. */
  name?: string;
}

/**
 * A decorative text seeded alongside a format's scaffold (e.g. the Daily
 * Haiku's date stamp). NOT a fillable slot: it carries a `decor:<decorId>` tag
 * rather than a `slot:` one, so the prompt flow, completion rules, slot
 * recovery, and config validation all ignore it — the tag exists so readers
 * that care about page chrome can still recognize it (todayThumb keeps the
 * date stamp out of the Today-card poem cutout).
 *
 * Seeded once at init as an ordinary, editable text node and persisted from
 * there: the user can move, restyle, or rewrite it like anything else on the
 * page. `style` merges over SLOT_TEXT_DEFAULT_STYLE. Rect is in canonical
 * 0..32 space.
 */
export interface ScaffoldDecorText {
  /** Stable id behind the node's `decor:<decorId>` tag. Unique per config. */
  decorId: string;
  content: string;
  style: Partial<TextStyle>;
  /** Join `frame` as its FRONT-most member, so the text is clipped to the
   *  frame, exported with it, and listed inside it in the Scene Outline.
   *  Requires the config to declare a `frame`. */
  inFrame?: boolean;
  cellX: number;
  cellY: number;
  cellWidth: number;
  cellHeight: number;
}

export type PromptStep =
  /** Highlight a slot and ask the user to fill it. Advances when the
   *  slot's completion condition is met (image chosen / text edited). */
  | { id: string; kind: 'fillSlot'; slotId: string; title: string; body?: string }
  /** Informational interstitial (e.g. the doodle constraint banner). */
  | { id: string; kind: 'info'; title: string; body?: string }
  /** Free editing; the flow is done and full (configured) tools unlock. */
  | { id: string; kind: 'free'; title?: string };

export type CompletionRule =
  | { kind: 'allSlotsFilled' }
  | { kind: 'slotsFilled'; slotIds: string[] }
  /** Any content edit beyond the scaffold counts (squiggle, tapestry…). */
  | { kind: 'anyEdit' };

/**
 * The part of a format-driven app's `EditorConfig` that CozyJournal and
 * DrawBots share — see the band comment above for what it is and why Sol
 * has none of it.
 *
 * Those two apps declare `interface EditorConfig extends
 * ScaffoldEditorConfig`; Sol extends {@link CommonEditorConfig} directly.
 * So a package module that reads a scaffold takes THIS type and a module
 * that reads only the common half takes that one, and Sol's config is
 * refused by the first at compile time rather than failing on a missing
 * field at run time. {@link validateEditorConfig} is the one reader that
 * wants both, and it takes the scaffold half as a `Partial`.
 *
 * `scaffold`, `promptFlow` and `completion` are REQUIRED: a format
 * without them is a format with no page to fill, no flow and no way to be
 * finished, and every config in both apps declares all three (the empty
 * scaffold with `{ kind: 'anyEdit' }` is how a free-drawing format spells
 * "no slots").
 */
export interface ScaffoldEditorConfig extends CommonEditorConfig {
  instruction?: string;
  firstMoveInstruction?: string;
  about?: string;
  infoArt?: false;
  instructionEmphasis?: string;
  tileTool?: boolean;
  templateTextPlaceholders?: boolean;
  templateTextQuotes?: readonly string[];
  titleOnDone?: boolean;
  titleOnDoneSubject?: string;
  doneRequiresWordInMask?: boolean;
  templateLockedExcept?: readonly string[];
  doneRule?: (state: MarkScene, baseline: TemplateBaseline | undefined) => DoneRefusal | undefined;
  placeRule?: (state: MarkScene, baseline: TemplateBaseline | undefined, kind: 'svg' | 'text' | 'image') => string | undefined;
  textRule?: (content: string) => string | undefined;
  enterCommitsText?: boolean;
  noAutoCapitalize?: boolean;
  editableRegion?: { yMin: number; yMax: number; magnetYs?: readonly number[] };
  regionChrome?: {
    veil: 'outside';
    midline: { ys: readonly number[]; dash: true };
    board?: { xMin: number; xMax: number; yMin: number; yMax: number };
    targetYs?: readonly number[];
  };
  markers?: (state: MarkScene, baseline: TemplateBaseline | undefined, gridLevel: number) => RegionMarker[];
  veiledIds?: ReadonlySet<string>;
  isResponse?: boolean;
  isRedline?: boolean;
  isGlyph?: boolean;
  frameDropHighlight?: boolean;
  seedMoveCounts?: boolean;
  resettable?: boolean;
  scaffold: ScaffoldNode[];
  frame?: ScaffoldFrame;
  promptFlow: PromptStep[];
  completion: CompletionRule;
  decorTexts?: ScaffoldDecorText[];
}

/**
 * The day's resolved prompt for a format, frozen onto the stored entry at
 * issue time (a pack update changes future days only, never history).
 * `payload` carries format-specific data (squiggle segments, doodle topic +
 * constraint, word lists, 8-ball question…).
 *
 * `formatId` is a `string` here for the reason the config's four ids are —
 * see the header. Each app declares
 * `interface FormatIssue extends CommonFormatIssue { formatId: FormatId }`,
 * so everything that reads one keeps its own closed union.
 */
export interface CommonFormatIssue {
  formatId: string;
  /** 'YYYY-MM-DD' local date the issue is for. */
  isoDate: string;
  /** Short label shown on cards and in the editor banner. */
  label: string;
  detail?: string;
  /** One more frozen line, under `detail`, for the one kind of page that
   *  has a second thing to say about itself: a finished social game whose
   *  card a player has since taken off the feed — *Made private by Ann*
   *  (web/store/salvagedMoveEntry, matchesModel.keptCardRemovedLine).
   *  Absent on every other issue. */
  note?: string;
  payload?: Record<string, unknown>;
}

/**
 * Narrow a frozen issue's payload to a format's payload shape. Every
 * field stays optional-defensive because the payload crossed a JSON
 * freeze/thaw (the entry store) — config factories must tolerate missing or
 * malformed fields rather than trust the compile-time shape.
 */
export function readIssuePayload<T extends Record<string, unknown>>(
  issue: CommonFormatIssue,
): Partial<T> {
  const p = issue.payload;
  return p && typeof p === 'object' ? (p as Partial<T>) : {};
}
