/**
 * The v70 binary format extension: host-data chunks.
 *
 * A generic, namespaced section at the END of the file — `u16 chunkCount`,
 * then per chunk `u16 keyLen`, the key as UTF-8, `u32 byteLen`, the bytes —
 * behind metadata flags bit 0x02, written only when the map has an entry.
 * The engine carries the bytes and never reads them: what a host puts in
 * `CompositionBundle.hostChunks` is what it gets back. So these pin the
 * round trip, the v69 shape of a file with nothing to carry, the section's
 * own byte layout, and the guards every other section has.
 *
 * Mirrors binaryFormatV65PatternFade.test.ts for the record before it.
 */

import {
  serializeComposition,
  deserializeComposition,
  CompositionBundle,
} from '../compositionBinaryFormat';
import { PatternObject } from '../types';

/** The version field (u16 LE at 4) and the v60 metadata flags byte: header
 *  8 + nameIdx 2 + gridLevel 1 + five f64 40 + coordScaleLog2 1. */
const VERSION_AT = 4;
const FLAGS_AT = 52;
const FLAG_HAS_HOST_CHUNKS = 0x02;

function makePattern(id: string): PatternObject {
  const cells = new Array(4).fill(null);
  cells[1] = {
    type: 'color' as const, r: 200, g: 100, b: 50,
    transform: { rotation: 0 as const, mirrorH: false, mirrorV: false },
  };
  return { id, cellX: 3, cellY: 1, cellWidth: 6, cellHeight: 4, cols: 2, rows: 2, cells };
}

function makeBundle(hostChunks?: Record<string, Uint8Array>): CompositionBundle {
  // A pattern object, so the chunks follow a real last section rather than
  // an empty count.
  const patternObjects = [makePattern('pat_1')];
  return {
    name: 'Test', gridLevel: 1, strokeScale: 0.2, gridIntensity: 0.3,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    figures: [],
    svgObjects: [],
    patternObjects,
    sceneOrder: patternObjects.map((p) => p.id),
    ...(hostChunks ? { hostChunks } : {}),
  };
}

const bytesOf = (...b: number[]) => new Uint8Array(b);
const sameBytes = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

describe('v70 host-data chunks', () => {
  it('round-trips every chunk, bytes and keys as they went in', () => {
    const sol = bytesOf(1, 2, 3, 4, 5);
    const empty = new Uint8Array(0);
    const utf8 = bytesOf(0xe2, 0x80, 0x94);
    const out = deserializeComposition(serializeComposition(makeBundle({ sol, empty, 'ünïcödé key': utf8 }), []));
    expect(out.meta.hostChunks).toEqual({ sol, empty, 'ünïcödé key': utf8 });
    // The document around them is untouched.
    expect(out.meta.patternObjects?.map((p) => p.id)).toEqual(['pat_1']);
    expect(out.meta.name).toBe('Test');
  });

  it('a returned chunk is a copy, not a window on the payload', () => {
    const file = serializeComposition(makeBundle({ sol: bytesOf(7, 8, 9) }), []);
    const out = deserializeComposition(file);
    const chunk = out.meta.hostChunks!.sol;
    expect(chunk.buffer).not.toBe(file.buffer);
    expect(chunk.byteLength).toBe(3);
  });

  it('writes version 70 and sets flags bit 0x02 only when there is a chunk', () => {
    const bare = serializeComposition(makeBundle(), []);
    const chunky = serializeComposition(makeBundle({ sol: bytesOf(1) }), []);
    expect(new DataView(bare.buffer).getUint16(VERSION_AT, true)).toBe(70);
    expect(new DataView(chunky.buffer).getUint16(VERSION_AT, true)).toBe(70);
    expect(bare[FLAGS_AT] & FLAG_HAS_HOST_CHUNKS).toBe(0);
    expect(chunky[FLAGS_AT] & FLAG_HAS_HOST_CHUNKS).toBe(FLAG_HAS_HOST_CHUNKS);
  });

  it('an empty map writes no section: the file is its v69 form with a v70 version field', () => {
    const absent = serializeComposition(makeBundle(), []);
    const empty = serializeComposition(makeBundle({}), []);
    expect(sameBytes(absent, empty)).toBe(true);
    expect(deserializeComposition(absent).meta.hostChunks).toBeUndefined();
    expect(deserializeComposition(empty).meta.hostChunks).toBeUndefined();
    // The same bytes with the version field turned back to 69 are a file a
    // v69 reader lays out identically — and this reader still reads them.
    const asV69 = new Uint8Array(absent);
    new DataView(asV69.buffer).setUint16(VERSION_AT, 69, true);
    const back = deserializeComposition(asV69);
    expect(back.meta.hostChunks).toBeUndefined();
    expect(back.meta.patternObjects?.map((p) => p.id)).toEqual(['pat_1']);
  });

  it('costs exactly the section on the wire: count, then keyLen + key + byteLen + bytes per chunk', () => {
    const bare = serializeComposition(makeBundle(), []);
    const one = serializeComposition(makeBundle({ sol: bytesOf(1, 2, 3) }), []);
    expect(one.length - bare.length).toBe(2 + (2 + 3 + 4 + 3));
    // The section is the tail of the file, laid out as the note says.
    const tail = one.subarray(bare.length);
    expect(Array.from(tail)).toEqual([
      1, 0,              // chunkCount u16 LE
      3, 0,              // keyLen u16 LE
      0x73, 0x6f, 0x6c,  // "sol"
      3, 0, 0, 0,        // byteLen u32 LE
      1, 2, 3,           // the bytes
    ]);
    // …and everything before it is the bare file, byte for byte.
    expect(sameBytes(one.subarray(0, bare.length), bare)).toBe(false); // the flags byte differs
    const oneFlagsCleared = new Uint8Array(one.subarray(0, bare.length));
    oneFlagsCleared[FLAGS_AT] &= ~FLAG_HAS_HOST_CHUNKS;
    expect(sameBytes(oneFlagsCleared, bare)).toBe(true);
  });

  it('writes keys in sorted order, so the bytes do not depend on how the map was built', () => {
    const ab = serializeComposition(makeBundle({ a: bytesOf(1), b: bytesOf(2) }), []);
    const ba = serializeComposition(makeBundle({ b: bytesOf(2), a: bytesOf(1) }), []);
    expect(sameBytes(ab, ba)).toBe(true);
  });

  it('a 16 MB chunk round-trips', () => {
    const big = new Uint8Array(16 * 1024 * 1024);
    for (let i = 0; i < big.length; i += 4099) big[i] = i & 0xff;
    const out = deserializeComposition(serializeComposition(makeBundle({ sol: big }), []));
    const chunk = out.meta.hostChunks!.sol;
    expect(chunk.length).toBe(big.length);
    expect(sameBytes(chunk, big)).toBe(true);
  });

  it('refuses a chunk count or a key past the u16, like every other section', () => {
    const tooMany: Record<string, Uint8Array> = {};
    for (let i = 0; i < 0x10000; i++) tooMany[`k${i}`] = bytesOf(0);
    expect(() => serializeComposition(makeBundle(tooMany), [])).toThrow(/host chunk count 65536 exceeds u16 max/);
    expect(() => serializeComposition(makeBundle({ ['k'.repeat(0x10000)]: bytesOf(0) }), []))
      .toThrow(/host chunk key byte count 65536 exceeds u16 max/);
  });

  it('refuses a truncated file rather than reading past its end', () => {
    const whole = serializeComposition(makeBundle({ sol: bytesOf(1, 2, 3, 4) }), []);
    expect(() => deserializeComposition(whole.subarray(0, whole.length - 2))).toThrow(/truncated: host chunk "sol" claims 4 bytes/);
  });
});
