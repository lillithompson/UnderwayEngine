import { CompositionState } from '@/engine/types';
import { isSlotFilled } from './scaffold';
import type { PromptStep, ScaffoldEditorConfig, ScaffoldNode } from './editorConfig';

// Prompt-flow state machine (CozyJournal.md §4.3): the guided steps a
// format runs before/around free editing. Pure and immutable — the editor
// holds a PromptFlowState and replaces it wholesale on every transition,
// so React renders and undo snapshots never see partial mutations.
//
// Step semantics:
// - 'fillSlot' steps advance AUTOMATICALLY via evaluateAdvance() once
//   their slot is filled (the editor calls it after every committed op).
// - 'info' steps gate on an explicit advance() (user taps "next");
//   evaluateAdvance never passes them.
// - a 'free' step — or running out of steps — means the flow is done and
//   the full configured toolset unlocks.

export interface PromptFlowState {
  steps: PromptStep[];
  /** Index of the current step; may equal steps.length when exhausted. */
  index: number;
  /** True once the flow reaches a 'free' step or runs out of steps. */
  done: boolean;
}

/** Build a flow state at `index`, deriving `done` from the step there. */
function flowAt(steps: PromptStep[], index: number): PromptFlowState {
  const done = index >= steps.length || steps[index].kind === 'free';
  return { steps, index, done };
}

export function createPromptFlow(config: ScaffoldEditorConfig): PromptFlowState {
  return flowAt(config.promptFlow, 0);
}

/**
 * A flow that starts already done — for pages whose composition didn't come
 * from the format's scaffold (a template instance): the fillSlot steps point
 * at slots such a page never seeded, so the guided flow would wait forever
 * on step one. Free editing from the first tap instead.
 */
export function createCompletedPromptFlow(config: ScaffoldEditorConfig): PromptFlowState {
  return flowAt(config.promptFlow, config.promptFlow.length);
}

/** The step the flow is waiting on; null once steps are exhausted. */
export function currentStep(flow: PromptFlowState): PromptStep | null {
  return flow.index < flow.steps.length ? flow.steps[flow.index] : null;
}

/**
 * Explicit advance (the user acknowledged an 'info' step, or the editor
 * force-skips a step). No-op once done — a 'free' step is terminal.
 */
export function advance(flow: PromptFlowState): PromptFlowState {
  if (flow.done) return flow;
  return flowAt(flow.steps, flow.index + 1);
}

/**
 * Re-evaluate the flow against the composition: auto-advances past every
 * consecutive 'fillSlot' step whose slot is already filled (so pre-filled
 * or batch-filled slots chain in one call), stopping at the first
 * unfilled fillSlot or at an 'info' step (which needs an explicit
 * advance()). Landing on 'free' or exhausting the steps marks the flow
 * done. Returns the input state unchanged (same reference) when nothing
 * moves, so callers can cheap-compare for "did the prompt change".
 */
export function evaluateAdvance(
  flow: PromptFlowState,
  state: CompositionState,
  slotNodeIds: Record<string, string>,
  scaffold: ScaffoldNode[],
): PromptFlowState {
  let index = flow.index;
  while (index < flow.steps.length) {
    const step = flow.steps[index];
    if (step.kind !== 'fillSlot') break; // 'info' gates; 'free' is terminal.
    const slot = scaffold.find((s) => s.slotId === step.slotId);
    // A step pointing at a missing slot can never auto-pass; stop rather
    // than skip so the misconfiguration is visible (validateScaffoldEditorConfig
    // catches it at authoring time).
    if (!slot || !isSlotFilled(state, slot, slotNodeIds)) break;
    index++;
  }
  if (index === flow.index) return flow;
  return flowAt(flow.steps, index);
}
