import { computeSVGBbox } from '../compositionOps';
import { computeCircleSegments, isCircularSegments } from '../compositionArcMath';
import { mergedSVGObject } from '../compositionMergeObjects';
import { GEOMETRY_ADAPTERS } from '../sceneNodeGeometry';
import { PathSegment, RGBColor, SVGObject } from '../types';

// Stretching a MERGED object used to deform its arcs. A merge concatenates
// its sources' segments, so the result is a mix that no uniform-scale rule
// guards (`requiresUniformScale` only locks a path that is circular as a
// WHOLE) — and the per-axis map then moved each arc's start, end and center
// independently, leaving the one radius the arc format infers from them
// disagreeing with its own endpoints. The fix sheds arcs into polylines
// before a stretch, so the curve maps into a true ellipse.

const WHITE: RGBColor = { r: 255, g: 255, b: 255 };

function makeSVG(id: string, segments: PathSegment[]): SVGObject {
  return { id, segments, color: WHITE, ...computeSVGBbox(segments) };
}

function line(start: [number, number], end: [number, number]): PathSegment {
  return { kind: 'line', start, end };
}

/** A circle (arcs) merged with a square (lines) — the reported case. */
function mergedCircleAndSquare(): SVGObject {
  const circle = makeSVG('c', computeCircleSegments(0, 0, 8, 8));
  const box = makeSVG('s', [
    line([0, 0], [8, 0]), line([8, 0], [8, 8]), line([8, 8], [0, 8]), line([0, 8], [0, 0]),
  ]);
  return mergedSVGObject([circle, box], 'merged');
}

function bboxOf(o: SVGObject) {
  return { cellX: o.cellX, cellY: o.cellY, cellWidth: o.cellWidth, cellHeight: o.cellHeight };
}

const svgAdapter = GEOMETRY_ADAPTERS.svg;

describe('stretching a merged object', () => {
  test('the merge really does carry arcs into a mix no uniform rule guards', () => {
    const merged = mergedCircleAndSquare();
    expect(merged.segments.some((s) => s.kind === 'arc')).toBe(true);
    // Not circular as a whole — so nothing forces this to scale uniformly.
    expect(isCircularSegments(merged.segments)).toBe(false);
    expect(merged.subpaths?.length).toBe(2);
  });

  test('a stretch maps the circle into a TRUE ellipse, not a kinked arc', () => {
    const merged = mergedCircleAndSquare();
    const oldBbox = bboxOf(merged);
    // Twice as wide, half as tall: the circle should become an ellipse
    // with rx = 8, ry = 2, centered where the circle's center lands.
    const newBbox = { cellX: 0, cellY: 0, cellWidth: 16, cellHeight: 4 };
    const out = svgAdapter.rescale(merged, oldBbox, newBbox) as SVGObject;

    // Arcs are gone — the format cannot express an elliptical arc.
    expect(out.segments.every((s) => s.kind === 'line')).toBe(true);
    // Every vertex that came from the circle lies on the exact ellipse.
    const onEllipse = (p: readonly [number, number]) => {
      const dx = (p[0] - 8) / 8;
      const dy = (p[1] - 2) / 2;
      return Math.abs(dx * dx + dy * dy - 1) < 1e-9;
    };
    const circleVerts = out.segments.filter((s) => onEllipse(s.start));
    // The circle contributed a full polyline ring, not four broken arcs.
    expect(circleVerts.length).toBeGreaterThanOrEqual(32);
    // The square's corners still map to the stretched box's corners.
    const pts = out.segments.flatMap((s) => [s.start, s.end]);
    expect(pts.some((p) => Math.abs(p[0] - 0) < 1e-9 && Math.abs(p[1] - 0) < 1e-9)).toBe(true);
    expect(pts.some((p) => Math.abs(p[0] - 16) < 1e-9 && Math.abs(p[1] - 4) < 1e-9)).toBe(true);
    // And the stretched geometry really fills the box it was given.
    expect(computeSVGBbox(out.segments)).toEqual(newBbox);
  });

  test('subpaths are stretched the same way, so they stay parallel to segments', () => {
    const merged = mergedCircleAndSquare();
    const out = svgAdapter.rescale(
      merged, bboxOf(merged), { cellX: 0, cellY: 0, cellWidth: 16, cellHeight: 4 },
    ) as SVGObject;
    const fromSubpaths = (out.subpaths ?? []).flatMap((sp) => sp.segments);
    expect(fromSubpaths.every((s) => s.kind === 'line')).toBe(true);
    // Same count and same points as the flat list — a subpath that kept its
    // arcs would render a different shape than the object's own segments.
    expect(fromSubpaths).toHaveLength(out.segments.length);
    expect(fromSubpaths).toEqual(out.segments);
  });

  test('a UNIFORM scale keeps the arcs exact — a circle is still a circle', () => {
    const merged = mergedCircleAndSquare();
    const out = svgAdapter.rescale(
      merged, bboxOf(merged), { cellX: 0, cellY: 0, cellWidth: 16, cellHeight: 16 },
    ) as SVGObject;
    const arcs = out.segments.filter((s) => s.kind === 'arc');
    expect(arcs).toHaveLength(4);
    for (const seg of arcs) {
      if (seg.kind !== 'arc') continue;
      const r1 = Math.hypot(seg.start[0] - seg.center[0], seg.start[1] - seg.center[1]);
      const r2 = Math.hypot(seg.end[0] - seg.center[0], seg.end[1] - seg.center[1]);
      expect(r1).toBeCloseTo(8, 9); // radius 4 doubled
      expect(Math.abs(r1 - r2)).toBeLessThan(1e-9);
    }
    // Still recognizable as one circle, so it keeps scaling as a circle.
    expect(isCircularSegments(arcs)).toBe(true);
  });

  test('a pure translate (scale 1) leaves the arcs alone', () => {
    const merged = mergedCircleAndSquare();
    const out = svgAdapter.rescale(
      merged, bboxOf(merged), { cellX: 5, cellY: 7, cellWidth: 8, cellHeight: 8 },
    ) as SVGObject;
    expect(out.segments.filter((s) => s.kind === 'arc')).toHaveLength(4);
  });

  test('a stretch that only LOOKS non-uniform by float noise keeps its arcs', () => {
    // The two factors are float quotients; an exactly-uniform resize can
    // land a few ulps apart and must not be read as a stretch.
    const merged = mergedCircleAndSquare();
    const out = svgAdapter.rescale(
      merged, bboxOf(merged),
      { cellX: 0, cellY: 0, cellWidth: 16, cellHeight: 16 * (1 + 1e-12) },
    ) as SVGObject;
    expect(out.segments.filter((s) => s.kind === 'arc')).toHaveLength(4);
  });
});
