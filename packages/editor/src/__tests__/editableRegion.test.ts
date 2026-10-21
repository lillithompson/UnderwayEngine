import { bboxInRegion, clampToRegion } from '../editableRegion';
import { markerScreenPoints, midlineSegment, regionVeilPath } from '../regionChromeScreen';
import { BASE_CELL_PX, WORLD_CELLS } from '../cameraMath';

// The editable band (docs/social_game_spec.md §7.3): the clamp the draw
// and drag paths share, the bbox rule, and the screen-space chrome.

/** The top band of a board 32 cells wide and 42 tall — bounded on all
 *  four sides, the way a Creature turn's band is (the real board is 8 ×
 *  12 grid squares; these are round numbers, the geometry being the same
 *  either way). */
const REGION = { xMin: 0, xMax: WORLD_CELLS, yMin: 0, yMax: 21 };
const PAGE_CELLS = 42;

describe('clampToRegion', () => {
  it('clamps y into the band on both sides, keeps the midline itself, and returns the same point when inside', () => {
    expect(clampToRegion([3, -2], REGION)).toEqual([3, 0]);
    expect(clampToRegion([3, 30], REGION)).toEqual([3, 21]);
    expect(clampToRegion([3, 21], REGION)).toEqual([3, 21]);
    const inside: [number, number] = [3, 10];
    expect(clampToRegion(inside, REGION)).toBe(inside);
    expect(clampToRegion([3, 25], { yMin: 21, yMax: 42 })).toEqual([3, 25]);
    expect(clampToRegion([3, 4], { yMin: 21, yMax: 42 })).toEqual([3, 21]);
  });

  it('clamps x too, where the band HAS sides — and leaves it alone where it has none', () => {
    // The board is finite now: a stroke dragged off the paper is pulled
    // back onto its edge, exactly as one dragged past the dotted line is.
    expect(clampToRegion([-5, 4], REGION)).toEqual([0, 4]);
    expect(clampToRegion([WORLD_CELLS + 9, 4], REGION)).toEqual([WORLD_CELLS, 4]);
    expect(clampToRegion([WORLD_CELLS, 4], REGION)).toEqual([WORLD_CELLS, 4]);
    // A band with no sides is the old open canvas, untouched.
    expect(clampToRegion([-5, 4], { yMin: 0, yMax: 21 })).toEqual([-5, 4]);
  });

  it('bboxInRegion: inside with the edges, out when any part leaves', () => {
    expect(bboxInRegion({ cellY: 0, cellHeight: 21 }, REGION)).toBe(true);
    expect(bboxInRegion({ cellY: 5, cellHeight: 17 }, REGION)).toBe(false);
    expect(bboxInRegion({ cellY: -1, cellHeight: 4 }, REGION)).toBe(false);
    // …and off the SIDES of the board, which is the same refusal.
    expect(bboxInRegion({ cellX: 0, cellWidth: WORLD_CELLS, cellY: 0, cellHeight: 21 }, REGION)).toBe(true);
    expect(bboxInRegion({ cellX: -2, cellWidth: 4, cellY: 0, cellHeight: 21 }, REGION)).toBe(false);
    expect(bboxInRegion({ cellX: WORLD_CELLS - 1, cellWidth: 4, cellY: 0, cellHeight: 21 }, REGION)).toBe(false);
    // A band with no sides refuses nothing for leaving them.
    expect(bboxInRegion({ cellX: -2, cellWidth: 4, cellY: 0, cellHeight: 21 }, { yMin: 0, yMax: 21 })).toBe(true);
  });
});

describe('the region chrome, screen space', () => {
  const t = { translateX: 10, translateY: 20, scale: 2 };
  const view = { width: 400, height: 800 };

  it('the veil is the whole view with the BAND punched out of it', () => {
    // The board has four sides now, so what is not yours has four sides:
    // the view's rectangle, and the band as an evenodd hole in it. The
    // grey therefore covers the paper above, below and to either side of
    // the page — all of it places the clamp refuses.
    const px = (cells: number) => cells * BASE_CELL_PX * 2;
    const hole = (r: { xMin: number; xMax: number; yMin: number; yMax: number }) =>
      `M${10 + px(r.xMin)} ${20 + px(r.yMin)}H${10 + px(r.xMax)}V${20 + px(r.yMax)}H${10 + px(r.xMin)}Z`;
    expect(regionVeilPath(REGION, t, view)).toBe(`M0 0H400V800H0Z${hole(REGION)}`);
    // The bottom half's turn: the hole moves, the grey does not.
    const lower = { xMin: 0, xMax: WORLD_CELLS, yMin: 21, yMax: PAGE_CELLS };
    expect(regionVeilPath(lower, t, view)).toBe(`M0 0H400V800H0Z${hole(lower)}`);
    // The hole's own edge and the midline sit on the same screen y at
    // every zoom, which is the whole point of drawing it this way.
    expect(regionVeilPath(REGION, t, view)).toContain(`V${midlineSegment(view, 21, t)!.y1}`);
    // A band with no sides runs to the view's own edges, which leaves
    // the old full-width strips above and below it.
    expect(regionVeilPath({ yMin: 0, yMax: 21 }, t, view))
      .toBe(`M0 0H400V800H0ZM0 ${20 + px(0)}H400V${20 + px(21)}H0Z`);
    expect(regionVeilPath(REGION, { ...t, scale: 0 }, view)).toBe('');
    expect(midlineSegment(view, 21, t)).toEqual({ x1: 0, y1: 20 + 21 * BASE_CELL_PX * 2, x2: 400, y2: 20 + 21 * BASE_CELL_PX * 2, dashOffset: expect.any(Number) });
    expect(midlineSegment(view, 21, { ...t, translateY: -100000 })).toBeNull();
    expect(markerScreenPoints([{ x: 4, y: 21, met: false }], t)).toEqual([{ cx: 10 + 4 * BASE_CELL_PX * 2, cy: 20 + 21 * BASE_CELL_PX * 2 }]);
  });
});
