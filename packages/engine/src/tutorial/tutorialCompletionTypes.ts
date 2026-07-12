// ---------------------------------------------------------------------------
// Types for tutorial completion tracking
// ---------------------------------------------------------------------------

/** Normalized condition after parsing the raw JSON from .ftutorial files */
export type CompleteCondition =
  | { type: 'editFigure'; figureName: string; instruction?: string }
  | { type: 'createFigure'; instruction?: string }
  | { type: 'moveFigure'; figureName: string; figurePosition: [number, number, number, number]; instruction?: string }
  | { type: 'floodRandom'; instruction?: string }
  | { type: 'openHierarchy'; instruction?: string }
  | { type: 'openFiguresTab'; instruction?: string }
  | { type: 'editExistingFigure'; instruction?: string }
  | { type: 'createPattern'; instruction?: string }
  | { type: 'duplicateFigure'; instruction?: string }
  | { type: 'createGroup'; instruction?: string }
  | { type: 'occupy'; position: [number, number, number, number]; strict?: boolean; exclude?: string[]; instruction?: string }
  | { type: 'pickColor'; instruction?: string }
  | { type: 'reconcileTool'; instruction?: string }
  | { type: 'cutoutTool'; instruction?: string }
  | { type: 'mirrorH'; instruction?: string }
  | { type: 'mirrorStar'; instruction?: string }
  | { type: 'mirrorAny'; instruction?: string }
  | { type: 'occupyLayers'; requireLayers: number[]; instruction?: string }
  | { type: 'randomBrush'; instruction?: string }
  | { type: 'importLibrary'; instruction?: string }
  | { type: 'placeFigure'; instruction?: string }
  | { type: 'placeTile'; instruction?: string }
  | { type: 'shiftLayer'; instruction?: string }
  | { type: 'addLayer'; instruction?: string }
  | { type: 'tileProperties'; instruction?: string }
  | { type: 'changeLayer'; instruction?: string }
  | { type: 'applyColor'; instruction?: string }
  | { type: 'togglePatternMode'; instruction?: string }
  | { type: 'createPatternRepetition'; instruction?: string }
  | { type: 'createLine'; instruction?: string }
  | { type: 'createArc'; instruction?: string }
  | { type: 'createSVGObject'; instruction?: string }
  | { type: 'recolorSVG'; instruction?: string }
  | { type: 'rotateObject'; instruction?: string }
  | { type: 'mirrorObject'; instruction?: string }
  | { type: 'duplicateObject'; instruction?: string }
  | { type: 'mirrorQuad'; instruction?: string }
  | { type: 'eraseTile'; instruction?: string }
  | { type: 'copyRegion'; instruction?: string }
  | { type: 'joinObjects'; instruction?: string };

/** Action emitted by editor components toward the completion engine */
export type CompletionAction =
  | { kind: 'editFigure'; figureName: string }
  | { kind: 'createFigure' }
  | { kind: 'moveFigure'; figureName: string; cellX: number; cellY: number; cellWidth: number; cellHeight: number }
  | { kind: 'floodRandom' }
  | { kind: 'openHierarchy' }
  | { kind: 'openFiguresTab' }
  | { kind: 'editExistingFigure' }
  | { kind: 'createPattern' }
  | { kind: 'duplicateFigure' }
  | { kind: 'createGroup' }
  | { kind: 'pickColor' }
  | { kind: 'reconcileTool' }
  | { kind: 'cutoutTool' }
  | { kind: 'mirrorH' }
  | { kind: 'mirrorStar' }
  | { kind: 'mirrorAny' }
  | { kind: 'occupyLayers' }
  | { kind: 'randomBrush' }
  | { kind: 'importLibrary' }
  | { kind: 'placeFigure' }
  | { kind: 'placeTile' }
  | { kind: 'shiftLayer' }
  | { kind: 'addLayer' }
  | { kind: 'tileProperties' }
  | { kind: 'changeLayer' }
  | { kind: 'applyColor' }
  | { kind: 'togglePatternMode' }
  | { kind: 'createPatternRepetition' }
  | { kind: 'createLine' }
  | { kind: 'createArc' }
  | { kind: 'createSVGObject' }
  | { kind: 'recolorSVG' }
  | { kind: 'rotateObject' }
  | { kind: 'mirrorObject' }
  | { kind: 'duplicateObject' }
  | { kind: 'mirrorQuad' }
  | { kind: 'eraseTile' }
  | { kind: 'copyRegion' }
  | { kind: 'joinObjects' };
