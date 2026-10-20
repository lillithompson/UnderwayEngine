import type { Camera, ImageObject, Viewport } from '@/engine/types';
import { drawnEdgePx, levelUrlFor, nodeInView, planImageDraws, warmDrawLevels } from '../imageDrawLevels';

// Which source each image on the canvas draws from, and which draws at all.
// What the compositor allocates for a drawn photo is width × height × 4 off
// the SOURCE's pixels, not the box it is drawn in — so a collage of twenty
// photos drawn from their 1024 px display copies is 80 MB of bitmap where
// cell-sized levels are 5 MB, and a photo the camera cannot see costs the
// same as one it can.

jest.mock('@/engine/imageDecodeLevels', () => {
  const actual = jest.requireActual('@/engine/imageDecodeLevels');
  return {
    ...actual,
    peekDecodeLevel: jest.fn(() => null),
    ensureDecodeLevel: jest.fn(async () => null),
  };
});
const { ensureDecodeLevel, peekDecodeLevel } = require('@/engine/imageDecodeLevels') as {
  ensureDecodeLevel: jest.Mock;
  peekDecodeLevel: jest.Mock;
};

/** The canonical 32-cell world across a 320 px viewport at zoom 1: ten
 *  screen px per cell, so a node 8 cells wide is drawn 80 px across. */
const VIEWPORT: Viewport = { width: 320, height: 320 } as Viewport;
const CAMERA: Camera = { offsetX: 0, offsetY: 0, zoom: 1 };

function image(over: Partial<ImageObject> = {}): ImageObject {
  return {
    id: over.id ?? 'img_1',
    imageId: over.imageId ?? 'imgblob_a',
    mimeType: 'image/jpeg',
    pixelWidth: 1024, pixelHeight: 768,
    cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 6,
    ...over,
  } as ImageObject;
}

beforeEach(() => {
  jest.clearAllMocks();
  peekDecodeLevel.mockReturnValue(null);
  ensureDecodeLevel.mockResolvedValue(null);
});

describe('planImageDraws', () => {
  it('asks for a level about the size the node is drawn at', () => {
    // 8 cells of 32 across a 320 px viewport = 80 px drawn → the 128 floor.
    expect(drawnEdgePx(image(), CAMERA, VIEWPORT)).toBe(80);
    expect(planImageDraws([image()], CAMERA, VIEWPORT).get('img_1')!.edge).toBe(128);
    // Zoom in eightfold and the same node wants a bigger level.
    expect(planImageDraws([image()], { ...CAMERA, zoom: 8 }, VIEWPORT).get('img_1')!.edge).toBe(1024);
  });

  it('a page-filling photo keeps its display copy', () => {
    const full = image({ cellWidth: 32, cellHeight: 32 });
    // At the zoom where the page fills a 1024 px viewport the drawn edge is
    // the display cap itself: no level would be smaller.
    const plan = planImageDraws([full], { ...CAMERA, zoom: 1 }, { width: 2048, height: 2048 } as Viewport);
    expect(plan.get('img_1')!.edge).toBe(1024);
  });

  it('a handful of photos is never culled — that page was never the problem', () => {
    const offscreen = image({ cellX: 9000, cellY: 9000 });
    const plans = planImageDraws([offscreen], CAMERA, VIEWPORT);
    expect(plans.get('img_1')!.visible).toBe(true);
  });

  it('a collage culls what the camera cannot reach, and keeps what it can', () => {
    const near = Array.from({ length: 5 }, (_, i) => image({ id: `near_${i}`, cellX: i * 2 }));
    const far = image({ id: 'far', cellX: 9000, cellY: 9000 });
    const plans = planImageDraws([...near, far], CAMERA, VIEWPORT);
    for (const n of near) expect(plans.get(n.id)!.visible).toBe(true);
    expect(plans.get('far')!.visible).toBe(false);
  });

  it('keeps a margin, so a flick does not lead with an empty box', () => {
    const rect = { minX: 0, maxX: 32 };
    // Just outside the viewport but inside the margin (0.75 of its width).
    const justOut = image({ cellX: rect.maxX + 4, cellWidth: 4 });
    expect(nodeInView(justOut, CAMERA, VIEWPORT)).toBe(true);
    const wellOut = image({ cellX: rect.maxX + 40, cellWidth: 4 });
    expect(nodeInView(wellOut, CAMERA, VIEWPORT)).toBe(false);
  });

  it('never asks for a level for a node nobody can see', () => {
    const many = Array.from({ length: 6 }, (_, i) => image({ id: `n_${i}`, cellX: 9000 + i }));
    const plans = planImageDraws(many, CAMERA, VIEWPORT);
    expect(Array.from(plans.values()).every((p) => !p.visible)).toBe(true);
  });
});

describe('levelUrlFor', () => {
  it('draws the level when it is made, the display copy until then', () => {
    const plan = { imageId: 'imgblob_a', edge: 256, visible: true };
    expect(levelUrlFor(plan, 'blob:display')).toBe('blob:display');
    peekDecodeLevel.mockReturnValue({ url: 'blob:level', bytes: new Uint8Array(), mimeType: 'image/jpeg' });
    expect(levelUrlFor(plan, 'blob:display')).toBe('blob:level');
  });

  it('draws NOTHING for a culled node, whatever is cached — that is the cull', () => {
    peekDecodeLevel.mockReturnValue({ url: 'blob:level', bytes: new Uint8Array(), mimeType: 'image/jpeg' });
    expect(levelUrlFor({ imageId: 'imgblob_a', edge: 256, visible: false }, 'blob:display')).toBeUndefined();
  });

  it('a node with no plan yet draws the display copy', () => {
    expect(levelUrlFor(undefined, 'blob:display')).toBe('blob:display');
    expect(levelUrlFor(undefined, undefined)).toBeUndefined();
  });
});

describe('warmDrawLevels', () => {
  const blobs = { imgblob_a: new Uint8Array([1, 2, 3]) };

  it('makes only what is missing, once per (asset, size)', async () => {
    const nodes = [image({ id: 'a' }), image({ id: 'b' })]; // one photo, two nodes
    const plans = planImageDraws(nodes, CAMERA, VIEWPORT);
    ensureDecodeLevel.mockResolvedValue({ url: 'blob:level' });
    expect(await warmDrawLevels(plans, nodes, blobs)).toBe(true);
    expect(ensureDecodeLevel).toHaveBeenCalledTimes(1);
    expect(ensureDecodeLevel).toHaveBeenCalledWith('imgblob_a', 128, blobs.imgblob_a, 'image/jpeg');
  });

  it('asks for nothing already made, and reports that nothing landed', async () => {
    peekDecodeLevel.mockReturnValue({ url: 'blob:level' });
    const nodes = [image()];
    expect(await warmDrawLevels(planImageDraws(nodes, CAMERA, VIEWPORT), nodes, blobs)).toBe(false);
    expect(ensureDecodeLevel).not.toHaveBeenCalled();
  });

  it('skips a node whose bytes are not hydrated, and one that is culled', async () => {
    const nodes = [image({ id: 'x', imageId: 'imgblob_missing' })];
    expect(await warmDrawLevels(planImageDraws(nodes, CAMERA, VIEWPORT), nodes, blobs)).toBe(false);
    expect(ensureDecodeLevel).not.toHaveBeenCalled();

    const many = Array.from({ length: 6 }, (_, i) => image({ id: `n_${i}`, cellX: 9000 + i }));
    expect(await warmDrawLevels(planImageDraws(many, CAMERA, VIEWPORT), many, blobs)).toBe(false);
    expect(ensureDecodeLevel).not.toHaveBeenCalled();
  });

  it('reports false when every level came back empty — the page keeps its display copies', async () => {
    const nodes = [image()];
    ensureDecodeLevel.mockResolvedValue(null);
    expect(await warmDrawLevels(planImageDraws(nodes, CAMERA, VIEWPORT), nodes, blobs)).toBe(false);
  });
});
