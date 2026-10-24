import { bytesToDataUri, imageMimeOf } from '../imageDataUri';

// An image's data URI names the type its bytes declare, whatever anyone
// said about it: the journal's thumb and view are each PNG or JPEG by
// their own pixels.

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('imageMimeOf', () => {
  it('reads JPEG and PNG off their magic', () => {
    expect(imageMimeOf(JPEG)).toBe('image/jpeg');
    expect(imageMimeOf(PNG)).toBe('image/png');
  });

  it('is null for anything else, including too few bytes', () => {
    expect(imageMimeOf(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(imageMimeOf(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(imageMimeOf(new Uint8Array([0x89, 0x50, 0x4e]))).toBeNull();
    expect(imageMimeOf(new Uint8Array([]))).toBeNull();
  });
});

describe('bytesToDataUri', () => {
  it('prefixes the sniffed mime and the base64 of the bytes', () => {
    expect(bytesToDataUri(JPEG)).toBe(`data:image/jpeg;base64,${Buffer.from(JPEG).toString('base64')}`);
    expect(bytesToDataUri(PNG)).toBe(`data:image/png;base64,${Buffer.from(PNG).toString('base64')}`);
  });

  it('falls back to PNG — or the caller\'s own name — for bytes of no known magic', () => {
    const odd = new Uint8Array([1, 2, 3]);
    expect(bytesToDataUri(odd)).toBe('data:image/png;base64,AQID');
    expect(bytesToDataUri(odd, 'image/webp')).toBe('data:image/webp;base64,AQID');
    // …but never over what the bytes themselves say.
    expect(bytesToDataUri(JPEG, 'image/png').startsWith('data:image/jpeg;')).toBe(true);
  });
});
