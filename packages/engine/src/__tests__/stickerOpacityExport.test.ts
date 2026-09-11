import { generateCompositionSVGCore } from '../compositionSVGCore';
import { TextObject } from '../types';

// A word sticker's opacity is the WHOLE magnet's: its ink is its card
// scheme's, so `style.alpha` (the v55 ink opacity plain text fades its
// glyphs by) fades the card, border, shadow and ink together — as one
// `opacity` on the node group, the way the DOM layer fades its oriented
// wrapper. Plain text keeps fading its <text> elements alone.

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

describe('a word sticker’s opacity', () => {
  it('fades the whole magnet: one opacity on the node group, none on the glyphs', async () => {
    const t = magnet();
    t.style = { ...t.style, alpha: 0.4 };
    const svg = (await generateCompositionSVGCore(inputs([t])))!;
    expect(svg).toMatch(/<g transform="[^"]*" opacity="0.4">/);
    // The card and the glyphs sit inside that group…
    const group = svg.slice(svg.indexOf('opacity="0.4">'), svg.lastIndexOf('</g>'));
    expect(group).toContain('<rect');
    expect(group).toContain('<text');
    // …and the glyphs carry no opacity of their own (that would compound).
    expect(svg.match(/<text [^>]*opacity=/)).toBeNull();
  });

  it('an opaque magnet carries no opacity on its group or glyphs', async () => {
    // (Its card's fixed shadow filter has a flood-opacity of its own.)
    const plain = (await generateCompositionSVGCore(inputs([magnet()])))!;
    expect(plain).not.toMatch(/<g transform="[^"]*" opacity=/);
    expect(plain.match(/<text [^>]*opacity=/)).toBeNull();
    const full = (await generateCompositionSVGCore(inputs([magnet({ style: { fontId: 'CozySans', size: 1, color: { r: 0, g: 0, b: 0 }, alpha: 1 } })])))!;
    expect(full).not.toMatch(/<g transform="[^"]*" opacity=/);
  });

  it('plain text still fades its glyphs, not its group', async () => {
    const t = magnet({ sticker: false });
    t.style = { ...t.style, alpha: 0.4 };
    const svg = (await generateCompositionSVGCore(inputs([t])))!;
    expect(svg).not.toMatch(/<g transform="[^"]*" opacity=/);
    expect(svg).toMatch(/<text [^>]*opacity="0.4"/);
  });
});
