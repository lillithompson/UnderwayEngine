import fs from 'fs';
import path from 'path';
import { BASE_CELL_PX } from '../cameraMath';
import { FakeEl } from './test-utils';
import {
  FORWARD_ARROW_COLOR, FORWARD_ARROW_HEAD, FORWARD_ARROW_WIDTH, forwardArrowPath, writeForwardArrow,
} from '../regionChromeScreen';

// The forward arrow (`EditorConfig.forwardArrow`): a faint, non-printing
// guide saying the top of the page leads, drawn in the region chrome's
// screen-space overlay the way a template's guides are, never in the
// picture. DrawBot's bot look page is the one page that carries one
// (its docs/drawBot.md §5.1); WHICH page carries it, and the surface's
// own group for it, are pinned in that app's tree.


beforeAll(() => {
  (globalThis as unknown as { document: unknown }).document = {
    createElementNS: (_ns: string, tag: string) => new FakeEl(tag),
  };
});

const T = { translateX: 10, translateY: 100, scale: 0.5 };
const ARROW = { x: 16, tailY: -1, tipY: -4 };
const px = (cells: number) => cells * BASE_CELL_PX * T.scale;

describe('forwardArrowPath', () => {
  it('is the shaft up to the tip, then the head’s two strokes back from it, through the camera', () => {
    const x = T.translateX + px(16);
    const tail = T.translateY + px(-1);
    const tip = T.translateY + px(-4);
    const head = (tail - tip) * FORWARD_ARROW_HEAD;
    expect(forwardArrowPath(ARROW, T)).toBe(
      `M${x} ${tail}L${x} ${tip}M${x - head} ${tip + head}L${x} ${tip}L${x + head} ${tip + head}`,
    );
  });

  it('points the head the way the arrow runs', () => {
    const down = forwardArrowPath({ x: 0, tailY: 0, tipY: 4 }, { translateX: 0, translateY: 0, scale: 1 });
    const tip = 4 * BASE_CELL_PX;
    const head = tip * FORWARD_ARROW_HEAD;
    expect(down.endsWith(`L0 ${tip}L${head} ${tip - head}`)).toBe(true);
  });

  it('is nothing at a scale that is not positive', () => {
    expect(forwardArrowPath(ARROW, { ...T, scale: 0 })).toBe('');
  });
});

describe('writeForwardArrow', () => {
  it('mints one faint round-capped path, reused on every camera frame', () => {
    const g = new FakeEl('g');
    writeForwardArrow(g as never, T, ARROW);
    writeForwardArrow(g as never, { ...T, scale: 1 }, ARROW);
    expect(g.children).toHaveLength(1);
    const path = g.children[0];
    expect(path.tag).toBe('path');
    expect(path.getAttribute('fill')).toBe('none');
    expect(path.getAttribute('stroke')).toBe(FORWARD_ARROW_COLOR);
    expect(path.getAttribute('stroke-width')).toBe(String(FORWARD_ARROW_WIDTH));
    expect(path.getAttribute('stroke-linecap')).toBe('round');
    expect(path.getAttribute('d')).toBe(forwardArrowPath(ARROW, { ...T, scale: 1 }));
  });

  it('clears the group for a page with no arrow, and tolerates no group', () => {
    const g = new FakeEl('g');
    writeForwardArrow(g as never, T, ARROW);
    writeForwardArrow(g as never, T, null);
    expect(g.children).toHaveLength(0);
    expect(() => writeForwardArrow(null, T, ARROW)).not.toThrow();
  });
});

// The arrow is DrawBot's feature and no CozyJournal or Sol page carries
// one, so nothing in those trees can fail when the surface stops drawing
// it: the §4.3 rule for a generic addition adopted from a non-canonical
// copy — pin it HERE, and pin the DECLARATION and the WRITE as separate
// cases, which is the lesson `SvgNodeLayer`'s `children` cost at 5a.
describe('the surface draws it', () => {
  const SRC = fs.readFileSync(
    path.join(__dirname, '..', 'components', 'CanvasSurface.tsx'), 'utf8',
  );

  test('takes the arrow as a prop and holds it in a ref for the camera path', () => {
    expect(SRC).toContain('forwardArrow?: ForwardArrow;');
    expect(SRC).toContain('const forwardArrowRef = useRef<ForwardArrow | null>(null);');
  });

  test('gives it a <g> of its own, not the region chrome’s', () => {
    // writeRegionChrome CLEARS its group when there is no region, and a
    // page can carry an arrow with no region at all.
    expect(SRC).toContain('const arrowGroupRef = useRef<SVGGElement | null>(null);');
    expect(SRC).toContain('<g ref={arrowGroupRef} data-forward-arrow-group="" />');
  });

  test('writes it on BOTH screen-space paths: the live camera and the render', () => {
    // Screen-space chrome has to be re-anchored per camera frame as well
    // as per render, the way the region's veil and the symmetry axes are;
    // one path alone leaves the arrow lagging a pinch or stale after a
    // commit.
    const calls = SRC.match(/writeForwardArrow\(arrowGroupRef\.current, t, forwardArrowRef\.current\)/g);
    expect(calls).toHaveLength(2);
    // …and the render path re-runs when the arrow itself changes.
    expect(SRC).toMatch(/markers, regionTargets, forwardArrow\]\);/);
  });
});
