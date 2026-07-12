import { editorReducer, createDefaultLayers, pickCreateToolDefaultLayerLevel, pickCreateToolLayerShift } from '../state';
import { applyCellEdit, snapshotLayer, applyOps, revertOps } from '../cells';
import {
  EditorState,
  CellState,
  ClipBox,
  GridLevel,
  LAYER_PX,
  CELL_COUNTS,
  Selection,
  Pattern,
  UndoOp,
  makeViewport,
} from '../types';
import { makeLayer, makeState } from './test-utils';

const color = (r: number, g = 0, b = 0): CellState => ({
  type: 'color',
  r, g, b,
  transform: { mirrorH: false, mirrorV: false, rotation: 0 },
});

describe('editorReducer', () => {
  // ── APPLY_TOOL ───────────────────────────────────────────────────────

  describe('APPLY_TOOL', () => {
    test('applies cell edit, sets dirtyRects, updates lastCellEdits', () => {
      const layer = makeLayer('l', 2, 0); // 8x8, cellPx=256
      const state = makeState([layer]);
      const next = editorReducer(state, { type: 'APPLY_TOOL', cellX: 1, cellY: 2 });

      expect(next.layers[0].cells[2][1]).not.toBeNull();
      expect(next.layers[0].dirtyRectCount).toBeGreaterThan(0);
      expect(next.lastCellEdits).toHaveLength(1);
      expect(next.renderGeneration).toBe(state.renderGeneration + 1);
    });

    test('returns state unchanged when activeLayerId not found', () => {
      const state = makeState([makeLayer('l', 2, 0)], { activeLayerId: 'missing' });
      const next = editorReducer(state, { type: 'APPLY_TOOL', cellX: 0, cellY: 0 });
      expect(next).toBe(state);
    });

    test('second dispatch accumulates dirtyRects', () => {
      const layer = makeLayer('l', 2, 0); // cellPx=256
      const state = makeState([layer]);
      const s1 = editorReducer(state, { type: 'APPLY_TOOL', cellX: 0, cellY: 0 });
      const s2 = editorReducer(s1, { type: 'APPLY_TOOL', cellX: 7, cellY: 7 });

      // Two individual cell rects should be accumulated
      expect(s2.layers[0].dirtyRectCount).toBeGreaterThanOrEqual(1);
    });

    test('uses explicit cellState when provided', () => {
      const layer = makeLayer('l', 2, 0);
      const state = makeState([layer]);
      const cs = color(42, 43, 44);
      const next = editorReducer(state, { type: 'APPLY_TOOL', cellX: 0, cellY: 0, cellState: cs });
      const cell = next.layers[0].cells[0][0];
      expect(cell?.type === 'color' && cell.r).toBe(42);
    });
  });

  // ── SET_ACTIVE_LAYER ─────────────────────────────────────────────────

  describe('SET_ACTIVE_LAYER', () => {
    test('updates activeLayerId', () => {
      const state = makeState([makeLayer('a', 2, 0), makeLayer('b', 1, 1)]);
      const next = editorReducer(state, { type: 'SET_ACTIVE_LAYER', layerId: 'b' });
      expect(next.activeLayerId).toBe('b');
    });

    test('clears selection when switching to coarser layer', () => {
      const state = makeState([makeLayer('fine', 0, 0), makeLayer('coarse', 2, 1)], {
        activeLayerId: 'fine',
        selection: { startCellX: 0, startCellY: 0, endCellX: 1, endCellY: 1, level: 0 as GridLevel },
      });
      const next = editorReducer(state, { type: 'SET_ACTIVE_LAYER', layerId: 'coarse' });
      expect(next.selection).toBeNull();
      expect(next.movePreview).toBeNull();
      expect(next.rotatePreview).toBeNull();
    });

    test('keeps selection when switching to finer layer', () => {
      const sel: Selection = { startCellX: 0, startCellY: 0, endCellX: 1, endCellY: 1, level: 2 as GridLevel };
      const state = makeState([makeLayer('coarse', 2, 0), makeLayer('fine', 0, 1)], {
        activeLayerId: 'coarse',
        selection: sel,
      });
      const next = editorReducer(state, { type: 'SET_ACTIVE_LAYER', layerId: 'fine' });
      expect(next.selection).toEqual(sel);
    });
  });

  // ── SET_TOOL ─────────────────────────────────────────────────────────

  describe('SET_TOOL', () => {
    test('updates tool', () => {
      const state = makeState();
      const next = editorReducer(state, { type: 'SET_TOOL', tool: { type: 'erase' } });
      expect(next.tool.type).toBe('erase');
    });

    test('clears selection when switching away from select', () => {
      const state = makeState(undefined, {
        tool: { type: 'select' },
        selection: { startCellX: 0, startCellY: 0, endCellX: 1, endCellY: 1, level: 0 as GridLevel },
        movePreview: { deltaCellX: 1, deltaCellY: 0 },
        rotatePreview: { rotation: 90 },
      });
      const next = editorReducer(state, { type: 'SET_TOOL', tool: { type: 'color', colorIndex: 0 } });
      expect(next.selection).toBeNull();
      expect(next.movePreview).toBeNull();
      expect(next.rotatePreview).toBeNull();
    });

    test('keeps selection when switching to select', () => {
      const sel: Selection = { startCellX: 0, startCellY: 0, endCellX: 1, endCellY: 1, level: 0 as GridLevel };
      const state = makeState(undefined, {
        tool: { type: 'color', colorIndex: 0 },
        selection: sel,
      });
      const next = editorReducer(state, { type: 'SET_TOOL', tool: { type: 'select' } });
      expect(next.selection).toEqual(sel);
    });
  });

  // ── ADD_LAYER ────────────────────────────────────────────────────────

  describe('ADD_LAYER', () => {
    test('creates layer with correct level, cells, order, and sets it active', () => {
      const state = makeState([makeLayer('existing', 2, 0)]);
      const next = editorReducer(state, { type: 'ADD_LAYER', level: 1 });

      expect(next.layers).toHaveLength(2);
      const added = next.layers[1];
      expect(added.level).toBe(1);
      expect(added.cells.length).toBe(CELL_COUNTS[1]);
      // New layers go to the front of the list (lowest order).
      expect(added.order).toBe(-1);
      expect(next.activeLayerId).toBe(added.id);
    });

    test('successive adds keep decreasing order so newest is always first', () => {
      let state = makeState([makeLayer('a', 2, 5)]);
      state = editorReducer(state, { type: 'ADD_LAYER', level: 1 });
      state = editorReducer(state, { type: 'ADD_LAYER', level: 0 });
      const sorted = [...state.layers].sort((x, y) => x.order - y.order);
      expect(sorted[0].id).toBe(state.activeLayerId);
      expect(sorted[sorted.length - 1].id).toBe('a');
    });
  });

  // ── REMOVE_LAYER ─────────────────────────────────────────────────────

  describe('REMOVE_LAYER', () => {
    test('removes layer and reassigns active if removed was active', () => {
      const state = makeState([makeLayer('a', 2, 0), makeLayer('b', 1, 1)], { activeLayerId: 'a' });
      const next = editorReducer(state, { type: 'REMOVE_LAYER', layerId: 'a' });
      expect(next.layers).toHaveLength(1);
      expect(next.layers[0].id).toBe('b');
      expect(next.activeLayerId).toBe('b');
    });

    test('returns state unchanged when removing last layer', () => {
      const state = makeState([makeLayer('only', 2, 0)]);
      const next = editorReducer(state, { type: 'REMOVE_LAYER', layerId: 'only' });
      expect(next).toBe(state);
    });

    test('keeps activeLayerId when removing non-active layer', () => {
      const state = makeState([makeLayer('a', 2, 0), makeLayer('b', 1, 1)], { activeLayerId: 'a' });
      const next = editorReducer(state, { type: 'REMOVE_LAYER', layerId: 'b' });
      expect(next.activeLayerId).toBe('a');
    });
  });

  // ── DUPLICATE_LAYER ──────────────────────────────────────────────────

  describe('DUPLICATE_LAYER', () => {
    test('adds a copy with a new id and name, keeping active layer unchanged', () => {
      const src = makeLayer('a', 2, 0);
      src.name = 'Source';
      applyCellEdit(src, 3, 4, color(10, 20, 30));
      const state = makeState([src, makeLayer('b', 1, 1)], { activeLayerId: 'a' });
      const next = editorReducer(state, { type: 'DUPLICATE_LAYER', layerId: 'a' });

      expect(next.layers).toHaveLength(3);
      const dupe = next.layers[next.layers.length - 1];
      expect(dupe.id).not.toBe('a');
      expect(dupe.name).toBe('Source Copy');
      expect(dupe.level).toBe(src.level);
      const dupeCell = dupe.cells[4][3];
      expect(dupeCell?.type === 'color' && dupeCell.r).toBe(10);
      expect(next.activeLayerId).toBe('a');
    });

    test('new layer order is between source and next layer', () => {
      const state = makeState([makeLayer('a', 2, 0), makeLayer('b', 1, 1)], { activeLayerId: 'a' });
      const next = editorReducer(state, { type: 'DUPLICATE_LAYER', layerId: 'a' });
      const dupe = next.layers[next.layers.length - 1];
      expect(dupe.order).toBeGreaterThan(0);
      expect(dupe.order).toBeLessThan(1);
    });

    test('new layer order is after source when source is last', () => {
      const state = makeState([makeLayer('a', 2, 0), makeLayer('b', 1, 1)], { activeLayerId: 'b' });
      const next = editorReducer(state, { type: 'DUPLICATE_LAYER', layerId: 'b' });
      const dupe = next.layers[next.layers.length - 1];
      expect(dupe.order).toBeGreaterThan(1);
    });

    test('duplicate has independent cell arrays and pixel buffers', () => {
      const src = makeLayer('a', 2, 0);
      applyCellEdit(src, 0, 0, color(1, 2, 3));
      const state = makeState([src]);
      const next = editorReducer(state, { type: 'DUPLICATE_LAYER', layerId: 'a' });
      const dupe = next.layers[1];

      expect(dupe.cells).not.toBe(src.cells);
      expect(dupe.data).not.toBe(src.data);

      applyCellEdit(dupe, 1, 1, color(99, 99, 99));
      expect(src.cells[1][1]).toBeNull();
    });

    test('returns state unchanged when layerId not found', () => {
      const state = makeState([makeLayer('a', 2, 0)]);
      const next = editorReducer(state, { type: 'DUPLICATE_LAYER', layerId: 'missing' });
      expect(next).toBe(state);
    });
  });

  // ── TOGGLE_LAYER_VISIBILITY ──────────────────────────────────────────

  test('TOGGLE_LAYER_VISIBILITY toggles visible boolean', () => {
    const state = makeState([makeLayer('a', 2, 0)]);
    expect(state.layers[0].visible).toBe(true);
    const next = editorReducer(state, { type: 'TOGGLE_LAYER_VISIBILITY', layerId: 'a' });
    expect(next.layers[0].visible).toBe(false);
    const next2 = editorReducer(next, { type: 'TOGGLE_LAYER_VISIBILITY', layerId: 'a' });
    expect(next2.layers[0].visible).toBe(true);
  });

  // ── PAN ──────────────────────────────────────────────────────────────

  test('PAN adds dx/dy to camera offsets', () => {
    const state = makeState(undefined, { camera: { offsetX: 10, offsetY: 20, zoom: 1 } });
    const next = editorReducer(state, { type: 'PAN', dx: 5, dy: -3 });
    expect(next.camera.offsetX).toBe(15);
    expect(next.camera.offsetY).toBe(17);
  });

  // ── ZOOM ─────────────────────────────────────────────────────────────

  describe('ZOOM', () => {
    test('applies delta to zoom', () => {
      const state = makeState(undefined, { camera: { offsetX: 0, offsetY: 0, zoom: 1 } });
      const next = editorReducer(state, { type: 'ZOOM', delta: 0.5, centerX: 0, centerY: 0 });
      expect(next.camera.zoom).toBe(1.5);
    });

    test('clamps zoom to min 0.1', () => {
      const state = makeState(undefined, { camera: { offsetX: 0, offsetY: 0, zoom: 0.2 } });
      const next = editorReducer(state, { type: 'ZOOM', delta: -1, centerX: 0, centerY: 0 });
      expect(next.camera.zoom).toBeCloseTo(0.1);
    });

    test('clamps zoom to max 10', () => {
      const state = makeState(undefined, { camera: { offsetX: 0, offsetY: 0, zoom: 9.5 } });
      const next = editorReducer(state, { type: 'ZOOM', delta: 2, centerX: 0, centerY: 0 });
      expect(next.camera.zoom).toBe(10);
    });
  });

  // ── SET_VIEWPORT ─────────────────────────────────────────────────────

  test('SET_VIEWPORT updates viewport dimensions', () => {
    const state = makeState();
    const next = editorReducer(state, { type: 'SET_VIEWPORT', width: 1024, height: 768 });
    expect(next.viewport).toEqual(makeViewport(1024, 768));
  });

  // ── CLEAR_ALL ────────────────────────────────────────────────────────

  test('CLEAR_ALL zeros all pixel data and cells, sets full dirtyRects', () => {
    const layer = makeLayer('l', 2, 0);
    applyCellEdit(layer, 0, 0, color(255));
    const state = makeState([layer]);

    const next = editorReducer(state, { type: 'CLEAR_ALL' });
    const l = next.layers[0];
    expect(l.cells[0][0]).toBeNull();
    expect(l.data[0]).toBe(0);
    expect(l.dirtyRectCount).toBe(1);
    expect(l.dirtyRects[0]).toEqual({ x: 0, y: 0, width: LAYER_PX, height: LAYER_PX });
  });

  test('CLEAR_ALL skips locked layers', () => {
    const unlocked = makeLayer('u', 2, 0);
    const locked = makeLayer('k', 2, 1);
    applyCellEdit(unlocked, 0, 0, color(255));
    applyCellEdit(locked, 0, 0, color(100));
    locked.locked = true;
    const state = makeState([unlocked, locked]);

    const next = editorReducer(state, { type: 'CLEAR_ALL' });
    expect(next.layers[0].cells[0][0]).toBeNull();
    expect(next.layers[1].cells[0][0]).not.toBeNull();
  });

  // ── FLOOD_FILL ───────────────────────────────────────────────────────

  test('FLOOD_FILL applies batch cell edits and sets full dirtyRects', () => {
    const layer = makeLayer('l', 2, 0);
    const state = makeState([layer]);
    const cs = color(10, 20, 30);
    const next = editorReducer(state, {
      type: 'FLOOD_FILL',
      cellEdits: [
        { cellX: 0, cellY: 0, newState: cs },
        { cellX: 1, cellY: 1, newState: cs },
      ],
    });

    expect(next.layers[0].cells[0][0]).toEqual(cs);
    expect(next.layers[0].cells[1][1]).toEqual(cs);
    expect(next.layers[0].dirtyRectCount).toBe(1);
    expect(next.layers[0].dirtyRects[0]).toEqual({ x: 0, y: 0, width: LAYER_PX, height: LAYER_PX });
    expect(next.lastCellEdits).toHaveLength(2);
  });

  // ── STROKE_START / STROKE_END ────────────────────────────────────────

  test('STROKE_START returns state unchanged', () => {
    const state = makeState();
    expect(editorReducer(state, { type: 'STROKE_START' })).toBe(state);
  });

  test('STROKE_END bumps renderGeneration', () => {
    const state = makeState();
    const next = editorReducer(state, { type: 'STROKE_END' });
    expect(next.renderGeneration).toBe(state.renderGeneration + 1);
  });

  // ── LOAD_STATE ───────────────────────────────────────────────────────

  test('LOAD_STATE replaces layers and activeLayerId', () => {
    const state = makeState([makeLayer('old', 2, 0)]);
    const newLayers = [makeLayer('new1', 0, 0), makeLayer('new2', 1, 1)];
    const next = editorReducer(state, { type: 'LOAD_STATE', layers: newLayers, activeLayerId: 'new2' });

    expect(next.layers).toBe(newLayers);
    expect(next.activeLayerId).toBe('new2');
    expect(next.renderGeneration).toBe(state.renderGeneration + 1);
  });

  // ── CYCLE_MIRROR ────────────────────────────────────────────────────

  test('CYCLE_MIRROR cycles through four states: Off → H → HV → V → Off', () => {
    const state = makeState();

    const expectFlags = (s: EditorState, flags: { mH?: boolean; mV?: boolean; mR?: boolean; mQ?: boolean; mRw?: boolean; mC?: boolean; mD1?: boolean; mD2?: boolean; mDB?: boolean }) => {
      expect(s.mirrorH).toBe(flags.mH ?? false);
      expect(s.mirrorV).toBe(flags.mV ?? false);
      expect(s.mirrorRotate).toBe(flags.mR ?? false);
      expect(s.mirrorQuad).toBe(flags.mQ ?? false);
      expect(s.mirrorRow).toBe(flags.mRw ?? false);
      expect(s.mirrorCol).toBe(flags.mC ?? false);
      expect(s.mirrorDiag1).toBe(flags.mD1 ?? false);
      expect(s.mirrorDiag2).toBe(flags.mD2 ?? false);
      expect(s.mirrorDiagBoth).toBe(flags.mDB ?? false);
    };

    // Off → H
    const s1 = editorReducer(state, { type: 'CYCLE_MIRROR' });
    expectFlags(s1, { mH: true });

    // H → HV
    const s2 = editorReducer(s1, { type: 'CYCLE_MIRROR' });
    expectFlags(s2, { mH: true, mV: true });

    // HV → V
    const s3 = editorReducer(s2, { type: 'CYCLE_MIRROR' });
    expectFlags(s3, { mV: true });

    // V → Off
    const s4 = editorReducer(s3, { type: 'CYCLE_MIRROR' });
    expectFlags(s4, {});
  });

  test('CYCLE_MIRROR resets non-cycle states (from modal) to Off', () => {
    const state = { ...makeState(), mirrorRotate: true };
    const s1 = editorReducer(state, { type: 'CYCLE_MIRROR' });
    expect(s1.mirrorRotate).toBe(false);
    expect(s1.mirrorH).toBe(false);
    expect(s1.mirrorV).toBe(false);
  });

  // ── SET_MIRROR ──────────────────────────────────────────────────────

  test('SET_MIRROR sets all mirror flags directly', () => {
    const state = makeState();
    const next = editorReducer(state, {
      type: 'SET_MIRROR',
      mirrorH: false, mirrorV: false, mirrorRotate: false,
      mirrorQuad: true, mirrorRow: false, mirrorCol: false,
      mirrorDiag1: false, mirrorDiag2: false, mirrorDiagBoth: false,
      mirrorStar: false,
    });
    expect(next.mirrorQuad).toBe(true);
    expect(next.mirrorH).toBe(false);
    expect(next.renderGeneration).toBe(state.renderGeneration + 1);
  });

  test('SET_MIRROR can turn all flags off', () => {
    const state = makeState(undefined, { mirrorH: true, mirrorV: true });
    const next = editorReducer(state, {
      type: 'SET_MIRROR',
      mirrorH: false, mirrorV: false, mirrorRotate: false,
      mirrorQuad: false, mirrorRow: false, mirrorCol: false,
      mirrorDiag1: false, mirrorDiag2: false, mirrorDiagBoth: false,
      mirrorStar: false,
    });
    expect(next.mirrorH).toBe(false);
    expect(next.mirrorV).toBe(false);
  });

  // ── SET_SELECTION ────────────────────────────────────────────────────

  test('SET_SELECTION sets selection and clears previews', () => {
    const state = makeState(undefined, {
      movePreview: { deltaCellX: 1, deltaCellY: 0 },
      rotatePreview: { rotation: 90 },
    });
    const sel: Selection = { startCellX: 0, startCellY: 0, endCellX: 3, endCellY: 3, level: 2 as GridLevel };
    const next = editorReducer(state, { type: 'SET_SELECTION', selection: sel });
    expect(next.selection).toEqual(sel);
    expect(next.movePreview).toBeNull();
    expect(next.rotatePreview).toBeNull();
  });

  // ── SET_SELECTION_SUB_TOOL ───────────────────────────────────────────

  test('SET_SELECTION_SUB_TOOL updates selectionSubTool', () => {
    const state = makeState();
    const next = editorReducer(state, { type: 'SET_SELECTION_SUB_TOOL', subTool: 'rotate' });
    expect(next.selectionSubTool).toBe('rotate');
  });

  // ── SET_MOVE_PREVIEW / SET_ROTATE_PREVIEW ────────────────────────────

  test('SET_MOVE_PREVIEW sets preview and bumps renderGeneration', () => {
    const state = makeState();
    const preview = { deltaCellX: 2, deltaCellY: -1 };
    const next = editorReducer(state, { type: 'SET_MOVE_PREVIEW', movePreview: preview });
    expect(next.movePreview).toEqual(preview);
    expect(next.renderGeneration).toBe(state.renderGeneration + 1);
  });

  test('SET_ROTATE_PREVIEW sets preview and bumps renderGeneration', () => {
    const state = makeState();
    const preview = { rotation: 180 as const };
    const next = editorReducer(state, { type: 'SET_ROTATE_PREVIEW', rotatePreview: preview });
    expect(next.rotatePreview).toEqual(preview);
    expect(next.renderGeneration).toBe(state.renderGeneration + 1);
  });

  // ── APPLY_SELECTION_EDIT ─────────────────────────────────────────────

  describe('APPLY_SELECTION_EDIT', () => {
    test('applies cross-layer edits and clears selection by default', () => {
      const l1 = makeLayer('l1', 2, 0);
      const l2 = makeLayer('l2', 1, 1);
      const state = makeState([l1, l2], {
        selection: { startCellX: 0, startCellY: 0, endCellX: 1, endCellY: 1, level: 2 as GridLevel },
      });
      const cs = color(50, 60, 70);
      const next = editorReducer(state, {
        type: 'APPLY_SELECTION_EDIT',
        cellEdits: [
          { layerId: 'l1', cellX: 0, cellY: 0, newState: cs },
          { layerId: 'l2', cellX: 0, cellY: 0, newState: cs },
        ],
      });

      expect(next.layers[0].cells[0][0]).toEqual(cs);
      expect(next.layers[1].cells[0][0]).toEqual(cs);
      expect(next.selection).toBeNull();
      expect(next.movePreview).toBeNull();
      expect(next.rotatePreview).toBeNull();
    });

    test('keeps selection when keepSelection is true', () => {
      const sel: Selection = { startCellX: 0, startCellY: 0, endCellX: 1, endCellY: 1, level: 2 as GridLevel };
      const state = makeState([makeLayer('l', 2, 0)], { selection: sel });
      const next = editorReducer(state, {
        type: 'APPLY_SELECTION_EDIT',
        cellEdits: [{ layerId: 'l', cellX: 0, cellY: 0, newState: color(1) }],
        keepSelection: true,
      });
      expect(next.selection).toEqual(sel);
    });
  });

  // ── TOGGLE_DEEP_EDIT ─────────────────────────────────────────────────

  test('TOGGLE_DEEP_EDIT toggles deepEdit boolean', () => {
    const state = makeState(undefined, { deepEdit: true });
    const next = editorReducer(state, { type: 'TOGGLE_DEEP_EDIT' });
    expect(next.deepEdit).toBe(false);
    const next2 = editorReducer(next, { type: 'TOGGLE_DEEP_EDIT' });
    expect(next2.deepEdit).toBe(true);
  });

  // ── TOGGLE_COPY_SELECTION / SET_COPY_SELECTION ──────────────────────

  test('TOGGLE_COPY_SELECTION toggles copySelection boolean', () => {
    const state = makeState(undefined, { copySelection: false });
    const next = editorReducer(state, { type: 'TOGGLE_COPY_SELECTION' });
    expect(next.copySelection).toBe(true);
    const next2 = editorReducer(next, { type: 'TOGGLE_COPY_SELECTION' });
    expect(next2.copySelection).toBe(false);
  });

  test('SET_COPY_SELECTION sets copySelection to the given value', () => {
    const state = makeState(undefined, { copySelection: false });
    const next = editorReducer(state, { type: 'SET_COPY_SELECTION', value: true });
    expect(next.copySelection).toBe(true);
    const next2 = editorReducer(next, { type: 'SET_COPY_SELECTION', value: false });
    expect(next2.copySelection).toBe(false);
  });

  // ── Layer locking ──────────────────────────────────────────────────

  describe('Layer locking', () => {
    test('TOGGLE_LAYER_LOCK toggles locked boolean', () => {
      const layer = makeLayer('l', 2, 0);
      const state = makeState([layer]);
      expect(state.layers[0].locked).toBe(false);
      const next = editorReducer(state, { type: 'TOGGLE_LAYER_LOCK', layerId: 'l' });
      expect(next.layers[0].locked).toBe(true);
      const next2 = editorReducer(next, { type: 'TOGGLE_LAYER_LOCK', layerId: 'l' });
      expect(next2.layers[0].locked).toBe(false);
    });

    test('APPLY_TOOL returns state unchanged when active layer is locked', () => {
      const layer = makeLayer('l', 2, 0);
      layer.locked = true;
      const state = makeState([layer]);
      const next = editorReducer(state, { type: 'APPLY_TOOL', cellX: 0, cellY: 0 });
      expect(next).toBe(state);
      expect(next.layers[0].cells[0][0]).toBeNull();
    });

    test('FLOOD_FILL returns state unchanged when active layer is locked', () => {
      const layer = makeLayer('l', 2, 0);
      layer.locked = true;
      const state = makeState([layer]);
      const cs = color(10, 20, 30);
      const next = editorReducer(state, {
        type: 'FLOOD_FILL',
        cellEdits: [{ cellX: 0, cellY: 0, newState: cs }],
      });
      expect(next).toBe(state);
      expect(next.layers[0].cells[0][0]).toBeNull();
    });

    test('APPLY_TOOL still works on unlocked layer', () => {
      const layer = makeLayer('l', 2, 0);
      const state = makeState([layer]);
      const next = editorReducer(state, { type: 'APPLY_TOOL', cellX: 0, cellY: 0 });
      expect(next.layers[0].cells[0][0]).not.toBeNull();
    });
  });

  // ── Hidden layer is not editable ─────────────────────────────────

  describe('Hidden layer editing', () => {
    test('APPLY_TOOL returns state unchanged when active layer is hidden', () => {
      const layer = makeLayer('l', 2, 0);
      layer.visible = false;
      const state = makeState([layer]);
      const next = editorReducer(state, { type: 'APPLY_TOOL', cellX: 0, cellY: 0 });
      expect(next).toBe(state);
      expect(next.layers[0].cells[0][0]).toBeNull();
    });

    test('FLOOD_FILL returns state unchanged when active layer is hidden', () => {
      const layer = makeLayer('l', 2, 0);
      layer.visible = false;
      const state = makeState([layer]);
      const cs = color(10, 20, 30);
      const next = editorReducer(state, {
        type: 'FLOOD_FILL',
        cellEdits: [{ cellX: 0, cellY: 0, newState: cs }],
      });
      expect(next).toBe(state);
      expect(next.layers[0].cells[0][0]).toBeNull();
    });

    test('SIMPLE_FILL returns state unchanged when active layer is hidden', () => {
      const layer = makeLayer('l', 2, 0);
      layer.visible = false;
      const state = makeState([layer]);
      const cs = color(10, 20, 30);
      const next = editorReducer(state, {
        type: 'SIMPLE_FILL',
        cellEdits: [{ cellX: 0, cellY: 0, newState: cs }],
      });
      expect(next).toBe(state);
      expect(next.layers[0].cells[0][0]).toBeNull();
    });

    test('CLEAR_LAYER returns state unchanged when layer is hidden', () => {
      const layer = makeLayer('l', 2, 0);
      applyCellEdit(layer, 0, 0, color(255));
      layer.visible = false;
      const state = makeState([layer]);
      const next = editorReducer(state, { type: 'CLEAR_LAYER', layerId: 'l' });
      expect(next).toBe(state);
      expect(next.layers[0].cells[0][0]).not.toBeNull();
    });

    test('CLEAR_ALL skips hidden layers', () => {
      const visible = makeLayer('v', 2, 0);
      const hidden = makeLayer('h', 2, 1);
      applyCellEdit(visible, 0, 0, color(255));
      applyCellEdit(hidden, 0, 0, color(100));
      hidden.visible = false;
      const state = makeState([visible, hidden]);

      const next = editorReducer(state, { type: 'CLEAR_ALL' });
      expect(next.layers[0].cells[0][0]).toBeNull();
      expect(next.layers[1].cells[0][0]).not.toBeNull();
    });
  });

  // ── TOGGLE_LAYER_SHIFT ──────────────────────────────────────────────

  describe('TOGGLE_LAYER_SHIFT', () => {
    test('toggles shift 0 → 0.5 and rebuilds pixels', () => {
      const layer = makeLayer('l', 1, 0); // L1
      applyCellEdit(layer, 0, 0, color(100));
      const state = makeState([layer]);

      const next = editorReducer(state, { type: 'TOGGLE_LAYER_SHIFT', layerId: 'l', axis: 'x' });
      expect(next.layers[0].shiftX).toBe(0.5);
      expect(next.layers[0].dirtyRectCount).toBe(1);
    expect(next.layers[0].dirtyRects[0]).toEqual({ x: 0, y: 0, width: LAYER_PX, height: LAYER_PX });
    });

    test('toggles shift 0.5 → 0', () => {
      const layer = makeLayer('l', 1, 0);
      layer.shiftX = 0.5;
      const state = makeState([layer]);

      const next = editorReducer(state, { type: 'TOGGLE_LAYER_SHIFT', layerId: 'l', axis: 'x' });
      expect(next.layers[0].shiftX).toBe(0);
    });

    test('clears selection when toggling active layer shift', () => {
      const layer = makeLayer('l', 1, 0);
      const state = makeState([layer], {
        selection: { startCellX: 0, startCellY: 0, endCellX: 1, endCellY: 1, level: 1 as GridLevel },
      });

      const next = editorReducer(state, { type: 'TOGGLE_LAYER_SHIFT', layerId: 'l', axis: 'x' });
      expect(next.selection).toBeNull();
    });

    test('returns state unchanged for L0 layer', () => {
      const layer = makeLayer('l', 0, 0);
      const state = makeState([layer]);
      const next = editorReducer(state, { type: 'TOGGLE_LAYER_SHIFT', layerId: 'l', axis: 'x' });
      expect(next).toBe(state);
    });

    test('toggles y axis independently', () => {
      const layer = makeLayer('l', 1, 0);
      const state = makeState([layer]);
      const next = editorReducer(state, { type: 'TOGGLE_LAYER_SHIFT', layerId: 'l', axis: 'y' });
      expect(next.layers[0].shiftY).toBe(0.5);
      expect(next.layers[0].shiftX).toBe(0);
    });
  });

  // ── Pattern reducer tests ──────────────────────────────────────────

  describe('Pattern actions', () => {
    const testPattern: Pattern = {
      id: 'p1',
      name: 'Test Pattern',
      coarsestLevel: 2,
      pxWidth: 256,
      pxHeight: 256,
      entries: [{ level: 2, pxOffX: 0, pxOffY: 0, state: color(42) }],
    };

    test('ADD_PATTERN adds pattern and sets activePatternId', () => {
      const state = makeState();
      const next = editorReducer(state, { type: 'ADD_PATTERN', pattern: testPattern });
      expect(next.patterns).toHaveLength(1);
      expect(next.patterns[0].id).toBe('p1');
      expect(next.activePatternId).toBe('p1');
      expect(next.activePatternRotation).toBe(0);
      expect(next.patternOrigin).toBeNull();
    });

    test('REMOVE_PATTERN removes pattern and clears activePatternId', () => {
      const state = makeState(undefined, {
        patterns: [testPattern],
        activePatternId: 'p1',
      });
      const next = editorReducer(state, { type: 'REMOVE_PATTERN', patternId: 'p1' });
      expect(next.patterns).toHaveLength(0);
      expect(next.activePatternId).toBeNull();
    });

    test('SET_ACTIVE_PATTERN updates activePatternId and resets rotation', () => {
      const state = makeState(undefined, {
        patterns: [testPattern],
        activePatternId: null,
        activePatternRotation: 90,
        patternOrigin: { cellX: 1, cellY: 1 },
      });
      const next = editorReducer(state, { type: 'SET_ACTIVE_PATTERN', patternId: 'p1' });
      expect(next.activePatternId).toBe('p1');
      expect(next.activePatternRotation).toBe(0);
      expect(next.patternOrigin).toBeNull();
    });

    test('SET_PATTERN_ROTATION updates rotation', () => {
      const state = makeState(undefined, { activePatternRotation: 0 });
      const next = editorReducer(state, { type: 'SET_PATTERN_ROTATION', rotation: 90 });
      expect(next.activePatternRotation).toBe(90);
    });

    test('APPLY_PATTERN applies cross-layer cell edits', () => {
      const l1 = makeLayer('l1', 2, 0);
      const l2 = makeLayer('l2', 1, 1);
      const state = makeState([l1, l2]);
      const cs = color(50);
      const next = editorReducer(state, {
        type: 'APPLY_PATTERN',
        cellEdits: [
          { layerId: 'l1', cellX: 0, cellY: 0, newState: cs },
          { layerId: 'l2', cellX: 0, cellY: 0, newState: cs },
        ],
      });
      expect(next.layers[0].cells[0][0]).toEqual(cs);
      expect(next.layers[1].cells[0][0]).toEqual(cs);
      expect(next.renderGeneration).toBe(state.renderGeneration + 1);
    });

    test('SET_TOOL clears pattern state when switching away from pattern', () => {
      const state = makeState(undefined, {
        tool: { type: 'pattern' },
        patterns: [testPattern],
        activePatternId: 'p1',
        activePatternRotation: 90,
        patternOrigin: { cellX: 0, cellY: 0 },
      });
      const next = editorReducer(state, { type: 'SET_TOOL', tool: { type: 'color', colorIndex: 0 } });
      expect(next.activePatternId).toBeNull();
      expect(next.patternOrigin).toBeNull();
      expect(next.activePatternRotation).toBe(0);
    });
  });

  // ── CLEAR_LAYER ──────────────────────────────────────────────────────

  describe('CLEAR_LAYER', () => {
    test('clears all cells and pixel data', () => {
      const layer = makeLayer('l', 2, 0);
      applyCellEdit(layer, 0, 0, color(255));
      applyCellEdit(layer, 1, 1, color(100, 200, 50));
      const state = makeState([layer]);

      const next = editorReducer(state, { type: 'CLEAR_LAYER', layerId: 'l' });
      const l = next.layers[0];
      expect(l.cells[0][0]).toBeNull();
      expect(l.cells[1][1]).toBeNull();
      expect(l.data[0]).toBe(0);
      expect(l.dirtyRectCount).toBe(1);
    expect(l.dirtyRects[0]).toEqual({ x: 0, y: 0, width: LAYER_PX, height: LAYER_PX });
      expect(next.renderGeneration).toBe(state.renderGeneration + 1);
    });

    test('returns state unchanged for missing layer', () => {
      const state = makeState([makeLayer('l', 2, 0)]);
      const next = editorReducer(state, { type: 'CLEAR_LAYER', layerId: 'nonexistent' });
      expect(next).toBe(state);
    });

    test('undo via revertOps restores cells', () => {
      const layer = makeLayer('l', 2, 0);
      applyCellEdit(layer, 0, 0, color(255));
      applyCellEdit(layer, 1, 1, color(100));
      const snapshot = snapshotLayer(layer);
      const state = makeState([layer]);

      // Clear it
      const cleared = editorReducer(state, { type: 'CLEAR_LAYER', layerId: 'l' });
      expect(cleared.layers[0].cells[0][0]).toBeNull();

      // Revert
      const ops: UndoOp[] = [{ op: 'clearLayer', layerId: 'l', layerSnapshot: snapshot }];
      const reverted = revertOps(cleared, ops);
      expect(reverted.layers[0].cells[0][0]).not.toBeNull();
      expect(reverted.layers[0].cells[1][1]).not.toBeNull();
    });

    test('redo via applyOps clears cells again', () => {
      const layer = makeLayer('l', 2, 0);
      applyCellEdit(layer, 0, 0, color(255));
      const snapshot = snapshotLayer(layer);
      const state = makeState([layer]);

      // Clear, revert, then re-apply
      const cleared = editorReducer(state, { type: 'CLEAR_LAYER', layerId: 'l' });
      const ops: UndoOp[] = [{ op: 'clearLayer', layerId: 'l', layerSnapshot: snapshot }];
      const reverted = revertOps(cleared, ops);
      expect(reverted.layers[0].cells[0][0]).not.toBeNull();

      const reapplied = applyOps(reverted, ops);
      expect(reapplied.layers[0].cells[0][0]).toBeNull();
    });

    test('does not clear a locked layer', () => {
      const layer = makeLayer('l', 2, 0);
      applyCellEdit(layer, 0, 0, color(255));
      layer.locked = true;
      const state = makeState([layer]);

      const next = editorReducer(state, { type: 'CLEAR_LAYER', layerId: 'l' });
      expect(next).toBe(state);
      expect(next.layers[0].cells[0][0]).not.toBeNull();
    });
  });

  // ── toggleVisibility undo round-trip ─────────────────────────────────

  test('toggleVisibility undo round-trip via revertOps/applyOps', () => {
    const layer = makeLayer('l', 2, 0);
    const state = makeState([layer]);
    expect(state.layers[0].visible).toBe(true);

    const ops: UndoOp[] = [{ op: 'toggleVisibility', layerId: 'l', oldVisible: true }];
    const applied = applyOps(state, ops);
    expect(applied.layers[0].visible).toBe(false);

    const reverted = revertOps(applied, ops);
    expect(reverted.layers[0].visible).toBe(true);
  });

  // ── toggleLock undo round-trip ───────────────────────────────────────

  test('toggleLock undo round-trip via revertOps/applyOps', () => {
    const layer = makeLayer('l', 2, 0);
    const state = makeState([layer]);
    expect(state.layers[0].locked).toBe(false);

    const ops: UndoOp[] = [{ op: 'toggleLock', layerId: 'l', oldLocked: false }];
    const applied = applyOps(state, ops);
    expect(applied.layers[0].locked).toBe(true);

    const reverted = revertOps(applied, ops);
    expect(reverted.layers[0].locked).toBe(false);
  });

  // ── REORDER_LAYER ─────────────────────────────────────────────────────

  describe('REORDER_LAYER', () => {
    test('updates layer order', () => {
      const l1 = makeLayer('a', 0, 0);
      const l2 = makeLayer('b', 1, 1);
      const state = makeState([l1, l2]);
      const next = editorReducer(state, { type: 'REORDER_LAYER', layerId: 'a', newOrder: 5 });
      expect(next.layers.find((l) => l.id === 'a')!.order).toBe(5);
      expect(next.renderGeneration).toBe(state.renderGeneration + 1);
    });

    test('no-op for missing layer', () => {
      const layer = makeLayer('a', 0, 0);
      const state = makeState([layer]);
      const next = editorReducer(state, { type: 'REORDER_LAYER', layerId: 'missing', newOrder: 3 });
      expect(next).toBe(state);
    });

    test('undo round-trip via revertOps/applyOps', () => {
      const layer = makeLayer('a', 0, 0);
      const state = makeState([layer]);
      const ops: UndoOp[] = [{ op: 'reorderLayer', layerId: 'a', oldOrder: 0, newOrder: 5 }];
      const applied = applyOps(state, ops);
      expect(applied.layers[0].order).toBe(5);
      const reverted = revertOps(applied, ops);
      expect(reverted.layers[0].order).toBe(0);
    });
  });

  // ── RENAME_LAYER ──────────────────────────────────────────────────────

  describe('RENAME_LAYER', () => {
    test('updates layer name', () => {
      const layer = makeLayer('a', 0, 0);
      const state = makeState([layer]);
      const next = editorReducer(state, { type: 'RENAME_LAYER', layerId: 'a', name: 'New Name' });
      expect(next.layers[0].name).toBe('New Name');
    });

    test('no-op for missing layer', () => {
      const layer = makeLayer('a', 0, 0);
      const state = makeState([layer]);
      const next = editorReducer(state, { type: 'RENAME_LAYER', layerId: 'missing', name: 'X' });
      expect(next).toBe(state);
    });

    test('undo round-trip via revertOps/applyOps', () => {
      const layer = makeLayer('a', 0, 0);
      layer.name = 'Original';
      const state = makeState([layer]);
      const ops: UndoOp[] = [{ op: 'renameLayer', layerId: 'a', oldName: 'Original', newName: 'Renamed' }];
      const applied = applyOps(state, ops);
      expect(applied.layers[0].name).toBe('Renamed');
      const reverted = revertOps(applied, ops);
      expect(reverted.layers[0].name).toBe('Original');
    });
  });
});

describe('createDefaultLayers', () => {
  test('excludes L3 and falls back to complete cells for 6x6 L0', () => {
    const { activeLayerId, layers } = createDefaultLayers(6, 6);
    // L3: fractional (0.75) → excluded. L2: incomplete. L1: complete (3x3) but odd.
    // Fallback to highest complete: L1
    expect(activeLayerId).toBe('layer_fg'); // L1
    expect(layers).toHaveLength(2); // no L3
  });

  test('selects L3 when it has even complete cell counts (32x32)', () => {
    const { activeLayerId, layers } = createDefaultLayers(32, 32);
    // L3: 4x4 complete+even → select
    expect(activeLayerId).toBe('layer_bg'); // L3
    expect(layers).toHaveLength(3);
  });

  test('selects L2 for 8x8 L0 (L3 complete but odd)', () => {
    const { activeLayerId, layers } = createDefaultLayers(8, 8);
    // L3: 1x1 complete but odd → skip even. L2: 2x2 complete+even → select
    expect(activeLayerId).toBe('layer_mid'); // L2
    expect(layers).toHaveLength(3); // L3 is complete so still included
  });

  test('excludes L3 for 12x12 L0, selects L1 (even+complete)', () => {
    const { activeLayerId, layers } = createDefaultLayers(12, 12);
    // L3: fractional (1.5) → excluded. L2: 3x3 complete but odd. L1: 6x6 complete+even → select
    expect(activeLayerId).toBe('layer_fg'); // L1
    expect(layers).toHaveLength(2); // no L3
  });

  test('selects L3 for 16x16 L0', () => {
    const { activeLayerId, layers } = createDefaultLayers(16, 16);
    // L3: 2x2 complete+even → select
    expect(activeLayerId).toBe('layer_bg'); // L3
    expect(layers).toHaveLength(3);
  });

  test('excludes L3 for asymmetric dimensions (8x6)', () => {
    const { activeLayerId, layers } = createDefaultLayers(8, 6);
    // L3: h fractional (0.75) → excluded. L2: h incomplete. L1: complete (4x3) but h odd.
    // Fallback to highest complete: L1
    expect(activeLayerId).toBe('layer_fg'); // L1
    expect(layers).toHaveLength(2); // no L3
  });

  test('excludes L3 for 12x16 L0, selects L1 (even+complete)', () => {
    const { activeLayerId, layers } = createDefaultLayers(12, 16);
    // L3: fractional (1.5) → excluded. L2: 3x4 complete but w odd. L1: 6x8 complete+even → select
    expect(activeLayerId).toBe('layer_fg'); // L1
    expect(layers).toHaveLength(2); // no L3
  });
});

describe('pickCreateToolDefaultLayerLevel', () => {
  // L2 is clean iff dim * 8 % 32 === 0, i.e. dim is a multiple of 4.
  test('returns L2 when both dims are multiples of 4', () => {
    expect(pickCreateToolDefaultLayerLevel(32, 32)).toBe(2);
    expect(pickCreateToolDefaultLayerLevel(16, 16)).toBe(2);
    expect(pickCreateToolDefaultLayerLevel(12, 12)).toBe(2);
    expect(pickCreateToolDefaultLayerLevel(8, 8)).toBe(2);
    expect(pickCreateToolDefaultLayerLevel(4, 4)).toBe(2);
    expect(pickCreateToolDefaultLayerLevel(20, 20)).toBe(2);
    expect(pickCreateToolDefaultLayerLevel(8, 4)).toBe(2);
  });

  test('returns L1 when either dim is not a multiple of 4', () => {
    expect(pickCreateToolDefaultLayerLevel(10, 10)).toBe(1);
    expect(pickCreateToolDefaultLayerLevel(6, 6)).toBe(1);
    expect(pickCreateToolDefaultLayerLevel(2, 2)).toBe(1);
  });

  test('returns L1 when only one dim is partial at L2 (asymmetric)', () => {
    expect(pickCreateToolDefaultLayerLevel(8, 6)).toBe(1);
    expect(pickCreateToolDefaultLayerLevel(6, 8)).toBe(1);
  });
});

describe('pickCreateToolLayerShift', () => {
  // Clip box origin is floor((32 - dim) / 4) * 2 — an L1-snapped center.
  // L2 cell = 4 L0; shift = 0.5 when origin sits half a cell off the L2 grid.
  test('shifts X only when widthL0 leaves clip box on odd L1 boundary (20×16)', () => {
    // clipX = floor(12/4)*2 = 6, clipY = floor(16/4)*2 = 8
    // 6 % 4 = 2 (half-cell) → shiftX = 0.5; 8 % 4 = 0 → shiftY = 0
    expect(pickCreateToolLayerShift(20, 16, 2)).toEqual({ shiftX: 0.5, shiftY: 0 });
  });

  test('no shift when both dims align cleanly to L2 (16×16)', () => {
    // clipX = 8, clipY = 8; both 8 % 4 == 0
    expect(pickCreateToolLayerShift(16, 16, 2)).toEqual({ shiftX: 0, shiftY: 0 });
  });

  test('shifts both axes when both dims are odd at L2 (20×20)', () => {
    expect(pickCreateToolLayerShift(20, 20, 2)).toEqual({ shiftX: 0.5, shiftY: 0.5 });
  });

  test('shifts Y only when only heightL0 is odd at L2 (16×20)', () => {
    expect(pickCreateToolLayerShift(16, 20, 2)).toEqual({ shiftX: 0, shiftY: 0.5 });
  });

  test('L1 layer never needs a shift (clip box is L1-snapped)', () => {
    expect(pickCreateToolLayerShift(18, 8, 1)).toEqual({ shiftX: 0, shiftY: 0 });
    expect(pickCreateToolLayerShift(10, 10, 1)).toEqual({ shiftX: 0, shiftY: 0 });
    expect(pickCreateToolLayerShift(20, 16, 1)).toEqual({ shiftX: 0, shiftY: 0 });
  });

  test('no shift when figure fills the canvas (32×32)', () => {
    expect(pickCreateToolLayerShift(32, 32, 2)).toEqual({ shiftX: 0, shiftY: 0 });
  });

  test('L0 layer is never shifted', () => {
    expect(pickCreateToolLayerShift(20, 16, 0)).toEqual({ shiftX: 0, shiftY: 0 });
  });
});

describe('SET_CLIP_BOX', () => {
  test('sets clip box on fileConfig', () => {
    const state = makeState();
    const clipBox: ClipBox = { clipL0X: 4, clipL0Y: 4, clipL0W: 8, clipL0H: 8 };
    const next = editorReducer(state, { type: 'SET_CLIP_BOX', clipBox });
    expect(next.fileConfig.clipBox).toEqual(clipBox);
    expect(next.renderGeneration).toBe(state.renderGeneration + 1);
  });

  test('clears clip box when null', () => {
    const state = makeState();
    const clipBox: ClipBox = { clipL0X: 2, clipL0Y: 2, clipL0W: 6, clipL0H: 6 };
    const withClip = editorReducer(state, { type: 'SET_CLIP_BOX', clipBox });
    expect(withClip.fileConfig.clipBox).toEqual(clipBox);

    const cleared = editorReducer(withClip, { type: 'SET_CLIP_BOX', clipBox: null });
    expect(cleared.fileConfig.clipBox).toBeUndefined();
    expect(cleared.renderGeneration).toBe(withClip.renderGeneration + 1);
  });
});
