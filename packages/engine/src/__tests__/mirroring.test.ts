import fs from 'fs';
import path from 'path';
import {
  Layer,
  CellState,
  GridLevel,
  CELL_COUNTS,
  effectiveCanvasDims,
  FileConfig,
  ClipBox,
} from '../types';
import { mirrorCellState } from '../connectivity';
import { setCell } from '../cellEdge';
import { computePaintMirrorTargets } from '../paintMirror';
import { makeLayer } from './test-utils';

// ── Framework ───────────────────────────────────────────────────────────
//
// Test data lives in test_data/mirroring/. Each .facet file is a figureset
// containing pairs of figures named [MIRRORTYPE]_[description]_input and
// [MIRRORTYPE]_[description]_result. For each pair, the test takes the
// non-null cells in `_input` as placements, applies the mirror flags
// implied by MIRRORTYPE, and asserts the resulting layer state matches
// `_result` (cells + edge slots) exactly.
//
// To add another mirror type, drop a new file in test_data/mirroring/ and
// add a `runMirrorTestsFromFigureset` call below.

const TEST_DATA_DIR = path.join(__dirname, '..', '..', 'test_data', 'mirroring');

interface MirrorFlags {
  mirrorH: boolean;
  mirrorV: boolean;
  mirrorRotate: boolean;
  mirrorQuad: boolean;
  mirrorRow: boolean;
  mirrorCol: boolean;
  mirrorDiag1: boolean;
  mirrorDiag2: boolean;
  mirrorDiagBoth: boolean;
  mirrorStar: boolean;
}

const NO_FLAGS: MirrorFlags = {
  mirrorH: false, mirrorV: false, mirrorRotate: false, mirrorQuad: false,
  mirrorRow: false, mirrorCol: false, mirrorDiag1: false, mirrorDiag2: false,
  mirrorDiagBoth: false, mirrorStar: false,
};

/** Map the MIRRORTYPE prefix in a figure name to the matching flag bag. */
function flagsForMirrorType(prefix: string): MirrorFlags {
  switch (prefix) {
    case 'MirrorH': return { ...NO_FLAGS, mirrorH: true };
    case 'MirrorV': return { ...NO_FLAGS, mirrorV: true };
    case 'MirrorHV': return { ...NO_FLAGS, mirrorH: true, mirrorV: true };
    case 'MirrorRotate': return { ...NO_FLAGS, mirrorRotate: true };
    case 'MirrorQuad': return { ...NO_FLAGS, mirrorQuad: true };
    case 'MirrorRow': return { ...NO_FLAGS, mirrorRow: true };
    case 'MirrorCol': return { ...NO_FLAGS, mirrorCol: true };
    case 'MirrorDiag1': return { ...NO_FLAGS, mirrorDiag1: true };
    case 'MirrorDiag2': return { ...NO_FLAGS, mirrorDiag2: true };
    case 'MirrorDiagBoth': return { ...NO_FLAGS, mirrorDiagBoth: true };
    case 'MirrorStar': return { ...NO_FLAGS, mirrorStar: true };
    default: throw new Error(`Unknown mirror type prefix: ${prefix}`);
  }
}

interface FigureJSON {
  name: string;
  meta: {
    activeLayerId: string;
    layers: LayerJSON[];
    widthL0: number;
    heightL0: number;
    originL0X?: number;
    originL0Y?: number;
    clipBox?: ClipBox | null;
  };
}

interface LayerJSON {
  id: string;
  name: string;
  level: GridLevel;
  visible: boolean;
  opacity: number;
  order: number;
  shiftX: 0 | 0.5;
  shiftY: 0 | 0.5;
  locked: boolean;
  cells: (CellState | null)[][];
  edgeRowTop?: (CellState | null)[] | null;
  edgeColLeft?: (CellState | null)[] | null;
  edgeCorner?: CellState | null;
}

function loadFigureset(filename: string): { figures: FigureJSON[] } {
  const fullPath = path.join(TEST_DATA_DIR, filename);
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

/** Build a runtime Layer with the same id/level/shift/sizes as the JSON
 *  layer but cleared (no cells written). Edge slots are allocated for
 *  shifted dimensions so setCell can write index -1 entries. */
function freshLayerFromJSON(json: LayerJSON): Layer {
  const layer = makeLayer(json.id, json.level, json.order);
  layer.name = json.name;
  layer.visible = json.visible;
  layer.opacity = json.opacity;
  layer.shiftX = json.shiftX;
  layer.shiftY = json.shiftY;
  layer.locked = json.locked;
  const count = CELL_COUNTS[json.level];
  if (json.shiftX === 0.5) layer.edgeColLeft = new Array(count).fill(null);
  if (json.shiftY === 0.5) layer.edgeRowTop = new Array(count).fill(null);
  return layer;
}

/** Re-derive a FileConfig view that effectiveCanvasDims understands. */
function fileConfigFromFigure(figure: FigureJSON): FileConfig {
  return {
    id: 'test',
    name: figure.name,
    widthL0: figure.meta.widthL0,
    heightL0: figure.meta.heightL0,
    originL0X: figure.meta.originL0X ?? 0,
    originL0Y: figure.meta.originL0Y ?? 0,
    clipBox: figure.meta.clipBox ?? undefined,
  };
}

/** Apply the unified paint-mirror engine to every non-null cell in
 *  `inputLayer`, writing the mirrored stamps into `outLayer`. */
function applyMirrorPlacement(
  inputLayer: LayerJSON,
  outLayer: Layer,
  canvasCfg: ReturnType<typeof effectiveCanvasDims>,
  flags: MirrorFlags,
): void {
  for (let y = 0; y < inputLayer.cells.length; y++) {
    const row = inputLayer.cells[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x++) {
      const cell = row[x];
      if (!cell) continue;
      setCell(outLayer, x, y, cell);
      const targets = computePaintMirrorTargets(x, y, outLayer, canvasCfg, flags);
      for (const t of targets) {
        const mState = mirrorCellState(cell, t.mH, t.mV, t.rot);
        setCell(outLayer, t.x, t.y, mState);
      }
    }
  }
}

function runMirrorPlacement(input: FigureJSON, flags: MirrorFlags): Layer[] {
  const canvasCfg = effectiveCanvasDims(fileConfigFromFigure(input));
  const out: Layer[] = [];
  for (const inLayer of input.meta.layers) {
    const layer = freshLayerFromJSON(inLayer);
    applyMirrorPlacement(inLayer, layer, canvasCfg, flags);
    out.push(layer);
  }
  return out;
}

function asExpectedEdge(slot: (CellState | null)[] | null | undefined, count: number): (CellState | null)[] | null {
  if (!slot) return null;
  // Treat all-null slot as null (matches makeLayer default).
  if (slot.every(c => c == null)) return null;
  return slot.slice(0, count);
}

function assertLayersEqual(actual: Layer, expected: LayerJSON): void {
  expect(actual.cells).toEqual(expected.cells);
  const count = CELL_COUNTS[expected.level];
  expect(asExpectedEdge(actual.edgeColLeft, count)).toEqual(asExpectedEdge(expected.edgeColLeft, count));
  expect(asExpectedEdge(actual.edgeRowTop, count)).toEqual(asExpectedEdge(expected.edgeRowTop, count));
  expect(actual.edgeCorner ?? null).toEqual(expected.edgeCorner ?? null);
}

/** Discover every `_input` / `_result` pair in `filename` and register one
 *  test per pair under the given describe scope. */
function runMirrorTestsFromFigureset(filename: string): void {
  const figureset = loadFigureset(filename);
  const byName = new Map<string, FigureJSON>();
  for (const f of figureset.figures) byName.set(f.name, f);

  // Group by prefix + description; each pair shares "<prefix>_<desc>_".
  const pairs: Array<{ prefix: string; desc: string; input: FigureJSON; result: FigureJSON }> = [];
  for (const f of figureset.figures) {
    if (!f.name.endsWith('_input')) continue;
    const base = f.name.slice(0, -'_input'.length);
    const resultName = `${base}_result`;
    const result = byName.get(resultName);
    if (!result) throw new Error(`Missing _result for ${f.name} (expected ${resultName})`);
    const us = base.indexOf('_');
    if (us < 0) throw new Error(`Figure name lacks MIRRORTYPE_<desc>: ${f.name}`);
    const prefix = base.slice(0, us);
    const desc = base.slice(us + 1);
    pairs.push({ prefix, desc, input: f, result });
  }

  if (pairs.length === 0) throw new Error(`No _input/_result pairs in ${filename}`);

  describe(filename, () => {
    for (const { prefix, desc, input, result } of pairs) {
      const flags = flagsForMirrorType(prefix);
      test(`${prefix} ${desc}: input + mirror == result`, () => {
        const out = runMirrorPlacement(input, flags);
        expect(out.length).toBe(result.meta.layers.length);
        for (let i = 0; i < out.length; i++) {
          assertLayersEqual(out[i], result.meta.layers[i]);
        }
      });
    }
  });
}

// ── Test registrations ──────────────────────────────────────────────────
//
// Auto-load every *_tests.facet in test_data/mirroring/. Files are
// generated by scripts/generate-mirror-tests.test.ts; ad-hoc files dropped
// in by hand work too as long as figures follow the
// `<MIRRORTYPE>_<desc>_<input|result>` naming convention.

const ALL_FILES = fs.readdirSync(TEST_DATA_DIR)
  .filter(f => f.startsWith('Mirror') && f.endsWith('.facet'))
  .sort();
for (const file of ALL_FILES) {
  runMirrorTestsFromFigureset(file);
}
