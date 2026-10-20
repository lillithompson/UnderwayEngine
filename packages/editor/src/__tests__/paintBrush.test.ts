/**
 * The color tool's drag-paint brush (paintBrush.ts + the buildPaintStroke
 * commit): Facet's stamp semantics — gaussian falloff, per-touch blend
 * composition, unary once-per-stroke modes, the selection filter — and the
 * one-undo-entry commit through the engine's buildPaintStrokeOps plus the
 * app-side accumulators (text charColors, image / solid-shape bitmap layers).
 */

import {
  COLOR_SCOPES, COLOR_SURFACES, ColorScope, DEFAULT_BRUSH_STRENGTH, DEFAULT_COLOR_SCOPE, PaintBrushKind,
  RANDOM_WALK_FRAMES, dabHand,
  advanceRandomColorWalk, colorScopeLabel, colorScopeWrites, colorScopeWritesText,
  createObjectColorState,
  createOverlayPaintState, brushDimsToSelection, createPaintStrokeDraft, createRandomColorWalk,
  createTextPaintState, imageTintSolidColor, islandTileFrame, paintFilterIds, paintHiddenIds,
  previewCharColors,
  resolvePaintSessionTarget, shapeFillSolidColor, stampPaintBrush,
} from '../paintBrush';
import { shearedIslandFixture } from './test-utils';
import { drawnLeaf } from '../drawnPose';
import { graphOf } from '@/engine/sceneHitFrame';
import { paintLocalFrame } from '@/engine/paintObject';
import { paintTileAlphaAt } from '@/engine/canvasPaint';
import type { PaintObject } from '@/engine/types';
import { buildApplyColor, buildPaintStroke } from '../editorSession';
import { makeBlankComposition } from '@/editor/blankComposition';
import { applyCompOps, revertCompOps } from '@/engine/compositionOps';
import { blendColor, gaussianFalloff } from '@/engine/colorBlend';
import {
  OVERLAY_TEXELS_PER_CELL, createImagePaintOverlay, stampImagePaintOverlay,
} from '@/engine/imagePaintOverlay';
import {
  CompositionState, ImageObject, PathSegment, RGBColor, ShapeFill, SVGObject, TextObject,
} from '@/engine/types';

const line = (start: [number, number], end: [number, number]): PathSegment =>
  ({ kind: 'line', start, end });

const BLACK: RGBColor = { r: 0, g: 0, b: 0 };
const RED: RGBColor = { r: 255, g: 0, b: 0 };
const GRAY: RGBColor = { r: 128, g: 128, b: 128 };

/** A 4×3 rectangle outline at the origin; segment 0 is the top edge. */
function svg(id: string, extras: Partial<SVGObject> = {}): SVGObject {
  return {
    id,
    segments: [
      line([0, 0], [4, 0]),
      line([4, 0], [4, 3]),
      line([4, 3], [0, 3]),
      line([0, 3], [0, 0]),
    ],
    color: BLACK,
    cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 3,
    ...extras,
  };
}

function stateWith(objects: SVGObject[]): CompositionState {
  const base = makeBlankComposition('comp_test');
  return {
    ...base,
    svgObjects: objects,
    sceneOrder: objects.map((o) => o.id),
  };
}

const solidFill = (color: RGBColor, extras: Partial<ShapeFill> = {}): ShapeFill => ({
  type: 'solid',
  solid: { ...color },
  stops: [
    { offset: 0, color: { ...color } },
    { offset: 1, color: { r: 255, g: 255, b: 255 } },
  ],
  angle: 90,
  opacity: 1,
  blend: 'normal',
  ...extras,
});

/** One stamp against a fresh draft; returns the accumulators for asserting. */
function stamp(
  state: CompositionState,
  brush: RGBColor,
  mode: Parameters<typeof createPaintStrokeDraft>[1],
  opacity: number,
  at: [number, number],
  opts: {
    filter?: Set<string> | null; skip?: Set<string>; radius?: number;
    kind?: PaintBrushKind; scope?: ColorScope;
  } = {},
) {
  const draft = createPaintStrokeDraft(brush, mode, opacity);
  const textPaint = createTextPaintState();
  const imagePaint = createOverlayPaintState();
  const shapePaint = createOverlayPaintState();
  const objectColor = createObjectColorState(opts.scope);
  const changed = stampPaintBrush(
    state, draft, textPaint, imagePaint, shapePaint, at[0], at[1],
    opts.radius ?? 1, opts.filter ?? null, opts.skip ?? new Set(),
    opts.kind ?? 'paint', null, null, objectColor,
  );
  return { draft, textPaint, imagePaint, shapePaint, objectColor, changed };
}

/** The same stamp with the COLOR brush armed — the recolour-only one. */
const colorStamp = (
  state: CompositionState,
  brush: RGBColor,
  mode: Parameters<typeof createPaintStrokeDraft>[1],
  opacity: number,
  at: [number, number],
  opts: Parameters<typeof stamp>[5] = {},
) => stamp(state, brush, mode, opacity, at, { ...opts, kind: 'color' });

describe('the Color brush (recolour only — no raster mark, ever)', () => {
  const BLUE: RGBColor = { r: 0, g: 0, b: 255 };
  const white: RGBColor = { r: 255, g: 255, b: 255 };

  it('recolours the segments of a line it touches, like the paint brush does', () => {
    const state = stateWith([svg('svg_1')]);
    // A line is a STROKE, so that is the scope that reaches it.
    const { draft, changed } = colorStamp(state, RED, 'normal', 1, [2, 0], { scope: 'strokes' });
    expect(changed).toBe(true);
    expect(draft.paintedSegments.get('svg_1')?.get(0)).toEqual(RED);
    expect(draft.paintedSegments.get('svg_1')?.size).toBe(1);
  });

  it('lays no bitmap layer on an image — one tint over the whole photo instead', () => {
    const state = stateWithImages([imageNode()]);
    const { imagePaint, objectColor, changed } = colorStamp(state, RED, 'normal', 1, [4, 3]);
    expect(changed).toBe(true);
    // The road NOT taken: nothing in the overlay accumulator at all.
    expect(imagePaint.overlays.size).toBe(0);
    // An untinted photo has no base to blend from — the dab lands the colour.
    expect(objectColor.imageTints.get('img_1')).toEqual(RED);
  });

  it('blends a repeat dab from the tint the image already carries', () => {
    const tinted = imageNode({
      tintFill: {
        type: 'solid', solid: white, stops: [], angle: 90, opacity: 0.5, blend: 'normal',
      },
    });
    expect(imageTintSolidColor(tinted)).toEqual(white);
    const { objectColor } = colorStamp(stateWithImages([tinted]), GRAY, 'multiply', 1, [4, 3]);
    expect(objectColor.imageTints.get('img_1'))
      .toEqual(blendColor(white, GRAY, 'multiply', 0.125));
  });

  it('reads a GRADIENT tint as no single colour: the first dab lands the brush colour', () => {
    const gradient = imageNode({
      tintFill: {
        type: 'linear',
        solid: white,
        stops: [{ offset: 0, color: BLACK }, { offset: 1, color: white }],
        angle: 90, opacity: 0.5, blend: 'normal',
      },
    });
    expect(imageTintSolidColor(gradient)).toBeNull();
    const { objectColor } = colorStamp(stateWithImages([gradient]), RED, 'normal', 1, [4, 3]);
    expect(objectColor.imageTints.get('img_1')).toEqual(RED);
  });

  it('misses an image the dab does not reach', () => {
    const state = stateWithImages([imageNode()]);
    const { objectColor, changed } = colorStamp(state, RED, 'normal', 1, [40, 30]);
    expect(changed).toBe(false);
    expect(objectColor.imageTints.size).toBe(0);
  });

  it('takes a filled shape’s FILL or its BORDER, whichever the scope names', () => {
    const state = stateWith([svg('svg_1', { fill: solidFill(RED) })]);
    // Dead on the top edge: the segment is hit, and the shape is filled —
    // the one dab both scopes can answer, so it is where they differ.
    const fills = colorStamp(state, BLUE, 'normal', 1, [2, 0], { scope: 'fills' });
    expect(fills.shapePaint.overlays.size).toBe(0); // no bitmap, ever
    expect(fills.objectColor.shapeFills.get('svg_1')).toEqual(BLUE);
    expect(fills.draft.paintedSegments.get('svg_1')?.size ?? 0).toBe(0);

    const strokes = colorStamp(state, BLUE, 'normal', 1, [2, 0], { scope: 'strokes' });
    expect(strokes.objectColor.shapeFills.size).toBe(0);
    expect(strokes.draft.paintedSegments.get('svg_1')?.get(0)).toEqual(BLUE);
    // …and only the segment it crossed: the other three edges keep theirs.
    expect(strokes.draft.paintedSegments.get('svg_1')?.size).toBe(1);
  });

  it('takes a filled shape’s INTERIOR as its fill, with no segment hit at all', () => {
    const state = stateWith([svg('svg_1', { fill: solidFill(RED) })]);
    const { draft, objectColor, changed } = colorStamp(state, BLUE, 'normal', 1, [2, 1.5]);
    expect(changed).toBe(true);
    expect(objectColor.shapeFills.get('svg_1')).toEqual(BLUE);
    expect(draft.paintedSegments.get('svg_1')?.size ?? 0).toBe(0);
  });

  it('flattens a gradient fill to the brushed colour, reading the stroke as its base', () => {
    const gradient = solidFill(RED, { type: 'linear' });
    const shape = svg('svg_1', { color: white, fill: gradient });
    expect(shapeFillSolidColor(shape)).toEqual(white); // no one colour → the stroke's
    const { objectColor } = colorStamp(stateWith([shape]), GRAY, 'multiply', 1, [2, 1.5]);
    expect(objectColor.shapeFills.get('svg_1'))
      .toEqual(blendColor(white, GRAY, 'multiply', 0.125));
  });

  it('reads a legacy fillColor shape the same way — one fill, no paintedFills blend', () => {
    const state = stateWith([svg('svg_1', { fillColor: white })]);
    const { draft, objectColor } = colorStamp(state, GRAY, 'multiply', 1, [2, 1.5]);
    expect(objectColor.shapeFills.get('svg_1'))
      .toEqual(blendColor(white, GRAY, 'multiply', 0.125));
    // The engine draft's legacy whole-fill blend is the PAINT brush's road.
    expect(draft.paintedFills.size).toBe(0);
  });

  it('leaves a fillABLE but unfilled shape as four lines: border only', () => {
    const state = stateWith([svg('svg_1')]);
    const { draft, objectColor } = colorStamp(state, RED, 'normal', 1, [2, 0], { scope: 'strokes' });
    expect(objectColor.shapeFills.size).toBe(0);
    expect(draft.paintedSegments.get('svg_1')?.get(0)).toEqual(RED);
    // Being fillable is not having a fill: Fills finds nothing here either.
    const asFill = colorStamp(state, RED, 'normal', 1, [2, 0], { scope: 'fills' });
    expect(asFill.changed).toBe(false);
    expect(asFill.objectColor.shapeFills.size).toBe(0);
  });

  it('recolours a text character by character', () => {
    const { textPaint, objectColor } = colorStamp(
      stateWithTexts([textNode()]), RED, 'normal', 1, [0.2, 1],
    );
    expect(textPaint.chars.get('txt_1')?.get(0)).toEqual(RED);
    expect(textPaint.chars.get('txt_1')?.has(1)).toBe(false);
    expect(objectColor.imageTints.size).toBe(0);
  });

  it('a text answers to BOTH Fills and Strokes — its ink is its only colour', () => {
    // The one surface two aims reach. A character is DRAWN, not filled and
    // outlined, so there is no second colour for the other aim to set —
    // and a page that is a poem (a haiku's three lines, a board of
    // magnets) would otherwise have an aim with nothing under it.
    for (const scope of COLOR_SURFACES) {
      const { textPaint, changed } = colorStamp(
        stateWithTexts([textNode()]), RED, 'normal', 1, [0.2, 1], { scope },
      );
      const reaches = scope === 'fills' || scope === 'strokes';
      expect(changed).toBe(reaches);
      expect(textPaint.chars.has('txt_1')).toBe(reaches);
      // …and it is the SAME colour either way: one aim cannot give a text
      // a second ink the other does not see.
      if (reaches) expect(textPaint.chars.get('txt_1')?.get(0)).toEqual(RED);
    }
  });

  it('Patterns still leaves a text alone — the exception is two aims, not three', () => {
    const { changed } = colorStamp(
      stateWithTexts([textNode()]), RED, 'normal', 1, [0.2, 1], { scope: 'patterns' },
    );
    expect(changed).toBe(false);
  });

  it('aims at ONE kind of surface: a photo’s tint is a fill too', () => {
    for (const scope of COLOR_SURFACES) {
      const { objectColor, changed } = colorStamp(
        stateWithImages([imageNode()]), RED, 'normal', 1, [4, 3], { scope },
      );
      expect(changed).toBe(scope === 'fills');
      expect(objectColor.imageTints.size).toBe(scope === 'fills' ? 1 : 0);
    }
  });

  it('does nothing to a WORD tile — its ink is its card scheme’s, not the style’s', () => {
    const { changed } = colorStamp(
      stateWithTexts([textNode({ sticker: true })]), RED, 'normal', 1, [0.2, 1],
    );
    expect(changed).toBe(false);
  });

  it('holds a whole-object colour once per stroke under a unary mode', () => {
    const state = stateWithImages([imageNode({
      tintFill: {
        type: 'solid', solid: white, stops: [], angle: 90, opacity: 0.5, blend: 'normal',
      },
    })]);
    const draft = createPaintStrokeDraft(RED, 'invert', 1);
    const objectColor = createObjectColorState();
    const dab = () => stampPaintBrush(
      state, draft, createTextPaintState(), createOverlayPaintState(), createOverlayPaintState(),
      4, 3, 1, null, new Set(), 'color', null, null, objectColor,
    );
    dab();
    const once = objectColor.imageTints.get('img_1');
    expect(once).toEqual(blendColor(white, RED, 'invert', 1));
    dab();
    expect(objectColor.imageTints.get('img_1')).toEqual(once);
  });

  it('commits a shape fill and an image tint as ops that apply and revert cleanly', () => {
    const base = makeBlankComposition('comp_test');
    const state: CompositionState = {
      ...base,
      svgObjects: [svg('svg_1', { fillColor: { r: 255, g: 255, b: 255 } })],
      images: [imageNode({ cellX: 20, cellY: 0 })],
      sceneOrder: ['svg_1', 'img_1'],
    };
    const shapeSide = colorStamp(state, BLUE, 'normal', 1, [2, 1.5]);
    const imgSide = colorStamp(state, BLUE, 'normal', 1, [24, 3]);
    const objectColor = createObjectColorState();
    objectColor.shapeFills.set('svg_1', shapeSide.objectColor.shapeFills.get('svg_1')!);
    objectColor.imageTints.set('img_1', imgSide.objectColor.imageTints.get('img_1')!);

    const se = buildPaintStroke(
      state, shapeSide.draft, undefined, undefined, undefined, undefined, undefined, objectColor,
    );
    expect(se).not.toBeNull();
    const applied = applyCompOps(state, se!.entry);
    // The shape's fill is now a SOLID of the brushed colour — and the legacy
    // field it migrated off is cleared, exactly as the Fill bar leaves it.
    expect(applied.svgObjects[0].fill?.type).toBe('solid');
    expect(applied.svgObjects[0].fill?.solid).toEqual(BLUE);
    expect(applied.svgObjects[0].fillColor).toBeUndefined();
    // The image wears one tint over the whole of it, at the default layer's
    // see-through 50 % rather than a flat rectangle over the photo.
    expect(applied.images![0].tintFill?.type).toBe('solid');
    expect(applied.images![0].tintFill?.solid).toEqual(BLUE);
    expect(applied.images![0].tintFill?.opacity).toBe(0.5);
    expect(applied.images![0].paintOverlay).toBeUndefined();

    const reverted = revertCompOps(applied, se!.entry);
    expect(reverted.svgObjects[0].fill).toBeUndefined();
    expect(reverted.svgObjects[0].fillColor).toEqual({ r: 255, g: 255, b: 255 });
    expect(reverted.images![0].tintFill).toBeUndefined();
  });

  it('reports NOTHING when a dab lands back on the colour already there', () => {
    // Dodge cannot brighten white — no blend colour moves a maxed channel —
    // and white is both the default ink and the fill a shape takes when one
    // is added, so this is the first thing a user meets. The stroke must
    // read as the no-op it is: reporting `painted` here mounts a preview
    // wash that stands in for an edit the commit then (rightly) refuses,
    // and the stroke appears to undo itself on release.
    const whiteFilled = svg('svg_1', { color: white, fill: solidFill(white) });
    const dodged = colorStamp(stateWith([whiteFilled]), BLUE, 'dodge', 1, [2, 1.5]);
    expect(dodged.changed).toBe(false);
    expect(buildPaintStroke(
      stateWith([whiteFilled]), dodged.draft, undefined, undefined, undefined, undefined,
      undefined, dodged.objectColor,
    )).toBeNull();
    // The same dab in Normal is a real edit, so it still reports one.
    expect(colorStamp(stateWith([whiteFilled]), BLUE, 'normal', 1, [2, 1.5]).changed).toBe(true);
    // …and dodge on a colour it CAN lift reports one too.
    const rose = svg('svg_1', { color: RED, fill: solidFill({ r: 244, g: 63, b: 94 }) });
    expect(colorStamp(stateWith([rose]), BLUE, 'dodge', 1, [2, 1.5]).changed).toBe(true);
  });

  it('never touches a locked shape or image, however the brush is dragged', () => {
    const lockedShape = colorStamp(
      stateWith([svg('svg_1', { fill: solidFill(RED), locked: true })]),
      BLUE, 'normal', 1, [2, 1.5],
    );
    expect(lockedShape.changed).toBe(false);
    const lockedImage = colorStamp(
      stateWithImages([imageNode({ locked: true })]), BLUE, 'normal', 1, [4, 3],
    );
    expect(lockedImage.changed).toBe(false);
  });
});

describe('the Color brush’s scope (the capsule’s aim)', () => {
  it('offers Any, then the three surfaces, Strokes first', () => {
    expect(COLOR_SCOPES).toEqual(['any', 'strokes', 'fills', 'patterns']);
    expect(COLOR_SCOPES.map(colorScopeLabel)).toEqual(['Any', 'Strokes', 'Fills', 'Patterns']);
    expect(COLOR_SURFACES).toEqual(['strokes', 'fills', 'patterns']);
    // A fresh brush opens on Any, the capsule's first option, on every
    // page and game.
    expect(DEFAULT_COLOR_SCOPE).toBe('any');
    expect(createObjectColorState().scope).toBe(DEFAULT_COLOR_SCOPE);
  });

  it('gates the COLOR brush alone — every other kind writes what it always did', () => {
    for (const scope of COLOR_SCOPES) {
      for (const target of COLOR_SURFACES) {
        // 'any' MAY write every surface; which one is decided per object.
        expect(colorScopeWrites('color', scope, target)).toBe(scope === 'any' || scope === target);
        for (const kind of ['paint', 'erase', 'blur', 'push'] as const) {
          expect(colorScopeWrites(kind, scope, target)).toBe(true);
        }
      }
    }
  });

  it('TEXT is the one surface two aims reach, and the raster brushes all of them', () => {
    expect(colorScopeWritesText('color', 'fills')).toBe(true);
    expect(colorScopeWritesText('color', 'strokes')).toBe(true);
    expect(colorScopeWritesText('color', 'patterns')).toBe(false);
    for (const kind of ['paint', 'erase', 'blur', 'push'] as const) {
      for (const scope of COLOR_SCOPES) {
        expect(colorScopeWritesText(kind, scope)).toBe(true);
      }
    }
  });
});

describe('the Any aim — ONE surface per object: fill, else line, else cloth', () => {
  const BLUE: RGBColor = { r: 0, g: 0, b: 255 };

  it('takes a filled shape’s FILL only, even dead on its border', () => {
    const state = stateWith([svg('svg_1', { fill: solidFill(RED) })]);
    const { draft, objectColor, changed } = colorStamp(state, BLUE, 'normal', 1, [2, 0], { scope: 'any' });
    expect(changed).toBe(true);
    expect(objectColor.shapeFills.get('svg_1')).toEqual(BLUE);
    expect(draft.paintedSegments.get('svg_1')?.size ?? 0).toBe(0);
  });

  it('takes an unfilled shape’s LINE', () => {
    const state = stateWith([svg('svg_1')]);
    const { draft, objectColor, changed } = colorStamp(state, BLUE, 'normal', 1, [2, 0], { scope: 'any' });
    expect(changed).toBe(true);
    expect(objectColor.shapeFills.size).toBe(0);
    expect(draft.paintedSegments.get('svg_1')?.get(0)).toEqual(BLUE);
  });

  it('decides per object: one dab over a filled and an unfilled shape', () => {
    const filled = svg('svg_1', { fill: solidFill(RED) });
    const open = svg('svg_2');
    const { draft, objectColor } = colorStamp(
      stateWith([filled, open]), BLUE, 'normal', 1, [2, 0], { scope: 'any' },
    );
    expect(objectColor.shapeFills.get('svg_1')).toEqual(BLUE);
    expect(draft.paintedSegments.get('svg_1')?.size ?? 0).toBe(0);
    expect(objectColor.shapeFills.has('svg_2')).toBe(false);
    expect(draft.paintedSegments.get('svg_2')?.get(0)).toEqual(BLUE);
    // …and remembers each answer for the rest of the stroke.
    expect(objectColor.anyAims.get('svg_1')).toBe('fills');
    expect(objectColor.anyAims.get('svg_2')).toBe('strokes');
  });

  it('takes a filled SUBPATH and leaves the open strokes beside it', () => {
    const shape = svg('svg_1', {
      subpaths: [
        { segments: [line([0, 0], [4, 0]), line([4, 0], [4, 3]), line([4, 3], [0, 0])], color: BLACK, fill: true },
        { segments: [line([0, 3], [0, 0])], color: BLACK },
      ],
    });
    // Inside the triangle and within reach of the open edge at x = 0.
    const at: [number, number] = [1, 0.5];
    const { draft } = colorStamp(stateWith([shape]), BLUE, 'normal', 1, at, { scope: 'any', radius: 2 });
    const bucket = draft.paintedSegments.get('svg_1');
    expect([0, 1, 2].map((i) => bucket?.get(i))).toEqual([BLUE, BLUE, BLUE]);
    expect(bucket?.has(3)).toBe(false);
    // The same dab aimed at Strokes does reach that open edge.
    const asStroke = colorStamp(stateWith([shape]), BLUE, 'normal', 1, at, { scope: 'strokes', radius: 2 });
    expect(asStroke.draft.paintedSegments.get('svg_1')?.has(3)).toBe(true);
  });

  it('still colours a text and a photo — each has one colour to give', () => {
    const t = colorStamp(stateWithTexts([textNode()]), RED, 'normal', 1, [0.2, 1], { scope: 'any' });
    expect(t.textPaint.chars.get('txt_1')?.get(0)).toEqual(RED);
    const i = colorStamp(stateWithImages([imageNode()]), RED, 'normal', 1, [4, 3], { scope: 'any' });
    expect(i.objectColor.imageTints.get('img_1')).toEqual(RED);
  });
});

describe('stampPaintBrush', () => {
  it('paints a segment under the brush center to the brush color (normal, full opacity)', () => {
    const state = stateWith([svg('svg_1')]);
    // Dead-on the top edge: distance 0 → falloff 1 → the brush color exactly.
    const { draft, changed } = stamp(state, RED, 'normal', 1, [2, 0]);
    expect(changed).toBe(true);
    expect(draft.paintedSegments.get('svg_1')?.get(0)).toEqual(RED);
    // The far edges sit outside the 1-cell radius — untouched.
    expect(draft.paintedSegments.get('svg_1')?.size).toBe(1);
  });

  it('applies the gaussian falloff off-center', () => {
    const state = stateWith([svg('svg_1')]);
    // Half a cell above the top edge: tSq = 0.25.
    const { draft } = stamp(state, RED, 'normal', 1, [2, -0.5]);
    const expected = blendColor(BLACK, RED, 'normal', gaussianFalloff(0.25));
    expect(draft.paintedSegments.get('svg_1')?.get(0)).toEqual(expected);
  });

  it('leaves segments at (or past) the brush edge unpainted', () => {
    const state = stateWith([svg('svg_1')]);
    // Exactly one radius above the edge: the hit-test includes the boundary
    // (d² ≤ r²) but the falloff there is 0, so no color lands. (Facet
    // behaves the same: the segment bucket exists, empty.)
    const { draft, changed } = stamp(state, RED, 'normal', 1, [2, -1]);
    expect(changed).toBe(false);
    expect(draft.paintedSegments.get('svg_1')?.size ?? 0).toBe(0);
  });

  it('composes repeat touches (multiply keeps darkening, slowly)', () => {
    // Non-Normal modes blend at HALF the brush opacity (blendStrength), and
    // the arithmetic heavyweights — dodge, burn, multiply — at a QUARTER of
    // that again (an eighth of the hand): even the halved multiply
    // overwhelmed the base in a dab or two, so its effect runs 75% slower.
    // Opacity still scales the hand proportionally.
    const base: RGBColor = { r: 200, g: 200, b: 200 };
    const state = stateWith([svg('svg_1', { color: base })]);
    const draft = createPaintStrokeDraft(GRAY, 'multiply', 1);
    stampPaintBrush(state, draft, createTextPaintState(), createOverlayPaintState(), createOverlayPaintState(), 2, 0, 1, null, new Set());
    const first = blendColor(base, GRAY, 'multiply', 0.125);
    expect(draft.paintedSegments.get('svg_1')?.get(0)).toEqual(first);
    stampPaintBrush(state, draft, createTextPaintState(), createOverlayPaintState(), createOverlayPaintState(), 2, 0, 1, null, new Set());
    expect(draft.paintedSegments.get('svg_1')?.get(0)).toEqual(blendColor(first, GRAY, 'multiply', 0.125));
  });

  it('dodge and burn take the same damped hand as multiply; other blends keep the half', () => {
    // The 75%-reduction rule covers exactly the three arithmetic
    // heavyweights. A non-heavyweight blend (color) still lands at the
    // plain non-Normal half.
    const base: RGBColor = { r: 100, g: 100, b: 100 };
    const dodge = stamp(stateWith([svg('svg_1', { color: base })]), GRAY, 'dodge', 1, [2, 0]);
    expect(dodge.draft.paintedSegments.get('svg_1')?.get(0))
      .toEqual(blendColor(base, GRAY, 'dodge', 0.125));
    const burn = stamp(stateWith([svg('svg_1', { color: base })]), GRAY, 'burn', 1, [2, 0]);
    expect(burn.draft.paintedSegments.get('svg_1')?.get(0))
      .toEqual(blendColor(base, GRAY, 'burn', 0.125));
    const color = stamp(stateWith([svg('svg_1', { color: base })]), RED, 'color', 1, [2, 0]);
    expect(color.draft.paintedSegments.get('svg_1')?.get(0))
      .toEqual(blendColor(base, RED, 'color', 0.5));
  });

  it('applies unary modes once per stroke (rotate does not keep spinning)', () => {
    const state = stateWith([svg('svg_1', { color: RED })]);
    const draft = createPaintStrokeDraft(RED, 'rotate', 1);
    stampPaintBrush(state, draft, createTextPaintState(), createOverlayPaintState(), createOverlayPaintState(), 2, 0, 1, null, new Set());
    const once = draft.paintedSegments.get('svg_1')?.get(0);
    // Rotate folds strength into the hue angle; half strength = half step.
    expect(once).toEqual(blendColor(RED, RED, 'rotate', 0.5));
    stampPaintBrush(state, draft, createTextPaintState(), createOverlayPaintState(), createOverlayPaintState(), 2, 0, 1, null, new Set());
    expect(draft.paintedSegments.get('svg_1')?.get(0)).toEqual(once);
  });

  it('honors the selection filter and the skip set, and never paints locked objects', () => {
    const filtered = stamp(
      stateWith([svg('svg_1'), svg('svg_2')]), RED, 'normal', 1, [2, 0],
      { filter: new Set(['svg_2']) },
    );
    expect(filtered.draft.paintedSegments.has('svg_1')).toBe(false);

    const skipped = stamp(
      stateWith([svg('svg_1')]), RED, 'normal', 1, [2, 0],
      { skip: new Set(['svg_1']) },
    );
    expect(skipped.changed).toBe(false);

    const locked = stamp(
      stateWith([svg('svg_1', { locked: true })]), RED, 'normal', 1, [2, 0],
    );
    expect(locked.changed).toBe(false);
  });

  it('blends a legacy fillColor (no spatial falloff) once the outline is hit', () => {
    const white: RGBColor = { r: 255, g: 255, b: 255 };
    const state = stateWith([svg('svg_1', { fillColor: white })]);
    const { draft } = stamp(state, GRAY, 'multiply', 1, [2, -0.5]);
    // Off-center (falloff < 1) yet the fill takes the whole-object blend —
    // at multiply's damped strength, no spatial falloff.
    expect(draft.paintedFills.get('svg_1')).toEqual(blendColor(white, GRAY, 'multiply', 0.125));
  });

  it('a dab in the fill’s INTERIOR blends it too — no segment hit needed', () => {
    // The occlusion stack stencils the island out of a filled interior, so a
    // dab landing there that touched nothing used to deposit nowhere at all —
    // the swallowed dab. The interior now counts as touching the fill.
    const white: RGBColor = { r: 255, g: 255, b: 255 };
    const state = stateWith([svg('svg_1', { fillColor: white })]);
    // Rectangle center: 1.5 cells from the nearest edge, radius 1 — no hits.
    const { draft, changed } = stamp(state, GRAY, 'multiply', 1, [2, 1.5]);
    expect(changed).toBe(true);
    expect(draft.paintedSegments.get('svg_1')?.size ?? 0).toBe(0);
    expect(draft.paintedFills.get('svg_1')).toEqual(blendColor(white, GRAY, 'multiply', 0.125));
  });

  it('does not touch the fill when the brush misses the shape entirely', () => {
    const state = stateWith([svg('svg_1', { fillColor: RED })]);
    // Outside the rectangle, within its inflated AABB pre-reject: no hits,
    // not inside — nothing blends.
    const { draft, changed } = stamp(state, GRAY, 'multiply', 1, [5.5, 1.5]);
    expect(changed).toBe(false);
    expect(draft.paintedFills.size).toBe(0);
  });

  it('paints a solid shape\'s bitmap layer locally instead of its whole fill', () => {
    const blue: RGBColor = { r: 0, g: 0, b: 255 };
    // The 4×3 rect is subtype 'rectangle' → overlay grid 16×12 (4 texels/cell).
    const state = stateWith([svg('svg_1', { fill: solidFill(RED) })]);
    const { shapePaint, changed } = stamp(state, blue, 'normal', 1, [2, 1.5]);
    expect(changed).toBe(true);
    const entry = shapePaint.overlays.get('svg_1');
    expect(entry).toBeDefined();
    const { overlay } = entry!;
    expect(overlay.cols).toBe(4 * OVERLAY_TEXELS_PER_CELL);
    expect(overlay.rows).toBe(3 * OVERLAY_TEXELS_PER_CELL);
    // Texel (8, 6), center (2.125, 1.625): inside the disc, blue exactly.
    const i = (6 * overlay.cols + 8) * 4;
    expect([overlay.rgba[i], overlay.rgba[i + 1], overlay.rgba[i + 2]]).toEqual([0, 0, 255]);
    expect(overlay.rgba[i + 3]).toBeGreaterThan(0);
    // The shape's fill itself is untouched — the layer sits above it.
    expect(state.svgObjects[0].fill!.solid).toEqual(RED);
  });

  it('paints the layer over a gradient fill — a gradient is still a fill', () => {
    const gradient = stamp(
      stateWith([svg('svg_1', { fill: solidFill(RED, { type: 'linear' }) })]),
      RED, 'normal', 1, [2, 1.5],
    );
    expect(gradient.shapePaint.overlays.has('svg_1')).toBe(true);
  });

  it('skips a fillABLE shape that is not currently filled', () => {
    // An unfilled rectangle is four lines with the page showing through, so
    // the brush passing over its middle has nothing to paint there — and
    // the ink it used to leave was invisible until the shape was filled
    // later, when the old strokes would reappear out of nowhere. Its
    // OUTLINE still takes ink, through the segment pass.
    const unfilled = stamp(stateWith([svg('svg_1')]), RED, 'normal', 1, [2, 1.5]);
    expect(unfilled.shapePaint.overlays.has('svg_1')).toBe(false);
    // Filling it hands the interior back.
    const filled = stamp(
      stateWith([svg('svg_1', { fill: solidFill(RED) })]), RED, 'normal', 1, [2, 1.5],
    );
    expect(filled.shapePaint.overlays.has('svg_1')).toBe(true);
    // And the unfilled shape's outline is still paintable — brushing the
    // edge recolours its segments, exactly as an open path's.
    const edge = stamp(stateWith([svg('svg_1')]), RED, 'normal', 1, [2, 0]);
    expect(edge.draft.paintedSegments.size).toBeGreaterThan(0);
  });

  it('leaves open paths and legacy fillColor shapes without a bitmap layer', () => {
    // An open path is not a fill-bar shape; a legacy fillColor rect keeps
    // Facet's whole-fill blend (paintedFills) instead of taking a layer.
    const open = stamp(
      stateWith([{ ...svg('svg_1'), segments: [line([0, 0], [4, 0])] }]),
      RED, 'normal', 1, [2, 0],
    );
    expect(open.shapePaint.overlays.size).toBe(0);
    const legacy = stamp(
      stateWith([svg('svg_1', { fillColor: RED })]), GRAY, 'multiply', 1, [2, 0],
    );
    expect(legacy.shapePaint.overlays.size).toBe(0);
    expect(legacy.draft.paintedFills.get('svg_1')).toBeDefined();
  });
});

// A FILL subpath (figure-bake painted cells, filled merges) renders as one
// closed drawing in one color; the brush treats it like a legacy fillColor —
// touched as a unit (segment hit OR dab center inside the loop), colored as
// a unit with no per-segment falloff. Before this, per-segment recolors on a
// fill's boundary split it into stroke runs at commit and hollowed the fill.
describe('stampPaintBrush on fill subpaths', () => {
  const BLUE: RGBColor = { r: 0, g: 0, b: 255 };
  const rect = [
    line([0, 0], [4, 0]), line([4, 0], [4, 3]), line([4, 3], [0, 3]), line([0, 3], [0, 0]),
  ];
  const tail = [line([4, 3], [8, 6])];

  function mergedSvg(id = 'svg_m'): SVGObject {
    return svg(id, {
      segments: [...rect, ...tail],
      cellWidth: 8, cellHeight: 6,
      subpaths: [
        { segments: rect, color: BLUE, fill: true },
        { segments: tail, color: BLACK },
      ],
    });
  }

  it('a dab on the fill’s boundary colors every one of its indices uniformly', () => {
    const state = stateWith([mergedSvg()]);
    const { draft, changed } = stamp(state, RED, 'normal', 1, [2, 0]);
    expect(changed).toBe(true);
    const bucket = draft.paintedSegments.get('svg_m')!;
    // All four rect indices carry the SAME color — full strength, no falloff.
    for (let i = 0; i < 4; i++) expect(bucket.get(i)).toEqual(RED);
    // The stroke tail was out of reach and stays untouched.
    expect(bucket.has(4)).toBe(false);
  });

  it('a dab INSIDE the fill colors it too — no boundary hit needed', () => {
    const state = stateWith([mergedSvg()]);
    // Rectangle interior, 1.5 cells from the nearest edge, radius 1.
    const { draft, changed } = stamp(state, GRAY, 'multiply', 1, [2, 1.5]);
    expect(changed).toBe(true);
    const bucket = draft.paintedSegments.get('svg_m')!;
    expect(bucket.get(0)).toEqual(blendColor(BLUE, GRAY, 'multiply', 0.125));
    expect(bucket.get(0)).toEqual(bucket.get(3));
  });

  it('a dab on the stroke half recolors per segment and leaves the fill alone', () => {
    const state = stateWith([mergedSvg()]);
    const { draft } = stamp(state, RED, 'normal', 1, [6, 4.5]);
    const bucket = draft.paintedSegments.get('svg_m')!;
    expect(bucket.get(4)).toEqual(RED);
    for (let i = 0; i < 4; i++) expect(bucket.has(i)).toBe(false);
  });

  it('blur leaves a fill subpath alone — one color has nothing to soften', () => {
    const state = stateWith([mergedSvg()]);
    const { changed } = stamp(state, RED, 'normal', 1, [2, 0], { kind: 'blur' });
    expect(changed).toBe(false);
  });

  it('a unary mode gets one go at the fill per stroke', () => {
    const state = stateWith([mergedSvg()]);
    const draft = createPaintStrokeDraft(RED, 'invert', 1);
    const textPaint = createTextPaintState();
    const imagePaint = createOverlayPaintState();
    const shapePaint = createOverlayPaintState();
    stampPaintBrush(state, draft, textPaint, imagePaint, shapePaint, 2, 0, 1, null, new Set());
    const once = draft.paintedSegments.get('svg_m')!.get(0);
    stampPaintBrush(state, draft, textPaint, imagePaint, shapePaint, 2, 0, 1, null, new Set());
    expect(draft.paintedSegments.get('svg_m')!.get(0)).toEqual(once);
  });

  it('the commit keeps the fill filled, whole, and in the painted color', () => {
    const state = stateWith([mergedSvg()]);
    const { draft } = stamp(state, RED, 'normal', 1, [2, 1.5]);
    const se = buildPaintStroke(state, draft)!;
    const after = applyCompOps(state, se.entry).svgObjects[0];
    expect(after.subpaths).toHaveLength(2);
    expect(after.subpaths![0]).toMatchObject({ color: RED, fill: true });
    expect(after.subpaths![0].segments).toHaveLength(4);
    expect(after.subpaths![1]).toMatchObject({ color: BLACK });
  });
});

describe('buildPaintStroke', () => {
  it('commits painted segments as one recolorSVG entry that applies and reverts cleanly', () => {
    const state = stateWith([svg('svg_1')]);
    const { draft } = stamp(state, RED, 'normal', 1, [2, 0]);
    const se = buildPaintStroke(state, draft);
    expect(se).not.toBeNull();
    expect(se!.entry).toHaveLength(1);
    expect(se!.entry[0]).toMatchObject({ op: 'recolorSVG', svgId: 'svg_1' });

    const applied = applyCompOps(state, se!.entry);
    const paintedSvg = applied.svgObjects[0];
    // One red segment + three black → a 2-group subpath split, red primary.
    expect(paintedSvg.color).toEqual(RED);
    expect(paintedSvg.subpaths).toHaveLength(2);
    expect(paintedSvg.subpaths![0].color).toEqual(RED);
    expect(paintedSvg.subpaths![0].segments).toHaveLength(1);
    expect(paintedSvg.subpaths![1].color).toEqual(BLACK);
    expect(paintedSvg.subpaths![1].segments).toHaveLength(3);

    const reverted = revertCompOps(applied, se!.entry);
    expect(reverted.svgObjects[0].color).toEqual(BLACK);
    expect(reverted.svgObjects[0].subpaths).toBeUndefined();
  });

  it('lands brushed shape layers through a trailing replaceScene op, after the recolor', () => {
    const blue: RGBColor = { r: 0, g: 0, b: 255 };
    // One dab across two objects that overlap along the top edge: the plain
    // path takes the SEGMENT recolor, the filled shape takes the bitmap
    // LAYER (see the fill-over-stroke rule below). That pairing is what
    // makes both ops land in one entry.
    const state = stateWith([
      svg('svg_line'),
      svg('svg_1', { fill: solidFill(RED) }),
    ]);
    const { draft, shapePaint } = stamp(state, blue, 'normal', 1, [2, 0]);
    const overlays = new Map([['svg_1', shapePaint.overlays.get('svg_1')!.overlay]]);
    const se = buildPaintStroke(state, draft, undefined, undefined, overlays);
    expect(se!.entry.map((o) => o.op)).toEqual(['recolorSVG', 'replaceScene']);

    const applied = applyCompOps(state, se!.entry);
    const filled = applied.svgObjects.find((o) => o.id === 'svg_1')!;
    const plain = applied.svgObjects.find((o) => o.id === 'svg_line')!;
    // The layer landed WITHOUT undoing the same stroke's segment recolor.
    expect(filled.paintOverlay).toBe(overlays.get('svg_1'));
    expect(plain.subpaths).toHaveLength(2);
    expect(filled.fill?.solid).toEqual(RED);

    const reverted = revertCompOps(applied, se!.entry);
    expect(reverted.svgObjects.find((o) => o.id === 'svg_1')!.paintOverlay).toBeUndefined();
    expect(reverted.svgObjects.find((o) => o.id === 'svg_line')!.color).toEqual(BLACK);
  });

  // Painting a filled rectangle means colouring the rectangle. Recolouring
  // its border as well would restyle a part of the object the brush was
  // never aimed at, so the outline is the target only when there is no fill
  // to take the paint.
  describe('a shape with a fill takes the brush on the fill, not the outline', () => {
    it('leaves a filled shape\u2019s segments alone and paints its layer', () => {
      const state = stateWith([svg('svg_1', { fill: solidFill(RED) })]);
      const { draft, shapePaint } = stamp(state, GRAY, 'normal', 1, [2, 0]);
      expect(draft.paintedSegments.get('svg_1')?.size ?? 0).toBe(0);
      expect(shapePaint.overlays.has('svg_1')).toBe(true);
    });

    it('recolours the outline of a shape with no fill set', () => {
      const state = stateWith([svg('svg_1')]);
      const { draft } = stamp(state, GRAY, 'normal', 1, [2, 0]);
      expect(draft.paintedSegments.get('svg_1')?.size).toBe(1);
    });

    it('recolours an OPEN path, which has no fill to take the paint', () => {
      const open = svg('svg_open', { segments: [line([0, 0], [4, 0])] });
      const { draft, shapePaint } = stamp(stateWith([open]), GRAY, 'normal', 1, [2, 0]);
      expect(draft.paintedSegments.get('svg_open')?.size).toBe(1);
      // …and no interior layer either: only the fill-bar subtypes carry one.
      expect(shapePaint.overlays.has('svg_open')).toBe(false);
    });

    it('counts a legacy fillColor as a fill: the fill blends, the outline holds', () => {
      const state = stateWith([svg('svg_1', { fillColor: RED })]);
      const { draft } = stamp(state, GRAY, 'normal', 1, [2, 0]);
      expect(draft.paintedSegments.get('svg_1')?.size ?? 0).toBe(0);
      // The whole-object fill still blends — it is gated on touching the
      // outline (Facet's rule), which is why the hits still matter.
      expect(draft.paintedFills.get('svg_1')).toBeDefined();
    });

    it('applies to the blur brush too', () => {
      const state = stateWith([svg('svg_1', { fill: solidFill(RED) })]);
      const { draft } = stamp(state, GRAY, 'normal', 1, [2, 0], { kind: 'blur', radius: 4 });
      expect(draft.paintedSegments.get('svg_1')?.size ?? 0).toBe(0);
    });
  });

  it('returns null for a stroke that changed nothing', () => {
    const state = stateWith([svg('svg_1')]);
    const draft = createPaintStrokeDraft(RED, 'normal', 1);
    expect(buildPaintStroke(state, draft)).toBeNull();
  });
});

// A "hi" text node at the origin. Under the deterministic default measurer
// (no font pack in node tests) at size 2: 'h' advance 1.2 → box x∈[0,1.2),
// 'i' advance 0.7 → box x∈[1.2,1.9), both spanning one 2.4-cell line box.
function textNode(extras: Partial<TextObject> = {}): TextObject {
  return {
    id: 'txt_1',
    content: 'hi',
    style: { fontId: 'system', size: 2, color: BLACK },
    cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 2.4,
    ...extras,
  };
}

function stateWithTexts(texts: TextObject[]): CompositionState {
  const base = makeBlankComposition('comp_test');
  return { ...base, texts, sceneOrder: texts.map((t) => t.id) };
}

describe('stampPaintBrush on text', () => {
  it('paints only the characters under the brush, dead-on hits at the brush color', () => {
    const state = stateWithTexts([textNode()]);
    // Inside the 'h' box: distance 0 → the brush color exactly. The 'i' box
    // starts 1.0 away (≥ radius) → falloff 0 → untouched.
    const { textPaint, changed } = stamp(state, RED, 'normal', 1, [0.2, 1]);
    expect(changed).toBe(true);
    const chars = textPaint.chars.get('txt_1');
    expect(chars?.get(0)).toEqual(RED);
    expect(chars?.has(1)).toBe(false);
  });

  it('applies the gaussian falloff by distance to the nearest point of the char box', () => {
    const state = stateWithTexts([textNode()]);
    // 0.5 above the line box: nearest point of 'h' is (0.2, 0), tSq = 0.25.
    const { textPaint } = stamp(state, RED, 'normal', 1, [0.2, -0.5]);
    const expected = blendColor(BLACK, RED, 'normal', gaussianFalloff(0.25));
    expect(textPaint.chars.get('txt_1')?.get(0)).toEqual(expected);
  });

  it('blends from a character\'s existing brush color, not the base font color', () => {
    const blue: RGBColor = { r: 0, g: 0, b: 255 };
    const state = stateWithTexts([textNode({
      style: { fontId: 'system', size: 2, color: BLACK, charColors: [blue] },
    })]);
    const { textPaint } = stamp(state, GRAY, 'multiply', 1, [0.2, 1]);
    expect(textPaint.chars.get('txt_1')?.get(0)).toEqual(blendColor(blue, GRAY, 'multiply', 0.125));
  });

  it('maps the brush through the node transform (mirrorH hits the mirrored glyph)', () => {
    // Bbox hugs the layout (width 1.9): mirrored, 'h' renders on the RIGHT.
    const state = stateWithTexts([textNode({ cellWidth: 1.9, mirrorH: true })]);
    const { textPaint } = stamp(state, RED, 'normal', 1, [1.7, 1]);
    const chars = textPaint.chars.get('txt_1');
    expect(chars?.get(0)).toEqual(RED); // 'h', at layout x 0.2 pre-mirror
    expect(chars?.has(1)).toBe(false);
  });

  it('never paints stickers, locked, filtered-out, or skip-listed text', () => {
    const at: [number, number] = [0.2, 1];
    expect(stamp(stateWithTexts([textNode({ sticker: true })]), RED, 'normal', 1, at).changed).toBe(false);
    expect(stamp(stateWithTexts([textNode({ locked: true })]), RED, 'normal', 1, at).changed).toBe(false);
    expect(stamp(
      stateWithTexts([textNode()]), RED, 'normal', 1, at, { filter: new Set(['txt_other']) },
    ).changed).toBe(false);
    expect(stamp(
      stateWithTexts([textNode()]), RED, 'normal', 1, at, { skip: new Set(['txt_1']) },
    ).changed).toBe(false);
  });

  it('applies unary modes once per stroke per character', () => {
    const state = stateWithTexts([textNode({ style: { fontId: 'system', size: 2, color: RED } })]);
    const draft = createPaintStrokeDraft(RED, 'invert', 1);
    const textPaint = createTextPaintState();
    stampPaintBrush(state, draft, textPaint, createOverlayPaintState(), createOverlayPaintState(), 0.2, 1, 1, null, new Set());
    const once = textPaint.chars.get('txt_1')?.get(0);
    expect(once).toEqual(blendColor(RED, RED, 'invert', 1));
    stampPaintBrush(state, draft, textPaint, createOverlayPaintState(), createOverlayPaintState(), 0.2, 1, 1, null, new Set());
    expect(textPaint.chars.get('txt_1')?.get(0)).toEqual(once);
  });

  it('commits as a setTextStyle op that applies and reverts cleanly', () => {
    const state = stateWithTexts([textNode()]);
    const { draft, textPaint } = stamp(state, RED, 'normal', 1, [0.2, 1]);
    const se = buildPaintStroke(state, draft, textPaint.chars);
    expect(se).not.toBeNull();
    expect(se!.entry.map((o) => o.op)).toEqual(['setTextStyle']);

    const applied = applyCompOps(state, se!.entry);
    const style = applied.texts![0].style;
    expect(style.charColors?.[0]).toEqual(RED);
    expect(style.charColors?.[1]).toBeNull(); // 'i' untouched → inherits
    expect(style.color).toEqual(BLACK); // base font color untouched

    const reverted = revertCompOps(applied, se!.entry);
    expect(reverted.texts![0].style.charColors).toBeUndefined();
  });

  it('returns null when the brush lands back on the characters\' current colors', () => {
    const state = stateWithTexts([textNode({ style: { fontId: 'system', size: 2, color: RED } })]);
    const { draft, textPaint } = stamp(state, RED, 'normal', 1, [0.2, 1]);
    expect(textPaint.chars.get('txt_1')?.size).toBeGreaterThan(0);
    expect(buildPaintStroke(state, draft, textPaint.chars)).toBeNull();
  });
});

describe('previewCharColors (the stroke\u2019s brushwork as the live preview\u2019s charColors)', () => {
  it('lists every touched character at its stroke colour and every other one null', () => {
    const text = textNode({ content: 'hello' });
    const painted = new Map<number, RGBColor | null>([[1, RED], [4, GRAY]]);
    expect(previewCharColors(text, painted)).toEqual([null, RED, null, null, GRAY]);
  });

  it("previews the eraser's mark at the node colour — what the commit renders once the override is dropped", () => {
    const text = textNode({ content: 'hi', style: { fontId: 'system', size: 2, color: RED, charColors: [GRAY, GRAY] } });
    expect(previewCharColors(text, new Map([[0, null]]))).toEqual([RED, null]);
  });

  it('counts code points, not UTF-16 units, and ignores indices past the content', () => {
    const text = textNode({ content: 'a\u{1F600}b' }); // 3 code points, 4 UTF-16 units
    const painted = new Map<number, RGBColor | null>([[2, RED], [3, GRAY], [-1, GRAY]]);
    expect(previewCharColors(text, painted)).toEqual([null, null, RED]);
  });
});

// An 8×6-cell image at the origin: overlay grid 32×24 (4 texels per cell).
function imageNode(extras: Partial<ImageObject> = {}): ImageObject {
  return {
    id: 'img_1',
    imageId: 'blob1',
    mimeType: 'image/png',
    pixelWidth: 4, pixelHeight: 4,
    cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 6,
    ...extras,
  };
}

function stateWithImages(images: ImageObject[]): CompositionState {
  const base = makeBlankComposition('comp_test');
  return { ...base, images, sceneOrder: images.map((i) => i.id) };
}

describe('stampPaintBrush on images', () => {
  const texel = (cols: number, c: number, r: number) => (r * cols + c) * 4;

  it('paints the brush color into overlay texels under the disc, transparent elsewhere', () => {
    const state = stateWithImages([imageNode()]);
    const { imagePaint, changed } = stamp(state, RED, 'normal', 1, [4, 3]);
    expect(changed).toBe(true);
    const entry = imagePaint.overlays.get('img_1');
    expect(entry).toBeDefined();
    const { overlay } = entry!;
    expect(overlay.cols).toBe(8 * OVERLAY_TEXELS_PER_CELL);
    expect(overlay.rows).toBe(6 * OVERLAY_TEXELS_PER_CELL);
    expect(overlay.blend).toBe('normal');
    // Texel (16, 12), center (4.125, 3.125): inside the disc. Source-over on
    // transparent leaves the brush color exactly; alpha follows the falloff.
    const i = texel(overlay.cols, 16, 12);
    expect([overlay.rgba[i], overlay.rgba[i + 1], overlay.rgba[i + 2]]).toEqual([255, 0, 0]);
    expect(overlay.rgba[i + 3]).toBeGreaterThan(0);
    // The far corner is well outside the 1-cell radius — untouched.
    expect(overlay.rgba[3]).toBe(0);
    expect(entry!.rev).toBeGreaterThan(0);
  });

  it('accumulates alpha across repeat stamps', () => {
    const state = stateWithImages([imageNode()]);
    const draft = createPaintStrokeDraft(RED, 'normal', 0.5);
    const imagePaint = createOverlayPaintState();
    stampPaintBrush(state, draft, createTextPaintState(), imagePaint, createOverlayPaintState(), 4, 3, 1, null, new Set());
    const overlay = imagePaint.overlays.get('img_1')!.overlay;
    const i = (12 * overlay.cols + 16) * 4;
    const once = overlay.rgba[i + 3];
    stampPaintBrush(state, draft, createTextPaintState(), imagePaint, createOverlayPaintState(), 4, 3, 1, null, new Set());
    expect(overlay.rgba[i + 3]).toBeGreaterThan(once);
  });

  it('a stroke in a new blend mode re-modes the whole layer', () => {
    const state = stateWithImages([imageNode()]);
    const first = stamp(state, RED, 'multiply', 1, [4, 3]);
    const withOverlay = {
      ...state,
      images: [{ ...state.images![0], paintOverlay: first.imagePaint.overlays.get('img_1')!.overlay }],
    };
    const second = stamp(withOverlay, GRAY, 'normal', 1, [4, 3]);
    expect(second.imagePaint.overlays.get('img_1')!.overlay.blend).toBe('normal');
  });

  it('unary modes, locked images, the skip set and the filter all leave images alone', () => {
    const at: [number, number] = [4, 3];
    expect(stamp(stateWithImages([imageNode()]), RED, 'invert', 1, at).changed).toBe(false);
    expect(stamp(stateWithImages([imageNode({ locked: true })]), RED, 'normal', 1, at).changed).toBe(false);
    expect(stamp(
      stateWithImages([imageNode()]), RED, 'normal', 1, at, { skip: new Set(['img_1']) },
    ).changed).toBe(false);
    expect(stamp(
      stateWithImages([imageNode()]), RED, 'normal', 1, at, { filter: new Set(['img_other']) },
    ).changed).toBe(false);
  });

  it('commits as a replaceScene op that applies and reverts cleanly', () => {
    const state = stateWithImages([imageNode()]);
    const { draft, textPaint, imagePaint } = stamp(state, RED, 'normal', 1, [4, 3]);
    const overlays = new Map([['img_1', imagePaint.overlays.get('img_1')!.overlay]]);
    const se = buildPaintStroke(state, draft, textPaint.chars, overlays);
    expect(se).not.toBeNull();
    expect(se!.entry.map((o) => o.op)).toEqual(['replaceScene']);

    const applied = applyCompOps(state, se!.entry);
    expect(applied.images![0].paintOverlay).toBe(overlays.get('img_1'));

    const reverted = revertCompOps(applied, se!.entry);
    expect(reverted.images![0].paintOverlay).toBeUndefined();
  });
});

describe('erase brush', () => {
  it('lifts alpha out of a committed image overlay, on a working clone', () => {
    const overlay = createImagePaintOverlay(8, 6, 'normal');
    stampImagePaintOverlay(overlay, 8, 6, 4.125, 3.125, 1, RED, 1);
    const state = stateWithImages([imageNode({ paintOverlay: overlay })]);
    const { imagePaint, changed } = stamp(state, RED, 'normal', 1, [4.125, 3.125], { kind: 'erase' });
    expect(changed).toBe(true);
    const working = imagePaint.overlays.get('img_1')!.overlay;
    // Dead-center texel: falloff 1 at strength 1 → fully erased.
    const i = (12 * working.cols + 16) * 4;
    expect(working.rgba[i + 3]).toBe(0);
    // The committed layer is untouched (undo entries reference it).
    expect(overlay.rgba[i + 3]).toBe(255);
    // Blend survives the erase — the eraser never re-modes a layer.
    expect(working.blend).toBe('normal');
  });

  it('erase strength follows the picker opacity slider', () => {
    const overlay = createImagePaintOverlay(8, 6, 'normal');
    stampImagePaintOverlay(overlay, 8, 6, 4.125, 3.125, 1, RED, 1);
    const state = stateWithImages([imageNode({ paintOverlay: overlay })]);
    const { imagePaint } = stamp(state, RED, 'normal', 0.5, [4.125, 3.125], { kind: 'erase' });
    const working = imagePaint.overlays.get('img_1')!.overlay;
    const i = (12 * working.cols + 16) * 4;
    expect(working.rgba[i + 3]).toBe(Math.round(255 * 0.5));
  });

  it('does nothing to an image that carries no paint layer', () => {
    const { imagePaint, changed } = stamp(
      stateWithImages([imageNode()]), RED, 'normal', 1, [4, 3], { kind: 'erase' },
    );
    expect(changed).toBe(false);
    expect(imagePaint.overlays.size).toBe(0);
  });

  it('leaves vector strokes and legacy fills alone — their colors are permanent', () => {
    const { draft, changed } = stamp(
      stateWith([svg('svg_1', { fillColor: RED })]), RED, 'normal', 1, [2, 0], { kind: 'erase' },
    );
    expect(changed).toBe(false);
    expect(draft.paintedSegments.size).toBe(0);
    expect(draft.paintedFills.size).toBe(0);
  });

  it('clears a brushed character back to the node color, skipping untinted ones', () => {
    const blue: RGBColor = { r: 0, g: 0, b: 255 };
    const state = stateWithTexts([textNode({
      style: { fontId: 'system', size: 2, color: BLACK, charColors: [blue] },
    })]);
    const { textPaint, changed } = stamp(state, RED, 'normal', 1, [0.2, 1], { kind: 'erase' });
    expect(changed).toBe(true);
    expect(textPaint.chars.get('txt_1')?.get(0)).toBeNull();

    const untinted = stamp(stateWithTexts([textNode()]), RED, 'normal', 1, [0.2, 1], { kind: 'erase' });
    expect(untinted.changed).toBe(false);
  });

  it('commits cleared tints as dropped charColors and an emptied layer as NO layer', () => {
    const blue: RGBColor = { r: 0, g: 0, b: 255 };
    const overlay = createImagePaintOverlay(8, 6, 'normal');
    stampImagePaintOverlay(overlay, 8, 6, 4.125, 3.125, 1, RED, 1);
    const base = makeBlankComposition('comp_test');
    const state: CompositionState = {
      ...base,
      texts: [textNode({ style: { fontId: 'system', size: 2, color: BLACK, charColors: [blue] } })],
      images: [imageNode({ paintOverlay: overlay })],
      sceneOrder: ['txt_1', 'img_1'],
    };
    const draft = createPaintStrokeDraft(RED, 'normal', 1);
    const chars = new Map([['txt_1', new Map<number, RGBColor | null>([[0, null]])]]);
    const emptied = createImagePaintOverlay(8, 6, 'normal'); // all alpha 0
    const se = buildPaintStroke(state, draft, chars, new Map([['img_1', emptied]]));
    expect(se).not.toBeNull();

    const applied = applyCompOps(state, se!.entry);
    expect(applied.texts![0].style.charColors).toBeUndefined();
    expect(applied.images![0].paintOverlay).toBeUndefined();

    const reverted = revertCompOps(applied, se!.entry);
    expect(reverted.texts![0].style.charColors).toEqual([blue]);
    expect(reverted.images![0].paintOverlay).toBe(overlay);
  });
});

describe('blur brush', () => {
  it("softens an object's touched segments toward that object's own average", () => {
    // Two parallel subpath lines, red and blue, 0.5 above/below the brush
    // center: equal falloff, so the local average is their midpoint.
    const state = stateWith([svg('svg_1', {
      subpaths: [
        { segments: [line([0, 0], [4, 0])], color: RED },
        { segments: [line([0, 1], [4, 1])], color: { r: 0, g: 0, b: 255 } },
      ],
    })]);
    const { draft, changed } = stamp(state, BLACK, 'normal', 1, [2, 0.5], { kind: 'blur' });
    expect(changed).toBe(true);
    const w = gaussianFalloff(0.25);
    const avg = { r: 127.5, g: 0, b: 127.5 };
    const bucket = draft.paintedSegments.get('svg_1')!;
    expect(bucket.get(0)).toEqual(blendColor(RED, avg, 'normal', w));
    expect(bucket.get(1)).toEqual(blendColor({ r: 0, g: 0, b: 255 }, avg, 'normal', w));
  });

  it("never mixes colors ACROSS objects — a neighbor under the same cursor stays distinct", () => {
    // Two separate single-color objects both inside the disc: each object's
    // local average is its own color, so nothing moves — blur is per object,
    // and one object's border can't tint another's.
    const a = svg('svg_1', { color: RED });
    const b: SVGObject = {
      id: 'svg_2',
      segments: [line([0, 0.5], [4, 0.5])],
      color: { r: 0, g: 0, b: 255 },
      cellX: 0, cellY: 0.5, cellWidth: 4, cellHeight: 0,
    };
    const { draft, changed } = stamp(stateWith([a, b]), BLACK, 'normal', 1, [2, 0.25], { kind: 'blur' });
    expect(changed).toBe(false);
    expect(draft.paintedSegments.get('svg_1')?.size ?? 0).toBe(0);
    expect(draft.paintedSegments.get('svg_2')?.size ?? 0).toBe(0);
  });

  it('box-blurs a committed image paint layer in place, on a working clone', () => {
    const overlay = createImagePaintOverlay(8, 6, 'multiply');
    stampImagePaintOverlay(overlay, 8, 6, 4.125, 3.125, 1, RED, 1);
    const state = stateWithImages([imageNode({ paintOverlay: overlay })]);
    const { imagePaint, changed } = stamp(state, BLACK, 'normal', 1, [4.125, 3.125], { kind: 'blur' });
    expect(changed).toBe(true);
    const working = imagePaint.overlays.get('img_1')!.overlay;
    // The dab's peak softens toward its (partly fainter) neighborhood…
    const i = (12 * working.cols + 16) * 4;
    expect(working.rgba[i + 3]).toBeLessThan(255);
    expect(working.rgba[i + 3]).toBeGreaterThan(0);
    // …its color stays red (alpha-weighted average of an all-red patch)…
    expect([working.rgba[i], working.rgba[i + 1], working.rgba[i + 2]]).toEqual([255, 0, 0]);
    // …and the committed layer + its blend mode are untouched.
    expect(overlay.rgba[i + 3]).toBe(255);
    expect(working.blend).toBe('multiply');
  });

  it('feathers a dab edge outward with the dab color, not transparent black', () => {
    const overlay = createImagePaintOverlay(8, 6, 'normal');
    stampImagePaintOverlay(overlay, 8, 6, 4.125, 3.125, 1, RED, 1);
    const state = stateWithImages([imageNode({ paintOverlay: overlay })]);
    // Blur centered just past the dab edge: texel (20, 12) had alpha 0 but
    // an inked neighbor, so it gains red cover.
    const { imagePaint } = stamp(state, BLACK, 'normal', 1, [5.125, 3.125], { kind: 'blur' });
    const working = imagePaint.overlays.get('img_1')!.overlay;
    const j = (12 * working.cols + 20) * 4;
    expect(overlay.rgba[j + 3]).toBe(0);
    expect(working.rgba[j + 3]).toBeGreaterThan(0);
    expect([working.rgba[j], working.rgba[j + 1], working.rgba[j + 2]]).toEqual([255, 0, 0]);
  });

  it('does nothing to a node that carries no paint layer — there is nothing to blur', () => {
    const { imagePaint, changed } = stamp(
      stateWithImages([imageNode()]), RED, 'normal', 1, [4, 3], { kind: 'blur' },
    );
    expect(changed).toBe(false);
    expect(imagePaint.overlays.size).toBe(0);
  });

  it("softens touched characters toward that text's own average", () => {
    const blue: RGBColor = { r: 0, g: 0, b: 255 };
    const state = stateWithTexts([textNode({
      style: { fontId: 'system', size: 2, color: BLACK, charColors: [RED, blue] },
    })]);
    // On the h/i seam: both boxes at distance 0 -> equal weight, average is
    // the midpoint, and full falloff blends each char all the way to it.
    const { textPaint, changed } = stamp(state, BLACK, 'normal', 1, [1.2, 1], { kind: 'blur' });
    expect(changed).toBe(true);
    const avg = { r: 127.5, g: 0, b: 127.5 };
    const chars = textPaint.chars.get('txt_1')!;
    expect(chars.get(0)).toEqual(blendColor(RED, avg, 'normal', 1));
    expect(chars.get(1)).toEqual(blendColor(blue, avg, 'normal', 1));
  });

  it('a single character under the cursor has nothing to blur against', () => {
    // Only 'h' is in reach ('i' sits exactly one radius away, falloff 0).
    const { changed } = stamp(
      stateWithTexts([textNode()]), BLACK, 'normal', 1, [0.2, 1], { kind: 'blur' },
    );
    expect(changed).toBe(false);
  });

  it('leaves legacy fillColor shapes alone', () => {
    const { draft, changed } = stamp(
      stateWith([svg('svg_1', { fillColor: RED })]), BLACK, 'normal', 1, [2, 0], { kind: 'blur' },
    );
    expect(changed).toBe(false);
    expect(draft.paintedFills.size).toBe(0);
  });
});

describe('font color over brushwork', () => {
  it('buildApplyColor on a text replaces charColors with one solid color', () => {
    const blue: RGBColor = { r: 0, g: 0, b: 255 };
    const state = stateWithTexts([textNode({
      style: { fontId: 'system', size: 2, color: BLACK, charColors: [RED, blue] },
    })]);
    const se = buildApplyColor(state, 'txt_1', GRAY);
    expect(se).not.toBeNull();
    const applied = applyCompOps(state, se!.entry);
    expect(applied.texts![0].style.color).toEqual(GRAY);
    expect(applied.texts![0].style.charColors).toBeUndefined();
    // Undo brings the brushwork back.
    const reverted = revertCompOps(applied, se!.entry);
    expect(reverted.texts![0].style.charColors).toEqual([RED, blue]);
  });
});

describe('helpers', () => {
  it('paintFilterIds mirrors the selection', () => {
    expect(paintFilterIds(null, [])).toBeNull();
    expect(paintFilterIds('svg_1', [])).toEqual(new Set(['svg_1']));
    expect(paintFilterIds(null, ['a', 'b'])).toEqual(new Set(['a', 'b']));
  });

  it('brushDimsToSelection is exactly the color group — the tools the filter narrows', () => {
    for (const tool of ['color', 'paint', 'erase', 'blur', 'push'] as const) {
      expect(brushDimsToSelection(tool)).toBe(true);
    }
    // Placement / creation tools have no object filter to make visible.
    for (const tool of ['arrange', 'draw', 'text', 'photos', 'pattern', 'tile', 'word', null] as const) {
      expect(brushDimsToSelection(tool)).toBe(false);
    }
  });

  it('paintHiddenIds collects hidden objects, texts and images included', () => {
    const state = {
      ...stateWith([svg('svg_1', { hidden: true }), svg('svg_2')]),
      texts: [textNode({ hidden: true }), textNode({ id: 'txt_2' })],
      images: [imageNode({ hidden: true }), imageNode({ id: 'img_2' })],
    };
    expect(paintHiddenIds(state)).toEqual(new Set(['svg_1', 'txt_1', 'img_1']));
  });

});

/**
 * STRENGTH is a rate, not a first-dab weight.
 *
 * A dab blends toward the brush's colour, so a stroke's progress is
 * geometric — at hand h, `dabs` dabs land 1 − (1 − h)^dabs. Handing the
 * slider's value straight to that made every setting but the very lowest
 * read the same: at 0.5 a shape was 94% recoloured four dabs in, which is
 * a quarter of a brush width of travel. The curve (dabHand) spends the
 * working range at a soft hand and climbs to full only at the very top.
 */
describe('the brush\u2019s hand: how much one dab carries', () => {
  /** Dabs to move a fraction `f` of the way at hand `h`. */
  const dabsFor = (h: number, f = 0.5) => Math.log(1 - f) / Math.log(1 - h);

  it('lands the colour outright ONLY at the top of the slider', () => {
    expect(dabHand(1)).toBe(1);
    // …and steps back sharply from there: a hair off the top is already a
    // hand you can watch build.
    expect(dabHand(0.9)).toBeLessThan(0.75);
    expect(dabHand(0.5)).toBeLessThan(0.25);
  });

  it('halving the strength doubles the travel for the same change', () => {
    // The slider's promise: 0.5 takes twice as long as 1.0 would at the
    // same rate, 0.25 twice as long again. Geometric progress makes this
    // approximate near the ends, so the ratios are checked loosely.
    for (const [hi, lo] of [[0.5, 0.25], [0.25, 0.125], [0.4, 0.2]]) {
      const ratio = dabsFor(dabHand(lo)) / dabsFor(dabHand(hi));
      expect(ratio).toBeGreaterThan(1.7);
      expect(ratio).toBeLessThan(2.6);
    }
  });

  it('rises with the value and never leaves 0…1', () => {
    let prev = -1;
    for (let v = 0; v <= 1.0001; v += 0.05) {
      const h = dabHand(v);
      expect(h).toBeGreaterThan(prev);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(1);
      prev = h;
    }
    // Out-of-range values are clamped rather than extrapolated.
    expect(dabHand(-1)).toBe(0);
    expect(dabHand(2)).toBe(1);
  });

  it('is what a dab actually blends at — a mid-slider pass builds up', () => {
    const state = stateWith([svg('svg_1')]);
    // One dab at half strength moves a black line a FIFTH of the way to
    // red, not half of it…
    const { draft } = stamp(state, RED, 'normal', 0.5, [2, 0]);
    const seg = draft.paintedSegments.get('svg_1')!.get(0)!;
    expect(seg).toEqual(blendColor(BLACK, RED, 'normal', dabHand(0.5)));
    expect(seg.r).toBeLessThan(RED.r / 3);
    // …while the top of the slider still lands it in one.
    const full = stamp(state, RED, 'normal', 1, [2, 0]);
    expect(full.draft.paintedSegments.get('svg_1')!.get(0)).toEqual(RED);
  });

  it('opens half-way up, so the default hand is one you can watch', () => {
    expect(DEFAULT_BRUSH_STRENGTH).toBe(0.5);
    expect(DEFAULT_BRUSH_STRENGTH).toBeLessThan(1);
  });
});

describe('the random stroke walks between colours', () => {
  /** A deterministic stand-in for Math.random, cycling a fixed sequence.
   *  Values stay in [0, 1) — the contract Math.random keeps. */
  const seeded = (values: number[]) => {
    let i = 0;
    return () => values[i++ % values.length];
  };
  const SEED = [0, 0.5, 0.99, 0.25, 0.5, 0.75];
  const START = { r: 0, g: 128, b: 253 };
  const TARGET = { r: 64, g: 128, b: 192 };

  it('opens on a random colour and heads for another', () => {
    const walk = createRandomColorWalk(seeded(SEED));
    expect(walk.from).toEqual(START);
    expect(walk.to).toEqual(TARGET);
    expect(walk.step).toBe(0);
  });

  it('the first dab of a stroke IS its starting colour', () => {
    const rand = seeded(SEED);
    const walk = createRandomColorWalk(rand);
    expect(advanceRandomColorWalk(walk, rand)).toEqual(START);
  });

  it('interpolates smoothly across the leg, a step per dab', () => {
    const rand = seeded(SEED);
    const walk = createRandomColorWalk(rand);
    const first = advanceRandomColorWalk(walk, rand);
    const seen = [first];
    for (let i = 1; i < RANDOM_WALK_FRAMES; i++) seen.push(advanceRandomColorWalk(walk, rand));
    // Ten dabs, ten distinct colours marching from `from` toward `to`…
    expect(seen).toHaveLength(RANDOM_WALK_FRAMES);
    expect(seen[0]).toEqual(START);
    // …monotonic on every channel, which is what "smoothly" means here.
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i].r).toBeGreaterThanOrEqual(seen[i - 1].r);
      expect(seen[i].b).toBeLessThanOrEqual(seen[i - 1].b);
    }
    // The last dab of the leg stops one frame short of the target…
    expect(seen[seen.length - 1]).not.toEqual(TARGET);
  });

  it('rolls into the next leg with no repeat and no jump', () => {
    const rand = seeded(SEED);
    const walk = createRandomColorWalk(rand);
    for (let i = 0; i < RANDOM_WALK_FRAMES; i++) advanceRandomColorWalk(walk, rand);
    // The leg's target becomes the next leg's start, so the very next dab is
    // exactly that colour — the line crosses the seam without a step.
    expect(walk.from).toEqual(TARGET);
    expect(walk.step).toBe(0);
    expect(advanceRandomColorWalk(walk, rand)).toEqual(TARGET);
  });

  it('a dab deposits the colour the walk is carrying, not a fresh roll', () => {
    // The engine blend for 'randomize' returns the brush colour, laid down
    // at the non-Normal half strength — so what lands is the base drifted
    // halfway to what the stroke decided, the same target on every pass.
    const state = stateWith([svg('svg_1')]);
    const brush: RGBColor = { r: 10, g: 200, b: 30 };
    const { draft } = stamp(state, brush, 'randomize', 1, [2, 0]);
    expect(draft.paintedSegments.get('svg_1')?.get(0)).toEqual(blendColor(BLACK, brush, 'randomize', 0.5));
  });

  /** Dab the same spot `times` over on ONE draft — a brush held still,
   *  which is what a slow drag across a big shape amounts to. The colour
   *  after each dab, in order. */
  const heldDabs = (
    mode: Parameters<typeof createPaintStrokeDraft>[1], opacity: number, times: number,
  ) => {
    const state = stateWith([svg('svg_1')]);
    const brush: RGBColor = { r: 10, g: 200, b: 30 };
    const draft = createPaintStrokeDraft(brush, mode, opacity);
    const textPaint = createTextPaintState();
    const imagePaint = createOverlayPaintState();
    const shapePaint = createOverlayPaintState();
    const objectColor = createObjectColorState();
    const seen: RGBColor[] = [];
    for (let i = 0; i < times; i++) {
      stampPaintBrush(
        state, draft, textPaint, imagePaint, shapePaint, 2, 0,
        1, null, new Set(), 'paint', null, null, objectColor,
      );
      seen.push(draft.paintedSegments.get('svg_1')!.get(0)!);
    }
    return { brush, seen };
  };

  it('a HELD random brush keeps working the surface, like every other brush', () => {
    // The bug this pins: Random used to be a one-go-per-surface mode, so a
    // shape took its whole colour on the dab that first touched it and
    // then ignored the rest of the drag. At a low opacity nothing faded
    // in — the stroke only ever seemed to act when it crossed into a NEW
    // shape. Random is not a function of the base (it deposits what the
    // walk carries, the same arithmetic Normal does), so there was never
    // anything to protect by running it once.
    const { brush, seen } = heldDabs('randomize', 0.2, 4);
    // Each dab moves further toward the colour the walk is carrying…
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i].g).toBeGreaterThan(seen[i - 1].g);
      expect(seen[i].g).toBeLessThanOrEqual(brush.g);
    }
    // …and at a fifth of the hand, no single dab gets anywhere near it.
    expect(seen[0].g).toBeLessThan(brush.g / 2);
  });

  it('rotate and invert stay one-go-per-surface — they read what is under them', () => {
    // The carve-out the change above does NOT touch: re-running either on
    // its own output walks away from the answer (a second invert undoes
    // the first), so each surface still gets exactly one.
    for (const mode of ['rotate', 'invert'] as const) {
      const { seen } = heldDabs(mode, 0.2, 3);
      expect(seen[1]).toEqual(seen[0]);
      expect(seen[2]).toEqual(seen[0]);
    }
  });
});

describe('an island the legacy fields cannot describe', () => {
  // Turned off the quarters inside a bound group that is then stretched
  // along one axis: the island is DRAWN as a parallelogram, and a box plus
  // an angle can only name the nearest rectangle around it. Every brush
  // that reaches an island — erase, blur, push's raster half — maps its dab
  // through this frame, so the frame is what decides whether the eraser
  // bites the ink the user is pointing at.

  it('maps a world dab onto the texel it is drawn over', () => {
    const { state, island, at } = shearedIslandFixture();
    const frame = islandTileFrame(drawnLeaf(graphOf(state), island.id)!);
    const [tx, ty] = frame.toTile(at[0], at[1]);
    const view = state.paintObjects!.find((p) => p.id === island.id)!;
    expect(paintTileAlphaAt(view.tiles, tx, ty)).toBe(255);
    // The foil: the box-and-angle frame sends that same point to bare tile.
    const [lx, ly] = paintLocalFrame(view).toTile(at[0], at[1]);
    expect(paintTileAlphaAt(view.tiles, lx, ly)).toBe(0);
  });

  it('a stroke starting on its drawn ink lands on THAT island', () => {
    // resolvePaintSessionTarget: a locked island is dried paint the stroke
    // cannot join, so the stroke mints fresh and seats itself over it. It
    // only finds the island at all if the alpha probe runs in the island's
    // own frame.
    const { state, island, at } = shearedIslandFixture();
    const locked = {
      ...state,
      paintObjects: state.paintObjects!.map(
        (p): PaintObject => (p.id === island.id ? { ...p, locked: true } : p),
      ),
    };
    expect(resolvePaintSessionTarget(locked, null, at[0], at[1], 0.25))
      .toEqual({ paintId: null, over: island.id });
    // …and open ground beside the island captures nothing.
    expect(resolvePaintSessionTarget(locked, null, at[0] + 12, at[1] - 12, 0.25))
      .toEqual({ paintId: null });
  });
});
