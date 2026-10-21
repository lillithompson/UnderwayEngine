import { bumpFontsEpoch, getFontsEpoch, subscribeFontsEpoch } from '../fontsEpoch';

describe('fontsEpoch', () => {
  it('bumps monotonically and notifies current subscribers', () => {
    const before = getFontsEpoch();
    let calls = 0;
    const unsub = subscribeFontsEpoch(() => { calls += 1; });

    bumpFontsEpoch();
    expect(getFontsEpoch()).toBe(before + 1);
    expect(calls).toBe(1);

    unsub();
    bumpFontsEpoch();
    // No longer notified after unsubscribe, but the epoch still advances.
    expect(calls).toBe(1);
    expect(getFontsEpoch()).toBe(before + 2);
  });
});
