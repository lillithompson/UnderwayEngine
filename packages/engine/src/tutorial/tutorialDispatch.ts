import { notifyAction, isScriptActive } from './tutorialEngine';
import { isCompletionActive, notifyCompletionAction, notifyCompletionMove } from './tutorialCompletion';
import type { EditorAction } from '../state';

/**
 * Wrap a figure-editor dispatch so relevant actions are forwarded to the
 * tutorial engine.  When no script is active the overhead is a single
 * boolean check per dispatch.
 */
export function wrapEditorDispatch(
  dispatch: React.Dispatch<EditorAction>,
): React.Dispatch<EditorAction> {
  return (action: EditorAction) => {
    dispatch(action);

    if (isScriptActive()) {
      switch (action.type) {
        case 'SET_TOOL':
          notifyAction({ kind: 'toolSelect', tool: action.tool.type });
          break;
        case 'CYCLE_MIRROR':
          notifyAction({ kind: 'mirrorSelect' });
          break;
        case 'SET_MIRROR':
          notifyAction({ kind: 'mirrorSelect' });
          if ((action as any).mirrorStar) notifyAction({ kind: 'mirrorStar' });
          break;
        case 'STROKE_END':
          notifyAction({ kind: 'strokeEnd' });
          break;
        case 'FLOOD_FILL':
        case 'SIMPLE_FILL':
        case 'FLOOD_FILL_DONE':
        case 'SIMPLE_FILL_DONE':
          notifyAction({ kind: 'floodFill' });
          break;
        case 'SET_SELECTION':
          if (action.selection) {
            notifyAction({ kind: 'selectionComplete' });
          }
          break;
        case 'TOGGLE_LAYER_SHIFT':
          notifyAction({ kind: 'shiftLayer' });
          break;
        case 'SET_ACTIVE_LAYER':
          notifyAction({ kind: 'changeLayer' });
          break;
      }
    }

    if (isCompletionActive()) {
      switch (action.type) {
        case 'CYCLE_MIRROR':
          notifyCompletionAction({ kind: 'mirrorH' });
          notifyCompletionAction({ kind: 'mirrorAny' });
          break;
        case 'SET_MIRROR': {
          const a = action as any;
          if (a.mirrorH) notifyCompletionAction({ kind: 'mirrorH' });
          if (a.mirrorStar) notifyCompletionAction({ kind: 'mirrorStar' });
          if (a.mirrorQuad) notifyCompletionAction({ kind: 'mirrorQuad' });
          if (a.mirrorH || a.mirrorV || a.mirrorRotate || a.mirrorQuad || a.mirrorRow || a.mirrorCol || a.mirrorDiag1 || a.mirrorDiag2 || a.mirrorDiagBoth || a.mirrorStar) {
            notifyCompletionAction({ kind: 'mirrorAny' });
          }
          break;
        }
        case 'SET_ACTIVE_LAYER':
          notifyCompletionAction({ kind: 'changeLayer' });
          break;
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Composition dispatch wrapper
// ---------------------------------------------------------------------------

/**
 * The composition reducer action type is file-local in CompositionEditor.tsx,
 * so we accept `any` for the action and check `.type` at runtime.  This keeps
 * CompositionEditor's CompAction type private.
 */
export function wrapCompDispatch<A extends { type: string }>(
  dispatch: React.Dispatch<A>,
): React.Dispatch<A> {
  return (action: A) => {
    dispatch(action);
    if (isScriptActive()) {
      switch (action.type) {
        case 'SET_COMP_TOOL':
          notifyAction({ kind: 'compToolSelect', tool: (action as any).tool });
          break;
        case 'PLACE_LINE':
        case 'PLACE_ARC':
          notifyAction({ kind: 'placeSVG' });
          break;
        case 'SET_SELECTION': {
          const ids = (action as any).figureIds;
          if (Array.isArray(ids) && ids.length >= 2) {
            notifyAction({ kind: 'multiSelect', count: ids.length });
          }
          break;
        }
        case 'TOGGLE_FIGURE_REPEAT':
          notifyAction({ kind: 'toggleRepeat' });
          break;
        case 'SCALE_FIGURE':
          notifyAction({ kind: 'figureScale' });
          break;
      }
    }

    // Completion tracking — runs independently of the step-by-step tutorial.
    // Position overrides are needed because stateRef hasn't updated yet
    // at this point in the dispatch wrapper.
    if (isCompletionActive()) {
      switch (action.type) {
        case 'MOVE_FIGURE': {
          const a = action as any;
          notifyCompletionMove(a.figureId, { cellX: a.cellX, cellY: a.cellY });
          break;
        }
        case 'MOVE_FIGURES_DELTA': {
          const a = action as any;
          for (const fid of a.figureIds) notifyCompletionMove(fid, { dx: a.dx, dy: a.dy });
          break;
        }
        case 'PLACE_LINE':
          notifyCompletionAction({ kind: 'createLine' });
          break;
        case 'PLACE_ARC':
          notifyCompletionAction({ kind: 'createArc' });
          break;
        case 'RECOLOR_LINE':
        case 'RECOLOR_ARC':
          notifyCompletionAction({ kind: 'recolorSVG' });
          break;
      }
    }
  };
}
