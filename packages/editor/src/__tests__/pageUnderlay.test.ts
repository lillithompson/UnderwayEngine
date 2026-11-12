import fs from 'fs';
import path from 'path';
import { UNDERLAY_ID_ATTR, underlayMaskId, underlayPathAttrs, underlayShapeSelector } from '../pageUnderlay';

// The page's underlay (`EditorConfig.underlay`): a drawing under every
// object, in world cells, that no tool can touch, drawn once into the
// world layer so the camera carries it. DrawBot's bot look page is the
// one page that carries one (its docs/drawBot.md §5.1); WHICH page carries
// it is pinned in that app's tree. As with the forward arrow, the generic
// addition is pinned HERE: the attributes and the surface's declaration
// and draw as separate cases.

describe('underlayPathAttrs', () => {
  it('passes the path and what is given, and says none for a fill or stroke left out', () => {
    expect(underlayPathAttrs({ d: 'M0 0L1 1' })).toEqual({ d: 'M0 0L1 1', fill: 'none', stroke: 'none' });
    expect(underlayPathAttrs({ d: 'M0 0', fill: '#123', stroke: 'red', strokeWidth: 0.5, dash: [0.3, 0.3], cap: 'butt', join: 'miter' }))
      .toEqual({
        d: 'M0 0', fill: '#123', stroke: 'red', strokeWidth: 0.5, strokeDasharray: '0.3 0.3', strokeLinecap: 'butt', strokeLinejoin: 'miter',
      });
    // An empty dash is solid: no attribute at all.
    expect(underlayPathAttrs({ d: 'M0 0', stroke: 'red', dash: [] })).toEqual({ d: 'M0 0', fill: 'none', stroke: 'red' });
  });
});

describe('the surface draws it', () => {
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'components', 'CanvasSurface.tsx'), 'utf8');

  test('takes the underlay as a prop', () => {
    expect(SRC).toContain('underlay?: readonly UnderlayShape[];');
    expect(SRC).toMatch(/markers, forwardArrow, underlay, veiledIds/);
  });

  test('draws it as one static <svg> in the WORLD layer, after the background and before the scene, in cells, touching nothing', () => {
    const at = SRC.indexOf('data-page-underlay=""');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(SRC.indexOf('background: paintToCssBackground(state.background),'));
    expect(at).toBeLessThan(SRC.indexOf('{renderScene()}'));
    const svg = SRC.slice(at, SRC.indexOf('</svg>', at));
    expect(svg).toContain('viewBox={`0 0 ${WORLD_CELLS} ${pageCellsH}`}');
    expect(svg).toContain("pointerEvents: 'none'");
    expect(svg).toContain("<path key={k} {...underlayPathAttrs(shape)} {...(shape.mask ? { mask: `url(#${underlayMaskId(k)})` } : {})} />");
    // Nothing per camera frame: no writer, no ref.
    expect(SRC).not.toMatch(/underlayRef|writeUnderlay/);
  });
});

describe('a shape a host finds by name (UnderlayShape.id)', () => {
  // For a shape a live gesture moves or redraws BY REF: DrawBot's look
  // page draws every stroke by its underlay, so a drag of one writes its
  // transform on that path (the gesture side's `previewStandIn`), and
  // its gear page redraws the hull round the page's strokes per move.
  it('carries the name as a data attribute on its <path>, and none without one', () => {
    expect(UNDERLAY_ID_ATTR).toBe('data-underlay-id');
    expect(underlayPathAttrs({ d: 'M0 0', stroke: 'red', id: 'svg_3' }))
      .toEqual({ d: 'M0 0', fill: 'none', stroke: 'red', 'data-underlay-id': 'svg_3' });
    expect(underlayPathAttrs({ d: 'M0 0' })).not.toHaveProperty('data-underlay-id');
  });

  it('is found under the surface’s underlay <svg> or the one drawn over the scene, the name quoted', () => {
    expect(underlayShapeSelector('svg_3')).toBe(':is([data-page-underlay], [data-page-overlay]) [data-underlay-id="svg_3"]');
    expect(underlayShapeSelector('a"b\\c')).toBe(':is([data-page-underlay], [data-page-overlay]) [data-underlay-id="a\\"b\\\\c"]');
  });
});

describe('a shape seen only where other shapes paint (UnderlayShape.mask)', () => {
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'components', 'CanvasSurface.tsx'), 'utf8');

  test('is drawn through an SVG mask of the shape’s index, defined in the same <svg>, over the page and a page’s reach around it', () => {
    expect(underlayMaskId(3)).toBe('page-underlay-mask-3');
    const at = SRC.indexOf('data-page-underlay=""');
    const svg = SRC.slice(at, SRC.indexOf('</svg>', at));
    expect(svg).toContain('{underlay.some((shape) => shape.mask) ? (');
    expect(svg).toContain('id={underlayMaskId(k)}');
    expect(svg).toContain('maskUnits="userSpaceOnUse"');
    expect(svg).toContain('x={-WORLD_CELLS}');
    expect(svg).toContain('width={3 * WORLD_CELLS}');
    expect(svg).toContain('{shape.mask.map((m, j) => <path key={j} {...underlayPathAttrs(m)} />)}');
    // The mask's shapes are drawn with the same attributes: the host paints them white.
    expect(underlayPathAttrs({ d: 'M0 0', fill: '#fff' })).toEqual({ d: 'M0 0', fill: '#fff', stroke: 'none' });
  });
});

describe('a shape drawn OVER the page\'s objects (UnderlayShape.over)', () => {
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'components', 'CanvasSurface.tsx'), 'utf8');

  test('is left out of the underlay and drawn in a second static <svg> after the scene, under the ghosts, touching nothing', () => {
    const under = SRC.indexOf('data-page-underlay=""');
    expect(SRC.slice(under, SRC.indexOf('</svg>', under))).toContain('{underlay.map((shape, k) => (shape.over ? null : (');
    const at = SRC.indexOf('data-page-overlay=""');
    expect(at).toBeGreaterThan(SRC.indexOf('{renderScene()}'));
    expect(at).toBeLessThan(SRC.indexOf('data-ghost-layer'));
    const svg = SRC.slice(at, SRC.indexOf('</svg>', at));
    expect(svg).toContain('viewBox={`0 0 ${WORLD_CELLS} ${pageCellsH}`}');
    expect(svg).toContain("pointerEvents: 'none'");
    expect(svg).toContain('{underlay.map((shape, k) => (shape.over ? <path key={k} {...underlayPathAttrs(shape)} /> : null))}');
    // Only where a shape asks for it: a page with none has no second <svg>.
    expect(SRC).toContain('{underlay && underlay.some((shape) => shape.over) ? (');
  });
});
