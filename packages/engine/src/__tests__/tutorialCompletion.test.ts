import {
  parseRawConditions,
  initCompletion,
  stopCompletion,
  isCompletionActive,
  notifyCompletionAction,
  notifyCompletionMove,
  registerCompStateAccessor,
  reevaluateOccupy,
  reevaluateCreateFigure,
  reevaluateCreateSVGObject,
  getActiveProgress,
  getConditionDescription,
  getTargetRegions,
  subscribe,
  getSnapshot,
} from '../tutorial/tutorialCompletion';

// ── Mock storage ──────────────────────────────────────────────────

const _store: Record<string, string> = {};

jest.mock('@/engine/storage', () => {
  return {
    __esModule: true,
    default: {
      getItem: (key: string) => Promise.resolve(_store[key] ?? null),
      setItem: (key: string, value: string) => {
        _store[key] = value;
        return Promise.resolve();
      },
      multiGet: (keys: string[]) =>
        Promise.resolve(keys.map((k: string) => [k, _store[k] ?? null] as [string, string | null])),
    },
  };
});

beforeEach(() => {
  stopCompletion();
  for (const k of Object.keys(_store)) delete _store[k];
});

// ── parseRawConditions ────────────────────────────────────────────

describe('parseRawConditions', () => {
  test('parses createFigure object', () => {
    const result = parseRawConditions({ createFigure: { instruction: 'Make something' } });
    expect(result.size).toBe(1);
    expect(result.get('createFigure')).toEqual({ type: 'createFigure', instruction: 'Make something' });
  });

  test('parses createFigure with count', () => {
    const result = parseRawConditions({ createFigure: { count: 3, instruction: 'Create 3 figures' } });
    expect(result.size).toBe(3);
    expect(result.get('createFigure_0')).toEqual({ type: 'createFigure', instruction: 'Create 3 figures' });
    expect(result.get('createFigure_1')).toEqual({ type: 'createFigure', instruction: 'Create 3 figures' });
    expect(result.get('createFigure_2')).toEqual({ type: 'createFigure', instruction: 'Create 3 figures' });
  });

  test('parses editFigure with figureName', () => {
    const result = parseRawConditions({ editFigure: { figureName: 'Star', instruction: 'Edit Star' } });
    expect(result.get('editFigure')).toEqual({ type: 'editFigure', figureName: 'Star', instruction: 'Edit Star' });
  });

  test('parses floodRandom object', () => {
    const result = parseRawConditions({ floodRandom: { instruction: 'Flood it' } });
    expect(result.get('floodRandom')).toEqual({ type: 'floodRandom', instruction: 'Flood it' });
  });

  test('parses moveFigure with object value', () => {
    const result = parseRawConditions({
      moveFigure: { figureName: 'Box', figurePosition: [1, 2, 5, 6], instruction: 'Move the box' },
    });
    expect(result.get('moveFigure')).toEqual({
      type: 'moveFigure',
      figureName: 'Box',
      figurePosition: [1, 2, 5, 6],
      instruction: 'Move the box',
    });
  });

  test('ignores unknown keys', () => {
    const result = parseRawConditions({ unknownThing: { instruction: 'nope' } });
    expect(result.size).toBe(0);
  });

  test('ignores non-object values', () => {
    const result = parseRawConditions({ createFigure: 'wrong', editFigure: 42 });
    expect(result.size).toBe(0);
  });

  test('parses suffixed moveFigure key', () => {
    const result = parseRawConditions({
      moveFigure_flower1: { figureName: 'Flower 1', figurePosition: [-56, -24, 72, 28], instruction: 'Move flower' },
    });
    expect(result.size).toBe(1);
    expect(result.get('moveFigure_flower1')).toEqual({
      type: 'moveFigure',
      figureName: 'Flower 1',
      figurePosition: [-56, -24, 72, 28],
      instruction: 'Move flower',
    });
  });

  test('parses multiple suffixed moveFigure keys', () => {
    const result = parseRawConditions({
      moveFigure_flower1: { figureName: 'Flower 1', figurePosition: [-56, -24, 72, 28], instruction: 'Move' },
      moveFigure_flower2: { figureName: 'Flower 2', figurePosition: [-56, -24, 72, 28], instruction: 'Move' },
      moveFigure_flower3: { figureName: 'Flower 3', figurePosition: [-56, -24, 72, 28], instruction: 'Move' },
    });
    expect(result.size).toBe(3);
    for (const [, cond] of result) {
      expect(cond.type).toBe('moveFigure');
    }
  });

  test('parses suffixed editFigure key', () => {
    const result = parseRawConditions({ editFigure_star: { figureName: 'Star', instruction: 'Edit it' } });
    expect(result.get('editFigure_star')).toEqual({ type: 'editFigure', figureName: 'Star', instruction: 'Edit it' });
  });

  test('rejects suffixed key without underscore separator', () => {
    const result = parseRawConditions({
      moveFigureExtra: { figureName: 'X', figurePosition: [0, 0, 1, 1] },
    });
    expect(result.size).toBe(0);
  });

  test('rejects suffixed key with empty suffix after underscore', () => {
    const result = parseRawConditions({
      'moveFigure_': { figureName: 'X', figurePosition: [0, 0, 1, 1] },
    });
    expect(result.size).toBe(0);
  });

  test('parses occupy with positions array', () => {
    const result = parseRawConditions({
      occupy: {
        instruction: 'Fill the frames',
        positions: [
          { position: [0, 0, 10, 10] },
          { position: [20, 20, 30, 30] },
        ],
      },
    });
    expect(result.size).toBe(2);
    expect(result.get('occupy_0')).toEqual({ type: 'occupy', position: [0, 0, 10, 10], instruction: 'Fill the frames' });
    expect(result.get('occupy_1')).toEqual({ type: 'occupy', position: [20, 20, 30, 30], instruction: 'Fill the frames' });
  });
});

// ── initCompletion / stopCompletion ───────────────────────────────

describe('initCompletion', () => {
  test('activates completion tracking', async () => {
    expect(isCompletionActive()).toBe(false);
    const conditions = parseRawConditions({ createFigure: { instruction: 'Create' } });
    await initCompletion('comp1', conditions);
    expect(isCompletionActive()).toBe(true);
  });

  test('loads persisted progress', async () => {
    _store['tutorial_progress_comp1'] = JSON.stringify({ createFigure: true });
    const conditions = parseRawConditions({
      createFigure: { instruction: 'Create' },
      floodRandom: { instruction: 'Flood' },
    });
    await initCompletion('comp1', conditions);
    const progress = getActiveProgress()!;
    expect(progress.completed).toBe(1);
    expect(progress.conditions.get('createFigure')).toBe(true);
    expect(progress.conditions.get('floodRandom')).toBe(false);
  });

  test('stopCompletion clears active state', async () => {
    const conditions = parseRawConditions({ createFigure: { instruction: 'Create' } });
    await initCompletion('comp1', conditions);
    stopCompletion();
    expect(isCompletionActive()).toBe(false);
    expect(getActiveProgress()).toBeNull();
  });
});

// ── notifyCompletionAction ────────────────────────────────────────

describe('notifyCompletionAction', () => {
  test('marks floodRandom condition as complete', async () => {
    const conditions = parseRawConditions({ floodRandom: { instruction: 'Flood' } });
    await initCompletion('comp1', conditions);

    notifyCompletionAction({ kind: 'floodRandom' });
    expect(getActiveProgress()!.allComplete).toBe(true);
  });

  test('marks editFigure condition when name matches', async () => {
    const conditions = parseRawConditions({ editFigure: { figureName: 'Star', instruction: 'Edit Star' } });
    await initCompletion('comp1', conditions);

    // Wrong name
    notifyCompletionAction({ kind: 'editFigure', figureName: 'Circle' });
    expect(getActiveProgress()!.completed).toBe(0);

    // Correct name
    notifyCompletionAction({ kind: 'editFigure', figureName: 'Star' });
    expect(getActiveProgress()!.completed).toBe(1);
  });

  test('marks moveFigure when in bounding box', async () => {
    const conditions = parseRawConditions({
      moveFigure: { figureName: 'Box', figurePosition: [2, 3, 10, 12], instruction: 'Move box' },
    });
    await initCompletion('comp1', conditions);

    // Outside box
    notifyCompletionAction({ kind: 'moveFigure', figureName: 'Box', cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2 });
    expect(getActiveProgress()!.completed).toBe(0);

    // Inside box
    notifyCompletionAction({ kind: 'moveFigure', figureName: 'Box', cellX: 3, cellY: 4, cellWidth: 4, cellHeight: 5 });
    expect(getActiveProgress()!.completed).toBe(1);
  });

  test('completes multiple suffixed moveFigure conditions independently', async () => {
    const conditions = parseRawConditions({
      moveFigure_a: { figureName: 'A', figurePosition: [0, 0, 10, 10], instruction: 'Move' },
      moveFigure_b: { figureName: 'B', figurePosition: [0, 0, 10, 10], instruction: 'Move' },
    });
    await initCompletion('comp1', conditions);

    // Move A into region
    notifyCompletionAction({ kind: 'moveFigure', figureName: 'A', cellX: 1, cellY: 1, cellWidth: 2, cellHeight: 2 });
    expect(getActiveProgress()!.completed).toBe(1);
    expect(getActiveProgress()!.allComplete).toBe(false);

    // Move B into region
    notifyCompletionAction({ kind: 'moveFigure', figureName: 'B', cellX: 3, cellY: 3, cellWidth: 2, cellHeight: 2 });
    expect(getActiveProgress()!.completed).toBe(2);
    expect(getActiveProgress()!.allComplete).toBe(true);
  });

  test('does not re-trigger already completed condition', async () => {
    const conditions = parseRawConditions({ floodRandom: { instruction: 'Flood' } });
    await initCompletion('comp1', conditions);

    const v1 = getSnapshot();
    notifyCompletionAction({ kind: 'floodRandom' });
    const v2 = getSnapshot();
    expect(v2).toBeGreaterThan(v1);

    // Second notification should not change version
    notifyCompletionAction({ kind: 'floodRandom' });
    expect(getSnapshot()).toBe(v2);
  });

  test('persists progress to storage', async () => {
    const conditions = parseRawConditions({
      floodRandom: { instruction: 'Flood' },
      openHierarchy: { instruction: 'Open' },
    });
    await initCompletion('comp1', conditions);

    notifyCompletionAction({ kind: 'floodRandom' });

    // Wait for async persist
    await new Promise(r => setTimeout(r, 10));
    const stored = JSON.parse(_store['tutorial_progress_comp1']);
    expect(stored.floodRandom).toBe(true);
    expect(stored.openHierarchy).toBe(false);
  });

  test('notifies listeners on change', async () => {
    const conditions = parseRawConditions({ floodRandom: { instruction: 'Flood' } });
    await initCompletion('comp1', conditions);

    const listener = jest.fn();
    const unsub = subscribe(listener);
    notifyCompletionAction({ kind: 'floodRandom' });
    expect(listener).toHaveBeenCalled();
    unsub();
  });
});

// ── reevaluateCreateFigure (ID-baseline) ──────────────────────────

describe('reevaluateCreateFigure', () => {
  function fig(id: string) {
    return { id, cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4 };
  }

  test('pre-existing figures are excluded by ID baseline', async () => {
    const conditions = parseRawConditions({
      createFigure: { count: 3, instruction: 'Create 3' },
    });
    let figures = [fig('A'), fig('B'), fig('C')];
    const unsub = registerCompStateAccessor(() => ({ figures, groups: [], svgObjects: [] }));
    await initCompletion('comp1', conditions);

    reevaluateCreateFigure();
    expect(getActiveProgress()!.completed).toBe(0);

    figures = [...figures, fig('D')];
    reevaluateCreateFigure();
    expect(getActiveProgress()!.completed).toBe(1);
    unsub();
  });

  test('counts user figures cumulatively as more are added', async () => {
    const conditions = parseRawConditions({
      createFigure: { count: 3, instruction: 'Create 3' },
    });
    let figures: Array<ReturnType<typeof fig>> = [];
    const unsub = registerCompStateAccessor(() => ({ figures, groups: [], svgObjects: [] }));
    await initCompletion('comp1', conditions);

    figures = [fig('U1')];
    reevaluateCreateFigure();
    expect(getActiveProgress()!.completed).toBe(1);

    figures = [...figures, fig('U2'), fig('U3')];
    reevaluateCreateFigure();
    expect(getActiveProgress()!.completed).toBe(3);
    expect(getActiveProgress()!.allComplete).toBe(true);
    unsub();
  });

  test('deleting a user figure decrements progress', async () => {
    const conditions = parseRawConditions({
      createFigure: { count: 3, instruction: 'Create 3' },
    });
    let figures: Array<ReturnType<typeof fig>> = [];
    const unsub = registerCompStateAccessor(() => ({ figures, groups: [], svgObjects: [] }));
    await initCompletion('comp1', conditions);

    figures = [fig('U1'), fig('U2'), fig('U3')];
    reevaluateCreateFigure();
    expect(getActiveProgress()!.completed).toBe(3);

    figures = [figures[0], figures[2]];
    reevaluateCreateFigure();
    expect(getActiveProgress()!.completed).toBe(2);
    expect(getActiveProgress()!.allComplete).toBe(false);
    unsub();
  });

  test('deleting a baseline figure does not change progress', async () => {
    const conditions = parseRawConditions({
      createFigure: { count: 2, instruction: 'Create 2' },
    });
    let figures = [fig('A'), fig('B')];
    const unsub = registerCompStateAccessor(() => ({ figures, groups: [], svgObjects: [] }));
    await initCompletion('comp1', conditions);

    figures = [...figures, fig('U1')];
    reevaluateCreateFigure();
    expect(getActiveProgress()!.completed).toBe(1);

    // Delete a baseline figure — only the user-created one still counts
    figures = [fig('B'), fig('U1')];
    reevaluateCreateFigure();
    expect(getActiveProgress()!.completed).toBe(1);
    unsub();
  });

  test('progress and baseline persist across init/stop cycles', async () => {
    const conditions = parseRawConditions({
      createFigure: { count: 5, instruction: 'Create 5' },
    });
    let figures = [fig('A'), fig('B'), fig('C')];
    let unsub = registerCompStateAccessor(() => ({ figures, groups: [], svgObjects: [] }));
    await initCompletion('comp1', conditions);

    figures = [...figures, fig('U1'), fig('U2')];
    reevaluateCreateFigure();
    expect(getActiveProgress()!.completed).toBe(2);
    await new Promise(r => setTimeout(r, 10));
    unsub();

    // Leave and come back — same composition, same figures.
    stopCompletion();
    unsub = registerCompStateAccessor(() => ({ figures, groups: [], svgObjects: [] }));
    await initCompletion('comp1', conditions);

    // Persisted progress restored, baseline IDs reloaded — still 2/5.
    expect(getActiveProgress()!.completed).toBe(2);

    // A re-evaluation against the same state should not flip anything.
    reevaluateCreateFigure();
    expect(getActiveProgress()!.completed).toBe(2);

    // And continuing from here keeps counting.
    figures = [...figures, fig('U3')];
    reevaluateCreateFigure();
    expect(getActiveProgress()!.completed).toBe(3);
    unsub();
  });

  test('no off-by-one: first user figure counts as 1, not 0', async () => {
    const conditions = parseRawConditions({
      createFigure: { count: 2, instruction: 'Create 2' },
    });
    let figures = [fig('A'), fig('B')];
    const unsub = registerCompStateAccessor(() => ({ figures, groups: [], svgObjects: [] }));
    await initCompletion('comp1', conditions);

    // The user has not yet created anything — accessor was registered before
    // any user action, so baseline captured {A,B}. No off-by-one.
    figures = [...figures, fig('U1')];
    reevaluateCreateFigure();
    expect(getActiveProgress()!.completed).toBe(1);
    unsub();
  });

  test('late-registered accessor still captures baseline correctly', async () => {
    const conditions = parseRawConditions({
      createFigure: { count: 2, instruction: 'Create 2' },
    });
    // Init runs first (no accessor yet)
    await initCompletion('comp1', conditions);

    // Then accessor registers with the loaded composition state
    let figures = [fig('A'), fig('B')];
    const unsub = registerCompStateAccessor(() => ({ figures, groups: [], svgObjects: [] }));

    // First user figure counts as 1
    figures = [...figures, fig('U1')];
    reevaluateCreateFigure();
    expect(getActiveProgress()!.completed).toBe(1);
    unsub();
  });

  test('reevaluate without state accessor does not wipe loaded progress', async () => {
    const conditions = parseRawConditions({
      createFigure: { count: 3, instruction: 'Create 3' },
    });
    let figures = [fig('A'), fig('B')];
    let unsub = registerCompStateAccessor(() => ({ figures, groups: [], svgObjects: [] }));
    await initCompletion('comp1', conditions);
    figures = [...figures, fig('U1'), fig('U2')];
    reevaluateCreateFigure();
    expect(getActiveProgress()!.completed).toBe(2);
    await new Promise(r => setTimeout(r, 10));
    unsub();

    // Reopen the comp with no accessor registered yet — reevaluate must not
    // wipe the loaded progress.
    stopCompletion();
    await initCompletion('comp1', conditions);
    reevaluateCreateFigure();
    expect(getActiveProgress()!.completed).toBe(2);
  });

  test('reevaluate before baseline is captured does not wipe loaded progress', async () => {
    const conditions = parseRawConditions({
      createFigure: { count: 3, instruction: 'Create 3' },
    });
    let figures = [fig('A'), fig('B')];
    let unsub = registerCompStateAccessor(() => ({ figures, groups: [], svgObjects: [] }));
    await initCompletion('comp1', conditions);
    figures = [...figures, fig('U1'), fig('U2')];
    reevaluateCreateFigure();
    expect(getActiveProgress()!.completed).toBe(2);
    await new Promise(r => setTimeout(r, 10));
    unsub();

    // Simulate a corrupted/missing baseline (e.g. storage write failure
    // last session) by deleting just the baseline storage entry.
    delete _store['tutorial_baseline_ids_comp1'];

    // Reopen with no accessor: init can't capture, baseline stays null.
    stopCompletion();
    await initCompletion('comp1', conditions);
    reevaluateCreateFigure(); // bail: no baseline
    expect(getActiveProgress()!.completed).toBe(2);
  });

  test('createFigure conditions ignore action notifications (state-managed)', async () => {
    const conditions = parseRawConditions({
      createFigure: { count: 2, instruction: 'Create 2' },
    });
    const figures = [fig('A')];
    const unsub = registerCompStateAccessor(() => ({ figures, groups: [], svgObjects: [] }));
    await initCompletion('comp1', conditions);

    // Firing the event does NOT bump createFigure progress.
    notifyCompletionAction({ kind: 'createFigure' });
    expect(getActiveProgress()!.completed).toBe(0);
    unsub();
  });
});

// ── notifyCompletionMove ──────────────────────────────────────────

describe('notifyCompletionMove', () => {
  test('resolves figure from state accessor and evaluates', async () => {
    const conditions = parseRawConditions({
      moveFigure: { figureName: 'Ship', figurePosition: [0, 0, 10, 10], instruction: 'Move ship' },
    });
    await initCompletion('comp1', conditions);

    const unsub = registerCompStateAccessor(() => ({
      figures: [
        { id: 'f1', name: 'Ship', cellX: 2, cellY: 3, cellWidth: 4, cellHeight: 4 },
      ],
      groups: [],
      svgObjects: [],
    }));

    notifyCompletionMove('f1');
    expect(getActiveProgress()!.completed).toBe(1);
    unsub();
  });

  test('does nothing without state accessor', async () => {
    const conditions = parseRawConditions({
      moveFigure: { figureName: 'Ship', figurePosition: [0, 0, 10, 10], instruction: 'Move ship' },
    });
    await initCompletion('comp1', conditions);

    notifyCompletionMove('f1');
    expect(getActiveProgress()!.completed).toBe(0);
  });

  test('uses absolute position override instead of stale state', async () => {
    const conditions = parseRawConditions({
      moveFigure: { figureName: 'Ship', figurePosition: [0, 0, 10, 10], instruction: 'Move ship' },
    });
    await initCompletion('comp1', conditions);

    // State accessor returns the pre-move position (outside target)
    const unsub = registerCompStateAccessor(() => ({
      figures: [
        { id: 'f1', name: 'Ship', cellX: -50, cellY: -50, cellWidth: 4, cellHeight: 4 },
      ],
      groups: [],
      svgObjects: [],
    }));

    // Override with the actual post-move position (inside target)
    notifyCompletionMove('f1', { cellX: 2, cellY: 3 });
    expect(getActiveProgress()!.completed).toBe(1);
    unsub();
  });

  test('uses delta position override instead of stale state', async () => {
    const conditions = parseRawConditions({
      moveFigure: { figureName: 'Ship', figurePosition: [0, 0, 10, 10], instruction: 'Move ship' },
    });
    await initCompletion('comp1', conditions);

    // State accessor returns the pre-move position (outside target)
    const unsub = registerCompStateAccessor(() => ({
      figures: [
        { id: 'f1', name: 'Ship', cellX: -2, cellY: -3, cellWidth: 4, cellHeight: 4 },
      ],
      groups: [],
      svgObjects: [],
    }));

    // Delta moves it into the target region
    notifyCompletionMove('f1', { dx: 4, dy: 5 });
    expect(getActiveProgress()!.completed).toBe(1);
    unsub();
  });

  test('unchecks moveFigure when figure moves out of region', async () => {
    const conditions = parseRawConditions({
      moveFigure: { figureName: 'Ship', figurePosition: [0, 0, 10, 10], instruction: 'Move ship' },
    });
    await initCompletion('comp1', conditions);

    let pos = { cellX: 2, cellY: 3 };
    const unsub = registerCompStateAccessor(() => ({
      figures: [{ id: 'f1', name: 'Ship', ...pos, cellWidth: 4, cellHeight: 4 }],
      groups: [],
      svgObjects: [],
    }));

    // Move into region
    notifyCompletionMove('f1', { cellX: 2, cellY: 3 });
    expect(getActiveProgress()!.completed).toBe(1);

    // Move out of region
    pos = { cellX: -50, cellY: -50 };
    notifyCompletionMove('f1', { cellX: -50, cellY: -50 });
    expect(getActiveProgress()!.completed).toBe(0);
    unsub();
  });

  test('unchecks only the moved figure, not others', async () => {
    const conditions = parseRawConditions({
      moveFigure_a: { figureName: 'A', figurePosition: [0, 0, 10, 10], instruction: 'Move' },
      moveFigure_b: { figureName: 'B', figurePosition: [0, 0, 10, 10], instruction: 'Move' },
    });
    await initCompletion('comp1', conditions);

    const unsub = registerCompStateAccessor(() => ({
      figures: [
        { id: 'f1', name: 'A', cellX: 2, cellY: 2, cellWidth: 2, cellHeight: 2 },
        { id: 'f2', name: 'B', cellX: 3, cellY: 3, cellWidth: 2, cellHeight: 2 },
      ],
      groups: [],
      svgObjects: [],
    }));

    // Both in region
    notifyCompletionMove('f1', { cellX: 2, cellY: 2 });
    notifyCompletionMove('f2', { cellX: 3, cellY: 3 });
    expect(getActiveProgress()!.completed).toBe(2);

    // Move A out — B stays checked
    notifyCompletionMove('f1', { cellX: -50, cellY: -50 });
    expect(getActiveProgress()!.completed).toBe(1);
    expect(getActiveProgress()!.conditions.get('moveFigure_a')).toBe(false);
    expect(getActiveProgress()!.conditions.get('moveFigure_b')).toBe(true);
    unsub();
  });
});

// ── getTargetRegions ──────────────────────────────────────────────

describe('getTargetRegions', () => {
  test('returns empty when no completion is active', () => {
    expect(getTargetRegions()).toEqual([]);
  });

  test('returns a region with complete=true once an occupy condition is satisfied', async () => {
    const conditions = parseRawConditions({
      occupy: { positions: [{ position: [0, 0, 10, 10] }] },
      // Unrelated unfinished goal so the whole tutorial isn't complete —
      // otherwise the all-complete gate would suppress the region entirely.
      floodRandom: { instruction: 'Flood fill' },
    });
    await initCompletion('comp1', conditions);

    const unsub = registerCompStateAccessor(() => ({
      figures: [{ id: 'f1', cellX: 2, cellY: 2, cellWidth: 4, cellHeight: 4 }],
      groups: [],
      svgObjects: [],
    }));

    // Before re-evaluation the condition has never been checked.
    expect(getTargetRegions()).toEqual([{ bounds: [0, 0, 10, 10], complete: false }]);

    reevaluateOccupy();
    expect(getTargetRegions()).toEqual([{ bounds: [0, 0, 10, 10], complete: true }]);
    unsub();
  });

  test('groups Garden-style sibling moveFigure conditions onto a single region', async () => {
    // 6 conditions, all sharing the same rectangle — mirrors the Garden tutorial.
    const conditions = parseRawConditions({
      move: {
        positions: [
          { figureName: 'Flower 1', position: [-56, -24, 72, 28] },
          { figureName: 'Flower 2', position: [-56, -24, 72, 28] },
          { figureName: 'Flower 3', position: [-56, -24, 72, 28] },
          { figureName: 'Flower 4', position: [-56, -24, 72, 28] },
          { figureName: 'Flower 5', position: [-56, -24, 72, 28] },
          { figureName: 'Flower 6', position: [-56, -24, 72, 28] },
        ],
      },
      // Unrelated unfinished goal so the whole tutorial isn't complete
      // when all six flowers land — keeps this test focused on the
      // per-region grouping logic, not the all-complete gate.
      floodRandom: { instruction: 'Flood fill' },
    });
    await initCompletion('garden', conditions);

    const positions: Record<string, { cellX: number; cellY: number }> = {
      f1: { cellX: -100, cellY: -100 },
      f2: { cellX: -100, cellY: -100 },
      f3: { cellX: -100, cellY: -100 },
      f4: { cellX: -100, cellY: -100 },
      f5: { cellX: -100, cellY: -100 },
      f6: { cellX: -100, cellY: -100 },
    };
    const unsub = registerCompStateAccessor(() => ({
      figures: [
        { id: 'f1', name: 'Flower 1', ...positions.f1, cellWidth: 4, cellHeight: 4 },
        { id: 'f2', name: 'Flower 2', ...positions.f2, cellWidth: 4, cellHeight: 4 },
        { id: 'f3', name: 'Flower 3', ...positions.f3, cellWidth: 4, cellHeight: 4 },
        { id: 'f4', name: 'Flower 4', ...positions.f4, cellWidth: 4, cellHeight: 4 },
        { id: 'f5', name: 'Flower 5', ...positions.f5, cellWidth: 4, cellHeight: 4 },
        { id: 'f6', name: 'Flower 6', ...positions.f6, cellWidth: 4, cellHeight: 4 },
      ],
      groups: [],
      svgObjects: [],
    }));

    // 6 conditions collapse to one region while none are satisfied.
    let regions = getTargetRegions();
    expect(regions).toHaveLength(1);
    expect(regions[0].bounds).toEqual([-56, -24, 72, 28]);
    expect(regions[0].complete).toBe(false);

    // Move 5 flowers into the region — still incomplete.
    const ids = ['f1', 'f2', 'f3', 'f4', 'f5'];
    for (const id of ids) {
      positions[id] = { cellX: 0, cellY: 0 };
      notifyCompletionMove(id, positions[id]);
    }
    regions = getTargetRegions();
    expect(regions).toHaveLength(1);
    expect(regions[0].complete).toBe(false);

    // Move the 6th — now complete.
    positions.f6 = { cellX: 0, cellY: 0 };
    notifyCompletionMove('f6', positions.f6);
    regions = getTargetRegions();
    expect(regions[0].complete).toBe(true);

    // Pull one back out — region reverts to incomplete.
    positions.f1 = { cellX: -100, cellY: -100 };
    notifyCompletionMove('f1', positions.f1);
    regions = getTargetRegions();
    expect(regions[0].complete).toBe(false);

    unsub();
  });

  test('keeps distinct rectangles separate', async () => {
    const conditions = parseRawConditions({
      occupy: {
        positions: [
          { position: [0, 0, 10, 10] },
          { position: [20, 20, 30, 30] },
        ],
      },
    });
    await initCompletion('comp1', conditions);

    const regions = getTargetRegions();
    expect(regions).toHaveLength(2);
    const sorted = [...regions].sort((a, b) => a.bounds[0] - b.bounds[0]);
    expect(sorted[0].bounds).toEqual([0, 0, 10, 10]);
    expect(sorted[1].bounds).toEqual([20, 20, 30, 30]);
    expect(sorted.every(r => !r.complete)).toBe(true);
  });

  test('returns [] once the entire tutorial is complete', async () => {
    const conditions = parseRawConditions({
      occupy: {
        positions: [
          { position: [0, 0, 10, 10] },
          { position: [20, 20, 30, 30] },
        ],
      },
    });
    await initCompletion('comp1', conditions);

    const unsub = registerCompStateAccessor(() => ({
      figures: [
        { id: 'f1', cellX: 2, cellY: 2, cellWidth: 4, cellHeight: 4 },
        { id: 'f2', cellX: 22, cellY: 22, cellWidth: 4, cellHeight: 4 },
      ],
      groups: [],
      svgObjects: [],
    }));

    reevaluateOccupy();
    expect(getTargetRegions()).toEqual([]);
    unsub();
  });

  test('still renders regions while unrelated goals are unfinished', async () => {
    const conditions = parseRawConditions({
      occupy: { positions: [{ position: [0, 0, 10, 10] }] },
      floodRandom: { instruction: 'Flood fill' },
    });
    await initCompletion('comp1', conditions);

    const unsub = registerCompStateAccessor(() => ({
      figures: [{ id: 'f1', cellX: 2, cellY: 2, cellWidth: 4, cellHeight: 4 }],
      groups: [],
      svgObjects: [],
    }));

    // Satisfy occupy but not floodRandom — region should still render,
    // marked complete, because the whole tutorial isn't done.
    reevaluateOccupy();
    const regions = getTargetRegions();
    expect(regions).toEqual([{ bounds: [0, 0, 10, 10], complete: true }]);
    unsub();
  });
});

// ── getConditionDescription ───────────────────────────────────────

describe('getConditionDescription', () => {
  test('uses instruction when provided', () => {
    expect(getConditionDescription('c', { type: 'createFigure', instruction: 'Make art' })).toBe('Make art');
    expect(getConditionDescription('c', { type: 'floodRandom', instruction: 'Fill it up' })).toBe('Fill it up');
  });

  test('falls back to default descriptions', () => {
    expect(getConditionDescription('c', { type: 'createFigure' })).toBe('Create a new figure');
    expect(getConditionDescription('c', { type: 'editFigure', figureName: 'Star' })).toBe('Edit figure "Star"');
    expect(getConditionDescription('c', { type: 'floodRandom' })).toBe('Use random flood fill');
    expect(getConditionDescription('c', { type: 'moveFigure', figureName: 'Box', figurePosition: [0, 0, 5, 5] }))
      .toBe('Move "Box" to target area');
  });

  test('describes new SVG / pattern condition types', () => {
    expect(getConditionDescription('c', { type: 'createLine' })).toBe('Draw a line');
    expect(getConditionDescription('c', { type: 'createArc' })).toBe('Draw an arc');
    expect(getConditionDescription('c', { type: 'createSVGObject' })).toBe('Draw an SVG object');
    expect(getConditionDescription('c', { type: 'recolorSVG' })).toBe("Change an SVG object's color");
    expect(getConditionDescription('c', { type: 'togglePatternMode' })).toBe('Turn on the Pattern tool');
    expect(getConditionDescription('c', { type: 'createPatternRepetition' })).toBe('Repeat a pattern across a region');
  });
});

// ── Action-based SVG / pattern conditions ─────────────────────────

describe('SVG and pattern action-based conditions', () => {
  test('createLine completes on notify', async () => {
    const conditions = parseRawConditions({ createLine: { instruction: 'Line it' } });
    await initCompletion('comp1', conditions);
    notifyCompletionAction({ kind: 'createLine' });
    expect(getActiveProgress()!.allComplete).toBe(true);
  });

  test('createArc completes on notify', async () => {
    const conditions = parseRawConditions({ createArc: { instruction: 'Arc it' } });
    await initCompletion('comp1', conditions);
    notifyCompletionAction({ kind: 'createArc' });
    expect(getActiveProgress()!.allComplete).toBe(true);
  });

  test('recolorSVG completes on notify', async () => {
    const conditions = parseRawConditions({ recolorSVG: { instruction: 'Recolor' } });
    await initCompletion('comp1', conditions);
    notifyCompletionAction({ kind: 'recolorSVG' });
    expect(getActiveProgress()!.allComplete).toBe(true);
  });

  test('togglePatternMode completes on notify', async () => {
    const conditions = parseRawConditions({ togglePatternMode: { instruction: 'Pattern on' } });
    await initCompletion('comp1', conditions);
    notifyCompletionAction({ kind: 'togglePatternMode' });
    expect(getActiveProgress()!.allComplete).toBe(true);
  });

  test('createPatternRepetition completes on notify', async () => {
    const conditions = parseRawConditions({ createPatternRepetition: { instruction: 'Repeat' } });
    await initCompletion('comp1', conditions);
    notifyCompletionAction({ kind: 'createPatternRepetition' });
    expect(getActiveProgress()!.allComplete).toBe(true);
  });
});

// ── createSVGObject (ID-baseline) ─────────────────────────────────

describe('reevaluateCreateSVGObject', () => {
  function obj(id: string) {
    return { id };
  }
  const figureSet: never[] = [];

  test('parses createSVGObject with count into N keys', () => {
    const result = parseRawConditions({ createSVGObject: { count: 3, instruction: 'Draw 3' } });
    expect(result.size).toBe(3);
    expect(result.get('createSVGObject_0')).toEqual({ type: 'createSVGObject', instruction: 'Draw 3' });
    expect(result.get('createSVGObject_1')).toEqual({ type: 'createSVGObject', instruction: 'Draw 3' });
    expect(result.get('createSVGObject_2')).toEqual({ type: 'createSVGObject', instruction: 'Draw 3' });
  });

  test('pre-existing svgObjects are excluded by ID baseline', async () => {
    const conditions = parseRawConditions({ createSVGObject: { count: 3, instruction: 'Draw 3' } });
    let svgObjects = [obj('A'), obj('B'), obj('C')];
    const unsub = registerCompStateAccessor(() => ({ figures: figureSet, groups: [], svgObjects }));
    await initCompletion('comp1', conditions);

    reevaluateCreateSVGObject();
    expect(getActiveProgress()!.completed).toBe(0);

    svgObjects = [...svgObjects, obj('U1')];
    reevaluateCreateSVGObject();
    expect(getActiveProgress()!.completed).toBe(1);
    unsub();
  });

  test('counts user-created svgObjects cumulatively', async () => {
    const conditions = parseRawConditions({ createSVGObject: { count: 3, instruction: 'Draw 3' } });
    let svgObjects: ReturnType<typeof obj>[] = [];
    const unsub = registerCompStateAccessor(() => ({ figures: figureSet, groups: [], svgObjects }));
    await initCompletion('comp1', conditions);

    svgObjects = [obj('U1')];
    reevaluateCreateSVGObject();
    expect(getActiveProgress()!.completed).toBe(1);

    svgObjects = [...svgObjects, obj('U2'), obj('U3')];
    reevaluateCreateSVGObject();
    expect(getActiveProgress()!.completed).toBe(3);
    expect(getActiveProgress()!.allComplete).toBe(true);
    unsub();
  });

  test('createSVGObject conditions ignore action notifications (state-managed)', async () => {
    const conditions = parseRawConditions({ createSVGObject: { count: 2, instruction: 'Draw 2' } });
    const svgObjects = [obj('A')];
    const unsub = registerCompStateAccessor(() => ({ figures: figureSet, groups: [], svgObjects }));
    await initCompletion('comp1', conditions);

    notifyCompletionAction({ kind: 'createSVGObject' });
    expect(getActiveProgress()!.completed).toBe(0);
    unsub();
  });

  test('baseline persists across init/stop cycles', async () => {
    const conditions = parseRawConditions({ createSVGObject: { count: 4, instruction: 'Draw 4' } });
    let svgObjects = [obj('A'), obj('B')];
    let unsub = registerCompStateAccessor(() => ({ figures: figureSet, groups: [], svgObjects }));
    await initCompletion('comp1', conditions);

    svgObjects = [...svgObjects, obj('U1')];
    reevaluateCreateSVGObject();
    expect(getActiveProgress()!.completed).toBe(1);
    await new Promise(r => setTimeout(r, 10));
    unsub();

    stopCompletion();
    unsub = registerCompStateAccessor(() => ({ figures: figureSet, groups: [], svgObjects }));
    await initCompletion('comp1', conditions);

    expect(getActiveProgress()!.completed).toBe(1);

    svgObjects = [...svgObjects, obj('U2')];
    reevaluateCreateSVGObject();
    expect(getActiveProgress()!.completed).toBe(2);
    unsub();
  });
});
