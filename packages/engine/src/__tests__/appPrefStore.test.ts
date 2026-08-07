import { createAppPrefStore } from '../appPrefStore';

// The shared shape behind the app-level view preferences. The behavior worth
// pinning is the host/local ordering: under a native shell the settings screen
// owns these values, and a lazy local read that resolves AFTER the host handed
// one over must not win — that is the "my setting reverted a second after the
// editor opened" bug this store exists to prevent.

/** A load that the test resolves by hand, so the race can be run either way. */
function deferredLoad<T>() {
  let resolve!: (value: T | null) => void;
  const promise = new Promise<T | null>((r) => { resolve = r; });
  return { load: () => promise, resolve, promise };
}

describe('createAppPrefStore', () => {
  it('starts at its initial value and reports changes', () => {
    const store = createAppPrefStore<number>({ initial: 0.5 });
    const listener = jest.fn();
    store.subscribe(listener);

    expect(store.getSnapshot()).toBe(0.5);
    store.set(0.8);
    expect(store.getSnapshot()).toBe(0.8);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stays silent when set to the value it already holds', () => {
    const store = createAppPrefStore<boolean>({ initial: true });
    const listener = jest.fn();
    store.subscribe(listener);

    store.set(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it('persists a user change but never a host seed', () => {
    const save = jest.fn();
    const store = createAppPrefStore<boolean>({ initial: false, save });

    store.set(true);
    expect(save).toHaveBeenCalledWith(true);

    save.mockClear();
    store.seedFromHost(false);
    expect(store.getSnapshot()).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it('adopts the local value when nothing has overridden it', async () => {
    const { load, resolve, promise } = deferredLoad<number>();
    const store = createAppPrefStore<number>({ initial: 0.5, load });
    const listener = jest.fn();
    store.subscribe(listener);

    resolve(0.2);
    await promise;
    expect(store.getSnapshot()).toBe(0.2);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps its default when nothing is stored locally', async () => {
    const { load, resolve, promise } = deferredLoad<number>();
    const store = createAppPrefStore<number>({ initial: 0.5, load });
    store.subscribe(() => {});

    resolve(null);
    await promise;
    expect(store.getSnapshot()).toBe(0.5);
  });

  it('does not let a late local read stomp a host seed', async () => {
    const { load, resolve, promise } = deferredLoad<number>();
    const store = createAppPrefStore<number>({ initial: 0.5, load });
    store.subscribe(() => {});

    store.seedFromHost(0.9); // native settings arrive first…
    resolve(0.2); // …then the idb read lands
    await promise;

    expect(store.getSnapshot()).toBe(0.9);
  });

  it('does not let a late local read stomp a live user change', async () => {
    const { load, resolve, promise } = deferredLoad<boolean>();
    const store = createAppPrefStore<boolean>({ initial: false, load });
    store.subscribe(() => {});

    store.set(true);
    resolve(false);
    await promise;

    expect(store.getSnapshot()).toBe(true);
  });

  it('reads locally at most once, however many subscribers arrive', () => {
    const load = jest.fn(() => Promise.resolve(null));
    const store = createAppPrefStore<boolean>({ initial: false, load });

    store.subscribe(() => {});
    store.subscribe(() => {});
    store.subscribe(() => {});

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('stops notifying an unsubscribed listener', () => {
    const store = createAppPrefStore<boolean>({ initial: false });
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    store.set(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it('survives a listener unsubscribing during its own notification', () => {
    // The emit iterates a copy for exactly this: a React root detaching mid-
    // flush must not skip the listener after it.
    const store = createAppPrefStore<boolean>({ initial: false });
    const second = jest.fn();
    const unsubscribeFirst = store.subscribe(() => unsubscribeFirst());
    store.subscribe(second);

    expect(() => store.set(true)).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
