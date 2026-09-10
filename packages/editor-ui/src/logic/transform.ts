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
/** What a fresh bar proposes: no copies yet (the count is the user's
 *  choice), a cell over, a small turn, the same size. */
export const DEFAULT_COPIES: TransformCopiesSpec = { count: 0, dx: 1, dy: 0, dAngleDeg: 15, sx: 1, sy: 1 };
