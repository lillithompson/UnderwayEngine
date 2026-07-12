import type { CompToolType, ToolType } from '../types';

// ---------------------------------------------------------------------------
// Script file format
// ---------------------------------------------------------------------------

export interface TutorialBeacon {
  target: HighlightTarget;
  dismissOn: TutorialAction['kind'];
  view?: 'composition' | 'figure';
  /** Optional index of a beacon that must be dismissed before this one
   *  becomes visible. Lets tutorials sequence beacons (e.g. show "Reconcile"
   *  only after the user dismisses "Flood Fill"). */
  after?: number;
  /** Optional hint shown as a modal when the user taps the beacon's
   *  target but the tap isn't the dismissOn action. Lets the UI redirect
   *  the user toward the right gesture (e.g. "try long pressing the
   *  mirror button"). The tap handler at the target site is responsible
   *  for checking this and suppressing its default action. */
  tapHint?: string;
}

/** Buttons in the composer toolbar that a tutorial can mark as disabled.
 *  Includes the real `CompToolType` tools plus `'color'`, which is a swatch
 *  button (opens a picker) rather than a tool-state. */
export type DisableableCompTool = CompToolType | 'color';

export interface TutorialScript {
  version: 1;
  name: string;
  startView: 'composition' | 'figure';
  order?: number;
  disabledCompTools?: DisableableCompTool[];
  beacons?: TutorialBeacon[];
  overview?: { title: string; description: string; progressText?: string; finishedText?: string };
  steps: TutorialStep[];
  completeConditions?: Record<string, unknown>;
}

export type TutorialPhase = 'overview' | 'idle' | 'steps';

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export type TutorialStep =
  | TextStep
  | HighlightStep
  | GifStep
  | ButtonStep
  | WaitStep
  | CompoundStep
  | SetStateStep;

export interface TextStep {
  type: 'text';
  id: string;
  text: string;
  position: StepPosition;
  waitFor?: WaitCondition;
  autoAdvanceMs?: number;
}

export interface HighlightStep {
  type: 'highlight';
  id: string;
  target: HighlightTarget;
  text?: string;
  textPosition?: 'above' | 'below' | 'left' | 'right';
  waitFor?: WaitCondition;
}

export interface GifStep {
  type: 'gif';
  id: string;
  /** Asset path relative to assets/ */
  asset: string;
  position: { xPercent: number; yPercent: number };
  width: number;
  height: number;
  waitFor?: WaitCondition;
}

export interface ButtonStep {
  type: 'button';
  id: string;
  label: string;
  position: StepPosition;
  variant?: 'primary' | 'secondary';
  /** Tapping the button implicitly advances — no explicit waitFor needed */
}

export interface WaitStep {
  type: 'wait';
  id: string;
  waitFor: WaitCondition;
}

export interface CompoundStep {
  type: 'compound';
  id: string;
  elements: CompoundElement[];
  waitFor?: WaitCondition;
}

/** Instantly set UI state and auto-advance to the next step. */
export interface SetStateStep {
  type: 'setState';
  id: string;
  commands: SetStateCommand[];
}

export type SetStateCommand =
  | { kind: 'compTool'; tool: CompToolType }
  | { kind: 'figureTool'; tool: ToolType }
  | { kind: 'mirrorOff' };

export type CompoundElement =
  | Omit<TextStep, 'waitFor' | 'id'>
  | Omit<HighlightStep, 'waitFor' | 'id'>
  | Omit<GifStep, 'waitFor' | 'id'>
  | Omit<ButtonStep, 'id'>;

// ---------------------------------------------------------------------------
// Positioning
// ---------------------------------------------------------------------------

export type StepPosition =
  | 'top'
  | 'center'
  | 'bottom'
  | { xPercent: number; yPercent: number };

// ---------------------------------------------------------------------------
// Highlight targets
// ---------------------------------------------------------------------------

export type HighlightTarget =
  | { kind: 'label'; label: string }
  | { kind: 'canvasRegion'; xPercent: number; yPercent: number; widthPercent: number; heightPercent: number };

// ---------------------------------------------------------------------------
// Wait conditions
// ---------------------------------------------------------------------------

export type WaitCondition =
  | { kind: 'tap' }
  | { kind: 'toolSelect'; tool: ToolType }
  | { kind: 'compToolSelect'; tool: CompToolType }
  | { kind: 'canvasDrag' }
  | { kind: 'createDrag' }
  | { kind: 'floodFill'; count?: number }
  | { kind: 'mirrorSelect' }
  | { kind: 'navigate'; to: 'figure' | 'composition' | 'gallery' }
  | { kind: 'buttonPress'; buttonId: string }
  | { kind: 'strokeEnd' }
  | { kind: 'selectionComplete' }
  | { kind: 'cutout' }
  | { kind: 'toggleRepeat' }
  | { kind: 'figureScale' }
  | { kind: 'group' }
  | { kind: 'reconcile' }
  | { kind: 'shiftLayer' }
  | { kind: 'changeLayer' }
  | { kind: 'openLayers' }
  | { kind: 'openSymmetryModal' }
  | { kind: 'mirrorStar' }
  | { kind: 'openColors' }
  | { kind: 'placeSVG'; count?: number }
  | { kind: 'colorToolPress' }
  | { kind: 'colorChosen' }
  | { kind: 'allMovesComplete' }
  | { kind: 'propsRotate' }
  | { kind: 'propsMirror' }
  | { kind: 'propsDuplicate' }
  | { kind: 'occupyRegion'; position: [number, number, number, number]; count: number }
  | { kind: 'openTileFamily' }
  | { kind: 'tileRotate' }
  | { kind: 'addLayer' }
  | { kind: 'multiSelect'; count?: number }
  | { kind: 'join' }
  | { kind: 'openSceneOutline' }
  | { kind: 'toggleLock' }
  | { kind: 'toggleHidden' }
  | { kind: 'reorderObjects' }
  | { kind: 'importFigureset'; name?: string }
  | { kind: 'delay'; ms: number }
  | { kind: 'any'; conditions: WaitCondition[] };

// ---------------------------------------------------------------------------
// Tutorial actions (emitted by dispatch wrappers / UI hooks)
// ---------------------------------------------------------------------------

export type TutorialAction =
  | { kind: 'toolSelect'; tool: ToolType }
  | { kind: 'compToolSelect'; tool: CompToolType }
  | { kind: 'canvasDrag' }
  | { kind: 'createDrag' }
  | { kind: 'floodFill' }
  | { kind: 'mirrorSelect' }
  | { kind: 'navigate'; to: 'figure' | 'composition' | 'gallery' }
  | { kind: 'buttonPress'; buttonId: string }
  | { kind: 'strokeEnd' }
  | { kind: 'selectionComplete' }
  | { kind: 'cutout' }
  | { kind: 'toggleRepeat' }
  | { kind: 'figureScale' }
  | { kind: 'group' }
  | { kind: 'reconcile' }
  | { kind: 'shiftLayer' }
  | { kind: 'changeLayer' }
  | { kind: 'openLayers' }
  | { kind: 'openSymmetryModal' }
  | { kind: 'mirrorStar' }
  | { kind: 'openColors' }
  | { kind: 'placeSVG' }
  | { kind: 'colorToolPress' }
  | { kind: 'colorChosen' }
  | { kind: 'allMovesComplete' }
  | { kind: 'propsRotate' }
  | { kind: 'propsMirror' }
  | { kind: 'propsDuplicate' }
  | { kind: 'occupyRegion' }
  | { kind: 'openTileFamily' }
  | { kind: 'tileRotate' }
  | { kind: 'addLayer' }
  | { kind: 'multiSelect'; count: number }
  | { kind: 'join' }
  | { kind: 'openSceneOutline' }
  | { kind: 'toggleLock' }
  | { kind: 'toggleHidden' }
  | { kind: 'reorderObjects' }
  | { kind: 'importFigureset'; name: string }
  | { kind: 'tap' };
