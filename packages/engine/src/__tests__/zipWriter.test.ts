import { buildZip, crc32 } from '../zipWriter';

describe('crc32', () => {
  // Standard CRC-32 (IEEE 802.3) test vectors.
  test('empty input → 0', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  test('"123456789" → 0xCBF43926', () => {
    const data = new TextEncoder().encode('123456789');
    expect(crc32(data) >>> 0).toBe(0xcbf43926);
  });

  test('"The quick brown fox jumps over the lazy dog" → 0x414FA339', () => {
    const data = new TextEncoder().encode('The quick brown fox jumps over the lazy dog');
    expect(crc32(data) >>> 0).toBe(0x414fa339);
  });
});

describe('buildZip', () => {
  function readUint32LE(buf: Uint8Array, offset: number): number {
    return (buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24)) >>> 0;
  }
  function readUint16LE(buf: Uint8Array, offset: number): number {
    return buf[offset] | (buf[offset + 1] << 8);
  }

  test('produces PK local file header magic', () => {
    const zip = buildZip([{ name: 'a.txt', data: new TextEncoder().encode('hi') }]);
    expect(readUint32LE(zip, 0)).toBe(0x04034b50);
  });

  test('end-of-central-directory record is parseable and correct', () => {
    const a = new TextEncoder().encode('alpha');
    const b = new TextEncoder().encode('beta-beta');
    const zip = buildZip([
      { name: 'a.txt', data: a },
      { name: 'b.txt', data: b },
    ]);

    // EOCD is the last 22 bytes when there's no comment.
    const eocdOffset = zip.length - 22;
    expect(readUint32LE(zip, eocdOffset)).toBe(0x06054b50);
    expect(readUint16LE(zip, eocdOffset + 8)).toBe(2);  // entries on this disk
    expect(readUint16LE(zip, eocdOffset + 10)).toBe(2); // total entries
    const cdSize = readUint32LE(zip, eocdOffset + 12);
    const cdStart = readUint32LE(zip, eocdOffset + 16);
    expect(cdStart + cdSize).toBe(eocdOffset);

    // Central directory should start with the CD signature.
    expect(readUint32LE(zip, cdStart)).toBe(0x02014b50);
  });

  test('local headers carry correct CRC and size for each entry', () => {
    const data = new TextEncoder().encode('hello world');
    const zip = buildZip([{ name: 'greet.txt', data }]);

    expect(readUint32LE(zip, 14)).toBe(crc32(data));     // CRC field
    expect(readUint32LE(zip, 18)).toBe(data.length);     // compressed size
    expect(readUint32LE(zip, 22)).toBe(data.length);     // uncompressed size
    expect(readUint16LE(zip, 26)).toBe('greet.txt'.length); // name length
    expect(readUint16LE(zip, 8)).toBe(0);                 // method = stored
  });

  test('handles an empty entry list', () => {
    const zip = buildZip([]);
    // Just an EOCD record.
    expect(zip.length).toBe(22);
    expect(readUint32LE(zip, 0)).toBe(0x06054b50);
    expect(readUint16LE(zip, 10)).toBe(0);
  });
});
