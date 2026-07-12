import storage from '../storage';
import type { CompleteCondition, CompletionAction } from './tutorialCompletionTypes';

// ---------------------------------------------------------------------------
// Parse raw conditions from .ftutorial JSON
// ---------------------------------------------------------------------------

export function parseRawConditions(raw: Record<string, unknown>): Map<string, CompleteCondition> {
  const result = new Map<string, CompleteCondition>();
  for (const [key, value] of Object.entries(raw)) {
    // occupy: array format (legacy) or object with positions array
    if (key === 'occupy') {
      const instruction = (value && typeof value === 'object' && !Array.isArray(value))
        ? (value as any).instruction as string | undefined
        : undefined;
      const isObj = value && typeof value === 'object' && !Array.isArray(value);
      const strict = isObj ? (value as any).strict === true : false;
      const exclude: string[] | undefined = isObj && Array.isArray((value as any).exclude) ? (value as any).exclude : undefined;
      const positions: unknown[] = Array.isArray(value)
        ? value
        : (isObj && 'positions' in value && Array.isArray((value as any).positions))
          ? (value as any).positions
          : [];
      for (let i = 0; i < positions.length; i++) {
        const item = positions[i];
        if (item && typeof item === 'object' && 'position' in item &&
            Array.isArray((item as any).position) && (item as any).position.length === 4) {
          result.set(`occupy_${i}`, { type: 'occupy', position: (item as any).position, strict: strict || undefined, exclude, instruction });
        }
      }
      continue;
    }
    // move: object with positions array (each entry has figureName + position)
    if (key === 'move' && value && typeof value === 'object' && !Array.isArray(value)) {
      const instruction = getInstruction(value);
      const positions: unknown[] = Array.isArray((value as any).positions) ? (value as any).positions : [];
      for (let i = 0; i < positions.length; i++) {
        const item = positions[i] as any;
        if (item && typeof item === 'object' &&
            'figureName' in item && typeof item.figureName === 'string' &&
            'position' in item && Array.isArray(item.position) && item.position.length === 4) {
          result.set(`moveFigure_${i}`, {
            type: 'moveFigure',
            figureName: item.figureName,
            figurePosition: item.position as [number, number, number, number],
            instruction,
          });
        }
      }
      continue;
    }
    // createFigure with count: expand into N individual conditions
    if (extractBaseType(key) === 'createFigure' && value && typeof value === 'object' && 'count' in value) {
      const count = (value as any).count as number;
      const instruction = (value as any).instruction as string | undefined;
      for (let i = 0; i < count; i++) {
        result.set(`createFigure_${i}`, { type: 'createFigure', instruction });
      }
      continue;
    }
    // createSVGObject with count: expand into N individual conditions
    if (extractBaseType(key) === 'createSVGObject' && value && typeof value === 'object' && 'count' in value) {
      const count = (value as any).count as number;
      const instruction = (value as any).instruction as string | undefined;
      for (let i = 0; i < count; i++) {
        result.set(`createSVGObject_${i}`, { type: 'createSVGObject', instruction });
      }
      continue;
    }
    const condition = parseOne(key, value);
    if (condition) result.set(key, condition);
  }
  return result;
}

const CONDITION_TYPES = ['editFigure', 'createFigure', 'moveFigure', 'floodRandom', 'openHierarchy', 'openFiguresTab', 'editExistingFigure', 'createPattern', 'duplicateFigure', 'createGroup', 'pickColor', 'reconcileTool', 'cutoutTool', 'mirrorH', 'mirrorStar', 'mirrorAny', 'occupyLayers', 'randomBrush', 'importLibrary', 'placeFigure', 'placeTile', 'shiftLayer', 'addLayer', 'tileProperties', 'changeLayer', 'applyColor', 'togglePatternMode', 'createPatternRepetition', 'createLine', 'createArc', 'createSVGObject', 'recolorSVG', 'rotateObject', 'mirrorObject', 'duplicateObject', 'mirrorQuad', 'eraseTile', 'copyRegion', 'joinObjects'] as const;
type ConditionTypeName = (typeof CONDITION_TYPES)[number];

/** Map a raw JSON key to its base condition type, supporting suffixed keys like "moveFigure_flower1". */
function extractBaseType(key: string): ConditionTypeName | null {
  for (const t of CONDITION_TYPES) {
    if (key === t) return t;
    if (key.startsWith(t + '_') && key.length > t.length + 1) return t;
  }
  return null;
}

/** Extract optional instruction from an object value. */
function getInstruction(value: unknown): string | undefined {
  if (value && typeof value === 'object' && 'instruction' in value && typeof (value as any).instruction === 'string') {
    return (value as any).instruction;
  }
  return undefined;
}

function parseOne(key: string, value: unknown): CompleteCondition | null {
  const baseType = extractBaseType(key);
  if (!baseType) return null;
  const isObj = value !== null && typeof value === 'object';
  const instruction = getInstruction(value);

  if (!isObj) return null;

  switch (baseType) {
    case 'editFigure':
      if ('figureName' in (value as any)) return { type: 'editFigure', figureName: (value as any).figureName, instruction };
      return null;
    case 'createFigure':
      return { type: 'createFigure', instruction };
    case 'moveFigure':
      if (
        'figureName' in (value as any) && typeof (value as any).figureName === 'string' &&
        'figurePosition' in (value as any) && Array.isArray((value as any).figurePosition) &&
        (value as any).figurePosition.length === 4
      ) {
        return {
          type: 'moveFigure',
          figureName: (value as any).figureName,
          figurePosition: (value as any).figurePosition as [number, number, number, number],
          instruction,
        };
      }
      return null;
    case 'floodRandom':
      return { type: 'floodRandom', instruction };
    case 'openHierarchy':
      return { type: 'openHierarchy', instruction };
    case 'openFiguresTab':
      return { type: 'openFiguresTab', instruction };
    case 'editExistingFigure':
      return { type: 'editExistingFigure', instruction };
    case 'createPattern':
      return { type: 'createPattern', instruction };
    case 'duplicateFigure':
      return { type: 'duplicateFigure', instruction };
    case 'createGroup':
      return { type: 'createGroup', instruction };
    case 'pickColor':
      return { type: 'pickColor', instruction };
    case 'reconcileTool':
      return { type: 'reconcileTool', instruction };
    case 'cutoutTool':
      return { type: 'cutoutTool', instruction };
    case 'mirrorH':
      return { type: 'mirrorH', instruction };
    case 'mirrorStar':
      return { type: 'mirrorStar', instruction };
    case 'mirrorAny':
      return { type: 'mirrorAny', instruction };
    case 'occupyLayers':
      if (isObj && 'requireLayers' in (value as any) && Array.isArray((value as any).requireLayers)) {
        return { type: 'occupyLayers', requireLayers: (value as any).requireLayers, instruction };
      }
      return null;
    case 'randomBrush':
      return { type: 'randomBrush', instruction };
    case 'importLibrary':
      return { type: 'importLibrary', instruction };
    case 'placeFigure':
      return { type: 'placeFigure', instruction };
    case 'placeTile':
      return { type: 'placeTile', instruction };
    case 'shiftLayer':
      return { type: 'shiftLayer', instruction };
    case 'addLayer':
      return { type: 'addLayer', instruction };
    case 'tileProperties':
      return { type: 'tileProperties', instruction };
    case 'changeLayer':
      return { type: 'changeLayer', instruction };
    case 'applyColor':
      return { type: 'applyColor', instruction };
    case 'togglePatternMode':
      return { type: 'togglePatternMode', instruction };
    case 'createPatternRepetition':
      return { type: 'createPatternRepetition', instruction };
    case 'createLine':
      return { type: 'createLine', instruction };
    case 'createArc':
      return { type: 'createArc', instruction };
    case 'createSVGObject':
      return { type: 'createSVGObject', instruction };
    case 'recolorSVG':
      return { type: 'recolorSVG', instruction };
    case 'rotateObject':
      return { type: 'rotateObject', instruction };
    case 'mirrorObject':
      return { type: 'mirrorObject', instruction };
    case 'duplicateObject':
      return { type: 'duplicateObject', instruction };
    case 'mirrorQuad':
      return { type: 'mirrorQuad', instruction };
    case 'eraseTile':
      return { type: 'eraseTile', instruction };
    case 'copyRegion':
      return { type: 'copyRegion', instruction };
    case 'joinObjects':
      return { type: 'joinObjects', instruction };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton state
// ---------------------------------------------------------------------------

let _activeCompId: string | null = null;
let _conditions: Map<string, CompleteCondition> = new Map();

/** True when the user opened an existing figure for editing (not a new creation). */
let _editingExistingFigure = false;
export function setEditingExistingFigure(v: boolean): void { _editingExistingFigure = v; }
export function isEditingExistingFigure(): boolean { return _editingExistingFigure; }
let _progress: Map<string, boolean> = new Map();

/** Callback fired when all moveFigure conditions become satisfied. */
let _onAllMovesComplete: (() => void) | null = null;
export function setOnAllMovesComplete(cb: (() => void) | null): void { _onAllMovesComplete = cb; }

/** Callback fired when N figures overlap a target region. */
let _occupyRegionTarget: { position: [number, number, number, number]; count: number } | null = null;
let _onOccupyRegion: (() => void) | null = null;
export function setOnOccupyRegion(
  target: { position: [number, number, number, number]; count: number } | null,
  cb: (() => void) | null,
): void {
  _occupyRegionTarget = target;
  _onOccupyRegion = cb;
}

/** Set of figure IDs present in the composition when the tutorial started.
 *  Figures with IDs not in this set are counted as user-created.
 *  Captured eagerly the moment both _activeCompId and _compStateAccessor
 *  are first available, then persisted so it survives across sessions. */
let _baselineIds: Set<string> | null = null;

/** Same idea as _baselineIds but for svgObjects (lines/arcs).
 *  Powers count-based createSVGObject conditions. */
let _svgBaselineIds: Set<string> | null = null;

/** Cached gallery-level data: compId -> { progress, total } */
const _allProgress = new Map<string, { conditions: Record<string, boolean>; total: number }>();

/** State accessor registered by CompositionEditor for moveFigure lookups */
let _compStateAccessor: (() => {
  figures: Array<{ id: string; name?: string; groupId?: string; cellX: number; cellY: number; cellWidth: number; cellHeight: number }>;
  groups: Array<{ id: string; name: string }>;
  svgObjects: Array<{ id: string }>;
}) | null = null;

// Listeners for useSyncExternalStore
let _version = 0;
const _listeners = new Set<() => void>();

function notify(): void {
  _version++;
  for (const cb of _listeners) cb();
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function storageKey(compId: string): string {
  return `tutorial_progress_${compId}`;
}

function openedKey(compId: string): string {
  return `tutorial_opened_${compId}`;
}

/** Legacy storage key (commit e5ea82c, count-baseline). Kept only for
 *  cleanup in resetAllTutorialProgress so existing user storage doesn't leak. */
function baselineKey(compId: string): string {
  return `tutorial_baseline_${compId}`;
}

function baselineIdsKey(compId: string): string {
  return `tutorial_baseline_ids_${compId}`;
}

function svgBaselineIdsKey(compId: string): string {
  return `tutorial_svg_baseline_ids_${compId}`;
}

/** Mark a tutorial as having been opened at least once. */
export async function markTutorialOpened(compId: string): Promise<void> {
  try {
    await storage.setItem(openedKey(compId), '1');
  } catch {
    // swallow
  }
}

async function persistProgress(compId: string, progress: Map<string, boolean>): Promise<void> {
  const obj: Record<string, boolean> = {};
  for (const [k, v] of progress) obj[k] = v;
  try {
    await storage.setItem(storageKey(compId), JSON.stringify(obj));
  } catch {
    // swallow — storage write failure is non-critical
  }
}

export async function hasPersistedProgress(compId: string): Promise<boolean> {
  const progress = await loadPersistedProgress(compId);
  return Object.values(progress).some(Boolean);
}

async function loadPersistedProgress(compId: string): Promise<Record<string, boolean>> {
  try {
    const raw = await storage.getItem(storageKey(compId));
    if (raw) return JSON.parse(raw);
  } catch {
    // swallow
  }
  return {};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function initCompletion(
  compId: string,
  conditions: Map<string, CompleteCondition>,
): Promise<void> {
  _activeCompId = compId;
  _conditions = conditions;
  _progress = new Map();
  _baselineIds = null;
  _svgBaselineIds = null;

  // Load any persisted progress
  const persisted = await loadPersistedProgress(compId);
  for (const key of conditions.keys()) {
    _progress.set(key, persisted[key] === true);
  }

  // Load the persisted baseline ID set, if any. Defensive parse — anything
  // unexpected falls back to "no baseline yet" so we'll capture fresh.
  try {
    const raw = await storage.getItem(baselineIdsKey(compId));
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        _baselineIds = new Set<string>(arr.filter((x): x is string => typeof x === 'string'));
      }
    }
  } catch {
    _baselineIds = null;
  }

  try {
    const raw = await storage.getItem(svgBaselineIdsKey(compId));
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        _svgBaselineIds = new Set<string>(arr.filter((x): x is string => typeof x === 'string'));
      }
    }
  } catch {
    _svgBaselineIds = null;
  }

  // If the state accessor was registered before init finished, capture the
  // baseline now from the live state. (The mirror case — accessor registered
  // after init — is handled by registerCompStateAccessor.)
  if ((_baselineIds === null || _svgBaselineIds === null) && _compStateAccessor) {
    captureBaselineFromAccessor();
  }

  // Persist immediately so the storage entry exists even if no conditions
  // complete — this marks the tutorial as "has been opened".
  persistProgress(compId, _progress);

  // Update gallery cache
  updateAllProgressCache(compId);
  notify();
}

export function stopCompletion(): void {
  _activeCompId = null;
  _conditions = new Map();
  _progress = new Map();
  _baselineIds = null;
  _svgBaselineIds = null;
  notify();
}

/** Snapshot the current figure + svgObject IDs as the baseline and persist them.
 *  Each baseline is captured independently and idempotently: no-op for whichever
 *  side is already captured. Requires an active comp ID and a state accessor. */
function captureBaselineFromAccessor(): void {
  if (!_compStateAccessor || !_activeCompId) return;
  if (_baselineIds === null) {
    const ids = _compStateAccessor().figures.map(f => f.id);
    _baselineIds = new Set<string>(ids);
    storage.setItem(baselineIdsKey(_activeCompId), JSON.stringify(ids)).catch(() => {});
  }
  if (_svgBaselineIds === null) {
    const ids = _compStateAccessor().svgObjects.map(o => o.id);
    _svgBaselineIds = new Set<string>(ids);
    storage.setItem(svgBaselineIdsKey(_activeCompId), JSON.stringify(ids)).catch(() => {});
  }
}

export function isCompletionActive(): boolean {
  return _activeCompId !== null && _conditions.size > 0;
}

export function registerCompStateAccessor(
  fn: () => {
    figures: Array<{ id: string; name?: string; groupId?: string; cellX: number; cellY: number; cellWidth: number; cellHeight: number }>;
    groups: Array<{ id: string; name: string }>;
    svgObjects: Array<{ id: string }>;
  },
): () => void {
  _compStateAccessor = fn;
  // Mirror of the init path: if completion was already initialized but a
  // baseline hasn't been captured yet (init finished before mount), capture
  // now from the live state so the very first reevaluate is correct.
  if (_activeCompId && (_baselineIds === null || _svgBaselineIds === null)) {
    captureBaselineFromAccessor();
  }
  return () => {
    if (_compStateAccessor === fn) _compStateAccessor = null;
  };
}

// ---------------------------------------------------------------------------
// Action notification
// ---------------------------------------------------------------------------

export function notifyCompletionAction(action: CompletionAction): void {
  if (!_activeCompId || _conditions.size === 0) return;

  let changed = false;
  for (const [key, condition] of _conditions) {
    if (_progress.get(key)) continue; // already completed

    // createFigure conditions are state-managed by reevaluateCreateFigure().
    if (condition.type === 'createFigure') continue;
    // createSVGObject conditions are state-managed by reevaluateCreateSVGObject().
    if (condition.type === 'createSVGObject') continue;

    if (evaluateCondition(condition, action)) {
      _progress.set(key, true);
      changed = true;
    }
  }

  if (changed) {
    updateAllProgressCache(_activeCompId);
    notify();
    persistProgress(_activeCompId, _progress);
  }
}

export function notifyCompletionMove(
  figureId: string,
  positionOverride?: { cellX: number; cellY: number } | { dx: number; dy: number },
): void {
  if (!_activeCompId || _conditions.size === 0 || !_compStateAccessor) return;

  const state = _compStateAccessor();
  const figure = state.figures.find(f => f.id === figureId);
  if (!figure || !figure.name) return;

  // The state accessor may return pre-dispatch positions when called from
  // a dispatch wrapper. Use positionOverride to supply the post-move position.
  let cellX = figure.cellX;
  let cellY = figure.cellY;
  if (positionOverride) {
    if ('cellX' in positionOverride) {
      cellX = positionOverride.cellX;
      cellY = positionOverride.cellY;
    } else {
      cellX += positionOverride.dx;
      cellY += positionOverride.dy;
    }
  }

  // Evaluate moveFigure conditions for this figure in both directions:
  // check in when moved into the region, uncheck when moved out.
  let changed = false;
  for (const [key, condition] of _conditions) {
    if (condition.type !== 'moveFigure') continue;
    if (condition.figureName !== figure.name) continue;

    const [ulX, ulY, lrX, lrY] = condition.figurePosition;
    const inRegion =
      cellX >= ulX &&
      cellY >= ulY &&
      cellX + figure.cellWidth <= lrX &&
      cellY + figure.cellHeight <= lrY;

    if (inRegion !== (_progress.get(key) ?? false)) {
      _progress.set(key, inRegion);
      changed = true;
    }
  }

  if (changed) {
    updateAllProgressCache(_activeCompId);
    notify();
    persistProgress(_activeCompId, _progress);

    // Check if all moveFigure conditions are now satisfied
    if (_onAllMovesComplete) {
      let allMovesDone = true;
      for (const [key, condition] of _conditions) {
        if (condition.type === 'moveFigure' && !_progress.get(key)) {
          allMovesDone = false;
          break;
        }
      }
      if (allMovesDone) _onAllMovesComplete();
    }
  }
}

/**
 * Re-evaluate all occupy conditions against current figure positions.
 * Called after figures are placed, moved, removed, or scaled.
 */
export function reevaluateOccupy(): void {
  if (!_activeCompId || _conditions.size === 0 || !_compStateAccessor) return;

  const state = _compStateAccessor();
  let changed = false;

  for (const [key, condition] of _conditions) {
    if (condition.type !== 'occupy') continue;
    const [ulX, ulY, lrX, lrY] = condition.position;

    // Filter out excluded figures/groups
    let figures = state.figures;
    if (condition.exclude && condition.exclude.length > 0) {
      const excludeSet = new Set(condition.exclude);
      const excludedGroupIds = new Set(
        state.groups.filter(g => excludeSet.has(g.name)).map(g => g.id),
      );
      figures = figures.filter(f =>
        !(f.name && excludeSet.has(f.name)) &&
        !(f.groupId && excludedGroupIds.has(f.groupId)),
      );
    }

    const occupied = condition.strict
      ? figures.some(f =>
          f.cellX === ulX &&
          f.cellY === ulY &&
          f.cellX + f.cellWidth === lrX &&
          f.cellY + f.cellHeight === lrY,
        )
      : figures.some(f =>
          f.cellX < lrX &&
          f.cellX + f.cellWidth > ulX &&
          f.cellY < lrY &&
          f.cellY + f.cellHeight > ulY,
        );

    if (occupied !== (_progress.get(key) ?? false)) {
      _progress.set(key, occupied);
      changed = true;
    }
  }

  if (changed) {
    updateAllProgressCache(_activeCompId);
    notify();
    persistProgress(_activeCompId, _progress);
  }

  // Check step-level occupyRegion target
  if (_onOccupyRegion && _occupyRegionTarget && _compStateAccessor) {
    const [ulX, ulY, lrX, lrY] = _occupyRegionTarget.position;
    const figs = _compStateAccessor().figures;
    let count = 0;
    for (const f of figs) {
      if (f.cellX < lrX && f.cellX + f.cellWidth > ulX &&
          f.cellY < lrY && f.cellY + f.cellHeight > ulY) {
        count++;
      }
    }
    if (count >= _occupyRegionTarget.count) _onOccupyRegion();
  }
}

/**
 * Re-evaluate all createFigure conditions against the current figures.
 * A figure counts as user-created when its ID isn't in the baseline set
 * captured at tutorial start. Bails out (without writing) until the
 * baseline is captured, so an early call can never wipe loaded progress.
 */
export function reevaluateCreateFigure(): void {
  if (!_activeCompId || _conditions.size === 0 || !_compStateAccessor) return;
  if (_baselineIds === null) return;

  const cfKeys: string[] = [];
  for (const [key, condition] of _conditions) {
    if (condition.type === 'createFigure') cfKeys.push(key);
  }
  if (cfKeys.length === 0) return;
  cfKeys.sort();

  const figures = _compStateAccessor().figures;
  let userCreated = 0;
  for (const f of figures) {
    if (!_baselineIds.has(f.id)) userCreated++;
  }

  let changed = false;
  for (let i = 0; i < cfKeys.length; i++) {
    const shouldBeComplete = i < userCreated;
    if (shouldBeComplete !== (_progress.get(cfKeys[i]) ?? false)) {
      _progress.set(cfKeys[i], shouldBeComplete);
      changed = true;
    }
  }

  if (changed) {
    updateAllProgressCache(_activeCompId);
    notify();
    persistProgress(_activeCompId, _progress);
  }
}

/**
 * Re-evaluate all createSVGObject conditions against the current svgObjects.
 * Mirrors reevaluateCreateFigure: bails until the SVG baseline is captured,
 * then marks createSVGObject_i complete for i < (count of svgObjects whose
 * IDs are not in the baseline set).
 */
export function reevaluateCreateSVGObject(): void {
  if (!_activeCompId || _conditions.size === 0 || !_compStateAccessor) return;
  if (_svgBaselineIds === null) return;

  const keys: string[] = [];
  for (const [key, condition] of _conditions) {
    if (condition.type === 'createSVGObject') keys.push(key);
  }
  if (keys.length === 0) return;
  keys.sort();

  const svgObjects = _compStateAccessor().svgObjects;
  let userCreated = 0;
  for (const o of svgObjects) {
    if (!_svgBaselineIds.has(o.id)) userCreated++;
  }

  let changed = false;
  for (let i = 0; i < keys.length; i++) {
    const shouldBeComplete = i < userCreated;
    if (shouldBeComplete !== (_progress.get(keys[i]) ?? false)) {
      _progress.set(keys[i], shouldBeComplete);
      changed = true;
    }
  }

  if (changed) {
    updateAllProgressCache(_activeCompId);
    notify();
    persistProgress(_activeCompId, _progress);
  }
}

/**
 * Check occupyLayers conditions against the provided layer data.
 * Called from the figure editor after strokes or flood fills.
 */
export function checkOccupyLayers(layers: Array<{ level: number; cells: (unknown | null)[][] }>): void {
  if (!_activeCompId || _conditions.size === 0) return;

  let changed = false;
  for (const [key, condition] of _conditions) {
    if (condition.type !== 'occupyLayers') continue;
    const allSatisfied = condition.requireLayers.every(reqLevel => {
      const layer = layers.find(l => l.level === reqLevel);
      if (!layer) return false;
      return layer.cells.some(row => row.some(cell => cell !== null));
    });
    if (allSatisfied !== (_progress.get(key) ?? false)) {
      _progress.set(key, allSatisfied);
      changed = true;
    }
  }

  if (changed) {
    updateAllProgressCache(_activeCompId);
    notify();
    persistProgress(_activeCompId, _progress);
  }
}

// ---------------------------------------------------------------------------
// Condition evaluation (pure)
// ---------------------------------------------------------------------------

function evaluateCondition(condition: CompleteCondition, action: CompletionAction): boolean {
  switch (condition.type) {
    case 'editFigure':
      return action.kind === 'editFigure' && action.figureName === condition.figureName;

    case 'createFigure':
      return action.kind === 'createFigure' || action.kind === 'duplicateFigure';

    case 'moveFigure': {
      if (action.kind !== 'moveFigure') return false;
      if (action.figureName !== condition.figureName) return false;
      const [ulX, ulY, lrX, lrY] = condition.figurePosition;
      return (
        action.cellX >= ulX &&
        action.cellY >= ulY &&
        action.cellX + action.cellWidth <= lrX &&
        action.cellY + action.cellHeight <= lrY
      );
    }

    case 'floodRandom':
      return action.kind === 'floodRandom';

    case 'openHierarchy':
      return action.kind === 'openHierarchy';

    case 'openFiguresTab':
      return action.kind === 'openFiguresTab';

    case 'editExistingFigure':
      return action.kind === 'editExistingFigure';

    case 'createPattern':
      return action.kind === 'createPattern';

    case 'duplicateFigure':
      return action.kind === 'duplicateFigure';

    case 'createGroup':
      return action.kind === 'createGroup';

    case 'pickColor':
      return action.kind === 'pickColor';

    case 'reconcileTool':
      return action.kind === 'reconcileTool';

    case 'cutoutTool':
      return action.kind === 'cutoutTool';

    case 'mirrorH':
      return action.kind === 'mirrorH';

    case 'mirrorStar':
      return action.kind === 'mirrorStar';

    case 'mirrorAny':
      return action.kind === 'mirrorAny';

    case 'occupyLayers':
      return action.kind === 'occupyLayers';

    case 'randomBrush':
      return action.kind === 'randomBrush';

    case 'importLibrary':
      return action.kind === 'importLibrary';

    case 'placeFigure':
      return action.kind === 'placeFigure';

    case 'placeTile':
      return action.kind === 'placeTile';

    case 'shiftLayer':
      return action.kind === 'shiftLayer';

    case 'addLayer':
      return action.kind === 'addLayer';

    case 'tileProperties':
      return action.kind === 'tileProperties';

    case 'changeLayer':
      return action.kind === 'changeLayer';

    case 'applyColor':
      return action.kind === 'applyColor';

    case 'togglePatternMode':
      return action.kind === 'togglePatternMode';

    case 'createPatternRepetition':
      return action.kind === 'createPatternRepetition';

    case 'createLine':
      return action.kind === 'createLine';

    case 'createArc':
      return action.kind === 'createArc';

    case 'recolorSVG':
      return action.kind === 'recolorSVG';

    // createSVGObject is state-managed by reevaluateCreateSVGObject(); skip here.
    case 'createSVGObject':
      return false;

    case 'rotateObject':
      return action.kind === 'rotateObject';

    case 'mirrorObject':
      return action.kind === 'mirrorObject';

    case 'duplicateObject':
      return action.kind === 'duplicateObject';

    case 'mirrorQuad':
      return action.kind === 'mirrorQuad';

    case 'eraseTile':
      return action.kind === 'eraseTile';

    case 'copyRegion':
      return action.kind === 'copyRegion';

    case 'joinObjects':
      return action.kind === 'joinObjects';

    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Progress accessors
// ---------------------------------------------------------------------------

export interface ActiveProgress {
  conditions: Map<string, boolean>;
  total: number;
  completed: number;
  allComplete: boolean;
}

export function getActiveProgress(): ActiveProgress | null {
  if (!_activeCompId || _conditions.size === 0) return null;
  const total = _conditions.size;
  let completed = 0;
  for (const v of _progress.values()) {
    if (v) completed++;
  }
  return { conditions: _progress, total, completed, allComplete: completed >= total };
}

export function getActiveConditions(): Map<string, CompleteCondition> {
  return _conditions;
}

export interface TargetRegion {
  bounds: [number, number, number, number];
  /** True only when every condition that targets this rectangle is satisfied. */
  complete: boolean;
}

/** Return target regions from occupy/moveFigure conditions, grouped by rectangle.
 *  When multiple conditions share the same rectangle (e.g. Garden's 6 flowers),
 *  they collapse to one region whose `complete` flag flips true only after all
 *  of them are satisfied. */
export function getTargetRegions(): TargetRegion[] {
  // Hide all target-region overlays once the entire tutorial is complete.
  if (_progress.size > 0) {
    let allComplete = true;
    for (const v of _progress.values()) {
      if (!v) { allComplete = false; break; }
    }
    if (allComplete) return [];
  }

  const groups = new Map<string, { bounds: [number, number, number, number]; keys: string[] }>();
  for (const [key, condition] of _conditions) {
    const pos =
      condition.type === 'occupy' ? condition.position :
      condition.type === 'moveFigure' ? condition.figurePosition :
      null;
    if (!pos) continue;
    const k = pos.join(',');
    let entry = groups.get(k);
    if (!entry) {
      entry = { bounds: pos, keys: [] };
      groups.set(k, entry);
    }
    entry.keys.push(key);
  }
  return Array.from(groups.values()).map(e => ({
    bounds: e.bounds,
    complete: e.keys.every(k => _progress.get(k) === true),
  }));
}

export function getConditionDescription(key: string, condition: CompleteCondition): string {
  if (condition.instruction) return condition.instruction;

  switch (condition.type) {
    case 'editFigure':
      return `Edit figure "${condition.figureName}"`;
    case 'createFigure':
      return 'Create a new figure';
    case 'moveFigure':
      return `Move "${condition.figureName}" to target area`;
    case 'floodRandom':
      return 'Use random flood fill';
    case 'openHierarchy':
      return 'Open the scene outline';
    case 'openFiguresTab':
      return 'Open the figures tab';
    case 'editExistingFigure':
      return 'Edit an existing figure';
    case 'createPattern':
      return 'Create a pattern';
    case 'duplicateFigure':
      return 'Duplicate a figure';
    case 'createGroup':
      return 'Group figures together';
    case 'occupy':
      return 'Place a figure in a frame';
    case 'pickColor':
      return 'Pick a color';
    case 'reconcileTool':
      return 'Use the reconcile tool';
    case 'cutoutTool':
      return 'Use the cutout tool';
    case 'mirrorH':
      return 'Turn on mirroring';
    case 'mirrorStar':
      return 'Turn on star mirroring';
    case 'mirrorAny':
      return 'Try a symmetry';
    case 'occupyLayers':
      return 'Use multiple layers';
    case 'randomBrush':
      return 'Paint with the random brush';
    case 'importLibrary':
      return 'Import a figure library';
    case 'placeFigure':
      return 'Place a figure from the library';
    case 'placeTile':
      return 'Place a tile from the palette';
    case 'shiftLayer':
      return 'Shift a layer';
    case 'addLayer':
      return 'Create a new layer';
    case 'tileProperties':
      return 'Open tile properties';
    case 'changeLayer':
      return 'Switch to a different layer';
    case 'applyColor':
      return 'Apply a color';
    case 'togglePatternMode':
      return 'Turn on the Pattern tool';
    case 'createPatternRepetition':
      return 'Repeat a pattern across a region';
    case 'createLine':
      return 'Draw a line';
    case 'createArc':
      return 'Draw an arc';
    case 'createSVGObject':
      return 'Draw an SVG object';
    case 'recolorSVG':
      return "Change an SVG object's color";
    case 'rotateObject':
      return 'Rotate an object';
    case 'mirrorObject':
      return 'Mirror an object';
    case 'duplicateObject':
      return 'Duplicate an object';
    case 'mirrorQuad':
      return 'Use quad symmetry';
    case 'eraseTile':
      return 'Erase a tile';
    case 'copyRegion':
      return 'Copy a region';
    case 'joinObjects':
      return 'Join objects';
    default:
      return key;
  }
}

// ---------------------------------------------------------------------------
// Gallery-level progress (for thumbnail badges)
// ---------------------------------------------------------------------------

function updateAllProgressCache(compId: string): void {
  const total = _conditions.size;
  const obj: Record<string, boolean> = {};
  for (const [k, v] of _progress) obj[k] = v;
  _allProgress.set(compId, { conditions: obj, total });
}

export interface CompProgress {
  completedCount: number;
  totalCount: number;
  allComplete: boolean;
  hasBeenOpened: boolean;
}

export async function loadAllProgress(compIds: string[]): Promise<Map<string, CompProgress>> {
  const result = new Map<string, CompProgress>();
  const progressKeys = compIds.map(id => storageKey(id));
  const openedKeys = compIds.map(id => openedKey(id));
  try {
    const [progressPairs, openedPairs] = await Promise.all([
      storage.multiGet(progressKeys),
      storage.multiGet(openedKeys),
    ]);
    const openedSet = new Set<string>();
    for (const [key, value] of openedPairs) {
      if (value) openedSet.add(key.replace('tutorial_opened_', ''));
    }
    for (const [key, value] of progressPairs) {
      const compId = key.replace('tutorial_progress_', '');
      if (!value) {
        // No progress entry — only add if opened flag exists
        if (openedSet.has(compId)) {
          result.set(compId, { completedCount: 0, totalCount: 0, allComplete: false, hasBeenOpened: true });
        }
        continue;
      }
      const parsed: Record<string, boolean> = JSON.parse(value);
      const total = Object.keys(parsed).length;
      const completed = Object.values(parsed).filter(Boolean).length;
      result.set(compId, { completedCount: completed, totalCount: total, allComplete: total > 0 && completed >= total, hasBeenOpened: true });
    }
  } catch {
    // swallow
  }
  return result;
}

// ---------------------------------------------------------------------------
// Reset all tutorial progress
// ---------------------------------------------------------------------------

export async function resetAllTutorialProgress(compIds: string[]): Promise<void> {
  const keys = [
    ...compIds.map(id => storageKey(id)),
    ...compIds.map(id => openedKey(id)),
    ...compIds.map(id => baselineKey(id)),
    ...compIds.map(id => baselineIdsKey(id)),
    ...compIds.map(id => svgBaselineIdsKey(id)),
  ];
  try {
    await storage.multiRemove(keys);
  } catch {
    // swallow
  }
  _allProgress.clear();
  // If we're currently tracking a comp that was reset, clear its in-memory progress
  if (_activeCompId && compIds.includes(_activeCompId)) {
    for (const key of _progress.keys()) {
      _progress.set(key, false);
    }
    _baselineIds = null;
    _svgBaselineIds = null;
  }
  notify();
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
