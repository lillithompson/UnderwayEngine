/**
 * The floating capsules' sizing (floatingCapsuleSize.ts): the fixed-width
 * actions pill that cannot wrap, and the under-toolbar mode capsule's
 * tighten-then-wrap layout. The pure half; the components' use of it is
 * pinned by source in components/__tests__, there being no renderer.
 */

import {
  FLOATING_SEGMENT_GLYPH_WIDTH, FLOATING_SEGMENT_WIDTH, MIN_TOUCH_TARGET, NARROWEST_PHONE_PX,
  TOOL_MODE_ARROW_SPAN, TOOL_MODE_SCREEN_MARGIN, TOOL_MODE_SEGMENT_ART_SIZE, TOOL_MODE_SEGMENT_PAD_H,
  TOOL_MODE_SEGMENT_PAD_H_MIN, capsuleRowCounts, floatingCapsuleWidthPx, toolModeCapsuleAvailablePx,
  toolModeCapsuleLayout, toolModeSegmentWidthPx,
} from '../floatingCapsuleSize';
import { FLOATING_CAPSULE_FONT_SIZE, FLOATING_CAPSULE_GLYPH_SIZE } from '../components/floatingCapsuleStyle';

/** A row's width as the split measures it: segments, hairlines, border. */
const rowPx = (widths: number[]) => widths.reduce((s, w) => s + w, 0) + widths.length - 1 + 4;

describe('the actions pill: fixed-width words on one row', () => {
  test('words + a hairline between each pair + the pill’s 2 pt border', () => {
    expect(floatingCapsuleWidthPx(3)).toBe(3 * FLOATING_SEGMENT_WIDTH + 2 + 4);
    expect(floatingCapsuleWidthPx(1)).toBe(FLOATING_SEGMENT_WIDTH + 4);
    expect(floatingCapsuleWidthPx(0)).toBe(4);
  });

  test('four words fit the narrowest phone; a fifth would not, which is the line this pins', () => {
    // The multi-selection capsule's widest offer is four (Group | Merge |
    // Layout | Done); the next word would be the one that pushes it off.
    expect(floatingCapsuleWidthPx(4)).toBeLessThan(NARROWEST_PHONE_PX);
    expect(floatingCapsuleWidthPx(5)).toBeGreaterThan(NARROWEST_PHONE_PX);
  });

  test('a glyph segment is wider than a HIG touch target, narrower than a word', () => {
    // A word needs 72 pt to stand clear of the dividers; a media-player
    // triangle does not. 44 pt is the floor, and the 44 pt square read as
    // cramped, so a glyph segment stands a margin above it.
    expect(FLOATING_SEGMENT_GLYPH_WIDTH).toBe(56);
    expect(MIN_TOUCH_TARGET).toBe(44);
    expect(FLOATING_SEGMENT_GLYPH_WIDTH).toBeGreaterThan(MIN_TOUCH_TARGET);
    expect(FLOATING_SEGMENT_GLYPH_WIDTH).toBeLessThan(FLOATING_SEGMENT_WIDTH);
    // …and the glyph still has room inside it either side.
    expect(FLOATING_CAPSULE_GLYPH_SIZE).toBeLessThan(FLOATING_SEGMENT_GLYPH_WIDTH);
  });

  test('a glyph pill is measured by the same helper at the glyph width', () => {
    expect(floatingCapsuleWidthPx(3, FLOATING_SEGMENT_GLYPH_WIDTH))
      .toBe(3 * FLOATING_SEGMENT_GLYPH_WIDTH + 2 + 4);
    expect(floatingCapsuleWidthPx(3, FLOATING_SEGMENT_GLYPH_WIDTH)).toBeLessThan(floatingCapsuleWidthPx(3));
    // Two glyph pills side by side — three controls, a gap, two more — fit
    // a 320 pt screen where the same row in words was half again as wide
    // as the screen (DrawBot's transport row, bug 0504993e).
    const row = floatingCapsuleWidthPx(3, FLOATING_SEGMENT_GLYPH_WIDTH)
      + 10 + floatingCapsuleWidthPx(2, FLOATING_SEGMENT_GLYPH_WIDTH);
    expect(row).toBe(301);
    expect(row).toBeLessThan(NARROWEST_PHONE_PX);
    expect(floatingCapsuleWidthPx(4) + 10 + floatingCapsuleWidthPx(2)).toBeGreaterThan(NARROWEST_PHONE_PX);
  });
});

describe('capsuleRowCounts', () => {
  test('a row that fits stays one row', () => {
    expect(capsuleRowCounts([50, 50, 50], 1000)).toEqual([3]);
  });

  test('a row too wide splits into balanced rows, the front ones taking the extra', () => {
    const widths = Array(9).fill(50);
    expect(rowPx(widths)).toBeGreaterThan(300);
    expect(capsuleRowCounts(widths, 300)).toEqual([5, 4]);
  });

  test('takes as many rows as it needs, never more', () => {
    const widths = Array(9).fill(50);
    expect(capsuleRowCounts(widths, 160)).toEqual([3, 3, 3]);
    // Nothing fits even alone: one per row is as far as it can go.
    expect(capsuleRowCounts([500, 500], 100)).toEqual([1, 1]);
    expect(capsuleRowCounts([], 100)).toEqual([]);
  });

  test('every row it returns fits', () => {
    const widths = [80, 40, 120, 60, 60, 90, 30];
    for (const avail of [150, 200, 260, 330, 500]) {
      const counts = capsuleRowCounts(widths, avail);
      expect(counts.reduce((s, c) => s + c, 0)).toBe(widths.length);
      let at = 0;
      for (const c of counts) {
        expect(rowPx(widths.slice(at, at + c))).toBeLessThanOrEqual(avail);
        at += c;
      }
    }
  });
});

describe('a mode capsule’s segment widths', () => {
  test('a glyph segment is the padded art; a word grows with its letters; a swatch is fixed', () => {
    expect(toolModeSegmentWidthPx({ label: 'Left', art: true }, 11))
      .toBe(TOOL_MODE_SEGMENT_ART_SIZE + 2 * TOOL_MODE_SEGMENT_PAD_H);
    expect(toolModeSegmentWidthPx({ label: 'Left', art: true }, 11, 9))
      .toBe(TOOL_MODE_SEGMENT_ART_SIZE + 18);
    expect(toolModeSegmentWidthPx({ label: 'Rectangle' }, 11))
      .toBeGreaterThan(toolModeSegmentWidthPx({ label: 'Arc' }, 11));
    expect(toolModeSegmentWidthPx({ label: 'x', fixedWidth: 41 }, 11)).toBe(41);
    expect(toolModeSegmentWidthPx({ label: 'x', fixedWidth: 41 }, 11, 0)).toBe(41);
  });

  test('the room a window leaves: its margins, and the cycle arrows when they flank the row', () => {
    expect(toolModeCapsuleAvailablePx(393, false)).toBe(393 - 2 * TOOL_MODE_SCREEN_MARGIN);
    expect(toolModeCapsuleAvailablePx(393, true)).toBe(393 - 2 * TOOL_MODE_SCREEN_MARGIN - 2 * TOOL_MODE_ARROW_SPAN);
  });
});

describe('toolModeCapsuleLayout: one row at full padding, else tightened, else wrapped', () => {
  // Seven glyph segments — a host's row of seven (DrawBot's Inklings row,
  // bug 2f925f36) — which is too wide for a phone held upright at the full
  // padding and fits it tightened.
  const seven = Array.from({ length: 7 }, (_, i) => ({ label: `g${i}`, art: true }));
  const layout = (windowPx: number, arrows = true) => toolModeCapsuleLayout(
    seven, FLOATING_CAPSULE_FONT_SIZE, toolModeCapsuleAvailablePx(windowPx, arrows),
  );
  const widths = (padH = TOOL_MODE_SEGMENT_PAD_H) => seven.map((s) => (
    toolModeSegmentWidthPx(s, FLOATING_CAPSULE_FONT_SIZE, padH)
  ));

  test('no segments is no rows', () => {
    expect(toolModeCapsuleLayout([], 11, 100)).toEqual({ padH: TOOL_MODE_SEGMENT_PAD_H, rowCounts: [] });
  });

  test('a row that fits keeps the full padding on one row', () => {
    expect(layout(1024)).toEqual({ padH: TOOL_MODE_SEGMENT_PAD_H, rowCounts: [7] });
  });

  test('a row too wide at the full padding tightens onto one row on a 393 pt and a 402 pt phone', () => {
    expect(rowPx(widths())).toBeGreaterThan(toolModeCapsuleAvailablePx(393, true));
    for (const phone of [393, 402]) {
      const { padH, rowCounts } = layout(phone);
      expect(rowCounts).toEqual([7]);
      expect(padH).toBeLessThan(TOOL_MODE_SEGMENT_PAD_H);
      expect(padH).toBeGreaterThanOrEqual(TOOL_MODE_SEGMENT_PAD_H_MIN);
      // …and the tightened row really fits.
      expect(rowPx(widths(padH))).toBeLessThanOrEqual(toolModeCapsuleAvailablePx(phone, true));
    }
  });

  test('on the narrowest phone, where even the floor does not fit, it wraps at the full padding', () => {
    const avail = toolModeCapsuleAvailablePx(NARROWEST_PHONE_PX, true);
    const { padH, rowCounts } = layout(NARROWEST_PHONE_PX);
    expect(rowCounts.length).toBeGreaterThan(1);
    expect(padH).toBe(TOOL_MODE_SEGMENT_PAD_H);
    let at = 0;
    for (const c of rowCounts) {
      expect(rowPx(widths().slice(at, at + c))).toBeLessThanOrEqual(avail);
      at += c;
    }
  });

  test('a row of fixed-width swatches has no padding to give, so it wraps', () => {
    const swatches = Array(6).fill({ label: 's', fixedWidth: 60 });
    const { padH, rowCounts } = toolModeCapsuleLayout(swatches, 11, 200);
    expect(padH).toBe(TOOL_MODE_SEGMENT_PAD_H);
    expect(rowCounts.length).toBeGreaterThan(1);
  });
});
