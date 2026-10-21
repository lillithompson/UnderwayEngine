import { CAPSULE_SIZE } from '@/editor-ui/theme';

// Overlay keep-out for the tile tool's tap.
//
// The tile tool paints a cell wherever the canvas is tapped, and the canvas
// is the whole screen — the chrome FLOATS over it. Every piece of that
// chrome is a small target with canvas on all sides, so a thumb reaching for
// the tile radial's ring, the capsules along the bottom or the undo stack
// lands a tile instead whenever it falls a few points short. The miss is
// silent (a tile is placed and the button is not pressed), which is what
// makes it maddening: the user aimed at a control and edited the drawing.
//
// So a tap that lands within {@link TAP_EXCLUSION_RADIUS} of any overlay
// control is refused rather than painted. Nothing else about the gesture
// changes: it is only the tile that is withheld.
//
// The overlays are not enumerated here. They are found by asking the
// document what is actually on screen around the tap (elementFromPoint on a
// ring of samples), which means every floating control the editor has —
// and every one it grows later — keeps its own keep-out without having to
// register anything. The cost is a handful of hit tests on a TAP; nothing
// here runs per frame.

/**
 * How far from a control a tile tap is refused: the radius of the undo and
 * redo buttons (the round capsules at the right edge), which is the size the
 * report named — a miss by less than one of those buttons reads as aiming at
 * the button, not at the canvas.
 */
export const TAP_EXCLUSION_RADIUS = CAPSULE_SIZE / 2;

/** Where the ring is sampled, in eighths of a turn. Eight points around the
 *  tap catch a control on any side of it — including the diagonals, which a
 *  four-point ring misses at the corner of a capsule. */
const SAMPLE_DIRECTIONS: readonly [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [Math.SQRT1_2, Math.SQRT1_2], [-Math.SQRT1_2, Math.SQRT1_2],
  [Math.SQRT1_2, -Math.SQRT1_2], [-Math.SQRT1_2, -Math.SQRT1_2],
];

/**
 * Whether an overlay control sits within `radius` of the client point
 * (`clientX`, `clientY`), which is inside `canvas`.
 *
 * "An overlay control" means: at one of the ring's samples, the topmost
 * element that would take a touch is not part of the canvas. Elements that
 * ignore touches are invisible to `elementFromPoint`, so a full-screen
 * box-none wrapper over the canvas answers with whatever is really under the
 * finger — the control, or the canvas itself.
 *
 * A sample that lands off the document (`null`) or on an ANCESTOR of the
 * canvas (the shell's own full-screen wrappers, `<body>`) is not a control:
 * treating those as one would refuse every tap near the screen's edge.
 *
 * `elementAt` is injected so this can be exercised without a browser.
 */
export function overlayNearPoint(
  clientX: number,
  clientY: number,
  canvas: Element | null,
  radius: number,
  elementAt: (x: number, y: number) => Element | null,
): boolean {
  if (!canvas || !(radius > 0)) return false;
  for (const [dx, dy] of SAMPLE_DIRECTIONS) {
    const el = elementAt(clientX + dx * radius, clientY + dy * radius);
    if (!el) continue;
    // Inside the canvas (the grid, the world, a node): plain canvas.
    if (canvas === el || canvas.contains(el)) continue;
    // Above the canvas in the tree: a wrapper that happens to answer, never
    // a control.
    if (el.contains(canvas)) continue;
    return true;
  }
  return false;
}
