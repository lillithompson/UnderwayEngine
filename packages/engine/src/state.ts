import {
  EditorState,
  FileConfig,
  ClipBox,
  Layer,
  Tool,
  CellState,
  GridLevel,
  Camera,
  LAYER_PX,
  CELL_COUNTS,
  CellEdit,
  Selection,
  SelectionSubTool,
  SelectionMode,
  MovePreview,
  RotatePreview,
  Pattern,
  ViewportInsets,
  makeViewport,
  pushDirtyRect,
  markFullDirty,
  initDirtyRects,
  editableCells,
  hideHeavyLayerFields,
  cloneLayer,
  getPaletteColor,
} from './types';
import { pathIndicesToL0 } from './path-selection';
import { createCellGrid, createEdgeStorage, cellStateFromTool, applyCellEdit, rebuildPixelData, snapshotLayer, layerFromSnapshot } from './cells';

/** Compute the base camera transform that maps file content to fill the viewport.
 *  Insets shift the visual center so content is centered in the effective area
 *  between edge-anchored UI controls. */
export function computeBaseCamera(
  widthL0: number, heightL0: number, vw: number, vh: number,
  insets: ViewportInsets = { top: 0, right: 0, bottom: 0, left: 0 },
  originL0X: number = 0, originL0Y: number = 0,
) {
  const fracW = widthL0 / 32;
  const fracH = heightL0 / 32;
  const aspect = vw / (vh || 1);
  const zoomW = 1 / fracW;
  const zoomH = 1 / (aspect * fracH);
  const baseZoom = Math.min(zoomW, zoomH);
  // Insets are specified in screen pixels; the shader's offset is scaled by
  // baseZoom when mapped to pixels (see LAYER_FRAG: uv = uv/zoom - offset), so
  // divide by baseZoom here to keep the resulting pixel shift independent of
  // file size. Without this, a small file (e.g. 4x4 at baseZoom=8) amplifies a
  // 52px inset into a ~200px shift and slides the canvas off-screen.
  const d = 2 * (vw || 1) * baseZoom;
  // Subtract origin/32 from the offset so the shader's uv (after transform)
  // lands at the canvas window's layer-UV sub-rect, regardless of where that
  // window sits within the 32-L0 layer space. For origin=0 this reduces to the
  // legacy "canvas aligned with layer top-left" formula.
  const baseOffsetU = 0.5 - fracW / 2 - originL0X / 32 + (zoomW > zoomH ? (insets.left - insets.right) / d : 0);
  const baseOffsetV = 0.5 - fracH / 2 - originL0Y / 32 + (zoomH > zoomW ? (insets.top - insets.bottom) / d : 0);
  return { baseZoom, baseOffsetU, baseOffsetV };
}

// ── Actions ──────────────────────────────────────────────────────────

export type EditorAction =
  | { type: 'APPLY_TOOL'; cellX: number; cellY: number; cellState?: CellState }
  | { type: 'SET_ACTIVE_LAYER'; layerId: string }
  | { type: 'SET_TOOL'; tool: Tool }
  | { type: 'SET_DRAW_TOOL'; tool: Tool }
  | { type: 'ADD_LAYER'; level: GridLevel; name?: string; shiftX?: 0 | 0.5; shiftY?: 0 | 0.5 }
  | { type: 'REMOVE_LAYER'; layerId: string }
  | { type: 'DUPLICATE_LAYER'; layerId: string }
  | { type: 'TOGGLE_LAYER_VISIBILITY'; layerId: string }
  | { type: 'PAN'; dx: number; dy: number }
  | { type: 'ZOOM'; delta: number; centerX: number; centerY: number }
  | { type: 'SET_VIEWPORT'; width: number; height: number }
  | { type: 'SET_INSETS'; top: number; right: number; bottom: number; left: number }
  | { type: 'CLEAR_ALL' }
  | { type: 'FLOOD_FILL'; cellEdits: { cellX: number; cellY: number; newState: CellState }[] }
  | { type: 'FLOOD_FILL_DONE' }
  | { type: 'FLOOD_FILL_ALL_LAYERS' }
  | { type: 'FLOOD_FILL_ALL_LAYERS_DONE' }
  | { type: 'SIMPLE_FILL'; cellEdits: { cellX: number; cellY: number; newState: CellState }[] }
  | { type: 'SIMPLE_FILL_DONE' }
  | { type: 'STROKE_START' }
  | { type: 'STROKE_END' }
  | { type: 'LOAD_STATE'; layers: Layer[]; activeLayerId: string; camera?: Camera; patterns?: Pattern[]; widthL0?: number; heightL0?: number; originL0X?: number; originL0Y?: number; excludedFamilies?: Set<string>; allowBorderConnections?: boolean; clipBoxProvided?: boolean; clipBox?: ClipBox | null }
  | { type: 'CYCLE_MIRROR' }
  | { type: 'SET_MIRROR'; mirrorH: boolean; mirrorV: boolean; mirrorRotate: boolean; mirrorQuad: boolean; mirrorRow: boolean; mirrorCol: boolean; mirrorDiag1: boolean; mirrorDiag2: boolean; mirrorDiagBoth: boolean; mirrorStar: boolean }
  | { type: 'SET_SELECTION'; selection: Selection | null }
  | { type: 'SET_SELECTION_SUB_TOOL'; subTool: SelectionSubTool | null }
  | { type: 'SET_MOVE_PREVIEW'; movePreview: MovePreview | null }
  | { type: 'SET_ROTATE_PREVIEW'; rotatePreview: RotatePreview | null }
  | { type: 'APPLY_SELECTION_EDIT'; cellEdits: { layerId: string; cellX: number; cellY: number; newState: CellState }[]; keepSelection?: boolean }
  | { type: 'TOGGLE_DEEP_EDIT' }
  | { type: 'SET_DEEP_EDIT'; value: boolean }
  | { type: 'TOGGLE_COPY_SELECTION' }
  | { type: 'SET_COPY_SELECTION'; value: boolean }
  | { type: 'TOGGLE_AUTO_HIGHLIGHT' }
  | { type: 'SET_AUTO_HIGHLIGHT'; value: boolean }
  | { type: 'TOGGLE_LAYER_SHIFT'; layerId: string; axis: 'x' | 'y' }
  | { type: 'TOGGLE_LAYER_LOCK'; layerId: string }
  | { type: 'CLEAR_LAYER'; layerId: string }
  | { type: 'REORDER_LAYER'; layerId: string; newOrder: number }
  | { type: 'RENAME_LAYER'; layerId: string; name: string }
  | { type: 'ADD_PATTERN'; pattern: Pattern }
  | { type: 'REMOVE_PATTERN'; patternId: string }
  | { type: 'SET_ACTIVE_PATTERN'; patternId: string | null }
  | { type: 'SET_PATTERN_ORIGIN'; origin: { cellX: number; cellY: number } }
  | { type: 'SET_PATTERN_ROTATION'; rotation: 0 | 90 | 180 | 270 }
  | { type: 'APPLY_PATTERN'; cellEdits: { layerId: string; cellX: number; cellY: number; newState: CellState }[] }
  | { type: 'BUMP_RENDER' }
  | { type: 'SET_ALLOW_BORDER_CONNECTIONS'; value: boolean }
  | { type: 'SET_MULTIRES_FILL'; value: boolean }
  | { type: 'TOGGLE_RANDOM_FAMILY'; family: string }
  | { type: 'RECONCILE_DONE' }
  | { type: 'SET_CAMERA_POS'; offsetX: number; offsetY: number }
  | { type: 'SET_ZOOM_LEVEL'; zoom: number }
  | { type: 'SET_CLONE_DISPLAY'; sourceIndex: number | null; sampleIndex: number | null; anchorIndex: number | null; cursorIndex: number | null }
  | { type: 'SET_SELECTION_MODE'; mode: SelectionMode }
  | { type: 'ADD_PATH_INDICES'; indices: number[]; level: GridLevel }
  | { type: 'SET_PATH_INDICES'; pathIndices: Set<number>; pathLevel: GridLevel }
  | { type: 'CLEAR_PATH' }
  | { type: 'SHRINKWRAP'; widthL0: number; heightL0: number; originL0X: number; originL0Y: number }
  | { type: 'RESIZE_CANVAS'; widthL0: number; heightL0: number; originL0X: number; originL0Y: number }
  | { type: 'UPSCALE'; widthL0: number; heightL0: number; originL0X: number; originL0Y: number }
  | { type: 'SET_RESIZING'; resizing: boolean }
  | { type: 'FRAME' }
  | { type: 'SET_CLIP_BOX'; clipBox: ClipBox | null };

/** The "fit" state is always identity — base camera in the renderer handles framing */
function fitCamera(): Camera {
  return { offsetX: 0, offsetY: 0, zoom: 1 };
}

// ── Reducer ──────────────────────────────────────────────────────────

export function editorReducer(
  state: EditorState,
  action: EditorAction,
): EditorState {
  switch (action.type) {
    case 'APPLY_TOOL': {
      const layer = state.layers.find((l) => l.id === state.activeLayerId);
      if (!layer) return state;
      if (layer.locked || !layer.visible) return state;
      let cs = action.cellState ?? cellStateFromTool(state.tool);
      if (cs && cs.type === 'sprite' && cs.tintR === undefined
          && (state.activeColorR !== 255 || state.activeColorG !== 255 || state.activeColorB !== 255)) {
        cs = { ...cs, tintR: state.activeColorR, tintG: state.activeColorG, tintB: state.activeColorB };
      }
      const edit = applyCellEdit(layer, action.cellX, action.cellY, cs);
      const size = LAYER_PX / (layer.cells[0]?.length || 1);
      const shiftPxX = layer.shiftX * size;
      const shiftPxY = layer.shiftY * size;
      const rawX = action.cellX * size + shiftPxX;
      const rawY = action.cellY * size + shiftPxY;
      const newRect = {
        x: Math.max(0, rawX),
        y: Math.max(0, rawY),
        width: Math.min(LAYER_PX, rawX + size) - Math.max(0, rawX),
        height: Math.min(LAYER_PX, rawY + size) - Math.max(0, rawY),
      };
      pushDirtyRect(layer, newRect);
      return {
        ...state,
        lastCellEdits: [edit],
        renderGeneration: state.renderGeneration + 1,
      };
    }

    case 'SET_ACTIVE_LAYER': {
      const newLayer = state.layers.find((l) => l.id === action.layerId);
      const clearSel =
        state.selection &&
        newLayer &&
        newLayer.level > state.selection.level;
      const oldLayer = state.layers.find((l) => l.id === state.activeLayerId);
      const clearPath = state.pathIndices.size > 0 && newLayer && oldLayer && newLayer.level !== oldLayer.level;
      return {
        ...state,
        activeLayerId: action.layerId,
        ...(clearSel ? { selection: null, movePreview: null, rotatePreview: null } : {}),
        ...(clearPath ? { pathIndices: new Set<number>(), pathL0Indices: null, pathGeneration: state.pathGeneration + 1 } : {}),
        // Reset clone display — resolution may change
        cloneSourceIndex: null,
        cloneSampleIndex: null,
        cloneAnchorIndex: null,
        cloneCursorIndex: null,
        renderGeneration: state.renderGeneration + 1,
      };
    }

    case 'SET_TOOL': {
      const extra: Partial<EditorState> = {};
      if (action.tool.type !== 'select') {
        extra.selection = null;
        extra.movePreview = null;
        extra.rotatePreview = null;
        extra.pathIndices = new Set();
        extra.pathL0Indices = null;
        extra.pathGeneration = state.pathGeneration + 1;
      }
      if (action.tool.type !== 'pattern') {
        extra.activePatternId = null;
        extra.patternOrigin = null;
        extra.activePatternRotation = 0;
      }
      // Reset clone display when switching tools
      extra.cloneSourceIndex = null;
      extra.cloneSampleIndex = null;
      extra.cloneAnchorIndex = null;
      extra.cloneCursorIndex = null;
      // Track the active drawing tool separately (preserved across select/pattern modes)
      if (action.tool.type !== 'select' && action.tool.type !== 'pattern') {
        extra.drawTool = action.tool;
      }
      if (action.tool.type === 'color') {
        const p = getPaletteColor(action.tool.colorIndex ?? 0);
        extra.activeColorR = action.tool.customColorR ?? p[0];
        extra.activeColorG = action.tool.customColorG ?? p[1];
        extra.activeColorB = action.tool.customColorB ?? p[2];
      }
      return { ...state, tool: action.tool, ...extra, renderGeneration: state.renderGeneration + 1 };
    }

    case 'SET_DRAW_TOOL': {
      if (action.tool.type !== 'select' && action.tool.type !== 'pattern') {
        return { ...state, drawTool: action.tool, renderGeneration: state.renderGeneration + 1 };
      }
      return state;
    }

    case 'TOGGLE_LAYER_LOCK': {
      const layers = state.layers.map((l) =>
        l.id === action.layerId ? cloneLayer(l, { locked: !l.locked }) : l,
      );
      return {
        ...state,
        layers,
        renderGeneration: state.renderGeneration + 1,
      };
    }

    case 'CLEAR_LAYER': {
      const layer = state.layers.find((l) => l.id === action.layerId);
      if (!layer || layer.locked || !layer.visible) return state;
      const count = layer.cells[0]?.length || 0;
      for (let y = 0; y < count; y++) layer.cells[y].fill(null);
      if (layer.edgeRowTop) layer.edgeRowTop.fill(null);
      if (layer.edgeColLeft) layer.edgeColLeft.fill(null);
      layer.edgeCorner = null;
      layer.cellsGeneration++;
      layer.data.fill(0);
      markFullDirty(layer);
      return { ...state, renderGeneration: state.renderGeneration + 1 };
    }

    case 'REORDER_LAYER': {
      const layer = state.layers.find((l) => l.id === action.layerId);
      if (!layer) return state;
      layer.order = action.newOrder;
      return { ...state, renderGeneration: state.renderGeneration + 1 };
    }

    case 'RENAME_LAYER': {
      const layer = state.layers.find((l) => l.id === action.layerId);
      if (!layer) return state;
      layer.name = action.name;
      return { ...state };
    }

    case 'ADD_LAYER': {
      const id = `layer_${Date.now()}`;
      const _data = new Uint8Array(LAYER_PX * LAYER_PX * 4);
      const sx = action.shiftX ?? 0;
      const sy = action.shiftY ?? 0;
      const edges = createEdgeStorage(action.level, sx, sy);
      const minOrder = Math.min(...state.layers.map((l) => l.order));
      const newLayer: Layer = hideHeavyLayerFields({
        id,
        name: action.name ?? `Level ${action.level} (New)`,
        level: action.level,
        visible: true,
        opacity: 1,
        order: minOrder - 1,
        shiftX: sx,
        shiftY: sy,
        locked: false,
        data: _data,
        dataU32: new Uint32Array(_data.buffer),
        dirtyRects: initDirtyRects(),
        dirtyRectCount: 0,
        cells: createCellGrid(action.level),
        cellsGeneration: 0,
        edgeRowTop: edges.edgeRowTop,
        edgeColLeft: edges.edgeColLeft,
        edgeCorner: edges.edgeCorner,
      });
      return {
        ...state,
        layers: [...state.layers, newLayer],
        activeLayerId: id,
        renderGeneration: state.renderGeneration + 1,
      };
    }

    case 'REMOVE_LAYER': {
      if (state.layers.length <= 1) return state;
      const remaining = state.layers.filter((l) => l.id !== action.layerId);
      const activeLayerId =
        state.activeLayerId === action.layerId
          ? remaining[0].id
          : state.activeLayerId;
      return {
        ...state,
        layers: remaining,
        activeLayerId,
        renderGeneration: state.renderGeneration + 1,
      };
    }

    case 'DUPLICATE_LAYER': {
      const source = state.layers.find((l) => l.id === action.layerId);
      if (!source) return state;
      const sorted = [...state.layers].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex((l) => l.id === source.id);
      const next = sorted[idx + 1];
      const newOrder = next ? (source.order + next.order) / 2 : source.order + 1;
      const snapshot = snapshotLayer(source);
      const dupe = layerFromSnapshot({
        ...snapshot,
        id: `layer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: `${source.name} Copy`,
        order: newOrder,
      });
      return {
        ...state,
        layers: [...state.layers, dupe],
        renderGeneration: state.renderGeneration + 1,
      };
    }

    case 'TOGGLE_LAYER_VISIBILITY': {
      const layers = state.layers.map((l) =>
        l.id === action.layerId ? cloneLayer(l, { visible: !l.visible }) : l,
      );
      return {
        ...state,
        layers,
        renderGeneration: state.renderGeneration + 1,
      };
    }

    case 'PAN': {
      const camera: Camera = {
        ...state.camera,
        offsetX: state.camera.offsetX + action.dx,
        offsetY: state.camera.offsetY + action.dy,
      };
      return {
        ...state,
        camera,
        renderGeneration: state.renderGeneration + 1,
      };
    }

    case 'ZOOM': {
      const newZoom = Math.max(0.1, Math.min(10, state.camera.zoom + action.delta));
      const camera: Camera = { ...state.camera, zoom: newZoom };
      return {
        ...state,
        camera,
        renderGeneration: state.renderGeneration + 1,
      };
    }

    case 'SET_CAMERA_POS': {
      const camera: Camera = {
        ...state.camera,
        offsetX: action.offsetX,
        offsetY: action.offsetY,
      };
      return {
        ...state,
        camera,
        renderGeneration: state.renderGeneration + 1,
      };
    }

    case 'SET_ZOOM_LEVEL': {
      const camera: Camera = {
        ...state.camera,
        zoom: Math.max(0.1, Math.min(10, action.zoom)),
      };
      return {
        ...state,
        camera,
        renderGeneration: state.renderGeneration + 1,
      };
    }

    case 'FRAME': {
      return {
        ...state,
        camera: fitCamera(),
        renderGeneration: state.renderGeneration + 1,
      };
    }

    case 'SET_VIEWPORT': {
      const vw = action.width;
      const vh = action.height;
      const oldVw = state.viewport.width;
      let cam = state.camera;
      if (oldVw === 0 && vw > 0 && vh > 0) {
        // First layout — fit camera to file content
        cam = fitCamera();
      } else if (oldVw > 0 && vw > 0 && (vw !== oldVw || vh !== state.viewport.height)) {
        // Viewport resized — rescale offset proportionally (offset is in pixel units, divided by vw in shader)
        cam = {
          offsetX: state.camera.offsetX * (vw / oldVw),
          offsetY: state.camera.offsetY * (vw / oldVw),
          zoom: state.camera.zoom,
        };
      }
      return {
        ...state,
        viewport: { ...state.viewport, width: vw, height: vh },
        camera: cam,
      };
    }

    case 'SET_INSETS': {
      const v = state.viewport;
      if (v.topInset === action.top && v.rightInset === action.right &&
          v.bottomInset === action.bottom && v.leftInset === action.left) return state;
      return { ...state, viewport: { ...v, topInset: action.top, rightInset: action.right, bottomInset: action.bottom, leftInset: action.left } };
    }

    case 'CLEAR_ALL': {
      const layers = state.layers.map((l) => {
        if (l.locked || !l.visible) return l;
        l.data.fill(0);
        const count = l.cells[0]?.length || 0;
        for (let y = 0; y < count; y++) {
          l.cells[y].fill(null);
        }
        if (l.edgeRowTop) l.edgeRowTop.fill(null);
        if (l.edgeColLeft) l.edgeColLeft.fill(null);
        l.edgeCorner = null;
        l.cellsGeneration++;
        markFullDirty(l);
        return l;
      });
      return {
        ...state,
        layers,
        renderGeneration: state.renderGeneration + 1,
      };
    }

    case 'FLOOD_FILL': {
      const layer = state.layers.find((l) => l.id === state.activeLayerId);
      if (!layer) return state;
      if (layer.locked || !layer.visible) return state;
      const edits: CellEdit[] = [];
      for (const ce of action.cellEdits) {
        edits.push(applyCellEdit(layer, ce.cellX, ce.cellY, ce.newState));
      }
      markFullDirty(layer);
      return {
        ...state,
        lastCellEdits: edits,
        renderGeneration: state.renderGeneration + 1,
      };
    }

    // Cells + pixels already mutated by bulkFloodFill — just bump render generation
    case 'FLOOD_FILL_DONE': {
      return {
        ...state,
        renderGeneration: state.renderGeneration + 1,
      };
    }

    // Side-effect action: handled in EditorScreen; reducer is a no-op
    case 'FLOOD_FILL_ALL_LAYERS': {
      return state;
    }

    case 'FLOOD_FILL_ALL_LAYERS_DONE': {
      return {
        ...state,
        renderGeneration: state.renderGeneration + 1,
      };
    }

    case 'SIMPLE_FILL': {
      const layer = state.layers.find((l) => l.id === state.activeLayerId);
      if (!layer) return state;
      if (layer.locked || !layer.visible) return state;
      const edits: CellEdit[] = [];
      for (const ce of action.cellEdits) {
        edits.push(applyCellEdit(layer, ce.cellX, ce.cellY, ce.newState));
      }
      markFullDirty(layer);
      return {
        ...state,
        lastCellEdits: edits,
        renderGeneration: state.renderGeneration + 1,
      };
    }

    case 'SIMPLE_FILL_DONE': {
      return {
        ...state,
        renderGeneration: state.renderGeneration + 1,
      };
    }

    // Cells already mutated by reconcileCanvas, pixels rebuilt by caller
    case 'RECONCILE_DONE': {
      return {
        ...state,
        renderGeneration: state.renderGeneration + 1,
      };
    }

    case 'STROKE_START':
      return state;

    case 'STROKE_END':
      return { ...state, renderGeneration: state.renderGeneration + 1 };

    case 'LOAD_STATE': {
      const configUpdates: Partial<FileConfig> = {};
      if (action.widthL0 !== undefined) configUpdates.widthL0 = action.widthL0;
      if (action.heightL0 !== undefined) configUpdates.heightL0 = action.heightL0;
      if (action.originL0X !== undefined) configUpdates.originL0X = action.originL0X;
      if (action.originL0Y !== undefined) configUpdates.originL0Y = action.originL0Y;
      if (action.clipBoxProvided) configUpdates.clipBox = action.clipBox ?? undefined;
      const updatedConfig = Object.keys(configUpdates).length > 0
        ? { ...state.fileConfig, ...configUpdates }
        : state.fileConfig;
      const camera = action.camera ?? state.camera;
      return {
        ...state,
        fileConfig: updatedConfig,
        layers: action.layers,
        activeLayerId: action.activeLayerId,
        camera,
        ...(action.patterns !== undefined ? { patterns: action.patterns } : {}),
        ...(action.excludedFamilies !== undefined ? { excludedFamilies: action.excludedFamilies } : {}),
        ...(action.allowBorderConnections !== undefined ? { allowBorderConnections: action.allowBorderConnections } : {}),
        renderGeneration: state.renderGeneration + 1,
      };
    }

    case 'CYCLE_MIRROR': {
      // Cycle: Off → H → H+V → V → Off (other states from modal reset to Off)
      const { mirrorH: mH, mirrorV: mV, mirrorRotate: mR, mirrorQuad: mQ, mirrorRow: mRw, mirrorCol: mC, mirrorDiag1: mD1, mirrorDiag2: mD2, mirrorDiagBoth: mDB, mirrorStar: mSt } = state;
      const allOff = !mH && !mV && !mR && !mQ && !mRw && !mC && !mD1 && !mD2 && !mDB && !mSt;
      const hOnly = mH && !mV && !mR && !mQ && !mRw && !mC && !mD1 && !mD2 && !mDB && !mSt;
      const hv = mH && mV && !mR && !mQ && !mRw && !mC && !mD1 && !mD2 && !mDB && !mSt;
      let nextH = false, nextV = false;
      if (allOff)      { nextH = true; }
      else if (hOnly)  { nextH = true; nextV = true; }
      else if (hv)     { nextV = true; }
      // vOnly or any other state → all off (defaults)
      return {
        ...state,
        mirrorH: nextH,
        mirrorV: nextV,
        mirrorRotate: false,
        mirrorQuad: false,
        mirrorRow: false,
        mirrorCol: false,
        mirrorDiag1: false,
        mirrorDiag2: false,
        mirrorDiagBoth: false,
        mirrorStar: false,
        renderGeneration: state.renderGeneration + 1,
      };
    }

    case 'SET_MIRROR': {
      return {
        ...state,
        mirrorH: action.mirrorH,
        mirrorV: action.mirrorV,
        mirrorRotate: action.mirrorRotate,
        mirrorQuad: action.mirrorQuad,
        mirrorRow: action.mirrorRow,
        mirrorCol: action.mirrorCol,
        mirrorDiag1: action.mirrorDiag1,
        mirrorDiag2: action.mirrorDiag2,
        mirrorDiagBoth: action.mirrorDiagBoth,
        mirrorStar: action.mirrorStar,
        renderGeneration: state.renderGeneration + 1,
      };
    }

    case 'SET_SELECTION':
      return {
        ...state,
        selection: action.selection,
        movePreview: null,
        rotatePreview: null,
        renderGeneration: state.renderGeneration + 1,
      };

    case 'SET_SELECTION_SUB_TOOL':
      return {
        ...state,
        selectionSubTool: action.subTool,
      };

    case 'SET_MOVE_PREVIEW':
      return {
        ...state,
        movePreview: action.movePreview,
        renderGeneration: state.renderGeneration + 1,
      };

    case 'SET_ROTATE_PREVIEW':
      return {
        ...state,
        rotatePreview: action.rotatePreview,
        renderGeneration: state.renderGeneration + 1,
      };

    case 'TOGGLE_DEEP_EDIT':
      return {
        ...state,
        deepEdit: !state.deepEdit,
      };

    case 'SET_DEEP_EDIT':
      return {
        ...state,
        deepEdit: action.value,
      };

    case 'TOGGLE_COPY_SELECTION':
      return {
        ...state,
        copySelection: !state.copySelection,
      };

    case 'SET_COPY_SELECTION':
      return {
        ...state,
        copySelection: action.value,
      };

    case 'TOGGLE_AUTO_HIGHLIGHT':
      return {
        ...state,
        autoHighlight: !state.autoHighlight,
      };

    case 'SET_AUTO_HIGHLIGHT':
      return {
        ...state,
        autoHighlight: action.value,
      };

    case 'TOGGLE_LAYER_SHIFT': {
      const layer = state.layers.find((l) => l.id === action.layerId);
      if (!layer || layer.level === 0) return state; // L0 cannot be shifted
      const layers = state.layers.map((l) => {
        if (l.id !== action.layerId) return l;
        const updated = cloneLayer(l);
        const count = CELL_COUNTS[l.level];
        if (action.axis === 'x') {
          updated.shiftX = l.shiftX === 0 ? 0.5 : 0;
          updated.edgeColLeft = updated.shiftX === 0.5
            ? new Array(count).fill(null) : null;
        } else {
          updated.shiftY = l.shiftY === 0 ? 0.5 : 0;
          updated.edgeRowTop = updated.shiftY === 0.5
            ? new Array(count).fill(null) : null;
        }
        if (updated.shiftX === 0 && updated.shiftY === 0) updated.edgeCorner = null;
        rebuildPixelData(updated);
        markFullDirty(updated);
        return updated;
      });
      // Clear selection if active layer shift changed
      const clearSel = action.layerId === state.activeLayerId && state.selection;
      return {
        ...state,
        layers,
        ...(clearSel ? { selection: null, movePreview: null, rotatePreview: null } : {}),
        renderGeneration: state.renderGeneration + 1,
      };
    }

    case 'APPLY_SELECTION_EDIT': {
      for (const ce of action.cellEdits) {
        const layer = state.layers.find((l) => l.id === ce.layerId);
        if (layer) {
          applyCellEdit(layer, ce.cellX, ce.cellY, ce.newState);
          const size = LAYER_PX / (layer.cells[0]?.length || 1);
          const sRawX = ce.cellX * size + layer.shiftX * size;
          const sRawY = ce.cellY * size + layer.shiftY * size;
          const newRect = {
            x: Math.max(0, sRawX),
            y: Math.max(0, sRawY),
            width: Math.min(LAYER_PX, sRawX + size) - Math.max(0, sRawX),
            height: Math.min(LAYER_PX, sRawY + size) - Math.max(0, sRawY),
          };
          pushDirtyRect(layer, newRect);
        }
      }
      return {
        ...state,
        ...(action.keepSelection ? {} : { selection: null }),
        movePreview: null,
        rotatePreview: null,
        renderGeneration: state.renderGeneration + 1,
      };
    }

    case 'ADD_PATTERN':
      return {
        ...state,
        patterns: [...state.patterns, action.pattern],
        activePatternId: action.pattern.id,
        activePatternRotation: 0,
        patternOrigin: null,
      };

    case 'REMOVE_PATTERN': {
      const cleared = state.activePatternId === action.patternId;
      return {
        ...state,
        patterns: state.patterns.filter((p) => p.id !== action.patternId),
        ...(cleared ? { activePatternId: null, patternOrigin: null, activePatternRotation: 0 as const } : {}),
      };
    }

    case 'SET_ACTIVE_PATTERN':
      return {
        ...state,
        activePatternId: action.patternId,
        patternOrigin: null,
        activePatternRotation: 0,
      };

    case 'SET_PATTERN_ORIGIN':
      return {
        ...state,
        patternOrigin: action.origin,
      };

    case 'SET_PATTERN_ROTATION':
      return {
        ...state,
        activePatternRotation: action.rotation,
      };

    case 'APPLY_PATTERN': {
      for (const ce of action.cellEdits) {
        const layer = state.layers.find((l) => l.id === ce.layerId);
        if (layer) {
          applyCellEdit(layer, ce.cellX, ce.cellY, ce.newState);
          const size = LAYER_PX / (layer.cells[0]?.length || 1);
          const sRawX = ce.cellX * size + layer.shiftX * size;
          const sRawY = ce.cellY * size + layer.shiftY * size;
          const newRect = {
            x: Math.max(0, sRawX),
            y: Math.max(0, sRawY),
            width: Math.min(LAYER_PX, sRawX + size) - Math.max(0, sRawX),
            height: Math.min(LAYER_PX, sRawY + size) - Math.max(0, sRawY),
          };
          pushDirtyRect(layer, newRect);
        }
      }
      return {
        ...state,
        renderGeneration: state.renderGeneration + 1,
      };
    }

    case 'SET_ALLOW_BORDER_CONNECTIONS':
      return {
        ...state,
        allowBorderConnections: action.value,
      };

    case 'SET_MULTIRES_FILL':
      return {
        ...state,
        multiresFill: action.value,
      };

    case 'TOGGLE_RANDOM_FAMILY': {
      const next = new Set(state.excludedFamilies);
      if (next.has(action.family)) next.delete(action.family);
      else next.add(action.family);
      return { ...state, excludedFamilies: next };
    }

    case 'BUMP_RENDER': {
      // Rebuild pixel data for all layers (sprites may have upgraded resolution)
      for (const layer of state.layers) {
        rebuildPixelData(layer);
        markFullDirty(layer);
      }
      return {
        ...state,
        renderGeneration: state.renderGeneration + 1,
        atlasGeneration: state.atlasGeneration + 1,
      };
    }

    case 'SET_CLONE_DISPLAY':
      return {
        ...state,
        cloneSourceIndex: action.sourceIndex,
        cloneSampleIndex: action.sampleIndex,
        cloneAnchorIndex: action.anchorIndex,
        cloneCursorIndex: action.cursorIndex,
        renderGeneration: state.renderGeneration + 1,
      };

    case 'SET_SELECTION_MODE': {
      const switching = action.mode !== state.selectionMode;
      return {
        ...state,
        selectionMode: action.mode,
        ...(switching ? {
          selection: null,
          movePreview: null,
          rotatePreview: null,
          pathIndices: new Set<number>(),
          pathL0Indices: null,
          pathGeneration: state.pathGeneration + 1,
          selectionSubTool: action.mode === 'path' ? null : 'move',
        } : {}),
        renderGeneration: state.renderGeneration + 1,
      };
    }

    case 'ADD_PATH_INDICES': {
      const next = new Set(state.pathIndices);
      for (const idx of action.indices) next.add(idx);
      const l0 = pathIndicesToL0(next, action.level);
      return {
        ...state,
        pathIndices: next,
        pathLevel: action.level,
        pathL0Indices: l0,
        pathGeneration: state.pathGeneration + 1,
        renderGeneration: state.renderGeneration + 1,
      };
    }

    case 'SET_PATH_INDICES': {
      const l0 = pathIndicesToL0(action.pathIndices, action.pathLevel);
      return {
        ...state,
        pathIndices: action.pathIndices,
        pathLevel: action.pathLevel,
        pathL0Indices: l0,
        pathGeneration: state.pathGeneration + 1,
        renderGeneration: state.renderGeneration + 1,
      };
    }

    case 'CLEAR_PATH':
      return {
        ...state,
        pathIndices: new Set<number>(),
        pathL0Indices: null,
        pathGeneration: state.pathGeneration + 1,
        selection: null,
        selectionSubTool: null,
        renderGeneration: state.renderGeneration + 1,
      };

    case 'SHRINKWRAP': {
      // Layers already mutated in-place before dispatch
      return {
        ...state,
        fileConfig: {
          ...state.fileConfig,
          widthL0: action.widthL0,
          heightL0: action.heightL0,
          originL0X: action.originL0X,
          originL0Y: action.originL0Y,
        },
        camera: fitCamera(),
        selection: null,
        movePreview: null,
        rotatePreview: null,
        renderGeneration: state.renderGeneration + 1,
      };
    }

    case 'RESIZE_CANVAS': {
      return {
        ...state,
        fileConfig: {
          ...state.fileConfig,
          widthL0: action.widthL0,
          heightL0: action.heightL0,
          originL0X: action.originL0X,
          originL0Y: action.originL0Y,
        },
        camera: fitCamera(),
        selection: null,
        movePreview: null,
        rotatePreview: null,
        resizingCanvas: false,
        renderGeneration: state.renderGeneration + 1,
      };
    }

    case 'UPSCALE': {
      // Layers already mutated in-place before dispatch (see upscaleLayers).
      // Active layer may have been removed if it was an L4 — fall back to the first remaining.
      const activeStillExists = state.layers.some(l => l.id === state.activeLayerId);
      return {
        ...state,
        fileConfig: {
          ...state.fileConfig,
          widthL0: action.widthL0,
          heightL0: action.heightL0,
          originL0X: action.originL0X,
          originL0Y: action.originL0Y,
        },
        activeLayerId: activeStillExists ? state.activeLayerId : (state.layers[0]?.id ?? state.activeLayerId),
        camera: fitCamera(),
        selection: null,
        movePreview: null,
        rotatePreview: null,
        renderGeneration: state.renderGeneration + 1,
      };
    }

    case 'SET_RESIZING':
      return {
        ...state,
        resizingCanvas: action.resizing,
        renderGeneration: state.renderGeneration + 1,
      };

    case 'SET_CLIP_BOX':
      return {
        ...state,
        fileConfig: {
          ...state.fileConfig,
          clipBox: action.clipBox ?? undefined,
        },
        renderGeneration: state.renderGeneration + 1,
      };

    default:
      return state;
  }
}

// ── Initial State ────────────────────────────────────────────────────

function createLayer(id: string, name: string, level: GridLevel, order: number): Layer {
  const data = new Uint8Array(LAYER_PX * LAYER_PX * 4);
  return hideHeavyLayerFields({
    id,
    name,
    level,
    visible: true,
    opacity: 1,
    order,
    shiftX: 0,
    shiftY: 0,
    locked: false,
    data,
    dataU32: new Uint32Array(data.buffer),
    dirtyRects: initDirtyRects(),
    dirtyRectCount: 0,
    cells: createCellGrid(level),
    cellsGeneration: 0,
    edgeRowTop: null,
    edgeColLeft: null,
    edgeCorner: null,
  });
}

export function createInitialState(fileConfig: FileConfig): EditorState {
  // Start with no layers — EditorScreen will either load from persistence
  // or call createDefaultLayers(). This avoids allocating 48MB+ of pixel
  // buffers that get thrown away immediately on load.
  return {
    fileConfig,
    layers: [],
    activeLayerId: '',
    tool: { type: 'random' },
    drawTool: { type: 'random' },
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(0, 0),
    renderGeneration: 0,
    atlasGeneration: 0,
    lastCellEdits: [],
    mirrorH: false,
    mirrorV: false,
    mirrorRotate: false,
    mirrorQuad: false,
    mirrorRow: false,
    mirrorCol: false,
    mirrorDiag1: false,
    mirrorDiag2: false,
    mirrorDiagBoth: false,
    mirrorStar: false,
    selection: null,
    selectionSubTool: 'move',
    movePreview: null,
    rotatePreview: null,
    deepEdit: false,
    copySelection: false,
    autoHighlight: true,
    patterns: [],
    activePatternId: null,
    activePatternRotation: 0,
    patternOrigin: null,
    allowBorderConnections: true,
    multiresFill: false,
    excludedFamilies: new Set(['cloud', 'craftsman', 'petal']),
    cloneSourceIndex: null,
    cloneSampleIndex: null,
    cloneAnchorIndex: null,
    cloneCursorIndex: null,
    selectionMode: 'rect',
    pathIndices: new Set(),
    pathLevel: 0,
    pathGeneration: 0,
    pathL0Indices: null,
    resizingCanvas: false,
    activeColorR: 255,
    activeColorG: 255,
    activeColorB: 255,
  };
}

export function createDefaultLayers(
  widthL0: number = 32,
  heightL0: number = 32,
): { layers: Layer[]; activeLayerId: string } {
  const allLayers: { id: string; name: string; level: GridLevel; order: number }[] = [
    { id: 'layer_fg', name: 'Level 1: Fine', level: 1, order: 0 },
    { id: 'layer_mid', name: 'Level 2: Medium', level: 2, order: 1 },
    { id: 'layer_bg', name: 'Level 3: Coarse', level: 3, order: 2 },
  ];

  // A dimension has complete cells when it maps to a whole number of cells at that level.
  const hasCompleteCells = (dimL0: number, level: GridLevel) =>
    (dimL0 * CELL_COUNTS[level]) % 32 === 0;

  let order = 0;
  const layers: Layer[] = [];
  for (const def of allLayers) {
    const hasAnyCells = editableCells(widthL0, def.level) >= 1 &&
      editableCells(heightL0, def.level) >= 1;
    // Exclude L3 if it would have fractional cells
    const complete = def.level !== 3 ||
      (hasCompleteCells(widthL0, def.level) && hasCompleteCells(heightL0, def.level));
    if (hasAnyCells && complete) {
      layers.push(createLayer(def.id, def.name, def.level, order++));
    }
  }

  // Prefer the highest layer where both dimensions have an even number of complete cells,
  // enabling symmetric subdivision. Fall back to the highest layer with only complete cells.
  const defaultLayer = layers.findLast(l =>
    hasCompleteCells(widthL0, l.level) &&
    hasCompleteCells(heightL0, l.level) &&
    editableCells(widthL0, l.level) % 2 === 0 &&
    editableCells(heightL0, l.level) % 2 === 0
  ) ?? layers.findLast(l =>
    hasCompleteCells(widthL0, l.level) &&
    hasCompleteCells(heightL0, l.level)
  ) ?? layers[0];

  return {
    layers,
    activeLayerId: defaultLayer?.id ?? 'layer_fg',
  };
}

/** L2 if the figure's L0 dimensions yield whole L2 cells in both axes; else L1.
 *  Used by the Composer's Create tool to choose the figure's default active layer. */
export function pickCreateToolDefaultLayerLevel(
  widthL0: number,
  heightL0: number,
): GridLevel {
  const cleanAtL2 =
    (widthL0 * CELL_COUNTS[2]) % 32 === 0 &&
    (heightL0 * CELL_COUNTS[2]) % 32 === 0;
  return cleanAtL2 ? 2 : 1;
}

/** Per-axis half-cell shift that aligns the given level's grid with the
 *  centered, L1-snapped clip box used for sub-32 L0 figures. Mirrors the
 *  clip-box origin math in EditorScreen so the chosen layer's cells sit
 *  flush against the clip-box edges instead of being half-clipped. */
export function pickCreateToolLayerShift(
  widthL0: number,
  heightL0: number,
  level: GridLevel,
): { shiftX: 0 | 0.5; shiftY: 0 | 0.5 } {
  if (level === 0) return { shiftX: 0, shiftY: 0 };
  const cx = widthL0 >= 32 ? 0 : Math.floor((32 - widthL0) / 4) * 2;
  const cy = heightL0 >= 32 ? 0 : Math.floor((32 - heightL0) / 4) * 2;
  const cellL0 = 32 / CELL_COUNTS[level];
  const half = cellL0 / 2;
  const shiftX: 0 | 0.5 = cx % cellL0 === half ? 0.5 : 0;
  const shiftY: 0 | 0.5 = cy % cellL0 === half ? 0.5 : 0;
  return { shiftX, shiftY };
}
