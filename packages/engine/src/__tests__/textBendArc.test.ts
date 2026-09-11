/**
 * Arc-bent text (`TextStyle.bend`, the Type bar's Bend slider): the shared
 * arc geometry, the SVG export's <textPath> lines, and the v57 binary
 * payload (the text extension byte).
 */

import { textArcGeometry, textArcPaths, textBend } from '../textArc';
import {
  CompositionBundle,
  deserializeComposition,
  serializeComposition,
} from '../compositionBinaryFormat';
import { generateCompositionSVGCore, type CompositionSVGInputs } from '../compositionSVGCore';
import { TextObject, TextStyle } from '../types';

const style = (extras: Partial<TextStyle> = {}): TextStyle => ({
  fontId: 'system', size: 2, color: { r: 10, g: 20, b: 30 }, ...extras,
});

function makeText(overrides: Partial<TextObject> = {}): TextObject {
  return {
    id: 'txt_1',
    content: 'hello',
    style: style(),
    cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 3,
    ...overrides,
  };
}

// ── Arc geometry ────────────────────────────────────────────────────

describe('textArcGeometry', () => {
  test('full bend is a half circle: sweep π, arc length preserved', () => {
    const w = 10;
    const g = textArcGeometry(w, 1);
    expect(g.sweep).toBeCloseTo(Math.PI, 10);
    expect(g.radius).toBeCloseTo(w / Math.PI, 10);
    // Half circle: chord = diameter, apex rises a full radius.
    expect(g.halfChord).toBeCloseTo(g.radius, 10);
    expect(g.rise).toBeCloseTo(g.radius, 10);
    // The arc really is the flat width re-bent: R × sweep = w.
    expect(g.radius * g.sweep).toBeCloseTo(w, 10);
  });

  test('small bends flatten out: chord → width, rise → 0', () => {
    const g = textArcGeometry(10, 0.01);
    expect(g.halfChord * 2).toBeCloseTo(10, 3);
    expect(g.rise).toBeLessThan(0.05);
  });

  test('geometry depends on |bend|; the sign only picks the sweep flag', () => {
    expect(textArcGeometry(10, -0.5)).toEqual(textArcGeometry(10, 0.5));
  });
});

describe('textArcPaths', () => {
  // `M x0 y0 A r r 0 large sweep x1 y1` → its numbers.
  function parse(d: string) {
    const m = /^M (\S+) (\S+) A (\S+) (\S+) 0 (\d) (\d) (\S+) (\S+)$/.exec(d)!;
    expect(m).toBeTruthy();
    const [, x0, y0, r1, r2, large, sweepFlag, x1, y1] = m.map(Number);
    expect(r1).toBe(r2);
    return { x0, y0, r: r1, large, sweepFlag, x1, y1 };
  }
  // The centre of the circle an arc sits on, from its endpoints and radius —
  // below the chord for an upward bow (sweep flag 1), above for a downward.
  function centerOf(a: ReturnType<typeof parse>) {
    const mx = (a.x0 + a.x1) / 2, my = (a.y0 + a.y1) / 2;
    const half = Math.hypot(a.x1 - a.x0, a.y1 - a.y0) / 2;
    const d = Math.sqrt(Math.max(0, a.r * a.r - half * half));
    // Chord direction (x1-x0, y1-y0); its clockwise normal on screen.
    const nx = -(a.y1 - a.y0) / (2 * half), ny = (a.x1 - a.x0) / (2 * half);
    const s = a.sweepFlag === 1 ? 1 : -1;
    return { x: mx + s * nx * d, y: my + s * ny * d };
  }

  test('a lone line: positive bend arcs over the top (sweep flag 1), endpoints on the baseline, symmetric about the line center', () => {
    const [d] = textArcPaths([{ x: 2, y: 5, width: 10 }], 0.5);
    const a = parse(d);
    expect(a.y0).toBeCloseTo(5, 10);
    expect(a.y1).toBeCloseTo(5, 10);
    expect(a.sweepFlag).toBe(1);
    expect(a.large).toBe(0);
    // Endpoints straddle the line's center (x 2 + 10/2 = 7) symmetrically,
    // a chord of the widest line's own geometry.
    expect(a.x0 + a.x1).toBeCloseTo(14, 10);
    expect(a.x0).toBeLessThan(7);
    const g = textArcGeometry(10, 0.5);
    expect(a.r).toBeCloseTo(g.radius, 10);
    expect(a.x1 - a.x0).toBeCloseTo(2 * g.halfChord, 10);
  });

  test('negative bend arcs under the bottom (sweep flag 0)', () => {
    const [d] = textArcPaths([{ x: 0, y: 0, width: 10 }], -0.5);
    expect(d).toMatch(/A \S+ \S+ 0 0 0 /);
    expect(parse(d).y0).toBeCloseTo(0, 10);
  });

  test('a block bends as one: every line concentric with the widest, radii a line pitch apart', () => {
    // Three lines 2.4 apart, the middle one widest; bent up, the centre
    // lies below the block, so lower lines are the smaller rings.
    const lines = [
      { x: 3, y: 0, width: 4 },
      { x: 0, y: 2.4, width: 10 },
      { x: 2, y: 4.8, width: 6 },
    ];
    const arcs = textArcPaths(lines, 0.6).map(parse);
    const g = textArcGeometry(10, 0.6);
    expect(arcs[1].r).toBeCloseTo(g.radius, 10);
    expect(arcs[0].r).toBeCloseTo(g.radius + 2.4, 10);
    expect(arcs[2].r).toBeCloseTo(g.radius - 2.4, 10);
    const c = arcs.map(centerOf);
    for (const k of [0, 2]) {
      expect(c[k].x).toBeCloseTo(c[1].x, 8);
      expect(c[k].y).toBeCloseTo(c[1].y, 8);
    }
    // Each line keeps its own flat width as its arc length: chord = 2r·sin(w/2r).
    lines.forEach((l, i) => {
      expect(arcs[i].x1 - arcs[i].x0).toBeCloseTo(2 * arcs[i].r * Math.sin(l.width / (2 * arcs[i].r)), 8);
    });
    // And every apex bows off its own midline by the one rise.
    lines.forEach((l, i) => expect(c[i].y - arcs[i].r).toBeCloseTo(l.y - g.rise, 8));
  });

  test('bent down, the centre lies above: lower lines are the LARGER rings', () => {
    const lines = [{ x: 0, y: 0, width: 10 }, { x: 3, y: 2, width: 4 }];
    const arcs = textArcPaths(lines, -0.6).map(parse);
    expect(arcs[1].r).toBeCloseTo(arcs[0].r + 2, 10);
    const c = arcs.map(centerOf);
    expect(c[1].x).toBeCloseTo(c[0].x, 8);
    expect(c[1].y).toBeCloseTo(c[0].y, 8);
    expect(c[0].y).toBeLessThan(0);
  });

  test("a short line's curvature is the block's, not its own length's", () => {
    // Alone, a 3-wide line at bend 1 is a tight half circle (radius 3/π);
    // beside a 12-wide line it rides a ring a whisker off that line's
    // 12/π, through a small angle — the bug this replaces bent each line
    // by its own width, so short lines curled and long ones barely bowed.
    const [alone] = textArcPaths([{ x: 4.5, y: 0, width: 3 }], 1).map(parse);
    expect(alone.r).toBeCloseTo(3 / Math.PI, 10);
    const [short, long] = textArcPaths([{ x: 4.5, y: 0, width: 3 }, { x: 0, y: 2, width: 12 }], 1).map(parse);
    expect(long.r).toBeCloseTo(12 / Math.PI, 10);
    expect(short.r).toBeCloseTo(12 / Math.PI + 2, 10);
    // Its angle is its width over ITS ring: 3 / r, not a half turn.
    expect(short.x1 - short.x0).toBeCloseTo(2 * short.r * Math.sin(3 / (2 * short.r)), 8);
    expect(short.x1 - short.x0).toBeGreaterThan(2.9);
  });

  test("a line sits over its own flat centre; every point of it is drawn toward the block's centre, never past the block's flat extent", () => {
    // Left-aligned block: the short line's centre is left of the block's,
    // so its arc tilts toward the apex — each end no farther from the
    // block's centre line (x 5) than the flat end was.
    const lines = [{ x: 0, y: 0, width: 10 }, { x: 0, y: 2.4, width: 4 }];
    const [, a] = textArcPaths(lines, 0.8).map(parse);
    expect((a.x0 + a.x1) / 2).toBeLessThan(5);
    expect(Math.abs(a.x0 - 5)).toBeLessThanOrEqual(5);
    expect(Math.abs(a.x1 - 5)).toBeLessThanOrEqual(1);
    expect(a.x0).toBeGreaterThanOrEqual(0 - 1e-9);
    expect(a.x1).toBeLessThanOrEqual(10);
  });

  test('a ring never tightens past the half circle its own width makes', () => {
    // Widest line 4 wide at full bend: R = 4/π ≈ 1.27, and lines 2.4 apart
    // would put the next ring at a negative radius. It floors at its own
    // half circle instead of curling past a turn.
    const lines = [{ x: 0, y: 0, width: 4 }, { x: 0.5, y: 2.4, width: 3 }, { x: 1, y: 4.8, width: 2 }];
    const arcs = textArcPaths(lines, 1).map(parse);
    expect(arcs[1].r).toBeCloseTo(3 / Math.PI, 10);
    expect(arcs[2].r).toBeCloseTo(2 / Math.PI, 10);
    for (const a of arcs) expect(Number.isFinite(a.x0) && Number.isFinite(a.y1)).toBe(true);
  });

  test('empty lines get no path; a block of nothing but empties gets none at all', () => {
    expect(textArcPaths([{ x: 0, y: 0, width: 10 }, { x: 0, y: 2, width: 0 }], 0.5)[1]).toBe('');
    expect(textArcPaths([{ x: 0, y: 0, width: 0 }, { x: 0, y: 2, width: 0 }], 0.5)).toEqual(['', '']);
    expect(textArcPaths([{ x: 0, y: 0, width: 10 }], 0)).toEqual(['']);
  });
});

describe('textBend', () => {
  test('absent/zero → 0; values clamp to ±1; non-finite → 0', () => {
    expect(textBend(style())).toBe(0);
    expect(textBend(style({ bend: 0 }))).toBe(0);
    expect(textBend(style({ bend: 0.25 }))).toBe(0.25);
    expect(textBend(style({ bend: 7 }))).toBe(1);
    expect(textBend(style({ bend: -7 }))).toBe(-1);
    expect(textBend(style({ bend: NaN }))).toBe(0);
  });
});

// ── SVG export ──────────────────────────────────────────────────────

function makeInputs(partial: Partial<CompositionSVGInputs>): CompositionSVGInputs {
  return {
    name: 'BendArc',
    figures: [],
    svgObjects: [],
    images: [],
    imageBlobs: {},
    strokeScale: 0.04,
    loadFigure: async () => null,
    ...partial,
  };
}

describe('SVG export of bent text', () => {
  test("a bent line rides a <textPath> along the block's arc for it", async () => {
    const text = makeText({ style: style({ bend: 0.5 }) });
    const svg = await generateCompositionSVGCore(
      makeInputs({ texts: [text], sceneOrder: ['txt_1'] }),
    );
    expect(svg).toContain('<path id="tba_txt_1_0" d="M ');
    expect(svg).toContain('<textPath href="#tba_txt_1_0">hello</textPath>');
    // Bent lines carry no x/y of their own — the path places them.
    expect(svg).not.toMatch(/<text x="[^"]*"[^>]*>hello/);
  });

  test('flat text (bend absent or 0) keeps the plain <text x y> line', async () => {
    for (const s of [style(), style({ bend: 0 })]) {
      const svg = await generateCompositionSVGCore(
        makeInputs({ texts: [makeText({ style: s })], sceneOrder: ['txt_1'] }),
      );
      expect(svg).toMatch(/<text x="[^"]*" y="[^"]*"[^>]*>hello<\/text>/);
      expect(svg).not.toContain('textPath');
    }
  });

  test('each wrapped line gets its own arc, ids indexed by line', async () => {
    // cellWidth 4 wraps 'hi hi hi' (see textLayout tests) into three lines.
    const text = makeText({
      content: 'hi hi hi',
      cellWidth: 4,
      style: style({ bend: -0.3 }),
    });
    const svg = await generateCompositionSVGCore(
      makeInputs({ texts: [text], sceneOrder: ['txt_1'] }),
    );
    expect(svg).toContain('id="tba_txt_1_0"');
    expect(svg).toContain('id="tba_txt_1_1"');
    expect(svg).toContain('id="tba_txt_1_2"');
    // Downward bend: every arc sweeps counterclockwise on screen.
    expect(svg).not.toMatch(/A [^"]* 0 0 1 /);
  });
});

// ── Binary round-trip (v57) ─────────────────────────────────────────

function makeBundle(texts: TextObject[]): CompositionBundle {
  return {
    name: 'BendArc Comp',
    figures: [],
    svgObjects: [],
    images: [],
    texts,
    groups: [],
    sceneOrder: texts.map((t) => t.id),
    gridLevel: 1,
    strokeScale: 1,
    gridIntensity: 1,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
  };
}

function roundTrip(bundle: CompositionBundle) {
  return deserializeComposition(serializeComposition(bundle, []));
}

describe('a content-framed export contains the bow', () => {
  // The journal's page raster frames on the ink (frameInkExtents), and the
  // bow is glyphs hanging outside the text's box: framed on the box alone
  // it was cut off at the flat baseline's edge.
  const viewBoxOf = (svg: string | null): number[] =>
    /viewBox="([^"]+)"/.exec(svg!)![1].split(' ').map(Number);

  const exportFramed = (bend: number) => generateCompositionSVGCore(
    makeInputs({
      texts: [makeText({ style: style({ bend }) })],
      sceneOrder: ['txt_1'],
      frameInkExtents: true,
    }),
  );

  test('the frame grows by the bow, above and below, and a flat block’s frame is untouched', async () => {
    const [flatX, flatY, flatW, flatH] = viewBoxOf(await exportFramed(0));
    const [bentX, bentY, bentW, bentH] = viewBoxOf(await exportFramed(0.5));
    // The rise for the full box width — what the bow reaches (textBendRise).
    const rise = textArcGeometry(8, 0.5).rise;
    expect(rise).toBeGreaterThan(0);
    // Outset on every side (the bow leaves the box on the bend's side; the
    // frame errs outward rather than guessing which).
    const u = (bentW - flatW) / 2;
    expect(u).toBeGreaterThan(0);
    expect(bentH - flatH).toBeCloseTo(bentW - flatW, 6);
    expect(flatX - bentX).toBeCloseTo(u, 6);
    expect(flatY - bentY).toBeCloseTo(u, 6);
  });

  test('a bend of 0 frames exactly as an unbent block does — no frame moves that did not have to', async () => {
    const zero = viewBoxOf(await exportFramed(0));
    const absent = viewBoxOf(await generateCompositionSVGCore(makeInputs({
      texts: [makeText()], sceneOrder: ['txt_1'], frameInkExtents: true,
    })));
    expect(zero).toEqual(absent);
  });

  test('a negative bend bows the other way and frames just as wide', async () => {
    const up = viewBoxOf(await exportFramed(0.5));
    const down = viewBoxOf(await exportFramed(-0.5));
    expect(down[2]).toBeCloseTo(up[2], 6);
    expect(down[3]).toBeCloseTo(up[3], 6);
  });
});

describe('bend binary round-trip (v57)', () => {
  test('bend survives the file, both signs', () => {
    for (const bend of [0.75, -0.4]) {
      const rt = roundTrip(makeBundle([makeText({ style: style({ bend }) })]));
      expect(rt.meta.texts?.[0].style.bend).toBeCloseTo(bend, 5);
    }
  });

  test('absent bend stays absent', () => {
    const rt = roundTrip(makeBundle([makeText()]));
    expect(rt.meta.texts?.[0].style.bend).toBeUndefined();
  });

  test('rides after every other trailing text payload without desyncing', () => {
    // The extension byte is LAST, after char colors, vAlign and alpha — a
    // miswrite would shear every record after it out of register.
    const texts = [
      makeText({
        id: 'a',
        angleDeg: -7.25,
        style: style({
          vAlign: 'middle', alpha: 0.5, bend: 0.6,
          letterSpacing: 0.05, lineHeight: 1.4, weight: 'semibold',
          charColors: [{ r: 9, g: 8, b: 7 }],
        }),
      }),
      makeText({ id: 'b' }),
      makeText({ id: 'c', style: style({ bend: -1 }) }),
    ];
    const out = roundTrip(makeBundle(texts)).meta.texts ?? [];
    expect(out.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(out[0].style.bend).toBeCloseTo(0.6, 5);
    expect(out[0].style.vAlign).toBe('middle');
    expect(out[0].style.alpha).toBeCloseTo(0.5, 2);
    expect(out[0].style.weight).toBe('semibold');
    expect(out[0].style.charColors?.[0]).toEqual({ r: 9, g: 8, b: 7 });
    expect(out[0].angleDeg).toBeCloseTo(-7.25, 2);
    expect(out[1].style.bend).toBeUndefined();
    expect(out[2].style.bend).toBeCloseTo(-1, 5);
  });
});
