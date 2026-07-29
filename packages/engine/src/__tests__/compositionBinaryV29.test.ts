import {
  serializeComposition,
  deserializeComposition,
  CompositionBundle,
} from '../compositionBinaryFormat';
import { normalizeComposition } from '../compositionNormalize';
import {
  CompositionFigure,
  ImageObject,
  ImageTintMode,
  NodeEffects,
  Paint,
  SVGObject,
  TextObject,
} from '../types';
import { computeSVGBbox } from '../compositionOps';

// v29 quantization contract (documented in the format header):
//   - gradient stop offsets, paint/stop/effect alphas, and tint amount are
//     u8-quantized, so they round-trip within 1/255;
//   - text bboxes use the shared i16 quarter-cell fixed point, so they
//     round-trip within 0.25 L0 (encodeFixed rounds, so error <= 0.125).
const U8_TOL = 1 / 255;
const BBOX_TOL = 0.25;

function sb(svg: Omit<SVGObject, 'cellX' | 'cellY' | 'cellWidth' | 'cellHeight'>): SVGObject {
  return { ...svg, ...computeSVGBbox(svg.segments) };
}

function makeFigure(overrides: Partial<CompositionFigure> & { id: string; figureKey: string }): CompositionFigure {
  return {
    cellX: 0,
    cellY: 0,
    resolutionX: 2,
    resolutionY: 2,
    cellWidth: 4,
    cellHeight: 4,
    ...overrides,
  };
}

function makeBundle(overrides?: Partial<CompositionBundle>): CompositionBundle {
  return {
    name: 'V29 Comp',
    gridLevel: 1,
    strokeScale: 0.5,
    gridIntensity: 0.3,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    figures: [],
    ...overrides,
  };
}

function makeText(overrides: Partial<TextObject> & { id: string; content: string }): TextObject {
  return {
    style: { fontId: 'CozySans', size: 2, color: { r: 10, g: 20, b: 30 } },
    cellX: 2, cellY: 3, cellWidth: 10, cellHeight: 4,
    ...overrides,
  };
}

function makeImage(overrides: Partial<ImageObject> & { id: string }): ImageObject {
  return {
    imageId: 'blob1',
    mimeType: 'image/png',
    pixelWidth: 4, pixelHeight: 4,
    cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 8,
    ...overrides,
  };
}

function roundTrip(bundle: CompositionBundle) {
  return deserializeComposition(serializeComposition(bundle, []));
}

const closedSquare: SVGObject['segments'] = [
  { kind: 'line', start: [0, 0], end: [8, 0] },
  { kind: 'line', start: [8, 0], end: [8, 8] },
  { kind: 'line', start: [8, 8], end: [0, 8] },
  { kind: 'line', start: [0, 8], end: [0, 0] },
];

describe('compositionBinaryFormat v29', () => {
  // ── Full round-trip ────────────────────────────────────────────────

  test('full round-trip: texts, gradient fillPaints, effects, tint, background, groups, sceneOrder', () => {
    const stickerText = makeText({
      id: 'txt_sticker',
      content: 'dream',
      name: 'Word Sticker',
      sticker: true,
      groupId: 'g1',
      preGroupName: 'Sticker 1',
      rotation: 90,
      mirrorH: true,
      locked: true,
      hidden: true,
      cellX: 2.25, cellY: -3.5, cellWidth: 6.75, cellHeight: 2.5,
      localCellX: 1, localCellY: 2, localCellWidth: 3, localCellHeight: 4,
      identityCellX: 0.25, identityCellY: 0.5, identityCellWidth: 6.75, identityCellHeight: 2.5,
      style: {
        fontId: 'CozySerif',
        size: 1.5,
        bold: true,
        italic: true,
        color: { r: 250, g: 240, b: 230 },
        letterSpacing: 0.05,
        lineHeight: 1.4,
        align: 'center',
        stroke: { width: 0.125, color: { r: 40, g: 30, b: 20 } },
      },
      effects: {
        shadow: { dx: 0.5, dy: -0.25, blur: 2, color: { r: 0, g: 0, b: 0 }, alpha: 0.6 },
        border: { width: 0.25, color: { r: 90, g: 80, b: 70 }, radius: 1.5 },
      },
    });
    const minimalText = makeText({
      id: 'txt_min',
      content: 'hi',
      cellX: 1, cellY: 1, cellWidth: 4, cellHeight: 2,
    });

    const svgLinear = sb({
      id: 'svg_linear',
      segments: closedSquare,
      color: { r: 200, g: 100, b: 50 },
      fillPaint: {
        kind: 'linear',
        stops: [
          { offset: 0, color: { r: 255, g: 0, b: 0 }, alpha: 0.5 },
          { offset: 1, color: { r: 0, g: 0, b: 255 } },
        ],
        x1: 0.1, y1: 0.2, x2: 0.9, y2: 0.8,
      },
      effects: {
        shadow: { dx: 1, dy: 2, blur: 3, color: { r: 10, g: 10, b: 10 }, alpha: 0.8 },
        border: { width: 0.5, color: { r: 1, g: 2, b: 3 } },
      },
    });
    const svgRadial = sb({
      id: 'svg_radial',
      segments: closedSquare,
      color: { r: 20, g: 30, b: 40 },
      fillPaint: {
        kind: 'radial',
        stops: [
          { offset: 0, color: { r: 255, g: 255, b: 255 } },
          { offset: 0.5, color: { r: 128, g: 128, b: 128 }, alpha: 0.25 },
          { offset: 1, color: { r: 0, g: 0, b: 0 } },
        ],
        cx: 0.5, cy: 0.5, r: 0.7,
      },
      effects: {
        glow: { radius: 3, color: { r: 255, g: 200, b: 100 }, alpha: 1 },
      },
    });

    const img = makeImage({
      id: 'img_tinted',
      tint: { color: { r: 200, g: 150, b: 100 }, amount: 0.42, mode: 'duotone' },
      effects: {
        shadow: { dx: -0.5, dy: 0.75, blur: 1.25, color: { r: 5, g: 6, b: 7 }, alpha: 0.3 },
      },
    });

    const bundle = makeBundle({
      svgObjects: [svgLinear, svgRadial],
      images: [img],
      imageBlobs: { blob1: new Uint8Array([1, 2, 3]) },
      texts: [stickerText, minimalText],
      background: { kind: 'solid', color: { r: 30, g: 20, b: 40 }, alpha: 0.75 },
      groups: [{
        id: 'g1', name: 'Group 1',
        translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
        rotation: 0, mirrorH: false, mirrorV: false,
      }],
      sceneOrder: ['img_tinted', 'svg_linear', 'txt_sticker', 'svg_radial', 'txt_min'],
    });

    const result = roundTrip(bundle);
    const meta = result.meta;

    // Texts array + ordering
    expect(meta.texts).toHaveLength(2);
    const [rt, rm] = meta.texts!;

    // Sticker text — every field
    expect(rt.id).toBe('txt_sticker');
    expect(rt.content).toBe('dream');
    expect(rt.name).toBe('Word Sticker');
    expect(rt.sticker).toBe(true);
    expect(rt.groupId).toBe('g1');
    expect(rt.preGroupName).toBe('Sticker 1');
    expect(rt.rotation).toBe(90);
    expect(rt.mirrorH).toBe(true);
    expect(rt.mirrorV).toBeUndefined();
    expect(rt.locked).toBe(true);
    expect(rt.hidden).toBe(true);
    // Quarter-cell-aligned bboxes round-trip exactly
    expect(rt.cellX).toBe(2.25);
    expect(rt.cellY).toBe(-3.5);
    expect(rt.cellWidth).toBe(6.75);
    expect(rt.cellHeight).toBe(2.5);
    expect(rt.localCellX).toBe(1);
    expect(rt.localCellY).toBe(2);
    expect(rt.localCellWidth).toBe(3);
    expect(rt.localCellHeight).toBe(4);
    expect(rt.identityCellX).toBe(0.25);
    expect(rt.identityCellY).toBe(0.5);
    expect(rt.identityCellWidth).toBe(6.75);
    expect(rt.identityCellHeight).toBe(2.5);
    // Style
    expect(rt.style.fontId).toBe('CozySerif');
    expect(rt.style.size).toBe(1.5);
    expect(rt.style.bold).toBe(true);
    expect(rt.style.italic).toBe(true);
    expect(rt.style.color).toEqual({ r: 250, g: 240, b: 230 });
    expect(rt.style.letterSpacing).toBeCloseTo(0.05, 6);
    expect(rt.style.lineHeight).toBeCloseTo(1.4, 6);
    expect(rt.style.align).toBe('center');
    expect(rt.style.stroke!.width).toBe(0.125);
    expect(rt.style.stroke!.color).toEqual({ r: 40, g: 30, b: 20 });
    // Effects
    expect(rt.effects!.shadow!.dx).toBe(0.5);
    expect(rt.effects!.shadow!.dy).toBe(-0.25);
    expect(rt.effects!.shadow!.blur).toBe(2);
    expect(rt.effects!.shadow!.color).toEqual({ r: 0, g: 0, b: 0 });
    expect(rt.effects!.shadow!.alpha).toBeCloseTo(0.6, 2);
    expect(rt.effects!.glow).toBeUndefined();
    expect(rt.effects!.border!.width).toBe(0.25);
    expect(rt.effects!.border!.color).toEqual({ r: 90, g: 80, b: 70 });
    expect(rt.effects!.border!.radius).toBe(1.5);

    // Minimal text — required fields survive, optionals stay undefined
    expect(rm.id).toBe('txt_min');
    expect(rm.content).toBe('hi');
    expect(rm.style.fontId).toBe('CozySans');
    expect(rm.style.size).toBe(2);
    expect(rm.style.color).toEqual({ r: 10, g: 20, b: 30 });
    expect(rm.cellX).toBe(1);
    expect(rm.cellWidth).toBe(4);
    expect(rm.name).toBeUndefined();
    expect(rm.sticker).toBeUndefined();
    expect(rm.groupId).toBeUndefined();
    expect(rm.preGroupName).toBeUndefined();
    expect(rm.rotation).toBeUndefined();
    expect(rm.mirrorH).toBeUndefined();
    expect(rm.mirrorV).toBeUndefined();
    expect(rm.locked).toBeUndefined();
    expect(rm.hidden).toBeUndefined();
    expect(rm.localCellX).toBeUndefined();
    expect(rm.identityCellX).toBeUndefined();
    expect(rm.style.bold).toBeUndefined();
    expect(rm.style.italic).toBeUndefined();
    expect(rm.style.align).toBeUndefined();
    expect(rm.style.letterSpacing).toBeUndefined();
    expect(rm.style.lineHeight).toBeUndefined();
    expect(rm.style.stroke).toBeUndefined();
    expect(rm.effects).toBeUndefined();

    // SVG linear fillPaint + shadow + border
    const rl = meta.svgObjects!.find(s => s.id === 'svg_linear')!;
    const rlPaint = rl.fillPaint!;
    expect(rlPaint.kind).toBe('linear');
    if (rlPaint.kind === 'linear') {
      expect(rlPaint.stops).toHaveLength(2);
      expect(rlPaint.stops[0].offset).toBeCloseTo(0, 6);
      expect(rlPaint.stops[0].color).toEqual({ r: 255, g: 0, b: 0 });
      expect(rlPaint.stops[0].alpha).toBeCloseTo(0.5, 2);
      expect(rlPaint.stops[1].offset).toBeCloseTo(1, 6);
      expect(rlPaint.stops[1].alpha).toBeUndefined();
      expect(rlPaint.x1).toBeCloseTo(0.1, 6);
      expect(rlPaint.y1).toBeCloseTo(0.2, 6);
      expect(rlPaint.x2).toBeCloseTo(0.9, 6);
      expect(rlPaint.y2).toBeCloseTo(0.8, 6);
    }
    expect(rl.effects!.shadow!.dx).toBe(1);
    expect(rl.effects!.shadow!.alpha).toBeCloseTo(0.8, 2);
    expect(rl.effects!.border!.width).toBe(0.5);
    expect(rl.effects!.border!.radius).toBeUndefined();
    expect(rl.effects!.glow).toBeUndefined();

    // SVG radial fillPaint + glow
    const rr = meta.svgObjects!.find(s => s.id === 'svg_radial')!;
    const rrPaint = rr.fillPaint!;
    expect(rrPaint.kind).toBe('radial');
    if (rrPaint.kind === 'radial') {
      expect(rrPaint.stops).toHaveLength(3);
      expect(rrPaint.stops[1].offset).toBeCloseTo(0.5, 2);
      expect(rrPaint.stops[1].alpha).toBeCloseTo(0.25, 2);
      expect(rrPaint.cx).toBeCloseTo(0.5, 6);
      expect(rrPaint.cy).toBeCloseTo(0.5, 6);
      expect(rrPaint.r).toBeCloseTo(0.7, 6);
    }
    expect(rr.effects!.glow!.radius).toBe(3);
    expect(rr.effects!.glow!.color).toEqual({ r: 255, g: 200, b: 100 });
    expect(rr.effects!.glow!.alpha).toBe(1);
    expect(rr.effects!.shadow).toBeUndefined();
    expect(rr.effects!.border).toBeUndefined();

    // Image tint + effects
    const ri = meta.images![0];
    expect(ri.tint!.color).toEqual({ r: 200, g: 150, b: 100 });
    expect(ri.tint!.amount).toBeCloseTo(0.42, 2);
    expect(ri.tint!.mode).toBe('duotone');
    expect(ri.effects!.shadow!.dy).toBe(0.75);
    expect(ri.effects!.shadow!.alpha).toBeCloseTo(0.3, 2);

    // Background
    const metaBg = meta.background!;
    expect(metaBg.kind).toBe('solid');
    if (metaBg.kind === 'solid') {
      expect(metaBg.color).toEqual({ r: 30, g: 20, b: 40 });
      expect(metaBg.alpha).toBeCloseTo(0.75, 2);
    }

    // Group survives (its only member is a text) + sceneOrder intact
    expect(meta.groups!.map(g => g.id)).toEqual(['g1']);
    expect(meta.sceneOrder).toEqual(['img_tinted', 'svg_linear', 'txt_sticker', 'svg_radial', 'txt_min']);
  });

  test('round-trips all text align values distinctly (including absent)', () => {
    const aligns = [undefined, 'left', 'center', 'right'] as const;
    const texts = aligns.map((align, i) => makeText({
      id: `txt_${i}`,
      content: `t${i}`,
      style: { fontId: 'F', size: 1, color: { r: 0, g: 0, b: 0 }, ...(align ? { align } : {}) },
    }));
    const result = roundTrip(makeBundle({ texts }));
    for (let i = 0; i < aligns.length; i++) {
      expect(result.meta.texts![i].style.align).toBe(aligns[i]);
    }
  });

  test('round-trips each tint mode', () => {
    const modes: ImageTintMode[] = ['tint', 'duotone', 'wash'];
    for (const mode of modes) {
      const img = makeImage({ id: 'img_a', tint: { color: { r: 1, g: 2, b: 3 }, amount: 1, mode } });
      const result = roundTrip(makeBundle({ images: [img], imageBlobs: { blob1: new Uint8Array([9]) } }));
      expect(result.meta.images![0].tint!.mode).toBe(mode);
      expect(result.meta.images![0].tint!.amount).toBe(1);
    }
  });

  test('round-trips each background paint kind', () => {
    const paints: Paint[] = [
      { kind: 'solid', color: { r: 5, g: 6, b: 7 } },
      {
        kind: 'linear',
        stops: [
          { offset: 0, color: { r: 0, g: 0, b: 0 } },
          { offset: 1, color: { r: 255, g: 255, b: 255 }, alpha: 0.5 },
        ],
        x1: 0, y1: 0, x2: 1, y2: 1,
      },
      {
        kind: 'radial',
        stops: [
          { offset: 0, color: { r: 9, g: 8, b: 7 }, alpha: 0.9 },
          { offset: 1, color: { r: 1, g: 1, b: 1 } },
        ],
        cx: 0.25, cy: 0.75, r: 1.5,
      },
    ];
    for (const background of paints) {
      const result = roundTrip(makeBundle({ background }));
      const bg = result.meta.background!;
      expect(bg.kind).toBe(background.kind);
      if (bg.kind === 'solid' && background.kind === 'solid') {
        expect(bg.color).toEqual(background.color);
        expect(bg.alpha).toBeUndefined(); // opaque collapses to undefined
      }
      if (bg.kind === 'linear' && background.kind === 'linear') {
        expect(bg.stops).toHaveLength(2);
        expect(bg.stops[1].alpha!).toBeCloseTo(0.5, 2);
        expect(bg.x2).toBeCloseTo(1, 6);
        expect(bg.y2).toBeCloseTo(1, 6);
      }
      if (bg.kind === 'radial' && background.kind === 'radial') {
        expect(bg.stops[0].alpha!).toBeCloseTo(0.9, 2);
        expect(bg.cx).toBeCloseTo(0.25, 6);
        expect(bg.r).toBeCloseTo(1.5, 6);
      }
    }
  });

  test('absent background reads back undefined', () => {
    const result = roundTrip(makeBundle());
    expect(result.meta.background).toBeUndefined();
  });

  // ── Quantization tolerances ────────────────────────────────────────

  test('u8-quantized fields round-trip within 1/255', () => {
    const svg = sb({
      id: 'svg_q',
      segments: closedSquare,
      color: { r: 0, g: 0, b: 0 },
      fillPaint: {
        kind: 'linear',
        stops: [
          { offset: 0.333, color: { r: 1, g: 2, b: 3 }, alpha: 0.777 },
          { offset: 0.666, color: { r: 4, g: 5, b: 6 }, alpha: 0.123 },
        ],
        x1: 0, y1: 0, x2: 1, y2: 0,
      },
    });
    const img = makeImage({
      id: 'img_q',
      tint: { color: { r: 7, g: 8, b: 9 }, amount: 0.421, mode: 'wash' },
    });
    const result = roundTrip(makeBundle({
      svgObjects: [svg],
      images: [img],
      imageBlobs: { blob1: new Uint8Array([1]) },
      background: { kind: 'solid', color: { r: 1, g: 1, b: 1 }, alpha: 0.314 },
    }));

    const fp = result.meta.svgObjects![0].fillPaint!;
    if (fp.kind === 'linear') {
      expect(Math.abs(fp.stops[0].offset - 0.333)).toBeLessThanOrEqual(U8_TOL);
      expect(Math.abs(fp.stops[0].alpha! - 0.777)).toBeLessThanOrEqual(U8_TOL);
      expect(Math.abs(fp.stops[1].offset - 0.666)).toBeLessThanOrEqual(U8_TOL);
      expect(Math.abs(fp.stops[1].alpha! - 0.123)).toBeLessThanOrEqual(U8_TOL);
    }
    expect(Math.abs(result.meta.images![0].tint!.amount - 0.421)).toBeLessThanOrEqual(U8_TOL);
    const bg = result.meta.background!;
    if (bg.kind === 'solid') {
      expect(Math.abs(bg.alpha! - 0.314)).toBeLessThanOrEqual(U8_TOL);
    }
  });

  test('text bbox round-trips within a quarter cell for arbitrary coordinates', () => {
    const text = makeText({
      id: 'txt_frac',
      content: 'q',
      cellX: 10.3, cellY: -4.11, cellWidth: 3.9, cellHeight: 1.06,
    });
    const result = roundTrip(makeBundle({ texts: [text] }));
    const rt = result.meta.texts![0];
    expect(Math.abs(rt.cellX - 10.3)).toBeLessThanOrEqual(BBOX_TOL);
    expect(Math.abs(rt.cellY - -4.11)).toBeLessThanOrEqual(BBOX_TOL);
    expect(Math.abs(rt.cellWidth - 3.9)).toBeLessThanOrEqual(BBOX_TOL);
    expect(Math.abs(rt.cellHeight - 1.06)).toBeLessThanOrEqual(BBOX_TOL);
  });

  // ── v28 backward compatibility ─────────────────────────────────────

  test('a v28-shaped file loads with texts empty, no background, no v29 fields', () => {
    // Serialize a composition with no v29 content, then reshape the bytes
    // into a valid v28 file. With no texts, sceneOrder, nodeTransforms,
    // customColors, or background, the file tail is 9 zero bytes:
    //   textCount(2) sceneOrderCount(2) ntCount(2) ccCount(2) hasBackground(1)
    // A v28 tail is the middle 6 zero bytes, so truncating the final 3
    // bytes (and patching the version) produces an exact v28 layout.
    const fig = makeFigure({ id: 'f1', figureKey: 'k1', name: 'Fig', cellX: 2, cellY: 3 });
    const svg = sb({
      id: 's1',
      segments: closedSquare,
      color: { r: 9, g: 8, b: 7 },
      fillColor: { r: 1, g: 2, b: 3 },
      fillOpacity: 0.5,
    });
    const v29Bytes = serializeComposition(makeBundle({ figures: [fig], svgObjects: [svg] }), []);

    // Guard the construction: the v29 tail must be all zeros.
    expect(Array.from(v29Bytes.subarray(v29Bytes.length - 9))).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);

    const v28Bytes = v29Bytes.slice(0, v29Bytes.length - 3);
    new DataView(v28Bytes.buffer, v28Bytes.byteOffset, v28Bytes.byteLength).setUint16(4, 28, true);

    const result = deserializeComposition(v28Bytes);
    // New fields absent
    expect(result.meta.texts).toEqual([]);
    expect(result.meta.background).toBeUndefined();
    expect(result.meta.svgObjects![0].fillPaint).toBeUndefined();
    expect(result.meta.svgObjects![0].effects).toBeUndefined();
    // Pre-existing fields intact
    expect(result.meta.name).toBe('V29 Comp');
    expect(result.meta.figures[0].id).toBe('f1');
    expect(result.meta.figures[0].name).toBe('Fig');
    expect(result.meta.figures[0].cellX).toBe(2);
    expect(result.meta.svgObjects![0].id).toBe('s1');
    expect(result.meta.svgObjects![0].segments).toEqual(closedSquare);
    expect(result.meta.svgObjects![0].color).toEqual({ r: 9, g: 8, b: 7 });
    expect(result.meta.svgObjects![0].fillColor).toEqual({ r: 1, g: 2, b: 3 });
    expect(result.meta.svgObjects![0].fillOpacity).toBeCloseTo(0.5, 2);
  });

  test('all pre-v29 .tile fixtures in test_data still load', () => {
    const fs = require('fs');
    const path = require('path');
    const zlib = require('zlib');
    const dir = path.join(__dirname, '../../test_data');
    const tiles: string[] = fs.readdirSync(dir).filter((f: string) => f.endsWith('.tile'));
    expect(tiles.length).toBeGreaterThan(0);
    for (const name of tiles) {
      const compressed = fs.readFileSync(path.join(dir, name));
      const payload = new Uint8Array(zlib.inflateSync(compressed));
      const result = deserializeComposition(payload);
      // Pre-v29 files carry no texts or background.
      expect(result.meta.texts).toEqual([]);
      expect(result.meta.background).toBeUndefined();
      expect(Array.isArray(result.meta.figures)).toBe(true);
    }
  });

  // ── Normalization ──────────────────────────────────────────────────

  test('a far-out text node normalizes consistently with an image at the same spot', () => {
    const bbox = { cellX: 100, cellY: 200, cellWidth: 4, cellHeight: 4 };
    const text = makeText({ id: 'txt_far', content: 'far', ...bbox });
    const img = makeImage({ id: 'img_far', ...bbox });

    const r = normalizeComposition({
      figures: [],
      svgObjects: [],
      images: [img],
      texts: [text],
      groups: [],
      gridLevel: 1,
      strokeScale: 0.5,
      background: { kind: 'solid', color: { r: 1, g: 2, b: 3 } },
    });
    // Identical input bboxes must land on identical output bboxes.
    const nt = r.texts![0];
    const ni = r.images![0];
    expect(nt.cellX).toBe(ni.cellX);
    expect(nt.cellY).toBe(ni.cellY);
    expect(nt.cellWidth).toBe(ni.cellWidth);
    expect(nt.cellHeight).toBe(ni.cellHeight);
    // Content actually moved into the canonical box.
    expect(nt.cellX).toBeGreaterThanOrEqual(0);
    expect(nt.cellX + nt.cellWidth).toBeLessThanOrEqual(32);
    expect(nt.cellY).toBeGreaterThanOrEqual(0);
    expect(nt.cellY + nt.cellHeight).toBeLessThanOrEqual(32);
    // Background passes through untouched.
    expect(r.background).toEqual({ kind: 'solid', color: { r: 1, g: 2, b: 3 } });

    // And the relative positions still agree after a binary round-trip.
    const result = roundTrip(makeBundle({
      texts: [nt],
      images: [ni],
      imageBlobs: { blob1: new Uint8Array([1]) },
      gridLevel: r.gridLevel,
      strokeScale: r.strokeScale,
    }));
    const rt = result.meta.texts![0];
    const ri = result.meta.images![0];
    expect(Math.abs(rt.cellX - ri.cellX)).toBeLessThanOrEqual(BBOX_TOL);
    expect(Math.abs(rt.cellY - ri.cellY)).toBeLessThanOrEqual(BBOX_TOL);
    expect(Math.abs(rt.cellWidth - ri.cellWidth)).toBeLessThanOrEqual(BBOX_TOL);
    expect(Math.abs(rt.cellHeight - ri.cellHeight)).toBeLessThanOrEqual(BBOX_TOL);
  });

  // ── Alive-group pruning ────────────────────────────────────────────

  test('a group whose only member is a text survives serialization', () => {
    const text = makeText({ id: 'txt_member', content: 'member', groupId: 'g_text' });
    const bundle = makeBundle({
      texts: [text],
      groups: [
        {
          id: 'g_text', name: 'Text Group',
          translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
          rotation: 0, mirrorH: false, mirrorV: false,
        },
        {
          id: 'g_ghost', name: 'Ghost Group',
          translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
          rotation: 0, mirrorH: false, mirrorV: false,
        },
      ],
    });
    const result = roundTrip(bundle);
    expect(result.meta.groups!.map(g => g.id)).toEqual(['g_text']);
    expect(result.meta.texts![0].groupId).toBe('g_text');
  });

  // ── Effects payload edge cases ─────────────────────────────────────

  test('effects with only a border (no shadow/glow) round-trips', () => {
    const effects: NodeEffects = { border: { width: 1, color: { r: 5, g: 5, b: 5 } } };
    const text = makeText({ id: 'txt_b', content: 'b', effects });
    const result = roundTrip(makeBundle({ texts: [text] }));
    const rt = result.meta.texts![0];
    expect(rt.effects!.border!.width).toBe(1);
    expect(rt.effects!.border!.radius).toBeUndefined();
    expect(rt.effects!.shadow).toBeUndefined();
    expect(rt.effects!.glow).toBeUndefined();
  });
});
