import {
  applyCompOps,
  computeSVGBbox,
  deriveSceneOrderFromKindArrays,
  findSceneObjectAtCell,
  revertCompOps,
  setNodeAngleDeg,
  unrotatePointForNode,
} from '../compositionOps';
import {
  serializeComposition,
  deserializeComposition,
  CompositionBundle,
} from '../compositionBinaryFormat';
import { generateCompositionSVGCore, type CompositionSVGInputs } from '../compositionSVGCore';
import {
  CompositionState,
  ImageObject,
  PathSegment,
  SVGObject,
  TextObject,
  makeViewport,
} from '../types';

const WHITE = { r: 255, g: 255, b: 255 };

function makeImage(id: string, overrides: Partial<ImageObject> = {}): ImageObject {
  return {
    id, imageId: id,
    cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
    pixelWidth: 64, pixelHeight: 64, mimeType: 'image/png',
    ...overrides,
  };
}

const closedSquare: PathSegment[] = [
  { kind: 'line', start: [0, 0], end: [4, 0] },
  { kind: 'line', start: [4, 0], end: [4, 4] },
  { kind: 'line', start: [4, 4], end: [0, 4] },
  { kind: 'line', start: [0, 4], end: [0, 0] },
];

function sb(svg: Omit<SVGObject, 'cellX' | 'cellY' | 'cellWidth' | 'cellHeight'>): SVGObject {
  return { ...svg, ...computeSVGBbox(svg.segments) };
}

function makeState(parts: Partial<CompositionState> = {}): CompositionState {
  const figures = parts.figures ?? [];
  const svgObjects = parts.svgObjects ?? [];
  const images = parts.images ?? [];
  const texts = parts.texts ?? [];
  return {
    id: 't', name: 't',
    figures, svgObjects, images, texts, imageBlobs: {},
    lineDraft: null, arcDraft: null,
    editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: WHITE, customColors: [],
    groups: parts.groups ?? [],
    sceneOrder: parts.sceneOrder ?? deriveSceneOrderFromKindArrays({ figures, svgObjects, images, texts }),
    gridLevel: 0, strokeScale: 8, gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(),
    activeFigureKey: null,
    compTool: 'select',
    createRegion: null,
    renderGeneration: 0,
    ...parts,
  };
}

// ── unrotatePointForNode ──────────────────────────────────────────────

describe('unrotatePointForNode', () => {
  const node = { cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4 };

  test('is a no-op without a free angle', () => {
    expect(unrotatePointForNode(node, 1.3, 2.7)).toEqual([1.3, 2.7]);
    expect(unrotatePointForNode({ ...node, angleDeg: 0 }, 1.3, 2.7)).toEqual([1.3, 2.7]);
  });

  test('inverts the forward clockwise rotation about the bbox center', () => {
    const deg = 37;
    const cx = 2, cy = 2;
    const rad = (deg * Math.PI) / 180;
    // Forward render maps a local point to screen via the y-down CW matrix.
    const local = { x: 3.1, y: 1.2 };
    const forward = {
      x: cx + (local.x - cx) * Math.cos(rad) - (local.y - cy) * Math.sin(rad),
      y: cy + (local.x - cx) * Math.sin(rad) + (local.y - cy) * Math.cos(rad),
    };
    const [ux, uy] = unrotatePointForNode({ ...node, angleDeg: deg }, forward.x, forward.y);
    expect(ux).toBeCloseTo(local.x, 9);
    expect(uy).toBeCloseTo(local.y, 9);
  });
});

// ── Rotated hit-testing ───────────────────────────────────────────────

describe('findSceneObjectAtCell with free rotation', () => {
  test('a 45° image is hit outside its AABB and missed inside an emptied corner', () => {
    const rotated = makeState({ images: [makeImage('img_1', { angleDeg: 45 })] });
    const upright = makeState({ images: [makeImage('img_1')] });

    // (2, -0.5) is above the AABB top edge but inside the rotated square,
    // which pokes past the edge midpoint.
    expect(findSceneObjectAtCell(rotated, 2, -0.5)).toEqual({ kind: 'image', id: 'img_1' });
    expect(findSceneObjectAtCell(upright, 2, -0.5)).toBeNull();

    // (0.3, 0.3) sits in an AABB corner the rotated square vacates.
    expect(findSceneObjectAtCell(rotated, 0.3, 0.3)).toBeNull();
    expect(findSceneObjectAtCell(upright, 0.3, 0.3)).toEqual({ kind: 'image', id: 'img_1' });

    // The center is inside at any angle.
    expect(findSceneObjectAtCell(rotated, 2, 2)).toEqual({ kind: 'image', id: 'img_1' });
  });
});

// ── setNodeRotation op apply / revert ─────────────────────────────────

describe('setNodeRotation op', () => {
  const angleOf = (state: CompositionState, id: string) =>
    ((state.images ?? []).find((i) => i.id === id) as { angleDeg?: number }).angleDeg;

  test('applyCompOps sets the angle; revertCompOps restores the prior value', () => {
    const state = makeState({ images: [makeImage('img_1', { angleDeg: 10 })] });
    const entry = [{ op: 'setNodeRotation' as const, id: 'img_1', oldAngleDeg: 10, newAngleDeg: 55 }];
    const applied = applyCompOps(state, entry);
    expect(angleOf(applied, 'img_1')).toBeCloseTo(55);
    const reverted = revertCompOps(applied, entry);
    expect(angleOf(reverted, 'img_1')).toBeCloseTo(10);
  });

  test('setNodeAngleDeg clears the field for 0 / undefined', () => {
    const state = makeState({ images: [makeImage('img_1', { angleDeg: 20 })] });
    expect(angleOf(setNodeAngleDeg(state, 'img_1', 0), 'img_1')).toBeUndefined();
    expect(angleOf(setNodeAngleDeg(state, 'img_1', undefined), 'img_1')).toBeUndefined();
    expect(angleOf(setNodeAngleDeg(state, 'img_1', 33), 'img_1')).toBeCloseTo(33);
  });
});

// ── Binary persistence (v31) ──────────────────────────────────────────

function makeBundle(overrides?: Partial<CompositionBundle>): CompositionBundle {
  return {
    name: 'V30', gridLevel: 1, strokeScale: 0.5, gridIntensity: 0.3,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 }, figures: [],
    ...overrides,
  };
}

function roundTrip(bundle: CompositionBundle) {
  return deserializeComposition(serializeComposition(bundle, []));
}

describe('compositionBinaryFormat v31 — free rotation', () => {
  test('round-trips angleDeg on svg / image / text within 0.01°', () => {
    const svg = sb({ id: 'svg_1', segments: closedSquare, color: { r: 1, g: 2, b: 3 }, angleDeg: 15.5 });
    const img = makeImage('img_1', { angleDeg: -42.25 });
    const txt: TextObject = {
      id: 'txt_1', content: 'hi',
      style: { fontId: 'CozySans', size: 2, color: { r: 4, g: 5, b: 6 } },
      cellX: 1, cellY: 1, cellWidth: 4, cellHeight: 2, angleDeg: 90,
    };
    const bundle = makeBundle({
      svgObjects: [svg], images: [img], texts: [txt],
      sceneOrder: ['svg_1', 'img_1', 'txt_1'],
    });
    const out = roundTrip(bundle).meta;
    expect(out.svgObjects![0].angleDeg).toBeCloseTo(15.5, 2);
    expect(out.images![0].angleDeg).toBeCloseTo(-42.25, 2);
    expect(out.texts![0].angleDeg).toBeCloseTo(90, 2);
  });

  test('nodes without a free angle stay undefined (no phantom field)', () => {
    const svg = sb({ id: 'svg_1', segments: closedSquare, color: { r: 1, g: 2, b: 3 } });
    const img = makeImage('img_1');
    const out = roundTrip(makeBundle({ svgObjects: [svg], images: [img], sceneOrder: ['svg_1', 'img_1'] })).meta;
    expect(out.svgObjects![0].angleDeg).toBeUndefined();
    expect(out.images![0].angleDeg).toBeUndefined();
  });
});

// ── Export ────────────────────────────────────────────────────────────

function makeInputs(partial: Partial<CompositionSVGInputs>): CompositionSVGInputs {
  return {
    name: 'V30', figures: [], svgObjects: [], images: [], imageBlobs: {},
    strokeScale: 0.04, loadFigure: async () => null,
    ...partial,
  };
}

describe('generateCompositionSVGCore — free rotation', () => {
  test('emits a rotate(angle …) transform for a rotated image', async () => {
    const img = makeImage('img_1', { cellWidth: 8, cellHeight: 8, angleDeg: 30 });
    const out = await generateCompositionSVGCore(makeInputs({
      images: [img], imageBlobs: { img_1: new Uint8Array([1, 2, 3, 4]) },
      sceneOrder: ['img_1'],
    }));
    expect(out).toContain('rotate(30 ');
  });

  test('wraps a rotated svg object in a rotate group; omits it when upright', async () => {
    const rotated = sb({ id: 'svg_1', segments: closedSquare, color: { r: 9, g: 9, b: 9 }, angleDeg: 22 });
    const withRot = await generateCompositionSVGCore(makeInputs({
      svgObjects: [rotated], sceneOrder: ['svg_1'],
    }));
    expect(withRot).toContain('rotate(22 ');

    const upright = sb({ id: 'svg_1', segments: closedSquare, color: { r: 9, g: 9, b: 9 } });
    const noRot = await generateCompositionSVGCore(makeInputs({
      svgObjects: [upright], sceneOrder: ['svg_1'],
    }));
    expect(noRot).not.toContain('rotate(');
  });
});
