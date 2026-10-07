import {
  type CompositionBundle,
  deserializeComposition,
  serializeComposition,
} from '../compositionBinaryFormat';

// `deserializeComposition` returns after the last section it knows about and
// never checks whether anything follows, while it DOES refuse a version
// above its own. That pair of properties is a FORMAT GUARANTEE, not an
// accident of the implementation: it is what lets a consumer append its own
// data after the engine's bytes and still have the file read — here, and in
// every other tool that reads the format — as an ordinary composition.
//
// DrawBots relies on it (docs/drawBot.md §1.3 item 8, §7.2): a `.tile` from
// a DrawBots canvas is the engine's bundle with a `DBOT` trailer holding its
// simulation document, so the file opens in Mmoment as the drawing it is and
// comes back into DrawBots with its bots. Appending is the whole design.
//
// So: do not add a trailing-byte check, and do not move the version gate.
// If either has to change, the appending consumers need a different story
// first — this test is where that conversation starts.

function bundle(): CompositionBundle {
  return {
    name: 'Trailing',
    gridLevel: 1,
    strokeScale: 8,
    gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    figures: [],
    svgObjects: [
      {
        id: 'svg_a',
        name: 'a line',
        color: { r: 255, g: 255, b: 255 },
        stroke: { width: 0.5 },
        segments: [{ kind: 'line', start: [0, 0], end: [4, 4] }],
        cellX: 0,
        cellY: 0,
        cellWidth: 4,
        cellHeight: 4,
      },
    ],
    sceneOrder: ['svg_a'],
  };
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}

describe('bytes after the last section are ignored', () => {
  const clean = serializeComposition(bundle(), []);
  const expected = deserializeComposition(clean);

  it('reads the same composition however much junk follows', () => {
    for (const extra of [1, 2, 7, 64, 4096]) {
      const junk = new Uint8Array(extra).map((_, i) => (i * 131 + 7) & 0xff);
      expect(deserializeComposition(concat(clean, junk))).toEqual(expected);
    }
  });

  it('…including bytes that look like a section header of their own', () => {
    // A consumer's trailer carries its own magic and length; nothing about
    // the shape of what follows may change how the engine's part reads.
    const trailer = new Uint8Array([0x44, 0x42, 0x4f, 0x54, 1, 0, 0, 0, 0xff, 0xff, 0xff, 0xff]);
    expect(deserializeComposition(concat(clean, trailer))).toEqual(expected);
  });

  it('still refuses a version above its own — the gate an appender must never move', () => {
    // The u16 at offset 4 (header: "FCMP", version, …). An appended trailer
    // leaves it alone, which is exactly what keeps the file an engine file.
    const bumped = Uint8Array.from(clean);
    new DataView(bumped.buffer).setUint16(4, 0xffff, true);
    expect(() => deserializeComposition(bumped)).toThrow(/Unsupported composition format version/);
  });
});
