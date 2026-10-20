/**
 * The raster paintbrush's spray-paint occlusion stack (sceneOcclusion.ts):
 * what each kind of scene object lets a dab deposit past it, how opacity
 * falls through a stack multiplicatively, how the walk truncates at the
 * deposit target's z, the per-texel island-mask memoization, and the
 * fresh-island insertion index the blockers record.
 */

import { buildSceneOcclusion, FRESH_ISLAND_ORDER } from '../sceneOcclusion';
import { textPaintGeometry } from '../paintBrush';
import { drawnLeafOf } from '../drawnPose';
import { makeBlankComposition } from '@/editor/blankComposition';
import { makePaintIsland, shearedIslandFixture } from './test-utils';
import { findItem } from '@/engine/compositionOps';
import { paintTileAlphaAt } from '@/engine/canvasPaint';
import { paintLocalFrame } from '@/engine/paintObject';
import {
  CompositionState, ImageObject, PaintObject, PathSegment, SVGObject, TextObject,
} from '@/engine/types';

const INK = { r: 40, g: 40, b: 40 };
const NONE = new Set<string>();

const line = (start: [number, number], end: [number, number]): PathSegment =>
  ({ kind: 'line', start, end });

/** A closed 10×10 box at (10, 10) — interior [10..20]². */
function rectSvg(id: string, extras: Partial<SVGObject> = {}): SVGObject {
  return {
    id,
    segments: [
      line([10, 10], [20, 10]),
      line([20, 10], [20, 20]),
      line([20, 20], [10, 20]),
      line([10, 20], [10, 10]),
    ],
    color: { ...INK },
    cellX: 10, cellY: 10, cellWidth: 10, cellHeight: 10,
    ...extras,
  };
}

/** The Fill bar's solid fill at `opacity`. */
const solidFill = (opacity: number) => ({
  type: 'solid' as const,
  solid: { r: 200, g: 60, b: 60 },
  stops: [
    { offset: 0, color: { r: 200, g: 60, b: 60 } },
    { offset: 1, color: { r: 200, g: 60, b: 60 } },
  ],
  angle: 90,
  opacity,
  blend: 'normal' as const,
});

function imageNode(id: string, extras: Partial<ImageObject> = {}): ImageObject {
  return {
    id,
    assetId: 'asset_1',
    cellX: 10, cellY: 10, cellWidth: 10, cellHeight: 10,
    ...extras,
  } as ImageObject;
}

function stateWith(
  objects: Array<SVGObject | ImageObject | TextObject | ReturnType<typeof makePaintIsland>>,
): CompositionState {
  const base = makeBlankComposition('comp_occ');
  const svgObjects = objects.filter((o): o is SVGObject => o.id.startsWith('svg_'));
  const images = objects.filter((o): o is ImageObject => o.id.startsWith('img_'));
  const texts = objects.filter((o): o is TextObject => o.id.startsWith('txt_'));
  const paints = objects.filter(
    (o): o is ReturnType<typeof makePaintIsland> => o.id.startsWith('pnt_'),
  );
  return {
    ...base,
    svgObjects,
    images,
    texts,
    paintObjects: paints,
    sceneOrder: objects.map((o) => o.id),
  };
}

/** Transmittance to a FRESH island (below everything) at (x, y). */
function tFresh(state: CompositionState, x: number, y: number, skip = NONE): number {
  return buildSceneOcclusion(state, skip).transmittanceAbove(FRESH_ISLAND_ORDER, x, y);
}

describe('per-kind coverage', () => {
  it('an opaque filled shape blocks its interior and passes outside it', () => {
    const state = stateWith([rectSvg('svg_a', { fill: solidFill(1) })]);
    expect(tFresh(state, 15, 15)).toBe(0);
    expect(tFresh(state, 25, 15)).toBe(1);
  });

  it('a 0.75-opacity fill lets 0.25 of the stroke fall through', () => {
    const state = stateWith([rectSvg('svg_a', { fill: solidFill(0.75) })]);
    expect(tFresh(state, 15, 15)).toBeCloseTo(0.25, 10);
  });

  it('whole-object opacity multiplies onto the fill layer’s own', () => {
    const state = stateWith([rectSvg('svg_a', { fill: solidFill(0.5), opacity: 0.5 })]);
    expect(tFresh(state, 15, 15)).toBeCloseTo(0.75, 10); // 1 − 0.5·0.5
  });

  it('an unfilled outline blocks only its stroke band, never the interior', () => {
    const state = stateWith([rectSvg('svg_a')]);
    // On the outline: opaque ink regardless of any fill.
    expect(tFresh(state, 15, 10)).toBe(0);
    // Dead center of the OPEN interior: spray sails through the hole.
    expect(tFresh(state, 15, 15)).toBe(1);
  });

  it('a legacy fillColor occludes at its fillOpacity', () => {
    const state = stateWith([
      rectSvg('svg_a', { fillColor: { r: 1, g: 2, b: 3 }, fillOpacity: 0.4 }),
    ]);
    expect(tFresh(state, 15, 15)).toBeCloseTo(0.6, 10);
  });

  it('an image covers its frame at its opacity, and only its frame', () => {
    const state = stateWith([imageNode('img_a', { opacity: 0.5 })]);
    expect(tFresh(state, 15, 15)).toBeCloseTo(0.5, 10);
    expect(tFresh(state, 25, 15)).toBe(1);
  });

  it('a freely rotated image covers where it actually shows', () => {
    // A 10×2 sliver at 90° of free angle: the unrotated bbox's left edge is
    // now empty air; the frame stands vertically through the center.
    const state = stateWith([
      imageNode('img_a', { cellY: 14, cellHeight: 2, angleDeg: 90 }),
    ]);
    expect(tFresh(state, 11, 15)).toBe(1);  // inside the unrotated bbox — clear
    expect(tFresh(state, 15, 11)).toBe(0);  // on the standing sliver
  });

  it('text blocks inside its character boxes, not across its whole bbox', () => {
    const text: TextObject = {
      id: 'txt_a',
      content: 'hi',
      style: { fontId: 'system', size: 2, color: { ...INK } },
      cellX: 10, cellY: 10, cellWidth: 8, cellHeight: 3,
    };
    const state = stateWith([text]);
    const geom = textPaintGeometry(drawnLeafOf('text', text));
    const box = geom.chars.get(0)!;
    // Boxes live in the node's layout frame == world frame here (no
    // transform), offset by the node origin.
    expect(tFresh(state, 10 + box.x + box.w / 2, 10 + box.y + box.h / 2)).toBe(0);
    expect(tFresh(state, 17.5, 12.5)).toBe(1); // bbox corner past the glyphs
  });

  it('a paint island above blocks by its texel alpha × its opacity', () => {
    // Dab and sample the same texel CENTER — off-center the falloff leaves
    // the texel a hair under full alpha.
    const island = makePaintIsland(15.0625, 15.0625);
    const state = stateWith([island]);
    expect(tFresh(state, 15.0625, 15.0625)).toBe(0);
    expect(tFresh(state, 30, 30)).toBe(1);
    const dimmed = stateWith([{ ...island, opacity: 0.5 }]);
    expect(tFresh(dimmed, 15.0625, 15.0625)).toBeCloseTo(0.5, 2);
  });
});

describe('the stack', () => {
  it('transmittance multiplies through stacked occluders', () => {
    const state = stateWith([
      rectSvg('svg_below', { fill: solidFill(0.5) }),
      rectSvg('svg_above', { fill: solidFill(0.5) }),
    ]);
    expect(tFresh(state, 15, 15)).toBeCloseTo(0.25, 10);
  });

  it('only occluders strictly ABOVE the order count', () => {
    const state = stateWith([
      rectSvg('svg_below', { fill: solidFill(1) }),
      rectSvg('svg_above', { fill: solidFill(0.5) }),
    ]);
    const occ = buildSceneOcclusion(state, NONE);
    // Target between the two: the opaque shape is UNDER it — irrelevant.
    expect(occ.transmittanceAbove(occ.orderOf('svg_below'), 15, 15)).toBeCloseTo(0.5, 10);
    // Target above both: unoccluded.
    expect(occ.transmittanceAbove(occ.orderOf('svg_above'), 15, 15)).toBe(1);
  });

  it('weightFor is the transmittance above that object — the top object takes the dab', () => {
    const state = stateWith([
      rectSvg('svg_below', { fill: solidFill(1) }),
      rectSvg('svg_above', { fill: solidFill(0.75) }),
    ]);
    const occ = buildSceneOcclusion(state, NONE);
    expect(occ.weightFor('svg_above', 15, 15)).toBe(1);
    expect(occ.weightFor('svg_below', 15, 15)).toBeCloseTo(0.25, 10);
    expect(occ.weightFor('svg_not_in_scene', 15, 15)).toBe(1);
  });

  it('hidden objects, skipIds and mask shapes never occlude', () => {
    const hidden = stateWith([rectSvg('svg_a', { fill: solidFill(1), hidden: true })]);
    expect(tFresh(hidden, 15, 15)).toBe(1);
    const skipped = stateWith([rectSvg('svg_a', { fill: solidFill(1) })]);
    expect(tFresh(skipped, 15, 15, new Set(['svg_a']))).toBe(1);
    const mask = stateWith([rectSvg('svg_a', { fill: solidFill(1), isMask: true })]);
    expect(tFresh(mask, 15, 15)).toBe(1);
  });

  it('locked objects still occlude — locked ink is still ink', () => {
    const state = stateWith([rectSvg('svg_a', { fill: solidFill(1), locked: true })]);
    expect(tFresh(state, 15, 15)).toBe(0);
  });
});

describe('the island mask and the fresh-island insertion index', () => {
  it('classifies each texel once, however many dabs revisit it', () => {
    // Count how often the walk actually reaches the shape's geometry: every
    // coverage test reads `segments`, so a counting getter sees each
    // classification. Repeat queries of the same texel must hit the byte
    // cache instead.
    const svg = rectSvg('svg_a', { fill: solidFill(1) });
    const segments = svg.segments;
    let reads = 0;
    Object.defineProperty(svg, 'segments', {
      get() {
        reads++;
        return segments;
      },
    });
    const state = stateWith([svg]);
    const occ = buildSceneOcclusion(state, NONE);
    const mask = occ.islandMask(FRESH_ISLAND_ORDER);
    const weigh = mask.forIsland('0,0', 128 * 128, 0, 0);
    const probe = () => weigh(((15 * 8) * 128 + 15 * 8) * 4, 15.0625, 15.0625);
    const first = probe();
    expect(first).toBe(0);
    const readsAfterFirst = reads;
    expect(readsAfterFirst).toBeGreaterThan(0);
    // Memoized: identical answer, no further geometry reads, and forIsland
    // hands back the same fn for the island.
    expect(probe()).toBe(first);
    expect(reads).toBe(readsAfterFirst);
    expect(mask.forIsland('0,0', 128 * 128, 0, 0)).toBe(weigh);
  });

  it('quantizes partial transmittance without losing more than a step', () => {
    const state = stateWith([rectSvg('svg_a', { fill: solidFill(0.75) })]);
    const occ = buildSceneOcclusion(state, NONE);
    const weigh = occ.islandMask(FRESH_ISLAND_ORDER).forIsland('0,0', 128 * 128, 0, 0);
    const w = weigh(0, 15.0625, 15.0625);
    expect(Math.abs(w - 0.25)).toBeLessThan(1 / 254);
    // The cached read agrees with the first.
    expect(weigh(0, 15.0625, 15.0625)).toBe(w);
  });

  it('records the LOWEST blocker the island ink met — the splice-below slot', () => {
    const state = stateWith([
      rectSvg('svg_low', { fill: solidFill(1) }),
      rectSvg('svg_high', {
        segments: [
          line([12, 12], [18, 12]), line([18, 12], [18, 18]),
          line([18, 18], [12, 18]), line([12, 18], [12, 12]),
        ],
        cellX: 12, cellY: 12, cellWidth: 6, cellHeight: 6,
        fill: solidFill(0.5),
      }),
    ]);
    const occ = buildSceneOcclusion(state, NONE);
    const weigh = occ.islandMask(FRESH_ISLAND_ORDER).forIsland('0,0', 128 * 128, 0, 0);
    expect(occ.freshInsertionIndex()).toBeUndefined(); // nothing queried yet
    weigh(0, 15.0625, 15.0625); // under BOTH shapes
    expect(occ.freshInsertionIndex()).toBe(0); // svg_low is the lower blocker
  });

  it('reports no insertion slot when nothing ever occluded the stroke', () => {
    const state = stateWith([rectSvg('svg_a', { fill: solidFill(1) })]);
    const occ = buildSceneOcclusion(state, NONE);
    const weigh = occ.islandMask(FRESH_ISLAND_ORDER).forIsland('0,0', 128 * 128, 0, 0);
    weigh(0, 25.0625, 25.0625); // open ground beside the shape
    expect(occ.freshInsertionIndex()).toBeUndefined();
  });
});

describe('an occluder sheared inside a bound group', () => {
  it('blocks where its ink is drawn, not where a rectangle would put it', () => {
    const { state, at } = shearedIslandFixture();
    expect(buildSceneOcclusion(state, NONE)
      .transmittanceAbove(FRESH_ISLAND_ORDER, at[0], at[1])).toBe(0);
  });

  it('and the legacy reading of that same point lands on bare tile', () => {
    // The foil, so this pair cannot quietly stop being about the
    // difference: the box-and-angle frame carries the very point above onto
    // a texel with no ink in it — a dab there used to fall straight through.
    const { state, island, at } = shearedIslandFixture();
    const view = findItem(state, island.id)!.item as PaintObject;
    const [tx, ty] = paintLocalFrame(view).toTile(at[0], at[1]);
    expect(paintTileAlphaAt(view.tiles, tx, ty)).toBe(0);
    // …while the texel the ink is actually in is opaque.
    expect(paintTileAlphaAt(view.tiles, 18.0625, 18.0625)).toBe(255);
  });
});
