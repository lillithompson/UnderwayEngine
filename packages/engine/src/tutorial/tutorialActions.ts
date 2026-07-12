import type { TutorialAction, WaitCondition } from './tutorialTypes';

/**
 * Mutable counter state kept by the engine and passed in so the matcher
 * can handle cumulative conditions like "floodFill 3 times".
 */
export interface ActionCounters {
  floodFillCount: number;
  placeSVGCount: number;
}

/**
 * Returns true when `action` satisfies `condition`, given the current counters.
 * The caller is responsible for incrementing counters *before* calling this
 * (e.g. bump floodFillCount, then check).
 */
export function doesActionSatisfy(
  condition: WaitCondition,
  action: TutorialAction,
  counters: ActionCounters,
): boolean {
  switch (condition.kind) {
    case 'tap':
      return action.kind === 'tap';

    case 'toolSelect':
      return action.kind === 'toolSelect' && action.tool === condition.tool;

    case 'compToolSelect':
      return action.kind === 'compToolSelect' && action.tool === condition.tool;

    case 'canvasDrag':
      return action.kind === 'canvasDrag';

    case 'createDrag':
      return action.kind === 'createDrag';

    case 'floodFill': {
      if (action.kind !== 'floodFill') return false;
      const needed = condition.count ?? 1;
      return counters.floodFillCount >= needed;
    }

    case 'mirrorSelect':
      return action.kind === 'mirrorSelect';

    case 'navigate':
      return action.kind === 'navigate' && action.to === condition.to;

    case 'buttonPress':
      return action.kind === 'buttonPress' && action.buttonId === condition.buttonId;

    case 'strokeEnd':
      return action.kind === 'strokeEnd';

    case 'selectionComplete':
      return action.kind === 'selectionComplete';

    case 'cutout':
      return action.kind === 'cutout';

    case 'toggleRepeat':
      return action.kind === 'toggleRepeat';

    case 'figureScale':
      return action.kind === 'figureScale';

    case 'group':
      return action.kind === 'group';

    case 'reconcile':
      return action.kind === 'reconcile';

    case 'shiftLayer':
      return action.kind === 'shiftLayer';

    case 'changeLayer':
      return action.kind === 'changeLayer';

    case 'openLayers':
      return action.kind === 'openLayers';

    case 'openSymmetryModal':
      return action.kind === 'openSymmetryModal';

    case 'mirrorStar':
      return action.kind === 'mirrorStar';

    case 'openColors':
      return action.kind === 'openColors';

    case 'colorToolPress':
      return action.kind === 'colorToolPress';

    case 'colorChosen':
      return action.kind === 'colorChosen';

    case 'allMovesComplete':
      return action.kind === 'allMovesComplete';

    case 'propsRotate':
      return action.kind === 'propsRotate';

    case 'propsMirror':
      return action.kind === 'propsMirror';

    case 'propsDuplicate':
      return action.kind === 'propsDuplicate';

    case 'occupyRegion':
      return action.kind === 'occupyRegion';

    case 'openTileFamily':
      return action.kind === 'openTileFamily';

    case 'tileRotate':
      return action.kind === 'tileRotate';

    case 'addLayer':
      return action.kind === 'addLayer';

    case 'multiSelect': {
      if (action.kind !== 'multiSelect') return false;
      const needed = condition.count ?? 2;
      return action.count >= needed;
    }

    case 'join':
      return action.kind === 'join';

    case 'openSceneOutline':
      return action.kind === 'openSceneOutline';

    case 'toggleLock':
      return action.kind === 'toggleLock';

    case 'toggleHidden':
      return action.kind === 'toggleHidden';

    case 'reorderObjects':
      return action.kind === 'reorderObjects';

    case 'importFigureset': {
      if (action.kind !== 'importFigureset') return false;
      return condition.name === undefined || condition.name === action.name;
    }

    case 'placeSVG': {
      if (action.kind !== 'placeSVG') return false;
      const needed = condition.count ?? 1;
      return counters.placeSVGCount >= needed;
    }

    case 'delay':
      // Delay conditions are resolved by a timer in the engine, not by actions
      return false;

    case 'any':
      return condition.conditions.some(c => doesActionSatisfy(c, action, counters));

    default:
      return false;
  }
}
