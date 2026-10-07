import {
  Ticker,
  TickerDriver,
  createManualDriver,
  rafDriver,
  linear,
  quadOut,
  cubicOut,
  cubicInOut,
  backOut,
  mix,
} from '../motion';

describe('motion easings', () => {
  const eases = { linear, quadOut, cubicOut, cubicInOut, backOut };

  it('all map 0 → 0 and 1 → 1', () => {
    for (const ease of Object.values(eases)) {
      expect(ease(0)).toBeCloseTo(0, 10);
      expect(ease(1)).toBeCloseTo(1, 10);
    }
  });

  it('quadOut front-loads progress', () => {
    expect(quadOut(0.5)).toBeCloseTo(0.75);
  });

  it('backOut overshoots past 1 before settling', () => {
    const peak = Math.max(...Array.from({ length: 99 }, (_, i) => backOut((i + 1) / 100)));
    expect(peak).toBeGreaterThan(1);
  });

  it('mix interpolates linearly', () => {
    expect(mix(10, 20, 0.25)).toBe(12.5);
    expect(mix(-1, 1, 0.5)).toBe(0);
  });
});

describe('Ticker', () => {
  it('progresses a tween per frame and completes at duration', () => {
    const { driver, step } = createManualDriver();
    const tk = new Ticker(driver);
    const seen: number[] = [];
    let completed = false;
    tk.tween({ duration: 100, onUpdate: (t) => seen.push(t), onComplete: () => { completed = true; } });
    step(0); // first frame fixes the start time
    step(25);
    step(25);
    step(25);
    step(25);
    expect(seen).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(completed).toBe(true);
    expect(tk.size).toBe(0);
  });

  it('applies the easing to onUpdate progress', () => {
    const { driver, step } = createManualDriver();
    const tk = new Ticker(driver);
    const seen: number[] = [];
    tk.tween({ duration: 100, ease: quadOut, onUpdate: (t) => seen.push(t) });
    step(0);
    step(50);
    expect(seen[1]).toBeCloseTo(0.75);
  });

  it('honors delay before the first update', () => {
    const { driver, step } = createManualDriver();
    const tk = new Ticker(driver);
    const seen: number[] = [];
    tk.tween({ duration: 50, delay: 50, onUpdate: (t) => seen.push(t) });
    step(0);
    step(25); // still inside the delay window
    expect(seen).toEqual([]);
    step(50); // 25ms into the tween
    expect(seen).toEqual([0.5]);
    step(25);
    expect(seen).toEqual([0.5, 1]);
  });

  it('cancel stops updates, resolves done, and skips onComplete', async () => {
    const { driver, step } = createManualDriver();
    const tk = new Ticker(driver);
    const seen: number[] = [];
    let completed = false;
    const handle = tk.tween({
      duration: 100,
      onUpdate: (t) => seen.push(t),
      onComplete: () => { completed = true; },
    });
    step(0);
    step(25);
    handle.cancel();
    step(25);
    step(50);
    await handle.done;
    expect(seen).toEqual([0, 0.25]);
    expect(completed).toBe(false);
    expect(tk.size).toBe(0);
  });

  it('zero duration completes on the first frame', () => {
    const { driver, step } = createManualDriver();
    const tk = new Ticker(driver);
    const seen: number[] = [];
    tk.tween({ duration: 0, onUpdate: (t) => seen.push(t) });
    step(0);
    expect(seen).toEqual([1]);
    expect(tk.size).toBe(0);
  });

  it('runs the driver only while tweens are live, and restarts cleanly', () => {
    const { driver, step } = createManualDriver();
    let starts = 0;
    let stops = 0;
    const counting: TickerDriver = {
      start: (f) => { starts++; driver.start(f); },
      stop: () => { stops++; driver.stop(); },
    };
    const tk = new Ticker(counting);

    tk.tween({ duration: 50, onUpdate: () => {} });
    step(0);
    step(50);
    expect(starts).toBe(1);
    expect(stops).toBe(1);

    // A frame with nothing live must not arrive (driver is stopped).
    const orphan: number[] = [];
    step(100);
    expect(orphan).toEqual([]);

    tk.tween({ duration: 50, onUpdate: () => {} });
    step(0);
    step(50);
    expect(starts).toBe(2);
    expect(stops).toBe(2);
    expect(tk.size).toBe(0);
  });

  it('overlapping tweens share frames and finish independently', () => {
    const { driver, step } = createManualDriver();
    const tk = new Ticker(driver);
    const a: number[] = [];
    const b: number[] = [];
    tk.tween({ duration: 50, onUpdate: (t) => a.push(t) });
    tk.tween({ duration: 100, onUpdate: (t) => b.push(t) });
    step(0);
    step(50);
    expect(a).toEqual([0, 1]);
    expect(b).toEqual([0, 0.5]);
    expect(tk.size).toBe(1);
    step(50);
    expect(b).toEqual([0, 0.5, 1]);
    expect(tk.size).toBe(0);
  });
});

describe('rafDriver', () => {
  // Exported so a frame loop of its own (DrawBots' web/simRender/frameLoop)
  // need not carry a second copy of these ten lines. There is no rAF under
  // jest, so the timeout fallback is the path exercised here.
  const realSetTimeout = globalThis.setTimeout;

  afterEach(() => {
    jest.useRealTimers();
    globalThis.setTimeout = realSetTimeout;
  });

  it("runs the first frame synchronously by default — the Ticker's behaviour", () => {
    jest.useFakeTimers();
    const frames: number[] = [];
    const d = rafDriver();
    d.start((now) => frames.push(now));
    expect(frames).toHaveLength(1);
    jest.advanceTimersByTime(16);
    expect(frames).toHaveLength(2);
    d.stop();
    jest.advanceTimersByTime(100);
    expect(frames).toHaveLength(2);
  });

  it('with immediate: false the first frame is scheduled like every other, so start() cannot re-enter its caller', () => {
    jest.useFakeTimers();
    const frames: number[] = [];
    const d = rafDriver({ immediate: false });
    d.start((now) => frames.push(now));
    expect(frames).toEqual([]);
    jest.advanceTimersByTime(16);
    expect(frames).toHaveLength(1);
    d.stop();
    jest.advanceTimersByTime(100);
    expect(frames).toHaveLength(1);
  });

  it('a driver stopped from inside onFrame schedules nothing more', () => {
    jest.useFakeTimers();
    let count = 0;
    const d = rafDriver();
    d.start(() => { count += 1; d.stop(); });
    expect(count).toBe(1);
    jest.advanceTimersByTime(200);
    expect(count).toBe(1);
  });

  it('start() works again after stop()', () => {
    jest.useFakeTimers();
    let count = 0;
    const d = rafDriver();
    d.start(() => { count += 1; });
    d.stop();
    expect(count).toBe(1);
    d.start(() => { count += 1; });
    expect(count).toBe(2);
    d.stop();
  });
});
