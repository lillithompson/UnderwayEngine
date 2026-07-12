import {
  __resetForTests,
  cacheSampleBlob,
  getCachedSampleBlob,
} from '../sessionBlobCache';

describe('sessionBlobCache', () => {
  beforeEach(() => {
    __resetForTests();
  });

  it('returns undefined for a miss', () => {
    expect(getCachedSampleBlob('manifest-a')).toBeUndefined();
  });

  it('round-trips bytes by manifest id', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    cacheSampleBlob('manifest-a', bytes);
    expect(getCachedSampleBlob('manifest-a')).toBe(bytes);
  });

  it('overwrites a prior cached blob for the same id', () => {
    const first = new Uint8Array([1, 2, 3]);
    const second = new Uint8Array([9, 8, 7, 6]);
    cacheSampleBlob('manifest-a', first);
    cacheSampleBlob('manifest-a', second);
    expect(getCachedSampleBlob('manifest-a')).toBe(second);
  });

  it('isolates entries per manifest id', () => {
    cacheSampleBlob('a', new Uint8Array([1]));
    cacheSampleBlob('b', new Uint8Array([2]));
    expect(getCachedSampleBlob('a')?.[0]).toBe(1);
    expect(getCachedSampleBlob('b')?.[0]).toBe(2);
  });

  it('__resetForTests clears the cache', () => {
    cacheSampleBlob('a', new Uint8Array([1]));
    __resetForTests();
    expect(getCachedSampleBlob('a')).toBeUndefined();
  });
});
