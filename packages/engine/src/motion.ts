/**
 * Time-based animation core — the engine's first temporal module.
 *
 * The renderers stay demand-driven (draw once per state change); this module
 * provides the temporarily-continuous mode: one shared ticker runs a
 * requestAnimationFrame loop only while tweens are live and goes fully idle
 * the moment the last one finishes (WKWebView battery/jetsam discipline).
 * Design rationale: UnderwayNotes notes/tech/effects-and-feel.md.
 */

export type Ease = (t: number) => number;

export const linear: Ease = (t) => t;
export const quadOut: Ease = (t) => 1 - (1 - t) * (1 - t);
export const cubicOut: Ease = (t) => 1 - Math.pow(1 - t, 3);
export const cubicInOut: Ease = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
/** Overshoots slightly past 1 before settling — for "snap into place". */
export const backOut: Ease = (t) => {
  const c1 = 1.70158;
  return 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export interface TweenOpts {
  /** Total duration in ms (0 or less completes on the first frame). */
  duration: number;
  ease?: Ease;
  /** Delay before the first update, in ms. */
  delay?: number;
  /** Receives eased progress in [0, 1]; called once per frame while live. */
  onUpdate: (t: number) => void;
  onComplete?: () => void;
}

export interface TweenHandle {
  /** Stop updating immediately; resolves `done` without calling onComplete. */
  cancel(): void;
  done: Promise<void>;
}

/** Drives a ticker's frames. start() may be called again after stop(). */
export interface TickerDriver {
  start(onFrame: (nowMs: number) => void): void;
  stop(): void;
}

function rafDriver(): TickerDriver {
  const hasRaf = typeof requestAnimationFrame === 'function';
  let live = false;
  let handle = 0;
  return {
    start(onFrame) {
      live = true;
      const loop = (): void => {
        if (!live) return;
        onFrame(globalThis.performance?.now() ?? Date.now());
        if (!live) return; // the ticker went idle inside onFrame
        handle = hasRaf
          ? requestAnimationFrame(loop)
          : (setTimeout(loop, 16) as unknown as number);
      };
      loop();
    },
    stop() {
      live = false;
      if (hasRaf) cancelAnimationFrame(handle);
      else clearTimeout(handle);
    },
  };
}

interface ActiveTween {
  opts: TweenOpts;
  startAt: number | null; // fixed on the first frame after add (+ delay)
  resolve: () => void;
}

export class Ticker {
  private readonly driver: TickerDriver;
  private readonly tweens = new Set<ActiveTween>();
  private running = false;

  constructor(driver: TickerDriver = rafDriver()) {
    this.driver = driver;
  }

  /** Number of live tweens — the frame loop runs iff this is nonzero. */
  get size(): number {
    return this.tweens.size;
  }

  tween(opts: TweenOpts): TweenHandle {
    let resolve!: () => void;
    const done = new Promise<void>((r) => { resolve = r; });
    const entry: ActiveTween = { opts, startAt: null, resolve };
    this.tweens.add(entry);
    if (!this.running) {
      this.running = true;
      this.driver.start((now) => this.frame(now));
    }
    return {
      done,
      cancel: () => {
        if (this.tweens.delete(entry)) {
          entry.resolve();
          this.stopIfIdle();
        }
      },
    };
  }

  private frame(now: number): void {
    for (const entry of [...this.tweens]) {
      if (!this.tweens.has(entry)) continue; // cancelled by a sibling's callback
      if (entry.startAt === null) entry.startAt = now + (entry.opts.delay ?? 0);
      const elapsed = now - entry.startAt;
      if (elapsed < 0) continue; // still in its delay window
      const t = entry.opts.duration <= 0 ? 1 : Math.min(1, elapsed / entry.opts.duration);
      entry.opts.onUpdate((entry.opts.ease ?? linear)(t));
      if (t >= 1) {
        this.tweens.delete(entry);
        entry.opts.onComplete?.();
        entry.resolve();
      }
    }
    this.stopIfIdle();
  }

  private stopIfIdle(): void {
    if (this.running && this.tweens.size === 0) {
      this.running = false;
      this.driver.stop();
    }
  }
}

/** Shared ticker for app code; tests construct their own with a manual driver. */
export const ticker = new Ticker();

export function tween(opts: TweenOpts): TweenHandle {
  return ticker.tween(opts);
}

/** Deterministic driver for tests: advance time by hand with step(ms). */
export function createManualDriver(): { driver: TickerDriver; step: (ms: number) => void } {
  let onFrame: ((now: number) => void) | null = null;
  let live = false;
  let now = 0;
  return {
    driver: {
      start(f) { onFrame = f; live = true; },
      stop() { live = false; },
    },
    step(ms) {
      now += ms;
      if (live && onFrame) onFrame(now);
    },
  };
}
