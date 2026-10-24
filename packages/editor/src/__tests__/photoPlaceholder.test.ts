import { registerStoreNamespace } from '../store/storeKeys';
import {
  PHOTO_PLACEHOLDER_MIME,
  PHOTO_PLACEHOLDER_PIXEL_H,
  PHOTO_PLACEHOLDER_PIXEL_W,
  dropPlaceholderBlob,
  isUnfilledPhotoPlaceholder,
  photoPlaceholder,
  photoPlaceholderImageId,
} from '../formats/photoPlaceholder';
import { makeImage, makeScaffoldState } from './test-utils';

// The un-filled photo slot's sentinel (formats/photoPlaceholder.ts). It was
// `cozy:` / `sol:` / `drawbots:photo-placeholder` in three otherwise
// byte-identical files, and it is built from the app's namespace here — the
// blob store keys blobs by `imageId`, so this id IS a key under that word
// (stage 6.3d; see the module header).
//
// What each app keeps is the one thing a package suite cannot assert: its
// own spelling, pinned as a literal, because that word is in every page
// every installed copy of that app has ever saved.

beforeEach(() => {
  registerStoreNamespace('test');
});

describe('the sentinel', () => {
  it('is built under the app’s namespace', () => {
    expect(photoPlaceholderImageId()).toBe('test:photo-placeholder');
    registerStoreNamespace('other');
    expect(photoPlaceholderImageId()).toBe('other:photo-placeholder');
  });

  it('refuses rather than defaulting when no app has installed a namespace', () => {
    // The asymmetry 6.2a weighed: a wrong namespace writes a page nothing
    // will look for again, and here it would make an un-filled placeholder
    // read as a real photo on every page already saved.
    registerStoreNamespace(null);
    expect(() => photoPlaceholderImageId()).toThrow(/no app namespace installed/);
  });

  it('is read at each use, not captured at load', () => {
    // The install and this module's load are both module-scope effects and
    // their order is the bundler's, which is why it is a function — the
    // reason `assetJanitor` reads its stamp's key at each use too.
    expect(photoPlaceholder().imageId).toBe('test:photo-placeholder');
    registerStoreNamespace('later');
    expect(photoPlaceholder().imageId).toBe('later:photo-placeholder');
  });

  it('rides in the shape the session’s placeholder builder takes', () => {
    expect(photoPlaceholder()).toEqual({
      imageId: 'test:photo-placeholder',
      mime: PHOTO_PLACEHOLDER_MIME,
      pixelW: PHOTO_PLACEHOLDER_PIXEL_W,
      pixelH: PHOTO_PLACEHOLDER_PIXEL_H,
    });
  });
});

describe('dropPlaceholderBlob', () => {
  it('removes a stale blob resurrected under the placeholder sentinel', () => {
    const real = new Uint8Array([1, 2, 3]);
    const out = dropPlaceholderBlob({
      [photoPlaceholderImageId()]: new Uint8Array([9, 9]),
      img_real: real,
    });
    // The sentinel is gone (so the slot renders the mountain), real bytes stay.
    expect(out && photoPlaceholderImageId() in out).toBe(false);
    expect(out?.img_real).toBe(real);
  });

  it('returns the same map untouched when there is nothing to strip', () => {
    const blobs = { img_real: new Uint8Array([1]) };
    expect(dropPlaceholderBlob(blobs)).toBe(blobs);
  });

  it('tolerates undefined / empty maps', () => {
    expect(dropPlaceholderBlob(undefined)).toBeUndefined();
    const empty = {};
    expect(dropPlaceholderBlob(empty)).toBe(empty);
  });

  it('strips the CURRENT app’s sentinel, not another app’s', () => {
    // Two apps' pages never share a store, but the id is built rather than
    // declared now, so the pin is worth having: a map keyed under another
    // word is left exactly as it came.
    const other = { 'other:photo-placeholder': new Uint8Array([9]) };
    expect(dropPlaceholderBlob(other)).toBe(other);
  });
});

describe('isUnfilledPhotoPlaceholder', () => {
  it('is true for an image still carrying the sentinel and false for a real photo', () => {
    const unset = makeImage('img_slot', { imageId: photoPlaceholderImageId() });
    const real = makeImage('img_real');
    const state = makeScaffoldState({ images: [unset, real] });
    expect(isUnfilledPhotoPlaceholder(state, 'img_slot')).toBe(true);
    expect(isUnfilledPhotoPlaceholder(state, 'img_real')).toBe(false);
  });

  it('is false for a node that is not an image, and for one that is not there', () => {
    const state = makeScaffoldState({ images: [makeImage('img_real')] });
    expect(isUnfilledPhotoPlaceholder(state, 'txt_1')).toBe(false);
    expect(isUnfilledPhotoPlaceholder(makeScaffoldState(), 'img_slot')).toBe(false);
  });
});
