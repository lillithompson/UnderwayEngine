import { exportCompositionsAsZip } from '../compositionExportZip';

const mockExportCompositionPNG = jest.fn();
const mockExportCompositionSVG = jest.fn();
const mockExportCompositionBundle = jest.fn();
const mockLoadCompositionState = jest.fn();

jest.mock('../compositionExport', () => ({
  exportCompositionPNG: (...args: unknown[]) => mockExportCompositionPNG(...args),
  exportCompositionSVG: (...args: unknown[]) => mockExportCompositionSVG(...args),
}));

jest.mock('../persistence', () => ({
  exportCompositionBundle: (...args: unknown[]) => mockExportCompositionBundle(...args),
  loadCompositionState: (...args: unknown[]) => mockLoadCompositionState(...args),
}));

function readUint32LE(buf: Uint8Array, offset: number): number {
  return (buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24)) >>> 0;
}
function readUint16LE(buf: Uint8Array, offset: number): number {
  return buf[offset] | (buf[offset + 1] << 8);
}

function eocdEntryCount(zip: Uint8Array): number {
  return readUint16LE(zip, zip.length - 22 + 10);
}

function readCentralDirectoryNames(zip: Uint8Array): string[] {
  const eocd = zip.length - 22;
  const cdStart = readUint32LE(zip, eocd + 16);
  const total = readUint16LE(zip, eocd + 10);
  const decoder = new TextDecoder();
  const names: string[] = [];
  let pos = cdStart;
  for (let i = 0; i < total; i++) {
    const nameLen = readUint16LE(zip, pos + 28);
    const extraLen = readUint16LE(zip, pos + 30);
    const commentLen = readUint16LE(zip, pos + 32);
    names.push(decoder.decode(zip.subarray(pos + 46, pos + 46 + nameLen)));
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

function localEntryPayloads(zip: Uint8Array): Map<string, Uint8Array> {
  const decoder = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  let pos = 0;
  while (readUint32LE(zip, pos) === 0x04034b50) {
    const compSize = readUint32LE(zip, pos + 18);
    const nameLen = readUint16LE(zip, pos + 26);
    const extraLen = readUint16LE(zip, pos + 28);
    const nameStart = pos + 30;
    const dataStart = nameStart + nameLen + extraLen;
    const name = decoder.decode(zip.subarray(nameStart, nameStart + nameLen));
    out.set(name, zip.subarray(dataStart, dataStart + compSize));
    pos = dataStart + compSize;
  }
  return out;
}

beforeEach(() => {
  mockExportCompositionPNG.mockReset();
  mockExportCompositionSVG.mockReset();
  mockExportCompositionBundle.mockReset();
  mockLoadCompositionState.mockReset();
});

describe('exportCompositionsAsZip', () => {
  test('PNG: bundles entries and threads per-composition strokeScale (with 0.2 default)', async () => {
    // "AA==" base64-decodes to a single 0x00 byte — exact value doesn't matter, just
    // needs to round-trip through the decoder.
    mockExportCompositionPNG.mockImplementation((id: string) =>
      Promise.resolve(`data:image/png;base64,${id === 'a' ? 'AAEC' : 'AwQF'}`),
    );
    mockLoadCompositionState.mockImplementation((id: string) =>
      Promise.resolve(id === 'a' ? { strokeScale: 0.5 } : null),
    );

    const zip = await exportCompositionsAsZip(
      [
        { id: 'a', name: 'Alpha' },
        { id: 'b', name: 'Beta' },
      ],
      'png',
      { pngMaxDimension: 1024 },
    );

    expect(zip).not.toBeNull();
    expect(eocdEntryCount(zip!)).toBe(2);
    expect(readCentralDirectoryNames(zip!)).toEqual(['Alpha.png', 'Beta.png']);

    // Per-comp strokeScale: 0.5 for "a", 0.2 default for "b".
    expect(mockExportCompositionPNG).toHaveBeenCalledWith('a', 1024, 0.5);
    expect(mockExportCompositionPNG).toHaveBeenCalledWith('b', 1024, 0.2);

    // Decoded payloads.
    const payloads = localEntryPayloads(zip!);
    expect(Array.from(payloads.get('Alpha.png')!)).toEqual([0x00, 0x01, 0x02]);
    expect(Array.from(payloads.get('Beta.png')!)).toEqual([0x03, 0x04, 0x05]);
  });

  test('SVG: bundles UTF-8 SVG payloads with per-comp strokeScale', async () => {
    mockExportCompositionSVG.mockImplementation((id: string) =>
      Promise.resolve(`<svg id="${id}"/>`),
    );
    mockLoadCompositionState.mockResolvedValue({ strokeScale: 0.75 });

    const zip = await exportCompositionsAsZip(
      [{ id: 'a', name: 'Alpha' }],
      'svg',
      { pngMaxDimension: 1024 },
    );

    expect(zip).not.toBeNull();
    expect(readCentralDirectoryNames(zip!)).toEqual(['Alpha.svg']);
    expect(mockExportCompositionSVG).toHaveBeenCalledWith('a', undefined, 0.75);

    const payloads = localEntryPayloads(zip!);
    expect(new TextDecoder().decode(payloads.get('Alpha.svg')!)).toBe('<svg id="a"/>');
  });

  test('tile: bundles binary payloads and does not load composition state', async () => {
    mockExportCompositionBundle.mockImplementation((id: string) =>
      Promise.resolve(new Uint8Array([id.charCodeAt(0), 0xff])),
    );

    const zip = await exportCompositionsAsZip(
      [
        { id: 'a', name: 'Alpha' },
        { id: 'b', name: 'Beta' },
      ],
      'tile',
      { pngMaxDimension: 1024 },
    );

    expect(zip).not.toBeNull();
    expect(readCentralDirectoryNames(zip!)).toEqual(['Alpha.tile', 'Beta.tile']);
    expect(mockLoadCompositionState).not.toHaveBeenCalled();

    const payloads = localEntryPayloads(zip!);
    expect(Array.from(payloads.get('Alpha.tile')!)).toEqual([0x61, 0xff]);
    expect(Array.from(payloads.get('Beta.tile')!)).toEqual([0x62, 0xff]);
  });

  test('skips compositions whose payload comes back null', async () => {
    mockExportCompositionBundle
      .mockResolvedValueOnce(new Uint8Array([1, 2, 3]))
      .mockResolvedValueOnce(null);

    const zip = await exportCompositionsAsZip(
      [
        { id: 'a', name: 'Alpha' },
        { id: 'b', name: 'Beta' },
      ],
      'tile',
      { pngMaxDimension: 1024 },
    );

    expect(zip).not.toBeNull();
    expect(eocdEntryCount(zip!)).toBe(1);
    expect(readCentralDirectoryNames(zip!)).toEqual(['Alpha.tile']);
  });

  test('returns null when every payload is empty', async () => {
    mockExportCompositionBundle.mockResolvedValue(null);

    const zip = await exportCompositionsAsZip(
      [{ id: 'a', name: 'Alpha' }],
      'tile',
      { pngMaxDimension: 1024 },
    );

    expect(zip).toBeNull();
  });

  test('duplicate sanitized names fall back to <stem>_<id>.<ext>', async () => {
    mockExportCompositionBundle.mockResolvedValue(new Uint8Array([0]));

    const zip = await exportCompositionsAsZip(
      [
        { id: 'a', name: 'My Comp' },
        { id: 'b', name: 'My/Comp' }, // sanitizes to "My_Comp" — collides with "My_Comp" from the first
      ],
      'tile',
      { pngMaxDimension: 1024 },
    );

    expect(readCentralDirectoryNames(zip!)).toEqual(['My_Comp.tile', 'My_Comp_b.tile']);
  });

  test('special characters in names are sanitized', async () => {
    mockExportCompositionBundle.mockResolvedValue(new Uint8Array([0]));

    const zip = await exportCompositionsAsZip(
      [{ id: 'a', name: 'Hello, world!' }],
      'tile',
      { pngMaxDimension: 1024 },
    );

    expect(readCentralDirectoryNames(zip!)).toEqual(['Hello__world_.tile']);
  });
});
