/**
 * The Layout submenu's align tables and placement maths — what the multi-
 * selection's Layout bar renders and where each action puts a member inside
 * the combined box. Mirrors `svgEdit.test.ts` for the vector option menus.
 */

import {
  HORIZONTAL_ALIGN_OPTIONS,
  VERTICAL_ALIGN_OPTIONS,
  alignAxis,
  alignPosition,
  alignedStart,
} from '../logic/layout';
import type { AlignEdge } from '../adapter';

const ALL: AlignEdge[] = ['left', 'center', 'right', 'top', 'middle', 'bottom'];

describe('align option tables', () => {
  it('offers the six alignments, three per row, in reading order', () => {
    expect(HORIZONTAL_ALIGN_OPTIONS.map((o) => o.edge)).toEqual(['left', 'center', 'right']);
    expect(VERTICAL_ALIGN_OPTIONS.map((o) => o.edge)).toEqual(['top', 'middle', 'bottom']);
  });

  it('names and glyphs every option — the bar labels cells with icons alone', () => {
    for (const o of [...HORIZONTAL_ALIGN_OPTIONS, ...VERTICAL_ALIGN_OPTIONS]) {
      expect(o.label.length).toBeGreaterThan(0);
      expect(o.icon.length).toBeGreaterThan(0);
    }
  });

  it('splits the two rows cleanly by axis', () => {
    for (const o of HORIZONTAL_ALIGN_OPTIONS) expect(alignAxis(o.edge)).toBe('h');
    for (const o of VERTICAL_ALIGN_OPTIONS) expect(alignAxis(o.edge)).toBe('v');
  });

  it('covers every AlignEdge exactly once across the two rows', () => {
    const edges = [...HORIZONTAL_ALIGN_OPTIONS, ...VERTICAL_ALIGN_OPTIONS].map((o) => o.edge);
    expect([...edges].sort()).toEqual([...ALL].sort());
  });
});

describe('alignPosition', () => {
  it('reads the low edge as 0, the centre as 0.5 and the high edge as 1', () => {
    expect(alignPosition('left')).toBe(0);
    expect(alignPosition('top')).toBe(0);
    expect(alignPosition('center')).toBe(0.5);
    expect(alignPosition('middle')).toBe(0.5);
    expect(alignPosition('right')).toBe(1);
    expect(alignPosition('bottom')).toBe(1);
  });
});

describe('alignedStart', () => {
  // A 4-wide member inside a box spanning 10 from x=2.
  it('puts a member flush to the low edge, centred, and flush to the high edge', () => {
    expect(alignedStart(2, 10, 4, 0)).toBe(2);
    expect(alignedStart(2, 10, 4, 0.5)).toBe(5);
    expect(alignedStart(2, 10, 4, 1)).toBe(8);
  });

  it('leaves a member that already spans the whole box alone, whichever edge', () => {
    for (const position of [0, 0.5, 1]) {
      expect(alignedStart(2, 10, 10, position)).toBe(2);
    }
  });

  it('is idempotent — aligning an already-aligned member is a no-op', () => {
    for (const position of [0, 0.5, 1]) {
      const first = alignedStart(2, 10, 4, position);
      expect(alignedStart(2, 10, 4, position)).toBe(first);
    }
  });
});
