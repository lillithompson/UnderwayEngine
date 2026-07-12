import { CellState, CellTransform, GridLevel, CELL_COUNTS, ClipBox } from './types';
import { SPRITE_ENTRIES } from './spriteRegistry';
import type { LayerMeta, FileMeta } from './persistence';

// ── Binary Format v1/v2/v3/v4 ───────────────────────────────────────
//
// FILE HEADER
//   v1/v2 (12 bytes):
//     Magic:    u8[4] = "FCET"
//     Version:  u16 = 1 or 2
//     Flags:    u16 = 0
//     widthL0:  u16
//     heightL0: u16
//   v3 (16 bytes):
//     ... same first 12 bytes, then:
//     originL0X: u16
//     originL0Y: u16
//   (v1/v2 files read as origin = 0,0)
//
//   v4: same 16-byte header layout as v3. Flag bit 0x0001 = "hasClipBox".
//
// CLIP BOX BLOCK (v4 only, present iff flags & 0x0001)
//   Immediately follows header, 8 bytes total:
//     clipL0X: u16, clipL0Y: u16, clipL0W: u16, clipL0H: u16
//
// STRING TABLE
//   stringCount: u16
//   Per string: length(u16) + utf8data(u8[length])
//
// ACTIVE LAYER
//   activeLayerIdx: u16 (index into the string table, not the layers array)
//
// LAYERS
//   layerCount: u8
//   Per layer:
//     HEADER (10 bytes)
//       idIdx(u16) nameIdx(u16) level(u8) flags(u8) opacity(u16) order(i16)
//     CELLS (row-major, cellCount × cellCount)
//       Per cell:
//         0x00 = null (1 byte)
//         0x01 = color: r g b transform (5 bytes)
//         0x02 = sprite: spriteIdx(u16) transform(u8) (4 bytes)
//         0x03 = sprite+tint: spriteIdx(u16) transform(u8) tintR tintG tintB (7 bytes)
//     EDGE CELLS (v2+ only, present when shiftX/shiftY flags set)
//       If shiftY: cellCount cells for edgeRowTop (y=-1)
//       If shiftX: cellCount cells for edgeColLeft (x=-1)
//       If both:   1 cell for edgeCorner (-1,-1)

const MAGIC = [0x46, 0x43, 0x45, 0x54]; // "FCET"
const FORMAT_VERSION = 4;
const HEADER_SIZE_V1_V2 = 12;
const HEADER_SIZE_V3 = 16;
const CLIP_BOX_SIZE = 8;
const FLAG_HAS_CLIP_BOX = 0x0001;

const TAG_NULL = 0x00;
const TAG_COLOR = 0x01;
const TAG_SPRITE = 0x02;
const TAG_SPRITE_TINT = 0x03;

// ── Transform Byte Encoding ─────────────────────────────────────────

const ROTATION_TO_BITS: Record<number, number> = { 0: 0, 90: 1, 180: 2, 270: 3 };
const BITS_TO_ROTATION: (0 | 90 | 180 | 270)[] = [0, 90, 180, 270];

function encodeTransform(t: CellTransform): number {
  return ROTATION_TO_BITS[t.rotation] | (t.mirrorH ? 0x04 : 0) | (t.mirrorV ? 0x08 : 0);
}

function decodeTransform(byte: number): CellTransform {
  return {
    rotation: BITS_TO_ROTATION[byte & 0x03],
    mirrorH: (byte & 0x04) !== 0,
    mirrorV: (byte & 0x08) !== 0,
  };
}

// ── String Table ────────────────────────────────────────────────────
// Includes all manifest sprite IDs (stable) + dynamic layer IDs/names.
// Keeping all sprite IDs ensures cached per-layer bytes remain valid
// across saves even when sprites are added/removed from layers.

function buildStringTable(layers: LayerMeta[]): { strings: string[]; indexOf: Map<string, number> } {
  const indexOf = new Map<string, number>();
  const strings: string[] = [];

  function add(s: string): void {
    if (!indexOf.has(s)) {
      indexOf.set(s, strings.length);
      strings.push(s);
    }
  }

  // Static: all manifest sprite IDs (order is stable across saves)
  for (const entry of SPRITE_ENTRIES) {
    add(entry.id);
  }

  // Dynamic: layer IDs and names
  for (const layer of layers) {
    add(layer.id);
    add(layer.name);
  }

  return { strings, indexOf };
}

// ── Per-Layer Byte Cache ────────────────────────────────────────────

const _layerByteCache = new Map<string, { generation: number; bytes: Uint8Array }>();

/** Clear the per-layer byte cache (for testing). */
export function clearBinaryCache(): void {
  _layerByteCache.clear();
}

/** Evict cached byte entries for a specific file so stale data from a
 *  previous editing session cannot collide with a fresh load. */
export function evictCacheForFile(fileId: string): void {
  const prefix = `${fileId}_`;
  for (const key of Array.from(_layerByteCache.keys())) {
    if (key.startsWith(prefix)) _layerByteCache.delete(key);
  }
}

// ── Size Estimation ─────────────────────────────────────────────────

function estimateCellsSize(cells: (CellState | null)[][], cellCount: number): number {
  let size = 0;
  for (let y = 0; y < cellCount; y++) {
    const row = cells[y];
    for (let x = 0; x < cellCount; x++) {
      const cell = row[x];
      if (cell === null || cell === undefined) {
        size += 1;
      } else if (cell.type === 'color') {
        size += 5;
      } else if (cell.tintR !== undefined) {
        size += 7;
      } else {
        size += 4;
      }
    }
  }
  return size;
}

// ── Serialize ───────────────────────────────────────────────────────

function serializeLayerCells(
  cells: (CellState | null)[][],
  cellCount: number,
  spriteIndexOf: Map<string, number>,
): Uint8Array {
  // Estimate size and allocate
  const estimatedSize = estimateCellsSize(cells, cellCount);
  const buf = new Uint8Array(estimatedSize);
  let offset = 0;

  for (let y = 0; y < cellCount; y++) {
    const row = cells[y];
    for (let x = 0; x < cellCount; x++) {
      const cell = row[x];
      if (cell === null || cell === undefined) {
        buf[offset++] = TAG_NULL;
      } else if (cell.type === 'color') {
        buf[offset++] = TAG_COLOR;
        buf[offset++] = cell.r;
        buf[offset++] = cell.g;
        buf[offset++] = cell.b;
        buf[offset++] = encodeTransform(cell.transform);
      } else {
        // sprite
        const spriteIdx = spriteIndexOf.get(cell.spriteId);
        if (spriteIdx === undefined) {
          // Unknown sprite — write as null
          buf[offset++] = TAG_NULL;
          continue;
        }
        const hasTint = cell.tintR !== undefined;
        if (hasTint) {
          buf[offset++] = TAG_SPRITE_TINT;
        } else {
          buf[offset++] = TAG_SPRITE;
        }
        buf[offset++] = (spriteIdx >> 8) & 0xFF;
        buf[offset++] = spriteIdx & 0xFF;
        buf[offset++] = encodeTransform(cell.transform);
        if (hasTint) {
          buf[offset++] = cell.tintR!;
          buf[offset++] = cell.tintG!;
          buf[offset++] = cell.tintB!;
        }
      }
    }
  }

  return buf.subarray(0, offset);
}

function estimateEdgeCellsSize(cells: (CellState | null)[]): number {
  let size = 0;
  for (const cell of cells) {
    if (cell === null || cell === undefined) {
      size += 1;
    } else if (cell.type === 'color') {
      size += 5;
    } else if (cell.tintR !== undefined) {
      size += 7;
    } else {
      size += 4;
    }
  }
  return size;
}

function serializeEdgeCells(
  cells: (CellState | null)[],
  spriteIndexOf: Map<string, number>,
): Uint8Array {
  const estimatedSize = estimateEdgeCellsSize(cells);
  const buf = new Uint8Array(estimatedSize);
  let offset = 0;
  for (const cell of cells) {
    if (cell === null || cell === undefined) {
      buf[offset++] = TAG_NULL;
    } else if (cell.type === 'color') {
      buf[offset++] = TAG_COLOR;
      buf[offset++] = cell.r;
      buf[offset++] = cell.g;
      buf[offset++] = cell.b;
      buf[offset++] = encodeTransform(cell.transform);
    } else {
      const spriteIdx = spriteIndexOf.get(cell.spriteId);
      if (spriteIdx === undefined) {
        buf[offset++] = TAG_NULL;
        continue;
      }
      const hasTint = cell.tintR !== undefined;
      if (hasTint) {
        buf[offset++] = TAG_SPRITE_TINT;
      } else {
        buf[offset++] = TAG_SPRITE;
      }
      buf[offset++] = (spriteIdx >> 8) & 0xFF;
      buf[offset++] = spriteIdx & 0xFF;
      buf[offset++] = encodeTransform(cell.transform);
      if (hasTint) {
        buf[offset++] = cell.tintR!;
        buf[offset++] = cell.tintG!;
        buf[offset++] = cell.tintB!;
      }
    }
  }
  return buf.subarray(0, offset);
}

function serializeSingleCell(
  cell: CellState | null,
  spriteIndexOf: Map<string, number>,
): Uint8Array {
  return serializeEdgeCells([cell ?? null], spriteIndexOf);
}

export function serializeFile(
  layers: LayerMeta[],
  activeLayerId: string,
  widthL0: number,
  heightL0: number,
  fileId?: string,
  originL0X: number = 0,
  originL0Y: number = 0,
  clipBox?: ClipBox | null,
): Uint8Array {
  const { strings, indexOf } = buildStringTable(layers);
  const hasClipBox = !!clipBox;

  // Calculate total size
  let totalSize = HEADER_SIZE_V3;
  if (hasClipBox) totalSize += CLIP_BOX_SIZE;

  // String table size
  totalSize += 2; // stringCount
  const encoder = new TextEncoder();
  const encodedStrings: Uint8Array[] = [];
  for (const s of strings) {
    const encoded = encoder.encode(s);
    encodedStrings.push(encoded);
    totalSize += 2 + encoded.length; // length + data
  }

  // Active layer index
  totalSize += 2;

  // Layer count
  totalSize += 1;

  // Per-layer: header (10 bytes) + cells + edge cells
  const layerCellBytes: Uint8Array[] = [];
  const layerEdgeBytes: (Uint8Array | null)[] = [];
  const activeCacheKeys = new Set<string>();
  for (const layer of layers) {
    const cacheId = fileId ? `${fileId}_${layer.id}` : layer.id;
    activeCacheKeys.add(cacheId);
    totalSize += 10;

    // Check byte cache
    const cached = _layerByteCache.get(cacheId);
    let cellBytes: Uint8Array;
    if (cached && cached.generation === (layer.cellsGeneration ?? 0)) {
      cellBytes = cached.bytes;
    } else {
      const cellCount = CELL_COUNTS[layer.level];
      cellBytes = serializeLayerCells(layer.cells, cellCount, indexOf);
      _layerByteCache.set(cacheId, { generation: layer.cellsGeneration ?? 0, bytes: cellBytes });
    }
    layerCellBytes.push(cellBytes);
    totalSize += cellBytes.length;

    // Edge cells (v2): serialize edge storage for shifted layers
    const edgeParts: Uint8Array[] = [];
    const cellCount = CELL_COUNTS[layer.level];
    if (layer.shiftY === 0.5) {
      const row = layer.edgeRowTop ?? new Array(cellCount).fill(null);
      edgeParts.push(serializeEdgeCells(row, indexOf));
    }
    if (layer.shiftX === 0.5) {
      const col = layer.edgeColLeft ?? new Array(cellCount).fill(null);
      edgeParts.push(serializeEdgeCells(col, indexOf));
    }
    if (layer.shiftX === 0.5 && layer.shiftY === 0.5) {
      edgeParts.push(serializeSingleCell(layer.edgeCorner ?? null, indexOf));
    }
    if (edgeParts.length > 0) {
      const totalEdge = edgeParts.reduce((s, b) => s + b.length, 0);
      const combined = new Uint8Array(totalEdge);
      let off = 0;
      for (const part of edgeParts) { combined.set(part, off); off += part.length; }
      layerEdgeBytes.push(combined);
      totalSize += totalEdge;
    } else {
      layerEdgeBytes.push(null);
    }
  }

  // Evict stale cache entries
  if (_layerByteCache.size > activeCacheKeys.size + 4) {
    for (const key of Array.from(_layerByteCache.keys())) {
      if (!activeCacheKeys.has(key)) _layerByteCache.delete(key);
    }
  }

  // Allocate and write
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);
  let pos = 0;

  // Header (v4, 16 bytes — same layout as v3, flags now used)
  out[0] = MAGIC[0]; out[1] = MAGIC[1]; out[2] = MAGIC[2]; out[3] = MAGIC[3];
  view.setUint16(4, FORMAT_VERSION, true);
  view.setUint16(6, hasClipBox ? FLAG_HAS_CLIP_BOX : 0, true);
  view.setUint16(8, widthL0, true);
  view.setUint16(10, heightL0, true);
  view.setUint16(12, originL0X, true);
  view.setUint16(14, originL0Y, true);
  pos = HEADER_SIZE_V3;

  if (hasClipBox) {
    view.setUint16(pos, clipBox!.clipL0X, true); pos += 2;
    view.setUint16(pos, clipBox!.clipL0Y, true); pos += 2;
    view.setUint16(pos, clipBox!.clipL0W, true); pos += 2;
    view.setUint16(pos, clipBox!.clipL0H, true); pos += 2;
  }

  // String table
  view.setUint16(pos, strings.length, true); pos += 2;
  for (let i = 0; i < encodedStrings.length; i++) {
    const enc = encodedStrings[i];
    view.setUint16(pos, enc.length, true); pos += 2;
    out.set(enc, pos); pos += enc.length;
  }

  // Active layer
  // Index into the string table (not the layers array).
  const activeLayerIdx = indexOf.get(activeLayerId) ?? 0;
  view.setUint16(pos, activeLayerIdx, true); pos += 2;

  // Layers
  out[pos++] = layers.length;

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];

    // Header
    view.setUint16(pos, indexOf.get(layer.id) ?? 0, true); pos += 2;
    view.setUint16(pos, indexOf.get(layer.name) ?? 0, true); pos += 2;
    out[pos++] = layer.level;

    let flags = 0;
    if (layer.visible) flags |= 0x01;
    if (layer.locked) flags |= 0x02;
    if (layer.shiftX === 0.5) flags |= 0x04;
    if (layer.shiftY === 0.5) flags |= 0x08;
    out[pos++] = flags;

    view.setUint16(pos, Math.round(layer.opacity * 10000), true); pos += 2;
    view.setInt16(pos, layer.order, true); pos += 2;

    // Cells
    const cellBytes = layerCellBytes[i];
    out.set(cellBytes, pos);
    pos += cellBytes.length;

    // Edge cells (v2)
    const edgeBytes = layerEdgeBytes[i];
    if (edgeBytes) {
      out.set(edgeBytes, pos);
      pos += edgeBytes.length;
    }
  }

  return out;
}

// ── Deserialize ─────────────────────────────────────────────────────

export function deserializeFile(data: Uint8Array): FileMeta {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 0;

  // Validate magic
  if (data[0] !== MAGIC[0] || data[1] !== MAGIC[1] || data[2] !== MAGIC[2] || data[3] !== MAGIC[3]) {
    throw new Error('Invalid binary format: bad magic');
  }

  const version = view.getUint16(4, true);
  if (version < 1 || version > FORMAT_VERSION) {
    throw new Error(`Unsupported binary format version: ${version}`);
  }

  const flags = view.getUint16(6, true);
  const widthL0 = view.getUint16(8, true);
  const heightL0 = view.getUint16(10, true);
  let originL0X = 0;
  let originL0Y = 0;
  if (version >= 3) {
    originL0X = view.getUint16(12, true);
    originL0Y = view.getUint16(14, true);
    pos = HEADER_SIZE_V3;
  } else {
    pos = HEADER_SIZE_V1_V2;
  }

  let clipBox: ClipBox | undefined;
  if (version >= 4 && (flags & FLAG_HAS_CLIP_BOX) !== 0) {
    const clipL0X = view.getUint16(pos, true); pos += 2;
    const clipL0Y = view.getUint16(pos, true); pos += 2;
    const clipL0W = view.getUint16(pos, true); pos += 2;
    const clipL0H = view.getUint16(pos, true); pos += 2;
    clipBox = { clipL0X, clipL0Y, clipL0W, clipL0H };
  }

  // String table
  const stringCount = view.getUint16(pos, true); pos += 2;
  const decoder = new TextDecoder();
  const strings: string[] = [];
  for (let i = 0; i < stringCount; i++) {
    const len = view.getUint16(pos, true); pos += 2;
    const str = decoder.decode(data.subarray(pos, pos + len));
    strings.push(str);
    pos += len;
  }

  // Active layer
  const activeLayerIdx = view.getUint16(pos, true); pos += 2;
  const activeLayerId = strings[activeLayerIdx] ?? '';

  // Layers
  const layerCount = data[pos++];
  const layers: LayerMeta[] = [];

  for (let i = 0; i < layerCount; i++) {
    const idIdx = view.getUint16(pos, true); pos += 2;
    const nameIdx = view.getUint16(pos, true); pos += 2;
    const level = data[pos++] as GridLevel;
    const flags = data[pos++];
    const opacityRaw = view.getUint16(pos, true); pos += 2;
    const order = view.getInt16(pos, true); pos += 2;

    const visible = (flags & 0x01) !== 0;
    const locked = (flags & 0x02) !== 0;
    const shiftX: 0 | 0.5 = (flags & 0x04) !== 0 ? 0.5 : 0;
    const shiftY: 0 | 0.5 = (flags & 0x08) !== 0 ? 0.5 : 0;
    const opacity = opacityRaw / 10000;

    const cellCount = CELL_COUNTS[level];
    const cells: (CellState | null)[][] = [];
    for (let y = 0; y < cellCount; y++) {
      const row: (CellState | null)[] = [];
      for (let x = 0; x < cellCount; x++) {
        const tag = data[pos++];
        if (tag === TAG_NULL) {
          row.push(null);
        } else if (tag === TAG_COLOR) {
          const r = data[pos++];
          const g = data[pos++];
          const b = data[pos++];
          const transform = decodeTransform(data[pos++]);
          row.push({ type: 'color', r, g, b, transform });
        } else if (tag === TAG_SPRITE) {
          const spriteIdx = (data[pos] << 8) | data[pos + 1]; pos += 2;
          const transform = decodeTransform(data[pos++]);
          row.push({ type: 'sprite', spriteId: strings[spriteIdx] ?? '', transform });
        } else if (tag === TAG_SPRITE_TINT) {
          const spriteIdx = (data[pos] << 8) | data[pos + 1]; pos += 2;
          const transform = decodeTransform(data[pos++]);
          const tintR = data[pos++];
          const tintG = data[pos++];
          const tintB = data[pos++];
          row.push({ type: 'sprite', spriteId: strings[spriteIdx] ?? '', transform, tintR, tintG, tintB });
        } else {
          throw new Error(`Unknown cell tag: ${tag} at offset ${pos - 1}`);
        }
      }
      cells.push(row);
    }

    // Edge cells (v2+)
    let edgeRowTop: (CellState | null)[] | null = null;
    let edgeColLeft: (CellState | null)[] | null = null;
    let edgeCorner: CellState | null = null;
    if (version >= 2) {
      if (shiftY === 0.5) {
        edgeRowTop = [];
        for (let x = 0; x < cellCount; x++) {
          const result = deserializeOneCell(data, pos, strings);
          edgeRowTop.push(result.cell);
          pos = result.pos;
        }
      }
      if (shiftX === 0.5) {
        edgeColLeft = [];
        for (let y = 0; y < cellCount; y++) {
          const result = deserializeOneCell(data, pos, strings);
          edgeColLeft.push(result.cell);
          pos = result.pos;
        }
      }
      if (shiftX === 0.5 && shiftY === 0.5) {
        const result = deserializeOneCell(data, pos, strings);
        edgeCorner = result.cell;
        pos = result.pos;
      }
    }

    layers.push({
      id: strings[idIdx] ?? '',
      name: strings[nameIdx] ?? '',
      level,
      visible,
      opacity,
      order,
      shiftX,
      shiftY,
      locked,
      cells,
      cellsGeneration: 0,
      edgeRowTop,
      edgeColLeft,
      edgeCorner,
    });
  }

  const result: FileMeta = { activeLayerId, layers, widthL0, heightL0, originL0X, originL0Y };
  if (clipBox) result.clipBox = clipBox;
  return result;
}

function deserializeOneCell(
  data: Uint8Array,
  pos: number,
  strings: string[],
): { cell: CellState | null; pos: number } {
  const tag = data[pos++];
  if (tag === TAG_NULL) {
    return { cell: null, pos };
  } else if (tag === TAG_COLOR) {
    const r = data[pos++];
    const g = data[pos++];
    const b = data[pos++];
    const transform = decodeTransform(data[pos++]);
    return { cell: { type: 'color', r, g, b, transform }, pos };
  } else if (tag === TAG_SPRITE) {
    const spriteIdx = (data[pos] << 8) | data[pos + 1]; pos += 2;
    const transform = decodeTransform(data[pos++]);
    return { cell: { type: 'sprite', spriteId: strings[spriteIdx] ?? '', transform }, pos };
  } else if (tag === TAG_SPRITE_TINT) {
    const spriteIdx = (data[pos] << 8) | data[pos + 1]; pos += 2;
    const transform = decodeTransform(data[pos++]);
    const tintR = data[pos++];
    const tintG = data[pos++];
    const tintB = data[pos++];
    return { cell: { type: 'sprite', spriteId: strings[spriteIdx] ?? '', transform, tintR, tintG, tintB }, pos };
  } else {
    throw new Error(`Unknown cell tag: ${tag} at offset ${pos - 1}`);
  }
}
