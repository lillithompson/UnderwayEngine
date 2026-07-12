import {
  startScript,
  stopScript,
  forceStopScript,
  isScriptActive,
  getCurrentStep,
  getStepIndex,
  getStepCount,
  advanceStep,
  notifyAction,
  setCurrentView,
  subscribe,
  getSnapshot,
  saveCompSnapshot,
  getCompSnapshot,
  trackTutorialFile,
  getTutorialFileIds,
  getActiveBeacons,
  getSampleName,
} from '../tutorial/tutorialEngine';
import { doesActionSatisfy, ActionCounters } from '../tutorial/tutorialActions';
import type { TutorialScript, WaitCondition } from '../tutorial/tutorialTypes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScript(steps: TutorialScript['steps']): TutorialScript {
  return { version: 1, name: 'Test', startView: 'composition', steps };
}

// ---------------------------------------------------------------------------
// doesActionSatisfy
// ---------------------------------------------------------------------------

describe('doesActionSatisfy', () => {
  const counters = (): ActionCounters => ({ floodFillCount: 0, placeSVGCount: 0 });

  test('tap matches tap', () => {
    expect(doesActionSatisfy({ kind: 'tap' }, { kind: 'tap' }, counters())).toBe(true);
  });

  test('tap does not match toolSelect', () => {
    expect(doesActionSatisfy({ kind: 'tap' }, { kind: 'toolSelect', tool: 'draw' }, counters())).toBe(false);
  });

  test('toolSelect matches correct tool', () => {
    const cond: WaitCondition = { kind: 'toolSelect', tool: 'draw' };
    expect(doesActionSatisfy(cond, { kind: 'toolSelect', tool: 'draw' }, counters())).toBe(true);
    expect(doesActionSatisfy(cond, { kind: 'toolSelect', tool: 'erase' }, counters())).toBe(false);
  });

  test('compToolSelect matches correct tool', () => {
    const cond: WaitCondition = { kind: 'compToolSelect', tool: 'create' };
    expect(doesActionSatisfy(cond, { kind: 'compToolSelect', tool: 'create' }, counters())).toBe(true);
    expect(doesActionSatisfy(cond, { kind: 'compToolSelect', tool: 'select' }, counters())).toBe(false);
  });

  test('floodFill checks counter', () => {
    const cond: WaitCondition = { kind: 'floodFill', count: 3 };
    const c = counters();
    expect(doesActionSatisfy(cond, { kind: 'floodFill' }, c)).toBe(false);
    c.floodFillCount = 2;
    expect(doesActionSatisfy(cond, { kind: 'floodFill' }, c)).toBe(false);
    c.floodFillCount = 3;
    expect(doesActionSatisfy(cond, { kind: 'floodFill' }, c)).toBe(true);
  });

  test('floodFill defaults to count 1', () => {
    const cond: WaitCondition = { kind: 'floodFill' };
    const c = counters();
    c.floodFillCount = 1;
    expect(doesActionSatisfy(cond, { kind: 'floodFill' }, c)).toBe(true);
  });

  test('navigate matches direction', () => {
    const cond: WaitCondition = { kind: 'navigate', to: 'figure' };
    expect(doesActionSatisfy(cond, { kind: 'navigate', to: 'figure' }, counters())).toBe(true);
    expect(doesActionSatisfy(cond, { kind: 'navigate', to: 'composition' }, counters())).toBe(false);
  });

  test('buttonPress matches id', () => {
    const cond: WaitCondition = { kind: 'buttonPress', buttonId: 'next' };
    expect(doesActionSatisfy(cond, { kind: 'buttonPress', buttonId: 'next' }, counters())).toBe(true);
    expect(doesActionSatisfy(cond, { kind: 'buttonPress', buttonId: 'skip' }, counters())).toBe(false);
  });

  test('any matches if any sub-condition matches', () => {
    const cond: WaitCondition = {
      kind: 'any',
      conditions: [
        { kind: 'tap' },
        { kind: 'toolSelect', tool: 'erase' },
      ],
    };
    expect(doesActionSatisfy(cond, { kind: 'tap' }, counters())).toBe(true);
    expect(doesActionSatisfy(cond, { kind: 'toolSelect', tool: 'erase' }, counters())).toBe(true);
    expect(doesActionSatisfy(cond, { kind: 'toolSelect', tool: 'draw' }, counters())).toBe(false);
  });

  test('delay never matches an action', () => {
    const cond: WaitCondition = { kind: 'delay', ms: 1000 };
    expect(doesActionSatisfy(cond, { kind: 'tap' }, counters())).toBe(false);
  });

  test('strokeEnd matches', () => {
    expect(doesActionSatisfy({ kind: 'strokeEnd' }, { kind: 'strokeEnd' }, counters())).toBe(true);
  });

  test('canvasDrag matches', () => {
    expect(doesActionSatisfy({ kind: 'canvasDrag' }, { kind: 'canvasDrag' }, counters())).toBe(true);
  });

  test('createDrag matches', () => {
    expect(doesActionSatisfy({ kind: 'createDrag' }, { kind: 'createDrag' }, counters())).toBe(true);
  });

  test('mirrorSelect matches', () => {
    expect(doesActionSatisfy({ kind: 'mirrorSelect' }, { kind: 'mirrorSelect' }, counters())).toBe(true);
  });

  test('selectionComplete matches', () => {
    expect(doesActionSatisfy({ kind: 'selectionComplete' }, { kind: 'selectionComplete' }, counters())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// tutorialEngine
// ---------------------------------------------------------------------------

describe('tutorialEngine', () => {
  afterEach(() => {
    forceStopScript();
    setCurrentView('gallery');
  });

  test('starts inactive', () => {
    expect(isScriptActive()).toBe(false);
    expect(getCurrentStep()).toBeNull();
    expect(getStepIndex()).toBe(0);
    expect(getStepCount()).toBe(0);
  });

  test('startScript activates and sets first step', () => {
    const script = makeScript([
      { type: 'text', id: 's1', text: 'Hello', position: 'center', waitFor: { kind: 'tap' } },
      { type: 'text', id: 's2', text: 'World', position: 'center', waitFor: { kind: 'tap' } },
    ]);
    startScript(script, 'comp-1');
    expect(isScriptActive()).toBe(true);
    expect(getStepIndex()).toBe(0);
    expect(getStepCount()).toBe(2);
    expect(getCurrentStep()?.id).toBe('s1');
  });

  test('advanceStep moves to next step', () => {
    const script = makeScript([
      { type: 'text', id: 's1', text: 'A', position: 'top', waitFor: { kind: 'tap' } },
      { type: 'text', id: 's2', text: 'B', position: 'top', waitFor: { kind: 'tap' } },
    ]);
    startScript(script, 'comp-1');
    advanceStep();
    expect(getStepIndex()).toBe(1);
    expect(getCurrentStep()?.id).toBe('s2');
  });

  test('advancing past last step stops the script', () => {
    const script = makeScript([
      { type: 'text', id: 's1', text: 'Only', position: 'top', waitFor: { kind: 'tap' } },
    ]);
    startScript(script, 'comp-1');
    advanceStep();
    expect(isScriptActive()).toBe(false);
  });

  test('notifyAction advances when condition is met', () => {
    const script = makeScript([
      { type: 'text', id: 's1', text: 'Select create', position: 'top', waitFor: { kind: 'compToolSelect', tool: 'create' } },
      { type: 'text', id: 's2', text: 'Done', position: 'top', waitFor: { kind: 'tap' } },
    ]);
    startScript(script, 'comp-1');

    // Wrong action — should not advance
    notifyAction({ kind: 'compToolSelect', tool: 'select' });
    expect(getStepIndex()).toBe(0);

    // Correct action — advances
    notifyAction({ kind: 'compToolSelect', tool: 'create' });
    expect(getStepIndex()).toBe(1);
  });

  test('floodFill counter accumulates across actions', () => {
    const script = makeScript([
      { type: 'wait', id: 'w1', waitFor: { kind: 'floodFill', count: 3 } },
      { type: 'text', id: 's2', text: 'Done', position: 'top', waitFor: { kind: 'tap' } },
    ]);
    startScript(script, 'comp-1');

    notifyAction({ kind: 'floodFill' });
    expect(getStepIndex()).toBe(0);
    notifyAction({ kind: 'floodFill' });
    expect(getStepIndex()).toBe(0);
    notifyAction({ kind: 'floodFill' });
    expect(getStepIndex()).toBe(1);
  });

  test('floodFill counter resets on step advance', () => {
    const script = makeScript([
      { type: 'wait', id: 'w1', waitFor: { kind: 'floodFill', count: 2 } },
      { type: 'wait', id: 'w2', waitFor: { kind: 'floodFill', count: 2 } },
    ]);
    startScript(script, 'comp-1');

    notifyAction({ kind: 'floodFill' });
    notifyAction({ kind: 'floodFill' });
    expect(getStepIndex()).toBe(1);

    // Counter should have reset — one fill should not satisfy count: 2
    notifyAction({ kind: 'floodFill' });
    expect(getStepIndex()).toBe(1);
  });

  test('button step auto-waits for its own id', () => {
    const script = makeScript([
      { type: 'button', id: 'next-btn', label: 'Next', position: 'bottom' },
      { type: 'text', id: 's2', text: 'Done', position: 'top', waitFor: { kind: 'tap' } },
    ]);
    startScript(script, 'comp-1');

    // Wrong button id
    notifyAction({ kind: 'buttonPress', buttonId: 'other' });
    expect(getStepIndex()).toBe(0);

    // Correct button id
    notifyAction({ kind: 'buttonPress', buttonId: 'next-btn' });
    expect(getStepIndex()).toBe(1);
  });

  test('setCurrentView to gallery stops the script', () => {
    const script = makeScript([
      { type: 'text', id: 's1', text: 'Hi', position: 'top', waitFor: { kind: 'tap' } },
    ]);
    startScript(script, 'comp-1');
    setCurrentView('gallery');
    expect(isScriptActive()).toBe(false);
  });

  test('setCurrentView emits navigate action', () => {
    const script = makeScript([
      { type: 'wait', id: 'w1', waitFor: { kind: 'navigate', to: 'figure' } },
      { type: 'text', id: 's2', text: 'In figure', position: 'top', waitFor: { kind: 'tap' } },
    ]);
    setCurrentView('composition');
    startScript(script, 'comp-1');
    setCurrentView('figure');
    expect(getStepIndex()).toBe(1);
  });

  test('subscribe notifies on state changes', () => {
    const fn = jest.fn();
    const unsub = subscribe(fn);

    const script = makeScript([
      { type: 'text', id: 's1', text: 'Hi', position: 'top', waitFor: { kind: 'tap' } },
    ]);
    startScript(script, 'comp-1');
    expect(fn).toHaveBeenCalled();

    fn.mockClear();
    advanceStep();
    expect(fn).toHaveBeenCalled();

    unsub();
    fn.mockClear();
    startScript(script, 'comp-1');
    expect(fn).not.toHaveBeenCalled();
  });

  test('getSnapshot changes on state updates', () => {
    const v0 = getSnapshot();
    const script = makeScript([
      { type: 'text', id: 's1', text: 'Hi', position: 'top', waitFor: { kind: 'tap' } },
    ]);
    startScript(script, 'comp-1');
    const v1 = getSnapshot();
    expect(v1).not.toBe(v0);

    advanceStep();
    const v2 = getSnapshot();
    expect(v2).not.toBe(v1);
  });

  test('stopScript clears all state', () => {
    const script = makeScript([
      { type: 'text', id: 's1', text: 'Hi', position: 'top', waitFor: { kind: 'tap' } },
    ]);
    startScript(script, 'comp-1');
    saveCompSnapshot('{"test": true}');
    trackTutorialFile('file-1');

    stopScript();
    expect(isScriptActive()).toBe(false);
    expect(getCurrentStep()).toBeNull();
    expect(getCompSnapshot()).toBeNull();
    expect(getTutorialFileIds().size).toBe(0);
  });

  test('snapshot management', () => {
    const script = makeScript([
      { type: 'text', id: 's1', text: 'Hi', position: 'top', waitFor: { kind: 'tap' } },
    ]);
    startScript(script, 'comp-1');

    saveCompSnapshot('{"figures": []}');
    expect(getCompSnapshot()).toBe('{"figures": []}');

    trackTutorialFile('new-file-1');
    trackTutorialFile('new-file-2');
    expect(getTutorialFileIds().size).toBe(2);
    expect(getTutorialFileIds().has('new-file-1')).toBe(true);
  });

  test('compound step with waitFor advances on matching action', () => {
    const script = makeScript([
      {
        type: 'compound',
        id: 'c1',
        elements: [
          { type: 'text', text: 'Select create tool', position: 'bottom' },
          { type: 'highlight', target: { kind: 'label', label: 'Create' } },
        ],
        waitFor: { kind: 'compToolSelect', tool: 'create' },
      },
      { type: 'text', id: 's2', text: 'Done', position: 'top', waitFor: { kind: 'tap' } },
    ]);
    startScript(script, 'comp-1');
    notifyAction({ kind: 'compToolSelect', tool: 'create' });
    expect(getStepIndex()).toBe(1);
  });

  test('delay step auto-advances', () => {
    jest.useFakeTimers();
    const script = makeScript([
      { type: 'wait', id: 'w1', waitFor: { kind: 'delay', ms: 500 } },
      { type: 'text', id: 's2', text: 'After delay', position: 'top', waitFor: { kind: 'tap' } },
    ]);
    startScript(script, 'comp-1');
    expect(getStepIndex()).toBe(0);

    jest.advanceTimersByTime(500);
    expect(getStepIndex()).toBe(1);

    jest.useRealTimers();
  });

  test('autoAdvanceMs on text step without waitFor', () => {
    jest.useFakeTimers();
    const script = makeScript([
      { type: 'text', id: 's1', text: 'Quick', position: 'top', autoAdvanceMs: 200 },
      { type: 'text', id: 's2', text: 'Next', position: 'top', waitFor: { kind: 'tap' } },
    ]);
    startScript(script, 'comp-1');
    expect(getStepIndex()).toBe(0);

    jest.advanceTimersByTime(200);
    expect(getStepIndex()).toBe(1);

    jest.useRealTimers();
  });

  test('setCurrentView notifies subscribers even when no beacon is dismissed', () => {
    const script = makeScript([
      { type: 'text', id: 's1', text: 'Hi', position: 'top', waitFor: { kind: 'tap' } },
    ]);
    setCurrentView('composition');
    startScript(script, 'comp-1');

    const fn = jest.fn();
    const unsub = subscribe(fn);

    setCurrentView('figure');
    expect(fn).toHaveBeenCalled();

    unsub();
  });

  test('beacon view field filters beacons by view', () => {
    const script: TutorialScript = {
      version: 1,
      name: 'Test',
      startView: 'composition',
      steps: [],
      beacons: [
        { target: { kind: 'label', label: 'Create' }, dismissOn: 'compToolSelect', view: 'composition' },
        { target: { kind: 'label', label: 'Flood Fill' }, dismissOn: 'floodFill', view: 'figure' },
        { target: { kind: 'label', label: 'Universal' }, dismissOn: 'tap' },
      ],
      overview: { title: 'T', description: 'D' },
    };
    setCurrentView('composition');
    startScript(script, 'comp-1');

    const beacons = getActiveBeacons();
    expect(beacons).toHaveLength(3);

    // Composition-view overlay should show Create + Universal (filter in TutorialOverlay)
    const compBeacons = beacons.filter(b => !b.view || b.view === 'composition');
    expect(compBeacons).toHaveLength(2);
    expect(compBeacons[0].target).toEqual({ kind: 'label', label: 'Create' });
    expect(compBeacons[1].target).toEqual({ kind: 'label', label: 'Universal' });

    // Figure-view overlay should show Flood Fill + Universal
    const figureBeacons = beacons.filter(b => !b.view || b.view === 'figure');
    expect(figureBeacons).toHaveLength(2);
    expect(figureBeacons[0].target).toEqual({ kind: 'label', label: 'Flood Fill' });
    expect(figureBeacons[1].target).toEqual({ kind: 'label', label: 'Universal' });
  });

  test('startScript stores sampleName and getSampleName retrieves it', () => {
    const script = makeScript([
      { type: 'text', id: 's1', text: 'Hi', position: 'top', waitFor: { kind: 'tap' } },
    ]);
    startScript(script, 'comp-1', false, 'Garden');
    expect(getSampleName()).toBe('Garden');
  });

  test('stopScript preserves sampleName when overview exists', () => {
    const script: TutorialScript = {
      version: 1,
      name: 'Test',
      startView: 'composition',
      steps: [],
      overview: { title: 'T', description: 'D' },
    };
    startScript(script, 'comp-1', false, 'Garden');
    stopScript();
    // Script with overview stays loaded in idle — sampleName preserved
    expect(getSampleName()).toBe('Garden');
  });

  test('stopScript clears sampleName when no overview', () => {
    const script = makeScript([
      { type: 'text', id: 's1', text: 'Hi', position: 'top', waitFor: { kind: 'tap' } },
    ]);
    startScript(script, 'comp-1', false, 'Garden');
    stopScript();
    expect(getSampleName()).toBeNull();
  });

  test('forceStopScript clears sampleName', () => {
    const script: TutorialScript = {
      version: 1,
      name: 'Test',
      startView: 'composition',
      steps: [],
      overview: { title: 'T', description: 'D' },
    };
    startScript(script, 'comp-1', false, 'Garden');
    forceStopScript();
    expect(getSampleName()).toBeNull();
  });
});
