import { makeBlankComposition } from '../blankComposition';
import { applyCompOps, revertCompOps } from '@/engine/compositionOps';
import { svgStrokeWidthUnits } from '@/engine/svgStroke';
import { CompUndoEntry, SVGObject } from '@/engine/types';

describe('makeBlankComposition', () => {
  test('produces an empty, consistent scene', () => {
    const state = makeBlankComposition('c1', 'Today');
    expect(state.id).toBe('c1');
    expect(state.name).toBe('Today');
    expect(state.figures).toHaveLength(0);
    expect(state.svgObjects).toHaveLength(0);
    expect(state.images).toHaveLength(0);
    expect(state.sceneOrder).toHaveLength(0);
    expect(state.groups).toHaveLength(0);
    expect(state.selectedFigureIds.size).toBe(0);
    expect(state.camera).toEqual({ offsetX: 0, offsetY: 0, zoom: 1 });
  });

  test('seeds the composition-wide stroke width at 1.0', () => {
    // Every drawn path / line / shape that never visits the Stroke bar renders
    // at this width, so the value is user-visible on a brand-new page.
    expect(makeBlankComposition('c1').strokeScale).toBe(1.0);
  });

  test('an object with no stroke of its own draws at the blank default', () => {
    const state = makeBlankComposition('c1');
    const bare = { stroke: undefined } as Pick<SVGObject, 'stroke'>;
    // svgStrokeWidthUnits falls back to SVG_STROKE_WIDTH (5) × strokeScale.
    expect(svgStrokeWidthUnits(bare, state.strokeScale, 16)).toBeCloseTo(5);
  });

  test('accepts engine undo ops (round-trips a placed SVG object)', () => {
    const state = makeBlankComposition('c2');
    const stroke: SVGObject = {
      id: 's1',
      segments: [{ kind: 'line', start: [0, 0], end: [4, 4] }],
      color: { r: 10, g: 20, b: 30 },
      cellX: 0,
      cellY: 0,
      cellWidth: 4,
      cellHeight: 4,
    };
    const entry: CompUndoEntry = [{ op: 'placeObject', kind: 'svg', item: stroke }];
    const placed = applyCompOps(state, entry);
    expect(placed.svgObjects).toHaveLength(1);
    expect(placed.svgObjects[0].id).toBe('s1');

    const reverted = revertCompOps(placed, entry);
    expect(reverted.svgObjects).toHaveLength(0);
  });
});
