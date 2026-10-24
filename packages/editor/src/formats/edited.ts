import type { CellState, CompositionState, GroupNode, TextObject } from '@/engine/types';
import { shapePatternFillIsEmpty } from '@/engine/shapePatternFill';
import { fnv1a32 } from '@/engine/seededRandom';
import { isMultiFileFormat } from './formatIds';
import { photoPlaceholderImageId } from './photoPlaceholder';
import { isSlotFilled, scaffoldFurniture, slotSvgNode, slotTextNode } from './scaffold';
import { MaskShape, maskContains, templateMaskNode } from './templateNodes';
import { type ScaffoldEditorConfig, type ScaffoldNode } from './editorConfig';

// "Has the user actually made anything here?" — the one predicate for the
// difference between a page that was merely OPENED and one that was worked on.
//
// Opening a day's activity seeds its scaffold and creates the entry, so an
// untouched page is still a full composition: the haiku's placeholder poem over
// the mountain, the day's squiggle alone on the canvas, the word bank scattered
// around an empty board. None of that is the user's. A page in that state is
// treated as UNINITIALIZED — no thumbnail is rasterized for it (EditorShell's
// finish), so it never appears in the Journal feed and its Today card shows the
// plain format tint rather than a picture of the prompt.
//
// The same question decides the `anyEdit` completion rule (completion.ts), so
// the two can't drift: a page that isn't worth a thumbnail was not "done".
//
// What counts, per format:
//   Haiku      — any of the seeded text lines edited, or the photo slot
//                      filled with a real picture.
//   Reimagine        — at least one new object added beside the day's squiggle.
//   Adrift           — at least one word sticker floated INTO the mask.
//   Free Play        — anything at all on the canvas.
// Every format falls under the same four tests below; the sticker test is
// specific to the formats that seed word stickers, and the raster-paint test
// is the one that looks anywhere but the scene graph.

/** The scene fields these tests read. Structurally satisfied by both
 *  `CompositionState` and the export layer's `CompositionSubsetScene`, so a
 *  selector (todayThumb.ts) and the editor can ask the same questions. */
export interface MarkScene {
  figures: readonly unknown[];
  /** Read for the page's Mask (templateMaskNode): the path object the
   *  word-in-mask test asks about. */
  svgObjects: readonly MaskShape[];
  /** Only the picture identity is read (the template-baseline comparison);
   *  both scene shapes carry it. */
  images?: readonly { id: string; imageId: string }[];
  texts?: readonly TextObject[];
  groups: readonly GroupNode[];
  /** Paint island scene nodes (v52+): the raster brush's strokes as
   *  first-class objects. An island never exists without ink (erased-empty
   *  ones are removed), so counts and presence tests read the array
   *  directly. */
  paintObjects?: readonly unknown[];
  /** Pattern scene nodes (v54+): inline tile grids. A pattern may exist
   *  empty (the create drag places it before any tile is painted), but
   *  placing one is still the user's own mark, so counts include them. The
   *  cells are read too: a template's panes are laid INTO (Greeting), and a
   *  tile stamped there changes no count. */
  patternObjects?: readonly { id: string; cells: readonly CellState[] }[];
}

/**
 * Whether the page carries any brushwork.
 *
 * Paint islands are scene nodes that never exist without ink (a fully
 * erased island is removed, not left empty), so presence of one IS a mark.
 */
export function sceneHasPaint(scene: MarkScene): boolean {
  return (scene.paintObjects?.length ?? 0) > 0;
}

/**
 * A 32-bit signature of every printed pattern FILL on the page, by shape id
 * — the `patterns` record's counterpart for cloth printed inside a shape
 * rather than into a loose pattern object. Also what a scaffold page records
 * of the cloth its scaffold DEALT (JournalEntry.seededFills — Patchwork's
 * patches arrive printed).
 *
 * Only NON-EMPTY fills are recorded: an empty tile draws nothing, so leaving
 * it out keeps the record the shape it has always been on the pages that
 * carry no cloth, and makes a shape's FIRST print a difference the
 * comparison can see.
 */
export function printedFillSignatures(scene: MarkScene): Record<string, number> {
  const fills: Record<string, number> = {};
  for (const s of scene.svgObjects) {
    if (!shapePatternFillIsEmpty(s.patternFill)) {
      fills[s.id] = patternCellsSignature(s.patternFill!.cells);
    }
  }
  return fills;
}

/**
 * Whether the page's cloth differs from `was` (a {@link printedFillSignatures}
 * record) — either way round: a fill that now holds something it didn't, a
 * reprint, and one cleared back to blank. Compared BOTH ways because an
 * empty fill isn't in either record, so a shape dropping out of the live
 * signatures is as much a change as one appearing in them.
 *
 * A shape that is GONE is not a change of cloth: deleting a node is the
 * node-count tests' to see (and on a scaffold page, deliberately not an
 * edit), so this rule must not read a deleted printed patch as cleared.
 */
function printedFillsChanged(was: Record<string, number>, scene: MarkScene): boolean {
  const now = printedFillSignatures(scene);
  for (const id in now) if (was[id] !== now[id]) return true;
  for (const id in was) {
    if (now[id] === undefined && scene.svgObjects.some((s) => s.id === id)) return true;
  }
  return false;
}

/** Total scene node count across every kind the editor can add. */
export function sceneNodeCount(scene: MarkScene): number {
  return (
    scene.figures.length +
    scene.svgObjects.length +
    (scene.images?.length ?? 0) +
    (scene.texts?.length ?? 0) +
    (scene.paintObjects?.length ?? 0) +
    (scene.patternObjects?.length ?? 0)
  );
}

/**
 * How many scene nodes a format's scaffold seeds into a fresh composition —
 * the node count an untouched page has, and so the threshold "the user added
 * something" is measured against.
 *
 * Mirrors buildScaffoldEntry exactly: one node per scaffold slot, plus the
 * frame's boundary rect when the frame is drawn at all (it has members to clip
 * or a background of its own), plus one node per word sticker, plus one per
 * decorative text. Groups are not counted — they live in `state.groups`, not
 * in the node arrays.
 *
 * The naive `config.scaffold.length` undercounts all three extras, which is why
 * an untouched magnetic-poetry page (no slots, a date stamp, a dozen word
 * stickers) used to read as edited the moment it was opened — and why the Daily
 * Haiku did too once it gained its date stamp.
 */
export function scaffoldNodeCount(config: ScaffoldEditorConfig): number {
  const frame = config.frame;
  const members = frame
    ? frame.memberSlotIds.filter((sid) => config.scaffold.some((s) => s.slotId === sid))
    : [];
  const boundary = frame && (members.length > 0 || frame.background) ? 1 : 0;
  return config.scaffold.length + boundary
    + (config.decorTexts?.length ?? 0)
    // …plus whatever the app's own furniture seeds (scaffold.ts
    // ScaffoldFurniture): CozyJournal's word tiles, one node each, and
    // Poise's rig, which is two — its figure and its hidden pose record.
    + (scaffoldFurniture()?.count(config) ?? 0);
}

/** Every word sticker in the scene (a `sticker: true` TextObject). */
export function sceneStickers(scene: MarkScene): TextObject[] {
  return (scene.texts ?? []).filter((t) => t.sticker);
}

/**
 * The word stickers floated INTO the page's mask — the sticker's centre
 * inside the "Mask" path's outline (templateNodes.ts; the centre, so a
 * word half over the line reads by where most of it sits, and its tilt
 * changes nothing).
 *
 * Magnetic poetry seeds its tiles OUTSIDE the mask; dragging one in moves
 * the node and nothing else — no node count changes, no text is edited, no
 * group adopts it — so this is the only test that sees the game being
 * played. None on a page without a mask.
 */
export function stickersInMask(scene: MarkScene): TextObject[] {
  const mask = templateMaskNode(scene.svgObjects);
  if (!mask) return [];
  return sceneStickers(scene).filter(
    (t) => maskContains(mask, t.cellX + t.cellWidth / 2, t.cellY + t.cellHeight / 2),
  );
}

/**
 * The words in the mask as they READ: line by line down the bottle, left
 * to right along each line — the message the player floated in, for the
 * card that asks what to call it (pageTitleAsk.pageTitleAskBody).
 *
 * A word joins the line above it while its centre sits within half a
 * word's height of that line's first word; tiles are dropped by hand, so
 * a line is never perfectly level. By centres, like {@link stickersInMask}.
 */
export function stickersInMaskReadingOrder(scene: MarkScene): string[] {
  const words = stickersInMask(scene)
    .map((t) => ({
      text: t.content.trim(),
      x: t.cellX + t.cellWidth / 2,
      y: t.cellY + t.cellHeight / 2,
      h: t.cellHeight,
    }))
    .filter((w) => w.text.length > 0)
    .sort((a, b) => a.y - b.y);
  const lines: (typeof words)[] = [];
  for (const w of words) {
    const line = lines[lines.length - 1];
    if (line !== undefined && w.y - line[0].y <= Math.max(line[0].h, w.h) / 2) line.push(w);
    else lines.push([w]);
  }
  return lines.flatMap((line) => line.sort((a, b) => a.x - b.x).map((w) => w.text));
}

// ── Template-based entries ──────────────────────────────────────────
// An entry minted from a page template (pageTemplate.ts) has no relationship
// to the format's built-in scaffold: its node count, text contents, and slots
// are whatever the template holds. The scaffold comparisons above would
// misread it — a template with one extra node would count as "edited" the
// moment it was opened. So a template instance records a baseline SIGNATURE
// at creation, frozen on its JournalEntry, and the edited question becomes
// "does the page differ from that baseline".
//
// The word-sticker test is the one exception, and it is applied to template
// entries too (see isEntryEdited): floating a word into the mask only moves
// an existing node, so it changes neither the node count nor any text — the
// baseline comparison cannot see the magnetic-poetry move at all.

/** The untouched-instance signature a template entry is compared against.
 *  Captured right after instantiation (date already stamped), before the
 *  user sees the page. */
export interface TemplateBaseline {
  /** sceneNodeCount at instantiation. */
  nodeCount: number;
  /** Every text node's content at instantiation, by node id. */
  texts: Record<string, string>;
  /**
   * The picture each image held at instantiation, by node id — present only
   * when the template's pictures are kept (Adrift; pageTemplate.ts
   * keepsTemplatePictures). Absent, or an id missing from it, reads as the
   * un-filled placeholder: what every image of a photo-format template (and
   * every entry minted before this field existed) starts as.
   */
  images?: Record<string, string>;
  /**
   * Paint islands at instantiation. A template is an exported page, so it can
   * arrive with brushwork of its own — "the page has paint" is therefore not
   * the same question here as it is for a scaffold, which never seeds any.
   *
   * The island (paint OBJECT) COUNT, not the ink: a fresh session mints an
   * island, so the count sees the ordinary case cheaply. Adding strokes to
   * an island the template already carried is the one mark this misses, and
   * the node-count and text tests catch anything else the page grows.
   * Absent on entries minted before templates could carry paint — read as
   * none. (Baselines recorded before islands became scene nodes counted
   * TILES here; those entries may misread as edited once repainted — an
   * accepted breaking change of the island refactor.)
   */
  paintIslands?: number;
  /**
   * Each pattern pane's cells at instantiation, by node id, as a 32-bit
   * signature of every cell's tile (or colour), pose and tint
   * (patternCellsSignature). Greeting is laid INTO its template's panes: a
   * tile stamped there adds no node and rewrites no text, so without this
   * the whole game read as an untouched page — never complete, and
   * discarded on close. A pane the user adds is not in the record and is
   * the node count's to see. Absent on entries minted before the field
   * existed — read as unchanged.
   */
  patterns?: Record<string, number>;
  /**
   * …and the cloth printed inside a SHAPE at instantiation, by shape id,
   * signed the same way (patternCellsSignature over the fill's tile). A
   * template is an exported page, so it can arrive with pieces already
   * printed — "the page has cloth in it" is therefore not the same question
   * here as it is for a scaffold, which never seeds a fill with anything in
   * it.
   *
   * Empty fills are left out (printedFillSignatures), so a shape's FIRST
   * print shows up as an id the record hasn't got. Printing adds no node and
   * rewrites no text, so without this the comparison was blind to it, the
   * same way it was blind to a stamped pane before `patterns`. Absent on
   * entries minted before the field existed — read as unchanged.
   */
  fills?: Record<string, number>;
  /**
   * Every node id the scene carried at the baseline — a social game's
   * TURN baseline (docs/social_game_spec.md §6.3): what was on the canvas
   * when the turn began, so "what did you add" is the nodes not in this
   * list (socialRules.newNodes). Recorded only when asked
   * (templateBaselineOf's `withIds`); absent on every template instance.
   */
  nodeIds?: readonly string[];
}

/**
 * A 32-bit signature of a pattern pane's cells: which tile (or colour) each
 * holds, in what pose and tint, in order. Two panes that sign alike are
 * laid alike; laying, erasing or re-posing any one tile changes it.
 */
export function patternCellsSignature(cells: readonly CellState[]): number {
  let key = '';
  for (const c of cells) {
    if (c === null) { key += '.'; continue; }
    key += c.type === 'sprite'
      ? `s${c.spriteId}|${c.tintR ?? ''},${c.tintG ?? ''},${c.tintB ?? ''}`
      : `c${c.r},${c.g},${c.b}`;
    const t = c.transform;
    key += `/${t.rotation}${t.mirrorH ? 'h' : ''}${t.mirrorV ? 'v' : ''};`;
  }
  return fnv1a32(key);
}

/** Every node id a scene carries, across every node array MarkScene
 *  names. Groups are not nodes here, as sceneNodeCount does not count them. */
export function sceneNodeIds(state: MarkScene): string[] {
  const ids: string[] = [];
  for (const n of state.figures as readonly { id?: unknown }[]) if (typeof n.id === 'string') ids.push(n.id);
  for (const n of state.svgObjects) ids.push(n.id);
  for (const n of state.images ?? []) ids.push(n.id);
  for (const n of state.texts ?? []) ids.push(n.id);
  for (const n of (state.paintObjects ?? []) as readonly { id?: unknown }[]) if (typeof n.id === 'string') ids.push(n.id);
  for (const n of state.patternObjects ?? []) ids.push(n.id);
  return ids;
}

/** Capture a just-instantiated template composition's baseline — or, with
 *  `withIds`, a social turn's, which records every node id as well
 *  (TemplateBaseline.nodeIds). */
export function templateBaselineOf(state: MarkScene, options?: { withIds?: boolean }): TemplateBaseline {
  const texts: Record<string, string> = {};
  for (const t of state.texts ?? []) texts[t.id] = t.content;
  const baseline: TemplateBaseline = { nodeCount: sceneNodeCount(state), texts };
  if (options?.withIds) baseline.nodeIds = sceneNodeIds(state);
  if (state.paintObjects?.length) baseline.paintIslands = state.paintObjects.length;
  // Only pictures the instance was BORN holding are recorded: an un-filled
  // image is the default reading, so the common (photo-format) baseline
  // stays exactly the shape it always was.
  const born: Record<string, string> = {};
  let anyBorn = false;
  for (const img of state.images ?? []) {
    if (img.imageId === photoPlaceholderImageId()) continue;
    born[img.id] = img.imageId;
    anyBorn = true;
  }
  if (anyBorn) baseline.images = born;
  const panes: Record<string, number> = {};
  let anyPane = false;
  for (const p of state.patternObjects ?? []) {
    panes[p.id] = patternCellsSignature(p.cells);
    anyPane = true;
  }
  if (anyPane) baseline.patterns = panes;
  const fills = printedFillSignatures(state);
  if (Object.keys(fills).length > 0) baseline.fills = fills;
  return baseline;
}

/** The name the page templates give their title line (Greeting's). */
export const TEMPLATE_TITLE_NAME = 'Title';

/**
 * The title the user gave the page, or undefined while it has none: the
 * content of the template-seeded text named "Title" once it no longer reads
 * what the template wrote (the baseline records that line, by id, so a
 * text the user ADDED under that name is not it). Empty and untouched read
 * as no title. The editor records this on the entry at every save
 * (JournalEntry.title) for the Today rail's small card.
 */
export function templateTitleOf(
  state: MarkScene,
  baseline: TemplateBaseline | undefined,
): string | undefined {
  const title = templateTitleNode(state, baseline);
  if (!title || !baseline) return undefined;
  const content = title.content.trim();
  return content.length > 0 && content !== baseline.texts[title.id].trim() ? content : undefined;
}

/** The template's "Title" text node — the one the template seeded (in the
 *  baseline) under that name — or undefined without one. */
export function templateTitleNode(
  state: MarkScene,
  baseline: TemplateBaseline | undefined,
): TextObject | undefined {
  if (!baseline) return undefined;
  return (state.texts ?? []).find((t) => t.name === TEMPLATE_TITLE_NAME && t.id in baseline.texts);
}

// Greeting once refused Done until its template's "Title" line had been
// written over (ScaffoldEditorConfig.doneRequiresTitle, missingRequiredTitle,
// TITLE_REQUIRED_WARNING). The game asks for nothing now — a card may be
// decorated and wordless — and no other format ever carried the rule, so
// the flag and its check went with it.

/** What the editor says to a Done press the word-in-mask rule refuses. */
export const WORD_IN_MASK_WARNING = 'You must float at least one word into the bottle to complete the game';

/** Why a Done press was refused: the notice to show, and the node to put in
 *  hand while it shows, if any. */
export interface DoneRefusal {
  notice: string;
  selectId?: string;
  /**
   * The world POINTS the refusal is about, when it is about points rather
   * than a node — Creature's connection points still not carried on
   * (socialRules.creatureDoneRule, docs/social_game_spec.md §7.3). The
   * shell flags them red, and flies the camera over to frame them, so
   * *Continue every green point (1 left)* says WHICH one. Empty / absent
   * for every other rule, which has nothing to point at.
   */
  points?: readonly { x: number; y: number }[];
}

/**
 * The reason the page may not be marked done yet, or undefined when it may
 * — the ONE guard both Done presses ask (the band's pill, the info page's
 * capsule). One standing rule, carried by its format's config:
 *  - `doneRequiresWordInMask` (Adrift): no word sticker has been floated
 *    into the page's Mask (stickersInMask) — refused with
 *    WORD_IN_MASK_WARNING. A page with no Mask at all stands the rule down:
 *    a rule with nothing left to satisfy it would only lock the game.
 */
export function doneRefusal(
  config: Pick<ScaffoldEditorConfig, 'doneRequiresWordInMask' | 'doneRule'>,
  state: MarkScene,
  baseline: TemplateBaseline | undefined,
): DoneRefusal | undefined {
  if (config.doneRequiresWordInMask && templateMaskNode(state.svgObjects) && stickersInMask(state).length === 0) {
    return { notice: WORD_IN_MASK_WARNING };
  }
  // The format's own rule, after the flag above (docs/social_game_spec.md
  // §6.3): a social game's turn rule — one piece, one word.
  return config.doneRule?.(state, baseline);
}

/**
 * The template counterpart of `isEntryEdited`: true when the page differs
 * from its instantiation baseline —
 *  - the node count changed (anything added or removed; unlike the scaffold
 *    rule, DELETING template content counts — the page no longer shows the
 *    untouched template);
 *  - any image now holds a picture other than the one it was minted with —
 *    a photo-format template's images all start as the un-filled
 *    placeholder, while an Adrift template's keep their pictures, so "the
 *    one it was minted with" is the baseline's record, placeholder by
 *    default;
 *  - any text says something different from what the template seeded
 *    (including the pre-stamped date, if rewritten);
 *  - any pattern pane the template carried holds different tiles (Greeting's
 *    game is laid into its template's panes);
 *  - any SHAPE holds different cloth than it was minted with — printed where
 *    it opened blank, reprinted, or cleared again (the double tap's game,
 *    which adds no node and rewrites no text either).
 * Moving, restyling, or resizing template nodes without changing what they
 * hold deliberately does NOT count, mirroring the scaffold rule.
 */
export function isTemplateEntryEdited(state: MarkScene, baseline: TemplateBaseline): boolean {
  if (sceneNodeCount(state) !== baseline.nodeCount) return true;
  if ((state.paintObjects?.length ?? 0) !== (baseline.paintIslands ?? 0)) return true;
  const born = baseline.images;
  for (const img of state.images ?? []) {
    if (img.imageId !== (born?.[img.id] ?? photoPlaceholderImageId())) return true;
  }
  if ((state.texts ?? []).some((t) => baseline.texts[t.id] !== t.content)) return true;
  // Cloth printed inside a shape, either way round.
  if (printedFillsChanged(baseline.fills ?? {}, state)) return true;
  const panes = baseline.patterns;
  if (!panes) return false;
  return (state.patternObjects ?? []).some(
    (p) => panes[p.id] !== undefined && patternCellsSignature(p.cells) !== panes[p.id],
  );
}

/** How far a seeded node may sit from where the scaffold put it and still
 *  count as untouched. The slot rect and the seeded bbox are computed by the
 *  same call on the same payload, so an unmoved node matches exactly; this is
 *  only insurance against a payload that crossed a freeze/thaw. */
const SEED_MOVE_EPS = 1e-9;

/**
 * Has this seedSvg slot's node been MOVED, resized or turned away from where
 * the scaffold seeded it?
 *
 * Measured against the SLOT RECT, which a format opting into
 * `seedMoveCounts` must therefore declare as the seed's own tight bbox
 * rather than as the loose region it is guaranteed to live inside — the
 * scaffold gives the node exactly that box (scaffold.ts `seedSvgBbox`), so
 * the two agree to the bit on a page nobody has touched. A missing node
 * (deleted) is not a move: the node COUNT test above is what sees that.
 */
function seedSvgMoved(
  state: CompositionState,
  slot: ScaffoldNode & { kind: 'seedSvg' },
  slotNodeIds: Record<string, string>,
): boolean {
  const node = slotSvgNode(state, slot, slotNodeIds);
  if (!node) return false;
  if (node.angleDeg) return true;
  return Math.abs(node.cellX - slot.cellX) > SEED_MOVE_EPS
    || Math.abs(node.cellY - slot.cellY) > SEED_MOVE_EPS
    || Math.abs(node.cellWidth - slot.cellWidth) > SEED_MOVE_EPS
    || Math.abs(node.cellHeight - slot.cellHeight) > SEED_MOVE_EPS;
}

/**
 * Whether the user has meaningfully edited this page, as opposed to merely
 * opening it (see the module header for the per-format reading).
 *
 * True when any of:
 *  - a seeded word sticker has been floated into the mask (magnetic poetry);
 *  - the paint tool's raster layer holds ink — no scaffold seeds any, so a
 *    brush mark is always the user's;
 *  - any shape's pattern fill holds cloth other than what the scaffold dealt
 *    it (`seededFills`, recorded on the entry when the scaffold printed any
 *    — Patchwork's patches — and empty otherwise, so on every other page a
 *    tile in a fill is always the user's);
 *  - the scene holds more nodes than the scaffold seeded (anything added —
 *    the Reimagine and Free Play rule, and a drawn line on any other format);
 *  - a seeded text slot's content differs from its placeholder (clearing it
 *    counts — it IS an edit), or an image slot now holds a real photo.
 *
 * Deliberately NOT counted: moving, restyling, or resizing a seeded object
 * without changing what it says. A page still showing the placeholder poem over
 * the placeholder mountain is the prompt, not the user's day, wherever the
 * lines were nudged to.
 *
 * `templateBaseline` — set on entries minted from a page template — switches
 * the whole question to the template comparison (`isTemplateEntryEdited`);
 * the scaffold tests don't apply to a page that never held the scaffold. The
 * sticker test runs FIRST either way: a word floated into a template's mask
 * adds no node and rewrites no text, so the baseline comparison is blind to
 * the only move magnetic poetry asks for.
 */
export function isEntryEdited(
  config: ScaffoldEditorConfig,
  state: CompositionState,
  slotNodeIds: Record<string, string>,
  templateBaseline?: TemplateBaseline,
  seededFills?: Record<string, number>,
): boolean {
  // A sticker floated into the mask and a rig moved off its T-pose each add
  // no node and edit no slot, so the app's own furniture gets the first word
  // (scaffold.ts ScaffoldFurniture) — and it keeps it either way, because the
  // template comparison below is blind to both.
  if (scaffoldFurniture()?.touched(config, state)) return true;
  if (templateBaseline) return isTemplateEntryEdited(state, templateBaseline);
  // Brush marks, which add no node and fill no slot: without this a Free Play
  // file made entirely with the paint tool read as never-touched, and
  // entryCloseAction DISCARDED it on close — the file never reached the recent
  // row, the Journal, or the Library. A scaffold seeds no paint, so any ink
  // here is the user's.
  if (sceneHasPaint(state)) return true;
  // Cloth printed inside a shape, for the same reason: a tile the scaffold
  // did not deal was laid by the player — in the mode a double tap on the
  // piece opens, which on Patchwork is half the game. Without it the page
  // whose whole play was the cloth read as never touched: no thumbnail, no
  // Done, and its images dropped on close. Measured against what the
  // scaffold dealt (`seededFills`), since Patchwork's patches arrive
  // printed; a page with no record was dealt no cloth.
  if (printedFillsChanged(seededFills ?? {}, state)) return true;
  if (sceneNodeCount(state) > scaffoldNodeCount(config)) return true;
  return config.scaffold.some((slot) => {
    switch (slot.kind) {
      case 'textSlot': {
        const text = slotTextNode(state, slot, slotNodeIds);
        return text !== undefined && text.content !== slot.placeholder;
      }
      case 'imageSlot':
        return isSlotFilled(state, slot, slotNodeIds);
      case 'seedSvg':
        // Pre-seeded content (the day's squiggle). Editable, but on its own it
        // is still the prompt: nudging or restyling the seed reads like moving
        // a seeded haiku line, not like making something. Adding anything
        // beside it is what counts, and the node-count test above sees that.
        //
        // …unless the format says otherwise, because on that page the seeds
        // ARE the pieces and moving them is the whole move (config
        // seedMoveCounts — Patchwork, whose bar has nothing on it but the
        // selection tool).
        //
        // PRINTING one is not this branch's to answer: cloth in a fill is
        // asked of the whole scene above (printedFillsChanged) rather than
        // slot by slot.
        return config.seedMoveCounts === true && seedSvgMoved(state, slot, slotNodeIds);
    }
  });
}

// ── What closing the editor does with the page ──────────────────────

/**
 * What becomes of a page when the editor closes on it.
 *
 * - `save`    — rasterize its images, so it shows in the Journal and on its card.
 * - `clear`   — keep the page but drop any images: the entry holds a calendar
 *               slot whether or not anything was made in it, and reopening the
 *               date must find it. Dropping the images is what makes a page
 *               undone back to its scaffold stop showing marks it no longer has.
 * - `discard` — delete the page outright, entry and composition both.
 */
export type EntryCloseAction = 'save' | 'clear' | 'discard';

/**
 * The disposition of a page the editor is closing (see {@link EntryCloseAction}).
 *
 * An edited page is always saved. An unedited one turns on whether it owns a
 * calendar slot: a dated page IS its day's slot, so it stays (imageless).
 * A page that holds no slot was minted by the open that is now ending, so an
 * unmarked one is discarded rather than filed — otherwise opening the blank
 * page and changing your mind would leave an empty file behind every single
 * time. Two kinds hold no slot: a multi-file page (Free Play), and an
 * `unlisted` one-off (Reimagine → Random), which mints a page per tap and
 * would otherwise strew a dead record for every reroll the user walked away
 * from.
 */
export function entryCloseAction(
  formatId: string,
  edited: boolean,
  unlisted = false,
): EntryCloseAction {
  if (edited) return 'save';
  return isMultiFileFormat(formatId) || unlisted ? 'discard' : 'clear';
}

// ── "Did this session change the page?" ──────────────────────────────
// A separate question from isEntryEdited above, which asks whether the page
// holds anything the USER made (scaffold vs. marks). This one asks whether
// the page in hand differs from the page as it was FOUND — and it exists for
// the Notebook's order, which is by last edit (todayModel.editStamp).
//
// The entry's `updatedAt` moves whenever the editor rasterizes its images
// (entryStore.setThumb / setView / setTodayThumb ARE the page's edit stamp,
// since the composition's own save never touches the entry record). The image
// queue's gate is the state by reference, and its "last written" starts empty
// — so the first flush of every session rasterized, and merely OPENING an old
// page and closing it again restamped it to now and floated it to the top of
// the Notebook. Panning or zooming did it too: the camera lives in the same
// state object, so the opening fit alone minted a new one.
//
// Hence a content comparison rather than whole-state reference equality: the
// camera, the grid intensity, the last-chosen color and the swatch shelf all
// persist with the page but draw none of it, and moving them is not an edit.

/** The fields of a stored page that the picture is MADE of. Everything else
 *  a save writes (persistence.ts's meta: camera, gridLevel, gridIntensity,
 *  symmetry and its frame, lastChosenColor, customColors) is the view or the
 *  editing pose, and changing one leaves the drawing exactly as it was. */
const PAGE_CONTENT_KEYS = [
  'name', 'figures', 'svgObjects', 'images', 'imageBlobs', 'texts',
  'paintObjects', 'patternObjects', 'groups', 'sceneOrder', 'background',
  'strokeScale',
] as const satisfies readonly (keyof CompositionState)[];

/**
 * Whether two states hold the same page — the drawn content, not the view
 * (see {@link PAGE_CONTENT_KEYS}).
 *
 * Compared field by field BY REFERENCE, which is exact here and costs
 * nothing on a page of a hundred objects: session state is immutable, so
 * every edit mints a new array for whatever it touched and leaves the rest
 * shared (the same property the save queue's gate rests on). It errs only
 * toward "changed" — a field rebuilt into an equal value reads as an edit,
 * which restamps a page rather than losing a stamp.
 */
export function samePageContent(a: CompositionState, b: CompositionState): boolean {
  if (a === b) return true;
  return PAGE_CONTENT_KEYS.every((k) => a[k] === b[k]);
}
