/**
 * The vector subtype option menus — the table the ObjectPropertiesPanel's
 * second row renders for an SVG selection, mirroring `imageEdit.test.ts` for
 * images.
 */

import { SVG_EDIT_OPTIONS, svgEditOptions, svgHasEndpoints, svgHasFill, svgHasOpacity, svgHasShape, svgStrokeRemovable, svgStrokeRows } from '../logic/svgEdit';
import type { SVGSubtypeKind } from '../adapter';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC_LOGIC = readFileSync(resolve(__dirname, '..', 'logic', 'svgEdit.ts'), 'utf8');

const SUBTYPES: SVGSubtypeKind[] = ['line', 'arc', 'rectangle', 'circle', 'polygon', 'shape', 'stroke'];

/** Every CLOSED subtype — the ones with Fill/Opacity. What closes is what
 *  fills: the three the shape tools author, plus `shape`, the closed freeform
 *  (a merge of strokes that met end to end, a join, a union result, a preset). */
const FILLED: SVGSubtypeKind[] = ['rectangle', 'circle', 'polygon', 'shape'];

describe('svgEditOptions', () => {
  it('gives every vector subtype a Stroke option — a path is its stroke', () => {
    for (const subtype of SUBTYPES) {
      const options = svgEditOptions(subtype);
      expect(options[0].action).toBe('stroke');
      expect(options[0].label).toBe('Stroke');
    }
  });

  it('adds Fill then Opacity to the shapes with an interior, and to nothing else', () => {
    for (const subtype of FILLED) {
      expect(svgEditOptions(subtype).map((o) => o.action).filter((a) => a !== 'shape'))
        .toEqual(['stroke', 'fill', 'opacity', 'transform']);
    }
    for (const subtype of SUBTYPES.filter((s) => !FILLED.includes(s))) {
      expect(svgEditOptions(subtype).map((o) => o.action)).not.toContain('fill');
      expect(svgEditOptions(subtype).map((o) => o.action)).not.toContain('opacity');
    }
  });

  it('adds Ends to the three open paths, and to nothing else', () => {
    for (const subtype of ['line', 'arc', 'stroke'] as SVGSubtypeKind[]) {
      expect(svgEditOptions(subtype).map((o) => o.action)).toEqual(['stroke', 'endpoints', 'transform']);
    }
    for (const subtype of ['rectangle', 'circle', 'polygon', 'shape'] as SVGSubtypeKind[]) {
      expect(svgEditOptions(subtype).map((o) => o.action)).not.toContain('endpoints');
    }
  });

  it('offers no end CAPS at all any more — markers are the whole page', () => {
    // Round vs square ends went from the freehand curve first, then the
    // line; the arc alone keeping a control its two siblings had dropped
    // was a private oddity worth less than the choice. Caps a drawing
    // already carries still render — only the control is gone.
    expect(SRC_LOGIC).not.toContain('svgHasEndCaps');
    for (const subtype of SUBTYPES) {
      expect(svgEditOptions(subtype).map((o) => o.action)).not.toContain('caps');
    }
  });

  it('never offers both Fill and Ends — closed and open are complements', () => {
    for (const subtype of SUBTYPES) {
      const actions = svgEditOptions(subtype).map((o) => o.action);
      expect(actions.includes('fill') && actions.includes('endpoints')).toBe(false);
    }
  });

  it('gives the closed freeform `shape` the same interior options as a drawn one', () => {
    // However the outline came to be — merged, joined, unioned, drawn — a
    // closed path has an inside to paint. (No Shape page: a freeform has
    // no line→line corners to round.)
    expect(svgEditOptions('shape').map((o) => o.action)).toEqual(['stroke', 'fill', 'opacity', 'transform']);
  });

  it('adds Shape — the corner Radius page — right after Stroke on the polygonal shapes only', () => {
    expect(svgEditOptions('rectangle').map((o) => o.action)).toEqual(['stroke', 'shape', 'fill', 'opacity', 'transform']);
    expect(svgEditOptions('polygon').map((o) => o.action)).toEqual(['stroke', 'shape', 'fill', 'opacity', 'transform']);
    for (const subtype of SUBTYPES.filter((s) => s !== 'rectangle' && s !== 'polygon')) {
      expect(svgEditOptions(subtype).map((o) => o.action)).not.toContain('shape');
      expect(svgHasShape(subtype)).toBe(false);
    }
    expect(svgEditOptions('polygon').find((o) => o.action === 'shape')).toEqual({ action: 'shape', label: 'Shape', icon: 'rounded-corner' });
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
    for (const subtype of FILLED) {
      const fill = svgEditOptions(subtype).find((o) => o.action === 'fill')!;
      expect(fill.label).toBe('Fill');
      expect(fill.icon).toBe('format-color-fill');
    }
  });

  it('labels and glyphs the Opacity option the same way whichever shape it is on', () => {
    for (const subtype of FILLED) {
      const op = svgEditOptions(subtype).find((o) => o.action === 'opacity')!;
      expect(op.label).toBe('Opacity');
      expect(op.icon).toBe('opacity');
    }
  });

  it('names the shape with a subtype-specific glyph', () => {
    const icons = SUBTYPES.map((s) => svgEditOptions(s)[0].icon);
    expect(new Set(icons).size).toBe(SUBTYPES.length);
    expect(svgEditOptions('rectangle')[0].icon).toBe('vector-rectangle');
    expect(svgEditOptions('circle')[0].icon).toBe('vector-circle');
    expect(svgEditOptions('line')[0].icon).toBe('vector-line');
    expect(svgEditOptions('polygon')[0].icon).toBe('vector-polygon');
  });

  it('falls back to the freehand glyph for an unrecognized subtype', () => {
    const options = svgEditOptions('mystery' as SVGSubtypeKind);
    expect(options[0].icon).toBe('vector-polyline');
    expect(options[0].action).toBe('stroke');
    // …and offers it neither of the two subtype-specific bars.
    // …plus Transform, which every subtype has.
    expect(options).toHaveLength(2);
    expect(options[1].action).toBe('transform');
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
  it('is true for every closed subtype and no open one', () => {
    for (const subtype of FILLED) expect(svgHasFill(subtype)).toBe(true);
    for (const subtype of SUBTYPES.filter((s) => !FILLED.includes(s))) {
      expect(svgHasFill(subtype)).toBe(false);
    }
  });

  it('never offers a fill without an inside to align a stroke against', () => {
    // A fill needs an enclosed area, and so does stroke Position — so anything
    // fillable is necessarily closed.
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

describe('svgHasOpacity', () => {
  it('is true for every closed subtype and no open one', () => {
    for (const subtype of FILLED) expect(svgHasOpacity(subtype)).toBe(true);
    for (const subtype of SUBTYPES.filter((s) => !FILLED.includes(s))) {
      expect(svgHasOpacity(subtype)).toBe(false);
    }
  });

  it('agrees with the option menu', () => {
    for (const subtype of SUBTYPES) {
      const hasOpacityOption = svgEditOptions(subtype).some((o) => o.action === 'opacity');
      expect(hasOpacityOption).toBe(svgHasOpacity(subtype));
    }
  });
});

describe('svgStrokeRows', () => {
  it('offers Position only where there is an inside to align to', () => {
    // Closed paths enclose an area…
    expect(svgStrokeRows('rectangle').position).toBe(true);
    expect(svgStrokeRows('circle').position).toBe(true);
    expect(svgStrokeRows('polygon').position).toBe(true);
    expect(svgStrokeRows('shape').position).toBe(true);
    // …open ones do not, so the row is dropped rather than shown inert.
    expect(svgStrokeRows('line').position).toBe(false);
    expect(svgStrokeRows('arc').position).toBe(false);
    expect(svgStrokeRows('stroke').position).toBe(false);
  });

  it('offers the Shape page (Radius) only for the subtypes with line→line corners to round', () => {
    expect(svgHasShape('rectangle')).toBe(true);
    expect(svgHasShape('polygon')).toBe(true);
    for (const subtype of SUBTYPES.filter((s) => s !== 'rectangle' && s !== 'polygon')) {
      expect(svgHasShape(subtype)).toBe(false);
    }
    // Radius is no Stroke row any more.
    expect(svgStrokeRows('rectangle')).not.toHaveProperty('radius');
  });

  it('gives a rectangle the Position row and an open path the Width/Dash pair only', () => {
    expect(svgStrokeRows('rectangle')).toEqual({ position: true });
    expect(svgStrokeRows('line')).toEqual({ position: false });
    expect(svgStrokeRows('arc')).toEqual({ position: false });
    expect(svgStrokeRows('stroke')).toEqual({ position: false });
  });

  it('lets only a CLOSED shape remove its stroke — an open path IS its stroke', () => {
    // A line with no stroke is not a fainter line: it is an invisible
    // object you can still select and drag.
    for (const subtype of ['line', 'arc', 'stroke'] as SVGSubtypeKind[]) {
      expect(svgStrokeRemovable(subtype)).toBe(false);
    }
    for (const subtype of FILLED) expect(svgStrokeRemovable(subtype)).toBe(true);
    // It is exactly the complement of "has loose ends to decorate".
    for (const subtype of SUBTYPES) {
      expect(svgStrokeRemovable(subtype)).toBe(!svgHasEndpoints(subtype));
    }
  });

  it('never offers Shape without Position — a roundable corner implies a closed path', () => {
    for (const subtype of SUBTYPES) {
      if (svgHasShape(subtype)) expect(svgStrokeRows(subtype).position).toBe(true);
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
    expect(svgHasEndpoints('polygon')).toBe(false);
    expect(svgHasEndpoints('shape')).toBe(false);
  });

  it('is the exact inverse of svgHasFill — a path is open or it is closed', () => {
    for (const subtype of SUBTYPES) {
      expect(svgHasEndpoints(subtype)).toBe(!svgHasFill(subtype));
    }
    // `shape` closes, so it fills and has no loose end to decorate.
    expect(svgHasFill('shape')).toBe(true);
    expect(svgHasEndpoints('shape')).toBe(false);
  });

  it('agrees with the menu it gates', () => {
    for (const subtype of SUBTYPES) {
      const has = svgEditOptions(subtype).some((o) => o.action === 'endpoints');
      expect(has).toBe(svgHasEndpoints(subtype));
    }
  });
});
