/**
 * The vector subtype option menus — the table the ObjectPropertiesPanel's
 * second row renders for an SVG selection, mirroring `imageEdit.test.ts` for
 * images.
 */

import { SVG_EDIT_OPTIONS, svgEditOptions, svgHasEndpoints, svgHasFill, svgStrokeRows } from '../logic/svgEdit';
import type { SVGSubtypeKind } from '../adapter';

const SUBTYPES: SVGSubtypeKind[] = ['line', 'arc', 'rectangle', 'circle', 'shape', 'stroke'];

describe('svgEditOptions', () => {
  it('gives every vector subtype a Stroke option — a path is its stroke', () => {
    for (const subtype of SUBTYPES) {
      const options = svgEditOptions(subtype);
      expect(options[0].action).toBe('stroke');
      expect(options[0].label).toBe('Stroke');
    }
  });

  it('adds Fill to the two shapes with an interior, and to nothing else', () => {
    expect(svgEditOptions('rectangle').map((o) => o.action)).toEqual(['stroke', 'fill']);
    expect(svgEditOptions('circle').map((o) => o.action)).toEqual(['stroke', 'fill']);
    for (const subtype of SUBTYPES.filter((s) => s !== 'rectangle' && s !== 'circle')) {
      expect(svgEditOptions(subtype).map((o) => o.action)).not.toContain('fill');
    }
  });

  it('adds Ends to the three open paths, and to nothing else', () => {
    for (const subtype of ['line', 'arc', 'stroke'] as SVGSubtypeKind[]) {
      expect(svgEditOptions(subtype).map((o) => o.action)).toEqual(['stroke', 'endpoints']);
    }
    for (const subtype of ['rectangle', 'circle', 'shape'] as SVGSubtypeKind[]) {
      expect(svgEditOptions(subtype).map((o) => o.action)).not.toContain('endpoints');
    }
  });

  it('never offers both Fill and Ends — closed and open are complements', () => {
    for (const subtype of SUBTYPES) {
      const actions = svgEditOptions(subtype).map((o) => o.action);
      expect(actions.includes('fill') && actions.includes('endpoints')).toBe(false);
    }
  });

  it('leaves the closed-but-not-drawn `shape` with Stroke alone', () => {
    expect(svgEditOptions('shape').map((o) => o.action)).toEqual(['stroke']);
  });

  it('labels and glyphs the Ends option the same way whichever path it is on', () => {
    for (const subtype of ['line', 'arc', 'stroke'] as SVGSubtypeKind[]) {
      const ends = svgEditOptions(subtype).find((o) => o.action === 'endpoints')!;
      expect(ends.label).toBe('Ends');
      expect(ends.icon).toBe('ray-start-end');
    }
  });

  it('puts Stroke first — it is the option every subtype has', () => {
    for (const subtype of SUBTYPES) {
      expect(svgEditOptions(subtype)[0].action).toBe('stroke');
    }
  });

  it('labels and glyphs the Fill option the same way whichever shape it is on', () => {
    for (const subtype of ['rectangle', 'circle'] as SVGSubtypeKind[]) {
      const fill = svgEditOptions(subtype).find((o) => o.action === 'fill')!;
      expect(fill.label).toBe('Fill');
      expect(fill.icon).toBe('format-color-fill');
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
    // …and offers it neither of the two subtype-specific bars.
    expect(options).toHaveLength(1);
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

describe('svgHasFill', () => {
  it('is true only for the closed shapes the shape tools author', () => {
    expect(svgHasFill('rectangle')).toBe(true);
    expect(svgHasFill('circle')).toBe(true);
    for (const subtype of SUBTYPES.filter((s) => s !== 'rectangle' && s !== 'circle')) {
      expect(svgHasFill(subtype)).toBe(false);
    }
  });

  it('never offers a fill without an inside to align a stroke against', () => {
    // A fill needs an enclosed area, and so does stroke Position — so anything
    // fillable is necessarily closed. (Not the converse: 'shape' is closed but
    // has no Fill yet.)
    for (const subtype of SUBTYPES) {
      if (svgHasFill(subtype)) expect(svgStrokeRows(subtype).position).toBe(true);
    }
  });

  it('agrees with the option menu', () => {
    for (const subtype of SUBTYPES) {
      const hasFillOption = svgEditOptions(subtype).some((o) => o.action === 'fill');
      expect(hasFillOption).toBe(svgHasFill(subtype));
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

describe('svgHasEndpoints', () => {
  it('is true for exactly the open paths a drawing tool produces', () => {
    expect(svgHasEndpoints('line')).toBe(true);
    expect(svgHasEndpoints('arc')).toBe(true);
    expect(svgHasEndpoints('stroke')).toBe(true);
  });

  it('is false for every closed subtype — no loose end to decorate', () => {
    expect(svgHasEndpoints('rectangle')).toBe(false);
    expect(svgHasEndpoints('circle')).toBe(false);
    expect(svgHasEndpoints('shape')).toBe(false);
  });

  it('is the inverse of svgHasFill on every subtype but `shape`', () => {
    for (const subtype of SUBTYPES.filter((s) => s !== 'shape')) {
      expect(svgHasEndpoints(subtype)).toBe(!svgHasFill(subtype));
    }
    // `shape` is closed but its fills are authored elsewhere, so it gets
    // neither bar (see svgHasFill's note).
    expect(svgHasFill('shape')).toBe(false);
    expect(svgHasEndpoints('shape')).toBe(false);
  });

  it('agrees with the menu it gates', () => {
    for (const subtype of SUBTYPES) {
      const has = svgEditOptions(subtype).some((o) => o.action === 'endpoints');
      expect(has).toBe(svgHasEndpoints(subtype));
    }
  });
});
