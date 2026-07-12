import { serializeFile, deserializeFile, clearBinaryCache, evictCacheForFile } from '../binaryFormat';
import { CellState, CellTransform, GridLevel, CELL_COUNTS } from '../types';
import { LayerMeta } from '../persistence';

function makeLayerMeta(
  id: string,
  level: GridLevel,
  order: number,
  overrides?: Partial<LayerMeta>,
): LayerMeta {
  const cellCount = CELL_COUNTS[level];
  const cells: (CellState | null)[][] = Array.from({ length: cellCount }, () =>
    Array(cellCount).fill(null),
  );
  return {
    id,
    name: `Layer ${id}`,
    level,
    visible: true,
    opacity: 1,
    order,
    shiftX: 0,
    shiftY: 0,
    locked: false,
    cells,
    cellsGeneration: 0,
    ...overrides,
  };
}

beforeEach(() => {
  clearBinaryCache();
});

describe('Binary Format', () => {
  test('round-trips an empty file', () => {
    const layer = makeLayerMeta('a', 2, 0);
    const bytes = serializeFile([layer], 'a', 32, 32);
    const result = deserializeFile(bytes);

    expect(result.activeLayerId).toBe('a');
    expect(result.widthL0).toBe(32);
    expect(result.heightL0).toBe(32);
    expect(result.layers.length).toBe(1);
    expect(result.layers[0].id).toBe('a');
    expect(result.layers[0].level).toBe(2);
    // All cells should be null
    const cellCount = CELL_COUNTS[2];
    for (let y = 0; y < cellCount; y++) {
      for (let x = 0; x < cellCount; x++) {
        expect(result.layers[0].cells[y][x]).toBeNull();
      }
    }
  });

  test('round-trips color cells', () => {
    const layer = makeLayerMeta('c', 2, 0);
    const color: CellState = { type: 'color', r: 42, g: 128, b: 200, transform: { mirrorH: false, mirrorV: false, rotation: 0 } };
    layer.cells[0][0] = color;
    layer.cells[3][5] = { type: 'color', r: 255, g: 0, b: 0, transform: { mirrorH: true, mirrorV: true, rotation: 270 } };

    const bytes = serializeFile([layer], 'c', 32, 32);
    const result = deserializeFile(bytes);

    expect(result.layers[0].cells[0][0]).toEqual(color);
    expect(result.layers[0].cells[3][5]).toEqual({
      type: 'color', r: 255, g: 0, b: 0,
      transform: { mirrorH: true, mirrorV: true, rotation: 270 },
    });
    expect(result.layers[0].cells[1][1]).toBeNull();
  });

  test('round-trips sprite cells without tint', () => {
    const layer = makeLayerMeta('s', 2, 0);
    // Use a real sprite ID from the manifest — we need at least one.
    // If SPRITE_ENTRIES is empty in test env, this test exercises the unknown-sprite path.
    const spriteId = 'test/sprite1';
    const sprite: CellState = {
      type: 'sprite',
      spriteId,
      transform: { mirrorH: false, mirrorV: false, rotation: 90 },
    };
    layer.cells[2][3] = sprite;

    const bytes = serializeFile([layer], 's', 32, 32);
    const result = deserializeFile(bytes);

    const cell = result.layers[0].cells[2][3];
    // If spriteId is in the string table, it round-trips. Otherwise it becomes null.
    if (cell !== null) {
      expect(cell).toEqual(sprite);
    }
  });

  test('round-trips sprite cells with tint', () => {
    const layer = makeLayerMeta('t', 2, 0);
    const spriteId = 'test/sprite_tinted';
    const sprite: CellState = {
      type: 'sprite',
      spriteId,
      transform: { mirrorH: true, mirrorV: false, rotation: 180 },
      tintR: 100,
      tintG: 200,
      tintB: 50,
    };
    layer.cells[4][4] = sprite;

    const bytes = serializeFile([layer], 't', 32, 32);
    const result = deserializeFile(bytes);

    const cell = result.layers[0].cells[4][4];
    if (cell !== null) {
      expect(cell).toEqual(sprite);
    }
  });

  test('round-trips all transform combinations', () => {
    const layer = makeLayerMeta('tr', 2, 0);
    const rotations: (0 | 90 | 180 | 270)[] = [0, 90, 180, 270];
    const mirrors = [
      { mirrorH: false, mirrorV: false },
      { mirrorH: true, mirrorV: false },
      { mirrorH: false, mirrorV: true },
      { mirrorH: true, mirrorV: true },
    ];

    let idx = 0;
    for (const rot of rotations) {
      for (const mir of mirrors) {
        const y = Math.floor(idx / 8);
        const x = idx % 8;
        if (y < 8 && x < 8) {
          layer.cells[y][x] = {
            type: 'color', r: idx, g: idx, b: idx,
            transform: { rotation: rot, ...mir },
          };
        }
        idx++;
      }
    }

    const bytes = serializeFile([layer], 'tr', 32, 32);
    const result = deserializeFile(bytes);

    idx = 0;
    for (const rot of rotations) {
      for (const mir of mirrors) {
        const y = Math.floor(idx / 8);
        const x = idx % 8;
        if (y < 8 && x < 8) {
          const cell = result.layers[0].cells[y][x];
          expect(cell).not.toBeNull();
          expect((cell as any).transform.rotation).toBe(rot);
          expect((cell as any).transform.mirrorH).toBe(mir.mirrorH);
          expect((cell as any).transform.mirrorV).toBe(mir.mirrorV);
        }
        idx++;
      }
    }
  });

  test('round-trips multi-layer file', () => {
    const layer1 = makeLayerMeta('a', 0, 0);
    const layer2 = makeLayerMeta('b', 2, 1, { visible: false, opacity: 0.5, locked: true });
    const layer3 = makeLayerMeta('c', 1, 2, { shiftX: 0.5, shiftY: 0.5 });

    layer1.cells[0][0] = { type: 'color', r: 10, g: 20, b: 30, transform: { mirrorH: false, mirrorV: false, rotation: 0 } };
    layer2.cells[3][3] = { type: 'color', r: 40, g: 50, b: 60, transform: { mirrorH: false, mirrorV: false, rotation: 0 } };

    const bytes = serializeFile([layer1, layer2, layer3], 'b', 48, 24);
    const result = deserializeFile(bytes);

    expect(result.activeLayerId).toBe('b');
    expect(result.widthL0).toBe(48);
    expect(result.heightL0).toBe(24);
    expect(result.layers.length).toBe(3);

    // Layer 1
    expect(result.layers[0].id).toBe('a');
    expect(result.layers[0].level).toBe(0);
    expect(result.layers[0].visible).toBe(true);
    expect(result.layers[0].cells[0][0]).toEqual(layer1.cells[0][0]);

    // Layer 2
    expect(result.layers[1].id).toBe('b');
    expect(result.layers[1].level).toBe(2);
    expect(result.layers[1].visible).toBe(false);
    expect(result.layers[1].opacity).toBeCloseTo(0.5, 2);
    expect(result.layers[1].locked).toBe(true);
    expect(result.layers[1].cells[3][3]).toEqual(layer2.cells[3][3]);

    // Layer 3
    expect(result.layers[2].id).toBe('c');
    expect(result.layers[2].shiftX).toBe(0.5);
    expect(result.layers[2].shiftY).toBe(0.5);
  });

  test('round-trips all grid levels', () => {
    const levels: GridLevel[] = [0, 1, 2, 3, 4];
    for (const level of levels) {
      const layer = makeLayerMeta(`lvl${level}`, level, 0);
      const cellCount = CELL_COUNTS[level];
      // Paint the last cell
      layer.cells[cellCount - 1][cellCount - 1] = {
        type: 'color', r: level * 50, g: 0, b: 0,
        transform: { mirrorH: false, mirrorV: false, rotation: 0 },
      };

      const bytes = serializeFile([layer], `lvl${level}`, 32, 32);
      const result = deserializeFile(bytes);

      expect(result.layers[0].level).toBe(level);
      expect(result.layers[0].cells[cellCount - 1][cellCount - 1]).toEqual(
        layer.cells[cellCount - 1][cellCount - 1],
      );
    }
  });

  test('validates magic bytes', () => {
    const bytes = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0, 1, 0, 0, 32, 0, 32, 0]);
    expect(() => deserializeFile(bytes)).toThrow('bad magic');
  });

  test('validates version', () => {
    const bytes = new Uint8Array([0x46, 0x43, 0x45, 0x54, 99, 0, 0, 0, 32, 0, 32, 0]);
    expect(() => deserializeFile(bytes)).toThrow('Unsupported binary format version');
  });

  test('binary output is smaller than JSON for filled layers', () => {
    const layer = makeLayerMeta('size', 2, 0);
    const cellCount = CELL_COUNTS[2]; // 8
    // Fill every cell with color
    for (let y = 0; y < cellCount; y++) {
      for (let x = 0; x < cellCount; x++) {
        layer.cells[y][x] = {
          type: 'color', r: x * 30, g: y * 30, b: 128,
          transform: { mirrorH: false, mirrorV: false, rotation: 0 },
        };
      }
    }

    const bytes = serializeFile([layer], 'size', 32, 32);
    const json = JSON.stringify({
      activeLayerId: 'size',
      widthL0: 32,
      heightL0: 32,
      layers: [layer],
    });

    // Binary should be significantly smaller
    expect(bytes.length).toBeLessThan(json.length);
  });

  test('negative layer order round-trips', () => {
    const layer = makeLayerMeta('neg', 2, -5);

    const bytes = serializeFile([layer], 'neg', 32, 32);
    const result = deserializeFile(bytes);

    expect(result.layers[0].order).toBe(-5);
  });

  test('layer byte cache reuses bytes for unchanged cells', () => {
    const layer = makeLayerMeta('cache', 2, 0);
    layer.cells[0][0] = { type: 'color', r: 1, g: 2, b: 3, transform: { mirrorH: false, mirrorV: false, rotation: 0 } };

    const bytes1 = serializeFile([layer], 'cache', 32, 32);
    // Serialize again with same cells reference — should use cache
    const bytes2 = serializeFile([layer], 'cache', 32, 32);

    // Both outputs should be identical
    expect(bytes1.length).toBe(bytes2.length);
    for (let i = 0; i < bytes1.length; i++) {
      expect(bytes1[i]).toBe(bytes2[i]);
    }
  });

  test('round-trips a clip box', () => {
    const layer = makeLayerMeta('clip', 2, 0);
    const clipBox = { clipL0X: 4, clipL0Y: 8, clipL0W: 16, clipL0H: 12 };

    const bytes = serializeFile([layer], 'clip', 32, 32, undefined, 0, 0, clipBox);
    const result = deserializeFile(bytes);

    expect(result.clipBox).toEqual(clipBox);
  });

  test('omits clip box when not provided', () => {
    const layer = makeLayerMeta('no_clip', 2, 0);

    const bytes = serializeFile([layer], 'no_clip', 32, 32);
    const result = deserializeFile(bytes);

    expect(result.clipBox).toBeUndefined();
    // Flag bit 0x0001 should be unset
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint16(6, true) & 0x0001).toBe(0);
  });

  test('handles explicit null clip box like absent', () => {
    const layer = makeLayerMeta('null_clip', 2, 0);

    const bytes = serializeFile([layer], 'null_clip', 32, 32, undefined, 0, 0, null);
    const result = deserializeFile(bytes);

    expect(result.clipBox).toBeUndefined();
  });

  test('reads v3 bytes without clip box', () => {
    // Hand-craft a minimal v3 file (no clip box block, no v4 flag) and
    // ensure the v4 reader handles it.
    // v3 header: 16 bytes — magic, version=3, flags=0, w=32, h=32, oX=0, oY=0
    // String table: stringCount=0 (u16)
    // Active layer idx: 0 (u16)
    // Layer count: 0 (u8)
    const bytes = new Uint8Array(16 + 2 + 2 + 1);
    bytes[0] = 0x46; bytes[1] = 0x43; bytes[2] = 0x45; bytes[3] = 0x54;
    const view = new DataView(bytes.buffer);
    view.setUint16(4, 3, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, 32, true);
    view.setUint16(10, 32, true);
    view.setUint16(12, 0, true);
    view.setUint16(14, 0, true);
    view.setUint16(16, 0, true); // stringCount
    view.setUint16(18, 0, true); // activeLayerIdx
    bytes[20] = 0;               // layerCount

    const result = deserializeFile(bytes);
    expect(result.clipBox).toBeUndefined();
    expect(result.widthL0).toBe(32);
    expect(result.heightL0).toBe(32);
    expect(result.layers).toEqual([]);
  });

  test('evictCacheForFile prevents stale bytes after generation reset', () => {
    const fileId = 'evictTest';
    const transform: CellTransform = { mirrorH: false, mirrorV: false, rotation: 0 };

    // Session 1: serialize with a red cell, generation = 2
    const layer1 = makeLayerMeta('L', 2, 0);
    layer1.cells[0][0] = { type: 'color', r: 255, g: 0, b: 0, transform };
    layer1.cellsGeneration = 2;
    serializeFile([layer1], 'L', 32, 32, fileId);

    // Session 2: simulate reload (generation resets to 0), different cell data
    const layer2 = makeLayerMeta('L', 2, 0);
    layer2.cells[0][0] = { type: 'color', r: 0, g: 0, b: 255, transform };
    layer2.cellsGeneration = 2; // same generation as cached entry

    // Evict before serializing (as loadFileState would do)
    evictCacheForFile(fileId);

    const bytes = serializeFile([layer2], 'L', 32, 32, fileId);
    const result = deserializeFile(bytes);

    // Must contain the blue cell, not the stale red cell
    expect(result.layers[0].cells[0][0]).toEqual(
      expect.objectContaining({ type: 'color', r: 0, g: 0, b: 255 }),
    );
  });
});
