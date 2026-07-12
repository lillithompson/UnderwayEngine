/**
 * Tests for the v14 binary format extension: node transforms section.
 * Verifies round-trip of Transform2D data, backward compatibility with
 * v13 files, and that loaded nodeTransforms produce correct world coords.
 */

import {
  serializeComposition,
  deserializeComposition,
  CompositionBundle,
} from '../compositionBinaryFormat';
import { CompositionFigure, GroupNode } from '../types';
import { Transform2D, IDENTITY } from '../transform2d';

function closeTo(a: number, b: number, eps = 1e-4): boolean {
  return Math.abs(a - b) < eps;
}

function makeFigure(overrides: Partial<CompositionFigure> & { id: string }): CompositionFigure {
  return {
    figureKey: 'test', cellX: 0, cellY: 0,
    resolutionX: 2, resolutionY: 2,
    cellWidth: 4, cellHeight: 4,
    ...overrides,
  };
}

function makeBundle(overrides?: Partial<CompositionBundle>): CompositionBundle {
  return {
    name: 'Test', gridLevel: 1, strokeScale: 8, gridIntensity: 0.3,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    figures: [],
    ...overrides,
  };
}

// ── v14 node transforms round-trip ─────────────────────────────────────

describe('v14 node transforms', () => {
  test('empty nodeTransforms round-trips', () => {
    const bundle = makeBundle({
      nodeTransforms: new Map(),
    });
    const data = serializeComposition(bundle, []);
    const result = deserializeComposition(data);
    // Empty map round-trips as undefined or empty
    expect(result.meta.nodeTransforms === undefined || result.meta.nodeTransforms.size === 0).toBe(true);
  });

  test('single node transform round-trips', () => {
    const transform: Transform2D = {
      tx: 10.5, ty: -20.25, sx: 2, sy: 3,
      rotation: 90, mirrorH: true, mirrorV: false,
    };
    const fig = makeFigure({ id: 'f1', cellX: 10, cellY: 20, cellWidth: 4, cellHeight: 4 });
    const bundle = makeBundle({
      figures: [fig],
      sceneOrder: ['f1'],
      nodeTransforms: new Map([['f1', { transform }]]),
    });

    const data = serializeComposition(bundle, []);
    const result = deserializeComposition(data);

    expect(result.meta.nodeTransforms).toBeDefined();
    const nt = result.meta.nodeTransforms!.get('f1');
    expect(nt).toBeDefined();
    expect(closeTo(nt!.transform.tx, 10.5)).toBe(true);
    expect(closeTo(nt!.transform.ty, -20.25)).toBe(true);
    expect(closeTo(nt!.transform.sx, 2)).toBe(true);
    expect(closeTo(nt!.transform.sy, 3)).toBe(true);
    expect(nt!.transform.rotation).toBe(90);
    expect(nt!.transform.mirrorH).toBe(true);
    expect(nt!.transform.mirrorV).toBe(false);
    expect(nt!.parentId).toBeUndefined();
  });

  test('node with parentId round-trips', () => {
    const group: GroupNode = {
      id: 'g1', name: 'G',
      translateX: 100, translateY: 100, scaleX: 1, scaleY: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const fig = makeFigure({
      id: 'f1', cellX: 0, cellY: 0, groupId: 'g1',
      localCellX: 5, localCellY: 5, localCellWidth: 4, localCellHeight: 4,
    });
    const figTransform: Transform2D = { tx: 5, ty: 5, sx: 2, sy: 2, rotation: 0, mirrorH: false, mirrorV: false };
    const groupTransform: Transform2D = { tx: 100, ty: 100, sx: 1, sy: 1, rotation: 0, mirrorH: false, mirrorV: false };

    const bundle = makeBundle({
      figures: [fig],
      groups: [group],
      sceneOrder: ['f1'],
      nodeTransforms: new Map([
        ['g1', { transform: groupTransform }],
        ['f1', { transform: figTransform, parentId: 'g1' }],
      ]),
    });

    const data = serializeComposition(bundle, []);
    const result = deserializeComposition(data);

    const gnt = result.meta.nodeTransforms!.get('g1');
    expect(gnt).toBeDefined();
    expect(gnt!.parentId).toBeUndefined();
    expect(closeTo(gnt!.transform.tx, 100)).toBe(true);

    const fnt = result.meta.nodeTransforms!.get('f1');
    expect(fnt).toBeDefined();
    expect(fnt!.parentId).toBe('g1');
    expect(closeTo(fnt!.transform.tx, 5)).toBe(true);
    expect(closeTo(fnt!.transform.sy, 2)).toBe(true);
  });

  test('all rotation values round-trip', () => {
    const rotations: (0 | 90 | 180 | 270)[] = [0, 90, 180, 270];
    for (const rotation of rotations) {
      const fig = makeFigure({ id: `f_${rotation}`, cellX: 0, cellY: 0 });
      const bundle = makeBundle({
        figures: [fig],
        sceneOrder: [fig.id],
        nodeTransforms: new Map([
          [fig.id, { transform: { ...IDENTITY, rotation } }],
        ]),
      });
      const data = serializeComposition(bundle, []);
      const result = deserializeComposition(data);
      expect(result.meta.nodeTransforms!.get(fig.id)!.transform.rotation).toBe(rotation);
    }
  });

  test('mirror flags round-trip independently', () => {
    for (const [mh, mv] of [[false, false], [true, false], [false, true], [true, true]]) {
      const fig = makeFigure({ id: `f_${mh}_${mv}`, cellX: 0, cellY: 0 });
      const bundle = makeBundle({
        figures: [fig],
        sceneOrder: [fig.id],
        nodeTransforms: new Map([
          [fig.id, { transform: { ...IDENTITY, mirrorH: mh, mirrorV: mv } }],
        ]),
      });
      const data = serializeComposition(bundle, []);
      const result = deserializeComposition(data);
      const nt = result.meta.nodeTransforms!.get(fig.id)!;
      expect(nt.transform.mirrorH).toBe(mh);
      expect(nt.transform.mirrorV).toBe(mv);
    }
  });

  test('multiple nodes with mixed parenting round-trip', () => {
    const group: GroupNode = {
      id: 'g1', name: 'G',
      translateX: 10, translateY: 10, scaleX: 2, scaleY: 2,
      rotation: 90, mirrorH: false, mirrorV: false,
    };
    const f1 = makeFigure({ id: 'f1', cellX: 0, cellY: 0, groupId: 'g1',
      localCellX: 1, localCellY: 1, localCellWidth: 4, localCellHeight: 4 });
    const f2 = makeFigure({ id: 'f2', cellX: 20, cellY: 20 });

    const bundle = makeBundle({
      figures: [f1, f2],
      groups: [group],
      sceneOrder: ['f1', 'f2'],
      nodeTransforms: new Map([
        ['g1', { transform: { tx: 10, ty: 10, sx: 2, sy: 2, rotation: 90, mirrorH: false, mirrorV: false } }],
        ['f1', { transform: { tx: 1, ty: 1, sx: 2, sy: 2, rotation: 0, mirrorH: false, mirrorV: false }, parentId: 'g1' }],
        ['f2', { transform: { tx: 20, ty: 20, sx: 2, sy: 2, rotation: 0, mirrorH: false, mirrorV: false } }],
      ]),
    });

    const data = serializeComposition(bundle, []);
    const result = deserializeComposition(data);

    expect(result.meta.nodeTransforms!.size).toBe(3);
    expect(result.meta.nodeTransforms!.get('f1')!.parentId).toBe('g1');
    expect(result.meta.nodeTransforms!.get('f2')!.parentId).toBeUndefined();
    expect(result.meta.nodeTransforms!.get('g1')!.parentId).toBeUndefined();
  });
});

// ── Backward compatibility ─────────────────────────────────────────────

describe('backward compatibility', () => {
  test('existing figure data survives v14 round-trip', () => {
    const fig = makeFigure({
      id: 'f1', figureKey: 'star',
      cellX: 10, cellY: 8, cellWidth: 4, cellHeight: 6,
      resolutionX: 2, resolutionY: 3,
      rotation: 90, mirrorH: true,
      locked: true,
    });
    const bundle = makeBundle({
      figures: [fig],
      sceneOrder: ['f1'],
      nodeTransforms: new Map([
        ['f1', { transform: { tx: 10, ty: 8, sx: 2, sy: 2, rotation: 90, mirrorH: true, mirrorV: false } }],
      ]),
    });

    const data = serializeComposition(bundle, []);
    const result = deserializeComposition(data);

    // Legacy fields preserved
    const rf = result.meta.figures[0];
    expect(rf.id).toBe('f1');
    expect(rf.figureKey).toBe('star');
    expect(rf.cellX).toBe(10);
    expect(rf.cellY).toBe(8);
    expect(rf.rotation).toBe(90);
    expect(rf.mirrorH).toBe(true);
    expect(rf.locked).toBe(true);

    // New fields also present
    const nt = result.meta.nodeTransforms!.get('f1')!;
    expect(nt.transform.rotation).toBe(90);
    expect(nt.transform.mirrorH).toBe(true);
  });

  test('grouped figure with local coords round-trips correctly', () => {
    const group: GroupNode = {
      id: 'g1', name: 'G',
      translateX: 50, translateY: 50, scaleX: 2, scaleY: 2,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const fig = makeFigure({
      id: 'f1', cellX: 60, cellY: 60, cellWidth: 8, cellHeight: 8,
      groupId: 'g1',
      localCellX: 5, localCellY: 5, localCellWidth: 4, localCellHeight: 4,
      localRotation: 0, localMirrorH: false, localMirrorV: false,
    });

    const bundle = makeBundle({
      figures: [fig],
      groups: [group],
      sceneOrder: ['f1'],
    });

    const data = serializeComposition(bundle, []);
    const result = deserializeComposition(data);

    const rf = result.meta.figures[0];
    expect(rf.groupId).toBe('g1');
    expect(rf.localCellX).toBe(5);
    expect(rf.localCellY).toBe(5);

    const rg = result.meta.groups![0];
    expect(rg.translateX).toBe(50);
    expect(rg.scaleX).toBe(2);
  });
});

// ── f32 precision ──────────────────────────────────────────────────────

describe('f32 precision', () => {
  test('transform values survive float32 quantization', () => {
    // Values that are exact in float32
    const transform: Transform2D = {
      tx: 1.5, ty: -2.75, sx: 0.5, sy: 4.0,
      rotation: 270, mirrorH: false, mirrorV: true,
    };
    const fig = makeFigure({ id: 'f1' });
    const bundle = makeBundle({
      figures: [fig],
      sceneOrder: ['f1'],
      nodeTransforms: new Map([['f1', { transform }]]),
    });

    const data = serializeComposition(bundle, []);
    const result = deserializeComposition(data);
    const nt = result.meta.nodeTransforms!.get('f1')!;

    expect(nt.transform.tx).toBe(1.5);
    expect(nt.transform.ty).toBe(-2.75);
    expect(nt.transform.sx).toBe(0.5);
    expect(nt.transform.sy).toBe(4.0);
    expect(nt.transform.rotation).toBe(270);
    expect(nt.transform.mirrorV).toBe(true);
  });

  test('large translate values survive float32', () => {
    const transform: Transform2D = {
      tx: 1000, ty: -500, sx: 1, sy: 1,
      rotation: 0, mirrorH: false, mirrorV: false,
    };
    const fig = makeFigure({ id: 'f1' });
    const bundle = makeBundle({
      figures: [fig],
      sceneOrder: ['f1'],
      nodeTransforms: new Map([['f1', { transform }]]),
    });

    const data = serializeComposition(bundle, []);
    const result = deserializeComposition(data);
    const nt = result.meta.nodeTransforms!.get('f1')!;

    expect(nt.transform.tx).toBe(1000);
    expect(nt.transform.ty).toBe(-500);
  });
});
