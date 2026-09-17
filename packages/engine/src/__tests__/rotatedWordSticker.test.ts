import { generateCompositionSVGCore } from '../compositionSVGCore';
import { GEOMETRY_ADAPTERS } from '../sceneNodeGeometry';
import { contentBoxCells, layoutText } from '../textLayout';
import { STICKER_BORDER_CELLS } from '../stickerStyle';
import { TextObject } from '../types';
import {
  drawnQuad, expectQuadsClose, legacyQuad, transformsIn,
} from './exportPose.test-utils';

// Turning a word magnet used to pull its type off its card.
//
// A quarter turn swaps a node's WORLD box — `rotate90CW` records the turned
// rectangle, because that is the space the node now occupies — while the card
// and the type inside are still drawn un-turned and rotated into place. The
// card was laid out in that un-turned box and the TEXT in the world one, so a
// wide magnet stood on end wrapped its word to the card's short side and
// floated it off the card it belongs to.

const U = 256;

/** A word magnet: 8 cells wide, 2 tall, as the scaffold places one. */
function magnet(over: Partial<TextObject> = {}): TextObject {
  return {
    id: 'txt_w',
    content: 'because',
    sticker: true,
    style: { fontId: 'CozySans', size: 1, color: { r: 0, g: 0, b: 0 } },
    cellX: 4, cellY: 4, cellWidth: 8, cellHeight: 2,
    ...over,
  } as TextObject;
}

function inputs(texts: TextObject[]) {
  return {
    figures: [], svgObjects: [], images: [], imageBlobs: {}, texts,
    gridLevel: 0, canvasWidthL0: 32, canvasHeightL0: 32,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: { width: 100, height: 100 },
    groups: [],
  } as never;
}

const turned = () => GEOMETRY_ADAPTERS.text.rotate90CW(magnet()) as TextObject;

describe('contentBoxCells', () => {
  it('un-swaps a quarter turn, and leaves everything else alone', () => {
    expect(contentBoxCells({ cellWidth: 8, cellHeight: 2 })).toEqual({ width: 8, height: 2 });
    expect(contentBoxCells({ cellWidth: 2, cellHeight: 8, rotation: 90 }))
      .toEqual({ width: 8, height: 2 });
    expect(contentBoxCells({ cellWidth: 2, cellHeight: 8, rotation: 270 }))
      .toEqual({ width: 8, height: 2 });
    // A half turn keeps the axes where they are.
    expect(contentBoxCells({ cellWidth: 8, cellHeight: 2, rotation: 180 }))
      .toEqual({ width: 8, height: 2 });
  });
});

describe('a word magnet stood on end', () => {
  it('really does swap its world box, keeping the card’s own box', () => {
    const t = turned();
    // The premise: world box is now 2×8, while the card and type are 8×2.
    expect([t.cellWidth, t.cellHeight]).toEqual([2, 8]);
    expect(t.rotation).toBe(90);
    expect(contentBoxCells(t)).toEqual({ width: 8, height: 2 });
  });

  it('lays the text out in the SAME box the card fills', async () => {
    // The bug: the card took the un-turned 8×2 box and the text the world
    // 2×8 one, so the type was placed against a box four times as tall as
    // the card it sits on. Centred type shows it most plainly — the block is
    // centred in a 2-cell card, not in an 8-cell column.
    const t = turned();
    t.style = { ...t.style, vAlign: 'middle' };
    const box = contentBoxCells(t);
    const inBox = layoutText(t.content, t.style, {
      maxWidth: box.width, maxHeight: box.height,
    });
    const inWorldBox = layoutText(t.content, t.style, {
      maxWidth: t.cellWidth, maxHeight: t.cellHeight,
    });
    // The two really are different layouts — otherwise this proves nothing
    // about which one is used.
    expect(inBox.lines[0].y).not.toBeCloseTo(inWorldBox.lines[0].y, 6);

    const svg = await generateCompositionSVGCore(inputs([t]));
    const y = Number(svg!.match(/<text x="[^"]*" y="([^"]*)"/)![1]);
    const lineHeight = t.style.size * 1.2;
    expect(y).toBeCloseTo((inBox.lines[0].y + lineHeight / 2) * U, 3);
  });

  it('draws card and glyphs in one box, inside one transform', async () => {
    const svg = await generateCompositionSVGCore(inputs([turned()]));
    const bw = STICKER_BORDER_CELLS * U;
    // The card is the CONTENT box (8×2), not the world box (2×8).
    expect(svg).toContain(`width="${8 * U - bw}" height="${2 * U - bw}"`);
    // One group carries both, so they turn together — the fix's whole point.
    expect(svg!.match(/<g transform=/g)).toHaveLength(1);
  });

  it('keeps the card inside the node’s own bbox', async () => {
    // The card is 8×2 turned 90° about the world box's centre, so it covers
    // exactly the 2×8 world box — it does not stick out of it. Asserted as
    // the quad the markup draws, because the export has spelled this pose
    // two ways: a translate/rotate chain off the pose fields, and (P5 of
    // docs/transform-refactor.md) one matrix off the scene graph.
    const t = turned();
    const svg = (await generateCompositionSVGCore(inputs([t])))!;
    const box = contentBoxCells(t);
    const quad = drawnQuad(transformsIn(svg)[0], box.width, box.height);
    expectQuadsClose(quad, legacyQuad({
      x: t.cellX, y: t.cellY, width: t.cellWidth, height: t.cellHeight,
      rotation: t.rotation,
    }));
    // …and that quad IS the world box: its corners are the box's corners.
    const xs = quad.map((p) => p[0]).sort((a, b) => a - b);
    const ys = quad.map((p) => p[1]).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(t.cellX * U, 3);
    expect(xs[3]).toBeCloseTo((t.cellX + t.cellWidth) * U, 3);
    expect(ys[0]).toBeCloseTo(t.cellY * U, 3);
    expect(ys[3]).toBeCloseTo((t.cellY + t.cellHeight) * U, 3);
  });
});
