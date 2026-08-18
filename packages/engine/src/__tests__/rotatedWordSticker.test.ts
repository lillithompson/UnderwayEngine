import { generateCompositionSVGCore } from '../compositionSVGCore';
import { GEOMETRY_ADAPTERS } from '../sceneNodeGeometry';
import { contentBoxCells, layoutText } from '../textLayout';
import { STICKER_BORDER_CELLS } from '../stickerStyle';
import { TextObject } from '../types';

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
    const g = svg!.match(/<g transform="([^"]*)">/)![1];
    // Rotated about the world bbox centre, then stepped into the content box
    // centred inside it — so the turned card lands back over its own bbox.
    expect(g).toContain(`rotate(90 ${(2 * U) / 2} ${(8 * U) / 2})`);
    expect(g).toContain(`translate(${(2 * U - 8 * U) / 2}, ${(8 * U - 2 * U) / 2})`);
  });

  it('keeps the card inside the node’s own bbox', async () => {
    // The card is 8×2 rotated 90° about the world box's centre, so it should
    // cover exactly the 2×8 world box — not stick out of it.
    const t = turned();
    const svg = await generateCompositionSVGCore(inputs([t]));
    const g = svg!.match(/<g transform="([^"]*)">/)![1];
    const [, txs, tys] = g.match(/^translate\(([-\d.]+), ([-\d.]+)\)/)!;
    const [, cxs, cys] = g.match(/translate\(([-\d.]+), ([-\d.]+)\)$/)!;
    // Corner of the content box, carried through the centring step and the
    // quarter turn about the world centre, lands on the bbox corner.
    const originX = Number(txs) + Number(cxs);
    const originY = Number(tys) + Number(cys);
    const worldCx = Number(txs) + (t.cellWidth * U) / 2;
    const worldCy = Number(tys) + (t.cellHeight * U) / 2;
    // Rotate (originX, originY) 90° CW about the world centre.
    const rx = worldCx - (originY - worldCy);
    const ry = worldCy + (originX - worldCx);
    expect(rx).toBeCloseTo((t.cellX + t.cellWidth) * U, 6);
    expect(ry).toBeCloseTo(t.cellY * U, 6);
  });
});
