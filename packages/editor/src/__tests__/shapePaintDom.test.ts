/**
 * The two forms of a shape node's DOM and the helpers that move between
 * them (shapePaintDom.ts): a paint stroke splits a one-svg shape into its
 * fill and strokes halves for the canvas to sit between, mounts both, and
 * puts the shape back whole on the drop; the imperative previews mount
 * whichever form they find.
 */

import type { SVGObject } from '@/engine/types';
import { makeBlankComposition } from '@/editor/blankComposition';
import { buildPlaceSVGObject, buildPlaceShape, commitEntry, createEditorSession } from '../editorSession';
import { DrawnLeaf, drawnLeaves, svgLayerMarkup, svgLayerSplitMarkup } from '../drawnPose';
import {
  SHAPE_FILL_SVG_ATTR, SHAPE_STROKES_SVG_ATTR, ShapeHostLike, ShapeSvgLike, SvgElementFactory,
  mountShapeMarkup, shapeContentSvgs, splitShapeDom, unsplitShapeDom,
} from '../shapePaintDom';

const INK = { r: 40, g: 40, b: 40 };
const solid = (c: { r: number; g: number; b: number }): SVGObject['fill'] => ({
  type: 'solid', solid: c, angle: 0, stops: [{ offset: 0, color: c }, { offset: 1, color: c }],
  opacity: 1, blend: 'normal',
});

function placed(extra: Partial<SVGObject> = {}): { drawn: DrawnLeaf; shape: SVGObject } {
  const a = buildPlaceShape('rect', { cellX: 2, cellY: 2, cellWidth: 4, cellHeight: 2 }, INK);
  const base = (a.entry[0] as { item: SVGObject }).item;
  const shape: SVGObject = { ...base, fill: solid({ r: 200, g: 40, b: 40 }), ...extra };
  const session = commitEntry(createEditorSession(makeBlankComposition('dp')), buildPlaceSVGObject(shape));
  return { drawn: drawnLeaves(session.state.graph!).get(shape.id)!, shape };
}

// A host holding svgs in order, with the slice of the DOM the helpers use.
class FakeSvg implements ShapeSvgLike {
  attrs: Record<string, string> = {};
  innerHTML = '';
  style = { cssText: '' };
  constructor(public host: FakeHost) {}
  getAttribute(name: string) { return this.attrs[name] ?? null; }
  setAttribute(name: string, value: string) { this.attrs[name] = value; }
  after(node: ShapeSvgLike) { this.host.children.splice(this.host.children.indexOf(this) + 1, 0, node as FakeSvg); }
  remove() { this.host.children.splice(this.host.children.indexOf(this), 1); }
}
class FakeHost implements ShapeHostLike {
  children: FakeSvg[] = [];
  style = { opacity: '' };
  querySelector(selectors: string): FakeSvg | null {
    const m = /^svg\[(.+)\]$/.exec(selectors);
    if (!m) throw new Error(`unexpected selector ${selectors}`);
    return this.children.find((c) => m[1] in c.attrs) ?? null;
  }
}
const doc: SvgElementFactory & { host: FakeHost } = {
  host: new FakeHost(),
  createElementNS(_ns, _tag) { return new FakeSvg(doc.host); },
};

/** A host as NodeLayer mounts an unpainted shape: one svg, the whole markup. */
function wholeHost(drawn: DrawnLeaf): FakeHost {
  const host = new FakeHost();
  doc.host = host;
  const svg = new FakeSvg(host);
  svg.attrs = { [SHAPE_FILL_SVG_ATTR]: '', width: '100%', height: '100%', preserveAspectRatio: 'none' };
  svg.style.cssText = 'position: absolute; inset: 0px;';
  const { viewBox, html } = svgLayerMarkup(drawn, 1);
  svg.setAttribute('viewBox', viewBox);
  svg.innerHTML = html;
  host.children.push(svg);
  return host;
}

describe('shapeContentSvgs', () => {
  test('one svg is the fill and no strokes; the strokes attribute is what says split', () => {
    const { drawn } = placed();
    const host = wholeHost(drawn);
    expect(shapeContentSvgs(host)).toEqual({ fill: host.children[0], strokes: null });
  });
});

describe('splitShapeDom / unsplitShapeDom', () => {
  test('the split makes the strokes svg in the fill svg’s image, after it, and mounts both halves', () => {
    const { drawn, shape } = placed();
    const host = wholeHost(drawn);
    const fill = host.children[0];
    const made = splitShapeDom(doc, host, drawn, 1)!;
    expect(made).not.toBeNull();
    expect(host.children).toEqual([fill, made.strokes]);
    const strokes = made.strokes as FakeSvg;
    expect(strokes.attrs).toMatchObject({ [SHAPE_STROKES_SVG_ATTR]: '', width: '100%', height: '100%', preserveAspectRatio: 'none' });
    expect(strokes.style.cssText).toBe(fill.style.cssText);
    const split = svgLayerSplitMarkup(drawn, 1);
    expect(fill.innerHTML).toBe(split.fill);
    expect(strokes.innerHTML).toBe(split.strokes);
    expect(fill.attrs.viewBox).toBe(split.viewBox);
    expect(strokes.attrs.viewBox).toBe(split.viewBox);
    // The fill half carries the clip the canvas will be cut with.
    expect(fill.innerHTML).toContain(`paintclip_${shape.id}`);
    expect(fill.innerHTML).not.toContain('<foreignObject');
  });

  test('a shape already split (React’s painted form) is left alone', () => {
    const { drawn } = placed();
    const host = wholeHost(drawn);
    splitShapeDom(doc, host, drawn, 1);
    expect(splitShapeDom(doc, host, drawn, 1)).toBeNull();
    expect(host.children).toHaveLength(2);
  });

  test('a host with no svg is nothing to split', () => {
    const { drawn } = placed();
    const host = new FakeHost();
    doc.host = host;
    expect(splitShapeDom(doc, host, drawn, 1)).toBeNull();
  });

  test('the halves carry no whole-object opacity, so the host wears it for the split — and gives it back', () => {
    const { drawn } = placed({ opacity: 0.5 });
    const host = wholeHost(drawn);
    expect(host.children[0].innerHTML).toContain('opacity="0.5"');
    const made = splitShapeDom(doc, host, drawn, 1)!;
    expect(host.style.opacity).toBe('0.5');
    expect(host.children[0].innerHTML).not.toContain('opacity="0.5"');
    unsplitShapeDom(host, made, drawn, 1);
    expect(host.style.opacity).toBe('');
  });

  test('the unsplit removes the strokes svg and re-mounts the whole markup from the committed node', () => {
    const { drawn } = placed();
    const host = wholeHost(drawn);
    const fill = host.children[0];
    const before = { viewBox: fill.attrs.viewBox, html: fill.innerHTML };
    const made = splitShapeDom(doc, host, drawn, 1)!;
    expect(fill.innerHTML).not.toBe(before.html);
    unsplitShapeDom(host, made, drawn, 1);
    expect(host.children).toEqual([fill]);
    expect(fill.innerHTML).toBe(before.html);
    expect(fill.attrs.viewBox).toBe(before.viewBox);
  });

  test('with no committed node to mount (the shape left the scene), the svg is left for React', () => {
    const { drawn } = placed();
    const host = wholeHost(drawn);
    const made = splitShapeDom(doc, host, drawn, 1)!;
    const halfHtml = host.children[0].innerHTML;
    unsplitShapeDom(host, made, null, 1);
    expect(host.children).toHaveLength(1);
    expect(host.children[0].innerHTML).toBe(halfHtml);
  });
});

describe('mountShapeMarkup — whichever form the node is in', () => {
  test('a whole node takes the whole markup; a split node takes both halves', () => {
    const { drawn, shape } = placed();
    const host = wholeHost(drawn);
    const preview = { ...shape, fill: solid({ r: 20, g: 90, b: 220 }) };
    const geometry = { ...require('../drawnPose').svgDrawnGeometry(drawn, preview) };
    expect(mountShapeMarkup(host, drawn, 1, geometry)).toBeNull();
    expect(host.children[0].innerHTML.toLowerCase()).toContain('#145adc');
    expect(host.children[0].innerHTML).not.toContain(`<svg`);
    const made = splitShapeDom(doc, host, drawn, 1)!;
    const split = mountShapeMarkup(host, drawn, 1, geometry)!;
    expect(split.fill.toLowerCase()).toContain('#145adc');
    expect(host.children[0].innerHTML).toBe(split.fill);
    expect((made.strokes as FakeSvg).innerHTML).toBe(split.strokes);
  });

  test('no svg → nothing mounted, null', () => {
    const { drawn } = placed();
    expect(mountShapeMarkup(new FakeHost(), drawn, 1)).toBeNull();
  });
});
