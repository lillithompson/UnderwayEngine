/**
 * v61: a group can be turned off the quarters.
 *
 * `GroupNode.rotation` is one of four, so until now a group the user had
 * twisted to 37° was written out as no turn at all. The page still DREW
 * correctly — a member's world fields are absolute, so the twist simply
 * moved into them — but the group's word about its own frame was gone,
 * and with it every member's: on the next load each member came back
 * measured by the upright rectangle around a tilted shape, and the
 * group's own outline stood square to the page.
 *
 * `angleDeg` is where the residual lives. This file is about the bytes;
 * `sceneGraphRoundTrip.test.ts` ("a group twisted off the quarters
 * survives the arrays") is about what the graph then recovers from them.
 */

import {
  serializeComposition,
  deserializeComposition,
  CompositionBundle,
} from '../compositionBinaryFormat';
import { GroupNode, ImageObject } from '../types';
import { patchFormatVersion } from './test-utils';

function group(overrides: Partial<GroupNode> & { id: string }): GroupNode {
  return {
    name: overrides.id,
    translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
    rotation: 0, mirrorH: false, mirrorV: false,
    ...overrides,
  };
}

/** A group persists only if a leaf somewhere in its subtree does — the
 *  writer drops orphans — so every scene here carries one. */
function member(id: string, groupId: string): ImageObject {
  return {
    id, groupId,
    imageId: 'blob', mimeType: 'image/png', pixelWidth: 40, pixelHeight: 30,
    cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 3,
  };
}

function bundle(groups: GroupNode[]): CompositionBundle {
  const images = groups.map((g, i) => member(`img_${i}`, g.id));
  return {
    name: 'test',
    figures: [], svgObjects: [], images, texts: [],
    groups,
    sceneOrder: images.map((i) => i.id),
    gridLevel: 1, strokeScale: 1, gridIntensity: 1,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
  };
}

function roundTrip(groups: GroupNode[]): GroupNode[] {
  return deserializeComposition(serializeComposition(bundle(groups), [])).meta.groups ?? [];
}

describe("a group's free turn survives the file", () => {
  it.each([37, -37, 0.5, 44.9, -44.9])('round-trips %p degrees', (angleDeg) => {
    const [out] = roundTrip([group({ id: 'g1', angleDeg })]);
    expect(out.angleDeg).toBeCloseTo(angleDeg, 4);
  });

  it('rides alongside the quarter turn rather than replacing it', () => {
    const [out] = roundTrip([group({ id: 'g1', rotation: 270, angleDeg: 12 })]);
    expect(out.rotation).toBe(270);
    expect(out.angleDeg).toBeCloseTo(12, 4);
  });

  it('keeps the flags it shares its byte with', () => {
    // `hidden` is bit 0x01 of the same group-flags2 byte the angle's
    // presence bit was added to; the rest live in the first flags byte.
    const [out] = roundTrip([group({
      id: 'g1', angleDeg: 20, hidden: true, locked: true, isFrame: true,
      mirrorH: true, rotation: 90,
    })]);
    expect(out.angleDeg).toBeCloseTo(20, 4);
    expect(out.hidden).toBe(true);
    expect(out.locked).toBe(true);
    expect(out.isFrame).toBe(true);
    expect(out.mirrorH).toBe(true);
    expect(out.rotation).toBe(90);
  });

  it('writes nothing for a group that has no free turn', () => {
    const [out] = roundTrip([group({ id: 'g1' })]);
    expect(out.angleDeg).toBeUndefined();
  });

  it('costs four bytes, and only for the groups that carry one', () => {
    // The size pass and the write pass read the angle through the same
    // helper; a disagreement between them would overrun the buffer or
    // leave a hole in it, so the length is worth pinning.
    const plain = serializeComposition(bundle([group({ id: 'g1' })]), []).byteLength;
    const turned = serializeComposition(
      bundle([group({ id: 'g1', angleDeg: 37 })]), [],
    ).byteLength;
    expect(turned - plain).toBe(4);
  });

  it('survives several groups, only some of them turned', () => {
    const out = roundTrip([
      group({ id: 'g1', angleDeg: 37 }),
      group({ id: 'g2' }),
      group({ id: 'g3', angleDeg: -8, rotation: 180 }),
    ]);
    const by = new Map(out.map((g) => [g.id, g]));
    expect(by.get('g1')!.angleDeg).toBeCloseTo(37, 4);
    expect(by.get('g2')!.angleDeg).toBeUndefined();
    expect(by.get('g3')!.angleDeg).toBeCloseTo(-8, 4);
    expect(by.get('g3')!.rotation).toBe(180);
  });

  it('a pre-v61 file reads back with no angle, as it always meant', () => {
    // A file written before the field existed has the presence bit clear
    // and no payload, so the record is the v60 one byte for byte. Patched
    // down to v60, the reader must not go looking for four bytes that a
    // v60 writer never wrote.
    const bytes = serializeComposition(bundle([group({ id: 'g1', rotation: 90 })]), []);
    const asV60 = patchFormatVersion(bytes, 60);
    const { meta } = deserializeComposition(asV60);
    expect(meta.groups![0].angleDeg).toBeUndefined();
    expect(meta.groups![0].rotation).toBe(90);
    expect(meta.images!.length).toBe(1);
  });
});
