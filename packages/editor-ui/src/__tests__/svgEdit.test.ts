/**
 * The vector subtype option menus — the table the ObjectPropertiesPanel's
 * second row renders for an SVG selection, mirroring `imageEdit.test.ts` for
 * images.
 */

import { SVG_EDIT_OPTIONS, svgEditOptions, svgStrokeRows } from '../logic/svgEdit';
import type { SVGSubtypeKind } from '../adapter';

const SUBTYPES: SVGSubtypeKind[] = ['line', 'arc', 'rectangle', 'circle', 'shape', 'stroke'];

describe('svgEditOptions', () => {
  it('gives every vector subtype a Stroke option — a path is its stroke', () => {
    for (const subtype of SUBTYPES) {
      const options = svgEditOptions(subtype);
      expect(options.map((o) => o.action)).toEqual(['stroke']);
      expect(options[0].label).toBe('Stroke');
    }
  });

  it('names the shape with a subtype-specific glyph', () => {
    const icons = SUBTYPES.map((s) => svgEditOptions(s)[0].icon);
    expect(new Set(icons).size).toBe(SUBTYPES.length);
    expect(svgEditOptions('rectangle')[0].icon).toBe('vector-rectangle');
    expect(svgEditOptions('circle')[0].icon).toBe('vector-circle');
    expect(svgEditOptions('line')[0].icon).toBe('vector-line');
  });

  it('falls back to the freehand glyph for an unrecognized subtype', () => {
    const options = svgEditOptions('mystery' as SVGSubtypeKind);
    expect(options[0].icon).toBe('vector-polyline');
    expect(options[0].action).toBe('stroke');
  });

  it('exposes the same menus through the whole-table export', () => {
    for (const subtype of SUBTYPES) {
      expect(SVG_EDIT_OPTIONS[subtype]).toEqual(svgEditOptions(subtype));
    }
  });

  it('gives every option a non-empty label and icon', () => {
    for (const subtype of SUBTYPES) {
      for (const o of svgEditOptions(subtype)) {
        expect(o.label.length).toBeGreaterThan(0);
        expect(o.icon.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('svgStrokeRows', () => {
  it('offers Position only where there is an inside to align to', () => {
    // Closed paths enclose an area…
    expect(svgStrokeRows('rectangle').position).toBe(true);
    expect(svgStrokeRows('circle').position).toBe(true);
    expect(svgStrokeRows('shape').position).toBe(true);
    // …open ones do not, so the row is dropped rather than shown inert.
    expect(svgStrokeRows('line').position).toBe(false);
    expect(svgStrokeRows('arc').position).toBe(false);
    expect(svgStrokeRows('stroke').position).toBe(false);
  });

  it('offers Radius only for a rectangle', () => {
    expect(svgStrokeRows('rectangle').radius).toBe(true);
    for (const subtype of SUBTYPES.filter((s) => s !== 'rectangle')) {
      expect(svgStrokeRows(subtype).radius).toBe(false);
    }
  });

  it('gives a rectangle the full bar and an open path the Width/Dash pair only', () => {
    expect(svgStrokeRows('rectangle')).toEqual({ radius: true, position: true });
    expect(svgStrokeRows('line')).toEqual({ radius: false, position: false });
    expect(svgStrokeRows('arc')).toEqual({ radius: false, position: false });
    expect(svgStrokeRows('stroke')).toEqual({ radius: false, position: false });
  });

  it('never offers Radius without Position — Radius implies a closed path', () => {
    for (const subtype of SUBTYPES) {
      const rows = svgStrokeRows(subtype);
      if (rows.radius) expect(rows.position).toBe(true);
    }
  });
});
