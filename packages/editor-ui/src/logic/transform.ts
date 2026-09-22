import type { TransformCopiesSpec } from '../adapter';

// The Transform bar's ranges and its opening proposal (components/
// TransformBar.tsx), stated in the object's own units — degrees, cells,
// copies — and kept apart from the component so hosts and tests can read
// them without rendering it.

/** Rotation runs the full circle: (-180, 180]. */
export const ROTATE_MIN = -180;
export const ROTATE_MAX = 180;
/** Copies: from none — the slider parks at 0, so the bar opens with nothing
 *  ghosted and a press lays down nothing until a count is chosen — up to
 *  enough to ring a shape at 15° without running the page into mush. */
export const COPIES_MIN = 0;
export const COPIES_MAX = 24;
/** Position offset per copy, in cells either way; a page is 32 across. */
export const OFFSET_MAX = 8;
/** Scale per copy, either axis: from half again smaller to half again
 *  larger each step. It compounds, so even this modest range takes a
 *  shape from a speck to the page's width across a run of copies. */
export const SCALE_MIN = 0.5;
export const SCALE_MAX = 1.5;
/** What a fresh bar proposes when the object's own ink is not known: no
 *  copies yet (the count is the user's choice), a cell over, a small turn,
 *  the same size — and a run that ends solid and unfaded, which is where
 *  almost every object already stands.
 *
 *  A bar that IS told the ink seeds the two ink values from it
 *  ({@link copiesSeededFrom}), so the sliders open on the object and a press
 *  with nothing touched lays copies that look like it. */
export const DEFAULT_COPIES: TransformCopiesSpec = {
  count: 0, dx: 1, dy: 0, dAngleDeg: 15, sx: 1, sy: 1, finalFade: 0, finalOpacity: 1,
};

/**
 * What the Copies page REMEMBERS between openings: every setting the user has
 * actually moved, on any object, minus the count.
 *
 * Partial on purpose — a key is here only once it has been touched. An
 * untouched key falls back to the seed ({@link copiesSeededFrom}), which
 * matters for the two ink values: those open under the SELECTED object's own
 * opacity and fade, and carrying the last object's across would quietly fade
 * a run the user never asked to fade. A key they moved is a decision and
 * travels; a key they left alone is the object's.
 *
 * The count is never remembered. It is the one setting that says what THIS
 * press lays down rather than what a copy looks like, and a page that
 * re-opened at six would mint six copies on the next press of a button that
 * was never touched. It re-opens at 0 (COPIES_MIN), so a fresh page still
 * ghosts nothing.
 */
export type StickyCopies = Partial<Omit<TransformCopiesSpec, 'count'>>;

/**
 * Fold a change the user just made into what the page remembers — every key
 * of the patch but `count`, which never sticks (see {@link StickyCopies}).
 *
 * Takes the patch the slider already produced rather than the whole draft, so
 * "touched" means exactly the keys a control wrote.
 */
export function rememberedCopies(
  sticky: StickyCopies,
  patch: Partial<TransformCopiesSpec>,
): StickyCopies {
  const { count: _count, ...rest } = patch;
  return { ...sticky, ...rest };
}

/**
 * The opening draft for an object whose ink is known: the defaults above,
 * with the run ENDING where the object already stands. Both ink sliders then
 * open under the object's own values, and moving one says "by the last copy,
 * be this" — the end of the run rather than a per-copy step.
 *
 * `sticky` — what the page remembers from the last time anything was set on
 * it, on any object — is laid over the top: an offset and a turn chosen on
 * one shape are still there when the page opens on the next one, so a run
 * laid down over and over is set up once. It cannot carry a count (the type
 * has no room for one), and it only holds keys that were actually moved, so
 * the ink seeds above survive untouched.
 */
export function copiesSeededFrom(
  ink?: { opacity?: number; fade?: number },
  sticky?: StickyCopies,
): TransformCopiesSpec {
  return {
    ...DEFAULT_COPIES,
    finalFade: clamp01(ink?.fade ?? DEFAULT_COPIES.finalFade),
    finalOpacity: clamp01(ink?.opacity ?? DEFAULT_COPIES.finalOpacity),
    ...sticky,
  };
}

/**
 * The per-copy INK STEP a run of `count` copies takes to land on `final`
 * having started at `from`: the whole walk divided evenly, so the i-th copy
 * sits at `from + step × i` and the last one sits exactly on `final`. More
 * copies, smaller steps — the same end, reached more gently.
 *
 * Shared by the host that lays the copies down and by anything that reasons
 * about the run, so the two can't disagree about what a setting means. A
 * run of none has no step to take.
 */
export function copyInkStep(from: number, final: number, count: number): number {
  if (!(count >= 1)) return 0;
  return (final - from) / count;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
