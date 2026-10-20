import type { SVGObject } from '@/engine/types';
import { matApplyPoint } from '@/engine/sceneTransform';
import { strokeScaleForUnits, svgStrokeDefId, svgStrokeWidthUnits } from '@/engine/svgStroke';
import { SVG_UNITS_PER_L0_CELL } from '@/engine/svgExport';
import { flattenSVGSegmentsWithColor } from '@/engine/compositionOps';
import { drawnLeafOf } from '../drawnPose';
import { PREVIEW_ID_SUFFIX, shapeStrokePreviewFrame, sideD } from '../shapeStrokePreview';

// The Color brush's side previews on a shape with a turn and an inside
// stroke (bug report 85dc9b13: Fire.tile, a page of turned, inside-stroked
// triangles whose sides jumped unturned and fat for the length of a drag).
// The frame has to put a side exactly where the node draws it, and dress it
// exactly as the node does.

const PX = 24;
const U = SVG_UNITS_PER_L0_CELL;

/** One of Fire.tile's triangles: three per-side colours, an inside stroke,
 *  a free turn. */
function triangle(over: Partial<SVGObject> = {}): SVGObject {
  const a: [number, number] = [22.05, 10.74];
  const b: [number, number] = [23.72, 17.30];
  const c: [number, number] = [20.38, 17.30];
  return {
    id: 'svg_fire_6',
    name: 'polygon',
    shapeKind: 'polygon',
    color: { r: 206, g: 69, b: 235 },
    cellX: 20.38, cellY: 10.74, cellWidth: 3.34, cellHeight: 6.56,
    angleDeg: 30.44,
    stroke: { width: 0.54, position: 'inside' },
    segments: [
      { kind: 'line', start: a, end: b },
      { kind: 'line', start: b, end: c },
      { kind: 'line', start: c, end: a },
    ],
    subpaths: [
      { color: { r: 206, g: 69, b: 235 }, segments: [{ kind: 'line', start: a, end: b }] },
      { color: { r: 190, g: 80, b: 240 }, segments: [{ kind: 'line', start: b, end: c }] },
      { color: { r: 170, g: 100, b: 245 }, segments: [{ kind: 'line', start: c, end: a }] },
    ],
    ...over,
  } as unknown as SVGObject;
}

function parseMatrix(transform: string): [number, number, number, number, number, number] {
  const m = /^matrix\(([^)]+)\)$/.exec(transform);
  if (!m) throw new Error(`not a matrix: ${transform}`);
  const n = m[1].trim().split(/[\s,]+/).map(Number);
  expect(n).toHaveLength(6);
  return n as [number, number, number, number, number, number];
}

function apply(t: [number, number, number, number, number, number], x: number, y: number): [number, number] {
  const [a, b, c, d, e, f] = t;
  return [a * x + c * y + e, b * x + d * y + f];
}

describe('shapeStrokePreviewFrame', () => {
  test('a turned shape’s sides land where the node draws them, not where their local segments lie', () => {
    const obj = triangle();
    const d = drawnLeafOf('svg', obj);
    const frame = shapeStrokePreviewFrame(d, 1, PX);
    const t = parseMatrix(frame.transform);
    // A turn is not the identity: the preview is going somewhere else than
    // the local segment would have.
    expect(Math.abs(t[1])).toBeGreaterThan(1e-6);
    let moved = 0;
    for (const [i, seg] of obj.segments.entries()) {
      const flat = frame.flat[i].segment;
      expect(flat.kind).toBe(seg.kind);
      for (const end of ['start', 'end'] as const) {
        // The flat side is in the node's LOCAL cells; sideD emits it in the
        // node's units (×U), and through the frame's transform that is the
        // node's world point — the local cell through the world matrix —
        // in world px.
        const [lx, ly] = flat[end];
        const [wx, wy] = matApplyPoint(d.world, lx, ly);
        const [px, py] = apply(t, lx * U, ly * U);
        expect(px).toBeCloseTo(wx * PX, 6);
        expect(py).toBeCloseTo(wy * PX, 6);
        // …which is not where the stored, unturned vertex sits: that is
        // where the old preview drew it.
        const [sx, sy] = seg[end];
        if (Math.hypot(px - sx * PX, py - sy * PX) > 0.5) moved++;
      }
    }
    expect(moved).toBeGreaterThan(0);
  });

  test('the sides keep their per-subpath colours, in the draft’s flat order', () => {
    const obj = triangle();
    const frame = shapeStrokePreviewFrame(drawnLeafOf('svg', obj), 1, PX);
    expect(frame.flat.map((f) => f.color)).toEqual(flattenSVGSegmentsWithColor(obj).map((f) => f.color));
  });

  test('an inside stroke is dressed as the node dresses it: doubled width and the clip, under the preview’s own id', () => {
    const obj = triangle();
    const frame = shapeStrokePreviewFrame(drawnLeafOf('svg', obj), 1, PX);
    const attrs = new Map(frame.attrs);
    const width = svgStrokeWidthUnits(obj, strokeScaleForUnits(1, U), U);
    expect(attrs.get('fill')).toBe('none');
    expect(Number(attrs.get('stroke-width'))).toBeCloseTo(width * 2, 6);
    expect(attrs.get('stroke-linecap')).toBe('round');
    expect(attrs.get('stroke-linejoin')).toBe('round');
    const clipId = svgStrokeDefId(`${obj.id}${PREVIEW_ID_SUFFIX}`, 'clip');
    expect(attrs.get('clip-path')).toBe(`url(#${clipId})`);
    expect(frame.defs).toContain(`<clipPath id="${clipId}">`);
    // Never the node's own clip id: two defs under one id in one document
    // would leave the browser to pick.
    expect(clipId).not.toBe(svgStrokeDefId(obj.id, 'clip'));
    expect(frame.defs).not.toContain(`id="${svgStrokeDefId(obj.id, 'clip')}"`);
  });

  test('a plain centred stroke on an unturned shape: a pure px scale, the plain width, no clip', () => {
    const obj = triangle({ angleDeg: undefined, stroke: { width: 0.54, position: 'center' } });
    const frame = shapeStrokePreviewFrame(drawnLeafOf('svg', obj), 1, PX);
    const t = parseMatrix(frame.transform);
    expect(t[0]).toBeCloseTo(PX / U, 9);
    expect(t[1]).toBeCloseTo(0, 9);
    expect(t[2]).toBeCloseTo(0, 9);
    expect(t[3]).toBeCloseTo(PX / U, 9);
    const attrs = new Map(frame.attrs);
    expect(Number(attrs.get('stroke-width')))
      .toBeCloseTo(svgStrokeWidthUnits(obj, strokeScaleForUnits(1, U), U), 6);
    expect(attrs.has('clip-path')).toBe(false);
    expect(attrs.has('mask')).toBe(false);
    expect(frame.defs).toBe('');
  });

  test('sideD walks the engine’s own path builder in the node’s units', () => {
    const [seg] = triangle().segments;
    expect(sideD(seg)).toBe(`M ${22.05 * U},${10.74 * U} L ${23.72 * U},${17.3 * U}`);
  });
});
