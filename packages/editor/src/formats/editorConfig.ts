import type { Paint, PatternSymmetry, RGBColor } from '@/engine/types';
import type { ArcToolMode, ArrangeMode, LineToolMode } from '../toolIds';

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
