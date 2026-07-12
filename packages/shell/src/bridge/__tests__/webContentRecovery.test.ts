import {
  recordTermination,
  resetGuard,
  MAX_TERMINATIONS,
  WINDOW_MS,
  __webContentRecoveryInternals,
} from '../webContentRecovery';

const { peekTimestamps } = __webContentRecoveryInternals;

afterEach(() => {
  resetGuard();
});

describe('recordTermination', () => {
  it('first termination allows reload, attempt=1', () => {
    expect(recordTermination(1000)).toEqual({ allowReload: true, attempt: 1 });
  });

  it('second termination within the window allows reload, attempt=2', () => {
    recordTermination(1000);
    expect(recordTermination(1500)).toEqual({ allowReload: true, attempt: 2 });
  });

  it('the (MAX+1)th termination within the window is denied', () => {
    // Fill up to and including MAX_TERMINATIONS allowed.
    for (let i = 0; i < MAX_TERMINATIONS; i++) {
      const r = recordTermination(1000 + i * 100);
      expect(r.allowReload).toBe(true);
    }
    // The next one trips the guard.
    const tripped = recordTermination(1000 + MAX_TERMINATIONS * 100);
    expect(tripped.allowReload).toBe(false);
    expect(tripped.attempt).toBe(MAX_TERMINATIONS + 1);
  });

  it('a termination after the window closes resets pruning, allowing reload again', () => {
    recordTermination(1000);
    recordTermination(2000);
    const farLater = 2000 + WINDOW_MS + 5_000;
    expect(recordTermination(farLater)).toEqual({ allowReload: true, attempt: 1 });
    expect(peekTimestamps()).toEqual([farLater]);
  });

  it('partial pruning preserves recent timestamps and drops only old ones', () => {
    const t0 = 1000;                     // will age out
    const t1 = 1000 + WINDOW_MS - 1_000; // recent enough to keep
    const t2 = 1000 + WINDOW_MS + 500;   // new, prunes t0
    recordTermination(t0);
    recordTermination(t1);
    const r = recordTermination(t2);
    expect(r.allowReload).toBe(true);
    expect(r.attempt).toBe(2);
    expect(peekTimestamps()).toEqual([t1, t2]);
  });

  it('uses Date.now() when called with no argument', () => {
    const before = Date.now();
    const r = recordTermination();
    const after = Date.now();
    const ts = peekTimestamps();
    expect(ts.length).toBe(1);
    expect(ts[0]).toBeGreaterThanOrEqual(before);
    expect(ts[0]).toBeLessThanOrEqual(after);
    expect(r).toEqual({ allowReload: true, attempt: 1 });
  });
});

describe('resetGuard', () => {
  it('clears state so the next termination is treated as the first', () => {
    recordTermination(1000);
    recordTermination(1500);
    expect(peekTimestamps().length).toBe(2);

    resetGuard();
    expect(peekTimestamps()).toEqual([]);

    expect(recordTermination(2000)).toEqual({ allowReload: true, attempt: 1 });
  });
});
