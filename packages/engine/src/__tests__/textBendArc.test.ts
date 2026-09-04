/**
 * Arc-bent text (`TextStyle.bend`, the Type bar's Bend slider): the shared
 * arc geometry, the SVG export's <textPath> lines, and the v57 binary
 * payload (the text extension byte).
 */

import { textArcGeometry, textArcPath, textBend } from '../textArc';
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

describe('textArcPath', () => {
  test('positive bend arcs over the top (sweep flag 1), symmetric about the line center', () => {
    const d = textArcPath(2, 5, 10, 0.5);
    const m = /^M (\S+) (\S+) A (\S+) (\S+) 0 0 (\d) (\S+) (\S+)$/.exec(d)!;
    expect(m).toBeTruthy();
    const [, x0, y0, r1, r2, sweepFlag, x1, y1] = m;
    expect(Number(y0)).toBe(5);
    expect(Number(y1)).toBe(5);
    expect(Number(r1)).toBe(Number(r2));
    expect(sweepFlag).toBe('1');
    // Endpoints straddle the line's center (x 2 + 10/2 = 7) symmetrically.
    expect(Number(x0) + Number(x1)).toBeCloseTo(14, 10);
    expect(Number(x0)).toBeLessThan(7);
  });

  test('negative bend arcs under the bottom (sweep flag 0)', () => {
    const d = textArcPath(0, 0, 10, -0.5);
    expect(d).toMatch(/A \S+ \S+ 0 0 0 /);
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
  test('a bent line rides a <textPath> along its per-line arc path', async () => {
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
