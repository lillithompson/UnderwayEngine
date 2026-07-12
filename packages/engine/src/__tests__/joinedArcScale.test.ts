import {
  computeSVGBbox,
  rescaleSVGToBbox,
} from '../compositionOps';
import { joinItems } from '../compositionJoin';
import { SVGObject, PathSegment } from '../types';
import { arcRadius } from '../compositionArcMath';

const WHITE = { r: 255, g: 255, b: 255 };

function makeArc(id: string, segments: PathSegment[]): SVGObject {
  return { id, segments, color: WHITE, ...computeSVGBbox(segments) };
}

function makeLine(id: string, segments: PathSegment[]): SVGObject {
  return { id, segments, color: WHITE, ...computeSVGBbox(segments) };
}

// Two quarter-circle arcs that share an endpoint at (3, 3). The join's
// AABB is x:[0, 6], y:[0, 3] — non-square (2:1 ratio), exactly the case
// the user reported as "proportions that don't match the grid".
function joinedTwoArcs(): SVGObject {
  const a = makeArc('a', [{ kind: 'arc', start: [0, 0], end: [3, 3], center: [0, 3] }]);
  const b = makeArc('b', [{ kind: 'arc', start: [3, 3], end: [6, 0], center: [6, 3] }]);
  const segs = joinItems([a, b]);
  return {
    id: 'join',
    segments: segs,
    color: WHITE,
    ...computeSVGBbox(segs),
  };
}

describe('joined arc scaling preserves arc round-ness', () => {
  test('joined two-arc bbox matches the AABB of all segment points', () => {
    const u = joinedTwoArcs();
    // start (0,0), end (3,3), center (0,3) for arc a
    // start (3,3), end (6,0), center (6,3) for arc b
    expect(u.cellX).toBe(0);
    expect(u.cellY).toBe(0);
    expect(u.cellWidth).toBe(6);
    expect(u.cellHeight).toBe(3);
  });

  test('proportional rescale (sX = sY) preserves dist(center, start) == dist(center, end)', () => {
    const u = joinedTwoArcs();
    const oldBbox = { cellX: u.cellX, cellY: u.cellY, cellWidth: u.cellWidth, cellHeight: u.cellHeight };
    // Scale 2x in both axes — uniform, what the aspect-locked corner
    // handle actually produces in practice.
    const newBbox = { cellX: 0, cellY: 0, cellWidth: 12, cellHeight: 6 };
    const scaled = rescaleSVGToBbox(u.segments, oldBbox, newBbox);
    for (let i = 0; i < scaled.length; i++) {
      const seg = scaled[i];
      if (seg.kind !== 'arc') continue;
      const r1 = Math.hypot(seg.start[0] - seg.center[0], seg.start[1] - seg.center[1]);
      const r2 = Math.hypot(seg.end[0]   - seg.center[0], seg.end[1]   - seg.center[1]);
      // Quarter-circle invariant: both arms of the arc share a radius.
      expect(Math.abs(r1 - r2)).toBeLessThan(1e-9);
      // The renderer reads `arcRadius` (= dist(center, start)); make sure
      // it equals the input radius scaled by the same factor (here 2).
      const orig = u.segments[i];
      if (orig.kind === 'arc') {
        expect(arcRadius(seg)).toBeCloseTo(arcRadius(orig) * 2, 9);
      }
    }
  });

  test('repeated proportional scales do not accumulate distortion', () => {
    const u = joinedTwoArcs();
    let bbox = { cellX: u.cellX, cellY: u.cellY, cellWidth: u.cellWidth, cellHeight: u.cellHeight };
    let segs = u.segments;
    // Five proportional scales (in both directions) — what a user dragging
    // the corner handle several times would do.
    const factors = [1.5, 0.8, 2.0, 0.5, 1.25];
    for (const f of factors) {
      const next = { cellX: bbox.cellX, cellY: bbox.cellY, cellWidth: bbox.cellWidth * f, cellHeight: bbox.cellHeight * f };
      segs = rescaleSVGToBbox(segs, bbox, next);
      bbox = next;
    }
    for (const seg of segs) {
      if (seg.kind !== 'arc') continue;
      const r1 = Math.hypot(seg.start[0] - seg.center[0], seg.start[1] - seg.center[1]);
      const r2 = Math.hypot(seg.end[0]   - seg.center[0], seg.end[1]   - seg.center[1]);
      expect(Math.abs(r1 - r2)).toBeLessThan(1e-9);
    }
  });

  test('arc + line join: line segment endpoints follow the bbox proportionally', () => {
    // line (0,0) → (3,3) joined to arc (3,3) → (6,0) with center (6,3).
    const l = makeLine('l', [{ kind: 'line', start: [0, 0], end: [3, 3] }]);
    const a = makeArc('a', [{ kind: 'arc', start: [3, 3], end: [6, 0], center: [6, 3] }]);
    const segs = joinItems([l, a]);
    const oldBbox = computeSVGBbox(segs);
    const newBbox = { cellX: 10, cellY: 10, cellWidth: oldBbox.cellWidth * 2, cellHeight: oldBbox.cellHeight * 2 };
    const scaled = rescaleSVGToBbox(segs, oldBbox, newBbox);

    // Joint between line and arc must stay at the same shared point.
    const lineEnd = scaled[0].kind === 'line' ? scaled[0].end : null;
    const arcStart = scaled[1].kind === 'arc' ? scaled[1].start : null;
    expect(lineEnd).not.toBeNull();
    expect(arcStart).not.toBeNull();
    expect(lineEnd![0]).toBeCloseTo(arcStart![0], 9);
    expect(lineEnd![1]).toBeCloseTo(arcStart![1], 9);
    // The arc segment still respects the radius invariant after scale.
    const arcSeg = scaled[1] as Extract<PathSegment, { kind: 'arc' }>;
    const r1 = Math.hypot(arcSeg.start[0] - arcSeg.center[0], arcSeg.start[1] - arcSeg.center[1]);
    const r2 = Math.hypot(arcSeg.end[0]   - arcSeg.center[0], arcSeg.end[1]   - arcSeg.center[1]);
    expect(Math.abs(r1 - r2)).toBeLessThan(1e-9);
  });

  test('rescaleSVGToBbox maps polyline segments onto the new frame', () => {
    const segs: PathSegment[] = [
      { kind: 'line', start: [0, 0], end: [2, 4] },
      { kind: 'line', start: [2, 4], end: [4, 0] },
    ];
    const oldBbox = computeSVGBbox(segs);
    const newBbox = { cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 8 };
    const scaled = rescaleSVGToBbox(segs, oldBbox, newBbox);
    expect(scaled).toEqual([
      { kind: 'line', start: [0, 0], end: [4, 8] },
      { kind: 'line', start: [4, 8], end: [8, 0] },
    ]);
  });

  test('independent per-point rounding (the old snapPt path) breaks the radius invariant', () => {
    const u = joinedTwoArcs();
    const oldBbox = { cellX: u.cellX, cellY: u.cellY, cellWidth: u.cellWidth, cellHeight: u.cellHeight };
    // Factor 1.5 pushes coordinates to .5 values (e.g. 4.5) where
    // Math.round rounds up, shifting x and y arms of the arc by
    // different amounts and breaking the radius invariant.
    const factor = 1.5;
    const newBbox = { cellX: 0, cellY: 0, cellWidth: oldBbox.cellWidth * factor, cellHeight: oldBbox.cellHeight * factor };
    const scaled = rescaleSVGToBbox(u.segments, oldBbox, newBbox);

    // Unsnapped segments preserve the radius invariant.
    for (const seg of scaled) {
      if (seg.kind !== 'arc') continue;
      const r1 = Math.hypot(seg.start[0] - seg.center[0], seg.start[1] - seg.center[1]);
      const r2 = Math.hypot(seg.end[0] - seg.center[0], seg.end[1] - seg.center[1]);
      expect(Math.abs(r1 - r2)).toBeLessThan(1e-9);
    }

    // Simulate the old snapPt behavior: round each point to integer grid.
    const snap = (v: number) => Math.round(v);
    const snapped = scaled.map(seg => seg.kind === 'arc' ? {
      kind: 'arc' as const,
      start: [snap(seg.start[0]), snap(seg.start[1])] as [number, number],
      end: [snap(seg.end[0]), snap(seg.end[1])] as [number, number],
      center: [snap(seg.center[0]), snap(seg.center[1])] as [number, number],
    } : seg);

    // At least one snapped arc segment should have a broken radius
    // invariant, demonstrating why snapPt must not be applied.
    let anyBroken = false;
    for (const seg of snapped) {
      if (seg.kind !== 'arc') continue;
      const r1 = Math.hypot(seg.start[0] - seg.center[0], seg.start[1] - seg.center[1]);
      const r2 = Math.hypot(seg.end[0] - seg.center[0], seg.end[1] - seg.center[1]);
      if (Math.abs(r1 - r2) > 0.01) anyBroken = true;
    }
    expect(anyBroken).toBe(true);
  });

  test('commit without snapping preserves the radius invariant for non-grid-aligned scale factors', () => {
    const u = joinedTwoArcs();
    const oldBbox = { cellX: u.cellX, cellY: u.cellY, cellWidth: u.cellWidth, cellHeight: u.cellHeight };
    const factors = [1.3, 1.7, 2.5, 0.6, 3.1];
    for (const factor of factors) {
      const newBbox = { cellX: 0, cellY: 0, cellWidth: oldBbox.cellWidth * factor, cellHeight: oldBbox.cellHeight * factor };
      const scaled = rescaleSVGToBbox(u.segments, oldBbox, newBbox);
      for (const seg of scaled) {
        if (seg.kind !== 'arc') continue;
        const r1 = Math.hypot(seg.start[0] - seg.center[0], seg.start[1] - seg.center[1]);
        const r2 = Math.hypot(seg.end[0] - seg.center[0], seg.end[1] - seg.center[1]);
        expect(Math.abs(r1 - r2)).toBeLessThan(1e-9);
      }
    }
  });

  test('scaling from localSegments identity survives collapse to 1×1 and recovery', () => {
    // Simulate the transform-based scaling flow:
    // 1. Start with identity segments (localSegments)
    // 2. Scale to tiny (1×0.5) — world segments collapse
    // 3. Scale back up from the identity — full geometry recovers
    const u = joinedTwoArcs();
    const identity = u.segments;
    const identityBbox = { cellX: u.cellX, cellY: u.cellY, cellWidth: u.cellWidth, cellHeight: u.cellHeight };

    // Scale to 1×0.5 (aspect 2:1 maintained)
    const tinyBbox = { cellX: 0, cellY: 0, cellWidth: 1, cellHeight: 0.5 };
    const tinySegs = rescaleSVGToBbox(identity, identityBbox, tinyBbox);

    // World segments are tiny but still valid
    const tinySVGBbox = computeSVGBbox(tinySegs);
    expect(tinySVGBbox.cellWidth).toBeCloseTo(1, 9);
    expect(tinySVGBbox.cellHeight).toBeCloseTo(0.5, 9);

    // Now scale back to original size, mapping from IDENTITY (not tiny)
    const recoveredBbox = { cellX: 0, cellY: 0, cellWidth: 6, cellHeight: 3 };
    const recovered = rescaleSVGToBbox(identity, identityBbox, recoveredBbox);

    // Recovered segments match the original exactly
    for (let i = 0; i < identity.length; i++) {
      const orig = identity[i];
      const rec = recovered[i];
      expect(rec.kind).toBe(orig.kind);
      expect(rec.start[0]).toBeCloseTo(orig.start[0], 9);
      expect(rec.start[1]).toBeCloseTo(orig.start[1], 9);
      expect(rec.end[0]).toBeCloseTo(orig.end[0], 9);
      expect(rec.end[1]).toBeCloseTo(orig.end[1], 9);
      if (orig.kind === 'arc' && rec.kind === 'arc') {
        expect(rec.center[0]).toBeCloseTo(orig.center[0], 9);
        expect(rec.center[1]).toBeCloseTo(orig.center[1], 9);
      }
    }

    // And the radius invariant holds
    for (const seg of recovered) {
      if (seg.kind !== 'arc') continue;
      const r1 = Math.hypot(seg.start[0] - seg.center[0], seg.start[1] - seg.center[1]);
      const r2 = Math.hypot(seg.end[0] - seg.center[0], seg.end[1] - seg.center[1]);
      expect(Math.abs(r1 - r2)).toBeLessThan(1e-9);
    }
  });

  test('degenerate axis (horizontal line) survives a vertical-only resize without divide-by-zero', () => {
    // Pure horizontal line: width 6, height 0.
    const segs: PathSegment[] = [{ kind: 'line', start: [0, 5], end: [6, 5] }];
    const oldBbox = computeSVGBbox(segs);
    expect(oldBbox.cellHeight).toBe(0);
    // Caller asks for a non-degenerate frame — segments should translate
    // (degenerate axis falls back to scale=1) but not NaN out.
    const newBbox = { cellX: 0, cellY: 10, cellWidth: 12, cellHeight: 4 };
    const scaled = rescaleSVGToBbox(segs, oldBbox, newBbox);
    expect(scaled).toHaveLength(1);
    for (const seg of scaled) {
      expect(Number.isFinite(seg.start[0])).toBe(true);
      expect(Number.isFinite(seg.start[1])).toBe(true);
      expect(Number.isFinite(seg.end[0])).toBe(true);
      expect(Number.isFinite(seg.end[1])).toBe(true);
    }
  });
});
