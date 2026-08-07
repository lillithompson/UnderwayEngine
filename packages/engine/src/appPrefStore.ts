// One shape for the app-level view preferences (Grid Weight, Dimensions, Grid
// Snap): a module-local value plus a listener set, read through
// useSyncExternalStore and persisted lazily on the first subscribe. They were
// three hand-copied modules drifting apart a field at a time; this is the one
// implementation they now share.
//
// `seedFromHost` is what makes them safe under a native shell. When the app
// embeds the editor in a WebView, the NATIVE side owns these preferences (it
// has the settings screen) and hands them over at boot. A seed therefore also
// cancels the lazy local read — otherwise the idb value would land a moment
// later and stomp the host's, which is the classic "my setting reverted a
// second after the editor opened" bug. Local persistence stays as the fallback
// for a standalone web build, where there is no host to ask.

export interface AppPrefStore<T> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): T;
  /** A user change: notified AND persisted locally. */
  set(next: T): void;
  /** A value the host owns: notified, never persisted back, and it takes the
   *  lazy local read out of play. */
  seedFromHost(next: T): void;
  __resetForTest(initial?: T): void;
}

export function createAppPrefStore<T>({ initial, load, save }: {
  initial: T;
  /** Local fallback read. Resolving `null` means "nothing stored". */
  load?: () => Promise<T | null>;
  save?: (value: T) => void;
}): AppPrefStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  let readStarted = false;
  // A host seed or a user change has authoritatively set the value, so an
  // in-flight local read must not land on top of it.
  let overridden = false;

  const emit = () => {
    for (const listener of Array.from(listeners)) listener();
  };

  const assign = (next: T): boolean => {
    if (Object.is(value, next)) return false;
    value = next;
    emit();
    return true;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (!readStarted && load) {
        readStarted = true;
        void load().then((stored) => {
          if (stored === null || overridden) return;
          assign(stored);
        });
      }
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return value;
    },
    set(next) {
      overridden = true;
      if (!assign(next)) return;
      save?.(next);
    },
    seedFromHost(next) {
      overridden = true;
      assign(next);
    },
    __resetForTest(reset: T = initial) {
      value = reset;
      readStarted = false;
      overridden = false;
      listeners.clear();
    },
  };
}
