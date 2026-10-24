import type { CompositionState } from '@/engine/types';
import type { PhotoPlaceholder } from '../editorSession';
import { storeKey } from '../store/storeKeys';

// The un-filled photo slot (CozyJournal's Haiku photo, and the photos tool's
// drag-to-place box in every app).
//
// The slot is a real ImageObject carrying the well-known placeholder
// `imageId` but *no bytes* in the composition's `imageBlobs`. A byte-less
// image resolves to an empty `src`, so the canvas draws the shared "no image"
// mountain fallback for it (../components/missingImageArt + ImageNodeLayer) —
// one placeholder visual for every un-set image, no bundled bitmap to ship or
// keep in sync.
//
// The sentinel `imageId` is how the rest of the editor tells "the user hasn't
// added their own photo yet" from a real photo: `isSlotFilled` ignores it, and
// the photos tool removes it when swapping in the picked image. (The node
// recovers via its ordinary `slot:` name tag.)
//
// WHY THE ID IS BUILT RATHER THAN DECLARED. It was `cozy:` / `sol:` /
// `drawbots:photo-placeholder` — three apps, one shape, each app's own word,
// and the file was otherwise byte-identical in all three. That is the shape
// `store/storeKeys.ts` exists for, and this id is not merely shaped like a
// store key: the blob store keys blobs BY `imageId` (each app's
// `persistence.ts`), so the sentinel is literally a key under the app's
// namespace. So it comes through {@link storeKey} rather than becoming a
// second install — stage 6.2a promised the namespaced prefixes would, and
// this is one of them (docs/shared-editor.md §4.2 item 6, stage 6.3d).
//
// It is a FUNCTION, not a constant, for the reason `assetJanitor` reads its
// stamp's key at each use: the app's `registerStoreNamespace` and this
// module's load are both module-scope effects and their order is the
// bundler's. Each app's own `web/formats/photoPlaceholder.ts` captures it
// into the `PHOTO_PLACEHOLDER_IMAGE_ID` constant its screens have always
// imported, and imports its `web/store/storeNamespace` for the side effect
// first — so the order is that file's to guarantee, once, where it can be
// read.

/**
 * The sentinel `imageId` marking an un-filled photo slot (never has a blob),
 * under the app's own namespace: `cozy:photo-placeholder`.
 *
 * Persisted in the user's pages, so it can never be unified into one word
 * the way 6.1's `PACK_FONTS_STYLE_ID` was — see the module header.
 */
export function photoPlaceholderImageId(): string {
  return storeKey('photo-placeholder');
}

export const PHOTO_PLACEHOLDER_MIME = 'image/png' as const;
export const PHOTO_PLACEHOLDER_PIXEL_W = 30;
export const PHOTO_PLACEHOLDER_PIXEL_H = 40;

/** The placeholder as the session's `buildPlacePhotoPlaceholder` takes it
 *  ({@link PhotoPlaceholder}): the three dimensions are the package's and
 *  the sentinel is the app's own word, read through the namespace. */
export function photoPlaceholder(): PhotoPlaceholder {
  return {
    imageId: photoPlaceholderImageId(),
    mime: PHOTO_PLACEHOLDER_MIME,
    pixelW: PHOTO_PLACEHOLDER_PIXEL_W,
    pixelH: PHOTO_PLACEHOLDER_PIXEL_H,
  };
}

/**
 * Strip any bytes stored under the placeholder sentinel from a loaded
 * composition's `imageBlobs`, returning a map that has no such entry.
 *
 * The sentinel `imageId` is a fixed, SHARED key in the persistent blob store
 * (persistence.ts keys blobs by `imageId`). Older builds seeded a bitmap under
 * it, so `loadCompositionState` rehydrates those stale bytes on reopen — which
 * would give the un-filled slot a real `src` and render the old bitmap instead
 * of the "no image" mountain. The un-filled placeholder must always resolve to
 * an empty `src`, so we drop the sentinel's bytes on load (canvas, export, and
 * the next save all then treat it as un-set). Returns the input unchanged when
 * there's nothing to strip.
 */
export function dropPlaceholderBlob(
  imageBlobs: Record<string, Uint8Array> | undefined,
): Record<string, Uint8Array> | undefined {
  const sentinel = photoPlaceholderImageId();
  if (!imageBlobs || !(sentinel in imageBlobs)) return imageBlobs;
  const { [sentinel]: _drop, ...rest } = imageBlobs;
  return rest;
}

/**
 * Whether `nodeId` is the seeded photo placeholder — an image still showing
 * the sentinel blob, i.e. the user hasn't picked a real photo yet. The editor
 * keys the tap-to-replace affordance off this: a single tap on the unset
 * placeholder opens the replace picker (a tap on any real image does not).
 *
 * Here beside the sentinel rather than in `scaffold.ts`, which is where
 * CozyJournal and DrawBots kept it: Sol has no scaffold and kept it here, and
 * Sol's placement is the one that survives the move — the test is about the
 * sentinel, not about a slot.
 */
export function isUnfilledPhotoPlaceholder(state: CompositionState, nodeId: string): boolean {
  const sentinel = photoPlaceholderImageId();
  return (state.images ?? []).some((i) => i.id === nodeId && i.imageId === sentinel);
}
