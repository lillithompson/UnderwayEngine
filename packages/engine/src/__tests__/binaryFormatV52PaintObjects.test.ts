/**
 * v52 binary format: PaintObject scene nodes — the paint brush's raster
 * islands as first-class scene objects, replacing the retired global
 * canvasPaint layer.
 *
 * The PAINT OBJECTS section is the file's final section (after the v51
 * island count, which is still written but always 0 so the section offsets
 * hold). Per object: id + two flag bytes gating every optional field
 * (name/groupId/preGroupName, opacity/edgeSoften/angleDeg, local and
 * identity bboxes, rotation bits, mirrors, locked/hidden), f32 world bbox,
 * f32 tile-space contentRect, then the sparse tiles (f32 origin/span + the
 * v48 paint-overlay payload each). See the v52 changelog comment next to
 * FORMAT_VERSION in compositionBinaryFormat.ts.
 *
 * Also pinned here: v50 files (which carried the retired global layer) still
 * parse WITHOUT error — their canvasPaint bytes are walked and deliberately
 * DROPPED, never migrated (fixtures/canvasPaint-v50.bin.b64).
 *
 * Mirrors binaryFormatV42Opacity.test.ts in structure.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  serializeComposition,
  deserializeComposition,
  CompositionBundle,
} from '../compositionBinaryFormat';
import {
  commitCanvasPaint,
  createCanvasPaintWorking,
  paintTileAlphaAt,
  stampCanvasPaint,
} from '../canvasPaint';
import { createPaintObjectFromTiles } from '../paintObject';
import { CanvasPaintIsland, GroupNode, PaintObject, SVGObject } from '../types';

// A texel-center-aligned coordinate at density 8 (texel = 1/8 cell), so a
// dab center sits exactly on a texel center and deposits full alpha there.
const C = 0.0625;

/** Committed, grid-conforming tiles holding one full-alpha red dab per
 *  (x, y). Built through the real stamp/commit pipeline so the reader's
 *  normalization pass (normalizeCanvasPaintIslands) is a pass-through and
 *  the bytes we serialize are exactly the bytes a paint session produces. */
function dabTiles(dabs: readonly [number, number][]): CanvasPaintIsland[] {
  const working = createCanvasPaintWorking(undefined);
  for (const [x, y] of dabs) stampCanvasPaint(working, x, y, 1, { r: 255, g: 0, b: 0 }, 1);
  const tiles = commitCanvasPaint(working);
  if (!tiles) throw new Error('fixture dabs painted nothing');
  return tiles;
}

/** The minimal island: fresh from a paint session, so bbox == contentRect
 *  and every optional field is absent. One dab, one tile. */
function minimalPaint(id = 'pnt_min'): PaintObject {
  const p = createPaintObjectFromTiles(id, dabTiles([[8 + C, 8 + C]]));
  if (!p) throw new Error('fixture island had no ink');
  return p;
}

/** The maximal island: every optional field set, two sparse tiles (the dabs
 *  land at tile-grid cells (0,0) and (32,0)), and a bbox that drifted away
 *  from the contentRect the way any post-session transform leaves it. All
 *  float values are dyadic so the f32 wire format holds them exactly. */
function maximalPaint(id = 'pnt_max'): PaintObject {
  const base = createPaintObjectFromTiles(id, dabTiles([[8 + C, 8 + C], [40 + C, 8 + C]]));
  if (!base) throw new Error('fixture island had no ink');
  return {
    ...base,
    name: 'Night Sky',
    groupId: 'grp_1',
    preGroupName: 'Loose Brushwork',
    opacity: 0.75,
    edgeSoften: 0.5,
    rotation: 270,
    angleDeg: 22.5,
    mirrorH: true,
    mirrorV: true,
    locked: true,
    hidden: true,
    // World bbox no longer equal to the tile-space contentRect.
    cellX: -3.5, cellY: 2.25, cellWidth: 40.5, cellHeight: 12.75,
    localCellX: 1.5, localCellY: 2.5, localCellWidth: 3.25, localCellHeight: 4.75,
    identityCellX: -0.5, identityCellY: -1.25, identityCellWidth: 33, identityCellHeight: 9.5,
  };
}

/** A line object sharing the maximal island's group, so `grp_1` has a second
 *  leaf member and survives the serializer's alive-group pruning on its own
 *  merits (not only via the paint object). */
function groupMateSVG(id = 'svg_mate'): SVGObject {
  return {
    id,
    segments: [{ kind: 'line', start: [50, 0], end: [60, 0] }],
    color: { r: 255, g: 255, b: 255 },
    cellX: 50, cellY: 0, cellWidth: 10, cellHeight: 0,
    groupId: 'grp_1',
  };
}

function makeGroup(id = 'grp_1'): GroupNode {
  return {
    id, name: 'Sky Group',
    translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
    rotation: 0, mirrorH: false, mirrorV: false,
  };
}

function makeBundle(extra: Partial<CompositionBundle> = {}): CompositionBundle {
  return {
    name: 'Test', gridLevel: 1, strokeScale: 0.2, gridIntensity: 0.3,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    figures: [],
    ...extra,
  };
}

function roundTrip(bundle: CompositionBundle): CompositionBundle {
  return deserializeComposition(serializeComposition(bundle, [])).meta;
}

/** Tile in `tiles` whose origin is (x, y); throws when absent so an
 *  assertion on the result can't silently pass on undefined. */
function tileAt(tiles: readonly CanvasPaintIsland[], x: number, y: number): CanvasPaintIsland {
  const t = tiles.find((isl) => isl.x === x && isl.y === y);
  if (!t) throw new Error(`no tile at (${x}, ${y}) — got ${tiles.map((i) => `(${i.x},${i.y})`).join(' ')}`);
  return t;
}

describe('v52 paint object round-trip', () => {
  it('round-trips two islands — one with every field, one minimal — losslessly', () => {
    const max = maximalPaint();
    const min = minimalPaint();
    const svg = groupMateSVG();
    const meta = roundTrip(makeBundle({
      paintObjects: [max, min],
      svgObjects: [svg],
      groups: [makeGroup()],
      sceneOrder: ['pnt_max', 'svg_mate', 'pnt_min'],
      // A background paint sits directly before the (always-0) v51 island
      // count and the paint section — include one so the section offsets
      // are exercised, not just the empty-prefix layout.
      background: { kind: 'solid', color: { r: 10, g: 20, b: 30 } },
    }));

    const out = meta.paintObjects ?? [];
    expect(out.map((p) => p.id)).toEqual(['pnt_max', 'pnt_min']);
    const [outMax, outMin] = out;

    // ── The maximal island: every optional field survives ──
    expect(outMax.name).toBe('Night Sky');
    expect(outMax.groupId).toBe('grp_1');
    expect(outMax.preGroupName).toBe('Loose Brushwork');
    expect(outMax.opacity).toBeCloseTo(0.75, 6);
    expect(outMax.edgeSoften).toBeCloseTo(0.5, 6);
    expect(outMax.rotation).toBe(270);
    expect(outMax.angleDeg).toBeCloseTo(22.5, 6);
    expect(outMax.mirrorH).toBe(true);
    expect(outMax.mirrorV).toBe(true);
    expect(outMax.locked).toBe(true);
    expect(outMax.hidden).toBe(true);
    // World bbox — f32 on the wire (like island origins), NOT the i16
    // fixed-point lattice, so the dyadic values return exactly.
    expect(outMax.cellX).toBe(-3.5);
    expect(outMax.cellY).toBe(2.25);
    expect(outMax.cellWidth).toBe(40.5);
    expect(outMax.cellHeight).toBe(12.75);
    expect(outMax.localCellX).toBe(1.5);
    expect(outMax.localCellY).toBe(2.5);
    expect(outMax.localCellWidth).toBe(3.25);
    expect(outMax.localCellHeight).toBe(4.75);
    expect(outMax.identityCellX).toBe(-0.5);
    expect(outMax.identityCellY).toBe(-1.25);
    expect(outMax.identityCellWidth).toBe(33);
    expect(outMax.identityCellHeight).toBe(9.5);
    // The tile-space contentRect is independent of the drifted bbox.
    expect(outMax.contentX).toBeCloseTo(max.contentX, 5);
    expect(outMax.contentY).toBeCloseTo(max.contentY, 5);
    expect(outMax.contentW).toBeCloseTo(max.contentW, 5);
    expect(outMax.contentH).toBeCloseTo(max.contentH, 5);

    // Both sparse tiles come back at their tile-grid slots with identical
    // texel bytes — the empty 16-cell gap between them stays unallocated.
    expect(outMax.tiles).toHaveLength(2);
    for (const src of max.tiles) {
      const got = tileAt(outMax.tiles, src.x, src.y);
      expect(got.widthCells).toBe(src.widthCells);
      expect(got.overlay.cols).toBe(src.overlay.cols);
      expect(got.overlay.rows).toBe(src.overlay.rows);
      expect(got.overlay.rgba).toEqual(src.overlay.rgba);
    }
    // And the ink is where the dabs were stamped, sampled the way hit
    // testing samples it.
    expect(paintTileAlphaAt(outMax.tiles, 8 + C, 8 + C)).toBe(255);
    expect(paintTileAlphaAt(outMax.tiles, 40 + C, 8 + C)).toBe(255);
    expect(paintTileAlphaAt(outMax.tiles, 24, 8)).toBe(0);

    // ── The minimal island: defaults stay ABSENT, not zero-filled ──
    expect(outMin.name).toBeUndefined();
    expect(outMin.groupId).toBeUndefined();
    expect(outMin.preGroupName).toBeUndefined();
    expect(outMin.opacity).toBeUndefined();
    expect(outMin.edgeSoften).toBeUndefined();
    expect(outMin.rotation).toBeUndefined();
    expect(outMin.angleDeg).toBeUndefined();
    expect(outMin.mirrorH).toBeUndefined();
    expect(outMin.mirrorV).toBeUndefined();
    expect(outMin.locked).toBeUndefined();
    expect(outMin.hidden).toBeUndefined();
    expect(outMin.localCellX).toBeUndefined();
    expect(outMin.identityCellX).toBeUndefined();
    // Fresh from a session: bbox == contentRect, exactly.
    expect(outMin.cellX).toBeCloseTo(min.contentX, 5);
    expect(outMin.cellY).toBeCloseTo(min.contentY, 5);
    expect(outMin.cellWidth).toBeCloseTo(min.contentW, 5);
    expect(outMin.cellHeight).toBeCloseTo(min.contentH, 5);
    expect(outMin.tiles).toHaveLength(1);
    expect(paintTileAlphaAt(outMin.tiles, 8 + C, 8 + C)).toBe(255);

    // ── The company survived too ──
    // The group is alive (two leaf members reference it) and was written.
    expect((meta.groups ?? []).map((g) => g.id)).toEqual(['grp_1']);
    // Paint ids ride sceneOrder like any other scene object's.
    expect(meta.sceneOrder).toEqual(['pnt_max', 'svg_mate', 'pnt_min']);
  });

  it('a bundle without paint objects reads back with the field absent', () => {
    const meta = roundTrip(makeBundle({
      svgObjects: [groupMateSVG('svg_1')],
      sceneOrder: ['svg_1'],
    }));
    expect(meta.paintObjects).toBeUndefined();
  });

  it('an island whose tiles are empty is dropped on read, not resurrected blank', () => {
    // The type contract says tiles are never empty (an erased-to-nothing
    // island leaves the scene) — but a file could still carry one. The
    // reader prunes it so no ghost node reaches the scene.
    const ghost: PaintObject = {
      id: 'pnt_ghost',
      cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
      tiles: [],
      contentX: 0, contentY: 0, contentW: 4, contentH: 4,
    };
    const meta = roundTrip(makeBundle({
      paintObjects: [ghost],
      sceneOrder: ['pnt_ghost'],
    }));
    expect(meta.paintObjects).toBeUndefined();
  });
});

describe('v50 legacy canvasPaint files', () => {
  it('deserializes without error and yields no paint objects — the layer is dropped', () => {
    // A real v50 file whose final section is the retired global canvasPaint
    // layer. v52 walks those bytes to stay in sync but deliberately drops
    // the brushwork (no migration — see the v52 changelog).
    const b64 = fs.readFileSync(
      path.join(__dirname, 'fixtures/canvasPaint-v50.bin.b64'),
      'utf8',
    );
    const bytes = Uint8Array.from(Buffer.from(b64, 'base64'));

    const { meta } = deserializeComposition(bytes);
    expect(meta.name).toBe('v50 fixture');
    expect(meta.paintObjects).toBeUndefined();
  });
});
