import { setAssetSweepGuard, sweepImageAssets, type AssetSweepResult } from '@/engine/imageAssetStore';
import { storeKey } from './storeKeys';

// WHEN the image/paint blob janitor runs (the engine's sweepImageAssets is
// the WHAT). Two rules, and they pull in opposite directions:
//
//  1. Never while a page is open. Mark-and-sweep marks from what is STORED,
//     and an editor session holds things that are not: an undo stack
//     reaching back to a photo the user has since replaced, a node deleted a
//     moment ago that redo would bring back. Collect under that and the redo
//     restores a node whose pixels are gone.
//  2. Rarely. A sweep reads every composition record, and the bytes it
//     recovers were orphaned days ago — nothing about this is urgent.
//
// So: on app foreground, at most once a day, and never with the editor up.
// A page delete fires its own sweep (persistence.deleteCompositionData),
// which the same guard covers.
//
// An app with leftovers of its OWN of the same kind — DrawBots' sim
// documents, a `drawbots:sim:` record whose composition is gone — rides
// along on the same schedule through {@link registerExtraSweep}, rather
// than keeping a second once-a-day stamp beside this one.

/** How long a sweep's answer is good for. The orphans are bytes on disk, not
 *  a correctness problem, and the sweep costs a read per composition. */
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Where "when did we last sweep?" lives. Its own key rather than a field on
 *  the settings record: it is bookkeeping, not a preference, and a lost
 *  value costs one extra sweep. Read through the app's namespace at each
 *  use, not captured at module load: the install happens at module scope
 *  and the order between two module-scope effects is the bundler's. */
const lastSweepKey = () => storeKey('assetSweep', 'last');

/** Editor sessions currently open. A count, not a flag: the host can mount a
 *  second surface (the `.tile` import screen rasterizes while the editor is
 *  up) and the last one out has to be the one that clears it. */
let openSessions = 0;

/** Tell the janitor a page is open, and get back the release. Call it from
 *  an editor session's mount effect: `useEffect(() => holdAssetSweep(), [])`. */
export function holdAssetSweep(): () => void {
  openSessions++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    openSessions--;
  };
}

/** For tests, and for a host tearing everything down. */
export function __resetAssetSweepHolds(): void {
  openSessions = 0;
}

/**
 * An app's own sweep of its own leftovers, run on the same schedule.
 *
 * `Promise<unknown>` rather than `Promise<void>`: this module awaits the
 * sweep and discards whatever it answers, so an app's existing sweep — which
 * is likely to report what it removed, as DrawBots' `sweepOrphanSimDocuments`
 * returns a `SimSweepResult` — can be handed over as it stands rather than
 * wrapped in a lambda that throws its result away.
 */
export type ExtraSweep = () => Promise<unknown>;

let extraSweep: ExtraSweep | null = null;

/** Install it (an app's `web/store/assetJanitor.ts` does, at module scope). */
export function registerExtraSweep(fn: ExtraSweep | null): void {
  extraSweep = fn;
}

function lastSweepAt(): number {
  try {
    const raw = globalThis.localStorage?.getItem(lastSweepKey());
    const at = raw ? Number(raw) : NaN;
    return Number.isFinite(at) ? at : 0;
  } catch {
    return 0;
  }
}

function markSwept(at: number): void {
  try {
    globalThis.localStorage?.setItem(lastSweepKey(), String(at));
  } catch { /* a lost stamp costs one extra sweep */ }
}

/**
 * Sweep if it is due and nothing is open. Returns the result when one ran,
 * null when it was declined — which is the ordinary case, since this is
 * called on every foreground.
 *
 * Best-effort by contract: a throw here must never be the reason a
 * foreground fails, so the caller gets null for that too.
 */
export async function sweepIfDue(now: number = Date.now()): Promise<AssetSweepResult | null> {
  if (openSessions > 0) return null;
  if (now - lastSweepAt() < SWEEP_INTERVAL_MS) return null;
  // Stamp BEFORE the sweep, not after: a sweep that throws half way through
  // should not be retried on the next foreground a second later.
  markSwept(now);
  // The app's own leftovers first, if it has any: theirs is a key scan plus
  // an entry listing, and a failure there must not cost the blob sweep its
  // day either.
  if (extraSweep) {
    try {
      await extraSweep();
    } catch { /* best-effort, as below */ }
  }
  try {
    return await sweepImageAssets();
  } catch {
    return null;
  }
}

/**
 * Install the guard and the foreground trigger. Called once per page load,
 * beside an app's own triggers. Returns the teardown.
 */
export function installAssetJanitor(): () => void {
  setAssetSweepGuard(() => openSessions === 0);
  if (typeof document === 'undefined') return () => { setAssetSweepGuard(null); };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') void sweepIfDue();
  };
  document.addEventListener('visibilitychange', onVisibility);
  // …and once on load: an app opened fresh each morning would otherwise
  // never see a foreground transition at all.
  void sweepIfDue();
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    setAssetSweepGuard(null);
  };
}
