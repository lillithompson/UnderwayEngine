import {
  admitEscalation,
  ESCALATION_WINDOW_MS,
  ESCALATION_MAX_PER_WINDOW,
} from '../contextLossRateLimit';

describe('admitEscalation', () => {
  it('admits the first escalation', () => {
    const r = admitEscalation([], 1000);
    expect(r.admit).toBe(true);
    expect(r.next).toEqual([1000]);
  });

  it('admits up to ESCALATION_MAX_PER_WINDOW within the window', () => {
    let recent: number[] = [];
    for (let i = 0; i < ESCALATION_MAX_PER_WINDOW; i++) {
      const r = admitEscalation(recent, 1000 + i * 100);
      expect(r.admit).toBe(true);
      recent = r.next;
    }
    expect(recent.length).toBe(ESCALATION_MAX_PER_WINDOW);
  });

  it('rejects the (max+1)th escalation in the same window', () => {
    let recent: number[] = [];
    for (let i = 0; i < ESCALATION_MAX_PER_WINDOW; i++) {
      recent = admitEscalation(recent, 1000 + i).next;
    }
    const r = admitEscalation(recent, 1000 + ESCALATION_MAX_PER_WINDOW);
    expect(r.admit).toBe(false);
    expect(r.next.length).toBe(ESCALATION_MAX_PER_WINDOW);
  });

  it('prunes timestamps older than the window before counting', () => {
    const old = [100, 200];
    // Place `now` far enough ahead that both entries fall outside the window.
    const now = 200 + ESCALATION_WINDOW_MS + 1;
    const r = admitEscalation(old, now);
    expect(r.admit).toBe(true);
    expect(r.next).toEqual([now]);
  });

  it('keeps recent entries that fall inside the window', () => {
    const now = 10_000;
    const inside = now - 1000;
    const outside = now - ESCALATION_WINDOW_MS - 1;
    const r = admitEscalation([outside, inside], now);
    expect(r.admit).toBe(true);
    expect(r.next).toEqual([inside, now]);
  });

  it('does not mutate the input array', () => {
    const input = [500, 600];
    const copy = [...input];
    admitEscalation(input, 1000);
    expect(input).toEqual(copy);
  });

  it('is reusable: blocked window eventually opens up after timestamps age out', () => {
    let recent: number[] = [];
    for (let i = 0; i < ESCALATION_MAX_PER_WINDOW; i++) {
      recent = admitEscalation(recent, 1000 + i).next;
    }
    // Same window — denied.
    expect(admitEscalation(recent, 1500).admit).toBe(false);
    // Far future — admitted, with stale entries pruned.
    const r = admitEscalation(recent, 1000 + ESCALATION_WINDOW_MS + 100);
    expect(r.admit).toBe(true);
    expect(r.next.length).toBe(1);
  });
});
