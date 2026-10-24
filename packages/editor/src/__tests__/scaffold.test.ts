import { applyCompOps, computeSVGBbox } from '@/engine/compositionOps';
import { registerStoreNamespace } from '../store/storeKeys';
import { PathSegment, SVGObject, TextObject } from '@/engine/types';
import {
  SLOT_TEXT_DEFAULT_STYLE,
  buildScaffoldEntry,
  decorIdOfNode,
  decorName,
  isSlotFilled,
  isUneditedTextSlotPlaceholder,
  slotIdOfNode,
  slotName,
  slotTextNode,
  unlockSeedSvgSlots,
  templateTextCommitContent,
} from '../formats/scaffold';
import type { ScaffoldNode } from '../formats/editorConfig';
import { isUnfilledPhotoPlaceholder, photoPlaceholderImageId } from '../formats/photoPlaceholder';
import {
  SCAFFOLD_FOUR_SLOTS,
  type TestEditorConfig,
  makeFormatIssue,
  makeImage,
  makeMintId,
  makeScaffoldConfig,
  makeScaffoldState,
  makeText,
} from './test-utils';

// The scaffold a format seeds onto a fresh page (formats/scaffold.ts),
// driven over a MADE-UP app the way `editorConfig.test.ts` drives its own.
// What each app keeps is its own: CozyJournal's word-sticker scatter, which
// is its `ScaffoldFurniture` rule, and each app's real configs.
//
// The sentinel the photo slot carries is built from the app's namespace
// (formats/photoPlaceholder.ts), and `storeKey` refuses to build a key with
// none installed — so this installs one, as `store/storeKeys.ts` says a
// test must.
beforeEach(() => {
  registerStoreNamespace('test');
});

function makeSeedImageConfig(overrides: Partial<TestEditorConfig> = {}): TestEditorConfig {
  return makeScaffoldConfig({
    scaffold: [
      { kind: 'imageSlot', slotId: 'photo', hint: 'Tap to add today’s photo', seedImage: true, cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 42 },
      ...SCAFFOLD_FOUR_SLOTS.slice(1),
    ],
    ...overrides,
  });
}

/** The Daily Haiku's decorative date stamp, as a config + its content. */
const STAMP = 'Wednesday 08-05-2026';

function makeDecorConfig(overrides: Partial<TestEditorConfig> = {}): TestEditorConfig {
  return makeScaffoldConfig({
    decorTexts: [
      {
        decorId: 'dateStamp',
        inFrame: true,
        content: STAMP,
        style: { fontId: 'caveat', align: 'right' },
        cellX: 11, cellY: 1, cellWidth: 20, cellHeight: 2.4,
      },
    ],
    ...overrides,
  });
}

// Scaffold construction + slot-filled checks (formats/scaffold.ts).
// The build tests apply the generated ops through the REAL engine reducer
// (applyCompOps) so the placeObject contract can't silently drift.

const SQUIGGLE_SEGMENTS: PathSegment[] = [
  { kind: 'line', start: [4, 4], end: [12, 9] },
  { kind: 'line', start: [12, 9], end: [20, 5] },
];

const SQUIGGLE_PAYLOAD = {
  seed: {
    segments: SQUIGGLE_SEGMENTS,
    color: { r: 30, g: 30, b: 200 },
  },
};

function makeSquiggleConfig(): TestEditorConfig {
  return makeScaffoldConfig({
    formatId: 'scaffolded',
    scaffold: [
      { kind: 'seedSvg', slotId: 'seed', payloadKey: 'seed', cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32 },
    ],
    promptFlow: [{ id: 'p-free', kind: 'free' }],
    completion: { kind: 'anyEdit' },
  });
}

describe('slot name tags', () => {
  test('slotName / slotIdOfNode round-trip', () => {
    expect(slotName('photo')).toBe('slot:photo');
    expect(slotIdOfNode({ name: 'slot:photo' })).toBe('photo');
  });

  test('slotIdOfNode is null for unnamed and non-slot nodes', () => {
    expect(slotIdOfNode({})).toBeNull();
    expect(slotIdOfNode({ name: 'My drawing' })).toBeNull();
  });

  test('slotIdOfNode reads the one name a node has — grouping never moves a tag', () => {
    // The Reimagine seed grouped with the strokes drawn around it is still
    // the seed: its `slot:squiggle` name stays its own inside the group
    // (compositionOps groupFigures leaves names alone), so the reveal inks
    // the seed on the page, not the dealt one.
    expect(slotIdOfNode({ name: 'slot:seed', groupId: 'g1' } as { name?: string })).toBe('seed');
    expect(slotIdOfNode({ name: 'Group 1' })).toBeNull();
  });

  test('decorName / decorIdOfNode round-trip', () => {
    expect(decorName('dateStamp')).toBe('decor:dateStamp');
    expect(decorIdOfNode({ name: 'decor:dateStamp' })).toBe('dateStamp');
    // Grouped into a frame, the tag is still the name.
    expect(decorIdOfNode({ name: 'decor:dateStamp', groupId: 'gf' } as { name?: string })).toBe('dateStamp');
    // A display name of its own is a name, not decor.
    expect(decorIdOfNode({ name: 'Date' })).toBeNull();
    expect(decorIdOfNode({ name: 'slot:line1' })).toBeNull();
  });

  test('the decor and slot namespaces do not overlap', () => {
    expect(decorIdOfNode({ name: 'slot:photo' })).toBeNull();
    expect(slotIdOfNode({ name: 'decor:dateStamp' })).toBeNull();
    expect(decorIdOfNode({})).toBeNull();
    expect(decorIdOfNode({ name: 'My drawing' })).toBeNull();
  });
});

describe('buildScaffoldEntry', () => {
  test('haiku scaffold ops apply through the engine reducer', () => {
    const { mintId } = makeMintId();
    const { ops, slotNodeIds } = buildScaffoldEntry(makeScaffoldConfig(), makeFormatIssue(), mintId);
    const state = applyCompOps(makeScaffoldState(), ops);

    // One SVG frame for the image slot, three text nodes for the lines.
    expect(state.svgObjects).toHaveLength(1);
    expect(state.texts).toHaveLength(3);
    expect(state.figures).toHaveLength(0);
    expect(state.images).toHaveLength(0);

    // Every placed node landed in sceneOrder (placeObject appends).
    for (const id of Object.values(slotNodeIds)) {
      expect(state.sceneOrder).toContain(id);
    }

    // Frame: name-tagged, unlocked, bbox = slot rect, subtle fill.
    const frame = state.svgObjects[0];
    expect(frame.id).toBe(slotNodeIds['photo']);
    expect(frame.name).toBe('slot:photo');
    expect(frame.locked).toBeUndefined();
    expect(frame.fillColor).toBeDefined();
    expect(frame).toMatchObject({ cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 24 });

    // Text slots: placeholder content, slot style merged over the default.
    const line1 = state.texts!.find((t) => t.id === slotNodeIds['line1'])!;
    expect(line1.name).toBe('slot:line1');
    expect(line1.content).toBe('First line…');
    expect(line1.style.fontId).toBe(SLOT_TEXT_DEFAULT_STYLE.fontId);
    expect(line1).toMatchObject({ cellX: 2, cellY: 24, cellWidth: 28, cellHeight: 2 });
  });

  test('per-slot style overrides merge over SLOT_TEXT_DEFAULT_STYLE', () => {
    const config = makeScaffoldConfig({
      scaffold: [
        { kind: 'textSlot', slotId: 'title', hint: '', placeholder: 'Title…', style: { size: 3, bold: true }, cellX: 0, cellY: 0, cellWidth: 16, cellHeight: 4 },
      ],
      promptFlow: [{ id: 't', kind: 'fillSlot', slotId: 'title', title: 'Title' }],
    });
    const { mintId } = makeMintId();
    const { ops } = buildScaffoldEntry(config, makeFormatIssue(), mintId);
    const state = applyCompOps(makeScaffoldState(), ops);
    const title = state.texts![0];
    expect(title.style.size).toBe(3);
    expect(title.style.bold).toBe(true);
    expect(title.style.color).toEqual(SLOT_TEXT_DEFAULT_STYLE.color); // untouched default
  });

  test('mintId is called with the right kind per slot, in scaffold order', () => {
    const { mintId, calls } = makeMintId();
    buildScaffoldEntry(makeScaffoldConfig(), makeFormatIssue(), mintId);
    expect(calls).toEqual(['svg', 'text', 'text', 'text']);

    const { mintId: mintId2, calls: calls2 } = makeMintId();
    buildScaffoldEntry(makeSquiggleConfig(), makeFormatIssue(SQUIGGLE_PAYLOAD), mintId2);
    expect(calls2).toEqual(['svg']);
  });

  test('seedSvg places an UNLOCKED, VISIBLE node from the frozen issue payload', () => {
    const { mintId } = makeMintId();
    const { ops, slotNodeIds } = buildScaffoldEntry(
      makeSquiggleConfig(),
      makeFormatIssue(SQUIGGLE_PAYLOAD),
      mintId,
    );
    const state = applyCompOps(makeScaffoldState(), ops);
    const squiggle = state.svgObjects.find((s) => s.id === slotNodeIds['seed'])!;
    // The day's squiggle is a starting point, not a lock: editing it is the game.
    expect(squiggle.locked).toBeFalsy();
    expect(squiggle.hidden).toBeFalsy();
    expect(squiggle.name).toBe('slot:seed');
    expect(squiggle.segments).toEqual(SQUIGGLE_PAYLOAD.seed.segments);
    expect(squiggle.color).toEqual(SQUIGGLE_PAYLOAD.seed.color);
  });

  test('seedSvg arrives HIDDEN where the slot asks — scaffolding, not picture', () => {
    // Patchwork's two curves: the seams its patches were cut along, which
    // every patch already draws its own copy of. Hidden is the state it
    // arrives in and not a rule — the node is in the document and in the
    // Scene Outline, whose eye brings it back — so it is a flag ON the
    // placed object, never a missing op.
    const { mintId } = makeMintId();
    const config = makeSquiggleConfig();
    const hiddenSeed = {
      ...config,
      scaffold: config.scaffold.map((n: ScaffoldNode) => ({ ...n, hidden: true, locked: true })),
    };
    const { ops, slotNodeIds } = buildScaffoldEntry(
      hiddenSeed, makeFormatIssue(SQUIGGLE_PAYLOAD), mintId,
    );
    expect(ops).toHaveLength(1);
    const state = applyCompOps(makeScaffoldState(), ops);
    const seed = state.svgObjects.find((s) => s.id === slotNodeIds['seed'])!;
    expect(seed.hidden).toBe(true);
    expect(seed.locked).toBe(true);
    // The two are independent flags: asking for neither leaves both off
    // (the test above), and the geometry is the same either way.
    expect(seed.segments).toEqual(SQUIGGLE_PAYLOAD.seed.segments);
  });

  test('seedSvg takes a PRINTED pattern fill when its slot asks for one', () => {
    // Patchwork's patches open already printed. The tile is
    // `size` cells square and one repeat covers `gridCells` of the page, so
    // a 2×2 tile asked for against a 3-cell square repeats every 3 cells
    // however big the shape is.
    const config = makeSquiggleConfig();
    const slot = config.scaffold[0] as ScaffoldNode & { kind: 'seedSvg' };
    const patterned = {
      ...config,
      scaffold: [{ ...slot, patternFill: { size: 2, gridCells: 3 } }],
    };
    const { mintId } = makeMintId();
    const { ops, slotNodeIds } = buildScaffoldEntry(
      patterned, makeFormatIssue(SQUIGGLE_PAYLOAD), mintId,
    );
    const seeded = applyCompOps(makeScaffoldState(), ops).svgObjects
      .find((o) => o.id === slotNodeIds['seed'])!;
    expect(seeded.patternFill).toMatchObject({ size: 2, tileL0: 3 });
    expect(seeded.patternFill!.cells).toHaveLength(4);
    // Printed: every cell holds a tile, laid under the H+V mirror a first
    // print uses and inked in the seed's own stroke colour.
    expect(seeded.patternFill!.cells.every((c) => c != null)).toBe(true);
    expect(seeded.patternFill!.symmetry).toMatchObject({ mirrorH: true, mirrorV: true });
    for (const c of seeded.patternFill!.cells) {
      if (c?.type !== 'sprite') continue;
      expect({ r: c.tintR, g: c.tintG, b: c.tintB }).toEqual(seeded.color);
    }
    // …and a slot that does not ask stays bare (the squiggle is a line).
    const { mintId: plain } = makeMintId();
    const bare = applyCompOps(makeScaffoldState(),
      buildScaffoldEntry(config, makeFormatIssue(SQUIGGLE_PAYLOAD), plain).ops).svgObjects[0];
    expect(bare.patternFill).toBeUndefined();
  });

  test('seedSvg bbox hugs the segments, NOT the (full-page) slot rect', () => {
    const { mintId } = makeMintId();
    const { ops, slotNodeIds } = buildScaffoldEntry(
      makeSquiggleConfig(),
      makeFormatIssue(SQUIGGLE_PAYLOAD),
      mintId,
    );
    const state = applyCompOps(makeScaffoldState(), ops);
    const squiggle = state.svgObjects.find((s) => s.id === slotNodeIds['seed'])!;
    // Segments span x 4..20, y 4..9; the slot rect is the whole 32×32 page.
    expect(squiggle).toMatchObject({ cellX: 4, cellY: 4, cellWidth: 16, cellHeight: 5 });
    // …and it agrees with the engine's own SVG bbox (what selection,
    // Scene Outline framing and group bounds all derive from segments).
    expect(computeSVGBbox(squiggle.segments)).toEqual({
      cellX: squiggle.cellX, cellY: squiggle.cellY,
      cellWidth: squiggle.cellWidth, cellHeight: squiggle.cellHeight,
    });
  });

  test('seedSvg bbox covers an arc payload (quarter-arc endpoints)', () => {
    const { mintId } = makeMintId();
    const payload = {
      seed: {
        segments: [{ kind: 'arc', start: [8, 8], end: [12, 12], center: [12, 8] }],
        color: { r: 0, g: 0, b: 0 },
      },
    };
    const { ops, slotNodeIds } = buildScaffoldEntry(makeSquiggleConfig(), makeFormatIssue(payload), mintId);
    const state = applyCompOps(makeScaffoldState(), ops);
    const arc = state.svgObjects.find((s) => s.id === slotNodeIds['seed'])!;
    expect(arc).toMatchObject({ cellX: 8, cellY: 8, cellWidth: 4, cellHeight: 4 });
  });

  test('seedSvg with no segments falls back to the slot rect', () => {
    const { mintId } = makeMintId();
    const { ops, slotNodeIds } = buildScaffoldEntry(
      makeSquiggleConfig(),
      makeFormatIssue({ seed: { segments: [], color: { r: 1, g: 2, b: 3 } } }),
      mintId,
    );
    const state = applyCompOps(makeScaffoldState(), ops);
    const empty = state.svgObjects.find((s) => s.id === slotNodeIds['seed'])!;
    expect(empty).toMatchObject({ cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32 });
  });

  test('imageSlot seedImage: seeds a byte-less placeholder ImageObject, slot-tagged', () => {
    const { mintId, calls } = makeMintId();
    const { ops, slotNodeIds, blobs } = buildScaffoldEntry(makeSeedImageConfig(), makeFormatIssue(), mintId);
    const state = applyCompOps(makeScaffoldState(), ops);

    // Real image node in place of the SVG frame, carrying the slot tag.
    expect(state.svgObjects).toHaveLength(0);
    expect(state.images).toHaveLength(1);
    const img = state.images![0];
    expect(img.id).toBe(slotNodeIds['photo']);
    expect(img.name).toBe('slot:photo');
    expect(img.imageId).toBe(photoPlaceholderImageId());
    expect(img).toMatchObject({ cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 42 });

    // No blob for the placeholder: the sentinel imageId resolves to an empty
    // src so the canvas draws the "no image" mountain until a photo is picked.
    expect(blobs[photoPlaceholderImageId()]).toBeUndefined();

    // Minted as an image (img_…), so SCENE_ADAPTERS resolve it as an image.
    expect(calls[0]).toBe('image');
  });

  test('imageSlot seedImage: the placeholder image groups into the page frame', () => {
    const { mintId } = makeMintId();
    const config = makeSeedImageConfig({
      frame: { cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 42, memberSlotIds: ['photo', 'line1', 'line2', 'line3'] },
    });
    const { ops, slotNodeIds } = buildScaffoldEntry(config, makeFormatIssue(), mintId);
    const state = applyCompOps(makeScaffoldState(), ops);
    const img = state.images!.find((i) => i.id === slotNodeIds['photo'])!;

    // A frame member: grouped, its slot tag still its name, and back-most
    // (behind the three lines) in sceneOrder.
    expect(img.groupId).toBeDefined();
    expect(img.name).toBe('slot:photo');
    const order = state.sceneOrder;
    const linePos = ['line1', 'line2', 'line3'].map((s) => order.indexOf(slotNodeIds[s]));
    expect(Math.min(...linePos)).toBeGreaterThan(order.indexOf(img.id));
  });

  test('decorTexts: seeds an unlocked, decor-tagged text node (not a slot)', () => {
    const { mintId } = makeMintId();
    const { ops, slotNodeIds } = buildScaffoldEntry(makeDecorConfig(), makeFormatIssue(), mintId);
    const state = applyCompOps(makeScaffoldState(), ops);

    const stamp = (state.texts ?? []).find((t) => t.content === STAMP)!;
    expect(stamp).toBeDefined();
    // Unlocked: the stamp is the user's to move, restyle, or rewrite.
    expect(stamp.locked).toBeUndefined();
    expect(stamp.style.fontId).toBe('caveat');
    expect(stamp.style.align).toBe('right');
    // Not a slot: `decor:` tag, never in the slot map, so the prompt flow /
    // completion / recovery all skip it.
    expect(stamp.name).toBe('decor:dateStamp');
    expect(slotIdOfNode(stamp)).toBeNull();
    expect(decorIdOfNode(stamp)).toBe('dateStamp');
    expect(Object.values(slotNodeIds)).not.toContain(stamp.id);
  });

  test('decorTexts: inFrame joins the page frame as its front-most member', () => {
    const { mintId } = makeMintId();
    const config = makeDecorConfig({
      frame: { cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32, memberSlotIds: ['photo', 'line1', 'line2', 'line3'] },
    });
    const { ops, slotNodeIds } = buildScaffoldEntry(config, makeFormatIssue(), mintId);
    const state = applyCompOps(makeScaffoldState(), ops);

    const stamp = (state.texts ?? []).find((t) => t.name === 'decor:dateStamp')!;
    expect(stamp).toBeDefined();
    // A frame member: grouped alongside the slots, the decor tag still its
    // name (grouping never touches one).
    const photo = state.svgObjects.find((s) => s.id === slotNodeIds['photo'])!;
    expect(stamp.groupId).toBe(photo.groupId);
    expect(decorIdOfNode(stamp)).toBe('dateStamp');
    // Front-most member: over the photo and all three lines.
    const order = state.sceneOrder;
    const membersBelow = ['photo', 'line1', 'line2', 'line3'].map((s) => order.indexOf(slotNodeIds[s]));
    expect(order.indexOf(stamp.id)).toBeGreaterThan(Math.max(...membersBelow));
  });

  test('decorTexts: a decor-only frame still groups (magnetic poetry’s board)', () => {
    // The board seeds no slots at all — its frame is drawn for its background,
    // and the date stamp is the only thing inside it.
    const { mintId } = makeMintId();
    const config = makeDecorConfig({
      scaffold: [],
      promptFlow: [{ id: 'free', kind: 'free' }],
      completion: { kind: 'anyEdit' },
      frame: {
        cellX: -4, cellY: -3.5, cellWidth: 40, cellHeight: 50,
        memberSlotIds: [],
        background: { r: 244, g: 243, b: 241 },
      },
    });
    const { ops } = buildScaffoldEntry(config, makeFormatIssue(), mintId);
    const state = applyCompOps(makeScaffoldState(), ops);

    // Boundary rect + the stamp, in one frame group.
    const boundary = state.svgObjects[0];
    const stamp = (state.texts ?? []).find((t) => t.name === decorName('dateStamp'))!;
    expect(state.groups).toHaveLength(1);
    expect(state.groups[0].isFrame).toBe(true);
    expect(stamp.groupId).toBe(state.groups[0].id);
    expect(boundary.groupId).toBe(state.groups[0].id);
    // Over the board, not under it.
    expect(state.sceneOrder.indexOf(stamp.id)).toBeGreaterThan(state.sceneOrder.indexOf(boundary.id));
  });

  test('decorTexts: inFrame is inert when the format declares no frame', () => {
    const { mintId } = makeMintId();
    const { ops } = buildScaffoldEntry(makeDecorConfig(), makeFormatIssue(), mintId);
    const state = applyCompOps(makeScaffoldState(), ops);

    const stamp = (state.texts ?? []).find((t) => t.content === STAMP)!;
    expect(stamp.groupId).toBeUndefined();
    expect(state.groups).toHaveLength(0);
  });

  test('isUnfilledPhotoPlaceholder: true only for the seeded sentinel image', () => {
    const { mintId } = makeMintId();
    const { ops, slotNodeIds } = buildScaffoldEntry(makeSeedImageConfig(), makeFormatIssue(), mintId);
    const state = applyCompOps(makeScaffoldState(), ops);
    const placeholderId = slotNodeIds['photo'];

    expect(isUnfilledPhotoPlaceholder(state, placeholderId)).toBe(true);
    // A real (picked) image at the same slot is NOT a placeholder.
    const withReal = { ...state, images: [makeImage('img_real', { name: 'slot:photo' })] };
    expect(isUnfilledPhotoPlaceholder(withReal, 'img_real')).toBe(false);
    // Unknown / non-image ids are not placeholders.
    expect(isUnfilledPhotoPlaceholder(state, 'nope')).toBe(false);
    expect(isUnfilledPhotoPlaceholder(state, slotNodeIds['line1'])).toBe(false);
  });

  test('imageSlot seedImage: placeholder stays unfilled until a real photo lands', () => {
    const { mintId } = makeMintId();
    const { ops, slotNodeIds } = buildScaffoldEntry(makeSeedImageConfig(), makeFormatIssue(), mintId);
    const state = applyCompOps(makeScaffoldState(), ops);
    const photoSlot = makeSeedImageConfig().scaffold[0];

    // The seeded placeholder (sentinel imageId) does NOT count as filled...
    expect(isSlotFilled(state, photoSlot, slotNodeIds)).toBe(false);
    // ...but a picked photo carrying the slot tag does.
    const withPhoto = { ...state, images: [...state.images!, makeImage('img_real', { name: 'slot:photo' })] };
    expect(isSlotFilled(withPhoto, photoSlot, slotNodeIds)).toBe(true);
  });

  describe('unlockSeedSvgSlots', () => {
    /** A squiggle persisted by a build that seeded it LOCKED — and, with it,
     *  stored the full-page slot rect as the node bbox. */
    function makeLegacyState(overrides: Partial<SVGObject> = {}) {
      const seed: SVGObject = {
        id: 'svg_seed',
        name: 'slot:seed',
        segments: SQUIGGLE_SEGMENTS,
        color: SQUIGGLE_PAYLOAD.seed.color,
        locked: true,
        cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32,
        ...overrides,
      };
      return makeScaffoldState({ svgObjects: [seed] });
    }

    test('clears the lock a legacy build persisted', () => {
      const next = unlockSeedSvgSlots(makeLegacyState(), makeSquiggleConfig());
      expect(next.svgObjects[0].locked).toBeUndefined();
    });

    test('retightens the legacy full-page bbox from the STORED segments', () => {
      const next = unlockSeedSvgSlots(makeLegacyState(), makeSquiggleConfig());
      // Segments span x 4..20, y 4..9; the stored rect was the whole page.
      expect(next.svgObjects[0]).toMatchObject({ cellX: 4, cellY: 4, cellWidth: 16, cellHeight: 5 });
      // Geometry is never rewritten — only the derived bbox moves.
      expect(next.svgObjects[0].segments).toEqual(SQUIGGLE_SEGMENTS);
    });

    test('finds a framed member — its tag is its name inside the group too', () => {
      const state = makeLegacyState({ name: 'slot:seed', groupId: 'grp_0' });
      const next = unlockSeedSvgSlots(state, makeSquiggleConfig());
      expect(next.svgObjects[0].locked).toBeUndefined();
      expect(next.svgObjects[0]).toMatchObject({ cellX: 4, cellY: 4, cellWidth: 16, cellHeight: 5 });
    });

    test('a user-EDITED seed is left exactly as saved — this is the whole point', () => {
      // Reshaped, moved and recolored by the user, and already unlocked: the
      // migration must not drag any of it back toward the issue payload.
      const edited = makeLegacyState({
        locked: undefined,
        segments: [{ kind: 'line', start: [1, 1], end: [30, 30] }],
        color: { r: 255, g: 0, b: 0 },
        cellX: 1, cellY: 1, cellWidth: 29, cellHeight: 29,
      });
      expect(unlockSeedSvgSlots(edited, makeSquiggleConfig())).toBe(edited);
    });

    test('an already-unlocked composition is returned reference-identical', () => {
      const fresh = makeLegacyState({ locked: undefined, cellX: 4, cellY: 4, cellWidth: 16, cellHeight: 5 });
      expect(unlockSeedSvgSlots(fresh, makeSquiggleConfig())).toBe(fresh);
    });

    test('leaves non-slot svgs and configs without a seedSvg slot alone', () => {
      // A locked node the user locked themselves is not a seed slot.
      const drawn = makeLegacyState({ id: 'svg_drawn', name: 'My drawing' });
      expect(unlockSeedSvgSlots(drawn, makeSquiggleConfig())).toBe(drawn);
      const legacy = makeLegacyState();
      expect(unlockSeedSvgSlots(legacy, makeScaffoldConfig())).toBe(legacy);
    });

    test('a lock the USER set on a seed survives the reopen (bug report 3b1ea348)', () => {
      // An untouched seed under this build is boxed to its own segments;
      // locking it from the Scene Outline leaves it so. That is not the
      // legacy signature (the slot rect over tighter segments), so the lock
      // is the user's and stays — reference-identical, nothing retightened.
      const yours = makeLegacyState({ cellX: 4, cellY: 4, cellWidth: 16, cellHeight: 5 });
      expect(unlockSeedSvgSlots(yours, makeSquiggleConfig())).toBe(yours);
      // …and so does one on a seed the user reshaped first.
      const reshaped = makeLegacyState({
        segments: [{ kind: 'line', start: [1, 1], end: [30, 30] }],
        cellX: 1, cellY: 1, cellWidth: 29, cellHeight: 29,
      });
      expect(unlockSeedSvgSlots(reshaped, makeSquiggleConfig())).toBe(reshaped);
    });

    test('a locked seed whose segments fill the slot rect is not a leftover', () => {
      // The legacy box is only a tell when it is WIDER than the segments.
      const full = makeLegacyState({
        segments: [{ kind: 'line', start: [0, 0], end: [32, 32] }],
      });
      expect(unlockSeedSvgSlots(full, makeSquiggleConfig())).toBe(full);
    });
  });

  test('seedSvg with a missing or malformed payload throws', () => {
    const { mintId } = makeMintId();
    expect(() => buildScaffoldEntry(makeSquiggleConfig(), makeFormatIssue(), mintId)).toThrow(/seed/);
    expect(() =>
      buildScaffoldEntry(makeSquiggleConfig(), makeFormatIssue({ seed: { segments: 'nope' } }), mintId),
    ).toThrow(/seed/);
  });

  describe('frame', () => {
    function makeFramedConfig(): TestEditorConfig {
      return makeScaffoldConfig({
        frame: {
          cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32,
          memberSlotIds: ['photo', 'line1', 'line2', 'line3'],
        },
      });
    }

    test('groups the members + a hidden rect boundary into an isFrame group', () => {
      const { mintId } = makeMintId();
      const { ops, slotNodeIds } = buildScaffoldEntry(makeFramedConfig(), makeFormatIssue(), mintId);
      const state = applyCompOps(makeScaffoldState(), ops);

      // Exactly one isFrame group, labeled by the day's format (issue label).
      const frameGroup = state.groups.find((g) => g.isFrame);
      expect(frameGroup).toBeDefined();
      expect(frameGroup!.name).toBe('Scaffolded'); // makeFormatIssue().label

      // The boundary: a rect isMask, hidden (clip only), NOT locked (so the
      // frame group doesn't read as locked in the outline), its own member.
      const boundary = state.svgObjects.find((s) => s.isMask)!;
      expect(boundary).toBeDefined();
      expect(boundary.hidden).toBe(true);
      expect(boundary.locked).toBeUndefined();
      expect(boundary.shapeKind).toBe('rectangle');
      expect(boundary.groupId).toBe(frameGroup!.id);
      expect(boundary).toMatchObject({ cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32 });

      // Every member slot node is now in the frame group.
      for (const slotId of ['photo', 'line1', 'line2', 'line3']) {
        const nodeId = slotNodeIds[slotId];
        const node = [...state.svgObjects, ...(state.texts ?? [])].find((n) => n.id === nodeId)!;
        expect(node.groupId).toBe(frameGroup!.id);
      }

      // Boundary is back-most (behind the photo) so any background paints under.
      expect(state.sceneOrder.indexOf(boundary.id)).toBeLessThan(
        state.sceneOrder.indexOf(slotNodeIds['photo']),
      );
    });

    test('grouped slots stay resolvable — the slot tag stays the name', () => {
      const { mintId } = makeMintId();
      const { ops, slotNodeIds } = buildScaffoldEntry(makeFramedConfig(), makeFormatIssue(), mintId);
      const state = applyCompOps(makeScaffoldState(), ops);

      const photo = state.svgObjects.find((s) => s.id === slotNodeIds['photo'])!;
      // groupFigures leaves the tag where it was; slotIdOfNode recovers it
      // (recoverSlotNodeIds depends on this on load).
      expect(photo.name).toBe('slot:photo');
      expect(slotIdOfNode(photo)).toBe('photo');

      // Completion still resolves the framed slots by name tag.
      const withPhoto = { ...state, images: [makeImage('img_new', { name: 'slot:photo' })] };
      expect(isSlotFilled(withPhoto, SCAFFOLD_FOUR_SLOTS[0], slotNodeIds)).toBe(true);
    });

    test('mints exactly one group id, after the members and the boundary', () => {
      const { mintId, calls } = makeMintId();
      buildScaffoldEntry(makeFramedConfig(), makeFormatIssue(), mintId);
      // photo(svg) + 3 text + boundary(svg) + group.
      expect(calls).toEqual(['svg', 'text', 'text', 'text', 'svg', 'group']);
    });

    test('no-op when the frame names no resolvable members and has no background', () => {
      const { mintId } = makeMintId();
      const config = makeScaffoldConfig({
        frame: { cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32, memberSlotIds: ['ghost'] },
      });
      const { ops } = buildScaffoldEntry(config, makeFormatIssue(), mintId);
      const state = applyCompOps(makeScaffoldState(), ops);
      expect(state.groups.some((g) => g.isFrame)).toBe(false);
      expect(state.svgObjects.some((s) => s.isMask)).toBe(false);
    });

    test('a background frame with no members still paints its board (magnetic poetry)', () => {
      const { mintId } = makeMintId();
      const config = makeScaffoldConfig({
        scaffold: [],
        frame: {
          name: 'Board',
          cellX: 2, cellY: 3, cellWidth: 20, cellHeight: 26,
          memberSlotIds: [],
          background: { r: 214, g: 40, b: 40 },
        },
        promptFlow: [{ id: 'free', kind: 'free' }],
        completion: { kind: 'anyEdit' },
      });
      const { ops } = buildScaffoldEntry(config, makeFormatIssue(), mintId);
      const state = applyCompOps(makeScaffoldState(), ops);

      // The isFrame group exists, named for the frame, holding just the boundary.
      const frameGroup = state.groups.find((g) => g.isFrame);
      expect(frameGroup).toBeDefined();
      expect(frameGroup!.name).toBe('Board');

      // The boundary is a VISIBLE rect mask filled with the frame color — it
      // paints the board. No other svg (no seeded photo slot / drawing element).
      const boundary = state.svgObjects.find((s) => s.isMask)!;
      expect(boundary).toBeDefined();
      expect(boundary.hidden).toBeFalsy(); // visible: it IS the board
      expect(boundary.groupId).toBe(frameGroup!.id);
      expect(boundary.fillColor).toEqual({ r: 214, g: 40, b: 40 });
      expect(state.svgObjects).toHaveLength(1);
    });

    test('a frame border is seeded onto the boundary rect’s effects', () => {
      const { mintId } = makeMintId();
      const border = { width: 0.375, position: 'inside' as const, dash: 0, color: { r: 156, g: 156, b: 156 } };
      const config = makeScaffoldConfig({
        scaffold: [],
        frame: {
          name: 'Board',
          cellX: 2, cellY: 3, cellWidth: 20, cellHeight: 26,
          memberSlotIds: [],
          background: { r: 244, g: 243, b: 241 },
          border,
        },
        promptFlow: [{ id: 'free', kind: 'free' }],
        completion: { kind: 'anyEdit' },
      });
      const { ops } = buildScaffoldEntry(config, makeFormatIssue(), mintId);
      const state = applyCompOps(makeScaffoldState(), ops);
      // The border rides the boundary rect's effects, so it renders + edits like
      // a user-added border (CanvasSurface BorderOverlay reads mask.effects).
      const boundary = state.svgObjects.find((s) => s.isMask)!;
      expect(boundary.effects?.border).toEqual(border);
    });
  });
});

describe('isSlotFilled', () => {
  const { mintId } = makeMintId();
  const { ops, slotNodeIds } = buildScaffoldEntry(makeScaffoldConfig(), makeFormatIssue(), mintId);
  const scaffolded = applyCompOps(makeScaffoldState(), ops);
  const photoSlot = SCAFFOLD_FOUR_SLOTS[0];
  const line1Slot = SCAFFOLD_FOUR_SLOTS[1];

  test('imageSlot: false while only the placeholder frame exists', () => {
    expect(isSlotFilled(scaffolded, photoSlot, slotNodeIds)).toBe(false);
  });

  test('imageSlot: true when an image node carries the slot name tag', () => {
    const state = { ...scaffolded, images: [makeImage('img_new', { name: 'slot:photo' })] };
    expect(isSlotFilled(state, photoSlot, slotNodeIds)).toBe(true);
  });

  test('imageSlot: true when an image node has the mapped id', () => {
    const state = { ...scaffolded, images: [makeImage(slotNodeIds['photo'])] };
    expect(isSlotFilled(state, photoSlot, slotNodeIds)).toBe(true);
  });

  test('textSlot: placeholder and whitespace-only content are unfilled', () => {
    expect(isSlotFilled(scaffolded, line1Slot, slotNodeIds)).toBe(false);
    const texts = scaffolded.texts!.map((t) =>
      t.id === slotNodeIds['line1'] ? { ...t, content: '   ' } : t,
    );
    expect(isSlotFilled({ ...scaffolded, texts }, line1Slot, slotNodeIds)).toBe(false);
  });

  test('textSlot: edited content fills the slot', () => {
    const texts = scaffolded.texts!.map((t) =>
      t.id === slotNodeIds['line1'] ? { ...t, content: 'Warm rain on the roof' } : t,
    );
    expect(isSlotFilled({ ...scaffolded, texts }, line1Slot, slotNodeIds)).toBe(true);
  });

  test('textSlot: resolves via name tag when the node was re-minted', () => {
    const state = makeScaffoldState({
      texts: [makeText('txt_reborn', 'Warm rain on the roof', { name: 'slot:line1' })],
    });
    expect(isSlotFilled(state, line1Slot, slotNodeIds)).toBe(true);
    expect(slotTextNode(state, line1Slot as ScaffoldNode & { kind: 'textSlot' }, slotNodeIds)?.id).toBe('txt_reborn');
  });

  test('seedSvg: always filled', () => {
    const slot: ScaffoldNode = { kind: 'seedSvg', slotId: 'seed', payloadKey: 'seed', cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32 };
    expect(isSlotFilled(makeScaffoldState(), slot, {})).toBe(true);
  });
});

describe('isUneditedTextSlotPlaceholder', () => {
  // The editor opens such a text on an EMPTY field and lifts the line off
  // the canvas (Haiku's 5/7/5 hints behave as placeholders): typing
  // replaces the whole line; dismissing untouched restores it.
  const { mintId } = makeMintId();
  const { ops } = buildScaffoldEntry(makeScaffoldConfig(), makeFormatIssue(), mintId);
  const scaffolded = applyCompOps(makeScaffoldState(), ops);
  const line1 = scaffolded.texts!.find((t) => t.name === 'slot:line1')!;

  test('true for a slot text still showing its seeded line', () => {
    expect(isUneditedTextSlotPlaceholder(SCAFFOLD_FOUR_SLOTS, line1)).toBe(true);
  });

  test('false once the line was rewritten — or for a non-slot text', () => {
    expect(isUneditedTextSlotPlaceholder(SCAFFOLD_FOUR_SLOTS, { ...line1, content: 'Warm rain' }))
      .toBe(false);
    expect(isUneditedTextSlotPlaceholder(
      SCAFFOLD_FOUR_SLOTS, { ...line1, name: undefined },
    )).toBe(false);
    expect(isUneditedTextSlotPlaceholder(undefined, line1)).toBe(false);
  });

});

describe('templateTextCommitContent', () => {
  // Window's Title line: the FIRST thing written over the template's
  // placeholder is a title, so it commits in quotes — once.
  const config = { templateTextQuotes: ['Title'] as const };
  const title: TextObject = {
    id: 't1', name: 'Title', content: 'The title of this design is...',
    cellX: 12, cellY: -36, cellWidth: 20, cellHeight: 2,
  } as unknown as TextObject;
  const baseline = { nodeCount: 12, texts: { t1: 'The title of this design is...' } };

  test('the first edit of the named template line is wrapped in straight quotes', () => {
    expect(templateTextCommitContent(config, baseline, title, 'MyTitle')).toBe('"MyTitle"');
  });

  test('only the first: a line already written over commits as typed', () => {
    const edited = { ...title, content: '"MyTitle"' };
    expect(templateTextCommitContent(config, baseline, edited, 'Another')).toBe('Another');
  });

  test('a line the template did not seed, or the format does not name, commits as typed', () => {
    // Not in the baseline at all (a text the user added).
    expect(templateTextCommitContent(config, baseline, { ...title, id: 't9' }, 'Mine')).toBe('Mine');
    // Seeded, but not a line the format quotes.
    const caption = { ...title, name: 'Caption' };
    expect(templateTextCommitContent(
      config, { ...baseline, texts: { ...baseline.texts, t1: caption.content } }, caption, 'Mine',
    )).toBe('Mine');
    expect(templateTextCommitContent({}, baseline, title, 'Mine')).toBe('Mine');
    expect(templateTextCommitContent(config, undefined, title, 'Mine')).toBe('Mine');
    expect(templateTextCommitContent(config, baseline, undefined, 'Mine')).toBe('Mine');
  });

  test('content the user already quoted is not quoted twice', () => {
    expect(templateTextCommitContent(config, baseline, title, '"Mine"')).toBe('"Mine"');
    expect(templateTextCommitContent(config, baseline, title, '\u201cMine\u201d')).toBe('\u201cMine\u201d');
    // A lone quote mark is content, not a quoted line.
    expect(templateTextCommitContent(config, baseline, title, '"')).toBe('"""');
  });

});

describe('scaffold node types stay engine-compatible', () => {
  test('placed nodes satisfy the engine object types', () => {
    // Type-level checks: assignment compiles under strict tsc.
    const { mintId } = makeMintId();
    const { ops } = buildScaffoldEntry(makeScaffoldConfig(), makeFormatIssue(), mintId);
    const first = ops[0];
    if (first.op !== 'placeObject') throw new Error('expected placeObject');
    const svg: SVGObject = first.item as SVGObject;
    expect(svg.segments.length).toBeGreaterThan(0);
    const second = ops[1];
    if (second.op !== 'placeObject') throw new Error('expected placeObject');
    const text: TextObject = second.item as TextObject;
    expect(text.content).toBe('First line…');
  });
});
