/**
 * Cutout export (`CompositionSVGInputs.subset`): draw only the selected
 * objects, framed tightly on them, on a transparent canvas.
 *
 * Drives the pure `generateCompositionSVGCore` for the same reasons
 * compositionExportV29.test.ts does — it is the single path both storage-backed
 * wrappers use, and it needs no storage or canvas mocks.
 */
import { generateCompositionSVGCore, type CompositionSVGInputs } from '../compositionSVGCore';
import { DEFAULT_LINE_HEIGHT, layoutText } from '../textLayout';
import { STICKER_SHADOW_CELLS } from '../stickerStyle';
import { GroupNode, ImageObject, PathSegment, SVGObject, TextObject } from '../types';

/** SVG_UNITS_PER_L0_CELL — world cells scale into SVG units by this. */
const U = 256;

/** Horizontal slack the exporter keeps per line, as a fraction of its measured
 *  width, to cover the gap between the deterministic measurer and the real
 *  font. Mirrors MEASURER_SLACK in compositionSVGCore. */
const SLACK = 0.04;

/**
 * The world box a text node's GLYPHS occupy — what a cutout frames on, as
 * opposed to the (usually much roomier) node bbox. Derived from the same
 * `layoutText` the exporter uses rather than hard-coded numbers, so these
 * assertions state the rule instead of restating the font metrics.
 * Unrotated nodes only; the tilt tests do their own geometry.
 */
function inkBox(t: TextObject): { minX: number; minY: number; maxX: number; maxY: number } {
  const layout = layoutText(t.content, t.style, { maxWidth: t.cellWidth, maxHeight: t.cellHeight });
  const lineHeight = t.style.size * (t.style.lineHeight ?? DEFAULT_LINE_HEIGHT);
  const drawn = layout.lines.filter((l) => l.text.length > 0);
  return {
    minX: t.cellX + Math.min(...drawn.map((l) => l.x - l.width * SLACK)),
    minY: t.cellY + Math.min(...drawn.map((l) => l.y)),
    maxX: t.cellX + Math.max(...drawn.map((l) => l.x + l.width * (1 + SLACK))),
    maxY: t.cellY + Math.max(...drawn.map((l) => l.y + lineHeight)),
  };
}

/** The viewBox that framing tightly on `texts`' glyphs should produce. */
function inkViewBox(texts: TextObject[]): number[] {
  const boxes = texts.map(inkBox);
  const minX = Math.min(...boxes.map((b) => b.minX));
  const minY = Math.min(...boxes.map((b) => b.minY));
  const maxX = Math.max(...boxes.map((b) => b.maxX));
  const maxY = Math.max(...boxes.map((b) => b.maxY));
  return [minX * U, minY * U, (maxX - minX) * U, (maxY - minY) * U];
}

const closedSquare: PathSegment[] = [
  { kind: 'line', start: [0, 0], end: [32, 0] },
  { kind: 'line', start: [32, 0], end: [32, 32] },
  { kind: 'line', start: [32, 32], end: [0, 32] },
  { kind: 'line', start: [0, 32], end: [0, 0] },
];

function makeInputs(partial: Partial<CompositionSVGInputs>): CompositionSVGInputs {
  return {
    name: 'Subset',
    figures: [],
    svgObjects: [],
    images: [],
    imageBlobs: {},
    strokeScale: 0.04,
    loadFigure: async () => null,
    ...partial,
  };
}

function makeText(overrides: Partial<TextObject> & { id: string }): TextObject {
  return {
    content: 'word',
    style: { fontId: 'CozySans', size: 2, color: { r: 10, g: 20, b: 30 } },
    cellX: 4, cellY: 5, cellWidth: 6, cellHeight: 3,
    ...overrides,
  };
}

function makeImage(overrides: Partial<ImageObject> & { id: string }): ImageObject {
  return {
    imageId: 'blob1',
    mimeType: 'image/png',
    pixelWidth: 4, pixelHeight: 4,
    cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32,
    ...overrides,
  };
}

/** The page: a full-bleed image with two text lines over it. */
function pageInputs(extra: Partial<CompositionSVGInputs> = {}): CompositionSVGInputs {
  return makeInputs({
    images: [makeImage({ id: 'img_photo' })],
    texts: [
      makeText({ id: 'txt_1', content: 'first', cellX: 4, cellY: 20, cellWidth: 8, cellHeight: 2 }),
      makeText({ id: 'txt_2', content: 'second', cellX: 4, cellY: 24, cellWidth: 10, cellHeight: 2 }),
    ],
    imageBlobs: { blob1: new Uint8Array([1, 2, 3]) },
    sceneOrder: ['img_photo', 'txt_1', 'txt_2'],
    ...extra,
  });
}

function viewBoxOf(svg: string): number[] {
  const m = svg.match(/viewBox="([^"]*)"/);
  if (!m) throw new Error('no viewBox');
  return m[1].split(' ').map(Number);
}

describe('subset (cutout) export', () => {
  it('draws only the selected nodes', async () => {
    const svg = await generateCompositionSVGCore(
      pageInputs({ subset: () => new Set(['txt_1', 'txt_2']) }),
    );
    expect(svg).toBeTruthy();
    // The photo is gone; both text lines survive.
    expect(svg).not.toContain('<image');
    expect(svg).toContain('>first<');
    expect(svg).toContain('>second<');
  });

  it('frames the viewBox tightly on the selection, not the page', async () => {
    const full = await generateCompositionSVGCore(pageInputs());
    const cut = await generateCompositionSVGCore(
      pageInputs({ subset: () => new Set(['txt_1', 'txt_2']) }),
    );
    // Full page = the 32×32 photo.
    expect(viewBoxOf(full!)).toEqual([0, 0, 32 * U, 32 * U]);
    // Cutout = the two lines' glyphs.
    expect(viewBoxOf(cut!)).toEqual(inkViewBox(pageInputs().texts!));
  });

  it('ignores frame bounds so a framed page still zooms in', async () => {
    // A Figma-style frame pins the FULL export to the frame rect; a cutout
    // must not inherit that, or it would be page-sized again.
    const boundary: SVGObject = {
      id: 'svg_frame',
      segments: closedSquare,
      color: { r: 0, g: 0, b: 0 },
      cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32,
      isMask: true,
      groupId: 'grp_frame',
    } as SVGObject;
    const groups: GroupNode[] = [{
      id: 'grp_frame', name: 'Frame', isFrame: true,
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    }];
    const framedTexts = [
      makeText({ id: 'txt_1', content: 'first', cellX: 4, cellY: 20, cellWidth: 8, cellHeight: 2, groupId: 'grp_frame' }),
      makeText({ id: 'txt_2', content: 'second', cellX: 4, cellY: 24, cellWidth: 10, cellHeight: 2, groupId: 'grp_frame' }),
    ];
    const inputs = pageInputs({
      svgObjects: [boundary],
      texts: framedTexts,
      groups,
      sceneOrder: ['svg_frame', 'img_photo', 'txt_1', 'txt_2'],
    });
    const full = await generateCompositionSVGCore(inputs);
    expect(viewBoxOf(full!)).toEqual([0, 0, 32 * U, 32 * U]);

    const cut = await generateCompositionSVGCore({
      ...inputs,
      subset: () => new Set(['txt_1', 'txt_2']),
    });
    expect(viewBoxOf(cut!)).toEqual(inkViewBox(framedTexts));
  });

  it('omits the canvas background so the cutout is transparent', async () => {
    const background = { kind: 'solid' as const, color: { r: 244, g: 243, b: 241 } };
    const full = await generateCompositionSVGCore(pageInputs({ background }));
    expect(full).toContain('#F4F3F1');

    const cut = await generateCompositionSVGCore(
      pageInputs({ background, subset: () => new Set(['txt_1']) }),
    );
    expect(cut).not.toContain('#F4F3F1');
  });

  it('sees the visible scene, so a selector can pick by node data', async () => {
    // What the magnetic-poetry recipe does: keep only the word stickers.
    const inputs = makeInputs({
      texts: [
        makeText({ id: 'txt_plain', cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 2 }),
        makeText({ id: 'txt_stick', sticker: true, cellX: 10, cellY: 10, cellWidth: 4, cellHeight: 2 }),
      ],
      sceneOrder: ['txt_plain', 'txt_stick'],
    });
    const seen: string[] = [];
    const svg = await generateCompositionSVGCore({
      ...inputs,
      subset: (scene) => {
        seen.push(...scene.texts.map((t) => t.id));
        return new Set(scene.texts.filter((t) => t.sticker).map((t) => t.id));
      },
    });
    expect(seen).toEqual(['txt_plain', 'txt_stick']);
    // A sticker's card fills its bbox, so the bbox IS its paint — framed on
    // that, plus room for the card's drop shadow.
    const pad = Math.max(STICKER_SHADOW_CELLS.dx, STICKER_SHADOW_CELLS.dy) + STICKER_SHADOW_CELLS.blur;
    expect(viewBoxOf(svg!)).toEqual([
      (10 - pad) * U, (10 - pad) * U, (4 + 2 * pad) * U, (2 + 2 * pad) * U,
    ]);
  });

  it('never sees a hidden node, and returns null when nothing is selected', async () => {
    const inputs = makeInputs({
      texts: [
        makeText({ id: 'txt_shown', cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 2 }),
        makeText({ id: 'txt_hidden', hidden: true, cellX: 9, cellY: 9, cellWidth: 4, cellHeight: 2 }),
      ],
    });
    const offered: string[] = [];
    await generateCompositionSVGCore({
      ...inputs,
      subset: (scene) => {
        offered.push(...scene.texts.map((t) => t.id));
        return new Set(scene.texts.map((t) => t.id));
      },
    });
    expect(offered).toEqual(['txt_shown']);

    // An empty selection is an empty scene: null, not a degenerate document.
    const empty = await generateCompositionSVGCore({ ...inputs, subset: () => new Set() });
    expect(empty).toBeNull();
  });
});

describe('textColorOverride', () => {
  const WHITE = { r: 255, g: 255, b: 255 };

  it('repaints every glyph, whatever the node was authored in', async () => {
    const svg = await generateCompositionSVGCore(makeInputs({
      texts: [
        makeText({ id: 'txt_1', content: 'first', style: { fontId: 'CozySans', size: 2, color: { r: 10, g: 20, b: 30 } } }),
        makeText({ id: 'txt_2', content: 'second', cellY: 10, style: { fontId: 'CozySans', size: 2, color: { r: 200, g: 40, b: 40 } } }),
      ],
      textColorOverride: WHITE,
    }));
    expect(svg).not.toContain('rgb(10,20,30)');
    expect(svg).not.toContain('rgb(200,40,40)');
    expect(svg!.match(/fill="rgb\(255,255,255\)"/g)).toHaveLength(2);
  });

  it('drops the authored outline with the color', async () => {
    // A dark outline around forced-white glyphs would put back exactly the
    // contrast the override is there to remove.
    const outlined = makeText({
      id: 'txt_1',
      style: {
        fontId: 'CozySans', size: 2, color: { r: 10, g: 20, b: 30 },
        stroke: { width: 0.05, color: { r: 0, g: 0, b: 0 } },
      },
    });
    const kept = await generateCompositionSVGCore(makeInputs({ texts: [outlined] }));
    expect(kept).toContain('stroke="rgb(0,0,0)"');

    const overridden = await generateCompositionSVGCore(
      makeInputs({ texts: [outlined], textColorOverride: WHITE }),
    );
    expect(overridden).not.toContain('stroke="rgb(0,0,0)"');
    expect(overridden).toContain('stroke="none"');
  });

  it('leaves a sticker alone — its ink is half its card', async () => {
    // stickerColors pairs the ink with the card (it also strokes the border),
    // so recoloring one of the two would be white type on a white card.
    const magnet = makeText({ id: 'txt_1', sticker: true });
    const plain = await generateCompositionSVGCore(makeInputs({ texts: [magnet] }));
    const overridden = await generateCompositionSVGCore(
      makeInputs({ texts: [magnet], textColorOverride: WHITE }),
    );
    expect(overridden).toEqual(plain);
  });

  it('changes paint only — the frame is where it was', async () => {
    const line = makeText({ id: 'txt_1', content: 'wren', cellWidth: 28, cellHeight: 3.5 });
    const plain = await generateCompositionSVGCore(
      makeInputs({ texts: [line], subset: () => new Set(['txt_1']) }),
    );
    const white = await generateCompositionSVGCore(makeInputs({
      texts: [line], subset: () => new Set(['txt_1']), textColorOverride: WHITE,
    }));
    expect(viewBoxOf(white!)).toEqual(viewBoxOf(plain!));
  });
});

describe('subset text framing', () => {
  const all = (scene: { texts: readonly TextObject[] }) => new Set(scene.texts.map((t) => t.id));

  async function cutout(texts: TextObject[]): Promise<string> {
    const svg = await generateCompositionSVGCore(makeInputs({ texts, subset: all }));
    expect(svg).toBeTruthy();
    return svg!;
  }

  it('frames the glyphs, not the roomy box they lay out in', async () => {
    // The haiku case: a 28-cell-wide slot holding a short line. Framing the
    // bbox would wrap the words in the empty space the slot reserved.
    const line = makeText({ id: 'txt_1', content: 'wren', cellX: 2, cellY: 5, cellWidth: 28, cellHeight: 3.5 });
    const [x, y, w, h] = viewBoxOf(await cutout([line]));
    expect([x, y, w, h]).toEqual(inkViewBox([line]));
    // Concretely: far narrower and shorter than the 28 × 3.5 slot.
    expect(w).toBeLessThan(28 * U / 2);
    expect(h).toBeLessThan(3.5 * U);
  });

  it('ignores blank lines, which are never drawn', async () => {
    const padded = makeText({
      id: 'txt_1', content: '\n\nlow\n\n', cellX: 0, cellY: 0, cellWidth: 20, cellHeight: 12,
    });
    const solo = makeText({
      id: 'txt_1', content: 'low', cellX: 0, cellY: 0, cellWidth: 20, cellHeight: 12,
    });
    // Two leading blank lines shift the word down but must not pad the frame
    // above it, and the trailing blanks must not pad below.
    const [, , w, h] = viewBoxOf(await cutout([padded]));
    const [, , soloW, soloH] = viewBoxOf(await cutout([solo]));
    expect(w).toBeCloseTo(soloW, 5);
    expect(h).toBeCloseTo(soloH, 5);
  });

  it('honors alignment — a centered line is framed where it is drawn', async () => {
    const centered = makeText({
      id: 'txt_1', content: 'hi', cellX: 0, cellY: 0, cellWidth: 20, cellHeight: 4,
      style: { fontId: 'CozySans', size: 2, color: { r: 0, g: 0, b: 0 }, align: 'center' },
    });
    const [x, , w] = viewBoxOf(await cutout([centered]));
    // Inset from the left edge by the centering slack, not sitting at x = 0.
    expect(x).toBeGreaterThan(0);
    // And still centered in the box it came from.
    expect(x + w / 2).toBeCloseTo(10 * U, 5);
  });

  it('keeps a tilted sticker’s corners inside the frame', async () => {
    // A magnet is scattered with a tilt; the frame is computed on the rotated
    // card, so no corner is cropped.
    const tilted = makeText({
      id: 'txt_1', content: 'soft', sticker: true, angleDeg: 15,
      cellX: 10, cellY: 10, cellWidth: 4, cellHeight: 2,
    });
    const [x, y, w, h] = viewBoxOf(await cutout([tilted]));
    // The rotated AABB of a 4×2 card at 15° is wider and taller than the card.
    const rad = (15 * Math.PI) / 180;
    const aabbW = 4 * Math.abs(Math.cos(rad)) + 2 * Math.abs(Math.sin(rad));
    const aabbH = 4 * Math.abs(Math.sin(rad)) + 2 * Math.abs(Math.cos(rad));
    const pad = Math.max(STICKER_SHADOW_CELLS.dx, STICKER_SHADOW_CELLS.dy) + STICKER_SHADOW_CELLS.blur;
    expect(w / U).toBeCloseTo(aabbW + 2 * pad, 5);
    expect(h / U).toBeCloseTo(aabbH + 2 * pad, 5);
    // Centered on the card's centre, which rotation leaves fixed.
    expect((x + w / 2) / U).toBeCloseTo(12, 5);
    expect((y + h / 2) / U).toBeCloseTo(11, 5);
  });

  it('keeps slack for the gap between the measurer and the real font', async () => {
    // Line widths are approximated; the browser draws the real face. The frame
    // allows for that drift proportionally — the error accumulates per
    // character — so a long line gets more room than a short one and neither
    // loses its last glyph off the viewBox edge.
    const at = (content: string) =>
      makeText({ id: 'txt_1', content, cellX: 0, cellY: 0, cellWidth: 40, cellHeight: 4 });
    const slackOf = async (content: string) => {
      const [, , w] = viewBoxOf(await cutout([at(content)]));
      const measured = layoutText(content, at(content).style, { maxWidth: 40, maxHeight: 4 })
        .lines[0].width * U;
      return w - measured;
    };
    const short = await slackOf('an');
    const long = await slackOf('a much longer line of text');
    expect(short).toBeGreaterThan(0);
    expect(long).toBeGreaterThan(short);
  });

  it('leaves the page export framed on node bboxes', async () => {
    // Tightening text is a cutout rule only: every existing freeform page
    // export must keep the frame it has.
    const line = makeText({ id: 'txt_1', content: 'wren', cellX: 2, cellY: 5, cellWidth: 28, cellHeight: 3.5 });
    const page = await generateCompositionSVGCore(makeInputs({ texts: [line] }));
    expect(viewBoxOf(page!)).toEqual([2 * U, 5 * U, 28 * U, 3.5 * U]);
  });
});

/** A stroked path. `strokeScale` 0.04 renders 5 × (0.04 × 200) = 40 SVG units
 *  of width, i.e. 40/256 cells, unless the object carries its own. */
function makePath(overrides: Partial<SVGObject> & { id: string }): SVGObject {
  return {
    color: { r: 0, g: 0, b: 0 },
    segments: [{ kind: 'line', start: [4, 4], end: [12, 4] }],
    cellX: 4, cellY: 4, cellWidth: 8, cellHeight: 0,
    ...overrides,
  };
}

describe('cutout stroke padding', () => {
  const strokeWidthOf = (svg: string) => Number(svg.match(/stroke-width="([^"]*)"/)![1]);

  const cutPaths = async (svgObjects: SVGObject[], strokeScale?: number) => {
    const svg = await generateCompositionSVGCore(makeInputs({
      svgObjects,
      ...(strokeScale === undefined ? {} : { strokeScale }),
      subset: () => new Set(svgObjects.map((s) => s.id)),
    }));
    return { box: viewBoxOf(svg!), width: strokeWidthOf(svg!) };
  };

  it('grows the frame by the stroke half-width so no stroke is sliced', async () => {
    // The path runs along y = 4 — the top AND bottom of its geometric bbox, so
    // a tight frame would cut it down its length, showing half a line.
    const { box, width } = await cutPaths([makePath({ id: 'svg_1' })]);
    const half = width / 2;
    expect(box).toEqual([4 * U - half, 4 * U - half, 8 * U + 2 * half, 2 * half]);
  });

  it('pads by the width the strokes are actually drawn at', async () => {
    const thin = await cutPaths([makePath({ id: 'svg_1' })], 0.01);
    const fat = await cutPaths([makePath({ id: 'svg_1' })], 0.16);
    expect(fat.width).toBeGreaterThan(thin.width);
    expect(fat.box[2] - thin.box[2]).toBeCloseTo(fat.width - thin.width, 5);
  });

  it('uses each object’s own width when it has one', async () => {
    // A path that visited the Stroke bar keeps its authored width, so the
    // composition-wide value must not decide its padding.
    const own = makePath({ id: 'svg_1', stroke: { width: 2 } });
    const { box } = await cutPaths([own], 0.01);
    expect(box[0]).toBeCloseTo(4 * U - (2 * U) / 2, 5);
  });

  it('leaves a page export on the geometric bounds', async () => {
    // Same rule as the text tightening: cutout only, or every existing
    // freeform page export's frame would move. Diagonal so neither axis hits
    // the degenerate-frame guard and the bounds are the segment's own.
    const diagonal = makePath({
      id: 'svg_1',
      segments: [{ kind: 'line', start: [4, 4], end: [12, 10] }],
      cellHeight: 6,
    });
    const svg = await generateCompositionSVGCore(makeInputs({ svgObjects: [diagonal] }));
    expect(viewBoxOf(svg!)).toEqual([4 * U, 4 * U, 8 * U, 6 * U]);
  });
});
