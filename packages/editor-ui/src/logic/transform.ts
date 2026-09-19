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
 * The opening draft for an object whose ink is known: the defaults above,
 * with the run ENDING where the object already stands. Both ink sliders then
 * open under the object's own values, and moving one says "by the last copy,
 * be this" — the end of the run rather than a per-copy step.
 */
export function copiesSeededFrom(
  ink?: { opacity?: number; fade?: number },
): TransformCopiesSpec {
  return {
    ...DEFAULT_COPIES,
    finalFade: clamp01(ink?.fade ?? DEFAULT_COPIES.finalFade),
    finalOpacity: clamp01(ink?.opacity ?? DEFAULT_COPIES.finalOpacity),
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
