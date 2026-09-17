/**
 * Guardrail for the transform refactor: every `.tile` fixture in
 * `test_data` renders to the same world-space poses it does today.
 *
 * The refactor moves a leaf's pose out of world fields on the leaf and
 * into a local transform on a scene-graph node, with world derived. That
 * is invisible to the user if and only if the derived world poses match
 * the stored ones. These snapshots are the record of "what the user sees
 * now", captured before the storage changes underneath.
 *
 * A diff here during the refactor means a real regression — a node that
 * moved, turned, or resized. Do not re-record a snapshot to make a diff
 * go away without confirming the new numbers are the right ones.
 *
 * (The parent repo snapshots `docs/references/*.tile` the same way; see
 * `web/editor/__tests__/worldSnapshotReferences.test.ts`.)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

import { deserializeComposition } from '../compositionBinaryFormat';
import { materializeGroupHierarchy } from '../compositionOps';
import { worldSnapshotText } from '../worldSnapshot';
import { CompositionState, makeViewport } from '../types';

jest.mock('@/native-shell/bridge/webBridge', () => ({
  logToNative: jest.fn(),
}));

const TEST_DATA = path.join(__dirname, '../../test_data');

/** Every `.tile` under test_data, recursively, as repo-relative names. */
function findTiles(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...findTiles(path.join(dir, entry.name), rel));
    else if (entry.name.endsWith('.tile')) out.push(rel);
  }
  return out.sort();
}

function loadTile(rel: string): CompositionState {
  const data = new Uint8Array(fs.readFileSync(path.join(TEST_DATA, rel)));
  const { meta } = deserializeComposition(zlib.inflateSync(data));
  const state: CompositionState = {
    id: rel, name: rel,
    figures: meta.figures ?? [],
    svgObjects: meta.svgObjects ?? [],
    images: meta.images ?? [],
    texts: meta.texts ?? [],
    paintObjects: meta.paintObjects ?? [],
    patternObjects: meta.patternObjects ?? [],
    imageBlobs: {},
    lineDraft: null, arcDraft: null,
    editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
    customColors: [],
    groups: meta.groups ?? [],
    sceneOrder: meta.sceneOrder ?? [],
    gridLevel: meta.gridLevel ?? 0,
    strokeScale: 8, gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(),
    activeFigureKey: null,
    compTool: 'select',
    createRegion: null,
    renderGeneration: 0,
  };
  // The real open path runs this; a fixture snapshotted without it would
  // not describe what the editor actually shows.
  return materializeGroupHierarchy(state);
}

const TILES = findTiles(TEST_DATA);

describe('world-space snapshots of the .tile fixtures', () => {
  test('there are fixtures to snapshot', () => {
    expect(TILES.length).toBeGreaterThan(0);
  });

  test.each(TILES)('%s renders the same world poses', (rel) => {
    expect(worldSnapshotText(loadTile(rel))).toMatchSnapshot();
  });
});
