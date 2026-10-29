import fs from 'fs';
import path from 'path';
import { underlayPathAttrs } from '../pageUnderlay';

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
    expect(svg).toContain('{underlay.map((shape, k) => <path key={k} {...underlayPathAttrs(shape)} />)}');
    // Nothing per camera frame: no writer, no ref.
    expect(SRC).not.toMatch(/underlayRef|writeUnderlay/);
  });
});
