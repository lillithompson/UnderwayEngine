import { useSyncExternalStore } from 'react';
import { createAppPrefStore, type AppPrefStore } from '@/engine/appPrefStore';
import storage from '@/engine/storage';
import { parseStickyCopies, type StickyCopies } from '@/editor-ui/logic/transform';
import {
  PAINT_RECENT_BLENDS_DEFAULT, parseRecentBlends, type PaintRecentBlends,
} from './sliderModeMenu';

// The editor's own user-level preferences: choices that belong to the
// PERSON rather than to the page they were made on, so they follow them
// from file to file and across launches — the blend modes they reach for
// (the Blend capsule's two recent slots), the Copies page's settings.
//
// Kept in the editor's own store (engine/storage — IndexedDB, the same
// store the journal lives in, on the web and inside the native WebView
// alike) through the app-pref shape the grid settings use
// (engine/appPrefStore): one value, one listener set, read lazily on the
// first subscribe. None of these has a Settings row, so there is no host
// that owns them and nothing to seed; the local copy IS the setting.
//
// Each preference validates what it reads back (`parse`): a stored value
// from an older build, or junk, reads as "nothing stored" and the initial
// value stands, rather than feeding a shape the editor no longer draws.
//
// Readers see a change at once; the STORE sees the last of a burst. A
// slider on the Copies page reports every frame of a drag, and one
// IndexedDB write per frame is a write per frame for nothing — so the save
// waits until the value has been still for SAVE_SETTLE_MS.

/** How long a preference must hold still before it is written. */
const SAVE_SETTLE_MS = 300;

export interface EditorPref<T> {
  /** The value now — the initial one until the stored copy has landed. */
  get(): T;
  /** A user change: every reader told, and the value stored. */
  set(next: T): void;
  subscribe(listener: () => void): () => void;
  __resetForTest(initial?: T): void;
}

export function createEditorPref<T>(
  key: string,
  initial: T,
  parse: (raw: unknown) => T | null,
): EditorPref<T> {
  let pending: ReturnType<typeof setTimeout> | null = null;
  const store: AppPrefStore<T> = createAppPrefStore<T>({
    initial,
    load: async () => {
      try {
        const text = await storage.getItem(key);
        return text === null ? null : parse(JSON.parse(text));
      } catch {
        return null;
      }
    },
    save: (value) => {
      if (pending !== null) clearTimeout(pending);
      pending = setTimeout(() => {
        pending = null;
        void storage.setItem(key, JSON.stringify(value)).catch(() => {});
      }, SAVE_SETTLE_MS);
    },
  });
  return {
    get: () => store.getSnapshot(),
    set: (next) => store.set(next),
    subscribe: (listener) => store.subscribe(listener),
    __resetForTest: (reset) => store.__resetForTest(reset),
  };
}

/** A React reader of a preference: re-renders when it moves (including when
 *  the stored copy lands after the first paint). */
export function useEditorPref<T>(pref: EditorPref<T>): T {
  return useSyncExternalStore(pref.subscribe, pref.get, pref.get);
}

// ── The preferences ──────────────────────────────────────────────────

/** The Blend capsule's two recent slots (sliderModeMenu.rememberBlend):
 *  the modes other than Normal the person armed last, whichever page they
 *  armed them on. */
export const recentBlendsPref = createEditorPref<PaintRecentBlends>(
  'app_blend_recents', PAINT_RECENT_BLENDS_DEFAULT, parseRecentBlends,
);

/** What the Copies page remembers (editor-ui StickyCopies): every setting
 *  the person has moved there, on any object in any file — never the count,
 *  which opens at 0 every time. */
export const copiesStickyPref = createEditorPref<StickyCopies>(
  'app_copies_sticky', {}, parseStickyCopies,
);
