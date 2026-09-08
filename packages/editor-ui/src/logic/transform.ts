import type { TransformCopiesSpec } from '../adapter';

// The Transform bar's ranges and its opening proposal (components/
// TransformBar.tsx), stated in the object's own units — degrees, cells,
// copies — and kept apart from the component so hosts and tests can read
// them without rendering it.

/** Rotation runs the full circle: (-180, 180]. */
export const ROTATE_MIN = -180;
export const ROTATE_MAX = 180;
/** Copies: at least one, and enough to ring a shape at 15° without running
 *  the page into mush. */
export const COPIES_MIN = 1;
export const COPIES_MAX = 24;
/** Position offset per copy, in cells either way; a page is 32 across. */
export const OFFSET_MAX = 8;
/** What a fresh bar proposes: a few copies, a cell over, a small turn. */
export const DEFAULT_COPIES: TransformCopiesSpec = { count: 3, dx: 1, dy: 0, dAngleDeg: 15 };
