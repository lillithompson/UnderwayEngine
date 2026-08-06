/**
 * A FRAME's border in the SVG export.
 *
 * The border lives on the frame's boundary rect (`effects.border` on the rect
 * that also masks the frame), and that rect is the frame's BACK-MOST member —
 * so painting the border with the node hides it under everything in the frame.
 * The canvas draws it as an overlay just after the frame's clipped run
 * (CanvasSurface's BorderOverlay); these tests pin the export to that order.
 *
 * Drives the pure `generateCompositionSVGCore` — the one path both storage-backed
 * wrappers use, and it needs no storage or canvas mocks.
 */
import { generateCompositionSVGCore, type CompositionSVGInputs } from '../compositionSVGCore';
import { BorderEffect, GroupNode, ImageObject, PathSegment, SVGObject } from '../types';

/** SVG_UNITS_PER_L0_CELL — world cells scale into SVG units by this. */
const U = 256;

const PAGE = 32;

const closedSquare: PathSegment[] = [
  { kind: 'line', start: [0, 0], end: [PAGE, 0] },
  { kind: 'line', start: [PAGE, 0], end: [PAGE, PAGE] },
  { kind: 'line', start: [PAGE, PAGE], end: [0, PAGE] },
  { kind: 'line', start: [0, PAGE], end: [0, 0] },
];

/** The white inner mat a page frame carries (cf. the haiku format). */
const WHITE_BORDER: BorderEffect = {
  width: 0.75,
  position: 'inside',
  dash: 0,
  color: { r: 255, g: 255, b: 255 },
};

function makeBoundary(overrides: Partial<SVGObject> = {}): SVGObject {
  return {
    id: 'svg_frame',
    segments: closedSquare,
    color: { r: 0, g: 0, b: 0 },
    fillColor: { r: 233, g: 233, b: 233 },
    cellX: 0, cellY: 0, cellWidth: PAGE, cellHeight: PAGE,
    isMask: true,
    groupId: 'grp_frame',
    effects: { border: WHITE_BORDER },
    ...overrides,
  } as SVGObject;
}

function makeFrameGroup(overrides: Partial<GroupNode> = {}): GroupNode {
  return {
    id: 'grp_frame', name: 'Frame', isFrame: true,
    translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
    rotation: 0, mirrorH: false, mirrorV: false,
    ...overrides,
  };
}

/** A full-bleed photo, the frame's other member — it covers the boundary rect
 *  (and so would cover a border painted with it). */
function makePhoto(overrides: Partial<ImageObject> = {}): ImageObject {
  return {
    id: 'img_photo',
    imageId: 'blob1',
    mimeType: 'image/png',
    pixelWidth: 4, pixelHeight: 4,
    cellX: 0, cellY: 0, cellWidth: PAGE, cellHeight: PAGE,
    groupId: 'grp_frame',
    ...overrides,
  };
}

function framedPage(extra: Partial<CompositionSVGInputs> = {}): CompositionSVGInputs {
  return {
    name: 'FramedPage',
    figures: [],
    svgObjects: [makeBoundary()],
    images: [makePhoto()],
    imageBlobs: { blob1: new Uint8Array([1, 2, 3]) },
    strokeScale: 0.04,
    groups: [makeFrameGroup()],
    sceneOrder: ['svg_frame', 'img_photo'],
    loadFigure: async () => null,
    ...extra,
  };
}

/** Every white stroked rect in the document, in paint order, with its geometry
 *  in SVG units. The frame border is the only white stroke these scenes hold. */
function whiteRects(svg: string): { at: number; x: number; y: number; w: number; h: number; width: number }[] {
  const out: { at: number; x: number; y: number; w: number; h: number; width: number }[] = [];
  const re = /<rect ([^>]*stroke="#ffffff"[^>]*)\/>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) {
    const attr = (name: string): number => {
      const found = new RegExp(`${name}="([-\\d.]+)"`).exec(m![1]);
      return found ? parseFloat(found[1]) : NaN;
    };
    out.push({
      at: m.index,
      x: attr('x'), y: attr('y'), w: attr('width'), h: attr('height'),
      width: attr('stroke-width'),
    });
  }
  return out;
}

describe('frame border export', () => {
  it('paints the frame border OVER the frame contents, exactly once', async () => {
    const svg = (await generateCompositionSVGCore(framedPage()))!;
    expect(svg).toBeTruthy();

    const borders = whiteRects(svg);
    expect(borders).toHaveLength(1);

    // Stroked inside the frame rect: centered on a line half a stroke in, so
    // the whole width lands on the page (and inside the pinned viewBox).
    const half = (WHITE_BORDER.width * U) / 2;
    expect(borders[0].width).toBeCloseTo(WHITE_BORDER.width * U);
    expect(borders[0].x).toBeCloseTo(half);
    expect(borders[0].y).toBeCloseTo(half);
    expect(borders[0].w).toBeCloseTo(PAGE * U - WHITE_BORDER.width * U);
    expect(borders[0].h).toBeCloseTo(PAGE * U - WHITE_BORDER.width * U);

    // ...and after the full-bleed photo, which would otherwise bury it.
    expect(borders[0].at).toBeGreaterThan(svg.indexOf('<image'));
  });

  it('keeps content painted after the frame on top of the border', async () => {
    // A word sticker scattered outside the frame paints over it on canvas
    // (it follows the frame group in sceneOrder), so the border must not jump
    // to the top of the document.
    const sticker: SVGObject = {
      id: 'svg_sticker',
      segments: closedSquare,
      color: { r: 12, g: 34, b: 56 },
      cellX: 30, cellY: 30, cellWidth: 4, cellHeight: 4,
    } as SVGObject;
    const svg = (await generateCompositionSVGCore(framedPage({
      svgObjects: [makeBoundary(), sticker],
      sceneOrder: ['svg_frame', 'img_photo', 'svg_sticker'],
    })))!;
    const borders = whiteRects(svg);
    expect(borders).toHaveLength(1);
    expect(borders[0].at).toBeGreaterThan(svg.indexOf('<image'));
    expect(borders[0].at).toBeLessThan(svg.indexOf('rgb(12,34,56)'));
  });

  it('exports the border of a frame whose boundary rect is hidden', async () => {
    // A frame with no background keeps its boundary rect hidden — a clip-only
    // rect. The canvas overlay reads the mask's effects regardless, so the
    // border still shows there and must still export.
    const svg = (await generateCompositionSVGCore(framedPage({
      svgObjects: [makeBoundary({ fillColor: undefined, hidden: true })],
    })))!;
    expect(whiteRects(svg)).toHaveLength(1);
  });

  it('draws no border for a hidden frame', async () => {
    const svg = await generateCompositionSVGCore(framedPage({
      groups: [makeFrameGroup({ hidden: true })],
      // The photo is outside the frame, so the export isn't empty.
      images: [makePhoto({ groupId: undefined })],
    }));
    expect(whiteRects(svg!)).toHaveLength(0);
  });

  it('gives a cutout the frame border only when the boundary is selected', async () => {
    const withoutBoundary = await generateCompositionSVGCore(framedPage({
      subset: () => new Set(['img_photo']),
    }));
    expect(whiteRects(withoutBoundary!)).toHaveLength(0);

    const withBoundary = await generateCompositionSVGCore(framedPage({
      subset: () => new Set(['svg_frame']),
    }));
    expect(whiteRects(withBoundary!)).toHaveLength(1);
  });
});
