/**
 * Per-character text colors (`TextStyle.charColors`, the color tool's brush
 * on text): the layout-side plumbing every consumer shares — line `start`
 * indices, per-char boxes, same-color runs — plus the v47 binary payload and
 * the SVG export's tspan splitting.
 */

import {
  charColorRuns,
  layoutText,
  lineCharBoxes,
} from '../textLayout';
import {
  CompositionBundle,
  deserializeComposition,
  serializeComposition,
} from '../compositionBinaryFormat';
import { generateCompositionSVGCore, type CompositionSVGInputs } from '../compositionSVGCore';
import { RGBColor, TextObject, TextStyle } from '../types';

const RED: RGBColor = { r: 255, g: 0, b: 0 };
const BLUE: RGBColor = { r: 0, g: 0, b: 255 };

const style = (extras: Partial<TextStyle> = {}): TextStyle => ({
  fontId: 'system', size: 2, color: { r: 10, g: 20, b: 30 }, ...extras,
});

describe('TextLayoutLine.start', () => {
  test('explicit newlines: each line starts one past the previous line + its \\n', () => {
    const layout = layoutText('ab\nc\n\nd', style());
    expect(layout.lines.map((l) => [l.text, l.start])).toEqual([
      ['ab', 0], ['c', 3], ['', 5], ['d', 6],
    ]);
  });

  test('word wrap consumes exactly one breaking space per break', () => {
    // 'hi hi hi' at size 2: each 'hi' is 1.9 wide, so maxWidth 4 fits two
    // words (1.9 + 0.66 + 1.9 = 4.46 > 4 → break after the first).
    const layout = layoutText('hi hi hi', style(), { maxWidth: 4 });
    expect(layout.lines.map((l) => [l.text, l.start])).toEqual([
      ['hi', 0], ['hi', 3], ['hi', 6],
    ]);
  });

  test('starts count code points, not UTF-16 units', () => {
    const layout = layoutText('a😀\nb', style());
    expect(layout.lines.map((l) => l.start)).toEqual([0, 3]);
  });
});

describe('lineCharBoxes', () => {
  test('offsets accumulate advances plus letter spacing per gap', () => {
    // Default measurer: 'h' 0.6em, 'i' 0.35em; size 2, spacing 0.1em.
    const boxes = lineCharBoxes('hi', style({ letterSpacing: 0.1 }));
    expect(boxes).toEqual([
      { x: 0, width: 1.2 },
      { x: 1.4, width: 0.7 },
    ]);
  });
});

describe('charColorRuns', () => {
  test('splits a line into inherit/override runs by content index', () => {
    // content 'ab cd', line 'cd' starting at index 3, 'c' painted red.
    const charColors: (RGBColor | null)[] = [null, null, null, RED, null];
    expect(charColorRuns('cd', 3, charColors)).toEqual([
      { text: 'c', color: RED },
      { text: 'd', color: null },
    ]);
  });

  test('merges consecutive same-color characters into one run', () => {
    expect(charColorRuns('abcd', 0, [RED, RED, BLUE, null])).toEqual([
      { text: 'ab', color: RED },
      { text: 'c', color: BLUE },
      { text: 'd', color: null },
    ]);
  });

  test('no overrides → a single inherit run; empty text → no runs', () => {
    expect(charColorRuns('abc', 0, undefined)).toEqual([{ text: 'abc', color: null }]);
    expect(charColorRuns('', 0, [RED])).toEqual([]);
  });
});

// ── Binary round-trip (v47) ─────────────────────────────────────────

function makeBundle(texts: TextObject[]): CompositionBundle {
  return {
    name: 'CharColors Comp',
    gridLevel: 1,
    strokeScale: 0.5,
    gridIntensity: 0.3,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    figures: [],
    texts,
  };
}

function makeText(overrides: Partial<TextObject> = {}): TextObject {
  return {
    id: 'txt_1',
    content: 'hello',
    style: style(),
    cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 3,
    ...overrides,
  };
}

function roundTrip(bundle: CompositionBundle) {
  return deserializeComposition(serializeComposition(bundle, []));
}

describe('charColors binary round-trip (v47)', () => {
  test('sparse overrides round-trip as a dense null-filled array', () => {
    const rt = roundTrip(makeBundle([makeText({
      style: style({ charColors: [null, RED, null, BLUE] }),
    })]));
    expect(rt.meta.texts?.[0].style.charColors).toEqual([null, RED, null, BLUE]);
  });

  test('absent charColors stays absent, and an all-null array is dropped', () => {
    const plain = roundTrip(makeBundle([makeText()]));
    expect(plain.meta.texts?.[0].style.charColors).toBeUndefined();
    const allNull = roundTrip(makeBundle([makeText({
      style: style({ charColors: [null, null] }),
    })]));
    expect(allNull.meta.texts?.[0].style.charColors).toBeUndefined();
  });

  test('coexists with the other flags2-gated payloads', () => {
    const rt = roundTrip(makeBundle([makeText({
      fixedSize: true,
      angleDeg: 33.5,
      style: style({ charColors: [RED] }),
    })]));
    const t = rt.meta.texts?.[0];
    expect(t?.fixedSize).toBe(true);
    expect(t?.angleDeg).toBeCloseTo(33.5, 1);
    expect(t?.style.charColors).toEqual([RED]);
  });
});

// ── SVG export ──────────────────────────────────────────────────────

function makeInputs(partial: Partial<CompositionSVGInputs>): CompositionSVGInputs {
  return {
    name: 'CharColors',
    figures: [],
    svgObjects: [],
    images: [],
    imageBlobs: {},
    strokeScale: 0.04,
    loadFigure: async () => null,
    ...partial,
  };
}

describe('SVG export of charColors', () => {
  test('splits a painted line into fill-carrying tspans', async () => {
    const text = makeText({ style: style({ charColors: [RED, RED, null, null, BLUE] }) });
    const svg = await generateCompositionSVGCore(
      makeInputs({ texts: [text], sceneOrder: ['txt_1'] }),
    );
    expect(svg).toContain(
      '<tspan fill="rgb(255,0,0)">he</tspan><tspan>ll</tspan><tspan fill="rgb(0,0,255)">o</tspan>',
    );
  });

  test('a textColorOverride flattens the brushwork to one color', async () => {
    const text = makeText({ style: style({ charColors: [RED] }) });
    const svg = await generateCompositionSVGCore(makeInputs({
      texts: [text],
      sceneOrder: ['txt_1'],
      textColorOverride: { r: 250, g: 250, b: 250 },
    }));
    expect(svg).not.toContain('<tspan');
    expect(svg).toContain('>hello<');
  });
});
