import {
  applyPatternCellEdits,
  buildPatternLayerView,
  MAX_PATTERN_GRID,
  mintPatternObjectId,
  patternApplyToolAt,
  patternCanvasCfg,
  patternCellAt,
  patternClearEdits,
  patternFloodEdits,
  patternCellTint,
  PATTERN_BASE_INK,
  patternInkColor,
  patternIsEmpty,
  patternRecolorEdits,
  patternReconcileEdits,
  tintedPatternCell,
} from '../patternObject';
import { bakePatternElements, patternSVGView } from '../patternObjectRender';
import { gatherConstraints, getRenderedSignature } from '../connectivity';
import { applyCompOps, revertCompOps, findSceneObjectAtCell, SCENE_ADAPTERS } from '../compositionOps';
import {
  CellState,
  CompositionState,
  DEFAULT_TRANSFORM,
  PatternObject,
  PATTERN_SYMMETRY_OFF,
  makeViewport,
} from '../types';

// ── Helpers ─────────────────────────────────────────────────────────

function makePattern(cols: number, rows: number, over: Partial<PatternObject> = {}): PatternObject {
  return {
    id: 'pat_test',
    cellX: 4, cellY: 6, cellWidth: cols, cellHeight: rows,
    cols, rows,
    cells: new Array(cols * rows).fill(null),
    ...over,
  };
}

function spriteCell(spriteId: string): CellState {
  return { type: 'sprite', spriteId, transform: { ...DEFAULT_TRANSFORM } };
}

function colorCell(r: number, g: number, b: number): CellState {
  return { type: 'color', r, g, b, transform: { ...DEFAULT_TRANSFORM } };
}

function withCell(p: PatternObject, x: number, y: number, state: CellState): PatternObject {
  const cells = p.cells.slice();
  cells[y * p.cols + x] = state;
  return { ...p, cells };
}

/** Every filled sprite cell satisfies its gathered constraints. */
function assertPatternReconciled(p: PatternObject) {
  const layer = buildPatternLayerView(p);
  const cfg = patternCanvasCfg(p);
  for (let y = 0; y < p.rows; y++) {
    for (let x = 0; x < p.cols; x++) {
      const cell = patternCellAt(p, x, y);
      if (!cell || cell.type !== 'sprite') continue;
      const sig = getRenderedSignature(cell);
      if (!sig) continue;
      const constraints = gatherConstraints(
        x, y, layer, [layer], p.allowBorderConnections !== false,
        undefined, cfg.widthL0, cfg.heightL0,
      );
      for (let pt = 0; pt < 8; pt++) {
        expect(constraints[pt] === null || constraints[pt] === sig[pt]).toBe(true);
      }
    }
  }
}

// ── Basics ──────────────────────────────────────────────────────────

describe('pattern object basics', () => {
  test('minted ids use the pat_ namespace', () => {
    expect(mintPatternObjectId().startsWith('pat_')).toBe(true);
  });

  test('grid cap matches the spec', () => {
    expect(MAX_PATTERN_GRID).toBe(16);
  });

  test('empty pattern reports empty; a stamp makes it non-empty', () => {
    const p = makePattern(4, 4);
    expect(patternIsEmpty(p)).toBe(true);
    expect(patternIsEmpty(withCell(p, 1, 2, spriteCell('test/tile_00000000')))).toBe(false);
  });

  test('layer view is a full 16×16 grid with cells placed at their coords', () => {
    const p = withCell(makePattern(3, 2), 2, 1, spriteCell('test/tile_11111111'));
    const layer = buildPatternLayerView(p);
    expect(layer.cells.length).toBe(16);
    expect(layer.cells[1][2]).toEqual(spriteCell('test/tile_11111111'));
    expect(layer.cells[0][0]).toBeNull();
    expect(patternCanvasCfg(p)).toEqual({ widthL0: 6, heightL0: 4, originL0X: 0, originL0Y: 0 });
  });
});

// ── Tool application ────────────────────────────────────────────────

describe('patternApplyToolAt', () => {
  test('tile tool stamps the chosen sprite; erase removes it; no-ops drop', () => {
    let p = makePattern(4, 4);
    const stamp = patternApplyToolAt(p, 1, 2, { kind: 'tile', spriteId: 'test/tile_11111111' });
    expect(stamp).toHaveLength(1);
    expect(stamp[0]).toMatchObject({ index: 9, oldState: null });
    p = applyPatternCellEdits(p, stamp);
    expect(patternCellAt(p, 1, 2)).toMatchObject({ type: 'sprite', spriteId: 'test/tile_11111111' });

    const erase = patternApplyToolAt(p, 1, 2, { kind: 'erase' });
    expect(erase).toHaveLength(1);
    p = applyPatternCellEdits(p, erase);
    expect(patternCellAt(p, 1, 2)).toBeNull();

    // Erasing an already-empty cell is a no-op — no edits, no undo entry.
    expect(patternApplyToolAt(p, 1, 2, { kind: 'erase' })).toHaveLength(0);
  });

  test('out-of-range taps return no edits', () => {
    const p = makePattern(4, 4);
    expect(patternApplyToolAt(p, -1, 0, { kind: 'erase' })).toHaveLength(0);
    expect(patternApplyToolAt(p, 4, 0, { kind: 'erase' })).toHaveLength(0);
  });

  test('random tool picks a sprite compatible with an existing neighbor', () => {
    // tile_10101010 connects N/E/S/W. Stamp it, then random-fill the cell
    // to its east — the pick must connect back on its W midpoint (point 6).
    let p = withCell(makePattern(4, 4), 1, 1, spriteCell('test/tile_10101010'));
    for (let attempt = 0; attempt < 10; attempt++) {
      const edits = patternApplyToolAt(p, 2, 1, { kind: 'random' });
      expect(edits.length).toBeGreaterThan(0);
      const placed = edits[0].newState;
      expect(placed && placed.type === 'sprite').toBe(true);
      const sig = getRenderedSignature(placed);
      if (sig) expect(sig[6]).toBe(true);
    }
  });

  test('random tool with borders disallowed keeps grid-edge points unconnected', () => {
    const p = makePattern(2, 2, { allowBorderConnections: false });
    for (let attempt = 0; attempt < 10; attempt++) {
      const edits = patternApplyToolAt(p, 0, 0, { kind: 'random' });
      const sig = getRenderedSignature(edits[0].newState);
      if (!sig) continue; // unconstrained sprite — always allowed
      // Cell (0,0) of a 2×2 grid: N (0), W (6), and the corners touching
      // the border (NW 7, NE 1, SW 5) must all be false.
      expect(sig[0]).toBe(false);
      expect(sig[6]).toBe(false);
      expect(sig[7]).toBe(false);
    }
  });

  test('mirrorH symmetry stamps the horizontal partner', () => {
    const p = makePattern(4, 4, { symmetry: { ...PATTERN_SYMMETRY_OFF, mirrorH: true } });
    const edits = patternApplyToolAt(p, 0, 1, { kind: 'tile', spriteId: 'test/tile_10001000' });
    expect(edits).toHaveLength(2);
    const indices = edits.map((e) => e.index).sort((a, b) => a - b);
    // (0,1) => 4 and its mirror (3,1) => 7.
    expect(indices).toEqual([4, 7]);
    const mirrored = edits.find((e) => e.index === 7)!.newState;
    expect(mirrored && mirrored.type === 'sprite' && mirrored.transform.mirrorH).toBe(true);
  });
});

// ── Reconcile / clear ───────────────────────────────────────────────

describe('patternReconcileEdits', () => {
  test('fixes a mismatched pair and the result satisfies all constraints', () => {
    // tile_11111111 at (1,1) demands connections all around; its east
    // neighbor tile_00000000 refuses them.
    let p = withCell(makePattern(4, 4), 1, 1, spriteCell('test/tile_11111111'));
    p = withCell(p, 2, 1, spriteCell('test/tile_00000000'));
    const edits = patternReconcileEdits(p);
    expect(edits.length).toBeGreaterThan(0);
    p = applyPatternCellEdits(p, edits);
    assertPatternReconciled(p);
  });

  test('already-consistent grid produces no edits', () => {
    const p = withCell(makePattern(4, 4), 0, 0, spriteCell('test/tile_00000000'));
    expect(patternReconcileEdits(p)).toHaveLength(0);
  });
});

describe('patternFloodEdits', () => {
  test('a specific armed tile REPLACES the grid, placed tiles included', () => {
    let p = withCell(makePattern(3, 3), 1, 1, spriteCell('test/tile_11111111'));
    const edits = patternFloodEdits(p, { kind: 'tile', spriteId: 'test/tile_00000000' });
    expect(edits).toHaveLength(9); // every cell, not just the 8 empties
    // The one placed cell reports its real prior state, so undo restores it.
    const overwritten = edits.find((e) => e.index === 1 * 3 + 1)!;
    expect(overwritten.oldState).toMatchObject({ spriteId: 'test/tile_11111111' });
    p = applyPatternCellEdits(p, edits);
    expect(p.cells.every((c) => c != null)).toBe(true);
    for (const cell of p.cells) {
      expect(cell).toMatchObject({ spriteId: 'test/tile_00000000' });
    }
  });

  test('random flood (and the erase fallback) fills the grid consistently', () => {
    for (const tool of [{ kind: 'random' as const }, { kind: 'erase' as const }]) {
      let p = withCell(makePattern(4, 4), 0, 0, spriteCell('test/tile_00100010'));
      p = applyPatternCellEdits(p, patternFloodEdits(p, tool));
      expect(p.cells.every((c) => c != null)).toBe(true);
      // Every pick was made against the working grid, so the finished
      // grid satisfies its own connectivity constraints.
      assertPatternReconciled(p);
    }
  });

  test('random flood wipes what was there first, rather than filling around it', () => {
    // A free re-roll could land on the seed's sprite by chance, so the
    // wipe is pinned through the tile-set filter: excluding 'test' leaves
    // the mock registry one sprite, every pick is forced, and a surviving
    // seed from the excluded family would be plainly visible.
    const ONLY_TEST2 = new Set(['test']);
    for (const tool of [{ kind: 'random' as const }, { kind: 'erase' as const }]) {
      let p = withCell(makePattern(4, 4), 0, 0, spriteCell('test/tile_00100010'));
      p = applyPatternCellEdits(p, patternFloodEdits(p, tool, ONLY_TEST2));
      for (const cell of p.cells) {
        expect(cell).toMatchObject({ spriteId: 'test2/tile_00100010' });
      }
    }
  });

  test('symmetry flood keeps the mirror: partners carry mirrored states', () => {
    const p = makePattern(4, 1, { symmetry: { ...PATTERN_SYMMETRY_OFF, mirrorH: true } });
    const filled = applyPatternCellEdits(p, patternFloodEdits(p, { kind: 'tile', spriteId: 'test/tile_10001000' }));
    const left = patternCellAt(filled, 0, 0)!;
    const right = patternCellAt(filled, 3, 0)!;
    expect(left.type === 'sprite' && right.type === 'sprite').toBe(true);
    expect((right as { transform: { mirrorH: boolean } }).transform.mirrorH)
      .toBe(!(left as { transform: { mirrorH: boolean } }).transform.mirrorH);
  });

  test('re-flooding the same tile is a no-op; random re-rolls a full grid', () => {
    let p = makePattern(2, 2);
    const tile = { kind: 'tile' as const, spriteId: 'test/tile_00000000' };
    p = applyPatternCellEdits(p, patternFloodEdits(p, tile));
    // Every cell already holds exactly what the flood would write, so the
    // diff comes out empty and the caller builds no undo step.
    expect(patternFloodEdits(p, tile)).toHaveLength(0);
    // Random is not blocked by a full grid the way the old empties-only
    // flood was: it wipes and re-rolls into a consistent grid.
    const rolled = applyPatternCellEdits(p, patternFloodEdits(p, { kind: 'random' }));
    expect(rolled.cells.every((c) => c != null)).toBe(true);
    assertPatternReconciled(rolled);
  });
});

describe('the tile-set filter (excludedFamilies)', () => {
  // The mock registry has two families; excluding 'test' leaves exactly one
  // sprite, so every random pick is forced and the assertions are exact.
  const ONLY_TEST2 = new Set(['test']);

  test('a random brush press never picks from an excluded family', () => {
    const edits = patternApplyToolAt(makePattern(3, 3), 1, 1, { kind: 'random' }, ONLY_TEST2);
    expect(edits).toHaveLength(1);
    expect(edits[0].newState).toMatchObject({ spriteId: 'test2/tile_00100010' });
  });

  test('a random flood fills entirely from the enabled sets', () => {
    const filled = applyPatternCellEdits(
      makePattern(3, 2),
      patternFloodEdits(makePattern(3, 2), { kind: 'random' }, ONLY_TEST2),
    );
    for (const cell of filled.cells) {
      expect(cell).toMatchObject({ spriteId: 'test2/tile_00100010' });
    }
  });

  test('stamping a specific tile ignores the filter', () => {
    const edits = patternApplyToolAt(
      makePattern(2, 2), 0, 0, { kind: 'tile', spriteId: 'test/tile_00000000' }, ONLY_TEST2,
    );
    expect(edits[0].newState).toMatchObject({ spriteId: 'test/tile_00000000' });
  });

  test('reconcile replacements stay inside the enabled sets', () => {
    // The mismatched interior pair from the reconcile suite above — 8-way
    // against blank — forces replacements. With 'test2' excluded, every
    // fix must come from 'test'. (Excluding 'test' instead would leave
    // reconcile with no satisfying candidate, and it fixes nothing — it
    // never erases — which is also the contract.)
    let p = withCell(makePattern(4, 4), 1, 1, spriteCell('test/tile_11111111'));
    p = withCell(p, 2, 1, spriteCell('test/tile_00000000'));
    const edits = patternReconcileEdits(p, false, new Set(['test2']));
    expect(edits.length).toBeGreaterThan(0);
    for (const e of edits) {
      if (e.newState?.type === 'sprite') {
        expect(e.newState.spriteId.startsWith('test/')).toBe(true);
      }
    }
    expect(patternReconcileEdits(p, false, ONLY_TEST2)).toHaveLength(0);
  });
});

describe('patternClearEdits', () => {
  test('clears every filled cell and round-trips through revert', () => {
    let p = withCell(makePattern(3, 3), 0, 0, spriteCell('test/tile_00000000'));
    p = withCell(p, 2, 2, colorCell(10, 20, 30));
    const edits = patternClearEdits(p);
    expect(edits).toHaveLength(2);
    const cleared = applyPatternCellEdits(p, edits);
    expect(patternIsEmpty(cleared)).toBe(true);
    const restored = applyPatternCellEdits(cleared, edits, 'revert');
    expect(restored.cells).toEqual(p.cells);
  });
});

// ── Composition ops integration ─────────────────────────────────────

function makeCompState(patterns: PatternObject[]): CompositionState {
  return {
    id: 'comp', name: 'comp',
    figures: [], svgObjects: [], groups: [],
    patternObjects: patterns,
    sceneOrder: patterns.map((p) => p.id),
    lineDraft: null, arcDraft: null,
    editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
    customColors: [],
    gridLevel: 0, strokeScale: 1, gridIntensity: 1,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(),
    activeFigureKey: null,
    compTool: 'select',
    createRegion: null,
    renderGeneration: 0,
  };
}

describe('composition ops for patterns', () => {
  test('placeObject / removeObject round-trip through the pattern adapter', () => {
    const p = makePattern(4, 4);
    let state = makeCompState([]);
    state = applyCompOps(state, [{ op: 'placeObject', kind: 'pattern', item: p }]);
    expect(state.patternObjects).toHaveLength(1);
    expect(state.sceneOrder).toContain('pat_test');
    state = revertCompOps(state, [{ op: 'placeObject', kind: 'pattern', item: p }]);
    expect(state.patternObjects).toHaveLength(0);
    expect(state.sceneOrder).not.toContain('pat_test');
  });

  test('editPatternCells applies and reverts', () => {
    const p = makePattern(2, 2);
    let state = makeCompState([p]);
    const entry = [{
      op: 'editPatternCells' as const,
      patternId: p.id,
      edits: [{ index: 3, oldState: null, newState: spriteCell('test/tile_00000000') }],
    }];
    state = applyCompOps(state, entry);
    expect(state.patternObjects![0].cells[3]).toMatchObject({ spriteId: 'test/tile_00000000' });
    state = revertCompOps(state, entry);
    expect(state.patternObjects![0].cells[3]).toBeNull();
  });

  test('setPatternSettings applies and reverts both fields', () => {
    const p = makePattern(2, 2);
    let state = makeCompState([p]);
    const sym = { ...PATTERN_SYMMETRY_OFF, mirrorV: true };
    const entry = [{
      op: 'setPatternSettings' as const,
      patternId: p.id,
      oldSymmetry: undefined, newSymmetry: sym,
      oldAllowBorderConnections: undefined, newAllowBorderConnections: false,
    }];
    state = applyCompOps(state, entry);
    expect(state.patternObjects![0].symmetry).toEqual(sym);
    expect(state.patternObjects![0].allowBorderConnections).toBe(false);
    state = revertCompOps(state, entry);
    expect(state.patternObjects![0].symmetry).toBeUndefined();
    expect(state.patternObjects![0].allowBorderConnections).toBeUndefined();
  });

  test('toggleRepeat reaches pattern objects', () => {
    const p = makePattern(2, 2);
    let state = makeCompState([p]);
    state = applyCompOps(state, [{
      op: 'toggleRepeat', figureId: p.id,
      oldTileMode: undefined, oldTileWidthL0: undefined, oldTileHeightL0: undefined,
      oldCellX: p.cellX, oldCellY: p.cellY, oldCellWidth: p.cellWidth, oldCellHeight: p.cellHeight,
      newTileMode: 'repeat', newTileWidthL0: 2, newTileHeightL0: 2,
      newCellX: p.cellX, newCellY: p.cellY, newCellWidth: 8, newCellHeight: 8,
    }]);
    const after = state.patternObjects![0];
    expect(after.tileMode).toBe('repeat');
    expect(after.tileWidthL0).toBe(2);
    expect(after.cellWidth).toBe(8);
  });

  test('an EMPTY pattern is hit-testable as a rectangle', () => {
    const p = makePattern(4, 4); // bbox 4..8 × 6..10
    const state = makeCompState([p]);
    expect(findSceneObjectAtCell(state, 5, 7)).toEqual({ kind: 'pattern', id: 'pat_test' });
    expect(findSceneObjectAtCell(state, 3.5, 7)).toBeNull();
  });

  test('duplicate clones cells without aliasing', () => {
    const adapter = SCENE_ADAPTERS.find((a) => a.kind === 'pattern')!;
    const p = withCell(makePattern(2, 2), 0, 0, spriteCell('test/tile_00000000'));
    const copy = adapter.cloneWithOffset(p, 1, 1, 'pat_copy', undefined) as PatternObject;
    expect(copy.cellX).toBe(p.cellX + 1);
    expect(copy.cells).toEqual(p.cells);
    expect(copy.cells).not.toBe(p.cells);
  });
});

// ── World point → cell ──────────────────────────────────────────────

import { patternCellAtWorldPoint } from '../patternObject';

describe('patternCellAtWorldPoint', () => {
  test('maps a stretch-mode point to its cell; outside → null', () => {
    // 4×2 grid over bbox (4,6)..(12,10): cell size 2×2.
    const p = makePattern(4, 2, { cellWidth: 8, cellHeight: 4 });
    expect(patternCellAtWorldPoint(p, 4.1, 6.1)).toEqual({ x: 0, y: 0 });
    expect(patternCellAtWorldPoint(p, 11.9, 9.9)).toEqual({ x: 3, y: 1 });
    expect(patternCellAtWorldPoint(p, 6.5, 8.5)).toEqual({ x: 1, y: 1 });
    expect(patternCellAtWorldPoint(p, 3.9, 6.1)).toBeNull();
    expect(patternCellAtWorldPoint(p, 4.1, 10.1)).toBeNull();
  });

  test('repeat mode wraps into the tile grid across the region', () => {
    const p = makePattern(2, 2, {
      cellWidth: 8, cellHeight: 8,
      tileMode: 'repeat', tileWidthL0: 2, tileHeightL0: 2,
    });
    // bbox origin (4,6); tile is 2×2 cells of 1×1 each.
    expect(patternCellAtWorldPoint(p, 4.5, 6.5)).toEqual({ x: 0, y: 0 });
    // One tile over (6.5 = 4 + 2 + 0.5) → same cell.
    expect(patternCellAtWorldPoint(p, 6.5, 6.5)).toEqual({ x: 0, y: 0 });
    expect(patternCellAtWorldPoint(p, 7.5, 9.5)).toEqual({ x: 1, y: 1 });
    // Outside the region → null even though modulo would land somewhere.
    expect(patternCellAtWorldPoint(p, 12.5, 6.5)).toBeNull();
  });

  test('inverts a 90° rotation', () => {
    // 4×2 grid rotated 90CW: world bbox is swapped (4 wide → 2... here
    // cellWidth/Height carry the POST-rotation box: 2×4 for a 4×2 grid of
    // unit cells).
    const p = makePattern(4, 2, { cellWidth: 2, cellHeight: 4, rotation: 90 });
    // After 90° CW the content's (0,0) cell renders at the world box's
    // top-RIGHT corner. A point there must map back to cell (0,0).
    const topRight = patternCellAtWorldPoint(p, 4 + 2 - 0.1, 6 + 0.1);
    expect(topRight).toEqual({ x: 0, y: 0 });
    // And the world top-left shows the content's bottom-left cell (0, rows-1).
    const topLeft = patternCellAtWorldPoint(p, 4 + 0.1, 6 + 0.1);
    expect(topLeft).toEqual({ x: 0, y: 1 });
  });

  test('inverts mirrors', () => {
    const p = makePattern(2, 1, { cellWidth: 2, cellHeight: 1, mirrorH: true });
    // MirrorH flips left/right: a point in the world-left half shows the
    // content's RIGHT cell.
    expect(patternCellAtWorldPoint(p, 4.2, 6.5)).toEqual({ x: 1, y: 0 });
    expect(patternCellAtWorldPoint(p, 5.8, 6.5)).toEqual({ x: 0, y: 0 });
  });
});

// ── Stroke: authored width, mode-invariant ──────────────────────────

import { patternViewNodeMarkup } from '../patternObjectRender';
import { SVG_UNITS_PER_L0_CELL } from '../svgExport';

describe('pattern stroke', () => {
  const BASE_PX = 16; // the DOM node layer's px per world cell

  /** Effective on-screen stroke width (in layer px) of the markup every
   *  pattern render site mounts. Both modes stroke in user-space units
   *  (patternViewNodeMarkup — no vector-effect), scaled by the viewBox. */
  function effectivePx(p: PatternObject): number {
    const markup = patternViewNodeMarkup(patternSVGView(p)!, 1);
    // The whole point of the shared convention: NEITHER mode may stroke
    // with non-scaling-stroke, whose width WKWebView resolves against the
    // device CTM — under camera zoom it disagrees with user-space strokes
    // and a repeat toggle visibly changed the line weight.
    expect(markup).not.toContain('non-scaling-stroke');
    const w = Number(markup.match(/stroke-width="([^"]*)"/)![1]);
    return w / (SVG_UNITS_PER_L0_CELL / BASE_PX);
  }

  function inkedPattern(over: Partial<PatternObject> = {}): PatternObject {
    let p = makePattern(2, 2, over);
    p = withCell(p, 0, 0, spriteCell('test/tile_00000000'));
    // The mocked sprite has no vector source; use a color cell for geometry
    // plus a REAL sprite so strokes exist in the markup.
    const cells = p.cells.slice();
    cells[1] = { type: 'sprite', spriteId: 'angular/tile_00000001', transform: { ...DEFAULT_TRANSFORM } };
    return { ...p, cells };
  }

  test('the view carries the authored stroke block', () => {
    const p = inkedPattern({ stroke: { width: 0.25, dash: 3 } });
    expect(patternSVGView(p)!.stroke).toEqual({ width: 0.25, dash: 3 });
  });

  test('toggling repeat does not change the drawn line weight', () => {
    // Authored width: both modes must draw 0.25 cells = 4 layer px.
    const flat = inkedPattern({ stroke: { width: 0.25 } });
    const tiled: PatternObject = { ...flat, tileMode: 'repeat', tileWidthL0: 2, tileHeightL0: 2 };
    expect(effectivePx(flat)).toBeCloseTo(4);
    expect(effectivePx(tiled)).toBeCloseTo(4);
    // Legacy (no stroke block): still equal between the modes.
    const flatLegacy = inkedPattern();
    const tiledLegacy: PatternObject = { ...flatLegacy, tileMode: 'repeat', tileWidthL0: 2, tileHeightL0: 2 };
    expect(effectivePx(tiledLegacy)).toBeCloseTo(effectivePx(flatLegacy));
  });
});

// ── SVG bake ────────────────────────────────────────────────────────

describe('pattern SVG bake', () => {
  test('empty pattern bakes to nothing (renders as an empty rectangle)', () => {
    expect(bakePatternElements(makePattern(4, 4))).toBeNull();
    expect(patternSVGView(makePattern(4, 4))).toBeNull();
  });

  test('color cells bake to filled geometry inside the world bbox', () => {
    const p = withCell(makePattern(2, 2), 0, 0, colorCell(200, 40, 40));
    const view = patternSVGView(p);
    expect(view).not.toBeNull();
    expect(view!.id).toBe(p.id);
    expect(view!.subpaths?.some((s) => s.fill)).toBe(true);
    for (const seg of view!.segments) {
      for (const [x, y] of [seg.start, seg.end]) {
        expect(x).toBeGreaterThanOrEqual(p.cellX - 1e-6);
        expect(x).toBeLessThanOrEqual(p.cellX + p.cellWidth + 1e-6);
        expect(y).toBeGreaterThanOrEqual(p.cellY - 1e-6);
        expect(y).toBeLessThanOrEqual(p.cellY + p.cellHeight + 1e-6);
      }
    }
  });

  // What makes the colour brush work on a pattern at all: the ink lives on
  // the CELL, and the layer the bake reads carries it through — the exporter
  // then writes it into that tile's strokes (svgExport's tint substitution).
  //
  // The substitution itself is not asserted here: a sprite cell bakes to
  // nothing in this environment (no tile SVG sources, which is why the bake
  // tests above use colour cells), so there is no markup to inspect.
  test('a cell’s ink reaches the layer the bake reads', () => {
    const tinted = withCell(
      makePattern(2, 2), 0, 0,
      tintedPatternCell(spriteCell('test/tile_10001000'), { r: 200, g: 40, b: 40 }),
    );
    const cell = buildPatternLayerView(tinted).cells[0][0];
    expect(cell).toMatchObject({
      type: 'sprite', spriteId: 'test/tile_10001000', tintR: 200, tintG: 40, tintB: 40,
    });
  });

  test('tintedPatternCell inks a sprite and refuses anything else', () => {
    const cell = spriteCell('test/tile_00000000');
    expect(patternCellTint(cell)).toBeNull();
    expect(patternCellTint(tintedPatternCell(cell, { r: 1, g: 2, b: 3 })))
      .toEqual({ r: 1, g: 2, b: 3 });
    // A colour cell already IS a colour; an empty one has no tile to ink.
    const filled = colorCell(9, 8, 7);
    expect(tintedPatternCell(filled, { r: 1, g: 2, b: 3 })).toBe(filled);
    expect(tintedPatternCell(null, { r: 1, g: 2, b: 3 })).toBeNull();
    // …and a colour cell reports the colour it draws in.
    expect(patternCellTint(filled)).toEqual({ r: 9, g: 8, b: 7 });
  });

  test('view is memoized per object identity', () => {
    const p = withCell(makePattern(2, 2), 0, 0, colorCell(1, 2, 3));
    expect(patternSVGView(p)).toBe(patternSVGView(p));
  });

  test('repeat mode carries the tile fields and bakes into the tile box', () => {
    let p = withCell(makePattern(2, 2), 0, 0, colorCell(9, 9, 9));
    p = { ...p, tileMode: 'repeat', tileWidthL0: 2, tileHeightL0: 2, cellWidth: 8, cellHeight: 8 };
    const view = patternSVGView(p)!;
    expect(view.tileMode).toBe('repeat');
    expect(view.tileWidthL0).toBe(2);
    expect(view.cellWidth).toBe(8);
    // Baked geometry sits inside the 2×2 tile box at the region origin.
    for (const seg of view.segments) {
      expect(seg.start[0]).toBeLessThanOrEqual(p.cellX + 2 + 1e-6);
      expect(seg.start[1]).toBeLessThanOrEqual(p.cellY + 2 + 1e-6);
    }
  });
});

describe('the ink a laid tile arrives in', () => {
  const RED = { r: 220, g: 40, b: 40 };

  it('stamps the tile in the given ink', () => {
    const edits = patternApplyToolAt(
      makePattern(3, 3), 1, 1, { kind: 'tile', spriteId: 'test/tile_00000000' }, undefined, RED,
    );
    expect(edits).toHaveLength(1);
    expect(patternCellTint(edits[0].newState)).toEqual(RED);
  });

  it('inks a random pick too — the ink is the cell, not the choice of tile', () => {
    const edits = patternApplyToolAt(makePattern(3, 3), 1, 1, { kind: 'random' }, undefined, RED);
    expect(patternCellTint(edits[0].newState)).toEqual(RED);
  });

  it('mirror partners inherit the ink, carrying only the transform across', () => {
    const p = makePattern(4, 1, { symmetry: { ...PATTERN_SYMMETRY_OFF, mirrorH: true } });
    const edits = patternApplyToolAt(
      p, 0, 0, { kind: 'tile', spriteId: 'test/tile_10001000' }, undefined, RED,
    );
    expect(edits.length).toBeGreaterThan(1);
    for (const e of edits) expect(patternCellTint(e.newState)).toEqual(RED);
  });

  it('leaves the eraser alone — there is no cell left to ink', () => {
    const p = withCell(makePattern(2, 2), 0, 0, spriteCell('test/tile_00000000'));
    const edits = patternApplyToolAt(p, 0, 0, { kind: 'erase' }, undefined, RED);
    expect(edits[0].newState).toBeNull();
  });

  it('floods in the ink, mirrors and all', () => {
    const p = makePattern(4, 1, { symmetry: { ...PATTERN_SYMMETRY_OFF, mirrorH: true } });
    const filled = applyPatternCellEdits(
      p, patternFloodEdits(p, { kind: 'tile', spriteId: 'test/tile_10001000' }, undefined, RED),
    );
    for (const cell of filled.cells) expect(patternCellTint(cell)).toEqual(RED);
  });

  it('stores the base ink as no tint at all, not as an explicit white', () => {
    // The two draw identically, so only one of them may be stored — else a
    // white flood over a white grid would report edits forever.
    const white = patternApplyToolAt(
      makePattern(2, 2), 0, 0, { kind: 'tile', spriteId: 'test/tile_00000000' },
      undefined, PATTERN_BASE_INK,
    )[0].newState;
    const untinted = patternApplyToolAt(
      makePattern(2, 2), 0, 0, { kind: 'tile', spriteId: 'test/tile_00000000' },
    )[0].newState;
    expect(white).toEqual(untinted);
    expect(patternCellTint(white)).toBeNull();

    const tile = { kind: 'tile' as const, spriteId: 'test/tile_00000000' };
    let p = makePattern(2, 2);
    p = applyPatternCellEdits(p, patternFloodEdits(p, tile, undefined, PATTERN_BASE_INK));
    expect(patternFloodEdits(p, tile)).toHaveLength(0);
    // …and painting white back over a red cell returns it to the base ink
    // rather than pinning an equivalent white on it.
    const red = applyPatternCellEdits(p, patternFloodEdits(p, tile, undefined, RED));
    expect(patternCellTint(red.cells[0])).toEqual(RED);
    const back = applyPatternCellEdits(
      red, patternFloodEdits(red, tile, undefined, PATTERN_BASE_INK),
    );
    expect(back.cells).toEqual(p.cells);
  });

  it('reconcile heals the seam without stripping the ink', () => {
    // Two neighbours that disagree, both painted red. Reconcile swaps one
    // for a compatible tile — the replacement is minted untinted from the
    // registry, so this pins that the cell's own ink is carried across.
    let p = makePattern(4, 4);
    p = applyPatternCellEdits(p, patternApplyToolAt(
      p, 0, 0, { kind: 'tile', spriteId: 'test/tile_11111111' }, undefined, RED,
    ));
    p = applyPatternCellEdits(p, patternApplyToolAt(
      p, 1, 0, { kind: 'tile', spriteId: 'test/tile_00000000' }, undefined, RED,
    ));
    const edits = patternReconcileEdits(p);
    expect(edits.length).toBeGreaterThan(0);
    const healed = applyPatternCellEdits(p, edits);
    for (const cell of healed.cells) {
      if (cell != null) expect(patternCellTint(cell)).toEqual(RED);
    }
    assertPatternReconciled(healed);
  });
});

describe('re-inking a whole pattern', () => {
  const RED = { r: 220, g: 40, b: 40 };
  const BLUE = { r: 30, g: 60, b: 200 };

  function filled(): PatternObject {
    const p = makePattern(2, 2);
    return applyPatternCellEdits(
      p, patternFloodEdits(p, { kind: 'tile', spriteId: 'test/tile_00000000' }),
    );
  }

  it('re-inks every sprite cell, keeping tile and transform', () => {
    const before = filled();
    const after = applyPatternCellEdits(before, patternRecolorEdits(before, RED));
    for (let i = 0; i < after.cells.length; i++) {
      expect(patternCellTint(after.cells[i])).toEqual(RED);
      const a = after.cells[i] as { spriteId: string; transform: unknown };
      const b = before.cells[i] as { spriteId: string; transform: unknown };
      expect(a.spriteId).toBe(b.spriteId);
      expect(a.transform).toEqual(b.transform);
    }
  });

  it('re-picking the same ink builds nothing', () => {
    const red = applyPatternCellEdits(filled(), patternRecolorEdits(filled(), RED));
    expect(patternRecolorEdits(red, RED)).toHaveLength(0);
    expect(patternRecolorEdits(red, BLUE)).toHaveLength(4);
    // …and an untinted grid is already at the base ink.
    expect(patternRecolorEdits(filled(), PATTERN_BASE_INK)).toHaveLength(0);
  });

  it('leaves empty and colour cells alone', () => {
    const p = withCell(makePattern(2, 2), 0, 0, colorCell(10, 20, 30));
    expect(patternRecolorEdits(p, RED)).toHaveLength(0);
  });

  it('reports one ink when the cells agree, and none when they do not', () => {
    const untinted = filled();
    // Untinted cells all draw in the base ink — that IS agreement.
    expect(patternInkColor(untinted)).toEqual(PATTERN_BASE_INK);
    const red = applyPatternCellEdits(untinted, patternRecolorEdits(untinted, RED));
    expect(patternInkColor(red)).toEqual(RED);
    const mixed = applyPatternCellEdits(red, [{
      index: 0, oldState: red.cells[0], newState: tintedPatternCell(red.cells[0], BLUE),
    }]);
    expect(patternInkColor(mixed)).toBeNull();
    // An empty grid has no ink to report rather than a made-up one.
    expect(patternInkColor(makePattern(2, 2))).toBeNull();
  });
});
