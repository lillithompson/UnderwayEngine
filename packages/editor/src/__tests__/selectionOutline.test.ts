import { STICKER_SHADOW_CELLS } from '@/engine/stickerStyle';
import { STATE_ACTIVE } from '@/editor-ui/theme';
import { BASE_CELL_PX } from '../cameraMath';
import {
  LIVE_INV_VAR,
  PAINT_DIM_VEIL,
  SCREEN_INV_TRANSFORM,
  SELECTION_BORDER_PX,
  SELECTION_COLOR,
  TEXT_EDIT_RING_COLOR,
  TEXT_EDIT_RING_GAP_PX,
  ZOOM_INV_VAR,
  PAINT_VEIL_SHAPE_STROKE_PX,
  paintDimVeilPath,
  paintDimVeilShapeTransform,
  screenPx,
  selectionOutlineRect,
  selectionOutlineStyle,
  textEditRingStyle,
} from '../selectionOutline';

const COLOR = '#38BDF8';
const BOX = { cellX: 3, cellY: 5, cellWidth: 8, cellHeight: 2 };

describe('selectionOutlineStyle', () => {
  test('the element box IS the node bbox, in world px', () => {
    const s = selectionOutlineStyle(BOX, COLOR);
    expect(s.left).toBe(3 * BASE_CELL_PX);
    expect(s.top).toBe(5 * BASE_CELL_PX);
    expect(s.width).toBe(8 * BASE_CELL_PX);
    expect(s.height).toBe(2 * BASE_CELL_PX);
  });

  test('draws the ring with `outline`, never `border`', () => {
    // The regression this guards: CSS lays a border out inside the element
    // box, so `left`/`top` would place the border's outer edge and push the
    // bbox SELECTION_BORDER_PX down and right of the object it hugs.
    const s = selectionOutlineStyle(BOX, COLOR);
    expect(s.outlineStyle).toBe('solid');
    expect(s.outlineColor).toBe(COLOR);
    expect(s.border).toBeUndefined();
    expect(s.borderWidth).toBeUndefined();
  });

  test('the ring thickness is pinned to screen px, not world px', () => {
    // The chrome sits inside the zoom-scaled world layer, so a bare `2px`
    // would draw 48px at 24× zoom and hairline-thin at 0.2×. Dividing by the
    // layer's scale (and any live pinch factor) keeps it at 2 on screen.
    const s = selectionOutlineStyle(BOX, COLOR);
    expect(s.outlineWidth).toBe(screenPx(SELECTION_BORDER_PX));
    expect(s.outlineWidth as string).toContain(`var(${ZOOM_INV_VAR}, 1)`);
    expect(s.outlineWidth as string).toContain(`var(${LIVE_INV_VAR}, 1)`);
  });

  test('both inverse-scale vars fall back to 1, so chrome paints unscaled', () => {
    // Nothing sets these outside the canvas, and a live pinch sets only one of
    // them; a missing var must not invalidate the declaration and drop the ring
    // (or the handles) entirely.
    expect(screenPx(10)).toBe(`calc(10px * var(${ZOOM_INV_VAR}, 1) * var(${LIVE_INV_VAR}, 1))`);
    expect(SCREEN_INV_TRANSFORM)
      .toBe(`scale(var(${ZOOM_INV_VAR}, 1)) scale(var(${LIVE_INV_VAR}, 1))`);
  });

  test('the handle counter-scale multiplies both inversions', () => {
    // Chained scale() functions multiply, so the transform undoes the camera
    // zoom AND a live pinch without needing calc() inside scale().
    expect(SCREEN_INV_TRANSFORM.match(/scale\(/g)).toHaveLength(2);
    expect(SCREEN_INV_TRANSFORM).not.toContain('calc');
  });

  test('the ring overhangs the object equally on all four sides', () => {
    // An outline takes no layout, so the painted ring is the element box grown
    // by its width on every side — symmetric, i.e. no down-right drift. The
    // element box is what carries that symmetry, and it is pure bbox geometry.
    const s = selectionOutlineStyle(BOX, COLOR);
    expect(s.left).toBe(3 * BASE_CELL_PX);
    expect((s.left as number) + (s.width as number)).toBe(11 * BASE_CELL_PX);
    expect(s.top).toBe(5 * BASE_CELL_PX);
    expect((s.top as number) + (s.height as number)).toBe(7 * BASE_CELL_PX);
  });

  test('a word sticker is outlined on its card, not around its drop shadow', () => {
    // A sticker's bbox IS its card (scaffold sizes it to text + padding), and
    // the card's shadow hangs off the bottom-right of that box. The outline
    // must stay on the card: its right/bottom edges sit at the card's, well
    // short of how far the shadow reaches.
    const card = { cellX: 2, cellY: 2, cellWidth: 4, cellHeight: 1 };
    const s = selectionOutlineStyle(card, COLOR);
    expect((s.left as number) + (s.width as number)).toBe(6 * BASE_CELL_PX);
    expect((s.top as number) + (s.height as number)).toBe(3 * BASE_CELL_PX);
    // (The ring's overhang is SELECTION_BORDER_PX on screen; at 1:1 zoom that
    // is also its world-px extent, which is the margin checked here.)
    const shadowRight = (6 + STICKER_SHADOW_CELLS.dx + STICKER_SHADOW_CELLS.blur) * BASE_CELL_PX;
    const shadowBottom = (3 + STICKER_SHADOW_CELLS.dy + STICKER_SHADOW_CELLS.blur) * BASE_CELL_PX;
    expect((s.left as number) + (s.width as number) + SELECTION_BORDER_PX).toBeLessThan(shadowRight);
    expect((s.top as number) + (s.height as number) + SELECTION_BORDER_PX).toBeLessThan(shadowBottom);
  });

  test('a flat H/V line box still paints a ring', () => {
    const flat = { cellX: 0, cellY: 4, cellWidth: 6, cellHeight: 0 };
    const s = selectionOutlineStyle(flat, COLOR);
    expect(s.height as number).toBeGreaterThan(0);
    expect(s.top).toBe(4 * BASE_CELL_PX);
  });
});

describe('textEditRingStyle', () => {
  test('sits clear of the blue ring by the gap, on all four sides', () => {
    // The child's box edges are pushed out past the parent's blue ring
    // (SELECTION_BORDER_PX) plus the breathing gap, symmetrically — so the
    // outer ring reads as "around" the selection, not stacked on it.
    const s = textEditRingStyle();
    const inset = screenPx(-(SELECTION_BORDER_PX + TEXT_EDIT_RING_GAP_PX));
    for (const side of ['left', 'top', 'right', 'bottom'] as const) {
      expect(s[side]).toBe(inset);
    }
  });

  test('is a blue outline ring — the selection blue — zoom-invariant like the inner one', () => {
    // It was black, which read as a different kind of chrome (a frame, a
    // lock) rather than "the selection, doubled". The one accent every
    // piece of selection chrome shares, not a second literal.
    const s = textEditRingStyle();
    expect(s.outlineColor).toBe(TEXT_EDIT_RING_COLOR);
    expect(TEXT_EDIT_RING_COLOR).toBe(SELECTION_COLOR);
    expect(SELECTION_COLOR).toBe(STATE_ACTIVE);
    expect(STATE_ACTIVE).toBe('#38BDF8');
    expect(s.outlineStyle).toBe('solid');
    expect(s.outlineWidth).toBe(screenPx(SELECTION_BORDER_PX));
    // Same outline-not-border reasoning as the parent ring: a border would
    // shift the geometry it frames.
    expect(s.border).toBeUndefined();
    // Chrome, not a hit target — presses must fall through to the canvas.
    expect(s.pointerEvents).toBe('none');
  });

  test('takes another ink for the same ring — the Tile tool’s target wears the pattern orange', () => {
    // Same geometry, only the colour differs: the doubled ring is ONE
    // style, worn blue by an open text object and orange by the grid the
    // tile tool is laying into without having selected it.
    const s = textEditRingStyle('#FFA032');
    const blue = textEditRingStyle();
    expect(s.outlineColor).toBe('#FFA032');
    expect({ ...s, outlineColor: undefined }).toEqual({ ...blue, outlineColor: undefined });
  });
});

describe('paintDimVeilPath (the paint veil, in screen space)', () => {
  const VIEW = { width: 800, height: 600 };
  const T1 = { translateX: 0, translateY: 0, scale: 1 };

  test('the outer subpath is the whole viewport, whatever the camera does', () => {
    // Screen space is the point: the wash covers exactly the visible view at
    // any zoom, where the old in-world giant box-shadow drifted off its
    // element and thinned to nothing at zoom extremes.
    for (const t of [T1, { translateX: -1234, translateY: 987, scale: 0.05 }]) {
      expect(paintDimVeilPath(VIEW, BOX, t)).toMatch(/^M0 0H800V600H0Z/);
    }
  });

  test('the lit hole is the selection bbox through the camera, grown by the ring', () => {
    // The veil paints OVER the world layer, selection ring included, so the
    // hole is the screen-space bbox outset by the ring's thickness — the
    // blue ring stays lit on the wash instead of being the first thing
    // washed. At identity camera, screen px = world px.
    const r = selectionOutlineRect(BOX);
    const d = paintDimVeilPath(VIEW, BOX, T1);
    const hole = d.slice(d.indexOf('M', 1));
    expect(hole).toBe(
      `M${r.left - SELECTION_BORDER_PX} ${r.top - SELECTION_BORDER_PX}`
      + `L${r.left + r.width + SELECTION_BORDER_PX} ${r.top - SELECTION_BORDER_PX}`
      + `L${r.left + r.width + SELECTION_BORDER_PX} ${r.top + r.height + SELECTION_BORDER_PX}`
      + `L${r.left - SELECTION_BORDER_PX} ${r.top + r.height + SELECTION_BORDER_PX}Z`,
    );
  });

  test('the hole scales and translates with the camera; the outset does not', () => {
    // Zoomed out 4×, the box's screen extent quarters but the ring outset is
    // a constant screen 2px — matching the zoom-invariant ring it frames.
    const t = { translateX: 100, translateY: 50, scale: 0.25 };
    const r = selectionOutlineRect(BOX);
    const d = paintDimVeilPath(VIEW, BOX, t);
    const first = d.slice(d.indexOf('M', 1) + 1, d.indexOf('L')).split(' ').map(Number);
    expect(first[0]).toBeCloseTo(100 + r.left * 0.25 - SELECTION_BORDER_PX);
    expect(first[1]).toBeCloseTo(50 + r.top * 0.25 - SELECTION_BORDER_PX);
  });

  test('rotation turns the hole about its own center, like the outline element', () => {
    // 90° about center: the (w × h) hole's corners land as an (h × w) box.
    const box = { cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 2 };
    const d = paintDimVeilPath(VIEW, box, T1, 90);
    const pts = d.slice(d.indexOf('M', 1) + 1).replace('Z', '').split('L')
      .map((p) => p.split(' ').map(Number));
    const cx = 2 * BASE_CELL_PX;
    const cy = BASE_CELL_PX;
    const hw = 2 * BASE_CELL_PX + SELECTION_BORDER_PX;
    const hh = BASE_CELL_PX + SELECTION_BORDER_PX;
    // Clockwise 90° in the y-down screen frame: (-hw,-hh) → (hh,-hw).
    expect(pts[0][0]).toBeCloseTo(cx + hh);
    expect(pts[0][1]).toBeCloseTo(cy - hw);
  });

  test('the wash is translucent — the dimmed scene stays readable as context', () => {
    expect(PAINT_DIM_VEIL).toMatch(/^rgba\(.*0\.45\)$/);
  });

});

describe('paintDimVeilShapeTransform (the hole cut to the object’s own border)', () => {
  const T1 = { translateX: 0, translateY: 0, scale: 1 };
  // A shape's own space: `local` in SVG units, the rect its `d` is drawn
  // against (selectionShapePath.units).
  const UNITS = { x: 100, y: 200, width: 400, height: 50 };

  /** The transform applied by hand, so a test can ask where a path point
   *  lands on screen without a DOM. */
  function apply(tf: string, px: number, py: number): [number, number] {
    const nums = (name: string): number[] => {
      const m = new RegExp(`${name}\\(([^)]*)\\)`).exec(tf)!;
      return m[1].trim().split(/[\s,]+/).map(Number);
    };
    const [cx, cy] = nums('translate');
    const [deg] = nums('rotate');
    const [sx, sy] = nums('scale');
    const tails = [...tf.matchAll(/translate\(([^)]*)\)/g)]
      .map((m) => m[1].trim().split(/[\s,]+/).map(Number));
    const [hx, hy] = tails[1]; // top-left of the box, about its centre
    const [ox, oy] = tails[2]; // drop the units origin
    let x = (px + ox) * sx + hx;
    let y = (py + oy) * sy + hy;
    const rad = (deg * Math.PI) / 180;
    const rx = x * Math.cos(rad) - y * Math.sin(rad);
    const ry = x * Math.sin(rad) + y * Math.cos(rad);
    return [rx + cx, ry + cy];
  }

  test('the units box lands on exactly the pixels the box hole covered', () => {
    // The whole point: the shape is stretched over the SAME screen rect the
    // rectangle hole used, so swapping one for the other moves nothing but
    // the edge. At identity camera, screen px = world px.
    const tf = paintDimVeilShapeTransform(BOX, T1, 0, UNITS);
    const r = selectionOutlineRect(BOX);
    expect(apply(tf, UNITS.x, UNITS.y)).toEqual([r.left, r.top]);
    const [x1, y1] = apply(tf, UNITS.x + UNITS.width, UNITS.y + UNITS.height);
    expect(x1).toBeCloseTo(r.left + r.width);
    expect(y1).toBeCloseTo(r.top + r.height);
  });

  test('it scales and translates with the camera', () => {
    const t = { translateX: 100, translateY: 50, scale: 0.25 };
    const r = selectionOutlineRect(BOX);
    const [x, y] = apply(paintDimVeilShapeTransform(BOX, t, 0, UNITS), UNITS.x, UNITS.y);
    expect(x).toBeCloseTo(100 + r.left * 0.25);
    expect(y).toBeCloseTo(50 + r.top * 0.25);
  });

  test('rotation turns it about the box’s own centre, like the box hole', () => {
    // The same turn paintDimVeilPath gives the rectangle and the outline
    // element gives the ring: clockwise in the y-down screen frame.
    const box = { cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 2 };
    const tf = paintDimVeilShapeTransform(box, T1, 90, UNITS);
    const [x, y] = apply(tf, UNITS.x, UNITS.y);
    const cx = 2 * BASE_CELL_PX;
    const cy = BASE_CELL_PX;
    // The box's top-left corner, turned 90°: (-hw,-hh) → (hh,-hw).
    expect(x).toBeCloseTo(cx + BASE_CELL_PX);
    expect(y).toBeCloseTo(cy - 2 * BASE_CELL_PX);
  });

  test('a flat units box maps to nothing rather than dividing by zero', () => {
    const tf = paintDimVeilShapeTransform(BOX, T1, 0, { x: 0, y: 0, width: 0, height: 0 });
    expect(tf).not.toMatch(/Infinity|NaN/);
  });

  test('the border stays lit: the mask path’s stroke is the ring outset', () => {
    // The box hole is GROWN by SELECTION_BORDER_PX so the ring it frames is
    // not the first thing washed. A shape has no one outward direction, so
    // the same clearance comes from a stroke centred on the edge — half of
    // it outside.
    expect(PAINT_VEIL_SHAPE_STROKE_PX / 2).toBe(SELECTION_BORDER_PX);
  });

});

describe('selectionOutlineRect', () => {
  test('matches the style geometry, so a live gesture re-anchors it identically', () => {
    for (const box of [BOX, { cellX: -1.5, cellY: 0, cellWidth: 0, cellHeight: 3 }]) {
      const s = selectionOutlineStyle(box, COLOR);
      expect(selectionOutlineRect(box)).toEqual({
        left: s.left, top: s.top, width: s.width, height: s.height,
      });
    }
  });
});
