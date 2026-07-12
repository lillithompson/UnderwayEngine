import type { TutorialScript, TutorialStep, TutorialAction, TutorialBeacon, WaitCondition, SetStateCommand, TutorialPhase, DisableableCompTool } from './tutorialTypes';
import { doesActionSatisfy, ActionCounters } from './tutorialActions';
import { initCompletion, parseRawConditions, getActiveProgress, setOnAllMovesComplete, setOnOccupyRegion } from './tutorialCompletion';

// ---------------------------------------------------------------------------
// Module-level singleton state
// ---------------------------------------------------------------------------

let _activeScript: TutorialScript | null = null;
let _stepIndex = 0;
let _counters: ActionCounters = { floodFillCount: 0, placeSVGCount: 0 };
let _currentView: 'composition' | 'figure' | 'gallery' = 'gallery';
let _sampleName: string | null = null;
let _delayTimer: ReturnType<typeof setTimeout> | null = null;
let _dropdownOpen = false;
/** Which view the tutorial script expects to be in right now */
let _expectedView: 'composition' | 'figure' = 'composition';
let _phase: TutorialPhase = 'idle';
let _stepsFinishedVersion = 0;

/** Serialised composition state captured at script start */
let _compSnapshot: string | null = null;
/** File IDs created during the tutorial (for cleanup) */
let _tutorialFileIds: Set<string> = new Set();

/** Indices of beacons that have been dismissed by user action */
let _dismissedBeacons: Set<number> = new Set();

// setState callback — registered by the active editor to apply commands
let _setStateHandler: ((commands: SetStateCommand[]) => void) | null = null;

// Listeners for useSyncExternalStore
let _version = 0;
const _listeners = new Set<() => void>();

function notify(): void {
  _version++;
  for (const cb of _listeners) cb();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startScript(script: TutorialScript, compId: string, skipOverview = false, sampleName?: string): void {
  clearDelayTimer();
  _activeScript = script;
  _stepIndex = 0;
  _counters = { floodFillCount: 0, placeSVGCount: 0 };
  _sampleName = sampleName ?? null;
  _expectedView = script.startView;
  _tutorialFileIds = new Set();
  _dismissedBeacons = new Set();

  if (script.overview && !skipOverview) {
    _phase = 'overview';
    notify();
  } else if (script.overview && skipOverview) {
    _phase = 'idle';
    notify();
  } else {
    _phase = 'steps';
    notify();
    drainSetStateSteps();
    scheduleDelayIfNeeded();
  }

  // Initialize completion tracking if the script has conditions
  if (script.completeConditions) {
    initCompletion(compId, parseRawConditions(script.completeConditions));
  }

  // Bridge: when all moveFigure completion conditions are satisfied,
  // emit a tutorial action so step waitFor can react.
  setOnAllMovesComplete(() => notifyAction({ kind: 'allMovesComplete' }));
}

export function stopScript(): void {
  clearDelayTimer();
  // Scripts with an overview stay loaded in idle phase so the ? button remains
  if (_activeScript?.overview) {
    _phase = 'idle';
    _stepIndex = 0;
    _counters = { floodFillCount: 0, placeSVGCount: 0 };
    notify();
    return;
  }
  _activeScript = null;
  _phase = 'idle';
  _stepIndex = 0;
  _counters = { floodFillCount: 0, placeSVGCount: 0 };
  _sampleName = null;
  _compSnapshot = null;
  _tutorialFileIds = new Set();
  notify();
}

/** Full teardown — ignores overview, used when navigating to gallery. */
export function forceStopScript(): void {
  clearDelayTimer();
  setOnAllMovesComplete(null);
  setOnOccupyRegion(null, null);
  _activeScript = null;
  _phase = 'idle';
  _stepIndex = 0;
  _counters = { floodFillCount: 0, placeSVGCount: 0 };
  _sampleName = null;
  _compSnapshot = null;
  _tutorialFileIds = new Set();
  notify();
}

/**
 * Register a handler that applies setState commands.
 * Called by the active editor on mount. Returns an unsubscribe function.
 */
export function registerSetStateHandler(handler: (commands: SetStateCommand[]) => void): () => void {
  _setStateHandler = handler;
  // If we're currently on a setState step, apply immediately
  drainSetStateSteps();
  return () => {
    if (_setStateHandler === handler) _setStateHandler = null;
  };
}

export function isScriptActive(): boolean {
  return _activeScript !== null;
}

export function getCurrentStep(): TutorialStep | null {
  if (!_activeScript || _phase !== 'steps') return null;
  return _activeScript.steps[_stepIndex] ?? null;
}

export function getStepIndex(): number {
  return _stepIndex;
}

export function getStepCount(): number {
  return _activeScript?.steps.length ?? 0;
}

export function getSampleName(): string | null {
  return _sampleName;
}

export function getCurrentView(): 'composition' | 'figure' | 'gallery' {
  return _currentView;
}

export function getFloodFillCount(): number {
  return _counters.floodFillCount;
}

export function setDropdownOpen(open: boolean): void {
  if (_dropdownOpen === open) return;
  _dropdownOpen = open;
  if (_activeScript) notify();
}

export function isDropdownOpen(): boolean {
  return _dropdownOpen;
}

export function getExpectedView(): 'composition' | 'figure' {
  return _expectedView;
}

export function getPhase(): TutorialPhase {
  return _phase;
}

/** Returns a version counter that increments each time steps finish. */
export function getStepsFinishedVersion(): number {
  return _stepsFinishedVersion;
}

export function getOverview(): { title: string; description: string } | null {
  return _activeScript?.overview ?? null;
}

export function hasSteps(): boolean {
  return (_activeScript?.steps.length ?? 0) > 0;
}

function isAllComplete(): boolean {
  const progress = getActiveProgress();
  return !!progress && progress.allComplete;
}

/** True when the script has completeConditions but they haven't loaded yet. */
function isCompletionPending(): boolean {
  return !!_activeScript?.completeConditions && !getActiveProgress();
}

export function getDisabledCompTools(): DisableableCompTool[] {
  if (isAllComplete() || isCompletionPending()) return [];
  return _activeScript?.disabledCompTools ?? [];
}

export function getActiveBeacons(): TutorialBeacon[] {
  if (!_activeScript?.beacons || isAllComplete() || isCompletionPending()) return [];
  return _activeScript.beacons.filter((b, i) => {
    if (_dismissedBeacons.has(i)) return false;
    if (b.after !== undefined && !_dismissedBeacons.has(b.after)) return false;
    return true;
  });
}

/** Returns the tapHint of the first active beacon whose label-target matches
 *  the given label in the current view, or null. Call sites in the UI use
 *  this to redirect a wrong gesture to a hint modal. */
export function getActiveBeaconTapHint(label: string): string | null {
  for (const b of getActiveBeacons()) {
    if (b.view && b.view !== _currentView) continue;
    if (b.target.kind === 'label' && b.target.label === label && b.tapHint) {
      return b.tapHint;
    }
  }
  return null;
}

/** Dismiss the overview banner without starting steps. */
export function dismissOverview(): void {
  if (_phase !== 'overview') return;
  _phase = 'idle';
  notify();
}

/** Start (or restart) the step-by-step walkthrough from step 0. */
export function beginSteps(): void {
  if (!_activeScript || _activeScript.steps.length === 0) return;
  _phase = 'steps';
  _stepIndex = 0;
  _counters = { floodFillCount: 0, placeSVGCount: 0 };
  _expectedView = _activeScript.startView;
  clearDelayTimer();
  notify();
  drainSetStateSteps();
  syncOccupyRegionCallback();
  scheduleDelayIfNeeded();
}

/** Apply a setState command immediately through the registered handler. */
export function applySetStateCommand(command: SetStateCommand): void {
  if (_setStateHandler) {
    _setStateHandler([command]);
  }
}

export function advanceStep(): void {
  if (!_activeScript) return;
  clearDelayTimer();
  _stepIndex++;
  // Reset per-step counters
  _counters.floodFillCount = 0;
  _counters.placeSVGCount = 0;
  if (_stepIndex >= _activeScript.steps.length) {
    _stepsFinishedVersion++;
    stopScript();
    return;
  }
  notify();
  drainSetStateSteps();
  syncOccupyRegionCallback();
  scheduleDelayIfNeeded();
}

export function setCurrentView(view: 'composition' | 'figure' | 'gallery'): void {
  const prev = _currentView;
  _currentView = view;
  if (view === 'gallery' && _activeScript) {
    forceStopScript();
    return;
  }
  // Emit navigation action if script is active and view actually changed
  if (_activeScript && prev !== view) {
    notifyAction({ kind: 'navigate', to: view });
    notify();
  }
}

export function notifyAction(action: TutorialAction): void {
  if (!_activeScript) return;

  // Check beacon dismissals (works in any phase)
  if (_activeScript.beacons) {
    let dismissed = false;
    _activeScript.beacons.forEach((b, i) => {
      if (!_dismissedBeacons.has(i) && b.dismissOn === action.kind) {
        _dismissedBeacons.add(i);
        dismissed = true;
      }
    });
    if (dismissed) {
      if (_phase === 'overview') _phase = 'idle';
      notify();
    }
  }

  if (_phase !== 'steps') return;

  // Update counters before checking condition
  if (action.kind === 'floodFill') {
    _counters.floodFillCount++;
    notify();
  }
  if (action.kind === 'placeSVG') {
    _counters.placeSVGCount++;
    notify();
  }

  const step = getCurrentStep();
  if (!step) return;

  const condition = getStepWaitCondition(step);
  if (!condition) {
    // Steps without waitFor auto-advance (text with autoAdvanceMs or buttons)
    if (step.type === 'button' && action.kind === 'buttonPress') {
      if (action.buttonId === step.id) {
        advanceStep();
      }
    }
    return;
  }

  if (doesActionSatisfy(condition, action, _counters)) {
    // Update expected view when a navigate condition is satisfied
    if (condition.kind === 'navigate' && (condition.to === 'figure' || condition.to === 'composition')) {
      _expectedView = condition.to;
    }
    advanceStep();
  }
}

// ---------------------------------------------------------------------------
// Snapshot management (for save prevention)
// ---------------------------------------------------------------------------

export function saveCompSnapshot(serialized: string): void {
  _compSnapshot = serialized;
}

export function getCompSnapshot(): string | null {
  return _compSnapshot;
}

export function trackTutorialFile(fileId: string): void {
  _tutorialFileIds.add(fileId);
}

export function getTutorialFileIds(): Set<string> {
  return _tutorialFileIds;
}

// ---------------------------------------------------------------------------
// Subscribe for useSyncExternalStore
// ---------------------------------------------------------------------------

export function subscribe(cb: () => void): () => void {
  _listeners.add(cb);
  return () => { _listeners.delete(cb); };
}

export function getSnapshot(): number {
  return _version;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sync the occupyRegion callback with the current step's wait condition. */
function syncOccupyRegionCallback(): void {
  const step = getCurrentStep();
  const condition = step ? getStepWaitCondition(step) : null;
  if (condition && condition.kind === 'occupyRegion') {
    setOnOccupyRegion(
      { position: condition.position, count: condition.count },
      () => notifyAction({ kind: 'occupyRegion' }),
    );
  } else {
    setOnOccupyRegion(null, null);
  }
}

function getStepWaitCondition(step: TutorialStep): WaitCondition | null {
  switch (step.type) {
    case 'text':
    case 'highlight':
    case 'gif':
    case 'wait':
    case 'compound':
      return step.waitFor ?? null;
    case 'button':
      // Buttons implicitly wait for their own press
      return { kind: 'buttonPress', buttonId: step.id };
    default:
      return null;
  }
}

/**
 * If the current step is a setState step and a handler is registered,
 * apply commands and skip forward.  If no handler is registered, leave
 * the step pending — it will be drained when a handler registers.
 */
function drainSetStateSteps(): void {
  if (!_setStateHandler) {
    console.log('[tutorial] drainSetState: no handler registered');
    return;
  }
  let advanced = false;
  while (_activeScript && _stepIndex < _activeScript.steps.length) {
    const step = _activeScript.steps[_stepIndex];
    if (step.type !== 'setState') break;
    console.log('[tutorial] drainSetState: applying commands', step.commands);
    _setStateHandler(step.commands);
    _stepIndex++;
    advanced = true;
  }
  if (!advanced) return;
  if (_activeScript && _stepIndex >= _activeScript.steps.length) {
    stopScript();
    return;
  }
  notify();
}

function clearDelayTimer(): void {
  if (_delayTimer !== null) {
    clearTimeout(_delayTimer);
    _delayTimer = null;
  }
}

function scheduleDelayIfNeeded(): void {
  const step = getCurrentStep();
  if (!step) return;

  const condition = getStepWaitCondition(step);

  // Handle autoAdvanceMs on text steps
  if (step.type === 'text' && step.autoAdvanceMs && !condition) {
    _delayTimer = setTimeout(() => {
      _delayTimer = null;
      advanceStep();
    }, step.autoAdvanceMs);
    return;
  }

  // Handle delay wait condition
  if (condition?.kind === 'delay') {
    _delayTimer = setTimeout(() => {
      _delayTimer = null;
      advanceStep();
    }, condition.ms);
  }
}
