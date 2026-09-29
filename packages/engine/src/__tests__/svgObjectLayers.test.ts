/**
 * A shape's markup in two halves (buildSVGObjectLayers): the host that lays
 * an HTML paint canvas between its fill and its strokes — the live DOM node
 * layer — reads this instead of the flat builder. The halves must be the
 * flat markup's pieces, in the flat markup's order, with the paint layer's
 * place held by a clip an HTML element can be cut with.
 */

import { createImagePaintOverlay, shapePaintClipId, shapePaintClipMarkup, stampImagePaintOverlay } from '../imagePaintOverlay';
import { buildSVGObjectContent, buildSVGObjectLayers, svgObjectOpacity } from '../svgPathBuilder';
import { SVG_UNITS_PER_L0_CELL } from '../svgExport';
import { ImagePaintOverlay, RGBColor, SVGObject } from '../types';

const RED: RGBColor = { r: 255, g: 0, b: 0 };
const U = SVG_UNITS_PER_L0_CELL;

function makeShape(overrides: Partial<SVGObject> = {}): SVGObject {
  return {
    id: 'svg_1',
    segments: [
      { kind: 'line', start: [2, 1], end: [10, 1] },
      { kind: 'line', start: [10, 1], end: [10, 7] },
      { kind: 'line', start: [10, 7], end: [2, 7] },
      { kind: 'line', start: [2, 7], end: [2, 1] },
    ],
    color: { r: 0, g: 0, b: 0 },
    cellX: 2, cellY: 1, cellWidth: 8, cellHeight: 6,
    fill: {
      type: 'solid', solid: { r: 200, g: 230, b: 255 },
      stops: [{ offset: 0, color: { r: 200, g: 230, b: 255 } }, { offset: 1, color: { r: 200, g: 230, b: 255 } }],
      angle: 90, opacity: 1, blend: 'normal',
    },
    ...overrides,
  };
}

function paintedOverlay(): ImagePaintOverlay {
  const o = createImagePaintOverlay(8, 6, 'multiply');
  stampImagePaintOverlay(o, 8, 6, 4.125, 3.125, 1, RED, 1);
  return o;
}

describe('shapePaintClipMarkup — the outline as a clip for a canvas outside the svg', () => {
  test('objectBoundingBox units: the outline moved off the box corner and scaled onto the unit square', () => {
    const markup = shapePaintClipMarkup('svg_1', 'M 512,256 L 2560,256 Z', 512, 256, 2048, 1536);
    expect(markup).toContain(`<clipPath id="${shapePaintClipId('svg_1')}" clipPathUnits="objectBoundingBox">`);
    expect(markup).toContain('<path d="M 512,256 L 2560,256 Z" fill-rule="nonzero"');
    // scale first in reading order, translate applied first in effect: the
    // corner goes to the origin, then the box to 1 × 1.
    expect(markup).toContain(`transform="scale(${1 / 2048} ${1 / 1536}) translate(-512 -256)"`);
    expect(markup).not.toContain('<foreignObject');
    expect(markup).not.toContain('data:');
  });

  test('a box with no area, or no outline, gives no clip', () => {
    expect(shapePaintClipMarkup('svg_1', 'M 0,0 Z', 0, 0, 0, 6)).toBe('');
    expect(shapePaintClipMarkup('svg_1', 'M 0,0 Z', 0, 0, 8, 0)).toBe('');
    expect(shapePaintClipMarkup('svg_1', '', 0, 0, 8, 6)).toBe('');
  });

  test('the id is the one the in-svg overlay clips through', () => {
    expect(shapePaintClipId('svg_9')).toBe('paintclip_svg_9');
  });
});

describe('buildSVGObjectLayers', () => {
  test('fill half: the fill path and the paint clip, no overlay carrier of any kind', () => {
    const shape = makeShape({ paintOverlay: paintedOverlay() });
    const layers = buildSVGObjectLayers(shape, 1, U, { nonScaling: false });
    expect(layers.fill).toContain('fill="#C8E6FF"');
    expect(layers.fill).toContain('stroke="none" fill-rule="nonzero"');
    expect(layers.fill).toContain(`<clipPath id="${shapePaintClipId('svg_1')}" clipPathUnits="objectBoundingBox">`);
    expect(layers.fill).toContain(`translate(${-2 * U} ${-1 * U})`);
    expect(layers.fill).toContain(`scale(${1 / (8 * U)} ${1 / (6 * U)})`);
    expect(layers.paintClipId).toBe('paintclip_svg_1');
    for (const half of [layers.fill, layers.strokes]) {
      expect(half).not.toContain('<foreignObject');
      expect(half).not.toContain('<image ');
      expect(half).not.toContain('data:image/png');
      expect(half).not.toContain('isolation:isolate');
    }
  });

  test('strokes half: the outline path, and nothing of the fill', () => {
    const layers = buildSVGObjectLayers(makeShape(), 1, U, { nonScaling: false });
    expect(layers.strokes).toContain('stroke="rgb(0,0,0)"');
    expect(layers.strokes).not.toContain('fill="#C8E6FF"');
    expect(layers.fill).not.toContain('stroke="rgb(0,0,0)"');
  });

  test('the clip is there before any paint is — a first dab needs it', () => {
    const layers = buildSVGObjectLayers(makeShape(), 1, U, { nonScaling: false });
    expect(layers.fill).toContain('clipPathUnits="objectBoundingBox"');
    expect(layers.paintClipId).toBe('paintclip_svg_1');
  });

  test('the halves joined are the flat markup, piece for piece', () => {
    // No stroke defs on a plain shape, so the order of the pieces is the
    // same in both: fill, (clip), pattern, strokes, glow band.
    const shape = makeShape();
    const flat = buildSVGObjectContent(shape, 1, U, { nonScaling: false });
    const layers = buildSVGObjectLayers(shape, 1, U, { nonScaling: false });
    const clip = layers.fill.slice(layers.fill.indexOf('<clipPath'), layers.fill.indexOf('</clipPath>') + '</clipPath>'.length);
    expect(layers.fill.replace(clip, '') + layers.strokes).toBe(flat);
  });

  test('the whole-object opacity is reported, not wrapped', () => {
    const shape = makeShape({ opacity: 0.4 });
    const flat = buildSVGObjectContent(shape, 1, U, { nonScaling: false });
    expect(flat).toContain('opacity="0.4"');
    const layers = buildSVGObjectLayers(shape, 1, U, { nonScaling: false });
    expect(layers.opacity).toBe(0.4);
    expect(layers.fill).not.toContain('opacity="0.4"');
    expect(layers.strokes).not.toContain('opacity="0.4"');
    expect(svgObjectOpacity({ opacity: 1.7 })).toBe(1);
    expect(svgObjectOpacity({})).toBe(1);
  });

  test('subpaths ride the strokes half, and the unclosed-outline case has no clip', () => {
    const shape = makeShape({
      fill: undefined,
      subpaths: [{ segments: [{ kind: 'line', start: [0, 0], end: [4, 0] }], color: RED }],
    });
    const layers = buildSVGObjectLayers(shape, 1, U, { nonScaling: false });
    expect(layers.strokes).toContain('stroke="rgb(255,0,0)"');
    expect(layers.fill).toContain('clipPathUnits="objectBoundingBox"');
    const open = makeShape({ fill: undefined, segments: [{ kind: 'line', start: [0, 0], end: [4, 0] }], cellWidth: 4, cellHeight: 0 });
    const openLayers = buildSVGObjectLayers(open, 1, U, { nonScaling: false });
    expect(openLayers.paintClipId).toBeNull();
    expect(openLayers.fill).not.toContain('<clipPath');
  });

  test('a repeat-mode shape comes back whole, in the strokes half', () => {
    const shape = makeShape({ tileMode: 'repeat', tileWidthL0: 2, tileHeightL0: 2 });
    const layers = buildSVGObjectLayers(shape, 1, U, { nonScaling: false });
    expect(layers.fill).toBe('');
    expect(layers.paintClipId).toBeNull();
    expect(layers.strokes).toBe(buildSVGObjectContent(shape, 1, U, { nonScaling: false }));
  });

  test('an empty shape is two empty halves', () => {
    expect(buildSVGObjectLayers(makeShape({ segments: [] }), 1, U)).toEqual({ fill: '', strokes: '', opacity: 1, paintClipId: null });
  });
});
