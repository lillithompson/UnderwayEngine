import { applyCompOps } from '@/engine/compositionOps';
import { buildShapeSVGObject } from '@/engine/shapePresets';
import { buildPatternFloodAndClose } from '../editorSession';
import { shapePatternFillIsEmpty } from '@/engine/shapePatternFill';
import type { CellState, CompositionState, SVGObject } from '@/engine/types';
import { registerStoreNamespace } from '../store/storeKeys';
import {
  type DoneRefusal,
  TEMPLATE_TITLE_NAME,
  WORD_IN_MASK_WARNING,
  doneRefusal,
  entryCloseAction,
  isEntryEdited,
  isTemplateEntryEdited,
  patternCellsSignature,
  printedFillSignatures,
  samePageContent,
  scaffoldNodeCount,
  sceneHasPaint,
  sceneNodeCount,
  sceneNodeIds,
  sceneStickers,
  stickersInMask,
  stickersInMaskReadingOrder,
  templateBaselineOf,
  templateTitleNode,
  templateTitleOf,
} from '../formats/edited';
import { registerMultiFileFormats } from '../formats/formatIds';
import { type ScaffoldFurniture, buildScaffoldEntry, registerScaffoldFurniture } from '../formats/scaffold';
import type { ScaffoldEditorConfig } from '../formats/editorConfig';
import {
  type TestEditorConfig,
  makeFormatIssue,
  makeImage,
  makeMintId,
  makePaintIsland,
  makeScaffoldConfig,
  makeScaffoldState,
  makeText,
} from './test-utils';

// "Did the user actually make anything?" (formats/edited.ts) — the gate on
// rasterizing a thumbnail, and the `anyEdit` completion rule's own question.
//
// Driven over a MADE-UP app (test-utils' `makeScaffoldConfig`), the way
// `editorConfig.test.ts` and 6.1's `loadPackFonts.test.ts` drive theirs.
// What each app keeps is the half that cannot be made up: its own suite
// drives its REAL configs and its real scaffold builder through the same
// predicates, because the fact that a freshly opened page of each shipped
// format reads as uninitialized is a fact about those configs — a fixture
// scaffold could agree while the shipped one seeds an extra node and
// silently flip every untouched page to "edited".
//
// THIS SUITE IS ALSO WHAT TYPECHECKS `formats/edited.ts`: the root tsconfig
// excludes packages/editor, so ts-jest's diagnostics while a suite loads a
// module are the only check a file here gets (see editorConfig.test.ts).

// The scaffold reads the photo sentinel through the app's namespace
// (formats/photoPlaceholder.ts), and `storeKey` refuses to build a key with
// none installed — so a suite that reaches the scaffold installs one, as
// `storeKeys.ts` says a test must.
beforeEach(() => {
  registerStoreNamespace('test');
  registerScaffoldFurniture(undefined);
  registerMultiFileFormats(new Set(['blank']));
});

/** One printed cell of a pattern tile — what flooding a shape lays. */
const CELL: CellState = {
  type: 'sprite', spriteId: 'x', transform: { rotation: 0, mirrorH: false, mirrorV: false },
};

/** Flood a shape's pattern grid with one tile and close the editing pass,
 *  the way a double tap into the Pattern page does (EditorShell's
 *  onEditTilePattern → buildPatternFloodAndClose). Driven through the real
 *  builder and the real ops rather than a hand-written cell array. */
function flood(state: CompositionState, shapeId: string, spriteId = 'x'): CompositionState {
  const entry = buildPatternFloodAndClose(state, shapeId, { kind: 'tile', spriteId });
  expect(entry).not.toBeNull();
  return applyCompOps(state, entry!.entry);
}

/** A config's composition exactly as it looks the moment the editor opens it. */
function opened(config: TestEditorConfig) {
  const { mintId } = makeMintId();
  const issue = makeFormatIssue();
  const { ops, slotNodeIds } = buildScaffoldEntry(config, issue, mintId);
  const state = applyCompOps(makeScaffoldState(), ops);
  return { config, state, slotNodeIds, seededFills: printedFillSignatures(state) };
}

function editText(state: CompositionState, id: string, content: string): CompositionState {
  return { ...state, texts: state.texts!.map((t) => (t.id === id ? { ...t, content } : t)) };
}

/** The mask a template instance carries: a bare, locked path named "Mask",
 *  well off the page so nothing the scaffold seeds lands inside it. */
const MASK_BOX = { cellX: 60, cellY: 60, cellWidth: 20, cellHeight: 20 };
function withMask(state: CompositionState): CompositionState {
  const mask: SVGObject = {
    ...buildShapeSVGObject('svg_mask', 'rect', MASK_BOX, { r: 0, g: 0, b: 0 }),
    name: 'Mask', locked: true, stroke: { width: 0 },
  };
  return { ...state, svgObjects: [...state.svgObjects, mask], sceneOrder: [mask.id, ...state.sceneOrder] };
}

/** A word tile as an app's own furniture seeds one: a non-editable sticker. */
function sticker(id: string, content: string, cx: number, cy: number) {
  return makeText(id, content, {
    sticker: true, cellX: cx - 1, cellY: cy - 0.5, cellWidth: 2, cellHeight: 1,
  });
}

/** Move a node, the way a canvas drag does: nothing else about it changes. */
function floatInto(state: CompositionState, nodeId: string, cx = 70, cy = 70): CompositionState {
  return {
    ...state,
    texts: state.texts!.map((t) => (t.id === nodeId
      ? { ...t, cellX: cx - t.cellWidth / 2, cellY: cy - t.cellHeight / 2 }
      : t)),
  };
}

describe('scaffoldNodeCount mirrors what buildScaffoldEntry actually seeds', () => {
  // The threshold "the user added something" is measured against this, so a
  // count that undershoots reads every untouched page as edited the moment
  // it opens. Held to the builder rather than stated.
  test('four slots, no frame, no decor', () => {
    const { config, state } = opened(makeScaffoldConfig());
    expect(scaffoldNodeCount(config)).toBe(sceneNodeCount(state));
  });

  test('a drawn frame adds its boundary rect, and decor texts add one each', () => {
    const config = makeScaffoldConfig({
      frame: { cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 24, memberSlotIds: ['photo'] },
      decorTexts: [
        { decorId: 'stamp', content: 'Wednesday', style: {}, cellX: 1, cellY: 1, cellWidth: 8, cellHeight: 2 },
      ],
    });
    const { state } = opened(config);
    expect(scaffoldNodeCount(config)).toBe(sceneNodeCount(state));
    // …and it is the boundary plus the stamp above the bare four.
    expect(scaffoldNodeCount(config)).toBe(scaffoldNodeCount(makeScaffoldConfig()) + 2);
  });

  test('a frame with no members and no background is not drawn, so it counts nothing', () => {
    const config = makeScaffoldConfig({
      frame: { cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 24, memberSlotIds: [] },
    });
    const { state } = opened(config);
    expect(scaffoldNodeCount(config)).toBe(sceneNodeCount(state));
  });

  test('the app’s own furniture is counted through the installed rule', () => {
    // CozyJournal's word tiles are one node each and its rig is two. Here a
    // made-up rule that seeds three. The bare count is taken FIRST, while
    // nothing is installed, so the two readings are not the same reading.
    const config = makeScaffoldConfig();
    const bare = scaffoldNodeCount(config);
    registerScaffoldFurniture(threeStickers);
    const { state } = opened(config);
    expect(scaffoldNodeCount(config)).toBe(bare + WORDS.length);
    expect(scaffoldNodeCount(config)).toBe(sceneNodeCount(state));
  });
});

/** A made-up app's furniture: three word tiles scattered off the page, the
 *  shape of CozyJournal's magnetic poetry (scaffold.ts ScaffoldFurniture). */
const WORDS = ['lantern', 'harbour', 'evening'] as const;
const threeStickers: ScaffoldFurniture<ScaffoldEditorConfig> = {
  build: (_config, _issue, mintId) => WORDS.map((w, i) => ({
    op: 'placeObject' as const,
    kind: 'text' as const,
    item: sticker(mintId('text'), w, 4 + i * 6, 40),
  })),
  count: () => WORDS.length,
  touched: (_config, state) => stickersInMask(state).length > 0,
};

describe('the app’s own scaffold furniture', () => {
  test('nothing installed means no furniture, and that is the fallback', () => {
    const { state } = opened(makeScaffoldConfig());
    expect(sceneStickers(state)).toEqual([]);
  });

  test('the installed rule seeds it, after the frame group so it paints on top', () => {
    registerScaffoldFurniture(threeStickers);
    const config = makeScaffoldConfig({
      frame: { cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 24, memberSlotIds: ['photo'] },
    });
    const { state } = opened(config);
    expect(sceneStickers(state).map((t) => t.content)).toEqual([...WORDS]);
    // Last in sceneOrder ⇒ front-most, over the frame group and its photo.
    const last = state.sceneOrder.slice(-WORDS.length);
    expect(last).toEqual(sceneStickers(state).map((t) => t.id));
  });

  test('and its `touched` gets the first word on the edited question', () => {
    registerScaffoldFurniture(threeStickers);
    const { config, state: seeded, slotNodeIds } = opened(makeScaffoldConfig());
    const state = withMask(seeded);
    const baseline = templateBaselineOf(state);
    expect(isEntryEdited(config, state, slotNodeIds, baseline)).toBe(false);
    // Floating one word in adds no node and rewrites no text, so the
    // baseline comparison is blind to it on its own.
    const one = floatInto(state, sceneStickers(state)[0].id);
    expect(sceneNodeCount(one)).toBe(sceneNodeCount(state));
    expect(isTemplateEntryEdited(one, baseline)).toBe(false);
    expect(isEntryEdited(config, one, slotNodeIds, baseline)).toBe(true);
  });

  test('a rule may be uninstalled again, and then the page is bare', () => {
    registerScaffoldFurniture(threeStickers);
    expect(sceneStickers(opened(makeScaffoldConfig()).state)).toHaveLength(3);
    registerScaffoldFurniture(undefined);
    expect(sceneStickers(opened(makeScaffoldConfig()).state)).toEqual([]);
  });
});

describe('a page that was only opened is uninitialized', () => {
  test('the seeded scaffold alone is not the user’s work', () => {
    const { config, state, slotNodeIds } = opened(makeScaffoldConfig());
    expect(isEntryEdited(config, state, slotNodeIds)).toBe(false);
  });

  test('editing one seeded line is', () => {
    const { config, state, slotNodeIds } = opened(makeScaffoldConfig());
    const line = state.texts!.find((t) => t.name === 'slot:line1')!;
    expect(isEntryEdited(config, editText(state, line.id, 'the last warm evening'), slotNodeIds)).toBe(true);
  });

  test('…and so is CLEARING one, which is an edit like any other', () => {
    const { config, state, slotNodeIds } = opened(makeScaffoldConfig());
    const line = state.texts!.find((t) => t.name === 'slot:line1')!;
    expect(isEntryEdited(config, editText(state, line.id, ''), slotNodeIds)).toBe(true);
  });

  test('moving or restyling a seeded line without rewriting it is not', () => {
    const { config, state, slotNodeIds } = opened(makeScaffoldConfig());
    const line = state.texts!.find((t) => t.name === 'slot:line1')!;
    const nudged = {
      ...state,
      texts: state.texts!.map((t) => (t.id === line.id ? { ...t, cellX: t.cellX + 3, cellY: t.cellY + 1 } : t)),
    };
    expect(isEntryEdited(config, nudged, slotNodeIds)).toBe(false);
  });

  test('a photo in the slot is, and the unfilled sentinel is not', () => {
    const config = makeScaffoldConfig({
      scaffold: [
        { kind: 'imageSlot', slotId: 'photo', hint: 'tap', seedImage: true, cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 24 },
      ],
      promptFlow: [{ id: 'p', kind: 'free' }],
      completion: { kind: 'anyEdit' },
    });
    const { state, slotNodeIds } = opened(config);
    expect(isEntryEdited(config, state, slotNodeIds)).toBe(false);
    const real = {
      ...state,
      images: state.images!.map((i) => ({ ...i, imageId: 'blob_real' })),
    };
    expect(isEntryEdited(config, real, slotNodeIds)).toBe(true);
  });

  test('any node added beside the scaffold is', () => {
    const { config, state, slotNodeIds } = opened(makeScaffoldConfig());
    const added = {
      ...state,
      texts: [...state.texts!, makeText('txt_mine', 'mine')],
      sceneOrder: [...state.sceneOrder, 'txt_mine'],
    };
    expect(isEntryEdited(config, added, slotNodeIds)).toBe(true);
  });
});

describe('brushwork counts, and it is the one test that looks off the scene graph', () => {
  test('a paint island is always the user’s — no scaffold seeds one', () => {
    const { config, state, slotNodeIds } = opened(makeScaffoldConfig());
    const island = makePaintIsland(4, 4);
    const painted = {
      ...state,
      paintObjects: [island],
      sceneOrder: [...state.sceneOrder, island.id],
    };
    expect(sceneHasPaint(state)).toBe(false);
    expect(sceneHasPaint(painted)).toBe(true);
    expect(isEntryEdited(config, painted, slotNodeIds)).toBe(true);
  });

  test('…and it is seen even on a template page, where the baseline counts islands', () => {
    const { config, state: seeded, slotNodeIds } = opened(makeScaffoldConfig());
    const first = makePaintIsland(4, 4);
    const withOne = { ...seeded, paintObjects: [first], sceneOrder: [...seeded.sceneOrder, first.id] };
    const baseline = templateBaselineOf(withOne);
    expect(baseline.paintIslands).toBe(1);
    expect(isEntryEdited(config, withOne, slotNodeIds, baseline)).toBe(false);
    const second = makePaintIsland(9, 9);
    const withTwo = {
      ...withOne, paintObjects: [first, second], sceneOrder: [...withOne.sceneOrder, second.id],
    };
    expect(isEntryEdited(config, withTwo, slotNodeIds, baseline)).toBe(true);
  });
});

describe('cloth printed inside a shape', () => {
  /** A one-slot config whose seed arrives with a pattern grid on it — the
   *  shape CozyJournal's Patchwork deals its patches in. */
  function piecesConfig(): TestEditorConfig {
    return makeScaffoldConfig({
      scaffold: [{
        kind: 'seedSvg', slotId: 'piece', payloadKey: 'piece',
        patternFill: { size: 2, gridCells: 2 },
        cellX: 2, cellY: 2, cellWidth: 8, cellHeight: 8,
      }],
      promptFlow: [{ id: 'p', kind: 'free' }],
      completion: { kind: 'anyEdit' },
    });
  }

  function dealt() {
    const config = piecesConfig();
    const { mintId } = makeMintId();
    const issue = makeFormatIssue({
      piece: {
        segments: [
          { kind: 'line', start: [2, 2], end: [10, 2] },
          { kind: 'line', start: [10, 2], end: [10, 10] },
          { kind: 'line', start: [10, 10], end: [2, 10] },
          { kind: 'line', start: [2, 10], end: [2, 2] },
        ],
        color: { r: 10, g: 10, b: 10 },
      },
    });
    const { ops, slotNodeIds } = buildScaffoldEntry(config, issue, mintId);
    const state = applyCompOps(makeScaffoldState(), ops);
    return { config, state, slotNodeIds, seededFills: printedFillSignatures(state) };
  }

  test('a `patternFill` seed arrives PRINTED, so the dealt cloth has a signature', () => {
    // The scaffold floods it (scaffold.ts seedPatternFill) — the piece
    // arrives as cloth and is one double tap away from being repainted.
    const { state } = dealt();
    const shape = state.svgObjects[0];
    expect(shapePatternFillIsEmpty(shape.patternFill)).toBe(false);
    expect(Object.keys(printedFillSignatures(state))).toEqual([shape.id]);
  });

  test('an EMPTY grid signs as nothing, so a shape’s first print is a new id', () => {
    // Empty fills are left out of the record, which is what makes a first
    // print visible as an id the baseline hasn't got.
    const { state } = dealt();
    const shape = state.svgObjects[0];
    const blank: CompositionState = {
      ...state,
      svgObjects: state.svgObjects.map((o) => (o.id === shape.id
        ? { ...o, patternFill: { ...o.patternFill!, cells: o.patternFill!.cells.map(() => null) } }
        : o)),
    };
    expect(printedFillSignatures(blank)).toEqual({});
    expect(Object.keys(printedFillSignatures(flood(blank, shape.id)))).toEqual([shape.id]);
  });

  test('printing adds no node and rewrites no text, and still reads as an edit', () => {
    const { state } = dealt();
    const shape = state.svgObjects[0];
    const baseline = templateBaselineOf(state);
    const repainted = flood(state, shape.id, 'y');
    expect(sceneNodeCount(repainted)).toBe(sceneNodeCount(state));
    expect(isTemplateEntryEdited(state, baseline)).toBe(false);
    expect(isTemplateEntryEdited(repainted, baseline)).toBe(true);
  });

  test('cloth the SCAFFOLD dealt is not the user’s, and a repaint is', () => {
    // Measured against what the scaffold dealt (the editor records it on the
    // entry as JournalEntry.seededFills), because the patches arrive printed
    // — a page with no record was dealt no cloth.
    const { config, state, slotNodeIds, seededFills } = dealt();
    expect(isEntryEdited(config, state, slotNodeIds, undefined, seededFills)).toBe(false);
    const repainted = flood(state, state.svgObjects[0].id, 'y');
    expect(isEntryEdited(config, repainted, slotNodeIds, undefined, seededFills)).toBe(true);
    // …and with no record, the dealt cloth itself reads as the user's: that
    // is the direction to err in, since a page with cloth in it is a page
    // worth a thumbnail.
    expect(isEntryEdited(config, state, slotNodeIds)).toBe(true);
  });

  test('patternCellsSignature sees a tile, a pose and a count change', () => {
    const base = [CELL];
    expect(patternCellsSignature(base)).toBe(patternCellsSignature([{ ...CELL }]));
    expect(patternCellsSignature(base)).not.toBe(patternCellsSignature([{ ...CELL, spriteId: 'y' }]));
    expect(patternCellsSignature(base)).not.toBe(patternCellsSignature([
      { ...CELL, transform: { rotation: 90, mirrorH: false, mirrorV: false } },
    ]));
    expect(patternCellsSignature([])).not.toBe(patternCellsSignature(base));
  });
});

describe('the word-in-mask tests, which the baseline cannot see', () => {
  function bank(): CompositionState {
    return withMask(makeScaffoldState({
      texts: [sticker('txt_a', 'lantern', 4, 40), sticker('txt_b', ' harbour ', 10, 40), sticker('txt_c', 'evening', 16, 40)],
    }));
  }

  test('the scattered bank is not in the mask', () => {
    expect(stickersInMask(bank())).toEqual([]);
    expect(sceneStickers(bank())).toHaveLength(3);
  });

  test('it is the word’s CENTRE that counts', () => {
    const state = bank();
    expect(stickersInMask(floatInto(state, 'txt_a', MASK_BOX.cellX + 0.1, 70))).toHaveLength(1);
    expect(stickersInMask(floatInto(state, 'txt_a', MASK_BOX.cellX - 0.1, 70))).toHaveLength(0);
  });

  test('the words in the mask READ line by line, left to right, whatever order they went in', () => {
    let played = bank();
    // Second line first, then the first line's right word, then its left one
    // a hair lower — tiles dropped by hand are never quite level.
    played = floatInto(played, 'txt_a', 66, 76);
    played = floatInto(played, 'txt_b', 76, 65);
    played = floatInto(played, 'txt_c', 64, 65.25);
    expect(stickersInMaskReadingOrder(played)).toEqual(['evening', 'harbour', 'lantern']);
    // …and the content is TRIMMED: ' harbour ' reads as one word.
    expect(stickersInMaskReadingOrder(bank())).toEqual([]);
  });

  test('a page with no mask has no word in it, wherever the words sit', () => {
    const noMask = makeScaffoldState({ texts: [sticker('txt_a', 'lantern', 4, 40)] });
    expect(stickersInMask(floatInto(noMask, 'txt_a'))).toEqual([]);
  });

  test('doneRefusal holds a page back until a word is in the bottle', () => {
    const RULE = { doneRequiresWordInMask: true };
    expect(doneRefusal(RULE, bank(), undefined)).toEqual({ notice: WORD_IN_MASK_WARNING });
    expect(doneRefusal(RULE, floatInto(bank(), 'txt_a'), undefined)).toBeUndefined();
    // …and only where there IS a mask: the flag cannot refuse a page with
    // nothing to float a word into.
    const noMask = makeScaffoldState({ texts: [sticker('txt_a', 'lantern', 4, 40)] });
    expect(doneRefusal(RULE, noMask, undefined)).toBeUndefined();
  });

  test('doneRefusal consults the format’s own rule after the flag', () => {
    const state = makeScaffoldState();
    const rule = jest.fn((): DoneRefusal => ({ notice: 'Not yet' }));
    expect(doneRefusal({ doneRule: rule }, state, undefined)).toEqual({ notice: 'Not yet' });
    expect(rule).toHaveBeenCalledWith(state, undefined);
    expect(doneRefusal({ doneRule: () => undefined }, state, undefined)).toBeUndefined();
    expect(doneRefusal({}, state, undefined)).toBeUndefined();
  });
});

describe('templateTitleOf — the title the user gave a template page', () => {
  const seeded = makeText('t_title', 'The title of this design is...', { name: TEMPLATE_TITLE_NAME });
  const state = makeScaffoldState({ texts: [seeded] });
  const baseline = templateBaselineOf(state);

  test('undefined while the line still reads what the template wrote', () => {
    expect(templateTitleOf(state, baseline)).toBeUndefined();
    // Whitespace around the template's own words is not a title either.
    expect(templateTitleOf(
      makeScaffoldState({ texts: [{ ...seeded, content: '  The title of this design is...  ' }] }), baseline,
    )).toBeUndefined();
  });

  test('the written-over line, trimmed, once it differs', () => {
    expect(templateTitleOf(makeScaffoldState({ texts: [{ ...seeded, content: '"Lanterns"' }] }), baseline))
      .toBe('"Lanterns"');
    expect(templateTitleOf(makeScaffoldState({ texts: [{ ...seeded, content: ' Lanterns \n' }] }), baseline))
      .toBe('Lanterns');
  });

  test('an emptied line, a text the user added under the name, and a page with no baseline give none', () => {
    expect(templateTitleOf(makeScaffoldState({ texts: [{ ...seeded, content: '   ' }] }), baseline)).toBeUndefined();
    const added = makeText('t_mine', 'Mine', { name: TEMPLATE_TITLE_NAME });
    expect(templateTitleOf(makeScaffoldState({ texts: [seeded, added] }), baseline)).toBeUndefined();
    expect(templateTitleOf(makeScaffoldState({ texts: [{ ...seeded, content: 'Lanterns' }] }), undefined))
      .toBeUndefined();
  });

  test('templateTitleNode finds nothing on a page whose template has no Title line', () => {
    // An unguarded read handed the store `undefined` on the very next save:
    // the name the user had just typed was wiped by the autosave behind it.
    const other = makeText('t_line', 'the last warm evening', { name: 'slot:line1' });
    const otherState = makeScaffoldState({ texts: [other] });
    expect(templateTitleNode(otherState, templateBaselineOf(otherState))).toBeUndefined();
    expect(templateTitleNode(state, baseline)?.id).toBe('t_title');
  });
});

describe('the turn baseline', () => {
  test('templateBaselineOf records nodeIds only with withIds', () => {
    const state = makeScaffoldState({ texts: [makeText('txt_1', 'a')], images: [makeImage('img_1')] });
    expect(templateBaselineOf(state).nodeIds).toBeUndefined();
    expect(templateBaselineOf(state, { withIds: true }).nodeIds).toEqual(['img_1', 'txt_1']);
  });

  test('sceneNodeIds walks the kinds in a fixed order, not the scene’s', () => {
    // The order is figures, svgObjects, images, texts, paint, patterns — so
    // two readings of one scene agree whatever sceneOrder says, which is what
    // lets a baseline recorded now be compared with a scene read later.
    const state = makeScaffoldState({
      texts: [makeText('txt_2', 'b'), makeText('txt_1', 'a')],
      images: [makeImage('img_1')],
    });
    expect(sceneNodeIds(state)).toEqual(['img_1', 'txt_2', 'txt_1']);
    const reordered: CompositionState = { ...state, sceneOrder: [...state.sceneOrder].reverse() };
    expect(sceneNodeIds(reordered)).toEqual(sceneNodeIds(state));
  });
});

describe('entryCloseAction — what closing does with the page', () => {
  test('an edited page is saved, whatever its format', () => {
    expect(entryCloseAction('scaffolded', true)).toBe('save');
    expect(entryCloseAction('blank', true)).toBe('save');
  });

  test('an untouched dated page stays, imageless', () => {
    // It holds its day's slot: reopening the date has to find it, and
    // clearing the images is what stops it showing marks it no longer has.
    expect(entryCloseAction('scaffolded', false)).toBe('clear');
  });

  test('an untouched multi-file page is discarded, not filed', () => {
    // It was minted by the open that is ending and holds no calendar slot,
    // so an empty one would be a file made of nothing.
    expect(entryCloseAction('blank', false)).toBe('discard');
  });

  test('it is the INSTALLED set that decides, not a word this package knows', () => {
    // A format id is each app's own union; the package only asks
    // (formats/formatIds.ts).
    registerMultiFileFormats(new Set(['scaffolded']));
    expect(entryCloseAction('scaffolded', false)).toBe('discard');
    expect(entryCloseAction('blank', false)).toBe('clear');
    // …and an app that installs nothing has no multi-file formats.
    registerMultiFileFormats(new Set());
    expect(entryCloseAction('blank', false)).toBe('clear');
  });

  test('an untouched UNLISTED page is discarded even though its format is dated', () => {
    // A one-off mints a page per tap. Keeping the unmarked ones would strew
    // a dead record for every one walked away from, and none of them holds
    // the day's slot to justify staying.
    expect(entryCloseAction('scaffolded', false, true)).toBe('discard');
    expect(entryCloseAction('scaffolded', true, true)).toBe('save');
    expect(entryCloseAction('scaffolded', false, false)).toBe('clear');
  });
});

describe('samePageContent — the drawn content, not the view', () => {
  test('a state is the same page as itself', () => {
    const state = makeScaffoldState({ texts: [makeText('txt_1', 'a')] });
    expect(samePageContent(state, state)).toBe(true);
    expect(samePageContent(state, { ...state })).toBe(true);
  });

  test('moving the camera, the grid or the swatch shelf is not an edit', () => {
    const state = makeScaffoldState({ texts: [makeText('txt_1', 'a')] });
    expect(samePageContent(state, { ...state, camera: { offsetX: 9, offsetY: 9, zoom: 3 } })).toBe(true);
    expect(samePageContent(state, { ...state, gridLevel: 2, gridIntensity: 0.9 })).toBe(true);
    expect(samePageContent(state, { ...state, customColors: [{ r: 1, g: 2, b: 3 }] })).toBe(true);
    expect(samePageContent(state, { ...state, lastChosenColor: { r: 1, g: 2, b: 3 } })).toBe(true);
  });

  test('…and rewriting a text, or renaming the page, is', () => {
    const state = makeScaffoldState({ texts: [makeText('txt_1', 'a')] });
    expect(samePageContent(state, { ...state, texts: [makeText('txt_1', 'b')] })).toBe(false);
    expect(samePageContent(state, { ...state, name: 'other' })).toBe(false);
    // It errs only toward "changed": an array rebuilt into an equal value
    // reads as an edit, which restamps a page rather than losing a stamp.
    expect(samePageContent(state, { ...state, texts: [...state.texts!] })).toBe(false);
  });
});
