import { applyCompOps } from '@/engine/compositionOps';
import { registerStoreNamespace } from '../store/storeKeys';
import { CompositionState } from '@/engine/types';
import { buildScaffoldEntry } from '../formats/scaffold';
import {
  PromptFlowState,
  advance,
  createPromptFlow,
  currentStep,
  evaluateAdvance,
} from '../formats/promptFlow';
import type { PromptStep } from '../formats/editorConfig';
import type { TestEditorConfig } from './test-utils';
import { makeScaffoldConfig, makeImage, makeFormatIssue, makeMintId, makeScaffoldState } from './test-utils';

// The scaffold reads the photo sentinel through the app's namespace
// (formats/photoPlaceholder.ts) and `storeKey` refuses to build a key with
// none installed, so a suite that reaches the scaffold installs one — as
// `store/storeKeys.ts` says a test must.
beforeEach(() => {
  registerStoreNamespace('test');
});


// Prompt-flow state machine (formats/promptFlow.ts): auto-advance
// through filled fillSlot steps, explicit-advance-only info steps, done on
// 'free' or exhaustion, and immutability of every transition.

/** Scaffolded haiku state + the ids/scaffold the flow evaluates against. */
function scaffoldedHaiku(config: TestEditorConfig = makeScaffoldConfig()) {
  const { mintId } = makeMintId();
  const { ops, slotNodeIds } = buildScaffoldEntry(config, makeFormatIssue(), mintId);
  const state = applyCompOps(makeScaffoldState(), ops);
  return { config, state, slotNodeIds };
}

/** Fill the photo slot and/or edit text slots on a scaffolded state. */
function fill(
  state: CompositionState,
  slotNodeIds: Record<string, string>,
  slots: { photo?: boolean; line1?: boolean; line2?: boolean; line3?: boolean },
): CompositionState {
  let next = state;
  if (slots.photo) {
    next = { ...next, images: [...(next.images ?? []), makeImage('img_p', { name: 'slot:photo' })] };
  }
  const edited = (['line1', 'line2', 'line3'] as const).filter((k) => slots[k]);
  if (edited.length) {
    const ids = new Set(edited.map((k) => slotNodeIds[k]));
    next = {
      ...next,
      texts: next.texts!.map((t) => (ids.has(t.id) ? { ...t, content: 'edited: ' + t.id } : t)),
    };
  }
  return next;
}

describe('createPromptFlow / currentStep', () => {
  test('starts at the first step, not done', () => {
    const flow = createPromptFlow(makeScaffoldConfig());
    expect(flow.index).toBe(0);
    expect(flow.done).toBe(false);
    expect(currentStep(flow)!.id).toBe('p-photo');
  });

  test('empty promptFlow is done immediately', () => {
    const flow = createPromptFlow(makeScaffoldConfig({ promptFlow: [] }));
    expect(flow.done).toBe(true);
    expect(currentStep(flow)).toBeNull();
  });

  test("a leading 'free' step is done at creation", () => {
    const flow = createPromptFlow(makeScaffoldConfig({ promptFlow: [{ id: 'f', kind: 'free' }] }));
    expect(flow.done).toBe(true);
  });
});

describe('evaluateAdvance', () => {
  test('stays put while the current slot is unfilled', () => {
    const { config, state, slotNodeIds } = scaffoldedHaiku();
    const flow = createPromptFlow(config);
    const next = evaluateAdvance(flow, state, slotNodeIds, config.scaffold);
    expect(next).toBe(flow); // unchanged — same reference for cheap compare
  });

  test('auto-advances through consecutive pre-filled fillSlot steps', () => {
    const { config, state, slotNodeIds } = scaffoldedHaiku();
    const filled = fill(state, slotNodeIds, { photo: true, line1: true, line2: true });
    const flow = createPromptFlow(config);
    const next = evaluateAdvance(flow, filled, slotNodeIds, config.scaffold);
    expect(next.index).toBe(3); // stopped at the unfilled line3 step
    expect(currentStep(next)!.id).toBe('p-line3');
    expect(next.done).toBe(false);
  });

  test("all slots filled → chains onto 'free' and is done", () => {
    const { config, state, slotNodeIds } = scaffoldedHaiku();
    const filled = fill(state, slotNodeIds, { photo: true, line1: true, line2: true, line3: true });
    const flow = createPromptFlow(config);
    const next = evaluateAdvance(flow, filled, slotNodeIds, config.scaffold);
    expect(next.done).toBe(true);
    expect(currentStep(next)!.kind).toBe('free');
  });

  test('exhausting the steps (no free step) is done, currentStep null', () => {
    const config = makeScaffoldConfig({
      promptFlow: [{ id: 'p-photo', kind: 'fillSlot', slotId: 'photo', title: 'Photo' }],
    });
    const { state, slotNodeIds } = scaffoldedHaiku(config);
    const filled = fill(state, slotNodeIds, { photo: true });
    const next = evaluateAdvance(createPromptFlow(config), filled, slotNodeIds, config.scaffold);
    expect(next.index).toBe(1);
    expect(next.done).toBe(true);
    expect(currentStep(next)).toBeNull();
  });

  test("does NOT advance past an 'info' step, even with later slots filled", () => {
    const promptFlow: PromptStep[] = [
      { id: 'p-photo', kind: 'fillSlot', slotId: 'photo', title: 'Photo' },
      { id: 'p-info', kind: 'info', title: 'Nice! Now the words.' },
      { id: 'p-line1', kind: 'fillSlot', slotId: 'line1', title: 'Line 1' },
    ];
    const config = makeScaffoldConfig({ promptFlow });
    const { state, slotNodeIds } = scaffoldedHaiku(config);
    const filled = fill(state, slotNodeIds, { photo: true, line1: true });
    const atInfo = evaluateAdvance(createPromptFlow(config), filled, slotNodeIds, config.scaffold);
    expect(currentStep(atInfo)!.kind).toBe('info');
    // Re-evaluating still doesn't pass it…
    expect(evaluateAdvance(atInfo, filled, slotNodeIds, config.scaffold)).toBe(atInfo);
    // …but an explicit advance() does, and the filled line1 then chains.
    const past = evaluateAdvance(advance(atInfo), filled, slotNodeIds, config.scaffold);
    expect(past.index).toBe(3);
    expect(past.done).toBe(true);
  });

  test('a seedSvg-backed fillSlot step auto-passes (always filled)', () => {
    const config = makeScaffoldConfig({
      scaffold: [
        { kind: 'seedSvg', slotId: 'seed', payloadKey: 'scaffolded', cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32 },
      ],
      promptFlow: [
        { id: 'p-seed', kind: 'fillSlot', slotId: 'seed', title: 'Meet your squiggle' },
        { id: 'p-free', kind: 'free' },
      ],
    });
    const next = evaluateAdvance(createPromptFlow(config), makeScaffoldState(), {}, config.scaffold);
    expect(next.done).toBe(true);
  });

  test('a fillSlot step referencing a missing slot gates instead of throwing', () => {
    const config = makeScaffoldConfig({
      promptFlow: [{ id: 'p-ghost', kind: 'fillSlot', slotId: 'ghost', title: '?' }],
    });
    const { state, slotNodeIds } = scaffoldedHaiku(config);
    const next = evaluateAdvance(createPromptFlow(config), state, slotNodeIds, config.scaffold);
    expect(next.index).toBe(0);
  });
});

describe('advance', () => {
  test('advances one step and recomputes done', () => {
    const config = makeScaffoldConfig({
      promptFlow: [
        { id: 'i1', kind: 'info', title: 'Welcome' },
        { id: 'f', kind: 'free' },
      ],
    });
    const flow = createPromptFlow(config);
    const next = advance(flow);
    expect(next.index).toBe(1);
    expect(next.done).toBe(true);
  });

  test('is a no-op once done', () => {
    const flow = createPromptFlow(makeScaffoldConfig({ promptFlow: [{ id: 'f', kind: 'free' }] }));
    expect(advance(flow)).toBe(flow);
  });
});

describe('immutability', () => {
  test('transitions never mutate the input flow (frozen inputs)', () => {
    const { config, state, slotNodeIds } = scaffoldedHaiku();
    const filled = fill(state, slotNodeIds, { photo: true });
    const flow: PromptFlowState = Object.freeze(createPromptFlow(config));
    Object.freeze(flow.steps);

    const advanced = advance(flow);
    expect(advanced).not.toBe(flow);
    expect(flow.index).toBe(0);

    const evaluated = evaluateAdvance(flow, filled, slotNodeIds, config.scaffold);
    expect(evaluated).not.toBe(flow);
    expect(evaluated.index).toBe(1);
    expect(flow.index).toBe(0);
    expect(flow.done).toBe(false);
  });
});
