import { clear } from 'idb-keyval';
import { resetPersistenceCaches } from '@/engine/persistence';

// Full IndexedDB wipe for an app's "Reset app" developer tool. This is the
// WebView/web half of the reset — the RN-side half (native AsyncStorage
// settings + home cache) is each app's own `components/resetApp.ts`, because
// the WebView's IndexedDB is not reachable from the native JS context. An
// app's EditorHost mounts this for `?action=resetAll` so it runs in the
// context that owns the data.
//
// idb-keyval's default store is shared by every persistent surface, and the
// wipe is deliberately indiscriminate because they are interleaved in it:
//   • the entry store → `<ns>:entry:` / `:thumb:` / `:view:` / `:index:` /
//     `:settings`, and whatever else the app keys under its namespace
//     (storeKeys.ts)
//   • the engine      → comp_meta_/comp_thumb_ + image blobs (imgBlobKey)
//   • the web home    → `<ns>:homeState:v1`
// so a single clear() removes pages, compositions, cached PNGs, and the
// web-side settings/home cache in one shot — including the orphaned image
// blobs that deleteCompositionData leaves behind. Nothing here reads the
// namespace: clear() takes the whole store, which is the point.
export async function resetJournalData(): Promise<void> {
  await clear();
  // …and the engine's session-lifetime caches, every one of which answers a
  // question about what IS stored ("do I already have this blob?", "have
  // these tiles changed?", "what are the store's keys?"). A wipe makes every
  // answer wrong in the direction that loses data: the next save would skip
  // writing bytes the store no longer holds, and the page would come back
  // without its photos.
  resetPersistenceCaches();
}
