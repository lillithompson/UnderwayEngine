import { buildShapeSVGObject } from '@/engine/shapePresets';
import {
  MASK_NAME,
  isTemplateMaskNode,
  maskContains,
  namedLeafBbox,
  templateMaskNode,
  templateNameKey,
} from '../formats/templateNodes';
import { makeImage, makeText } from './test-utils';

// The named nodes a page template contracts (formats/templateNodes.ts):
// the readers the finished page asks — the mask its words are floated
// into, and the node it opens on. (The Date / Frame / Focus readers are
// pinned through CozyJournal's pageTemplate.test.ts, which imports them by
// their old home.)
//
// Every declaration in the moved file was byte-identical in CozyJournal's
// and DrawBots' copies — all 16 — except one that could not come: the
// pre-mask Adrift relic compares against a CozyJournal format id, so it
// stays that app's (web/formats/adriftRelic.ts) along with the six cases
// that drive it. See stage 6.3d.

const BOX = { cellX: 10, cellY: 10, cellWidth: 20, cellHeight: 10 };
const mask = (id = 'svg_mask', name = 'Mask') => ({
  ...buildShapeSVGObject(id, 'rect', BOX, { r: 0, g: 0, b: 0 }), name,
});

describe('templateNameKey', () => {
  test('trims and lower-cases; a nameless node is the empty key', () => {
    expect(templateNameKey({ name: '  Mask ' })).toBe('mask');
    expect(templateNameKey({})).toBe('');
  });
});

describe('the Mask node', () => {
  test('is named exactly "Mask", any case, trimmed', () => {
    expect(MASK_NAME).toBe('mask');
    expect(isTemplateMaskNode({ name: 'Mask' })).toBe(true);
    expect(isTemplateMaskNode({ name: ' MASK ' })).toBe(true);
    expect(isTemplateMaskNode({ name: 'Mask 2' })).toBe(false);
    expect(isTemplateMaskNode({ name: 'Masked' })).toBe(false);
    expect(isTemplateMaskNode({})).toBe(false);
  });

  test('templateMaskNode is the first path so named, or nothing', () => {
    const other = { ...mask('svg_other', 'Bottle') };
    expect(templateMaskNode([other, mask('svg_a'), mask('svg_b')])!.id).toBe('svg_a');
    expect(templateMaskNode([other])).toBeUndefined();
    expect(templateMaskNode([])).toBeUndefined();
  });

  test('maskContains is the outline’s interior — and false for an outline that does not close', () => {
    const m = mask();
    expect(maskContains(m, 20, 15)).toBe(true);
    expect(maskContains(m, 10.5, 10.5)).toBe(true);
    expect(maskContains(m, 5, 15)).toBe(false);
    expect(maskContains(m, 20, 25)).toBe(false);
    const open = { segments: m.segments.slice(0, 2) };
    expect(maskContains(open, 20, 15)).toBe(false);
  });
});

describe('namedLeafBbox — the node a format opens on', () => {
  test('finds a leaf of any kind by name, any case, and reads its bbox', () => {
    const scene = {
      svgObjects: [mask()],
      texts: [makeText('txt_t', 'x', { name: 'Title', cellX: 1, cellY: 2, cellWidth: 3, cellHeight: 4 })],
      images: [makeImage('img_b', { name: 'Bottle', cellX: 5, cellY: 6, cellWidth: 7, cellHeight: 8 })],
    };
    expect(namedLeafBbox(scene, 'mask')).toEqual(BOX);
    expect(namedLeafBbox(scene, ' TITLE ')).toEqual({ cellX: 1, cellY: 2, cellWidth: 3, cellHeight: 4 });
    expect(namedLeafBbox(scene, 'Bottle')).toEqual({ cellX: 5, cellY: 6, cellWidth: 7, cellHeight: 8 });
    expect(namedLeafBbox(scene, 'Center')).toBeUndefined();
    expect(namedLeafBbox({}, 'Mask')).toBeUndefined();
  });
});
