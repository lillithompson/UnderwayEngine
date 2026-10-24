import { applyCompOps } from '@/engine/compositionOps';
import { registerStoreNamespace } from '../store/storeKeys';
import { CompositionState } from '@/engine/types';
import { isEntryComplete } from '../formats/completion';
import { templateBaselineOf } from '../formats/edited';
import { buildScaffoldEntry } from '../formats/scaffold';
import type { TestEditorConfig } from './test-utils';
import { makeScaffoldConfig, makeImage, makeFormatIssue, makeMintId, makeScaffoldState, makeText } from './test-utils';

// The scaffold reads the photo sentinel through the app's namespace
// (formats/photoPlaceholder.ts) and `storeKey` refuses to build a key with
// none installed, so a suite that reaches the scaffold installs one — as
// `store/storeKeys.ts` says a test must.
beforeEach(() => {
  registerStoreNamespace('test');
});


// Completion rules (formats/completion.ts). Each rule kind; the anyEdit
// rule delegates to isEntryEdited, whose per-format readings are covered in
// edited.test.ts — here only that the delegation happens.

function scaffolded(overrides: Partial<TestEditorConfig> = {}) {
  const config = makeScaffoldConfig(overrides);
  const { mintId } = makeMintId();
  const { ops, slotNodeIds } = buildScaffoldEntry(config, makeFormatIssue(), mintId);
  const state = applyCompOps(makeScaffoldState(), ops);
  return { config, state, slotNodeIds };
}

function editLine(state: CompositionState, id: string, content: string): CompositionState {
  return { ...state, texts: state.texts!.map((t) => (t.id === id ? { ...t, content } : t)) };
}

function addPhoto(state: CompositionState): CompositionState {
  return { ...state, images: [...(state.images ?? []), makeImage('img_p', { name: 'slot:photo' })] };
}

describe('allSlotsFilled', () => {
  test('false with only the scaffold, true once every slot is filled', () => {
    const { config, state, slotNodeIds } = scaffolded();
    expect(isEntryComplete(config, state, slotNodeIds)).toBe(false);

    let filled = addPhoto(state);
    filled = editLine(filled, slotNodeIds['line1'], 'Warm rain on the roof');
    filled = editLine(filled, slotNodeIds['line2'], 'the kettle hums to itself');
    expect(isEntryComplete(config, filled, slotNodeIds)).toBe(false); // line3 untouched

    filled = editLine(filled, slotNodeIds['line3'], 'a day folds closed');
    expect(isEntryComplete(config, filled, slotNodeIds)).toBe(true);
  });
});

describe('slotsFilled', () => {
  test('only the listed slots matter', () => {
    const { config, state, slotNodeIds } = scaffolded({
      completion: { kind: 'slotsFilled', slotIds: ['line1'] },
    });
    expect(isEntryComplete(config, state, slotNodeIds)).toBe(false);
    const edited = editLine(state, slotNodeIds['line1'], 'Warm rain on the roof');
    expect(isEntryComplete(config, edited, slotNodeIds)).toBe(true); // others unfilled
  });

  test('a slotId missing from the scaffold can never be satisfied', () => {
    const { config, state, slotNodeIds } = scaffolded({
      completion: { kind: 'slotsFilled', slotIds: ['ghost'] },
    });
    expect(isEntryComplete(config, state, slotNodeIds)).toBe(false);
  });
});

describe('a page minted from a template', () => {
  // A template instance never held the scaffold, so no slot on it can be
  // filled — a slot-based rule read literally would keep such a page "not
  // done" forever. The Collage was the case that forced this (its rule
  // named the background and title slots its template replaced); the rule
  // outlived the game, and any slot-based format a template replaces hits
  // it.
  const slotRuled: Partial<TestEditorConfig> = {
    completion: { kind: 'slotsFilled', slotIds: ['line1'] },
  };

  test('the untouched instance is not done, whatever the rule', () => {
    const { config, state, slotNodeIds } = scaffolded(slotRuled);
    const baseline = templateBaselineOf(state);
    expect(isEntryComplete(config, state, slotNodeIds, baseline)).toBe(false);
  });

  test('an edit anywhere completes it — the slot rule no longer applies', () => {
    const { config, state, slotNodeIds } = scaffolded(slotRuled);
    const baseline = templateBaselineOf(state);
    // A text the rule does NOT name: on the scaffold this would still be
    // undone, but a template page is judged against its own baseline.
    const edited = editLine(state, slotNodeIds['line2'], 'the kettle hums to itself');
    expect(isEntryComplete(config, edited, slotNodeIds)).toBe(false);
    expect(isEntryComplete(config, edited, slotNodeIds, baseline)).toBe(true);
  });

  test('filling a photo counts, same as it does for the thumbnail', () => {
    const { config, state, slotNodeIds } = scaffolded(slotRuled);
    const baseline = templateBaselineOf(state);
    expect(isEntryComplete(config, addPhoto(state), slotNodeIds, baseline)).toBe(true);
  });
});

describe('anyEdit', () => {
  const anyEdit: Partial<TestEditorConfig> = { completion: { kind: 'anyEdit' } };

  test('false on the untouched scaffold', () => {
    const { config, state, slotNodeIds } = scaffolded(anyEdit);
    expect(isEntryComplete(config, state, slotNodeIds)).toBe(false);
  });

  test('any added node completes (each kind counts)', () => {
    const { config, state, slotNodeIds } = scaffolded(anyEdit);
    expect(isEntryComplete(config, addPhoto(state), slotNodeIds)).toBe(true);
    const withText = { ...state, texts: [...state.texts!, makeText('txt_extra', 'hi')] };
    expect(isEntryComplete(config, withText, slotNodeIds)).toBe(true);
  });

  test('editing a scaffold text slot completes without changing node count', () => {
    const { config, state, slotNodeIds } = scaffolded(anyEdit);
    const edited = editLine(state, slotNodeIds['line1'], 'Warm rain on the roof');
    expect(isEntryComplete(config, edited, slotNodeIds)).toBe(true);
  });

  test('clearing a placeholder counts as an edit (unlike isSlotFilled)', () => {
    const { config, state, slotNodeIds } = scaffolded(anyEdit);
    const cleared = editLine(state, slotNodeIds['line1'], '');
    expect(isEntryComplete(config, cleared, slotNodeIds)).toBe(true);
  });
});
