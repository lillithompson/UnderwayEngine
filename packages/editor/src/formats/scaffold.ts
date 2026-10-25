import {
  CompUndoEntry,
  CompUndoOp,
  CompositionState,
  ImageObject,
  PATTERN_SYMMETRY_OFF,
  PathSegment,
  RGBColor,
  SVGObject,
  TextObject,
  TextStyle,
} from '@/engine/types';
import { buildShapeSVGObject } from '@/engine/shapePresets';
import {
  buildShapePatternFill, shapePatternFillOf, shapePatternGrid, withShapePatternFill,
} from '@/engine/shapePatternFill';
import { applyPatternCellEdits, patternReconcileEdits } from '@/engine/patternObject';
import { DEFAULT_PATTERN_EXCLUDED_FAMILIES } from '../patternTileFamilies';
import type { TemplateBaseline } from './edited';
import { applyCompOps, computeSVGBbox } from '@/engine/compositionOps';
import { makeBlankComposition } from '../blankComposition';
import { measureTextBbox } from '@/engine/textLayout';
import { WORLD_CELLS, pageHeightCells } from '../cameraMath';
import { type CellBbox, sameBbox } from '../resizeMath';

import {
  DECOR_NAME_PREFIX,
  type ScaffoldEditorConfig,
  type ScaffoldNode,
  SLOT_NAME_PREFIX,
} from './editorConfig';
import type { CommonFormatIssue } from './editorConfig';
import {
  PHOTO_PLACEHOLDER_MIME,
  PHOTO_PLACEHOLDER_PIXEL_H,
  PHOTO_PLACEHOLDER_PIXEL_W,
  photoPlaceholderImageId,
} from './photoPlaceholder';

/** A rect in canonical cells. CozyJournal's `wordScatter.ts` re-exports it
 *  rather than declaring its own: the scatter's field, a page rect and a
 *  frame rect are one shape, and DrawBots — which has no word scatter —
 *  already carried this declaration verbatim. */
export interface Rect {
  cellX: number;
  cellY: number;
  cellWidth: number;
  cellHeight: number;
}

// Scaffold construction (CozyJournal.md §4.3): each format's pre-placed
// slots become ORDINARY engine nodes, tagged only through their `name`
// field (`slot:<slotId>`). No new node kind, so slots persist in .tile
// files, ride undo/redo, and stay freely editable after the guided flow.
//
// The scaffold is expressed as a single engine CompUndoEntry of
// placeObject ops so the editor applies it through the same op pipeline
// as user edits (and a fresh entry's baseline is exactly one entry deep).

/** Default style for text-slot placeholders; per-slot `style` merges over it. */
export const SLOT_TEXT_DEFAULT_STYLE: TextStyle = {
  fontId: 'system',
  size: 1.6,
  color: { r: 43, g: 38, b: 34 }, // ink-dark
};

/** Word-sticker (magnetic poetry) glyph style: DM Serif Display, black,
 *  centred horizontally + vertically. The card chrome (white/black fill, 1px
 *  border, drop shadow) and the invert toggle are handled at render time
 *  (NodeLayer); this is only the text. */
export const STICKER_TEXT_STYLE: TextStyle = {
  fontId: 'dm-serif-display',
  size: 1.5,
  color: { r: 0, g: 0, b: 0 },
  align: 'center',
  vAlign: 'middle',
};

/** Interior margin (cells, per side) between a word sticker's text and its card
 *  edge. The sticker's node bbox IS the card (measured text + 2× this), so the
 *  selection box / hit area hug the visible card; the centered text supplies
 *  the margin. NodeLayer draws the card filling the bbox. */
export const STICKER_PAD_CELLS = 0.4;

/** Subtle placeholder-frame colors for image slots ("tap to add photo"). */
const IMAGE_FRAME_STROKE: RGBColor = { r: 176, g: 168, b: 158 };
const IMAGE_FRAME_FILL: RGBColor = { r: 235, g: 231, b: 224 };

/** Stroke color for a frame's boundary rect. Only used when the boundary is
 *  visible (the frame declares a background); a background-less frame boundary
 *  is hidden (clip only), so this never renders in that case. */
const FRAME_BOUNDARY_COLOR: RGBColor = { r: 176, g: 168, b: 158 };

/** Engine-node name for a slot's node. */
export function slotName(slotId: string): string {
  return SLOT_NAME_PREFIX + slotId;
}

/** The id a `<prefix><id>` tag in the node's name carries; null with none.
 *  A member's name is its own whether or not it is grouped — grouping never
 *  touches it — so the one field is the only place a tag can be. */
function taggedId(node: { name?: string }, prefix: string): string | null {
  return node.name !== undefined && node.name.startsWith(prefix) ? node.name.slice(prefix.length) : null;
}

/** Parse a node's slot tag; null when the node is not a scaffold slot. */
export function slotIdOfNode(node: { name?: string }): string | null {
  return taggedId(node, SLOT_NAME_PREFIX);
}

/** The Scene Outline's labels for this format's functional tags, keyed by
 *  the WHOLE tag the way the shared outline reads them
 *  (`@/editor/sceneOutlineModel`'s `tagLabels`): `slot:<slotId>` → the
 *  slot's declared name (`ScaffoldSlotBase.outlineName`). Slots that
 *  declare none are absent, and their nodes fall back to the outline's
 *  per-kind default — never to the raw tag. Decor tags declare no label
 *  at all and do the same. */
export function buildSlotOutlineNames(config: ScaffoldEditorConfig): Map<string, string> {
  const map = new Map<string, string>();
  for (const node of config.scaffold) {
    if (node.outlineName) map.set(slotName(node.slotId), node.outlineName);
  }
  return map;
}

/** Engine-node name for a decorative (non-slot) scaffold text. */
export function decorName(decorId: string): string {
  return DECOR_NAME_PREFIX + decorId;
}

/** Parse a node's decor tag; null when the node is not scaffold decor. */
export function decorIdOfNode(node: { name?: string }): string | null {
  return taggedId(node, DECOR_NAME_PREFIX);
}

function slotBbox(node: ScaffoldNode): { cellX: number; cellY: number; cellWidth: number; cellHeight: number } {
  return { cellX: node.cellX, cellY: node.cellY, cellWidth: node.cellWidth, cellHeight: node.cellHeight };
}

/** Shape of a seedSvg slot's frozen issue payload. */
export interface SeedSvgPayload {
  segments: PathSegment[];
  color: RGBColor;
  /** A solid fill the seeded shape arrives with, for a slot whose content is
   *  a closed AREA rather than a line — Patchwork's patches come in filled
   *  white. Absent for a seed that is only a stroke (Reimagine's squiggle).
   *  The legacy `fillColor` field on purpose: it is what `buildShapeSVGObject`
   *  seeds a fill with elsewhere, the renderer honours it, and the Fill bar
   *  reads it back as its own solid fill (`shapeFillOf`) — so the first tap on
   *  Fill opens on the fill the shape already has rather than on "Add Fill". */
  fillColor?: RGBColor;
}

function readRGB(raw: unknown): RGBColor | undefined {
  const c = raw as Partial<RGBColor> | undefined;
  return c && typeof c.r === 'number' && typeof c.g === 'number' && typeof c.b === 'number'
    ? { r: c.r, g: c.g, b: c.b }
    : undefined;
}

/** The seed drawing frozen on the issue under `payloadKey` — the day's
 *  squiggle — or null when the payload is missing or malformed. The one
 *  reader of that payload's shape: the scaffold seeds the page from it, and
 *  the info page draws its picture from it. */
export function readSeedSvgPayload(issue: CommonFormatIssue, payloadKey: string): SeedSvgPayload | null {
  const raw = issue.payload?.[payloadKey] as Partial<SeedSvgPayload> | undefined;
  const color = readRGB(raw?.color);
  if (!raw || !Array.isArray(raw.segments) || !color) return null;
  const fillColor = readRGB(raw.fillColor);
  return fillColor ? { segments: raw.segments, color, fillColor } : { segments: raw.segments, color };
}

/**
 * A seeded shape's PATTERN FILL, where its slot asks for one
 * (`ScaffoldNode.patternFill`): a `size × size` tile that repeats inside the
 * shape's own outline — and it arrives PRINTED.
 *
 * Printed the way a double tap prints an empty fill (EditorShell's
 * onEditTilePattern → buildPatternFloodAndClose): a connectivity-respecting
 * random FLOOD under the H+V mirror a first print uses, then a CLOSE so its
 * lines meet across the tile's own borders rather than stopping dead at
 * them. A page of blank patches opened as a page of flat colour; a page of
 * printed ones opens as a quilt, and every cloth is still the player's to
 * re-roll, repaint or strip.
 *
 * RANDOM, not seeded from the day: the patches' geometry and shades are the
 * day's and the same for everyone, but the cloth is dealt fresh each time
 * the scaffold runs — each device's new page, and each Reset — which is
 * the point of it.
 *
 * Inked in whatever the slot's `ink` answers for the seed's fill
 * (Patchwork: another random shade of its tint, kept clear of the patch's
 * own), else in the seed's own stroke colour. Drawn
 * from the default tile families, which is what a grid that has never said
 * otherwise is made of.
 */
function seedPatternFill(
  svg: SVGObject,
  ask: NonNullable<(ScaffoldNode & { kind: 'seedSvg' })['patternFill']>,
): SVGObject {
  const excluded = DEFAULT_PATTERN_EXCLUDED_FAMILIES;
  const flooded = withShapePatternFill(svg, buildShapePatternFill(svg, ask.gridCells, {
    size: ask.size,
    symmetry: { ...PATTERN_SYMMETRY_OFF, mirrorH: true, mirrorV: true },
    flood: true,
    excludedFamilies: excluded,
    tint: ask.ink ? ask.ink(svg.fillColor) : svg.color,
  }));
  const grid = shapePatternGrid(flooded);
  if (!grid || !flooded.patternFill) return flooded;
  const closed = applyPatternCellEdits(grid, patternReconcileEdits(grid, false, excluded));
  return withShapePatternFill(flooded, shapePatternFillOf(flooded.patternFill, closed));
}

function parseSeedSvgPayload(issue: CommonFormatIssue, node: ScaffoldNode & { kind: 'seedSvg' }): SeedSvgPayload {
  const seed = readSeedSvgPayload(issue, node.payloadKey);
  if (!seed) {
    throw new Error(
      `scaffold: seedSvg slot "${node.slotId}" expects { segments, color } at issue.payload["${node.payloadKey}"]`,
    );
  }
  return seed;
}

/**
 * Node bbox for a seedSvg slot: the TIGHT world AABB of its segments
 * (the engine's canonical SVG bbox — `computeSVGBbox`, the same thing the
 * geometry adapter and the binary loader derive), not the slot rect.
 *
 * The slot rect is only the region the payload is guaranteed to live
 * inside; for the squiggle that rect is the whole page, so using it as the
 * node bbox gave the seed stroke a full-page selection box and made
 * Scene Outline double-tap "frame" the entire canvas instead of the
 * squiggle. Degenerate payloads (no segments) fall back to the slot rect
 * so the node still has a grabbable extent.
 */
function seedSvgBbox(
  segments: PathSegment[],
  node: ScaffoldNode & { kind: 'seedSvg' },
): { cellX: number; cellY: number; cellWidth: number; cellHeight: number } {
  if (segments.length === 0) return slotBbox(node);
  return computeSVGBbox(segments);
}

/**
 * One-shot migration for compositions saved by the builds that seeded the
 * squiggle LOCKED: clear the lock so the seed is editable like everything
 * else on the page.
 *
 * A seedSvg node is only a starting point — the user's edits to it are the
 * document (see `buildScaffoldEntry`) — but `locked` is persisted in the
 * binary format, so an entry started under an older build would reopen with
 * its squiggle still un-selectable forever. Unlocking on open fixes those
 * in place, and is idempotent.
 *
 * ONLY those. A lock is also something the user sets — on a Patchwork
 * patch, to keep a placed piece where it is while the rest are arranged —
 * and this used to strip every lock on every seed on every reopen, so a
 * page of locked patches came back with all of them loose (bug report
 * 3b1ea348). The legacy lock is told from the user's by what came with it:
 * the builds that shipped the lock stored the whole SLOT rect (the full
 * page, for the squiggle) as the node bbox, over segments that span less.
 * A lock the user set sits on a node whose bbox already fits its segments
 * — a seed is boxed to its own segments from the scaffold on, and a patch's
 * slot rect IS that box — so a locked seed is a leftover only when its bbox
 * is the slot rect AND wider than its segments' own. Anything else keeps
 * its lock.
 *
 * While the node is still locked we also know its geometry was never touched
 * by the user, so this is the one safe moment to retighten a stale bbox: the
 * bbox is re-derived from the node's OWN stored segments, never from the
 * issue payload — nothing here can overwrite drawn geometry. (That stale
 * page-sized box was what gave the seed a page-sized selection box and made
 * Scene Outline double-tap frame the entire canvas.)
 *
 * A slot the format declares `locked` is skipped: its lock is deliberate and
 * current, not a leftover.
 *
 * No-op (reference-identical) when no seed wears a leftover lock, which is
 * every entry created from this build on.
 */
export function unlockSeedSvgSlots(state: CompositionState, config: ScaffoldEditorConfig): CompositionState {
  const seedSlots = new Map<string, CellBbox>();
  for (const node of config.scaffold) {
    // A slot that is SUPPOSED to be locked is not one of these: the lock is
    // how it was seeded, not a leftover from an old build (Patchwork's frame
    // and loop). Unlocking it here would quietly undo the format's own
    // decision on every reopen.
    if (node.kind === 'seedSvg' && !node.locked) seedSlots.set(node.slotId, slotBbox(node));
  }
  if (seedSlots.size === 0) return state;
  let changed = false;
  const svgObjects = state.svgObjects.map((svg) => {
    const slotId = slotIdOfNode(svg);
    if (slotId === null || !svg.locked) return svg;
    const slot = seedSlots.get(slotId);
    if (!slot || !isLegacySeedLock(svg, slot)) return svg;
    changed = true;
    const { locked, ...unlocked } = svg;
    return { ...unlocked, ...computeSVGBbox(svg.segments) };
  });
  return changed ? { ...state, svgObjects } : state;
}

// ── The app's own scaffold furniture ────────────────────────────────────
//
// What a format's fresh page arrives holding BEYOND its slots, its frame and
// its decor texts. CozyJournal has two kinds and the other two apps have
// none: magnetic poetry's word tiles, scattered clear of the frame, and
// Poise's T-posed Figgie rig with its hidden pose record. Those are the only
// three lines of drift in a file whose 36 declarations were otherwise
// byte-identical in CozyJournal's and DrawBots' copies, and they are drift in
// exactly one direction — two config members (`wordStickers`, `bornWithRig`)
// and one reader of the rig's geometry (`anyRigPosed`), all of them that
// app's own.
//
// One seam with three members rather than three seams, because the three
// questions are one question asked three ways: what does the furniture PUT on
// a fresh page, how many nodes is that (the edited rule's threshold —
// {@link scaffoldNodeCount}), and has the user TOUCHED any of it (floating a
// sticker into the mask and posing the rig both add no node and edit no slot,
// so each needs its own test — {@link isEntryEdited}). An app that answered
// one and not the others would have a page that counted its own furniture as
// the user's work. Every member is used, so dropping one fails this package's
// compile.
//
// Installed at module scope rather than handed in, because
// `buildScaffoldEntry` has 56 call sites across the two apps and their suites
// and takes no context object — the `registerFaceFetch` case of 6.1, not the
// `FontPack` one. Nothing installed means no furniture, which is the honest
// fallback: a format with no stickers and no rig seeds none either way.

export interface ScaffoldFurniture<TConfig extends ScaffoldEditorConfig = ScaffoldEditorConfig> {
  /** Ops seeding the furniture onto a fresh page, pushed after the frame
   *  group. Called once per scaffold build. */
  build(
    config: TConfig,
    issue: CommonFormatIssue,
    mintId: (kind: 'svg' | 'text' | 'image' | 'group') => string,
  ): CompUndoOp[];
  /** How many scene NODES `build` seeds, so the edited rule's node-count
   *  threshold includes them. Groups do not count — they live in
   *  `state.groups` rather than in the node arrays. */
  count(config: TConfig): number;
  /** Whether any of the furniture bears the user's hand: a sticker floated
   *  into the mask, a rig moved off its T-pose. Asked BEFORE the template
   *  baseline comparison, which is blind to both.
   *
   *  The whole composition rather than a {@link MarkScene}, because
   *  {@link isEntryEdited} has one in hand and a rule may need to read a
   *  node the narrow scene does not carry — CozyJournal's reads its rig's
   *  pose record off `texts` and the figure off `svgObjects`. */
  touched(config: TConfig, state: CompositionState): boolean;
}

let furniture: ScaffoldFurniture | undefined;

/**
 * Install the app's own scaffold furniture (its `web/formats/` does, at
 * module scope). Called with no rule — or by no app at all — a format's page
 * arrives holding its slots, its frame and its decor texts and nothing else.
 */
export function registerScaffoldFurniture<TConfig extends ScaffoldEditorConfig>(
  rule: ScaffoldFurniture<TConfig> | undefined,
): void {
  // The config every scaffold call is made with is the config of the app
  // that installed this rule — there is one app per page, the same invariant
  // `registerStoreNamespace` rests on — so widening the parameter here is
  // sound, and it is what keeps each app's own rule free of a cast. The
  // alternative is a generic threaded through a package that never needs to
  // know WHICH furniture a format carries, which is the shape §4.3 declined
  // for `ToolId` at stage 2 and for the config's ids at 6.3b.
  furniture = rule as ScaffoldFurniture | undefined;
}

/** The installed furniture, for the two readers outside this module
 *  ({@link scaffoldNodeCount} and {@link isEntryEdited}, both in
 *  `edited.ts`). */
export function scaffoldFurniture(): ScaffoldFurniture | undefined {
  return furniture;
}

/**
 * Whether a locked seed's lock is the OLD builds' leftover rather than the
 * user's: the node still wears the slot rect those builds stored as its
 * bbox, and its own segments span less than that. Repeat-tiled objects bbox
 * their tiling REGION, not the base tile, so their bbox is not the segment
 * AABB and nothing can be told from it (a seedSvg slot is never tiled
 * today; the guard keeps a lock there from being read as a leftover).
 */
function isLegacySeedLock(svg: SVGObject, slot: CellBbox): boolean {
  if (svg.segments.length === 0 || svg.tileMode === 'repeat') return false;
  if (!sameBbox(svg, slot)) return false;
  return !sameBbox(computeSVGBbox(svg.segments), slot);
}

/**
 * Build the placeObject ops that seed a fresh composition with a format's
 * scaffold, plus the slotId → nodeId map the prompt flow and completion
 * checks key off.
 *
 * `mintId` is caller-supplied (ids are minted by the reducer layer,
 * mirroring every other engine add-node path) and should honor the engine's
 * id namespaces — 'svg' → `svg_…`, 'text' → `txt_…`. Nothing routes a kind
 * off them (that is the array the node lands in), so this is a legibility
 * convention rather than a correctness one.
 *
 * Per kind:
 * - imageSlot → an unlocked rounded-rect SVGObject frame with a subtle
 *   fill. The photos tool later REPLACES it with the real ImageObject and
 *   must carry the `slot:<slotId>` name over to the image node (editor's
 *   job; isSlotFilled accepts either the mapped id or the name tag).
 *   When the slot sets `seedImage`, it is instead seeded as a real ImageObject
 *   carrying the same `slot:<id>` tag (so it frames/recovers/swaps like the SVG
 *   frame) but no blob (photoPlaceholder.ts) — the canvas draws the "no image"
 *   mountain for it. Its sentinel `imageId` is what lets isSlotFilled ignore it
 *   until the user picks a real photo.
 * - textSlot → a TextObject holding the placeholder text, slot style
 *   merged over SLOT_TEXT_DEFAULT_STYLE.
 * - seedSvg → an ordinary, EDITABLE SVGObject from the frozen issue payload
 *   (e.g. the day's squiggle), filled when the payload carries a `fillColor`
 *   and carrying an empty pattern grid over that fill when the slot asks
 *   for one (`patternFill` — Patchwork's patches). Seeded once here and persisted
 *   from there like any other node: reshaping, moving, recoloring, filling or deleting it are
 *   the user's edits and are saved. Nothing re-seeds it on a later open.
 *
 * Slot rects (canonical 0..32 cell space) are used directly as node
 * bboxes, EXCEPT for seedSvg: its payload segments are expected to live
 * inside the slot rect, and the node takes their tight AABB instead (see
 * `seedSvgBbox`) so the selection box hugs the drawn strokes.
 *
 * Beyond the slots, the config's `decorTexts` (the Haiku's date stamp)
 * are seeded as ordinary editable TextObjects tagged `decor:<id>` — page chrome
 * the prompt flow and completion never see, and `slotNodeIds` never maps.
 */
export function buildScaffoldEntry(
  config: ScaffoldEditorConfig,
  issue: CommonFormatIssue,
  mintId: (kind: 'svg' | 'text' | 'image' | 'group') => string,
): { ops: CompUndoEntry; slotNodeIds: Record<string, string>; blobs: Record<string, Uint8Array> } {
  const ops: CompUndoOp[] = [];
  const slotNodeIds: Record<string, string> = {};
  const blobs: Record<string, Uint8Array> = {};

  for (const node of config.scaffold) {
    switch (node.kind) {
      case 'imageSlot': {
        if (node.seedImage) {
          // Seed a real ImageObject in place of the SVG frame. Same `slot:<id>`
          // tag (so it groups into the frame, recovers, and swaps on fill
          // exactly like the frame did); the sentinel `imageId` is how
          // isSlotFilled tells it apart from a real picked photo. It carries no
          // blob, so the canvas draws the "no image" mountain (missingImageArt)
          // until the user picks a photo.
          const id = mintId('image');
          const image: ImageObject = {
            id,
            name: slotName(node.slotId),
            imageId: photoPlaceholderImageId(),
            mimeType: PHOTO_PLACEHOLDER_MIME,
            pixelWidth: PHOTO_PLACEHOLDER_PIXEL_W,
            pixelHeight: PHOTO_PLACEHOLDER_PIXEL_H,
            ...slotBbox(node),
          };
          ops.push({ op: 'placeObject', kind: 'image', item: image });
          slotNodeIds[node.slotId] = id;
          break;
        }
        const id = mintId('svg');
        const frame = buildShapeSVGObject(id, 'roundedRect', slotBbox(node), IMAGE_FRAME_STROKE, {
          fillColor: IMAGE_FRAME_FILL,
        });
        frame.name = slotName(node.slotId); // unlocked: the user replaces it
        ops.push({ op: 'placeObject', kind: 'svg', item: frame });
        slotNodeIds[node.slotId] = id;
        break;
      }
      case 'textSlot': {
        const id = mintId('text');
        const text: TextObject = {
          id,
          name: slotName(node.slotId),
          content: node.placeholder,
          style: { ...SLOT_TEXT_DEFAULT_STYLE, ...node.style },
          ...slotBbox(node),
        };
        ops.push({ op: 'placeObject', kind: 'text', item: text });
        slotNodeIds[node.slotId] = id;
        break;
      }
      case 'seedSvg': {
        const payload = parseSeedSvgPayload(issue, node);
        const id = mintId('svg');
        const svg: SVGObject = {
          id,
          name: slotName(node.slotId),
          segments: payload.segments,
          color: payload.color,
          // A seed that is an AREA arrives filled (Patchwork's patches);
          // one that is only a line has no fillColor and arrives hollow.
          ...(payload.fillColor ? { fillColor: payload.fillColor } : {}),
          // Unlocked unless the slot asks otherwise: Reimagine's squiggle is
          // a starting point and editing it is the game, while Patchwork
          // locks the two curves its patches were cut from so colouring a
          // piece in cannot drag the lines under it.
          ...(node.locked ? { locked: true } : {}),
          // …and HIDDEN where the slot asks: a seed that is scaffolding
          // rather than picture (Patchwork's two curves, which every patch
          // already draws its own copy of). Present in the document and in
          // the Scene Outline, just not on the page.
          ...(node.hidden ? { hidden: true } : {}),
          ...seedSvgBbox(payload.segments, node),
        };
        ops.push({
          op: 'placeObject',
          kind: 'svg',
          // …and carrying a freshly printed pattern fill where the slot asks
          // for one (Patchwork's patches), so a piece arrives as cloth and
          // is one double tap away from being repainted.
          item: node.patternFill ? seedPatternFill(svg, node.patternFill) : svg,
        });
        slotNodeIds[node.slotId] = id;
        break;
      }
    }
  }

  // Decorative text (the Haiku date stamp): an ordinary, editable text
  // node seeded on top of the scaffold slots, tagged `decor:<id>` rather than
  // `slot:<id>` ⇒ invisible to the prompt flow / completion / slot recovery.
  // Placed before the frame is grouped so an `inFrame` decor can join it as a
  // member; last in that group ⇒ front-most inside the frame.
  const decorMembers: { decorId: string; id: string }[] = [];
  for (const dec of config.decorTexts ?? []) {
    const id = mintId('text');
    const text: TextObject = {
      id,
      name: decorName(dec.decorId),
      content: dec.content,
      style: { ...SLOT_TEXT_DEFAULT_STYLE, ...dec.style },
      cellX: dec.cellX,
      cellY: dec.cellY,
      cellWidth: dec.cellWidth,
      cellHeight: dec.cellHeight,
    };
    ops.push({ op: 'placeObject', kind: 'text', item: text });
    if (dec.inFrame && config.frame) decorMembers.push({ decorId: dec.decorId, id });
  }

  // Optional Figma-style frame: wrap the named member slots + a rectangular
  // boundary into an `isFrame` group. The boundary is a closed rect `isMask`
  // (so the mask pipeline resolves the frame's clip rect) placed BACK-MOST so
  // any background paints behind the members; grouping clips the members to it
  // on canvas (CanvasSurface) and the export viewBox pins to it exactly
  // (compositionSVGCore). The boundary is hidden (clip only) unless the frame
  // declares a background. Members keep their `slot:<id>` (or `decor:<id>`)
  // tag — grouping never touches a name — so the guided flow and the chrome
  // readers still resolve them.
  if (config.frame) {
    const f = config.frame;
    const members = [
      ...f.memberSlotIds
        .map((sid) => ({ tag: slotName(sid), id: slotNodeIds[sid] as string | undefined })),
      // `inFrame` decor last ⇒ front-most member, over the slots it garnishes.
      ...decorMembers.map((d) => ({ tag: decorName(d.decorId), id: d.id as string | undefined })),
    ].filter((m): m is { tag: string; id: string } => m.id != null);
    // Draw the frame when it has members to clip OR a visible background of its
    // own — the latter is a decorative board with no seeded contents (magnetic
    // poetry's empty "Today's Hopes, Dreams, Plans" frame). A background-less
    // frame with no members would be an invisible clip around nothing, so skip.
    if (members.length > 0 || f.background) {
      const rectId = mintId('svg');
      const bbox = { cellX: f.cellX, cellY: f.cellY, cellWidth: f.cellWidth, cellHeight: f.cellHeight };
      const boundary = buildShapeSVGObject(
        rectId,
        'rect',
        bbox,
        f.background ?? FRAME_BOUNDARY_COLOR,
        f.background ? { fillColor: f.background } : undefined,
      );
      boundary.isMask = true;
      if (!f.background) boundary.hidden = true; // invisible clip boundary
      // Seed the frame's default border onto the boundary rect's effects, so it
      // renders (CanvasSurface BorderOverlay) + edits exactly like a user-added
      // border, honoring inside/center/outside.
      if (f.border) boundary.effects = { ...boundary.effects, border: f.border };
      // Placed first ⇒ back-most in sceneOrder (behind the members).
      ops.unshift({ op: 'placeObject', kind: 'svg', item: boundary });
      const groupId = mintId('group');
      ops.push({
        op: 'groupFigures',
        figureIds: [rectId, ...members.map((m) => m.id)],
        groupId,
        // The frame group is labeled by the format's frame name when it sets
        // one (e.g. "Today's Hopes, Dreams, Plans"), else the day's format
        // label — see buildSceneOutlineModel's groupNames.
        groupName: f.name ?? issue.label ?? 'Frame',
        isFrame: true,
      });
    }
  }

  // …and whatever furniture the app's own formats arrive holding, pushed
  // AFTER the frame group so it paints on top of it (and its photo) in
  // sceneOrder. CozyJournal's installed rule seeds magnetic poetry's word
  // tiles and Poise's T-posed rig; the other two apps install nothing.
  ops.push(...(furniture?.build(config, issue, mintId) ?? []));

  return { ops, slotNodeIds, blobs };
}

/**
 * Put the page back to the state it OPENED in: every piece the day dealt,
 * where it was dealt and in the colour it was dealt in — including the
 * ones the player has since deleted.
 *
 * Built by seeding the format's scaffold onto a blank composition and
 * swapping the whole scene for it in ONE `replaceScene` op, rather than by
 * reloading the page from disk. Two things follow from that, and both are
 * the point:
 *
 * - It is a single UNDO ENTRY. A reset pressed by mistake is one undo
 *   away, exactly like any other move on this page, and nothing has to
 *   remember the old scene for it — the op carries both sides.
 * - It rebuilds from the ISSUE, not from what the page happens to hold,
 *   so a deleted patch comes back. Nothing about the current scene is
 *   read except to fill the op's `old` side.
 *
 * Everything outside the scene is left ALONE: the camera, the grid level,
 * the page's name, the snap setting. They are where the player is
 * looking, not what they made, and yanking the view about would read as
 * the page having been replaced rather than tidied. The one exception is
 * the page's GROUND, which is document content the format declares
 * (`canvas.background`) and so goes back with the rest.
 *
 * The freshly minted `slotNodeIds` come back with the entry: the prompt
 * flow and the completion checks key off that map, and every id in the
 * scene has just changed.
 */
export function buildResetToScaffold(
  state: CompositionState,
  config: ScaffoldEditorConfig,
  issue: CommonFormatIssue,
  mintId: (kind: 'svg' | 'text' | 'image' | 'group') => string,
): { entry: CompUndoEntry; blobs: Record<string, Uint8Array>; slotNodeIds: Record<string, string> } {
  const { ops, slotNodeIds, blobs } = buildScaffoldEntry(config, issue, mintId);
  // The scaffold's ops are placements, so the collections they produce on a
  // blank page ARE the opening scene — the same ones boot builds
  // (EditorShell's scaffoldFresh), through the same call.
  const fresh = applyCompOps(makeBlankComposition(state.id, state.name), ops);
  const entry: CompUndoEntry = [{
    op: 'replaceScene',
    oldFigures: state.figures, newFigures: fresh.figures,
    oldSVGObjects: state.svgObjects, newSVGObjects: fresh.svgObjects,
    oldImages: state.images ?? [], newImages: fresh.images ?? [],
    oldGroups: state.groups, newGroups: fresh.groups,
    oldSceneOrder: state.sceneOrder, newSceneOrder: fresh.sceneOrder,
    // The optional collections are spelled out on BOTH sides rather than
    // left off: absent means "this entry predates the field, leave it
    // alone" to the op, and a reset that left the player's paint, text or
    // patterns standing over a fresh scene would not be a reset.
    oldTexts: state.texts ?? [], newTexts: fresh.texts ?? [],
    oldPaints: state.paintObjects ?? [], newPaints: fresh.paintObjects ?? [],
    oldPatterns: state.patternObjects ?? [], newPatterns: fresh.patternObjects ?? [],
  }];
  // The ground, when there is one to put back or one to take away. Skipped
  // when the format declares none and the page carries none, so the common
  // case commits one op and not two.
  if (config.canvas.background !== undefined || state.background !== undefined) {
    entry.push({
      op: 'setBackground', oldPaint: state.background, newPaint: config.canvas.background,
    });
  }
  return { entry, blobs, slotNodeIds };
}

/** The page rect in canonical cell space for a format's canvas aspect — the
 *  0..32-wide export rect the scatter centres on. */
export function pageRectCells(aspect: number): Rect {
  return {
    cellX: 0,
    cellY: 0,
    cellWidth: WORLD_CELLS,
    cellHeight: pageHeightCells(aspect),
  };
}

/**
 * A page-sized rect (the format's aspect, 32 cells wide) centred on `rect`:
 * the field the word scatter grows from when the shape the words gather
 * around is NOT where the page is. A template's Mask can sit anywhere in
 * the author's artwork, and the words must heap up around IT — a scatter
 * centred on the page would pile them off in a corner, leaving the mask
 * bare.
 */
export function pageRectCentredOn(rect: Rect, aspect: number): Rect {
  const page = pageRectCells(aspect);
  return {
    cellX: rect.cellX + rect.cellWidth / 2 - page.cellWidth / 2,
    cellY: rect.cellY + rect.cellHeight / 2 - page.cellHeight / 2,
    cellWidth: page.cellWidth,
    cellHeight: page.cellHeight,
  };
}

/** The bbox of a rect-shaped thing (a ScaffoldFrame, a resolved frame mask)
 *  as a plain scatter Rect. */
export function frameRectOf(frame: Rect): Rect {
  return {
    cellX: frame.cellX,
    cellY: frame.cellY,
    cellWidth: frame.cellWidth,
    cellHeight: frame.cellHeight,
  };
}

/** The rect a format's word scatter keeps clear: its configured frame, or the
 *  whole page when it declares none. */
export function configFrameRect(config: ScaffoldEditorConfig): Rect {
  return config.frame ? frameRectOf(config.frame) : pageRectCells(config.canvas.aspect);
}

/**
 * The card ONE word tile occupies, centered on `(centerX, centerY)`: its text
 * measured at {@link STICKER_TEXT_STYLE} and grown by {@link
 * STICKER_PAD_CELLS} on every side.
 *
 * The node bbox IS the card, so the selection box and hit area match what is
 * drawn; the scatter above already reserved at least this much padding plus a
 * gap, so a tile is never widened into its neighbour. Free Play's Word tool
 * sizes its tap-placed tiles through this same helper — a dealt word is the
 * same card the board is strewn with.
 */
export function wordStickerCard(word: string, centerX: number, centerY: number): Rect {
  const { width, height } = measureTextBbox(word, STICKER_TEXT_STYLE);
  const cellWidth = width + 2 * STICKER_PAD_CELLS;
  const cellHeight = height + 2 * STICKER_PAD_CELLS;
  return {
    cellX: centerX - cellWidth / 2,
    cellY: centerY - cellHeight / 2,
    cellWidth,
    cellHeight,
  };
}

/**
 * Resolve a textSlot's TextObject in the composition: the mapped node id
 * first, then any text node carrying the slot's name tag (covers editors
 * that re-mint the node, mirroring the imageSlot contract). Shared by
 * isSlotFilled and the completion rules so the lookup can't drift.
 */
export function slotTextNode(
  state: CompositionState,
  slot: ScaffoldNode & { kind: 'textSlot' },
  slotNodeIds: Record<string, string>,
): TextObject | undefined {
  const texts = state.texts ?? [];
  const nodeId = slotNodeIds[slot.slotId];
  const tag = slotName(slot.slotId);
  return texts.find((t) => t.id === nodeId) ?? texts.find((t) => t.name === tag);
}

/**
 * Resolve a seedSvg slot's SVGObject in the composition, the same two ways
 * round as `slotTextNode`: the mapped node id first, then any path node
 * carrying the slot's name tag.
 */
export function slotSvgNode(
  state: CompositionState,
  slot: ScaffoldNode & { kind: 'seedSvg' },
  slotNodeIds: Record<string, string>,
): SVGObject | undefined {
  const svgs = state.svgObjects ?? [];
  const nodeId = slotNodeIds[slot.slotId];
  const tag = slotName(slot.slotId);
  return svgs.find((o) => o.id === nodeId) ?? svgs.find((o) => o.name === tag);
}

/**
 * Whether `text` is a scaffold text slot still showing its seeded
 * placeholder — the slot's name tag with the slot's exact placeholder
 * content, i.e. the user has never rewritten it. The editor treats such a
 * text like the plain TEXT_PLACEHOLDER: tapping to edit opens an EMPTY
 * field (typing replaces the whole line, no manual clearing), and
 * dismissing without typing leaves the placeholder standing.
 */
export function isUneditedTextSlotPlaceholder(
  scaffold: readonly ScaffoldNode[] | undefined,
  text: TextObject,
): boolean {
  return (scaffold ?? []).some((slot) => slot.kind === 'textSlot'
    && text.name === slotName(slot.slotId) && text.content === slot.placeholder);
}

/**
 * The content a text edit COMMITS: as typed — except the very first edit of
 * a template-seeded line the format lists by name (ScaffoldEditorConfig.
 * templateTextQuotes; Greeting's "Title"), which is wrapped in straight
 * double quotes: MyTitle confirms as "MyTitle". "First" is read off the
 * instance baseline (edited.ts): the line still reads exactly what the
 * template wrote before this edit, so a later edit of the same line — or
 * an edit of a line the template didn't seed — commits as typed. Content
 * the user already quoted is left alone rather than quoted twice.
 */
export function templateTextCommitContent(
  config: Pick<ScaffoldEditorConfig, 'templateTextQuotes'>,
  baseline: TemplateBaseline | undefined,
  /** The text as it stood BEFORE the edit (the pre-edit snapshot). */
  before: TextObject | undefined,
  content: string,
): string {
  if (!before || !config.templateTextQuotes?.length) return content;
  if (!before.name || !config.templateTextQuotes.includes(before.name)) return content;
  if (baseline?.texts[before.id] !== before.content) return content;
  if (isQuoted(content)) return content;
  return `"${content}"`;
}

const QUOTE_PAIRS: readonly [string, string][] = [['"', '"'], ['\u201c', '\u201d']];

/** Whether `s` already reads as one quoted line — straight or curly. */
function isQuoted(s: string): boolean {
  return s.length >= 2 && QUOTE_PAIRS.some(([open, close]) => s.startsWith(open) && s.endsWith(close));
}

/**
 * Whether a scaffold slot counts as filled in the current composition.
 * Takes the whole ScaffoldNode (not just the kind) because textSlot needs
 * the original placeholder to tell "edited" from "untouched".
 *
 * - imageSlot: the mapped node id now resolves to an ImageObject, OR any
 *   image node carries the slot's name tag (covers the photos tool
 *   replacing the frame with a freshly minted image id). The seeded
 *   placeholder image (sentinel `imageId`) does NOT count — it stands in
 *   for the empty slot until the user picks a real photo.
 * - textSlot: the slot's text node exists with non-empty content that
 *   differs from the placeholder.
 * - seedSvg: always filled (pre-seeded content, nothing to do).
 */
export function isSlotFilled(
  state: CompositionState,
  slot: ScaffoldNode,
  slotNodeIds: Record<string, string>,
): boolean {
  const nodeId = slotNodeIds[slot.slotId];
  const tag = slotName(slot.slotId);
  switch (slot.kind) {
    case 'imageSlot': {
      const images = state.images ?? [];
      // Per image, for the same reason as `edited.ts`: the sentinel comes
      // through `storeKey`, which throws with no namespace installed, and a
      // slot with no image must not need one.
      return images.some(
        (img) => (img.id === nodeId || img.name === tag) && img.imageId !== photoPlaceholderImageId(),
      );
    }
    case 'textSlot': {
      const text = slotTextNode(state, slot, slotNodeIds);
      if (!text) return false;
      return text.content.trim().length > 0 && text.content !== slot.placeholder;
    }
    case 'seedSvg':
      return true;
  }
}
