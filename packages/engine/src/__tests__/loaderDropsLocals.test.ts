/**
 * The loader drops the persisted `local*` caches (plan §3.7, P6).
 *
 * A grouped leaf's pose is stored twice in a ≤v61 file: the world fields
 * the user saw, and `local*` caches that are supposed to re-derive them
 * through the group chain. Nothing kept the two honest, so real saved
 * files ship with caches that disagree — and any pass that materialised a
 * member from its locals then MOVED it. On `WaveBug.tile` one path moved
 * 65 cells; `Castle.tile` disagreed on all 318 of its grouped leaves.
 *
 * World is the truth — it is what was drawn — so the loader keeps the
 * world fields and drops the caches. P6-B has since removed the fields
 * themselves; this stays as the drift guard that they do not come back. `fromLegacy` already derives a
 * node's local transform from world alone, so the graph never wanted
 * them; this closes the legacy half.
 *
 * `identity*` is NOT dropped with them: it is not a group-local cache but
 * the transform cycle's memory of the authored pose (`transformCycleStep`),
 * and a figure needs it to come back round to where it started.
 *
 * Settles the stale-cache findings in docs/transform-refactor.md §3.7.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

import { deserializeComposition } from '../compositionBinaryFormat';
import { LOCAL_CACHE_FIELDS } from '../legacyLocalCaches';
import { CompositionState, makeViewport } from '../types';

jest.mock('@/native-shell/bridge/webBridge', () => ({
  logToNative: jest.fn(),
}));

const TEST_DATA = path.join(__dirname, '../../test_data');

/**
 * Spelled out rather than imported from `legacyLocalCaches`: a test that
 * takes its expectations from the constant the implementation strips by
 * cannot notice a field missing from that constant. The drift guard at
 * the bottom is what keeps this list and that one honest, and it reads
 * the field names out of `types.ts` so neither can quietly shrink.
 */
const LOCAL_CACHE_KEYS = [
  'localCellX', 'localCellY', 'localCellWidth', 'localCellHeight',
  'localRotation', 'localMirrorH', 'localMirrorV', 'localAngleDeg',
  'localQuads', 'localSegments', 'localSubpaths',
  'localTileWidthL0', 'localTileHeightL0',
  'localTileOffsetXL0', 'localTileOffsetYL0',
] as const;

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
  return {
    id: rel, name: rel,
    figures: meta.figures ?? [],
    svgObjects: meta.svgObjects ?? [],
    images: meta.images ?? [],
    texts: meta.texts ?? [],
    paintObjects: meta.paintObjects ?? [],
    patternObjects: meta.patternObjects ?? [],
    groups: meta.groups ?? [],
    sceneOrder: meta.sceneOrder,
    imageBlobs: {},
    lineDraft: null, arcDraft: null,
    editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
    customColors: [],
    viewport: makeViewport(800, 600),
  } as unknown as CompositionState;
}

function leavesOf(state: CompositionState): Record<string, unknown>[] {
  return [
    ...(state.figures ?? []), ...(state.svgObjects ?? []),
    ...(state.images ?? []), ...(state.texts ?? []),
    ...(state.paintObjects ?? []), ...(state.patternObjects ?? []),
  ] as unknown as Record<string, unknown>[];
}

const TILES = findTiles(TEST_DATA);

describe('the loader drops the persisted local caches', () => {
  it.each(TILES)('%s loads with no local cache on any leaf', (rel) => {
    const carried = leavesOf(loadTile(rel))
      .flatMap((leaf) => LOCAL_CACHE_KEYS
        .filter((k) => leaf[k] !== undefined)
        .map((k) => `${String(leaf.id)}.${k}`));
    expect(carried).toEqual([]);
  });

  // The other half of the drop — that re-deriving a member through its
  // group chain lands it where the file says it was drawn — used to be
  // checked here by materializing every root group. P6-B deleted that
  // pass; `sceneGraphRoundTrip` and the `worldSnapshotFixtures` snapshots
  // ask the same question of the model that is left.
});

/**
 * The drift guard. `types.ts` is the declaration of what a leaf can
 * carry, so it is the only honest source for "every `local*` field" —
 * a new one added to an interface and to nothing else would otherwise
 * ride straight through the loader.
 */
describe('the cache field list', () => {
  it('covers every local* field declared on a leaf in types.ts', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'types.ts'), 'utf8');
    const declared = new Set<string>();
    for (const m of src.matchAll(/^ {2}(local[A-Za-z0-9]+)\??:/gm)) declared.add(m[1]);
    // `PaintStrokeSVGSnapshot` is an undo-entry snapshot, not a leaf: its
    // local segments are the pre-stroke shape, not a pose cache.
    declared.delete('localSegments');
    declared.delete('localSubpaths');

    const missing = [...declared].filter((f) => !(LOCAL_CACHE_FIELDS as readonly string[]).includes(f));
    expect(missing.sort()).toEqual([]);
    expect(LOCAL_CACHE_FIELDS).toEqual(LOCAL_CACHE_KEYS);
  });
});
