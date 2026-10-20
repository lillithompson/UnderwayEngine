import { CompositionState, makeViewport } from '@/engine/types';

// App-side factory for a fresh composition. The engine has no exported blank
// factory (consumers construct CompositionState inline, e.g. Facet's import
// path in persistence.ts), so this is CozyJournal's single construction
// point — formats layer their scaffolds on top of this in Phase 2+.
export function makeBlankComposition(id: string, name = 'Untitled'): CompositionState {
  return {
    id,
    name,
    figures: [],
    svgObjects: [],
    images: [],
    imageBlobs: {},
    lineDraft: null,
    arcDraft: null,
    editingLineId: null,
    selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
    customColors: [],
    groups: [],
    sceneOrder: [],
    // Composition-editor snap level. Grid density on screen is
    // cellCount = 32 / 2^gridLevel, so a lower level shows more grid lines:
    // L1 → 16 cells (a fine default grid — two levels finer than the old L3).
    // Users step it finer / coarser from the left-column capsules (clamped to
    // 0..6). Reimagine overrides this via EditorConfig.canvas.gridLevel and so
    // keeps its own (coarser) seed level.
    gridLevel: 1,
    // Composition-wide stroke width for any object that has never visited the
    // Stroke bar — drawn paths, lines, arcs, rectangles, circles. Keep in sync
    // with the engine's zip-export fallback (compositionExportZip.ts), which
    // stands in for this when an exported entry has none stored.
    strokeScale: 1.0,
    // Mirror of the app-level Grid Weight preference (gridWeightStore's
    // GRID_WEIGHT_DEFAULT); EditorShell overwrites it from the live store.
    gridIntensity: 0.75,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(0, 0),
    selectedFigureIds: new Set<string>(),
    activeFigureKey: null,
    compTool: 'select',
    createRegion: null,
    renderGeneration: 0,
  };
}
